#!/usr/bin/env python3
"""
Cattasaurus - Shopify sales + Snowball (Social Snowball) affiliate commission fetcher.

Runs on a schedule (GitHub Actions) completely independently of Claude.
Pulls every order in a trailing window straight from the Shopify Admin GraphQL
API, buckets them by day in the SHOP's timezone (same days Shopify Analytics
shows), and writes data/shopify_pnl.json in the same spirit as amazon_pnl.json
and meta_ads.json - the hourly dashboard sync embeds it into the P&L page.

Why Snowball lives in here: Social Snowball has no public API, but it stamps
every referred order in Shopify with an order tag  "Referral - SS - <Program>"
and (when a code/link was used) an order attribute  __snowball = <affiliate>.
So the commission owed to influencers can be derived from Shopify alone:
    commission = commission base (order subtotal after discounts by default)
                 x the program's rate. Refunds on referred orders reverse the
                 commission on the refund date, like Snowball's own maturation logic.

Credentials come ONLY from environment variables (GitHub Actions Secrets).
Nothing is ever logged or written to the repo except the aggregated JSON.

Required env vars (Dev Dashboard app, client-credentials grant - the access
token is minted fresh every run and lives 24h, so nothing ever expires):
  SHOPIFY_SHOP             e.g. shoproxstore.myshopify.com
  SHOPIFY_CLIENT_ID        app Settings > Client ID
  SHOPIFY_CLIENT_SECRET    app Settings > Client secret
Alternative (legacy admin-created custom app): SHOPIFY_ACCESS_TOKEN (shpat_...)
instead of the client id/secret pair.

Optional env vars:
  SHOPIFY_API_VERSION      default 2026-07
  WINDOW_DAYS              trailing days to (re)fetch, default 45
  OUTPUT_PATH              default data/shopify_pnl.json
  HISTORY_START            days from this date on are kept in the file across runs (default
                           2025-01-01): a run refetches only its window and keeps the rest
  BACKFILL_START/_END      one-off run over a past range (YYYY-MM-DD, END defaults to today),
                           merged into the same file - run it in 2-3 month chunks
  PAGE_SIZE                orders per request, default 60 (auto-halves if the
                           API says the query cost is too high)
  LATE_ORDERS_MODE         which orders created BEFORE the window are scanned for
                           refunds issued inside it: "all" (default - every old order
                           updated inside the window; the only way to catch order
                           edits, which remove items from a PAID order without any
                           refund status) or "refunded" (only orders whose financial
                           status is refunded/partially refunded - fewer API calls,
                           misses order edits)
  SNOWBALL_TAG_PREFIX      default "Referral - SS - "
  SNOWBALL_ATTR_KEY        default "__snowball"
  SNOWBALL_PROGRAM_RATES   JSON {"Peekaboo Affiliate 15": 15}. Values > 1 are
                           percentages, values <= 1 are fractions (0.15).
                           A program missing here falls back to the trailing
                           number in its name ("... 15" -> 15%) with a warning,
                           then to SNOWBALL_DEFAULT_RATE.
  SNOWBALL_DEFAULT_RATE    default 0 (unknown program -> commission 0 + warning)
  SNOWBALL_COMMISSION_BASE subtotal (default: after discounts, before ship/tax)
                           | subtotal_shipping | subtotal_tax | total
                           (match Settings > Advanced > Revenue Calculation in
                           Snowball: include shipping / include tax toggles)
  SNOWBALL_CONVERSIONS_DIR default data/snowball_conversions - drop Snowball
                           "Conversions" CSV exports here (any file name). Orders
                           found in them use the exact commission Snowball
                           computed; every program's rate is also LEARNED from
                           them (median commission/revenue), which beats both the
                           configured table and the name heuristic, so a new or
                           changed program only needs a fresh export, never code.
                           Programs paid with a discount code ("10% off") cost no
                           cash - their commission is 0 (the discount is already
                           in Shopify's discounts line).

Rate precedence per program: learned from CSV > SNOWBALL_PROGRAM_RATES > number in
the program name > SNOWBALL_DEFAULT_RATE. Per order: exact CSV commission > rate x base.

Output (per day, shop currency, shop-timezone days) - every line is defined exactly
like the matching line of Shopify Analytics (Reports > Sales), so the day totals can
be checked against it to the cent:
  orders, gross_sales, discounts, net_sales (= gross - discounts, BEFORE returns;
  Shopify's "Net sales" = this - returns),
  returns  (Shopify "Returns" / sales_reversals: pre-tax value of returned items PLUS
            any extra money refunded, booked on the refund's processed date - see
            Aggregator.add_order for the exact formula),
  refunded_total (cash actually sent back incl. tax/shipping),
  refunded_shipping, refunded_tax (Shopify nets these out of "Shipping charges" and
            "Taxes" rather than out of returns),
  shipping, tax (as charged on the order date),
  total_sales (= net_sales - returns + shipping - refunded_shipping + tax - refunded_tax
            = Shopify "Total sales" whenever duties / additional fees are 0),
  snowball_orders, snowball_revenue (commission base of referred orders),
  snowball_commission (earned that day), snowball_reversals (commission clawed
  back by refunds that day), snowball_commission_net.
  payment_fees = Shopify Payments processing fees (OrderTransaction.fees on the SALE /
  CAPTURE transactions: rate x amount + flat fee, e.g. 2.25% + $0.30 domestic card,
  2.95% premium/Amex, 3.25% + $0.42 + 1.5% FX international) booked on the ORDER day like
  the revenue. Shopify does not return the fee when an order is refunded, so refunds add
  nothing. payment_fees_orders = orders whose fee came from Shopify; gateways{name:{orders,
  amount}} = what each gateway (shopify_payments, paypal, shop_cash, gift_card...) captured -
  PayPal's own fee is NOT in Shopify (needs the PayPal API), so paypal orders carry $0 here
  and are counted in fees_missing_orders.
Top-level "snowball" block: per-program and per-affiliate totals for the window.

Shipping discounts (free-shipping codes, 100%-off replacement orders): Order.totalDiscountsSet
includes them and totalShippingPriceSet is the pre-discount price; Shopify Analytics excludes
them from gross sales / discounts and reports shipping charges net of them, so the script nets
them out using Order.shippingLines original vs discounted price.

Order edits: Shopify Analytics books an item ADDED by an order edit on the edit date (and
the removed item as a return on that date). Order.subtotalPriceSet already contains the
added items, so for edited orders the script reads Shopify's sales ledger
(Order.agreements -> OrderEditAgreement.sales) and moves the additions to the edit date.

IMPORTANT - orders older than 60 days: without the read_all_orders access scope the
Admin API silently hides orders created more than 60 days ago, INCLUDING their refunds.
A return processed today on a 3-month-old order is then invisible and Shopify
Analytics' returns will be higher than ours. The script probes this every run and
reports it in meta.orders_visibility ("all" | "last_60_days") plus a warning.
"""
import json
import os
import re
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

SCRIPT_VERSION = "1.7"
SCHEMA = 2

SHOP = os.environ.get("SHOPIFY_SHOP", "").strip().lower().replace("https://", "").rstrip("/")
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2026-07").strip()
WINDOW_DAYS = int(os.environ.get("WINDOW_DAYS", "45"))
OUTPUT_PATH = os.environ.get("OUTPUT_PATH", "data/shopify_pnl.json")
PAGE_SIZE = int(os.environ.get("PAGE_SIZE", "60"))
LATE_ORDERS_MODE = os.environ.get("LATE_ORDERS_MODE", "all").strip().lower() or "all"
# Orders created more than this many days ago are hidden from apps without read_all_orders.
ORDER_VISIBILITY_DAYS = 60
TAG_PREFIX = os.environ.get("SNOWBALL_TAG_PREFIX", "Referral - SS - ")
ATTR_KEY = os.environ.get("SNOWBALL_ATTR_KEY", "__snowball")
COMMISSION_BASE = os.environ.get("SNOWBALL_COMMISSION_BASE", "subtotal").strip().lower()
DEFAULT_RATE = float(os.environ.get("SNOWBALL_DEFAULT_RATE", "0") or 0)
# Folder of Social Snowball "Conversions" CSV exports (Analytics > Export > Conversions).
# Every CSV found is read: rows give the EXACT commission per Shopify order id, and the
# per-program rate is learned from them for orders the exports don't cover.
CONVERSIONS_DIR = os.environ.get("SNOWBALL_CONVERSIONS_DIR", "data/snowball_conversions")
# Live conversions feed(s): comma/newline-separated CSV URLs fetched on every run, e.g. a
# Google Sheet that a Zapier zap (Social Snowball "New Conversion" -> "Create Spreadsheet
# Row") appends to, published via File > Share > Publish to web > CSV. Same columns as the
# Snowball export (Order ID, Program, Conversion Date, Revenue, Commission, Payout Status,
# Payout Method; header names are matched case-insensitively). Rows from URLs are read
# AFTER the files, so the live feed wins when both hold the same order.
CONVERSIONS_URLS = [u.strip() for u in re.split(r"[,\n]", os.environ.get("SNOWBALL_CONVERSIONS_URLS", "")) if u.strip()]

DAILY_FIELDS = [
    "orders", "gross_sales", "discounts", "net_sales", "returns", "refunded_total",
    "refunded_shipping", "refunded_tax",
    "shipping", "tax", "total_sales",
    "snowball_orders", "snowball_revenue", "snowball_commission", "snowball_reversals",
    "snowball_commission_net",
    "payment_fees", "payment_fees_orders", "fees_missing_orders",
]
MONEY_FIELDS = [f for f in DAILY_FIELDS if f not in ("orders", "snowball_orders", "payment_fees_orders", "fees_missing_orders")]
FEE_KINDS = {"SALE", "CAPTURE"}   # transaction kinds that carry Shopify Payments processing fees

# processedAt + orderAdjustments are what make "returns" equal Shopify Analytics'
# sales_reversals (see Aggregator.add_order). The small pageInfo blocks only tell us
# when a refund has more line items / adjustments than we asked for.
ORDERS_QUERY = """
query Orders($first: Int!, $after: String, $q: String, $refundsFirst: Int!) {
  orders(first: $first, after: $after, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt cancelledAt test displayFinancialStatus tags edited
      customAttributes { key value }
      subtotalPriceSet { shopMoney { amount } }
      totalDiscountsSet { shopMoney { amount } }
      totalShippingPriceSet { shopMoney { amount } }
      totalTaxSet { shopMoney { amount } }
      totalPriceSet { shopMoney { amount } }
      shippingLines(first: 5) {
        nodes { originalPriceSet { shopMoney { amount } } discountedPriceSet { shopMoney { amount } } }
      }
      transactions(first: 8) {
        kind status gateway processedAt
        amountSet { shopMoney { amount } }
        fees { type rateName rate amount { amount } flatFee { amount } }
      }
      refunds {
        id createdAt processedAt
        totalRefundedSet { shopMoney { amount } }
        refundShippingLines(first: 5) {
          nodes { subtotalAmountSet { shopMoney { amount } } taxAmountSet { shopMoney { amount } } }
        }
        refundLineItems(first: $refundsFirst) {
          pageInfo { hasNextPage }
          nodes {
            subtotalSet { shopMoney { amount } }
            totalTaxSet { shopMoney { amount } }
            lineItem { title requiresShipping }
          }
        }
        orderAdjustments(first: 20) {
          pageInfo { hasNextPage }
          nodes { reason amountSet { shopMoney { amount } } taxAmountSet { shopMoney { amount } } }
        }
      }
    }
  }
}
"""

# Shopify's own sales ledger for EDITED orders only. Order.subtotalPriceSet & co. already
# include items added by an order edit, but Shopify Analytics books those additions on the
# EDIT date, not on the order date. The OrderEditAgreement lists exactly what was added
# (actionType ORDER) - removals (actionType RETURN) are the refund we already process.
EDIT_AGREEMENTS_QUERY = """
query EditAgreements($ids: [ID!]!, $agreementsFirst: Int!, $salesFirst: Int!) {
  nodes(ids: $ids) {
    ... on Order {
      id
      agreements(first: $agreementsFirst) {
        pageInfo { hasNextPage }
        nodes {
          __typename id happenedAt reason
          sales(first: $salesFirst) {
            pageInfo { hasNextPage }
            nodes {
              actionType lineType
              totalAmount { shopMoney { amount } }
              totalDiscountAmountBeforeTaxes { shopMoney { amount } }
              totalTaxAmount { shopMoney { amount } }
            }
          }
        }
      }
    }
  }
}
"""
EDIT_BATCH = int(os.environ.get("EDIT_BATCH", "7"))
EDIT_LIMITS = (6, 20)        # agreements per order, sales per agreement (first pass)
EDIT_LIMITS_RETRY = (25, 80)  # one order per request when the first pass was truncated

# One cheap call: can this token see an order created before the 60-day visibility
# window at all? (Empty answer = read_all_orders missing, or a shop younger than that.)
VISIBILITY_PROBE_QUERY = """
query Probe($q: String) {
  orders(first: 1, query: $q, sortKey: CREATED_AT) { nodes { id createdAt } }
}
"""

SHOP_QUERY = "query { shop { name myshopifyDomain ianaTimezone currencyCode taxesIncluded } }"


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


def log(msg):
    print(f"[shopify_pnl] {msg}", file=sys.stderr, flush=True)


def money(node):
    """Read a MoneyBag{shopMoney{amount}} node safely as float."""
    try:
        return float(((node or {}).get("shopMoney") or {}).get("amount") or 0)
    except (TypeError, ValueError):
        return 0.0


def new_daily_bucket():
    d = {f: 0 for f in DAILY_FIELDS}
    d["gateways"] = {}        # gateway -> {orders, amount}: what each payment gateway captured
    d["payment_fee_types"] = {}   # Shopify Payments rateName -> fee amount (domestic 2.25%, amex, international, fx...)
    return d


def parse_rates(raw):
    """SNOWBALL_PROGRAM_RATES -> {program: fraction}."""
    out = {}
    if not raw:
        return out
    try:
        obj = json.loads(raw)
    except ValueError:
        log("SNOWBALL_PROGRAM_RATES is not valid JSON - ignoring it")
        return out
    for k, v in (obj or {}).items():
        try:
            v = float(v)
        except (TypeError, ValueError):
            continue
        out[str(k).strip()] = v / 100.0 if v > 1 else v
    return out


PROGRAM_RATES = parse_rates(os.environ.get("SNOWBALL_PROGRAM_RATES", ""))


CONVERSIONS = {}      # shopify order id (str) -> {"commission": float|None, "program", "method", "status", "revenue"}
LEARNED_RATES = {}    # program -> {"rate": fraction, "samples": n, "payout": "cash"|"discount_code"|"none"}
CONVERSION_FILES = []


def _money(v):
    """'$12.34', '12,34', ' 12.5 ' -> 12.34 / 12.34 / 12.5 ; anything else -> None."""
    s = (v or "").strip().replace("$", "").replace(" ", "")
    if not s:
        return None
    if s.count(",") == 1 and "." not in s:
        s = s.replace(",", ".")
    s = s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def _ingest_conversion_rows(rows, per_program):
    """Consume dict rows (Snowball export columns, header names case-insensitive). Returns rows used."""
    n = 0
    for raw in rows:
        row = {(k or "").strip().lower(): (v or "") for k, v in raw.items()}
        oid = row.get("order id", "").strip()
        if oid.startswith("gid://"):
            oid = oid.rsplit("/", 1)[-1]
        oid = oid.lstrip("#")
        program = row.get("program", "").strip()
        if not oid or not program:
            continue
        method = row.get("payout method", "").strip()
        status = row.get("payout status", "").strip()
        raw_c = row.get("commission", "").strip()
        rev = _money(row.get("revenue")) or 0.0
        # Zapier "New Referral Sale" rows (Google Sheet feed) carry the program's SETTING
        # instead of a computed commission: Commission Type (Percentage|Fixed), Commission
        # Amount (10 = 10% or $10) and Payout Type (cash|discount|store credit ...).
        ctype = row.get("commission type", "").strip().lower()
        camt = _money(row.get("commission amount"))
        ptype = row.get("payout type", "").strip().lower()
        if not method and ptype:
            method = "Discount Code" if "discount" in ptype else "Cash"
        commission = _money(raw_c)
        if commission is None and not raw_c and camt is not None:
            if method.lower() == "discount code":
                commission = 0.0
            elif ctype.startswith("percent") or (not ctype and camt <= 100):
                commission = round(rev * camt / 100.0, 2)
            else:
                commission = camt
        if commission is None:
            commission = 0.0 if (not raw_c or method.lower() == "discount code") else None
        if status.lower() == "voided":
            commission = 0.0
        CONVERSIONS[oid] = {"commission": commission, "program": program, "method": method,
                            "status": status, "revenue": rev}
        p = per_program.setdefault(program, {"rates": [], "methods": set(), "n": 0})
        p["n"] += 1
        p["methods"].add(method.lower())
        if commission is not None and rev > 0 and status.lower() != "voided" and method.lower() == "cash":
            p["rates"].append(commission / rev)
        n += 1
    return n


def _fetch_csv_text(url):
    req = urllib.request.Request(url, headers={"User-Agent": "cattasaurus-shopify-sync/" + SCRIPT_VERSION})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8-sig", errors="replace")


def load_conversions(warnings):
    """Read every Snowball conversions CSV in CONVERSIONS_DIR (safe if the folder is missing),
    then every live CSV feed in SNOWBALL_CONVERSIONS_URLS (a Zapier-filled Google Sheet)."""
    import csv
    import glob
    import io
    import statistics
    per_program = {}
    if os.path.isdir(CONVERSIONS_DIR):
        for path in sorted(glob.glob(os.path.join(CONVERSIONS_DIR, "*.csv"))):
            try:
                with open(path, newline="", encoding="utf-8-sig") as f:
                    n = _ingest_conversion_rows(csv.DictReader(f), per_program)
            except (OSError, csv.Error) as e:
                warnings.add(f"could not read Snowball export {os.path.basename(path)}: {e}")
                continue
            CONVERSION_FILES.append({"file": os.path.basename(path), "rows": n})
    for i, url in enumerate(CONVERSIONS_URLS, 1):
        label = f"live feed #{i}"
        try:
            text = _fetch_csv_text(url)
            n = _ingest_conversion_rows(csv.DictReader(io.StringIO(text)), per_program)
        except (OSError, urllib.error.URLError, csv.Error, ValueError) as e:
            warnings.add(f"could not read Snowball {label}: {e}")
            continue
        if n == 0:
            warnings.add(f"Snowball {label} returned no usable rows (check the sheet header row: Order ID, Program, Commission, Revenue ...)")
        CONVERSION_FILES.append({"file": label, "rows": n})
    for program, p in per_program.items():
        if p["rates"]:
            LEARNED_RATES[program] = {"rate": round(statistics.median(p["rates"]), 4), "samples": len(p["rates"]), "payout": "cash"}
        elif "discount code" in p["methods"] and "cash" not in p["methods"]:
            LEARNED_RATES[program] = {"rate": 0.0, "samples": p["n"], "payout": "discount_code"}
        else:
            LEARNED_RATES[program] = {"rate": 0.0, "samples": p["n"], "payout": "none"}


def canonical_program(program):
    """Shopify tags are capped at 40 characters, so a long program name arrives truncated
    ("15% CODE + 10% commissio"). Map it back to the full name seen in the exports/config."""
    if program in LEARNED_RATES or program in PROGRAM_RATES:
        return program
    if len(TAG_PREFIX) + len(program) >= 40:
        for known in list(LEARNED_RATES) + list(PROGRAM_RATES):
            if known.startswith(program) and known != program:
                return known
    return program


def rate_for_program(program, warnings, rate_sources):
    """Return the commission fraction for a Snowball program name."""
    program = canonical_program(program)
    if program in LEARNED_RATES:
        rate_sources[program] = "learned_from_export"
        return LEARNED_RATES[program]["rate"]
    if program in PROGRAM_RATES:
        rate_sources[program] = "configured"
        return PROGRAM_RATES[program]
    # "30% Commision" -> 30 ; "Peekaboo Affiliate 15" -> 15 (explicit % wins over a trailing number)
    m = re.search(r"(\d+(?:\.\d+)?)\s*%", program) or re.search(r"(\d+(?:\.\d+)?)\s*$", program)
    if m:
        v = float(m.group(1))
        if 0 < v <= 100:
            rate_sources[program] = "inferred_from_name"
            warnings.add(f"rate for Snowball program '{program}' inferred from its name ({v:g}%) - set SNOWBALL_PROGRAM_RATES to pin it")
            return v / 100.0
    rate_sources[program] = "default"
    warnings.add(f"no rate known for Snowball program '{program}' - using SNOWBALL_DEFAULT_RATE={DEFAULT_RATE:g}")
    return DEFAULT_RATE / 100.0 if DEFAULT_RATE > 1 else DEFAULT_RATE


# ---------------------------------------------------------------- HTTP layer
def http_post_json(url, headers, body, max_retries=6):
    data = body if isinstance(body, bytes) else json.dumps(body).encode()
    for attempt in range(1, max_retries + 1):
        req = urllib.request.Request(url, data=data, method="POST")
        for k, v in headers.items():
            req.add_header(k, v)
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            text = e.read().decode(errors="replace")
            if e.code in (401, 402, 403):
                log(f"Shopify auth/config error HTTP {e.code}: {text[:400]}")
                log("Check SHOPIFY_SHOP / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET, that the app is installed on the store, and that its released version has the read_orders scope.")
                raise SystemExit(2)
            if e.code == 429 or e.code >= 500:
                backoff = min(120, 5 * (2 ** (attempt - 1)))
                retry_after = e.headers.get("Retry-After")
                if retry_after:
                    try:
                        backoff = max(backoff, float(retry_after))
                    except ValueError:
                        pass
                log(f"HTTP {e.code} - retry {attempt}/{max_retries} in {backoff:.0f}s: {text[:200]}")
                time.sleep(backoff)
                continue
            log(f"HTTP {e.code}: {text[:500]}")
            raise
        except urllib.error.URLError as e:
            backoff = min(60, 5 * attempt)
            log(f"Network error ({e.reason}) - retry {attempt}/{max_retries} in {backoff}s")
            time.sleep(backoff)
    raise RuntimeError("Exceeded retries calling Shopify")


def get_access_token():
    """Client-credentials grant (Dev Dashboard app installed on the org's store).
    Token lives 24h; we mint a fresh one every run so nothing ever expires."""
    direct = os.environ.get("SHOPIFY_ACCESS_TOKEN", "").strip()
    if direct:
        return direct, "static_token", ""
    cid = os.environ.get("SHOPIFY_CLIENT_ID", "").strip()
    sec = os.environ.get("SHOPIFY_CLIENT_SECRET", "").strip()
    if not (cid and sec):
        log("Missing SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET (or SHOPIFY_ACCESS_TOKEN)")
        sys.exit(1)
    body = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": cid,
        "client_secret": sec,
    }).encode()
    resp = http_post_json(
        f"https://{SHOP}/admin/oauth/access_token",
        {"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
        body,
    )
    token = resp.get("access_token")
    if not token:
        log(f"Token endpoint returned no access_token: {json.dumps(resp)[:300]}")
        sys.exit(2)
    scope = resp.get("scope", "")
    if "read_orders" not in scope and "read_all_orders" not in scope:
        log(f"WARNING: granted scope is '{scope}' - read_orders missing. Add it to the app version, Release, and re-install the app.")
    return token, "client_credentials", scope


def probe_order_visibility(client, now_utc):
    """'all' when an order older than ORDER_VISIBILITY_DAYS is readable, 'last_60_days'
    when the API hides them (read_all_orders scope missing), 'unknown' on error."""
    cutoff = (now_utc - timedelta(days=ORDER_VISIBILITY_DAYS + 1)).strftime("%Y-%m-%dT00:00:00Z")
    try:
        data = client.query(VISIBILITY_PROBE_QUERY, {"q": f"created_at:<{cutoff}"})
    except (SystemExit, Exception) as e:  # noqa: BLE001 - a failed probe must never kill the sync
        log(f"visibility probe failed: {e}")
        return "unknown"
    nodes = ((data.get("orders") or {}).get("nodes") or [])
    return "all" if nodes else f"last_{ORDER_VISIBILITY_DAYS}_days"


class Client:
    def __init__(self, token):
        self.url = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
        self.headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-Shopify-Access-Token": token,
        }
        self.requests = 0
        self.cost_actual = 0
        self.cost_requested_max = 0
        self.throttled_waits = 0

    def query(self, query, variables=None):
        """Run one GraphQL query; retries on THROTTLED and adapts to the cost bucket."""
        for attempt in range(1, 8):
            resp = http_post_json(self.url, self.headers, {"query": query, "variables": variables or {}})
            self.requests += 1
            errors = resp.get("errors") or []
            cost = ((resp.get("extensions") or {}).get("cost") or {})
            self.cost_actual += cost.get("actualQueryCost") or 0
            self.cost_requested_max = max(self.cost_requested_max, cost.get("requestedQueryCost") or 0)
            throttle = cost.get("throttleStatus") or {}
            if errors:
                codes = {(e.get("extensions") or {}).get("code") for e in errors}
                msgs = "; ".join((e.get("message") or "")[:200] for e in errors)
                if "THROTTLED" in codes:
                    avail = throttle.get("currentlyAvailable") or 0
                    rate = throttle.get("restoreRate") or 50
                    need = cost.get("requestedQueryCost") or 500
                    wait = min(30, max(2, (need - avail) / max(rate, 1) + 1))
                    self.throttled_waits += 1
                    log(f"throttled (available {avail}) - waiting {wait:.0f}s")
                    time.sleep(wait)
                    continue
                if "MAX_COST_EXCEEDED" in codes:
                    raise CostTooHigh(msgs)
                if any("ACCESS_DENIED" in (c or "") for c in codes) or "requires merchant approval" in msgs or "Access denied" in msgs:
                    log(f"Shopify denied access: {msgs}")
                    log("The app's released version must include read_orders and the app must be (re)installed on the store after adding the scope.")
                    raise SystemExit(2)
                raise RuntimeError(f"GraphQL errors: {msgs}")
            # Proactively pace ourselves: if the bucket is nearly empty, sleep a bit
            # instead of bouncing off THROTTLED on the next call.
            avail = throttle.get("currentlyAvailable")
            need = cost.get("requestedQueryCost") or 0
            if avail is not None and need and avail < need:
                rate = throttle.get("restoreRate") or 50
                wait = min(20, (need - avail) / max(rate, 1) + 0.5)
                time.sleep(wait)
            return resp.get("data") or {}
        raise RuntimeError("Exceeded THROTTLED retries")


class CostTooHigh(Exception):
    pass


# ---------------------------------------------------------------- parsing
def local_day(iso_ts, tz):
    """'2026-09-17T19:13:23Z' -> 'YYYY-MM-DD' in the shop timezone."""
    if not iso_ts:
        return None
    dt = datetime.fromisoformat(iso_ts.replace("Z", "+00:00"))
    if tz is not None:
        dt = dt.astimezone(tz)
    return dt.strftime("%Y-%m-%d")


def snowball_program(tags):
    for t in tags or []:
        if isinstance(t, str) and t.startswith(TAG_PREFIX):
            name = t[len(TAG_PREFIX):].strip()
            if name:
                return canonical_program(name)
    return None


def affiliate_code(custom_attributes):
    for a in custom_attributes or []:
        if (a or {}).get("key") == ATTR_KEY:
            v = (a.get("value") or "").strip()
            return v or None
    return None


def is_tip_line(refund_line_item):
    """Shopify's tipping feature adds a non-shippable line item titled 'Tip' with no variant."""
    li = (refund_line_item or {}).get("lineItem") or {}
    return (li.get("title") or "").strip().lower() == "tip" and not li.get("requiresShipping", True)


def commission_base(subtotal, shipping, tax, total):
    if COMMISSION_BASE == "subtotal_shipping":
        return subtotal + shipping
    if COMMISSION_BASE == "subtotal_tax":
        return subtotal + tax
    if COMMISSION_BASE == "total":
        return total
    return subtotal


class Aggregator:
    def __init__(self, tz, window_start, window_end):
        self.tz = tz
        self.window_start = window_start   # 'YYYY-MM-DD' inclusive (shop tz)
        self.window_end = window_end       # 'YYYY-MM-DD' inclusive (shop tz)
        self.daily = {}
        self.warnings = set()
        self.rate_sources = {}
        self.programs = {}
        self.affiliates = {}
        self.seen_orders = set()
        self.edited = {}      # order gid -> {"order_day": day the sale was booked on, or None when not booked}
        self.counts = {
            "orders_seen": 0, "orders_counted": 0, "orders_skipped_test": 0,
            "orders_skipped_voided": 0, "orders_outside_window": 0,
            "refunds_counted": 0, "refunds_outside_window": 0,
            "refunds_with_adjustments": 0, "refunds_edit_removals": 0,
            "refund_lists_truncated": 0, "refund_tip_lines": 0,
            "orders_edited": 0, "edit_additions_moved": 0, "edit_lists_truncated": 0,
            "orders_with_shipping_discount": 0,
            "snowball_tagged": 0, "snowball_attr_without_tag": 0,
            "snowball_exact": 0, "snowball_export_without_tag": 0,
            "late_orders_scanned": 0, "late_refund_orders": 0,
            "fee_transactions": 0, "fees_missing_orders": 0, "transactions_truncated": 0,
        }
        self.gateways = {}

    def in_window(self, day):
        return day is not None and self.window_start <= day <= self.window_end

    def bucket(self, day):
        return self.daily.setdefault(day, new_daily_bucket())

    def add_order(self, o, late_refunds_only=False):
        oid = o.get("id")
        if oid in self.seen_orders:
            return
        self.seen_orders.add(oid)
        self.counts["orders_seen"] += 1
        if o.get("test"):
            self.counts["orders_skipped_test"] += 1
            return
        status = (o.get("displayFinancialStatus") or "").upper()
        if o.get("cancelledAt") and status == "VOIDED":
            # cancelled before any money moved - never a sale, never a return
            self.counts["orders_skipped_voided"] += 1
            return

        subtotal = money(o.get("subtotalPriceSet"))
        discounts = money(o.get("totalDiscountsSet"))
        shipping = money(o.get("totalShippingPriceSet"))
        tax = money(o.get("totalTaxSet"))
        total = money(o.get("totalPriceSet"))
        # A shipping discount (free-shipping code, 100%-off replacement order) sits inside
        # totalDiscountsSet and totalShippingPriceSet is the price BEFORE it. Shopify Analytics
        # keeps shipping discounts out of gross sales / discounts and reports "Shipping charges"
        # net of them, so net them out here the same way.
        ship_disc = 0.0
        for sl in ((o.get("shippingLines") or {}).get("nodes") or []):
            ship_disc += max(0.0, money(sl.get("originalPriceSet")) - money(sl.get("discountedPriceSet")))
        if ship_disc > 0.004:
            ship_disc = min(ship_disc, discounts, shipping)
            discounts -= ship_disc
            shipping -= ship_disc
            self.counts["orders_with_shipping_discount"] += 1
        program = snowball_program(o.get("tags"))
        code = affiliate_code(o.get("customAttributes"))
        rate = rate_for_program(program, self.warnings, self.rate_sources) if program else 0.0
        base = commission_base(subtotal, shipping, tax, total) if program else 0.0
        # Exact commission from a Snowball conversions export beats rate x base.
        legacy_id = (oid or "").rsplit("/", 1)[-1]
        conv = CONVERSIONS.get(legacy_id)
        if program and conv is not None and conv["commission"] is not None:
            self.counts["snowball_exact"] += 1
            if base > 0:
                rate = conv["commission"] / base   # so refund reversals stay proportional
            else:
                base = conv["revenue"]
                rate = (conv["commission"] / base) if base > 0 else 0.0
            if conv["program"] != program:
                self.warnings.add(f"program mismatch on order {legacy_id}: Shopify tag '{program}' vs export '{conv['program']}' - using the export's commission")
        elif not program and conv is not None and conv["commission"]:
            self.counts["snowball_export_without_tag"] += 1

        day = local_day(o.get("createdAt"), self.tz)
        booked = bool(not late_refunds_only and self.in_window(day))
        if o.get("edited"):
            # items added by an order edit are inside these order-level totals; they are moved
            # to the edit date once the ledger is fetched (see apply_edit_agreements)
            self.edited[oid] = {"order_day": day if booked else None}
            self.counts["orders_edited"] += 1
        if booked:
            d = self.bucket(day)
            d["orders"] += 1
            d["gross_sales"] += subtotal + discounts
            d["discounts"] += discounts
            d["net_sales"] += subtotal
            d["shipping"] += shipping
            d["tax"] += tax
            self.counts["orders_counted"] += 1
            self.add_payment_fees(o, d)
            if program:
                self.counts["snowball_tagged"] += 1
                d["snowball_orders"] += 1
                d["snowball_revenue"] += base
                d["snowball_commission"] += base * rate
                p = self.programs.setdefault(program, {"rate": rate, "orders": 0, "revenue": 0.0, "commission": 0.0, "reversals": 0.0})
                p["orders"] += 1
                p["revenue"] += base
                p["commission"] += base * rate
                akey = code or f"(link / no code) · {program}"
                af = self.affiliates.setdefault(akey, {"program": program, "orders": 0, "revenue": 0.0, "commission": 0.0, "reversals": 0.0})
                af["orders"] += 1
                af["revenue"] += base
                af["commission"] += base * rate
            elif code:
                self.counts["snowball_attr_without_tag"] += 1
        elif not late_refunds_only:
            self.counts["orders_outside_window"] += 1

        # Refunds are booked on the day Shopify PROCESSED them, exactly like the "Returns"
        # (sales_reversals) line of Shopify Analytics. Per refund Shopify reverses
        #
        #     returned_value = SUM(refundLineItems.subtotal) - SUM(orderAdjustments.amount)
        #
        # i.e. the pre-tax value of the returned items PLUS any money refunded on top of
        # (or instead of) items: Shopify books that extra money as a NEGATIVE "refund
        # discrepancy" order adjustment (a $20 goodwill refund with no line item is one
        # adjustment of -20). A $0-cash line-item refund - an order edit that removes an
        # item, or a return whose money is sent in a later refund - carries a POSITIVE
        # adjustment cancelling its money, and the later money-only refund carries the
        # negative one, so summing the adjustments of every refund reproduces Shopify's
        # daily sales_reversals to the cent (verified against ShopifyQL, Sep 2026).
        # Refunded shipping and refunded tax are kept apart because Shopify nets them out
        # of "Shipping charges" / "Taxes", not out of returns. Negative returned_value is
        # rare but real (failed refund transaction on a return) and left as-is so the day
        # still matches Shopify. A refunded "Tip" line is skipped: tips are never part of
        # gross sales (Order.subtotalPriceSet excludes them too), so Shopify does not
        # reverse them either.
        refunds = o.get("refunds") or []
        reversed_so_far = 0.0
        touched_window = False
        for r in refunds:
            li_nodes = [li for li in ((r.get("refundLineItems") or {}).get("nodes") or []) if not is_tip_line(li)]
            self.counts["refund_tip_lines"] += len(((r.get("refundLineItems") or {}).get("nodes") or [])) - len(li_nodes)
            sl_nodes = ((r.get("refundShippingLines") or {}).get("nodes") or [])
            adj_nodes = ((r.get("orderAdjustments") or {}).get("nodes") or [])
            for key in ("refundLineItems", "orderAdjustments"):
                if ((r.get(key) or {}).get("pageInfo") or {}).get("hasNextPage"):
                    self.counts["refund_lists_truncated"] += 1
                    self.warnings.add(f"refund {r.get('id')} has more {key} than fetched - raise the page size in ORDERS_QUERY")
            items_sub = sum(money(li.get("subtotalSet")) for li in li_nodes)
            items_tax = sum(money(li.get("totalTaxSet")) for li in li_nodes)
            ship_ref = sum(money(sl.get("subtotalAmountSet")) for sl in sl_nodes)
            ship_tax = sum(money(sl.get("taxAmountSet")) for sl in sl_nodes)
            adj_amount = sum(money(a.get("amountSet")) for a in adj_nodes)
            adj_tax = sum(money(a.get("taxAmountSet")) for a in adj_nodes)
            refunded_total = money(r.get("totalRefundedSet"))
            rday = local_day(r.get("processedAt") or r.get("createdAt"), self.tz)
            if not self.in_window(rday):
                self.counts["refunds_outside_window"] += 1
                continue
            touched_window = True
            returned_value = items_sub - adj_amount
            refunded_tax = items_tax + ship_tax - adj_tax
            d = self.bucket(rday)
            d["returns"] += returned_value
            d["refunded_shipping"] += ship_ref
            d["refunded_tax"] += refunded_tax
            d["refunded_total"] += refunded_total
            self.counts["refunds_counted"] += 1
            if adj_nodes:
                self.counts["refunds_with_adjustments"] += 1
            elif li_nodes and refunded_total == 0:
                self.counts["refunds_edit_removals"] += 1   # order edit: item removed, no money moved
            if program and rate > 0 and returned_value > 0:
                rev_base = returned_value
                if COMMISSION_BASE in ("subtotal_shipping", "total"):
                    rev_base += ship_ref
                if COMMISSION_BASE in ("subtotal_tax", "total"):
                    rev_base += max(0.0, refunded_tax)
                reversal = rev_base * rate
                if base > 0:  # never claw back more than the order earned
                    reversal = min(reversal, base * rate - reversed_so_far)
                reversal = max(0.0, reversal)
                reversed_so_far += reversal
                d["snowball_reversals"] += reversal
                p = self.programs.setdefault(program, {"rate": rate, "orders": 0, "revenue": 0.0, "commission": 0.0, "reversals": 0.0})
                p["reversals"] += reversal
                akey = code or f"(link / no code) · {program}"
                af = self.affiliates.setdefault(akey, {"program": program, "orders": 0, "revenue": 0.0, "commission": 0.0, "reversals": 0.0})
                af["reversals"] += reversal
        if late_refunds_only:
            self.counts["late_orders_scanned"] += 1
            if touched_window:
                self.counts["late_refund_orders"] += 1

    def apply_edit_agreements(self, oid, agreements):
        """Move what an order edit ADDED from the order date to the edit date, the way Shopify
        Analytics books it. Returns True when the agreement lists were complete."""
        info = self.edited.get(oid)
        if info is None:
            return True
        applied = info.setdefault("applied", set())
        complete = not ((agreements.get("pageInfo") or {}).get("hasNextPage"))
        for ag in (agreements.get("nodes") or []):
            if ag.get("__typename") != "OrderEditAgreement" and ag.get("reason") != "ORDER_EDIT":
                continue
            if ag.get("id") in applied:
                continue
            sales = ag.get("sales") or {}
            if (sales.get("pageInfo") or {}).get("hasNextPage"):
                complete = False   # apply nothing from a partial list - the retry re-reads it whole
                continue
            applied.add(ag.get("id"))
            gross_add = disc_add = tax_add = ship_add = 0.0
            for s in (sales.get("nodes") or []):
                if s.get("actionType") == "RETURN":
                    continue        # a removal = the $0 refund we already booked from Order.refunds
                total = money(s.get("totalAmount"))
                disc = money(s.get("totalDiscountAmountBeforeTaxes"))
                tax = money(s.get("totalTaxAmount"))
                lt = s.get("lineType")
                if lt == "PRODUCT":
                    gross_add += total - tax + disc
                    disc_add += disc
                    tax_add += tax
                elif lt == "SHIPPING":
                    ship_add += total - tax      # shipping charges are net of shipping discounts
                    tax_add += tax
                # TIP / DUTY / FEE / GIFT_CARD lines are not sales in Shopify Analytics either
            if not any(abs(v) > 0.004 for v in (gross_add, disc_add, tax_add, ship_add)):
                continue
            edit_day = local_day(ag.get("happenedAt"), self.tz)
            moves = (("gross_sales", gross_add), ("discounts", disc_add), ("net_sales", gross_add - disc_add),
                     ("tax", tax_add), ("shipping", ship_add))
            if info["order_day"] is not None:
                src = self.bucket(info["order_day"])
                for f, v in moves:
                    src[f] -= v
            if self.in_window(edit_day):
                dst = self.bucket(edit_day)
                for f, v in moves:
                    dst[f] += v
            self.counts["edit_additions_moved"] += 1
        return complete

    def add_payment_fees(self, o, d):
        """Shopify Payments processing fees of the order's SALE/CAPTURE transactions -> the order
        day (same basis as the revenue). Other gateways expose no fee (PayPal charges its own)."""
        txs = o.get("transactions") or []
        if len(txs) >= 8:
            self.counts["transactions_truncated"] += 1
        fee_total, fee_found, paid_by = 0.0, False, {}
        for t in txs:
            if (t.get("status") or "").upper() != "SUCCESS" or (t.get("kind") or "").upper() not in FEE_KINDS:
                continue
            gw = (t.get("gateway") or "unknown").lower()
            amt = money(t.get("amountSet"))
            g = paid_by.setdefault(gw, 0.0)
            paid_by[gw] = g + amt
            for fee in (t.get("fees") or []):
                a = float(((fee.get("amount") or {}).get("amount")) or 0)
                fee_total += a
                fee_found = True
                self.counts["fee_transactions"] += 1
                name = fee.get("rateName") or fee.get("type") or "fee"
                d["payment_fee_types"][name] = d["payment_fee_types"].get(name, 0.0) + a
        for gw, amt in paid_by.items():
            g = d["gateways"].setdefault(gw, {"orders": 0, "amount": 0.0})
            g["orders"] += 1
            g["amount"] += amt
            gg = self.gateways.setdefault(gw, {"orders": 0, "amount": 0.0, "fees": 0.0})
            gg["orders"] += 1
            gg["amount"] += amt
        d["payment_fees"] += fee_total
        if fee_found:
            d["payment_fees_orders"] += 1
            self.gateways.setdefault("shopify_payments", {"orders": 0, "amount": 0.0, "fees": 0.0})["fees"] += fee_total
        elif paid_by:
            # money was captured but no fee is exposed (PayPal, gift card, manual...) - the P&L
            # shows $0 for it until that gateway's own fee source is connected
            d["fees_missing_orders"] += 1
            self.counts["fees_missing_orders"] += 1

    def finalise(self):
        for d in self.daily.values():
            # = Shopify Analytics "Total sales" (net sales + shipping charges + taxes,
            # both already net of what was refunded) when duties/additional fees are 0.
            d["total_sales"] = (d["net_sales"] - d["returns"]
                                + d["shipping"] - d["refunded_shipping"]
                                + d["tax"] - d["refunded_tax"])
            d["snowball_commission_net"] = d["snowball_commission"] - d["snowball_reversals"]
            for f in MONEY_FIELDS:
                d[f] = round(d[f], 2)
            for g in d["gateways"].values():
                g["amount"] = round(g["amount"], 2)
            for k in list(d["payment_fee_types"]):
                d["payment_fee_types"][k] = round(d["payment_fee_types"][k], 2)
        for g in self.gateways.values():
            for f in ("amount", "fees"):
                g[f] = round(g[f], 2)
        for coll in (self.programs, self.affiliates):
            for v in coll.values():
                for f in ("revenue", "commission", "reversals"):
                    v[f] = round(v[f], 2)
                v["commission_net"] = round(v["commission"] - v["reversals"], 2)


def sum_range(daily, start_key, end_key):
    out = new_daily_bucket()
    for k, d in daily.items():
        if start_key <= k <= end_key:
            for f in DAILY_FIELDS:
                out[f] += d.get(f, 0)
    for f in MONEY_FIELDS:
        out[f] = round(out[f], 2)
    return out


# ---------------------------------------------------------------- fetching
def fetch_orders(client, q, agg, late_refunds_only=False):
    page_size = PAGE_SIZE
    refunds_first = 25   # line items per refund; a truncated refund is reported in meta.warnings
    after = None
    pages = 0
    while True:
        try:
            data = client.query(ORDERS_QUERY, {"first": page_size, "after": after, "q": q, "refundsFirst": refunds_first})
        except CostTooHigh as e:
            if page_size <= 10:
                raise
            page_size = max(10, page_size // 2)
            log(f"query cost too high ({e}) - retrying with PAGE_SIZE={page_size}")
            continue
        conn = data.get("orders") or {}
        nodes = conn.get("nodes") or []
        for o in nodes:
            agg.add_order(o, late_refunds_only=late_refunds_only)
        pages += 1
        info = conn.get("pageInfo") or {}
        if pages % 10 == 0 or not info.get("hasNextPage"):
            log(f"  page {pages}: {len(nodes)} orders (cumulative seen {agg.counts['orders_seen']})")
        if not info.get("hasNextPage"):
            break
        after = info.get("endCursor")
    return pages


def fetch_edit_agreements(client, agg):
    """Second pass for edited orders only: pull their sales ledger and move edit additions
    to the edit date. Batches shrink automatically when Shopify says the query is too costly;
    a truncated ledger is re-read alone with bigger limits."""
    ids = list(agg.edited)
    if not ids:
        return 0
    requests = 0

    def run(order_ids, batch, limits):
        nonlocal requests
        pending = list(order_ids)
        truncated = []
        while pending:
            chunk, pending = pending[:batch], pending[batch:]
            try:
                data = client.query(EDIT_AGREEMENTS_QUERY, {"ids": chunk, "agreementsFirst": limits[0], "salesFirst": limits[1]})
            except CostTooHigh as e:
                if batch <= 1:
                    raise
                pending = chunk + pending
                batch = max(1, batch // 2)
                log(f"edit-agreements query too costly ({e}) - retrying with batches of {batch}")
                continue
            requests += 1
            for node in (data.get("nodes") or []):
                if node and not agg.apply_edit_agreements(node.get("id"), node.get("agreements") or {}):
                    truncated.append(node.get("id"))
        return truncated

    # apply_edit_agreements skips agreements it has already booked and ignores any agreement
    # whose sales list was cut off, so re-reading a truncated order alone with bigger limits
    # is safe (nothing is ever double-booked).
    still = run(ids, max(1, EDIT_BATCH), EDIT_LIMITS)
    if still:
        still = run(still, 1, EDIT_LIMITS_RETRY)
    for oid in still:
        agg.counts["edit_lists_truncated"] += 1
        agg.warnings.add(f"order {oid} has more agreements/sales than fetched even at {EDIT_LIMITS_RETRY} - some edit additions stay on the order date")
    log(f"  edited orders: {len(ids)}, edit additions moved to their edit date: {agg.counts['edit_additions_moved']}, ledger requests: {requests}")
    return requests


def main():
    if not SHOP:
        log("Missing SHOPIFY_SHOP (e.g. yourstore.myshopify.com)")
        sys.exit(1)
    token, auth_mode, scope = get_access_token()
    client = Client(token)

    shop = (client.query(SHOP_QUERY).get("shop") or {})
    # REPORT_TIMEZONE (shared by every fetcher, default America/Los_Angeles) wins over the
    # shop's own timezone so all P&L sources bucket on the same calendar days.
    tzname = os.environ.get("REPORT_TIMEZONE", "").strip() or shop.get("ianaTimezone") or "UTC"
    if shop.get("ianaTimezone") and tzname != shop.get("ianaTimezone"):
        log(f"NOTE: bucketing days in {tzname} (REPORT_TIMEZONE), shop timezone is {shop.get('ianaTimezone')} - Shopify Analytics will differ at day edges")
    tz = None
    if ZoneInfo is not None:
        try:
            tz = ZoneInfo(tzname)
        except Exception:  # noqa: BLE001
            log(f"unknown timezone {tzname!r} - falling back to UTC")
            tz = timezone.utc
    else:
        tz = timezone.utc
    if shop.get("taxesIncluded"):
        log("WARNING: shop prices include tax - subtotal-based figures include tax too")

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
    agg = Aggregator(tz, window_start, window_end)
    load_conversions(agg.warnings)
    if CONVERSION_FILES:
        log(f"Loaded {len(CONVERSIONS)} Snowball conversions from {len(CONVERSION_FILES)} export file(s); learned rates for {len(LEARNED_RATES)} programs")
    else:
        log(f"No Snowball conversions export found in {CONVERSIONS_DIR} - using configured/name-based rates")
    if shop.get("taxesIncluded"):
        agg.warnings.add("shop has taxesIncluded=true: net_sales/gross_sales include tax")

    # Orders created in the window (query in UTC with a day of slack on each side;
    # the aggregator re-buckets by shop-local day and drops anything outside).
    q_start = (datetime.strptime(window_start, "%Y-%m-%d") - timedelta(days=2)).strftime("%Y-%m-%dT00:00:00Z")
    q = f"created_at:>={q_start}"
    if mode == "backfill":
        q_end = (datetime.strptime(window_end, "%Y-%m-%d") + timedelta(days=2)).strftime("%Y-%m-%dT00:00:00Z")
        q += f" AND created_at:<{q_end}"
    log(f"Shop {shop.get('name')} ({shop.get('myshopifyDomain')}), tz {tzname}, {mode} {window_start}..{window_end}, auth {auth_mode}, API {API_VERSION}, history from {HISTORY_START}")
    visibility = probe_order_visibility(client, now_utc)
    if visibility == "all":
        log("order visibility: all orders (read_all_orders OK)")
    else:
        log(f"order visibility: {visibility} - refunds on orders older than {ORDER_VISIBILITY_DAYS} days are INVISIBLE to this token; "
            "grant the app the read_all_orders scope (and re-install it) so returns match Shopify Analytics")
        agg.warnings.add(f"orders older than {ORDER_VISIBILITY_DAYS} days are hidden from this app (read_all_orders scope missing) - "
                         "returns on such orders are not counted, so Shopify Analytics' returns will be higher than ours")
    log(f"Fetching orders {q} ...")
    pages = fetch_orders(client, q, agg)

    # Refunds issued inside the window on orders created BEFORE it (a return today on a
    # 50-day-old order, or an order EDIT removing an item from an old PAID order). Order
    # edits leave the financial status at "paid", so by default every old order updated
    # inside the window is scanned; LATE_ORDERS_MODE=refunded keeps the cheaper filter.
    if LATE_ORDERS_MODE == "refunded":
        q_late = (f"created_at:<{q_start} AND updated_at:>={q_start} AND "
                  f"(financial_status:refunded OR financial_status:partially_refunded)")
    else:
        q_late = f"created_at:<{q_start} AND updated_at:>={q_start}"
    log(f"Fetching late refunds ({LATE_ORDERS_MODE}) {q_late} ...")
    pages += fetch_orders(client, q_late, agg, late_refunds_only=True)
    log(f"  late orders scanned: {agg.counts['late_orders_scanned']}, with refunds in the window: {agg.counts['late_refund_orders']}")

    # Edited orders: book what an edit added on the edit date (Shopify Analytics does).
    log(f"Fetching sales ledger for {len(agg.edited)} edited orders ...")
    pages += fetch_edit_agreements(client, agg)

    agg.finalise()
    # merge with the copy already in the repo: days outside the fetched range are kept
    previous = history_previous(OUTPUT_PATH)
    daily = history_merge(previous, agg.daily, window_start, window_end)
    hist = history_meta(previous, mode, window_start, window_end, daily, today_key)
    log(f"History: {hist['first_day']}..{hist['last_day']} ({hist['days']} days, {hist['missing_count']} missing since {HISTORY_START})")
    if agg.counts["snowball_attr_without_tag"]:
        agg.warnings.add(f"{agg.counts['snowball_attr_without_tag']} orders carry the {ATTR_KEY} attribute but no '{TAG_PREFIX}*' tag (Snowball rejected/untracked them) - not counted as referrals")
    if not agg.programs:
        agg.warnings.add(f"no orders tagged '{TAG_PREFIX}*' in the window - check that 'Tag referral orders in Shopify' is ON for every Snowball program")

    mtd_start = now_local.strftime("%Y-%m-01")
    last30_start = (now_local - timedelta(days=30)).strftime("%Y-%m-%d")

    out = {
        "source": "shopify_admin_graphql",
        "generated_at": now_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "shop": shop.get("myshopifyDomain") or SHOP,
        "shop_name": shop.get("name"),
        "timezone": tzname,
        "currency": shop.get("currencyCode") or "USD",
        "api_version": API_VERSION,
        "window_days": WINDOW_DAYS,
        "window": {"start": window_start, "end": window_end},
        "daily": daily,
        "totals": {
            "today": sum_range(daily, today_key, today_key),
            "mtd": sum_range(daily, mtd_start, today_key),
            "last_30d": sum_range(daily, last30_start, today_key),
        },
        "snowball": {
            "tag_prefix": TAG_PREFIX,
            "attribute_key": ATTR_KEY,
            "commission_base": COMMISSION_BASE,
            "rate_sources": agg.rate_sources,
            "rates_learned": LEARNED_RATES,
            "conversions_exports": CONVERSION_FILES,
            "conversions_loaded": len(CONVERSIONS),
            "programs": agg.programs,
            "affiliates": dict(sorted(agg.affiliates.items(), key=lambda kv: -kv[1]["commission"])),
            "window_totals": {
                "orders": sum(p["orders"] for p in agg.programs.values()),
                "revenue": round(sum(p["revenue"] for p in agg.programs.values()), 2),
                "commission": round(sum(p["commission"] for p in agg.programs.values()), 2),
                "reversals": round(sum(p["reversals"] for p in agg.programs.values()), 2),
                "commission_net": round(sum(p["commission_net"] for p in agg.programs.values()), 2),
            },
        },
        "meta": {
            "script_version": SCRIPT_VERSION,
            "schema": SCHEMA,
            "history": hist,
            "auth_mode": auth_mode,
            "granted_scope": scope,
            "orders_visibility": visibility,
            "late_orders_mode": LATE_ORDERS_MODE,
            "returns_basis": "shopify_sales_reversals",   # returns = SUM(refund line items) - SUM(order adjustments), by processed date
            "payment_fees_basis": "shopify_payments_transaction_fees_on_order_day",   # OrderTransaction.fees (SALE/CAPTURE), not refunded on refunds
            "gateways": agg.gateways,
            "order_edits": "booked_on_edit_date",         # items added by an order edit count on the edit date (Order.agreements ledger)
            "pages": pages,
            "api_requests": client.requests,
            "api_cost_actual": client.cost_actual,
            "api_cost_requested_max": client.cost_requested_max,
            "throttled_waits": client.throttled_waits,
            "counts": agg.counts,
            "warnings": sorted(agg.warnings),
        },
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH) or ".", exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(out, f, indent=2, sort_keys=True)
    log(f"Wrote {OUTPUT_PATH}: {agg.counts['orders_counted']} orders over {len(agg.daily)} fetched days ({len(daily)} days in file), "
        f"{agg.counts['snowball_tagged']} Snowball referrals (commission net "
        f"{out['snowball']['window_totals']['commission_net']:.2f} {out['currency']}), "
        f"{client.requests} API calls, {len(agg.warnings)} warning types.")


if __name__ == "__main__":
    main()
