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

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>True Mutuals</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; color: #111; min-height: 100vh; }
    .container { max-width: 640px; margin: 0 auto; padding: 48px 20px; }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 6px; }
    .subtitle { color: #666; font-size: 15px; margin-bottom: 28px; }
    .search { display: flex; gap: 8px; margin-bottom: 20px; }
    .search input { flex: 1; padding: 11px 14px; border: 1.5px solid #ddd; border-radius: 8px; font-size: 16px; outline: none; transition: border-color .15s; }
    .search input:focus { border-color: #1d9bf0; }
    .search button { padding: 11px 22px; background: #1d9bf0; color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; white-space: nowrap; }
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
  </style>
</head>
<body>
  <div class="container">
    <h1>True Mutuals</h1>
    <p class="subtitle">Enter an X username to see which of your followers also follow them.</p>
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/mutuals") {
      return handleMutuals(url, env);
    }

    return new Response(HTML, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
} satisfies ExportedHandler<Env>;

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
