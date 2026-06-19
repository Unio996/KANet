// J2-tn Lane① backfill: pool_markets.metadata.phase2_maker_payout_sompi for historical settled markets.
//
// 背景: settler forward fix 记 phase2_maker_payout_sompi (maker 地址 output 总额, GROSS) 进 metadata,
//   但已 settled 老单缺该字段 → KANet-UI maker 视图显 'settled_pending_payout' (realized P&L=0, 等回填)。
//
// 方法: 每 settled 市场 → maker_relay_id → relay_nodes.address → phase2_outputs 里 maker 地址 output 总额
//   (= 同 settler forward L1915 逻辑: outputs.filter(addr==maker).sum)。GROSS payout (赢含 stake 返还+winnings,
//   输=0)。KANet-UI 读侧 P&L = payout - stake。
//
// 安全: 只补缺 phase2_maker_payout_sompi 的市场 (已有不覆盖)。保留原 metadata 其余字段 (parse→加字段→stringify)。
//   cross-node maker (maker_relay_id='cross-node:..') 无本地地址 → 跳 (honest, 该节点不是 settle 发起方)。
//
// 用: node scripts/backfill-maker-payout.cjs          (dry-run, 默认)
//     node scripts/backfill-maker-payout.cjs --apply   (实写)

const D = require('better-sqlite3');
const path = require('path');
const APPLY = process.argv.includes('--apply');
const db = new D(path.join(__dirname, '..', 'data', 'console.db'));

const mkts = db.prepare(`
  SELECT id, maker_relay_id, metadata FROM pool_markets
  WHERE settle_txid IS NOT NULL AND metadata LIKE '%phase2_outputs%'
`).all();

const plan = [];
const flags = [];
for (const m of mkts) {
  let meta = {}; try { meta = JSON.parse(m.metadata); } catch { flags.push(`${m.id.slice(-6)} bad metadata json`); continue; }
  if (meta.phase2_maker_payout_sompi != null) continue;  // 已有, 不覆盖
  if (String(m.maker_relay_id || '').startsWith('cross-node')) { flags.push(`${m.id.slice(-6)} cross-node maker, skip`); continue; }
  const mr = db.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(m.maker_relay_id);
  if (!mr || !mr.address) { flags.push(`${m.id.slice(-6)} no maker addr`); continue; }
  const outs = meta.phase2_outputs || [];
  const payout = outs.filter(o => o.address === mr.address).reduce((s, o) => s + (parseInt(o.amountSompi, 10) || 0), 0);
  meta.phase2_maker_payout_sompi = payout;
  plan.push({ id: m.id, market: m.id.slice(-6), payout, metaStr: JSON.stringify(meta) });
}

let totalKas = 0; plan.forEach(p => totalKas += p.payout / 1e8);
console.log(`[backfill-maker-payout] ${APPLY ? 'APPLY' : 'DRY-RUN'}: ${plan.length} markets, total maker payout ${totalKas.toFixed(4)} KAS, flags: ${flags.length}`);
flags.forEach(f => console.log('  FLAG:', f));
plan.slice(0, 12).forEach(p => console.log(`  ${p.market}: payout ${(p.payout / 1e8).toFixed(4)} KAS`));
if (plan.length > 12) console.log(`  ... +${plan.length - 12} more`);

if (APPLY) {
  const upd = db.prepare('UPDATE pool_markets SET metadata = ? WHERE id = ?');
  const tx = db.transaction((items) => { let n = 0; for (const p of items) n += upd.run(p.metaStr, p.id).changes; return n; });
  const changed = tx(plan);
  console.log(`[backfill-maker-payout] APPLIED: ${changed} markets updated`);
} else {
  console.log('[backfill-maker-payout] dry-run only — re-run with --apply to write');
}
db.close();
