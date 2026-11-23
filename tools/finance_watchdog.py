#!/usr/bin/env python3
# Finance watchdog check v1.0 (23/11/2026) - reads the public data files of the dashboard repo, prints a JSON health report.
# usage: python3 -I finance_watchdog.py <empty work dir> ; stdlib + curl only; read-only.
import json, subprocess, sys, os, re, datetime as dt, concurrent.futures as cf
from zoneinfo import ZoneInfo
BASE = 'https://raw.githubusercontent.com/taitran-star/ctu-fin-sync-8x2k/main/'
AUTO = {  # file: (max age in minutes, group, label)
    'data/shopify_pnl.json': (120, 't30', 'Shopify'), 'data/amazon_pnl.json': (120, 't30', 'Amazon'),
    'data/meta_ads.json': (120, 't30', 'Meta Ads'), 'data/google_ads.json': (120, 't30', 'Google Ads'),
    'data/shipmonk.json': (120, 't30', 'ShipMonk theo don'), 'data/paypal.json': (120, 't30', 'PayPal'),
    'data/walmart.json': (120, 't30', 'Walmart'), 'data/tiktok_shop.json': (120, 't30', 'TikTok Shop'),
    'data/tiktok_ads.json': (120, 't30', 'TikTok Ads'),
    'data/amazon_ads.json': (180, 'h1', 'Amazon Ads (export)'), 'data/amazon_storage.json': (180, 'h1', 'Amazon FBA kho'),
    'data/klaviyo.json': (180, 'h1', 'Klaviyo'), 'data/loop_subscriptions.json': (300, 'h1', 'Loop'),
    'data/shopify_promos.json': (480, 'h3', 'Shopify promos'), 'data/shopify_ltv.json': (480, 'h3', 'Shopify LTV'),
    'data/meta_creatives.json': (480, 'h3', 'Meta creatives'), 'data/amazon_sns.json': (600, 'h4', 'Amazon SnS'),
    'data/slash_pnl.json': (1800, 'd1', 'Slash'), 'data/cogs_lots.json': (1800, 'd1', 'Lo gia von Notion'),
}
EXTRA = ['data/amazon_dsp.json', 'site/public/shipmonk_invoices.json']
SANITY = [('data/shopify_pnl.json', 'orders', 'Shopify'), ('data/amazon_pnl.json', 'orders', 'Amazon'),
          ('data/meta_ads.json', 'spend', 'Meta Ads'), ('data/google_ads.json', 'spend', 'Google Ads'),
          ('data/shipmonk.json', 'orders', 'ShipMonk')]
AUTH_RE = re.compile(r'\b(401|403)\b|unauthor|expired|invalid[_ ]?(token|grant)|access[_ ]?denied|forbidden|revoked', re.I)

def fetch(path, wd):
    if os.environ.get('WD_LOCAL'):  # test hook: read a local copy instead of the network
        try:
            with open(os.path.join(os.environ['WD_LOCAL'], path.split('/')[-1]), encoding='utf-8') as f: return json.load(f)
        except Exception as e: return {'__error__': str(e)[:80]}
    out = os.path.join(wd, path.replace('/', '__'))
    for _ in range(2):
        r = subprocess.run(['curl', '-sS', '-f', '-m', '120', '-o', out, BASE + path], capture_output=True, text=True)
        if r.returncode == 0:
            try:
                with open(out, encoding='utf-8') as f: return json.load(f)
            except Exception as e: err = 'parse: %s' % str(e)[:80]
        else: err = (r.stderr or 'curl failed').strip()[:120]
    return {'__error__': err}

def ts(s):
    if not isinstance(s, str): return None
    try:
        t = dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
        return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)
    except Exception: return None

def gen(o):
    m = o.get('meta') if isinstance(o.get('meta'), dict) else {}
    return ts(o.get('generated_at')) or ts(m.get('generated_at'))

def day_row(o, day):
    c = o.get('daily')
    if isinstance(c, dict): return c.get(day)
    if isinstance(c, list):
        for it in c:
            if isinstance(it, dict) and (it.get('date') == day or it.get('day') == day): return it
    return None

def main():
    wd = sys.argv[1] if len(sys.argv) > 1 else '/tmp/wd/data'
    os.makedirs(wd, exist_ok=True)
    now = ts(os.environ.get('WD_NOW')) or dt.datetime.now(dt.timezone.utc)  # WD_NOW: test hook
    la = now.astimezone(ZoneInfo('America/Los_Angeles')); vn = now.astimezone(ZoneInfo('Asia/Ho_Chi_Minh'))
    today, yday = la.date().isoformat(), (la.date() - dt.timedelta(days=1)).isoformat()
    paths = list(AUTO) + EXTRA
    with cf.ThreadPoolExecutor(6) as ex: D = dict(zip(paths, ex.map(lambda p: fetch(p, wd), paths)))
    items = []
    add = lambda i, level, msg: items.append({'id': i, 'level': level, 'msg': msg})
    age = lambda t: None if t is None else (now - t).total_seconds() / 60
    late30 = 0
    for p, (lim, grp, label) in AUTO.items():
        o = D[p]
        if '__error__' in o: add('fetch:' + p, 'warn', '%s: khong tai duoc file (%s)' % (label, o['__error__'])); continue
        a = age(gen(o))
        if a is None: add('auto:' + p, 'warn', '%s: khong co generated_at' % label); continue
        if a > lim:
            if grp == 't30': late30 += 1
            add('auto:' + p, 'action' if a > max(360, 3 * lim) else 'warn', '%s tre %.0f phut (nguong %d)' % (label, a, lim))
        m = o.get('meta') if isinstance(o.get('meta'), dict) else {}
        msgs = [str(x) for k in ('warnings', 'api_errors') for src in (o, m) for x in (src.get(k) or []) if isinstance(src.get(k), list)]
        bad = [x for x in msgs if AUTH_RE.search(x)]
        if bad: add('auth:' + p, 'action', '%s: canh bao quyen/token trong file: %s' % (label, bad[0][:160]))
        if p == 'data/cogs_lots.json' and m.get('error'): add('auth:' + p, 'action', 'Notion lots: %s' % str(m.get('error'))[:160])
    if late30 >= 4: add('ticker', 'action', '%d/9 nguon nhom 30 phut tre > 2 gio - ticker GitHub co the da dung' % late30)
    if la.hour >= 6:  # yesterday (LA) should be complete in the main sources
        for p, field, label in SANITY:
            o = D[p]
            if '__error__' in o: continue
            r = day_row(o, yday)
            v = (r or {}).get(field)
            if not r or not v: add('hole:' + p, 'warn', '%s: ngay %s %s = %s' % (label, yday, field, 'thieu dong' if not r else v))
    a = D['data/amazon_ads.json']
    if '__error__' not in a:
        m = a.get('meta') or {}; daily = a.get('daily') or {}
        live_age = age(ts((m.get('live') or {}).get('fetched_at')))
        trow, yrow = daily.get(today), daily.get(yday)
        if la.hour >= 9 and (not trow or (live_age is None or live_age > 300) and trow.get('spend_src') != 'sellerboard_automation'):
            add('login:sb_intraday', 'action' if (live_age is None or live_age > 480) else 'warn',
                'Amazon Ads hom nay (%s LA) %s; lan doc Sellerboard gan nhat %s' % (today, 'chua co dong' if not trow else 'da cu', 'chua co' if live_age is None else '%.0f phut truoc' % live_age))
        if la.hour >= 15 and (not yrow or yrow.get('spend_src') != 'sellerboard_automation'):
            add('export:sellerboard_link', 'action', 'Export tu dong Sellerboard chua ve cho ngay %s (link export co the het han)' % yday)
        pl = m.get('ppc_last_day')
        if pl:
            gap = (la.date() - dt.date.fromisoformat(pl)).days
            if gap > 12: add('login:ppc', 'warn', 'ROAS/ACOS Amazon Ads (PPC console) dung o %s (%d ngay)' % (pl, gap))
    d = D['data/amazon_dsp.json']
    if '__error__' not in d:
        ld = (d.get('coverage') or {}).get('last_day')
        gap = (la.date() - dt.date.fromisoformat(ld)).days if ld else 99
        if gap > 3: add('login:dsp', 'action' if gap > 5 else 'warn', 'Amazon DSP (Xnurta) dung o %s (%d ngay)' % (ld, gap))
    s = D['site/public/shipmonk_invoices.json']
    if '__error__' not in s:
        m = s.get('meta') or {}; ld = m.get('last_day'); v = vn.date()
        if v.day >= 18: need = v.replace(day=14)
        elif v.day >= 3: need = v.replace(day=1) - dt.timedelta(days=1)
        else: need = (v.replace(day=1) - dt.timedelta(days=1)).replace(day=14)
        if not ld or ld < need.isoformat(): add('login:shipmonk_invoice', 'action', 'Hoa don ShipMonk moi toi %s, can toi %s' % (ld, need.isoformat()))
        pa = age(ts(m.get('payments_as_of')))
        if pa is not None and pa > 10 * 1440 and (m.get('open_balance') or 0) > 0: add('login:shipmonk_payments', 'info', 'Trang thai thanh toan ShipMonk doc %.0f ngay truoc' % (pa / 1440))
    order = {'action': 0, 'warn': 1, 'info': 2}
    items.sort(key=lambda x: (order.get(x['level'], 9), x['id']))
    rep = {'version': '1.0', 'now_utc': now.isoformat(timespec='seconds'), 'now_vn': vn.strftime('%d/%m %H:%M'), 'la_date': today, 'la_hour': la.hour,
           'checked_files': len(paths), 'counts': {k: sum(1 for i in items if i['level'] == k) for k in ('action', 'warn', 'info')}, 'items': items}
    print(json.dumps(rep, ensure_ascii=False, indent=1))

if __name__ == '__main__':
    main()
