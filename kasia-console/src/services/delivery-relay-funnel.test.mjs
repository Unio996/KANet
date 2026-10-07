// delivery-relay-funnel.test.mjs — M0a 反例: watcher 经 funnel 发【别的命令】必须被拒; 白名单命令带固定 relay_id + origin='internal'。注入 send, 零链。
// Run: cd kasia-console && node src/services/delivery-relay-funnel.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
process.env.DB_PATH ||= `${process.env.TEMP || '/tmp'}/_j2_funnel_${process.pid}.db`; process.env.KASPA_NETWORK ||= 'simnet'; process.env.CONSOLE_ENCRYPTION_KEY ||= '1'.repeat(64);   // relay-manager 会带起 db client; 本测试不读写任何表
const { makeDeliveryRelayCall, DELIVERY_RELAY_COMMANDS } = await import('./delivery-relay-funnel.mjs');
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + String(e?.message || e).slice(0, 200)); } };

await t('白名单命令放行, 且 relay_id 固定 / origin 硬编码 internal / 命令体原样', async () => {
  const seen = []; const call = makeDeliveryRelayCall('relay-fixed-1', async (...a) => { seen.push(a); return { ok: true }; });
  for (const type of DELIVERY_RELAY_COMMANDS) await call({ type, x: 1 });
  assert.strictEqual(seen.length, 4);
  for (const [rid, cmd, to, origin] of seen) { assert.strictEqual(rid, 'relay-fixed-1'); assert.strictEqual(origin, 'internal'); assert.strictEqual(to, 30000); assert.ok(DELIVERY_RELAY_COMMANDS.includes(cmd.type)); }
});
await t('反例: 其它命令一律被拒且根本不会调到 send(transfer / send_kaspa / unlock_* / 原型链 / 非字符串 / 空)', async () => {
  let sent = 0; const call = makeDeliveryRelayCall('r', async () => { sent++; return {}; });
  for (const bad of [{ type: 'transfer', target: 'x', amount: '1' }, { type: 'send_kaspa' }, { type: 'unlock_ktt_v2_transfer' }, { type: 'service_escrow_buyer_confirm' }, { type: 'delivery_split_submit ' }, { type: 'DELIVERY_SPLIT_SUBMIT' }, { type: 'constructor' }, { type: '__proto__' }, { type: ['delivery_mailbox_send'] }, { type: null }, {}, null, undefined, 'delivery_mailbox_send']) {
    await assert.rejects(call(bad), /不在交付白名单内/, JSON.stringify(bad));
  }
  assert.strictEqual(sent, 0);
});
await t('命令体里夹带 relay_id / __origin 不能改写目标(funnel 只用构造时固定的 relayId, origin 参数硬编码)', async () => {
  const seen = []; const call = makeDeliveryRelayCall('real-relay', async (...a) => { seen.push(a); return {}; });
  await call({ type: 'delivery_mailbox_send', relay_id: 'evil', __origin: 'operator' });
  assert.strictEqual(seen[0][0], 'real-relay'); assert.strictEqual(seen[0][3], 'internal');
});
await t('构造要求 relayId; 源码里只有一处 sendCommandAsync 调用面、白名单恰 4 项', async () => {
  assert.throws(() => makeDeliveryRelayCall(''), /relayId/); assert.throws(() => makeDeliveryRelayCall(undefined), /relayId/);
  const src = fs.readFileSync(new URL('./delivery-relay-funnel.mjs', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.strictEqual((src.match(/sendCommandAsync/g) || []).length, 2, 'import + 默认参数各一次, 无其它调用面');
  assert.deepStrictEqual([...DELIVERY_RELAY_COMMANDS].sort(), ['check_utxo_landed', 'delivery_mailbox_send', 'delivery_split_submit', 'get_address_utxos']);
});
console.log(`\n${pass} pass, ${fail} fail`); process.exitCode = fail ? 1 : 0; process.exit(process.exitCode);
