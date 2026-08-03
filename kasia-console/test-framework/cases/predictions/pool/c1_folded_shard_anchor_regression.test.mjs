// Regression guard: C1 folded-shard chain-anchor downgrade (2026-07-11, docs/2026-07-11-c1-folded-shard-anchor-design.md)
//
// verifyBettorsCompleteFromChain's level2-A per-shard loop must SKIP the individual
// readOutpointCreatedAddr/checkUtxoLanded anchor for shards with status==='settling' (already
// folded into PayoutShard — their leaf-creation tx can genuinely predate both kaspad's pruning
// point and the local kaspa_tx_log indexer's coverage window, confirmed on real 28mln data).
// Folded shards must still contribute to the aggregate (chainCount/chainYes/chainNo/chainPool) and
// remain covered by the existing psConsolidatedPool aggregate anchor. Open/sealed shards must be
// completely unaffected (regression: their per-shard anchor check must still fire and can still BUST).
import assert from 'node:assert/strict';
import { pathToFileURL as _pathToFileURL } from 'node:url';

// relative import (not a hardcoded absolute path — each agent's checkout lives at a different
// local path, e.g. D:/kanet/KANet vs D:/kanet-tn12; NWT caught this on 99b224ee, fixed here).
const { verifyBettorsCompleteFromChain } = await import('../../../../src/lib/bshard-close-enforce.mjs');

let failures = 0;
function check(cond, msg) { if (!cond) { failures++; console.error(`❌ ${msg}`); } else { console.log(`✅ ${msg}`); } }

const MKT = 'test-c1-folded-anchor';

function shard(overrides) {
  return {
    shard_index: 0, shard_market_id: `${MKT}-s0`,
    shard_redeem_hex: '00', // p2sh() mock below ignores the actual bytes
    current_leaf_outpoint: 'deadbeef'.repeat(8) + ':0',
    current_leaf_state: JSON.stringify({ local_yes: 1000000000, local_no: 500000000, count: 2, pool_value: 1500000000 }),
    bettors: [
      { pk: 'aa'.repeat(16), direction: 0, stake_amount: 1000000000 },
      { pk: 'bb'.repeat(16), direction: 1, stake_amount: 500000000 },
    ],
    ...overrides,
  };
}
const bettors = [
  { pk: 'aa'.repeat(16), direction: 0, stake: 1000000000n },
  { pk: 'bb'.repeat(16), direction: 1, stake: 500000000n },
];

// level2-B (per-ticket) always runs regardless of level2-A outcome (fail-closed if deriveTicketAddr missing,
// per lines 876-884) — every ctx below supplies a working deriveTicketAddr + a checkUtxoLanded that returns
// true for ticket lookups (txid===null) so level2-B stays green and each case isolates level2-A behavior.
const baseTicket = { deriveTicketAddr: () => 'kaspatest:mockticket' };

// ── case 1: folded shard (status='settling') — must PASS without ever calling the per-shard anchor ──
{
  let leafAnchorCalls = 0;
  const ctx = {
    ...baseTicket,
    p2sh: () => 'kaspatest:mockaddr',
    checkUtxoLanded: async (addr, txid) => { if (txid === null) return true; leafAnchorCalls++; return false; }, // txid!=null=leaf anchor path, would BUST if called
    readOutpointCreatedAddr: async () => { leafAnchorCalls++; return null; },
    shards: [shard({ status: 'settling' })],
  };
  const r = await verifyBettorsCompleteFromChain(MKT, bettors, ctx);
  check(r.ok === true, `folded shard skips individual anchor and PASSes aggregate (got: ${JSON.stringify(r)})`);
  check(leafAnchorCalls === 0, `folded shard never calls readOutpointCreatedAddr/checkUtxoLanded for its own leaf (calls=${leafAnchorCalls})`);
}

// ── case 2: folded shard with tampered pool_value — aggregate anchor still catches it ──
{
  const ctx = {
    ...baseTicket,
    p2sh: () => 'kaspatest:mockaddr',
    checkUtxoLanded: async (addr, txid) => txid === null,
    readOutpointCreatedAddr: async () => null,
    shards: [shard({ status: 'settling' })],
    psConsolidatedPool: '999999999', // deliberately wrong vs Σloaded(1500000000)+seed
    psSeed: '0',
  };
  const r = await verifyBettorsCompleteFromChain(MKT, bettors, ctx);
  check(r.ok === false && /PS-pool/.test(r.reason || ''), `folded shard downgrade does NOT bypass the aggregate psConsolidatedPool anchor (got: ${JSON.stringify(r)})`);
}

// ── case 3: open shard (status='open') — regression, per-shard anchor still enforced, still BUSTs on mismatch ──
{
  let leafAnchorCalls = 0;
  const ctx = {
    ...baseTicket,
    p2sh: () => 'kaspatest:mockaddr',
    checkUtxoLanded: async (addr, txid) => { if (txid === null) return true; leafAnchorCalls++; return false; }, // leaf anchor: simulate not-anchored → must BUST
    shards: [shard({ status: 'open' })],
  };
  const r = await verifyBettorsCompleteFromChain(MKT, bettors, ctx);
  check(r.ok === false, `open shard (unfolded) still enforces per-shard anchor and BUSTs when it fails (got: ${JSON.stringify(r)})`);
  check(leafAnchorCalls === 1, `open shard DOES call the leaf anchor check (calls=${leafAnchorCalls}, unlike folded shards)`);
}

// ── case 4: open shard, anchor succeeds — regression baseline, unaffected by this change ──
{
  const ctx = {
    ...baseTicket,
    p2sh: () => 'kaspatest:mockaddr',
    checkUtxoLanded: async () => true,
    shards: [shard({ status: 'open' })],
  };
  const r = await verifyBettorsCompleteFromChain(MKT, bettors, ctx);
  check(r.ok === true, `open shard with a landed anchor still PASSes as before (got: ${JSON.stringify(r)})`);
}

console.log(failures === 0 ? `\n✅ ALL PASS (0 failures)` : `\n❌ ${failures} FAILURE(S)`);
// 🔴 顶层 process.exit 会杀死 runner(2026-08-04 J1, Bettor 派工 #dmvn2r; J2 报的根因)。
// scripts/test.mjs:121-124 逐个 `await import()` 每个 *.test.mjs —— 顶层 exit 在【import 阶段】就结束
// 整个 runner 进程 ⇒ walk 顺序排在本文件之后的用例【一个都不会被 import】, 而 runner 以本文件的退出码
// 收场。实测(改前): `--domain=predictions` 零 runner 统计行、exit 0 = 整批看起来"跑完且全过"。
// ⇒ 只在本文件被【直接执行】时才 exit; 被 import 时不碰进程状态(也不设 exitCode —— 本文件无 default
//   export, runner 不计分, 若在这里改 exitCode 会让 runner 的 all-pass 汇总配一个非零退出码, 更难读)。
const _directRun = !!process.argv[1] && _pathToFileURL(process.argv[1]).href === import.meta.url;
if (_directRun) process.exit(failures === 0 ? 0 : 1);
else console.log(`[imported] 本文件是自跑脚本(无 default export), runner 不计分; 自身判定=${failures === 0 ? 'PASS' : 'FAIL'}`);
