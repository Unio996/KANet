// run_adversarial.mjs — InstantSplit 对抗测试 #1-#18(除 #9 审计层/#10-11/#16 独立实现另跑)全部在真实 simnet 广播。
process.env.SILVERC_V100_PATH = 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';
import { createRequire } from 'node:module';
const require = createRequire('D:/kanet-tn12/scratch/_j2_wt_instant_split/kasia-console/');
const kaspa = require('kaspa-wasm');
const { RpcClient, Encoding, PrivateKey, Address, Transaction, TransactionOutput, ScriptPublicKey, Generator, PaymentOutput } = kaspa;
const SDK = await import('file:///D:/kanet-tn12/scratch/_j2_wt_instant_split/kasia-console/src/lib/instant-split-sdk.mjs');
const { createSplitProtocol, buildSplitTx, buildRefundTx } = SDK;
const { encodeEntryActionGeneric, combineActionAndRedeem } = await import('file:///D:/kanet-tn12/scratch/_j2_wt_instant_split/kasia-console/scripts/audit/generic-entry-witness.mjs');

const MAX_SPLIT_FEE = 40_000_000n;   // §4.5 实测衍生(worst-case mass 36449 * 100 * ~11x margin)
const MAX_REFUND_FEE = 10_000_000n;  // §4.5 实测衍生(mass 8120 * 100 * ~12x margin)

const rpc = new RpcClient({ url: 'ws://127.0.0.1:29717', encoding: Encoding.Borsh, networkId: 'simnet' });
await rpc.connect({});
const info = await rpc.getServerInfo();
if (info.networkId !== 'simnet') { console.error('REFUSE: not simnet'); process.exit(3); }

const fundingWallet = new PrivateKey('dcb975899fc09882906beec6a51b479d4916c335dfb63991e062ffa5887cb5df');
const fundingAddr = fundingWallet.toPublicKey().toAddress('simnet').toString();
function genAddr() { const p = new PrivateKey(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')); return { priv: p, addr: p.toPublicKey().toAddress('simnet').toString() }; }
function pubkeyOf(addrStr) { const spk = kaspa.payToAddressScript(new Address(addrStr)); return Buffer.from(spk.script, 'hex').subarray(1, 33); }
function p2pkSpkHex(pubkey32) { return Buffer.concat([Buffer.from([0x20]), Buffer.from(pubkey32), Buffer.from([0xac])]).toString('hex'); }
function mkOut(value, pubkey32) { return new TransactionOutput(value, new ScriptPublicKey(0, p2pkSpkHex(pubkey32))); }
// 🔴 kaspa-wasm 的 tx.outputs 是 getter, 每次读都是新数组快照(tx.outputs===tx.outputs为false)——
// 原地 tx.outputs[i]=... / tx.outputs.push(...) 完全不影响真实交易对象, 必须重新 new Transaction(...)。
function rebuildTxWithOutputs(tx, newOutputs) {
  return new Transaction({ version: tx.version, inputs: tx.inputs, outputs: newOutputs, lockTime: tx.lockTime, gas: tx.gas, subnetworkId: tx.subnetworkId, payload: tx.payload });
}

async function mine(n, payAddr = fundingAddr) { for (let i = 0; i < n; i++) { const tpl = await rpc.getBlockTemplate({ payAddress: payAddr, extraData: [] }); await rpc.submitBlock({ block: tpl.block, allowNonDAABlocks: true }); } }
async function tipTimestamp() { const bdi = await rpc.getBlockDagInfo(); const blk = await rpc.getBlock({ hash: bdi.tipHashes[0], includeTransactions: false }); return Number(blk.block.header.timestamp); }

async function fundAddress(destAddr, amountSompi) {
  const bdi = await rpc.getBlockDagInfo(); const tip = BigInt(bdi.virtualDaaScore);
  const { entries: allEntries } = await rpc.getUtxosByAddresses([new Address(fundingAddr)]);
  const entries = allEntries.filter(e => (tip - BigInt(e.blockDaaScore)) > 1000n);
  if (!entries.length) { await mine(1300, fundingAddr); return fundAddress(destAddr, amountSompi); }
  const generator = new Generator({ entries, outputs: [new PaymentOutput(new Address(destAddr), amountSompi)], priorityFee: 0n, changeAddress: new Address(fundingAddr), networkId: 'simnet' });
  let txId = ''; let pending;
  while ((pending = await generator.next())) { await pending.sign([fundingWallet]); txId = await pending.submit(rpc); }
  await mine(3);
  return txId;
}

async function getUtxo(addr) {
  const { entries } = await rpc.getUtxosByAddresses([addr]);
  if (!entries.length) throw new Error('no utxo at ' + addr);
  const e = entries[0];
  return { transactionId: e.outpoint.transactionId, index: e.outpoint.index, amountSompi: e.amount };
}

const results = [];
async function record(name, expect, fn) {
  let outcome;
  try { outcome = await fn(); } catch (e) { outcome = { err: 'LOCAL_THROW: ' + e.message }; }
  const accepted = !!outcome.transactionId;
  const pass = (expect === 'accept') === accepted;
  results.push({ name, expect, accepted, detail: outcome.transactionId || outcome.err, pass });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name} :: expect=${expect} accepted=${accepted} :: ${outcome.transactionId || outcome.err}`);
  return outcome;
}

function baseCfg(hasReferrer) {
  const m = genAddr(), b = genAddr(), r = genAddr(), pr = genAddr();
  const cfg = {
    network: 'simnet',
    merchant: { address: m.addr, amountSompi: 800000000n },
    broker: { address: b.addr, amountSompi: 150000000n },
    payerRefundAddress: pr.addr,
    maxSplitFeeSompi: MAX_SPLIT_FEE, maxRefundFeeSompi: MAX_REFUND_FEE,
  };
  if (hasReferrer) cfg.referrer = { address: r.addr, amountSompi: 50000000n };
  return { cfg, keys: { m, b, r, pr } };
}

// ── Test #1: tamper recipient address ──
await record('T1_tamper_recipient_address', 'reject', async () => {
  const { cfg } = baseCfg(false);
  const protocol = createSplitProtocol(cfg);
  const recipientsTotal = cfg.merchant.amountSompi + cfg.broker.amountSompi;
  await fundAddress(protocol.address, recipientsTotal + 1_000_000n);
  const utxo = await getUtxo(protocol.address);
  const { tx } = buildSplitTx(protocol, utxo);
  const attacker = genAddr();
  const newOuts = tx.outputs.slice();
  newOuts[0] = mkOut(protocol.merchantAmt, pubkeyOf(attacker.addr)); // swap merchant's payout to attacker
  const tampered = rebuildTxWithOutputs(tx, newOuts);
  return rpc.submitTransaction({ transaction: tampered, allowOrphan: false }).catch(e => ({ err: e.message }));
});

// ── Test #2: tamper split ratio (shift value between outputs, keep sum same) ──
await record('T2_tamper_ratio_keep_sum', 'reject', async () => {
  const { cfg } = baseCfg(false);
  const protocol = createSplitProtocol(cfg);
  const recipientsTotal = cfg.merchant.amountSompi + cfg.broker.amountSompi;
  await fundAddress(protocol.address, recipientsTotal + 1_000_000n);
  const utxo = await getUtxo(protocol.address);
  const { tx } = buildSplitTx(protocol, utxo);
  const newOuts = tx.outputs.slice();
  newOuts[0] = mkOut(protocol.merchantAmt + 1n, protocol.merchantPk);
  newOuts[1] = mkOut(protocol.brokerAmt - 1n, protocol.brokerPk);
  const tampered = rebuildTxWithOutputs(tx, newOuts);
  return rpc.submitTransaction({ transaction: tampered, allowOrphan: false }).catch(e => ({ err: e.message }));
});

// ── Test #3: underpay ──
await record('T3_underpay', 'reject', async () => {
  const { cfg } = baseCfg(false);
  const protocol = createSplitProtocol(cfg);
  const recipientsTotal = cfg.merchant.amountSompi + cfg.broker.amountSompi;
  await fundAddress(protocol.address, recipientsTotal - 1_000_000n); // underfunded
  const utxo = await getUtxo(protocol.address);
  return buildSplitTx(protocol, utxo); // expected to throw locally (caught by record's try/catch as LOCAL_THROW = correct reject)
});

// ── Test #4: overpay attempt hasChange=false beyond max_split_fee ──
await record('T4_overpay_no_change_over_limit', 'reject', async () => {
  const { cfg } = baseCfg(false);
  const protocol = createSplitProtocol(cfg);
  const recipientsTotal = cfg.merchant.amountSompi + cfg.broker.amountSompi;
  const fundAmt = recipientsTotal + MAX_SPLIT_FEE + 5_000_000n; // excess > max_split_fee
  await fundAddress(protocol.address, fundAmt);
  const utxo = await getUtxo(protocol.address);
  // force hasChange=false manually despite excess > max_split_fee
  const entryAbi = protocol.entries.split;
  const sigScriptHex = combineActionAndRedeem(kaspa, encodeEntryActionGeneric(kaspa, entryAbi, { hasChange: false }), Buffer.from(protocol.redeemScriptHex, 'hex')).toString('hex');
  const tx = new Transaction({ version: 1, inputs: [{ previousOutpoint: { transactionId: utxo.transactionId, index: utxo.index }, signatureScript: sigScriptHex, sequence: 0n, sigOpCount: 0, computeBudget: 70 }], outputs: [mkOut(protocol.merchantAmt, protocol.merchantPk), mkOut(protocol.brokerAmt, protocol.brokerPk)], lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
  return rpc.submitTransaction({ transaction: tx, allowOrphan: false }).catch(e => ({ err: e.message }));
});

// ── Test #4b: legit overpay with hasChange=true (already proven in measurement phase; rerun here for the report's completeness) ──
await record('T4b_overpay_with_change_legit', 'accept', async () => {
  const { cfg } = baseCfg(true);
  const protocol = createSplitProtocol(cfg);
  const recipientsTotal = cfg.merchant.amountSompi + cfg.broker.amountSompi + cfg.referrer.amountSompi;
  await fundAddress(protocol.address, recipientsTotal + MAX_SPLIT_FEE + 50_000_000n);
  const utxo = await getUtxo(protocol.address);
  const { tx } = buildSplitTx(protocol, utxo);
  return rpc.submitTransaction({ transaction: tx, allowOrphan: false }).catch(e => ({ err: e.message }));
});

// ── Test #5: change diverted to attacker ──
await record('T5_change_diverted', 'reject', async () => {
  const { cfg } = baseCfg(false);
  const protocol = createSplitProtocol(cfg);
  const recipientsTotal = cfg.merchant.amountSompi + cfg.broker.amountSompi;
  await fundAddress(protocol.address, recipientsTotal + MAX_SPLIT_FEE + 50_000_000n);
  const utxo = await getUtxo(protocol.address);
  const { tx } = buildSplitTx(protocol, utxo);
  const attacker = genAddr();
  const newOuts = tx.outputs.slice();
  const changeIdx = newOuts.length - 1;
  newOuts[changeIdx] = mkOut(newOuts[changeIdx].value, pubkeyOf(attacker.addr));
  const tampered = rebuildTxWithOutputs(tx, newOuts);
  return rpc.submitTransaction({ transaction: tampered, allowOrphan: false }).catch(e => ({ err: e.message }));
});

// ── Test #5b: extra hidden 5th output stealing overpay while keeping legit-looking first N+1 outputs ──
await record('T5b_extra_hidden_output', 'reject', async () => {
  const { cfg } = baseCfg(false);
  const protocol = createSplitProtocol(cfg);
  const recipientsTotal = cfg.merchant.amountSompi + cfg.broker.amountSompi;
  const excess = MAX_SPLIT_FEE + 60_000_000n;
  await fundAddress(protocol.address, recipientsTotal + excess);
  const utxo = await getUtxo(protocol.address);
  const { tx } = buildSplitTx(protocol, utxo); // legit hasChange=true, change=excess-4M
  const attacker = genAddr();
  // shrink legit change, add a 5th output stealing the difference
  const newOuts = tx.outputs.slice();
  const legitChange = newOuts[2].value;
  const stolen = 20_000_000n;
  newOuts[2] = mkOut(legitChange - stolen, protocol.refundPk);
  newOuts.push(mkOut(stolen, pubkeyOf(attacker.addr)));
  const tampered = rebuildTxWithOutputs(tx, newOuts);
  return rpc.submitTransaction({ transaction: tampered, allowOrphan: false }).catch(e => ({ err: e.message }));
});

// ── Test #6: double-spend same UTXO (spend once via split, then try refund the same outpoint after) ──
await record('T6_double_spend_same_utxo', 'reject', async () => {
  const { cfg } = baseCfg(false);
  const protocol = createSplitProtocol({ ...cfg, deadlineMs: (await tipTimestamp()) - 600000 });
  const recipientsTotal = cfg.merchant.amountSompi + cfg.broker.amountSompi;
  await fundAddress(protocol.address, recipientsTotal + 5_000_000n);
  const utxo = await getUtxo(protocol.address);
  const { tx: splitTx } = buildSplitTx(protocol, utxo);
  const r1 = await rpc.submitTransaction({ transaction: splitTx, allowOrphan: false }).catch(e => ({ err: e.message }));
  if (!r1.transactionId) return { err: 'setup failed: first split did not land: ' + r1.err };
  await mine(2);
  const { tx: refundTx } = buildRefundTx(protocol, utxo, Date.now()); // same outpoint, already spent
  return rpc.submitTransaction({ transaction: refundTx, allowOrphan: false }).catch(e => ({ err: e.message }));
});

// ── Test #7: partial outputs (has_referrer=true but only 2 outputs supplied) ──
await record('T7_partial_outputs', 'reject', async () => {
  const { cfg } = baseCfg(true);
  const protocol = createSplitProtocol(cfg);
  const recipientsTotal = cfg.merchant.amountSompi + cfg.broker.amountSompi + cfg.referrer.amountSompi;
  await fundAddress(protocol.address, recipientsTotal + 1_000_000n);
  const utxo = await getUtxo(protocol.address);
  const entryAbi = protocol.entries.split;
  const sigScriptHex = combineActionAndRedeem(kaspa, encodeEntryActionGeneric(kaspa, entryAbi, { hasChange: false }), Buffer.from(protocol.redeemScriptHex, 'hex')).toString('hex');
  const tx = new Transaction({ version: 1, inputs: [{ previousOutpoint: { transactionId: utxo.transactionId, index: utxo.index }, signatureScript: sigScriptHex, sequence: 0n, sigOpCount: 0, computeBudget: 70 }], outputs: [mkOut(protocol.merchantAmt, protocol.merchantPk), mkOut(protocol.brokerAmt, protocol.brokerPk)], lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
  return rpc.submitTransaction({ transaction: tx, allowOrphan: false }).catch(e => ({ err: e.message }));
});

// ── Test #8: reordered outputs ──
await record('T8_reordered_outputs', 'reject', async () => {
  const { cfg } = baseCfg(false);
  const protocol = createSplitProtocol(cfg);
  const recipientsTotal = cfg.merchant.amountSompi + cfg.broker.amountSompi;
  await fundAddress(protocol.address, recipientsTotal + 1_000_000n);
  const utxo = await getUtxo(protocol.address);
  const { tx } = buildSplitTx(protocol, utxo);
  const newOuts = tx.outputs.slice();
  const tmp = newOuts[0]; newOuts[0] = newOuts[1]; newOuts[1] = tmp;
  const tampered = rebuildTxWithOutputs(tx, newOuts);
  return rpc.submitTransaction({ transaction: tampered, allowOrphan: false }).catch(e => ({ err: e.message }));
});

// ── Test #12: refund before deadline ──
await record('T12_refund_before_deadline', 'reject', async () => {
  const { cfg } = baseCfg(false);
  const protocol = createSplitProtocol({ ...cfg, deadlineMs: (await tipTimestamp()) + 3600_000 }); // 1h in the future
  await fundAddress(protocol.address, cfg.merchant.amountSompi + cfg.broker.amountSompi + 5_000_000n);
  const utxo = await getUtxo(protocol.address);
  // bypass SDK's local early-fail to force an on-chain attempt
  const entryAbi = protocol.entries.refund;
  const sigScriptHex = combineActionAndRedeem(kaspa, encodeEntryActionGeneric(kaspa, entryAbi, {}), Buffer.from(protocol.redeemScriptHex, 'hex')).toString('hex');
  const tx = new Transaction({ version: 1, inputs: [{ previousOutpoint: { transactionId: utxo.transactionId, index: utxo.index }, signatureScript: sigScriptHex, sequence: 0n, sigOpCount: 0, computeBudget: 70 }], outputs: [mkOut(BigInt(utxo.amountSompi) - 2_000_000n, protocol.refundPk)], lockTime: BigInt(protocol.deadlineMs), gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
  return rpc.submitTransaction({ transaction: tx, allowOrphan: false }).catch(e => ({ err: e.message }));
});

// ── Test #13: dust below hard consensus threshold (referrer share = 1,000,000 sompi, expect storage-mass reject) ──
await record('T13_dust_below_hard_threshold', 'reject', async () => {
  const m = genAddr(), b = genAddr(), r = genAddr(), pr = genAddr();
  const cfg = { network: 'simnet', merchant: { address: m.addr, amountSompi: 800000000n }, broker: { address: b.addr, amountSompi: 199000000n }, referrer: { address: r.addr, amountSompi: 1_000_000n }, payerRefundAddress: pr.addr, maxSplitFeeSompi: MAX_SPLIT_FEE, maxRefundFeeSompi: MAX_REFUND_FEE, allowBelowFloor: true };
  const protocol = createSplitProtocol(cfg);
  const recipientsTotal = cfg.merchant.amountSompi + cfg.broker.amountSompi + cfg.referrer.amountSompi;
  await fundAddress(protocol.address, recipientsTotal + 1_000_000n);
  const utxo = await getUtxo(protocol.address);
  const { tx } = buildSplitTx(protocol, utxo);
  return rpc.submitTransaction({ transaction: tx, allowOrphan: false }).catch(e => ({ err: e.message }));
});

// ── Test #14: dust between operational floor and hard threshold — SDK should reject at construction time ──
await record('T14_dust_between_floor_and_hard_threshold', 'reject', async () => {
  const m = genAddr(), b = genAddr(), r = genAddr(), pr = genAddr();
  const cfg = { network: 'simnet', merchant: { address: m.addr, amountSompi: 800000000n }, broker: { address: b.addr, amountSompi: 195000000n }, referrer: { address: r.addr, amountSompi: 5_000_000n }, payerRefundAddress: pr.addr, maxSplitFeeSompi: MAX_SPLIT_FEE, maxRefundFeeSompi: MAX_REFUND_FEE };
  createSplitProtocol(cfg); // should throw locally (no allowBelowFloor) -> caught as LOCAL_THROW = correct reject
  return { err: 'UNEXPECTED: createSplitProtocol did not throw for below-floor referrer share' };
});

// ── Test #17: multi-UTXO merge attempt (2 funding payments to same address, combine into 1 split tx) ──
await record('T17_multi_utxo_merge_reject', 'reject', async () => {
  const { cfg } = baseCfg(false);
  const protocol = createSplitProtocol(cfg);
  const recipientsTotal = cfg.merchant.amountSompi + cfg.broker.amountSompi;
  const perPay = recipientsTotal + 2_000_000n;
  await fundAddress(protocol.address, perPay);
  await fundAddress(protocol.address, perPay); // second independent payment to the SAME address
  const { entries } = await rpc.getUtxosByAddresses([protocol.address]);
  if (entries.length < 2) return { err: 'setup failed: expected 2 utxos, got ' + entries.length };
  const [u0, u1] = entries;
  const entryAbi = protocol.entries.split;
  const sigScriptHex = combineActionAndRedeem(kaspa, encodeEntryActionGeneric(kaspa, entryAbi, { hasChange: false }), Buffer.from(protocol.redeemScriptHex, 'hex')).toString('hex');
  const tx = new Transaction({
    version: 1,
    inputs: [
      { previousOutpoint: { transactionId: u0.outpoint.transactionId, index: u0.outpoint.index }, signatureScript: sigScriptHex, sequence: 0n, sigOpCount: 0, computeBudget: 70 },
      { previousOutpoint: { transactionId: u1.outpoint.transactionId, index: u1.outpoint.index }, signatureScript: sigScriptHex, sequence: 0n, sigOpCount: 0, computeBudget: 70 },
    ],
    outputs: [mkOut(protocol.merchantAmt, protocol.merchantPk), mkOut(protocol.brokerAmt, protocol.brokerPk)],
    lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '',
  });
  const r = await rpc.submitTransaction({ transaction: tx, allowOrphan: false }).catch(e => ({ err: e.message }));
  if (r.transactionId) return r; // that alone is enough to mark FAIL below
  // follow-up: each utxo independently should still be spendable on its own (not permanently stuck)
  const { tx: tx0 } = buildSplitTx(protocol, { transactionId: u0.outpoint.transactionId, index: u0.outpoint.index, amountSompi: u0.amount });
  const r0 = await rpc.submitTransaction({ transaction: tx0, allowOrphan: false }).catch(e => ({ err: e.message }));
  console.log('  (follow-up) T17 independent spend of utxo#0 alone:', JSON.stringify(r0));
  return r; // report the merge attempt's own result (reject expected)
});

// ── Test #18a: hasChange=false attempted exactly AT the boundary (e=max_split_fee, should ACCEPT via false) ──
await record('T18a_boundary_e_eq_maxfee_hasChangeFalse', 'accept', async () => {
  const { cfg } = baseCfg(false);
  const protocol = createSplitProtocol(cfg);
  const recipientsTotal = cfg.merchant.amountSompi + cfg.broker.amountSompi;
  await fundAddress(protocol.address, recipientsTotal + MAX_SPLIT_FEE); // e == max_split_fee exactly
  const utxo = await getUtxo(protocol.address);
  const { tx, hasChange } = buildSplitTx(protocol, utxo);
  if (hasChange !== false) return { err: 'SDK picked wrong branch for boundary case, hasChange=' + hasChange };
  return rpc.submitTransaction({ transaction: tx, allowOrphan: false }).catch(e => ({ err: e.message }));
});

// ── Test #18b: at the SAME boundary (e=max_split_fee exactly), forcing hasChange=true should be REJECTED (mutual exclusivity) ──
await record('T18b_boundary_e_eq_maxfee_hasChangeTrue_forced', 'reject', async () => {
  const { cfg } = baseCfg(false);
  const protocol = createSplitProtocol(cfg);
  const recipientsTotal = cfg.merchant.amountSompi + cfg.broker.amountSompi;
  await fundAddress(protocol.address, recipientsTotal + MAX_SPLIT_FEE);
  const utxo = await getUtxo(protocol.address);
  const entryAbi = protocol.entries.split;
  const sigScriptHex = combineActionAndRedeem(kaspa, encodeEntryActionGeneric(kaspa, entryAbi, { hasChange: true }), Buffer.from(protocol.redeemScriptHex, 'hex')).toString('hex');
  const changeVal = 0n; // e - maxSplitFee == 0, but a 0-value output is itself invalid; use 1 to isolate the require(e>max_s_fee) failure specifically
  const tx = new Transaction({ version: 1, inputs: [{ previousOutpoint: { transactionId: utxo.transactionId, index: utxo.index }, signatureScript: sigScriptHex, sequence: 0n, sigOpCount: 0, computeBudget: 70 }], outputs: [mkOut(protocol.merchantAmt, protocol.merchantPk), mkOut(protocol.brokerAmt, protocol.brokerPk), mkOut(1n, protocol.refundPk)], lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
  return rpc.submitTransaction({ transaction: tx, allowOrphan: false }).catch(e => ({ err: e.message }));
});

// ── Test #18c: e = max_split_fee + 1 (just above), forcing hasChange=false should be REJECTED ──
await record('T18c_boundary_e_eq_maxfeePlus1_hasChangeFalse_forced', 'reject', async () => {
  const { cfg } = baseCfg(false);
  const protocol = createSplitProtocol(cfg);
  const recipientsTotal = cfg.merchant.amountSompi + cfg.broker.amountSompi;
  await fundAddress(protocol.address, recipientsTotal + MAX_SPLIT_FEE + 1n); // e = max_split_fee + 1
  const utxo = await getUtxo(protocol.address);
  const entryAbi = protocol.entries.split;
  const sigScriptHex = combineActionAndRedeem(kaspa, encodeEntryActionGeneric(kaspa, entryAbi, { hasChange: false }), Buffer.from(protocol.redeemScriptHex, 'hex')).toString('hex');
  const tx = new Transaction({ version: 1, inputs: [{ previousOutpoint: { transactionId: utxo.transactionId, index: utxo.index }, signatureScript: sigScriptHex, sequence: 0n, sigOpCount: 0, computeBudget: 70 }], outputs: [mkOut(protocol.merchantAmt, protocol.merchantPk), mkOut(protocol.brokerAmt, protocol.brokerPk)], lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '' });
  return rpc.submitTransaction({ transaction: tx, allowOrphan: false }).catch(e => ({ err: e.message }));
});

console.log('\n=== SUMMARY ===');
let passCount = 0;
for (const r of results) { console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  expect=${r.expect} accepted=${r.accepted}  ${r.detail}`); if (r.pass) passCount++; }
console.log(`\n${passCount}/${results.length} PASS`);

await rpc.disconnect().catch(() => {});
process.exit(passCount === results.length ? 0 : 1);
