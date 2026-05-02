// True Mutuals — Cloudflare Worker
// Routes: / landing | /app Mark's tool | /r/:id permalink | /login X OAuth
//         /auth/x/start | /api/auth/callback | /logout | /dashboard user tool
//         /api/estimate | /api/checkout | /checkout/success | /api/mutuals | /api/result/:id

export interface Env {
  CACHE: KVNamespace;
  // Mark's OAuth 1.0a tokens
  X_CONSUMER_KEY: string;
  X_SECRET_KEY: string;
  X_ACCESS_TOKEN: string;
  X_ACCESS_TOKEN_SECRET: string;
  X_BEARER_TOKEN: string;
  // X OAuth 2.0 for other users
  X_OAUTH2_CLIENT_ID: string;
  X_OAUTH2_CLIENT_SECRET: string;
  // Stripe
  STRIPE_SECRET_KEY: string;
}

interface XUser {
  id: string;
  name: string;
  username: string;
  verified?: boolean;
  public_metrics?: { followers_count: number; following_count: number; tweet_count: number; listed_count: number };
  description?: string;
  profile_image_url?: string;
  created_at?: string;
  location?: string;
  entities?: { url?: { urls?: Array<{ expanded_url: string }> } };
}

interface Mutual {
  id: string; name: string; username: string; verified: boolean;
  followers: number; following: number; tweets: number; listed: number;
  bio: string; avatar: string; location: string; website: string; joinedAt: string;
}

interface MutualsResult {
  id: string;
  target: { id: string; name: string; username: string };
  mutuals: Mutual[];
  stats: { myFollowersChecked: number; targetFollowingChecked: number; mutualsFound: number; estimatedCostUsd: string };
  fetchedAt: string;
}

interface UserSession {
  userId: string; username: string; name: string;
  accessToken: string; expiresAt: number;
}

type Auth =
  | { type: "mark" }
  | { type: "user"; userId: string; username: string; name: string; accessToken: string };

const MARK_COOKIE = "tm_auth";
const MARK_COOKIE_VAL = "mark_true_mutuals_v1";
const MARK_PASSWORD = "grow";
const SESSION_COOKIE = "tm_session";
const CALLBACK_URL = "https://mutuals.markmoriarty.com/api/auth/callback";
const USER_FIELDS = "public_metrics,description,verified,profile_image_url,created_at,location,url,entities";
const MAX_FOLLOWERS = 5000;
const MAX_FOLLOWING = 2500;
const CACHE_24H = 86400;

// ── Router ────────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const p = url.pathname;
    const auth = await getAuth(request, env);

    // Static pages
    if (p === "/") return landingPage();
    if (p === "/login") return loginPage(url.searchParams.get("error"));
    if (p === "/logout") return logout();

    // Mark's password-protected tool
    if (p === "/app") {
      if (request.method === "POST") return handleMarkLogin(request);
      if (!isMarkAuthed(request)) return markLoginForm(false);
      return markAppPage();
    }

    // X OAuth flow
    if (p === "/auth/x/start") return startXOAuth(env);
    if (p === "/api/auth/callback") return handleXCallback(url, env);

    // User dashboard (after X OAuth)
    if (p === "/dashboard") {
      if (!auth || auth.type !== "user") return redirect("/login");
      return dashboardPage(auth, url.searchParams.get("run"), url.searchParams.get("error"));
    }

    // Permalink page (serves both Mark results and user results)
    if (p.startsWith("/r/")) {
      if (!auth) return redirect(isMarkAuthed(request) ? "/app" : "/login");
      return permalinkPage(p.slice(3));
    }

    // Stripe checkout success
    if (p === "/checkout/success") {
      if (!auth || auth.type !== "user") return redirect("/login");
      return handleCheckoutSuccess(url, auth, env);
    }

    // APIs
    if (p === "/api/mutuals") {
      if (!auth) return json({ error: "Unauthorized" }, 401);
      return handleMutuals(url, auth, env);
    }
    if (p.startsWith("/api/result/")) {
      if (!auth) return json({ error: "Unauthorized" }, 401);
      const id = p.slice("/api/result/".length);
      const saved = await env.CACHE.get<MutualsResult>(`result:${id}`, "json");
      return saved ? json({ ...saved, cached: true }) : json({ error: "Not found" }, 404);
    }
    if (p === "/api/estimate") {
      if (!auth || auth.type !== "user") return json({ error: "Unauthorized" }, 401);
      return handleEstimate(url, auth, env);
    }
    if (p === "/api/checkout" && request.method === "POST") {
      if (!auth || auth.type !== "user") return json({ error: "Unauthorized" }, 401);
      return handleCheckout(request, auth, env);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

// ── Auth ──────────────────────────────────────────────────────────────────────

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

function isMarkAuthed(request: Request): boolean {
  const cookies = parseCookies(request.headers.get("Cookie") ?? "");
  return cookies[MARK_COOKIE] === MARK_COOKIE_VAL;
}

async function getAuth(request: Request, env: Env): Promise<Auth | null> {
  if (isMarkAuthed(request)) return { type: "mark" };
  const cookies = parseCookies(request.headers.get("Cookie") ?? "");
  const sid = cookies[SESSION_COOKIE];
  if (!sid) return null;
  const s = await env.CACHE.get<UserSession>(`session:${sid}`, "json");
  if (!s || s.expiresAt < Date.now()) return null;
  return { type: "user", userId: s.userId, username: s.username, name: s.name, accessToken: s.accessToken };
}

async function handleMarkLogin(request: Request): Promise<Response> {
  const body = await request.formData();
  if (body.get("password") === MARK_PASSWORD) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/app",
        "Set-Cookie": `${MARK_COOKIE}=${MARK_COOKIE_VAL}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=7776000`,
      },
    });
  }
  return markLoginForm(true);
}

function logout(): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": [
        `${MARK_COOKIE}=; Path=/; HttpOnly; Secure; Max-Age=0`,
        `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; Max-Age=0`,
      ].join(", "),
    },
  });
}

// ── X OAuth 2.0 ───────────────────────────────────────────────────────────────

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function startXOAuth(env: Env): Promise<Response> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = makeId();
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64url(new Uint8Array(hashBuf));
  await env.CACHE.put(`pkce:${state}`, verifier, { expirationTtl: 300 });
  const u = new URL("https://twitter.com/i/oauth2/authorize");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", env.X_OAUTH2_CLIENT_ID);
  u.searchParams.set("redirect_uri", CALLBACK_URL);
  u.searchParams.set("scope", "users.read follows.read offline.access");
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return redirect(u.toString());
}

async function handleXCallback(url: URL, env: Env): Promise<Response> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error") || !code || !state) return redirect("/login?error=cancelled");

  const verifier = await env.CACHE.get(`pkce:${state}`);
  if (!verifier) return redirect("/login?error=expired");
  await env.CACHE.delete(`pkce:${state}`);

  // Exchange code → token
  const creds = btoa(`${env.X_OAUTH2_CLIENT_ID}:${env.X_OAUTH2_CLIENT_SECRET}`);
  const tokenResp = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${creds}` },
    body: new URLSearchParams({
      grant_type: "authorization_code", code,
      redirect_uri: CALLBACK_URL, code_verifier: verifier,
    }).toString(),
  });
  if (!tokenResp.ok) {
    console.error("token exchange:", await tokenResp.text());
    return redirect("/login?error=token");
  }
  const { access_token, expires_in } = await tokenResp.json<{ access_token: string; expires_in: number }>();

  // Get user info
  const meResp = await fetch("https://api.twitter.com/2/users/me?user.fields=public_metrics", {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const { data: xUser } = await meResp.json<{ data: XUser }>();

  // Create session
  const sid = makeId() + makeId();
  const ttl = expires_in ?? 7200;
  const session: UserSession = {
    userId: xUser.id, username: xUser.username, name: xUser.name,
    accessToken: access_token, expiresAt: Date.now() + ttl * 1000,
  };
  await env.CACHE.put(`session:${sid}`, JSON.stringify(session), { expirationTtl: ttl });

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/dashboard",
      "Set-Cookie": `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ttl}`,
    },
  });
}

// ── Estimate + Stripe ─────────────────────────────────────────────────────────

async function handleEstimate(url: URL, auth: Extract<Auth, { type: "user" }>, env: Env): Promise<Response> {
  const target = url.searchParams.get("target")?.replace(/^@/, "").trim();
  if (!target) return json({ error: "Missing target" }, 400);

  const [meResp, targetResp] = await Promise.all([
    fetch("https://api.twitter.com/2/users/me?user.fields=public_metrics", {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    }),
    fetch(`https://api.twitter.com/2/users/by/username/${encodeURIComponent(target)}?user.fields=public_metrics`, {
      headers: { Authorization: `Bearer ${env.X_BEARER_TOKEN}` },
    }),
  ]);

  if (!meResp.ok) return json({ error: "Could not fetch your profile" }, 500);
  if (targetResp.status === 404) return json({ error: `@${target} not found or account is private` }, 404);
  if (!targetResp.ok) return json({ error: "Could not fetch target profile" }, 500);

  const { data: me } = await meResp.json<{ data: XUser }>();
  const { data: tgt } = await targetResp.json<{ data: XUser }>();

  const myFollowers = me.public_metrics?.followers_count ?? 0;
  const targetFollowing = tgt.public_metrics?.following_count ?? 0;
  const apiCostUsd = myFollowers * 0.001 + targetFollowing * 0.005;
  const totalUsd = Math.max(1.50, apiCostUsd + 1.00);
  const totalCents = Math.ceil(totalUsd * 100);

  return json({
    myUsername: me.username,
    myFollowers,
    targetUsername: tgt.username,
    targetName: tgt.name,
    targetFollowing,
    apiCostUsd: apiCostUsd.toFixed(2),
    platformFeeUsd: "1.00",
    totalUsd: (totalCents / 100).toFixed(2),
    totalCents,
    lines: [
      `Your ${myFollowers.toLocaleString()} followers × $0.001 = $${(myFollowers * 0.001).toFixed(2)}`,
      `@${tgt.username} follows ${targetFollowing.toLocaleString()} people × $0.005 = $${(targetFollowing * 0.005).toFixed(2)}`,
      `Platform fee = $1.00`,
    ],
  });
}

async function handleCheckout(request: Request, auth: Extract<Auth, { type: "user" }>, env: Env): Promise<Response> {
  if (!env.STRIPE_SECRET_KEY) return json({ error: "Payments not yet configured" }, 503);
  const body = await request.json<{ target: string; totalCents: number; lines: string[] }>();
  const { target, totalCents, lines } = body;
  if (!target || totalCents < 150) return json({ error: "Invalid request" }, 400);

  const successUrl = `https://mutuals.markmoriarty.com/checkout/success?cs_id={CHECKOUT_SESSION_ID}&target=${encodeURIComponent(target)}&uid=${auth.userId}`;
  const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      "payment_method_types[]": "card",
      mode: "payment",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(totalCents),
      "line_items[0][price_data][product_data][name]": `True Mutuals: @${target}`,
      "line_items[0][price_data][product_data][description]": lines.join(" · "),
      success_url: successUrl,
      cancel_url: "https://mutuals.markmoriarty.com/dashboard",
      "metadata[target]": target,
      "metadata[user_id]": auth.userId,
    }).toString(),
  });
  if (!resp.ok) { console.error("stripe:", await resp.text()); return json({ error: "Payment setup failed" }, 500); }
  const session = await resp.json<{ url: string }>();
  return json({ checkoutUrl: session.url });
}

async function handleCheckoutSuccess(url: URL, auth: Extract<Auth, { type: "user" }>, env: Env): Promise<Response> {
  const csId = url.searchParams.get("cs_id");
  const target = url.searchParams.get("target");
  if (!csId || !target || !env.STRIPE_SECRET_KEY) return redirect("/dashboard?error=payment");

  const resp = await fetch(`https://api.stripe.com/v1/checkout/sessions/${csId}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  if (!resp.ok) return redirect("/dashboard?error=payment");
  const session = await resp.json<{ payment_status: string }>();
  if (session.payment_status !== "paid") return redirect("/dashboard?error=payment_failed");

  // Mark as paid (24h window to run the lookup)
  await env.CACHE.put(`paid:${auth.userId}:${target.toLowerCase()}`, "1", { expirationTtl: CACHE_24H });
  return redirect(`/dashboard?run=${encodeURIComponent(target)}`);
}

// ── Mutuals ───────────────────────────────────────────────────────────────────

async function handleMutuals(url: URL, auth: Auth, env: Env): Promise<Response> {
  const target = url.searchParams.get("target")?.replace(/^@/, "").trim();
  if (!target) return json({ error: "Missing target" }, 400);

  try {
    // For non-Mark users, check payment
    let userAccessToken: string | null = null;
    let myUserId: string;

    if (auth!.type === "mark") {
      myUserId = await getMarkUserId(env);
    } else {
      const u = auth as Extract<Auth, { type: "user" }>;
      const paid = await env.CACHE.get(`paid:${u.userId}:${target.toLowerCase()}`);
      if (!paid) return json({ error: "Payment required", needsPayment: true }, 402);
      myUserId = u.userId;
      userAccessToken = u.accessToken;
    }

    const targetUser = await resolveUsername(target, env);
    if (!targetUser) return json({ error: `@${target} not found` }, 404);

    const cacheKey = `mutuals:${myUserId}:${targetUser.id}`;
    const cached = await env.CACHE.get<MutualsResult>(cacheKey, "json");
    if (cached) return json({ ...cached, cached: true });

    const [myFollowers, targetFollowing] = await Promise.all([
      auth!.type === "mark"
        ? fetchFollowersOAuth1(myUserId, env)
        : fetchFollowersOAuth2(myUserId, userAccessToken!),
      fetchFollowing(targetUser.id, env),
    ]);

    const followerIds = new Set(myFollowers.map(u => u.id));
    const mutuals: Mutual[] = targetFollowing
      .filter(u => followerIds.has(u.id))
      .sort((a, b) => (a.public_metrics?.followers_count ?? 0) - (b.public_metrics?.followers_count ?? 0))
      .map(u => ({
        id: u.id, name: u.name, username: u.username, verified: u.verified ?? false,
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

    await Promise.all([
      env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: CACHE_24H }),
      env.CACHE.put(`result:${resultId}`, JSON.stringify(result)), // permanent
    ]);

    return json({ ...result, cached: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "RATE_LIMITED") return json({ error: "X API rate limit — try again in 15 min" }, 429);
    console.error("mutuals:", msg);
    return json({ error: msg }, 500);
  }
}

// ── Pages ─────────────────────────────────────────────────────────────────────

function landingPage(): Response {
  return page(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>True Mutuals</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f0f0f;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.wrap{max-width:520px;width:100%;text-align:center}
.eye{font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#1d9bf0;margin-bottom:20px}
h1{font-size:clamp(36px,8vw,56px);font-weight:800;letter-spacing:-1.5px;line-height:1.05;margin-bottom:18px}
h1 span{color:#1d9bf0}
p{font-size:17px;line-height:1.65;color:#999;margin-bottom:40px;max-width:400px;margin-inline:auto}
.btns{display:flex;flex-direction:column;gap:12px;max-width:320px;margin:0 auto}
.btn{display:block;padding:16px 24px;border-radius:12px;font-size:16px;font-weight:600;text-decoration:none;transition:opacity .15s,transform .1s}
.btn:active{transform:scale(.98)}
.primary{background:#1d9bf0;color:#fff}.primary:hover{opacity:.9}
.secondary{background:#1a1a1a;color:#fff;border:1px solid #333}.secondary:hover{background:#222}
.div{display:flex;align-items:center;gap:12px;color:#333;font-size:12px}
.div::before,.div::after{content:'';flex:1;height:1px;background:#1e1e1e}
</style></head><body>
<div class="wrap">
  <div class="eye">Early access</div>
  <h1>Find your <span>warm intros</span> on X</h1>
  <p>See who your followers have in common with anyone you want to meet — before you send that cold DM.</p>
  <div class="btns">
    <a href="/app" class="btn primary">I'm Mark &rarr;</a>
    <div class="div">or</div>
    <a href="/login" class="btn secondary">Sign in with X</a>
  </div>
</div>
</body></html>`);
}

function loginPage(error: string | null): Response {
  const msg = error === "cancelled" ? "Sign-in was cancelled."
    : error === "expired" ? "Session expired, please try again."
    : error === "token" ? "X sign-in failed. Please try again."
    : "";
  return page(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in — True Mutuals</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f0f0f;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.card{background:#161616;border:1px solid #222;border-radius:16px;padding:40px;max-width:360px;width:100%;text-align:center}
h2{font-size:22px;font-weight:700;margin-bottom:8px}
p{color:#666;font-size:14px;margin-bottom:28px}
.x-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:14px;background:#fff;color:#000;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;text-decoration:none;transition:opacity .15s}
.x-btn:hover{opacity:.9}
.x-logo{width:20px;height:20px;flex-shrink:0}
.error{color:#e0245e;font-size:13px;margin-top:14px}
.back{display:block;margin-top:20px;color:#444;font-size:13px;text-decoration:none}.back:hover{color:#888}
</style></head><body>
<div class="card">
  <h2>Sign in to True Mutuals</h2>
  <p>Connect your X account to see your warm intro paths to anyone.</p>
  <a href="/auth/x/start" class="x-btn">
    <svg class="x-logo" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.259 5.631 5.905-5.631zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
    Continue with X
  </a>
  ${msg ? `<p class="error">${esc(msg)}</p>` : ""}
  <a href="/" class="back">&larr; Back</a>
</div>
</body></html>`);
}

function markLoginForm(wrong: boolean): Response {
  return new Response(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>True Mutuals</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f0f0f;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.card{background:#161616;border:1px solid #222;border-radius:16px;padding:40px;max-width:360px;width:100%;text-align:center}
h2{font-size:22px;font-weight:700;margin-bottom:8px}p{color:#666;font-size:14px;margin-bottom:28px}
input{width:100%;padding:13px 16px;background:#111;border:1.5px solid #2a2a2a;border-radius:10px;color:#fff;font-size:18px;text-align:center;letter-spacing:6px;outline:none;margin-bottom:12px}
input:focus{border-color:#1d9bf0}input::placeholder{letter-spacing:1px;color:#444;font-size:14px}
button{width:100%;padding:13px;background:#1d9bf0;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer}
.error{color:#e0245e;font-size:13px;margin-top:10px}
.back{display:block;margin-top:20px;color:#444;font-size:13px;text-decoration:none}.back:hover{color:#888}
</style></head><body>
<div class="card">
  <h2>Welcome back, Mark</h2><p>Enter your passphrase</p>
  <form method="POST" action="/app">
    <input type="password" name="password" placeholder="passphrase" autofocus autocomplete="off">
    <button type="submit">Continue &rarr;</button>
    ${wrong ? '<p class="error">Wrong passphrase</p>' : ""}
  </form>
  <a href="/" class="back">&larr; Back</a>
</div>
</body></html>`, { status: wrong ? 401 : 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function markAppPage(): Response {
  return page(appHTML(null, "Mark"));
}

function dashboardPage(auth: Extract<Auth, { type: "user" }>, preRun: string | null, error: string | null): Response {
  const errMsg = error === "payment_failed" ? "Payment was not completed." : error === "payment" ? "Could not verify payment." : "";
  return page(appHTML(preRun, auth.name, errMsg, auth.username));
}

function permalinkPage(id: string): Response {
  return page(appHTML(null, null, null, null, id));
}

function appHTML(preRun: string | null, displayName: string | null, errorMsg?: string | null, username?: string | null, preloadId?: string | null): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>True Mutuals</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;color:#111;min-height:100vh}
.wrap{max-width:680px;margin:0 auto;padding:36px 20px}
.top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:24px}
h1{font-size:22px;font-weight:700}
.toplinks{font-size:12px;color:#bbb;display:flex;gap:12px}
.toplinks a{color:#bbb;text-decoration:none}.toplinks a:hover{color:#555}
.search{display:flex;gap:8px;margin-bottom:14px}
.search input{flex:1;padding:11px 14px;border:1.5px solid #ddd;border-radius:8px;font-size:16px;outline:none;background:#fff}
.search input:focus{border-color:#1d9bf0}
.search button{padding:11px 22px;background:#1d9bf0;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}
.search button:hover{background:#1a8cd8}.search button:disabled{background:#93c8f8;cursor:not-allowed}
#status{font-size:14px;color:#888;min-height:20px;margin-bottom:12px}
#status.err{color:#e0245e}
/* Estimate box */
.est{background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:20px;margin-bottom:16px}
.est h3{font-size:15px;font-weight:600;margin-bottom:12px}
.est-lines{list-style:none;font-size:13px;color:#666;margin-bottom:14px}
.est-lines li{padding:3px 0;border-bottom:1px solid #f0f0f0}
.est-lines li:last-child{border:none;font-weight:700;color:#111;padding-top:8px}
.pay-btn{width:100%;padding:13px;background:#22c55e;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer}
.pay-btn:hover{background:#16a34a}.pay-btn:disabled{background:#86efac;cursor:not-allowed}
/* Results */
.meta{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px}
.stats{display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:#666}
.stats b{font-weight:700;color:#111}
.plink{font-size:12px;color:#1d9bf0;text-decoration:none;background:#e8f5fe;padding:4px 10px;border-radius:6px}
.plink:hover{background:#d0eafb}
.card{background:#fff;border:1px solid #e5e5e5;border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;gap:12px}
.avatar{width:44px;height:44px;border-radius:50%;flex-shrink:0;background:#e5e5e5;object-fit:cover}
.info{flex:1;min-width:0}
.nrow{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.name{font-weight:600;font-size:14px}
.check{color:#1d9bf0;font-size:12px}
.handle{color:#1d9bf0;font-size:13px;text-decoration:none}.handle:hover{text-decoration:underline}
.bio{font-size:13px;color:#555;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:5px}
.chip{font-size:11px;color:#888;background:#f5f5f5;padding:2px 7px;border-radius:8px;white-space:nowrap}
.chip b{color:#555;font-weight:600}
.fetched{font-size:11px;color:#bbb;margin-top:6px;margin-bottom:10px}
.hidden{display:none}
</style></head><body>
<div class="wrap">
  <div class="top">
    <h1>True Mutuals</h1>
    <div class="toplinks">
      ${username ? `<span>@${esc(username!)}</span>` : ""}
      <a href="/">← home</a>
      ${displayName ? '<a href="/logout">sign out</a>' : ""}
    </div>
  </div>
  <div class="search">
    <input id="q" type="text" placeholder="@username" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false">
    <button id="btn" onclick="go()">Look up</button>
  </div>
  ${errorMsg ? `<p id="status" class="err">${esc(errorMsg!)}</p>` : '<div id="status"></div>'}
  <div id="est-box" class="est hidden">
    <h3 id="est-title"></h3>
    <ul id="est-lines" class="est-lines"></ul>
    <button class="pay-btn" id="pay-btn" onclick="pay()">Pay</button>
  </div>
  <div id="out" class="hidden">
    <div class="meta">
      <div id="stats" class="stats"></div>
      <a id="plink" class="plink hidden" href="#">permalink &rarr;</a>
    </div>
    <p id="fetched" class="fetched"></p>
    <div id="results"></div>
  </div>
</div>
<script>
var IS_MARK = ${displayName === "Mark" ? "true" : "false"};
var PRELOAD_ID = ${preloadId ? JSON.stringify(preloadId) : "null"};
var PRERUN = ${preRun ? JSON.stringify(preRun) : "null"};
var _estimateData = null;

document.getElementById('q').addEventListener('keydown', function(e){ if(e.key==='Enter') go(); });

window.addEventListener('DOMContentLoaded', function(){
  if(PRELOAD_ID) { setStatus('Loading saved result…'); loadById(PRELOAD_ID); }
  else if(PRERUN) { document.getElementById('q').value='@'+PRERUN; runLookup(PRERUN); }
});

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmt(n){ return Number(n).toLocaleString(); }
function fmtDate(iso){ if(!iso) return ''; var d=new Date(iso); return d.toLocaleDateString('en-US',{year:'numeric',month:'short'}); }
function setStatus(msg,isErr){ var el=document.getElementById('status'); el.textContent=msg; el.className=isErr?'err':''; }
function hideAll(){ document.getElementById('est-box').classList.add('hidden'); document.getElementById('out').classList.add('hidden'); }

async function go() {
  var q = document.getElementById('q').value.trim().replace(/^@/,'');
  if(!q) return;
  hideAll();
  if(IS_MARK) { runLookup(q); return; }
  // Non-Mark: show estimate first
  setStatus('Getting cost estimate…');
  document.getElementById('btn').disabled=true;
  try {
    var r = await fetch('/api/estimate?target='+encodeURIComponent(q));
    var d = await r.json();
    if(!r.ok) { setStatus('Error: '+(d.error||'unknown'),true); return; }
    _estimateData = d;
    setStatus('');
    document.getElementById('est-title').textContent = 'Cost to look up @'+d.targetUsername+' for you (@'+d.myUsername+')';
    var ul = document.getElementById('est-lines');
    ul.innerHTML = d.lines.map(function(l){ return '<li>'+esc(l)+'</li>'; }).join('') +
      '<li>Total: $'+esc(d.totalUsd)+'</li>';
    document.getElementById('pay-btn').textContent = 'Pay $'+d.totalUsd+' →';
    document.getElementById('est-box').classList.remove('hidden');
  } catch(e) { setStatus('Error: '+e.message, true); }
  finally { document.getElementById('btn').disabled=false; }
}

async function pay() {
  if(!_estimateData) return;
  var btn = document.getElementById('pay-btn');
  btn.disabled=true; btn.textContent='Redirecting to checkout…';
  var target = document.getElementById('q').value.trim().replace(/^@/,'');
  try {
    var r = await fetch('/api/checkout', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ target, totalCents: _estimateData.totalCents, lines: _estimateData.lines })
    });
    var d = await r.json();
    if(!r.ok) { setStatus('Payment error: '+(d.error||'unknown'),true); btn.disabled=false; btn.textContent='Pay $'+_estimateData.totalUsd+' →'; return; }
    window.location.href = d.checkoutUrl;
  } catch(e) { setStatus('Error: '+e.message,true); btn.disabled=false; }
}

async function runLookup(target) {
  setStatus('Fetching — first run can take up to 30 seconds…');
  document.getElementById('btn').disabled=true;
  document.getElementById('out').classList.add('hidden');
  try {
    var r = await fetch('/api/mutuals?target='+encodeURIComponent(target));
    var d = await r.json();
    if(!r.ok) { setStatus('Error: '+(d.error||'unknown'),true); return; }
    setStatus('');
    renderResult(d);
  } catch(e) { setStatus('Error: '+e.message,true); }
  finally { document.getElementById('btn').disabled=false; }
}

async function loadById(id) {
  try {
    var r = await fetch('/api/result/'+id);
    var d = await r.json();
    if(!r.ok) { setStatus('Could not load: '+(d.error||'not found'),true); return; }
    setStatus('');
    document.getElementById('q').value='@'+d.target.username;
    renderResult(d);
  } catch(e) { setStatus('Error: '+e.message,true); }
}

function renderResult(data) {
  document.getElementById('stats').innerHTML =
    '<span><b>'+data.mutuals.length+'</b> mutuals</span>' +
    '<span><b>'+fmt(data.stats.myFollowersChecked)+'</b> your followers</span>' +
    '<span><b>'+fmt(data.stats.targetFollowingChecked)+'</b> @'+esc(data.target.username)+' following</span>' +
    '<span><b>$'+data.stats.estimatedCostUsd+'</b> API cost</span>';
  if(data.id) {
    var pl=document.getElementById('plink');
    pl.href='/r/'+data.id; pl.classList.remove('hidden');
    history.replaceState(null,'','/r/'+data.id);
  }
  document.getElementById('fetched').textContent = data.fetchedAt ? 'Fetched '+new Date(data.fetchedAt).toLocaleString() : '';
  if(!data.mutuals.length) {
    document.getElementById('results').innerHTML='<p style="color:#888;padding:8px 0">No mutuals found.</p>';
  } else {
    document.getElementById('results').innerHTML = data.mutuals.map(function(u){
      var chips=[];
      chips.push('<span class="chip"><b>'+fmt(u.followers)+'</b> followers</span>');
      chips.push('<span class="chip"><b>'+fmt(u.following)+'</b> following</span>');
      if(u.tweets) chips.push('<span class="chip"><b>'+fmt(u.tweets)+'</b> tweets</span>');
      if(u.joinedAt) chips.push('<span class="chip">Joined <b>'+fmtDate(u.joinedAt)+'</b></span>');
      if(u.location) chips.push('<span class="chip">'+esc(u.location)+'</span>');
      if(u.website) chips.push('<span class="chip"><a href="'+esc(u.website)+'" target="_blank" rel="noopener" style="color:inherit">'+esc(u.website.replace(/^https?:\/\//,'').slice(0,30))+'</a></span>');
      return '<div class="card">'+
        (u.avatar?'<img class="avatar" src="'+esc(u.avatar.replace('_normal','_bigger'))+'" loading="lazy">':'<div class="avatar"></div>')+
        '<div class="info">'+
          '<div class="nrow"><span class="name">'+esc(u.name)+'</span>'+(u.verified?'<span class="check">&#10003;</span>':'')+
          '<a class="handle" href="https://x.com/'+esc(u.username)+'" target="_blank" rel="noopener">@'+esc(u.username)+'</a></div>'+
          (u.bio?'<div class="bio">'+esc(u.bio)+'</div>':'')+
          '<div class="chips">'+chips.join('')+'</div>'+
        '</div></div>';
    }).join('');
  }
  document.getElementById('out').classList.remove('hidden');
}
</script></body></html>`;
}

// ── X API ─────────────────────────────────────────────────────────────────────

function pctEncode(s: string): string {
  return encodeURIComponent(s).replace(/!/g,"%21").replace(/'/g,"%27").replace(/\(/g,"%28").replace(/\)/g,"%29").replace(/\*/g,"%2A");
}

async function oauthHeader(method: string, baseUrl: string, qp: Record<string, string>, env: Env): Promise<string> {
  const op: Record<string, string> = {
    oauth_consumer_key: env.X_CONSUMER_KEY, oauth_nonce: crypto.randomUUID().replace(/-/g,""),
    oauth_signature_method: "HMAC-SHA1", oauth_timestamp: Math.floor(Date.now()/1000).toString(),
    oauth_token: env.X_ACCESS_TOKEN, oauth_version: "1.0",
  };
  const all = {...qp,...op};
  const ps = Object.keys(all).sort().map(k=>`${pctEncode(k)}=${pctEncode(all[k])}`).join("&");
  const base = `${method}&${pctEncode(baseUrl)}&${pctEncode(ps)}`;
  const sk = `${pctEncode(env.X_SECRET_KEY)}&${pctEncode(env.X_ACCESS_TOKEN_SECRET)}`;
  const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(sk),{name:"HMAC",hash:"SHA-1"},false,["sign"]);
  const buf = await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(base));
  const sig = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return "OAuth "+Object.entries({...op,oauth_signature:sig}).map(([k,v])=>`${pctEncode(k)}="${pctEncode(v)}"`).join(", ");
}

async function getMarkUserId(env: Env): Promise<string> {
  const cached = await env.CACHE.get("me:id");
  if (cached) return cached;
  const url = "https://api.twitter.com/2/users/me";
  const auth = await oauthHeader("GET", url, {}, env);
  const resp = await fetch(url, { headers: { Authorization: auth } });
  if (!resp.ok) throw new Error(`/users/me: ${resp.status}`);
  const { data } = await resp.json<{ data: XUser }>();
  await env.CACHE.put("me:id", data.id, { expirationTtl: 86400 * 7 });
  return data.id;
}

async function resolveUsername(username: string, env: Env): Promise<XUser | null> {
  const key = `user:${username.toLowerCase()}`;
  const cached = await env.CACHE.get<XUser>(key, "json");
  if (cached) return cached;
  const resp = await fetch(`https://api.twitter.com/2/users/by/username/${username}?user.fields=public_metrics`, {
    headers: { Authorization: `Bearer ${env.X_BEARER_TOKEN}` },
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Lookup @${username}: ${resp.status}`);
  const { data } = await resp.json<{ data: XUser }>();
  await env.CACHE.put(key, JSON.stringify(data), { expirationTtl: CACHE_24H });
  return data;
}

async function fetchFollowersOAuth1(userId: string, env: Env): Promise<XUser[]> {
  const users: XUser[] = [];
  let next: string | undefined;
  const base = `https://api.twitter.com/2/users/${userId}/followers`;
  while (users.length < MAX_FOLLOWERS) {
    const qp: Record<string,string> = { max_results: String(Math.min(1000, MAX_FOLLOWERS-users.length)), "user.fields": USER_FIELDS };
    if (next) qp.pagination_token = next;
    const auth = await oauthHeader("GET", base, qp, env);
    const u = new URL(base);
    for (const [k,v] of Object.entries(qp)) u.searchParams.set(k,v);
    const resp = await fetch(u.toString(), { headers: { Authorization: auth } });
    if (resp.status === 429) throw new Error("RATE_LIMITED");
    if (!resp.ok) throw new Error(`Followers: ${resp.status} ${await resp.text()}`);
    const body = await resp.json<{data?:XUser[];meta?:{next_token?:string}}>();
    if (body.data) users.push(...body.data);
    next = body.meta?.next_token;
    if (!next) break;
  }
  return users;
}

async function fetchFollowersOAuth2(userId: string, accessToken: string): Promise<XUser[]> {
  const users: XUser[] = [];
  let next: string | undefined;
  const base = `https://api.twitter.com/2/users/${userId}/followers`;
  while (users.length < MAX_FOLLOWERS) {
    const u = new URL(base);
    u.searchParams.set("max_results", String(Math.min(1000, MAX_FOLLOWERS-users.length)));
    u.searchParams.set("user.fields", USER_FIELDS);
    if (next) u.searchParams.set("pagination_token", next);
    const resp = await fetch(u.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    if (resp.status === 429) throw new Error("RATE_LIMITED");
    if (!resp.ok) throw new Error(`Followers: ${resp.status} ${await resp.text()}`);
    const body = await resp.json<{data?:XUser[];meta?:{next_token?:string}}>();
    if (body.data) users.push(...body.data);
    next = body.meta?.next_token;
    if (!next) break;
  }
  return users;
}

async function fetchFollowing(targetId: string, env: Env): Promise<XUser[]> {
  const users: XUser[] = [];
  let next: string | undefined;
  const base = `https://api.twitter.com/2/users/${targetId}/following`;
  while (users.length < MAX_FOLLOWING) {
    const u = new URL(base);
    u.searchParams.set("max_results", String(Math.min(1000, MAX_FOLLOWING-users.length)));
    u.searchParams.set("user.fields", USER_FIELDS);
    if (next) u.searchParams.set("pagination_token", next);
    const resp = await fetch(u.toString(), { headers: { Authorization: `Bearer ${env.X_BEARER_TOKEN}` } });
    if (resp.status === 429) throw new Error("RATE_LIMITED");
    if (!resp.ok) throw new Error(`Following: ${resp.status} ${await resp.text()}`);
    const body = await resp.json<{data?:XUser[];meta?:{next_token?:string}}>();
    if (body.data) users.push(...body.data);
    next = body.meta?.next_token;
    if (!next) break;
  }
  return users;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function makeId(): string {
  const c = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  for (const b of bytes) id += c[b % c.length];
  return id;
}

function esc(s: string): string {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function page(html: string): Response {
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}
