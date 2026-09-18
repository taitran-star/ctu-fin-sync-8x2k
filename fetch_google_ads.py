#!/usr/bin/env python3
"""
Cattasaurus - Google Ads spend fetcher (Google Ads API, service-account auth).

Runs on a schedule (GitHub Actions) completely independently of Claude. Pulls
daily spend / clicks / conversions for the trailing window straight from the
Google Ads API (REST, searchStream) and writes data/google_ads.json in the same
shape as data/meta_ads.json, so the P&L dashboard sync can embed it.

Auth (2026 workflow, no developer token, no OAuth refresh-token dance):
  a Google Cloud project with the Google Ads API enabled (Explorer access level
  or higher), a service account in that project with a JSON key, and that
  service account's email added as a *Read only* user of the Google Ads account
  (Admin > Access and security). Access token = service-account JWT exchange,
  done fresh every run (google-auth library).

Required env vars (GitHub Actions Secrets) - ONE of the two auth routes:
  (a) GOOGLE_ADS_SERVICE_ACCOUNT_JSON  whole contents of a service-account key file, or
  (b) GOOGLE_ADS_CLIENT_ID + GOOGLE_ADS_CLIENT_SECRET + GOOGLE_ADS_REFRESH_TOKEN
      (OAuth web client in the Cloud project; refresh token minted once in the OAuth
      Playground with scope https://www.googleapis.com/auth/adwords; use this when an
      org policy blocks service-account keys)
  GOOGLE_ADS_CUSTOMER_ID            10-digit Google Ads account id (dashes ok);
                                    several accounts: comma-separated
Optional:
  GOOGLE_ADS_LOGIN_CUSTOMER_ID      manager (MCC) id when the service account was
                                    added at the manager level instead
  GOOGLE_ADS_DEVELOPER_TOKEN        legacy, ignored by Google since 2026-09-09; sent
                                    only if provided
  GOOGLE_ADS_API_VERSION            default v25
  WINDOW_DAYS                       default 45
  OUTPUT_PATH                       default data/google_ads.json
  GOOGLE_PRODUCT_ALIASES            JSON {"fountain": "Water Fountain"} substring ->
                                    product label (same idea as META_PRODUCT_ALIASES)

Output (per day, account currency):
  daily.<date>: spend, impressions, clicks, conversions, conversion_value, roas
  campaigns.<id>: name, status, channel (SEARCH / SHOPPING / PERFORMANCE_MAX / ...),
                  product, daily.<date>, last_30d, window totals
  products.<label>: roll-up of campaigns by product
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

SCRIPT_VERSION = "1.0"
SCHEMA = 1

API_VERSION = os.environ.get("GOOGLE_ADS_API_VERSION", "v25").strip()
HOST = "https://googleads.googleapis.com"
WINDOW_DAYS = int(os.environ.get("WINDOW_DAYS", "45"))
OUTPUT_PATH = os.environ.get("OUTPUT_PATH", "data/google_ads.json")
SCOPE = "https://www.googleapis.com/auth/adwords"

DAILY_FIELDS = ["spend", "impressions", "clicks", "conversions", "conversion_value", "roas"]
CAMPAIGN_FIELDS = ["spend", "impressions", "clicks", "conversions", "conversion_value",
                   "all_conversions", "all_conversion_value"]

MARKET_TOKENS = {"us": "US", "usa": "US", "ca": "CA", "canada": "CA", "uk": "UK", "au": "AU", "eu": "EU"}
STAGE_TOKENS = {"testing": "Testing", "test": "Testing", "scaling": "Scaling", "scale": "Scaling",
                "control": "Control", "retargeting": "Retargeting", "rt": "Retargeting", "brand": "Brand"}
CHANNEL_LABELS = {"SEARCH": "Search", "SHOPPING": "Shopping", "PERFORMANCE_MAX": "Performance Max",
                  "DISPLAY": "Display", "VIDEO": "Video", "DEMAND_GEN": "Demand Gen",
                  "MULTI_CHANNEL": "App", "LOCAL": "Local", "SMART": "Smart"}


def log(msg):
    print(f"[google_ads] {msg}", file=sys.stderr, flush=True)


def parse_product_aliases():
    raw = os.environ.get("GOOGLE_PRODUCT_ALIASES", "").strip()
    if not raw:
        return {}
    try:
        return {str(k).lower(): str(v) for k, v in (json.loads(raw) or {}).items()}
    except ValueError:
        log("GOOGLE_PRODUCT_ALIASES is not valid JSON - ignoring")
        return {}


PRODUCT_ALIASES = parse_product_aliases()


def classify_campaign(name):
    """'Peekaboo - Search - US - Scaling' -> product/market/stage/strategy (same grammar as Meta)."""
    parts = [p.strip() for p in re.split(r"\s+[-|/]\s+", name or "") if p.strip()]
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
    return {"product": product, "market": market or "US", "stage": stage or "Other",
            "strategy": " / ".join(strategy) or None}


# ----------------------------------------------------------------------------
# Auth
# ----------------------------------------------------------------------------

def get_access_token():
    """Service-account key if provided, else OAuth refresh token (user consent done once
    in the OAuth Playground) - the latter is the route when an org policy blocks SA keys."""
    raw = os.environ.get("GOOGLE_ADS_SERVICE_ACCOUNT_JSON", "").strip()
    if not raw:
        cid = os.environ.get("GOOGLE_ADS_CLIENT_ID", "").strip()
        secret = os.environ.get("GOOGLE_ADS_CLIENT_SECRET", "").strip()
        refresh = os.environ.get("GOOGLE_ADS_REFRESH_TOKEN", "").strip()
        if not (cid and secret and refresh):
            log("Missing credentials: set GOOGLE_ADS_SERVICE_ACCOUNT_JSON, or GOOGLE_ADS_CLIENT_ID + "
                "GOOGLE_ADS_CLIENT_SECRET + GOOGLE_ADS_REFRESH_TOKEN")
            sys.exit(1)
        body = urllib.parse.urlencode({"client_id": cid, "client_secret": secret,
                                       "refresh_token": refresh, "grant_type": "refresh_token"}).encode()
        req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body,
                                     headers={"Content-Type": "application/x-www-form-urlencoded"})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                tok = json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors="replace")[:400]
            hint = ""
            if "invalid_grant" in msg:
                hint = (" -> the refresh token was revoked or expired (an OAuth app left in 'Testing' "
                        "status expires tokens after 7 days - publish it or make it Internal), "
                        "re-run the OAuth Playground step and update GOOGLE_ADS_REFRESH_TOKEN")
            log(f"OAuth token refresh failed: HTTP {e.code} {msg}{hint}")
            sys.exit(1)
        return tok["access_token"], "oauth:" + cid[:12] + "..."
    try:
        info = json.loads(raw)
    except ValueError:
        log("GOOGLE_ADS_SERVICE_ACCOUNT_JSON is not valid JSON - paste the whole key file contents")
        sys.exit(1)
    try:
        from google.auth.transport.requests import Request
        from google.oauth2 import service_account
    except ImportError:
        log("google-auth is not installed - run: pip install google-auth requests")
        sys.exit(1)
    creds = service_account.Credentials.from_service_account_info(info, scopes=[SCOPE])
    creds.refresh(Request())
    return creds.token, info.get("client_email", "?")


# ----------------------------------------------------------------------------
# API
# ----------------------------------------------------------------------------

def norm_cid(cid):
    return re.sub(r"\D", "", cid or "")


class Client:
    def __init__(self, token):
        self.token = token
        self.login_cid = norm_cid(os.environ.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID", ""))
        self.dev_token = os.environ.get("GOOGLE_ADS_DEVELOPER_TOKEN", "").strip()
        self.requests = 0

    def search_stream(self, customer_id, query):
        url = f"{HOST}/{API_VERSION}/customers/{norm_cid(customer_id)}/googleAds:searchStream"
        headers = {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}
        if self.login_cid:
            headers["login-customer-id"] = self.login_cid
        if self.dev_token:
            headers["developer-token"] = self.dev_token
        body = json.dumps({"query": query}).encode()
        for attempt in range(1, 6):
            req = urllib.request.Request(url, data=body, headers=headers, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    self.requests += 1
                    payload = json.loads(resp.read().decode())
                    rows = []
                    for batch in payload if isinstance(payload, list) else [payload]:
                        rows.extend(batch.get("results", []))
                    return rows
            except urllib.error.HTTPError as e:
                text = e.read().decode(errors="replace")
                msg = text[:600]
                try:
                    err = json.loads(text)
                    err = err[0] if isinstance(err, list) else err
                    msg = err.get("error", {}).get("message", msg)
                    details = err.get("error", {}).get("details", [])
                    for d in details:
                        for ge in d.get("errors", []):
                            msg += " | " + json.dumps(ge.get("errorCode", {})) + " " + ge.get("message", "")
                except ValueError:
                    pass
                if e.code in (429, 500, 502, 503, 504) and attempt < 5:
                    wait = 5 * attempt
                    log(f"HTTP {e.code} ({msg[:120]}) - retry in {wait}s")
                    time.sleep(wait)
                    continue
                hint = ""
                if e.code in (401, 403):
                    hint = (" -> check: service account email added as a user of this Google Ads account "
                            "(Admin > Access and security), Google Ads API enabled on the Cloud project, "
                            "access level Explorer or higher, and login-customer-id when the account is "
                            "reached through a manager account")
                elif e.code == 404:
                    hint = " -> check GOOGLE_ADS_CUSTOMER_ID (10 digits) and GOOGLE_ADS_API_VERSION"
                log(f"HTTP {e.code} from Google Ads API: {msg}{hint}")
                sys.exit(1)
            except urllib.error.URLError as e:
                if attempt < 5:
                    log(f"network error {e} - retry")
                    time.sleep(5 * attempt)
                    continue
                raise
        return []


def micros(v):
    try:
        return int(v or 0) / 1_000_000.0
    except (TypeError, ValueError):
        return 0.0


def fnum(v):
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def new_bucket(fields):
    return {f: 0 for f in fields}


def derive(d):
    d["spend"] = round(d["spend"], 2)
    d["conversion_value"] = round(d["conversion_value"], 2)
    if "all_conversion_value" in d:
        d["all_conversion_value"] = round(d["all_conversion_value"], 2)
    d["conversions"] = round(d["conversions"], 2)
    d["roas"] = round(d["conversion_value"] / d["spend"], 2) if d["spend"] else None
    d["cpc"] = round(d["spend"] / d["clicks"], 2) if d["clicks"] else None
    d["cpa"] = round(d["spend"] / d["conversions"], 2) if d["conversions"] else None
    d["ctr"] = round(d["clicks"] / d["impressions"], 4) if d["impressions"] else None
    return d


def sum_range(daily, start, end):
    tot = new_bucket(["spend", "impressions", "clicks", "conversions", "conversion_value"])
    for day, d in daily.items():
        if start <= day <= end:
            for f in tot:
                tot[f] += d.get(f, 0) or 0
    return derive(tot)


def fetch_account(client, cid, since, until):
    """Account info + account-level daily totals (FROM customer, includes every campaign)."""
    info_rows = client.search_stream(cid, "SELECT customer.id, customer.descriptive_name, "
                                          "customer.currency_code, customer.time_zone, customer.manager FROM customer")
    info = (info_rows[0] if info_rows else {}).get("customer", {})
    rows = client.search_stream(cid, f"""
        SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks,
               metrics.conversions, metrics.conversions_value
        FROM customer
        WHERE segments.date BETWEEN '{since}' AND '{until}'
    """)
    daily = {}
    for r in rows:
        day = r.get("segments", {}).get("date")
        m = r.get("metrics", {})
        if not day:
            continue
        d = daily.setdefault(day, new_bucket(["spend", "impressions", "clicks", "conversions", "conversion_value"]))
        d["spend"] += micros(m.get("costMicros"))
        d["impressions"] += int(m.get("impressions") or 0)
        d["clicks"] += int(m.get("clicks") or 0)
        d["conversions"] += fnum(m.get("conversions"))
        d["conversion_value"] += fnum(m.get("conversionsValue"))
    return info, daily, len(rows)


def fetch_campaigns(client, cid, since, until, campaigns):
    rows = client.search_stream(cid, f"""
        SELECT segments.date, campaign.id, campaign.name, campaign.status,
               campaign.advertising_channel_type,
               metrics.cost_micros, metrics.impressions, metrics.clicks,
               metrics.conversions, metrics.conversions_value,
               metrics.all_conversions, metrics.all_conversions_value
        FROM campaign
        WHERE segments.date BETWEEN '{since}' AND '{until}'
          AND metrics.impressions > 0
    """)
    for r in rows:
        c, m, day = r.get("campaign", {}), r.get("metrics", {}), r.get("segments", {}).get("date")
        cid_ = str(c.get("id"))
        if not day or not cid_:
            continue
        entry = campaigns.setdefault(cid_, {"name": c.get("name"), "status": c.get("status"),
                                            "channel": CHANNEL_LABELS.get(c.get("advertisingChannelType"), c.get("advertisingChannelType")),
                                            "account_id": norm_cid(cid), "daily": {}})
        d = entry["daily"].setdefault(day, new_bucket(CAMPAIGN_FIELDS))
        d["spend"] += micros(m.get("costMicros"))
        d["impressions"] += int(m.get("impressions") or 0)
        d["clicks"] += int(m.get("clicks") or 0)
        d["conversions"] += fnum(m.get("conversions"))
        d["conversion_value"] += fnum(m.get("conversionsValue"))
        d["all_conversions"] += fnum(m.get("allConversions"))
        d["all_conversion_value"] += fnum(m.get("allConversionsValue"))
    return len(rows)


def finalise_campaigns(campaigns, since, until, last30):
    products = {}
    for cid_, c in campaigns.items():
        cls = classify_campaign(c["name"])
        c.update(cls)
        for d in c["daily"].values():
            derive(d)
        c["last_30d"] = sum_range(c["daily"], last30, until)
        c["window"] = sum_range(c["daily"], since, until)
        p = products.setdefault(c["product"], {"campaigns": 0, **new_bucket(["spend", "impressions", "clicks", "conversions", "conversion_value"])})
        p["campaigns"] += 1
        for f in ("spend", "impressions", "clicks", "conversions", "conversion_value"):
            p[f] += c["last_30d"][f]
    for p in products.values():
        derive(p)
    return products


def main():
    raw_ids = os.environ.get("GOOGLE_ADS_CUSTOMER_ID", "")
    account_ids = [norm_cid(a) for a in raw_ids.split(",") if norm_cid(a)]
    if not account_ids:
        log("Missing GOOGLE_ADS_CUSTOMER_ID")
        sys.exit(1)
    token, sa_email = get_access_token()
    log(f"Authenticated as service account {sa_email}")
    client = Client(token)

    now = datetime.now(timezone.utc)
    since = (now - timedelta(days=WINDOW_DAYS)).strftime("%Y-%m-%d")
    until = now.strftime("%Y-%m-%d")
    last30 = (now - timedelta(days=30)).strftime("%Y-%m-%d")

    daily, campaigns, warnings, per_account = {}, {}, set(), {}
    currency, rows_total, campaign_rows = None, 0, 0
    for cid in account_ids:
        log(f"Fetching account {cid} {since}..{until} via {API_VERSION}...")
        info, acct_daily, n = fetch_account(client, cid, since, until)
        rows_total += n
        acct_currency = info.get("currencyCode")
        if info.get("manager"):
            warnings.add(f"{cid} is a manager account - list the client account ids in GOOGLE_ADS_CUSTOMER_ID and put the manager id in GOOGLE_ADS_LOGIN_CUSTOMER_ID")
        if currency and acct_currency and acct_currency != currency:
            warnings.add(f"currency mismatch: {cid} is {acct_currency}, earlier account(s) {currency}")
        currency = currency or acct_currency
        for day, d in acct_daily.items():
            tgt = daily.setdefault(day, new_bucket(["spend", "impressions", "clicks", "conversions", "conversion_value"]))
            for f in tgt:
                tgt[f] += d[f]
        for d in acct_daily.values():
            derive(d)
        try:
            campaign_rows += fetch_campaigns(client, cid, since, until, campaigns)
        except SystemExit:
            raise
        except Exception as e:  # noqa: BLE001 - campaign detail must never break the account-level file
            warnings.add(f"campaign-level fetch failed for {cid}: {str(e)[:200]}")
        per_account[cid] = {"name": info.get("descriptiveName"), "currency": acct_currency,
                            "time_zone": info.get("timeZone"), "days": len(acct_daily),
                            "last_30d": sum_range(acct_daily, last30, until)}
    for d in daily.values():
        derive(d)
    if not daily:
        warnings.add("no daily rows returned - account has no spend in the window, or the service account cannot see it")
    products = finalise_campaigns(campaigns, since, until, last30)
    log(f"Campaigns: {len(campaigns)} ({campaign_rows} daily rows), products: {sorted(products)}")

    out = {
        "source": "google_ads_api",
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "customer_ids": account_ids,
        "api_version": API_VERSION,
        "currency": currency or "USD",
        "window_days": WINDOW_DAYS,
        "daily": daily,
        "totals": {
            "today": sum_range(daily, until, until),
            "mtd": sum_range(daily, now.strftime("%Y-%m-01"), until),
            "last_30d": sum_range(daily, last30, until),
        },
        "campaigns": campaigns,
        "products": products,
        "meta": {
            "schema": SCHEMA,
            "script_version": SCRIPT_VERSION,
            "auth": "service_account" if os.environ.get("GOOGLE_ADS_SERVICE_ACCOUNT_JSON", "").strip() else "oauth_refresh_token",
            "api_requests": client.requests,
            "rows_processed": rows_total,
            "campaign_rows": campaign_rows,
            "accounts": per_account,
            "warnings": sorted(warnings),
        },
    }
    os.makedirs(os.path.dirname(OUTPUT_PATH) or ".", exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(out, f, indent=2, sort_keys=True)
    log(f"Wrote {OUTPUT_PATH}: {len(daily)} days, spend last 30d {out['totals']['last_30d']['spend']} {out['currency']}, "
        f"{len(campaigns)} campaigns, {client.requests} API requests, {len(warnings)} warning types.")


if __name__ == "__main__":
    main()
