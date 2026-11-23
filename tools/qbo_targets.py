#!/usr/bin/env python3
"""qbo_targets.py v1.0 - what QuickBooks should hold for each sales channel, per month, from the dashboard data files.

Reads (from a data folder): shopify_payouts.json, amazon_settlements.json, walmart_settlements.json, tiktok_shop.json.
For each channel and month it builds ONE balanced set of journal lines (account id -> amount, debit +, credit -)
with the same rules used for the entries already in the book (DT-SHOPIFY-*, DT-AMAZON-*, DT-WALMART-*, DT-TIKTOK-*):

  shopify : payout basis, month = payout issue day (payouts issued from 2026-05-27); the balance not yet in a
            payout ("pending") goes to the current month. An ADJUSTMENT with no reason is NOT booked: it stays in
            the wallet until explained.
  amazon  : settlement basis (USD only), month = day Amazon sent the money (transfer_day); settlements not sent
            yet go to the current month. Three settlements booked earlier by the day the money reached the bank
            keep that month (BOOKED_MONTH). Reserve movements are not profit or loss: they stay in the wallet.
  walmart : payment period basis, month = report day + 1 (the day the money reaches the bank).
  tiktok  : statement basis, month = statement day.

With --state FILE (what is already booked, same shape) it prints the journal entries still to post = target - booked,
only for the current and the previous month; a difference in an older month is listed under "held" and never posted.
With --state FILE --confirm DOC[,DOC...] it prints the state after those entries were posted.
No estimate anywhere: every amount is a sum of rows of the source files. Any failed check stops that channel.
"""
import argparse
import calendar
import collections
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

VERSION = "1.0"
TZ = ZoneInfo("America/Los_Angeles")
# QuickBooks account ids (company Cattasaurus LLC)
A = {"w_shopify": "118", "w_amazon": "116", "w_walmart": "119", "w_tiktok": "126",
     "sales": "92", "discounts": "94", "fee": "105", "fee_amazon": "121", "fee_walmart": "122", "fee_tiktok": "127",
     "fulfil": "97", "warehouse": "124", "inventory": "84", "other_income": "114", "sale_tax": "110", "ads": "99"}
NAMES = {"118": "Digital Wallet:Shopify", "116": "Digital Wallet:Amazon", "119": "Digital Wallet:Walmart",
         "126": "Digital Wallet:TikTok Shop", "92": "Merchandise Sales", "94": "Sales Discounts",
         "105": "Merchant Account Fees", "121": "Merchant Account Fees:Amazon", "122": "Merchant Account Fees:Walmart",
         "127": "Merchant Account Fees:TikTok Shop", "97": "Fullfilment Expenses", "124": "S&A:Warehouse Expense",
         "84": "Inventory:Available for Sales", "114": "Other Income", "110": "Sale Tax", "99": "Advertising and Promotion"}
WALLET = {"shopify": "118", "amazon": "116", "walmart": "119", "tiktok": "126"}
SHOPIFY_FROM = "2026-05-27"      # first payout in the new book
AMAZON_FROM = "2026-05-26"       # first transfer day in the new book
WALMART_FROM = "2026-05-28"      # first report day in the new book
# settlements already booked in the month the money reached the bank: (transfer_day, original_total) -> month
BOOKED_MONTH = {("2026-05-31", 15389.85): "2026-06", ("2026-06-29", 19061.93): "2026-07", ("2026-09-30", 7438.99): "2026-10"}
MAX_AGE_HOURS = 72


def r2(x):
    return round(x + 0.0, 2)


def load(folder, name):
    with open(os.path.join(folder, name), encoding="utf-8") as f:
        return json.load(f)


def age_hours(stamp):
    try:
        t = datetime.strptime(str(stamp)[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - t).total_seconds() / 3600
    except (TypeError, ValueError):
        return None


def balance(lines, wallet):
    """Round to cents, drop zeros, push the rounding cent to the wallet line. lines: account -> signed amount."""
    out = {k: r2(v) for k, v in lines.items() if abs(r2(v)) >= 0.005}
    diff = r2(sum(out.values()))
    if abs(diff) >= 0.005:
        out[wallet] = r2(out.get(wallet, 0.0) - diff)
        if abs(out[wallet]) < 0.005:
            del out[wallet]
    return out


# ------------------------------------------------------------------ shopify
def shopify(folder, cur_month, checks):
    o = load(folder, "shopify_payouts.json")
    h = age_hours(o.get("generated_at"))
    if h is None or h > MAX_AGE_HOURS:
        raise ValueError(f"shopify_payouts.json is stale (generated_at {o.get('generated_at')})")
    M = collections.defaultdict(lambda: collections.defaultdict(float))
    info = collections.defaultdict(lambda: collections.defaultdict(float))

    def put(ym, t, g):
        a, f = g["amount"], g["fee"]
        m = M[ym]
        if t in ("CHARGE", "SHOP_CASH_CREDIT"):
            m["sales"] += a; m["fee"] += f
        elif t in ("REFUND", "REFUND_FAILURE", "SHOP_CASH_REFUND_DEBIT"):
            m["refund"] += -a; m["fee"] += f
        elif t in ("DISPUTE_WITHDRAWAL", "DISPUTE_REVERSAL", "SELLER_PROTECTION_CREDIT", "SELLER_PROTECTION_CREDIT_REVERSAL"):
            m["chargeback"] += -a; m["fee"] += f
        elif t in ("TAX_ADJUSTMENT_DEBIT", "TAX_ADJUSTMENT_CREDIT"):
            m["tax"] += -a; m["fee"] += f
        elif t in ("ANOMALY_DEBIT", "ANOMALY_CREDIT"):
            m["fee"] += -a + f
        elif t in ("RESERVED_FUNDS_WITHDRAWAL", "RESERVED_FUNDS_REVERSAL"):
            m["reserve"] += -a + f
        elif t == "ADJUSTMENT":
            m["unknown_adj"] += -a + f
        else:
            raise ValueError(f"shopify: unknown balance transaction type {t}")

    for p in o["payouts"]:
        if p["date"] < SHOPIFY_FROM:
            continue
        if abs(p.get("tx_diff") or 0) >= 0.005:
            raise ValueError(f"shopify: payout of {p['date']} is not explained by its transactions (diff {p.get('tx_diff')})")
        ym = p["date"][:7]
        info[ym]["payouts"] += 1; info[ym]["payout_net"] += p["net"]
        for t, g in p["tx"].items():
            put(ym, t, g)
    for t, g in (o.get("pending") or {}).items():
        put(cur_month, t, g); info[cur_month]["pending_net"] += g["net"]
    months = {}
    for ym, m in M.items():
        wallet = m["sales"] - m["fee"] - m["refund"] - m["chargeback"] - m["tax"] - m["reserve"]   # unknown_adj stays in the wallet
        lines = {A["w_shopify"]: wallet, A["sales"]: -m["sales"], A["fee"]: m["fee"],
                 A["discounts"]: m["refund"] + m["chargeback"], A["sale_tax"]: m["tax"]}
        if abs(m["unknown_adj"]) >= 0.005:
            checks.append({"source": "shopify", "level": "info", "msg": f"{ym}: adjustment with no reason {r2(-m['unknown_adj'])} left in the wallet, not booked"})
        months[ym] = {"lines": balance(lines, A["w_shopify"]),
                      "info": {k: r2(v) for k, v in {**info[ym], "sales": m["sales"], "fee": m["fee"], "refund": m["refund"],
                                                     "chargeback": m["chargeback"], "tax": m["tax"], "reserve": m["reserve"],
                                                     "unknown_adj": m["unknown_adj"]}.items()}}
    return {"as_of": o.get("generated_at"), "months": months}


# ------------------------------------------------------------------ amazon
def amazon_cat(L):
    if L.startswith("Adjustment:Reserve"): return "reserve"
    if (":tax_withheld:" in L or L.endswith(":Tax") or L.endswith(":ShippingTax") or L.startswith("Retrocharge")
            or L in ("Removal:TaxAmount", "Removal:TaxWithheld", "RemovalAdjustment:TaxAmountAdjustment", "RemovalAdjustment:TaxWithheldAdjustment")):
        return "tax"
    if L in ("Shipment:charge:Principal", "Shipment:charge:ShippingCharge", "Shipment:charge:GiftWrap", "Removal:Revenue", "RemovalAdjustment:RevenueAdjustment"):
        return "sales"
    if L.startswith("Refund:charge:") or L.startswith("GuaranteeClaim:charge:") or L.startswith("Chargeback:charge:") or ":promo:" in L:
        return "discounts"
    if (L.startswith("Adjustment:ReturnPostageBilling") or L.startswith("Adjustment:PostageBilling") or L.startswith("Adjustment:PostageRefund")
            or L.startswith("Shipment:fee:FBA") or L.startswith("Refund:fee:FBA")):
        return "fulfil"
    if L in ("ServiceFee:fee:FBAStorageFee", "ServiceFee:fee:FBALongTermStorageFee", "ServiceFee:fee:STARStorageFee",
             "ServiceFee:fee:AmazonUpstreamStorageTransportationFee", "ServiceFee:fee:FBADisposalFee", "Removal:FeeAmount", "ServiceFee:fee:FBARemovalFee"):
        return "warehouse"
    if L in ("ServiceFee:fee:FBAInternationalInboundFreightFee", "ServiceFee:fee:FBAInternationalInboundFreightTaxAndDuty",
             "ServiceFee:fee:FBAInboundConvenienceFee", "ServiceFee:fee:FBAInboundTransportationFee"):
        return "inventory"
    if L.startswith("Adjustment:"): return "reimb"
    if ":fee:" in L: return "amzfee"
    return None


def amazon(folder, cur_month, checks):
    o = load(folder, "amazon_settlements.json")
    h = age_hours(o.get("generated_at"))
    if h is None or h > MAX_AGE_HOURS:
        raise ValueError(f"amazon_settlements.json is stale (generated_at {o.get('generated_at')})")
    M = collections.defaultdict(lambda: collections.defaultdict(float))
    for g in o["settlements"]:
        if g.get("currency") != "USD":
            continue
        td = g.get("transfer_day")
        sent = td and g.get("transfer_status") == "Succeeded"
        if td and td < AMAZON_FROM:
            continue
        if not g.get("raw") and abs(g.get("original_total") or 0) < 0.005:
            continue
        if not td and (g.get("start_day") or "") < AMAZON_FROM and abs(g.get("original_total") or 0) < 0.005:
            continue
        if g.get("status") == "Closed" and g.get("events_done") is not True:
            raise ValueError(f"amazon: closed settlement started {g.get('start_day')} has not been fully downloaded yet")
        ym = BOOKED_MONTH.get((td, r2(g.get("original_total") or 0)), td[:7] if sent else cur_month)
        m = M[ym]
        m["n"] += 1; m["total"] += g.get("original_total") or 0; m["raw"] += g.get("raw_total") or 0
        if not sent: m["unpaid"] += g.get("original_total") or 0
        for k, v in (g.get("raw") or {}).items():
            c = amazon_cat(k)
            if c is None:
                raise ValueError(f"amazon: unknown event label {k} ({v})")
            m[c] += v
    months = {}
    for ym, m in M.items():
        wallet = sum(m[c] for c in ("sales", "discounts", "amzfee", "fulfil", "warehouse", "inventory", "reimb", "tax"))   # reserve stays in the wallet
        lines = {A["w_amazon"]: wallet, A["sales"]: -m["sales"], A["discounts"]: -m["discounts"], A["fee_amazon"]: -m["amzfee"],
                 A["fulfil"]: -m["fulfil"], A["warehouse"]: -m["warehouse"], A["inventory"]: -m["inventory"],
                 A["other_income"]: -m["reimb"], A["sale_tax"]: -m["tax"]}
        months[ym] = {"lines": balance(lines, A["w_amazon"]),
                      "info": {"settlements": int(m["n"]), "paid_out_total": r2(m["total"]), "not_sent_yet": r2(m["unpaid"]),
                               "total_minus_events": r2(m["total"] - m["raw"]), "reserve": r2(m["reserve"])}}
    return {"as_of": o.get("generated_at"), "months": months}


# ------------------------------------------------------------------ walmart
WM = {"Sale|Product Price": "sales", "Sale|Total Walmart Funded Savings": "sales", "Sale|Promo Code": "disc",
      "Refund|Product Price": "disc", "Refund|Total Walmart Funded Savings": "disc", "Refund|Promo Code": "disc",
      "Sale|Commission on Product": "fee", "Refund|Commission on Product": "fee",
      "Campaigns|SEM Marketing Fee": "ads", "Sale|Product tax": "tax", "Sale|Product tax withheld": "tax",
      "Refund|Product tax": "tax", "Refund|Product tax withheld": "tax", "PaymentSummary|": "zero"}
WM_NOTES = {"Service Fee|Fee/Reimbursement|Walmart Product Advertising": "ads", "Service Fee|Item Fees|Walmart Return Shipping Charge": "ful"}


def walmart(folder, cur_month, checks):
    o = load(folder, "walmart_settlements.json")
    h = age_hours(o.get("generated_at"))
    if h is None or h > MAX_AGE_HOURS:
        raise ValueError(f"walmart_settlements.json is stale (generated_at {o.get('generated_at')})")
    M = collections.defaultdict(lambda: collections.defaultdict(float))
    for s in o["settlements"]:
        if s["report_date"] < WALMART_FROM:
            continue
        if s.get("total_payable") is None or abs(s.get("diff") or 0) >= 0.005:
            raise ValueError(f"walmart: report {s['report_date']} is not explained by its rows")
        ym = (date.fromisoformat(s["report_date"]) + timedelta(days=1)).isoformat()[:7]
        m = M[ym]
        m["n"] += 1; m["payable"] += s["total_payable"]
        tax = 0.0
        for k, v in s["lines"].items():
            if k.startswith("Service Fee|"):
                continue                       # taken from notes below, by description
            c = WM.get(k)
            if c is None:
                raise ValueError(f"walmart: unknown row type {k} ({v[1]}) in report {s['report_date']}")
            if c == "tax":
                tax += v[1]                    # tax collected and tax withheld by Walmart cancel out
            elif c != "zero":
                m[c] += v[1]
        if abs(tax) >= 0.005:
            raise ValueError(f"walmart: tax rows do not net to zero in report {s['report_date']} ({r2(tax)})")
        for k, v in s["notes"].items():
            if not k.startswith("Service Fee|"):
                continue
            c = WM_NOTES.get(k)
            if c is None:
                raise ValueError(f"walmart: unknown service fee {k} ({v[1]}) in report {s['report_date']}")
            m[c] += v[1]
    months = {}
    for ym, m in M.items():
        lines = {A["w_walmart"]: m["payable"], A["sales"]: -m["sales"], A["discounts"]: -m["disc"], A["fee_walmart"]: -m["fee"],
                 A["ads"]: -m["ads"], A["fulfil"]: -m["ful"]}
        chk = r2(m["sales"] + m["disc"] + m["fee"] + m["ads"] + m["ful"] - m["payable"])
        if abs(chk) >= 0.005:
            raise ValueError(f"walmart: {ym} rows minus payable = {chk}")
        months[ym] = {"lines": balance(lines, A["w_walmart"]), "info": {"periods": int(m["n"]), "payable": r2(m["payable"])}}
    return {"as_of": o.get("generated_at"), "months": months}


# ------------------------------------------------------------------ tiktok
def tiktok(folder, cur_month, checks):
    o = load(folder, "tiktok_shop.json")
    h = age_hours(o.get("generated_at"))
    if h is None or h > MAX_AGE_HOURS:
        raise ValueError(f"tiktok_shop.json is stale (generated_at {o.get('generated_at')})")
    if ((o.get("meta") or {}).get("api_status") or {}).get("status") != "ok":
        raise ValueError("tiktok: statements API status is not ok")
    M = collections.defaultdict(lambda: collections.defaultdict(float))
    for s in (o.get("statements") or {}).values():
        if (s.get("currency") or "USD") != "USD":
            raise ValueError("tiktok: statement not in USD")
        m = M[s["day"][:7]]
        rev, fee, ship, adj, settle = (float(s.get(k) or 0) for k in ("revenue_amount", "fee_amount", "shipping_cost_amount", "adjustment_amount", "settlement_amount"))
        if abs(rev + fee + ship + adj - settle) >= 0.011:
            raise ValueError(f"tiktok: statement of {s['day']} does not add up")
        m["n"] += 1; m["rev"] += rev; m["fee"] += fee; m["ship"] += ship; m["settle"] += settle; m["adj"] += adj
        m["paid" if s.get("payment_status") == "PAID" else "not_paid"] += settle
    months = {}
    for ym, m in M.items():
        if abs(m["adj"]) >= 0.005:   # statement adjustments that do not cancel out within the month are booked with the TikTok fees
            checks.append({"source": "tiktok", "level": "warn", "msg": f"{ym}: statement adjustments net {r2(m['adj'])} booked with TikTok fees - check in Seller Center"})
        lines = {A["w_tiktok"]: m["settle"], A["sales"]: -m["rev"], A["fee_tiktok"]: -(m["fee"] + m["adj"]), A["fulfil"]: -m["ship"]}
        months[ym] = {"lines": balance(lines, A["w_tiktok"]),
                      "info": {"statements": int(m["n"]), "settlement": r2(m["settle"]), "not_paid_yet": r2(m["not_paid"])}}
    return {"as_of": o.get("generated_at"), "months": months}


SOURCES = {"shopify": shopify, "amazon": amazon, "walmart": walmart, "tiktok": tiktok}


# ------------------------------------------------------------------ deltas
def month_end(ym):
    y, m = int(ym[:4]), int(ym[5:])
    return f"{ym}-{calendar.monthrange(y, m)[1]:02d}"


def prev_month(ym):
    y, m = int(ym[:4]), int(ym[5:])
    return f"{y - 1}-12" if m == 1 else f"{y}-{m - 1:02d}"


def build(folder, today):
    cur = today.isoformat()[:7]
    checks, out = [], {}
    for name, fn in SOURCES.items():
        try:
            out[name] = {"ok": True, **fn(folder, cur, checks)}
        except Exception as e:  # noqa: BLE001 - a failed check stops that channel only
            out[name] = {"ok": False, "error": str(e)[:300], "months": {}}
            checks.append({"source": name, "level": "error", "msg": str(e)[:300]})
    return cur, checks, out


def entries(cur, out, state, today):
    post, held = [], []
    allowed = {cur, prev_month(cur)}
    for name, src in out.items():
        if not src["ok"]:
            continue
        booked = (state.get("sources") or {}).get(name) or {}
        for ym in sorted(set(src["months"]) | set(booked)):
            tgt = (src["months"].get(ym) or {}).get("lines") or {}
            bk = (booked.get(ym) or {}).get("lines") or {}
            delta = {k: r2(tgt.get(k, 0.0) - bk.get(k, 0.0)) for k in set(tgt) | set(bk)}
            delta = {k: v for k, v in delta.items() if abs(v) >= 0.005}
            if not delta:
                continue
            if abs(r2(sum(delta.values()))) >= 0.005:
                held.append({"source": name, "month": ym, "reason": "difference is not balanced", "delta": delta}); continue
            if ym not in allowed:
                held.append({"source": name, "month": ym, "reason": "older than the previous month - never posted automatically",
                             "delta": {NAMES.get(k, k): v for k, v in delta.items()}}); continue
            n = int((booked.get(ym) or {}).get("n") or 0) + 1
            doc = f"DT-{name.upper()}-{ym}" + ("" if n == 1 else f"-{n}")
            lines = [{"kind": "Journal", "account_id": k, "posting_type": "Debit" if v > 0 else "Credit", "amount": f"{abs(v):.2f}",
                      "description": NAMES.get(k, k)} for k, v in sorted(delta.items(), key=lambda kv: (kv[0] != WALLET[name], kv[0]))]
            total = r2(sum(v for v in delta.values() if v > 0))
            post.append({"source": name, "month": ym, "doc_number": doc, "txn_date": today.isoformat() if ym == cur else month_end(ym),
                         "memo": (f"{name} {ym}: bo sung theo du lieu API den {src.get('as_of')} (qbo_targets v{VERSION}); "
                                  f"so can co tru so da ghi. " + json.dumps((src["months"].get(ym) or {}).get("info") or {}, separators=(",", ":")))[:900],
                         "total": total, "wallet_change": delta.get(WALLET[name], 0.0), "lines": lines, "delta": delta})
    return post, held


def apply(state, post, confirmed):
    st = json.loads(json.dumps(state))
    src = st.setdefault("sources", {})
    done = []
    for p in post:
        if p["doc_number"] not in confirmed:
            continue
        m = src.setdefault(p["source"], {}).setdefault(p["month"], {"lines": {}, "n": 0, "docs": []})
        for k, v in p["delta"].items():
            m["lines"][k] = r2(m["lines"].get(k, 0.0) + v)
            if abs(m["lines"][k]) < 0.005:
                del m["lines"][k]
        m["n"] = int(m.get("n") or 0) + 1
        m.setdefault("docs", []).append(p["doc_number"])
        done.append(p["doc_number"])
    st["updated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    st["last_docs"] = done
    return st, done


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data")
    ap.add_argument("--state")
    ap.add_argument("--confirm", default="")
    ap.add_argument("--today", default="")
    a = ap.parse_args()
    today = date.fromisoformat(a.today) if a.today else datetime.now(TZ).date()
    cur, checks, out = build(a.data, today)
    res = {"version": VERSION, "today_la": today.isoformat(), "current_month": cur, "checks": checks}
    if not a.state:
        res["sources"] = out
        print(json.dumps(res, indent=1, sort_keys=True)); return
    with open(a.state, encoding="utf-8") as f:
        state = json.load(f)
    post, held = entries(cur, out, state, today)
    if a.confirm:
        confirmed = {d.strip() for d in a.confirm.split(",") if d.strip()}
        st, done = apply(state, post, confirmed)
        missing = sorted(confirmed - set(done))
        if missing:
            print(json.dumps({"error": f"not in the list to post: {missing}"})); sys.exit(2)
        print(json.dumps(st, indent=1, sort_keys=True)); return
    for p in post:
        p.pop("delta")
    res.update({"to_post": post, "held": held,
                "channels_failed": [k for k, v in out.items() if not v["ok"]]})
    print(json.dumps(res, indent=1, sort_keys=True))


if __name__ == "__main__":
    main()
