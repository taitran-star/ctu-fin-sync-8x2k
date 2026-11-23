#!/usr/bin/env python3
"""fetch_walmart_settlements.py v1.0 - Walmart payment periods -> data/walmart_settlements.json

One row per Walmart reconciliation report (= one payment period, the unit Walmart pays out, every 2 weeks):
  report_date, period_start, period_end, total_payable (the amount Walmart deposits for the period),
  currency, rows, lines{"Transaction Type|Amount Type": [count, amount]} = EVERY money row of the report
  summed with no classification, lines_total = their sum, diff = total_payable - lines_total
  (0.00 = the period is fully explained by its rows), and notes{"Transaction Type|Amount Type|text": [count, amount]}
  = the same rows split by their description text for the row types that are not plain sales / refunds
  (adjustments, fees, campaigns, payment summary), so each fee can be put in the right account.
No order ids, no customer data, no bank account digits are written (public repo): only dates, types and
sums; every run of 4 or more digits inside a description is replaced by "#".

Reuses fetch_walmart.py for the token and the HTTP client.
Secrets (names only): WALMART_CLIENT_ID, WALMART_CLIENT_SECRET.
Optional env: SETTLEMENTS_FORCE_ALL=1 (download every available report again), SETTLEMENTS_REFRESH_LAST (default 2).
"""
import csv
import io
import json
import os
import re
import sys
import time
import urllib.parse
import zipfile
from datetime import datetime, timezone

import fetch_walmart as fw

SCRIPT_VERSION = "1.0"
OUT = os.environ.get("SETTLEMENTS_OUT", "data/walmart_settlements.json")
FORCE_ALL = (os.environ.get("SETTLEMENTS_FORCE_ALL", "") or "").strip() in ("1", "true", "yes")
REFRESH_LAST = int(re.sub(r"\D", "", os.environ.get("SETTLEMENTS_REFRESH_LAST", "") or "") or 2)
PLAIN = {"sale", "refund"}   # row types whose description is not needed (one row per order line)


def log(m):
    print(f"[walmart-settlements] {m}", flush=True)


def r2(x):
    return round(x + 0.0, 2)


def clean(s, n=70):
    s = re.sub(r"\d{4,}", "#", str(s or "").strip())
    s = re.sub(r"\s+", " ", s)
    return s[:n]


def iso_day(s):
    s = (s or "").strip()
    for f in ("%m/%d/%Y", "%Y-%m-%d", "%m-%d-%Y", "%m/%d/%Y %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            return datetime.strptime(s, f).date().isoformat()
        except ValueError:
            continue
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", s)
    return m.group(0) if m else (s[:10] or None)


def parse(text):
    rd = list(csv.reader(io.StringIO(text)))
    if not rd:
        return None
    header = rd[0]
    c = lambda *names: fw.col(header, *names)
    i_tt, i_at, i_amt = c("Transaction Type"), c("Amount Type"), c("Amount")
    i_ps, i_pe, i_tp, i_cur = c("Period Start Date"), c("Period End Date"), c("Total Payable"), c("Currency")
    i_desc, i_reason = c("Transaction Description"), c("Transaction Reason Description")
    if i_tt is None or i_amt is None:
        return {"error": f"unexpected columns: {header[:12]}"}
    cell = lambda row, i: (row[i].strip() if i is not None and len(row) > i else "")
    lines, notes = {}, {}
    starts, ends, payables, curs = set(), set(), set(), set()
    n = 0
    for row in rd[1:]:
        if len(row) <= i_amt:
            continue
        n += 1
        tt, at = cell(row, i_tt), cell(row, i_at)
        amt = fw.num(row[i_amt])
        if cell(row, i_ps): starts.add(iso_day(cell(row, i_ps)))
        if cell(row, i_pe): ends.add(iso_day(cell(row, i_pe)))
        if cell(row, i_tp): payables.add(r2(fw.num(cell(row, i_tp))))
        if cell(row, i_cur): curs.add(cell(row, i_cur)[:3].upper())
        k = f"{tt}|{at}"
        e = lines.setdefault(k, [0, 0.0]); e[0] += 1; e[1] += amt
        if tt.lower() not in PLAIN:
            txt = clean(cell(row, i_desc)) or clean(cell(row, i_reason))
            e2 = notes.setdefault(f"{k}|{txt}", [0, 0.0]); e2[0] += 1; e2[1] += amt
    total = r2(sum(v[1] for v in lines.values()))
    payable = sorted(payables)
    return {
        "period_start": min(starts) if starts else None,
        "period_end": max(ends) if ends else None,
        "total_payable": payable[0] if len(payable) == 1 else None,
        "total_payable_values": payable if len(payable) != 1 else None,
        "currency": sorted(curs)[0] if curs else None,
        "rows": n,
        "lines": {k: [v[0], r2(v[1])] for k, v in sorted(lines.items())},
        "lines_total": total,
        "diff": r2(payable[0] - total) if len(payable) == 1 else None,
        "notes": {k: [v[0], r2(v[1])] for k, v in sorted(notes.items())},
    }


def main():
    if not fw.CID or not fw.SEC:
        log("missing WALMART_CLIENT_ID / WALMART_CLIENT_SECRET"); sys.exit(1)
    try:
        with open(OUT, encoding="utf-8") as f:
            old = json.load(f)
    except (OSError, ValueError):
        old = {}
    have = {s["report_key"]: s for s in old.get("settlements", []) if s.get("report_key")}
    if old.get("script_version") != SCRIPT_VERSION:
        have = {}
    w = fw.Walmart()
    try:
        w.auth()
    except RuntimeError as e:
        log(str(e)); sys.exit(1)
    st, r = w.get("/v3/report/reconreport/availableReconFiles?reportVersion=v1")
    if st != 200 or not isinstance(r, dict):
        log(f"availableReconFiles HTTP {st} {str(r)[:160]}"); sys.exit(1)
    dates = [str(d) for d in (r.get("availableApReportDates") or r.get("availableDates") or [])]
    key_day = lambda d: f"{d[4:]}-{d[:2]}-{d[2:4]}"
    dates.sort(key=key_day)
    newest = set(dates[-REFRESH_LAST:]) if REFRESH_LAST > 0 else set()
    todo = [d for d in dates if FORCE_ALL or d not in have or d in newest]
    log(f"v{SCRIPT_VERSION}: {len(dates)} reports available, {len(have)} cached, {len(todo)} to download")
    errors = 0
    for d in todo:
        q = urllib.parse.urlencode({"reportDate": d, "reportVersion": "v1"})
        st2, body = w.get(f"/v3/report/reconreport/reconFile?{q}", binary=True, headers={"Accept": "application/octet-stream"})
        if st2 != 200 or not isinstance(body, (bytes, bytearray)):
            errors += 1; log(f"report {d}: HTTP {st2}"); continue
        if body[:2] == b"PK":
            z = zipfile.ZipFile(io.BytesIO(body))
            body = b"\n".join(z.read(n) for n in z.namelist() if n.lower().endswith(".csv"))
        p = parse(body.decode("utf-8-sig", errors="replace"))
        if not p or "error" in p:
            errors += 1; log(f"report {d}: {p}"); continue
        p = {"report_key": d, "report_date": key_day(d), **{k: v for k, v in p.items() if v is not None}}
        have[d] = p
        log(f"report {p['report_date']}: {p.get('period_start')} -> {p.get('period_end')} payable {p.get('total_payable')} rows {p['rows']} diff {p.get('diff')}")
        time.sleep(0.8)
    rows = sorted(have.values(), key=lambda s: s["report_date"])
    out = {
        "schema": 1,
        "script_version": SCRIPT_VERSION,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "meta": {"available": len(dates), "settlements": len(rows), "errors": errors,
                 "first_report": rows[0]["report_date"] if rows else None,
                 "last_report": rows[-1]["report_date"] if rows else None,
                 "payable_total": r2(sum(s.get("total_payable") or 0 for s in rows)),
                 "not_explained": [s["report_date"] for s in rows if s.get("diff") not in (0, 0.0)]},
        "settlements": rows,
    }
    if not rows:
        log("no reports parsed - not writing"); sys.exit(1)
    os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    os.replace(tmp, OUT)
    log(f"wrote {OUT}: {len(rows)} periods, payable total {out['meta']['payable_total']}, errors {errors}, not explained {out['meta']['not_explained'][:8]}")
    if errors and not have:
        sys.exit(2)


if __name__ == "__main__":
    main()
