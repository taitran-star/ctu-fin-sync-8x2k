#!/usr/bin/env python3
"""
Cattasaurus - Loop Subscriptions API - DIAGNOSTIC ONLY (not the real sync script).

Purpose: Loop's public developer docs don't show a full real response sample for
several endpoints (especially /order - need to see the real field names for order
type / financial status / amount so we can split "checkout revenue" vs "recurring
revenue" correctly). Rather than guess and risk shipping wrong $ numbers (this
project's hard rule: NEVER simulated/wrong numbers on the dashboard), this script
just calls the 3 endpoints we plan to use with a small page size and PRINTS the
real JSON response to the Actions log, plus writes it to data/loop_diagnose.json
so it's easy to open in the repo. Nothing from this file is read by the dashboard.

Run once via workflow_dispatch, read the log / data/loop_diagnose.json, then the
real fetch_loop_subscriptions.py gets written from the real field names.

Env: LOOP_API_TOKEN (required, secret - never print this).
"""
import json
import os
import sys
import urllib.request
import urllib.error

BASE = "https://api.loopsubscriptions.com/admin/2026-04"
TOKEN = os.environ.get("LOOP_API_TOKEN", "").strip()
OUTPUT_PATH = os.environ.get("OUTPUT_PATH", "data/loop_diagnose.json")


def log(msg):
    print(f"[loop_diagnose] {msg}", flush=True)


def call(path, label):
    url = f"{BASE}{path}"
    req = urllib.request.Request(url, headers={"X-Loop-Token": TOKEN, "Accept": "application/json"})
    log(f"--- {label}: GET {path} ---")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            status = r.status
            body = r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        status = e.code
        body = e.read().decode("utf-8", errors="replace")
    except Exception as e:  # noqa: BLE001
        log(f"{label}: request failed - {e}")
        return {"error": str(e)}
    log(f"{label}: HTTP {status}")
    try:
        parsed = json.loads(body)
    except ValueError:
        log(f"{label}: non-JSON body (first 500 chars): {body[:500]}")
        return {"http_status": status, "raw": body[:2000]}
    # Pretty-print the full real response to the Actions log so we can read exact field names.
    print(json.dumps(parsed, indent=2, ensure_ascii=False)[:8000], flush=True)
    return {"http_status": status, "body": parsed}


def main():
    if not TOKEN:
        log("LOOP_API_TOKEN missing")
        sys.exit(2)

    out = {}
    out["subscriptions_sample"] = call("/subscription?pageSize=2", "subscriptions (any status)")
    out["subscriptions_active_sample"] = call("/subscription?pageSize=2&status=ACTIVE", "subscriptions (ACTIVE)")
    out["customers_sample"] = call("/customer?pageSize=2", "customers")
    out["orders_sample"] = call("/order?pageSize=2", "orders")

    # If we got at least one subscription id, also try its per-subscription order history -
    # useful fallback if the global /order list turns out to need a different path/version.
    try:
        subs_body = out["subscriptions_sample"].get("body") or {}
        items = subs_body.get("subscriptions") or subs_body.get("data") or subs_body.get("items") or []
        if isinstance(items, list) and items:
            sub_id = items[0].get("id") or items[0].get("subscriptionId")
            if sub_id:
                out["order_history_sample"] = call(f"/subscription/{sub_id}/order/history", f"order history for subscription {sub_id}")
    except Exception as e:  # noqa: BLE001
        log(f"order history probe skipped: {e}")

    os.makedirs(os.path.dirname(OUTPUT_PATH) or ".", exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    log(f"Wrote {OUTPUT_PATH} - open it in the repo (or check the log above) to read the real field names.")


if __name__ == "__main__":
    main()
