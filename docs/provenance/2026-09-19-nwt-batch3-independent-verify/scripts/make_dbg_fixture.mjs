import { readFileSync, writeFileSync } from 'node:fs';
import { parsePushes } from './decode_pushes.mjs';
const j = JSON.parse(readFileSync('D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/onchain_txs.json', 'utf8'));
const tx = j['e2c45b328b9a47bf315f09dc3d7873e4278beb4fe5f46ce3bd9d839baa6924c8'].tx;
const ps = parsePushes(tx.inputs[0].signatureScript);
const redeem = ps[8].data;
const rcTmpl = redeem.subarray(14157, 14157 + 32).toString('hex');
const H = (b) => '0x' + Buffer.from(b).toString('hex');
const ctor = [H(Buffer.alloc(32, 0xa2)), '0x73f79f9eebbbfc94f945d7578c398d155b2d7e4cb3a176346e6069c8a9b2a919', H(Buffer.alloc(32, 0xa2)), 2, 1, '0x' + rcTmpl, H(Buffer.alloc(32)),
  '0x225ebcdec51f5439326e6bc48e47c288ceacbd3bea07aea6771548eeed44d80e', 1, 999, 2, 1000, 14746];
const num = (p) => Number(BigInt(p.kind === 'OP_0' ? 0 : p.small));
const args = [num(ps[0]), H(ps[1].data), H(ps[2].data), num(ps[3]), num(ps[4]), H(ps[5].data), H(ps[6].data)];
const fx = { tests: [{ name: 'nwt_seal_dump', function: 'convert_to_rootclose', constructor_args: ctor, args, expect: 'fail',
  tx: { active_input_index: 0, inputs: [{ utxo_value: 60000000 }], outputs: [{ value: 20000000 }] } }] };
writeFileSync('dbg_fixture.json', JSON.stringify(fx));
console.log('fixture written; args lens', args.map(a => typeof a === 'string' ? (a.length - 2) / 2 : a));
