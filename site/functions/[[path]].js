// Cattasaurus Dashboard — the whole server side in ONE file (Cloudflare Pages Functions catch-all).
//
// Every request to the site comes through here:
//   1. password gate  — DASH_PASSWORD (Pages > Settings > Variables and Secrets, type Secret) is the shared
//      password. Not set => the site shows a setup notice. Session = HttpOnly cookie "exp.signature",
//      signature = HMAC-SHA256(DASH_PASSWORD, "sess|" + exp), valid SESSION_DAYS days; changing the password
//      logs every device out. Wrong password => 1.5 s delay + 401. /login, /logout, /robots.txt (public).
//   2. /data/<file>.json — the dashboards' data: proxied from the GitHub repo that the sync workflows commit
//      to (raw.githubusercontent.com, cached at the Cloudflare edge for 2 minutes), or the invoice files
//      that live next to this site's pages. Optional env: GH_TOKEN (if the repo is ever made private),
//      DATA_BASE_URL (data moved to another repo).
//   3. everything else — the static pages/files in public/ (index.html hub, pnl.html + pnl.js, icons...).

const COOKIE = 'ctu_pnl_sess';
const SESSION_DAYS = 90;

const RAW_BASE = 'https://raw.githubusercontent.com/taitran-star/ctu-fin-sync-8x2k/main/data/';
const REPO_FILES = new Set([
  'amazon_pnl.json', 'meta_ads.json', 'shopify_pnl.json', 'google_ads.json',
  'shipmonk.json', 'paypal.json', 'klaviyo.json', 'amazon_ads.json',
]);
const STATIC_FILES = new Set(['shipmonk_invoices.json', 'klaviyo_invoices.json']);   // in public/

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain' } });
  if (!env.DASH_PASSWORD) return setupPage();
  if (path === '/login') return request.method === 'POST' ? handleLogin(request, env, url) : loginPage(url, null);
  if (path === '/logout') return logout(url);

  if (!(await hasValidSession(request, env))) {
    if (path.startsWith('/data/')) return json({ error: 'unauthorized' }, 401);
    return loginPage(url, null, 401);
  }

  let res;
  if (path.startsWith('/data/')) res = await serveData(path.slice('/data/'.length), request, env);
  else res = await env.ASSETS.fetch(request);

  const headers = new Headers(res.headers);
  headers.set('Cache-Control', path.startsWith('/data/') ? 'private, no-store' : 'private, no-cache');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  headers.set('Referrer-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// ---------- /data/<file>.json ----------
async function serveData(name, request, env) {
  name = decodeURIComponent(name);
  if (STATIC_FILES.has(name)) {
    const res = await env.ASSETS.fetch(new URL('/' + name, request.url).toString());
    if (!res.ok) return json({ error: 'static file missing: ' + name }, 404);
    return new Response(res.body, { status: 200, headers: jsonHeaders('static') });
  }
  if (!REPO_FILES.has(name)) return json({ error: 'unknown source' }, 404);

  const base = env.DATA_BASE_URL || RAW_BASE;
  const headers = { 'User-Agent': 'cattasaurus-dashboard' };
  if (env.GH_TOKEN) headers['Authorization'] = 'token ' + env.GH_TOKEN;
  let upstream;
  try {
    upstream = await fetch(base + name, { headers, cf: { cacheTtl: 120, cacheEverything: true } });
  } catch (e) {
    return json({ error: 'upstream fetch failed' }, 502);
  }
  if (upstream.status === 404) return json({ error: 'not in repo yet: ' + name }, 404);
  if (!upstream.ok) return json({ error: 'upstream HTTP ' + upstream.status }, 502);
  return new Response(upstream.body, { status: 200, headers: jsonHeaders('github') });
}

function jsonHeaders(source) {
  return { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Data-Source': source };
}

// ---------- login / logout ----------
async function handleLogin(request, env, url) {
  let pw = '';
  try {
    const form = await request.formData();
    pw = String(form.get('password') || '');
  } catch (e) { pw = ''; }
  const ok = pw.length > 0 && (await safeEqual(env.DASH_PASSWORD, pw, env.DASH_PASSWORD));
  if (!ok) {
    await new Promise((r) => setTimeout(r, 1500));
    return loginPage(url, 'Mật khẩu chưa đúng, thử lại.', 401);
  }
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const token = exp + '.' + (await hmac(env.DASH_PASSWORD, 'sess|' + exp));
  return new Response(null, {
    status: 303,
    headers: { Location: '/', 'Set-Cookie': cookie(token, SESSION_DAYS * 86400, url) },
  });
}

function logout(url) {
  return new Response(null, { status: 303, headers: { Location: '/login', 'Set-Cookie': cookie('', 0, url) } });
}

function cookie(value, maxAge, url) {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

async function hasValidSession(request, env) {
  const raw = parseCookies(request.headers.get('Cookie') || '')[COOKIE];
  if (!raw) return false;
  const i = raw.indexOf('.');
  if (i < 0) return false;
  const exp = Number(raw.slice(0, i));
  const sig = raw.slice(i + 1);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const want = await hmac(env.DASH_PASSWORD, 'sess|' + exp);
  return safeEqual(env.DASH_PASSWORD, sig, want);
}

function parseCookies(header) {
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  });
  return out;
}

// ---------- crypto helpers ----------
const enc = (s) => new TextEncoder().encode(s);

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc(message)));
  let bin = '';
  sig.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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

// ---------- pages ----------
function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: jsonHeaders('error') });
}

const PAGE_CSS = `
  :root{color-scheme:light;--bg:#f9f9f7;--card:#fcfcfb;--ink:#0b0b0b;--muted:#52514e;--border:rgba(11,11,11,.12);--accent:#2a78d6;--bad:#d03b3b;}
  @media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#0d0d0d;--card:#1a1a19;--ink:#fff;--muted:#c3c2b7;--border:rgba(255,255,255,.12);--accent:#3987e5;--bad:#ff6b6b;}}
  *{box-sizing:border-box} html,body{height:100%}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px 16px;padding-top:calc(24px + env(safe-area-inset-top,0px));}
  .card{width:100%;max-width:380px;background:var(--card);border:1px solid var(--border);border-radius:16px;padding:28px 24px;box-shadow:0 12px 40px rgba(0,0,0,.08);}
  .mark{font-size:34px;line-height:1}
  h1{font-size:20px;margin:10px 0 2px} p{margin:0 0 18px;color:var(--muted);font-size:14px}
  label{display:block;font-size:13px;color:var(--muted);margin-bottom:6px}
  input{width:100%;font:inherit;font-size:17px;padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:transparent;color:var(--ink);}
  input:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:transparent}
  button{width:100%;margin-top:14px;font:inherit;font-weight:600;font-size:16px;padding:12px;border:0;border-radius:10px;background:var(--accent);color:#fff;cursor:pointer}
  button:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
  .err{color:var(--bad);font-size:14px;margin:12px 0 0}
  .foot{margin-top:18px;font-size:12px;color:var(--muted)}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
`;

function shell(title, body, status, extraHead) {
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><title>${title}</title>${extraHead || ''}<style>${PAGE_CSS}</style></head><body>${body}</body></html>`;
  return new Response(html, { status: status || 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
}

function loginPage(url, error, status) {
  const body = `<form class="card" method="post" action="/login" autocomplete="on">
  <div class="mark">🦖</div>
  <h1>Cattasaurus P&amp;L</h1>
  <p>Trang nội bộ — nhập mật khẩu để xem.</p>
  <label for="password">Mật khẩu</label>
  <input id="password" name="password" type="password" autocomplete="current-password" enterkeyhint="go" autofocus required>
  ${error ? `<div class="err" role="alert">${error}</div>` : ''}
  <button type="submit">Vào xem</button>
  <div class="foot">Phiên đăng nhập giữ ${SESSION_DAYS} ngày trên thiết bị này.</div>
</form>`;
  return shell('Cattasaurus P&L — đăng nhập', body, status || 200);
}

function setupPage() {
  const body = `<div class="card">
  <div class="mark">🔧</div>
  <h1>Chưa đặt mật khẩu</h1>
  <p>Trang đã lên nhưng chưa có mật khẩu, nên chưa hiển thị gì.</p>
  <p>Vào Cloudflare → Workers &amp; Pages → dự án này → <b>Settings</b> → <b>Variables and Secrets</b> → Add: tên <code>DASH_PASSWORD</code>, loại <b>Secret</b>, giá trị = mật khẩu bạn chọn → Save, rồi <b>Deployments → Retry deployment</b> (hoặc đẩy một commit mới).</p>
</div>`;
  return shell('Cattasaurus P&L — cần cài đặt', body, 503);
}
