#!/usr/bin/env python3
"""
Cattasaurus - TikTok Ads (TikTok API for Business / Marketing API v1.3) -> data/tiktok_ads.json

What it pulls, per day (ad account time zone):
  * GMV Max campaigns for the TikTok Shop  (/gmv_max/report/get/  - GMV Max is NOT in /report/integrated/get/)
      cost, net_cost, orders, gross_revenue   (orders / revenue = what GMV Max attributes to itself)
  * every other auction ad                 (/report/integrated/get/ report_type=BASIC)
      spend
  spend = GMV Max cost + other ads spend  -> the P&L / MER cost line on the dashboard.

Auth (one time):
  1. TikTok API for Business developer portal -> your app (scopes: Ad Account Management, Reporting, GMV Max).
     Secrets: TIKTOK_ADS_APP_ID, TIKTOK_ADS_APP_SECRET.
  2. Open the app's advertiser authorization link, approve the ad account(s), copy the redirect URL.
  3. Actions -> "Cattasaurus TikTok Ads sync" -> Run workflow -> paste the URL into 'auth_code'.
     The script exchanges it for a long-term access token (no expiry unless revoked) and stores it
     ENCRYPTED in data/tiktok_ads_state.enc (Fernet key derived from TIKTOK_ADS_APP_SECRET), never in logs.
  Alternative: put a token you already have into secret TIKTOK_ADS_ACCESS_TOKEN.

Without any token the run is skipped and the existing file is left untouched (the dashboard keeps
showing the last numbers, and its freshness dot turns amber/red).
Run-workflow inputs backfill_start / backfill_end re-pull a past range in 30-day chunks.
"""
import base64
import datetime as dt
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

SCRIPT_VERSION = "tiktok-ads-1.1"   # 1.1: ad-account balance (advertiser/info) so the dashboard shows the prepaid wallet Ecomdy tops up
SCHEMA = 1
API = os.environ.get("TIKTOK_ADS_API_BASE", "https://business-api.tiktok.com/open_api/v1.3")
OUTPUT_PATH = os.environ.get("OUTPUT_PATH", "data/tiktok_ads.json")
STATE_PATH = os.environ.get("STATE_PATH", "data/tiktok_ads_state.enc")
APP_ID = os.environ.get("TIKTOK_ADS_APP_ID", "").strip()
APP_SECRET = os.environ.get("TIKTOK_ADS_APP_SECRET", "").strip()
TOKEN_SECRET = os.environ.get("TIKTOK_ADS_ACCESS_TOKEN", "").strip()
AUTH_CODE_INPUT = os.environ.get("TIKTOK_ADS_AUTH_CODE", "").strip()
ADVERTISER_IDS_ENV = [x.strip() for x in os.environ.get("TIKTOK_ADS_ADVERTISER_IDS", "").split(",") if x.strip()]
WINDOW_DAYS = min(30, max(1, int(os.environ.get("WINDOW_DAYS", "30") or 30)))   # stat_time_day allows <= 30 days per call
BACKFILL_START = os.environ.get("BACKFILL_START", "").strip()
BACKFILL_END = os.environ.get("BACKFILL_END", "").strip()
GMV_METRICS = ["cost", "net_cost", "orders", "gross_revenue"]


def log(msg):
    print(f"[tiktok-ads] {msg}", flush=True)


def r2(x):
    return round(float(x or 0) + 0.0, 2)


# ---------- token storage (encrypted, same pattern as the TikTok Shop sync) ----------
def _fernet():
    from cryptography.fernet import Fernet
    key = base64.urlsafe_b64encode(hashlib.sha256(("ctu-tiktok-ads-state:" + APP_SECRET).encode()).digest())
    return Fernet(key)


def load_state():
    if not (APP_SECRET and os.path.exists(STATE_PATH)):
        return {}
    try:
        return json.loads(_fernet().decrypt(open(STATE_PATH, "rb").read()).decode())
    except Exception as e:  # noqa: BLE001
        log(f"state file could not be decrypted ({type(e).__name__}) - re-authorize with the auth_code input")
        return {}


def save_state(state):
    blob = _fernet().encrypt(json.dumps(state).encode())
    os.makedirs(os.path.dirname(STATE_PATH) or ".", exist_ok=True)
    open(STATE_PATH, "wb").write(blob)


def _auth_code_from_input(raw):
    """Accept the whole redirect URL or the bare code."""
    if "://" in raw or "?" in raw:
        q = urllib.parse.parse_qs(urllib.parse.urlparse(raw).query)
        for k in ("auth_code", "code"):
            if q.get(k):
                return q[k][0]
    return raw


# ---------- HTTP ----------
def call(method, path, token=None, params=None, body=None, tries=4):
    url = API.rstrip("/") + path
    if params:
        enc = {k: (json.dumps(v) if isinstance(v, (list, dict)) else v) for k, v in params.items()}
        url += "?" + urllib.parse.urlencode(enc)
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Access-Token"] = token
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=60) as r:
                js = json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(2 * (i + 1)); continue
            raise RuntimeError(f"{path}: {last}")
        except (urllib.error.URLError, TimeoutError) as e:
            last = str(e); time.sleep(2 * (i + 1)); continue
        code = js.get("code")
        if code == 0:
            return js.get("data") or {}
        if code in (40100, 50000, 50002, 51001):   # rate limit / transient server errors
            last = f"code {code}: {js.get('message')}"; time.sleep(3 * (i + 1)); continue
        raise RuntimeError(f"{path}: code {code}: {js.get('message')}")
    raise RuntimeError(f"{path}: gave up after {tries} tries ({last})")


def exchange_auth_code(code):
    if not (APP_ID and APP_SECRET):
        raise SystemExit("auth_code given but TIKTOK_ADS_APP_ID / TIKTOK_ADS_APP_SECRET secrets are missing")
    d = call("POST", "/oauth2/access_token/", body={"app_id": APP_ID, "secret": APP_SECRET, "auth_code": code})
    tok = d.get("access_token")
    if not tok:
        raise SystemExit("token exchange returned no access_token")
    return {"access_token": tok, "refresh_token": d.get("refresh_token"), "advertiser_ids": [str(x) for x in (d.get("advertiser_ids") or [])],
            "scope": d.get("scope"), "authorized_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}


TOKEN_EXPIRED_CODES = (40102, 40104, 40105)   # "access token expired / invalid" family


def refresh_access_token(state):
    """Marketing API advertiser tokens are normally long-term; if TikTok returned a refresh_token and the
    access token expired, trade it for a new one (best effort - path not exercised against the live API yet)."""
    if not (state.get("refresh_token") and APP_ID and APP_SECRET):
        return None
    d = call("POST", "/oauth2/refresh_token/", body={"app_id": APP_ID, "secret": APP_SECRET,
                                                     "refresh_token": state["refresh_token"], "grant_type": "refresh_token"})
    if not d.get("access_token"):
        return None
    state.update({"access_token": d["access_token"], "refresh_token": d.get("refresh_token") or state["refresh_token"],
                  "refreshed_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")})
    save_state(state)
    return state["access_token"]


# ---------- reports ----------
def gmv_stores(token, adv):
    d = call("GET", "/gmv_max/store/list/", token, {"advertiser_id": adv})
    return [s for s in (d.get("store_list") or []) if s.get("is_gmv_max_available") or s.get("store_id")]


def gmv_daily(token, adv, store_id, start, end):
    out, page = {}, 1
    while True:
        d = call("GET", "/gmv_max/report/get/", token, {
            "advertiser_id": adv, "store_ids": [store_id], "start_date": start, "end_date": end,
            "metrics": GMV_METRICS, "dimensions": ["advertiser_id", "stat_time_day"],
            "filtering": {"campaign_statuses": ["STATUS_ALL"]}, "page": page, "page_size": 1000})
        for row in d.get("list") or []:
            day = (row.get("dimensions") or {}).get("stat_time_day", "")[:10]
            m = row.get("metrics") or {}
            if day:
                out[day] = {k: float(m.get(k) or 0) for k in GMV_METRICS}
        pi = d.get("page_info") or {}
        if page >= int(pi.get("total_page") or 1):
            return out
        page += 1


def basic_daily(token, adv, start, end):
    out, page = {}, 1
    while True:
        d = call("GET", "/report/integrated/get/", token, {
            "advertiser_id": adv, "report_type": "BASIC", "data_level": "AUCTION_ADVERTISER",
            "dimensions": ["advertiser_id", "stat_time_day"], "metrics": ["spend"],
            "start_date": start, "end_date": end, "page": page, "page_size": 1000})
        for row in d.get("list") or []:
            day = (row.get("dimensions") or {}).get("stat_time_day", "")[:10]
            if day:
                out[day] = float((row.get("metrics") or {}).get("spend") or 0)
        pi = d.get("page_info") or {}
        if page >= int(pi.get("total_page") or 1):
            return out
        page += 1


def advertiser_info(token, adv):
    """Prepaid balance + status of the ad account (the wallet the agency (Ecomdy) tops up). Marketing API
    /advertiser/info/ - fields are account-level, no customer data."""
    d = call("GET", "/advertiser/info/", token, {"advertiser_ids": [adv], "fields": ["name", "balance", "currency", "status", "timezone"]})
    for row in d.get("list") or []:
        if str(row.get("advertiser_id")) == str(adv):
            return row
    return (d.get("list") or [None])[0]


def chunks(start, end):
    s, e = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    while s <= e:
        c = min(e, s + dt.timedelta(days=WINDOW_DAYS - 1))
        yield s.isoformat(), c.isoformat()
        s = c + dt.timedelta(days=1)


def main():
    prev = {}
    if os.path.exists(OUTPUT_PATH):
        try:
            prev = json.load(open(OUTPUT_PATH, encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            log(f"previous file unreadable ({e}) - starting fresh")

    state = load_state()
    if AUTH_CODE_INPUT:
        code = _auth_code_from_input(AUTH_CODE_INPUT)
        log(f"exchanging auth_code (input was {'a URL' if '://' in AUTH_CODE_INPUT else 'a bare value'}, {len(code)} chars)")
        state = exchange_auth_code(code)
        save_state(state)
        log(f"authorized: {len(state.get('advertiser_ids') or [])} ad account(s); token stored encrypted in {STATE_PATH}")
    token = TOKEN_SECRET or state.get("access_token")
    if not token:
        log("no access token (secret TIKTOK_ADS_ACCESS_TOKEN empty and no authorized state) - skipping, file left untouched")
        return 0
    try:   # cheap call to find out early whether the token still works
        call("GET", "/oauth2/advertiser/get/", token, {"app_id": APP_ID, "secret": APP_SECRET}) if (APP_ID and APP_SECRET) else None
    except RuntimeError as e:
        if any(f"code {c}" in str(e) for c in TOKEN_EXPIRED_CODES) and not TOKEN_SECRET:
            log("access token expired - trying the stored refresh token")
            token = refresh_access_token(state) or token
        else:
            log(f"token check: {e}")
    advertisers = ADVERTISER_IDS_ENV or state.get("advertiser_ids") or [a.get("advertiser_id") for a in (prev.get("accounts") or [])]
    advertisers = [str(a) for a in advertisers if a]
    if not advertisers:
        raise SystemExit("no advertiser ids - set TIKTOK_ADS_ADVERTISER_IDS or re-authorize")

    today = dt.datetime.now(dt.timezone(dt.timedelta(hours=-8))).date()   # ad account time zone (Etc/GMT+8)
    if BACKFILL_START:
        start, end = BACKFILL_START, (BACKFILL_END or today.isoformat())
    else:
        start, end = (today - dt.timedelta(days=WINDOW_DAYS - 1)).isoformat(), today.isoformat()
    log(f"{SCRIPT_VERSION} · {len(advertisers)} ad account(s) · {start} -> {end}")

    fetched, errors, accounts, failed_days = {}, [], [], set()
    prev_acc = {a.get("advertiser_id"): a for a in (prev.get("accounts") or [])}
    blank = lambda: {"gmv_max_spend": 0.0, "other_spend": 0.0, "net_cost": 0.0, "orders": 0, "gross_revenue": 0.0}
    for adv in advertisers:
        acc = dict(prev_acc.get(adv) or {"advertiser_id": adv})
        try:
            stores = gmv_stores(token, adv)
        except RuntimeError as e:
            errors.append(f"{adv} store list: {e}"); stores = None
        acc["gmv_max_stores"] = [s.get("store_id") for s in (stores or [])]
        try:
            info = advertiser_info(token, adv) or {}
            if info.get("balance") is not None:
                acc["balance"] = r2(float(info.get("balance") or 0))
                acc["balance_currency"] = info.get("currency") or "USD"
                acc["balance_at"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                acc["status"] = info.get("status")
                if info.get("name"):
                    acc["name"] = info.get("name")
        except RuntimeError as e:
            errors.append(f"{adv} advertiser info: {e}")
        for cs, ce in chunks(start, end):
            span, d0 = [], dt.date.fromisoformat(cs)
            while d0 <= dt.date.fromisoformat(ce):
                span.append(d0.isoformat()); d0 += dt.timedelta(days=1)
            ok = stores is not None
            part = {}
            for s in (stores or []):
                try:
                    for day, m in gmv_daily(token, adv, s["store_id"], cs, ce).items():
                        f = part.setdefault(day, blank())
                        f["gmv_max_spend"] += m["cost"]; f["net_cost"] += m["net_cost"]
                        f["orders"] += int(m["orders"]); f["gross_revenue"] += m["gross_revenue"]
                except RuntimeError as e:
                    errors.append(f"{adv} gmv_max {cs}..{ce}: {e}"); ok = False
            try:
                for day, sp in basic_daily(token, adv, cs, ce).items():
                    f = part.setdefault(day, blank())
                    f["other_spend"] += sp; f["net_cost"] += sp
            except RuntimeError as e:
                errors.append(f"{adv} basic {cs}..{ce}: {e}"); ok = False
            if not ok:
                failed_days.update(span)   # never overwrite stored days with zeros from a failed call
                continue
            for day in span:   # every day of a successful range exists (0 when nothing ran)
                f, p = fetched.setdefault(day, blank()), part.get(day) or blank()
                for k in f:
                    f[k] += p[k]
        accounts.append(acc)
    for day in failed_days:
        fetched.pop(day, None)

    if errors and not fetched:
        for e in errors:
            log("ERROR " + e)
        if prev:
            # keep the old numbers, but record the failure so the dashboard shows the source in amber
            prev.setdefault("meta", {})["api_errors"] = errors[-10:]
            json.dump(prev, open(OUTPUT_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        return 1

    daily = dict(prev.get("daily") or {})
    for day, f in fetched.items():
        daily[day] = {"spend": r2(f["gmv_max_spend"] + f["other_spend"]), "gmv_max_spend": r2(f["gmv_max_spend"]),
                      "other_spend": r2(f["other_spend"]), "net_cost": r2(f["net_cost"]), "orders": int(f["orders"]),
                      "gross_revenue": r2(f["gross_revenue"]), "src": "api"}
    days = sorted(daily)
    out = dict(prev)
    meta = dict(prev.get("meta") or {})
    meta.update({"time_basis": "account_tz", "api_errors": errors[-10:], "last_window": [start, end]})
    out.update({
        "source": "tiktok_marketing_api", "schema": SCHEMA, "script_version": SCRIPT_VERSION,
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "timezone": "America/Los_Angeles", "currency": "USD",
        "accounts": accounts or prev.get("accounts") or [],
        "daily": {k: daily[k] for k in days},
        "coverage": {"first_day": days[0], "last_day": days[-1], "days": len(days)} if days else {},
        "meta": meta,
    })
    os.makedirs(os.path.dirname(OUTPUT_PATH) or ".", exist_ok=True)
    json.dump(out, open(OUTPUT_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    win = [daily[k] for k in days if start <= k <= end]
    log(f"wrote {OUTPUT_PATH}: {len(days)} days; window spend ${sum(x['spend'] for x in win):,.2f}, "
        f"GMV Max orders {sum(x['orders'] for x in win)}; errors {len(errors)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
