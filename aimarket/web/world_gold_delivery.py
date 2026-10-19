"""Authenticated, idempotent research delivery; never grants or spends GOLD.

Only World can request an order-bound snapshot. The public site and holder
cookies confer no authority here. Existing report/holder databases are retained.
"""
import hashlib, hmac, json, os, re, sqlite3, time
from pathlib import Path

SCHEMA='ember-world-research-delivery/v1'
PREFIX='/api/internal/world-gold/'
MAX_DOCUMENT=900_000
HEX=re.compile(r'0x[0-9a-f]{64}\Z')
ADDRESS=re.compile(r'0x[0-9a-f]{40}\Z')
REFERENCE=re.compile(r'[0-9a-f]{64}\Z')

def _raw(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode('utf8')

def signature(secret,direction,path,timestamp,raw):
    message=f'{SCHEMA}\n{direction}\nPOST\n{path}\n{timestamp}\n{hashlib.sha256(raw).hexdigest()}'
    return f'v1.{timestamp}.'+hmac.new(secret.encode(),message.encode(),hashlib.sha256).hexdigest()

def _secret():
    secret=os.environ.get('AIMARKET_BRIDGE_SECRET','')
    return secret if 32<=len(secret)<=256 and not any(c.isspace() for c in secret) else None

def _connection():
    parent=Path(os.environ.get('AIMARKET_WORLD_STATE_DB','/app/state/holder_world.sqlite3')).parent
    if parent.is_symlink() or parent.resolve()!=parent or not parent.is_dir():
        raise OSError('state_unavailable')
    path=parent/'world_gold_delivery.sqlite3'
    if path.is_symlink():raise OSError('state_unavailable')
    try:
        fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        os.close(fd)
    except FileExistsError:
        if not path.is_file() or path.is_symlink():raise OSError('state_unavailable')
    if os.name=='posix' and path.stat().st_mode&0o077:raise OSError('state_unavailable')
    db=sqlite3.connect(path,timeout=5,isolation_level=None)
    db.row_factory=sqlite3.Row
    try:
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('PRAGMA synchronous=FULL')
        db.execute('CREATE TABLE IF NOT EXISTS delivery_receipts(order_id TEXT PRIMARY KEY,wallet TEXT NOT NULL,product TEXT NOT NULL,status TEXT NOT NULL,reference TEXT NOT NULL,result_json TEXT,document_json TEXT,canonical TEXT,created_ms INTEGER NOT NULL)')
        db.execute("CREATE TRIGGER IF NOT EXISTS world_gold_receipt_no_update BEFORE UPDATE ON delivery_receipts BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RECEIPT'); END")
        db.execute("CREATE TRIGGER IF NOT EXISTS world_gold_receipt_no_delete BEFORE DELETE ON delivery_receipts BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RECEIPT'); END")
    except BaseException:
        db.close()
        raise
    return db

def _load_report():
    from web import imd_daily
    report=imd_daily.latest()
    if report is not None and not imd_daily.valid_report(report):
        raise ValueError('invalid_published_report')
    return report

def _envelope(order):
    return dict(schema=SCHEMA,orderId=order['orderId'],wallet=order['wallet'],product=order['product'])

def _result(order,row,read):
    response=_envelope(order)
    if row['status']=='failed':
        return dict(response,kind='terminal-failure',code='REPORT_TOO_LARGE',proof=dict(kind='provider-confirmed-nondelivery',reference=row['reference']))
    if read:
        return dict(response,kind='delivered',reference=row['reference'],document=json.loads(row['document_json']),canonical=row['canonical'])
    return dict(response,kind='delivered',result=json.loads(row['result_json']))

def handle(path,raw,header,*,now=None,load_report=None):
    """Return (status, bytes, response_signature). No auth failure opens a DB."""
    now=now or (lambda:int(time.time()*1000))
    secret=_secret();at=now()
    match=re.fullmatch(r'v1\.(\d{10})\.[a-f0-9]{64}',header or '')
    if (path not in {PREFIX+'deliver',PREFIX+'read'} or not secret or type(at)is not int or at<=0
            or len(raw)>2048 or not match or abs(int(match[1])-at//1000)>30
            or not hmac.compare_digest(signature(secret,'request',path,match[1],raw),header)):
        return 403,_raw({'error':'DELIVERY_AUTH_REQUIRED'}),None
    try:
        def unique(entries):
            keys=[k for k,_ in entries]
            if len(keys)!=len(set(keys)):raise ValueError()
            return dict(entries)
        order=json.loads(raw.decode('utf8'),object_pairs_hook=unique)
        read=path.endswith('/read')
        keys={'orderId','wallet','product'}|({'reference'}if read else set())
        if (not isinstance(order,dict) or set(order)!=keys or not HEX.fullmatch(str(order.get('orderId','')))
                or not ADDRESS.fullmatch(str(order.get('wallet',''))) or order.get('product')!='research'
                or read and not REFERENCE.fullmatch(str(order.get('reference','')))):
            raise ValueError()
    except (ValueError,UnicodeError,TypeError):
        return 400,_raw({'error':'INVALID_DELIVERY_REQUEST'}),None
    db=None
    try:
        db=_connection();db.execute('BEGIN IMMEDIATE')
        row=db.execute('SELECT * FROM delivery_receipts WHERE order_id=?',(order['orderId'],)).fetchone()
        if row is None and read:
            db.execute('ROLLBACK');return 404,_raw({'error':'REPORT_NOT_FOUND'}),None
        if row is not None and (row['wallet']!=order['wallet'] or row['product']!=order['product'] or read and row['reference']!=order['reference']):
            db.execute('ROLLBACK');return 409,_raw({'error':'ORDER_BINDING_CONFLICT'}),None
        if row is None:
            report=(load_report or _load_report)()
            if report is None:
                payload=dict(_envelope(order),kind='pending')
            else:
                if (not isinstance(report,dict) or not REFERENCE.fullmatch(str(report.get('report_id','')))
                        or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',str(report.get('report_date','')))):
                    raise ValueError('invalid_report')
                canonical=_raw({k:v for k,v in report.items() if k!='report_id'})+b'\n'
                if hashlib.sha256(canonical).hexdigest()!=report['report_id']:raise ValueError('invalid_report_hash')
                document=_raw(report)
                failed=len(document)>MAX_DOCUMENT
                result=dict(provider='aimarket-vps-v1',report=f"AIMarket 已發布研究日報 / Published research: {report['report_date']}",reportId=report['report_id'],reportDate=report['report_date'],documentHash=report['report_id'])
                db.execute('INSERT INTO delivery_receipts VALUES(?,?,?,?,?,?,?,?,?)',(order['orderId'],order['wallet'],order['product'],'failed'if failed else 'delivered',order['orderId']if failed else report['report_id'],None if failed else _raw(result).decode(),None if failed else document.decode(),None if failed else canonical.decode(),at))
                row=db.execute('SELECT * FROM delivery_receipts WHERE order_id=?',(order['orderId'],)).fetchone()
                payload=_result(order,row,read)
        else:
            payload=_result(order,row,read)
        db.execute('COMMIT')
        fresh=now()
        if type(fresh)is not int or fresh<at:raise ValueError('invalid_clock')
        response=_raw(payload)
        return 200,response,signature(secret,'response',path,str(fresh//1000),response)
    except (OSError,sqlite3.Error,ValueError,TypeError,UnicodeError):
        if db is not None and db.in_transaction:db.execute('ROLLBACK')
        return 503,_raw({'error':'DELIVERY_UNAVAILABLE'}),None
    finally:
        if db is not None:db.close()

def install(app):
    from fastapi import Request
    from starlette.responses import Response
    from starlette.concurrency import run_in_threadpool
    @app.post(PREFIX+'{action}')
    async def delivery(request:Request,action:str):
        if request.url.query or request.headers.get('content-type','').split(';')[0]!='application/json':
            return Response(_raw({'error':'BAD_REQUEST'}),status_code=400,media_type='application/json')
        raw=bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw)>2048:return Response(_raw({'error':'BAD_REQUEST'}),status_code=413,media_type='application/json')
        status,body,proof=await run_in_threadpool(handle,PREFIX+action,bytes(raw),request.headers.get('x-ember-gold-signature',''))
        headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}
        if proof:headers['X-Ember-Gold-Signature']=proof
        return Response(body,status_code=status,media_type='application/json',headers=headers)
