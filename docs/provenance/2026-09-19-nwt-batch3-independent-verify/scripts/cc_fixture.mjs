// NWT 批4离线审: 造 RootClose.close_commit 的 cli-debugger 夹具(上游 VM 作裁判), 一次性测试密钥(仅本地, 不落盘私钥)。
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { blake2b } from '@noble/hashes/blake2b';
import { blake3 } from '@noble/hashes/blake3';
const kaspa = await import('kaspa-wasm');
const D = 'D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/';
export const priv = new kaspa.PrivateKey(randomBytes(32).toString('hex'));
export const pk = priv.toPublicKey().toXOnlyPublicKey().toString();
const H = (b) => '0x' + Buffer.from(b).toString('hex');
const len8 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const tokPrefix = Buffer.from([0x01]), tokSuffix = Buffer.from([0x02]);
const tokTmpl = Buffer.from(blake3(Buffer.concat([len8(tokPrefix.length), tokPrefix, len8(tokSuffix.length), tokSuffix])));
const committeeHash = Buffer.from(blake2b(Buffer.concat(Array(5).fill(Buffer.from(pk, 'hex'))), { dkLen: 32 }));
export const DEADLINE = 1789809900050;
const ctor = (closed, win, root) => [H(committeeHash), DEADLINE, H(Buffer.alloc(32, 0x11)), H(Buffer.alloc(32, 0x22)), H(tokTmpl), 1, 999, 2, 1000, closed, win, H(root)];
export const NEW_ROOT = Buffer.alloc(32, 0x77);
export function fixture({ sigs, covenantOnOutput = true, lockTime = DEADLINE, name = 'nwt_cc' }) {
  return { tests: [{ name, function: 'close_commit', constructor_args: ctor(0, 0, Buffer.alloc(32)),
    args: [H(Buffer.from(pk, 'hex')), H(Buffer.from(pk, 'hex')), H(Buffer.from(pk, 'hex')), H(Buffer.from(pk, 'hex')), H(Buffer.from(pk, 'hex')), ...sigs, 0, 1, H(NEW_ROOT), H(tokPrefix), H(tokSuffix)],
    expect: 'pass',
    tx: { version: 1, lock_time: lockTime, active_input_index: 0,
      inputs: [{ utxo_value: 20000000, sequence: 0, covenant_id: 'ab'.repeat(32) }, { utxo_value: 95000000, sequence: 0 }],
      outputs: [{ value: 20000000, ...(covenantOnOutput ? { covenant_id: 'ab'.repeat(32), authorizing_input: 0 } : {}), constructor_args: ctor(1, 1, NEW_ROOT) }] } }] };
}
if ((process.argv[1] ?? '').endsWith('cc_fixture.mjs')) {
  writeFileSync(D + 'cc_dummy.json', JSON.stringify(fixture({ sigs: Array(5).fill('0x' + '00'.repeat(65)) })));
  console.log('pk', pk, 'fixture written');
}
