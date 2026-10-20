#!/usr/bin/env python3
"""
Cattasaurus - Amazon FBA storage fees + FBA inventory (SP-API) -> data/amazon_storage.json

What it does (every run, GitHub Actions, no Claude involved):
  1. FBA Inventory API (getInventorySummaries, details=true): the live per-SKU inventory the way Amazon
     classifies it (fulfillable / reserved / inbound / unfulfillable / researching).  Kept as today's snapshot
     and as one end-of-day row per day (the last run of a day wins) so the history builds up.
  2. Reports API: the "FBA Storage Fees" report (GET_FBA_STORAGE_FEE_CHARGES_DATA) for every month since
     HISTORY_START that the file does not have yet - Amazon's own per-ASIN monthly storage fee (average daily
     units x item volume x rate, incl. the utilization surcharge), available ~7-15 days after month end -
     and the aged-inventory surcharge report (GET_FBA_FULFILLMENT_LONGTERM_STORAGE_FEE_CHARGES_DATA).
  3. A DAILY storage cost for the P&L:
       - month with an Amazon report  -> report total / days in month (Amazon bills the monthly average, so
                                         the even split is the exact daily accrual), est = false
       - month without a report yet   -> for each day (v1.5, Amazon's own formula): sum over SKUs of units at FBA
         (current month, last month      (Inventory Ledger ending balance + in transit between warehouses; the
          until its report is out)        inventory API scaled to it for the latest days) x billed unit volume
                                         (current item volume x the SKU's billing factor) x (list rate of the size
                                         tier and season + the utilization surcharge of the latest report) / days
                                         in month, est = true
     The dashboard shows the estimate until the report (and the FBAStorageFee posting in Finances) replaces it.
  4. A back-test against every month Amazon has billed (storage.estimate.accuracy).

Required env vars: AMAZON_SP_API_CLIENT_ID, AMAZON_SP_API_CLIENT_SECRET, AMAZON_SP_API_REFRESH_TOKEN
Optional: SP_API_REGION_HOST, MARKETPLACE_IDS, REPORT_TIMEZONE (America/Los_Angeles), OUTPUT_PATH
          (data/amazon_storage.json), HISTORY_START (2025-01-01), MAX_REPORTS_PER_RUN (6: createReport is
          limited to ~1/min so backfilling 20 months takes a few hourly runs), INVENTORY_ONLY (1 = skip reports).
Credentials come only from the environment and are never logged.
"""
import csv
import io
import json
import os
import statistics
import sys
import time
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_amazon_pnl as base  # noqa: E402  (LWA token, rate limiter, SP-API GET/POST, report download, log)

SCRIPT_VERSION = "1.5"
SCHEMA = 1
OUTPUT_PATH = os.environ.get("OUTPUT_PATH", "data/amazon_storage.json")
HISTORY_START = os.environ.get("HISTORY_START", "2025-01-01").strip() or "2025-01-01"
MAX_REPORTS_PER_RUN = int(os.environ.get("MAX_REPORTS_PER_RUN", "4"))
CREATE_GAP_SECONDS = int(os.environ.get("CREATE_GAP_SECONDS", "62"))   # createReport quota = 1 per minute (burst 15), shared with amazon_pnl.yml
_last_create_ts = 0.0


class QuotaExceeded(RuntimeError):
    """createReport still 429 after retries: stop asking for reports this run, keep what we have (next run continues)."""

INVENTORY_ONLY = os.environ.get("INVENTORY_ONLY", "0").strip() in ("1", "true", "yes")
REPORT_POLL_SECONDS = int(os.environ.get("REPORT_POLL_SECONDS", "20"))
REPORT_MAX_WAIT = int(os.environ.get("REPORT_MAX_WAIT", "600"))
RETRY_MONTH_HOURS = 20          # a month whose report came back empty/FATAL is retried after this many hours
MAX_TRIES_PER_MONTH = 3         # ... at most this many times, then it is left alone
STORAGE_REPORT = "GET_FBA_STORAGE_FEE_CHARGES_DATA"
LTSF_REPORT = "GET_FBA_FULFILLMENT_LONGTERM_STORAGE_FEE_CHARGES_DATA"
# Inventory Ledger (summary, DAILY): ending balance per SKU per day for the last 18 months -> historical on-hand units,
# used (a) as the inventory series for past days and (b) to BACK-TEST the estimate against months Amazon has billed.
LEDGER_REPORT = "GET_LEDGER_SUMMARY_VIEW_DATA"
LEDGER_MONTHS = int(os.environ.get("LEDGER_MONTHS", "18"))
PNL_PATH = os.environ.get("PNL_PATH", "data/amazon_pnl.json")     # FBAStorageFee actually charged per stored month (Finances)
# Fallback list rates (USD per cubic foot per month, US) when no report of that season has been seen yet.
# Learned rates from Amazon's own reports always win; these only bridge the first Oct-Dec before a Q4 report exists.
FALLBACK_RATES = {"standard": {"jan_sep": 0.78, "oct_dec": 2.40}, "oversize": {"jan_sep": 0.56, "oct_dec": 1.40}}
# v1.4: unit bases the back-test compares (the live estimate uses the best one, see choose_basis)
BASES = ("ledger_plus_transit", "ledger_ending", "inventory_on_hand")
CALIB_MONTHS = 6            # calibration = median(report / estimate) of the chosen basis over the last N billed months
CALIB_BOUNDS = (0.85, 1.15)
RECENT_MONTHS_UNCAPPED = 2  # the last N complete months are retried until Amazon publishes their report (no tries cap)
# v1.5
FEES_REPORT = "GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA"   # fee preview: today's package dims + size tier per SKU
DIMS_MAX_AGE_HOURS = 20
REMEASURE_TOLERANCE = 0.05     # fee-preview volume vs the report's item_volume: beyond 5% = Amazon re-measured the item
SUS_CARRY_MONTHS = 2           # the latest report's utilization surcharge is carried into the next 2 months
UNITS_CALIB_BOUNDS = (0.9, 1.1)
REFRESH_REPORT_MONTHS = 3      # the last 3 billed months are re-read once to keep Amazon's surcharge columns
LEDGER_CHUNK_MONTHS = int(os.environ.get("LEDGER_CHUNK_MONTHS", "4"))   # months per ledger report when back-filling
QUOTA_COOLDOWN_SECONDS = int(os.environ.get("QUOTA_COOLDOWN_SECONDS", "180"))

log = base.log


def now_tz():
    return datetime.now(timezone.utc).astimezone(base.REPORT_TZ)


def month_key(d):
    return d.strftime("%Y-%m")


def days_in_month(mk):
    y, m = int(mk[:4]), int(mk[5:7])
    nxt = datetime(y + (m == 12), (m % 12) + 1, 1)
    return (nxt - datetime(y, m, 1)).days


def month_range(start_mk, end_mk):
    y, m = int(start_mk[:4]), int(start_mk[5:7])
    out = []
    while True:
        mk = f"{y:04d}-{m:02d}"
        if mk > end_mk:
            break
        out.append(mk)
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def season(mk):
    return "oct_dec" if int(mk[5:7]) >= 10 else "jan_sep"


def tier_class(size_tier):
    t = (size_tier or "").lower()
    return "oversize" if ("oversize" in t or "large bulky" in t or "extra-large" in t or "extra large" in t or "bulky" in t) else "standard"


def num(v):
    try:
        return float(str(v).replace(",", "").strip() or 0)
    except ValueError:
        return 0.0


# ---------------------------------------------------------------- inventory ----------------------------------------------------------------
def fetch_inventory(access_token):
    """All FBA inventory summaries with details. Returns {sellerSku: {...}}."""
    out = {}
    params = {"details": "true", "granularityType": "Marketplace", "granularityId": base.MARKETPLACE_IDS[0],
              "marketplaceIds": ",".join(base.MARKETPLACE_IDS)}
    token = None
    pages = 0
    while True:
        p = dict(params)
        if token:
            p["nextToken"] = token
        res = base.sp_api_get("/fba/inventory/v1/summaries", access_token, p)
        pages += 1
        for s in (res.get("payload") or {}).get("inventorySummaries", []):
            d = s.get("inventoryDetails") or {}
            rq = d.get("reservedQuantity") or {}
            uq = d.get("unfulfillableQuantity") or {}
            rs = d.get("researchingQuantity") or {}
            sku = s.get("sellerSku") or s.get("fnSku")
            out[sku] = {
                "fnsku": s.get("fnSku"), "asin": s.get("asin"), "name": (s.get("productName") or "")[:80],
                "condition": s.get("condition"), "total": int(s.get("totalQuantity") or 0),
                "fulfillable": int(d.get("fulfillableQuantity") or 0),
                "inbound_working": int(d.get("inboundWorkingQuantity") or 0),
                "inbound_shipped": int(d.get("inboundShippedQuantity") or 0),
                "inbound_receiving": int(d.get("inboundReceivingQuantity") or 0),
                "reserved": int(rq.get("totalReservedQuantity") or 0),
                "reserved_orders": int(rq.get("pendingCustomerOrderQuantity") or 0),
                "reserved_transfer": int(rq.get("pendingTransshipmentQuantity") or 0),
                "reserved_fc": int(rq.get("fcProcessingQuantity") or 0),
                "unfulfillable": int(uq.get("totalUnfulfillableQuantity") or 0),
                "unf_customer_damaged": int(uq.get("customerDamagedQuantity") or 0),
                "unf_warehouse_damaged": int(uq.get("warehouseDamagedQuantity") or 0),
                "unf_carrier_damaged": int(uq.get("carrierDamagedQuantity") or 0),
                "unf_defective": int(uq.get("defectiveQuantity") or 0),
                "unf_expired": int(uq.get("expiredQuantity") or 0),
                "researching": int(rs.get("totalResearchingQuantity") or 0),
                "last_updated": s.get("lastUpdatedTime"),
            }
        pg = res.get("pagination") or {}
        token = pg.get("nextToken")
        if not token:
            break
    log(f"inventory: {len(out)} SKUs over {pages} page(s)")
    return out


def on_hand(row):
    return row["fulfillable"] + row["reserved"] + row["unfulfillable"] + row["researching"]


def inbound(row):
    return row["inbound_working"] + row["inbound_shipped"] + row["inbound_receiving"]


def compact_day(inv):
    """Per-day history row: sku -> [on_hand, fulfillable, reserved, inbound, unfulfillable, researching]."""
    return {sku: [on_hand(r), r["fulfillable"], r["reserved"], inbound(r), r["unfulfillable"], r["researching"]] for sku, r in inv.items()
            if on_hand(r) or inbound(r)}


# ---------------------------------------------------------------- reports ----------------------------------------------------------------
def request_report(access_token, report_type, start, end, label, report_options=None):
    body = {"reportType": report_type, "marketplaceIds": base.MARKETPLACE_IDS,
            "dataStartTime": base.iso(start), "dataEndTime": base.iso(end)}
    if report_options:
        body["reportOptions"] = report_options
    global _last_create_ts
    gap = CREATE_GAP_SECONDS - (time.time() - _last_create_ts)
    if _last_create_ts and gap > 0:
        time.sleep(gap)
    try:
        created = base.sp_api_post("/reports/2021-06-30/reports", access_token, body)
    except RuntimeError as e:
        # v1.5: the quota refills slowly - wait once, then try again before giving up for this run
        log(f"{label}: createReport throttled ({e}) - waiting {QUOTA_COOLDOWN_SECONDS}s once")
        time.sleep(QUOTA_COOLDOWN_SECONDS)
        try:
            created = base.sp_api_post("/reports/2021-06-30/reports", access_token, body)
        except RuntimeError as e2:
            raise QuotaExceeded(f"{label}: createReport quota exceeded ({e2})") from e2
    _last_create_ts = time.time()
    rid = created.get("reportId")
    if not rid:
        raise RuntimeError(f"createReport returned no reportId: {json.dumps(created)[:300]}")
    log(f"{label}: report {rid} requested ({report_type} {body['dataStartTime']}..{body['dataEndTime']})")
    waited = 0
    while waited <= REPORT_MAX_WAIT:
        time.sleep(REPORT_POLL_SECONDS)
        waited += REPORT_POLL_SECONDS
        st = base.sp_api_get(f"/reports/2021-06-30/reports/{rid}", access_token)
        state = st.get("processingStatus")
        if state == "DONE":
            log(f"{label}: report {rid} DONE after ~{waited}s")
            return base.download_report_document(access_token, st["reportDocumentId"])
        if state in ("CANCELLED", "FATAL"):
            log(f"{label}: report {rid} ended {state}")
            return "" if state == "CANCELLED" else None
    log(f"{label}: report {rid} not DONE after {REPORT_MAX_WAIT}s")
    return None


def parse_tsv(text):
    rd = csv.DictReader(io.StringIO(text), delimiter="\t")
    rows = []
    for r in rd:
        rows.append({(k or "").strip().lower().replace(" ", "_").replace("-", "_"): (v or "").strip() for k, v in r.items()})
    return rows


def ingest_storage_report(text, mk, fnsku_to_sku):
    """Monthly storage fee report -> {total, by_sku, rates}. Rows are per ASIN x fulfillment center."""
    rows = parse_tsv(text)
    by_sku, rates, total, n = {}, {}, 0.0, 0
    charge_months = set()
    sus_ratios, sus_units = [], None
    for r in rows:
        moc = r.get("month_of_charge") or ""
        if moc:
            charge_months.add(moc)
        fee = num(r.get("estimated_monthly_storage_fee"))
        fn = r.get("fnsku") or ""
        sku = fnsku_to_sku.get(fn) or fn or r.get("asin")
        d = by_sku.setdefault(sku, {"fee": 0.0, "avg_qty": 0.0, "volume": 0.0, "unit_volume": 0.0, "tier": None, "rate": 0.0, "asin": r.get("asin"), "fnsku": fn, "incentive": 0.0, "fcs": 0,
                                    "base_fee": 0.0, "sus_fee": 0.0})
        d["fee"] += fee
        d["avg_qty"] += num(r.get("average_quantity_on_hand"))
        d["volume"] += num(r.get("estimated_total_item_volume"))
        uv = num(r.get("item_volume"))
        if uv:
            d["unit_volume"] = uv
        d["tier"] = r.get("product_size_tier") or d["tier"]
        rate = num(r.get("storage_rate"))
        if rate:
            d["rate"] = rate
            rates.setdefault(tier_class(d["tier"]), []).append(rate)
        d["incentive"] += num(r.get("total_incentive_fee_amount"))
        d["fcs"] += 1
        # v1.5: Amazon's own split of the fee (base monthly storage fee + storage utilization surcharge)
        d["base_fee"] += num(r.get("est_base_msf"))
        d["sus_fee"] += num(r.get("est_sus"))
        if num(r.get("base_rate")):
            d["base_rate"] = num(r.get("base_rate"))
        if num(r.get("utilization_surcharge_rate")):
            d["sus_rate"] = num(r.get("utilization_surcharge_rate"))
        sides = [num(r.get("longest_side")), num(r.get("median_side")), num(r.get("shortest_side"))]
        if all(sides):
            d["dims"] = sides
            d["dim_unit"] = r.get("measurement_units") or None
        if r.get("storage_utilization_ratio"):
            sus_ratios.append(num(r.get("storage_utilization_ratio")))
            sus_units = r.get("storage_utilization_ratio_units") or sus_units
        total += fee
        n += 1
    for d in by_sku.values():
        for k in ("fee", "avg_qty", "volume", "unit_volume", "rate", "incentive", "base_fee", "sus_fee"):
            d[k] = round(d[k], 4)
    # Rate per size tier: the report's storage_rate column when present, otherwise the EFFECTIVE rate implied by the
    # report itself (fee / (average units x unit volume)) - this includes the utilization surcharge automatically.
    rate_med = {t: round(statistics.median(v), 4) for t, v in rates.items()}
    eff_fee, eff_cuft = {}, {}
    for d in by_sku.values():
        t = tier_class(d.get("tier"))
        eff_fee[t] = eff_fee.get(t, 0.0) + d["fee"]
        eff_cuft[t] = eff_cuft.get(t, 0.0) + d["avg_qty"] * d["unit_volume"]
    rate_eff = {t: round(eff_fee[t] / eff_cuft[t], 4) for t in eff_fee if eff_cuft.get(t)}
    for t, r in rate_eff.items():
        rate_med.setdefault(t, r)
    # v1.4: the rate Amazon actually applied = fee / estimated_total_item_volume (equals the list rate)
    vol_fee, vol_cuft = {}, {}
    for d in by_sku.values():
        t = tier_class(d.get("tier"))
        vol_fee[t] = vol_fee.get(t, 0.0) + d["fee"]
        vol_cuft[t] = vol_cuft.get(t, 0.0) + d["volume"]
    rate_vol = {t: round(vol_fee[t] / vol_cuft[t], 4) for t in vol_fee if vol_cuft.get(t)}
    # v1.5: per size tier, Amazon's base fee and utilization surcharge (only when the report carries those columns)
    cols = list(rows[0].keys()) if rows else []
    sus = None
    if "est_sus" in cols and "est_base_msf" in cols:
        by_t = {}
        for d in by_sku.values():
            x = by_t.setdefault(tier_class(d.get("tier")), {"fee": 0.0, "base_fee": 0.0, "sus_fee": 0.0, "vol": 0.0})
            x["fee"] += d["fee"]; x["base_fee"] += d["base_fee"]; x["sus_fee"] += d["sus_fee"]; x["vol"] += d["volume"]
        for x in by_t.values():
            x["base_rate"] = round(x["base_fee"] / x["vol"], 4) if x["vol"] else None
            x["sus_rate"] = round(x["sus_fee"] / x["vol"], 4) if x["vol"] else None
            for k in ("fee", "base_fee", "sus_fee", "vol"):
                x[k] = round(x[k], 2)
        sus = {"by_tier": by_t, "utilization_ratio": round(statistics.median(sus_ratios), 2) if sus_ratios else None,
               "utilization_ratio_units": sus_units}
    return {"total": round(total, 2), "rows": n, "skus": len(by_sku), "by_sku": by_sku, "rates": rate_med, "rates_effective": rate_eff, "rates_volume": rate_vol,
            "sus": sus, "ingest": SCRIPT_VERSION,
            "columns": cols,
            "months_in_report": sorted(charge_months), "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}


def ingest_ltsf_report(text, fnsku_to_sku):
    rows = parse_tsv(text)
    by_sku, total, n = {}, 0.0, 0
    dates = set()
    for r in rows:
        amt = num(r.get("amount_charged") or r.get("amount_charged_usd") or r.get("12_mo_long_terms_storage_fee") or r.get("amount"))
        fn = r.get("fnsku") or ""
        sku = r.get("sku") or fnsku_to_sku.get(fn) or fn
        d = by_sku.setdefault(sku, {"fee": 0.0, "qty": 0.0})
        d["fee"] += amt
        d["qty"] += num(r.get("qty_charged") or r.get("quantity_charged") or r.get("qty_charged_12_mo"))
        total += amt
        n += 1
        if r.get("snapshot_date"):
            dates.add(r["snapshot_date"][:10])
    for d in by_sku.values():
        d["fee"] = round(d["fee"], 2)
    return {"total": round(total, 2), "rows": n, "by_sku": by_sku, "snapshot_dates": sorted(dates),
            "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}


def ingest_fee_preview(text):
    """v1.5: FBA fee preview -> {sku: {cuft, tier, dims, unit}}: Amazon's current package dimensions per SKU (the same
    measurement the storage fee uses), so a new SKU or a re-measured item gets the right volume before its first
    storage report."""
    rows = parse_tsv(text)
    out = {}
    for r in rows:
        sku = r.get("sku")
        if not sku:
            continue
        l, m, sh = num(r.get("longest_side")), num(r.get("median_side")), num(r.get("shortest_side"))
        unit = (r.get("unit_of_dimension") or "").lower()
        if not (l > 0 and m > 0 and sh > 0):
            continue
        cu = l * m * sh
        cuft = cu / 28316.846592 if unit.startswith("c") else cu / 1728.0      # centimeters or inches
        out[sku] = {"cuft": round(cuft, 4), "tier": r.get("product_size_tier") or None, "dims": [l, m, sh], "unit": unit or None}
    return out, (list(rows[0].keys()) if rows else [])


# ---------------------------------------------------------------- estimate ----------------------------------------------------------------
def months_between(a, b):
    return (int(b[:4]) - int(a[:4])) * 12 + int(b[5:7]) - int(a[5:7])


def billed_months(months, before=None):
    return sorted(m for m, v in months.items() if v and not v.get("empty") and v.get("by_sku") and (before is None or m < before))


def report_tier_rates(rep, mk):
    """v1.5: {tier: {"base", "sus", "vol"}} of one report: rate per billed cu ft split into the base (list) rate and the
    storage utilization surcharge. Reports read by v1.5 carry Amazon's own split (est_base_msf / est_sus); older ones:
    fee / billed volume, where anything more than 3% above the list rate is the surcharge (and up to 10% below it is
    still the list rate)."""
    out = {}
    by_t = ((rep.get("sus") or {}).get("by_tier")) or {}
    if by_t:
        for t, x in by_t.items():
            if x.get("vol"):
                base_fee = x.get("base_fee") or (x.get("fee", 0.0) - (x.get("sus_fee") or 0.0))
                out[t] = {"base": base_fee / x["vol"], "sus": (x.get("sus_fee") or 0.0) / x["vol"], "vol": x["vol"]}
        return out
    fee, vol = {}, {}
    for d in (rep.get("by_sku") or {}).values():
        t = tier_class(d.get("tier"))
        fee[t] = fee.get(t, 0.0) + (d.get("fee") or 0.0)
        vol[t] = vol.get(t, 0.0) + (d.get("volume") or 0.0)
    for t in fee:
        if not vol.get(t):
            continue
        r = fee[t] / vol[t]
        lst = FALLBACK_RATES[t][season(mk)]
        if r > lst * 1.03:
            out[t] = {"base": lst, "sus": r - lst, "vol": vol[t]}
        else:     # incentives / rounding on a few units: within 10% below the list rate counts as the list rate
            out[t] = {"base": lst if r >= lst * 0.9 else r, "sus": 0.0, "vol": vol[t]}
    return out


def rates_for(months, mk):
    """v1.5: ({tier: rate per cu ft}, detail) for estimating month mk from reports of EARLIER months only:
    base = list rate of mk's season (latest earlier report of that season with >= 5 cu ft of the tier, else
    FALLBACK_RATES); surcharge = the latest earlier report's utilization surcharge per tier when that report is at most
    SUS_CARRY_MONTHS months older than mk (Amazon recomputes the storage utilization ratio every month)."""
    s = season(mk)
    base = {t: FALLBACK_RATES[t][s] for t in FALLBACK_RATES}
    earlier = billed_months(months, before=mk)
    for m in earlier:
        if season(m) != s:
            continue
        for t, x in report_tier_rates(months[m], m).items():
            if x["vol"] >= 5 and t in base:
                base[t] = round(x["base"], 4)
    sus = {t: 0.0 for t in FALLBACK_RATES}
    sus_from = None
    if earlier and months_between(earlier[-1], mk) <= SUS_CARRY_MONTHS:
        sus_from = earlier[-1]
        for t, x in report_tier_rates(months[sus_from], sus_from).items():
            if x["vol"] >= 5 and t in sus:
                sus[t] = round(max(0.0, x["sus"]), 4)
    return {t: round(base[t] + sus[t], 4) for t in base}, {"base": base, "surcharge": sus, "surcharge_from": sus_from}


def sku_volumes(months, dims=None, before=None):
    """v1.5: sku -> (billed unit volume cu ft, tier class) for estimating, + (fallback volume, fallback tier), stats.
    billed unit volume = current item volume x billing factor:
      billing factor      = billed volume / average units / item_volume of the latest report listing the SKU with
                            >= 0.5 average units (Amazon bills slightly less than units x item_volume), else the median;
      current item volume = the latest report's item_volume; Amazon's fee-preview dims (live only) replace it when the
                            SKU has no report yet or the two differ by more than REMEASURE_TOLERANCE (re-measured item),
                            scaled by the median fee-preview / report ratio of the SKUs where they agree."""
    last = {}
    factors = []
    for mk in billed_months(months, before=before):
        for sku, d in months[mk]["by_sku"].items():
            iv = d.get("unit_volume") or 0.0
            f = None
            if iv and d.get("volume") and (d.get("avg_qty") or 0) >= 0.5:
                f = d["volume"] / d["avg_qty"] / iv
                if not 0.8 <= f <= 1.1:
                    f = None
            if not iv and d.get("volume") and (d.get("avg_qty") or 0) >= 0.5:
                iv, f = d["volume"] / d["avg_qty"], 1.0
            if not iv:
                continue
            p = last.get(sku)
            last[sku] = {"iv": iv, "f": f if f is not None else (p["f"] if p and p["iv"] == iv else None), "tier": tier_class(d.get("tier")), "mk": mk}
    for x in last.values():
        if x["f"] is not None:
            factors.append(x["f"])
    fmed = statistics.median(factors) if factors else 0.98
    stats = {"skus_with_report_volume": len(last), "billing_factor_median": round(fmed, 4)}
    # fee preview vs report: scale (convention) and re-measured items
    dscale, remeasured = 1.0, []
    if dims:
        rr = []
        for sku, x in last.items():
            dc = (dims.get(sku) or {}).get("cuft")
            if dc and x["iv"]:
                rr.append(dc / x["iv"])
        if rr:
            agree = [r for r in rr if abs(r - 1) <= REMEASURE_TOLERANCE]
            dscale = 1.0 / statistics.median(agree) if agree else 1.0
            stats["dims_vs_report"] = {"skus": len(rr), "median_ratio": round(statistics.median(rr), 4),
                                       "within_2pct": round(sum(1 for r in rr if abs(r - 1) <= 0.02) / len(rr), 3), "scale": round(dscale, 4)}
    vol = {}
    for sku, x in last.items():
        cur = x["iv"]
        tier = x["tier"]
        dc = (dims or {}).get(sku, {}).get("cuft")
        if dc and abs(dc * dscale / x["iv"] - 1) > REMEASURE_TOLERANCE:
            remeasured.append({"sku": sku, "report": round(x["iv"], 4), "report_month": x["mk"], "fee_preview": round(dc * dscale, 4)})
            cur = dc * dscale
        vol[sku] = (round(cur * (x["f"] if x["f"] is not None else fmed), 4), tier)
    new_skus = 0
    for sku, x in (dims or {}).items():
        if sku not in vol and x.get("cuft"):
            vol[sku] = (round(x["cuft"] * dscale * fmed, 4), tier_class(x.get("tier")))
            new_skus += 1
    vals = [v[0] for v in vol.values()]
    tiers = {}
    for v in vol.values():
        tiers[v[1]] = tiers.get(v[1], 0) + 1
    fallback = (round(statistics.median(vals), 4) if vals else 0.0, max(tiers, key=tiers.get) if tiers else "standard")
    stats.update({"skus_with_volume": len(vol), "from_fee_preview_only": new_skus, "remeasured": remeasured[:40], "fallback": list(fallback)})
    return vol, fallback, stats


def estimate_day(row, vol, fallback, rate_t, dim):
    """USD storage accrual for one day = sum over SKUs of units x billed unit volume x rate (tier) / days in month."""
    fee, units, cuft, unknown = 0.0, 0, 0.0, 0
    for sku, arr in row.items():
        oh = arr[0] if isinstance(arr, list) else on_hand(arr)
        if oh <= 0:
            continue
        if sku in vol:
            uv, tier = vol[sku]
        else:
            uv, tier = fallback
            unknown += oh
        fee += oh * uv * rate_t.get(tier, 0.0) / dim
        units += oh
        cuft += oh * uv
    return round(fee, 4), units, round(cuft, 2), unknown


def ingest_ledger_report(text, fnsku_to_sku):
    """Inventory Ledger summary (daily): ({iso: {sku: ending balance units (all dispositions, all locations)}},
    rows, v1.4: {iso: {sku: units in transit between warehouses}}, columns seen)."""
    rows = parse_tsv(text)
    out = {}
    transit = {}
    n = 0
    for r in rows:
        raw = r.get("date") or ""
        iso = None
        for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%d/%m/%Y"):
            try:
                iso = datetime.strptime(raw[:10], fmt).strftime("%Y-%m-%d"); break
            except ValueError:
                continue
        if not iso:
            continue
        sku = r.get("msku") or fnsku_to_sku.get(r.get("fnsku") or "") or r.get("fnsku") or r.get("asin")
        qty = num(r.get("ending_warehouse_balance"))
        if not sku:
            continue
        d = out.setdefault(iso, {})
        d[sku] = int(round(d.get(sku, 0) + qty))
        tq = num(r.get("in_transit_between_warehouses"))
        if tq:
            t = transit.setdefault(iso, {})
            t[sku] = int(round(t.get(sku, 0) + tq))
        n += 1
    return out, n, transit, (list(rows[0].keys()) if rows else [])


def basis_row(basis, k, ledger_daily, transit_daily, inv_daily, transit_months=None):
    """v1.4: per-SKU units of day k under one unit basis -> {sku: [units]} or None when that day has no data
    (v1.5: ledger_plus_transit only in months whose ledger was read with the in-transit column)."""
    if basis == "inventory_on_hand":
        row = inv_daily.get(k)
        return {sku: [arr[0] if isinstance(arr, list) else on_hand(arr)] for sku, arr in row.items()} if row else None
    led = ledger_daily.get(k)
    if led is None:
        return None
    if basis == "ledger_ending":
        return {sku: [q] for sku, q in led.items()}
    if transit_months is not None and k[:7] not in transit_months:
        return None
    tr = transit_daily.get(k) or {}
    return {sku: [led.get(sku, 0) + tr.get(sku, 0)] for sku in set(led) | set(tr)}


def backtest_month(mk, months, ledger_daily, transit_daily, inv_daily, posted, transit_months=None):
    """v1.5: compare the estimate with Amazon's report for a billed month mk.
      volume_rate: Amazon's own average units per SKU x unit volumes and rates known BEFORE mk (earlier reports
                   only) / report total -> how well volumes + rates are predicted, free of any unit-count error;
      bases[b]   : per unit basis with data on >= 80% of the days:
                   units_vs_report = average daily units of the basis / Amazon's billed average units,
                   ratio_in_sample = basis units x mk's own billed volumes and rates (isolates the unit count),
                   ratio_out_of_sample = basis units x volumes and rates from earlier reports only
                   (= the live estimate at month end, before fee-preview dims existed)."""
    rep = months[mk]
    tot = rep["total"]
    dim = days_in_month(mk)
    vol_in, fb_in, _ = sku_volumes({mk: rep})
    rate_in = {t: x["base"] + x["sus"] for t, x in report_tier_rates(rep, mk).items()}
    for t in FALLBACK_RATES:
        rate_in.setdefault(t, FALLBACK_RATES[t][season(mk)])
    vol_oos, fb_oos, _ = sku_volumes(months, before=mk)
    # the live estimate also reads Amazon's current package dims (fee preview); simulated here with the month's own
    # item_volume, which is the measurement Amazon billed (new SKUs + re-measured items)
    dims_sim = {sku: {"cuft": x["unit_volume"], "tier": x.get("tier")} for sku, x in rep["by_sku"].items() if x.get("unit_volume")}
    vol_dim, fb_dim, _ = sku_volumes(months, dims=dims_sim, before=mk)
    rate_oos, rate_det = rates_for(months, mk)
    out = {"report_total": tot, "posted": posted, "ratio_report_vs_posted": round(tot / abs(posted), 4) if posted else None,
           "rates_used": rate_oos, "surcharge_from": rate_det["surcharge_from"], "rates_actual": {t: round(r, 4) for t, r in rate_in.items()}}
    if vol_oos and tot:
        row = {sku: [d.get("avg_qty") or 0.0] for sku, d in rep["by_sku"].items()}
        f, u, _, unk = estimate_day(row, vol_oos, fb_oos, rate_oos, 1)
        out["volume_rate"] = {"est": round(f, 2), "ratio": round(f / tot, 4), "units_without_volume_share": round(unk / u, 4) if u else None}
        f2 = estimate_day(row, vol_dim, fb_dim, rate_oos, 1)[0]
        out["volume_rate_dims"] = {"est": round(f2, 2), "ratio": round(f2 / tot, 4)}
    rep_units = sum(d.get("avg_qty", 0) for d in rep["by_sku"].values())
    days = [f"{mk}-{i+1:02d}" for i in range(dim)]
    bases = {}
    for b in BASES:
        rows = {k: basis_row(b, k, ledger_daily, transit_daily, inv_daily, transit_months) for k in days}
        have = [k for k in days if rows[k] is not None]
        if len(have) < 0.8 * dim:
            continue
        e_in = e_oos = e_dim = 0.0
        units = 0
        for k in have:
            e_in += estimate_day(rows[k], vol_in, fb_in, rate_in, dim)[0]
            if vol_oos:
                e_oos += estimate_day(rows[k], vol_oos, fb_oos, rate_oos, dim)[0]
                e_dim += estimate_day(rows[k], vol_dim, fb_dim, rate_oos, dim)[0]
            units += sum((v[0] if isinstance(v, list) else 0) for v in rows[k].values() if (v[0] if isinstance(v, list) else 0) > 0)
        sc = dim / len(have)
        e_in, e_oos, e_dim = round(e_in * sc, 2), round(e_oos * sc, 2), round(e_dim * sc, 2)
        bases[b] = {"days": len(have), "avg_units": round(units / len(have), 1),
                    "units_vs_report": round(units / len(have) / rep_units, 4) if rep_units else None,
                    "est_in_sample": e_in, "ratio_in_sample": round(e_in / tot, 4) if tot else None,
                    "est_out_of_sample": e_oos if vol_oos else None, "ratio_out_of_sample": round(e_oos / tot, 4) if (tot and vol_oos) else None,
                    "ratio_out_of_sample_dims": round(e_dim / tot, 4) if (tot and vol_oos) else None}
    out["bases"] = bases
    return out


def _err_stats(pairs):
    """[(month, ratio)] -> {months, mape, max_abs, within_3pct, by_month}."""
    pairs = [(m, r) for m, r in pairs if r]
    if not pairs:
        return None
    e = [abs(r - 1) for _, r in pairs]
    return {"months": len(pairs), "from": pairs[0][0], "to": pairs[-1][0], "mape": round(sum(e) / len(e), 4), "max_abs": round(max(e), 4),
            "within_3pct": sum(1 for x in e if x <= 0.03), "by_month": {m: round(r, 4) for m, r in pairs}}


def choose_basis(backtest):
    """v1.5: the unit basis whose daily units match Amazon's billed average units best (mean |units_vs_report - 1| over
    the last 12 billed months, >= 2 months needed) + a UNITS calibration = 1 / median(units_vs_report) over the last
    CALIB_MONTHS months (bounded 0.9-1.1). Volumes and rates follow Amazon's formula and get no calibration."""
    best, stats = None, {}
    for b in BASES:
        rows = [(mk, bt["bases"][b]) for mk, bt in sorted(backtest.items()) if (bt.get("bases") or {}).get(b, {}).get("units_vs_report")][-12:]
        if not rows:
            continue
        u = [x["units_vs_report"] for _, x in rows]
        recent = sorted(u[-CALIB_MONTHS:])
        med = recent[len(recent) // 2] if len(recent) % 2 else (recent[len(recent) // 2 - 1] + recent[len(recent) // 2]) / 2
        calib = min(UNITS_CALIB_BOUNDS[1], max(UNITS_CALIB_BOUNDS[0], 1 / med)) if med else 1.0
        stats[b] = {"months": len(rows), "from": rows[0][0], "to": rows[-1][0], "units_mae": round(sum(abs(x - 1) for x in u) / len(u), 4),
                    "units_median_ratio": round(med, 4), "calibration": round(calib, 4),
                    "in_sample": _err_stats([(mk, x["ratio_in_sample"] * calib if x.get("ratio_in_sample") else None) for mk, x in rows]),
                    "month_end_estimate": _err_stats([(mk, x["ratio_out_of_sample"] * calib if x.get("ratio_out_of_sample") else None) for mk, x in rows]),
                    "month_end_estimate_dims": _err_stats([(mk, x["ratio_out_of_sample_dims"] * calib if x.get("ratio_out_of_sample_dims") else None) for mk, x in rows])}
        if len(rows) >= 2 and (best is None or stats[b]["units_mae"] < stats[best]["units_mae"]):
            best = b
    return best, stats


# ---------------------------------------------------------------- main ----------------------------------------------------------------
def main():
    client_id = os.environ.get("AMAZON_SP_API_CLIENT_ID", "").strip()
    client_secret = os.environ.get("AMAZON_SP_API_CLIENT_SECRET", "").strip()
    refresh_token = os.environ.get("AMAZON_SP_API_REFRESH_TOKEN", "").strip()
    if not (client_id and client_secret and refresh_token):
        log("Missing AMAZON_SP_API_* env vars"); sys.exit(2)

    prev = {}
    if os.path.exists(OUTPUT_PATH):
        try:
            prev = json.load(open(OUTPUT_PATH, encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            log(f"previous file unreadable ({e}) - starting fresh")
    inv_daily = dict((prev.get("inventory") or {}).get("daily") or {})
    months = dict((prev.get("storage") or {}).get("months") or {})
    ltsf_months = dict((prev.get("ltsf") or {}).get("months") or {})
    fnsku_to_sku = dict((prev.get("meta") or {}).get("fnsku_to_sku") or {})
    ledger_months = dict((prev.get("ledger") or {}).get("months") or {})
    ledger_daily = dict((prev.get("ledger") or {}).get("daily") or {})
    transit_daily = dict((prev.get("ledger") or {}).get("transit_daily") or {})   # v1.4
    ledger_columns = list((prev.get("ledger") or {}).get("columns") or [])
    dims = dict((prev.get("dims") or {}).get("by_sku") or {})          # v1.5 fee-preview package dims
    dims_meta = dict((prev.get("dims") or {}).get("meta") or {})
    warnings = {}

    today = now_tz()
    today_key = today.strftime("%Y-%m-%d")
    access_token = base.get_access_token(client_id, client_secret, refresh_token)

    # 1. inventory snapshot ----------------------------------------------------------------------
    inv = fetch_inventory(access_token)
    for sku, r in inv.items():
        if r.get("fnsku"):
            fnsku_to_sku[r["fnsku"]] = sku
    inv_daily[today_key] = compact_day(inv)
    # keep the history bounded to HISTORY_START
    inv_daily = {k: v for k, v in inv_daily.items() if k >= HISTORY_START}

    # 2. monthly reports ------------------------------------------------------------------------
    requested = 0
    if not INVENTORY_ONLY:
        last_complete = month_key((today.replace(day=1) - timedelta(days=1)))
        wanted = month_range(HISTORY_START[:7], last_complete)
        nowts = time.time()

        recent_cut = month_range(HISTORY_START[:7], last_complete)[-RECENT_MONTHS_UNCAPPED:]
        refresh_cut = month_range(HISTORY_START[:7], last_complete)[-REFRESH_REPORT_MONTHS:]

        # v1.5: Amazon's current package dims per SKU (fee preview), once a day
        if nowts - (dims_meta.get("tried_ts") or 0) > DIMS_MAX_AGE_HOURS * 3600 and requested < MAX_REPORTS_PER_RUN:
            dims_meta["tried_ts"] = nowts
            try:
                end_fp = datetime.now(timezone.utc) - timedelta(minutes=5)
                txt = request_report(access_token, FEES_REPORT, end_fp - timedelta(hours=73), end_fp, "fee preview (dims)")
                requested += 1
                got, cols = ingest_fee_preview(txt) if txt else ({}, [])
                if got:
                    dims = got
                    dims_meta.update({"fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "skus": len(got), "columns": cols, "error": None})
                    log(f"fee preview: package dims for {len(got)} SKUs")
                else:
                    dims_meta["error"] = "no rows" if txt else "cancelled/fatal"
                    dims_meta["tried_ts"] = nowts - (DIMS_MAX_AGE_HOURS - 4) * 3600      # retry in ~4 h
            except QuotaExceeded as e:
                log(str(e)); warnings["quota_exceeded"] = str(e)[:200]; requested = MAX_REPORTS_PER_RUN
                dims_meta["tried_ts"] = 0

        def due(entry, mk=None):
            if not entry:
                return True
            if entry.get("empty"):
                if entry.get("tries", 1) >= MAX_TRIES_PER_MONTH and mk not in recent_cut:   # v1.4: recent months keep retrying
                    return False          # Amazon does not publish that month (too old / no charge): stop asking
                return nowts - entry.get("tried_ts", 0) > RETRY_MONTH_HOURS * 3600
            return False

        def empty_entry(store, mk, reason):
            tries = (store.get(mk) or {}).get("tries", 0) + 1
            return {"empty": True, "tried_ts": nowts, "tries": tries, "reason": reason}

        for mk in reversed(wanted):          # newest months first: the P&L needs them most
            if requested >= MAX_REPORTS_PER_RUN:
                break
            ent_s = months.get(mk)
            refresh = bool(ent_s) and not ent_s.get("empty") and mk in refresh_cut and ent_s.get("ingest") is None   # v1.5
            if due(ent_s, mk) or refresh:
                start = datetime(int(mk[:4]), int(mk[5:7]), 1, tzinfo=timezone.utc)
                end = start + timedelta(days=days_in_month(mk)) - timedelta(seconds=1)
                try:
                    txt = request_report(access_token, STORAGE_REPORT, start, end, f"storage {mk}")
                except QuotaExceeded as e:
                    log(str(e)); warnings["quota_exceeded"] = str(e)[:200]; requested = MAX_REPORTS_PER_RUN; break
                requested += 1
                if txt:
                    rep = ingest_storage_report(txt, mk, fnsku_to_sku)
                    if rep["rows"] and rep["months_in_report"] and mk not in rep["months_in_report"]:
                        # Amazon answered with another month's data (report not published yet for mk): keep it under ITS month
                        real = rep["months_in_report"][-1]
                        log(f"storage {mk}: report holds month_of_charge {rep['months_in_report']} -> stored as {real}, {mk} marked empty")
                        if not months.get(real) or months[real].get("empty"):
                            months[real] = rep
                        if refresh:
                            months[mk]["ingest"] = "refresh-mismatch"      # keep the month we already have
                        else:
                            months[mk] = empty_entry(months, mk, f"report returned {real}")
                    elif rep["rows"]:
                        months[mk] = rep
                        log(f"storage {mk}: {rep['skus']} SKUs, {rep['rows']} rows, total ${rep['total']:,.2f}, rates {rep['rates_volume']}, "
                            f"surcharge {json.dumps((rep.get('sus') or {}).get('by_tier'))} ratio {(rep.get('sus') or {}).get('utilization_ratio')}")
                    elif refresh:
                        months[mk]["ingest"] = "refresh-empty"
                    else:
                        months[mk] = empty_entry(months, mk, "no rows")
                elif refresh:
                    months[mk]["ingest"] = "refresh-failed"
                else:
                    months[mk] = empty_entry(months, mk, "cancelled" if txt == "" else "fatal/timeout")
            if requested >= MAX_REPORTS_PER_RUN:
                break
            if due(ltsf_months.get(mk), mk):
                start = datetime(int(mk[:4]), int(mk[5:7]), 1, tzinfo=timezone.utc)
                end = start + timedelta(days=days_in_month(mk)) - timedelta(seconds=1)
                try:
                    txt = request_report(access_token, LTSF_REPORT, start, end, f"ltsf {mk}")
                except QuotaExceeded as e:
                    log(str(e)); warnings["quota_exceeded"] = str(e)[:200]; requested = MAX_REPORTS_PER_RUN; break
                requested += 1
                if txt:
                    rep = ingest_ltsf_report(txt, fnsku_to_sku)
                    ltsf_months[mk] = rep if rep["rows"] else empty_entry(ltsf_months, mk, "no rows")
                    if rep["rows"]:
                        log(f"ltsf {mk}: {rep['rows']} rows, total ${rep['total']:,.2f}")
                else:
                    ltsf_months[mk] = empty_entry(ltsf_months, mk, "cancelled" if txt == "" else "fatal/timeout")

        # Inventory Ledger, one month per report (DAILY ending balances), newest first, within the 18-month window
        cur_mk = month_key(today)
        done_chunk = set()
        ledger_wanted = [m for m in wanted if m >= month_key(today.replace(day=1) - timedelta(days=31 * LEDGER_MONTHS - 31))] + [cur_mk]
        for mk in reversed(ledger_wanted):
            if requested >= MAX_REPORTS_PER_RUN:
                break
            ent = ledger_months.get(mk)
            # the current month is refreshed while it grows (days before the hourly snapshots began); past months once
            cur_due = mk == cur_mk and ent and not ent.get("empty") and ent.get("days", 0) < today.day - 1
            def needs_transit(e):
                return bool(e) and not e.get("empty") and not e.get("transit") and (e.get("transit_tries") or 0) < 2
            no_transit = needs_transit(ent)   # v1.4: re-fetch once for the in-transit column
            if mk in done_chunk or not (due(ent, mk) or cur_due or no_transit):
                continue
            chunk = [mk]
            if no_transit and not (due(ent, mk) or cur_due) and not ent.get("chunk_failed"):
                # v1.5: older months that also lack the in-transit column go in the same report (fewer createReport calls)
                for m2 in reversed(ledger_wanted):
                    if m2 < chunk[-1] and len(chunk) < LEDGER_CHUNK_MONTHS:
                        e2 = ledger_months.get(m2)
                        if needs_transit(e2) and not e2.get("chunk_failed") and months_between(m2, chunk[-1]) == 1:
                            chunk.append(m2)
            start = datetime(int(chunk[-1][:4]), int(chunk[-1][5:7]), 1, tzinfo=timezone.utc)
            m0 = datetime(int(mk[:4]), int(mk[5:7]), 1, tzinfo=timezone.utc)
            end = m0 + timedelta(days=days_in_month(mk)) - timedelta(seconds=1)
            label = f"ledger {mk}" if len(chunk) == 1 else f"ledger {chunk[-1]}..{mk}"
            body_opts = {"aggregateByLocation": "COUNTRY", "aggregatedByTimePeriod": "DAILY"}
            try:
                txt = request_report(access_token, LEDGER_REPORT, start, end, label, body_opts)
            except QuotaExceeded as e:
                log(str(e)); warnings["quota_exceeded"] = str(e)[:200]; break
            requested += 1
            done_chunk.update(chunk)
            got_all, n, tr_all, cols = ingest_ledger_report(txt, fnsku_to_sku) if txt else ({}, 0, {}, [])
            if cols:
                ledger_columns = cols
            for m3 in chunk:
                got = {k: v for k, v in got_all.items() if k[:7] == m3}
                if got:
                    ledger_daily.update(got)
                    for k in list(transit_daily):
                        if k[:7] == m3:
                            del transit_daily[k]
                    transit_daily.update({k: v for k, v in tr_all.items() if k[:7] == m3})
                    ledger_months[m3] = {"days": len(got), "rows": sum(len(v) for v in got.values()), "skus": len({s for v in got.values() for s in v}), "transit": True,
                                         "transit_units_avg": round(sum(sum(v.values()) for k, v in tr_all.items() if k[:7] == m3) / max(1, len(got)), 1),
                                         "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                                         **({"chunk": f"{chunk[-1]}..{chunk[0]}"} if len(chunk) > 1 else {})}
                    log(f"ledger {m3}: {len(got)} days, {ledger_months[m3]['rows']} rows, {ledger_months[m3]['skus']} SKUs")
                elif len(chunk) > 1:
                    e3 = ledger_months.get(m3) or {}
                    if e3 and not e3.get("empty"):
                        e3["chunk_failed"] = True          # next time: one month per report
                        e3["transit_tries"] = (e3.get("transit_tries") or 0) + (0 if txt else 1)
                        ledger_months[m3] = e3
                    log(f"ledger {m3}: no rows in the {label} report")
                elif ent and not ent.get("empty") and not (due(ent, mk) or cur_due):
                    ent["transit_tries"] = (ent.get("transit_tries") or 0) + 1
                    ledger_months[m3] = ent
                else:
                    ledger_months[m3] = empty_entry(ledger_months, m3, "no rows" if txt else ("cancelled" if txt == "" else "fatal/timeout"))

    # 3. daily storage cost -------------------------------------------------------------------------
    # v1.5: back-test every billed month, pick the unit basis by units accuracy, then estimate with Amazon's formula
    posted_by_month = {}
    if os.path.exists(PNL_PATH):
        try:
            posted_by_month = (json.load(open(PNL_PATH, encoding="utf-8")).get("monthly_storage_fees") or {})
        except Exception as e:  # noqa: BLE001
            warnings["pnl_unreadable"] = str(e)
    transit_months = {m for m, e in ledger_months.items() if e and not e.get("empty") and e.get("transit")}
    backtest = {}
    for mk in billed_months(months):
        try:
            backtest[mk] = backtest_month(mk, months, ledger_daily, transit_daily, inv_daily, posted_by_month.get(mk), transit_months)
        except Exception as e:  # noqa: BLE001
            warnings.setdefault("backtest_errors", []).append(f"{mk}: {e}")
    basis, basis_stats = choose_basis(backtest)
    calib = basis_stats[basis]["calibration"] if basis else 1.0
    vol, fallback, vol_stats = sku_volumes(months, dims=dims)
    rate_cache = {}

    def rate_of(mk):
        if mk not in rate_cache:
            rate_cache[mk] = rates_for(months, mk)
        return rate_cache[mk][0]
    # inventory API -> chosen basis scale for the latest days the ledger does not have yet (median of the last 7 overlaps)
    inv_scale = 1.0
    if basis and basis != "inventory_on_hand":
        ov = []
        for k in sorted(inv_daily, reverse=True):
            br = basis_row(basis, k, ledger_daily, transit_daily, inv_daily, transit_months)
            if br is None:
                continue
            f_b = estimate_day(br, vol, fallback, rate_of(k[:7]), days_in_month(k[:7]))[0]
            f_i = estimate_day(inv_daily[k], vol, fallback, rate_of(k[:7]), days_in_month(k[:7]))[0]
            if f_i > 0:
                ov.append(f_b / f_i)
            if len(ov) >= 7:
                break
        if ov:
            ov.sort()
            inv_scale = ov[len(ov) // 2]
    daily = {}
    d = datetime.strptime(HISTORY_START, "%Y-%m-%d").date()
    end_d = today.date()
    while d <= end_d:
        k = d.isoformat()
        mk = k[:7]
        rep = months.get(mk)
        if rep and not rep.get("empty"):
            daily[k] = {"fee": round(rep["total"] / days_in_month(mk), 4), "est": False, "src": "report"}
        else:
            row, src, scale = None, None, calib
            if basis and basis != "inventory_on_hand":
                row = basis_row(basis, k, ledger_daily, transit_daily, inv_daily, transit_months)
                src = basis if row is not None else None
            if row is None and k in inv_daily:
                row = inv_daily[k]; src = "inventory"
                if basis and basis != "inventory_on_hand":
                    scale = calib * inv_scale; src = "inventory_scaled"
            if row is None and k in ledger_daily:
                row = {sku: [q] for sku, q in ledger_daily[k].items()}; src = "ledger"
            if row is None:
                # no snapshot for that day: use the nearest earlier snapshot (or today's) - flagged
                keys = [x for x in inv_daily if x <= k]
                if keys:
                    row = inv_daily[max(keys)]; src = "inventory:" + max(keys)
                elif inv_daily:
                    row = inv_daily[min(inv_daily)]; src = "inventory:" + min(inv_daily)
                if row is not None and basis and basis != "inventory_on_hand":
                    scale = calib * inv_scale
            if row is None or not vol:
                daily[k] = {"fee": 0.0, "est": True, "src": "none"}
            else:
                fee, units, cuft, unknown = estimate_day(row, vol, fallback, rate_of(mk), days_in_month(mk))
                daily[k] = {"fee": round(fee * scale, 4), "est": True, "src": src, "units": units, "cuft": cuft, "unknown_units": unknown,
                            "raw": fee, "scale": round(scale, 4)}
                if unknown:
                    warnings.setdefault("units_without_volume", set()).add(mk)
        d += timedelta(days=1)
    vr = _err_stats([(mk, (bt.get("volume_rate") or {}).get("ratio")) for mk, bt in sorted(backtest.items())])
    accuracy = {
        "month_end_estimate": (basis_stats.get(basis) or {}).get("month_end_estimate") if basis else None,
        "month_end_estimate_dims": (basis_stats.get(basis) or {}).get("month_end_estimate_dims") if basis else None,
        "volume_rate_dims": _err_stats([(mk, (bt.get("volume_rate_dims") or {}).get("ratio")) for mk, bt in sorted(backtest.items())]),
        "in_sample": (basis_stats.get(basis) or {}).get("in_sample") if basis else None,
        "volume_rate": vr,
        "units": {b: {"months": x["months"], "mae": x["units_mae"], "median_ratio": x["units_median_ratio"]} for b, x in basis_stats.items()},
        "note": ("month_end_estimate = basis units x volumes/rates known from EARLIER reports only (what the dashboard showed when the month ended, "
                 "before v1.5's fee-preview dims); *_dims = the same with Amazon's current item volumes (what v1.5 reads from the fee preview, "
                 "simulated with the month's own item_volume); in_sample = basis units x the month's own volumes/rates (unit-count accuracy); volume_rate = Amazon's "
                 "own units x volumes/rates known before the month (volume + rate prediction accuracy, all billed months)"),
    }

    # ltsf per day: the month's surcharge spread over that month (Amazon charges it on the 15th for inventory aged at month end)
    ltsf_daily = {}
    for mk, rep in ltsf_months.items():
        if rep and not rep.get("empty") and rep.get("total"):
            for i in range(days_in_month(mk)):
                k = f"{mk}-{i+1:02d}"
                ltsf_daily[k] = round(rep["total"] / days_in_month(mk), 4)

    # 4. back-test: computed in step 3 (v1.5)

    # ---------------------------------------------------------------- output ----------------------------------------------------------------
    tot_on_hand = sum(on_hand(r) for r in inv.values())
    snapshot = {sku: r for sku, r in inv.items() if on_hand(r) or inbound(r)}
    have_months = sorted(mk for mk, r in months.items() if r and not r.get("empty"))
    out = {
        "source": "amazon-sp-api fba-inventory + reports (storage fees, aged inventory surcharge)",
        "schema": SCHEMA, "script_version": SCRIPT_VERSION,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "timezone": base.REPORT_TIMEZONE, "currency": "USD",
        "inventory": {
            "as_of": today_key, "skus": len(snapshot), "on_hand": tot_on_hand,
            "fulfillable": sum(r["fulfillable"] for r in inv.values()), "reserved": sum(r["reserved"] for r in inv.values()),
            "inbound": sum(inbound(r) for r in inv.values()), "unfulfillable": sum(r["unfulfillable"] for r in inv.values()),
            "researching": sum(r["researching"] for r in inv.values()),
            "snapshot": snapshot, "daily": inv_daily,
            "daily_fields": ["on_hand", "fulfillable", "reserved", "inbound", "unfulfillable", "researching"],
        },
        "storage": {"months": months, "daily": daily, "rates_learned": {mk: {"rates": r[0], **r[1]} for mk, r in sorted(rate_cache.items())},
                    "fallback_rates": FALLBACK_RATES,
                    "unit_volume_fallback": fallback[0], "skus_with_volume": len(vol), "months_with_report": have_months,
                    "estimate": {"basis": basis, "calibration": round(calib, 4), "inventory_scale": round(inv_scale, 4), "bases": basis_stats,
                                 "volumes": vol_stats, "accuracy": accuracy,
                                 "formula": ("sum over SKUs of daily units (ledger ending balance + in transit between warehouses) x billed unit volume "
                                             "(current item volume x billing factor) x (list rate of the size tier & season + utilization surcharge of the "
                                             "latest report) / days in month x units calibration")}},
        "dims": {"by_sku": dims, "meta": dims_meta},
        "ltsf": {"months": ltsf_months, "daily": ltsf_daily},
        "ledger": {"months": ledger_months, "daily": ledger_daily, "transit_daily": transit_daily, "columns": ledger_columns,
                   "note": "Inventory Ledger summary, DAILY ending balance per SKU (all dispositions, all US locations) - historical on-hand units; transit_daily = units in transit between warehouses (v1.4)"},
        "backtest": backtest,
        "meta": {
            "history_start": HISTORY_START, "reports_requested_this_run": requested,
            "fnsku_to_sku": fnsku_to_sku,
            "warnings": {k: sorted(v) if isinstance(v, set) else v for k, v in warnings.items()},
            "note": ("Phí lưu kho FBA theo ngày: tháng có report 'FBA Storage Fees' của Amazon (ra ~ngày 7-15 tháng sau) = tổng report chia đều theo ngày "
                     "(Amazon tính trên số unit trung bình/ngày nên chia đều là đúng); tháng chưa có report = ước tính từng ngày = Σ SKU (unit ở kho FBA kể cả "
                     "đang chuyển giữa các kho × thể tích tính phí của SKU (kích thước Amazon đo hiện tại) × (đơn giá niêm yết theo mùa và size tier "
                     "+ phụ phí sử dụng kho của report gần nhất)) / số ngày trong tháng. "
                     "Phụ phí hàng tồn lâu (aged inventory surcharge) lấy từ report riêng, chia đều trong tháng bị tính."),
        },
    }
    os.makedirs(os.path.dirname(OUTPUT_PATH) or ".", exist_ok=True)
    json.dump(out, open(OUTPUT_PATH, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    est_days = sum(1 for v in daily.values() if v["est"])
    log(f"Wrote {OUTPUT_PATH}: inventory {len(snapshot)} SKUs / {tot_on_hand} on hand; storage months with report {len(have_months)} "
        f"({have_months[0] if have_months else '-'} -> {have_months[-1] if have_months else '-'}); daily {len(daily)} days, {est_days} estimated; "
        f"ledger days {len(ledger_daily)}; back-test months {len(backtest)}; reports requested {requested}; warnings {list(warnings)}")
    for mk, bt in sorted(backtest.items()):
        parts = " | ".join(f"{b}: end {(v.get('ratio_out_of_sample') or 0)*100:.1f}% in {(v.get('ratio_in_sample') or 0)*100:.1f}% units x{v.get('units_vs_report')}"
                           for b, v in bt.get("bases", {}).items())
        log(f"backtest {mk}: report ${bt['report_total']:,.2f} | volume+rate {((bt.get('volume_rate') or {}).get('ratio') or 0)*100:.1f}% | {parts}")
    log(f"estimate basis: {basis} x units calibration {calib:.4f} (inventory scale {inv_scale:.4f}); volumes {json.dumps({k: v for k, v in vol_stats.items() if k != 'remeasured'})}; "
        f"remeasured {len(vol_stats.get('remeasured') or [])}")
    log(f"accuracy: {json.dumps({k: ({kk: vv for kk, vv in v.items() if kk != 'by_month'} if isinstance(v, dict) and 'mape' in v else v) for k, v in accuracy.items() if k != 'note'})}")


if __name__ == "__main__":
    main()
