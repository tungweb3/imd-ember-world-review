"""Paid protocol and durable retry tests; synthetic engine, no real GOLD."""
import unittest,json
from fastapi import FastAPI
import httpx
from test_vault import VaultFixture,A,B,KEY,INPUT,RESULT,ORDER
from celestao_world.app import make_app
from celestao_world.config import Settings
from celestao_world.bridge import WorldBridge
from celestao_world.native import NativeInputError,NativeUnavailable,NativeNondelivery
from celestao_world.protocol import SCHEMA,DELIVER,signature,verified

NOW=1780000000000
SECRET='dedicated-fixture-delivery-secret-0123456789'
class PaidWorld:
    def __init__(self,settings):self.config=settings;self.prepares=0
    async def introspect(self,token):return {k:v for k,v in self.grant().items() if k!='bridge_session'}
    def grant(self):return {'issuer':'https://imdember.com','audience':'celestao','scope':'fortune:account','address':A,'bridge_session':'g'*43,'expires_at':NOW+3600000}
    async def prepare_checkout(self,grant,run):
        self.prepares+=1;return {'expiresMs':NOW+900000}
class Processor:
    def __init__(self):self.calls=0;self.mode='ok'
    async def validate(self,system,payload):
        if self.mode=='invalid':raise NativeInputError('INVALID_CHART_INPUT')
        if self.mode=='offline':raise NativeUnavailable('ENGINE_UNAVAILABLE')
        return payload
    async def compute(self,system,payload,owner):
        self.calls+=1
        if self.mode=='offline':raise NativeUnavailable('ENGINE_UNAVAILABLE')
        if self.mode=='rejected':raise NativeNondelivery('CHART_NOT_GENERATED')
        return {**RESULT,'system':system,'input':payload}

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
    async def test_confirmed_nondelivery_is_terminal_and_never_creates_a_report(self):
        run=await self.run_fixture();self.processor.mode='rejected'
        first=await self.deliver(run);self.assertEqual(first.json()['kind'],'terminal-failure')
        self.assertEqual(first.json()['proof'],{'kind':'provider-confirmed-nondelivery','reference':ORDER})
        self.assertEqual(self.vault.list(A),[])
        second=await self.deliver(run);self.assertEqual(second.json(),first.json());self.assertEqual(self.processor.calls,1)
