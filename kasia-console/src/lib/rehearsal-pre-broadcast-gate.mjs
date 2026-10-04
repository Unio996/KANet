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
import { computeKttTokenArtifact } from './pool-bshard-artifacts.mjs';
import { readZkTemplateHashes, convergeCloseZkV2OwnRedeemLen } from './pool-shard-register.mjs';
import { procStep } from './diag-step.mjs';   // M10 v2 observe-only (2026-09-05): 同步子进程站计时, 纯透传

// 🔴 账本1832 段4: 默认改指 D-019 pin 的 cli-debugger(原默认 target/release 是未 pin 的开发构建, 与 v1.0.0 pin 编译器可能不同源)。
const CLI_DEBUGGER = process.env.SILVERSCRIPT_CLI_DEBUGGER_PATH || 'D:/silverscript/versioned-builds/cli-debugger-v100-3ed9733.exe';
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
    // 账本1832: 当前 CloseZkV2 ctor 共 28 参(T3 代币化 + own_redeem_len 尾字段); 此前只拼 25 个(T3 之前的形状)
    s.tokenTmplHash, s.claimTmplHash, Number(s.ownRedeemLen),
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
  if (!o.tokPrefixHex || !o.tokSuffixHex) throw new Error('buildZkCloseDebuggerCase: tokPrefixHex/tokSuffixHex 必需(v1.0.0 zk_close 的 noTokenInput 见证)');
  for (const k of ['tokenTmplHash', 'claimTmplHash', 'ownRedeemLen']) if (beforeState[k] == null) throw new Error(`buildZkCloseDebuggerCase: beforeState.${k} 必需(CloseZkV2 当前 28 参 ctor)`);
  if (Number(beforeState.closed) !== 1) throw new Error(`buildZkCloseDebuggerCase: beforeState.closed=${beforeState.closed} != 1 — zk_close 只能花费已 handoff(closed==1)的 genesis, 拒绝拼一个假前提的 test-case`);
  const beforeCtor = closeZkV2CtorArray(beforeState);
  const afterCtor = closeZkV2CtorArray({ ...beforeState, closed: 2, payoutRootHex: guestPayoutRootHex });

  return {
    tests: [{
      name: 'rehearsal_zk_close',
      function: 'zk_close',
      constructor_args: beforeCtor,
      args: [witness.gateSuffixHex, guestPayoutRootHex, selfOutIdx, o.tokPrefixHex, o.tokSuffixHex],   // 账本1832: noTokenInput 需要 tok_prefix/tok_suffix
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
  // M10 v2 observe-only: 计时打一行 [diag:step] proc.cli-debugger.rehearsal(spawnSync 不抛, r 原样返回; 注: 此调用无 timeout, 只记录不改)
  const r = procStep('proc.cli-debugger.rehearsal', 'cli-debugger', () => spawnSync(CLI_DEBUGGER, [silPath, '--test-file', testFilePath, '--run-all'], { encoding: 'utf8' }));
  const stdout = r.stdout || '', stderr = r.stderr || '';
  // 🔴 修复(2026-07-09, J2, 正式场市场5实撞两次): 原判定 `!/FAIL|❌|red/i.test(stdout)` 是大小写不敏感
  // 子串匹配——cli-debugger 汇总行"N tests: N passed, 0 failed"里的"failed"照样命中 /FAIL/i(fail 是 failed
  // 的子串), 把 0 个失败的全绿结果误判成 fail。这是"从没被真验证过的检查逻辑分支"(成功路径从未被实跑到
  // 过, 直到今天正式场撞了两次)——改成结构化解析汇总行, 只认"X tests: Y passed, Z failed"里 Z==0, 不再用
  // 宽松子串匹配。找不到汇总行(cli-debugger 输出格式变化/异常退出)= fail-closed 不猜通过。
  const summaryMatch = stdout.match(/(\d+)\s+tests:\s*(\d+)\s+passed,\s*(\d+)\s+failed/);
  const pass = r.status === 0 && !!summaryMatch && Number(summaryMatch[3]) === 0;
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

  // 事故修复(2026-07-08, pxvml实战撞出+KANet-UI live验证): payToScriptHashScript() 返回 ScriptPublicKey
  //   对象, 不能直接 Buffer.from(该对象)——同 p2sh.mjs 既有惯用法(payToScriptHashScript 结果只喂给
  //   addressFromScriptPublicKey, 从不直接序列化), 这里第一次需要序列化成 hex 喂给 debugger test-case。
  //   .script getter 直接返回最终 hex 字符串(非 raw bytes, 不需要再包 Buffer.from()——live 实测过:
  //   "aa20<32B hash>87" 格式, 跟 CloseZkV2.test.json 既有回归用例的 utxo_script_hex 值格式核对一致)。
  const kaspa = ctx.kaspaZk();
  const gateScriptHex = kaspa.payToScriptHashScript(new Uint8Array(Buffer.from(witness.redeemScript, 'hex'))).script;

  // 账本1832: 补齐 28 参 ctor 的尾部三项(env 模板 hash + 部署常量 own_redeem_len) + zk_close 的 KTT 模板见证
  const _t = readZkTemplateHashes();
  if (!_t.ok) return { ok: false, gate: 'error', error: `ZK 模板 env 缺失/非法: ${[..._t.missing, ..._t.malformed].join('/')}` };
  const _ktt = computeKttTokenArtifact({ amount: 1, ownerCovIdHex: '00'.repeat(31) + '01' });
  beforeState = { ...beforeState, tokenTmplHash: _t.tokenTmplHash, claimTmplHash: _t.claimTmplHash, ownRedeemLen: convergeCloseZkV2OwnRedeemLen(CLOSEZK_V2_SIL, beforeState.gateTmplHash, _t.tokenTmplHash, _t.claimTmplHash) };
  const testCase = buildZkCloseDebuggerCase({
    tokPrefixHex: _ktt.templatePrefix.toString('hex'), tokSuffixHex: _ktt.templateSuffix.toString('hex'),
    beforeState, witness, guestPayoutRootHex: proving.guestPayoutRootHex, selfOutIdx: 0,
    closeZkUtxoValueSompi: zkCont.utxoValueSompi ?? zkCont.valueSompi,   // 账本1832 段3: 优先 KAS 面值(dust); 旧行回落
    gateUtxoValueSompi: amounts.gateUtxoValueSompi, gateScriptHex,
  });
  const result = runCliDebugger(testCase);
  return { ok: result.pass, gate: result.pass ? 'pass' : 'fail', debugger: result };
}

/**
 * 🔴 账本1832 段4: claim 门(③)按【当前合约/当前 ctor】重写——旧 buildZkClaimDebuggerCase/gateClaim 拼的是 T3 之前的 25 参 ctor + 裸 P2PK 派彩 tx,
 *   对当前 CloseZkV2.claim(代币化: 新建 KanetTokenClaim + KTT 转移 + own_redeem_len 自续约)根本不是同一个合约形状。
 *   新做法(反 vacuous): 不手搓 tx——走【生产三阶段编排 runTokenClaim 的 dry_run】拿 relay 构造器吐出的逐输入/输出真实字节(含 sigScript/covenant 绑定),
 *   原样喂 cli-debugger。kind: 'claim'(closed==2) | 'escape_claim'(closed==3)(CloseZkV2 两个入口; PayoutShardV2.refund_claim 同构, 见 seg4 provenance 的驱动)。
 * @param {object} o { kind, beforeState(28 参 ctor 所需: gateTmplHash/betsRootBaked/refundRootBaked/attestedAtMs/attestedWinner/closed/payoutRootHex/consolidatedPool/wWords/tokenTmplHash/claimTmplHash/ownRedeemLen),
 *   dump(runTokenClaim dryRun 返回), witness(dryRun 返回的 witnessUsed) }
 */
export function buildTokenClaimDebuggerCase(o) {
  const { kind, beforeState, dump, witness } = o;
  if (!['claim', 'escape_claim'].includes(kind)) throw new Error(`buildTokenClaimDebuggerCase: kind=${kind} 不支持(仅 CloseZkV2 的 claim/escape_claim)`);
  const want = kind === 'claim' ? 2 : 3;
  if (Number(beforeState.closed) !== want) throw new Error(`buildTokenClaimDebuggerCase: beforeState.closed=${beforeState.closed} != ${want}`);
  const H = (x) => '0x' + String(x).replace(/^0x/, '');
  const tx = { active_input_index: 0,
    inputs: dump.inputs.map((i) => ({ prev_txid: i.prev_txid, prev_index: i.prev_index, sequence: 0, sig_op_count: 0, utxo_value: Number(i.utxo_value), ...(i.covenant_id ? { covenant_id: H(i.covenant_id) } : {}), ...(i.utxo_script_hex ? { utxo_script_hex: H(i.utxo_script_hex) } : {}), signature_script_hex: H(i.signature_script_hex) })),
    outputs: dump.outputs.map((x) => ({ value: Number(x.value), script_hex: H(x.script_hex), ...(x.covenant_id ? { covenant_id: H(x.covenant_id), authorizing_input: x.authorizing_input ?? 0 } : {}) })) };
  const args = [dump.selfOutIdx ?? 0, dump.claimOutIdx, 1, dump.tokOutIdx, dump.remainOutIdx ?? 0, H(witness.bettor_pk), Number(witness.amount), witness.merkle_index, ...witness.siblings_hex.map(H),
    H(witness.tok_prefix_hex), H(witness.tok_suffix_hex), H(witness.claim_prefix_hex), H(witness.claim_suffix_hex)];
  return { tests: [{ name: `rehearsal_${kind}`, function: kind, constructor_args: closeZkV2CtorArray(beforeState), args, expect: 'pass', tx }] };
}

/**
 * gateTokenClaim — 门③编排入口(现行): runTokenClaim(dryRun) → buildTokenClaimDebuggerCase → cli-debugger。只读不广播(dry_run 不提交)。
 * @param {object} o { kind, closeZk:{redeemHex,txid,index}, pool, bettorPk, amount, merkleIndex, siblingsHex, fee:{address,txid,index}, relayCall, p2sh, beforeState, tokenTmplHash, claimTmplHash }
 */
export async function gateTokenClaim(o) {
  const { runTokenClaim } = await import('./zk-token-claim-orchestrator.mjs');
  let dump;
  try {
    dump = await runTokenClaim({ kind: o.kind, self: o.closeZk, pool: o.pool, bettorPk: o.bettorPk, amount: o.amount, merkleIndex: o.merkleIndex, siblingsHex: o.siblingsHex, fee: o.fee, relayCall: o.relayCall, p2sh: o.p2sh, tokenTmplHash: o.tokenTmplHash, claimTmplHash: o.claimTmplHash, dryRun: true });
  } catch (e) { return { ok: false, gate: 'error', error: `runTokenClaim(dry_run): ${e.message}` }; }
  if (!dump?.inputs || !dump?.witnessUsed) return { ok: false, gate: 'error', error: 'dry_run 响应缺 inputs/witnessUsed' };
  let testCase;
  try { testCase = buildTokenClaimDebuggerCase({ kind: o.kind, beforeState: o.beforeState, dump, witness: dump.witnessUsed }); } catch (e) { return { ok: false, gate: 'error', error: e.message }; }
  const result = runCliDebugger(testCase);
  return { ok: result.pass, gate: result.pass ? 'pass' : 'fail', debugger: result };
}
