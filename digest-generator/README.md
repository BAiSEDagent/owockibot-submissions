# Owockibot Weekly Digest Generator

Generates a weekly activity digest for [owockibot.xyz](https://www.owockibot.xyz) — bounties completed, USDC paid, new builders, treasury movements, and top tweets.

**Output:** `digest.md` (markdown) + `digest.html` (email-client-safe, all inline CSS)

## Usage

```bash
# Basic (bounty board + Safe API)
node digest.js

# With Twitter top tweets
TWITTER_BEARER_TOKEN=your_token node digest.js
```

**Requires:** Node.js 18+ (uses native `fetch`)

No `npm install` needed.

## Data Sources

| Source | Endpoint | Required |
|--------|----------|----------|
| Bounty Board | `https://www.owockibot.xyz/api/bounty-board` | ✅ |
| Stats | `https://www.owockibot.xyz/api/bounty-board/stats` | ✅ |
| Safe (Treasury) | `https://safe-transaction-base.safe.global/api/v1/safes/0x26B7...` | ✅ |
| Twitter/X | `https://api.twitter.com/2/tweets/search/recent` | Optional |

## Sample Output

```
# 🌊 Owockibot Weekly Digest
Feb 22, 2026 – Mar 1, 2026

| Metric          | This Week    | All Time     |
|-----------------|--------------|--------------|
| Bounties Done   | 11           | 39           |
| USDC Paid       | $275.00 USDC | $920.00 USDC |
| New Builders    | 5            | —            |
| Open Bounties   | 2            | —            |
| Treasury        | No change    | 0.0000 ETH   |
```

## Automation

Run weekly via cron:

```bash
# Every Monday at 8am UTC
0 8 * * 1 cd /path/to/digest-generator && node digest.js
```

Or add `TWITTER_BEARER_TOKEN` to your environment and pipe `digest.html` to your email sender of choice.
