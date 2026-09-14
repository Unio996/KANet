// run.mjs — 复现 docs/2026-09-14-j2-ktt-bin-template-lock-fix-design-v0.1.md §2/§3 的全部数字。
// Run(从 kasia-console 目录跑): cd kasia-console && node ../docs/provenance/2026-09-14-j2-ktt-template-lock-fix-bytebudget/run.mjs
import { compileSilV100, ctorBytes32V100, ctorIntV100 } from '../../../kasia-console/src/lib/pool-bshard-artifacts.mjs';
import { extractTemplateArtifact } from '../../../kasia-console/src/lib/pool-template-artifact.mjs';

const Z32 = '00'.repeat(32);
const F32 = 'ff'.repeat(32);
const byteN = (n) => ({ kind: 'byte', value: n });
const bytesN = (arr) => ({ kind: 'bytes', value: arr });

console.log('=== §2 旧设计基线(3471B, 5字节占位) ===');
const oldCtor5 = [ctorIntV100(0), ctorBytes32V100(Z32), byteN(4), byteN(0), ctorBytes32V100(Z32), ctorBytes32V100(Z32), bytesN([0xaa, 0xbb, 0xcc, 0xdd, 0xee]), ctorIntV100(5), ctorIntV100(3), ctorIntV100(3)];
const oldC = compileSilV100('./src/lib/sil-v1/KanetTestToken.sil', oldCtor5, 'KanetTestToken');
console.log('旧设计(5字节 market_tmpl_suffix): 脚本长度 =', oldC.script.length);

console.log('\n=== §2 旧设计(132字节占位, 此前唯一性研究用过的值) ===');
const oldCtor132 = [ctorIntV100(0), ctorBytes32V100(Z32), byteN(4), byteN(0), ctorBytes32V100(Z32), ctorBytes32V100(Z32), bytesN(new Array(132).fill(0)), ctorIntV100(132), ctorIntV100(3), ctorIntV100(3)];
const oldC132 = compileSilV100('./src/lib/sil-v1/KanetTestToken.sil', oldCtor132, 'KanetTestToken');
console.log('旧设计(132字节 market_tmpl_suffix): 脚本长度 =', oldC132.script.length);

console.log('\n=== §2/§3 新设计(experimental-fixed.sil): 脚本长度 + token_tmpl_hash 不变性验证 ===');
const FIXED_SIL = '../docs/provenance/2026-09-14-j2-ktt-template-lock-fix-bytebudget/KanetTestToken.experimental-fixed.sil';
function newCtor(marketHash, owner) {
  return [ctorIntV100(0), ctorBytes32V100(owner), byteN(4), byteN(0), ctorBytes32V100(Z32), ctorBytes32V100(Z32), ctorBytes32V100(marketHash), ctorIntV100(3), ctorIntV100(3)];
}
const newC1 = compileSilV100(FIXED_SIL, newCtor(Z32, Z32), 'KanetTestToken');
console.log('新设计: 脚本长度 =', newC1.script.length, 'state_layout =', JSON.stringify(newC1.state_layout));
const a1 = extractTemplateArtifact(newC1);
const newC2 = compileSilV100(FIXED_SIL, newCtor(F32, F32), 'KanetTestToken');
const a2 = extractTemplateArtifact(newC2);
console.log('hash(market_tmpl_hash/owner=Z32):', a1.expectedTemplateHashHex);
console.log('hash(market_tmpl_hash/owner=F32):', a2.expectedTemplateHashHex);
console.log('token_tmpl_hash 与 market_tmpl_hash/owner 取值无关(§3 结论)?', a1.expectedTemplateHashHex === a2.expectedTemplateHashHex);

console.log('\n净变化(新设计 - 旧设计5字节基线):', newC1.script.length - oldC.script.length, 'bytes');
