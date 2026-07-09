// gate-tmpl-hash.selftest.mjs — round-trip 自证(D-009 解除条件之一: "从当前 imageId 现场推导出的值跟
// 硬编码值比对一致", 不是"重跑一致" — 见 docs/DECISIONS.md D-009 + ANTI-PATTERNS.md 规则56)。
//
// 两件事,都是真实断言,不是形状检查:
//  ① computeGateTmplHash(ZK_GATE.imageId, canonical sample) == ZK_GATE.gateTmplHash — 证明当前烤死的
//     gateTmplHash 确实跟当前烤死的 imageId 配对新鲜(pxvml 出生缺陷的反面: 那次这条会 FAIL)。
//  ② computeGateTmplHash 的切法(gate-tmpl-hash.mjs)跟 rebuildZkCloseGateWitness 的切法
//     (zk-close-dispatch.mjs, 生产 witness 重建、已审查、这次改动不碰它)在同一份 canonical sample 上
//     必须产出同一个 gateSuffixHex — 两处各自实现 ZkScriptBuilder 调用不是"两套并行实现互不知道对方"
//     (规则55同族雷),这条断言就是防它们静默分叉的 tripwire。
//
// ⚠ 依赖 ZK-SDK isolated WASM build(ZKSDK_WASM_PATH, 默认 D:/rusty-kaspa-zksdk-isolated/wasm/nodejs/kaspa/
// kaspa.js) — 本机若未装(非 ZK 出证机), 本测试会在 kaspaZk() 处失败, 需换一台已验收过 ZK 环境的机器跑
// (J2/KANet-UI 机器 2026-07-07 已验收, 见 COORD-LEDGER Phase1)。
//
// Run: cd kasia-console && node src/lib/gate-tmpl-hash.selftest.mjs

import { computeGateTmplHash, ensureGateTmplHashFresh, _resetVerifiedForTest } from './gate-tmpl-hash.mjs';
import { rebuildZkCloseGateWitness } from './zk-close-dispatch.mjs';
import { ZK_GATE } from './zk-close-builder.mjs';
import { kaspaZk } from '../services/zk-prove-worker.mjs';
import { blake2b } from '@noble/hashes/blake2b';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE_DIR = join(HERE, '..', '..', '..', 'zk-payout-guest', 'proofs', '3o6cs-attest-0a358fa0');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

const receiptHex = readFileSync(join(SAMPLE_DIR, '3o6cs_receipt.hex'), 'utf8').trim();
const summary = JSON.parse(readFileSync(join(SAMPLE_DIR, '3o6cs_receipt.summary.json'), 'utf8'));
const journalHash = summary.journal_digest;
ok(summary.image_id === ZK_GATE.imageId, `canonical sample image_id matches current ZK_GATE.imageId(${ZK_GATE.imageId.slice(0, 16)}...) — 若不等, 这份 sample 已过期, 需要换一份更新 imageId 的 receipt`);

console.log('[test] ① gateTmplHash 现场推导 == 烤死值(D-009 解除条件核心断言):');
const derived = computeGateTmplHash(ZK_GATE.imageId, receiptHex, journalHash, kaspaZk);
ok(derived === ZK_GATE.gateTmplHash, `computeGateTmplHash(current imageId) = ${derived.slice(0, 16)}... == ZK_GATE.gateTmplHash = ${ZK_GATE.gateTmplHash.slice(0, 16)}...`);

console.log('[test] ② computeGateTmplHash 切法 vs rebuildZkCloseGateWitness 切法一致(drift tripwire):');
const witness = rebuildZkCloseGateWitness({ imageId: ZK_GATE.imageId, journalHash }, receiptHex, kaspaZk);
ok(witness.ok, `rebuildZkCloseGateWitness 成功: ${witness.error || ''}`);
if (witness.ok) {
  const suffixBuf = Buffer.from(witness.gateSuffixHex, 'hex');
  const crossCheckHash = Buffer.from(blake2b(Buffer.concat([Buffer.from([0x20]), suffixBuf]), { dkLen: 32 })).toString('hex');
  ok(crossCheckHash === derived, `rebuildZkCloseGateWitness 的 gateSuffixHex 算出的 hash(${crossCheckHash.slice(0, 16)}...) == computeGateTmplHash 直接算出的值(两条独立切法调用一致, 非同一函数)`);
}

console.log('[test] ③ ensureGateTmplHashFresh fail-loud guard(imageId/gateTmplHash 不配对时必须 throw, 不能静默放行):');
_resetVerifiedForTest();
const prevEnabled = process.env.ZK_PROVE_WORKER_ENABLED;
process.env.ZK_PROVE_WORKER_ENABLED = '1';
try {
  ensureGateTmplHashFresh({ imageId: ZK_GATE.imageId, gateTmplHash: '00'.repeat(32) }, kaspaZk);
  ok(false, 'mismatched gateTmplHash should have thrown, did not');
} catch (e) {
  ok(/配置漂移/.test(e.message), `mismatched pair correctly rejected: ${e.message.slice(0, 80)}...`);
}
_resetVerifiedForTest();
try {
  ensureGateTmplHashFresh(ZK_GATE, kaspaZk); // real pair, must NOT throw (re-proves test① via the guard's own call path)
  ok(true, 'real ZK_GATE pair passes through ensureGateTmplHashFresh without throwing');
} catch (e) { ok(false, `real pair unexpectedly threw: ${e.message}`); }
if (prevEnabled === undefined) delete process.env.ZK_PROVE_WORKER_ENABLED; else process.env.ZK_PROVE_WORKER_ENABLED = prevEnabled;

console.log(fails === 0
  ? '\n✅✅ ALL PASS — gateTmplHash 跟当前 imageId 配对新鲜, 两条切法路径一致'
  : `\n❌ ${fails} assertions failed — gateTmplHash 配置漂移或切法分叉, 不能当 D-009 解除证据`);
process.exit(fails === 0 ? 0 : 1);
