"""Same-origin wallet API mounted ahead of the unchanged Celestao application.

The API never accepts a browser-supplied wallet as authority. Provider/payment
installation is an independent gate; this identity/collection layer cannot pay.
"""
from dataclasses import dataclass
from contextlib import asynccontextmanager
import asyncio
from pathlib import Path
import json,logging,re,time
from fastapi import FastAPI,APIRouter,Depends,HTTPException,Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse,RedirectResponse,FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel,ConfigDict
from starlette.middleware.trustedhost import TrustedHostMiddleware
from .bridge import WorldBridge,AuthDenied,BridgeUnavailable
from .config import Settings
from .sessions import Sessions,valid
from .vault import Vault,VaultError,Missing,PRUNE_BATCH
from .limits import WalletLimits

CATALOG=Path(__file__).resolve().parents[1]/'fortune_catalog.json'
HEADERS={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'}
CSP="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"

class StartRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    language:str='zh'

@dataclass
class Identity:
    token:str
    wallet:str
    expires:int
    context:str
    csrf:str
    grant:dict

SHUTDOWN_WAIT_SECONDS=60
CLEANER_SECONDS=3600

async def clear_failed_runs(vault,clock,wait=asyncio.sleep):
    """Checkouts may never come, so this cannot depend on one. Only failed runs: an unpaid one must wait for World to answer, as prune_unpaid does."""
    while True:
        try:left=vault.prune_failed(clock())>=PRUNE_BATCH
        except Exception as error:
            logging.getLogger('celestao.delivery').error('cleanup_failed reason=%s',type(error).__name__);left=False
        await wait(0 if left else CLEANER_SECONDS)

def make_app(baseline_app,settings:Settings,*,bridge=None,clock=None,processor=None,frontend=None):
    now=clock or (lambda:int(time.time()*1000))
    billing=bool(settings.enabled and settings.delivery_secret)
    if billing and processor is None:raise RuntimeError('PAID_ADAPTER_NOT_INSTALLED')
    vault=Vault(settings.database,settings.storage_key) if settings.enabled else None
    sessions=Sessions(vault,settings.world_origin) if vault else None
    world=bridge or WorldBridge(settings,clock=now)
    @asynccontextmanager
    async def lifespan(application):
        try:
            async with baseline_app.router.lifespan_context(baseline_app):
                cleaner=asyncio.create_task(clear_failed_runs(vault,now)) if vault else None
                try:yield
                finally:
                    if cleaner:cleaner.cancel()
                tasks=getattr(application.state,'delivery_tasks',set())
                # A computation that cannot be interrupted must not hold shutdown; its order stays pending and is claimed again.
                if tasks:await asyncio.wait(tasks,timeout=SHUTDOWN_WAIT_SECONDS)
        finally:
            if vault:vault.close()
    app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None,debug=False,lifespan=lifespan)
    app.state.vault=vault;app.state.sessions=sessions
    from urllib.parse import urlsplit
    app.add_middleware(TrustedHostMiddleware,allowed_hosts=[urlsplit(settings.public_origin).hostname],www_redirect=False)
    app.add_middleware(WalletLimits)

    @app.middleware('http')
    async def guards(request:Request,call_next):
        path=request.url.path
        if billing and path.rstrip('/') in ('/api/charts','/api/reports','/api/reports/profile','/api/reports/annual-ziwei'):
            return JSONResponse({'error':'WORLD_CHECKOUT_REQUIRED'},402,headers=HEADERS)
        own=path.startswith('/api/world/') or path.startswith('/api/holder/world/')
        if own and request.method not in ('GET','HEAD'):
            if request.headers.get('origin')!=settings.public_origin or request.headers.get('x-requested-with')!='CelestialAtlas':return JSONResponse({'error':'FORBIDDEN_ORIGIN'},403,headers=HEADERS)
            if request.headers.get('content-type','').split(';')[0].lower()!='application/json':return JSONResponse({'error':'JSON_REQUIRED'},415,headers=HEADERS)
        # World's redirect makes the sign-in callback cross-site in every browser; its one-time state, cookie and PKCE protect it.
        callback=request.method in ('GET','HEAD') and path=='/api/holder/world/callback'
        if own and not callback and request.headers.get('sec-fetch-site') not in (None,'same-origin','none'):
            return JSONResponse({'error':'FORBIDDEN_ORIGIN'},403,headers=HEADERS)
        response=await call_next(request)
        if own:
            response.headers.update(HEADERS);response.headers['Content-Security-Policy']=CSP
        return response

    @app.exception_handler(RequestValidationError)
    async def invalid(request,exc):
        fields=sorted({str(e['loc'][-1]) for e in exc.errors()})
        return JSONResponse({'error':'INVALID_REQUEST','fields':fields},422,headers=HEADERS)
    @app.exception_handler(VaultError)
    async def storage_error(request,exc):
        # Codes are operator-owned constants, never raw Pydantic/birth values.
        return JSONResponse({'error':'STORAGE_UNAVAILABLE'},503,headers=HEADERS)

    def configured():
        if not settings.enabled or not vault or not sessions:raise HTTPException(503,'WALLET_NOT_CONFIGURED')
    def same_client(request):
        if request.headers.get('x-requested-with')!='CelestialAtlas':raise HTTPException(403,'CLIENT_HEADER_REQUIRED')
    async def identity(request:Request):
        configured();same_client(request)
        token=request.cookies.get(settings.session_cookie)
        try:
            stored=sessions.read(token,now())
            current=await world.introspect(stored['bridge_session'])
            if current['address']!=stored['address']:raise AuthDenied('ACCOUNT_CONTEXT_CHANGED')
            sessions.read(token,now())
        except (AuthDenied,Missing):raise HTTPException(401,'AUTH_REQUIRED') from None
        except BridgeUnavailable:raise HTTPException(503,'WORLD_AUTH_UNAVAILABLE') from None
        return Identity(token,current['address'],min(current['expires_at'],stored['expires_at']),sessions.context(token),sessions.csrf(token),stored)
    async def checked(request:Request,ident:Identity=Depends(identity)):
        if request.headers.get('x-celestao-context')!=ident.context:raise HTTPException(409,'CONTEXT_CHANGED')
        if request.method not in ('GET','HEAD') and not sessions.check_csrf(ident.token,request.headers.get('x-celestao-csrf')):raise HTTPException(403,'CSRF_REQUIRED')
        return ident
    def still_current(ident):
        try:sessions.read(ident.token,now())
        except Missing:raise HTTPException(401,'AUTH_REQUIRED') from None

    @app.get('/api/world/catalog')
    async def catalog():
        return dict(json.loads(CATALOG.read_text(encoding='utf-8')),walletEnabled=settings.enabled,paymentsEnabled=settings.paid_enabled,billingInstalled=billing,
            **({'localWorldOrigin':settings.world_origin} if settings.local else {}))

    @app.post('/api/holder/world/start')
    async def start(request:Request,value:StartRequest):
        configured()
        if value.language not in ('zh','en'):raise HTTPException(422,'INVALID_LANGUAGE')
        state=sessions.begin(value.language,now(),previous_cookie=request.cookies.get(settings.oauth_cookie))
        response=JSONResponse({'authorizeUrl':world.authorize_url(state['state'],state['verifier'],value.language)},headers=HEADERS)
        response.set_cookie(settings.oauth_cookie,state['cookie'],max_age=600,path='/',httponly=True,secure=not settings.local,samesite='lax')
        return response

    @app.get('/api/holder/world/callback')
    async def callback(request:Request):
        configured();q=request.query_params
        if set(q.keys())!={'code','state','lang'} or any(len(q.getlist(k))!=1 for k in q) or not valid(q.get('code')) or q.get('lang') not in ('zh','en'):raise HTTPException(400,'INVALID_CALLBACK')
        try:
            state=sessions.consume(q.get('state'),request.cookies.get(settings.oauth_cookie),now())
            if state['language']!=q.get('lang'):raise AuthDenied('INVALID_LANGUAGE')
            grant=await world.exchange(q['code'],state['verifier'])
            token=sessions.issue(grant,now(),previous=request.cookies.get(settings.session_cookie),source_state=state['source_state'])
        except BridgeUnavailable:return RedirectResponse('/?world_error=temporarily_unavailable#/saved',303,headers=HEADERS)
        except (Missing,AuthDenied,VaultError):return RedirectResponse('/?world_error=login_required#/saved',303,headers=HEADERS)
        response=RedirectResponse('/?world_lang='+state['language']+'#/saved',303,headers=HEADERS)
        response.set_cookie(settings.session_cookie,token,max_age=max(1,(grant['expires_at']-now())//1000),path='/',httponly=True,secure=not settings.local,samesite='lax')
        return response

    @app.get('/api/world/session')
    async def current(ident:Identity=Depends(identity)):
        still_current(ident)
        return {'wallet':ident.wallet,'expiresAt':ident.expires,'context':ident.context,'csrf':ident.csrf}

    @app.post('/api/world/logout')
    async def logout(request:Request):
        configured();same_client(request);token=request.cookies.get(settings.session_cookie)
        try:sessions.read(token,now())
        except Missing:raise HTTPException(401,'AUTH_REQUIRED') from None
        if request.headers.get('x-celestao-context')!=sessions.context(token) or not sessions.check_csrf(token,request.headers.get('x-celestao-csrf')):raise HTTPException(403,'CSRF_REQUIRED')
        sessions.revoke(token,now())
        # No cookie-clearing header: a delayed logout response must not erase a
        # newer wallet login. The opaque revoked cookie has no authority.
        return {'ok':True,'context':sessions.context(token)}

    private=APIRouter(prefix='/api/world/collections')
    @private.get('')
    async def collections(request:Request,ident:Identity=Depends(checked)):
        q=request.query_params
        if set(q)-{'before','trash'} or any(len(q.getlist(k))!=1 for k in q) or q.get('trash','0') not in ('0','1'):raise HTTPException(400,'INVALID_REQUEST')
        try:page=vault.page(ident.wallet,trash=q.get('trash')=='1',before=q.get('before'))
        except Missing:raise HTTPException(404,'NOT_FOUND') from None
        still_current(ident)
        return {'wallet':ident.wallet,'context':ident.context,**page,'limit':100}
    @private.get('/{record_id}')
    async def report(record_id:str,ident:Identity=Depends(checked)):
        if not valid(record_id):raise HTTPException(404,'NOT_FOUND')
        try:result=vault.read(ident.wallet,record_id)
        except Missing:raise HTTPException(404,'NOT_FOUND') from None
        still_current(ident);return {'wallet':ident.wallet,'context':ident.context,'result':result}
    @private.post('/{record_id}/trash')
    async def trash(record_id:str,ident:Identity=Depends(checked)):
        if not valid(record_id):raise HTTPException(404,'NOT_FOUND')
        try:vault.trash(ident.wallet,record_id,now())
        except Missing:raise HTTPException(404,'NOT_FOUND') from None
        still_current(ident);return {'ok':True,'context':ident.context}
    @private.post('/{record_id}/restore')
    async def restore(record_id:str,ident:Identity=Depends(checked)):
        if not valid(record_id):raise HTTPException(404,'NOT_FOUND')
        try:vault.trash(ident.wallet,record_id,now(),restore=True)
        except Missing:raise HTTPException(404,'NOT_FOUND') from None
        still_current(ident);return {'ok':True,'context':ident.context}
    app.include_router(private)
    if billing:
        from .paid import install
        install(app,settings,vault,world,processor,now,checked,still_current,HEADERS)
    if frontend is not None:
        directory=Path(frontend).resolve()
        if not (directory/'index.html').is_file():raise RuntimeError('REVIEWED_FRONTEND_REQUIRED')
        @app.api_route('/',methods=['GET','HEAD'])
        async def index(request:Request):
            file='index-pdf.html' if valid(request.query_params.get('world_pdf')) else 'index.html'
            return FileResponse(directory/file,headers={'Cache-Control':'no-store','Content-Security-Policy':CSP,**HEADERS})
        app.mount('/world-assets',StaticFiles(directory=directory),name='world-assets')
    app.mount('/',baseline_app)
    return app
