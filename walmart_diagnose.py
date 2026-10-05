#!/usr/bin/env python3
"""
Cattasaurus - Walmart Marketplace API DIAGNOSE (v0.2): kiểm tra LỊCH SỬ bán hàng thật - báo cáo đối soát từng tuần từ 12/2025 + giới hạn 180 ngày của /v3/orders.
Chỉ in CẤU TRÚC + số tổng (tên trường, đếm theo trạng thái/tháng, tổng tiền) - KHÔNG in mã đơn, tên, địa chỉ, SKU (repo & log công khai).
Env: WALMART_CLIENT_ID, WALMART_CLIENT_SECRET (GitHub Secrets).
"""
import base64, collections, csv, io, json, os, sys, time, uuid, zipfile
import urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

BASE = "https://marketplace.walmartapis.com"
CID = os.environ.get("WALMART_CLIENT_ID", "").strip()
SEC = os.environ.get("WALMART_CLIENT_SECRET", "").strip()


def log(m): print(f"[walmart] {m}", flush=True)


def call(method, url, headers=None, data=None, token=None, raw=False):
    h = {"Accept": "application/json", "WM_SVC.NAME": "Walmart Marketplace", "WM_QOS.CORRELATION_ID": str(uuid.uuid4())}
    if token: h["WM_SEC.ACCESS_TOKEN"] = token
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
            return r.status, (body if raw else (json.loads(body.decode("utf-8")) if body else {}))
    except urllib.error.HTTPError as e:
        b = e.read().decode("utf-8", errors="replace")
        return e.code, b[:400]
    except Exception as e:  # noqa: BLE001
        return -1, str(e)[:300]


def get_token():
    auth = base64.b64encode(f"{CID}:{SEC}".encode()).decode()
    st, resp = call("POST", f"{BASE}/v3/token", headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
                    data=b"grant_type=client_credentials")
    if st != 200 or not isinstance(resp, dict) or "access_token" not in resp:
        log(f"TOKEN FAILED: HTTP {st} {resp}")
        return None
    log(f"token ok (type={resp.get('token_type')}, expires_in={resp.get('expires_in')}s)")
    return resp["access_token"]


def iso(d): return d.strftime("%Y-%m-%dT%H:%M:%SZ")


def num(v):
    try: return float(str(v).replace(",", "").replace("$", "").strip() or 0)
    except ValueError: return 0.0


def colidx(h, *names):
    low = [x.strip().lower() for x in h]
    for n in names:
        if n.lower() in low: return low.index(n.lower())
    for n in names:
        for i, x in enumerate(low):
            if n.lower() in x: return i
    return None


def month_of(ts):
    ts = (ts or "").strip()
    import re
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", ts)
    if m: return f"{m.group(3)}-{int(m.group(1)):02d}"
    m = re.match(r"(\d{4})-(\d{2})", ts)
    return f"{m.group(1)}-{m.group(2)}" if m else "?"


def main():
    if not CID or not SEC: log("missing secrets"); sys.exit(1)
    token = get_token()
    if not token: sys.exit(1)
    now = datetime.now(timezone.utc)

    log("--- /v3/orders: oldest reachable date (180-day limit?) ---")
    for d0 in ("2026-03-01", "2026-04-01", "2026-04-05", "2026-04-08", "2026-04-12"):
        a = datetime.strptime(d0, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        st, r = call("GET", f"{BASE}/v3/orders?" + urllib.parse.urlencode({"createdStartDate": iso(a), "createdEndDate": iso(a + timedelta(days=3)), "limit": 1}), token=token)
        tc = ((r.get("list") or {}).get("meta") or {}).get("totalCount") if isinstance(r, dict) else r
        log(f"{d0} +3d: HTTP {st} totalCount={tc}")
        time.sleep(0.4)
    log(f"(today {now:%Y-%m-%d}; 180 days ago = {(now - timedelta(days=180)):%Y-%m-%d})")

    log("--- reconciliation reports: history ---")
    st, r = call("GET", f"{BASE}/v3/report/reconreport/availableReconFiles?reportVersion=v1", token=token)
    if st != 200: log(f"availableReconFiles HTTP {st}: {r}"); sys.exit(1)
    dates = sorted(str(x) for x in (r.get("availableApReportDates") or []))
    dates = sorted(dates, key=lambda d: (d[4:], d[:4]))
    log(f"{len(dates)} report dates: first={dates[:1]} last={dates[-1:]}")
    by_month = collections.defaultdict(lambda: {"po": set(), "product": 0.0, "commission": 0.0, "refund": 0.0, "other": 0.0, "rows": 0})
    types = collections.defaultdict(lambda: [0, 0.0])
    first_po_month = {}
    for d in dates:
        q = urllib.parse.urlencode({"reportDate": d, "reportVersion": "v1"})
        st2, body = call("GET", f"{BASE}/v3/report/reconreport/reconFile?{q}", token=token, raw=True, headers={"Accept": "application/octet-stream"})
        if st2 != 200 or not isinstance(body, (bytes, bytearray)):
            log(f"  {d}: HTTP {st2}"); continue
        text = body.decode("utf-8-sig", errors="replace")
        rows = list(csv.reader(io.StringIO(text)))
        if not rows: continue
        h = rows[0]
        i_tt, i_at, i_amt = colidx(h, "Transaction Type"), colidx(h, "Amount Type"), colidx(h, "Amount")
        i_po = colidx(h, "Purchase Order #", "Purchase Order")
        i_ts = colidx(h, "Transaction Posted Timestamp", "Transaction Date", "Posted")
        i_ship = colidx(h, "Shipped Date Time", "Ship Date", "Shipped Date")
        if i_tt is None or i_amt is None: log(f"  {d}: unexpected columns {h[:10]}"); continue
        pos, tmin, tmax = set(), "9999", "0000"
        for row in rows[1:]:
            if len(row) <= i_amt: continue
            tt = row[i_tt]; at = row[i_at] if i_at is not None else ""; amt = num(row[i_amt])
            po = row[i_po].strip() if i_po is not None and len(row) > i_po else ""
            ts = row[i_ts] if i_ts is not None and len(row) > i_ts else ""
            mo = month_of(ts)
            types[f"{tt}|{at}"][0] += 1; types[f"{tt}|{at}"][1] += amt
            b = by_month[mo]; b["rows"] += 1
            if po:
                pos.add(po); b["po"].add(po)
                sm = month_of(row[i_ship]) if i_ship is not None and len(row) > i_ship and row[i_ship].strip() else mo
                if po not in first_po_month or sm < first_po_month[po]: first_po_month[po] = sm
            al, tl = at.lower(), tt.lower()
            if "commission" in al: b["commission"] += amt
            elif ("product" in al) and ("refund" in tl or "return" in tl): b["refund"] += amt
            elif "product price" in al or al == "product": b["product"] += amt
            elif "tax" not in al and "shipping" not in al: b["other"] += amt
        log(f"  report {d}: rows={len(rows)-1} distinctPO={len(pos)}")
        time.sleep(0.6)
    log("--- by posted month (all reports) ---")
    for mo in sorted(by_month):
        b = by_month[mo]
        log(f"{mo}: rows={b['rows']} distinctPO={len(b['po'])} product=${b['product']:,.2f} refunds=${b['refund']:,.2f} commission=${b['commission']:,.2f} otherFees=${b['other']:,.2f}")
    fm = collections.Counter(first_po_month.values())
    log(f"--- PO first sale/ship month (distinct POs): {sorted(fm.items())}")
    log("--- Transaction Type | Amount Type (count, sum) ---")
    for k, v in sorted(types.items(), key=lambda kv: -kv[1][0])[:40]:
        log(f"  {k}: n={v[0]} sum={v[1]:,.2f}")
    log("done")


if __name__ == "__main__":
    main()
