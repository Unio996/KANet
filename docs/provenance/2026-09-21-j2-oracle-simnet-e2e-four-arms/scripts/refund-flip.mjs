// refund-flip.mjs — D 臂终局: harness 手拼 RootClose.refund_flip(simnet only · scratch only · 零改仓库码)。
// 🔴 定性(Bettor 裁定 2026-09-20 ~18:30Z): 这是【harness 手拼广播】, 证明"合约允许该路径(permissionless, 无签名, 第三方付 fee)", 不证明 driver 会自动走——
//    mainline 无 refund_flip 步骤(proto-tx-assembly-settlement.mjs 无该 builder / driver 无该 step)= N5b 未接线的活体证据。
// 复用仓库原语(不重写): computeRootCloseGenesisArtifact / encodeCloseCommitAction(通用 ABI 编码, 按 refund_flip 的 entryAbi.params 派发) / selectChangeShape /
//    assertImpliedFeeMatches / assertKaspadInputVersionRule / assertMassWithinCeiling / deriveLeafState。fee 输入由【throwaway 第三方私钥】签(不用 relay 私钥)。
// 用法:
//   node refund-flip.mjs fund          挖 1 块到 throwaway 地址(私钥存 refund-payer.key.json, 仅 simnet, 无价值)
//   node refund-flip.mjs plan          只读: 打印 D 的 RootClose 目标 outpoint / 现算 spk 是否链上未花 / 距 refund_flip 开门差多久
//   node refund-flip.mjs run [--wait]  构造 →(等 pmt≥deadline+2h+余量)→ 广播 → 轮询落链 → 读回新 RootClose 状态 closed=2
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const RUN = 'D:/kanet-tn12/scratch/_j2_e2e_run';
const WT = 'D:/kanet-tn12/scratch/_j2_wt_e2e';
const EVD = `${RUN}/evidence`;
for (const line of fs.readFileSync(`${RUN}/kanet.simnet.env`, 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
if (process.env.KASPA_NETWORK !== 'simnet' || !process.env.DB_PATH.includes('_j2_e2e_run')) { console.error('REFUSE: 不是隔离 simnet 配置'); process.exit(2); }
const state = JSON.parse(fs.readFileSync(`${RUN}/state.json`, 'utf8'));
const arms = JSON.parse(fs.readFileSync(`${RUN}/arms.json`, 'utf8'));
const marketId = arms[process.env.RF_ARM || 'D'];
const rec = (o) => fs.appendFileSync(`${EVD}/actions.jsonl`, JSON.stringify({ at: new Date().toISOString(), ...o }) + '\n');
const lib = (rel) => import(pathToFileURL(`${WT}/kasia-console/src/${rel}`).href);
const lc = (h) => String(h ?? '').replace(/^0x/i, '').toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REFUND_FLIP_GRACE_MS = 7_200_000;
const kaspa = createRequire(`${WT}/kasia-relay/`)('kaspa-wasm');
const { RpcClient, Encoding, PrivateKey, Address } = kaspa;
const keyFile = `${RUN}/refund-payer.key.json`;
const cmd = process.argv[2];

const rpc = new RpcClient({ url: state.rpc, encoding: Encoding.Borsh, networkId: 'simnet' }); await rpc.connect({});
const info0 = await rpc.getServerInfo(); if (info0.networkId !== 'simnet') { console.error('REFUSE: networkId != simnet'); process.exit(3); }
const nodeTimes = async () => { const dag = await rpc.getBlockDagInfo(); const si = await rpc.getServerInfo(); return { isSynced: si.isSynced, pmtMs: Number(dag.pastMedianTime), wallMs: Date.now(), daa: String(dag.virtualDaaScore) }; };
const spkToAddr = (spkHex) => kaspa.addressFromScriptPublicKey(new kaspa.ScriptPublicKey(0, lc(spkHex)), 'simnet').toString();

async function loadTarget() {
  const { sqlite } = await lib('db/client.js');
  const m = sqlite.prepare('SELECT id, status, deadline_ms, min_bet, seal_count, committee_pubkeys_json, rootclose_tmpl_hash, winning_side, settlement_frozen_at, frozen_reason FROM proto_markets WHERE id = ?').get(marketId);
  if (!m) throw new Error('market not found');
  const committeePubkeyHex = lc(JSON.parse(m.committee_pubkeys_json)[0]);
  const { deriveLeafState } = await lib('lib/proto-leaf-state.mjs');
  const s = deriveLeafState(marketId);
  const { computeRootCloseGenesisArtifact, loadProtocolConstants } = await lib('lib/proto-covenant-builder.mjs');
  const args = (st) => ({ marketId, committeePubkeyHex, deadlineMs: Number(m.deadline_ms), rootCloseTmplHash: lc(m.rootclose_tmpl_hash), state: st });
  const zero = '00'.repeat(32);
  const openState = { ...s, closed: 0, winningSide: 0, payoutRoot: zero };
  const cur = computeRootCloseGenesisArtifact(args(openState));
  const flipped = computeRootCloseGenesisArtifact(args({ ...openState, closed: 2 }));   // refund_flip: closed→2, winningSide/payoutRoot 保持
  // seal 已 landed 的 tx 输出0 = RootClose(closed:0) genesis: 从 seal 意图的 prepared_tx_json 取 txid 与 covenant id(链上另行核, 见 plan)
  const seal = sqlite.prepare("SELECT status, prepared_txid, prepared_tx_json FROM proto_settlement_intents WHERE subject_id = ? AND step = 'seal'").get(marketId);
  if (!seal || seal.status !== 'landed') throw new Error(`seal intent not landed: ${seal && seal.status}`);
  const txObj = JSON.parse(JSON.parse(seal.prepared_tx_json)[0]);
  const out0 = txObj.outputs[0];
  const covId = lc(out0.covenant?.covenantId ?? out0.covenant?.covenant_id);
  return { m, s, cur, flipped, sealTxid: lc(seal.prepared_txid), covId, out0, consts: loadProtocolConstants(), sqlite };
}

if (cmd === 'fund') {
  if (fs.existsSync(keyFile)) { console.log('key file exists, reuse'); } else {
    const priv = new PrivateKey(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex'));
    fs.writeFileSync(keyFile, JSON.stringify({ note: 'simnet throwaway third-party fee payer for refund_flip harness; worthless', privHex: priv.toString(), address: priv.toPublicKey().toAddress('simnet').toString() }));
  }
  const k = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  const tpl = await rpc.getBlockTemplate({ payAddress: k.address, extraData: [] });
  const r = await rpc.submitBlock({ block: tpl.block, allowNonDAABlocks: false });
  rec({ action: 'refund_flip_payer_funded', why: 'throwaway third-party fee payer (mined 1 block to it); proves refund_flip is permissionless and does not use relay key', payer: k.address.slice(0, 20) + '…', report: r.report?.type ?? String(r) });
  console.log('funded', k.address.slice(0, 20) + '…', JSON.stringify(r.report?.type ?? r));
} else if (cmd === 'plan' || cmd === 'run') {
  const T = await loadTarget();
  const rcAddr = spkToAddr(T.cur.scriptPubKeyHex);
  const utxos = (await rpc.getUtxosByAddresses([new Address(rcAddr)])).entries || [];
  const hit = utxos.find((e) => String(e.outpoint.transactionId) === T.sealTxid && Number(e.outpoint.index) === 0);
  const nt = await nodeTimes(); const openAtMs = Number(T.m.deadline_ms) + REFUND_FLIP_GRACE_MS;
  const plan = { marketId, status: T.m.status, frozen: T.m.frozen_reason, sealTxid: T.sealTxid, covId: T.covId, rootCloseAddr: rcAddr.slice(0, 24) + '…', rootCloseUtxoUnspentOnChain: !!hit, rootCloseUtxoValue: hit ? String(hit.amount) : null,
    curSpkMatchesSealOutput: lc(T.out0.scriptPublicKey?.script ?? T.out0.scriptPublicKey) .endsWith(lc(T.cur.scriptPubKeyHex).slice(-20)) || 'check-manually', node: nt, refundFlipOpensPmtMs: openAtMs, refundFlipOpensPmtIso: new Date(openAtMs).toISOString(), pmtMinusOpenMin: ((nt.pmtMs - openAtMs) / 60000).toFixed(2) };
  console.log(JSON.stringify(plan, null, 1));
  if (cmd === 'plan') { rec({ action: 'refund_flip_plan', ...plan }); await rpc.disconnect().catch(() => {}); process.exit(0); }

  // ── run ──
  if (!hit) throw new Error('RootClose UTXO 不在链上未花集(已被花? 或 seal 输出0 spk 不符) —— 停');
  const k = JSON.parse(fs.readFileSync(keyFile, 'utf8')); const priv = new PrivateKey(k.privHex);
  const payerAddr = new Address(k.address);
  const asm = await lib('lib/proto-tx-assembly.mjs');
  const asmS = await lib('lib/proto-tx-assembly-settlement.mjs');
  const { encodeCloseCommitAction, } = await lib('lib/proto-close-commit-witness.mjs');
  const { combineActionAndRedeem } = await lib('lib/proto-convert-to-rootclose-witness.mjs');
  const { assertMassWithinCeiling } = await lib('lib/proto-mass-ceiling.mjs');
  const rcSpkCur = asm.scriptPublicKeyFromHex(kaspa, T.cur.scriptPubKeyHex);
  const rcSpkNew = asm.scriptPublicKeyFromHex(kaspa, T.flipped.scriptPubKeyHex);
  const refundEntryAbi = T.cur.entries.refund_flip;
  if (!refundEntryAbi) throw new Error('RootClose entries 里没有 refund_flip');
  const lockTime = BigInt(Number(T.m.deadline_ms) + REFUND_FLIP_GRACE_MS);
  const rcOutpoint = { transactionId: T.sealTxid, index: 0 };
  const payerUtxos = (await rpc.getUtxosByAddresses([payerAddr])).entries || [];
  if (payerUtxos.length === 0) throw new Error('payer 无 UTXO —— 先 `node refund-flip.mjs fund` 并等币基成熟');
  // 选面值最大的一个当 fee 输入(coinbase 50 KAS ⇒ 带找零形状)
  const fu = payerUtxos.sort((a, b) => (BigInt(a.amount) < BigInt(b.amount) ? 1 : -1))[0];
  const feeOutpoint = { transactionId: String(fu.outpoint.transactionId), index: Number(fu.outpoint.index) };
  const feeValue = BigInt(fu.amount); const payerSpk = kaspa.payToAddressScript(payerAddr);
  const mkInput = (outpoint, value, spk, sig) => ({ previousOutpoint: outpoint, signatureScript: sig ?? new Uint8Array(0), sequence: 0n, sigOpCount: 0, computeBudget: asm.PROTO_V0_COMPUTE_BUDGET, utxo: { outpoint, amount: value, scriptPublicKey: spk, blockDaaScore: 0n } });
  const tokPrefixHex = '0x' + T.consts.token_prefix, tokSuffixHex = '0x' + T.consts.token_suffix;
  const mkTx = (changeSompi) => {
    const outputs = [new kaspa.TransactionOutput(asm.CONTINUATION_OUTPUT_SOMPI, rcSpkNew), ...(changeSompi === undefined ? [] : [new kaspa.TransactionOutput(changeSompi, payerSpk)])];
    outputs[0].covenant = new kaspa.CovenantBinding(0, new kaspa.Hash(T.covId));
    const witness = encodeCloseCommitAction(kaspa, refundEntryAbi, { rootOutIdx: 0, tok_prefix: tokPrefixHex, tok_suffix: tokSuffixHex });
    const rcSig = combineActionAndRedeem(kaspa, witness, T.cur.script);
    const t = new kaspa.Transaction({ version: 1, inputs: [mkInput(rcOutpoint, asm.CONTINUATION_OUTPUT_SOMPI, rcSpkCur, rcSig), mkInput(feeOutpoint, feeValue, payerSpk, new Uint8Array(0))], outputs, lockTime, subnetworkId: '0'.repeat(40), gas: 0n, payload: '' });
    t.outputs[0].covenant = new kaspa.CovenantBinding(0, new kaspa.Hash(T.covId));
    return t;
  };
  const shape = asm.selectChangeShape({ kaspa, network: 'simnet', leftoverSompi: feeValue, buildTxWithChange: (c) => mkTx(c), buildTxNoChange: () => mkTx(undefined), absFeeCapSompi: 100_000_000n });
  asm.assertImpliedFeeMatches(shape.tx, shape.netLoss, 'refund_flip'); asm.assertKaspadInputVersionRule(shape.tx, 'refund_flip');
  assertMassWithinCeiling({ kaspa, network: 'simnet', tx: shape.tx, inputHasCovenant: [true, false], feeUtxoValueSompi: feeValue, label: 'refund_flip' });
  // 第三方签 fee 输入(index 1)。RootClose 输入无签名(refund_flip 无 checkSig)。
  shape.tx.inputs[1].signatureScript = kaspa.createInputSignature(shape.tx, 1, priv, kaspa.SighashType.All);
  const expectedTxid = shape.tx.id;
  rec({ action: 'refund_flip_built', marketId, expectedTxid, lockTimeMs: Number(lockTime), lockTimeIso: new Date(Number(lockTime)).toISOString(), includeChange: shape.includeChange, requiredFee: String(shape.requiredFee), netLoss: String(shape.netLoss), payerPaysFee: true, signaturesOnRootCloseInput: 0, note: 'harness hand-assembled; RootClose input carries NO signature (refund_flip has no checkSig); fee input signed by throwaway third party' });
  console.log('built', expectedTxid);

  // 负对照(--neg): 开门前提交同一笔字节, 期望节点以 NotFinalized/lock time 拒收——证明 2h 闸不是摆设。若被接受(=意外)则如实记录, 该臂随之翻转(那本身就是发现)。
  if (process.argv.includes('--neg')) {
    const ntN = await nodeTimes();
    try { const r0 = await rpc.submitTransaction({ transaction: shape.tx, allowOrphan: false }); rec({ action: 'refund_flip_negative_control_ACCEPTED_UNEXPECTED', marketId, expectedTxid, node: ntN, pmtMinusLockMs: ntN.pmtMs - Number(lockTime), res: String(r0?.transactionId ?? r0) }); console.log('!!! UNEXPECTED ACCEPT', String(r0?.transactionId ?? r0)); }
    catch (e) { rec({ action: 'refund_flip_negative_control_rejected', marketId, expectedTxid, node: ntN, pmtMinusLockMs: ntN.pmtMs - Number(lockTime), error: String(e?.message ?? e).slice(0, 500) }); console.log('rejected as expected:', String(e?.message ?? e).slice(0, 300)); }
    await rpc.disconnect().catch(() => {}); process.exit(0);
  }
  // 等 pmt 真正越过 lockTime(节点 finality: tx.lock_time < pmt 严格小于) + 余量 30s
  const wait = process.argv.includes('--wait');
  for (;;) {
    const nt2 = await nodeTimes();
    if (nt2.pmtMs > Number(lockTime) + 30_000) { rec({ action: 'refund_flip_gate_open', node: nt2, pmtMinusLockMs: nt2.pmtMs - Number(lockTime) }); break; }
    if (!wait) { console.log('pmt 未过开门线, 未广播(加 --wait 则等)', JSON.stringify({ pmtMinusLockSec: (nt2.pmtMs - Number(lockTime)) / 1000 })); await rpc.disconnect().catch(() => {}); process.exit(0); }
    await sleep(15_000);
  }
  // 负对照(可选, 同一笔): 开门前提交应被节点拒——只在 --neg 且还没开门时做; 此处已开门, 不做。
  let subRes; try { subRes = await rpc.submitTransaction({ transaction: shape.tx, allowOrphan: false }); rec({ action: 'refund_flip_submitted', marketId, expectedTxid, res: String(subRes?.transactionId ?? subRes) }); console.log('submitted', String(subRes?.transactionId ?? subRes)); }
  catch (e) { rec({ action: 'refund_flip_submit_failed', marketId, expectedTxid, error: String(e?.message ?? e).slice(0, 600) }); console.error('SUBMIT FAILED', String(e?.message ?? e).slice(0, 600)); await rpc.disconnect().catch(() => {}); process.exit(1); }

  // 落链核 + 读回: 旧 RootClose UTXO 已花 ∧ 新 spk(closed=2)地址上出现输出0(txid=expectedTxid) ∧ 至少 N 个确认 daa
  const newAddr = spkToAddr(T.flipped.scriptPubKeyHex); const t0 = Date.now(); let landed = null;
  while (Date.now() - t0 < 5 * 60_000) {
    const u = (await rpc.getUtxosByAddresses([new Address(newAddr)])).entries || [];
    const oldLeft = ((await rpc.getUtxosByAddresses([new Address(rcAddr)])).entries || []).some((e) => String(e.outpoint.transactionId) === T.sealTxid && Number(e.outpoint.index) === 0);
    const nw = u.find((e) => String(e.outpoint.transactionId) === expectedTxid && Number(e.outpoint.index) === 0);
    if (nw && !oldLeft) { landed = { newOutpoint: `${expectedTxid}:0`, newValue: String(nw.amount), blockDaaScore: String(nw.blockDaaScore), oldRootCloseStillUnspent: oldLeft }; break; }
    await sleep(3000);
  }
  const nt3 = await nodeTimes();
  rec({ action: 'refund_flip_landed_check', marketId, landed, node: nt3, closedReadback: landed ? 'RootClose successor UTXO sits at the spk recomputed for state closed=2 (winningSide=0,payoutRoot=0) — state readback via P2SH spk equality' : 'NOT LANDED within 5min' });
  console.log(JSON.stringify({ landed, node: nt3 }, null, 1));
}
await rpc.disconnect().catch(() => {}); process.exitCode = 0; setTimeout(() => process.exit(0), 200);
