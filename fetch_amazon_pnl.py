#!/usr/bin/env python3
"""
Cattasaurus - Amazon SP-API P&L fetcher.

Runs on a schedule (GitHub Actions) completely independently of Claude.
Pulls real Finances API data from Amazon Selling Partner API, aggregates it
into a P&L-friendly JSON structure, and writes it to data/amazon_pnl.json.

Credentials are read ONLY from environment variables (populated from GitHub
Actions Secrets at run time) - never hardcoded, never logged.

Required env vars:
  AMAZON_SP_API_CLIENT_ID
  AMAZON_SP_API_CLIENT_SECRET
  AMAZON_SP_API_REFRESH_TOKEN

Optional env vars:
  SP_API_REGION_HOST   default: https://sellingpartnerapi-na.amazon.com
  MARKETPLACE_IDS       comma separated, default: ATVPDKIKX0DER (US)
  WINDOW_DAYS            how many trailing days to (re)fetch, default 45
"""
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token"
SP_API_HOST = os.environ.get("SP_API_REGION_HOST", "https://sellingpartnerapi-na.amazon.com")
MARKETPLACE_IDS = [m.strip() for m in os.environ.get("MARKETPLACE_IDS", "ATVPDKIKX0DER").split(",") if m.strip()]
WINDOW_DAYS = int(os.environ.get("WINDOW_DAYS", "45"))
OUTPUT_PATH = os.environ.get("OUTPUT_PATH", "data/amazon_pnl.json")

# SP-API Finances v0 rate limit for listFinancialEvents is 0.5 req/sec (burst 30).
MIN_REQUEST_INTERVAL = 2.1  # seconds, a little slower than the limit to be safe

FEE_BUCKET_MAP = {
    # referral / commission
    "Commission": "referral_fees",
    "GiftwrapChargeback": "referral_fees",
    "SharedFixedFee": "referral_fees",
    "DigitalServicesFee": "referral_fees",
    "VariableClosingFee": "referral_fees",
    "FixedClosingFee": "referral_fees",
    # FBA fulfillment
    "FBAPerUnitFulfillmentFee": "fba_fulfillment_fees",
    "FBAPerOrderFulfillmentFee": "fba_fulfillment_fees",
    "FBAWeightBasedFee": "fba_fulfillment_fees",
    "FBAFulfillmentCODFee": "fba_fulfillment_fees",
}

SERVICE_FEE_BUCKET_MAP = {
    "Subscription": "service_fees",
    "FBAStorageFee": "service_fees",
    "FBAInboundTransportationFee": "service_fees",
    "FBALongTermStorageFee": "service_fees",
    "FBARemovalFee": "service_fees",
    "FBADisposalFee": "service_fees",
    "FBAInboundConvenienceFee": "service_fees",
}

DAILY_FIELDS = [
    "gross_sales", "refunds", "net_sales", "referral_fees", "fba_fulfillment_fees",
    "service_fees", "ad_spend", "promotions", "shipping_credits", "adjustments",
    "unclassified_other", "orders", "units",
]


def log(msg):
    print(f"[amazon_pnl] {msg}", file=sys.stderr, flush=True)


def new_daily_bucket():
    return {f: 0 for f in DAILY_FIELDS}


class RateLimiter:
    def __init__(self, min_interval):
        self.min_interval = min_interval
        self._last = 0.0

    def wait(self):
        now = time.monotonic()
        delta = now - self._last
        if delta < self.min_interval:
            time.sleep(self.min_interval - delta)
        self._last = time.monotonic()


rl = RateLimiter(MIN_REQUEST_INTERVAL)


def get_access_token(client_id, client_secret, refresh_token):
    data = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
        "client_secret": client_secret,
    }).encode()
    req = urllib.request.Request(LWA_TOKEN_URL, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        err_body = e.read().decode(errors="replace")
        log(f"LWA token exchange failed: HTTP {e.code} - {err_body[:1000]}")
        log(f"client_id used (first/last 6 chars): {client_id[:6]}...{client_id[-6:]} (len={len(client_id)})")
        log(f"refresh_token length: {len(refresh_token)} (starts with: {refresh_token[:5]})")
        raise
    return body["access_token"]


def sp_api_get(path, access_token, params=None, max_retries=5):
    qs = f"?{urllib.parse.urlencode(params)}" if params else ""
    url = f"{SP_API_HOST}{path}{qs}"
    for attempt in range(1, max_retries + 1):
        rl.wait()
        req = urllib.request.Request(url, method="GET")
        req.add_header("x-amz-access-token", access_token)
        req.add_header("Accept", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")
            if e.code == 429 or e.code >= 500:
                backoff = min(30, 2 ** attempt)
                log(f"HTTP {e.code} on {path}, retry {attempt}/{max_retries} in {backoff}s: {body[:300]}")
                time.sleep(backoff)
                continue
            log(f"HTTP {e.code} on {path}: {body[:500]}")
            raise
    raise RuntimeError(f"Exceeded retries calling {path}")


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def day_key(iso_str):
    # Amazon PostedDate looks like 2026-09-17T13:45:22.123Z
    return iso_str[:10]


def amt(money_obj):
    if not money_obj:
        return 0.0
    try:
        return float(money_obj.get("CurrencyAmount", 0) or 0)
    except (TypeError, ValueError):
        return 0.0


def add(bucket, field, value):
    bucket[field] = bucket.get(field, 0) + value


def process_shipment_event(ev, daily, warnings):
    posted = ev.get("PostedDate")
    if not posted:
        return
    d = daily.setdefault(day_key(posted), new_daily_bucket())
    order_ids = set()
    order_id = ev.get("AmazonOrderId")
    if order_id:
        order_ids.add(order_id)
    for item in ev.get("ShipmentItemList", []) or []:
        d["units"] += item.get("QuantityShipped", 0) or 0
        for charge in item.get("ItemChargeList", []) or []:
            ctype = charge.get("ChargeType")
            v = amt(charge.get("ChargeAmount"))
            if ctype == "Principal":
                add(d, "gross_sales", v)
            elif ctype in ("ShippingCharge", "Shipping"):
                add(d, "shipping_credits", v)
            elif ctype in ("Tax", "ShippingTax", "GiftWrapTax", "RestockingFee"):
                pass  # tax pass-through, not part of merchant P&L revenue/cost
            else:
                add(d, "unclassified_other", v)
                warnings.add(f"unclassified ItemChargeList type: {ctype}")
        for promo in item.get("PromotionList", []) or []:
            add(d, "promotions", amt(promo.get("PromotionAmount")))
        for fee in item.get("ItemFeeList", []) or []:
            ftype = fee.get("FeeType")
            v = amt(fee.get("FeeAmount"))
            bucket = FEE_BUCKET_MAP.get(ftype)
            if bucket:
                add(d, bucket, v)
            else:
                add(d, "unclassified_other", v)
                warnings.add(f"unclassified ItemFeeList type: {ftype}")
    if order_ids:
        d["orders"] += len(order_ids)
    return order_ids


def process_refund_event(ev, daily, warnings):
    posted = ev.get("PostedDate")
    if not posted:
        return
    d = daily.setdefault(day_key(posted), new_daily_bucket())
    for item in ev.get("ShipmentItemAdjustmentList", []) or []:
        for charge in item.get("ItemChargeAdjustmentList", []) or []:
            ctype = charge.get("ChargeType")
            v = amt(charge.get("ChargeAmount"))
            if ctype == "Principal":
                add(d, "refunds", v)
            elif ctype in ("Tax", "ShippingTax"):
                pass
            else:
                add(d, "unclassified_other", v)
                warnings.add(f"unclassified refund charge type: {ctype}")
        for fee in item.get("ItemFeeAdjustmentList", []) or []:
            ftype = fee.get("FeeType")
            v = amt(fee.get("FeeAmount"))
            bucket = FEE_BUCKET_MAP.get(ftype)
            if bucket:
                add(d, bucket, v)
            else:
                add(d, "unclassified_other", v)
                warnings.add(f"unclassified refund fee type: {ftype}")


def process_service_fee_event(ev, daily, warnings):
    posted = ev.get("PostedDate")
    if not posted:
        return
    d = daily.setdefault(day_key(posted), new_daily_bucket())
    for fee in ev.get("FeeList", []) or []:
        ftype = fee.get("FeeType")
        v = amt(fee.get("FeeAmount"))
        bucket = SERVICE_FEE_BUCKET_MAP.get(ftype)
        if bucket:
            add(d, bucket, v)
        else:
            add(d, "unclassified_other", v)
            warnings.add(f"unclassified service fee type: {ftype}")


def process_product_ads_event(ev, daily, warnings):
    posted = ev.get("postedDate") or ev.get("PostedDate")
    if not posted:
        return
    d = daily.setdefault(day_key(posted), new_daily_bucket())
    invoice_amt = ev.get("invoiceAmount") or {}
    try:
        v = float(invoice_amt.get("amount", 0) or 0)
    except (TypeError, ValueError):
        v = 0.0
    ttype = (ev.get("transactionType") or "").lower()
    if ttype == "charge":
        add(d, "ad_spend", v)
    elif ttype == "refund":
        add(d, "ad_spend", -v)
    else:
        add(d, "unclassified_other", v)
        warnings.add(f"unclassified ProductAdsPayment transactionType: {ev.get('transactionType')}")


def process_adjustment_event(ev, daily, warnings):
    posted = ev.get("PostedDate")
    if not posted:
        return
    d = daily.setdefault(day_key(posted), new_daily_bucket())
    v = amt(ev.get("AdjustmentAmount"))
    add(d, "adjustments", v)


def fetch_all_financial_events(access_token, posted_after, posted_before, daily, warnings):
    params = {
        "PostedAfter": posted_after,
        "PostedBefore": posted_before,
        "MaxResultsPerPage": 100,
    }
    next_token = None
    events_count = 0
    page = 0
    while True:
        page += 1
        if next_token:
            call_params = {"NextToken": next_token}
            path = "/finances/v0/financialEvents"
        else:
            call_params = params
            path = "/finances/v0/financialEvents"
        resp = sp_api_get(path, access_token, call_params)
        payload = resp.get("payload", {})
        fe = payload.get("FinancialEvents", {})

        for ev in fe.get("ShipmentEventList", []) or []:
            process_shipment_event(ev, daily, warnings)
            events_count += 1
        for ev in fe.get("RefundEventList", []) or []:
            process_refund_event(ev, daily, warnings)
            events_count += 1
        for ev in fe.get("ServiceFeeEventList", []) or []:
            process_service_fee_event(ev, daily, warnings)
            events_count += 1
        for ev in fe.get("ProductAdsPaymentEventList", []) or []:
            process_product_ads_event(ev, daily, warnings)
            events_count += 1
        for ev in fe.get("AdjustmentEventList", []) or []:
            process_adjustment_event(ev, daily, warnings)
            events_count += 1

        # Any other event list types: tally their presence so nothing silently vanishes.
        known = {
            "ShipmentEventList", "RefundEventList", "ServiceFeeEventList",
            "ProductAdsPaymentEventList", "AdjustmentEventList",
        }
        for key, val in fe.items():
            if key not in known and val:
                warnings.add(f"unhandled event list present: {key} ({len(val)} items)")

        next_token = payload.get("NextToken")
        log(f"page {page}: +{events_count} events so far, next_token={'yes' if next_token else 'no'}")
        if not next_token:
            break
    return events_count


def compute_net_sales(daily):
    for d in daily.values():
        d["net_sales"] = round(
            d.get("gross_sales", 0) + d.get("refunds", 0) + d.get("promotions", 0) + d.get("shipping_credits", 0),
            2,
        )
        for f in DAILY_FIELDS:
            if isinstance(d.get(f), float):
                d[f] = round(d[f], 2)


def sum_range(daily, start_key, end_key):
    out = new_daily_bucket()
    for k, d in daily.items():
        if start_key <= k <= end_key:
            for f in DAILY_FIELDS:
                out[f] += d.get(f, 0)
    for f in DAILY_FIELDS:
        out[f] = round(out[f], 2)
    return out


def main():
    client_id = os.environ.get("AMAZON_SP_API_CLIENT_ID")
    client_secret = os.environ.get("AMAZON_SP_API_CLIENT_SECRET")
    refresh_token = os.environ.get("AMAZON_SP_API_REFRESH_TOKEN")
    if not (client_id and client_secret and refresh_token):
        log("Missing one or more required env vars (AMAZON_SP_API_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN)")
        sys.exit(1)

    log("Exchanging refresh token for access token...")
    access_token = get_access_token(client_id, client_secret, refresh_token)
    log("Got access token.")

    now = datetime.now(timezone.utc)
    posted_after = iso(now - timedelta(days=WINDOW_DAYS))
    # Amazon rejects a PostedBefore too close to "now" (clock-skew tolerance is only ~2 min);
    # back off by 5 minutes for safety margin.
    posted_before = iso(now - timedelta(minutes=5))

    daily = {}
    warnings = set()
    total_events = fetch_all_financial_events(access_token, posted_after, posted_before, daily, warnings)
    compute_net_sales(daily)

    today_key = now.strftime("%Y-%m-%d")
    month_key_prefix = now.strftime("%Y-%m")
    mtd_start = f"{month_key_prefix}-01"
    last30_start = (now - timedelta(days=30)).strftime("%Y-%m-%d")

    out = {
        "source": "amazon_sp_api",
        "generated_at": iso(now),
        "marketplaces": MARKETPLACE_IDS,
        "window_days": WINDOW_DAYS,
        "daily": daily,
        "totals": {
            "today": sum_range(daily, today_key, today_key),
            "mtd": sum_range(daily, mtd_start, today_key),
            "last_30d": sum_range(daily, last30_start, today_key),
        },
        "meta": {
            "events_processed": total_events,
            "warnings": sorted(warnings),
        },
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH) or ".", exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(out, f, indent=2, sort_keys=True)
    log(f"Wrote {OUTPUT_PATH} ({total_events} events, {len(daily)} days, {len(warnings)} warning types).")


if __name__ == "__main__":
    main()
