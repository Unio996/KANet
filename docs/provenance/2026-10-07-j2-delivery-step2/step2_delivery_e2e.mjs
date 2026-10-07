// step2_delivery_e2e.mjs — 账本1877 步2 simnet 端到端(只对 simnet 跑): 运营者回环路由建单 → (split_done 模拟) → 真 watcher 发【真】relay 信箱交易 → 落链 → delivered
//   → 买家侧: 仅凭凭据(nonce + 订单地址)从链上读出密文并本地解密 = 库存明文; 另验"粘贴密文"路径(运营者导出 hex)。
//   ⚠ 本脚本不做 split(CommissionSplit 的 split 广播适配器属步 3); 订单直接置 split_done 并在输出里标明"模拟"。信箱发送、落链核对、读链、解密全是真的。
// 用法: DB_PATH=<simnet console 库> KASPA_RPC_URL=ws://127.0.0.1:29717 KASPA_NETWORK=simnet CONSOLE_ENCRYPTION_KEY=… node step2_delivery_e2e.mjs <out.json>
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { relays, kaspa, rpcConnect, cmd, sleep, http } from '../2026-10-05-j2-strict-zero/szlib.mjs';
const HERE = dirname(fileURLToPath(import.meta.url)); const ROOT = resolve(HERE, '../../..');
if (!/simnet/i.test(process.env.KASPA_NETWORK || '')) { console.error('REFUSE: 仅 simnet'); process.exit(2); }
const imp = (p) => import(pathToFileURL(resolve(ROOT, p)).href);
const { sqlite } = await imp('kasia-console/src/db/client.js');
const S = await imp('kasia-console/src/lib/delivery-store.mjs');
const W = await imp('kasia-console/src/lib/delivery-watcher.mjs');
const X = await imp('kasia-console/src/lib/checkout-static/delivery-crypto.js');
const OUT = process.argv[2] || 'step2_e2e_result.json';
const SECRET = process.env.ADMIN_SECRET_DELIVERY || 'simnet-delivery-test-secret';
const R = { network: 'simnet', simulated: ['split(订单置 split_done, 不做真 split — 步 3)'], steps: {} };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const rpc = await rpcConnect();
const mkAddr = (seed) => new kaspa.PrivateKey(seed.padEnd(64, '0').slice(0, 64)).toPublicKey().toAddress('simnet').toString();
const MERCHANT = mkAddr(Buffer.from('e2e-merchant').toString('hex'));
const ORDER_ADDR = mkAddr(Buffer.from('e2e-order-' + Date.now()).toString('hex'));
const PLAINTEXT = 'https://example.test/download/ABC123?k=ACTIVATION-' + Date.now();
const BASE = 'http://127.0.0.1:3298';
const api = (method, path, body) => http(method, path, body, { 'x-kanet-admin-secret': SECRET });

// 1. 运营者路由: 建单 / 加库存 / 登记订单地址
const created = await api('POST', '/api/delivery/orders', { sku_id: 'e2e-sku', total_sompi: '300000000', merchant_address: MERCHANT, merchant_amount_sompi: '250000000', deadline_ms: Date.now() + 3600_000, base_url: 'https://example.github.io/checkout/order.html', public_params: { q: 'QUOTE', ch: 'CHAN' } });
if (!created.ok) throw new Error('建单失败: ' + JSON.stringify(created));
const link = new URL(created.invoice_link); const NONCE = link.hash.slice(3);
R.steps.create = { status: 'ok', nonce_only_in_fragment: !link.search.includes(NONCE.slice(0, 8)) && /^#n=[0-9a-f]{32}$/.test(link.hash), state: created.state };
log('建单', created.id.slice(-8), 'nonce 只在 #n=:', R.steps.create.nonce_only_in_fragment);
const stock = await api('POST', '/api/delivery/stock', { sku_id: 'e2e-sku', items: [PLAINTEXT] }); R.steps.stock = { added: stock.added };
const reg = await api('POST', `/api/delivery/orders/${created.id}/address`, { order_address: ORDER_ADDR }); R.steps.register = { state: reg.state };
// 2. 模拟 split_done(明确标注)
if (!S.transition(sqlite, created.id, 'split_done', { split_txid: '5'.repeat(64) })) throw new Error('置 split_done 失败');

// 3. 真 ctx: 真 relay 信箱命令 + 真落链核对(信箱 UTXO 深度 ≥ 20 DAA)
const dag0 = await rpc.getBlockDagInfo(); const fromHash = String(dag0.sink);
let relayFee = null;
const ctx = {
  readHistory: async () => ({ txs: [], currentBlueScore: 0 }), getUtxos: async () => [], triggerSplit: async () => { throw new Error('本 e2e 不做 split'); },
  sendMailbox: async ({ target, amountKas, payloadHex }) => { const r = await cmd('maker', { type: 'delivery_mailbox_send', target, amount: amountKas, payload_hex: payloadHex }); if (r.ok !== true) throw new Error('relay: ' + (r.error || JSON.stringify(r))); relayFee = r.fee; return { txid: r.txId }; },
  mailboxAddress: (priv, net) => new kaspa.PrivateKey(priv).toPublicKey().toAddress(net).toString(),
  mailboxLanded: async (address, txid) => { const { entries } = await rpc.getUtxosByAddresses([new kaspa.Address(address)]); const e = (entries || []).find((x) => x.outpoint.transactionId === txid); if (!e) return false; const v = Number((await rpc.getBlockDagInfo()).virtualDaaScore); return v - Number(e.blockDaaScore) >= W.MIN_DEPTH; },
  nowMs: () => Date.now(), log: (m) => log(m),
};
const tick = async () => W.tickOrder(sqlite, S.getOrderPublic(sqlite, created.id), ctx);
let s = await tick(); R.steps.mailbox_send = { state_after: s, relay_fee_kas: relayFee };
if (s !== 'mailbox_sent') throw new Error('信箱未发出: ' + s + ' ' + JSON.stringify(S.getOrderPublic(sqlite, created.id).manual_reason));
for (let i = 0; i < 90 && s !== 'delivered'; i++) { await sleep(2000); s = await tick(); }
R.steps.delivered = { state: s, order: (({ id, state, mailbox_address, mailbox_txid, delivered_at }) => ({ id: id.slice(-8), state, mailbox_address, mailbox_txid, delivered_at }))(S.getOrderPublic(sqlite, created.id)) };
log('state =', s);

// 4. 买家侧: 只凭 nonce + 订单地址, 从链上读(simnet 扫块适配器 = 读后端接口的 simnet 实现), 本地解密
const ord = S.getOrderPublic(sqlite, created.id);
const readHistory = async (address) => {
  const { blocks } = await rpc.getBlocks({ lowHash: fromHash, includeBlocks: true, includeTransactions: true });
  const txs = [];
  for (const b of blocks) for (const tx of b.transactions || []) {
    if (!tx.payload) continue;
    const outs = tx.outputs.map((o, i) => ({ index: i, address: kaspa.addressFromScriptPublicKey(o.scriptPublicKey, 'simnet').toString() }));
    if (!outs.some((o) => o.address === address)) continue;
    txs.push({ txid: tx.verboseData.transactionId, payloadHex: tx.payload, isAccepted: true, acceptingBlueScore: Number(b.header.daaScore) });
  }
  return { txs, currentBlueScore: Number((await rpc.getBlockDagInfo()).virtualDaaScore) };
};
const { mailboxPrivHex } = await X.deriveMailboxKey({ orderNonceHex: NONCE, orderAddress: ORDER_ADDR });
const buyerMailbox = X.mailboxAddress(kaspa, mailboxPrivHex, 'simnet');
const h = await readHistory(buyerMailbox);
const pick = await X.pickDeliverable({ orderNonceHex: NONCE, orderAddress: ORDER_ADDR, txs: h.txs, currentBlueScore: h.currentBlueScore });
R.steps.buyer_read = { mailbox_matches_seller: buyerMailbox === ord.mailbox_address, txs_found: h.txs.length, status: pick.status, plaintext_matches_stock: pick.plaintext === PLAINTEXT, txid_matches: pick.txid === ord.mailbox_txid };
log('买家读链:', JSON.stringify(R.steps.buyer_read));
// 5. 粘贴密文路径: 运营者导出 hex → 买家本地解密(同一 AEAD)
const exp = await api('GET', `/api/delivery/orders/${created.id}/ciphertext`);
const pasted = await X.decryptDeliverable({ orderNonceHex: NONCE, orderAddress: ORDER_ADDR, payloadHex: exp.payload_hex });
const wrong = await X.decryptDeliverable({ orderNonceHex: NONCE.replace(/.$/, (c) => (c === '0' ? '1' : '0')), orderAddress: ORDER_ADDR, payloadHex: exp.payload_hex });
R.steps.paste_path = { decrypted_ok: pasted === PLAINTEXT, wrong_nonce_rejected: wrong === null };
// 6. 链上字节核对: payload 即 DB 里的密文, 且不含明文
R.steps.onchain_payload = { equals_db_payload: h.txs.some((t) => t.payloadHex === ord.mailbox_payload_hex), contains_plaintext: h.txs.some((t) => Buffer.from(t.payloadHex, 'hex').toString('latin1').includes('ACTIVATION')) };
const ok = R.steps.delivered.state === 'delivered' && R.steps.buyer_read.plaintext_matches_stock && R.steps.buyer_read.mailbox_matches_seller && R.steps.paste_path.decrypted_ok && R.steps.paste_path.wrong_nonce_rejected && R.steps.onchain_payload.equals_db_payload && !R.steps.onchain_payload.contains_plaintext;
R.verdict = ok ? 'PASS' : 'FAIL'; writeFileSync(OUT, JSON.stringify(R, null, 1)); log('VERDICT', R.verdict); process.exit(ok ? 0 : 1);
