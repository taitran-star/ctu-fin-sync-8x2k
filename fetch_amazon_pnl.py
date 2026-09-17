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
    "GiftwrapCommission": "referral_fees",       # Amazon's commission on gift-wrap revenue
    "SharedFixedFee": "referral_fees",
    "DigitalServicesFee": "referral_fees",
    "VariableClosingFee": "referral_fees",
    "FixedClosingFee": "referral_fees",
    # FBA fulfillment
    "FBAPerUnitFulfillmentFee": "fba_fulfillment_fees",
    "FBAPerOrderFulfillmentFee": "fba_fulfillment_fees",
    "FBAWeightBasedFee": "fba_fulfillment_fees",
    "FBAFulfillmentCODFee": "fba_fulfillment_fees",
    # other per-order selling fees (Amazon lists these under "Selling fees" in
    # its payment reports; they are real costs, kept separate from referral so
    # the referral line stays a clean commission figure)
    "SalesTaxCollectionFee": "other_fees",      # fee for Amazon collecting/remitting sales tax
    "ShippingChargeback": "other_fees",         # Amazon keeps the shipping credit on FBA orders
    "ShippingHB": "other_fees",                 # shipping holdback
    "RefundCommission": "other_fees",           # refund administration fee (Amazon keeps part of the commission)
    "RefundAdministrationFee": "other_fees",
}

# ItemChargeList types that are money FROM the customer (revenue side).
CHARGE_BUCKET_MAP = {
    "Principal": "gross_sales",
    "ShippingCharge": "shipping_credits",
    "Shipping": "shipping_credits",
    "GiftWrap": "giftwrap_credits",             # customer paid for gift wrap - revenue, netted by GiftwrapCommission
    "Giftwrap": "giftwrap_credits",
}
# Charge types that are tax pass-through - collected for the tax authority, not merchant P&L.
TAX_CHARGE_TYPES = {"Tax", "ShippingTax", "GiftWrapTax", "GiftwrapTax", "MarketplaceFacilitatorTax-Principal",
                    "MarketplaceFacilitatorTax-Shipping", "MarketplaceFacilitatorTax-Other"}
# In refund events every charge line is part of the refund transaction (signed as Amazon
# reports it: negative = money back to the customer, positive = kept by the seller), so
# they all net into `refunds`. RestockingFee is positive (seller keeps it).
REFUND_CHARGE_BUCKET_MAP = {
    "Principal": "refunds",
    "ShippingCharge": "refunds",
    "Shipping": "refunds",
    "ReturnShipping": "refunds",
    "GiftWrap": "refunds",
    "Giftwrap": "refunds",
    "RestockingFee": "refunds",
    "Goodwill": "refunds",
}

SERVICE_FEE_BUCKET_MAP = {
    # account / warehouse service fees -> service_fees
    "Subscription": "service_fees",
    "FBAStorageFee": "service_fees",
    "FBALongTermStorageFee": "service_fees",
    "FBARemovalFee": "service_fees",
    "FBADisposalFee": "service_fees",
    "CustomerReturnHRRUnitFee": "service_fees",          # FBA customer-returns processing fee
    "ReCommerceGradingAndListingFee": "service_fees",    # Grade & Resell
    "VineFee": "service_fees",                           # Vine enrollment (marketing)
    "CouponParticipationFee": "service_fees",            # coupon participation (marketing)
    # inbound logistics -> inbound_freight. Freight, duties and placement fees for moving
    # inventory INTO FBA are landed cost of inventory (COGS), not a selling fee, and Amazon
    # bills them in large lumps on the invoice date - keep them out of the per-order fee lines.
    "FBAInternationalInboundFreightFee": "inbound_freight",
    "FBAInternationalInboundFreightTaxAndDuty": "inbound_freight",
    "FBAInboundTransportationFee": "inbound_freight",
    "FBAInboundConvenienceFee": "inbound_freight",       # inbound placement service fee
}

DAILY_FIELDS = [
    "gross_sales", "refunds", "net_sales", "referral_fees", "fba_fulfillment_fees",
    "service_fees", "inbound_freight", "other_fees", "ad_spend", "promotions", "shipping_credits",
    "giftwrap_credits", "adjustments", "unclassified_other", "orders", "units",
]


def log(msg):
    print(f"[amazon_pnl] {msg}", file=sys.stderr, flush=True)


def new_daily_bucket():
    return {f: 0 for f in DAILY_FIELDS}


class Diag:
    """Diagnostics written to meta.* so the next sync tells us exactly which
    fee/adjustment/event types Amazon is sending and how much money sits in
    each - the way to find where subscription / FBA storage fees actually land."""

    def __init__(self):
        self.event_lists = {}          # event list key -> number of events seen (handled or not)
        self.fee_types = {}            # "ItemFeeList:Commission" -> summed amount
        self.charge_types = {}         # "ItemChargeList:Principal" -> summed amount
        self.service_fee_types = {}    # ServiceFeeEventList FeeType -> summed amount
        self.adjustment_types = {}     # AdjustmentEventList AdjustmentType -> summed amount
        self.ignored = {}              # cash-flow / tax-only event lists deliberately not in P&L -> count

    def bump(self, table, key, value=None):
        if value is None:
            table[key] = table.get(key, 0) + 1
        else:
            table[key] = round(table.get(key, 0.0) + value, 2)

    def as_dict(self):
        def sorted_dict(d):
            return {k: d[k] for k in sorted(d)}
        return {
            "event_lists": sorted_dict(self.event_lists),
            "charge_types": sorted_dict(self.charge_types),
            "fee_types": sorted_dict(self.fee_types),
            "service_fee_types": sorted_dict(self.service_fee_types),
            "adjustment_types": sorted_dict(self.adjustment_types),
            "ignored_event_lists": sorted_dict(self.ignored),
        }


diag = Diag()


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


# Several Finances event types carry NO PostedDate (ServiceFeeEvent - i.e. subscription and
# FBA storage fees - and DebtRecoveryEvent among them). Events are therefore fetched one
# calendar day at a time, and an event without its own PostedDate is attributed to the day
# of the query window it came back in. `_current_day` is set by fetch_all_financial_events.
_current_day = None


def event_day(ev):
    posted = ev.get("PostedDate") or ev.get("postedDate")
    return day_key(posted) if posted else _current_day


def process_shipment_event(ev, daily, warnings):
    dk = event_day(ev)
    if not dk:
        return
    d = daily.setdefault(dk, new_daily_bucket())
    order_ids = set()
    order_id = ev.get("AmazonOrderId")
    if order_id:
        order_ids.add(order_id)
    for item in ev.get("ShipmentItemList", []) or []:
        d["units"] += item.get("QuantityShipped", 0) or 0
        for charge in item.get("ItemChargeList", []) or []:
            ctype = charge.get("ChargeType")
            v = amt(charge.get("ChargeAmount"))
            diag.bump(diag.charge_types, f"ItemChargeList:{ctype}", v)
            bucket = CHARGE_BUCKET_MAP.get(ctype)
            if bucket:
                add(d, bucket, v)
            elif ctype in TAX_CHARGE_TYPES:
                pass  # tax pass-through, not part of merchant P&L revenue/cost
            else:
                add(d, "unclassified_other", v)
                warnings.add(f"unclassified ItemChargeList type: {ctype}")
        for promo in item.get("PromotionList", []) or []:
            add(d, "promotions", amt(promo.get("PromotionAmount")))
        for fee in item.get("ItemFeeList", []) or []:
            ftype = fee.get("FeeType")
            v = amt(fee.get("FeeAmount"))
            diag.bump(diag.fee_types, f"ItemFeeList:{ftype}", v)
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
    dk = event_day(ev)
    if not dk:
        return
    d = daily.setdefault(dk, new_daily_bucket())
    for item in ev.get("ShipmentItemAdjustmentList", []) or []:
        for charge in item.get("ItemChargeAdjustmentList", []) or []:
            ctype = charge.get("ChargeType")
            v = amt(charge.get("ChargeAmount"))
            diag.bump(diag.charge_types, f"RefundChargeList:{ctype}", v)
            bucket = REFUND_CHARGE_BUCKET_MAP.get(ctype)
            if bucket:
                add(d, bucket, v)
            elif ctype in TAX_CHARGE_TYPES:
                pass
            else:
                add(d, "unclassified_other", v)
                warnings.add(f"unclassified refund charge type: {ctype}")
        for fee in item.get("ItemFeeAdjustmentList", []) or []:
            ftype = fee.get("FeeType")
            v = amt(fee.get("FeeAmount"))
            diag.bump(diag.fee_types, f"RefundFeeList:{ftype}", v)
            bucket = FEE_BUCKET_MAP.get(ftype)
            if bucket:
                add(d, bucket, v)   # signed: a refunded fee comes back positive and reduces the bucket
            else:
                add(d, "unclassified_other", v)
                warnings.add(f"unclassified refund fee type: {ftype}")


def process_service_fee_event(ev, daily, warnings):
    # ServiceFeeEvent has no PostedDate in the Finances v0 schema -> dated by the query day.
    dk = event_day(ev)
    if not dk:
        return
    d = daily.setdefault(dk, new_daily_bucket())
    reason = ev.get("FeeReason") or ev.get("FeeDescription") or ""
    for fee in ev.get("FeeList", []) or []:
        ftype = fee.get("FeeType")
        v = amt(fee.get("FeeAmount"))
        diag.bump(diag.service_fee_types, f"{ftype}" + (f" ({reason[:40]})" if reason else ""), v)
        bucket = SERVICE_FEE_BUCKET_MAP.get(ftype)
        if bucket:
            add(d, bucket, v)
        else:
            # Unknown service fee: it is still a service-type charge, so keep it in
            # service_fees (not "other") and flag it so the mapping can be extended.
            add(d, "service_fees", v)
            warnings.add(f"unmapped service fee type (kept in service_fees): {ftype}")


def process_removal_shipment_event(ev, daily, warnings):
    """FBA removal orders: fees (Return/Disposal/Liquidation) are service-type costs;
    liquidation revenue is other income."""
    dk = event_day(ev)
    if not dk:
        return
    d = daily.setdefault(dk, new_daily_bucket())
    for item in ev.get("RemovalShipmentItemList", []) or []:
        fee = amt(item.get("FeeAmount"))
        rev = amt(item.get("Revenue"))
        add(d, "service_fees", fee)
        add(d, "adjustments", rev)
        diag.bump(diag.service_fee_types, f"RemovalShipment:{ev.get('TransactionType') or 'fee'}", fee)
        if rev:
            diag.bump(diag.adjustment_types, "RemovalShipmentRevenue", rev)
        # TaxAmount is pass-through, ignored.


def process_removal_shipment_adjustment_event(ev, daily, warnings):
    dk = event_day(ev)
    if not dk:
        return
    d = daily.setdefault(dk, new_daily_bucket())
    for item in ev.get("RemovalShipmentItemAdjustmentList", []) or []:
        rev = amt(item.get("RevenueAdjustment"))
        add(d, "adjustments", rev)
        diag.bump(diag.adjustment_types, "RemovalShipmentRevenueAdjustment", rev)


def process_product_ads_event(ev, daily, warnings):
    dk = event_day(ev)
    if not dk:
        return
    d = daily.setdefault(dk, new_daily_bucket())
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


# AdjustmentEvent types that are NOT P&L:
#  - ReserveCredit / ReserveDebit: Amazon holding back and later releasing funds. Pure cash
#    flow; within any window they show up as a fake -$X one day and +$X another day.
CASHFLOW_ADJUSTMENT_TYPES = {"ReserveCredit", "ReserveDebit", "ReserveEvent"}
# AdjustmentEvent types that are real shipping costs (Amazon Buy Shipping postage for
# merchant-fulfilled / return labels) -> per-order "other fees", not reimbursements.
POSTAGE_ADJUSTMENT_PREFIXES = ("PostageBilling", "PostageRefund", "ReturnPostageBilling")


def process_adjustment_event(ev, daily, warnings):
    dk = event_day(ev)
    if not dk:
        return
    d = daily.setdefault(dk, new_daily_bucket())
    v = amt(ev.get("AdjustmentAmount"))
    atype = str(ev.get("AdjustmentType") or "unknown")
    diag.bump(diag.adjustment_types, atype, v)
    if atype in CASHFLOW_ADJUSTMENT_TYPES:
        diag.ignored[f"Adjustment:{atype}"] = diag.ignored.get(f"Adjustment:{atype}", 0) + 1
        return
    if atype.startswith(POSTAGE_ADJUSTMENT_PREFIXES):
        add(d, "other_fees", v)
        return
    add(d, "adjustments", v)   # reimbursements, clawbacks, warehouse lost/damage, etc.


# Event lists that are deliberately NOT part of the P&L:
#  - DebtRecoveryEventList: Amazon collecting a negative balance - a cash movement whose
#    underlying charges were already recorded as fees/refunds; adding it would double count.
#  - RetrochargeEventList: retroactive TAX charges/reversals - tax is pass-through here.
#  - ChargebackEventList / GuaranteeClaimEventList: same shape as refunds and would be
#    handled below if they ever appear (they are processed like refunds).
CASHFLOW_ONLY_LISTS = {"DebtRecoveryEventList", "RetrochargeEventList", "LoanServicingEventList",
                       "PayWithAmazonEventList", "AffordabilityExpenseEventList",
                       "AffordabilityExpenseReversalEventList"}


def process_safet_reimbursement_event(ev, daily, warnings):
    """SAFE-T claim reimbursements: Amazon pays the seller back - other income."""
    dk = event_day(ev)
    if not dk:
        return
    d = daily.setdefault(dk, new_daily_bucket())
    v = amt(ev.get("ReimbursedAmount"))
    add(d, "adjustments", v)
    diag.bump(diag.adjustment_types, "SAFETReimbursement", v)


def fetch_all_financial_events(access_token, window_start, window_end, daily, warnings):
    """Fetch the window ONE CALENDAR DAY (UTC) AT A TIME. Amazon filters every event list by
    its posting time even for event types whose JSON carries no PostedDate (ServiceFeeEvent =
    subscription + FBA storage fees, DebtRecoveryEvent...), so a one-day query window is what
    lets those events be dated. Request count is about the same as one big window: the
    paging is per 100 events either way, plus one call per day."""
    global _current_day
    events_count = 0
    day_start = window_start.replace(hour=0, minute=0, second=0, microsecond=0)
    while day_start < window_end:
        day_end = min(day_start + timedelta(days=1), window_end)
        _current_day = day_start.strftime("%Y-%m-%d")
        daily.setdefault(_current_day, new_daily_bucket())   # a day with no events still exists
        events_count += _fetch_window(access_token, iso(day_start), iso(day_end), daily, warnings)
        day_start += timedelta(days=1)
    _current_day = None
    return events_count


def _fetch_window(access_token, posted_after, posted_before, daily, warnings):
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

        # Count every event list Amazon returns (even empty ones) so the diagnostics show
        # exactly what the API is sending for this account and window.
        for key, val in fe.items():
            if isinstance(val, list):
                diag.event_lists[key] = diag.event_lists.get(key, 0) + len(val)

        handlers = {
            "ShipmentEventList": process_shipment_event,
            "RefundEventList": process_refund_event,
            # Chargebacks and A-to-z guarantee claims have the same shape as refunds.
            "ChargebackEventList": process_refund_event,
            "GuaranteeClaimEventList": process_refund_event,
            "ServiceFeeEventList": process_service_fee_event,
            "ProductAdsPaymentEventList": process_product_ads_event,
            "AdjustmentEventList": process_adjustment_event,
            "RemovalShipmentEventList": process_removal_shipment_event,
            "RemovalShipmentAdjustmentEventList": process_removal_shipment_adjustment_event,
            "SAFETReimbursementEventList": process_safet_reimbursement_event,
        }
        for key, fn in handlers.items():
            for ev in fe.get(key, []) or []:
                fn(ev, daily, warnings)
                events_count += 1

        for key, val in fe.items():
            if key in handlers or not val:
                continue
            if key in CASHFLOW_ONLY_LISTS:
                diag.ignored[key] = diag.ignored.get(key, 0) + len(val)
            else:
                warnings.add(f"unhandled event list present: {key} ({len(val)} items)")

        next_token = payload.get("NextToken")
        if not next_token:
            break
    log(f"{_current_day}: {events_count} events in {page} page(s)")
    return events_count


def compute_net_sales(daily):
    for d in daily.values():
        d["net_sales"] = round(
            d.get("gross_sales", 0) + d.get("refunds", 0) + d.get("promotions", 0)
            + d.get("shipping_credits", 0) + d.get("giftwrap_credits", 0),
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
    window_start = now - timedelta(days=WINDOW_DAYS)
    # Amazon rejects a PostedBefore too close to "now" (clock-skew tolerance is only ~2 min);
    # back off by 5 minutes for safety margin.
    window_end = now - timedelta(minutes=5)

    daily = {}
    warnings = set()
    total_events = fetch_all_financial_events(access_token, window_start, window_end, daily, warnings)
    # The first day of the window is partial (it starts at now-45d, not at midnight) - drop it
    # so every published day is a complete day.
    first_key = window_start.strftime("%Y-%m-%d")
    if first_key in daily and window_start.strftime("%H:%M") != "00:00":
        daily.pop(first_key, None)
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
            "schema": 2,   # 2 = adds other_fees + giftwrap_credits + diagnostics (dashboard handles 1 and 2)
            "script_version": "2.2",   # 2.1 = per-day windows (undated ServiceFee events captured); 2.2 = inbound_freight split out
            "diagnostics": diag.as_dict(),
        },
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH) or ".", exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(out, f, indent=2, sort_keys=True)
    log(f"Wrote {OUTPUT_PATH} ({total_events} events, {len(daily)} days, {len(warnings)} warning types).")


if __name__ == "__main__":
    main()
