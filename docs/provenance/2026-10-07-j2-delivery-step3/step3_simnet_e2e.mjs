// step3_simnet_e2e.mjs — 账本1877 步3 simnet 全链路(只对 simnet 跑): 运营者路由用【报价】建单(订单地址完全算出, 退款 = nonce 派生 P2PK)
//   → 买家付款(relay 转账到订单地址) → 真 watcher(buildDeliveryCtx 真适配: relay 窄命令 delivery_split_submit / delivery_mailbox_send / 链上落链核对)
//   → 真 split 落链 → 真信箱交易 → delivered; 买家页核心(startBuyerFlow)仅凭链接读链解密; 链上 split 交易的 sigScript(含 redeem)里【没有交付秘密】;
//   → 买家用凭据清扫信箱; 第二单走"到期退款"(零签名 refund → 退款 P2PK → 买家清扫到自己的地址)。
// 用法: DB_PATH=<simnet console 库> KASPA_RPC_URL=ws://127.0.0.1:29717 KASPA_NETWORK=simnet CONSOLE_ENCRYPTION_KEY=… ADMIN_SECRET_DELIVERY=… node step3_simnet_e2e.mjs <out.json>
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { relays, kaspa, rpcConnect, cmd, transfer, sleep, http } from '../2026-10-05-j2-strict-zero/szlib.mjs';
const HERE = dirname(fileURLToPath(import.meta.url)); const ROOT = resolve(HERE, '../../..');
if (!/simnet/i.test(process.env.KASPA_NETWORK || '')) { console.error('REFUSE: 仅 simnet'); process.exit(2); }
const imp = (p) => import(pathToFileURL(resolve(ROOT, p)).href);
const { sqlite } = await imp('kasia-console/src/db/client.js');
const S = await imp('kasia-console/src/lib/delivery-store.mjs'); const W = await imp('kasia-console/src/lib/delivery-watcher.mjs'); const X = await imp('kasia-console/src/lib/checkout-static/delivery-crypto.js');
const B = await imp('kasia-console/src/lib/checkout-static/delivery-buyer.js'); const Inv = await imp('kasia-console/src/lib/delivery-invoice.mjs'); const SDK = await imp('kasia-console/src/lib/commission-plan-sdk.mjs');
const Svc = await imp('kasia-console/src/services/delivery-watcher-service.mjs'); const RB = await imp('kasia-console/src/lib/checkout-static/resolve-order-browser.js'); const FS = await imp('kasia-console/src/lib/fee-split.mjs');
const OUT = process.argv[2] || 'step3_e2e_result.json'; const SECRET_HDR = process.env.ADMIN_SECRET_DELIVERY || 'simnet-delivery-test-secret';
const R = { network: 'simnet', phases: {} }; const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const rpc = await rpcConnect();
const addrOf = (hex) => new kaspa.PrivateKey(hex).toPublicKey().toAddress('simnet').toString();
const SHA = createHash('sha256').update(readFileSync(resolve(ROOT, 'kasia-console/src/lib/sil-v1/CommissionSplit.sil'))).digest('hex');
const api = (method, path, body) => http(method, path, body, { 'x-kanet-admin-secret': SECRET_HDR });
const dag0 = await rpc.getBlockDagInfo(); const FROM_HASH = String(dag0.sink);

// simnet 版 ReadBackend: 扫 FROM_HASH 之后的区块, 取"与地址相关"的交易(输出到该地址, 或花费了该地址的输出)
const simnetReader = {
  async listAddressTxs(address) {
    const all = []; const seen = new Set(); let low = FROM_HASH;
    for (let i = 0; i < 400; i++) {
      const { blocks } = await rpc.getBlocks({ lowHash: low, includeBlocks: true, includeTransactions: true });
      if (!blocks || blocks.length === 0) break; let added = 0;
      for (const b of blocks) for (const tx of b.transactions || []) {
        const txid = String(tx.verboseData.transactionId); if (seen.has(txid)) continue; seen.add(txid); added++;
        all.push({ txid, isAccepted: true, acceptingBlueScore: Number(b.header.daaScore), blockTimeMs: Number(b.header.timestamp), payloadHex: tx.payload || undefined,
          outputs: tx.outputs.map((o, k) => ({ index: k, valueSompi: String(o.value), address: kaspa.addressFromScriptPublicKey(o.scriptPublicKey, 'simnet').toString() })),
          spentOutpoints: tx.inputs.map((x) => ({ txid: String(x.previousOutpoint.transactionId), index: Number(x.previousOutpoint.index) })) });
      }
      low = String(blocks[blocks.length - 1].header.hash); if (added === 0 || blocks.length < 2) break;
    }
    const mine = new Set(all.filter((t) => t.outputs.some((o) => o.address === address)).flatMap((t) => t.outputs.filter((o) => o.address === address).map((o) => `${t.txid}:${o.index}`)));
    const txs = all.filter((t) => t.outputs.some((o) => o.address === address) || t.spentOutpoints.some((s) => mine.has(`${s.txid}:${s.index}`)));
    return { txs, currentBlueScore: Number((await rpc.getBlockDagInfo()).virtualDaaScore) };
  },
};
const relayCall = async (c) => cmd('fee', c);   // 出链 relay(拆分/信箱命令); 付款人用 bettorA(maker 钱包 UTXO 碎片化: 252 个 ⇒ 大额转账报 Storage mass exceeds maximum)
const ctx = Svc.buildDeliveryCtx({ db: sqlite, relayCall, readerFor: () => simnetReader, kaspaMod: kaspa, log: (m) => log(m) });
// simnet 的 mailboxLanded 沿用 relay check_utxo_landed(minDepth 20)——与生产同一命令

const mkQuote = (id) => SDK.signQuote({ schema_v: 1, quote_id: id, network: 'simnet', merchant_pubkey_hex: new kaspa.PrivateKey('21'.repeat(32)).toPublicKey().toString(), price_sompi: '300000000',
  canonical_rules: { schema_v: 1, roles: [{ name: 'provider', bps: 7000, address: addrOf('31'.repeat(32)) }, { name: 'broker', bps: 500, address: addrOf('32'.repeat(32)) }, { name: 'channel_1', bps: 2500, fold_to: 'provider' }] },
  unfilled_channel_slot_fold_to: 'provider', valid_from_ms: Date.now() - 1000, valid_until_ms: Date.now() + 86400000, channel_whitelist: null, require_channel_deposit: false,
  min_deposit_sompi: '100000000', max_split_fee_sompi: '40000000', max_refund_fee_sompi: '10000000', deadline_offset_ms: 259200000 }, '21'.repeat(32));
const bal = async (a) => BigInt((await rpc.getBalanceByAddress({ address: a })).balance);
const BUYER = addrOf('55'.repeat(32));   // 买家自己的收款地址(清扫目标)

async function mkOrder(skuId, deadlineMs) {
  const quote = mkQuote('qe2e-' + Date.now() + '-' + skuId);
  const c = await api('POST', '/api/delivery/orders', { sku_id: skuId, deadline_ms: deadlineMs, base_url: 'http://127.0.0.1:8080/delivery.html', quote });
  if (!c.ok) throw new Error('建单失败: ' + JSON.stringify(c));
  const u = new URL(c.invoice_link); return { id: c.id, orderAddress: c.order_address, refundAddress: c.refund_address, link: c.invoice_link, secret: /n=([0-9a-f]{32})/.exec(u.hash)[1], quote, total: BigInt(c.total_sompi), u };
}
const flowOf = (o) => B.startBuyerFlow({ location: { hash: o.u.hash, search: o.u.search, pathname: o.u.pathname }, history: { replaceState() {} }, kaspa, RB, feeSplitLib: FS, sourceSha256Hex: SHA, makeReader: () => simnetReader });

// ═════ Phase A: 付款 → watcher(真 split + 真信箱)→ 买家读链取货 → 清扫信箱 ═════
const PLAINTEXT = 'https://example.test/dl/STEP3-E2E-ACTIVATION-' + Date.now();
await api('POST', '/api/delivery/stock', { sku_id: 'e2e3-a', items: [PLAINTEXT] });
const A = await mkOrder('e2e3-a', Date.now() + 3600_000);
const flowA = await flowOf(A);
R.phases.A_create = { order_address_matches_buyer_page: flowA.derived.orderAddress === A.orderAddress, refund_matches: flowA.derived.refundAddress === A.refundAddress, state: S.getOrderPublic(sqlite, A.id).state };
log('A: 建单', A.id.slice(-8), JSON.stringify(R.phases.A_create));
const pay = await transfer('bettorA', A.orderAddress, Number(A.total) / 1e8); R.phases.A_pay = { status: pay.status, txid: pay.txId || pay.txid };
log('A: 付款', JSON.stringify(R.phases.A_pay));
let st = 'watching'; const seen = [st];
for (let i = 0; i < 120 && st !== 'delivered' && st !== 'manual_review'; i++) { await sleep(3000); st = await W.tickOrder(sqlite, S.getOrderPublic(sqlite, A.id), ctx); if (seen[seen.length - 1] !== st) seen.push(st); }
const rowA = S.getOrderPublic(sqlite, A.id);
R.phases.A_watcher = { final_state: st, transitions: seen, pay_txid: rowA.pay_txid, split_txid: rowA.split_txid, mailbox_txid: rowA.mailbox_txid, manual_reason: rowA.manual_reason };
log('A: watcher', JSON.stringify(R.phases.A_watcher));
// 链上: 订单 UTXO 已被花; split 交易的 sigScript(含 redeem)里没有交付秘密、有合约 nonce
const hist = await simnetReader.listAddressTxs(A.orderAddress);
const splitTx = hist.txs.find((t) => t.txid === rowA.split_txid);
const rawSplit = (await rpc.getBlocks({ lowHash: FROM_HASH, includeBlocks: true, includeTransactions: true })).blocks.flatMap((b) => b.transactions || []).find((t) => String(t.verboseData.transactionId) === rowA.split_txid);
const sigHex = rawSplit ? String(rawSplit.inputs[0].signatureScript) : '';
const contractNonce = await X.deriveOrderNonce({ orderNonceHex: A.secret });
R.phases.A_onchain = { split_tx_found: !!splitTx, sigscript_len: sigHex.length, sigscript_contains_secret: X.leaksNonce(sigHex, A.secret), sigscript_contains_contract_nonce: sigHex.includes(contractNonce), split_outputs: splitTx ? splitTx.outputs.map((o) => `${o.address.slice(-8)}:${o.valueSompi}`) : [] };
log('A: 链上核对', JSON.stringify({ ...R.phases.A_onchain, split_outputs: undefined }));
// 买家读链
const chk = await flowA.check(); R.phases.A_buyer = { status: chk.status, plaintext_matches: chk.plaintext === PLAINTEXT, txid_matches: chk.txid === rowA.mailbox_txid };
log('A: 买家读链', JSON.stringify(R.phases.A_buyer));
// 买家清扫信箱到自己的地址
const b0 = await bal(BUYER); const sw = await flowA.sweepMailbox(rpc, BUYER); await sleep(8000); const b1 = await bal(BUYER);
R.phases.A_sweep = { status: sw.status, count: sw.count, buyer_gain_sompi: String(b1 - b0) }; log('A: 清扫信箱', JSON.stringify(R.phases.A_sweep));
// 商家 console 视角: 订单状态与导出的密文
const exp = await api('GET', `/api/delivery/orders/${A.id}/ciphertext`); R.phases.A_export = { has_payload: !!exp.payload_hex, pasted_ok: (await flowA.paste(exp.payload_hex)) === PLAINTEXT };

// ═════ Phase B: 到期退款路径(不跑 watcher): 付款 → 到期 → 买家页触发零签名 refund → 退款 P2PK → 买家清扫 ═════
const dlB = Date.now() + 150_000;
const Bo = await mkOrder('e2e3-b', dlB); const flowB = await flowOf(Bo);
const payB = await transfer('bettorA', Bo.orderAddress, Number(Bo.total) / 1e8); log('B: 付款', payB.status);
const sleepUntil = async (ms) => { while (Date.now() < ms) await sleep(3000); };
let early = null; try { await flowB.refund(rpc); } catch (e) { early = String(e.message).slice(0, 80); }
await sleepUntil(dlB + 20_000);
let refundRes = null, tries = 0;
while (tries++ < 40) { try { refundRes = await flowB.refund(rpc); break; } catch (e) { if (!/还没到期/.test(String(e.message))) { refundRes = { error: String(e.message).slice(0, 160) }; break; } await sleep(5000); } }
await sleep(8000);
const refundBal = await bal(Bo.refundAddress); const funds = await flowB.funds();
const bb0 = await bal(BUYER); const sw2 = await flowB.sweepRefund(rpc, BUYER); await sleep(8000); const bb1 = await bal(BUYER);
R.phases.B_refund = { early_attempt_rejected: early, refund_tx: refundRes?.txId, refund_error: refundRes?.error, refund_address_balance_sompi: String(refundBal), order_spent: funds.spent, sweep_status: sw2.status, buyer_gain_sompi: String(bb1 - bb0), total_sompi: String(Bo.total) };
log('B: 退款', JSON.stringify(R.phases.B_refund));

// ═════ 判定 ═════
const a = R.phases;
const ok = a.A_create.order_address_matches_buyer_page && a.A_create.refund_matches && a.A_watcher.final_state === 'delivered' && a.A_onchain.split_tx_found && !a.A_onchain.sigscript_contains_secret && a.A_onchain.sigscript_contains_contract_nonce
  && a.A_buyer.status === 'delivered' && a.A_buyer.plaintext_matches && a.A_sweep.status === 'sent' && BigInt(a.A_sweep.buyer_gain_sompi) > 15_000_000n && a.A_export.pasted_ok
  && !!a.B_refund.refund_tx && a.B_refund.order_spent && BigInt(a.B_refund.refund_address_balance_sompi) > 0n && a.B_refund.sweep_status === 'sent' && BigInt(a.B_refund.buyer_gain_sompi) > BigInt(a.B_refund.total_sompi) - 60_000_000n;
R.verdict = ok ? 'PASS' : 'FAIL'; writeFileSync(OUT, JSON.stringify(R, null, 1)); log('VERDICT', R.verdict); process.exit(ok ? 0 : 1);
