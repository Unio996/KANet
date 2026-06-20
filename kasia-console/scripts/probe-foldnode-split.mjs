// probe-foldnode-split.mjs — ② convert-split-2 SIZE probe (J1, 2026-06-20).
// 量 FoldNode_foldonly(新 convert 目标) vs 全 FoldNode(1278B, on-chain 11242u BUST) vs FoldNode_sealonly。
// convert_to_foldonly units ≈ (ShardLeaf reveal 451B + foldonly template) × ~6.5u/B; 目标 < 9999 → foldonly < ~1087B。
// ⚠ compile-probe 真字节; convert units 仍须 J2 链上实测裁 (probe-not-model)。
import { compileSil } from '../src/lib/pool-bshard-artifacts.mjs';
import { extractTemplateArtifact } from '../src/lib/pool-template-artifact.mjs';
import { readFileSync } from 'node:fs';

const z32 = { kind: 'array', data: Array(32).fill({ kind: 'byte', data: 0 }) };
const ci = (n) => ({ kind: 'int', data: n });
const LIB = 'D:/kanet-testnet/kasia-console/src/lib';

const SHARD_REVEAL = 451; // ShardLeaf redeem (J2 offline 实测, register-side 不变)
const RATE = 6.5;         // u/B (11242/1729 实测拟合; 仅参考, 真 units J2 链上裁)

function measure(label, file, ctor) {
  try {
    const compiled = compileSil(`${LIB}/${file}`, ctor);
    const a = extractTemplateArtifact(compiled);
    const redeem = compiled.script.length;
    const convU = Math.round((SHARD_REVEAL + redeem) * RATE);
    const verdict = convU < 9999 ? `OK(<9999)` : `BUST(>9999)`;
    console.log(`${label.padEnd(26)} redeem=${String(redeem).padStart(5)}B  state=${a.encodedStateLen}  →convert≈(451+${redeem})*6.5=${convU}u ${verdict}`);
    return redeem;
  } catch (e) {
    console.log(`${label.padEnd(26)} COMPILE-FAIL: ${e.message.slice(0, 180)}`);
    return null;
  }
}

console.log('\n=== ② convert-split-2 FoldNode 拆分 SIZE probe (真编译; convert units 待 J2 链上裁) ===\n');
// 全 FoldNode (基线: on-chain convert 11242u BUST)
measure('FoldNode (全, BUST基线)', 'FoldNode.sil',
  [z32, z32, ci(2), ci(2), z32, z32, ci(0), ci(0), ci(0), ci(1000)]);
// FoldNode_foldonly (新 convert 目标 = fold半)
measure('FoldNode_foldonly (新)', 'FoldNode_foldonly.sil',
  [z32, z32, ci(2), ci(2), z32, ci(0), ci(0), ci(0), ci(1000)]);
// FoldNode_sealonly (seal半, 已存在; 单片 convert 目标)
measure('FoldNode_sealonly (seal半)', 'FoldNode_sealonly.sil',
  [ci(1), z32, z32, ci(0), ci(0), ci(0), ci(1000)]);

// —— 变体: foldonly 砍 commit_v2 完整性块(移到 seal 步) → fold covenant 还能再瘦多少? ——
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
function measureSrc(label, src, ctor) {
  const dir = mkdtempSync(join(tmpdir(), 'foprobe-'));
  const p = join(dir, 'V.sil'); writeFileSync(p, src);
  try {
    const c = compileSil(p, ctor); const redeem = c.script.length;
    const convU = Math.round((SHARD_REVEAL + redeem) * RATE);
    console.log(`${label.padEnd(26)} redeem=${String(redeem).padStart(5)}B  →convert≈(451+${redeem})*6.5=${convU}u ${convU<9999?'OK(<9999)':'BUST(>9999)'}`);
    return redeem;
  } catch (e) { console.log(`${label.padEnd(26)} COMPILE-FAIL: ${e.message.slice(0,180)}`); return null; }
}
const foSrc = readFileSync(`${LIB}/FoldNode_foldonly.sil`, 'utf8');
// strip the `if (count_sum == shard_count) { ...commit_v2... }` block
const noCommit = foSrc.replace(/\/\/ 折满全片[\s\S]*?require\(blake2b\(commit_pre2\) == commit_v2\);\n\s*\}/, '// commit_v2 移到 seal 步(SIZE probe)');
measureSrc('foldonly 砍commit_v2', noCommit,
  [z32, z32, ci(2), ci(2), z32, ci(0), ci(0), ci(0), ci(1000)]);
// 再砍: 连 commit_v2/market_id ctor 都去(纯 value+account fold)
const minimal = noCommit.replace('byte[32] market_id,\n    byte[32] commit_v2,\n    ', '');
measureSrc('foldonly 最小(去commit ctor)', minimal,
  [ci(2), ci(2), z32, ci(0), ci(0), ci(0), ci(1000)]);
// 绝对地板: 去掉 convert_to_sealonly entry, 只留纯 fold covenant (fold-capable 最小体)
const foldOnlyPure = noCommit.replace(/\/\/ —— entry 1: convert_to_sealonly[\s\S]*?\n    \}\n\}/, '}');
measureSrc('foldonly 纯fold-covenant地板', foldOnlyPure,
  [z32, z32, ci(2), ci(2), z32, ci(0), ci(0), ci(0), ci(1000)]);
console.log('\n门1 判据: convert = (ShardLeaf 451B + foldonly redeem) × 6.5 < 9999 → foldonly redeem < 1087B');
console.log('\n注: convert≈ 用 6.5u/B 拟合估算, 仅判方向; 真生死 J2 on-chain convert probe 裁 (probe-not-model)。\n');
