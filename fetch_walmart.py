#!/usr/bin/env python3
"""
Cattasaurus - Walmart Marketplace sync (v1.0) -> data/walmart.json (schema 1)

Doanh thu theo NGAY DAT HANG (gio America/Los_Angeles) - cung quy tac Shopify/Amazon/TikTok:
  * /v3/orders  : don, so luong, doanh thu (PRODUCT charges) theo ngay dat; dong bi Cancelled khong tinh.
                  API chi tra ~180 ngay gan nhat -> don cu hon duoc DUNG LAI tu bao cao doi soat (recon): ma don, doanh thu =
                  "Product Price", ngay = cot ngay dat (neu co) > ngay giao/van chuyen > ngay ghi so (meta.recon_orders_basis).
  * Reconciliation report (CSV, /v3/report/reconreport): phi that cua tung don (Commission on Product ...) ->
    ghi vao NGAY DAT cua don goc; hoan tien -> NGAY HOAN; phi khong gan don (quang cao, dich vu...) -> ngay ghi so.
  * Don chua co trong recon (chua quyet toan) -> phi hoa hong UOC TINH theo ty le do tren cac don da quyet toan
    (meta.fee_rates_settled) - dashboard gan the "uoc tinh".
Khong luu ten/dia chi khach; chi ma don Walmart (PO), ngay, so tien.

Env: WALMART_CLIENT_ID, WALMART_CLIENT_SECRET (GitHub Secrets), REPORT_TIMEZONE (default America/Los_Angeles),
     HISTORY_START (default 2025-01-01; recon bao cao di xa hon /v3/orders), WINDOW_DAYS (default 45),
     BACKFILL_START / BACKFILL_END (tuy chon, YYYY-MM-DD), DATA_FILE (default data/walmart.json).
"""
import base64, collections, csv, io, json, os, re, sys, time, uuid
import urllib.error, urllib.parse, urllib.request
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

SCRIPT_VERSION = "walmart-1.2"
SCHEMA = 1
BASE = "https://marketplace.walmartapis.com"
CID = os.environ.get("WALMART_CLIENT_ID", "").strip()
SEC = os.environ.get("WALMART_CLIENT_SECRET", "").strip()
TZ = ZoneInfo(os.environ.get("REPORT_TIMEZONE", "America/Los_Angeles").strip() or "America/Los_Angeles")
DATA_FILE = os.environ.get("DATA_FILE", "data/walmart.json")
UA_HDR = {"WM_SVC.NAME": "Walmart Marketplace"}


def log(m): print(f"[walmart] {m}", flush=True)


def _clean_date(s, default=None):
    m = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", str(s or ""))
    if not m: return default
    try: return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError: return default


HISTORY_START = _clean_date(os.environ.get("HISTORY_START"), date(2025, 1, 1))
API_MAX_DAYS = 175  # /v3/orders chi tra don trong ~180 ngay gan nhat; cu hon -> dung bao cao doi soat (recon)
WINDOW_DAYS = int(re.sub(r"\D", "", os.environ.get("WINDOW_DAYS", "") or "") or 45)
BACKFILL_START = _clean_date(os.environ.get("BACKFILL_START"))
BACKFILL_END = _clean_date(os.environ.get("BACKFILL_END"))


def num(v, d=0.0):
    try: return float(str(v).replace(",", "").replace("$", "").strip() or d)
    except (TypeError, ValueError): return d


def r2(x): return round(x + 0.0, 2)


# ---------------------------------------------------------------- HTTP / auth
class Walmart:
    def __init__(self): self.token, self.t0, self.calls, self.errors = None, 0.0, 0, 0

    def _raw(self, method, url, headers=None, data=None, binary=False, retries=3):
        for attempt in range(retries):
            h = {"Accept": "application/json", "WM_QOS.CORRELATION_ID": str(uuid.uuid4()), **UA_HDR}
            h.update(headers or {})
            req = urllib.request.Request(url, data=data, method=method, headers=h)
            try:
                with urllib.request.urlopen(req, timeout=90) as r:
                    body = r.read()
                    return r.status, (body if binary else (json.loads(body.decode("utf-8")) if body else {}))
            except urllib.error.HTTPError as e:
                b = e.read().decode("utf-8", errors="replace")[:300]
                if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                    time.sleep(3 * (attempt + 1)); continue
                return e.code, b
            except Exception as e:  # noqa: BLE001
                if attempt < retries - 1: time.sleep(3); continue
                return -1, str(e)[:300]
        return -1, "retries exhausted"

    def auth(self):
        a = base64.b64encode(f"{CID}:{SEC}".encode()).decode()
        st, r = self._raw("POST", f"{BASE}/v3/token", headers={"Authorization": f"Basic {a}", "Content-Type": "application/x-www-form-urlencoded"},
                          data=b"grant_type=client_credentials")
        if st != 200 or not isinstance(r, dict) or "access_token" not in r:
            raise RuntimeError(f"token failed: HTTP {st} {str(r)[:200]}")
        self.token, self.t0 = r["access_token"], time.time()

    def get(self, path, binary=False, headers=None):
        if not self.token or time.time() - self.t0 > 780: self.auth()
        self.calls += 1
        h = {"WM_SEC.ACCESS_TOKEN": self.token, **(headers or {})}
        st, r = self._raw("GET", f"{BASE}{path}", headers=h, binary=binary)
        if st == 401:
            self.auth(); h["WM_SEC.ACCESS_TOKEN"] = self.token
            st, r = self._raw("GET", f"{BASE}{path}", headers=h, binary=binary)
        if st != 200: self.errors += 1
        return st, r


def iso(d): return d.strftime("%Y-%m-%dT%H:%M:%SZ")


def la_date(ms):
    return datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc).astimezone(TZ).date().isoformat()


# ---------------------------------------------------------------- orders
def elements(resp):
    o = (((resp or {}).get("list") or {}).get("elements") or {}).get("order") or []
    return o if isinstance(o, list) else [o]


def fetch_orders(w, start, end):
    """All orders created in [start, end] (UTC datetimes), 30-day chunks, cursor pagination."""
    out, status, cur = [], {"ok": True, "chunks": 0, "pages": 0, "error": None}, start
    while cur < end:
        nxt = min(cur + timedelta(days=30), end)
        q = urllib.parse.urlencode({"createdStartDate": iso(cur), "createdEndDate": iso(nxt), "limit": 200})
        st, r = w.get(f"/v3/orders?{q}")
        status["chunks"] += 1
        pages = 0
        while True:
            if st != 200:
                status.update(ok=False, error=f"HTTP {st} {str(r)[:160]}"); return out, status
            pages += 1; status["pages"] += 1
            out += elements(r)
            nc = ((r.get("list") or {}).get("meta") or {}).get("nextCursor")
            if not nc or pages > 60: break
            time.sleep(0.5)
            st, r = w.get(f"/v3/orders{nc}")
        cur = nxt
        time.sleep(0.5)
    return out, status


def order_row(o):
    """Compact per-order record. Cancelled lines are not sales. Returns None if the order has no sold line."""
    po = str(o.get("purchaseOrderId") or "")
    if not po or not o.get("orderDate"): return None
    gross = ship = tax = 0.0
    units = lines = cancelled_lines = refund_lines = 0
    statuses = collections.Counter()
    for l in ((o.get("orderLines") or {}).get("orderLine")) or []:
        sts = ((l.get("orderLineStatuses") or {}).get("orderLineStatus")) or []
        st = (sts[-1].get("status") if sts else None) or ""
        statuses[st] += 1
        qty = int(num(((l.get("orderLineQuantity") or {}).get("amount")), 1))
        lines += 1
        if st.lower() == "cancelled":
            cancelled_lines += 1; continue
        if l.get("refund"): refund_lines += 1
        units += qty
        for c in ((l.get("charges") or {}).get("charge")) or []:
            t, a = c.get("chargeType"), num((c.get("chargeAmount") or {}).get("amount"))
            tx = num(((c.get("tax") or {}).get("taxAmount") or {}).get("amount")) if isinstance((c.get("tax") or {}).get("taxAmount"), dict) else 0.0
            if t == "PRODUCT": gross += a; tax += tx
            elif t == "SHIPPING": ship += a  # other charge types: ignored, counted in meta.charge_types
    sold = lines - cancelled_lines
    return {"d": la_date(o["orderDate"]), "ms": int(o["orderDate"]), "g": r2(gross), "sh": r2(ship), "tx": r2(tax), "u": units,
            "ln": lines, "cx": cancelled_lines, "rf": refund_lines, "st": statuses.most_common(1)[0][0] if statuses else "",
            "sold": sold > 0}


# ---------------------------------------------------------------- reconciliation
def parse_ts(s, fallback):
    s = (s or "").strip()
    if not s: return fallback
    for f in ("%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M", "%m/%d/%Y", "%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S%z",
              "%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%m-%d-%Y"):
        try:
            d = datetime.strptime(s, f)
            if d.tzinfo: d = d.astimezone(TZ)
            return d.date().isoformat()
        except ValueError:
            continue
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m: return m.group(0)
    return fallback


def col(header, *names):
    low = {h.strip().lower(): i for i, h in enumerate(header)}
    for n in names:
        if n.lower() in low: return low[n.lower()]
    for n in names:
        for h, i in low.items():
            if n.lower() in h: return i
    return None


def classify(tt, at):
    t, a = (tt or "").lower(), (at or "").lower()
    if "commission" in a or "commission" in t: return "commission"
    if "refund" in t or "return" in t:
        if "tax" in a or "shipping" in a or "shipment" in a: return "ignore"
        if "product" in a or "item" in a or a in ("", "price"): return "refund_product"
    if "product price" in a or a in ("product", "item price", "price"): return "product"
    if "tax" in a or "shipping" in a or "shipment" in a: return "ignore"
    if re.search(r"advertis|sponsored|wpa|\bads?\b|marketing", a + " " + t): return "ads"
    return "other_fee"


def parse_recon(text, report_date):
    """-> (po_fees, refunds, nonorder_fees, product_by_po, types_seen, rows). All amounts as COSTS (+ = cost to us) except refunds/product (+)."""
    rd = list(csv.reader(io.StringIO(text)))
    if not rd: return None
    header = rd[0]
    i_tt, i_at, i_amt = col(header, "Transaction Type"), col(header, "Amount Type"), col(header, "Amount")
    i_po = col(header, "Purchase Order #", "Purchase Order", "PO #")
    i_ts = col(header, "Transaction Posted Timestamp", "Transaction Date", "Posted")
    i_rate = col(header, "Commission Rate")
    i_ord = col(header, "Order Date", "Order Placed", "Purchase Order Date", "Order Created", "Order Time")
    i_ship = col(header, "Shipped Date Time", "Shipped Date", "Ship Date")
    i_qty = col(header, "Ship Qty", "Shipped Qty", "Quantity")
    if i_tt is None or i_amt is None:
        return {"error": f"unexpected columns: {header[:12]}"}
    po_fees = collections.defaultdict(lambda: {"commission": 0.0, "rate": None})
    refunds, nonorder, product_by_po = [], [], collections.defaultdict(float)
    sales_by_po = {}   # PO -> {"g": product price total, "u": units, "d": earliest date, "b": date basis}
    types = collections.defaultdict(lambda: [0, 0.0])
    n = 0
    for row in rd[1:]:
        if len(row) <= i_amt: continue
        n += 1
        tt = row[i_tt]; at = row[i_at] if i_at is not None and len(row) > i_at else ""
        amt = num(row[i_amt])
        po = (row[i_po].strip() if i_po is not None and len(row) > i_po else "")
        ts = parse_ts(row[i_ts] if i_ts is not None and len(row) > i_ts else "", "")
        k = classify(tt, at)
        key = f"{tt.strip()}|{at.strip()}|{k}"
        types[key][0] += 1; types[key][1] += amt
        if k == "ignore": continue
        if k == "commission":
            if po:
                po_fees[po]["commission"] += -amt
                rate = num(row[i_rate]) if i_rate is not None and len(row) > i_rate else 0
                if rate and amt < 0: po_fees[po]["rate"] = rate
            else: nonorder.append((ts, "commission", -amt))
        elif k == "product":
            if po and amt > 0: product_by_po[po] += amt
            if po:
                cell = lambda i: row[i] if i is not None and len(row) > i else ""
                cands = [(parse_ts(cell(i_ord), ""), "order_date"), (parse_ts(cell(i_ship), ""), "shipped"), (ts, "posted")]
                d, basis = next(((dd, b) for dd, b in cands if dd), ("", "posted"))
                e = sales_by_po.setdefault(po, {"g": 0.0, "u": 0, "d": d or ts, "b": basis})
                e["g"] += amt
                if amt > 0: e["u"] += max(1, int(num(cell(i_qty), 1))) if cell(i_qty).strip() else 1
                if d and (not e["d"] or d < e["d"]): e["d"], e["b"] = d, basis
        elif k == "refund_product":
            refunds.append((po, ts, abs(amt)))  # refund rows carry negative amounts -> positive refund
        else:
            nonorder.append((ts, k, -amt, po))
    return {"po_fees": po_fees, "refunds": refunds, "nonorder": nonorder, "product_by_po": product_by_po, "sales_by_po": sales_by_po,
            "types": types, "rows": n, "columns": [h.strip() for h in header]}


def fetch_recon(w, state, force_all=False):
    """Download recon CSVs not seen yet (state['recon_done'] keeps what was ingested), return summary + new data."""
    st, r = w.get("/v3/report/reconreport/availableReconFiles?reportVersion=v1")
    info = {"ok": st == 200, "available": 0, "fetched": 0, "errors": 0, "error": None}
    if st != 200 or not isinstance(r, dict):
        info["error"] = f"availableReconFiles HTTP {st} {str(r)[:160]}"; return info, []
    dates = r.get("availableApReportDates") or r.get("availableDates") or []
    dates = [str(d) for d in dates]
    info["available"] = len(dates)
    done = state.setdefault("recon_done", {})
    todo = [d for d in dates if d not in done]
    new = []
    for d in todo:
        q = urllib.parse.urlencode({"reportDate": d, "reportVersion": "v1"})
        st2, body = w.get(f"/v3/report/reconreport/reconFile?{q}", binary=True, headers={"Accept": "application/octet-stream"})
        if st2 != 200 or not isinstance(body, (bytes, bytearray)):
            info["errors"] += 1; log(f"recon {d}: HTTP {st2}"); continue
        if body[:2] == b"PK":  # zipped variant
            import zipfile
            z = zipfile.ZipFile(io.BytesIO(body)); body = b"\n".join(z.read(n) for n in z.namelist() if n.lower().endswith(".csv"))
        text = body.decode("utf-8-sig", errors="replace")
        p = parse_recon(text, d)
        if not p or "error" in p:
            info["errors"] += 1; log(f"recon {d}: {p}"); continue
        mm, dd, yy = d[:2], d[2:4], d[4:]
        p["report_date"] = f"{yy}-{mm}-{dd}"
        new.append(p); done[d] = {"rows": p["rows"], "po": len(p["po_fees"])}
        info["fetched"] += 1
        time.sleep(0.8)
    return info, new


# ---------------------------------------------------------------- aggregate
def merge_state(state, orders_raw, new_recon, now_la):
    orders = state.setdefault("orders", {})
    fees = state.setdefault("fees_by_po", {})       # PO -> {"c": commission cost, "rate": last rate}
    refunds = state.setdefault("refund_events", [])  # [PO, date, amount]
    nonorder = state.setdefault("nonorder_fees", [])  # [date, kind, cost, PO]
    charge_types = collections.Counter()
    for o in orders_raw:
        row = order_row(o)
        if row: orders[str(o["purchaseOrderId"])] = row
        for l in ((o.get("orderLines") or {}).get("orderLine")) or []:
            for c in ((l.get("charges") or {}).get("charge")) or []: charge_types[c.get("chargeType")] += 1
    calib = collections.Counter()
    for p in new_recon:
        for po, f in p["po_fees"].items():
            e = fees.setdefault(po, {"c": 0.0, "rate": None})
            e["c"] = r2(e["c"] + f["commission"]);
            if f["rate"]: e["rate"] = f["rate"]
        for po, ts, a in p["refunds"]:
            refunds.append([po, ts or p["report_date"], r2(a)])
        for it in p["nonorder"]:
            ts, kind, cost = it[0], it[1], it[2]; po = it[3] if len(it) > 3 else ""
            nonorder.append([ts or p["report_date"], kind, r2(cost), po])
        ro = state.setdefault("recon_orders", {})
        for po, e in p["sales_by_po"].items():
            if e["g"] <= 0: continue
            cur = ro.get(po)
            if cur is None: ro[po] = {"d": e["d"], "g": r2(e["g"]), "u": e["u"], "b": e["b"]}
            else:
                cur["g"] = r2(cur["g"] + e["g"]); cur["u"] += e["u"]
                if e["d"] and (not cur["d"] or e["d"] < cur["d"]): cur["d"], cur["b"] = e["d"], e["b"]
        for po, amt in p["product_by_po"].items():
            o = orders.get(po)
            if o and o["u"] > 1:
                if abs(amt - o["g"]) < 0.02: calib["line_total"] += 1
                elif abs(amt - o["g"] * o["u"]) < 0.02: calib["per_unit"] += 1
                else: calib["other"] += 1
    return charge_types, calib


def build_output(state, status, recon_info, charge_types, calib, now):
    api_orders = state["orders"]; fees = state.get("fees_by_po", {})
    orders = {}
    basis = collections.Counter()
    for po, e in state.get("recon_orders", {}).items():   # orders older than the API window, rebuilt from the recon report
        if po in api_orders or not e.get("d"): continue
        orders[po] = {"d": e["d"], "ms": 0, "g": e["g"], "sh": 0.0, "tx": 0.0, "u": max(1, e["u"]), "ln": 1, "cx": 0, "rf": 0, "st": "recon", "sold": True}
        basis[e.get("b", "posted")] += 1
    n_recon = len(orders)
    orders.update(api_orders)
    per_unit = state.get("calib", {}).get("per_unit", 0) > state.get("calib", {}).get("line_total", 0)
    # fee rate measured on settled orders (those with a commission line in recon), net-sales weighted
    s_net = s_fee = 0.0
    cutoff = (now - timedelta(days=75)).date().isoformat()
    for po, o in orders.items():
        if not o["sold"]: continue
        f = fees.get(po)
        if f and f["c"] > 0 and o["d"] >= cutoff:
            s_net += o["g"]; s_fee += f["c"]
    rate = (s_fee / s_net) if s_net > 0 else 0.0
    if s_net == 0:  # no recent settled orders -> use all
        for po, o in orders.items():
            f = fees.get(po)
            if o["sold"] and f and f["c"] > 0: s_net += o["g"]; s_fee += f["c"]
        rate = (s_fee / s_net) if s_net > 0 else 0.0

    od = collections.defaultdict(lambda: collections.defaultdict(float))
    for po, o in orders.items():
        d = od[o["d"]]
        if not o["sold"]:
            d["cancelled_orders"] += 1; continue
        g = o["g"] * (o["u"] if per_unit and o["u"] > 1 else 1)
        d["orders_count"] += 1; d["units"] += o["u"]; d["gross_sales"] += g; d["net_sales"] += g
        d["shipping_charged"] += o["sh"]; d["tax_collected"] += o["tx"]
        f = fees.get(po)
        if f is not None:
            d["settled_orders"] += 1; d["fees_commission"] += f["c"]; d["net_sales_settled"] += g
        else:
            d["unsettled_orders"] += 1; d["net_sales_unsettled"] += g
    orders_daily = {}
    for k in sorted(od):
        v = od[k]
        row = {kk: (int(vv) if kk in ("orders_count", "units", "cancelled_orders", "settled_orders", "unsettled_orders") else r2(vv)) for kk, vv in v.items()}
        for kk in ("orders_count", "units", "cancelled_orders", "settled_orders", "unsettled_orders", "gross_sales", "net_sales", "fees_commission",
                   "net_sales_settled", "net_sales_unsettled", "shipping_charged", "tax_collected"):
            row.setdefault(kk, 0)
        row["fees_total"] = row["fees_commission"]
        orders_daily[k] = row
    refunds_daily = collections.defaultdict(lambda: {"refund_gross": 0.0, "refund_orders": 0})
    for po, ts, a in state.get("refund_events", []):
        refunds_daily[ts]["refund_gross"] += a; refunds_daily[ts]["refund_orders"] += 1
    refunds_daily = {k: {"refund_gross": r2(v["refund_gross"]), "refund_orders": v["refund_orders"]} for k, v in sorted(refunds_daily.items())}
    other_daily = collections.defaultdict(lambda: collections.defaultdict(float))
    for ts, kind, cost, po in state.get("nonorder_fees", []):
        if kind == "commission" and po in orders: continue
        other_daily[ts][kind] += cost
    other_fees_daily = {k: {kk: r2(vv) for kk, vv in v.items()} for k, v in sorted(other_daily.items())}
    return {
        "schema": SCHEMA, "script_version": SCRIPT_VERSION, "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "timezone": str(TZ),
        "orders_daily": orders_daily, "refunds_daily": refunds_daily, "other_fees_daily": other_fees_daily,
        "meta": {
            "orders_status": status, "recon": recon_info, "orders_total": sum(1 for o in orders.values() if o["sold"]),
            "orders_settled": sum(1 for po, o in orders.items() if o["sold"] and po in fees),
            "fee_rates_settled": {"commission": round(rate, 5), "net_sales_basis": r2(s_net)},
            "charge_types": dict(charge_types), "product_charge_is_per_unit": per_unit, "calib": state.get("calib", {}),
            "recon_types": {k: [v[0], r2(v[1])] for k, v in sorted(state.get("recon_types", {}).items())},
            "recon_files_ingested": len(state.get("recon_done", {})),
            "orders_from_api": sum(1 for o in api_orders.values() if o["sold"]), "orders_from_recon": n_recon, "recon_orders_basis": dict(basis),
            "recon_columns": state.get("recon_columns", []),
            "first_order_date": min((o["d"] for o in orders.values() if o["sold"]), default=None),
        },
    }


def load_state():
    try:
        with open(DATA_FILE, encoding="utf-8") as f: d = json.load(f)
        return d.get("_state") or {}
    except (OSError, ValueError):
        return {}


def main():
    if not CID or not SEC:
        log("missing WALMART_CLIENT_ID / WALMART_CLIENT_SECRET"); sys.exit(1)
    now = datetime.now(timezone.utc)
    state = load_state()
    if state.get("ver") != SCRIPT_VERSION:   # new script version: re-ingest everything so old and new logic never mix
        keep = {k: state[k] for k in () if k in state}
        state = {"ver": SCRIPT_VERSION, **keep}
    w = Walmart()
    try: w.auth()
    except RuntimeError as e:
        log(str(e)); sys.exit(1)
    log(f"{SCRIPT_VERSION} · history from {HISTORY_START} · window {WINDOW_DAYS}d")

    first = not state.get("orders")
    if BACKFILL_START:
        start = max(datetime.combine(BACKFILL_START, datetime.min.time(), tzinfo=timezone.utc), now - timedelta(days=API_MAX_DAYS))
        end = datetime.combine(BACKFILL_END or now.date(), datetime.max.time(), tzinfo=timezone.utc).replace(microsecond=0)
        end = min(end, now)
    elif first:
        start, end = max(datetime.combine(HISTORY_START, datetime.min.time(), tzinfo=timezone.utc), now - timedelta(days=API_MAX_DAYS)), now
    else:
        start, end = now - timedelta(days=WINDOW_DAYS), now
    orders_raw, ost = fetch_orders(w, start, end)
    log(f"orders fetched {len(orders_raw)} ({start:%Y-%m-%d} -> {end:%Y-%m-%d}) ok={ost['ok']} {ost.get('error') or ''}")

    recon_info, new_recon = fetch_recon(w, state)
    log(f"recon: available={recon_info['available']} fetched={recon_info['fetched']} errors={recon_info['errors']} {recon_info.get('error') or ''}")

    charge_types, calib = merge_state(state, orders_raw, new_recon, now)
    rt = state.setdefault("recon_types", {})
    for p in new_recon:
        if p.get("columns") and not state.get("recon_columns"): state["recon_columns"] = p["columns"]
        for k, v in p["types"].items():
            e = rt.setdefault(k, [0, 0.0]); e[0] += v[0]; e[1] += v[1]
    c = state.setdefault("calib", {})
    for k, v in calib.items(): c[k] = c.get(k, 0) + v

    out = build_output(state, ost, recon_info, charge_types, calib, now)
    if not ost["ok"] and not state.get("orders"):
        log("orders failed and no cached orders - not writing"); sys.exit(1)
    out["_state"] = state
    os.makedirs(os.path.dirname(DATA_FILE) or ".", exist_ok=True)
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f: json.dump(out, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    os.replace(tmp, DATA_FILE)
    m = out["meta"]
    log(f"wrote {DATA_FILE}: {m['orders_total']} sold orders ({m['orders_from_api']} API + {m['orders_from_recon']} rebuilt from recon, first {m['first_order_date']}), {m['orders_settled']} with real fees, commission rate {m['fee_rates_settled']['commission']*100:.2f}%")
    log(f"recon columns: {m['recon_columns']}")
    log(f"recon order date basis: {m['recon_orders_basis']}")
    for k, v in list(m["recon_types"].items())[:25]: log(f"  recon type {k}: n={v[0]} sum={v[1]}")
    if not ost["ok"]: sys.exit(2)


if __name__ == "__main__":
    main()
