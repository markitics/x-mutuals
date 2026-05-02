export interface Env {
  CACHE: KVNamespace;
  X_CONSUMER_KEY: string;
  X_SECRET_KEY: string;
  X_ACCESS_TOKEN: string;
  X_ACCESS_TOKEN_SECRET: string;
  X_BEARER_TOKEN: string;
}

interface XUser {
  id: string;
  name: string;
  username: string;
  public_metrics?: { followers_count: number; following_count: number };
  description?: string;
}

interface Mutual {
  id: string;
  name: string;
  username: string;
  followers: number;
  bio: string;
}

interface MutualsResult {
  target: { id: string; name: string; username: string };
  mutuals: Mutual[];
  stats: {
    myFollowersChecked: number;
    targetFollowingChecked: number;
    mutualsFound: number;
    estimatedCostUsd: string;
  };
  fetchedAt: string;
}

const MAX_FOLLOWERS = 5000;
const MAX_FOLLOWING = 2500;
const CACHE_TTL = 86400;
const AUTH_COOKIE = "tm_auth";
const AUTH_VALUE = "mark_true_mutuals_v1";
const PASSWORD = "grow";

// ── routing ──────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/mutuals") {
      if (!isAuthed(request)) return json({ error: "Unauthorized" }, 401);
      return handleMutuals(url, env);
    }

    if (url.pathname === "/app") {
      if (request.method === "POST") return handleLogin(request, url);
      return isAuthed(request) ? appPage() : loginForm(false);
    }

    if (url.pathname === "/login") return comingSoonPage();

    return landingPage();
  },
} satisfies ExportedHandler<Env>;

// ── auth ─────────────────────────────────────────────────────────────────────

function isAuthed(request: Request): boolean {
  const cookie = request.headers.get("Cookie") ?? "";
  return cookie.split(";").some(c => c.trim() === `${AUTH_COOKIE}=${AUTH_VALUE}`);
}

async function handleLogin(request: Request, url: URL): Promise<Response> {
  const body = await request.formData();
  if (body.get("password") === PASSWORD) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/app",
        "Set-Cookie": `${AUTH_COOKIE}=${AUTH_VALUE}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`,
      },
    });
  }
  return loginForm(true);
}

// ── pages ─────────────────────────────────────────────────────────────────────

function landingPage(): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>True Mutuals</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f0f0f;
      color: #fff;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      max-width: 520px;
      width: 100%;
      text-align: center;
    }
    .eyebrow {
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #1d9bf0;
      margin-bottom: 20px;
    }
    h1 {
      font-size: clamp(36px, 8vw, 56px);
      font-weight: 800;
      letter-spacing: -1.5px;
      line-height: 1.05;
      margin-bottom: 20px;
    }
    h1 span { color: #1d9bf0; }
    p {
      font-size: 17px;
      line-height: 1.65;
      color: #999;
      margin-bottom: 40px;
      max-width: 400px;
      margin-left: auto;
      margin-right: auto;
    }
    .buttons {
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-width: 320px;
      margin: 0 auto;
    }
    .btn {
      display: block;
      padding: 16px 24px;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      text-decoration: none;
      transition: opacity .15s, transform .1s;
    }
    .btn:active { transform: scale(.98); }
    .btn-primary {
      background: #1d9bf0;
      color: #fff;
    }
    .btn-primary:hover { opacity: .9; }
    .btn-secondary {
      background: #1a1a1a;
      color: #555;
      border: 1px solid #222;
      cursor: not-allowed;
    }
    .btn-secondary small {
      display: block;
      font-size: 12px;
      font-weight: 400;
      margin-top: 2px;
      color: #444;
    }
    .divider {
      display: flex;
      align-items: center;
      gap: 12px;
      color: #333;
      font-size: 12px;
    }
    .divider::before, .divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: #222;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="eyebrow">Early access</div>
    <h1>Find your <span>warm intros</span> on X</h1>
    <p>See who your followers have in common with anyone you want to meet — before you send that cold DM.</p>
    <div class="buttons">
      <a href="/app" class="btn btn-primary">I'm Mark &rarr;</a>
      <div class="divider">or</div>
      <a href="/login" class="btn btn-secondary">
        Sign in with X
        <small>Coming soon for everyone else</small>
      </a>
    </div>
  </div>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function loginForm(wrongPassword: boolean): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>True Mutuals — Sign in</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f0f0f; color: #fff;
      min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px;
    }
    .card {
      background: #161616; border: 1px solid #222; border-radius: 16px;
      padding: 40px; max-width: 360px; width: 100%; text-align: center;
    }
    h2 { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
    p { color: #666; font-size: 14px; margin-bottom: 28px; }
    input {
      width: 100%; padding: 13px 16px; background: #111; border: 1.5px solid #2a2a2a;
      border-radius: 10px; color: #fff; font-size: 18px; text-align: center;
      letter-spacing: 6px; outline: none; margin-bottom: 12px;
    }
    input:focus { border-color: #1d9bf0; }
    input::placeholder { letter-spacing: 1px; color: #444; font-size: 14px; }
    button {
      width: 100%; padding: 13px; background: #1d9bf0; color: #fff; border: none;
      border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer;
    }
    button:hover { opacity: .9; }
    .error { color: #e0245e; font-size: 13px; margin-top: 10px; }
    .back { display: block; margin-top: 20px; color: #444; font-size: 13px; text-decoration: none; }
    .back:hover { color: #888; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Welcome back, Mark</h2>
    <p>Enter your passphrase to continue</p>
    <form method="POST" action="/app">
      <input type="password" name="password" placeholder="passphrase" autofocus autocomplete="off">
      <button type="submit">Continue &rarr;</button>
      ${wrongPassword ? '<p class="error">Wrong passphrase — try again</p>' : ''}
    </form>
    <a href="/" class="back">&larr; Back</a>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: wrongPassword ? 401 : 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function comingSoonPage(): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>True Mutuals — Coming Soon</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f0f0f; color: #fff;
      min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px;
    }
    .card { max-width: 440px; width: 100%; text-align: center; }
    .tag {
      display: inline-block; background: #1a1a1a; border: 1px solid #222;
      color: #555; font-size: 11px; font-weight: 600; letter-spacing: 1.5px;
      text-transform: uppercase; padding: 5px 14px; border-radius: 20px; margin-bottom: 24px;
    }
    h1 { font-size: 32px; font-weight: 800; margin-bottom: 14px; letter-spacing: -.5px; }
    p { color: #666; font-size: 16px; line-height: 1.6; margin-bottom: 32px; }
    a { color: #1d9bf0; text-decoration: none; font-size: 14px; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <div class="tag">Coming soon</div>
    <h1>Sign in with X</h1>
    <p>Multi-user login is in the works. When it's ready, you'll be able to use True Mutuals with your own X account.</p>
    <a href="/">&larr; Back to home</a>
  </div>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function appPage(): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>True Mutuals</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; color: #111; min-height: 100vh; }
    .container { max-width: 640px; margin: 0 auto; padding: 48px 20px; }
    h1 { font-size: 26px; font-weight: 700; margin-bottom: 4px; }
    .subtitle { color: #888; font-size: 14px; margin-bottom: 24px; }
    .search { display: flex; gap: 8px; margin-bottom: 20px; }
    .search input { flex: 1; padding: 11px 14px; border: 1.5px solid #ddd; border-radius: 8px; font-size: 16px; outline: none; }
    .search input:focus { border-color: #1d9bf0; }
    .search button { padding: 11px 22px; background: #1d9bf0; color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; }
    .search button:hover { background: #1a8cd8; }
    .search button:disabled { background: #93c8f8; cursor: not-allowed; }
    #status { font-size: 14px; color: #888; min-height: 20px; margin-bottom: 16px; }
    #status.error { color: #e0245e; }
    .stats { display: flex; gap: 20px; flex-wrap: wrap; background: #fff; border: 1px solid #e5e5e5; border-radius: 10px; padding: 14px 18px; margin-bottom: 16px; font-size: 13px; color: #666; }
    .stats b { display: block; font-size: 20px; font-weight: 700; color: #111; }
    .cached { font-size: 11px; color: #999; background: #f0f0f0; padding: 2px 8px; border-radius: 10px; display: inline-block; margin-bottom: 10px; }
    .card { background: #fff; border: 1px solid #e5e5e5; border-radius: 10px; padding: 13px 16px; margin-bottom: 8px; display: flex; align-items: flex-start; gap: 12px; }
    .card-info { flex: 1; min-width: 0; }
    .card-name { font-weight: 600; font-size: 15px; }
    .card-handle { color: #1d9bf0; font-size: 13px; text-decoration: none; }
    .card-handle:hover { text-decoration: underline; }
    .card-bio { font-size: 13px; color: #555; margin-top: 3px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .card-followers { text-align: right; font-size: 12px; color: #888; white-space: nowrap; }
    .card-followers b { display: block; font-size: 15px; font-weight: 700; color: #111; }
    .hidden { display: none; }
    .signout { float: right; font-size: 12px; color: #bbb; text-decoration: none; margin-top: 4px; }
    .signout:hover { color: #888; }
  </style>
</head>
<body>
  <div class="container">
    <div style="display:flex;align-items:baseline;justify-content:space-between">
      <div>
        <h1>True Mutuals</h1>
        <p class="subtitle">Who follows you AND follows them?</p>
      </div>
      <a href="/" class="signout">← home</a>
    </div>
    <div class="search">
      <input id="q" type="text" placeholder="@username" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false">
      <button id="btn" onclick="lookup()">Look up</button>
    </div>
    <div id="status"></div>
    <div id="out" class="hidden">
      <div id="cached" class="cached hidden">cached result</div>
      <div id="stats" class="stats"></div>
      <div id="results"></div>
    </div>
  </div>
  <script>
    document.getElementById('q').addEventListener('keydown', function(e) { if (e.key === 'Enter') lookup(); });
    function esc(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    async function lookup() {
      var q = document.getElementById('q').value.trim().replace(/^@/,'');
      if (!q) return;
      var btn = document.getElementById('btn');
      var status = document.getElementById('status');
      var out = document.getElementById('out');
      btn.disabled = true;
      status.className = '';
      status.textContent = 'Fetching — first run may take up to 30 seconds…';
      out.classList.add('hidden');
      try {
        var resp = await fetch('/api/mutuals?target=' + encodeURIComponent(q));
        var data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Unknown error');
        status.textContent = '';
        document.getElementById('cached').classList.toggle('hidden', !data.cached);
        document.getElementById('stats').innerHTML =
          '<div><b>' + data.mutuals.length + '</b>mutuals found</div>' +
          '<div><b>' + data.stats.myFollowersChecked.toLocaleString() + '</b>your followers</div>' +
          '<div><b>' + data.stats.targetFollowingChecked.toLocaleString() + '</b>@' + esc(data.target.username) + ' following</div>' +
          '<div><b>$' + data.stats.estimatedCostUsd + '</b>est. API cost</div>';
        if (data.mutuals.length === 0) {
          document.getElementById('results').innerHTML = '<p style="color:#888;padding:8px 0">No mutuals found.</p>';
        } else {
          document.getElementById('results').innerHTML = data.mutuals.map(function(u) {
            return '<div class="card">' +
              '<div class="card-info">' +
              '<div class="card-name">' + esc(u.name) + '</div>' +
              '<a class="card-handle" href="https://x.com/' + esc(u.username) + '" target="_blank" rel="noopener">@' + esc(u.username) + '</a>' +
              (u.bio ? '<div class="card-bio">' + esc(u.bio) + '</div>' : '') +
              '</div>' +
              '<div class="card-followers"><b>' + Number(u.followers).toLocaleString() + '</b>followers</div>' +
              '</div>';
          }).join('');
        }
        out.classList.remove('hidden');
      } catch(e) {
        status.className = 'error';
        status.textContent = 'Error: ' + e.message;
      } finally {
        btn.disabled = false;
      }
    }
  </script>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// ── X API ─────────────────────────────────────────────────────────────────────

function pctEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/!/g, "%21").replace(/'/g, "%27")
    .replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\*/g, "%2A");
}

async function oauthHeader(
  method: string,
  baseUrl: string,
  queryParams: Record<string, string>,
  env: Env
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: env.X_CONSUMER_KEY,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: env.X_ACCESS_TOKEN,
    oauth_version: "1.0",
  };
  const all = { ...queryParams, ...oauthParams };
  const paramStr = Object.keys(all).sort()
    .map(k => `${pctEncode(k)}=${pctEncode(all[k])}`).join("&");
  const baseString = `${method}&${pctEncode(baseUrl)}&${pctEncode(paramStr)}`;
  const signingKey = `${pctEncode(env.X_SECRET_KEY)}&${pctEncode(env.X_ACCESS_TOKEN_SECRET)}`;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(signingKey),
    { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
  );
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(baseString));
  const sig = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return "OAuth " + Object.entries({ ...oauthParams, oauth_signature: sig })
    .map(([k, v]) => `${pctEncode(k)}="${pctEncode(v)}"`).join(", ");
}

async function getMyUserId(env: Env): Promise<string> {
  const cached = await env.CACHE.get("me:id");
  if (cached) return cached;
  const url = "https://api.twitter.com/2/users/me";
  const auth = await oauthHeader("GET", url, {}, env);
  const resp = await fetch(url, { headers: { Authorization: auth } });
  if (!resp.ok) throw new Error(`/users/me failed: ${resp.status} ${await resp.text()}`);
  const { data } = await resp.json<{ data: XUser }>();
  await env.CACHE.put("me:id", data.id, { expirationTtl: 86400 * 7 });
  return data.id;
}

async function resolveUsername(username: string, env: Env): Promise<XUser | null> {
  const cacheKey = `user:${username.toLowerCase()}`;
  const cached = await env.CACHE.get<XUser>(cacheKey, "json");
  if (cached) return cached;
  const resp = await fetch(`https://api.twitter.com/2/users/by/username/${username}`, {
    headers: { Authorization: `Bearer ${env.X_BEARER_TOKEN}` },
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Lookup @${username} failed: ${resp.status} ${await resp.text()}`);
  const { data } = await resp.json<{ data: XUser }>();
  await env.CACHE.put(cacheKey, JSON.stringify(data), { expirationTtl: CACHE_TTL });
  return data;
}

async function fetchFollowers(myId: string, env: Env): Promise<XUser[]> {
  const users: XUser[] = [];
  let nextToken: string | undefined;
  const baseUrl = `https://api.twitter.com/2/users/${myId}/followers`;
  while (users.length < MAX_FOLLOWERS) {
    const qp: Record<string, string> = {
      max_results: String(Math.min(1000, MAX_FOLLOWERS - users.length)),
      "user.fields": "public_metrics,description",
    };
    if (nextToken) qp.pagination_token = nextToken;
    const auth = await oauthHeader("GET", baseUrl, qp, env);
    const url = new URL(baseUrl);
    for (const [k, v] of Object.entries(qp)) url.searchParams.set(k, v);
    const resp = await fetch(url.toString(), { headers: { Authorization: auth } });
    if (resp.status === 429) throw new Error("RATE_LIMITED");
    if (!resp.ok) throw new Error(`Followers failed: ${resp.status} ${await resp.text()}`);
    const body = await resp.json<{ data?: XUser[]; meta?: { next_token?: string } }>();
    if (body.data) users.push(...body.data);
    nextToken = body.meta?.next_token;
    if (!nextToken) break;
  }
  return users;
}

async function fetchFollowing(targetId: string, env: Env): Promise<XUser[]> {
  const users: XUser[] = [];
  let nextToken: string | undefined;
  const baseUrl = `https://api.twitter.com/2/users/${targetId}/following`;
  while (users.length < MAX_FOLLOWING) {
    const url = new URL(baseUrl);
    url.searchParams.set("max_results", String(Math.min(1000, MAX_FOLLOWING - users.length)));
    url.searchParams.set("user.fields", "public_metrics,description");
    if (nextToken) url.searchParams.set("pagination_token", nextToken);
    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${env.X_BEARER_TOKEN}` },
    });
    if (resp.status === 429) throw new Error("RATE_LIMITED");
    if (!resp.ok) throw new Error(`Following failed: ${resp.status} ${await resp.text()}`);
    const body = await resp.json<{ data?: XUser[]; meta?: { next_token?: string } }>();
    if (body.data) users.push(...body.data);
    nextToken = body.meta?.next_token;
    if (!nextToken) break;
  }
  return users;
}

async function handleMutuals(url: URL, env: Env): Promise<Response> {
  const target = url.searchParams.get("target")?.replace(/^@/, "").trim();
  if (!target) return json({ error: "Missing ?target= parameter" }, 400);
  try {
    const [myId, targetUser] = await Promise.all([
      getMyUserId(env),
      resolveUsername(target, env),
    ]);
    if (!targetUser) return json({ error: `@${target} not found` }, 404);
    const cacheKey = `mutuals:${myId}:${targetUser.id}`;
    const cached = await env.CACHE.get<MutualsResult>(cacheKey, "json");
    if (cached) return json({ ...cached, cached: true });
    const [myFollowers, targetFollowing] = await Promise.all([
      fetchFollowers(myId, env),
      fetchFollowing(targetUser.id, env),
    ]);
    const followerIds = new Set(myFollowers.map(u => u.id));
    const mutuals: Mutual[] = targetFollowing
      .filter(u => followerIds.has(u.id))
      .sort((a, b) => (a.public_metrics?.followers_count ?? 0) - (b.public_metrics?.followers_count ?? 0))
      .map(u => ({
        id: u.id,
        name: u.name,
        username: u.username,
        followers: u.public_metrics?.followers_count ?? 0,
        bio: (u.description ?? "").slice(0, 160),
      }));
    const result: MutualsResult = {
      target: { id: targetUser.id, name: targetUser.name, username: targetUser.username },
      mutuals,
      stats: {
        myFollowersChecked: myFollowers.length,
        targetFollowingChecked: targetFollowing.length,
        mutualsFound: mutuals.length,
        estimatedCostUsd: (myFollowers.length * 0.001 + targetFollowing.length * 0.005).toFixed(4),
      },
      fetchedAt: new Date().toISOString(),
    };
    await env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: CACHE_TTL });
    return json({ ...result, cached: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "RATE_LIMITED") return json({ error: "X API rate limit — try again in 15 min" }, 429);
    console.error("mutuals error:", msg);
    return json({ error: msg }, 500);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
