// J2-tn Lane① backfill: oracle_history.reward_amount (SOMPI) for historical settled markets.
//
// 背景: settler forward fix 记 oracle reward (oracleFeePerSig, sompi) 进 oracle_history.reward_amount,
//   但已 settled 老单 reward_amount 恒 0 → reputation 面板显'暂无收益'实则赚了 (同 broker fee 病, Bettor r638)。
//
// 方法 (per-行 ADDR-match, 比 per-市场 cluster 可靠 — cluster 对 N=1 不完整历史把 winner output 误判 oracle fee,
//   e.g. w0s3m cluster 142 KAS vs 实际 oracle fee 0.1999 KAS):
//   每 oracle_history vote!=null 行 → oracle_relay_id → relay_nodes.address → 该市场 phase2_outputs 匹配地址
//   (value >= bond, 取最小 >= bond 防撞 winner) → reward = output - bond (sompi)。
//   committeeMode uniform (J2 r643): 同市场全委员同 oracleFeePerSig, dry-run 断言 0 non-uniform 已证。
//
// 安全: 只更 reward_amount=0/NULL 行 (per-id 精确, 不覆盖已记)。写 SOMPI (守 _sompi 约定, 读侧 fmtKas /1e8)。
//   scope = settled + phase2_outputs + vote!=null; 更老无 phase2_outputs 留 0 (honest, 无 output 数据不能重构)。
//
// 用: node scripts/backfill-oracle-reward.cjs          (dry-run, 默认)
//     node scripts/backfill-oracle-reward.cjs --apply   (实写)

const D = require('better-sqlite3');
const path = require('path');
const APPLY = process.argv.includes('--apply');
const db = new D(path.join(__dirname, '..', 'data', 'console.db'));

const rows = db.prepare(`
  SELECT oh.id, oh.oracle_relay_id, oh.market_id, oh.reward_amount
  FROM oracle_history oh JOIN pool_markets pm ON pm.id = oh.market_id
  WHERE oh.vote IS NOT NULL AND pm.settle_txid IS NOT NULL
    AND pm.metadata LIKE '%phase2_outputs%'
    AND (oh.reward_amount IS NULL OR oh.reward_amount = 0)
`).all();

const mcache = {};
const byMarket = {};
const plan = [];
const flags = [];
for (const r of rows) {
  const rn = db.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(r.oracle_relay_id);
  if (!rn || !rn.address) { flags.push(`${r.id} no relay addr (${r.oracle_relay_id})`); continue; }
  if (!mcache[r.market_id]) {
    const m = db.prepare('SELECT oracle_bond_amount, metadata FROM pool_markets WHERE id = ?').get(r.market_id);
    let meta = {}; try { meta = JSON.parse(m.metadata); } catch {}
    mcache[r.market_id] = {
      bond: Number(m.oracle_bond_amount || 0),
      outs: (meta.phase2_outputs || []).map(o => ({ a: o.address, v: Number(o.amountSompi) })),
    };
  }
  const { bond, outs } = mcache[r.market_id];
  const cands = outs.filter(o => o.a === rn.address && o.v >= bond).sort((a, b) => a.v - b.v);
  if (!cands.length) { flags.push(`${r.market_id.slice(-6)} addr not in outputs(>=bond)`); continue; }
  const perSig = cands[0].v - bond;
  if (perSig < 0) { flags.push(`${r.market_id.slice(-6)} negative perSig`); continue; }
  (byMarket[r.market_id] = byMarket[r.market_id] || []).push(perSig);
  plan.push({ id: r.id, market: r.market_id.slice(-6), reward: perSig });
}

// uniform assertion (committeeMode: same market → same oracleFeePerSig)
let nonUniform = 0;
for (const mid in byMarket) {
  if (new Set(byMarket[mid]).size > 1) { nonUniform++; flags.push(`${mid.slice(-6)} NON-UNIFORM: ${[...new Set(byMarket[mid])].map(v => (v / 1e8).toFixed(4)).join(',')}`); }
}

let totalKas = 0; plan.forEach(p => totalKas += p.reward / 1e8);
console.log(`[backfill-oracle-reward] ${APPLY ? 'APPLY' : 'DRY-RUN'}: ${plan.length} rows, ${Object.keys(byMarket).length} markets, total ${totalKas.toFixed(4)} KAS`);
console.log(`[backfill-oracle-reward] non-uniform: ${nonUniform}, flags: ${flags.length}`);
flags.forEach(f => console.log('  FLAG:', f));

if (nonUniform > 0) { console.error('[backfill-oracle-reward] ABORT: non-uniform markets detected, manual review needed'); process.exit(1); }

if (APPLY) {
  const upd = db.prepare('UPDATE oracle_history SET reward_amount = ? WHERE id = ? AND (reward_amount IS NULL OR reward_amount = 0)');
  const tx = db.transaction((items) => { let n = 0; for (const p of items) n += upd.run(p.reward, p.id).changes; return n; });
  const changed = tx(plan);
  console.log(`[backfill-oracle-reward] APPLIED: ${changed} rows updated`);
} else {
  console.log('[backfill-oracle-reward] dry-run only — re-run with --apply to write');
}
db.close();
