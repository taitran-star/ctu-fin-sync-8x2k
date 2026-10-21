#!/usr/bin/env python3
"""Cattasaurus - Re:amaze helpdesk sync for the Customer service page.

Reads the Re:amaze reports + conversations with the API token and writes data/reamaze.json.
Nothing personal is written: no customer names, e-mails, phone numbers or message text - only daily counts,
response times, tag usage, satisfaction scores, a backlog snapshot and the conversations classified into
reason buckets (the classification happens here, the text is thrown away). Staff appear by first name only.

Env (GitHub Secrets):
  REAMAZE_LOGIN   the e-mail of a Re:amaze staff user with "access reports" permission
  REAMAZE_TOKEN   that user's API token (Re:amaze > Settings > Developer > API Token)
  REAMAZE_BRAND   brand slug, e.g. shoproxstore  (API host https://<brand>.reamaze.io/api/v1)
  REPORT_TIMEZONE default America/Los_Angeles (the P&L calendar)
  WINDOW_DAYS     days of conversations to (re)classify each run, default 35 (history is kept across runs)
  OUTPUT_PATH     default data/reamaze.json
"""
import base64
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

SCRIPT_VERSION = "1.0"
LOGIN = os.environ.get("REAMAZE_LOGIN", "").strip()
TOKEN = os.environ.get("REAMAZE_TOKEN", "").strip()
BRAND = os.environ.get("REAMAZE_BRAND", "").strip().lower()
REPORT_TIMEZONE = os.environ.get("REPORT_TIMEZONE", "America/Los_Angeles")
WINDOW_DAYS = int(os.environ.get("WINDOW_DAYS", "35"))
OUTPUT_PATH = os.environ.get("OUTPUT_PATH", "data/reamaze.json")
HISTORY_DAYS = 400          # daily history kept in the file
PAGE_SLEEP = 0.35           # polite pacing between API pages
MAX_PAGES = 400             # safety cap per listing

# Reason buckets - keyword rules on subject + first customer message (English + a little Spanish/French).
# Order matters: the first bucket that matches wins. Tags set by the team win over keywords (see TAG_TO_REASON).
REASON_RULES = [
    ("wismo",        r"where is my (order|package|item)|wismo|track(ing)?\b|shipped|shipping (update|status|time)|when (will|does|is).*(arrive|ship|deliver|get here)|delivery|delivered|has(n't| not) (arrived|shipped|come)|not (received|arrived)|still waiting|eta\b|in transit|label created|usps|ups\b|fedex|dhl"),
    ("damaged",      r"damaged|broken|defect|crack|rip(ped)?\b|tear|torn|not working|stopped working|doesn'?t work|leak|faulty|fell apart|came apart|smell|mold|quality"),
    ("wrong_missing",r"wrong (item|size|color|colour|product|order)|missing (item|part|piece|cover|pump|filter)|incomplete|received the wrong|only received|didn'?t receive all|not what i ordered|different (item|color|colour)"),
    ("return_refund",r"return|refund|money back|exchange|send (it )?back|chargeback|dispute|reimburs"),
    ("cancel_change",r"cancel|change (my )?(order|address|size|color|colour)|update (my )?(address|order)|modify|wrong address|edit my order|add (an )?item"),
    ("discount",     r"discount|coupon|promo|code (did|does|is)n'?t|sale price|price match|bogo|free gift|gift card|giveaway|winner|prize|contest"),
    ("subscription", r"subscription|subscribe|auto[- ]?ship|recurring|next shipment|skip (my|a) (order|shipment)|pause"),
    ("product_q",    r"size|fit|dimension|measure|material|wash|clean|how (do|to|big|large|small)|does it|will it|is it|which (one|size|color)|recommend|difference between|compatible|instructions|assembly|assemble|heating|warm|battery|charge"),
    ("wholesale_biz",r"wholesale|bulk order|partnership|collab|influencer|affiliate|sponsor|ambassador|media kit|business inquiry|vendor|supplier"),
    ("review",       r"review|rating|feedback|testimonial|love (it|them|the)|thank you so much|amazing|adorable"),
]
TAG_TO_REASON = {   # lower-cased Re:amaze tag -> bucket; extend when the team tags conversations
    "wismo": "wismo", "shipping": "wismo", "tracking": "wismo", "delivery": "wismo", "lost package": "wismo", "lost": "wismo",
    "damaged": "damaged", "defective": "damaged", "quality": "damaged", "broken": "damaged",
    "wrong item": "wrong_missing", "missing item": "wrong_missing", "missing": "wrong_missing", "wrong": "wrong_missing",
    "return": "return_refund", "refund": "return_refund", "exchange": "return_refund", "chargeback": "return_refund",
    "cancel": "cancel_change", "cancellation": "cancel_change", "address change": "cancel_change", "order change": "cancel_change",
    "discount": "discount", "promo": "discount", "coupon": "discount", "giveaway": "discount",
    "subscription": "subscription", "loop": "subscription",
    "product question": "product_q", "pre-sale": "product_q", "presale": "product_q", "question": "product_q",
    "wholesale": "wholesale_biz", "partnership": "wholesale_biz", "influencer": "wholesale_biz", "collab": "wholesale_biz",
    "review": "review", "feedback": "review",
    "spam": "spam",
}
REASON_LABELS = {
    "wismo": "Where is my order (shipping / tracking)", "damaged": "Damaged / defective product",
    "wrong_missing": "Wrong or missing item", "return_refund": "Return / refund / exchange",
    "cancel_change": "Cancel or change order", "discount": "Discounts, promos, giveaways",
    "subscription": "Subscription", "product_q": "Product question (pre- / post-sale)",
    "wholesale_biz": "Wholesale / partnership / influencer", "review": "Praise / review / feedback",
    "spam": "Spam", "other": "Other",
}
RULES = [(k, re.compile(p, re.I)) for k, p in REASON_RULES]


def log(msg):
    print(f"[reamaze] {msg}", flush=True)


def api_get(path, params=None):
    if not BRAND:
        raise SystemExit("REAMAZE_BRAND is empty")
    url = f"https://{BRAND}.reamaze.io/api/v1/{path.lstrip('/')}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    auth = base64.b64encode(f"{LOGIN}:{TOKEN}".encode()).decode()
    for attempt in range(5):
        req = urllib.request.Request(url, headers={"Authorization": "Basic " + auth, "Accept": "application/json",
                                                   "User-Agent": "cattasaurus-cs/" + SCRIPT_VERSION})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise SystemExit(f"Re:amaze answered HTTP {e.code} on {path} - check REAMAZE_LOGIN / REAMAZE_TOKEN and the user's 'access reports' permission")
            if e.code == 404:
                raise SystemExit(f"Re:amaze answered 404 on {url.split('?')[0]} - is REAMAZE_BRAND the brand slug (the part before .reamaze.com)?")
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(min(60, 3 * (attempt + 1) ** 2))
                continue
            raise
        except urllib.error.URLError:
            time.sleep(min(60, 3 * (attempt + 1) ** 2))
    raise SystemExit(f"Re:amaze unreachable: {path}")


def first_name(name):
    name = (name or "").strip()
    return name.split()[0][:20] if name else "Staff"


def to_local_day(iso, tz):
    """Re:amaze timestamps are ISO 8601 (UTC or with offset) -> YYYY-MM-DD in the P&L timezone."""
    if not iso:
        return None
    try:
        s = iso.replace("Z", "+00:00")
        d = datetime.fromisoformat(s)
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d.astimezone(tz).strftime("%Y-%m-%d")
    except ValueError:
        return iso[:10]


def classify(subject, body, tags):
    for t in tags or []:
        k = TAG_TO_REASON.get(str(t).strip().lower())
        if k:
            return k, "tag"
    text = f"{subject or ''}\n{body or ''}"
    text = re.sub(r"<[^>]+>", " ", text)[:1500]
    for k, rx in RULES:
        if rx.search(text):
            return k, "keyword"
    return "other", "none"


def list_conversations(params):
    """Yield conversations page by page (the API pages at 30)."""
    page = 1
    while page <= MAX_PAGES:
        r = api_get("conversations", {**params, "page": page})
        convs = r.get("conversations") or []
        for c in convs:
            yield c
        page_count = int(r.get("page_count") or 1)
        if page >= page_count or not convs:
            break
        page += 1
        time.sleep(PAGE_SLEEP)


def previous_file():
    try:
        with open(OUTPUT_PATH) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def main():
    if not (LOGIN and TOKEN and BRAND):
        print("::notice::REAMAZE_LOGIN / REAMAZE_TOKEN / REAMAZE_BRAND not set - nothing to do.")
        return 0
    tz = ZoneInfo(REPORT_TIMEZONE) if ZoneInfo else timezone.utc
    now = datetime.now(timezone.utc)
    today = now.astimezone(tz).strftime("%Y-%m-%d")
    prev = previous_file()

    # ---- 1. daily reports (volume + response time), one year back on the first run, 100 days afterwards ----
    span = 365 if not prev.get("daily") else 100
    start = (now - timedelta(days=span)).strftime("%Y-%m-%d")
    vol = api_get("reports/volume", {"brand": BRAND, "start_date": start, "end_date": today})
    rt = api_get("reports/response_time", {"brand": BRAND, "start_date": start, "end_date": today})
    daily = dict(prev.get("daily") or {})
    for d, n in (vol.get("conversation_counts") or {}).items():
        daily.setdefault(d, {})["new"] = int(n or 0)
    for d, s in (rt.get("response_times") or {}).items():
        daily.setdefault(d, {})["response_time_s"] = round(float(s or 0), 1)
    log(f"volume {len(vol.get('conversation_counts') or {})} days, response time {len(rt.get('response_times') or {})} days")

    # ---- 2. staff / channel / tag reports for 30 and 90 days ----
    def rep(path, days):
        return api_get(path, {"brand": BRAND, "start_date": (now - timedelta(days=days)).strftime("%Y-%m-%d"), "end_date": today})
    staff30 = rep("reports/staff", 30).get("report") or {}
    staff90 = rep("reports/staff", 90).get("report") or {}
    staff = []
    for name, s in staff90.items():
        s30 = staff30.get(name) or {}
        staff.append({"name": first_name(name), "responses_90d": int(s.get("response_count") or 0),
                      "response_time_s_90d": round(float(s.get("response_time_seconds") or 0), 1),
                      "appreciations_90d": int(s.get("appreciations_count") or 0),
                      "responses_30d": int(s30.get("response_count") or 0),
                      "response_time_s_30d": round(float(s30.get("response_time_seconds") or 0), 1),
                      "appreciations_30d": int(s30.get("appreciations_count") or 0),
                      "trend": {d: int(v or 0) for d, v in (s.get("responses_trend") or {}).items()}})
    staff.sort(key=lambda x: -x["responses_90d"])
    ch30 = rep("reports/channel_summary", 30).get("channels") or {}
    channels = []
    for cid, c in ch30.items():
        info = c.get("channel") or {}
        channels.append({"name": info.get("name") or str(cid), "type": info.get("channel_type_name") or info.get("channel_type"),
                         "active": int(c.get("active_conversations") or 0), "resolved": int(c.get("resolved_conversations") or 0),
                         "archived": int(c.get("archived_conversations") or 0), "staff_responses": int(c.get("staff_responses") or 0),
                         "customer_responses": int(c.get("customer_responses") or 0),
                         "avg_response_s": round(float(c.get("average_response_time_seconds") or 0), 1),
                         "appreciations": int(c.get("appreciations") or 0),
                         "avg_satisfaction": (round(float(c["average_satisfaction_rating"]), 2) if c.get("average_satisfaction_rating") not in (None, "") else None),
                         "avg_thread_size": round(float(c.get("average_thread_size") or 0), 2)})
    channels.sort(key=lambda x: -(x["active"] + x["resolved"] + x["archived"]))
    tags30 = {k: int(v or 0) for k, v in (rep("reports/tags", 30).get("tags") or {}).items()}
    tags90 = {k: int(v or 0) for k, v in (rep("reports/tags", 90).get("tags") or {}).items()}
    log(f"staff {len(staff)}, channels {len(channels)}, tags30 {len(tags30)}")

    # ---- 3. satisfaction ratings (last 120 days) -> counts per day per score, no comments ----
    sat_days = dict(prev.get("satisfaction_daily") or {})
    page, got = 1, 0
    since = (now - timedelta(days=120)).strftime("%Y-%m-%dT00:00:00Z")
    fresh = {}
    while page <= 60:
        r = api_get("satisfaction_ratings", {"brand": BRAND, "created_after": since, "page": page})
        items = r.get("satisfaction_ratings") or r.get("ratings") or []
        for it in items:
            d = to_local_day(it.get("created_at"), tz)
            if not d:
                continue
            score = it.get("rating")
            key = str(int(score)) if score not in (None, "") else "unrated"
            fresh.setdefault(d, {}).setdefault(key, 0)
            fresh[d][key] += 1
            got += 1
        if page >= int(r.get("page_count") or 1) or not items:
            break
        page += 1
        time.sleep(PAGE_SLEEP)
    sat_days.update(fresh)   # days inside the 120-day window are replaced by the fresh counts
    log(f"satisfaction ratings read {got}")

    # ---- 4. conversations of the last WINDOW_DAYS days -> reasons per day (classified here, text discarded) ----
    reasons = dict(prev.get("reasons") or {})
    keep_from = (now - timedelta(days=WINDOW_DAYS)).strftime("%Y-%m-%d")
    for d in list(reasons):
        if d >= keep_from:
            reasons.pop(d)
    n_conv, n_tagged = 0, 0
    origins = {}
    for c in list_conversations({"brand": BRAND, "filter": "all", "start_date": keep_from + "T00:00:00Z", "end_date": today + "T23:59:59Z"}):
        created = to_local_day(c.get("created_at"), tz)
        if not created or created < keep_from:
            continue
        msg = c.get("message") or {}
        body = msg.get("body") if isinstance(msg, dict) else ""
        k, how = classify(c.get("subject"), body, c.get("tag_list") or [])
        day = reasons.setdefault(created, {})
        day[k] = day.get(k, 0) + 1
        if how == "tag":
            n_tagged += 1
        cat = c.get("category") or {}
        ch = (cat.get("channel") if isinstance(cat, dict) else None) or "other"
        origins[str(ch)] = origins.get(str(ch), 0) + 1
        n_conv += 1
    log(f"conversations classified {n_conv} ({n_tagged} by tag) since {keep_from}")

    # ---- 5. backlog snapshot (open / unassigned conversations and their age) ----
    backlog = {"open": 0, "unassigned": 0, "on_hold": 0, "ages": {"lt_8h": 0, "h8_24": 0, "d1_3": 0, "gt_3d": 0}, "oldest_hours": 0, "by_reason": {}}
    for c in list_conversations({"brand": BRAND, "filter": "open"}):
        st = c.get("status")
        if st == 5:
            backlog["on_hold"] += 1
        backlog["open"] += 1
        if not c.get("assignee"):
            backlog["unassigned"] += 1
        lc = (c.get("last_customer_message") or {}).get("created_at") or c.get("created_at")
        try:
            t0 = datetime.fromisoformat(str(lc).replace("Z", "+00:00"))
            if t0.tzinfo is None:
                t0 = t0.replace(tzinfo=timezone.utc)
            hrs = max(0.0, (now - t0).total_seconds() / 3600)
        except ValueError:
            hrs = 0.0
        backlog["oldest_hours"] = max(backlog["oldest_hours"], round(hrs, 1))
        bucket = "lt_8h" if hrs < 8 else "h8_24" if hrs < 24 else "d1_3" if hrs < 72 else "gt_3d"
        backlog["ages"][bucket] += 1
        msg = c.get("message") or {}
        k, _ = classify(c.get("subject"), msg.get("body") if isinstance(msg, dict) else "", c.get("tag_list") or [])
        backlog["by_reason"][k] = backlog["by_reason"].get(k, 0) + 1
    log(f"backlog open {backlog['open']} (unassigned {backlog['unassigned']}, oldest {backlog['oldest_hours']} h)")

    # ---- 6. trim history and write ----
    cutoff = (now - timedelta(days=HISTORY_DAYS)).strftime("%Y-%m-%d")
    daily = {d: v for d, v in daily.items() if d >= cutoff}
    reasons = {d: v for d, v in reasons.items() if d >= cutoff}
    sat_days = {d: v for d, v in sat_days.items() if d >= cutoff}
    out = {
        "source": "reamaze", "script_version": SCRIPT_VERSION, "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "timezone": REPORT_TIMEZONE, "brand": BRAND,
        "daily": dict(sorted(daily.items())),
        "response_summary": rt.get("summary") or {},
        "staff": staff, "channels": channels, "tags_30d": tags30, "tags_90d": tags90,
        "satisfaction_daily": dict(sorted(sat_days.items())),
        "reasons": dict(sorted(reasons.items())), "reason_labels": REASON_LABELS,
        "backlog": {**backlog, "as_of": now.strftime("%Y-%m-%dT%H:%M:%SZ")},
        "meta": {"window_days": WINDOW_DAYS, "classified": n_conv, "classified_by_tag": n_tagged, "origins": origins,
                 "history_from": min(daily) if daily else None, "last_day": max(daily) if daily else None,
                 "note": "Counts only. Customer names, e-mails and message text never leave Re:amaze; reasons are classified in the sync and the text is discarded."},
    }
    os.makedirs(os.path.dirname(OUTPUT_PATH) or ".", exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
    log(f"Wrote {OUTPUT_PATH}: {len(daily)} days, {len(reasons)} days of reasons, {len(staff)} staff")
    return 0


if __name__ == "__main__":
    sys.exit(main())
