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
  TIKTOK_APP_KEY, TIKTOK_APP_SECRET, TIKTOK_REFRESH_TOKEN
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
import hashlib
import hmac
import json
import os
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

SCRIPT_VERSION = "tiktok_shop-1.1"
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


# ---------------------------------------------------------------- auth
def refresh_access_token():
    """GET /api/v2/token/refresh?app_key&app_secret&refresh_token&grant_type=refresh_token - unsigned.
    Confirmed by run #1 (2026-10-04): /api/v2/token/get rejects grant_type=refresh_token
    (98001004 invalid params) and POST /api/v2/token/refresh is a 404 - the route is GET only.
    If TikTok hands back a different refresh_token the GitHub secret must be updated by hand
    (this script cannot write secrets); the token value itself is never logged."""
    if not (APP_KEY and APP_SECRET and REFRESH_TOKEN):
        log("FATAL: TIKTOK_APP_KEY / TIKTOK_APP_SECRET / TIKTOK_REFRESH_TOKEN missing")
        return None, None
    params = {
        "app_key": APP_KEY, "app_secret": APP_SECRET,
        "refresh_token": REFRESH_TOKEN, "grant_type": "refresh_token",
    }
    resp = api_call("GET", "/api/v2/token/refresh", query_params=params, host=AUTH_HOST, signed=False)
    if not isinstance(resp, dict) or resp.get("code") not in (0, None):
        log(f"token refresh failed: code={resp.get('code') if isinstance(resp, dict) else None} "
            f"message={resp.get('message') if isinstance(resp, dict) else resp}")
        return None, None
    data = resp.get("data") or {}
    access_token = data.get("access_token")
    new_refresh = data.get("refresh_token")
    if new_refresh and new_refresh != REFRESH_TOKEN:
        log("WARNING: TikTok issued a NEW refresh_token, different from the TIKTOK_REFRESH_TOKEN secret. "
            "The secret needs updating by hand (re-authorize in Partner Center to get a fresh one) "
            "if later runs start failing at the refresh step.")
    if not access_token:
        log("token refresh response had no access_token")
        return None, None
    log(f"access_token refreshed OK (seller={data.get('seller_name')}, region={data.get('seller_base_region')}, "
        f"refresh_token_rotated={bool(new_refresh and new_refresh != REFRESH_TOKEN)})")
    return access_token, new_refresh or REFRESH_TOKEN


def get_shop(access_token):
    """GET /authorization/202309/shops (signed). Returns the first authorized shop's
    {shop_id, shop_cipher, shop_name, region} or None."""
    resp = api_call("GET", "/authorization/202309/shops", access_token=access_token)
    if not isinstance(resp, dict) or resp.get("code") not in (0, None):
        log(f"get_shop failed: {resp}")
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
            "shop_cipher": shop_cipher,
            "page_size": 100,
            "sort_field": "statement_time",
            "statement_time_ge": time_ge,
            "statement_time_lt": time_lt,
        }
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
        start_date = end_date - timedelta(days=WINDOW_DAYS)

    fetched_start = start_date.date().isoformat()
    fetched_end = end_date.date().isoformat()
    time_ge = int(start_date.timestamp())
    time_lt = int((end_date + timedelta(days=1)).timestamp())

    access_token, _ = refresh_access_token()
    if not access_token:
        log("FATAL: could not obtain access_token - aborting without touching the output file")
        sys.exit(1)

    shop = get_shop(access_token)
    if not shop or not shop.get("shop_cipher"):
        log("FATAL: could not resolve shop_cipher - aborting without touching the output file")
        sys.exit(1)

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

    prev = history_previous(OUTPUT_PATH)
    merged_daily = history_merge(prev, daily, fetched_start, fetched_end)
    days_sorted = sorted(merged_daily)

    out = {
        "source": "tiktok_shop",
        "schema": SCHEMA,
        "script_version": SCRIPT_VERSION,
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "timezone": TZ_NAME,
        "shop": {"shop_id": shop["shop_id"], "shop_name": shop["shop_name"], "region": shop["region"]},
        "daily": {d: merged_daily[d] for d in days_sorted},
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
