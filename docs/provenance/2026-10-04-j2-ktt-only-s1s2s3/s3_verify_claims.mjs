// s3_verify_claims.mjs — S3 补充: 对"另一个市场"(第一次误启动的 run1 那个盘, 下注都完成了, 自治 tick 照常结算完)做与 s3_e2e.mjs 第 C 段同款的链上核实。
// 用法: node s3_verify_claims.mjs <marketShortId>   (读 s3_console_slice.log 里该盘的 claim 行)
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { relays, kaspa, rpcConnect, log } from './s3lib.mjs';
const OUT = 'D:/kanet-tn12/scratch/_j2_s3'; const WT = 'D:/kanet-tn12/scratch/_j2_wt_s12';
const shortId = process.argv[2]; if (!shortId) throw new Error('need marketShortId');
for (const l of readFileSync(`${OUT}/env.s3.simnet`, 'utf8').split('\n')) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m) process.env[m[1]] = m[2]; }
process.env.DB_PATH = `${OUT}/_artifacts_probe.db`;
const rpc = await rpcConnect();
const W = { maker: relays.maker, settler: relays.settler, fee: relays.fee, bettorA: relays.bettorA, bettorB: relays.bettorB };
const addrToName = Object.fromEntries(Object.entries(W).map(([n, r]) => [r.address, n]));
let fails = 0; const ok = (c, l) => { if (c) log('  ✅', l); else { log('  ❌', l); fails++; } };
const text = readFileSync(`${OUT}/s3_console_slice.log`, 'utf8') + '\n' + readFileSync(`${OUT}/console.log`, 'utf8');
const claimRe = new RegExp(`market=\\S*${shortId} claim idx=(\\d+) pk=([0-9a-f]+) payout=(\\d+) txId=([0-9a-f]{64})( \\(last, exhausted\\))?`, 'g');
const seen = new Map(); for (const m of text.matchAll(claimRe)) seen.set(m[4], { idx: Number(m[1]), pkPrefix: m[2], payout: BigInt(m[3]), txid: m[4], last: !!m[5] });
const claims = [...seen.values()].sort((a, b) => a.idx - b.idx);
log('claims found for', shortId, claims.length);
const need = new Set(claims.map((c) => c.txid)); const txById = new Map();
{ const info = await rpc.getBlockDagInfo(); let low = info.pruningPointHash;
  for (let pages = 0; pages < 500 && txById.size < need.size; pages++) {
    const r = await rpc.getBlocks({ lowHash: low, includeBlocks: true, includeTransactions: true }); const blocks = r.blocks || []; if (blocks.length < 2) break;
    for (const b of blocks) { for (const tx of b.transactions || []) { const id = tx.verboseData?.transactionId; if (need.has(id) && !txById.has(id)) txById.set(id, tx); } low = b.header.hash; }
  } }
const imp = (p) => import(pathToFileURL(`${WT}/kasia-console/src/${p}`).href);
const { computeKttTokenArtifact, computeKanetTokenClaimArtifact } = await imp('lib/pool-bshard-artifacts.mjs');
const p2shAddr = (h) => kaspa.addressFromScriptPublicKey(kaspa.ScriptBuilder.fromScript(new Uint8Array(Buffer.from(h, 'hex'))).createPayToScriptHashScript(), 'simnet').toString();
let marketCov = null, total = 0n; const out = [];
for (const c of claims) {
  const tx = txById.get(c.txid); if (!tx) { ok(false, `claim tx ${c.txid.slice(0, 12)} 找不到`); continue; }
  const o = tx.outputs.map((x, i) => ({ i, cov: x.covenant?.covenantId ?? null, addr: x.verboseData?.scriptPublicKeyAddress, v: BigInt(x.value) }));
  const ci = c.last ? 0 : 1, ti = c.last ? 1 : 2; if (!c.last) marketCov = o[0].cov;
  const who = Object.entries(W).find(([, r]) => r.xonly.startsWith(c.pkPrefix)); if (!who) { ok(false, `pk ${c.pkPrefix} 未知`); continue; }
  const art = computeKanetTokenClaimArtifact({ marketCovIdHex: marketCov, winnerPkHex: who[1].xonly, amount: c.payout, tokenTmplHashHex: process.env.ZK_TOKEN_TMPL_HASH });
  const ktt = computeKttTokenArtifact({ amount: Number(c.payout), ownerCovIdHex: o[ci].cov });
  const unspent = async (addr, idx) => (await rpc.getUtxosByAddresses([new kaspa.Address(addr)])).entries.some((e) => e.outpoint.transactionId === c.txid && Number(e.outpoint.index) === idx);
  ok(o[ci].addr === p2shAddr(art.script.toString('hex')) && o[ti].addr === p2shAddr(ktt.script.toString('hex')), `claim idx=${c.idx} → ${who[0]}: claim_out/tok_out 地址 == 重算的 KanetTokenClaim/KTT(${c.payout}) 地址`);
  ok(await unspent(o[ci].addr, ci) && await unspent(o[ti].addr, ti), `claim idx=${c.idx}: 两个输出仍是链上未花 UTXO`);
  ok(!tx.outputs.some((x) => { const n = addrToName[x.verboseData?.scriptPublicKeyAddress]; return n && n !== 'settler' && n !== 'fee'; }), `claim idx=${c.idx}: 没有输出落到赢家/下注人/开盘人钱包`);
  total += c.payout; out.push({ idx: c.idx, winner: who[0], payoutUnits: String(c.payout), txid: c.txid, claimOutAddr: o[ci].addr, tokOutAddr: o[ti].addr });
}
ok(total === 3_000_000_000n, `claim KTT 总量 == 3000000000: ${total}`);
writeFileSync(`${OUT}/s3_verify_claims_${shortId}.json`, JSON.stringify({ shortId, claims: out, fails }, null, 1));
process.exit(fails ? 1 : 0);
