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

console.log('[test] ④ 跨源一致性(NWT finding①HIGH 修复验证): kanet.env ZK_GATE_TMPL_HASH == ZK_GATE.gateTmplHash == 现场推导值:');
if (process.env.ZK_GATE_TMPL_HASH) {
  ok(process.env.ZK_GATE_TMPL_HASH === ZK_GATE.gateTmplHash, `env ZK_GATE_TMPL_HASH(${process.env.ZK_GATE_TMPL_HASH.slice(0, 16)}...) == ZK_GATE.gateTmplHash(${ZK_GATE.gateTmplHash.slice(0, 16)}...) — 三处消费点(buildZkHandoffRequestV2/_resolveZkNativeCtorExtras/debugger endpoint)实际读的是这份 env, 不是 ZK_GATE 常量本身`);
  ok(process.env.ZK_GATE_TMPL_HASH === derived, `env ZK_GATE_TMPL_HASH == 现场推导值(三源闭环: env==ZK_GATE==derived)`);
} else {
  console.log('  ⏭️  跳过(此机 kanet.env 未设 ZK_GATE_TMPL_HASH — 非静默忽略, 显式记录跳过原因: 需在已配置 ZK env 的节点跑才能验这条)');
}

console.log('[test] ⑤ 跨源漂移 fail-loud(finding①(a) 修复验证): env 跟 ZK_GATE 不一致时必须 throw, 不能只验 ZK_GATE 内部自洽:');
_resetVerifiedForTest();
const prevEnvVal = process.env.ZK_GATE_TMPL_HASH;
process.env.ZK_PROVE_WORKER_ENABLED = '1';
process.env.ZK_GATE_TMPL_HASH = 'ff'.repeat(32); // 故意跟 ZK_GATE.gateTmplHash(真值)不一致
try {
  ensureGateTmplHashFresh(ZK_GATE, kaspaZk); // ZK_GATE 本身没问题(imageId/gateTmplHash 仍配对), 但 env 漂了
  ok(false, 'env/ZK_GATE 不一致应该 throw, 没有throw — 说明只验了 ZK_GATE 内部自洽, finding①的洞还在');
} catch (e) {
  ok(/跨源漂移/.test(e.message), `env≠ZK_GATE 正确拒绝(不是"ZK_GATE 自己新鲜就放行"的假安全感): ${e.message.slice(0, 90)}...`);
}
if (prevEnvVal === undefined) delete process.env.ZK_GATE_TMPL_HASH; else process.env.ZK_GATE_TMPL_HASH = prevEnvVal;

console.log('[test] ⑥ force:true 绕开 ZK_PROVE_WORKER_ENABLED 门(finding②MED 修复验证,genesis-bake 三个调用点用这个):');
_resetVerifiedForTest();
const prevEnabled2 = process.env.ZK_PROVE_WORKER_ENABLED;
delete process.env.ZK_PROVE_WORKER_ENABLED; // 模拟 proving 在 A 机/dispatch 在 B 机, B 机 flag=OFF 的分机部署场景
let forceRan = false;
try {
  ensureGateTmplHashFresh({ imageId: ZK_GATE.imageId, gateTmplHash: '00'.repeat(32) }, kaspaZk, { force: true });
} catch (e) { forceRan = /配置漂移/.test(e.message); }
ok(forceRan, 'force:true 时即使 flag 未设也真的执行了检查(用错配对值验证抛错, 证明没有被 flag 挡住 no-op)');
_resetVerifiedForTest();
if (prevEnabled2 === undefined) delete process.env.ZK_PROVE_WORKER_ENABLED; else process.env.ZK_PROVE_WORKER_ENABLED = prevEnabled2;

console.log(fails === 0
  ? '\n✅✅ ALL PASS — gateTmplHash 跟当前 imageId 配对新鲜, 两条切法路径一致, 跨源(env↔ZK_GATE)一致性+force 绕开门 均验证通过'
  : `\n❌ ${fails} assertions failed — gateTmplHash 配置漂移或切法分叉, 不能当 D-009 解除证据`);
process.exit(fails === 0 ? 0 : 1);
