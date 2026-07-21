// bshard-payout-family-coherence.mjs — K-18 §3.1-§3.3 payout_shards covenant-family coherence (J1, 2026-07-21)
// docs/2026-07-18-payoutshard-family-coherence-gate-design.md (K-18 v1.1) +
// docs/2026-07-21-p2-batch1-truth-source-layer-k18-landing-design.md (P2 batch1, §1 offset 表实测定稿/§3.1-3.3 落地计划)
//
// 单源: 供 migrate.js v189 backfill + pool-shard-register.mjs 写入点(covenant_family 声明) +
// console/daemon 花费前 coherence gate 共用, 不重复实现结构探针/家族判定逻辑。
//
// 🔴 调用点分级(K-18 原设计, NWT MUST-FIX③ 已折入)——本文件刻意拆两个函数, 不是随手拆分:
//   probeStructuralSignature() = 零子进程(纯 byte offset 解码 + DB 列比对), 高频/低频调用点(§3.3(a)(b)(d))共用。
//   classifyPayoutShardFamily() = 会 recompile(子进程, compileSil→execFileSync), 只给 migrate v189 backfill
//     (declared 家族未知→判定)用, 绝不能被高频调用点(每笔下注)直接或间接调用——那会破坏"零子进程"承诺。
//   assertPayoutShardCoherence() 的 tier='full'(低频专属)才会跑 (c) recompile byte-equality, 且直接调用
//     compilePayoutShardRedeem/V2Redeem, 不经过 classifyPayoutShardFamily(避免高频误引入子进程依赖链)。

import { compilePayoutShardRedeem } from './pool-shard-register.mjs';

// V1 offset 表(P2 §1, 2026-07-21 4 样本跨 3 个月 byte-exact 实测定稿, 非推断——见设计稿 commit 7b4591b0)。
const V1_PREDICATE_COMMIT_OFF = 518;
const V1_POOL_MERKLE_ROOT_OFF = 1002;
// V2 offset(既有 bshard-close-enforce.mjs `_PREDICATE_COMMIT_REDEEM_OFFSET_V2`, W2 2026-07-07 indexOf 实测+
// 结构推导双证坐实——单源复用同一数值, 不重新定义/不可能跟那边漂移)。
const V2_PREDICATE_COMMIT_OFF = 642;

function _hexAt(buf, off, len) {
  if (off < 0 || off + len > buf.length) return null;
  return buf.slice(off, off + len).toString('hex');
}
function _cleanHex(s) { return String(s || '').replace(/^0x/, '').toLowerCase(); }

// V1 state 区解码(_PS_STATE_START=1 起算, 同 bshard-close-enforce.mjs `_readPsConsolidatedPool`/
// `_splicePayoutCloseRedeem` 约定): byte[0] 是 state 区之前的前导 byte(不断言具体值——P2 §1 表原话
// "(前导byte)", 从没说是 0x08; 实测 KANet-UI hex dump 显示这个位置另有其值, 不是本函数该检查的字段)。
// 真正的 PUSH8 marker 在 byte[_PS_STATE_START]=byte[1](consolidated_pool 字段起点), 数据紧跟其后
// (buf[2..10)=i64LE)。
// 🔴 事故修复(2026-07-21, NWT diff 审 d829e8fe 阻塞级抓漏): 原代码检查 buf[0]!==0x08, 跟本函数自己的
// 注释("_PS_STATE_START=1 起算")自相矛盾——marker 应该查 buf[1], 不是 buf[0]。这个 bug 会让每一行真实
// V1 数据的这个守卫恒为 true(buf[0] 几乎不可能等于 0x08, 它是别的前导字节), decodeV1State 对生产数据
// 永远返回 null, 整个 probeStructuralSignature('v1_committee') 分支形同虚设——测试没抓到是因为手搓
// fixture 自己也把 buf[0] 设成 0x08(跟错误假设自证自洽, 从没有一条走真实 hex dump 字节验证过), 这正是
// KANet-UI 09:01 hex dump(ozzeu 行 byte[0] 实测 != 0x08)才第一时间坐实的类型错误。
function decodeV1State(buf) {
  if (buf.length < 52 || buf[1] !== 0x08) return null;
  try {
    return {
      consolidatedPool: buf.readBigInt64LE(2),
      closed: Number(buf.readBigInt64LE(11)),
      payoutRoot: _hexAt(buf, 20, 32),
    };
  } catch { return null; }
}

/**
 * K-18 §3.3(b) 零子进程结构签名探针 — 纯字节 offset 解码 + DB 列比对, 不 recompile。
 * 给定 declaredFamily, 判定 stored payout_redeem_hex 的字节结构是否跟这个家族的已知(实测定稿)布局吻合。
 * @returns {{ ok: true, decoded? } | { ok: false, reason }}
 */
export function probeStructuralSignature(row, declaredFamily) {
  const buf = Buffer.from(String(row.payout_redeem_hex || ''), 'hex');
  if (buf.length === 0) return { ok: false, reason: 'empty payout_redeem_hex' };
  const pc = _cleanHex(row.predicate_commit);
  const pmr = _cleanHex(row.pool_merkle_root);

  if (declaredFamily === 'v1_committee') {
    const v1State = decodeV1State(buf);
    if (!v1State) return { ok: false, reason: `V1 state 区解码失败(byteLen=${buf.length}, marker@1=0x${buf[1]?.toString(16) ?? '??'})` };
    const pcAt = _hexAt(buf, V1_PREDICATE_COMMIT_OFF, 32);
    const pmrAt = _hexAt(buf, V1_POOL_MERKLE_ROOT_OFF, 32);
    if (pcAt !== pc) return { ok: false, reason: `predicateCommit@${V1_PREDICATE_COMMIT_OFF} 跟 DB 列不符(got=${pcAt}, want=${pc})` };
    if (pmrAt !== pmr) return { ok: false, reason: `poolMerkleRoot@${V1_POOL_MERKLE_ROOT_OFF} 跟 DB 列不符(got=${pmrAt}, want=${pmr})` };
    return { ok: true, decoded: v1State };
  }
  if (declaredFamily === 'v2_zk') {
    const pcAt = _hexAt(buf, V2_PREDICATE_COMMIT_OFF, 32);
    if (pcAt !== pc) return { ok: false, reason: `predicateCommit@${V2_PREDICATE_COMMIT_OFF} 跟 DB 列不符(got=${pcAt}, want=${pc})` };
    return { ok: true };
  }
  return { ok: false, reason: `未知 declaredFamily '${declaredFamily}'` };
}

/**
 * Backfill-only 家族分类器(K-18 §3.1, migrate v189 一次性用, 允许 recompile 子进程成本——不给高频调用点用,
 * 见文件头分级说明)。declared 家族未知时, 实测判定它属于哪个家族。两次(V1/V2)都不过 → 'unknown', 不猜
 * (P2 §5 风险②已预期: 部分历史行(pruned_expired_waived/verifying A0 不符组)可能落进 unknown, 交 dry-run
 * 报告人工过, 不是本函数的 bug)。
 * @returns {{ family: 'v1_committee'|'v2_zk'|'unknown', detail }}
 */
export function classifyPayoutShardFamily(row) {
  const buf = Buffer.from(String(row.payout_redeem_hex || ''), 'hex');
  if (buf.length === 0) return { family: 'unknown', detail: 'empty payout_redeem_hex' };

  const v1Sig = probeStructuralSignature(row, 'v1_committee');
  if (v1Sig.ok) {
    try {
      const recompiled = compilePayoutShardRedeem({
        poolMerkleRoot: row.pool_merkle_root, predicateCommit: row.predicate_commit,
        consolidatedPool: v1Sig.decoded.consolidatedPool, closed: v1Sig.decoded.closed, payoutRoot: v1Sig.decoded.payoutRoot,
      });
      if (recompiled === row.payout_redeem_hex) {
        return { family: 'v1_committee', detail: { consolidatedPool: v1Sig.decoded.consolidatedPool.toString(), closed: v1Sig.decoded.closed } };
      }
      return { family: 'unknown', detail: `V1 结构签名符但 recompile byte-compare 不等(closed=${v1Sig.decoded.closed}) — 可能 w0..w16 非零(nullifier 已用)或其它字段漂移, 不猜` };
    } catch (e) {
      return { family: 'unknown', detail: `V1 recompile 异常: ${e.message}` };
    }
  }

  const v2Sig = probeStructuralSignature(row, 'v2_zk');
  if (v2Sig.ok) {
    // V2 genesis-shape recompile byte-equal 属 §3.3(c) 低频花费前 gate 专属(只在 pre-attest 状态才有效,
    // 见 P2 §1 边界说明), backfill 阶段只用结构签名判族, 不强制。
    return { family: 'v2_zk', detail: 'V2 结构签名(predicateCommit offset)符' };
  }

  return { family: 'unknown', detail: `V1 结构签名: ${v1Sig.reason}; V2 结构签名: ${v2Sig.reason}` };
}

/**
 * K-18 §3.3 四步一致性门(花费前安全闸, 不是历史真实性审计工具——见 P2 §1 边界说明)。
 * tier='cheap'(高频, ensurePayoutShard/V2 早返回分支, 零子进程, 只跑 a/b/d) |
 * tier='full'(低频, consolidateAndBuildPsState 使用前/close-transport V2 入口, 完整四步含 c recompile)。
 * @returns {{ ok: true } | { ok: false, failedStep: 'a'|'b'|'c'|'d', reason }}
 */
export function assertPayoutShardCoherence(psRow, { p2sh, tier = 'full' } = {}) {
  const marketId = psRow.logical_market_id;
  const declared = psRow.covenant_family;
  // (a) family 声明
  if (declared !== 'v1_committee' && declared !== 'v2_zk') {
    return { ok: false, failedStep: 'a', reason: `covenant_family='${declared}' 不在 {v1_committee,v2_zk} — 拒绝, 不猜 (marketId=${marketId})` };
  }
  // (b) 零子进程结构签名(高频/低频共用)
  const sig = probeStructuralSignature(psRow, declared);
  if (!sig.ok) {
    return { ok: false, failedStep: 'b', reason: `结构签名核对失败: ${sig.reason} (marketId=${marketId}, declared=${declared})` };
  }
  // (c) 低频专属, recompile byte-equality — 仅作校验, 不作花费权威来源(K-18 §3.4 定位)
  // 🔴 事故预防(2026-07-21, P2 批2 接线时用 bshard-consolidated-pool-rederive.test.mjs 复跑抓到): 这里
  // 必须区分"recompile 真的跑完、字节比对不等"(= 真 FAIL, 有意义的信号)跟"compileSil 子进程本身起不来"
  // (silverc 二进制缺失/路径错/spawn 失败 = 环境问题, 不是这行数据有问题)——两者在原来的实现里被同一个
  // "抛异常"混在一起, 会让本来该由 tier=cheap/high-freq 路径以外唯一使用 tier=full 的低频花费前 gate,
  // 在任何缺 silverc 的节点上对【所有】v1_committee 市场无差别抛一个跟"这行数据到底 coherent 不 coherent"
  // 完全无关的"spawn ENOENT"异常, 把"环境没配好"跟"这个市场真的有问题"混为一谈——同 §3.5 verifyClaimLanded
  // 三态设计(kaspa_tx_log 查无 ≠ 确认不符)的同一条纪律: 环境层面"查不了" = inconclusive, 不能升级成
  // "查了、真不符"的 FAIL 结论。inconclusive 时跳过(c), 只留(a)(b)(d)三步的判定结果, 不静默放行(不是把
  // inconclusive 当 pass), 只是不让环境问题冒充数据问题挡住结算。
  if (tier === 'full' && declared === 'v1_committee') {
    try {
      const recompiled = compilePayoutShardRedeem({
        poolMerkleRoot: psRow.pool_merkle_root, predicateCommit: psRow.predicate_commit,
        consolidatedPool: sig.decoded.consolidatedPool, closed: sig.decoded.closed, payoutRoot: sig.decoded.payoutRoot,
      });
      if (recompiled !== psRow.payout_redeem_hex) {
        return { ok: false, failedStep: 'c', reason: `recompile byte-compare 不等(marketId=${marketId}, closed=${sig.decoded.closed}) — structural 校验失败(可能 w0..w16 非零/其它字段漂移), fail-closed 拒绝` };
      }
    } catch (e) {
      console.warn(`[assertPayoutShardCoherence] 步骤(c) recompile 本身跑不了(环境问题, 非数据判定, marketId=${marketId}): ${e.message} — inconclusive, 跳过(c), 继续(d)`);
    }
  }
  // v2_zk: compilePayoutShardV2Redeem 只能重编译 genesis-shape(pre-attest), attest 后状态不适用 — 见 P2 §1
  // 边界说明(该步骤验 structural 正确性不是 value 时效性), 不对 v2_zk 强制 recompile, (b) 结构签名已经把关。

  // (d) p2sh 地址匹配
  if (typeof p2sh !== 'function') throw new Error('assertPayoutShardCoherence: p2sh 函数必传(步骤(d)依赖)');
  const derivedAddr = p2sh(psRow.payout_redeem_hex);
  if (derivedAddr !== psRow.payout_ps_addr) {
    return { ok: false, failedStep: 'd', reason: `p2sh(stored redeem)='${derivedAddr}' != payout_ps_addr='${psRow.payout_ps_addr}' (marketId=${marketId})` };
  }
  return { ok: true };
}

/**
 * K-18 §3.2: zk_native 铸后不可变。logicalMarketId 已存在 payout_shards 行(genesis 已铸)后, 任何写
 * resolution_rule_spec 的路径若改变 zk_native 值 → 拒绝(throw), 不静默纠正。未铸(payout_shards 还没这行)
 * 则放行(铸造时 ensurePayoutShard/V2 会按调用方选择的路径写 covenant_family, 那才是真正定家族的时刻)。
 * @param {object} db better-sqlite3 handle
 * @param {string} logicalMarketId
 * @param {boolean} newZkNative 即将写入的新 zk_native 值
 */
export function assertZkNativeImmutable(db, logicalMarketId, newZkNative) {
  const ps = db.prepare(`SELECT covenant_family FROM payout_shards WHERE logical_market_id = ?`).get(logicalMarketId);
  if (!ps) return;   // 未铸 — 自由设置
  const mintedFamily = ps.covenant_family === 'v2_zk' ? true : ps.covenant_family === 'v1_committee' ? false : null;
  if (mintedFamily === null) {
    // covenant_family 尚未 backfill/仍是初始 'unknown' default — 无法确认铸造时家族, fail-closed 拒绝改动
    // (money-path 不可变性守卫, 宁可误拦也不放过真违规; 正常运行期间新铸市场的 covenant_family 由
    // ensurePayoutShard/V2 写入点保证非 unknown, 只有 backfill 窗口内的历史行才会走到这支)。
    throw new Error(`assertZkNativeImmutable: logicalMarketId=${logicalMarketId} payout_shards.covenant_family 未知(backfill 未覆盖或初始 default) — 无法确认铸造时家族, fail-closed 拒绝改动 zk_native(K-18 §3.2)`);
  }
  if (Boolean(newZkNative) !== mintedFamily) {
    throw new Error(`assertZkNativeImmutable: logicalMarketId=${logicalMarketId} 已铸 payout_shards(covenant_family=${ps.covenant_family}), 不可把 zk_native 改成 ${newZkNative}(铸造时确定的家族不可变, K-18 §3.2)`);
  }
}
