#!/usr/bin/env python3
"""
Cattasaurus - Notion "Reorder Tracker" inbound lots fetcher (v1.0) -> data/cogs_lots.json (schema 1)

Runs on a schedule (GitHub Actions) completely independently of Claude. Pulls EVERY row of the
Notion database "Reorder Tracker" (one row = one SKU line of one inbound shipment, with the landed
cost per unit that Notion's own formulas compute from the purchase order and the shipment) and
writes them as a flat list of "lots", so the dashboard can later cost each sale FIFO by receipt
lot instead of applying one average cost per SKU (data/cogs_skus.json) or a flat % of revenue.

A lot:
  inbound      the shipment line's title, e.g. "JHQ326-03" (shipment JHQ326, line 03)
  sku          the sales SKU of the Restock Item the line points to (Amazon FNSKU-style SKUs for
               FBA lots, Shopify/ShipMonk SKUs for 3PL lots)
  dest         the warehouse the lot went to, as Notion's "Destination text" formula prints it
               (FBA / Shipmonk NV3 / PA2 / TO1 / SAT ...)
  qty          units ordered on the line; received_qty = units the warehouse actually checked in
               (null while the lot is still in transit) - FIFO should use received_qty when > 0,
               else qty
  exw_usd      EXW unit price (RMB price converted by the PO's rate)
  landed       Landed Cost/Unit = EXW + Shipping Cost/Unit + Unit Duties & Taxes, as computed by
               the Notion formula (USD, excludes FBA / ShipMonk fulfillment fees)
  ata / atd / eta / etd / crd   dates rolled up from the related Shipment (ATA = actual arrival =
               the receipt date FIFO orders lots by; ETA is the fallback for lots still at sea)

Credentials come ONLY from environment variables (GitHub Actions Secrets). The token is never
printed or written anywhere; page content is never logged beyond counts, SKUs and numbers.

Required env vars:
  NOTION_TOKEN             Notion internal integration token ("secret_..." or "ntn_..."). The
                           integration must be shared with the Reorder Tracker database (and
                           its related Shipments / Restock Items databases, so the rollups resolve).

Optional env vars:
  NOTION_VERSION           Notion-Version header, default 2022-06-28
  NOTION_REORDER_DB_ID     database id, default 292356e6-b6b5-4e5e-8338-8aa43b6e3098
  OUTPUT_PATH              default data/cogs_lots.json
  NOTION_PAGE_SIZE         rows per request, default 100 (API max)

API: POST https://api.notion.com/v1/databases/{db_id}/query, paginated on has_more/next_cursor,
at most 3 requests per second (>= 0.35 s between calls). 429 (Retry-After honoured) and 5xx are
retried up to 5 times with backoff; 401/403 (bad token, database not shared) are fatal.

Failure handling: on any fatal error the previous data/cogs_lots.json is kept as it is, with
meta.carried_over = true and meta.error = <short text>, and the script still exits 0 so the
workflow does not go red and the dashboard keeps the last good snapshot. With no previous file a
minimal file (no lots, error set) is written instead.

Output (data/cogs_lots.json):
  schema, source ("notion"), script_version, generated_at, database_id, currency ("USD"), note
  lots[]        one object per non-archived row, keys in a fixed order (see LOT_KEYS), numbers
                rounded to 4 decimals, sorted by (ata or eta or created) then inbound:
                id, inbound, sku, fnsku, sku_title, dest, dest_ids, status, inventory_status,
                product_group, qty, received_qty, exw_usd, exw_rmb, tariff_rate, duties_unit
                ("Duties/Unit"), duties_taxes_unit ("Unit Duties & Taxes"), shipping_unit, landed,
                total_product_cost, ata, ata_eta, atd, eta, etd, crd, shipment_ids, restock_ids,
                parent_id, description, created, last_edited
  by_sku        {sku: [indexes into lots, in ata order]} - rows with an empty SKU are in lots
                (sku null) but not here
  meta          rows, archived_skipped, lots, lots_with_landed, lots_no_sku, lots_no_landed,
                lots_received (received_qty > 0), lots_multi_sku, skus, first_ata, last_ata,
                api_requests, api_retries, pages, page_size, notion_version, elapsed_s,
                carried_over, error, fetched_at (+ last_attempt_at when carried over)
"""
import email.utils
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

SCRIPT_VERSION = "1.0"
SCHEMA = 1

TOKEN = os.environ.get("NOTION_TOKEN", "").strip()
NOTION_VERSION = os.environ.get("NOTION_VERSION", "2022-06-28").strip() or "2022-06-28"
DB_ID = os.environ.get("NOTION_REORDER_DB_ID", "292356e6-b6b5-4e5e-8338-8aa43b6e3098").strip() or "292356e6-b6b5-4e5e-8338-8aa43b6e3098"
OUTPUT_PATH = os.environ.get("OUTPUT_PATH", "data/cogs_lots.json")
PAGE_SIZE = max(1, min(100, int(os.environ.get("NOTION_PAGE_SIZE", "100") or "100")))
API_BASE = "https://api.notion.com/v1"
MIN_INTERVAL_S = 0.35     # Notion allows an average of 3 requests/second per integration
MAX_RETRIES = 5
MAX_PAGES = 2000          # runaway guard only: 2,000 pages x 100 rows = 200,000 lots

NOTE = ("Moi dong (lot) = 1 SKU trong 1 lo hang nhap (Inbound, vd JHQ326-03) lay tu Notion Reorder Tracker. "
        "landed = gia von landed/unit USD do formula Notion tinh: EXW + Shipping Cost/Unit + Unit Duties & Taxes "
        "(chua gom phi FBA/ShipMonk). dest = kho lo hang di toi (FBA / Shipmonk NV3 / PA2 / TO1 / SAT ...), "
        "ata = ngay hang den that (ETA khi chua den). Khi xuat kho FIFO: dung received_qty neu > 0, nguoc lai dung qty; "
        "sap xep lo theo ata (roi eta, roi created). SKU trong (chua gan Restock Item) van nam trong lots nhung khong co trong by_sku.")

# every lot has exactly these keys, in this order
LOT_KEYS = [
    "id", "inbound", "sku", "fnsku", "sku_title", "dest", "dest_ids", "status", "inventory_status", "product_group",
    "qty", "received_qty", "exw_usd", "exw_rmb", "tariff_rate", "duties_unit", "duties_taxes_unit", "shipping_unit",
    "landed", "total_product_cost", "ata", "ata_eta", "atd", "eta", "etd", "crd",
    "shipment_ids", "restock_ids", "parent_id", "description", "created", "last_edited",
]
# lot key -> Notion property name (a missing property simply gives None)
PROPS = {
    "inbound": "Inbound", "qty": "Qty", "received_qty": "Received Qty",
    "exw_usd": "EXW Unit Cost (USD)", "exw_rmb": "EXW Unit Cost (RMB)", "tariff_rate": "Actual Tariff Rate (%)",
    "landed": "Landed Cost/Unit", "shipping_unit": "Shipping Cost/Unit", "duties_unit": "Duties/Unit",
    "duties_taxes_unit": "Unit Duties & Taxes", "total_product_cost": "Total Product Cost",
    "dest": "Destination text", "sku_title": "SKU title", "sku": "SKU", "fnsku": "FNSKU/UPC",
    "ata": "ATA", "ata_eta": "ATA/ETA", "atd": "ATD", "eta": "ETA", "etd": "ETD", "crd": "CRD",
    "status": "Status", "inventory_status": "Inventory Status", "product_group": "Product Group", "dest_ids": "Destination",
    "shipment_ids": "Shipment", "restock_ids": "Restock Item", "parent_id": "Parent item", "description": "Description",
}
NUMBER_KEYS = ["qty", "received_qty", "exw_usd", "exw_rmb", "tariff_rate", "duties_unit", "duties_taxes_unit", "shipping_unit", "landed", "total_product_cost"]
LIST_KEYS = ["dest_ids", "shipment_ids", "restock_ids"]
DATE_KEYS = ["ata", "ata_eta", "atd", "eta", "etd", "crd"]


def log(msg):
    print(f"[notion-lots] {msg}", file=sys.stderr, flush=True)


# ---------------------------------------------------------------- property parsing
# The Notion API returns every property as {"id", "type": T, T: <value>}. The value shapes:
#   title / rich_text  [{plain_text, ...}, ...]
#   number             12.5 | null
#   formula            {"type": "number"|"string"|"date"|"boolean", <type>: value}  (date -> {start, end})
#   rollup             {"type": "number"|"date"|"array", "function": ..., <type>: value}; for "array" each
#                      item is itself a property value object ({"type": "rich_text", "rich_text": [...]},
#                      {"type": "date", ...}, {"type": "status", ...}, {"type": "formula", ...}, ...)
#   relation           [{"id": page_id}, ...]  (+ has_more when the API truncates it at 25)
#   date               {"start": "2026-08-09", "end": null, "time_zone": null} | null
#   select / status    {"id", "name", "color"} | null
# prop_value() turns any of them into a plain Python value and never raises on an unknown shape.

def _text(items):
    """title / rich_text array -> joined plain text, stripped; None when empty."""
    if not isinstance(items, list):
        return None
    s = "".join(str(t.get("plain_text") or "") for t in items if isinstance(t, dict)).strip()
    return s or None


def _number(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _date(v):
    """date object -> its start as 'YYYY-MM-DD' (a datetime start is cut to its date part)."""
    if not isinstance(v, dict):
        return None
    start = v.get("start")
    if not isinstance(start, str) or len(start) < 10:
        return None
    return start[:10]


def _formula(v):
    if not isinstance(v, dict):
        return None
    ft = v.get("type")
    if ft == "number":
        return _number(v.get("number"))
    if ft == "string":
        s = v.get("string")
        return (s.strip() or None) if isinstance(s, str) else None
    if ft == "date":
        return _date(v.get("date"))
    if ft == "boolean":
        b = v.get("boolean")
        return bool(b) if isinstance(b, bool) else None
    return None


def _distinct(values):
    """Flatten nested lists, drop None, keep first occurrence order."""
    out = []
    for x in values:
        for y in (x if isinstance(x, list) else [x]):
            if y is not None and y not in out:
                out.append(y)
    return out


def _rollup(v):
    if not isinstance(v, dict):
        return None
    rt = v.get("type")
    if rt == "number":
        return _number(v.get("number"))
    if rt == "date":
        return _date(v.get("date"))
    if rt == "array":
        items = v.get("array")
        vals = _distinct(prop_value(it) for it in items) if isinstance(items, list) else []
        if not vals:
            return None
        return vals[0] if len(vals) == 1 else vals
    return None   # "unsupported" / "incomplete" rollups


def prop_value(prop):
    """One Notion property value object -> plain Python value (str / float / bool / list / None).
    Rollups give the single element when they hold one distinct value, a list when more.
    Relations give a list of page ids (possibly empty). Unknown types give None, never an error."""
    if not isinstance(prop, dict):
        return None
    t = prop.get("type")
    if not isinstance(t, str):
        return None
    v = prop.get(t)
    try:
        if t in ("title", "rich_text"):
            return _text(v)
        if t == "number":
            return _number(v)
        if t == "formula":
            return _formula(v)
        if t == "rollup":
            return _rollup(v)
        if t == "relation":
            return [r["id"] for r in v if isinstance(r, dict) and isinstance(r.get("id"), str)] if isinstance(v, list) else []
        if t == "date":
            return _date(v)
        if t in ("select", "status"):
            return (v.get("name") or None) if isinstance(v, dict) else None
        if t == "multi_select":
            return _distinct(o.get("name") for o in v if isinstance(o, dict)) if isinstance(v, list) else None
        if t == "checkbox":
            return bool(v) if isinstance(v, bool) else None
        if t in ("url", "email", "phone_number", "created_time", "last_edited_time"):
            return (v.strip() or None) if isinstance(v, str) else None
        if t == "unique_id" and isinstance(v, dict):
            n = v.get("number")
            return f"{v.get('prefix')}-{n}" if v.get("prefix") and n is not None else n
        if t in ("people", "created_by", "last_edited_by"):
            return _distinct((p.get("name") or p.get("id")) for p in (v if isinstance(v, list) else [v]) if isinstance(p, dict))
        if t == "files":
            return _distinct(f.get("name") for f in v if isinstance(f, dict)) if isinstance(v, list) else None
    except (AttributeError, TypeError, ValueError):
        return None
    return None


def _str_or_first(val):
    """Text-like fields: a list (multi-value rollup) collapses to its first element; '' -> None."""
    if isinstance(val, list):
        val = val[0] if val else None
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return str(val)
    return (val.strip() or None) if isinstance(val, str) else None


def _num_or_first(val):
    """Numbers are rounded to 4 decimals; whole numbers are written as ints (qty 1090, not 1090.0)."""
    if isinstance(val, list):
        val = val[0] if val else None
    if not isinstance(val, (int, float)) or isinstance(val, bool):
        return None
    r = round(val, 4)
    return int(r) if r == int(r) else r


def _date_or_first(val):
    if isinstance(val, list):
        val = val[0] if val else None
    return val if isinstance(val, str) and len(val) == 10 else None


def _ids(val):
    if isinstance(val, str):
        return [val]
    return [x for x in val if isinstance(x, str)] if isinstance(val, list) else []


def lot_from_page(page):
    """One query result page object -> (lot dict with LOT_KEYS, multi_sku flag)."""
    props = page.get("properties") if isinstance(page.get("properties"), dict) else {}
    raw = {k: prop_value(props.get(name)) for k, name in PROPS.items()}
    multi_sku = isinstance(raw["sku"], list) and len(raw["sku"]) > 1
    lot = {}
    for k in LOT_KEYS:
        if k == "id":
            lot[k] = page.get("id")
        elif k == "created":
            lot[k] = page.get("created_time")
        elif k == "last_edited":
            lot[k] = page.get("last_edited_time")
        elif k == "parent_id":
            ids = _ids(raw[k])
            lot[k] = ids[0] if ids else None
        elif k in LIST_KEYS:
            lot[k] = _ids(raw[k])
        elif k in NUMBER_KEYS:
            lot[k] = _num_or_first(raw[k])
        elif k in DATE_KEYS:
            lot[k] = _date_or_first(raw[k])
        else:
            lot[k] = _str_or_first(raw[k])
    return lot, multi_sku


def sort_key(lot):
    """Lots are ordered by receipt date: ATA, else ETA, else the row's creation time; then inbound."""
    day = lot.get("ata") or lot.get("eta") or (lot.get("created") or "")[:10] or "9999-12-31"
    return (day, lot.get("inbound") or "", lot.get("id") or "")


# ---------------------------------------------------------------- HTTP layer
class FatalError(Exception):
    """Anything that stops the run: the previous file is kept and the script still exits 0."""


class Client:
    def __init__(self, token):
        self.token = token
        self.requests = 0
        self.retries = 0
        self._last_call = 0.0

    def _throttle(self):
        wait = MIN_INTERVAL_S - (time.monotonic() - self._last_call)
        if wait > 0:
            time.sleep(wait)

    def post(self, path, body, max_retries=MAX_RETRIES):
        url = f"{API_BASE}{path}"
        data = json.dumps(body).encode()
        headers = {
            "Authorization": "Bearer " + self.token,
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "cattasaurus-notion-lots-sync/" + SCRIPT_VERSION,
        }
        for attempt in range(1, max_retries + 1):
            self._throttle()
            req = urllib.request.Request(url, data=data, headers=headers, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    self.requests += 1
                    self._last_call = time.monotonic()
                    raw = resp.read().decode()
                    return json.loads(raw) if raw.strip() else {}
            except urllib.error.HTTPError as e:
                self.requests += 1
                self._last_call = time.monotonic()
                text = e.read().decode(errors="replace")
                if e.code in (401, 403):
                    # the error body never contains the token, but keep it short anyway
                    log(f"Notion rejected the request (HTTP {e.code}): {text[:200]}")
                    raise FatalError(f"HTTP {e.code}: check the NOTION_TOKEN secret and that the Reorder Tracker (and its Shipments / Restock Items databases) are shared with the integration")
                if e.code == 429 or e.code >= 500:
                    backoff = min(120, 2 * (2 ** (attempt - 1)))
                    ra = e.headers.get("Retry-After")
                    if ra:
                        try:
                            backoff = max(backoff, float(ra))
                        except ValueError:
                            try:   # RFC 1123 date
                                until = email.utils.parsedate_to_datetime(ra)
                                backoff = max(backoff, (until - datetime.now(timezone.utc)).total_seconds() + 1)
                            except (TypeError, ValueError):
                                pass
                    backoff = max(1.0, min(backoff, 600))
                    self.retries += 1
                    log(f"HTTP {e.code} - retry {attempt}/{max_retries} in {backoff:.0f}s: {text[:160]}")
                    time.sleep(backoff)
                    continue
                log(f"HTTP {e.code} on {path}: {text[:300]}")
                raise FatalError(f"HTTP {e.code} on {path}: {text[:120]}")
            except urllib.error.URLError as e:
                self.retries += 1
                backoff = min(60, 5 * attempt)
                log(f"Network error ({e.reason}) - retry {attempt}/{max_retries} in {backoff}s")
                time.sleep(backoff)
            except (ValueError, TimeoutError) as e:
                self.retries += 1
                log(f"Bad response ({type(e).__name__}) - retry {attempt}/{max_retries}")
                time.sleep(min(60, 5 * attempt))
        raise FatalError(f"exceeded {max_retries} retries calling Notion {path}")


def fetch_rows(client):
    """Every page object of the database (archived ones included; the caller skips them)."""
    rows = []
    cursor = None
    pages = 0
    seen_cursors = set()
    while True:
        body = {"page_size": PAGE_SIZE}
        if cursor:
            body["start_cursor"] = cursor
        resp = client.post(f"/databases/{DB_ID}/query", body)
        if not isinstance(resp, dict) or not isinstance(resp.get("results"), list):
            raise FatalError(f"unexpected query response: {str(resp)[:160]}")
        pages += 1
        rows.extend(r for r in resp["results"] if isinstance(r, dict))
        cursor = resp.get("next_cursor") if resp.get("has_more") else None
        if not cursor:
            break
        if cursor in seen_cursors or pages >= MAX_PAGES:
            log(f"stopped paging after {pages} page(s) (cursor repeated or MAX_PAGES)")
            break
        seen_cursors.add(cursor)
    return rows, pages


# ---------------------------------------------------------------- output
def build_output(rows, client, pages, t0, now_utc):
    lots = []
    archived = 0
    multi_sku = 0
    for page in rows:
        if page.get("archived") or page.get("in_trash"):
            archived += 1
            continue
        lot, multi = lot_from_page(page)
        lots.append(lot)
        multi_sku += 1 if multi else 0
    lots.sort(key=sort_key)
    by_sku = {}
    for i, lot in enumerate(lots):
        if lot["sku"]:
            by_sku.setdefault(lot["sku"], []).append(i)
    atas = sorted(l["ata"] for l in lots if l["ata"])
    meta = {
        "rows": len(rows),
        "archived_skipped": archived,
        "lots": len(lots),
        "lots_with_landed": sum(1 for l in lots if l["landed"] is not None),
        "lots_no_sku": sum(1 for l in lots if not l["sku"]),
        "lots_no_landed": sum(1 for l in lots if l["landed"] is None),
        "lots_received": sum(1 for l in lots if (l["received_qty"] or 0) > 0),
        "lots_multi_sku": multi_sku,
        "skus": len(by_sku),
        "first_ata": atas[0] if atas else None,
        "last_ata": atas[-1] if atas else None,
        "api_requests": client.requests,
        "api_retries": client.retries,
        "pages": pages,
        "page_size": PAGE_SIZE,
        "notion_version": NOTION_VERSION,
        "elapsed_s": round(time.time() - t0, 1),
        "carried_over": False,
        "error": None,
        "fetched_at": now_utc,
    }
    return {
        "schema": SCHEMA,
        "source": "notion",
        "script_version": SCRIPT_VERSION,
        "generated_at": now_utc,
        "database_id": DB_ID,
        "currency": "USD",
        "note": NOTE,
        "lots": lots,
        "by_sku": by_sku,
        "meta": meta,
    }


def previous_file(path):
    try:
        with open(path, encoding="utf-8") as f:
            prev = json.load(f)
        return prev if isinstance(prev, dict) and isinstance(prev.get("lots"), list) else None
    except (OSError, ValueError):
        return None


def dumps_pretty(out):
    """Top level indented, but ONE lot per line and one SKU per line, so a 3,000-row file stays
    readable in git diffs (a received lot changes exactly one line) and about half the size of
    a fully indented dump. Key order is preserved (no sort_keys)."""
    compact = {"ensure_ascii": False, "separators": (",", ":")}
    parts = []
    for k, v in out.items():
        if k == "lots" and isinstance(v, list):
            body = ",\n".join("  " + json.dumps(l, **compact) for l in v)
            parts.append(f' "lots": [\n{body}\n ]' if v else ' "lots": []')
        elif k == "by_sku" and isinstance(v, dict):
            body = ",\n".join(f"  {json.dumps(s, ensure_ascii=False)}: {json.dumps(idx, **compact)}" for s, idx in v.items())
            parts.append(f' "by_sku": {{\n{body}\n }}' if v else ' "by_sku": {}')
        else:
            parts.append(f" {json.dumps(k, ensure_ascii=False)}: " + json.dumps(v, ensure_ascii=False, indent=1).replace("\n", "\n "))
    return "{\n" + ",\n".join(parts) + "\n}\n"


def write_file(path, out):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(dumps_pretty(out))
    os.replace(tmp, path)


def keep_previous(error, now_utc, client=None, t0=None):
    """Fatal path: keep the previous file (carried_over) or write a minimal one; never raises."""
    prev = previous_file(OUTPUT_PATH)
    short = str(error)[:300]
    if prev is not None:
        meta = prev.get("meta") if isinstance(prev.get("meta"), dict) else {}
        meta.update({"carried_over": True, "error": short, "last_attempt_at": now_utc,
                     "api_requests": client.requests if client else 0, "api_retries": client.retries if client else 0,
                     "elapsed_s": round(time.time() - t0, 1) if t0 else 0})
        prev["meta"] = meta
        write_file(OUTPUT_PATH, prev)
        log(f"ERROR: {short} - previous file kept ({len(prev.get('lots') or [])} lots, generated {prev.get('generated_at')})")
        return
    out = {
        "schema": SCHEMA, "source": "notion", "script_version": SCRIPT_VERSION, "generated_at": now_utc,
        "database_id": DB_ID, "currency": "USD", "note": NOTE, "lots": [], "by_sku": {},
        "meta": {"rows": 0, "archived_skipped": 0, "lots": 0, "lots_with_landed": 0, "lots_no_sku": 0, "lots_no_landed": 0,
                 "lots_received": 0, "lots_multi_sku": 0, "skus": 0, "first_ata": None, "last_ata": None,
                 "api_requests": client.requests if client else 0, "api_retries": client.retries if client else 0,
                 "pages": 0, "page_size": PAGE_SIZE, "notion_version": NOTION_VERSION,
                 "elapsed_s": round(time.time() - t0, 1) if t0 else 0, "carried_over": False, "error": short, "fetched_at": None},
    }
    write_file(OUTPUT_PATH, out)
    log(f"ERROR: {short} - no previous file, wrote an empty {OUTPUT_PATH}")


def main():
    t0 = time.time()
    now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if not TOKEN:
        keep_previous("NOTION_TOKEN is not set", now_utc)
        return 0
    client = Client(TOKEN)
    log(f"Notion {NOTION_VERSION}, database {DB_ID}, page size {PAGE_SIZE}")
    try:
        rows, pages = fetch_rows(client)
        out = build_output(rows, client, pages, t0, now_utc)
    except FatalError as e:
        keep_previous(e, now_utc, client, t0)
        return 0
    except Exception as e:  # noqa: BLE001 - never let the workflow go red: the previous file stands
        keep_previous(f"{type(e).__name__}: {e}", now_utc, client, t0)
        return 0
    write_file(OUTPUT_PATH, out)
    m = out["meta"]
    log(f"Wrote {OUTPUT_PATH}: {m['lots']} lots ({m['archived_skipped']} archived skipped) over {m['skus']} SKUs, "
        f"{m['lots_with_landed']} with landed cost, {m['lots_received']} received, {m['lots_no_sku']} without SKU; "
        f"ATA {m['first_ata']}..{m['last_ata']}; {m['api_requests']} API calls ({m['api_retries']} retries) in {m['elapsed_s']}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
