// monitor-rpcurl.test.mjs — v0.2.4-test: 主网忽略订单链接里的 ?rpcUrl=, 只用公共池; simnet/testnet 行为不变。
// 开发期自检(不在发布包清单 RUNTIME_FILES 里, 同 *-parity.mjs)。跑: node --test kasia-console/src/lib/checkout-static/monitor-rpcurl.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { connectMonitorRpc, resolveRpcUrlOverride } from './monitor.js';

const EVIL = 'ws://evil.example:17110';

// 假 kaspa-wasm: 记录所有被构造/连接的 url; allow 里的 url 才连得上(模拟节点), 其余 connect 抛错。
function fakeWasm(allow) {
  const constructed = [], connected = [];
  class RpcClient {
    constructor(o) { this.url = o.url; this.resolver = o.resolver; constructed.push(o.url ?? '<resolver>'); }
    async connect() { if (this.resolver) throw new Error('no resolver in test'); if (!allow.has(this.url)) throw new Error('ECONNREFUSED ' + this.url); connected.push(this.url); }
  }
  class Resolver {}
  return { wasm: { RpcClient, Resolver }, constructed, connected };
}

test('resolveRpcUrlOverride: 主网一律 undefined, 其它网络原样', () => {
  assert.equal(resolveRpcUrlOverride('mainnet', EVIL), undefined);
  assert.equal(resolveRpcUrlOverride('mainnet', undefined), undefined);
  assert.equal(resolveRpcUrlOverride('simnet', 'ws://127.0.0.1:17510'), 'ws://127.0.0.1:17510');
  assert.equal(resolveRpcUrlOverride('testnet-12', 'ws://127.0.0.1:17210'), 'ws://127.0.0.1:17210');
  assert.equal(resolveRpcUrlOverride('simnet', null), undefined);
  assert.equal(resolveRpcUrlOverride('simnet', ''), undefined);
});

test('反例: 主网 + rpcUrl=ws://evil ⇒ 不构造也不连该地址, 只连公共池', async () => {
  const pool0 = 'wss://sara.kaspa.red/kaspa/mainnet/wrpc/borsh';
  const { wasm, constructed, connected } = fakeWasm(new Set([pool0, EVIL]));   // 即使 evil "可连"也不该被用
  const r = await connectMonitorRpc(wasm, { network: 'mainnet', rpcUrl: EVIL });
  assert.equal(r.url, pool0);
  assert.ok(!constructed.includes(EVIL), 'evil 不得被构造 RpcClient');
  assert.ok(!connected.includes(EVIL), 'evil 不得被连接');
});

test('反例: 主网 + rpcUrl=evil + 公共池全挂 ⇒ 走 Resolver 兜底/报错, 仍不碰 evil', async () => {
  const { wasm, constructed } = fakeWasm(new Set([EVIL]));
  await assert.rejects(() => connectMonitorRpc(wasm, { network: 'mainnet', rpcUrl: EVIL }));
  assert.ok(!constructed.includes(EVIL));
});

test('simnet + rpcUrl ⇒ 照旧直连该地址(测试用途不受影响)', async () => {
  const local = 'ws://127.0.0.1:17510';
  const { wasm, connected } = fakeWasm(new Set([local]));
  const r = await connectMonitorRpc(wasm, { network: 'simnet', rpcUrl: local });
  assert.equal(r.url, local); assert.deepEqual(connected, [local]);
});

test('simnet 不带 rpcUrl ⇒ 仍然报"必须显式传 rpcUrl"', async () => {
  const { wasm } = fakeWasm(new Set());
  await assert.rejects(() => connectMonitorRpc(wasm, { network: 'simnet' }), /必须显式传 rpcUrl/);
});
