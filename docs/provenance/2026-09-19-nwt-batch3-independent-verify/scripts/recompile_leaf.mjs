// NWT: 用 pinned silverc-v100(3ed9733, sha 4378ba65…)独立重编 ShardLeaf_direct, 与链上 redeem 逐字节比; 落 ABI。
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { blake2b } from '@noble/hashes/blake2b';
import { parsePushes } from './decode_pushes.mjs';
const SC = 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';
const sha = createHash('sha256').update(readFileSync(SC)).digest('hex');
if (sha !== '4378ba6557f7b7b088d6ad7a400422acb51a7ffd04f86ed974055c4177ef8643') throw new Error('silverc sha mismatch ' + sha);
console.log('silverc sha256 OK', sha);
const j = JSON.parse(readFileSync('D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/onchain_txs.json', 'utf8'));
const tx = j['e2c45b328b9a47bf315f09dc3d7873e4278beb4fe5f46ce3bd9d839baa6924c8'].tx;
const ps = parsePushes(tx.inputs[0].signatureScript);
const onchainRedeem = ps[8].data;
const rcPrefix = ps[1].data, rcSuffix = ps[2].data;
const rcTmplHash = Buffer.from(onchainRedeem.subarray(14157, 14157 + 32)); // baked in on-chain redeem (my blake2b(prefix||suffix) guess was wrong def)
console.log('rootclose_tmpl_hash (读自链上 redeem 烘焙位 [14157,14189), 非自算 blake2b) =', rcTmplHash.toString('hex'));
const anchors = JSON.parse(readFileSync('D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scripts/proto-v0-template-anchors.json', 'utf8'));
const B = (h) => ({ kind: 'bytes', value: [...Buffer.from(h, 'hex')] });
const I = (n) => ({ kind: 'int', value: n });
const marketId = 'a2'.repeat(32);
const ctor = [B(marketId), B('73f79f9eebbbfc94f945d7578c398d155b2d7e4cb3a176346e6069c8a9b2a919'), B(marketId), I(2), I(1), B(rcTmplHash.toString('hex')), B('00'.repeat(32)),
  B('225ebcdec51f5439326e6bc48e47c288ceacbd3bea07aea6771548eeed44d80e'), I(1), I(999), I(2), I(1000), I(14746)];
writeFileSync('ctor_leaf.json', JSON.stringify(ctor));
execFileSync(SC, ['D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/src/lib/ShardLeaf_direct.sil', '--ctor', 'ctor_leaf.json', '-o', 'leaf_out.json'], { stdio: 'pipe' });
const o = JSON.parse(readFileSync('leaf_out.json', 'utf8'));
const c = o.contracts.ShardLeaf_direct;
const bytecode = Buffer.from(c.compiled.bytecode);
console.log('recompiled len', bytecode.length, 'on-chain redeem len', onchainRedeem.length, 'BYTE-EQUAL =', bytecode.equals(onchainRedeem));
console.log('entries:', Object.keys(c.entries));
const e = c.entries.convert_to_rootclose;
console.log('convert_to_rootclose dispatch_tag', e.dispatch_tag, 'params:', e.params.map(p => `${p.name}:${JSON.stringify(p.type)}`).join(' | '));
console.log('on-chain tag push', ps[7].data.toString('hex'));
// diff positions
const diffs = []; for (let i = 0; i < bytecode.length; i++) if (bytecode[i] !== onchainRedeem[i]) diffs.push(i);
console.log('diff byte count', diffs.length, 'first', diffs.slice(0, 5), 'last', diffs.slice(-3));
if (diffs.length) { const a = Math.max(0, diffs[0] - 4); console.log('mine   ', bytecode.subarray(a, diffs[0] + 40).toString('hex')); console.log('onchain', onchainRedeem.subarray(a, diffs[0] + 40).toString('hex')); }
