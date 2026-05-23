#!/usr/bin/env node
// Bettor 捡尸 scanner — Owner 5/14 14:00 严训"离揭晓越近变数越小, 捡尸"
//
// 核心 filter:
//   - deadline 临近 (1-48 小时 default, configurable up to 7 天)
//   - 大势已定 (yes 价已收敛到 < 15% 或 > 85%)
//   - 流动性还在 (vol_24h > $5K AND liquidity > $10K)
//   - 价格稳定 (1week change abs < 10pp — 没新闻冲击)
//
// 思想:
//   - 不赌 long-tail "几个月后某人不会赢" — 变数太大
//   - 不赌中间价 mispricing — 容易被突发事件击穿
//   - 捡尸 = 市场已经判决, 只剩 5-15% 残值给慢一步出场的散户 / 给 fees / 给最后一公里风险
//   - 多笔小单复利 > 单笔大单

import https from 'node:https';

async function fetchPage(off, maxDays) {
  const now = new Date();
  const cutoff = new Date(now.getTime() + maxDays * 86400000).toISOString().slice(0, 10);
  return new Promise((resolve, reject) => {
    const url = `https://gamma-api.polymarket.com/markets?end_date_min=${now.toISOString().slice(0, 10)}&end_date_max=${cutoff}&closed=false&limit=500&offset=${off}`;
    https.get(url, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function scoreScavenger(m) {
  // returns { side, lockPct, riskNotes[] } or null
  if (!m.outcomePrices) return null;
  let yes;
  try { yes = parseFloat(JSON.parse(m.outcomePrices)[0]); } catch { return null; }
  if (Number.isNaN(yes) || yes <= 0 || yes >= 1) return null;
  if (!m.endDate) return null;
  const hoursToDeadline = (new Date(m.endDate).getTime() - Date.now()) / 3600000;
  if (hoursToDeadline < 0 || hoursToDeadline > 720) return null;  // < 30 天 (上限松开, 按类型评估)

  // Mispricing direction — Owner 14:10 钦定 "20% 以内都扒"
  let side, lockPct;
  if (yes <= 0.20 && yes >= 0.005) {
    side = 'BUY_NO';
    lockPct = yes;
  } else if (yes >= 0.80 && yes <= 0.995) {
    side = 'BUY_YES';
    lockPct = 1 - yes;
  } else {
    return null;
  }

  const vol24 = m.volume24hr || 0;
  const liq = m.liquidity || 0;
  const oneWeekChange = Math.abs(m.oneWeekPriceChange || 0);

  // Hard liquidity filter — can't trade if no depth
  if (vol24 < 1000) return null;
  if (liq < 5000) return null;

  // Risk notes
  const notes = [];
  if (hoursToDeadline < 6) notes.push('< 6h');
  else if (hoursToDeadline < 24) notes.push('< 24h');
  else if (hoursToDeadline < 72) notes.push('< 3d');
  else notes.push('< 7d');

  if (oneWeekChange > 0.10) notes.push(`1w_jolt_${(oneWeekChange*100).toFixed(0)}pp`);
  else if (oneWeekChange < 0.02) notes.push('stable');

  if (lockPct < 0.02) notes.push('<2%_after_fees_likely_negative');
  else if (lockPct < 0.05) notes.push('thin_after_fees');

  // Position size suggestion (conservative — single trade)
  const suggestedSize = Math.min(100, Math.floor(liq * 0.005));

  return {
    conditionId: m.conditionId,
    question: m.question,
    end_date: m.endDate,
    hoursToDeadline: hoursToDeadline.toFixed(1),
    yes_price: yes,
    side,
    lockPct,
    vol24h: vol24,
    liq,
    oneWeekChange,
    suggestedSize,
    notes,
  };
}

async function main() {
  console.log('[scavenger] Fetching active markets ending within 7 days...\n');
  let all = [];
  for (let off = 0; off < 8000; off += 500) {
    try {
      const p = await fetchPage(off, 30);
      all = all.concat(p);
      if (p.length < 500) break;
    } catch (e) {
      console.error(`[scavenger] page off=${off} err: ${e.message}`);
      break;
    }
  }
  console.log(`[scavenger] fetched ${all.length} markets ending within 30 days\n`);

  const candidates = [];
  for (const m of all) {
    const c = scoreScavenger(m);
    if (c) candidates.push(c);
  }

  // Rank by deadline soonness × lock% (penalize thin spreads)
  candidates.sort((a, b) => {
    // smaller hours = better; bigger lockPct = better
    const aScore = a.lockPct / Math.max(1, parseFloat(a.hoursToDeadline) / 24);
    const bScore = b.lockPct / Math.max(1, parseFloat(b.hoursToDeadline) / 24);
    return bScore - aScore;
  });

  console.log(`=== 捡尸候选 (deadline < 7 天, yes < 15% or > 85%, vol > $1K, liq > $5K) — ${candidates.length} 个 ===\n`);
  console.log('hours    yes     side     lock%   vol24h     liq        size  notes               question');
  console.log('-------- ------- -------- ------- ---------- ---------- ----- ------------------- --------');
  for (const c of candidates.slice(0, 40)) {
    const h = String(c.hoursToDeadline).padStart(6);
    const y = c.yes_price.toFixed(4).padStart(7);
    const s = c.side.padEnd(8);
    const lp = (c.lockPct * 100).toFixed(2).padStart(6);
    const v = (c.vol24h | 0).toString().padStart(9);
    const l = (c.liq | 0).toString().padStart(10);
    const sz = ('$' + c.suggestedSize).padStart(5);
    const notes = c.notes.join(',').padEnd(20).slice(0, 20);
    console.log(`${h}h  ${y} ${s} ${lp}%  ${v}  ${l}  ${sz}  ${notes}  ${c.question?.slice(0, 65)}`);
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
