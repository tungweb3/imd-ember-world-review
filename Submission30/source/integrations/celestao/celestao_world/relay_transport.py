"""Fixed private relay, preserving the app's existing internal-only network.

Only three backend POST routes can reach the World HTTPS endpoint. The relay
verifies public TLS; no user-supplied destination or Origin header is accepted.
"""
import httpx
ROUTES=frozenset(('/api/celestao-auth/token','/api/celestao-auth/session','/api/celestao-checkout/prepare'))
class RelayTransport(httpx.AsyncBaseTransport):
    def __init__(self):self.inner=httpx.AsyncHTTPTransport(trust_env=False)
    async def handle_async_request(self,request):
        if request.method!='POST' or request.url.scheme!='https' or request.url.host!='imdember.com' or request.url.port not in (None,443) or request.url.path not in ROUTES or request.url.query or request.url.username or request.url.password:
            raise httpx.TransportError('RELAY_ROUTE_DENIED')
        raw=await request.aread()
        if len(raw)>4096:raise httpx.TransportError('RELAY_INPUT_TOO_LARGE')
        headers={k:v for k,v in request.headers.items() if k.lower() in ('authorization','content-type','accept','x-celestao-signature')}
        target='http://celestao-world-egress:8080'+request.url.path
        forwarded=httpx.Request('POST',target,headers=headers,content=raw,extensions=request.extensions)
        return await self.inner.handle_async_request(forwarded)
    async def aclose(self):await self.inner.aclose()
