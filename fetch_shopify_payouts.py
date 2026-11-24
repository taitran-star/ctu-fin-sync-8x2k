#!/usr/bin/env python3
"""fetch_shopify_payouts.py v1.1 - Shopify Payments payouts -> data/shopify_payouts.json

What it writes (no order ids, no customer data - the repo is public):
  payouts[]: one row per Shopify Payments payout: id, issued_at, date (REPORT_TIMEZONE), status,
    type, net, summary{charges_gross, charges_fee, refunds_gross, refunds_fee, adjustments_gross,
    adjustments_fee, reserved_gross, reserved_fee, retried_gross, retried_fee},
    tx{TYPE:{n, amount, fee, net}} = the balance transactions inside that payout grouped by type
    (CHARGE, REFUND, DISPUTE_WITHDRAWAL, DISPUTE_REVERSAL, CHARGEBACK_FEE, SHOP_CASH_CREDIT, ...),
    adjustments{reason:{n, amount}}, tx_net and tx_diff (= tx_net - net, should be 0.00).
  pending{TYPE:{...}}: balance transactions not in a payout yet (money still on its way).
  monthly{YYYY-MM:{TYPE:{...}}}: the same transactions by the month they happened (REPORT_TIMEZONE).
  daily{YYYY-MM-DD:{fee, by{CHARGE, DISPUTE, SHOP_CASH, OTHER}, charges, n, refunds}} (v1.1): what Shopify
    Payments really charged per transaction day (REPORT_TIMEZONE): fee = every fee of the day (card and
    Shop Pay Installments processing on CHARGE, the Shop Cash fee, the $15 chargeback fee less the ones
    handed back when a dispute is won); charges / n = money and count of the CHARGE transactions;
    refunds = REFUND amount (negative). The dashboard books `fee` as the Shopify Payments fee of the day.
    A file written by v1.0 has no daily yet: the first v1.1 run reads the whole history once to build it.

Needs the app scopes read_shopify_payments_accounts, read_shopify_payments_payouts,
read_shopify_payments_disputes. Secrets (names only): SHOPIFY_SHOP, SHOPIFY_CLIENT_ID,
SHOPIFY_CLIENT_SECRET. Optional env: BACKFILL_START (YYYY-MM-DD), PAYOUTS_HISTORY_START, PAYOUTS_DAILY_HISTORY_START,
PAYOUTS_ROLLING_DAYS, PAYOUTS_FETCH_TRANSACTIONS=0 to skip the per-transaction part.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

SCRIPT_VERSION = "1.1"
SHOP = os.environ.get("SHOPIFY_SHOP", "").strip().lower().replace("https://", "").rstrip("/")
API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2026-07").strip()
TZ_NAME = os.environ.get("REPORT_TIMEZONE", "America/Los_Angeles").strip() or "America/Los_Angeles"
TZ = ZoneInfo(TZ_NAME)
OUT = os.environ.get("PAYOUTS_OUT", "data/shopify_payouts.json")
HISTORY_START = os.environ.get("PAYOUTS_HISTORY_START", "2026-05-01").strip()
DAILY_HISTORY_START = os.environ.get("PAYOUTS_DAILY_HISTORY_START", "2026-01-01").strip()   # daily{} fees go back further than the payout list
ROLLING_DAYS = int(os.environ.get("PAYOUTS_ROLLING_DAYS", "45") or 45)
BACKFILL_START = os.environ.get("BACKFILL_START", "").strip()
FETCH_TX = os.environ.get("PAYOUTS_FETCH_TRANSACTIONS", "1").strip().lower() not in ("0", "false", "no")
TX_LOOKBACK_DAYS = 7     # a payout never holds a transaction older than this before its window start

SUMMARY_FIELDS = """summary { chargesGross{amount} chargesFee{amount} refundsFeeGross{amount} refundsFee{amount}
  adjustmentsGross{amount} adjustmentsFee{amount} reservedFundsGross{amount} reservedFundsFee{amount}
  retriedPayoutsGross{amount} retriedPayoutsFee{amount} }"""
PAYOUT_Q = """query($first:Int!,$after:String){ shopifyPaymentsAccount { payouts(first:$first, after:$after, reverse:true) {
  pageInfo{hasNextPage endCursor}
  nodes { id issuedAt status transactionType net{amount currencyCode} %s } } } }"""
TX_Q = """query($first:Int!,$after:String,$q:String){ shopifyPaymentsAccount {
  balanceTransactions(first:$first, after:$after, query:$q, hideTransfers:true) {
    pageInfo{hasNextPage endCursor}
    nodes { type test transactionDate adjustmentReason amount{amount} fee{amount} net{amount}
            associatedPayout{id status} } } } }"""
SUMMARY_MAP = {"chargesGross": "charges_gross", "chargesFee": "charges_fee", "refundsFeeGross": "refunds_gross",
               "refundsFee": "refunds_fee", "adjustmentsGross": "adjustments_gross", "adjustmentsFee": "adjustments_fee",
               "reservedFundsGross": "reserved_gross", "reservedFundsFee": "reserved_fee",
               "retriedPayoutsGross": "retried_gross", "retriedPayoutsFee": "retried_fee"}
STATS = {"requests": 0, "throttled_waits": 0}


def log(msg):
    print(msg, flush=True)


def http_post_json(url, headers, body, max_retries=6):
    last = None
    for attempt in range(1, max_retries + 1):
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(min(60, 2 ** attempt))
                continue
            try:
                return json.loads(e.read().decode("utf-8"))
            except Exception:
                log(f"{url.split('?')[0]} -> HTTP {e.code}")
                sys.exit(2)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = str(e)
            time.sleep(min(60, 2 ** attempt))
    log(f"Request failed after {max_retries} attempts: {last}")
    sys.exit(2)


def get_access_token():
    cid = os.environ.get("SHOPIFY_CLIENT_ID", "").strip()
    sec = os.environ.get("SHOPIFY_CLIENT_SECRET", "").strip()
    if not (SHOP and cid and sec):
        log("Missing SHOPIFY_SHOP / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET")
        sys.exit(1)
    body = urllib.parse.urlencode({"grant_type": "client_credentials", "client_id": cid, "client_secret": sec}).encode()
    resp = http_post_json(f"https://{SHOP}/admin/oauth/access_token",
                          {"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"}, body)
    token = resp.get("access_token")
    if not token:
        log("Token endpoint returned no access_token")
        sys.exit(2)
    return token, resp.get("scope", "")


def gql(token, query, variables):
    """Returns (data, errors). Waits and retries when Shopify throttles."""
    url = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"
    headers = {"Content-Type": "application/json", "Accept": "application/json", "X-Shopify-Access-Token": token}
    body = json.dumps({"query": query, "variables": variables}).encode()
    for attempt in range(1, 9):
        resp = http_post_json(url, headers, body)
        STATS["requests"] += 1
        errors = resp.get("errors")
        if isinstance(errors, str):
            errors = [{"message": errors}]
        throttled = any(((e.get("extensions") or {}).get("code") == "THROTTLED") for e in (errors or []) if isinstance(e, dict))
        cost = ((resp.get("extensions") or {}).get("cost")) or {}
        ts = cost.get("throttleStatus") or {}
        if throttled:
            STATS["throttled_waits"] += 1
            time.sleep(min(30, 2 * attempt))
            continue
        need = float(cost.get("requestedQueryCost") or 0) * 2
        avail = float(ts.get("currentlyAvailable") or need)
        rate = float(ts.get("restoreRate") or 50) or 50
        if avail < need:
            STATS["throttled_waits"] += 1
            time.sleep(min(30, (need - avail) / rate + 0.5))
        return resp.get("data"), errors
    return None, [{"message": "still throttled after 8 attempts"}]


def money(x):
    try:
        return float((x or {}).get("amount") or 0)
    except (TypeError, ValueError):
        return 0.0


def local_dt(iso):
    return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).astimezone(TZ)


def gid_tail(gid):
    return str(gid).rstrip("/").split("/")[-1].split("?")[0] if gid else None


def fetch_payouts(token, start):
    """All payouts issued on/after `start` (YYYY-MM-DD, REPORT_TIMEZONE). Falls back to no summary."""
    last_err = None
    for with_summary in (True, False):
        q = PAYOUT_Q % (SUMMARY_FIELDS if with_summary else "")
        out, after, err = [], None, None
        while True:
            data, errors = gql(token, q, {"first": 100, "after": after})
            acct = (data or {}).get("shopifyPaymentsAccount")
            if errors or not acct:
                err = json.dumps(errors)[:600] if errors else "shopifyPaymentsAccount is null"
                break
            conn = acct.get("payouts") or {}
            nodes = conn.get("nodes") or []
            older = 0
            for n in nodes:
                dt = local_dt(n["issuedAt"])
                d = dt.strftime("%Y-%m-%d")
                if d < start:
                    older += 1
                    continue
                row = {"id": gid_tail(n["id"]), "issued_at": n["issuedAt"], "date": d, "status": n.get("status"),
                       "type": n.get("transactionType"), "net": round(money(n.get("net")), 2)}
                if with_summary:
                    s = n.get("summary") or {}
                    row["summary"] = {v: round(money(s.get(k)), 2) for k, v in SUMMARY_MAP.items()}
                out.append(row)
            page = conn.get("pageInfo") or {}
            if not page.get("hasNextPage") or (nodes and older == len(nodes)):
                break
            after = page.get("endCursor")
        if err is None:
            return out, with_summary, last_err
        last_err = err
        log(f"payouts query {'with' if with_summary else 'without'} summary failed: {err}")
    return None, False, last_err


def add(bucket, key, amount, fee, net):
    b = bucket.setdefault(key, {"n": 0, "amount": 0.0, "fee": 0.0, "net": 0.0})
    b["n"] += 1
    b["amount"] += amount
    b["fee"] += fee
    b["net"] += net


def rounded(bucket):
    return {k: {a: (round(v, 2) if a != "n" else v) for a, v in b.items()} for k, b in sorted(bucket.items())}


def fee_group(t):
    """Bucket of a balance-transaction type inside daily[day].by."""
    if t == "CHARGE":
        return "CHARGE"
    if t.startswith("DISPUTE") or t.startswith("CHARGEBACK"):
        return "DISPUTE"
    if t.startswith("SHOP_CASH"):
        return "SHOP_CASH"
    return "OTHER"


def add_daily(daily, day, t, a, f):
    d = daily.setdefault(day, {"fee": 0.0, "by": {}, "charges": 0.0, "n": 0, "refunds": 0.0})
    d["fee"] += f
    if f:
        g = fee_group(t)
        d["by"][g] = d["by"].get(g, 0.0) + f
    if t == "CHARGE":
        d["charges"] += a
        d["n"] += 1
    elif t == "REFUND":
        d["refunds"] += a


def rounded_daily(daily):
    return {day: {"fee": round(d["fee"], 2), "by": {k: round(v, 2) for k, v in sorted(d["by"].items()) if abs(v) >= 0.005},
                  "charges": round(d["charges"], 2), "n": d["n"], "refunds": round(d["refunds"], 2)}
            for day, d in sorted(daily.items())}


def fetch_transactions(token, since):
    """Balance transactions processed on/after `since`, grouped by payout, by type, by month and by day."""
    by_payout, adj, pending, monthly, daily = {}, {}, {}, {}, {}
    after, pages, count = None, 0, 0
    while True:
        data, errors = gql(token, TX_Q, {"first": 100, "after": after, "q": f"processed_at:>={since}"})
        acct = (data or {}).get("shopifyPaymentsAccount")
        if errors or not acct:
            return None, (json.dumps(errors)[:600] if errors else "shopifyPaymentsAccount is null"), pages, count
        conn = acct.get("balanceTransactions") or {}
        pages += 1
        for n in conn.get("nodes") or []:
            if n.get("test"):
                continue
            count += 1
            t = n.get("type") or "UNKNOWN"
            a, f, net = money(n.get("amount")), money(n.get("fee")), money(n.get("net"))
            pid = gid_tail((n.get("associatedPayout") or {}).get("id"))
            if pid:
                add(by_payout.setdefault(pid, {}), t, a, f, net)
                if n.get("adjustmentReason"):
                    r = adj.setdefault(pid, {}).setdefault(str(n["adjustmentReason"])[:80], {"n": 0, "amount": 0.0})
                    r["n"] += 1
                    r["amount"] += a
            else:
                add(pending, t, a, f, net)
            when = local_dt(n["transactionDate"])
            add(monthly.setdefault(when.strftime("%Y-%m"), {}), t, a, f, net)
            add_daily(daily, when.strftime("%Y-%m-%d"), t, a, f)
        page = conn.get("pageInfo") or {}
        if not page.get("hasNextPage"):
            break
        after = page.get("endCursor")
        if pages % 50 == 0:
            log(f"  balance transactions: {count} so far ({pages} pages)")
    return {"by_payout": by_payout, "adj": adj, "pending": pending, "monthly": monthly, "daily": daily}, None, pages, count


def main():
    today = datetime.now(TZ).date()
    old = {}
    if os.path.exists(OUT):
        try:
            with open(OUT, encoding="utf-8") as fh:
                old = json.load(fh)
        except Exception as e:
            log(f"Could not read existing {OUT}: {e} - starting fresh")
    if BACKFILL_START:
        start, mode = BACKFILL_START, "backfill"
    elif not old.get("payouts"):
        start, mode = HISTORY_START, "first_run"
    elif not old.get("daily") and FETCH_TX:
        start, mode = HISTORY_START, "backfill_daily"      # a v1.0 file: read the history once to build daily{}
    else:
        start, mode = (today - timedelta(days=ROLLING_DAYS)).strftime("%Y-%m-%d"), "rolling"
    datetime.strptime(start, "%Y-%m-%d")      # fail early on a bad date
    token, scope = get_access_token()
    log(f"scope: {scope}")
    log(f"mode {mode}: payouts issued on/after {start} ({TZ_NAME})")

    payouts, summary_access, payout_err = fetch_payouts(token, start)
    if payouts is None:
        log("ERROR: cannot read Shopify Payments payouts. Check the app scopes "
            "(read_shopify_payments_accounts, read_shopify_payments_payouts) and re-install the app.")
        log(f"Shopify said: {payout_err}")
        sys.exit(1)
    log(f"payouts fetched: {len(payouts)} (summary: {'yes' if summary_access else 'NO'})")

    tx_meta = {"enabled": FETCH_TX, "ok": False, "error": None, "pages": 0, "count": 0, "since": None}
    pending, monthly_new, daily_new = None, {}, {}
    if FETCH_TX:
        since = (datetime.strptime(start, "%Y-%m-%d") - timedelta(days=TX_LOOKBACK_DAYS)).strftime("%Y-%m-%d")
        if mode in ("first_run", "backfill_daily") and DAILY_HISTORY_START and DAILY_HISTORY_START < since:
            since = DAILY_HISTORY_START         # one long read so the fees per day cover the whole year
        tx_meta["since"] = since
        try:
            tx, err, pages, count = fetch_transactions(token, since)
        except Exception as e:               # never lose the payouts because of this optional part
            tx, err, pages, count = None, f"{type(e).__name__}: {e}", 0, 0
        tx_meta.update({"ok": tx is not None, "error": err, "pages": pages, "count": count})
        if tx is None:
            log(f"WARNING: balance transactions not read: {err}")
        else:
            log(f"balance transactions: {count} in {pages} pages")
            for p in payouts:
                groups = tx["by_payout"].get(p["id"])
                if groups is None:
                    continue
                p["tx"] = rounded(groups)
                p["tx_net"] = round(sum(g["net"] for g in groups.values()), 2)
                p["tx_diff"] = round(p["tx_net"] - p["net"], 2)
                if tx["adj"].get(p["id"]):
                    p["adjustments"] = {k: {"n": v["n"], "amount": round(v["amount"], 2)} for k, v in sorted(tx["adj"][p["id"]].items())}
            pending = rounded(tx["pending"])
            # months fully inside this run's window replace the stored ones; the first (partial) month is kept as stored
            first_full = (datetime.strptime(start, "%Y-%m-%d").replace(day=1) + timedelta(days=32)).strftime("%Y-%m") \
                if start[8:] != "01" else start[:7]
            monthly_new = {m: rounded(g) for m, g in tx["monthly"].items() if m >= first_full}
            # days fully inside this run's window replace the stored ones (the query starts TX_LOOKBACK_DAYS before
            # `start`; its first day can be cut by the time zone, so it is left as stored)
            daily_new = {d: v for d, v in rounded_daily(tx["daily"]).items() if d > since}

    merged = {p["id"]: p for p in (old.get("payouts") or []) if isinstance(p, dict) and p.get("id")}
    for p in payouts:
        prev = merged.get(p["id"]) or {}
        for keep in ("summary", "tx", "tx_net", "tx_diff", "adjustments"):   # keep detail a failed part could not refresh
            if keep not in p and keep in prev:
                p[keep] = prev[keep]
        merged[p["id"]] = p
    rows = sorted(merged.values(), key=lambda p: (p.get("date") or "", p.get("id") or ""), reverse=True)
    monthly = dict(old.get("monthly") or {})
    monthly.update(monthly_new)
    daily = dict(old.get("daily") or {})
    daily.update(daily_new)
    out = {
        "schema": 1, "script_version": SCRIPT_VERSION, "source": "shopify_payments_payouts",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "timezone": TZ_NAME, "currency": "USD",
        "meta": {"mode": mode, "start": start, "granted_scope": scope, "summary_access": summary_access,
                 "summary_error": payout_err, "transactions": tx_meta, "requests": STATS["requests"],
                 "throttled_waits": STATS["throttled_waits"], "payouts_in_run": len(payouts), "payouts_total": len(rows),
                 "daily_from": min(daily) if daily else None, "daily_to": max(daily) if daily else None,
                 "note": "amounts in USD; tx_diff = sum of the payout's balance transactions minus the payout amount (0.00 = fully explained)"},
        "pending": pending if pending is not None else old.get("pending"),
        "monthly": dict(sorted(monthly.items())),
        "daily": dict(sorted(daily.items())),
        "payouts": rows,
    }
    os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    log(f"wrote {OUT}: {len(rows)} payouts, {len(daily)} days of fees, {STATS['requests']} requests")


if __name__ == "__main__":
    main()
