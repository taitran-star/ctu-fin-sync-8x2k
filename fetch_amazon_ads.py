#!/usr/bin/env python3
"""
Cattasaurus - Amazon Ads API (Sponsored Products / Brands / Display) -> campaign, ASIN and search-term detail.

v2.0 (23/10/2026). Needs the Ads API app to be approved and authorised: secrets AMAZON_ADS_CLIENT_ID,
AMAZON_ADS_CLIENT_SECRET, AMAZON_ADS_REFRESH_TOKEN (from the one-time authorization workflow). The workflow skips
quietly while the refresh token is missing.

Writes
  data/amazon_ads_api.json   daily totals, campaigns (SP/SB/SD, budget, status, daily arrays incl. new-to-brand for
                             SB/SD), SP advertised ASINs (daily), SP search terms (summary of the last 30 days, top 400
                             by spend). Arrays follow "fields": spend, impressions, clicks, purchases, sales, units,
                             ntb_purchases, ntb_sales.
  data/amazon_ads.json       ONLY the console fields of the fetched days (purchase_value, purchases, units_ppc, clicks,
                             impressions, roas/acos/cpc/ctr/cpa, console_spend_api, ntb_*) + meta.ppc_last_day - what
                             the manual Sellerboard PPC pull used to fill. Spend (Sellerboard automation) is untouched.

Env: AMAZON_ADS_PROFILE_ID (optional pin), AMAZON_ADS_COUNTRY (US), AMAZON_ADS_REGION (NA), AMAZON_ADS_PRODUCTS,
WINDOW_DAYS (45, reports in <=31-day chunks; the last days keep growing with the 14-day attribution),
AMAZON_TERM_DAYS (30), AMAZON_TERM_KEEP (400), AMAZON_PRODUCT_ALIASES, OUTPUT_PATH, ADS_PATH.
"""
import gzip
import io
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

# Amazon Ads reports are day-bucketed in the advertising PROFILE's timezone (US profiles:
# America/Los_Angeles) and have no hourly granularity, so they cannot be re-bucketed. The
# P&L standard is REPORT_TIMEZONE; a mismatch is only reported as a warning.
REPORT_TIMEZONE = os.environ.get("REPORT_TIMEZONE", "America/Los_Angeles").strip() or "UTC"

SCRIPT_VERSION = "2.0"
SCHEMA = 2

REGION = os.environ.get("AMAZON_ADS_REGION", "NA").strip().upper()
HOSTS = {
    "NA": ("https://advertising-api.amazon.com", "https://api.amazon.com/auth/o2/token"),
    "EU": ("https://advertising-api-eu.amazon.com", "https://api.amazon.co.uk/auth/o2/token"),
    "FE": ("https://advertising-api-fe.amazon.com", "https://api.amazon.co.jp/auth/o2/token"),
}
API_HOST, TOKEN_URL = HOSTS.get(REGION, HOSTS["NA"])
COUNTRY = os.environ.get("AMAZON_ADS_COUNTRY", "US").strip().upper()
WINDOW_DAYS = int(os.environ.get("WINDOW_DAYS", "45"))
OUTPUT_PATH = os.environ.get("OUTPUT_PATH", "data/amazon_ads_api.json")      # campaign / ASIN / search-term detail
ADS_PATH = os.environ.get("ADS_PATH", "data/amazon_ads.json")                   # daily file of the P&L (Sellerboard spend): console fields merged in
PRODUCTS = [p.strip().upper() for p in os.environ.get(
    "AMAZON_ADS_PRODUCTS", "SPONSORED_PRODUCTS,SPONSORED_BRANDS,SPONSORED_DISPLAY").split(",") if p.strip()]
CHUNK_DAYS = 31          # v3 campaign reports accept at most 31 days per request
POLL_SECONDS = 20
POLL_MAX_MINUTES = 25

# v2.0 report specs. SP keeps 14-day attribution (what the console shows); SB / SD use their own default and add
# new-to-brand columns. A spec whose columns Amazon rejects is retried with its "fallback" columns.
REPORT_SPECS = {
    "SPONSORED_PRODUCTS": {
        "reportTypeId": "spCampaigns", "groupBy": ["campaign"], "channel": "SP",
        "columns": ["date", "campaignId", "campaignName", "campaignStatus", "campaignBudgetAmount", "impressions", "clicks",
                    "cost", "purchases14d", "sales14d", "unitsSoldClicks14d"],
        "purchases": ["purchases14d", "purchases"], "sales": ["sales14d", "sales"], "units": ["unitsSoldClicks14d", "unitsSold"],
    },
    "SPONSORED_BRANDS": {
        "reportTypeId": "sbCampaigns", "groupBy": ["campaign"], "channel": "SB",
        "columns": ["date", "campaignId", "campaignName", "campaignStatus", "campaignBudgetAmount", "impressions", "clicks",
                    "cost", "purchases", "sales", "unitsSold", "newToBrandPurchases", "newToBrandSales"],
        "fallback": ["date", "campaignId", "campaignName", "campaignStatus", "impressions", "clicks", "cost", "purchases", "sales"],
        "purchases": ["purchases", "purchases14d"], "sales": ["sales", "sales14d"], "units": ["unitsSold"],
    },
    "SPONSORED_DISPLAY": {
        "reportTypeId": "sdCampaigns", "groupBy": ["campaign"], "channel": "SD",
        "columns": ["date", "campaignId", "campaignName", "campaignStatus", "campaignBudgetAmount", "impressions", "clicks",
                    "cost", "purchases", "sales", "unitsSold", "newToBrandPurchases", "newToBrandSales"],
        "fallback": ["date", "campaignId", "campaignName", "campaignStatus", "impressions", "clicks", "cost", "purchases", "sales"],
        "purchases": ["purchases", "purchases14d"], "sales": ["sales", "sales14d"], "units": ["unitsSold"],
    },
}
ASIN_SPEC = {"adProduct": "SPONSORED_PRODUCTS", "reportTypeId": "spAdvertisedProduct", "groupBy": ["advertiser"],
             "columns": ["date", "campaignId", "advertisedAsin", "advertisedSku", "impressions", "clicks", "cost",
                         "purchases14d", "sales14d", "unitsSoldClicks14d"]}
TERM_SPEC = {"adProduct": "SPONSORED_PRODUCTS", "reportTypeId": "spSearchTerm", "groupBy": ["searchTerm"],
             "columns": ["searchTerm", "campaignId", "campaignName", "keyword", "matchType", "impressions", "clicks", "cost",
                         "purchases14d", "sales14d"]}
TERM_DAYS = int(os.environ.get("AMAZON_TERM_DAYS", "30"))
TERM_KEEP = int(os.environ.get("AMAZON_TERM_KEEP", "400"))
MINIMAL_COLUMNS = ["date", "campaignId", "campaignName", "impressions", "clicks", "cost"]

MARKET_TOKENS = {"us": "US", "ca": "CA", "uk": "UK", "de": "DE", "au": "AU"}
STAGE_TOKENS = {"auto": "Auto", "manual": "Manual", "exact": "Exact", "broad": "Broad", "phrase": "Phrase",
                "brand": "Brand", "ranking": "Ranking", "defense": "Defense", "test": "Testing", "testing": "Testing",
                "scaling": "Scaling", "scale": "Scaling"}


def log(msg):
    print(f"[amazon_ads] {msg}", file=sys.stderr, flush=True)


def parse_product_aliases():
    raw = os.environ.get("AMAZON_PRODUCT_ALIASES", "").strip()
    if not raw:
        return {}
    try:
        return {str(k).lower(): str(v) for k, v in (json.loads(raw) or {}).items()}
    except ValueError:
        log("AMAZON_PRODUCT_ALIASES is not valid JSON - ignoring")
        return {}


PRODUCT_ALIASES = parse_product_aliases()


def classify_campaign(name):
    parts = [p.strip() for p in re.split(r"\s+[-|/]\s+|\s*\|\s*", name or "") if p.strip()]
    product = parts[0] if parts else (name or "?")
    low = (name or "").lower()
    for needle, label in PRODUCT_ALIASES.items():
        if needle in low:
            product = label
            break
    market, stage = None, None
    for p in parts[1:]:
        pl = p.lower()
        if pl in MARKET_TOKENS:
            market = MARKET_TOKENS[pl]
        for tok, label in STAGE_TOKENS.items():
            if pl == tok or pl.startswith(tok + " ") or pl.endswith(" " + tok):
                stage = label
    strategy = [p for p in parts[1:] if p.lower() not in MARKET_TOKENS and p.lower() not in STAGE_TOKENS]
    return {"product": product, "market": market or COUNTRY, "stage": stage or "Other",
            "strategy": " / ".join(strategy) or None}


# ----------------------------------------------------------------------------
# HTTP
# ----------------------------------------------------------------------------

class Client:
    def __init__(self):
        self.client_id = os.environ.get("AMAZON_ADS_CLIENT_ID", "").strip()
        self.client_secret = os.environ.get("AMAZON_ADS_CLIENT_SECRET", "").strip()
        self.refresh_token = os.environ.get("AMAZON_ADS_REFRESH_TOKEN", "").strip()
        if not (self.client_id and self.client_secret and self.refresh_token):
            log("Missing AMAZON_ADS_CLIENT_ID / AMAZON_ADS_CLIENT_SECRET / AMAZON_ADS_REFRESH_TOKEN")
            sys.exit(1)
        self.token = None
        self.token_time = 0
        self.requests = 0

    def access_token(self):
        if self.token and time.time() - self.token_time < 50 * 60:
            return self.token
        body = urllib.parse.urlencode({"grant_type": "refresh_token", "refresh_token": self.refresh_token,
                                       "client_id": self.client_id, "client_secret": self.client_secret}).encode()
        req = urllib.request.Request(TOKEN_URL, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                tok = json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors="replace")[:400]
            log(f"LWA token refresh failed: HTTP {e.code} {msg} -> re-run the authorization grant and update AMAZON_ADS_REFRESH_TOKEN")
            sys.exit(1)
        self.token, self.token_time = tok["access_token"], time.time()
        return self.token

    def call(self, method, path, body=None, content_type="application/json", profile_id=None, accept=None, raw=False):
        url = path if path.startswith("http") else API_HOST + path
        headers = {"Authorization": f"Bearer {self.access_token()}",
                   "Amazon-Advertising-API-ClientId": self.client_id}
        if profile_id:
            headers["Amazon-Advertising-API-Scope"] = str(profile_id)
        if body is not None:
            headers["Content-Type"] = content_type
        if accept:
            headers["Accept"] = accept
        data = json.dumps(body).encode() if body is not None else None
        for attempt in range(1, 7):
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=180) as resp:
                    self.requests += 1
                    payload = resp.read()
                    return payload if raw else (json.loads(payload.decode()) if payload else {})
            except urllib.error.HTTPError as e:
                text = e.read().decode(errors="replace")
                if e.code in (429, 500, 502, 503, 504) and attempt < 6:
                    wait = min(60, 5 * attempt)
                    log(f"HTTP {e.code} on {path} - retry in {wait}s")
                    time.sleep(wait)
                    continue
                raise RuntimeError(f"HTTP {e.code} {method} {path}: {text[:500]}")
            except urllib.error.URLError as e:
                if attempt < 6:
                    time.sleep(5 * attempt)
                    continue
                raise
        return {}


# ----------------------------------------------------------------------------
# Reports
# ----------------------------------------------------------------------------

def request_report(client, profile_id, ad_product, report_type, group_by, start, end, columns, time_unit="DAILY"):
    body = {
        "name": f"cattasaurus {report_type} {start}..{end}",
        "startDate": start, "endDate": end,
        "configuration": {
            "adProduct": ad_product,
            "groupBy": group_by,
            "columns": columns,
            "reportTypeId": report_type,
            "timeUnit": time_unit,
            "format": "GZIP_JSON",
        },
    }
    r = client.call("POST", "/reporting/reports", body=body,
                    content_type="application/vnd.createasyncreportrequest.v3+json", profile_id=profile_id)
    return r.get("reportId")


def wait_report(client, profile_id, report_id):
    deadline = time.time() + POLL_MAX_MINUTES * 60
    while time.time() < deadline:
        r = client.call("GET", f"/reporting/reports/{report_id}", profile_id=profile_id,
                        accept="application/vnd.createasyncreportrequest.v3+json")
        status = r.get("status")
        if status == "COMPLETED":
            return r.get("url")
        if status == "FAILED":
            raise RuntimeError(f"report {report_id} failed: {r.get('failureReason')}")
        time.sleep(POLL_SECONDS)
    raise RuntimeError(f"report {report_id} not ready after {POLL_MAX_MINUTES} min")


def download_rows(url):
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=300) as resp:
        blob = resp.read()
    try:
        text = gzip.GzipFile(fileobj=io.BytesIO(blob)).read().decode()
    except OSError:
        text = blob.decode()
    rows = json.loads(text) if text.strip() else []
    return rows if isinstance(rows, list) else rows.get("rows", [])


def first_num(row, keys):
    for k in keys:
        if k in row and row[k] is not None:
            try:
                return float(row[k])
            except (TypeError, ValueError):
                continue
    return 0.0




def run_report(client, pid, ad_product, rtype, group_by, start, end, columns, fallback=None, warnings=None, time_unit="DAILY"):
    try:
        rid = request_report(client, pid, ad_product, rtype, group_by, start, end, columns, time_unit)
    except RuntimeError as e:
        if fallback and ("400" in str(e) or "column" in str(e).lower()):
            if warnings is not None:
                warnings.add(f"{rtype}: column set rejected ({str(e)[:120]}) - fallback columns used")
            rid = request_report(client, pid, ad_product, rtype, group_by, start, end, fallback, time_unit)
        else:
            raise
    log(f"{rtype} {start}..{end} report {rid} requested")
    return download_rows(wait_report(client, pid, rid))


def chunk_dates(since, until):
    chunks, s = [], since
    while s <= until:
        e = min(s + timedelta(days=CHUNK_DAYS - 1), until)
        chunks.append((s.strftime("%Y-%m-%d"), e.strftime("%Y-%m-%d")))
        s = e + timedelta(days=1)
    return chunks


# compact daily arrays: [spend, impressions, clicks, purchases, sales, units, ntb_purchases, ntb_sales]
CF = ["spend", "impressions", "clicks", "purchases", "sales", "units", "ntb_purchases", "ntb_sales"]


def add(arr, row, spec_p, spec_s, spec_u):
    arr[0] += first_num(row, ["cost", "spend"])
    arr[1] += first_num(row, ["impressions"])
    arr[2] += first_num(row, ["clicks"])
    arr[3] += first_num(row, spec_p)
    arr[4] += first_num(row, spec_s)
    arr[5] += first_num(row, spec_u)
    arr[6] += first_num(row, ["newToBrandPurchases", "newToBrandPurchases14d"])
    arr[7] += first_num(row, ["newToBrandSales", "newToBrandSales14d"])


def rnd(arr):
    return [round(x, 2) if i in (0, 4, 7) else int(round(x)) for i, x in enumerate(arr)]


def merge_console_fields(daily, last_day, warnings):
    """Write the console numbers (sales / orders / clicks / impressions, SP+SB+SD) into the P&L's daily Amazon Ads
    file for the days this run fetched - the same fields the manual Sellerboard PPC pull used to fill. Spend and the
    Sellerboard fields stay untouched (the P&L line keeps ads_spend_console from the automation)."""
    try:
        with open(ADS_PATH) as f:
            ads = json.load(f)
    except (OSError, ValueError) as e:
        warnings.add(f"{ADS_PATH} not readable ({e}) - console fields not merged")
        return 0
    dd = ads.setdefault("daily", {})
    n = 0
    for day, a in daily.items():
        if day > last_day:
            continue
        row = dd.setdefault(day, {})
        spend_ref = row.get("ads_spend_console") or row.get("spend") or a[0]
        row.update({"purchase_value": round(a[4], 2), "purchases": int(round(a[3])), "units_ppc": int(round(a[5])),
                    "clicks": int(round(a[2])), "impressions": int(round(a[1])), "console_spend_api": round(a[0], 2),
                    "ntb_purchases": int(round(a[6])), "ntb_sales": round(a[7], 2)})
        row["roas"] = round(a[4] / spend_ref, 4) if spend_ref else None
        row["acos"] = round(spend_ref / a[4] * 100, 2) if a[4] else None
        row["cpc"] = round(a[0] / a[2], 2) if a[2] else None
        row["ctr"] = round(a[2] / a[1] * 100, 3) if a[1] else None
        row["cpa"] = round(a[0] / a[3], 2) if a[3] else None
        n += 1
    meta = ads.setdefault("meta", {})
    prev = meta.get("ppc_last_day") or ""
    meta["ppc_last_day"] = max(prev, last_day)
    meta["ppc_source"] = "amazon_ads_api"
    meta["ppc_pulled_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(ADS_PATH, "w") as f:
        json.dump(ads, f, separators=(",", ":"), sort_keys=True)
    return n


def main():
    client = Client()
    now = datetime.now(timezone.utc)
    now_local = now.astimezone(ZoneInfo(REPORT_TIMEZONE)) if ZoneInfo else now
    until = now_local.date() - timedelta(days=1)       # today is never complete
    since = until - timedelta(days=WINDOW_DAYS - 1)
    chunks = chunk_dates(since, until)
    warnings = set()
    profiles = client.call("GET", "/v2/profiles")
    pinned = [p.strip() for p in os.environ.get("AMAZON_ADS_PROFILE_ID", "").split(",") if p.strip()]
    if pinned:
        chosen = [p for p in profiles or [] if str(p.get("profileId")) in pinned]
    else:
        chosen = [p for p in profiles or [] if p.get("countryCode") == COUNTRY and (p.get("accountInfo") or {}).get("type") in ("seller", "vendor")]
    if not chosen:
        log("No advertising profile matched. Profiles seen: " + json.dumps([{k: p.get(k) for k in ("profileId", "countryCode")} for p in profiles or []]))
        return 1
    campaigns, asins, daily, terms = {}, {}, {}, {}
    for p in chosen:
        pid = p["profileId"]
        for product in PRODUCTS:
            spec = REPORT_SPECS.get(product)
            if not spec:
                continue
            for start, end in chunks:
                try:
                    rows = run_report(client, pid, product, spec["reportTypeId"], spec["groupBy"], start, end, spec["columns"], spec.get("fallback"), warnings)
                except Exception as e:  # noqa: BLE001
                    warnings.add(f"{product} {start}..{end}: {str(e)[:200]}")
                    continue
                for row in rows:
                    day, cid = str(row.get("date") or "")[:10], str(row.get("campaignId") or "")
                    if not day or not cid:
                        continue
                    c = campaigns.setdefault(cid, {"name": row.get("campaignName"), "type": spec["channel"], "daily": {}})
                    c["status"] = row.get("campaignStatus") or c.get("status")
                    if row.get("campaignBudgetAmount") is not None:
                        c["budget"] = first_num(row, ["campaignBudgetAmount"])
                    arr = c["daily"].setdefault(day, [0.0] * len(CF))
                    add(arr, row, spec["purchases"], spec["sales"], spec["units"])
                    tot = daily.setdefault(day, [0.0] * len(CF))
                    add(tot, row, spec["purchases"], spec["sales"], spec["units"])
        # SP advertised products (ASIN level)
        for start, end in chunks:
            try:
                rows = run_report(client, pid, ASIN_SPEC["adProduct"], ASIN_SPEC["reportTypeId"], ASIN_SPEC["groupBy"], start, end, ASIN_SPEC["columns"], None, warnings)
            except Exception as e:  # noqa: BLE001
                warnings.add(f"spAdvertisedProduct {start}..{end}: {str(e)[:200]}")
                continue
            for row in rows:
                day, asin = str(row.get("date") or "")[:10], str(row.get("advertisedAsin") or "")
                if not day or not asin:
                    continue
                a = asins.setdefault(asin, {"sku": row.get("advertisedSku"), "daily": {}})
                arr = a["daily"].setdefault(day, [0.0] * len(CF))
                add(arr, row, ["purchases14d"], ["sales14d"], ["unitsSoldClicks14d"])
        # SP search terms, one summary over the last TERM_DAYS days
        t_start = max(since, until - timedelta(days=TERM_DAYS - 1)).strftime("%Y-%m-%d")
        try:
            rows = run_report(client, pid, TERM_SPEC["adProduct"], TERM_SPEC["reportTypeId"], TERM_SPEC["groupBy"], t_start, until.strftime("%Y-%m-%d"), TERM_SPEC["columns"], None, warnings, time_unit="SUMMARY")
            for row in rows:
                k = (str(row.get("searchTerm") or ""), str(row.get("campaignId") or ""), str(row.get("keyword") or ""), str(row.get("matchType") or ""))
                t = terms.setdefault(k, {"term": k[0], "campaign": row.get("campaignName"), "keyword": k[2], "match": k[3], "a": [0.0] * len(CF)})
                add(t["a"], row, ["purchases14d"], ["sales14d"], [])
        except Exception as e:  # noqa: BLE001
            warnings.add(f"spSearchTerm: {str(e)[:200]}")
    if not daily:
        log("No campaign rows returned - nothing written. Warnings: " + "; ".join(sorted(warnings))[:800])
        return 1
    for c in campaigns.values():
        c.update({k: v for k, v in classify_campaign(c.get("name")).items() if k in ("product", "stage")})
        c["daily"] = {k: rnd(v) for k, v in sorted(c["daily"].items())}
    for a in asins.values():
        a["daily"] = {k: rnd(v) for k, v in sorted(a["daily"].items())}
    term_list = sorted(terms.values(), key=lambda t: -t["a"][0])[:TERM_KEEP]
    for t in term_list:
        t["a"] = rnd(t["a"])
    last_day = max(daily)
    out = {"schema": SCHEMA, "source": "amazon_ads_api", "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
           "profile_ids": [str(p["profileId"]) for p in chosen], "currency": chosen[0].get("currencyCode") or "USD",
           "timezone": REPORT_TIMEZONE, "attribution": "SP 14d (console) / SB, SD product default", "fields": CF,
           "window": {"start": since.strftime("%Y-%m-%d"), "end": until.strftime("%Y-%m-%d")},
           "daily": {k: rnd(v) for k, v in sorted(daily.items())}, "campaigns": campaigns, "asins": asins,
           "search_terms": {"start": t_start, "end": until.strftime("%Y-%m-%d"), "rows": term_list},
           "meta": {"script_version": SCRIPT_VERSION, "api_requests": client.requests, "warnings": sorted(warnings)}}
    with open(OUTPUT_PATH, "w") as f:
        json.dump(out, f, separators=(",", ":"), sort_keys=True)
    merged = merge_console_fields(daily, last_day, warnings)
    log(f"Wrote {OUTPUT_PATH}: {len(campaigns)} campaigns, {len(asins)} ASINs, {len(term_list)} search terms, "
        f"{len(daily)} days; console fields merged into {ADS_PATH} for {merged} days (to {last_day}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
