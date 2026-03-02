#!/usr/bin/env node
/**
 * Owockibot Weekly Digest Generator
 * Pulls from bounty board API + Safe API, outputs markdown + HTML email
 * Usage: node digest.js [--week YYYY-MM-DD]
 */

const BOUNTY_API  = 'https://www.owockibot.xyz/api/bounty-board';
const STATS_API   = 'https://www.owockibot.xyz/api/bounty-board/stats';
const SAFE_ADDR   = '0x26B7805Dd8aEc26DA55fc8e0c659cf6822b740Be';
const SAFE_API    = `https://safe-transaction-base.safe.global/api/v1/safes/${SAFE_ADDR}/`;
const SAFE_TXS    = `https://safe-transaction-base.safe.global/api/v1/safes/${SAFE_ADDR}/multisig-transactions/?limit=10`;

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

function weekAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d;
}

function fmt(n, dec=2) { return Number(n || 0).toFixed(dec); }
function fmtUSDC(n)    { return `$${fmt(n)} USDC`; }
function fmtDate(d)    { return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
function weekRange()   { return `${fmtDate(weekAgo())} – ${fmtDate(new Date())}`; }

async function fetchBounties() {
  try {
    const data = await fetchJSON(BOUNTY_API);
    return Array.isArray(data) ? data : (data.bounties ?? data.data ?? []);
  } catch { return []; }
}

async function fetchStats() {
  try { return await fetchJSON(STATS_API); }
  catch { return { total:0, open:0, claimed:0, submitted:0, completed:0, cancelled:0, total_volume_usdc:0, total_posted_usdc:0 }; }
}

async function fetchSafe() {
  try {
    const [safe, txs] = await Promise.all([
      fetchJSON(SAFE_API),
      fetchJSON(SAFE_TXS),
    ]);
    return { safe, txs: txs.results ?? [] };
  } catch { return { safe: null, txs: [] }; }
}

function filterThisWeek(items, dateField) {
  const cutoff = weekAgo().getTime();
  return items.filter(b => new Date(b[dateField] ?? b.created_at ?? b.submissionDate ?? 0).getTime() > cutoff);
}

async function generate() {
  const [bounties, stats, { safe, txs }] = await Promise.all([
    fetchBounties(),
    fetchStats(),
    fetchSafe(),
  ]);

  const weekCompleted = filterThisWeek(bounties.filter(b => b.status === 'completed'), 'updated_at');
  const weekClaimed   = filterThisWeek(bounties.filter(b => b.status === 'claimed'),   'updated_at');
  const weekPosted    = filterThisWeek(bounties,                                        'created_at');
  const openBounties  = bounties.filter(b => b.status === 'open');

  const weekUSDC = weekCompleted.reduce((s,b) => s + (b.reward_usdc ?? 0), 0);

  // New builders = unique claimers this week
  const newBuilders = new Set(weekClaimed.map(b => b.claimer_address).filter(Boolean));

  // Safe treasury
  const ethBalance = safe ? parseFloat(safe.balance ?? '0') / 1e18 : null;

  // Recent treasury txs (this week)
  const weekTxs = txs.filter(tx => new Date(tx.submissionDate ?? 0).getTime() > weekAgo().getTime());

  // ── Markdown ──────────────────────────────────────────────────────────────

  const md = `# 🌊 Owockibot Weekly Digest
**${weekRange()}**

---

## 📊 At a Glance

| Metric | This Week | All Time |
|--------|-----------|----------|
| Bounties Completed | ${weekCompleted.length} | ${stats.completed ?? '—'} |
| USDC Paid | ${fmtUSDC(weekUSDC)} | ${fmtUSDC(stats.total_volume_usdc)} |
| New Builders | ${newBuilders.size} | — |
| Open Bounties | ${stats.open ?? openBounties.length} | — |
| Total Bounties | — | ${stats.total ?? '—'} |
${ethBalance !== null ? `| Treasury (ETH) | — | ${fmt(ethBalance, 4)} ETH |` : ''}

---

## ✅ Completed This Week

${weekCompleted.length === 0 ? '_No completions this week._' : weekCompleted.map(b => `- **${b.title ?? 'Untitled'}** — ${fmtUSDC(b.reward_usdc)} · by \`${b.claimer_address?.slice(0,10) ?? '?'}...\``).join('\n')}

---

## 🏃 Active / Claimed

${weekClaimed.length === 0 ? '_No new claims this week._' : weekClaimed.map(b => `- **${b.title ?? 'Untitled'}** — ${fmtUSDC(b.reward_usdc)}`).join('\n')}

---

## 📋 Open Bounties (Unclaimed)

${openBounties.length === 0 ? '_No open bounties right now._' : openBounties.map(b => `- **${b.title ?? 'Untitled'}** — ${fmtUSDC(b.reward_usdc)} · [Claim →](https://www.owockibot.xyz/bounty)`).join('\n')}

---

## 🏦 Treasury Activity

${weekTxs.length === 0 ? '_No on-chain activity this week._' : weekTxs.map(tx => `- \`${fmtDate(tx.submissionDate)}\` — ${tx.dataDecoded?.method ?? 'TX'} · ${tx.isExecuted ? '✅ Executed' : '⏳ Pending'}`).join('\n')}

${ethBalance !== null ? `\n**Safe balance:** ${fmt(ethBalance, 4)} ETH  \n**Safe address:** \`${SAFE_ADDR}\`` : ''}

---

## 🆕 New Builders This Week

${newBuilders.size === 0 ? '_None yet — be the first!_' : Array.from(newBuilders).map(b => `- \`${b}\``).join('\n')}

---

_Digest generated ${new Date().toISOString()} · [owockibot.xyz](https://www.owockibot.xyz) · [Bounty Board](https://www.owockibot.xyz/bounty)_
`;

  // ── HTML Email Template ───────────────────────────────────────────────────

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Owockibot Weekly Digest — ${weekRange()}</title>
<style>
  body{margin:0;padding:0;background:#0d0d0d;font-family:'Courier New',monospace;color:#e5e5e5;}
  .wrap{max-width:620px;margin:32px auto;background:#111;border:1px solid #222;border-radius:6px;overflow:hidden;}
  .hdr{background:#0a0a0a;border-bottom:2px solid #f5c518;padding:24px 28px;}
  .hdr h1{font-size:18px;color:#f5c518;margin:0 0 4px;letter-spacing:.1em;}
  .hdr p{font-size:12px;color:#555;margin:0;}
  .body{padding:24px 28px;}
  .stats-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px;}
  .stat-box{background:#0a0a0a;border:1px solid #1f1f1f;border-radius:4px;padding:14px;text-align:center;}
  .stat-box .val{font-size:22px;font-weight:bold;color:#f5c518;display:block;}
  .stat-box .lbl{font-size:10px;color:#555;letter-spacing:.08em;}
  h2{font-size:13px;color:#f5c518;letter-spacing:.08em;border-bottom:1px solid #1f1f1f;padding-bottom:6px;margin:20px 0 12px;}
  ul{margin:0 0 16px;padding:0;list-style:none;}
  li{font-size:12px;color:#ccc;padding:6px 0;border-bottom:1px solid #1a1a1a;}
  li:last-child{border:none;}
  .badge{display:inline-block;background:#1a2e1a;color:#4ade80;font-size:10px;padding:2px 6px;border-radius:3px;margin-left:8px;}
  .badge.open{background:#1a1f2e;color:#60a5fa;}
  a{color:#f5c518;text-decoration:none;}
  .ftr{background:#0a0a0a;border-top:1px solid #1a1a1a;padding:14px 28px;font-size:10px;color:#444;text-align:center;}
  .empty{color:#444;font-size:12px;font-style:italic;}
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <h1>🌊 OWOCKIBOT WEEKLY DIGEST</h1>
    <p>${weekRange()}</p>
  </div>
  <div class="body">
    <div class="stats-grid">
      <div class="stat-box"><span class="val">${weekCompleted.length}</span><span class="lbl">COMPLETED</span></div>
      <div class="stat-box"><span class="val">${fmtUSDC(weekUSDC)}</span><span class="lbl">USDC PAID</span></div>
      <div class="stat-box"><span class="val">${newBuilders.size}</span><span class="lbl">NEW BUILDERS</span></div>
      <div class="stat-box"><span class="val">${openBounties.length}</span><span class="lbl">OPEN NOW</span></div>
      <div class="stat-box"><span class="val">${fmtUSDC(stats.total_volume_usdc)}</span><span class="lbl">ALL TIME</span></div>
      <div class="stat-box"><span class="val">${stats.total ?? '—'}</span><span class="lbl">TOTAL BOUNTIES</span></div>
    </div>

    <h2>✅ COMPLETED THIS WEEK</h2>
    ${weekCompleted.length === 0
      ? '<p class="empty">No completions this week.</p>'
      : `<ul>${weekCompleted.map(b=>`<li>${b.title??'Untitled'}<span class="badge">${fmtUSDC(b.reward??b.amount)}</span></li>`).join('')}</ul>`}

    <h2>📋 OPEN BOUNTIES — CLAIM NOW</h2>
    ${openBounties.length === 0
      ? '<p class="empty">No open bounties right now.</p>'
      : `<ul>${openBounties.map(b=>`<li><a href="https://www.owockibot.xyz/bounty">${b.title??'Untitled'}</a><span class="badge open">${fmtUSDC(b.reward??b.amount)}</span></li>`).join('')}</ul>`}

    <h2>🏦 TREASURY</h2>
    ${ethBalance !== null ? `<p style="font-size:12px;color:#888">Balance: <strong style="color:#f5c518">${fmt(ethBalance,4)} ETH</strong><br>Safe: <code style="font-size:10px">${SAFE_ADDR}</code></p>` : '<p class="empty">Treasury data unavailable.</p>'}
  </div>
  <div class="ftr">
    <a href="https://www.owockibot.xyz">owockibot.xyz</a> · 
    <a href="https://www.owockibot.xyz/bounty">Bounty Board</a> ·
    Generated ${new Date().toISOString().slice(0,10)}
  </div>
</div>
</body>
</html>`;

  return { md, html };
}

// ── Output ───────────────────────────────────────────────────────────────────

(async () => {
  console.error('[digest] Fetching data...');
  const { md, html } = await generate();

  const { writeFileSync } = await import('fs');
  writeFileSync('digest.md',   md,   'utf8');
  writeFileSync('digest.html', html, 'utf8');

  console.log('✅ digest.md    — Markdown version');
  console.log('✅ digest.html  — HTML email template');
  console.log('\n--- MARKDOWN PREVIEW ---\n');
  console.log(md.slice(0, 800));
})().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
