#!/usr/bin/env python3
"""Cattasaurus — bank balances for the Finance (CFO) page.

Reads the account balances from Slash with the READ-ONLY API key and posts them to the dashboard's private cash
store (POST https://dashboard.cattasaurus.com/api/cash, header X-Cash-Key). The balances are never written to this
public repository and never printed in the workflow log — only counts, component types and HTTP status codes are.

Slash API (docs.slash.com, verified 2026-11-10):
  GET /legal-entity                      -> legal entities a user key can act on (header x-legal-entity below)
  GET /v2/accounts?limit=100             -> accounts (no balances in the list)
  GET /v2/accounts/{id}                  -> balanceComponents[]: transactional {available, posted}, collateral {balance},
                                            credit {creditLimit, availableToSpend, pendingBalance, settledBalance},
                                            global_usd {available, posted}; Money = {amount (minor units), currency}
  GET /account, /account/{id}/balance    -> v1 fallback: balances[] {type cash|credit|debit, available{amountCents}, posted{amountCents}}

Rows stored (one per balance component, so the Finance page can show them):
  "<account> · cash"        transactional / global_usd available (cash not used as collateral)
  "<account> · collateral"  cash set aside to back the charge card (still the company's cash)
  "<account> · card owed"   NEGATIVE: creditLimit − availableToSpend (= pending + settled card spend, paid from cash at statement)
  total = sum of rows = net cash

Env:
  SLASH_API_KEY    read-only user key (Slash > Settings > API keys)                      — repository secret
  CASH_WRITE_KEY   shared secret, same value as the Cloudflare Pages secret CASH_WRITE_KEY — repository secret
  CASH_URL         default https://dashboard.cattasaurus.com/api/cash
  SLASH_BASE_URL   default https://api.slash.com
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

SCRIPT_VERSION = "1.1"
BASE = os.environ.get("SLASH_BASE_URL", "https://api.slash.com").rstrip("/")
API_KEY = os.environ.get("SLASH_API_KEY", "")
WRITE_KEY = os.environ.get("CASH_WRITE_KEY", "")
CASH_URL = os.environ.get("CASH_URL", "https://dashboard.cattasaurus.com/api/cash")


class HttpFail(Exception):
    def __init__(self, code, path, body=""):
        Exception.__init__(self, "HTTP %s on %s" % (code, path))
        self.code, self.path, self.body = code, path, body


class Api:
    def __init__(self):
        self.entity = None

    def get(self, path, params=None):
        url = BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
        for attempt in range(5):
            req = urllib.request.Request(url, headers={"X-API-Key": API_KEY, "Accept": "application/json",
                                                       "User-Agent": "cattasaurus-cash/" + SCRIPT_VERSION})
            if self.entity:
                req.add_header("x-legal-entity", self.entity)
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    return json.loads(r.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", "replace")[:300]
                if e.code in (429, 500, 502, 503, 504):
                    time.sleep(min(60, 2 ** attempt * 2))
                    continue
                raise HttpFail(e.code, path, body)
            except urllib.error.URLError:
                time.sleep(min(60, 2 ** attempt * 2))
        raise HttpFail(0, path, "unreachable")

    def pick_entity(self):
        r = self.get("/legal-entity")
        items = (r.get("items") or r.get("data") or []) if isinstance(r, dict) else (r or [])
        if not items:
            raise SystemExit("No legal entity visible to this key")
        pick = next((x for x in items if "cattasaurus" in str(x.get("name", "")).lower()), items[0])
        self.entity = pick.get("id")
        print("legal entities visible: %d" % len(items))


def money(v):
    """Money -> units. v2: {amount: minor units, currency}; v1: {amountCents}. None when absent."""
    if v is None:
        return None
    if isinstance(v, dict):
        for k in ("amount", "amountCents", "cents"):
            if v.get(k) is not None:
                try:
                    return round(float(v.get(k)) / 100.0, 2)
                except (TypeError, ValueError):
                    return None
        return None
    try:
        return round(float(v) / 100.0, 2)
    except (TypeError, ValueError):
        return None


def label(acc, i, suffix):
    name = str(acc.get("name") or acc.get("nickname") or "").strip() or ("Slash account %d" % (i + 1))
    return (name[:40] + " · " + suffix)[:60]


def rows_v2(api):
    """Accounts via /v2/accounts + /v2/accounts/{id} (balanceComponents)."""
    items, cursor = [], None
    while True:
        r = api.get("/v2/accounts", {"cursor": cursor} if cursor else {"limit": "100"})
        items.extend(r.get("items") or [])
        cursor = (r.get("metadata") or {}).get("nextCursor")
        if not cursor:
            break
    print("accounts (v2): %d" % len(items))
    rows, seen_components = [], 0
    for i, acc in enumerate(items):
        if not isinstance(acc, dict) or not acc.get("id"):
            continue
        if str(acc.get("status") or "open") in ("closed", "pending_close"):
            print("account %d: %s %s — skipped" % (i + 1, acc.get("type"), acc.get("status")))
            continue
        full = api.get("/v2/accounts/" + urllib.parse.quote(str(acc["id"])))
        comps = full.get("balanceComponents") if isinstance(full, dict) else None
        cur = str(full.get("currency") or acc.get("currency") or "USD")[:3].upper() if isinstance(full, dict) else "USD"
        kinds = [str(c.get("type")) for c in (comps or []) if isinstance(c, dict)]
        print("account %d: %s %s components=%s" % (i + 1, acc.get("type"), acc.get("status"), ",".join(kinds) or "none"))
        if not comps:
            continue
        for c in comps:
            if not isinstance(c, dict):
                continue
            t = str(c.get("type"))
            ccur = str((c.get("available") or c.get("balance") or c.get("creditLimit") or {}).get("currency") or cur)[:3].upper() if isinstance(c.get("available") or c.get("balance") or c.get("creditLimit"), dict) else cur
            if t in ("transactional", "global_usd"):
                v = money(c.get("available"))
                if v is None:
                    v = money(c.get("posted"))
                if v is not None:
                    rows.append({"name": label(acc, i, "cash" if t == "transactional" else "global USD"), "balance": v, "currency": ccur})
                    seen_components += 1
            elif t == "collateral":
                v = money(c.get("balance"))
                if v is not None:
                    rows.append({"name": label(acc, i, "collateral"), "balance": v, "currency": ccur})
                    seen_components += 1
            elif t == "credit":
                lim, avail = money(c.get("creditLimit")), money(c.get("availableToSpend"))
                owed = None
                if lim is not None and avail is not None:
                    owed = round(lim - avail, 2)
                else:
                    p, s = money(c.get("pendingBalance")), money(c.get("settledBalance"))
                    if p is not None or s is not None:
                        owed = round((p or 0) + (s or 0), 2)
                if owed is not None:
                    rows.append({"name": label(acc, i, "card owed"), "balance": -abs(owed), "currency": ccur})
                    seen_components += 1
    return rows


def rows_v1(api):
    """Fallback: /account + /account/{id}/balance (balances[] with type cash|credit|debit)."""
    r = api.get("/account")
    items = (r.get("items") or r.get("data") or []) if isinstance(r, dict) else (r or [])
    print("accounts (v1): %d" % len(items))
    rows = []
    for i, acc in enumerate(items):
        if not isinstance(acc, dict) or not acc.get("id"):
            continue
        if str(acc.get("status") or "open") == "closed":
            continue
        b = api.get("/account/" + urllib.parse.quote(str(acc["id"])) + "/balance")
        bals = b.get("balances") if isinstance(b, dict) else None
        kinds = [str(x.get("type")) for x in (bals or []) if isinstance(x, dict)]
        print("account %d: %s balances=%s" % (i + 1, acc.get("type"), ",".join(kinds) or "none"))
        for x in bals or []:
            if not isinstance(x, dict):
                continue
            t = str(x.get("type"))
            v = money(x.get("available"))
            if v is None:
                v = money(x.get("posted"))
            if v is None:
                continue
            if t in ("cash", "debit"):
                rows.append({"name": label(acc, i, "cash"), "balance": v, "currency": "USD"})
            # v1 'credit' = spendable credit on the charge card, not cash: not stored (the v2 path nets the card balance)
    return rows


def read_rows(api):
    api.pick_entity()
    try:
        rows = rows_v2(api)
        if rows:
            return rows, "v2"
        print("v2 answered without balance components — trying v1")
    except HttpFail as e:
        print("v2 not usable (%s) — trying v1" % e)
    rows = rows_v1(api)
    if rows:
        return rows, "v1"
    raise SystemExit("No balance readable with this key. Check the key's scopes in Slash (Settings > API keys).")


def main():
    if not API_KEY or not WRITE_KEY:
        print("::notice::SLASH_API_KEY / CASH_WRITE_KEY not set — nothing to do.")
        return 0
    try:
        rows, via = read_rows(Api())
    except HttpFail as e:
        raise SystemExit("Slash API: %s" % e)
    rows = rows[:20]
    total = round(sum(a["balance"] for a in rows), 2)
    print("rows: %d via %s" % (len(rows), via))
    payload = {"as_of": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "source": "slash", "accounts": rows, "total": total}
    req = urllib.request.Request(CASH_URL, data=json.dumps(payload).encode("utf-8"), method="POST",
                                 headers={"Content-Type": "application/json", "X-Cash-Key": WRITE_KEY, "X-Requested-With": "ctu",
                                          "User-Agent": "cattasaurus-cash/" + SCRIPT_VERSION})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            ans = json.loads(r.read().decode("utf-8"))
            print("stored: ok=%s accounts=%s history=%s" % (ans.get("ok"), ans.get("accounts"), ans.get("history")))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:120]
        raise SystemExit("dashboard answered HTTP %d: %s" % (e.code, body))
    return 0


if __name__ == "__main__":
    sys.exit(main())
