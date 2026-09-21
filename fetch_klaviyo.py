#!/usr/bin/env python3
"""
Cattasaurus - Klaviyo (email + SMS marketing) fetcher.

Runs on a schedule (GitHub Actions) completely independently of Claude. Pulls from the Klaviyo
API (https://a.klaviyo.com/api, header "Authorization: Klaviyo-API-Key pk_...", a read-only
private key) what the P&L dashboard needs to judge the email/SMS channel:

  1. Klaviyo-ATTRIBUTED revenue per day (Query Metric Aggregates on the "Placed Order" metric,
     grouped by $attributed_channel and $attributed_flow): how much of the store's revenue
     Klaviyo attributes to an email / SMS / push message, split campaigns vs flows. This is an
     attribution figure like Meta's "purchases" - it is NOT added to revenue (the orders are
     already counted from Shopify); the dashboard shows it as email efficiency next to the
     other channels. Uses the account's own attribution window (Klaviyo default: 5-day click
     for email, 1-day click for SMS - Settings > Attribution).
  2. Campaign performance (Query Campaign Values): recipients, delivered, unique opens/clicks,
     orders, attributed revenue, unsubscribes per campaign in the window.
  3. Flow performance (Query Flow Values): the same per flow (welcome, abandoned cart, ...).
  4. Total store revenue seen by Klaviyo (all Placed Order events) per day, so the share
     "attributed / total" is computed on the same basis.

Days are bucketed in REPORT_TIMEZONE (America/Los_Angeles, the calendar every other source
uses). Rolling runs refetch WINDOW_DAYS and keep older days (shared history block); a manual
run with BACKFILL_START/BACKFILL_END fills a past range (metric aggregates go back 5 years,
1 year per query; campaign/flow reports accept a custom timeframe of at most 1 year).

Environment:
  KLAVIYO_API_KEY                 private key (pk_...) with read scopes: metrics, campaigns, flows
  KLAVIYO_REVISION                API revision header (default 2024-10-15)
  KLAVIYO_CONVERSION_METRIC_ID    override the auto-detected "Placed Order" metric id
  REPORT_TIMEZONE                 default America/Los_Angeles
  WINDOW_DAYS                     default 45
  OUTPUT_PATH                     default data/klaviyo.json
  HISTORY_START / BACKFILL_START / BACKFILL_END   see the history block
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

API_KEY = os.environ.get("KLAVIYO_API_KEY", "").strip()
BASE_URL = os.environ.get("KLAVIYO_BASE_URL", "https://a.klaviyo.com").rstrip("/")
REVISION = os.environ.get("KLAVIYO_REVISION", "2024-10-15").strip()
CONVERSION_METRIC_ID = os.environ.get("KLAVIYO_CONVERSION_METRIC_ID", "").strip()
TZ_NAME = os.environ.get("REPORT_TIMEZONE", "America/Los_Angeles")
WINDOW_DAYS = int(os.environ.get("WINDOW_DAYS", "45"))
OUTPUT_PATH = os.environ.get("OUTPUT_PATH", "data/klaviyo.json")
AGG_CHUNK_DAYS = int(os.environ.get("KLAVIYO_AGG_CHUNK_DAYS", "90"))   # metric aggregates: <= 1 year per query, keep it small
SCRIPT_VERSION = "1.0"
SCHEMA = 1

CHANNELS = ("email", "sms", "push")
DAILY_FIELDS = [
    "store_revenue", "store_orders",                       # every Placed Order Klaviyo sees (its copy of Shopify orders)
    "attributed_revenue", "attributed_orders",             # sum over channels
    "campaign_revenue", "campaign_orders",                 # attributed to a campaign message
    "flow_revenue", "flow_orders",                         # attributed to a flow message
] + [f"{c}_revenue" for c in CHANNELS] + [f"{c}_orders" for c in CHANNELS]
CAMPAIGN_STATS = ["recipients", "delivered", "opens_unique", "clicks_unique", "conversions", "conversion_uniques",
                  "conversion_value", "unsubscribes", "bounced", "spam_complaints"]

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
    print(f"[klaviyo] {msg}", flush=True)


# ---------------------------------------------------------------- HTTP
class Client:
    def __init__(self, api_key):
        self.api_key = api_key
        self.requests = 0
        self.retries = 0

    def call(self, method, path, params=None, body=None, max_retries=6):
        url = f"{BASE_URL}{path}"
        if params:
            url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params, doseq=True)
        data = json.dumps(body).encode() if body is not None else None
        for attempt in range(1, max_retries + 1):
            req = urllib.request.Request(url, data=data, method=method, headers={
                "Authorization": f"Klaviyo-API-Key {self.api_key}",
                "revision": REVISION,
                "Accept": "application/vnd.api+json",
                "Content-Type": "application/vnd.api+json",
                "User-Agent": "cattasaurus-klaviyo-sync/" + SCRIPT_VERSION,
            })
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    self.requests += 1
                    return json.loads(resp.read().decode() or "{}")
            except urllib.error.HTTPError as e:
                self.requests += 1
                text = e.read().decode(errors="replace")
                if e.code in (401, 403):
                    log(f"Klaviyo rejected the API key (HTTP {e.code}): {text[:300]}")
                    log("Check the KLAVIYO_API_KEY secret: a private key (pk_...) with read access to Metrics, Campaigns and Flows.")
                    raise SystemExit(2)
                if e.code == 429 or e.code >= 500:
                    backoff = min(120, 5 * (2 ** (attempt - 1)))
                    ra = e.headers.get("Retry-After")
                    if ra:
                        try:
                            backoff = max(backoff, float(ra))
                        except ValueError:
                            pass
                    self.retries += 1
                    log(f"HTTP {e.code} - retry {attempt}/{max_retries} in {backoff:.0f}s: {text[:160]}")
                    time.sleep(backoff)
                    continue
                log(f"HTTP {e.code} on {method} {path}: {text[:600]}")
                raise
            except urllib.error.URLError as e:
                self.retries += 1
                log(f"Network error ({e.reason}) - retry {attempt}/{max_retries}")
                time.sleep(min(60, 5 * attempt))
        raise RuntimeError("Exceeded retries calling Klaviyo")

    def get_all(self, path, params=None, max_pages=50):
        """Follow JSON:API cursor pagination (links.next)."""
        out = []
        url_path, p = path, dict(params or {})
        for _ in range(max_pages):
            res = self.call("GET", url_path, p)
            out.extend(res.get("data") or [])
            nxt = (res.get("links") or {}).get("next")
            if not nxt:
                break
            url_path, p = nxt.replace(BASE_URL, ""), None
        return out


# ---------------------------------------------------------------- helpers
def new_bucket():
    return {f: 0 for f in DAILY_FIELDS}


def r2(x):
    return round(float(x or 0), 2)


def find_conversion_metric(client, warnings):
    """The "Placed Order" metric (Shopify integration preferred) - what Klaviyo attributes revenue to."""
    if CONVERSION_METRIC_ID:
        return CONVERSION_METRIC_ID, "(from KLAVIYO_CONVERSION_METRIC_ID)"
    metrics = client.get_all("/api/metrics/", {"fields[metric]": "name,integration"})
    placed = [m for m in metrics if (m.get("attributes") or {}).get("name") == "Placed Order"]
    if not placed:
        raise SystemExit("no 'Placed Order' metric in this Klaviyo account - set KLAVIYO_CONVERSION_METRIC_ID")
    def integ(m):
        return ((m.get("attributes") or {}).get("integration") or {}).get("name") or ""
    placed.sort(key=lambda m: (0 if integ(m).lower() == "shopify" else 1, m.get("id")))
    if len(placed) > 1:
        warnings.add("several 'Placed Order' metrics: " + ", ".join(f"{m['id']} ({integ(m) or 'no integration'})" for m in placed) + f" - using {placed[0]['id']}")
    return placed[0]["id"], f"Placed Order ({integ(placed[0]) or 'no integration'})"


def local_iso(day_key, tz):
    """'YYYY-MM-DD' -> naive local datetime string Klaviyo expects with the timezone parameter."""
    return f"{day_key}T00:00:00"


def metric_aggregates_daily(client, metric_id, start_key, end_key, tz, daily, warnings):
    """Placed Order per day, grouped by attributed channel + attributed flow, in <= AGG_CHUNK_DAYS chunks.
    Klaviyo returns one series per (channel, flow) pair; '' channel = not attributed to Klaviyo."""
    cur = datetime.strptime(start_key, "%Y-%m-%d")
    end = datetime.strptime(end_key, "%Y-%m-%d") + timedelta(days=1)   # exclusive
    chunks = 0
    while cur < end:
        nxt = min(cur + timedelta(days=AGG_CHUNK_DAYS), end)
        body = {"data": {"type": "metric-aggregate", "attributes": {
            "metric_id": metric_id,
            "measurements": ["count", "sum_value"],
            "interval": "day",
            "timezone": TZ_NAME,
            "filter": [f"greater-or-equal(datetime,{cur.strftime('%Y-%m-%dT%H:%M:%S')})",
                       f"less-than(datetime,{nxt.strftime('%Y-%m-%dT%H:%M:%S')})"],
            "by": ["$attributed_channel", "$attributed_flow"],
            "page_size": 500,
        }}}
        res = client.call("POST", "/api/metric-aggregates/", body=body)
        attrs = (res.get("data") or {}).get("attributes") or {}
        dates = attrs.get("dates") or []
        for series in attrs.get("data") or []:
            dims = series.get("dimensions") or []
            channel = (dims[0] if len(dims) > 0 else "") or ""
            flow = (dims[1] if len(dims) > 1 else "") or ""
            counts = (series.get("measurements") or {}).get("count") or []
            sums = (series.get("measurements") or {}).get("sum_value") or []
            for i, dt in enumerate(dates):
                day = dt[:10]
                if day < start_key or day > end_key:
                    continue
                b = daily.setdefault(day, new_bucket())
                c = float(counts[i] or 0) if i < len(counts) else 0.0
                v = float(sums[i] or 0) if i < len(sums) else 0.0
                b["store_revenue"] += v
                b["store_orders"] += c
                if not channel:
                    continue
                key = channel.lower()
                if key not in CHANNELS:
                    warnings.add(f"unknown attributed channel '{channel}' counted in attributed totals only")
                else:
                    b[f"{key}_revenue"] += v
                    b[f"{key}_orders"] += c
                b["attributed_revenue"] += v
                b["attributed_orders"] += c
                if flow:
                    b["flow_revenue"] += v
                    b["flow_orders"] += c
                else:
                    b["campaign_revenue"] += v
                    b["campaign_orders"] += c
        chunks += 1
        cur = nxt
    # every requested day exists, even with no orders
    d = datetime.strptime(start_key, "%Y-%m-%d")
    while d.strftime("%Y-%m-%d") <= end_key:
        daily.setdefault(d.strftime("%Y-%m-%d"), new_bucket())
        d += timedelta(days=1)
    return chunks


def values_report(client, kind, metric_id, start_key, end_key, warnings):
    """kind = 'campaign' | 'flow'. One values report over the window (<= 1 year), grouped by the
    entity + message + channel; rows are summed per entity."""
    body = {"data": {"type": f"{kind}-values-report", "attributes": {
        "statistics": CAMPAIGN_STATS,
        "timeframe": {"start": f"{start_key}T00:00:00", "end": f"{end_key}T23:59:59"},
        "conversion_metric_id": metric_id,
    }}}
    try:
        res = client.call("POST", f"/api/{kind}-values-reports/", body=body)
    except urllib.error.HTTPError as e:
        warnings.add(f"{kind} values report failed (HTTP {e.code}) - {kind} table incomplete")
        return {}
    rows = ((res.get("data") or {}).get("attributes") or {}).get("results") or []
    out = {}
    id_key = f"{kind}_id"
    for row in rows:
        g = row.get("groupings") or {}
        ent = g.get(id_key)
        if not ent:
            continue
        t = out.setdefault(ent, {"channel": g.get("send_channel") or "", "messages": 0, **{s: 0.0 for s in CAMPAIGN_STATS}})
        t["messages"] += 1
        for s, v in (row.get("statistics") or {}).items():
            if s in t and isinstance(v, (int, float)):
                t[s] += float(v)
    for t in out.values():
        for s in CAMPAIGN_STATS:
            t[s] = r2(t[s])
        t["open_rate"] = round(t["opens_unique"] / t["delivered"], 4) if t["delivered"] else 0
        t["click_rate"] = round(t["clicks_unique"] / t["delivered"], 4) if t["delivered"] else 0
        t["revenue_per_recipient"] = round(t["conversion_value"] / t["recipients"], 4) if t["recipients"] else 0
    return out


def campaign_names(client, start_key, warnings):
    names = {}
    for channel in ("email", "sms"):
        try:
            items = client.get_all("/api/campaigns/", {
                "filter": f"and(equals(messages.channel,'{channel}'),greater-or-equal(scheduled_at,{start_key}T00:00:00Z))",
                "fields[campaign]": "name,status,send_time,scheduled_at,archived",
            })
        except urllib.error.HTTPError as e:
            warnings.add(f"campaign list ({channel}) failed HTTP {e.code} - names missing")
            continue
        for c in items:
            a = c.get("attributes") or {}
            names[c["id"]] = {"name": a.get("name"), "status": a.get("status"), "send_time": (a.get("send_time") or a.get("scheduled_at") or "")[:19], "channel": channel}
    return names


def flow_names(client, warnings):
    try:
        items = client.get_all("/api/flows/", {"fields[flow]": "name,status,trigger_type,archived"})
    except urllib.error.HTTPError as e:
        warnings.add(f"flow list failed HTTP {e.code} - names missing")
        return {}
    return {f["id"]: {"name": (f.get("attributes") or {}).get("name"), "status": (f.get("attributes") or {}).get("status"),
                      "trigger_type": (f.get("attributes") or {}).get("trigger_type")} for f in items}


def merge_entities(previous, key, fresh, fetched_start, fetched_end):
    """Campaign / flow tables: keep entries from the previous file that were not refetched; the
    window's entries replace. Each entry carries the window it was last measured over."""
    merged = dict(((previous or {}).get(key) or {}))
    for k, v in fresh.items():
        merged[k] = {**v, "window": {"start": fetched_start, "end": fetched_end}}
    return merged


def sum_range(daily, a, b):
    out = new_bucket()
    for k, d in daily.items():
        if a <= k <= b:
            for f in DAILY_FIELDS:
                out[f] += d.get(f, 0)
    for f in DAILY_FIELDS:
        out[f] = r2(out[f])
    return out


def main():
    if not API_KEY:
        log("KLAVIYO_API_KEY is not set"); sys.exit(1)
    tz = ZoneInfo(TZ_NAME) if ZoneInfo else timezone.utc
    now_utc = datetime.now(timezone.utc)
    now_local = now_utc.astimezone(tz)
    today_key = now_local.strftime("%Y-%m-%d")
    bf = backfill_range(today_key)
    if bf:
        window_start, window_end, mode = bf[0], bf[1], "backfill"
    else:
        window_start, window_end, mode = (now_local - timedelta(days=WINDOW_DAYS)).strftime("%Y-%m-%d"), today_key, "rolling"
    warnings = set()
    client = Client(API_KEY)
    log(f"Klaviyo {BASE_URL} rev {REVISION}, tz {TZ_NAME}, {mode} {window_start}..{window_end}, history from {HISTORY_START}")
    metric_id, metric_label = find_conversion_metric(client, warnings)
    log(f"Conversion metric: {metric_label} [{metric_id}]")

    daily = {}
    chunks = metric_aggregates_daily(client, metric_id, window_start, window_end, tz, daily, warnings)
    for d in daily.values():
        for f in DAILY_FIELDS:
            d[f] = r2(d[f]) if "revenue" in f else int(round(d[f]))
    campaigns = values_report(client, "campaign", metric_id, window_start, window_end, warnings)
    flows = values_report(client, "flow", metric_id, window_start, window_end, warnings)
    cnames = campaign_names(client, (datetime.strptime(window_start, "%Y-%m-%d") - timedelta(days=7)).strftime("%Y-%m-%d"), warnings)
    fnames = flow_names(client, warnings)
    for cid, c in campaigns.items():
        c.update({k: v for k, v in (cnames.get(cid) or {}).items() if k != "channel"})
        c["name"] = c.get("name") or cid
    for fid, f in flows.items():
        f.update(fnames.get(fid) or {})
        f["name"] = f.get("name") or fid

    previous = history_previous(OUTPUT_PATH)
    merged_daily = history_merge(previous, daily, window_start, window_end)
    hist = history_meta(previous, mode, window_start, window_end, merged_daily, today_key)
    campaigns = merge_entities(previous, "campaigns", campaigns, window_start, window_end)
    flows = merge_entities(previous, "flows", flows, window_start, window_end)
    log(f"History: {hist['first_day']}..{hist['last_day']} ({hist['days']} days, {hist['missing_count']} missing since {HISTORY_START})")

    mtd_start = now_local.strftime("%Y-%m-01")
    last30_start = (now_local - timedelta(days=30)).strftime("%Y-%m-%d")
    out = {
        "source": "klaviyo_api",
        "generated_at": now_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "timezone": TZ_NAME,
        "currency": "USD",
        "window_days": WINDOW_DAYS,
        "window": {"start": window_start, "end": window_end},
        "daily": merged_daily,
        "campaigns": campaigns,
        "flows": flows,
        "totals": {
            "today": sum_range(merged_daily, today_key, today_key),
            "mtd": sum_range(merged_daily, mtd_start, today_key),
            "last_30d": sum_range(merged_daily, last30_start, today_key),
        },
        "meta": {
            "script_version": SCRIPT_VERSION, "schema": SCHEMA,
            "history": hist,
            "conversion_metric": {"id": metric_id, "label": metric_label},
            "attribution": "Klaviyo's own attribution (account setting, default 5-day click for email, 1-day for SMS); attributed revenue overlaps with ads attribution and is NOT added to P&L revenue",
            "basis": "daily = Placed Order events by day in REPORT_TIMEZONE grouped by $attributed_channel / $attributed_flow; campaigns/flows = values reports over the fetched window",
            "aggregate_chunks": chunks, "api_requests": client.requests, "api_retries": client.retries,
            "campaigns_in_window": sum(1 for c in campaigns.values() if c.get("window", {}).get("end") == window_end),
            "flows_in_window": sum(1 for f in flows.values() if f.get("window", {}).get("end") == window_end),
            "warnings": sorted(warnings),
        },
    }
    os.makedirs(os.path.dirname(OUTPUT_PATH) or ".", exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
    t = out["totals"]["last_30d"]
    log(f"Wrote {OUTPUT_PATH}: {len(merged_daily)} days; last 30d attributed {t['attributed_revenue']:.2f} of store {t['store_revenue']:.2f} "
        f"(campaigns {t['campaign_revenue']:.2f}, flows {t['flow_revenue']:.2f}); {len(campaigns)} campaigns, {len(flows)} flows; "
        f"{client.requests} API calls, {len(warnings)} warning types")


if __name__ == "__main__":
    main()
