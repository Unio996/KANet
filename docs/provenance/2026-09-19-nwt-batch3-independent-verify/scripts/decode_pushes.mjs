// NWT 独立脚本解析器: 自写 Kaspa script push 解析(不用 J2 编码器, 不用 kaspa ScriptBuilder), 只解析。
import { readFileSync } from 'node:fs';
export function parsePushes(hex) {
  const b = Buffer.from(hex, 'hex'); const out = []; let i = 0;
  while (i < b.length) {
    const op = b[i++];
    if (op === 0x00) out.push({ kind: 'OP_0', data: Buffer.alloc(0) });
    else if (op >= 0x01 && op <= 0x4b) { out.push({ kind: 'push', data: b.subarray(i, i + op), hdr: 1 }); i += op; }
    else if (op === 0x4c) { const n = b[i]; i += 1; out.push({ kind: 'PUSHDATA1', data: b.subarray(i, i + n) }); i += n; }
    else if (op === 0x4d) { const n = b.readUInt16LE(i); i += 2; out.push({ kind: 'PUSHDATA2', data: b.subarray(i, i + n) }); i += n; }
    else if (op === 0x4e) { const n = b.readUInt32LE(i); i += 4; out.push({ kind: 'PUSHDATA4', data: b.subarray(i, i + n) }); i += n; }
    else if (op === 0x4f) out.push({ kind: 'OP_1NEGATE', data: Buffer.from([0x81]) });
    else if (op >= 0x51 && op <= 0x60) out.push({ kind: 'OP_' + (op - 0x50), small: op - 0x50, data: Buffer.from([op - 0x50]) });
    else throw new Error(`non-push opcode 0x${op.toString(16)} at ${i - 1}`);
  }
  return out;
}
// Script number (LE sign-magnitude) decode
export function scriptNum(p) {
  if (p.kind === 'OP_0') return 0n;
  if (p.kind === 'OP_1NEGATE') return -1n;
  if (p.small !== undefined) return BigInt(p.small);
  const d = p.data; if (!d.length) return 0n;
  let v = 0n; for (let k = d.length - 1; k >= 0; k--) v = (v << 8n) | BigInt(k === d.length - 1 ? d[k] & 0x7f : d[k]);
  return (d[d.length - 1] & 0x80) ? -v : v;
}
if (process.argv[1] && process.argv[1].endsWith('decode_pushes.mjs')) {
  const j = JSON.parse(readFileSync(new URL('./onchain_txs.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 'utf8'));
  const id = process.argv[2] || 'e2c45b328b9a47bf315f09dc3d7873e4278beb4fe5f46ce3bd9d839baa6924c8';
  const tx = j[id].tx;
  console.log('keys', Object.keys(tx), 'block', j[id].blockHash);
  console.log('version', tx.version, 'lockTime', tx.lockTime, 'inputs', tx.inputs.length, 'outputs', tx.outputs.length);
  tx.inputs.forEach((inp, n) => {
    const sh = inp.signatureScript;
    console.log(`in[${n}] prev=${inp.previousOutpoint.transactionId.slice(0,12)}:${inp.previousOutpoint.index} seq=${inp.sequence} sigScriptLen=${sh.length/2}`);
    try {
      const ps = parsePushes(sh);
      ps.forEach((p, k) => console.log(`   push[${k}] ${p.kind} len=${p.data.length} ${p.data.length <= 40 ? p.data.toString('hex') : p.data.subarray(0,16).toString('hex') + '…'}`));
    } catch (e) { console.log('   parse error', e.message); }
  });
  tx.outputs.forEach((o, n) => console.log(`out[${n}] value=${o.value} spk=${(o.scriptPublicKey.scriptPublicKey||o.scriptPublicKey.script||JSON.stringify(o.scriptPublicKey)).toString().slice(0,80)} cov=${JSON.stringify(o.covenant||null)}`));
}
