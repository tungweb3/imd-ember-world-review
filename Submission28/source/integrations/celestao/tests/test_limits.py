"""The limit table: full does not mean closed, and one IPv6 customer is one client."""
import unittest
from celestao_world.limits import WalletLimits,client_group

class LimitTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.seen=[]
        async def app(scope,receive,send):
            self.seen.append(scope['path']);await send({'type':'http.response.start','status':200,'headers':[]});await send({'type':'http.response.body','body':b''})
        self.limits=WalletLimits(app)
    async def call(self,peer,path='/api/world/catalog',method='GET'):
        sent=[]
        async def send(message):sent.append(message)
        async def receive():return {'type':'http.request','body':b'','more_body':False}
        await self.limits({'type':'http','path':path,'method':method,'client':(peer,1),'headers':[]},receive,send)
        return sent[0]['status']
    async def test_a_full_table_still_serves_someone_new(self):
        for i in range(2048):self.assertEqual(await self.call('10.%d.%d.1'%(i//256,i%256)),200)
        self.assertEqual(len(self.limits.buckets),2048)
        for path in ('/api/world/runs','/api/internal/world-gold/deliver','/api/holder/world/callback'):
            self.assertEqual(await self.call('192.0.2.9',path,'POST' if 'callback' not in path else 'GET'),200,path)
        self.assertLessEqual(len(self.limits.buckets),2048)
    async def test_the_oldest_entry_makes_way_and_a_busy_client_stays_counted(self):
        self.limits.buckets={('old',str(i)):(float(i)+10**9,1) for i in range(2048)}
        import time
        now=time.monotonic();self.limits.buckets={('p%d'%i,'wallet'):(now-i/100,1) for i in range(2048)}
        oldest=min(self.limits.buckets,key=lambda k:self.limits.buckets[k][0])
        self.assertEqual(await self.call('192.0.2.9'),200)
        self.assertNotIn(oldest,self.limits.buckets);self.assertIn(('p0','wallet'),self.limits.buckets);self.assertEqual(len(self.limits.buckets),2048)
    async def test_one_ipv6_block_shares_a_limit_and_ipv4_does_not(self):
        answers=[await self.call('2001:db8:1:2:%x::1'%i,'/api/holder/world/start') for i in range(21)]
        self.assertEqual(answers[:20],[200]*20);self.assertEqual(answers[20],429)
        self.assertEqual(await self.call('2001:db8:1:3::1','/api/holder/world/start'),200)
        for i in range(21):self.assertEqual(await self.call('198.51.100.%d'%i,'/api/holder/world/start'),200)
        self.assertEqual(client_group('::ffff:198.51.100.1'),'::ffff:198.51.100.1');self.assertEqual(client_group('unknown'),'unknown')
    async def test_buyers_on_one_address_cannot_use_up_delivery(self):
        for _ in range(180):self.assertEqual(await self.call('192.0.2.1'),200)
        self.assertEqual(await self.call('192.0.2.1'),429)
        self.assertEqual(await self.call('192.0.2.1','/api/internal/world-gold/deliver','POST'),200)

if __name__=='__main__':unittest.main()
