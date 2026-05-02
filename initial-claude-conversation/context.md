# Project: X "Followers You Know" Mutual-Intro Finder

## Goal
Find mutual connections on X for warm intros. Compute the intersection of:
- **A:** people who follow ME (my followers)
- **B:** people TARGET follows (target's following list)

The intersection = candidates who could give me a warm intro to TARGET.
This mirrors what TARGET sees in "Followers you know" when viewing my profile,
but X's API doesn't expose another user's perspective, so it has to be
computed from my side.

**First target:** Brooke LeBlanc (@BrookeLeBlanc) — ~1k accounts followed.
**My account:** ~1.6k followers.

## Status
- Working local Python CLI exists: `followers_intersect.py` (attached / in this dir).
- Syntax-checked, not yet run end-to-end (no X dev account credentials yet).
- Discussed but not built: a Cloudflare Worker version with a small web UI
  and KV cache, so re-runs don't re-pay API costs.

## Key Decisions Already Made

### Two auth contexts on purpose
- **My followers** → user-context auth (OAuth 1.0a access token + secret).
  This qualifies as an "owned read" at $0.001/resource.
- **Target's following list** → app-only Bearer Token. Standard read pricing
  ($0.005-$0.010 per user returned).

The owned-read price tier requires that the request `{id}` matches the
authenticated user AND the user owns the developer app. So we need both
clients in one script.

### Cost model (X API pay-per-use, May 2026)
- Owned reads: **$0.001 per resource returned** (since April 20, 2026)
- Non-owned reads: **~$0.005 per resource returned**
- "Per resource" = per user object returned, NOT per API call. Confirmed
  by an X dev community thread where someone got billed for thousands of
  users from just 2 endpoint calls.
- 24h UTC deduplication: re-fetching the same resource same day = free.
- Estimate for first run on Brooke: ~$1.60 (my followers) + ~$5 (her ~1k
  following) = **~$6-7 total**.

### Sorting heuristic
Output is sorted by smallest follower count first. The reasoning:
mutuals with 500 followers are more likely to actually know Brooke
personally than mutuals with 50k followers (who probably just follow each
other as internet randos). User makes the final call on who to ask.

## What's in `followers_intersect.py`

- Reads 5 env vars: `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`,
  `X_ACCESS_TOKEN_SECRET`, `X_BEARER_TOKEN`
- Constants at top: `MY_HANDLE`, `TARGET_HANDLE`, cost guardrails
  `MAX_MY_FOLLOWERS=5000`, `MAX_TARGET_FOLLOWING=2500`
- Uses `tweepy` for both clients
- `paginate()` helper handles `next_token`, 429 backoff (sleeps 60s),
  and gracefully exits on 401/403 (e.g. private following list)
- Writes `matches.json` and prints a human-readable list to stdout

## Setup Steps (Not Yet Done)

1. Create a developer account at developer.x.com
2. Create a Project + App
3. In App Settings, generate:
   - API Key + Secret
   - Access Token + Secret (for my user, with read scope)
   - Bearer Token
4. Add ~$15 credits in Developer Console (plenty of headroom for several runs)
5. `pip install tweepy`
6. Set the 5 env vars + edit `MY_HANDLE` at top of script
7. `python followers_intersect.py`

## Open Questions / Possible Next Steps

1. **Test run:** actually run it once Brooke's data comes back, sanity-check
   the intersection against the 11 mutuals visible in her "Followers you know"
   screenshots.
2. **What if Brooke's following list is private?** Currently the script exits
   with a message. No fallback — would need a totally different approach
   (which we don't have).
3. **Cloudflare Worker version:** discussed. Would be a TypeScript Worker
   with secrets for the X tokens, KV namespace for caching results
   per-target, and a minimal HTML frontend to enter a target handle and see
   results. Cloudflare account is already connected via MCP. Punt unless
   the local script gets annoying to use.
4. **Per-mutual context:** for each candidate, it'd be useful to know
   *how* they likely know Brooke (coworked, school, etc.). Not in API
   data — would need scraping or manual research per candidate. Probably
   not worth automating for one-off intros.
5. **Rate limits:** the followers/following endpoints have 15-min rolling
   limits. For 1.6k + 1k users at 1000/page, this should be fine in 1-2
   pages each. The script handles 429s with backoff anyway.

## Files in This Project
- `followers_intersect.py` — the working script
- `context.md` — this file
- `matches.json` — created on first successful run

## Suggested First Message to Claude Code

> Read context.md. The script is ready but I haven't set up X API
> credentials yet. Walk me through getting the dev account set up,
> then help me do a test run against @BrookeLeBlanc once I have the
> tokens. Use a `.env` file pattern instead of exporting env vars
> manually.
