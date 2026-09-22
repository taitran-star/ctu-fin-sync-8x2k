// Cattasaurus Dashboard — the whole server side in ONE file (Cloudflare Pages Functions catch-all).
//
// Every request to the site comes through here:
//   1. password gate  — DASH_PASSWORD (Pages > Settings > Variables and Secrets, type Secret) is the shared
//      password. Not set => the site shows a setup notice. Session = HttpOnly cookie "exp.signature",
//      signature = HMAC-SHA256(DASH_PASSWORD, "sess|" + exp), valid SESSION_DAYS days; changing the password
//      logs every device out. Wrong password => 1.5 s delay + 401. /login, /logout, /robots.txt (public).
//   2. /data/<file>.json — the dashboards' data: proxied from the GitHub repo that the sync workflows commit
//      to (raw.githubusercontent.com, cached at the Cloudflare edge for 5 minutes, ETag/304 to the browser), or the invoice files
//      that live next to this site's pages. Optional env: GH_TOKEN (if the repo is ever made private),
//      DATA_BASE_URL (data moved to another repo).
//   3. everything else — the static pages/files in public/ (index.html hub, pnl.html + pnl.js, icons...).
//      Brand images, icons and the open-licence fonts (/img/*, /fonts/LibreFranklin-*, /fonts/FuzzyBubbles-*) are public so the
//      login page can show them; the licensed Bureau Grot font and everything else stay behind the password.
//      /sw.js (service worker for the installed app: app shell + last data for offline) is public and never cached.

const COOKIE = 'ctu_pnl_sess';
const SESSION_DAYS = 90;

const RAW_BASE = 'https://raw.githubusercontent.com/taitran-star/ctu-fin-sync-8x2k/main/data/';
const REPO_FILES = new Set([
  'amazon_pnl.json', 'meta_ads.json', 'shopify_pnl.json', 'google_ads.json',
  'shipmonk.json', 'paypal.json', 'klaviyo.json', 'amazon_ads.json', 'opex_monthly.json', 'amazon_storage.json',
]);
const STATIC_FILES = new Set(['shipmonk_invoices.json', 'shipmonk_storage_daily.json', 'klaviyo_invoices.json', 'amazon_ads.json']);   // in public/ (amazon_ads: Sellerboard export until the Ads API workflow exists; then it also lives in the repo)
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
  if (path === '/login') return request.method === 'POST' ? handleLogin(request, env, url) : loginPage(url, null);
  if (path === '/logout') return logout(url);

  if (!(await hasValidSession(request, env))) {
    if (path.startsWith('/data/')) return json({ error: 'unauthorized' }, 401);
    return loginPage(url, null, 401);
  }

  if (path.startsWith('/data/')) return asset(await serveData(path.slice('/data/'.length), request, env), 'private, no-cache');
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
// on GitHub has not changed we answer 304 and nothing is downloaded again (the big files are 2-5 MB).
async function serveData(name, request, env) {
  name = decodeURIComponent(name);
  const inm = request.headers.get('If-None-Match') || '';

  if (STATIC_FILES.has(name)) {
    const req = new Request(new URL('/' + name, request.url).toString(), { headers: inm ? { 'If-None-Match': inm } : {} });
    const res = await env.ASSETS.fetch(req);
    if (res.status === 304) return notModified(inm);
    if (res.ok) return new Response(res.body, { status: 200, headers: jsonHeaders('static', res.headers.get('ETag')) });
    if (!REPO_FILES.has(name)) return json({ error: 'static file missing: ' + name }, 404);   // else fall through to the repo copy
  }
  if (!REPO_FILES.has(name)) return json({ error: 'unknown source' }, 404);

  const base = env.DATA_BASE_URL || RAW_BASE;
  const headers = { 'User-Agent': 'cattasaurus-dashboard' };
  if (env.GH_TOKEN) headers['Authorization'] = 'token ' + env.GH_TOKEN;
  if (inm) headers['If-None-Match'] = inm;
  let upstream;
  try {
    upstream = await fetch(base + name, { headers, cf: { cacheTtl: 300, cacheEverything: true } });
  } catch (e) {
    return json({ error: 'upstream fetch failed' }, 502);
  }
  if (upstream.status === 304) return notModified(inm);
  if (upstream.status === 404) return json({ error: 'not in repo yet: ' + name }, 404);
  if (!upstream.ok) return json({ error: 'upstream HTTP ' + upstream.status }, 502);
  const etag = upstream.headers.get('ETag') || '';
  if (etag && inm && inm === etag) return notModified(etag);
  return new Response(upstream.body, { status: 200, headers: jsonHeaders('github', etag) });
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
  @font-face{font-family:'Libre Franklin';font-weight:100 500;font-style:normal;font-display:swap;src:url(/fonts/LibreFranklin-Regular.woff2) format('woff2');}
  @font-face{font-family:'Libre Franklin';font-weight:600 900;font-style:normal;font-display:swap;src:url(/fonts/LibreFranklin-SemiBold.woff2) format('woff2');}
  @font-face{font-family:'Fuzzy Bubbles';font-weight:700;font-style:normal;font-display:swap;src:url(/fonts/FuzzyBubbles-Bold.woff2) format('woff2');}
  :root{color-scheme:light;--pistachio:#C9E595;--pine:#05372E;--forest:#285D18;--band-bg:#C9E595;--band-ink:#05372E;--bg:#f2f6e6;--card:#ffffff;--ink:#05372E;--muted:#33544a;--border:rgba(5,55,46,.14);--solid:#05372E;--solid-ink:#C9E595;--bad:#b3261e;}
  @media (prefers-color-scheme:dark){:root{color-scheme:dark;--band-bg:#05372E;--band-ink:#C9E595;--bg:#0b1f1b;--card:#123029;--ink:#eef5df;--muted:#c3d3b3;--border:rgba(201,229,149,.16);--solid:#C9E595;--solid-ink:#05372E;--forest:#b9da7a;--bad:#f06a6a;}}
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
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
`;

function shell(title, body, status, extraHead) {
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><title>${title}</title><link rel="icon" type="image/png" sizes="64x64" href="/favicon.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><meta name="theme-color" content="#f2f6e6" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#0b1f1b" media="(prefers-color-scheme: dark)">${extraHead || ''}<style>${PAGE_CSS}</style></head><body>${body}</body></html>`;
  return new Response(html, { status: status || 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
}

function loginPage(url, error, status) {
  const body = `<form class="card" method="post" action="/login" autocomplete="on">
  <div class="band"><div class="band-text"><div class="eyebrow">Dashboard nội bộ</div><img class="wm light" src="/img/logo-h-pine.png" alt="Cattasaurus" width="1000" height="327"><img class="wm dark" src="/img/logo-h-pistachio.png" alt="" aria-hidden="true" width="1000" height="327"><div class="fun">meow… ai đó?</div></div><img class="mascot" src="/img/mascot-curious.png" alt="" aria-hidden="true" width="556" height="720"></div>
  <div class="body">
  <h1>Đăng nhập</h1>
  <p>Trang nội bộ — nhập mật khẩu để xem số liệu.</p>
  <label for="password">Mật khẩu</label>
  <input id="password" name="password" type="password" autocomplete="current-password" enterkeyhint="go" autofocus required>
  ${error ? `<div class="err" role="alert">${error}</div>` : ''}
  <button type="submit">Vào xem</button>
  <div class="foot">Phiên đăng nhập giữ ${SESSION_DAYS} ngày trên thiết bị này.</div>
  </div>
</form>`;
  return shell('Cattasaurus Dashboard — đăng nhập', body, status || 200);
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
