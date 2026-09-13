// T1 (2026-09-13, J2): 复用 mk_p12.mjs 已验证的 P2SH 派生公式 —— aa20<blake2b(bytecode,32)>87.
// 算法自检对照 P8 RootStub 存档(同 mk_p12.mjs), 确认公式没抄错。
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { blake2b } = require('D:/kanet-tn12/scratch/_j2_wt_broker_optional/kasia-console/node_modules/@noble/hashes/blake2b.js');
const hex = (a) => Buffer.from(a).toString('hex');
const p2sh = (bytecode) => 'aa20' + hex(blake2b(Uint8Array.from(bytecode), { dkLen: 32 })) + '87';

const p8 = JSON.parse(fs.readFileSync('D:/kanet-tn12/docs/provenance/2026-09-13-j2-p8-foldnode-seal-double-count/rootstub_B.derived.json', 'utf8'));
const p8spk = p2sh(Buffer.from(p8.prefix + p8.state + p8.suffix, 'hex'));
if (p8spk !== p8.p2sh_spk_hex) throw new Error(`P2SH 算法自检失败: ${p8spk} != ${p8.p2sh_spk_hex}`);
console.log('P2SH 算法自检 OK (对照 P8 RootStub)');

const derive = (f) => {
  const c = Object.values(JSON.parse(fs.readFileSync(f, 'utf8')).contracts)[0].compiled;
  const bc = c.bytecode;
  const { offset, len } = c.state_span;
  return {
    template_hash: hex(c.template_hash),
    prefix: hex(bc.slice(0, offset)),
    state: hex(bc.slice(offset, offset + len)),
    suffix: hex(bc.slice(offset + len)),
    spk: p2sh(bc),
    bytecode_len: bc.length,
    state_span: c.state_span,
  };
};

const dM = derive('ClaimStub2_M.compiled.json');
const dX = derive('ClaimStub2_X.compiled.json');
if (dM.template_hash !== dX.template_hash || dM.prefix !== dX.prefix || dM.suffix !== dX.suffix) {
  throw new Error('ClaimStub2 模板不稳定(prefix/suffix/template_hash 应在不同 ctor 状态值间保持不变, P11/P12 已证的不变量)');
}
console.log('template invariance OK: M and X share prefix/suffix/template_hash (differ only in state)');
fs.writeFileSync('claim_stub2.derived.json', JSON.stringify({ M: dM, X: dX }, null, 2));
console.log('template_hash', dM.template_hash);
console.log('prefix', dM.prefix, 'len', dM.prefix.length / 2);
console.log('suffix', dM.suffix, 'len', dM.suffix.length / 2);
console.log('spk M', dM.spk);
console.log('spk X', dX.spk);
