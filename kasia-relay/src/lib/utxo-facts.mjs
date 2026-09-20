// utxo-facts.mjs — relay 侧 `get_address_utxos` 的 facts 形态 + `get_past_median_time`(批9 9-0, R1/R2)。
//
// 设计出处: docs/2026-09-19-j2-proto-v0-batch9-wiring-design-and-checklist-v0.2.md(正文即 v0.3.1)§2 P1;
//   NWT 设计审 82cd2fb9(N1/E1/O1)。本模块是【纯函数 + 依赖注入】:
//   - 不 import p2sh.mjs/connectRpc, 不 import kaspa-wasm 的 RpcClient ——"facts 路径没有 per-call RpcClient"
//     由此在结构上成立(测试对本文件源码做扫描断言, 见 utxo-facts.test.mjs; 不用 spy: connectRpc 是
//     p2sh.mjs 的模块内部绑定, ESM 下测试换不掉它, spy 永远"没被调用"是空判据)。
//   - relay.mjs 只把 `waitForRpc()`(covenant_broadcast 提交用的那个共享 RpcClient)的结果注入进来,
//     所以"读 UTXO / 读 pmt 的节点 == 提交交易的节点"无条件成立。
//
// 🔴 F14(NWT 探针, 本仓已在真实 wasm 条目上复核): covenantId 不在条目顶层(顶层恒 undefined),
//   在 `e.entry.covenantId`(Hash 对象, 原型 getter); 普通 UTXO 该处为 undefined 但 `'covenantId' in e.entry`
//   仍为真。`'covenantId' in e.entry` 为假 ⇒ 该 wasm 构建没有这个字段 ⇒ 整条命令报错, 【不得】回 null
//   (null 的语义是"这个 UTXO 没有 covenant", 混成一个就会让 ticket 行"期望无 covenant"空判通过)。
//   `e.entry` 每次访问返回一个【新的】wasm 克隆 ⇒ 每个条目只读一次。UtxoEntry/UtxoEntryReference/Hash/
//   TransactionOutpoint/ScriptPublicKey 均由 FinalizationRegistry 托管随 GC 释放(与 RpcClient 构造器的永久
//   线性内存泄漏不同), 所以不手动 free()。
//
// 两种形态(facts:true 时, 互斥):
//   O(outpoints) — C1 的全部父 UTXO 检查用它: 服务端在【完整】RPC 结果里按 outpoint 精确过滤, 回
//     found/missing; 不受 FACTS_LIST_MAX 影响、没有 truncated(N1: 地址是公开的确定性 P2SH 地址, 任何人可撒
//     dust, "取列表 + truncated ⇒ fail-closed"会被撒 >N 个 dust 永久卡死一个市场步骤)。
//   L(list)     — 仅 fee 输入选取用: 过滤(min/max) → 面值降序 → (txid 字节序, index)全序 → 截断到
//     FACTS_LIST_MAX(O1: 升序截断保留最小的 N 个 = dust 优先, 恰是攻击者要的方向)。

export const FACTS_VERSION = 1;
export const FACTS_LIST_MAX = 200;      // 具名常量, 不可 env 调(调大要走审)。N1 后只影响 fee 选取的列表形态。
export const FACTS_OUTPOINTS_MAX = 8;   // C1 一步最多 4 个链上固定面值输入; 8 留余量。
// waitForRpc 默认 30s, 而 console 侧 proto 读命令的 IPC 超时是 15s(proto-broadcast-ops.mjs sendCmd(...,15000,...))
// ⇒ 不收紧则 console 先超时、relay 侧还在等。8s < 15s。超时行为: waitForRpc 抛错原样上抛, relay 外层 catch 回
// {error, phase:'execution'}; 不吞、不回落到 per-call 客户端。(J2 提议值, NWT 审 9-0 diff 时定。)
export const FACTS_RPC_WAIT_MS = 8000;
// S-1(NWT 9-0 审 4e34e9c9): 拿到共享客户端之后, RPC 调用本身(getUtxosByAddresses / getBlockDagInfo)也要有截止时间——
// 共享客户端"连着但节点卡死"时, 否则 relay 侧永远不回执、也分不清"relay 卡住"与"relay 慢"。总预算 = 8000 + 5000 = 13000 < console
// 读命令 IPC 超时 15000(9-1 消费方 IPC 超时须 ≥ 15000, 写进 9-1 清单)。超时回执 facts_rpc_timeout(走 relay 外层 catch ⇒
// {error, phase:'execution'}, 注意无 ok 字段——9-1 消费方必须判 ok===true ∧ facts===true ∧ …, 不得用 !result.error, S-2)。
export const FACTS_RPC_CALL_MS = 5000;

const HEX64 = /^[0-9a-f]{64}$/;
const HEX_EVEN = /^(?:[0-9a-f]{2})+$/;
const DEC = /^(?:0|[1-9][0-9]*)$/;
const U32_MAX = 4294967295;
const U64_MAX = (1n << 64n) - 1n;

export class FactsError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'FactsError';
    this.code = code;
  }
}

/**
 * 校验并规整 facts 请求(仅在 cmd.facts === true 时调用)。返回:
 *   { form:'outpoints', outpoints:[{transactionId,index}] } | { form:'list', min:bigint|null, max:bigint|null }
 * 任何不符 ⇒ throw FactsError(整条命令报错, 不部分执行)。
 */
export function parseFactsRequest(cmd) {
  const hasOutpoints = cmd.outpoints !== undefined;
  const hasBound = cmd.minAmount !== undefined || cmd.maxAmount !== undefined;
  if (hasOutpoints && hasBound) throw new FactsError('facts_forms_exclusive', 'outpoints 与 minAmount/maxAmount 互斥');

  if (hasOutpoints) {
    const ops = cmd.outpoints;
    if (!Array.isArray(ops)) throw new FactsError('facts_invalid_outpoints', 'outpoints 必须是数组');
    if (ops.length < 1 || ops.length > FACTS_OUTPOINTS_MAX) {
      throw new FactsError('facts_invalid_outpoints', `outpoints 数量须在 1..${FACTS_OUTPOINTS_MAX}, 实际 ${ops.length}`);
    }
    const seen = new Set();
    const out = [];
    for (const o of ops) {
      if (!o || typeof o !== 'object' || Array.isArray(o)) throw new FactsError('facts_invalid_outpoints', '每项必须是对象');
      const { transactionId, index } = o;
      if (typeof transactionId !== 'string' || !HEX64.test(transactionId)) {
        throw new FactsError('facts_invalid_outpoints', 'transactionId 必须是 64 位小写 hex');
      }
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > U32_MAX) {
        throw new FactsError('facts_invalid_outpoints', 'index 必须是 uint32 整数');
      }
      const k = `${transactionId}:${index}`;
      if (seen.has(k)) throw new FactsError('facts_invalid_outpoints', `重复 outpoint ${k}`);
      seen.add(k);
      out.push({ transactionId, index });
    }
    return { form: 'outpoints', outpoints: out };
  }

  const parseBound = (name, v) => {
    if (v === undefined) return null;
    // 只收十进制字符串(不收 number: Number 在 >2^53 处丢精度, 见 COMMAND_FIELD_TYPES 只登记 'string')。
    if (typeof v !== 'string' || !DEC.test(v)) throw new FactsError('facts_invalid_amount_bound', `${name} 必须是十进制整数字符串`);
    const b = BigInt(v);
    if (b > U64_MAX) throw new FactsError('facts_invalid_amount_bound', `${name} 超出 uint64`);
    return b;
  };
  const min = parseBound('minAmount', cmd.minAmount);
  const max = parseBound('maxAmount', cmd.maxAmount);
  if (min !== null && max !== null && min > max) throw new FactsError('facts_invalid_amount_bound', 'minAmount > maxAmount');
  return { form: 'list', min, max };
}

// 条目顶层读 outpoint/amount(过滤与排序用, 便宜: 不触碰 e.entry 克隆)。任何读不出/形状不对 ⇒ throw(fail-closed)。
function readKey(e) {
  let txid, index, amount;
  try {
    const op = e.outpoint;
    txid = String(op.transactionId);
    index = Number(op.index);
    amount = BigInt(e.amount);
  } catch (err) {
    throw new FactsError('facts_entry_malformed', `outpoint/amount 读取失败: ${err?.message || err}`);
  }
  if (!HEX64.test(txid) || !Number.isInteger(index) || index < 0 || index > U32_MAX || amount < 0n || amount > U64_MAX) {
    throw new FactsError('facts_entry_malformed', 'outpoint/amount 形状不合法');
  }
  return { txid, index, amount };
}

// 只对最终要返回的条目调用(≤ FACTS_LIST_MAX 或 ≤ FACTS_OUTPOINTS_MAX 项)。e.entry 只读一次(F14)。
function toFactsItem(e, key) {
  const inner = e.entry;
  if (!inner || typeof inner !== 'object' || !('covenantId' in inner)) {
    throw new FactsError('covenant_id_field_missing', '条目 entry 上没有 covenantId 字段(该 kaspa-wasm 构建不暴露它, 拒绝把它当成"无 covenant")');
  }
  const cov = inner.covenantId;
  let covenantId = null;
  if (cov !== undefined && cov !== null) {
    covenantId = String(cov);
    if (!HEX64.test(covenantId)) throw new FactsError('covenant_id_malformed', 'covenantId 不是 64 位小写 hex');
  }
  const spk = inner.scriptPublicKey ?? e.scriptPublicKey;
  let version, scriptHex;
  try {
    version = Number(spk.version);
    scriptHex = String(spk.script);
  } catch (err) {
    throw new FactsError('facts_entry_malformed', `scriptPublicKey 读取失败: ${err?.message || err}`);
  }
  if (!Number.isInteger(version) || version < 0 || !HEX_EVEN.test(scriptHex)) {
    throw new FactsError('facts_entry_malformed', 'scriptPublicKey 形状不合法');
  }
  return {
    outpoint: { transactionId: key.txid, index: key.index },
    amount: key.amount.toString(),
    scriptPublicKey: { version, scriptHex },
    covenantId,
  };
}

// 给一次 RPC 调用加截止时间。超时后底层调用无法取消, 我们只是不再等它; Promise.race 已订阅它, 所以它晚到的 reject
// 不会变成 unhandledRejection。fn 同步抛错也走 reject 路径(Promise.resolve().then)。finally 里必清定时器(否则每次调用漏一个)。
function withDeadline(fn, ms, what) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new FactsError('facts_rpc_timeout', `${what} 超过 ${ms}ms 未返回`)), ms);
  });
  return Promise.race([Promise.resolve().then(fn), deadline]).finally(() => clearTimeout(timer));
}

const cmpKey = (a, b) => {
  if (a.amount !== b.amount) return a.amount > b.amount ? -1 : 1;   // 面值降序(O1)
  if (a.txid !== b.txid) return a.txid < b.txid ? -1 : 1;           // 小写 hex 的字典序 == txid 字节序
  return a.index - b.index;                                          // index 升序
};

/**
 * 纯函数: 把 rpc.getUtxosByAddresses 的原始 entries 按 parseFactsRequest 的结果规整成 facts 响应。
 * @param {{form:string}} req parseFactsRequest 的返回
 * @param {Array<object>} entries 原始 wasm 条目(UtxoEntryReference)
 */
export function buildFactsResponse(req, entries) {
  const all = Array.isArray(entries) ? entries : [];
  const base = { ok: true, facts: true, factsVersion: FACTS_VERSION, form: req.form };

  if (req.form === 'outpoints') {
    const wanted = new Map(req.outpoints.map((o) => [`${o.transactionId}:${o.index}`, o]));
    const hit = new Map();
    for (const e of all) {
      const key = readKey(e);
      const k = `${key.txid}:${key.index}`;
      if (wanted.has(k) && !hit.has(k)) hit.set(k, { e, key });
    }
    const found = [];
    const missing = [];
    for (const o of req.outpoints) {                       // 按请求顺序输出(确定性)
      const h = hit.get(`${o.transactionId}:${o.index}`);
      if (h) found.push(toFactsItem(h.e, h.key));
      else missing.push({ transactionId: o.transactionId, index: o.index });
    }
    return { ...base, found, missing };
  }

  // 形态 L: 过滤 → 降序 → 全序 tiebreak → 截断; truncated = 过滤后条数 > FACTS_LIST_MAX
  const keyed = [];
  for (const e of all) {
    const key = readKey(e);
    if (req.min !== null && key.amount < req.min) continue;
    if (req.max !== null && key.amount > req.max) continue;
    keyed.push({ e, key });
  }
  keyed.sort((a, b) => cmpKey(a.key, b.key));
  const truncated = keyed.length > FACTS_LIST_MAX;
  const utxos = keyed.slice(0, FACTS_LIST_MAX).map(({ e, key }) => toFactsItem(e, key));
  return { ...base, utxos, truncated };
}

/**
 * relay.mjs 的 `get_address_utxos` case 委托到这里。
 * @param {object} o
 * @param {object} o.cmd 已过 validateCommandPayload 的命令(facts 已被登记为 'boolean')
 * @param {() => Promise<object>} o.getSharedRpc 注入: relay 传 `() => waitForRpc(FACTS_RPC_WAIT_MS)`(共享 RpcClient)
 * @param {(address:string, networkId:string) => Promise<Array>} o.legacyGetAddressUtxos 注入: p2sh.mjs 的 getAddressUtxos
 * @param {() => string} o.getNetworkId 注入: 仅旧路径需要(facts 路径不依赖钱包)
 */
export async function handleGetAddressUtxos({ cmd, getSharedRpc, legacyGetAddressUtxos, getNetworkId, rpcCallMs = FACTS_RPC_CALL_MS }) {
  // 严格 `=== true`: 真值判断会把 'true'/1 也放进新路径(validator 虽会先拒, 这里不依赖它)。
  if (cmd.facts !== true) {
    // 没有任何既有调用方会带这三个字段; 带了却没带 facts 只能是误用 ⇒ 大声拒绝, 而不是静默走旧路径回一个
    // 没有 spk/covenantId 的正常回复(F18: 旧 relay 就是这么静默忽略的, 不要让新 relay 复刻这个形状)。
    if (cmd.outpoints !== undefined || cmd.minAmount !== undefined || cmd.maxAmount !== undefined) {
      throw new FactsError('facts_params_without_facts', 'outpoints/minAmount/maxAmount 只在 facts:true 时有意义');
    }
    // 旧路径: 与改动前【字节相同】——{ ok:true, utxos } 直接来自旧函数(每次 new RpcClient 的 connectRpc 路径原样保留)。
    return { ok: true, utxos: await legacyGetAddressUtxos(cmd.address, getNetworkId()) };
  }
  const req = parseFactsRequest(cmd);                     // 先校验(便宜、失败不占 RPC)
  const rpc = await getSharedRpc();                       // 超时/未连接 ⇒ 抛错原样上抛(fail-closed)
  const res = await withDeadline(() => rpc.getUtxosByAddresses([cmd.address]), rpcCallMs, 'getUtxosByAddresses');
  return buildFactsResponse(req, res?.entries || []);
}

/**
 * relay.mjs 的 `get_past_median_time` case 委托到这里(R2)。只回四个字段 {ok, pastMedianTimeMs, observedAtMs, isSynced}(isSynced 为批 D 新增的布尔或 null): 不带 RPC URL/节点标识/DAA score/sink。
 * 走与 covenant_broadcast 提交同一个共享 RpcClient ⇒ "读 pmt 的节点 == 提交的节点"无条件成立。
 * @param {{getSharedRpc: () => Promise<object>, nowMs?: () => number}} o
 */
export async function handleGetPastMedianTime({ getSharedRpc, nowMs = () => Date.now(), rpcCallMs = FACTS_RPC_CALL_MS }) {
  const rpc = await getSharedRpc();
  // 批 D(oracle 整合, §5): pmt 有效性要求 isSynced===true。同一个共享 RpcClient 顺带读一次 getServerInfo().isSynced(只读; 读不到 ⇒ null, 消费方按"缺 isSynced"fail-closed, 不影响既有 close_commit 门——它只用 pastMedianTimeMs / observedAtMs)。
  let isSynced = null;
  try { const si = await withDeadline(() => rpc.getServerInfo(), rpcCallMs, 'getServerInfo'); if (typeof si?.isSynced === 'boolean') isSynced = si.isSynced; } catch { isSynced = null; }
  const info = await withDeadline(() => rpc.getBlockDagInfo(), rpcCallMs, 'getBlockDagInfo');
  const observedAtMs = nowMs();                           // 读回之后立刻取墙钟(供 pmtEvidence 新鲜度, §8 S5)
  const pmt = Number(info?.pastMedianTime);
  if (!Number.isSafeInteger(pmt) || pmt <= 0) {
    throw new FactsError('past_median_time_unavailable', `getBlockDagInfo.pastMedianTime 不可用(${info?.pastMedianTime})`);
  }
  return { ok: true, pastMedianTimeMs: pmt, observedAtMs, isSynced };
}
