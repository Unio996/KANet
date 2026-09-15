// 自检: 通用编码器 vs 已验证过的 register_append 专用编码器, 同一组参数必须逐字节输出一致。
// 不一致 = 通用编码器有bug, 不能信它去测新entry。
import { randomBytes } from 'node:crypto';
const kaspa = await import('kaspa-wasm');
const { encodeRegisterAppendAction } = await import('../../src/lib/proto-register-append-witness.mjs');
const { encodeEntryActionGeneric } = await import('./generic-entry-witness.mjs');

const entryAbi = {
  dispatch_tag: '0x' + randomBytes(4).toString('hex'),
  params: [
    { name: 'side', type: { kind: 'int' } },
    { name: 'stake', type: { kind: 'int' } },
    { name: 'leafOutIdx', type: { kind: 'int' } },
    { name: 'psOutIdx', type: { kind: 'int' } },
    { name: 'bettorPk', type: { kind: 'fixed_bytes', len: 32 } },
    { name: 'ps_prefix', type: { kind: 'bytes' } },
    { name: 'ps_suffix', type: { kind: 'bytes' } },
    { name: 'tok_out', type: { kind: 'int' } },
    { name: 'tok_prefix', type: { kind: 'bytes' } },
    { name: 'tok_suffix', type: { kind: 'bytes' } },
  ],
};
const w = {
  side: 0, stake: 20, leafOutIdx: 0, psOutIdx: 1,
  bettorPk: '0x' + randomBytes(32).toString('hex'),
  ps_prefix: '0x' + randomBytes(5).toString('hex'), ps_suffix: '0x' + randomBytes(37).toString('hex'),
  tok_out: 2,
  tok_prefix: '0x' + randomBytes(11).toString('hex'), tok_suffix: '0x' + randomBytes(3164).toString('hex'),
};

const specific = Buffer.from(encodeRegisterAppendAction(kaspa, entryAbi, w));
const generic = encodeEntryActionGeneric(kaspa, entryAbi, w);

console.log('specific.length', specific.length, 'generic.length', generic.length);
if (Buffer.compare(specific, generic) === 0) {
  console.log('✅ PASS: 通用编码器与已验证的register_append专用编码器逐字节一致');
  process.exit(0);
} else {
  console.log('❌ FAIL: 不一致!');
  console.log('specific hex head:', specific.subarray(0, 60).toString('hex'));
  console.log('generic  hex head:', generic.subarray(0, 60).toString('hex'));
  process.exit(1);
}
