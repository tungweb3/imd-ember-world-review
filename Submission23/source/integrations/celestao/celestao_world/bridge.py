"""Fixed-origin, backend-only World identity client. No browser tokens or CORS."""
import base64,hashlib,json,re,time
from urllib.parse import urlencode
import httpx
from .config import Settings
from .vault import VaultError,at
from .protocol import SCHEMA,PREPARE,signature,verified
from .relay_transport import RelayTransport

class AuthDenied(VaultError):pass
class BridgeUnavailable(VaultError):pass

class WorldBridge:
    def __init__(self,settings:Settings,transport=None,clock=None):
        self.settings=settings;self.transport=transport;self.clock=clock or (lambda:int(time.time()*1000))
    def authorize_url(self,state,verifier,language):
        if not all(isinstance(v,str) and re.fullmatch(r'[A-Za-z0-9_-]{43}',v) for v in (state,verifier)) or language not in ('zh','en'):raise VaultError('INVALID_AUTH_REQUEST')
        challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
        return self.settings.world_origin+'/api/celestao-auth/authorize?'+urlencode({'client_id':'celestao','redirect_uri':self.settings.callback,'response_type':'code','code_challenge_method':'S256','code_challenge':challenge,'state':state,'lang':language})
    def _identity(self,value,exchange):
        expected={'issuer','audience','scope','address','expires_at'}|({'bridge_session'} if exchange else set())
        now=at(self.clock())
        if not isinstance(value,dict) or set(value)!=expected or value.get('issuer')!=self.settings.world_origin or value.get('audience')!='celestao' or value.get('scope')!='fortune:account' or not isinstance(value.get('address'),str) or not re.fullmatch(r'0x[0-9a-f]{40}',value['address']) or type(value.get('expires_at')) is not int or not now<value['expires_at']<=9007199254740991:
            raise AuthDenied('INVALID_WORLD_IDENTITY')
        if exchange and (not isinstance(value.get('bridge_session'),str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}',value['bridge_session'])):raise AuthDenied('INVALID_WORLD_IDENTITY')
        return value
    async def _post(self,path,payload,exchange):
        # `path` is selected below, not by a user or a returned URL.
        if path not in ('token','session'):raise VaultError('INVALID_BRIDGE_ROUTE')
        try:
            transport=self.transport or (None if self.settings.local else RelayTransport())
            async with httpx.AsyncClient(transport=transport,timeout=10,follow_redirects=False,trust_env=False) as client:
                async with client.stream('POST',self.settings.world_origin+'/api/celestao-auth/'+path,
                    headers={'authorization':'Bearer '+self.settings.bridge_secret,'content-type':'application/json','accept':'application/json'},content=json.dumps(payload,separators=(',',':')).encode()) as response:
                    if response.headers.get('content-type','').split(';')[0]!='application/json':raise BridgeUnavailable('WORLD_AUTH_UNAVAILABLE')
                    raw=bytearray()
                    async for chunk in response.aiter_bytes():
                        raw.extend(chunk)
                        if len(raw)>8192:raise BridgeUnavailable('WORLD_RESPONSE_TOO_LARGE')
                    value=json.loads(raw)
                    if response.status_code in (400,401,403) and isinstance(value,dict) and value.get('error') in ('AUTH_REQUIRED','INVALID_GRANT'):raise AuthDenied('WORLD_AUTH_REQUIRED')
                    if response.status_code!=200:raise BridgeUnavailable('WORLD_AUTH_UNAVAILABLE')
            return self._identity(value,exchange)
        except (AuthDenied,BridgeUnavailable):raise
        except (httpx.HTTPError,ValueError,UnicodeError):raise BridgeUnavailable('WORLD_AUTH_UNAVAILABLE') from None
    async def exchange(self,code,verifier):
        if not all(isinstance(v,str) and re.fullmatch(r'[A-Za-z0-9_-]{43}',v) for v in (code,verifier)):raise AuthDenied('INVALID_GRANT')
        return await self._post('token',{'grant_type':'authorization_code','client_id':'celestao','redirect_uri':self.settings.callback,'code':code,'code_verifier':verifier},True)
    async def introspect(self,bridge_session):
        if not isinstance(bridge_session,str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}',bridge_session):raise AuthDenied('INVALID_GRANT')
        return await self._post('session',{'client_id':'celestao','bridge_session':bridge_session},False)
    async def prepare_checkout(self,grant,run):
        started=at(self.clock());raw=json.dumps({'bridgeSession':grant['bridge_session'],'runId':run['id'],'system':run['system'],'inputHash':run['input_hash']},separators=(',',':')).encode()
        try:
            transport=self.transport or (None if self.settings.local else RelayTransport())
            async with httpx.AsyncClient(transport=transport,timeout=10,follow_redirects=False,trust_env=False) as client:
                async with client.stream('POST',self.settings.world_origin+PREPARE,content=raw,headers={'content-type':'application/json','accept':'application/json',
                    'x-celestao-signature':signature(self.settings.delivery_secret,'request',PREPARE,str(started//1000),raw)}) as response:
                    if response.headers.get('content-type','').split(';')[0]!='application/json':raise BridgeUnavailable('CHECKOUT_UNAVAILABLE')
                    body=bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body)>4096:raise BridgeUnavailable('CHECKOUT_UNAVAILABLE')
                    value=json.loads(body)
                    if response.status_code in (401,403) and isinstance(value,dict) and value.get('error')=='AUTH_REQUIRED':raise AuthDenied('WORLD_AUTH_REQUIRED')
                    if response.status_code!=200:raise BridgeUnavailable('CHECKOUT_UNAVAILABLE')
                    if self.clock()<started or not verified(self.settings.delivery_secret,'response',PREPARE,response.headers.get('x-celestao-signature'),bytes(body),self.clock()):raise BridgeUnavailable('CHECKOUT_UNAVAILABLE')
            if not isinstance(value,dict) or set(value)!={'schema','runId','wallet','product','inputHash','expiresMs'} or value['schema']!=SCHEMA or value['runId']!=run['id'] or value['wallet']!=grant['address'] or value['product']!='fortune-'+run['system'].replace('_','-') or value['inputHash']!=run['input_hash'] or type(value['expiresMs']) is not int:raise BridgeUnavailable('CHECKOUT_UNAVAILABLE')
            return value
        except (AuthDenied,BridgeUnavailable):raise
        except (httpx.HTTPError,ValueError,UnicodeError):raise BridgeUnavailable('CHECKOUT_UNAVAILABLE') from None
