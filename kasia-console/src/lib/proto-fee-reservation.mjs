// proto-fee-reservation.mjs — F4(设计 v0.2.1 §3.2, 账本1614/1615/1616, Codex df07b0ec): fee 输入预留。
//
// 治的窗口(A 臂 genesis_ambiguous 死锁的真根因, 见设计 §1.1 结论2 / §2 F4 表): 一个 fee UTXO 被在途交易花掉后,
// 在它落链前仍会出现在下一次 get_address_utxos 取数里(虚拟 UTXO 集不含 mempool 花费)——两个并发的构造(D 与 A
// 同 tick 顺序创世, 不是并发, 但 A 取数时 D 的 prepared 交易还没落链)会选中同一个 UTXO, 后到者的已备交易永不能
// 落(inputs_spent)⇒ genesis_ambiguous HOLD。
//
// 两层, 各治一个窗口(设计 §3.2 B):
//   1. DB 派生层(reservedFeeOutpoints, 重启安全, 跨 driver/HTTP): 三张"存 prepared 字节"的表里非终态行的输入
//      outpoint 并集——E6(既有事实, proto_settlement_intents/proto_bet_intents/proto_markets 早已把"哪些输入
//      被在途交易占了"存进 prepared_tx_json 里, 不需要新状态)。
//   2. 进程内"已选未落库"层(reserve/release, 治 DB 层之外、prepared 落库之前的窄窗): selectAndReserveFeeUtxo
//      内部维护, 模块级 Map。
//
// 🔴 M0a: 本文件碰 DB(better-sqlite3 db 由调用方注入, 不 import ../db/client.js 单例——纯函数式注入, 与
//   proto-settlement-store.mjs 的既有风格一致, 但那边是"结算专用", 这里要被创世/下注/结算三路径共用)。
// 🔴 D-031(不新造): filterFeeCandidates(F3)、selectFeeUtxoByConstruction(既有)都不动, 本文件只加一层
//   "选择前检查预留集 ∧ 选中后记入预留集"的原子包装, 复用两者, 不重新实现候选过滤或真实构造尝试。

const opKey = (txid, index) => `${String(txid).toLowerCase()}:${Number(index)}`;

/** prepared_tx_json 的【真实存储格式】(2026-09-22 实测更正, 写这批测试时用真实 record*Phase 函数走一遍才
 *  发现——真实 relay(covenant-broadcast-relay.mjs:189)与 F1b(recordSettlementIntentPhase)传的 txJson 参数
 *  是 `JSON.stringify([txJsonString])`: 顶层是一个【只含一个元素的数组】, 元素本身【又是一层 JSON 字符串】
 *  (buildXxxTxJson 产出的原始 txJson), 不是 tx 对象直接顶层就有 inputs 字段。JSON.parse(stored) 先得到
 *  `[innerJsonString]`, 要再 JSON.parse 一次内层元素才拿到真正的 { inputs:[...], outputs:[...] }。
 *  兼容双层写入方: 若顶层已经是"数组包一层字符串"这个真实形状, 拆开再解析一次; 若某个未来写入方改成直接存
 *  顶层 tx 对象(不包数组), 也认——【不接受】顶层是数组但形状不对(长度≠1 或元素不是字符串), 一律 fail-closed,
 *  不猜。全部输入 outpoint 都取(不止 fee 那一个)——被在途交易占用的角色输入(RootClose/leaf/held 等)同样
 *  不该被别的交易当 fee 候选选中, 更保守也更简单: 不需要知道"第几个输入是 fee"这个布局细节。
 */
function extractInputOutpoints(txJsonStr) {
  let parsed;
  try { parsed = JSON.parse(txJsonStr); } catch (e) { throw new Error(`extractInputOutpoints: 顶层 JSON 解析失败(${e.message})`); }
  if (Array.isArray(parsed)) {
    if (parsed.length !== 1 || typeof parsed[0] !== 'string') throw new Error(`extractInputOutpoints: 顶层数组形状不对(应为长度 1、元素是 tx_json 字符串, 实际长度=${parsed.length})`);
    try { parsed = JSON.parse(parsed[0]); } catch (e) { throw new Error(`extractInputOutpoints: 内层 tx_json 解析失败(${e.message})`); }
  }
  if (!parsed || !Array.isArray(parsed.inputs)) throw new Error('extractInputOutpoints: tx_json 顶层缺 inputs 数组');
  return parsed.inputs.map((inp, i) => {
    if (!inp || typeof inp.transactionId !== 'string' || !/^[0-9a-f]{64}$/i.test(inp.transactionId) || !Number.isInteger(inp.index)) {
      throw new Error(`extractInputOutpoints: inputs[${i}] 缺合法 transactionId/index`);
    }
    return { transactionId: inp.transactionId, index: inp.index };
  });
}

// 三张来源表各自的"非终态"定义(M1 前态谓词精神, 与既有代码的状态机词汇对齐, 见 proto-settlement-intent.mjs /
// proto-bet-intent.mjs / proto-market-intent.mjs 的 STATUS 常量)。ambiguous 在这里【统一按非终态处理】——
// 即便某些状态机(bet-intent 的 ambiguous)把它当"驱动不再自动重试的终态", 那只影响【驱动怎么调度】, 不影响
// 【这笔 outpoint 是否可能仍是一枚活的可花 UTXO】——ambiguous 恰恰就是"不确定是否已落链", 保守起见继续占位。
// 🔴🔴 撤回更正(NWT 用真实探针复核, 账本1623/1624, 原判定错误——如实记录, 不是悄悄改回去):
// 本文件曾判定 proto_markets.genesis_prepared_tx_json / proto_bet_intents.prepared_tx_json 在生产路径下
// 从未写入, 依据是 grep kasia-console/src 找不到 recordMarketIntentPhase/recordBetIntentPhase 的生产调用
// 点——【这个 grep 范围本身就错了】: 真正的调用方在 kasia-relay 包(另一个代码库子目录), 不在
// kasia-console/src。已直接读源码验证: kasia-relay/src/lib/covenant-broadcast-relay.mjs:189
// `await ingestPhase({ intentKey: key, phase: 'prepared', txid, txJson: JSON.stringify([txJson]) })`——
// 对【全部三种】intent_key 前缀(genesis:/proto-bet:/settle:)在真实广播【之前】无条件调用同一段代码(:58
// `ingestPhase = ingestProtoBetIntentPhase` 默认值, 经 console 侧 HTTP 回调落库), console 侧
// `src/api/ingest.js` 按前缀分派到 recordMarketIntentPhase(genesis:)/recordSettlementIntentPhase(settle:)/
// recordBetIntentPhase(其余, 含 proto-bet:)——三条路径结构相同, 都会真实写入。此前
// proto-broadcast-ops.test.mjs/proto-driver.test.mjs 撞到的 fail-closed HOLD, 根因是那些测试的假
// sendCmd(手写 stub 直接 return {ok:true,...})【没有模拟这个 ingestPhase 回调】, 不是生产代码本身有缺口——
// 测试少做了一步, 不是生产少做了一步(对应的测试 mock 已在同一批里补上这一步)。
const SOURCES = Object.freeze([
  { table: 'proto_settlement_intents', statusCol: 'status', txCol: 'prepared_tx_json', nonTerminal: ['prepared', 'submitted', 'ambiguous'] },
  { table: 'proto_markets', statusCol: 'status', txCol: 'genesis_prepared_tx_json', nonTerminal: ['genesis_prepared', 'genesis_submitted', 'genesis_ambiguous'] },
  { table: 'proto_bet_intents', statusCol: 'status', txCol: 'prepared_tx_json', nonTerminal: ['prepared', 'submitted', 'ambiguous'] },
]);

/**
 * DB 派生层(M1/M3): 扫上面三张表里非终态行, 解出全部输入 outpoint 的并集。
 * 🔴 M3 fail-closed(设计 §3.2 B.1): 任一非终态行的 tx_json 缺失(prepared_without_bytes)/ JSON 损坏 /
 *   反序列化抛错 ⇒ 整体抛(HOLD)——不是跳过该行。跳过 = 该行占用的 UTXO 不受保护 = 安全层静默失效, 比"这次
 *   tick 先不选"更糟。调用方(selectAndReserveFeeUtxo)据此把整次选择判 HOLD, 报警。
 * @param {object} o
 * @param {{prepare:Function}} o.db  better-sqlite3 database(注入)
 * @returns {Set<string>}  opKey(txid, index) 集合
 */
export function reservedFeeOutpoints({ db }) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('reservedFeeOutpoints: db 必填');
  const out = new Set();
  for (const src of SOURCES) {
    const placeholders = src.nonTerminal.map(() => '?').join(',');
    const rows = db.prepare(`SELECT ${src.txCol} AS txJson FROM ${src.table} WHERE ${src.statusCol} IN (${placeholders})`).all(...src.nonTerminal);
    for (const row of rows) {
      if (row.txJson === null || row.txJson === undefined) {
        throw new Error(`reservedFeeOutpoints: fail-closed — ${src.table} 有非终态行(status IN ${JSON.stringify(src.nonTerminal)})但 ${src.txCol} 为空(prepared_without_bytes); 不得跳过该行, 整次选择 HOLD`);
      }
      let outpoints;
      try { outpoints = extractInputOutpoints(row.txJson); }
      catch (e) { throw new Error(`reservedFeeOutpoints: fail-closed — ${src.table}.${src.txCol} 无法解析(${e.message}); 整次选择 HOLD`); }
      for (const op of outpoints) out.add(opKey(op.transactionId, op.index));
    }
  }
  return out;
}

// ── 进程内"已选未落库"层 ─────────────────────────────────────────────────────────────────────────────────
// 模块级(进程级, driver/HTTP 共用, 同一个 Node 进程内所有调用方共享这一份状态——console 只有一个进程持有 relay
// 的 fee UTXO 池, 这与"进程内"的粒度恰好匹配)。key = opKey(txid,index), value = {intentKey, reservedAtMs}。
const _inMemoryReserved = new Map();

/** 有界期限: IPC 超时(结算路径 15000ms 下界, 创世/下注同量级)的至少 2 倍, 常量具名不可 env 调
 *  (设计 §3.2 B.2 "结果不确定"分支: 到期先对账——查 DB 是否已有 prepared 字节——再释放)。 */
export const RESERVATION_UNCERTAIN_TIMEOUT_MS = 30_000;

/** 测试/诊断用: 读一份当前进程内预留层的快照(不可变副本), 不导出可变引用。 */
export function _snapshotInMemoryReserved() {
  return new Map(_inMemoryReserved);
}
/** 测试用: 清空进程内预留层(每个测试文件独立进程, 生产不需要调用——进程重启天然清零)。 */
export function _resetInMemoryReserved() { _inMemoryReserved.clear(); }

/**
 * F4 核心: 包住 selectFeeUtxoByConstruction 的"选择并预留"原子操作(设计 §3.2 A)。
 * 🔴 原子性: candidates 已经是【外部 await 之后】才有的东西(取数是 IPC), 调用方把 candidates 交进来的这一刻
 *   开始, 到 selectFeeUtxoByConstruction 选中 + 记入两层预留集为止, 全程【同步】(JS 单线程, 同步段内无交错)。
 *   readReserved 在这个同步段的【最前面】现读 DB 派生集(不接受调用方预先算好的快照——见设计 §3.2 A "DB 派生集
 *   在同步段内现读", v0.2.1 NWT round2 M1 补丁: 若沿用早前算好的快照, 会在"取数 await 期间对手完成 prepared
 *   落库并释放内存层"这类交错下漏保护, 复现 A 臂 inputs_spent)。
 * @param {object} o
 * @param {Array<{txid,vout,value:bigint,scriptPublicKeyHex:string}>} o.candidates  已过 filterFeeCandidates 的候选(F3)
 * @param {(feeUtxo:object) => object} o.tryBuild  真实构造函数(原样转交 selectFeeUtxoByConstruction)
 * @param {() => Set<string>} o.readReserved  DB 派生集的【现读】句柄(同步, 典型 = () => reservedFeeOutpoints({db}));
 *   fail-closed: 若这个调用抛错(M3), selectAndReserveFeeUtxo 原样向上抛(HOLD, 不吞)
 * @param {string} o.intentKey  本次选择所属的意图键(记录用, 便于诊断"谁占着这个 UTXO")
 * @param {(u:{txid,vout}) => boolean} [o.isReservedElsewhereCheck]  仅测试用扩展点, 生产不传
 * @returns {{feeUtxo:object, built:object}}
 */
export function selectAndReserveFeeUtxo({ candidates, tryBuild, readReserved, intentKey, selectFeeUtxoByConstruction }) {
  if (typeof selectFeeUtxoByConstruction !== 'function') throw new TypeError('selectAndReserveFeeUtxo: selectFeeUtxoByConstruction 必填(注入, 不在本文件重新实现选择算法——D-031)');
  if (typeof readReserved !== 'function') throw new TypeError('selectAndReserveFeeUtxo: readReserved 必填(DB 派生集的现读句柄)');
  if (typeof intentKey !== 'string' || !intentKey) throw new TypeError('selectAndReserveFeeUtxo: intentKey 必填(记录用, 诊断"谁占着这个 UTXO")');

  // ── 同步段开始: 现读两层预留集, 过滤候选, 选中, 立即记入内存层 ──
  const dbReserved = readReserved();          // M3 fail-closed: 这一步若抛, 直接向上抛, 不吞不跳过
  const eligible = (candidates || []).filter((c) => {
    const k = opKey(c.txid, c.vout);
    return !dbReserved.has(k) && !_inMemoryReserved.has(k);
  });
  const result = selectFeeUtxoByConstruction(eligible, tryBuild);   // 抛错(no_suitable_fee_utxo)原样向上抛, 未记入任何预留(无副作用)
  const chosenKey = opKey(result.feeUtxo.txid, result.feeUtxo.vout);
  _inMemoryReserved.set(chosenKey, { intentKey, reservedAtMs: Date.now() });
  // ── 同步段结束 ──
  return result;
}

/** 确定性成功: prepared 回执已落库(DB 层接管)⇒ 从内存层移除。调用方在 prepared 写库成功后调用。 */
export function releaseReservationOnPrepared({ txid, vout }) { _inMemoryReserved.delete(opKey(txid, vout)); }

/** 确定性失败: 构造抛错、或 relay 在 prepared 之前明确拒绝(F1b 409 等)⇒ 立即移除, 不占位等到超时。 */
export function releaseReservationOnFailure({ txid, vout }) { _inMemoryReserved.delete(opKey(txid, vout)); }

/**
 * 结果不确定(IPC 超时)的对账释放(设计 §3.2 B.2): 到期先问 DB 是否已经有 prepared 字节——
 *   有 ⇒ 转由 DB 层持有, 从内存层移除(不是"续期", 是"移交");
 *   无 ⇒ 释放(relay 确实没收到 / 没处理, 后来者可以再选这个 UTXO)。
 * 调用时机: 由调用方在 IPC 超时之后、经过 RESERVATION_UNCERTAIN_TIMEOUT_MS 再核对(调用方负责计时, 本函数只做
 *   "现在核对一次"这一步的纯逻辑, 不自带定时器——避免本模块状态里再长出一份重复的计时器管理; 生产接线走下面的
 *   deferReservationReconciliation, 它才是真正持有定时器的那一方)。
 * @param {{txid:string, vout:number}} outpoint
 * @param {() => boolean} checkPreparedInDb  同步 or 已 resolve 的判定: 该 outpoint 对应的 intent 是否已在 DB 里有 prepared 字节
 */
export function reconcileUncertainReservation({ txid, vout }, checkPreparedInDb) {
  const key = opKey(txid, vout);
  if (!_inMemoryReserved.has(key)) return { action: 'noop', reason: 'not_reserved' };
  const hasPreparedInDb = checkPreparedInDb();
  _inMemoryReserved.delete(key);   // 两种结局都从内存层移除: 有 ⇒ 移交 DB 层; 无 ⇒ 释放
  return { action: hasPreparedInDb ? 'handed_to_db_layer' : 'released', reason: hasPreparedInDb ? 'prepared_found_in_db' : 'no_trace_in_db' };
}

/**
 * MUST-2(NWT 实现审, 账本1623/1624): 生产接线在"结果不确定"这一支要用的调度器——reconcileUncertainReservation
 * 本身不带定时器(上面注释已说明), 调用方(driver-core.mjs / proto-broadcast-ops.mjs 的三个真实调用点)在
 * sendCmd 这一层【本身抛错】(IPC 超时 / 连接失败 / 无响应——不是 relay 回了一个 {ok:false} 的明确拒绝, 那种
 * 情况走 releaseReservationOnFailure 立即释放)时调用这个函数, 而不是无条件在 finally 里立即释放——因为
 * relay 侧真实广播代码(covenant-broadcast-relay.mjs:189)在 IPC 应答之前就已经把 prepared 字节 ingestPhase
 * 回 console 了, "console 这次 sendCmd 没等到回执"不等于"relay 什么也没做": 若真提前释放, 后来者会在
 * relay 那笔仍可能落链的窗口里选中同一个 outpoint, 复现 A 臂的 inputs_spent 竞态, 只是把窗口从"选择前"
 * 挪到了"IPC 不确定期间", 没有真的解决。
 * @param {{txid:string, vout:number}} outpoint
 * @param {() => boolean} checkPreparedInDb  与 reconcileUncertainReservation 同一个判定, 原样转交
 * @param {number} [timeoutMs]  默认 RESERVATION_UNCERTAIN_TIMEOUT_MS, 测试可传更短的值
 * @param {(fn:Function, ms:number) => *} [scheduler]  可注入(测试用假计时器/立即执行), 生产默认 setTimeout
 */
export function deferReservationReconciliation({ txid, vout }, checkPreparedInDb, timeoutMs = RESERVATION_UNCERTAIN_TIMEOUT_MS, scheduler = setTimeout) {
  if (typeof checkPreparedInDb !== 'function') throw new TypeError('deferReservationReconciliation: checkPreparedInDb 必填(到期对账用)');
  return scheduler(() => {
    try { reconcileUncertainReservation({ txid, vout }, checkPreparedInDb); }
    catch { /* 对账本身的判定函数不该抛, 但防御性地不让一次坏的对账把进程炸掉——预留最坏情况下留到下次人工/下次同 outpoint 的选择尝试时被 DB 层自然接管或超期遥测发现 */ }
  }, timeoutMs);
}

/** 泄漏遥测(设计 §3.2 B.2 "泄漏遥测"): 预留数 / 最老预留年龄。诊断/报警用, 纯读。 */
export function reservationLeakTelemetry({ nowMs = Date.now() } = {}) {
  let oldestAgeMs = 0;
  for (const { reservedAtMs } of _inMemoryReserved.values()) {
    const age = nowMs - reservedAtMs;
    if (age > oldestAgeMs) oldestAgeMs = age;
  }
  return { count: _inMemoryReserved.size, oldestAgeMs };
}
