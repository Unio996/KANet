// sz_contract_probe.mjs — 账本1850 严格零方案: 在 2.0.1 simnet 真共识上对【新】KanetTokenClaim.retire + PoolSideTicket.sweep 做 正/负 向量。
// 同时回答 Bettor 的第一问: 现有 KTT 模板(TOKEN hash 不变)是否接受"owner covenant 同花、无 token 输出(销毁)"。
// 全部是 simnet 真广播(rpc.submitTransaction), 拒绝信息逐字记录。只碰 simnet(开头校验 networkId)。
// 用法: node sz_contract_probe.mjs   (env: ZK_SYSTEM_SINK_PK 不用——本脚本显式传 sink/retireDaa 给 artifact 函数)
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { kaspa, rpcConnect, sleep, log, daa, WT } from './szlib.mjs';
const OUT = 'D:/kanet-tn12/scratch/_j2_sz';
const imp = (p) => import(pathToFileURL(`${WT}/${p}`).href);
process.env.KASPA_NETWORK = 'simnet'; process.env.DB_PATH = `${OUT}/_probe.db`;
const A = await imp('kasia-console/src/lib/pool-bshard-artifacts.mjs');
const P = await imp('kasia-relay/src/lib/p2sh.mjs');
const { Transaction, TransactionOutput, Address, PrivateKey, ScriptBuilder, payToAddressScript, payToScriptHashScript, addressFromScriptPublicKey, createInputSignature, SighashType, CovenantBinding, GenesisCovenantGroup, Hash } = kaspa;
const NET = 'simnet';
const RD = Number(process.env.RD || 200);                      // retire/sweep 门槛(DAA), 小值 for simnet
const rpc = await rpcConnect();
const hex = (b) => Buffer.from(b).toString('hex');
const xonly = (priv) => hex(Buffer.from(payToAddressScript(priv.toPublicKey().toAddress('mainnet')).script, 'hex').subarray(1, 33));
const mk = () => new PrivateKey(hex(crypto.getRandomValues(new Uint8Array(32))));
const bank = new PrivateKey(readFileSync('D:/kanet-tn12/scratch/_j2_tok_sim/bank.key', 'utf8').trim());
const bankAddr = bank.toPublicKey().toAddress(NET).toString();
const sink = mk(), winner = mk(), bettor = mk(), attacker = mk();
const sinkPk = xonly(sink), winnerPk = xonly(winner), bettorPk = xonly(bettor);
const spkOf = (priv) => payToAddressScript(priv.toPublicKey().toAddress(NET));
const res = { RD, sinkPk, results: [] };
let fails = 0;
const record = (name, expect, got, detail) => { const ok = expect === got; if (!ok) fails++; res.results.push({ name, expect, got, ok, detail }); log(ok ? '  ✅' : '  ❌', name, `expect=${expect} got=${got}`, detail ? '| ' + String(detail).slice(0, 200) : ''); };
const tryTx = async (tx) => { try { const r = await rpc.submitTransaction({ transaction: tx, allowOrphan: false }); return { accepted: true, txid: r.transactionId }; } catch (e) { return { accepted: false, err: String(e.message || e).slice(0, 500) }; } };
const waitUtxo = async (addr, txid, idx, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const { entries } = await rpc.getUtxosByAddresses([new Address(addr)]); const e = entries.find((x) => x.outpoint.transactionId === txid && Number(x.outpoint.index) === idx); if (e) return e; await sleep(400); } throw new Error(`utxo ${txid.slice(0, 10)}:${idx} not seen at ${addr.slice(0, 20)}`); };
const gone = async (addr, txid, idx) => { const { entries } = await rpc.getUtxosByAddresses([new Address(addr)]); return !entries.some((x) => x.outpoint.transactionId === txid && Number(x.outpoint.index) === idx); };
const p2shAddr = (redeemHex) => P._addressFromRedeem(redeemHex, NET);
const combine = (actionHex, redeemHex) => { const b = ScriptBuilder.fromScript(actionHex, { flags: { covenantsEnabled: true } }); b.addData(new Uint8Array(Buffer.from(redeemHex, 'hex'))); return b.drain(); };
const hx = (h) => new Uint8Array(Buffer.from(String(h).replace(/^0x/, ''), 'hex'));

// ── 1. 构造合约实例 ──
const AMOUNT = 777n;
const marketCov = hex(crypto.getRandomValues(new Uint8Array(32)));
// KTT 模板(TOKEN hash 不变性)用任意 owner 现算一次
const kttProbe = A.computeKttTokenArtifact({ amount: Number(AMOUNT), ownerCovIdHex: marketCov });
const tokenTmplHash = kttProbe.templateHashHex;
log('KTT template hash (TOKEN):', tokenTmplHash);
res.tokenTmplHash = tokenTmplHash;
const claimArt = A.computeKanetTokenClaimArtifact({ marketCovIdHex: marketCov, winnerPkHex: winnerPk, amount: AMOUNT, tokenTmplHashHex: tokenTmplHash, sinkPkHex: sinkPk, retireDaa: RD });
res.claimTmplHash = claimArt.templateHashHex;
log('claim template hash:', claimArt.templateHashHex, 'redeem bytes', claimArt.script.length);
const claimRedeemHex = claimArt.script.toString('hex');
const claimAddr = p2shAddr(claimRedeemHex);

// ── 2. 造 claim_out + tok_out(同一笔 genesis, 与真实 claim 家族同法: claim=组A, tok=组B; tok.owner=claimCovId 两阶段) ──
const fundU = await (async () => { const { entries } = await rpc.getUtxosByAddresses([new Address(bankAddr)]); const e = entries.filter((x) => BigInt(x.amount) >= 3_000_000_000n && !x.isCoinbase).sort((a, b) => Number(BigInt(b.amount) - BigInt(a.amount)))[0] || entries.filter((x) => BigInt(x.amount) >= 3_000_000_000n)[0]; if (!e) throw new Error('bank has no >=30 KAS utxo'); return e; })();
const CLAIM_V = BigInt(process.env.CLAIM_V || 100_000_000), TOK_V = BigInt(process.env.TOK_V || 100_000_000), TICKET_V = BigInt(process.env.TICKET_V || 20_000_000);
const buildSetup = (tokRedeemHex, ticketRedeemHex) => {
  const tokAddr = tokRedeemHex ? p2shAddr(tokRedeemHex) : claimAddr;
  const outs = [
    new TransactionOutput(CLAIM_V, payToAddressScript(new Address(claimAddr))),
    new TransactionOutput(TOK_V, payToAddressScript(new Address(tokAddr))),
    new TransactionOutput(TICKET_V, payToAddressScript(new Address(p2shAddr(ticketRedeemHex)))),
  ];
  const change = BigInt(fundU.amount) - CLAIM_V - TOK_V - TICKET_V - 10_000_000n;
  outs.push(new TransactionOutput(change, payToAddressScript(new Address(bankAddr))));
  const mkT = (sig) => new Transaction({ version: 1, inputs: [{ previousOutpoint: { transactionId: fundU.outpoint.transactionId, index: fundU.outpoint.index }, signatureScript: sig || '', sequence: 0n, sigOpCount: 0, computeBudget: 100, ...(sig ? {} : { utxo: fundU }) }], outputs: outs, lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
  return { mkT };
};
// 票: bettor 的新 PoolSideTicket
const shardPoolId = hex(crypto.getRandomValues(new Uint8Array(32)));
const ticketArt = A.computePoolSideTicketArtifact({ bettorPk, direction: 0, stake: 500, shardPoolId, sinkPkHex: sinkPk, retireDaa: RD });
res.ticketTmplHash = ticketArt.templateHashHex;
const ticketRedeemHex = ticketArt.script.toString('hex'); const ticketAddr = p2shAddr(ticketRedeemHex);
log('ticket template hash:', ticketArt.templateHashHex);
// 阶段 A: 取 claimCovId
const s1 = buildSetup(null, ticketRedeemHex); const t1 = s1.mkT(null);
t1.populateGenesisCovenants([new GenesisCovenantGroup(0, [0])]);
const claimCovId = String(t1.outputs[0].covenant.covenantId);
const ktt = A.computeKttTokenArtifact({ amount: Number(AMOUNT), ownerCovIdHex: claimCovId });
const kttRedeemHex = ktt.script.toString('hex');
if (ktt.templateHashHex !== tokenTmplHash) throw new Error('KTT template hash drift between owners?!');
const s2 = buildSetup(kttRedeemHex, ticketRedeemHex); const t2 = s2.mkT(null);
t2.populateGenesisCovenants([new GenesisCovenantGroup(0, [0]), new GenesisCovenantGroup(0, [1])]);
if (String(t2.outputs[0].covenant.covenantId) !== claimCovId) throw new Error('claimCovId drift');
const sigB = createInputSignature(t2, 0, bank, SighashType.All);
const setupTx = s2.mkT(sigB); setupTx.populateGenesisCovenants([new GenesisCovenantGroup(0, [0]), new GenesisCovenantGroup(0, [1])]);
const rs = await tryTx(setupTx);
if (!rs.accepted) throw new Error('setup tx rejected: ' + rs.err);
log('setup tx', rs.txid, 'claimCov', claimCovId.slice(0, 12));
res.setupTxid = rs.txid; res.claimCovId = claimCovId;
const kttAddr = p2shAddr(kttRedeemHex);
const claimU = await waitUtxo(claimAddr, rs.txid, 0), tokU = await waitUtxo(kttAddr, rs.txid, 1), tickU = await waitUtxo(ticketAddr, rs.txid, 2);
const bornDaa = Number(claimU.blockDaaScore);
log('born daa', bornDaa, 'now', await daa(rpc));

const out = (v, priv) => new TransactionOutput(v, spkOf(priv));
// ── 3. retire 构造器(参数化以做负向量) ──
const compiledClaim = A.compileSilV100(`${WT}/kasia-console/src/lib/KanetTokenClaim.sil`, [
  A.ctorBytes32V100(marketCov), A.ctorBytes32V100(winnerPk), A.ctorIntV100(Number(AMOUNT)), A.ctorBytes32V100(tokenTmplHash), A.ctorBytes32V100(sinkPk), A.ctorIntV100(RD)], 'KanetTokenClaim');
const retireTag = compiledClaim._raw.contracts.KanetTokenClaim.entries.retire.dispatch_tag;
const compiledTicket = A.compileSilV100(`${WT}/kasia-console/src/lib/sil-v1/PoolSideTicket.sil`, [
  A.ctorBytes32V100(bettorPk), A.ctorIntV100(0), A.ctorIntV100(500), A.ctorBytes32V100(shardPoolId), A.ctorBytes32V100(sinkPk), A.ctorIntV100(RD)], 'PoolSideTicket');
const sweepTag = compiledTicket._raw.contracts.PoolSideTicket.entries.sweep.dispatch_tag;
if (compiledClaim.script.length !== claimArt.script.length) throw new Error('claim redeem drift');
const FEE = 2_000_000n;
const CB = { claim: 300, tok: 100, ticket: 100 };   // 默认(宽); 正向量前用 scriptOk() 搜最小预算
const retireTx = ({ cbClaim = CB.claim, cbTok = CB.tok, claimSeq = RD, outs, withTok = true, tokIdx = 1, tokPrefix = ktt.templatePrefix, tokSuffix = ktt.templateSuffix, tag = retireTag }) => {
  const action = (() => { const b = new ScriptBuilder({ flags: { covenantsEnabled: true } }); b.addI64(BigInt(tokIdx)); b.addData(new Uint8Array(tokPrefix)); b.addData(new Uint8Array(tokSuffix)); b.addData(hx(tag)); return b.drain(); })();
  const claimSig = combine(action, claimRedeemHex);
  const tokSig = combine(P._encodeKttTransferZeroOutAction(ktt.entryAbi.dispatch_tag, ktt.stateFieldCount, [0]), kttRedeemHex);
  const inputs = [{ previousOutpoint: { transactionId: claimU.outpoint.transactionId, index: claimU.outpoint.index }, signatureScript: claimSig, sequence: BigInt(claimSeq), sigOpCount: 0, computeBudget: cbClaim }];
  if (withTok) inputs.push({ previousOutpoint: { transactionId: tokU.outpoint.transactionId, index: tokU.outpoint.index }, signatureScript: tokSig, sequence: 0n, sigOpCount: 0, computeBudget: cbTok });
  return new Transaction({ version: 1, inputs, outputs: outs, lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
};
const total = BigInt(claimU.amount) + BigInt(tokU.amount);

const sweepTx = ({ seq = RD, cb = CB.ticket, outs, tag = sweepTag }) => {
  const b = new ScriptBuilder({ flags: { covenantsEnabled: true } }); b.addData(hx(tag));
  const sig = (() => { const bb = ScriptBuilder.fromScript(b.drain(), { flags: { covenantsEnabled: true } }); bb.addData(new Uint8Array(Buffer.from(ticketRedeemHex, 'hex'))); return bb.drain(); })();
  return new Transaction({ version: 1, inputs: [{ previousOutpoint: { transactionId: tickU.outpoint.transactionId, index: tickU.outpoint.index }, signatureScript: sig, sequence: BigInt(seq), sigOpCount: 0, computeBudget: cb }], outputs: outs, lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
};
const tv0 = BigInt(tickU.amount);
{ const rr = await tryTx(sweepTx({ outs: [out(tv0 - 1_000_000n, sink)] })); record('ticket sweep→sink 但 age<RD(早扫, 卡市场向量)', 'rejected', rr.accepted ? 'accepted' : 'rejected', rr.err); }
const isScriptErr = (e) => /failed to verify the signature script|sequence locks/.test(e || '');
const feeNeeded = (e) => { const m = /required amount of (d+) for compute mass (d+)/.exec(e || ''); return m ? { fee: BigInt(m[1]), mass: Number(m[2]) } : null; };
const searchMin = async (label, cands, build) => { for (const c of cands) { const rr = await tryTx(build(c)); if (rr.accepted) return { c, accepted: true, rr }; if (!isScriptErr(rr.err)) { log('  budget', label, c, 'script OK (rejected only by', (rr.err || '').slice(-90), ')'); return { c, accepted: false, rr }; } } return null; };
// ── 4. 负向量: retire(此时 age 远小于 RD) ──
log('— retire 负向量 —');
let r;
r = await tryTx(retireTx({ outs: [out(total - FEE, sink)] })); record('retire@age<RD (正确形状但太早)', 'rejected', r.accepted ? 'accepted' : 'rejected', r.err);

// 等到 age ≥ RD
while ((await daa(rpc)) - bornDaa < RD + 20) await sleep(1500);
log('age now', (await daa(rpc)) - bornDaa);
r = await tryTx(retireTx({ claimSeq: 0, outs: [out(total - FEE, sink)] })); record('retire@age>=RD 但 sequence=0', 'rejected', r.accepted ? 'accepted' : 'rejected', r.err);
r = await tryTx(retireTx({ outs: [out(total - FEE, attacker)] })); record('retire 输出到 attacker 而非 sink', 'rejected', r.accepted ? 'accepted' : 'rejected', r.err);
r = await tryTx(retireTx({ outs: [out(total - FEE, winner)] })); record('retire 输出到 winner(赢家密钥)', 'rejected', r.accepted ? 'accepted' : 'rejected', r.err);
r = await tryTx(retireTx({ outs: [out(total - FEE - 20_000_000n, sink)] })); record('retire 输出值 < Σin - MAX_FEE(少给 sink)', 'rejected', r.accepted ? 'accepted' : 'rejected', r.err);
r = await tryTx(retireTx({ outs: [out(total - FEE - 10_000_000n, sink), out(10_000_000n - 1n, attacker)] })); record('retire 多一个输出(截走 KAS)', 'rejected', r.accepted ? 'accepted' : 'rejected', r.err);
{ // token re-output: 把代币重新铸给 attacker 的假 covenant(带 CovenantBinding), 同时 sink 收 KAS
  const fakeOwner = hex(crypto.getRandomValues(new Uint8Array(32)));
  const k2 = A.computeKttTokenArtifact({ amount: Number(AMOUNT), ownerCovIdHex: fakeOwner });
  const tok2 = new TransactionOutput(1_000_000n, payToAddressScript(new Address(p2shAddr(k2.script.toString('hex')))));
  r = await tryTx(retireTx({ outs: [out(total - FEE - 1_000_000n, sink), tok2] })); record('retire 同笔把代币重铸给他人(token re-output)', 'rejected', r.accepted ? 'accepted' : 'rejected', r.err);
}
r = await tryTx(retireTx({ withTok: false, outs: [out(BigInt(claimU.amount) - FEE, sink)] })); record('retire 只花 claim 不带代币 UTXO', 'rejected', r.accepted ? 'accepted' : 'rejected', r.err);
r = await tryTx(retireTx({ tokIdx: 0, outs: [out(total - FEE, sink)] })); record('retire tok_in_idx 指向自己(0)', 'rejected', r.accepted ? 'accepted' : 'rejected', r.err);
// winner 密钥无任何 spend 路径: 用 winner 签名 + 假 spend 入口尝试直接把 claim_out 的 KAS 花到 winner
{
  const b = new ScriptBuilder({ flags: { covenantsEnabled: true } }); b.addData(new Uint8Array(65)); b.addData(hx('deadbeef')); // 随便的 sig + 不存在的 dispatch tag
  const sig = combine(b.drain(), claimRedeemHex);
  const tx = new Transaction({ version: 1, inputs: [{ previousOutpoint: { transactionId: claimU.outpoint.transactionId, index: claimU.outpoint.index }, signatureScript: sig, sequence: 0n, sigOpCount: 0, computeBudget: 300 }], outputs: [out(BigInt(claimU.amount) - FEE, winner)], lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
  r = await tryTx(tx); record('winner 密钥尝试直接花 claim_out(无 spend 入口, 伪 dispatch)', 'rejected', r.accepted ? 'accepted' : 'rejected', r.err);
}
{ // winner 单独花 tok_out(转给自己名下): 无 claim 输入在场 ⇒ owner 在场检查失败
  const tokSig = combine(P._encodeKttTransferZeroOutAction(ktt.entryAbi.dispatch_tag, ktt.stateFieldCount, [0]), kttRedeemHex);
  const tx = new Transaction({ version: 1, inputs: [{ previousOutpoint: { transactionId: tokU.outpoint.transactionId, index: tokU.outpoint.index }, signatureScript: tokSig, sequence: 0n, sigOpCount: 0, computeBudget: 100 }], outputs: [out(BigInt(tokU.amount) - FEE, winner)], lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
  r = await tryTx(tx); record('winner 单独花 tok_out(无 claim 输入在场)', 'rejected', r.accepted ? 'accepted' : 'rejected', r.err);
}

// ── 5. 正向量: retire 到 sink + 销毁代币(KTT 无 token 输出) ──
log('— retire 正向量 —');
let sRetire = null, sSweep = null;
{ // 先搜最小 computeBudget(只看是否还是脚本错误; 不够预算 ⇒ 脚本错, 够了 ⇒ 仅费用不足)
  const cands = []; for (const cc of [60, 80, 100, 120, 150, 200, 300]) for (const ct of [20, 30, 40, 60, 100]) cands.push([cc, ct]);
  cands.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
  sRetire = await searchMin('retire(claim,tok)', cands, ([cc, ct]) => retireTx({ cbClaim: cc, cbTok: ct, outs: [out(total - FEE, sink)] }));
  const f = sRetire; if (f) { CB.claim = f.c[0] + 10; CB.tok = f.c[1] + 10; res.retireBudgetMin = { claim: f.c[0], tok: f.c[1], used: { claim: CB.claim, tok: CB.tok } }; log('retire budgets min', f.c, 'use', CB.claim, CB.tok); }
}
let rf = sRetire?.accepted ? sRetire.rr : await tryTx(retireTx({ outs: [out(total - FEE, sink)] })); let retireFee = FEE;
for (let i = 0; i < 3 && !rf.accepted && feeNeeded(rf.err); i++) { const fn = feeNeeded(rf.err); retireFee = fn.fee + 1000n; res.retireMass = fn.mass; rf = await tryTx(retireTx({ outs: [out(total - retireFee, sink)] })); }
r = rf; res.retireFeeSompi = String(retireFee);
record('retire@age>=RD + sequence=RD + 输出=sink 全额 + 无代币输出(销毁)', 'accepted', r.accepted ? 'accepted' : 'rejected', r.err || r.txid);
res.retireTxid = r.txid;
if (r.accepted) {
  const sinkAddr = sink.toPublicKey().toAddress(NET).toString();
  const su = await waitUtxo(sinkAddr, r.txid, 0, 30000).catch(() => null);
  record('sink 收到 Σin-fee', String(total - retireFee), su ? String(su.amount) : 'none');
  record('claim_out 与 tok_out 均已被花(代币 UTXO 销毁)', 'true', String((await gone(claimAddr, rs.txid, 0)) && (await gone(kttAddr, rs.txid, 1))));
}

// ── 6. 票 sweep ──
log('— ticket sweep —');
const tv = BigInt(tickU.amount), TF = 1_000_000n;
r = await tryTx(sweepTx({ seq: 0, outs: [out(tv - TF, sink)] })); record('ticket sweep: sequence=0', 'rejected', r.accepted ? 'accepted' : 'rejected', r.err);
r = await tryTx(sweepTx({ outs: [out(tv - TF, bettor)] })); record('ticket: bettor 密钥把票扫到自己地址', 'rejected', r.accepted ? 'accepted' : 'rejected', r.err);
r = await tryTx(sweepTx({ outs: [out(tv - TF, attacker)] })); record('ticket: 扫到任意非 sink 地址', 'rejected', r.accepted ? 'accepted' : 'rejected', r.err);
r = await tryTx(sweepTx({ outs: [out(tv - TF - 6_000_000n, sink)] })); record('ticket: 输出值 < 输入 - MAX_FEE', 'rejected', r.accepted ? 'accepted' : 'rejected', r.err);
r = await tryTx(sweepTx({ outs: [out(tv - TF - 1000n, sink), out(1000n, attacker)] })); record('ticket: 多一个输出', 'rejected', r.accepted ? 'accepted' : 'rejected', r.err);
// bettor 签名 + 旧 authorize_spend 的假 tag
{ const b = new ScriptBuilder({ flags: { covenantsEnabled: true } }); b.addData(new Uint8Array(65)); b.addData(hx('00000000'));
  const sig = (() => { const bb = ScriptBuilder.fromScript(b.drain(), { flags: { covenantsEnabled: true } }); bb.addData(new Uint8Array(Buffer.from(ticketRedeemHex, 'hex'))); return bb.drain(); })();
  const tx = new Transaction({ version: 1, inputs: [{ previousOutpoint: { transactionId: tickU.outpoint.transactionId, index: tickU.outpoint.index }, signatureScript: sig, sequence: 0n, sigOpCount: 0, computeBudget: 100 }], outputs: [out(tv - TF, bettor)], lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
  r = await tryTx(tx); record('ticket: 旧 authorize_spend(bettorSig) 形状', 'rejected', r.accepted ? 'accepted' : 'rejected', r.err); }
{ const cands = [20, 30, 40, 60, 80, 100]; const f = sSweep = await searchMin('ticket', cands, (c) => sweepTx({ cb: c, outs: [out(tv - TF, sink)] })); if (f) { CB.ticket = f.c + 10; res.ticketBudgetMin = { min: f.c, used: CB.ticket }; log('ticket budget min', f.c); } }
let rt = sSweep?.accepted ? sSweep.rr : await tryTx(sweepTx({ outs: [out(tv - TF, sink)] })); let sweepFee = TF;
for (let i = 0; i < 3 && !rt.accepted && feeNeeded(rt.err); i++) { const fn = feeNeeded(rt.err); sweepFee = fn.fee + 1000n; res.sweepMass = fn.mass; rt = await tryTx(sweepTx({ outs: [out(tv - sweepFee, sink)] })); }
r = rt; res.sweepFeeSompi = String(sweepFee);
record('ticket sweep→sink(age≥RD, seq=RD, 单输出, 值足)', 'accepted', r.accepted ? 'accepted' : 'rejected', r.err || r.txid);
res.sweepTxid = r.txid;
// 早扫(age<RD)负向量需要另一张新票——见 sz_ticket_early.mjs(同脚本第二阶段): 这里在 setup 之后立即测会更准, 见下方 early 记录
res.fails = fails;
writeFileSync(`${OUT}/sz_contract_probe_result.json`, JSON.stringify(res, (k, v) => (typeof v === 'bigint' ? String(v) : v), 1));
log(fails ? `RESULT: ${fails} 项与预期不符` : 'RESULT: 全部符合预期');
process.exit(fails ? 1 : 0);
