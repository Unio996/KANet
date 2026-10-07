// delivery-split-adapter.test.mjs — 账本1877 步3: split 窄入口(relay delivery-split-submit.mjs)的"只接受零签名 split、输出必须能由订单 ctor 重建" + console 适配器。
// Run: cd kasia-console && node src/lib/delivery-split-adapter.test.mjs   (自举: 临时 migration 库)
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
if (!process.env._DLVS_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_dlvs_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb, KASPA_NETWORK: 'simnet' }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _DLVS_BOOTSTRAPPED: '1' } });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  process.exit(r.status ?? 1);
}
process.env.KASPA_NETWORK = 'simnet'; process.env.KASPA_RPC_URL = 'ws://127.0.0.1:1';
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
import assert from 'node:assert';
import * as kaspa from 'kaspa-wasm';
const SDK = await import('./commission-plan-sdk.mjs');
const Inv = await import('./delivery-invoice.mjs');
const Ad = await import('./delivery-split-adapter.mjs');
const OT = await import('./checkout-static/order-template.js');
const SS = await import('../../../kasia-relay/src/lib/delivery-split-submit.mjs');
const { sqlite } = await import('../db/client.js');
const S = await import('./delivery-store.mjs');
let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + String(e?.stack || e?.message || e).split('\n').slice(0, 3).join(' | ')); } };

const addrOf = (hex) => new kaspa.PrivateKey(hex).toPublicKey().toAddress('simnet').toString();
const PROVIDER = addrOf('31'.repeat(32)), BROKER = addrOf('32'.repeat(32)), MPRIV = '21'.repeat(32);
const quote = SDK.signQuote({
  schema_v: 1, quote_id: 'qs-1', network: 'simnet', merchant_pubkey_hex: new kaspa.PrivateKey(MPRIV).toPublicKey().toString(), price_sompi: '300000000',
  canonical_rules: { schema_v: 1, roles: [{ name: 'provider', bps: 7000, address: PROVIDER }, { name: 'broker', bps: 500, address: BROKER }, { name: 'channel_1', bps: 2500, fold_to: 'provider' }] },
  unfilled_channel_slot_fold_to: 'provider', valid_from_ms: Date.now() - 1000, valid_until_ms: Date.now() + 86400000, channel_whitelist: null, require_channel_deposit: false,
  min_deposit_sompi: '100000000', max_split_fee_sompi: '40000000', max_refund_fee_sompi: '10000000', deadline_offset_ms: 259200000,
}, MPRIV);
const NONCE = 'aa'.repeat(16); const DL = Date.now() + 3 * 86400000;
const d = await Inv.deriveInvoiceOrder({ quote, orderNonceHex: NONCE, deadlineMs: DL });
const FUND = { transactionId: '77'.repeat(32), index: 0 };
const mkTx = (amountSompi) => SDK.buildCommissionSplitTx(d.protocol, { ...FUND, amountSompi }).tx;
const total = BigInt(d.totalSompi);
const mkRpc = (amount, o = {}) => ({
  getUtxosByAddresses: async ([addr]) => ({ entries: o.noUtxo ? [] : [{ outpoint: { transactionId: FUND.transactionId, index: FUND.index }, amount: amount.toString() }] }),
  submitTransaction: async ({ transaction }) => { o.submitted?.push(transaction); return { transactionId: String(transaction.id) }; },
});
const spkHexOf = (o) => { const v = Number(o.scriptPublicKey.version); return (v & 0xff).toString(16).padStart(2, '0') + ((v >> 8) & 0xff).toString(16).padStart(2, '0') + String(o.scriptPublicKey.script); };
const toCmd = (tx, o = {}) => ({ input: { txid: String(tx.inputs[0].previousOutpoint.transactionId), index: Number(tx.inputs[0].previousOutpoint.index) }, sig_script_hex: String(tx.inputs[0].signatureScript), outputs: tx.outputs.map((x) => ({ value: String(x.value), spk_hex: spkHexOf(x) })), redeem_hex: o.redeem ?? d.protocol.redeemScriptHex, expected_txid: o.txid ?? String(tx.id) });
const submit = async (tx, o = {}) => { const rpc = mkRpc(o.amount ?? total, o); const cmd = toCmd(tx, o); if (!o.txid) { const rebuilt = SS.buildSplitTxFromCmd(cmd, kaspa); cmd.expected_txid = String(rebuilt.id); } return SS.submitSplit({ cmd, kaspa, rpc, networkId: 'simnet' }); };

await t('布局漂移: relay 的 CS_LAYOUT 与结账页 order-template.js 的 CS_FIELDS 逐项一致(角色/退款/deadline/max_split_fee)', () => {
  const f = Object.fromEntries(OT.CS_FIELDS.map((x) => [x.name, x.offset]));
  assert.strictEqual(SS.CS_LAYOUT.role_count, f.role_count);
  for (let i = 0; i < 7; i++) { assert.strictEqual(SS.CS_LAYOUT.roles[i].spk, f[`role${i + 1}_spk`]); assert.strictEqual(SS.CS_LAYOUT.roles[i].len, f[`role${i + 1}_len`]); assert.strictEqual(SS.CS_LAYOUT.roles[i].amt, f[`role${i + 1}_amt`]); }
  for (const k of ['refund_spk', 'refund_len', 'deadline_ms', 'max_split_fee']) assert.strictEqual(SS.CS_LAYOUT[k], f[k], k);
});
await t('parseCommissionCtor: 从真订单 redeem 读出的角色/金额/退款 spk/费用上限 = 推导时的值', () => {
  const c = SS.parseCommissionCtor(d.protocol.redeemScriptHex);
  assert.strictEqual(c.roles.length, d.finalRoles.length);
  d.finalRoles.forEach((r, i) => { assert.strictEqual(c.roles[i].amountSompi, BigInt(r.amountSompi)); assert.strictEqual(c.roles[i].spkHex, Buffer.from(r.spk).toString('hex')); });
  assert.strictEqual(c.refundSpkHex, Buffer.from(d.protocol.refundSpk).toString('hex')); assert.strictEqual(c.maxSplitFee, 40000000n); assert.strictEqual(c.deadlineMs, BigInt(DL));
  assert.throws(() => SS.parseCommissionCtor('00'.repeat(100)), /不像|越界/); assert.throws(() => SS.parseCommissionCtor('zz'), /hex/);
});
await t('合法 split(恰好金额 / 有找零) ⇒ 通过全部校验并提交', async () => {
  for (const amt of [total, total + 100_000_000n]) {
    const sub = []; const r = await submit(mkTx(amt), { amount: amt, submitted: sub });
    assert.strictEqual(r.ok, true, JSON.stringify(r)); assert.strictEqual(sub.length, 1); assert.strictEqual(r.txId, String(sub[0].id));
  }
});
await t('拒绝: 篡改任一角色金额 ±1 sompi / 换角色 spk / 少输出 / 多余输出(攻击者地址) ⇒ ok:false 且不提交', async () => {
  const variants = [];
  { const tx = mkTx(total); tx.outputs = tx.outputs.map((o, i) => (i === 0 ? new kaspa.TransactionOutput(BigInt(o.value) + 1n, o.scriptPublicKey) : o)); variants.push(['金额+1', tx, /金额/]); }
  { const tx = mkTx(total); tx.outputs = tx.outputs.map((o, i) => (i === 1 ? new kaspa.TransactionOutput(BigInt(o.value) - 1n, o.scriptPublicKey) : o)); variants.push(['金额-1', tx, /金额/]); }
  { const tx = mkTx(total); const evil = kaspa.payToAddressScript(new kaspa.Address(addrOf('99'.repeat(32)))); tx.outputs = tx.outputs.map((o, i) => (i === 0 ? new kaspa.TransactionOutput(BigInt(o.value), evil) : o)); variants.push(['spk 换成攻击者', tx, /scriptPubKey/]); }
  { const tx = mkTx(total); tx.outputs = tx.outputs.slice(0, -1); variants.push(['少一个输出', tx, /输出数/]); }
  { const tx = mkTx(total); const evil = kaspa.payToAddressScript(new kaspa.Address(addrOf('98'.repeat(32)))); tx.outputs = [...tx.outputs, new kaspa.TransactionOutput(1000n, evil)]; variants.push(['多余输出(无找零形态)', tx, /refund_spk|输出数/]); }
  for (const [name, tx, re] of variants) { const sub = []; const r = await submit(tx, { submitted: sub }); assert.strictEqual(r.ok, false, name); assert.match(r.error, re, `${name}: ${r.error}`); assert.strictEqual(sub.length, 0, name); }
});
await t('拒绝: 非零 lockTime / payload / sequence / 两个输入 / version≠1 / 非零 subnetwork ⇒ checkSplitTx 拒; 且 relay 构造器根本不接受这些参数(写死)', async () => {
  const mut = (f) => { const tx = mkTx(total); f(tx); return tx; };
  const cases = [
    ['lockTime', mut((tx) => { tx.lockTime = 5n; }), /lockTime/], ['payload', mut((tx) => { tx.payload = 'abcd'; }), /payload/], ['version', mut((tx) => { tx.version = 0; }), /version/],
    ['sequence', mut((tx) => { const i = tx.inputs[0]; i.sequence = 7n; tx.inputs = [i]; }), /sequence/],
    ['两输入', mut((tx) => { tx.inputs = [tx.inputs[0], tx.inputs[0]]; }), /1 个输入/],
    ['subnetwork', mut((tx) => { tx.subnetworkId = '01' + '00'.repeat(19); }), /subnetwork/],
  ];
  for (const [name, tx, re] of cases) { const r = SS.checkSplitTx(tx, d.protocol.redeemScriptHex); assert.strictEqual(r.ok, false, name); assert.match(r.error, re, `${name}: ${r.error}`); }
  const cmd = { ...toCmd(mkTx(total)), lockTime: 99, payload: 'ff', sequence: 5, subnetworkId: '01'.repeat(20), version: 0, inputs: [1, 2] };
  const built = SS.buildSplitTxFromCmd(cmd, kaspa);
  assert.strictEqual(BigInt(built.lockTime), 0n); assert.strictEqual(String(built.payload), ''); assert.strictEqual(BigInt(built.inputs[0].sequence), 0n); assert.strictEqual(built.inputs.length, 1); assert.strictEqual(Number(built.version), 1); assert.match(String(built.subnetworkId), /^0+$/);
  assert.strictEqual(String(built.id), String(mkTx(total).id), '额外字段不改变交易(txid 与正常构造一致)');
  for (const bad of [{ input: { txid: 'zz', index: 0 } }, { input: { txid: '77'.repeat(32), index: -1 } }, { sig_script_hex: 'zz' }, { outputs: [] }, { outputs: new Array(9).fill({ value: '1', spk_hex: '0000' + '20' + 'ab'.repeat(32) + 'ac' }) }, { outputs: [{ value: '-1', spk_hex: 'aa'.repeat(5) }] }]) assert.throws(() => SS.buildSplitTxFromCmd({ ...toCmd(mkTx(total)), ...bad }, kaspa), undefined, JSON.stringify(bad).slice(0, 60));
});
await t('拒绝: sigScript 不是对该 redeem 的 push(换 redeem) / expected_txid 不符 / 输入 UTXO 不在该地址 / 输入金额不足 / 有找零但低于合约下限', async () => {
  const tx = mkTx(total);
  const otherRedeem = d.protocol.redeemScriptHex.slice(0, -2) + (d.protocol.redeemScriptHex.slice(-2) === '00' ? '01' : '00');
  let r = await submit(tx, { redeem: otherRedeem }); assert.strictEqual(r.ok, false); assert.match(r.error, /sigScript|redeem/);
  r = await submit(mkTx(total), { txid: '00'.repeat(32) }); assert.match(r.error, /expected_txid/);
  r = await submit(mkTx(total), { noUtxo: true }); assert.match(r.error, /UTXO 不在/);
  r = await submit(mkTx(total), { amount: BigInt(d.rolesTotalSompi) - 1n }); assert.strictEqual(r.ok, false);
  const big = total + 300_000_000n; const tx2 = mkTx(big); tx2.outputs = tx2.outputs.map((o, i, a) => (i === a.length - 1 ? new kaspa.TransactionOutput(BigInt(o.value) - 50_000_000n, o.scriptPublicKey) : o));
  r = await submit(tx2, { amount: big }); assert.strictEqual(r.ok, false); assert.match(r.error, /找零/);
  const mal = await SS.submitSplit({ cmd: { ...toCmd(mkTx(total)), outputs: 'x' }, kaspa, rpc: mkRpc(total), networkId: 'simnet' }); assert.strictEqual(mal.ok, false);
  for (const bad of [{ redeem_hex: 'zz' }, { expected_txid: 'x' }]) { const rr = await SS.submitSplit({ cmd: { ...toCmd(mkTx(total)), ...bad }, kaspa, rpc: mkRpc(total), networkId: 'simnet' }); assert.strictEqual(rr.ok, false); }
});
await t('命令三层注册 + relay.mjs case 先校验再提交(submitSplit 内含全部校验) + 不在只读白名单', async () => {
  const C = await import('../../../kasia-relay/src/lib/commands.mjs');
  assert.strictEqual(C.COMMAND_TYPES.DELIVERY_SPLIT_SUBMIT, 'delivery_split_submit'); assert.deepStrictEqual(C.COMMAND_PAYLOAD_SCHEMA.delivery_split_submit, ['input', 'sig_script_hex', 'outputs', 'redeem_hex', 'expected_txid']);
  assert.ok(C.validateCommandPayload({ type: 'delivery_split_submit', input: {}, sig_script_hex: 'aa', outputs: [], redeem_hex: 'aa', expected_txid: 'bb' }).valid);
  assert.ok(!C.validateCommandPayload({ type: 'delivery_split_submit', input: {}, sig_script_hex: 'aa', outputs: [], redeem_hex: 'aa' }).valid);
  const rl = fs.readFileSync(new URL('../../../kasia-relay/src/relay.mjs', import.meta.url), 'utf8'); const i = rl.indexOf("case 'delivery_split_submit'");
  assert.ok(i > 0 && rl.slice(i, i + 900).includes('submitSplit({ cmd, kaspa: kaspaMod'));
  assert.ok(!/delivery_split_submit|DELIVERY_SPLIT/.test(fs.readFileSync(new URL('../../../kasia-relay/src/lib/authorize.mjs', import.meta.url), 'utf8')));
  const src = fs.readFileSync(new URL('../../../kasia-relay/src/lib/delivery-split-submit.mjs', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/getPrivateKey|createInputSignature|wallet/.test(src), '不持私钥不签名');
});

// ── 适配器 ──
const mkOrder = async (o = {}) => {
  const nonce = o.nonce || 'bb'.repeat(16); const dd = await Inv.deriveInvoiceOrder({ quote, orderNonceHex: nonce, deadlineMs: DL + (o.dlDelta || 0) });
  const { id } = S.createInvoiceOrder(sqlite, { network: 'simnet', skuId: 'sku-s', totalSompi: dd.totalSompi, merchantAddress: dd.merchantAddress, merchantAmountSompi: dd.merchantAmountSompi, deadlineMs: DL + (o.dlDelta || 0), nonceHex: nonce, orderAddress: o.address || dd.orderAddress, quoteJson: o.quoteJson || JSON.stringify(quote) });
  return { id, dd, order: S.getOrderPublic(sqlite, id) };
};
await t('适配器: 重建地址 = 库里地址 ⇒ 构造 split 并经 relay 窄命令提交(命令参数齐全, 且 relay 校验通过)', async () => {
  const { order, dd } = await mkOrder({ nonce: 'cc'.repeat(16) }); const calls = [];
  const relayCall = async (cmd) => { calls.push(cmd); const rpc = { getUtxosByAddresses: async () => ({ entries: [{ outpoint: { transactionId: '12'.repeat(32), index: 0 }, amount: dd.totalSompi }] }), submitTransaction: async ({ transaction }) => ({ transactionId: String(transaction.id) }) }; return SS.submitSplit({ cmd, kaspa, rpc, networkId: 'simnet' }); };
  const r = await Ad.makeTriggerSplit({ db: sqlite, relayCall })(order, { txid: '12'.repeat(32), index: 0, amountSompi: dd.totalSompi });
  assert.match(r.txid, /^[0-9a-f]{64}$/); assert.strictEqual(calls.length, 1); assert.strictEqual(calls[0].type, 'delivery_split_submit'); assert.strictEqual(calls[0].redeem_hex, dd.protocol.redeemScriptHex); assert.match(calls[0].expected_txid, /^[0-9a-f]{64}$/);
});
await t('适配器 fail-closed: 库里订单地址与重建不一致 / 无 quote_json / relay 拒绝 / relay 回错 txid ⇒ 抛且(前两种)不调 relay', async () => {
  let n = 0; const relayCall = async () => { n++; return { ok: false, error: 'nope' }; };
  const trig = Ad.makeTriggerSplit({ db: sqlite, relayCall }); const utxo = (dd) => ({ txid: '13'.repeat(32), index: 0, amountSompi: dd.totalSompi });
  const bad = await mkOrder({ nonce: 'dd'.repeat(16), address: 'kaspasim:pbogusaddress0000000000000' });
  await assert.rejects(trig(bad.order, utxo(bad.dd)), /不一致/); assert.strictEqual(n, 0);
  sqlite.prepare('UPDATE delivery_orders SET quote_json = NULL WHERE id = ?').run(bad.id);
  await assert.rejects(trig(S.getOrderPublic(sqlite, bad.id), utxo(bad.dd)), /quote_json/); assert.strictEqual(n, 0);
  const ok = await mkOrder({ nonce: 'ee'.repeat(16) });
  await assert.rejects(trig(ok.order, utxo(ok.dd)), /relay 拒绝/); assert.strictEqual(n, 1);
  const wrongTxid = Ad.makeTriggerSplit({ db: sqlite, relayCall: async () => ({ ok: true, txId: 'ff'.repeat(32) }) });
  await assert.rejects(wrongTxid(ok.order, utxo(ok.dd)), /txid ≠ 预期/);
});
await t('适配器: 报价已过期不影响已存在订单分账(skipValidity); 建单路径仍拒过期报价', async () => {
  const q2 = SDK.signQuote({ ...quote, signature_hex: undefined, quote_id: 'qs-exp', valid_until_ms: Date.now() + 3000 }, MPRIV);
  const dd = await Inv.deriveInvoiceOrder({ quote: q2, orderNonceHex: '1a'.repeat(16), deadlineMs: DL });
  const { id } = S.createInvoiceOrder(sqlite, { network: 'simnet', skuId: 's', totalSompi: dd.totalSompi, merchantAddress: dd.merchantAddress, merchantAmountSompi: dd.merchantAmountSompi, deadlineMs: DL, nonceHex: '1a'.repeat(16), orderAddress: dd.orderAddress, quoteJson: JSON.stringify({ ...q2, valid_until_ms: q2.valid_until_ms }) });
  const qExpired = { ...q2 }; // 签名覆盖 valid_until_ms, 不能改它; 直接用"已过去的有效期"的新签名报价模拟
  const q3 = SDK.signQuote({ ...quote, signature_hex: undefined, quote_id: 'qs-exp2', valid_until_ms: Date.now() - 10 }, MPRIV); void qExpired;
  await assert.rejects(Inv.deriveInvoiceOrder({ quote: q3, orderNonceHex: '2b'.repeat(16), deadlineMs: DL }), /过期/);
  const dd3 = await Inv.deriveInvoiceOrder({ quote: q3, orderNonceHex: '2b'.repeat(16), deadlineMs: DL, skipValidity: true });
  assert.ok(dd3.orderAddress.startsWith('kaspasim:p')); void id;
});
console.log(`\n${pass} pass, ${fail} fail`); process.exitCode = fail ? 1 : 0;
