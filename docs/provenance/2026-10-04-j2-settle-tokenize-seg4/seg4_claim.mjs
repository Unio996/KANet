// seg4_claim.mjs — 账本 1832 段4 验收(claim): CloseZkV2.claim 代币化, simnet 官方 kaspad 2.0.1 真共识。
//   前置: 一个 closed==2 的市场(段3 产物: 池代币 UTXO owner=CloseZkV2 cov)。env: 无需开任何自治 tick(本脚本逐笔驱动【生产 claim tick 的同一函数 _claimOneMarket】)。
//   步骤: ① 负向(同一未动状态): NA 金额被改 / NB 代币 owner 错 / NC 自续约输出被篡改(harness 重签) —— 每条 dry_run 真字节 → cli-debugger 行 + 真共识拒收
//         ② 诚实: 循环 _claimOneMarket 直到 exhausted(partial…最后一位 full), 每笔读回按 UTXO ③ ND 重复领取同一 leaf ⇒ relay 预检拒 + 记录
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { http, relays, kaspa, rpcConnect, sleep, log, FUNDS_SECRET } from './lib.mjs';
process.env.DB_PATH = 'D:/kanet-tn12/scratch/_j2_tok_sim/console.simnet.db'; process.env.CONSOLE_ENCRYPTION_KEY ||= '2'.repeat(64); process.env.KASPA_NETWORK ||= 'simnet';
for (const l of readFileSync('env.simnet.template', 'utf8').split('\n')) { const mm = /^(ZK_[A-Z_]+|SILVERC_V100_PATH)=(.*)$/.exec(l.trim()); if (mm) process.env[mm[1]] = mm[2]; }
const imp = (p) => import(pathToFileURL(`D:/kanet-tn12/scratch/_j2_wt_tokenize/kasia-console/src/${p}`).href);
const { sqlite: db } = await imp('db/client.js');
const ticks = await imp('lib/zk-autonomy-ticks.mjs');
const { runTokenClaim } = await imp('lib/zk-token-claim-orchestrator.mjs');
const { parseCloseZkV2State, buildClaimWitness, spliceClaimContinuationRedeem } = await imp('lib/closezk-v2-claim-builder.mjs');
const { advanceZkContinuationAfterSpend } = await imp('lib/closezk-v2-mint.mjs');
const { computePariMutuelPayout } = await imp('lib/pool-shard-settle.mjs');
const { getMarketBets } = await imp('lib/pool-bettor-sides-query.mjs');
const { deriveCloseFeeLeaves } = await imp('services/bshard-close-voter.js');
const { computeKttTokenArtifact, computeKanetTokenClaimArtifact } = await imp('lib/pool-bshard-artifacts.mjs');
const { readPayoutShardV2AttestedState } = await imp('lib/bshard-close-enforce.mjs');
const m = JSON.parse(readFileSync(process.env.MARKET_JSON || 'D:/kanet-tn12/scratch/_j2_tok_sim/market.json', 'utf8'));
const rpc = await rpcConnect();
const settler = relays.settler;
const addrOf = (hex) => kaspa.addressFromScriptPublicKey(kaspa.payToScriptHashScript(new Uint8Array(Buffer.from(hex, 'hex'))), 'simnet').toString();
const getUtxos = async (a) => { const { entries } = await rpc.getUtxosByAddresses([new kaspa.Address(a)]); return entries.map((e) => ({ outpoint: { transactionId: e.outpoint.transactionId, index: e.outpoint.index }, amount: String(e.amount), entry: e })); };
const sendRaw = async (cmd) => { const j = await http('POST', `/api/relay/${settler.id}/send-command`, cmd); if (j.ok === false || j.error) { const e = new Error(JSON.stringify(j).slice(0, 800)); e.raw = j; throw e; } return j; };
const metaOf = () => JSON.parse(db.prepare('select metadata from pool_markets where id = ?').get(m.market_id).metadata || '{}');
const landedVia = async (address, txid) => { for (let i = 0; i < 60; i++) { if ((await getUtxos(address)).some((u) => u.outpoint.transactionId === txid)) return true; await sleep(500); } return false; };
const ctx = {
  relayCall: sendRaw,
  checkLanded: async (address, txid) => landedVia(address, txid),
  mintFeeUtxo: async (kas = 0.3) => {
    const j = await http('POST', `/api/relay/${settler.id}/transfer`, { to: settler.address, amount: Number(kas).toFixed(8) }, { 'x-kanet-admin-secret': FUNDS_SECRET });
    if (!j.txId) throw new Error('fee transfer fail ' + JSON.stringify(j));
    if (!(await landedVia(settler.address, j.txId))) throw new Error('fee transfer not landed');
    return { address: settler.address, outpointTxid: j.txId, index: 0 };
  },
  p2shAddr: async (hex) => addrOf(hex), p2pkAddr: async () => settler.address,
};

// ── 当前状态与 leaf 集(同 _claimOneMarket 的现读/重算) ──
const zc0 = metaOf().zk_continuation;
const st0 = parseCloseZkV2State(zc0.redeemHex, { expectedClosed: 2 });
const { bets: bettors } = getMarketBets(m.market_id, db);
const feeLeaves = deriveCloseFeeLeaves(m.market_id, zc0.poolAtZkCloseSompi) || [];
const pm = computePariMutuelPayout({ bettors, winningDirection: st0.attestedWinner, poolTotalSompi: zc0.poolAtZkCloseSompi, feeLeaves });
log('payout leaves:', JSON.stringify(pm.payoutLeaves.map((l) => ({ pk: l.pk.slice(0, 8), amount: String(l.amount), type: l.type }))), 'pool(token)=', st0.consolidated_pool);
const out = { leaves: pm.payoutLeaves.map((l) => ({ pk: l.pk, amount: String(l.amount) })), negatives: {}, claims: [] };

// ── cli-debugger ──
const H = (x) => '0x' + x;
const z = '0x' + '00'.repeat(32);
const ps = db.prepare('select * from payout_shards where logical_market_id = ?').get(m.market_id);
const att = readPayoutShardV2AttestedState(ps.payout_redeem_hex);
const dbgExe = 'D:/silverscript/versioned-builds/cli-debugger-v100-3ed9733.exe';
function dbgClaim(label, dump, w, stateNow, redeemLen) {
  const ctor = [H(process.env.ZK_GATE_TMPL_HASH), H(att.betsRootHex), H(att.refundRootHex), att.attestedAtMs, att.attestedWinner, stateNow.closed, H(stateNow.payoutRootField), Number(stateNow.consolidated_pool), ...Array.from({ length: 17 }, (_, i) => Number(stateNow['w' + i])), H(process.env.ZK_TOKEN_TMPL_HASH), H(process.env.ZK_CLAIM_TMPL_HASH), redeemLen];
  const tx = { active_input_index: 0,
    inputs: dump.inputs.map((i) => ({ prev_txid: i.prev_txid, prev_index: i.prev_index, sequence: 0, sig_op_count: 0, utxo_value: Number(i.utxo_value), ...(i.covenant_id ? { covenant_id: H(i.covenant_id) } : {}), ...(i.utxo_script_hex ? { utxo_script_hex: H(i.utxo_script_hex) } : {}), signature_script_hex: H(i.signature_script_hex) })),
    outputs: dump.outputs.map((o) => ({ value: Number(o.value), script_hex: H(o.script_hex), ...(o.covenant_id ? { covenant_id: H(o.covenant_id), authorizing_input: o.authorizing_input ?? 0 } : {}) })) };
  const args = [dump.selfOutIdx ?? 0, dump.claimOutIdx, 1, dump.tokOutIdx, dump.remainOutIdx ?? 0, H(w.bettor_pk), Number(w.amount), w.merkle_index, ...w.siblings_hex.map(H), H(w.tok_prefix_hex), H(w.tok_suffix_hex), H(w.claim_prefix_hex), H(w.claim_suffix_hex)];
  const file = `dbg_${label}.test.json`; writeFileSync(file, JSON.stringify({ tests: [{ name: label, function: 'claim', constructor_args: ctor, args, expect: 'pass', tx }] }));
  let o = ''; try { o = execFileSync(dbgExe, ['D:/kanet-tn12/scratch/_j2_wt_tokenize/kasia-console/src/lib/CloseZkV2.sil', '--test-file', file, '--run-all'], { encoding: 'utf8', maxBuffer: 1 << 28 }); } catch (e) { o = String(e.stdout || '') + String(e.stderr || ''); }
  const pass = /\bPASS\b/.test(o) && !/\bFAIL\b/.test(o);
  const at = /-->\s*(\d+):\d+/.exec(o); const lineNo = at ? Number(at[1]) : null;
  const reqLine = lineNo ? (o.split(/\r?\n/).map((l) => l.trimStart()).find((l) => l.startsWith(`${lineNo} |`))?.slice(`${lineNo} |`.length).trim() ?? null) : null;
  writeFileSync(`dbg_${label}.out.txt`, o.slice(0, 2500));
  return { pass, lineNo, reqLine };
}

// ── harness 重签: 把 dry_run 导出的 tx 改一个输出后用 fee 私钥重签并直接提交(只用于 simnet 负向: 自续约输出被篡改) ──
async function resubmitTampered(dump, tamperOutputIdx) {
  const relayPriv = new kaspa.PrivateKey(relays.settler.priv);
  const addrs = [...new Set(dump.inputs.map((i) => i.__addr).filter(Boolean))];
  const entries = (await rpc.getUtxosByAddresses(addrs.map((a) => new kaspa.Address(a)))).entries;
  const entryOf = (txid, idx) => entries.find((e) => e.outpoint.transactionId === txid && Number(e.outpoint.index) === Number(idx));
  const outs = dump.outputs.map((o, k) => {
    let script = o.script_hex;
    if (k === tamperOutputIdx) { const b = Buffer.from(script, 'hex'); b[b.length - 5] ^= 0x01; script = b.toString('hex'); }   // 翻转 P2SH hash 中的 1 bit
    return new kaspa.TransactionOutput(BigInt(o.value), new kaspa.ScriptPublicKey(0, script), o.covenant_id ? new kaspa.CovenantBinding(o.authorizing_input ?? 0, new kaspa.Hash(o.covenant_id)) : undefined);
  });
  const mk = (sigs) => new kaspa.Transaction({ version: 1, inputs: dump.inputs.map((i, k) => ({ previousOutpoint: { transactionId: i.prev_txid, index: i.prev_index }, signatureScript: sigs ? sigs[k] : '', sequence: 0n, sigOpCount: 0, computeBudget: k === 0 ? 300 : 100, ...(sigs ? {} : { utxo: entryOf(i.prev_txid, i.prev_index) }) })), outputs: outs, lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
  const un = mk(null);
  const feeSig = kaspa.createInputSignature(un, 2, relayPriv, kaspa.SighashType.All);
  const tx = mk([dump.inputs[0].signature_script_hex, dump.inputs[1].signature_script_hex, feeSig]);
  return (await rpc.submitTransaction({ transaction: tx, allowOrphan: false })).transactionId;
}

// ── 负向 ──
const tIdx = pm.payoutLeaves.findIndex((_, i) => ((BigInt(st0['w' + Math.floor(i / 63)]) >> BigInt(i % 63)) & 1n) === 0n);
const target = pm.payoutLeaves[tIdx];
const wit = buildClaimWitness(target.pk, tIdx, st0, { bettors, feeLeaves, poolTotalAtZkCloseSompi: zc0.poolAtZkCloseSompi });
const sibs = wit.siblings.map((x) => (Buffer.isBuffer(x) ? x.toString('hex') : String(x)));
const tmpl = (await imp('lib/pool-shard-register.mjs')).readZkTemplateHashes();
const base = async (extra = {}) => {
  const fee = await ctx.mintFeeUtxo(3.5);
  return runTokenClaim({ kind: 'claim', self: { redeemHex: zc0.redeemHex, txid: zc0.outpoint.txid, index: zc0.outpoint.index }, pool: st0.consolidated_pool, bettorPk: target.pk, amount: wit.payout, merkleIndex: tIdx, siblingsHex: sibs,
    fee: { address: fee.address, txid: fee.outpointTxid, index: fee.index }, relayCall: ctx.relayCall, p2sh: ctx.p2shAddr, tokenTmplHash: tmpl.tokenTmplHash, claimTmplHash: tmpl.claimTmplHash, ...extra });
};
const redeemLen = Buffer.from(zc0.redeemHex, 'hex').length;
async function negative(label, runner) {
  let dbg = null, rejected = null, dump = null;
  try { await runner((d, w) => { dump = d; dbg = dbgClaim(label, d, w, st0, redeemLen); }); } catch (e) { rejected = e.message; }
  log(`NEG ${label}: ${rejected ? 'REJECTED ✓' : '‼️ ACCEPTED (BAD)'} | debugger=${JSON.stringify(dbg)}`); log(`   text: ${(rejected || '').slice(0, 480)}`);
  out.negatives[label] = { rejected: !!rejected, text: rejected, debugger: dbg };
  if (!rejected) throw new Error('negative accepted: ' + label);
}
const dryThenReal = (mutate) => async (cb) => {
  let last = null;
  const mutateFinal = (c) => { mutate?.(c); const w = c.witness; (async () => {})(); last = { c, w }; };
  // 先 dry_run 取字节(同样的变异), 再真发
  const dry = await base({ dryRun: true, mutateFinal });
  cb({ ...dry, selfOutIdx: 0 }, last.w);
  await base({ mutateFinal });
};
await negative('NA_amount_tampered', dryThenReal((c) => { c.witness.amount = String(BigInt(c.witness.amount) + 1n); }));
await negative('NB_token_owner_wrong', async (cb) => {
  const selfCov = (await ctx.relayCall({ type: 'closezk_v2_claim', inputs: { self: { redeem_hex: zc0.redeemHex, outpointTxid: zc0.outpoint.txid, index: zc0.outpoint.index } }, witness: {}, outputs: {} })).selfCovId;
  const wrong = computeKttTokenArtifact({ amount: Number(wit.payout), ownerCovIdHex: selfCov });   // owner=self cov(而不是新 claim cov)
  return dryThenReal((c) => { c.outputs.tok_out.redeem_hex = wrong.script.toString('hex'); })(cb);   // owner_cov_id_hex 仍=真 claimCov ⇒ 绕过 relay 预检, 让合约来拒
});
await negative('NC_self_continuation_tampered', async (cb) => {
  const dry = await base({ dryRun: true });
  dry.inputs.forEach((i, k) => { i.__addr = [addrOf(zc0.redeemHex), null, settler.address][k]; });
  // token 输入地址: 由 dry 返回的 utxo_script_hex 反推不便, 这里直接重取: 池代币地址 = 第 2 个输入的 P2SH(从 relay 返回的 utxo_script_hex 构造 address)
  dry.inputs[1].__addr = kaspa.addressFromScriptPublicKey(new kaspa.ScriptPublicKey(0, dry.inputs[1].utxo_script_hex), 'simnet').toString();
  const w = { bettor_pk: target.pk, amount: wit.payout.toString(), merkle_index: tIdx, siblings_hex: sibs, ...(await (async () => { const c = {}; return c; })()) };
  // debugger 需要 tok/claim 模板见证: 取 dry 里的 sigScript 不便, 改为重新算
  const ktt = computeKttTokenArtifact({ amount: 1, ownerCovIdHex: '00'.repeat(31) + '01' });
  const claimA = computeKanetTokenClaimArtifact({ marketCovIdHex: dry.selfCovId, winnerPkHex: target.pk, amount: wit.payout, tokenTmplHashHex: tmpl.tokenTmplHash });
  Object.assign(w, { tok_prefix_hex: ktt.templatePrefix.toString('hex'), tok_suffix_hex: ktt.templateSuffix.toString('hex'), claim_prefix_hex: claimA.templatePrefix.toString('hex'), claim_suffix_hex: claimA.templateSuffix.toString('hex') });
  const tampered = JSON.parse(JSON.stringify(dry)); const b = Buffer.from(tampered.outputs[0].script_hex, 'hex'); b[b.length - 5] ^= 1; tampered.outputs[0].script_hex = b.toString('hex');
  cb({ ...tampered, selfOutIdx: 0 }, w);
  await resubmitTampered(dry, 0);
});
const still = { self: await getUtxos(addrOf(zc0.redeemHex)) };
out.negativesLeftStateUntouched = still.self.length === 1;
log('after negatives self UTXO count:', still.self.length);

async function doubleClaim(dIdx, dWit, dSibs) {
  const final = metaOf().zk_continuation;
  if (!final || final.exhausted || !final.outpoint) { out.negatives.ND_double_claim = { skipped: 'pool 已耗尽, 无活 self UTXO 可重放' }; return; }
  const stNow = parseCloseZkV2State(final.redeemHex, { expectedClosed: 2 });
  let t = null;
  try {
    const fee = await ctx.mintFeeUtxo(3.5);
    await runTokenClaim({ kind: 'claim', self: { redeemHex: final.redeemHex, txid: final.outpoint.txid, index: final.outpoint.index }, pool: stNow.consolidated_pool, bettorPk: pm.payoutLeaves[dIdx].pk, amount: dWit.payout, merkleIndex: dIdx, siblingsHex: dSibs, fee: { address: fee.address, txid: fee.outpointTxid, index: fee.index }, relayCall: ctx.relayCall, p2sh: ctx.p2shAddr, tokenTmplHash: tmpl.tokenTmplHash, claimTmplHash: tmpl.claimTmplHash });
  } catch (e) { t = e.message; }
  log('ND double-claim:', t ? 'REJECTED ✓ ' + t.slice(0, 300) : '‼️ ACCEPTED (BAD)');
  out.negatives.ND_double_claim = { rejected: !!t, text: t, note: 'relay 预检(nullifier bit 已置位)拦在广播前; 共识层同一 require 见 CloseZkV2.sil claim 的 (w/mask)%2==0' };
  if (!t) throw new Error('double claim accepted');
}

// ── 诚实: 逐笔驱动生产 claim tick 函数, 直到 exhausted ──
const poolTokAddr = async (pool, cov) => addrOf(computeKttTokenArtifact({ amount: Number(pool), ownerCovIdHex: cov }).script.toString('hex'));
let n = 0; let selfCov = null; let claimedSum = 0n;
// 先领【最后一个 leaf】(金额小于池 ⇒ partial), 落链后立刻重放同一 leaf ⇒ 才会走到 nullifier 位检查(而不是金额范围检查)
{
  const lastIdx = pm.payoutLeaves.length - 1;
  const lw = buildClaimWitness(pm.payoutLeaves[lastIdx].pk, lastIdx, st0, { bettors, feeLeaves, poolTotalAtZkCloseSompi: zc0.poolAtZkCloseSompi });
  const lsib = lw.siblings.map((x) => (Buffer.isBuffer(x) ? x.toString('hex') : String(x)));
  const { claimFeeInputSompi } = await imp('lib/zk-token-claim-orchestrator.mjs');
  const fee = await ctx.mintFeeUtxo(claimFeeInputSompi() / 1e8);
  const sj = await runTokenClaim({ kind: 'claim', self: { redeemHex: zc0.redeemHex, txid: zc0.outpoint.txid, index: zc0.outpoint.index }, pool: st0.consolidated_pool, bettorPk: pm.payoutLeaves[lastIdx].pk, amount: lw.payout, merkleIndex: lastIdx, siblingsHex: lsib,
    fee: { address: fee.address, txid: fee.outpointTxid, index: fee.index }, relayCall: ctx.relayCall, p2sh: ctx.p2shAddr, tokenTmplHash: tmpl.tokenTmplHash, claimTmplHash: tmpl.claimTmplHash });
  if (!(await ctx.checkLanded(sj.selfContAddress, sj.txId))) throw new Error('first partial claim not landed');
  const sp = spliceClaimContinuationRedeem(zc0.redeemHex, lastIdx, lw.payout, st0);
  if (sj.selfContRedeemHex !== sp.redeemHex) throw new Error('relay/console splice mismatch');
  advanceZkContinuationAfterSpend(m.market_id, { outpointTxid: sj.txId, outpointIndex: 0, redeemHex: sj.selfContRedeemHex, valueSompi: sp.newPool.toString(), utxoValueSompi: sj.utxoValueSompi, spentEntry: 'claim', spentTxid: sj.txId });
  log('HONEST claim(first, partial, last leaf idx=' + lastIdx + ') txId=' + sj.txId, 'pool after =', sp.newPool.toString());
  out.claims.push({ n: 'first-partial-last-leaf', txId: sj.txId, leafIdx: lastIdx, amount: lw.payout.toString(), poolAfter: sp.newPool.toString() });
  await doubleClaim(lastIdx, lw, lsib);
}
for (; n < 12; n++) {
  const z0 = metaOf().zk_continuation;
  if (!z0 || z0.exhausted) break;
  const stBefore = parseCloseZkV2State(z0.redeemHex, { expectedClosed: 2 });
  const r = await ticks._claimOneMarket(m.market_id, ctx);
  const z1 = metaOf().zk_continuation;
  const rec = { n, errored: !!r.errored, poolBefore: stBefore.consolidated_pool, exhaustedAfter: !!z1?.exhausted, outpointAfter: z1?.outpoint, poolAfter: z1?.valueSompi };
  log(`HONEST claim #${n}`, JSON.stringify(rec));
  if (r.errored) throw new Error('claim errored (见 events/console 日志)');
  out.claims.push(rec);
  claimedSum += BigInt(stBefore.consolidated_pool) - BigInt(z1?.exhausted ? 0 : z1.valueSompi);
}
const ev = db.prepare("select event_type, substr(summary,1,200) s from events where event_type like 'claimAutonomousTick%' order by created_at desc limit 3").all();
log('claim events (errors if any):', JSON.stringify(ev));
const final = metaOf().zk_continuation;
log('FINAL zk_continuation:', JSON.stringify({ exhausted: final.exhausted, valueSompi: final.valueSompi, outpoint: final.outpoint }), '| Σ claimed(token) =', String(claimedSum), '| 池 =', st0.consolidated_pool);
out.final = { exhausted: final.exhausted, claimedSum: String(claimedSum), pool: st0.consolidated_pool };

writeFileSync('seg4_claim_result.json', JSON.stringify(out, null, 1));
process.exit(0);
