// smoke_4a.mjs — 账本1882 步4a(零资金·只读): 对【主网网络】的临时 console 实例(端口 3299)建一单, 核对:
//   订单地址 商家侧==买家页推导; 退款地址对拍; 对真 api.kaspa.org 与真主网节点只读(订单地址无 UTXO/无历史); 订单 UTXO 为空 ⇒ 无任何资金动作。
// 不发任何交易。用法(在 临时实例 env 下, kasia-console 目录): run.sh node <本脚本绝对路径> <out.json>
// 报价签名私钥: 随机生成存 docs-private(与资金无关, 仅用于报价自签); 角色收款地址 = Bettor 批的 stress-user-07/08(自有地址)。
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const ROOT = process.env.KANET_ROOT; const require = createRequire(ROOT + '/kasia-console/'); const kaspa = require('kaspa-wasm');
if (process.env.KASPA_NETWORK !== 'mainnet') throw new Error('本脚本只对临时实例的主网配置运行');
const imp = (p) => import(pathToFileURL(ROOT + '/' + p).href);
const SDK = await imp('kasia-console/src/lib/commission-plan-sdk.mjs'); const B = await imp('kasia-console/src/lib/checkout-static/delivery-buyer.js'); const RD = await imp('kasia-console/src/lib/checkout-static/delivery-read.js');
const RB = await imp('kasia-console/src/lib/checkout-static/resolve-order-browser.js'); const FS = await imp('kasia-console/src/lib/fee-split.mjs');
import { createHash } from 'node:crypto';
const SHA = createHash('sha256').update(readFileSync(ROOT + '/kasia-console/src/lib/sil-v1/CommissionSplit.sil')).digest('hex');
const OUT = process.argv[2] || 'smoke_4a_result.json'; const PRIV = 'D:/kanet-tn12/docs-private/j2-delivery-smoke-2026-10-07/quotekey.txt';
let qk; if (existsSync(PRIV)) qk = readFileSync(PRIV, 'utf8').trim(); else { qk = randomBytes(32).toString('hex'); writeFileSync(PRIV, qk + '\n'); }
const PROVIDER = 'kaspa:qz4xldyphshmq8wkwgkr5lelcd9w4gh9x2nxa8y0ltuvs5v8kx6ezsr3vvjnv', BROKER = 'kaspa:qquz2qte4cv876klt8elv34ad6e5zxqf8y5md5mkldjrdyr6xk0qzq4wzmv2w';
const PRICE = process.env.SMOKE_PRICE_SOMPI || '60000000', SPLIT_FEE = process.env.SMOKE_SPLIT_FEE_SOMPI || '1400000', REFUND_FEE = process.env.SMOKE_REFUND_FEE_SOMPI || '1400000';
const DEADLINE_OFFSET = Number(process.env.SMOKE_DEADLINE_OFFSET_MS || 3600000);
export const mkQuote = (id) => SDK.signQuote({ schema_v: 1, quote_id: id, network: 'mainnet', merchant_pubkey_hex: new kaspa.PrivateKey(qk).toPublicKey().toString(), price_sompi: PRICE,
  canonical_rules: { schema_v: 1, roles: [{ name: 'provider', bps: 5500, address: PROVIDER }, { name: 'broker', bps: 2000, address: BROKER }, { name: 'channel_1', bps: 2500, fold_to: 'provider' }] },
  unfilled_channel_slot_fold_to: 'provider', valid_from_ms: Date.now() - 1000, valid_until_ms: Date.now() + 86400000, channel_whitelist: null, require_channel_deposit: false,
  min_deposit_sompi: '1', max_split_fee_sompi: SPLIT_FEE, max_refund_fee_sompi: REFUND_FEE, deadline_offset_ms: DEADLINE_OFFSET }, qk);
const BASE = 'http://127.0.0.1:3299'; const ADM = process.env.ADMIN_SECRET_DELIVERY;
const api = async (m, p, b) => { const r = await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', 'x-kanet-admin-secret': ADM }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); try { return { status: r.status, ...JSON.parse(t) }; } catch { return { status: r.status, raw: t.slice(0, 200) }; } };
export async function mkOrder(skuId, deadlineMs, tag) { const quote = mkQuote(`dlv-smoke-${tag}-${Date.now()}`);
  const c = await api('POST', '/api/delivery/orders', { sku_id: skuId, deadline_ms: deadlineMs, base_url: 'http://127.0.0.1:8080/delivery.html', quote });
  if (!c.ok) throw new Error('建单失败: ' + JSON.stringify(c).slice(0, 300)); const u = new URL(c.invoice_link);
  return { id: c.id, orderAddress: c.order_address, refundAddress: c.refund_address, link: c.invoice_link, u, total: BigInt(c.total_sompi), quote }; }
export const flowOf = (o) => B.startBuyerFlow({ location: { hash: o.u.hash, search: o.u.search, pathname: o.u.pathname }, history: { replaceState() {} }, kaspa, RB, feeSplitLib: FS, sourceSha256Hex: SHA, makeReader: () => RD.makeKaspaApiReaderBrowser('mainnet') });
if (process.argv[1].endsWith('smoke_4a.mjs')) {
  const R = { network: 'mainnet', at: new Date().toISOString() };
  const o = await mkOrder('smoke-4a-' + Date.now().toString(36), Date.now() + 3600e3, '4a'); const f = await flowOf(o);
  R.create = { order_address_matches_buyer_page: f.derived.orderAddress === o.orderAddress, refund_matches: f.derived.refundAddress === o.refundAddress, total_sompi: String(o.total), roles_total_sompi: String(o.total - BigInt(SPLIT_FEE)), order_address: o.orderAddress, refund_address: o.refundAddress,
    prefix_mainnet: o.orderAddress.startsWith('kaspa:p') && o.refundAddress.startsWith('kaspa:q') };
  const chk = await f.check(); R.read_real_api = { status: chk.status };            // 真 api.kaspa.org, 空地址
  const rpc = new kaspa.RpcClient({ url: process.env.KASPA_RPC_URL, encoding: kaspa.Encoding.Borsh, networkId: 'mainnet' }); await rpc.connect({});
  const info = await rpc.getServerInfo(); R.node = { isSynced: info.isSynced, networkId: info.networkId };
  const u1 = await rpc.getUtxosByAddresses([o.orderAddress]), u2 = await rpc.getUtxosByAddresses([o.refundAddress]); R.chain_empty = { order_utxos: u1.entries.length, refund_utxos: u2.entries.length };
  const funds = await f.funds().catch((e) => ({ err: String(e.message).slice(0, 120) })); R.funds = funds;
  const row = await api('GET', `/api/delivery/orders/${o.id}`); R.merchant_view = { state: row.order?.state, has_nonce_field: JSON.stringify(row).includes('nonce'), leaks_secret: JSON.stringify(row).includes(/n=([0-9a-f]{32})/.exec(o.u.hash)[1]) };
  await rpc.disconnect(); R.verdict = (R.create.order_address_matches_buyer_page && R.create.refund_matches && R.create.prefix_mainnet && R.read_real_api.status === 'none' && R.node.isSynced && R.node.networkId.startsWith('mainnet') && R.chain_empty.order_utxos === 0 && R.chain_empty.refund_utxos === 0 && R.merchant_view.state === 'watching' && !R.merchant_view.leaks_secret) ? 'PASS' : 'FAIL';
  writeFileSync(OUT, JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); process.exit(R.verdict === 'PASS' ? 0 : 1);
}
