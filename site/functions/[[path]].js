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
    if (sub === 'owner') return ownerIdentity();
    const email = b64uDecode(sub);
    const u = await getUser(env, email);
    if (!u || !u.active || String(u.pwver || 0) !== ver || !u.hash) return null;   // deactivated / password reset / never set
    return userIdentity(u);
  }
  // legacy owner cookie "exp.sig" signed with DASH_PASSWORD — still valid so nobody is logged out by this update
  const i = raw.indexOf('.');
  if (i < 0) return null;
  const exp = Number(raw.slice(0, i));
  const sig = raw.slice(i + 1);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  const want = await hmac(env.DASH_PASSWORD, 'sess|' + exp);
  return (await safeEqual(env.DASH_PASSWORD, sig, want)) ? ownerIdentity() : null;
}

function secretOf(env) { return env.SESSION_SECRET || env.DASH_PASSWORD; }

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
  if (path === '/api/me') return json({ me: publicMe(me), users_enabled: !!kv(env) }, 200);
  if (!me.admin) return json({ error: 'forbidden' }, 403);
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
    if (request.method === 'GET') return json({ users: (await listUsers(env)).map(userSummary), views: VIEWS, labels: VIEW_LABELS }, 200);
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
      return json({ user: userSummary(u), invite_url: origin + '/invite?t=' + token, invite_days: INVITE_DAYS }, 201);
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
    return json({ user: userSummary(u), invite_url: origin + '/invite?t=' + token, invite_days: INVITE_DAYS }, 200);
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
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 'Libre Franklin',system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px 16px;padding-top:calc(24px + env(safe-area-inset-top,0px));}
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
  h1{font-weight:600;font-size:14px;text-transform:uppercase;letter-spacing:.06em;margin:0 0 4px;color:var(--forest);}
  p{margin:0 0 16px;color:var(--muted);font-size:14px}
  label{display:block;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
  input{width:100%;font:inherit;font-size:17px;padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:transparent;color:var(--ink);}
  input:focus{outline:2px solid var(--forest);outline-offset:1px;border-color:transparent}
  button{width:100%;margin-top:14px;font:inherit;font-weight:700;font-size:15px;letter-spacing:.04em;text-transform:uppercase;padding:13px;border:0;border-radius:10px;background:var(--solid);color:var(--solid-ink);cursor:pointer}
  button:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
  .err{color:var(--bad);font-size:14px;margin:12px 0 0;font-weight:500}
  .foot{margin-top:16px;font-size:12px;color:var(--muted)}
  .foot a{color:var(--forest)}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
`;

function shell(title, body, status, extraHead) {
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><title>${title}</title><link rel="icon" type="image/png" sizes="64x64" href="/favicon.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><meta name="theme-color" content="#f2f6e6" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#0b1f1b" media="(prefers-color-scheme: dark)">${extraHead || ''}<style>${PAGE_CSS}</style></head><body>${body}</body></html>`;
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
const USERS_CSS = `
  body{display:block;padding:18px 16px 40px;max-width:1040px;margin:0 auto;}
  .top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px;}
  .top .wm{height:34px;margin:0}
  .top nav a{color:var(--forest);font-weight:600;font-size:13px;text-decoration:none;margin-left:14px}
  .panel{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:18px 20px;margin-bottom:16px;box-shadow:0 6px 24px rgba(5,55,46,.06);}
  .panel h2{font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:var(--forest);margin:0 0 10px}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  @media (max-width:640px){.row{grid-template-columns:1fr}}
  .chips{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 4px}
  .chips label{display:inline-flex;align-items:center;gap:6px;text-transform:none;letter-spacing:0;font-size:13px;font-weight:500;color:var(--ink);background:var(--chip);border:1px solid var(--border);border-radius:999px;padding:6px 12px;margin:0;cursor:pointer}
  .chips input{width:auto;padding:0;margin:0}
  .chips label.on{background:var(--band-bg);color:var(--band-ink);border-color:transparent}
  button.sm{width:auto;margin:0;padding:8px 14px;font-size:12px;text-transform:none;letter-spacing:0;border-radius:8px}
  button.ghost{background:transparent;color:var(--forest);border:1px solid var(--border)}
  button.danger{background:transparent;color:var(--bad);border:1px solid var(--border)}
  .acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--border);vertical-align:top}
  th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600}
  .tag{display:inline-block;font-size:11px;font-weight:600;border-radius:999px;padding:2px 9px;background:var(--chip);color:var(--muted);margin:2px 4px 2px 0}
  .tag.ok{color:var(--ok)} .tag.bad{color:var(--bad)}
  .muted{color:var(--muted);font-size:12px}
  .link{display:flex;gap:8px;align-items:center;margin-top:10px}
  .link input{font-size:13px;padding:9px 10px}
  .msg{margin-top:10px;font-size:13px;font-weight:500}
  .msg.bad{color:var(--bad)} .msg.ok{color:var(--ok)}
  .wrap{overflow-x:auto}
  details{margin-top:6px} summary{cursor:pointer;color:var(--forest);font-weight:600;font-size:13px}
`;

function usersPage(me, env) {
  const views = JSON.stringify(VIEWS), labels = JSON.stringify(VIEW_LABELS);
  const kvOk = !!kv(env);
  const body = `<div class="top"><img class="wm light" src="/img/logo-h-pine.png" alt="Cattasaurus" width="1000" height="327"><img class="wm dark" src="/img/logo-h-pistachio.png" alt="" aria-hidden="true" width="1000" height="327"><nav><a href="/pnl">P&amp;L</a><a href="/sns">S&amp;S</a><a href="/">Trang chính</a><a href="/logout">Đăng xuất</a></nav></div>
<div class="panel"><h2>Quản lý user</h2>
<p>Đang đăng nhập: <b>${escapeHtml(me.name)}</b>${me.email ? ' (' + escapeHtml(me.email) + ')' : ''} — admin. Mỗi user có email + mật khẩu riêng và chỉ thấy các trang được tick; dữ liệu của trang không được cấp cũng không tải về máy họ.</p>
${kvOk ? '' : `<div class="msg bad">Chưa gắn kho user: Cloudflare → Workers &amp; Pages → dự án → <b>Settings → Bindings → Add → KV namespace</b>, Variable name <code>USERS</code>, chọn/tạo namespace (ví dụ <code>ctu-dashboard-users</code>) → Save → <b>Deployments → Retry deployment</b>. Xong tải lại trang này.</div>`}
</div>
<div class="panel"><h2>Thêm user</h2>
<form id="addForm">
<div class="row"><div><label for="aEmail">Email</label><input id="aEmail" type="email" required autocomplete="off" placeholder="ten@cattasaurus.com"></div><div><label for="aName">Tên</label><input id="aName" type="text" autocomplete="off" placeholder="Tên hiển thị"></div></div>
<label style="margin-top:12px">Được xem</label>
<div class="chips" id="aViews"></div>
<div class="chips"><label id="aAdminL"><input type="checkbox" id="aAdmin"> Admin (được quản lý user)</label></div>
<div class="acts"><button type="submit" class="sm" id="aBtn">Tạo &amp; lấy link mời</button></div>
<div id="aMsg" class="msg"></div>
<div id="aLink" class="link" hidden><input id="aLinkIn" readonly><button type="button" class="sm ghost" id="aCopy">Copy</button></div>
<div class="muted" style="margin-top:8px">Gửi link mời cho user (Slack/Zalo/email). Link dùng 1 lần, hết hạn sau ${INVITE_DAYS} ngày; user tự đặt mật khẩu (≥ ${MIN_PASSWORD} ký tự). Quên mật khẩu → bấm "Link mới" ở bảng dưới.</div>
</form></div>
<div class="panel"><h2>Danh sách user</h2><div class="wrap"><table id="tbl"><thead><tr><th>User</th><th>Được xem</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody id="tb"><tr><td colspan="4" class="muted">Đang tải…</td></tr></tbody></table></div><div id="tMsg" class="msg"></div></div>
<script>
(function(){
  var VIEWS = ${views}, LABELS = ${labels}, ME = ${JSON.stringify({ email: me.email, kind: me.kind })};
  var H = {'X-Requested-With':'ctu','Content-Type':'application/json'};
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function api(method, path, body){ return fetch(path, {method:method, headers:H, credentials:'same-origin', cache:'no-store', body: body ? JSON.stringify(body) : undefined}).then(function(r){ return r.json().then(function(j){ if(!r.ok) throw new Error(j.error || ('HTTP '+r.status)); return j; }); }); }
  function chips(container, selected, prefix){
    container.innerHTML = VIEWS.map(function(v){ var on = selected.indexOf(v) >= 0; return '<label class="'+(on?'on':'')+'"><input type="checkbox" value="'+v+'"'+(on?' checked':'')+'> '+esc(LABELS[v]||v)+'</label>'; }).join('');
    container.querySelectorAll('input').forEach(function(i){ i.addEventListener('change', function(){ i.parentNode.classList.toggle('on', i.checked); }); });
  }
  function picked(container){ return Array.prototype.map.call(container.querySelectorAll('input:checked'), function(i){ return i.value; }); }
  function fmt(iso){ if(!iso) return '—'; var d = new Date(iso); return d.toLocaleDateString('vi-VN') + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); }
  var aViews = document.getElementById('aViews'); chips(aViews, ['exec','sales'], 'a');
  document.getElementById('aAdmin').addEventListener('change', function(){ document.getElementById('aAdminL').classList.toggle('on', this.checked); });
  document.getElementById('aCopy').addEventListener('click', function(){ var i = document.getElementById('aLinkIn'); i.select(); try{ navigator.clipboard.writeText(i.value); this.textContent = 'Đã copy'; }catch(e){ document.execCommand('copy'); } });
  document.getElementById('addForm').addEventListener('submit', function(e){
    e.preventDefault(); var m = document.getElementById('aMsg'); m.className = 'msg'; m.textContent = 'Đang tạo…';
    api('POST', '/api/users', {email: document.getElementById('aEmail').value, name: document.getElementById('aName').value, views: picked(aViews), admin: document.getElementById('aAdmin').checked}).then(function(j){
      m.className = 'msg ok'; m.textContent = 'Đã tạo ' + j.user.email + '. Gửi link mời này cho user (hết hạn sau ' + j.invite_days + ' ngày):';
      var l = document.getElementById('aLink'); l.hidden = false; document.getElementById('aLinkIn').value = j.invite_url; document.getElementById('aCopy').textContent = 'Copy';
      document.getElementById('aEmail').value = ''; document.getElementById('aName').value = ''; load();
    }).catch(function(err){ m.className = 'msg bad'; m.textContent = err.message; });
  });
  function load(){
    api('GET', '/api/users').then(function(j){
      var tb = document.getElementById('tb');
      if(!j.users.length){ tb.innerHTML = '<tr><td colspan="4" class="muted">Chưa có user nào — thêm ở trên.</td></tr>'; return; }
      tb.innerHTML = j.users.map(function(u, i){
        var st = (u.active ? '<span class="tag ok">Đang bật</span>' : '<span class="tag bad">Đã tắt</span>') + (u.has_password ? '' : '<span class="tag">Chưa đặt mật khẩu</span>') + (u.admin ? '<span class="tag ok">Admin</span>' : '');
        return '<tr data-email="'+esc(u.email)+'"><td><b>'+esc(u.name||'')+'</b><br><span class="muted">'+esc(u.email)+'</span><br><span class="muted">Đăng nhập gần nhất: '+fmt(u.last_login)+'</span></td>'+
          '<td><div class="chips" id="v'+i+'"></div><div class="chips"><label id="ad'+i+'" class="'+(u.admin?'on':'')+'"><input type="checkbox" id="adi'+i+'"'+(u.admin?' checked':'')+'> Admin</label></div><button type="button" class="sm ghost" data-act="save">Lưu quyền</button></td>'+
          '<td>'+st+'</td>'+
          '<td><div class="acts"><button type="button" class="sm ghost" data-act="invite">Link mới (mời / đặt lại mật khẩu)</button><button type="button" class="sm ghost" data-act="toggle">'+(u.active?'Tắt':'Bật')+'</button><button type="button" class="sm danger" data-act="del">Xoá</button></div><div class="link" hidden><input readonly><button type="button" class="sm ghost" data-act="copy">Copy</button></div><div class="msg"></div></td></tr>';
      }).join('');
      j.users.forEach(function(u, i){ chips(document.getElementById('v'+i), u.views); document.getElementById('adi'+i).addEventListener('change', function(){ document.getElementById('ad'+i).classList.toggle('on', this.checked); }); });
    }).catch(function(err){ document.getElementById('tb').innerHTML = '<tr><td colspan="4" class="msg bad">'+esc(err.message)+'</td></tr>'; });
  }
  document.getElementById('tb').addEventListener('click', function(e){
    var b = e.target.closest('button[data-act]'); if(!b) return;
    var tr = b.closest('tr'), email = tr.dataset.email, m = tr.querySelector('.msg'), act = b.dataset.act, path = '/api/users/' + encodeURIComponent(email);
    var i = Array.prototype.indexOf.call(tr.parentNode.children, tr);
    var ok = function(t){ m.className = 'msg ok'; m.textContent = t; }, bad = function(err){ m.className = 'msg bad'; m.textContent = err.message; };
    if(act === 'save') api('PUT', path, {views: picked(document.getElementById('v'+i)), admin: document.getElementById('adi'+i).checked}).then(function(){ ok('Đã lưu.'); load(); }).catch(bad);
    if(act === 'invite') api('POST', path + '/invite').then(function(j){ var l = tr.querySelector('.link'); l.hidden = false; l.querySelector('input').value = j.invite_url; ok('Link mới (hết hạn sau ' + j.invite_days + ' ngày) — gửi cho user:'); }).catch(bad);
    if(act === 'copy'){ var inp = tr.querySelector('.link input'); inp.select(); try{ navigator.clipboard.writeText(inp.value); b.textContent = 'Đã copy'; }catch(err){ document.execCommand('copy'); } }
    if(act === 'toggle'){ var on = b.textContent.trim() === 'Bật'; if(!on && !confirm('Tắt tài khoản ' + email + '? User sẽ bị đăng xuất khỏi mọi thiết bị.')) return; api('PUT', path, {active: on}).then(function(){ ok(on ? 'Đã bật.' : 'Đã tắt.'); load(); }).catch(bad); }
    if(act === 'del'){ if(!confirm('Xoá hẳn tài khoản ' + email + '?')) return; api('DELETE', path).then(function(){ load(); }).catch(bad); }
  });
  load();
})();
</script>`;
  return shell('Cattasaurus Dashboard — quản lý user', body, 200, '<style>' + USERS_CSS + '</style>');
}
