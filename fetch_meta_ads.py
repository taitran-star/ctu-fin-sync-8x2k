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
  HISTORY_START         days from this date on are kept in the file across runs (default
                        2025-01-01): a run refetches only its window and keeps the rest
  BACKFILL_START/_END   one-off run over a past range (YYYY-MM-DD, END defaults to today),
                        fetched in <= 92-day slices and merged into the same file
  META_ATTRIBUTION      optional, e.g. 7d_click,1d_view - if unset the ad
                        account's default attribution setting is used.
  META_CAMPAIGNS        default 1 - also pull campaign-level daily insights
                        (spend, reach, frequency, link clicks, ATC, checkout,
                        purchases, value) so the dashboard can rank products /
                        campaigns. Set 0 to keep account-level only.
  META_PRODUCT_ALIASES  optional JSON mapping a substring of the campaign name
                        (case-insensitive) to a product label, e.g.
                        {"litter": "Litter Box", "peekaboo": "Peekaboo"}.
                        Without a match the product is the campaign name's
                        first " - " segment.

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

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None

API_VERSION = os.environ.get("META_API_VERSION", "v23.0")
GRAPH_HOST = "https://graph.facebook.com"
WINDOW_DAYS = int(os.environ.get("WINDOW_DAYS", "45"))
OUTPUT_PATH = os.environ.get("OUTPUT_PATH", "data/meta_ads.json")
ATTRIBUTION = os.environ.get("META_ATTRIBUTION", "").strip()
# Meta reports date_start in the AD ACCOUNT's timezone. The P&L buckets every source on
# REPORT_TIMEZONE days, so when the two differ the insights are fetched with the hourly
# breakdown (advertiser time zone) and re-bucketed hour by hour into report-tz days.
REPORT_TIMEZONE = os.environ.get("REPORT_TIMEZONE", "America/Los_Angeles").strip() or "UTC"
TZ_ALIASES = {"Asia/Saigon": "Asia/Ho_Chi_Minh", "Asia/Calcutta": "Asia/Kolkata", "US/Pacific": "America/Los_Angeles",
              "US/Eastern": "America/New_York", "US/Central": "America/Chicago", "US/Mountain": "America/Denver"}
HOURLY_BREAKDOWN = "hourly_stats_aggregated_by_advertiser_time_zone"


def make_rebucket(account_tz_name):
    """f(date_start, hourly_breakdown_value) -> report-tz day. (identity, False) when not needed."""
    account_tz_name = TZ_ALIASES.get(account_tz_name, account_tz_name)
    if ZoneInfo is None or not account_tz_name or account_tz_name == REPORT_TIMEZONE:
        return (lambda day, hour: day), False
    try:
        src, dst = ZoneInfo(account_tz_name), ZoneInfo(REPORT_TIMEZONE)
    except Exception as e:  # noqa: BLE001
        log(f"WARNING: cannot convert account timezone {account_tz_name!r} -> {REPORT_TIMEZONE!r} ({e}); days left in account timezone")
        return (lambda day, hour: day), False
    cache = {}

    def f(day, hour):
        # hour arrives as "13:00:00 - 13:59:59" from the hourly breakdown
        h = int(str(hour or "0")[:2]) if hour is not None else 0
        key = (day, h)
        if key not in cache:
            y, m, d = (int(x) for x in day.split("-"))
            cache[key] = datetime(y, m, d, h, 30, tzinfo=src).astimezone(dst).strftime("%Y-%m-%d")
        return cache[key]
    return f, True


def fetch_account_info(token, account_id):
    """Ad account timezone. META_ACCOUNT_TIMEZONE (env) wins; otherwise read from the account node.
    A failure here must never kill the run (the insights calls are what matter), so SystemExit
    raised by graph_get on auth errors is swallowed and the days stay in the account timezone."""
    forced = os.environ.get("META_ACCOUNT_TIMEZONE", "").strip()
    if forced:
        return {"timezone_name": forced, "source": "env"}
    url = f"{GRAPH_HOST}/{API_VERSION}/{account_id}"
    try:
        # AdAccount node fields: `currency` (NOT `account_currency`, which only exists on insights rows).
        return graph_get(url, {"access_token": token, "fields": "timezone_name,currency,name"}) or {}
    except (Exception, SystemExit) as e:  # noqa: BLE001
        log(f"WARNING: could not read account info for {account_id} ({str(e)[:120]}) - set META_ACCOUNT_TIMEZONE to enable re-bucketing")
        return {}

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

CAMPAIGNS_ENABLED = os.environ.get("META_CAMPAIGNS", "1").strip() not in ("0", "false", "no")
CAMPAIGN_FIELDS = ["spend", "impressions", "reach", "clicks", "link_clicks", "add_to_cart",
                   "initiate_checkout", "purchases", "purchase_value"]
ATC_PRIORITY = ["omni_add_to_cart", "add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"]
IC_PRIORITY = ["omni_initiated_checkout", "initiate_checkout", "offsite_conversion.fb_pixel_initiate_checkout"]
# Campaign-name grammar used by Cattasaurus: "<Product> - <strategy> - <market> - <stage>".
MARKET_TOKENS = {"us": "US", "usa": "US", "ca": "CA", "canada": "CA", "uk": "UK", "au": "AU", "eu": "EU"}
STAGE_TOKENS = {"testing": "Testing", "test": "Testing", "test adset": "Testing", "scaling": "Scaling",
                "scale": "Scaling", "control": "Control", "retargeting": "Retargeting", "rt": "Retargeting"}


def parse_product_aliases():
    raw = os.environ.get("META_PRODUCT_ALIASES", "").strip()
    if not raw:
        return {}
    try:
        return {str(k).lower(): str(v) for k, v in (json.loads(raw) or {}).items()}
    except ValueError:
        log("META_PRODUCT_ALIASES is not valid JSON - ignoring")
        return {}


PRODUCT_ALIASES = parse_product_aliases()


def classify_campaign(name):
    """Split 'Peekaboo - Bidcap - Control - Low Bid - CA' into product/market/stage/strategy."""
    parts = [p.strip() for p in (name or "").split(" - ") if p.strip()]
    product = parts[0] if parts else (name or "?")
    low = (name or "").lower()
    for needle, label in PRODUCT_ALIASES.items():
        if needle in low:
            product = label
            break
    market, stage = None, None
    for p in parts[1:]:
        pl = p.lower()
        if pl in MARKET_TOKENS:
            market = MARKET_TOKENS[pl]
        for tok, label in STAGE_TOKENS.items():
            if pl == tok or pl.startswith(tok + " ") or pl.endswith(" " + tok):
                stage = label
    strategy = [p for p in parts[1:] if p.lower() not in MARKET_TOKENS and p.lower() not in STAGE_TOKENS]
    return {"product": product, "market": market or "US", "stage": stage or "Other", "strategy": " / ".join(strategy) or None}

# Graph API error codes that mean "slow down and retry".
RATE_LIMIT_CODES = {4, 17, 32, 613, 80000, 80004}
# Graph API error codes that mean "the token/account is wrong" - retrying won't help.
AUTH_ERROR_CODES = {10, 100, 190, 200, 270, 294}


# ---------------------------------------------------------------- history (shared block)
# Every fetcher keeps ONE file per source in the repo. A normal run refetches only the
# trailing WINDOW_DAYS and keeps every older day from the previous copy of the file, so
# data/<source>.json grows into a full history (HISTORY_START -> today). A one-off
# BACKFILL_START/BACKFILL_END run (workflow_dispatch inputs) fetches an arbitrary past
# range and merges it the same way - run it in a few chunks to build 2025 -> now.
HISTORY_START = os.environ.get("HISTORY_START", "2025-01-01").strip() or "2025-01-01"
BACKFILL_START = os.environ.get("BACKFILL_START", "").strip()
BACKFILL_END = os.environ.get("BACKFILL_END", "").strip()


def history_previous(path):
    """The copy of the output file already in the repo checkout (None on first run / bad JSON)."""
    try:
        with open(path) as f:
            prev = json.load(f)
        return prev if isinstance(prev, dict) and isinstance(prev.get("daily"), dict) else None
    except (OSError, ValueError):
        return None


def history_merge(previous, fetched_daily, fetched_start, fetched_end, key="daily"):
    """Days from the previous file that lie outside [fetched_start, fetched_end] (and on/after
    HISTORY_START) survive; the freshly fetched days replace everything inside the range."""
    merged = {}
    for day, row in ((previous or {}).get(key) or {}).items():
        if day >= HISTORY_START and (day < fetched_start or day > fetched_end):
            merged[day] = row
    merged.update(fetched_daily)
    return dict(sorted(merged.items()))


def history_meta(previous, mode, fetched_start, fetched_end, merged_daily, today_key):
    """Coverage report for the dashboard/sync logs: which days between HISTORY_START and today
    are still missing, and which backfill ranges have been run so far."""
    from datetime import date as _date
    backfills = list(((previous or {}).get("meta") or {}).get("history", {}).get("backfills") or [])
    if mode == "backfill":
        backfills.append({"start": fetched_start, "end": fetched_end, "run_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")})
        backfills = backfills[-60:]
    missing = []
    try:
        y, m, d = (int(x) for x in HISTORY_START.split("-"))
        cur = _date(y, m, d)
        y, m, d = (int(x) for x in today_key.split("-"))
        end = _date(y, m, d)
        while cur <= end:
            k = cur.isoformat()
            if k not in merged_daily:
                missing.append(k)
            cur += timedelta(days=1)
    except ValueError:
        pass
    return {
        "start": HISTORY_START,
        "mode": mode,
        "fetched": {"start": fetched_start, "end": fetched_end},
        "first_day": min(merged_daily) if merged_daily else None,
        "last_day": max(merged_daily) if merged_daily else None,
        "days": len(merged_daily),
        "missing_count": len(missing),
        "missing_days": missing[:60],
        "backfills": backfills,
    }


def backfill_range(today_key):
    """(start, end) 'YYYY-MM-DD' when this run is a backfill, else None. END defaults to today;
    both are validated so a typo in the workflow input cannot wipe the file."""
    if not BACKFILL_START:
        return None
    try:
        s = datetime.strptime(BACKFILL_START, "%Y-%m-%d")
        e = datetime.strptime(BACKFILL_END or today_key, "%Y-%m-%d")
    except ValueError:
        log(f"BACKFILL_START/BACKFILL_END must be YYYY-MM-DD (got {BACKFILL_START!r} / {BACKFILL_END!r})")
        sys.exit(1)
    if e < s:
        log("BACKFILL_END is before BACKFILL_START")
        sys.exit(1)
    return s.strftime("%Y-%m-%d"), e.strftime("%Y-%m-%d")


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


def parse_insights_rows(rows, daily, warnings, action_types_seen, rebucket=None):
    """Fold Graph API insights rows (one per day - or per hour when re-bucketing - level=account) into `daily`."""
    currency = None
    rebucket = rebucket or (lambda day, hour: day)
    for row in rows:
        day = row.get("date_start")
        if not day:
            warnings.add("insights row without date_start")
            continue
        day = rebucket(day, row.get(HOURLY_BREAKDOWN))
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


def fetch_insights(token, account_id, since, until, daily, warnings, action_types_seen, rebucket=None, converted=False):
    params = {
        "access_token": token,
        "level": "account",
        "time_increment": 1,
        "time_range": json.dumps({"since": since, "until": until}),
        "fields": "date_start,date_stop,account_currency,spend,impressions,clicks,actions,action_values",
        "limit": 500 if converted else 100,
    }
    if converted:
        params["breakdowns"] = HOURLY_BREAKDOWN
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
        currency = parse_insights_rows(rows, daily, warnings, action_types_seen, rebucket) or currency
        nxt = (resp.get("paging") or {}).get("next")
        log(f"page {page}: {len(rows)} rows, next={'yes' if nxt else 'no'}")
        if not nxt:
            break
        url, params = nxt, None  # paging.next already includes the access token + cursor
    return rows_total, currency


def new_campaign_bucket():
    return {f: 0 for f in CAMPAIGN_FIELDS}


def derive_campaign_metrics(d):
    """Add CPM/CPC/CTR/CPA/ROAS/AOV/frequency-friendly derived numbers in place."""
    sp, imp, lc, pur, val = d["spend"], d["impressions"], d["link_clicks"], d["purchases"], d["purchase_value"]
    d["cpm"] = round(sp / imp * 1000, 2) if imp else 0
    d["cpc"] = round(sp / lc, 2) if lc else 0
    d["ctr"] = round(lc / imp * 100, 3) if imp else 0
    d["cpa"] = round(sp / pur, 2) if pur else 0
    d["roas"] = round(val / sp, 4) if sp else 0
    d["aov"] = round(val / pur, 2) if pur else 0
    d["frequency"] = round(imp / d["reach"], 2) if d.get("reach") else 0
    for f in ("spend", "purchase_value"):
        d[f] = round(d[f], 2)
    return d


def fetch_campaign_meta(token, account_id):
    """Campaign objects: status, objective, budgets."""
    out = {}
    url = f"{GRAPH_HOST}/{API_VERSION}/{account_id}/campaigns"
    params = {"access_token": token, "limit": 200,
              "fields": "id,name,objective,effective_status,daily_budget,lifetime_budget,bid_strategy,start_time,stop_time"}
    while True:
        resp = graph_get(url, params) if params else graph_get(url, None)
        for c in resp.get("data", []) or []:
            out[c["id"]] = {
                "name": c.get("name"), "objective": c.get("objective"), "status": c.get("effective_status"),
                "daily_budget": (to_float(c.get("daily_budget")) / 100) if c.get("daily_budget") else None,
                "lifetime_budget": (to_float(c.get("lifetime_budget")) / 100) if c.get("lifetime_budget") else None,
                "bid_strategy": c.get("bid_strategy"),
            }
        nxt = (resp.get("paging") or {}).get("next")
        if not nxt:
            break
        url, params = nxt, None
    return out


def fetch_campaign_reach(token, account_id, since, until):
    """reach is a unique-user metric Meta only reports per whole account-tz day (not per hour);
    fetched separately when re-bucketing and attached to the same date key (approximation)."""
    out = {}
    url = f"{GRAPH_HOST}/{API_VERSION}/{account_id}/insights"
    params = {"access_token": token, "level": "campaign", "time_increment": 1,
              "time_range": json.dumps({"since": since, "until": until}),
              "fields": "campaign_id,date_start,reach", "limit": 500}
    while True:
        resp = graph_get(url, params) if params else graph_get(url, None)
        for row in resp.get("data", []) or []:
            out.setdefault(row.get("campaign_id"), {})[row.get("date_start")] = to_int(row.get("reach"))
        nxt = (resp.get("paging") or {}).get("next")
        if not nxt:
            break
        url, params = nxt, None
    return out


def fetch_campaign_insights(token, account_id, since, until, campaigns, warnings, rebucket=None, converted=False):
    """Daily rows per campaign -> campaigns[id]['daily'][date] buckets."""
    rebucket = rebucket or (lambda day, hour: day)
    fields = "campaign_id,campaign_name,date_start,spend,impressions,clicks,inline_link_clicks,actions,action_values"
    reach_by_day = {}
    if converted:
        reach_by_day = fetch_campaign_reach(token, account_id, since, until)
        warnings.add("Meta reach/frequency per campaign are by account-timezone day (Meta has no hourly reach) - spend/purchases are re-bucketed to " + REPORT_TIMEZONE)
    else:
        fields = fields.replace("impressions,clicks", "impressions,reach,clicks")
    params = {
        "access_token": token,
        "level": "campaign",
        "time_increment": 1,
        "time_range": json.dumps({"since": since, "until": until}),
        "fields": fields,
        "limit": 500,
    }
    if converted:
        params["breakdowns"] = HOURLY_BREAKDOWN
    if ATTRIBUTION:
        params["action_attribution_windows"] = json.dumps([w.strip() for w in ATTRIBUTION.split(",") if w.strip()])
    url = f"{GRAPH_HOST}/{API_VERSION}/{account_id}/insights"
    rows_total = 0
    while True:
        resp = graph_get(url, params) if params else graph_get(url, None)
        for row in resp.get("data", []) or []:
            cid = row.get("campaign_id")
            src_day = row.get("date_start")
            if not cid or not src_day:
                continue
            day = rebucket(src_day, row.get(HOURLY_BREAKDOWN))
            c = campaigns.setdefault(cid, {"name": row.get("campaign_name"), "daily": {}})
            c["name"] = c.get("name") or row.get("campaign_name")
            d = c["daily"].setdefault(day, new_campaign_bucket())
            d["spend"] += to_float(row.get("spend"))
            d["impressions"] += to_int(row.get("impressions"))
            if converted:
                r = reach_by_day.get(cid, {}).get(day)
                if r is not None and not d.get("_reach_set"):
                    d["reach"] = r
                    d["_reach_set"] = True
            else:
                d["reach"] += to_int(row.get("reach"))
            d["clicks"] += to_int(row.get("clicks"))
            d["link_clicks"] += to_int(row.get("inline_link_clicks"))
            _, atc = pick_action(row.get("actions"), ATC_PRIORITY)
            _, ic = pick_action(row.get("actions"), IC_PRIORITY)
            _, pur = pick_action(row.get("actions"), PURCHASE_ACTION_PRIORITY)
            _, val = pick_action(row.get("action_values"), PURCHASE_ACTION_PRIORITY)
            d["add_to_cart"] += atc
            d["initiate_checkout"] += ic
            d["purchases"] += pur
            d["purchase_value"] += val
            rows_total += 1
        nxt = (resp.get("paging") or {}).get("next")
        if not nxt:
            break
        url, params = nxt, None
    return rows_total


DERIVED_FIELDS = ("cpm", "cpc", "ctr", "cpa", "roas", "aov", "frequency")


def date_chunks(since, until, max_days=92):
    """[(since, until), ...] slices of at most max_days for the Graph API (long ranges time out)."""
    out = []
    cur = datetime.strptime(since, "%Y-%m-%d")
    end = datetime.strptime(until, "%Y-%m-%d")
    while cur <= end:
        nxt = min(cur + timedelta(days=max_days - 1), end)
        out.append((cur.strftime("%Y-%m-%d"), nxt.strftime("%Y-%m-%d")))
        cur = nxt + timedelta(days=1)
    return out


def merge_campaign_history(previous, campaigns, fetched_start, fetched_end):
    """Campaign day rows from the previous file outside [fetched_start, fetched_end] survive; the
    fetched ones replace. Old rows are kept slim (raw fields only - the dashboard derives the rest)."""
    for cid, pc in ((previous or {}).get("campaigns") or {}).items():
        keep = {day: {k: v for k, v in row.items() if k not in DERIVED_FIELDS}
                for day, row in (pc.get("daily") or {}).items()
                if day >= HISTORY_START and (day < fetched_start or day > fetched_end)}
        if not keep:
            continue
        c = campaigns.setdefault(cid, {"name": pc.get("name"), "daily": {}})
        c["name"] = c.get("name") or pc.get("name")
        for day, row in keep.items():
            c["daily"].setdefault(day, row)
    for c in campaigns.values():
        c["daily"] = dict(sorted(c["daily"].items()))
    return campaigns


def finalise_campaigns(campaigns, meta_by_id, window_start, window_end, last30_start):
    for cid, c in campaigns.items():
        info = meta_by_id.get(cid, {})
        c.update({k: v for k, v in info.items() if k != "name"})
        c["name"] = c.get("name") or info.get("name")
        c.update(classify_campaign(c["name"]))
        for day, d in c["daily"].items():
            if window_start <= day <= window_end:
                derive_campaign_metrics(d)   # history rows stay slim
        tot = new_campaign_bucket()
        l30 = new_campaign_bucket()
        for day, d in c["daily"].items():
            for f in CAMPAIGN_FIELDS:
                tot[f] += d[f]
                if day >= last30_start:
                    l30[f] += d[f]
        c["window"] = derive_campaign_metrics(tot)
        c["last_30d"] = derive_campaign_metrics(l30)
    # roll-up by product for the window
    products = {}
    for c in campaigns.values():
        p = products.setdefault(c["product"], {"campaigns": 0, **new_campaign_bucket()})
        p["campaigns"] += 1
        for f in CAMPAIGN_FIELDS:
            p[f] += c["window"][f]
    for p in products.values():
        derive_campaign_metrics(p)
    return products


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
    now_local = now.astimezone(ZoneInfo(REPORT_TIMEZONE)) if ZoneInfo else now
    today_key = now_local.strftime("%Y-%m-%d")
    bf = backfill_range(today_key)
    if bf:
        mode = "backfill"
        keep_from, keep_to = bf
        since = (datetime.strptime(keep_from, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
        until = (datetime.strptime(keep_to, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
    else:
        mode = "rolling"
        # one day wider on each side (account calendar) so re-bucketed edge days are complete; trimmed below
        since = (now - timedelta(days=WINDOW_DAYS + 1)).strftime("%Y-%m-%d")
        until = (now + timedelta(days=1)).strftime("%Y-%m-%d")
        keep_from = (now_local - timedelta(days=WINDOW_DAYS)).strftime("%Y-%m-%d")
        keep_to = today_key
    chunks = date_chunks(since, until)
    log(f"{mode} {keep_from}..{keep_to} in {len(chunks)} slice(s); history from {HISTORY_START}")

    daily, warnings, action_types_seen = {}, set(), set()
    rows_total, currency = 0, None
    per_account, rebuckets = {}, {}
    for account_id in account_ids:
        info = fetch_account_info(token, account_id)
        rebucket, converted = make_rebucket(info.get("timezone_name"))
        rebuckets[account_id] = (rebucket, converted)
        log(f"Fetching {account_id} insights {since}..{until} via {API_VERSION} (account tz {info.get('timezone_name')}, "
            f"{'re-bucketing hourly to ' + REPORT_TIMEZONE if converted else 'no tz conversion needed'})...")
        acct_daily = {}
        n_rows, acct_currency = 0, None
        for c_since, c_until in chunks:
            n, cur = fetch_insights(token, account_id, c_since, c_until, acct_daily, warnings, action_types_seen, rebucket, converted)
            n_rows += n
            acct_currency = acct_currency or cur
        for day in [k for k in acct_daily if k < keep_from or k > keep_to]:
            acct_daily.pop(day)
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
            "time_zone": info.get("timezone_name"),
            "rebucketed_to": REPORT_TIMEZONE if converted else None,
            "days": len(acct_daily),
            "last_30d": sum_range(acct_daily, (now_local - timedelta(days=30)).strftime("%Y-%m-%d"), keep_to),
        }
    finalise(daily)
    # merge with the copy already in the repo: days outside the fetched range are kept
    previous = history_previous(OUTPUT_PATH)
    daily = history_merge(previous, daily, keep_from, keep_to)
    hist = history_meta(previous, mode, keep_from, keep_to, daily, today_key)
    log(f"History: {hist['first_day']}..{hist['last_day']} ({hist['days']} days, {hist['missing_count']} missing since {HISTORY_START})")

    campaigns, products, campaign_rows = {}, {}, 0
    if CAMPAIGNS_ENABLED:
        last30 = (now_local - timedelta(days=30)).strftime("%Y-%m-%d")
        meta_by_id = {}
        for account_id in account_ids:
            try:
                meta_by_id.update(fetch_campaign_meta(token, account_id))
                log(f"Fetching {account_id} campaign-level insights...")
                rb, cv = rebuckets.get(account_id, (None, False))
                for c_since, c_until in chunks:
                    campaign_rows += fetch_campaign_insights(token, account_id, c_since, c_until, campaigns, warnings, rb, cv)
            except SystemExit:
                raise
            except Exception as e:  # noqa: BLE001 - campaign detail must never break the account-level file
                warnings.add(f"campaign-level fetch failed for {account_id}: {str(e)[:200]}")
        for c in campaigns.values():
            for day in [k for k in c["daily"] if k < keep_from or k > keep_to]:
                c["daily"].pop(day)
            for d in c["daily"].values():
                d.pop("_reach_set", None)
        merge_campaign_history(previous, campaigns, keep_from, keep_to)
        products = finalise_campaigns(campaigns, meta_by_id, keep_from, keep_to, last30)
        log(f"Campaigns: {len(campaigns)} ({campaign_rows} daily rows), products: {sorted(products)}")

    since, until = keep_from, keep_to
    mtd_start = now_local.strftime("%Y-%m-01")
    last30_start = (now_local - timedelta(days=30)).strftime("%Y-%m-%d")

    out = {
        "source": "meta_marketing_api",
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ad_account_id": ",".join(account_ids),
        "ad_account_ids": account_ids,
        "api_version": API_VERSION,
        "currency": currency or "USD",
        "attribution": ATTRIBUTION or "account default",
        "timezone": REPORT_TIMEZONE,
        "window_days": WINDOW_DAYS,
        "daily": daily,
        "totals": {
            "today": sum_range(daily, today_key, today_key),
            "mtd": sum_range(daily, mtd_start, today_key),
            "last_30d": sum_range(daily, last30_start, today_key),
        },
        "campaigns": campaigns,
        "products": products,
        "meta": {
            "schema": 2 if CAMPAIGNS_ENABLED else 1,
            "script_version": "2.3",   # 2.3 = history kept across runs + backfill mode (<= 92-day slices)
            "history": hist,
            "campaign_rows": campaign_rows,
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
