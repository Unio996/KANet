// capture-side-lock-daa.test.mjs — offline ground-truth test for captureSideLockDaa's block_hash method
// switch (Bettor 2026-07-08 22:04, #b75exc condition ③): patched output must byte-exact match a manual
// RPC getBlock(block_hash).header.daaScore query, using tonight's two REAL uqmp8 bets as fixtures.
import { captureSideLockDaa } from './trade-protocol-filter.js';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

// Ground truth captured 2026-07-08 22:0x via direct RPC getBlock(hash).header.daaScore against TN12 live node
// (kasia-console/src/services/trade-protocol-filter.js.getBlock, same call the patched function now makes).
// ⚠ 已知会随时间自然过期(2026-07-12 观察到实测 fail): 这两个 block_hash 是 2026-07-08 的真实数据,
// TN12 剪裁点持续推进(今晚整晚的主题), 4 天后这两个块本身已被 kaspad 物理剪裁——`getBlock(hash)`
// 会 RPC 报错"cannot find header", 这不是回归, 是"历史 fixture 引用的块被剪裁"这一类会自然复发的
// staleness, 同 §下方新增的 §2 real-bet 案例迟早也会遇到同样的命运(留档不删, 让接位者一眼看懂
// 这条失败的性质, 而不是误判成新 bug)。
const REAL_BETS = [
  { label: 'uqmp8 NO (tester-1)', side_lock_tx: '14890ec43e1308a17b92580ef79cd0f0313cc20afe7e4c7bbab77af87ccd5846', side_p2sh: 'kaspatest:pz8antzr3ahsln3fpx6aglqrhxvv4dra4z2a0h6jjvw38klss0y9x40e77sj7', stake_amount: '150000000', expectedDaa: 55371942 },
  { label: 'uqmp8 YES (J2test)', side_lock_tx: 'fd8711d8302cb0dfad41061ef0bdb39b6b695929b5587d804bb7dafa51e1845e', side_p2sh: 'kaspatest:pz8antzr3ahsln3fpx6aglqrhxvv4dra4z2a0h6jjvw38klss0y9x40e77sj7', stake_amount: '150000000', expectedDaa: 55376892 },
];

// §2 — indexer-miss fallback (2026-07-12, 第六件大考 a4343 撞出真 bug, #gry4yj.2): 原实现命中
// kaspa_tx_log 索引缺口就永久放弃(daa=null, no-block-hash), 无重试无退化——a4343 的两笔真实 bet
// (2026-07-11 深夜下注, 从未被本地 indexer 收录)卡死了 propose 自治链。修法: indexer 未命中时,
// 用 approxDaaHint(市场 deadline_daa, bet 必然发生在其之前的天然上界)现查 v183 spc_daa_index 拿
// 一个近锚点, 再有界(MAX_STEPS=10000)沿 selectedParentHash 回走比对 tx_id, 找块内容而非查 UTXO
// 集合状态(不受"bet 是否已被吸收进 shard 聚合 leaf"影响, 2026-07-08 method switch 那次假阴性
// 教训的镜像)。下面两条断言是 2026-07-12 现场对 a4343 真实卡住的两笔 bet 直接验证, 非合成 fixture
// ——同上面 REAL_BETS 一样, 未来也会随剪裁点推进而自然过期(届时这条断言失败 = staleness, 非回归)。
const INDEXER_MISS_REAL_BETS = [
  { label: 'a4343 bet1 (e92cf4a3, YES)', side_lock_tx: '2e8a68e97bf33a208012b27a56a1f07e6cf6e69771e44d0796d045e7259cbe23', side_p2sh: 'kaspatest:pr4pa954ksfdn6u3eh3xepsl9ry89n2l8d7jalk7ff3kvmvtae3sxr7qpy40q', stake_amount: '250000000', approxDaaHint: 58140420, expectedDaa: 58128742 },
  { label: 'a4343 bet2 (ff18f539, NO)', side_lock_tx: 'c66bf9661a01adda383a252cbe1b409e5385d539c12230e2e6a23a034eb4ab5e', side_p2sh: 'kaspatest:pr4pa954ksfdn6u3eh3xepsl9ry89n2l8d7jalk7ff3kvmvtae3sxr7qpy40q', stake_amount: '250000000', approxDaaHint: 58140420, expectedDaa: 58128844 },
];

async function main() {
  for (const b of REAL_BETS) {
    const { daa, reason } = await captureSideLockDaa({ side_p2sh: b.side_p2sh, side_lock_tx: b.side_lock_tx, stake_amount: b.stake_amount, network: 'testnet-12' });
    ok(reason === 'ok', `${b.label}: reason='ok' (got '${reason}')`);
    ok(daa === b.expectedDaa, `${b.label}: daa=${daa} byte-exact == manual RPC ground truth ${b.expectedDaa}`);
  }

  for (const b of INDEXER_MISS_REAL_BETS) {
    const { daa, reason } = await captureSideLockDaa({ side_p2sh: b.side_p2sh, side_lock_tx: b.side_lock_tx, stake_amount: b.stake_amount, network: 'testnet-12', approxDaaHint: b.approxDaaHint });
    ok(reason === 'ok', `${b.label}: reason='ok' via indexer-miss fallback (got '${reason}')`);
    ok(daa === b.expectedDaa, `${b.label}: daa=${daa} byte-exact == manually-verified value ${b.expectedDaa}`);
  }

  // fail-loud: unknown tx_id (not in kaspa_tx_log, not found in bounded backward scan either) must
  // return null + 'no-block-hash', never guess.
  const { daa: unknownDaa, reason: unknownReason } = await captureSideLockDaa({ side_p2sh: 'kaspatest:fake', side_lock_tx: 'ff'.repeat(32), stake_amount: '1', network: 'testnet-12' });
  ok(unknownDaa === null, `unknown tx: daa=null (got ${unknownDaa})`);
  ok(unknownReason === 'no-block-hash', `unknown tx: reason='no-block-hash' (got '${unknownReason}')`);

  console.log(fails === 0 ? '\n✅✅ ALL PASS — captureSideLockDaa block_hash method + indexer-miss fallback verified byte-exact against real chain data' : `\n❌ ${fails} assertions failed`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e.message, e.stack); process.exit(1); });
