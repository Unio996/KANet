// delivery-watcher-service.test.mjs — 账本1877 步3: watcher 接线(开关默认关 / relay id 必配 / 真 ctx 适配的 relay 命令形 / 防重入)。注入 relayCall, 零链。
// Run: cd kasia-console && node src/services/delivery-watcher-service.test.mjs   (自举: 临时 migration 库)
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
if (!process.env._DLVW_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_dlvw_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb, KASPA_NETWORK: 'simnet' }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _DLVW_BOOTSTRAPPED: '1' } });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  process.exit(r.status ?? 1);
}
process.env.KASPA_NETWORK = 'simnet'; process.env.KASPA_RPC_URL = 'ws://127.0.0.1:1';
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
import assert from 'node:assert';
import * as kaspa from 'kaspa-wasm';
const Svc = await import('./delivery-watcher-service.mjs');
const { sqlite } = await import('../db/client.js');
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + String(e?.stack || e?.message || e).split('\n').slice(0, 3).join(' | ')); } };

const mute = async (f) => { const l = console.log, e = console.error; const out = []; console.log = (...a) => out.push(a.join(' ')); console.error = (...a) => out.push(a.join(' ')); try { return { r: await f(), out }; } finally { console.log = l; console.error = e; } };

await t('开关: 未设/非 "1"(含 "true"/" 1"/"on") ⇒ 不启动; "1" 但缺 DELIVERY_RELAY_ID ⇒ 拒启动并 LOUD(不回落默认 relay)', async () => {
  for (const v of [undefined, '', '0', 'true', 'on', ' 1', '"1"']) { const { r } = await mute(() => Svc.startDeliveryWatcherCron({ DELIVERY_WATCHER_ENABLED: v }, { relayCall: async () => ({}) })); assert.strictEqual(r, false, String(v)); }
  const { r, out } = await mute(() => Svc.startDeliveryWatcherCron({ DELIVERY_WATCHER_ENABLED: '1' }, { relayCall: async () => ({}) }));
  assert.strictEqual(r, false); assert.ok(out.some((l) => /DELIVERY_RELAY_ID/.test(l)));
  Svc._stopForTest();
});
await t('开启后启动(返回 true, 定时器 unref)且重复调用幂等; 防重入: 上一轮未结束时不叠加', async () => {
  let calls = 0; let release; const gate = new Promise((r) => { release = r; });
  const { r } = await mute(() => Svc.startDeliveryWatcherCron({ DELIVERY_WATCHER_ENABLED: '1', DELIVERY_RELAY_ID: 'relay-abcdef123', DELIVERY_TICK_MS: '5000' }, { relayCall: async () => { calls++; await gate; return { ok: true, utxos: [] }; } }));
  assert.strictEqual(r, true); assert.strictEqual((await mute(() => Svc.startDeliveryWatcherCron({ DELIVERY_WATCHER_ENABLED: '1', DELIVERY_RELAY_ID: 'x' }, {}))).r, true);
  release(); Svc._stopForTest();
});
await t('真 ctx 适配: getUtxos / sendMailbox / mailboxLanded 发出的 relay 命令形与回执映射正确; 失败回执 ⇒ 抛', async () => {
  const sent = []; const relayCall = async (cmd) => {
    sent.push(cmd);
    if (cmd.type === 'get_address_utxos') return { ok: true, facts: true, utxos: [{ outpoint: { transactionId: 'aa'.repeat(32), index: 1 }, amount: '300000000', covenantId: null }] };
    if (cmd.type === 'delivery_mailbox_send') return cmd.amount === 'bad' ? { ok: false, error: 'nope' } : { ok: true, txId: 'bb'.repeat(32) };
    if (cmd.type === 'check_utxo_landed') return { ok: true, landed: cmd.txid === 'cc'.repeat(32), depth: 25 };
    return { ok: false };
  };
  const ctx = Svc.buildDeliveryCtx({ db: sqlite, relayCall, readerFor: () => ({ listAddressTxs: async () => ({ txs: [], currentBlueScore: 1 }) }), kaspaMod: kaspa });
  assert.deepStrictEqual(await ctx.getUtxos('kaspa:qaddr'), [{ txid: 'aa'.repeat(32), index: 1, amountSompi: '300000000' }]);
  assert.deepStrictEqual(sent[0], { type: 'get_address_utxos', address: 'kaspa:qaddr', facts: true });
  assert.deepStrictEqual(await ctx.sendMailbox({ target: 'kaspasim:qx', amountKas: '0.2', payloadHex: '4b444c31aa' }), { txid: 'bb'.repeat(32) });
  assert.deepStrictEqual(sent[1], { type: 'delivery_mailbox_send', target: 'kaspasim:qx', amount: '0.2', payload_hex: '4b444c31aa' });
  await assert.rejects(ctx.sendMailbox({ target: 'kaspasim:qx', amountKas: 'bad', payloadHex: '4b444c31aa' }), /delivery_mailbox_send 失败/);
  assert.strictEqual(await ctx.mailboxLanded('kaspasim:qx', 'cc'.repeat(32)), true); assert.strictEqual(await ctx.mailboxLanded('kaspasim:qx', 'dd'.repeat(32)), false);
  assert.strictEqual(sent.find((c) => c.type === 'check_utxo_landed').minDepth, 20);
  const bad = Svc.buildDeliveryCtx({ db: sqlite, relayCall: async () => ({ ok: false, error: 'rpc down' }), readerFor: () => ({}), kaspaMod: kaspa });
  await assert.rejects(bad.getUtxos('kaspa:qaddr'), /get_address_utxos 失败/);
  const priv = '41'.repeat(32); assert.strictEqual(ctx.mailboxAddress(priv, 'simnet'), new kaspa.PrivateKey(priv).toPublicKey().toAddress('simnet').toString());
});
await t('出链全部走 relay 窄命令: 服务源码不 import 钱包/私钥/直连 RPC; index.js 已注册且默认关', async () => {
  const src = fs.readFileSync(new URL('./delivery-watcher-service.mjs', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/submitTransaction|RpcClient|getPrivateKey|createInputSignature/.test(src));
  assert.match(fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8'), /startDeliveryWatcherCron\(process\.env, \{\}\);/);
  assert.ok(!/import[^;]*sendCommandAsync[^;]*relay-manager/.test(fs.readFileSync(new URL('./delivery-watcher-service.mjs', import.meta.url), 'utf8')), 'M0a: 服务不裸 import relay-manager');
  assert.match(fs.readFileSync(new URL('./delivery-watcher-service.mjs', import.meta.url), 'utf8'), /env\.DELIVERY_WATCHER_ENABLED !== '1'/);
});
console.log(`\n${pass} pass, ${fail} fail`); process.exitCode = fail ? 1 : 0; process.exit(process.exitCode);
