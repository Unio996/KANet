// NWT 批7 withdraw: 链上 KanetTokenClaim / held KTT / 新代币输出 的 redeem 用 pinned silverc-v100 独立重编, 逐字节对链上;
// 并用 blake2b256(redeem) 对 claim_draw(父交易)输出 spk 与 withdraw 自身 out[0] spk 做独立 P2SH 核对。落 ABI(顺序/tag)。
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { blake2b } from '@noble/hashes/blake2b';
import { parsePushes } from './decode_pushes.mjs';
const D = 'D:/kanet-tn12/scratch/_nwt_wt_batch3_review/kasia-console/scratch/_nwt_batch3/';
const SC = 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';
if (createHash('sha256').update(readFileSync(SC)).digest('hex') !== '4378ba6557f7b7b088d6ad7a400422acb51a7ffd04f86ed974055c4177ef8643') throw new Error('silverc sha mismatch');
const LIB = 'D:/kanet-tn12/scratch/_nwt_wt_j2_7f1e339b/kasia-console/src/lib/';
const T = JSON.parse(readFileSync(D + 'withdraw_txs.json', 'utf8'));
const tx = T['39f4f2c6a0070b183fa7e5ffb241974b19db3b4346790ff4dfc1ab901c1ae508'];
const B = (h) => ({ kind: 'bytes', value: [...Buffer.from(h, 'hex')] }); const I = (n) => ({ kind: 'int', value: Number(n) }); const BY = (n) => ({ kind: 'byte', value: n });
const ZERO = '00'.repeat(32);
function compile(sil, ctor, name, tag) { writeFileSync(D + `wd_ctor_${tag}.json`, JSON.stringify(ctor)); execFileSync(SC, [sil, '--ctor', D + `wd_ctor_${tag}.json`, '-o', D + `wd_out_${tag}.json`], { stdio: 'pipe' }); return JSON.parse(readFileSync(D + `wd_out_${tag}.json`, 'utf8')).contracts[name]; }
const abiLine = (c, ent) => `${ent}: tag=${c.entries[ent].dispatch_tag} params=${c.entries[ent].params.map((p) => p.name + ':' + p.type.kind).join(', ')}`;
const p2sh = (redeem) => '0000aa20' + Buffer.from(blake2b(redeem, { dkLen: 32 })).toString('hex') + '87';
const parentOut = (n) => T[tx.inputs[n].previousOutpoint.transactionId].outputs[tx.inputs[n].previousOutpoint.index];
const pushesOf = (n) => parsePushes(tx.inputs[n].signatureScript);

// ---- KanetTokenClaim (input 0): 6b 20 mkt 20 winner 08 amount 20 tok_tmpl ...
{
  const ps = pushesOf(0); const redeem = ps[ps.length - 1].data;
  if (redeem[0] !== 0x6b || redeem[1] !== 0x20) throw new Error('KTC layout: marker'); let i = 2;
  const mkt = redeem.subarray(i, i + 32).toString('hex'); i += 32; if (redeem[i] !== 0x20) throw new Error('winner marker'); i += 1;
  const winner = redeem.subarray(i, i + 32).toString('hex'); i += 32; if (redeem[i] !== 8) throw new Error('amount marker'); const amount = redeem.readBigInt64LE(i + 1); i += 9;
  if (redeem[i] !== 0x20) throw new Error('tok marker'); const tokTmpl = redeem.subarray(i + 1, i + 33).toString('hex');
  console.log('KTC redeem', redeem.length, 'B  market_cov_id', mkt.slice(0, 8) + '…', 'winner_pk', winner.slice(0, 8) + '…', 'amount', amount.toString(), 'token_tmpl_hash', tokTmpl.slice(0, 8) + '…');
  const c = compile(LIB + 'KanetTokenClaim.sil', [B(mkt), B(winner), I(amount), B(tokTmpl)], 'KanetTokenClaim', 'ktc');
  const bc = Buffer.from(c.compiled.bytecode);
  console.log('  KTC recompile len', bc.length, 'BYTE-EQUAL =', bc.equals(redeem));
  console.log('  ABI', abiLine(c, 'spend'), ' on-chain tag push', ps[ps.length - 2].data.toString('hex'));
  console.log('  blake2b256(redeem) P2SH == claim_draw output0 spk (parent, independent of node acceptance) =>', p2sh(redeem) === parentOut(0).scriptPublicKey);
  console.log('  KTC.market_cov_id == claim_draw.RootClaim input covenant id? (parent cov of RootClaim not in this fetch) mkt=', mkt);
  console.log('  winner_pk == PoolSideTicket bettorPk of batch-6 ticket (e929dde5…)? ', winner.startsWith('e929dde5'));
  writeFileSync(D + 'wd_ktc_ctor.json', JSON.stringify({ mkt, winner, amount: amount.toString(), tokTmpl }));
}
// ---- held KTT (input 1): ctor [amount, owner, 4, 0, ZERO, ZERO, 3, 3]
const ktcCovId = parentOut(0).covenant.covenantId;
function kttRedeem(amount, ownerHex, tag) { const c = compile(LIB + 'sil-v1/KanetTestToken.sil', [I(amount), B(ownerHex), BY(4), BY(0), B(ZERO), B(ZERO), I(3), I(3)], 'KanetTestToken', tag); return { c, bc: Buffer.from(c.compiled.bytecode) }; }
{
  const ps = pushesOf(1); const redeem = ps[ps.length - 1].data;
  if (redeem[0] !== 0x6b || redeem[1] !== 8) throw new Error('KTT layout'); const amount = redeem.readBigInt64LE(2); if (redeem[10] !== 0x20) throw new Error('owner marker');
  const owner = redeem.subarray(11, 43).toString('hex');
  console.log('\nheld KTT redeem', redeem.length, 'B amount', amount.toString(), 'owner', owner.slice(0, 8) + '…', ' owner == KTC(input0) covenant_id =>', owner === ktcCovId);
  const { c, bc } = kttRedeem(amount, owner, 'held');
  console.log('  held KTT recompile len', bc.length, 'BYTE-EQUAL =', bc.equals(redeem)); console.log('  ABI', abiLine(c, 'transfer'), ' on-chain tag push', ps[ps.length - 2].data.toString('hex'));
  console.log('  blake2b256(redeem) P2SH == claim_draw output1 spk =>', p2sh(redeem) === parentOut(1).scriptPublicKey);
}
// ---- new token output out[0]: owner MUST equal out[1] covenant_id (destination); P2SH recomputed from independent recompile
{
  const destCov = tx.outputs[1].covenant.covenantId; const { bc } = kttRedeem(1000, destCov, 'newtok');
  console.log('\nnew token out[0]: recompile KTT(amount=1000, owner=out[1].covenant_id ' + destCov.slice(0, 8) + '…) P2SH == out[0].spk =>', p2sh(bc) === tx.outputs[0].scriptPublicKey);
  const { bc: bcWrong } = kttRedeem(1000, ktcCovId, 'newtok_wrong');
  console.log('  control (owner = old KTC covenant_id instead) P2SH == out[0].spk =>', p2sh(bcWrong) === tx.outputs[0].scriptPublicKey);
  console.log('  out[0].covenant genesis auth', tx.outputs[0].covenant.authorizingInput, ' out[1].covenant genesis auth', tx.outputs[1].covenant.authorizingInput, ' (fee input idx 2; distinct covenant ids:', tx.outputs[0].covenant.covenantId !== tx.outputs[1].covenant.covenantId, ')');
  console.log('  destination out[1] spk =', tx.outputs[1].scriptPublicKey.slice(4, 12) + '…' + tx.outputs[1].scriptPublicKey.slice(-6), ' (aa20 + 32x ee + 87: hash with no known preimage => UNSPENDABLE test destination)');
}
