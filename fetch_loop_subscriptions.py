#!/usr/bin/env python3
"""
Cattasaurus - Loop Subscriptions (Shopify subscription app) -> data/loop_subscriptions.json

Pulls real numbers via the Loop Admin API (https://developer.loopwork.co), confirmed live against
the real store on 2026-10-01 (see claude/loop-subscriptions-integration.md in the Finance project
for the full research trail). NEVER simulated numbers - every field below traces to a real API call.

What this computes, per calendar day (America/Los_Angeles, same standard as every other source -
see claude/pnl-timezone-standard.md):
  - new_subscriptions : count of subscription contracts whose createdAt falls on that day
                         (GET /subscription?createdAtStartEpoch=...&createdAtEndEpoch=...)
  - new_subscribers   : of those, how many belong to a customer whose allSubscriptionsCount == 1
                         (GET /customer/{id} - this is their first subscription ever)
  - checkout_revenue  : sum of totalPriceUsd of each new subscription's CHECKOUT order
                         (GET /subscription/{id}/order/history, orderType == "CHECKOUT")

What this does NOT compute (and why): "Recurring revenue" the way Loop's own Home dashboard shows
it (actual $ billed from RENEWAL orders in the period, across ALL active subscriptions, not just
new ones) has no cheap source - Loop's Admin API has no global "list all orders" endpoint (confirmed:
GET /order -> 404 on 2026-10-01). The only way to get a renewal order is to walk order/history per
subscription, which does not scale to an hourly job across every active subscriber. So instead this
script writes `mrr_estimate`: a RUN-RATE estimate from each ACTIVE subscription's own billing
schedule (price / billing-cycle-length), clearly labeled as an estimate, not the actual period-billed
number. If/when a webhook receiver for order/processed is built, a real `recurring_revenue_actual`
can be added per day without changing this file's shape (the key already exists, set to null).

Env: LOOP_API_TOKEN (required, secret), REPORT_TIMEZONE (default America/Los_Angeles),
     OUTPUT_PATH (default data/loop_subscriptions.json), LOOKBACK_DAYS (default 63 - covers the
     dashboard's 7-period trailing history with buffer; re-walked fresh every run so a subscription
     cancelled/edited after creation still has its latest state).
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
SCRIPT_VERSION = "loop-1.1"

INTERVAL_DAYS = {"DAY": 1, "WEEK": 7, "MONTH": 30.4368, "YEAR": 365.2422}


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
            "recurring_revenue_actual": None,  # reserved - needs webhook capture, see module docstring
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
                 "KHÔNG phải doanh thu tái diễn thực tế đã charge trong kỳ (Loop Admin API không có endpoint liệt kê order "
                 "toàn store để tính số đó; xem data/loop_subscriptions.json meta.limitation)."),
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
                     "customer + order/history), theo ngày America/Los_Angeles. recurring_revenue_actual để null (chưa có "
                     "cách lấy đúng theo kỳ - xem 'limitation'); mrr_estimate.weekly_run_rate/monthly_run_rate là ƯỚC TÍNH "
                     "run-rate, không phải số kỳ thực tế - đừng hiển thị như số đã charge thật."),
            "limitation": ("Loop Admin API không có GET /order (danh sách order toàn store) - xác nhận 404 ngày 2026-10-01. "
                           "Chỉ có GET /subscription/{id}/order/history (theo từng subscription). Muốn có doanh thu tái diễn "
                           "THỰC TẾ theo kỳ, cần 1 trong 2: (a) duyệt order/history của TOÀN BỘ subscription active mỗi lần "
                           "sync (không khả thi hàng giờ nếu số sub active lớn, do rate limit), hoặc (b) nhận webhook "
                           "order/processed từ Loop (Settings > API tokens & webhooks > Webhook secrets) vào 1 endpoint mới, "
                           "tích luỹ dần theo thời gian thực - CHƯA xây."),
            "window_days": LOOKBACK_DAYS,
            "new_subscriptions_in_window": len(new_subs),
            "customers_looked_up": len(customer_cache),
            "customer_lookup_failures": customer_lookup_failures,
        },
    }
    os.makedirs(os.path.dirname(OUTPUT_PATH) or ".", exist_ok=True)
    json.dump(out, open(OUTPUT_PATH, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    log(f"Wrote {OUTPUT_PATH}: {len(days_sorted)} days, {len(new_subs)} new subs in window, "
        f"{len(active_subs)} active subs, weekly run-rate ${mrr_estimate['weekly_run_rate']}")


if __name__ == "__main__":
    main()
