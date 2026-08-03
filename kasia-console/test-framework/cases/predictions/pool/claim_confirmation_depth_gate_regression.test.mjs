// Regression guard: #33 claim 确认深度门 (2026-07-05, docs/2026-07-05-claim-confirmation-depth-gate-design.md,
// NWT review GREEN).
//
// verifyClosedLanded/verifyClaimLanded 现在必须调用 ctx.relayPost({type:'check_utxo_landed', minDepth:20}) 拿
// 深度确认结果, 而不是只查"当下有没有这个 UTXO"(浅确认, 2026-06-30 phantom-leaf 事故同源)。
//
// 三个核心属性:
// ① fail-closed: relayPost 返回 landed:false(depth 不足) → 必须继续轮询, 不能提前返回 true。
// ② depth 够了(landed:true)但金额对不上(verifyClosedLanded 专属)→ 仍不能判定 landed(合约不变量 out==pool 双重校验)。
// ③ 正常路径: landed:true + (verifyClosedLanded 金额匹配) → 尽快返回 true, 不多余轮询。

import assert from 'node:assert/strict';
import { pathToFileURL as _pathToFileURL } from 'node:url';
import { verifyClosedLanded, verifyClaimLanded } from '../../../../src/services/bshard-auto-settler.mjs';

function mockCtx({ relayPostSequence, utxoEntries }) {
  let relayCallCount = 0;
  return {
    feeRelay: { id: 'mock-relay' },
    relayPost: async (_relayId, cmd) => {
      assert.equal(cmd.type, 'check_utxo_landed', 'must call check_utxo_landed, not roll its own shallow check');
      assert.equal(cmd.minDepth, 20, 'must request REORG_SAFE_MIN_DEPTH=20, not an ad-hoc value');
      const result = relayPostSequence[Math.min(relayCallCount, relayPostSequence.length - 1)];
      relayCallCount++;
      return result;
    },
    getUtxos: async () => utxoEntries,
    _getRelayCallCount: () => relayCallCount,
  };
}

// patch _sleep to be instant for fast tests — reach into module internals isn't exported, so we accept
// real timers but keep sequences short (≤3 entries) to keep test runtime reasonable.

// ── ① fail-closed: depth not yet reached → keep polling, do not return true prematurely ──
{
  const ctx = mockCtx({
    relayPostSequence: [{ landed: false, depth: 3 }, { landed: false, depth: 12 }, { landed: true, depth: 21 }],
    utxoEntries: [{ outpoint: { transactionId: 'claimtx123' }, amount: '1000' }],
  });
  const result = await verifyClaimLanded(ctx, 'kaspatest:winner', 'claimtx123');
  assert.equal(result, true, 'eventually landed after depth reached');
  assert.equal(ctx._getRelayCallCount(), 3, 'must have polled 3 times (2 shallow + 1 deep), not returned early on shallow depth');
}

// ── ② verifyClosedLanded: depth confirmed landed:true but amount mismatch → must NOT return true ──
{
  const ctx = mockCtx({
    relayPostSequence: [{ landed: true, depth: 25 }],
    utxoEntries: [{ outpoint: { transactionId: 'closetx456' }, amount: '999' }],  // wrong amount vs expected 12345
  });
  // give it only 1 attempt worth of budget conceptually — we can't shrink the internal loop bound (20 attempts)
  // without a timeout risk, so instead assert the FIRST relayPost call's landed:true does not short-circuit
  // to true when amount is wrong: run with a race against a short timeout to confirm it keeps looping (not
  // resolved immediately as true).
  const p = verifyClosedLanded(ctx, 'kaspatest:closeaddr', 'closetx456', '12345');
  const raced = await Promise.race([p.then(() => 'resolved'), new Promise((r) => setTimeout(() => r('still-pending'), 500))]);
  assert.equal(raced, 'still-pending', 'must NOT resolve true immediately when depth is landed but amount mismatches — has to keep retrying (fail-closed on amount)');
}

// ── ③ normal path: landed:true + amount matches → returns true without excess polling ──
{
  const ctx = mockCtx({
    relayPostSequence: [{ landed: true, depth: 30 }],
    utxoEntries: [{ outpoint: { transactionId: 'closetx789' }, amount: '55555' }],
  });
  const result = await verifyClosedLanded(ctx, 'kaspatest:closeaddr2', 'closetx789', '55555');
  assert.equal(result, true, 'landed + matching amount must return true');
  assert.equal(ctx._getRelayCallCount(), 1, 'must not poll again once both depth and amount check out on first attempt');
}

console.log('✅ claim_confirmation_depth_gate_regression: all cases pass — depth fail-closed + amount double-check + fast-path locked');
// 🔴 顶层 process.exit 会杀死 runner(2026-08-04 J1, Bettor 派工 #dmvn2r; J2 报的根因)。
// scripts/test.mjs:121-124 逐个 `await import()` 每个 *.test.mjs —— 顶层 exit 在【import 阶段】就结束
// 整个 runner 进程 ⇒ walk 顺序排在本文件之后的用例【一个都不会被 import】, 而 runner 以本文件的退出码
// 收场。实测(改前): `--domain=predictions` 零 runner 统计行、exit 0 = 整批看起来"跑完且全过"。
// ⇒ 只在本文件被【直接执行】时才 exit; 被 import 时不碰进程状态(也不设 exitCode —— 本文件无 default
//   export, runner 不计分, 若在这里改 exitCode 会让 runner 的 all-pass 汇总配一个非零退出码, 更难读)。
const _directRun = !!process.argv[1] && _pathToFileURL(process.argv[1]).href === import.meta.url;
if (_directRun) process.exit(0);
else console.log(`[imported] 本文件是自跑脚本(无 default export), runner 不计分; 自身判定=${'PASS'}`);
// test ② leaves a dangling 20-attempt retry promise running (by design, to prove fail-closed
                  // behavior without waiting out the full ~60s loop) — force clean exit once assertions pass.
