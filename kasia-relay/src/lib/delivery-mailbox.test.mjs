// delivery-mailbox.test.mjs — 账本1877 步2: 信箱窄转账命令的校验 + 注册护栏(零 RPC)。Run: cd kasia-relay && node src/lib/delivery-mailbox.test.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const M = await import('./delivery-mailbox.mjs');
const C = await import('./commands.mjs');
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const ADDR = 'kaspasim:q' + 'a'.repeat(61);
const PAY = M.MAILBOX_MAGIC_HEX + '00'.repeat(40);
const ok = (o = {}) => M.validateMailboxSend({ target: ADDR, amount: '0.2', payload_hex: PAY, ...o }, 'kaspasim');
await t('合法: P2PK 目标 + 面值区间内 + KDL1 信封', () => { const r = ok(); assert.ok(r.ok); assert.strictEqual(r.amountKas, '0.2'); assert.strictEqual(r.payloadBytes, 44); });
await t('面值边界: 下限-1 sompi 拒 / 下限过 / 上限过 / 上限+1 sompi 拒 / number 形式', () => {
  assert.ok(!ok({ amount: '0.14999999' }).ok); assert.ok(ok({ amount: '0.15' }).ok); assert.ok(ok({ amount: '0.3' }).ok); assert.ok(!ok({ amount: '0.30000001' }).ok);
  assert.ok(ok({ amount: 0.2 }).ok); assert.strictEqual(M.MAILBOX_MIN_KAS, '0.15', '下限来自 simnet 实测: 0.14 失败 0.15 通过');
  for (const bad of ['abc', '', '-1', '0.123456789', '1e-2', null, undefined]) assert.ok(!ok({ amount: bad }).ok, String(bad));
});
await t('目标: P2SH(p)/前缀不符/畸形 ⇒ 拒', () => {
  assert.ok(!ok({ target: 'kaspasim:p' + 'a'.repeat(61) }).ok);
  assert.ok(!ok({ target: 'kaspa:q' + 'a'.repeat(61) }).ok, '主网前缀进 simnet relay 必拒');
  for (const bad of ['', 'x', 'kaspasim:q', undefined, 'kaspasim:Q' + 'a'.repeat(61)]) assert.ok(!ok({ target: bad }).ok, String(bad));
});
await t('payload: 非 KDL1 魔数 / 太短 / 太长 / 奇数 hex / 大写 / 非 hex ⇒ 拒; 上限恰好过', () => {
  assert.ok(!ok({ payload_hex: '00'.repeat(44) }).ok);
  assert.ok(!ok({ payload_hex: M.MAILBOX_MAGIC_HEX + '00'.repeat(5) }).ok);
  assert.ok(ok({ payload_hex: M.MAILBOX_MAGIC_HEX + '00'.repeat(M.MAILBOX_MAX_PAYLOAD_BYTES - 4) }).ok);
  assert.ok(!ok({ payload_hex: M.MAILBOX_MAGIC_HEX + '00'.repeat(M.MAILBOX_MAX_PAYLOAD_BYTES - 3) }).ok);
  assert.ok(!ok({ payload_hex: PAY + '0' }).ok); assert.ok(!ok({ payload_hex: PAY.toUpperCase() }).ok); assert.ok(!ok({ payload_hex: 'zz' + PAY }).ok);
  assert.ok(!ok({ payload_hex: undefined }).ok);
});
await t('payload 上限与 delivery-crypto 冻结线格式一致(4 魔数 + 12 iv + 1024 明文 + 16 tag)', () => {
  assert.strictEqual(M.MAILBOX_MAX_PAYLOAD_BYTES, 4 + 12 + 1024 + 16);
  const src = readFileSync(join(here, '../../../kasia-console/src/lib/checkout-static/delivery-crypto.js'), 'utf8');
  assert.match(src, /MAGIC = 'KDL1'/); assert.match(src, /IV_BYTES = 12/); assert.match(src, /MAX_PLAINTEXT_BYTES = 1024/);
  assert.strictEqual(M.MAILBOX_MAGIC_HEX, Buffer.from('KDL1').toString('hex'));
});
await t('命令三层注册(enum + required + field types), 缺字段被 validateCommandPayload 拒', () => {
  assert.strictEqual(C.COMMAND_TYPES.DELIVERY_MAILBOX_SEND, 'delivery_mailbox_send');
  assert.deepStrictEqual(C.COMMAND_PAYLOAD_SCHEMA.delivery_mailbox_send, ['target', 'amount', 'payload_hex']);
  assert.ok(C.validateCommandPayload({ type: 'delivery_mailbox_send', target: ADDR, amount: '0.2', payload_hex: PAY }).valid);
  for (const miss of ['target', 'amount', 'payload_hex']) { const c = { type: 'delivery_mailbox_send', target: ADDR, amount: '0.2', payload_hex: PAY }; delete c[miss]; assert.ok(!C.validateCommandPayload(c).valid, miss); }
  assert.ok(!C.validateCommandPayload({ type: 'delivery_mailbox_send', target: 5, amount: '0.2', payload_hex: PAY }).valid);
});
await t('relay.mjs: case 先校验再 sendKaspa; 网络前缀取自钱包地址不取调用方; 不在 READONLY_ALLOWLIST', () => {
  const rl = readFileSync(join(here, '../relay.mjs'), 'utf8');
  const i = rl.indexOf("case 'delivery_mailbox_send'"); const body = rl.slice(i, rl.indexOf('\n        }\n', i) + 12);
  assert.ok(i > 0 && body.indexOf('validateMailboxSend(cmd, netPrefix)') < body.indexOf('await sendKaspa('));
  assert.match(body, /netPrefix = String\(localAddress/);
  assert.ok(!/cmd\.network|cmd\.prefix/.test(body));
  assert.ok(!/delivery_mailbox_send|DELIVERY_MAILBOX/.test(readFileSync(join(here, 'authorize.mjs'), 'utf8')));
});
console.log(`\n${pass} pass, ${fail} fail`); process.exitCode = fail ? 1 : 0;
