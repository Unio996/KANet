// CommissionSplit + ChannelDeposit 真实 simnet 对抗测试。独立全新 simnet(同 InstantSplit PMT 修复教训,
// 不用共享 simnet)。
process.env.SILVERC_V100_PATH = 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';
import { createRequire } from 'node:module';
const require = createRequire('D:/kanet-tn12/scratch/_j2_wt_commission_impl/kasia-console/');
const kaspa = require('kaspa-wasm');
const { RpcClient, Encoding, PrivateKey, Address, Transaction, TransactionOutput, ScriptPublicKey, Generator, PaymentOutput } = kaspa;
const SDK = await import('file:///D:/kanet-tn12/scratch/_j2_wt_commission_impl/kasia-console/src/lib/commission-plan-sdk.mjs');
const {
  createCommissionSplitProtocol, buildCommissionSplitTx, buildCommissionRefundTx,
  createChannelDepositProtocol, buildChannelWithdrawTx, finalizeChannelWithdrawTx, spkBytesFromAddress,
} = SDK;
const { encodeEntryActionGeneric, combineActionAndRedeem } = await import('file:///D:/kanet-tn12/scratch/_j2_wt_commission_impl/kasia-console/scripts/audit/generic-entry-witness.mjs');

const MAX_SPLIT_FEE = 40_000_000n;
const MAX_REFUND_FEE = 10_000_000n;

const rpc = new RpcClient({ url: 'ws://127.0.0.1:29927', encoding: Encoding.Borsh, networkId: 'simnet' });
await rpc.connect({});
const info = await rpc.getServerInfo();
if (info.networkId !== 'simnet') { console.error('REFUSE: not simnet'); process.exit(3); }
console.log('connected, networkId=', info.networkId);

const fundingWallet = new PrivateKey('982c3b5bb2ec24adb34191238ffb41645513a3a5c717d6266dadcd489836c04e');
const fundingAddr = fundingWallet.toPublicKey().toAddress('simnet').toString();
function genAddr() { const p = new PrivateKey(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')); return { priv: p, addr: p.toPublicKey().toAddress('simnet').toString() }; }
async function currentPmt() { const bdi = await rpc.getBlockDagInfo(); return Number(bdi.pastMedianTime); }
async function mine(n, payAddr = fundingAddr) { for (let i = 0; i < n; i++) { const tpl = await rpc.getBlockTemplate({ payAddress: payAddr, extraData: [] }); await rpc.submitBlock({ block: tpl.block, allowNonDAABlocks: true }); } }

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

console.log('checking/mining for coinbase maturity (fundAddress self-heals if needed)...');

// ── T1: 3-role happy path, hasChange=false (exact funding) ──
await record('T1_3role_split_no_change_accept', 'accept', async () => {
  const provider = genAddr(), broker = genAddr(), ch1 = genAddr(), payer = genAddr();
  const protocol = createCommissionSplitProtocol({
    network: 'simnet',
    finalRoles: [
      { amountSompi: 700_000_000n, spk: spkBytesFromAddress(provider.addr) },
      { amountSompi: 150_000_000n, spk: spkBytesFromAddress(broker.addr) },
      { amountSompi: 50_000_000n, spk: spkBytesFromAddress(ch1.addr) },
    ],
    payerRefundAddress: payer.addr,
    maxSplitFeeSompi: MAX_SPLIT_FEE, maxRefundFeeSompi: MAX_REFUND_FEE,
  });
  const realFee = 1_500_000n; // 需 > mempool 最低中继费(该形状实测约 1,014,000), 且 <= maxSplitFeeSompi, 才能同时满足合约 hasChange=false 分支与真实广播的费率下限
  await fundAddress(protocol.address, 900_000_000n + realFee);
  const utxo = await getUtxo(new Address(protocol.address));
  const { tx, hasChange } = buildCommissionSplitTx(protocol, utxo);
  if (hasChange) return { err: 'expected hasChange=false' };
  return rpc.submitTransaction({ transaction: tx, allowOrphan: false }).catch(e => ({ err: e.message }));
});

// ── T2: 3-role happy path, hasChange=true (overpay) ──
await record('T2_3role_split_with_change_accept', 'accept', async () => {
  const provider = genAddr(), broker = genAddr(), ch1 = genAddr(), payer = genAddr();
  const protocol = createCommissionSplitProtocol({
    network: 'simnet',
    finalRoles: [
      { amountSompi: 700_000_000n, spk: spkBytesFromAddress(provider.addr) },
      { amountSompi: 150_000_000n, spk: spkBytesFromAddress(broker.addr) },
      { amountSompi: 50_000_000n, spk: spkBytesFromAddress(ch1.addr) },
    ],
    payerRefundAddress: payer.addr,
    maxSplitFeeSompi: MAX_SPLIT_FEE, maxRefundFeeSompi: MAX_REFUND_FEE,
  });
  await fundAddress(protocol.address, 950_000_000n); // overpay by 50M, > maxSplitFee(40M) -> hasChange
  const utxo = await getUtxo(new Address(protocol.address));
  const { tx, hasChange } = buildCommissionSplitTx(protocol, utxo);
  if (!hasChange) return { err: 'expected hasChange=true' };
  return rpc.submitTransaction({ transaction: tx, allowOrphan: false }).catch(e => ({ err: e.message }));
});

// ── T3: 7-role (max, provider+broker+5channel) happy path with change ──
let sevenRoleProtocolForTamper = null;
await record('T3_7role_max_split_accept', 'accept', async () => {
  const provider = genAddr(), broker = genAddr();
  const channels = Array.from({ length: 5 }, () => genAddr());
  const payer = genAddr();
  const finalRoles = [
    { amountSompi: 700_000_000n, spk: spkBytesFromAddress(provider.addr) },
    { amountSompi: 50_000_000n, spk: spkBytesFromAddress(broker.addr) },
    ...channels.map(c => ({ amountSompi: 20_000_000n, spk: spkBytesFromAddress(c.addr) })),
  ];
  const protocol = createCommissionSplitProtocol({
    network: 'simnet', finalRoles, payerRefundAddress: payer.addr,
    maxSplitFeeSompi: MAX_SPLIT_FEE, maxRefundFeeSompi: MAX_REFUND_FEE,
  });
  sevenRoleProtocolForTamper = { protocol, provider, broker, channels, payer };
  await fundAddress(protocol.address, 900_000_000n);
  const utxo = await getUtxo(new Address(protocol.address));
  const { tx } = buildCommissionSplitTx(protocol, utxo);
  return rpc.submitTransaction({ transaction: tx, allowOrphan: false }).catch(e => ({ err: e.message }));
});

// ── T4: tamper — replace channel_3's output address with attacker's own (structural tamper reject) ──
await record('T4_7role_tamper_channel_address_reject', 'reject', async () => {
  const provider = genAddr(), broker = genAddr();
  const channels = Array.from({ length: 5 }, () => genAddr());
  const payer = genAddr();
  const finalRoles = [
    { amountSompi: 700_000_000n, spk: spkBytesFromAddress(provider.addr) },
    { amountSompi: 50_000_000n, spk: spkBytesFromAddress(broker.addr) },
    ...channels.map(c => ({ amountSompi: 20_000_000n, spk: spkBytesFromAddress(c.addr) })),
  ];
  const protocol = createCommissionSplitProtocol({
    network: 'simnet', finalRoles, payerRefundAddress: payer.addr,
    maxSplitFeeSompi: MAX_SPLIT_FEE, maxRefundFeeSompi: MAX_REFUND_FEE,
  });
  await fundAddress(protocol.address, 900_000_000n);
  const utxo = await getUtxo(new Address(protocol.address));
  const { tx } = buildCommissionSplitTx(protocol, utxo);
  const attacker = genAddr();
  const attackerSpk = spkBytesFromAddress(attacker.addr);
  const attackerVersion = attackerSpk[0] | (attackerSpk[1] << 8);
  const outs = tx.outputs.map((o, i) => i === 2 ? new TransactionOutput(o.value, new ScriptPublicKey(attackerVersion, attackerSpk.subarray(2).toString('hex'))) : o);
  const tampered = new Transaction({ version: tx.version, inputs: tx.inputs, outputs: outs, lockTime: tx.lockTime, gas: tx.gas, subnetworkId: tx.subnetworkId, payload: tx.payload });
  return rpc.submitTransaction({ transaction: tampered, allowOrphan: false }).catch(e => ({ err: e.message }));
});

// ── C26: 5-channel dosage boundary (provider+broker+5channel+change,含broker N1重测档) ──
// 用真实 tx-mass-ub.mjs 二分搜索边界(与 v0.4 设计稿/NWT 复核同一套方法), 再真实广播验证。
const { estimateMassUpperBound } = await import('file:///D:/kanet-tn12/kasia-relay/src/lib/tx-mass-ub.mjs');
// 🔴 实现期真实发现(simnet 广播坐实, 非猜测): storage mass 公式的输入侧折扣项 C·p_in²/amount_in
// 反比于 amount_in——第一版 measureBoundary 用"outputs 总和 + 1"当 inputAmt(理想化, 没算进真实
// 交易还需要覆盖矿工费), 比真实广播时"outputs 总和 + 真实费用余量"这个更大的 amount_in 算出的
// 折扣项更大, 从而**低估**了真实 storage mass(本地估 500,000 而真实广播是 500,003, 3 mass 之差)。
// 这不是估算公式本身错(tx-mass-ub.mjs 是既有 NWT-GREEN 组件, 不改它), 是这条本地二分搜索脚本
// 没有用"和真实 buildCommissionSplitTx 同一套 inputAmt 计算方式"喂给它——现在改成一致, 输入侧
// 额外加同一份 REAL_FEE_RESERVE, 与真实 hasChange=true 分支的资金构造逻辑对齐。
const C26_REAL_FEE_RESERVE = 2_000_000n;
function measureBoundary(perChannel) {
  const provider = 700_000_000n, broker = 50_000_000n;
  const outs = [provider, broker, ...Array(5).fill(perChannel)];
  const change = perChannel;
  outs.push(change);
  const recipientsTotal = provider + broker + perChannel * 5n;
  const inputAmt = recipientsTotal + perChannel + C26_REAL_FEE_RESERVE; // 与真实 buildCommissionSplitTx: inputAmt = recipientsTotal + excess, excess = change + realFeeReserve
  const shape = { version: 1, inputs: [{ signatureScript: '00'.repeat(300), computeBudget: 70, amount: inputAmt, spkLen: 37n, hasCovenant: false }], outputs: outs.map(v => ({ value: v, spk: '00'.repeat(37), covenant: false })) };
  return estimateMassUpperBound(shape);
}
let lo = 1_000_000n, hi = 300_000_000n;
while (lo < hi) { const mid = (lo + hi) / 2n; const m = measureBoundary(mid); if (m.mass <= 500_000n) hi = mid; else lo = mid + 1n; }
const boundaryPerChannel = lo;
console.log('C26 real boundary (per-channel, hard cap 500,000):', boundaryPerChannel.toString(), 'mass at boundary:', measureBoundary(boundaryPerChannel).mass.toString());
console.log('C26 mass one sompi below boundary (should exceed 500,000):', measureBoundary(boundaryPerChannel - 1n).mass.toString());

await record('C26_5channel_boundary_accept', 'accept', async () => {
  const provider = genAddr(), broker = genAddr();
  const channels = Array.from({ length: 5 }, () => genAddr());
  const payer = genAddr();
  const finalRoles = [
    { amountSompi: 700_000_000n, spk: spkBytesFromAddress(provider.addr) },
    { amountSompi: 50_000_000n, spk: spkBytesFromAddress(broker.addr) },
    ...channels.map(c => ({ amountSompi: boundaryPerChannel, spk: spkBytesFromAddress(c.addr) })),
  ];
  // 🔴 这条测试专用一个更小的 maxSplitFeeSompi(2M, 不是全套用的 40M)——原因: buildCommissionSplitTx
  // 的 hasChange 触发条件是 excess > maxSplitFeeSompi, 找零值 = excess - min(4M, maxSplitFeeSompi)。
  // 要让找零恰好落在 boundaryPerChannel(≈12.5M, 匹配二分搜索假设的"渠道份额同档最低额"找零形状),
  // 需要 excess ≈ 14.5M——这个量级本身就小于全套 40M 的 maxSplitFeeSompi, 不可能同时满足"excess >
  // maxSplitFeeSompi"这个触发条件, 所以本测试单独调低 maxSplitFeeSompi 到 2M(仍是真实的合约常量,
  // 只是这一单独测试场景专用的费用上限, 不影响其余测试用的 40M)。
  const C26_MAX_SPLIT_FEE = 2_000_000n;
  const protocol = createCommissionSplitProtocol({
    network: 'simnet', finalRoles, payerRefundAddress: payer.addr,
    maxSplitFeeSompi: C26_MAX_SPLIT_FEE, maxRefundFeeSompi: MAX_REFUND_FEE,
  });
  const recipientsTotal = finalRoles.reduce((a, r) => a + r.amountSompi, 0n);
  const REAL_FEE_RESERVE = C26_MAX_SPLIT_FEE; // min(4M, 2M) = 2M
  await fundAddress(protocol.address, recipientsTotal + boundaryPerChannel + REAL_FEE_RESERVE);
  const utxo = await getUtxo(new Address(protocol.address));
  const { tx, hasChange, changeSompi } = buildCommissionSplitTx(protocol, utxo);
  if (!hasChange) return { err: `expected hasChange=true, excess check` };
  if (changeSompi !== boundaryPerChannel) return { err: `change=${changeSompi} != boundaryPerChannel=${boundaryPerChannel}, funding math off` };
  return rpc.submitTransaction({ transaction: tx, allowOrphan: false }).catch(e => ({ err: e.message }));
});

await record('C26_5channel_below_boundary_reject', 'reject', async () => {
  const belowChannel = boundaryPerChannel - 1n;
  const provider = genAddr(), broker = genAddr();
  const channels = Array.from({ length: 5 }, () => genAddr());
  const payer = genAddr();
  const finalRoles = [
    { amountSompi: 700_000_000n, spk: spkBytesFromAddress(provider.addr) },
    { amountSompi: 50_000_000n, spk: spkBytesFromAddress(broker.addr) },
    ...channels.map(c => ({ amountSompi: belowChannel, spk: spkBytesFromAddress(c.addr) })),
  ];
  // 同 C26_5channel_boundary_accept: 用同一档更小的 maxSplitFeeSompi, 让 excess≈belowChannel+2M
  // 能真正触发 hasChange, 走到真实广播那一步(不是提前被本地"expected hasChange"检查拦下——那样
  // "PASS"是方向凑巧对但没有真的测到共识层拒绝, 是假阳性, 已修正)。
  const C26_MAX_SPLIT_FEE = 2_000_000n;
  const protocol = createCommissionSplitProtocol({
    network: 'simnet', finalRoles, payerRefundAddress: payer.addr,
    maxSplitFeeSompi: C26_MAX_SPLIT_FEE, maxRefundFeeSompi: MAX_REFUND_FEE,
  });
  const recipientsTotal = finalRoles.reduce((a, r) => a + r.amountSompi, 0n);
  const REAL_FEE_RESERVE = C26_MAX_SPLIT_FEE;
  await fundAddress(protocol.address, recipientsTotal + belowChannel + REAL_FEE_RESERVE);
  const utxo = await getUtxo(new Address(protocol.address));
  const { tx, hasChange } = buildCommissionSplitTx(protocol, utxo);
  if (!hasChange) return { err: `expected hasChange=true` };
  return rpc.submitTransaction({ transaction: tx, allowOrphan: false }).catch(e => ({ err: e.message }));
});

// ── T5: refund after PMT — 用"deadline 已经在当前 PMT 之前"直接构造, 不再靠转发挖矿追 PMT
// (更稳健: 挖矿追赶 PMT 到某个未来阈值受限于这套 simnet 区块间隔/PMT 采样窗口的真实推进速度,
// 之前跑法在 1000 个额外区块后仍未追上一个仅 5 秒的阈值, 说明这套简易挖矿循环不是可靠的等待
// 手段; 反过来构造"deadline 已经落后于当前真实 PMT"则不需要等待, 同样真实测试 refund 入口)。
await record('T5_refund_after_pmt_accept', 'accept', async () => {
  const provider = genAddr(), broker = genAddr(), payer = genAddr();
  const pmtNow = await currentPmt();
  const protocol = createCommissionSplitProtocol({
    network: 'simnet',
    finalRoles: [
      { amountSompi: 700_000_000n, spk: spkBytesFromAddress(provider.addr) },
      { amountSompi: 150_000_000n, spk: spkBytesFromAddress(broker.addr) },
    ],
    payerRefundAddress: payer.addr,
    deadlineMs: pmtNow - 3600_000, // 1 小时前, 当前 PMT 必然已经超过
    maxSplitFeeSompi: MAX_SPLIT_FEE, maxRefundFeeSompi: MAX_REFUND_FEE,
  });
  await fundAddress(protocol.address, 900_000_000n);
  const utxo = await getUtxo(new Address(protocol.address));
  const pmt = await currentPmt();
  const { tx } = buildCommissionRefundTx(protocol, utxo, pmt, 5000);
  return rpc.submitTransaction({ transaction: tx, allowOrphan: false }).catch(e => ({ err: e.message }));
});

// ── ChannelDeposit tests ──
await record('T6_deposit_withdraw_correct_signer_accept', 'accept', async () => {
  const depositor = genAddr();
  const protocol = createChannelDepositProtocol({ network: 'simnet', depositorPrivKeyHex: depositor.priv.toString(), maxWithdrawFeeSompi: 2_000_000n });
  await fundAddress(protocol.address, 100_000_000n);
  const utxo = await getUtxo(new Address(protocol.address));
  const { unsignedTx, outValue } = buildChannelWithdrawTx(protocol, utxo);
  const raw = kaspa.createInputSignature(unsignedTx, 0, depositor.priv, kaspa.SighashType.All);
  const rawNoPrefix = raw.startsWith('0x') ? raw.slice(2) : raw;
  if (rawNoPrefix.length !== 132) return { err: `createInputSignature 长度异常, 期望132 hex, 实际${rawNoPrefix.length}` };
  const sig65Hex = rawNoPrefix.slice(2); // 去掉开头 1 字节 push-opcode(0x41), 留 65 字节真实 sig payload
  const tx = finalizeChannelWithdrawTx(protocol, unsignedTx, sig65Hex);
  return rpc.submitTransaction({ transaction: tx, allowOrphan: false }).catch(e => ({ err: e.message }));
});

await record('T7_deposit_withdraw_wrong_signer_reject', 'reject', async () => {
  const depositor = genAddr();
  const attacker = genAddr();
  const protocol = createChannelDepositProtocol({ network: 'simnet', depositorPrivKeyHex: depositor.priv.toString(), maxWithdrawFeeSompi: 2_000_000n });
  await fundAddress(protocol.address, 100_000_000n);
  const utxo = await getUtxo(new Address(protocol.address));
  const { unsignedTx } = buildChannelWithdrawTx(protocol, utxo);
  const raw = kaspa.createInputSignature(unsignedTx, 0, attacker.priv, kaspa.SighashType.All); // wrong key
  const rawNoPrefix = raw.startsWith('0x') ? raw.slice(2) : raw;
  const sig65Hex = rawNoPrefix.slice(2);
  const tx = finalizeChannelWithdrawTx(protocol, unsignedTx, sig65Hex);
  return rpc.submitTransaction({ transaction: tx, allowOrphan: false }).catch(e => ({ err: e.message }));
});

console.log(`\n=== ${results.filter(r => r.pass).length} / ${results.length} PASS ===`);
for (const r of results) if (!r.pass) console.log('FAILED:', JSON.stringify(r));
process.exitCode = results.every(r => r.pass) ? 0 : 1;
