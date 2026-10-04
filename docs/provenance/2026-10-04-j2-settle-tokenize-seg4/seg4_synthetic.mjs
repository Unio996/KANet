// seg4_synthetic.mjs — 账本 1832 段4 验收(refund_claim / escape_trigger / escape_claim): simnet 官方 kaspad 2.0.1 真共识。
//   这三个入口的前置状态在真管线里【难以触达】: refund_claim 需要 PS closed==2(委员 cancel_attest 路径, V2 没有自治 cancel 流程); escape 需要 attestedAtMs + 6 小时。
//   所以本脚本【合成前置状态】(harness 引导, 非生产路径): 用生产 relay 的 genesis-mint 命令铸出带指定状态的 PayoutShardV2(closed=2 / closed=1 且 attestedAtMs=now−7h)与池代币(KTT, owner=该 PS cov),
//   然后从这一刻起【全部走生产构造器】: zk_handoff(生产 relay 命令)、escape_trigger、escape_claim、refund_claim(claim 家族三阶段编排)。
//   诚实边界: 合成的只是「起始状态怎么来的」(委员背书/时间流逝由 harness 直接烤进 genesis 状态), 合约入口与 builder 的每一步都是真共识。
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { http, relays, kaspa, rpcConnect, sleep, log, FUNDS_SECRET } from './lib.mjs';
process.env.DB_PATH = 'D:/kanet-tn12/scratch/_j2_tok_sim/console.simnet.db'; process.env.CONSOLE_ENCRYPTION_KEY ||= '2'.repeat(64); process.env.KASPA_NETWORK ||= 'simnet';
for (const l of readFileSync('env.simnet.template', 'utf8').split('\n')) { const mm = /^(ZK_[A-Z_]+|SILVERC_V100_PATH)=(.*)$/.exec(l.trim()); if (mm) process.env[mm[1]] = mm[2]; }
const imp = (p) => import(pathToFileURL(`D:/kanet-tn12/scratch/_j2_wt_tokenize/kasia-console/src/${p}`).href);
const art = await imp('lib/pool-bshard-artifacts.mjs');
const reg = await imp('lib/pool-shard-register.mjs');
const { runTokenClaim, claimFeeInputSompi } = await imp('lib/zk-token-claim-orchestrator.mjs');
const { payoutRoot, merkleProof } = await imp('lib/pool-payout-root.mjs');
const { computeKttTokenArtifact, computeKanetTokenClaimArtifact, compileSilV100, ctorIntV100, ctorBytes32V100 } = art;
const rpc = await rpcConnect();
const settler = relays.settler;
const MODE = process.env.MODE || 'both';   // refund | escape | both
const tmpl = reg.readZkTemplateHashes();
const addrOf = (hex) => kaspa.addressFromScriptPublicKey(kaspa.payToScriptHashScript(new Uint8Array(Buffer.from(hex, 'hex'))), 'simnet').toString();
const getUtxos = async (a) => { const { entries } = await rpc.getUtxosByAddresses([new kaspa.Address(a)]); return entries.map((e) => ({ outpoint: { transactionId: e.outpoint.transactionId, index: e.outpoint.index }, amount: String(e.amount), entry: e })); };
const sendRaw = async (cmd) => { const j = await http('POST', `/api/relay/${settler.id}/send-command`, cmd); if (j.ok === false || j.error) { const e = new Error(JSON.stringify(j).slice(0, 800)); e.raw = j; throw e; } return j; };
const landedAt = async (address, txid) => { for (let i = 0; i < 80; i++) { if ((await getUtxos(address)).some((u) => u.outpoint.transactionId === txid)) return true; await sleep(400); } return false; };
const fundUtxo = async (kas) => {
  const j = await http('POST', `/api/relay/${settler.id}/transfer`, { to: settler.address, amount: Number(kas).toFixed(8) }, { 'x-kanet-admin-secret': FUNDS_SECRET });
  if (!j.txId) throw new Error('fund fail ' + JSON.stringify(j)); if (!(await landedAt(settler.address, j.txId))) throw new Error('fund not landed');
  return { address: settler.address, outpointTxid: j.txId, index: 0 };
};
const H = (x) => '0x' + x, z32 = '00'.repeat(32);
const dbgExe = 'D:/silverscript/versioned-builds/cli-debugger-v100-3ed9733.exe';
const SIL = (n) => `D:/kanet-tn12/scratch/_j2_wt_tokenize/kasia-console/src/lib/${n}`;
function dbgRun(label, silFile, fn, ctor, args, dump) {
  const tx = { active_input_index: 0,
    inputs: dump.inputs.map((i) => ({ prev_txid: i.prev_txid, prev_index: i.prev_index, sequence: 0, sig_op_count: 0, utxo_value: Number(i.utxo_value), ...(i.covenant_id ? { covenant_id: H(i.covenant_id) } : {}), ...(i.utxo_script_hex ? { utxo_script_hex: H(i.utxo_script_hex) } : {}), signature_script_hex: H(i.signature_script_hex) })),
    outputs: dump.outputs.map((o) => ({ value: Number(o.value), script_hex: H(o.script_hex), ...(o.covenant_id ? { covenant_id: H(o.covenant_id), authorizing_input: o.authorizing_input ?? 0 } : {}) })),
    ...(dump.tx_time != null ? { tx_time: dump.tx_time } : {}) };
  const file = `dbg_${label}.test.json`; writeFileSync(file, JSON.stringify({ tests: [{ name: label, function: fn, constructor_args: ctor, args, expect: 'pass', tx }] }));
  let o = ''; try { o = execFileSync(dbgExe, [SIL(silFile), '--test-file', file, '--run-all'], { encoding: 'utf8', maxBuffer: 1 << 28 }); } catch (e) { o = String(e.stdout || '') + String(e.stderr || ''); }
  const pass = /\bPASS\b/.test(o) && !/\bFAIL\b/.test(o);
  const at = /-->\s*(\d+):\d+/.exec(o); const lineNo = at ? Number(at[1]) : null;
  const reqLine = lineNo ? (o.split(/\r?\n/).map((l) => l.trimStart()).find((l) => l.startsWith(`${lineNo} |`))?.slice(`${lineNo} |`.length).trim() ?? null) : null;
  writeFileSync(`dbg_${label}.out.txt`, o.slice(0, 2500));
  return { pass, lineNo, reqLine };
}

// ── PS 合成: 任意状态的 PayoutShardV2 genesis ──
function compilePs(st) {
  const mk = (len) => [ctorBytes32V100(st.pmr ?? '11'.repeat(32)), ctorBytes32V100(st.pc ?? '22'.repeat(32)), ctorBytes32V100(st.anchor ?? '33'.repeat(32)), ctorBytes32V100(tmpl.tokenTmplHash),
    ctorIntV100(Number(st.pool)), ctorIntV100(st.closed), ctorBytes32V100(st.payoutRoot ?? z32), ...Array.from({ length: 17 }, () => ctorIntV100(0)),
    ctorIntV100(st.winner ?? -1), ctorIntV100(st.atMs ?? 0), ctorBytes32V100(st.bets ?? z32), ctorBytes32V100(st.refund ?? z32), ctorBytes32V100(tmpl.claimTmplHash), ctorIntV100(len)];
  let guess = 29300;
  for (let r = 0; r < 6; r++) { const c = compileSilV100(SIL('PayoutShardV2.sil'), mk(guess), 'PayoutShardV2'); const L = Buffer.from(c.script).length; if (L === guess) return { redeemHex: Buffer.from(c.script).toString('hex'), ownLen: L }; guess = L; }
  throw new Error('PS own_redeem_len 不收敛');
}
async function mintPs(st) {
  const { redeemHex, ownLen } = compilePs(st);
  const f = await fundUtxo(1);
  const r = await sendRaw({ type: 'bshard_genesis_mint_payout', payoutshard: { redeem_hex: redeemHex, seedSompi: '20000000' }, inputs: { funding: f }, outputs: { change_address: settler.address } });
  const psAddr = addrOf(redeemHex); if (!(await landedAt(psAddr, r.txId || r.txid))) throw new Error('PS genesis not landed');
  const covId = r.payoutCovId;
  const tokArt = computeKttTokenArtifact({ amount: Number(st.pool), ownerCovIdHex: covId });
  const f2 = await fundUtxo(1);
  const t = await sendRaw({ type: 'bshard_genesis_mint_stake_chip', chip: { redeem_hex: tokArt.script.toString('hex'), seedSompi: '40000000' }, inputs: { funding: f2 }, outputs: { change_address: settler.address } });
  if (!(await landedAt(addrOf(tokArt.script.toString('hex')), t.txId || t.txid))) throw new Error('pool token genesis not landed');
  return { psTx: r.txId || r.txid, covId, redeemHex, ownLen, psAddr, tokTx: t.txId || t.txid };
}
const refundLeaves = [{ pk: relays.bettorA.xonly, amount: 1_000_000_000n }, { pk: relays.bettorB.xonly, amount: 2_000_000_000n }, { pk: relays['oracle-1'].xonly, amount: 500_000_000n }];
const POOL = refundLeaves.reduce((a, l) => a + l.amount, 0n);
const root = payoutRoot(refundLeaves).toString('hex');
const sibsOf = (i) => merkleProof(refundLeaves, i).map((b) => b.toString('hex'));
const out = { refund: { negatives: {}, claims: [] }, escape: { negatives: {}, claims: [] } };

// 通用: claim 家族一个场景(refund_claim 或 escape_claim)
async function runFamily(tag, kind, selfInit, cfg) {
  const R = out[tag];
  let cur = { redeemHex: selfInit.redeemHex, txid: selfInit.txid, index: 0, pool: POOL };
  const mkArgs = (i, extra = {}) => ({ kind, self: { redeemHex: cur.redeemHex, txid: cur.txid, index: cur.index }, pool: cur.pool, bettorPk: refundLeaves[i].pk, amount: refundLeaves[i].amount, merkleIndex: i, siblingsHex: sibsOf(i),
    relayCall: sendRaw, p2sh: async (h) => addrOf(h), tokenTmplHash: tmpl.tokenTmplHash, claimTmplHash: tmpl.claimTmplHash, ...extra });
  const withFee = async (extra) => { const f = await fundUtxo(claimFeeInputSompi() / 1e8); return runTokenClaim({ ...mkArgs(extra.i ?? 0, extra), fee: { address: f.address, txid: f.outpointTxid, index: f.index } }); };
  const dbgCtor = cfg.dbgCtor, dbgFile = cfg.silFile, dbgFn = cfg.fn; let ndW = null; const selfCov0 = () => selfCovHolder;
  const claimArgs = (dump, w) => [dump.selfOutIdx ?? 0, dump.claimOutIdx, 1, dump.tokOutIdx, dump.remainOutIdx ?? 0, H(w.bettor_pk), Number(w.amount), w.merkle_index, ...w.siblings_hex.map(H), H(w.tok_prefix_hex), H(w.tok_suffix_hex), H(w.claim_prefix_hex), H(w.claim_suffix_hex)];
  async function negative(label, mutate) {
    let dbg = null, rejected = null, wCap = null;
    const mutateFinal = (c) => { mutate?.(c); wCap = c.witness; };
    try {
      const dry = await withFee({ i: 0, dryRun: true, mutateFinal });
      dbg = dbgRun(`${tag}_${label}`, dbgFile, dbgFn, dbgCtor, claimArgs({ ...dry, selfOutIdx: 0 }, wCap), dry);
      await withFee({ i: 0, mutateFinal });
    } catch (e) { rejected = e.message; }
    log(`NEG ${tag}/${label}: ${rejected ? 'REJECTED ✓' : '‼️ ACCEPTED (BAD)'} | debugger=${JSON.stringify(dbg)}`); log(`   text: ${(rejected || '').slice(0, 420)}`);
    R.negatives[label] = { rejected: !!rejected, text: rejected, debugger: dbg };
    if (!rejected) throw new Error('negative accepted: ' + label);
  }
  let selfCovHolder = null;
  await negative('NA_amount_tampered', (c) => { c.witness.amount = String(BigInt(c.witness.amount) + 1n); });
  const selfCov = (await sendRaw({ type: kindCmd(kind), inputs: { self: { redeem_hex: cur.redeemHex, outpointTxid: cur.txid, index: cur.index } }, witness: {}, outputs: {} })).selfCovId;
  selfCovHolder = selfCov;
  await negative('NB_token_owner_wrong', (c) => { c.outputs.tok_out.redeem_hex = computeKttTokenArtifact({ amount: Number(c.witness.amount), ownerCovIdHex: selfCov }).script.toString('hex'); });
  // NC: 自续约输出被篡改(harness 重签)
  {
    let dbg = null, rejected = null;
    try {
      const dry = await withFee({ i: 0, dryRun: true });
      const claimA = computeKanetTokenClaimArtifact({ marketCovIdHex: selfCov, winnerPkHex: refundLeaves[0].pk, amount: refundLeaves[0].amount, tokenTmplHashHex: tmpl.tokenTmplHash });
      const ktt = computeKttTokenArtifact({ amount: 1, ownerCovIdHex: '00'.repeat(31) + '01' });
      const w = { bettor_pk: refundLeaves[0].pk, amount: refundLeaves[0].amount.toString(), merkle_index: 0, siblings_hex: sibsOf(0), tok_prefix_hex: ktt.templatePrefix.toString('hex'), tok_suffix_hex: ktt.templateSuffix.toString('hex'), claim_prefix_hex: claimA.templatePrefix.toString('hex'), claim_suffix_hex: claimA.templateSuffix.toString('hex') };
      const tam = JSON.parse(JSON.stringify(dry)); const bb = Buffer.from(tam.outputs[0].script_hex, 'hex'); bb[bb.length - 5] ^= 1; tam.outputs[0].script_hex = bb.toString('hex');
      dbg = dbgRun(`${tag}_NC_self_continuation_tampered`, dbgFile, dbgFn, dbgCtor, claimArgs({ ...tam, selfOutIdx: 0 }, w), tam);
      // 重签提交
      const relayPriv = new kaspa.PrivateKey(settler.priv);
      const addrs = dry.inputs.map((i, k) => (k === 0 ? addrOf(cur.redeemHex) : k === 1 ? kaspa.addressFromScriptPublicKey(new kaspa.ScriptPublicKey(0, i.utxo_script_hex), 'simnet').toString() : settler.address));
      const entries = (await rpc.getUtxosByAddresses(addrs.map((a) => new kaspa.Address(a)))).entries;
      const entryOf = (txid, idx) => entries.find((e) => e.outpoint.transactionId === txid && Number(e.outpoint.index) === Number(idx));
      const outs = dry.outputs.map((o, k) => { let sc = o.script_hex; if (k === 0) { const b2 = Buffer.from(sc, 'hex'); b2[b2.length - 5] ^= 1; sc = b2.toString('hex'); } return new kaspa.TransactionOutput(BigInt(o.value), new kaspa.ScriptPublicKey(0, sc), o.covenant_id ? new kaspa.CovenantBinding(o.authorizing_input ?? 0, new kaspa.Hash(o.covenant_id)) : undefined); });
      const mk = (sigs) => new kaspa.Transaction({ version: 1, inputs: dry.inputs.map((i, k) => ({ previousOutpoint: { transactionId: i.prev_txid, index: i.prev_index }, signatureScript: sigs ? sigs[k] : '', sequence: 0n, sigOpCount: 0, computeBudget: k === 0 ? 300 : 100, ...(sigs ? {} : { utxo: entryOf(i.prev_txid, i.prev_index) }) })), outputs: outs, lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
      const un = mk(null); const feeSig = kaspa.createInputSignature(un, 2, relayPriv, kaspa.SighashType.All);
      await rpc.submitTransaction({ transaction: mk([dry.inputs[0].signature_script_hex, dry.inputs[1].signature_script_hex, feeSig]), allowOrphan: false });
    } catch (e) { rejected = e.message; }
    log(`NEG ${tag}/NC_self_continuation_tampered: ${rejected ? 'REJECTED ✓' : '‼️ ACCEPTED (BAD)'} | debugger=${JSON.stringify(dbg)}`); log(`   text: ${(rejected || '').slice(0, 300)}`);
    R.negatives.NC_self_continuation_tampered = { rejected: !!rejected, text: rejected, debugger: dbg };
    if (!rejected) throw new Error('NC accepted');
  }
  log(`${tag}: after negatives self UTXO count =`, (await getUtxos(addrOf(cur.redeemHex))).length);
  // 诚实: 先领最后一个 leaf(partial)→ 重放同一 leaf(nullifier) → leaf0(partial) → leaf1(最后一位, full)
  const honest = async (i) => {
    const sj = await withFee({ i });
    const landAddr = sj.isLast ? sj.claimOutAddress : sj.selfContAddress;
    if (!(await landedAt(landAddr, sj.txId))) throw new Error('claim not landed');
    R.claims.push({ leaf: i, amount: refundLeaves[i].amount.toString(), txId: sj.txId, isLast: sj.isLast, newPool: sj.newPool, claimCovId: sj.claimCovId });
    log(`${tag} HONEST claim leaf ${i} amount=${refundLeaves[i].amount} isLast=${sj.isLast} txId=${sj.txId} newPool=${sj.newPool}`);
    if (!sj.isLast) cur = { redeemHex: sj.selfContRedeemHex, txid: sj.txId, index: 0, pool: BigInt(sj.newPool) };
    return sj;
  };
  await honest(2);
  let nd = null; try { await withFee({ i: 2 }); } catch (e) { nd = e.message; }
  log(`${tag} ND double-claim:`, nd ? 'REJECTED ✓ ' + nd.slice(0, 200) : '‼️ ACCEPTED (BAD)'); R.negatives.ND_double_claim = { rejected: !!nd, text: nd, note: 'relay 预检(nullifier bit)拦在广播前' };
  if (!nd) throw new Error('double claim accepted');
  // ND 的【VM 层】证据: 用「leaf2 的 pk/amount/merkle 见证 + w 位图已置位 bit2 + 当前池」喂 cli-debugger(tx 上下文取下一笔诚实 claim 的 dry_run 真字节) ⇒ 应死在 nullifier require
  {
    const dry0 = await withFee({ i: 0, dryRun: true, mutateFinal: (c) => { ndW = c.witness; } });
    const claimA2 = computeKanetTokenClaimArtifact({ marketCovIdHex: selfCov0(), winnerPkHex: refundLeaves[2].pk, amount: refundLeaves[2].amount, tokenTmplHashHex: tmpl.tokenTmplHash });
    const ctorND = dbgCtor.slice(); ctorND[cfg.poolIdx] = Number(cur.pool); ctorND[cfg.wIdx] = 4;   // w0 的 bit2 已置位
    const w2 = { bettor_pk: refundLeaves[2].pk, amount: refundLeaves[2].amount.toString(), merkle_index: 2, siblings_hex: sibsOf(2), tok_prefix_hex: ndW.tok_prefix_hex, tok_suffix_hex: ndW.tok_suffix_hex, claim_prefix_hex: claimA2.templatePrefix.toString('hex'), claim_suffix_hex: claimA2.templateSuffix.toString('hex') };
    const ndDbg = dbgRun(`${tag}_ND_vm`, dbgFile, dbgFn, ctorND, claimArgs({ ...dry0, selfOutIdx: 0 }, w2), dry0);
    R.negatives.ND_double_claim.vmDebugger = ndDbg; log(`${tag} ND(VM, cli-debugger):`, JSON.stringify(ndDbg));
  }
  await honest(0); await honest(1);
  const left = await getUtxos(addrOf(cur.redeemHex));
  R.finalSelfUtxos = left.length; log(`${tag}: 最后一位领完后 self(续约)UTXO =`, left.length, '(最后一笔无续约, 该地址上应为 0 笔——cur 指向倒数第二笔续约)');
}
const kindCmd = (k) => ({ claim: 'closezk_v2_claim', escape_claim: 'closezk_v2_escape_claim', refund_claim: 'bshard_refund_claim_v2' }[k]);

// ══════════════════ refund_claim(PS closed==2) ══════════════════
if (MODE === 'refund' || MODE === 'both') {
  log('── refund_claim: 合成 PS(closed=2, payoutRoot=refund 树根, pool=' + POOL + ') ──');
  const ps = await mintPs({ pool: POOL, closed: 2, payoutRoot: root });
  log('PS genesis', ps.psTx, 'cov', ps.covId.slice(0, 12), 'tokens genesis', ps.tokTx);
  const dbgCtor = [H('11'.repeat(32)), H('22'.repeat(32)), H('33'.repeat(32)), H(tmpl.tokenTmplHash), Number(POOL), 2, H(root), ...Array(17).fill(0), -1, 0, H(z32), H(z32), H(tmpl.claimTmplHash), ps.ownLen];
  await runFamily('refund', 'refund_claim', { redeemHex: ps.redeemHex, txid: ps.psTx }, { silFile: 'PayoutShardV2.sil', fn: 'refund_claim', dbgCtor, poolIdx: 4, wIdx: 7 });
}

// ══════════════════ escape(CloseZkV2 closed==1 → 3 → escape_claim) ══════════════════
if (MODE === 'escape' || MODE === 'both') {
  const atMs = Date.now() - 7 * 3600 * 1000;
  log('── escape: 合成 PS(closed=1, attestedAtMs=now−7h=' + atMs + ', refundRootBaked=refund 树根) → 生产 zk_handoff → escape_trigger → escape_claim ──');
  const betsRoot = 'ab'.repeat(32);
  const anchorInfo = reg.computeCloseZkTmplAnchor(process.env.ZK_CLOSEZK_SIL_PATH, process.env.ZK_GATE_TMPL_HASH, tmpl.tokenTmplHash, tmpl.claimTmplHash);
  const ps = await mintPs({ pool: POOL, closed: 1, winner: 1, atMs, bets: betsRoot, refund: root, anchor: anchorInfo.anchorHex });
  log('PS genesis', ps.psTx, 'cov', ps.covId.slice(0, 12));
  // zk_handoff(生产 relay 命令, 两步 probe; 同 seg2)
  const tags = reg.settleDispatchTags();
  const psTokArt = computeKttTokenArtifact({ amount: Number(POOL), ownerCovIdHex: ps.covId });
  const tokU = (await getUtxos(addrOf(psTokArt.script.toString('hex'))))[0];
  const hf = await fundUtxo(0.5);
  const hcmd = { type: 'bshard_zk_handoff', dryRun: false,
    inputs: { payoutshard: { redeem_hex: ps.redeemHex, outpointTxid: ps.psTx, index: 0, state: { consolidated_pool: POOL.toString(), attestedWinner: 1, attestedAtMs: atMs, betsRootBaked: betsRoot, refundRootBaked: root } },
      ps_token: { redeem_hex: psTokArt.script.toString('hex'), outpointTxid: tokU.outpoint.transactionId, index: Number(tokU.outpoint.index) }, fee: hf },
    witness: { self_out_idx: 0, token_out_idx: 1, template_a_hex: anchorInfo.templateA.toString('hex'), template_b_hex: anchorInfo.templateB.toString('hex'), template_c_hex: anchorInfo.templateC.toString('hex'), template_d_hex: anchorInfo.templateD.toString('hex'),
      handoff_dispatch_tag_hex: tags.zk_handoff, tok_prefix_hex: psTokArt.templatePrefix.toString('hex'), tok_suffix_hex: psTokArt.templateSuffix.toString('hex'), token_transfer_dispatch_tag_hex: psTokArt.entryAbi.dispatch_tag, token_transfer_state_field_count: psTokArt.stateFieldCount },
    outputs: { change_address: settler.address } };
  const probe = await sendRaw({ ...hcmd });
  const tokOutArt = computeKttTokenArtifact({ amount: Number(POOL), ownerCovIdHex: probe.zkCovId });
  hcmd.outputs = { change_address: settler.address, tok_out: { redeem_hex: tokOutArt.script.toString('hex'), owner_cov_id_hex: probe.zkCovId } };
  const hr = await sendRaw(hcmd);
  if (!(await landedAt(hr.closeZkAddress, hr.txId))) throw new Error('handoff not landed');
  log('zk_handoff tx', hr.txId, 'CloseZkV2 cov', hr.zkCovId.slice(0, 12));
  out.escape.handoffTx = hr.txId;
  const czRedeem = hr.closeZkRedeemHex;
  const czOwnLen = Buffer.from(czRedeem, 'hex').length;
  // escape_trigger: 负向(阈值未到) + 诚实
  const kttT = computeKttTokenArtifact({ amount: 1, ownerCovIdHex: '00'.repeat(31) + '01' });
  const threshold = atMs + 21_600_000;
  const trig = async (lockMs, extra = {}) => { const f = await fundUtxo(0.3); return sendRaw({ type: 'closezk_v2_escape_trigger', lock_time: lockMs, inputs: { closezk: { redeem_hex: czRedeem, outpointTxid: hr.txId, index: 0 }, fee: f }, witness: { tok_prefix_hex: kttT.templatePrefix.toString('hex'), tok_suffix_hex: kttT.templateSuffix.toString('hex'), dispatch_tag_hex: tags.closezk_escape_trigger }, outputs: { change_address: settler.address }, ...extra }); };
  let early = null, earlyDbg = null;
  try {
    const dry = await trig(threshold - 1, { dry_run: true });
    earlyDbg = dbgRun('escape_trigger_early', 'CloseZkV2.sil', 'escape_trigger',
      [H(process.env.ZK_GATE_TMPL_HASH), H(betsRoot), H(root), atMs, 1, 1, H(z32), Number(POOL), ...Array(17).fill(0), H(tmpl.tokenTmplHash), H(tmpl.claimTmplHash), czOwnLen], [0, H(kttT.templatePrefix.toString('hex')), H(kttT.templateSuffix.toString('hex'))], { ...dry, tx_time: threshold - 1 });
    await trig(threshold - 1);
  } catch (e) { early = e.message; }
  log('NEG escape_trigger/early(lock_time=threshold−1):', early ? 'REJECTED ✓ ' + early.slice(0, 300) : '‼️ ACCEPTED (BAD)', '| debugger=', JSON.stringify(earlyDbg));
  out.escape.negatives.trigger_early = { rejected: !!early, text: early, debugger: earlyDbg }; if (!early) throw new Error('early escape_trigger accepted');
  const tr = await trig(threshold);
  const czCont = tr.selfContRedeemHex;
  if (!(await landedAt(tr.selfContAddress, tr.txId))) throw new Error('escape_trigger not landed');
  log('HONEST escape_trigger tx', tr.txId, '(closed 1→3)'); out.escape.triggerTx = tr.txId;
  const dbgCtor = [H(process.env.ZK_GATE_TMPL_HASH), H(betsRoot), H(root), atMs, 1, 3, H(z32), Number(POOL), ...Array(17).fill(0), H(tmpl.tokenTmplHash), H(tmpl.claimTmplHash), czOwnLen];
  if (process.env.GATE_TEST === '1') {   // 门③(rehearsal claim gate)验收: 同一 closed==3 状态上, 诚实 ⇒ pass; 金额被改 ⇒ fail
    const gate = await imp('lib/rehearsal-pre-broadcast-gate.mjs');
    const mkGate = async (i, amount) => { const f = await fundUtxo(claimFeeInputSompi() / 1e8);
      return gate.gateTokenClaim({ kind: 'escape_claim', closeZk: { redeemHex: czCont, txid: tr.txId, index: 0 }, pool: POOL, bettorPk: refundLeaves[i].pk, amount, merkleIndex: i, siblingsHex: sibsOf(i), fee: { address: f.address, txid: f.outpointTxid, index: f.index },
        relayCall: sendRaw, p2sh: async (h) => addrOf(h), tokenTmplHash: tmpl.tokenTmplHash, claimTmplHash: tmpl.claimTmplHash,
        beforeState: { gateTmplHash: process.env.ZK_GATE_TMPL_HASH, betsRootBaked: betsRoot, refundRootBaked: root, attestedAtMs: atMs, attestedWinner: 1, closed: 3, payoutRootHex: z32, consolidatedPool: POOL, tokenTmplHash: tmpl.tokenTmplHash, claimTmplHash: tmpl.claimTmplHash, ownRedeemLen: czOwnLen } }); };
    const g1 = await mkGate(0, refundLeaves[0].amount); const g2 = await mkGate(0, refundLeaves[0].amount + 1n);
    log('GATE honest:', g1.gate, g1.error ?? '', '| tampered amount:', g2.gate, g2.error ?? '');
    writeFileSync('seg4_gate_test.json', JSON.stringify({ honest: { gate: g1.gate, error: g1.error, stdout: g1.debugger?.stdout?.slice(-400) }, tampered: { gate: g2.gate, error: g2.error, stdout: g2.debugger?.stdout?.slice(-600) } }, null, 1));
    process.exit(0);
  }
  await runFamily('escape', 'escape_claim', { redeemHex: czCont, txid: tr.txId }, { silFile: 'CloseZkV2.sil', fn: 'escape_claim', dbgCtor, poolIdx: 7, wIdx: 8 });
}
writeFileSync(`seg4_synthetic_result_${MODE}.json`, JSON.stringify(out, null, 1));
process.exit(0);
