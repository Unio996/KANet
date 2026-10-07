// smoke_4b_B.mjs — 账本1882 步4b B 单(主网·退款路径): 付款 → (watcher 不抢: 单停 manual_review) → 到期后买家页零签名 refund → 退款 P2PK → 清扫回临时钱包。每步打 txid。
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { mkOrder, flowOf } from './smoke_4a.mjs';
const ROOT = process.env.KANET_ROOT; const require = createRequire(ROOT + '/kasia-console/'); const kaspa = require('kaspa-wasm');
const { sqlite } = await import(pathToFileURL(ROOT + '/kasia-console/src/db/client.js').href);
const RELAY = '1ea5ae27-813a-496c-b20a-e963edd7f9fe', WALLET = 'kaspa:qq6ele36r80mwp8q7we8ecx2g54lcsx9teeqyswp8uv6mthuf98c5n8m5ppar';
const BASE = 'http://127.0.0.1:3299'; const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const OUT = process.argv[2]; const R = { network: 'mainnet', at: new Date().toISOString() };
const call = async (m, p, b, h = {}) => { const r = await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...h }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); try { return { status: r.status, ...JSON.parse(t) }; } catch { return { status: r.status, raw: t.slice(0, 200) }; } };
const dl = Date.now() + 150_000;
const o = await mkOrder('smoke-4b-B-' + Date.now().toString(36), dl, '4bB'); const f = await flowOf(o);
sqlite.prepare("UPDATE delivery_orders SET state='manual_review' WHERE id=? AND state='watching'").run(o.id);   // 退款路径: 不让 watcher 替买家拆分(临时实例库)
if (f.derived.orderAddress !== o.orderAddress || o.total !== 61400000n) throw new Error('地址/金额不符, 停手');
R.order = { id: o.id, order_address: o.orderAddress, refund_address: o.refundAddress, total_sompi: String(o.total), deadline_ms: dl }; log('B 建单', JSON.stringify(R.order));
const pay = await call('POST', `/api/relay/${RELAY}/transfer`, { to: o.orderAddress, amount: '0.61400000' }, { 'x-kanet-admin-secret': process.env.ADMIN_SECRET_FUNDS });
R.pay = pay; log('B 付款', JSON.stringify(pay).slice(0, 300)); if (pay.status !== 200) throw new Error('付款失败, 停手');
for (let i = 0; i < 40; i++) { const fu = await f.funds().catch(() => ({})); if (fu.funded) break; await sleep(3000); }
R.funds_before = await f.funds(); log('B 订单地址资金', JSON.stringify(R.funds_before));
const rpc = new kaspa.RpcClient({ url: process.env.KASPA_RPC_URL, encoding: kaspa.Encoding.Borsh, networkId: 'mainnet' }); await rpc.connect({});
let ref = null, tries = 0, last = null;
while (tries++ < 60) { try { ref = await f.refund(rpc); break; } catch (e) { last = String(e.message).slice(0, 140); if (!/还没到期|未到期/.test(last)) { log('B 退款异常, 停手:', last); R.refund_error = last; writeFileSync(OUT, JSON.stringify(R, null, 1)); process.exit(1); } await sleep(10000); } }
R.refund = { tx: ref?.txId, tries, last_wait_error: last }; log('B 退款', JSON.stringify(R.refund)); if (!ref) process.exit(1);
await sleep(8000); R.after_refund = { funds: await f.funds() };
const sw = await f.sweepRefund(rpc, WALLET); R.sweep_refund = { status: sw.status, txids: sw.txIds, count: sw.count }; log('B 清扫退款', JSON.stringify(sw).slice(0, 300));
writeFileSync(OUT, JSON.stringify(R, null, 1)); process.exit(0);
