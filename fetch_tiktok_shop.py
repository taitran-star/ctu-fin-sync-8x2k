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

Output (schema 2):
  daily        theo ngày STATEMENT (dòng tiền quyết toán, như v1) - dùng để đối chiếu với Seller Center.
  orders_daily theo ngày ĐẶT HÀNG (America/Los_Angeles) từ Orders API: orders/units/gross/seller
               discount/net_sales + phí THẬT của các đơn đã quyết toán (referral, affiliate, khác).
               Đây là số dùng cho P&L (dashboard tính theo ngày đặt - claude/pnl-accounting-rules.md).
  refunds_daily hoàn tiền theo ngày statement chứa khoản hoàn (như Shopify/Amazon: ngày xử lý hoàn).
  orders       từng đơn (chỉ số tiền + SKU, KHÔNG có thông tin khách - repo công khai).
Phần Orders/phí đơn lỗi thì phần statements (daily) vẫn ghi bình thường - xem meta.orders_status.

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

SCRIPT_VERSION = "tiktok_shop-2.0"
SCHEMA = 2

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


# ---------------------------------------------------------------- orders (order-date basis, v2.0)
ORDER_CHUNK_DAYS = 30
FEE_CALL_CAP = 400           # max per-order finance calls per run


def _f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def fetch_orders(access_token, shop_cipher, time_ge, time_lt):
    """POST /order/202309/orders/search, paginated, in <=30-day chunks (a 21-month backfill in one
    call risks a range limit). Returns (orders, api_status)."""
    out, seen = [], set()
    pages = 0
    chunk = ORDER_CHUNK_DAYS * 86400
    lo = time_ge
    while lo < time_lt:
        hi = min(lo + chunk, time_lt)
        page_token = ""
        while True:
            pages += 1
            q = {"page_size": 100, "sort_field": "create_time", "sort_order": "ASC"}
            if shop_cipher:
                q["shop_cipher"] = shop_cipher
            if page_token:
                q["page_token"] = page_token
            resp = api_call("POST", "/order/202309/orders/search", query_params=q,
                            body={"create_time_ge": lo, "create_time_lt": hi}, access_token=access_token)
            if not isinstance(resp, dict) or resp.get("code") not in (0, None):
                return out, {"status": "error", "detail": str(resp)[:500], "pages_fetched": pages - 1}
            data = resp.get("data") or {}
            for o in data.get("orders") or []:
                if o.get("id") and o["id"] not in seen:
                    seen.add(o["id"])
                    out.append(o)
            page_token = data.get("next_page_token") or ""
            if not page_token or pages > 500:
                break
            time.sleep(0.3)
        lo = hi
    return out, {"status": "ok", "pages_fetched": pages}


def order_row(o):
    """Money + SKU only. No buyer, address, phone, e-mail - the repo is public."""
    pay = o.get("payment") or {}
    lines = []
    for li in o.get("line_items") or []:
        lines.append({
            "sku_id": li.get("sku_id"),
            "seller_sku": li.get("seller_sku") or None,
            "orig": round(_f(li.get("original_price")), 2),
            "sale": round(_f(li.get("sale_price")), 2),
            "seller_disc": round(_f(li.get("seller_discount")), 2),
            "plat_disc": round(_f(li.get("platform_discount")), 2),
            "status": li.get("display_status"),
        })
    ts = o.get("create_time")
    row = {
        "create_time": ts,
        "day": day_key(ts) if ts else None,
        "status": o.get("status"),
        "paid_time": o.get("paid_time") or None,
        "delivery_time": o.get("delivery_time") or None,
        "cancel_time": o.get("cancel_time") or None,
        "is_sample": bool(o.get("is_sample_order")),
        "currency": pay.get("currency"),
        "payment": {k: pay.get(k) for k in ("original_total_product_price", "sub_total", "seller_discount",
                                             "platform_discount", "shipping_fee", "tax", "total_amount")
                    if pay.get(k) is not None},
        "lines": lines,
    }
    return row


def order_sales(row):
    """(counts_as_sale, units, gross, seller_discount, platform_discount) for one order row.
    Same convention as TikTok's own Shop Analytics and Seller Center Finance: an order that was PAID counts
    as a sale on its order day even if it was cancelled later - the cancellation is booked as a refund on
    the cancel day (see bucket_orders). UNPAID / never-paid cancelled orders and sample orders are not sales."""
    st = row.get("status")
    if row.get("is_sample") or st == "UNPAID" or (st == "CANCELLED" and not row.get("paid_time")):
        return False, 0, 0.0, 0.0, 0.0
    lines = row.get("lines") or []
    live = lines if st == "CANCELLED" else [l for l in lines if str(l.get("status") or "").upper() != "CANCELLED"]
    if live:
        return (True, len(live), sum(l["orig"] for l in live), sum(l["seller_disc"] for l in live),
                sum(l["plat_disc"] for l in live))
    pay = row.get("payment") or {}   # no line items in the answer - fall back to the order totals
    return (True, 0, _f(pay.get("original_total_product_price") or pay.get("sub_total")),
            _f(pay.get("seller_discount")), _f(pay.get("platform_discount")))


def _walk_fee(node, acc):
    """Sum every numeric *_amount leaf under a fee dict - TikTok adds new fee types over time,
    so nothing is hard-coded away."""
    if isinstance(node, dict):
        for k, v in node.items():
            if isinstance(v, (dict, list)):
                _walk_fee(v, acc)
            else:
                x = _f(v)
                if x:
                    acc[k] = round(acc.get(k, 0.0) + x, 2)
    elif isinstance(node, list):
        for v in node:
            _walk_fee(v, acc)


def fee_row(data):
    """Parse /finance/202501/orders/{id}/statement_transactions. Tolerant of both the documented
    sku_transactions layout and a flat statement_transactions layout (the exact shape is logged in
    meta.txn_fields_seen so v2.1 can be pinned to it). Returns the compact fee record."""
    txns = []
    for key in ("sku_transactions", "statement_transactions", "transactions"):
        if isinstance(data.get(key), list):
            txns = data[key]
            break
    fee_parts, refund_gross, refund_seller_disc, sids = {}, 0.0, 0.0, []
    for t in txns:
        if not isinstance(t, dict):
            continue
        if t.get("statement_id"):
            sids.append(str(t["statement_id"]))
        fee = ((t.get("fee_tax_breakdown") or {}).get("fee")) or {}
        _walk_fee(fee, fee_parts)
        rb = t.get("revenue_breakdown") or {}
        refund_gross += _f(rb.get("refund_subtotal_before_discount_amount"))
        refund_seller_disc += _f(rb.get("seller_discount_refund_amount"))
    rev = _f(data.get("revenue_amount"))
    fee_tot = _f(data.get("fee_and_tax_amount"))
    ship = _f(data.get("shipping_cost_amount"))
    settle = _f(data.get("settlement_amount"))
    # Sign convention check from the identity settlement = revenue + fee + shipping: Seller Center and the
    # statements API report costs as NEGATIVE numbers; if an order answers the other way round the
    # identity only closes with the opposite sign. cost_sign turns "cost" into a positive number.
    cost_sign = -1.0
    if fee_tot and abs(rev + fee_tot + ship - settle) > 0.011 and abs(rev - fee_tot + ship - settle) <= 0.011:
        cost_sign = 1.0
    return {
        "settled": bool(txns) and len(sids) == len([t for t in txns if isinstance(t, dict)]),
        "statement_ids": sorted(set(sids)),
        "revenue_amount": round(rev, 2),
        "fee_and_tax_amount": round(fee_tot, 2),
        "shipping_cost_amount": round(ship, 2),
        "settlement_amount": round(settle, 2),
        "cost_sign": cost_sign,
        "fee_cost": round(fee_tot * cost_sign, 2),
        "fee_parts": {k: round(v * cost_sign, 2) for k, v in fee_parts.items()},   # positive = cost
        "refund_gross": round(abs(refund_gross), 2),
        "refund_seller_discount": round(abs(refund_seller_disc), 2),
    }


def fetch_order_fees(access_token, shop_cipher, order_ids, stat):
    """Per-order finance breakdown. Errors are counted, never fatal."""
    out = {}
    for oid in order_ids[:FEE_CALL_CAP]:
        q = {"shop_cipher": shop_cipher} if shop_cipher else {}
        resp = api_call("GET", f"/finance/202501/orders/{oid}/statement_transactions",
                        query_params=q, access_token=access_token)
        if not isinstance(resp, dict) or resp.get("code") not in (0, None):
            stat["errors"] += 1
            stat.setdefault("first_error", str(resp)[:300])
            continue
        data = resp.get("data") or {}
        if not stat.get("fields_seen"):
            stat["fields_seen"] = sorted(data.keys())
            for key in ("sku_transactions", "statement_transactions", "transactions"):
                if isinstance(data.get(key), list) and data[key] and isinstance(data[key][0], dict):
                    stat["txn_item_fields_seen"] = sorted(data[key][0].keys())
                    fb = (data[key][0].get("fee_tax_breakdown") or {}).get("fee")
                    if isinstance(fb, dict):
                        stat["fee_fields_seen"] = sorted(fb.keys())
                    break
        out[oid] = fee_row(data)
        stat["ok"] += 1
        time.sleep(0.15)
    return out


def orders_merge(previous, fetched_rows, fetched_start, fetched_end):
    """Previous orders outside the fetched day range are kept; orders in range are replaced but keep
    their cached fee record (it is refreshed separately)."""
    prev = (previous or {}).get("orders") or {}
    merged = {}
    for oid, row in prev.items():
        day = (row or {}).get("day") or ""
        if day >= HISTORY_START and (day < fetched_start or day > fetched_end):
            merged[oid] = row
    for oid, row in fetched_rows.items():
        if oid in prev and prev[oid].get("fees"):
            row["fees"] = prev[oid]["fees"]
        merged[oid] = row
    return dict(sorted(merged.items(), key=lambda kv: (kv[1].get("create_time") or 0, kv[0])))


def _fee_groups(parts):
    ref = aff = other = 0.0
    refund_admin = 0.0
    for k, v in parts.items():
        kl = k.lower()
        if kl in ("referral_fee_amount", "platform_commission_amount"):
            ref += v
        elif "affiliate" in kl or "creator_bonus" in kl:
            aff += v
        elif kl == "refund_administration_fee_amount":
            refund_admin += v
        else:
            other += v
    return ref, aff, refund_admin, other


def order_fee_split(fees):
    """(referral, affiliate, refund_admin, other, total) as positive costs. The TOTAL is TikTok's own
    fee_and_tax_amount for the order whenever it is present; the named groups are best effort and any
    remainder goes to 'other', so the daily total can never drift from what TikTok says it charged."""
    ref, aff, radm, oth = _fee_groups(fees.get("fee_parts") or {})
    parts_total = ref + aff + radm + oth
    total = fees.get("fee_cost")
    if total in (None, 0, 0.0) and parts_total:
        total = parts_total
    total = _f(total)
    if abs(parts_total - total) > 0.011:
        named = ref + aff + radm
        if 0 <= named <= total + 0.011 and total >= 0:
            oth = total - named
        else:                      # named parts do not fit the total - do not guess a split
            ref = aff = radm = 0.0
            oth = total
    return ref, aff, radm, oth, total


def bucket_orders(orders, statement_days):
    """Daily numbers from the merged order map. Sales + settled fees on the ORDER day; refunds on
    the day of the statement that carries them (fallback: order day)."""
    daily, refunds = {}, {}

    def b(d):
        return daily.setdefault(d, {
            "orders_count": 0, "units": 0, "gross_sales": 0.0, "seller_discount": 0.0, "platform_discount": 0.0,
            "net_sales": 0.0, "cancelled_orders": 0, "unpaid_orders": 0, "settled_orders": 0,
            "unsettled_orders": 0, "fees_referral": 0.0, "fees_affiliate": 0.0, "fees_refund_admin": 0.0,
            "fees_other": 0.0, "fees_total": 0.0, "gross_sales_settled": 0.0,
        })

    for oid, r in orders.items():
        d = r.get("day")
        if not d:
            continue
        row = b(d)
        st = r.get("status")
        if st == "CANCELLED":
            row["cancelled_orders"] += 1
        elif st == "UNPAID":
            row["unpaid_orders"] += 1
        sale, units, gross, sd, pd_ = order_sales(r)
        fees = r.get("fees") or {}
        if not sale:
            # Unpaid / never-paid / sample order: no sale and no refund, but any fee TikTok charged is a real
            # cost and stays on the order day.
            if fees.get("settled"):
                ref, aff, radm, oth, tot = order_fee_split(fees)
                row["fees_referral"] += ref
                row["fees_affiliate"] += aff
                row["fees_refund_admin"] += radm
                row["fees_other"] += oth
                row["fees_total"] += tot
            continue
        row["orders_count"] += 1
        row["units"] += units
        row["gross_sales"] += gross
        row["seller_discount"] += sd
        row["platform_discount"] += pd_
        row["net_sales"] += gross - sd
        if fees.get("settled"):
            row["settled_orders"] += 1
            row["gross_sales_settled"] += gross
            ref, aff, radm, oth, tot = order_fee_split(fees)
            row["fees_referral"] += ref
            row["fees_affiliate"] += aff
            row["fees_refund_admin"] += radm
            row["fees_other"] += oth
            row["fees_total"] += tot
        else:
            row["unsettled_orders"] += 1
        if st == "CANCELLED":
            # paid, then cancelled: refund of the whole order on the cancel day
            ct = r.get("cancel_time")
            sids = fees.get("statement_ids") or []
            rd = (day_key(ct) if ct else next((statement_days[s_] for s_ in sids if s_ in statement_days), d))
            rf = refunds.setdefault(rd, {"refund_gross": 0.0, "refund_seller_discount": 0.0, "refund_orders": 0})
            rf["refund_gross"] += gross
            rf["refund_seller_discount"] += sd
            rf["refund_orders"] += 1
        elif fees.get("refund_gross") or fees.get("refund_seller_discount"):
            # delivered, then returned/refunded: refund on the day of the statement that carries it
            sids = fees.get("statement_ids") or []
            rd = next((statement_days[s_] for s_ in sids if s_ in statement_days), d)
            rf = refunds.setdefault(rd, {"refund_gross": 0.0, "refund_seller_discount": 0.0, "refund_orders": 0})
            rf["refund_gross"] += _f(fees.get("refund_gross"))
            rf["refund_seller_discount"] += _f(fees.get("refund_seller_discount"))
            rf["refund_orders"] += 1
    for dd in (daily, refunds):
        for v in dd.values():
            for k in v:
                if isinstance(v[k], float):
                    v[k] = round(v[k], 2)
    return dict(sorted(daily.items())), dict(sorted(refunds.items()))



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

    # ---- orders on the ORDER-DATE basis (v2.0). Never fatal: statements above are already safe.
    statement_days = {sid: r.get("day") for sid, r in merged_rows.items() if r.get("day")}
    orders_status = {"status": "skipped"}
    fee_stat = {"ok": 0, "errors": 0}
    merged_orders = dict((prev or {}).get("orders") or {})
    orders_fetched = 0
    order_fields = {}
    try:
        orders, orders_status = fetch_orders(access_token, shop["shop_cipher"], time_ge, time_lt)
        orders_fetched = len(orders)
        log(f"orders fetched: {len(orders)} ({fetched_start} -> {fetched_end}), status={orders_status['status']}")
        if orders_status["status"] == "ok":
            if orders:
                order_fields = {"order": sorted(orders[0].keys()),
                                "line_item": sorted((orders[0].get("line_items") or [{}])[0].keys()),
                                "payment": sorted((orders[0].get("payment") or {}).keys())}
                log(f"order field names (first record): {order_fields['order']}")
            prev_orders_in_range = [o for o, r in merged_orders.items()
                                    if fetched_start <= (r.get("day") or "") <= fetched_end]
            if not orders and prev_orders_in_range:
                log(f"WARNING: Orders API returned 0 orders for {fetched_start} -> {fetched_end} but the file has "
                    f"{len(prev_orders_in_range)} there - keeping previous orders for this run")
                orders_status = dict(orders_status, status="empty_kept_previous")
            else:
                merged_orders = orders_merge(prev, {str(o["id"]): order_row(o) for o in orders},
                                             fetched_start, fetched_end)
            # Per-order finance breakdown: every unsettled order + every order in the rolling window
            # (a refund can land after settlement). Unsettled / newest first, capped per run.
            todo = [oid for oid, r in merged_orders.items() if r.get("status") != "UNPAID"
                    and not (r.get("status") == "CANCELLED" and not r.get("paid_time"))
                    and (not (r.get("fees") or {}).get("settled") or (r.get("day") or "") >= fetched_start)]
            todo.sort(key=lambda oid: ((merged_orders[oid].get("fees") or {}).get("settled") is True,
                                       -(merged_orders[oid].get("create_time") or 0)))
            fees = fetch_order_fees(access_token, shop["shop_cipher"], todo, fee_stat)
            for oid, fr in fees.items():
                merged_orders[oid]["fees"] = fr
            log(f"order fee breakdowns: {fee_stat['ok']} ok, {fee_stat['errors']} errors, of {len(todo)} requested")
            if fee_stat["errors"]:
                log(f"first fee error: {fee_stat.get('first_error')}")
        else:
            log(f"WARNING: orders fetch failed - {orders_status.get('detail')} - keeping previous orders")
    except Exception as e:  # noqa: BLE001
        orders_status = {"status": "error", "detail": f"{type(e).__name__}: {e}"[:500]}
        log(f"WARNING: orders step crashed - {orders_status['detail']} - keeping previous orders")
    orders_daily, refunds_daily = bucket_orders(merged_orders, statement_days)
    settled_n = sum(1 for r in merged_orders.values() if (r.get("fees") or {}).get("settled"))

    out = {
        "source": "tiktok_shop",
        "schema": SCHEMA,
        "script_version": SCRIPT_VERSION,
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "timezone": TZ_NAME,
        "shop": {"shop_id": shop["shop_id"], "shop_name": shop["shop_name"], "region": shop["region"]},
        "daily": {d: merged_daily[d] for d in days_sorted},
        "statements": merged_rows,
        "orders_daily": orders_daily,
        "refunds_daily": refunds_daily,
        "orders": merged_orders,
        "coverage": {"first_day": days_sorted[0], "last_day": days_sorted[-1], "days": len(days_sorted)} if days_sorted else {},
        "meta": {
            "note": ("daily = Finance API statements gộp theo ngày statement (dòng tiền quyết toán, để đối chiếu "
                     "Seller Center). orders_daily = Orders API gộp theo NGÀY ĐẶT HÀNG (giờ LA) - số dùng cho P&L; "
                     "phí (fees_*) chỉ có cho đơn ĐÃ quyết toán (settled_orders), đơn chưa quyết toán "
                     "(unsettled_orders) chưa có phí thật - dashboard phải ước tính. net_sales = gross_sales - "
                     "seller_discount (giống 'Net sales' của Seller Center; platform_discount do TikTok chịu). "
                     "refunds_daily theo ngày statement chứa khoản hoàn."),
            "api_status": api_status,
            "orders_status": orders_status,
            "orders_in_window": orders_fetched,
            "orders_total": len(merged_orders),
            "orders_settled": settled_n,
            "order_fields_seen": order_fields,
            "order_fee_calls": {k: v for k, v in fee_stat.items()},
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
