#!/usr/bin/env python3
"""fetch_amazon_settlements.py v1.0 - Amazon settlement periods -> data/amazon_settlements.json

One row per Amazon "financial event group" (= one settlement period, the unit Amazon pays out):
  id, start, end, status (Open/Closed), transfer_status, transfer_date, original_total,
  beginning_balance, totals{...} = the period's financial events classified with the SAME rules as
  fetch_amazon_pnl.py (gross_sales, refunds, referral_fees, fba_fulfillment_fees, service_fees, ...),
  net_classified, diff (= original_total - beginning_balance - net_classified; 0.00 = the period is
  fully explained), by_month{YYYY-MM:{...}} (the same events by the month they posted),
  event_lists{name: count} and unhandled[] for diagnostics.
No order ids, no bank account digits, no transfer trace ids are written (public repo).

Reuses fetch_amazon_pnl.py for the token, the rate limiter and the event classification.
Secrets (names only): AMAZON_SP_API_CLIENT_ID, AMAZON_SP_API_CLIENT_SECRET, AMAZON_SP_API_REFRESH_TOKEN.
Optional env: BACKFILL_START (YYYY-MM-DD), SETTLEMENTS_HISTORY_START, SETTLEMENTS_ROLLING_DAYS.
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import fetch_amazon_pnl as ap

SCRIPT_VERSION = "1.0"
OUT = os.environ.get("SETTLEMENTS_OUT", "data/amazon_settlements.json")
HISTORY_START = os.environ.get("SETTLEMENTS_HISTORY_START", "2026-04-15").strip()
ROLLING_DAYS = int(os.environ.get("SETTLEMENTS_ROLLING_DAYS", "45") or 45)
BACKFILL_START = os.environ.get("BACKFILL_START", "").strip()
# fba_storage_posted is a memo of the storage part of service_fees, so it is not added again
NET_FIELDS = ["gross_sales", "shipping_credits", "giftwrap_credits", "promotions", "refunds",
              "refund_fee_adjustments", "referral_fees", "other_fees", "service_fees",
              "fba_fulfillment_fees", "adjustments", "ad_spend", "inbound_freight", "unclassified_other"]
SKIP_FIELDS = {"net_sales", "orders", "units"}
HANDLERS = {
    "ShipmentEventList": ap.process_shipment_event,
    "RefundEventList": ap.process_refund_event,
    "ChargebackEventList": ap.process_refund_event,
    "GuaranteeClaimEventList": ap.process_refund_event,
    "ServiceFeeEventList": ap.process_service_fee_event,
    "ProductAdsPaymentEventList": ap.process_product_ads_event,
    "AdjustmentEventList": ap.process_adjustment_event,
    "RemovalShipmentEventList": ap.process_removal_shipment_event,
    "RemovalShipmentAdjustmentEventList": ap.process_removal_shipment_adjustment_event,
    "SAFETReimbursementEventList": ap.process_safet_reimbursement_event,
}


def log(msg):
    print(msg, flush=True)


def money(obj):
    try:
        return round(float((obj or {}).get("CurrencyAmount") or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def local_day(iso_str):
    if not iso_str:
        return None
    try:
        return ap.day_key(iso_str)
    except Exception:
        return str(iso_str)[:10]


def list_groups(token, started_after_iso):
    groups, next_token = [], None
    while True:
        params = {"NextToken": next_token} if next_token else {
            "FinancialEventGroupStartedAfter": started_after_iso, "MaxResultsPerPage": 100}
        payload = (ap.sp_api_get("/finances/v0/financialEventGroups", token, params) or {}).get("payload", {}) or {}
        groups.extend(payload.get("FinancialEventGroupList") or [])
        next_token = payload.get("NextToken")
        if not next_token:
            return groups


def numeric_totals(daily):
    tot, by_month = {}, {}
    for day, bucket in daily.items():
        month = str(day)[:7]
        for field, value in bucket.items():
            if field in SKIP_FIELDS or isinstance(value, bool) or not isinstance(value, (int, float)):
                continue
            if field.startswith("ordered_") or field.endswith("_pending"):
                continue
            tot[field] = tot.get(field, 0.0) + value
            m = by_month.setdefault(month, {})
            m[field] = m.get(field, 0.0) + value
    rnd = lambda d: {k: round(v, 2) for k, v in sorted(d.items()) if abs(v) >= 0.005}
    return rnd(tot), {m: rnd(v) for m, v in sorted(by_month.items())}


def fetch_group_events(token, gid, fallback_day):
    """All financial events of one settlement period, classified by the P&L script's handlers."""
    daily, warnings, lists, unhandled = {}, set(), {}, {}
    ap._current_day = fallback_day          # events without a PostedDate (storage, subscription) land here
    path = f"/finances/v0/financialEventGroups/{gid}/financialEvents"
    next_token, pages, events = None, 0, 0
    while True:
        params = {"NextToken": next_token} if next_token else {"MaxResultsPerPage": 100}
        payload = (ap.sp_api_get(path, token, params) or {}).get("payload", {}) or {}
        fe = payload.get("FinancialEvents", {}) or {}
        pages += 1
        for key, val in fe.items():
            if not isinstance(val, list) or not val:
                continue
            lists[key] = lists.get(key, 0) + len(val)
            fn = HANDLERS.get(key)
            if fn is None:
                unhandled[key] = unhandled.get(key, 0) + len(val)
                continue
            for ev in val:
                fn(ev, daily, warnings)
                events += 1
        next_token = payload.get("NextToken")
        if not next_token:
            break
    ap._current_day = None
    totals, by_month = numeric_totals(daily)
    return {"totals": totals, "by_month": by_month, "event_lists": dict(sorted(lists.items())),
            "unhandled": dict(sorted(unhandled.items())), "pages": pages, "events": events,
            "warnings": sorted(warnings)[:20]}


def main():
    cid = os.environ.get("AMAZON_SP_API_CLIENT_ID")
    sec = os.environ.get("AMAZON_SP_API_CLIENT_SECRET")
    ref = os.environ.get("AMAZON_SP_API_REFRESH_TOKEN")
    if not (cid and sec and ref):
        log("Missing AMAZON_SP_API_CLIENT_ID / AMAZON_SP_API_CLIENT_SECRET / AMAZON_SP_API_REFRESH_TOKEN")
        sys.exit(1)
    old = {}
    if os.path.exists(OUT):
        try:
            with open(OUT, encoding="utf-8") as fh:
                old = json.load(fh)
        except Exception as e:
            log(f"Could not read existing {OUT}: {e} - starting fresh")
    today = datetime.now(timezone.utc).date()
    if BACKFILL_START:
        start, mode = BACKFILL_START, "backfill"
    elif not old.get("settlements"):
        start, mode = HISTORY_START, "first_run"
    else:
        start, mode = (today - timedelta(days=ROLLING_DAYS)).strftime("%Y-%m-%d"), "rolling"
    datetime.strptime(start, "%Y-%m-%d")
    token = ap.get_access_token(cid, sec, ref)
    log(f"mode {mode}: settlement periods started on/after {start}")
    raw = list_groups(token, f"{start}T00:00:00Z")
    log(f"settlement periods listed: {len(raw)}")

    stored = {g["id"]: g for g in (old.get("settlements") or []) if isinstance(g, dict) and g.get("id")}
    fetched, requests_events = 0, 0
    for g in raw:
        gid = g.get("FinancialEventGroupId")
        if not gid:
            continue
        row = {
            "id": gid,
            "start": g.get("FinancialEventGroupStart"), "end": g.get("FinancialEventGroupEnd"),
            "start_day": local_day(g.get("FinancialEventGroupStart")), "end_day": local_day(g.get("FinancialEventGroupEnd")),
            "status": g.get("ProcessingStatus"), "transfer_status": g.get("FundTransferStatus"),
            "transfer_date": g.get("FundTransferDate"), "transfer_day": local_day(g.get("FundTransferDate")),
            "original_total": money(g.get("OriginalTotal")),
            "currency": (g.get("OriginalTotal") or {}).get("CurrencyCode"),
            "converted_total": money(g.get("ConvertedTotal")) if g.get("ConvertedTotal") else None,
            "beginning_balance": money(g.get("BeginningBalance")),
        }
        prev = stored.get(gid) or {}
        closed = (row["status"] or "").lower() == "closed"
        if prev.get("events_done") and closed and mode != "backfill":
            for k in ("totals", "by_month", "event_lists", "unhandled", "pages", "events", "warnings",
                      "net_classified", "diff", "events_done"):
                if k in prev:
                    row[k] = prev[k]
        else:
            try:
                ev = fetch_group_events(token, gid, row["end_day"] or row["start_day"] or today.strftime("%Y-%m-%d"))
            except SystemExit:
                raise
            except Exception as e:           # keep the period row even when its events could not be read
                log(f"  {gid[:10]}...: events not read ({type(e).__name__}: {e})")
                ev = None
            if ev is not None:
                row.update(ev)
                row["net_classified"] = round(sum(ev["totals"].get(f, 0.0) for f in NET_FIELDS), 2)
                row["diff"] = round(row["original_total"] - row["beginning_balance"] - row["net_classified"], 2)
                row["events_done"] = closed    # an Open period keeps changing, so it is read again next run
                fetched += 1
                requests_events += ev["pages"]
                log(f"  {row['start_day']}..{row['end_day'] or 'open'} {row['status']}: total {row['original_total']:.2f}, "
                    f"classified {row['net_classified']:.2f}, diff {row['diff']:.2f}, {ev['events']} events")
        stored[gid] = row
    rows = sorted(stored.values(), key=lambda r: (r.get("start") or "", r.get("id") or ""), reverse=True)
    out = {
        "schema": 1, "script_version": SCRIPT_VERSION, "source": "amazon_sp_api_financial_event_groups",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "timezone": ap.REPORT_TIMEZONE,
        "meta": {"mode": mode, "start": start, "periods_listed": len(raw), "periods_events_fetched": fetched,
                 "event_pages": requests_events, "periods_total": len(rows), "net_fields": NET_FIELDS,
                 "note": "diff = original_total - beginning_balance - net_classified (0.00 = fully explained by the classified events)"},
        "settlements": rows,
    }
    os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    log(f"wrote {OUT}: {len(rows)} settlement periods, events read for {fetched}")


if __name__ == "__main__":
    main()
