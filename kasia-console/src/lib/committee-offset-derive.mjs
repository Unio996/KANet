// committee-offset-derive.mjs — 委员校验 offset 运行时派生单源（J2 2026-09-14, ledger 1224/1226/1233/1237,
//   方案 docs/2026-09-14-j2-committee-offset-live-derive-design-v0.1.md）。
//
// 取代 bshard-close-enforce.mjs 的 _PREDICATE_COMMIT_REDEEM_OFFSET(_V2) / _PMR_COMMITTEE_CHECK_OFFSETS(_V2)
// 四组硬编码绝对偏移数字——这些数字被证实会随 .sil 改动/编译器版本漂移而不报错地过期（D-019 迁移实测:
// V1/V2 两族 offset 全部漂移，差了上万字节量级），本模块把它们换成"每次对固定 git-tracked 源码用 D-019 pin
// 编译器现场编一次、用结构性 sentinel 定位"——offset 不再是一个需要人记得手动重量的常量，是每次都现场验证
// 过结构的派生值。
//
// 🔴 硬约束(NWT 7f6dacc4 定案，不可绕过): 只从**固定 git-tracked 源码路径**派生，绝不接受调用方(如
//   signRequest/proposal)传入的编译产物或路径——这条硬约束的存在理由是防止委员被喂一份"看起来合法、实际
//   被篡改"的产物当作派生依据，派生的可信度完全来自"用的是本机可信 D-019 pin 编译器 + 本机 git 树上的源码"
//   这两件事，不能有任何外部输入插进这条链路。
//
// 🔴 K-18 双闸独立性(NWT ledger 1237 要求③): bshard-close-enforce.mjs 的拒签闸与
//   bshard-payout-family-coherence.mjs 的 probeStructuralSignature **各自独立 import 并调用本模块**，
//   传入**各自不同的 sentinel 常量**——本模块内部的缓存 key 含 sentinel(见下), 两道闸不会命中同一个缓存
//   条目, 不存在"一道闸吃另一道闸算好的结果"这回事, 两次都是真实独立的编译+定位+验证。

import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileSilV100, ctorBytes32V100, ctorIntV100, assertSilvercV100Pinned, DEFAULT_SILVERC_V100_PATH, cachedFileSha256 } from './pool-bshard-artifacts.mjs';

const LIB = dirname(fileURLToPath(import.meta.url));
const PAYOUT_SHARD_SIL = join(LIB, 'PayoutShard.sil');
const PAYOUT_SHARD_V2_SIL = join(LIB, 'PayoutShardV2.sil');

// ── checked-in 参考值(v0.1 硬编码常量的历史快照，非权威——仅用于 §4 WARN-not-block 比对，任何计算路径
//   不得引用这些数字，见 v0.2 附录 ledger 1239 提醒①) ──────────────────────────────────────────────
const _REFERENCE_OFFSETS = {
  v1: { predicateCommitOffset: 518, poolMerkleRootOffsets: [1002, 1266, 1530, 1794, 2058] },
  v2: { predicateCommitOffset: 642, poolMerkleRootOffsets: [1126, 1390, 1654, 1918, 2182] },
};

const W17V100 = () => Array.from({ length: 17 }, () => ctorIntV100(0));

/** 占位 ctor(V1, 25 参数)——结构不依赖 ctor 值，sentinel 槽位真实填入，其余占位互不相同避免碰撞。 */
function _ctorV1(pmrSentinel, pcSentinel) {
  return [
    ctorBytes32V100(pmrSentinel), ctorBytes32V100(pcSentinel), ctorBytes32V100('dd'.repeat(32)),
    ctorIntV100(0), ctorIntV100(0), ctorBytes32V100('ee'.repeat(32)),
    ...W17V100(),
    ctorBytes32V100('ff'.repeat(32)), ctorBytes32V100('11'.repeat(32)),
  ];
}
/** 占位 ctor(V2, 30 参数)。 */
function _ctorV2(pmrSentinel, pcSentinel) {
  return [
    ctorBytes32V100(pmrSentinel), ctorBytes32V100(pcSentinel), ctorBytes32V100('cc'.repeat(32)),
    ctorBytes32V100('dd'.repeat(32)),
    ctorIntV100(0), ctorIntV100(0), ctorBytes32V100('ee'.repeat(32)),
    ...W17V100(),
    ctorIntV100(-1), ctorIntV100(0), ctorBytes32V100('ff'.repeat(32)), ctorBytes32V100('11'.repeat(32)),
    ctorBytes32V100('22'.repeat(32)), ctorBytes32V100('33'.repeat(32)),
  ];
}

function _findAllOccurrences(buf, needle) {
  const out = [];
  let idx = buf.indexOf(needle);
  while (idx >= 0) { out.push(idx); idx = buf.indexOf(needle, idx + 1); }
  return out;
}

/** 结构哨兵: offset-1 字节必须是 PUSH32(0x20)，排除裸字节巧合命中的假阳性。 */
function _push32Filter(buf, occurrences) {
  return occurrences.filter((o) => o >= 1 && buf[o - 1] === 0x20);
}

/**
 * dispatch_tag 字节偏移定界(主路径, NWT 1237②)：每个 entry 的 dispatch_tag 在 bytecode 里应精确出现 1 次，
 * 其偏移即该 entry 分支起点；相邻两个 tag 偏移之间的区间 = 该 entry 的字节范围。
 * @returns {Array<{name:string, start:number, end:number}>} 按 start 升序排列的区间表(最后一个 end=Infinity)
 */
function _deriveEntryRanges(rawCompiled, contractName, buf) {
  const entries = rawCompiled?.contracts?.[contractName]?.entries;
  if (!entries || typeof entries !== 'object' || Object.keys(entries).length === 0) {
    throw new Error(`委员offset派生: contracts["${contractName}"].entries 缺失或为空(schema 漂移?) — 无法用 dispatch_tag 定界，fail-closed`);
  }
  const marks = [];
  for (const [name, e] of Object.entries(entries)) {
    if (!e?.dispatch_tag) throw new Error(`委员offset派生: entry "${name}" 缺 dispatch_tag — schema 漂移，fail-closed`);
    const tagBuf = Buffer.from(e.dispatch_tag, 'hex');
    const hits = _findAllOccurrences(buf, tagBuf);
    if (hits.length !== 1) {
      throw new Error(`委员offset派生: entry "${name}" 的 dispatch_tag(${e.dispatch_tag}) 在 bytecode 里出现 ${hits.length} 次(期望恰 1 次) — 拒绝定界，fail-closed`);
    }
    marks.push({ name, start: hits[0] });
  }
  marks.sort((a, b) => a.start - b.start);
  return marks.map((m, i) => ({ name: m.name, start: m.start, end: i + 1 < marks.length ? marks[i + 1].start : Infinity }));
}

function _entryOf(ranges, offset) {
  const r = ranges.find((r) => offset >= r.start && offset < r.end);
  if (!r) throw new Error(`委员offset派生: offset ${offset} 落在全部 entry 区间之外 — 结构异常，fail-closed`);
  return r.name;
}

/** (compilerSha256, sourceSha256, sentinel组合) 缓存——含 sentinel: 两道闸传不同 sentinel 时天然各走一次
 *  真实独立派生，不会命中同一条目(NWT 1237③ 的字面要求，不是"共享缓存也无所谓"的弱化实现)。 */
const _cache = new Map();

/**
 * 派生 PayoutShard(V1)/PayoutShardV2(V2) 的委员校验 offset——取代 4 组硬编码常量。
 * @param {object} o
 * @param {boolean} o.isV2
 * @param {string} o.pmrSentinelHex 32B hex，poolMerkleRoot 定位用的 sentinel(必须与 pcSentinelHex 及本文件
 *   其它占位槽位互不相同，避免 indexOf 假阳性——同 computeCloseZkTmplAnchor 已踩过的"distinct non-zero dummy
 *   markers"纪律)
 * @param {string} o.pcSentinelHex 32B hex，predicate_commit 定位用的 sentinel
 * @param {string} [o.v100Path] 覆盖用(测试注入)，默认走 compileSilV100 自己的 env/pin 逻辑
 * @returns {{ predicateCommitOffset:number, poolMerkleRootOffsets:number[], referenceMismatch:boolean }}
 */
/**
 * 纯函数分析核心(白盒可测)：给定已编译的 buffer + 原始 v1.0.0 产物 JSON + 两个 sentinel，做全部结构校验
 * 并返回 { predicateCommitOffset, poolMerkleRootOffsets }，任何异常均 throw(fail-closed)。
 * 不做任何 I/O/编译/路径决策——那些都在 deriveCommitteeCheckOffsets 里，方便测试用任意 buffer(含真实
 * "构造异常样本"编译出的、或纯手搓的)驱动这条校验链路，不需要每个负向量都通过公开 API 的固定路径编译。
 * @param {Buffer} buf 编译产物完整字节
 * @param {object} raw silverc v1.0.0 原始 JSON(取 .contracts[contractName].entries)
 * @param {string} contractName
 * @param {string} pmrSentinelHex
 * @param {string} pcSentinelHex
 */
export function _analyzeCompiledBuffer(buf, raw, contractName, pmrSentinelHex, pcSentinelHex) {
  const pmrHits = _push32Filter(buf, _findAllOccurrences(buf, Buffer.from(pmrSentinelHex, 'hex')));
  const pcHits = _push32Filter(buf, _findAllOccurrences(buf, Buffer.from(pcSentinelHex, 'hex')));
  if (pmrHits.length !== 10) throw new Error(`deriveCommitteeCheckOffsets: poolMerkleRoot 结构性哨兵命中 ${pmrHits.length} 次(期望 10 = close_attest 5 + cancel_attest 5) — fail-closed，拒绝派生一个数量不对的偏移表`);
  if (pcHits.length !== 4) throw new Error(`deriveCommitteeCheckOffsets: predicate_commit 结构性哨兵命中 ${pcHits.length} 次(期望 4 = close_attest 2 + cancel_attest 2) — fail-closed`);

  // 主路径: dispatch_tag 定界。
  const ranges = _deriveEntryRanges(raw, contractName, buf);
  const pmrByEntry = { close_attest: [], cancel_attest: [] };
  for (const o of pmrHits) {
    const name = _entryOf(ranges, o);
    if (name !== 'close_attest' && name !== 'cancel_attest') throw new Error(`deriveCommitteeCheckOffsets: poolMerkleRoot 命中落在非预期 entry "${name}"(offset ${o}) — fail-closed`);
    pmrByEntry[name].push(o);
  }
  const pcByEntry = { close_attest: [], cancel_attest: [] };
  for (const o of pcHits) {
    const name = _entryOf(ranges, o);
    if (name !== 'close_attest' && name !== 'cancel_attest') throw new Error(`deriveCommitteeCheckOffsets: predicate_commit 命中落在非预期 entry "${name}"(offset ${o}) — fail-closed`);
    pcByEntry[name].push(o);
  }
  if (pmrByEntry.close_attest.length !== 5 || pmrByEntry.cancel_attest.length !== 5) {
    throw new Error(`deriveCommitteeCheckOffsets: poolMerkleRoot 按 dispatch_tag 定界后 close_attest=${pmrByEntry.close_attest.length}/cancel_attest=${pmrByEntry.cancel_attest.length}(期望各 5) — fail-closed`);
  }
  if (pcByEntry.close_attest.length !== 2 || pcByEntry.cancel_attest.length !== 2) {
    throw new Error(`deriveCommitteeCheckOffsets: predicate_commit 按 dispatch_tag 定界后 close_attest=${pcByEntry.close_attest.length}/cancel_attest=${pcByEntry.cancel_attest.length}(期望各 2) — fail-closed`);
  }

  // 互证(备选路径, NWT 1237②): 位置排序法必须与 dispatch_tag 定界得出同一个 close_attest 集合(升序取前 N 个)。
  const pmrSorted = [...pmrHits].sort((a, b) => a - b);
  const pmrPositionalCloseAttest = pmrSorted.slice(0, 5);
  if (JSON.stringify(pmrPositionalCloseAttest) !== JSON.stringify([...pmrByEntry.close_attest].sort((a, b) => a - b))) {
    throw new Error('deriveCommitteeCheckOffsets: poolMerkleRoot 位置排序法与 dispatch_tag 定界结果不一致(互证失败) — fail-closed，两种方法必须一致才可信');
  }
  const pcSorted = [...pcHits].sort((a, b) => a - b);
  const pcPositionalCloseAttest = pcSorted.slice(0, 2);
  if (JSON.stringify(pcPositionalCloseAttest) !== JSON.stringify([...pcByEntry.close_attest].sort((a, b) => a - b))) {
    throw new Error('deriveCommitteeCheckOffsets: predicate_commit 位置排序法与 dispatch_tag 定界结果不一致(互证失败) — fail-closed');
  }

  // 4/5 份互证: 同一 entry 内的多份 inline copy 理应是同一个 ctor 值的重复烤入，位置不同但——此处只验证
  // "数量/归属/结构哨兵"三件事，不重复验证"内容相等"(那是运行时(消费方 close_attest/cancel_attest 自己
  // 的 require 语句)的职责，本函数只管"这些是不是真实、结构合法的位置"，不代替消费方读取字节内容)。

  // 最终返回值: predicate_commit 取 close_attest 集合里"entry 内第一次出现"那份(升序最小)，
  // 同既有 _predicateCommitOffset 的选取语义一致(不改变下游消费方的解读方式)。
  const predicateCommitOffset = Math.min(...pcByEntry.close_attest);
  const poolMerkleRootOffsets = [...pmrByEntry.close_attest].sort((a, b) => a - b);
  return { predicateCommitOffset, poolMerkleRootOffsets };
}

export function deriveCommitteeCheckOffsets({ isV2, pmrSentinelHex, pcSentinelHex, v100Path }) {
  for (const [label, v] of [['pmrSentinelHex', pmrSentinelHex], ['pcSentinelHex', pcSentinelHex]]) {
    if (!/^[0-9a-fA-F]{64}$/.test(String(v || ''))) throw new Error(`deriveCommitteeCheckOffsets: ${label} 必须是 32B hex，收到 ${JSON.stringify(v)}`);
  }
  if (pmrSentinelHex.toLowerCase() === pcSentinelHex.toLowerCase()) {
    throw new Error('deriveCommitteeCheckOffsets: pmrSentinelHex 与 pcSentinelHex 不能相同(会互相污染 indexOf 定位)');
  }
  const silPath = isV2 ? PAYOUT_SHARD_V2_SIL : PAYOUT_SHARD_SIL;
  const contractName = isV2 ? 'PayoutShardV2' : 'PayoutShard';
  const resolvedV100Path = v100Path || process.env.SILVERC_V100_PATH || DEFAULT_SILVERC_V100_PATH;
  const pin = assertSilvercV100Pinned(resolvedV100Path); // 显式先调一次: 即使下面 compileSilV100 内部也会调，这里提前让"编译器不对"这个失败在缓存 key 计算之前就发生，且给出的 sha256 直接进 key，不用再读一次文件。
  // cachedFileSha256(按 mtimeMs+size 缓存, 见 pool-bshard-artifacts.mjs 头注): 本函数每次调用(含缓存
  // 命中前)都要先算 pin.sha256(上一行, 缓存内)与 sourceSha256(这一行)才能拼出 cacheKey——这两次哈希
  // 本身不缓存的话, "缓存命中"只是省了 compileSilV100, 省不了这两次读盘+哈希(2026-09-14 实测: 未缓存时
  // 每次调用仍要 ~4ms, 热路径每笔下注都要付这个成本)。
  const sourceSha256 = cachedFileSha256(silPath);
  const cacheKey = createHash('sha256').update(`${pin.sha256}:${sourceSha256}:${pmrSentinelHex}:${pcSentinelHex}:${isV2}`).digest('hex');
  if (_cache.has(cacheKey)) return _cache.get(cacheKey);

  const ctorBuilder = isV2 ? _ctorV2 : _ctorV1;
  const ctor = ctorBuilder(pmrSentinelHex, pcSentinelHex);
  const compiled = compileSilV100(silPath, ctor, contractName, resolvedV100Path);
  const buf = Buffer.from(compiled.script);
  const raw = compiled._raw;

  const { predicateCommitOffset, poolMerkleRootOffsets } = _analyzeCompiledBuffer(buf, raw, contractName, pmrSentinelHex, pcSentinelHex);

  const ref = isV2 ? _REFERENCE_OFFSETS.v2 : _REFERENCE_OFFSETS.v1;
  const referenceMismatch = predicateCommitOffset !== ref.predicateCommitOffset || JSON.stringify(poolMerkleRootOffsets) !== JSON.stringify(ref.poolMerkleRootOffsets);
  if (referenceMismatch) {
    console.warn(`[committee-offset-derive] WARN: derived != checked-in reference (isV2=${isV2}, derived predicateCommitOffset=${predicateCommitOffset}, reference=${ref.predicateCommitOffset}, derived poolMerkleRootOffsets=${JSON.stringify(poolMerkleRootOffsets)}, reference=${JSON.stringify(ref.poolMerkleRootOffsets)}) — .sil 已改动，建议更新 checked-in 参考值(不拒签，仅留痕)`);
  }

  const result = { predicateCommitOffset, poolMerkleRootOffsets, referenceMismatch };
  _cache.set(cacheKey, result);
  return result;
}

export { _REFERENCE_OFFSETS as CHECKED_IN_REFERENCE_OFFSETS };
// 测试专用导出(白盒单测用，不是公开 API 的一部分——生产调用方只应该用上面的 deriveCommitteeCheckOffsets)。
export { _ctorV1, _ctorV2, PAYOUT_SHARD_SIL, PAYOUT_SHARD_V2_SIL };

/**
 * 启动期预热(observability-only, ledger 1247)——console 启动时对每一组(gate 专属 sentinel)×(V1,V2)各真实
 * 派生一次，让"每笔下注/每次委员签名请求都是热路径"这条既有承诺在**真实流量到达前**就已经缓存命中，而不是
 * 让第一笔真实请求背上一次性 spawn 延迟。**这不是承重闸**——预热失败(编译器不对/派生逻辑异常)只 LOUD
 * console.error，不 throw、不阻止 console 启动继续跑其它职责(同 checkSilvercPinAtStartup 的既定哲学，
 * ledger 1247 裁：预热失败处置与 pin FAIL 同款)。真正的安全闸仍是 deriveCommitteeCheckOffsets 本身——预热
 * 没跑成不代表放行，只代表"这次没有提前把缓存焐热"，后续每个 gate 调用它时该抛照抛，各闸各自 fail-closed。
 * 预热成功但缓存未命中(不该发生，除非并发竞态或缓存被清空)会在调用点自然触发一次真实派生 + 该函数自己的
 * WARN(见 deriveCommitteeCheckOffsets 内 referenceMismatch 那条日志)，不是本函数额外再包一层。
 * @param {Array<{label:string, pmrSentinelHex:string, pcSentinelHex:string, v100Path?:string}>} sentinelSets
 *   每个 gate 一组（自己的专属 sentinel），本函数不替调用方决定用哪些 sentinel——单源只在"怎么派生"这件事
 *   上，不在"用哪个 sentinel"上（那仍是各 gate 自己的选择，NWT 1237③ 独立性要求的延伸）。
 * @returns {Array<{label:string, isV2:boolean, ok:boolean, error?:string}>} 逐条结果(供调用方需要时检查，
 *   多数情况下只需要看 LOUD 日志，不强制处理返回值)。
 */
export function warmupCommitteeOffsetCache(sentinelSets) {
  const results = [];
  for (const set of sentinelSets) {
    for (const isV2 of [false, true]) {
      try {
        deriveCommitteeCheckOffsets({ isV2, pmrSentinelHex: set.pmrSentinelHex, pcSentinelHex: set.pcSentinelHex, v100Path: set.v100Path });
        results.push({ label: set.label, isV2, ok: true });
      } catch (e) {
        console.error(`[committee-offset-derive] WARMUP FAIL (label=${set.label}, isV2=${isV2}): ${e.message} — console 继续启动，该 gate 之后真实调用时会自己 fail-closed，不是被这里的预热失败放行`);
        results.push({ label: set.label, isV2, ok: false, error: e.message });
      }
    }
  }
  return results;
}
