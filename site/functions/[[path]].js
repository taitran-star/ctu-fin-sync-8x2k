// Cattasaurus Dashboard — the whole server side in ONE file (Cloudflare Pages Functions catch-all).
//
// Every request to the site comes through here:
//   1. sign-in gate — two kinds of account:
//        · the OWNER: DASH_PASSWORD (Pages > Settings > Variables and Secrets, type Secret) — email left empty on the
//          sign-in page; always an admin and sees every page. Not set => the site shows a setup notice.
//        · USERS: email + their own password, stored in the Cloudflare KV namespace bound as USERS
//          (Pages > Settings > Bindings > KV namespace, variable name USERS). An admin adds a user on /users with the
//          pages (tabs) that user may see and gets an invite link (valid 7 days, single use) on which the user sets a
//          password. Password hashes = PBKDF2-SHA256 (100k rounds, per-user salt); the password itself is never stored.
//      Session = HttpOnly cookie "v2.<exp>.<who>.<pwver>.<signature>", signature = HMAC-SHA256(SESSION_SECRET or
//      DASH_PASSWORD) valid SESSION_DAYS days; a user's sessions die when their password is reset / they are deactivated
//      (pwver changes), the owner's when DASH_PASSWORD changes. The old owner cookie "<exp>.<signature>" is still accepted.
//      Wrong password => 1.5 s delay + 401. Public: /login, /logout, /invite, /robots.txt, brand files.
//   2. permissions — a user sees only the pages in their list (exec, sales, marketing, pnl, inventory, opex, data on
//      /pnl; sns = /sns) and only the /data files those pages need (VIEW_FILES); everything else answers 403.
//      /api/me tells the page who is signed in; /users + /api/users manage accounts (admins only).
//      Invite e-mails (optional): secret RESEND_API_KEY (or BREVO_API_KEY) + MAIL_FROM — see sendMail(); without a key the
//      admin copies the invite link by hand.
//   3. /data/<file>.json — the dashboards' data: the GitHub repo that the sync workflows commit to
//      (raw.githubusercontent.com), kept in the Cloudflare edge cache so a viewer never waits for GitHub when a
//      copy already exists here (see serveRepoFile: fresh / stale-while-revalidate / GitHub-first / mirror), plus
//      the invoice files that live next to this site's pages. ETag/304 to the browser end to end.
//      Optional env: GH_TOKEN (if the repo is ever made private), DATA_BASE_URL (data moved to another repo).
//   4. everything else — the static pages/files in public/ (index.html hub, pnl.html + pnl.js, icons...).
//      Brand images, icons and the open-licence fonts (/img/*, /fonts/LibreFranklin-*, /fonts/FuzzyBubbles-*) are public so the
//      login page can show them; the licensed Bureau Grot font and everything else stay behind the sign-in.
//      /sw.js (service worker for the installed app: app shell + last data for offline) is public and never cached.

const COOKIE = 'ctu_pnl_sess';
const SESSION_DAYS = 90;
const INVITE_DAYS = 7;
const PBKDF2_ROUNDS = 100000;
const MIN_PASSWORD = 10;
const EPOCH_KEY = 'meta:session_epoch';   // ms; sessions issued before it are refused ("sign out every device")
const EPOCH_CACHE_MS = 30 * 1000;         // per-isolate cache of the epoch (KV itself can lag up to ~60 s)

// Pages a user can be given. The first seven are tabs of /pnl, 'sns' is the /sns page.
const VIEWS = ['exec', 'sales', 'marketing', 'pnl', 'inventory', 'opex', 'data', 'sns'];
const VIEW_LABELS = {
  exec: 'Tổng quan (Điều hành)', sales: 'Bán hàng & khách hàng', marketing: 'Marketing', pnl: 'P&L (lãi lỗ đầy đủ)',
  inventory: 'Sản phẩm & tồn kho', opex: 'Chi phí cố định & tiền mặt', data: 'Dữ liệu (sức khoẻ nguồn)', sns: 'Amazon Subscribe & Save (/sns)',
};

const RAW_BASE = 'https://raw.githubusercontent.com/taitran-star/ctu-fin-sync-8x2k/main/data/';
const REPO_FILES = new Set([
  'amazon_pnl.json', 'meta_ads.json', 'shopify_pnl.json', 'google_ads.json',
  'shipmonk.json', 'paypal.json', 'klaviyo.json', 'amazon_ads.json', 'opex_monthly.json', 'amazon_storage.json',
  'loop_subscriptions.json', 'tiktok_shop.json', 'walmart.json', 'applovin.json', 'tiktok_ads.json',
  'targets_monthly.json',   // kế hoạch tháng + tỷ lệ giá vốn ước tính (trang Điều hành)
  'cogs_monthly.json',      // giá vốn sản phẩm THẬT theo tháng/kênh (sổ kho kế toán) — ưu tiên hơn ước tính
  'purchase_orders.json',   // hàng đang đặt (PO) nhập tay — tính vào ngày hết hàng (trang Sản phẩm & tồn kho)
  'cogs_skus.json',         // giá vốn landed theo SKU nhập tay — vốn tồn kho, lãi theo sản phẩm
  'cogs_lots.json',   // giá vốn từng lô nhập (Notion Reorder Tracker) — FIFO theo lô
  'products.json',          // dòng sản phẩm (SKU -> line) cho bộ lọc Sản phẩm
  'amazon_sns.json',   // bảng /sns (Subscribe & Save) — đừng bỏ dòng này khi sửa danh sách
]);
const STATIC_FILES = new Set(['shipmonk_invoices.json', 'shipmonk_storage_daily.json', 'klaviyo_invoices.json']);   // in public/ (read by Claude's browser); amazon_ads.json now comes from the repo (sellerboard_ads.yml)
const ALL_FILES = new Set([...REPO_FILES, ...STATIC_FILES]);
// Which /data files each page needs. Pages that show the full P&L (exec, pnl, opex, data) need every source; the
// others get the sources their own cards read. A user's files = the union over their pages.
const VIEW_FILES = {
  exec: '*', pnl: '*', opex: '*', data: '*',
  sales: ['shopify_pnl.json', 'amazon_pnl.json', 'walmart.json', 'tiktok_shop.json', 'loop_subscriptions.json', 'paypal.json', 'klaviyo.json', 'meta_ads.json', 'google_ads.json', 'targets_monthly.json', 'products.json'],
  marketing: ['meta_ads.json', 'google_ads.json', 'applovin.json', 'tiktok_ads.json', 'amazon_ads.json', 'klaviyo.json', 'klaviyo_invoices.json', 'shopify_pnl.json', 'amazon_pnl.json', 'targets_monthly.json', 'products.json'],
  inventory: ['shopify_pnl.json', 'amazon_pnl.json', 'walmart.json', 'tiktok_shop.json', 'amazon_storage.json', 'shipmonk.json', 'shipmonk_invoices.json', 'shipmonk_storage_daily.json', 'cogs_skus.json', 'cogs_lots.json', 'cogs_monthly.json', 'purchase_orders.json', 'products.json', 'targets_monthly.json'],
  sns: ['amazon_sns.json'],
};
function filesFor(views) {
  if (views.some((v) => VIEW_FILES[v] === '*')) return [...ALL_FILES];
  const out = new Set();
  views.forEach((v) => (VIEW_FILES[v] || []).forEach((f) => out.add(f)));
  return [...out];
}
// Edge copies of the repo files. Cloudflare -> raw.githubusercontent.com is sometimes very slow (minutes for a 1 KB
// file, seen 22/09/2026), so GitHub is asked only when needed and never while a viewer waits if a copy can stand in.
const MIRROR_BASE = 'https://cdn.jsdelivr.net/gh/taitran-star/ctu-fin-sync-8x2k@main/data/';   // last resort when nothing is cached (may lag GitHub by hours)
const EDGE_FRESH_MS = 5 * 60 * 1000;        // copy younger than this: served as is
const EDGE_STALE_OK_MS = 20 * 60 * 1000;    // younger than this: served at once, GitHub asked again in the background
const WAIT_COLD_MS = 90 * 1000;             // nothing cached: how long to wait for GitHub
const WAIT_WARM_MS = 12 * 1000;             // an old copy exists: how long to wait for GitHub before serving the copy
const WAIT_BG_MS = 25 * 1000;               // background refresh (runs after the answer went out)
const PUBLIC_ASSET = /^\/(img\/[\w.-]+\.(png|svg|webp)|fonts\/(LibreFranklin|FuzzyBubbles)[\w-]*\.woff2|favicon\.png|apple-touch-icon\.png|icon-[\w-]+\.png)$/;
const LONG_CACHE = /^\/(img|fonts|splash)\/|^\/(favicon\.png|apple-touch-icon\.png|icon-[\w-]+\.png)$/;   // immutable brand files

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain' } });
  if (path === '/sw.js') return asset(await env.ASSETS.fetch(request), 'no-cache');   // service worker: public, always revalidated so updates land
  if (PUBLIC_ASSET.test(path)) return asset(await env.ASSETS.fetch(request), 'public, max-age=604800');
  if (!env.DASH_PASSWORD) return setupPage();
  if (path === '/login') return request.method === 'POST' ? handleLogin(request, env, url) : loginPage(url, null, 200, '');
  if (path === '/logout') return logout(url);
  if (path === '/invite') return request.method === 'POST' ? handleInviteAccept(request, env, url) : invitePage(request, env, url, null);

  const me = await currentUser(request, env);
  if (!me) {
    if (path.startsWith('/data/') || path.startsWith('/api/')) return json({ error: 'unauthorized' }, 401);
    return loginPage(url, null, 401, '');
  }

  if (path.startsWith('/api/')) return handleApi(path, request, env, url, me);
  if (path === '/users' || path === '/users.html') return me.admin ? usersPage(me, env) : forbiddenPage(me);
  if (path.startsWith('/data/')) {
    const name = decodeURIComponent(path.slice('/data/'.length));
    if (!me.files.has(name)) return json({ error: ALL_FILES.has(name) ? 'forbidden' : 'unknown source' }, ALL_FILES.has(name) ? 403 : 404);
    return asset(await serveData(name, request, env, context), 'private, no-cache');
  }
  if ((path === '/sns' || path === '/sns.html') && !me.views.includes('sns')) return forbiddenPage(me);
  if ((path === '/pnl' || path === '/pnl.html') && !me.views.some((v) => v !== 'sns')) return forbiddenPage(me);
  const res = await env.ASSETS.fetch(request);
  // pages always revalidate (ETag: a 304 costs nothing); brand files (fonts, images) are cached for a week
  return asset(res, LONG_CACHE.test(path) ? 'private, max-age=604800' : 'private, no-cache');
}

function asset(res, cacheControl) {
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', cacheControl);
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  headers.set('Referrer-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
// ---------- /data/<file>.json ----------
// Conditional requests end to end: the browser keeps the last copy and sends If-None-Match; when the file
// has not changed we answer 304 and nothing is downloaded again (the big files are 2-5 MB).
async function serveData(name, request, env, context) {
  // name is already decoded and allowed for this user (onRequest)
  const inm = request.headers.get('If-None-Match') || '';

  if (STATIC_FILES.has(name)) {
    const req = new Request(new URL('/' + name, request.url).toString(), { headers: inm ? { 'If-None-Match': inm } : {} });
    const res = await env.ASSETS.fetch(req);
    if (res.status === 304) return notModified(inm);
    if (res.ok) return new Response(res.body, { status: 200, headers: jsonHeaders('static', res.headers.get('ETag')) });
    if (!REPO_FILES.has(name)) return json({ error: 'static file missing: ' + name }, 404);   // else fall through to the repo copy
  }
  if (!REPO_FILES.has(name)) return json({ error: 'unknown source' }, 404);
  const fromR2 = await serveFromR2(name, request, env);
  if (fromR2) return fromR2;
  return serveRepoFile(name, request, env, context, inm);
}

// Cloudflare R2 copy of data/ (bucket bound as DATA in Pages > Settings > Bindings; filled by the repo workflow
// publish_data_r2.yml within a minute of every sync commit). Same network as this function: fast and never throttled.
// No binding / object missing / error -> null, and the GitHub path below takes over.
async function serveFromR2(name, request, env) {
  if (!env.DATA || typeof env.DATA.get !== 'function') return null;
  try {
    const obj = await env.DATA.get('data/' + name, { onlyIf: request.headers });
    if (!obj) return null;
    const etag = obj.httpEtag || '';
    if (!obj.body) return notModified(etag);   // If-None-Match matched: unchanged
    const h = jsonHeaders('r2', etag);
    h['X-Data-Age'] = '0';   // the bucket copy IS the current file (re-uploaded whenever the repo file changes)
    if (obj.uploaded) h['X-Data-Uploaded-At'] = obj.uploaded.toISOString();
    return new Response(obj.body, { status: 200, headers: h });
  } catch (e) {
    return null;
  }
}

// A repo file, from the edge copy when one exists:
//   copy < EDGE_FRESH_MS      -> served as is                          (X-Data-Source: edge)
//   copy < EDGE_STALE_OK_MS   -> served at once, refreshed in the background  (edge-stale)
//   older copy                -> GitHub asked first (WAIT_WARM_MS), the copy is the fallback
//   no copy                   -> GitHub (WAIT_COLD_MS), then the jsDelivr mirror, else 502
async function serveRepoFile(name, request, env, context, inm) {
  const edge = edgeCache(name, request);
  let hit = null;
  if (edge) { try { hit = await edge.cache.match(edge.key); } catch (e) { hit = null; } }
  const age = hit ? Date.now() - Number(hit.headers.get('X-Fetched-At') || 0) : Infinity;
  if (hit && age < EDGE_FRESH_MS) return answer(hit, inm, 'edge', age);
  if (hit && age < EDGE_STALE_OK_MS) {
    later(context, refreshEdge(name, env, edge, WAIT_BG_MS));
    return answer(hit, inm, 'edge-stale', age);
  }
  const got = await fetchUpstream(name, env, hit ? WAIT_WARM_MS : WAIT_COLD_MS, !hit);
  if (got.buf) {
    const stored = makeStored(got);
    if (edge) later(context, edge.cache.put(edge.key, stored.clone()).catch(() => {}));
    return answer(stored, inm, got.source, 0);
  }
  if (hit) {
    later(context, refreshEdge(name, env, edge, WAIT_BG_MS));
    return answer(hit, inm, 'edge-stale', age);
  }
  if (got.status === 404) return json({ error: 'not in repo yet: ' + name }, 404);
  return json({ error: got.error || 'upstream failed' }, 502);
}

function edgeCache(name, request) {
  try {
    if (typeof caches === 'undefined' || !caches.default) return null;
    return { cache: caches.default, key: new Request(new URL('/__edge/data/' + name, request.url).toString()) };
  } catch (e) { return null; }
}

function later(context, promise) {
  const p = Promise.resolve(promise).catch(() => {});
  if (context && typeof context.waitUntil === 'function') context.waitUntil(p);
}

async function refreshEdge(name, env, edge, waitMs) {
  if (!edge) return;
  const got = await fetchUpstream(name, env, waitMs, false);   // GitHub only: the mirror may be older than what is cached
  if (got.buf) await edge.cache.put(edge.key, makeStored(got));
}

function makeStored(got) {
  return new Response(got.buf, { status: 200, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, s-maxage=604800',   // stays at this edge location up to a week; freshness is decided by X-Fetched-At
    'ETag': got.etag, 'X-Fetched-At': String(Date.now()), 'X-Data-Origin': got.source,
  } });
}

// One complete copy of the file: GitHub first, the mirror only when allowed. Never throws.
async function fetchUpstream(name, env, waitMs, allowMirror) {
  const base = env.DATA_BASE_URL || RAW_BASE;
  const headers = { 'User-Agent': 'cattasaurus-dashboard' };
  if (env.GH_TOKEN) headers['Authorization'] = 'token ' + env.GH_TOKEN;
  const first = await fetchComplete(base + name, headers, waitMs, 'github');
  if (first.buf || first.status === 404 || !allowMirror) return first;
  const second = await fetchComplete(MIRROR_BASE + name, { 'User-Agent': 'cattasaurus-dashboard' }, Math.min(waitMs, 30000), 'mirror');
  return second.buf ? second : first;
}

async function fetchComplete(url, headers, waitMs, source) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), waitMs);
  try {
    const r = await fetch(url, { headers, signal: ctl.signal });
    if (r.status === 404) return { error: 'not found', status: 404 };
    if (!r.ok) return { error: source + ' HTTP ' + r.status, status: r.status };
    const buf = await r.arrayBuffer();
    const declared = Number(r.headers.get('Content-Length') || 0);
    if ((declared && declared !== buf.byteLength) || !looksComplete(buf)) return { error: source + ' answer incomplete' };
    const etag = r.headers.get('ETag') || ('W/"' + buf.byteLength + '-' + Date.now() + '"');
    return { buf, etag, source };
  } catch (e) {
    return { error: source + ' ' + (e && e.name === 'AbortError' ? 'timeout after ' + Math.round(waitMs / 1000) + 's' : 'fetch failed') };
  } finally {
    clearTimeout(timer);
  }
}

// cheap check (no JSON.parse of a 5 MB file on the edge): the body ends with } or ]
function looksComplete(buf) {
  const n = buf.byteLength;
  if (!n) return false;
  const tail = new Uint8Array(buf, Math.max(0, n - 32), Math.min(32, n));
  let i = tail.length - 1;
  while (i >= 0 && (tail[i] === 10 || tail[i] === 13 || tail[i] === 32 || tail[i] === 9)) i--;
  return i >= 0 && (tail[i] === 125 || tail[i] === 93);
}

function answer(res, inm, source, ageMs) {
  const etag = res.headers.get('ETag') || '';
  const h = jsonHeaders(source, etag);
  h['X-Data-Age'] = String(Math.round(ageMs / 1000));
  const fetchedAt = Number(res.headers.get('X-Fetched-At') || 0);
  if (fetchedAt) h['X-Data-Fetched-At'] = new Date(fetchedAt).toISOString();
  if (etag && inm && inm === etag) { delete h['Content-Type']; return new Response(null, { status: 304, headers: h }); }
  return new Response(res.body, { status: 200, headers: h });
}

function notModified(etag) {
  const h = { 'Cache-Control': 'private, no-cache' };
  if (etag) h['ETag'] = etag;
  return new Response(null, { status: 304, headers: h });
}

function jsonHeaders(source, etag) {
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-cache', 'X-Data-Source': source };
  if (etag) h['ETag'] = etag;
  return h;
}

// ---------- who is signed in ----------
// Returns null (nobody) or { kind:'owner'|'user', email, name, admin, views:[...], files:Set }.
async function currentUser(request, env) {
  const raw = parseCookies(request.headers.get('Cookie') || '')[COOKIE];
  if (!raw) return null;
  if (raw.startsWith('v2.')) {
    const p = raw.split('.');
    if (p.length !== 5) return null;
    const exp = Number(p[1]), sub = p[2], ver = p[3], sig = p[4];
    if (!Number.isFinite(exp) || exp < Date.now()) return null;
    const want = await hmac(secretOf(env), 'sess2|' + exp + '|' + sub + '|' + ver);
    if (!(await safeEqual(secretOf(env), sig, want))) return null;
    const epoch = await sessionEpoch(env);
    if (epoch && exp - SESSION_DAYS * 86400000 < epoch) return null;   // issued before "sign out every device"
    if (sub === 'owner') return ownerIdentity();
    const email = b64uDecode(sub);
    const u = await getUser(env, email);
    if (!u || !u.active || String(u.pwver || 0) !== ver || !u.hash) return null;   // deactivated / password reset / never set
    return userIdentity(u);
  }
  // legacy owner cookie "exp.sig" signed with DASH_PASSWORD — accepted only until the first "sign out every device"
  const i = raw.indexOf('.');
  if (i < 0) return null;
  if (await sessionEpoch(env)) return null;
  const exp = Number(raw.slice(0, i));
  const sig = raw.slice(i + 1);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  const want = await hmac(env.DASH_PASSWORD, 'sess|' + exp);
  return (await safeEqual(env.DASH_PASSWORD, sig, want)) ? ownerIdentity() : null;
}

function secretOf(env) { return env.SESSION_SECRET || env.DASH_PASSWORD; }

// ---------- "sign out every device" (KV meta:session_epoch) ----------
let epochCache = { store: null, v: 0, at: 0 };
async function sessionEpoch(env, fresh) {
  const store = kv(env);
  if (!store) return 0;
  if (!fresh && epochCache.store === store && Date.now() - epochCache.at < EPOCH_CACHE_MS) return epochCache.v;
  let v = 0;
  try { v = Number(await store.get(EPOCH_KEY)) || 0; } catch (e) { v = epochCache.store === store ? epochCache.v : 0; }
  epochCache = { store, v, at: Date.now() };
  return v;
}
async function revokeAllSessions(env) {
  const store = kv(env);
  const v = Date.now();
  await store.put(EPOCH_KEY, String(v));
  epochCache = { store, v, at: Date.now() };
  return v;
}

function ownerIdentity() {
  return { kind: 'owner', email: '', name: 'Chủ dashboard (mật khẩu chung)', admin: true, views: VIEWS.slice(), files: new Set(ALL_FILES) };
}
function userIdentity(u) {
  const views = (u.views || []).filter((v) => VIEWS.includes(v));
  return { kind: 'user', email: u.email, name: u.name || u.email, admin: !!u.admin, views, files: new Set(filesFor(views)) };
}
function publicMe(me) {
  return { kind: me.kind, email: me.email, name: me.name, admin: me.admin, views: me.views, files: [...me.files], views_all: VIEWS, view_labels: VIEW_LABELS };
}

async function sessionCookie(env, sub, ver, url) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const token = 'v2.' + exp + '.' + sub + '.' + ver + '.' + (await hmac(secretOf(env), 'sess2|' + exp + '|' + sub + '|' + ver));
  return cookie(token, SESSION_DAYS * 86400, url);
}

// ---------- user store (Cloudflare KV, binding USERS) ----------
// key "u:<email>" -> {email, name, views, admin, active, pwver, hash, salt, created_at, created_by, invited_at, last_login}
function kv(env) { return env.USERS && typeof env.USERS.get === 'function' ? env.USERS : null; }
function normEmail(s) { return String(s || '').trim().toLowerCase(); }
function validEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 254; }

async function getUser(env, email) {
  const store = kv(env);
  if (!store) return null;
  email = normEmail(email);
  if (!validEmail(email)) return null;
  try { return await store.get('u:' + email, 'json'); } catch (e) { return null; }
}
async function putUser(env, u) {
  const store = kv(env);
  if (!store) throw new Error('no KV');
  await store.put('u:' + u.email, JSON.stringify(u), { metadata: { name: u.name, admin: !!u.admin, active: !!u.active } });
}
async function listUsers(env) {
  const store = kv(env);
  if (!store) return [];
  const out = [];
  let cursor;
  do {
    const page = await store.list({ prefix: 'u:', cursor });
    for (const k of page.keys) {
      const u = await store.get(k.name, 'json');
      if (u) out.push(u);
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  out.sort((a, b) => (a.email < b.email ? -1 : 1));
  return out;
}
function userSummary(u) {
  return { email: u.email, name: u.name || '', views: (u.views || []).filter((v) => VIEWS.includes(v)), admin: !!u.admin, active: !!u.active,
    has_password: !!u.hash, created_at: u.created_at || null, created_by: u.created_by || null, invited_at: u.invited_at || null, last_login: u.last_login || null };
}

// ---------- passwords (PBKDF2-SHA256) ----------
async function hashPassword(password, saltB64u) {
  const salt = saltB64u ? b64uToBytes(saltB64u) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ROUNDS }, key, 256);
  return { hash: bytesToB64u(new Uint8Array(bits)), salt: bytesToB64u(salt) };
}
async function verifyPassword(u, password) {
  if (!u || !u.hash || !u.salt || !password) return false;
  const got = await hashPassword(password, u.salt);
  return safeEqual(u.salt + '|' + u.email, got.hash, u.hash);
}

// ---------- invite / reset links (stateless, HMAC-signed, single use via pwver) ----------
async function inviteToken(env, email, pwver) {
  const exp = Date.now() + INVITE_DAYS * 86400000;
  const sub = b64uEncode(email);
  return 'i1.' + exp + '.' + sub + '.' + pwver + '.' + (await hmac(secretOf(env), 'inv|' + exp + '|' + sub + '|' + pwver));
}
async function readInvite(env, token) {
  const p = String(token || '').split('.');
  if (p.length !== 5 || p[0] !== 'i1') return { error: 'Link mời không hợp lệ.' };
  const exp = Number(p[1]);
  if (!Number.isFinite(exp)) return { error: 'Link mời không hợp lệ.' };
  const want = await hmac(secretOf(env), 'inv|' + exp + '|' + p[2] + '|' + p[3]);
  if (!(await safeEqual(secretOf(env), p[4], want))) return { error: 'Link mời không hợp lệ.' };
  if (exp < Date.now()) return { error: 'Link mời đã hết hạn (' + INVITE_DAYS + ' ngày). Nhờ admin gửi link mới.' };
  const email = b64uDecode(p[2]);
  const u = await getUser(env, email);
  if (!u) return { error: kv(env) ? 'Tài khoản này không còn tồn tại.' : 'Chưa cấu hình kho user (KV USERS).' };
  if (String(u.pwver || 0) !== p[3]) return { error: 'Link mời này đã được dùng hoặc đã có link mới hơn. Nhờ admin gửi link mới.' };
  if (!u.active) return { error: 'Tài khoản đang bị tắt. Nhờ admin bật lại.' };
  return { user: u, exp };
}

// ---------- login / logout ----------
async function handleLogin(request, env, url) {
  let email = '', pw = '';
  try {
    const form = await request.formData();
    email = normEmail(form.get('email'));
    pw = String(form.get('password') || '');
  } catch (e) { pw = ''; }
  const fail = async (msg) => { await new Promise((r) => setTimeout(r, 1500)); return loginPage(url, msg, 401, email); };
  if (!pw) return fail('Nhập mật khẩu.');
  if (!email) {
    // owner: the shared DASH_PASSWORD
    if (!(await safeEqual(env.DASH_PASSWORD, pw, env.DASH_PASSWORD))) return fail('Mật khẩu chưa đúng, thử lại.');
    return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': await sessionCookie(env, 'owner', '0', url) } });
  }
  if (!validEmail(email)) return fail('Email chưa đúng định dạng.');
  if (!kv(env)) return fail('Đăng nhập bằng email chưa bật (chưa có KV USERS). Dùng mật khẩu chung với ô email để trống.');
  const u = await getUser(env, email);
  if (!u || !u.active || !u.hash) return fail(u && !u.hash ? 'Tài khoản chưa đặt mật khẩu — mở link mời admin đã gửi.' : 'Email hoặc mật khẩu chưa đúng.');
  if (!(await verifyPassword(u, pw))) return fail('Email hoặc mật khẩu chưa đúng.');
  u.last_login = new Date().toISOString();
  try { await putUser(env, u); } catch (e) { /* login still fine */ }
  return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': await sessionCookie(env, b64uEncode(u.email), String(u.pwver || 0), url) } });
}

function logout(url) {
  return new Response(null, { status: 303, headers: { Location: '/login', 'Set-Cookie': cookie('', 0, url) } });
}

function cookie(value, maxAge, url) {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

function parseCookies(header) {
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  });
  return out;
}

// ---------- /invite — the user sets their password ----------
async function invitePage(request, env, url, error) {
  const t = url.searchParams.get('t') || '';
  const r = await readInvite(env, t);
  if (r.error) return messagePage('Link mời', r.error, 400, 'mascot-shy.png', 'meow… link này không mở được');
  const u = r.user;
  const body = `<form class="card" method="post" action="/invite" autocomplete="on">
  <input type="hidden" name="t" value="${escapeHtml(t)}">
  <div class="band"><div class="band-text"><div class="eyebrow">Dashboard nội bộ</div><img class="wm light" src="/img/logo-h-pine.png" alt="Cattasaurus" width="1000" height="327"><img class="wm dark" src="/img/logo-h-pistachio.png" alt="" aria-hidden="true" width="1000" height="327"><div class="fun">meow… chào ${escapeHtml(u.name || u.email)}</div></div><img class="mascot" src="/img/mascot-curious.png" alt="" aria-hidden="true" width="556" height="720"></div>
  <div class="body">
  <h1>${u.hash ? 'Đặt lại mật khẩu' : 'Tạo mật khẩu'}</h1>
  <p>Tài khoản <b>${escapeHtml(u.email)}</b>${u.views && u.views.length ? ' — được xem: ' + escapeHtml(u.views.map((v) => VIEW_LABELS[v] || v).join(', ')) : ''}.</p>
  <label for="password">Mật khẩu mới (≥ ${MIN_PASSWORD} ký tự)</label>
  <input id="password" name="password" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD}" required>
  <label for="password2" style="margin-top:12px">Nhập lại</label>
  <input id="password2" name="password2" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD}" enterkeyhint="go" required>
  ${error ? `<div class="err" role="alert">${escapeHtml(error)}</div>` : ''}
  <button type="submit">Lưu &amp; vào xem</button>
  <div class="foot">Link này dùng được 1 lần, hết hạn ${new Date(r.exp).toLocaleDateString('vi-VN')}.</div>
  </div>
</form>`;
  return shell('Cattasaurus Dashboard — tạo mật khẩu', body, 200);
}

async function handleInviteAccept(request, env, url) {
  let t = '', p1 = '', p2 = '';
  try {
    const form = await request.formData();
    t = String(form.get('t') || ''); p1 = String(form.get('password') || ''); p2 = String(form.get('password2') || '');
  } catch (e) { /* empty */ }
  const r = await readInvite(env, t);
  if (r.error) return messagePage('Link mời', r.error, 400, 'mascot-shy.png', 'meow… link này không mở được');
  url.searchParams.set('t', t);
  if (p1.length < MIN_PASSWORD) return invitePage(request, env, url, 'Mật khẩu cần ít nhất ' + MIN_PASSWORD + ' ký tự.');
  if (p1 !== p2) return invitePage(request, env, url, 'Hai lần nhập chưa giống nhau.');
  const u = r.user;
  const h = await hashPassword(p1);
  u.hash = h.hash; u.salt = h.salt; u.pwver = (u.pwver || 0) + 1; u.active = true;
  u.password_set_at = new Date().toISOString(); u.last_login = u.password_set_at;
  await putUser(env, u);
  return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': await sessionCookie(env, b64uEncode(u.email), String(u.pwver), url) } });
}

// ---------- /api/* (JSON; the X-Requested-With header keeps plain cross-site forms out) ----------
async function handleApi(path, request, env, url, me) {
  if (request.headers.get('X-Requested-With') !== 'ctu') return json({ error: 'bad request' }, 400);
  if (path === '/api/me') return json({ me: publicMe(me), users_enabled: !!kv(env), mail_enabled: mailEnabled(env) }, 200);
  if (!me.admin) return json({ error: 'forbidden' }, 403);
  if (path === '/api/sessions/revoke') {
    if (request.method !== 'POST') return json({ error: 'method' }, 405);
    if (!kv(env)) return json({ error: 'Chưa gắn kho user (KV USERS).' }, 503);
    const epoch = await revokeAllSessions(env);
    // the admin who pressed the button keeps a fresh session on this browser
    let setCookie;
    if (me.kind === 'owner') setCookie = await sessionCookie(env, 'owner', '0', url);
    else { const self = await getUser(env, me.email); setCookie = await sessionCookie(env, b64uEncode(me.email), String((self && self.pwver) || 0), url); }
    return new Response(JSON.stringify({ ok: true, session_epoch: new Date(epoch).toISOString() }), { status: 200, headers: { ...jsonHeaders('api'), 'Set-Cookie': setCookie } });
  }
  if (!path.startsWith('/api/users')) return json({ error: 'not found' }, 404);
  if (!kv(env)) return json({ error: 'KV USERS chưa được gắn vào dự án (Pages → Settings → Bindings → KV namespace, tên biến USERS) rồi Retry deployment.' }, 503);
  const m = path.match(/^\/api\/users(?:\/([^/]+)(?:\/(invite))?)?$/);
  if (!m) return json({ error: 'not found' }, 404);
  const target = m[1] ? normEmail(decodeURIComponent(m[1])) : null;
  const action = m[2] || null;
  let body = {};
  if (request.method === 'POST' || request.method === 'PUT') { try { body = await request.json(); } catch (e) { body = {}; } }
  const origin = url.origin;

  if (!target) {
    if (request.method === 'GET') {
      const ep = await sessionEpoch(env, true);
      return json({ users: (await listUsers(env)).map(userSummary), views: VIEWS, labels: VIEW_LABELS, session_epoch: ep ? new Date(ep).toISOString() : null }, 200);
    }
    if (request.method === 'POST') {
      const email = normEmail(body.email);
      if (!validEmail(email)) return json({ error: 'Email chưa đúng định dạng.' }, 400);
      if (await getUser(env, email)) return json({ error: 'Email này đã có tài khoản.' }, 409);
      const views = cleanViews(body.views);
      if (!views.length) return json({ error: 'Chọn ít nhất một trang cho user.' }, 400);
      const now = new Date().toISOString();
      const u = { email, name: String(body.name || '').trim().slice(0, 80), views, admin: !!body.admin, active: true, pwver: 0, hash: null, salt: null,
        created_at: now, created_by: me.email || 'owner', invited_at: now, last_login: null };
      await putUser(env, u);
      const token = await inviteToken(env, email, 0);
      const link = origin + '/invite?t=' + token;
      const sent = body.send_email === false ? null : await sendInvite(env, u, link, false, me);
      return json({ user: userSummary(u), invite_url: link, invite_days: INVITE_DAYS, emailed: !!(sent && sent.ok), email_error: sent && !sent.ok ? sent.error : null }, 201);
    }
    return json({ error: 'method' }, 405);
  }
  const u = await getUser(env, target);
  if (!u) return json({ error: 'Không có user này.' }, 404);
  const self = me.kind === 'user' && me.email === u.email;
  if (action === 'invite' && request.method === 'POST') {
    // new invite / password-reset link; the old link and (on use) every session of this user die with the new pwver
    u.invited_at = new Date().toISOString();
    await putUser(env, u);
    const token = await inviteToken(env, u.email, u.pwver || 0);
    const link = origin + '/invite?t=' + token;
    const sent = body.send_email === false ? null : await sendInvite(env, u, link, !!u.hash, me);
    return json({ user: userSummary(u), invite_url: link, invite_days: INVITE_DAYS, emailed: !!(sent && sent.ok), email_error: sent && !sent.ok ? sent.error : null }, 200);
  }
  if (!action && request.method === 'PUT') {
    if ('name' in body) u.name = String(body.name || '').trim().slice(0, 80);
    if ('views' in body) { const v = cleanViews(body.views); if (!v.length) return json({ error: 'Chọn ít nhất một trang cho user.' }, 400); u.views = v; }
    if ('admin' in body) { if (self && !body.admin) return json({ error: 'Không tự bỏ quyền admin của chính mình.' }, 400); u.admin = !!body.admin; }
    if ('active' in body) { if (self && !body.active) return json({ error: 'Không tự tắt tài khoản của chính mình.' }, 400); u.active = !!body.active; if (!u.active) u.pwver = (u.pwver || 0) + 1; }   // deactivating logs the user out everywhere
    await putUser(env, u);
    return json({ user: userSummary(u) }, 200);
  }
  if (!action && request.method === 'DELETE') {
    if (self) return json({ error: 'Không tự xoá tài khoản của chính mình.' }, 400);
    await kv(env).delete('u:' + u.email);
    return json({ ok: true }, 200);
  }
  return json({ error: 'method' }, 405);
}
function cleanViews(v) { return Array.isArray(v) ? VIEWS.filter((x) => v.includes(x)) : []; }

// ---------- invite e-mail (optional) ----------
// Provider = whichever secret exists: RESEND_API_KEY (https://resend.com, domain verified in DNS) or BREVO_API_KEY
// (https://brevo.com, sender verified). MAIL_FROM = 'Name <address>' (default dashboard@cattasaurus.com). No key -> the admin
// page shows the link to copy by hand. Nothing is sent unless an admin creates / re-invites a user.
function mailEnabled(env) { return !!(env.RESEND_API_KEY || env.BREVO_API_KEY); }
async function sendMail(env, to, subject, text, html) {
  const from = String(env.MAIL_FROM || 'Cattasaurus Dashboard <dashboard@cattasaurus.com>');
  try {
    if (env.RESEND_API_KEY) {
      const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [to], subject, text, html }) });
      if (r.ok) return { ok: true, via: 'resend' };
      return { ok: false, error: 'Resend HTTP ' + r.status + ': ' + (await r.text()).slice(0, 240) };
    }
    if (env.BREVO_API_KEY) {
      const m = from.match(/^(.*?)\s*<([^>]+)>$/);
      const sender = m ? { name: m[1].trim() || 'Cattasaurus Dashboard', email: m[2].trim() } : { email: from };
      const r = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify({ sender, to: [{ email: to }], subject, textContent: text, htmlContent: html }) });
      if (r.ok) return { ok: true, via: 'brevo' };
      return { ok: false, error: 'Brevo HTTP ' + r.status + ': ' + (await r.text()).slice(0, 240) };
    }
    return { ok: false, error: 'Chưa cấu hình gửi email (Secret RESEND_API_KEY hoặc BREVO_API_KEY trên Cloudflare).' };
  } catch (e) {
    return { ok: false, error: 'Gửi email lỗi: ' + ((e && e.message) || e) };
  }
}
async function sendInvite(env, u, link, isReset, by) {
  if (!mailEnabled(env)) return { ok: false, error: 'Chưa cấu hình gửi email (Secret RESEND_API_KEY hoặc BREVO_API_KEY trên Cloudflare).' };
  const name = u.name || u.email;
  const pages = (u.views || []).map((v) => VIEW_LABELS[v] || v).join(', ');
  const who = by && by.email ? by.email : 'Admin';
  const subject = isReset ? 'Đặt lại mật khẩu — Cattasaurus Dashboard' : 'Mời bạn vào Cattasaurus Dashboard';
  const intro = isReset ? `${who} vừa tạo link đặt lại mật khẩu cho tài khoản ${u.email} trên dashboard số liệu nội bộ của Cattasaurus.`
    : `${who} mời bạn vào dashboard số liệu nội bộ của Cattasaurus với tài khoản ${u.email}.`;
  const text = `Chào ${name},\n\n${intro}\n${pages ? 'Bạn được xem: ' + pages + '.\n' : ''}\nBấm link dưới đây để ${isReset ? 'đặt mật khẩu mới' : 'tạo mật khẩu'} rồi vào xem (link dùng 1 lần, hết hạn sau ${INVITE_DAYS} ngày):\n${link}\n\nSau đó đăng nhập tại https://dashboard.cattasaurus.com/login bằng email + mật khẩu của bạn.\nNếu bạn không mong đợi email này, hãy bỏ qua.\n\n— Cattasaurus Dashboard`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#05372E;max-width:560px">
<p>Chào <b>${escapeHtml(name)}</b>,</p>
<p>${escapeHtml(intro)}${pages ? '<br>Bạn được xem: <b>' + escapeHtml(pages) + '</b>.' : ''}</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#05372E;color:#C9E595;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">${isReset ? 'Đặt mật khẩu mới' : 'Tạo mật khẩu & vào xem'}</a></p>
<p style="font-size:13px;color:#33544a">Link dùng 1 lần, hết hạn sau ${INVITE_DAYS} ngày. Nếu nút không bấm được, mở link này: <a href="${escapeHtml(link)}">${escapeHtml(link)}</a><br>Sau đó đăng nhập tại <a href="https://dashboard.cattasaurus.com/login">dashboard.cattasaurus.com</a> bằng email + mật khẩu của bạn. Nếu bạn không mong đợi email này, hãy bỏ qua.</p>
<p style="font-size:13px;color:#33544a">— Cattasaurus Dashboard</p></div>`;
  return sendMail(env, u.email, subject, text, html);
}

// ---------- crypto helpers ----------
const enc = (s) => new TextEncoder().encode(s);

function bytesToB64u(bytes) {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64uToBytes(s) {
  s = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64uEncode(str) { return bytesToB64u(enc(str)); }
function b64uDecode(s) { try { return new TextDecoder().decode(b64uToBytes(s)); } catch (e) { return ''; } }

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc(message)));
  return bytesToB64u(sig);
}

// Compare through HMAC so the comparison never leaks the length or bytes of the secret.
async function safeEqual(key, a, b) {
  const ha = await hmac(key, 'cmp|' + a);
  const hb = await hmac(key, 'cmp|' + b);
  if (ha.length !== hb.length) return false;
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ---------- pages ----------
function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: jsonHeaders('error') });
}

const PAGE_CSS = `
  @font-face{font-family:'Libre Franklin';font-weight:100 500;font-style:normal;font-display:swap;src:url(/fonts/LibreFranklin-Regular.woff2) format('woff2');}
  @font-face{font-family:'Libre Franklin';font-weight:600 900;font-style:normal;font-display:swap;src:url(/fonts/LibreFranklin-SemiBold.woff2) format('woff2');}
  @font-face{font-family:'Fuzzy Bubbles';font-weight:700;font-style:normal;font-display:swap;src:url(/fonts/FuzzyBubbles-Bold.woff2) format('woff2');}
  :root{color-scheme:light;--pistachio:#C9E595;--pine:#05372E;--forest:#285D18;--band-bg:#C9E595;--band-ink:#05372E;--bg:#f2f6e6;--card:#ffffff;--ink:#05372E;--muted:#33544a;--border:rgba(5,55,46,.14);--solid:#05372E;--solid-ink:#C9E595;--bad:#b3261e;--ok:#285D18;--chip:rgba(5,55,46,.07);}
  @media (prefers-color-scheme:dark){:root{color-scheme:dark;--band-bg:#05372E;--band-ink:#C9E595;--bg:#0b1f1b;--card:#123029;--ink:#eef5df;--muted:#c3d3b3;--border:rgba(201,229,149,.16);--solid:#C9E595;--solid-ink:#05372E;--forest:#b9da7a;--bad:#f06a6a;--ok:#b9da7a;--chip:rgba(201,229,149,.10);}}
  *{box-sizing:border-box} html,body{height:100%}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 'Libre Franklin',system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;}
  body.auth{display:flex;align-items:center;justify-content:center;padding:24px 16px;padding-top:calc(24px + env(safe-area-inset-top,0px));}
  .card{width:100%;max-width:420px;background:var(--card);border:1px solid var(--border);border-radius:18px;overflow:hidden;box-shadow:0 12px 40px rgba(5,55,46,.10);}
  .band{background:var(--band-bg);color:var(--band-ink);padding:20px 22px 0;display:flex;align-items:flex-end;justify-content:space-between;gap:12px;}
  .band-text{padding-bottom:18px;min-width:0;}
  .eyebrow{font-weight:600;font-size:11px;letter-spacing:.16em;text-transform:uppercase;opacity:.85;}
  .wm{display:block;height:48px;width:auto;margin-top:10px;}
  .wm.dark{display:none;}
  @media (prefers-color-scheme:dark){.wm.light{display:none}.wm.dark{display:block}}
  .mascot{display:block;height:124px;width:auto;flex:none;margin-right:6px;}
  .fun{font-family:'Fuzzy Bubbles','Comic Sans MS',cursive;font-size:16px;color:var(--forest);margin-top:8px;}
  .body{padding:20px 24px 22px;}
  .card h1{font-weight:600;font-size:14px;text-transform:uppercase;letter-spacing:.06em;margin:0 0 4px;color:var(--forest);}
  .card p{margin:0 0 16px;color:var(--muted);font-size:14px}
  .card label{display:block;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
  .card input{width:100%;font:inherit;font-size:17px;padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:transparent;color:var(--ink);}
  .card input:focus{outline:2px solid var(--forest);outline-offset:1px;border-color:transparent}
  .card button{width:100%;margin-top:14px;font:inherit;font-weight:700;font-size:15px;letter-spacing:.04em;text-transform:uppercase;padding:13px;border:0;border-radius:10px;background:var(--solid);color:var(--solid-ink);cursor:pointer}
  .card button:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
  .err{color:var(--bad);font-size:14px;margin:12px 0 0;font-weight:500}
  .foot{margin-top:16px;font-size:12px;color:var(--muted)}
  .foot a{color:var(--forest)}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
`;

function shell(title, body, status, extraHead, bodyClass) {
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><title>${title}</title><link rel="icon" type="image/png" sizes="64x64" href="/favicon.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><meta name="theme-color" content="#f2f6e6" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#0b1f1b" media="(prefers-color-scheme: dark)"><style>${PAGE_CSS}</style>${extraHead || ''}</head><body class="${bodyClass || 'auth'}">${body}</body></html>`;
  return new Response(html, { status: status || 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
}

function loginPage(url, error, status, email) {
  const body = `<form class="card" method="post" action="/login" autocomplete="on">
  <div class="band"><div class="band-text"><div class="eyebrow">Dashboard nội bộ</div><img class="wm light" src="/img/logo-h-pine.png" alt="Cattasaurus" width="1000" height="327"><img class="wm dark" src="/img/logo-h-pistachio.png" alt="" aria-hidden="true" width="1000" height="327"><div class="fun">meow… ai đó?</div></div><img class="mascot" src="/img/mascot-curious.png" alt="" aria-hidden="true" width="556" height="720"></div>
  <div class="body">
  <h1>Đăng nhập</h1>
  <p>Trang nội bộ — nhập email và mật khẩu của bạn. Chủ dashboard: để trống email, nhập mật khẩu chung.</p>
  <label for="email">Email</label>
  <input id="email" name="email" type="email" autocomplete="username" inputmode="email" autocapitalize="off" spellcheck="false" value="${escapeHtml(email || '')}" placeholder="ten@cattasaurus.com">
  <label for="password" style="margin-top:12px">Mật khẩu</label>
  <input id="password" name="password" type="password" autocomplete="current-password" enterkeyhint="go" required>
  ${error ? `<div class="err" role="alert">${escapeHtml(error)}</div>` : ''}
  <button type="submit">Vào xem</button>
  <div class="foot">Phiên đăng nhập giữ ${SESSION_DAYS} ngày trên thiết bị này. Quên mật khẩu: nhờ admin gửi link đặt lại.</div>
  </div>
</form>`;
  return shell('Cattasaurus Dashboard — đăng nhập', body, status || 200);
}

function messagePage(title, text, status, mascot, fun) {
  const body = `<div class="card">
  <div class="band"><div class="band-text"><div class="eyebrow">Dashboard nội bộ</div><img class="wm light" src="/img/logo-h-pine.png" alt="Cattasaurus" width="1000" height="327"><img class="wm dark" src="/img/logo-h-pistachio.png" alt="" aria-hidden="true" width="1000" height="327"><div class="fun">${escapeHtml(fun || 'meow…')}</div></div><img class="mascot" src="/img/${mascot || 'mascot-shy.png'}" alt="" aria-hidden="true" width="720" height="712"></div>
  <div class="body">
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(text)}</p>
  <div class="foot"><a href="/">← Về trang chính</a> · <a href="/logout">Đăng xuất</a></div>
  </div>
</div>`;
  return shell('Cattasaurus Dashboard — ' + title, body, status || 200);
}

function forbiddenPage(me) {
  return messagePage('Chưa có quyền xem', `Tài khoản ${me.email || 'này'} chưa được cấp quyền xem trang này. Nhờ admin cấp thêm trên trang Quản lý user.`, 403, 'mascot-shy.png', 'meow… chỗ này chưa mở');
}

function setupPage() {
  const body = `<div class="card">
  <div class="band"><div class="band-text"><div class="eyebrow">Dashboard nội bộ</div><img class="wm light" src="/img/logo-h-pine.png" alt="Cattasaurus" width="1000" height="327"><img class="wm dark" src="/img/logo-h-pistachio.png" alt="" aria-hidden="true" width="1000" height="327"><div class="fun">meow… chưa có mật khẩu</div></div><img class="mascot" src="/img/mascot-shy.png" alt="" aria-hidden="true" width="720" height="712"></div>
  <div class="body">
  <h1>Chưa đặt mật khẩu</h1>
  <p>Trang đã lên nhưng chưa có mật khẩu, nên chưa hiển thị gì.</p>
  <p>Vào Cloudflare → Workers &amp; Pages → dự án này → <b>Settings</b> → <b>Variables and Secrets</b> → Add: tên <code>DASH_PASSWORD</code>, loại <b>Secret</b>, giá trị = mật khẩu bạn chọn → Save, rồi <b>Deployments → Retry deployment</b> (hoặc đẩy một commit mới).</p>
  </div>
</div>`;
  return shell('Cattasaurus Dashboard — cần cài đặt', body, 503);
}

// ---------- /users — admin page (server shell + fetches /api/users) ----------
// Same look as the dashboard: Pine top bar, page on the light/dark surface, one invite card and one list.
// Editing happens inline under a row; destructive buttons ask for a second click instead of a native dialog.
const VIEW_SHORT = { exec: 'Tổng quan', sales: 'Bán hàng', marketing: 'Marketing', pnl: 'P&L', inventory: 'Tồn kho', opex: 'Chi phí', data: 'Dữ liệu', sns: 'S&S' };

const USERS_CSS = `
  :root{--a-pine:#05372E;--a-pistachio:#C9E595;--a-page:#f4f6f0;--a-card:#ffffff;--a-card-2:#f5f8ee;--a-ink:#05372E;--a-ink-2:#33544a;--a-ink-3:#6c857a;--a-line:rgba(5,55,46,.10);--a-line-2:rgba(5,55,46,.22);--a-accent:#285D18;--a-solid:#05372E;--a-solid-ink:#C9E595;--a-chip-on:#eaf2da;--a-good:#3f8a1e;--a-warn:#c28a00;--a-bad:#b3261e;--a-focus:#285D18;--a-shadow:0 1px 2px rgba(5,55,46,.05),0 8px 24px rgba(5,55,46,.05);}
  @media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--a-page:#0b1f1b;--a-card:#123029;--a-card-2:#163730;--a-ink:#eef5df;--a-ink-2:#c3d3b3;--a-ink-3:#8fa697;--a-line:rgba(201,229,149,.12);--a-line-2:rgba(201,229,149,.26);--a-accent:#b9da7a;--a-solid:#C9E595;--a-solid-ink:#05372E;--a-chip-on:#1f453c;--a-good:#7cc24a;--a-warn:#e4bc3f;--a-bad:#f06a6a;--a-focus:#C9E595;--a-shadow:none;}}
  :root[data-theme="dark"]{color-scheme:dark;--a-page:#0b1f1b;--a-card:#123029;--a-card-2:#163730;--a-ink:#eef5df;--a-ink-2:#c3d3b3;--a-ink-3:#8fa697;--a-line:rgba(201,229,149,.12);--a-line-2:rgba(201,229,149,.26);--a-accent:#b9da7a;--a-solid:#C9E595;--a-solid-ink:#05372E;--a-chip-on:#1f453c;--a-good:#7cc24a;--a-warn:#e4bc3f;--a-bad:#f06a6a;--a-focus:#C9E595;--a-shadow:none;}
  :root[data-theme="light"]{color-scheme:light;}
  html,body{height:auto;}
  .adm [hidden]{display:none!important;}
  body.adm{margin:0;background:var(--a-page);color:var(--a-ink);font:14px/1.5 'Libre Franklin',system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-variant-numeric:tabular-nums;}
  .adm a{color:var(--a-accent);}
  .tb{position:sticky;top:0;z-index:10;background:var(--a-pine);color:#dfe9cf;padding-top:env(safe-area-inset-top,0px);}
  .tb-in{max-width:1120px;margin:0 auto;padding:0 20px;height:52px;display:flex;align-items:center;gap:18px;}
  .tb-brand{flex:none;display:flex;align-items:center;}
  .tb-brand img{display:block;height:26px;width:auto;}
  .tb-nav{display:flex;gap:2px;flex:1;min-width:0;overflow-x:auto;scrollbar-width:none;}
  .tb-nav::-webkit-scrollbar{display:none;}
  .adm .tb-nav a{color:rgba(223,233,207,.78);text-decoration:none;font-weight:600;font-size:13px;padding:7px 12px;border-radius:8px;white-space:nowrap;line-height:1.2;}
  .adm .tb-nav a:hover{color:#fff;background:rgba(255,255,255,.07);}
  .adm .tb-nav a[aria-current="page"]{background:var(--a-pistachio);color:var(--a-pine);}
  .tb-right{display:flex;align-items:center;gap:12px;flex:none;font-size:13px;}
  .tb-who{color:rgba(223,233,207,.72);white-space:nowrap;max-width:240px;overflow:hidden;text-overflow:ellipsis;}
  .adm .tb-out{color:#dfe9cf;text-decoration:none;font-weight:600;border:1px solid rgba(223,233,207,.28);border-radius:8px;padding:6px 11px;white-space:nowrap;}
  .adm .tb-out:hover{background:rgba(255,255,255,.07);}
  .adm .tb a:focus-visible{outline:2px solid var(--a-pistachio);outline-offset:1px;}
  .tb-out svg{display:none;}
  @media (max-width:640px){.tb-who{display:none}.tb-in{gap:10px;padding:0 16px}.adm .tb-nav a{padding:7px 9px}.adm .tb-out{padding:6px 8px;display:flex}.tb-out span{display:none}.tb-out svg{display:block}}

  .page{max-width:1120px;margin:0 auto;padding:28px 20px 64px;display:flex;flex-direction:column;gap:20px;}
  @media (max-width:640px){.page{padding:20px 16px 48px}}
  .head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px 24px;flex-wrap:wrap;}
  .head h1{font-size:24px;line-height:1.2;font-weight:600;margin:0 0 6px;letter-spacing:-.01em;text-wrap:balance;}
  .head .sub{margin:0;color:var(--a-ink-2);max-width:64ch;}
  .facts{display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:10px;font-size:12.5px;color:var(--a-ink-3);}
  .facts span{display:inline-flex;align-items:center;gap:7px;}
  .dot{width:7px;height:7px;border-radius:50%;background:var(--a-good);flex:none;}
  .dot.warn{background:var(--a-warn);} .dot.bad{background:var(--a-bad);}
  .adm code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;}
  .head-acts{display:flex;flex-direction:column;align-items:flex-end;gap:6px;}
  .head-acts .cap{font-size:12px;color:var(--a-ink-3);text-align:right;max-width:32ch;}
  @media (max-width:640px){.head-acts{align-items:flex-start}.head-acts .cap{text-align:left}}

  .box{background:var(--a-card);border:1px solid var(--a-line);border-radius:14px;box-shadow:var(--a-shadow);}
  .box-h{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:4px 12px;padding:16px 20px;border-bottom:1px solid var(--a-line);}
  .box-h h2{font-size:15px;font-weight:600;margin:0;white-space:nowrap;}
  .box-h .count{color:var(--a-ink-3);font-weight:500;margin-left:4px;}
  .box-h .hint{font-size:12.5px;color:var(--a-ink-3);}
  .box-b{padding:18px 20px 20px;}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
  @media (max-width:640px){.grid2{grid-template-columns:1fr}}
  .lbl{display:block;font-size:12px;font-weight:600;color:var(--a-ink-2);margin:0 0 6px;padding:0;}
  .adm fieldset{border:0;margin:18px 0 0;padding:0;min-width:0;}
  .in{width:100%;font:inherit;font-size:14px;padding:10px 12px;border:1px solid var(--a-line-2);border-radius:9px;background:var(--a-card);color:var(--a-ink);}
  .in::placeholder{color:var(--a-ink-3);}
  .in:focus{outline:2px solid var(--a-focus);outline-offset:-1px;border-color:transparent;}

  .chips{display:flex;flex-wrap:wrap;gap:8px;}
  .chip{position:relative;display:inline-flex;align-items:center;font-size:13px;font-weight:500;color:var(--a-ink-2);border:1px solid var(--a-line-2);border-radius:999px;padding:6px 13px 6px 9px;cursor:pointer;user-select:none;transition:background-color .12s,border-color .12s,color .12s;}
  .chip:hover{border-color:var(--a-accent);}
  .chip input{position:absolute;opacity:0;width:1px;height:1px;margin:0;pointer-events:none;}
  .chip span::before{content:"";display:inline-block;width:15px;height:15px;margin-right:7px;border-radius:50%;border:1.5px solid var(--a-line-2);vertical-align:-3px;font-size:10px;line-height:12px;font-weight:700;text-align:center;}
  .chip:has(input:checked){background:var(--a-chip-on);border-color:var(--a-accent);color:var(--a-ink);}
  .chip:has(input:checked) span::before{content:"✓";background:var(--a-solid);border-color:var(--a-solid);color:var(--a-solid-ink);}
  .chip:has(input:focus-visible){outline:2px solid var(--a-focus);outline-offset:2px;}
  .pick{display:flex;gap:16px;margin-top:10px;}
  .lnk{font:inherit;font-size:12.5px;font-weight:600;color:var(--a-accent);background:none;border:0;padding:0;cursor:pointer;}
  .lnk:hover{text-decoration:underline;}

  .switch{position:relative;display:inline-flex;align-items:center;gap:10px;margin-top:18px;font-size:13.5px;color:var(--a-ink-2);cursor:pointer;}
  .switch input{position:absolute;opacity:0;width:1px;height:1px;margin:0;}
  .track{flex:none;position:relative;width:34px;height:20px;border-radius:999px;background:var(--a-line-2);transition:background-color .15s;}
  .track::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s;}
  .switch input:checked + .track{background:var(--a-accent);}
  .switch input:checked + .track::after{transform:translateX(14px);}
  .switch input:focus-visible + .track{outline:2px solid var(--a-focus);outline-offset:2px;}
  .switch.dis{cursor:not-allowed;opacity:.65;}
  .switch b{color:var(--a-ink);font-weight:600;}

  .btn{font:inherit;font-size:13px;font-weight:600;line-height:1.2;padding:9px 16px;border-radius:9px;border:1px solid transparent;background:transparent;color:var(--a-ink);cursor:pointer;white-space:nowrap;transition:background-color .12s,border-color .12s,color .12s;}
  .btn.sm{padding:7px 12px;font-size:12.5px;}
  .btn.primary{background:var(--a-solid);color:var(--a-solid-ink);}
  .btn.primary:hover{filter:brightness(1.1);}
  .btn.ghost{border-color:var(--a-line-2);}
  .btn.ghost:hover{border-color:var(--a-accent);}
  .btn.danger{color:var(--a-bad);border-color:var(--a-line-2);}
  .btn.danger:hover{border-color:var(--a-bad);}
  .btn.armed{background:var(--a-bad);border-color:var(--a-bad);color:#fff;}
  .btn:disabled{opacity:.55;cursor:default;filter:none;}
  .btn:focus-visible,.lnk:focus-visible{outline:2px solid var(--a-focus);outline-offset:2px;}
  .form-foot{display:flex;align-items:center;justify-content:space-between;gap:12px 20px;flex-wrap:wrap;margin-top:20px;padding-top:16px;border-top:1px solid var(--a-line);}
  .form-foot .hint{font-size:12.5px;color:var(--a-ink-3);max-width:60ch;}
  @media (max-width:640px){.form-foot .btn.primary{width:100%}}

  .msg{font-size:13px;margin-top:12px;color:var(--a-ink-2);}
  .msg:empty{display:none;}
  .msg.ok{color:var(--a-good);} .msg.bad{color:var(--a-bad);}
  .linkbox{display:flex;gap:8px;margin-top:8px;}
  .linkbox .in{font-size:12px;padding:8px 10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}
  .note{border:1px solid var(--a-line-2);border-left:3px solid var(--a-warn);border-radius:10px;padding:12px 14px;background:var(--a-card);font-size:13px;color:var(--a-ink-2);}

  .rows-h,.r-main{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,2fr) 160px 140px 72px;gap:16px;align-items:center;padding-left:20px;padding-right:20px;}
  .rows-h{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--a-ink-3);padding-top:10px;padding-bottom:10px;border-bottom:1px solid var(--a-line);}
  .row{border-bottom:1px solid var(--a-line);}
  .row:last-child{border-bottom:0;}
  .row.open{background:var(--a-card-2);}
  .r-main{padding-top:14px;padding-bottom:14px;}
  .r-user{min-width:0;}
  .r-name{font-weight:600;display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
  .r-email{font-size:12.5px;color:var(--a-ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .you{font-size:11.5px;font-weight:500;color:var(--a-ink-3);}
  .tag{display:inline-block;font-size:12px;font-weight:500;line-height:1.5;color:var(--a-ink-2);background:var(--a-card-2);border:1px solid var(--a-line);border-radius:6px;padding:0 7px;margin:2px 4px 2px 0;white-space:nowrap;}
  .row.open .tag{background:var(--a-card);}
  .tag.all{color:var(--a-ink);font-weight:600;}
  .tag.admin{background:var(--a-solid);border-color:transparent;color:var(--a-solid-ink);font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:0 6px;margin:0;}
  .pill{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--a-ink-2);white-space:nowrap;}
  .pill i{width:7px;height:7px;border-radius:50%;background:var(--a-good);}
  .pill.wait i{background:var(--a-warn);}
  .pill.off{color:var(--a-ink-3);} .pill.off i{background:var(--a-ink-3);}
  .r-last{font-size:12.5px;color:var(--a-ink-2);}
  .r-last .k{display:none;color:var(--a-ink-3);}
  .r-last .none{color:var(--a-ink-3);}
  .r-act{text-align:right;}
  .r-edit{padding:4px 20px 20px;}
  .r-edit fieldset{margin:0;}
  .e-acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:18px;}
  .e-acts .sp{flex:1;}
  .meta{font-size:12px;color:var(--a-ink-3);margin-top:12px;}
  .empty{padding:28px 20px;color:var(--a-ink-3);text-align:center;}
  @media (max-width:780px){
    .rows-h{display:none;}
    .r-main{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"user act" "access access" "status last";row-gap:8px;}
    .r-user{grid-area:user;} .r-access{grid-area:access;} .r-status{grid-area:status;} .r-last{grid-area:last;text-align:right;} .r-act{grid-area:act;}
    .r-last .k{display:inline;}
  }
  @media (prefers-reduced-motion:reduce){.adm *{transition:none!important;}}
`;

function usersPage(me, env) {
  const kvOk = !!kv(env), mailOk = mailEnabled(env);
  const from = String(env.MAIL_FROM || 'dashboard@cattasaurus.com').replace(/^.*<([^>]+)>.*$/, '$1');
  const who = me.kind === 'owner' ? 'Chủ dashboard' : (me.name && me.name !== me.email ? me.name + ' · ' + me.email : me.email);
  const cfg = JSON.stringify({ views: VIEWS, labels: VIEW_LABELS, short: VIEW_SHORT, me: { email: me.email, kind: me.kind }, days: INVITE_DAYS }).replace(/</g, '\\u003c');
  const head = `<style>${USERS_CSS}</style><script>try{var t=localStorage.getItem('ctu_theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>`;
  const body = `<header class="tb"><div class="tb-in">
  <a class="tb-brand" href="/?menu=1" title="Trang chính"><img src="/img/logo-h-pistachio.png" alt="Cattasaurus" width="1000" height="327"></a>
  <nav class="tb-nav" aria-label="Trang"><a href="/pnl">Dashboard</a><a href="/sns">S&amp;S</a><a href="/users" aria-current="page">Người dùng</a></nav>
  <div class="tb-right"><span class="tb-who" title="Đang đăng nhập">${escapeHtml(who)}</span><a class="tb-out" href="/logout" aria-label="Đăng xuất" title="Đăng xuất"><span>Đăng xuất</span><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M21 3v18"/></svg></a></div>
</div></header>
<main class="page">
  <div class="head">
    <div>
      <h1>Người dùng</h1>
      <p class="sub">Mỗi người đăng nhập bằng email và mật khẩu riêng, chỉ thấy những trang được cấp — số liệu của trang không được cấp không tải về máy họ.</p>
      <div class="facts">
        ${mailOk ? `<span><i class="dot"></i>Email mời gửi tự động từ <code>${escapeHtml(from)}</code></span>` : `<span><i class="dot warn"></i>Email mời chưa bật — tạo xong copy link gửi tay</span>`}
        <span id="epochFact" hidden></span>
      </div>
    </div>
    ${kvOk ? `<div class="head-acts"><button type="button" class="btn ghost" id="revokeBtn">Đăng xuất mọi thiết bị</button><div class="cap">Mọi trình duyệt khác phải đăng nhập lại; bạn vẫn ở lại trang này.</div><div class="msg" id="revokeMsg" role="status"></div></div>` : ''}
  </div>
  ${kvOk ? '' : `<div class="note">Chưa gắn kho user: Cloudflare → Workers &amp; Pages → dự án → Settings → Bindings → Add → KV namespace, tên biến <code>USERS</code> → Save → Deployments → Retry deployment.</div>`}

  <section class="box" aria-labelledby="invH">
    <div class="box-h"><h2 id="invH">Mời người dùng</h2><span class="hint">Link dùng 1 lần · hết hạn sau ${INVITE_DAYS} ngày</span></div>
    <form class="box-b" id="addForm" autocomplete="off">
      <div class="grid2">
        <div><label class="lbl" for="aEmail">Email</label><input class="in" id="aEmail" type="email" required placeholder="ten@cattasaurus.com" autocapitalize="off" spellcheck="false"></div>
        <div><label class="lbl" for="aName">Tên hiển thị</label><input class="in" id="aName" type="text" placeholder="Ví dụ: Lan (Marketing)"></div>
      </div>
      <fieldset><legend class="lbl">Được xem</legend><div class="chips" id="aViews"></div>
        <div class="pick"><button type="button" class="lnk" data-all="aViews">Chọn tất cả</button><button type="button" class="lnk" data-none="aViews">Bỏ chọn</button></div></fieldset>
      <label class="switch"><input type="checkbox" id="aAdmin"><span class="track" aria-hidden="true"></span><span><b>Admin</b> — được mời người khác, sửa quyền và xoá người dùng</span></label>
      <div class="form-foot"><span class="hint">${mailOk ? 'Người được mời nhận email có nút tạo mật khẩu (≥ ' + MIN_PASSWORD + ' ký tự), sau đó tự đăng nhập.' : 'Sau khi tạo, copy link mời gửi qua Slack / Zalo / email.'}</span><button type="submit" class="btn primary" id="aBtn">${mailOk ? 'Gửi lời mời' : 'Tạo link mời'}</button></div>
      <div class="msg" id="aMsg" role="status"></div>
      <div class="linkbox" id="aLink" hidden><input class="in" id="aLinkIn" readonly aria-label="Link mời"><button type="button" class="btn ghost sm" data-copy="aLinkIn">Copy link</button></div>
    </form>
  </section>

  <section class="box" aria-labelledby="listH">
    <div class="box-h"><h2 id="listH">Danh sách<span class="count" id="count"></span></h2></div>
    <div class="rows-h" aria-hidden="true"><span>Người dùng</span><span>Được xem</span><span>Trạng thái</span><span>Đăng nhập gần nhất</span><span></span></div>
    <div id="rows"><div class="empty">Đang tải…</div></div>
  </section>
</main>
<script>
(function(){
  var C = ${cfg};
  var H = {'X-Requested-With':'ctu','Content-Type':'application/json'};
  var open = {};
  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function api(method, path, body){ return fetch(path, {method:method, headers:H, credentials:'same-origin', cache:'no-store', body: body ? JSON.stringify(body) : undefined}).then(function(r){ return r.json().catch(function(){ return {}; }).then(function(j){ if(!r.ok) throw new Error(j.error || ('Lỗi HTTP ' + r.status)); return j; }); }); }
  function pad(n){ return String(n).padStart(2,'0'); }
  function when(iso){ if(!iso) return ''; var d = new Date(iso); return pad(d.getDate())+'/'+pad(d.getMonth()+1)+'/'+d.getFullYear()+' '+pad(d.getHours())+':'+pad(d.getMinutes()); }
  function chips(selected){ return C.views.map(function(v){ return '<label class="chip"><input type="checkbox" value="'+v+'"'+(selected.indexOf(v)>=0?' checked':'')+'><span>'+esc(C.labels[v]||v)+'</span></label>'; }).join(''); }
  function picked(box){ return Array.prototype.map.call(box.querySelectorAll('input:checked'), function(i){ return i.value; }); }
  function say(el, kind, text){ el.className = 'msg' + (kind ? ' ' + kind : ''); el.textContent = text || ''; }
  function access(u){ if(u.views.length === C.views.length) return '<span class="tag all">Tất cả trang</span>'; return u.views.map(function(v){ return '<span class="tag">'+esc(C.short[v]||v)+'</span>'; }).join(''); }
  function status(u){ if(!u.active) return '<span class="pill off"><i></i>Đã tắt</span>'; if(!u.has_password) return '<span class="pill wait"><i></i>Chờ đặt mật khẩu</span>'; return '<span class="pill"><i></i>Đang hoạt động</span>'; }
  function inviteText(j){ return j.emailed ? 'Đã gửi email tới ' + j.user.email + '. Link dự phòng nếu họ không thấy mail:' : (j.email_error ? 'Chưa gửi được email (' + j.email_error + '). Copy link này gửi tay:' : 'Copy link này gửi cho ' + j.user.email + ':'); }
  // destructive actions: first click arms the button, second click (within 4 s) runs it
  function arm(btn, label, fn){
    if(btn.dataset.armed){ disarm(btn); fn(); return; }
    btn.dataset.label = btn.textContent; btn.dataset.armed = '1'; btn.classList.add('armed'); btn.textContent = label;
    btn._t = setTimeout(function(){ disarm(btn); }, 4000);
  }
  function disarm(btn){ if(!btn.dataset.armed) return; clearTimeout(btn._t); delete btn.dataset.armed; btn.classList.remove('armed'); btn.textContent = btn.dataset.label; }

  $('aViews').innerHTML = chips(['exec','sales']);
  document.addEventListener('click', function(e){
    var t = e.target.closest('[data-all],[data-none],[data-copy]'); if(!t) return;
    if(t.dataset.all || t.dataset.none){ var box = $(t.dataset.all || t.dataset.none); box.querySelectorAll('input').forEach(function(i){ i.checked = !!t.dataset.all; }); }
    if(t.hasAttribute('data-copy')){ var inp = (t.dataset.copy && $(t.dataset.copy)) || t.parentNode.querySelector('input'); inp.select(); try{ navigator.clipboard.writeText(inp.value); }catch(err){ document.execCommand('copy'); } t.textContent = 'Đã copy'; setTimeout(function(){ t.textContent = 'Copy link'; }, 2000); }
  });

  $('addForm').addEventListener('submit', function(e){
    e.preventDefault();
    var m = $('aMsg'), b = $('aBtn'), views = picked($('aViews'));
    if(!views.length){ say(m, 'bad', 'Chọn ít nhất một trang.'); return; }
    b.disabled = true; say(m, '', 'Đang tạo…'); $('aLink').hidden = true;
    api('POST', '/api/users', {email: $('aEmail').value, name: $('aName').value, views: views, admin: $('aAdmin').checked}).then(function(j){
      say(m, j.emailed || !j.email_error ? 'ok' : 'bad', inviteText(j));
      $('aLink').hidden = false; $('aLinkIn').value = j.invite_url;
      $('aEmail').value = ''; $('aName').value = ''; $('aAdmin').checked = false; $('aViews').innerHTML = chips(['exec','sales']);
      load();
    }).catch(function(err){ say(m, 'bad', err.message); }).then(function(){ b.disabled = false; });
  });

  var rb = $('revokeBtn');
  if(rb) rb.addEventListener('click', function(){
    arm(rb, 'Bấm lần nữa để xác nhận', function(){
      rb.disabled = true; say($('revokeMsg'), '', 'Đang đăng xuất…');
      api('POST', '/api/sessions/revoke', {}).then(function(j){ say($('revokeMsg'), 'ok', 'Xong — các thiết bị khác bị đăng xuất trong khoảng 1 phút.'); showEpoch(j.session_epoch); })
        .catch(function(err){ say($('revokeMsg'), 'bad', err.message); }).then(function(){ rb.disabled = false; });
    });
  });
  function showEpoch(iso){ var f = $('epochFact'); if(!iso){ f.hidden = true; return; } f.hidden = false; f.innerHTML = '<i class="dot"></i>Đăng xuất mọi thiết bị lần cuối: ' + esc(when(iso)); }

  function row(u, i){
    var self = C.me.kind === 'user' && C.me.email === u.email, isOpen = !!open[u.email];
    return '<div class="row'+(isOpen?' open':'')+'" data-email="'+esc(u.email)+'">' +
      '<div class="r-main">' +
        '<div class="r-user"><div class="r-name">'+esc(u.name || u.email.split('@')[0])+(u.admin?'<span class="tag admin">Admin</span>':'')+(self?'<span class="you">(bạn)</span>':'')+'</div><div class="r-email">'+esc(u.email)+'</div></div>' +
        '<div class="r-access">'+access(u)+'</div>' +
        '<div class="r-status">'+status(u)+'</div>' +
        '<div class="r-last">'+(u.last_login ? '<span class="k">Lần cuối </span>'+when(u.last_login) : '<span class="none">Chưa đăng nhập</span>')+'</div>' +
        '<div class="r-act"><button type="button" class="btn ghost sm" data-act="edit" aria-expanded="'+isOpen+'" aria-controls="e'+i+'">'+(isOpen?'Đóng':'Sửa')+'</button></div>' +
      '</div>' +
      '<div class="r-edit" id="e'+i+'"'+(isOpen?'':' hidden')+'>' +
        '<fieldset><legend class="lbl">Được xem</legend><div class="chips" id="v'+i+'">'+chips(u.views)+'</div>' +
          '<div class="pick"><button type="button" class="lnk" data-all="v'+i+'">Chọn tất cả</button><button type="button" class="lnk" data-none="v'+i+'">Bỏ chọn</button></div></fieldset>' +
        '<label class="switch'+(self?' dis':'')+'"><input type="checkbox" id="ad'+i+'"'+(u.admin?' checked':'')+(self?' disabled':'')+'><span class="track" aria-hidden="true"></span><span><b>Admin</b>'+(self?' — không tự bỏ quyền của chính mình':' — được mời người khác, sửa quyền và xoá người dùng')+'</span></label>' +
        '<div class="e-acts"><button type="button" class="btn primary sm" data-act="save">Lưu thay đổi</button>' +
          '<button type="button" class="btn ghost sm" data-act="invite">'+(u.has_password?'Gửi link đặt lại mật khẩu':'Gửi lại lời mời')+'</button><span class="sp"></span>' +
          (self ? '' : '<button type="button" class="btn ghost sm" data-act="toggle" data-on="'+(u.active?'0':'1')+'">'+(u.active?'Tắt tài khoản':'Bật lại')+'</button><button type="button" class="btn danger sm" data-act="del">Xoá</button>') +
        '</div>' +
        '<div class="msg" role="status"></div>' +
        '<div class="linkbox" hidden><input class="in" readonly aria-label="Link mời"><button type="button" class="btn ghost sm" data-copy="">Copy link</button></div>' +
        '<div class="meta">Tạo '+esc(when(u.created_at))+(u.created_by?' bởi '+esc(u.created_by==='owner'?'chủ dashboard':u.created_by):'')+(u.invited_at?' · lời mời gần nhất '+esc(when(u.invited_at)):'')+(u.active?'':' · tắt tài khoản = đăng xuất khỏi mọi thiết bị')+'</div>' +
      '</div></div>';
  }

  function load(){
    return api('GET', '/api/users').then(function(j){
      showEpoch(j.session_epoch);
      $('count').textContent = j.users.length ? ' · ' + j.users.length : '';
      var me = C.me.email; j.users.sort(function(a, b){ var ka = (a.email === me ? 0 : a.admin ? 1 : 2), kb = (b.email === me ? 0 : b.admin ? 1 : 2); return ka - kb || String(a.name || a.email).localeCompare(String(b.name || b.email), 'vi'); });
      $('rows').innerHTML = j.users.length ? j.users.map(row).join('') : '<div class="empty">Chưa có ai — mời người đầu tiên ở trên.</div>';
    }).catch(function(err){ $('rows').innerHTML = '<div class="empty msg bad">'+esc(err.message)+'</div>'; });
  }

  $('rows').addEventListener('click', function(e){
    var b = e.target.closest('button[data-act]'); if(!b) return;
    var r = b.closest('.row'), email = r.dataset.email, ed = r.querySelector('.r-edit'), m = ed.querySelector('.msg'), act = b.dataset.act, path = '/api/users/' + encodeURIComponent(email);
    var bad = function(err){ say(m, 'bad', err.message); };
    if(act === 'edit'){ var o = ed.hidden; ed.hidden = !o; r.classList.toggle('open', o); b.textContent = o ? 'Đóng' : 'Sửa'; b.setAttribute('aria-expanded', String(o)); if(o) open[email] = 1; else delete open[email]; return; }
    if(act === 'save'){ var v = picked(ed.querySelector('.chips')); if(!v.length){ say(m, 'bad', 'Chọn ít nhất một trang.'); return; } var ad = ed.querySelector('.switch input'); var body = {views: v}; if(!ad.disabled) body.admin = ad.checked; b.disabled = true;
      api('PUT', path, body).then(function(){ return load(); }).then(function(){ var r2 = document.querySelector('.row[data-email="'+email+'"]'); if(r2) say(r2.querySelector('.r-edit .msg'), 'ok', 'Đã lưu.'); }).catch(function(err){ b.disabled = false; bad(err); }); return; }
    if(act === 'invite'){ b.disabled = true; api('POST', path + '/invite', {}).then(function(j){ say(m, j.emailed || !j.email_error ? 'ok' : 'bad', inviteText(j)); var l = ed.querySelector('.linkbox'); l.hidden = false; l.querySelector('input').value = j.invite_url; }).catch(bad).then(function(){ b.disabled = false; }); return; }
    if(act === 'toggle'){ var on = b.dataset.on === '1'; var go = function(){ api('PUT', path, {active: on}).then(function(){ return load(); }).catch(bad); }; if(on) go(); else arm(b, 'Bấm lần nữa để tắt', go); return; }
    if(act === 'del'){ arm(b, 'Bấm lần nữa để xoá', function(){ api('DELETE', path).then(function(){ delete open[email]; return load(); }).catch(bad); }); return; }
  });

  load();
})();
</script>`;
  return shell('Người dùng — Cattasaurus Dashboard', body, 200, head, 'adm');
}
