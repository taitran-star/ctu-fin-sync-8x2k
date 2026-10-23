#!/usr/bin/env python3
"""
Cattasaurus - Shopify customer value (LTV) by first-order cohort -> data/shopify_ltv.json

Runs in GitHub Actions (workflow shopify_marketing.yml). Uses ShopifyQL through the Admin API
(`shopifyqlQuery`), which needs the app scope **read_reports**. Without it the script logs what is
missing and exits 0 WITHOUT touching the file, so the copy already in the repo (first pulled with the
Shopify connector on 23/10/2026) stays on the dashboard.

What it writes (aggregates only - no customer is identifiable):
  cohorts[YYYY-MM] = {customers, spent, orders, repeat_customers, repeat_spent}
      customers whose FIRST order is in that month; spent / orders = their lifetime totals to date
      (Shopify "amount spent": after refunds, incl. shipping + tax); repeat_* = the ones with 2+ orders.
  monthly[YYYY-MM] = {new: {orders, gross, discounts, net, total}, returning: {...}}
      Shopify sales split by first purchase vs repeat purchase (ShopifyQL new_or_returning_customer).

Env: SHOPIFY_SHOP, SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET (or SHOPIFY_ACCESS_TOKEN) - the same
secrets as fetch_shopify_pnl.py; LTV_SINCE (default 2023-01-01); OUTPUT_PATH (default data/shopify_ltv.json).
"""
import json
import os
import sys
from datetime import datetime, timezone

import fetch_shopify_pnl as base   # same auth + GraphQL client as the P&L sync

SCRIPT_VERSION = "1.0"
OUTPUT_PATH = os.environ.get("LTV_OUTPUT_PATH", "data/shopify_ltv.json")
SINCE = os.environ.get("LTV_SINCE", "2023-01-01").strip() or "2023-01-01"

Q = """query Q($q: String!) { shopifyqlQuery(query: $q) { tableData { columns { name dataType } rows } parseErrors } }"""


def log(msg):
    print(f"[shopify_ltv] {msg}", file=sys.stderr, flush=True)


def run(client, ql):
    data = client.query(Q, {"q": ql})
    res = (data or {}).get("shopifyqlQuery") or {}
    errs = res.get("parseErrors") or []
    if errs:
        raise RuntimeError("ShopifyQL parse errors: " + "; ".join(str(e)[:200] for e in errs))
    table = res.get("tableData") or {}
    cols = [c.get("name") for c in table.get("columns") or []]
    out = []
    for r in table.get("rows") or []:
        if isinstance(r, dict):
            out.append(r)
        elif isinstance(r, list):
            out.append(dict(zip(cols, r)))
    return out


def num(v):
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def main():
    token, mode, scope = base.get_access_token()
    if scope and "read_reports" not in scope:
        log(f"granted scope '{scope}' has no read_reports - ShopifyQL is not available to this app. "
            f"Add read_reports to the app (Dev Dashboard > app > Versions > new version with the scope > Release), "
            f"approve it on the store, and the next run fills {OUTPUT_PATH}. File left unchanged.")
        return 0
    client = base.Client(token)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    try:
        all_c = run(client, f"FROM customers SHOW new_customer_records, total_amount_spent, total_number_of_orders GROUP BY month SINCE {SINCE} UNTIL today ORDER BY month ASC LIMIT 400")
        rep_c = run(client, f"FROM customers SHOW new_customer_records, total_amount_spent WHERE number_of_orders >= 2 GROUP BY month SINCE {SINCE} UNTIL today ORDER BY month ASC LIMIT 400")
        sales = run(client, f"FROM sales SHOW orders, gross_sales, discounts, net_sales, total_sales GROUP BY new_or_returning_customer TIMESERIES month SINCE {SINCE} UNTIL today ORDER BY month ASC LIMIT 1000")
    except SystemExit:
        log("Shopify denied the ShopifyQL query (read_reports missing or not approved) - file left unchanged.")
        return 0
    except Exception as e:  # noqa: BLE001 - a failed extra must never break the workflow
        log(f"ShopifyQL failed: {str(e)[:300]} - file left unchanged.")
        return 0
    cohorts, monthly = {}, {}
    for r in all_c:
        m = str(r.get("month") or "")[:7]
        if len(m) == 7:
            cohorts[m] = {"customers": int(num(r.get("new_customer_records"))), "spent": round(num(r.get("total_amount_spent")), 2),
                          "orders": int(num(r.get("total_number_of_orders")))}
    for r in rep_c:
        m = str(r.get("month") or "")[:7]
        if m in cohorts:
            cohorts[m].update({"repeat_customers": int(num(r.get("new_customer_records"))), "repeat_spent": round(num(r.get("total_amount_spent")), 2)})
    for r in sales:
        m = str(r.get("month") or "")[:7]
        k = {"New": "new", "Returning": "returning"}.get(r.get("new_or_returning_customer"))
        if len(m) != 7 or not k:
            continue
        monthly.setdefault(m, {})[k] = {"orders": int(num(r.get("orders"))), "gross": round(num(r.get("gross_sales")), 2),
                                        "discounts": round(-num(r.get("discounts")), 2), "net": round(num(r.get("net_sales")), 2),
                                        "total": round(num(r.get("total_sales")), 2)}
    if not cohorts:
        log("ShopifyQL answered no cohort rows - file left unchanged.")
        return 0
    out = {
        "schema": 1, "source": "shopifyql", "fetched_by": f"fetch_shopify_ltv.py {SCRIPT_VERSION}",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "as_of": today,
        "note": {"en": "Shopify (web) customers by the month of their first order. spent / orders = lifetime to date (Shopify 'amount spent', after refunds, incl. shipping + tax). monthly = Shopify sales split by first vs repeat purchase.",
                 "vi": "Khách web (Shopify) theo tháng mua đơn đầu. spent / orders = cộng dồn tới nay (\"amount spent\" của Shopify, sau hoàn tiền, gồm ship + thuế). monthly = doanh thu Shopify tách đơn đầu / đơn mua lại."},
        "cohorts": cohorts, "monthly": monthly,
    }
    with open(OUTPUT_PATH, "w") as f:
        json.dump(out, f, separators=(",", ":"), sort_keys=True)
    log(f"Wrote {OUTPUT_PATH}: {len(cohorts)} cohorts, {len(monthly)} months of new/returning sales.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
