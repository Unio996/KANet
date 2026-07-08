// rehearsal-pre-broadcast-gate.mjs — 市场5彩排 §4缺件3 门②(J1tn, 2026-07-08)。
//
// 设计稿(docs/2026-07-08-market5-first-bet-rehearsal-design.md)§1.2 反 vacuous 铁律: witness 必须由
// 生产 builder 构造, harness 禁另写一套拼装逻辑。本文件对 zk_close 只做一件事: 把
// rebuildZkCloseGateWitness(zk-close-dispatch.mjs, 已抽出的生产共享函数)吐出的真实 witness 拼成
// cli-debugger 认得的 test-case JSON, 再跑 cli-debugger --run-all, 不广播。
//
// 门②的 beforeState(CloseZkV2 当前 ctor 8 个值)不需要反解 zkCont.redeemHex——同一次彩排 run 里, 门①
// (zk_handoff)已经从 readPayoutShardV2AttestedState 读出这些值来调 compileCloseZkV2Redeem 铸出这份
// redeemHex, 调用方原样往下传即可(单源, 非重新解码——CloseZkV2 目前没有反解 ctor 的函数, 也不需要造)。

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rebuildZkCloseGateWitness } from './zk-close-dispatch.mjs';
import { parseCloseZkV2State, buildClaimWitness, buildClaimCommand } from './closezk-v2-claim-builder.mjs';

const CLI_DEBUGGER = process.env.SILVERSCRIPT_CLI_DEBUGGER_PATH || 'D:/silverscript/target/release/cli-debugger.exe';
const CLOSEZK_V2_SIL = join(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'CloseZkV2.sil');
const SCRATCH_DIR = process.env.REHEARSAL_SCRATCH_DIR || 'scratch/rehearsal-gate';
const ZERO32 = '00'.repeat(32);
const NULLIFIER_WORDS = 17;
const W17_ZERO = () => Array.from({ length: NULLIFIER_WORDS }, () => 0);

/**
 * closeZkV2CtorArray — beforeState/afterState → debugger constructor_args 数组(8 固定字段+17×w0-16),
 *   跟 compileCloseZkV2Redeem(closezk-v2-mint.mjs)的 ctor 组装顺序逐字段对齐(单一顺序来源, 不新开一套)。
 * @param {{gateTmplHash:string, betsRootBaked:string, refundRootBaked:string, attestedAtMs:number,
 *   attestedWinner:number, closed:number, payoutRootHex:string, consolidatedPool:number|string,
 *   wWords?:Array<number|string>}} s  wWords 缺省=17×0(zk_handoff/zk_close 两门用不到非零 word；
 *   门③ claim 用 setNullifierBit() 产出的数组喂进来)
 */
function closeZkV2CtorArray(s) {
  return [
    s.gateTmplHash, s.betsRootBaked, s.refundRootBaked,
    Number(s.attestedAtMs), Number(s.attestedWinner), Number(s.closed),
    s.payoutRootHex, Number(s.consolidatedPool),
    ...(s.wWords ? s.wWords.map(Number) : W17_ZERO()),
  ];
}

/**
 * setNullifierBit — parseCloseZkV2State() 现读的 w0-16(字符串)→claim 后写入 continuation 的 17 元素数值
 *   数组, 目标 merkle_index 对应 bit 置 1。算法跟 closezk-v2-claim-builder.mjs 的 _nullifierBitSet
 *   (word_idx=merkleIndex/63, bit_in=merkleIndex%63)完全一致, 只是这里是"写"不是"读"——单一算法来源,
 *   不新开一套 word/bit 换算公式。
 * @param {object} currentState  parseCloseZkV2State() 产物(w0..w16 是字符串)
 * @param {number} merkleIndex
 * @returns {Array<string>} 17 个元素, 目标 bit 置位后的 w0..w16(字符串, BigInt 安全)
 */
function setNullifierBit(currentState, merkleIndex) {
  const wordIdx = Math.floor(merkleIndex / 63), bitIn = merkleIndex % 63;
  if (wordIdx >= NULLIFIER_WORDS) throw new Error(`setNullifierBit: merkle_index ${merkleIndex} → word_idx ${wordIdx} 越界(cap ${NULLIFIER_WORDS} words)`);
  const out = [];
  for (let i = 0; i < NULLIFIER_WORDS; i++) {
    let w = BigInt(currentState['w' + i] ?? 0);
    if (i === wordIdx) w |= (1n << BigInt(bitIn));
    out.push(w.toString());
  }
  return out;
}

/**
 * buildZkCloseDebuggerCase — 拼 cli-debugger test-case(function: "zk_close"), 结构逐字段照抄
 *   CloseZkV2.test.json 里 "zk_close_regression_vs_repro4_verified_data" 那条真实历史回归用例(2026-07-07
 *   3o6cs dust demo 真实落链数据), 字段映射关系是逐字节比对那条真实数据反推确认过的, 非猜测:
 *   - 顶层 args = [gate_suffix_hex, guest_payout_root_hex, self_out_idx]（跟 dispatchUnlockZkClose
 *     的 cmd.witness 三个值完全同源, 非另算）。
 *   - tx.inputs[1](gate)的 signature_script_hex = sigScript ++ gate_suffix_hex（拼接, 经真实数据验证
 *     166B+800B=966B 吻合）; utxo_script_hex = payToScriptHashScript(完整 redeemScript)。
 * @param {object} o {
 *   beforeState: 同 closeZkV2CtorArray 的 s（closed 必须=1, payoutRootHex 必须=ZERO32——zk_close 花费的
 *     是"已 handoff 未 close"的 genesis 态, 调用方保证, 本函数不校验),
 *   witness: rebuildZkCloseGateWitness() 的返回({sigScript, redeemScript, gateSuffixHex}),
 *   guestPayoutRootHex, selfOutIdx(默认 0),
 *   closeZkUtxoValueSompi, gateUtxoValueSompi, gateScriptHex(payToScriptHashScript 结果 hex),
 * }
 * @returns {object} cli-debugger --test-file 期望的 { tests: [...] } 结构
 */
export function buildZkCloseDebuggerCase(o) {
  const { beforeState, witness, guestPayoutRootHex, selfOutIdx = 0, closeZkUtxoValueSompi, gateUtxoValueSompi, gateScriptHex } = o;
  if (Number(beforeState.closed) !== 1) throw new Error(`buildZkCloseDebuggerCase: beforeState.closed=${beforeState.closed} != 1 — zk_close 只能花费已 handoff(closed==1)的 genesis, 拒绝拼一个假前提的 test-case`);
  const beforeCtor = closeZkV2CtorArray(beforeState);
  const afterCtor = closeZkV2CtorArray({ ...beforeState, closed: 2, payoutRootHex: guestPayoutRootHex });

  return {
    tests: [{
      name: 'rehearsal_zk_close',
      function: 'zk_close',
      constructor_args: beforeCtor,
      args: [witness.gateSuffixHex, guestPayoutRootHex, selfOutIdx],
      expect: 'pass',
      tx: {
        active_input_index: 0,
        inputs: [
          { utxo_value: Number(closeZkUtxoValueSompi), constructor_args: beforeCtor },
          { utxo_value: Number(gateUtxoValueSompi), utxo_script_hex: gateScriptHex, signature_script_hex: witness.sigScript + witness.gateSuffixHex },
        ],
        outputs: [
          { value: Number(closeZkUtxoValueSompi), constructor_args: afterCtor },
        ],
      },
    }],
  };
}

/**
 * runCliDebugger — 写临时 test-file, spawn cli-debugger --run-all(同步, 彩排门是阻塞式确认点非后台
 *   任务), 解析 pass/fail。不广播, 不碰链, 不碰私钥——纯本地二进制模拟器调用。
 * @param {object} testCaseJson  buildZkCloseDebuggerCase() 等函数的返回值
 * @param {string} [silPath]  默认 CloseZkV2.sil(同目录)
 * @returns {{pass:boolean, stdout:string, stderr:string, exitCode:number, testFilePath:string}}
 */
export function runCliDebugger(testCaseJson, silPath = CLOSEZK_V2_SIL) {
  mkdirSync(SCRATCH_DIR, { recursive: true });
  const testFilePath = join(SCRATCH_DIR, `rehearsal-${randomUUID().slice(0, 8)}.test.json`);
  writeFileSync(testFilePath, JSON.stringify(testCaseJson, null, 2));
  const r = spawnSync(CLI_DEBUGGER, [silPath, '--test-file', testFilePath, '--run-all'], { encoding: 'utf8' });
  const stdout = r.stdout || '', stderr = r.stderr || '';
  // cli-debugger 约定(同今晚既有 cli-debugger 8/8 用法): 退出码 0 且 stdout 不含 FAIL/red 标记 = 全绿。
  const pass = r.status === 0 && !/FAIL|❌|red/i.test(stdout);
  return { pass, stdout, stderr, exitCode: r.status, testFilePath };
}

/**
 * gateZkClose — 门②编排入口: 读 zk_continuation+proving+done job, 调生产共享函数重建 witness(§1.2 铁律,
 *   零重写), 拼 debugger test-case, 跑 debugger, 只读不广播。跟 dispatchUnlockZkClose 用同一套
 *   ctx({getMarket, getDoneJob, kaspaZk})签名, 少一个 relayCall(门②不广播)。
 * @param {string} marketId
 * @param {object} ctx { getMarket(marketId), getDoneJob(marketId), kaspaZk() }
 * @param {object} beforeState  门①(zk_handoff)彩排产出的 CloseZkV2 genesis 8 个 ctor 字段(见
 *   closeZkV2CtorArray), 同一次彩排 run 内由调用方从门①结果原样传入, 不重新解码。
 * @param {{closeZkUtxoValueSompi, gateUtxoValueSompi}} amounts
 * @returns {{ok:boolean, gate:'pass'|'fail'|'error', debugger?:object, error?:string}}
 */
export function gateZkClose(marketId, ctx, beforeState, amounts) {
  const market = ctx.getMarket(marketId);
  if (!market) return { ok: false, gate: 'error', error: `market ${marketId} not found` };
  let meta;
  try { meta = JSON.parse(market.metadata || '{}'); } catch (e) { return { ok: false, gate: 'error', error: `metadata parse fail: ${e.message}` }; }
  const zkCont = meta.zk_continuation;
  const proving = zkCont?.proving;
  if (!proving || proving.status !== 'ready') return { ok: false, gate: 'error', error: `proving.status=${proving?.status ?? 'undefined'} != ready` };
  if (!proving.gate || !proving.guestPayoutRootHex || !proving.imageId || !proving.journalHash) {
    return { ok: false, gate: 'error', error: 'proving.status=ready 但 gate/guestPayoutRootHex/imageId/journalHash 任一缺失 — 同 dispatchUnlockZkClose 硬门, 拒绝彩排' };
  }
  const job = ctx.getDoneJob(marketId);
  if (!job?.receipt_hex) return { ok: false, gate: 'error', error: 'zk_prove_jobs.receipt_hex missing for done job' };

  const witness = rebuildZkCloseGateWitness(proving, job.receipt_hex, ctx.kaspaZk);
  if (!witness.ok) return { ok: false, gate: 'error', error: witness.error };

  // 事故修复(2026-07-08, pxvml实战撞出): payToScriptHashScript() 返回 ScriptPublicKey 对象(非原始字节),
  //   不能直接 Buffer.from(该对象)——同 p2sh.mjs 既有惯用法(payToScriptHashScript 结果只喂给
  //   addressFromScriptPublicKey, 从不直接序列化), 这里第一次需要序列化成 hex 喂给 debugger test-case。
  //   .script 取原始脚本字节(跟 CloseZkV2.test.json 既有回归用例的 utxo_script_hex 值格式核对一致:
  //   OP_BLAKE2B(aa) push32(20) <32B hash> OP_EQUAL(87), 无 version 前缀)。
  const kaspa = ctx.kaspaZk();
  const gateSpk = kaspa.payToScriptHashScript(new Uint8Array(Buffer.from(witness.redeemScript, 'hex')));
  const gateScriptHex = Buffer.from(gateSpk.script).toString('hex');

  const testCase = buildZkCloseDebuggerCase({
    beforeState, witness, guestPayoutRootHex: proving.guestPayoutRootHex, selfOutIdx: 0,
    closeZkUtxoValueSompi: zkCont.valueSompi, gateUtxoValueSompi: amounts.gateUtxoValueSompi, gateScriptHex,
  });
  const result = runCliDebugger(testCase);
  return { ok: result.pass, gate: result.pass ? 'pass' : 'fail', debugger: result };
}

/**
 * buildZkClaimDebuggerCase — 拼 cli-debugger test-case(function: "claim")。字段顺序照抄
 * closezk-v2-claim-builder.mjs 的 buildClaimCommand witness 字段序(J2 docstring:
 * selfOutIdx/payoutOutIdx/bettorPk/payout/merkle_index/s0..s9), args = 那五项+10 siblings 原样铺开。
 * ⚠ 诚实边界(跟门②不同): claim 全链从未真实触发过, 没有真实落链数据可比对——本函数结构照抄
 * CloseZkV2.test.json 里 NWT/J2 昨晚编写、已用 cli-debugger --run-all 跑绿的"claim_normal_first_winner"/
 * "claim_dust_boundary_final_winner"两条回归用例(合成哨兵值, 非真实链上数据, 但结构已被 debugger 验证
 * 接受)。selftest 是对这两条已知结构的字段级复现校验, 不是对真实落链数据的 byte-exact 核实(门②那种)。
 * @param {object} o {
 *   beforeState(closed 必须=2), currentState(parseCloseZkV2State 产物, w0-16 是"claim 前"值),
 *   witness(buildClaimWitness 产物: bettorPk/payout(BigInt)/merkle_index/siblings(Buffer[10])),
 *   selfOutIdx(continuation output 下标), payoutOutIdx(payout output 下标),
 *   closeZkUtxoValueSompi(=beforeState.consolidatedPool, 花费的那笔 UTXO 值),
 * }
 */
export function buildZkClaimDebuggerCase(o) {
  const { beforeState, currentState, witness, selfOutIdx, payoutOutIdx, closeZkUtxoValueSompi } = o;
  if (Number(beforeState.closed) !== 2) throw new Error(`buildZkClaimDebuggerCase: beforeState.closed=${beforeState.closed} != 2 — claim 只服务 zk_close 已完成(closed==2)的窗口, 拒绝拼一个假前提的 test-case`);
  const beforeCtor = closeZkV2CtorArray(beforeState);
  const siblingsHex = witness.siblings.map(s => Buffer.isBuffer(s) ? s.toString('hex') : String(s));
  if (siblingsHex.length !== 10) throw new Error(`buildZkClaimDebuggerCase: siblings 长度=${siblingsHex.length} != 10(depth-10 固定, NWT 已核实 merkleProof 恒定 10 个, 不该出现别的长度)`);

  const remaining = BigInt(beforeState.consolidatedPool) - witness.payout;
  if (remaining < 0n) throw new Error(`buildZkClaimDebuggerCase: payout(${witness.payout}) > consolidatedPool(${beforeState.consolidatedPool}) — 不该发生, buildClaimWitness 应已挡下`);
  const isLastClaimant = remaining === 0n;

  const outputs = isLastClaimant
    ? [{ value: Number(witness.payout), p2pk_pubkey: witness.bettorPk }]
    : [
        { value: Number(remaining), constructor_args: closeZkV2CtorArray({ ...beforeState, consolidatedPool: remaining, wWords: setNullifierBit(currentState, witness.merkle_index) }) },
        { value: Number(witness.payout), p2pk_pubkey: witness.bettorPk },
      ];

  return {
    tests: [{
      name: 'rehearsal_claim',
      function: 'claim',
      constructor_args: beforeCtor,
      args: [selfOutIdx, payoutOutIdx, witness.bettorPk, Number(witness.payout), witness.merkle_index, ...siblingsHex],
      expect: 'pass',
      tx: {
        version: 1, lock_time: 0, active_input_index: 0,
        inputs: [{
          prev_txid: 'aa'.repeat(32), prev_index: 0, sequence: 0, sig_op_count: 0,
          utxo_value: Number(closeZkUtxoValueSompi),
        }],
        outputs,
      },
    }],
  };
}

/**
 * gateClaim — 门③编排入口: 用 J2 缺件1 的生产 builder(parseCloseZkV2State 现读+buildClaimWitness 独立
 * 重算+双锁自验)组装 witness, 零自造拼装(§1.2 铁律), 拼 debugger test-case, 只读不广播。
 * @param {object} o {
 *   redeemHex(当前活 CloseZkV2 UTXO 的 redeem_hex, 链上现读非 DB 缓存——parseCloseZkV2State 的输入),
 *   winnerPkHex, merkleIndex, bettors, feeLeaves, poolTotalAtZkCloseSompi(zk_close 落链那一刻的值, 非当前剩余池),
 *   immutableCtor: {gateTmplHash, betsRootBaked, refundRootBaked, attestedAtMs}(门①②同源, 原样传入,
 *     CloseZkV2 状态区之外的四个 genesis-时烤死字段, parseCloseZkV2State 不解这四个),
 *   selfOutIdx(默认 0), payoutOutIdx(默认 1),
 * }
 * @returns {{ok:boolean, gate:'pass'|'fail'|'error', debugger?:object, error?:string}}
 */
export function gateClaim(o) {
  const { redeemHex, winnerPkHex, merkleIndex, bettors, feeLeaves, poolTotalAtZkCloseSompi, immutableCtor, selfOutIdx = 0, payoutOutIdx = 1 } = o;
  let currentState;
  try { currentState = parseCloseZkV2State(redeemHex); } catch (e) { return { ok: false, gate: 'error', error: `parseCloseZkV2State: ${e.message}` }; }

  let witness;
  try { witness = buildClaimWitness(winnerPkHex, merkleIndex, currentState, { bettors, feeLeaves, poolTotalAtZkCloseSompi }); }
  catch (e) { return { ok: false, gate: 'error', error: `buildClaimWitness: ${e.message}` }; }

  const beforeState = {
    ...immutableCtor,
    attestedWinner: currentState.attestedWinner, closed: currentState.closed,
    payoutRootHex: currentState.payoutRootField, consolidatedPool: currentState.consolidated_pool,
    wWords: Array.from({ length: 17 }, (_, i) => currentState['w' + i]),
  };

  const testCase = buildZkClaimDebuggerCase({
    beforeState, currentState, witness, selfOutIdx, payoutOutIdx, closeZkUtxoValueSompi: currentState.consolidated_pool,
  });
  const result = runCliDebugger(testCase);
  return { ok: result.pass, gate: result.pass ? 'pass' : 'fail', debugger: result };
}
