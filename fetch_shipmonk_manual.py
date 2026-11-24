#!/usr/bin/env python3
"""fetch_shipmonk_manual.py v1.1 - ShipMonk "Manual Store" orders with their product SKUs -> data/shipmonk_manual_orders.csv
                                 + data/nonrevenue_shipments.json (v1.1: the same orders grouped per day for the dashboard)

The Manual Store holds the orders typed or uploaded into ShipMonk by hand: influencer / creator
shipments, TikTok Shop samples, reships. They have no sales-channel order behind them, so the units
they take out of stock are not in any sales feed. This file lists each of them with the product SKUs
and quantities ShipMonk shipped, so the product cost can be booked from the lots (no estimate).

One row per shipped order: order_number, order_key, status, ordered_day, shipped_day, warehouse,
items ("SKUxQTY;SKUxQTY" = product lines ShipMonk fulfilled), packaging ("SKUxQTY" = boxes it picked),
units, shipping_cost, pick_pack_cost, packaging_cost (ShipMonk's own per-order charges, USD).
No customer name, address, e-mail or phone is read or written (public repo).

First run (no output file yet) or MANUAL_START set: every order shipped since that day (default
2025-01-01). Later runs: the last MANUAL_ROLLING_DAYS (default 60) days, merged into the file.
Reuses fetch_shipmonk.py for the HTTP client. Secret (name only): SHIPMONK_API_KEY.

v1.1: data/nonrevenue_shipments.json = the orders that carry NO revenue, per shipped day and category:
  daily{YYYY-MM-DD:{category:{o: orders, u: units, fee: ShipMonk charges USD, sku:{SKU: units}}}}
  categories: influencer (INF...), tiktok_sample (a TikTok order id that is not a paid order in
  data/tiktok_shop.json), campaign (HLW, AGENCY, ADCRATE, CRTR, GOODO, RAFFLE, FLAPPY), reship (a marketplace
  order id sent again / REP), other (CAN, TEST, ...). Left out, counted in meta.excluded: Walmart orders typed
  in by hand and paid TikTok orders (their units are already in the sales feeds), stock transfers / returns to
  the vendor. The dashboard prices the units with the receipt-lot cost of the shipping day and books them as
  marketing (US GAAP: products given away to promote = advertising expense). No order number is written.
  `python fetch_shipmonk_manual.py --build-only` rebuilds the JSON from the CSV without calling ShipMonk.
"""
import csv
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import fetch_shipmonk as fs

VERSION = "1.1"
OUT = os.environ.get("MANUAL_OUT", "data/shipmonk_manual_orders.csv")
START = (os.environ.get("MANUAL_START", "") or "").strip()
ROLLING_DAYS = int(os.environ.get("MANUAL_ROLLING_DAYS", "60") or 60)
STORE_WORD = (os.environ.get("MANUAL_STORE_WORD", "manual") or "manual").lower()
OUT_JSON = os.environ.get("NONREV_OUT", "data/nonrevenue_shipments.json")
TIKTOK_JSON = os.environ.get("NONREV_TIKTOK", "data/tiktok_shop.json")
CAMPAIGN_RE = re.compile(r"^#?(HLW|AGENCY|ADCRATE|CRTR|GOODO|RAFFLE|FLAPPY)", re.I)
MARKET_ID_RE = re.compile(r"^(\d{3}-\d{7}-\d{7}|2000\d{10,12}|\d{17,19})")   # Amazon / Walmart / TikTok order id
COLS = ["order_number", "order_key", "status", "ordered_day", "shipped_day", "warehouse", "items", "packaging",
        "units", "shipping_cost", "pick_pack_cost", "packaging_cost"]


def log(m):
    print(f"[shipmonk-manual] {m}", flush=True)


def usd(node):
    amount, cur = fs.money(node)
    if amount is None:
        return 0.0
    if cur and cur != "USD":
        rate = fs.FX_TO_USD.get(cur)
        if rate is not None:
            amount *= rate
    return round(amount, 2)


def row_of(o, tz):
    store = (o.get("store") or {}).get("name") or ""
    if STORE_WORD not in store.lower():
        return None
    shipped = fs.local_day(o.get("shipped_at"), tz)
    if not shipped:
        return None
    items, packaging, units = {}, {}, 0
    for it in (o.get("items") or []):
        q = it.get("fulfilled_quantity")
        if q is None:
            q = it.get("quantity") or 0
        q = int(q or 0)
        sku = str(it.get("sku") or "").strip()
        if q <= 0 or not sku:
            continue
        if (it.get("source") or "") == "packaging":
            packaging[sku] = packaging.get(sku, 0) + q
        else:
            items[sku] = items.get(sku, 0) + q
            units += q
    costs = o.get("order_costs") or {}
    wh = o.get("warehouse") or {}
    return {
        "order_number": str(o.get("order_number") or ""), "order_key": str(o.get("order_key") or o.get("order_number") or ""),
        "status": (o.get("order_status") or "").lower(), "ordered_day": fs.local_day(o.get("ordered_at"), tz) or "",
        "shipped_day": shipped, "warehouse": wh.get("identifier") or wh.get("name") or "",
        "items": ";".join(f"{k}x{v}" for k, v in sorted(items.items())),
        "packaging": ";".join(f"{k}x{v}" for k, v in sorted(packaging.items())), "units": units,
        "shipping_cost": usd(costs.get("estimated_shipping_related_charges")),
        "pick_pack_cost": usd(costs.get("estimated_pick_and_pack_charges")),
        "packaging_cost": usd(costs.get("estimated_packaging_material_charges")),
    }


def classify(number, tiktok_paid):
    """(category, counted) of a Manual Store order by its order number; counted False = not a give-away."""
    n = (number or "").strip()
    u = n.upper()
    if re.fullmatch(r"\d{17,19}", n):
        return ("tiktok_paid", False) if n in tiktok_paid else ("tiktok_sample", True)
    if u.startswith("WAL"):
        return ("walmart", False)
    if u.startswith(("WFS", "SP-", "INV-")):
        return ("transfer", False)
    if u.startswith("INF"):
        return ("influencer", True)
    if CAMPAIGN_RE.match(n):
        return ("campaign", True)
    if MARKET_ID_RE.match(n) or "REP" in u or "RESHIP" in u:
        return ("reship", True)
    return ("other", True)


def parse_items(text):
    out = {}
    for part in (text or "").split(";"):
        m = re.fullmatch(r"(.+)x(\d+)", part.strip())
        if m:
            out[m.group(1)] = out.get(m.group(1), 0) + int(m.group(2))
    return out


def build_nonrevenue(rows):
    """rows of the CSV -> the per-day JSON the dashboard reads. Pure function of the CSV + the TikTok order ids."""
    tiktok_paid, tiktok_note = set(), "data/tiktok_shop.json not found - every TikTok order id counts as a sample"
    try:
        with open(TIKTOK_JSON, encoding="utf-8") as fh:
            tiktok_paid = {str(k) for k in (json.load(fh).get("orders") or {})}
        tiktok_note = f"{len(tiktok_paid)} paid TikTok orders known"
    except (OSError, ValueError) as e:
        log(f"WARNING: {TIKTOK_JSON} not readable ({e}) - TikTok paid orders cannot be told from samples")
    daily, totals, excluded = {}, {}, {}
    for r in rows:
        cat, counted = classify(r.get("order_number"), tiktok_paid)
        if not counted:
            excluded[cat] = excluded.get(cat, 0) + 1
            continue
        day = r.get("shipped_day") or ""
        if not day:
            continue
        items = parse_items(r.get("items"))
        fee = sum(float(r.get(k) or 0) for k in ("shipping_cost", "pick_pack_cost", "packaging_cost"))
        c = daily.setdefault(day, {}).setdefault(cat, {"o": 0, "u": 0, "fee": 0.0, "sku": {}})
        c["o"] += 1
        c["fee"] += fee
        for sku, q in items.items():
            c["sku"][sku] = c["sku"].get(sku, 0) + q
            c["u"] += q
        t = totals.setdefault(cat, {"o": 0, "u": 0, "fee": 0.0})
        t["o"] += 1
        t["u"] += sum(items.values())
        t["fee"] += fee
    for cats in daily.values():
        for c in cats.values():
            c["fee"] = round(c["fee"], 2)
            c["sku"] = dict(sorted(c["sku"].items()))
    for t in totals.values():
        t["fee"] = round(t["fee"], 2)
    days = sorted(daily)
    return {
        "schema": 1, "script_version": VERSION, "source": "shipmonk_manual_store",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "timezone": fs.TZ_NAME, "currency": "USD",
        "meta": {"basis": "shipped day; units = product lines ShipMonk fulfilled; fee = ShipMonk shipping + pick & pack + packaging of those orders (already inside the ShipMonk cost lines)",
                 "first_day": days[0] if days else None, "last_day": days[-1] if days else None,
                 "orders": sum(t["o"] for t in totals.values()), "totals": dict(sorted(totals.items())),
                 "excluded": dict(sorted(excluded.items())), "tiktok": tiktok_note},
        "daily": {d: dict(sorted(daily[d].items())) for d in days},
    }


def write_nonrevenue(rows):
    out = build_nonrevenue(rows)
    os.makedirs(os.path.dirname(OUT_JSON) or ".", exist_ok=True)
    tmp = OUT_JSON + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    os.replace(tmp, OUT_JSON)
    m = out["meta"]
    log(f"wrote {OUT_JSON}: {m['orders']} non-revenue orders on {len(out['daily'])} days ({m['first_day']} -> {m['last_day']}); "
        f"left out {m['excluded']}")


def main():
    if "--build-only" in sys.argv:
        with open(OUT, newline="", encoding="utf-8") as f:
            write_nonrevenue(list(csv.DictReader(f)))
        return
    if not fs.API_KEY:
        log("missing SHIPMONK_API_KEY"); sys.exit(1)
    tz = ZoneInfo(fs.TZ_NAME)
    have = {}
    if os.path.exists(OUT):
        with open(OUT, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                have[r["order_key"]] = r
    now = datetime.now(timezone.utc)
    if START or not have:
        start = datetime.strptime(START or "2025-01-01", "%Y-%m-%d").replace(tzinfo=timezone.utc)
    else:
        start = now - timedelta(days=ROLLING_DAYS)
    log(f"v{VERSION}: shipped orders from {start.date()} to {now.date()} ({len(have)} rows already in the file)")
    client = fs.Client(fs.API_KEY)
    seen = pages = found = 0
    cur = start
    while cur < now:
        nxt = min(cur + timedelta(days=fs.CHUNK_DAYS), now)
        page = 1
        while True:
            data = client.get("/v1/integrations/orders-list", {"shippedAtStart": fs.iso_z(cur), "shippedAtEnd": fs.iso_z(nxt),
                                                              "page": page, "pageSize": fs.PAGE_SIZE, "sortOrder": "ASC"})
            orders = ((data.get("data") or {}).get("orders") or [])
            pages += 1
            for o in orders:
                seen += 1
                r = row_of(o, tz)
                if r:
                    have[r["order_key"]] = r
                    found += 1
            if len(orders) < fs.PAGE_SIZE or page >= 400:
                break
            page += 1
        if pages % 50 < 2:
            log(f"  up to {nxt.date()}: {seen} orders read, {found} manual-store orders")
        cur = nxt
    rows = sorted(have.values(), key=lambda r: (r["shipped_day"], r["order_number"]))
    if not rows:
        log("no manual-store orders found - not writing"); sys.exit(1)
    os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    os.replace(tmp, OUT)
    log(f"wrote {OUT}: {len(rows)} orders ({found} read this run from {seen} orders, {pages} pages), {rows[0]['shipped_day']} -> {rows[-1]['shipped_day']}")
    try:
        write_nonrevenue(rows)
    except Exception as e:            # the CSV is the source of truth; never lose it because of the summary
        log(f"WARNING: {OUT_JSON} not written: {type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
