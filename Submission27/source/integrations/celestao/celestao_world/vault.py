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
class DocumentTooLarge(VaultError): pass
# Only a delivery tells this vault about a paid order, so a run World admitted stays this long after its window.
UNPAID_GRACE_MS=30*86400000
# Attempts that end with no report saved before the order is refunded. An engine that is only unavailable does not count.
FAILED_ATTEMPTS_LIMIT=3
# And not before this long after the first of them, so a bad deployment or an outage can be seen and fixed before it refunds every open order.
FAILED_ATTEMPTS_SPAN_MS=3600000
# A fault that says nothing about the order waits, but not for ever: a buyer who paid gets the report or the money back.
WAIT_LIMIT_MS=24*3600000
# A refunded order's birth details stay this long, so problems can be handled. The privacy page states this number.
FAILED_RETENTION_MS=30*86400000
PRUNE_BATCH=50

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
        CREATE TABLE IF NOT EXISTS pruned_runs(id TEXT PRIMARY KEY,owner TEXT NOT NULL);
        ''')
        # Additive. A run without this mark counts as sent to World, so an older version's rows are safe however it is upgraded or rolled back.
        if 'unadmitted' not in {r['name'] for r in self.db.execute('PRAGMA table_info(runs)')}:
            self.db.execute('ALTER TABLE runs ADD COLUMN unadmitted INTEGER')
        # Additive too. A retired run can still be delivered; only a new request's search skips it.
        if 'retired' not in {r['name'] for r in self.db.execute('PRAGMA table_info(runs)')}:
            self.db.execute('ALTER TABLE runs ADD COLUMN retired INTEGER')
        if 'failed_attempts' not in {r['name'] for r in self.db.execute('PRAGMA table_info(runs)')}:
            self.db.execute('ALTER TABLE runs ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0')
        if 'first_failed_ms' not in {r['name'] for r in self.db.execute('PRAGMA table_info(runs)')}:
            self.db.execute('ALTER TABLE runs ADD COLUMN first_failed_ms INTEGER')
        if 'failed_ms' not in {r['name'] for r in self.db.execute('PRAGMA table_info(runs)')}:
            self.db.execute('ALTER TABLE runs ADD COLUMN failed_ms INTEGER')
        if 'first_waited_ms' not in {r['name'] for r in self.db.execute('PRAGMA table_info(runs)')}:
            self.db.execute('ALTER TABLE runs ADD COLUMN first_waited_ms INTEGER')
        self.db.execute('CREATE INDEX IF NOT EXISTS runs_input ON runs(owner,system,input_hash)')
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
            # No buyer ever received these ids.
            self.db.execute("DELETE FROM runs WHERE id IN (SELECT id FROM runs WHERE state='prepared' AND order_id IS NULL AND unadmitted=1 AND expires_ms<=? LIMIT 50)",(now,))
            old=self.db.execute('SELECT * FROM runs WHERE owner=? AND request_id=?',(owner,request_id)).fetchone()
            if old:
                if old['system']!=system or old['input_hash']!=digest: raise VaultError('IDEMPOTENCY_CONFLICT')
                if old['state']=='failed':
                    # Refunded, so the page's kept request may buy again. The old row keeps its id and order for a late delivery or refund.
                    self.db.execute("UPDATE runs SET request_id=request_id||'~'||id WHERE id=?",(old['id'],))
                    old=None
            if not old:
                # A reload loses the page's request id. The same reading keeps its run, and so its one World order, so it cannot be paid for twice.
                # A failed run was refunded, so that reading can be bought again. A retired run that did get an order still counts.
                old=self.db.execute("SELECT * FROM runs WHERE owner=? AND system=? AND input_hash=? AND state<>'failed' AND (retired IS NULL OR order_id IS NOT NULL) ORDER BY state='complete' DESC,order_id IS NOT NULL DESC,created_ms DESC,id LIMIT 1",(owner,system,digest)).fetchone()
            if old:
                # A repeat reopens the window; World does the same for its checkout.
                if old['state']=='prepared' and old['order_id'] is None and old['expires_ms']<=now:
                    self.db.execute('UPDATE runs SET expires_ms=? WHERE id=?',(now+900000,old['id']))
                    old=self.db.execute('SELECT * FROM runs WHERE id=?',(old['id'],)).fetchone()
                return self._run_view(old)
            rid=secrets.token_urlsafe(32)
            self.db.execute('INSERT INTO runs(id,owner,request_id,system,input_hash,input_blob,created_ms,expires_ms,unadmitted) VALUES(?,?,?,?,?,?,?,?,1)',
                (rid,owner,request_id,system,digest,self._seal(payload,owner+'|run|'+rid,32768),now,now+900000))
            return dict(self._run_view(self.db.execute('SELECT * FROM runs WHERE id=?',(rid,)).fetchone()),fresh=True)
    @staticmethod
    def _run_view(row):
        return {k:row[k] for k in ('id','system','input_hash','created_ms','expires_ms','order_id','state','result_id','failure')}
    def run(self,wallet,rid):
        with self._lock:
            row=self.db.execute('SELECT * FROM runs WHERE id=? AND owner=?',(rid,self.owner(wallet))).fetchone()
            if not row: raise Missing('NOT_FOUND')
            return self._run_view(row)
    def was_pruned(self,wallet,rid):
        """This vault itself removed the run. A run simply not found could mean a wrong or restored database, which must not refund anything."""
        with self._lock:
            return self.db.execute('SELECT 1 FROM pruned_runs WHERE id=? AND owner=?',(rid,self.owner(wallet))).fetchone() is not None
    def forget_unpaid(self,wallet,rid):
        """Remove a run this request just made, when World refused it and no other request had it admitted."""
        with self._transaction():
            self.db.execute("DELETE FROM runs WHERE id=? AND owner=? AND state='prepared' AND order_id IS NULL AND unadmitted=1",(rid,self.owner(wallet)))
    def admit(self,wallet,rid):
        """World accepted this run: from here its id can reach a buyer, and a paid order can exist."""
        with self._transaction():
            if self.db.execute('UPDATE runs SET unadmitted=NULL WHERE id=? AND owner=?',(rid,self.owner(wallet))).rowcount!=1:raise Missing('NOT_FOUND')
    def prune_unpaid(self,now):
        at(now)
        with self._transaction():
            rows=self.db.execute("SELECT id,owner FROM runs WHERE state='prepared' AND order_id IS NULL AND unadmitted IS NULL AND expires_ms<=? LIMIT 50",(now-UNPAID_GRACE_MS,)).fetchall()
            # Only the opaque id and owner digest stay: a paid order delivered after this is refunded rather than refused for ever.
            self.db.executemany('INSERT OR IGNORE INTO pruned_runs(id,owner) VALUES(?,?)',[(r['id'],r['owner']) for r in rows])
            self.db.executemany('DELETE FROM runs WHERE id=?',[(r['id'],) for r in rows])
    def prune_failed(self,now):
        """A failed run can only ever answer terminal-failure, and its tombstone still does. Returns how many left, at most PRUNE_BATCH."""
        at(now)
        with self._transaction():
            # The retention starts here, so a failure by any route, the operator tool or an older version counts, and it can only start late.
            self.db.execute("UPDATE runs SET failed_ms=? WHERE state='failed' AND failed_ms IS NULL",(now,))
            rows=self.db.execute("SELECT id,owner FROM runs WHERE state='failed' AND failed_ms<=? LIMIT ?",(now-FAILED_RETENTION_MS,PRUNE_BATCH)).fetchall()
            self.db.executemany('INSERT OR IGNORE INTO pruned_runs(id,owner) VALUES(?,?)',[(r['id'],r['owner']) for r in rows])
            self.db.executemany('DELETE FROM runs WHERE id=?',[(r['id'],) for r in rows])
            return len(rows)
    def retire_lapsed(self,wallet,rid):
        """World says this run's quoted order ran out unpaid: it can never be paid, and its checkout cannot be quoted again.
        A new run takes over its request and input. A delivery would still work on this row."""
        with self._transaction():
            row=self.db.execute('SELECT state,order_id,retired FROM runs WHERE id=? AND owner=?',(rid,self.owner(wallet))).fetchone()
            if not row: raise Missing('NOT_FOUND')
            if row['retired']: return
            if row['state']!='prepared' or row['order_id'] is not None: raise VaultError('ORDER_CONFLICT')
            self.db.execute("UPDATE runs SET retired=1,request_id=request_id||'~'||id WHERE id=?",(rid,))
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
        if len(raw)>MAX_REPORT_BYTES: raise DocumentTooLarge('DOCUMENT_TOO_LARGE')
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
    def strike(self,wallet,rid,attempt,now):
        """This attempt ended with no report saved. True once that has happened often enough, over long enough, to fail the run, which refunds the order."""
        at(now)
        with self._transaction():
            if self.db.execute("UPDATE runs SET failed_attempts=failed_attempts+1,first_failed_ms=COALESCE(first_failed_ms,?) WHERE id=? AND owner=? AND state='working' AND attempt=? AND result_id IS NULL",(now,rid,self.owner(wallet),attempt)).rowcount!=1:return False
            row=self.db.execute('SELECT failed_attempts,first_failed_ms FROM runs WHERE id=?',(rid,)).fetchone()
            if row['failed_attempts']<FAILED_ATTEMPTS_LIMIT or now-row['first_failed_ms']<FAILED_ATTEMPTS_SPAN_MS:return False
            self.db.execute("UPDATE runs SET state='failed',failure='CHART_NOT_GENERATED' WHERE id=?",(rid,))
            return True
    def note_wait(self,wallet,rid,attempt,now):
        """This attempt hit a fault that says nothing about the order. True once the first such fault is WAIT_LIMIT_MS old, which fails the run and refunds the order."""
        at(now)
        with self._transaction():
            if self.db.execute("UPDATE runs SET first_waited_ms=COALESCE(first_waited_ms,?) WHERE id=? AND owner=? AND state='working' AND attempt=? AND result_id IS NULL",(now,rid,self.owner(wallet),attempt)).rowcount!=1:return False
            first=self.db.execute('SELECT first_waited_ms FROM runs WHERE id=?',(rid,)).fetchone()['first_waited_ms']
            if now-first<WAIT_LIMIT_MS:return False
            self.db.execute("UPDATE runs SET state='failed',failure='CHART_NOT_GENERATED' WHERE id=?",(rid,))
            return True
    def stuck(self):
        """Paid orders this vault has heard of and has no report for, oldest first. No wallet or birth data."""
        with self._lock:
            return [dict(r) for r in self.db.execute("SELECT order_id,system,state,created_ms,lease_ms,failed_attempts FROM runs WHERE order_id IS NOT NULL AND state IN ('prepared','working') ORDER BY created_ms,id LIMIT 200")]
    def abandon(self,order_id):
        """An operator ends a paid order that has no report. A computation still running can no longer save one, because complete() needs the state it had."""
        if not isinstance(order_id,str) or not re.fullmatch(r'0x[0-9a-f]{64}',order_id): raise VaultError('INVALID_ORDER')
        with self._transaction():
            row=self.db.execute('SELECT state FROM runs WHERE order_id=?',(order_id,)).fetchone()
            if not row: raise Missing('NOT_FOUND')
            if row['state']=='complete': raise VaultError('REPORT_SAVED')
            if row['state']=='failed': return False
            self.db.execute("UPDATE runs SET state='failed',failure='CHART_NOT_GENERATED' WHERE order_id=?",(order_id,))
            return True
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
