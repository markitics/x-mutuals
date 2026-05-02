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
  verified?: boolean;
  public_metrics?: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
    listed_count: number;
  };
  description?: string;
  profile_image_url?: string;
  created_at?: string;
  location?: string;
  url?: string;
  entities?: { url?: { urls?: Array<{ expanded_url: string }> } };
}

interface Mutual {
  id: string;
  name: string;
  username: string;
  verified: boolean;
  followers: number;
  following: number;
  tweets: number;
  listed: number;
  bio: string;
  avatar: string;
  location: string;
  website: string;
  joinedAt: string;
}

interface MutualsResult {
  id: string;
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
const CACHE_TTL_24H = 86400;
const AUTH_COOKIE = "tm_auth";
const AUTH_VALUE = "mark_true_mutuals_v1";
const PASSWORD = "grow";

const USER_FIELDS = "public_metrics,description,verified,profile_image_url,created_at,location,url,entities";

// ── routing ───────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // API: fetch mutuals (auth required)
    if (path === "/api/mutuals") {
      if (!isAuthed(request)) return json({ error: "Unauthorized" }, 401);
      return handleMutuals(url, env);
    }

    // API: load saved result by ID (auth required)
    if (path.startsWith("/api/result/")) {
      if (!isAuthed(request)) return json({ error: "Unauthorized" }, 401);
      const id = path.slice("/api/result/".length);
      const saved = await env.CACHE.get<MutualsResult>(`result:${id}`, "json");
      if (!saved) return json({ error: "Result not found" }, 404);
      return json({ ...saved, cached: true });
    }

    // App: password gate → search + results UI
    if (path === "/app" || path.startsWith("/r/")) {
      if (request.method === "POST") return handleLogin(request);
      if (!isAuthed(request)) return loginForm(false);
      const preloadId = path.startsWith("/r/") ? path.slice(3) : null;
      return appPage(preloadId);
    }

    // Login/auth form (unauthenticated POST)
    if (path === "/auth" && request.method === "POST") return handleLogin(request);

    // Coming soon for others
    if (path === "/login") return comingSoonPage();

    // Root landing
    return landingPage();
  },
} satisfies ExportedHandler<Env>;

// ── auth ──────────────────────────────────────────────────────────────────────

function isAuthed(request: Request): boolean {
  const cookie = request.headers.get("Cookie") ?? "";
  return cookie.split(";").some(c => c.trim() === `${AUTH_COOKIE}=${AUTH_VALUE}`);
}

async function handleLogin(request: Request): Promise<Response> {
  const body = await request.formData();
  if (body.get("password") === PASSWORD) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/app",
        "Set-Cookie": `${AUTH_COOKIE}=${AUTH_VALUE}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=7776000`,
      },
    });
  }
  return loginForm(true);
}

// ── pages ─────────────────────────────────────────────────────────────────────

function html(content: string): Response {
  return new Response(content, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function landingPage(): Response {
  return html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>True Mutuals</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f0f0f;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{max-width:520px;width:100%;text-align:center}
    .eyebrow{font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#1d9bf0;margin-bottom:20px}
    h1{font-size:clamp(36px,8vw,56px);font-weight:800;letter-spacing:-1.5px;line-height:1.05;margin-bottom:20px}
    h1 span{color:#1d9bf0}
    p{font-size:17px;line-height:1.65;color:#999;margin-bottom:40px;max-width:400px;margin-left:auto;margin-right:auto}
    .buttons{display:flex;flex-direction:column;gap:12px;max-width:320px;margin:0 auto}
    .btn{display:block;padding:16px 24px;border-radius:12px;font-size:16px;font-weight:600;text-decoration:none;transition:opacity .15s,transform .1s}
    .btn:active{transform:scale(.98)}
    .btn-primary{background:#1d9bf0;color:#fff}
    .btn-primary:hover{opacity:.9}
    .btn-secondary{background:#1a1a1a;color:#555;border:1px solid #222;cursor:not-allowed}
    .btn-secondary small{display:block;font-size:12px;font-weight:400;margin-top:2px;color:#444}
    .divider{display:flex;align-items:center;gap:12px;color:#333;font-size:12px}
    .divider::before,.divider::after{content:'';flex:1;height:1px;background:#222}
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
      <a href="/login" class="btn btn-secondary">Sign in with X<small>Coming soon for everyone else</small></a>
    </div>
  </div>
</body>
</html>`);
}

function loginForm(wrong: boolean): Response {
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>True Mutuals</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f0f0f;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#161616;border:1px solid #222;border-radius:16px;padding:40px;max-width:360px;width:100%;text-align:center}
    h2{font-size:22px;font-weight:700;margin-bottom:8px}
    p{color:#666;font-size:14px;margin-bottom:28px}
    input{width:100%;padding:13px 16px;background:#111;border:1.5px solid #2a2a2a;border-radius:10px;color:#fff;font-size:18px;text-align:center;letter-spacing:6px;outline:none;margin-bottom:12px}
    input:focus{border-color:#1d9bf0}
    input::placeholder{letter-spacing:1px;color:#444;font-size:14px}
    button{width:100%;padding:13px;background:#1d9bf0;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer}
    button:hover{opacity:.9}
    .error{color:#e0245e;font-size:13px;margin-top:10px}
    .back{display:block;margin-top:20px;color:#444;font-size:13px;text-decoration:none}
    .back:hover{color:#888}
  </style>
</head>
<body>
  <div class="card">
    <h2>Welcome back, Mark</h2>
    <p>Enter your passphrase</p>
    <form method="POST" action="/app">
      <input type="password" name="password" placeholder="passphrase" autofocus autocomplete="off">
      <button type="submit">Continue &rarr;</button>
      ${wrong ? '<p class="error">Wrong passphrase</p>' : ''}
    </form>
    <a href="/" class="back">&larr; Back</a>
  </div>
</body>
</html>`, { status: wrong ? 401 : 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function comingSoonPage(): Response {
  return html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>True Mutuals — Coming Soon</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f0f0f;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{max-width:440px;width:100%;text-align:center}
    .tag{display:inline-block;background:#1a1a1a;border:1px solid #222;color:#555;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;padding:5px 14px;border-radius:20px;margin-bottom:24px}
    h1{font-size:32px;font-weight:800;margin-bottom:14px;letter-spacing:-.5px}
    p{color:#666;font-size:16px;line-height:1.6;margin-bottom:32px}
    a{color:#1d9bf0;text-decoration:none;font-size:14px}
    a:hover{text-decoration:underline}
  </style>
</head>
<body>
  <div class="card">
    <div class="tag">Coming soon</div>
    <h1>Sign in with X</h1>
    <p>Multi-user login is in the works. When it's ready, you'll be able to use True Mutuals with your own account.</p>
    <a href="/">&larr; Back</a>
  </div>
</body>
</html>`);
}

function appPage(preloadId: string | null): Response {
  return html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>True Mutuals</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;color:#111;min-height:100vh}
    .container{max-width:680px;margin:0 auto;padding:40px 20px}
    .topbar{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:24px}
    h1{font-size:24px;font-weight:700}
    .home{font-size:12px;color:#bbb;text-decoration:none}
    .home:hover{color:#888}
    .search{display:flex;gap:8px;margin-bottom:16px}
    .search input{flex:1;padding:11px 14px;border:1.5px solid #ddd;border-radius:8px;font-size:16px;outline:none;background:#fff}
    .search input:focus{border-color:#1d9bf0}
    .search button{padding:11px 22px;background:#1d9bf0;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;white-space:nowrap}
    .search button:hover{background:#1a8cd8}
    .search button:disabled{background:#93c8f8;cursor:not-allowed}
    #status{font-size:14px;color:#888;min-height:20px;margin-bottom:12px}
    #status.error{color:#e0245e}
    .meta{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px}
    .stats{display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:#666}
    .stats b{font-weight:700;color:#111}
    .permalink{font-size:12px;color:#1d9bf0;text-decoration:none;background:#e8f5fe;padding:4px 10px;border-radius:6px;white-space:nowrap}
    .permalink:hover{background:#d0eafb}
    .card{background:#fff;border:1px solid #e5e5e5;border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;gap:12px}
    .avatar{width:44px;height:44px;border-radius:50%;flex-shrink:0;background:#e5e5e5;object-fit:cover}
    .info{flex:1;min-width:0}
    .name-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
    .name{font-weight:600;font-size:15px}
    .check{color:#1d9bf0;font-size:13px}
    .handle{color:#1d9bf0;font-size:13px;text-decoration:none}
    .handle:hover{text-decoration:underline}
    .bio{font-size:13px;color:#555;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
    .chip{font-size:11px;color:#888;background:#f5f5f5;padding:2px 8px;border-radius:10px;white-space:nowrap}
    .chip b{color:#555;font-weight:600}
    .followers-col{text-align:right;flex-shrink:0;font-size:12px;color:#888;white-space:nowrap;padding-top:2px}
    .followers-col b{display:block;font-size:16px;font-weight:700;color:#111;line-height:1.2}
    .hidden{display:none}
    .fetched{font-size:11px;color:#bbb;margin-top:4px}
  </style>
</head>
<body>
  <div class="container">
    <div class="topbar">
      <h1>True Mutuals</h1>
      <a href="/" class="home">&larr; home</a>
    </div>
    <div class="search">
      <input id="q" type="text" placeholder="@username" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false">
      <button id="btn" onclick="lookup()">Look up</button>
    </div>
    <div id="status"></div>
    <div id="out" class="hidden">
      <div class="meta">
        <div id="stats" class="stats"></div>
        <a id="plink" class="permalink hidden" href="#">permalink</a>
      </div>
      <p id="fetched" class="fetched"></p>
      <div id="results" style="margin-top:12px"></div>
    </div>
  </div>
  <script>
    var PRELOAD_ID = ${preloadId ? JSON.stringify(preloadId) : 'null'};

    document.getElementById('q').addEventListener('keydown', function(e){ if(e.key==='Enter') lookup(); });

    if(PRELOAD_ID) {
      document.getElementById('status').textContent = 'Loading saved result…';
      loadResult(PRELOAD_ID);
    }

    function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    function fmtNum(n){ return Number(n).toLocaleString(); }

    function fmtDate(iso){
      if(!iso) return '';
      var d = new Date(iso);
      return d.toLocaleDateString('en-US', {year:'numeric',month:'short'});
    }

    function renderResult(data) {
      document.getElementById('stats').innerHTML =
        '<span><b>' + data.mutuals.length + '</b> mutuals</span>' +
        '<span><b>' + fmtNum(data.stats.myFollowersChecked) + '</b> your followers scanned</span>' +
        '<span><b>' + fmtNum(data.stats.targetFollowingChecked) + '</b> @' + esc(data.target.username) + ' following scanned</span>' +
        '<span><b>$' + data.stats.estimatedCostUsd + '</b> API cost</span>';

      if(data.id) {
        var pl = document.getElementById('plink');
        pl.href = '/r/' + data.id;
        pl.textContent = 'permalink →';
        pl.classList.remove('hidden');
        history.replaceState(null, '', '/r/' + data.id);
      }

      document.getElementById('fetched').textContent = data.fetchedAt ? 'Fetched ' + new Date(data.fetchedAt).toLocaleString() : '';

      if(data.mutuals.length === 0) {
        document.getElementById('results').innerHTML = '<p style="color:#888;padding:8px 0">No mutuals found.</p>';
      } else {
        document.getElementById('results').innerHTML = data.mutuals.map(function(u){
          var chips = [];
          if(u.followers !== undefined) chips.push('<span class="chip"><b>' + fmtNum(u.followers) + '</b> followers</span>');
          if(u.following !== undefined) chips.push('<span class="chip"><b>' + fmtNum(u.following) + '</b> following</span>');
          if(u.tweets) chips.push('<span class="chip"><b>' + fmtNum(u.tweets) + '</b> tweets</span>');
          if(u.joinedAt) chips.push('<span class="chip">Joined <b>' + fmtDate(u.joinedAt) + '</b></span>');
          if(u.location) chips.push('<span class="chip">' + esc(u.location) + '</span>');
          return '<div class="card">' +
            (u.avatar ? '<img class="avatar" src="' + esc(u.avatar.replace('_normal','_bigger')) + '" loading="lazy">' : '<div class="avatar"></div>') +
            '<div class="info">' +
              '<div class="name-row">' +
                '<span class="name">' + esc(u.name) + '</span>' +
                (u.verified ? '<span class="check">&#10003;</span>' : '') +
                '<a class="handle" href="https://x.com/' + esc(u.username) + '" target="_blank" rel="noopener">@' + esc(u.username) + '</a>' +
              '</div>' +
              (u.bio ? '<div class="bio">' + esc(u.bio) + '</div>' : '') +
              '<div class="chips">' + chips.join('') + '</div>' +
            '</div>' +
            '</div>';
        }).join('');
      }

      document.getElementById('out').classList.remove('hidden');
    }

    async function loadResult(id) {
      try {
        var resp = await fetch('/api/result/' + id);
        var data = await resp.json();
        if(!resp.ok) throw new Error(data.error || 'Not found');
        document.getElementById('status').textContent = '';
        document.getElementById('q').value = '@' + data.target.username;
        renderResult(data);
      } catch(e) {
        document.getElementById('status').className = 'error';
        document.getElementById('status').textContent = 'Could not load result: ' + e.message;
      }
    }

    async function lookup() {
      var q = document.getElementById('q').value.trim().replace(/^@/,'');
      if(!q) return;
      var btn = document.getElementById('btn');
      var status = document.getElementById('status');
      btn.disabled = true;
      status.className = '';
      status.textContent = 'Fetching — first run can take up to 30 seconds…';
      document.getElementById('out').classList.add('hidden');
      try {
        var resp = await fetch('/api/mutuals?target=' + encodeURIComponent(q));
        var data = await resp.json();
        if(!resp.ok) throw new Error(data.error || 'Unknown error');
        status.textContent = '';
        renderResult(data);
      } catch(e) {
        status.className = 'error';
        status.textContent = 'Error: ' + e.message;
      } finally {
        btn.disabled = false;
      }
    }
  </script>
</body>
</html>`);
}

// ── mutuals handler ───────────────────────────────────────────────────────────

async function handleMutuals(url: URL, env: Env): Promise<Response> {
  const target = url.searchParams.get("target")?.replace(/^@/, "").trim();
  if (!target) return json({ error: "Missing ?target= parameter" }, 400);

  try {
    const [myId, targetUser] = await Promise.all([
      getMyUserId(env),
      resolveUsername(target, env),
    ]);

    if (!targetUser) return json({ error: `@${target} not found` }, 404);

    // Check 24h cache
    const cacheKey = `mutuals:${myId}:${targetUser.id}`;
    const cached = await env.CACHE.get<MutualsResult>(cacheKey, "json");
    if (cached) return json({ ...cached, cached: true });

    // Fetch fresh
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
        verified: u.verified ?? false,
        followers: u.public_metrics?.followers_count ?? 0,
        following: u.public_metrics?.following_count ?? 0,
        tweets: u.public_metrics?.tweet_count ?? 0,
        listed: u.public_metrics?.listed_count ?? 0,
        bio: (u.description ?? "").slice(0, 200),
        avatar: u.profile_image_url ?? "",
        location: u.location ?? "",
        website: u.entities?.url?.urls?.[0]?.expanded_url ?? "",
        joinedAt: u.created_at ?? "",
      }));

    const resultId = makeId();
    const result: MutualsResult = {
      id: resultId,
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

    // Store: 24h dedup cache + permanent permalink
    await Promise.all([
      env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: CACHE_TTL_24H }),
      env.CACHE.put(`result:${resultId}`, JSON.stringify(result)), // no TTL = permanent
    ]);

    return json({ ...result, cached: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "RATE_LIMITED") return json({ error: "X API rate limit — try again in 15 min" }, 429);
    console.error("mutuals error:", msg);
    return json({ error: msg }, 500);
  }
}

// ── X API ─────────────────────────────────────────────────────────────────────

function makeId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  for (const b of bytes) id += chars[b % chars.length];
  return id;
}

function pctEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/!/g, "%21").replace(/'/g, "%27")
    .replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\*/g, "%2A");
}

async function oauthHeader(method: string, baseUrl: string, qp: Record<string, string>, env: Env): Promise<string> {
  const op: Record<string, string> = {
    oauth_consumer_key: env.X_CONSUMER_KEY,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: env.X_ACCESS_TOKEN,
    oauth_version: "1.0",
  };
  const all = { ...qp, ...op };
  const paramStr = Object.keys(all).sort().map(k => `${pctEncode(k)}=${pctEncode(all[k])}`).join("&");
  const base = `${method}&${pctEncode(baseUrl)}&${pctEncode(paramStr)}`;
  const sigKey = `${pctEncode(env.X_SECRET_KEY)}&${pctEncode(env.X_ACCESS_TOKEN_SECRET)}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(sigKey), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(base));
  const sig = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return "OAuth " + Object.entries({ ...op, oauth_signature: sig }).map(([k, v]) => `${pctEncode(k)}="${pctEncode(v)}"`).join(", ");
}

async function getMyUserId(env: Env): Promise<string> {
  const cached = await env.CACHE.get("me:id");
  if (cached) return cached;
  const url = "https://api.twitter.com/2/users/me";
  const auth = await oauthHeader("GET", url, {}, env);
  const resp = await fetch(url, { headers: { Authorization: auth } });
  if (!resp.ok) throw new Error(`/users/me: ${resp.status} ${await resp.text()}`);
  const { data } = await resp.json<{ data: XUser }>();
  await env.CACHE.put("me:id", data.id, { expirationTtl: 86400 * 7 });
  return data.id;
}

async function resolveUsername(username: string, env: Env): Promise<XUser | null> {
  const key = `user:${username.toLowerCase()}`;
  const cached = await env.CACHE.get<XUser>(key, "json");
  if (cached) return cached;
  const resp = await fetch(`https://api.twitter.com/2/users/by/username/${username}`, {
    headers: { Authorization: `Bearer ${env.X_BEARER_TOKEN}` },
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Lookup @${username}: ${resp.status} ${await resp.text()}`);
  const { data } = await resp.json<{ data: XUser }>();
  await env.CACHE.put(key, JSON.stringify(data), { expirationTtl: CACHE_TTL_24H });
  return data;
}

async function fetchFollowers(myId: string, env: Env): Promise<XUser[]> {
  const users: XUser[] = [];
  let nextToken: string | undefined;
  const baseUrl = `https://api.twitter.com/2/users/${myId}/followers`;
  while (users.length < MAX_FOLLOWERS) {
    const qp: Record<string, string> = {
      max_results: String(Math.min(1000, MAX_FOLLOWERS - users.length)),
      "user.fields": USER_FIELDS,
    };
    if (nextToken) qp.pagination_token = nextToken;
    const auth = await oauthHeader("GET", baseUrl, qp, env);
    const u = new URL(baseUrl);
    for (const [k, v] of Object.entries(qp)) u.searchParams.set(k, v);
    const resp = await fetch(u.toString(), { headers: { Authorization: auth } });
    if (resp.status === 429) throw new Error("RATE_LIMITED");
    if (!resp.ok) throw new Error(`Followers: ${resp.status} ${await resp.text()}`);
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
    const u = new URL(baseUrl);
    u.searchParams.set("max_results", String(Math.min(1000, MAX_FOLLOWING - users.length)));
    u.searchParams.set("user.fields", USER_FIELDS);
    if (nextToken) u.searchParams.set("pagination_token", nextToken);
    const resp = await fetch(u.toString(), { headers: { Authorization: `Bearer ${env.X_BEARER_TOKEN}` } });
    if (resp.status === 429) throw new Error("RATE_LIMITED");
    if (!resp.ok) throw new Error(`Following: ${resp.status} ${await resp.text()}`);
    const body = await resp.json<{ data?: XUser[]; meta?: { next_token?: string } }>();
    if (body.data) users.push(...body.data);
    nextToken = body.meta?.next_token;
    if (!nextToken) break;
  }
  return users;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
