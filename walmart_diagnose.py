#!/usr/bin/env python3
"""
Cattasaurus - Walmart Marketplace API DIAGNOSE (v0.1): chạy tay 1 lần để biết hình dạng dữ liệu thật trước khi viết fetch script.
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


def orders_page(token, start, end, limit=200, cursor=None):
    if cursor:
        return call("GET", f"{BASE}/v3/orders{cursor}", token=token)
    q = urllib.parse.urlencode({"createdStartDate": iso(start), "createdEndDate": iso(end), "limit": limit})
    return call("GET", f"{BASE}/v3/orders?{q}", token=token)


def elements(resp):
    o = (((resp or {}).get("list") or {}).get("elements") or {}).get("order") or []
    return o if isinstance(o, list) else [o]


def main():
    if not CID or not SEC:
        log("missing WALMART_CLIENT_ID / WALMART_CLIENT_SECRET"); sys.exit(1)
    token = get_token()
    if not token: sys.exit(1)
    now = datetime.now(timezone.utc)

    # 1) how much does the shop sell? orders per month since 2025-01 (meta.totalCount, limit=1 -> cheap)
    log("--- orders per month (totalCount) ---")
    m = datetime(2025, 1, 1, tzinfo=timezone.utc)
    while m < now:
        nxt = (m.replace(day=28) + timedelta(days=4)).replace(day=1)
        st, r = orders_page(token, m, min(nxt, now), limit=1)
        tc = ((r.get("list") or {}).get("meta") or {}).get("totalCount") if isinstance(r, dict) else None
        log(f"{m:%Y-%m}: HTTP {st} totalCount={tc}")
        if st == 401 or st == 403: log(f"  -> {r}"); break
        m = nxt
        time.sleep(0.5)

    # 2) shape of orders: last 45 days, all pages
    log("--- order shape (last 45 days) ---")
    start = now - timedelta(days=45)
    st, r = orders_page(token, start, now)
    if st != 200:
        log(f"orders failed HTTP {st}: {r}"); sys.exit(1)
    all_orders, pages = [], 0
    while True:
        pages += 1
        all_orders += elements(r)
        cur = ((r.get("list") or {}).get("meta") or {}).get("nextCursor")
        if not cur or pages > 30: break
        time.sleep(0.6)
        st, r = orders_page(token, start, now, cursor=cur)
        if st != 200: log(f"page {pages+1} failed HTTP {st}: {r}"); break
    log(f"orders fetched: {len(all_orders)} in {pages} page(s)")
    if all_orders:
        o = all_orders[0]
        log(f"order keys: {sorted(o.keys())}")
        lines = ((o.get("orderLines") or {}).get("orderLine")) or []
        if lines:
            l = lines[0]
            log(f"orderLine keys: {sorted(l.keys())}")
            ch = ((l.get('charges') or {}).get('charge')) or []
            if ch: log(f"charge keys: {sorted(ch[0].keys())}")
            sts = ((l.get('orderLineStatuses') or {}).get('orderLineStatus')) or []
            if sts: log(f"orderLineStatus keys: {sorted(sts[0].keys())}")
            if l.get("refund"): log(f"refund keys: {json.dumps(l['refund'])[:300]}")
        ts = [x.get("orderDate") for x in all_orders if x.get("orderDate")]
        if ts: log(f"orderDate type={type(ts[0]).__name__} min={min(ts)} max={max(ts)}")
        status_c, charge_c, units, prod_total, ship_total, tax_total = collections.Counter(), collections.Counter(), 0, 0.0, 0.0, 0.0
        ship_method = collections.Counter(); refunds = 0
        for x in all_orders:
            for l in ((x.get("orderLines") or {}).get("orderLine")) or []:
                for s in ((l.get("orderLineStatuses") or {}).get("orderLineStatus")) or []:
                    status_c[s.get("status")] += 1
                units += int(float(((l.get("orderLineQuantity") or {}).get("amount")) or 0))
                if l.get("refund"): refunds += 1
                for c in ((l.get("charges") or {}).get("charge")) or []:
                    t = c.get("chargeType"); charge_c[t] += 1
                    a = float(((c.get("chargeAmount") or {}).get("amount")) or 0)
                    tx = float(((c.get("tax") or {}).get("taxAmount") or {}).get("amount") or 0) if isinstance((c.get("tax") or {}).get("taxAmount"), dict) else 0.0
                    if t == "PRODUCT": prod_total += a
                    elif t == "SHIPPING": ship_total += a
                    tax_total += tx
            ship_method[((x.get("shippingInfo") or {}).get("methodCode"))] += 1
        log(f"line statuses: {dict(status_c)}"); log(f"charge types: {dict(charge_c)}")
        log(f"units={units} PRODUCT charges=${prod_total:,.2f} SHIPPING=${ship_total:,.2f} tax=${tax_total:,.2f} lines-with-refund={refunds}")
        log(f"shipping methodCodes: {dict(ship_method)}")

    # 3) fees: reconciliation report availability + column names
    log("--- reconciliation report ---")
    for ver in ("v1",):
        st, r = call("GET", f"{BASE}/v3/report/reconreport/availableReconFiles?reportVersion={ver}", token=token)
        log(f"availableReconFiles {ver}: HTTP {st}")
        if st == 200 and isinstance(r, dict):
            log(f"  keys: {sorted(r.keys())}")
            dates = r.get("availableApReportDates") or r.get("availableDates") or []
            log(f"  dates: {len(dates)} first={dates[:2]} last={dates[-2:]}")
            if dates:
                d = dates[0] if isinstance(dates[0], str) else str(dates[0])
                q = urllib.parse.urlencode({"reportDate": d, "reportVersion": ver})
                st2, body = call("GET", f"{BASE}/v3/report/reconreport/reconFile?{q}", token=token, raw=True, headers={"Accept": "application/octet-stream"})
                log(f"  reconFile {d}: HTTP {st2} bytes={len(body) if isinstance(body,(bytes,bytearray)) else body}")
                if st2 == 200 and isinstance(body, (bytes, bytearray)):
                    try:
                        z = zipfile.ZipFile(io.BytesIO(body))
                        for name in z.namelist()[:2]:
                            txt = z.read(name).decode("utf-8", errors="replace")
                            rows = list(csv.reader(io.StringIO(txt)))
                            log(f"  file {len(name)}ch name: columns={rows[0] if rows else None} data_rows={max(0,len(rows)-1)}")
                            if len(rows) > 1:
                                tt = collections.Counter(r2[rows[0].index('Transaction Type')] for r2 in rows[1:] if 'Transaction Type' in rows[0])
                                log(f"  transaction types: {dict(tt)}")
                    except Exception as e:  # noqa: BLE001
                        log(f"  not a zip ({e}); first 200 bytes keys-only skipped")
        elif st != 200:
            log(f"  -> {r}")
    log("done")


if __name__ == "__main__":
    main()
