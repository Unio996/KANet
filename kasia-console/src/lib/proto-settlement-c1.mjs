// proto-settlement-c1.mjs — 批9 9-1 C 笔: C1 调用点模块(设计 v0.3.4 §19.1 / §19.3 / §18.2)。
//
// 做什么: 结算某一步构造之前, 对该步每个 covenant 输入在链上取【事实】(9-0 的 get_address_utxos facts 形态 O:
//   按 outpoint 精确查, 服务端过滤, 回 found/missing), 用扩展后的 assertSettlementInputValuesOnChain(M6)逐角色断言
//   面值 / spk / outpoint / covenantId 全等, 再产出 chainParents(builder 侧 mass 判定的链上事实来源, §19.4)。
//   另对 fee 输入走一次形态 L(按面值区间列出 relay 地址的候选), 消费方跳过毒化候选与我方在途产出。
//
// 纯模块, 零副作用: 不 import 任何 relay 通道(M0a 门: relay 命令通道由驱动【注入】requestFacts)、不碰 DB、不 import kaspa-wasm
//   (kaspa 也由调用方注入)、不发报警(只【返回】该发什么报警——发不发、发哪张表是驱动层的事, 9-2b)。9-1 仍无任何生产调用方。
// 🔴 NO TX NO STATE: 本模块任何失败 ⇒ 抛错、不返回半成品; 驱动收到抛错必须【不推进意图状态】, 下一 tick 重评估。
// 🔴 只有一处"读得出就信"的地方被有意堵死: 判"成功"只认 ok===true ∧ facts===true ∧ factsVersion===1 ∧ form 相符 ∧ 条目键齐全
//   (§19.1)——relay 的错误回执形状是 {error, phase:'execution'} 且【没有 ok 字段】, 用 !res.error / res.ok !== false 会把
//   旧 relay 的 {ok:true, utxos:[...]}(无 facts 回声)当成功。

import { STEP_INPUT_ROLES, SettlementChainCheckError, assertSettlementInputValuesOnChain } from './proto-settlement-chain-checks.mjs';
import { SIGNED_INPUT_CEILING_SOMPI, filterFeeCandidates } from './proto-tx-assembly.mjs';

// ── 与 9-0 relay 侧(kasia-relay/src/lib/utxo-facts.mjs)对应的常量镜像 ─────────────────────────────────────────────
// console 不 import relay 包(跨进程边界); 镜像值由测试与 relay 源码逐项断言相等(C11 / M 组), 漂移即红。
export const FACTS_VERSION_EXPECTED = 1;
export const FACTS_OUTPOINTS_MAX = 8;
export const FACTS_RPC_WAIT_MS = 8000;
export const FACTS_RPC_CALL_MS = 5000;
/** 每步总预算的下界(§18.2.3 硬约束①): ≥ 8000 + 5000 + 余量。数值本身(取多少)由 9-2b 定, 但必须 ≥ 此值且 < tick 间隔。 */
export const MIN_STEP_BUDGET_MS = 15000;
/** 消费方 requestFacts 的 IPC 超时下界(§18.2.1): 必须 > relay 侧总预算 13000, 否则 console 先超时、relay 侧回执无人接。 */
export const MIN_FACTS_IPC_TIMEOUT_MS = 15000;

const HEX64 = /^[0-9a-f]{64}$/;           // relay 输出恒小写, 大写即异常(§19.1 #7)
const HEX_EVEN = /^(?:[0-9a-f]{2})+$/;
const DEC = /^(?:0|[1-9][0-9]*)$/;
const U32_MAX = 4294967295;
const U16_MAX = 65535;
const U64_MAX = (1n << 64n) - 1n;

const normHex = (h) => String(h ?? '').replace(/^0x/i, '').toLowerCase();
const opKey = (txid, index) => `${txid}:${index}`;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// ══ 错误类型 ═══════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * 消费方对 relay 回执 / 传输层的判定错误。`.code` 取闭集(factsResponseCodes()); `.detail` 是给人看的原因(不改写 relay 的原文)。
 * facts_relay_error 另带 `.relayError` / `.relayPhase`(relay 回执里的原值, 原样保留)。
 */
export class FactsResponseError extends Error {
  constructor(code, detail, extra = {}) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'FactsResponseError';
    this.code = code;
    this.detail = detail;
    Object.assign(this, extra);
  }
}

/** fee 窗口无可用候选。`.code` ∈ {fee_window_saturated, no_suitable_fee_utxo}; 另带 `.events`(该发的事件/报警)与 `.fee`(过滤结果)。 */
export class FeeWindowError extends Error {
  constructor(code, message, { events = [], fee } = {}) {
    super(message);
    this.name = 'FeeWindowError';
    this.code = code;
    this.events = events;
    this.fee = fee;
  }
}

/** FactsResponseError.code 的闭集。前 10 个是设计 §19.1 的; facts_step_budget_exceeded 是【超出设计文字】的第 11 个(C4 要求"超预算 ⇒ 放弃本 tick", 需要一个码)。 */
export function factsResponseCodes() {
  return Object.freeze([
    'facts_shape_invalid', 'facts_relay_error', 'facts_not_ok', 'facts_echo_missing', 'facts_version_mismatch',
    'facts_form_mismatch', 'facts_item_key_missing', 'facts_set_mismatch', 'facts_transport_error', 'facts_requested_invalid',
    'facts_step_budget_exceeded',
  ]);
}

// ══ §19.1 assertFactsResponse ══════════════════════════════════════════════════════════════════════════════════════

const F = (code, detail, extra) => new FactsResponseError(code, detail, extra);

function assertRequested(form, requested) {
  if (form !== 'outpoints' && form !== 'list') throw F('facts_requested_invalid', `form 必须是 'outpoints' 或 'list', 实际 ${String(form)}`);
  if (form === 'list') return null;
  if (!Array.isArray(requested) || requested.length < 1 || requested.length > FACTS_OUTPOINTS_MAX) {
    throw F('facts_requested_invalid', `requested 必须是 1..${FACTS_OUTPOINTS_MAX} 项的数组`);
  }
  const keys = new Set();
  for (const o of requested) {
    if (!isObj(o) || typeof o.transactionId !== 'string' || !HEX64.test(o.transactionId) || !Number.isInteger(o.index) || o.index < 0 || o.index > U32_MAX) {
      throw F('facts_requested_invalid', 'requested 每项须为 {transactionId:64位小写hex, index:uint32}');
    }
    const k = opKey(o.transactionId, o.index);
    if (keys.has(k)) throw F('facts_requested_invalid', `requested 含重复 outpoint ${k}(调用方 bug)`);   // S91-3: 编程错误, 不是"恰好等于"
    keys.add(k);
  }
  return keys;
}

// §19.1 #7: 条目级键与范围。缺键 ⇒ facts_item_key_missing; 格式/范围坏 ⇒ facts_shape_invalid。返回规整后的条目。
function readItem(it, where) {
  if (!isObj(it)) throw F('facts_shape_invalid', `${where}: 条目不是对象`);
  const op = it.outpoint;
  if (!isObj(op)) throw F('facts_item_key_missing', `${where}: 缺 outpoint`);
  if (typeof op.transactionId !== 'string' || !HEX64.test(op.transactionId)) throw F('facts_shape_invalid', `${where}: outpoint.transactionId 不是 64 位小写 hex`);
  if (!Number.isInteger(op.index) || op.index < 0 || op.index > U32_MAX) throw F('facts_shape_invalid', `${where}: outpoint.index 不是 0..${U32_MAX} 的整数`);
  if (!('amount' in it)) throw F('facts_item_key_missing', `${where}: 缺 amount`);
  if (typeof it.amount !== 'string' || !DEC.test(it.amount) || BigInt(it.amount) > U64_MAX) throw F('facts_shape_invalid', `${where}: amount 不是 ≤ 2^64-1 的十进制字符串`);
  const spk = it.scriptPublicKey;
  if (!isObj(spk)) throw F('facts_item_key_missing', `${where}: 缺 scriptPublicKey`);
  if (!('scriptHex' in spk)) throw F('facts_item_key_missing', `${where}: 缺 scriptPublicKey.scriptHex`);
  if (typeof spk.scriptHex !== 'string' || !HEX_EVEN.test(spk.scriptHex)) throw F('facts_shape_invalid', `${where}: scriptHex 不是偶数长度小写 hex 字符串`);
  if (!Number.isInteger(spk.version) || spk.version < 0 || spk.version > U16_MAX) throw F('facts_shape_invalid', `${where}: scriptPublicKey.version 不是 0..${U16_MAX} 的整数`);
  if (!('covenantId' in it)) throw F('facts_item_key_missing', `${where}: 缺 covenantId 键(缺键 ≠ 无 covenant)`);   // 9-0 起就在防的: 手写夹具绿、生产恒 null
  if (it.covenantId !== null && (typeof it.covenantId !== 'string' || !HEX64.test(it.covenantId))) throw F('facts_shape_invalid', `${where}: covenantId 既不是 null 也不是 64 位小写 hex`);
  return {
    outpoint: { transactionId: op.transactionId, index: op.index },
    amount: BigInt(it.amount),
    scriptPublicKey: { version: spk.version, scriptHex: spk.scriptHex },
    covenantId: it.covenantId,
  };
}

/**
 * 消费方对 get_address_utxos{facts:true} 回执的校验(纯函数)。判定顺序固定(前面失败不看后面); 不符一律抛 FactsResponseError。
 * @param {*} res  relay 回执(sendCommandAsync resolve 的 msg.result || {})
 * @param {{form:'outpoints'|'list', requested?:Array<{transactionId:string,index:number}>}} req  我们发出的请求
 * @returns 形态 O: {form, found:[item], missing:[{transactionId,index}]}; 形态 L: {form, utxos:[item], truncated}
 *   item = {outpoint:{transactionId,index}, amount:bigint, scriptPublicKey:{version,scriptHex}, covenantId:string|null}
 */
export function assertFactsResponse(res, { form, requested } = {}) {
  const want = assertRequested(form, requested);                                       // 调用方 bug 先于一切(S91-3)
  if (!isObj(res)) throw F('facts_shape_invalid', `回执不是对象(${res === null ? 'null' : Array.isArray(res) ? 'array' : typeof res})`);   // #1
  if (res.error !== undefined) {                                                        // #2 S-2: 错误回执没有 ok 字段
    const e = res.error;
    throw F('facts_relay_error', `error=${typeof e === 'string' ? e : JSON.stringify(e)} phase=${String(res.phase)}`, { relayError: e, relayPhase: res.phase });
  }
  if (res.ok !== true) throw F('facts_not_ok', `ok=${String(res.ok)}(须严格 === true)`);                                   // #3
  if (res.facts !== true) throw F('facts_echo_missing', `facts=${String(res.facts)}(旧 relay 静默忽略 facts 字段, 只回 {ok:true, utxos:[...]})`);   // #4
  if (res.factsVersion !== FACTS_VERSION_EXPECTED) throw F('facts_version_mismatch', `factsVersion=${String(res.factsVersion)} != ${FACTS_VERSION_EXPECTED}`);
  if (res.form !== form) throw F('facts_form_mismatch', `form=${String(res.form)} != 请求的 ${form}`);                        // #5

  if (form === 'outpoints') {
    if (!Array.isArray(res.found) || !Array.isArray(res.missing)) throw F('facts_shape_invalid', 'found/missing 必须都是数组');   // #6
    if ('truncated' in res) throw F('facts_shape_invalid', '形态 O 回执带了 truncated(对端不是 9-0 语义)');
    const found = res.found.map((it, i) => readItem(it, `found[${i}]`));               // #7
    const missing = res.missing.map((m, i) => {
      if (!isObj(m) || typeof m.transactionId !== 'string' || !HEX64.test(m.transactionId) || !Number.isInteger(m.index) || m.index < 0 || m.index > U32_MAX) {
        throw F('facts_shape_invalid', `missing[${i}] 不是 {transactionId:64位小写hex, index:uint32}`);
      }
      return { transactionId: m.transactionId, index: m.index };
    });
    const seen = new Set();                                                             // #8: 按 txid:index 精确(含 index)相等
    for (const [label, k] of [...found.map((it) => ['found', opKey(it.outpoint.transactionId, it.outpoint.index)]), ...missing.map((m) => ['missing', opKey(m.transactionId, m.index)])]) {
      if (!want.has(k)) throw F('facts_set_mismatch', `${label} 含请求之外的 outpoint ${k}`);
      if (seen.has(k)) throw F('facts_set_mismatch', `${label} 里 outpoint ${k} 重复(或同时出现在 found 与 missing)`);
      seen.add(k);
    }
    if (seen.size !== want.size) throw F('facts_set_mismatch', `found∪missing 缺 ${want.size - seen.size} 项(请求 ${want.size})`);
    return { form, found, missing };
  }

  if (!Array.isArray(res.utxos)) throw F('facts_shape_invalid', 'utxos 必须是数组');   // #6 形态 L
  if (typeof res.truncated !== 'boolean') throw F('facts_shape_invalid', 'truncated 必须是 boolean');
  return { form, utxos: res.utxos.map((it, i) => readItem(it, `utxos[${i}]`)), truncated: res.truncated };
}

// ══ 预算 / 超时的常量断言(§18.2.1、§18.2.3) ══════════════════════════════════════════════════════════════════════

/** 驱动配置期调用: 每步总预算 ≥ MIN_STEP_BUDGET_MS 且 < tick 间隔(不取"tick 的一半"——那会让节点稍慢时该步系统性超预算、活性被自己饿死)。 */
export function assertStepBudget(budgetMs, tickIntervalMs) {
  if (!Number.isFinite(budgetMs) || !Number.isFinite(tickIntervalMs)) throw new TypeError('assertStepBudget: budgetMs / tickIntervalMs 必须是有限数');
  if (budgetMs < MIN_STEP_BUDGET_MS) throw new RangeError(`每步总预算 ${budgetMs}ms < 下界 ${MIN_STEP_BUDGET_MS}ms(= relay 侧 ${FACTS_RPC_WAIT_MS}+${FACTS_RPC_CALL_MS} + 余量)`);
  if (budgetMs >= tickIntervalMs) throw new RangeError(`每步总预算 ${budgetMs}ms 必须 < tick 间隔 ${tickIntervalMs}ms`);
  return true;
}

/** 驱动配置期调用: requestFacts 的 IPC 超时必须 ≥ MIN_FACTS_IPC_TIMEOUT_MS(> relay 侧 13000)。 */
export function assertFactsIpcTimeout(timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < MIN_FACTS_IPC_TIMEOUT_MS || timeoutMs <= FACTS_RPC_WAIT_MS + FACTS_RPC_CALL_MS) {
    throw new RangeError(`facts IPC 超时 ${timeoutMs}ms 必须 ≥ ${MIN_FACTS_IPC_TIMEOUT_MS}ms 且 > ${FACTS_RPC_WAIT_MS}+${FACTS_RPC_CALL_MS}`);
  }
  return true;
}

// ══ §19.3 步骤 6: fee 候选(形态 L) ════════════════════════════════════════════════════════════════════════════════

// 🔴 F3(设计 v0.2.1 §3.1,账本1614/1615/1616,D-031 第一原则——不新造):filterFeeCandidates 挪到
// proto-tx-assembly.mjs(创世/下注/结算三路径共用的同一个纯函数,那边已经是 selectFeeUtxoByConstruction/
// SIGNED_INPUT_CEILING_SOMPI 的定义处,无新依赖边)。这里 re-export(import+export,verifyCore 内部仍要用
// 本地绑定,纯 `export {...} from` 不产生本地绑定),45 项既有测试与既有 import 路径
// (`import { filterFeeCandidates } from './proto-settlement-c1.mjs'`)不必改。
export { filterFeeCandidates };

/**
 * 给 chainParents 补上 fee 角色项——来自【形态 L 条目的事实】(hasCovenant 由条目的 covenantId 得出), 不是常量(§19.4 B1)。
 * (F1, NWT E-1 的 C 侧) 条目带 outpoint {txid, index}: chainParents 是"某个 outpoint 的属性", 脱离 outpoint 就只是三个数——builder 侧(F2)逐项核对它与实际要花的输入。
 */
export function withFeeParent(chainParents, feeCandidate) {
  if (!isObj(chainParents)) throw new TypeError('withFeeParent: chainParents 必填');
  if (!isObj(feeCandidate) || typeof feeCandidate.value !== 'bigint' || !Number.isInteger(feeCandidate.spkLen) || feeCandidate.covenantId === undefined
    || typeof feeCandidate.txid !== 'string' || !HEX64.test(feeCandidate.txid) || !Number.isInteger(feeCandidate.vout) || feeCandidate.vout < 0) {
    throw new TypeError('withFeeParent: feeCandidate 须来自 verifyStepInputsOnChain 的 fee.candidates(带 value/spkLen/covenantId/txid/vout)');
  }
  return { ...chainParents, fee: { value: feeCandidate.value, spkLen: feeCandidate.spkLen, hasCovenant: feeCandidate.covenantId !== null, outpoint: { txid: feeCandidate.txid, index: feeCandidate.vout } } };
}

// ══ §19.3 verifyStepInputsOnChain ══════════════════════════════════════════════════════════════════════════════════

const paramsMissing = (step, role, msg) => new SettlementChainCheckError('chain_check_params_missing', `verifyStepInputsOnChain(${step}): ${msg}`, { step, role });

/**
 * 结算某一步构造前的 C1 取证与断言。
 * @param {object} o
 * @param {string} o.step  STEP_INPUT_ROLES 的键
 * @param {{roles: Record<string,{outpoint:{transactionId:string,index:number}, expectedCovenantId:string|null}>}} o.pointers  proto-settlement-pointers 的产出(§19.2)
 * @param {Record<string,string>} o.expectedSpks  各角色 builder 假设的 spk(调用方按当前状态现算)
 * @param {string} o.network  addressFromScriptPublicKey 的网络前缀
 * @param {(address:string, payload:object, opts:{timeoutMs:number}) => Promise<object>} o.requestFacts  驱动注入(生产 = protoSendCmd 发 get_address_utxos)。
 *   🔴 (F4, NWT F1-1) 第三参 `{timeoutMs: ipcTimeoutMs}` 把【校验过的 IPC 超时】交给被调方: 真实 wrapper 必须用它作为 IPC 命令的超时(9-2b 验收: wrapper 发出的超时 == 收到的 timeoutMs)——
 *   否则驱动可以声明 15000、注入一个实际只等 5000 ms 的 requestFacts 而入口断言照样过(声明 ≠ 实际)。
 * @param {{ScriptPublicKey:Function, addressFromScriptPublicKey:Function}} o.kaspa  kaspa-wasm(注入)
 * @param {string} o.relaySpkHex  relay 自己的 P2PK spk(fee 输入所在地址)
 * @param {bigint} o.feeMinAmount  该步最低可行 fee 输入面值(避免窗口被"小到不够用"的 UTXO 占位)
 * @param {Array<{transactionId:string,index:number}>} [o.inflightOutpoints]  我方在途(未 landed)意图产出的输出
 * @param {number} o.budgetMs  本步总预算; 超出 ⇒ facts_step_budget_exceeded, 本 tick 放弃
 * @param {number} o.tickIntervalMs  驱动的 tick 间隔——【必填】, 入口调 assertStepBudget(budgetMs, tickIntervalMs): 预算 ≥ 15 s 且 < tick 间隔(F1, NWT C-3: 漏传即拒, 不可能忘调)
 * @param {number} o.ipcTimeoutMs  requestFacts 背后 IPC 命令的超时——【必填】, 入口调 assertFactsIpcTimeout(≥ 15000 且 > relay 侧 13000), 并原样作为 requestFacts 的第三参 timeoutMs 交出
 * 🔴 (F4, NWT F1-2) 生产入口【不接受 timers】(传了就 TypeError)——一个永不触发的 setTimeout 就能让"每步总预算"失效; 定时器注入只存在于仅测试用的 verifyStepInputsOnChainWithTimers, 并有源码扫描守着它不被生产代码引用。
 * @returns {Promise<{chainUtxos, chainParents, fee, events, evidence}>}  任何失败都抛错(FactsResponseError / SettlementChainCheckError / FeeWindowError)
 */
export async function verifyStepInputsOnChain(opts) {
  if (opts && typeof opts === 'object' && Object.prototype.hasOwnProperty.call(opts, 'timers')) {
    throw new TypeError('verifyStepInputsOnChain: 生产入口不接受 timers(否则一个永不触发的 setTimeout 就让每步总预算失效); 测试用 verifyStepInputsOnChainWithTimers');
  }
  return verifyCore(opts, { setTimeout, clearTimeout });
}

/**
 * 【仅测试用】同 verifyStepInputsOnChain, 但注入定时器(缩放 / 记录版, 让"超预算"用例不必真等 20 秒、并能断言定时器被清)。
 * 生产代码不得引用它——测试里的源码扫描(非测试源码出现该标识符即违规)守着。timers 缺 setTimeout / clearTimeout ⇒ TypeError。
 */
export async function verifyStepInputsOnChainWithTimers(opts, timers) {
  if (!timers || typeof timers.setTimeout !== 'function' || typeof timers.clearTimeout !== 'function') throw new TypeError('verifyStepInputsOnChainWithTimers: timers 须带 setTimeout / clearTimeout');
  return verifyCore(opts, timers);
}

async function verifyCore({ step, pointers, expectedSpks, network, requestFacts, kaspa, relaySpkHex, feeMinAmount, inflightOutpoints = [], budgetMs, tickIntervalMs, ipcTimeoutMs } = {}, timers) {
  const roles = STEP_INPUT_ROLES[step];
  if (!roles) throw new SettlementChainCheckError('chain_check_unknown_step', `verifyStepInputsOnChain: 未知步骤 ${step}`, { step });
  if (typeof requestFacts !== 'function') throw new TypeError('verifyStepInputsOnChain: requestFacts 必填(驱动注入)');
  if (!kaspa || typeof kaspa.addressFromScriptPublicKey !== 'function' || typeof kaspa.ScriptPublicKey !== 'function') throw new TypeError('verifyStepInputsOnChain: kaspa 必填(注入 kaspa-wasm)');
  if (typeof network !== 'string' || !network) throw new TypeError('verifyStepInputsOnChain: network 必填');
  if (typeof feeMinAmount !== 'bigint' || feeMinAmount < 0n) throw new TypeError('verifyStepInputsOnChain: feeMinAmount 必须是非负 bigint(没有默认值)');
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new TypeError('verifyStepInputsOnChain: budgetMs 必填(没有默认值: 漏传 = 无界等待)');
  if (!Number.isFinite(ipcTimeoutMs)) throw new TypeError('verifyStepInputsOnChain: ipcTimeoutMs 必填(requestFacts 的 IPC 超时必须 > relay 侧总预算)');
  assertStepBudget(budgetMs, tickIntervalMs);            // 每次调用都核: 预算 ≥ 15 s 且 < tick 间隔; tickIntervalMs 缺失/非有限数在这里抛 TypeError(必填)
  assertFactsIpcTimeout(ipcTimeoutMs);                   // 每次调用都核: IPC 超时 ≥ 15000
  if (!isObj(pointers) || !isObj(pointers.roles)) throw paramsMissing(step, undefined, 'pointers.roles 缺失');
  const addressOf = (spkHex) => {
    const a = kaspa.addressFromScriptPublicKey(new kaspa.ScriptPublicKey(0, spkHex), network);
    return a ? a.toString() : null;
  };

  // 1) 按地址分组: 每个地址一次形态 O(一步最多 3 次), 与 fee 的 1 次形态 L 并发发出(§18.2.3)
  const groups = new Map();
  const expectedOutpoints = {};
  const expectedCovenantIds = {};
  const seenOutpoints = new Map();
  for (const role of roles) {
    const p = pointers.roles[role];
    if (!isObj(p) || !isObj(p.outpoint)) throw paramsMissing(step, role, `${role} 的指针缺失`);
    const spkHex = normHex(expectedSpks?.[role]);
    if (!HEX_EVEN.test(spkHex)) throw paramsMissing(step, role, `${role} 的预期 spk 缺失或不是 hex`);
    const addr = addressOf(spkHex);
    if (!addr) throw paramsMissing(step, role, `${role}: 无法由预期 spk 得出地址`);
    const k = opKey(String(p.outpoint.transactionId).toLowerCase(), p.outpoint.index);
    if (seenOutpoints.has(k)) throw F('facts_requested_invalid', `${role} 与 ${seenOutpoints.get(k)} 的预期 outpoint 相同(${k}): 一笔交易不能两次花同一个输入(调用方 bug)`);
    seenOutpoints.set(k, role);
    expectedOutpoints[role] = { transactionId: String(p.outpoint.transactionId).toLowerCase(), index: p.outpoint.index };
    expectedCovenantIds[role] = p.expectedCovenantId;
    if (!groups.has(addr)) groups.set(addr, []);
    groups.get(addr).push({ transactionId: expectedOutpoints[role].transactionId, index: expectedOutpoints[role].index });
  }
  const relayAddress = addressOf(normHex(relaySpkHex));
  if (!relayAddress) throw paramsMissing(step, undefined, '无法由 relaySpkHex 得出 relay 地址');

  // 2) 每次 requestFacts 包 try/catch(N91-1: sendCommandAsync 的超时/无 relay 是 promise reject, assertFactsResponse 根本看不到)
  const ask = (address, payload, req) => Promise.resolve()
    .then(() => requestFacts(address, payload, { timeoutMs: ipcTimeoutMs }))     // F4(NWT F1-1): 把校验过的 IPC 超时交给被调方
    .catch((e) => { throw F('facts_transport_error', e?.message ?? String(e), { cause: e }); })
    .then((res) => assertFactsResponse(res, req));
  const tasks = [];
  for (const [address, requested] of groups) {
    tasks.push({ kind: 'O', address, requested, p: ask(address, { facts: true, outpoints: requested }, { form: 'outpoints', requested }) });
  }
  const feePayload = { facts: true, minAmount: feeMinAmount.toString(), maxAmount: SIGNED_INPUT_CEILING_SOMPI.toString() };
  tasks.push({ kind: 'L', address: relayAddress, p: ask(relayAddress, feePayload, { form: 'list' }) });

  // 并发 + 每步总预算: 任一失败 ⇒ 整步 fail-closed(Promise.all 快速失败; 其余 promise 已被它订阅, 不会 unhandledRejection);
  // 超预算 ⇒ 放弃本 tick、不推进状态、下一 tick 重评估——不得因等得久而跳过任何一项检查。
  let timer;
  const deadline = new Promise((_, reject) => { timer = timers.setTimeout(() => reject(F('facts_step_budget_exceeded', `本步总预算 ${budgetMs}ms 用尽`)), budgetMs); });
  let results;
  try { results = await Promise.race([Promise.all(tasks.map((t) => t.p)), deadline]); } finally { timers.clearTimeout(timer); }

  // 3) 组装 chainUtxos[role]: found ⇒ {value, spent:false, scriptPublicKeyHex, covenantId, outpoint}; missing ⇒ null(已花/未落链/被 reorg 一律中止)。
  //    🟡 spent:false 只表示"在虚拟 UTXO 集里", mempool 里的花费不反映——同一 outpoint 已被在途交易花费时我们构造的新交易会被节点拒(双花), 方向安全但【不是这个断言保证的】。
  const foundByKey = new Map();
  let feeRes = null;
  tasks.forEach((t, i) => {
    if (t.kind === 'L') { feeRes = results[i]; return; }
    for (const it of results[i].found) foundByKey.set(opKey(it.outpoint.transactionId, it.outpoint.index), it);
  });
  const chainUtxos = {};
  for (const role of roles) {
    const it = foundByKey.get(opKey(expectedOutpoints[role].transactionId, expectedOutpoints[role].index));
    chainUtxos[role] = it
      ? { value: it.amount, spent: false, scriptPublicKeyHex: it.scriptPublicKey.scriptHex, covenantId: it.covenantId, outpoint: it.outpoint }
      : null;
    // (F1, NWT C-1) spk 的身份是 (version, script), builder 只造 version 0: 同脚本 version≠0 的条目不是我们要花的那个 UTXO ⇒ <role>_spk_drift(M6 只比 script hex, 所以在这里先拒)
    if (it && it.scriptPublicKey.version !== 0) {
      throw new SettlementChainCheckError(`${role}_spk_drift`, `${role}_spk_drift — fail-closed: verifyStepInputsOnChain(${step}): ${role} 的链上 spk version=${it.scriptPublicKey.version} != 0(builder 只造 version 0 的 spk; spk 身份是 (version, script), 同脚本不同 version 不是同一个 UTXO 类)`, { step, role });
    }
  }

  // 4) M6 断言(值 / spk / outpoint / covenantId 全等)——过了才有 chainParents
  assertSettlementInputValuesOnChain({ step, chainUtxos, expectedSpks, expectedOutpoints, expectedCovenantIds });

  // 5) chainParents: 全部来自上一步【经断言的链上事实】
  const chainParents = {};
  for (const role of roles) {
    const u = chainUtxos[role];
    // (F1, NWT E-1 的 C 侧) 带 outpoint {txid, index}(取自经 M6 断言的 u): chainParents 是某个 outpoint 的属性, builder 侧(F2)核对它与实际要花的输入是同一个
    chainParents[role] = { value: u.value, spkLen: u.scriptPublicKeyHex.length / 2, hasCovenant: u.covenantId !== null, outpoint: { txid: u.outpoint.transactionId, index: u.outpoint.index } };
  }

  // 6) fee 候选(形态 L): 只做跳过/排除, 不判定任何 covenant/ticket 输入的存在性(N1: 形态 L 有 200 条窗口, 撒 dust 可挤掉目标)
  const fee = filterFeeCandidates({ utxos: feeRes.utxos, truncated: feeRes.truncated, relaySpkHex, feeMinAmount, inflightOutpoints });
  if (fee.status === 'saturated') throw new FeeWindowError('fee_window_saturated', `fee 窗口无干净候选(跳过毒化 ${fee.skippedPoisoned}, 越界 ${fee.skippedOutOfRange}, 在途 ${fee.skippedInflight}, truncated=${fee.truncated})`, { events: fee.events, fee });
  if (fee.status === 'none') throw new FeeWindowError('no_suitable_fee_utxo', `relay 地址上没有落在 [${feeMinAmount}, ${SIGNED_INPUT_CEILING_SOMPI}] 的 fee 候选(在途已排除 ${fee.skippedInflight})`, { events: fee.events, fee });

  const evidence = tasks.map((t, i) => (t.kind === 'O'
    ? { form: 'outpoints', address: t.address, requested: t.requested.length, found: results[i].found.length, missing: results[i].missing.length }
    : { form: 'list', address: t.address, listed: results[i].utxos.length, truncated: results[i].truncated }));
  return { chainUtxos, chainParents, fee, events: fee.events, evidence };
}

// ══ §19.3 步骤 7: 报警映射与分级 ═══════════════════════════════════════════════════════════════════════════════════

/** 瞬时类(设计: 超时 / relay 忙 ⇒ facts_transport_error、facts_relay_error; 预算超时同类)。 */
const TRANSIENT_CODES = new Set(['facts_transport_error', 'facts_relay_error', 'facts_step_budget_exceeded']);
const PROGRAMMING_CODES = new Set(['chain_check_params_missing', 'chain_check_unknown_step', 'facts_requested_invalid']);

/**
 * 步骤失败 ⇒ 该发什么报警(纯函数; 发不发、写哪张表是驱动层的事)。【永不返回 null】(F1, NWT E-2): 无法识别的错误——TypeError / RangeError / wasm 异常 / builder 侧的
 * chain_parents_mismatch 等——一律归 settlement_c1_programming_error(error 级、非瞬时)。返回 null 会让驱动把"接线 bug"当成"不是 C1 错误、照常重试"。
 *  - *_value_drift / *_spk_drift / *_outpoint_drift / *_covenant_class_mismatch ⇒ settlement_chain_fact_drift(error);
 *  - 传输类 ⇒ settlement_facts_transport_error, 【不得混报成链上事实漂移】; transient=true 的走分级, 其余(版本错位 facts_echo_missing / facts_version_mismatch 与其它协议违例)首次即 error;
 *  - fee 窗口 ⇒ settlement_fee_window_saturated(error) / no_suitable_fee_utxo(不发报警, 走既有路径);
 *  - 编程错误(缺参 / 未知步骤 / requested 非法 / builder 的 chain_parents_mismatch / 其它无法识别的错误)⇒ settlement_c1_programming_error(error)。【超出设计文字】: 设计只定义了前三类。
 *    chain_parents_mismatch 按 err.code 识别, 不 import builder 模块(C 不该依赖 kaspa 产物构造链)。
 */
export function classifyC1Error(err) {
  const code = err && err.code;
  if (err instanceof SettlementChainCheckError) {
    if (PROGRAMMING_CODES.has(code)) return { eventType: 'settlement_c1_programming_error', transient: false, code };
    return { eventType: 'settlement_chain_fact_drift', transient: false, code };
  }
  if (err instanceof FactsResponseError) {
    if (PROGRAMMING_CODES.has(code)) return { eventType: 'settlement_c1_programming_error', transient: false, code };
    return { eventType: 'settlement_facts_transport_error', transient: TRANSIENT_CODES.has(code), code };
  }
  if (err instanceof FeeWindowError) {
    if (code === 'fee_window_saturated') return { eventType: 'settlement_fee_window_saturated', transient: false, code };
    return { eventType: 'settlement_no_suitable_fee_utxo', transient: false, code };
  }
  return { eventType: 'settlement_c1_programming_error', transient: false, code: code ?? 'unrecognized_error' };   // 含 chain_parents_mismatch(E-2)与一切无法识别的错误
}

/**
 * 传输错误分级(S91-5): 瞬时类首次 warn, 连续 N(=3) 个【不同 tick】升 error(同一 tick 内的重试不算), 成功一次清零;
 * 版本错位类与其它非瞬时类首次即 error, 不进计数。有状态, 但不碰任何外部存储。
 * 🔴 (F1, NWT C-2) 计数【按 key 分开】(key = 意图 key, 如 settle:market:<id>:seal): 全局单计数会被同一 tick 里别的步骤的成功清零——
 *   NWT 实测步骤 A 每 tick 失败、步骤 B 每 tick 成功, 6 个 tick 全程 warn、永不升 error。key 必填。
 */
export function createTransportAlertGrader({ ticksToError = 3 } = {}) {
  if (!Number.isInteger(ticksToError) || ticksToError < 1) throw new RangeError('ticksToError 必须是正整数');
  const states = new Map();                                    // key → {count, lastTick}
  const needKey = (key, who) => { if (typeof key !== 'string' || !key) throw new TypeError(`${who}: key 必填(意图 key; 计数按 key 分开, 全局单计数会被别的步骤的成功掩盖)`); };
  return {
    /** @returns {{eventType, level, transient, code, consecutiveTicks?}} */
    onFailure(err, tickId, key) {
      if (tickId === undefined || tickId === null) throw new TypeError('onFailure: tickId 必填(分级按"不同 tick"计数)');
      needKey(key, 'onFailure');
      const c = classifyC1Error(err);
      if (c.eventType !== 'settlement_facts_transport_error') return { ...c, level: 'error' };
      if (!c.transient) return { ...c, level: 'error' };
      const st = states.get(key) || { count: 0, lastTick: undefined };
      if (tickId !== st.lastTick) { st.count += 1; st.lastTick = tickId; }
      states.set(key, st);
      return { ...c, level: st.count >= ticksToError ? 'error' : 'warn', consecutiveTicks: st.count };
    },
    /** 该 key 的步骤成功验证一次 ⇒ 只清该 key 的计数。 */
    onSuccess(key) { needKey(key, 'onSuccess'); states.delete(key); },
    consecutiveTicks(key) { return (states.get(key) || { count: 0 }).count; },
  };
}
