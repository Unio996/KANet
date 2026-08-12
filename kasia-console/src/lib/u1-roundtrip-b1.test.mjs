// round-trip 四件套 · **B-1 决定性格**(判据 `3b395e6c` §4)
//
// 判据原文要求: **变异真实 `unlockBshardRefund` 调用点**传错 start(helper 不动) ⇒ 至少一个指定测试
// **必须因正确原因变红**。可用 hermetic/mock RPC, 但必须**执行真实生产码**走完 continuation 构造
// 并**在 submit 前观察产物**。一票否决线: 只 grep 调用点、或再直调 helper ⇒ 不满足。
//
// 🔵 **本用例怎么做到"不是包壳"**: `connectRpc` 定义在 `p2sh.mjs:94` 内部(不可注入), 但它 `new RpcClient(...)`
//    用的是文件顶部 `import * as kaspa from 'kaspa-wasm'` 那个模块 ⇒ 用 **ESM loader 钩子**把 `kaspa-wasm`
//    换成「真模块 + 只替换 RpcClient」。**p2sh.mjs 一行未改**, 跑的就是生产码。
// 🔵 **观察点**: 假 RPC 的 `submitTransaction` **不广播**, 只截获 tx ⇒ 从 `outputs[pool_out_idx]` 读出
//    continuation 的 scriptPubKey ⇒ 与描述符推导的期望地址逐字节比。
// ⚠ 全程零广播、零真实密钥(一次性 privkey)、不连链。
import assert from 'node:assert';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.KANET_ROOT || join(HERE, '..', '..', '..');
const RELAY_LIB = join(ROOT, 'kasia-relay', 'src', 'lib', 'p2sh.mjs');
const KASPA_JS = join(ROOT, 'kasia-relay', 'node_modules', 'kaspa-wasm', 'kaspa.js');
const HOOKS = join(HERE, 'u1-roundtrip-b1.hooks.mjs');

let captured = null;
globalThis.__FAKE_TXID_QUEUE__ = [];
globalThis.__FAKE_RPC_CLASS__ = class FakeRpcClient {
  async connect() { return true; }
  async disconnect() { return true; }
  // 按调用顺序发 UTXO（生产码先查 pool 再查 ticket，顺序确定）——
  // 这样 harness 不必自己算 P2SH 地址（`_addressFromRedeem` 未导出），生产码算出什么都接得住。
  async getUtxosByAddresses(addrs) {
    const addr = Array.isArray(addrs) ? addrs[0] : addrs;
    const txid = globalThis.__FAKE_TXID_QUEUE__.shift();
    if (!txid) return { entries: [] };
    return { entries: [{
      address: addr,
      outpoint: { transactionId: txid, index: 0 },
      amount: 10_000_000_000n,
      scriptPublicKey: globalThis.__SPK_FOR__(addr),
      blockDaaScore: 1n, isCoinbase: false,
    }] };
  }
  async submitTransaction({ transaction }) { captured = transaction; return { transactionId: 'FAKE_NOT_BROADCAST' }; }
};
register(pathToFileURL(HOOKS).href);
process.env.KASPA_RPC_URL = 'ws://127.0.0.1:59999';   // 假地址：真 RpcClient 会连不上；用得上说明是假的

const kaspa = await import(pathToFileURL(KASPA_JS).href);
const p2sh = await import(pathToFileURL(RELAY_LIB).href);
globalThis.__SPK_FOR__ = (a) => kaspa.payToAddressScript(new kaspa.Address(String(a)));

let pass = 0; let fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass += 1; console.log(`[PASS] ${name}`); }
  catch (e) { fail += 1; console.log(`[FAIL] ${name} — ${e.message}`); }
};

// 字段序逐字抄生产 `_serializeRootStateHex`，不是我编的
const STATE = { local_yes: '11', local_no: '22', count: '3', pool_value: '444', closed: '0', winningSide: '0', payoutRoot: 'ab'.repeat(32) };
const stateHex = p2sh._serializeRootStateHex(STATE);
const POOL_REDEEM = '51' + stateHex + 'ff'.repeat(8);
const TICKET_REDEEM = '51' + stateHex + 'ee'.repeat(8);
const priv = new kaspa.PrivateKey('11'.repeat(32));
const ADDR = priv.toKeypair().toAddress(kaspa.NetworkType.Testnet).toString();
const NET = 'testnet-12';

async function runRefundAndCaptureContinuationSpk() {
  captured = null;
  globalThis.__FAKE_TXID_QUEUE__ = ['aa'.repeat(32), 'bb'.repeat(32)];
  const cmd = {
    inputs: { pool: { redeem_hex: POOL_REDEEM, outpointTxid: 'aa'.repeat(32) },
      ticket: { redeem_hex: TICKET_REDEEM, outpointTxid: 'bb'.repeat(32) } },
    outputs: { payout: { amountSompi: '500000000', address: ADDR },
      pool_continuation: { amountSompi: '500000000', state: STATE },
      change_address: ADDR },
    witness: { pool_out_idx: 0, payout_out_idx: 1, ticket_in_idx: 1, ticket_prefix_len: 0, ticket_suffix_len: 0 },
  };
  await p2sh.unlockBshardRefund({ wallet: { getPrivateKey: () => priv, getNetworkId: () => NET }, cmd, networkId: NET });
  assert.ok(captured, '假 RPC 没截获到 tx —— 生产码没走到 submit');
  return String(captured.outputs[cmd.witness.pool_out_idx].scriptPublicKey?.script
    ?? captured.outputs[cmd.witness.pool_out_idx].scriptPublicKey);
}
const spkOfAddress = (addr) => String(kaspa.payToAddressScript(new kaspa.Address(addr)).script
  ?? kaspa.payToAddressScript(new kaspa.Address(addr)));

await t('前置 · 未改动的生产码在 hermetic RPC 下跑到 submit 并被截获（证明不是包壳）', async () => {
  const spk = await runRefundAndCaptureContinuationSpk();
  assert.ok(spk && spk.length > 10, `没读到 continuation scriptPubKey: ${spk}`);
});

// 🔴 **决定性断言**：生产路径产出的 continuation 必须等于【描述符推导的期望】(多-entry ⇒ start=1)。
//    调用点若被变异成传错 start（如 0），这一格必红 —— 这正是 B-1 要证的"有人在观察那个调用点"。
await t('B-1 · 生产路径的 continuation == 描述符期望(start=1) ⇒ 调用点传错 start 必红', async () => {
  const got = await runRefundAndCaptureContinuationSpk();
  const wantAddr = p2sh._continuationAddress(POOL_REDEEM, stateHex, NET, 1);
  assert.strictEqual(got, spkOfAddress(wantAddr),
    '生产路径算出的 continuation 与 start=1 的期望不符 ⇒ 要么调用点传了别的 start, 要么 splice 口径变了');
});

// 对照臂：start=0 必须产出【不同】的 spk —— 否则上面那格对 start 是瞎的（坏时输出=已知答案）
await t('B-1 对照臂 · start=0 的期望与 start=1 【不同】(否则决定性断言对该参数不敏感)', async () => {
  const at1 = spkOfAddress(p2sh._continuationAddress(POOL_REDEEM, stateHex, NET, 1));
  const at0 = spkOfAddress(p2sh._continuationAddress(POOL_REDEEM, stateHex, NET, 0));
  assert.notStrictEqual(at1, at0, 'start=1 与 0 产出同一个 spk ⇒ 本用例无法察觉调用点传错 start');
});

console.log(`\n${fail === 0 ? '✅' : '🔴'} u1-roundtrip-b1: ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exitCode = 1;
