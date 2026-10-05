#!/usr/bin/env python3
"""
Cattasaurus - AppLovin (Axon) advertiser spend sync (v1.0) -> data/applovin.json (schema 1)

Nguon: AppLovin Reporting API  GET https://r.applovin.com/report  (api_key = "Report Key", report_type=advertiser)
  * API chi cho lay trong 45 NGAY GAN NHAT va bao cao theo UTC -> moi lan chay lay lai ~44 ngay va GHI DE cac ngay do;
    ngay cu hon giu nguyen tu file cu. Lich su truoc do: dat file export tu dashboard AppLovin vao data/applovin_history.csv
    (cot: day|date, impressions, cost|spend, clicks|cpc, conversions|"D0 checkouts", sales|"D7 checkout rev"; ten cot khong phan biet hoa thuong; ngay trong export la UTC) -> nap 1 lan cho cac ngay chua co.
  * Co gang lay them cot `hour` de doi ngay UTC -> ngay America/Los_Angeles (chuan P&L); neu API khong tra `hour` thi dung ngay UTC va ghi
    meta.time_basis = "utc_day".
Env: APPLOVIN_REPORT_KEY (GitHub Secret, KHONG dua vao chat), REPORT_TIMEZONE, WINDOW_DAYS (default 44, toi da 44), DATA_FILE, HISTORY_CSV.
"""
import collections, csv, json, os, re, sys, time
import urllib.error, urllib.parse, urllib.request
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

SCRIPT_VERSION = "applovin-1.0"
SCHEMA = 1
BASE = "https://r.applovin.com/report"
KEY = os.environ.get("APPLOVIN_REPORT_KEY", "").strip()
TZ = ZoneInfo(os.environ.get("REPORT_TIMEZONE", "America/Los_Angeles").strip() or "America/Los_Angeles")
DATA_FILE = os.environ.get("DATA_FILE", "data/applovin.json")
HISTORY_CSV = os.environ.get("HISTORY_CSV", "data/applovin_history.csv")
WINDOW_DAYS = min(44, int(re.sub(r"\D", "", os.environ.get("WINDOW_DAYS", "") or "") or 44))
METRICS = ["impressions", "clicks", "conversions", "cost", "sales"]


def log(m): print(f"[applovin] {m}", flush=True)


def num(v):
    try: return float(str(v).replace(",", "").replace("$", "").strip() or 0)
    except (TypeError, ValueError): return 0.0


def r2(x): return round(x + 0.0, 2)


def api(columns, start, end):
    q = urllib.parse.urlencode({"api_key": KEY, "start": start.isoformat(), "end": end.isoformat(), "format": "json",
                                "report_type": "advertiser", "columns": ",".join(columns)})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(f"{BASE}?{q}", headers={"Accept": "application/json"}), timeout=120) as r:
                body = json.loads(r.read().decode("utf-8"))
            rows = body.get("results") if isinstance(body, dict) else body
            if rows is None and isinstance(body, dict): return -2, f"unexpected JSON keys {sorted(body.keys())[:8]}"
            return 200, rows or []
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", errors="replace")[:200].replace(KEY, "***")
            if e.code in (429, 500, 502, 503, 504) and attempt < 2: time.sleep(5 * (attempt + 1)); continue
            return e.code, msg
        except Exception as e:  # noqa: BLE001
            if attempt < 2: time.sleep(4); continue
            return -1, str(e)[:200].replace(KEY, "***")
    return -1, "retries exhausted"


def parse_hour(day, hour):
    """-> aware UTC datetime or None. `hour` may be 0-23, 'HH:00', or a full timestamp."""
    h = str(hour).strip()
    try:
        if re.fullmatch(r"\d{1,2}", h): return datetime.strptime(day, "%Y-%m-%d").replace(hour=int(h), tzinfo=timezone.utc)
        m = re.fullmatch(r"(\d{1,2}):\d{2}(:\d{2})?", h)
        if m: return datetime.strptime(day, "%Y-%m-%d").replace(hour=int(m.group(1)), tzinfo=timezone.utc)
        m = re.match(r"(\d{4}-\d{2}-\d{2})[ T](\d{2})", h)
        if m: return datetime.strptime(m.group(1), "%Y-%m-%d").replace(hour=int(m.group(2)), tzinfo=timezone.utc)
    except ValueError:
        return None
    return None


def la_day(day, hour):
    d = parse_hour(day, hour)
    return d.astimezone(TZ).date().isoformat() if d else None


def fetch_window(start, end):
    """Try day+hour first (-> LA days). Fallback day only (UTC days). Returns (rows, basis, info)."""
    info = {"requests": 0, "errors": []}
    for cols, basis in ((["day", "hour", "campaign"] + METRICS, "hour_to_la"), (["day", "campaign"] + METRICS, "utc_day")):
        rows_all, ok = [], True
        cur = start
        while cur <= end:
            nxt = min(cur + timedelta(days=14), end)       # 15-day slices keep hourly responses small
            st, rows = api(cols, cur, nxt); info["requests"] += 1
            if st != 200:
                info["errors"].append(f"{basis} {cur}..{nxt}: HTTP {st} {rows}"); ok = False; break
            rows_all += rows; cur = nxt + timedelta(days=1); time.sleep(0.5)
        if ok and basis == "hour_to_la" and rows_all and not all("hour" in r for r in rows_all[:50]):
            info["errors"].append("hour column missing in response -> using UTC days"); ok = False
        if ok: return rows_all, basis, info
    return None, None, info


def bucket(rows, basis):
    daily = collections.defaultdict(lambda: {"spend": 0.0, "impressions": 0, "clicks": 0, "conversions": 0.0, "sales": 0.0})
    camp = collections.defaultdict(lambda: collections.defaultdict(float))
    for r in rows:
        day = str(r.get("day") or "")[:10]
        if basis == "hour_to_la":
            day = la_day(day, r.get("hour")) or day
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day): continue
        d = daily[day]
        d["spend"] += num(r.get("cost")); d["impressions"] += int(num(r.get("impressions"))); d["clicks"] += int(num(r.get("clicks")))
        d["conversions"] += num(r.get("conversions")); d["sales"] += num(r.get("sales"))
        camp[day][str(r.get("campaign") or "?")] += num(r.get("cost"))
    return daily, camp


def read_history_csv(path):
    out = {}
    if not os.path.exists(path): return out, 0
    with open(path, encoding="utf-8-sig", newline="") as f:
        rd = csv.DictReader(f)
        cols = {c.strip().lower(): c for c in (rd.fieldnames or [])}
        n = 0
        for row in rd:
            g = lambda k: row.get(cols[k], "") if k in cols else ""
            day = str(g("day") or g("date"))[:10]
            m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", day)
            if m: day = f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day): continue
            d = out.setdefault(day, {"spend": 0.0, "impressions": 0, "clicks": 0, "conversions": 0.0, "sales": 0.0})
            cost = num(g("cost") or g("spend"))
            clicks = num(g("clicks")) or ((cost / num(g("cpc"))) if num(g("cpc")) > 0 else 0)   # dashboard export has CPC, not clicks
            d["spend"] += cost; d["impressions"] += int(num(g("impressions"))); d["clicks"] += int(round(clicks))
            d["conversions"] += num(g("conversions") or g("d0 checkouts")); d["sales"] += num(g("sales") or g("d7 checkout rev")); n += 1
    return out, n


def main():
    if not KEY:
        log("APPLOVIN_REPORT_KEY empty - skipping"); print("::notice::APPLOVIN_REPORT_KEY secret is not set"); return
    try:
        with open(DATA_FILE, encoding="utf-8") as f: old = json.load(f)
    except (OSError, ValueError):
        old = {}
    daily_old = old.get("daily") or {}
    camps_old = old.get("campaign_daily") or {}
    today_utc = datetime.now(timezone.utc).date()
    start, end = today_utc - timedelta(days=WINDOW_DAYS), today_utc
    rows, basis, info = fetch_window(start, end)
    log(f"window {start} -> {end}: requests={info['requests']} errors={info['errors']}")
    if rows is None:
        log("API failed - not overwriting existing data"); sys.exit(1)
    if not rows: basis = "no_rows"   # nothing delivered in the window (campaigns paused) -> time basis not observable
    log(f"rows={len(rows)} basis={basis} columns_in_first_row={sorted(rows[0].keys()) if rows else []}")
    daily, camp = bucket(rows, basis)
    # one-off history import (days the API can no longer return)
    hist, hn = read_history_csv(HISTORY_CSV)
    window_first = min(daily) if daily else start.isoformat()
    out_daily, out_camp = {}, {}
    for day, v in sorted(hist.items()):
        if day < window_first and day not in daily_old: out_daily[day] = {**{k: (r2(x) if isinstance(x, float) else x) for k, x in v.items()}, "src": "csv"}
    for day, v in sorted(daily_old.items()):
        if day < window_first: out_daily[day] = v; out_camp[day] = camps_old.get(day, {})
    for day, v in sorted(daily.items()):
        out_daily[day] = {**{k: (r2(x) if isinstance(x, float) else x) for k, x in v.items()}, "src": "api"}
        out_camp[day] = {c: r2(s) for c, s in camp[day].items() if s}
    # AppLovin reports list only days with delivery -> every missing day between the first day and today is a real $0 day
    if out_daily:
        cur, last = datetime.strptime(min(out_daily), "%Y-%m-%d").date(), today_utc
        while cur <= last:
            out_daily.setdefault(cur.isoformat(), {"spend": 0.0, "impressions": 0, "clicks": 0, "conversions": 0.0, "sales": 0.0, "src": "gap0"})
            cur += timedelta(days=1)
    days_sorted = sorted(out_daily)
    out = {"schema": SCHEMA, "script_version": SCRIPT_VERSION, "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "timezone": str(TZ), "currency": "USD", "daily": out_daily, "campaign_daily": out_camp,
           "coverage": {"first_day": days_sorted[0] if days_sorted else None, "last_day": days_sorted[-1] if days_sorted else None,
                        "api_window": [start.isoformat(), end.isoformat()], "days": len(days_sorted)},
           "meta": {"time_basis": basis, "api_rows": len(rows), "api_requests": info["requests"], "api_errors": info["errors"],
                    "history_csv_rows": hn, "columns_seen": sorted(rows[0].keys()) if rows else [],
                    "note": "API window is 45 days; older days come from data/applovin_history.csv (dashboard export). 'sales' = AppLovin-attributed revenue."}}
    os.makedirs(os.path.dirname(DATA_FILE) or ".", exist_ok=True)
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f: json.dump(out, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    os.replace(tmp, DATA_FILE)
    tot = sum(v["spend"] for v in daily.values())
    log(f"wrote {DATA_FILE}: {len(days_sorted)} days ({out['coverage']['first_day']} -> {out['coverage']['last_day']}), API window spend ${tot:,.2f}, basis={basis}")
    for day in sorted(daily)[-5:]:
        v = daily[day]; log(f"  {day}: spend ${v['spend']:.2f} impr {v['impressions']} clicks {v['clicks']} conv {v['conversions']:.0f} sales ${v['sales']:.2f}")


if __name__ == "__main__":
    main()
