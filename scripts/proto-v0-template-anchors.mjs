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
// market_tmpl_suffix/claim_tmpl_hash/refundclaim_tmpl_hash 不进本文件——它们要么挪进 market_genesis
// 内部按市场现算(claim_tmpl_hash/refundclaim_tmpl_hash——RootClaim/RefundClaim 的 ctor 都烤了
// shard_pool_id=market_id 这个逐市场变化的 ctor-only 常量, 跟 rootclose_tmpl_hash 同一个套路,
// 不是协议常量), 要么整个"sigScript 尾匹配"机制本身正在被红队(NWT (1395))推翻重新设计
// (market_tmpl_suffix, 见 docs/2026-09-14-j2-proto-v0-covenant-construction-spec-v0.1.md §7
// T-PROTO-TEMPLATE-CONST-ASSUMPTION-CORRECTED)。
//
// 🔴 订正(2026-09-15, 账本1425, market_genesis落码): `token_tmpl_hash`(KanetTestToken 的 template
// hash)**重新加回本文件**——上面这段 2026-09-14 的裁定是在 H1(b) 撤销之前写的, 当时 KTT ctor 还有
// `market_tmpl_suffix`(逐市场变化的字段, 参与哈希, 确实不是协议常量)。v0.3 方案C(账本1408)删掉了
// 这个字段后, KTT 现在只剩 8 个 ctor 参数(amount/owner/owner_scheme/borrow_scheme/borrow_guard/
// extension_commitment 全是 State, 排除在哈希外; max_ins/max_outs 是协议级固定常量 3/3, 不随市场
// 变化)——`token_tmpl_hash` 现在**真的是**协议常量了(同 ps_tmpl_hash 一样, 编译一次全市场复用),
// 不再属于上面那条"逐市场变化"的裁定范围。claim_tmpl_hash/refundclaim_tmpl_hash 仍然逐市场变化
// (RootClaim/RefundClaim 的 ctor 直接烤 shard_pool_id, 不像 KTT 那样把市场相关字段全部挪进了 State),
// 继续留在 market_genesis 内部现算, 不进本文件。
//
// Run(从仓库根目录跑, 借 kasia-console 已装好的 kaspa-wasm/silverc 依赖):
//   node scripts/proto-v0-template-anchors.mjs
// 产出: kasia-console/scripts/proto-v0-template-anchors.json
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { compileSilV100, ctorBytes32V100, ctorIntV100 } from '../kasia-console/src/lib/pool-bshard-artifacts.mjs';
import { extractTemplateArtifactV100 } from '../kasia-console/src/lib/pool-template-artifact.mjs';

const POOL_SIDE_TICKET_SIL = './kasia-console/src/lib/sil-v1/PoolSideTicket.sil';
const KANET_TEST_TOKEN_SIL = './kasia-console/src/lib/sil-v1/KanetTestToken.sil';
const KANET_TOKEN_CLAIM_SIL = './kasia-console/src/lib/KanetTokenClaim.sil';
const Z32 = '00'.repeat(32);
const byteN = (n) => ({ kind: 'byte', value: n });

console.log('=== ① PoolSideTicket.ps_tmpl_hash(唯一已证协议常量) ===');
// 占位值任意——4 个 ctor 参数全是 State(bettorPk/direction/stake/shardPoolId), 模板 hash 排除的正是
// 这个区域, 与具体值无关(provenance ①/⑤ 已实测两组截然不同占位值得到同一 hash)。
// 🔴 订正(2026-09-15, 账本 1412/1413): PoolSideTicket.sil 住在 src/lib/sil-v1/, 走 compileSilV100(v1.0.0
// 编译器), 之前这里错用了 legacy extractTemplateArtifact()(blake2b 公式)——对 v1.0.0 产物是错值(J2 KTT
// v0.3 落码期间才实测撞出这条通用问题, 一并修here)。改用 extractTemplateArtifactV100(),
// 读编译器自报的 compiled.template_hash_bytes, 并自证一遍 blake3(len8LE+prefix+len8LE+suffix) 公式。
const psCtor = [ctorBytes32V100(Z32), ctorIntV100(0), ctorIntV100(0), ctorBytes32V100(Z32)];
const psCompiled = compileSilV100(POOL_SIDE_TICKET_SIL, psCtor, 'PoolSideTicket');
const psArtifact = extractTemplateArtifactV100(psCompiled);
const psSourceSha256 = createHash('sha256').update(readFileSync(POOL_SIDE_TICKET_SIL)).digest('hex');
console.log('ps_tmpl_hash(v1.0.0 权威值, compiled.template_hash_bytes):', psArtifact.templateHashHex);
console.log('PoolSideTicket.sil sha256(源码漂移检测用):', psSourceSha256);

console.log('\n=== ①b KanetTestToken.token_tmpl_hash(v0.3 方案C 后真正的协议常量) ===');
// v0.3(方案C) ctor: 8 字段, 全部要么是 State(排除在哈希外)要么是协议级固定常量(max_ins/max_outs=3/3),
// 没有任何逐市场变化的字段——占位值任意, 同 ps_tmpl_hash 的既有惯例。
const kttCtor = [ctorIntV100(0), ctorBytes32V100(Z32), byteN(4), byteN(0), ctorBytes32V100(Z32), ctorBytes32V100(Z32), ctorIntV100(3), ctorIntV100(3)];
const kttCompiled = compileSilV100(KANET_TEST_TOKEN_SIL, kttCtor, 'KanetTestToken');
const kttArtifact = extractTemplateArtifactV100(kttCompiled);
const kttSourceSha256 = createHash('sha256').update(readFileSync(KANET_TEST_TOKEN_SIL)).digest('hex');
console.log('token_tmpl_hash(v1.0.0 权威值, compiled.template_hash_bytes):', kttArtifact.templateHashHex);
console.log('KanetTestToken.sil sha256(源码漂移检测用):', kttSourceSha256);

console.log('\n=== ①c KanetTokenClaim.claim_tmpl_hash(协议常量——ctor 4 字段全是 State, 无逐市场 baked 常量) ===');
// KanetTokenClaim.sil ctor: init_market_cov_id/init_winner_pk/init_amount/init_token_tmpl_hash 全部
// init_ 前缀 = 全是 State 字段, 排除在 template_hash 哈希区域外——跟 RootClaim.sil 自己的 claim_tmpl_hash
// 字段(= 本值)不是同一件事: RootClaim/RefundClaim 的 ctor 直接烤这个值, 用来构造"新建 KanetTokenClaim
// 实例"这个输出, 而这个值本身对所有市场恒定, 是可以复用的协议常量(同 ps_tmpl_hash/token_tmpl_hash)。
const ktcCtor = [ctorBytes32V100(Z32), ctorBytes32V100(Z32), ctorIntV100(0), ctorBytes32V100(Z32)];
const ktcCompiled = compileSilV100(KANET_TOKEN_CLAIM_SIL, ktcCtor, 'KanetTokenClaim');
const ktcArtifact = extractTemplateArtifactV100(ktcCompiled);
const ktcSourceSha256 = createHash('sha256').update(readFileSync(KANET_TOKEN_CLAIM_SIL)).digest('hex');
console.log('claim_tmpl_hash(v1.0.0 权威值, compiled.template_hash_bytes):', ktcArtifact.templateHashHex);
console.log('KanetTokenClaim.sil sha256(源码漂移检测用):', ktcSourceSha256);

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
  // bet_mint 步骤 A(KTT genesis)实测: 数值与 market_genesis 逐 sompi 相同——不是"假设一样",
  // 是实测后发现的结构性原因(genesis 交易的 KIP-9 storage mass 只看输出 scriptPubKey 长度, P2SH
  // 包装的 scriptPubKey 长度恒定, 与被包装的 redeem 脚本大小无关), 见下方 _source provenance。
  bet_mint_step_a: {
    genesisOutputValue: '20000000',
    requiredFeeAtOptimum: '20000000',
    minNetLoss: '40000000',
    cap: '80000000',
    _source: 'docs/provenance/2026-09-14-j2-bet-mint-stepA-ktt-genesis-mass-fee-estimate/README.md（与 market_genesis 相同的结构性原因, 非假设照抄）',
  },
  // bet_mint 步骤 B(register_append)实测: 不是 genesis, U 形曲线最优点对续约输出的"值"同样适用
  // (KIP-9 storage mass 对 covenant 输出只看 value, 不分 genesis/续约), 但续约输出本身的 cap 与
  // genesis 不是同一件事(genesis 只算一次, 续约每次 bet 都要重付, 且要额外背 mkt_prefix/mkt_suffix
  // 这笔线性 mass 开销)——cap 数值按实测 required_fee(≈0.5992 KAS)×2 留余量, 见下方 _source。
  bet_mint_step_b: {
    leafContinuationValue: '20000000',
    kttContinuationValue: '20000000',
    minFeeInputFaceValue: '95000000', // Bettor 定案种子面值(0.95 KAS)，找零≈15,000,000（略低于 CONTINUATION_OUTPUT_SOMPI 20,000,000 干净线，实测仅多花约 0.02 KAS，Bettor 复核接受，非危险区）
    requiredFeeEstimate: '59900000', // 0.95 KAS 种子实测收敛值（迭代求解，见下方 _source）
    cap: '100000000', // 三层取最小时 GLOBAL_ABS_FEE_CAP_SOMPI(1.0 KAS)先于本 kind cap 生效，本字段仅供 console 侧调用参考
    _source: 'docs/provenance/2026-09-14-j2-bet-mint-stepB-register-append-mass-fee-estimate/README.md + Bettor 种子面值核算(2026-09-14)——注意 requiredFee 会随 fee input 实际面值/找零大小小幅浮动(迭代收敛值，非固定常数)，witness 精确编码/tok_prefix-suffix 长度未最终定案，见该 provenance 已知限制',
  },
};

const out = {
  _comment: '一次性协议常量, 范围裁定见本脚本文件头注(2026-09-14, 2026-09-15 订正) — market_tmpl_suffix/claim_tmpl_hash/refundclaim_tmpl_hash 不在此文件(逐市场变化, market_genesis 内部现算); token_tmpl_hash 2026-09-15 起重新加回(H1(b) 撤销后真正的协议常量)。',
  generatedAt: new Date().toISOString(),
  contracts: {
    PoolSideTicket: {
      sourcePath: 'src/lib/sil-v1/PoolSideTicket.sil',
      sourceSha256: psSourceSha256,
      templatePrefixHex: psArtifact.templatePrefix.toString('hex'),
      templateSuffixHex: psArtifact.templateSuffix.toString('hex'),
      ps_tmpl_hash: psArtifact.templateHashHex,
    },
    KanetTestToken: {
      sourcePath: 'src/lib/sil-v1/KanetTestToken.sil',
      sourceSha256: kttSourceSha256,
      templatePrefixHex: kttArtifact.templatePrefix.toString('hex'),
      templateSuffixHex: kttArtifact.templateSuffix.toString('hex'),
      token_tmpl_hash: kttArtifact.templateHashHex,
    },
    KanetTokenClaim: {
      sourcePath: 'src/lib/KanetTokenClaim.sil',
      sourceSha256: ktcSourceSha256,
      templatePrefixHex: ktcArtifact.templatePrefix.toString('hex'),
      templateSuffixHex: ktcArtifact.templateSuffix.toString('hex'),
      claim_tmpl_hash: ktcArtifact.templateHashHex,
    },
  },
  feeProfile,
};

const OUT_PATH = './kasia-console/scripts/proto-v0-template-anchors.json';
writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
console.log('\n写入', OUT_PATH);
