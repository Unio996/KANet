// ingest-settle-frozen-veto.test.mjs — F1b(Bettor GO 1617 / Codex MUST① "最终 send 边界"的 first-send 一半):
// "冻结落地在 driver-core 读冻结(=false)【之后】、prepared 回执落库【之前】⇒ 零广播" 的端到端回归。
//
// 【真的】: driver-core(createSettlementDriver.advanceStep: 真的入口③冻结闸 → pmt 门 → build 端口 → covenant_broadcast → 真 driveSettlementIntent / 意图表)
//   + relay 的真 covenantBroadcastRelay(fresh 路径: 签名→校验→prepared 回执→广播→submitted 回执)+ relay 的真 ingest 客户端(kasia-relay/src/ingest.mjs, 真 fetch 打回环 HTTP)
//   + console 的真 fastify 路由(/ingest/proto-bet-intent-phase: 真 PSK 鉴权 + relay_id 鉴权 + 'settle:' 分派)+ 真 recordSettlementIntentPhase + 真迁移临时库。
// 【假的】: kaspa-wasm 与 rpc(同 kasia-relay/src/lib/covenant-broadcast-relay.test.mjs 的假 kaspa 手法, 拷来的——那份在测试文件内部不可导入); driver-core 的取证/构造端口(pointers/prepare/verifyOnChain/build)与 pmt 读数为最小桩。零真链。
// 时序(NWT 验收线): 冻结【真的】落在 driver-core 的 isSettlementFrozen 端口返回 false 之后——冻结动作挂在该端口的返回之后执行, 之后 core 才继续 pmt 门 → build → covenant_broadcast → relay 写 prepared。
//   (不复用"首发失败后再驱动"那条: 那条与 crash-recovery 同走 resolvePrepared, 测不到首发 TOCTOU。)
// 判据以 "rpc.submitTransaction 被调用次数"(=广播)与库行为准, 不以任何日志为准。
// 弱注入臂(单字段): 正对照与冻结组的 intent、core 调用、relay 调用、fake、HTTP 路径完全相同, 唯一差别 = proto_markets.settlement_frozen_at 一列(且落地时刻)。
// Run: cd kasia-console && node src/api/ingest-settle-frozen-veto.test.mjs

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._INGEST_SETTLE_FROZEN_VETO_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_ingest_settle_frozen_veto_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: { ...process.env, DB_PATH: tmpDb, _INGEST_SETTLE_FROZEN_VETO_BOOTSTRAPPED: '1', KASPA_NETWORK: 'mainnet', PROTO_RELAY_ID: 'relay-test-A', RELAY_NODE_ID: 'relay-test-A', CONSOLE_ENCRYPTION_KEY: 'a'.repeat(64) },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const Fastify = (await import('fastify')).default;
const { sqlite } = await import('../db/client.js');
const { setConfig } = await import('../data/settings/configs.js');
const { registerIngestRoutes } = await import('./ingest.js');
const SI = await import('../lib/proto-settlement-intent.mjs');
const { ensureSettlementIntent, getSettlementIntent, settlementIntentKeyFor, activeSettlementIntent, markSettlementIntent, driveSettlementIntent, checkSettlementIntentLanded } = SI;
const { freezeMarket, isMarketFrozen } = await import('../lib/proto-settlement-freeze.mjs');
const { createSettlementDriver } = await import('../lib/proto-settlement-driver-core.mjs');

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}: ${JSON.stringify(cond)}`); fails++; } };
const quiet = { log: () => {}, warn: () => {}, error: () => {} };

const SECRET = 'test-ingest-secret-for-frozen-veto';
await setConfig('ingest_secret', SECRET);
const app = Fastify({ logger: false });
await app.register(registerIngestRoutes);
await app.listen({ port: 0, host: '127.0.0.1' });
const port = app.server.address().port;
// relay 的 ingest.mjs 在模块加载时读 CONSOLE_URL / INGEST_SECRET ⇒ 必须先设 env 再动态 import。
process.env.CONSOLE_URL = `http://127.0.0.1:${port}`; process.env.INGEST_SECRET = SECRET;
const { ingestProtoBetIntentPhase } = await import('../../../kasia-relay/src/ingest.mjs');
const { covenantBroadcastRelay } = await import('../../../kasia-relay/src/lib/covenant-broadcast-relay.mjs');

// ── 假 kaspa / rpc / wallet / tx: 拷自 kasia-relay/src/lib/covenant-broadcast-relay.test.mjs(只模拟 covenantBroadcastRelay fresh 路径用到的表面) ──
function makeFakeKaspa({ finalTxid = 'FINAL_TXID_DEFAULT' } = {}) {
  class FakeSpk { constructor(hex) { this._hex = hex; } toString() { return this._hex; } }
  class FakeAddress { constructor(s) { this.s = s; } }
  const payToAddressScript = (addr) => new FakeSpk(`spk:${addr.s}`);
  class FakeTransaction {
    constructor({ inputs, outputs }) {
      this.inputs = inputs.map((i) => ({ ...i, utxo: { ...i.utxo, scriptPublicKey: new FakeSpk(i.utxo.scriptPublicKey) } }));
      this.outputs = outputs.map((o) => ({ ...o, scriptPublicKey: new FakeSpk(o.scriptPublicKey) }));
      this.id = null;
    }
    finalize() { this.id = finalTxid; }
    serializeToSafeJSON() {
      return JSON.stringify({
        inputs: this.inputs.map((i) => ({ ...i, utxo: { ...i.utxo, scriptPublicKey: i.utxo.scriptPublicKey.toString() } })),
        outputs: this.outputs.map((o) => ({ ...o, scriptPublicKey: o.scriptPublicKey.toString() })), id: this.id,
      });
    }
    static deserializeFromSafeJSON(jsonStr) { const p = JSON.parse(jsonStr); return new FakeTransaction({ inputs: p.inputs, outputs: p.outputs }); }
  }
  return { Transaction: FakeTransaction, Address: FakeAddress, payToAddressScript, SighashType: { All: 'ALL' }, createInputSignature: (tx, idx) => `sig-${idx}`, calculateTransactionMass: () => 1000n };
}
const FAKE_TX_JSON = JSON.stringify({ inputs: [{ previousOutpoint: { transactionId: 'aa'.repeat(32), index: 0 }, signatureScript: '', sequence: '0', sigOpCount: 1, utxo: { amount: '10000000', scriptPublicKey: 'spk:relay-addr' } }], outputs: [{ value: '9900000', scriptPublicKey: 'spk:relay-addr' }] });
const makeWallet = () => ({ getPrivateKey: () => 'RELAY_PRIVKEY', getAddress: () => 'relay-addr' });
const makeRpc = () => { const calls = []; return { calls, submitTransaction: async (o) => { calls.push(o); } }; };

const DEADLINE = 1_700_000_000_000;
function seedMarket(marketId) {
  const now = new Date().toISOString();
  sqlite.prepare(`INSERT OR IGNORE INTO proto_token_defs (id,name,ticker,created_at) VALUES (?,?,?,?)`).run('t1', 'Test', 'TST', now);
  sqlite.prepare(`INSERT OR IGNORE INTO proto_markets (id,token_def_id,deadline_ms,min_bet,committee_pubkeys_json,committee_privkey_enc,rootclose_tmpl_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(marketId, 't1', DEADLINE, 100, '[]', 'enc', 'aa'.repeat(32), now, now);
}
const freezeIt = (marketId) => freezeMarket({ db: sqlite, marketId, reason: 'operator_emergency_stop', pmt: null, wallMs: Date.now(), log: quiet });

/**
 * 真 driver-core + 真 relay + 真 HTTP + 真 console 的接线。onFreezeRead(marketId, valueReturned) 在 isSettlementFrozen 端口【返回之后】执行——
 * 用它把"冻结落地"精确钉在 driver 读到 false 之后(时刻 T1); 之后 core 继续 pmt 门 → build → covenant_broadcast → relay 写 prepared。
 */
function makeDriver({ rpc, onFreezeRead = null }) {
  const trace = { freezeReads: [] };
  const sendCmd = async (relayId, cmd) => {
    if (cmd.type === 'get_past_median_time') return { ok: true, pastMedianTimeMs: DEADLINE + 10 * 60_000, observedAtMs: Date.now() };   // pmt 已越 deadline+30s ⇒ pmt 门放行
    if (cmd.type === 'covenant_broadcast') return covenantBroadcastRelay({ cmd, kaspa: makeFakeKaspa(), rpc, wallet: makeWallet(), networkId: 'mainnet', senderAddress: 'relay-addr', log: () => {} });   // 真 relay → 真 ingest 客户端 → 真 HTTP → 真 console
    if (cmd.type === 'get_mempool_entry') return { ok: true, found: false };
    if (cmd.type === 'check_utxo_landed') return { ok: true, landed: false, depth: null };
    throw new Error(`unexpected cmd ${cmd.type}`);
  };
  const deps = {
    sendCmd, relayId: 'relay-A', alert: () => {}, minDepth: 5, now: () => Date.now(), log: quiet,
    intents: { ensure: ensureSettlementIntent, active: activeSettlementIntent, get: getSettlementIntent, mark: markSettlementIntent },
    driveIntent: driveSettlementIntent, checkLanded: checkSettlementIntentLanded,
    pointers: () => ({}),
    prepare: async (step, ctx) => (ctx.phase === 'target' ? { targetAddress: 'kaspatest:rootclose-fv' } : { expectedSpks: {}, feeMinAmount: 0n, deadlineMs: DEADLINE, inflightOutpoints: [] }),
    verifyOnChain: async () => ({ events: [], chainParents: {}, fee: { candidates: [] } }),
    build: async () => ({ txJson: FAKE_TX_JSON, expectedTxid: 'FINAL_TXID_DEFAULT', signInputIndices: [0] }),
    dependenciesLanded: async () => ({ ok: true }),
    markLanded: async () => {}, listWork: async () => ({ landedChecks: [], advances: [], resumes: [], preparedRows: [] }),
    isSettlementFrozen: async (marketId) => { const v = isMarketFrozen(sqlite, marketId); trace.freezeReads.push(v); if (onFreezeRead) onFreezeRead(marketId, v); return v; },   // 与 store.isSettlementFrozen 同实现(isMarketFrozen)
  };
  return { driver: createSettlementDriver(deps), trace };
}
const advance = (driver, marketId) => driver.advanceStep({ step: 'close_commit', subjectId: marketId, marketId, tickId: 1 });
const keyOf = (marketId) => settlementIntentKeyFor('market', marketId, 'resolve');

console.log('[test] ① 正对照(未冻结): 真 driver-core → 真 relay fresh 路径 → 真 HTTP → 真 console ⇒ prepared 落库 → 广播 1 次 → submitted:');
{
  seedMarket('fv-ctrl');
  const rpc = makeRpc(); const { driver, trace } = makeDriver({ rpc });
  const r = await advance(driver, 'fv-ctrl'); const row = getSettlementIntent(keyOf('fv-ctrl'));
  ok(trace.freezeReads.length === 1 && trace.freezeReads[0] === false, 'driver-core 入口③ 读冻结 = false ⇒ 放行');
  ok(r.outcome === 'submitted' && r.txId === 'FINAL_TXID_DEFAULT', `advanceStep = submitted(实际 ${JSON.stringify(r)})`);
  ok(rpc.calls.length === 1, `广播恰 1 次(实际 ${rpc.calls.length})`);
  ok(row.status === 'submitted' && !!row.prepared_tx_json, `console 行 = submitted 且带 prepared 字节(实际 ${row.status})——证明整条真链路(含 core / relay / HTTP / 鉴权 / 分派)是通的, 下面的"零广播"不是链路本身坏了`);
}

console.log('[test] ② F1b 回归(NWT 验收线): driver-core 读冻结返回 false【之后】冻结才落地, 在 prepared 回执落库之前 ⇒ 409 ⇒ relay prepared_ingest_failed ⇒ 零广播:');
{
  seedMarket('fv-race');
  const rpc = makeRpc();
  const { driver, trace } = makeDriver({ rpc, onFreezeRead: (marketId, v) => { if (v === false) freezeIt(marketId); } });   // 冻结紧接在"读到 false"之后落地
  const r = await advance(driver, 'fv-race'); const row = getSettlementIntent(keyOf('fv-race'));
  ok(trace.freezeReads[0] === false, '(T0)driver-core 入口③ 确实读到了 false(闸放行了构造)');
  ok(isMarketFrozen(sqlite, 'fv-race') === true, '(T1)此后冻结已落地(在 build / IPC 窗口内)');
  ok(rpc.calls.length === 0, `零广播: submitTransaction 调用 ${rpc.calls.length} 次(此前唯一挡不住的窗口)`);
  ok(r.outcome === 'failed' && /prepared_ingest_failed|not recorded by console|frozen/.test(String(r.message)), `core 视为广播失败(relay 回 prepared_ingest_failed; 实际 ${r.outcome}: ${String(r.message).slice(0, 160)})`);
  ok(row.status === 'pending' && row.prepared_txid === null && row.prepared_tx_json === null, `console 行保持 pending、无 txid / 无字节(实际 ${row.status}/${row.prepared_txid}/${row.prepared_tx_json})`);
  const r2 = await advance(driver, 'fv-race');   // 下一 tick: core 入口③ 现在读到 true ⇒ gated, 不再尝试
  ok(r2.outcome === 'gated' && r2.reason === 'close_commit_settlement_frozen' && rpc.calls.length === 0, `下一 tick 被入口③挡下(gated), 仍零广播(实际 ${r2.outcome}/${r2.reason}/广播 ${rpc.calls.length})`);
}

console.log('[test] ③ relay 侧非 2xx 即 throw(现有行为用测试钉住, 不只靠读码): ingestProtoBetIntentPhase 对 409 reject、对 2xx resolve:');
{
  seedMarket('fv-ingest'); const key = ensureSettlementIntent({ subjectType: 'market', subjectId: 'fv-ingest', step: 'resolve' }).intent_key; freezeIt('fv-ingest');
  let err = null; try { await ingestProtoBetIntentPhase({ intentKey: key, phase: 'prepared', txid: 'FINAL_TXID_DEFAULT', txJson: '[]' }); } catch (e) { err = e; }
  ok(err && /HTTP 409/.test(err.message), `冻结 ⇒ 409 ⇒ 客户端 throw(实际 ${err && err.message})`);
  seedMarket('fv-ingest-ok'); const key2 = ensureSettlementIntent({ subjectType: 'market', subjectId: 'fv-ingest-ok', step: 'resolve' }).intent_key;
  const good = await ingestProtoBetIntentPhase({ intentKey: key2, phase: 'prepared', txid: 'FINAL_TXID_DEFAULT', txJson: '[]' });
  ok(good === true, '未冻结 ⇒ 2xx ⇒ resolve(true)');
}

await app.close();
console.log(fails === 0
  ? '\n✅✅ ALL PASS — F1b: 冻结落在 driver 闸之后 / prepared 回执之前 ⇒ 零广播(真 driver-core + 真 relay + 真 HTTP + 真 console)'
  : `\n❌ ${fails} assertions failed`);
process.exitCode = fails === 0 ? 0 : 1;   // 不显式 process.exit: 刚关的 fastify / fetch 句柄在 Windows 上会撞 libuv UV_HANDLE_CLOSING 断言(已知), 让事件循环自然排空
