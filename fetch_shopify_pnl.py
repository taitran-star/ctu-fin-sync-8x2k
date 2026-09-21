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

Marketing attribution (v1.8, daily "attribution" block): every order carries Shopify's own
customer journey (Order.customerJourneySummary - the sessions of the 30 days before the
order, each with referrer, landing page and UTM parameters). The script classifies the LAST
NON-DIRECT session of every counted order into one channel (Shopify Analytics' "last
non-direct click" model) - email / sms (Klaviyo UTMs), meta_paid (utm_source facebook +
paid medium, or fbclid), meta_organic (facebook/instagram referrer without UTM), google_ads
(utm/gclid), organic_search (Google/Bing/DuckDuckGo referrer), tiktok_ads / tiktok_organic,
applovin, snowball (utm_source snowball / affiliate), other_paid, social_other, ai_search,
referral, other_utm, direct, unknown - and books the order's net sales on its order day
under that channel, together with the FIRST session's channel (so "Meta opened, email
closed" journeys can be counted), new vs returning customer, and the Klaviyo campaign /
flow name for email and sms. When the last session is direct (or a Shop Pay / PayPal /
Amazon Pay return-to-store hop) the earlier sessions are read in a second, cheap pass
(moments, newest first). Orders whose journey Shopify has not attributed yet (ready=false,
usually the first 1-3 hours) are counted as "pending" and pick up their channel on the next
rolling run, which rebuilds every day of the window.
  ATTRIBUTION=off           skip the journey fields entirely (falls back to v1.7 behaviour)
  JOURNEYS_DIR              where the raw journey records live (default data/shopify_journeys, one
                            file per month) - the channel rules are applied to these on every run
  RECLASSIFY_ONLY=true      no Shopify call: re-apply the (changed) channel rules to the stored records
                            and rewrite the attribution blocks of data/shopify_pnl.json
  GOOGLE_ADS_LANDING_PATHS  comma-separated landing-page path prefixes only Google Ads use (default
                            /pages/cats-love-it-2025): Google auto-tagging (gclid) is not visible in the
                            journey, so a Google session landing there counts as google_ads
  GOOGLE_ADS_HANDLE_SUFFIX  product-handle suffix of the Google-Ads-only product pages (default -gg)
  JOURNEY_BATCH             orders per moments request, default 15 (auto-halves on cost errors)
  MOMENTS_FIRST             sessions read per order in that pass, default 25
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

SCRIPT_VERSION = "1.9"
SCHEMA = 3   # 3 = daily "attribution" block (customer-journey last-touch channels)

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

# ---------------------------------------------------------------- marketing attribution settings
ATTRIBUTION = os.environ.get("ATTRIBUTION", "on").strip().lower() not in ("off", "0", "false", "no")
# Raw journey signals of every counted order (first + last session, untouched by any rule) are kept per
# month in JOURNEYS_DIR so the channel rules can change WITHOUT refetching Shopify: run the script with
# RECLASSIFY_ONLY=true and it rebuilds every day's attribution block from those files in seconds.
JOURNEYS_DIR = os.environ.get("JOURNEYS_DIR", "data/shopify_journeys")
RECLASSIFY_ONLY = os.environ.get("RECLASSIFY_ONLY", "").strip().lower() in ("1", "true", "yes", "on")
JOURNEY_BATCH = int(os.environ.get("JOURNEY_BATCH", "15"))
MOMENTS_FIRST = int(os.environ.get("MOMENTS_FIRST", "25"))
CHANNELS = ["email", "sms", "email_other", "meta_paid", "meta_organic", "meta_shop", "google_ads", "organic_search",
            "tiktok_ads", "tiktok_organic", "tiktok_shop", "applovin", "snowball", "other_paid", "social_other", "ai_search",
            "referral", "other_utm", "shop_app", "other_channel", "direct", "unknown"]
# Google Ads auto-tagging (gclid) is invisible in Shopify's journey (the landing page comes back without its
# query string and Shopify labels the session "Google / SEO"), so Google Ads clicks are recognised by the
# landing pages only the ads use: comma-separated path prefixes + a product-handle suffix.
GOOGLE_ADS_LANDING_PATHS = [p.strip() for p in os.environ.get("GOOGLE_ADS_LANDING_PATHS", "/pages/cats-love-it-2025").split(",") if p.strip()]
GOOGLE_ADS_HANDLE_SUFFIX = os.environ.get("GOOGLE_ADS_HANDLE_SUFFIX", "-gg").strip()
# Orders with no web session at all (customerJourneySummary.momentsCount = 0) are classified by the sales
# channel they came through: the Facebook / Instagram shop, the Shop app, TikTok Shop...
CHANNEL_HANDLE_MAP = {"facebook": "meta_shop", "instagram": "meta_shop", "meta": "meta_shop", "facebook_instagram": "meta_shop",
                      "shop": "shop_app", "shop_app": "shop_app", "tiktok": "tiktok_shop", "tiktok_shop": "tiktok_shop",
                      "web": "unknown", "online_store": "unknown", "": "unknown"}
PAID_CHANNELS = {"meta_paid", "google_ads", "tiktok_ads", "applovin", "other_paid"}
# sessions that say nothing about marketing: the classifier looks at the session before them
PASSTHROUGH_CHANNELS = {"direct", "unknown"}
JOURNEY_SUMMARY_FIELDS = """
      sourceName
      channelInformation { channelDefinition { handle channelName } }
      customerJourneySummary {
        ready customerOrderIndex
        momentsCount { count }
        firstVisit { source sourceType referrerUrl landingPage occurredAt referralCode utmParameters { source medium campaign content term } }
        lastVisit { source sourceType referrerUrl landingPage occurredAt referralCode utmParameters { source medium campaign content term } }
      }"""

# processedAt + orderAdjustments are what make "returns" equal Shopify Analytics'
# sales_reversals (see Aggregator.add_order). The small pageInfo blocks only tell us
# when a refund has more line items / adjustments than we asked for.
ORDERS_QUERY = """
query Orders($first: Int!, $after: String, $q: String, $refundsFirst: Int!) {
  orders(first: $first, after: $after, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt cancelledAt test displayFinancialStatus tags edited
      customAttributes { key value }%JOURNEY%
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
""".replace("%JOURNEY%", JOURNEY_SUMMARY_FIELDS if ATTRIBUTION else "")

# Second pass, only for orders whose last session is direct (or a checkout hop): the earlier
# sessions, newest first, so the last NON-direct one can be found (Shopify's own model).
JOURNEY_MOMENTS_QUERY = """
query JourneyMoments($ids: [ID!]!, $momentsFirst: Int!) {
  nodes(ids: $ids) {
    ... on Order {
      id
      customerJourneySummary {
        ready
        momentsCount { count }
        moments(first: $momentsFirst, reverse: true) {
          pageInfo { hasNextPage }
          nodes {
            occurredAt
            ... on CustomerVisit { source sourceType referrerUrl landingPage referralCode utmParameters { source medium campaign content term } }
          }
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


# ---------------------------------------------------------------- marketing attribution (customer journey)
# One session (CustomerVisit) -> one channel. Precedence: UTM parameters (a tagged link is the
# most explicit signal) > ad click ids on the landing page (fbclid, gclid, ttclid...) > the
# referrer host > Shopify's own source label. Verified on live orders (Sep 2026): Klaviyo links
# arrive as utm_source=Klaviyo utm_medium=email utm_campaign=<campaign or flow message name>;
# Meta ads as utm_source=facebook utm_medium=paid utm_campaign=<numeric campaign id> (older
# ones as utm_source=fb with a numeric utm_medium); Snowball creator links as
# utm_source=snowball utm_medium=organic-short-content; AppLovin as utm_source=applovin
# utm_medium=paid; Google organic as referrer google.com without UTMs (sourceType SEO).
PAID_MEDIUMS = {"paid", "cpc", "ppc", "cpm", "cpv", "cpa", "ads", "ad", "paid_social", "paidsocial", "paid-social",
                "social_paid", "social-paid", "paid social", "paid_search", "paidsearch", "paid-search", "display",
                "retargeting", "remarketing", "sponsored", "banner", "pmax", "performance_max", "shopping", "paid_video",
                "paidvideo", "video_ads", "ua", "app"}
EMAIL_MEDIUMS = {"email", "e-mail", "mail", "newsletter", "edm", "email_marketing", "klaviyo"}
SMS_MEDIUMS = {"sms", "text", "mms", "text_message"}
ORGANIC_MEDIUMS = {"organic", "seo", "social", "organic_social", "organic-social", "post", "story", "stories", "bio",
                   "link_in_bio", "linkinbio", "profile", "reel", "reels", "organic_video"}
META_SOURCES = {"facebook", "fb", "instagram", "ig", "meta", "fbig", "fb_ig", "facebook_ads", "meta_ads", "facebookads",
                "facebook.com", "instagram.com", "messenger"}
GOOGLE_SOURCES = {"google", "google_ads", "googleads", "google-ads", "adwords", "gads", "youtube_ads"}
TIKTOK_SOURCES = {"tiktok", "tt", "tiktok_ads", "tiktokads", "tiktok-ads"}
APPLOVIN_SOURCES = {"applovin", "axon", "applovin_axon", "applovin-axon"}
SNOWBALL_SOURCES = {"snowball", "socialsnowball", "social_snowball", "social-snowball", "ss", "affiliate", "affiliates",
                    "creator", "creators", "influencer", "influencers", "ambassador", "referral"}
SNOWBALL_MEDIUMS = {"affiliate", "affiliates", "creator", "influencer", "ambassador", "referral", "ugc",
                    "organic-short-content", "organic_short_content", "short-content", "shortform"}
SEARCH_SOURCES = {"bing", "microsoft", "msn", "bingads", "bing_ads", "duckduckgo", "yahoo", "ecosia", "yandex", "baidu", "brave"}
SOCIAL_SOURCES = {"pinterest", "youtube", "reddit", "twitter", "x", "snapchat", "linkedin", "threads", "tumblr", "quora", "discord", "telegram", "whatsapp"}
SHOP_HOSTS = ("cattasaurus.com", "myshopify.com", "shopify.com", "shop.app", "shopifypreview.com")
# return-to-store hops of payment providers / checkout: carry no marketing information
PASSTHROUGH_HOSTS = ("shop.app", "shopify.com", "myshopify.com", "amazon.com", "paypal.com", "paypalobjects.com",
                     "afterpay.com", "clearpay.co.uk", "klarna.com", "sezzle.com", "affirm.com", "shoppay.com",
                     "stripe.com", "apple.com", "google.com/pay", "cattasaurus.com")
META_HOSTS = ("facebook.com", "instagram.com", "fb.com", "fb.me", "messenger.com", "facebook.net",
              "android-app://com.facebook.katana", "android-app://com.instagram.android", "android-app://com.facebook.orca")
SEARCH_HOSTS = ("google.com", "google.ca", "google.co.uk", "google.com.au", "google.de", "google.fr", "google.co.in",
                "bing.com", "duckduckgo.com", "yahoo.com", "ecosia.org", "yandex.com", "yandex.ru", "baidu.com",
                "search.brave.com", "startpage.com", "ask.com", "aol.com", "qwant.com", "searx.org", "presearch.com",
                "android-app://com.google.android.googlequicksearchbox", "android-app://com.google.android.gms")
TIKTOK_HOSTS = ("tiktok.com", "tiktokv.com", "android-app://com.zhiliaoapp.musically", "android-app://com.ss.android.ugc.trill")
SOCIAL_HOSTS = ("pinterest.com", "pinterest.ca", "youtube.com", "youtu.be", "reddit.com", "twitter.com", "x.com", "t.co",
                "snapchat.com", "linkedin.com", "threads.net", "threads.com", "tumblr.com", "quora.com", "discord.com",
                "android-app://com.google.android.youtube", "android-app://com.pinterest", "android-app://com.reddit.frontpage",
                "android-app://com.twitter.android", "android-app://com.snapchat.android", "android-app://org.telegram.messenger")
EMAIL_CLIENT_HOSTS = ("mail.google.com", "outlook.live.com", "outlook.office.com", "outlook.office365.com", "mail.yahoo.com",
                      "mail.aol.com", "mail.proton.me", "protonmail.com", "icloud.com", "mail.com", "gmx.com", "gmx.net",
                      "android-app://com.google.android.gm", "android-app://com.samsung.android.email.provider",
                      "android-app://com.microsoft.office.outlook", "android-app://com.yahoo.mobile.client.android.mail",
                      "com.apple.mobilemail", "deref-gmx.com", "deref-web.de")
AI_HOSTS = ("chatgpt.com", "chat.openai.com", "openai.com", "perplexity.ai", "copilot.microsoft.com", "gemini.google.com",
            "claude.ai", "you.com", "bing.com/chat", "meta.ai", "character.ai")
CLICK_IDS = {"fbclid": "meta_paid", "gclid": "google_ads", "gbraid": "google_ads", "wbraid": "google_ads", "dclid": "google_ads",
             "ttclid": "tiktok_ads", "msclkid": "other_paid", "epik": "other_paid", "li_fat_id": "other_paid",
             "sccid": "other_paid", "irclickid": "other_paid", "twclid": "other_paid", "rdt_cid": "other_paid"}


def _host(url):
    """'https://www.facebook.com/x' -> 'facebook.com'; 'android-app://com.google.android.gm/' -> 'android-app://com.google.android.gm'."""
    if not url:
        return ""
    try:
        p = urllib.parse.urlsplit(url.strip())
    except ValueError:
        return ""
    if p.scheme == "android-app":
        return "android-app://" + (p.netloc or p.path.strip("/")).lower()
    h = (p.netloc or "").lower().rsplit("@", 1)[-1].split(":")[0]
    if not h and not p.scheme:            # bare 'facebook.com/' style referrers
        h = url.strip().lower().split("/")[0]
    return h[4:] if h.startswith("www.") else h


def _host_in(h, hosts):
    return bool(h) and any(h == d or h.endswith("." + d) for d in hosts)


def _landing_path(url):
    """'https://cattasaurus.com/pages/cats-love-it-2025?x=1' -> '/pages/cats-love-it-2025' (lower-cased)."""
    if not url:
        return ""
    try:
        return (urllib.parse.urlsplit(url).path or "/").lower()
    except ValueError:
        return ""


def channel_sig(o):
    """Raw sales-channel signal of an order (used when it has no web session at all)."""
    ch = ((o.get("channelInformation") or {}).get("channelDefinition") or {})
    sig = {"ch": (ch.get("handle") or "").strip().lower(), "chn": (ch.get("channelName") or "").strip(), "src": (o.get("sourceName") or "").strip().lower()}
    return {k: v for k, v in sig.items() if v}


def classify_channel_sig(sig):
    """No web session at all: the sales channel the order came through (Facebook / Instagram shop, Shop app...)."""
    handle, name, src = (sig or {}).get("ch", ""), (sig or {}).get("chn", ""), (sig or {}).get("src", "")
    key = CHANNEL_HANDLE_MAP.get(handle)
    if key is None:
        key = CHANNEL_HANDLE_MAP.get(src, "other_channel")
    if key == "unknown" and src and src not in ("web", "online_store", "") and not src.isdigit():
        key = "other_channel"
    return key, (name or handle or src)


def classify_channel(o):
    return classify_channel_sig(channel_sig(o))


def _landing_params(url):
    """Lower-cased query parameter names of the landing page (fbclid, gclid, ref ...)."""
    if not url:
        return set()
    try:
        q = urllib.parse.urlsplit(url).query
    except ValueError:
        return set()
    return {k.lower() for k, _ in urllib.parse.parse_qsl(q, keep_blank_values=True)}


def visit_sig(v):
    """The raw, rule-free signal of one CustomerVisit: source label, source type, referrer host, landing
    path + query-parameter names, UTM source/medium/campaign, referral code. Small enough to keep for
    every order; everything classify_sig() needs and nothing else."""
    if not v:
        return None
    utm = v.get("utmParameters") or {}
    sig = {
        "s": (v.get("source") or "").strip(),
        "t": (v.get("sourceType") or "").strip(),
        "r": _host(v.get("referrerUrl")),
        "l": _landing_path(v.get("landingPage")),
        "q": sorted(_landing_params(v.get("landingPage"))),
        "us": (utm.get("source") or "").strip(),
        "um": (utm.get("medium") or "").strip(),
        "uc": (utm.get("campaign") or "").strip(),
        "rc": (v.get("referralCode") or "").strip(),
    }
    return {k: val for k, val in sig.items() if val}


def classify_sig(sig):
    """One raw session signal -> (channel, detail). detail = the campaign / referrer that explains the
    channel: Klaviyo campaign or flow message name for email/sms, utm campaign for ads, referrer
    host for referral traffic, the ad landing page for untagged Google Ads."""
    if not sig:
        return "unknown", ""
    if "ch" in sig or "src" in sig:
        return classify_channel_sig(sig)
    us = sig.get("us", "").lower()
    um = sig.get("um", "").lower()
    uc = sig.get("uc", "")
    src = sig.get("s", "").lower()
    stype = sig.get("t", "").upper()
    ref = sig.get("r", "")
    params = set(sig.get("q") or [])
    path = sig.get("l", "")
    paid = um in PAID_MEDIUMS or um.isdigit() or um.startswith("paid") or um.endswith("_paid") or um.endswith("-paid") or "cpc" in um
    organic = um in ORGANIC_MEDIUMS or um.startswith("organic")
    if not us and (um or uc):
        # utm_source dropped from the link (seen on Meta ads): recover the platform from the referrer
        if _host_in(ref, META_HOSTS) or src in ("facebook", "instagram"):
            us = "facebook"
        elif _host_in(ref, TIKTOK_HOSTS) or src == "tiktok":
            us = "tiktok"
        elif _host_in(ref, SEARCH_HOSTS) and "google" in ref:
            us = "google"
        elif "fbclid" in params:
            us = "facebook"
    if us or um:
        # ---- tagged link
        if um in SMS_MEDIUMS or ("sms" in um and "klaviyo" in us) or us == "sms":
            return "sms", uc
        if "klaviyo" in us or um in EMAIL_MEDIUMS or "email" in um or us == "email":
            return ("email" if ("klaviyo" in us or us in ("", "email", "newsletter", "flow", "campaign")) else "email_other"), uc or (us if us not in ("", "email") else "")
        if us in META_SOURCES or any(k in us for k in ("facebook", "instagram", "meta_", "metaads")):
            if organic and not um.isdigit():
                return "meta_organic", uc
            # no medium at all: Meta's ad UTMs carry the numeric campaign id, organic posts a name
            return ("meta_paid" if (paid or uc.isdigit() or "fbclid" in params) else "meta_organic"), uc
        if us in GOOGLE_SOURCES or us.startswith("google"):
            return ("organic_search" if organic else "google_ads"), uc
        if us in TIKTOK_SOURCES or "tiktok" in us:
            return ("tiktok_organic" if (organic and not um.isdigit()) else "tiktok_ads"), uc
        if us in APPLOVIN_SOURCES or "applovin" in us:
            return "applovin", uc
        if us in SNOWBALL_SOURCES or "snowball" in us or um in SNOWBALL_MEDIUMS:
            return "snowball", uc
        if us in SEARCH_SOURCES or any(k in us for k in ("bing", "duckduckgo", "yahoo")):
            return ("other_paid" if paid else "organic_search"), (us if paid else uc)
        if us in SOCIAL_SOURCES or any(k in us for k in ("pinterest", "youtube", "reddit", "snapchat", "linkedin", "twitter")):
            return ("other_paid" if paid else "social_other"), (us if paid else (uc or us))
        if us in ("shopify", "shopify_email", "shopify-email", "shop", "shop_app"):
            return ("email_other" if "email" in us or "email" in um else "referral"), us
        if paid:
            return "other_paid", (us + (" / " + uc if uc else ""))
        return "other_utm", (us + (" / " + um if um else ""))
    # ---- no UTM: ad click ids on the landing page
    for pid, ch in CLICK_IDS.items():
        if pid in params:
            return ch, pid
    if sig.get("rc") and not _host_in(ref, PASSTHROUGH_HOSTS):
        return "snowball", "ref=" + sig["rc"][:40]
    # ---- Google Ads without UTMs: Google referrer + a landing page only the ads use
    if (_host_in(ref, SEARCH_HOSTS) and "google" in ref) or src == "google":
        if any(path.startswith(pfx) for pfx in GOOGLE_ADS_LANDING_PATHS) or (GOOGLE_ADS_HANDLE_SUFFIX and path.startswith("/products/") and path.rstrip("/").endswith(GOOGLE_ADS_HANDLE_SUFFIX)):
            return "google_ads", "landing:" + path
    # ---- referrer host
    if ref:
        if _host_in(ref, META_HOSTS):
            return "meta_organic", ref
        if _host_in(ref, EMAIL_CLIENT_HOSTS):
            return "email_other", ref
        if _host_in(ref, AI_HOSTS):
            return "ai_search", ref
        if _host_in(ref, SEARCH_HOSTS) or stype == "SEO":
            return "organic_search", ref
        if _host_in(ref, TIKTOK_HOSTS):
            return "tiktok_organic", ref
        if _host_in(ref, SOCIAL_HOSTS):
            return "social_other", ref
        if _host_in(ref, PASSTHROUGH_HOSTS):
            return "direct", ""
        return "referral", ref
    if src == "email":
        return "email_other", ""
    if stype == "SEO" or src in ("google", "bing", "duckduckgo", "yahoo"):
        return "organic_search", src
    if src in ("facebook", "instagram"):
        return "meta_organic", src
    if src in ("", "direct"):
        return "direct", ""
    return "unknown", ""


def classify_visit(v):
    return classify_sig(visit_sig(v))


# ---------------------------------------------------------------- journey records -> attribution blocks
# One record per counted order, keyed by the numeric order id inside data/shopify_journeys/YYYY-MM.json:
#   {"d": order day, "v": net sales, "i": customerOrderIndex, "f": first-session signal, "l": last-session
#    signal (already resolved to the last NON-direct session when the moments pass ran), "fl": flags}
# flags: "m" last session taken from the moments pass, "n" no web session (sales channel used),
#        "t" more than MOMENTS_FIRST direct sessions in a row (stayed direct), "p" Shopify has not
#        attributed the order yet, "x" no customerJourneySummary at all.
def journey_month_path(day):
    return os.path.join(JOURNEYS_DIR, day[:7] + ".json")


def journeys_load_all():
    """Every stored record, from every month file."""
    records = {}
    if not os.path.isdir(JOURNEYS_DIR):
        return records
    for name in sorted(os.listdir(JOURNEYS_DIR)):
        if not (name.endswith(".json") and len(name) == 12):
            continue
        try:
            with open(os.path.join(JOURNEYS_DIR, name)) as f:
                obj = json.load(f)
            records.update(obj.get("orders") or {})
        except (OSError, ValueError) as e:
            log(f"could not read {name}: {e}")
    return records


def journeys_save(fresh, fetched_start, fetched_end):
    """Replace the records of the fetched day range inside the month files it touches (records of
    other days in those files are kept). Files are written sorted so git diffs stay small."""
    months = sorted({fetched_start[:7], fetched_end[:7]} | {r["d"][:7] for r in fresh.values()})
    cur = datetime.strptime(fetched_start[:7] + "-01", "%Y-%m-%d")
    end = datetime.strptime(fetched_end[:7] + "-01", "%Y-%m-%d")
    while cur <= end:
        months.append(cur.strftime("%Y-%m"))
        cur = datetime(cur.year + (cur.month == 12), (cur.month % 12) + 1, 1)
    os.makedirs(JOURNEYS_DIR, exist_ok=True)
    written = 0
    for month in sorted(set(months)):
        path = os.path.join(JOURNEYS_DIR, month + ".json")
        try:
            with open(path) as f:
                existing = (json.load(f).get("orders") or {})
        except (OSError, ValueError):
            existing = {}
        kept = {k: v for k, v in existing.items() if not (fetched_start <= v.get("d", "") <= fetched_end)}
        kept.update({k: v for k, v in fresh.items() if v["d"][:7] == month})
        if not kept and not existing:
            continue
        with open(path, "w") as f:
            json.dump({"month": month, "schema": 1, "orders": dict(sorted(kept.items(), key=lambda kv: int(kv[0]) if kv[0].isdigit() else kv[0]))}, f, separators=(",", ":"), sort_keys=False)
        written += 1
    return written


def attribution_blocks(records):
    """Classify every stored record with the CURRENT rules -> {day: attribution block}."""
    blocks = {}
    for rec in records.values():
        day = rec.get("d")
        if not day:
            continue
        a = blocks.setdefault(day, new_attribution_bucket())
        a["orders"] += 1
        fl = rec.get("fl", "")
        if "x" in fl:
            a["no_journey"] += 1
            continue
        if "p" in fl:
            a["pending"] += 1
            continue
        first_ch, first_detail = classify_sig(rec.get("f"))
        last_ch, last_detail = classify_sig(rec.get("l"))
        idx = rec.get("i")
        customer = "new" if idx == 1 else ("returning" if isinstance(idx, int) and idx > 1 else "unknown")
        sales = float(rec.get("v") or 0)
        lt = a["last_touch"].setdefault(last_ch, {"orders": 0, "sales": 0.0, "new": 0, "returning": 0, "paid_first": 0})
        lt["orders"] += 1
        lt["sales"] += sales
        if customer in ("new", "returning"):
            lt[customer] += 1
        if first_ch in PAID_CHANNELS:
            lt["paid_first"] += 1
        ft = a["first_touch"].setdefault(first_ch, {"orders": 0, "sales": 0.0})
        ft["orders"] += 1
        ft["sales"] += sales
        j = a["journeys"].setdefault(first_ch + ">" + last_ch, {"orders": 0, "sales": 0.0})
        j["orders"] += 1
        j["sales"] += sales
        if last_ch in ("email", "sms"):
            name = (last_detail or "(không có utm_campaign)")[:120]
            e = a["email_detail"].setdefault(name, {"orders": 0, "sales": 0.0, "medium": last_ch})
            e["orders"] += 1
            e["sales"] += sales
    for a in blocks.values():
        for key in ("last_touch", "first_touch", "journeys", "email_detail"):
            for v in a[key].values():
                v["sales"] = round(v["sales"], 2)
    return blocks


def apply_attribution(daily, blocks):
    """Attach the freshly classified blocks to the days that exist in the file. Days without a stored
    record keep whatever block they had (data from before the journey files existed)."""
    applied = 0
    for day, block in blocks.items():
        if day in daily:
            daily[day]["attribution"] = block
            applied += 1
    return applied


def channel_totals_of(blocks, start_key, end_key):
    totals = {}
    for day, a in blocks.items():
        if start_key <= day <= end_key:
            for ch, v in a["last_touch"].items():
                t = totals.setdefault(ch, {"orders": 0, "sales": 0.0})
                t["orders"] += v["orders"]
                t["sales"] = round(t["sales"] + v["sales"], 2)
    return dict(sorted(totals.items(), key=lambda kv: -kv[1]["sales"]))


def new_attribution_bucket():
    return {"orders": 0, "pending": 0, "no_journey": 0, "last_touch": {}, "first_touch": {}, "journeys": {}, "email_detail": {}}


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
            "journeys_ready": 0, "journeys_pending": 0, "journeys_missing": 0, "journeys_no_session": 0,
            "journeys_deferred": 0, "journeys_resolved_by_moments": 0, "journeys_moments_truncated": 0,
            "journeys_unresolved": 0,
        }
        self.gateways = {}
        self.journeys = {}    # numeric order id -> raw journey record (see journey_month_path)
        self.deferred = {}    # order gid -> numeric id of orders whose last session is direct (moments pass)

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
            if ATTRIBUTION:
                self.add_attribution(o, day, subtotal)
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

    # ------------------------------------------------------------ marketing attribution
    def add_attribution(self, o, day, sales):
        """Record the order's raw journey signals (first + last session). Orders whose last session
        is direct / a checkout hop (and that had earlier sessions) are deferred to the moments pass,
        which replaces the last signal with the last NON-direct session."""
        oid = o.get("id") or ""
        legacy_id = oid.rsplit("/", 1)[-1]
        rec = {"d": day, "v": round(float(sales), 2), "i": None, "f": None, "l": None, "fl": ""}
        self.journeys[legacy_id] = rec
        cjs = o.get("customerJourneySummary")
        if not cjs:
            rec["fl"] = "x"
            self.counts["journeys_missing"] += 1
            return
        if not cjs.get("ready"):
            rec["fl"] = "p"
            self.counts["journeys_pending"] += 1
            return
        self.counts["journeys_ready"] += 1
        idx = cjs.get("customerOrderIndex")
        rec["i"] = idx if isinstance(idx, int) else None
        moments = ((cjs.get("momentsCount") or {}).get("count"))
        if not cjs.get("lastVisit") and not cjs.get("firstVisit"):
            # no web session at all: an order placed inside the Facebook / Instagram shop, the Shop app,
            # TikTok Shop... - the sales channel is the best attribution there is
            rec["f"] = rec["l"] = channel_sig(o)
            rec["fl"] = "n"
            self.counts["journeys_no_session"] += 1
            return
        rec["f"] = visit_sig(cjs.get("firstVisit"))
        rec["l"] = visit_sig(cjs.get("lastVisit"))
        last_ch, _ = classify_sig(rec["l"])
        if last_ch in PASSTHROUGH_CHANNELS and cjs.get("lastVisit") and isinstance(moments, int) and moments >= 2:
            # the last session says nothing: read the earlier ones (newest first) in the moments pass
            self.deferred[oid] = legacy_id
            self.counts["journeys_deferred"] += 1

    def resolve_journey(self, oid, cjs):
        """Moments pass result for one deferred order: walk the sessions newest-first and keep the
        first one that is not direct / a checkout hop as the order's last session."""
        legacy_id = self.deferred.pop(oid, None)
        if legacy_id is None:
            return True
        rec = self.journeys.get(legacy_id)
        if rec is None:
            return True
        conn = ((cjs or {}).get("moments") or {})
        resolved = None
        for m in (conn.get("nodes") or []):
            if not m or "source" not in m:
                continue          # a non-visit moment (none exist today, but the interface allows them)
            sig = visit_sig(m)
            ch, _ = classify_sig(sig)
            if ch not in PASSTHROUGH_CHANNELS:
                resolved = sig
                break
        if resolved:
            rec["l"] = resolved
            rec["fl"] += "m"
            self.counts["journeys_resolved_by_moments"] += 1
        elif (conn.get("pageInfo") or {}).get("hasNextPage"):
            rec["fl"] += "t"
            self.counts["journeys_moments_truncated"] += 1   # >MOMENTS_FIRST direct sessions in a row: stays direct
        return True

    def flush_deferred(self):
        """Whatever the moments pass could not resolve (request failures) keeps its last session as-is."""
        for oid in list(self.deferred):
            self.deferred.pop(oid)
            self.counts["journeys_unresolved"] += 1

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


def fetch_journey_moments(client, agg):
    """Second pass for orders whose last session was direct (or a checkout hop): read their
    earlier sessions, newest first, and book the last non-direct one. Batches shrink on cost
    errors; a batch that keeps failing is booked as 'direct' (never lost)."""
    ids = list(agg.deferred)
    if not ids:
        return 0
    requests = 0
    batch = max(1, JOURNEY_BATCH)
    pending = list(ids)
    while pending:
        chunk, pending = pending[:batch], pending[batch:]
        try:
            data = client.query(JOURNEY_MOMENTS_QUERY, {"ids": chunk, "momentsFirst": MOMENTS_FIRST})
        except CostTooHigh as e:
            if batch <= 1:
                log(f"moments query too costly even for one order ({e}) - keeping its last session as-is")
                for oid in chunk:
                    if oid in agg.deferred:
                        agg.deferred.pop(oid)
                        agg.counts["journeys_unresolved"] += 1
                continue
            pending = chunk + pending
            batch = max(1, batch // 2)
            log(f"moments query too costly ({e}) - retrying with batches of {batch}")
            continue
        except RuntimeError as e:
            log(f"moments pass failed for a batch of {len(chunk)} orders ({e}) - keeping their last session as-is")
            for oid in chunk:
                if oid in agg.deferred:
                    agg.deferred.pop(oid)
                    agg.counts["journeys_unresolved"] += 1
            continue
        requests += 1
        for node in (data.get("nodes") or []):
            if node:
                agg.resolve_journey(node.get("id"), node.get("customerJourneySummary") or {})
        if requests % 20 == 0:
            log(f"  moments pass: {requests} requests, {len(pending)} orders left")
    agg.flush_deferred()
    log(f"  journeys: {agg.counts['journeys_ready']} ready, {agg.counts['journeys_pending']} pending (not attributed by Shopify yet), "
        f"{agg.counts['journeys_missing']} without journey; {len(ids)} deferred to the moments pass, "
        f"{agg.counts['journeys_resolved_by_moments']} resolved to an earlier non-direct session, "
        f"{agg.counts['journeys_unresolved']} unresolved, {requests} requests")
    return requests


def attribution_meta_block(channel_totals):
    return {
        "enabled": ATTRIBUTION,
        "model": "last_non_direct_session",
        "basis": ("per order: Shopify customerJourneySummary (sessions of the 30 days before the order); channel of the last "
                  "session that is not direct / a checkout hop; sales = order net sales (subtotal after discounts) on the "
                  "ORDER day; first_touch = channel of the first session of the same journey; new = customer's first order; "
                  "raw signals kept per month in " + JOURNEYS_DIR + " so rules can be re-applied with RECLASSIFY_ONLY=true"),
        "channels": CHANNELS,
        "paid_channels": sorted(PAID_CHANNELS),
        "google_ads_landing_paths": GOOGLE_ADS_LANDING_PATHS, "google_ads_handle_suffix": GOOGLE_ADS_HANDLE_SUFFIX,
        "channel_handle_map": CHANNEL_HANDLE_MAP,
        "window_totals_last_touch": channel_totals,
        "moments_first": MOMENTS_FIRST,
        "journeys_dir": JOURNEYS_DIR,
    }


def reclassify_only():
    """No Shopify call at all: re-run the channel rules over the stored journey records and rewrite
    every day's attribution block in the existing output file."""
    previous = history_previous(OUTPUT_PATH)
    if previous is None:
        log(f"RECLASSIFY_ONLY: {OUTPUT_PATH} does not exist yet - run a normal fetch first")
        sys.exit(1)
    records = journeys_load_all()
    if not records:
        log(f"RECLASSIFY_ONLY: no journey records in {JOURNEYS_DIR} - run a fetch / backfill with v1.9+ first")
        sys.exit(1)
    blocks = attribution_blocks(records)
    daily = previous["daily"]
    applied = apply_attribution(daily, blocks)
    days = sorted(blocks)
    totals = channel_totals_of(blocks, days[0], days[-1])
    previous["daily"] = daily
    previous["attribution"] = attribution_meta_block(totals)
    previous["generated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    meta = previous.setdefault("meta", {})
    meta["script_version"] = SCRIPT_VERSION
    meta["schema"] = SCHEMA
    meta["reclassified_at"] = previous["generated_at"]
    meta["journey_records"] = len(records)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(previous, f, indent=2, sort_keys=True)
    tot_sales = sum(t["sales"] for t in totals.values()) or 1.0
    log(f"RECLASSIFY_ONLY: {len(records)} journey records ({days[0]}..{days[-1]}) -> {applied} days re-attributed in {OUTPUT_PATH}; no API call made")
    log("Last-touch channels over the whole history: " + ", ".join(
        f"{ch} {t['orders']} orders {t['sales']:,.0f} ({100 * t['sales'] / tot_sales:.0f}%)" for ch, t in totals.items()))


def main():
    if RECLASSIFY_ONLY:
        reclassify_only()
        return
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

    # Attribution: orders whose last session was direct need their earlier sessions.
    if ATTRIBUTION:
        log(f"Fetching earlier sessions for {len(agg.deferred)} orders whose last session was direct ...")
        pages += fetch_journey_moments(client, agg)
        if agg.counts["journeys_pending"]:
            agg.warnings.add(f"{agg.counts['journeys_pending']} orders not attributed by Shopify yet (customerJourneySummary.ready=false, normal for the newest orders) - counted as pending, refetched next run")
        if agg.counts["journeys_unresolved"]:
            agg.warnings.add(f"{agg.counts['journeys_unresolved']} orders booked as their last session (direct) because the moments pass failed for them")

    agg.finalise()
    # merge with the copy already in the repo: days outside the fetched range are kept
    previous = history_previous(OUTPUT_PATH)
    daily = history_merge(previous, agg.daily, window_start, window_end)
    hist = history_meta(previous, mode, window_start, window_end, daily, today_key)
    # Attribution: store this run's raw journey records for its day range, then classify EVERY stored
    # record with the current rules (cheap) so all days in the file follow the same rules.
    channel_totals = {}
    if ATTRIBUTION:
        written = journeys_save(agg.journeys, window_start, window_end)
        records = journeys_load_all()
        blocks = attribution_blocks(records)
        applied = apply_attribution(daily, blocks)
        channel_totals = channel_totals_of(blocks, window_start, window_end)
        log(f"Journeys: {len(agg.journeys)} records stored for {window_start}..{window_end} ({written} month files), {len(records)} records in total -> {applied} days attributed")
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
        "attribution": attribution_meta_block(channel_totals),
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
    if ATTRIBUTION and channel_totals:
        tot_sales = sum(t["sales"] for t in channel_totals.values()) or 1.0
        log("Last-touch channels in the fetched range: " + ", ".join(
            f"{ch} {t['orders']} orders {t['sales']:,.0f} ({100 * t['sales'] / tot_sales:.0f}%)" for ch, t in channel_totals.items()))


if __name__ == "__main__":
    main()
