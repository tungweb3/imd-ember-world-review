"""AIMarket's narrow consumer of Ember World's verified wallet identity.

Only opaque, host-only cookies reach the browser. A World identity is never an
owner role or a holding/payment claim: research still checks EMBEO on mainnet.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

ISSUER = "https://imdember.com"
WORLD_ORIGIN = ISSUER  # Tests may patch the transport only; deployment cannot override this.
CLIENT_ID = "aimarket"
CALLBACK = "https://aimarket.trade/api/holder/world/callback"
PORTAL_ORIGIN = "https://research.imdember.com"
PORTAL_CALLBACK = PORTAL_ORIGIN + "/api/holder/world/callback"
PORTAL_HEADER = "X-Ember-Research-Context"
FLOW_COOKIE = "__Host-aim_world_flow"
COOKIE = "__Host-aim_world_holder"
FLOW_SECONDS = 300
SESSION_SECONDS = 3600
_OPAQUE = re.compile(r"^[A-Za-z0-9_-]{43}$")
_ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
_FIELDS = {"issuer", "audience", "scope", "address", "expires_at", "bridge_session"}


def portal_request_allowed(method: str, path: str, query: str) -> bool:
    if method == "POST":
        return path == "/api/holder/logout" and not query
    if method not in {"GET", "HEAD"}:
        return False
    fixed = {"/", "/portal-result", "/api/owner/status", "/api/holder/status", "/api/holder/world/start", "/api/holder/world/callback",
        "/api/public/overview", "/api/public/quotes", "/api/public/btc", "/api/public/services", "/api/imd-daily/preview", "/api/imd-daily/latest",
        "/api/imd-daily/history", "/api/new-tokens/preview", "/api/new-tokens/latest"}
    static = bool(re.fullmatch(r"/public/(?:hero\.jpg|(?:app|holder-access|research-detail|imd-daily|new-tokens|portal-result|gate)\.js|(?:site|holder-access|research-detail|imd-daily|new-tokens|player|gate)\.css|vendor/lightweight-charts-5\.2\.1\.js|audio/[a-z0-9-]+\.mp3)", path))
    if path not in fixed and not static and not re.fullmatch(r"/api/public/assets/(BTC|ETH)/(research|chart)", path) and not re.fullmatch(r"/api/imd-daily/(?:\d{4}-\d{2}-\d{2}|previous/[a-f0-9]{64})", path):
        return False
    keys = {"portal", "lang", "world_login", "expected_address"} if path == "/" else {"lang", "world_login"} if path == "/portal-result" else {"v"} if static else {"lang", "expected_address"} if path.endswith("/start") else {"lang", "state", "code", "error"} if path.endswith("/callback") else {"interval"} if path.endswith("/chart") else {"limit"} if path.endswith("/history") else set()
    seen = set()
    for key, value in urllib.parse.parse_qsl(query, keep_blank_values=True):
        if key not in keys or key in seen or len(value) > 160:
            return False
        seen.add(key)
    return True


def portal_context(method: str, path: str, query: str, header: str, cookie: str) -> bool:
    """Server-only proxy proof; browser origin/address hints confer no authority."""
    if not enabled() or not isinstance(header, str) or not re.fullmatch(r"v1\.\d{10}\.[a-f0-9]{64}", header):
        return False
    _, timestamp, supplied = header.split(".")
    if abs(int(timestamp) - _now_ms() // 1000) > 30:
        return False
    selected = {}
    for item in cookie.split(";"):
        name, separator, value = item.partition("=")
        name, value = name.strip(), value.strip()
        if name not in {FLOW_COOKIE, COOKIE}:
            continue
        if not separator or name in selected or not _OPAQUE.fullmatch(value):
            return False
        selected[name] = value
    filtered = "; ".join(name + "=" + selected[name] for name in sorted(selected))
    payload = "ember-research-proxy-v1\n" + method + "\n" + path + "\n" + query + "\n" + timestamp + "\n" + hashlib.sha256(filtered.encode()).hexdigest()
    expected = hmac.new(os.environ["AIMARKET_BRIDGE_SECRET"].encode(), payload.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(supplied, expected)


class BridgeUnavailable(Exception):
    """World cannot establish an authoritative identity right now."""


class BridgeDenied(Exception):
    """Invalid, expired, replayed, or revoked authorization."""


def enabled() -> bool:
    secret = os.environ.get("AIMARKET_BRIDGE_SECRET", "")
    return len(secret) >= 32 and not any(char.isspace() for char in secret)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("ascii")).hexdigest()


def _db() -> sqlite3.Connection:
    configured = os.environ.get("AIMARKET_WORLD_STATE_DB")
    path = Path(configured) if configured else Path(__file__).resolve().parent.parent / "state" / "holder_world.sqlite3"
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=5)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout=5000")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS world_flows (
            state_hash TEXT PRIMARY KEY, flow_hash TEXT NOT NULL, verifier TEXT NOT NULL,
            expires_at INTEGER NOT NULL, lang TEXT NOT NULL, expected_address TEXT,
            claimed_at INTEGER, redirect_uri TEXT NOT NULL DEFAULT 'https://aimarket.trade/api/holder/world/callback'
        );
        CREATE INDEX IF NOT EXISTS world_flows_expiry ON world_flows(expires_at);
        CREATE TABLE IF NOT EXISTS world_sessions (
            token_hash TEXT PRIMARY KEY, address TEXT NOT NULL, bridge_session TEXT NOT NULL,
            expires_at INTEGER NOT NULL, flow_hash TEXT, profile TEXT NOT NULL DEFAULT 'external'
        );
        CREATE INDEX IF NOT EXISTS world_sessions_expiry ON world_sessions(expires_at);
    """)
    # Migrate an earlier isolated candidate, serialized with other workers.
    with db:
        db.execute("BEGIN IMMEDIATE")
        if "claimed_at" not in {row[1] for row in db.execute("PRAGMA table_info(world_flows)")}:
            db.execute("ALTER TABLE world_flows ADD COLUMN claimed_at INTEGER")
        if "flow_hash" not in {row[1] for row in db.execute("PRAGMA table_info(world_sessions)")}:
            db.execute("ALTER TABLE world_sessions ADD COLUMN flow_hash TEXT")
        if "redirect_uri" not in {row[1] for row in db.execute("PRAGMA table_info(world_flows)")}:
            db.execute("ALTER TABLE world_flows ADD COLUMN redirect_uri TEXT NOT NULL DEFAULT 'https://aimarket.trade/api/holder/world/callback'")
        if "profile" not in {row[1] for row in db.execute("PRAGMA table_info(world_sessions)")}:
            db.execute("ALTER TABLE world_sessions ADD COLUMN profile TEXT NOT NULL DEFAULT 'external'")
    # The database contains a server-to-server session capability, never public data.
    if os.name != "nt":
        path.chmod(0o600)
    return db


@dataclass(frozen=True)
class LoginStart:
    url: str
    flow_cookie: str


@dataclass(frozen=True)
class LoginResult:
    token: str
    address: str
    expires_at: int
    lang: str


def begin_login(lang: str = "en", expected_address: str | None = None, *, profile: str = "external") -> LoginStart:
    if not enabled():
        raise BridgeUnavailable("bridge_not_configured")
    lang = "zh" if lang in {"zh", "zh-Hant"} else "en"
    if expected_address is not None and not _ADDRESS.fullmatch(expected_address):
        raise BridgeDenied("invalid_address")
    if profile not in {"external", "world"}:
        raise BridgeDenied("invalid_profile")
    callback = PORTAL_CALLBACK if profile == "world" else CALLBACK
    state, flow, verifier = (secrets.token_urlsafe(32) for _ in range(3))
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).rstrip(b"=").decode("ascii")
    db = _db()
    try:
        with db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM world_flows WHERE expires_at<=?", (_now_ms(),))
            db.execute("DELETE FROM world_sessions WHERE expires_at<=?", (_now_ms(),))
            if db.execute("SELECT count(*) FROM world_flows").fetchone()[0] >= 2048:
                raise BridgeUnavailable("bridge_busy")
            db.execute("INSERT INTO world_flows(state_hash,flow_hash,verifier,expires_at,lang,expected_address,redirect_uri) VALUES (?,?,?,?,?,?,?)", (
                _digest(state), _digest(flow), verifier, _now_ms() + FLOW_SECONDS * 1000,
                lang, expected_address.lower() if expected_address else None, callback))
    finally:
        db.close()
    query = dict(client_id=CLIENT_ID, response_type="code", redirect_uri=callback,
                 code_challenge_method="S256", code_challenge=challenge, state=state, lang=lang)
    if expected_address:
        query["expected_address"] = expected_address.lower()
    return LoginStart(WORLD_ORIGIN + "/api/aimarket-auth/authorize?" + urllib.parse.urlencode(query), flow)


def _consume_flow(state: str, flow: str) -> dict:
    if not isinstance(state, str) or not _OPAQUE.fullmatch(state) or not isinstance(flow, str) or not _OPAQUE.fullmatch(flow):
        raise BridgeDenied("invalid_state")
    db = _db()
    try:
        with db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM world_flows WHERE state_hash=? AND flow_hash=? AND expires_at>? AND claimed_at IS NULL",
                             (_digest(state), _digest(flow), _now_ms())).fetchone()
            if row is None:
                raise BridgeDenied("expired_or_used_state")
            db.execute("UPDATE world_flows SET claimed_at=? WHERE state_hash=?", (_now_ms(), _digest(state)))
            return dict(row)
    finally:
        db.close()


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def _world_post(path: str, data: dict) -> dict:
    if not enabled() or path not in {"/token", "/session"}:
        raise BridgeUnavailable("bridge_not_configured")
    request = urllib.request.Request(WORLD_ORIGIN + "/api/aimarket-auth" + path,
        data=json.dumps(data, separators=(",", ":")).encode("utf-8"), method="POST",
        headers={"Authorization": "Bearer " + os.environ["AIMARKET_BRIDGE_SECRET"],
                 "Content-Type": "application/json", "Accept": "application/json",
                 "User-Agent": "AIMarket-World-Bridge/2.0"})
    try:
        opener = urllib.request.build_opener(_NoRedirect())
        with opener.open(request, timeout=8) as response:
            if response.status != 200 or response.headers.get_content_type() != "application/json":
                raise BridgeUnavailable("invalid_world_response")
            raw = response.read(8193)
            if len(raw) > 8192:
                raise BridgeUnavailable("invalid_world_response")
            return json.loads(raw)
    except urllib.error.HTTPError as exc:
        if exc.code in {400, 401, 403}:
            raise BridgeDenied("world_authorization_denied") from None
        raise BridgeUnavailable("world_unavailable") from None
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, TypeError):
        raise BridgeUnavailable("world_unavailable") from None


def _identity(payload: dict, bridge_session: str | None = None) -> dict:
    allowed = [_FIELDS] if bridge_session is None else [_FIELDS, _FIELDS - {"bridge_session"}]
    allowed += [fields | {"world_trial"} for fields in list(allowed)]
    if not isinstance(payload, dict) or set(payload) not in allowed:
        raise BridgeUnavailable("invalid_world_response")
    payload = dict(payload)
    if bridge_session is not None and "bridge_session" not in payload:
        payload["bridge_session"] = bridge_session
    expiry = payload["expires_at"]
    now = _now_ms()
    if (payload["issuer"] != ISSUER or payload["audience"] != CLIENT_ID or payload["scope"] != "research:read"
            or not isinstance(payload["address"], str) or not _ADDRESS.fullmatch(payload["address"])
            or not isinstance(payload["bridge_session"], str) or not _OPAQUE.fullmatch(payload["bridge_session"])
            or type(expiry) is not int or expiry > now + 7 * 86400_000 + 60_000):
        raise BridgeUnavailable("invalid_world_response")
    trial = payload.get("world_trial")
    if trial is not None and (not isinstance(trial, dict) or set(trial) != {"active", "endsMs", "version"}
            or type(trial["active"]) is not bool or type(trial["version"]) is not int or trial["version"] < 1
            or (trial["endsMs"] is not None and type(trial["endsMs"]) is not int)
            or (trial["active"] and trial["endsMs"] is None)):
        raise BridgeUnavailable("invalid_world_trial")
    # Latency/clock skew can cross the campaign boundary after World replied.
    # Expiry removes only the trial grant; the authenticated holder path survives.
    if expiry <= now:
        raise BridgeDenied("source_session_expired")
    if trial is not None and trial["active"] and trial["endsMs"] <= now:
        payload["world_trial"] = dict(trial, active=False)
    return dict(payload, address=payload["address"].lower())


def _world_trial(identity: dict, *, profile: str | None) -> bool:
    """Only a fresh, authenticated World introspection can grant a trial.

    Public/external profile keeps its disconnected teaser. A failed/ended trial
    never falls back to a previously cached trial grant.
    """
    trial = identity.get("world_trial")
    return bool(profile == "world" and isinstance(trial, dict) and trial.get("active") is True
                and type(trial.get("endsMs")) is int and _now_ms() < trial["endsMs"])


def flow_language(state: str, flow: str) -> str:
    if not isinstance(state, str) or not _OPAQUE.fullmatch(state) or not isinstance(flow, str) or not _OPAQUE.fullmatch(flow):
        return "en"
    db = _db()
    try:
        row = db.execute("SELECT lang FROM world_flows WHERE state_hash=? AND flow_hash=? AND expires_at>?",
                         (_digest(state), _digest(flow), _now_ms())).fetchone()
        return row[0] if row else "en"
    finally:
        db.close()


def cancel_flow(flow: str) -> None:
    """Cancel pending and already-claimed callbacks when this browser logs out."""
    if not isinstance(flow, str) or not _OPAQUE.fullmatch(flow):
        return
    db = _db()
    try:
        with db:
            db.execute("DELETE FROM world_flows WHERE flow_hash=?", (_digest(flow),))
            # Also wins when callback committed but its Set-Cookie is still in flight.
            db.execute("DELETE FROM world_sessions WHERE flow_hash=?", (_digest(flow),))
    finally:
        db.close()


def _balance(address: str, *, fresh: bool = False) -> bool:
    from web import holder_auth
    return holder_auth.eligible_address(address, fresh=fresh)


def complete_login(state: str, flow: str, code: str, *, denied: bool = False, profile: str | None = None) -> LoginResult:
    row = _consume_flow(state, flow)
    callback = row["redirect_uri"]
    if callback not in {CALLBACK, PORTAL_CALLBACK} or (profile is not None and callback != (PORTAL_CALLBACK if profile == "world" else CALLBACK)):
        raise BridgeDenied("invalid_profile")
    if denied or not isinstance(code, str) or not _OPAQUE.fullmatch(code):
        raise BridgeDenied("world_authorization_denied")
    identity = _identity(_world_post("/token", dict(grant_type="authorization_code", client_id=CLIENT_ID,
        redirect_uri=callback, code=code, code_verifier=row["verifier"])))
    address = identity["address"]
    if row["expected_address"] and not hmac.compare_digest(row["expected_address"], address):
        raise BridgeDenied("wallet_changed")
    if callback == PORTAL_CALLBACK:
        checked = _identity(_world_post("/session", dict(client_id=CLIENT_ID, bridge_session=identity["bridge_session"])), identity["bridge_session"])
        if checked["address"] != address:
            raise BridgeDenied("wallet_changed")
        identity = checked
    if not _world_trial(identity, profile="world" if callback == PORTAL_CALLBACK else "external") and not _balance(address, fresh=True):
        raise BridgeDenied("holding_required")
    token = secrets.token_urlsafe(32)
    expiry = min(identity["expires_at"], _now_ms() + SESSION_SECONDS * 1000)
    if expiry <= _now_ms():
        raise BridgeDenied("source_session_expired")
    db = _db()
    try:
        with db:
            db.execute("BEGIN IMMEDIATE")
            still_live = db.execute("SELECT 1 FROM world_flows WHERE state_hash=? AND flow_hash=? AND claimed_at IS NOT NULL AND expires_at>?",
                                    (_digest(state), _digest(flow), _now_ms())).fetchone()
            if still_live is None:
                raise BridgeDenied("login_cancelled")
            db.execute("INSERT INTO world_sessions(token_hash,address,bridge_session,expires_at,flow_hash,profile) VALUES (?,?,?,?,?,?)", (
                _digest(token), address, identity["bridge_session"], expiry, _digest(flow), "world" if callback == PORTAL_CALLBACK else "external"))
            db.execute("DELETE FROM world_flows WHERE state_hash=?", (_digest(state),))
    finally:
        db.close()
    return LoginResult(token, address, expiry, row["lang"])


def revoke(token: str) -> None:
    if not isinstance(token, str) or not _OPAQUE.fullmatch(token):
        return
    db = _db()
    try:
        with db:
            db.execute("DELETE FROM world_sessions WHERE token_hash=?", (_digest(token),))
    finally:
        db.close()


def session_eligible(token: str, *, require_profile: str | None = None) -> tuple[str | None, bool]:
    """Every read checks source revocation, then at most 45-second holdings.

    The caller must prefer this cookie over a legacy holder cookie, including
    when this one fails: a revoked bridge must never fall back to an old identity.
    """
    if not isinstance(token, str) or not _OPAQUE.fullmatch(token):
        return None, False
    db = _db()
    try:
        row = db.execute("SELECT * FROM world_sessions WHERE token_hash=? AND expires_at>?",
                         (_digest(token), _now_ms())).fetchone()
    finally:
        db.close()
    if row is None or (require_profile is not None and row["profile"] != require_profile):
        return None, False
    try:
        identity = _identity(_world_post("/session", dict(client_id=CLIENT_ID, bridge_session=row["bridge_session"])), row["bridge_session"])
    except BridgeDenied:
        revoke(token)
        return None, False
    if identity["address"] != row["address"] or not hmac.compare_digest(identity["bridge_session"], row["bridge_session"]):
        revoke(token)
        raise BridgeUnavailable("invalid_world_response")
    eligible = _world_trial(identity, profile="world" if row["profile"] == "world" and require_profile == "world" else None) or _balance(row["address"])
    # Re-read after network I/O: a concurrent local logout must win.
    db = _db()
    try:
        with db:
            expiry = min(row["expires_at"], identity["expires_at"])
            current = db.execute("UPDATE world_sessions SET expires_at=min(expires_at,?) WHERE token_hash=? AND expires_at>?",
                                 (expiry, _digest(token), _now_ms())).rowcount
    finally:
        db.close()
    if current and expiry > _now_ms():
        return row["address"], eligible
    revoke(token)
    return None, False
