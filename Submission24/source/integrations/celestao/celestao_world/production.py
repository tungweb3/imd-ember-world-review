"""Production wrapper around the unchanged, published canonical application."""
import os
from pathlib import Path
if os.getenv('CELESTAO_ENV')!='production':raise RuntimeError('PRODUCTION_ENTRY_ONLY')
from backend.report_plain_release.app import app as native_app
from .config import Settings
from .native import NativeEngine
from .app import make_app
settings=Settings.from_environment()
processor=NativeEngine(native_app) if settings.enabled and settings.delivery_secret else None
app=make_app(native_app,settings,processor=processor,frontend=Path('/app/world_wallet_web'))
