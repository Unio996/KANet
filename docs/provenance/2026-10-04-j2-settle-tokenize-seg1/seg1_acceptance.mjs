// seg1_acceptance.mjs — 账本 1832 段1 验收驱动(合约修复后): 生产 consolidateAllShards({tokenized:true}) + 生产 relay 构造器 bshard_consolidate_v2, simnet(官方 kaspad 2.0.1) 真共识。
//   每个负向用例做两件事: (a) 同一笔(被篡改的)tx 先 dry_run 导出真实字节, 交 cli-debugger 跑 PayoutShardV2.absorb, 记录【哪一行 require】拒;
//                         (b) 真发给生产 relay 构造器 → 真节点共识拒绝(原文落日志)。
//   负向: N1 多铸 1 | N2 owner 错 | N3 篡改自续约输出(PS 续约 state 被改) | N4 shard_amount 见证≠真实代币面额
//   正向: P1 片0 落链后模拟崩溃 | P2 resume 续跑(消费 PS 已持有代币) | 读回按 UTXO(getUtxosByAddresses), 不按 mempool。
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { http, relays, kaspa, rpcConnect, sleep, log, FUNDS_SECRET } from './lib.mjs';
process.env.DB_PATH = 'D:/kanet-tn12/scratch/_j2_tok_sim/console.simnet.db'; process.env.CONSOLE_ENCRYPTION_KEY ||= '2'.repeat(64); process.env.KASPA_NETWORK ||= 'simnet';
for (const l of readFileSync('env.simnet.template', 'utf8').split('\n')) { const mm = /^(ZK_[A-Z_]+|SILVERC_V100_PATH)=(.*)$/.exec(l.trim()); if (mm) process.env[mm[1]] = mm[2]; }
const imp = (p) => import(pathToFileURL(`D:/kanet-tn12/scratch/_j2_wt_tokenize/kasia-console/src/${p}`).href);
const { sqlite: db } = await imp('db/client.js');
const { consolidateAllShards } = await imp('lib/pool-shard-settle.mjs');
const { computeKttTokenArtifact } = await imp('lib/pool-bshard-artifacts.mjs');
const { computeCloseZkTmplAnchor, spliceLeafState } = await imp('lib/pool-shard-register.mjs');
const m = JSON.parse(readFileSync('D:/kanet-tn12/scratch/_j2_tok_sim/market.json', 'utf8'));
const rpc = await rpcConnect();
const settler = relays.settler;
const market = db.prepare('select deadline from pool_markets where id = ?').get(m.market_id);
const ps0 = db.prepare('select * from payout_shards where logical_market_id = ?').get(m.market_id);
const payoutShard = { payout_redeem_hex: ps0.payout_redeem_hex, payout_ps_outpoint: ps0.payout_ps_outpoint, payout_cov_id: ps0.payout_cov_id };
const addrOf = (hex) => kaspa.addressFromScriptPublicKey(kaspa.payToScriptHashScript(new Uint8Array(Buffer.from(hex, 'hex'))), 'simnet').toString();
const getUtxos = async (a) => { const { entries } = await rpc.getUtxosByAddresses([new kaspa.Address(a)]); return entries.map((e) => ({ outpoint: { transactionId: e.outpoint.transactionId, index: e.outpoint.index }, amount: String(e.amount), covenantId: e.covenantId ? String(e.covenantId) : null })); };
const landed = async (txid, addr) => { for (let i = 0; i < 100; i++) { if ((await getUtxos(addr)).some((u) => u.outpoint.transactionId === txid)) return true; await sleep(300); } return false; };
const sendRaw = async (cmd) => { const j = await http('POST', `/api/relay/${settler.id}/send-command`, cmd); if (j.ok === false || j.error) { const e = new Error(JSON.stringify(j).slice(0, 900)); e.raw = j; throw e; } return j; };
const transfer = async (addr, sompi) => {
  const j = await http('POST', `/api/relay/${settler.id}/transfer`, { to: addr, amount: (Number(sompi) / 1e8).toFixed(8) }, { 'x-kanet-admin-secret': FUNDS_SECRET });
  if (!j.txId) throw new Error('transfer fail ' + JSON.stringify(j));
  if (!(await landed(j.txId, addr))) throw new Error('transfer not landed ' + j.txId);
  return j.txId;
};
const base = { db, landed, p2sh: addrOf, logicalMarketId: m.market_id, payoutShard, relayAddr: settler.address, transfer, deadline: Number(market.deadline), getUtxos, tokenized: true };

// ── cli-debugger: 把 dry_run 导出的真实 tx 字节喂给 PayoutShardV2.absorb, 返回失败行 ──
const H = (x) => '0x' + x;
const tmpl = { tok: process.env.ZK_TOKEN_TMPL_HASH, claim: process.env.ZK_CLAIM_TMPL_HASH };
const { anchorHex } = computeCloseZkTmplAnchor(process.env.ZK_CLOSEZK_SIL_PATH, process.env.ZK_GATE_TMPL_HASH, tmpl.tok, tmpl.claim);
const z = '0x' + '00'.repeat(32);
const ownRedeemLen = Buffer.from(ps0.payout_redeem_hex, 'hex').length;
const ctor = [H(ps0.pool_merkle_root), H(ps0.predicate_commit), H(anchorHex), H(tmpl.tok), 0, 0, z, ...Array(17).fill(0), -1, 0, z, z, H(tmpl.claim), ownRedeemLen];
const dbgExe = 'D:/silverscript/versioned-builds/cli-debugger-v100-3ed9733.exe';
function dbgAbsorb(label, dump, w) {
  const tx = { active_input_index: 0,
    inputs: dump.inputs.map((i) => ({ utxo_value: Number(i.utxo_value), ...(i.covenant_id ? { covenant_id: H(i.covenant_id) } : {}), ...(i.utxo_script_hex ? { utxo_script_hex: H(i.utxo_script_hex) } : {}), signature_script_hex: H(i.signature_script_hex) })),
    outputs: dump.outputs.map((o, k) => ({ value: Number(o.value), script_hex: H(o.script_hex), ...(o.covenant_id && k === 0 ? { covenant_id: H(o.covenant_id) } : {}) })) };
  const test = { tests: [{ name: label, function: 'absorb', constructor_args: ctor, args: [0, 2, 1, Number(w.shard_amount), H(w.tok_prefix_hex), H(w.tok_suffix_hex)], expect: 'pass', tx }] };
  const file = `dbg_${label}.test.json`; writeFileSync(file, JSON.stringify(test));
  let out = ''; try { out = execFileSync(dbgExe, ['D:/kanet-tn12/scratch/_j2_wt_tokenize/kasia-console/src/lib/PayoutShardV2.sil', '--test-file', file, '--run-all'], { encoding: 'utf8', maxBuffer: 1 << 28 }); } catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
  const pass = /\bPASS\b/.test(out) && !/\bFAIL\b/.test(out);
  const at = /-->\s*(\d+):\d+/.exec(out); const lineNo = at ? Number(at[1]) : null;
  const reqLine = lineNo ? (out.split(/\r?\n/).map((l) => l.trimStart()).find((l) => l.startsWith(`${lineNo} |`))?.slice(`${lineNo} |`.length).trim() ?? null) : null;
  writeFileSync(`dbg_${label}.out.txt`, out.slice(0, 2500));
  return { pass, lineNo, reqLine };
}

while (Date.now() < Number(market.deadline) * 1000 + 270000) { await sleep(2000); }   // 过去中位时间追上 deadline(实测 +270s)
log('deadline passed; shards:', JSON.stringify(db.prepare('select shard_index,status,current_leaf_state,current_token_outpoint,leaf_cov_id from market_shards where logical_market_id=? order by shard_index').all(m.market_id)));
const out = { ownRedeemLen, psCovId: payoutShard.payout_cov_id, negatives: {}, positives: {} };

async function negative(label, mutate) {
  let dbgRes = null, rejected = null, captured = null;
  const rc = async (cmd) => {
    if (cmd.type !== 'bshard_consolidate_v2') return sendRaw(cmd);
    mutate(cmd);
    const dry = await sendRaw({ ...cmd, dry_run: true });          // (a) 真实字节 → cli-debugger
    captured = dry; dbgRes = dbgAbsorb(label, dry, cmd.witness);
    return sendRaw(cmd);                                           // (b) 真共识
  };
  try { await consolidateAllShards({ ...base, rc }); } catch (e) { rejected = e.message; }
  log(`NEG ${label}: consensus=${rejected ? 'REJECTED ✓' : '‼️ ACCEPTED (BAD)'} | debugger=${JSON.stringify(dbgRes)}`);
  log(`   node text: ${(rejected || '').slice(0, 600)}`);
  out.negatives[label] = { consensusRejected: !!rejected, nodeText: rejected, debugger: dbgRes };
  if (!rejected) throw new Error('negative case was accepted: ' + label);
}
const shard0 = db.prepare('select * from market_shards where logical_market_id=? order by shard_index limit 1').get(m.market_id);
const st0 = JSON.parse(shard0.current_leaf_state);
await negative('N1_mint_one_extra', (cmd) => {
  const art = computeKttTokenArtifact({ amount: Number(st0.pool_value) + 1, ownerCovIdHex: payoutShard.payout_cov_id });
  cmd.outputs.tok_out = { redeem_hex: art.script.toString('hex') };          // 无 owner_cov_id_hex ⇒ 绕过 relay 预检, 让共识/合约来拒
});
await negative('N2_wrong_owner', (cmd) => {
  const art = computeKttTokenArtifact({ amount: Number(st0.pool_value), ownerCovIdHex: shard0.leaf_cov_id });
  cmd.outputs.tok_out = { redeem_hex: art.script.toString('hex') };
});
await negative('N3_tampered_self_output', (cmd) => { cmd.inputs.payoutshard.state = { ...cmd.inputs.payoutshard.state, closed: 1 }; });   // PS 续约 state 被改(closed 0→1)
await negative('N4_shard_amount_mismatch', (cmd) => { cmd.witness = { ...cmd.witness, shard_amount: String(BigInt(cmd.witness.shard_amount) + 1n) }; });

const leafAddr = addrOf(spliceLeafState(shard0.shard_redeem_hex, st0));
const leafBefore = await getUtxos(leafAddr);
log('shard0 leaf UTXO still present after negatives:', leafBefore.length === 1);
out.negatives._leafUntouched = leafBefore.length === 1;

// 读回 before(UTXO): PS 创世 + 各片
const psBefore = await getUtxos(ps0.payout_ps_addr);
log('BEFORE PS UTXO(genesis addr):', JSON.stringify(psBefore));
out.before = { psUtxos: psBefore, leaf0: leafBefore };

let calls = 0;
const rcCrash = async (cmd) => { if (cmd.type === 'bshard_consolidate_v2') { calls++; if (calls === 2) throw new Error('SIMULATED CRASH before shard1 consolidate'); } return sendRaw(cmd); };
const r1 = {}; try { await consolidateAllShards({ ...base, rc: rcCrash }); } catch (e) { r1.err = e.message; }
log('P1 (crash after shard0):', r1.err);
const res = await consolidateAllShards({ ...base, rc: sendRaw });
log('P2 resume result:', JSON.stringify(res).slice(0, 600));
out.positives.final = res;

const finalPool = BigInt(res.consolidatedPool);
const psU = await getUtxos(addrOf(res.redeemHex));
const tokU = await getUtxos(addrOf(computeKttTokenArtifact({ amount: Number(finalPool), ownerCovIdHex: payoutShard.payout_cov_id }).script.toString('hex')));
log('AFTER PS UTXO @final state addr:', JSON.stringify(psU));
log(`AFTER PS 名下代币 UTXO (amount=${finalPool}, owner=PS cov):`, JSON.stringify(tokU));
let leavesGone = true;
for (const sh of db.prepare('select * from market_shards where logical_market_id=?').all(m.market_id)) {
  const st = JSON.parse(sh.current_leaf_state);
  const us = await getUtxos(addrOf(spliceLeafState(sh.shard_redeem_hex, st)));
  const shTok = await getUtxos(addrOf(computeKttTokenArtifact({ amount: Number(st.pool_value), ownerCovIdHex: sh.leaf_cov_id }).script.toString('hex')));
  log(`shard${sh.shard_index} leaf UTXOs=${us.length} shard-token UTXOs=${shTok.length}`);
  if (us.length || shTok.length) leavesGone = false;
}
out.after = { finalPool: finalPool.toString(), psUtxos: psU, psTokenUtxos: tokU, shardsConsumed: leavesGone };
log('SUMMARY', JSON.stringify({ finalPool: finalPool.toString(), psUtxoCount: psU.length, psTokenUtxoCount: tokU.length, shardsConsumed: leavesGone }));
writeFileSync('seg1_acceptance_result.json', JSON.stringify(out, null, 1));
process.exit(0);
