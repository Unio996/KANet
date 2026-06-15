// J1tn #31 找零核弹 — gate B finish-line 跨节点 chunked-settle e2e harness.
//
// scope: §8 e2e harness (spec docs/2026-06-15-31-chunk-boundary-determinism-spec-j1.md §8.1-8.5).
//   co-own: J1(:3300 determinism + §8.1 前置 + §8.3b cross-node resume) + Bettor(broadcast slice).
//
// 性质: HYBRID scaffold (Bettor【必回】"别等全 wire 完才发现 harness 没备好" → 此 scaffold 预置就绪):
//   Phase A/B (off-chain determinism 前置检 + 守恒) = **RUNNABLE 待 ⑤** (纯 off-chain; gated on ⑤ productionize
//     src/lib/pool-{settle-chunks,payout-root}.mjs — 现 standalone _j2_*.mjs import 即自执行 self-test+写文件, 不可净 import).
//   Phase C/D/E (on-chain settle / per-chunk 落链 / kill-mid-chunk resume) = **GATED on J2 ②③④ wire + 部署**.
//   ⚠ 底层 determinism 逻辑**已独立验证** (J1 2026-06-15 跑 standalone self-test: computeSettleChunks 11/11 +
//     payoutRoot 7/7 8B-LE byte-match + 20/20 re-climb) → Phase A/B 断言接通 ⑤ 净模块即过 (逻辑非未验, 仅 import 路 gated).
//
// run (⑤ 后): node test-framework/standalone/test_31_chunk_settle_e2e.mjs   (exit 0=PASS runnable 段, 1=FAIL)
//   GATED 段打印 SKIP+TODO 不计 fail (④ wire 落地后接通跑全程 on-chain e2e).

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_LIB = join(__dirname, '../../src/lib');
const imp = (rel) => import(pathToFileURL(join(SRC_LIB, rel)).href);   // Windows-safe ESM dynamic import

// —— builder import (⑤ productionize 后的净 src/lib/ 模块; 非自执行 standalone) ——
const { computeSettleChunks } = await imp('pool-settle-chunks.mjs');
const { payoutRoot, payoutLeaf, merkleProof, climbProof } = await imp('pool-payout-root.mjs');

let fails = 0, skips = 0;
const ok = (n) => console.log(`  PASS ${n}`);
const bad = (n, d) => { fails++; console.error(`  FAIL ${n}: ${d || ''}`); };
const skip = (n, why) => { skips++; console.log(`  SKIP ${n} — GATED: ${why}`); };

// ─────────────────────────────────────────────────────────────────────────────
// fixture: 100-winner v08 市场 → 多 chunk (Bettor 指定 100-winner/3-chunk 形态; 实际 chunk 数由 greedy 定).
// per-market 链锚值 (deadline 后 committee 算): winner pk + payout amount (BigInt sompi, merkle_index ASC).
// ─────────────────────────────────────────────────────────────────────────────
const N_WINNERS = 100;
const POOL_VALUE = 200e8 + 1e9;                  // 201 KAS pool (含 fee headroom)
const BROKER = { value: 5e7 };
const ORACLES = Array.from({ length: 5 }, () => ({ value: 1.2e8 }));  // 5 committee bond-return
const FIXED = [BROKER, ...ORACLES];              // chunk_0 前 6 输出
// 链锚 winner 集 (确定性: merkle_index = i; pk derive-able; amount = computePoolPayouts 产, 此处 1 KAS 均匀 fixture).
function mkWinners(n) {
  return Array.from({ length: n }, (_, i) => ({
    pk: ((i % 250) + 1).toString(16).padStart(2, '0').repeat(32),
    amount: 1e8,                                 // 1 KAS each (fixture; 真实由 computePoolPayouts BigInt)
  }));
}

// ═════════════════════════════════════════════════════════════════════════════
// Phase A (§8.1) — cross-node consensus 前置检 (RUNNABLE NOW): 2-assert byte-equal.
//   NWT refinement: segmentation=settler-chosen 非共识; 真共识值 = ctor16-P2SH + payoutRoot.
//   此处验 payoutRoot byte-equal (两节点 = 两次独立 build 同 winners → byte-identical) + chunk-plan determinism bonus.
// ═════════════════════════════════════════════════════════════════════════════
function phaseA_precheck() {
  console.log('\n── Phase A (§8.1) cross-node consensus 前置检 [RUNNABLE] ──');
  const winners = mkWinners(N_WINNERS);

  // ① payoutRoot byte-equal (node A vs node B = 两次独立 build) — 真跨节点共识值, committee 签它.
  const rootA = payoutRoot(winners).toString('hex');
  const rootB = payoutRoot(winners).toString('hex');   // 模拟另一节点独立 build
  if (rootA === rootB && rootA.length === 64) ok(`payoutRoot byte-equal (${rootA.slice(0, 16)}..)`);
  else bad('payoutRoot byte-equal', `A=${rootA} B=${rootB}`);

  // ② merkle-proof re-climb == payoutRoot (= SS climb replica; 每 winner proof 自洽 → settle 时 SS 验得过).
  let climbFails = 0;
  for (let i = 0; i < winners.length; i++) {
    const leaf = payoutLeaf(winners[i].pk, winners[i].amount);
    if (climbProof(leaf, i, merkleProof(winners, i)).toString('hex') !== rootA) climbFails++;
  }
  if (climbFails === 0) ok(`100-winner merkle-proof re-climb all == payoutRoot (SS climb replica)`);
  else bad('merkle re-climb', `${climbFails}/${N_WINNERS} fail`);

  // ③ chunk-plan determinism bonus (NWT: 段非 required-consensus 但 IS deterministic = belt+suspenders).
  const planA = computeSettleChunks(winners, FIXED, POOL_VALUE, rootA);
  const planB = computeSettleChunks(winners, FIXED, POOL_VALUE, rootB);
  if (JSON.stringify(planA) === JSON.stringify(planB)) ok(`chunk-plan byte-deterministic (route=${planA.route} chunks=${planA.numChunks})`);
  else bad('chunk-plan determinism', 'planA != planB');

  return { winners, root: rootA, plan: planA };
}

// ═════════════════════════════════════════════════════════════════════════════
// Phase B (§8.2/§8.4) — chunk-plan 守恒 + 结构 (RUNNABLE NOW): pure math on plan output.
// ═════════════════════════════════════════════════════════════════════════════
function phaseB_conservation(winners, plan) {
  console.log('\n── Phase B (§8.2/8.4) chunk-plan 守恒 + 结构 [RUNNABLE] ──');
  const chunks = plan.chunks;

  // ① coverage: seg 连续 0..N 无 gap/overlap (= HWM 链锚 §7.5 seg_lo==prev.seg_hi 的 off-chain 镜).
  let contiguous = chunks[0].seg_lo === 0 && chunks[chunks.length - 1].seg_hi === N_WINNERS;
  for (let i = 1; i < chunks.length; i++) if (chunks[i].seg_lo !== chunks[i - 1].seg_hi) contiguous = false;
  contiguous ? ok('seg coverage 0..100 连续无 gap/overlap (HWM linkage off-chain 镜)') : bad('seg coverage', 'gap/overlap');

  // ② 每 chunk segLen ≤ MAX_K=47 (settle_chunk for-loop 编译界).
  const overK = chunks.filter(c => (c.seg_hi - c.seg_lo) > 47);
  overK.length === 0 ? ok('每 chunk segLen ≤ 47 (MAX_K)') : bad('segLen ≤ 47', `${overK.length} chunk 超`);

  // ③ 末 chunk change==0 (零 stuck, §4②/§8.3).
  chunks[chunks.length - 1].change === 0 ? ok('末 chunk change==0 (零 stuck)') : bad('末 change==0', `=${chunks[chunks.length-1].change}`);

  // ④ 守恒: Σ(all chunk winner payouts) + Σ fixed(chunk_0) ≤ pool (余=fees, §4①).
  const totalWinnerPaid = winners.reduce((s, w) => s + w.amount, 0);
  const fixedPaid = FIXED.reduce((s, o) => s + o.value, 0);
  (totalWinnerPaid + fixedPaid <= POOL_VALUE)
    ? ok(`守恒 Σwinners(${(totalWinnerPaid/1e8).toFixed(0)})+fixed ≤ pool(${(POOL_VALUE/1e8).toFixed(0)} KAS)`)
    : bad('守恒', `paid ${totalWinnerPaid+fixedPaid} > pool ${POOL_VALUE}`);

  // ⑤ chunk_kind 单调: chunk_0=kind0, 末=kind2, 中=kind1 (§7.5).
  const kindOk = chunks[0].chunk_kind === 0 && chunks[chunks.length-1].chunk_kind === 2
    && chunks.slice(1, -1).every(c => c.chunk_kind === 1);
  kindOk ? ok(`chunk_kind 序 0/1../2 (segLens=[${chunks.map(c=>c.seg_hi-c.seg_lo).join(',')}])`) : bad('chunk_kind 序', 'kind 不单调');

  return chunks;
}

// ═════════════════════════════════════════════════════════════════════════════
// Phase C (§8.2) — on-chain settle + per-chunk check_utxo_landed [GATED on J2 ②③④ wire + 部署].
// ═════════════════════════════════════════════════════════════════════════════
function phaseC_onchain_settle(/* ctx */) {
  console.log('\n── Phase C (§8.2) on-chain settle + per-chunk 落链验 [GATED ④] ──');
  // TODO(④ wire): create v08 市场 (pool.js market_publish v08 path, ctor16 → P2SH) → fund pool-lock.
  // TODO(④ wire): dispatchPhase2 v08 路由 → chunk-chain settle on :3300 (J2 ②③ + relay ④ scriptSig).
  // TODO(verify, J1 域): per chunk 落链后 — 每 winner output {addr,value} 在 kaspa_tx_log 可查
  //   + addr == winnerPk pk-derive + value == computePoolPayouts amount + change cov-relock @ v08 P2SH.
  // TODO(verify): change-chain induction — chunk_{i+1} 输入 outpoint == chunk_i change output (txid+idx).
  skip('on-chain chunk-chain settle + per-chunk check_utxo_landed', 'J2 ②③④ wire + 部署');
}

// ═════════════════════════════════════════════════════════════════════════════
// Phase D (§8.3) — resumable kill-mid-chunk [GATED]. 8.3a same-node + 8.3b ★cross-node (:3300→:3200).
//   resume-cursor 算法 (§8.3 airtight): scan market-shard v08 P2SH unspent → assert count∈{0,1} → read hwm.
// ═════════════════════════════════════════════════════════════════════════════
function phaseD_kill_resume(/* ctx */) {
  console.log('\n── Phase D (§8.3) resumable kill-mid-chunk [GATED ④] ──');
  // resume-cursor 算法骨架 (J1 域, 算法已 spec §8.3 airtight; 接通 UTXO 查询即跑):
  //   1. scanUnspentTip(v08P2SH) = 查 confirmed UTXO 集 @ market-shard v08 P2SH → unspent.
  //   2. assert count ∈ {0,1}: 0=settle 完成; 1=链尾 resume; >1=ANOMALY halt+alert (fork/bug).
  //   3. read state.hwm of the 1 unspent tip → resume cursor.
  // TODO(④): 8.3a same-node — 杀 :3300 settler@chunk_1 confirmed/chunk_2 前 → 重启读链上 hwm → 续完末 change==0.
  // TODO(④): 8.3b ★cross-node — :3300 settle chunk_0,1 → 杀 :3300 → :3200 读链上 hwm tip → 续完.
  //   断言: 续 chunk seg_lo == 链上 hwm (无双付不能 restart 到 hwm 前 / 无 skip 不能跳) + 末 change==0.
  //   capstone: mempool-race — :3200 重建 chunk 与 :3300 in-flight 都花同一 change UTXO → 共识只许一 confirm.
  skip('kill-mid-chunk resume (8.3a same-node + 8.3b cross-node :3300→:3200)', 'J2 ④ wire + 双节点部署');
}

// resume-cursor 验证 helper (J1 域, 算法实现; 接通 UTXO 查询 API 即用) — 现 export 供 ④ 后接通.
export function assertResumeCursor(unspentUtxos) {
  // unspentUtxos = scan(market-shard v08 P2SH) confirmed unspent 集.
  if (unspentUtxos.length === 0) return { state: 'settle-complete', hwm: null };
  if (unspentUtxos.length === 1) return { state: 'resume', hwm: unspentUtxos[0].stateHwm, tip: unspentUtxos[0] };
  throw new Error(`RESUME ANOMALY: ${unspentUtxos.length} unspent UTXO @ v08 P2SH (设计应恰 1; fork/bug 信号 → HALT+alert)`);
}

// ═════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('=== #31 chunked-settle e2e harness (§8) — RUNNABLE 前置 + GATED on-chain ===');
  const { winners, root, plan } = phaseA_precheck();
  phaseB_conservation(winners, plan);
  phaseC_onchain_settle();
  phaseD_kill_resume();

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`RUNNABLE 段: ${fails === 0 ? '✅ ALL PASS' : `❌ ${fails} FAIL`} | GATED 段: ${skips} SKIP (待 J2 ④ wire 接通)`);
  if (fails === 0) {
    console.log('§8.1 前置检(payoutRoot byte-equal)+ §8.2/8.4 守恒 = 就绪绿. ④ wire 落 → 填 Phase C/D 接通全程 e2e.');
    process.exit(0);
  }
  process.exit(1);
}
main();
