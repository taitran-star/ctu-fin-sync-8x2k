#!/usr/bin/env python3
"""
Cattasaurus - Amazon Ads spend from the Sellerboard "Dashboard by day" automation export -> data/amazon_ads.json

Bridge until Amazon approves the Advertising API: Sellerboard (which pulls the Ads API itself) exports its
"Dashboard by day" report every day to a private link (Settings > Automation > Delivery: Link).  This script
downloads that CSV and merges the per-day ad spend into data/amazon_ads.json (schema 2, same file the dashboard
already reads), keeping every other field of a day that it does not know about (console-matching ad sales,
orders, clicks, impressions pulled from Sellerboard's PPC dashboard by Claude's browser).

Env: SELLERBOARD_DASHBOARD_URL (required, secret - the export link carries a personal token, never log it),
     SELLERBOARD_PPC_URL (optional: the "Advertising Performance Report" link - a monthly summary, stored as info),
     OUTPUT_PATH (data/amazon_ads.json), REPORT_TIMEZONE (label only), DASHBOARD_CSV (local file instead of the URL, for tests).

Column mapping (Sellerboard CSV, USD, costs are NEGATIVE in the export):
  SponsoredProducts        -> sp   (Sponsored Products cost)
  SponsoredBrands + SponsoredBrandsVideo -> sb  (console "Sponsored Brands" includes video)
  SponsoredDisplay         -> sd
  spend = ads_spend_console = sp + sb + sd  (= "Total cost" in the Amazon Ads console; no Sponsored TV line in this export)
  SalesPPC / UnitsPPC      -> sales_ppc_sb / units_ppc_sb (Sellerboard's own attribution - NOT the console number, kept for reference)
  SalesOrganic + SalesPPC  -> amazon_sales_day ; Real ACOS -> acos_sellerboard (TACOS in %) ; Sessions -> sessions
"""
import csv
import io
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone

OUTPUT_PATH = os.environ.get("OUTPUT_PATH", "data/amazon_ads.json")
DASH_URL = os.environ.get("SELLERBOARD_DASHBOARD_URL", "").strip()
PPC_URL = os.environ.get("SELLERBOARD_PPC_URL", "").strip()
DASH_CSV = os.environ.get("DASHBOARD_CSV", "").strip()
PPC_CSV = os.environ.get("PPC_CSV", "").strip()
SCRIPT_VERSION = "sb-3.0"
SPEND_FIELDS = ("sp", "sb", "sd", "stv", "spend", "ads_spend_console")


def log(msg):
    print(f"[sellerboard_ads] {msg}", flush=True)


def download(url, label):
    req = urllib.request.Request(url, headers={"User-Agent": "cattasaurus-sellerboard-sync"})
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
    log(f"{label}: downloaded {len(raw):,} bytes")
    return raw.decode("utf-8-sig", errors="replace")


def num(v):
    s = str(v or "").replace(" ", "").replace(" ", "").replace(",", "")
    try:
        return float(s)
    except ValueError:
        return 0.0


def parse_date(s):
    s = (s or "").strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def parse_dashboard(text):
    """-> {iso: {sp, sb, sd, ...}} from the Dashboard-by-day CSV (comma separated, header row)."""
    sample = text[:2000]
    delim = ";" if sample.count(";") > sample.count(",") else ","
    rows = list(csv.DictReader(io.StringIO(text), delimiter=delim))
    out = {}
    for r in rows:
        r = {(k or "").strip(): v for k, v in r.items()}
        iso = parse_date(r.get("Date"))
        if not iso:
            continue
        sp = -num(r.get("SponsoredProducts"))
        sb = -num(r.get("SponsoredBrands")) - num(r.get("SponsoredBrandsVideo"))
        sd = -num(r.get("SponsoredDisplay"))
        stv = -num(r.get("SponsoredTelevision")) - num(r.get("SponsoredTV"))
        spend = round(sp + sb + sd, 2)
        out[iso] = {
            "sp": round(sp, 2), "sb": round(sb, 2), "sd": round(sd, 2), "stv": round(stv, 2),
            "spend": spend, "ads_spend_console": spend,
            "sales_ppc_sb": round(num(r.get("SalesPPC")), 2), "units_ppc_sb": int(round(num(r.get("UnitsPPC")))),
            "amazon_sales_day": round(num(r.get("SalesOrganic")) + num(r.get("SalesPPC")), 2),
            "acos_sellerboard": round(num(r.get("Real ACOS")), 2),
            "sessions": int(round(num(r.get("Sessions")))),
            "spend_src": "sellerboard_automation",
        }
    return out


def parse_ppc_summary(text):
    """Advertising Performance Report = one row per month (this year vs last year): keep it as info only."""
    delim = ";" if text[:500].count(";") > text[:500].count(",") else ","
    rows = list(csv.reader(io.StringIO(text), delimiter=delim))
    if not rows:
        return {}
    header = [h.strip() for h in rows[0]]
    out = {}
    for r in rows[1:]:
        if len(r) < 3 or not (r[1] or "").strip():
            continue
        rec = {header[i]: (r[i].strip() if i < len(r) else "") for i in range(len(header)) if header[i]}
        label = r[1].strip()
        try:
            mk = datetime.strptime(label, "%B %Y").strftime("%Y-%m")
        except ValueError:
            mk = label
        out[mk] = {k: (num(v) if re.match(r"^[\d\s.,-]+$", v or "") and v.strip() else v) for k, v in rec.items() if k}
    return out


def main():
    if not (DASH_URL or DASH_CSV):
        log("SELLERBOARD_DASHBOARD_URL missing"); sys.exit(2)
    text = open(DASH_CSV, encoding="utf-8-sig").read() if DASH_CSV else download(DASH_URL, "dashboard")
    fetched = parse_dashboard(text)
    if not fetched:
        log("dashboard CSV parsed to 0 days - leaving the file untouched"); sys.exit(1)

    prev = {}
    if os.path.exists(OUTPUT_PATH):
        try:
            prev = json.load(open(OUTPUT_PATH, encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            log(f"previous file unreadable ({e}) - starting fresh")
    daily = dict(prev.get("daily") or {})
    updated = new = 0
    today = datetime.now(timezone.utc).date().isoformat()
    for iso, f in fetched.items():
        if iso > today:
            continue
        row = daily.get(iso)
        if row is None:
            daily[iso] = f; new += 1
            continue
        # spend from the automation is authoritative; console-matching sales/clicks/impressions from the PPC dashboard pull stay
        changed = any(abs((row.get(k) or 0) - f[k]) > 0.005 for k in SPEND_FIELDS)
        row.update({k: f[k] for k in f})
        cs = f["ads_spend_console"]
        pv = row.get("purchase_value")
        if pv is not None:
            row["acos"] = round(cs / pv, 4) if pv else 0
            row["roas"] = round(pv / cs, 4) if cs else 0
        if row.get("clicks"):
            row["cpc"] = round(cs / row["clicks"], 4)
        if row.get("purchases"):
            row["cpa"] = round(cs / row["purchases"], 2)
        updated += 1 if changed else 0
    days = sorted(daily)
    ppc_summary = dict((prev.get("meta") or {}).get("ppc_summary") or {})
    if PPC_URL or PPC_CSV:
        try:
            ptxt = open(PPC_CSV, encoding="utf-8-sig").read() if PPC_CSV else download(PPC_URL, "ppc summary")
            ppc_summary.update(parse_ppc_summary(ptxt))
        except Exception as e:  # noqa: BLE001
            log(f"ppc summary skipped: {e}")

    fetched_days = sorted(fetched)
    with_sales = sum(1 for k in daily if daily[k].get("purchase_value") is not None)
    out = dict(prev)
    out.update({
        "source": "sellerboard",
        "schema": 2,
        "script_version": SCRIPT_VERSION,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "daily": {k: daily[k] for k in days},
        "coverage": {"first_day": days[0], "last_day": days[-1], "days": len(days)},
    })
    meta = dict(prev.get("meta") or {})
    meta.update({
        "note": ("Chi phí Amazon Ads theo ngày (sp / sb gồm video / sd; ads_spend_console = SP+SB+SD = 'Total cost' trong Ads console) từ export tự động "
                 "'Dashboard by day' của Sellerboard (Delivery: Link), tải mỗi giờ; 30 ngày gần nhất được làm mới mỗi lần. purchase_value / purchases / "
                 "clicks / impressions (khớp console) do Claude kéo từ PPC Dashboard của Sellerboard theo đợt - ngày chưa có thì ROAS/ACOS để trống. "
                 "sales_ppc_sb / units_ppc_sb = attribution riêng của Sellerboard (khác console, chỉ tham khảo). Thay bằng Amazon Ads API khi được duyệt."),
        "extracted_at": out["generated_at"],
        "automation": {"fetched_first_day": fetched_days[0], "fetched_last_day": fetched_days[-1], "fetched_days": len(fetched_days),
                       "updated_days": updated, "new_days": new, "days_with_console_sales": with_sales},
        "ppc_summary": ppc_summary,
    })
    out["meta"] = meta
    os.makedirs(os.path.dirname(OUTPUT_PATH) or ".", exist_ok=True)
    json.dump(out, open(OUTPUT_PATH, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    log(f"Wrote {OUTPUT_PATH}: {len(days)} days ({days[0]} -> {days[-1]}), automation {fetched_days[0]} -> {fetched_days[-1]} "
        f"({len(fetched_days)} days: {new} new, {updated} spend changed), console sales on {with_sales} days, ppc summary months {sorted(ppc_summary)}")


if __name__ == "__main__":
    main()
