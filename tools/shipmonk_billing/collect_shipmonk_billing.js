/* collect_shipmonk_billing.js  (toolkit v1.0, 2026-10-16)
 *
 * Run INSIDE a logged-in app.shipmonk.com tab (Claude built-in browser -> javascript_tool).
 * Collects everything the dashboard builder needs, in one shot:
 *   1. closed invoices (list + detail) whose billing period ends on/after SINCE   -> invoices[] (raw shape)
 *   2. the running (in-process) billing period                                   -> current{}
 *   3. the "Storage Fees Breakdown" Metabase report, card 165, per storage day   -> storage.chunks[]
 * Result: window.__smBill = {...} and the script's value is JSON.stringify(window.__smBill).
 *
 * Doc references (project FINANCE):
 *   claude/shipmonk-invoices.md      - billing endpoints, token in localStorage.api_token, line-item types
 *   claude/storage-fees-by-day.md    - /api/v1/reports -> Metabase embed JWT -> dashcard 251 / card 165
 *
 * SECURITY: the bearer token (localStorage.api_token) and the Metabase embed JWT are read into local
 * variables only. They are never logged, never put into window.__smBill, never returned. The report URL
 * (which embeds the JWT) is NOT stored either - only the report id/name.
 *
 * Assumptions documented here (see RUNBOOK.md "Open assumptions"):
 *   A1. Invoice list item fields: id, invoice_number, billing_period, status, closed, total (doc). The exact
 *       shape of billing_period is not documented -> pickPeriod() tries {start,end} / {from,to} /
 *       {start_date,end_date} / string "YYYY-MM-DD ... YYYY-MM-DD" / top-level *_start/*_end, and finally the
 *       detail payload. diag.list_item_keys shows the real keys so the builder's REPORT can be checked.
 *   A2. Card 165 rows: one row per storage day x warehouse, columns named TRUE_STORAGE_USD_SUM,
 *       STORAGE_CAPPING_SUM, WINNING_STRATEGY, INVOICED_SUM plus a day column and a warehouse column whose
 *       names are not documented. Rows are returned RAW together with data.cols[].name so the builder can
 *       map columns by name (fallback: positions 0=day, 1=warehouse, 2=true, 3=capping, 4=strategy, 5=invoiced
 *       - the order used by the Sept-2026 pull).
 *   A3. Chunking: Metabase embed returns at most 2000 rows per call. With <= 60 days per chunk and at most
 *       ~6 warehouses that is <= 360 rows, far under the cap. truncated:true is set if a chunk hits 2000 rows.
 *
 * Output size: the JSON can exceed 64k chars. The browser tool then saves the output to a file; see RUNBOOK.md
 * for how to parse it (it is a JSON *string literal*, cut before "\n\n(captured at origin").
 *
 * The javascript_tool evaluates with REPL semantics (top-level await, value of the last expression returned,
 * serialized as JSON) -> the whole script is one awaited expression whose value is the JSON string.
 * If the tool ever returns "[object Promise]" instead, run a second call: JSON.stringify(window.__smBill)
 * once window.__smBillDone === true (window.__smBillStatus shows progress).
 */
await (async () => {
  // ------------------------------------------------------------------ settings (edit these two lines)
  const SINCE = '2026-09-01';          // include invoices whose billing period END >= SINCE (ISO date)
  const STORAGE_SINCE = '2026-09-01';  // storage_day lower bound for the Metabase pull (ISO date)
  // ------------------------------------------------------------------ constants
  const PAGE_SIZE = 100;               // doc: ...?filter=%5B%5D&search=&page=1&pageSize=100
  const MAX_PAGES = 50;                // safety stop for pagination
  const BIG_ABS = 500;                 // line items with |amount| >= 500 go to big[] (raw shape)
  const DESC_MAX = 90;                 // big[].desc truncated to 90 chars (raw shape)
  const CHUNK_DAYS = 60;               // storage_day range per Metabase call (A3)
  const METABASE_MAX_ROWS = 2000;      // Metabase embed row cap (doc)
  const REPORT_NAME = 'Storage Fees Breakdown';   // doc: report id 40
  const REPORT_ID_FALLBACK = 40;
  const DASHCARD = 251, CARD = 165;    // doc: card 165 "Daily Total Storage Fee and Efficiency Data" (dc 251)
  const REPORTING_ORIGIN = 'https://reporting.shipmonk.cloud';
  const DETAIL_DELAY_MS = 150;         // be polite to the app API

  const out = {
    toolkit: 'collect_shipmonk_billing.js v1.0',
    collected_at: new Date().toISOString(),
    since: SINCE,
    storage_since: STORAGE_SINCE,
    today: null,
    origin: location.origin,
    invoices: [],
    current: null,
    storage: null,
    diag: { list_pages: 0, list_total: 0, list_item_keys: [], detail_keys: [], charges_keys: [], skipped: [], warnings: [] },
  };
  window.__smBill = out;
  window.__smBillStatus = 'starting';
  const status = (s) => { window.__smBillStatus = s; };

  // ------------------------------------------------------------------ helpers
  const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
  const r2 = (x) => Math.round((num(x) + Number.EPSILON) * 100) / 100;
  const int = (x) => Math.trunc(num(x));
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const isoLocal = (d) => {
    const z = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  };
  const isoDate = (v) => {
    if (v == null) return null;
    const s = String(v);
    const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const m2 = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);          // MM/DD/YYYY (US app)
    if (m2) return `${m2[3]}-${m2[1].padStart(2, '0')}-${m2[2].padStart(2, '0')}`;
    return null;
  };
  out.today = isoLocal(new Date());

  // token: doc "bearer token in localStorage.api_token (JSON-quoted JWT)" - never printed
  let tok = null;
  try {
    const rawTok = localStorage.getItem('api_token');
    if (!rawTok) throw new Error('localStorage.api_token missing (not logged in?)');
    try { tok = JSON.parse(rawTok); } catch (_) { tok = rawTok; }
    if (typeof tok !== 'string' || tok.length < 20) throw new Error('api_token has unexpected shape');
  } catch (e) {
    out.error = 'token: ' + (e && e.message ? e.message : String(e));
    status('error');
    return JSON.stringify(out);
  }
  const authHeaders = { Authorization: 'Bearer ' + tok, Accept: 'application/json' };

  async function getJson(url, headers, tries = 3) {
    let lastErr = null;
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(url, { headers, credentials: 'same-origin' });
        if (r.status === 429 || r.status >= 500) { lastErr = new Error('HTTP ' + r.status); await sleep(800 * (i + 1)); continue; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return await r.json();
      } catch (e) { lastErr = e; await sleep(400 * (i + 1)); }
    }
    throw lastErr || new Error('fetch failed');
  }
  const api = (path) => getJson(path, authHeaders);           // app.shipmonk.com internal API

  // first array of objects found in a response (handles {data:[...]}, {data:{items:[...]}}, {items:[...]}, [...])
  function findArray(obj, depth = 0) {
    if (Array.isArray(obj)) return obj;
    if (!obj || typeof obj !== 'object' || depth > 3) return null;
    for (const k of ['data', 'items', 'results', 'invoices', 'rows', 'list']) {
      if (k in obj) { const a = findArray(obj[k], depth + 1); if (a) return a; }
    }
    for (const v of Object.values(obj)) { const a = findArray(v, depth + 1); if (a) return a; }
    return null;
  }

  // A1: billing period extraction, tolerant to several shapes
  function pickPeriod(o) {
    if (!o || typeof o !== 'object') return [null, null];
    const bp = o.billing_period ?? o.billingPeriod ?? o.period ?? null;
    const pairs = [['start', 'end'], ['from', 'to'], ['start_date', 'end_date'], ['date_from', 'date_to'],
                   ['startDate', 'endDate'], ['begin', 'end'], ['start_at', 'end_at']];
    if (bp && typeof bp === 'object') {
      for (const [a, b] of pairs) if (bp[a] != null && bp[b] != null) return [isoDate(bp[a]), isoDate(bp[b])];
    }
    if (typeof bp === 'string') {
      const ds = bp.match(/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}/g) || [];
      if (ds.length >= 2) return [isoDate(ds[0]), isoDate(ds[1])];
    }
    const tops = [['start', 'end'], ['start_date', 'end_date'], ['period_start', 'period_end'],
                  ['billing_period_start', 'billing_period_end'], ['date_from', 'date_to'], ['from', 'to'],
                  ['billing_start', 'billing_end'], ['startDate', 'endDate']];
    for (const [a, b] of tops) if (o[a] != null && o[b] != null) return [isoDate(o[a]), isoDate(o[b])];
    if (bp != null) {                                  // last resort: any two dates inside billing_period JSON
      const ds = JSON.stringify(bp).match(/\d{4}-\d{2}-\d{2}/g) || [];
      if (ds.length >= 2) return [ds[0], ds[1]];
    }
    return [null, null];
  }
  const invNumber = (o) => String(o.invoice_number ?? o.number ?? o.invoiceNumber ?? o.id ?? '');
  const statusOf = (o) => String(o.status ?? o.state ?? '');
  function isClosed(o) {
    const st = statusOf(o).toLowerCase();
    if (/process|open|draft|pending|current|running/.test(st)) return false;
    if (o.closed === true) return true;
    if (o.closed === false) return false;
    return /complete|submitted|closed|paid|final|issued/.test(st);
  }

  // ------------------------------------------------------------------ 1. invoice list (paginated)
  // doc: GET /api/v1/billing/invoices?filter=%5B%5D&search=&page=1&pageSize=100  (list: id, invoice_number,
  //      billing_period, status, closed, total)
  const listItems = [];
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      status(`invoice list page ${page}`);
      const j = await api(`/api/v1/billing/invoices?filter=%5B%5D&search=&page=${page}&pageSize=${PAGE_SIZE}`);
      const items = findArray(j) || [];
      out.diag.list_pages = page;
      if (page === 1 && items.length) out.diag.list_item_keys = Object.keys(items[0]);
      listItems.push(...items);
      if (items.length < PAGE_SIZE) break;                 // follow pages while they are full
    }
    out.diag.list_total = listItems.length;
  } catch (e) {
    out.error = 'invoice list: ' + (e && e.message ? e.message : String(e));
  }

  // ------------------------------------------------------------------ 2. invoice details
  // doc: GET /api/v1/billing/invoices/{id} -> charges{shipping{total,count}, storage_fees{total,items[{type,
  //      average_daily_quantity,total,unit_prices}]}, adjustment{total,count}, line_items{total,count,
  //      items[{type,total_price,quantity,date,description}]}}
  const wanted = [];
  for (const it of listItems) {
    const number = invNumber(it);
    let [start, end] = pickPeriod(it);
    const total = num(it.total ?? it.amount ?? it.total_amount);
    if (!isClosed(it)) { out.diag.skipped.push({ id: it.id, number, status: statusOf(it), reason: 'not closed' }); continue; }
    if (!total) { out.diag.skipped.push({ id: it.id, number, status: statusOf(it), reason: 'no total' }); continue; }
    if (end && end < SINCE) { out.diag.skipped.push({ id: it.id, number, status: statusOf(it), reason: `end ${end} < SINCE` }); continue; }
    wanted.push({ it, number, start, end, total });
  }
  let n = 0;
  for (const w of wanted) {
    n++;
    status(`invoice detail ${n}/${wanted.length} (${w.number})`);
    try {
      const j = await api(`/api/v1/billing/invoices/${w.it.id}`);
      const d = (j && typeof j === 'object' && j.data && typeof j.data === 'object' && !Array.isArray(j.data)) ? j.data : j;
      const ch = (d.charges && typeof d.charges === 'object') ? d.charges : d;
      if (!out.diag.detail_keys.length) { out.diag.detail_keys = Object.keys(d); out.diag.charges_keys = Object.keys(ch); }
      let [start, end] = [w.start, w.end];
      if (!start || !end) { const p = pickPeriod(d); start = start || p[0]; end = end || p[1]; }
      if (!start || !end) { out.diag.skipped.push({ id: w.it.id, number: w.number, status: statusOf(w.it), reason: 'billing period not found (A1)' }); continue; }
      if (end < SINCE) { out.diag.skipped.push({ id: w.it.id, number: w.number, status: statusOf(w.it), reason: `end ${end} < SINCE (from detail)` }); continue; }

      const sh = ch.shipping || {}, sf = ch.storage_fees || ch.storage || {}, adj = ch.adjustment || ch.adjustments || {}, li = ch.line_items || {};
      const items = Array.isArray(li.items) ? li.items : (findArray(li) || []);
      const by_type = {};
      const big = [];
      for (const x of items) {
        const t = String(x.type ?? 'other');
        const amt = num(x.total_price ?? x.total ?? x.amount);
        if (!by_type[t]) by_type[t] = { amount: 0, count: 0 };
        by_type[t].amount += amt;
        by_type[t].count += 1;
        if (Math.abs(amt) >= BIG_ABS) {
          big.push({ type: t, amount: r2(amt), qty: num(x.quantity ?? x.qty), date: isoDate(x.date) || String(x.date ?? '').slice(0, 10),
                     desc: String(x.description ?? x.desc ?? '').slice(0, DESC_MAX) });
        }
      }
      for (const t of Object.keys(by_type)) by_type[t].amount = r2(by_type[t].amount);
      const liCount = (li.count != null) ? int(li.count) : items.length;
      if (li.count != null && int(li.count) !== items.length) out.diag.warnings.push(`invoice ${w.number}: line_items.count=${li.count} but items=${items.length}`);
      out.invoices.push({
        id: w.it.id,
        number: w.number,
        start, end,
        status: statusOf(w.it) || statusOf(d),
        total: r2(w.total || d.total),
        shipping: { total: r2(sh.total), count: int(sh.count) },
        storage: { total: r2(sf.total), by_type: (Array.isArray(sf.items) ? sf.items : []).map((s) => ({ type: String(s.type ?? ''), avg_daily_qty: num(s.average_daily_quantity ?? s.avg_daily_qty ?? s.quantity), total: r2(s.total) })) },
        adjustment: { total: r2(adj.total), count: int(adj.count) },
        line_items: { total: r2(li.total), count: liCount, by_type, big },
      });
    } catch (e) {
      out.diag.skipped.push({ id: w.it.id, number: w.number, status: statusOf(w.it), reason: 'detail error: ' + (e && e.message ? e.message : String(e)) });
    }
    await sleep(DETAIL_DELAY_MS);
  }
  out.invoices.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  // ------------------------------------------------------------------ 3. running period
  // doc: GET /api/v1/billing/invoices/current  (kỳ đang chạy)
  status('current period');
  try {
    const j = await api('/api/v1/billing/invoices/current');
    const d = (j && j.data && typeof j.data === 'object' && !Array.isArray(j.data)) ? j.data : j;
    const [start, end] = pickPeriod(d);
    out.current = { id: d.id ?? null, number: invNumber(d) || null, start, end, status: statusOf(d) || 'in_process',
                    total: r2(d.total), keys: Object.keys(d || {}) };
    if (!start || !end) out.current.warning = 'billing period not found in /invoices/current payload (A1)';
  } catch (e) {
    out.current = { error: (e && e.message ? e.message : String(e)) };
  }

  // ------------------------------------------------------------------ 4. storage report (Metabase embed)
  // doc: GET /api/v1/reports -> report "Storage Fees Breakdown" (id 40) url = https://reporting.shipmonk.cloud/
  //      embed/dashboard/<JWT>#...  ;  data: GET {origin}/api/embed/dashboard/<JWT>/dashcard/251/card/165
  //      ?storage_day=YYYY-MM-DD~YYYY-MM-DD   (query-string slug params; max 2000 rows -> chunked, A3)
  status('reports list');
  try {
    const j = await api('/api/v1/reports');
    const found = [];
    (function walk(o, depth) {
      if (!o || typeof o !== 'object' || depth > 6) return;
      if (Array.isArray(o)) { o.forEach((x) => walk(x, depth + 1)); return; }
      if (typeof o.url === 'string' && o.url.includes('/embed/dashboard/')) found.push(o);
      Object.values(o).forEach((v) => walk(v, depth + 1));
    })(j, 0);
    const nameOf = (r) => String(r.name ?? r.title ?? r.label ?? '');
    let rep = found.find((r) => nameOf(r).toLowerCase().includes(REPORT_NAME.toLowerCase()))
           || found.find((r) => Number(r.id) === REPORT_ID_FALLBACK);
    if (!rep) throw new Error(`report "${REPORT_NAME}" not found among ${found.length} embed reports: ` + found.map((r) => `${r.id}:${nameOf(r)}`).join(', ').slice(0, 300));
    const path = new URL(rep.url).pathname;
    const jwt = (path.split('/embed/dashboard/')[1] || '').split('/')[0].split('#')[0];
    if (!jwt || jwt.split('.').length < 3) throw new Error('embed JWT not found in report url');
    const reportingOrigin = new URL(rep.url).origin || REPORTING_ORIGIN;

    const chunks = [];
    const addDays = (iso, k) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + k); return isoLocal(d); };
    let from = STORAGE_SINCE;
    const today = out.today;
    let guard = 0;
    while (from <= today && guard++ < 100) {
      let to = addDays(from, CHUNK_DAYS - 1);
      if (to > today) to = today;
      status(`storage ${from}..${to}`);
      const url = `${reportingOrigin}/api/embed/dashboard/${jwt}/dashcard/${DASHCARD}/card/${CARD}?storage_day=${from}~${to}`;
      try {
        const r = await getJson(url, { Accept: 'application/json' });
        const data = (r && r.data && typeof r.data === 'object') ? r.data : r;
        const colsFull = Array.isArray(data.cols) ? data.cols : [];
        const rows = Array.isArray(data.rows) ? data.rows : [];
        chunks.push({ from, to, cols: colsFull.map((c) => String(c.name ?? c.display_name ?? '')), rows, row_count: rows.length,
                      truncated: rows.length >= METABASE_MAX_ROWS,
                      col_meta: colsFull.map((c) => ({ name: c.name ?? null, display_name: c.display_name ?? null, base_type: c.base_type ?? null })) });
        if (rows.length >= METABASE_MAX_ROWS) out.diag.warnings.push(`storage chunk ${from}..${to} hit the ${METABASE_MAX_ROWS}-row cap (A3) - shrink CHUNK_DAYS`);
      } catch (e) {
        chunks.push({ from, to, error: (e && e.message ? e.message : String(e)), rows: [], cols: [] });
      }
      from = addDays(to, 1);
    }
    out.storage = { report: { id: rep.id ?? null, name: nameOf(rep) }, dashcard: DASHCARD, card: CARD, param: 'storage_day',
                    chunk_days: CHUNK_DAYS, chunks };
  } catch (e) {
    out.storage = { error: (e && e.message ? e.message : String(e)) };
  }

  status('done');
  window.__smBillDone = true;
  return JSON.stringify(out);
})();
