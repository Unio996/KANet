import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { blake2b } = require('D:/kanet-tn12/scratch/_j2_wt_broker_optional/kasia-console/node_modules/@noble/hashes/blake2b.js');
const hex = (a) => Buffer.from(a).toString('hex');
const p2sh = (bytecode) => 'aa20' + hex(blake2b(Uint8Array.from(bytecode), { dkLen: 32 })) + '87';

const derive = (f) => {
  const c = Object.values(JSON.parse(fs.readFileSync(f, 'utf8')).contracts)[0].compiled;
  const bc = c.bytecode;
  const { offset, len } = c.state_span;
  return { template_hash: hex(c.template_hash), prefix: hex(bc.slice(0, offset)), suffix: hex(bc.slice(offset + len)), spk: p2sh(bc) };
};
const A = derive('TokenStub_A.compiled.json');
const B = derive('TokenStub_B.compiled.json');
const X = derive('TokenStub_X.compiled.json');
if (A.template_hash !== B.template_hash || A.prefix !== B.prefix || A.suffix !== X.suffix) throw new Error('template invariance broken');
console.log('template invariance OK across A/B/X');
fs.writeFileSync('token_stub.derived.json', JSON.stringify({ A, B, X }, null, 2));
console.log('prefix', A.prefix, 'len', A.prefix.length / 2);
console.log('suffix', A.suffix, 'len', A.suffix.length / 2);
console.log('template_hash', A.template_hash);
