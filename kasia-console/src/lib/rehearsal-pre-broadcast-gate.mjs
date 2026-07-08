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

const CLI_DEBUGGER = process.env.SILVERSCRIPT_CLI_DEBUGGER_PATH || 'D:/silverscript/target/release/cli-debugger.exe';
const CLOSEZK_V2_SIL = join(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'CloseZkV2.sil');
const SCRATCH_DIR = process.env.REHEARSAL_SCRATCH_DIR || 'scratch/rehearsal-gate';
const ZERO32 = '00'.repeat(32);
const W17_ZERO = () => Array.from({ length: 17 }, () => 0);

/**
 * closeZkV2CtorArray — beforeState/afterState → debugger constructor_args 数组(8 固定字段+17×w0-16),
 *   跟 compileCloseZkV2Redeem(closezk-v2-mint.mjs)的 ctor 组装顺序逐字段对齐(单一顺序来源, 不新开一套)。
 * @param {{gateTmplHash:string, betsRootBaked:string, refundRootBaked:string, attestedAtMs:number,
 *   attestedWinner:number, closed:number, payoutRootHex:string, consolidatedPool:number|string}} s
 */
function closeZkV2CtorArray(s) {
  return [
    s.gateTmplHash, s.betsRootBaked, s.refundRootBaked,
    Number(s.attestedAtMs), Number(s.attestedWinner), Number(s.closed),
    s.payoutRootHex, Number(s.consolidatedPool),
    ...W17_ZERO(),
  ];
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

  const kaspa = ctx.kaspaZk();
  const gateScriptHex = Buffer.from(kaspa.payToScriptHashScript(new Uint8Array(Buffer.from(witness.redeemScript, 'hex')))).toString('hex');

  const testCase = buildZkCloseDebuggerCase({
    beforeState, witness, guestPayoutRootHex: proving.guestPayoutRootHex, selfOutIdx: 0,
    closeZkUtxoValueSompi: zkCont.valueSompi, gateUtxoValueSompi: amounts.gateUtxoValueSompi, gateScriptHex,
  });
  const result = runCliDebugger(testCase);
  return { ok: result.pass, gate: result.pass ? 'pass' : 'fail', debugger: result };
}
