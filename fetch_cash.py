#!/usr/bin/env python3
"""Cattasaurus — bank balances for the Finance (CFO) page.

Reads the account balances from Slash with the READ-ONLY API key and posts them to the dashboard's private cash
store (POST https://dashboard.cattasaurus.com/api/cash, header X-Cash-Key). The balances are never written to this
public repository and never printed in the workflow log — only counts and HTTP status codes are.

Env:
  SLASH_API_KEY    read-only key (Slash > Settings > API keys)           — repository secret
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

SCRIPT_VERSION = "1.0"
BASE = os.environ.get("SLASH_BASE_URL", "https://api.slash.com").rstrip("/")
API_KEY = os.environ.get("SLASH_API_KEY", "")
WRITE_KEY = os.environ.get("CASH_WRITE_KEY", "")
CASH_URL = os.environ.get("CASH_URL", "https://dashboard.cattasaurus.com/api/cash")


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
                body = e.read().decode("utf-8", "replace")[:200]
                if e.code == 400 and not self.entity and "legal" in body.lower():
                    self.pick_entity()
                    continue
                if e.code in (429, 500, 502, 503, 504):
                    time.sleep(min(60, 2 ** attempt * 2))
                    continue
                raise LookupError("HTTP %d on %s" % (e.code, path))
            except urllib.error.URLError:
                time.sleep(min(60, 2 ** attempt * 2))
        raise LookupError("unreachable " + path)

    def pick_entity(self):
        r = self.get("/legal-entity")
        items = (r.get("items") or r.get("data") or []) if isinstance(r, dict) else (r or [])
        if not items:
            raise SystemExit("No legal entity visible to this key")
        pick = next((x for x in items if "cattasaurus" in str(x.get("name", "")).lower()), items[0])
        self.entity = pick.get("id")
        print("Using legal entity (%d visible)" % len(items))


def cents_to_usd(v):
    try:
        return round(float(v) / 100.0, 2)
    except (TypeError, ValueError):
        return None


def pick_balance(acc):
    """Balance in USD from whatever field Slash exposes (cents first, then dollar fields)."""
    for k in ("availableBalanceCents", "balanceCents", "currentBalanceCents", "ledgerBalanceCents"):
        if acc.get(k) is not None:
            return cents_to_usd(acc.get(k))
    for k in ("availableBalance", "balance", "currentBalance"):
        v = acc.get(k)
        if isinstance(v, dict):
            for kk in ("amountCents", "cents"):
                if v.get(kk) is not None:
                    return cents_to_usd(v.get(kk))
            for kk in ("amount", "value"):
                if v.get(kk) is not None:
                    try:
                        return round(float(v.get(kk)), 2)
                    except (TypeError, ValueError):
                        pass
        elif v is not None:
            try:
                return round(float(v), 2)
            except (TypeError, ValueError):
                pass
    return None


def read_accounts(api):
    api.pick_entity()
    last_err = None
    for path in ("/v2/accounts", "/v2/account", "/v1/accounts", "/account"):
        try:
            r = api.get(path, {"limit": "100"})
        except LookupError as e:
            last_err = e
            continue
        items = r.get("items") if isinstance(r, dict) else None
        if items is None and isinstance(r, dict) and r.get("data") is not None:
            items = r.get("data")
        if items is None:
            items = r if isinstance(r, list) else [r]
        out = []
        for i, acc in enumerate(items or []):
            if not isinstance(acc, dict):
                continue
            bal = pick_balance(acc)
            if bal is None:
                continue
            name = str(acc.get("name") or acc.get("nickname") or acc.get("label") or "").strip()
            kind = str(acc.get("type") or acc.get("accountType") or "").strip()
            label = (name[:40] if name else "Slash account %d" % (i + 1)) + ((" · " + kind[:20]) if kind and kind.lower() not in name.lower() else "")
            cur = str(acc.get("currency") or "USD")[:3].upper()
            out.append({"name": label, "balance": bal, "currency": cur})
        if out:
            print("read %d account(s) via %s" % (len(out), path))
            return out
    raise SystemExit("No account with a balance found (%s). Check the key's scopes in Slash." % (last_err or "no endpoint answered"))


def main():
    if not API_KEY or not WRITE_KEY:
        print("::notice::SLASH_API_KEY / CASH_WRITE_KEY not set — nothing to do.")
        return 0
    accounts = read_accounts(Api())
    total = round(sum(a["balance"] for a in accounts), 2)
    payload = {"as_of": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "source": "slash", "accounts": accounts, "total": total}
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
