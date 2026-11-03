"""Encrypted, wallet-isolated storage. This module grants no payment authority.

Only an authenticated server adapter may bind/claim a World-paid order. All
record access receives the wallet verified by World, never a browser address.
"""
from __future__ import annotations
from contextlib import contextmanager
import hashlib, hmac, json, re, secrets, sqlite3, threading
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

SYSTEMS=frozenset(('bazi','ziwei','annual_ziwei','western','human','profile'))
MAX_REPORT_BYTES=20_000_000
class VaultError(ValueError): pass
class Missing(VaultError): pass

def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode('utf-8')

def at(now):
    if type(now) is not int or not 0<=now<=9007199254740991: raise VaultError('INVALID_CLOCK')
    return now

class Vault:
    def __init__(self,path:Path,key:bytes):
        if not isinstance(key,bytes) or len(key)!=32: raise VaultError('INVALID_STORAGE_KEY')
        self._cipher=AESGCM(HKDF(SHA256(),32,None,b'celestao-report-aes-v1').derive(key))
        self._index_key=HKDF(SHA256(),32,None,b'celestao-wallet-index-v1').derive(key)
        path=Path(path).resolve();path.parent.mkdir(parents=True,exist_ok=True)
        self._lock=threading.RLock()
        self.db=sqlite3.connect(path,timeout=5,isolation_level=None,check_same_thread=False)
        self.db.row_factory=sqlite3.Row
        self.db.executescript('''PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;
        CREATE TABLE IF NOT EXISTS runs(
          id TEXT PRIMARY KEY,owner TEXT NOT NULL,request_id TEXT NOT NULL,system TEXT NOT NULL,
          input_hash TEXT NOT NULL,input_blob BLOB NOT NULL,created_ms INTEGER NOT NULL,
          expires_ms INTEGER NOT NULL,order_id TEXT UNIQUE,state TEXT NOT NULL DEFAULT 'prepared',
          attempt TEXT,lease_ms INTEGER,result_id TEXT,failure TEXT,UNIQUE(owner,request_id));
        CREATE INDEX IF NOT EXISTS runs_owner ON runs(owner,created_ms);
        CREATE TABLE IF NOT EXISTS records(
          id TEXT PRIMARY KEY,run_id TEXT UNIQUE NOT NULL REFERENCES runs(id),owner TEXT NOT NULL,
          system TEXT NOT NULL,created_ms INTEGER NOT NULL,result_hash TEXT NOT NULL,
          metadata_blob BLOB NOT NULL,result_blob BLOB NOT NULL,trashed_ms INTEGER);
        CREATE INDEX IF NOT EXISTS records_owner ON records(owner,trashed_ms,created_ms,id);
        ''')
    def close(self):
        with self._lock: self.db.close()
    @contextmanager
    def _transaction(self):
        with self._lock:
            self.db.execute('BEGIN IMMEDIATE')
            try: yield;self.db.execute('COMMIT')
            except BaseException: self.db.execute('ROLLBACK');raise
    def owner(self,wallet):
        if not isinstance(wallet,str) or not re.fullmatch(r'0x[0-9a-fA-F]{40}',wallet): raise VaultError('INVALID_IDENTITY')
        return hmac.new(self._index_key,wallet.lower().encode(),hashlib.sha256).hexdigest()
    def _seal(self,value,context,limit=MAX_REPORT_BYTES):
        # Existing readers also validate ordered projection objects. Preserve
        # the exact native JSON member order; canonical() is for digests only.
        raw=json.dumps(value,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode('utf-8')
        if len(raw)>limit: raise VaultError('DOCUMENT_TOO_LARGE')
        nonce=secrets.token_bytes(12)
        return b'\x01'+nonce+self._cipher.encrypt(nonce,raw,context.encode())
    def _open(self,value,context):
        if not isinstance(value,bytes) or len(value)<30 or value[0]!=1: raise VaultError('INVALID_ENVELOPE')
        try: return json.loads(self._cipher.decrypt(value[1:13],value[13:],context.encode()))
        except Exception as exc: raise VaultError('DOCUMENT_AUTHENTICATION_FAILED') from exc
    def prepare(self,wallet,request_id,system,payload,save_consent,now):
        owner=self.owner(wallet);at(now)
        if save_consent is not True: raise VaultError('SAVE_CONSENT_REQUIRED')
        if not isinstance(system,str) or system not in SYSTEMS or not isinstance(payload,dict) or not isinstance(request_id,str) or not re.fullmatch(r'[A-Za-z0-9_-]{16,80}',request_id): raise VaultError('INVALID_REQUEST')
        raw=canonical(payload)
        if len(raw)>32768: raise VaultError('INPUT_TOO_LARGE')
        digest=hmac.new(self._index_key,b'input|'+owner.encode()+b'|'+raw,hashlib.sha256).hexdigest()
        with self._transaction():
            old=self.db.execute('SELECT * FROM runs WHERE owner=? AND request_id=?',(owner,request_id)).fetchone()
            if old:
                if old['system']!=system or old['input_hash']!=digest: raise VaultError('IDEMPOTENCY_CONFLICT')
                return self._run_view(old)
            rid=secrets.token_urlsafe(32)
            self.db.execute('INSERT INTO runs(id,owner,request_id,system,input_hash,input_blob,created_ms,expires_ms) VALUES(?,?,?,?,?,?,?,?)',
                (rid,owner,request_id,system,digest,self._seal(payload,owner+'|run|'+rid,32768),now,now+900000))
            return self._run_view(self.db.execute('SELECT * FROM runs WHERE id=?',(rid,)).fetchone())
    @staticmethod
    def _run_view(row):
        return {k:row[k] for k in ('id','system','input_hash','created_ms','expires_ms','order_id','state','result_id','failure')}
    def run(self,wallet,rid):
        with self._lock:
            row=self.db.execute('SELECT * FROM runs WHERE id=? AND owner=?',(rid,self.owner(wallet))).fetchone()
            if not row: raise Missing('NOT_FOUND')
            return self._run_view(row)
    def bind_order(self,wallet,rid,order_id):
        if not isinstance(order_id,str) or not re.fullmatch(r'0x[0-9a-f]{64}',order_id): raise VaultError('INVALID_ORDER')
        with self._transaction():
            row=self.db.execute('SELECT * FROM runs WHERE id=? AND owner=?',(rid,self.owner(wallet))).fetchone()
            if not row: raise Missing('NOT_FOUND')
            if row['order_id'] not in (None,order_id): raise VaultError('ORDER_CONFLICT')
            self.db.execute('UPDATE runs SET order_id=? WHERE id=?',(order_id,rid))
    def claim(self,wallet,rid,order_id,now):
        owner=self.owner(wallet);at(now)
        with self._transaction():
            row=self.db.execute('SELECT * FROM runs WHERE id=? AND owner=? AND order_id=?',(rid,owner,order_id)).fetchone()
            if not row: raise Missing('NOT_FOUND')
            if row['state'] in ('complete','failed') or row['state']=='working' and row['lease_ms']>now: return None
            attempt=secrets.token_urlsafe(32)
            self.db.execute("UPDATE runs SET state='working',attempt=?,lease_ms=? WHERE id=?",(attempt,now+120000,rid))
            return {'attempt':attempt,'system':row['system'],'input':self._open(row['input_blob'],owner+'|run|'+rid)}
    def complete(self,wallet,rid,attempt,result,now):
        owner=self.owner(wallet);at(now)
        if not isinstance(result,dict) or result.get('mode')!='live' or not isinstance(result.get('input'),dict) or not isinstance(result.get('schema_version'),str): raise VaultError('INVALID_RESULT')
        raw=canonical(result)
        if len(raw)>MAX_REPORT_BYTES: raise VaultError('DOCUMENT_TOO_LARGE')
        digest=hashlib.sha256(raw).hexdigest()
        with self._transaction():
            row=self.db.execute('SELECT * FROM runs WHERE id=? AND owner=?',(rid,owner)).fetchone()
            if not row: raise Missing('NOT_FOUND')
            if result.get('system')!=row['system']: raise VaultError('RESULT_SYSTEM_MISMATCH')
            if row['state']=='complete':
                saved=self.db.execute('SELECT result_hash FROM records WHERE id=?',(row['result_id'],)).fetchone()
                if row['attempt']!=attempt or not saved or saved['result_hash']!=digest: raise VaultError('DELIVERY_CONFLICT')
                return row['result_id']
            if row['state']!='working' or row['attempt']!=attempt: raise VaultError('LEASE_LOST')
            record_id=secrets.token_urlsafe(32);ctx=owner+'|record|'+record_id
            supplied=result.get('input',{}) if isinstance(result,dict) else {}
            name=supplied.get('name','') if isinstance(supplied,dict) else ''
            meta={'name':name[:40] if isinstance(name,str) else ''}
            self.db.execute('INSERT INTO records(id,run_id,owner,system,created_ms,result_hash,metadata_blob,result_blob) VALUES(?,?,?,?,?,?,?,?)',
                (record_id,rid,owner,row['system'],now,digest,self._seal(meta,ctx+'|metadata'),self._seal(result,ctx)))
            self.db.execute("UPDATE runs SET state='complete',result_id=? WHERE id=?",(record_id,rid))
            return record_id
    def fail(self,wallet,rid,attempt,code):
        if not isinstance(code,str) or not re.fullmatch(r'[A-Z0-9_]{1,32}',code): raise VaultError('INVALID_FAILURE')
        with self._transaction():
            changed=self.db.execute("UPDATE runs SET state='failed',failure=? WHERE id=? AND owner=? AND state='working' AND attempt=? AND result_id IS NULL",(code,rid,self.owner(wallet),attempt)).rowcount
            if changed!=1: raise VaultError('LEASE_LOST')
    def list(self,wallet,trash=False):
        return self.page(wallet,trash=trash)['records']
    def page(self,wallet,*,trash=False,before=None):
        owner=self.owner(wallet)
        with self._lock:
            values=[owner,int(trash)];clause=''
            if before is not None:
                if not isinstance(before,str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}',before):raise Missing('NOT_FOUND')
                cursor=self.db.execute('SELECT created_ms,id FROM records WHERE id=? AND owner=?',(before,owner)).fetchone()
                if not cursor:raise Missing('NOT_FOUND')
                clause=' AND (created_ms<? OR (created_ms=? AND id<?))';values.extend((cursor['created_ms'],cursor['created_ms'],cursor['id']))
            rows=self.db.execute('SELECT id,system,created_ms,metadata_blob FROM records WHERE owner=? AND (trashed_ms IS NOT NULL)=?'+clause+' ORDER BY created_ms DESC,id DESC LIMIT 101',values).fetchall()
            items=rows[:100]
            return {'records':[dict(id=r['id'],system=r['system'],created_ms=r['created_ms'],**self._open(r['metadata_blob'],owner+'|record|'+r['id']+'|metadata')) for r in items],
                'nextCursor':items[-1]['id'] if len(rows)>100 else None}
    def backup(self,destination:Path):
        """SQLite online backup includes committed WAL pages; no key is copied."""
        target=Path(destination).resolve()
        if target.exists():raise VaultError('BACKUP_TARGET_EXISTS')
        with self._lock:
            # Exclusive creation avoids accidentally replacing another backup.
            with target.open('xb'):pass
            copy=sqlite3.connect(target)
            try:self.db.backup(copy)
            finally:copy.close()
    def read(self,wallet,record_id):
        owner=self.owner(wallet)
        with self._lock:
            row=self.db.execute('SELECT * FROM records WHERE id=? AND owner=? AND trashed_ms IS NULL',(record_id,owner)).fetchone()
            if not row: raise Missing('NOT_FOUND')
            result=self._open(row['result_blob'],owner+'|record|'+record_id)
            if hashlib.sha256(canonical(result)).hexdigest()!=row['result_hash']: raise VaultError('DOCUMENT_DIGEST_MISMATCH')
            return result
    def receipt(self,wallet,rid):
        with self._lock:
            row=self.db.execute("SELECT r.id,r.system,r.created_ms,r.result_hash FROM records r JOIN runs x ON x.result_id=r.id WHERE x.id=? AND x.owner=? AND x.state='complete'",(rid,self.owner(wallet))).fetchone()
            if not row:raise Missing('NOT_FOUND')
            return {'schema':'celestao-receipt/v1','provider':'celestao-v1','system':row['system'],'recordId':row['id'],'documentHash':row['result_hash'],'createdMs':row['created_ms']}
    def trash(self,wallet,record_id,now,restore=False):
        at(now)
        with self._transaction():
            count=self.db.execute('UPDATE records SET trashed_ms=? WHERE id=? AND owner=?',(None if restore else now,record_id,self.owner(wallet))).rowcount
            if count!=1: raise Missing('NOT_FOUND')
