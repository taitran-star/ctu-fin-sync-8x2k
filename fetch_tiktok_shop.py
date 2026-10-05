#!/usr/bin/env python3
"""
Cattasaurus - TikTok Shop (Open API, custom self-authorized app) -> data/tiktok_shop.json

Nối thẳng TikTok Shop Open API (app "Cattasaurus P&L Sync", custom app, self-authorized -
seller và app owner là cùng 1 người nên không cần OAuth consent từ bên thứ 3). Xem toàn bộ
quá trình đăng ký app, luồng OAuth, endpoint đã xác nhận trong claude/tiktok-shop-integration.md
(project Finance). KHÔNG qua AfterShip hay bất kỳ connector trung gian nào.

Auth (2 tầng):
  1. Access token: refresh mỗi lần chạy từ TIKTOK_REFRESH_TOKEN (dài hạn, gần như không hết
     hạn) qua auth.tiktok-shops.com/api/v2/token/refresh - endpoint này KHÔNG cần ký HMAC.
  2. Mọi API data (host open-api.tiktokglobalshop.com) cần ký HMAC-SHA256: base string =
     app_secret + path + (tham số query sort theo key, nối "key"+"value", LOẠI sign và
     access_token) + body + app_secret; HMAC key = app_secret; hex lowercase. access_token gửi
     qua HEADER x-tts-access-token (xác nhận 2026-10-04: gửi qua query param bị TikTok từ chối
     với lỗi "x-tts-access-token header is invalid" - PHẢI là header).

Required env (GitHub Actions Secrets):
  TIKTOK_APP_KEY, TIKTOK_APP_SECRET; TIKTOK_REFRESH_TOKEN only seeds the very first run -
  after that the newest (rotating) tokens live in data/tiktok_shop_state.enc, encrypted with a
  key derived from TIKTOK_APP_SECRET. TIKTOK_AUTH_CODE (Run-workflow input) = one-off re-authorization.
  Needs `pip install cryptography` (done in the workflow).
Optional:
  REPORT_TIMEZONE   default America/Los_Angeles (chuẩn chung toàn dashboard)
  OUTPUT_PATH       default data/tiktok_shop.json
  HISTORY_START     default 2025-01-01 - ngày cũ hơn window hiện tại được giữ nguyên từ file cũ
  WINDOW_DAYS       default 45 - khoảng lùi lại mỗi lần chạy thường (không backfill)
  BACKFILL_START / BACKFILL_END   chạy tay (workflow_dispatch) cho 1 khoảng ngày quá khứ cụ thể

Output: daily.<date> (America/Los_Angeles) tổng hợp từ TikTok Shop Finance "statements"
(kỳ quyết toán - gross/fees/net_settlement), tương tự cách Amazon settlement report được dùng
trong P&L này. CHƯA lấy doanh thu đơn hàng theo ngày thật (cần Orders API, scope seller.order.info
đã có sẵn nhưng để version sau) - xem meta.limitation.

QUAN TRỌNG - việc tiếp theo cần làm nếu lần chạy đầu lỗi: TikTok Shop Finance API endpoint path
chính xác (/finance/202309/statements) được suy ra từ nhiều SDK bên thứ 3 khớp nhau (laraditz/tiktok,
docs.datavirtuality.com) nhưng CHƯA test trực tiếp được (mạng của Claude + máy user bị egress policy
chặn domain TikTok - xem claude/tiktok-shop-integration.md). Nếu GitHub Actions log báo lỗi 404 hay
"path not found", đó là việc cần sửa đầu tiên - không phải lỗi auth/sign.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None

SCRIPT_VERSION = "tiktok_shop-1.5"
SCHEMA = 1

AUTH_HOST = "https://auth.tiktok-shops.com"
API_HOST = "https://open-api.tiktokglobalshop.com"
API_VERSION = "202309"

APP_KEY = os.environ.get("TIKTOK_APP_KEY", "").strip()
APP_SECRET = os.environ.get("TIKTOK_APP_SECRET", "").strip()
REFRESH_TOKEN = os.environ.get("TIKTOK_REFRESH_TOKEN", "").strip()

OUTPUT_PATH = os.environ.get("OUTPUT_PATH", "data/tiktok_shop.json")
TZ_NAME = os.environ.get("REPORT_TIMEZONE", "America/Los_Angeles").strip() or "America/Los_Angeles"
TZ = ZoneInfo(TZ_NAME) if ZoneInfo else timezone.utc

HISTORY_START = os.environ.get("HISTORY_START", "2025-01-01").strip() or "2025-01-01"
WINDOW_DAYS = int(os.environ.get("WINDOW_DAYS", "45"))
BACKFILL_START = os.environ.get("BACKFILL_START", "").strip()
BACKFILL_END = os.environ.get("BACKFILL_END", "").strip()

# Token state. TikTok ROTATES the refresh_token on every refresh (confirmed by run #2, 2026-10-04),
# and a GitHub Action cannot write a repo secret, so the newest tokens are kept in this file,
# ENCRYPTED (Fernet = AES-128-CBC + HMAC-SHA256) with a key derived from TIKTOK_APP_SECRET. The
# repo is public, the file is unreadable without the app secret. The access token (valid ~7 days)
# is cached here too, so a refresh - and a rotation - happens about once a week, not every run.
STATE_PATH = os.environ.get("STATE_PATH", "data/tiktok_shop_state.enc")
# One-off: paste the code (or the whole redirect URL) from a fresh authorization into the
# "Run workflow" form. The Action exchanges it itself, so no token is ever handled by hand.
AUTH_CODE_INPUT = os.environ.get("TIKTOK_AUTH_CODE", "").strip()
REFRESH_MARGIN_SEC = 24 * 3600


def log(msg):
    print(f"[tiktok_shop] {msg}", flush=True)


# ---------------------------------------------------------------- signing + low-level call
def _sign(path, query_params, body_str=""):
    """HMAC-SHA256 per TikTok Shop Open API: app_secret + path + sorted(k+v for k,v in params
    excluding sign/access_token) + body + app_secret, HMAC key = app_secret, hex lowercase."""
    signable = {k: v for k, v in query_params.items() if k not in ("sign", "access_token")}
    concat = "".join(f"{k}{signable[k]}" for k in sorted(signable))
    base = APP_SECRET + path + concat + (body_str or "") + APP_SECRET
    return hmac.new(APP_SECRET.encode(), base.encode(), hashlib.sha256).hexdigest()


def api_call(method, path, query_params=None, body=None, access_token=None, host=API_HOST,
             signed=True, retries=5):
    """Low-level call. signed=True adds app_key/timestamp/sign and the
    x-tts-access-token header (TikTok rejects access_token as a query param - confirmed
    2026-10-04). signed=False is for the token/get and token/refresh bootstrap calls."""
    params = dict(query_params or {})
    body_str = json.dumps(body, separators=(",", ":")) if body is not None else ""
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if signed:
        params["app_key"] = APP_KEY
        params["timestamp"] = str(int(time.time()))
        params["sign"] = _sign(path, params, body_str)
        if access_token:
            headers["x-tts-access-token"] = access_token
    url = f"{host}{path}?{urllib.parse.urlencode(params)}"
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(
                url, data=body_str.encode() if body is not None else None,
                method=method, headers=headers,
            )
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            # TikTok sometimes answers auth/rate-limit style errors with HTTP 200 + an error
            # "code" field instead of a real HTTP error - that path is handled by the caller
            # inspecting the returned dict's "code" field, not here.
            if e.code == 429 and attempt < retries:
                wait = min(30, 2 ** attempt)
                log(f"429 rate limited on {path}, retry {attempt}/{retries} after {wait}s")
                time.sleep(wait)
                continue
            log(f"HTTP {e.code} on {method} {path}: {err_body[:500]}")
            if attempt < retries and e.code >= 500:
                time.sleep(2 ** attempt)
                continue
            try:  # TikTok usually puts its own {code, message} in the error body - keep it
                parsed = json.loads(err_body)
                if isinstance(parsed, dict) and parsed.get("code") not in (0, None):
                    return parsed
            except ValueError:
                pass
            return {"code": -1, "message": f"HTTP {e.code}", "data": None, "_raw": err_body[:500]}
        except Exception as e:  # noqa: BLE001
            if attempt < retries:
                time.sleep(2 ** attempt)
                continue
            log(f"request failed on {path}: {e}")
            return {"code": -1, "message": str(e), "data": None}
    return {"code": -1, "message": "exhausted retries", "data": None}


# ---------------------------------------------------------------- token state (encrypted file)
def _fernet():
    from cryptography.fernet import Fernet
    key = base64.urlsafe_b64encode(hashlib.sha256(("ctu-tiktok-state:" + APP_SECRET).encode()).digest())
    return Fernet(key)


def load_state():
    try:
        with open(STATE_PATH, "rb") as f:
            blob = f.read().strip()
    except OSError:
        return {}
    try:
        st = json.loads(_fernet().decrypt(blob).decode("utf-8"))
        return st if isinstance(st, dict) else {}
    except Exception:  # noqa: BLE001 - wrong key (app secret was reset) or a damaged file
        log(f"{STATE_PATH} exists but cannot be decrypted with the current TIKTOK_APP_SECRET - ignoring it")
        return {}


def save_state(state):
    os.makedirs(os.path.dirname(STATE_PATH) or ".", exist_ok=True)
    with open(STATE_PATH, "wb") as f:
        f.write(_fernet().encrypt(json.dumps(state, separators=(",", ":")).encode("utf-8")))


# ---------------------------------------------------------------- auth
def _expiry(value, now_ts):
    """TikTok's *_expire_in fields are ABSOLUTE unix timestamps (seen 2026-10-04); tolerate a
    plain number of seconds as well."""
    try:
        v = int(value)
    except (TypeError, ValueError):
        return 0
    return v if v > 1_000_000_000 else now_ts + v


def _token_call(path, params, what):
    resp = api_call("GET", path, query_params=params, host=AUTH_HOST, signed=False)
    if not isinstance(resp, dict) or resp.get("code") not in (0, None):
        log(f"{what} failed: code={resp.get('code') if isinstance(resp, dict) else None} "
            f"message={resp.get('message') if isinstance(resp, dict) else resp}")
        return None
    data = resp.get("data") or {}
    if not data.get("access_token"):
        log(f"{what}: response had no access_token")
        return None
    return data


def _auth_code_from_input(raw):
    """Pull the authorization code out of whatever was pasted: the whole redirect URL, a
    'code=...' fragment, the code with the URL's trailing '&locale=..&shop_region=..' still
    attached (run #4, 2026-10-04: that tail made TikTok answer 'invalid auth code'), or the bare code."""
    raw = (raw or "").strip().strip('"').strip("'")
    m = re.search(r"TTP_[A-Za-z0-9_\-]+", raw)
    if m:
        return m.group(0)
    if "code=" in raw:
        q = urllib.parse.parse_qs(raw.split("?", 1)[-1])
        if q.get("code"):
            return q["code"][0].strip()
    return raw.split("&", 1)[0].strip()


def obtain_access_token(state):
    """Order: (1) a fresh authorization code from the Run-workflow form, (2) the cached access
    token while it has > 24h left, (3) refresh with the newest refresh_token (state file first,
    then the TIKTOK_REFRESH_TOKEN secret). Every success is written to the state file at once,
    so a later failure in the same run cannot lose a rotated refresh_token. Tokens are never logged."""
    now_ts = int(time.time())
    if not (APP_KEY and APP_SECRET):
        log("FATAL: TIKTOK_APP_KEY / TIKTOK_APP_SECRET missing")
        return None

    def keep(data, how):
        prev_granted = state.get("granted_scopes")
        state.update({
            "access_token": data["access_token"],
            "access_token_expire": _expiry(data.get("access_token_expire_in"), now_ts),
            "refresh_token": data.get("refresh_token") or state.get("refresh_token"),
            "refresh_token_expire": _expiry(data.get("refresh_token_expire_in"), now_ts),
            "seller_name": data.get("seller_name") or state.get("seller_name"),
            "seller_base_region": data.get("seller_base_region") or state.get("seller_base_region"),
            "granted_scopes": data.get("granted_scopes") or prev_granted,
            "updated_at": now_ts,
        })
        save_state(state)
        log(f"access token OK via {how} (seller={state.get('seller_name')}, region={state.get('seller_base_region')}, "
            f"valid {round((state['access_token_expire'] - now_ts) / 86400, 1)} more days); state saved")
        log(f"granted scopes: {state.get('granted_scopes')}")
        return state["access_token"]

    if AUTH_CODE_INPUT:
        code = _auth_code_from_input(AUTH_CODE_INPUT)
        # Enough to tell a truncated / mis-pasted value from a genuinely expired code (the code is
        # single-use, so its first and last characters are harmless in a public log).
        log(f"auth code received: {len(code)} chars, starts {code[:4]!r}, ends {code[-4:]!r} "
            f"(input was {'a URL' if '://' in AUTH_CODE_INPUT else 'a bare value'}, {len(AUTH_CODE_INPUT)} chars)")
        data = _token_call("/api/v2/token/get", {"app_key": APP_KEY, "app_secret": APP_SECRET,
                                                 "auth_code": code, "grant_type": "authorized_code"},
                           "authorization-code exchange")
        if data:
            state.pop("shop", None)  # scopes may have changed: look the shop up again
            return keep(data, "authorization code")
        log("the authorization code was rejected (codes are single-use and expire within minutes) - "
            "falling back to the stored tokens")

    if state.get("access_token") and int(state.get("access_token_expire") or 0) - now_ts > REFRESH_MARGIN_SEC:
        log(f"using cached access token (valid {round((state['access_token_expire'] - now_ts) / 86400, 1)} more days)")
        return state["access_token"]

    candidates = []
    for label, tok in (("state file", state.get("refresh_token")), ("TIKTOK_REFRESH_TOKEN secret", REFRESH_TOKEN)):
        if tok and tok not in [t for _, t in candidates]:
            candidates.append((label, tok))
    for label, tok in candidates:
        data = _token_call("/api/v2/token/refresh", {"app_key": APP_KEY, "app_secret": APP_SECRET,
                                                     "refresh_token": tok, "grant_type": "refresh_token"},
                           f"refresh with the {label} token")
        if data:
            return keep(data, f"refresh ({label})")
    log("FATAL: no usable token. Re-authorize: Partner Center > app > Authorization > Copy authorization link, "
        "open it, approve, then paste the redirect URL into Run workflow > 'auth_code'.")
    return None


def get_shop(access_token):
    """GET /authorization/202309/shops (signed). Returns the first authorized shop's
    {shop_id, shop_cipher, shop_name, region} or None. Needs the app scope
    'seller.authorization.info' - without it TikTok answers 105005 (seen in run #2)."""
    resp = api_call("GET", "/authorization/202309/shops", access_token=access_token)
    if not isinstance(resp, dict) or resp.get("code") not in (0, None):
        log(f"get_shop failed: code={resp.get('code') if isinstance(resp, dict) else None} "
            f"message={str(resp.get('message') if isinstance(resp, dict) else resp)[:300]}")
        return None
    shops = ((resp.get("data") or {}).get("shops")) or []
    if not shops:
        log("get_shop: no authorized shops returned")
        return None
    s = shops[0]
    log(f"shop: {s.get('name')} (id={s.get('id')}, region={s.get('region')}, seller_type={s.get('seller_type')})")
    return {"shop_id": s.get("id"), "shop_cipher": s.get("cipher"), "shop_name": s.get("name"), "region": s.get("region")}


# ---------------------------------------------------------------- finance data
def fetch_statements(access_token, shop_cipher, shop_id, time_ge, time_lt):
    """GET /finance/202309/statements, paginated. time_ge/time_lt = unix seconds.
    Returns (list_of_statements, api_status dict)."""
    out = []
    page_token = ""
    page = 0
    while True:
        page += 1
        params = {
            "page_size": 100,
            "sort_field": "statement_time",
            "statement_time_ge": time_ge,
            "statement_time_lt": time_lt,
        }
        if shop_cipher:
            params["shop_cipher"] = shop_cipher
        if page_token:
            params["page_token"] = page_token
        resp = api_call("GET", "/finance/202309/statements", query_params=params, access_token=access_token)
        if not isinstance(resp, dict) or resp.get("code") not in (0, None):
            return out, {"status": "error", "detail": str(resp)[:500], "pages_fetched": page - 1}
        data = resp.get("data") or {}
        items = data.get("statements") or []
        out.extend(items)
        page_token = data.get("next_page_token") or ""
        if not page_token or not items or page > 200:
            break
        time.sleep(0.5)
    return out, {"status": "ok", "pages_fetched": page}


# ---------------------------------------------------------------- bucketing + history (same
# merge pattern as every other fetcher in this repo - see fetch_google_ads.py)
def day_key(unix_ts):
    return datetime.fromtimestamp(int(unix_ts), tz=timezone.utc).astimezone(TZ).date().isoformat()


def _num(row, *names):
    """First of the candidate field names that is present and numeric (TikTok sends amounts as strings)."""
    for n in names:
        v = row.get(n)
        if v in (None, ""):
            continue
        try:
            return float(v)
        except (TypeError, ValueError):
            continue
    return 0.0


def bucket_statements(statements):
    daily = {}

    def b(d):
        return daily.setdefault(d, {
            "statements_count": 0, "gross_revenue": 0.0, "total_fees": 0.0,
            "adjustment_amount": 0.0, "shipping_cost_amount": 0.0, "net_settlement_amount": 0.0,
        })

    for s in statements:
        ts = s.get("statement_time") or s.get("create_time") or s.get("settlement_time")
        if not ts:
            continue
        d = b(day_key(ts))
        d["statements_count"] += 1
        d["gross_revenue"] += _num(s, "revenue_amount", "revenue", "net_sales_amount")
        d["total_fees"] += abs(_num(s, "fee_amount", "total_fees", "fees"))
        d["adjustment_amount"] += _num(s, "adjustment_amount")
        d["shipping_cost_amount"] += abs(_num(s, "shipping_cost_amount"))
        d["net_settlement_amount"] += _num(s, "settlement_amount", "net_amount")
    for d in daily.values():
        for k in d:
            if isinstance(d[k], float):
                d[k] = round(d[k], 2)
    return daily


STATEMENT_KEEP = ("statement_time", "revenue_amount", "fee_amount", "adjustment_amount", "shipping_cost_amount",
                  "net_sales_amount", "settlement_amount", "currency", "payment_status", "payment_id", "payment_time")


def statement_rows(statements):
    """One row per statement, keyed by its id, exactly as TikTok returned it (amounts stay strings)
    plus the report-timezone day it is bucketed on - so every daily number can be traced to
    statements in Seller Center > Finance."""
    rows = {}
    for s in statements:
        sid = str(s.get("id") or "")
        ts = s.get("statement_time") or s.get("create_time") or s.get("settlement_time")
        if not sid or not ts:
            continue
        row = {k: s.get(k) for k in STATEMENT_KEEP if s.get(k) is not None}
        row["day"] = day_key(ts)
        rows[sid] = row
    return rows


def statements_merge(previous, fetched_rows, fetched_start, fetched_end):
    merged = {}
    for sid, row in ((previous or {}).get("statements") or {}).items():
        day = (row or {}).get("day") or ""
        if day >= HISTORY_START and (day < fetched_start or day > fetched_end):
            merged[sid] = row
    merged.update(fetched_rows)
    return dict(sorted(merged.items(), key=lambda kv: (kv[1].get("statement_time") or 0, kv[0])))


def history_previous(path):
    try:
        with open(path, encoding="utf-8") as f:
            prev = json.load(f)
        return prev if isinstance(prev, dict) and isinstance(prev.get("daily"), dict) else None
    except (OSError, ValueError):
        return None


def history_merge(previous, fetched_daily, fetched_start, fetched_end):
    merged = {}
    for day, row in ((previous or {}).get("daily") or {}).items():
        if day >= HISTORY_START and (day < fetched_start or day > fetched_end):
            merged[day] = row
    merged.update(fetched_daily)
    return dict(sorted(merged.items()))


def main():
    now = datetime.now(timezone.utc)

    if BACKFILL_START:
        start_date = datetime.strptime(BACKFILL_START, "%Y-%m-%d").replace(tzinfo=TZ)
        end_date = (datetime.strptime(BACKFILL_END, "%Y-%m-%d").replace(tzinfo=TZ)
                    if BACKFILL_END else now.astimezone(TZ))
    else:
        end_date = now.astimezone(TZ)
        # Whole days only: the merge below replaces every day from fetched_start on, so the fetch
        # must start at that day's midnight (v1.4 started mid-day and could drop the part of the
        # boundary day before the current time of day).
        start_date = (end_date - timedelta(days=WINDOW_DAYS)).replace(hour=0, minute=0, second=0, microsecond=0)

    fetched_start = start_date.date().isoformat()
    fetched_end = end_date.date().isoformat()
    time_ge = int(start_date.timestamp())
    time_lt = int((end_date + timedelta(days=1)).timestamp())

    state = load_state()
    access_token = obtain_access_token(state)
    if not access_token:
        log("FATAL: could not obtain access_token - aborting without touching the output file")
        sys.exit(1)

    shop = state.get("shop") if (state.get("shop") or {}).get("shop_cipher") else None
    if not shop:
        shop = get_shop(access_token)
        if shop and shop.get("shop_cipher"):
            state["shop"] = shop
            save_state(state)
    if not shop:
        # A single-shop local seller may be served without shop_cipher - try rather than stop here.
        log("no shop_cipher (the app lacks the 'Authorization' scope) - trying the finance call without it")
        shop = {"shop_id": None, "shop_cipher": None, "shop_name": state.get("seller_name"),
                "region": state.get("seller_base_region")}

    statements, api_status = fetch_statements(access_token, shop["shop_cipher"], shop["shop_id"], time_ge, time_lt)
    log(f"statements fetched: {len(statements)} ({fetched_start} -> {fetched_end}), status={api_status['status']}")
    if api_status["status"] != "ok":
        # Never write a fabricated zero: a failed fetch leaves the previous file exactly as it was.
        log(f"FATAL: statements fetch failed - {api_status.get('detail')} - aborting without touching the output file")
        sys.exit(1)
    if statements:
        log(f"statement field names (first record): {sorted(statements[0].keys())}")
        currencies = sorted({str(x.get('currency')) for x in statements if x.get('currency')})
        log(f"statement currencies: {currencies}")

    daily = bucket_statements(statements)
    rows = statement_rows(statements)

    prev = history_previous(OUTPUT_PATH)
    prev_in_range = [d for d in ((prev or {}).get("daily") or {}) if fetched_start <= d <= fetched_end]
    if not statements and prev_in_range:
        # Issued statements do not disappear. An empty answer for a range that had statements is a
        # glitch on TikTok's side - keep what we have rather than blank the range to zero.
        log(f"WARNING: TikTok returned 0 statements for {fetched_start} -> {fetched_end} but the file has "
            f"{len(prev_in_range)} day(s) there - keeping the previous data for this run")
        api_status = dict(api_status, status="empty_kept_previous")
        merged_daily = dict(sorted(((prev or {}).get("daily") or {}).items()))
        merged_rows = dict((prev or {}).get("statements") or {})
    else:
        merged_daily = history_merge(prev, daily, fetched_start, fetched_end)
        merged_rows = statements_merge(prev, rows, fetched_start, fetched_end)
    days_sorted = sorted(merged_daily)
    currencies = sorted({str(r.get("currency")) for r in merged_rows.values() if r.get("currency")})
    if currencies and currencies != ["USD"]:
        log(f"WARNING: statements are not all USD ({currencies}) - daily totals mix currencies")
    mismatch = [d for d, r in merged_daily.items()
                if abs(round(r.get("gross_revenue", 0) - r.get("total_fees", 0) + r.get("adjustment_amount", 0)
                             - r.get("shipping_cost_amount", 0), 2) - r.get("net_settlement_amount", 0)) > 0.011]
    if mismatch:
        log(f"NOTE: revenue - fees + adjustment - shipping != settlement on {len(mismatch)} day(s): {mismatch[:10]}")

    out = {
        "source": "tiktok_shop",
        "schema": SCHEMA,
        "script_version": SCRIPT_VERSION,
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "timezone": TZ_NAME,
        "shop": {"shop_id": shop["shop_id"], "shop_name": shop["shop_name"], "region": shop["region"]},
        "daily": {d: merged_daily[d] for d in days_sorted},
        "statements": merged_rows,
        "coverage": {"first_day": days_sorted[0], "last_day": days_sorted[-1], "days": len(days_sorted)} if days_sorted else {},
        "meta": {
            "note": ("Dữ liệu từ TikTok Shop Finance API (/finance/202309/statements) - mỗi 'statement' là 1 kỳ quyết "
                     "toán (settlement period), KHÔNG phải 1 đơn hàng. gross_revenue/total_fees/net_settlement_amount "
                     "gộp theo ngày statement_time. Đây là góc nhìn DÒNG TIỀN QUYẾT TOÁN thực tế (giống cách Amazon "
                     "settlement report được dùng trong P&L này), không phải doanh thu đơn hàng theo ngày bán."),
            "limitation": ("CHƯA lấy doanh thu/đơn hàng theo NGÀY BÁN thực (cần Orders API - scope seller.order.info "
                            "đã có sẵn, để version sau nếu cần khớp với cách Shopify/Amazon đang tính theo ngày đặt "
                            "hàng thay vì ngày quyết toán). Endpoint /finance/202309/statements suy ra từ SDK bên thứ "
                            "3 khớp nhau, chưa tự xác nhận trực tiếp được do mạng bị chặn khi viết script này - xem "
                            "api_status bên dưới và claude/tiktok-shop-integration.md."),
            "api_status": api_status,
            "statement_fields_seen": sorted(statements[0].keys()) if statements else [],
            "statements_in_window": len(statements),
            "statements_total": len(merged_rows),
            "currencies": currencies,
            "settlement_identity_mismatch_days": mismatch,
            "window_days": WINDOW_DAYS if not BACKFILL_START else None,
            "backfill": {"start": BACKFILL_START, "end": BACKFILL_END} if BACKFILL_START else None,
        },
    }
    os.makedirs(os.path.dirname(OUTPUT_PATH) or ".", exist_ok=True)
    json.dump(out, open(OUTPUT_PATH, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    log(f"Wrote {OUTPUT_PATH}: {len(days_sorted)} days, {len(statements)} statements in window "
        f"({fetched_start} -> {fetched_end})")


if __name__ == "__main__":
    main()
