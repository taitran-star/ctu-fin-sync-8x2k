#!/usr/bin/env python3
"""
Cattasaurus - Shopify offers & discount codes -> data/shopify_promos.json

Runs in GitHub Actions (workflow shopify_marketing.yml), separate from the P&L sync so a problem here can
never touch data/shopify_pnl.json. Same app + secrets as fetch_shopify_pnl.py (read_orders /
read_all_orders - no new scope).

Every web order of the window is read with its discount applications (automatic offers such as
B1G1F-LARGE, codes such as CATTA10, manual / script discounts) and the line-level discount allocations.
Each order is filed under its PRIMARY offer = the application that took the most money off the order
(B1G1F-LARGE when a CATTA10 code rides on top of it); orders without any discount go to "(no discount)".
Every application used is also counted on its own ("a" block) so stacked codes stay visible.

daily[YYYY-MM-DD] = {
  "p": {offer: {o orders, g gross (original price x qty), d line discounts, n net = g - d, u units,
                c product cost (landed cost per SKU from data/cogs_skus.json, bundles via components),
                mg / mu gross / units of lines without a known cost, new first-order customers,
                st orders with 2+ discounts stacked, rf refunded so far (incl. tax + shipping)}},
  "a": {offer: {o orders that used it, d discount it gave}},
  "t": {o, g, d} day totals (QA: equals the line-level gross / discounts of the non-cancelled orders)
}
offers[offer] = {type: auto|code|manual|script, first, last}
Excluded: test orders, cancelled orders, tip lines. Shipping discounts are not product discounts (left out,
like gross sales in the P&L). Days are America/Los_Angeles like every other source.
Single-use codes (Klaviyo abandoned-cart codes etc.) are grouped: 3+ codes sharing a letters+digits prefix
-> "CART10… (unique codes)"; any other 10+ character code used once -> "(single-use codes)".

Env: SHOPIFY_SHOP + SHOPIFY_CLIENT_ID/SECRET (or SHOPIFY_ACCESS_TOKEN), REPORT_TIMEZONE, PROMO_WINDOW_DAYS
(default 14), HISTORY_START (2025-01-01), BACKFILL_START / BACKFILL_END, PROMO_OUTPUT_PATH, COGS_SKUS_PATH.
"""
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

import fetch_shopify_pnl as base

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None

SCRIPT_VERSION = "1.0.1"
OUTPUT_PATH = os.environ.get("PROMO_OUTPUT_PATH", "data/shopify_promos.json")
COGS_SKUS_PATH = os.environ.get("COGS_SKUS_PATH", "data/cogs_skus.json")
WINDOW_DAYS = int(os.environ.get("PROMO_WINDOW_DAYS", "14"))
HISTORY_START = os.environ.get("HISTORY_START", "2025-01-01").strip() or "2025-01-01"
BACKFILL_START = os.environ.get("BACKFILL_START", "").strip()
BACKFILL_END = os.environ.get("BACKFILL_END", "").strip()
REPORT_TIMEZONE = os.environ.get("REPORT_TIMEZONE", "America/Los_Angeles").strip() or "UTC"
PAGE_SIZE = int(os.environ.get("PROMO_PAGE_SIZE", "25"))
LINES_FIRST = int(os.environ.get("PROMO_LINES_FIRST", "20"))
NO_DISCOUNT = "(no discount)"
SINGLE_USE = "(single-use codes)"

QUERY = """
query Promos($first: Int!, $after: String, $q: String, $lines: Int!) {
  orders(first: $first, after: $after, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id createdAt cancelledAt test
      customerJourneySummary { customerOrderIndex }
      totalRefundedSet { shopMoney { amount } }
      discountApplications(first: 8) {
        nodes {
          __typename index
          ... on DiscountCodeApplication { code }
          ... on AutomaticDiscountApplication { title }
          ... on ManualDiscountApplication { title }
          ... on ScriptDiscountApplication { title }
        }
      }
      lineItems(first: $lines) {
        pageInfo { hasNextPage }
        nodes {
          sku title quantity requiresShipping
          originalUnitPriceSet { shopMoney { amount } }
          discountAllocations { allocatedAmountSet { shopMoney { amount } } discountApplication { index } }
        }
      }
    }
  }
}
"""

FIELDS = ("o", "g", "d", "n", "u", "c", "mg", "mu", "new", "st", "rf")


def log(msg):
    print(f"[shopify_promos] {msg}", file=sys.stderr, flush=True)


# ---------------------------------------------------------------- product cost per SKU
def load_costs():
    try:
        with open(COGS_SKUS_PATH) as f:
            skus = (json.load(f) or {}).get("skus") or {}
    except (OSError, ValueError) as e:
        log(f"no SKU costs ({e}) - product cost per offer left empty")
        return lambda sku: None
    up = {str(k).strip().upper(): v for k, v in skus.items()}
    memo = {}

    def landed(sku, depth=0):
        if not sku or depth > 4:
            return None
        k = str(sku).strip().upper()
        if k in memo:
            return memo[k]
        v = up.get(k)
        out = None
        if v:
            lc = v.get("landed_cost")
            if isinstance(lc, (int, float)) and lc > 0:
                out = float(lc)
            elif isinstance(v.get("components"), dict) and v["components"]:
                tot = 0.0
                for ck, q in v["components"].items():
                    cv = landed(ck, depth + 1)
                    if cv is None:
                        tot = None
                        break
                    tot += cv * float(q or 0)
                out = tot
        memo[k] = out
        return out
    return landed


# ---------------------------------------------------------------- offers
def app_key(node):
    t = node.get("__typename") or ""
    if t == "DiscountCodeApplication":
        return (node.get("code") or "").strip().upper() or "(code)", "code"
    title = (node.get("title") or "").strip() or "(untitled)"
    if t == "ManualDiscountApplication":
        return "Manual: " + title, "manual"
    if t == "ScriptDiscountApplication":
        return title, "script"
    return title, "auto"


def new_bucket():
    return {f: 0 for f in FIELDS}


class Agg:
    def __init__(self, tz, start, end, landed):
        self.tz, self.start, self.end, self.landed = tz, start, end, landed
        self.orders = []      # (day, primary, apps {key: disc}, numbers) - grouped after the code clean-up
        self.types = {NO_DISCOUNT: "none"}
        self.counts = {"seen": 0, "kept": 0, "test": 0, "cancelled": 0, "out_of_window": 0, "lines_truncated": 0}

    def add(self, o):
        self.counts["seen"] += 1
        if o.get("test"):
            self.counts["test"] += 1
            return
        if o.get("cancelledAt"):
            self.counts["cancelled"] += 1
            return
        day = base.local_day(o.get("createdAt"), self.tz)
        if not day or day < self.start or day > self.end:
            self.counts["out_of_window"] += 1
            return
        apps = {}
        for n in ((o.get("discountApplications") or {}).get("nodes") or []):
            k, t = app_key(n)
            apps[n.get("index")] = k
            self.types.setdefault(k, t)
        disc_by = {}
        g = d = u = c = mg = mu = 0.0
        li = o.get("lineItems") or {}
        if (li.get("pageInfo") or {}).get("hasNextPage"):
            self.counts["lines_truncated"] += 1
        for ln in li.get("nodes") or []:
            if base.is_tip_item(ln):
                continue
            q = base.line_quantity(ln)
            price = base.money(ln.get("originalUnitPriceSet"))
            g += price * q
            u += q
            cost = self.landed(ln.get("sku"))
            if cost is None:
                mg += price * q
                mu += q
            else:
                c += cost * q
            for al in ln.get("discountAllocations") or []:
                amt = base.money(al.get("allocatedAmountSet"))
                idx = (al.get("discountApplication") or {}).get("index")
                key = apps.get(idx, "(other discount)")
                disc_by[key] = disc_by.get(key, 0.0) + amt
                d += amt
        used = {k: v for k, v in disc_by.items() if v > 0.005}
        for k in apps.values():          # a code that gave $0 (e.g. stacked but not applied) still counts as used
            used.setdefault(k, 0.0)
        primary = max(used.items(), key=lambda kv: kv[1])[0] if any(v > 0.005 for v in used.values()) else NO_DISCOUNT
        idx = (o.get("customerJourneySummary") or {}).get("customerOrderIndex")
        rf = base.money(o.get("totalRefundedSet"))
        self.orders.append((day, primary, used, {"o": 1, "g": g, "d": d, "n": g - d, "u": u, "c": c, "mg": mg, "mu": mu,
                                                 "new": 1 if idx == 1 else 0, "st": 1 if sum(1 for v in used.values() if v > 0.005) > 1 else 0,
                                                 "rf": rf}))
        self.counts["kept"] += 1

    def code_groups(self):
        """{raw code -> grouped label} for the single-use codes of this window."""
        codes = {}
        for _, _, used, _ in self.orders:
            for k in used:
                if self.types.get(k) == "code":
                    codes[k] = codes.get(k, 0) + 1
        prefix = {}
        for k in codes:
            m = re.match(r"^([A-Z]+\d+)([A-Z0-9]{6,})$", k)
            if m:
                prefix.setdefault(m.group(1), set()).add(k)
        out = {}
        for p, ks in prefix.items():
            if len(ks) >= 3:
                for k in ks:
                    out[k] = f"{p}… (unique codes)"
        for k, n in codes.items():
            if k not in out and n == 1 and len(k) >= 10 and re.match(r"^[A-Z0-9-]+$", k) and re.search(r"\d", k):
                out[k] = SINGLE_USE
        return out

    def daily(self):
        grp = self.code_groups()
        for k, v in grp.items():
            self.types.setdefault(v, "code")
        out = {}
        for day, primary, used, num in self.orders:
            row = out.setdefault(day, {"p": {}, "a": {}, "t": {"o": 0, "g": 0.0, "d": 0.0}})
            pk = grp.get(primary, primary)
            b = row["p"].setdefault(pk, new_bucket())
            for f in FIELDS:
                b[f] += num[f]
            for k, v in used.items():
                ak = grp.get(k, k)
                a = row["a"].setdefault(ak, {"o": 0, "d": 0.0})
                a["o"] += 1
                a["d"] += v
            row["t"]["o"] += 1
            row["t"]["g"] += num["g"]
            row["t"]["d"] += num["d"]
        for row in out.values():
            for b in row["p"].values():
                for f in FIELDS:
                    b[f] = round(b[f], 2) if f not in ("o", "new", "st") else int(b[f])
                b["u"] = int(round(b["u"]))
                b["mu"] = int(round(b["mu"]))
            for a in row["a"].values():
                a["d"] = round(a["d"], 2)
            row["t"]["g"] = round(row["t"]["g"], 2)
            row["t"]["d"] = round(row["t"]["d"], 2)
        return dict(sorted(out.items())), grp


def fetch(client, q, agg):
    first, lines, after, pages = PAGE_SIZE, LINES_FIRST, None, 0
    while True:
        try:
            data = client.query(QUERY, {"first": first, "after": after, "q": q, "lines": lines})
        except base.CostTooHigh as e:
            if first > 5:
                first = max(5, first // 2)
                log(f"query cost too high ({str(e)[:80]}) - page size {first}")
                continue
            if lines > 5:
                lines = max(5, lines // 2)
                log(f"query cost too high - line items per order {lines}")
                continue
            raise
        conn = data.get("orders") or {}
        for o in conn.get("nodes") or []:
            agg.add(o)
        pages += 1
        info = conn.get("pageInfo") or {}
        if pages % 20 == 0 or not info.get("hasNextPage"):
            log(f"  page {pages}: {agg.counts['seen']} orders seen")
        if not info.get("hasNextPage"):
            return pages
        after = info.get("endCursor")


def main():
    tz = ZoneInfo(REPORT_TIMEZONE) if ZoneInfo else None
    now = datetime.now(timezone.utc)
    today = (now.astimezone(tz) if tz else now).strftime("%Y-%m-%d")
    if BACKFILL_START:
        try:
            start = datetime.strptime(BACKFILL_START, "%Y-%m-%d").strftime("%Y-%m-%d")
            end = datetime.strptime(BACKFILL_END or today, "%Y-%m-%d").strftime("%Y-%m-%d")
        except ValueError:
            log("BACKFILL_START / BACKFILL_END must be YYYY-MM-DD")
            return 1
        mode = "backfill"
    else:
        start = (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=WINDOW_DAYS)).strftime("%Y-%m-%d")
        end, mode = today, "rolling"
    # UTC bounds one day wider than the local window; local-day filter in Agg.add
    q_from = (datetime.strptime(start, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%dT00:00:00Z")
    q_to = (datetime.strptime(end, "%Y-%m-%d") + timedelta(days=2)).strftime("%Y-%m-%dT00:00:00Z")
    q = f"created_at:>={q_from} AND created_at:<{q_to}"
    token, auth_mode, scope = base.get_access_token()
    client = base.Client(token)
    agg = Agg(tz, start, end, load_costs())
    log(f"{mode} {start}..{end} ({q})")
    pages = fetch(client, q, agg)
    fresh, groups = agg.daily()
    try:
        with open(OUTPUT_PATH) as f:
            prev = json.load(f)
    except (OSError, ValueError):
        prev = {}
    daily = {k: v for k, v in (prev.get("daily") or {}).items() if k >= HISTORY_START and (k < start or k > end)}
    daily.update(fresh)
    daily = dict(sorted(daily.items()))
    offers = dict(prev.get("offers") or {})
    for day, row in fresh.items():
        for k in row["p"]:
            o = offers.setdefault(k, {"type": agg.types.get(k, "auto"), "first": day, "last": day})
            o["first"] = min(o.get("first") or day, day)
            o["last"] = max(o.get("last") or day, day)
            o["type"] = agg.types.get(k, o.get("type") or "auto")
        for k in row["a"]:
            o = offers.setdefault(k, {"type": agg.types.get(k, "auto"), "first": day, "last": day})
            o["first"] = min(o.get("first") or day, day)
            o["last"] = max(o.get("last") or day, day)
    backfills = list(((prev.get("meta") or {}).get("backfills")) or [])
    if mode == "backfill":
        backfills = (backfills + [{"start": start, "end": end, "run_at": now.strftime("%Y-%m-%dT%H:%M:%SZ")}])[-40:]
    out = {
        "schema": 1, "source": "shopify_admin_graphql", "currency": "USD", "timezone": REPORT_TIMEZONE,
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "daily": daily, "offers": dict(sorted(offers.items())),
        "meta": {"script_version": SCRIPT_VERSION, "mode": mode, "fetched": {"start": start, "end": end},
                 "first_day": min(daily) if daily else None, "last_day": max(daily) if daily else None, "days": len(daily),
                 "pages": pages, "counts": agg.counts, "grouped_codes": len(groups), "backfills": backfills,
                 "cogs_source": COGS_SKUS_PATH},
    }
    with open(OUTPUT_PATH, "w") as f:
        json.dump(out, f, separators=(",", ":"), sort_keys=True)
    log(f"Wrote {OUTPUT_PATH}: {len(fresh)} fetched days, {agg.counts['kept']} orders, {len(offers)} offers "
        f"(history {out['meta']['first_day']}..{out['meta']['last_day']}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
