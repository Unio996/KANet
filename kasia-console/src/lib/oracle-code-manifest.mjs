// oracle-code-manifest.mjs — KANet-UI wave1 #3 (码轴·部署等价闸 / deploy-equivalence gate)
// 设计: docs/2026-06-19-deploy-equivalence-gate-design.md · 共识: 2026-06-19-oracle-hardening-adversarial-consensus.md §1②
//
// 命门: determinism = 跨节点 AGREE 非 CORRECT。现有双 hash gate(committee_pk_hash + metadata_hash)
// 保证【委员集】+【市场参数】跨节点 byte-equal, 但默认了【判这些输入的代码】跨节点也 byte-identical。
// 反例: :3200 跑技能 commit A、:3300 差一 commit B → 喂同一冻结快照/同委员集 → 算出异 verdict =
// silent fork 伪装成 'oracle 分歧'。码版本轴 ⟂ 源轴(field_hash) ⟂ 指令轴。
//
// 机制: 每个委员投票带 computeOracleCodeManifestHash()(进签名 payload, 防篡改)。J2 步3 双轴 gate
// (decideConsensusV06) 计票前按 code_manifest_hash quorum 过滤: 只同版本(quorum 众数)的票进 tally,
// 少数派版本 → 排除 → 凑不齐 threshold → 现有 silent-timeout-refund(fail = abstain 非 fork)。
//
// manifest = 严格【漂移即改 verdict】的 settle 判决路文件集。禁整 repo tree-hash(UI 改一行误炸全网
// abstain)。漏一个判决依赖文件 = 那文件漂移逃闸(设计 §4)→ 加判决依赖必同步进此清单。

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// kasia-console 根 = ../../ (本文件在 src/lib/)。relpath 是稳定锚(绝对路径跨机器异 → 不进 hash)。
const _consoleRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// settle 判决路 oracle 文件 (relpath from kasia-console/)。.sort() = 顺序无关确定性。
// 自包含本文件 → 改 manifest 清单本身即改 hash。三方确认 (NWT hash集==输入集 / J1 judgeline / J2 抽取):
export const ORACLE_SETTLE_MANIFEST = [
  'src/lib/judgeline.mjs',                    // J1 D-L1 确定性 judgeLine
  'src/lib/oracle-code-manifest.mjs',         // 本文件 (self-include)
  'src/lib/oracle-evidence-extractors.mjs',   // J2 抽取 + normalizeAbbr + extractEspnFields (判决依赖)
  'src/services/bettor-prediction-voter.js',  // deriveKanetNativeVote 投票派生
  'src/services/derivevote-prompt.mjs',       // canonical LLM prompt
  'src/services/pool-market-settler.js',      // decideConsensusV06 共识计票
].sort();

// 行尾 normalize 再 hash (NWT CRLF probe 命门修): working-tree 文件在 Windows core.autocrlf 下可能
// CRLF, 而 git tree-hash byte-equal 是【blob】层(=LF, 仓库存储)。不 normalize → :3200 CRLF vs :3300 LF
// 同一 commit 却异 hash → 码轴 gate 判"异版本" → 跨节点票全 axis-mismatch (config 差伪装版本漂移 =
// liveness 破, 非实码漂)。probe 实锤: LF≠CRLF, content.replace(/\r\n/g,'\n') 后相等。
export function hashFileContentNormalized(content) {
  return createHash('sha256').update(String(content).replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

// 纯函数: 同文件内容(行尾无关) → 同 hash, 跨节点 byte-equal。无 clock/random/network/绝对路径。
// sha256 over sorted [relpath:normalize-hash(content)] 拼接 → 确定性。
export function computeOracleCodeManifestHash() {
  const parts = [];
  for (const rel of ORACLE_SETTLE_MANIFEST) {
    let content;
    try {
      content = readFileSync(join(_consoleRoot, rel), 'utf8');
    } catch (e) {
      // 缺/改名 settle 判决文件 = 部署损坏 → fail-loud (静默 = 漂移逃闸)。
      throw new Error(`[oracle-code-manifest] settle-path file unreadable: ${rel} (${e.message}) — deploy-equivalence gate cannot compute code hash; fail-loud`);
    }
    parts.push(`${rel}:${hashFileContentNormalized(content)}`);
  }
  return createHash('sha256').update(parts.join('\n'), 'utf8').digest('hex');
}

// lazy + cached: 首次用时算 (= 运行进程的码版本快照), 缓存。不在 module-load 顶层算 → 缺文件不崩
// Console boot, 而是 derive vote 时 fail (voter try/catch 吞 → 该票 skip, 非全 Console 死)。
// 运行中文件不变 (deploy = restart); cutover 重启加载新码 → 新 hash 生效。
let _cached = null;
export function getOracleCodeManifestHash() {
  if (_cached === null) _cached = computeOracleCodeManifestHash();
  return _cached;
}

// 诊断面 (KANet-UI wave1 #3, NWT 条件②·可归因性): 委员票被 J2 步3 双轴 gate 排除时必能区分【哪一轴漂】
// (码轴 code_manifest_hash / 源轴 field_hash) — 否则 abstain/refund 掩盖根因运维查不出 (= 共识洗白对偶
// 坑"排除了但不知为啥排")。J2 gate 排除一票时调用此 helper 打一行结构化诊断 (可 grep [axis-mismatch],
// 区分 axis + 哪个委员落少数 + 双方 hash)。纯 logging 无 db 耦合 (operator grep console = relay-health 模式);
// Brain/UI 持久化由 J2 gate (有 db context) 另叠。axis ∈ {'code','source'}。
export function warnAxisMismatch({ marketId, axis, voterPk, quorumHash, voterHash } = {}) {
  const m = String(marketId ?? '').slice(0, 12);
  const vp = String(voterPk ?? '').slice(0, 12);
  const qh = String(quorumHash ?? '').slice(0, 12);
  const vh = String(voterHash ?? '').slice(0, 12);
  console.warn(`[axis-mismatch] market=${m} axis=${axis} voter=${vp} quorum_hash=${qh} voter_hash=${vh} → vote excluded (observe-only pre-enforce: count+log only, no settle impact)`);
  return { marketId: m, axis, voterPk: vp, quorumHash: qh, voterHash: vh };  // 结构化返回 = J2 gate 可持久化
}
