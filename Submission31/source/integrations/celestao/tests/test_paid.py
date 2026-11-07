"""Paid protocol and durable retry tests; synthetic engine, no real GOLD."""
import asyncio,contextlib,io,os,sqlite3,subprocess,sys,unittest,json
from fastapi import FastAPI,HTTPException
from fastapi.responses import JSONResponse
import httpx
from test_vault import VaultFixture,A,B,KEY,INPUT,RESULT,ORDER
from celestao_world.app import make_app
from celestao_world.config import Settings
from celestao_world import paid,orders
from celestao_world.bridge import WorldBridge,BridgeUnavailable
from celestao_world.native import NativeEngine,NativeInputError,NativeUnavailable,NativeUnusable,NativeNondelivery
from celestao_world.protocol import SCHEMA,DELIVER,signature,verified
from celestao_world import vault as vault_module
from pathlib import Path
from celestao_world.vault import Missing,UNPAID_GRACE_MS,FAILED_RETENTION_MS,PRUNE_BATCH,WAIT_LIMIT_MS

NOW=1780000000000
SECRET='dedicated-fixture-delivery-secret-0123456789'
class PaidWorld:
    def __init__(self,settings):self.config=settings;self.prepares=0
    async def introspect(self,token):return {k:v for k,v in self.grant().items() if k!='bridge_session'}
    def grant(self):return {'issuer':'https://imdember.com','audience':'celestao','scope':'fortune:account','address':A,'bridge_session':'g'*43,'expires_at':NOW+3600000}
    lapsed=()
    async def prepare_checkout(self,grant,run):
        self.prepares+=1;return {'expiresMs':NOW+900000,'lapsed':run['id'] in self.lapsed}
class Processor:
    def __init__(self):self.calls=0;self.mode='ok'
    async def validate(self,system,payload):
        if self.mode=='invalid':raise NativeInputError('INVALID_CHART_INPUT')
        if self.mode=='offline':raise NativeUnavailable('ENGINE_UNAVAILABLE')
        return payload
    async def compute(self,system,payload,owner):
        self.calls+=1
        if self.mode=='offline':raise NativeUnavailable('ENGINE_UNAVAILABLE')
        if self.mode=='unusable':raise NativeUnusable('INVALID_NATIVE_RESULT')
        if self.mode=='busy-db':raise sqlite3.OperationalError('database is locked')
        if self.mode=='disk':raise OSError('no space')
        if self.mode=='timeout':raise asyncio.TimeoutError()
        if self.mode=='no-file':raise FileNotFoundError('engine data')
        if self.mode=='connection':raise ConnectionError('engine')
        if self.mode=='crash':raise RuntimeError('boom')
        if self.mode=='wrong-system':return {**RESULT,'system':'ziwei','input':payload}
        if self.mode=='rejected':raise NativeNondelivery('CHART_NOT_GENERATED')
        return {**RESULT,'system':system,'input':payload}

def engine_answering(*answers):
    """The real adapter around a stub endpoint, which gives each answer in turn: a status, an exception, or the report."""
    engine=NativeEngine.__new__(NativeEngine);left=list(answers)
    async def endpoint(model,request):
        answer=left.pop(0)
        if isinstance(answer,Exception):raise answer
        if answer==200:return JSONResponse({'result':{**RESULT,'system':'bazi','input':model}})
        return JSONResponse({'detail':'x'},status_code=answer)
    engine.charts=endpoint
    engine.model=lambda system:type('Model',(),{'model_validate':staticmethod(lambda payload:payload)})
    return engine

class EngineStatusTests(unittest.IsolatedAsyncioTestCase):
    async def outcome(self,answer):
        try:await engine_answering(answer).compute('bazi',{},'owner');return 'report'
        except ValueError as error:return type(error)
    async def test_each_engine_status_means_what_it_says_for_the_order(self):
        for statuses,expected in (((200,),'report'),((408,429,502,503,504),NativeUnavailable),((400,409,422),NativeNondelivery),((403,404,500,507),NativeUnusable)):
            for status in statuses:
                with self.subTest(status):self.assertEqual(await self.outcome(status),expected)
    async def test_an_engine_that_raises_its_status_means_the_same_as_one_that_returns_it(self):
        for status,expected in ((429,NativeUnavailable),(503,NativeUnavailable),(422,NativeNondelivery),(500,NativeUnusable)):
            with self.subTest(status):self.assertEqual(await self.outcome(HTTPException(status,'x')),expected)

class PaidTests(VaultFixture,unittest.IsolatedAsyncioTestCase):
    async def test_pausing_new_orders_preserves_paid_delivery_and_private_readback(self):
        from dataclasses import replace
        run=await self.run_fixture();cookies=self.client.cookies
        await self.client.aclose();self.vault.close()
        self.settings=replace(self.settings,paid_enabled=False)
        self.app=make_app(FastAPI(),self.settings,bridge=self.world,processor=self.processor,clock=lambda:self.time)
        self.vault=self.app.state.vault;self.sessions=self.app.state.sessions
        self.client=httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app),base_url='https://celestao.com',cookies=cookies)
        catalog=(await self.client.get('/api/world/catalog')).json();self.assertFalse(catalog['paymentsEnabled']);self.assertTrue(catalog['billingInstalled'])
        self.assertEqual((await self.prepare(requestId='paused_new_request_001')).status_code,503)
        self.assertEqual((await self.client.post('/api/charts',json=INPUT,headers=self.headers)).status_code,402)
        delivered=await self.deliver(run);self.assertEqual(delivered.json()['kind'],'delivered')
        record=delivered.json()['result']['recordId'];self.assertEqual((await self.client.get('/api/world/collections/'+record,headers=self.headers)).status_code,200)
    async def asyncSetUp(self):
        self.vault.close();self.time=NOW
        self.settings=Settings(enabled=True,paid_enabled=True,database=self.path,storage_key=KEY,bridge_secret='s'*40,delivery_secret=SECRET)
        self.world=PaidWorld(self.settings);self.processor=Processor()
        self.app=make_app(FastAPI(),self.settings,bridge=self.world,processor=self.processor,clock=lambda:self.time)
        self.vault=self.app.state.vault;self.sessions=self.app.state.sessions
        token=self.sessions.issue(self.world.grant(),NOW)
        self.client=httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app),base_url='https://celestao.com')
        self.client.cookies.set(self.settings.session_cookie,token,domain='celestao.com',path='/')
        self.headers={'origin':'https://celestao.com','x-requested-with':'CelestialAtlas','x-celestao-context':self.sessions.context(token),'x-celestao-csrf':self.sessions.csrf(token)}
    async def asyncTearDown(self):await self.client.aclose()
    async def prepare(self,**patch):
        return await self.client.post('/api/world/runs',headers=self.headers,json={'requestId':'fixture_paid_request_001','system':'bazi','input':INPUT,'saveConsent':True,**patch})
    async def deliver(self,run,*,patch=None,header=None):
        b={'schema':SCHEMA,'orderId':ORDER,'wallet':A,'product':'fortune-bazi','runId':run['id'],'inputHash':run['input_hash'],**(patch or {})}
        raw=json.dumps(b,separators=(',',':')).encode();signed=signature(SECRET,'request',DELIVER,str(self.time//1000),raw)
        return await self.client.post(DELIVER,content=raw,headers={'content-type':'application/json','x-celestao-signature':signed if header is None else header})
    async def run_fixture(self):
        response=await self.prepare();self.assertEqual(response.status_code,200)
        return self.vault.run(A,response.json()['runId'])
    async def test_a_slow_report_answers_pending_inside_worlds_timeout_and_is_delivered_later(self):
        self.assertLess(paid.DELIVERY_WAIT_SECONDS,10)
        run=await self.run_fixture();gate=asyncio.Event();compute=self.processor.compute
        async def slow(system,payload,owner):
            await gate.wait();return await compute(system,payload,owner)
        self.processor.compute=slow;wait=paid.DELIVERY_WAIT_SECONDS;paid.DELIVERY_WAIT_SECONDS=0.01
        try:first=await self.deliver(run)
        finally:paid.DELIVERY_WAIT_SECONDS=wait
        self.assertEqual(first.status_code,200);self.assertEqual(first.json()['kind'],'pending')
        gate.set();await asyncio.gather(*self.app.state.delivery_tasks)
        second=await self.deliver(run);self.assertEqual(second.json()['kind'],'delivered');self.assertEqual(self.processor.calls,1)
    async def test_a_computation_past_its_lease_is_not_restarted_and_its_result_is_kept(self):
        run=await self.run_fixture();gate=asyncio.Event();compute=self.processor.compute
        async def slow(system,payload,owner):
            await gate.wait();return await compute(system,payload,owner)
        self.processor.compute=slow;wait=paid.DELIVERY_WAIT_SECONDS;paid.DELIVERY_WAIT_SECONDS=0.01
        try:
            self.assertEqual((await self.deliver(run)).json()['kind'],'pending')
            self.time+=120001
            self.assertEqual((await self.deliver(run)).json()['kind'],'pending')
        finally:paid.DELIVERY_WAIT_SECONDS=wait
        gate.set();await asyncio.gather(*self.app.state.delivery_tasks)
        self.assertEqual((await self.deliver(run)).json()['kind'],'delivered');self.assertEqual(self.processor.calls,1)
    async def test_a_stuck_computation_is_replaced_at_its_limit_and_the_order_is_delivered(self):
        run=await self.run_fixture();compute=self.processor.compute;calls=[]
        async def stuck_once(system,payload,owner):
            calls.append(system)
            if len(calls)==1:await asyncio.Event().wait()
            return await compute(system,payload,owner)
        self.processor.compute=stuck_once;wait=paid.DELIVERY_WAIT_SECONDS;paid.DELIVERY_WAIT_SECONDS=0.01
        self.assertEqual(paid.COMPUTE_LIMIT_MS,15*60000)
        try:
            self.assertEqual((await self.deliver(run)).json()['kind'],'pending')
            self.time+=paid.COMPUTE_LIMIT_MS-1
            self.assertEqual((await self.deliver(run)).json()['kind'],'pending');self.assertEqual(len(calls),1)
            self.time+=1
            with self.assertLogs('celestao.delivery','ERROR'):
                delivered=await self.deliver(run)
        finally:paid.DELIVERY_WAIT_SECONDS=wait
        self.assertEqual(delivered.json()['kind'],'delivered');self.assertEqual(len(calls),2)
        await asyncio.gather(*self.app.state.delivery_tasks,return_exceptions=True)
    async def test_a_computation_that_ignores_cancel_gets_no_second_one_and_still_delivers(self):
        run=await self.run_fixture();compute=self.processor.compute;calls=[];release=asyncio.Event()
        async def stubborn(system,payload,owner):
            calls.append(system)
            while not release.is_set():
                try:await release.wait()
                except asyncio.CancelledError:pass
            return await compute(system,payload,owner)
        self.processor.compute=stubborn;wait=paid.DELIVERY_WAIT_SECONDS;paid.DELIVERY_WAIT_SECONDS=0.01;cancel=paid.CANCEL_WAIT_SECONDS;paid.CANCEL_WAIT_SECONDS=0.01
        try:
            self.assertEqual((await self.deliver(run)).json()['kind'],'pending')
            self.time+=paid.COMPUTE_LIMIT_MS
            for _ in range(2):
                with self.assertLogs('celestao.delivery','ERROR'):
                    self.assertEqual((await self.deliver(run)).json()['kind'],'pending')
            self.assertEqual(len(calls),1)
            release.set();await asyncio.gather(*self.app.state.delivery_tasks,return_exceptions=True)
            self.assertEqual((await self.deliver(run)).json()['kind'],'delivered');self.assertEqual(len(calls),1)
        finally:paid.DELIVERY_WAIT_SECONDS=wait;paid.CANCEL_WAIT_SECONDS=cancel
    async def test_shutdown_does_not_wait_for_ever_on_a_computation_that_ignores_cancel(self):
        from celestao_world import app as app_module
        self.assertEqual(app_module.SHUTDOWN_WAIT_SECONDS,60)
        release=asyncio.Event()
        async def stubborn():
            while not release.is_set():
                try:await release.wait()
                except asyncio.CancelledError:pass
        task=asyncio.create_task(stubborn());self.app.state.delivery_tasks.add(task)
        wait=app_module.SHUTDOWN_WAIT_SECONDS;app_module.SHUTDOWN_WAIT_SECONDS=0.01
        scope={'type':'lifespan','asgi':{'version':'3.0'},'app':self.app};events=asyncio.Queue();sent=[]
        await events.put({'type':'lifespan.startup'})
        async def send(message):
            sent.append(message['type'])
            if message['type']=='lifespan.startup.complete':await events.put({'type':'lifespan.shutdown'})
        try:await asyncio.wait_for(self.app.router.lifespan(scope,events.get,send),2)
        finally:
            app_module.SHUTDOWN_WAIT_SECONDS=wait;release.set();await task;self.app.state.delivery_tasks.discard(task)
        self.assertIn('lifespan.shutdown.complete',sent)
    async def test_a_session_ended_during_world_gives_no_link_and_the_run_leaves_at_its_expiry(self):
        original=self.world.prepare_checkout
        async def ended(grant,run):
            self.sessions.revoke(self.client.cookies.get(self.settings.session_cookie),self.time)
            return await original(grant,run)
        self.world.prepare_checkout=ended
        response=await self.prepare();self.assertEqual(response.status_code,401)
        rows=self.vault.db.execute('SELECT unadmitted FROM runs').fetchall();self.assertEqual([r['unadmitted'] for r in rows],[1])
    async def test_a_failed_repeat_leaves_the_run_the_first_request_is_still_sending(self):
        calls=[];release=asyncio.Event();original=self.world.prepare_checkout
        async def world(grant,run):
            calls.append(run['id'])
            if len(calls)==1:
                await release.wait();return await original(grant,run)
            raise BridgeUnavailable('REFUSED')
        self.world.prepare_checkout=world
        first=asyncio.create_task(self.prepare())
        while not calls:await asyncio.sleep(0)
        self.assertEqual((await self.prepare()).status_code,503)
        release.set();self.assertEqual((await first).status_code,200)
    async def test_a_failed_request_never_removes_a_run_another_request_returned(self):
        calls=[];release=asyncio.Event();original=self.world.prepare_checkout
        async def world(grant,run):
            calls.append(run['id'])
            if len(calls)==1:
                await release.wait();raise BridgeUnavailable('REFUSED')
            return await original(grant,run)
        self.world.prepare_checkout=world
        first=asyncio.create_task(self.prepare())
        while not calls:await asyncio.sleep(0)
        second=await self.prepare();self.assertEqual(second.status_code,200)
        release.set();self.assertEqual((await first).status_code,503)
        run=self.vault.run(A,second.json()['runId'])
        self.assertEqual((await self.deliver(run)).json()['kind'],'delivered')
    async def test_no_link_is_returned_for_a_run_another_request_removed(self):
        calls=[];one=asyncio.Event();two=asyncio.Event();original=self.world.prepare_checkout
        async def world(grant,run):
            calls.append(run['id'])
            if len(calls)==1:
                await one.wait();raise BridgeUnavailable('REFUSED')
            await two.wait();return await original(grant,run)
        self.world.prepare_checkout=world
        first=asyncio.create_task(self.prepare())
        while len(calls)<1:await asyncio.sleep(0)
        second=asyncio.create_task(self.prepare())
        while len(calls)<2:await asyncio.sleep(0)
        one.set();self.assertEqual((await first).status_code,503)
        two.set();self.assertEqual((await second).status_code,503)
    async def test_an_admitted_run_is_pruned_only_after_world_answers(self):
        run=await self.run_fixture()
        self.vault.db.execute('UPDATE runs SET expires_ms=? WHERE id=?',(NOW-UNPAID_GRACE_MS,run['id']))
        original=self.world.prepare_checkout
        async def refuse(grant,run):raise BridgeUnavailable('REFUSED')
        self.world.prepare_checkout=refuse
        self.assertEqual((await self.prepare(requestId='another_paid_request_01',input={**INPUT,'name':'another one'})).status_code,503)
        self.assertEqual(self.vault.run(A,run['id'])['id'],run['id'])
        self.world.prepare_checkout=original
        self.assertEqual((await self.prepare(requestId='another_paid_request_02',input={**INPUT,'name':'another two'})).status_code,200)
        with self.assertRaises(Missing):self.vault.run(A,run['id'])
    async def test_a_refused_checkout_keeps_no_new_birth_data_and_never_removes_an_older_run(self):
        original=self.world.prepare_checkout
        async def refuse(grant,run):raise BridgeUnavailable('REFUSED')
        self.world.prepare_checkout=refuse
        self.assertEqual((await self.prepare()).status_code,503)
        self.assertEqual(self.vault.db.execute('SELECT count(*) FROM runs').fetchone()[0],0)
        self.world.prepare_checkout=original
        run=await self.run_fixture()
        self.world.prepare_checkout=refuse
        self.assertEqual((await self.prepare()).status_code,503)
        self.assertEqual(self.vault.run(A,run['id'])['id'],run['id'])
    async def test_no_computation_or_save_without_consent_and_no_free_paid_bypass(self):
        self.assertEqual((await self.prepare(saveConsent=False)).status_code,422)
        self.processor.mode='invalid';self.assertEqual((await self.prepare()).status_code,422)
        self.processor.mode='offline';self.assertEqual((await self.prepare()).status_code,503)
        self.assertEqual(self.world.prepares,0);self.assertEqual(self.processor.calls,0)
        self.assertEqual(self.vault.db.execute('SELECT count(*) FROM runs').fetchone()[0],0)
        for path in ['/api/charts','/api/charts/','/api/reports','/api/reports/profile','/api/reports/profile/','/api/reports/annual-ziwei','/api/reports/annual-ziwei/']:
            r=await self.client.post(path,json=INPUT,headers=self.headers);self.assertEqual(r.status_code,402)
    async def test_signed_delivery_persists_one_original_report_and_slim_receipt(self):
        run=await self.run_fixture();self.assertEqual(self.processor.calls,0)
        self.assertEqual((await self.deliver(run,header='invalid')).status_code,401)
        self.assertEqual((await self.deliver(run,patch={'wallet':B})).status_code,409)
        self.assertEqual((await self.deliver(run,patch={'inputHash':'0'*64})).status_code,409)
        first=await self.deliver(run);self.assertEqual(first.status_code,200)
        self.assertTrue(verified(SECRET,'response',DELIVER,first.headers['x-celestao-signature'],first.content,self.time))
        envelope=first.json();self.assertEqual(envelope['kind'],'delivered');self.assertEqual(len(envelope['result']),6)
        self.assertNotIn(INPUT['date'],first.text);self.assertNotIn(INPUT['name'],first.text)
        second=await self.deliver(run);self.assertEqual(first.json(),second.json());self.assertEqual(self.processor.calls,1)
        record=envelope['result']['recordId']
        saved=await self.client.get('/api/world/collections/'+record,headers=self.headers)
        self.assertEqual(saved.json()['result']['input'],INPUT)
        status=await self.client.get('/api/world/runs/'+run['id'],headers=self.headers)
        self.assertEqual(status.json()['state'],'complete');self.assertEqual(status.json()['recordId'],record)
        self.assertEqual((await self.deliver(run,patch={'orderId':'0x'+'2'*64})).status_code,409)
        self.assertEqual(self.processor.calls,1)
    async def test_annual_ziwei_is_its_own_paid_product(self):
        response=await self.prepare(system='annual_ziwei');self.assertEqual(response.status_code,200)
        run=self.vault.run(A,response.json()['runId']);self.assertEqual(run['system'],'annual_ziwei')
        # The Zi Wei chart product cannot pay for the annual report, and the reverse.
        self.assertEqual((await self.deliver(run,patch={'product':'fortune-ziwei'})).status_code,409)
        self.assertEqual(self.processor.calls,0)
        delivered=await self.deliver(run,patch={'product':'fortune-annual-ziwei'});self.assertEqual(delivered.json()['kind'],'delivered')
        saved=await self.client.get('/api/world/collections/'+delivered.json()['result']['recordId'],headers=self.headers)
        self.assertEqual(saved.json()['result']['system'],'annual_ziwei')
    async def test_unknown_failure_is_pending_and_original_order_recovers_after_lease(self):
        run=await self.run_fixture();self.processor.mode='offline'
        first=await self.deliver(run);self.assertEqual(first.json()['kind'],'pending');self.assertNotIn('proof',first.json())
        self.assertEqual(self.vault.list(A),[])
        self.processor.mode='ok';again=await self.deliver(run);self.assertEqual(again.json()['kind'],'pending');self.assertEqual(self.processor.calls,1)
        self.time+=121000
        recovered=await self.deliver(run);self.assertEqual(recovered.json()['kind'],'delivered');self.assertEqual(len(self.vault.list(A)),1)
        self.assertEqual(self.vault.run(A,run['id'])['order_id'],ORDER)
    def runs(self):return self.vault.db.execute('SELECT COUNT(*) n FROM runs').fetchone()['n']
    async def test_a_reload_keeps_the_same_reading_on_its_one_run_so_it_cannot_be_paid_twice(self):
        first=(await self.prepare()).json()
        again=await self.prepare(requestId='fixture_paid_reloaded_02');self.assertEqual(again.status_code,200)
        self.assertEqual(again.json()['runId'],first['runId']);self.assertEqual(again.json()['checkoutUrl'],first['checkoutUrl']);self.assertEqual(self.runs(),1);self.assertEqual(self.world.prepares,2)
        other=await self.prepare(requestId='fixture_paid_reloaded_03',input={**INPUT,'name':'another traveler'});self.assertNotEqual(other.json()['runId'],first['runId'])
        system=await self.prepare(requestId='fixture_paid_reloaded_04',system='ziwei');self.assertNotEqual(system.json()['runId'],first['runId']);self.assertEqual(self.runs(),3)
    async def test_a_reload_after_paying_returns_the_paid_run_and_computes_nothing_more(self):
        run=await self.run_fixture();done=await self.deliver(run);self.assertEqual(done.json()['kind'],'delivered');self.assertEqual(self.processor.calls,1)
        again=await self.prepare(requestId='fixture_paid_reloaded_02');self.assertEqual(again.json()['runId'],run['id']);self.assertEqual(self.runs(),1);self.assertEqual(self.processor.calls,1)
    async def test_another_wallet_never_gets_this_wallets_run(self):
        run=self.vault.prepare(A,'fixture_paid_request_a1','bazi',INPUT,True,NOW);other=self.vault.prepare(B,'fixture_paid_request_a1','bazi',INPUT,True,NOW)
        self.assertNotEqual(run['id'],other['id']);self.assertTrue(other['fresh'])
    async def test_a_refunded_reading_can_be_bought_again_on_a_new_run(self):
        run=await self.run_fixture();self.processor.mode='rejected'
        self.assertEqual((await self.deliver(run)).json()['kind'],'terminal-failure')
        self.assertNotEqual((await self.prepare(requestId='fixture_paid_reloaded_02')).json()['runId'],run['id'])
    async def test_a_refunded_reading_can_be_bought_again_with_the_request_the_page_kept(self):
        # Audit 447bb70d: a page restored from history keeps its request id.
        run=await self.run_fixture();self.processor.mode='rejected'
        self.assertEqual((await self.deliver(run)).json()['kind'],'terminal-failure')
        again=await self.prepare();self.assertEqual(again.status_code,200);self.assertNotEqual(again.json()['runId'],run['id'])
        self.assertEqual((await self.prepare()).json()['runId'],again.json()['runId'])
        self.assertEqual(self.vault.run(A,run['id'])['state'],'failed')
        late=await self.deliver(run);self.assertEqual((late.json()['kind'],late.json()['code']),('terminal-failure','CHART_NOT_GENERATED'))
    async def test_a_request_the_page_must_not_repeat_is_not_reported_as_a_storage_outage(self):
        # Audit 447bb70d: a conflict is permanent, so it is 409, not the 503 that invites a retry.
        self.assertEqual((await self.prepare()).status_code,200)
        for _ in range(2):
            conflict=await self.prepare(system='ziwei');self.assertEqual((conflict.status_code,conflict.json()),(409,{'detail':'IDEMPOTENCY_CONFLICT'}))
        original=self.vault.prepare
        def busy(*_):raise vault_module.VaultError('STORAGE_BUSY')
        self.vault.prepare=busy
        try:
            outage=await self.prepare(requestId='fixture_paid_storage_01');self.assertEqual((outage.status_code,outage.json()['error']),(503,'STORAGE_UNAVAILABLE'))
        finally:self.vault.prepare=original
        for code in ('INVALID_REQUEST','INPUT_TOO_LARGE','DOCUMENT_TOO_LARGE'):
            def refuse(*_,code=code):raise vault_module.VaultError(code)
            self.vault.prepare=refuse
            try:
                refused=await self.prepare(requestId='fixture_paid_refused_01');self.assertEqual((refused.status_code,refused.json()),(422,{'detail':code}))
            finally:self.vault.prepare=original
    async def test_a_lapsed_quote_gets_a_new_run_for_the_same_request_and_any_later_reload(self):
        old=await self.run_fixture();self.world.lapsed=(old['id'],)
        fresh=await self.prepare();self.assertEqual(fresh.status_code,200);new=fresh.json()['runId'];self.assertNotEqual(new,old['id'])
        self.assertIn(new,fresh.json()['checkoutUrl']);self.assertEqual(self.vault.db.execute('SELECT unadmitted FROM runs WHERE id=?',(new,)).fetchone()['unadmitted'],None)
        self.assertEqual((await self.prepare()).json()['runId'],new);self.assertEqual((await self.prepare(requestId='fixture_paid_reloaded_02')).json()['runId'],new);self.assertEqual(self.runs(),2)
    async def test_a_retired_run_is_still_delivered_if_an_order_for_it_was_paid_after_all(self):
        old=await self.run_fixture();self.world.lapsed=(old['id'],);await self.prepare()
        done=await self.deliver(old);self.assertEqual(done.json()['kind'],'delivered');self.assertEqual(self.vault.run(A,old['id'])['state'],'complete')
    async def test_world_saying_lapsed_about_a_run_with_an_order_makes_no_second_run(self):
        run=await self.run_fixture();self.vault.bind_order(A,run['id'],ORDER);self.world.lapsed=(run['id'],)
        before=self.world.prepares
        response=await self.prepare();self.assertEqual(response.status_code,503);self.assertEqual(response.json()['detail'],'CHECKOUT_UNAVAILABLE');self.assertEqual(self.runs(),1);self.assertEqual(self.world.prepares,before+1)
    async def test_only_a_real_true_replaces_a_run(self):
        run=await self.run_fixture();original=self.world.prepare_checkout
        async def odd(grant,value):
            await original(grant,value);return {'expiresMs':NOW+900000,'lapsed':'yes'}
        self.world.prepare_checkout=odd
        self.assertEqual((await self.prepare()).json()['runId'],run['id']);self.assertEqual(self.runs(),1)
    async def test_a_session_ended_while_world_says_lapsed_makes_no_new_run(self):
        old=await self.run_fixture();original=self.world.prepare_checkout
        async def ended(grant,run):
            self.sessions.revoke(self.client.cookies.get(self.settings.session_cookie),self.time)
            await original(grant,run);return {'expiresMs':NOW+900000,'lapsed':True}
        self.world.prepare_checkout=ended
        self.assertEqual((await self.prepare()).status_code,401);self.assertEqual(self.runs(),1);self.assertEqual(self.vault.prepare(A,'fixture_paid_request_001','bazi',INPUT,True,self.time)['id'],old['id'])
    async def test_a_lapsed_run_another_request_removed_still_gets_a_new_run(self):
        old=await self.run_fixture();original=self.world.prepare_checkout
        async def gone(grant,run):
            await original(grant,run)
            if run['id']!=old['id']:return {'expiresMs':NOW+900000,'lapsed':False}
            self.vault.db.execute('DELETE FROM runs WHERE id=?',(run['id'],));return {'expiresMs':NOW+900000,'lapsed':True}
        self.world.prepare_checkout=gone
        response=await self.prepare();self.assertEqual(response.status_code,200);self.assertNotEqual(response.json()['runId'],old['id'])
    async def test_a_reload_after_a_retired_run_was_paid_returns_that_run_not_the_new_one(self):
        old=await self.run_fixture();self.world.lapsed=(old['id'],);new=(await self.prepare()).json()['runId'];self.world.lapsed=()
        self.assertEqual((await self.deliver(old)).json()['kind'],'delivered')
        self.assertEqual((await self.prepare(requestId='fixture_paid_reloaded_02')).json()['runId'],old['id']);self.assertNotEqual(new,old['id'])
    async def test_lapsed_runs_are_replaced_a_bounded_number_of_times_and_a_later_request_gets_further(self):
        calls=[];original=self.world.prepare_checkout
        async def always(grant,run):
            calls.append(run['id']);await original(grant,run);return {'expiresMs':NOW+900000,'lapsed':True}
        self.world.prepare_checkout=always
        response=await self.prepare();self.assertEqual(response.status_code,503);self.assertEqual(len(calls),paid.LAPSED_RUN_TRIES);self.assertEqual(len(set(calls)),paid.LAPSED_RUN_TRIES)
        self.world.prepare_checkout=original;self.assertEqual((await self.prepare()).status_code,200)
    async def test_a_retired_run_leaves_with_the_other_unpaid_data(self):
        old=await self.run_fixture();self.world.lapsed=(old['id'],);await self.prepare()
        self.vault.prune_unpaid(old['expires_ms']+UNPAID_GRACE_MS)
        with self.assertRaises(Missing):self.vault.run(A,old['id'])
    async def test_a_report_over_the_size_limit_is_refunded_at_once_and_not_computed_again(self):
        run=await self.run_fixture();limit=vault_module.MAX_REPORT_BYTES;vault_module.MAX_REPORT_BYTES=100
        try:
            first=await self.deliver(run);self.assertEqual(first.json()['kind'],'terminal-failure');self.assertEqual(first.json()['code'],'CHART_NOT_GENERATED')
            self.assertEqual(first.json()['proof'],{'kind':'provider-confirmed-nondelivery','reference':ORDER})
            self.assertEqual(self.vault.list(A),[]);self.assertEqual(self.vault.run(A,run['id'])['state'],'failed')
            self.time+=130000;second=await self.deliver(run);self.assertEqual(second.json()['kind'],'terminal-failure');self.assertEqual(self.processor.calls,1)
        finally:vault_module.MAX_REPORT_BYTES=limit
    async def test_other_storage_errors_stay_pending_rather_than_refunding_a_report_that_may_save(self):
        run=await self.run_fixture();complete=self.vault.complete
        def broken(*args):raise vault_module.VaultError('DOCUMENT_AUTHENTICATION_FAILED')
        self.vault.complete=broken
        try:self.assertEqual((await self.deliver(run)).json()['kind'],'pending')
        finally:self.vault.complete=complete
    async def attempts(self,run,count):
        kinds=[]
        for _ in range(count):
            kinds.append((await self.deliver(run)).json()['kind']);self.time+=121000
        return kinds
    async def test_attempts_that_save_no_report_end_in_a_refund_and_a_new_purchase_is_possible(self):
        for mode in ('unusable','crash','wrong-system'):
            with self.subTest(mode):
                requested='fixture_'+mode.replace('-','_')+'_request_1';response=await self.prepare(requestId=requested,input={**INPUT,'name':mode});run=self.vault.run(A,response.json()['runId'])
                order='0x'+format(len(mode),'064x');self.processor.mode=mode;self.processor.calls=0
                self.assertEqual(await self.attempts_on(run,order,3),['pending','pending','terminal-failure'])
                self.assertEqual(self.processor.calls,3);self.assertEqual(self.vault.run(A,run['id'])['state'],'failed')
                self.assertEqual(await self.attempts_on(run,order,1),['terminal-failure']);self.assertEqual(self.processor.calls,3)
                self.time=NOW;again=await self.prepare(requestId=requested+'_2',input={**INPUT,'name':mode});self.assertNotEqual(again.json()['runId'],run['id'])
        self.assertEqual(self.vault.list(A),[])
    async def attempts_on(self,run,order,count):
        kinds=[]
        for _ in range(count):
            kinds.append((await self.deliver(run,patch={'orderId':order})).json()['kind']);self.time+=1900000
        return kinds
    def waited(self,rid):
        return self.vault.db.execute('SELECT state,failure,failed_attempts,first_waited_ms FROM runs WHERE id=?',(rid,)).fetchone()
    async def test_a_fault_that_never_counts_ends_after_a_day(self):
        for number,mode in enumerate(('offline','busy-db','disk','timeout','no-file','connection')):
            with self.subTest(mode):
                self.time=NOW;self.processor.mode='ok'
                response=await self.prepare(requestId='fixture_wait_request_'+str(number),input={**INPUT,'name':mode});run=self.vault.run(A,response.json()['runId'])
                order='0x'+format(number+900,'064x');self.processor.mode=mode
                self.assertEqual((await self.deliver(run,patch={'orderId':order})).json()['kind'],'pending')
                self.time=NOW+WAIT_LIMIT_MS-1
                self.assertEqual((await self.deliver(run,patch={'orderId':order})).json()['kind'],'pending')
                self.time+=121000
                answer=(await self.deliver(run,patch={'orderId':order})).json()
                self.assertEqual((answer['kind'],answer['code']),('terminal-failure','CHART_NOT_GENERATED'))
                self.assertEqual(self.waited(run['id'])['failed_attempts'],0);self.assertEqual(self.waited(run['id'])['state'],'failed')
    async def test_the_wait_is_measured_from_the_first_fault_to_the_millisecond(self):
        run=await self.run_fixture();self.vault.bind_order(A,run['id'],ORDER)
        attempt=self.vault.claim(A,run['id'],ORDER,NOW)['attempt']
        self.assertIs(self.vault.note_wait(A,run['id'],attempt,NOW),False)
        self.assertIs(self.vault.note_wait(A,run['id'],attempt,NOW+WAIT_LIMIT_MS-1),False)
        self.assertEqual(self.waited(run['id'])['first_waited_ms'],NOW);self.assertEqual(self.waited(run['id'])['state'],'working')
        self.assertIs(self.vault.note_wait(A,run['id'],attempt,NOW+WAIT_LIMIT_MS),True)
        self.assertEqual(self.waited(run['id'])['state'],'failed');self.assertEqual(self.waited(run['id'])['failure'],'CHART_NOT_GENERATED')
        self.assertEqual(WAIT_LIMIT_MS,86400000)
    async def test_a_wait_counts_only_for_the_attempt_still_running(self):
        run=await self.run_fixture();self.vault.bind_order(A,run['id'],ORDER)
        attempt=self.vault.claim(A,run['id'],ORDER,NOW)['attempt'];far=NOW+WAIT_LIMIT_MS*2
        self.assertIs(self.vault.note_wait(A,run['id'],'other',NOW),False)
        self.assertIs(self.vault.note_wait(B,run['id'],attempt,NOW),False)
        self.assertIsNone(self.waited(run['id'])['first_waited_ms'])
        self.assertIs(self.vault.note_wait(A,run['id'],attempt,NOW),False)
        self.vault.complete(A,run['id'],attempt,{**RESULT,'system':'bazi','input':INPUT},NOW)
        self.assertIs(self.vault.note_wait(A,run['id'],attempt,far),False);self.assertEqual(self.waited(run['id'])['state'],'complete')
    async def test_a_report_that_saves_late_in_the_wait_is_delivered_and_not_refunded(self):
        run=await self.run_fixture();self.processor.mode='offline'
        self.assertEqual((await self.deliver(run)).json()['kind'],'pending');self.time+=WAIT_LIMIT_MS-1
        self.processor.mode='ok';self.assertEqual((await self.deliver(run)).json()['kind'],'delivered');self.assertEqual(len(self.vault.list(A)),1)
    async def test_a_database_that_cannot_count_the_wait_leaves_the_order_pending(self):
        run=await self.run_fixture();self.processor.mode='offline';note=self.vault.note_wait
        def broken(*args):raise sqlite3.OperationalError('database is locked')
        self.vault.note_wait=broken
        try:self.assertEqual((await self.deliver(run)).json()['kind'],'pending')
        finally:self.vault.note_wait=note
    async def test_a_status_nobody_expects_is_an_attempt_not_a_refund(self):
        run=await self.run_fixture();self.processor.compute=engine_answering(500,200).compute
        self.assertEqual((await self.deliver(run)).json()['kind'],'pending');self.assertEqual(self.waited(run['id'])['failed_attempts'],1)
        self.time+=121000;self.assertEqual((await self.deliver(run)).json()['kind'],'delivered')
    async def test_an_engine_refusal_is_refunded_at_once(self):
        run=await self.run_fixture();self.processor.compute=engine_answering(422).compute
        answer=(await self.deliver(run)).json();self.assertEqual(answer['kind'],'terminal-failure');self.assertEqual(self.waited(run['id'])['failed_attempts'],0)
    async def test_an_engine_raising_busy_never_counts_against_the_order(self):
        run=await self.run_fixture();self.processor.compute=engine_answering(HTTPException(429,'x'),HTTPException(503,'x'),200).compute
        self.assertEqual((await self.deliver(run)).json()['kind'],'pending');self.time+=121000
        self.assertEqual((await self.deliver(run)).json()['kind'],'pending');self.time+=121000
        self.assertEqual((await self.deliver(run)).json()['kind'],'delivered');self.assertEqual(self.waited(run['id'])['failed_attempts'],0)
    async def test_a_computation_that_can_be_cancelled_still_ends_after_a_day_of_hanging(self):
        run=await self.run_fixture();wait=paid.DELIVERY_WAIT_SECONDS;paid.DELIVERY_WAIT_SECONDS=0.01
        async def hang(system,payload,owner):await asyncio.Event().wait()
        self.processor.compute=hang
        try:
            self.assertEqual((await self.deliver(run)).json()['kind'],'pending');self.time+=paid.COMPUTE_LIMIT_MS
            self.assertEqual((await self.deliver(run)).json()['kind'],'pending');first=self.waited(run['id'])['first_waited_ms'];self.assertEqual(first,self.time)
            self.time=first+WAIT_LIMIT_MS-1;self.assertEqual((await self.deliver(run)).json()['kind'],'pending')
            self.time+=paid.COMPUTE_LIMIT_MS;self.assertEqual((await self.deliver(run)).json()['kind'],'terminal-failure')
            self.assertEqual(self.waited(run['id'])['state'],'failed')
        finally:paid.DELIVERY_WAIT_SECONDS=wait
        await asyncio.sleep(0)
    async def test_a_computation_that_cannot_be_cancelled_ends_after_a_day_and_its_late_report_is_dropped(self):
        run=await self.run_fixture();wait,cancel=paid.DELIVERY_WAIT_SECONDS,paid.CANCEL_WAIT_SECONDS;paid.DELIVERY_WAIT_SECONDS=paid.CANCEL_WAIT_SECONDS=0.01;gate=asyncio.Event();compute=self.processor.compute
        async def thread(system,payload,owner):
            while not gate.is_set():
                try:await gate.wait()
                except asyncio.CancelledError:pass
            return await compute(system,payload,owner)
        self.processor.compute=thread
        try:
            self.assertEqual((await self.deliver(run)).json()['kind'],'pending');self.time+=paid.COMPUTE_LIMIT_MS
            self.assertEqual((await self.deliver(run)).json()['kind'],'pending');first=self.waited(run['id'])['first_waited_ms']
            self.time=first+WAIT_LIMIT_MS;self.assertEqual((await self.deliver(run)).json()['kind'],'terminal-failure')
        finally:paid.DELIVERY_WAIT_SECONDS,paid.CANCEL_WAIT_SECONDS=wait,cancel;gate.set()
        await asyncio.sleep(0.05)
        self.assertEqual(self.vault.list(A),[]);self.assertEqual(self.waited(run['id'])['state'],'failed')
    async def test_a_report_that_saves_after_failed_attempts_is_delivered_normally(self):
        run=await self.run_fixture();self.processor.mode='crash'
        self.assertEqual(await self.attempts(run,2),['pending','pending'])
        self.processor.mode='ok';self.assertEqual((await self.deliver(run)).json()['kind'],'delivered');self.assertEqual(len(self.vault.list(A)),1)
    async def test_a_burst_of_failures_inside_the_hour_refunds_nothing(self):
        run=await self.run_fixture();self.processor.mode='crash'
        self.assertEqual(set(await self.attempts(run,20)),{'pending'});self.assertLess(self.time-NOW,3600000);self.assertEqual(self.vault.db.execute('SELECT failed_attempts FROM runs').fetchone()['failed_attempts'],20)
    async def test_a_full_disk_or_a_busy_database_never_counts_against_the_order(self):
        for mode in ('busy-db','disk'):
            with self.subTest(mode):
                self.time=NOW;response=await self.prepare(requestId='fixture_'+mode.replace('-','_')+'_request_1',input={**INPUT,'name':mode});run=self.vault.run(A,response.json()['runId'])
                order='0x'+format(len(mode)+40,'064x');self.processor.mode=mode
                self.assertEqual(set(await self.attempts_on(run,order,4)),{'pending'});self.assertEqual(self.vault.db.execute('SELECT failed_attempts FROM runs WHERE id=?',(run['id'],)).fetchone()['failed_attempts'],0)
    async def test_a_failure_recording_the_failure_leaves_the_order_pending(self):
        run=await self.run_fixture();self.processor.mode='crash';strike=self.vault.strike
        def broken(*args):raise sqlite3.OperationalError('database is locked')
        self.vault.strike=broken
        try:self.assertEqual((await self.deliver(run)).json()['kind'],'pending')
        finally:self.vault.strike=strike
    async def test_a_cancelled_computation_does_not_count_against_the_order(self):
        run=await self.run_fixture();compute=self.processor.compute;wait=paid.DELIVERY_WAIT_SECONDS;paid.DELIVERY_WAIT_SECONDS=0.01;gate=asyncio.Event()
        async def hang(system,payload,owner):
            await gate.wait();return await compute(system,payload,owner)
        self.processor.compute=hang
        try:
            self.assertEqual((await self.deliver(run)).json()['kind'],'pending');self.time+=paid.COMPUTE_LIMIT_MS;self.assertEqual((await self.deliver(run)).json()['kind'],'pending')
            self.assertEqual(self.vault.db.execute('SELECT failed_attempts FROM runs').fetchone()['failed_attempts'],0)
        finally:gate.set();paid.DELIVERY_WAIT_SECONDS=wait;self.processor.compute=compute
    def test_the_real_engine_raises_the_error_that_counts(self):
        source=(Path(paid.__file__).parent/'native.py').read_text(encoding='utf-8');self.assertIn("raise NativeUnusable('INVALID_NATIVE_RESULT')",source);self.assertNotIn("NativeUnavailable('INVALID_NATIVE_RESULT')",source)
        self.assertTrue(issubclass(NativeUnusable,NativeUnavailable))
    async def test_an_engine_that_is_only_away_never_refunds_however_long_it_takes(self):
        run=await self.run_fixture();self.processor.mode='offline'
        self.assertEqual(set(await self.attempts(run,8)),{'pending'});self.assertEqual(self.vault.db.execute('SELECT failed_attempts FROM runs').fetchone()['failed_attempts'],0)
        self.processor.mode='ok';self.assertEqual((await self.deliver(run)).json()['kind'],'delivered')
    async def test_a_hung_computation_is_never_refunded_automatically(self):
        run=await self.run_fixture();gate=asyncio.Event();compute=self.processor.compute;wait=paid.DELIVERY_WAIT_SECONDS;paid.DELIVERY_WAIT_SECONDS=0.01
        async def hang(system,payload,owner):
            await asyncio.shield(gate.wait());return await compute(system,payload,owner)
        self.processor.compute=hang
        try:
            self.assertEqual(set(await self.attempts(run,4)),{'pending'});self.assertEqual(self.vault.run(A,run['id'])['state'],'working')
        finally:gate.set();paid.DELIVERY_WAIT_SECONDS=wait;self.processor.compute=compute;await asyncio.sleep(0)
    async def test_a_lost_lease_does_not_count_against_the_order(self):
        run=await self.run_fixture();self.vault.bind_order(A,run['id'],ORDER);claim=self.vault.claim(A,run['id'],ORDER,self.time);self.time+=121000;newer=self.vault.claim(A,run['id'],ORDER,self.time)
        self.assertFalse(self.vault.strike(A,run['id'],claim['attempt'],self.time));self.assertEqual(self.vault.db.execute('SELECT failed_attempts FROM runs').fetchone()['failed_attempts'],0)
        for _ in range(2):self.assertFalse(self.vault.strike(A,run['id'],newer['attempt'],self.time))
        self.assertTrue(self.vault.strike(A,run['id'],newer['attempt'],self.time+3600000));self.assertFalse(self.vault.strike(A,run['id'],newer['attempt'],self.time+3600000))
    async def test_a_run_simply_not_found_is_refused_because_the_database_may_be_the_wrong_one(self):
        run=await self.run_fixture();self.vault.db.execute('DELETE FROM runs WHERE id=?',(run['id'],))
        self.assertEqual((await self.deliver(run)).status_code,409)
    async def test_a_saved_report_in_another_database_gets_no_refund_from_an_empty_one(self):
        run=await self.run_fixture();self.assertEqual((await self.deliver(run)).json()['kind'],'delivered')
        self.vault.db.execute('DELETE FROM records');self.vault.db.execute('DELETE FROM runs')
        self.assertEqual((await self.deliver(run)).status_code,409)
    async def cleared(self):
        run=await self.run_fixture();self.vault.bind_order(A,run['id'],ORDER);self.vault.abandon(ORDER);self.vault.prune_failed(self.time)
        self.assertEqual(self.vault.prune_failed(self.time+FAILED_RETENTION_MS),1);return run
    async def test_a_cleared_order_still_answers_terminal_failure_so_a_late_refund_is_never_stuck(self):
        run=await self.cleared()
        for _ in range(2):
            with self.assertLogs('celestao.delivery','ERROR'):response=await self.deliver(run)
            self.assertEqual(response.status_code,200);self.assertEqual(response.json()['kind'],'terminal-failure');self.assertEqual(response.json()['proof'],{'kind':'provider-confirmed-nondelivery','reference':ORDER})
    async def test_the_buyer_is_told_a_run_was_cleared_and_nobody_else_is(self):
        run=await self.cleared()
        body=(await self.client.get('/api/world/runs/'+run['id'],headers=self.headers)).json()
        self.assertEqual((body['state'],body['recordId'],body['failure'],body['runId']),('cleared',None,None,run['id']))
        self.assertEqual((await self.client.get('/api/world/runs/'+'x'*43,headers=self.headers)).status_code,404)
        self.vault.db.execute('UPDATE pruned_runs SET owner=?',(self.vault.owner(B),))
        self.assertEqual((await self.client.get('/api/world/runs/'+run['id'],headers=self.headers)).status_code,404)
    async def lifespan(self,app):
        scope={'type':'lifespan','asgi':{'version':'3.0'},'app':app};events=asyncio.Queue();sent=[]
        await events.put({'type':'lifespan.startup'})
        async def send(message):
            sent.append(message['type'])
            if message['type']=='lifespan.startup.complete':
                await asyncio.sleep(0);await asyncio.sleep(0);await events.put({'type':'lifespan.shutdown'})
        await asyncio.wait_for(app.router.lifespan(scope,events.get,send),5)
        self.assertIn('lifespan.shutdown.complete',sent)
    async def test_starting_the_server_clears_what_is_due_and_stopping_it_ends_the_cleaner(self):
        run=await self.run_fixture();self.vault.bind_order(A,run['id'],ORDER);self.vault.abandon(ORDER);self.vault.prune_failed(self.time);self.time+=FAILED_RETENTION_MS
        opened=self.vault;rows=[];original=opened.prune_failed
        def spy(now):
            value=original(now);rows.append((now,value,opened.db.execute('SELECT COUNT(*) FROM pruned_runs').fetchone()[0]));return value
        opened.prune_failed=spy
        await self.lifespan(self.app)
        self.assertEqual(rows,[(self.time,1,1)])
        await asyncio.sleep(0)
        self.assertEqual([t for t in asyncio.all_tasks() if t.get_coro().__name__=='clear_failed_runs'],[])
    async def test_a_server_without_a_vault_has_no_cleaner(self):
        from dataclasses import replace
        app=make_app(FastAPI(),replace(self.settings,enabled=False,paid_enabled=False,delivery_secret=None),bridge=self.world)
        with self.assertNoLogs('celestao.delivery','ERROR'):await self.lifespan(app)
    async def test_the_cleaner_waits_an_hour_finishes_a_full_batch_first_and_survives_an_error(self):
        from celestao_world import app as app_module
        self.assertEqual(app_module.CLEANER_SECONDS,3600)
        class Stop(BaseException):pass
        answers=[sqlite3.OperationalError('database is locked'),PRUNE_BATCH,1,0];waits=[];seen=[]
        class Fake:
            def prune_failed(self,now):
                seen.append(now);value=answers.pop(0)
                if isinstance(value,Exception):raise value
                return value
        async def wait(seconds):
            waits.append(seconds)
            if not answers:raise Stop()
        with self.assertLogs('celestao.delivery','ERROR') as logs,self.assertRaises(Stop):await app_module.clear_failed_runs(Fake(),lambda:self.time,wait)
        self.assertEqual(seen,[self.time]*4);self.assertEqual(waits,[3600,0,3600,3600]);self.assertIn('OperationalError',logs.output[0]);self.assertNotIn('locked',logs.output[0])
    async def test_a_paid_order_whose_run_was_pruned_is_refunded_rather_than_refused_for_ever(self):
        run=await self.run_fixture();self.vault.prune_unpaid(run['expires_ms']+UNPAID_GRACE_MS)
        with self.assertLogs('celestao.delivery','ERROR') as logs:response=await self.deliver(run)
        self.assertEqual(response.status_code,200);self.assertEqual(response.json()['kind'],'terminal-failure');self.assertIn(ORDER,logs.output[0])
        self.assertEqual(response.json()['proof'],{'kind':'provider-confirmed-nondelivery','reference':ORDER})
        self.assertTrue(verified(SECRET,'response',DELIVER,response.headers['x-celestao-signature'],response.content,self.time))
    async def test_a_mismatch_on_a_run_that_exists_is_still_refused_not_refunded(self):
        run=await self.run_fixture()
        self.assertEqual((await self.deliver(run,patch={'wallet':B})).status_code,409)
        self.vault.prune_unpaid(run['expires_ms']+UNPAID_GRACE_MS);self.assertEqual((await self.deliver(run,patch={'wallet':B})).status_code,409);run=await self.run_fixture()
        self.assertEqual((await self.deliver(run,patch={'inputHash':'f'*64})).status_code,409);self.assertEqual((await self.deliver(run,patch={'product':'fortune-ziwei'})).status_code,409)
    def tool(self,*args):
        out=io.StringIO();err=io.StringIO()
        with contextlib.redirect_stdout(out),contextlib.redirect_stderr(err):code=orders.main(list(args),settings=self.settings)
        return code,out.getvalue(),err.getvalue()
    async def test_the_operator_tool_lists_stuck_orders_without_private_data(self):
        run=await self.run_fixture();self.assertEqual(json.loads(self.tool('list')[1]),[])
        self.processor.mode='offline';await self.deliver(run)
        code,out,_=self.tool('list');self.assertEqual(code,0);rows=json.loads(out);self.assertEqual([r['order_id'] for r in rows],[ORDER]);self.assertEqual(set(rows[0]),{'order_id','system','state','created_ms','lease_ms','failed_attempts'})
        self.assertNotIn(A,out);self.assertNotIn(INPUT['name'],out)
    async def test_the_operator_tool_ends_a_hung_order_and_the_late_result_cannot_save(self):
        run=await self.run_fixture();gate=asyncio.Event();compute=self.processor.compute;wait=paid.DELIVERY_WAIT_SECONDS;paid.DELIVERY_WAIT_SECONDS=0.01
        async def hang(system,payload,owner):
            await gate.wait();return await compute(system,payload,owner)
        self.processor.compute=hang
        try:
            self.assertEqual((await self.deliver(run)).json()['kind'],'pending')
            self.assertEqual(self.tool('refund',ORDER)[0],0)
            task=next(iter(self.app.state.delivery_tasks))
            self.assertEqual((await self.deliver(run)).json()['kind'],'terminal-failure')
            await asyncio.wait({task},timeout=1);self.assertTrue(task.cancelled())
            gate.set()
            self.assertEqual(self.vault.list(A),[]);self.assertEqual(self.vault.run(A,run['id'])['state'],'failed')
            self.assertEqual(self.tool('refund',ORDER)[1].strip(),'ALREADY_FAILED')
        finally:gate.set();paid.DELIVERY_WAIT_SECONDS=wait;self.processor.compute=compute
    async def test_a_result_arriving_after_the_operator_ended_the_order_cannot_save(self):
        run=await self.run_fixture();self.vault.bind_order(A,run['id'],ORDER);claim=self.vault.claim(A,run['id'],ORDER,self.time);self.assertEqual(self.tool('refund',ORDER)[0],0)
        with self.assertRaisesRegex(vault_module.VaultError,'LEASE_LOST'):self.vault.complete(A,run['id'],claim['attempt'],RESULT,self.time)
        self.assertEqual(self.vault.list(A),[])
    async def test_the_operator_tool_lists_a_bound_order_not_started_and_works_as_a_module(self):
        run=await self.run_fixture();self.vault.bind_order(A,run['id'],ORDER);self.assertEqual([r['order_id'] for r in json.loads(self.tool('list')[1])],[ORDER])
        env={**os.environ,'CELESTAO_WORLD_ENABLED':'1','CELESTAO_WORLD_STORAGE_KEY':KEY.hex(),'CELESTAO_WORLD_DATA_DIR':str(self.path.parent),'CELESTAO_BRIDGE_SECRET':'s'*40,'CELESTAO_DELIVERY_SECRET':SECRET,'PYTHONPATH':os.pathsep.join(sys.path)}
        def module(*args,**extra):return subprocess.run([sys.executable,'-m','celestao_world.orders',*args],capture_output=True,text=True,env={**env,**extra},timeout=60)
        self.assertEqual(module('list').returncode,0);self.assertEqual(module('refund','0x'+'9'*64).returncode,1);self.assertEqual(module('list',CELESTAO_WORLD_ENABLED='0').returncode,2)
    async def test_the_operator_tool_answers_cleanly_when_the_database_is_busy(self):
        for command,method in ((('list',),'stuck'),(('refund',ORDER),'abandon')):
            with self.subTest(method):
                original=getattr(vault_module.Vault,method)
                def busy(*args):raise sqlite3.OperationalError('database is locked')
                setattr(vault_module.Vault,method,busy)
                try:code,_,err=self.tool(*command)
                finally:setattr(vault_module.Vault,method,original)
                self.assertEqual(code,1);self.assertIn('locked',err)
    async def test_the_operator_tool_warns_only_when_the_database_has_no_runs(self):
        code,out,err=self.tool('list');self.assertEqual((code,json.loads(out)),(0,[]));self.assertIn('no runs at all',err)
        await self.run_fixture();code,out,err=self.tool('list');self.assertEqual((code,json.loads(out),err),(0,[],''))
    async def test_the_operator_tool_refuses_a_saved_report_an_unknown_order_and_bad_input(self):
        run=await self.run_fixture();self.assertEqual((await self.deliver(run)).json()['kind'],'delivered')
        self.assertEqual(json.loads(self.tool('list')[1]),[])
        code,_,err=self.tool('refund',ORDER);self.assertEqual(code,1);self.assertIn('REPORT_SAVED',err);self.assertEqual(self.vault.run(A,run['id'])['state'],'complete')
        code,_,err=self.tool('refund','0x'+'9'*64);self.assertEqual(code,1);self.assertIn('NOT_FOUND',err)
        code,_,err=self.tool('refund','nonsense');self.assertEqual(code,1);self.assertIn('INVALID_ORDER',err)
    async def test_confirmed_nondelivery_is_terminal_and_never_creates_a_report(self):
        run=await self.run_fixture();self.processor.mode='rejected'
        first=await self.deliver(run);self.assertEqual(first.json()['kind'],'terminal-failure')
        self.assertEqual(first.json()['proof'],{'kind':'provider-confirmed-nondelivery','reference':ORDER})
        self.assertEqual(self.vault.list(A),[])
        second=await self.deliver(run);self.assertEqual(second.json(),first.json());self.assertEqual(self.processor.calls,1)
