#!/usr/bin/env python3
"""
build_shipmonk_billing.py  (toolkit v1.0, 2026-10-16, stdlib only)

Builds / refreshes the two static dashboard files
    site/public/shipmonk_invoices.json        (schema 1, source shipmonk_billing_app_invoices)
    site/public/shipmonk_storage_daily.json   (schema 1, source shipmonk-reports/40 Storage Fees Breakdown)
from the blob produced by collect_shipmonk_billing.js (run in the app.shipmonk.com tab), merged into the
previous versions of the two files.  Writes REPORT.txt next to them.

Modes
  A) refresh (normal, twice a month):
     python3 build_shipmonk_billing.py BLOB.json --inv-prev shipmonk_invoices.json \
         --storage-prev shipmonk_storage_daily.json --out-dir OUT
  B) rebuild from the legacy raw export (acceptance test; identical to the Sept-2026 builder):
     python3 build_shipmonk_billing.py --raw-invoices raw_invoices.json \
         [--current-start 2026-09-15 --current-end 2026-09-30] [--storage-rows legacy_rows.json] \
         [--storage-prev shipmonk_storage_daily.json] --out-dir OUT
  Options: --history-start 2025-01-01 (default)   --generated-at 2026-01-01T00:00:00Z (tests only)

Rules reproduced from the current files (verified byte-identical, see test_build.py)
  invoices[]  : one row per invoice with end >= HISTORY_START, sorted by start.  Categories:
                shipping = charges.shipping.total; storage = storage_fees.total; adjustments = adjustment.total;
                every line-item type -> category via CATEGORY_OF_TYPE (default fees_other), amounts summed with
                2-dp rounding at each step;  unallocated = total - (shipping+storage+receiving+returns+
                packaging_purchases+fees_other+adjustments+credits);  extras_total = sum of all but shipping.
  daily{}     : each category / days-in-period, rounded to 4 dp; total = total/days; extras = sum of the
                per-day extra categories (unrounded) then 4 dp; invoice = number.  Days before HISTORY_START
                are dropped.  A day covered twice -> warning (later invoice wins).
  monthly{}   : plain sums of daily values (float accumulation in day order), rounded to 2 dp.
  meta        : first/last day, missing days inside the range, invoice_count/total, current_period
                ({start,end,status:'in_process'} from the blob's `current`), category tables, types_seen
                (count / 2-dp running amount / category per line-item type), warnings.
  storage     : daily[iso] = {inv: sum of invoiced over warehouses, tru: sum of true over warehouses,
                wh: {warehouse: [true, invoiced]}} (2 dp), warehouses sorted; "All Warehouses" is a real row
                name that only appears in 06/2025 when the report had no per-warehouse split (never together
                with named warehouses -> it is summed like any other row).  If a day ever has BOTH, the
                "All Warehouses" row is dropped from that day (to avoid double counting) and a warning is
                written.  Merge: every day present in the new rows replaces that day entirely; days absent
                from the new rows are kept from the previous file.
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
from collections import defaultdict

TOOLKIT_VERSION = "1.0"
SCRIPT_VERSION = "1.0"      # kept as in the live files (meta.script_version) so the schema is unchanged
STORAGE_TOLERANCE = 0.15    # documented max |sum(storage days) - invoice storage| per billing period

CATEGORY_OF_TYPE = {
    "receiving_fees": "receiving", "other_receiving_fees": "receiving", "receiving_special_projects": "receiving",
    "returns_processing": "returns", "returns_special_projects": "returns", "return_postage": "returns", "postage_due_return": "returns",
    "third_party_fees": "packaging_purchases", "packaging_material": "packaging_purchases",
    "credit": "credits", "claims": "credits", "claims_fulfillment": "credits",
}
CATEGORIES = ["shipping", "storage", "receiving", "returns", "packaging_purchases", "fees_other", "adjustments", "credits", "unallocated"]
EXTRA_CATEGORIES = [c for c in CATEGORIES if c != "shipping"]

STORAGE_SOURCE = "shipmonk-reports/40 Storage Fees Breakdown (Metabase card 165), read by Claude's browser"
STORAGE_META = {
    "fields": "daily[iso] = {inv: USD invoiced for that storage day (lower of true vs capped; sums to the invoice), tru: USD at list price, wh: {warehouse: [true, invoiced]}}",
    "note": "Phí lưu kho ShipMonk theo TỪNG NGÀY, đúng số sẽ xuất hoá đơn (kiểm chứng: tổng theo kỳ = mục storage của 31 hoá đơn 06/2025-09/2026, sai lệch < $0,15). "
            "Report chỉ có từ 06/2025 (trước đó dashboard chia đều theo kỳ hoá đơn) và cập nhật tới NGÀY HÔM QUA (làm mới ~04:00 giờ kho); "
            "ngày chưa có trên report dashboard lấy theo ngày gần nhất (ước tính). Tháng 06/2025 report chỉ có dòng 'All Warehouses'.",
    "refresh": "Claude browser -> JS snippet in build_shipmonk_storage.py docstring -> python3 build_shipmonk_storage.py rows.json -> bake + build_site",
}
ALL_WH = "All Warehouses"


# ----------------------------------------------------------------------------------------------- helpers
def r2(x):
    return round(float(x or 0) + 0.0, 2)


def d(s):
    return dt.datetime.strptime(str(s)[:10], "%Y-%m-%d").date()


def iso_days(start, end):
    a, b = d(start), d(end)
    return [(a + dt.timedelta(days=i)).isoformat() for i in range((b - a).days + 1)]


def now_iso():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_blob(path):
    """The blob may be (a) the JSON object, (b) a JSON string literal containing it (browser tool file),
    (c) such a literal followed by '\\n\\n(captured at origin ...' trailer."""
    text = open(path, encoding="utf-8").read()
    cut = text.find("\n\n(captured at origin")
    if cut > 0:
        text = text[:cut]
    text = text.strip()
    obj = json.loads(text)
    if isinstance(obj, str):            # JSON string literal -> parse again
        obj = json.loads(obj)
    if not isinstance(obj, dict):
        raise SystemExit("blob: expected a JSON object with keys invoices/current/storage")
    return obj


def dump_json(obj, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)


# ----------------------------------------------------------------------------------------------- invoices
def row_from_raw(inv, warnings):
    """raw invoice (collector / legacy export shape) -> invoices[] row. Same arithmetic as the Sept-2026 builder."""
    cats = {c: 0.0 for c in CATEGORIES}
    cats["shipping"] = r2(inv["shipping"]["total"])
    cats["storage"] = r2(inv["storage"]["total"])
    cats["adjustments"] = r2(inv["adjustment"]["total"])
    by_type = {}
    for t, v in (inv["line_items"].get("by_type") or {}).items():
        cat = CATEGORY_OF_TYPE.get(t, "fees_other")
        cats[cat] = r2(cats[cat] + v["amount"])
        by_type[t] = {"amount": r2(v["amount"]), "count": v["count"], "category": cat}
    allocated = sum(cats[c] for c in CATEGORIES if c != "unallocated")
    cats["unallocated"] = r2(inv["total"] - allocated)
    start, end = d(inv["start"]), d(inv["end"])
    days = (end - start).days + 1
    if days <= 0 or days > 31:
        warnings.append(f"invoice {inv['number']}: odd billing period {inv['start']}..{inv['end']}")
    return {
        "number": str(inv["number"]), "id": inv["id"], "start": inv["start"][:10], "end": inv["end"][:10], "days": days,
        "status": inv["status"], "total": r2(inv["total"]),
        "orders_invoiced": inv["shipping"].get("count"),
        "extras_total": r2(sum(cats[c] for c in EXTRA_CATEGORIES)),
        **{c: cats[c] for c in CATEGORIES},
        "storage_by_type": [{"type": s["type"], "avg_daily_qty": s["avg_daily_qty"], "total": r2(s["total"])} for s in inv["storage"].get("by_type") or []],
        "line_items_by_type": by_type,
        "big_items": inv["line_items"].get("big") or [],
    }


def assemble_invoices(rows, current, history_start, generated_at=None):
    """rows: invoices[] rows (any order, any period). Recomputes daily/monthly/meta exactly like the live file."""
    rows = sorted([r for r in rows if r["end"] >= history_start], key=lambda r: (r["start"], r["number"]))
    warnings = []
    daily = {}
    types_seen = defaultdict(lambda: {"count": 0, "amount": 0.0, "category": ""})
    for row in rows:
        days = row["days"]
        if days <= 0 or days > 31:
            warnings.append(f"invoice {row['number']}: odd billing period {row['start']}..{row['end']}")
        for t, v in row["line_items_by_type"].items():
            ts = types_seen[t]
            ts["count"] += v["count"]
            ts["amount"] = r2(ts["amount"] + v["amount"])
            ts["category"] = v["category"]
        per_day = {c: row[c] / days for c in CATEGORIES}
        start = d(row["start"])
        for i in range(days):
            day = (start + dt.timedelta(days=i)).isoformat()
            if day < history_start:
                continue
            if day in daily:
                warnings.append(f"day {day} covered by two invoices ({daily[day]['invoice']} and {row['number']})")
            daily[day] = {**{c: round(per_day[c], 4) for c in CATEGORIES}, "total": round(row["total"] / days, 4),
                          "extras": round(sum(per_day[c] for c in EXTRA_CATEGORIES), 4), "invoice": row["number"]}
    daily = dict(sorted(daily.items()))
    monthly = defaultdict(lambda: {c: 0.0 for c in CATEGORIES + ["total", "extras"]})
    for day, v in daily.items():
        m = monthly[day[:7]]
        for c in CATEGORIES + ["total", "extras"]:
            m[c] += v[c]
    monthly = {k: {c: r2(v[c]) for c in v} for k, v in sorted(monthly.items())}
    first_day = min(daily) if daily else None
    last_day = max(daily) if daily else None
    missing = []
    if first_day:
        cur = d(first_day)
        while cur <= d(last_day):
            k = cur.isoformat()
            if k not in daily:
                missing.append(k)
            cur += dt.timedelta(days=1)
    if missing:
        warnings.append(f"{len(missing)} day(s) between {first_day} and {last_day} have no closed invoice")
    return {
        "source": "shipmonk_billing_app_invoices",
        "generated_at": generated_at or now_iso(),
        "currency": "USD",
        "invoices": rows,
        "daily": daily,
        "monthly": monthly,
        "meta": {
            "script_version": SCRIPT_VERSION, "schema": 1,
            "history_start": history_start, "first_day": first_day, "last_day": last_day, "days": len(daily),
            "missing_days": missing[:60], "missing_count": len(missing),
            "invoice_count": len(rows), "invoices_total": r2(sum(i["total"] for i in rows)),
            "current_period": current,
            "categories": CATEGORIES, "extra_categories": EXTRA_CATEGORIES, "category_of_type": CATEGORY_OF_TYPE,
            "types_seen": dict(types_seen),
            "basis": "invoice amounts prorated evenly over each semi-monthly billing period; 'shipping' = per-order postage + pick & pack as invoiced (for reconciliation only)",
            "warnings": warnings,
        },
    }


def current_from_blob(cur, prev_current, report):
    """meta.current_period = {start,end,status:'in_process'} from the collector's `current`; falls back to the
    previous file's value (or the period after the last invoice) when the endpoint failed."""
    if isinstance(cur, dict) and cur.get("start") and cur.get("end"):
        return {"start": cur["start"][:10], "end": cur["end"][:10], "status": "in_process"}
    if isinstance(cur, dict) and cur.get("error"):
        report.append(f"WARNING current period: /api/v1/billing/invoices/current failed: {cur['error']}")
    elif cur is not None:
        report.append("WARNING current period: payload had no billing period (collector assumption A1) - keys: " + ", ".join(cur.get("keys", []) if isinstance(cur, dict) else []))
    return prev_current


def period_after(last_end):
    """Semi-monthly period following last_end (1-14 / 15-end of month)."""
    e = d(last_end)
    s = e + dt.timedelta(days=1)
    if s.day == 1:
        return {"start": s.isoformat(), "end": s.replace(day=14).isoformat(), "status": "in_process"}
    nxt = (s.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1)
    return {"start": s.isoformat(), "end": nxt.isoformat(), "status": "in_process"}


# ----------------------------------------------------------------------------------------------- storage
DAY_COL_RE = re.compile(r"storage_day|^day$|^date$|_day$|_date$|^day_|^date_", re.I)
WH_COL_RE = re.compile(r"warehouse|facility|location", re.I)
ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}")


def resolve_columns(cols, rows, report):
    """Map the Metabase columns of card 165 by NAME; fall back to the positional order used in Sept 2026."""
    names = [str(c or "") for c in cols]
    up = [n.upper() for n in names]

    def by_name(target):
        return up.index(target) if target in up else None

    idx = {"true": by_name("TRUE_STORAGE_USD_SUM"), "inv": by_name("INVOICED_SUM"),
           "cap": by_name("STORAGE_CAPPING_SUM"), "strategy": by_name("WINNING_STRATEGY"), "day": None, "wh": None}
    for i, n in enumerate(names):
        if idx["day"] is None and DAY_COL_RE.search(n):
            idx["day"] = i
    for i, n in enumerate(names):
        if idx["wh"] is None and WH_COL_RE.search(n):
            idx["wh"] = i
    sample = rows[:50]
    if idx["day"] is None and sample:          # first column whose values look like ISO dates
        for i in range(len(sample[0])):
            if all(isinstance(r[i], str) and ISO_RE.match(r[i]) for r in sample):
                idx["day"] = i
                break
    if idx["wh"] is None and sample:           # first string column that is not the day / strategy column
        for i in range(len(sample[0])):
            if i in (idx["day"], idx["strategy"]):
                continue
            if all(isinstance(r[i], str) and not ISO_RE.match(r[i]) for r in sample):
                idx["wh"] = i
                break
    fallback = {"day": 0, "wh": 1, "true": 2, "cap": 3, "strategy": 4, "inv": 5}
    used_fb = []
    for k, pos in fallback.items():
        if idx[k] is None:
            idx[k] = pos
            used_fb.append(k)
    if used_fb:
        report.append(f"WARNING storage columns resolved by POSITION for {used_fb} (cols={names}) - check collector assumption A2")
    else:
        report.append(f"storage columns by name: day={names[idx['day']]} wh={names[idx['wh']]} true={names[idx['true']]} inv={names[idx['inv']]}")
    return idx


def storage_days_from_chunks(chunks, report):
    """-> {iso: {warehouse: [true, invoiced]}} for every day present in the chunks (later rows win)."""
    new = {}
    idx = None
    for ch in chunks or []:
        if ch.get("error"):
            report.append(f"WARNING storage chunk {ch.get('from')}..{ch.get('to')} failed: {ch['error']}")
            continue
        rows = ch.get("rows") or []
        if not rows:
            report.append(f"storage chunk {ch.get('from')}..{ch.get('to')}: 0 rows")
            continue
        if ch.get("truncated"):
            report.append(f"WARNING storage chunk {ch.get('from')}..{ch.get('to')} truncated at the Metabase row cap - re-pull with smaller CHUNK_DAYS")
        if idx is None or ch.get("cols"):
            idx = resolve_columns(ch.get("cols") or [], rows, report) if idx is None else idx
        for r in rows:
            try:
                day = str(r[idx["day"]])[:10]
                wh = str(r[idx["wh"]])
                tru = r2(r[idx["true"]])
                inv = r2(r[idx["inv"]])
            except (IndexError, TypeError, ValueError) as e:
                report.append(f"WARNING storage row skipped ({e}): {str(r)[:120]}")
                continue
            if not ISO_RE.match(day):
                report.append(f"WARNING storage row with non-date day skipped: {str(r)[:120]}")
                continue
            new.setdefault(day, {})[wh] = [tru, inv]
    return new


def storage_days_from_legacy_rows(rows):
    """legacy rows: [date, warehouse, true_usd, capped_or_null, invoiced_usd, strategy_or_null]"""
    new = {}
    for row in rows:
        new.setdefault(row[0][:10], {})[row[1]] = [r2(row[2]), r2(row[4])]
    return new


def assemble_storage(prev, new_days, report, generated_at=None):
    daily = {}
    if prev:
        for iso, v in prev.get("daily", {}).items():
            daily[iso] = {w: list(x) for w, x in v.get("wh", {}).items()}
    replaced, added = [], []
    for iso, wh in new_days.items():
        wh = dict(wh)
        if ALL_WH in wh and len(wh) > 1:
            report.append(f"WARNING {iso}: report has '{ALL_WH}' together with named warehouses - '{ALL_WH}' row dropped to avoid double counting")
            wh.pop(ALL_WH)
        if iso in daily:
            if daily[iso] != {w: wh[w] for w in wh}:
                replaced.append(iso)
        else:
            added.append(iso)
        daily[iso] = wh
    out_daily = {}
    for iso in sorted(daily):
        wh = daily[iso]
        out_daily[iso] = {
            "inv": round(sum(v[1] for v in wh.values()), 2),
            "tru": round(sum(v[0] for v in wh.values()), 2),
            "wh": {w: wh[w] for w in sorted(wh)},
        }
    days = sorted(out_daily)
    warehouses = sorted({w for v in daily.values() for w in v})
    doc = {
        "source": STORAGE_SOURCE,
        "schema": 1,
        "script_version": SCRIPT_VERSION,
        "generated_at": generated_at or now_iso(),
        "currency": "USD",
        "first_day": days[0] if days else None,
        "last_day": days[-1] if days else None,
        "days": len(days),
        "warehouses": warehouses,
        "daily": out_daily,
        "meta": dict(STORAGE_META),
    }
    return doc, added, replaced


# ----------------------------------------------------------------------------------------------- report
def storage_vs_invoices(inv_doc, st_doc):
    """[(number, start, end, invoice_storage, report_sum, delta)] for periods fully covered by storage days."""
    st = st_doc.get("daily", {}) if st_doc else {}
    out = []
    for i in inv_doc["invoices"]:
        days = iso_days(i["start"], i["end"])
        if days and all(x in st for x in days):
            s = round(sum(st[x]["inv"] for x in days), 2)
            out.append((i["number"], i["start"], i["end"], i["storage"], s, round(s - i["storage"], 2)))
    return out


def write_report(path, lines):
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def vn_money(x):
    return f"{x:,.0f}".replace(",", ".")


def write_huong_dan(path, inv_doc, st_doc, added_inv, replaced_inv, st_added, st_prev, bad_periods, warnings):
    """HUONG_DAN_UP.txt (Vietnamese) for the user: what to upload, what changed, what to check."""
    today = dt.date.today().strftime("%d/%m/%Y")
    m = inv_doc["meta"]
    cp = m.get("current_period") or {}
    L = [f"HƯỚNG DẪN UP — Hoá đơn & phí lưu kho ShipMonk ({today})",
         "=" * 60,
         "CẦN UP (2 file, ghi đè):  site/public/shipmonk_invoices.json  và  site/public/shipmonk_storage_daily.json",
         "",
         "CÁCH UP: GitHub -> thư mục site/public/ -> Add file -> Upload files -> kéo CẢ 2 file vào -> Commit changes.",
         "Không cần sửa pnl.js / pnl.html. Up xong mở dashboard, Cmd+Shift+R, vào trang P&L, thẻ ShipMonk.",
         "",
         "FILE NÀY CÓ GÌ (nguồn: app.shipmonk.com > Billing + Reports > Storage Fees Breakdown, đọc qua trình duyệt Claude):"]
    if added_inv:
        L.append(f"  - Thêm {len(added_inv)} hoá đơn mới:")
        for r in sorted(added_inv, key=lambda r: r["start"]):
            L.append(f"      {r['number']}  kỳ {r['start'][8:10]}/{r['start'][5:7]}–{r['end'][8:10]}/{r['end'][5:7]}/{r['end'][:4]}: tổng ${vn_money(r['total'])} "
                     f"(cước+pick&pack ${vn_money(r['shipping'])}, lưu kho ${vn_money(r['storage'])}, receiving ${vn_money(r['receiving'])}, "
                     f"hàng trả ${vn_money(r['returns'])}, bao bì ${vn_money(r['packaging_purchases'])}, phí khác ${vn_money(r['fees_other'] + r['unallocated'])}, "
                     f"điều chỉnh & credit ${vn_money(r['adjustments'] + r['credits'])})")
    else:
        L.append("  - KHÔNG có hoá đơn mới (ShipMonk chưa chốt kỳ mới) — chỉ cập nhật phí lưu kho theo ngày.")
    if replaced_inv:
        L.append(f"  - Cập nhật lại {len(replaced_inv)} hoá đơn đã có (số/trạng thái thay đổi): " + ", ".join(f"{n} ({o['total']:,.2f} -> {w['total']:,.2f})" for n, o, w in replaced_inv))
    L.append(f"  - Hoá đơn trong file: {m['invoice_count']} hoá đơn từ {m['first_day']} đến {m['last_day']}, tổng ${vn_money(m['invoices_total'])}; kỳ đang chạy: {cp.get('start', '?')} → {cp.get('end', '?')}.")
    if st_doc:
        if st_added:
            L.append(f"  - Phí lưu kho theo ngày: thêm {len(st_added)} ngày ({st_added[0]} → {st_added[-1]}); file có {st_doc['days']} ngày {st_doc['first_day']} → {st_doc['last_day']}, kho: {', '.join(st_doc['warehouses'])}.")
        else:
            L.append(f"  - Phí lưu kho theo ngày: không có ngày mới (file vẫn {st_doc['days']} ngày {st_doc['first_day']} → {st_doc['last_day']}).")
    if bad_periods:
        L.append("  - LƯU Ý: có kỳ hoá đơn mà tổng report lưu kho lệch > $0,15 so với mục storage trên hoá đơn: " + "; ".join(f"{c[0]} ({c[5]:+.2f})" for c in bad_periods))
    if m.get("missing_count"):
        L.append(f"  - LƯU Ý: {m['missing_count']} ngày trong khoảng chưa có hoá đơn chốt: {', '.join(m['missing_days'][:10])}")
    ws = [w for w in warnings if w.startswith("WARNING")]
    if ws:
        L.append("  - Cảnh báo khi build: " + " | ".join(w[8:] for w in ws[:5]))
    L += ["",
          "SAU KHI UP, KIỂM TRA:",
          f"  - Thẻ ShipMonk trên P&L: khoảng hoá đơn phải hiện tới {m['last_day']}; dòng \"Lưu kho ShipMonk — pallet & bin\" có số từng ngày tới {st_doc['last_day'] if st_doc else '(không đổi)'}.",
          "  - Chọn tháng của hoá đơn mới: \"Tổng theo hoá đơn\" phải bằng tổng các hoá đơn trong tháng (chia theo ngày trong kỳ)."]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")


# ----------------------------------------------------------------------------------------------- main
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("blob", nargs="?", help="blob from collect_shipmonk_billing.js (object, or JSON string literal file)")
    ap.add_argument("--inv-prev", help="previous shipmonk_invoices.json (merge base)")
    ap.add_argument("--storage-prev", help="previous shipmonk_storage_daily.json (merge base)")
    ap.add_argument("--raw-invoices", help="legacy raw export (list of raw invoices) - rebuild mode")
    ap.add_argument("--storage-rows", action="append", default=[], help="legacy storage rows file(s) [date, wh, true, cap, inv, strategy]")
    ap.add_argument("--current-start")
    ap.add_argument("--current-end")
    ap.add_argument("--history-start", default=os.environ.get("HISTORY_START", "2025-01-01"))
    ap.add_argument("--generated-at", help="fixed timestamp (tests)")
    ap.add_argument("--out-dir", required=True)
    a = ap.parse_args(argv)
    if not a.blob and not a.raw_invoices:
        ap.error("give BLOB_JSON or --raw-invoices")

    os.makedirs(a.out_dir, exist_ok=True)
    report = [f"build_shipmonk_billing.py toolkit v{TOOLKIT_VERSION} - {now_iso()}", ""]
    warnings = []

    blob = load_blob(a.blob) if a.blob else None
    inv_prev = load_json(a.inv_prev) if a.inv_prev else None
    st_prev = load_json(a.storage_prev) if a.storage_prev else None

    # ---- invoices
    prev_rows = {r["number"]: r for r in (inv_prev or {}).get("invoices", [])}
    new_rows = {}
    raw_list = []
    if a.raw_invoices:
        raw_list += load_json(a.raw_invoices)
    if blob:
        if blob.get("error"):
            report.append(f"WARNING collector error: {blob['error']}")
        raw_list += blob.get("invoices") or []
        for s in (blob.get("diag") or {}).get("skipped", []):
            if "SINCE" not in str(s.get("reason", "")):
                report.append(f"collector skipped invoice {s.get('number')} ({s.get('status')}): {s.get('reason')}")
        for w in (blob.get("diag") or {}).get("warnings", []):
            report.append(f"WARNING collector: {w}")
    for inv in raw_list:
        row = row_from_raw(inv, warnings)
        if row["end"] < a.history_start:
            continue
        new_rows[row["number"]] = row
    merged = dict(prev_rows)
    added_inv, replaced_inv, unchanged_inv = [], [], []
    for num, row in new_rows.items():
        if num in prev_rows:
            old = prev_rows[num]
            if old == row:
                unchanged_inv.append(num)
            else:
                replaced_inv.append((num, old, row))
        else:
            added_inv.append(row)
        merged[num] = row
    if a.current_start and a.current_end:
        current = {"start": a.current_start, "end": a.current_end, "status": "in_process"}
    elif blob is not None:
        current = current_from_blob(blob.get("current"), (inv_prev or {}).get("meta", {}).get("current_period"), report)
    else:
        current = (inv_prev or {}).get("meta", {}).get("current_period") if inv_prev else None
    rows = list(merged.values())
    if current is None and rows:
        current = period_after(max(r["end"] for r in rows))
        report.append(f"current period derived from the last invoice: {current['start']}..{current['end']}")
    elif current and rows and current["start"] <= max(r["end"] for r in rows):
        nxt = period_after(max(r["end"] for r in rows))
        report.append(f"WARNING current period {current['start']}..{current['end']} overlaps closed invoices - using {nxt['start']}..{nxt['end']} instead")
        current = nxt
    inv_doc = assemble_invoices(rows, current, a.history_start, a.generated_at)
    inv_doc["meta"]["warnings"] = inv_doc["meta"]["warnings"] + [w for w in warnings if w not in inv_doc["meta"]["warnings"]]

    # ---- storage (its processing notes go to st_report, printed under the STORAGE header)
    st_report = []
    new_days = {}
    for p in a.storage_rows:
        new_days.update(storage_days_from_legacy_rows(load_json(p)))
    if blob:
        st = blob.get("storage")
        if not st or st.get("error"):
            st_report.append(f"WARNING storage report not collected: {(st or {}).get('error', 'missing')} - storage file left as previous")
        else:
            st_report.append(f"storage report: id={st.get('report', {}).get('id')} name={st.get('report', {}).get('name')} chunks={len(st.get('chunks') or [])}")
            new_days.update(storage_days_from_chunks(st.get("chunks") or [], st_report))
    st_doc = None
    st_added, st_replaced = [], []
    if st_prev or new_days:
        st_doc, st_added, st_replaced = assemble_storage(st_prev, new_days, st_report, a.generated_at)

    # ---- write
    inv_path = os.path.join(a.out_dir, "shipmonk_invoices.json")
    dump_json(inv_doc, inv_path)
    st_path = None
    if st_doc:
        st_path = os.path.join(a.out_dir, "shipmonk_storage_daily.json")
        dump_json(st_doc, st_path)

    # ---- report
    m = inv_doc["meta"]
    report += ["== INVOICES (shipmonk_invoices.json) ==",
               f"previous file: {len(prev_rows)} invoices" + (f" up to {max(r['end'] for r in prev_rows.values())}" if prev_rows else ""),
               f"collected/raw: {len(new_rows)} invoices (end >= {a.history_start})",
               f"result: {m['invoice_count']} invoices {m['first_day']}..{m['last_day']}, {m['days']} days, {m['missing_count']} missing day(s), total {m['invoices_total']:,.2f}",
               f"current period: {current}"]
    if added_inv:
        report.append(f"NEW invoices ({len(added_inv)}):")
        for r in sorted(added_inv, key=lambda r: r["start"]):
            report.append(f"  {r['number']}  {r['start']}..{r['end']} ({r['days']}d) {r['status']:<18} total {r['total']:>12,.2f} | shipping {r['shipping']:>11,.2f} storage {r['storage']:>10,.2f} receiving {r['receiving']:>9,.2f} returns {r['returns']:>8,.2f} packaging {r['packaging_purchases']:>10,.2f} other {r['fees_other']:>9,.2f} adj {r['adjustments']:>9,.2f} credits {r['credits']:>10,.2f} unalloc {r['unallocated']:>8,.2f}")
    if replaced_inv:
        report.append(f"REPLACED invoices ({len(replaced_inv)}) - values changed since the previous file:")
        for num, old, new in replaced_inv:
            diffs = [k for k in new if k in old and old[k] != new[k]] + [k for k in new if k not in old]
            report.append(f"  {num}  {new['start']}..{new['end']} total {old['total']:,.2f} -> {new['total']:,.2f} status {old['status']} -> {new['status']} changed: {', '.join(diffs)[:200]}")
    if unchanged_inv:
        report.append(f"unchanged (re-collected, identical): {', '.join(sorted(unchanged_inv))}")
    if m["missing_days"]:
        report.append(f"WARNING missing days: {', '.join(m['missing_days'][:20])}{' ...' if m['missing_count'] > 20 else ''}")
    for w in m["warnings"]:
        report.append(f"WARNING {w}")
    report.append("")
    report.append("== STORAGE (shipmonk_storage_daily.json) ==")
    report += st_report
    if st_doc:
        report += [f"previous file: {st_prev['days'] if st_prev else 0} days" + (f" {st_prev['first_day']}..{st_prev['last_day']}" if st_prev else ""),
                   f"new rows cover {len(new_days)} day(s)" + (f" {min(new_days)}..{max(new_days)}" if new_days else ""),
                   f"result: {st_doc['days']} days {st_doc['first_day']}..{st_doc['last_day']}, warehouses {st_doc['warehouses']}",
                   f"added days: {len(st_added)}" + (f" ({st_added[0]}..{st_added[-1]})" if st_added else ""),
                   f"replaced days (values changed): {len(st_replaced)}" + (f" ({', '.join(sorted(st_replaced)[:10])}{' ...' if len(st_replaced) > 10 else ''})" if st_replaced else "")]
        chk = storage_vs_invoices(inv_doc, st_doc)
        bad = [c for c in chk if abs(c[5]) > STORAGE_TOLERANCE]
        report.append(f"check: {len(chk)} billing period(s) fully covered by storage days; {len(bad)} exceed the {STORAGE_TOLERANCE:.2f} tolerance")
        for c in chk[-6:]:
            report.append(f"  {c[0]} {c[1]}..{c[2]} invoice storage {c[3]:>10,.2f} report sum {c[4]:>10,.2f} delta {c[5]:+.2f}")
        for c in bad:
            report.append(f"WARNING {c[0]} {c[1]}..{c[2]}: invoice storage {c[3]:,.2f} vs report {c[4]:,.2f} (delta {c[5]:+.2f})")
        if st_doc["last_day"] and inv_doc["meta"]["last_day"] and st_doc["last_day"] < inv_doc["meta"]["last_day"]:
            report.append(f"WARNING storage days end {st_doc['last_day']} before the last invoice day {inv_doc['meta']['last_day']}")
    else:
        report.append("no storage data (no --storage-prev / no storage chunks) - file not written")
    bad_periods = [c for c in storage_vs_invoices(inv_doc, st_doc) if abs(c[5]) > STORAGE_TOLERANCE] if st_doc else []
    hd_path = os.path.join(a.out_dir, "HUONG_DAN_UP.txt")
    write_huong_dan(hd_path, inv_doc, st_doc, added_inv, replaced_inv, st_added, st_prev, bad_periods, report + st_report)
    report.append("")
    report.append("files: " + ", ".join(p for p in [inv_path, st_path, hd_path] if p))
    write_report(os.path.join(a.out_dir, "REPORT.txt"), report)
    print("\n".join(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
