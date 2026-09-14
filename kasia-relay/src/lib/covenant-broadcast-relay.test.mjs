// covenant-broadcast-relay.test.mjs — relay 侧 covenant_broadcast 胶水逻辑离线向量(J2 2026-09-14,
// 接线笔①, 设计 §9/§9.5)。全离线 mock kaspa/rpc/ingestPhase(同 covenant-broadcast.test.mjs 的假
// kaspa 手法 + proto-bet-intent.test.mjs 的假 relay 手法), 零真实 wasm/零链/零 HTTP。
// Run: cd kasia-relay && node src/lib/covenant-broadcast-relay.test.mjs

import assert from 'node:assert';
import { covenantBroadcastRelay, _covenantDoneSize } from './covenant-broadcast-relay.mjs';

let pass = 0, fail = 0;
const tAsync = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };

// ── fake kaspa: 只模拟 covenant-broadcast-relay.mjs 实际用到的表面(Transaction/Address/
//    payToAddressScript/createInputSignature/SighashType/calculateTransactionMass)。
//    amount/value 用字符串表示(模拟真实 safeJSON 对 BigInt 的字符串化, 避免 JSON.stringify 撞
//    "Do not know how to serialize a BigInt")。
function makeFakeKaspa({ signThrows = false, massThrows = false, finalTxid = 'FINAL_TXID_DEFAULT' } = {}) {
  class FakeSpk { constructor(hex) { this._hex = hex; } toString() { return this._hex; } }
  class FakeAddress { constructor(s) { this.s = s; } }
  function payToAddressScript(addr) { return new FakeSpk(`spk:${addr.s}`); }
  class FakeTransaction {
    constructor({ inputs, outputs }) {
      this.inputs = inputs.map(i => ({ ...i, utxo: { ...i.utxo, scriptPublicKey: new FakeSpk(i.utxo.scriptPublicKey) } }));
      this.outputs = outputs.map(o => ({ ...o, scriptPublicKey: new FakeSpk(o.scriptPublicKey) }));
      this.id = null;
    }
    finalize() { this.id = finalTxid; }
    serializeToSafeJSON() {
      return JSON.stringify({
        inputs: this.inputs.map(i => ({ ...i, utxo: { ...i.utxo, scriptPublicKey: i.utxo.scriptPublicKey.toString() } })),
        outputs: this.outputs.map(o => ({ ...o, scriptPublicKey: o.scriptPublicKey.toString() })),
        id: this.id,
      });
    }
    static deserializeFromSafeJSON(jsonStr) {
      const parsed = JSON.parse(jsonStr);
      return new FakeTransaction({ inputs: parsed.inputs, outputs: parsed.outputs });
    }
  }
  const calls = { createInputSignature: [], calculateTransactionMass: 0 };
  return {
    calls,
    Transaction: FakeTransaction,
    Address: FakeAddress,
    payToAddressScript,
    SighashType: { All: 'ALL' },
    createInputSignature: (tx, idx, priv, type) => {
      calls.createInputSignature.push({ idx, type });
      if (signThrows) throw new Error('simulated sign failure');
      return `sig-${idx}`;
    },
    calculateTransactionMass: () => {
      calls.calculateTransactionMass++;
      if (massThrows) throw new Error('simulated mass calc panic');
      return 1000n; // × SOMPI_PER_MASS(100n) = 100_000n sompi required fee
    },
  };
}

// relay 自己一个输入(idx 0, 会被签), 一个"付回自己"的找零输出, 一个 covenant 相关输出(不影响 net_loss 判定)。
// relayAddr 的 scriptPubKey 走 payToAddressScript('relay-addr') = 'spk:relay-addr' —— 找零输出必须用同一个字符串。
function makeCmd({ inputAmt = '10000000', changeAmt = '9900000', signIdx = [0], intentKey = 'proto-bet:betX:mint', expectedTxid = 'FINAL_TXID_DEFAULT' } = {}) {
  const tx = {
    inputs: [{ previousOutpoint: { transactionId: 'aa'.repeat(32), index: 0 }, signatureScript: '', sequence: '0', sigOpCount: 1,
      utxo: { amount: inputAmt, scriptPublicKey: 'spk:relay-addr' } }],
    outputs: [{ value: changeAmt, scriptPublicKey: 'spk:relay-addr' }],
  };
  return { intent_key: intentKey, tx_json: tx, sign_input_indices: signIdx, expected_txid: expectedTxid };
}

function makeWallet() { return { getPrivateKey: () => 'RELAY_PRIVKEY', getAddress: () => 'relay-addr' }; }
function makeRpc() { const calls = []; return { calls, submitTransaction: async (o) => { calls.push(o); } }; }
function makeIngestPhase({ failOn = null } = {}) {
  const calls = [];
  return {
    calls,
    fn: async (o) => { calls.push(o); if (failOn === o.phase) throw new Error(`simulated ingest failure at phase ${o.phase}`); },
  };
}

const ENV_BACKUP = { RELAY_NODE_ID: process.env.RELAY_NODE_ID, PROTO_RELAY_ID: process.env.PROTO_RELAY_ID };
function setEnv(nodeId, protoId) {
  if (nodeId === undefined) delete process.env.RELAY_NODE_ID; else process.env.RELAY_NODE_ID = nodeId;
  if (protoId === undefined) delete process.env.PROTO_RELAY_ID; else process.env.PROTO_RELAY_ID = protoId;
}
function restoreEnv() { setEnv(ENV_BACKUP.RELAY_NODE_ID, ENV_BACKUP.PROTO_RELAY_ID); }

await tAsync('RELAY-1 非 PROTO_RELAY_ID 的 relay 收到命令 ⇒ 拒绝, 不碰任何签名/广播/ingest 逻辑', async () => {
  setEnv('some-other-relay', 'proto-the-one');
  try {
    const kaspa = makeFakeKaspa();
    const rpc = makeRpc();
    const ingest = makeIngestPhase();
    const r = await covenantBroadcastRelay({ cmd: makeCmd(), kaspa, rpc, wallet: makeWallet(), networkId: 'mainnet', senderAddress: 'relay-addr', log: () => {}, ingestPhase: ingest.fn });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'not_proto_relay');
    assert.strictEqual(kaspa.calls.createInputSignature.length, 0, '未签任何输入');
    assert.strictEqual(rpc.calls.length, 0, '未广播');
    assert.strictEqual(ingest.calls.length, 0, '未调用 ingest');
  } finally { restoreEnv(); }
});

await tAsync('RELAY-2 PROTO_RELAY_ID 未配置 ⇒ 全部拒绝(fail-closed: 未配置=无人被授权)', async () => {
  setEnv('any-relay', undefined);
  try {
    const r = await covenantBroadcastRelay({ cmd: makeCmd(), kaspa: makeFakeKaspa(), rpc: makeRpc(), wallet: makeWallet(), networkId: 'mainnet', senderAddress: 'relay-addr', log: () => {} });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'not_proto_relay');
  } finally { restoreEnv(); }
});

// 以下测试全部在 PROTO_RELAY_ID 匹配的前提下进行。
setEnv('proto-the-one', 'proto-the-one');

await tAsync('FRESH-1 正常全流程: prepared ingest 成功 → 广播成功 → submitted ingest 成功 → ok:true', async () => {
  const kaspa = makeFakeKaspa();
  const rpc = makeRpc();
  const ingest = makeIngestPhase();
  const r = await covenantBroadcastRelay({ cmd: makeCmd({ intentKey: 'proto-bet:f1:mint' }), kaspa, rpc, wallet: makeWallet(), networkId: 'mainnet', senderAddress: 'relay-addr', log: () => {}, ingestPhase: ingest.fn });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.txId, 'FINAL_TXID_DEFAULT');
  assert.strictEqual(rpc.calls.length, 1, '广播恰好一次');
  assert.deepStrictEqual(ingest.calls.map(c => c.phase), ['prepared', 'submitted'], 'prepared 必须先于 submitted');
  assert.strictEqual(kaspa.calls.createInputSignature.length, 1, '只签了声明的那一个索引');
});

await tAsync('FRESH-2 prepared ingest 失败 ⇒ 不广播(fail-closed, §9.5③), 不调用 submitTransaction', async () => {
  const kaspa = makeFakeKaspa();
  const rpc = makeRpc();
  const ingest = makeIngestPhase({ failOn: 'prepared' });
  const r = await covenantBroadcastRelay({ cmd: makeCmd({ intentKey: 'proto-bet:f2:mint' }), kaspa, rpc, wallet: makeWallet(), networkId: 'mainnet', senderAddress: 'relay-addr', log: () => {}, ingestPhase: ingest.fn });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'prepared_ingest_failed');
  assert.strictEqual(rpc.calls.length, 0, '零广播——这是本条硬条件④测试点');
});

await tAsync('FRESH-3 submitted ingest 失败 ⇒ 已广播的事实不可撤, 仍 ok:true+txId, 带 code 供调用方兜底', async () => {
  const kaspa = makeFakeKaspa();
  const rpc = makeRpc();
  const ingest = makeIngestPhase({ failOn: 'submitted' });
  const r = await covenantBroadcastRelay({ cmd: makeCmd({ intentKey: 'proto-bet:f3:mint' }), kaspa, rpc, wallet: makeWallet(), networkId: 'mainnet', senderAddress: 'relay-addr', log: () => {}, ingestPhase: ingest.fn });
  assert.strictEqual(r.ok, true, 'ok 仍是 true——广播确实成功了, 不能让调用方以为没发生而去危险重试');
  assert.strictEqual(r.txId, 'FINAL_TXID_DEFAULT');
  assert.strictEqual(r.code, 'ingest_after_broadcast_failed');
  assert.strictEqual(rpc.calls.length, 1, '广播确实发生了(不是没广播就报错)');
});

await tAsync('FRESH-4 validateSignedInputCeiling 失败(签名前) ⇒ 不签名不广播', async () => {
  const kaspa = makeFakeKaspa();
  const rpc = makeRpc();
  const ingest = makeIngestPhase();
  const cmd = makeCmd({ intentKey: 'proto-bet:f4:mint', inputAmt: '110000000' }); // > SIGNED_INPUT_CEILING(Bettor 1386②: 1.0 KAS = 100_000_000)
  const r = await covenantBroadcastRelay({ cmd, kaspa, rpc, wallet: makeWallet(), networkId: 'mainnet', senderAddress: 'relay-addr', log: () => {}, ingestPhase: ingest.fn });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'signed_input_ceiling_exceeded');
  assert.strictEqual(kaspa.calls.createInputSignature.length, 0, '签名前就被拦, 一次都没签');
  assert.strictEqual(rpc.calls.length, 0);
});

await tAsync('FRESH-5 expected_txid 与真实 finalize 后 txid 不符 ⇒ 拒绝, 不广播', async () => {
  const kaspa = makeFakeKaspa({ finalTxid: 'REAL_TXID_XYZ' });
  const rpc = makeRpc();
  const cmd = makeCmd({ intentKey: 'proto-bet:f5:mint', expectedTxid: 'WRONG_EXPECTED_TXID' });
  const r = await covenantBroadcastRelay({ cmd, kaspa, rpc, wallet: makeWallet(), networkId: 'mainnet', senderAddress: 'relay-addr', log: () => {} });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'txid_mismatch');
  assert.strictEqual(rpc.calls.length, 0, '同字节断言在广播前, 不符就不广播');
});

await tAsync('FRESH-6 computeRequiredFeeSompi 失败(mass calc panic) ⇒ fail-loud 拒绝, 不广播', async () => {
  const kaspa = makeFakeKaspa({ massThrows: true });
  const rpc = makeRpc();
  const r = await covenantBroadcastRelay({ cmd: makeCmd({ intentKey: 'proto-bet:f6:mint' }), kaspa, rpc, wallet: makeWallet(), networkId: 'mainnet', senderAddress: 'relay-addr', log: () => {} });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'fee_calc_failed');
  assert.strictEqual(rpc.calls.length, 0);
});

await tAsync('FRESH-7 validateNetLoss 失败(找零金额不够, net_loss 超出手续费上限) ⇒ 拒绝, 不广播', async () => {
  const kaspa = makeFakeKaspa();
  const rpc = makeRpc();
  // required_fee = 1000 mass × 100 = 100_000 sompi; ceiling = min(200_000, ABS_FEE_CAP)。
  // 找零只给 1000 sompi(input 10_000_000 - change 1000 = net_loss 9_999_000, 远超上限)。
  const cmd = makeCmd({ intentKey: 'proto-bet:f7:mint', changeAmt: '1000' });
  const r = await covenantBroadcastRelay({ cmd, kaspa, rpc, wallet: makeWallet(), networkId: 'mainnet', senderAddress: 'relay-addr', log: () => {} });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'net_loss_exceeded');
  assert.strictEqual(rpc.calls.length, 0);
});

await tAsync('FRESH-8 signOnlyDeclaredInputs 本身失败(如 wasm 抛错) ⇒ 拒绝, 不广播', async () => {
  const kaspa = makeFakeKaspa({ signThrows: true });
  const rpc = makeRpc();
  const r = await covenantBroadcastRelay({ cmd: makeCmd({ intentKey: 'proto-bet:f8:mint' }), kaspa, rpc, wallet: makeWallet(), networkId: 'mainnet', senderAddress: 'relay-addr', log: () => {} });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'sign_failed');
  assert.strictEqual(rpc.calls.length, 0);
});

await tAsync('FRESH-9(NWT 1387 复核要求) net_loss cap 与 SIGNED_INPUT_CEILING 解耦验证: 临时把 SIGNED_INPUT_CEILING 注入抬高到 2.0 KAS(解除"两值当前恰好相等"这个巧合遮蔽), cmd 里贴一个恶意/意外的假 abs_fee_cap_sompi=5 KAS(relay 从不读这个字段, 但仍显式放进 cmd 模拟"如果被读了会怎样"), 签名输入 1.5 KAS(远低于注入后的 2.0 KAS 输入闸, 不会被那道闸先挡住) ⇒ 仍应在 validateNetLoss 这一步被硬编码的 GLOBAL_ABS_FEE_CAP_SOMPI(1.0 KAS)拒绝, 且错误信息里引用的是 1 亿(GLOBAL)不是 5 亿(cmd 假 cap)——证明"relay 不读 cmd 的 cap"这条性质是真的独立生效, 不是被 SIGNED_INPUT_CEILING 顺带挡住的巧合', async () => {
  // mass=10_000_000 ⇒ required_fee=1_000_000_000(10 KAS)×2=20 KAS, 远大于两个候选 cap(1/5 KAS)——
  // 让 required_fee×2 这一支不可能成为 min() 里的约束项, 真正在比的是 absFeeCapSompi vs GLOBAL。
  const kaspa = makeFakeKaspa({ massValue: 10_000_000n });
  const rpc = makeRpc();
  // 签名输入 150_000_000(1.5 KAS), 找零仅留 1000 sompi dust ⇒ net_loss ≈ 149_999_000(~1.4999 KAS)
  //   > GLOBAL_ABS_FEE_CAP_SOMPI(1.0 KAS)应拒; 若 relay 错误读了 cmd 假 cap(5 KAS)则会被错误放行。
  const cmd = makeCmd({ intentKey: 'proto-bet:f9:mint', inputAmt: '150000000', changeAmt: '1000' });
  cmd.abs_fee_cap_sompi = '500000000'; // 恶意/意外贴的假 cap(5 KAS)——relay 绝不应该读它
  const r = await covenantBroadcastRelay({
    cmd, kaspa, rpc, wallet: makeWallet(), networkId: 'mainnet', senderAddress: 'relay-addr', log: () => {},
    signedInputCeilingSompi: 200_000_000n, // 注入抬高到 2.0 KAS —— 1.5 KAS 的签名输入不会撞这道闸
  });
  assert.strictEqual(r.ok, false, JSON.stringify(r));
  assert.strictEqual(r.code, 'net_loss_exceeded', `本该在 net_loss 这一步被拒, 实际: ${JSON.stringify(r)}`);
  assert.ok(r.error.includes('GLOBAL_ABS_FEE_CAP_SOMPI=100000000'), `ceiling 应引用硬编码 GLOBAL(100000000), 实际: ${r.error}`);
  assert.ok(!r.error.includes('500000000'), `不该出现 cmd 贴的假 cap(500000000), 实际: ${r.error}`);
  assert.strictEqual(rpc.calls.length, 0, '零广播');
});

await tAsync('IDEMPOTENT-1 同一 intent_key 二次调用(进程内已完成) ⇒ reused, 不重新广播', async () => {
  const kaspa = makeFakeKaspa();
  const rpc = makeRpc();
  const ingest = makeIngestPhase();
  const cmd = makeCmd({ intentKey: 'proto-bet:idem1:mint' });
  const r1 = await covenantBroadcastRelay({ cmd, kaspa, rpc, wallet: makeWallet(), networkId: 'mainnet', senderAddress: 'relay-addr', log: () => {}, ingestPhase: ingest.fn });
  assert.strictEqual(r1.ok, true, JSON.stringify(r1));
  const r2 = await covenantBroadcastRelay({ cmd, kaspa, rpc, wallet: makeWallet(), networkId: 'mainnet', senderAddress: 'relay-addr', log: () => {}, ingestPhase: ingest.fn });
  assert.strictEqual(r2.reused, true);
  assert.strictEqual(r2.txId, r1.txId);
  assert.strictEqual(rpc.calls.length, 1, '第二次调用没有再广播一次');
  assert.strictEqual(ingest.calls.length, 2, '第二次调用完全没有再碰 ingestPhase(只有第一次的 prepared+submitted 两次)');
});

await tAsync('REPLAY-1 replay_tx_json 路径: 复用注入的 replayFn, 成功后调 submitted ingest', async () => {
  const ingest = makeIngestPhase();
  const replayCalls = [];
  const replayFn = async (o) => { replayCalls.push(o); return { ok: true, txId: 'REPLAYED_TXID' }; };
  const cmd = { intent_key: 'proto-bet:rp1:mint', replay_tx_json: JSON.stringify([{ id: 'x' }]), prepared_txid: 'REPLAYED_TXID' };
  const r = await covenantBroadcastRelay({ cmd, kaspa: makeFakeKaspa(), rpc: makeRpc(), wallet: makeWallet(), networkId: 'mainnet', senderAddress: 'relay-addr', log: () => {}, replayFn, ingestPhase: ingest.fn });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.txId, 'REPLAYED_TXID');
  assert.strictEqual(replayCalls.length, 1);
  assert.deepStrictEqual(ingest.calls.map(c => c.phase), ['submitted'], 'replay 成功只需要补 submitted(prepared 已经在首次构造时落过)');
});

await tAsync('REPLAY-2 replay 路径 submitted ingest 失败 ⇒ ok:true 但带 ingest_after_broadcast_failed', async () => {
  const ingest = makeIngestPhase({ failOn: 'submitted' });
  const replayFn = async () => ({ ok: true, txId: 'REPLAYED_TXID_2' });
  const cmd = { intent_key: 'proto-bet:rp2:mint', replay_tx_json: JSON.stringify([{ id: 'x' }]), prepared_txid: 'REPLAYED_TXID_2' };
  const r = await covenantBroadcastRelay({ cmd, kaspa: makeFakeKaspa(), rpc: makeRpc(), wallet: makeWallet(), networkId: 'mainnet', senderAddress: 'relay-addr', log: () => {}, replayFn, ingestPhase: ingest.fn });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.code, 'ingest_after_broadcast_failed');
});

await tAsync('REPLAY-3 replay 路径缺 prepared_txid ⇒ 拒绝(既有 TRANSFER 同款契约)', async () => {
  const cmd = { intent_key: 'proto-bet:rp3:mint', replay_tx_json: JSON.stringify([{ id: 'x' }]) };
  const r = await covenantBroadcastRelay({ cmd, kaspa: makeFakeKaspa(), rpc: makeRpc(), wallet: makeWallet(), networkId: 'mainnet', senderAddress: 'relay-addr', log: () => {} });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'replay_txid_mismatch');
});

await tAsync('FIELD-2 缺 tx_json ⇒ error 提示 tx_json required', async () => {
  const cmd = { intent_key: 'proto-bet:field2:mint', sign_input_indices: [0], expected_txid: 'x' };
  const r = await covenantBroadcastRelay({ cmd, kaspa: makeFakeKaspa(), rpc: makeRpc(), wallet: makeWallet(), networkId: 'mainnet', senderAddress: 'relay-addr', log: () => {} });
  assert.strictEqual(r.ok, false);
  assert.ok(/tx_json required/.test(r.error));
});
await tAsync('FIELD-3 缺 sign_input_indices ⇒ error 提示非空数组', async () => {
  const cmd = { intent_key: 'proto-bet:field3:mint', tx_json: {}, expected_txid: 'x' };
  const r = await covenantBroadcastRelay({ cmd, kaspa: makeFakeKaspa(), rpc: makeRpc(), wallet: makeWallet(), networkId: 'mainnet', senderAddress: 'relay-addr', log: () => {} });
  assert.strictEqual(r.ok, false);
  assert.ok(/sign_input_indices must be a non-empty array/.test(r.error));
});
await tAsync('FIELD-4 缺 expected_txid ⇒ error 提示', async () => {
  const cmd = { intent_key: 'proto-bet:field4:mint', tx_json: {}, sign_input_indices: [0] };
  const r = await covenantBroadcastRelay({ cmd, kaspa: makeFakeKaspa(), rpc: makeRpc(), wallet: makeWallet(), networkId: 'mainnet', senderAddress: 'relay-addr', log: () => {} });
  assert.strictEqual(r.ok, false);
  assert.ok(/expected_txid required/.test(r.error));
});
await tAsync('FIELD-5 缺 intent_key ⇒ error 提示(最外层第一道检查)', async () => {
  const r = await covenantBroadcastRelay({ cmd: {}, kaspa: makeFakeKaspa(), rpc: makeRpc(), wallet: makeWallet(), networkId: 'mainnet', senderAddress: 'relay-addr', log: () => {} });
  assert.strictEqual(r.ok, false);
  assert.ok(/intent_key required/.test(r.error));
});

restoreEnv();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
