"""Operator configuration. Production participants cannot come from HTTP input."""
from dataclasses import dataclass,field
from pathlib import Path
from urllib.parse import urlsplit
import os,re

def origin(value,local=False):
    p=urlsplit(value)
    if p.username or p.password or p.path or p.query or p.fragment or not p.netloc:raise ValueError('INVALID_PARTICIPANT')
    if local:
        if p.scheme!='http' or p.hostname not in ('localhost','127.0.0.1','::1'):raise ValueError('LOCAL_PARTICIPANTS_ONLY')
    elif value not in ('https://celestao.com','https://imdember.com'):raise ValueError('INVALID_PARTICIPANT')
    return value

@dataclass(frozen=True)
class Settings:
    enabled:bool=False
    paid_enabled:bool=False
    public_origin:str='https://celestao.com'
    world_origin:str='https://imdember.com'
    database:Path|None=None
    storage_key:bytes=field(default=b'',repr=False)
    bridge_secret:str=field(default='',repr=False)
    delivery_secret:str=field(default='',repr=False)
    local:bool=False
    def __post_init__(self):
        origin(self.public_origin,self.local);origin(self.world_origin,self.local)
        if not self.local and (self.public_origin!='https://celestao.com' or self.world_origin!='https://imdember.com'):raise ValueError('INVALID_PARTICIPANT')
        if self.paid_enabled and not self.enabled:raise ValueError('WALLET_REQUIRED')
        if self.enabled:
            if not self.database or len(self.storage_key)!=32:raise ValueError('PERSISTENT_VAULT_REQUIRED')
            if not isinstance(self.bridge_secret,str) or not 32<=len(self.bridge_secret)<=256 or re.search(r'\s',self.bridge_secret):raise ValueError('BRIDGE_SECRET_REQUIRED')
        if (self.paid_enabled or self.delivery_secret) and (not isinstance(self.delivery_secret,str) or not 32<=len(self.delivery_secret)<=256 or re.search(r'\s',self.delivery_secret) or self.delivery_secret==self.bridge_secret):raise ValueError('INDEPENDENT_DELIVERY_SECRET_REQUIRED')
    @property
    def callback(self):return self.public_origin+'/api/holder/world/callback'
    @property
    def session_cookie(self):return 'celestao-world-local' if self.local else '__Host-celestao-world'
    @property
    def oauth_cookie(self):return 'celestao-oauth-local' if self.local else '__Host-celestao-oauth'
    @classmethod
    def from_environment(cls):
        flags=[os.getenv(k,'0') for k in ('CELESTAO_WORLD_ENABLED','CELESTAO_WORLD_PAID_ENABLED')]
        if any(v not in ('0','1') for v in flags):raise ValueError('INVALID_FEATURE_FLAG')
        enabled,paid=(v=='1' for v in flags)
        key=os.getenv('CELESTAO_WORLD_STORAGE_KEY','')
        if enabled and not re.fullmatch(r'[0-9a-f]{64}',key):raise ValueError('STORAGE_KEY_REQUIRED')
        directory=os.getenv('CELESTAO_WORLD_DATA_DIR')
        if enabled and (not directory or not Path(directory).is_dir() or not os.access(directory,os.W_OK)):raise ValueError('WRITABLE_PERSISTENT_DIRECTORY_REQUIRED')
        return cls(enabled=enabled,paid_enabled=paid,database=Path(directory)/'wallet.sqlite' if directory else None,
            storage_key=bytes.fromhex(key) if enabled else b'',bridge_secret=os.getenv('CELESTAO_BRIDGE_SECRET',''),delivery_secret=os.getenv('CELESTAO_DELIVERY_SECRET',''))
