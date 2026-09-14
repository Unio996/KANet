// proto-v0-template-anchors.mjs — 一次性协议常量计算脚本(J2 2026-09-14, 设计
// docs/2026-09-14-j2-proto-v0-backend-api-design-v0.1.md §4 + covenant construction spec §2)。
//
// 🔴 范围裁定(Bettor 复核 2026-09-14, 见 docs/provenance/2026-09-14-j2-template-tail-anchor-uniqueness/):
// 本脚本原计划产出 market_tmpl_suffix/token_tmpl_hash/claim_tmpl_hash/refundclaim_tmpl_hash 四项——
// 实测证伪("协议常量, 编译一次全市场复用"这条假设对这四项都不成立, 它们的编译产物会随
// shard_pool_id/min_bet/rootclose_tmpl_hash 等逐市场字段变化, 见上述 provenance 的逐字段隔离测试)。
// **本脚本范围收窄为只出两类真正验证过的东西**：
//   ① `ps_tmpl_hash`(PoolSideTicket 的 template hash)——唯一被实测证实"无 ctor-only 字段、天然
//      invariant"的协议常量(该合约 4 个 ctor 参数全是 State, 见 provenance ①)。
//   ② `feeProfile[kind]`——各 kind 的 mass 实验结果(genesisOutputValue/requiredFeeAtOptimum/
//      minNetLoss/cap), 目前只有 market_genesis 一个 kind 跑过实验(见
//      docs/provenance/2026-09-14-j2-proto-v0-genesis-mass-fee-estimate/)。
// market_tmpl_suffix/token_tmpl_hash/claim_tmpl_hash/refundclaim_tmpl_hash 不进本文件——它们要么
// 挪进 market_genesis 内部按市场现算(claim_tmpl_hash/refundclaim_tmpl_hash, 同 rootclose_tmpl_hash
// 一个套路), 要么整个"sigScript 尾匹配"机制本身正在被红队(NWT (1395))推翻重新设计
// (market_tmpl_suffix, 见 docs/2026-09-14-j2-proto-v0-covenant-construction-spec-v0.1.md §7
// T-PROTO-TEMPLATE-CONST-ASSUMPTION-CORRECTED)。
//
// Run(从仓库根目录跑, 借 kasia-console 已装好的 kaspa-wasm/silverc 依赖):
//   node scripts/proto-v0-template-anchors.mjs
// 产出: kasia-console/scripts/proto-v0-template-anchors.json
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { compileSilV100, ctorBytes32V100, ctorIntV100 } from '../kasia-console/src/lib/pool-bshard-artifacts.mjs';
import { extractTemplateArtifact } from '../kasia-console/src/lib/pool-template-artifact.mjs';

const POOL_SIDE_TICKET_SIL = './kasia-console/src/lib/sil-v1/PoolSideTicket.sil';
const Z32 = '00'.repeat(32);

console.log('=== ① PoolSideTicket.ps_tmpl_hash(唯一已证协议常量) ===');
// 占位值任意——4 个 ctor 参数全是 State(bettorPk/direction/stake/shardPoolId), extractTemplateArtifact
// 排除的正是这个区域, 模板 hash 与具体值无关(provenance ①/⑤ 已实测两组截然不同占位值得到同一 hash)。
const psCtor = [ctorBytes32V100(Z32), ctorIntV100(0), ctorIntV100(0), ctorBytes32V100(Z32)];
const psCompiled = compileSilV100(POOL_SIDE_TICKET_SIL, psCtor, 'PoolSideTicket');
const psArtifact = extractTemplateArtifact(psCompiled);
const psSourceSha256 = createHash('sha256').update(readFileSync(POOL_SIDE_TICKET_SIL)).digest('hex');
console.log('ps_tmpl_hash:', psArtifact.expectedTemplateHashHex);
console.log('PoolSideTicket.sil sha256(源码漂移检测用):', psSourceSha256);

console.log('\n=== ② feeProfile[market_genesis](来自既有 mass 实验 provenance) ===');
// 数值来源: docs/provenance/2026-09-14-j2-proto-v0-genesis-mass-fee-estimate/README.md
// U 形曲线全局最优点: genesisOutputValue=20,000,000 sompi(0.2 KAS), 此时 required_fee 恰好也是
// 20,000,000 sompi, net_loss(理论最小)=40,000,000 sompi(0.4 KAS)。cap 按 Bettor 1386 原始裁定
// "genesis 取 U 形最优点 v=0.2 KAS、cap=0.8 KAS"(2× 最小值留安全余量, 同 validateNetLoss 既有
// "required_fee×2"的留余量精神一致)——写死 80,000,000 sompi, 不是"三个候选值待定"了。
const feeProfile = {
  market_genesis: {
    genesisOutputValue: '20000000',
    requiredFeeAtOptimum: '20000000',
    minNetLoss: '40000000',
    cap: '80000000',
    _source: 'docs/provenance/2026-09-14-j2-proto-v0-genesis-mass-fee-estimate/README.md + Bettor 1386 裁定(cap=2×minNetLoss)',
  },
  // bet_mint 步骤 A(KTT genesis)/步骤 B(register_append)尚未跑 mass 实验——Bettor 1386③
  // "不假设一样, 每 kind 单独跑一遍"——下一步任务, 跑完后在这里补两个 key, 不预填占位值。
};

const out = {
  _comment: '一次性协议常量, 范围裁定见本脚本文件头注(2026-09-14) — market_tmpl_suffix/token_tmpl_hash/claim_tmpl_hash/refundclaim_tmpl_hash 不在此文件, 已挪出本脚本范围。',
  generatedAt: new Date().toISOString(),
  contracts: {
    PoolSideTicket: {
      sourcePath: 'src/lib/sil-v1/PoolSideTicket.sil',
      sourceSha256: psSourceSha256,
      templatePrefixHex: psArtifact.templatePrefix.toString('hex'),
      templateSuffixHex: psArtifact.templateSuffix.toString('hex'),
      ps_tmpl_hash: psArtifact.expectedTemplateHashHex,
    },
  },
  feeProfile,
};

const OUT_PATH = './kasia-console/scripts/proto-v0-template-anchors.json';
writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
console.log('\n写入', OUT_PATH);
