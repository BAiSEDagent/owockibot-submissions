#!/usr/bin/env node
/**
 * Owockibot Weekly Digest Generator
 * Pulls from: bounty board API, Safe API, Twitter/X (optional — needs TWITTER_BEARER_TOKEN)
 * Output: digest.md + digest.html (email-client-safe inline CSS)
 * Usage: node digest.js
 *        TWITTER_BEARER_TOKEN=xxx node digest.js
 */

const BOUNTY_API = 'https://www.owockibot.xyz/api/bounty-board';
const STATS_API  = 'https://www.owockibot.xyz/api/bounty-board/stats';
const SAFE_ADDR  = '0x26B7805Dd8aEc26DA55fc8e0c659cf6822b740Be';
const SAFE_API   = `https://safe-transaction-base.safe.global/api/v1/safes/${SAFE_ADDR}/`;
const SAFE_TXS   = `https://safe-transaction-base.safe.global/api/v1/safes/${SAFE_ADDR}/multisig-transactions/?limit=20`;
const TWITTER_BEARER = process.env.TWITTER_BEARER_TOKEN ?? '';
const TWITTER_SEARCH = 'https://api.twitter.com/2/tweets/search/recent?query=%40owockibot%20-is%3Aretweet&max_results=10&tweet.fields=public_metrics,created_at';

async function fetchJSON(url, headers = {}) {
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function weekAgo()    { const d = new Date(); d.setDate(d.getDate() - 7); return d; }
function fmtDate(d)   { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function weekRange()  { return `${fmtDate(weekAgo())} – ${fmtDate(new Date())}`; }
function fmtUSDC(n)   { return `$${Number(n || 0).toFixed(2)} USDC`; }
function fmtETH(n)    { return `${(Number(n || 0) / 1e18).toFixed(4)} ETH`; }
function truncAddr(a) { return a ? `${a.slice(0, 10)}...` : '?'; }

function thisWeek(items, field = 'updated_at') {
  const cutoff = weekAgo().getTime();
  return items.filter(b => new Date(b[field] ?? 0).getTime() > cutoff);
}

async function fetchBounties() {
  try { const d = await fetchJSON(BOUNTY_API); return Array.isArray(d) ? d : (d.bounties ?? []); }
  catch (e) { console.error('[warn] bounties:', e.message); return []; }
}

async function fetchStats() {
  try { return await fetchJSON(STATS_API); }
  catch { return { total: 0, open: 0, completed: 0, total_volume_usdc: 0 }; }
}

async function fetchSafe() {
  try {
    const [safe, txsRes] = await Promise.all([fetchJSON(SAFE_API), fetchJSON(SAFE_TXS)]);
    const txs = txsRes.results ?? [];
    const weekTxs = thisWeek(txs, 'submissionDate');
    // Balance delta: sum outgoing ETH this week
    const weekDelta = weekTxs.reduce((s, tx) => {
      if (tx.isExecuted && tx.transfers) {
        tx.transfers.forEach(t => { if (t.type === 'ETHER_TRANSFER') s += Number(t.value ?? 0); });
      }
      return s;
    }, 0);
    return { ethBalance: Number(safe.balance ?? '0'), weekTxs, weekDelta };
  } catch (e) { console.error('[warn] safe:', e.message); return { ethBalance: 0, weekTxs: [], weekDelta: 0 }; }
}

async function fetchTweets() {
  if (!TWITTER_BEARER) {
    console.error('[info] Twitter: set TWITTER_BEARER_TOKEN env var to include tweets');
    return [];
  }
  try {
    const data = await fetchJSON(TWITTER_SEARCH, { Authorization: `Bearer ${TWITTER_BEARER}` });
    return (data.data ?? [])
      .sort((a, b) => (b.public_metrics?.like_count ?? 0) - (a.public_metrics?.like_count ?? 0))
      .slice(0, 5);
  } catch (e) { console.error('[warn] twitter:', e.message); return []; }
}

async function generate() {
  console.error('[digest] Fetching data...');
  const [bounties, stats, { ethBalance, weekTxs, weekDelta }, tweets] = await Promise.all([
    fetchBounties(), fetchStats(), fetchSafe(), fetchTweets(),
  ]);

  const completed  = bounties.filter(b => b.status === 'completed');
  const weekDone   = thisWeek(completed, 'updated_at');
  const weekClaim  = thisWeek(bounties.filter(b => b.status === 'claimed'), 'updated_at');
  const open       = bounties.filter(b => b.status === 'open');
  const weekUSDC   = weekDone.reduce((s, b) => s + (b.reward_usdc ?? 0), 0);
  const newBuilders = new Set(weekClaim.map(b => b.claimer_address).filter(Boolean));

  // ── Markdown ──────────────────────────────────────────────────────────────

  const tweetsMd = tweets.length
    ? tweets.map(t => `- ${t.text.slice(0, 120).replace(/\n/g, ' ')} _(❤️ ${t.public_metrics?.like_count ?? 0})_`).join('\n')
    : '_Twitter data unavailable. Set `TWITTER_BEARER_TOKEN` env var to enable._';

  const md = `# 🌊 Owockibot Weekly Digest
**${weekRange()}**

---

## 📊 At a Glance

| Metric | This Week | All Time |
|--------|-----------|----------|
| Bounties Completed | ${weekDone.length} | ${stats.completed ?? completed.length} |
| USDC Paid Out | ${fmtUSDC(weekUSDC)} | ${fmtUSDC(stats.total_volume_usdc)} |
| New Builders | ${newBuilders.size} | — |
| Open Bounties | ${open.length} | — |
| Total Bounties | — | ${stats.total ?? bounties.length} |
| Treasury (ETH) | ${weekDelta ? `-${fmtETH(weekDelta)} spent` : 'No change'} | ${fmtETH(ethBalance)} |

---

## ✅ Completed This Week

${weekDone.length
  ? weekDone.map(b => `- **${b.title}** — ${fmtUSDC(b.reward_usdc)} · by \`${truncAddr(b.claimer_address)}\``).join('\n')
  : '_No completions this week._'}

---

## 📋 Open Bounties — Claim Now

${open.length
  ? open.map(b => `- **${b.title}** — ${fmtUSDC(b.reward_usdc)} · [Claim →](https://www.owockibot.xyz/bounty)`).join('\n')
  : '_No open bounties right now._'}

---

## 🏦 Treasury Activity

**Current balance:** ${fmtETH(ethBalance)}  
**This week:** ${weekDelta ? `${fmtETH(weekDelta)} spent across ${weekTxs.length} txs` : 'No on-chain activity'}  
**Safe:** \`${SAFE_ADDR}\`

${weekTxs.length ? weekTxs.map(tx => `- \`${fmtDate(tx.submissionDate)}\` — ${tx.dataDecoded?.method ?? 'TX'} ${tx.isExecuted ? '✅' : '⏳'}`).join('\n') : ''}

---

## 🐦 Top Tweets This Week

${tweetsMd}

---

## 🆕 New Builders

${newBuilders.size
  ? Array.from(newBuilders).map(b => `- \`${b}\``).join('\n')
  : '_None this week — be the first!_'}

---

_Generated ${new Date().toISOString()} · [owockibot.xyz](https://www.owockibot.xyz) · [Bounty Board](https://www.owockibot.xyz/bounty)_
`;

  // ── HTML Email (all inline CSS — email-client safe) ───────────────────────

  const tweetRows = tweets.length
    ? tweets.map(t => `<tr><td style="padding:8px 0;border-bottom:1px solid #1a1a1a;font-size:12px;color:#ccc;font-family:'Courier New',monospace">${t.text.slice(0,140).replace(/</g,'&lt;')} <span style="color:#f5c518">❤️ ${t.public_metrics?.like_count ?? 0}</span></td></tr>`).join('')
    : `<tr><td style="padding:8px 0;font-size:12px;color:#444;font-family:'Courier New',monospace;font-style:italic">Twitter data unavailable. Set TWITTER_BEARER_TOKEN to enable.</td></tr>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Owockibot Weekly Digest — ${weekRange()}</title>
<style>
@media (max-width:600px){
  .stat-row td { display:block !important; width:100% !important; padding:0 0 10px 0 !important; }
  .bounty-row { display:flex !important; justify-content:space-between !important; align-items:flex-start !important; gap:12px !important; }
  .outer-wrap { padding:0 8px !important; }
  .inner-pad { padding:16px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Courier New',monospace;color:#e5e5e5">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a">
<tr><td align="center" style="padding:32px 16px">
<table class="outer-wrap" width="620" cellpadding="0" cellspacing="0" style="background:#111;border:1px solid #222;border-radius:6px;overflow:hidden;max-width:620px;width:100%">

  <!-- Header -->
  <tr><td style="background:#0a0a0a;border-bottom:2px solid #f5c518;padding:24px 28px">
    <p style="margin:0 0 4px;font-size:20px;color:#f5c518;font-weight:bold;letter-spacing:.1em;font-family:'Courier New',monospace">🌊 OWOCKIBOT WEEKLY DIGEST</p>
    <p style="margin:0;font-size:12px;color:#555;font-family:'Courier New',monospace">${weekRange()}</p>
  </td></tr>

  <!-- Stats grid -->
  <tr><td class="inner-pad" style="padding:24px 28px">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr class="stat-row">
        <td width="33%" style="padding:0 6px 12px 0;text-align:center">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;border:1px solid #1f1f1f;border-radius:4px">
            <tr><td style="padding:14px;text-align:center">
              <span style="display:block;font-size:22px;font-weight:bold;color:#f5c518;font-family:'Courier New',monospace">${weekDone.length}</span>
              <span style="font-size:10px;color:#555;letter-spacing:.08em;font-family:'Courier New',monospace">COMPLETED</span>
            </td></tr>
          </table>
        </td>
        <td width="33%" style="padding:0 6px 12px;text-align:center">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;border:1px solid #1f1f1f;border-radius:4px">
            <tr><td style="padding:14px;text-align:center">
              <span style="display:block;font-size:22px;font-weight:bold;color:#f5c518;font-family:'Courier New',monospace">${fmtUSDC(weekUSDC)}</span>
              <span style="font-size:10px;color:#555;letter-spacing:.08em;font-family:'Courier New',monospace">USDC PAID</span>
            </td></tr>
          </table>
        </td>
        <td width="33%" style="padding:0 0 12px 6px;text-align:center">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;border:1px solid #1f1f1f;border-radius:4px">
            <tr><td style="padding:14px;text-align:center">
              <span style="display:block;font-size:22px;font-weight:bold;color:#f5c518;font-family:'Courier New',monospace">${newBuilders.size}</span>
              <span style="font-size:10px;color:#555;letter-spacing:.08em;font-family:'Courier New',monospace">NEW BUILDERS</span>
            </td></tr>
          </table>
        </td>
      </tr>
      <tr class="stat-row">
        <td width="33%" style="padding:0 6px 0 0;text-align:center">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;border:1px solid #1f1f1f;border-radius:4px">
            <tr><td style="padding:14px;text-align:center">
              <span style="display:block;font-size:22px;font-weight:bold;color:#f5c518;font-family:'Courier New',monospace">${open.length}</span>
              <span style="font-size:10px;color:#555;letter-spacing:.08em;font-family:'Courier New',monospace">OPEN NOW</span>
            </td></tr>
          </table>
        </td>
        <td width="33%" style="padding:0 6px;text-align:center">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;border:1px solid #1f1f1f;border-radius:4px">
            <tr><td style="padding:14px;text-align:center">
              <span style="display:block;font-size:22px;font-weight:bold;color:#f5c518;font-family:'Courier New',monospace">${fmtUSDC(stats.total_volume_usdc)}</span>
              <span style="font-size:10px;color:#555;letter-spacing:.08em;font-family:'Courier New',monospace">ALL TIME</span>
            </td></tr>
          </table>
        </td>
        <td width="33%" style="padding:0 0 0 6px;text-align:center">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;border:1px solid #1f1f1f;border-radius:4px">
            <tr><td style="padding:14px;text-align:center">
              <span style="display:block;font-size:22px;font-weight:bold;color:#f5c518;font-family:'Courier New',monospace">${stats.total ?? bounties.length}</span>
              <span style="font-size:10px;color:#555;letter-spacing:.08em;font-family:'Courier New',monospace">TOTAL BOUNTIES</span>
            </td></tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Completed -->
    <p style="font-size:13px;color:#f5c518;letter-spacing:.08em;border-bottom:1px solid #1f1f1f;padding-bottom:6px;margin:24px 0 12px;font-family:'Courier New',monospace">✅ COMPLETED THIS WEEK</p>
    <table width="100%" cellpadding="0" cellspacing="0">
      ${weekDone.length
        ? weekDone.map(b => `<tr><td class="bounty-row" style="padding:6px 0;border-bottom:1px solid #1a1a1a;font-size:12px;color:#ccc;font-family:'Courier New',monospace;display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><span>${b.title}</span> <span style="background:#1a2e1a;color:#4ade80;font-size:10px;padding:2px 6px;border-radius:3px;font-family:'Courier New',monospace;white-space:nowrap;flex-shrink:0">${fmtUSDC(b.reward_usdc)}</span></td></tr>`).join('')
        : `<tr><td style="font-size:12px;color:#444;font-style:italic;padding:8px 0;font-family:'Courier New',monospace">No completions this week.</td></tr>`}
    </table>

    <!-- Open bounties -->
    <p style="font-size:13px;color:#f5c518;letter-spacing:.08em;border-bottom:1px solid #1f1f1f;padding-bottom:6px;margin:24px 0 12px;font-family:'Courier New',monospace">📋 OPEN BOUNTIES — CLAIM NOW</p>
    <table width="100%" cellpadding="0" cellspacing="0">
      ${open.length
        ? open.map(b => `<tr><td style="padding:6px 0;border-bottom:1px solid #1a1a1a;font-size:12px;color:#ccc;font-family:'Courier New',monospace"><a href="https://www.owockibot.xyz/bounty" style="color:#f5c518;text-decoration:none">${b.title}</a> <span style="background:#1a1f2e;color:#60a5fa;font-size:10px;padding:2px 6px;border-radius:3px;font-family:'Courier New',monospace">${fmtUSDC(b.reward_usdc)}</span></td></tr>`).join('')
        : `<tr><td style="font-size:12px;color:#444;font-style:italic;padding:8px 0;font-family:'Courier New',monospace">No open bounties right now.</td></tr>`}
    </table>

    <!-- Treasury -->
    <p style="font-size:13px;color:#f5c518;letter-spacing:.08em;border-bottom:1px solid #1f1f1f;padding-bottom:6px;margin:24px 0 12px;font-family:'Courier New',monospace">🏦 TREASURY</p>
    <p style="font-size:12px;color:#888;margin:0 0 4px;font-family:'Courier New',monospace">Balance: <strong style="color:#f5c518">${fmtETH(ethBalance)}</strong></p>
    <p style="font-size:12px;color:#888;margin:0 0 4px;font-family:'Courier New',monospace">This week: <strong style="color:${weekDelta ? '#fb7185' : '#555'}">${weekDelta ? `${fmtETH(weekDelta)} spent` : 'No change'}</strong></p>
    <p style="font-size:10px;color:#444;margin:0;font-family:'Courier New',monospace">Safe: ${SAFE_ADDR}</p>

    <!-- Tweets -->
    <p style="font-size:13px;color:#f5c518;letter-spacing:.08em;border-bottom:1px solid #1f1f1f;padding-bottom:6px;margin:24px 0 12px;font-family:'Courier New',monospace">🐦 TOP TWEETS THIS WEEK</p>
    <table width="100%" cellpadding="0" cellspacing="0">${tweetRows}</table>

  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#0a0a0a;border-top:1px solid #1a1a1a;padding:14px 28px;text-align:center">
    <p style="margin:0;font-size:10px;color:#444;font-family:'Courier New',monospace">
      <a href="https://www.owockibot.xyz" style="color:#f5c518;text-decoration:none">owockibot.xyz</a> ·
      <a href="https://www.owockibot.xyz/bounty" style="color:#f5c518;text-decoration:none">Bounty Board</a> ·
      Generated ${new Date().toISOString().slice(0, 10)}
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  return { md, html };
}

(async () => {
  const { md, html } = await generate();
  const { writeFileSync } = await import('fs');
  writeFileSync('digest.md',   md,   'utf8');
  writeFileSync('digest.html', html, 'utf8');
  console.log('✅ digest.md    — Markdown');
  console.log('✅ digest.html  — HTML email (inline CSS, email-client safe)');
  console.log('\n--- PREVIEW ---\n');
  console.log(md.slice(0, 600));
})().catch(e => { console.error('❌', e.message); process.exit(1); });
