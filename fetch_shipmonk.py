#!/usr/bin/env python3
"""
Cattasaurus - ShipMonk (3PL) fulfillment cost fetcher.

Runs on a schedule (GitHub Actions) completely independently of Claude. Pulls every
order ShipMonk received inside a trailing window from the ShipMonk public API
(https://api.shipmonk.com, header Api-Key) and books each order's fulfillment charges
on the day the order was PLACED (ordered_at, in REPORT_TIMEZONE - the same calendar
every other P&L source uses). That matches the dashboard's revenue, which is recognised
on the order date, so an order's revenue and its fulfillment cost always land on the same
day - including orders that are still waiting to ship (ShipMonk already estimates their
charges from its rate card; the figure is refreshed every run as they ship). A second
series keyed by ship date is kept for reconciling ShipMonk's weekly invoices, and a
per-order CSV is written so any single Shopify / Amazon FBM order can be checked.

What ShipMonk gives per order (order_costs, all "estimated" by ShipMonk's own rate
cards - the weekly invoice can differ by small adjustments):
  estimated_shipping_related_charges   -> shipping_cost  (postage / carrier charges)
  estimated_pick_and_pack_charges      -> pick_pack_cost (fulfillment labour)
  estimated_packaging_material_charges -> packaging_cost (boxes, mailers, dunnage)
Not in the API (only on invoices): storage, receiving, returns processing, special
projects, account minimums. Those stay $0 here until invoice exports are wired in.

Credentials come ONLY from environment variables (GitHub Actions Secrets).
Nothing is ever logged or written to the repo except the aggregated JSON - no customer
names, addresses or emails are read from the response beyond what is aggregated.

Required env vars:
  SHIPMONK_API_KEY         Account Settings > General Settings > Integration API Keys

Optional env vars:
  SHIPMONK_BASE_URL        default https://api.shipmonk.com (sandbox: https://sandbox.shipmonk.dev)
  REPORT_TIMEZONE          default America/Los_Angeles
  WINDOW_DAYS              trailing days to (re)fetch, default 45
  OUTPUT_PATH              default data/shipmonk.json
  PAGE_SIZE                orders per request, default 100 (API max)
  CHUNK_DAYS               shipped_at window per query, default 7 (the API caps filtered
                           queries at 10,000 orders, so the window is walked in chunks)
  SHIPMONK_STORE_IDS       comma-separated ShipMonk store ids to INCLUDE (default: all)
  SHIPMONK_ORDER_TYPES     comma-separated order types to count as fulfillment cost,
                           default "direct_to_consumer,amazon,retail,unknown" ("unknown" =
                           orders ShipMonk returns with no order_type - legacy/manual D2C orders
                           that it still charges for; transfers, disposals, work orders etc.
                           are listed in meta but not costed)
  SHIPMONK_FX_TO_USD       JSON map of rates for charges ShipMonk states in another currency
                           (Toronto warehouse bills in CAD), default {"CAD": 0.73}; native amounts
                           are kept per day in foreign_cost{CUR: amount} so the invoice rate can be
                           checked, and every order's cost_currency is in the CSV
  SHIPMONK_COST_BASIS      "ordered" (default: book on the order date, shipped or not)
                           or "shipped" (only shipped orders, on the ship date)
  ORDERS_CSV_DIR           per-order detail CSVs, one file per month (data/shipmonk_orders/
                           YYYY-MM.csv, by P&L day); set to "" to skip
  HISTORY_START            keep days from this date on (default 2025-01-01); older days in the
                           previous file are dropped
  BACKFILL_START/_END      one-off run over a past range (YYYY-MM-DD, END defaults to today):
                           the range is fetched and merged into the same file/CSVs

Output (per day, shop-calendar days, positive numbers = cost):
  daily          keyed by the basis day (order date by default):
                 orders, orders_shipped, orders_unshipped, orders_onhold (subset of unshipped:
                 order_status onHold - stock-outs, address problems...), units, packages,
                 shipping_cost, packaging_cost, pick_pack_cost, total_cost, cost_missing_orders
                 (orders ShipMonk had no estimate for yet),
                 by_store{name:{orders,units,shipping_cost,packaging_cost,pick_pack_cost,total_cost}},
                 by_type{order_type:{...}}, by_carrier{carrier:{orders,shipping_cost}}
  daily_shipped  same fields keyed by SHIP date, shipped orders only (invoice reconciliation)
"""
import email.utils
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None

SCRIPT_VERSION = "1.3.1"
SCHEMA = 1

API_KEY = os.environ.get("SHIPMONK_API_KEY", "").strip()
BASE_URL = os.environ.get("SHIPMONK_BASE_URL", "https://api.shipmonk.com").strip().rstrip("/")
TZ_NAME = os.environ.get("REPORT_TIMEZONE", "America/Los_Angeles").strip() or "America/Los_Angeles"
WINDOW_DAYS = int(os.environ.get("WINDOW_DAYS", "45"))
OUTPUT_PATH = os.environ.get("OUTPUT_PATH", "data/shipmonk.json")
PAGE_SIZE = max(1, min(100, int(os.environ.get("PAGE_SIZE", "100"))))
CHUNK_DAYS = max(1, int(os.environ.get("CHUNK_DAYS", "7")))
STORE_IDS = {s.strip() for s in os.environ.get("SHIPMONK_STORE_IDS", "").split(",") if s.strip()}
COSTED_TYPES = {s.strip() for s in os.environ.get("SHIPMONK_ORDER_TYPES", "direct_to_consumer,amazon,retail,unknown").split(",") if s.strip()}
COST_BASIS = os.environ.get("SHIPMONK_COST_BASIS", "ordered").strip().lower() or "ordered"
ORDERS_CSV_DIR = os.environ.get("ORDERS_CSV_DIR", "data/shipmonk_orders").strip().rstrip("/")
FILTER_CAP = 10000   # ShipMonk: "If filters are used, this endpoint will return a maximum of 10,000 orders."
try:
    FX_TO_USD = {str(k).upper(): float(v) for k, v in json.loads(os.environ.get("SHIPMONK_FX_TO_USD", "") or '{"CAD": 0.73}').items()}
except (ValueError, TypeError, AttributeError):
    FX_TO_USD = {"CAD": 0.73}
STOP_AFTER_OLD_PAGES = 3   # unfiltered listing is newest-first; stop after this many whole pages older than the window

DAILY_FIELDS = ["orders", "orders_shipped", "orders_unshipped", "orders_onhold", "units", "packages", "shipping_cost", "packaging_cost", "pick_pack_cost", "total_cost", "cost_missing_orders"]
MONEY_FIELDS = ["shipping_cost", "packaging_cost", "pick_pack_cost", "total_cost"]
GROUP_FIELDS = ["orders", "units", "shipping_cost", "packaging_cost", "pick_pack_cost", "total_cost"]


def log(msg):
    print(f"[shipmonk] {msg}", file=sys.stderr, flush=True)


def new_bucket():
    d = {f: 0 for f in DAILY_FIELDS}
    d["by_store"] = {}
    d["by_type"] = {}
    d["by_carrier"] = {}
    d["foreign_cost"] = {}   # native amounts of charges stated in another currency, before FX
    return d


def money(node):
    """MoneyOutput {amount, currency} -> (float amount, currency) ; None -> (None, None)."""
    if node is None:
        return None, None
    if isinstance(node, (int, float)):
        return float(node), None
    try:
        return float(node.get("amount")), node.get("currency")
    except (AttributeError, TypeError, ValueError):
        return None, None


def local_day(iso_ts, tz):
    if not iso_ts:
        return None
    try:
        dt = datetime.fromisoformat(str(iso_ts).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(tz).strftime("%Y-%m-%d")


# ---------------------------------------------------------------- history (shared block)
# Every fetcher keeps ONE file per source in the repo. A normal run refetches only the
# trailing WINDOW_DAYS and keeps every older day from the previous copy of the file, so
# data/<source>.json grows into a full history (HISTORY_START -> today). A one-off
# BACKFILL_START/BACKFILL_END run (workflow_dispatch inputs) fetches an arbitrary past
# range and merges it the same way - run it in a few chunks to build 2025 -> now.
HISTORY_START = os.environ.get("HISTORY_START", "2025-01-01").strip() or "2025-01-01"
BACKFILL_START = os.environ.get("BACKFILL_START", "").strip()
BACKFILL_END = os.environ.get("BACKFILL_END", "").strip()


def history_previous(path):
    """The copy of the output file already in the repo checkout (None on first run / bad JSON)."""
    try:
        with open(path) as f:
            prev = json.load(f)
        return prev if isinstance(prev, dict) and isinstance(prev.get("daily"), dict) else None
    except (OSError, ValueError):
        return None


def history_merge(previous, fetched_daily, fetched_start, fetched_end, key="daily"):
    """Days from the previous file that lie outside [fetched_start, fetched_end] (and on/after
    HISTORY_START) survive; the freshly fetched days replace everything inside the range."""
    merged = {}
    for day, row in ((previous or {}).get(key) or {}).items():
        if day >= HISTORY_START and (day < fetched_start or day > fetched_end):
            merged[day] = row
    merged.update(fetched_daily)
    return dict(sorted(merged.items()))


def history_meta(previous, mode, fetched_start, fetched_end, merged_daily, today_key):
    """Coverage report for the dashboard/sync logs: which days between HISTORY_START and today
    are still missing, and which backfill ranges have been run so far."""
    from datetime import date as _date
    backfills = list(((previous or {}).get("meta") or {}).get("history", {}).get("backfills") or [])
    if mode == "backfill":
        backfills.append({"start": fetched_start, "end": fetched_end, "run_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")})
        backfills = backfills[-60:]
    missing = []
    try:
        y, m, d = (int(x) for x in HISTORY_START.split("-"))
        cur = _date(y, m, d)
        y, m, d = (int(x) for x in today_key.split("-"))
        end = _date(y, m, d)
        while cur <= end:
            k = cur.isoformat()
            if k not in merged_daily:
                missing.append(k)
            cur += timedelta(days=1)
    except ValueError:
        pass
    return {
        "start": HISTORY_START,
        "mode": mode,
        "fetched": {"start": fetched_start, "end": fetched_end},
        "first_day": min(merged_daily) if merged_daily else None,
        "last_day": max(merged_daily) if merged_daily else None,
        "days": len(merged_daily),
        "missing_count": len(missing),
        "missing_days": missing[:60],
        "backfills": backfills,
    }


def backfill_range(today_key):
    """(start, end) 'YYYY-MM-DD' when this run is a backfill, else None. END defaults to today;
    both are validated so a typo in the workflow input cannot wipe the file."""
    if not BACKFILL_START:
        return None
    try:
        s = datetime.strptime(BACKFILL_START, "%Y-%m-%d")
        e = datetime.strptime(BACKFILL_END or today_key, "%Y-%m-%d")
    except ValueError:
        log(f"BACKFILL_START/BACKFILL_END must be YYYY-MM-DD (got {BACKFILL_START!r} / {BACKFILL_END!r})")
        sys.exit(1)
    if e < s:
        log("BACKFILL_END is before BACKFILL_START")
        sys.exit(1)
    return s.strftime("%Y-%m-%d"), e.strftime("%Y-%m-%d")


# ---------------------------------------------------------------- HTTP layer
class Client:
    def __init__(self, api_key):
        self.api_key = api_key
        self.requests = 0
        self.retries = 0

    def get(self, path, params, max_retries=6):
        url = f"{BASE_URL}{path}?{urllib.parse.urlencode(params, doseq=True)}"
        for attempt in range(1, max_retries + 1):
            req = urllib.request.Request(url, headers={
                "Api-Key": self.api_key,
                "Accept": "application/json",
                "User-Agent": "cattasaurus-shipmonk-sync/" + SCRIPT_VERSION,
            })
            try:
                with urllib.request.urlopen(req, timeout=90) as resp:
                    self.requests += 1
                    return json.loads(resp.read().decode())
            except urllib.error.HTTPError as e:
                self.requests += 1
                text = e.read().decode(errors="replace")
                if e.code in (401, 403):
                    log(f"ShipMonk rejected the API key (HTTP {e.code}): {text[:300]}")
                    log("Check the SHIPMONK_API_KEY secret (Account Settings > General Settings > Integration API Keys) - a revoked key must be regenerated.")
                    raise SystemExit(2)
                if e.code == 429 or e.code >= 500:
                    backoff = min(180, 10 * (2 ** (attempt - 1)))
                    ra = e.headers.get("Retry-After")
                    if ra:
                        try:
                            backoff = max(backoff, float(ra))
                        except ValueError:
                            try:   # RFC 1123 date, as the ShipMonk docs describe
                                until = email.utils.parsedate_to_datetime(ra)
                                backoff = max(backoff, (until - datetime.now(timezone.utc)).total_seconds() + 1)
                            except (TypeError, ValueError):
                                pass
                    backoff = max(1.0, min(backoff, 900))
                    self.retries += 1
                    log(f"HTTP {e.code} - retry {attempt}/{max_retries} in {backoff:.0f}s: {text[:160]}")
                    time.sleep(backoff)
                    continue
                log(f"HTTP {e.code} on {path}: {text[:500]}")
                raise
            except urllib.error.URLError as e:
                self.retries += 1
                backoff = min(60, 5 * attempt)
                log(f"Network error ({e.reason}) - retry {attempt}/{max_retries} in {backoff}s")
                time.sleep(backoff)
        raise RuntimeError("Exceeded retries calling ShipMonk")


# ---------------------------------------------------------------- aggregation
class Aggregator:
    def __init__(self, tz, window_start, window_end):
        self.tz = tz
        self.window_start = window_start
        self.window_end = window_end
        self.daily = {}          # keyed by the basis day (order date by default)
        self.daily_shipped = {}  # keyed by ship date, shipped orders only
        self.rows = []           # per-order detail for the CSV
        self.seen = set()
        self.stores = {}
        self.warehouses = {}
        self.currencies = {}        # currency of the ShipMonk charges (what the P&L sums)
        self.order_currencies = {}  # currency the customer paid in (informational only)
        self.order_types = {}
        self.unknown_type_samples = []
        self.warnings = set()
        self.counts = {
            "orders_seen": 0, "orders_counted": 0, "orders_duplicate": 0,
            "orders_skipped_cancelled": 0, "orders_skipped_unshipped": 0,
            "orders_skipped_store": 0, "orders_skipped_type": 0, "orders_outside_window": 0,
            "orders_unshipped_counted": 0, "orders_onhold_counted": 0, "orders_shipped_series_only": 0,
            "orders_fulfilled_outside": 0,
            "cost_missing_orders": 0, "shipping_from_shipment_estimate": 0,
            "fx_converted_charges": 0, "fx_unknown_currency_charges": 0,
        }
        self.fx_native = {}   # currency -> native total converted this run
        self.oldest_seen = None   # ordered_at day of the oldest order seen (paging stop condition)

    def in_window(self, day):
        return day is not None and self.window_start <= day <= self.window_end

    def bucket(self, day, shipped_series=False):
        return (self.daily_shipped if shipped_series else self.daily).setdefault(day, new_bucket())

    @staticmethod
    def _grp(container, key):
        return container.setdefault(key or "unknown", {f: 0 for f in GROUP_FIELDS})

    def add_order(self, o):
        store = o.get("store") or {}
        store_id = str(store.get("id") or "")
        store_name = store.get("name") or (f"store {store_id}" if store_id else "unknown")
        key = (store_id, o.get("order_key") or o.get("order_number") or "")
        self.counts["orders_seen"] += 1
        if key in self.seen:
            self.counts["orders_duplicate"] += 1
            return
        self.seen.add(key)
        if store_id:
            self.stores[store_id] = store_name
        wh = o.get("warehouse") or {}
        if wh.get("identifier") or wh.get("name"):
            self.warehouses[str(wh.get("identifier") or wh.get("id"))] = wh.get("name") or ""
        otype = o.get("order_type") or "unknown"
        self.order_types[otype] = self.order_types.get(otype, 0) + 1
        if otype == "unknown" and len(self.unknown_type_samples) < 5:
            self.unknown_type_samples.append({"order_number": o.get("order_number"), "store": store_name, "status": o.get("order_status"), "shipped": bool(o.get("shipped_at"))})

        ordered_day = local_day(o.get("ordered_at"), self.tz)
        shipped_day = local_day(o.get("shipped_at"), self.tz)
        if ordered_day and (self.oldest_seen is None or ordered_day < self.oldest_seen):
            self.oldest_seen = ordered_day
        status = (o.get("order_status") or "").lower()
        if status == "cancelled" and shipped_day is None:
            self.counts["orders_skipped_cancelled"] += 1   # cancelled before shipping: no cost incurred
            return
        if STORE_IDS and store_id not in STORE_IDS:
            self.counts["orders_skipped_store"] += 1
            return
        if COSTED_TYPES and otype not in COSTED_TYPES:
            self.counts["orders_skipped_type"] += 1
            return
        if COST_BASIS == "shipped":
            day = shipped_day
            if day is None:
                self.counts["orders_skipped_unshipped"] += 1
                return
        else:
            day = ordered_day
        in_pnl = self.in_window(day)
        # the ship-date series also wants orders placed BEFORE the window that shipped inside it
        in_shipped_series = shipped_day is not None and self.in_window(shipped_day)
        if not in_pnl and not in_shipped_series:
            self.counts["orders_outside_window"] += 1
            return

        costs = o.get("order_costs") or {}
        ship, cur1 = money(costs.get("estimated_shipping_related_charges"))
        pack, cur2 = money(costs.get("estimated_packaging_material_charges"))
        pick, cur3 = money(costs.get("estimated_pick_and_pack_charges"))
        missing = ship is None and pack is None and pick is None   # ShipMonk has not costed the order yet
        if missing and shipped_day is None and status == "fulfilled":
            # marked fulfilled without a ShipMonk shipment or any charge: fulfilled somewhere else
            # (other location, merged/replaced order) - ShipMonk never billed it, so it is not a ShipMonk order
            self.counts["orders_fulfilled_outside"] += 1
            return
        for c in (cur1, cur2, cur3):
            if c:
                self.currencies[c] = self.currencies.get(c, 0) + 1
        if o.get("currency_code"):
            self.order_currencies[o["currency_code"]] = self.order_currencies.get(o["currency_code"], 0) + 1
        # charges stated in another currency (Toronto warehouse: CAD) -> USD at the configured rate
        cost_currency = "+".join(sorted({c for c in (cur1, cur2, cur3) if c})) or ""
        native = {}
        converted = []
        for amount, cur in ((ship, cur1), (pack, cur2), (pick, cur3)):
            if amount is None or not cur or cur == "USD":
                converted.append(amount)
                continue
            native[cur] = native.get(cur, 0.0) + amount
            rate = FX_TO_USD.get(cur)
            if rate is None:
                self.counts["fx_unknown_currency_charges"] += 1
                converted.append(amount)   # no rate: summed as-is (warned in meta)
            else:
                self.counts["fx_converted_charges"] += 1
                converted.append(amount * rate)
        ship, pack, pick = converted
        for cur, amt in native.items():
            self.fx_native[cur] = self.fx_native.get(cur, 0.0) + amt
        if ship is None:
            est = (o.get("shipment_data") or {}).get("estimated_shipping_cost")
            if est is not None:
                ship = float(est)
                self.counts["shipping_from_shipment_estimate"] += 1
        ship = ship or 0.0
        pack = pack or 0.0
        pick = pick or 0.0
        units = 0
        for it in (o.get("items") or []):
            if (it.get("source") or "") == "packaging":
                continue   # packaging material lines are not product units
            q = it.get("fulfilled_quantity") if shipped_day is not None else None   # unshipped: nothing fulfilled yet
            if q is None:
                q = it.get("quantity") or 0
            units += int(q or 0)
        packages = len(o.get("packages") or [])
        sd = o.get("shipment_data") or {}
        carrier = sd.get("carrier")
        if isinstance(carrier, dict):
            carrier = carrier.get("name")
        if not carrier:
            carrier = ((o.get("shipping_method") or {}).get("carrier") or {}).get("name")
        carrier = (carrier or "unknown").strip()

        targets = []
        if in_pnl:
            targets.append(self.bucket(day))
        if in_shipped_series:
            targets.append(self.bucket(shipped_day, shipped_series=True))
        onhold = shipped_day is None and status == "onhold"
        for d in targets:
            d["orders"] += 1
            d["orders_shipped" if shipped_day is not None else "orders_unshipped"] += 1
            if onhold:
                d["orders_onhold"] += 1
            d["units"] += units
            d["packages"] += packages
            d["shipping_cost"] += ship
            d["packaging_cost"] += pack
            d["pick_pack_cost"] += pick
            d["total_cost"] += ship + pack + pick
            if missing:
                d["cost_missing_orders"] += 1
            for container, k in ((d["by_store"], store_name), (d["by_type"], otype)):
                g = self._grp(container, k)
                g["orders"] += 1
                g["units"] += units
                g["shipping_cost"] += ship
                g["packaging_cost"] += pack
                g["pick_pack_cost"] += pick
                g["total_cost"] += ship + pack + pick
            c = d["by_carrier"].setdefault(carrier, {"orders": 0, "shipping_cost": 0.0})
            c["orders"] += 1
            c["shipping_cost"] += ship
            for cur, amt in native.items():
                d["foreign_cost"][cur] = d["foreign_cost"].get(cur, 0.0) + amt
        if not in_pnl:
            self.counts["orders_shipped_series_only"] += 1   # placed before the window, shipped inside it
        else:
            if missing:
                self.counts["cost_missing_orders"] += 1
            if shipped_day is None:
                self.counts["orders_unshipped_counted"] += 1
                if onhold:
                    self.counts["orders_onhold_counted"] += 1
            self.counts["orders_counted"] += 1
        self.rows.append({
            "order_number": o.get("order_number") or "", "order_key": o.get("order_key") or "",
            "store": store_name, "order_type": otype, "status": status,
            "ordered_day": ordered_day or "", "shipped_day": shipped_day or "",
            "pnl_day": day if in_pnl else "",
            "warehouse": (wh.get("identifier") or wh.get("name") or ""), "carrier": carrier,
            "units": units, "packages": packages,
            "shipping_cost": round(ship, 2), "pick_pack_cost": round(pick, 2), "packaging_cost": round(pack, 2),
            "total_cost": round(ship + pick + pack, 2), "cost_status": "missing" if missing else "shipmonk_estimate",
            "cost_currency": cost_currency,
        })

    def finalise(self):
        for series in (self.daily, self.daily_shipped):
            for d in series.values():
                for f in MONEY_FIELDS:
                    d[f] = round(d[f], 2)
                for container in (d["by_store"], d["by_type"], d["by_carrier"]):
                    for g in container.values():
                        for f in list(g):
                            if isinstance(g[f], float):
                                g[f] = round(g[f], 2)
                for cur in list(d["foreign_cost"]):
                    d["foreign_cost"][cur] = round(d["foreign_cost"][cur], 2)
        self.rows.sort(key=lambda r: (r["ordered_day"], r["order_number"]))
        for cur, amt in self.fx_native.items():
            if cur in FX_TO_USD:
                self.warnings.add(f"charges stated in {cur} ({amt:,.2f} {cur} this run) converted to USD at {FX_TO_USD[cur]} - set SHIPMONK_FX_TO_USD to the rate on ShipMonk's invoice if it differs")
            else:
                self.warnings.add(f"charges stated in {cur} ({amt:,.2f} {cur}) have no rate in SHIPMONK_FX_TO_USD and were summed as-is")
        if self.unknown_type_samples:
            self.warnings.add(f"{self.order_types.get('unknown', 0)} orders came back with no order_type (counted as D2C); samples: {self.unknown_type_samples}")
        if self.counts["cost_missing_orders"]:
            self.warnings.add(f"{self.counts['cost_missing_orders']} orders had no cost estimate from ShipMonk yet - their cost is $0 until ShipMonk fills it in (re-fetched every run)")


def sum_range(daily, start_key, end_key):
    out = {f: 0 for f in DAILY_FIELDS}
    for k, d in daily.items():
        if start_key <= k <= end_key:
            for f in DAILY_FIELDS:
                out[f] += d.get(f, 0)
    for f in MONEY_FIELDS:
        out[f] = round(out[f], 2)
    return out


# ---------------------------------------------------------------- fetching
def iso_z(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch_orders_by_order_date(client, agg, window_start):
    """Basis 'ordered': the API has no ordered_at filter, so read the unfiltered listing
    newest-first (sorted by ShipMonk's internal id) and stop once whole pages are older than
    the window. Every order in the window is returned, shipped or not."""
    page = 1
    old_pages = 0
    while True:
        data = client.get("/v1/integrations/orders-list", {"page": page, "pageSize": PAGE_SIZE, "sortOrder": "DESC"})
        orders = ((data.get("data") or {}).get("orders") or [])
        if not orders:
            break
        newest_in_page = None
        for o in orders:
            agg.add_order(o)
            od = local_day(o.get("ordered_at"), agg.tz)
            if od and (newest_in_page is None or od > newest_in_page):
                newest_in_page = od
        if page % 20 == 0:
            log(f"  page {page}: oldest order day so far {agg.oldest_seen}")
        if newest_in_page is not None and newest_in_page < window_start:
            old_pages += 1          # a whole page before the window; a few more in case of late imports
            if old_pages >= STOP_AFTER_OLD_PAGES:
                break
        else:
            old_pages = 0
        if len(orders) < PAGE_SIZE:
            break
        page += 1
        if page > 2000:
            agg.warnings.add("stopped after 2000 pages - window too large for the unfiltered listing")
            break
    return 1, page


def fetch_shipped_orders(client, agg, start_utc, end_utc):
    """Basis 'shipped': walk [start_utc, end_utc] in CHUNK_DAYS slices of shipped_at, paging
    each slice until a short page."""
    chunks = pages = 0
    cur = start_utc
    while cur < end_utc:
        nxt = min(cur + timedelta(days=CHUNK_DAYS), end_utc)
        chunk_orders = 0
        page = 1
        while True:
            data = client.get("/v1/integrations/orders-list", {
                "shippedAtStart": iso_z(cur), "shippedAtEnd": iso_z(nxt),
                "page": page, "pageSize": PAGE_SIZE, "sortOrder": "ASC",
            })
            orders = ((data.get("data") or {}).get("orders") or [])
            pages += 1
            for o in orders:
                agg.add_order(o)
            chunk_orders += len(orders)
            if len(orders) < PAGE_SIZE:
                break
            page += 1
            if page > 400:   # 40,000 orders in one chunk cannot happen with the 10k cap - guard anyway
                agg.warnings.add(f"stopped paging chunk {iso_z(cur)}..{iso_z(nxt)} after 400 pages")
                break
        chunks += 1
        if chunk_orders >= FILTER_CAP:
            agg.warnings.add(f"chunk {iso_z(cur)}..{iso_z(nxt)} hit ShipMonk's 10,000-order cap - lower CHUNK_DAYS")
        log(f"  {iso_z(cur)} .. {iso_z(nxt)}: {chunk_orders} shipped orders ({page} page(s))")
        cur = nxt
    return chunks, pages


CSV_COLS = ["order_number", "order_key", "store", "order_type", "status", "ordered_day", "shipped_day", "pnl_day", "warehouse",
            "carrier", "units", "packages", "shipping_cost", "pick_pack_cost", "packaging_cost", "total_cost", "cost_status", "cost_currency"]


def write_order_csvs(rows, fetched_start, fetched_end):
    """One CSV per month (by P&L day; ship-series-only rows go under their ship month). Each
    month file touched by this run is rebuilt: previous rows whose order day lies inside the
    fetched range are dropped (they were re-fetched - or cancelled), the rest are kept."""
    import csv
    os.makedirs(ORDERS_CSV_DIR, exist_ok=True)
    by_month = {}
    for r in rows:
        month = (r["pnl_day"] or r["shipped_day"] or r["ordered_day"])[:7]
        by_month.setdefault(month, []).append(r)
    # months that had rows inside the fetched range but have none now must still be rebuilt
    for name in os.listdir(ORDERS_CSV_DIR):
        if name.endswith(".csv") and fetched_start[:7] <= name[:7] <= fetched_end[:7]:
            by_month.setdefault(name[:7], [])
    written = []
    for month, new_rows in sorted(by_month.items()):
        path = os.path.join(ORDERS_CSV_DIR, month + ".csv")
        keep = []
        try:
            with open(path, newline="") as f:
                for old in csv.DictReader(f):
                    od = old.get("ordered_day") or ""
                    if od and (od < fetched_start or od > fetched_end) and od >= HISTORY_START:
                        keep.append(old)
        except OSError:
            pass
        new_keys = {(r["store"], r["order_key"]) for r in new_rows}
        merged = [o for o in keep if (o.get("store"), o.get("order_key")) not in new_keys] + new_rows
        merged.sort(key=lambda r: (r.get("pnl_day") or r.get("shipped_day") or "", r.get("ordered_day") or "", r.get("order_number") or ""))
        if not merged:
            continue
        with open(path, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=CSV_COLS, extrasaction="ignore")
            w.writeheader()
            for r in merged:
                w.writerow(r)
        written.append(month + ".csv")
    log(f"Wrote {len(written)} monthly order CSV(s) in {ORDERS_CSV_DIR}: {', '.join(written[-6:])}")
    return written


def main():
    if not API_KEY:
        log("SHIPMONK_API_KEY is not set")
        sys.exit(1)
    tz = timezone.utc
    if ZoneInfo is not None:
        try:
            tz = ZoneInfo(TZ_NAME)
        except Exception:  # noqa: BLE001
            log(f"unknown timezone {TZ_NAME!r} - falling back to UTC")
    now_utc = datetime.now(timezone.utc)
    now_local = now_utc.astimezone(tz)
    today_key = now_local.strftime("%Y-%m-%d")
    bf = backfill_range(today_key)
    if bf:
        window_start, window_end = bf
        mode = "backfill"
    else:
        window_end = today_key
        window_start = (now_local - timedelta(days=WINDOW_DAYS)).strftime("%Y-%m-%d")
        mode = "rolling"
    # shipped_at filter in UTC: local midnight of the first window day .. end of the last one
    start_utc = datetime.strptime(window_start, "%Y-%m-%d").replace(tzinfo=tz).astimezone(timezone.utc)
    end_utc = min(now_utc, (datetime.strptime(window_end, "%Y-%m-%d").replace(tzinfo=tz) + timedelta(days=1)).astimezone(timezone.utc))

    client = Client(API_KEY)
    agg = Aggregator(tz, window_start, window_end)
    log(f"ShipMonk {BASE_URL}, tz {TZ_NAME}, {mode} {window_start}..{window_end}, basis {COST_BASIS}, page {PAGE_SIZE}, history from {HISTORY_START}")
    if COST_BASIS == "shipped":
        chunks, pages = fetch_shipped_orders(client, agg, start_utc, end_utc)
    else:
        chunks, pages = fetch_orders_by_order_date(client, agg, window_start)
    agg.finalise()

    # merge with the copy already in the repo: days outside the fetched range are kept
    previous = history_previous(OUTPUT_PATH)
    daily = history_merge(previous, agg.daily, window_start, window_end)
    daily_shipped = history_merge(previous, agg.daily_shipped, window_start, window_end, key="daily_shipped")
    hist = history_meta(previous, mode, window_start, window_end, daily, today_key)
    log(f"History: {hist['first_day']}..{hist['last_day']} ({hist['days']} days, {hist['missing_count']} missing since {HISTORY_START})")
    csv_files = write_order_csvs(agg.rows, window_start, window_end) if ORDERS_CSV_DIR else []

    mtd_start = now_local.strftime("%Y-%m-01")
    last30_start = (now_local - timedelta(days=30)).strftime("%Y-%m-%d")
    out = {
        "source": "shipmonk_public_api",
        "generated_at": now_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "timezone": TZ_NAME,
        "currency": "USD",
        "window_days": WINDOW_DAYS,
        "window": {"start": window_start, "end": window_end},
        "daily": daily,
        "daily_shipped": daily_shipped,
        "totals": {
            "today": sum_range(daily, today_key, today_key),
            "mtd": sum_range(daily, mtd_start, today_key),
            "last_30d": sum_range(daily, last30_start, today_key),
        },
        "meta": {
            "script_version": SCRIPT_VERSION,
            "schema": SCHEMA,
            "history": hist,
            "cost_basis": ("shipmonk_estimated_order_costs_by_ordered_at" if COST_BASIS != "shipped" else "shipmonk_estimated_order_costs_by_shipped_at"),
            "orders_csv": (ORDERS_CSV_DIR + "/") if ORDERS_CSV_DIR else None,
            "orders_csv_files": csv_files,
            "oldest_order_day_seen": agg.oldest_seen,
            "costed_order_types": sorted(COSTED_TYPES),
            "store_filter": sorted(STORE_IDS),
            "stores": agg.stores,
            "warehouses": agg.warehouses,
            "order_types_seen": agg.order_types,
            "currencies_seen": agg.currencies,
            "order_currencies_seen": agg.order_currencies,
            "fx": {"rates_to_usd": FX_TO_USD, "native_converted_this_run": {k: round(v, 2) for k, v in agg.fx_native.items()},
                   "note": "costs in daily/by_* are USD; foreign_cost per day holds the native amounts before conversion"},
            "chunks": chunks,
            "pages": pages,
            "api_requests": client.requests,
            "api_retries": client.retries,
            "counts": agg.counts,
            "warnings": sorted(agg.warnings),
            "not_in_api": ["storage fees", "receiving fees", "returns processing", "special projects", "account minimums - only on ShipMonk invoices"],
        },
    }
    os.makedirs(os.path.dirname(OUTPUT_PATH) or ".", exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(out, f, indent=2, sort_keys=True)
    t = out["totals"]["last_30d"]
    log(f"Wrote {OUTPUT_PATH}: {agg.counts['orders_counted']} orders ({agg.counts['orders_unshipped_counted']} not shipped yet) over {len(agg.daily)} fetched days, {len(daily)} days in file; "
        f"last 30d cost {t['total_cost']:.2f} (postage {t['shipping_cost']:.2f}, pick/pack {t['pick_pack_cost']:.2f}, packaging {t['packaging_cost']:.2f}); "
        f"{client.requests} API calls, {len(agg.warnings)} warning types.")


if __name__ == "__main__":
    main()
