#!/usr/bin/env python3
"""
Cattasaurus - PayPal fee fetcher (Transaction Search API).

Runs on a schedule (GitHub Actions) completely independently of Claude. Pulls every
balance-affecting PayPal transaction of the business account (payments received through the
Shopify checkout's PayPal option, refunds, disputes, withdrawals...) and books the PayPal
FEES per calendar day in REPORT_TIMEZONE - the same calendar every other P&L source uses.
Shopify exposes processing fees only for Shopify Payments; PayPal charges its own fee inside
PayPal, and that fee is what this script fetches (transaction_info.fee_amount, exact to the
cent, as shown on the PayPal activity page).

Credentials come ONLY from environment variables (GitHub Actions Secrets). Nothing is logged
or written to the repo except the aggregated JSON - no payer names or emails are read.

Required env vars:
  PAYPAL_CLIENT_ID         REST app (developer.paypal.com > Apps & Credentials > Live) with the
  PAYPAL_CLIENT_SECRET     "Transaction Search" feature enabled on the app

Optional env vars:
  PAYPAL_BASE_URL          default https://api-m.paypal.com (sandbox: https://api-m.sandbox.paypal.com)
  REPORT_TIMEZONE          default America/Los_Angeles
  WINDOW_DAYS              trailing days to (re)fetch, default 45
  OUTPUT_PATH              default data/paypal.json
  PAGE_SIZE                transactions per page, default 500 (API max)
  SLICE_DAYS               days per request, default 30 (API allows at most 31)
  HISTORY_START            days from this date on are kept in the file across runs (default
                           2025-01-01); the API itself holds three years of history
  BACKFILL_START/_END      one-off run over a past range (YYYY-MM-DD, END defaults to today),
                           merged into the same file

Output (per day, positive numbers = money in / cost out as labelled):
  daily{transactions, payments, payments_count, refunds, refunds_count, fees, fees_credited,
        withdrawals, other, by_event_code{code:{count, amount, fee}}}
    fees          = PayPal fees charged that day (positive = cost), the P&L line
    fees_credited = fees PayPal gave back (refund fee credits, if any) - already netted in fees
    payments      = gross payments received (T00xx / T05xx codes, positive amounts)
    refunds       = money sent back to buyers (T11xx codes), positive number
    withdrawals   = transfers to the bank (T04xx) - information only, never a cost
  daily_by_transaction_date: days are the LA day of transaction_initiation_date
"""
import base64
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

SCRIPT_VERSION = "1.0"
SCHEMA = 1

CLIENT_ID = os.environ.get("PAYPAL_CLIENT_ID", "").strip()
CLIENT_SECRET = os.environ.get("PAYPAL_CLIENT_SECRET", "").strip()
BASE_URL = os.environ.get("PAYPAL_BASE_URL", "https://api-m.paypal.com").strip().rstrip("/")
TZ_NAME = os.environ.get("REPORT_TIMEZONE", "America/Los_Angeles").strip() or "America/Los_Angeles"
WINDOW_DAYS = int(os.environ.get("WINDOW_DAYS", "45"))
OUTPUT_PATH = os.environ.get("OUTPUT_PATH", "data/paypal.json")
PAGE_SIZE = max(1, min(500, int(os.environ.get("PAGE_SIZE", "500"))))
SLICE_DAYS = max(1, min(31, int(os.environ.get("SLICE_DAYS", "30"))))

DAILY_FIELDS = ["transactions", "payments", "payments_count", "refunds", "refunds_count", "fees", "fees_credited", "withdrawals", "other"]
MONEY_FIELDS = ["payments", "refunds", "fees", "fees_credited", "withdrawals", "other"]
PAYMENT_PREFIXES = ("T00", "T05")     # T00xx PayPal account payments (Express Checkout = T0006), T05xx debit card
REFUND_PREFIXES = ("T11",)            # T1107 refund, T1106 reversal, T1110/T1111 dispute holds...
WITHDRAWAL_PREFIXES = ("T04", "T03")  # bank withdrawals / deposits (balance moves, not P&L)

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
    print(f"[paypal] {msg}", file=sys.stderr, flush=True)


def new_bucket():
    d = {f: 0 for f in DAILY_FIELDS}
    d["by_event_code"] = {}
    return d


def amount(node):
    try:
        return float((node or {}).get("value")), (node or {}).get("currency_code")
    except (TypeError, ValueError):
        return 0.0, (node or {}).get("currency_code") if isinstance(node, dict) else None


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


# ---------------------------------------------------------------- HTTP layer
class Client:
    def __init__(self):
        self.token = None
        self.requests = 0
        self.retries = 0

    def authenticate(self):
        basic = base64.b64encode(f"{CLIENT_ID}:{CLIENT_SECRET}".encode()).decode()
        req = urllib.request.Request(f"{BASE_URL}/v1/oauth2/token", data=b"grant_type=client_credentials", method="POST",
                                     headers={"Authorization": "Basic " + basic, "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                self.requests += 1
                self.token = json.loads(resp.read().decode()).get("access_token")
        except urllib.error.HTTPError as e:
            text = e.read().decode(errors="replace")
            log(f"PayPal rejected the client credentials (HTTP {e.code}): {text[:300]}")
            log("Check PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET (developer.paypal.com > Apps & Credentials > Live) and that the app is a LIVE app.")
            raise SystemExit(2)
        if not self.token:
            log("no access_token in the OAuth response")
            raise SystemExit(2)

    def get(self, path, params, max_retries=6):
        url = f"{BASE_URL}{path}?{urllib.parse.urlencode(params)}"
        for attempt in range(1, max_retries + 1):
            req = urllib.request.Request(url, headers={"Authorization": "Bearer " + self.token, "Accept": "application/json",
                                                       "User-Agent": "cattasaurus-paypal-sync/" + SCRIPT_VERSION})
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    self.requests += 1
                    return json.loads(resp.read().decode())
            except urllib.error.HTTPError as e:
                self.requests += 1
                text = e.read().decode(errors="replace")
                if e.code == 401 and attempt == 1:
                    self.authenticate()   # token expired mid-run
                    continue
                if e.code == 403:
                    log(f"HTTP 403: {text[:300]}")
                    log("The app needs the 'Transaction Search' feature: developer.paypal.com > Apps & Credentials > (your live app) > Features > tick 'Transaction Search' > Save.")
                    raise SystemExit(2)
                if e.code == 429 or e.code >= 500:
                    backoff = min(300, 15 * (2 ** (attempt - 1)))
                    self.retries += 1
                    log(f"HTTP {e.code} - retry {attempt}/{max_retries} in {backoff}s: {text[:160]}")
                    time.sleep(backoff)
                    continue
                log(f"HTTP {e.code} on {path}: {text[:500]}")
                raise
            except urllib.error.URLError as e:
                self.retries += 1
                backoff = min(60, 5 * attempt)
                log(f"Network error ({e.reason}) - retry {attempt}/{max_retries} in {backoff}s")
                time.sleep(backoff)
        raise RuntimeError("Exceeded retries calling PayPal")


# ---------------------------------------------------------------- aggregation
class Aggregator:
    def __init__(self, tz, window_start, window_end):
        self.tz = tz
        self.window_start = window_start
        self.window_end = window_end
        self.daily = {}
        self.seen = set()
        self.event_codes = {}
        self.currencies = {}
        self.warnings = set()
        self.counts = {"transactions_seen": 0, "transactions_counted": 0, "transactions_duplicate": 0,
                       "transactions_not_success": 0, "transactions_outside_window": 0, "transactions_without_date": 0}

    def add(self, t):
        info = t.get("transaction_info") or {}
        tid = info.get("transaction_id") or ""
        self.counts["transactions_seen"] += 1
        key = (tid, info.get("transaction_event_code"), info.get("transaction_initiation_date"))
        if key in self.seen:
            self.counts["transactions_duplicate"] += 1
            return
        self.seen.add(key)
        code = (info.get("transaction_event_code") or "").upper() or "UNKNOWN"
        self.event_codes[code] = self.event_codes.get(code, 0) + 1
        status = (info.get("transaction_status") or "").upper()
        if status not in ("S", ""):
            # P = pending, D = denied, V = reversed: not settled money - reversed ones come back as their own T11xx rows
            self.counts["transactions_not_success"] += 1
            return
        day = local_day(info.get("transaction_initiation_date"), self.tz)
        if day is None:
            self.counts["transactions_without_date"] += 1
            return
        if not (self.window_start <= day <= self.window_end):
            self.counts["transactions_outside_window"] += 1
            return
        gross, cur = amount(info.get("transaction_amount"))
        fee, fcur = amount(info.get("fee_amount"))
        for c in (cur, fcur):
            if c:
                self.currencies[c] = self.currencies.get(c, 0) + 1
        d = self.daily.setdefault(day, new_bucket())
        d["transactions"] += 1
        if code.startswith(PAYMENT_PREFIXES) and gross > 0:
            d["payments"] += gross
            d["payments_count"] += 1
        elif code.startswith(REFUND_PREFIXES) or (code.startswith(PAYMENT_PREFIXES) and gross < 0):
            d["refunds"] += -gross
            d["refunds_count"] += 1
        elif code.startswith(WITHDRAWAL_PREFIXES):
            d["withdrawals"] += -gross
        else:
            d["other"] += gross
        # fee_amount is negative when PayPal charges, positive when it credits a fee back
        if fee < 0:
            d["fees"] += -fee
        elif fee > 0:
            d["fees"] -= fee
            d["fees_credited"] += fee
        e = d["by_event_code"].setdefault(code, {"count": 0, "amount": 0.0, "fee": 0.0})
        e["count"] += 1
        e["amount"] += gross
        e["fee"] += fee
        self.counts["transactions_counted"] += 1

    def finalise(self):
        for d in self.daily.values():
            for f in MONEY_FIELDS:
                d[f] = round(d[f], 2)
            for e in d["by_event_code"].values():
                e["amount"] = round(e["amount"], 2)
                e["fee"] = round(e["fee"], 2)
        if set(self.currencies) - {"USD"}:
            self.warnings.add(f"transactions in currencies other than USD were summed as-is: {self.currencies}")


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
def date_slices(start_day, end_day, tz):
    """[(start_iso, end_iso), ...] in UTC, each at most SLICE_DAYS long, covering the local days
    start_day..end_day with a day of slack on each side (re-bucketed to local days afterwards)."""
    s = datetime.strptime(start_day, "%Y-%m-%d").replace(tzinfo=tz) - timedelta(days=1)
    e = datetime.strptime(end_day, "%Y-%m-%d").replace(tzinfo=tz) + timedelta(days=2)
    e = min(e, datetime.now(timezone.utc) + timedelta(minutes=1))
    out = []
    cur = s.astimezone(timezone.utc)
    end = e.astimezone(timezone.utc)
    while cur < end:
        nxt = min(cur + timedelta(days=SLICE_DAYS), end)
        out.append((cur.strftime("%Y-%m-%dT%H:%M:%S-0000"), nxt.strftime("%Y-%m-%dT%H:%M:%S-0000")))
        cur = nxt
    return out


def fetch_transactions(client, agg, start_day, end_day):
    pages_total = 0
    slices = date_slices(start_day, end_day, agg.tz)
    for s_iso, e_iso in slices:
        page = 1
        while True:
            data = client.get("/v1/reporting/transactions", {
                "start_date": s_iso, "end_date": e_iso, "fields": "transaction_info",
                "balance_affecting_records_only": "Y", "page_size": PAGE_SIZE, "page": page,
            })
            txs = data.get("transaction_details") or []
            for t in txs:
                agg.add(t)
            pages_total += 1
            total_pages = int(data.get("total_pages") or 1)
            if page >= total_pages or not txs:
                break
            page += 1
            if page > 200:
                agg.warnings.add(f"stopped paging slice {s_iso}..{e_iso} after 200 pages")
                break
        log(f"  {s_iso[:10]} .. {e_iso[:10]}: {page} page(s)")
    return len(slices), pages_total


def main():
    if not (CLIENT_ID and CLIENT_SECRET):
        log("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set")
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

    client = Client()
    client.authenticate()
    agg = Aggregator(tz, window_start, window_end)
    log(f"PayPal {BASE_URL}, tz {TZ_NAME}, {mode} {window_start}..{window_end}, history from {HISTORY_START}")
    slices, pages = fetch_transactions(client, agg, window_start, window_end)
    agg.finalise()
    # every day in the fetched range exists (a day without PayPal activity is a real $0 day)
    cur = datetime.strptime(window_start, "%Y-%m-%d")
    end = datetime.strptime(window_end, "%Y-%m-%d")
    while cur <= end:
        agg.daily.setdefault(cur.strftime("%Y-%m-%d"), new_bucket())
        cur += timedelta(days=1)

    previous = history_previous(OUTPUT_PATH)
    daily = history_merge(previous, agg.daily, window_start, window_end)
    hist = history_meta(previous, mode, window_start, window_end, daily, today_key)
    log(f"History: {hist['first_day']}..{hist['last_day']} ({hist['days']} days, {hist['missing_count']} missing since {HISTORY_START})")

    mtd_start = now_local.strftime("%Y-%m-01")
    last30_start = (now_local - timedelta(days=30)).strftime("%Y-%m-%d")
    out = {
        "source": "paypal_transaction_search",
        "generated_at": now_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "timezone": TZ_NAME,
        "currency": "USD",
        "window_days": WINDOW_DAYS,
        "window": {"start": window_start, "end": window_end},
        "daily": daily,
        "totals": {
            "today": sum_range(daily, today_key, today_key),
            "mtd": sum_range(daily, mtd_start, today_key),
            "last_30d": sum_range(daily, last30_start, today_key),
        },
        "meta": {
            "script_version": SCRIPT_VERSION,
            "schema": SCHEMA,
            "history": hist,
            "fee_basis": "paypal_fee_amount_by_transaction_initiation_day",
            "event_codes_seen": agg.event_codes,
            "currencies_seen": agg.currencies,
            "slices": slices,
            "pages": pages,
            "api_requests": client.requests,
            "api_retries": client.retries,
            "counts": agg.counts,
            "warnings": sorted(agg.warnings),
            "note": "PayPal lists a transaction up to 3 hours after it happens; the trailing window is refetched every run so late rows are picked up",
        },
    }
    os.makedirs(os.path.dirname(OUTPUT_PATH) or ".", exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(out, f, indent=2, sort_keys=True)
    t = out["totals"]["last_30d"]
    log(f"Wrote {OUTPUT_PATH}: {agg.counts['transactions_counted']} transactions over {len(agg.daily)} fetched days ({len(daily)} in file); "
        f"last 30d payments {t['payments']:.2f}, refunds {t['refunds']:.2f}, fees {t['fees']:.2f}; {client.requests} API calls.")


if __name__ == "__main__":
    main()
