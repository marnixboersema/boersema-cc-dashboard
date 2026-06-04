// Routing Middleware — runs before EVERY request (static files and /api alike)
// and locks the whole dashboard behind a single shared password.
//
// Nothing is served without a valid session cookie:
//   - unauthenticated page requests  -> the login page below
//   - unauthenticated /api/* requests -> 401 JSON
// The password lives only in the DASHBOARD_PASSWORD env var (set in Vercel) and
// is never sent to the browser. See lib/auth.js for the token design.

import { next } from '@vercel/functions';
import {
  COOKIE_NAME,
  SESSION_MS,
  passwordMatches,
  createToken,
  verifyToken,
} from './lib/auth.js';

export default async function middleware(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  const password = process.env.DASHBOARD_PASSWORD;
  const secure = url.protocol === 'https:';

  // Fail closed: if no password is configured, deny everything rather than
  // silently leaving the dashboard wide open.
  if (!password) {
    return text(
      503,
      'Dashboard is nie opgestel nie: stel die DASHBOARD_PASSWORD-omgewingsveranderlike in Vercel.'
    );
  }

  // --- Login ---
  if (path === '/api/login' && request.method === 'POST') {
    const ctype = request.headers.get('content-type') || '';
    const isJson = ctype.includes('application/json');
    let submitted = '';
    try {
      if (isJson) {
        submitted = (await request.json())?.password ?? '';
      } else {
        submitted = (await request.formData()).get('password') ?? '';
      }
    } catch {
      submitted = '';
    }

    if (await passwordMatches(submitted, password)) {
      const token = await createToken(password, Date.now());
      const setCookie = cookie(token, SESSION_MS, secure);
      return isJson
        ? json(200, { ok: true }, setCookie)
        : redirect('/', setCookie);
    }
    return isJson
      ? json(401, { ok: false })
      : new Response(loginPage(true), {
          status: 401,
          headers: htmlHeaders(),
        });
  }

  // --- Logout (clears the cookie) ---
  if (path === '/logout' || path === '/api/logout') {
    return redirect('/', cookie('', 0, secure));
  }

  // --- Gate everything else ---
  const token = readCookie(request, COOKIE_NAME);
  if (await verifyToken(token, password, Date.now())) {
    return next();
  }

  if (path.startsWith('/api/')) {
    return json(401, { error: 'unauthorized' });
  }
  return new Response(loginPage(false), { status: 200, headers: htmlHeaders() });
}

// === Response helpers ===

function cookie(value, maxAgeMs, secure) {
  const parts = [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function readCookie(request, name) {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function htmlHeaders() {
  return { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
}

function json(status, body, setCookie) {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  if (setCookie) headers['set-cookie'] = setCookie;
  return new Response(JSON.stringify(body), { status, headers });
}

function text(status, body) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function redirect(location, setCookie) {
  const headers = { location, 'cache-control': 'no-store' };
  if (setCookie) headers['set-cookie'] = setCookie;
  return new Response(null, { status: 302, headers });
}

// === Login page (self-contained: inline styles + script, matches the dashboard) ===

function loginPage(showError) {
  return `<!DOCTYPE html>
<html lang="af">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#FAF7F2">
<title>CC Dashboard</title>
<style>
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body {
    margin: 0; min-height: 100vh;
    background: #FAF7F2; color: #2A2A2A;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    display: flex; align-items: center; justify-content: center;
    padding: 1.5rem; padding-top: calc(1.5rem + env(safe-area-inset-top));
    -webkit-font-smoothing: antialiased;
  }
  .card {
    background: #fff; border-radius: 16px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    padding: 2.25rem 1.75rem; width: 100%; max-width: 380px; text-align: center;
  }
  .icon { font-size: 2.5rem; line-height: 1; margin-bottom: 0.5rem; }
  h1 {
    font-size: 1.5rem; font-weight: 700; letter-spacing: 0.05em;
    color: #1B4D7E; margin: 0 0 0.35rem;
  }
  p.sub { color: #6B6B6B; margin: 0 0 1.5rem; font-size: 0.95rem; }
  form { display: flex; flex-direction: column; gap: 0.85rem; }
  input[type=password] {
    font: inherit; padding: 0.85rem 1rem; border-radius: 12px;
    border: 1px solid rgba(42,42,42,0.2); background: #FAF7F2;
    text-align: center; letter-spacing: 0.1em; color: #2A2A2A;
  }
  input[type=password]:focus {
    outline: 2px solid #1B4D7E; outline-offset: 1px; background: #fff;
  }
  button {
    font: inherit; font-weight: 600; padding: 0.85rem 1rem; border: none;
    border-radius: 12px; background: #1B4D7E; color: #fff; cursor: pointer;
    min-height: 48px;
  }
  button:active { transform: scale(0.98); }
  button:disabled { opacity: 0.6; cursor: progress; }
  .err {
    color: #8B2E22; background: #FDECEA; border: 1px solid #C44536;
    border-radius: 12px; padding: 0.6rem; font-size: 0.9rem; margin: 0;
    display: ${showError ? 'block' : 'none'};
  }
  .err.show { display: block; }
</style>
</head>
<body>
  <main class="card">
    <div class="icon">🔒</div>
    <h1>CC Dashboard</h1>
    <p class="sub">Voer die wagwoord in om voort te gaan.</p>
    <form id="f" method="POST" action="/api/login">
      <input id="p" type="password" name="password" placeholder="Wagwoord"
             autocomplete="current-password" autofocus required>
      <p class="err" id="e">Verkeerde wagwoord. Probeer weer.</p>
      <button id="b" type="submit">Sluit oop</button>
    </form>
  </main>
  <script>
    const f = document.getElementById('f');
    const p = document.getElementById('p');
    const e = document.getElementById('e');
    const b = document.getElementById('b');
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      e.classList.remove('show');
      b.disabled = true;
      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password: p.value }),
        });
        if (res.ok) { location.reload(); return; }
      } catch (_) {}
      b.disabled = false;
      e.classList.add('show');
      p.value = '';
      p.focus();
    });
  </script>
</body>
</html>`;
}
