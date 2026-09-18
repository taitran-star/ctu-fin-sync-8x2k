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
  PAGE_SIZE                orders per request, default 60 (auto-halves if the
                           API says the query cost is too high)
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

Output (per day, shop currency, all positive numbers, shop-timezone days):
  orders, gross_sales, discounts, net_sales (= gross - discounts, before returns),
  returns (item value refunded, pre-tax, on the REFUND date), refunded_total
  (money actually sent back incl. tax/shipping), shipping, tax,
  total_sales (= net_sales - returns + shipping + tax),
  snowball_orders, snowball_revenue (commission base of referred orders),
  snowball_commission (earned that day), snowball_reversals (commission clawed
  back by refunds that day), snowball_commission_net.
Top-level "snowball" block: per-program and per-affiliate totals for the window.
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

SCRIPT_VERSION = "1.3"
SCHEMA = 1

SHOP = os.environ.get("SHOPIFY_SHOP", "").strip().lower().replace("https://", "").rstrip("/")
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2026-07").strip()
WINDOW_DAYS = int(os.environ.get("WINDOW_DAYS", "45"))
OUTPUT_PATH = os.environ.get("OUTPUT_PATH", "data/shopify_pnl.json")
PAGE_SIZE = int(os.environ.get("PAGE_SIZE", "60"))
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
    "shipping", "tax", "total_sales",
    "snowball_orders", "snowball_revenue", "snowball_commission", "snowball_reversals",
    "snowball_commission_net",
]
MONEY_FIELDS = [f for f in DAILY_FIELDS if f not in ("orders", "snowball_orders")]

ORDERS_QUERY = """
query Orders($first: Int!, $after: String, $q: String, $refundsFirst: Int!) {
  orders(first: $first, after: $after, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt cancelledAt test displayFinancialStatus tags
      customAttributes { key value }
      subtotalPriceSet { shopMoney { amount } }
      totalDiscountsSet { shopMoney { amount } }
      totalShippingPriceSet { shopMoney { amount } }
      totalTaxSet { shopMoney { amount } }
      totalPriceSet { shopMoney { amount } }
      refunds {
        id createdAt
        totalRefundedSet { shopMoney { amount } }
        refundShippingLines(first: 3) { nodes { subtotalAmountSet { shopMoney { amount } } } }
        refundLineItems(first: $refundsFirst) {
          nodes {
            subtotalSet { shopMoney { amount } }
            totalTaxSet { shopMoney { amount } }
          }
        }
      }
    }
  }
}
"""

SHOP_QUERY = "query { shop { name myshopifyDomain ianaTimezone currencyCode taxesIncluded } }"


def log(msg):
    print(f"[shopify_pnl] {msg}", file=sys.stderr, flush=True)


def money(node):
    """Read a MoneyBag{shopMoney{amount}} node safely as float."""
    try:
        return float(((node or {}).get("shopMoney") or {}).get("amount") or 0)
    except (TypeError, ValueError):
        return 0.0


def new_daily_bucket():
    return {f: 0 for f in DAILY_FIELDS}


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
        return direct, "static_token"
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
    return token, "client_credentials"


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
        self.counts = {
            "orders_seen": 0, "orders_counted": 0, "orders_skipped_test": 0,
            "orders_skipped_voided": 0, "orders_outside_window": 0,
            "refunds_counted": 0, "refunds_outside_window": 0,
            "snowball_tagged": 0, "snowball_attr_without_tag": 0,
            "snowball_exact": 0, "snowball_export_without_tag": 0,
            "late_refund_orders": 0,
        }

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
        if not late_refunds_only and self.in_window(day):
            d = self.bucket(day)
            d["orders"] += 1
            d["gross_sales"] += subtotal + discounts
            d["discounts"] += discounts
            d["net_sales"] += subtotal
            d["shipping"] += shipping
            d["tax"] += tax
            self.counts["orders_counted"] += 1
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

        # Refunds are booked on the refund date (Shopify Analytics "Returns" does the same).
        # Shopify often records ONE return as TWO Refund objects: one carrying the
        # returned line items with $0 money, another carrying the money with no line
        # items. So decide per ORDER: when any refund lists line items, the returned
        # value is the line items' subtotal (pre-tax) and money-only refunds are just
        # cash movements of the same return; only when no refund lists items at all
        # (goodwill / price adjustment) is the money itself the returned value.
        refunds = o.get("refunds") or []
        parsed = []
        items_total = 0.0
        for r in refunds:
            items_sub = sum(money(li.get("subtotalSet")) for li in ((r.get("refundLineItems") or {}).get("nodes") or []))
            ship_ref = sum(money(sl.get("subtotalAmountSet")) for sl in ((r.get("refundShippingLines") or {}).get("nodes") or []))
            refunded_total = money(r.get("totalRefundedSet"))
            items_total += items_sub
            parsed.append((local_day(r.get("createdAt"), self.tz), items_sub, ship_ref, refunded_total))
        reversed_so_far = 0.0
        for rday, items_sub, ship_ref, refunded_total in parsed:
            if not self.in_window(rday):
                self.counts["refunds_outside_window"] += 1
                continue
            if items_total > 0:
                returned_value = items_sub
            else:
                returned_value = max(0.0, refunded_total - ship_ref)
            d = self.bucket(rday)
            d["returns"] += returned_value
            d["refunded_total"] += refunded_total
            self.counts["refunds_counted"] += 1
            if program and rate > 0 and returned_value > 0:
                rev_base = returned_value + (ship_ref if COMMISSION_BASE in ("subtotal_shipping", "total") else 0.0)
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
            self.counts["late_refund_orders"] += 1

    def finalise(self):
        for d in self.daily.values():
            d["total_sales"] = d["net_sales"] - d["returns"] + d["shipping"] + d["tax"]
            d["snowball_commission_net"] = d["snowball_commission"] - d["snowball_reversals"]
            for f in MONEY_FIELDS:
                d[f] = round(d[f], 2)
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
    refunds_first = 10
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


def main():
    if not SHOP:
        log("Missing SHOPIFY_SHOP (e.g. yourstore.myshopify.com)")
        sys.exit(1)
    token, auth_mode = get_access_token()
    client = Client(token)

    shop = (client.query(SHOP_QUERY).get("shop") or {})
    tzname = shop.get("ianaTimezone") or "UTC"
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
    window_end = now_local.strftime("%Y-%m-%d")
    window_start = (now_local - timedelta(days=WINDOW_DAYS)).strftime("%Y-%m-%d")
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
    q_start = (now_utc - timedelta(days=WINDOW_DAYS + 2)).strftime("%Y-%m-%dT00:00:00Z")
    q = f"created_at:>={q_start}"
    log(f"Shop {shop.get('name')} ({shop.get('myshopifyDomain')}), tz {tzname}, window {window_start}..{window_end}, auth {auth_mode}, API {API_VERSION}")
    log(f"Fetching orders {q} ...")
    pages = fetch_orders(client, q, agg)

    # Refunds issued inside the window on orders created BEFORE it (a return today
    # on a 50-day-old order): fetch only refunded orders updated in the window.
    q_late = (f"created_at:<{q_start} AND updated_at:>={q_start} AND "
              f"(financial_status:refunded OR financial_status:partially_refunded)")
    log(f"Fetching late refunds {q_late} ...")
    pages += fetch_orders(client, q_late, agg, late_refunds_only=True)

    agg.finalise()
    if agg.counts["snowball_attr_without_tag"]:
        agg.warnings.add(f"{agg.counts['snowball_attr_without_tag']} orders carry the {ATTR_KEY} attribute but no '{TAG_PREFIX}*' tag (Snowball rejected/untracked them) - not counted as referrals")
    if not agg.programs:
        agg.warnings.add(f"no orders tagged '{TAG_PREFIX}*' in the window - check that 'Tag referral orders in Shopify' is ON for every Snowball program")

    today_key = window_end
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
        "daily": agg.daily,
        "totals": {
            "today": sum_range(agg.daily, today_key, today_key),
            "mtd": sum_range(agg.daily, mtd_start, today_key),
            "last_30d": sum_range(agg.daily, last30_start, today_key),
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
            "auth_mode": auth_mode,
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
    log(f"Wrote {OUTPUT_PATH}: {agg.counts['orders_counted']} orders over {len(agg.daily)} days, "
        f"{agg.counts['snowball_tagged']} Snowball referrals (commission net "
        f"{out['snowball']['window_totals']['commission_net']:.2f} {out['currency']}), "
        f"{client.requests} API calls, {len(agg.warnings)} warning types.")


if __name__ == "__main__":
    main()
