#!/usr/bin/env python3
"""
Cattasaurus - Slash card & transfer fetcher (Slash API, read-only key).

Runs on a schedule (GitHub Actions). Reads the Slash transactions of the business account and
writes ONLY what the P&L needs to data/slash_pnl.json:
  * card charges of apps / software / tools, Upwork, Numeral fees, Klaviyo, training, supplies
    (merchant, date, amount)                                        -> software cadence + G&A
  * transfers to marketing vendors: agencies (Goodo, Adcrate), creator payouts (Tremendous…),
    Amazon DSP top-ups (SparkX)                                     -> marketing lines
  * monthly totals per P&L line
  * merchants / transfer payees that no rule recognises (name, month, amount only) so they can
    be classified - suppliers, taxes, ad platforms, payroll and internal transfers are left out.
Never written: balances, account / routing numbers, card numbers, supplier payments, taxes,
customer payouts. The repo is public, so the output stays at this level of detail.

Credentials come ONLY from the environment (GitHub Actions secret SLASH_API_KEY, a read-only key
from Slash > Settings > API Management). The key is never printed.

Optional env vars:
  SLASH_BASE_URL    default https://api.slash.com
  HISTORY_START     default 2026-04-01 (Slash replaced the Mercury card in 04/2026)
  REPORT_TIMEZONE   default America/Los_Angeles (same calendar as every other P&L source)
  OUTPUT_PATH       default data/slash_pnl.json
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None

SCRIPT_VERSION = "1.4"   # 1.4 = marketing groups per MKT team (22-27/10/2026), billing cycles + service-month accrual, Tremendous = Snowball wallet top-up
SCHEMA = 1
API_KEY = os.environ.get("SLASH_API_KEY", "").strip()
BASE = os.environ.get("SLASH_BASE_URL", "https://api.slash.com").rstrip("/")
HISTORY_START = os.environ.get("HISTORY_START", "2026-04-01")
TZ = os.environ.get("REPORT_TIMEZONE", "America/Los_Angeles")
OUTPUT = os.environ.get("OUTPUT_PATH", "data/slash_pnl.json")

LINES = {
    "SHOP": "Shopify plan + apps billed by Shopify",
    "SW": "G&A software & tools",
    "AI": "G&A AI (APIs, assistants)",
    "MT": "Marketing tools (tracking, attribution, ad libraries)",
    "MC": "AI content production (video / image / audio)",
    "AGENCY": "Marketing agency (creative / media)",
    "CRE": "Creators / UGC payouts (Insense, Billo, MossCreator, direct)",
    "SBW": "Tremendous top-ups = prepaid wallet Snowball pays creator commissions from - NOT an expense (the commission is on the P&L from Shopify referral tags x 1.04)",
    "DSP": "Amazon DSP top-ups",
    "UPW": "Upwork / freelancers",
    "TAX": "Accounting / tax filing fees (Numeral, registered agent)",
    "LEGAL": "Lawyers (shown for review, not booked automatically)",
    "KLV": "Klaviyo (already on the P&L from invoices)",
    "EDU": "Training / communities",
    "SUP": "Packaging supplies (Uline)",
    "ADS": "Ad platforms charged on the card (already on the P&L from the ad APIs)",
}
KEEP_CHARGES = {"SHOP", "SW", "AI", "MT", "MC", "AGENCY", "CRE", "SBW", "DSP", "UPW", "TAX", "LEGAL", "KLV", "EDU", "SUP"}

# (regex on description / merchant / memo, vendor, line) - first match wins.
# Lines of 21 apps follow the marketing team's classification of 22-27/10/2026 (file Phan_nhom_app_the_cho_MKT):
# OpenRouter / Anthropic / Claude Team / Apify / Firecrawl / Grok / Vast.ai / Nous / Hostinger / Alibaba Cloud -> MC;
# Adobe / Canva / Figma / Replo / Cloudflare / DigitalOcean / BrowserStack / Sellerboard / Helium 10 / Webshare -> MT (Skool stays EDU = training line).
RULES = [
    (r"goodo|gattozzi", "Goodo Studios", "AGENCY"), (r"adcrate|ad crate", "Adcrate", "AGENCY"),
    (r"sparkx", "SparkX (Amazon DSP)", "DSP"),
    (r"tremendous", "Tremendous (Snowball wallet top-up)", "SBW"), (r"insense", "Insense (UGC)", "CRE"), (r"billo", "Billo (UGC)", "CRE"),
    (r"mosscreator|moss creator", "MossCreator", "CRE"),
    (r"shopify", "Shopify", "SHOP"), (r"klaviyo", "Klaviyo", "KLV"),
    (r"facebk|facebook|meta platforms", "Meta Ads", "ADS"), (r"applovin", "AppLovin Ads", "ADS"),
    (r"microsoft\*ads|microsoft ads", "Microsoft Ads", "ADS"), (r"google.*ads|ads\d{6}|google inc\.", "Google Ads", "ADS"),
    (r"amazon advertising|amzn.*ads", "Amazon Ads", "ADS"),
    (r"uline", "Uline", "SUP"),
    (r"upwork", "Upwork", "UPW"), (r"fiverr", "Fiverr", "UPW"), (r"onlinejobs", "OnlineJobs.PH", "UPW"),
    (r"numeral", "Numeral (sales-tax filing fee)", "TAX"), (r"harvard business", "Harvard Business Services", "TAX"),
    (r"morris,? nichols|arsht", "Morris Nichols (lawyers)", "LEGAL"),
    (r"gs1", "GS1 US", "TAX"), (r"delaware business", "Delaware Business Incorporators", "TAX"),
    (r"daily mentor", "Daily Mentor", "EDU"), (r"skool", "Skool", "EDU"), (r"whop", "Whop", "EDU"),
    (r"disrupter school", "Disrupter School", "EDU"), (r"createwithoutlimits", "Create Without Limits", "EDU"),
    (r"makeugc|syntheticugc|enhancor", "MakeUGC / SyntheticUGC", "MC"), (r"scrape creators", "Scrape Creators", "MT"),
    (r"north beam|northbeam", "Northbeam", "MT"), (r"elevar", "Elevar", "MT"), (r"foreplay", "Foreplay", "MT"),
    (r"intelligems", "Intelligems", "MT"), (r"adspower", "AdsPower", "MT"), (r"adspy", "AdSpy", "MT"),
    (r"dropispy", "Dropispy", "MT"), (r"windsor\.ai", "Windsor.ai", "MT"), (r"levanta", "Levanta", "MT"),
    (r"gethookd", "Gethookd", "MT"), (r"adnova", "Adnova.ai", "MT"), (r"duoplus", "DuoPlus", "MT"),
    (r"exportcomments", "ExportComments", "MT"), (r"madgicx", "Madgicx", "MT"), (r"brandsearch", "BrandSearch", "MT"),
    (r"higgsfield", "Higgsfield", "MC"), (r"topview", "TopView.ai", "MC"), (r"klingai|kling", "Kling AI", "MC"),
    (r"dreamina", "Dreamina", "MC"), (r"hedra", "Hedra", "MC"), (r"runway", "Runway", "MC"), (r"magnific", "Magnific AI", "MC"),
    (r"ltx|lightricks", "LTX Studio", "MC"), (r"midjourney", "Midjourney", "MC"), (r"suno", "Suno", "MC"),
    (r"artlist", "Artlist", "MC"), (r"epidemic sound", "Epidemic Sound", "MC"), (r"elevenlabs", "ElevenLabs", "MC"),
    (r"capcut", "CapCut", "MC"), (r"fal\.ai", "fal.ai", "MC"), (r"meshy", "Meshy", "MC"), (r"pika", "Pika", "MC"),
    (r"twelve ?labs", "Twelve Labs", "MC"),
    (r"openrouter", "OpenRouter", "MC"), (r"openai|chatgpt", "OpenAI", "AI"), (r"claude team", "Claude Team", "MC"),
    (r"anthropic|claude", "Anthropic / Claude", "MC"), (r"nous research", "Nous Research", "MC"), (r"vast\.ai", "Vast.ai", "MC"),
    (r"manus", "Manus AI", "AI"), (r"cursor", "Cursor", "AI"), (r"replit", "Replit", "AI"), (r"apify", "Apify", "MC"),
    (r"firecrawl", "Firecrawl", "MC"), (r"grok|x\.ai|xai", "Grok / xAI", "MC"),
    (r"notion", "Notion", "SW"), (r"slack", "Slack", "SW"), (r"sqsp|squarespace", "Squarespace / Google Workspace", "SW"),
    (r"adobe", "Adobe", "MT"), (r"canva", "Canva", "MT"), (r"figma", "Figma", "MT"), (r"zoom", "Zoom", "SW"),
    (r"calendly", "Calendly", "SW"), (r"loom", "Loom", "SW"), (r"microsoft|skype", "Microsoft 365", "SW"),
    (r"google one", "Google One", "SW"), (r"n8n", "n8n Cloud", "SW"), (r"zapier", "Zapier", "SW"), (r"sync2sheet", "Sync2Sheet", "SW"),
    (r"timedoctor|time doctor", "Time Doctor", "SW"), (r"pandadoc", "PandaDoc", "SW"), (r"pacdora", "Pacdora", "SW"),
    (r"pdfaid|pdfcustomers|pdffiller|sgt\*", "PDF tools", "SW"), (r"quickbooks|intuit", "QuickBooks", "SW"),
    (r"hostinger", "Hostinger", "MC"), (r"cloudflare", "Cloudflare", "MT"), (r"digitalocean", "DigitalOcean", "MT"),
    (r"browserstack", "BrowserStack", "MT"), (r"alibaba cloud", "Alibaba Cloud", "MC"), (r"webshare|lumiproxy", "Webshare proxy", "MT"),
    (r"surfshark|expressvpn", "VPN", "SW"), (r"replo", "Replo", "MT"), (r"sellerboard", "Sellerboard", "MT"),
    (r"helium", "Helium 10", "MT"), (r"goodloading", "Goodloading", "SW"), (r"atlassian|jira", "Atlassian", "SW"),
    (r"paddle", "App billed via Paddle", "SW"), (r"github", "GitHub", "SW"), (r"tiger-roar", "tiger-roar.net", "SW"),
    (r"pdfcustomers", "PDF tools", "SW"),
]
# payees that are never a P&L line of this file (suppliers, 3PL, freight, taxes, ad platforms paid by transfer,
# internal transfers, items the owner excluded) - left out of the output entirely
SKIP = re.compile(
    r"daily credit card payment|payment from platinum|credit card payment|internal|transfer to|transfer from|"
    r"shipmonk|hebei|huaren|jihong|zhihang|lirking|petwant|andejian|peter xu|ningbo|glantu|vinalink|flexport|rena pet|shui mu|hytek|"
    r"faspect|relqik|"
    r"dept|revenue|tax|treasury|treas\b|state of|comptroller|comp of|comm of|commwlth|webfile|remote sell|hiosales|utah|kygov|cdor|irs|vtax|dc-otr|som\b|dtf|"
    r"facebook|meta platforms|google ads|amazon advertising|applovin|walmart|tiktok|"
    r"shopify paym|paypal|afterpay|amazon\.c|stripe|slash fee|slash subscription|wire transfer fee|foreign transaction fee",
    re.I)


# Billing cycle per vendor (marketing team, 22-27/10/2026): M = monthly, Y = yearly (spread over 12 months of service
# starting the charge month), H = 6 months (spread 6), Q = quarterly (spread 3), W = weekly, U = usage-based top-ups /
# credits, O = one-off. Vendors not listed = M. Amount thresholds: Hostinger >= $400 and CapCut >= $100 are yearly plans.
CYCLE_CODES = {"M": "monthly", "Y": "yearly, spread over 12 months", "H": "6-month plan, spread over 6 months",
               "Q": "quarterly, spread over 3 months", "W": "weekly", "U": "usage / credits", "O": "one-off"}
CYCLE = {
    "Tremendous (Snowball wallet top-up)": "U", "Higgsfield": "U", "Insense (UGC)": "U", "MossCreator": "U", "Billo (UGC)": "U",
    "Twelve Labs": "U", "OpenRouter": "U", "Anthropic / Claude": "U", "Apify": "U", "Vast.ai": "U", "Grok / xAI": "U",
    "DigitalOcean": "U", "Nous Research": "U", "Uline": "U", "SparkX (Amazon DSP)": "U",
    "Intelligems": "H",
    "AdsPower": "Y", "ElevenLabs": "Y", "Epidemic Sound": "Y", "Helium 10": "Y", "Webshare proxy": "Y", "GS1 US": "Y",
    "Harvard Business Services": "Y", "Delaware Business Incorporators": "Y", "Hostinger": "Y",
    "Upwork": "W",
    "Madgicx": "O", "DuoPlus": "O", "VPN": "O", "Daily Mentor": "O", "tiger-roar.net": "O", "Alibaba Cloud": "O", "Morris Nichols (lawyers)": "O",
}
AMOUNT_OVERRIDE = {"Hostinger": (400.0, "Y", "M"), "CapCut": (100.0, "Y", "M")}   # vendor: (threshold, cycle if >=, cycle if <)
SPREAD = {"Y": 12, "H": 6, "Q": 3}


def cycle_of(vendor, amt):
    if vendor in AMOUNT_OVERRIDE:
        th, big, small = AMOUNT_OVERRIDE[vendor]
        return big if amt >= th else small
    return CYCLE.get(vendor, "M")


def month_add(m, n):
    y, mm = int(m[:4]), int(m[5:7]) + n
    y += (mm - 1) // 12
    mm = (mm - 1) % 12 + 1
    return "%04d-%02d" % (y, mm)


def spread_months(day, amt, cy):
    """[(service month, amount)] - yearly / 6-month / quarterly plans are spread evenly from the charge month."""
    n = SPREAD.get(cy, 1)
    if n == 1 or abs(amt) < 0.005:
        return [(day[:7], amt)]
    part = round(amt / n, 2)
    out = [(month_add(day[:7], i), part) for i in range(n)]
    out[-1] = (out[-1][0], round(amt - part * (n - 1), 2))   # rounding remainder on the last month
    return out


def classify(text):
    t = text.lower()
    for rx, vendor, line in RULES:
        if re.search(rx, t):
            return vendor, line
    return None, None


def local_day(iso):
    d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    if ZoneInfo:
        d = d.astimezone(ZoneInfo(TZ))
    return d.date().isoformat()


class Api:
    def __init__(self):
        self.entity = None

    def get(self, path, params=None):
        url = BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
        for attempt in range(6):
            req = urllib.request.Request(url, headers={"X-API-Key": API_KEY, "Accept": "application/json",
                                                       "User-Agent": "cattasaurus-pnl/" + SCRIPT_VERSION})
            if self.entity:
                req.add_header("x-legal-entity", self.entity)
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    return json.loads(r.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", "replace")[:300]
                if e.code == 400 and not self.entity and "legal" in body.lower():
                    self.pick_entity()
                    continue
                if e.code in (429, 500, 502, 503, 504):
                    time.sleep(min(60, 2 ** attempt * 2))
                    continue
                raise SystemExit("Slash API %s on %s: %s" % (e.code, path, body))
            except urllib.error.URLError:
                time.sleep(min(60, 2 ** attempt * 2))
        raise SystemExit("Slash API unreachable: " + path)

    def pick_entity(self):
        r = self.get("/legal-entity")
        items = (r.get("items") or r.get("data") or []) if isinstance(r, dict) else (r or [])
        if not items:
            raise SystemExit("No legal entity visible to this key")
        pick = next((x for x in items if "cattasaurus" in str(x.get("name", "")).lower()), items[0])
        self.entity = pick.get("id")
        print("Using legal entity", str(pick.get("name") or "")[:40], "(%d visible)" % len(items))

    def _pages(self, path, base_params):
        out, cursor, pages = [], None, 0
        while True:
            p = dict(base_params)
            if cursor:
                p["cursor"] = cursor
            r = self.get(path, p)
            items = r.get("items") or []
            out.extend(items)
            pages += 1
            cursor = (r.get("metadata") or {}).get("nextCursor")
            if not cursor or not items:
                break
            if pages > 3000:
                raise SystemExit("too many pages")
        return out

    def transactions(self, start, end):
        # v2 (user API keys from Settings > API keys): needs x-legal-entity, RFC 3339 bounds
        self.pick_entity()
        try:
            out = self._pages("/v2/transactions", {"from": start.strftime("%Y-%m-%dT%H:%M:%SZ"), "to": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
                                                   "limit": "100", "sort": "date", "sortDirection": "asc"})
            print("read via /v2/transactions")
            return out
        except SystemExit as e:
            if "user_api_key_required" not in str(e):
                raise
        # v1 (legal-entity keys)
        self.entity = None
        out = self._pages("/transaction", {"filter:from_date": str(int(start.timestamp() * 1000)), "filter:to_date": str(int(end.timestamp() * 1000))})
        print("read via /transaction (v1)")
        return out

    def payees(self, start, end):
        """transaction id -> recipient display name, via /v2/transfers (transactionIds) + /v2/recipients.
        Only used to classify; a payee name is written out only for marketing / legal lines."""
        names, by_tx = {}, {}
        try:
            for r in self._pages("/v2/recipients", {"limit": "100", "includeArchived": "true"}):
                names[r.get("id")] = r.get("name") or r.get("recipientLegalName") or ""
            for t in self._pages("/v2/transfers", {"from": start.strftime("%Y-%m-%dT%H:%M:%SZ"), "to": end.strftime("%Y-%m-%dT%H:%M:%SZ"), "limit": "100"}):
                nm = names.get(t.get("recipientId"), "")
                for tx in t.get("transactionIds") or []:
                    by_tx[tx] = nm
        except SystemExit as e:
            print("payee lookup unavailable:", str(e)[:120])
        print("payees resolved for", len(by_tx), "transactions,", len(names), "recipients")
        return by_tx


def rail(t):
    cat = t.get("category")
    if cat:
        return {"international_wire": "wire", "realtime": "rtp"}.get(cat, cat)
    if t.get("cardId") or t.get("merchantData"):
        return "card"
    for k, name in (("achInfo", "ach"), ("wireInfo", "wire"), ("rtpInfo", "rtp"), ("feeInfo", "fee")):
        if t.get(k):
            return name
    return "other"


def main():
    if not API_KEY:
        print("::notice::SLASH_API_KEY secret not set - skipping")
        return
    start = datetime.fromisoformat(HISTORY_START).replace(tzinfo=timezone.utc)
    end = datetime.now(timezone.utc)
    api = Api()
    raw = api.transactions(start, end)
    print("fetched", len(raw), "transactions")
    payee = api.payees(start, end) if api.entity else {}

    charges, monthly, accrual = [], defaultdict(lambda: defaultdict(float)), defaultdict(lambda: defaultdict(float))
    unk_card, unk_xfer, pending = defaultdict(lambda: [0.0, 0]), defaultdict(lambda: [0.0, 0]), defaultdict(float)
    stats = defaultdict(int)
    for t in raw:
        stats["status:" + str(t.get("status"))] += 1
        stats["rail:" + rail(t)] += 1
        cents = t.get("amountCents")
        if cents is None:
            continue
        amt = -cents / 100.0                      # positive = money out
        md = t.get("merchantData") or ((t.get("details") or {}).get("merchant")) or {}
        who = payee.get(t.get("id"), "")
        text = " | ".join(str(x) for x in (who, t.get("description"), md.get("description"), t.get("memo")) if x)
        day = local_day(t.get("date") or t.get("createdAt") or "")
        r = rail(t)
        if r == "book":
            continue                              # moves between own accounts (card repayments, sub-accounts)
        ds = str(t.get("detailedStatus") or "")
        if t.get("status") == "failed" or ds in ("declined", "canceled", "failed"):
            continue
        vendor, line = classify(text)
        if t.get("status") == "pending":
            if line in KEEP_CHARGES:
                pending[line] += amt
            continue
        if line is None:
            if SKIP.search(text) or abs(amt) < 0.005:
                continue
            if r == "card":
                k = ((md.get("description") or t.get("description") or "?")[:40], day[:7])
                unk_card[k][0] += amt
                unk_card[k][1] += 1
            elif amt >= 500:
                unk_xfer[day[:7]][0] += amt      # count + total only: transfer descriptions can name suppliers / invoices
                unk_xfer[day[:7]][1] += 1
            continue
        if line == "TAX" and r != "card" and "numeral" in text.lower():
            continue                              # Numeral by transfer = sales tax remitted for the company (pass-through)
        if line == "ADS":
            monthly[day[:7]]["ADS_CARD"] += amt   # information only (already on the P&L)
            continue
        if line == "SHOP" and r != "card":
            continue                              # Shopify payouts / transfers are not app charges
        monthly[day[:7]][line] += amt
        c = {"d": day, "v": vendor, "l": line, "a": round(amt, 2), "k": r}
        cy = cycle_of(vendor, amt)
        c["cy"] = cy
        sp = spread_months(day, amt, cy)
        if len(sp) > 1:
            c["sp"] = [[m, v] for m, v in sp]
        for m, v in sp:
            accrual[m][line] += v
        if line in ("AGENCY", "CRE", "SBW", "DSP", "LEGAL"):
            c["memo"] = (t.get("memo") or "")[:80]
            c["desc"] = (t.get("description") or "")[:70]
            if who:
                c["payee"] = who[:60]
        if t.get("originalCurrency") and (t["originalCurrency"].get("code") or "USD") != "USD":
            c["fx"] = t["originalCurrency"].get("code")
        charges.append(c)

    charges.sort(key=lambda c: (c["d"], c["v"]))
    out = {
        "schema": SCHEMA,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "meta": {"source": "Slash API (read-only key)", "script_version": SCRIPT_VERSION, "from": HISTORY_START,
                 "to": end.date().isoformat(), "timezone": TZ, "transactions_read": len(raw), "charges": len(charges),
                 "stats": dict(stats), "lines": LINES, "cycle_codes": CYCLE_CODES, "cycles": CYCLE, "amount_override": {k: list(v) for k, v in AMOUNT_OVERRIDE.items()},
                 "note": "Positive = money out. Only app / marketing-vendor / Upwork / Numeral charges are listed; "
                         "suppliers, taxes, ad platforms, payouts and balances are never written. "
                         "monthly = by charge date; accrual = by month of service (yearly / 6-month / quarterly plans spread evenly from the charge month; "
                         "charges[].cy = billing cycle, charges[].sp = [month, amount] split when spread). SBW (Tremendous) is a wallet top-up, not a cost."},
        "monthly": {m: {k: round(v, 2) for k, v in sorted(x.items())} for m, x in sorted(monthly.items())},
        "accrual": {m: {k: round(v, 2) for k, v in sorted(x.items())} for m, x in sorted(accrual.items())},
        "pending": {k: round(v, 2) for k, v in pending.items()},
        "charges": charges,
        "unclassified_card": sorted([{"v": k[0], "m": k[1], "a": round(v[0], 2), "n": v[1]} for k, v in unk_card.items()],
                                    key=lambda x: (x["m"], -x["a"])),
        "unclassified_transfers": {m: {"count": v[1], "total": round(v[0], 2)} for m, v in sorted(unk_xfer.items())},
    }
    os.makedirs(os.path.dirname(OUTPUT) or ".", exist_ok=True)
    with open(OUTPUT, "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print("wrote", OUTPUT, "-", len(charges), "charges,", len(out["unclassified_card"]), "unclassified card rows,",
          len(unk_xfer), "unclassified transfers")


if __name__ == "__main__":
    main()
