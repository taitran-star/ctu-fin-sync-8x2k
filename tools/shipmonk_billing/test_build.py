#!/usr/bin/env python3
"""
test_build.py - acceptance + merge tests for the ShipMonk billing toolkit (stdlib only; node optional).

  python3 test_build.py [--fixtures DIR] [--raw raw_invoices.json] [--current-inv PATH] [--current-storage PATH]

Tests
  1. REPRODUCTION  build_shipmonk_billing.py --raw-invoices (legacy export) [+ legacy storage rows]
                   must reproduce the live site files byte-for-byte (generated_at excepted).
  2. MERGE         synthetic blob (2 new invoices, 1 re-sent invoice, 10 new storage days, re-pulled days,
                   an "All Warehouses" collision) merged into the live files; invariants:
                   period sums = invoice totals, monthly = sum of daily, storage day sums = invoice storage for
                   fully covered periods, no day lost, current_period from the blob, column mapping by name /
                   by position, blob given as a JSON string literal with the browser-tool trailer.
  3. COLLECTOR E2E (needs `node`) collect_shipmonk_billing.js run against a mock of the documented endpoints
                   built from the legacy export + legacy storage rows; the blob must rebuild both live files
                   byte-for-byte, and the token must not appear anywhere in the output.
"""
import argparse
import copy
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
BUILDER = os.path.join(HERE, "build_shipmonk_billing.py")
COLLECTOR = os.path.join(HERE, "collect_shipmonk_billing.js")
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True
import build_shipmonk_billing as B  # noqa: E402

FAILS = []
PASSES = []


def check(cond, msg):
    (PASSES if cond else FAILS).append(msg)
    print(("  ok   " if cond else "  FAIL ") + msg)


def canon(doc):
    doc = copy.deepcopy(doc)
    doc["generated_at"] = "X"
    return json.dumps(doc, separators=(",", ":"), ensure_ascii=False)


def canon_order_insensitive(doc):
    """Like canon() but ignores the order of line-item types / big items, which follows the API's item order."""
    doc = copy.deepcopy(doc)
    doc["generated_at"] = "X"
    for i in doc.get("invoices", []):
        i["line_items_by_type"] = dict(sorted(i["line_items_by_type"].items()))
        i["big_items"] = sorted(i["big_items"], key=lambda b: json.dumps(b, sort_keys=True))
    if "types_seen" in doc.get("meta", {}):
        doc["meta"]["types_seen"] = dict(sorted(doc["meta"]["types_seen"].items()))
    return json.dumps(doc, separators=(",", ":"), ensure_ascii=False)


def run_builder(args):
    p = subprocess.run([sys.executable, BUILDER] + args, capture_output=True, text=True)
    if p.returncode != 0:
        print(p.stdout[-2000:], p.stderr[-2000:])
    return p


def iso_days(a, b):
    return B.iso_days(a, b)


# ------------------------------------------------------------------------------------------- 1. reproduction
def test_reproduction(raw, cur_inv, cur_st, st_rows, tmp):
    print("[1] reproduction from the legacy raw export")
    out = os.path.join(tmp, "repro")
    live = json.load(open(cur_inv))
    cp = live["meta"]["current_period"]
    args = ["--raw-invoices", raw, "--current-start", cp["start"], "--current-end", cp["end"], "--out-dir", out]
    if st_rows:
        args += ["--storage-rows", st_rows]
    p = run_builder(args)
    check(p.returncode == 0, "builder exits 0")
    got = json.load(open(os.path.join(out, "shipmonk_invoices.json")))
    check(canon(got) == canon(live), "shipmonk_invoices.json byte-identical to the live file (generated_at excepted)")
    for k in ("invoices", "daily", "monthly", "meta"):
        same = json.dumps(got[k], separators=(",", ":"), ensure_ascii=False) == json.dumps(live[k], separators=(",", ":"), ensure_ascii=False)
        check(same, f"  section '{k}' identical")
    raw_bytes = open(cur_inv, "rb").read()
    check(raw_bytes == json.dumps(live, separators=(",", ":"), ensure_ascii=False).encode("utf-8"), "live invoices file uses the same serialization (compact, ensure_ascii=False)")
    if st_rows:
        got_s = json.load(open(os.path.join(out, "shipmonk_storage_daily.json")))
        live_s = json.load(open(cur_st))
        check(canon(got_s) == canon(live_s), "shipmonk_storage_daily.json byte-identical to the live file (generated_at excepted)")
    else:
        print("  skip storage reproduction (no legacy rows fixture)")
    check(os.path.exists(os.path.join(out, "REPORT.txt")), "REPORT.txt written")


# ------------------------------------------------------------------------------------------- 2. merge
def make_raw_invoice(number, iid, start, end, status, shipping, storage, adjustment, by_type, big):
    li_total = round(sum(v["amount"] for v in by_type.values()), 2)
    total = round(shipping["total"] + storage["total"] + adjustment["total"] + li_total + 12.34, 2)  # +12.34 unallocated
    return {"id": iid, "number": number, "start": start, "end": end, "status": status, "total": total,
            "shipping": shipping, "storage": storage, "adjustment": adjustment,
            "line_items": {"total": li_total, "count": sum(v["count"] for v in by_type.values()), "by_type": by_type, "big": big}}


def synthetic_blob(cur_inv, cur_st, cols_mode="named"):
    live_inv = json.load(open(cur_inv))
    live_st = json.load(open(cur_st))
    last_inv_end = live_inv["meta"]["last_day"]            # 2026-09-14 in the Oct-2026 file
    last_st = live_st["last_day"]                          # 2026-09-21
    # storage rows: re-pull the last 7 days of the file (identical values) + 10 new days
    rows = []
    cols_named = ["STORAGE_DAY", "WAREHOUSE_NAME", "TRUE_STORAGE_USD_SUM", "STORAGE_CAPPING_SUM", "WINNING_STRATEGY", "INVOICED_SUM", "STORAGE_CAP_IMPACT"]
    repull_days = iso_days((B.d(last_st) - dt.timedelta(days=6)).isoformat(), last_st)
    for iso in repull_days:
        for wh, (tru, inv) in live_st["daily"][iso]["wh"].items():
            rows.append([iso + "T00:00:00Z", wh, tru, None, None, inv, 0])
    new_days = iso_days((B.d(last_st) + dt.timedelta(days=1)).isoformat(), (B.d(last_st) + dt.timedelta(days=10)).isoformat())
    for k, iso in enumerate(new_days):
        rows.append([iso + "T00:00:00Z", "Nevada 3", 150.0 + k, 170.0, "True storage", 150.0 + k, 0])
        rows.append([iso + "T00:00:00Z", "Pennsylvania 2", 220.55, 210.0, "Capped storage", 210.0, -10.55])
    # an "All Warehouses" collision on the last new day -> must be dropped from that day's totals
    rows.append([new_days[-1] + "T00:00:00Z", "All Warehouses", 999.0, None, None, 999.0, 0])
    if cols_mode == "named":
        cols = cols_named
    elif cols_mode == "shuffled":
        order = [5, 1, 0, 4, 2, 3, 6]
        cols = [cols_named[i] for i in order]
        rows = [[r[i] for i in order] for r in rows]
    elif cols_mode == "positional":
        cols = ["c0", "c1", "c2", "c3", "c4", "c5", "c6"]
    else:
        raise ValueError(cols_mode)
    # two new invoices: the period after the last invoice (16 days 15..30) then 1..14 of the next month
    p1 = B.period_after(last_inv_end)
    p2 = B.period_after(p1["end"])
    p3 = B.period_after(p2["end"])
    # invoice 1 storage = sum of report days over its period (file days + new days) so the check is exact
    day_inv = {iso: live_st["daily"][iso]["inv"] for iso in live_st["daily"]}
    for k, iso in enumerate(new_days):
        day_inv[iso] = round(150.0 + k + 210.0, 2)
    st1 = round(sum(day_inv[x] for x in iso_days(p1["start"], p1["end"])), 2)
    inv1 = make_raw_invoice("TEST0001", 900001, p1["start"], p1["end"], "status_submitted",
                            {"total": 50000.5, "count": 2500}, {"total": st1, "by_type": [{"type": "Pallet", "avg_daily_qty": 800, "total": st1}]},
                            {"total": -120.25, "count": 300},
                            {"receiving_fees": {"amount": 650.0, "count": 2}, "returns_processing": {"amount": 40.5, "count": 10},
                             "third_party_fees": {"amount": 7000.0, "count": 1}, "credit": {"amount": -1500.0, "count": 1},
                             "late_fee": {"amount": 300.0, "count": 1}, "weird_new_type": {"amount": 9.99, "count": 1}},
                            [{"type": "receiving_fees", "amount": 600.0, "qty": 120, "date": p1["start"], "desc": "Carton Receiving Fee - TEST"},
                             {"type": "third_party_fees", "amount": 7000.0, "qty": 2000, "date": p1["end"], "desc": "Custom Packaging TEST"},
                             {"type": "credit", "amount": -1500.0, "qty": 1, "date": p1["end"], "desc": "credit TEST"}])
    inv2 = make_raw_invoice("TEST0002", 900002, p2["start"], p2["end"], "status_complete",
                            {"total": 61000.0, "count": 3100}, {"total": 5800.0, "by_type": [{"type": "Pallet", "avg_daily_qty": 790, "total": 5800.0}]},
                            {"total": 33.33, "count": 100},
                            {"returns_processing": {"amount": 55.0, "count": 20}, "monthly_minimum_fee": {"amount": 0.0, "count": 1}}, [])
    # re-send the last live invoice with a changed status (replace-by-number)
    last_row = live_inv["invoices"][-1]
    resend = {"id": last_row["id"], "number": last_row["number"], "start": last_row["start"], "end": last_row["end"], "status": "status_complete",
              "total": last_row["total"], "shipping": {"total": last_row["shipping"], "count": last_row["orders_invoiced"]},
              "storage": {"total": last_row["storage"], "by_type": last_row["storage_by_type"]},
              "adjustment": {"total": last_row["adjustments"], "count": 0},
              "line_items": {"total": round(sum(v["amount"] for v in last_row["line_items_by_type"].values()), 2),
                             "count": sum(v["count"] for v in last_row["line_items_by_type"].values()),
                             "by_type": {t: {"amount": v["amount"], "count": v["count"]} for t, v in last_row["line_items_by_type"].items()},
                             "big": last_row["big_items"]}}
    blob = {"toolkit": "test", "collected_at": "2026-10-16T00:00:00Z", "since": p1["start"], "storage_since": repull_days[0], "today": new_days[-1],
            "invoices": [resend, inv1, inv2],
            "current": {"id": 900003, "number": None, "start": p3["start"], "end": p3["end"], "status": "status_in_process", "total": 0, "keys": ["id"]},
            "storage": {"report": {"id": 40, "name": "Storage Fees Breakdown"}, "dashcard": 251, "card": 165, "param": "storage_day", "chunk_days": 60,
                        "chunks": [{"from": repull_days[0], "to": new_days[-1], "cols": cols, "rows": rows, "row_count": len(rows), "truncated": False}]},
            "diag": {"skipped": [{"id": 1, "number": "OLD", "status": "status_complete", "reason": "end 2024-01-14 < SINCE"}], "warnings": []}}
    return blob, {"p1": p1, "p2": p2, "p3": p3, "new_days": new_days, "repull_days": repull_days, "st1": st1, "inv1": inv1, "inv2": inv2, "resend_number": last_row["number"]}


def assert_invoice_invariants(doc, label):
    inv = doc["invoices"]
    nums = [i["number"] for i in inv]
    check(len(nums) == len(set(nums)), f"{label}: invoice numbers unique")
    check(nums == [i["number"] for i in sorted(inv, key=lambda r: r["start"])], f"{label}: invoices sorted by start")
    ok_sum = ok_days = ok_extras = True
    for i in inv:
        s = sum(i[c] for c in B.CATEGORIES)
        if abs(s - i["total"]) > 0.006:
            ok_sum = False
        if abs(i["extras_total"] - (i["total"] - i["shipping"])) > 0.011:
            ok_extras = False
        days = iso_days(i["start"], i["end"])
        for c in B.CATEGORIES + ["total", "extras"]:
            tot = sum(doc["daily"][x][c] for x in days if x in doc["daily"])
            target = i[c] if c in i else (i["total"] if c == "total" else i["extras_total"])
            if abs(tot - target) > 0.00005 * len(days) + 1e-9:
                ok_days = False
                print(f"    period sum mismatch {i['number']} {c}: {tot} vs {target}")
    check(ok_sum, f"{label}: sum of categories == total for every invoice")
    check(ok_extras, f"{label}: extras_total == total - shipping")
    check(ok_days, f"{label}: daily spread sums back to the invoice amounts (every category, total, extras)")
    mon = {}
    for day, v in doc["daily"].items():
        m = mon.setdefault(day[:7], {})
        for c in B.CATEGORIES + ["total", "extras"]:
            m[c] = m.get(c, 0.0) + v[c]
    ok_m = all(abs(mon[k][c] - doc["monthly"][k][c]) < 0.006 for k in mon for c in mon[k]) and set(mon) == set(doc["monthly"])
    check(ok_m, f"{label}: monthly == sum of daily")
    inv_days = {x for i in inv for x in iso_days(i["start"], i["end"]) if x >= doc["meta"]["history_start"]}
    check(inv_days == set(doc["daily"]), f"{label}: daily has exactly the days of the invoices (no day lost / none extra)")
    check(all(doc["daily"][x]["invoice"] in nums for x in doc["daily"]), f"{label}: every daily row points to an existing invoice")


def test_merge(cur_inv, cur_st, tmp):
    print("[2] merge of a synthetic blob into the live files")
    live_inv = json.load(open(cur_inv))
    live_st = json.load(open(cur_st))
    for mode in ("named", "shuffled", "positional"):
        blob, info = synthetic_blob(cur_inv, cur_st, mode)
        out = os.path.join(tmp, f"merge_{mode}")
        bp = os.path.join(tmp, f"blob_{mode}.json")
        if mode == "named":   # as the browser tool saves it: JSON string literal + trailer
            with open(bp, "w", encoding="utf-8") as f:
                f.write(json.dumps(json.dumps(blob, ensure_ascii=False), ensure_ascii=False) + "\n\n(captured at origin https://app.shipmonk.com)\n")
        else:
            json.dump(blob, open(bp, "w"))
        p = run_builder([bp, "--inv-prev", cur_inv, "--storage-prev", cur_st, "--out-dir", out])
        check(p.returncode == 0, f"[{mode}] builder exits 0")
        doc = json.load(open(os.path.join(out, "shipmonk_invoices.json")))
        st = json.load(open(os.path.join(out, "shipmonk_storage_daily.json")))
        rep = open(os.path.join(out, "REPORT.txt"), encoding="utf-8").read()
        if mode == "named":
            # ---- invoices
            check(len(doc["invoices"]) == len(live_inv["invoices"]) + 2, "2 new invoices added (count +2)")
            assert_invoice_invariants(doc, "merged")
            nums = {i["number"]: i for i in doc["invoices"]}
            check(nums[info["resend_number"]]["status"] == "status_complete", "re-sent invoice replaced by number (status updated)")
            check(all(nums[r["number"]] == r for r in live_inv["invoices"] if r["number"] != info["resend_number"]), "older invoices kept unchanged")
            t1 = nums["TEST0001"]
            check(abs(t1["unallocated"] - 12.34) < 0.006, "unallocated = total - sections (12.34)")
            check(t1["receiving"] == 650.0 and t1["returns"] == 40.5 and t1["packaging_purchases"] == 7000.0 and t1["credits"] == -1500.0, "line-item types mapped to categories")
            check(abs(t1["fees_other"] - 309.99) < 0.006 and t1["line_items_by_type"]["weird_new_type"]["category"] == "fees_other", "unknown type -> fees_other")
            check(doc["meta"]["current_period"] == {"start": info["p3"]["start"], "end": info["p3"]["end"], "status": "in_process"}, "meta.current_period taken from the blob's current")
            check(doc["meta"]["last_day"] == info["p2"]["end"] and doc["meta"]["missing_count"] == 0, "coverage extends to the new last day, no missing days")
            check(doc["meta"]["types_seen"]["weird_new_type"]["count"] == 1, "types_seen includes the new type")
            old_days = {k: v for k, v in live_inv["daily"].items() if v["invoice"] != info["resend_number"]}
            check(all(doc["daily"][k] == v for k, v in old_days.items()), "daily rows of untouched invoices byte-identical to the previous file")
            check(all(doc["daily"][k][c] == v[c] for k, v in live_inv["daily"].items() if v["invoice"] == info["resend_number"] for c in B.CATEGORIES + ["total", "extras"]), "re-sent invoice: daily amounts unchanged")
            for k in ("source", "currency"):
                check(doc[k] == live_inv[k], f"top-level '{k}' unchanged")
            check(list(doc["meta"].keys()) == list(live_inv["meta"].keys()), "meta keeps the same keys (schema unchanged)")
            # ---- storage
            check(all(st["daily"][k] == v for k, v in live_st["daily"].items()), "all previous storage days kept with identical values (re-pulled days identical)")
            check(all(k in st["daily"] for k in info["new_days"]) and st["days"] == live_st["days"] + 10, "10 new storage days added")
            check(st["last_day"] == info["new_days"][-1] and st["first_day"] == live_st["first_day"], "first/last day updated")
            ok = all(abs(v["inv"] - round(sum(x[1] for x in v["wh"].values()), 2)) < 0.006 and abs(v["tru"] - round(sum(x[0] for x in v["wh"].values()), 2)) < 0.006 for v in st["daily"].values())
            check(ok, "inv/tru == sum over warehouses for every day")
            last = st["daily"][info["new_days"][-1]]
            check("All Warehouses" not in last["wh"] and abs(last["inv"] - (150.0 + 9 + 210.0)) < 0.006, "'All Warehouses' row dropped when named warehouses exist on the same day")
            check("All Warehouses" in st["warehouses"] and set(live_st["warehouses"]) <= set(st["warehouses"]), "warehouses[] keeps 'All Warehouses' (June 2025) and previous names")
            chk = B.storage_vs_invoices(doc, st)
            d1 = [c for c in chk if c[0] == "TEST0001"]
            check(bool(d1) and abs(d1[0][5]) <= 0.15, "storage day sum == invoice storage for the fully covered new period")
            check(all(abs(c[5]) <= 0.15 for c in chk), f"all {len(chk)} fully covered periods within $0.15 (max {max(abs(c[5]) for c in chk):.2f})")
            check(not any(c[0] == "TEST0002" for c in chk), "period not fully covered by storage days is not checked")
            check("NEW invoices (2)" in rep and "TEST0001" in rep and "REPLACED invoices (1)" in rep and "added days: 10" in rep and "All Warehouses" in rep, "REPORT.txt lists new/replaced invoices, new days and the warning")
            check("storage columns by name" in rep, "columns resolved by name")
            # ---- blob as string literal with trailer handled
            check(doc["meta"]["invoice_count"] == len(live_inv["invoices"]) + 2, "blob given as JSON string literal + '(captured at origin' trailer parsed")
        elif mode == "shuffled":
            ref = json.load(open(os.path.join(tmp, "merge_named", "shipmonk_storage_daily.json")))
            check(canon(st) == canon(ref), "shuffled Metabase columns -> identical storage file (mapping by name)")
        elif mode == "positional":
            ref = json.load(open(os.path.join(tmp, "merge_named", "shipmonk_storage_daily.json")))
            check(canon(st) == canon(ref), "unknown column names -> positional fallback gives the same file")
            check("resolved by POSITION" in rep, "REPORT warns that columns were resolved by position")
    # storage report missing -> storage file = previous, invoices still built
    blob, info = synthetic_blob(cur_inv, cur_st, "named")
    blob["storage"] = {"error": "report \"Storage Fees Breakdown\" not found"}
    blob["current"] = {"error": "HTTP 404"}
    bp = os.path.join(tmp, "blob_nostorage.json")
    json.dump(blob, open(bp, "w"))
    out = os.path.join(tmp, "merge_nostorage")
    p = run_builder([bp, "--inv-prev", cur_inv, "--storage-prev", cur_st, "--out-dir", out])
    st = json.load(open(os.path.join(out, "shipmonk_storage_daily.json")))
    doc = json.load(open(os.path.join(out, "shipmonk_invoices.json")))
    rep = open(os.path.join(out, "REPORT.txt"), encoding="utf-8").read()
    check(p.returncode == 0 and canon(st) == canon(live_st), "storage error in blob -> storage file re-written unchanged")
    check("storage report not collected" in rep and "current period" in rep, "REPORT warns about missing storage / current period")
    check(doc["meta"]["current_period"] == B.period_after(info["p2"]["end"]), "current period falls back to the period after the last invoice when the endpoint failed")
    # builder refuses an obviously wrong blob
    bad = os.path.join(tmp, "blob_bad.json")
    open(bad, "w").write("[1,2,3]")
    p = run_builder([bad, "--inv-prev", cur_inv, "--storage-prev", cur_st, "--out-dir", os.path.join(tmp, "bad")])
    check(p.returncode != 0, "non-object blob rejected")


# ------------------------------------------------------------------------------------------- 3. collector e2e
NODE_HARNESS = r"""
const fs = require('fs');
const [,, collectorPath, rawPath, rowsPath, since, storageSince, outPath] = process.argv;
const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
const legacyRows = rowsPath && rowsPath !== '-' ? JSON.parse(fs.readFileSync(rowsPath, 'utf8')) : [];
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.SECRET-TOKEN-DO-NOT-LEAK.sig';
const JWT = 'eyJ0eXAiOiJKV1QifQ.EMBED-JWT-DO-NOT-LEAK.sig2';
let src = fs.readFileSync(collectorPath, 'utf8');
src = src.replace(/const SINCE = '[^']*'/, `const SINCE = '${since}'`).replace(/const STORAGE_SINCE = '[^']*'/, `const STORAGE_SINCE = '${storageSince}'`);
src = src.replace(/const DETAIL_DELAY_MS = \d+/, 'const DETAIL_DELAY_MS = 0');
// ---- mock browser globals
globalThis.window = globalThis;
globalThis.location = { origin: 'https://app.shipmonk.com' };
globalThis.localStorage = { getItem: (k) => (k === 'api_token' ? JSON.stringify(TOKEN) : null) };
const calls = [];
// list items in the documented shape: id, invoice_number, billing_period, status, closed, total
const listItems = raw.map((i) => ({ id: i.id, invoice_number: i.number, billing_period: { start: i.start + 'T00:00:00+00:00', end: i.end + 'T23:59:59+00:00' },
                                    status: i.status, closed: true, total: i.total }));
listItems.push({ id: 999999, invoice_number: 'CURRENT', billing_period: { start: '2026-09-15', end: '2026-09-30' }, status: 'status_in_process', closed: false, total: null });
for (let k = 1; k <= 60; k++) listItems.push({ id: k, invoice_number: 'OLD' + k, billing_period: { start: '2023-01-01', end: '2023-01-14' }, status: 'status_complete', closed: true, total: 1 }); // pad -> 2 pages
listItems.sort((a, b) => b.id - a.id);          // newest first, like most list endpoints
function detailFor(i) {
  const items = [];
  for (const [t, v] of Object.entries(i.line_items.by_type)) {
    const bigs = i.line_items.big.filter((b) => b.type === t);
    let rest = Math.round((v.amount - bigs.reduce((s, b) => s + b.amount, 0)) * 100) / 100;
    let nRest = v.count - bigs.length;
    for (const b of bigs) items.push({ type: t, total_price: b.amount, quantity: b.qty, date: b.date + 'T00:00:00+00:00', description: b.desc.length >= 90 ? b.desc + ' EXTRA TEXT BEYOND 90 CHARS' : b.desc });
    if (nRest > 0) {
      const each = Math.round((rest / nRest) * 100) / 100;
      let acc = 0;
      for (let k = 0; k < nRest; k++) {
        const amt = k === nRest - 1 ? Math.round((rest - acc) * 100) / 100 : each;
        acc += amt;
        items.push({ type: t, total_price: amt, quantity: 1, date: i.end + 'T00:00:00+00:00', description: 'item ' + t });
      }
    }
  }
  // NOTE: the real API's item order is unknown; by_type key order / big order follow it (order-insensitive compare below)
  return { data: { id: i.id, invoice_number: i.number, status: i.status, total: String(i.total), billing_period: { start: i.start, end: i.end },
    charges: { shipping: { total: String(i.shipping.total), count: i.shipping.count },
               storage_fees: { total: i.storage.total, items: i.storage.by_type.map((s) => ({ type: s.type, average_daily_quantity: s.avg_daily_qty, total: s.total, unit_prices: [] })) },
               adjustment: { total: i.adjustment.total, count: i.adjustment.count },
               line_items: { total: i.line_items.total, count: i.line_items.count, items } } } };
}
globalThis.fetch = async (url, opts) => {
  calls.push(url);
  const auth = opts && opts.headers && opts.headers.Authorization;
  const u = new URL(url, 'https://app.shipmonk.com');
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  if (u.origin === 'https://app.shipmonk.com') {
    if (auth !== 'Bearer ' + TOKEN) return { ok: false, status: 401, json: async () => ({}) };
    if (u.pathname === '/api/v1/billing/invoices') {
      const page = +u.searchParams.get('page'), ps = +u.searchParams.get('pageSize');
      if (u.searchParams.get('filter') !== '[]' || ps !== 100) return { ok: false, status: 400, json: async () => ({}) };
      return ok({ data: listItems.slice((page - 1) * ps, page * ps), meta: { total: listItems.length, page } });
    }
    if (u.pathname === '/api/v1/billing/invoices/current') return ok({ data: { id: 999999, invoice_number: null, status: 'status_in_process', total: null, billing_period: { start: '2026-09-15', end: '2026-09-30' } } });
    const m = u.pathname.match(/^\/api\/v1\/billing\/invoices\/(\d+)$/);
    if (m) { const i = raw.find((x) => String(x.id) === m[1]); return i ? ok(detailFor(i)) : { ok: false, status: 404, json: async () => ({}) }; }
    if (u.pathname === '/api/v1/reports') return ok({ data: { categories: [
      { name: 'Inventory', reports: [{ id: 5, name: 'Inventory History', url: 'https://reporting.shipmonk.cloud/embed/dashboard/other.jwt.x#titled=false', url_type: 'metabase-iframe' }] },
      { name: 'Billing', reports: [{ id: 40, name: 'Storage Fees Breakdown', url: `https://reporting.shipmonk.cloud/embed/dashboard/${JWT}#bordered=true&titled=false`, url_type: 'metabase-iframe' }] } ] } });
    return { ok: false, status: 404, json: async () => ({}) };
  }
  if (u.origin === 'https://reporting.shipmonk.cloud') {
    const m = u.pathname.match(/^\/api\/embed\/dashboard\/([^/]+)\/dashcard\/(\d+)\/card\/(\d+)$/);
    if (!m || m[1] !== JWT || m[2] !== '251' || m[3] !== '165') return { ok: false, status: 404, json: async () => ({}) };
    const [a, b] = (u.searchParams.get('storage_day') || '~').split('~');
    if (auth) return { ok: false, status: 400, json: async () => ({}) };   // embed endpoint takes no bearer
    const rows = legacyRows.filter((r) => r[0] >= a && r[0] <= b).map((r) => [r[0] + 'T00:00:00Z', r[1], r[2], r[3], r[5] === 'C' ? 'Capped storage' : (r[5] === 'T' ? 'True storage' : null), r[4], 0]);
    const cols = ['STORAGE_DAY', 'WAREHOUSE_NAME', 'TRUE_STORAGE_USD_SUM', 'STORAGE_CAPPING_SUM', 'WINNING_STRATEGY', 'INVOICED_SUM', 'STORAGE_CAP_IMPACT'].map((n) => ({ name: n, display_name: n, base_type: 'type/Text' }));
    return ok({ data: { cols, rows }, row_count: rows.length, status: 'completed' });
  }
  return { ok: false, status: 404, json: async () => ({}) };
};
(async () => {
  // the snippet is one top-level-await expression (REPL semantics of the browser tool); turn it into an async fn body
  const body = src.replace(/^await \(async \(\) => \{/m, 'return await (async () => {');
  if (body === src) throw new Error('collector no longer starts with "await (async () => {"');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const result = await new AsyncFunction(body)();
  const leak = result.includes(TOKEN) || result.includes(JWT) || result.includes('SECRET') || result.includes('EMBED-JWT');
  fs.writeFileSync(outPath, result);
  console.log(JSON.stringify({ ok: typeof result === 'string', leak, calls: calls.length, listCalls: calls.filter((c) => c.includes('/billing/invoices?')).length,
    storageCalls: calls.filter((c) => c.includes('reporting.shipmonk.cloud')).length, done: window.__smBillDone === true, status: window.__smBillStatus }));
})();
"""


def test_collector_e2e(raw, st_rows, cur_inv, cur_st, tmp):
    print("[3] collector end-to-end against a mock of the documented endpoints (node)")
    node = shutil.which("node")
    if not node:
        print("  skip: node not available")
        return
    harness = os.path.join(tmp, "harness.js")
    open(harness, "w").write(NODE_HARNESS)
    blob_path = os.path.join(tmp, "e2e_blob.json")
    live = json.load(open(cur_inv))
    p = subprocess.run([node, harness, COLLECTOR, raw, st_rows or "-", live["meta"]["history_start"], "2025-06-01", blob_path], capture_output=True, text=True)
    if p.returncode != 0:
        print(p.stdout[-2000:], p.stderr[-3000:])
    check(p.returncode == 0, "collector runs to completion under node")
    try:
        res = json.loads(p.stdout.strip().splitlines()[-1])
    except Exception:
        res = {}
    check(res.get("ok") is True and res.get("done") is True, "returns a string and sets window.__smBillDone")
    check(res.get("leak") is False, "token / embed JWT never appear in the output")
    check(res.get("listCalls", 0) == 2, f"pagination: 124 list items -> 2 pages fetched (got {res.get('listCalls')})")
    check(res.get("storageCalls", 0) >= 8, f"storage pulled in {res.get('storageCalls')} chunk calls")
    blob = json.loads(open(blob_path).read())
    rawl = json.load(open(raw))
    check(len(blob["invoices"]) == len([i for i in rawl if i["end"] >= live["meta"]["history_start"]]), f"{len(blob['invoices'])} closed invoices since {live['meta']['history_start']} collected (in-process one skipped)")
    check(blob["current"] and blob["current"].get("start") == "2026-09-15" and blob["current"].get("end") == "2026-09-30", "current period read from /invoices/current")
    check(any(s.get("reason") == "not closed" for s in blob["diag"]["skipped"]), "in-process invoice listed in diag.skipped")
    # raw shape equality with the legacy export (the mock is built from it, so it must round-trip)
    by_num = {i["number"]: i for i in rawl}
    mism = []
    for inv in blob["invoices"]:
        ref = by_num[inv["number"]]
        for k in ("id", "number", "start", "end", "status", "total"):
            if inv[k] != ref[k]:
                mism.append((inv["number"], k, inv[k], ref[k]))
        if inv["shipping"] != ref["shipping"] or inv["storage"] != ref["storage"] or inv["adjustment"] != ref["adjustment"]:
            mism.append((inv["number"], "sections"))
        if inv["line_items"]["by_type"] != ref["line_items"]["by_type"] or inv["line_items"]["count"] != ref["line_items"]["count"] or abs(inv["line_items"]["total"] - ref["line_items"]["total"]) > 0.006:
            mism.append((inv["number"], "by_type"))
        if sorted(json.dumps(b, sort_keys=True) for b in inv["line_items"]["big"]) != sorted(json.dumps(b, sort_keys=True) for b in ref["line_items"]["big"]):
            mism.append((inv["number"], "big", inv["line_items"]["big"], ref["line_items"]["big"]))
    if mism:
        print("   mismatches:", json.dumps(mism[:3], ensure_ascii=False)[:1500])
    check(not mism, "collected raw invoices identical to the legacy export (by_type, big with 90-char desc, storage by_type)")
    if st_rows:
        chunks = blob["storage"]["chunks"]
        check(blob["storage"]["report"]["id"] == 40 and len(chunks) >= 8 and all(c.get("row_count", 0) < 2000 for c in chunks), f"storage: report found by name, {len(chunks)} chunks of <= 60 days, all < 2000 rows")
        check(chunks[0]["cols"][5] == "INVOICED_SUM" and chunks[0]["col_meta"][0]["name"] == "STORAGE_DAY", "chunk carries cols[] names and col_meta")
    # the blob must rebuild both live files
    out = os.path.join(tmp, "e2e_out")
    cp = live["meta"]["current_period"]
    p = run_builder([blob_path, "--out-dir", out, "--current-start", cp["start"], "--current-end", cp["end"]])
    check(p.returncode == 0, "builder accepts the collector blob")
    got = json.load(open(os.path.join(out, "shipmonk_invoices.json")))
    check(canon_order_insensitive(got) == canon_order_insensitive(live), "invoices file rebuilt from the collector blob equals the live file (order of line-item types/big items follows the API's item order, compared order-insensitively)")
    if st_rows:
        got_s = json.load(open(os.path.join(out, "shipmonk_storage_daily.json")))
        check(canon(got_s) == canon(json.load(open(cur_st))), "storage file rebuilt from the collector blob is byte-identical to the live file")


# ------------------------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixtures", default=os.path.join(os.path.dirname(HERE), "fixtures"))
    ap.add_argument("--raw", default=os.path.join(os.path.dirname(HERE), "raw_invoices.json"))
    ap.add_argument("--current-inv")
    ap.add_argument("--current-storage")
    ap.add_argument("--storage-rows")
    ap.add_argument("--keep", action="store_true", help="keep the temp dir")
    a = ap.parse_args()
    cur_inv = a.current_inv or os.path.join(a.fixtures, "current_shipmonk_invoices.json")
    cur_st = a.current_storage or os.path.join(a.fixtures, "current_shipmonk_storage_daily.json")
    st_rows = a.storage_rows
    if not st_rows:
        cands = [os.path.join(a.fixtures, f) for f in sorted(os.listdir(a.fixtures)) if f.startswith("storage_rows_legacy")] if os.path.isdir(a.fixtures) else []
        st_rows = cands[0] if cands else None
    for p in (cur_inv, cur_st, a.raw):
        if not os.path.exists(p):
            print("missing input:", p)
            return 2
    tmp = tempfile.mkdtemp(prefix="smk_test_")
    print("temp:", tmp)
    test_reproduction(a.raw, cur_inv, cur_st, st_rows, tmp)
    test_merge(cur_inv, cur_st, tmp)
    test_collector_e2e(a.raw, st_rows, cur_inv, cur_st, tmp)
    print(f"\n{len(PASSES)} passed, {len(FAILS)} failed")
    for f in FAILS:
        print("  FAIL", f)
    if not a.keep:
        shutil.rmtree(tmp, ignore_errors=True)
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
