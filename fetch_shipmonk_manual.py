#!/usr/bin/env python3
"""fetch_shipmonk_manual.py v1.0 - ShipMonk "Manual Store" orders with their product SKUs -> data/shipmonk_manual_orders.csv

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
"""
import csv
import os
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import fetch_shipmonk as fs

VERSION = "1.0"
OUT = os.environ.get("MANUAL_OUT", "data/shipmonk_manual_orders.csv")
START = (os.environ.get("MANUAL_START", "") or "").strip()
ROLLING_DAYS = int(os.environ.get("MANUAL_ROLLING_DAYS", "60") or 60)
STORE_WORD = (os.environ.get("MANUAL_STORE_WORD", "manual") or "manual").lower()
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


def main():
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


if __name__ == "__main__":
    main()
