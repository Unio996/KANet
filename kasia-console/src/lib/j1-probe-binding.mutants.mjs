// j1-probe-binding.mjs 的变异测试 — Codex aaddc1c6/(441) gate#1 点名: 「fail-closed→warn 必须被 detect」。
// 走隔离执行器(harness② · mutation-runner.mjs): 变异只改 .mut-tmp 副本, 共享树零写入。
// 改 runner 先跑 selfcheck 三臂; 本套读数的分辨器=阴性臂(等价改写必 MISSED), 不是"全 detected"。
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMutationsIsolated } from './mutation-runner.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const MUTANTS = [
  // ── Codex 点名件: 身份矛盾从 fail-closed 退化成放行 ──
  ['🔴 fail-closed→放行: 错 txid 也给 first-seen/confirmed(=被拆掉的那道硬闸)',
    (s) => s.replace(
      "  if (h !== submitTxid) return { verdict: 'contradiction', txHash: h };",
      "  if (h !== submitTxid) return { verdict: row.status === 'confirmed' ? 'confirmed' : 'first-seen', txHash: h };")],
  ['🔴 矛盾检查整个删除(直接走到 credit 分支)',
    (s) => s.replace("  if (h !== submitTxid) return { verdict: 'contradiction', txHash: h };", '')],
  // ── D: 行绑定三要素逐个拆 ──
  ['content 全文相等退化成 includes(引用/转发攻击重开)',
    (s) => s.replace(
      "  if (String(row.content || '') !== String(exactMsg)) return { verdict: 'not-bound', detail: 'content-mismatch' };",
      "  if (!String(row.content || '').includes(String(exactMsg).slice(0, 24))) return { verdict: 'not-bound', detail: 'content-mismatch' };")],
  ['sender 身份检查拆除(他人复读同文可冒充)',
    (s) => s.replace(
      "  if (String(row.sender_address || '') !== String(expectedSender)) return { verdict: 'not-bound', detail: 'sender-mismatch' };",
      '')],
  // ── #3: firstSeen 的 tx_hash 合法性闸 ──
  ['行 tx_hash 64-hex 校验拆除(空 hash 也进 credit 路径)',
    (s) => s.replace("  if (!HEX64.test(h)) return { verdict: 'no-valid-txhash' };", '')],
  // ── #2: submit 侧输入合同 ──
  ['submitTxid 合法性闸拆除(前缀/空也当完整身份用)',
    (s) => s.replace("  if (!HEX64.test(String(submitTxid || ''))) return { verdict: 'invalid-submit-txid' };", '')],
  // ── credit 词判定本身 ──
  ['confirmed 判定恒真(pending 也报 confirmed)',
    (s) => s.replace("  return { verdict: row.status === 'confirmed' ? 'confirmed' : 'first-seen', txHash: h };",
      "  return { verdict: 'confirmed', txHash: h };")],
];

const REPO_ROOT = join(HERE, '..', '..', '..');
const r = runMutationsIsolated({
  repoRoot: REPO_ROOT,
  srcRel: 'kasia-console/src/lib/j1-probe-binding.mjs',
  testRel: 'kasia-console/src/lib/j1-probe-binding.test.mjs',
  mutants: MUTANTS,
  unreachable: [],
});
if (r.miss || r.inert || r.broken) process.exit(1);
