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

/** prepared_tx_json 是 buildXxxTxJson 系列函数产出的 txJson 字符串(kaspa-wasm safe JSON, 见
 *  proto-tx-assembly(-settlement).mjs), 顶层 { inputs: [{ transactionId, index, ... }], outputs: [...] }
 *  (真实探得的序列化形状, 见 docs/provenance/2026-09-22-j2-f3-f4-.../probe.txt)。全部输入 outpoint 都取
 *  (不止 fee 那一个)——被在途交易占用的角色输入(RootClose/leaf/held 等)同样不该被别的交易当 fee 候选选中,
 *  更保守也更简单: 不需要知道"第几个输入是 fee"这个布局细节。
 */
function extractInputOutpoints(txJsonStr) {
  const parsed = JSON.parse(txJsonStr);
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
// 🔴 实测更正(写这个模块时发现, 不是设计文档的假设——如实记录): 设计 v0.2.1 §1 表 E6 说
// "proto_markets.genesis_prepared_tx_json(v207)"已经把创世的在途字节存进去了, 这是照该列【存在】
// 推断的, 实测这一列在当前生产代码里【从未被写入过】——recordMarketIntentPhase(proto-market-intent.mjs)
// 是唯一会写它的函数, 而全仓零生产调用点(只有一句"buildAndBroadcast 内部应当在广播前调"的注释, 从未
// 真正接线; recordBetIntentPhase 有真实调用点 src/api/ingest.js:99, 是不同情况)。genesis 的状态机现状是
// genesis_pending → (buildMarketGenesisAndBroadcast 内部构造+广播一步做完)→ genesis_submitted, 中途没有
// 单独落一次"prepared 字节"的检查点。
// 🔴 若把 proto_markets 加进 SOURCES 且 nonTerminal 含 genesis_submitted/genesis_ambiguous, 会导致【每一个
// 广播成功过的市场】永远触发下面的 fail-closed(txCol 为 null)——这不是"防止安全层失效", 是把 DB 派生层
// 对全部三路径的读取【全部拖死】(reservedFeeOutpoints 一处抛错, 创世/下注/结算的选择全部 HOLD)。已在本批
// 离线测试里真实撞到(proto-broadcast-ops.test.mjs F3b-4、proto-driver.test.mjs ⑦), 不是猜测。
// 🔴 同一个实测更正也适用于 proto_bet_intents(离线测试跑出来的真实结果, 不是从 markets 的情况类推猜的):
// register_append 的真实生产路径(driveBetIntent → 本文件外的 buildRegisterAppendAndBroadcast)status 从
// 'pending' 直接被 driveBetIntent 自己的 markBetIntent 调用推到 'submitted'(带 submitted_txid), 全程不经过
// recordBetIntentPhase(该函数只在一个独立的 ingest.js:99 回调路径里被调, 与 driveBetIntent 是两条不同的
// 写入路径, register_append 目前只走后者)——同样从不写 prepared_tx_json。proto-broadcast-ops.test.mjs
// F3b-1/F3b-4、⑫号既有测试真实撞到 fail-closed HOLD(见 2026-09-22 provenance), 不是猜测。
// ⇒ 本批 DB 派生层只接 proto_settlement_intents(结算, F1 设计本来就要求 prepared 字节先于广播落库, 31 项
// driver-core 测试 + 6 项 settlement-ops 测试实测确认可靠)。创世 / 下注的并发保护在本批【只靠进程内
// "已选未落库"层】(buildMarketGenesisAndBroadcast / buildRegisterAppendAndBroadcast 各自的
// selectAndReserveFeeUtxo + finally 释放, 覆盖从选中到这次广播尝试结束的整个窗口——这正是 A 臂真实撞到的
// 那种"同 tick 顺序两笔创世竞争同一 UTXO"的窗口, 已经覆盖; DB 层缺的是"跨重启"这一段, 留作后续补建
// prepared 字节写入路径之后的工作)。
// 若日后有人把 recordMarketIntentPhase/recordBetIntentPhase 接上各自的真实生产调用点(driveMarketGenesis/
// driveBetIntent 在广播前调用, 而不是只有 ingest.js 的独立回调), 把对应条目加回这个数组即可, 不需要改
// 其它任何代码——SOURCES 是本文件唯一需要改的地方。
const SOURCES = Object.freeze([
  { table: 'proto_settlement_intents', statusCol: 'status', txCol: 'prepared_tx_json', nonTerminal: ['prepared', 'submitted', 'ambiguous'] },
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
 *   "现在核对一次"这一步的纯逻辑, 不自带定时器——避免本模块状态里再长出一份重复的计时器管理)。
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

/** 泄漏遥测(设计 §3.2 B.2 "泄漏遥测"): 预留数 / 最老预留年龄。诊断/报警用, 纯读。 */
export function reservationLeakTelemetry({ nowMs = Date.now() } = {}) {
  let oldestAgeMs = 0;
  for (const { reservedAtMs } of _inMemoryReserved.values()) {
    const age = nowMs - reservedAtMs;
    if (age > oldestAgeMs) oldestAgeMs = age;
  }
  return { count: _inMemoryReserved.size, oldestAgeMs };
}
