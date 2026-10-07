// smoke_4b_A.mjs — 账本1882 步4b A 单(主网·真花钱·≤2 KAS 硬顶·只自有地址): 付款 → watcher 真 split → 真信箱 → 买家页读链解密 → 清扫信箱回临时钱包。每步打 txid。
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync } from 'node:fs';
import { mkOrder, flowOf } from './smoke_4a.mjs';
const ROOT = process.env.KANET_ROOT; const require = createRequire(ROOT + '/kasia-console/'); const kaspa = require('kaspa-wasm');
const RELAY = '1ea5ae27-813a-496c-b20a-e963edd7f9fe', WALLET = 'kaspa:qq6ele36r80mwp8q7we8ecx2g54lcsx9teeqyswp8uv6mthuf98c5n8m5ppar';
const BASE = 'http://127.0.0.1:3299'; const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const OUT = process.argv[2]; const R = { network: 'mainnet', at: new Date().toISOString() };
const call = async (m, p, b, h = {}) => { const r = await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...h }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); try { return { status: r.status, ...JSON.parse(t) }; } catch { return { status: r.status, raw: t.slice(0, 200) }; } };
const adm = { 'x-kanet-admin-secret': process.env.ADMIN_SECRET_DELIVERY };
const SKU = 'smoke-4b-A-' + Date.now().toString(36); const ITEM = 'KANET-SMOKE-4B-A-' + Date.now();
const st = await call('POST', '/api/delivery/stock', { sku_id: SKU, items: [ITEM] }, adm); if (!st.ok) throw new Error('stock ' + JSON.stringify(st));
const o = await mkOrder(SKU, Date.now() + 3600e3, '4bA'); const f = await flowOf(o);
if (f.derived.orderAddress !== o.orderAddress) throw new Error('地址不一致, 停手');
R.order = { id: o.id, order_address: o.orderAddress, refund_address: o.refundAddress, total_sompi: String(o.total) }; log('A 建单', JSON.stringify(R.order));
if (o.total !== 61400000n) throw new Error('应付金额非预期, 停手: ' + o.total);
const pay = await call('POST', `/api/relay/${RELAY}/transfer`, { to: o.orderAddress, amount: '0.61400000' }, { 'x-kanet-admin-secret': process.env.ADMIN_SECRET_FUNDS });
R.pay = pay; log('A 付款', JSON.stringify(pay).slice(0, 300)); if (pay.status !== 200) throw new Error('付款失败, 停手');
let s = 'watching'; const seen = [s]; let row;
for (let i = 0; i < 80 && s !== 'delivered' && s !== 'manual_review'; i++) { await sleep(5000); row = (await call('GET', `/api/delivery/orders/${o.id}`, null, adm)).order; s = row.state; if (seen[seen.length - 1] !== s) { seen.push(s); log('A 状态', s, 'split=', row.split_txid, 'mailbox=', row.mailbox_txid); } }
R.watcher = { final: s, transitions: seen, pay_txid: row.pay_txid, split_txid: row.split_txid, mailbox_txid: row.mailbox_txid, manual_reason: row.manual_reason }; log('A watcher', JSON.stringify(R.watcher));
writeFileSync(OUT, JSON.stringify(R, null, 1)); if (s !== 'delivered') { log('未 delivered, 停手保留现场'); process.exit(1); }
const chk = await f.check(); R.buyer = { status: chk.status, plaintext_matches: chk.plaintext === ITEM, txid_matches: chk.txid === row.mailbox_txid }; log('A 买家读链', JSON.stringify(R.buyer));
const rpc = new kaspa.RpcClient({ url: process.env.KASPA_RPC_URL, encoding: kaspa.Encoding.Borsh, networkId: 'mainnet' }); await rpc.connect({});
const sw = await f.sweepMailbox(rpc, WALLET); R.sweep_mailbox = { status: sw.status, count: sw.count, txids: sw.txIds || sw.txid || sw.txId }; log('A 清扫信箱', JSON.stringify(sw).slice(0, 300));
writeFileSync(OUT, JSON.stringify(R, null, 1)); process.exit(0);
