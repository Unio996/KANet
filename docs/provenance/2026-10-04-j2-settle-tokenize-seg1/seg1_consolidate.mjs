// seg1_consolidate.mjs — 段1 验收驱动: 用【生产 consolidateAllShards({tokenized:true}) + 生产 relay 构造器 bshard_consolidate_v2】在 simnet 真共识上跑。
//   阶段: N1 多铸 1(tok_out.amount+1) 被拒 | N2 owner 错(tok_out.owner=leaf_cov_id 而非 PS cov, 绕过 relay 的 owner 守卫) 被拒
//         P1 模拟中途崩溃: 片0 落链后在片1 前抛错(DB 不回写 → 陈旧 genesis) | P2 resume: 生产 autoDetectConsolidateResume(tokenized) 自愈续跑片1(消费 PS 已持有代币)
//   读回按 UTXO(getUtxosByAddresses), 不按 mempool。
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { http, relays, kaspa, rpcConnect, sleep, log, FUNDS_SECRET, BASE } from './lib.mjs';
process.env.DB_PATH = 'D:/kanet-tn12/scratch/_j2_tok_sim/console.simnet.db'; process.env.CONSOLE_ENCRYPTION_KEY ||= '2'.repeat(64); process.env.KASPA_NETWORK ||= 'simnet';
process.env.SILVERC_V100_PATH ||= 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';
const imp = (p) => import(pathToFileURL(`D:/kanet-tn12/scratch/_j2_wt_tokenize/kasia-console/src/${p}`).href);
const { sqlite: db } = await imp('db/client.js');
const { consolidateAllShards } = await imp('lib/pool-shard-settle.mjs');
const { computeKttTokenArtifact } = await imp('lib/pool-bshard-artifacts.mjs');
const m = JSON.parse(readFileSync('D:/kanet-tn12/scratch/_j2_tok_sim/market.json', 'utf8'));
const rpc = await rpcConnect();
const settler = relays.settler;
const market = db.prepare('select deadline from pool_markets where id = ?').get(m.market_id);
const ps0 = db.prepare('select * from payout_shards where logical_market_id = ?').get(m.market_id);
const payoutShard = { payout_redeem_hex: ps0.payout_redeem_hex, payout_ps_outpoint: ps0.payout_ps_outpoint, payout_cov_id: ps0.payout_cov_id };

const addrOf = (hex) => kaspa.addressFromScriptPublicKey(kaspa.payToScriptHashScript(new Uint8Array(Buffer.from(hex, 'hex'))), 'simnet').toString();
const getUtxos = async (a) => { const { entries } = await rpc.getUtxosByAddresses([new kaspa.Address(a)]); return entries.map((e) => ({ outpoint: { transactionId: e.outpoint.transactionId, index: e.outpoint.index }, amount: String(e.amount), covenantId: e.covenantId ? String(e.covenantId) : null })); };
const landed = async (txid, addr) => { for (let i = 0; i < 100; i++) { if ((await getUtxos(addr)).some((u) => u.outpoint.transactionId === txid)) return true; await sleep(300); } return false; };
const rcRaw = async (cmd) => { if (process.env.SEG1_FORCE_LOCK0) cmd.lock_time = Number(process.env.SEG1_FORCE_LOCK0) - 1; const j = await http('POST', `/api/relay/${settler.id}/send-command`, cmd); if (j.ok === false || j.error) { const e = new Error(JSON.stringify(j).slice(0, 700)); e.raw = j; throw e; } return j; };
const transfer = async (addr, sompi) => {
  const j = await http('POST', `/api/relay/${settler.id}/transfer`, { to: addr, amount: (Number(sompi) / 1e8).toFixed(8) }, { 'x-kanet-admin-secret': FUNDS_SECRET });
  if (!j.txId) throw new Error('transfer fail ' + JSON.stringify(j));
  if (!(await landed(j.txId, addr))) throw new Error('transfer not landed ' + j.txId);
  return j.txId;
};
const base = { db, landed, p2sh: addrOf, logicalMarketId: m.market_id, payoutShard, relayAddr: settler.address, transfer, deadline: Number(market.deadline), getUtxos, tokenized: true };

// 等 deadline 过(partial 片 consolidate 要求 tx.time >= deadline*1000)
while (Date.now() < Number(market.deadline) * 1000 + 270000) { await sleep(2000); }
log('deadline passed; shards:', JSON.stringify(db.prepare('select shard_index,status,current_leaf_state,current_token_outpoint,leaf_cov_id from market_shards where logical_market_id=? order by shard_index').all(m.market_id)));
const out = { negatives: {}, positives: {} };

// ── 负向: 改写 cmd 后发给生产 relay 构造器, 期望真共识拒绝 ──
async function negative(label, mutate) {
  let rejected = null;
  const rc = async (cmd) => { if (cmd.type === 'bshard_consolidate_v2') mutate(cmd); return rcRaw(cmd); };
  try { await consolidateAllShards({ ...base, rc }); } catch (e) { rejected = e.message; }
  log(`NEG ${label}:`, rejected ? 'REJECTED ✓ ' + rejected.slice(0, 520) : '‼️ ACCEPTED (BAD)');
  out.negatives[label] = rejected;
  if (!rejected) throw new Error('negative case was accepted: ' + label);
}
const shard0 = db.prepare('select * from market_shards where logical_market_id=? order by shard_index limit 1').get(m.market_id);
const st0 = JSON.parse(shard0.current_leaf_state);
await negative('N1_mint_one_extra', (cmd) => {
  const art = computeKttTokenArtifact({ amount: Number(st0.pool_value) + 1, ownerCovIdHex: payoutShard.payout_cov_id });   // amount = consolidated_pool(0)+shard_amount+1
  cmd.outputs.tok_out = { redeem_hex: art.script.toString('hex') };   // 不带 owner_cov_id_hex ⇒ 绕过 relay 的预检, 让共识来拒
});
await negative('N2_wrong_owner', (cmd) => {
  const art = computeKttTokenArtifact({ amount: Number(st0.pool_value), ownerCovIdHex: shard0.leaf_cov_id });   // owner = leaf cov(≠ PS cov)
  cmd.outputs.tok_out = { redeem_hex: art.script.toString('hex') };
});
// 反向证明: 上面两笔都没动链上状态 — 片0 的 leaf/token 仍在
const leafBefore = await getUtxos(addrOf(Buffer.from((await import(pathToFileURL('D:/kanet-tn12/scratch/_j2_wt_tokenize/kasia-console/src/lib/pool-shard-register.mjs').href)).spliceLeafState(shard0.shard_redeem_hex, st0), 'hex').toString('hex')));
log('shard0 leaf UTXO still present after negatives:', leafBefore.length === 1, leafBefore.map((u) => u.outpoint.transactionId.slice(0, 10)));

// ── P1: 片0 落链, 然后在片1 前模拟崩溃 ──
let calls = 0;
const rcCrash = async (cmd) => { if (cmd.type === 'bshard_consolidate_v2') { calls++; if (calls === 2) throw new Error('SIMULATED CRASH before shard1 consolidate'); } return rcRaw(cmd); };
const r1 = {}; try { await consolidateAllShards({ ...base, rc: rcCrash }); } catch (e) { r1.err = e.message; }
log('P1 (crash after shard0):', r1.err);
const dbPs = db.prepare('select payout_ps_outpoint from payout_shards where logical_market_id = ?').get(m.market_id);
log('DB payout_ps_outpoint still genesis (stale)?', dbPs.payout_ps_outpoint === payoutShard.payout_ps_outpoint);

// ── P2: resume ──
const res = await consolidateAllShards({ ...base, rc: rcRaw });
log('P2 resume result:', JSON.stringify(res).slice(0, 600));
out.positives.final = res;

// ── 读回(UTXO) ──
const finalPool = BigInt(res.consolidatedPool);
const psAddr = addrOf(res.redeemHex);
const psU = await getUtxos(psAddr);
const tokArt = computeKttTokenArtifact({ amount: Number(finalPool), ownerCovIdHex: payoutShard.payout_cov_id });
const tokU = await getUtxos(addrOf(tokArt.script.toString('hex')));
log('PS UTXO @final state addr:', JSON.stringify(psU));
log(`PS 名下代币 UTXO (amount=${finalPool}, owner=PS cov):`, JSON.stringify(tokU));
out.readback = { finalPool: finalPool.toString(), psUtxos: psU, psTokenUtxos: tokU, psCovId: payoutShard.payout_cov_id };
const shards = db.prepare('select shard_index,status,current_leaf_state from market_shards where logical_market_id=? order by shard_index').all(m.market_id);
let leavesGone = true;
for (const sh of db.prepare('select * from market_shards where logical_market_id=?').all(m.market_id)) {
  const { spliceLeafState } = await imp('lib/pool-shard-register.mjs');
  const us = await getUtxos(addrOf(spliceLeafState(sh.shard_redeem_hex, JSON.parse(sh.current_leaf_state))));
  const shTok = await getUtxos(addrOf(computeKttTokenArtifact({ amount: Number(JSON.parse(sh.current_leaf_state).pool_value), ownerCovIdHex: sh.leaf_cov_id }).script.toString('hex')));
  log(`shard${sh.shard_index} leaf UTXOs=${us.length} shard-token UTXOs=${shTok.length}`);
  if (us.length || shTok.length) leavesGone = false;
}
out.readback.shardsConsumed = leavesGone;
log('SUMMARY', JSON.stringify({ shards, finalPool: finalPool.toString(), psUtxoCount: psU.length, psTokenUtxoCount: tokU.length, shardsConsumed: leavesGone }));
writeFileSync('seg1_result.json', JSON.stringify(out, null, 1));
process.exit(0);
