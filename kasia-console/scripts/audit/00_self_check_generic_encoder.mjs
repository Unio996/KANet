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

// 🔴 账本1473自我纠错(初版自检曾是假阳性): encodeRegisterAppendAction/encodeEntryActionGeneric
// 两者都返回kaspa.ScriptBuilder.drain()的原始返回值——真实实测drain()返回hex字符串(无0x前缀),
// 不是字节。初版自检把两边都套了一层`Buffer.from(...)`(把hex字符串当UTF8文本编码), 两边用
// 同一种错误方式变形, 恰好互相吻合, PASS是假的。修复: 直接比较两个hex字符串本身, 不做任何
// Buffer转换。
const specific = encodeRegisterAppendAction(kaspa, entryAbi, w);
const generic = encodeEntryActionGeneric(kaspa, entryAbi, w);

console.log('specific.length(hex chars)', specific.length, 'generic.length(hex chars)', generic.length);
console.log('typeof specific', typeof specific, 'typeof generic', typeof generic);
if (specific === generic) {
  console.log('✅ PASS: 通用编码器与已验证的register_append专用编码器逐字符(hex字符串)一致');
  process.exit(0);
} else {
  console.log('❌ FAIL: 不一致!');
  console.log('specific hex head:', specific.slice(0, 120));
  console.log('generic  hex head:', generic.slice(0, 120));
  process.exit(1);
}
