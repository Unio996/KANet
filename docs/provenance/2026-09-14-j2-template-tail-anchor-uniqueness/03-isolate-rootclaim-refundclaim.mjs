// _j2_verify_isolate_claim.mjs — 逐字段隔离测试: RootClaim/RefundClaim 的 template artifact 对哪个
// 具体 ctor 字段敏感(补全 _j2_verify_template_invariance.mjs 里"整体 NOT INVARIANT"结论的证据链)。
import { compileSilV100, ctorBytes32V100, ctorIntV100 } from '../../../kasia-console/src/lib/pool-bshard-artifacts.mjs';
import { extractTemplateArtifact } from '../../../kasia-console/src/lib/pool-template-artifact.mjs';

const Z32 = '00'.repeat(32);
const F32 = 'ff'.repeat(32);

// 字段序(RootClaim, 13 项): ps_tmpl_hash(0), shard_pool_id(1), init_local_yes(2), init_local_no(3),
//   init_count(4), init_pool_value(5), init_closed(6), init_winningSide(7), init_payoutRoot(8),
//   init_claimed_bitmap(9), token_tmpl_hash(10), claim_tmpl_hash(11), market_suffix_hash(12)
function rootClaimBaseCtor() {
  return [
    ctorBytes32V100(Z32), ctorBytes32V100(Z32),
    ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorBytes32V100(Z32), ctorIntV100(0),
    ctorBytes32V100(Z32), ctorBytes32V100(Z32), ctorBytes32V100(Z32),
  ];
}
// 字段序(RefundClaim, 12 项): ps_tmpl_hash(0), shard_pool_id(1), init_local_yes..init_payoutRoot(2-8, 7 项无 claimed_bitmap),
//   token_tmpl_hash(9), claim_tmpl_hash(10), market_suffix_hash(11)
function refundClaimBaseCtor() {
  return [
    ctorBytes32V100(Z32), ctorBytes32V100(Z32),
    ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorBytes32V100(Z32),
    ctorBytes32V100(Z32), ctorBytes32V100(Z32), ctorBytes32V100(Z32),
  ];
}

function run(name, sil, contractName, baseCtorFn, fields) {
  console.log(`\n=== ${name} 逐字段隔离 ===`);
  const baseline = extractTemplateArtifact(compileSilV100(sil, baseCtorFn(), contractName));
  console.log('baseline suffixLen=', baseline.templateSuffix.length, 'hash=', baseline.expectedTemplateHashHex);
  for (const [label, idx] of fields) {
    const ctor = baseCtorFn();
    ctor[idx] = ctorBytes32V100(F32);
    const a = extractTemplateArtifact(compileSilV100(sil, ctor, contractName));
    const same = Buffer.compare(a.templateSuffix, baseline.templateSuffix) === 0 && Buffer.compare(a.templatePrefix, baseline.templatePrefix) === 0;
    console.log(`只换 ${label} → F32: ${same ? '不变' : '变了'}`);
  }
}

run('RootClaim', './src/lib/RootClaim.sil', 'RootClaim', rootClaimBaseCtor, [
  ['ps_tmpl_hash(0)', 0], ['shard_pool_id(1)', 1], ['token_tmpl_hash(10)', 10], ['claim_tmpl_hash(11,自引用)', 11], ['market_suffix_hash(12)', 12],
]);

run('RefundClaim', './src/lib/RefundClaim.sil', 'RefundClaim', refundClaimBaseCtor, [
  ['ps_tmpl_hash(0)', 0], ['shard_pool_id(1)', 1], ['token_tmpl_hash(9)', 9], ['claim_tmpl_hash(10,自引用)', 10], ['market_suffix_hash(11)', 11],
]);
