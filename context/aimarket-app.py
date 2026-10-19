"""
本機監控 Dashboard (FastAPI)
============================
把 scanner 的結果變成一個隨時可看的網頁：watchlist 表格 + 機會提醒面板。

啟動:
    source .venv/bin/activate
    uvicorn web.app:app --reload --port 8000
    # 瀏覽器開 http://127.0.0.1:8000

API:
    GET  /                   dashboard 頁面
    GET  /api/scan           讀最新一份 SCAN_*.json（不重抓，秒回）
    POST /api/rescan         背景重新掃描（抓即時資料）
    GET  /api/status         重掃進度
    GET  /api/watchlist      讀監控清單
    POST /api/watchlist      更新監控清單 {"watchlist":[{"symbol","market"}]}（唯讀模式擋下）
    POST /api/screen         背景全市場機會掃描 ?market=crypto|stocks
    GET  /api/screen_status  機會掃描進度
    GET  /api/screen_result  機會掃描結果 ?market=crypto|stocks
    GET  /api/inspect        即時看盤 ?symbol=&market=crypto|us|tw（同步，約 5~15 秒；併發上限 2）
    GET  /api/onchain        鏈上代幣風險 ?chain=&address=（同步、會連外，併發上限 2）
    GET  /api/cron/scan      定時掃描 + LINE 推播 ?key=<CRON_KEY>（需密鑰；未設 CRON_KEY 則停用）
    GET  /api/ticker         分頁頂部主要行情列 ?tab=crypto|onchain|tw|us
                             （公開唯讀、全站共用快取 60 秒、單槽併發閘、不觸發 LINE）
    GET  /api/config         前端組態（目前只有 readonly 旗標）
    POST /api/line/webhook   LINE webhook（驗簽 + 發話人比對；body 上限 64KB，處理丟背景執行緒）
    POST /api/tv/webhook     TradingView 警報收件 ?key=<TV_WEBHOOK_KEY>（未設則停用回 404）
    GET  /api/tv/alerts      最近收到的 TradingView 警報（唯讀、不含金鑰；含指標自身狀態 ext_*）
    GET  /api/tv/ext_stats   依「指標自身狀態」切片的影子統計 ?by=ext_regime|ext_action|…&family=
    GET  /api/ledger         帳本狀態 + 實測績效 ?family=&market=&symbol=&horizon=&scope=live|shadow|all
    GET  /api/ledger/families 帳本裡有哪些訊號家族 + 各自統計 ?scope=&source=&prefix=&horizon=&min_n=
    GET  /api/ck_screener    CoinKarma 四象限快照現況（站主限定；非站主整份隱藏）
    POST /api/ck_screener    貼入一則快照 {"text":"<原文>"}（站主限定；不爬取、絕不推 LINE）
    POST /api/owner/login    站主登入 {"key":"<OWNER_KEY>"} → 簽章 cookie（HttpOnly/Lax，有到期）
    POST /api/owner/logout   站主登出（清 cookie）
    GET  /api/owner/status   目前是不是站主 + 有沒有設定 OWNER_KEY

私人資料閘門（2026-09-02）:
    GET /api/onchain_watch 整份是私人資料 → 非站主回 owner_only=true、tokens=[]、count=null
    POST /api/onchain_watch 需站主身分（cookie，或 body 帶 OWNER_KEY／CRON_KEY）
    /api/ledger 與 /api/ledger/families 保持公開，但濾掉私人 family（見 _is_private_family）
    GET /api/scan 的 onchain_watch 區塊（cron 掃描會寫入合約地址+自訂 label）非站主一律遮蔽
    /api/ck_screener（GET/POST）整份是站主付費訂閱的第三方內容 → 非站主 GET 整份隱藏、POST 401
環境變數：OWNER_KEY（站主金鑰，未設＝私人區塊對所有人隱藏）、
         OWNER_SESSION_HOURS（cookie 時效，預設 12）、OWNER_LOCAL_TRUST=0（關掉本機放寬）
"""
from __future__ import annotations
import os
import re
import html as _html
import sys
import json
import hashlib
import hmac
import secrets
import sqlite3
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path

# 本機開發：把專案根目錄的 .env 讀進環境變數（`.env.example` 一直是這樣寫的，
# 但在 2026-09-06 之前只有 linebot/app.py 真的做了這件事，dashboard 沒有）。
# ⚠️ 位置很重要：本檔的 READONLY、LOCAL_OWNER_TRUST、OWNER_SESSION_HOURS 等常數
#    都是 **import 時**就從 os.environ 算好的，而 scanner / notifier 也在下面就被 import，
#    所以這段必須留在最前面，不能往下搬。
# 線上（Render）設的是真的環境變數，且 load_dotenv 預設**不覆蓋**既有值，所以不受影響；
# 沒裝 python-dotenv、或根本沒有 .env 檔時，都靜靜跳過。
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

from fastapi import FastAPI, Body, Request, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from web import holder_auth, world_auth

ROOT = Path(__file__).resolve().parent.parent
AGENT_DIR = ROOT / "agent"
REPORTS = ROOT / "reports"
WEB = ROOT / "web"
sys.path.insert(0, str(AGENT_DIR))

import scanner  # noqa: E402

try:
    from fsutil import atomic_write_text  # noqa: E402
except Exception:
    atomic_write_text = None

try:
    import notifier  # 選用：LINE 推播
except Exception:
    notifier = None


# ═══════════════════════════════════════════════════════════════════════════
# 併發閘：帶「僵死逃生門 ＋ 世代序號」的 Semaphore 替代品
# ═══════════════════════════════════════════════════════════════════════════
# 為什麼裸 threading.Semaphore 不夠：
#   本檔所有被閘住的都是「同步阻塞的對外請求」，而 **requests 的 timeout 是單一請求
#   的上限，不是總時間上限**（本專案早就踩過：twchips 實測單一請求曾 23 秒，
#   最後是自己計時才解掉）。ckmetrics.snapshot() 一次約 30 個請求、每個
#   TIMEOUT 20/40 秒又帶 Retry(total=2)，最壞疊起來是好幾分鐘甚至無限；
#   Python 又殺不掉這種執行緒。於是 try/finally 的 release() 永遠跑不到，
#   槽被一條死執行緒佔住，端點從此**每一次都回 429 且只花 0.16 秒**
#   ——2026-09-04 線上 /api/ck_metrics 就是這樣連續十幾分鐘回「計算忙碌中」。
#   `_ck_slots` 只有 1 格，所以它一卡就是全死。
#
# 設計刻意沿用 `_run_scan` 那一套（見下方 STALE_JOB_MIN / _job_gen / _job_superseded），
# 不另發明第二套語彙：
#   ① **逾時逃生**：持有超過 stale_sec 就視為持有者已死，放行新的請求進場。
#   ② **世代序號**：每次進場拿一張票（gen 單調遞增）。被逃生門宣告死亡的 gen 會記進
#      `_dead`；卡死的執行緒之後可能會醒過來，這時它手上的結果早就過期，
#      **必須寫不進快取**——否則畫面看起來完全正常，實際上是舊資料蓋掉新資料，
#      那比一直忙碌更糟（忙碌至少看得出壞了）。
#   ③ **逃生有上限**：卡死的執行緒還在跑、還在吃 0.5 CPU 與外部 API 額度
#      （幣安對單一機房 IP 有權重上限，打爆就是把自己打成 unavailable）。
#      逃生若無上限就等於無限併發；超過上限一律誠實回忙碌，並講明
#      「有 N 個先前的計算疑似卡住」。
#   ④ **遺忘門檻**：被 OOM 收掉、永遠不會 release 的執行緒若一直留在佔用表裡，
#      會慢慢把逃生額度吃光，端點又回到「永久 429」。超過 abandon_sec 就整筆移除，
#      並把 gen 留在 `_dead` ——它若真的還活著，也已經永久喪失回寫資格。
#
# ⚠️ 這一層只保證「閘門不會被卡死的執行緒永久佔住」與「過期結果寫不進快取」。
#    它**不能**縮短那條卡住的執行緒本身（Python 無法中斷同步 I/O），
#    真正的 wall-clock budget 必須做在發請求的模組裡。

#: 「這條執行緒不會再回來了」的門檻（秒）。沿用 STALE_JOB_MIN=15 分鐘同一個判準
#: ——本專案已經用這個數字當「掃描執行緒死了」的界線，這裡不另立標準。
GATE_ABANDON_SEC = 15 * 60
#: `_dead` 集合的上限。逃生是異常事件（正常運作永遠不會進來），512 已經極寬鬆；
#: 真的滿了就丟掉最舊的——那些 gen 老到就算詐屍，也會先被快取的 gen 比對擋下。
_GATE_DEAD_MAX = 512


class _SlotTicket:
    """
    一次進場憑證。

    ``gen`` 就是世代序號：卡死的執行緒醒來後，靠它比對自己是不是已經被逃生門
    宣告死亡。**不符就丟棄結果、不可回寫任何快取**（並記一行 log，
    否則這種事在線上完全看不見）。
    """
    __slots__ = ("gate", "gen", "at", "escaped", "stuck_at_entry")

    def __init__(self, gate, gen, at, escaped, stuck_at_entry):
        self.gate = gate
        self.gen = gen
        self.at = at                    # time.monotonic()：不受系統校時 / NTP 跳動影響
        self.escaped = escaped          # 這次是踩著疑似卡死的持有者進來的
        self.stuck_at_entry = stuck_at_entry

    def held_sec(self) -> float:
        return time.monotonic() - self.at

    def superseded(self) -> bool:
        """本輪是否已被逃生門取代（＝我卡太久，別人已經進場了）。"""
        return self.gate.superseded(self)


class _StaleGate:
    """
    非阻塞併發閘。`acquire()` 成功回 ticket、失敗回 None（永不排隊——排隊只會讓
    第二個請求也吃掉同一份等待時間，而且會把 uvicorn 的工作執行緒一起卡住）。

    :param limit:       正常同時上限（等同原本 Semaphore 的值）
    :param stale_sec:   超過幾秒視為持有者已死、允許逃生。必須明顯大於「健康但慢」
                        的實測耗時，否則會把正常結果誤判成過期而丟掉。
    :param escape_max:  同時最多容忍幾個「疑似卡死但還在跑」的持有者。
                        **最壞情況同時在跑的執行緒 = limit + escape_max**（有界，
                        不會變成無限併發）；卡死者超過這個數就一律誠實回忙碌。
    :param abandon_sec: 超過幾秒就把佔用紀錄整筆遺忘（見 GATE_ABANDON_SEC）
    """

    def __init__(self, name, limit, stale_sec, escape_max=None, abandon_sec=None):
        self.name = str(name)
        self.limit = max(1, int(limit))
        self.stale_sec = float(stale_sec)
        self.escape_max = self.limit if escape_max is None else max(0, int(escape_max))
        self.abandon_sec = float(abandon_sec if abandon_sec is not None else GATE_ABANDON_SEC)
        self._lock = threading.Lock()
        self._gen = 0
        self._held = {}                 # gen -> 取得時間（monotonic）
        self._dead = set()              # 被宣告死亡 / 已遺忘的 gen（＝喪失回寫資格）
        self.escapes = 0                # 累計逃生次數（診斷用；正常應該永遠是 0）

    # ── 內部：呼叫端必須已持有 self._lock ────────────────────────────────
    def _reap(self, now):
        """把老到不可能回來的佔用紀錄移除，免得逃生額度被永久吃光。"""
        gone = [g for g, t in self._held.items() if (now - t) > self.abandon_sec]
        for g in gone:
            self._held.pop(g, None)
            self._mark_dead(g)
            print("[gate:%s] 放棄追蹤 gen=%d（持有超過 %.0f 秒，視為執行緒已不存在）"
                  % (self.name, g, self.abandon_sec), file=sys.stderr)

    def _mark_dead(self, gen):
        self._dead.add(gen)
        if len(self._dead) > _GATE_DEAD_MAX:
            for g in sorted(self._dead)[:len(self._dead) - _GATE_DEAD_MAX]:
                self._dead.discard(g)

    def _split(self, now):
        live, stuck = [], []
        for g, t in self._held.items():
            (stuck if (now - t) > self.stale_sec else live).append((g, now - t))
        return live, stuck

    # ── 對外 ────────────────────────────────────────────────────────────
    def acquire(self):
        """拿一張票；擋下回 None（再用 busy_info()／busy_note() 取得誠實的說明）。"""
        now = time.monotonic()
        with self._lock:
            self._reap(now)
            live, stuck = self._split(now)
            if len(live) >= self.limit:
                return None             # 真的在忙（還沒到逃生門檻），不是卡死
            if len(stuck) > self.escape_max:
                return None             # 逃生名額用完：再放行就是無限併發
            # 宣告卡死的持有者已死。它們之後若醒來，superseded() 會擋掉回寫。
            # ⚠️ 只對「這次才新判死的」記錄與計數：一條永久停在那裡的死執行緒會被
            #    後續**每一個**請求重新看到，若每次都印一行，15 分鐘的遺忘期內
            #    會把日誌洗掉（前端還在輪詢），真正的第一現場反而找不到。
            new_dead = [(g, h) for g, h in stuck if g not in self._dead]
            if new_dead:
                for g, _h in new_dead:
                    self._mark_dead(g)
                self.escapes += 1
                print("[gate:%s] 僵死逃生門：%d 個持有者疑似卡住（最久 %.0f 秒 > 門檻 %.0f 秒），"
                      "放行新請求；它們的結果將被視為過期"
                      % (self.name, len(new_dead), max(h for _g, h in new_dead),
                         self.stale_sec), file=sys.stderr)
            self._gen += 1
            self._held[self._gen] = now
            return _SlotTicket(self, self._gen, now,
                               escaped=bool(stuck), stuck_at_entry=len(stuck))

    def release(self, ticket):
        """歸還槽位。ticket=None（acquire 失敗）時是 no-op，呼叫端不必到處判斷。"""
        if ticket is None:
            return
        with self._lock:
            self._held.pop(ticket.gen, None)

    def superseded(self, ticket) -> bool:
        """這張票是否已被逃生門宣告死亡 ⇒ **不得回寫快取**。"""
        if ticket is None:
            return True
        with self._lock:
            return ticket.gen in self._dead

    def busy_info(self) -> dict:
        """給 429 用的事實：現在是「剛好在算」還是「卡住了」，各卡了多久。"""
        now = time.monotonic()
        with self._lock:
            live, stuck = self._split(now)
            escapes = self.escapes
        return {
            "limit": self.limit,
            "running": len(live),
            "stuck": len(stuck),
            "stale_sec": round(self.stale_sec, 1),
            "escape_max": self.escape_max,
            "escapes_total": escapes,
            # held_sec = 現有持有者裡最久的那個已經跑了幾秒（沒有持有者則 None，
            # 代表這次擋下另有原因，不要顯示成 0 秒——0 會被讀成「剛開始」）。
            "held_sec": round(max([h for _g, h in (live + stuck)]), 1) if (live or stuck) else None,
            # ⚠️ 「還在正常算」與「疑似卡住」的秒數要分開報，混在一起會讓
            #    「有人卡了 10 分鐘」長得像「有人算了 10 分鐘」。
            "longest_running_sec": round(max([h for _g, h in live]), 1) if live else None,
            "longest_stuck_sec": round(max([h for _g, h in stuck]), 1) if stuck else None,
        }

    def busy_note(self) -> str:
        """把 busy_info() 講成人話（誠實：分清楚『在算』與『疑似卡住』）。"""
        i = self.busy_info()
        if i["stuck"] > i["escape_max"]:
            return ("有 %d 個先前的計算疑似卡住（最久 %.0f 秒沒有回應，超過 %.0f 秒門檻），"
                    "已超過同時容忍上限 %d" % (i["stuck"], i["longest_stuck_sec"] or 0.0,
                                               i["stale_sec"], i["escape_max"]))
        if i["stuck"]:
            # 有人卡住、但擋下的原因是正常名額也滿了——兩件事要分開講，不可混為一談。
            # ⚠️ running 可能是 0（逃生額度還沒用完、只是剛好沒人在算）。此時若照講
            #    「已有 0 個計算正在進行，最久的已經算了 0 秒」，那個 0 秒是憑空捏造的
            #    （longest_running_sec 是 None，不是 0），只會讓人以為剛開始算。
            head = ("已有 %d 個計算正在進行（同時上限 %d，最久的已經算了 %.0f 秒）；另有"
                    % (i["running"], i["limit"], i["longest_running_sec"])
                    if i["longest_running_sec"] is not None
                    else "目前沒有計算在進行（同時上限 %d），但有" % i["limit"])
            return ("%s %d 個先前的計算疑似卡住（最久 %.0f 秒沒有回應）"
                    % (head, i["stuck"], i["longest_stuck_sec"] or 0.0))
        if i["longest_running_sec"] is not None:
            return ("已有 %d 個計算正在進行（同時上限 %d，最久的已經算了 %.0f 秒）"
                    % (i["running"], i["limit"], i["longest_running_sec"]))
        return "同時上限 %d，目前無法受理" % i["limit"]


# ═══════════════════════════════════════════════════════════════════════════
# `async def` 路由裡的同步阻塞呼叫 → 一律丟執行緒池 ＋ 給總秒數上限
# ═══════════════════════════════════════════════════════════════════════════
# 為什麼這件事是 P0：FastAPI 只會把 **`def`** 路由丟到執行緒池，`async def` 路由
# 是直接在 asyncio 的事件迴圈上跑的。事件迴圈被同步 I/O 佔住時，uvicorn
# **連新進來的請求都讀不到**——不是「排隊」，是那段期間整台 server 沒有回應。
#
# 實測（本機 uvicorn，stub 掉對外請求，只讓處理函式睡 6 秒）：
#   修正前：同時打進來的 GET /api/status 等了 **5.51 秒**
#   修正後：同一個 GET **0.00 秒**（詳見本次修復的量測腳本）
#
# 為什麼 6 秒就算災難：TradingView 警報 webhook 官方逾時 **3 秒，且逾時不重送**
#（這正是使用者把 Render 升到 Starter 的原因）。一則微信 CA 貼入最壞會佔住
# 4.7 分鐘（實測：MAX_ADDRS_PER_MSG=5 × EVM 4 鏈 × (GoPlus 節流 2.0s ＋ 逾時 12s)；
# 純節流等待實測 4 鏈就要 7.82 秒），期間所有觸發的警報會直接消失、兩邊都無紀錄。
#
# ⚠️ 專用執行緒池，**不共用** starlette 的 `run_in_threadpool`：後者與所有 `def`
#    同步路由共用同一組 token，一則貼入卡住就會把首頁、輪詢、TradingView 收件
#    一起餓死。也不用 asyncio 預設 executor（它同時是 LINE webhook 的派工池）。
_BLOCKING_POOL_WORKERS = 4
_blocking_exec = None
_blocking_exec_lock = threading.Lock()


def _blocking_executor():
    """站主寫入路徑的專用池。第一次用到才建立（import 時不開執行緒）。"""
    global _blocking_exec
    with _blocking_exec_lock:
        if _blocking_exec is None:
            from concurrent.futures import ThreadPoolExecutor
            _blocking_exec = ThreadPoolExecutor(max_workers=_BLOCKING_POOL_WORKERS,
                                                thread_name_prefix="blocking")
        return _blocking_exec


class _OffloadTimeout(Exception):
    """超過整條路徑的總秒數上限。**不等於「沒做」**——見 `_offload` 的說明。"""

    def __init__(self, label, deadline, elapsed):
        super().__init__("%s 超過 %.0f 秒上限（已等 %.1f 秒）" % (label, deadline, elapsed))
        self.label, self.deadline, self.elapsed = label, deadline, elapsed


class _OffloadRejected(Exception):
    """派不進執行緒池（池子已關閉／建立失敗）。這一種是真的「完全沒開始」。"""


async def _offload(fn, deadline_sec, label, ticket=None, gate=None):
    """
    把同步阻塞呼叫移出事件迴圈，並給它一個總秒數上限。回傳 `fn()` 的回傳值。

    ⚠️ **總秒數上限是必要的，但它不能中止工作**：Python 無法中斷已經開始的同步
       網路 I/O（`requests` 的 timeout 只是單一請求的上限，不是總時間上限——本專案
       在 twchips 已經踩過，實測單一請求曾 23 秒）。逾時只代表「不再讓 HTTP 連線
       空等」，那條執行緒還在跑、**工作很可能仍會完成**。
       所以逾時的回應只能寫成「還在背景跑、結果未知」，
       ⛔ 絕不可以寫成「這次沒寫」——那會讓站主以為要重貼，是謊報。

    ⚠️ 併發閘的歸還綁在「工作真正結束」那一刻（done_callback），不是逾時那一刻。
       提早歸還等於超賣併發：第二則貼入會在第一則還卡在 `wechatstore._SUBMIT_LOCK`
       裡時就進場，兩條執行緒疊在同一把鎖上。卡死的情況由 `_StaleGate` 的逃生門
       負責（有上限，不會變成無限併發）——這與 `_process_line_events` 同一套語彙。
    """
    import asyncio
    loop = asyncio.get_running_loop()
    t0 = time.monotonic()

    def _run():
        # 例外原樣帶回呼叫端重拋：讓各路由既有的 except 區塊維持原本語意。
        try:
            return (True, fn())
        except BaseException as e:                  # noqa: BLE001
            return (False, e)

    try:
        cfut = _blocking_executor().submit(_run)
    except Exception as e:
        if gate is not None:
            gate.release(ticket)                    # 沒派工成功就要馬上還，否則永久少一格
        print("[offload:%s] 派工失敗：%s" % (label, e), file=sys.stderr)
        raise _OffloadRejected(str(e))

    if gate is not None:
        cfut.add_done_callback(lambda _f, _t=ticket: gate.release(_t))
    # 逾時後這條執行緒仍在跑：留一行 log，否則「孤兒工作最後到底做完沒有」
    # 在線上完全看不見（本專案對靜默失敗的一貫要求）。
    cfut.add_done_callback(
        lambda _f, _t0=t0: print("[offload:%s] 工作結束，耗時 %.1f 秒%s"
                                 % (label, time.monotonic() - _t0,
                                    "（HTTP 端早已逾時返回）"
                                    if (time.monotonic() - _t0) > deadline_sec else ""),
                                 file=sys.stderr))

    afut = asyncio.wrap_future(cfut, loop=loop)
    try:
        ok, val = await asyncio.wait_for(afut, deadline_sec)
    except asyncio.TimeoutError:
        raise _OffloadTimeout(label, deadline_sec, time.monotonic() - t0)
    if not ok:
        raise val
    return val


#: 各條站主寫入路徑的總秒數上限。取值＝「實測最壞情況」與「使用者還願意等」之間的截點。
#: ⚠️ 逾時不是失敗，是不再讓 HTTP 連線空等（工作仍在背景跑完）。
#: 微信 CA 貼入：實測最壞 4.7 分鐘（5 地址 × 4 鏈 × (2.0s 節流 + 12s 逾時)）。
WECHAT_CA_DEADLINE_SEC = 75.0
#: CoinKarma 快照：解析純記憶體，慢的是帳本兩次 GitHub Contents API 往返。
CK_SCREENER_DEADLINE_SEC = 60.0
#: allowlist 覆寫：一次讀 + 一次寫（GitHub）。
WECHAT_RULES_DEADLINE_SEC = 30.0
#: 跟單評分：2 次 GMGN 查詢，各自帶重試。
WALLET_SCORE_DEADLINE_SEC = 45.0


@asynccontextmanager
async def research_lifespan(app):
    if os.environ.get('RENDER', '').lower() == 'true':
        from scripts.verify_runtime import verify
        verify(dependencies=True)
        from web import runtime_memory
        runtime_memory.start()
    from web import onchain_radar, btc_position_context, btc_market_data, coinbase_flow, btc_tradingview, cmc_context
    onchain_radar.start()
    btc_position_context.start()
    btc_market_data.start()
    coinbase_flow.start()
    btc_tradingview.start()
    cmc_context.start()
    if _public_lite_enabled():
        from web import public_research, public_quotes, public_assets
        public_assets.restore()
        public_research.restore_scan_background(_latest_scan_path())
        public_quotes.start()
    try:
        yield
    finally:
        if _public_lite_enabled():
            public_quotes.stop()
        onchain_radar.stop()
        btc_position_context.stop()
        btc_market_data.stop()
        coinbase_flow.stop()
        btc_tradingview.stop()
        cmc_context.stop()
        if os.environ.get('RENDER', '').lower() == 'true':
            runtime_memory.stop()

app = FastAPI(title="市場監控 Dashboard", lifespan=research_lifespan)

# 公開唯讀模式：雲端(Render 會自帶 RENDER 環境變數)預設開啟——公開網址上任何陌生人
# 都打得到 API，不能讓人改掉你的監控清單或觸發 LINE 推播。想在雲端開放編輯，設 PUBLIC_READONLY=0。
_flag = os.environ.get("PUBLIC_READONLY", "").strip()
READONLY = (_flag == "1") or (bool(os.environ.get("RENDER")) and _flag != "0")

# symbol 白名單：涵蓋 AAPL / 2330.TW / BTC-USD / 1000PEPE，也保留 yfinance 的
# ^TWII(指數)、GC=F(期貨)、TWD=X(匯率) 寫法
_SYM_RE = re.compile(r"^[A-Za-z0-9.\-/^= ]{1,20}$")

# /api/inspect 是重運算端點：限併發 2，滿了回 429（免費方案 512MB 禁不起幾十個併發 pandas）
# 門檻 120 秒：正常 5~15 秒（docstring 實測），yfinance 慢的時候到 40 秒也還算健康；
# 120 秒已經是「這條不會回來了」的區間，拿來當逃生門檻不會誤殺正常請求。
_inspect_slots = _StaleGate("inspect", limit=2, stale_sec=120.0, escape_max=2)
# /api/onchain 同樣是公開、同步、會連外（GoPlus 0.4~0.6 秒、GMGN 背景執行緒）的端點。
# 沒有閘門時，一個迴圈就能把 uvicorn 的工作執行緒池佔滿 → 全站被拖住。與 inspect 同級。
# 門檻 60 秒：實測 0.4~0.6 秒，慢兩個數量級就一定不對勁了。
_onchain_slots = _StaleGate("onchain", limit=2, stale_sec=60.0, escape_max=2)
# LINE webhook 的實際處理（scanner.inspect / GoPlus）也是重活，同樣設閘；
# 佔滿時用 reply token 誠實回「忙碌中」，不是靜默丟掉。
# 門檻 90 秒：單則預算 LINE_DEADLINE_SEC=45 秒，跑到 90 秒的工作連 reply token
# （60 秒）都早就死透，留著它佔格子只會讓整個 LINE bot 永久回「忙碌中」。
# escape_max=2 配 _line_exec 的 max_workers=4：最壞同時在跑 2+2=4 條，剛好是池子大小
# ——逃生不會讓工作排到池子外面去（排到池外＝slot 被佔著卻連跑都還沒開始）。
_line_slots = _StaleGate("line", limit=2, stale_sec=90.0, escape_max=2)
# LINE webhook body 上限。官方 webhook payload 一則文字訊息約 400 bytes，
# 就算一次塞滿 100 個事件也遠小於 64KB；超過即視為攻擊或異常。
LINE_MAX_BODY = 64 * 1024
# 機會掃描結果的重用視窗（分鐘）。cron 每 4 小時會跑一次幣圈 screener（107 次幣安請求），
# 這個視窗內前端再按「機會掃描」就直接沿用，不重打一次一模一樣的請求。
try:
    SCREEN_CACHE_MIN = float(os.environ.get("SCREEN_CACHE_MIN") or 10)
except Exception:
    SCREEN_CACHE_MIN = 10.0


def _ct_eq(a, b) -> bool:
    """
    定時（constant-time）比較，且**不會因為非 ASCII 字元炸掉**。

    `secrets.compare_digest` 對 str 只接受純 ASCII：訪客送一個中文／emoji 的
    ?key= 或 X-Line-Signature，會直接拋 TypeError → 未授權端點回 500 而不是 401。
    500 一來會把錯誤日誌灌爆，二來讓「金鑰字元集」變成一個可探測的訊號。
    一律先 encode 成 utf-8 bytes 再比（bytes 版本本來就允許任意位元組）。

    註：長度不同時 compare_digest 仍會提早得知長度差異——這是它 bytes 版本的既有行為，
    金鑰長度本來就不是機密。
    """
    try:
        ab = a.encode("utf-8", "surrogatepass") if isinstance(a, str) else bytes(a or b"")
        bb = b.encode("utf-8", "surrogatepass") if isinstance(b, str) else bytes(b or b"")
    except Exception:
        return False                       # 連 bytes 都轉不出來的輸入＝不可能相等
    return secrets.compare_digest(ab, bb)


# ═══════════════════════════════════════════════════════════════════════════
# 站主身分（OWNER）：私人資料的唯一閘門
# ═══════════════════════════════════════════════════════════════════════════
# 2026-09-02 新增。起因是對**線上正式站**的實測：
#   GET https://aimarket.trade/api/onchain_watch → 200，把使用者自己填的鏈上監控清單
#   （自訂 label、鏈、合約地址、加入時間、風險快照）**完整吐給全世界**。
# 當初做鏈上清單時只擋了「陌生人不能**改**」（PUBLIC_READONLY 擋寫入），
# 沒擋「陌生人能不能**看**」——那是兩件事。
#
# ① 為什麼要獨立的 OWNER_KEY，不重用 CRON_KEY
#    CRON_KEY 現在同時能「觸發掃描並真的推 LINE 到使用者手機」與「編輯鏈上清單」，
#    一把鑰匙已經兩種權限；再把「讀取全部私人資料」也掛上去，任何一次外洩
#    （cron-job.org 設定頁、瀏覽器歷史、Render access log）就是全盤皆輸。
#    agent/tvalerts.py 為 TV_WEBHOOK_KEY 也寫過同一句警告：用新的一組，不要重用。
# ② 為什麼是簽章 cookie，不是 ?key=
#    query string 會被記進瀏覽器歷史、Referer 標頭與 Render access log
#    ——金鑰放網址等於每開一次頁就把它抄到三個地方。改成「用金鑰換一張有到期時間的
#    簽章 cookie」，金鑰只在登入那一次出現在 POST body 裡。
#    簽章走 hmac + hashlib + secrets（標準庫，零新依賴），**到期時間寫在簽章內容裡**，
#    所以改不了、過期即失效。
OWNER_COOKIE = "aim_owner"

#: cookie 有效時數（預設 12 小時）。想縮短視窗就設 OWNER_SESSION_HOURS。
try:
    OWNER_SESSION_HOURS = float(os.environ.get("OWNER_SESSION_HOURS") or 12)
except Exception:
    OWNER_SESSION_HOURS = 12.0
OWNER_SESSION_HOURS = max(0.05, min(OWNER_SESSION_HOURS, 720.0))

#: 「這是不是線上」的判斷依據。Render 會注入一整組自己的環境變數，這裡**任一個成立
#: 就算線上**——單靠 `RENDER` 一個變數是把整份私人資料押在一個外部平台的命名慣例上：
#: 那個變數哪天沒了（改名、換平台、Docker 化自己寫 entrypoint），本機放寬就會在
#: 公開站上安靜地成立，等於一次全量外洩。多列幾個是零成本的保險。
_CLOUD_ENV_KEYS = ("RENDER", "RENDER_SERVICE_ID", "RENDER_INSTANCE_ID",
                   "RENDER_SERVICE_NAME", "RENDER_EXTERNAL_URL", "RENDER_GIT_COMMIT")
IS_CLOUD = any((os.environ.get(k) or "").strip() for k in _CLOUD_ENV_KEYS)

# 本機開發放寬（規格 ⑦）：偵測不到雲端 ⇒ 這是站主自己的電腦 ⇒ 預設就是站主。
# 判斷依據與理由：
#   1. 本機這支 server 預設綁 127.0.0.1（start.command 沒有 --host），打得到它的人
#      早就能直接讀 watchlist.json、state/onchain_watch.json、ledger/*.ndjson 這些
#      **同一份原始檔**——此時要求登入只擋得住使用者自己，擋不住任何攻擊者。
#   2. 放寬**只在「線上為假」時成立**，線上絕不放寬；再加一道保險：只要有人明確設了
#      PUBLIC_READONLY=1（＝操作者自己認定這台對外公開），就一律不放寬。
#   3. 要在本機重現「陌生訪客看到什麼」，設 OWNER_LOCAL_TRUST=0 關掉它（測試就是這樣跑）。
#
# ⚠️ 但「環境變數看起來像本機」**不等於這個請求真的來自本機**。上面第 1 點的推論
#    ——「打得到就讀得到原始檔」——只有在對方真的坐在這台機器前面時才成立。兩個實際
#    會發生的反例：
#      ‧ 用 `--host 0.0.0.0` 起服務（想用手機看同一個站），同一個 wifi 上的每一台
#        裝置立刻都是站主；
#      ‧ 用 ngrok / cloudflared 開一條隧道對外展示，隧道是從 127.0.0.1 連進來的，
#        **peer 位址檢查也會被騙過去**，於是整個網際網路都是站主。
#    兩者都沒有 RENDER 變數，所以純環境變數的判斷完全攔不住。
#    因此放寬改成**每個請求各判一次**（見 _local_trusted_request）：環境要像本機、
#    連線要真的來自 loopback、而且不能帶任何代理／隧道轉發標頭。
LOCAL_OWNER_TRUST = (
    (not IS_CLOUD)
    and _flag != "1"
    and (os.environ.get("OWNER_LOCAL_TRUST", "").strip() != "0")
)

#: loopback 的各種寫法（IPv6 對映的 IPv4 也算）。
#: ⚠️ 刻意**不含空字串**：某些 ASGI 伺服器拿不到 peer 時會給空的 host，
#:    把空值算成 loopback 就是「檢查不了 ⇒ 當成安全」——本專案明令禁止的那種失敗。
_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"})

#: 這些標頭只要出現任何一個，就代表請求是被某個代理／隧道轉進來的。
#: 此時 request.client.host 會是 127.0.0.1（隧道自己連上來的），loopback 檢查騙得過，
#: 真正的發話者卻是網際網路上的任何人 —— 所以一律不放寬，改走正規的 cookie 登入。
_PROXY_HEADERS = ("x-forwarded-for", "x-forwarded-host", "x-forwarded-proto",
                  "x-real-ip", "forwarded", "cf-connecting-ip",
                  "x-original-forwarded-for", "ngrok-skip-browser-warning")


def _local_trusted_request(request) -> bool:
    """
    這個請求可不可以套用「本機開發放寬」。**任何一項判斷不出來都回 False**（fail-closed）。

    三個條件全部成立才算：環境像本機（LOCAL_OWNER_TRUST）、連線真的來自 loopback、
    且沒有帶任何代理／隧道轉發標頭。
    """
    if not LOCAL_OWNER_TRUST:
        return False
    try:
        client = getattr(request, "client", None)
        host = (getattr(client, "host", None) or "") if client is not None else None
        if host is None:                   # 拿不到來源位址 ⇒ 不知道是誰 ⇒ 不放寬
            return False
        if str(host).strip().lower() not in _LOOPBACK_HOSTS:
            return False                   # --host 0.0.0.0 之後從區網連進來的
        for h in _PROXY_HEADERS:
            if request.headers.get(h):
                return False               # ngrok / cloudflared / 反向代理
    except Exception:
        return False                       # 檢查不了 ≠ 安全
    return True


def _owner_key() -> str:
    """
    站主金鑰。**每次讀環境變數、不快取**：Render 改環境變數會重啟沒差，
    但本機測試常在 import 之後才設，快取會讓測試與實際行為不一致。
    """
    return (os.environ.get("OWNER_KEY") or "").strip()


def _owner_configured() -> bool:
    """有沒有設 OWNER_KEY。前端要能分辨「沒登入」與「根本沒設定」。"""
    return bool(_owner_key())


def _owner_secret() -> bytes:
    """
    cookie 的簽章金鑰＝由 OWNER_KEY 推導，不再多要一個 SECRET_KEY 環境變數。
    副作用是刻意的：**換掉 OWNER_KEY 等於把所有已發出的 cookie 一次作廢**
    （＝遠端登出），不必再維護一份撤銷名單。
    """
    return hashlib.sha256(
        b"aimarket.owner.cookie.v1|" + _owner_key().encode("utf-8", "surrogatepass")
    ).digest()


def _owner_make_token(ttl_seconds=None):
    """簽一張 cookie。格式 v1.<到期 epoch>.<亂數>.<hmac-sha256>，回 (token, exp)。"""
    exp = int(time.time() + (ttl_seconds or OWNER_SESSION_HOURS * 3600))
    body = "v1.%d.%s" % (exp, secrets.token_hex(8))
    sig = hmac.new(_owner_secret(), body.encode("ascii"), hashlib.sha256).hexdigest()
    return body + "." + sig, exp


def _owner_token_state(raw):
    """
    驗證 cookie，回 (ok, exp_epoch, reason)。

    ⚠️ cookie 是訪客**完全可控**的字串：任何畸形輸入都只能回 False，不可以拋例外
    ——在這裡拋錯就是把每個受閘端點變成 500 製造機（而且 500 本身也是一種訊號洩漏）。
    非 ASCII 的簽章欄位走 _ct_eq 而不是 hmac.compare_digest（後者對 str 只吃純 ASCII，
    會丟 TypeError → 500，本檔 _ct_eq 就是為了這件事存在的）。
    """
    if not raw:
        return False, None, "missing"
    if not _owner_configured():
        # 沒設 OWNER_KEY ⇒ 沒有人是站主（fail-closed）。
        # 不可以因為「簽章算得出來」就放行：未設定時 secret 由空字串推導＝公開可算。
        return False, None, "not_configured"
    s = str(raw)
    if len(s) > 256:                       # 正常 token 約 90 字元，超長即畸形
        return False, None, "malformed"
    parts = s.split(".")
    if len(parts) != 4 or parts[0] != "v1":
        return False, None, "malformed"
    try:
        exp = int(parts[1])
    except Exception:
        return False, None, "malformed"
    try:
        body = ("v1.%s.%s" % (parts[1], parts[2])).encode("ascii")
    except Exception:
        # int() 連阿拉伯數字等非 ASCII 數字都吃，所以這裡仍可能不是 ASCII
        return False, None, "malformed"
    try:
        expect = hmac.new(_owner_secret(), body, hashlib.sha256).hexdigest()
    except Exception:
        return False, None, "malformed"
    if not _ct_eq(parts[3], expect):
        return False, None, "bad_signature"
    if exp <= int(time.time()):
        # 到期時間在簽章內容裡（改了簽章就不符），所以「先驗簽、再判過期」是安全的
        return False, exp, "expired"
    return True, exp, "ok"


def _owner_exp_iso(exp):
    """epoch → 帶時區的 ISO 字串（前端契約要 ISO）。"""
    if not exp:
        return None
    try:
        return datetime.fromtimestamp(int(exp)).astimezone().isoformat(timespec="seconds")
    except Exception:
        return None


_OWNER_REASON_NOTE = {
    "missing": "未登入站主，私人區塊已隱藏。",
    "expired": "站主登入已過期（cookie 到期），請重新登入。",
    "bad_signature": "站主憑證無效（簽章不符），請重新登入。",
    "malformed": "站主憑證格式不正確，請重新登入。",
}


def _owner_state(request) -> dict:
    """
    這個請求是不是站主。**所有私人資料的唯一入口**。

    回 {"owner","configured","expires_at","via","reason","note"}。

    ⚠️ fail-closed 對資料：未設 OWNER_KEY ⇒ 沒有人是站主 ⇒ 私人資料對所有人隱藏
       （含站主本人）。但 note 一定要講清楚「是設定沒做，不是壞掉」，
       否則使用者只會看到一片空白，然後以為系統壞了或以為清單真的是空的。
    """
    if getattr(getattr(request, "state", None), "world_portal", False):
        return {"owner": False, "configured": False, "expires_at": None, "via": None, "reason": "research_only", "note": "World research access grants no owner role."}
    configured = _owner_configured()
    if _local_trusted_request(request):
        return {"owner": True, "configured": configured, "expires_at": None,
                "via": "local_dev", "reason": "local_dev",
                "note": "本機開發模式（偵測不到雲端環境變數、未設 PUBLIC_READONLY=1，"
                        "且這個請求確實來自 loopback、沒有經過任何代理／隧道）：預設視為站主。"
                        "設 OWNER_LOCAL_TRUST=0 可關閉此放寬；線上（Render）不適用。"}
    raw = ""
    try:
        raw = request.cookies.get(OWNER_COOKIE) or ""
    except Exception:
        raw = ""
    ok, exp, reason = _owner_token_state(raw)
    if ok:
        return {"owner": True, "configured": True, "expires_at": _owner_exp_iso(exp),
                "via": "cookie", "reason": "ok", "note": "已以站主身分登入。"}
    if not configured:
        return {"owner": False, "configured": False, "expires_at": None,
                "via": None, "reason": "not_configured",
                "note": "⚠️ 尚未設定 OWNER_KEY，因此私人區塊對所有人隱藏（包含站主本人）。"
                        "這是設定問題、不是故障：在環境變數設好 OWNER_KEY 後即可登入。"}
    return {"owner": False, "configured": True, "expires_at": None, "via": None,
            "reason": reason, "note": _OWNER_REASON_NOTE.get(reason, _OWNER_REASON_NOTE["missing"])}


# ── 站主回應的標頭（規格 ⑥）──────────────────────────────────────────────
# no-store：私人內容不可以留在瀏覽器磁碟快取或任何中介快取。
# X-Robots-Tag: noindex：這些網址不該被搜尋引擎收錄（公開站是真的會被爬的）。
# Vary: Cookie：**同一個網址依 cookie 回不同內容**，沒有這行，任何中介快取都可能
#   把站主那份存起來再發給陌生人——那會讓前面所有閘門一起失效。
_PRIVATE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Pragma": "no-cache",
    "X-Robots-Tag": "noindex, nofollow",
    "Vary": "Cookie",
}


def _priv_json(data, status: int = 200):
    """帶「不快取 + 不索引 + 依 cookie 變動」標頭的 JSON 回應。"""
    return JSONResponse(data, status_code=status, headers=dict(_PRIVATE_HEADERS))


def _public_lite_enabled() -> bool:
    """The deployed site defaults to a small public entry; local development stays full."""
    flag = (os.environ.get("PUBLIC_LITE_MODE") or "").strip().lower()
    if flag in {"1", "true", "on"}:
        return True
    if flag in {"0", "false", "off"}:
        return False
    return (os.environ.get("RENDER") or "").strip().lower() == "true"


# World GOLD delivery: backend-authenticated, immutable original report receipt.
from web import world_gold_delivery as _world_gold_delivery
_world_gold_delivery.install(app)

@app.middleware("http")
async def public_lite_boundary(request: Request, call_next):
    """Keep protected research behind the holder check while allowing a safe preview."""
    path = request.url.path
    context = request.headers.get(world_auth.PORTAL_HEADER, "")
    request.state.world_portal = world_auth.portal_context(request.method, path, request.url.query,
        context, request.headers.get("cookie", ""))
    if context and not request.state.world_portal:
        return _priv_json({"error": "portal_context_denied"}, status=403)
    if request.state.world_portal and not world_auth.portal_request_allowed(request.method, path, request.url.query):
        return _priv_json({"error": "portal_route_denied"}, status=403)
    if request.state.world_portal and path == "/api/owner/status":
        return _priv_json({"owner": False, "configured": False, "expires_at": None})
    if not _owner_state(request)["owner"]:
        if path == "/research-tools":
            return RedirectResponse("/", status_code=303, headers={"Cache-Control": "no-store"})
        if path == "/desk" or path.startswith("/desk/") or path == "/static" or path.startswith("/static/"):
            return HTMLResponse("找不到此頁面", status_code=404, headers={"Cache-Control": "no-store"})
        if request.method == "GET" and path.startswith("/api/"):
            allowed = path in {"/api/owner/status", "/api/holder/status", "/api/cron/scan",
                               "/api/holder/world/start", "/api/holder/world/callback",
                               "/api/public/overview", "/api/public/quotes", "/api/public/btc",
                               "/api/public/services", "/api/imd-daily/preview",
                               "/api/new-tokens/preview"} or bool(re.fullmatch(r"/api/public/assets/(BTC|ETH)/(research|chart)", path))
            if ((path.startswith("/api/imd-daily/") and path != "/api/imd-daily/preview")
                    or (path.startswith("/api/new-tokens/") and path != "/api/new-tokens/preview")
                    or bool(re.fullmatch(r"/api/public/assets/(BTC|ETH)/research", path))):
                try:
                    _, allowed = await run_in_threadpool(_holder_eligible, request)
                except (holder_auth.RpcUnavailable, world_auth.BridgeUnavailable):
                    return _priv_json({"error": "ethereum_unavailable", "note": "Wallet balance verification is temporarily unavailable."}, status=503)
            if path == "/api/ck_metrics" and _key_ok(request.query_params.get("key", "")):
                allowed = True
            if not allowed:
                return _priv_json({"error": "holder_required", "note": "Connect a wallet holding at least 1,000,000 EMBEO to view public research."}, status=401)
        if request.method == "POST" and path in {"/api/screen", "/api/rescan"}:
            return _priv_json({"error": "public_lite", "note": "訪客無法啟動掃描。"}, status=401)
    response = await call_next(request)
    if request.state.world_portal or path == "/" or path.startswith("/api/public/"):
        response.headers.update(_PRIVATE_HEADERS)
    return response


def _cookie_secure(request) -> bool:
    """
    Secure 旗標。線上一律 True；本機 http 開發時必須是 False，
    否則瀏覽器根本不會存這個 cookie（登入會「成功但沒作用」，最難查的那種壞法）。
    """
    if IS_CLOUD:
        return True
    try:
        xf = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
        if xf:
            return xf == "https"
        return request.url.scheme == "https"
    except Exception:
        return False


# ── 登入失敗鎖定（規格 ④）─────────────────────────────────────────────────
# 現況：POST /api/onchain_watch 沒有任何 rate limit 也沒有鎖定，等於可以線上無限次猜金鑰。
# 這裡的計數刻意是**全域**而非 per-IP：per-IP 要靠 X-Forwarded-For 判定，而那個標頭是
# 請求端可控字串（本檔他處已註明「僅供查證，未作驗證」），換個值就重置計數＝等於沒鎖。
# 代價是別人可以用連續失敗把站主鎖在門外，所以退避有上限（最長 15 分鐘）而非永久鎖，
# 且成功登入立刻歸零。狀態只在記憶體，重啟歸零（可接受：重啟本來就要重登）。
# ⚠️ 絕不把金鑰或嘗試內容寫進 log——那等於把探測字串抄進伺服器日誌。只記次數與時間。
_OWNER_FREE_TRIES = 5          # 前 5 次只計數不鎖（自己打錯字很正常）
_OWNER_LOCK_BASE = 15.0        # 第 6 次起鎖 15 秒，之後每次翻倍
_OWNER_LOCK_MAX = 900.0        # 退避上限 15 分鐘
_OWNER_FAIL_RESET = 1800.0     # 30 分鐘內沒有新的失敗就把連續計數歸零
_owner_auth = {"fails": 0, "locked_until": 0.0, "last_fail": 0.0, "total": 0}
_owner_auth_lock = threading.Lock()


def _owner_retry_after() -> int:
    """還要等幾秒才能再試；0＝現在可以試。"""
    with _owner_auth_lock:
        left = _owner_auth["locked_until"] - time.time()
    return int(left) + 1 if left > 0 else 0


def _owner_note_fail() -> int:
    """記一次登入失敗，回傳需等待秒數（0＝尚未進入鎖定）。"""
    now = time.time()
    with _owner_auth_lock:
        if _owner_auth["last_fail"] and (now - _owner_auth["last_fail"]) > _OWNER_FAIL_RESET:
            _owner_auth["fails"] = 0
        _owner_auth["fails"] += 1
        _owner_auth["total"] += 1
        _owner_auth["last_fail"] = now
        n = _owner_auth["fails"]
        wait = 0.0
        if n > _OWNER_FREE_TRIES:
            wait = min(_OWNER_LOCK_BASE * (2 ** (n - _OWNER_FREE_TRIES - 1)), _OWNER_LOCK_MAX)
            _owner_auth["locked_until"] = now + wait
        total = _owner_auth["total"]
    print("站主登入失敗：連續第 %d 次（累計 %d），退避 %d 秒｜%s"
          % (n, total, int(wait), datetime.now().isoformat(timespec="seconds")),
          file=sys.stderr)      # 只有次數與時間，沒有金鑰、沒有嘗試內容
    return int(wait) + 1 if wait > 0 else 0


def _owner_note_ok() -> None:
    """登入成功：連續失敗計數與鎖定一併歸零。"""
    with _owner_auth_lock:
        _owner_auth.update(fails=0, locked_until=0.0)


# ── 帳本的「私人家族」閘門（規格 ⑤）──────────────────────────────────────
# /api/ledger 與 /api/ledger/families 今天吐的只是訊號家族的統計數字（不敏感），
# 所以**保持公開**——公開站的帳本狀態列與家族清單是這個站有用的一部分。
# 但即將新增的「三位交易者共識」會把交易者姓名、持倉與站主手寫備註寫進同一本帳，
# 家族名會長成 consensus_* / trader_* 那樣，屆時就會從這兩個端點漏出去。
#
# ⚠️ 黑名單要「預設放行未知前綴」還是「預設拒絕」？──**預設拒絕**。理由：
#   ‧ 純黑名單（未知即放行）的失敗模式是「新功能上線那天就漏」：而該記得回來更新
#     這份清單的人，正是當初忘記擋讀取的同一個人。這次的 bug 就是這樣產生的。
#   ‧ 純白名單（未知即隱藏）的失敗模式是「新增了一個正常的公開家族卻不見了」——
#     這是**安全**的失敗；而且本專案鐵律是「查不到 ≠ 安全、缺資料要標明」，
#     所以隱藏數量一律回報在 filtered_private_families，並在伺服器 log 提醒一次，
#     絕不留白讓人以為帳本裡就是沒有那些東西。
#   ‧ 因此兩層都做：① 明確的私人前綴黑名單（把已知的未來案例寫死，語意清楚、可讀）
#                    ② 已知公開家族的白名單（未知一律當成私人）。
#   維護方式：日後新增一個**公開**訊號家族，就把名字加進 PUBLIC_FAMILY_ALLOW；
#   忘了加只會讓它暫時不對外顯示（站主登入後看得到），不會外洩任何東西。
#: ⚠️ "ck_screener" 在這裡是**冗餘但刻意**的：未知家族本來就預設拒絕，所以
#:    `ck_screener:LONG_WATCH` 沒被列進來也照樣會被擋。寫死一行的價值在於
#:    「日後有人把它加進 PUBLIC_FAMILY_ALLOW 時會先撞到這條」——那是站主
#:    **付費訂閱**的 CoinKarma 內容（象限分類是他們產品的輸出），
#:    本站沒有轉載授權，不該從帳本這個側門漏出去。
#: "wechat_ca" 同樣是冗餘但刻意（理由同 ck_screener）：那是**別人在私人微信群裡
#:  的發言**，站主只是群成員，本站沒有任何轉載或轉述的授權。未知家族本來就預設
#:  拒絕，寫死一行的價值在於「日後有人把它加進 PUBLIC_FAMILY_ALLOW 時會先撞到這條」。
PRIVATE_FAMILY_PREFIXES = ("trader", "consensus", "social_trader", "private",
                           "owner", "personal", "portfolio", "holding",
                           "note", "memo", "ck_screener", "wechat")

#: 目前 agent/rules.py 等模組實際產出的 signal category（＝帳本的 signal_family）。
PUBLIC_FAMILY_ALLOW = {
    "oversold_reversal", "momentum_breakout", "valuation_macro",
    "crypto_sentiment", "crypto_derivs", "crypto_combo", "crypto_spot_risk",
    "fib_entry", "tw_chips", "tw_revenue",
}
#: TradingView 外部警報家族是 "tv_alert:<系統>_<事件>"，數量會長，用前綴放行。
PUBLIC_FAMILY_ALLOW_PREFIXES = ("tv_alert:",)
#: 公開家族名的「長相」：純 ASCII slug。人名、中文備註、含空白的自由文字一律不符 ⇒ 私人。
_PUBLIC_FAMILY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:\-]{0,79}$")

_priv_fam_logged = set()


def _is_private_family(name) -> bool:
    """這個家族名是不是「不可對外顯示」。認不出來一律回 True（預設拒絕）。"""
    s = str(name or "").strip()
    if not s:
        return True                       # 沒有家族名 ⇒ 認不出它是什麼 ⇒ 當私人
    if not _PUBLIC_FAMILY_RE.match(s):
        return True                       # 中文／空白／怪字元＝人名或手寫備註的長相
    head = s.split(":", 1)[0].lower()
    for p in PRIVATE_FAMILY_PREFIXES:     # ① 明確黑名單（刻意用貪婪的 startswith）
        if head.startswith(p):
            return True
    if s in PUBLIC_FAMILY_ALLOW:          # ② 白名單；未知一律當私人
        return False
    for p in PUBLIC_FAMILY_ALLOW_PREFIXES:
        if s.startswith(p):
            # ③ tv_alert:<系統>_<事件> 的「系統」「事件」兩段是**站主自己在 TradingView
            #    警報訊息裡寫的字**。他若已經明確設了 TV_ALERTS_PUBLIC=0（＝「公開站不要
            #    顯示我的警報內容」），那族名同樣是他的警報內容，不能從帳本這個側門漏出去
            #    ——/api/tv/ext_stats 已經尊重這個開關，這裡不跟上就是同一份東西兩套標準。
            #    讀不到這個設定時一律當成私人（查不到 ≠ 可以公開）。
            try:
                import tvalerts as _tv
                return not _tv.alerts_public()
            except Exception:
                return True
    return True


def _note_hidden_family(name) -> None:
    """
    對外隱藏了某個家族時在 log 提醒一次（每個名字只印一次）。

    名字來自**我方帳本**（不是訪客輸入），所以印出來安全；集合上限 200
    只是防呆，避免異常帳本把記憶體吃掉。
    """
    try:
        if name in _priv_fam_logged or len(_priv_fam_logged) > 200:
            return
        _priv_fam_logged.add(name)
        print("帳本家族 %r 未列入 PUBLIC_FAMILY_ALLOW，已對非站主隱藏（預設拒絕未知家族）。"
              "若它是公開家族，請加進 web/app.py 的 PUBLIC_FAMILY_ALLOW。" % (name,),
              file=sys.stderr)
    except Exception:
        pass


# 重掃任務狀態（單機單工，用簡單全域即可）
_job = {"running": False, "started": None, "done": None, "msg": "", "error": None,
        "phase": None, "phase_at": None}
_lock = threading.Lock()

# 全市場機會掃描狀態 + 結果快取
_screen = {"running": False, "market": None, "msg": "", "started": None, "done": None, "error": None}
_screen_results = {"crypto": None, "crypto_at": None, "stocks": None, "stocks_at": None}
_screen_lock = threading.Lock()
_scan_worker = None  # Physical worker shared by watchlist and full-market scans.


def _scan_worker_alive():
    return _scan_worker is not None and _scan_worker.is_alive()


def _launch_scan(target, args=(), kwargs=None):
    """Caller holds _screen_lock, including the check before launch.

    Resetting a stale status does not stop a Python thread. Keep the actual
    worker so a timeout cannot accumulate concurrent abandoned scanners.
    """
    global _scan_worker
    _scan_worker = threading.Thread(target=target, args=args, kwargs=kwargs or {},
                                   name='market-scan', daemon=True)
    _scan_worker.start()

# 僵死逃生門：掃描沒有總時長上限，一旦執行緒卡在某個網路請求（或整個被 OOM 收掉），
# running 旗標會永遠是 True → 站台永久停在「掃描中」、LINE 定時推播全靜默。
# 超過這個分鐘數可修復殘留旗標；實際 worker 還活著時不可重疊起跑。
STALE_JOB_MIN = 15
# 每輪 cron 對幾顆鏈上代幣取樣。每顆一次 DexScreener 請求（免金鑰但有速率限制），
# 而且整段跑在掃描的尾巴，不能無上限。追蹤名單通常遠小於這個數。
WECHAT_PRICE_PER_RUN = int(os.environ.get("WECHAT_PRICE_PER_RUN", "60") or 60)

# 每輪 cron 補算幾筆績效。每筆要抓一次日線，0.1 CPU 上不能無上限。
# ⚠️ 這個名額以前會被「永遠算不出來」的紀錄（已下架的幣，例如 GIGADEV-USD）佔死：
#    挑件是純粹最舊優先，抓不到價又不留痕跡，於是下一輪它們又排在最前面。
#    2026-09-09 起 ledger.backfill_outcomes 內部分成三條道（最舊 8 成／最新 2 成／
#    重試保底 1/4）並把失敗記進 state/backfill_defer.json，連續失敗且橫跨 72 小時
#    才降級成「無價格來源」（仍定期複查，不是黑名單）。
BACKFILL_PER_RUN = 12
# 世代序號：逃生門重啟後，舊執行緒若「詐屍」回寫狀態，必須被忽略（否則會蓋掉新一輪的進度）
_job_gen = 0
_screen_gen = 0


def _is_stale(state: dict) -> bool:
    """判斷任務是否卡死（呼叫端必須已持有對應的鎖）。"""
    if not state.get("running"):
        return False
    started = state.get("started")
    if not started:
        return True                    # running 卻沒有起始時間 = 狀態不一致，視為卡死
    try:
        t = datetime.fromisoformat(started)
        now = datetime.now(t.tzinfo) if t.tzinfo else datetime.now()
        return (now - t).total_seconds() > STALE_JOB_MIN * 60
    except Exception:
        return True                    # 時間字串解析不了：寧可放行重掃，也不要永久卡死


def _job_superseded(gen) -> bool:
    """本輪是否已被逾時逃生門取代（呼叫端須已持有 _lock）。
    gen=None 代表不做世代檢查——留給直接呼叫 _run_scan 的腳本/測試用，
    否則它們的 gen 永遠對不上 _job_gen，會被誤判成詐屍而整段不寫檔。"""
    return gen is not None and _job_gen != gen


def _screen_superseded(gen) -> bool:
    """同 _job_superseded（呼叫端須已持有 _screen_lock）。"""
    return gen is not None and _screen_gen != gen


def _store_screen_result(market: str, rows, at: str = "") -> None:
    """
    把一份 screener 結果存進共用快取（前端「機會掃描」讀的就是這裡）。

    存在的理由：cron 掃描為了併入 LINE 推播，已經跑過一次幣圈 screener
    （107 次幣安請求）。不存起來的話，使用者按一次「機會掃描」就再跑一次一模一樣的請求。

    at = 這份資料的完成時間，同時就是前端顯示的基準時間；比既有快取舊就不覆蓋
    （兩條路徑可能交錯完成，較舊的結果不可以蓋掉較新的）。
    """
    at = at or datetime.now().isoformat(timespec="seconds")
    with _screen_lock:
        old = _screen_results.get(market + "_at")
        if old and str(old) >= at:
            return
        _screen_results[market] = rows
        _screen_results[market + "_at"] = at


def _screen_cache_age_min(market: str):
    """快取結果的年齡（分鐘）。沒有快取或時間解析不了回 None（＝不可重用）。"""
    with _screen_lock:
        at = _screen_results.get(market + "_at")
        has = _screen_results.get(market) is not None
    if not at or not has:
        return None
    try:
        return (datetime.now() - datetime.fromisoformat(str(at))).total_seconds() / 60.0
    except Exception:
        return None


def _run_screen(market: str, gen: int | None = None):
    # running 旗標已在 api_screen 的鎖內設好（check-then-act 要在同一把鎖裡，否則兩個請求會同時通過）
    try:
        import screener

        def _log(m):
            with _screen_lock:
                if not _screen_superseded(gen):
                    _screen["msg"] = m
        # ⚠️ 一律走 *_full：要的是 universe_ok，不是只要那份列表。
        #    只拿列表的話，「幣安批次端點掛掉」（Render 美國機房 451、網路瞬斷）與
        #    「真的沒有標的符合」都是 []，前端會顯示成「完成：0 個機會」＋ error=None，
        #    而且那份 [] 還會進快取，接下來 SCREEN_CACHE_MIN 分鐘內每個按鈕都看到同一句。
        #    那是把「查不到」渲染成「查過了，沒有」——本專案明令禁止的 fail-open，
        #    _merge_crypto_screen 早就擋了，使用者按的這顆按鈕卻沒擋。
        full = (screener.screen_crypto_full(log=_log) if market == "crypto"
                else screener.screen_stocks_full(log=_log))
        res = full.get("rows") or []
        now = datetime.now().isoformat(timespec="seconds")
        with _screen_lock:
            if _screen_superseded(gen):
                return                 # 本輪已被逾時逃生門取代，不覆寫新一輪的狀態
            if not full.get("universe_ok"):
                # 沒查成：**不寫快取**（不可讓後續 10 分鐘的重用視窗散播這個空結果），
                # 並把它當成失敗回報，讓前端顯示「重試」而不是一個帶時間戳的 0。
                why = full.get("error") or ("精選池全部抓取失敗（%d 檔）" % len(full.get("failed") or []))
                tail = "" if "查不到不等於" in why else " —— 查不到不等於沒有機會"
                _screen.update(running=False, done=now, error=why,
                               msg="無法掃描：%s%s" % (why, tail))
                return
            _screen_results[market] = res
            _screen_results[market + "_at"] = now
            # 部分失敗也要講明涵蓋範圍：57 檔壞 50 檔的「0 個機會」與全查成的「0 個機會」
            # 在畫面上不能長得一樣。
            cov = ""
            if market == "crypto":
                cov = "（深入分析 %s 檔" % full.get("deep")
                if full.get("incomplete"):
                    cov += "，其中 %d 檔資料不全" % len(full["incomplete"])
                cov += "）"
            elif full.get("failed"):
                cov = "（%d/%d 檔抓取失敗未納入）" % (len(full["failed"]), full.get("pool") or 0)
            # error=None：同 _run_scan，成功這輪要清掉上一輪的逾時註記（前端見 error 就當失敗）
            _screen.update(running=False, done=now, error=None,
                           msg=f"完成：{len(res)} 個機會{cov}")
    except Exception as e:
        with _screen_lock:
            if _screen_superseded(gen):
                return
            _screen.update(running=False, done=datetime.now().isoformat(timespec="seconds"),
                           error=str(e), msg="掃描失敗")


@app.post("/api/screen")
def api_screen(market: str = "crypto", force: int = 0):
    mk = (market or "").strip().lower()
    if mk not in ("crypto", "stocks"):
        return {"ok": False, "msg": "market 需為 crypto 或 stocks"}

    # 重用視窗內就沿用既有結果，不重跑（cron 每 4 小時已經跑過一次幣圈 screener＝107 次幣安請求）。
    # 前端拿到 ok=True 後會輪詢 screen_status → 看到 running=False → 直接抓 screen_result，
    # 而 screen_result 一律附上這份資料的完成時間，使用者看得到自己看的是幾點的資料。
    # ?force=1 可強制重跑。
    age = None if force else _screen_cache_age_min(mk)
    if age is not None and age < SCREEN_CACHE_MIN:
        with _screen_lock:
            if not _screen["running"]:
                # 讓前端的輪詢立刻看到「沒有在跑、也沒有錯誤」（否則會顯示上一輪的錯誤）
                _screen.update(running=False, market=mk, error=None,
                               done=_screen_results.get(mk + "_at"),
                               msg="沿用 %.0f 分鐘前的掃描結果" % age)
                return {"ok": True, "cached": True, "age_min": round(age, 1),
                        "as_of": _screen_results.get(mk + "_at"),
                        "msg": "沿用 %.0f 分鐘前的結果（%.0f 分鐘內不重掃，要強制重掃加 ?force=1）"
                               % (age, SCREEN_CACHE_MIN)}

    # 「查對方＋設自己」必須是同一個原子區段——兩把鎖以固定順序巢狀（screen 外、job 內），
    # 兩個端點同順序取鎖故無死鎖；否則兩個重活可在毫秒級競態下同時起跑（0.1 CPU 禁不起）
    global _screen_gen, _job_gen
    with _screen_lock:
        if _scan_worker_alive():
            return {"ok": False, "msg": "前一輪掃描仍在執行，本次略過以避免重複占用記憶體"}
        with _lock:
            if _job["running"] and not _is_stale(_job):
                return {"ok": False, "msg": "監控清單掃描進行中，請稍候再掃"}
            if _job["running"]:                 # 走到這代表它已卡死：一併解鎖，免得前端永遠顯示掃描中
                _job_gen += 1
                _job.update(running=False, error="前一次掃描逾時（已自動解鎖）", msg="掃描逾時")
            if _screen["running"] and not _is_stale(_screen):
                return {"ok": False, "msg": f"已有掃描進行中（{_screen['market']}）"}
            stale = _screen["running"]          # 逾時逃生門：舊的那輪已卡死，覆寫旗標重啟
            _screen_gen += 1
            gen = _screen_gen
            _screen.update(running=True, market=mk, done=None,
                           msg="掃描中…" + ("（前一次逾時，已自動解鎖）" if stale else ""),
                           started=datetime.now().isoformat(timespec="seconds"),
                           error="前一次掃描逾時（已自動解鎖）" if stale else None)
        try:
            _launch_scan(_run_screen, args=(mk, gen))
        except Exception as e:
            # start() 失敗（如記憶體吃緊起不了執行緒）必須復位旗標，否則永久卡「進行中」
            _screen.update(running=False, error=f"無法啟動：{e}", msg="掃描失敗")
            return {"ok": False, "msg": "系統忙碌，請稍後再試"}
    return {"ok": True, "msg": "已開始掃描"}


@app.get("/api/screen_status")
def api_screen_status():
    with _screen_lock:
        return dict(_screen)


@app.get("/api/screen_result")
def api_screen_result(market: str = "crypto"):
    mk = (market or "").strip().lower()
    with _screen_lock:
        return {"market": mk, "as_of": _screen_results.get(mk + "_at"),
                "results": _screen_results.get(mk) or []}


def _latest_scan_path():
    if not REPORTS.exists():
        return None
    files = sorted(REPORTS.glob("SCAN_*.json"), reverse=True)
    return files[0] if files else None


def _redact_scan_for(data, owner: bool):
    """
    SCAN 檔裡的 `onchain_watch` 與 `wechat_ca_prices` 區塊是**私人資料的第二個出口**，
    非站主一律遮蔽。

    cron 觸發那條路徑（allow_push=True）會把 onchain_watch.check_all() 的完整結果
    寫進 SCAN 檔，而 alerts / observations 每一筆都帶 chain + **address + 使用者自訂
    label**——和 /api/onchain_watch 漏的是同一份東西。只鎖 /api/onchain_watch
    而不鎖這裡，等於前門上鎖、後門開著（線上每 4 小時就會重新寫一次那份內容）。

    ⚠️ alerts/observations 給空 list 是為了讓前端既有的迴圈不會炸，但 note 必須明講
       「空的代表不告訴你，不是沒有告警」——不可以讓人把遮蔽讀成「本輪一切平安」。

    ⚠️ 2026-09-06 補上 `wechat_ca_prices`。cron 那一輪會把
       `{"tracked": 37, "sampled": 31, "missed": 6}` 寫進 SCAN 檔，而這個檔是公開的
       ——等於把「站主正在追蹤幾顆來自私人微信群的合約」告訴全世界。那是別人在
       私人群裡的發言所衍生的資料，本站沒有轉載授權，連**規模**都不該外流。
       這正是本函式開頭講的同一個坑：前門（/api/wechat_ca 有站主閘）上了鎖，
       後門（SCAN 檔）開著。新增任何寫進 `result[...]` 的私人區塊時都要回來加一筆。
    """
    if owner or not isinstance(data, dict):
        return data
    out = dict(data)
    touched = False
    ow = data.get("onchain_watch")
    if isinstance(ow, dict) and ow:
        touched = True
        out["onchain_watch"] = {
            "owner_only": True, "alerts": [], "observations": [],
            "note": "鏈上監控結果（合約地址、自訂標籤、風險快照）僅站主可見。"
                    "「空清單代表『不顯示』，不代表本輪沒有告警或沒有風險。」",
        }
    tw = data.get("twitter_watch")
    if isinstance(tw, dict) and tw:
        touched = True
        # ⚠️ 站主在盯哪些人、盯到了什麼，是他的研究方向，不對外。
        #    連命中數都不給——0 會被讀成「他沒在盯人」，那是一句沒有依據的話。
        out["twitter_watch"] = {
            "owner_only": True, "new_total": None,
            "note": "推特監控結果僅站主可見。「None 代表『不顯示』，不代表沒有監控。」",
        }
    oc = data.get("onchain_candidates")
    if isinstance(oc, dict) and oc:
        touched = True
        # ⚠️ 站主用什麼門檻在篩幣，是他的研究方向，不對外。
        #    連筆數都不給——0 會被讀成「今天沒有符合條件的幣」，那是一句沒有依據的話。
        out["onchain_candidates"] = {
            "owner_only": True, "kept": None,
            "note": "候選清單僅站主可見。「None 代表『不顯示』，不代表沒有候選。」",
        }
    wp = data.get("wechat_ca_prices")
    if isinstance(wp, dict) and wp:
        touched = True
        # ⚠️ 連 tracked 都不給。count 回 None 不是 0——同 ck_screener 的理由：
        #    0 會被讀成「他沒在追蹤任何東西」，那是一句我們沒有依據的話。
        out["wechat_ca_prices"] = {
            "owner_only": True, "tracked": None,
            "note": "微信 CA 價格追蹤僅站主可見（私人群發言，無轉載授權）。"
                    "「None 代表『不顯示』，不代表沒有在追蹤。」",
        }
    return out if touched else data


@app.get("/api/scan")
def api_scan(request: Request):
    owner = bool(_owner_state(request)["owner"])
    p = _latest_scan_path()
    local = None
    try:
        if p:
            local = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        pass
    from web.legacy_signals import latest_scan
    return _priv_json(_redact_scan_for(latest_scan(local), owner))


def _active_screener_symbols():
    """
    帳本上 source="screener" 仍開著的訊號代號清單。回傳 (symbols, error)。

    給 screener 當「強制回檢清單」：不論這些檔有沒有通過前篩，都要重新分析一次，
    否則帳本收不了倉——**訊號消失最常見的樣態（資費由負轉正）剛好會讓它掉出前篩**。

    ⚠️ 查不到就回空清單並把錯誤往上帶（fail-closed）：沒有回檢清單只會少收幾筆倉，
       而把「查不到」當成「都消失了」會直接偽造 closed 事件。
    """
    try:
        import ledger as _lg
        pub = getattr(_lg, "active_signals", None)      # 日後若 ledger 開公開 API 就優先用
        idx = pub("screener") if callable(pub) else _lg._active_index("screener")
        vals = idx.values() if isinstance(idx, dict) else (idx or [])
        syms = []
        for ev in vals:
            s = (ev or {}).get("symbol")
            if s and s not in syms:
                syms.append(s)
        return syms, None
    except Exception as e:
        return [], str(e)


def _merge_crypto_screen(result: dict):
    """
    把「幣圈全市場抄底組合」的完整成立標的併進掃描結果，讓它也會進 LINE 推播與帳本。

    設計取捨：
      - **只收完整成立**（★ 你的抄底設定），不收「醞釀中」。醞釀中代表條件尚未成立，
        推播它等於製造雜訊，而且會讓 LINE 免費額度（200 則/月）逼近上限。
      - 這條路徑不經過 rules.evaluate（手上只有幣安 combo 資料、沒有 analysis dict），
        所以 Risk Layer 算不出來 → 沿用 screener 的 RISK_NOT_EVALUATED 標記，
        **不讓它看起來比有跑過風險評估的標的更安全**。
      - 失敗不可影響 watchlist 掃描（那是主要功能）。

    ⚠️ 帳本不在這裡寫。scanner.scan() 內部在**回傳之前**就已經記完 watchlist 的帳本，
       所以這裡併進來的列再怎麼加也進不了那一份——順序上永遠是反的。
       帳本改由呼叫端（_run_scan）用 source="screener" 另外補寫，
       回傳值第二項就是要給它的列（見 _record_screen_ledger）。

    回傳 (out, ledger_rows)。
    """
    out = {"status": "skipped", "added": 0}
    t_start = datetime.now()
    # 帳本上還開著的 screener 訊號 → 交給 screener 強制回檢。
    # 沒有這一步，收倉幾乎不會發生：訊號消失最常見的樣態就是「資費由負轉正」，
    # 而那正好會讓它掉出前篩、根本不被分析（見 screener.screen_crypto_full 的說明）。
    active_syms, active_err = _active_screener_symbols()
    if active_err:
        out["active_lookup_error"] = active_err
    try:
        import screener
        res = screener.screen_crypto_full(must_check=active_syms)
    except Exception as e:
        out["status"] = "error"
        out["error"] = str(e)
        return out, []
    rows = res.get("rows") or []
    out["universe_ok"] = res.get("universe_ok")
    out["prefilter"] = res.get("prefilter")
    out["deep"] = res.get("deep")
    out["analyzed"] = len(res.get("analyzed") or [])
    out["incomplete"] = res.get("incomplete") or []
    out["forced_checked"] = res.get("forced_checked") or []
    out["forced_skipped"] = res.get("forced_skipped") or []
    if res.get("error"):
        out["screen_error"] = res["error"]

    # 結果存進共用快取：cron 已經付過這 107 次幣安請求的成本，
    # 前端按「機會掃描」時就不必再付一次（見 _store_screen_result / api_screen）。
    #
    # ⚠️ **空結果一律不進快取。** screener.screen_crypto() 對「幣安批次端點掛掉」
    #    （Render 美國機房 451、網路瞬斷、回傳非 list）也是回 []，跟「真的沒有標的符合」
    #    在這一層分不出來。若把 [] 存起來，接下來 SCREEN_CACHE_MIN 分鐘內
    #    每個按「機會掃描」的人都會看到一份帶時間戳的「0 個機會」——
    #    那是把「查不到」渲染成「查過了，沒有」，正是本專案禁止的 fail-open。
    #    代價只是「真的 0 檔」時少快取一次（下次按鈕會自己重跑），拿確定性換一次請求很划算。
    if rows:
        try:
            _store_screen_result("crypto", rows,
                                 datetime.now().isoformat(timespec="seconds"))
            out["cached_for_ui"] = True
        except Exception as e:
            out["cache_error"] = str(e)
    else:
        out["cached_for_ui"] = False
        # universe_ok 現在能把兩種空結果分開記（帳本收倉也靠同一個判準），
        # 但**行為仍維持不快取**：讓下一次按鈕自己重跑，代價只是一次請求。
        out["cache_skipped"] = ("幣安批次端點不可用，本輪等於沒查成" if not res.get("universe_ok")
                                else "本輪確實沒有標的符合（已查成）")
        out["cache_skipped_note"] = "空結果一律不寫前端快取，避免把『查不到』顯示成『查過了，沒有』"
    out["elapsed_sec"] = round((datetime.now() - t_start).total_seconds(), 2)

    # watchlist 這一輪的歸屬要分三種，**不可混為一談**（2026-08-13 接縫審查）：
    #   wl_ok  = watchlist 有這檔且本輪分析成功 → 由 watchlist 那條 source 追蹤，
    #            screener 帳本記一列空訊號（避免同一訊號被兩條 source 各算一次）
    #   wl_err = watchlist 有這檔但本輪抓取失敗 → **歸屬未定**：
    #            watchlist 那邊因為 error 列被略過（不開也不收），
    #            若 screener 這邊還照 wl_ok 的規則塞空訊號，就會替一個「其實還在」的訊號
    #            寫下假的 closed；反過來若照沒人管的規則開倉，等 watchlist 復原又會被收掉。
    #            → 這一輪整檔不進帳本（記在 ledger_deferred 供稽核），但**推播照發**，
    #              否則 watchlist 一失敗，這檔的真訊號就同時從推播與帳本消失。
    #   其餘   = screener 自己的地盤，照實記
    _wl_rows = result.get("rows") or []
    wl_ok = {r.get("symbol") for r in _wl_rows if r.get("symbol") and not r.get("error")}
    wl_err = {r.get("symbol") for r in _wl_rows if r.get("symbol") and r.get("error")}
    mkt_date = result.get("meta", {}).get("market_data_as_of")
    added = []
    ledger_rows = []
    deferred = []

    def _full_of(r):
        return [s for s in (r.get("signals") or [])
                if "抄底設定(軋空型)" in (s.get("label") or "")]

    # 帳本要收**每一檔真的分析過的**（不是只收成立的）：
    # 沒有那些「掃了但沒訊號」的列，ledger 就分不出「訊號消失」與「這次根本沒掃到」，
    # 先前開的倉會永遠掛在 active 上、closed 事件永遠不會發生。
    # analyzed 的判準在 screener.screen_crypto_full（資料查齊才算分析過）。
    #
    # ⚠️ 必須以**顯示代號**為單位彙整，不能逐筆記錄。
    #    幣安同一個顯示代號會對應多支永續（實測 2026-08-13 共 3 組：
    #    1000CAT/CAT、1000000BOB/BOB、G/0G），而帳本的 signal_id 是
    #    (顯示代號, 訊號家族, source) —— 兩支永續在帳本上是**同一筆訊號**。
    #    先前用 symbol 級的 `_seen` 去重，會發生：A 支查得齊且無訊號（進 analyzed）、
    #    B 支訊號成立但資料不全（只在 rows），B 因為 symbol 已在 _seen 而被丟掉
    #    → 同一輪裡「推播說這是新機會」而「帳本同時寫 closed」。實測可重現。
    _incomplete = set(res.get("incomplete") or [])
    by_sym = {}
    for r in list(res.get("analyzed") or []) + list(rows):
        sym = r.get("symbol")
        if not sym:
            continue
        cur = by_sym.get(sym)
        if cur is None:
            cur = by_sym[sym] = dict(r)
            cur["signals"] = list(_full_of(r))
            continue
        # 訊號取**聯集**：同一顯示代號底下任何一支永續成立，這個訊號就是成立的
        _have = {s.get("label") for s in cur["signals"]}
        for s in _full_of(r):
            if s.get("label") not in _have:
                cur["signals"].append(s)
                _have.add(s.get("label"))
        for k in ("price", "market_data_as_of", "risk"):
            if cur.get(k) is None:
                cur[k] = r.get(k)

    withheld = []
    for sym, r in by_sym.items():
        if sym in wl_err:
            deferred.append(sym)
            continue
        # 資料不完整但**訊號確實成立**的仍要進帳本：開倉靠正面證據（條件都成立了），
        # 收倉才需要資料完整——不對稱是刻意的：漏開＝訊號憑空消失，誤收＝謊報消失。
        # 反過來，沒有訊號**且**這個顯示代號底下還有沒查齊的永續 → 不可斷言消失。
        if not r["signals"] and sym not in wl_ok and sym in _incomplete:
            withheld.append(sym)
            continue
        # ⚠️ 行情基準日一律用**這一列自己的**，掃描層級的 max 只當退路。
        #    meta.market_data_as_of 是所有標的的最大值，而幣圈 24/7、台美股有收盤，
        #    兩者常常不同日（screener 幣圈列是「今天」，watchlist 若只剩台美股，
        #    max 會是上一個交易日，週末更差到兩三天）。
        #    ledger 用它當 t0＝績效起算日，錯一天就是 T+1/5/20/60 全部錯位一根 K，
        #    而且 t0_fallback 會標成 False（＝宣稱錨點精確），統計時連降權的機會都沒有。
        ledger_rows.append({
            "symbol": sym,
            "market": "幣圈",
            "signals": [] if sym in wl_ok else r["signals"],
            "market_data_as_of": r.get("market_data_as_of") or mkt_date,
            # 觸發當下的價格：帳本的 price_at_trigger 取這個欄位。
            # 缺了就是「推播出去的訊號沒有留下進場價」，事後無從稽核。
            "price": r.get("price"),
            "risk": r.get("risk"),
        })

    replaced = []
    _pushed_syms = set()
    for r in rows:
        sym = r.get("symbol")
        full = _full_of(r)
        if sym in wl_ok:
            continue                       # watchlist 已分析成功的不重複
        if not full:
            continue                       # 醞釀中 → 跳過
        if sym in _pushed_syms:
            # 同一顯示代號的第二支永續（1000CAT 與 CAT 都叫 CAT-USD）。
            # rows 已依 score 排序，留分數高的那支；再加一列只會讓表格重複顯示，
            # 而 notifier 的「代碼→列」對照是後者蓋前者＝順序相依的暗雷。
            continue
        _pushed_syms.add(sym)
        row = {
            **r,
            "market": "幣圈",
            "signals": full,
            "score": sum(s.get("strength", 0) for s in full),
            "source": "screener",
            # 同上：優先用該列自己的基準日。notifier 推播時就是逐列取這個欄位標「行情基準日」
            # （見 notifier 的說明：不能只用 meta 的最大值），寫成掃描層 max 等於推播標錯日期。
            "market_data_as_of": r.get("market_data_as_of") or mkt_date,
        }
        if sym in wl_err:
            # watchlist 這檔本輪抓取失敗 → 用 screener 的實測資料**取代**那一列，
            # 不是再追加一列（同一代碼出現兩列會讓表格重複顯示，而 notifier 的
            # 「代碼→列」對照是後者蓋前者，等於埋一個順序相依的暗雷）。
            # 原始錯誤保留在欄位裡，不隱瞞 watchlist 這條路失敗了。
            idx = next((i for i, x in enumerate(_wl_rows) if x.get("symbol") == sym), None)
            if idx is None:
                added.append(row)
                continue
            row["watchlist_error"] = _wl_rows[idx].get("error")
            row["source_note"] = "watchlist 本輪抓取失敗，改用 screener（幣安永續）的資料"
            result["rows"][idx] = row
            replaced.append(sym)
        else:
            added.append(row)
    if added or replaced:
        if added:
            result.setdefault("rows", []).extend(added)
        result["meta"]["count"] = len(result["rows"])
        result["meta"]["opportunities"] = sum(1 for r in result["rows"] if r.get("score", 0) > 0)
    if replaced:
        out["replaced_failed_watchlist_rows"] = replaced
    out.update(status="ok", added=len(added),
               symbols=[r["symbol"] for r in added] + replaced,
               hits=len(rows), ledger_rows=len(ledger_rows))
    if deferred:
        out["ledger_deferred"] = deferred
        out["ledger_deferred_note"] = ("watchlist 該檔本輪抓取失敗，歸屬未定：不進 screener 帳本"
                                       "（既不開倉也不收倉，避免重複計算或謊報消失），推播照發")
    if withheld:
        out["ledger_withheld"] = withheld
        out["ledger_withheld_note"] = ("本輪無訊號，但該顯示代號底下仍有永續沒查齊 → 不寫 closed"
                                       "（查不齊不等於訊號消失）")
    return out, ledger_rows


def _record_screen_ledger(ledger_rows: list, result: dict) -> dict:
    """
    把 screener 併進來的訊號補寫進 Signal Ledger（source="screener"）。

    為什麼要在 app 這一層補：scanner.scan() 記帳本時手上只有 watchlist 的列，
    而 screener 的列是掃描回來之後才併上去的——推播推得到、帳本卻收不到，
    等於「推播出去的訊號沒有績效可稽核」，正好是 v4 帳本要解決的問題本身。

    source 用獨立的 "screener"：帳本的 active 索引是按 source 分開重播的，
    不能跟 watchlist 混在同一個命名空間（否則兩邊會互相把對方的訊號判成已消失）。
    """
    if not ledger_rows:
        return {"status": "skipped", "reason": "無 screener 列"}
    try:
        import ledger as _lg
        out = _lg.record_scan(ledger_rows, result.get("meta") or {},
                              source="screener", regime=result.get("regimes"))
        out["sync"] = _lg.sync(reason="scan:screener")
        return out
    except Exception as e:
        return {"error": str(e)}


#: 候選清單要掃哪幾條鏈。可用環境變數 TRENCH_CHAINS 覆寫（逗號分隔）。
#:
#: ⚠️ **monad 刻意不在預設清單裡**：2026-09-08 實測它的 /v1/trenches 端點正常
#:    （HTTP 200 + code 0），但套門檻 0 筆、**不套門檻也是 0 筆**——那條鏈當時
#:    根本沒有已畢業代幣。每 4 小時替它打兩次 POST 等於一年 4,380 次已知會空手
#:    而回的請求。它不是「不支援」，所以會出現在回傳的 chains_skipped 裡並附理由，
#:    畫面說得出「我們沒掃 monad，因為實測它是空的；要掃就設 TRENCH_CHAINS」。
#:    ——留白才是問題：那會被讀成「monad 沒有符合條件的幣」。
ONCHAIN_CANDIDATE_CHAINS = ("sol", "bsc", "base", "eth")
ONCHAIN_CANDIDATE_SKIP = {
    "monad": "端點正常，但 2026-09-08 實測不套門檻也是 0 筆；每輪掃它只是白花額度。"
             "要掃請設環境變數 TRENCH_CHAINS（逗號分隔）。",
}


def _onchain_candidate_chains():
    raw = (os.environ.get("TRENCH_CHAINS") or "").strip()
    if not raw:
        return list(ONCHAIN_CANDIDATE_CHAINS)
    out = []
    for part in raw.split(","):
        p = part.strip().lower()
        if p and p not in out:
            out.append(p)
    return out or list(ONCHAIN_CANDIDATE_CHAINS)


def _scan_onchain_candidates() -> dict:
    """
    鏈上候選清單：**四條鏈**（sol／bsc／base／eth），每條鏈跑兩趟。

    為什麼是兩趟（2026-09-08 實測後的結論，見 agent/trenches.py 檔頭）：
      * tight 趟送完整門檻 → GMGN 拿去**整個池子**搜，這趟的 kept 才是清單本體。
      * loose 趟只送放大過的市值帶 → 這趟**只做歸因**，才數得出「每條鏈各被
        哪一項門檻擋掉幾檔」。門檻若全在伺服器端，被擋掉的我們根本收不到。
      只跑 tight 會沒有歸因；只跑 loose 會讓 sol 的候選從 30 檔掉到 2 檔
      （窗口只有最近 60 筆＝sol 約 1 小時）。兩者不可互相取代。

    ⚠️ **額度**：每趟 POST 權重 3。四鏈 × 2 趟 = 24 點。Free 方案每秒 5 點，
       所以**一定要序列跑**、讓 gmgn._throttle() 的全域權重漏桶排隊
       （約 4.8 秒）。這裡刻意不併發：GMGN 的限流看來源 IP，是全站共用資源，
       而且它的 429 訊息明說重複請求會把 ban 從 29 秒滾到 5 分鐘。
       要關掉歸因那趟（省一半額度）可設 TRENCH_ATTRIBUTION=0。

    ⚠️ **部分失敗不可靜默**：某條鏈掛掉時，其他鏈照常呈現，但那條鏈仍然要
       出現在 chains 裡並標 ok=False + 原因。少一列會被讀成「那條鏈沒有幣」。
    ⚠️ **不支援的鏈（tron／hood）也要列出來**，理由同上——「GMGN 不做這條鏈」
       跟「這條鏈今天沒有符合條件的幣」是完全不同的兩句話。
    ⚠️ 這條路徑**不碰 LINE**：這是「符合條件的清單」，不是訊號，更不是買賣指令。
    """
    import trenches as _tr
    from providers import gmgn as _gm

    want_attr = (os.environ.get("TRENCH_ATTRIBUTION") or "").strip() != "0"
    chains = _onchain_candidate_chains()
    entries, errors = [], []
    posts = [0]                 # 真的送出去的 POST 次數（不支援的鏈不會送）

    for ch in chains:
        entry = {"chain": ch, "ok": False, "status": "unknown", "message": None,
                 "fetched": None, "limit": 80, "candidates": None,
                 "attribution": None, "attribution_status": "skipped",
                 "attribution_message": None}
        # ⚠️ 兩趟**各自** try：合成一個 try 的話，歸因那趟丟例外會把已經拿到的
        #    清單一起標成 ok=False——畫面會同時出現「這條鏈沒取得」和它的幣，
        #    自相矛盾。歸因失敗只該讓歸因是空的，不該否定清單。
        try:
            # ── 第 1 趟：完整門檻（清單本體）──────────────────
            tight = _gm.trenches(ch, "completed",
                                 filters=_tr.api_filters("strict"), limit=80)
            # ⚠️ 只認 provider 自己回的 request_sent。原本是「status != chain_unsupported
            #    就 +1」，但 no_key／限流冷卻／端點退避這幾條也是本機擋下、
            #    一個位元組都沒送出——那樣會回報一個根本沒發生的額度用量。
            if tight.get("request_sent"):
                posts[0] += 1
            entry["chain"] = tight.get("chain") or ch
            entry["status"] = tight.get("status") or "unknown"
            entry["message"] = tight.get("message")
            entry["trenches_support"] = tight.get("trenches_support")
            if tight.get("available"):
                lst = tight.get("list") or []
                entry["ok"] = True
                entry["fetched"] = len(lst)
                entry["limit"] = tight.get("limit_sent") or 80
                # ⚠️ 直接用 provider 判好的旗標。**不要**在這裡或下游重算成
                #    fetched >= limit：實測「送 limit=80 只回 60」，那個算法永遠
                #    是 False，於是「更舊的畢業幣沒被看到」永遠印不出來。
                entry["window_capped"] = bool(tight.get("window_capped"))
                entry["window_cap"] = tight.get("window_cap")
                entry["candidates"] = _tr.screen(lst, entry["chain"])
            else:
                errors.append("%s：%s" % (ch, tight.get("message") or entry["status"]))
        except Exception as e:
            entry["ok"] = False
            entry["candidates"] = None
            entry["status"] = "error"
            entry["message"] = "%s: %s" % (type(e).__name__, e)
            errors.append("%s：%s" % (ch, entry["message"]))

        # ── 第 2 趟：寬鬆（只做歸因）─────────────────────
        try:
            if not want_attr:
                entry["attribution_message"] = ("已用 TRENCH_ATTRIBUTION=0 關閉歸因那一趟"
                                                "——⚠️ 沒有數字不代表沒有被擋掉的幣。")
            elif entry["status"] in ("no_key", "rate_limited", "chain_unsupported"):
                # 這幾種失敗再打一次也是同樣結果，別白花額度。
                entry["attribution_message"] = ("第一趟就是 %s，歸因那一趟不重打"
                                                "（同樣的原因會再失敗一次）" % entry["status"])
            else:
                loose = _gm.trenches(ch, "completed",
                                     filters=_tr.api_filters("loose"), limit=80)
                if loose.get("request_sent"):
                    posts[0] += 1
                if loose.get("available"):
                    entry["attribution_status"] = "ok"
                    entry["attribution"] = _tr.screen(loose.get("list") or [],
                                                      loose.get("chain") or ch)
                    # 歸因取樣本身也是一個窗口。實測 sol／bsc／base 這一趟每次都
                    # 頂到 60 筆——不說的話「取樣 60 檔」會被讀成「最近就這 60 檔」。
                    entry["attribution_limit"] = loose.get("limit_sent") or 80
                    entry["attribution_window_capped"] = bool(loose.get("window_capped"))
                    entry["attribution_window_cap"] = loose.get("window_cap")
                else:
                    entry["attribution_status"] = "failed"
                    entry["attribution_message"] = (
                        "%s——⚠️ 這是歸因沒做成，不是「沒有被擋掉的幣」"
                        % (loose.get("message") or loose.get("status")))
        except Exception as e:
            entry["attribution"] = None
            entry["attribution_status"] = "failed"
            entry["attribution_message"] = ("%s: %s——⚠️ 這是歸因沒做成，"
                                            "不是「沒有被擋掉的幣」"
                                            % (type(e).__name__, e))
        entries.append(entry)

    # 不支援 / 本輪沒掃的鏈——**一定要說出來**，否則會被讀成「那條鏈沒有幣」。
    # ⚠️ 要在 put() **之前**算好並一起存進狀態檔：畫面走的是唯讀快照
    #    （/api/onchain_candidates 不重跑掃描），沒存就等於畫面上完全不會提到
    #    monad／tron／hood——那正是「留白被讀成沒有」。
    # ⚠️ 已經在 chains 裡有自己一列的鏈不重複列（免得同一條鏈兩套說法）。
    scanned = {e.get("chain") for e in entries if e.get("chain")}
    absent = []
    for c in getattr(_gm, "TRENCH_UNSUPPORTED", ()):
        if c in scanned:
            continue
        sup = _gm.trenches_support(c)
        # ⚠️ 三態，**不可以壓成 bool**。CHAINS[...]["verified"] 的語意是
        #    「GMGN 的 token_security 我實際打過並拿到 code 0」；False 在那張表
        #    是「沒打過」，不是「打過、不支援」。壓成 token_security_supported=False
        #    就把「沒查」渲染成「不支援」——本專案最忌諱的那種假結論。
        ts_ok = (_gm.CHAINS.get(c) or {}).get("verified") is True
        absent.append({
            "chain": c, "chain_label": sup.get("label") or c,
            "kind": "unsupported",
            "reason": sup.get("note"),
            "token_security": "verified" if ts_ok else "untested",
            "token_security_note": (
                "GMGN 的合約風險查詢（token_security）本站實測打得通——那是另一個端點、"
                "另一件事，不要跟這份清單混在一起看。"
                if ts_ok else
                "GMGN 的合約風險查詢（token_security）本站**沒有實測過這條鏈**——"
                "沒實測不等於不支援，也不等於支援。"),
            "site_risk_note": ("本站的『鏈上代幣風險查詢』是另一條線（主要走 GoPlus，"
                               "GMGN 只作備援），與這份候選清單無關。"),
            "note": "GMGN 的候選清單（trenches）端點不支援這條鏈。"
                    "⚠️ 這不是「這條鏈沒有符合條件的幣」。"})
    for c, why in ONCHAIN_CANDIDATE_SKIP.items():
        if c in scanned:
            continue
        absent.append({"chain": c,
                       "chain_label": (_gm.CHAINS.get(c) or {}).get("label") or c,
                       "kind": "skipped", "reason": why,
                       "note": "本輪沒有掃這條鏈。⚠️ 這不是「這條鏈沒有符合條件的幣」。"})

    put = _tr.put(entries, absent=absent)
    unsupported = [a for a in absent if a.get("kind") == "unsupported"]
    skipped = [a for a in absent if a.get("kind") == "skipped"]

    out = {
        "status": put.get("status"),
        "chains_scanned": chains,
        "chains": put.get("chains") or [],
        "kept": put.get("kept"),
        "kept_total": put.get("kept_total"),
        "dropped": put.get("dropped"),
        "chains_absent": absent,
        "chains_unsupported": unsupported,
        "chains_skipped": skipped,
        "attribution_enabled": want_attr,
        # 伺服器端做掉的門檻＝被它篩掉的我們收不到，無法歸因。政策要跟著結果走。
        "prefiltered_by_api": _tr.prefiltered_by_api("strict"),
        "attribution_prefiltered_by_api": _tr.prefiltered_by_api("loose"),
        "api_calls": posts[0],
        "api_weight": posts[0] * 3,     # /v1/trenches 權重 3；Free 方案每秒 5 點
        "note": ("每條鏈跑兩趟：完整門檻（清單本體，GMGN 端搜全池）＋寬鬆（只做歸因）。"
                 "歸因是最近 N 檔畢業幣的取樣，不是全鏈普查。"),
    }
    if errors:
        # 留白會被讀成「今天沒有符合條件的幣」。明講是哪幾條鏈沒取得。
        out["errors"] = errors
        out["errors_note"] = ("上列鏈這一輪沒有取得——⚠️ 這是查不到，"
                              "不是「那些鏈沒有符合條件的幣」。其餘鏈的結果照常。")
    return out


def _run_scan(allow_push: bool = False, gen: int | None = None):
    """allow_push=True 只給「憑密鑰的 cron 觸發」用（站主本人），公開訪客觸發一律不推。
    gen 是世代序號：本輪若已被逾時逃生門取代，收尾時不回寫狀態（gen=None 則不檢查）。"""
    # running 旗標已在 api_rescan 的鎖內設好
    from web.runtime_memory import log as memory_log
    def phase(stage):
        with _lock:
            if not _job_superseded(gen):
                _job.update(phase=stage, phase_at=datetime.now().isoformat(timespec="seconds"))
        memory_log(stage)
    phase('scan-start')
    try:
        # ⚠️ 帳本分片必須在 **掃描之前** 拉回來。
        # Render 是 ephemeral fs 且每 4 小時之間必定 spin down 一次，重啟後本機分片是空的；
        # record_scan 的 _active_index 讀不到既有訊號 → 持續中的訊號被當成新的重複開倉。
        # 遠端實測：183 筆 opened 只有 53 個不重複，同一訊號最多重複 6 次。
        # （先前把 pull 放在 scan 之後，對冪等性毫無幫助。）
        pulled = {"status": "skipped"}
        try:
            import ledger as _lg
            # pull() 無參數＝拉回 ledger.PULL_MONTHS 個月（目前 6 個月）。
            # 不能只拉當月+上月：訊號極黏著，開超過兩個月很常見，
            # 少拉的那幾個月會讓 _active_index 把仍活著的訊號當成新的重開倉。
            pulled = _lg.pull()
        except Exception as e:
            pulled = {"error": str(e)}

        # 跳過慢速 FRED 大盤資料建置（雲端弱 CPU 常卡）；保留較快的幣圈情緒/BTC.D
        phase('scan-ledger-loaded')
        result = scanner.scan(build_macro=False, build_crypto=True, max_workers=2)
        phase('scan-watchlist-complete')
        result["ledger_pull"] = pulled
        # 幣圈全市場抄底組合：把使用者的核心 edge 從 watchlist 9 檔擴大到全幣安永續。
        # 只納入「完整成立」的，**不含醞釀中**——醞釀中是「條件還沒成立」，
        # 推了就是雜訊，而且會讓 LINE 月額度（200 則）逼近上限。
        # 實測：全市場掃描 1.2 秒、命中 3~4 檔，成本可忽略。
        cs_out, cs_ledger_rows = _merge_crypto_screen(result)
        phase('scan-crypto-complete')
        result["crypto_screen"] = cs_out
        # 詐屍防線：卡了 15 分鐘以上才回來的舊執行緒，手上的行情已經過期，
        # 不可以覆寫新一輪剛寫好的 SCAN 檔（會讓 notifier 的前後比對基準退回舊資料），
        # 也不該補推那批過期訊號到 LINE。
        with _lock:
            if _job_superseded(gen):
                return
        # 帳本補寫放在詐屍防線**之後**：過期那輪的訊號不該進帳本（會製造假的開/關倉）。
        cs_out["ledger"] = _record_screen_ledger(cs_ledger_rows, result)
        out = REPORTS / f"SCAN_{scanner._today_str()}.json"

        def _write_scan():
            """寫出 SCAN 檔（原子替換：訪客輪詢不會讀到半個檔）。"""
            payload = json.dumps(result, ensure_ascii=False, indent=2)
            if atomic_write_text is not None:
                atomic_write_text(out, payload)
            else:
                REPORTS.mkdir(exist_ok=True)
                out.write_text(payload, encoding="utf-8")
            # The deployment filesystem is temporary. Store the original scan
            # privately so both the website and the notifier can recover it.
            from web.legacy_signals import save_scan
            stored = save_scan(result)
            if stored != "synced":
                print("legacy scan backup: " + stored, file=sys.stderr)
            from web import public_research
            public_research.publish_scan(result)

        # 第一次寫檔：先讓前端與 notifier 拿到掃描結果，不必等下面較慢的鏈上檢查/績效回填。
        # （notifier 比對的是**前一份** SCAN，不受這次寫檔影響。）
        _write_scan()
        # 選用：把「新出現」的機會推到 LINE。
        # 公開唯讀模式不推——否則任何陌生訪客按重掃都可能觸發 broadcast 給你所有 LINE 好友。
        # 鏈上代幣（土狗幣）風險惡化檢查：只在有推播權限時跑，
        # 且只推「狀態改變」的（不報「目前是壞的」，那每次都成立＝雜訊）
        # ⚠️ 傳**完整結果**而不是只傳 alerts 清單：notifier 需要 unchecked 才能在
        #    推播裡附註「本輪有 N 檔沒查到」。只傳 alerts 的話那句話永遠不會出現，
        #    使用者就會把「沒有告警」讀成「全部平安」——但 GoPlus 每分鐘 30 次的限制
        #    讓一輪查不完是常態。（該附註不會自己觸發推播，見 notifier._onchain_alert_lines）
        oc_alerts = []
        if allow_push:
            try:
                import onchain_watch
                ocw = onchain_watch.check_all()
                result["onchain_watch"] = ocw
                # ⚠️ 一律把**完整結果**往下傳（不是只傳 alerts）：notifier 需要
                #    unchecked / status 才能在推播裡附註「本輪有 N 檔沒查到」。
                #    沒有 alerts 時 _onchain_alert_lines 會回空 list，
                #    所以這不會多發任何一則推播。
                oc_alerts = ocw
                if ocw.get("status") == "state_unavailable":
                    # 「讀不到清單」＝這一輪一檔都沒查。刻意**不**讓它自己發一則
                    # LINE（系統狀態不是市場事件，免費額度 200 則/月，每 4 小時一輪
                    # 會被燒光）——可見出口是伺服器日誌、SCAN 檔的稽核區塊，
                    # 以及網站清單區的紅底提示。
                    print("⚠ onchain_watch：本輪讀不到監控清單，一檔都沒查（%s）"
                          % ocw.get("error"), file=sys.stderr)
            except Exception as e:
                result["onchain_watch"] = {"error": str(e)}
        else:
            # 沒有推播權限就不查鏈上（GoPlus 有速率限制）。但不能留白——
            # 留白會被讀成「查過了、沒問題」。明講這一輪沒查。
            result["onchain_watch"] = {"status": "skipped",
                                       "reason": "本輪無推播權限（非 cron 觸發），未執行鏈上檢查；"
                                                 "未檢查不等於無風險"}

        pushed = 0
        if notifier is not None and (allow_push or not READONLY):
            try:
                pushed = notifier.push_new_opportunities(result, onchain_alerts=oc_alerts)
            except Exception as e:
                print("LINE push 失敗：", e, file=sys.stderr)
        phase('scan-notifications-complete')
        # ── 推特指定人物監控 ─────────────────────────────────────
        # ⚠️ 只在有推播權限（＝帶對 CRON_KEY 的排程）那條路徑跑：公開訪客
        #    觸發的掃描不該替站主消耗推特 API 額度（每月總量制，用完就沒了）。
        # ⚠️ 排在 LINE 推播**之後**：市場訊號才是站主最在意的，不該讓推特
        #    這條把他的注意力和額度先吃掉。
        if allow_push:
            try:
                import twitterwatch as _tw
                from providers import opentwitter as _ot

                def _fetch(u, n):
                    r = _ot.user_tweets(u, limit=n)
                    if not r.get("available"):
                        raise RuntimeError(r.get("message") or r.get("status"))
                    return {"data": r.get("data")}

                _twr = _tw.poll(_tw.accounts(), _fetch)
                # 每日上限只擋「推到手機」，命中本身照樣全部留在網站上。
                # ⚠️ 順序不可對調：**先送、送成功了才標記**。反過來的話，
                #    LINE 額度水位擋下或連線逾時的那幾則會被標成已推，
                #    從此不再補送，而畫面上還寫著「已推播」。
                _picked = _tw.pick_for_notify(_tw.max_notify_per_day())
                _sent = []
                try:
                    if notifier is not None and _picked:
                        _sent = notifier.push_twitter_hits(_picked)
                finally:
                    _tw.mark_notified(_sent)
                _twr["picked"] = len(_picked)
                _twr["notified"] = len(_sent)
                _twr["unsent"] = len(_picked) - len(_sent)
                if _twr["unsent"]:
                    _twr["unsent_note"] = ("有 %d 則挑中了但沒送出去（額度或連線），"
                                           "已保留給下一輪重試"
                                           % _twr["unsent"])
                result["twitter_watch"] = _twr
            except Exception as e:
                msg = "%s: %s" % (type(e).__name__, e)
                result["twitter_watch"] = {"error": msg}
                # ⚠️ 一定要寫進狀態檔。只放進 result 的話它只會進 SCAN 檔，
                #    而前端沒有任何地方渲染 SCAN 的 twitter_watch——站主看到的
                #    會是「還沒有任何帳號的檢查紀錄」，把持續失敗畫成還沒開始。
                try:
                    import twitterwatch as _tw2
                    _tw2.note_run_error(msg)
                except Exception:
                    print("twitter_watch 連失敗痕跡都寫不進去", file=sys.stderr)
        else:
            # 留白會被讀成「他們沒發文」。明講這一輪沒查。
            result["twitter_watch"] = {"status": "skipped",
                                       "reason": "本輪無推播權限（非 cron 觸發），未查推特"}

        # ── 鏈上候選清單（GMGN trenches 篩選）────────────────────
        # ⚠️ 只在有推播權限（＝帶對 CRON_KEY 的排程）那條路徑跑：這支要花
        #    GMGN 額度（權重 3），公開訪客觸發的掃描不該替站主消耗它。
        # ⚠️ 不推 LINE：這是「符合條件的清單」，不是訊號，更不是買賣指令。
        if allow_push:
            try:
                result["onchain_candidates"] = _scan_onchain_candidates()
            except Exception as e:
                result["onchain_candidates"] = {
                    "error": "%s: %s" % (type(e).__name__, e)}
        else:
            result["onchain_candidates"] = {
                "status": "skipped",
                "reason": "本輪無推播權限（非 cron 觸發），未跑候選篩選"}

        # 鏈上代幣取樣。**一定要排在 backfill 之前**：backfill 讀的就是這份序列，
        # 順序反了的話今天這一根要等下一輪才進得去（多等 4 小時）。
        #
        # 為什麼要自己累積：DexScreener 只給當下價格、不給歷史 K 線，而幣安與
        # yfinance 都沒有迷因幣 → 不自己記，微信 CA 的績效永遠是空的
        # （見 agent/wechatprices.py 檔頭）。每 4 小時一次 ≈ 每天 6 個取樣點。
        #
        # ⚠️ 只在有推播權限（＝帶對 CRON_KEY 的排程）那條路徑跑。公開訪客觸發
        #    的掃描不該替站主消耗 DexScreener 額度，也不該偷偷寫狀態檔。
        if allow_push:
            try:
                import wechatprices as _wp
                result["wechat_ca_prices"] = _wp.observe(
                    _dex_price, limit=WECHAT_PRICE_PER_RUN)
            except Exception as e:
                result["wechat_ca_prices"] = {"error": str(e)}
        else:
            # 留白會被讀成「有記」。明講這一輪沒記。
            result["wechat_ca_prices"] = {"status": "skipped",
                                          "reason": "本輪無推播權限（非 cron 觸發），未取樣"}

        # 補算已到期訊號的績效。放在推播**之後**：它會抓日線、比較慢，
        # 不該讓它擋住使用者最在意的即時提醒；失敗也不影響本輪掃描結果。
        try:
            import ledger as _lg2
            result["ledger_backfill"] = _lg2.backfill_outcomes(max_signals=BACKFILL_PER_RUN)
            _lg2.sync(reason="backfill")
            phase('scan-backfill-complete')
        except Exception as e:
            result["ledger_backfill"] = {"error": str(e)}

        # 第二次寫檔：把鏈上檢查（含 unchecked/next_cursor 輪替游標）與績效回填的
        # 稽核痕跡真的留在 SCAN 檔裡。
        # ⚠️ 這段以前是死賦值——payload 早在上面就 json.dumps 完了，
        #    result["onchain_watch"] / result["ledger_backfill"] 再怎麼寫都進不了檔案，
        #    等於「有查、有標，但沒人看得到」。稽核痕跡寫不進檔＝沒有稽核痕跡。
        with _lock:
            if _job_superseded(gen):
                return                 # 已被逾時逃生門取代：不覆寫新一輪剛寫好的檔
        try:
            _write_scan()
        except Exception as e:
            print("SCAN 檔補寫失敗（鏈上/績效稽核欄位未落檔）：", e, file=sys.stderr)

        with _lock:
            if _job_superseded(gen):
                return                 # 本輪已被逾時逃生門取代，不覆寫新一輪的狀態
            # error=None：這輪成功就得清掉「上一輪逾時」的註記，否則前端會把成功的掃描顯示成失敗
            _job.update(running=False, done=datetime.now().isoformat(timespec="seconds"), error=None,
                        msg=f"完成：{result['meta']['count']} 檔，{result['meta']['opportunities']} 檔有訊號"
                            + (f"，LINE 推播 {pushed} 則" if pushed else ""))
    except Exception as e:
        with _lock:
            if _job_superseded(gen):
                return
            _job.update(running=False, done=datetime.now().isoformat(timespec="seconds"),
                        error=str(e), msg="掃描失敗")


@app.post("/api/rescan")
def api_rescan():
    global _job_gen, _screen_gen
    with _screen_lock:                     # 同 api_screen：固定順序巢狀鎖，原子的「查對方＋設自己」
        if _scan_worker_alive():
            return {"ok": False, "msg": "前一輪掃描仍在執行，本次略過以避免重複占用記憶體"}
        with _lock:
            if _screen["running"] and not _is_stale(_screen):
                return {"ok": False, "msg": "機會掃描進行中，請稍候再掃"}
            if _screen["running"]:         # 已卡死：一併解鎖，免得前端永遠顯示機會掃描中
                _screen_gen += 1
                _screen.update(running=False, error="機會掃描逾時（已自動解鎖）", msg="掃描逾時")
            if _job["running"] and not _is_stale(_job):
                return {"ok": False, "msg": "已有掃描進行中"}
            stale = _job["running"]        # 逾時逃生門：卡死超過 STALE_JOB_MIN 分鐘就覆寫旗標重啟
            _job_gen += 1
            gen = _job_gen
            _job.update(running=True, started=datetime.now().isoformat(timespec="seconds"), done=None,
                        msg="掃描中…抓取即時資料" + ("（前一次逾時，已自動解鎖）" if stale else ""),
                        error="前一次掃描逾時（已自動解鎖）" if stale else None)
        try:
            _launch_scan(_run_scan, kwargs={"gen": gen})
        except Exception as e:
            with _lock:
                _job.update(running=False, error=f"無法啟動：{e}", msg="掃描失敗")
            return {"ok": False, "msg": "系統忙碌，請稍後再試"}
    return {"ok": True, "msg": "已開始掃描"}


@app.get("/api/cron/scan")
def api_cron_scan(key: str = ""):
    """
    給外部排程器（cron-job.org）定時觸發：掃描 + 推播新機會到 LINE。
    需帶 ?key=<CRON_KEY 環境變數>；未設 CRON_KEY 則此端點停用（避免公開站被亂觸發）。
    這是唯一在唯讀模式下仍允許推播的路徑——因為它需要只有站主知道的密鑰。
    """
    expected = os.environ.get("CRON_KEY", "").strip()
    if not expected:
        return JSONResponse({"ok": False, "msg": "未設定 CRON_KEY，此端點停用"}, status_code=404)
    # _ct_eq＝定時比較，防時序推測；且非 ASCII 的 key（中文/emoji）要回 401 不是 500
    if not _ct_eq((key or "").strip(), expected):
        return JSONResponse({"ok": False, "msg": "unauthorized"}, status_code=401)

    global _job_gen, _screen_gen
    with _screen_lock:
        if _scan_worker_alive():
            return {"ok": False, "msg": "前一輪掃描仍在執行，本次略過以避免重複占用記憶體"}
        with _lock:
            # 逾時逃生門：卡死的旗標不能讓定時推播永久靜默（每 4 小時才觸發一次，卡住就是全靜音）
            if (_screen["running"] and not _is_stale(_screen)) or (_job["running"] and not _is_stale(_job)):
                return {"ok": False, "msg": "已有掃描進行中，本次略過"}
            if _screen["running"]:         # 已卡死：一併解鎖
                _screen_gen += 1
                _screen.update(running=False, error="機會掃描逾時（已自動解鎖）", msg="掃描逾時")
            stale = _job["running"]
            _job_gen += 1
            gen = _job_gen
            _job.update(running=True, started=datetime.now().isoformat(timespec="seconds"), done=None,
                        msg="定時掃描中…" + ("（前一次逾時，已自動解鎖）" if stale else ""),
                        error="前一次掃描逾時（已自動解鎖）" if stale else None)
        try:
            _launch_scan(_run_scan, kwargs={"allow_push": True, "gen": gen})
        except Exception as e:
            with _lock:
                _job.update(running=False, error=f"無法啟動：{e}", msg="掃描失敗")
            return JSONResponse({"ok": False, "msg": "系統忙碌"}, status_code=503)
    return {"ok": True, "msg": "已開始定時掃描（有新機會會推 LINE）"}


@app.get("/api/status")
def api_status():
    with _lock:
        return dict(_job)


@app.get("/api/inspect")
def api_inspect(symbol: str, market: str = ""):
    """即時看盤：輸入任一代碼，跑使用者規則 + 依 SOP 參考位。同步執行（約 5~15 秒）。
    market: crypto(幣圈) / us(美股) / tw(台股) / 空=自動。"""
    sym = (symbol or "").strip()
    if not sym:
        return JSONResponse({"error": "請輸入代碼"}, status_code=400)
    if not _SYM_RE.match(sym):
        return JSONResponse({"error": "代碼格式不正確（僅接受英數、.、-）"}, status_code=400)
    mk = (market or "").strip().lower() or None
    if mk not in (None, "crypto", "us", "tw"):
        mk = None
    tk = _inspect_slots.acquire()
    if tk is None:
        # 429 要講得出「剛好在算」還是「卡住了」——同一句「請稍候幾秒」在
        # 前者是事實、在後者是謊話（等一輩子也不會好）。
        info = _inspect_slots.busy_info()
        return JSONResponse({"error": "分析請求較多：%s" % _inspect_slots.busy_note(),
                             "busy": info}, status_code=429)
    try:
        return JSONResponse(scanner.inspect(sym, market=mk))
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as e:
        # 內部錯誤細節只進伺服器 log，不回給訪客
        print(f"inspect 失敗 {sym}: {type(e).__name__}: {e}", file=sys.stderr)
        return JSONResponse({"error": "分析暫時失敗，請稍後再試"}, status_code=500)
    finally:
        _inspect_slots.release(tk)


@app.get("/api/watchlist")
def api_watchlist():
    p = ROOT / "watchlist.json"
    if not p.exists():
        return {"watchlist": []}
    return json.loads(p.read_text(encoding="utf-8"))


@app.post("/api/watchlist")
def api_set_watchlist(payload: dict = Body(...)):
    if READONLY:
        return JSONResponse({"ok": False, "error": "公開展示版為唯讀，監控清單僅站主本機可編輯"},
                            status_code=403)
    wl = payload.get("watchlist", [])
    if not isinstance(wl, list):
        return JSONResponse({"ok": False, "error": "格式錯誤"}, status_code=400)
    # 清洗：symbol 白名單、market 長度上限、清單上限 50 檔
    clean = []
    seen = set()
    for it in wl[:50]:
        if not isinstance(it, dict):
            continue
        sym = str(it.get("symbol", "")).strip().upper()
        if not sym or sym in seen or not _SYM_RE.match(sym):
            continue
        seen.add(sym)
        clean.append({"symbol": sym, "market": str(it.get("market", "")).strip()[:10] or "自訂"})
    p = ROOT / "watchlist.json"
    data = {"note": "由 dashboard 編輯。", "watchlist": clean}
    payload_text = json.dumps(data, ensure_ascii=False, indent=2)
    if atomic_write_text is not None:
        atomic_write_text(p, payload_text)
    else:
        p.write_text(payload_text, encoding="utf-8")
    return {"ok": True, "count": len(clean)}


@app.get("/api/config")
def api_config():
    return {"readonly": READONLY}


# ═══════════════════════════════════════════════════════════════════════════
# 站主登入 / 登出 / 狀態
# ═══════════════════════════════════════════════════════════════════════════
#: 登入 body 的大小上限。這是**未授權**端點，直接 await request.body() 等於讓任何人
#: 用一個 10MB 的 body 吃掉記憶體（同 /api/line/webhook、/api/tv/webhook 的理由）。
OWNER_LOGIN_MAX_BODY = 4 * 1024
#: 金鑰欄位長度上限。比對前先截斷，避免拿超長字串去做雜湊運算。
OWNER_KEY_MAX_LEN = 512


@app.post("/api/owner/login")
async def api_owner_login(request: Request):
    """
    用 OWNER_KEY 換一張有到期時間的簽章 cookie。

    body: {"key": "..."}
    成功 200 {"ok":true,"owner":true,"expires_at":"ISO"} ＋ Set-Cookie（HttpOnly/SameSite=Lax）
    失敗 401 {"ok":false,"error":"...","retry_after_seconds":N|null}

    四道閘，順序不可調換：
      1. body 大小上限（在讀取內容之前）。
      2. **鎖定檢查在比對之前**——鎖定期間根本不做比對，那才叫鎖定。
      3. 未設 OWNER_KEY → 401 並明講是設定問題（不是「壞了」，也不可以退成放行）。
      4. 定時比較（_ct_eq；中文／emoji 金鑰要回 401 而不是 500）。
    """
    raw = await _read_body_capped(request, OWNER_LOGIN_MAX_BODY)
    if raw is None:
        return _priv_json({"ok": False, "error": "payload 過大或讀取中斷",
                           "retry_after_seconds": None}, status=413)

    wait = _owner_retry_after()
    if wait > 0:
        # 鎖定期間不比對任何東西（比對本身就是攻擊者要的那次嘗試）
        return _priv_json({"ok": False, "owner": False,
                           "error": "登入嘗試過於頻繁，已暫時鎖定，請稍後再試",
                           "retry_after_seconds": wait},
                          status=401)

    try:
        body = json.loads(raw.decode("utf-8")) if raw else {}
    except Exception:
        body = {}
    key = body.get("key") if isinstance(body, dict) else None
    key = (str(key) if key is not None else "").strip()[:OWNER_KEY_MAX_LEN]

    want = _owner_key()
    if not want:
        # 沒設定就沒有人是站主。仍然計入失敗次數：不然這個端點會變成免費的探測管道。
        w = _owner_note_fail()
        return _priv_json({"ok": False, "owner": False, "configured": False,
                           "error": "尚未設定 OWNER_KEY，站主登入停用；"
                                    "在環境變數設好 OWNER_KEY 後即可登入。"
                                    "在此之前私人區塊對所有人隱藏（這是設定問題，不是故障）。",
                           "retry_after_seconds": w or None},
                          status=401)

    if not (key and _ct_eq(key, want)):
        w = _owner_note_fail()
        return _priv_json({"ok": False, "owner": False, "configured": True,
                           "error": "金鑰錯誤", "retry_after_seconds": w or None},
                          status=401)

    _owner_note_ok()
    token, exp = _owner_make_token()
    resp = _priv_json({"ok": True, "owner": True, "configured": True,
                       "expires_at": _owner_exp_iso(exp),
                       "note": "已登入。cookie 為 HttpOnly，前端讀不到也不需要讀；"
                               "到期時間寫在簽章裡，過期即失效。"})
    resp.set_cookie(OWNER_COOKIE, token,
                    max_age=int(OWNER_SESSION_HOURS * 3600),
                    httponly=True, secure=_cookie_secure(request),
                    samesite="lax", path="/")
    print("站主登入成功｜%s" % datetime.now().isoformat(timespec="seconds"), file=sys.stderr)
    return resp


@app.post("/api/owner/logout")
def api_owner_logout(request: Request):
    """登出：清掉 cookie。未登入時也回 ok（登出本來就該是冪等的）。"""
    resp = _priv_json({"ok": True, "owner": False,
                       "configured": _owner_configured(),
                       "note": "已登出。" + ("本機開發模式仍視為站主（OWNER_LOCAL_TRUST）。"
                                             if _local_trusted_request(request) else "")})
    resp.delete_cookie(OWNER_COOKIE, path="/",
                       httponly=True, secure=_cookie_secure(request), samesite="lax")
    return resp


@app.get("/api/owner/status")
def api_owner_status(request: Request):
    """
    目前這個瀏覽器是不是站主。

    `configured`＝有沒有設 OWNER_KEY —— 前端要能分辨「沒登入」與「根本沒設定」，
    後者是設定問題，畫面上該講的是「去設 OWNER_KEY」而不是「請登入」。
    """
    st = _owner_state(request)
    return _priv_json({"owner": bool(st["owner"]), "configured": bool(st["configured"]),
                       "expires_at": st["expires_at"], "note": st["note"],
                       "via": st["via"], "reason": st["reason"],
                       "locked_seconds": _owner_retry_after()})


def _wallet_origin_ok(request: Request) -> bool:
    # Wallet actions are JSON POSTs from this site's own browser page only.
    origin = request.headers.get("origin", "").rstrip("/")
    return origin == holder_auth._origin() or (getattr(request.state, "world_portal", False) and origin == world_auth.PORTAL_ORIGIN)


def _holder_eligible(request: Request) -> tuple[str | None, bool]:
    """A present World cookie is authoritative even if it is invalid/revoked."""
    if not getattr(request.state, "world_portal", False):
        return None, False
    cached = getattr(request.state, "holder_eligibility", None)
    if cached is not None:
        return cached
    if world_auth.COOKIE in request.cookies:
        try:
            result = world_auth.session_eligible(request.cookies[world_auth.COOKIE], require_profile="world")
        except (OSError, sqlite3.Error):
            raise world_auth.BridgeUnavailable("world_unavailable") from None
    else:
        result = (None, False)
    request.state.holder_eligibility = result
    return result


def _world_redirect(result: str, lang: str = "en", *, portal: bool = False) -> RedirectResponse:
    return RedirectResponse(("/portal-result" if portal else "/") + "?lang=" + ("zh" if lang == "zh" else "en") + "&world_login=" + result,
        status_code=303, headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})


@app.get("/api/holder/world/start")
def api_holder_world_start(request: Request):
    lang = request.query_params.get("lang", "en")
    if not getattr(request.state, "world_portal", False):
        return RedirectResponse("https://imdember.com/?portal=aimarket&lang=" + ("zh" if lang == "zh" else "en"), status_code=303,
            headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})
    if not _public_lite_enabled():
        return _world_redirect("unavailable", lang, portal=True)
    try:
        start = world_auth.begin_login(lang, request.query_params.get("expected_address"), profile="world")
    except world_auth.BridgeDenied:
        return _world_redirect("denied", lang, portal=True)
    except (world_auth.BridgeUnavailable, OSError, sqlite3.Error):
        return _world_redirect("unavailable", lang, portal=True)
    response = RedirectResponse(start.url, status_code=303,
        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})
    response.set_cookie(world_auth.FLOW_COOKIE, start.flow_cookie, max_age=world_auth.FLOW_SECONDS,
        httponly=True, secure=True, samesite="lax", path="/")
    return response


@app.get("/api/holder/world/callback")
def api_holder_world_callback(request: Request):
    state, flow = request.query_params.get("state", ""), request.cookies.get(world_auth.FLOW_COOKIE, "")
    lang = "en"
    try:
        lang = world_auth.flow_language(state, flow)
        if not getattr(request.state, "world_portal", False) or not _public_lite_enabled() or any(len(request.query_params.getlist(key)) > 1 for key in ("state", "code", "error")):
            raise world_auth.BridgeDenied("invalid_request")
        result = world_auth.complete_login(state, flow, request.query_params.get("code", ""),
            denied="error" in request.query_params, profile="world")
        # Replacement is explicit and occurs only after the new proof and holding pass.
        world_auth.revoke(request.cookies.get(world_auth.COOKIE, ""))
        response = _world_redirect("success", result.lang, portal=True)
        response.set_cookie(world_auth.COOKIE, result.token,
            max_age=max(1, (result.expires_at - world_auth._now_ms()) // 1000),
            httponly=True, secure=True, samesite="lax", path="/")
        response.delete_cookie(holder_auth.COOKIE, path="/", httponly=True,
            secure=_cookie_secure(request), samesite="lax")
    except world_auth.BridgeDenied:
        response = _world_redirect("denied", lang, portal=True)
    except (world_auth.BridgeUnavailable, holder_auth.RpcUnavailable, OSError, sqlite3.Error):
        response = _world_redirect("unavailable", lang, portal=True)
    response.delete_cookie(world_auth.FLOW_COOKIE, path="/", httponly=True, secure=True, samesite="lax")
    return response


@app.post("/api/holder/challenge")
async def api_holder_challenge(request: Request):
    if _public_lite_enabled():
        return _priv_json({"error": "research_in_world"}, status=403)
    if not _wallet_origin_ok(request):
        return _priv_json({"error": "origin_denied"}, status=403)
    if not _owner_configured():
        return _priv_json({"error": "wallet_auth_unavailable"}, status=503)
    raw = await _read_body_capped(request, 1024)
    if raw is None:
        return _priv_json({"error": "invalid_request"}, status=413)
    try:
        address = json.loads(raw).get("address")
        nonce, message = holder_auth.issue_challenge(address)
    except (ValueError, AttributeError, TypeError):
        return _priv_json({"error": "invalid_address_or_busy"}, status=400)
    return _priv_json({"nonce": nonce, "message": message, "chainId": 1,
                       "contract": holder_auth.EMBEO_CONTRACT, "minimum": 1_000_000})


@app.post("/api/holder/verify")
async def api_holder_verify(request: Request):
    if _public_lite_enabled():
        return _priv_json({"error": "research_in_world"}, status=403)
    if not _public_lite_enabled() or not _wallet_origin_ok(request):
        return _priv_json({"error": "origin_denied"}, status=403)
    raw = await _read_body_capped(request, 4096)
    if raw is None:
        return _priv_json({"error": "invalid_request"}, status=413)
    try:
        data = json.loads(raw)
        address = await run_in_threadpool(holder_auth.verify_challenge,
                                           data.get("nonce"), data.get("address"), data.get("signature"))
        token, exp = holder_auth.issue_session(address, _owner_key())
    except holder_auth.RpcUnavailable:
        return _priv_json({"error": "ethereum_unavailable"}, status=503)
    except (ValueError, AttributeError, TypeError):
        return _priv_json({"error": "signature_or_balance_denied"}, status=403)
    response = _priv_json({"ok": True, "eligible": True,
                           "expires_at": _owner_exp_iso(exp)})
    response.set_cookie(holder_auth.COOKIE, token, max_age=holder_auth.SESSION_SECONDS,
                        httponly=True, secure=_cookie_secure(request), samesite="lax", path="/")
    world_auth.revoke(request.cookies.get(world_auth.COOKIE, ""))
    world_auth.cancel_flow(request.cookies.get(world_auth.FLOW_COOKIE, ""))
    response.delete_cookie(world_auth.COOKIE, path="/", httponly=True, secure=True, samesite="lax")
    response.delete_cookie(world_auth.FLOW_COOKIE, path="/", httponly=True, secure=True, samesite="lax")
    return response


@app.get("/api/holder/status")
async def api_holder_status(request: Request):
    try:
        address, eligible = await run_in_threadpool(_holder_eligible, request)
    except (holder_auth.RpcUnavailable, world_auth.BridgeUnavailable):
        return _priv_json({"eligible": False, "error": "ethereum_unavailable"}, status=503)
    return _priv_json({"eligible": eligible, "address": address if eligible else None,
                       "minimum": 1_000_000, "token": "EMBEO", "chainId": 1,
                       "source": "world" if world_auth.COOKIE in request.cookies else "wallet" if eligible else None})


@app.post("/api/holder/logout")
def api_holder_logout(request: Request):
    if not _wallet_origin_ok(request):
        return _priv_json({"error": "origin_denied"}, status=403)
    try:
        world_auth.revoke(request.cookies.get(world_auth.COOKIE, ""))
        world_auth.cancel_flow(request.cookies.get(world_auth.FLOW_COOKIE, ""))
    except (OSError, sqlite3.Error):
        return _priv_json({"error": "world_unavailable"}, status=503)
    response = _priv_json({"ok": True})
    response.delete_cookie(holder_auth.COOKIE, path="/", httponly=True,
                           secure=_cookie_secure(request), samesite="lax")
    response.delete_cookie(world_auth.COOKIE, path="/", httponly=True, secure=True, samesite="lax")
    response.delete_cookie(world_auth.FLOW_COOKIE, path="/", httponly=True, secure=True, samesite="lax")
    return response


# 帳本查詢的共用參數清洗。這幾個值會直接進 ledger 的篩選與字串輸出，
# 長度不設限等於讓公開端點把任意長字串搬進回應裡。
_LEDGER_SCOPES = ("live", "shadow", "all")


def _ledger_scope(scope: str) -> str:
    """
    正規化 scope。**認不得的值一律退回最保守的 live**（不是報錯、也不是放行全部）。

    ⚠️ 這個參數只決定「**看不看得到**」，不決定「計不計入機會分數」。
       後者由寫入端的 shadow / research_only 旗標保證，查詢層永遠改不了。
       兩件事原本被同一個布林綁在一起，結果是 TradingView 外部警報
       （寫入端刻意標 shadow）在任何查詢下都回 n=0 ——「有記帳、但查不到」。
    """
    s = (scope or "live").strip().lower()
    return s if s in _LEDGER_SCOPES else "live"


def _ledger_horizon(h) -> int:
    try:
        h = int(h)
    except Exception:
        return 20
    try:
        import ledger as _l
        allowed = _l.HORIZONS
    except Exception:
        allowed = (1, 5, 20, 60)
    return h if h in allowed else 20


# ── 帳本裡「有沒有私人家族」的探測（見 _is_private_family 上方那段理由）──────
# 為什麼需要：/api/ledger 不帶 family 時回的是**全帳本彙總**，而 ledger.stats() 沒有
# 「排除某些家族」的參數（要加得改 agent/ledger.py，不在本次可改範圍）。彙總裡混進
# 私人家族的報酬有兩個問題：① 污染「本站績效」的口徑；② 用聚合值間接洩漏私人資料的
# 存在與規模。所以先問一句「帳本裡到底有沒有私人家族」，有才降級。
# 成本等同 /api/ledger/families（掃本機分片），因此用 120 秒快取；
# 今天帳本裡一個私人家族都沒有 ⇒ 這條路徑實際上永遠回 (0, True)，公開行為完全不變。
_PRIV_PROBE = {"at": 0.0, "n": 0, "ok": False, "names": ()}
_PRIV_PROBE_TTL = 120.0
_priv_probe_lock = threading.Lock()


def _private_family_probe():
    """回 (私人家族數, ok)。**ok=False 代表「查不到」，不是 0**（查不到 ≠ 安全）。"""
    now = time.time()
    c = _PRIV_PROBE
    if c["ok"] and (now - c["at"]) < _PRIV_PROBE_TTL:
        return c["n"], True
    with _priv_probe_lock:                       # 只讓一條執行緒去掃，其他等結果
        c = _PRIV_PROBE
        now = time.time()
        if c["ok"] and (now - c["at"]) < _PRIV_PROBE_TTL:
            return c["n"], True
        try:
            import ledger
            fams = ledger.families(scope="all", horizon=20, min_n=1, limit=500)
            if fams.get("truncated"):
                # 被截斷＝**沒看完整份名單**，剩下的裡面有沒有私人家族並不知道。
                # 這時回 (None, False) 走降級路徑；當成 0 就是把「沒看到」當成「沒有」。
                print("私人家族探測：家族數超過 limit（清單被截斷），彙總降級為不顯示",
                      file=sys.stderr)
                return None, False
            names = [f.get("family") for f in (fams.get("families") or [])]
            hidden = [n for n in names if _is_private_family(n)]
            for n in hidden:
                _note_hidden_family(n)
            _PRIV_PROBE.update(at=now, n=len(hidden), ok=True, names=tuple(hidden))
            return len(hidden), True
        except Exception as e:
            print("私人家族探測失敗（帳本彙總將降級為不顯示）：%s" % e, file=sys.stderr)
            return None, False


def _ledger_families_view(out, owner: bool) -> dict:
    """
    家族清單的對外視圖。非站主看不到私人家族，但**一定要說有幾個被濾掉**
    ——沉默地少幾筆，會被讀成「帳本裡就是沒有」，那是本專案明令禁止的留白。

    ⚠️ 一律做**淺拷貝**再改：out 可能是 _LEDGER_FAM_CACHE 裡那份共用物件，
       就地修改會把過濾後的結果寫進快取，之後連站主也看不到（或更糟：反過來）。
    """
    out = dict(out or {})
    fams = list(out.get("families") or [])
    if owner:
        out["families"] = fams
        out["filtered_private_families"] = 0
        out["owner"] = True
        return out
    kept, hidden = [], 0
    for f in fams:
        name = (f or {}).get("family")
        if _is_private_family(name):
            hidden += 1
            _note_hidden_family(name)
            continue
        kept.append(f)
    out["families"] = kept
    out["owner"] = False
    out["filtered_private_families"] = hidden
    # n_families 原本是「過濾前的族數」，直接留著會和清單長度對不起來
    out["n_families_total"] = out.get("n_families")
    out["n_families"] = len(kept)
    if hidden:
        out["filtered_note"] = ("有 %d 個訊號家族屬於私人資料（或不在公開白名單內），"
                                "僅站主登入後可見。" % hidden)
    return out


@app.get("/api/ledger")
def api_ledger(request: Request, family: str = "", market: str = "", horizon: int = 20,
               scope: str = "live", symbol: str = ""):
    """
    Signal Ledger 狀態與實測績效（v4 §3）。

    ⚠️ 一律回傳 durable 旗標與警語：帳本若在 local_only 模式（未設 GITHUB_TOKEN），
    雲端閒置 15 分鐘 spin down 就歸零，統計數字不可信——前端必須顯示這個警告，
    不可讓使用者以為看到的是長期累積的績效。

    `scope`（2026-08-14 新增，預設 live ＝ 完全維持既有行為）：
      live   只算真正計入機會分數的訊號（預設；首頁的帳本狀態列走這條）
      shadow 只看影子／研究用途訊號（TradingView 外部警報都在這裡）
      all    兩者都算 —— **不要拿來當「本站績效」呈現**，那是兩種語意混在一起
    回傳一律帶 `scope` 與 `scope_note`，讓畫面上的數字永遠標得出口徑。
    """
    owner = bool(_owner_state(request)["owner"])
    try:
        import ledger
    except Exception as e:
        return _priv_json({"error": str(e), "durable": False})
    scope = _ledger_scope(scope)
    horizon = _ledger_horizon(horizon)
    out = {"status": ledger.status(), "scope": scope, "owner": owner,
           "filtered_private_families": 0,
           "scope_note": {
               "live": "只計入本站規則引擎產出、且計入機會分數的訊號（不含影子／研究用途）",
               "shadow": "只看影子／研究用途訊號（含 TradingView 外部警報）——"
                         "這些訊號刻意不計入本站任何評分，統計僅供追蹤驗證",
               "all": "影子與正式訊號混算，兩種語意不同，不可當成任何一邊的績效",
           }[scope]}

    fam = (family.strip()[:120] or None) if family else None

    # ── 私人家族閘門 ───────────────────────────────────────────────────
    # (a) 指名查一個私人家族：非站主一律不算、不回數字。
    if fam and not owner and _is_private_family(fam):
        out["filtered_private_families"] = 1
        out["stats"] = {"n": 0, "status": "private_family_hidden", "horizon": horizon,
                        "family": fam, "market": market or None, "symbol": symbol or None,
                        "note": "此訊號家族屬於私人資料（或不在公開白名單內），"
                                "僅站主登入後可查。「這不代表它沒有紀錄或沒有樣本。」"}
        return _priv_json(out)

    # (b) 不指名（＝全帳本彙總）：彙總會把私人家族的報酬一起算進去，非站主不可見。
    #     ledger.stats() 沒有「排除某些家族」的參數，所以只能整份降級而不是偷偷少算
    #     ——偷偷少算會讓數字說謊，那比不顯示更糟。
    #     ⚠️ 探測失敗（ok=False）同樣降級：「查不到」不等於「沒有私人家族」。
    if not fam and not owner:
        n_priv, probe_ok = _private_family_probe()
        if not probe_ok:
            out["filtered_private_families"] = None
            out["stats"] = {"n": 0, "status": "aggregate_withheld", "horizon": horizon,
                            "note": "無法確認帳本裡是否含私人家族（帳本讀取失敗），"
                                    "為安全起見暫不對外顯示彙總統計。"
                                    "「這是讀不到，不是沒有紀錄。」站主登入後可見。"}
            return _priv_json(out)
        if n_priv:
            out["filtered_private_families"] = n_priv
            out["stats"] = {"n": 0, "status": "aggregate_withheld", "horizon": horizon,
                            "note": "帳本裡有 %d 個私人家族，全帳本彙總會把它們的報酬一起算進去，"
                                    "因此不對外顯示。請改用 /api/ledger/families 看公開家族，"
                                    "或以站主身分登入。" % n_priv}
            return _priv_json(out)

    try:
        out["stats"] = ledger.stats(family=fam,
                                    market=(market.strip()[:16] or None) if market else None,
                                    symbol=(symbol.strip()[:32] or None) if symbol else None,
                                    horizon=horizon, scope=scope)
    except Exception as e:
        out["stats"] = {"error": str(e)}

    # 「回填算不出績效」的訊號有幾筆。⚠️ 一定要單獨講：這些筆的 outcome 事件
    #    根本不存在於帳本，所以它們**不在**上面 stats 的 n 裡，也不在勝率分母裡
    #    ——不講的話，使用者會把少掉的那些讀成「還沒到期」。
    #    只讀本機／記憶體快取，不打網路（這是公開端點）；明細含標的與家族名，
    #    可能是私人資料，僅站主可見。
    try:
        out["backfill_deferred"] = ledger.deferrals(include_entries=owner)
    except Exception as e:
        out["backfill_deferred"] = {"status": "unknown", "reason": str(e)}
    return _priv_json(out)


# 家族清單要掃全部本機分片（opened + outcome），比 stats() 貴且是公開端點。
# 前端 60 秒輪詢一次警報區、又有公開唯讀訪客 —— 沒有快取就是每個訪客各掃一次帳本。
# ⚠️ 更新時**整個換掉一個新 dict**，不要逐鍵 update()：兩個執行緒交錯寫入會產生
#    「key 是 A、data 是 B」的快取，然後把別的查詢結果當成這次的答案回出去。
#    讀取端先 `c = _LEDGER_FAM_CACHE` 取一份快照，就永遠是 key/data 一致的組合。
#: ⚠️ `gen` 是**世代序號**，不是裝飾用的：families() 會去讀 GitHub
#:    （ledger.py 的 requests timeout=25，一樣沒有總時間上限），一條卡住的執行緒
#:    十分鐘後醒來、把當時的結果寫進來並蓋上 `at=現在`，畫面就會把十分鐘前的帳本
#:    當成最新的再顯示 120 秒。寫入前必須同時通過「票沒被逃生門判死」與
#:    「快取裡不是更新的世代」兩道比對。
_LEDGER_FAM_CACHE = {"key": None, "at": 0.0, "data": None, "gen": 0}
_LEDGER_FAM_TTL = 120.0
#: 門檻 120 秒：正常是掃本機分片（毫秒級～數秒），只有冷啟動那次會打 GitHub。
_ledger_fam_slots = _StaleGate("ledger_families", limit=2, stale_sec=120.0, escape_max=2)


@app.get("/api/ledger/families")
def api_ledger_families(request: Request, scope: str = "shadow", source: str = "",
                        prefix: str = "", horizon: int = 20, min_n: int = 10):
    """
    帳本裡「有哪些訊號家族」＋各自的累積筆數與統計（2026-08-14 新增）。

    為什麼需要：`stats(family=...)` 一直都查得到單一家族，但**沒有任何地方列得出
    家族名單**——使用者得先知道 `tv_alert:SLA_CRYPTO_CORE_LONG` 這串字存在才查得到。
    沒有這個端點，前端做不出可點的清單，等於統計存在卻永遠看不到。

    ⚠️ 回傳的每一族都帶 `sufficient` 與 `sufficiency_note`。
       **樣本不足時前端不得顯示結論式數字**（勝率／期望值），只能顯示筆數與那句說明。
    """
    global _LEDGER_FAM_CACHE
    # ⚠️ 快取的 key **不含**站主身分，快取裡存的一律是「未過濾的完整結果」；
    #    過濾只在回傳前那一刻做（_ledger_families_view 會先淺拷貝）。
    #    要是把過濾後的結果寫回快取，下一個訪客（或站主）就會拿到別人身分的視圖。
    owner = bool(_owner_state(request)["owner"])
    try:
        import ledger
    except Exception as e:
        return _priv_json({"error": str(e), "families": [], "n_families": 0,
                           "durable": False, "owner": owner,
                           "filtered_private_families": 0})
    scope = (scope or "shadow").strip().lower()
    if scope not in _LEDGER_SCOPES:
        scope = "shadow"
    horizon = _ledger_horizon(horizon)
    try:
        min_n = max(1, min(int(min_n), 500))
    except Exception:
        min_n = 10
    source = (source or "").strip()[:32] or None
    prefix = (prefix or "").strip()[:64] or None
    key = (scope, source, prefix, horizon, min_n)

    now = time.time()
    c = _LEDGER_FAM_CACHE
    if c["data"] is not None and c["key"] == key and (now - c["at"]) < _LEDGER_FAM_TTL:
        return _priv_json(_ledger_families_view(c["data"], owner))
    tk = _ledger_fam_slots.acquire()
    if tk is None:
        # 忙碌時回上一份快取（標明是舊的），沒有快取才回 429。
        # 「讀不到」不可以渲染成空清單＝「你沒有任何家族」。
        binfo = _ledger_fam_slots.busy_info()
        if c["data"] is not None:
            stale = _ledger_families_view(c["data"], owner)
            stale["stale"] = True
            stale["stale_note"] = ("查詢忙碌中（%s），這是上一次的結果（可能不是最新）"
                                   % _ledger_fam_slots.busy_note())
            stale["busy"] = binfo
            return _priv_json(stale)
        return _priv_json({"error": "查詢忙碌中：%s。請稍後再試（不代表沒有紀錄）"
                                    % _ledger_fam_slots.busy_note(),
                           "busy": binfo,
                           "families": [], "n_families": 0, "durable": False,
                           "owner": owner, "filtered_private_families": 0},
                          status=429)
    try:
        out = ledger.families(source=source, prefix=prefix, scope=scope,
                              horizon=horizon, min_n=min_n)
    except Exception as e:
        return _priv_json({"error": str(e), "families": [], "n_families": 0,
                           "durable": False, "owner": owner,
                           "filtered_private_families": 0})
    finally:
        _ledger_fam_slots.release(tk)

    # 家族名是 slug（tv_alert:SLA_CRYPTO_CORE_LONG），畫面上要看得懂。
    # 對照不到就原樣顯示 slug —— 不猜、不留白。
    try:
        import tvalerts as _tv
        for f in out.get("families") or []:
            f["display"] = _tv.family_display(f.get("family"))
    except Exception:
        pass
    # ⚠️ 世代比對：只有「沒被逃生門判死」且「快取裡不是更新的世代」才准回寫。
    #    卡死的執行緒醒來時這裡會落空——那正是要的：舊資料絕不可以蓋掉新資料。
    if tk.superseded():
        print("[gate:ledger_families] 丟棄過期結果 gen=%d（持有 %.0f 秒，已被逃生門取代）"
              % (tk.gen, tk.held_sec()), file=sys.stderr)
        out["stale"] = True
        out["stale_note"] = ("這次查詢耗時 %.0f 秒、期間已被逃生門判定卡死，"
                             "結果未寫入快取（可能不是最新）" % tk.held_sec())
    elif (_LEDGER_FAM_CACHE.get("gen") or 0) > tk.gen:
        # 兩個合法的並行查詢完成順序顛倒也一樣不准倒退（limit=2 時真的會發生）
        print("[gate:ledger_families] 丟棄較舊世代 gen=%d（快取已是 gen=%s）"
              % (tk.gen, _LEDGER_FAM_CACHE.get("gen")), file=sys.stderr)
    else:
        _LEDGER_FAM_CACHE = {"key": key, "at": now, "data": out, "gen": tk.gen}
    return _priv_json(_ledger_families_view(out, owner))


@app.get("/api/regime")
def api_regime(market: str = "us"):
    """Market Regime context（v4 §7）。只作背景資訊，不直接改買賣訊號。"""
    try:
        import regime
        return regime.current(market) or {"label": "unknown",
                                          "note": "無法取得市場環境資料"}
    except Exception as e:
        return {"label": "unknown", "error": str(e)}


# ═══════════════════════════════════════════════════════════════════════════
# 分頁頂部「主要行情列」（agent/ticker.py）
# ═══════════════════════════════════════════════════════════════════════════
# GET /api/ticker?tab=crypto|onchain|tw|us  → 那一頁頂部要顯示的價格列。
#
# 為什麼是「一次一個分頁」而不是一次回四組：
#   使用者一次只看得到一頁，四組的上游是三個不同的來源（幣安／CoinGecko／Yahoo）。
#   一次全抓＝每個訪客開頁都對三個上游各打一輪，公開站上這是自找限流；
#   而且 CoinGecko 壞掉時會連帶拖慢幣圈頁——一個來源掛掉不該影響另一個。
#
# 為什麼快取是「全站共用」而不是 per-visitor：
#   這是公開網址，陌生人按 F5 就會打上游。沒有共用快取的話，20 個訪客同時重整
#   ＝20 輪外部請求；幣安對單一機房 IP 有權重上限，打爆的下場是**全部變成
#   「查不到」**——那等於用假的查不到換掉真的行情，兩邊都不誠實。
#   所以快取放在模組層（進程共用），60 秒 TTL，鍵是**群組**不是訪客。
#
# 為什麼鍵是「群組」而不是「分頁」：
#   台股與美股是**同一次** yf.download（6 檔一起要）。若各自一把鎖、各自一份快取，
#   使用者在台股／美股之間切換就會打兩次 Yahoo。群組化之後切分頁是零上游成本。
#
# ⛔ 這條路徑不觸發 LINE：本檔的推播只發生在 `_run_scan(allow_push=True)`
#    （唯一入口是 /api/cron/scan 帶對 CRON_KEY）。`agent/ticker.py` 不 import notifier，
#    也不呼叫 scanner，任何情況下都不會發訊息。
# ⛔ 這條路徑不寫入任何狀態：純讀取，不碰 ledger／state／SCAN_*.json。
#    唯一的磁碟副作用是 `binance.universe()` 自己的清單快取（既有行為）。

#: 快取 TTL（秒）。使用者選定「開頁時抓一次，快取 60 秒」。
TICKER_TTL_SEC = 60.0
#: 整輪失敗時的冷卻（秒）。⚠️ 失敗**不會**覆蓋掉上一份好資料——只記一個冷卻時間，
#: 免得上游掛掉時每個訪客都去重打。20 秒＝最壞每分鐘 3 輪，遠低於任何限流門檻。
TICKER_FAIL_TTL_SEC = 20.0
#: 冷啟動（完全沒有快取）時，後到的請求最多等前一個抓多久。
#: 用 `asyncio.sleep` 輪詢，**不佔用執行緒池**；正常一輪 0.1~1.0 秒就好了。
TICKER_COLD_WAIT_SEC = 6.0
#: 丟給執行緒池的死線。必須 > ticker 自己的 wall-clock 預算（8/12/15 秒），
#: 否則會在模組還來得及誠實回報「逾時」之前就先被砍斷。
TICKER_DEADLINE_SEC = 25.0
#: 每個群組一格。stale_sec 取 90 秒——健康的一輪實測 0.10~1.02 秒，
#: 就算每個請求都吃到重試也不該接近 90 秒；escape_max=1 ⇒ 最壞同時 2 條在跑。
_ticker_gates = {}
_ticker_cache = {}          # group -> {"at","data","gen","fail_at","last_error"}
_ticker_lock = threading.Lock()


def _ticker_gate(group: str):
    with _ticker_lock:
        g = _ticker_gates.get(group)
        if g is None:
            g = _StaleGate("ticker:" + group, limit=1, stale_sec=90.0, escape_max=1)
            _ticker_gates[group] = g
        return g


def _ticker_slot(group: str) -> dict:
    """
    取該群組的快取格。

    ⚠️ 這個 dict **一旦建立就永遠是同一個物件**（只改欄位、不重新指派 `_ticker_cache[group]`）。
       理由：路由在 `await` 前後都會用到它，中途若被換成新 dict，之後對舊物件寫的
       `fail_at` 就會寫進一個沒人讀的孤兒——冷卻等於失效，上游掛掉時每個訪客都會去重打。
    """
    with _ticker_lock:
        return _ticker_cache.setdefault(
            group, {"at": 0.0, "data": None, "gen": 0, "fail_at": 0.0, "last_error": None})


def _ticker_note_fail(group: str, msg: str) -> dict:
    """記一次整輪失敗（不動既有的好資料）。回傳最新的快取格。"""
    s = _ticker_slot(group)
    with _ticker_lock:
        s["fail_at"] = time.time()
        s["last_error"] = msg
    return s


def _ticker_pick(group: str, tab: str, slot: dict, *, hit: bool, age: float,
                 stale: bool = False, stale_note: str = "", busy=None, waited=False):
    """
    從群組快取切出某個分頁的列，並掛上誠實的快取／陳舊標記。

    ⚠️ 快取沒有這個 tab 時**不回空白**：回 `ticker.empty_row()`（與正常回傳同形、
       items=[]、status="empty"、errors 有原因），前端只有一套渲染路徑。
    """
    import ticker as T
    data = (slot.get("data") or {})
    row = data.get(tab)
    if not isinstance(row, dict):
        row = T.empty_row(tab, "群組 %s 的快取裡沒有 %s 這一頁的資料（本次未取得）" % (group, tab))
        stale = True
    else:
        row = dict(row)
    row["cache"] = {"hit": hit, "age_sec": round(age, 1), "ttl_sec": TICKER_TTL_SEC,
                    "group": group, "recomputed": not hit, "waited": waited}
    if stale:
        row["stale"] = True
        row["stale_note"] = stale_note or ("這是 %.0f 秒前取得的報價，本次沒有更新" % age)
    else:
        row["stale"] = False
        row["stale_note"] = None
    if busy is not None:
        row["busy"] = busy
    if slot.get("last_error"):
        row["refresh_error"] = slot["last_error"]
    return row


async def _ticker_wait_for_cold(group: str, slot_getter):
    """
    冷啟動時等前一個請求把快取填好。**只在完全沒有快取時**才會走到這裡。

    為什麼可以等：`asyncio.sleep` 不佔用 starlette 的同步執行緒池（本檔 `_offload`
    的說明講的是相反的情況——把同步阻塞留在事件迴圈上）。20 個訪客同時冷啟動時，
    只有 1 個真的去抓，其餘 19 個在事件迴圈上睡，不會吃掉任何 worker。
    為什麼要有上限：等待若無界，上游卡住就會把所有連線一起掛住。
    """
    import asyncio
    deadline = time.monotonic() + TICKER_COLD_WAIT_SEC
    while time.monotonic() < deadline:
        await asyncio.sleep(0.05)
        s = slot_getter()
        if s.get("data") is not None:
            return s
    return None


@app.get("/api/ticker")
async def api_ticker(tab: str = "crypto"):
    """
    分頁頂部的主要行情列（公開唯讀）。

    :param tab: crypto｜onchain｜tw｜us

    回傳見 `agent/ticker.py` 的 `_row()` / `_item()`。三個不變式前端可以直接依賴：
      * ``item.status == "ok"``  ⇔  ``item.price is not None``
      * ``item.status != "ok"``  ⇒  ``item.reason`` 有字（要顯示出來，不可留白／顯示 0）
      * ``item.change_status`` 與 ``item.status`` **各自獨立**——有價格但沒有漲跌幅
        是真實會發生的情況（實測 CoinGecko 的 baby-claw）。
    """
    import ticker as T
    tab = (tab or "").strip().lower()
    if tab not in T.TABS:
        return JSONResponse(
            {"error": "tab 必須是 %s 其中之一" % "／".join(T.TABS),
             **T.empty_row("crypto", "要求的分頁 %r 不存在" % tab)}, status_code=400)

    group = T.TAB_GROUP[tab]
    slot = _ticker_slot(group)
    now = time.time()
    age = now - (slot.get("at") or 0.0)

    # ① 快取新鮮 → 直接回，不碰上游、不佔執行緒
    if slot.get("data") is not None and age < TICKER_TTL_SEC:
        return _ticker_pick(group, tab, slot, hit=True, age=age)

    # ② 上一輪剛整輪失敗 → 冷卻期內不重打（避免上游掛掉時每個訪客都去踹一腳）
    fail_age = now - (slot.get("fail_at") or 0.0)
    if slot.get("fail_at") and fail_age < TICKER_FAIL_TTL_SEC:
        if slot.get("data") is not None:
            return _ticker_pick(group, tab, slot, hit=True, age=age, stale=True,
                                stale_note="上一次更新失敗（%s），冷卻 %.0f 秒後才會重試；"
                                           "以下是 %.0f 秒前的報價"
                                           % (slot.get("last_error") or "原因不明",
                                              TICKER_FAIL_TTL_SEC, age))
        body = T.empty_row(tab, "上一次取價失敗（%s），冷卻中（%.0f 秒後重試）"
                                % (slot.get("last_error") or "原因不明",
                                   TICKER_FAIL_TTL_SEC - fail_age))
        body["cache"] = {"hit": False, "age_sec": None, "ttl_sec": TICKER_TTL_SEC,
                         "group": group, "recomputed": False, "waited": False}
        body["stale"] = True
        body["stale_note"] = "本次沒有取得任何報價"
        return JSONResponse(body, status_code=503)

    gate = _ticker_gate(group)
    tk = gate.acquire()

    # ③ 已經有人在抓 → 不排隊重算
    if tk is None:
        binfo = gate.busy_info()
        if slot.get("data") is not None:
            return _ticker_pick(group, tab, slot, hit=True, age=age, stale=True,
                                busy=binfo,
                                stale_note="另一個請求正在更新（%s），先給你 %.0f 秒前的報價"
                                           % (gate.busy_note(), age))
        # 冷啟動：完全沒有快取，等它一下（有上限、不佔執行緒）
        s2 = await _ticker_wait_for_cold(group, lambda: _ticker_slot(group))
        if s2 is not None and s2.get("data") is not None:
            a2 = time.time() - (s2.get("at") or 0.0)
            return _ticker_pick(group, tab, s2, hit=True, age=a2, waited=True)
        body = T.empty_row(tab, "首次取價仍在進行中（%s），等了 %.0f 秒還沒好"
                                % (gate.busy_note(), TICKER_COLD_WAIT_SEC))
        body["cache"] = {"hit": False, "age_sec": None, "ttl_sec": TICKER_TTL_SEC,
                         "group": group, "recomputed": False, "waited": True}
        body["busy"] = binfo
        body["stale"] = True
        body["stale_note"] = "本次沒有取得任何報價（不是 0，是還沒抓到）"
        return JSONResponse(body, status_code=503)

    # ④ 由我去抓。同步阻塞一律移出事件迴圈，並給 wall-clock 死線。
    try:
        data = await _offload(lambda: T.fetch_group(group), TICKER_DEADLINE_SEC,
                              "ticker:" + group, ticket=tk, gate=gate)
    except _OffloadTimeout as e:
        slot = _ticker_note_fail(group, "超過 %.0f 秒總時間上限" % e.deadline)
        if slot.get("data") is not None:
            return _ticker_pick(group, tab, slot, hit=True,
                                age=time.time() - (slot.get("at") or 0.0), stale=True,
                                stale_note="本次更新超過 %.0f 秒上限（工作仍在背景跑，"
                                           "結果不採用）；以下是上一次的報價" % e.deadline)
        body = T.empty_row(tab, "取價超過 %.0f 秒總時間上限，本次沒有結果" % e.deadline)
        # ⚠️ empty_row 的 budget_exceeded 預設是 False（骨架不知道自己為什麼空）。
        #    這條路徑**就是**逾時本身，留 False 等於在唯一該說「超時」的地方說沒超時。
        body["budget_exceeded"] = True
        body["elapsed_sec"] = round(e.elapsed, 2)
        body["budget_sec"] = e.deadline
        return JSONResponse(body, status_code=504)
    except Exception as e:                                   # noqa: BLE001
        print("ticker 取價失敗 group=%s: %s: %s" % (group, type(e).__name__, e),
              file=sys.stderr)
        slot = _ticker_note_fail(group, "%s: %s" % (type(e).__name__, e))
        if slot.get("data") is not None:
            return _ticker_pick(group, tab, slot, hit=True,
                                age=time.time() - (slot.get("at") or 0.0), stale=True,
                                stale_note="本次更新失敗（%s），以下是上一次的報價"
                                           % type(e).__name__)
        return JSONResponse(T.empty_row(tab, "取價失敗：%s" % type(e).__name__),
                            status_code=503)

    if not isinstance(data, dict) or not data:
        _ticker_note_fail(group, "ticker.fetch_group() 回傳格式非預期")
        return JSONResponse(T.empty_row(tab, "取價模組回傳格式非預期，本次沒有結果"),
                            status_code=500)

    # ⑤ 世代比對：被逃生門判死的執行緒醒來後**寫不進快取**（沿用 ck_metrics 那一套）。
    #    否則畫面會出現「時間戳很新、數字很舊」的報價——那看起來完全正常，比一直忙碌更危險。
    ok_any = any((r or {}).get("ok_count") for r in data.values() if isinstance(r, dict))
    if tk.superseded():
        print("[gate:ticker:%s] 丟棄過期結果 gen=%d（持有 %.0f 秒）"
              % (group, tk.gen, tk.held_sec()), file=sys.stderr)
        row = dict(data.get(tab) or T.empty_row(tab, "本次結果已過期"))
        row["cache"] = {"hit": False, "age_sec": 0.0, "ttl_sec": TICKER_TTL_SEC,
                        "group": group, "recomputed": True, "stored": False, "waited": False}
        row["stale"] = True
        row["stale_note"] = ("這次取價耗時 %.0f 秒、期間已被逃生門判定卡住，"
                             "結果未寫入快取" % tk.held_sec())
        return row

    slot = _ticker_slot(group)
    with _ticker_lock:
        if (slot.get("gen") or 0) > tk.gen:
            print("[gate:ticker:%s] 丟棄較舊世代 gen=%d（快取已是 gen=%s）"
                  % (group, tk.gen, slot.get("gen")), file=sys.stderr)
            stored = False
        elif ok_any or slot.get("data") is None:
            slot["at"] = time.time()
            slot["data"] = data
            slot["gen"] = tk.gen
            slot["fail_at"] = 0.0 if ok_any else time.time()
            slot["last_error"] = None if ok_any else "本輪一格都沒取到"
            stored = True
        else:
            # ⚠️ 整輪一格都沒取到時**不覆蓋**上一份好資料：舊報價標明年齡仍然有用，
            #    把它換成空的只會讓畫面從「10 分鐘前的價」退化成「什麼都沒有」。
            slot["fail_at"] = time.time()
            slot["last_error"] = "本輪一格都沒取到，保留上一份報價"
            stored = False

    if not stored and slot.get("data") is not None:
        # 本輪一格都沒取到（或世代較舊）而快取裡有較好的資料 → 回舊的並標明年齡。
        # 「10 分鐘前的真實價格＋清楚標示」比「剛剛抓的一片空白」對使用者有用得多。
        return _ticker_pick(group, tab, slot, hit=True,
                            age=time.time() - (slot.get("at") or 0.0), stale=True,
                            stale_note="本次更新一格都沒取到（%s），以下是 %.0f 秒前的報價"
                                       % (slot.get("last_error") or "原因不明",
                                          time.time() - (slot.get("at") or 0.0)))
    row = dict(data.get(tab) or T.empty_row(tab, "本次沒有取得這一頁的資料"))
    row["cache"] = {"hit": False, "age_sec": 0.0, "ttl_sec": TICKER_TTL_SEC,
                    "group": group, "recomputed": True, "stored": stored, "waited": False}
    row["stale"] = not stored
    row["stale_note"] = None if stored else "本次結果未寫入快取（已有更新的世代）"
    return row


# ═══════════════════════════════════════════════════════════════════════════
# own_ 系列自算指標（agent/ckmetrics.py）
# ═══════════════════════════════════════════════════════════════════════════
# ⚠️ 這一組是「本站依 CoinKarma 官方文件公開說明的原理，用免費公開 API 自己重算」的版本，
#    **不是** CoinKarma 的指標本身。他們的成分幣種／權重／平滑／交易所組合都沒有公開，
#    所以兩邊數值不可互相對照。命名前綴 own_ 就是為了這件事（同 ext_ 前綴的前例）。
#    後端不做任何「翻譯成 CoinKarma 口徑」的動作；前端也必須把這句話顯示出來。
#
# 為什麼一定要快取＋併發閘：
#   snapshot() 一次要往外打幣安現貨／U 本位／幣本位、Bitfinex、Coinbase 十幾個端點，
#   冷算實測 5.9~9.5 秒。公開站上若每個訪客開頁各算一次：
#     ① 幣安對單一機房 IP 有請求權重上限，被限流後**全部五項會一起變 unavailable**
#        ——等於自己把自己打成「查不到」；
#     ② Render Starter 只有 0.5 CPU，同步等待的工作執行緒會被十秒級的請求佔滿，
#        整站（含首頁）跟著沒有回應。
#   這個端點沒有任何影響結果的 query 參數 ⇒ 所有訪客拿到的必然是同一份，
#   因此用「單槽閘門 ＋ 全域快取」：命中直接回、忙碌回上一份並標 stale，**不排隊也不重算**。
#: `gen` 是世代序號（見 _StaleGate）。snapshot() 卡死十分鐘後才醒來的執行緒
#: 若把當時的數字寫進來，畫面會顯示成「剛算好的最新指標」——那比一直回忙碌更糟。
_CK_CACHE = {"at": 0.0, "data": None, "ttl": 0.0, "gen": 0}
#: 正常快取 10 分鐘。五項裡四項的歷史基線是日 K，相對度量（pct/z）在 10 分鐘內
#: 不會有任何有意義的變化；這個 TTL 把最壞情況壓在每小時 6 輪外部請求。
_CK_TTL = 600.0
#: 全掛掉時只快取 2 分鐘。若把「五項全 unavailable」也鎖 10 分鐘，
#: 一次網路抖動就會讓畫面連續十分鐘顯示「查不到」——那不是事實，是快取的錯。
_CK_FAIL_TTL = 120.0
#: ⚠️ 這一格就是 2026-09-04 線上事故的現場：只有 1 格、一卡就是全死。
#:    門檻 180 秒的理由：本機冷算實測 4.0 秒、雲端冷算實測 5.9~9.5 秒；
#:    就算每一個請求都吃到 Retry 的 backoff，健康的一輪也不該逼近 3 分鐘。
#:    再往下設會誤殺「慢但活著」的計算（結果被丟棄＝白打三十個外部請求）；
#:    再往上設則會讓使用者在 _CK_TTL(600 秒) 之外還要多等一輪。
#:    escape_max=1 ⇒ 最壞同時 2 條在跑。**幣安對單一機房 IP 有請求權重上限**，
#:    逃生若放太寬就會把自己打成限流、五項一起變 unavailable——那等於用
#:    「假的查不到」換掉「真的卡住」，兩邊都不誠實。
#:    一條永久卡死的執行緒不會讓端點退化成永久 429：它只吃掉那一格容忍額度，
#:    後續請求照樣進得去（只有「同時兩條都卡死」才會擋，且 15 分鐘後遺忘自癒）。
_ck_slots = _StaleGate("ck_metrics", limit=1, stale_sec=180.0, escape_max=1)


def _ck_busy_body(msg: str) -> dict:
    """
    忙碌／失敗時的回傳骨架。

    ⚠️ 刻意做成與 snapshot() 同形（metrics/ok_count/degraded 都在），
       讓前端只有一套渲染路徑；而且 metrics 是空 dict 不是 None——
       前端看到「一項都沒有」必須顯示成「這次沒算到」，不可以留白或畫成正常。
    """
    return {"error": msg, "metrics": {}, "ok_count": 0, "total": 0,
            "insufficient": [], "unavailable": [], "degraded": True,
            "note": "⚠️ 這代表『本次沒有算到』，「不代表市場沒有極端、更不代表安全」。"}


@app.get("/api/ck_metrics")
def api_ck_metrics(key: str = ""):
    """
    own_ 系列自算指標快照（唯讀、公開）。

    :param key: 選填。帶對 CRON_KEY 時會以 ``persist=True`` 重算——
                這是 own_lsur_z 唯一能累積每日歷史的路徑（幣安那兩個端點只保留 30 天，
                不靠增量累積的話它的「百分位」永遠是樣本不足）。
                ``_save_lsur_state`` 本身「同一個 UTC 日只寫一次」，所以 4 小時打一次
                不會變成一天六次 GitHub commit；重複呼叫是冪等的。
                **沒帶對金鑰一律走唯讀路徑**：不寫入任何狀態、不碰 GitHub。
                這個端點在任何情況下都不會推播 LINE（ckmetrics 完全不認識 notifier）。

    回傳即 ckmetrics.snapshot() 原樣 ＋ 一個 ``cache`` 欄位。
    每一項的 status（ok／insufficient_history／unavailable）由 ckmetrics 依資料本身決定，
    這一層**不覆寫、不補值、不把 unavailable 美化成正常**。
    """
    global _CK_CACHE
    persist = bool((key or "").strip()) and _key_ok(key)

    now = time.time()
    c = _CK_CACHE
    age = now - (c["at"] or 0.0)
    if c["data"] is not None and age < (c["ttl"] or _CK_TTL) and not persist:
        out = dict(c["data"])
        out["cache"] = {"hit": True, "age_sec": round(age, 1),
                        "ttl_sec": c["ttl"], "recomputed": False}
        return out

    tk = _ck_slots.acquire()
    if tk is None:
        # 已經有人在算了。排隊等他等於讓第二個請求也吃掉十秒，所以直接回上一份。
        # 「讀不到」不可以渲染成「沒有極端」——一律標 stale 並講明時間。
        # ⚠️ 429 必須帶「已經卡多久」：0.16 秒回一句「請稍候幾秒再試」
        #    在「剛好在算」是事實、在「卡住十分鐘」是謊話，而兩者在舊版長得一模一樣。
        binfo = _ck_slots.busy_info()
        if c["data"] is not None:
            out = dict(c["data"])
            out["cache"] = {"hit": True, "age_sec": round(age, 1),
                            "ttl_sec": c["ttl"], "recomputed": False}
            out["stale"] = True
            out["busy"] = binfo
            out["stale_note"] = ("%s，這是 %.0f 秒前的結果（可能不是最新）"
                                 % (_ck_slots.busy_note(), age))
            return out
        body = _ck_busy_body("指標計算忙碌中：%s" % _ck_slots.busy_note())
        body["busy"] = binfo
        return JSONResponse(body, status_code=429)

    t0 = time.time()
    try:
        import ckmetrics
        data = ckmetrics.snapshot(persist=persist)
    except Exception as e:
        print("ck_metrics 失敗: %s: %s" % (type(e).__name__, e), file=sys.stderr)
        if c["data"] is not None:
            out = dict(c["data"])
            out["cache"] = {"hit": True, "age_sec": round(time.time() - (c["at"] or 0.0), 1),
                            "ttl_sec": c["ttl"], "recomputed": False}
            out["stale"] = True
            out["stale_note"] = "本次重算失敗（%s），以下是上一次的結果" % type(e).__name__
            return out
        return JSONResponse(_ck_busy_body("指標計算失敗：%s" % type(e).__name__),
                            status_code=503)
    finally:
        _ck_slots.release(tk)

    if not isinstance(data, dict):
        return JSONResponse(_ck_busy_body("ckmetrics.snapshot() 回傳格式非預期"),
                            status_code=500)

    data["elapsed_sec"] = round(time.time() - t0, 2)
    data["persisted"] = persist

    # ── 世代比對：卡死的執行緒醒來後**寫不進快取** ───────────────────────
    # 這是逃生門最關鍵的一半。放行新請求之後，舊執行緒仍然活著、仍然會跑完，
    # 若讓它回寫，畫面上會是一份「時間戳很新、數字很舊」的指標——
    # 那看起來完全正常，所以比一直回 429 更危險。
    ttl = _CK_TTL if data.get("ok_count") else _CK_FAIL_TTL
    cur = _CK_CACHE
    if tk.superseded():
        print("[gate:ck_metrics] 丟棄過期結果 gen=%d（持有 %.0f 秒，已被逃生門取代，"
              "elapsed=%.1fs）" % (tk.gen, tk.held_sec(), data["elapsed_sec"]),
              file=sys.stderr)
        out = dict(data)
        out["stale"] = True
        out["stale_note"] = ("這次計算耗時 %.0f 秒、期間已被逃生門判定卡死，"
                             "結果未寫入快取（可能不是最新）" % tk.held_sec())
        out["cache"] = {"hit": False, "age_sec": 0.0, "ttl_sec": ttl,
                        "recomputed": True, "stored": False}
        return out
    if (cur.get("gen") or 0) > tk.gen:
        # 兩條合法的計算完成順序顛倒（逃生後兩條並存時真的會發生）——不准倒退
        print("[gate:ck_metrics] 丟棄較舊世代 gen=%d（快取已是 gen=%s）"
              % (tk.gen, cur.get("gen")), file=sys.stderr)
        out = dict(data)
        out["cache"] = {"hit": False, "age_sec": 0.0, "ttl_sec": ttl,
                        "recomputed": True, "stored": False}
        return out

    _CK_CACHE = {"at": time.time(), "data": data, "ttl": ttl, "gen": tk.gen}
    out = dict(data)
    out["cache"] = {"hit": False, "age_sec": 0.0, "ttl_sec": ttl,
                    "recomputed": True, "stored": True}
    return out


# ═══════════════════════════════════════════════════════════════════════════
# CoinKarma 山寨幣四象限快照（平台原始輸出，站主手動貼入）
# ═══════════════════════════════════════════════════════════════════════════
# 解析在 agent/ckscreener.py，保存與事件產生在 agent/ckstore.py。
#
# ⛔ **資料只能由站主手動貼入。** CoinKarma 沒有公開 API、Custom Alerts 只能送到
#    自家 Telegram Bot，所以本站**不爬、不自動化取得**：不打他們的網站或 Telegram、
#    不用瀏覽器自動化、不猜私有 API、不要也不存任何 Telegram／CoinKarma 的
#    cookie／token／session。`ckstore` 整個模組唯一的輸入就是這裡送進去的字串。
#
# ⛔ **這條路徑在任何情況下都不會觸發 LINE 推播。** 這是寫死的：本檔的 LINE 推播
#    只發生在 `_run_scan(allow_push=True)`（唯一入口是 /api/cron/scan 帶對 CRON_KEY），
#    而下面兩個端點完全不碰 `_run_scan`、也不 import `notifier`；`agent/ckstore.py`
#    同樣不認識 notifier。理由：(1) LINE 免費額度 200 則/月；(2) 貼入是站主自己的
#    動作，把他剛親手貼的東西再推回他手機沒有任何資訊價值。
#
# ⚠️ 為什麼 GET 也要鎖站主（見 api_ck_screener 的說明）：這是他**付費訂閱**的內容。
#
#: POST body 的位元組上限。一則四象限快照原文約 1~4 KB，`ckstore.MAX_TEXT_BYTES`
#: 抓 24 KB；這裡再留一倍給 JSON 外框。⚠️ 這道閘要在**驗身分之前**擋（同
#: /api/tv/webhook 的理由）：未授權訪客送一個 500 KB 的 body 就能吃掉免費方案記憶體。
CK_SCREENER_MAX_BODY = 48 * 1024
#: 貼入是寫入路徑（會寫帳本分片 + state 檔 + 兩次 GitHub Contents API），必須序列化。
#: ⚠️ 這格也只有 1 個，GitHub 卡住一次站主就**永遠貼不進任何快照**，所以同樣要逃生門；
#:    但它是**寫入**路徑，逃生的代價比讀取路徑高，門檻因此設得保守得多：
#:    ckstore.submit 的實際成本是 2 次 GitHub 往返（ledger.py timeout=25）＋本機寫檔，
#:    健康值遠低於 60 秒 → 300 秒門檻幾乎不可能誤殺，而 escape_max=1 讓最壞情況
#:    是「兩個寫入者並存」而不是一群。
#: ⚠️ 殘留風險（誠實記下）：ckstore 的 state 檔是 read-modify-write，
#:    卡死者若在逃生後醒來仍可能造成 lost update。本層擋得住「回寫本檔快取」，
#:    擋不住 ckstore 內部的寫入——真正的解要在 agent/ckstore.py 做總時限，不在這裡。
_cks_slots = _StaleGate("ck_screener_write", limit=1, stale_sec=300.0, escape_max=1)
#: GET 的短快取：snapshot() 會叫 ledger.status()（解析近兩個月分片），
#: 前端「重新整理」連按幾下不該各解析一次。10 秒足夠、且貼入成功後立刻失效。
_CKS_CACHE = {"at": 0.0, "data": None}
_CKS_TTL = 10.0


def _cks_owner_only_body(st: dict) -> dict:
    """
    非站主看到的內容。**整份隱藏**（象限、幣種、LIQ、原文、事件全部不給）。

    理由不是安全，是**別人的付費產品**：這是站主訂閱 CoinKarma 才拿得到的推播內容，
    公開站上任何陌生人都打得到這個網址，照原樣吐出去等於免費轉載別人的付費產品
    ——而且是逐幣、逐小時的完整輸出，比他們自己的免費版還多。
    本站沒有轉載授權，也沒有理由替別人做這件事。

    ⚠️ `count` 是 **None 不是 0**：0 的意思是「查了，一支都沒有」，
       這裡的事實是「不給你看」。留白或寫 0 都是謊報（本專案鐵律：查不到 ≠ 0）。
    """
    return {
        "owner_only": True, "owner": False, "configured": bool(st.get("configured")),
        "has_data": None, "as_of": None, "age_hours": None,
        "coins": [], "count": None, "counts": None, "quadrants": [], "events": [],
        "note": ("這一區是站主付費訂閱的 CoinKarma「山寨幣篩選器」推播內容，"
                 "公開轉載等於免費散布別人的付費產品，因此對非站主一律不顯示"
                 "（象限、幣種、LIQ、原文、事件全部隱藏）。"),
        "owner_note": st.get("note"),
        "source": "CoinKarma Token Screener",
        "no_scraping_note": ("本站不會、也不該去爬 CoinKarma 或 Telegram："
                             "他們沒有公開 API，Custom Alerts 也只能送到自家 Telegram Bot。"
                             "資料只來自站主手動貼入。"),
    }


@app.get("/api/ck_screener")
def api_ck_screener(request: Request):
    """
    CoinKarma 四象限快照的**現況**（最新一份 + 近期狀態改變事件）。**站主限定。**

    非站主的處理方式與理由：見 `_cks_owner_only_body`——整份隱藏，
    並且明講「是不給看」而不是「沒有資料」（count 回 None 不回 0）。
    帳本那一側同樣鎖住：`ck_screener` 已列入 PRIVATE_FAMILY_PREFIXES，
    所以 /api/ledger/families 也不會從側門把象限家族名漏出去。

    ⚠️ 這裡吐出去的每一個數字都要能對回原始畫面：`as_of` 是**快照自己的時間**
       （不是貼入時間），`age_hours` 以它為基準，LIQ／PR 一律標明是 CoinKarma
       原始輸出、本站不重算。
    ⚠️ 回傳含使用者貼入的自由文字（事件描述、原文），前端顯示時必須 esc() 跳脫。
    """
    st = _owner_state(request)
    if not st["owner"]:
        return _priv_json(_cks_owner_only_body(st))
    now = time.time()
    c = _CKS_CACHE
    if c["data"] is not None and (now - (c["at"] or 0.0)) < _CKS_TTL:
        out = dict(c["data"])
        out["cache"] = {"hit": True, "age_sec": round(now - c["at"], 1)}
        return _priv_json(out)
    try:
        import ckstore
        data = ckstore.snapshot()
    except Exception as e:
        print("ck_screener snapshot 失敗: %s: %s" % (type(e).__name__, e), file=sys.stderr)
        # ⚠️ 失敗回的是「這次讀不到」，不可以渲染成「沒有資料」。
        return _priv_json({"owner": True, "owner_only": False, "has_data": None,
                           "coins": [], "count": None, "counts": None,
                           "quadrants": [], "events": [],
                           "error": "讀取失敗：%s" % type(e).__name__,
                           "note": "這代表『本次讀不到』，不代表沒有快照。"}, status=503)
    data["owner"] = True
    data["owner_only"] = False
    data["configured"] = bool(st.get("configured"))
    # ⚠️ 讀不到（snapshot() 回 error）**不可以進快取**：那會把一次網路抖動
    #    在畫面上多留 10 秒，而且使用者按「重新整理」也還是同一份錯誤。
    if not data.get("error"):
        _CKS_CACHE.update({"at": now, "data": data})
    out = dict(data)
    out["cache"] = {"hit": False, "age_sec": 0.0}
    return _priv_json(out)


def _cks_extract(raw_bytes):
    """
    request body → (text, key, error, allow_incomplete)。

    接受兩種格式（前端用 JSON，手動 curl 用 text/plain 比較方便）：
      ‧ application/json：{"text": "<原文>"}（也吃 raw／content／snapshot／message）
      ‧ 其他：整個 body 就是原文
    ⚠️ 解析不出來一律回明確錯誤，**不猜**——猜錯會把一段亂碼當成快照存進稽核檔。

    `allow_incomplete` 是站主對「缺象限標題」那道完整性閘門的明確覆寫
    （見 ckstore._completeness）。**只認真正的布林 true**：字串 "false"、0、""
    都不算，因為這個旗標一旦誤開，那一輪的「離開象限」可能全是複製不完整造成的假事件。
    """
    try:
        s = raw_bytes.decode("utf-8")
    except Exception:
        return None, "", "內容不是合法的 UTF-8（請直接貼 Telegram 的文字，不要貼檔案）", False
    obj = None
    if s.lstrip()[:1] == "{":
        try:
            obj = json.loads(s)
        except Exception:
            obj = None
    if isinstance(obj, dict):
        key = ""
        for kk in ("key", "OWNER_KEY", "owner_key"):
            if isinstance(obj.get(kk), str):
                key = obj[kk]
                break
        allow = obj.get("allow_incomplete") is True
        for kk in ("text", "raw", "content", "snapshot", "message"):
            if kk in obj:
                v = obj.get(kk)
                return (v if isinstance(v, str) else ""), key, None, allow
        return "", key, ("JSON 裡找不到原文欄位。請用 {\"text\": \"<快照原文>\"}"
                         "（也接受 raw／content／snapshot／message）。"), allow
    return s, "", None, False


@app.post("/api/ck_screener")
async def api_ck_screener_submit(request: Request):
    """
    貼入一則 CoinKarma 四象限快照。**站主限定**（cookie，或 body 帶 OWNER_KEY／CRON_KEY）。

    沒有這道閘＝任何陌生人都能往帳本灌假資料，而帳本是 append-only、灌進去刪不掉。

    閘門順序（不可調換，同 /api/tv/webhook 的理由）：
      1. body 大小上限——在驗身分**之前**擋，否則未授權訪客送 500 KB 就能吃記憶體。
      2. 身分（cookie 或 body 金鑰）；失敗走既有的退避鎖定並回 401。
      3. 併發閘（單槽）：這是寫入路徑，會動帳本分片與兩次 GitHub Contents API。

    ⛔ **絕不觸發 LINE 推播**：本函式不呼叫 `_run_scan`、不 import `notifier`，
       `ckstore` 也不認識 notifier。回傳的 `push.line` 恆為 False。

    回傳（皆走 _priv_json）：解析到幾支幣、產生幾個事件、gap_hours 與 t0 精度、
    被拒收的原因（亂序／重複／解析不出時間）、有哪幾支幣沒有價格來源、
    帳本與 GitHub 同步結果、以及未持久化時的明確警語。
    業務層的拒收一律回 HTTP 200 + ok=false（讓前端只有一條渲染路徑）；
    只有身分／體積／忙碌／模組故障才用 4xx/5xx。
    """
    raw = await _read_body_capped(request, CK_SCREENER_MAX_BODY)
    if raw is None:
        return _priv_json({"ok": False, "status": "too_large",
                           "error": "內容過大或讀取中斷（上限 %d bytes）。"
                                    "一則四象限快照原文通常只有 1~4 KB。"
                                    % CK_SCREENER_MAX_BODY,
                           "limit": CK_SCREENER_MAX_BODY}, status=413)

    text, body_key, perr, allow_incomplete = _cks_extract(raw)

    st = _owner_state(request)
    if not st["owner"]:
        wait = _owner_retry_after()
        if wait > 0:
            return _priv_json({"ok": False, "error": "嘗試過於頻繁，已暫時鎖定，請稍後再試",
                               "retry_after_sec": wait}, status=429)
        if not _edit_key_ok(body_key):
            w = _owner_note_fail()
            return _priv_json({"ok": False, "owner": False,
                               "configured": bool(st.get("configured")),
                               "error": "需要站主身分：請先用 OWNER_KEY 登入（POST /api/owner/login），"
                                        "或在 body 帶正確的 OWNER_KEY／CRON_KEY。"
                                        "沒有這道閘，任何人都能往帳本灌假資料。",
                               "owner_note": st.get("note"),
                               "retry_after_sec": w}, status=401)

    if perr:
        return _priv_json({"ok": False, "status": "bad_request", "error": perr})

    tk = _cks_slots.acquire()
    if tk is None:
        # 排隊等於讓第二個請求也吃掉一次 GitHub 往返；直接請他重試比較誠實。
        return _priv_json({"ok": False, "status": "busy",
                           "busy": _cks_slots.busy_info(),
                           "error": "另一則快照正在寫入中：%s。請稍後再送一次。"
                                    "這代表『這次沒寫』，不是寫壞了。"
                                    % _cks_slots.busy_note()}, status=429)
    # ⚠️ `ckstore.submit` 會做兩次 GitHub Contents API 往返（同步網路 I/O）。
    #    在 `async def` 裡直接呼叫＝壓在事件迴圈上，整台 server 那段時間收不到請求。
    try:
        import ckstore
        res = await _offload(
            lambda: ckstore.submit(text, actor="owner", allow_incomplete=allow_incomplete),
            CK_SCREENER_DEADLINE_SEC, "ck_screener", ticket=tk, gate=_cks_slots)
    except _OffloadTimeout as e:
        return _priv_json({"ok": False, "status": "timeout",
                           "elapsed_sec": round(e.elapsed, 1),
                           "deadline_sec": CK_SCREENER_DEADLINE_SEC,
                           "error": "超過 %d 秒仍未完成（多半卡在 GitHub 往返）。"
                                    % int(CK_SCREENER_DEADLINE_SEC),
                           "note": "⚠️ 這「不代表沒寫」：處理仍在背景進行，結果未知。"
                                   "請重新整理確認；要重送也安全（冪等鍵是快照時間）。"},
                          status=504)
    except _OffloadRejected:
        _cks_slots.release(tk)
        return _priv_json({"ok": False, "status": "busy",
                           "error": "處理池已滿，這一份沒有開始處理，請稍後重送。"},
                          status=503)
    except Exception as e:
        _cks_slots.release(tk)
        import traceback
        print("ck_screener 貼入失敗: %s: %s" % (type(e).__name__, e), file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return _priv_json({"ok": False, "status": "error",
                           "error": "處理失敗：%s" % type(e).__name__,
                           "note": "這代表『這一份沒有被收下』——請重試；"
                                   "重複送同一份不會產生重複事件（冪等鍵是快照時間）。"},
                          status=500)

    # 世代比對：這一輪若已被逃生門判死，寫入**確實已經發生**（在 ckstore 裡），
    # 所以照樣讓 GET 快取失效——但要在回應裡講明它是遲到的，不可讓站主以為剛剛才寫。
    if tk.superseded():
        print("[gate:ck_screener_write] 遲到的寫入 gen=%d（持有 %.0f 秒，已被逃生門取代）"
              % (tk.gen, tk.held_sec()), file=sys.stderr)
        res["late"] = True
        res["late_note"] = ("這次寫入耗時 %.0f 秒、期間已被判定卡住，可能有另一則快照"
                            "在它之後寫入；請重新整理確認現況。" % tk.held_sec())

    # 內容變了 → 讓 GET 的短快取立刻失效，否則使用者剛貼完卻看到舊的一份
    if res.get("ok"):
        _CKS_CACHE.update({"at": 0.0, "data": None})
    res.setdefault("push", {"line": False})
    res["push"]["line"] = False        # 寫死：這條路徑永遠不推 LINE
    return _priv_json(res)


# ═══════════════════════════════════════════════════════════════════════════
# 微信指定人物 CA — 手動貼入
# ═══════════════════════════════════════════════════════════════════════════
# ⚠️ 為什麼是手動貼入而不是自動監聽：微信 Windows 版**不建立 Windows Toast**
#    （2026-09-06 三項獨立證據，見 agent/wechatca.py 與《微信CA手動貼入_規格.md》），
#    所以 UserNotificationListener 讀不到。⛔ 不得改用 Hook／讀微信 DB／
#    UI Automation／OCR 繞過。
# ⚠️ 全部站主限定：這是**別人在私人微信群裡的發言**，本站沒有轉載授權。
#    非站主一律整份遮蔽，count 回 None 不是 0（同 ck_screener 的理由）。
WECHAT_CA_MAX_BODY = 16 * 1024      # 一則群訊息通常只有幾百 bytes
_wca_slots = _StaleGate("wechat_ca_write", limit=1, stale_sec=300.0, escape_max=1)
#: 名單設定的併發閘（2026-09-07 補）。⚠️ 這條路徑原本**沒有閘**：
#: `_blocking_executor()` 只有 4 個 worker，站主連點幾次「儲存名單」就把池子佔滿，
#: 貼入／CoinKarma 只能乾等到各自的 deadline 才回失敗——一個 UI 上的雙擊會變成
#: 別條路徑的「逾時」。limit=1 還有第二個理由：`set_rules` 是**整份覆寫**，
#: 兩個同時進去後寫的會蓋掉先寫的，而畫面上兩邊都會說「已儲存」。
#: stale_sec 取 3 倍 deadline：明顯大於「健康但慢」的實測耗時，才不會誤判。
_wcr_slots = _StaleGate("wechat_ca_rules", limit=1,
                        stale_sec=WECHAT_RULES_DEADLINE_SEC * 3, escape_max=1)
#: 站主手動指定鏈別的併發閘。⚠️ 與貼入分開一個槽（同 _wal_slots 的理由）：
#: 這是站主在畫面上按下去的動作，不該和「再貼一則微信訊息」互相卡住。
#: limit=1 的理由與貼入相同——這條路徑會打 GoPlus／DexScreener／GMGN，
#: 而且會寫帳本（append-only、開倉不冪等），兩個同時進去可能對同一筆開兩次倉。
_wcc_slots = _StaleGate("wechat_ca_chain", limit=1,
                        stale_sec=WECHAT_CA_DEADLINE_SEC * 3, escape_max=1)


def _wca_owner_gate(request: Request, body_key=None):
    """站主閘。回 None 代表通過，否則回一個要直接送出的 JSONResponse。"""
    st = _owner_state(request)
    if st["owner"]:
        return None
    wait = _owner_retry_after()
    if wait > 0:
        return _priv_json({"ok": False, "error": "嘗試過於頻繁，已暫時鎖定，請稍後再試",
                           "retry_after_sec": wait}, status=429)
    if _edit_key_ok(body_key):
        return None
    w = _owner_note_fail()
    return _priv_json({"ok": False, "owner": False,
                       "configured": bool(st.get("configured")),
                       "error": "需要站主身分。這裡放的是別人在私人群裡的發言，不對外開放。",
                       "owner_note": st.get("note"), "retry_after_sec": w}, status=401)


@app.get("/api/wechat_ca")
def api_wechat_ca_get(request: Request):
    """目前的微信 CA 紀錄與提及共識。站主限定。"""
    gate = _wca_owner_gate(request)
    if gate is not None:
        return gate
    try:
        import wechatstore
        snap = wechatstore.snapshot()
        # 價格序列的累積狀況。⚠️ 一定要露出來：績效要等序列累積夠天數才算得出來，
        # 畫面上不說的話，站主只會看到「一直沒有數字」而不知道是在累積還是壞了。
        try:
            import wechatprices
            snap["prices"] = wechatprices.snapshot()
        except Exception as pe:
            snap["prices"] = {"available": False,
                              "note": "讀不到價格序列（%s）——⚠️ 讀不到不等於沒有紀錄。"
                                      % type(pe).__name__}
        # 籌碼結構快照。⚠️ 一定要帶：不帶的話前端就算有顯示程式碼也永遠是空的，
        #    而畫面上「沒有籌碼資料」與「這顆幣籌碼很分散」長得很像。
        try:
            import chipstore
            snap["chips"] = chipstore.snapshot()
        except Exception as ce:
            snap["chips"] = {"available": False, "items": {},
                             "note": "讀不到籌碼快照（%s）——⚠️ 讀不到不等於沒有紀錄。"
                                     % type(ce).__name__}
        return _priv_json(snap)
    except Exception as e:
        print("wechat_ca 讀取失敗: %s: %s" % (type(e).__name__, e), file=sys.stderr)
        return _priv_json({"status": "error", "error": type(e).__name__,
                           "note": "讀不到 ≠ 沒有紀錄。"}, status=500)


@app.get("/api/twitter_watch")
def api_twitter_watch(request: Request):
    """推特監控的現況與命中紀錄。站主限定（他在盯誰是他的研究方向）。"""
    gate = _wca_owner_gate(request)
    if gate is not None:
        return gate
    try:
        import twitterwatch
        from providers import opentwitter
        snap = twitterwatch.snapshot()
        snap["api"] = opentwitter.health()
        # LINE 推播健康狀態：額度擋下與送出失敗都要看得到，不能只進日誌
        try:
            import ledger as _lgh
            st, err = _lgh.load_state("line_push_health", {"events": []})
            snap["line_health"] = ({"available": False,
                                    "note": "讀不到推播健康狀態（%s）" % err} if err
                                   else {"available": True,
                                         "events": (st.get("events") or [])[-5:]})
        except Exception:
            snap["line_health"] = {"available": False, "note": "讀不到推播健康狀態"}
        return _priv_json(snap)
    except Exception as e:
        print("twitter_watch 讀取失敗: %s: %s" % (type(e).__name__, e), file=sys.stderr)
        return _priv_json({"available": False, "accounts": {}, "hits": [],
                           "note": "讀不到監控狀態——⚠️ 讀不到不等於他們沒發文。"},
                          status=500)


@app.get("/api/coin_search")
def api_coin_search(request: Request, q: str = ""):
    """
    用**名字**找候選代幣（DexScreener，免金鑰）。站主限定。

    ⚠️ 回的是**候選集不是身分**。實測站主的真實樣本：Nailong 21 顆同名、
       哈基米 22 顆、luce 8 顆（前兩名流動性同量級）、刀盾 0 顆。
       前端**絕不可以**自己挑一顆當答案。
    ⚠️ 站主限定的理由是保護我們自己的 IP：DexScreener 免金鑰但有速率限制，
       公開端點會被人拿去刷爆，之後連站主自己都查不了。
    """
    gate = _wca_owner_gate(request)
    if gate is not None:
        return gate
    term = (q or "").strip()
    if not term or len(term) > 40:
        return _priv_json({"available": False, "status": "bad_params",
                           "note": "要查的名字是空的或過長（上限 40 字）",
                           "exact": [], "fuzzy": []}, status=400)
    tk = _onchain_slots.acquire()
    if tk is None:
        return _priv_json({"available": False, "status": "busy",
                           "note": "查詢排隊中，請稍後再試"
                                   "——⚠️ 這是查不到，不是沒有這顆幣",
                           "exact": [], "fuzzy": []}, status=429)
    try:
        from providers import dexscreener
        return _priv_json(dexscreener.search(term))
    except Exception as e:
        print("coin_search 失敗: %s: %s" % (type(e).__name__, e), file=sys.stderr)
        return _priv_json({"available": False, "status": "server_error",
                           "note": "查詢失敗——⚠️ 這是查不到，不是沒有這顆幣",
                           "exact": [], "fuzzy": []}, status=500)
    finally:
        _onchain_slots.release(tk)


@app.get("/api/onchain_candidates")
def api_onchain_candidates(request: Request):
    """
    鏈上候選清單（符合設定條件的已畢業代幣）。站主限定。

    ⚠️ 站主限定不是因為資料敏感，是因為**這是一份會被讀成「推薦」的清單**。
       公開站的訪客看到一排迷因幣，不會去讀免責聲明。
    ⚠️ 這條路徑**不打 GMGN**：只讀 cron 寫好的快照。所以重新整理不花額度。
    """
    gate = _wca_owner_gate(request)
    if gate is not None:
        return gate
    try:
        import trenches
        return _priv_json(trenches.snapshot())
    except Exception as e:
        print("onchain_candidates 讀取失敗: %s: %s" % (type(e).__name__, e),
              file=sys.stderr)
        return _priv_json({"available": False, "items": [],
                           "note": "讀不到候選清單——⚠️ 讀不到不等於"
                                   "「沒有符合條件的幣」。"}, status=500)


def _chips_remember_failure(chain: str, address: str, status, message) -> dict:
    """
    把「查了、但沒查到」也寫成一筆籌碼紀錄，並回傳這一次的結果。

    ⚠️ 為什麼一定要留痕（2026-09-07 修）：原本查失敗就直接 return，chipstore 裡
       一個位元組都沒有，前端於是落到 `wcaChipsHtml` 的「尚未查詢（貼入時鏈別未確認，
       或這是舊紀錄）」那一支——GMGN 限流、沒設金鑰、退避冷卻中、查無此幣，
       通通長得跟「還沒查」一模一樣。那是把系統性失敗換成一個聽起來合理的良性理由，
       正是本站鐵律第一條要擋的東西。

    ⚠️ **不覆寫既有的成功快照**：那份是「他把 CA 貼進來那一刻的籌碼長相」，
       用一筆失敗紀錄蓋掉等於拿錯誤訊息換掉真資料。這種情況回 kept_previous，
       畫面才說得出「這次沒查到，你看到的是 X 時候那一份」。
    ⚠️ 失敗紀錄一樣佔 chipstore 的筆數預算（MAX_TOKENS），淘汰規則是「最舊的先丟」——
       量體極小（幾百 bytes），但它確實可能擠掉很舊的成功快照，這是刻意的取捨：
       「查了而失敗」這件事必須留得住，否則畫面又會退回去說謊。
    """
    rec = {
        "available": False,
        "status": status or "unavailable",
        # note 一律講清楚是「查了沒查到」而不是「還沒查」，前端照原文顯示
        "note": (message or "籌碼結構本次未取得")
                + "——⚠️ 查不到不等於籌碼分散，也不等於還沒查。",
        "summary": None,
        "failed": True,
    }
    try:
        import chipstore as _cs
        k = _cs.key(chain, address)
        # ⚠️ 先作廢快取再讀。`chipstore.snapshot()` 走的是**小時級**快取，而
        #    `chipstore.put()` 不會作廢它——也就是說這裡讀到的「先前那份」有可能
        #    是一小時前的舊狀態。判成「沒有成功快照」的後果不是少畫一行，是
        #    **拿失敗紀錄覆寫掉真的籌碼資料**，而畫面接著會說「這次沒查到」。
        #    這條保證不可以建立在「每個寫入者都記得配對 invalidate」之上。
        _cs.invalidate_cache()
        prev = ((_cs.snapshot([k]) or {}).get("items") or {}).get(k) or {}
        if (prev.get("data") or {}).get("available"):
            rec["previous_at"] = prev.get("at")
            rec["store"] = {"status": "kept_previous", "previous_at": prev.get("at")}
            return rec
        # put 是同步寫（本機檔 ＋ GitHub 往返）。⚠️ 這行之後才塞 store，
        # 所以落地的那份不含 store 欄位（不會自我指涉、也不會多存一層雜訊）。
        rec["store"] = _cs.put(chain, address, rec)
        _cs.invalidate_cache()
    except Exception as e:
        rec["store"] = {"status": "store_error",
                        "detail": "%s: %s" % (type(e).__name__, e)}
    return rec


def _chips_lookup(chain: str, address: str) -> dict:
    """
    微信 CA 的籌碼結構來源：GMGN 前 100 名持有人 → chips.analyze → 存快照。

    ⚠️ 一次是權重 5 的查詢（Free 方案每秒 5 點），gmgn._throttle 會擋，
       所以這裡最少佔用一秒。呼叫端已用 MAX_CHIPS_PER_MSG 限制次數。
    ⚠️ 延後匯入，與 goplus / gmgn / dexscreener 同一個模式。
    ⚠️ 三種結果都要留痕：查到了／查了但失敗／（沒呼叫到這裡＝根本沒查）。
       失敗的那一種交給 `_chips_remember_failure`。
    """
    from providers import gmgn as _gmgn
    import chips as _chips
    import chipstore as _cs
    raw = _gmgn.holders(chain, address)
    if not raw.get("available"):
        # 取不到就照實回報，不回一個看起來像「籌碼很分散」的空殼
        return _chips_remember_failure(chain, address,
                                       raw.get("status"), raw.get("message"))
    try:
        a = _chips.analyze(raw.get("list"))
    except Exception as e:
        # 拿到清單卻算不出來，一樣是「查了、失敗」，不是「還沒查」
        return _chips_remember_failure(
            chain, address, "analyze_error",
            "取到持有人清單但籌碼分析失敗（%s: %s）" % (type(e).__name__, e))
    tok = None
    try:
        _cs.put(chain, address, a, token=tok)      # 存失敗不影響這次回傳
        _cs.invalidate_cache()
    except Exception as e:
        a = dict(a, store_error="%s: %s" % (type(e).__name__, e))
    a["summary"] = _chips.summary_zh(a)
    return a


def _dex_price(chain: str, address: str) -> dict:
    """微信 CA 的進場價來源。延後匯入，跟 goplus / gmgn 同一個模式。"""
    from providers import dexscreener
    return dexscreener.price(chain, address)


@app.post("/api/wechat_ca")
async def api_wechat_ca_submit(request: Request):
    """
    貼入一則微信訊息。**站主限定。**

    閘門順序與 /api/ck_screener 相同，不可調換：
      1. body 大小——在驗身分**之前**擋
      2. 身分（cookie 或 body 金鑰）
      3. 併發閘（單槽）：這條路徑會打 GoPlus（逐鏈探測最多 4 次）並可能寫帳本

    ⛔ 絕不推 LINE：本函式不 import notifier，wechatstore 也不認識它。
    """
    raw = await _read_body_capped(request, WECHAT_CA_MAX_BODY)
    if raw is None:
        return _priv_json({"ok": False, "status": "too_large",
                           "error": "內容過大或讀取中斷（上限 %d bytes）"
                                    % WECHAT_CA_MAX_BODY}, status=413)
    try:
        body = json.loads(raw.decode("utf-8", "replace")) if raw else {}
        if not isinstance(body, dict):
            raise ValueError("body 不是物件")
    except Exception as e:
        return _priv_json({"ok": False, "status": "bad_request",
                           "error": "JSON 解析失敗：%s" % type(e).__name__})

    gate = _wca_owner_gate(request, body.get("OWNER_KEY") or body.get("CRON_KEY"))
    if gate is not None:
        return gate

    tk = _wca_slots.acquire()
    if tk is None:
        return _priv_json({"ok": False, "status": "busy", "busy": _wca_slots.busy_info(),
                           "error": "另一則正在處理中：%s。這代表『這次沒寫』，不是寫壞了。"
                                    % _wca_slots.busy_note()}, status=429)
    # ⚠️ 這一段是**同步網路 I/O**（GoPlus 逐鏈探測 ＋ DexScreener ＋ 帳本 GitHub 往返），
    #    最壞 4.7 分鐘。留在 `async def` 裡等於壓在 asyncio 事件迴圈上，那段期間
    #    整台 server 收不到任何新請求——TradingView 的 3 秒逾時警報會直接消失。
    #    所以一律 `_offload`（專用執行緒池 ＋ 總秒數上限），slot 由工作真正結束時歸還。
    try:
        import wechatstore
        res = await _offload(
            lambda: wechatstore.submit(
                body.get("text"),
                group_id=body.get("group_id"),
                sender_override=body.get("sender_id"),
                message_time=body.get("message_time"),
                # 注入既有的鏈上查核（GoPlus 為主、GMGN 為輔）。
                # ⚠️ 傳的是函式不是結果：agent 層不自己連網，併發與預算留在這一層。
                onchain_lookup=lambda c, a: _onchain_query(c, a),
                # 進場價：DexScreener（免金鑰）。GoPlus 不提供價格、GMGN 要付費金鑰，
                # 而沒有進場價就永遠算不出績效，也就沒有同期 BTC 基準。
                price_lookup=_dex_price,
                # 籌碼結構。只對鏈別已確認的地址跑，且一則訊息最多 2 個（見 wechatstore）。
                chips_lookup=_chips_lookup,
            ),
            WECHAT_CA_DEADLINE_SEC, "wechat_ca", ticket=tk, gate=_wca_slots)
    except _OffloadTimeout as e:
        # ⚠️ 逾時 ≠ 沒寫。那條執行緒還在跑，這一則**可能已經、或稍後會**被收下。
        #    這裡若寫「沒有被收下」就是謊報；冪等鍵是訊息指紋，重貼本來就安全。
        return _priv_json({"ok": False, "status": "timeout",
                           "elapsed_sec": round(e.elapsed, 1),
                           "deadline_sec": WECHAT_CA_DEADLINE_SEC,
                           "error": "超過 %d 秒仍未完成（多半是 GoPlus 逐鏈探測在等節流／逾時）。"
                                    % int(WECHAT_CA_DEADLINE_SEC),
                           "note": "⚠️ 這「不代表沒寫」：處理仍在背景進行，結果未知。"
                                   "請重新整理看這一則有沒有出現；要重貼也安全"
                                   "（冪等鍵是訊息指紋，不會產生重複事件）。"},
                          status=504)
    except _OffloadRejected:
        _wca_slots.release(tk)
        return _priv_json({"ok": False, "status": "busy",
                           "error": "處理池已滿，這一則沒有開始處理，請稍後重貼。"},
                          status=503)
    except Exception as e:
        _wca_slots.release(tk)      # 派工前就炸掉（例如 import 失敗）才會走到這裡
        import traceback
        print("wechat_ca 貼入失敗: %s: %s" % (type(e).__name__, e), file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return _priv_json({"ok": False, "status": "error", "error": type(e).__name__,
                           "note": "這代表『這一則沒有被收下』——重貼不會產生重複事件"
                                   "（冪等鍵是訊息指紋）。"}, status=500)

    res = dict(res or {})
    res["ok"] = res.get("status") == "accepted"
    res.setdefault("push", {})
    res["push"]["line"] = False        # 寫死：這條路徑永遠不推 LINE
    return _priv_json(res)


#: 跟單評分的併發閘。⚠️ 與貼入分開一個槽：這是站主**手動點某個地址**才觸發的，
#: 不該和「再貼一則微信訊息」互相卡住。limit=1 是因為 GMGN 的限流看來源 IP，
#: 兩個同時跑只會互相拖慢並提高吃 429 的機會。
_wal_slots = _StaleGate("wallet_score", limit=1, stale_sec=120.0, escape_max=1)


@app.post("/api/wechat_ca/wallet")
async def api_wechat_ca_wallet(request: Request):
    """
    跟單評分：站主**手動**點某個持有人地址才跑。站主限定。

    ⚠️ 刻意不自動化：一次要 2 次 GMGN 查詢（權重 3／次），對前十大逐一跑就是
       20 次、序列好幾秒，而 Free 方案每秒只有 5 點權重。成本要花在站主
       真的想看的那一個錢包上。
    ⚠️ 這條路徑**不會**下單、也不簽章：agent/wallets.py 刻意不實作 Ed25519
       請求簽章（那是 swap／order 用的同一套機制）。
    """
    # ⚠️ 絕不可以 `await request.body()`：那會在驗身分**之前**把整包讀進
    #    記憶體，等於給任何人一個不用憑證的記憶體耗盡入口（10MB body ×N）。
    #    本檔 `OWNER_LOGIN_MAX_BODY` 與 `/api/line/webhook` 已經為這件事寫過兩次警告
    #    （原本這裡寫死行號 1617／3077，程式一改就對不上，改成指名處）。_read_body_capped
    #    會先看 Content-Length、再邊串流邊累加、超標立刻放棄。
    raw = await _read_body_capped(request, WECHAT_CA_MAX_BODY)
    if raw is None:
        return _priv_json({"ok": False, "error": "請求過大或讀取中斷"}, status=413)
    try:
        j = json.loads(raw.decode("utf-8", "replace")) if raw else {}
        if not isinstance(j, dict):
            raise ValueError
    except Exception:
        return _priv_json({"ok": False, "error": "請求格式不是 JSON"}, status=400)

    # 欄位名與本檔其他路由對齊（原本只認 "key"，前端靠 cookie 所以沒發現）
    gate = _wca_owner_gate(request,
                           j.get("OWNER_KEY") or j.get("CRON_KEY") or j.get("key"))
    if gate is not None:
        return gate

    chain = str(j.get("chain") or "").strip()
    wallet = str(j.get("wallet") or "").strip()
    if not chain or not wallet or len(chain) > 16 or len(wallet) > 128:
        return _priv_json({"ok": False, "error": "需要 chain 與 wallet，且長度合法"},
                          status=400)

    tk = _wal_slots.acquire()
    if tk is None:
        return _priv_json({"ok": False, "status": "busy",
                           "error": "已有一個跟單評分在跑：%s，請稍候"
                                    % _wal_slots.busy_note()}, status=429)
    def _work():
        """⚠️ 兩次 GMGN 查詢＝同步網路 I/O，必須跑在執行緒池、不可留在事件迴圈上。"""
        from providers import gmgn as _gmgn
        import wallets as _wal
        by, errs = {}, {}
        for period in ("7d", "30d"):
            r = _gmgn.wallet_stats(chain, wallet, period)
            if r.get("available"):
                by[period] = r.get("data")
            else:
                errs[period] = {"status": r.get("status"), "note": r.get("message")}
        a = _wal.analyze(by)
        a["summary"] = _wal.summary_zh(a)
        # ⚠️ 取不到的期間要講出來，不可以只顯示成功的那幾個——
        #    「只有 30d 有資料」與「兩個期間都正常」在畫面上必須分得出來。
        a["period_errors"] = errs or None
        return a

    try:
        a = await _offload(_work, WALLET_SCORE_DEADLINE_SEC, "wallet_score",
                           ticket=tk, gate=_wal_slots)
        return _priv_json({"ok": True, "chain": chain, "wallet": wallet, "data": a})
    except _OffloadTimeout as e:
        return _priv_json({"ok": False, "status": "timeout",
                           "elapsed_sec": round(e.elapsed, 1),
                           "deadline_sec": WALLET_SCORE_DEADLINE_SEC,
                           "error": "GMGN 超過 %d 秒沒回應——⚠️ 查不到不等於這個錢包沒問題，"
                                    "請稍後再點一次。" % int(WALLET_SCORE_DEADLINE_SEC)},
                          status=504)
    except _OffloadRejected:
        _wal_slots.release(tk)
        return _priv_json({"ok": False, "status": "busy",
                           "error": "處理池已滿，這次沒有開始查詢，請稍後再點一次。"},
                          status=503)
    except Exception as e:
        _wal_slots.release(tk)
        print("wallet_score 失敗: %s: %s" % (type(e).__name__, e), file=sys.stderr)
        return _priv_json({"ok": False, "status": "error",
                           "error": "跟單評分失敗（%s）——⚠️ 查不到不等於這個錢包沒問題"
                                    % type(e).__name__}, status=500)


@app.post("/api/wechat_ca/rules")
async def api_wechat_ca_rules(request: Request):
    """設定要監看的群組與人物（allowlist）。站主限定。"""
    raw = await _read_body_capped(request, WECHAT_CA_MAX_BODY)
    if raw is None:
        return _priv_json({"ok": False, "status": "too_large"}, status=413)
    try:
        body = json.loads(raw.decode("utf-8", "replace")) if raw else {}
        if not isinstance(body, dict):
            raise ValueError
    except Exception:
        return _priv_json({"ok": False, "status": "bad_request"})
    gate = _wca_owner_gate(request, body.get("OWNER_KEY") or body.get("CRON_KEY"))
    if gate is not None:
        return gate
    # 併發閘（單槽）：理由見 `_wcr_slots` 的註解——沒有它，連點儲存會吃光 4 個
    # worker，並且兩次整份覆寫會互相蓋掉而兩邊都回報成功。
    tk = _wcr_slots.acquire()
    if tk is None:
        return _priv_json({"ok": False, "status": "busy", "busy": _wcr_slots.busy_info(),
                           "error": "另一次名單儲存正在寫入中：%s。"
                                    "這代表『這次沒改到』，不是改壞了。"
                                    % _wcr_slots.busy_note()}, status=429)
    # ⚠️ `set_rules` 會讀 + 寫狀態（GitHub Contents API，同步網路 I/O），
    #    而且與貼入共用 `wechatstore._SUBMIT_LOCK`——貼入正在跑時它會整個卡住。
    #    留在事件迴圈上＝全站無回應，所以一律 offload。
    try:
        import wechatstore
        res = await _offload(
            lambda: wechatstore.set_rules(groups=body.get("groups"),
                                          senders=body.get("senders")),
            WECHAT_RULES_DEADLINE_SEC, "wechat_ca_rules", ticket=tk, gate=_wcr_slots)
    except _OffloadTimeout as e:
        # ⚠️ 逾時**不歸還槽位**：那條執行緒還握著 _SUBMIT_LOCK 在跑，提早歸還等於
        #    放第二次覆寫進去疊在同一把鎖上。卡死由 _StaleGate 的逃生門負責。
        return _priv_json({"ok": False, "status": "timeout",
                           "elapsed_sec": round(e.elapsed, 1),
                           "error": "超過 %d 秒仍未完成（多半是另一則貼入正持有寫入鎖，"
                                    "或 GitHub 往返很慢）。"
                                    % int(WECHAT_RULES_DEADLINE_SEC),
                           "note": "⚠️ 這「不代表沒改到」：設定仍在背景寫入，結果未知。"
                                   "請重新整理確認目前的名單。"}, status=504)
    except _OffloadRejected:
        _wcr_slots.release(tk)
        return _priv_json({"ok": False, "status": "busy",
                           "error": "處理池已滿，這次沒有開始寫入，請稍後再試。"}, status=503)
    except Exception as e:
        _wcr_slots.release(tk)      # 派工前就炸掉（例如 import 失敗）才會走到這裡
        print("wechat_ca 名單設定失敗: %s: %s" % (type(e).__name__, e), file=sys.stderr)
        return _priv_json({"ok": False, "status": "error", "error": type(e).__name__},
                          status=500)
    res = dict(res or {})
    res["ok"] = res.get("status") == "ok"
    return _priv_json(res)


#: 這條路徑「拒絕」的幾種情況分別回什麼 HTTP 狀態。
#: ⚠️ 一律不是 200：前端若把「指定失敗」畫成成功，站主會以為那筆已經進帳本了。
#:    409 ＝ 這筆的狀態不允許（已指定過／系統已確認），422 ＝ 指定的鏈不合法。
_WCC_STATUS_CODE = {
    "ok": 200,
    "bad_request": 400,
    "event_not_found": 404,
    "already_overridden": 409,
    "already_confirmed": 409,
    "no_candidate_chains": 422,
    "chain_not_in_found_on": 422,
    "state_unavailable": 503,
}


@app.post("/api/wechat_ca/chain")
async def api_wechat_ca_chain(request: Request):
    """
    站主**手動指定**某一筆提及的鏈別。站主限定。

    為什麼需要：`resolve_chain` 在 CHAIN_HINT_MISMATCH／CHAIN_AMBIGUOUS 時刻意
    不挑邊（同一串地址在不同鏈上可能是不同的幣），而不確認 ⇒ 不問價、不進價格
    追蹤、不寫帳本——站主因此整筆卡死。這條給人一個出口，但：
      · **只能挑 `chain_found_on` 裡真的查得到的那幾條之一**（憑空捏造比卡住更糟）
      · 原事件不改，追加一筆帶 `chain_source="owner_override"` 的新事件
      · 帳本 label 與 rule_version 都永久標明「鏈別由站主手動指定」

    閘門順序與 /api/wechat_ca 相同，不可調換：
      1. body 大小——在驗身分**之前**擋（不可 `await request.body()`）
      2. 身分（cookie 或 body 金鑰）
      3. 參數合法性（純字串檢查，不花任何外部資源）
      4. 併發閘（單槽）→ `_offload` 到執行緒池

    ⛔ 絕不推 LINE：本函式不 import notifier，wechatstore 也不認識它。
       這是站主自己按下去的動作，人就在畫面前，推到手機只是噪音，而且會白白
       吃掉 LINE 每月 200 則的免費額度。
    """
    raw = await _read_body_capped(request, WECHAT_CA_MAX_BODY)
    if raw is None:
        return _priv_json({"ok": False, "status": "too_large",
                           "error": "內容過大或讀取中斷（上限 %d bytes）"
                                    % WECHAT_CA_MAX_BODY}, status=413)
    try:
        body = json.loads(raw.decode("utf-8", "replace")) if raw else {}
        if not isinstance(body, dict):
            raise ValueError("body 不是物件")
    except Exception as e:
        return _priv_json({"ok": False, "status": "bad_request",
                           "error": "JSON 解析失敗：%s" % type(e).__name__}, status=400)

    # ⚠️ 先記下身分是怎麼過的，再進閘門：閘門只回「通過／不通過」，通過之後
    #    就分不出是 cookie、本機放寬、還是 body 金鑰了——而這要永久記進事件
    #    當稽核痕跡（`_owner_state` 的 via：cookie／local_dev；都不是就是 body 金鑰）。
    _via = _owner_state(request).get("via") or "owner_key"
    gate = _wca_owner_gate(request, body.get("OWNER_KEY") or body.get("CRON_KEY")
                           or body.get("key"))
    if gate is not None:
        return gate

    event_id = str(body.get("event_id") or "").strip()
    chain = str(body.get("chain") or "").strip()
    # 長度上限與 /api/onchain 同一把尺；event_id 是 sha256 十六進位（64 字）。
    if not event_id or not chain or len(event_id) > 128 or len(chain) > 16:
        return _priv_json({"ok": False, "status": "bad_request",
                           "error": "需要 event_id 與 chain，且長度合法"
                                    "（event_id ≤128、chain ≤16 字元）"}, status=400)

    tk = _wcc_slots.acquire()
    if tk is None:
        return _priv_json({"ok": False, "status": "busy", "busy": _wcc_slots.busy_info(),
                           "error": "另一次鏈別指定正在處理中：%s。"
                                    "這代表『這次沒指定成』，不是指定壞了。"
                                    % _wcc_slots.busy_note()}, status=429)
    try:
        import wechatstore
        res = await _offload(
            lambda: wechatstore.owner_set_chain(
                event_id, chain, actor="owner", via=_via,
                # 指定完要重新查那條鏈的合約風險：原事件存的是「不一致／多鏈皆有」
                # 的合成快照，不是這條鏈的實際風險。
                onchain_lookup=lambda c, a: _onchain_query(c, a),
                price_lookup=_dex_price,
                chips_lookup=_chips_lookup,
            ),
            WECHAT_CA_DEADLINE_SEC, "wechat_ca_chain", ticket=tk, gate=_wcc_slots)
    except _OffloadTimeout as e:
        # ⚠️ 逾時 ≠ 沒指定成。那條執行緒還在跑，這一筆**可能已經、或稍後會**寫進去。
        #    寫「沒有指定成」就是謊報。重試是安全的：重複指定會被明確拒絕
        #    （already_overridden），不會變成兩筆。
        return _priv_json({"ok": False, "status": "timeout",
                           "elapsed_sec": round(e.elapsed, 1),
                           "deadline_sec": WECHAT_CA_DEADLINE_SEC,
                           "error": "超過 %d 秒仍未完成（多半是 GoPlus／GMGN 在等節流）。"
                                    % int(WECHAT_CA_DEADLINE_SEC),
                           "note": "⚠️ 這「不代表沒指定成」：處理仍在背景進行，結果未知。"
                                   "請重新整理看這一筆的鏈別有沒有變；再按一次也安全"
                                   "（重複指定會被擋下，不會變成兩筆）。"},
                          status=504)
    except _OffloadRejected:
        _wcc_slots.release(tk)
        return _priv_json({"ok": False, "status": "busy",
                           "error": "處理池已滿，這次沒有開始處理，請稍後再試。"},
                          status=503)
    except Exception as e:
        _wcc_slots.release(tk)      # 派工前就炸掉（例如 import 失敗）才會走到這裡
        import traceback
        print("wechat_ca 鏈別指定失敗: %s: %s" % (type(e).__name__, e), file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return _priv_json({"ok": False, "status": "error", "error": type(e).__name__,
                           "note": "這代表『這次沒指定成』——再按一次不會產生重複事件。"},
                          status=500)

    res = dict(res or {})
    res["ok"] = res.get("status") == "ok"
    res.setdefault("push", {})
    res["push"]["line"] = False        # 寫死：這條路徑永遠不推 LINE
    # ⚠️ 沒對應到的 status 回 500 而不是 400：那代表**我們**回了一個沒登記的狀態，
    #    賴到使用者身上（400）只會讓這種漏接更難被發現。res.status 原樣附在 body 裡。
    return _priv_json(res, status=_WCC_STATUS_CODE.get(res.get("status"), 500))


@app.get("/api/onchain")
def api_onchain(chain: str = "", address: str = ""):
    """
    鏈上代幣風險端點（公開）。這層只做「參數檢查 + 併發閘」，實際查詢在 _onchain_query。

    ⚠️ 併發閘不是可選的：這個端點跟 /api/inspect 一樣公開、同步、而且會往外打
    GoPlus（0.4~0.6 秒）並可能開 GMGN 背景執行緒。沒有閘門時，一個 for 迴圈就能
    把 uvicorn 的工作執行緒佔滿，整站（含首頁）跟著沒有回應。與 inspect 同級：上限 2、滿了回 429。
    """
    ch, ad = (chain or "").strip(), (address or "").strip()
    # 長度上限：sol 最長 44、EVM 42、tron 34 字元。超長輸入沒有合法用途，
    # 擋在這裡就不會被原樣轉發到外部 API。查不到／不合法一律 fail closed（不是綠燈）。
    if len(ch) > 16 or len(ad) > 128:
        return {"applicable": False, "available": False, "status": "bad_params",
                "note": "chain/address 長度不合法（chain ≤16、address ≤128 字元）"
                        "——⚠️ 無法查核不等於安全",
                "sources": []}
    tk = _onchain_slots.acquire()
    if tk is None:
        return JSONResponse({"applicable": True, "available": False, "status": "busy",
                             "busy": _onchain_slots.busy_info(),
                             "note": "鏈上查詢排隊中：%s，請稍後再試"
                                     "——⚠️ 查不到不等於安全" % _onchain_slots.busy_note(),
                             "sources": []}, status_code=429)
    try:
        return _onchain_query(ch, ad)
    except Exception as e:
        print(f"onchain 失敗 {ch}/{ad[:20]}: {type(e).__name__}: {e}", file=sys.stderr)
        return JSONResponse({"applicable": True, "available": False, "status": "server_error",
                             "note": "鏈上風險查詢暫時失敗——⚠️ 查不到不等於安全",
                             "sources": []}, status_code=500)
    finally:
        _onchain_slots.release(tk)


def _onchain_query(chain: str = "", address: str = ""):
    """
    鏈上代幣風險。**必須用 chain + contract_address 當識別**，
    禁止用 ticker/symbol 查（同名仿冒代幣在迷因幣市場極常見，規格 §12.3）。

    來源策略：**GoPlus 為主、GMGN 為輔**
      1. 先打 GoPlus（免金鑰、實測 100% 成功、欄位更多）。
      2. GMGN 只有在「有設金鑰」時才打，用來補 GoPlus 沒有的欄位
         （內部人比例、狙擊者活動，以及 GoPlus 不提供的價格/市值/EVM 池齡）。
         **每個被補上的欄位都會標明自己的來源**，不混成一團看不出出處的數字。
      3. GoPlus 失敗但 GMGN 成功 → 降級用 GMGN，並在訊息中講明主來源掛了。
      4. 兩者都失敗 → available=False，照舊 fail closed。

    查不到一律回 available=False 並標明原因——**查不到不等於安全**。

    ⚠️ **GMGN 一律不阻塞這個端點。** 實測（2026-08-09，本機正式金鑰）：
      - GMGN 冷查詢 **13.75 秒**（單請求 timeout 12 秒，且遇到 AUTH_CLIENT_ID_REPLAYED
        會自動換 timestamp 重試 8 次，每次間隔 1.05 秒）；
      - 同一地址快取命中 **0.004 秒**；
      - 而 GoPlus 全程只要 0.36~0.55 秒。
    若同步等 GMGN，每次查詢都要付十幾秒，換來的只有一兩個補充欄位——划不來。
    所以這裡只給它一個很短的預算（預設 1.2 秒，夠撈到快取命中或極快的成功），
    逾時就讓它在背景跑完：結果會寫進 gmgn 自己的快取，**下一次查同一個地址就會被合併進來**
    （實測第二次查 PEPE 為 0.004 秒且成功合併 dev_token_burn_ratio）。
    """
    if not chain or not address:
        return {"applicable": False, "available": False, "status": "missing_params",
                "note": "需要 chain 與 contract_address 兩個參數，且必須是合約地址不是代號",
                "sources": []}

    # 預設 0.4 秒。這個數字不是隨便抓的：GMGN 冷查詢要 13.75 秒（等多久都等不到），
    # 快取命中只要 0.004 秒。所以預算只需要「大於快取命中、遠小於冷查詢」——
    # 撈得到已經算好的結果，又不會為了一個永遠等不到的冷查詢拖慢整個頁面。
    try:
        GMGN_BUDGET_SEC = float(os.environ.get("ONCHAIN_GMGN_BUDGET_SEC") or 0.4)
    except Exception:
        GMGN_BUDGET_SEC = 0.4
    # 背景 GMGN 執行緒最多同時 2 條。公開站上如果有人狂點，一條可以活 14 秒的
    # 執行緒無上限地長出來就變成一個免費的資源耗盡管道。狀態掛在函式物件上，
    # 以免動到這個檔案的其他部分。
    # 用 dict.setdefault 而不是 `if not hasattr(...)`：後者在兩個請求同時打第一次時，
    # 兩邊都會各建一把鎖、後者覆蓋前者，計數就從此對不上。setdefault 在 GIL 下是原子的。
    # ⚠️ 1 不是 2。GMGN 的限流看**來源 IP**，是全站共用資源：實測序列請求
    #    5 次全過，故意並行 3 個就吃到兩個 429，而 429 硬撐會把 ban 從 29 秒
    #    滾到 5 分鐘。gmgn._throttle() 本來就會持鎖序列化，開 2 條只是讓第二條
    #    在鎖上排隊、白白佔著 Render 的執行緒。
    GMGN_MAX_INFLIGHT = 1
    _onchain_query.__dict__.setdefault("_gmgn_lock", threading.Lock())
    _onchain_query.__dict__.setdefault("_gmgn_inflight", 0)

    sources = []          # 實際用到哪些來源（含失敗的，失敗也要看得見）

    def _src(name, label, used, status, available, note, url=None):
        sources.append({"name": name, "label": label, "used": used,
                        "status": status, "available": available,
                        "note": note, "url": url})

    # ── 1) 主來源：GoPlus（免金鑰）──────────────────────────
    gp = None
    gp_err = None
    try:
        from providers import goplus
        gp = goplus.security(chain, address)
        if gp is None:
            gp_err = "參數不成立（chain/address 需為非空字串）"
    except Exception as e:
        gp_err = "%s: %s" % (type(e).__name__, e)

    if gp is not None:
        _src("goplus", "GoPlus Security（免金鑰）", True, gp.get("status"),
             bool(gp.get("available")), gp.get("message"), gp.get("token_url"))
    else:
        _src("goplus", "GoPlus Security（免金鑰）", True, "api_error", False,
             "呼叫 GoPlus adapter 失敗：%s" % gp_err)

    # ── 2) 輔助來源：GMGN（只在有金鑰時才打，且有硬預算）────
    gm = None
    gm_note = None
    gm_status = "skipped_no_key"
    try:
        from providers import gmgn as _gmgn
        try:
            _has_key = bool(_gmgn._api_key())
        except Exception:
            _has_key = False
        if not _has_key:
            gm_note = ("未設定 GMGN_API_KEY，本次不呼叫 GMGN。"
                       "內部人比例／狙擊者活動兩項因此無來源可補（⚠️ 無資料不等於沒有風險）")
        else:
            with _onchain_query._gmgn_lock:
                _slot = _onchain_query._gmgn_inflight < GMGN_MAX_INFLIGHT
                if _slot:
                    _onchain_query._gmgn_inflight += 1
            if not _slot:
                gm_status = "skipped_busy"
                gm_note = ("已有 %d 條 GMGN 背景查詢在跑，本次略過補充來源"
                           "（不影響主來源 GoPlus 的結果）。" % GMGN_MAX_INFLIGHT)
            else:
                _box = {}

                def _run_gmgn():
                    try:
                        _box["res"] = _gmgn.security(chain, address)
                    except Exception as _e:
                        _box["err"] = "%s: %s" % (type(_e).__name__, _e)
                    finally:
                        # 一定要在 finally 還名額，否則 GMGN 一超時就永久佔著位子，
                        # 補充來源會從此再也不啟動。
                        with _onchain_query._gmgn_lock:
                            _onchain_query._gmgn_inflight -= 1

                _th = threading.Thread(target=_run_gmgn, daemon=True)
                _th.start()
                _th.join(GMGN_BUDGET_SEC)
                if _th.is_alive():
                    gm_status = "pending_background"
                    gm_note = ("GMGN 超過 %.1f 秒仍未回應，本次不等它（實測冷查詢要 13.75 秒）。"
                               "它會在背景跑完並寫進自己的快取，"
                               "「下次查同一個地址就會被合併進來」。本次結果完全來自 GoPlus。"
                               % GMGN_BUDGET_SEC)
                elif _box.get("err"):
                    gm_status = "api_error"
                    gm_note = "呼叫 GMGN adapter 失敗：%s" % _box["err"]
                else:
                    gm = _box.get("res")
                    gm_status = (gm or {}).get("status") or "no_result"
                    gm_note = (gm or {}).get("message")
    except Exception as e:
        gm_status = "api_error"
        gm_note = "載入 GMGN adapter 失敗：%s" % (e,)

    _gm_available = bool(gm and gm.get("available"))
    _src("gmgn", "GMGN openapi（需金鑰，補充用）",
         gm_status != "skipped_no_key", gm_status, _gm_available,
         gm_note, (gm or {}).get("gmgn_url"))

    # ── 3) 決定主體 ────────────────────────────────────────
    if gp is not None and gp.get("available"):
        out = dict(gp)
        out["provider_primary"] = "goplus"
    elif _gm_available:
        # GoPlus 掛了但 GMGN 活著 → 降級，並把降級這件事講明白
        out = dict(gm)
        out["provider_primary"] = "gmgn"
        out["message"] = ("（主來源 GoPlus 無法查核：%s）%s"
                          % ((gp or {}).get("message") or gp_err or "未知原因",
                             out.get("message") or ""))
    elif gp is not None:
        # 兩邊都沒資料 → fail closed，但保留 GoPlus 的分類與說明
        out = dict(gp)
        out["provider_primary"] = "goplus"
        if gm is not None and not _gm_available:
            # ⚠️ 不可以把英文狀態碼硬串進給站主看的中文句子（他是牙醫，不是工程師）。
            #    GMGN adapter 自己回的 message 已經是完整中文，直接用它；
            #    真的沒有 message 時才退回狀態碼，並標明那是技術代碼。
            _gm_msg = (gm.get("message") or "").strip()
            out["message"] = ((out.get("message") or "")
                              + "　｜　備援來源 GMGN 也無法查核："
                              + (_gm_msg if _gm_msg
                                 else "技術代碼 %s" % gm.get("status")))
    else:
        out = {"applicable": True, "available": False, "status": "api_error",
               "chain": chain, "contract_address": address,
               "error": gp_err,
               "message": "兩個資料來源都無法查核（GoPlus：%s；GMGN：%s）。"
                          % (gp_err, gm_note or gm_status),
               "confidence": "reference_only",
               "safety_note": "查不到／不支援 ≠ 安全。available 為 False 時請顯示「無法查核」，"
                              "不可預設綠燈。"}

    # ── 4) 用 GMGN 補 GoPlus 沒有的欄位（只補「GoPlus 是 None」的）──
    #    ⚠️ 只在 GMGN 真的有值時才補，且每補一格就記一筆來源。
    #    絕不可因為「補過了」就讓某項從『不知道』變成看起來像『沒問題』。
    field_sources = {}
    merged = []
    if out.get("provider_primary") == "goplus" and _gm_available:
        gh = gm.get("holder_structure") or {}
        gl = gm.get("liquidity") or {}
        oh = dict(out.get("holder_structure") or {})
        ol = dict(out.get("liquidity") or {})

        def _fill(dst, key, val, src_note):
            """只有目的地是 None、且來源有實際數值時才填。"""
            if val is None or dst.get(key) is not None:
                return False
            dst[key] = val
            dst[key + "_source"] = src_note
            field_sources[key] = "gmgn"
            merged.append(key)
            return True

        # GoPlus 完全沒有的兩項（GMGN 公開 openapi 實測也沒有，故通常補不到——
        # 補不到就維持 None + 原本的「未提供」說明，不可留空）
        _fill(oh, "insider_ratio", gh.get("insider_ratio"), "GMGN")
        _fill(oh, "sniper_activity", gh.get("sniper_activity"), "GMGN")
        # GoPlus 不提供代幣價格，所以市值/流動性佔比只有 GMGN 有
        _fill(ol, "market_cap_usd", gl.get("market_cap_usd"),
              "GMGN（%s）" % (gl.get("market_cap_basis") or "自算"))
        _fill(ol, "liq_to_mcap", gl.get("liq_to_mcap"),
              "GMGN：最大池流動性 ÷ 市值（口徑與 GoPlus 的池加總不同，不可互相比較）")
        _fill(ol, "price_usd", gl.get("price_usd"), "GMGN /token/info 的 price.price")
        # GoPlus 的 EVM 端點不給池建立時間，只有 Solana 有
        if _fill(ol, "pool_age_days", gl.get("pool_age_days"), "GMGN 的池建立時間"):
            ol["pool_age"] = ol["pool_age_days"]
            ol["pool_created_at"] = gl.get("pool_created_at")
            ol["pool_age_note"] = "來源 GMGN：%s" % (gl.get("pool_age_note") or "池建立時間")
        _fill(oh, "dev_token_burn_ratio", gh.get("dev_token_burn_ratio"),
              "GMGN 的 dev_token_burn_ratio")

        out["holder_structure"] = oh
        out["liquidity"] = ol
        # GMGN 的 flag 只作對照，**不覆蓋** GoPlus 的判定，也不併入 flags——
        # 兩邊口徑不同，合併會產生一個誰都沒說過的結論。
        out["gmgn_cross_check"] = {
            "status": gm.get("status"),
            "summary": _gmgn.summary_line(gm) if hasattr(_gmgn, "summary_line") else None,
            "flags": gm.get("flags"),
            "note": "GMGN 的獨立判定，僅供對照。與 GoPlus 不一致時代表兩家看法不同，"
                    "不代表其中一方就是對的。",
        }

    # ── 5) 來源標示 ────────────────────────────────────────
    out["sources"] = sources
    out["field_sources"] = field_sources
    out["merged_from_gmgn"] = merged
    out["source_policy"] = ("GoPlus Security 為主要來源（免金鑰）；GMGN 僅在有金鑰時作為補充，"
                            "且只填 GoPlus 未提供的欄位，每格都標明來源。")
    if not out.get("available"):
        out.setdefault("note", "⚠️ 查不到不等於安全")
        out["safety_note"] = out.get("safety_note") or (
            "查不到／不支援 ≠ 安全。available 為 False 時請顯示「無法查核」，不可預設綠燈。")
    return out


def _key_ok(key: str) -> bool:
    """
    用 CRON_KEY 當「編輯模式」的解鎖鑰匙。

    公開站是唯讀的（任何人都打得到 API），但站主本人需要能改設定。
    重用已經存在的 CRON_KEY，不多發一組憑證。定時比較避免時序攻擊。
    未設 CRON_KEY 時一律拒絕（不可退成「沒設就放行」）。
    定時比較走 _ct_eq：非 ASCII 的金鑰不可以讓端點回 500（見 _ct_eq 說明）。
    """
    want = os.environ.get("CRON_KEY", "").strip()
    return bool(want) and _ct_eq((key or "").strip(), want)


def _edit_key_ok(key: str) -> bool:
    """
    body 帶金鑰的「站主編輯」路徑：接受 **OWNER_KEY 或 CRON_KEY**。

    ‧ OWNER_KEY：新的、專責身分驗證的那把。
    ‧ CRON_KEY：**刻意保留**，既有 cron／腳本／使用者手上的舊用法不能被這次改動打斷。
    兩把都沒設就一律拒絕（不可退成「沒設就放行」）。比較走 _ct_eq（定時比較；
    非 ASCII 金鑰要回 401 而不是 500）。
    """
    k = (key or "").strip()[:OWNER_KEY_MAX_LEN]
    if not k:
        return False
    ok_owner = _owner_configured() and _ct_eq(k, _owner_key())
    return bool(ok_owner or _key_ok(k))


@app.get("/api/onchain_watch")
def api_onchain_watch_list(request: Request):
    """
    讀鏈上代幣監控清單。**整份是私人資料 → 只有站主看得到**（2026-09-02）。

    這份清單裡有使用者自己填的 label、他在追哪條鏈的哪個合約、什麼時候加的、
    以及風險快照——等於把持倉觀察名單公開。線上實測確認它原本 200 全吐給任何人。

    非站主回**同形狀但明確標示**的結構（owner_only=true、tokens=[]、count=null）：
      ‧ 不回 500——那會被當成故障，而且 500 本身也是一種訊號。
      ‧ 不留白——count 用 null 而不是 0，因為 0 會被讀成「清單是空的」，那是謊報。
    """
    st = _owner_state(request)
    if not st["owner"]:
        return _priv_json({"owner_only": True, "owner": False,
                           "configured": bool(st["configured"]),
                           "tokens": [], "count": None,
                           "note": "此清單僅站主可見（count=null 代表「不告訴你」，"
                                   "不是「清單是空的」）。" + st["note"]})
    try:
        import onchain_watch
        d = dict(onchain_watch.list_tokens())
        d.update(owner_only=False, owner=True, configured=bool(st["configured"]))
        return _priv_json(d)
    except Exception as e:
        return _priv_json({"tokens": [], "count": None, "error": str(e),
                           "owner_only": False, "owner": True,
                           "note": "⚠️ 讀取清單失敗——這是讀不到，不是清單是空的。"})


@app.post("/api/onchain_watch")
def api_onchain_watch_edit(request: Request, payload: dict = Body(...)):
    """
    新增/移除監控中的鏈上代幣。**需站主身分**（2026-09-02 起）。

    接受三種身分證明（任一即可）：
      ‧ 站主 cookie（POST /api/owner/login 換來的）——前端走這條
      ‧ body 帶 OWNER_KEY
      ‧ body 帶 CRON_KEY —— **刻意保留**，既有的 cron／腳本路徑不能被打斷
    原本只靠 CRON_KEY，而 GET 又完全不設防，等於「看得到也改得到」；
    現在 GET 鎖成站主專屬，這裡自然要對齊，否則會變成「看不到但改得到」。

    payload: {"key": "...", "action": "add"|"remove", "chain": "sol", "address": "...", "label": ""}
    """
    if not _owner_state(request)["owner"]:
        # body 帶金鑰的路徑同樣要吃失敗鎖定——這個端點原本可以線上無限次猜金鑰。
        wait = _owner_retry_after()
        if wait > 0:
            return _priv_json({"ok": False, "error": "嘗試過於頻繁，已暫時鎖定，請稍後再試",
                               "retry_after_seconds": wait}, status=401)
        if not _edit_key_ok(str(payload.get("key", ""))):
            w = _owner_note_fail()
            return _priv_json({"ok": False,
                               "error": "需要站主身分：請先 POST /api/owner/login，"
                                        "或在 body 帶正確的 OWNER_KEY／CRON_KEY",
                               "retry_after_seconds": w or None}, status=401)
    # ⚠️ 以下每一條都要走 _priv_json（規格 ⑥：站主回應一律 no-store + noindex + Vary: Cookie）。
    #    add/remove 的回傳帶 count（站主在追幾檔）＝私人資料的一小塊，
    #    而且這條路徑的成敗本身就會透露「這把金鑰對不對」——不該留在任何快取裡。
    try:
        import onchain_watch
    except Exception as e:
        return _priv_json({"ok": False, "error": str(e)})
    act = str(payload.get("action", "")).strip().lower()
    chain, addr = str(payload.get("chain", "")), str(payload.get("address", ""))
    if act == "add":
        return _priv_json(onchain_watch.add(chain, addr, str(payload.get("label", ""))))
    if act == "remove":
        return _priv_json(onchain_watch.remove(chain, addr))
    return _priv_json({"ok": False, "error": "action 需為 add 或 remove"})


async def _read_body_capped(request: Request, limit: int):
    """
    有大小上限地讀取 request body。超過上限回 None，且**不把超出的部分留在記憶體裡**。

    ⚠️ 這是公開端點（網址一旦被知道，任何人都打得到）。
    直接 `await request.body()` 會在「驗簽之前」就把整個 body 讀進記憶體——
    未授權訪客送一個 10MB 的 body 就能吃掉免費方案 512MB 的一大塊，
    幾個併發就是一次不需要任何憑證的記憶體耗盡攻擊。

    兩道防線：
      1. Content-Length 先擋（正常客戶端都會帶，成本是零）。
      2. 沒帶或謊報 → 邊串流邊累加，一超過上限立刻停止收集並放棄。
    """
    cl = request.headers.get("content-length")
    if cl:
        try:
            if int(cl) > limit:
                return None                # 連讀都不讀
        except ValueError:
            return None                    # Content-Length 不是數字＝畸形請求
    total = 0
    chunks = []
    try:
        async for chunk in request.stream():
            total += len(chunk)
            if total > limit:
                return None                # 已收到的丟掉，不再往下收集
            chunks.append(chunk)
    except Exception:
        return None                        # 讀到一半連線斷掉：當作讀不到，不要變成 500
    return b"".join(chunks)


# 每則訊息的處理期限（秒）。LINE 的 reply token 只有 60 秒有效，而同一個 webhook body
# 內的事件是**序列**處理的：只要有一則卡在慢上游（實測注入 70 秒的 inspect，
# 完全沒有任何 timeout 會介入，_line_slots 也被佔住 70 秒），後面每一則的 token 都會過期。
# 45 秒留 15 秒給回覆本身的網路往返。
LINE_DEADLINE_SEC = 45.0
# reply token 的官方有效期（秒），與「留給回覆本身往返」的安全邊際。
# ⚠️ 單則 deadline 擋不住這個 body 內事件序列處理的累積延遲：
#    每則各花 3 秒都沒超過 45 秒，但第 20 則開始時已經過了 60 秒 → token 早就死了。
#    所以真正的期限是**整個 body 的累積耗時**，每則的可用預算要從剩餘額度裡切。
LINE_TOKEN_TTL_SEC = 60.0
LINE_REPLY_MARGIN_SEC = 10.0
# 剩餘預算低於這個數就別開工了：查詢跑不完，回覆也趕不上。
LINE_MIN_BUDGET_SEC = 3.0
# 逾時後回這句。**刻意不改用 push**——push 會吃掉 200 則/月的免費額度，
# 而「查詢慢」本來就可能連續發生。
LINE_TIMEOUT_MSG = ("⏳ 這筆查詢比平常久（超過 %d 秒），先不讓你空等。\n"
                    "資料還在算，請直接到網站看最新結果：https://aimarket.trade\n"
                    "或稍後再傳一次。" % int(LINE_DEADLINE_SEC))
# 同一批訊息排在後面、已經來不及在 reply token 有效期內處理的，回這句（同樣不用 push）。
LINE_BACKLOG_MSG = ("⏳ 這批訊息太多，這則已經排到 LINE 的回覆時限（%d 秒）之外，我沒有動手查。\n"
                    "請單獨再傳一次，或直接到網站查：https://aimarket.trade"
                    % int(LINE_TOKEN_TTL_SEC))

# 單執行緒的查詢池：配合 _line_slots(2) 讓最多兩件重活同時跑，逾時後主流程先回覆，
# 孤兒工作跑完才歸還 slot（不歸還會永久佔用，提早歸還則會超賣併發）。
_line_exec = None
_line_exec_lock = threading.Lock()


def _line_executor():
    global _line_exec
    with _line_exec_lock:
        if _line_exec is None:
            from concurrent.futures import ThreadPoolExecutor
            _line_exec = ThreadPoolExecutor(max_workers=4, thread_name_prefix="line")
        return _line_exec


def _process_line_events(body: dict) -> None:
    """
    在**背景執行緒**處理 LINE 事件。

    ⚠️ 為什麼不能留在 async 端點裡：這裡會呼叫 scanner.inspect（yfinance／幣安，
    同步網路 I/O，1~15 秒）與 GoPlus。同步阻塞跑在 event loop 上會凍住整個 uvicorn——
    那段期間**全站所有請求**（含首頁、輪詢）都沒有回應，一則訊息就能拖垮站台。

    回覆一律用 reply token（免費）。不改用 push——push 會吃掉 200 則/月的免費額度。
    reply token 有效期短，所以先回 200 給 LINE、處理放背景，不讓 LINE 因逾時重送。

    ⚠️ **每一條失敗路徑都必須回覆使用者**。舊版的 except 只印一行沒有 traceback 的字
       就繼續下一則（實測傳純空白 "   " 會在 _handle_line_text 裡 IndexError），
       使用者端看到的是「已讀不回」——與「機器人死了」完全無法區分。
    """
    # 整段包起來：這個函式是「射後不理」地丟進執行緒池的，
    # 任何漏出來的例外都只會變成 Future 裡沒人收的錯誤（訊息靜靜消失、日誌還噴警告）。
    try:
        import time as _time
        owner = os.environ.get("LINE_PUSH_TO", "").strip()
        t_body = _time.monotonic()         # 整批的起算點（reply token 的 60 秒從這之前就在跑了）
        skipped = 0
        for ev in (body.get("events") or []):
            token = None
            try:
                if not isinstance(ev, dict):
                    continue
                token = ev.get("replyToken")
                if ev.get("type") != "message" or (ev.get("message") or {}).get("type") != "text":
                    continue
                uid = ((ev.get("source") or {}).get("userId") or "").strip()
                if not owner or uid != owner:
                    continue                   # 非站主的訊息一律忽略（連回覆都不給）
                # 這則的可用預算 = min(單則上限, 整批剩餘的 token 額度)。
                # 前面幾則吃掉的時間會壓縮後面每一則——這才是「第 20 則 token 過期」的成因。
                elapsed = _time.monotonic() - t_body
                budget = min(LINE_DEADLINE_SEC,
                             LINE_TOKEN_TTL_SEC - LINE_REPLY_MARGIN_SEC - elapsed)
                if budget < LINE_MIN_BUDGET_SEC:
                    skipped += 1
                    # 預算用完就不要再開工（查完也回不出去，只是白佔 slot 與上游額度）。
                    # token 還可能活著就試著回一句；已確定超過 TTL 就只留 log——
                    # 對過期 token 硬回只會換來一串 400，而且每則都是一次對外請求。
                    if elapsed < LINE_TOKEN_TTL_SEC:
                        _line_reply(token, LINE_BACKLOG_MSG)
                    else:
                        print("LINE 事件放棄：整批已耗時 %.1fs，reply token 必定過期（%r）"
                              % (elapsed, ((ev.get("message") or {}).get("text") or "")[:40]),
                              file=sys.stderr)
                    continue
                tk = _line_slots.acquire()
                if tk is None:
                    # 忙碌時誠實回一句，而不是靜默丟掉（使用者會以為機器人壞了）。
                    # ⚠️ 要分清楚「有人在查」與「卡住了」：舊版兩者都回「請幾秒後再傳」，
                    #    但工作執行緒一旦卡死就永遠不會歸還 slot，那句話會變成
                    #    這個 bot 從此唯一的回答。
                    i = _line_slots.busy_info()
                    if i["stuck"] > i["escape_max"]:
                        _line_reply(token,
                                    "⏳ 先前有 %d 個查詢疑似卡住（最久 %.0f 秒沒回應），"
                                    "目前無法再受理。請直接到網站看：https://aimarket.trade"
                                    % (i["stuck"], i["longest_stuck_sec"] or 0.0))
                    else:
                        _line_reply(token, "⏳ 目前有其他查詢在跑，請幾秒後再傳一次。")
                    continue
                text = (ev.get("message") or {}).get("text", "")
                try:
                    fut = _line_executor().submit(_handle_line_text, text)
                except Exception:
                    _line_slots.release(tk)    # 派工失敗必須還 slot，否則永久少一格
                    raise
                # slot 由工作本身完成時歸還：逾時後那條執行緒還在跑（Python 殺不掉），
                # 這時放行新工作等於超賣併發。
                # ⚠️ 但「永遠不歸還」也不行——卡死兩次 bot 就全死了。所以歸還照舊由
                #    工作自己做，超過 _line_slots 的門檻則由逃生門放行（上限 escape_max，
                #    配合 _line_exec 的 max_workers=4 仍有界）。
                #    ticket 必須用預設參數綁進 lambda：迴圈裡的 tk 會被下一則覆寫，
                #    直接閉包會讓某一則歸還到別人的票上。
                fut.add_done_callback(lambda _f, _t=tk: _line_slots.release(_t))
                try:
                    reply = fut.result(timeout=budget)
                except Exception as e:
                    from concurrent.futures import TimeoutError as _FTimeout
                    if isinstance(e, _FTimeout):
                        print("LINE 查詢逾時（>%.1fs，整批已耗時 %.1fs）：%r"
                              % (budget, _time.monotonic() - t_body, text[:40]),
                              file=sys.stderr)
                        _line_reply(token, LINE_TIMEOUT_MSG)
                    else:
                        raise                  # 交給下面的 except 統一回覆＋印 traceback
                    continue
                _line_reply(token, reply)
            except Exception as e:
                import traceback
                print("LINE webhook 事件處理失敗：", e, file=sys.stderr)
                traceback.print_exc(file=sys.stderr)
                # 出錯也要回覆，否則使用者只看到「已讀不回」
                _line_reply(token, "⚠️ 這則訊息我處理失敗了（%s）。\n輸入 help 看用法，"
                                   "或直接到網站查：https://aimarket.trade"
                                   % type(e).__name__)
        if skipped:
            print("LINE 這批有 %d 則因超出 reply token 時限未處理（整批耗時 %.1fs）"
                  % (skipped, _time.monotonic() - t_body), file=sys.stderr)
    except Exception as e:
        import traceback
        print("LINE webhook 背景處理失敗：", e, file=sys.stderr)
        traceback.print_exc(file=sys.stderr)


# webhook 事件去重表。**有界**（OrderedDict 當 LRU）：無上限的 set 會隨訊息數永遠長大，
# 在 512MB 的免費方案上是慢性記憶體洩漏。1024 筆遠大於任何一次重送批次。
_LINE_SEEN_MAX = 1024
_line_seen = {}                              # webhookEventId -> None（dict 在 3.7+ 保序）
_line_seen_lock = threading.Lock()


def _dedup_line_events(events: list):
    """
    濾掉已處理過的事件，回傳 (要處理的, 重複的則數)。

    以 `webhookEventId`（LINE 對每個事件產生的唯一識別碼）為鍵。
    沒有這個欄位的事件一律**照常處理**——寧可重複一次，也不要因為認不出來就整則丟掉。
    """
    fresh, dup = [], 0
    with _line_seen_lock:
        for ev in events:
            eid = ev.get("webhookEventId") if isinstance(ev, dict) else None
            if not eid:
                fresh.append(ev)
                continue
            if eid in _line_seen:
                dup += 1
                continue
            _line_seen[eid] = None
            fresh.append(ev)
        while len(_line_seen) > _LINE_SEEN_MAX:
            _line_seen.pop(next(iter(_line_seen)))    # 丟最舊的
    if dup:
        print("LINE webhook 重送去重：略過 %d 則" % dup, file=sys.stderr)
    return fresh, dup


def _undo_dedup(events: list) -> None:
    """
    把「已標記為處理過」的事件退回未處理。

    去重表是在**派工之前**就寫下去的，派工若失敗（執行緒池滿、記憶體不足），
    這批事件等於既沒處理、又被記成處理過——LINE 依 at-least-once 重送過來時
    會被當成重複而丟掉，訊息就這樣無聲消失。派工失敗時務必退回。
    """
    with _line_seen_lock:
        for ev in events:
            eid = ev.get("webhookEventId") if isinstance(ev, dict) else None
            if eid:
                _line_seen.pop(eid, None)


@app.post("/api/line/webhook")
async def api_line_webhook(request: Request):
    """
    LINE webhook：讓站主直接把合約地址貼給機器人，即時回風險卡並加入監控。

    ⚠️ 三道閘，缺一不可：
      0. **body 大小上限**（LINE_MAX_BODY，預設 64KB）——**在驗簽之前**就要擋，
         否則未授權訪客送一個 10MB body 就能打爆記憶體（見 _read_body_capped）。
      1. **驗簽**（X-Line-Signature，用 LINE_CHANNEL_SECRET 做 HMAC-SHA256）——
         沒有這道，任何知道網址的人都能偽造成 LINE 送假訊息進來操作清單。
         未設 LINE_CHANNEL_SECRET 就整個停用（回 503），**不可退成「沒設就放行」**。
      2. **發話人比對**：只接受 LINE_PUSH_TO 那個 user id。
         別人把機器人加為好友也指揮不動。

    驗簽通過後**先回 200 給 LINE**（避免它重送），實際處理丟背景執行緒
    （裡面是同步網路 I/O，留在 event loop 上會凍住全站）。
    """
    import base64 as _b64
    import hashlib
    import hmac

    secret = os.environ.get("LINE_CHANNEL_SECRET", "").strip()
    if not secret:
        return JSONResponse({"ok": False, "error": "未設定 LINE_CHANNEL_SECRET，webhook 停用"},
                            status_code=503)

    raw = await _read_body_capped(request, LINE_MAX_BODY)
    if raw is None:
        return JSONResponse({"ok": False,
                             "error": "payload 過大或讀取中斷（上限 %d bytes）" % LINE_MAX_BODY},
                            status_code=413)

    sig = request.headers.get("X-Line-Signature", "")
    expect = _b64.b64encode(hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).digest()).decode()
    # _ct_eq 而非 hmac.compare_digest：簽章是訪客可控字串，含非 ASCII 時
    # compare_digest(str, str) 會拋 TypeError → 500。未授權就該是 401。
    if not (sig and _ct_eq(sig, expect)):
        return JSONResponse({"ok": False, "error": "簽章驗證失敗"}, status_code=401)

    try:
        body = json.loads(raw.decode("utf-8"))
    except Exception:
        return {"ok": True}
    if not isinstance(body, dict) or not isinstance(body.get("events") or [], list):
        return {"ok": True}                # 形狀不對就當作沒事件，不讓它在背景炸開

    # 重送去重：LINE 是 at-least-once 投遞，同一個 body 可能送兩次以上
    # （deliveryContext.isRedelivery=true），而每一則都會真的跑一次 scanner.inspect／GoPlus
    #  ——GoPlus 每分鐘只有 30 次額度，重複處理等於自己把自己打到限流。
    fresh, dup = _dedup_line_events(body.get("events") or [])
    if not fresh:
        return {"ok": True, "queued": 0, "duplicate": dup}
    body = dict(body, events=fresh)

    # 先回 200、處理丟執行緒池（不是每則訊息開一條新執行緒——那本身就是資源耗盡管道）。
    # 執行緒池是 asyncio 預設的 ThreadPoolExecutor，數量有上限；
    # 真正的重活還有 _line_slots(2) 這道閘。
    try:
        import asyncio
        asyncio.get_running_loop().run_in_executor(None, _process_line_events, body)
    except Exception as e:
        # 退回去重標記：這批既然沒被處理，就不能擋掉 LINE 的重送（見 _undo_dedup）
        _undo_dedup(fresh)
        print("LINE webhook 派工失敗：", e, file=sys.stderr)
        return JSONResponse({"ok": False, "error": "系統忙碌"}, status_code=503)
    return {"ok": True, "queued": len(body.get("events") or [])}


def _line_reply(token: str, text: str) -> bool:
    """
    用 reply token 回覆（免費，不吃 200 則/月的 push 額度）。回傳是否確定送達。

    ⚠️ 一定要看 HTTP 狀態碼。LINE 對「reply token 過期／已用過／格式錯誤」回的是
       400 `Invalid reply token`，requests 不會拋例外——舊版函式在那種情況下
       安安靜靜地正常返回、零日誌。於是「使用者收不到回覆」在伺服器端完全查不出來，
       所有其他失敗模式也一併被這層靜默放大。
    """
    if not token or not text:
        print("LINE reply 略過：%s" % ("缺 replyToken" if not token else "回覆內容為空"),
              file=sys.stderr)
        return False
    tok = os.environ.get("LINE_CHANNEL_ACCESS_TOKEN", "").strip()
    if not tok:
        print("LINE reply 略過：未設定 LINE_CHANNEL_ACCESS_TOKEN", file=sys.stderr)
        return False
    try:
        import requests
        r = requests.post("https://api.line.me/v2/bot/message/reply",
                          headers={"Authorization": f"Bearer {tok}"},
                          json={"replyToken": token,
                                "messages": [{"type": "text", "text": text[:4900]}]},
                          timeout=10)
        if r.status_code != 200:
            # body 一併記下：LINE 會講明是 token 過期、額度用盡還是訊息格式錯
            print("LINE reply 失敗 HTTP %s：%s" % (r.status_code, (r.text or "")[:300]),
                  file=sys.stderr)
            return False
        return True
    except Exception as e:
        import traceback
        print("LINE reply 例外：", e, file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return False


# ===========================================================================
# TradingView 警報 webhook
# ===========================================================================
# TradingView 的 webhook body 就是使用者在警報「Message」欄打的那串文字，
# 沒有外層信封；官方明文：內容是合法 JSON 就送 application/json，否則送 text/plain。
# 一則警報通常 <1KB，16KB 已經非常寬鬆。
TV_MAX_BODY = 16 * 1024
# /api/tv/alerts 是公開唯讀端點。冷啟動時第一次呼叫可能要去 GitHub 讀一次狀態檔
# （之後純記憶體），所以比照 _inspect_slots 設一道併發閘，避免公開網址被連打時
# 一堆執行緒同時卡在同一個網路請求上、把 FastAPI 的執行緒池吃光。
# ⚠️ 「冷啟動時第一次呼叫可能要去 GitHub 讀一次狀態檔」正是最危險的情境：
#    冷啟動當下湧進的請求會**同時**卡在同一個 GitHub 讀取上，四格一起被佔住，
#    之後這個公開端點就永久 429。門檻 60 秒：之後是純記憶體（毫秒級），
#    冷啟動那次也只有一次 GitHub 往返，60 秒不會誤殺。
_tv_read_slots = _StaleGate("tv_alerts", limit=4, stale_sec=60.0, escape_max=4)


@app.post("/api/tv/webhook")
async def api_tv_webhook(request: Request, key: str = ""):
    """
    TradingView 警報收件端。

    ⚠️ **金鑰只能放在網址 query 上，而且它是唯一防線。**
       TradingView 沒有提供任何簽章機制（官方文件只有 SSL client certificate，
       沒有 HMAC、沒有 signature header、沒有 shared secret header），
       而且警報只能設一個固定 URL、**無法自訂 HTTP 標頭**——所以密鑰沒有別的地方可放。
       後果要讓使用者看得見：密鑰一旦外流（截圖、分享網址、第三方服務日誌），
       任何人都能偽造他的警報，而偽造的內容會進帳本、也會推到他的 LINE。
       這句話同時寫在 `/api/tv/alerts` 的 `security.only_defense` 給前端顯示。
       ⚠️ query 會進 Render 的 access log —— 這是「TradingView 只能放這裡」的必然代價，
       不是我們選的；使用者若懷疑外流，換一組 TV_WEBHOOK_KEY 並改 TradingView 的網址即可。

    ⚠️ **不做來源 IP 檢查**，理由見 `tvalerts.SOURCE_IP_NOTE`：
       本站在 Render 的反向代理後面，只拿得到可被請求端偽造的 X-Forwarded-For；
       而官方那份 IP 清單沒有任何變更通知或 SLA。做出來會是「看起來有防護、其實沒有」，
       比誠實地說做不到更糟。觀察到的位址只記在日誌供事後查證，不作為判斷依據。

    ⚠️ **必須快速回應。** TradingView 官方逾時是 3 秒（超過即取消），
       而且逾時**不在**它的重送條件裡（只有回應碼 500–599 且非 504 才會 5 秒後重送、
       最多 3 次）。所以這裡只做「讀 body → 比金鑰 → 解析 → 排進佇列」，
       全程純記憶體；帳本寫入與 LINE 推播都在背景 worker。

    四道閘，順序不可調換：
      0. 未設 TV_WEBHOOK_KEY → **404 停用**（連 body 都不讀）。
      1. **body 大小上限（在比對金鑰之前）** —— 未授權訪客送一個 10MB body
         就能吃掉免費方案 512MB 的一大塊，那是不需要任何憑證的記憶體耗盡攻擊。
      2. 金鑰比對走 `_ct_eq`（定時比較；非 ASCII 的 key 要回 401 而不是 500）。
      3. 去重 + 有界佇列；佇列滿回 503，讓 TradingView 依官方規則自己重送。
    """
    try:
        import tvalerts
    except Exception as e:
        print("tvalerts 匯入失敗：", e, file=sys.stderr)
        return JSONResponse({"ok": False, "error": "TradingView 收件模組不可用"},
                            status_code=503)

    expected = tvalerts.webhook_key()
    if not expected:
        # 同 /api/cron/scan：沒設密鑰就整個停用，不可退成「沒設就放行」
        return JSONResponse({"ok": False, "msg": "未設定 TV_WEBHOOK_KEY，此端點停用"},
                            status_code=404)

    raw = await _read_body_capped(request, TV_MAX_BODY)
    if raw is None:
        return JSONResponse({"ok": False,
                             "error": "payload 過大或讀取中斷（上限 %d bytes）" % TV_MAX_BODY},
                            status_code=413)

    if not _ct_eq((key or "").strip(), expected):
        # 密鑰是唯一防線（TradingView 沒有簽章機制），所以「有人在猜」這件事必須看得見。
        # 只記次數與時間，不記猜了什麼——那等於把探測字串搬到公開端點上。
        try:
            tvalerts.note_auth_failure()
        except Exception:
            pass
        return JSONResponse({"ok": False, "error": "unauthorized"}, status_code=401)

    # 只記錄、不判斷（見上）。XFF 是請求端可控字串，長度先砍掉免得灌爆日誌。
    xff = (request.headers.get("x-forwarded-for") or "")[:120]
    peer = getattr(getattr(request, "client", None), "host", "") or ""
    try:
        res = tvalerts.intake(raw, request.headers.get("content-type", ""),
                              observed_ip=(xff or peer))
    except Exception as e:
        import traceback
        print("TradingView webhook 處理失敗：", e, file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        # 回 500 讓 TradingView 重送（官方：5xx 非 504 → 5 秒後重送、最多 3 次）。
        # 我方去重會擋掉真正的重複，所以重送是安全的。
        return JSONResponse({"ok": False, "error": "處理失敗"}, status_code=500)

    if res.get("overflow"):
        print("TradingView webhook：佇列已滿（觀察到的來源 %s）" % (xff or peer or "?"),
              file=sys.stderr)
        return JSONResponse({"ok": False, "error": "系統忙碌，請重送", **res},
                            status_code=503)
    print("TradingView webhook：收 %d 則（重複 %d）｜觀察到的來源 %s（僅供查證，未作驗證）"
          % (res.get("parsed", 0), res.get("duplicate", 0), xff or peer or "?"),
          file=sys.stderr)
    return res


@app.get("/api/tv/alerts")
def api_tv_alerts(limit: int = 30):
    """
    最近收到的 TradingView 警報（唯讀、公開）。**不含金鑰**。

    ⚠️ 回傳裡的 `raw` 是**使用者自己在 TradingView 設定的警報內容**。
       前端顯示時要 `esc()` 跳脫，並且必須標明那是他自己寫的字——
       裡面若有 BUY／LONG／進場，那不是本站的買賣建議（本站不給買賣指令）。
    ⚠️ `risk_status` 一律是 "not_evaluated"。**不可以渲染成綠燈或留白**：
       外部警報沒跑過規則引擎與七類風險檢查，「未評估」不等於「低風險」。
    """
    try:
        import tvalerts
    except Exception as e:
        return {"enabled": False, "alerts": [], "count": 0, "error": str(e)}
    tk = _tv_read_slots.acquire()
    if tk is None:
        # 空 alerts 不可以被讀成「你沒有警報」——講明是查詢受阻，並附上已卡多久。
        return JSONResponse({"enabled": True, "alerts": [], "count": 0,
                             "busy": _tv_read_slots.busy_info(),
                             "error": "查詢忙碌中：%s。這代表『這次沒查到』，"
                                      "不代表沒有警報" % _tv_read_slots.busy_note()},
                            status_code=429)
    try:
        return tvalerts.public_state(limit=limit, readonly_site=READONLY)
    except Exception as e:
        return {"enabled": True, "alerts": [], "count": 0, "error": str(e)}
    finally:
        _tv_read_slots.release(tk)


# 依「指標自身狀態」切片的影子統計。掃本機帳本分片，成本與 /api/ledger/families 同級，
# 所以比照它做 TTL 快取＋併發閘（前端 60 秒輪詢一次，又有公開唯讀訪客）。
_TV_EXT_CACHE = {"key": None, "at": 0.0, "data": None, "gen": 0}
_TV_EXT_TTL = 120.0
_tv_ext_slots = _StaleGate("tv_ext_stats", limit=2, stale_sec=120.0, escape_max=2)


@app.get("/api/tv/ext_stats")
def api_tv_ext_stats(by: str = "ext_regime", family: str = "",
                     horizon: int = 20, min_n: int = 10):
    """
    TradingView 影子訊號 **依「指標自己輸出的狀態」切片**的統計。

    這個端點回答的就是當初要保存狀態的那個問題：
    「這支系統在 BEAR 環境進場，跟在 BULL 環境進場，結果有沒有差？」

    ⚠️ `by` 的欄位全部 `ext_` 開頭 —— 那是**那支指標自己的模型**，
       與本站 `agent/regime.py` 的六標籤 regime 是兩套完全不同的定義，
       不可混用、不可互相驗證（回傳的 `not_our_regime_note` 要顯示出來）。
    ⚠️ 每一桶各自附 `sufficient`；**不足時前端只可顯示筆數，不得顯示勝率／期望值**。
    ⚠️ 桶名 MISSING（警報沒帶）與 NOT_RECORDED（本功能上線前沒記）是兩件事，
       都不是「當時沒有風險」。
    """
    global _TV_EXT_CACHE
    try:
        import tvalerts
    except Exception as e:
        return {"error": str(e), "groups": [], "n_groups": 0, "durable": False}
    # 站主若設了「公開站不顯示警報內容」，面板狀態同樣是他的警報內容，一併遮蔽。
    if READONLY and not tvalerts.alerts_public():
        return {"hidden": True, "groups": [], "n_groups": 0,
                "hidden_reason": "站主已設定不在公開站顯示警報內容（TV_ALERTS_PUBLIC=0）"}
    by = (by or "ext_regime").strip().lower()[:32]
    if by not in tvalerts.EXT_SLICE_BY:
        by = "ext_regime"
    family = (family or "").strip()[:96] or None
    horizon = _ledger_horizon(horizon)
    try:
        min_n = max(1, min(int(min_n), 500))
    except Exception:
        min_n = 10
    key = (by, family, horizon, min_n)

    now = time.time()
    c = _TV_EXT_CACHE
    if c["data"] is not None and c["key"] == key and (now - c["at"]) < _TV_EXT_TTL:
        return c["data"]
    tk = _tv_ext_slots.acquire()
    if tk is None:
        # 忙碌時回上一份（標明是舊的）。「讀不到」不可以渲染成「你沒有任何紀錄」。
        binfo = _tv_ext_slots.busy_info()
        if c["data"] is not None:
            stale = dict(c["data"])
            stale["stale"] = True
            stale["busy"] = binfo
            stale["stale_note"] = ("查詢忙碌中（%s），這是上一次的結果（可能不是最新）"
                                   % _tv_ext_slots.busy_note())
            return stale
        return JSONResponse({"error": "查詢忙碌中：%s。請稍後再試（不代表沒有紀錄）"
                                      % _tv_ext_slots.busy_note(),
                             "busy": binfo,
                             "groups": [], "n_groups": 0, "durable": False},
                            status_code=429)
    try:
        out = tvalerts.ext_slices(by=by, family=family, horizon=horizon, min_n=min_n)
    except Exception as e:
        return {"error": str(e), "groups": [], "n_groups": 0, "durable": False}
    finally:
        _tv_ext_slots.release(tk)

    # 家族名是 slug，畫面上要看得懂（對照不到就原樣顯示，不猜、不留白）
    try:
        if family:
            out["family_display"] = tvalerts.family_display(family)
    except Exception:
        pass
    out["available_by"] = list(tvalerts.EXT_SLICE_BY)
    # 世代比對（同 _LEDGER_FAM_CACHE）：卡死者醒來不得回寫，否則舊統計會被
    # 蓋上新時間戳再顯示 120 秒。
    if tk.superseded():
        print("[gate:tv_ext_stats] 丟棄過期結果 gen=%d（持有 %.0f 秒，已被逃生門取代）"
              % (tk.gen, tk.held_sec()), file=sys.stderr)
        out["stale"] = True
        out["stale_note"] = ("這次查詢耗時 %.0f 秒、期間已被逃生門判定卡死，"
                             "結果未寫入快取（可能不是最新）" % tk.held_sec())
    elif (_TV_EXT_CACHE.get("gen") or 0) > tk.gen:
        print("[gate:tv_ext_stats] 丟棄較舊世代 gen=%d（快取已是 gen=%s）"
              % (tk.gen, _TV_EXT_CACHE.get("gen")), file=sys.stderr)
    else:
        _TV_EXT_CACHE = {"key": key, "at": now, "data": out, "gen": tk.gen}
    return out


_CHAIN_HINT = {"sol": "Solana", "bsc": "BNB Chain", "base": "Base",
               "eth": "Ethereum", "tron": "Tron"}


def _guess_chain(addr: str) -> str:
    """從地址格式猜鏈。EVM 三條鏈同格式無法區分 → 回空字串要求使用者指定。"""
    a = (addr or "").strip()
    if re.match(r"^T[1-9A-HJ-NP-Za-km-z]{33}$", a):
        return "tron"
    if re.match(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$", a) and not a.startswith("0x"):
        return "sol"
    return ""                                  # 0x... 可能是 eth/bsc/base，不猜


# 「這是鏈上代幣查詢」的口語前綴。使用者實際會打「土狗 sol <地址>」「土狗幣 <地址>」，
# 舊版把整串當成標的代號去查行情 → 回「⛔「土狗」看不懂」而且地址直接被丟掉。
_CA_PREFIX = ("土狗", "土狗幣", "狗幣", "鏈上", "鏈上代幣", "合約", "ca", "meme")

_CA_USAGE = ("【查鏈上代幣風險】要「合約地址」，不能只給名字（同名仿冒極常見）。\n"
             "• 土狗 <地址>\n"
             "• 土狗 sol <地址>（0x 開頭一定要指定 eth / bsc / base）\n"
             "也可以只貼地址，我會自己判斷。")


def _handle_line_text(text: str) -> str:
    """
    解析站主傳來的訊息。

    支援：行情代號、合約地址（可加鏈名或「土狗/鏈上/合約」前綴）、list、remove <addr>、help。
    ⚠️ 任何輸入都必須回一段話。空白訊息曾在這裡 IndexError（parts[0]），
       背景執行緒吞掉例外後使用者只看到已讀不回。
    """
    t = (text or "").strip()
    if not t:
        return "（收到空白訊息）輸入代號查行情（例：2330 / AAPL / BTC），或輸入 help 看用法。"
    low = t.lower()
    if low in ("help", "說明", "?", "？"):
        return ("【查行情】直接輸入代號\n"
                "• 2330 → 台股　AAPL → 美股　BTC → 幣圈\n"
                "• 分不清時可指定：tw 2330 / us AAPL / crypto SOL\n\n"
                "【查鏈上代幣風險】貼合約地址\n"
                "• 土狗 <地址>　土狗 sol <地址>　（也可直接貼地址）\n"
                "• 0x 開頭要加鏈名，例：eth 0x...\n"
                "• 會同時加入風險監控清單\n\n"
                "【管理監控清單】\n"
                "• list → 看清單　remove <地址> → 移除\n\n"
                "⚠️ 鏈上代幣只接受合約地址，不接受代號——同名仿冒極常見")
    try:
        import onchain_watch
    except Exception as e:
        return f"系統錯誤：{e}"

    if low in ("list", "清單", "監控清單"):
        d = onchain_watch.list_tokens()
        # ⚠️ 「讀不到清單」不可以回「清單是空的」——那是謊報，而且會讓使用者
        #    以為自己沒在監控任何東西，進而重複加入（見 onchain_watch._load）。
        #    讀不到時 tokens 是 None（不是空陣列），這一條要排在空清單判斷之前。
        if d.get("error") or not isinstance(d.get("tokens"), list):
            return ("⚠️ 這次讀不到監控清單（%s）。\n"
                    "「這不代表清單是空的」，也不代表監控正常——讀不到就是不知道。\n"
                    "請稍後再試一次。" % str(d.get("error") or "格式不符預期")[:80])
        if not d["tokens"]:
            return "監控清單是空的。直接貼合約地址就會加入。"
        lines = [f"📋 監控中 {d['count']}/{d['max']} 檔"]
        for t2 in d["tokens"]:
            lines.append(f"• {_CHAIN_HINT.get(t2['chain'], t2['chain'])} "
                         f"{t2['address'][:10]}…{t2['address'][-6:]}"
                         + (f"（{t2['label']}）" if t2.get("label") else ""))
        return "\n".join(lines)

    parts = t.split()
    if parts and parts[0].lower() in ("remove", "移除", "刪除"):
        if len(parts) < 2:
            return "用法：remove <合約地址>（可再加鏈名，例：remove eth 0x...）"
        chain = parts[1].lower() if parts[1].lower() in _CHAIN_HINT else ""
        addr = parts[2] if chain and len(parts) > 2 else parts[-1]
        r = onchain_watch.remove(chain or _guess_chain(addr), addr)
        return ("✅ 已移除，剩 %d 檔" % r["count"]) if r.get("ok") else f"⛔ {r.get('error')}"

    # 口語前綴（土狗 / 鏈上 / 合約 …）：剝掉之後照「[鏈名] 地址」解析。
    # ca_forced=True 代表使用者已明說這是合約查詢 → 解析不出來時要給合約用法，
    # 不可以退回去當股票代號查（那正是舊版把地址整個丟掉的原因）。
    ca_forced = False
    if parts and parts[0].lower() in _CA_PREFIX:
        ca_forced = True
        parts = parts[1:]
        if not parts:
            return _CA_USAGE
        t = " ".join(parts)

    # 其餘視為「地址（可能前面帶鏈名）」
    chain, addr = "", t
    if len(parts) >= 2 and parts[0].lower() in _CHAIN_HINT:
        chain, addr = parts[0].lower(), parts[1]
    elif len(parts) == 1:
        if parts[0].lower() in _CHAIN_HINT:        # 只給了鏈名、沒給地址
            return _CA_USAGE
        addr = parts[0]
    elif ca_forced:
        return _CA_USAGE                           # 明說是合約查詢卻給不出可解析的地址
    else:
        # 多個字且開頭不是鏈名 → 可能是「tw 2330」「us AAPL」這種指定市場的查行情
        return _lookup_symbol(t)

    if not chain:
        chain = _guess_chain(addr)
    if not chain:
        # 是 EVM 地址但不知道哪條鏈 → 請使用者指定
        if re.match(r"^0x[0-9a-fA-F]{40}$", addr):
            return ("這是 EVM 地址，但 Ethereum / BNB Chain / Base 的地址格式一樣，我無法分辨。\n"
                    "請指定鏈，例如：\neth " + addr[:12] + "…\nbsc " + addr[:12] + "…")
        if ca_forced:
            return ("⛔ 這看起來不是合約地址：「%s」\n\n" % addr[:40]) + _CA_USAGE
        # 不是合約地址 → 當成一般標的代號查行情（台股/美股/幣圈）
        return _lookup_symbol(t)

    c, a, err = onchain_watch.normalize(chain, addr)
    if err:
        return f"⛔ {err}"

    try:
        from providers import goplus
        res = goplus.security(c, a)
    except Exception as e:
        res = None
        err = str(e)
    add = onchain_watch.add(c, a)
    if add.get("ok"):
        head = "✅ 已加入監控"
    elif add.get("status") == "state_unavailable":
        # 「已經在清單裡了」用 ℹ️ 沒問題，但「讀不到所以沒寫入」是真的沒加成功，
        # 用同一個溫和的圖示會被讀成「加好了」。這一條要顯著。
        head = ("⛔ 沒有加入監控：" + str(add.get("error"))
                + "\n（沒有寫入任何東西，你原本監控中的代幣不受影響）")
    else:
        head = "ℹ️ " + str(add.get("error"))
    return head + "\n\n" + _fmt_onchain_for_line(res, c, a)


_MKT_ALIAS = {"tw": "tw", "台股": "tw", "台": "tw",
              "us": "us", "美股": "us", "美": "us",
              "crypto": "crypto", "幣圈": "crypto", "幣": "crypto"}


def _fmt_px(v) -> str:
    """依數量級選小數位。用 %g 會把 65140 印成 6.514e+04（科學記號），使用者看不懂。"""
    try:
        v = float(v)
    except (TypeError, ValueError):
        return "—"
    a = abs(v)
    nd = 0 if a >= 1000 else (2 if a >= 1 else (4 if a >= 0.01 else 8))
    return f"{v:,.{nd}f}"


def _lookup_symbol(text: str) -> str:
    """
    一般標的查行情（台股 / 美股 / 幣圈），走 scanner.inspect —— 跟網站的即時看盤同一套。

    ⚠️ 用「回覆」不用「推播」：LINE 的回覆訊息免費，推播才算進 200 則/月的額度。
       實測雲端 inspect 只要 1~3 秒（新加坡機房離資料源近），來得及在回覆時限內完成。
    """
    parts = (text or "").split()
    if not parts:                      # 全空白（含全形空白）也要有回應，不可 IndexError
        return "（沒有看到代號）輸入 2330 / AAPL / BTC 查行情，或輸入 help 看用法。"
    market = ""
    if len(parts) >= 2 and parts[0].lower() in _MKT_ALIAS:
        market, sym = _MKT_ALIAS[parts[0].lower()], parts[1]
    else:
        sym = parts[0]
    if not _SYM_RE.match(sym):
        return f"⛔「{sym[:20]}」看不懂。輸入 help 看用法。"

    try:
        r = scanner.inspect(sym, market or None)
    except Exception as e:
        return (f"⛔ 查不到「{sym}」\n{str(e)[:120]}\n\n"
                "提示：台股用數字（2330）、美股用代號（AAPL）、幣圈用幣安代號（BTC、SOL）。\n"
                "同名時可指定市場：tw 2330 / us AAPL / crypto SOL")
    return _fmt_symbol_for_line(r)


def _fmt_symbol_for_line(r: dict) -> str:
    """把即時看盤結果排成 LINE 訊息。機會與風險並列，不合併成單一分數。"""
    name = r.get("name_zh") or r.get("name") or ""
    px = r.get("price")
    chg = r.get("day_change_pct")
    out = [f"{r.get('symbol')} {name}｜{r.get('market')}"]
    if px is not None:
        out.append(_fmt_px(px) + (f"（{chg:+.1%}）" if chg is not None else ""))
    if r.get("market_data_as_of"):
        out.append(f"行情基準 {r['market_data_as_of']} 收盤")

    rk = r.get("risk") or {}
    lvl = {"low": "低", "medium": "中", "high": "高", "critical": "極高"}.get(rk.get("risk_level"), "未評估")
    out.append(f"\n🔥 機會 {r.get('score', 0)}（多{r.get('bull_strength', 0)}／空{r.get('bear_strength', 0)}）"
               f"　🛡️ 風險 {lvl}")
    if r.get("regime_zh"):
        out.append(f"🧭 環境：{r['regime_zh']}")
    if rk.get("data_confidence"):
        zh = {"high": "高", "medium": "中", "low": "低"}.get(rk["data_confidence"], rk["data_confidence"])
        c = rk.get("counts") or {}
        out.append(f"🧪 資料信心：{zh}（風險 {c.get('risk', 0)}／無法查核 {c.get('unavailable', 0)}／共 {c.get('checked', 0)} 項）")
    if rk.get("veto"):
        out.append(f"🚫 {rk.get('status')}：{'；'.join(rk.get('veto_reasons') or [])[:120]}")

    sigs = r.get("signals") or []
    if sigs:
        out.append("\n【觸發的訊號】")
        for s in sigs[:5]:
            out.append(f"• {s.get('label')} {'★' * int(s.get('strength') or 0)}")
            for why in (s.get("reasons") or [])[:2]:
                out.append(f"　{why[:60]}")
    else:
        out.append("\n目前沒有觸發任何訊號。")

    for t in (rk.get("top_reasons") or [])[:3]:
        out.append(f"⚠ {t[:60]}")

    out.append("\n完整資料（含四時框 FIB、SOP 參考位）：https://aimarket.trade")
    out.append("客觀條件觸發，非買賣建議。")
    return "\n".join(out)


def _fmt_onchain_for_line(res, chain: str, addr: str) -> str:
    """把風險結果排成 LINE 訊息。**查不到一律講明「不等於安全」。**"""
    zh = _CHAIN_HINT.get(chain, chain)
    head = f"⛓️ {zh}\n{addr[:12]}…{addr[-8:]}\n"
    if not res or not res.get("available"):
        st = (res or {}).get("status", "unknown")
        return (head + f"\n⚠️ 無法查核（{st}）\n"
                "查不到 ≠ 安全。這類代幣的合約與籌碼風險本來就是最大的未知。")
    fl = res.get("flags") or {}
    bad = [f.get("label") or k for k, f in fl.items()
           if isinstance(f, dict) and f.get("flagged")]
    unknown = sum(1 for f in fl.values() if isinstance(f, dict) and f.get("value") is None)
    hs = res.get("holder_structure") or {}
    t10 = hs.get("top10_concentration")
    out = [head]
    out.append(("🔴 標記 " + "、".join(bad[:4])) if bad
               else f"🟢 已判定項目未標記風險（另有 {unknown} 項未提供判定）")
    if t10 is not None:
        out.append(f"前十大持有 {t10*100:.1f}%")
    lq = (res.get("liquidity") or {}).get("liquidity_usd")
    if lq:
        out.append(f"流動性 ${lq:,.0f}")
    out.append("\n未標記不等於安全；資料僅供參考，不構成投資建議。")
    return "\n".join(out)


@app.get("/api/public/overview")
def public_overview(request: Request):
    """A small public research digest from memory; never fetch on a visit."""
    from web import spot_research, public_research

    def summary(snapshot):
        if not snapshot:
            return {"status": "unavailable", "generatedAt": None, "analyzed": 0, "items": []}
        try:
            fresh = datetime.fromisoformat(snapshot["expiresAt"]).timestamp() > time.time()
        except (KeyError, TypeError, ValueError):
            fresh = False
        return {
            "status": "ready" if fresh else "stale",
            "generatedAt": snapshot.get("generatedAt"),
            "analyzed": int((snapshot.get("counts") or {}).get("analyzed") or 0),
            "items": public_research.research_items(snapshot, fresh=fresh),
        }

    with spot_research._lock:
        spot = summary(spot_research._snapshot)
    scan = public_research.scan_digest()
    derivatives = {"status": "archive" if scan["derivatives"] else "unavailable",
                   "generatedAt": scan["asOf"], "items": scan["derivatives"]}
    meme = public_research.meme_items()
    if not _owner_state(request)["owner"]:
        try:
            _, eligible = _holder_eligible(request)
        except (holder_auth.RpcUnavailable, world_auth.BridgeUnavailable):
            eligible = False
        if not eligible:
            # The teaser keeps only board status and date, never actual spot observations.
            spot = {"status": spot["status"], "generatedAt": spot["generatedAt"],
                    "analyzed": spot["analyzed"], "items": []}
    return _priv_json({"restoring": scan["restoring"], "spot": spot,
                       "derivatives": derivatives, "meme": meme})


@app.get("/api/public/quotes")
def public_quotes_snapshot():
    from web import public_quotes
    return JSONResponse(public_quotes.snapshot(),
                        headers={"Cache-Control": "public, max-age=30", "X-Content-Type-Options": "nosniff"})


@app.get("/api/public/btc")
def public_btc_board():
    from web import public_research
    return JSONResponse(public_research.btc_board(),
                        headers={"Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff"})


@app.get("/api/public/services")
def public_paid_services():
    """List planned services; on-demand runs and payments are unavailable."""
    return JSONResponse({"status": "not_available", "payment_enabled": False,
                         "services": ["crypto_inspect", "crypto_opportunities", "crypto_full_scan", "onchain_contract", "imd_daily_refresh"]},
                        headers={"Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff"})


@app.post("/api/imd-daily/ingest")
async def imd_daily_ingest(request: Request):
    """Receive a bounded report from the independent, scheduled VPS collector."""
    from web import imd_daily
    if not imd_daily.authorized(request.headers.get("Authorization")):
        return _priv_json({"error": "unauthorized"}, status=401)
    if not request.headers.get("Content-Type", "").lower().startswith("application/json"):
        return _priv_json({"error": "json_required"}, status=415)
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > imd_daily.MAX_BYTES:
            return _priv_json({"error": "invalid_or_oversized_body"}, status=400)
        chunks.append(chunk)
    try:
        raw = b"".join(chunks).decode("utf-8", errors="strict")
        report = json.loads(raw)
        if not imd_daily.valid_report(report):
            return _priv_json({"error": "invalid_report"}, status=422)
    except (UnicodeError, ValueError, TypeError, KeyError):
        return _priv_json({"error": "invalid_report"}, status=422)
    try:
        stored = await run_in_threadpool(imd_daily.ingest, report, raw)
    except (OSError, sqlite3.Error):
        return _priv_json({"error": "receiver_unavailable"}, status=503)
    if not stored:
        return _priv_json({"error": "report_id_conflict"}, status=409)
    return _priv_json({"ok": True, "report_id": report["report_id"]})


@app.post("/api/new-tokens/ingest")
async def new_tokens_ingest(request: Request):
    """Receive the rolling IMD watch without changing the previous-day daily report."""
    from web import imd_daily
    if not imd_daily.authorized(request.headers.get("Authorization")):
        return _priv_json({"error": "unauthorized"}, status=401)
    if not request.headers.get("Content-Type", "").lower().startswith("application/json"):
        return _priv_json({"error": "json_required"}, status=415)
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > imd_daily.MAX_BYTES:
            return _priv_json({"error": "invalid_or_oversized_body"}, status=400)
        chunks.append(chunk)
    try:
        raw = b"".join(chunks).decode("utf-8", errors="strict")
        report = json.loads(raw)
        if not imd_daily.valid_new_token_report(report):
            return _priv_json({"error": "invalid_report"}, status=422)
        captured_day = datetime.fromisoformat(report["captured_at"].replace("Z", "+00:00")).astimezone(timezone(timedelta(hours=8))).date().isoformat()
        if report["report_date"] != captured_day:
            return _priv_json({"error": "invalid_report"}, status=422)
    except (UnicodeError, ValueError, TypeError, KeyError):
        return _priv_json({"error": "invalid_report"}, status=422)
    try:
        stored = await run_in_threadpool(imd_daily.ingest_new_tokens, report, raw)
    except (OSError, sqlite3.Error):
        return _priv_json({"error": "receiver_unavailable"}, status=503)
    if not stored:
        return _priv_json({"error": "report_id_conflict"}, status=409)
    return _priv_json({"ok": True, "report_id": report["report_id"]})


@app.get("/api/new-tokens/latest")
def new_tokens_latest():
    from web import imd_daily
    try:
        report = imd_daily.latest_new_tokens()
    except (OSError, sqlite3.Error):
        return _priv_json({"error": "receiver_unavailable"}, status=503)
    return _priv_json(report) if report else _priv_json({"error": "no_report_yet"}, status=404)


@app.get("/api/new-tokens/preview")
def new_tokens_preview():
    """No symbol, address, pool metric or project detail in the anonymous teaser."""
    from web import imd_daily
    try:
        report = imd_daily.latest_new_tokens()
    except (OSError, sqlite3.Error):
        return _priv_json({"error": "receiver_unavailable"}, status=503)
    if not report:
        return _priv_json({"error": "no_report_yet"}, status=404)
    counts = report.get("counts") or {}
    return _priv_json({"report_date": report.get("report_date"),
                       "captured_at": report.get("captured_at"),
                       "quality": report.get("quality"),
                       "counts": {"records": counts.get("records"),
                                  "tokens": counts.get("unique_live_tokens")}})


@app.get("/api/imd-daily/history")
def imd_daily_history(limit: int = 30):
    from web import imd_daily
    try:
        dates = imd_daily.history(min(90, max(1, limit)))
    except (OSError, sqlite3.Error):
        return _priv_json({"error": "receiver_unavailable"}, status=503)
    return _priv_json({"dates": dates})


@app.get("/api/imd-daily/latest")
def imd_daily_latest():
    from web import imd_daily
    try:
        report = imd_daily.latest()
    except (OSError, sqlite3.Error):
        return _priv_json({"error": "receiver_unavailable"}, status=503)
    return _priv_json(report) if report else _priv_json({"error": "no_report_yet"}, status=404)


@app.get("/api/imd-daily/preview")
def imd_daily_preview():
    """Public report metadata only; no token, pool, rationale, or project data."""
    from web import imd_daily
    try:
        report = imd_daily.latest()
    except (OSError, sqlite3.Error):
        return _priv_json({"error": "receiver_unavailable"}, status=503)
    if not report:
        return _priv_json({"error": "no_report_yet"}, status=404)
    counts = report.get("counts") or {}
    return _priv_json({"report_date": report.get("report_date"),
                       "captured_at": report.get("captured_at"),
                       "quality": report.get("quality"),
                       "counts": {"records": counts.get("records"),
                                  "indexed": counts.get("indexed")}})


@app.get("/api/imd-daily/previous/{report_id}")
def imd_daily_previous(report_id: str):
    from web import imd_daily

    if not imd_daily.REPORT_ID.fullmatch(report_id):
        raise HTTPException(status_code=404, detail="Report not found")
    try:
        result = imd_daily.previous_observations(report_id)
    except (OSError, sqlite3.Error):
        return _priv_json({"error": "receiver_unavailable"}, status=503)
    return _priv_json(result) if result else _priv_json({"error": "no_report_yet"}, status=404)


@app.get("/api/imd-daily/{day}")
def imd_daily_by_date(day: str):
    from web import imd_daily
    if not imd_daily._date(day):
        raise HTTPException(status_code=404, detail="Report date not found")
    try:
        report = imd_daily.for_date(day)
    except (OSError, sqlite3.Error):
        return _priv_json({"error": "receiver_unavailable"}, status=503)
    return _priv_json(report) if report else _priv_json({"error": "no_report_yet"}, status=404)


@app.get("/api/public/assets/{asset}/research")
def public_asset_research(asset: str):
    if asset not in ("BTC", "ETH"):
        raise HTTPException(status_code=404, detail="Asset not published")
    from web import public_assets
    return JSONResponse(public_assets.research(asset),
                        headers={"Cache-Control": "public, max-age=30", "X-Content-Type-Options": "nosniff"})


@app.get("/api/public/assets/{asset}/chart")
def public_asset_chart(asset: str, interval: str = "1d"):
    if asset not in ("BTC", "ETH") or interval not in ("1d", "4h"):
        raise HTTPException(status_code=404, detail="Chart not published")
    from web import public_assets
    return JSONResponse(public_assets.chart(asset, interval),
                        headers={"Cache-Control": "public, max-age=30", "X-Content-Type-Options": "nosniff"})


@app.get("/public/hero.jpg")
def public_hero():
    return FileResponse(WEB / "public" / "hero.jpg", media_type="image/jpeg",
                        headers={"Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff"})


@app.get("/public/app.js")
def public_script():
    return FileResponse(WEB / "public" / "app.js", media_type="text/javascript",
                        headers={"Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff"})


@app.get("/public/holder-access.js")
def public_holder_access_script():
    return FileResponse(WEB / "public" / "holder-access.js", media_type="text/javascript",
                        headers={"Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff"})


@app.get("/public/holder-access.css")
def public_holder_access_style():
    return FileResponse(WEB / "public" / "holder-access.css", media_type="text/css",
                        headers={"Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff"})


@app.get("/public/research-detail.js")
def public_research_detail_script():
    return FileResponse(WEB / "public" / "research-detail.js", media_type="text/javascript",
                        headers={"Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff"})


@app.get("/public/research-detail.css")
def public_research_detail_style():
    return FileResponse(WEB / "public" / "research-detail.css", media_type="text/css",
                        headers={"Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff"})


@app.get("/public/site.css")
def public_site_style():
    return FileResponse(WEB / "public" / "site.css", media_type="text/css",
                        headers={"Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff"})


@app.get("/public/imd-daily.css")
def public_imd_daily_style():
    return FileResponse(WEB / "public" / "imd-daily.css", media_type="text/css",
                        headers={"Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff"})


@app.get("/public/imd-daily.js")
def public_imd_daily_script():
    return FileResponse(WEB / "public" / "imd-daily.js", media_type="text/javascript",
                        headers={"Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff"})


@app.get("/public/new-tokens.css")
def public_new_tokens_style():
    return FileResponse(WEB / "public" / "new-tokens.css", media_type="text/css",
                        headers={"Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff"})


@app.get("/public/new-tokens.js")
def public_new_tokens_script():
    return FileResponse(WEB / "public" / "new-tokens.js", media_type="text/javascript",
                        headers={"Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff"})


@app.get("/public/vendor/lightweight-charts-5.2.1.js")
def public_lightweight_charts():
    return FileResponse(WEB / "public" / "vendor" / "lightweight-charts-5.2.1.js", media_type="text/javascript",
                        headers={"Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"})


@app.get("/public/player.css")
def public_player_style():
    return FileResponse(WEB / "public" / "player.css", media_type="text/css",
                        headers={"Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff"})


@app.get("/public/gate.css")
def public_gate_style():
    return FileResponse(WEB / "public" / "gate.css", media_type="text/css",
                        headers={"Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff"})


@app.get("/public/gate.js")
def public_gate_script():
    return FileResponse(WEB / "public" / "gate.js", media_type="text/javascript",
                        headers={"Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff"})


@app.get("/public/audio/{track_name}")
def public_music_track(track_name: str):
    tracks = {
        "neon-evidence-ae953aad.mp3",
        "pixel-brain-sprint-1a9aa09f.mp3",
        "after-the-bell-cd0142d5.mp3",
        "zero-brain-bounce-c29a52f2.mp3",
        "signal-scan-d4374475.mp3",
        "neon-evidence-16f526e4.mp3",
    }
    if track_name not in tracks:
        raise HTTPException(status_code=404, detail="Track not found")
    return FileResponse(WEB / "public" / "audio" / track_name, media_type="audio/mpeg",
                        headers={"Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff"})


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    owner = _owner_state(request)["owner"]
    if not owner or request.query_params.get("view") == "public":
        try:
            address, eligible = _holder_eligible(request)
        except (holder_auth.RpcUnavailable, world_auth.BridgeUnavailable):
            address = None
            eligible = False
        source = (WEB / "public" / "index.html").read_text(encoding="utf-8")
        access = "verified" if eligible else "preview"
        source = source.replace("<body>", '<body data-holder-access="' + access + '" data-world-auth="'
            + ("enabled" if world_auth.enabled() else "disabled") + '" data-holder-source="'
            + ("world" if world_auth.COOKIE in request.cookies else "wallet") + '" data-holder-address="'
            + (address or "") + '" data-world-portal="' + ("1" if getattr(request.state, "world_portal", False) else "0") + '">', 1)
        if getattr(request.state, "world_portal", False):
            source = source.replace('<details class="login">', '<details class="login" hidden>', 1)
            # A previous research cookie must not start private browser reads
            # before the enclosing World resolves its current wallet context.
            source = source.replace('<main>', '<main hidden data-portal-pending="1">', 1)
            for script in ("app", "research-detail", "imd-daily", "new-tokens"):
                source = source.replace('<script src="/public/' + script + '.js',
                    '<script type="text/plain" data-portal-src="/public/' + script + '.js', 1)
        return HTMLResponse(source,
                            headers={"Cache-Control": "no-store", "Vary": "Cookie",
                                     "X-Content-Type-Options": "nosniff"})
    bundle = WEB / "desk" / "index.html"
    if bundle.is_file():
        return HTMLResponse(bundle.read_text(encoding="utf-8"),
                            headers={"Cache-Control": "no-store, private", "Vary": "Cookie"})
    return research_tools()


@app.get("/research-tools", response_class=HTMLResponse)
def research_tools(embed: str = "0", section: str = "strategy"):
    """Reuse the existing workflows inside the new presentation. Never auto-scan."""
    source = (WEB / "static" / "index.html").read_text(encoding="utf-8")
    # Set before the legacy boot script. Merely opening a page must not start a scan.
    head = '<script>window._autoScanned=true;</script>'
    if embed == "1":
        allowed = {"strategy", "scan", "indicators", "risk", "candidates", "intel", "records", "all-records"}
        section = section if section in allowed else "strategy"
        source = source.replace('<body>', '<body data-desk-embed="1" data-desk-section="' + section + '">', 1)
        head += '<link rel="stylesheet" href="/static/desk-embed.css?v=1"><script src="/static/desk-embed.js?v=1" defer></script>'
    head += '<link rel="stylesheet" href="/static/desk-emerald.css?v=20261012"><script src="/desk/desk-i18n.js?v=20261012" defer></script>'
    source = source.replace('</head>', head + '</head>', 1)
    return HTMLResponse(source, headers={"Cache-Control": "no-store", "X-Frame-Options": "SAMEORIGIN", "Content-Security-Policy": "frame-ancestors 'self'"})


@app.get("/portal-result", response_class=HTMLResponse)
def portal_result(request: Request):
    if not getattr(request.state, "world_portal", False):
        raise HTTPException(status_code=404)
    return HTMLResponse((WEB / "public" / "portal-result.html").read_text(encoding="utf-8"), headers={"Cache-Control": "no-store"})


@app.get("/public/portal-result.js")
def portal_result_script():
    return FileResponse(WEB / "public" / "portal-result.js", media_type="text/javascript", headers={"Cache-Control": "no-store"})


@app.get("/api/desk/notifications")
def desk_notifications(request: Request):
    """Owner-only configuration/health read. No LINE API calls, quota queries or sends."""
    if not _owner_state(request)["owner"]:
        return _priv_json({"owner_only": True}, status=401)
    health, health_error, ledger_configured = [], None, False
    try:
        import ledger
        ledger_configured = bool(ledger._token() and ledger._repo_slug())
        state, err = ledger.load_state("line_push_health", {"events": []})
        if err: health_error = "unavailable"
        else:
            for event in (state.get("events") or [])[-10:]:
                if isinstance(event, dict):
                    # Do not expose raw LINE errors, message previews or receiver IDs.
                    health.append({k: event.get(k) for k in ("at", "kind", "note")})
    except Exception:
        health_error = "unavailable"
    configured = lambda name: bool(os.environ.get(name, "").strip())
    return _priv_json({"line_configured": configured("LINE_CHANNEL_ACCESS_TOKEN"),
                       "recipient_configured": configured("LINE_PUSH_TO"),
                       "cron_configured": configured("CRON_KEY"),
                       "tradingview_configured": configured("TV_WEBHOOK_KEY"),
                       "ledger_configured": ledger_configured,
                       "health": list(reversed(health)), "health_error": health_error,
                       "note": "已設定不代表已確認送達。實際發送仍依原有事件差異、每日去重、額度與收件對象設定執行。"})


@app.get("/api/desk/derivatives/btc")
def desk_btc_contracts():
    from web import btc_contracts
    return _priv_json(btc_contracts.snapshot())


@app.get("/api/desk/derivatives/coinbase")
def desk_coinbase_flow():
    from web import coinbase_flow
    return _priv_json(coinbase_flow.snapshot())


@app.get("/api/desk/derivatives/tradingview")
def desk_btc_tradingview():
    from web import btc_tradingview
    return _priv_json(btc_tradingview.snapshot())


@app.get("/api/desk/derivatives/sources")
def desk_btc_sources():
    from web import coinbase_flow, btc_tradingview, cmc_context
    return _priv_json(dict(coinbase=coinbase_flow.snapshot(), tradingview=btc_tradingview.snapshot(), coinmarketcap=cmc_context.snapshot()))


@app.get("/api/desk/derivatives/tradingview/bridge.pine")
def desk_btc_bridge():
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse((Path(__file__).resolve().parents[1]/'integrations/tradingview/btc_daily_bridge.pine').read_text(encoding='utf-8'),
                             headers={'Cache-Control':'no-store'})


@app.post("/api/desk/derivatives/tradingview/webhook")
async def desk_btc_tradingview_webhook(request: Request, key: str = ""):
    from web import btc_tradingview
    expected = btc_tradingview.webhook_key()
    if not expected:
        return _priv_json({"error": "not_configured"}, status=404)
    raw = await _read_body_capped(request, btc_tradingview.MAX_BODY)
    if raw is None:
        return _priv_json({"error": "payload_too_large"}, status=413)
    if not _ct_eq(key, expected):
        return _priv_json({"error": "unauthorized"}, status=401)
    try:
        result = await btc_tradingview.intake(raw)
    except (ValueError, TypeError, KeyError, OverflowError):
        return _priv_json({"error": "invalid_closed_btc_daily_payload"}, status=422)
    return _priv_json(result, status=200 if result['persisted'] else 503)


@app.get("/api/desk/derivatives/context")
def desk_btc_position_context():
    from web import btc_position_context
    return _priv_json(btc_position_context.snapshot())


@app.get("/api/desk/derivatives/notifications")
def desk_btc_contract_notifications(request: Request, month: str = ""):
    if not _owner_state(request)["owner"]:
        return _priv_json({"owner_only": True}, status=401)
    if request.headers.get("sec-fetch-site") == "cross-site":
        return _priv_json({"error": "請從本站讀取通知紀錄"}, status=403)
    from web import btc_contracts, legacy_signals
    try:
        month = month or datetime.now(legacy_signals.TZ).strftime("%Y-%m")
        return _priv_json(btc_contracts.notifications(month))
    except ValueError:
        return _priv_json({"error": "月份格式應為 YYYY-MM"}, status=400)


@app.get("/api/desk/line-signals")
def desk_line_signals(request: Request, month: str = ""):
    if not _owner_state(request)["owner"]:
        return _priv_json({"owner_only": True}, status=401)
    if request.headers.get("sec-fetch-site") == "cross-site":
        return _priv_json({"error": "請從本站讀取通知紀錄"}, status=403)
    from web import legacy_signals
    try:
        if not month:
            month = datetime.now(legacy_signals.TZ).strftime("%Y-%m")
        return _priv_json(legacy_signals.messages(month))
    except ValueError:
        return _priv_json({"error": "月份格式應為 YYYY-MM"}, status=400)


@app.post("/api/desk/line-signals/import")
async def desk_import_line_signal(request: Request):
    if not _owner_state(request)["owner"]:
        return _priv_json({"owner_only": True}, status=401)
    if request.headers.get("sec-fetch-site") == "cross-site":
        return _priv_json({"error": "請從本站補存通知"}, status=403)
    from web import legacy_signals
    try:
        raw = await request.body()
        if len(raw) > 85000:
            return _priv_json({"error": "通知原文過長"}, status=400)
        body = json.loads(raw)
        if not isinstance(body, dict):
            raise ValueError("通知格式錯誤")
        from starlette.concurrency import run_in_threadpool
        result = await run_in_threadpool(legacy_signals.import_receipt, body.get("text"), body.get("scanAt"))
        return _priv_json(result)
    except (ValueError, TypeError) as exc:
        return _priv_json({"error": str(exc)[:100]}, status=400)
    except Exception:
        return _priv_json({"error": "私人備份暫時無法寫入；本次未確認補存，請稍後再試"}, status=503)


from web.desk_quotes import router as desk_router
app.include_router(desk_router)
from web.spot_research import router as spot_research_router
app.state.research_owner_check = lambda request: _owner_state(request)['owner']
app.include_router(spot_research_router)
from web.equity_research import router as equity_research_router
app.include_router(equity_research_router)

@app.get("/api/desk/onchain/discovery")
def desk_onchain_discovery(request: Request, chain: str = "hood", refresh: bool = False):
    # A read is not a failed login attempt. Reuse the same signed owner session,
    # without exposing private intelligence or consuming paid quota for visitors.
    if not _owner_state(request)["owner"]:
        return _priv_json({"owner": False, "error": "請先登入站主帳號，再讀取鏈上早期發現。"}, status=401)
    if request.headers.get("sec-fetch-site") == "cross-site":
        return _priv_json({"error": "請從本站開啟研究。"}, status=403)
    from web.onchain_research import snapshot, CHAINS
    from web.onchain_analysis import canonical_chain
    chain=canonical_chain(chain)
    if chain not in CHAINS:
        return _priv_json({"error": "不支援的鏈"}, status=400)
    return _priv_json(snapshot(chain, refresh))
@app.get("/api/desk/research/journal")
def desk_research_journal(request: Request, market: str = "meme", chain: str = "hood",
                          offset: int = 0, limit: int = 24, query: str = "", alerts_only: bool = False):
    if not _owner_state(request)["owner"]:
        return _priv_json({"owner": False, "error": "請先登入站主帳號，再讀取研究紀錄。"}, status=401)
    if request.headers.get("sec-fetch-site") == "cross-site":
        return _priv_json({"error": "請從本站開啟研究。"}, status=403)
    from web import research_journal
    from web.onchain_analysis import canonical_chain
    try:
        return _priv_json(research_journal.view(market, canonical_chain(chain),
            offset=offset, limit=limit, query=query, alerts_only=alerts_only))
    except ValueError:
        return _priv_json({"error": "不支援的研究市場"}, status=400)


@app.get("/api/desk/radar")
def desk_radar(request: Request):
    from web.onchain_radar import snapshot
    return _priv_json(snapshot(owner=_owner_state(request)['owner']))


@app.get('/api/desk/research/events')
def desk_research_events(request: Request, asset: str='BTC'):
    if not _owner_state(request)['owner']:return _priv_json({'error':'請先登入站主帳號。'},status=401)
    if request.headers.get('sec-fetch-site')=='cross-site':return _priv_json({'error':'請從本站開啟。'},status=403)
    from web.research_events import view
    try:return _priv_json(view(asset))
    except Exception:return _priv_json({'error':'私人事件紀錄暫時無法讀取。'},status=503)


@app.post('/api/desk/research/events')
def desk_save_research_event(request: Request, values: dict=Body(...)):
    if not _owner_state(request)['owner']:return _priv_json({'error':'請先登入站主帳號。'},status=401)
    if request.headers.get('sec-fetch-site')=='cross-site':return _priv_json({'error':'請從本站儲存。'},status=403)
    from web.research_events import save,validate
    try:validate(values)
    except Exception:return _priv_json({'error':'請檢查事件日期、來源與數量格式。'},status=400)
    try:return _priv_json({'event':save(values)})
    except Exception:return _priv_json({'error':'事件尚未儲存，請檢查私人備份連線。'},status=503)


@app.post("/api/desk/radar/settings")
def desk_radar_settings(request: Request, values: dict = Body(...)):
    if not _owner_state(request)['owner']:
        return _priv_json({'error':'請先登入站主帳號。'},status=401)
    if request.headers.get('sec-fetch-site')=='cross-site':
        return _priv_json({'error':'請從本站調整通知。'},status=403)
    from web import radar_alerts
    try:return _priv_json({'config':radar_alerts.configure(values)})
    except ValueError as exc:
        return _priv_json({'error':'設定未儲存，請檢查私人備份連線後重試。' if str(exc)=='private_storage_unavailable' else '通知設定格式不正確。'},status=503 if str(exc)=='private_storage_unavailable' else 400)


@app.get("/api/desk/onchain/dossier")
def desk_onchain_dossier(request: Request, chain: str = "hood", ca: str = ""):
    if not _owner_state(request)["owner"]:
        return _priv_json({"owner": False, "error": "請先登入站主帳號，再查核開發者與籌碼。"}, status=401)
    if request.headers.get("sec-fetch-site") == "cross-site":
        return _priv_json({"error": "請從本站開啟研究。"}, status=403)
    from web.onchain_analysis import canonical_chain, address, CHAINS
    from web.onchain_dossier import snapshot
    chain=canonical_chain(chain)
    ca=address(chain,ca)
    if chain not in CHAINS or not ca:
        return _priv_json({"error": "鏈或完整合約格式不正確"}, status=400)
    return _priv_json(snapshot(chain,ca))


if (WEB / "desk").is_dir():
    app.mount("/desk", StaticFiles(directory=str(WEB / "desk")), name="desk")


# 靜態檔（若日後有額外資源）
(WEB / "static").mkdir(parents=True, exist_ok=True)
# ═══════════════════════════════════════════════════════════════════════════
# 改版預覽（站主專屬）
# ═══════════════════════════════════════════════════════════════════════════
# 改版是主觀的，要先看過再決定換不換。這條路讓站主在自己手機上看新版原型，
# 而現行網站完全不受影響。
#
# ⚠️ 檔案刻意放 `web/preview/` **不是** `web/static/`：後者被 StaticFiles 遞迴
#    公開提供，把原型丟進去等於把裡面的真實持倉（鏈上代幣、watchlist、帳本數字）
#    公開給任何人——那正是 2026-09-02 修掉的那個外洩。
# ⚠️ 一律走站主閘門 ＋ no-store ＋ noindex。查不到檔案回 404 而不是空白頁：
#    空白頁會被讀成「原型壞了」，404 才講得清楚是「這裡沒有東西」。
@app.get("/preview/{name}", response_class=HTMLResponse)
def api_preview(request: Request, name: str):
    st = _owner_state(request)
    if not st["owner"]:
        # 401 頁自己就能登入。原本只給一個「回首頁」的連結，等於要使用者
        # 跳過去、捲到頁尾、找一個灰色小字——被擋在門外還要自己找鑰匙孔。
        # 金鑰一樣只走 POST body，登入成功就地重載，不進網址、不存 localStorage。
        return HTMLResponse(
            "<meta charset=utf-8>"
            "<meta name=viewport content='width=device-width,initial-scale=1'>"
            "<title>需要站主登入</title>"
            "<div style=\"font:16px/1.75 system-ui,-apple-system,'PingFang TC',sans-serif;"
            "max-width:26em;margin:14vh auto;padding:0 7vw;color:#2b2230\">"
            "<h1 style=\"font-size:20px;margin:0 0 .6em\">🔒 改版預覽僅站主可見</h1>"
            "<p style=\"margin:0 0 1.4em\">這份原型裡有真實的持倉與帳本數字，所以不對外公開。</p>"
            "<form onsubmit=\"return go(event)\" style=\"display:flex;gap:8px\">"
            "<input id=k type=password autocomplete=current-password placeholder='站主金鑰' "
            "style=\"flex:1;min-width:0;padding:12px;border:1.5px solid #e6d5e0;border-radius:10px;"
            "font-size:16px;background:#fff\">"
            "<button style=\"padding:12px 18px;border:0;border-radius:10px;background:#9F2058;"
            "color:#fff;font-size:15px;cursor:pointer\">登入</button></form>"
            "<p id=m style=\"min-height:1.6em;color:#b3261e;margin:.9em 0 0;font-size:14px\"></p>"
            "<p style=\"color:#7a6b78;font-size:13px;margin-top:1.6em\">"
            + _html.escape(st.get("note") or "") +
            "</p><p style=\"font-size:14px\"><a href=\"/\" style=\"color:#7043b8\">← 回到現行網站</a></p></div>"
            "<script>async function go(e){e.preventDefault();"
            "var k=document.getElementById('k'),m=document.getElementById('m');"
            "m.style.color='#7a6b78';m.textContent='登入中…';"
            "try{var r=await fetch('/api/owner/login',{method:'POST',"
            "headers:{'Content-Type':'application/json'},credentials:'same-origin',"
            "cache:'no-store',body:JSON.stringify({key:k.value})});"
            "var d=await r.json().catch(function(){return {};});k.value='';"
            "if(r.ok&&d.ok){m.style.color='#14683F';m.textContent='登入成功，載入中…';"
            "location.reload();return false;}"
            "m.style.color='#b3261e';"
            "m.textContent=(d.retry_after_seconds?('嘗試太多次，請等 '+d.retry_after_seconds+' 秒'):"
            "(d.error||'金鑰錯誤'));}"
            "catch(err){m.style.color='#b3261e';"
            "m.textContent='連不上伺服器 ——「連不上」不等於「金鑰錯」。';}"
            "return false;}</script>",
            status_code=401, headers=dict(_PRIVATE_HEADERS))
    # 路徑穿越防護：只接受單純檔名，且必須落在 preview 目錄內
    safe = re.sub(r"[^A-Za-z0-9_.-]", "", name or "")
    if not safe or safe.startswith(".") or not safe.endswith(".html"):
        return HTMLResponse("找不到這份預覽", status_code=404,
                            headers=dict(_PRIVATE_HEADERS))
    f = (WEB / "preview" / safe).resolve()
    try:
        f.relative_to((WEB / "preview").resolve())
    except Exception:
        return HTMLResponse("找不到這份預覽", status_code=404,
                            headers=dict(_PRIVATE_HEADERS))
    if not f.is_file():
        return HTMLResponse("找不到這份預覽：" + _html.escape(safe), status_code=404,
                            headers=dict(_PRIVATE_HEADERS))
    return HTMLResponse(f.read_text(encoding="utf-8"),
                        headers=dict(_PRIVATE_HEADERS))


app.mount("/static", StaticFiles(directory=str(WEB / "static")), name="static")


# 註：不做開機自動掃描——免費方案 CPU 弱(0.1)，開機掃描會跟訪客請求搶 CPU 造成卡頓。
# 首次由訪客按「重新掃描」觸發即可。
