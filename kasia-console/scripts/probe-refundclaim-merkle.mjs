// probe-refundclaim-merkle.mjs — ④ STEP1 SIZE probe (J1, 2026-06-20).
// 量 RefundClaim_merkle.sil 编译 redeem 字节 + template prefix/state/suffix, 对比 RootClaim(已链上验 ~764B depth-1)。
// spec §6: probe-not-model — N-wide refunded_bitmap 是否撞 ~790B WithTemplate 预算由真编译裁, 非线性估。
import { compileSil } from '../src/lib/pool-bshard-artifacts.mjs';
import { extractTemplateArtifact } from '../src/lib/pool-template-artifact.mjs';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const z32 = { kind: 'array', data: Array(32).fill({ kind: 'byte', data: 0 }) };
const ci = (n) => ({ kind: 'int', data: n });

// ctor: 2 template params + 8 init State fields
// (ps_tmpl, shard_pool, local_yes, local_no, count, pool_value, closed, winningSide, payoutRoot(=refundRoot), refunded_bitmap)
const CTOR_REFUND = [z32, z32, ci(0), ci(0), ci(0), ci(1000), ci(2), ci(0), z32, ci(0)];
// RootClaim ctor 对照: 同布局 (last = claimed_bitmap)
const CTOR_ROOT = [z32, z32, ci(0), ci(0), ci(0), ci(1000), ci(1), ci(0), z32, ci(0)];

function measure(label, path, ctor, src) {
  const dir = mkdtempSync(join(tmpdir(), 'refprobe-'));
  const p = join(dir, 'V.sil');
  writeFileSync(p, src);
  try {
    const compiled = compileSil(p, ctor);
    const a = extractTemplateArtifact(compiled);
    const redeem = compiled.script.length;
    const withTmpl = a.templatePrefixLen + a.encodedStateLen + a.templateSuffixLen;
    console.log(`${label.padEnd(34)} redeem=${String(redeem).padStart(6)}B  prefix=${a.templatePrefixLen} state=${a.encodedStateLen} suffix=${a.templateSuffixLen}  WithTmpl=${withTmpl}B  (~790 预算)`);
    return { redeem, withTmpl };
  } catch (e) {
    console.log(`${label.padEnd(34)} COMPILE-FAIL: ${e.message.slice(0, 200)}`);
    return null;
  }
}

console.log('\n=== ④ RefundClaim_merkle SIZE probe (depth-1 镜像) ===\n');
const refundSrc = readFileSync('D:/kanet-testnet/kasia-console/src/lib/RefundClaim_merkle.sil', 'utf8');
const rootSrc = readFileSync('D:/kanet-testnet/kasia-console/src/lib/RootClaim.sil', 'utf8');

measure('RootClaim (链上验基线 depth-1)', null, CTOR_ROOT, rootSrc);
measure('RefundClaim_merkle (depth-1)', null, CTOR_REFUND, refundSrc);

// N-wide probe: depth-2 (4 bettor) — 改 cap 看 bitmap loop unroll 增长
const d2 = refundSrc.replace('require(tree_depth <= 1)', 'require(tree_depth <= 2)');
measure('RefundClaim_merkle (depth-2 4bettor)', null, CTOR_REFUND, d2);
const d3 = refundSrc.replace('require(tree_depth <= 1)', 'require(tree_depth <= 3)');
measure('RefundClaim_merkle (depth-3 8bettor)', null, CTOR_REFUND, d3);
console.log('');
