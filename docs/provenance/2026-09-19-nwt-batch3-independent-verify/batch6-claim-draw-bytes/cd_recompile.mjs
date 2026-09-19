// NWT: claim_draw(链上) 的 RootClaim redeem 与 PoolSideTicket redeem 用 pinned silverc-v100 独立重编, 逐字节对链上; 落 ABI(顺序/tag)。
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parsePushes } from './decode_pushes.mjs';
const D = 'D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/';
const SC = 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';
if (createHash('sha256').update(readFileSync(SC)).digest('hex') !== '4378ba6557f7b7b088d6ad7a400422acb51a7ffd04f86ed974055c4177ef8643') throw new Error('silverc sha mismatch');
const LIB = 'D:/kanet-tn12/scratch/_nwt_wt_j2_7f1e339b/kasia-console/src/lib/';
const T = JSON.parse(readFileSync(D + 'claimdraw_txs.json', 'utf8'));
const tx = T['0c1d966659fbb7cbc388a42a15ac05429f2ffdf4ae8088b39eeb324295c8c06f'];
const B = (h) => ({ kind: 'bytes', value: [...Buffer.from(h, 'hex')] }); const I = (n) => ({ kind: 'int', value: Number(n) });
const PS = '73f79f9eebbbfc94f945d7578c398d155b2d7e4cb3a176346e6069c8a9b2a919', TOK = '225ebcdec51f5439326e6bc48e47c288ceacbd3bea07aea6771548eeed44d80e';
function compile(sil, ctor, name, tag) { writeFileSync(D + `cd_ctor_${tag}.json`, JSON.stringify(ctor)); execFileSync(SC, [sil, '--ctor', D + `cd_ctor_${tag}.json`, '-o', D + `cd_out_${tag}.json`], { stdio: 'pipe' }); return JSON.parse(readFileSync(D + `cd_out_${tag}.json`, 'utf8')).contracts[name]; }
const abiLine = (c, ent) => `${ent}: tag=${c.entries[ent].dispatch_tag} params=${c.entries[ent].params.map((p) => p.name + ':' + p.type.kind).join(', ')}`;
// ---- RootClaim (input 0)
{
  const ps = parsePushes(tx.inputs[0].signatureScript); const redeem = ps[ps.length - 1].data;
  let i = 1; const ints = []; for (let k = 0; k < 6; k++) { if (redeem[i] !== 8) throw new Error('marker'); ints.push(redeem.readBigInt64LE(i + 1)); i += 9; }
  if (redeem[i] !== 0x20) throw new Error('root marker'); const root = redeem.subarray(i + 1, i + 33).toString('hex'); i += 33;
  if (redeem[i] !== 8) throw new Error('bitmap marker'); const bitmap = redeem.readBigInt64LE(i + 1);
  const c32 = new Map(); let j = 0; while (j < redeem.length) { const op = redeem[j]; if (op >= 1 && op <= 0x4b) { if (op === 32) c32.set(redeem.subarray(j + 1, j + 33).toString('hex'), j); j += 1 + op; } else j += 1; }
  const unknown = [...c32.keys()].filter((h) => h !== PS && h !== TOK && h !== root && !/^0+$/.test(h));
  console.log('RootClaim redeem', redeem.length, 'B state ints', ints.map(String).join(','), 'bitmap', String(bitmap), 'unknown 32B consts', unknown.length);
  let ok = false;
  for (const [mkt, clm] of [[unknown[0], unknown[1]], [unknown[1], unknown[0]]]) {
    if (!mkt || !clm) continue;
    const c = compile(LIB + 'RootClaim.sil', [B(PS), B(mkt), ...ints.map(I), B(root), I(bitmap), B(TOK), B(clm)], 'RootClaim', 'rc');
    const bc = Buffer.from(c.compiled.bytecode); const eq = bc.equals(redeem);
    console.log(`  try [shard_pool_id=${mkt.slice(0, 8)}, claim_tmpl=${clm.slice(0, 8)}] len ${bc.length} BYTE-EQUAL = ${eq}`);
    if (eq) { ok = true; console.log('  ABI', abiLine(c, 'claim_draw')); console.log('  on-chain tag push', ps[ps.length - 2].data.toString('hex')); writeFileSync(D + 'cd_rootclaim_ctor.json', JSON.stringify([PS, mkt, ints.map(String), root, String(bitmap), TOK, clm])); break; }
  }
  if (!ok) console.log('  NO MATCH');
}
// ---- PoolSideTicket (input 1)
{
  const ps = parsePushes(tx.inputs[1].signatureScript); const redeem = ps[ps.length - 1].data;
  const bettorPk = redeem.subarray(2, 34).toString('hex'); // 6b 20 <32B> ...
  const st = JSON.parse(readFileSync(D + 'cd_rootclaim_ctor.json', 'utf8'));
  // direction/stake/shardPoolId: state fields 后续: 08 direction 08 stake 20 shardPoolId
  let i = 34; const dir = redeem[i] === 8 ? redeem.readBigInt64LE(i + 1) : null; i += 9; const stake = redeem[i] === 8 ? redeem.readBigInt64LE(i + 1) : null; i += 9;
  const shard = redeem[i] === 0x20 ? redeem.subarray(i + 1, i + 33).toString('hex') : null;
  console.log('\nTicket redeem', redeem.length, 'B bettorPk', bettorPk.slice(0, 8) + '…', 'direction', String(dir), 'stake', String(stake), 'shardPoolId==RootClaim.shard_pool_id', shard === st[1]);
  const c = compile(LIB + 'sil-v1/PoolSideTicket.sil', [B(bettorPk), I(dir), I(stake), B(shard)], 'PoolSideTicket', 'tk');
  const bc = Buffer.from(c.compiled.bytecode); console.log('  ticket recompile len', bc.length, 'BYTE-EQUAL =', bc.equals(redeem)); console.log('  ABI', abiLine(c, 'authorize_spend'), ' on-chain tag push', ps[1].data.toString('hex'));
  writeFileSync(D + 'cd_ticket_ctor.json', JSON.stringify([bettorPk, String(dir), String(stake), shard]));
}
