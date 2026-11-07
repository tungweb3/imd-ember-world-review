"""Server-only OAuth state and opaque sessions, tied to a revocable World grant."""
import hashlib, hmac, re, secrets
from urllib.parse import urlsplit
from .vault import Vault,VaultError,Missing,at

OPAQUE=re.compile(r'[A-Za-z0-9_-]{43}')
def digest(value):return hashlib.sha256(value.encode()).hexdigest()
def valid(value):return isinstance(value,str) and OPAQUE.fullmatch(value) is not None

class Sessions:
    def __init__(self,vault:Vault,issuer='https://imdember.com'):
        parsed=urlsplit(issuer)
        if issuer!='https://imdember.com' and not (parsed.scheme=='http' and parsed.hostname in ('localhost','127.0.0.1','::1') and not parsed.path and not parsed.query and not parsed.fragment and not parsed.username and not parsed.password):raise VaultError('INVALID_ISSUER')
        self.vault=vault;self.issuer=issuer
        with vault._lock:
            vault.db.executescript('''
            CREATE TABLE IF NOT EXISTS oauth_starts(
              state_hash TEXT PRIMARY KEY,cookie_hash TEXT NOT NULL,verifier_blob BLOB NOT NULL,
              language TEXT NOT NULL,created_ms INTEGER NOT NULL,expires_ms INTEGER NOT NULL,consumed_ms INTEGER);
            CREATE TABLE IF NOT EXISTS wallet_sessions(
              token_hash TEXT PRIMARY KEY,owner TEXT NOT NULL,grant_blob BLOB NOT NULL,
              created_ms INTEGER NOT NULL,expires_ms INTEGER NOT NULL,revoked_ms INTEGER);
            CREATE INDEX IF NOT EXISTS wallet_sessions_expiry ON wallet_sessions(expires_ms);
            ''')
            # Additive upgrade for a previously initialized local/production
            # vault; report tables and encrypted documents stay untouched.
            for table,column in [('oauth_starts','superseded_ms'),('oauth_starts','issued_session_hash'),('wallet_sessions','source_state_hash')]:
                if column not in {r['name'] for r in vault.db.execute('PRAGMA table_info('+table+')')}:
                    vault.db.execute('ALTER TABLE '+table+' ADD COLUMN '+column+' '+('INTEGER' if column.endswith('_ms') else 'TEXT'))
    def begin(self,language,now,previous_cookie=None):
        at(now)
        if language not in ('zh','en'):raise VaultError('INVALID_LANGUAGE')
        state,cookie,verifier=(secrets.token_urlsafe(32) for _ in range(3));hashed=digest(state)
        with self.vault._transaction():
            if valid(previous_cookie):
                old=digest(previous_cookie)
                self.vault.db.execute('UPDATE oauth_starts SET superseded_ms=? WHERE cookie_hash=?',(now,old))
                self.vault.db.execute('UPDATE wallet_sessions SET revoked_ms=? WHERE source_state_hash IN (SELECT state_hash FROM oauth_starts WHERE cookie_hash=?) AND revoked_ms IS NULL',(now,old))
            self.vault.db.execute('DELETE FROM oauth_starts WHERE state_hash IN (SELECT state_hash FROM oauth_starts WHERE expires_ms<=? ORDER BY expires_ms LIMIT 200)',(now,))
            self.vault.db.execute('INSERT INTO oauth_starts(state_hash,cookie_hash,verifier_blob,language,created_ms,expires_ms) VALUES(?,?,?,?,?,?)',
                (hashed,digest(cookie),self.vault._seal({'verifier':verifier},'oauth|'+hashed),language,now,now+600000))
        return {'state':state,'cookie':cookie,'verifier':verifier,'language':language}
    def consume(self,state,cookie,now):
        at(now)
        if not valid(state) or not valid(cookie):raise VaultError('INVALID_STATE')
        hashed=digest(state)
        with self.vault._transaction():
            row=self.vault.db.execute('SELECT * FROM oauth_starts WHERE state_hash=? AND cookie_hash=? AND created_ms<=? AND expires_ms>? AND consumed_ms IS NULL AND superseded_ms IS NULL',(hashed,digest(cookie),now,now)).fetchone()
            if not row:raise VaultError('INVALID_STATE')
            self.vault.db.execute('UPDATE oauth_starts SET consumed_ms=? WHERE state_hash=?',(now,hashed))
            return dict(self.vault._open(row['verifier_blob'],'oauth|'+hashed),language=row['language'],source_state=hashed)
    def issue(self,grant,now,previous=None,source_state=None):
        at(now)
        if not isinstance(grant,dict) or grant.get('issuer')!=self.issuer or grant.get('audience')!='celestao' or grant.get('scope')!='fortune:account' or not valid(grant.get('bridge_session')) or type(grant.get('expires_at')) is not int or not now<grant['expires_at']<=9007199254740991:
            raise VaultError('INVALID_WORLD_GRANT')
        owner=self.vault.owner(grant.get('address'));token=secrets.token_urlsafe(32);hashed=digest(token)
        with self.vault._transaction():
            if source_state is not None:
                state=self.vault.db.execute('SELECT state_hash FROM oauth_starts WHERE state_hash=? AND created_ms<=? AND expires_ms>? AND consumed_ms IS NOT NULL AND superseded_ms IS NULL AND issued_session_hash IS NULL',(source_state,now,now)).fetchone()
                if not state:raise VaultError('SUPERSEDED_LOGIN')
                self.vault.db.execute('UPDATE oauth_starts SET issued_session_hash=? WHERE state_hash=?',(hashed,source_state))
            self.vault.db.execute('DELETE FROM wallet_sessions WHERE token_hash IN (SELECT token_hash FROM wallet_sessions WHERE expires_ms<=? LIMIT 50)',(now,))
            self.vault.db.execute('INSERT INTO wallet_sessions(token_hash,owner,grant_blob,created_ms,expires_ms,source_state_hash) VALUES(?,?,?,?,?,?)',
                (hashed,owner,self.vault._seal(grant,'session|'+hashed+'|'+owner),now,grant['expires_at'],source_state))
            if valid(previous):self.vault.db.execute('UPDATE wallet_sessions SET revoked_ms=? WHERE token_hash=? AND revoked_ms IS NULL',(now,digest(previous)))
        return token
    def read(self,token,now):
        at(now)
        if not valid(token):raise Missing('AUTH_REQUIRED')
        hashed=digest(token)
        with self.vault._lock:
            row=self.vault.db.execute('SELECT * FROM wallet_sessions WHERE token_hash=? AND created_ms<=? AND expires_ms>? AND revoked_ms IS NULL',(hashed,now,now)).fetchone()
            if not row:raise Missing('AUTH_REQUIRED')
            grant=self.vault._open(row['grant_blob'],'session|'+hashed+'|'+row['owner'])
            if self.vault.owner(grant.get('address'))!=row['owner']:raise VaultError('IDENTITY_MISMATCH')
            return grant
    def context(self,token):
        if not valid(token):raise Missing('AUTH_REQUIRED')
        return hmac.new(self.vault._index_key,('context|'+token).encode(),hashlib.sha256).hexdigest()
    def csrf(self,token):
        if not valid(token):raise Missing('AUTH_REQUIRED')
        return hmac.new(self.vault._index_key,('csrf|'+token).encode(),hashlib.sha256).hexdigest()
    def check_csrf(self,token,value):
        return isinstance(value,str) and hmac.compare_digest(self.csrf(token),value)
    def revoke(self,token,now):
        at(now)
        if valid(token):
            with self.vault._transaction():self.vault.db.execute('UPDATE wallet_sessions SET revoked_ms=? WHERE token_hash=? AND revoked_ms IS NULL',(now,digest(token)))
