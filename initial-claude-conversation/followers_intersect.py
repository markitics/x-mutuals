#!/usr/bin/env python3
"""
Find mutual connections on X for warm intros.

Computes the intersection of:
  A: people who follow YOU (your followers)
  B: people TARGET follows (target's following list)
= candidates who could give you a warm intro to TARGET.

This mirrors what TARGET sees in "Followers you know" when viewing your
profile — but you can only compute it from your side because the X API
doesn't expose another user's perspective.

API costs (X pay-per-use pricing, May 2026):
  Your followers   (owned read):     $0.001 per follower returned
  Target following (non-owned read): $0.005-0.010 per user returned

Same-day re-runs are free thanks to 24h UTC deduplication.

Setup:
  1. developer.x.com -> create Project + App
  2. Generate in App Settings:
       - API Key + Secret (consumer credentials)
       - Access Token + Secret (for YOUR user; needs read scope)
       - Bearer Token (for app-only reads)
  3. Add credits in Developer Console
  4. pip install tweepy
  5. Set env vars (see below) or hardcode at top of file
  6. python followers_intersect.py

Env vars expected:
  X_API_KEY, X_API_SECRET,
  X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET,
  X_BEARER_TOKEN
"""

import os
import sys
import time
import json
import tweepy

# ---------- CONFIG ----------

API_KEY             = os.getenv("X_API_KEY", "")
API_SECRET          = os.getenv("X_API_SECRET", "")
ACCESS_TOKEN        = os.getenv("X_ACCESS_TOKEN", "")
ACCESS_TOKEN_SECRET = os.getenv("X_ACCESS_TOKEN_SECRET", "")
BEARER_TOKEN        = os.getenv("X_BEARER_TOKEN", "")

# Your handle (no @)
MY_HANDLE = "your_handle_here"
# Person you want an intro to
TARGET_HANDLE = "BrookeLeBlanc"

# Cost guardrails — stop pagination after this many resources
MAX_MY_FOLLOWERS    = 5000
MAX_TARGET_FOLLOWING = 2500

# Page size (X allows up to 1000 for these endpoints with elevated access,
# 100 by default). Lower if you hit issues.
PAGE_SIZE = 1000

# Where to save the full result as JSON (for re-running without re-fetching)
OUTPUT_JSON = "matches.json"


# ---------- HELPERS ----------

def cost_estimate(my_count: int, target_count: int) -> float:
    """Rough USD cost estimate."""
    return (my_count * 0.001) + (target_count * 0.005)


def paginate(method, *, id, max_total, label):
    """Paginate any tweepy users endpoint, with rate-limit backoff."""
    users = []
    token = None
    page = 0
    while len(users) < max_total:
        page += 1
        kwargs = dict(
            id=id,
            max_results=min(PAGE_SIZE, max_total - len(users)),
            user_fields=["description", "verified", "public_metrics"],
        )
        if token:
            kwargs["pagination_token"] = token

        try:
            resp = method(**kwargs)
        except tweepy.TooManyRequests:
            print(f"  [{label}] rate limited, sleeping 60s...", file=sys.stderr)
            time.sleep(60)
            continue
        except tweepy.Unauthorized as e:
            print(f"  [{label}] unauthorized — check token scopes: {e}", file=sys.stderr)
            return users
        except tweepy.Forbidden as e:
            print(f"  [{label}] forbidden — likely a private account: {e}", file=sys.stderr)
            return users

        if resp.data:
            users.extend(resp.data)
            print(f"  [{label}] page {page}: +{len(resp.data)} (total {len(users)})",
                  file=sys.stderr)
        else:
            break

        token = (resp.meta or {}).get("next_token")
        if not token:
            break

    return users[:max_total]


def serialize_user(u) -> dict:
    return {
        "id": str(u.id),
        "username": u.username,
        "name": u.name,
        "verified": getattr(u, "verified", False),
        "description": (u.description or "").replace("\n", " ").strip(),
        "followers": (u.public_metrics or {}).get("followers_count", 0),
        "following": (u.public_metrics or {}).get("following_count", 0),
    }


# ---------- MAIN ----------

def main():
    missing = [k for k, v in {
        "X_API_KEY": API_KEY,
        "X_API_SECRET": API_SECRET,
        "X_ACCESS_TOKEN": ACCESS_TOKEN,
        "X_ACCESS_TOKEN_SECRET": ACCESS_TOKEN_SECRET,
        "X_BEARER_TOKEN": BEARER_TOKEN,
    }.items() if not v]
    if missing:
        sys.exit(f"Missing credentials: {', '.join(missing)}")
    if MY_HANDLE == "your_handle_here":
        sys.exit("Set MY_HANDLE at the top of the script.")

    # User-context client → owned-read pricing for YOUR followers ($0.001/each)
    user_client = tweepy.Client(
        consumer_key=API_KEY,
        consumer_secret=API_SECRET,
        access_token=ACCESS_TOKEN,
        access_token_secret=ACCESS_TOKEN_SECRET,
    )
    # App-only client → standard read pricing for target's following list
    app_client = tweepy.Client(bearer_token=BEARER_TOKEN)

    # Resolve handles -> IDs
    print(f"Resolving @{MY_HANDLE} and @{TARGET_HANDLE}...", file=sys.stderr)
    me_resp = user_client.get_user(username=MY_HANDLE)
    target_resp = app_client.get_user(username=TARGET_HANDLE)
    if not me_resp.data or not target_resp.data:
        sys.exit("Could not resolve one of the handles.")
    me_id, target_id = me_resp.data.id, target_resp.data.id

    # 1. Your followers (owned read)
    print(f"\nFetching @{MY_HANDLE}'s followers (~$0.001 each)...", file=sys.stderr)
    my_followers = paginate(
        user_client.get_users_followers,
        id=me_id,
        max_total=MAX_MY_FOLLOWERS,
        label="my-followers",
    )

    # 2. Target's following (non-owned read)
    print(f"\nFetching @{TARGET_HANDLE}'s following list (~$0.005 each)...", file=sys.stderr)
    target_following = paginate(
        app_client.get_users_following,
        id=target_id,
        max_total=MAX_TARGET_FOLLOWING,
        label="target-following",
    )

    if not target_following:
        sys.exit(f"\nNo data from @{TARGET_HANDLE}'s following list. "
                 f"Their following may be private, or the request failed.")

    # 3. Intersect
    follower_ids = {u.id for u in my_followers}
    matches = [u for u in target_following if u.id in follower_ids]

    # 4. Sort: smaller-following accounts first (likely closer ties)
    matches.sort(key=lambda u: (u.public_metrics or {}).get("followers_count", 0))

    # 5. Save + print
    out = [serialize_user(u) for u in matches]
    with open(OUTPUT_JSON, "w") as f:
        json.dump(out, f, indent=2)

    est = cost_estimate(len(my_followers), len(target_following))
    print(f"\n{'='*60}", file=sys.stderr)
    print(f"  Pulled {len(my_followers):,} of your followers", file=sys.stderr)
    print(f"  Pulled {len(target_following):,} accounts @{TARGET_HANDLE} follows",
          file=sys.stderr)
    print(f"  Found {len(matches)} intro candidates", file=sys.stderr)
    print(f"  Estimated cost: ~${est:.2f} USD", file=sys.stderr)
    print(f"  Saved to {OUTPUT_JSON}", file=sys.stderr)
    print(f"{'='*60}\n", file=sys.stderr)

    print(f"# Mutuals — follow you AND followed by @{TARGET_HANDLE}\n")
    print(f"# Sorted by smallest follower count first (often = closer ties)\n")
    for u in matches:
        check = " ✓" if getattr(u, "verified", False) else ""
        n = (u.public_metrics or {}).get("followers_count", 0)
        bio = (u.description or "").replace("\n", " ").strip()
        print(f"@{u.username}{check}  —  {u.name}  ({n:,} followers)")
        if bio:
            print(f"   {bio[:180]}")
        print()


if __name__ == "__main__":
    main()
