"""Explicit World checkout and authenticated idempotent native report delivery."""
import asyncio,json,re,logging
from fastapi import Depends,HTTPException,Request
from fastapi.responses import Response
from pydantic import BaseModel,ConfigDict,StrictBool,Field
from .bridge import AuthDenied,BridgeUnavailable
from .native import NativeInputError,NativeUnavailable,NativeNondelivery
from .sessions import valid
from .vault import SYSTEMS,VaultError,Missing,canonical
from .protocol import SCHEMA,DELIVER,signature,verified

# World gives up on a delivery call after 10 s; a longer computation answers pending and World asks again.
DELIVERY_WAIT_SECONDS=8
# Longer than every engine timeout together; past this a computation counts as stuck.
COMPUTE_LIMIT_MS=15*60000
# How long a delivery call waits for a cancelled computation to end before answering pending.
CANCEL_WAIT_SECONDS=1

class PrepareRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    requestId:str=Field(pattern=r'^[A-Za-z0-9_-]{16,80}$')
    system:str
    input:dict
    saveConsent:StrictBool

def install(app,settings,vault,world,processor,clock,checked,still_current,headers):
    tasks=set();app.state.delivery_tasks=tasks;active={}
    @app.post('/api/world/runs')
    async def prepare(value:PrepareRequest,ident=Depends(checked)):
        if not settings.paid_enabled:raise HTTPException(503,'FEATURE_PAUSED')
        if value.system not in SYSTEMS:raise HTTPException(422,'INVALID_SYSTEM')
        if not value.saveConsent:raise HTTPException(422,'SAVE_CONSENT_REQUIRED')
        try:payload=await processor.validate(value.system,value.input)
        except NativeInputError as exc:raise HTTPException(422,str(exc)) from None
        except NativeUnavailable:raise HTTPException(503,'ENGINE_UNAVAILABLE') from None
        still_current(ident)
        run=vault.prepare(ident.wallet,value.requestId,value.system,payload,True,clock())
        try:checkout=await world.prepare_checkout(ident.grant,run)
        except (AuthDenied,BridgeUnavailable) as error:
            # Birth data is kept only for a checkout World admitted. An older run may already carry an order.
            if run.get('fresh'):vault.forget_unpaid(ident.wallet,run['id'])
            if isinstance(error,AuthDenied):raise HTTPException(401,'AUTH_REQUIRED') from None
            raise HTTPException(503,'CHECKOUT_UNAVAILABLE') from None
        # Checked first: a run whose buyer got no link goes at the end of its window.
        still_current(ident)
        # Another request may have removed this run while World answered: no link for a run that is gone.
        try:vault.admit(ident.wallet,run['id'])
        except Missing:raise HTTPException(503,'CHECKOUT_UNAVAILABLE') from None
        # Only after World answered: a long outage must not cost a paid order its birth data.
        vault.prune_unpaid(clock())
        return {'wallet':ident.wallet,'context':ident.context,'runId':run['id'],
            'checkoutUrl':settings.world_origin+'/fortune-checkout/?run='+run['id'],
            'expiresAt':checkout['expiresMs']}

    @app.get('/api/world/runs/{run_id}')
    async def status(run_id:str,ident=Depends(checked)):
        if not valid(run_id):raise HTTPException(404,'NOT_FOUND')
        try:run=vault.run(ident.wallet,run_id)
        except Missing:raise HTTPException(404,'NOT_FOUND') from None
        still_current(ident)
        return {'wallet':ident.wallet,'context':ident.context,'runId':run_id,'state':run['state'],'recordId':run['result_id'],'failure':run['failure']}

    async def calculate(b,claim):
        try:
            result=await processor.compute(claim['system'],claim['input'],vault.owner(b['wallet']))
            vault.complete(b['wallet'],b['runId'],claim['attempt'],result,clock())
        except NativeNondelivery:
            try:vault.fail(b['wallet'],b['runId'],claim['attempt'],'CHART_NOT_GENERATED')
            except VaultError:pass
        except (NativeUnavailable,VaultError) as error:logging.getLogger('celestao.delivery').warning('delivery_pending reason=%s',type(error).__name__)
        # Unexpected faults stay pending; a timeout/exception cannot certify
        # nondelivery. The original paid order may be recovered after its lease.
        except Exception as error:logging.getLogger('celestao.delivery').error('delivery_pending reason=%s',type(error).__name__)

    @app.post(DELIVER)
    async def deliver(request:Request):
        if request.headers.get('origin') is not None or request.url.query:raise HTTPException(403,'BACKEND_REQUIRED')
        raw=await request.body()
        if len(raw)>4096 or request.headers.get('content-type','').split(';')[0]!='application/json' or not verified(settings.delivery_secret,'request',DELIVER,request.headers.get('x-celestao-signature'),raw,clock()):raise HTTPException(401,'BACKEND_REQUIRED')
        try:
            b=json.loads(raw)
            if not isinstance(b,dict) or set(b)!={'schema','orderId','wallet','product','runId','inputHash'} or b['schema']!=SCHEMA or not valid(b['runId']) or not re.fullmatch(r'0x[0-9a-f]{64}',b['orderId']) or not re.fullmatch(r'0x[0-9a-f]{40}',b['wallet']):raise ValueError()
            run=vault.run(b['wallet'],b['runId'])
            if b['product']!='fortune-'+run['system'].replace('_','-') or b['inputHash']!=run['input_hash']:raise ValueError()
            vault.bind_order(b['wallet'],b['runId'],b['orderId'])
        except (ValueError,TypeError,KeyError):raise HTTPException(409,'ORDER_BINDING_REQUIRED') from None
        # A computation still running here keeps its attempt: a new claim would discard its result.
        # A stuck one is cancelled and replaced once it has really ended. Annual and profile wait for their
        # worker thread through a cancel, and a second one beside it would only use up the shared engine capacity.
        running=active.get(b['runId'])
        if running and clock()-running[1]>=COMPUTE_LIMIT_MS:
            logging.getLogger('celestao.delivery').error('delivery_pending reason=compute_limit')
            running[0].cancel()
            await asyncio.wait({running[0]},timeout=CANCEL_WAIT_SECONDS)
            running=active.get(b['runId'])
        claim=None if running else vault.claim(b['wallet'],b['runId'],b['orderId'],clock())
        if claim:
            run_id=b['runId'];task=asyncio.create_task(calculate(b,claim));active[run_id]=(task,clock())
            tasks.add(task);task.add_done_callback(tasks.discard)
            def release(done,run_id=run_id):
                if active.get(run_id,(None,))[0] is done:del active[run_id]
            task.add_done_callback(release)
            try:await asyncio.wait_for(asyncio.shield(task),DELIVERY_WAIT_SECONDS)
            except TimeoutError:pass
        run=vault.run(b['wallet'],b['runId'])
        envelope={k:b[k] for k in ('schema','orderId','wallet','product','runId','inputHash')}
        if run['state']=='complete':envelope.update(kind='delivered',result=vault.receipt(b['wallet'],b['runId']))
        elif run['state']=='failed' and run['failure']=='CHART_NOT_GENERATED':envelope.update(kind='terminal-failure',code='CHART_NOT_GENERATED',proof={'kind':'provider-confirmed-nondelivery','reference':b['orderId']})
        else:envelope.update(kind='pending')
        response=canonical(envelope)
        return Response(response,media_type='application/json',headers={**headers,'x-celestao-signature':signature(settings.delivery_secret,'response',DELIVER,str(clock()//1000),response)})
