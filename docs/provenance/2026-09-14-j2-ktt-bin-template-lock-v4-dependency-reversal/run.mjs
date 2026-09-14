// run.mjs — 复现候选④(依赖反转)设计文档 v0.2 里的全部实测数字。
// Run(从 kasia-console 目录跑): cd kasia-console && node ../docs/provenance/2026-09-14-j2-ktt-bin-template-lock-v4-dependency-reversal/run.mjs
import { compileSilV100, ctorBytes32V100, ctorIntV100 } from '../../../kasia-console/src/lib/pool-bshard-artifacts.mjs';
import { extractTemplateArtifact } from '../../../kasia-console/src/lib/pool-template-artifact.mjs';

const Z32 = '00'.repeat(32);
const F32 = 'ff'.repeat(32);
const byteN = (n) => ({ kind: 'byte', value: n });

const DIR = '../docs/provenance/2026-09-14-j2-ktt-bin-template-lock-v4-dependency-reversal';
const M_SIL = `${DIR}/ShardLeaf_direct.v4-tokenhash-in-state.sil`;
const KTT_SIL = `${DIR}/KanetTestToken.v4-ctorbaked.sil`;

console.log('=== (b) M(ShardLeaf_direct)自身模板 hash 与 token_tmpl_hash(现为 State)取值无关 ===');
function mCtor(tokenHash) {
  return [ctorBytes32V100(Z32), ctorBytes32V100(Z32), ctorBytes32V100(Z32), ctorIntV100(2), ctorIntV100(1), ctorBytes32V100(Z32), ctorBytes32V100(Z32), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorBytes32V100(tokenHash)];
}
const mC1 = compileSilV100(M_SIL, mCtor(Z32), 'ShardLeaf_direct');
const mC2 = compileSilV100(M_SIL, mCtor(F32), 'ShardLeaf_direct');
console.log('M 脚本长度:', mC1.script.length, '(原始占位版本约 15687-15690)');
const mA1 = extractTemplateArtifact(mC1);
const mA2 = extractTemplateArtifact(mC2);
console.log('M_hash(token_tmpl_hash=Z32):', mA1.expectedTemplateHashHex);
console.log('M_hash(token_tmpl_hash=F32):', mA2.expectedTemplateHashHex);
console.log('M 自身模板 hash 恒定?', mA1.expectedTemplateHashHex === mA2.expectedTemplateHashHex);
const M_HASH = mA1.expectedTemplateHashHex; // 用这个真实 M_hash 往下编 KTT_M

console.log('\n=== (a) KTT_M ctor 烤该市场 M_hash, 两个不同市场产出不同模板 hash(代币不互通, 预期如此) ===');
function kttCtor(mHash, plen, slen) {
  return [ctorIntV100(0), ctorBytes32V100(Z32), byteN(4), byteN(0), ctorBytes32V100(Z32), ctorBytes32V100(Z32), ctorBytes32V100(mHash), ctorIntV100(plen), ctorIntV100(slen), ctorIntV100(3), ctorIntV100(3)];
}
const kttReal = compileSilV100(KTT_SIL, kttCtor(M_HASH, mA1.templatePrefix.length, mA1.templateSuffix.length), 'KanetTestToken');
console.log('KTT_M(真实 M_hash) 脚本长度:', kttReal.script.length);
const kttArtReal = extractTemplateArtifact(kttReal);
console.log('KTT_M(真实市场 M) hash:', kttArtReal.expectedTemplateHashHex);

const kttDecoy = compileSilV100(KTT_SIL, kttCtor(F32, 1, 100), 'KanetTestToken'); // 假想"市场B"(不同 hash/长度)
const kttArtDecoy = extractTemplateArtifact(kttDecoy);
console.log('KTT_M(假想市场B) hash:', kttArtDecoy.expectedTemplateHashHex);
console.log('两个市场的 KTT_M 模板 hash 不同(代币不可跨市场互转)?', kttArtReal.expectedTemplateHashHex !== kttArtDecoy.expectedTemplateHashHex);

console.log('\n=== (c) 字节预算小结 ===');
console.log('原始(旧②设计, byte[] witness) KTT: 5359 B（v1，已作废）');
console.log('② 修正版(int 长度, State 存 market_tmpl_hash) KTT: 4697 B');
console.log('④ 依赖反转版(ctor 烤 market_tmpl_hash, 无 witness) KTT_M:', kttReal.script.length, 'B');
console.log('M(ShardLeaf_direct, token_tmpl_hash 挪 State):', mC1.script.length, 'B (原始占位版本约 15687-15690 B)');
