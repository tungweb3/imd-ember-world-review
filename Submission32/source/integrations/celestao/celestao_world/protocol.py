"""Byte-exact signatures shared with World, distinct from identity credentials."""
import hashlib,hmac,re
SCHEMA='ember-world-celestao/v1'
PREPARE='/api/celestao-checkout/prepare'
DELIVER='/api/internal/world-gold/deliver'
def signature(secret,direction,path,timestamp,raw):
    if direction not in ('request','response') or path not in (PREPARE,DELIVER):raise ValueError('INVALID_PROTOCOL')
    message='\n'.join((SCHEMA,direction,'POST',path,timestamp,hashlib.sha256(raw).hexdigest())).encode()
    return 'v1.'+timestamp+'.'+hmac.new(secret.encode(),message,hashlib.sha256).hexdigest()
def verified(secret,direction,path,header,raw,now):
    m=re.fullmatch(r'v1\.(\d{10})\.([0-9a-f]{64})',header or '')
    return bool(m and len(secret)>=32 and abs(int(m[1])-now//1000)<=30 and hmac.compare_digest(signature(secret,direction,path,m[1],raw),header))
