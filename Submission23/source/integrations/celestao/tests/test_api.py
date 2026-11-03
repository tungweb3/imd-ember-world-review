"""ASGI integration: cookies, CSRF, revocation and per-wallet authorization.

The World responder is injected. These tests never sign or spend real GOLD.
"""
import unittest
from urllib.parse import parse_qs,urlsplit
import httpx
from fastapi import FastAPI
from test_vault import VaultFixture,A,B,KEY,RESULT
from test_sessions import grant
from celestao_world.app import make_app
from celestao_world.config import Settings
from celestao_world.bridge import WorldBridge,AuthDenied,BridgeUnavailable
from celestao_world.protocol import PREPARE,SCHEMA,signature
import celestao_world,json
from pathlib import Path

class IdentityStub:
    def __init__(self,settings):self.client=WorldBridge(settings);self.mode='ok';self.wallet=A
    def authorize_url(self,*args):return self.client.authorize_url(*args)
    async def exchange(self,code,verifier):
        if self.mode=='down':raise BridgeUnavailable('WORLD_AUTH_UNAVAILABLE')
        return grant(self.wallet)
    async def introspect(self,token):
        if self.mode=='down':raise BridgeUnavailable('WORLD_AUTH_UNAVAILABLE')
        if self.mode=='revoked':raise AuthDenied('WORLD_AUTH_REQUIRED')
        result=grant(self.wallet);result.pop('bridge_session');return result

class APITests(VaultFixture,unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.vault.close()
        self.settings=Settings(enabled=True,database=self.path,storage_key=KEY,bridge_secret='s'*40)
        self.world=IdentityStub(self.settings)
        baseline=FastAPI()
        @baseline.get('/health')
        async def health():return {'original':True}
        self.app=make_app(baseline,self.settings,bridge=self.world,clock=lambda:1000)
        self.vault=self.app.state.vault;self.sessions=self.app.state.sessions
        self.client=httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app),base_url='https://celestao.com')
    async def asyncTearDown(self):await self.client.aclose()
    def login(self,wallet=A,previous=None):
        self.world.wallet=wallet
        token=self.sessions.issue(grant(wallet),1000,previous=previous)
        self.client.cookies.set(self.settings.session_cookie,token,domain='celestao.com',path='/')
        return token,{'x-requested-with':'CelestialAtlas','origin':'https://celestao.com',
            'x-celestao-context':self.sessions.context(token),'x-celestao-csrf':self.sessions.csrf(token)}
    async def test_oauth_callback_exact_origin_cookie_pkce_and_replay(self):
        for origin in ['https://evil.test','null','https://celestao.com.evil.test']:
            r=await self.client.post('/api/holder/world/start',json={'language':'zh'},headers={'origin':origin,'x-requested-with':'CelestialAtlas'})
            self.assertEqual(r.status_code,403)
        r=await self.client.post('/api/holder/world/start',json={'language':'zh'},headers={'origin':'https://celestao.com','x-requested-with':'CelestialAtlas'})
        self.assertEqual(r.status_code,200)
        cookie=r.headers['set-cookie'];self.assertIn('HttpOnly',cookie);self.assertIn('Secure',cookie);self.assertIn('SameSite=lax',cookie);self.assertNotIn('Domain=',cookie)
        url=urlsplit(r.json()['authorizeUrl']);self.assertEqual(url.netloc,'imdember.com')
        q=parse_qs(url.query);self.assertEqual(q['redirect_uri'],['https://celestao.com/api/holder/world/callback'])
        self.assertEqual(q['code_challenge_method'],['S256']);self.assertNotIn(A,r.text)
        params={'code':'c'*43,'state':q['state'][0],'lang':'zh'}
        bad=await self.client.get('/api/holder/world/callback',params={**params,'redirect':'https://evil.test'})
        self.assertEqual(bad.status_code,400)
        callback=await self.client.get('/api/holder/world/callback',params=params)
        self.assertEqual(callback.status_code,303);self.assertEqual(callback.headers['location'],'/?world_lang=zh#/saved')
        self.assertIn('__Host-celestao-world=',callback.headers['set-cookie'])
        self.assertNotIn('g'*43,callback.headers['set-cookie'])
        repeated=await self.client.get('/api/holder/world/callback',params=params)
        self.assertEqual(repeated.headers['location'],'/?world_error=login_required#/saved');self.assertNotIn('set-cookie',repeated.headers)
    async def test_collections_refuse_another_wallet_and_require_fresh_context(self):
        _,_,record=self.saved();first,headers=self.login()
        self.assertEqual((await self.client.get('/api/world/collections',headers={})).status_code,403)
        state=await self.client.get('/api/world/session',headers=headers)
        self.assertEqual(state.json()['wallet'],A);self.assertNotIn('bridge_session',state.text)
        r=await self.client.get('/api/world/collections',headers=headers)
        self.assertEqual([x['id'] for x in r.json()['records']],[record]);self.assertNotIn('1990-01-02',r.text)
        self.assertEqual((await self.client.get('/api/world/collections/'+record,headers=headers)).json()['result'],RESULT)
        second,other=self.login(B,previous=first)
        self.assertEqual((await self.client.get('/api/world/collections',headers=headers)).status_code,409)
        self.assertEqual((await self.client.get('/api/world/collections',headers=other)).json()['records'],[])
        for method,path in [('get',''),('post','/trash'),('post','/restore')]:
            r=await getattr(self.client,method)('/api/world/collections/'+record+path,headers=other,**({'json':{}} if method=='post' else {}))
            self.assertEqual(r.status_code,404)
        self.assertNotEqual(first,second)
    async def test_csrf_trash_restore_and_logout_never_clear_a_new_cookie(self):
        _,_,record=self.saved();token,headers=self.login()
        no_csrf={k:v for k,v in headers.items() if k!='x-celestao-csrf'}
        self.assertEqual((await self.client.post('/api/world/collections/'+record+'/trash',json={},headers=no_csrf)).status_code,403)
        self.assertEqual((await self.client.post('/api/world/collections/'+record+'/trash',json={},headers=headers)).status_code,200)
        self.assertEqual((await self.client.get('/api/world/collections/'+record,headers=headers)).status_code,404)
        self.assertEqual(len((await self.client.get('/api/world/collections?trash=1',headers=headers)).json()['records']),1)
        self.assertEqual((await self.client.post('/api/world/collections/'+record+'/restore',json={},headers=headers)).status_code,200)
        self.world.mode='down'
        r=await self.client.post('/api/world/logout',json={},headers=headers)
        self.assertEqual(r.status_code,200);self.assertNotIn('set-cookie',r.headers)
        self.assertEqual(r.json()['context'],headers['x-celestao-context'])
        self.world.mode='ok'
        self.assertEqual((await self.client.get('/api/world/session',headers=headers)).status_code,401)
    async def test_world_outage_is_not_revocation_and_no_private_response_is_cached(self):
        token,headers=self.login();self.world.mode='down'
        r=await self.client.get('/api/world/session',headers=headers)
        self.assertEqual(r.status_code,503);self.assertNotIn('set-cookie',r.headers)
        self.world.mode='ok'
        r=await self.client.get('/api/world/session',headers=headers)
        self.assertEqual(r.status_code,200);self.assertIn('no-store',r.headers['cache-control'])
        self.assertIn("frame-ancestors 'none'",r.headers['content-security-policy'])
        self.world.mode='revoked'
        self.assertEqual((await self.client.get('/api/world/session',headers=headers)).status_code,401)
    async def test_bounded_inputs_rate_limits_and_original_application(self):
        r=await self.client.get('/health');self.assertEqual(r.json(),{'original':True})
        catalog=(await self.client.get('/api/world/catalog')).json()
        self.assertFalse(catalog['paymentsEnabled'])
        self.assertEqual(next(x for x in catalog['products'] if x['system']=='profile')['gold'],'3000')
        self.assertEqual([x['system'] for x in catalog['products']],['bazi','ziwei','annual_ziwei','western','human','profile'])
        annual=next(x for x in catalog['products'] if x['system']=='annual_ziwei')
        self.assertEqual((annual['product'],annual['gold'],annual['listGold']),('fortune-annual-ziwei','1000','1000'))
        h={'origin':'https://celestao.com','x-requested-with':'CelestialAtlas','content-type':'application/json'}
        r=await self.client.post('/api/holder/world/start',content=b'x'*32769,headers=h);self.assertEqual(r.status_code,413)
        for _ in range(19):self.assertEqual((await self.client.post('/api/holder/world/start',json={'language':'en'},headers=h)).status_code,200)
        self.assertEqual((await self.client.post('/api/holder/world/start',json={'language':'en'},headers=h)).status_code,429)

class BridgeTests(unittest.IsolatedAsyncioTestCase):
    async def test_prepare_checkout_expects_the_product_id_world_answers_with(self):
        now=1792000000000;secret='delivery-fixture-secret-0123456789-abcdefgh'
        def answer(product):
            def respond(request):
                run=json.loads(request.content)
                raw=json.dumps({'schema':SCHEMA,'runId':run['runId'],'wallet':A,'product':product,'inputHash':run['inputHash'],'expiresMs':now+900000},separators=(',',':')).encode()
                return httpx.Response(200,content=raw,headers={'content-type':'application/json','x-celestao-signature':signature(secret,'response',PREPARE,str(now//1000),raw)})
            return respond
        run={'id':'r'*43,'system':'annual_ziwei','input_hash':'1'*64};session={'bridge_session':'g'*43,'address':A}
        settings=Settings(delivery_secret=secret)
        accepted=await WorldBridge(settings,transport=httpx.MockTransport(answer('fortune-annual-ziwei')),clock=lambda:now).prepare_checkout(session,run)
        self.assertEqual(accepted['product'],'fortune-annual-ziwei')
        with self.assertRaises(BridgeUnavailable):
            await WorldBridge(settings,transport=httpx.MockTransport(answer('fortune-annual_ziwei')),clock=lambda:now).prepare_checkout(session,run)
    def test_every_catalogue_id_is_what_the_bridge_and_delivery_derive_from_its_system(self):
        catalogue=json.loads((Path(celestao_world.__file__).resolve().parents[1]/'fortune_catalog.json').read_text(encoding='utf-8'))
        for product in catalogue['products']:
            self.assertEqual(product['product'],'fortune-'+product['system'].replace('_','-'))
            self.assertRegex(product['product'],r'^[a-z][a-z0-9-]{0,63}$')
    async def test_real_http_client_uses_fixed_server_secret_no_browser_origin_and_denies_bad_identity(self):
        settings=Settings();observed=[]
        def responder(request):
            observed.append(request)
            return httpx.Response(200,json=grant())
        bridge=WorldBridge(Settings(bridge_secret='test-secret'),transport=httpx.MockTransport(responder),clock=lambda:1000)
        result=await bridge.exchange('c'*43,'v'*43)
        self.assertEqual(result['address'],A)
        self.assertEqual(str(observed[0].url),'https://imdember.com/api/celestao-auth/token')
        self.assertEqual(observed[0].headers['authorization'],'Bearer test-secret')
        self.assertNotIn('origin',observed[0].headers);self.assertNotIn('cookie',observed[0].headers)
        for patch in [{'audience':'aimarket'},{'scope':'gold:spend'},{'expires_at':1000},{'address':B.upper()},{'issuer':'https://evil.test'}]:
            bridge=WorldBridge(settings,transport=httpx.MockTransport(lambda r:httpx.Response(200,json={**grant(),**patch})),clock=lambda:1000)
            with self.assertRaises(AuthDenied):await bridge.exchange('c'*43,'v'*43)
        for status in [302,500,503]:
            bridge=WorldBridge(settings,transport=httpx.MockTransport(lambda r:httpx.Response(status,headers={'location':'https://evil.test'})),clock=lambda:1000)
            with self.assertRaises(BridgeUnavailable):await bridge.exchange('c'*43,'v'*43)
