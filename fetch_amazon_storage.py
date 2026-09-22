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
       - month without a report yet   -> for each day: sum over SKUs of on-hand units (from the daily inventory
         (current month, last month      rows, or today's snapshot) x that SKU's unit volume (from the latest
          until its report is out)        report that lists it) x the storage rate for that size tier and season
                                         (learned from the reports: Jan-Sep vs Oct-Dec) / days in month, est = true
     The dashboard shows the estimate until the report (and the FBAStorageFee posting in Finances) replaces it.

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

SCRIPT_VERSION = "1.1"
SCHEMA = 1
OUTPUT_PATH = os.environ.get("OUTPUT_PATH", "data/amazon_storage.json")
HISTORY_START = os.environ.get("HISTORY_START", "2025-01-01").strip() or "2025-01-01"
MAX_REPORTS_PER_RUN = int(os.environ.get("MAX_REPORTS_PER_RUN", "6"))
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
    created = base.sp_api_post("/reports/2021-06-30/reports", access_token, body)
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
    for r in rows:
        moc = r.get("month_of_charge") or ""
        if moc:
            charge_months.add(moc)
        fee = num(r.get("estimated_monthly_storage_fee"))
        fn = r.get("fnsku") or ""
        sku = fnsku_to_sku.get(fn) or fn or r.get("asin")
        d = by_sku.setdefault(sku, {"fee": 0.0, "avg_qty": 0.0, "volume": 0.0, "unit_volume": 0.0, "tier": None, "rate": 0.0, "asin": r.get("asin"), "fnsku": fn, "incentive": 0.0, "fcs": 0})
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
        total += fee
        n += 1
    for d in by_sku.values():
        for k in ("fee", "avg_qty", "volume", "unit_volume", "rate", "incentive"):
            d[k] = round(d[k], 4)
    rate_med = {t: round(statistics.median(v), 4) for t, v in rates.items()}
    return {"total": round(total, 2), "rows": n, "skus": len(by_sku), "by_sku": by_sku, "rates": rate_med,
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


# ---------------------------------------------------------------- estimate ----------------------------------------------------------------
def learned_rates(months):
    """{season: {tier: rate}} from the most recent report of each season; None where nothing is known yet."""
    out = {"jan_sep": {}, "oct_dec": {}}
    for mk in sorted(months):
        rep = months[mk]
        if not rep or rep.get("empty"):
            continue
        for tier, rate in (rep.get("rates") or {}).items():
            out[season(mk)][tier] = rate     # later months overwrite -> most recent wins
    return out


def sku_volumes(months):
    """sku -> (unit_volume, tier_class) from the latest report that lists the sku; plus an account-wide fallback."""
    vol, seen = {}, []
    for mk in sorted(months):
        rep = months[mk]
        if not rep or rep.get("empty"):
            continue
        for sku, d in (rep.get("by_sku") or {}).items():
            if d.get("unit_volume"):
                vol[sku] = (d["unit_volume"], tier_class(d.get("tier")))
                seen.append(d["unit_volume"])
    fallback = round(statistics.median(seen), 4) if seen else 0.0
    return vol, fallback


def estimate_day(inv_row, vol, fallback_vol, rates, mk, warnings):
    """USD storage accrual for one day from the per-SKU on-hand row {sku: [on_hand, ...]}."""
    dim = days_in_month(mk)
    s = season(mk)
    fee, units, cuft, unknown = 0.0, 0, 0.0, 0
    for sku, arr in inv_row.items():
        oh = arr[0] if isinstance(arr, list) else on_hand(arr)
        if oh <= 0:
            continue
        uv, tier = vol.get(sku, (fallback_vol, "standard"))
        if sku not in vol:
            unknown += oh
        rate = rates.get(s, {}).get(tier) or FALLBACK_RATES[tier][s]
        if not rates.get(s, {}).get(tier):
            warnings.setdefault("fallback_rate_used", set()).add(f"{s}/{tier}")
        fee += oh * uv * rate / dim
        units += oh
        cuft += oh * uv
    return round(fee, 4), units, round(cuft, 2), unknown


def ingest_ledger_report(text, fnsku_to_sku):
    """Inventory Ledger summary (daily): {iso: {sku: ending balance units (all dispositions, all locations)}}."""
    rows = parse_tsv(text)
    out = {}
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
        n += 1
    return out, n


def backtest_month(mk, months, ledger_daily, posted):
    """Estimate month mk the way the live estimate would have (volumes + rates from EARLIER reports only, units from
    the ledger) and compare with Amazon's own report total and the fee Amazon actually charged."""
    earlier = {m: v for m, v in months.items() if m < mk and v and not v.get("empty")}
    same = {mk: months[mk]}
    rates_oos = learned_rates(earlier)
    vol_oos, fb_oos = sku_volumes(earlier)
    rates_in = learned_rates(same)
    vol_in, fb_in = sku_volumes(same)
    dim = days_in_month(mk)
    days = [f"{mk}-{i+1:02d}" for i in range(dim)]
    have = [k for k in days if k in ledger_daily]
    if not have:
        return {"skipped": "no ledger days"}
    w = {}
    est_oos = est_in = 0.0
    units_days = 0
    unknown = 0
    for k in have:
        row = {sku: [q] for sku, q in ledger_daily[k].items()}
        f1, u, _, unk = estimate_day(row, vol_oos, fb_oos, rates_oos, mk, w)
        f2, _, _, _ = estimate_day(row, vol_in, fb_in, rates_in, mk, {})
        est_oos += f1; est_in += f2; units_days += u; unknown += unk
    # scale to the whole month when the ledger misses a few days
    scale = dim / len(have)
    est_oos = round(est_oos * scale, 2); est_in = round(est_in * scale, 2)
    rep_total = months[mk]["total"]
    rep_units = round(sum(d.get("avg_qty", 0) for d in months[mk]["by_sku"].values()), 1)
    return {
        "report_total": rep_total, "posted": posted,
        "est_out_of_sample": est_oos, "est_in_sample": est_in,
        "ratio_out_of_sample": round(est_oos / rep_total, 4) if rep_total else None,
        "ratio_in_sample": round(est_in / rep_total, 4) if rep_total else None,
        "ratio_report_vs_posted": round(rep_total / abs(posted), 4) if posted else None,
        "ledger_days": len(have), "avg_units_ledger": round(units_days / len(have), 1), "avg_units_report": rep_units,
        "units_without_volume_share": round(unknown / units_days, 4) if units_days else None,
        "fallback_rate_used": sorted(w.get("fallback_rate_used", [])),
        "basis": "out_of_sample = volumes/rates only from reports of EARLIER months (what the live estimate knows); in_sample = this month's own volumes/rates (isolates the unit-count effect)",
    }


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

        def due(entry):
            if not entry:
                return True
            if entry.get("empty"):
                if entry.get("tries", 1) >= MAX_TRIES_PER_MONTH:
                    return False          # Amazon does not publish that month (too old / no charge): stop asking
                return nowts - entry.get("tried_ts", 0) > RETRY_MONTH_HOURS * 3600
            return False

        def empty_entry(store, mk, reason):
            tries = (store.get(mk) or {}).get("tries", 0) + 1
            return {"empty": True, "tried_ts": nowts, "tries": tries, "reason": reason}

        for mk in reversed(wanted):          # newest months first: the P&L needs them most
            if requested >= MAX_REPORTS_PER_RUN:
                break
            if due(months.get(mk)):
                start = datetime(int(mk[:4]), int(mk[5:7]), 1, tzinfo=timezone.utc)
                end = start + timedelta(days=days_in_month(mk)) - timedelta(seconds=1)
                txt = request_report(access_token, STORAGE_REPORT, start, end, f"storage {mk}")
                requested += 1
                if txt:
                    rep = ingest_storage_report(txt, mk, fnsku_to_sku)
                    if rep["rows"] and rep["months_in_report"] and mk not in rep["months_in_report"]:
                        # Amazon answered with another month's data (report not published yet for mk): keep it under ITS month
                        real = rep["months_in_report"][-1]
                        log(f"storage {mk}: report holds month_of_charge {rep['months_in_report']} -> stored as {real}, {mk} marked empty")
                        if not months.get(real) or months[real].get("empty"):
                            months[real] = rep
                        months[mk] = empty_entry(months, mk, f"report returned {real}")
                    elif rep["rows"]:
                        months[mk] = rep
                        log(f"storage {mk}: {rep['skus']} SKUs, {rep['rows']} rows, total ${rep['total']:,.2f}, rates {rep['rates']}")
                    else:
                        months[mk] = empty_entry(months, mk, "no rows")
                else:
                    months[mk] = empty_entry(months, mk, "cancelled" if txt == "" else "fatal/timeout")
            if requested >= MAX_REPORTS_PER_RUN:
                break
            if due(ltsf_months.get(mk)):
                start = datetime(int(mk[:4]), int(mk[5:7]), 1, tzinfo=timezone.utc)
                end = start + timedelta(days=days_in_month(mk)) - timedelta(seconds=1)
                txt = request_report(access_token, LTSF_REPORT, start, end, f"ltsf {mk}")
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
        ledger_wanted = [m for m in wanted if m >= month_key(today.replace(day=1) - timedelta(days=31 * LEDGER_MONTHS - 31))] + [cur_mk]
        for mk in reversed(ledger_wanted):
            if requested >= MAX_REPORTS_PER_RUN:
                break
            ent = ledger_months.get(mk)
            # the current month is refreshed while it grows (days before the hourly snapshots began); past months once
            cur_due = mk == cur_mk and ent and not ent.get("empty") and ent.get("days", 0) < today.day - 1
            if not (due(ent) or cur_due):
                continue
            start = datetime(int(mk[:4]), int(mk[5:7]), 1, tzinfo=timezone.utc)
            end = start + timedelta(days=days_in_month(mk)) - timedelta(seconds=1)
            body_opts = {"aggregateByLocation": "COUNTRY", "aggregatedByTimePeriod": "DAILY"}
            txt = request_report(access_token, LEDGER_REPORT, start, end, f"ledger {mk}", body_opts)
            requested += 1
            if txt:
                got, n = ingest_ledger_report(txt, fnsku_to_sku)
                got = {k: v for k, v in got.items() if k[:7] == mk}
                if got:
                    ledger_daily.update(got)
                    ledger_months[mk] = {"days": len(got), "rows": n, "skus": len({s for v in got.values() for s in v}),
                                         "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
                    log(f"ledger {mk}: {len(got)} days, {n} rows, {ledger_months[mk]['skus']} SKUs")
                else:
                    ledger_months[mk] = empty_entry(ledger_months, mk, "no rows")
            else:
                ledger_months[mk] = empty_entry(ledger_months, mk, "cancelled" if txt == "" else "fatal/timeout")

    # 3. daily storage cost -------------------------------------------------------------------------
    rates = learned_rates(months)
    vol, fallback_vol = sku_volumes(months)
    daily = {}
    d = datetime.strptime(HISTORY_START, "%Y-%m-%d").date()
    end_d = today.date()
    latest_inv_key = None
    while d <= end_d:
        k = d.isoformat()
        mk = k[:7]
        rep = months.get(mk)
        if rep and not rep.get("empty"):
            daily[k] = {"fee": round(rep["total"] / days_in_month(mk), 4), "est": False, "src": "report"}
        else:
            row = inv_daily.get(k)
            src = "inventory"
            if row is None and k in ledger_daily:
                row = {sku: [q] for sku, q in ledger_daily[k].items()}; src = "ledger"
            if row is None:
                # no snapshot for that day: use the nearest earlier snapshot (or today's) - flagged
                keys = [x for x in inv_daily if x <= k]
                if keys:
                    row = inv_daily[max(keys)]; src = "inventory:" + max(keys)
                elif inv_daily:
                    row = inv_daily[min(inv_daily)]; src = "inventory:" + min(inv_daily)
            if row is None or not (vol or fallback_vol):
                daily[k] = {"fee": 0.0, "est": True, "src": "none"}
            else:
                fee, units, cuft, unknown = estimate_day(row, vol, fallback_vol, rates, mk, warnings)
                daily[k] = {"fee": fee, "est": True, "src": src, "units": units, "cuft": cuft, "unknown_units": unknown}
        d += timedelta(days=1)

    # ltsf per day: the month's surcharge spread over that month (Amazon charges it on the 15th for inventory aged at month end)
    ltsf_daily = {}
    for mk, rep in ltsf_months.items():
        if rep and not rep.get("empty") and rep.get("total"):
            for i in range(days_in_month(mk)):
                k = f"{mk}-{i+1:02d}"
                ltsf_daily[k] = round(rep["total"] / days_in_month(mk), 4)

    # 4. back-test: months with a report AND ledger days -> how close the live estimate would have been
    posted_by_month = {}
    if os.path.exists(PNL_PATH):
        try:
            posted_by_month = (json.load(open(PNL_PATH, encoding="utf-8")).get("monthly_storage_fees") or {})
        except Exception as e:  # noqa: BLE001
            warnings["pnl_unreadable"] = str(e)
    backtest = {}
    for mk in sorted(m for m, v in months.items() if v and not v.get("empty")):
        bt = backtest_month(mk, months, ledger_daily, posted_by_month.get(mk))
        if "skipped" not in bt:
            backtest[mk] = bt

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
        "storage": {"months": months, "daily": daily, "rates_learned": rates, "fallback_rates": FALLBACK_RATES,
                    "unit_volume_fallback": fallback_vol, "skus_with_volume": len(vol), "months_with_report": have_months},
        "ltsf": {"months": ltsf_months, "daily": ltsf_daily},
        "ledger": {"months": ledger_months, "daily": ledger_daily, "note": "Inventory Ledger summary, DAILY ending balance per SKU (all dispositions, all US locations) - historical on-hand units"},
        "backtest": backtest,
        "meta": {
            "history_start": HISTORY_START, "reports_requested_this_run": requested,
            "fnsku_to_sku": fnsku_to_sku,
            "warnings": {k: sorted(v) if isinstance(v, set) else v for k, v in warnings.items()},
            "note": ("Phí lưu kho FBA theo ngày: tháng có report 'FBA Storage Fees' của Amazon (ra ~ngày 7-15 tháng sau) = tổng report chia đều theo ngày "
                     "(Amazon tính trên số unit trung bình/ngày nên chia đều là đúng); tháng chưa có report = ước tính từng ngày = Σ SKU (unit đang ở kho FBA "
                     "× thể tích đơn vị theo report gần nhất × đơn giá theo mùa và size tier học từ report) / số ngày trong tháng. "
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
        log(f"backtest {mk}: report ${bt['report_total']:,.2f} | est out-of-sample ${bt['est_out_of_sample']:,.2f} ({(bt['ratio_out_of_sample'] or 0)*100:.1f}%) | "
            f"in-sample ${bt['est_in_sample']:,.2f} ({(bt['ratio_in_sample'] or 0)*100:.1f}%) | posted {bt['posted']} | units ledger {bt['avg_units_ledger']} vs report {bt['avg_units_report']}")


if __name__ == "__main__":
    main()
