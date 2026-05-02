# True Mutuals

Find out who your X followers have in common with anyone you want to meet — the same list they'd see if they clicked "Followers you know" on your profile.

Live at: **mutuals.markmoriarty.com**

## What it does

Enter any X username. The app computes the intersection of:
- People who follow **you**
- People that **target** follows

= people who could give you a warm intro to the target.

Results are sorted by follower count ascending (smaller accounts = more likely a real personal connection).

## Tech

- Cloudflare Workers (API + HTML)
- Workers KV (24h result cache — same-day re-runs are free)
- X API v2 PAYG (pay-per-resource, not per call)

## X app

Managed at: https://console.x.com/accounts/1991676194337746947/apps/settings?appId=32868486
Git repo: https://github.com/markitics/x-mutuals

**Secrets are never committed.** Copy `.env.example` → `.env.local` and fill in values.

## Deploy

```bash
npm install
wrangler deploy
```

Secrets are set via `wrangler secret put <NAME>` (see `.env.example` for the full list).

## Possible future improvements

1. **Multi-user login** — OAuth 2.0 "Sign in with X" so anyone can use it with their own account (and their own follower list becomes the left side of the intersection)
2. **Engagement scoring** — weight mutuals by how much they interact with you (likes, replies, retweets) vs just following. Heavy amplifiers float to the top
3. **Other networks** — LinkedIn mutual connections, GitHub mutual followers, etc.
4. **Intro strength rating** — estimate how well a mutual likely knows the target based on follower count, follow-back ratio, shared connections
5. **Payments** — once multi-user is live, charge non-owner users a small fee to cover X API costs per lookup
6. **Landing page** — proper public-facing page explaining the product, with sign-in CTA
7. **Terms of Service + Privacy Policy** — required for public OAuth and app store listings
8. **Saved lookups** — store past results per user, compare over time as your follower base grows
9. **"Who to follow back"** — reverse view: among people the target follows, who are you NOT following back yet?
10. **Rate limit / cost dashboard** — show running X API spend so there are no billing surprises
