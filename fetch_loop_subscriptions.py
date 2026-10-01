#!/usr/bin/env python3
"""
Cattasaurus - Loop Subscriptions (Shopify subscription app) -> data/loop_subscriptions.json

Pulls real numbers via the Loop Admin API (https://developer.loopwork.co) AND the Shopify Admin API,
confirmed live against the real store (see claude/loop-subscriptions-integration.md in the Finance
project for the full research trail). NEVER simulated numbers - every field below traces to a real
API call.

What this computes, per calendar day (America/Los_Angeles, same standard as every other source -
see claude/pnl-timezone-standard.md):
  - new_subscriptions : count of subscription contracts whose createdAt falls on that day
                         (GET /subscription?createdAtStartEpoch=...&createdAtEndEpoch=... - Loop API)
  - new_subscribers   : of those, how many belong to a customer whose allSubscriptionsCount == 1
                         (GET /customer?email=...&pageSize=1 - Loop API - this is their first
                         subscription ever)
  - checkout_revenue  : sum of totalPriceUsd of each new subscription's CHECKOUT order
                         (GET /subscription/{id}/order/history, orderType == "CHECKOUT" - Loop API)
  - recurring_revenue_actual : REAL $ billed from renewal orders that day, across ALL active
                         subscriptions (not just new ones). v1.2+: Loop's Admin API has no global
                         "list all orders" endpoint (confirmed: GET /order -> 404), but every renewal
                         charge Loop processes creates a REAL Shopify order, always tagged
                         "Subscription Recurring Order" and created by the "Loop Subscriptions" app.
                         So this is computed from Shopify's own order feed (Shopify Admin GraphQL,
                         same client-credentials app already used for the main Shopify P&L sync),
                         filtered to that tag + app, summed by day. Confirmed matching Loop's own
                         Home dashboard "Recurring revenue" figure to the cent (2026-10-01: $508.20
                         both sides). If the Shopify fetch fails for any reason (missing creds,
                         network, etc.) this field is left untouched for that run rather than written
                         as a fabricated 0 - see `meta.shopify_recurring_revenue.status`.
  - mrr_estimate (separate top-level field, NOT per-day): a RUN-RATE estimate from each ACTIVE
                         subscription's own billing schedule (price / billing-cycle-length). Kept
                         alongside recurring_revenue_actual (not replaced by it) because it answers a
                         different question - "what's the current steady-state weekly/monthly rate"
                         vs. "what actually got billed in the selected period."

Env: LOOP_API_TOKEN (required, secret), REPORT_TIMEZONE (default America/Los_Angeles),
     OUTPUT_PATH (default data/loop_subscriptions.json), LOOKBACK_DAYS (default 63 - covers the
     dashboard's 7-period trailing history with buffer; re-walked fresh every run so a subscription
     cancelled/edited after creation still has its latest state).
     SHOPIFY_SHOP / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET (same secrets as the main Shopify P&L
     sync, read_orders/read_all_orders scope - reused here read-only for the recurring-revenue tag
     query; optional SHOPIFY_API_VERSION, default 2026-07). If absent, recurring_revenue_actual is
     simply left as-is (not fabricated).
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

BASE = "https://api.loopsubscriptions.com/admin/2026-04"
TOKEN = os.environ.get("LOOP_API_TOKEN", "").strip()
OUTPUT_PATH = os.environ.get("OUTPUT_PATH", "data/loop_subscriptions.json")
TZ_NAME = os.environ.get("REPORT_TIMEZONE", "America/Los_Angeles")
TZ = ZoneInfo(TZ_NAME)
LOOKBACK_DAYS = int(os.environ.get("LOOKBACK_DAYS", "63"))
SCRIPT_VERSION = "loop-1.2"

INTERVAL_DAYS = {"DAY": 1, "WEEK": 7, "MONTH": 30.4368, "YEAR": 365.2422}

SHOPIFY_SHOP = os.environ.get("SHOPIFY_SHOP", "").strip().lower().replace("https://", "").rstrip("/")
SHOPIFY_CLIENT_ID = os.environ.get("SHOPIFY_CLIENT_ID", "").strip()
SHOPIFY_CLIENT_SECRET = os.environ.get("SHOPIFY_CLIENT_SECRET", "").strip()
SHOPIFY_API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2026-07").strip()
RECURRING_TAG = "Subscription Recurring Order"
RECURRING_APP = "Loop Subscriptions"


def log(msg):
    print(f"[loop_subscriptions] {msg}", flush=True)


def api_get(path, params=None, retries=4):
    qs = f"?{urllib.parse.urlencode(params)}" if params else ""
    url = f"{BASE}{path}{qs}"
    req = urllib.request.Request(url, headers={"X-Loop-Token": TOKEN, "Accept": "application/json"})
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            if e.code == 429 and attempt < retries:
                wait = 2 ** attempt
                log(f"429 rate limited on {path}, retry {attempt}/{retries} after {wait}s")
                time.sleep(wait)
                continue
            log(f"HTTP {e.code} on {path}: {body[:300]}")
            return None
        except Exception as e:  # noqa: BLE001
            if attempt < retries:
                time.sleep(2 ** attempt)
                continue
            log(f"request failed on {path}: {e}")
            return None
    return None


def list_all(path, params, item_key_candidates=("data",), page_size=100, rate_sleep=1.6, max_pages=200):
    """Cursor-paginate a Loop list endpoint. Returns a flat list of items."""
    out = []
    cursor = None
    for page in range(max_pages):
        p = dict(params)
        p["pageSize"] = page_size
        if cursor:
            p["afterCursor"] = cursor
        resp = api_get(path, p)
        if not resp or not resp.get("success", True):
            break
        items = None
        for k in item_key_candidates:
            if isinstance(resp.get(k), list):
                items = resp[k]
                break
        if items is None:
            break
        out.extend(items)
        page_info = resp.get("pageInfo") or {}
        if not page_info.get("hasNextPage") or not page_info.get("nextCursor"):
            break
        cursor = page_info["nextCursor"]
        time.sleep(rate_sleep)
    return out


def day_key(iso_or_epoch, is_epoch=False):
    if is_epoch:
        dt = datetime.fromtimestamp(int(iso_or_epoch), tz=timezone.utc)
    else:
        s = (iso_or_epoch or "").replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(TZ).date().isoformat()


def shopify_get_token():
    """Client-credentials grant - same Dev Dashboard app + secrets as fetch_shopify_pnl.py.
    Returns None (not an exception) on any failure so the caller can skip recurring_revenue_actual
    for this run rather than crash the whole Loop sync over an unrelated Shopify hiccup."""
    if not (SHOPIFY_SHOP and SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET):
        log("Shopify creds missing (SHOPIFY_SHOP/SHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRET) - "
            "recurring_revenue_actual will be left untouched this run")
        return None
    body = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": SHOPIFY_CLIENT_ID,
        "client_secret": SHOPIFY_CLIENT_SECRET,
    }).encode()
    for attempt in range(1, 5):
        try:
            req = urllib.request.Request(
                f"https://{SHOPIFY_SHOP}/admin/oauth/access_token", data=body, method="POST",
                headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=30) as r:
                tok = json.loads(r.read().decode()).get("access_token")
            if tok:
                return tok
            log("Shopify token endpoint returned no access_token")
            return None
        except Exception as e:  # noqa: BLE001
            log(f"Shopify token attempt {attempt}/4 failed: {e}")
            time.sleep(2 ** attempt)
    return None


SHOPIFY_RECURRING_QUERY = """
query($first: Int!, $after: String, $q: String!) {
  orders(first: $first, after: $after, sortKey: CREATED_AT, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      createdAt
      tags
      app { name }
      totalPriceSet { shopMoney { amount } }
    }
  }
}
"""


def fetch_shopify_recurring_revenue(window_start_utc):
    """Sum real Shopify order totals per day for renewal charges Loop billed, by filtering the
    store's own order feed to tag:'Subscription Recurring Order' + app == 'Loop Subscriptions'.
    Returns {day_iso: amount} on success (possibly empty - a legitimate zero), or None if the fetch
    could not be completed at all (missing creds, auth failure, or a page that kept failing after
    retries) - callers must NOT treat None as zero."""
    token = shopify_get_token()
    if not token:
        return None
    url = f"https://{SHOPIFY_SHOP}/admin/api/{SHOPIFY_API_VERSION}/graphql.json"
    headers = {"Content-Type": "application/json", "Accept": "application/json", "X-Shopify-Access-Token": token}
    q_start = window_start_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    q = f"tag:'{RECURRING_TAG}' AND created_at:>={q_start}"

    per_day = {}
    after = None
    pages = 0
    orders_seen = 0
    orders_matched = 0
    orders_app_mismatch = 0
    while True:
        body = json.dumps({"query": SHOPIFY_RECURRING_QUERY,
                            "variables": {"first": 100, "after": after, "q": q}}).encode()
        data = None
        for attempt in range(1, 6):
            try:
                req = urllib.request.Request(url, data=body, method="POST", headers=headers)
                with urllib.request.urlopen(req, timeout=60) as r:
                    resp = json.loads(r.read().decode())
                errors = resp.get("errors") or []
                if errors:
                    codes = {(e.get("extensions") or {}).get("code") for e in errors}
                    if ("THROTTLED" in codes or "MAX_COST_EXCEEDED" in codes) and attempt < 5:
                        wait = min(20, 2 ** attempt)
                        log(f"Shopify throttled/cost-too-high on recurring-revenue page {pages + 1} - "
                            f"retry {attempt}/5 in {wait}s")
                        time.sleep(wait)
                        continue
                    log(f"Shopify GraphQL errors on recurring-revenue fetch: {errors}")
                    return None
                data = resp.get("data") or {}
                break
            except urllib.error.HTTPError as e:
                body_txt = e.read().decode("utf-8", errors="replace")
                log(f"Shopify HTTP {e.code} on recurring-revenue fetch: {body_txt[:300]}")
                if e.code in (401, 402, 403):
                    return None
                time.sleep(2 ** attempt)
            except Exception as e:  # noqa: BLE001
                log(f"Shopify request error on recurring-revenue fetch: {e}")
                time.sleep(2 ** attempt)
        if data is None:
            log(f"Shopify recurring-revenue fetch failed after retries on page {pages + 1} - "
                f"aborting (recurring_revenue_actual left untouched this run)")
            return None
        conn = data.get("orders") or {}
        nodes = conn.get("nodes") or []
        orders_seen += len(nodes)
        for o in nodes:
            app_name = (o.get("app") or {}).get("name")
            amt = ((o.get("totalPriceSet") or {}).get("shopMoney") or {}).get("amount")
            try:
                amt = float(amt)
            except (TypeError, ValueError):
                amt = None
            if amt is None:
                continue
            if app_name != RECURRING_APP:
                # tag present but not from Loop's own app - don't count it as Loop recurring revenue
                orders_app_mismatch += 1
                continue
            d = day_key(o.get("createdAt"))
            per_day[d] = round(per_day.get(d, 0.0) + amt, 2)
            orders_matched += 1
        pages += 1
        info = conn.get("pageInfo") or {}
        if not info.get("hasNextPage"):
            break
        after = info.get("endCursor")
        time.sleep(0.5)
    log(f"Shopify recurring revenue: {orders_seen} orders tagged '{RECURRING_TAG}', "
        f"{orders_matched} matched app='{RECURRING_APP}' ({orders_app_mismatch} tag-only mismatches "
        f"excluded), {pages} page(s), {len(per_day)} day(s) with activity")
    return {"per_day": per_day, "orders_seen": orders_seen, "orders_matched": orders_matched,
            "orders_app_mismatch": orders_app_mismatch, "pages": pages}


def main():
    if not TOKEN:
        log("LOOP_API_TOKEN missing")
        sys.exit(2)

    now = datetime.now(timezone.utc)
    window_start = now - timedelta(days=LOOKBACK_DAYS)
    log(f"Window: created {window_start.isoformat()} -> {now.isoformat()} ({LOOKBACK_DAYS}d), timezone {TZ_NAME}")

    # 1) New subscriptions in the lookback window (any current status - still "was new" that day).
    new_subs = list_all(
        "/subscription",
        {"createdAtStartEpoch": int(window_start.timestamp()), "createdAtEndEpoch": int(now.timestamp())},
    )
    log(f"New subscriptions in window: {len(new_subs)}")

    customer_cache = {}  # email -> allSubscriptionsCount (None if lookup failed)
    customer_lookup_failures = 0

    def customer_first_time(email):
        nonlocal customer_lookup_failures
        if not email:
            return None
        if email in customer_cache:
            return customer_cache[email]
        # Use the confirmed-working LIST endpoint with the email filter, not a guessed
        # single-customer detail path (GET /order taught us Loop's Admin API doesn't always
        # have the detail endpoint you'd expect by analogy - verify, don't assume).
        resp = api_get("/customer", {"email": email, "pageSize": 1})
        time.sleep(0.4)
        count = None
        items = (resp or {}).get("data") if isinstance((resp or {}).get("data"), list) else None
        if items:
            count = items[0].get("allSubscriptionsCount")
        if count is None:
            customer_lookup_failures += 1
            log(f"customer lookup failed/empty for {email!r} (resp keys: {list((resp or {}).keys())})")
        customer_cache[email] = count
        return count

    daily = {}

    def bucket(d):
        return daily.setdefault(d, {
            "new_subscriptions": 0, "new_subscribers": 0,
            "checkout_revenue": 0.0, "checkout_orders_found": 0,
            "recurring_revenue_actual": None,  # filled below from Shopify when available
        })

    for i, sub in enumerate(new_subs):
        created = sub.get("createdAt")
        if not created:
            continue
        dkey = day_key(created)
        b = bucket(dkey)
        b["new_subscriptions"] += 1

        cust = sub.get("customer") or {}
        cust_email = cust.get("email")
        cnt = customer_first_time(cust_email)
        if cnt == 1:
            b["new_subscribers"] += 1

        sub_id = sub.get("id")
        if sub_id is not None:
            hist = api_get(f"/subscription/{sub_id}/order/history")
            time.sleep(0.4)
            orders = (hist or {}).get("data") or []
            for o in orders:
                if o.get("orderType") == "CHECKOUT":
                    amt = o.get("totalPriceUsd")
                    try:
                        amt = float(amt)
                    except (TypeError, ValueError):
                        amt = None
                    if amt is not None:
                        odate = o.get("shopifyProcessedAt") or o.get("shopifyCreatedAt") or o.get("billingDate") or created
                        bucket(day_key(odate))["checkout_revenue"] += amt
                        bucket(day_key(odate))["checkout_orders_found"] += 1
                    break  # one checkout order per subscription
        if (i + 1) % 20 == 0:
            log(f"...processed {i + 1}/{len(new_subs)} new subscriptions")

    for d in daily:
        daily[d]["checkout_revenue"] = round(daily[d]["checkout_revenue"], 2)

    # 1b) Recurring revenue - REAL, from Shopify's own order feed (see module docstring).
    shopify_result = fetch_shopify_recurring_revenue(window_start)
    if shopify_result is not None:
        per_day = shopify_result["per_day"]
        d = window_start.astimezone(TZ).date()
        end_d = now.astimezone(TZ).date()
        while d <= end_d:
            dkey = d.isoformat()
            bucket(dkey)["recurring_revenue_actual"] = round(per_day.get(dkey, 0.0), 2)
            d += timedelta(days=1)
        shopify_meta = {
            "status": "ok",
            "orders_seen": shopify_result["orders_seen"],
            "orders_matched": shopify_result["orders_matched"],
            "orders_app_mismatch": shopify_result["orders_app_mismatch"],
        }
    else:
        shopify_meta = {"status": "skipped", "note": "recurring_revenue_actual left untouched this run (see log)"}

    # 2) MRR run-rate estimate from every currently-ACTIVE subscription's billing schedule.
    active_subs = list_all("/subscription", {"status": "ACTIVE"})
    log(f"Active subscriptions: {len(active_subs)}")
    weekly_run_rate = 0.0
    skipped_billing = 0
    for sub in active_subs:
        price = (sub.get("totalLineItemDiscountedPrice") or 0) + (sub.get("deliveryPrice") or 0)
        bp = sub.get("billingPolicy") or {}
        interval = bp.get("interval")
        count = bp.get("intervalCount") or 1
        days = INTERVAL_DAYS.get(interval)
        if not days or not price:
            skipped_billing += 1
            continue
        cycle_days = days * count
        if cycle_days <= 0:
            skipped_billing += 1
            continue
        weekly_run_rate += price * (7.0 / cycle_days)

    mrr_estimate = {
        "as_of": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "active_subscriptions": len(active_subs),
        "weekly_run_rate": round(weekly_run_rate, 2),
        "monthly_run_rate": round(weekly_run_rate * (30.4368 / 7.0), 2),
        "skipped_no_billing_info": skipped_billing,
        "note": ("ƯỚC TÍNH run-rate từ lịch billing của các subscription đang ACTIVE (giá mỗi chu kỳ ÷ số ngày chu kỳ) - "
                 "KHÔNG phải doanh thu tái diễn thực tế đã charge trong kỳ. Xem recurring_revenue_actual theo ngày để "
                 "có số thật đã charge (từ Shopify order feed, xem meta.shopify_recurring_revenue)."),
    }

    prev = {}
    if os.path.exists(OUTPUT_PATH):
        try:
            prev = json.load(open(OUTPUT_PATH, encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            log(f"previous file unreadable ({e}) - starting fresh")
    merged_daily = dict(prev.get("daily") or {})
    merged_daily.update(daily)  # window days get refreshed; older history outside the window is kept

    days_sorted = sorted(merged_daily)
    out = {
        "source": "loop_subscriptions",
        "schema": 1,
        "script_version": SCRIPT_VERSION,
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "timezone": TZ_NAME,
        "daily": {d: merged_daily[d] for d in days_sorted},
        "mrr_estimate": mrr_estimate,
        "coverage": {"first_day": days_sorted[0], "last_day": days_sorted[-1], "days": len(days_sorted)} if days_sorted else {},
        "meta": {
            "note": ("New subscriptions / New subscribers / Checkout revenue: SỐ THẬT từ Loop Admin API (subscription + "
                     "customer + order/history), theo ngày America/Los_Angeles. recurring_revenue_actual: SỐ THẬT từ "
                     "Shopify order feed (đơn tag 'Subscription Recurring Order' + app 'Loop Subscriptions'), khớp "
                     "đúng số Loop tự hiển thị trên Home dashboard (\"Recurring revenue\") tới từng cent - xem "
                     "meta.shopify_recurring_revenue. mrr_estimate.weekly_run_rate/monthly_run_rate là ƯỚC TÍNH "
                     "run-rate riêng (xem field đó), không phải số kỳ thực tế."),
            "limitation": ("Loop Admin API không có GET /order (danh sách order toàn store) - xác nhận 404 ngày "
                           "2026-10-01. Chỉ có GET /subscription/{id}/order/history (theo từng subscription, dùng cho "
                           "checkout_revenue). recurring_revenue_actual KHÔNG đi qua Loop API nữa - lấy thẳng từ "
                           "Shopify order feed bằng cách lọc tag + app (xem docstring đầu file), rẻ và chính xác hơn "
                           "quét order/history của từng subscription active."),
            "window_days": LOOKBACK_DAYS,
            "new_subscriptions_in_window": len(new_subs),
            "customers_looked_up": len(customer_cache),
            "customer_lookup_failures": customer_lookup_failures,
            "shopify_recurring_revenue": shopify_meta,
        },
    }
    os.makedirs(os.path.dirname(OUTPUT_PATH) or ".", exist_ok=True)
    json.dump(out, open(OUTPUT_PATH, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    log(f"Wrote {OUTPUT_PATH}: {len(days_sorted)} days, {len(new_subs)} new subs in window, "
        f"{len(active_subs)} active subs, weekly run-rate ${mrr_estimate['weekly_run_rate']}, "
        f"shopify_recurring_revenue status={shopify_meta['status']}")


if __name__ == "__main__":
    main()
