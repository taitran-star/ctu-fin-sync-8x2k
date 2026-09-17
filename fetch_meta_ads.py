#!/usr/bin/env python3
"""
Cattasaurus - Meta Ads (Facebook/Instagram) spend fetcher.

Runs on a schedule (GitHub Actions) completely independently of Claude.
Pulls daily account-level insights from the Meta Marketing API (Graph API),
normalises them into the same shape the P&L dashboard already uses for Amazon,
and writes them to data/meta_ads.json.

Credentials are read ONLY from environment variables (populated from GitHub
Actions Secrets at run time) - never hardcoded, never logged.

Required env vars:
  META_ACCESS_TOKEN     System User token (long-lived / non-expiring) with ads_read
  META_AD_ACCOUNT_ID    e.g. act_1234567890  (the "act_" prefix is added if missing).
                        Several accounts: comma-separated, e.g. act_111,act_222 -
                        their daily numbers are summed, and per-account totals are
                        kept under meta.accounts for auditing. Every account listed
                        must be assigned to the System User (View performance).

Optional env vars:
  META_API_VERSION      Graph API version, default v23.0 (any version still in
                        Meta's ~2-year support window works; bump when Meta
                        retires it - the script logs a warning if the API says
                        the version is deprecated)
  WINDOW_DAYS           trailing days to (re)fetch, default 45. Refetching a
                        trailing window every run matters because Meta keeps
                        attributing purchases to an ad for up to 7 days after
                        the click, so yesterday's purchase_value keeps growing.
  OUTPUT_PATH           default data/meta_ads.json
  META_ATTRIBUTION      optional, e.g. 7d_click,1d_view - if unset the ad
                        account's default attribution setting is used.

Output shape (per day, all money in the ad account currency):
  spend           what Meta charged for the day
  impressions, clicks
  purchases       number of purchases attributed to ads (omni_purchase)
  purchase_value  revenue attributed to ads (omni_purchase action value)
  roas            purchase_value / spend (0 when spend is 0)
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

API_VERSION = os.environ.get("META_API_VERSION", "v23.0")
GRAPH_HOST = "https://graph.facebook.com"
WINDOW_DAYS = int(os.environ.get("WINDOW_DAYS", "45"))
OUTPUT_PATH = os.environ.get("OUTPUT_PATH", "data/meta_ads.json")
ATTRIBUTION = os.environ.get("META_ATTRIBUTION", "").strip()

# Which action_type to treat as "a purchase". Meta reports the same purchase
# under several overlapping action types; take the first one present in this
# priority order so nothing is double counted.
PURCHASE_ACTION_PRIORITY = [
    "omni_purchase",                       # all channels, de-duplicated by Meta
    "purchase",                            # pixel + app purchases
    "offsite_conversion.fb_pixel_purchase",  # pixel only (older accounts)
    "onsite_web_purchase",                 # Shops on Facebook/Instagram
]

DAILY_FIELDS = ["spend", "impressions", "clicks", "purchases", "purchase_value", "roas"]

# Graph API error codes that mean "slow down and retry".
RATE_LIMIT_CODES = {4, 17, 32, 613, 80000, 80004}
# Graph API error codes that mean "the token/account is wrong" - retrying won't help.
AUTH_ERROR_CODES = {10, 100, 190, 200, 270, 294}


def log(msg):
    print(f"[meta_ads] {msg}", file=sys.stderr, flush=True)


def new_daily_bucket():
    return {f: 0 for f in DAILY_FIELDS}


def to_float(v):
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def to_int(v):
    try:
        return int(float(v or 0))
    except (TypeError, ValueError):
        return 0


def pick_action(items, priority):
    """items: [{"action_type": ..., "value": ...}, ...]. Return (action_type, value)
    for the highest-priority action type present, or (None, 0.0)."""
    if not items:
        return None, 0.0
    by_type = {}
    for it in items:
        t = it.get("action_type")
        if t and t not in by_type:
            by_type[t] = to_float(it.get("value"))
    for t in priority:
        if t in by_type:
            return t, by_type[t]
    return None, 0.0


def graph_get(url, params, max_retries=6):
    """GET with retry on rate limits / 5xx. `params` may be None when `url`
    already carries a full query string (paging.next)."""
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    for attempt in range(1, max_retries + 1):
        req = urllib.request.Request(url, method="GET")
        req.add_header("Accept", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                # Meta signals a deprecated-but-still-working API version via a header.
                warn = resp.headers.get("Warning") or resp.headers.get("X-Ad-Api-Version-Warning")
                if warn:
                    log(f"API version warning from Meta: {warn[:300]}")
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")
            err = {}
            try:
                err = json.loads(body).get("error", {}) or {}
            except (ValueError, AttributeError):
                pass
            code = err.get("code")
            msg = err.get("message", body[:300])
            if code in AUTH_ERROR_CODES or e.code in (401, 403):
                log(f"Meta API auth/config error (HTTP {e.code}, code {code}): {msg[:500]}")
                log("Check META_ACCESS_TOKEN (System User, ads_read scope, assigned to this ad account) and META_AD_ACCOUNT_ID.")
                raise SystemExit(2)
            if code in RATE_LIMIT_CODES or e.code == 429 or e.code >= 500:
                backoff = min(120, 5 * (2 ** (attempt - 1)))
                log(f"HTTP {e.code} (code {code}) - retry {attempt}/{max_retries} in {backoff}s: {msg[:200]}")
                time.sleep(backoff)
                continue
            log(f"HTTP {e.code} (code {code}): {msg[:500]}")
            raise
        except urllib.error.URLError as e:
            backoff = min(60, 5 * attempt)
            log(f"Network error ({e.reason}) - retry {attempt}/{max_retries} in {backoff}s")
            time.sleep(backoff)
    raise RuntimeError("Exceeded retries calling Meta Graph API")


def parse_insights_rows(rows, daily, warnings, action_types_seen):
    """Fold Graph API insights rows (one per day, level=account) into `daily`."""
    currency = None
    for row in rows:
        day = row.get("date_start")
        if not day:
            warnings.add("insights row without date_start")
            continue
        d = daily.setdefault(day, new_daily_bucket())
        d["spend"] += to_float(row.get("spend"))
        d["impressions"] += to_int(row.get("impressions"))
        d["clicks"] += to_int(row.get("clicks"))
        for it in row.get("actions", []) or []:
            if it.get("action_type"):
                action_types_seen.add(it["action_type"])
        p_type, p_count = pick_action(row.get("actions"), PURCHASE_ACTION_PRIORITY)
        v_type, p_value = pick_action(row.get("action_values"), PURCHASE_ACTION_PRIORITY)
        if p_type is None and (row.get("actions") or []):
            warnings.add("no purchase action type found in actions (see meta.action_types_seen)")
        if p_type and v_type and p_type != v_type:
            warnings.add(f"purchase count uses {p_type} but purchase value uses {v_type}")
        d["purchases"] += p_count
        d["purchase_value"] += p_value
        currency = row.get("account_currency") or currency
    return currency


def finalise(daily):
    for d in daily.values():
        d["spend"] = round(d["spend"], 2)
        d["purchase_value"] = round(d["purchase_value"], 2)
        d["purchases"] = int(round(d["purchases"]))
        d["roas"] = round(d["purchase_value"] / d["spend"], 4) if d["spend"] > 0 else 0


def sum_range(daily, start_key, end_key):
    out = new_daily_bucket()
    for k, d in daily.items():
        if start_key <= k <= end_key:
            for f in ("spend", "impressions", "clicks", "purchases", "purchase_value"):
                out[f] += d.get(f, 0)
    out["spend"] = round(out["spend"], 2)
    out["purchase_value"] = round(out["purchase_value"], 2)
    out["roas"] = round(out["purchase_value"] / out["spend"], 4) if out["spend"] > 0 else 0
    return out


def fetch_insights(token, account_id, since, until, daily, warnings, action_types_seen):
    params = {
        "access_token": token,
        "level": "account",
        "time_increment": 1,
        "time_range": json.dumps({"since": since, "until": until}),
        "fields": "date_start,date_stop,account_currency,spend,impressions,clicks,actions,action_values",
        "limit": 100,
    }
    if ATTRIBUTION:
        params["action_attribution_windows"] = json.dumps([w.strip() for w in ATTRIBUTION.split(",") if w.strip()])
    url = f"{GRAPH_HOST}/{API_VERSION}/{account_id}/insights"
    currency = None
    rows_total = 0
    page = 0
    while True:
        page += 1
        resp = graph_get(url, params) if params else graph_get(url, None)
        rows = resp.get("data", []) or []
        rows_total += len(rows)
        currency = parse_insights_rows(rows, daily, warnings, action_types_seen) or currency
        nxt = (resp.get("paging") or {}).get("next")
        log(f"page {page}: {len(rows)} rows, next={'yes' if nxt else 'no'}")
        if not nxt:
            break
        url, params = nxt, None  # paging.next already includes the access token + cursor
    return rows_total, currency


def main():
    token = os.environ.get("META_ACCESS_TOKEN", "").strip()
    raw_ids = os.environ.get("META_AD_ACCOUNT_ID", "").strip()
    account_ids = []
    for a in raw_ids.split(","):
        a = a.strip()
        if a:
            account_ids.append(a if a.startswith("act_") else f"act_{a}")
    if not (token and account_ids):
        log("Missing required env vars META_ACCESS_TOKEN and/or META_AD_ACCOUNT_ID")
        sys.exit(1)

    now = datetime.now(timezone.utc)
    since = (now - timedelta(days=WINDOW_DAYS)).strftime("%Y-%m-%d")
    until = now.strftime("%Y-%m-%d")

    daily, warnings, action_types_seen = {}, set(), set()
    rows_total, currency = 0, None
    per_account = {}
    for account_id in account_ids:
        log(f"Fetching {account_id} insights {since}..{until} via {API_VERSION}...")
        acct_daily = {}
        n_rows, acct_currency = fetch_insights(token, account_id, since, until, acct_daily, warnings, action_types_seen)
        rows_total += n_rows
        if currency and acct_currency and acct_currency != currency:
            warnings.add(f"currency mismatch: {account_id} is {acct_currency}, earlier account(s) {currency} - daily sums mix currencies")
        currency = currency or acct_currency
        # merge this account's days into the combined daily buckets
        for day, d in acct_daily.items():
            tgt = daily.setdefault(day, new_daily_bucket())
            for f in ("spend", "impressions", "clicks", "purchases", "purchase_value"):
                tgt[f] += d.get(f, 0)
        finalise(acct_daily)
        per_account[account_id] = {
            "currency": acct_currency,
            "days": len(acct_daily),
            "last_30d": sum_range(acct_daily, (now - timedelta(days=30)).strftime("%Y-%m-%d"), until),
        }
    finalise(daily)

    today_key = until
    mtd_start = now.strftime("%Y-%m-01")
    last30_start = (now - timedelta(days=30)).strftime("%Y-%m-%d")

    out = {
        "source": "meta_marketing_api",
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ad_account_id": ",".join(account_ids),
        "ad_account_ids": account_ids,
        "api_version": API_VERSION,
        "currency": currency or "USD",
        "attribution": ATTRIBUTION or "account default",
        "window_days": WINDOW_DAYS,
        "daily": daily,
        "totals": {
            "today": sum_range(daily, today_key, today_key),
            "mtd": sum_range(daily, mtd_start, today_key),
            "last_30d": sum_range(daily, last30_start, today_key),
        },
        "meta": {
            "rows_processed": rows_total,
            "accounts": per_account,
            "action_types_seen": sorted(action_types_seen),
            "warnings": sorted(warnings),
        },
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH) or ".", exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(out, f, indent=2, sort_keys=True)
    log(f"Wrote {OUTPUT_PATH} ({rows_total} rows, {len(daily)} days, currency {out['currency']}, {len(warnings)} warning types).")


if __name__ == "__main__":
    main()
