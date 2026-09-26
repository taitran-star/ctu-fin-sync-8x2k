#!/usr/bin/env python3
"""Amazon Subscribe & Save (S&S) orders + Replenishment metrics -> data/amazon_sns.json

What it pulls (SP-API, same app/secrets as fetch_amazon_pnl.py):
  1. Orders API v0 getOrders (FBA, Amazon.com) -> getOrderItems for each new order. An order item that
     belongs to S&S carries AmazonPrograms.Programs = ["SUBSCRIBE_AND_SAVE"] - the same flag Seller Central
     uses for "Order type: Subscribe & Save". There is no S&S flag on the order itself or in the All Orders
     report, so every order is checked once; the result is remembered in `checked` so later runs only look
     at new or updated orders.
  2. Replenishment API v2022-11-07 (the replacement for the retired GET_FBA_SNS_* reports):
     getSellingPartnerMetrics (weekly totals) and listOfferMetrics (per ASIN, last weeks + 30/60/90-day
     forecast). A 403 here only means the app lacks the role - orders are still written.

Rate limits: getOrders 1/min (burst 20), getOrderItems 0.5/s (burst 30), Replenishment 1/s.
First run: backfills BACKFILL_DAYS (default 30) - a few thousand orders, so it is spread over several runs
by MAX_ITEM_CALLS (a queue in meta.queue carries the rest). After that each run lists orders updated since
the previous run (LastUpdatedAfter) - a few minutes.

Output (schema 1):
  weeks:   {"2026-W39": {week, start, end, orders:[{id, date, time, purchase_date, status, sku, asin, title,
            qty, price, promo, currency}]}}      - one line per S&S order item, ISO week Mon-Sun in REPORT_TIMEZONE
  metrics: {"2026-W39": {week, start, end, amazon_interval, totals:{...}, by_asin:[{asin, sku, ...}]}}
  forecast: {fetched_at, by_asin:[{asin, sku, next30DayTotalSubscriptionsRevenue, ...}]}
  checked: {order_id: [purchase day, 1 if S&S else 0]}   - last KEEP_CHECKED_DAYS
  meta:    {generated_at, timezone, mode, listed, item_calls, queue:[...], warnings, replenishment:{ok, error}}
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_amazon_pnl as base  # noqa: E402  (LWA token, rate limiter, SP host, marketplace, timezone)

SCRIPT_VERSION = "sns-1.0"
OUTPUT_PATH = os.environ.get("OUTPUT_PATH", "data/amazon_sns.json")
BACKFILL_DAYS = int(os.environ.get("BACKFILL_DAYS", "30") or 30)
MAX_ITEM_CALLS = int(os.environ.get("MAX_ITEM_CALLS", "1600") or 1600)      # ~2.1 s each -> ~56 min
TIME_BUDGET_MIN = float(os.environ.get("TIME_BUDGET_MIN", "75") or 75)      # stop item calls in time to write the file
KEEP_CHECKED_DAYS = int(os.environ.get("KEEP_CHECKED_DAYS", "45") or 45)
OVERLAP_HOURS = int(os.environ.get("OVERLAP_HOURS", "6") or 6)
METRIC_WEEKS = int(os.environ.get("METRIC_WEEKS", "12") or 12)             # weekly totals window
OFFER_WEEKS = int(os.environ.get("OFFER_WEEKS", "4") or 4)                 # per-ASIN weeks refreshed each run
FORCE_BACKFILL = os.environ.get("FORCE_BACKFILL", "0").strip() in ("1", "true", "yes")
SKIP_METRICS = os.environ.get("SKIP_METRICS", "0").strip() in ("1", "true", "yes")
TZ = base.REPORT_TZ
MARKETPLACE = base.MARKETPLACE_IDS[0]
SNS = "SUBSCRIBE_AND_SAVE"
ALL_METRICS = ["SHIPPED_SUBSCRIPTION_UNITS", "TOTAL_SUBSCRIPTIONS_REVENUE", "ACTIVE_SUBSCRIPTIONS",
               "NOT_DELIVERED_DUE_TO_OOS", "SUBSCRIBER_NON_SUBSCRIBER_AVERAGE_REVENUE", "LOST_REVENUE_DUE_TO_OOS",
               "SUBSCRIBER_NON_SUBSCRIBER_AVERAGE_REORDERS", "COUPONS_REVENUE_PENETRATION", "REVENUE_BY_DELIVERIES",
               "SUBSCRIBER_RETENTION", "REVENUE_PENETRATION_BY_SELLER_FUNDING", "SHARE_OF_COUPON_SUBSCRIPTIONS",
               "SUBSCRIBER_LIFETIME_VALUE_BY_CUSTOMER_SEGMENT", "SIGNUP_CONVERSION_BY_SELLER_FUNDING",
               "REVENUE_PENETRATION"]


def log(msg):
    print(f"[amazon_sns] {msg}", file=sys.stderr, flush=True)


class ApiError(Exception):
    def __init__(self, code, body):
        super().__init__(f"HTTP {code}: {body[:300]}")
        self.code = code
        self.body = body


def call(method, path, token, params=None, body=None, min_gap=2.1, backoffs=(5, 10, 20, 40, 60)):
    """GET/POST with its own pacing. getOrders needs long waits (1 request/minute after the burst)."""
    qs = f"?{urllib.parse.urlencode(params)}" if params else ""
    url = f"{base.SP_API_HOST}{path}{qs}"
    data = json.dumps(body).encode() if body is not None else None
    for attempt in range(len(backoffs) + 1):
        now = time.monotonic()
        gap = now - call.last.get(path.split("/")[1] + method, 0)
        if gap < min_gap:
            time.sleep(min_gap - gap)
        call.last[path.split("/")[1] + method] = time.monotonic()
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("x-amz-access-token", token)
        req.add_header("Accept", "application/json")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            err = e.read().decode(errors="replace")
            if (e.code == 429 or e.code >= 500) and attempt < len(backoffs):
                wait = backoffs[attempt]
                log(f"HTTP {e.code} on {method} {path}, retry in {wait}s")
                time.sleep(wait)
                continue
            raise ApiError(e.code, err)
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < len(backoffs):
                time.sleep(backoffs[attempt])
                continue
            raise ApiError(0, str(e))
    raise ApiError(0, "retries exhausted")


call.last = {}


def to_local(iso_str):
    dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00")).astimezone(TZ)
    return dt


def iso_week(d):
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def week_bounds(d):
    start = d - timedelta(days=d.weekday())
    return start, start + timedelta(days=6)


def money(m):
    try:
        return round(float((m or {}).get("Amount") or 0), 2)
    except (TypeError, ValueError):
        return 0.0


# ---------------------------------------------------------------------------------------------- orders
def list_orders(token, created_after=None, updated_after=None):
    now_utc = datetime.now(timezone.utc) - timedelta(minutes=3)
    params = {"MarketplaceIds": MARKETPLACE, "FulfillmentChannels": "AFN", "MaxResultsPerPage": 100}
    if updated_after:
        params["LastUpdatedAfter"] = updated_after.strftime("%Y-%m-%dT%H:%M:%SZ")
        params["LastUpdatedBefore"] = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    else:
        params["CreatedAfter"] = created_after.strftime("%Y-%m-%dT%H:%M:%SZ")
        params["CreatedBefore"] = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    out, pages, next_token = [], 0, None
    while True:
        p = {"MarketplaceIds": MARKETPLACE, "NextToken": next_token} if next_token else params
        # burst 20, then 1 per minute: keep 2.1 s apart and wait a full minute on 429
        res = call("GET", "/orders/v0/orders", token, p, min_gap=2.1, backoffs=(61, 61, 61, 61, 61, 61))
        pages += 1
        payload = res.get("payload") or {}
        for o in payload.get("Orders", []):
            if (o.get("SalesChannel") or "").lower() == "non-amazon":
                continue   # MCF (Shopify orders shipped by FBA)
            out.append({"id": o["AmazonOrderId"], "purchase_date": o.get("PurchaseDate"),
                        "status": o.get("OrderStatus"), "last_update": o.get("LastUpdateDate")})
        next_token = payload.get("NextToken")
        if pages % 10 == 0:
            log(f"getOrders: {pages} pages, {len(out)} orders so far")
        if not next_token:
            break
    log(f"getOrders: {len(out)} FBA orders over {pages} page(s)")
    return out


def order_items(token, order_id):
    items, next_token = [], None
    while True:
        p = {"NextToken": next_token} if next_token else None
        res = call("GET", f"/orders/v0/orders/{order_id}/orderItems", token, p, min_gap=2.05)
        payload = res.get("payload") or {}
        items.extend(payload.get("OrderItems", []))
        next_token = payload.get("NextToken")
        if not next_token:
            return items


def sns_lines(order, items):
    lt = to_local(order["purchase_date"])
    lines = []
    for it in items:
        progs = ((it.get("AmazonPrograms") or {}).get("Programs")) or []
        if SNS not in progs:
            continue
        price = it.get("ItemPrice")
        lines.append({
            "id": order["id"], "date": lt.strftime("%Y-%m-%d"), "time": lt.strftime("%H:%M"),
            "purchase_date": order["purchase_date"], "status": order.get("status"),
            "sku": it.get("SellerSKU"), "asin": it.get("ASIN"), "title": (it.get("Title") or "")[:140],
            "qty": int(it.get("QuantityOrdered") or 0),
            "price": money(price) if price else None,
            "promo": money(it.get("PromotionDiscount")) if it.get("PromotionDiscount") else 0.0,
            "currency": (price or {}).get("CurrencyCode") or "USD",
            "order_item_id": it.get("OrderItemId"),
        })
    return lines


# ---------------------------------------------------------------------------------------------- metrics
def iso_z(d):
    return d.strftime("%Y-%m-%dT00:00:00Z")


def fetch_metrics(token, today, prev_metrics, warnings):
    """Weekly totals (getSellingPartnerMetrics) + per-ASIN weeks (listOfferMetrics) + forecast."""
    metrics = dict(prev_metrics or {})
    this_monday, _ = week_bounds(today)
    start = this_monday - timedelta(weeks=METRIC_WEEKS)
    body = {"aggregationFrequency": "WEEK", "timePeriodType": "PERFORMANCE", "programTypes": [SNS],
            "marketplaceId": MARKETPLACE, "metrics": ALL_METRICS,
            "timeInterval": {"startDate": iso_z(start), "endDate": iso_z(this_monday)}}
    res = call("POST", "/replenishment/2022-11-07/sellingPartners/metrics/search", token, body=body, min_gap=1.1)
    rows = res.get("metrics") or []
    for m in rows:
        ti = m.pop("timeInterval", {}) or {}
        s = (ti.get("startDate") or "")[:10]
        e = (ti.get("endDate") or "")[:10]
        if not s:
            continue
        mid = datetime.strptime(s, "%Y-%m-%d").date() + timedelta(days=3)   # Amazon may start weeks on Sunday
        wk = iso_week(mid)
        ws, we = week_bounds(mid)
        entry = metrics.get(wk) or {"week": wk, "start": str(ws), "end": str(we)}
        entry["amazon_interval"] = [s, e]
        entry["totals"] = {k: v for k, v in m.items() if v is not None}
        entry["fetched_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        metrics[wk] = entry
    log(f"replenishment: {len(rows)} weekly total rows")

    # per ASIN, the last OFFER_WEEKS completed weeks (one interval = one unit of the frequency)
    for n in range(1, OFFER_WEEKS + 1):
        ws = this_monday - timedelta(weeks=n)
        we = ws + timedelta(days=7)
        offers = list_offer_metrics(token, {"aggregationFrequency": "WEEK", "timePeriodType": "PERFORMANCE",
                                            "timeInterval": {"startDate": iso_z(ws), "endDate": iso_z(we)}})
        wk = iso_week(ws + timedelta(days=3))
        entry = metrics.get(wk) or {"week": wk, "start": str(ws), "end": str(ws + timedelta(days=6))}
        entry["by_asin"] = offers
        entry["fetched_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        metrics[wk] = entry

    forecast = list_offer_metrics(token, {"timePeriodType": "FORECAST",
                                          "timeInterval": {"startDate": iso_z(today), "endDate": iso_z(today + timedelta(days=90))}})
    return metrics, {"fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "by_asin": forecast}


def list_offer_metrics(token, filters):
    f = dict(filters)
    f.update({"programTypes": [SNS], "marketplaceId": MARKETPLACE})
    out, offset = [], 0
    while True:
        body = {"pagination": {"limit": 500, "offset": offset}, "filters": f,
                "sort": {"order": "DESC", "key": "TOTAL_SUBSCRIPTIONS_REVENUE" if f["timePeriodType"] == "PERFORMANCE"
                         else "NEXT_30DAYS_TOTAL_SUBSCRIPTIONS_REVENUE"}}
        res = call("POST", "/replenishment/2022-11-07/offers/metrics/search", token, body=body, min_gap=1.1)
        offers = res.get("offers") or []
        for o in offers:
            o.pop("timeInterval", None)
            out.append({k: v for k, v in o.items() if v is not None})
        total = ((res.get("pagination") or {}).get("totalResults")) or 0
        offset += len(offers)
        if not offers or offset >= total or offset >= 9000:
            return out


# ---------------------------------------------------------------------------------------------- main
def main():
    cid = os.environ.get("AMAZON_SP_API_CLIENT_ID", "").strip()
    csec = os.environ.get("AMAZON_SP_API_CLIENT_SECRET", "").strip()
    rtok = os.environ.get("AMAZON_SP_API_REFRESH_TOKEN", "").strip()
    if not (cid and csec and rtok):
        log("Missing AMAZON_SP_API_* env vars")
        sys.exit(2)

    prev = {}
    if os.path.exists(OUTPUT_PATH):
        try:
            prev = json.load(open(OUTPUT_PATH, encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            log(f"previous file unreadable ({e}) - starting fresh")
    pmeta = prev.get("meta") or {}
    checked = dict(prev.get("checked") or {})
    # S&S lines by order id (rebuilt into weeks at the end)
    by_order = {}
    for w in (prev.get("weeks") or {}).values():
        for ln in w.get("orders", []):
            by_order.setdefault(ln["id"], []).append(ln)
    warnings = []

    run_started = datetime.now(timezone.utc)
    today = datetime.now(TZ).date()
    token = base.get_access_token(cid, csec, rtok)

    # 1. which orders to look at ------------------------------------------------------------------
    last_listed = pmeta.get("last_listed_at")
    if FORCE_BACKFILL or not last_listed:
        mode = "backfill"
        start_local = datetime.combine(today - timedelta(days=BACKFILL_DAYS), datetime.min.time(), TZ)
        listed = list_orders(token, created_after=start_local.astimezone(timezone.utc))
    else:
        mode = "incremental"
        since = datetime.fromisoformat(last_listed) - timedelta(hours=OVERLAP_HOURS)
        listed = list_orders(token, updated_after=since)

    queue = {q["id"]: q for q in (pmeta.get("queue") or [])}   # carried over from a capped run
    for o in listed:
        if not o.get("purchase_date"):
            continue
        known = checked.get(o["id"])
        if o["id"] in by_order:
            for ln in by_order[o["id"]]:
                ln["status"] = o["status"]          # status change without another items call
            needs_price = any(ln.get("price") is None for ln in by_order[o["id"]]) and o["status"] not in ("Pending", "Canceled")
            if needs_price:
                queue[o["id"]] = o
        elif known is None or o["status"] == "Pending":
            # never checked, or still Pending (AmazonPrograms/prices may be incomplete until payment clears)
            queue[o["id"]] = o

    # 2. getOrderItems for the queue (oldest first) -----------------------------------------------
    todo = sorted(queue.values(), key=lambda o: o["purchase_date"])
    calls = 0
    left = []
    for o in todo:
        if calls >= MAX_ITEM_CALLS or (datetime.now(timezone.utc) - run_started).total_seconds() > TIME_BUDGET_MIN * 60:
            left.append(o)
            continue
        try:
            items = order_items(token, o["id"])
        except ApiError as e:
            warnings.append(f"orderItems {o['id']}: {e}")
            left.append(o)
            if e.code in (401, 403):
                break
            continue
        calls += 1
        lines = sns_lines(o, items)
        day = to_local(o["purchase_date"]).strftime("%Y-%m-%d")
        checked[o["id"]] = [day, 1 if lines else 0]
        if lines:
            by_order[o["id"]] = lines
        elif o["id"] in by_order:
            by_order.pop(o["id"])
        if calls % 100 == 0:
            log(f"orderItems: {calls}/{len(todo)} checked, {sum(1 for v in checked.values() if v[1])} S&S orders known")
        if o["status"] == "Pending":
            left.append(o)   # look again once it leaves Pending
    left = [o for o in left
            if checked.get(o["id"]) is None                      # not reached (cap / error): next run
            or (o["status"] == "Pending" and (today - to_local(o["purchase_date"]).date()).days <= 7)]
    log(f"orderItems: {calls} calls this run, {len(left)} left in queue")

    # 3. prune + group by ISO week ------------------------------------------------------------------
    cutoff = str(today - timedelta(days=KEEP_CHECKED_DAYS))
    checked = {k: v for k, v in checked.items() if v[0] >= cutoff or v[1] == 1}
    weeks = {}
    for oid, lines in by_order.items():
        for ln in lines:
            d = datetime.strptime(ln["date"], "%Y-%m-%d").date()
            wk = iso_week(d)
            ws, we = week_bounds(d)
            w = weeks.setdefault(wk, {"week": wk, "start": str(ws), "end": str(we), "orders": []})
            w["orders"].append(ln)
    for w in weeks.values():
        w["orders"].sort(key=lambda ln: (ln["purchase_date"], ln["id"], ln.get("sku") or ""))
        live = [ln for ln in w["orders"] if "cancel" not in (ln.get("status") or "").lower()]
        w["summary"] = {"orders": len({ln["id"] for ln in live}), "units": sum(ln["qty"] for ln in live),
                        "revenue": round(sum(ln.get("price") or 0 for ln in live), 2),
                        "cancelled_orders": len({ln["id"] for ln in w["orders"]} - {ln["id"] for ln in live})}
    weeks = dict(sorted(weeks.items()))

    # 4. Replenishment metrics ----------------------------------------------------------------------
    metrics, forecast = prev.get("metrics") or {}, prev.get("forecast")
    repl = {"ok": None}
    if not SKIP_METRICS:
        try:
            metrics, forecast = fetch_metrics(token, today, metrics, warnings)
            repl = {"ok": True}
        except ApiError as e:
            hint = " (app is missing the role for the Replenishment API - add it in Developer Central, re-authorize)" if e.code == 403 else ""
            repl = {"ok": False, "error": f"{e}{hint}"}
            warnings.append(f"replenishment: {e}{hint}")
            log(f"replenishment failed: {e}{hint}")
    metrics = dict(sorted(metrics.items()))

    out = {
        "schema": 1,
        "script_version": SCRIPT_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "timezone": base.REPORT_TIMEZONE,
        "marketplace": MARKETPLACE,
        "weeks": weeks,
        "metrics": metrics,
        "forecast": forecast,
        "checked": checked,
        "meta": {
            "mode": mode, "listed": len(listed), "item_calls": calls,
            "last_listed_at": run_started.isoformat(timespec="seconds"),
            "backfill_start": pmeta.get("backfill_start") or str(today - timedelta(days=BACKFILL_DAYS)),
            "queue": left, "complete": not any(checked.get(o["id"]) is None for o in left),
            "sns_orders": sum(1 for v in checked.values() if v[1] == 1),
            "checked_orders": len(checked),
            "replenishment": repl, "warnings": warnings[:50],
        },
    }
    os.makedirs(os.path.dirname(OUTPUT_PATH) or ".", exist_ok=True)
    tmp = OUTPUT_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, OUTPUT_PATH)
    log(f"wrote {OUTPUT_PATH}: {len(weeks)} weeks, {out['meta']['sns_orders']} S&S orders, "
        f"{len(metrics)} metric weeks, queue {len(left)}, mode {mode}")


if __name__ == "__main__":
    main()
