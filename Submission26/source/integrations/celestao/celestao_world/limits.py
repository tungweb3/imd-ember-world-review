"""Bounded same-origin API input and per-peer limits, without trusting XFF."""
import ipaddress,time
from starlette.responses import JSONResponse

def client_group(peer):
    """One IPv6 customer holds a whole /64, so a limit per address would not limit them."""
    try:address=ipaddress.ip_address(peer)
    except ValueError:return peer
    if address.version==6 and not address.ipv4_mapped:return str(ipaddress.ip_network((address,64),strict=False))
    return peer

class WalletLimits:
    def __init__(self,app):self.app=app;self.buckets={}
    async def __call__(self,scope,receive,send):
        path=scope.get('path','')
        if scope['type']!='http' or not path.startswith(('/api/world/','/api/holder/world/','/api/internal/world-gold/')):
            return await self.app(scope,receive,send)
        headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}
        now=time.monotonic();peer=client_group((scope.get('client') or ('unknown',0))[0])
        group='start' if path=='/api/holder/world/start' else 'delivery' if path.startswith('/api/internal/') else 'wallet'
        key=(peer,group);limit=20 if group=='start' else 180
        if len(self.buckets)>=2048:
            self.buckets={k:v for k,v in self.buckets.items() if v[0]>now-60}
            # A full table must not close the service to everyone it has not seen: the oldest entry makes way.
            if key not in self.buckets and len(self.buckets)>=2048:del self.buckets[min(self.buckets,key=lambda k:self.buckets[k][0])]
        since,count=self.buckets.get(key,(now,0))
        if since<=now-60:since,count=now,0
        if count>=limit:
            return await JSONResponse({'error':'RATE_LIMITED'},429,headers={**headers,'Retry-After':'60'})(scope,receive,send)
        self.buckets[key]=(since,count+1)
        if scope['method'] not in ('GET','HEAD'):
            body=bytearray()
            while True:
                message=await receive()
                if message['type']=='http.disconnect':return
                body.extend(message.get('body',b''))
                if len(body)>32768:
                    return await JSONResponse({'error':'INPUT_TOO_LARGE'},413,headers=headers)(scope,receive,send)
                if not message.get('more_body'):break
            supplied=False
            async def bounded_receive():
                nonlocal supplied
                if not supplied:supplied=True;return {'type':'http.request','body':bytes(body),'more_body':False}
                return await receive()
            return await self.app(scope,bounded_receive,send)
        return await self.app(scope,receive,send)
