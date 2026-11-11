/* collect_shipmonk_storage_phase2.js  (toolkit v1.1.0, 2026-11-09)
 *
 * PHASE 2 of the ShipMonk storage pull - run INSIDE the Metabase embed page on reporting.shipmonk.cloud
 * (Claude built-in browser -> javascript_tool), because the Claude desktop app on Windows blocks cross-origin
 * fetch from app.shipmonk.com (collect_shipmonk_billing.js v1.1.0 then returns storage = {error, phase2:true}).
 *
 * How to get there (no token is ever printed):
 *   1. run collect_shipmonk_billing.js in the logged-in app.shipmonk.com tab (it keeps the embed URL in
 *      window.__smReportUrl), then in the SAME tab run:   window.__smGoReporting()
 *      - or, standalone:  GET /api/v1/reports (Bearer localStorage.api_token) -> report 40 "Storage Fees
 *        Capping Breakdown" -> location.href = its url  (the JWT sits in the path /embed/dashboard/<JWT>#...)
 *   2. wait ~3 s, then run THIS script there. It moves the JWT from the URL into a page variable
 *      (history.replaceState -> /embed/dashboard/), pulls card 165 per storage_day chunk and returns a JSON
 *      string literal:  {toolkit, collected_at, today, origin, storage:{report, dashcard, card, param, chunk_days, chunks[]}}
 *   3. save the result as storage_blob.json (cut the "\n\n(captured at origin" trailer if the tool adds one) and
 *      build:  python3 -I build_shipmonk_billing.py blob.json --storage-blob storage_blob.json \
 *                 --inv-prev shipmonk_invoices.json --storage-prev shipmonk_storage_daily.json --out-dir out
 *      (blob.json may be omitted when only storage changed: give --inv-prev instead).
 *
 * Known outage: 09/11/2026 evening + night the whole Metabase instance answered HTTP 503 "no available server"
 * (even /api/health) -> result is storage.chunks[].error = "HTTP 503 ..." and the builder leaves the storage file as is.
 *
 * SECURITY: the embed JWT is read from location.pathname (or window.__smJwt) into a local variable only; it is
 * removed from the URL, never logged, never put into the result. Only report id/name are returned.
 */
await (async () => {
  // ------------------------------------------------------------------ settings (edit this line)
  const STORAGE_SINCE = '2026-10-09';  // storage_day lower bound = previous file last_day - 7 (ISO date)
  // ------------------------------------------------------------------ constants (same as the main collector)
  const CHUNK_DAYS = 60;
  const METABASE_MAX_ROWS = 2000;
  const DASHCARD = 251, CARD = 165;
  const REPORT = { id: 40, name: 'Storage Fees Capping Breakdown' };
  const TRIES = 3, RETRY_MS = 2500;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isoLocal = (d) => { const z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };
  const addDays = (iso, k) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + k); return isoLocal(d); };

  const out = { toolkit: 'collect_shipmonk_storage_phase2.js v1.1.0', collected_at: new Date().toISOString(), today: isoLocal(new Date()),
                origin: location.origin, storage_since: STORAGE_SINCE, storage: null };
  window.__smStorage = out;
  window.__smStorageStatus = 'starting';
  const status = (s) => { window.__smStorageStatus = s; };

  // JWT: from the path /embed/dashboard/<JWT>[#...] or from a previous run (window.__smJwt). Never printed.
  let jwt = window.__smJwt || null;
  const seg = location.pathname.split('/embed/dashboard/');
  if (seg.length > 1) { const j = seg[1].split('/')[0].split('#')[0]; if (j && j.split('.').length >= 3) jwt = j; }
  if (!jwt || jwt.split('.').length < 3) {
    out.storage = { error: 'embed JWT not found (open the Metabase embed page first: window.__smGoReporting() in the ShipMonk tab)', phase2: true };
    status('error');
    return JSON.stringify(out);
  }
  window.__smJwt = jwt;
  try { history.replaceState(null, '', '/embed/dashboard/'); } catch (_) { /* ignore */ }

  async function getJson(url, tries = TRIES) {
    let lastErr = null;
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(url, { headers: { Accept: 'application/json' } });
        if (r.status === 429 || r.status >= 500) { lastErr = new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 60).trim()); await sleep(RETRY_MS * (i + 1)); continue; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return await r.json();
      } catch (e) { lastErr = e; await sleep(800 * (i + 1)); }
    }
    throw lastErr || new Error('fetch failed');
  }

  const chunks = [];
  let from = STORAGE_SINCE, guard = 0;
  while (from <= out.today && guard++ < 100) {
    let to = addDays(from, CHUNK_DAYS - 1);
    if (to > out.today) to = out.today;
    status(`storage ${from}..${to}`);
    const url = `/api/embed/dashboard/${jwt}/dashcard/${DASHCARD}/card/${CARD}?storage_day=${from}~${to}`;
    try {
      const r = await getJson(url);
      const data = (r && r.data && typeof r.data === 'object') ? r.data : r;
      const colsFull = Array.isArray(data.cols) ? data.cols : [];
      const rows = Array.isArray(data.rows) ? data.rows : [];
      chunks.push({ from, to, cols: colsFull.map((c) => String(c.name ?? c.display_name ?? '')), rows, row_count: rows.length,
                    truncated: rows.length >= METABASE_MAX_ROWS,
                    col_meta: colsFull.map((c) => ({ name: c.name ?? null, display_name: c.display_name ?? null, base_type: c.base_type ?? null })) });
    } catch (e) {
      chunks.push({ from, to, error: (e && e.message ? e.message : String(e)), rows: [], cols: [] });
    }
    from = addDays(to, 1);
  }
  out.storage = { report: REPORT, dashcard: DASHCARD, card: CARD, param: 'storage_day', chunk_days: CHUNK_DAYS, chunks,
                  rows_total: chunks.reduce((s, c) => s + (c.rows ? c.rows.length : 0), 0),
                  errors: chunks.filter((c) => c.error).map((c) => `${c.from}..${c.to}: ${c.error}`) };
  status('done');
  window.__smStorageDone = true;
  return JSON.stringify(out);
})();
