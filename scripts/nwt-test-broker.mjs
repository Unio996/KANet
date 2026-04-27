// NWT 测试矩阵: 场景 1, 2, 12 + L1/L3/L4 多语言 + selectBestOffers 边界
// 输出 to stdout, 我手工汇总到 dev-coord 报告

import Database from 'better-sqlite3';

const TRADER_B = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const PORT = 3100;

// ── 工具 ──────────────────────────────────────────────
async function llmReply(peer, msg) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/agent/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ relayNodeId: TRADER_B, peer, message: msg }),
  });
  return r.json();
}

function db() {
  return new Database('C:/kanet/kasia-console/data/console.db', { readonly: true });
}

function brokerOpenOffers() {
  const d = db();
  return d.prepare(`SELECT id, give_amount, want_amount, json_extract(metadata,'$.source') AS src, protocol_status FROM exchange_offers WHERE protocol_status='open' AND give_asset='KAS' ORDER BY created_at DESC LIMIT 10`).all();
}

const log = (label, val) => console.log(`\n━━━ ${label} ━━━\n${typeof val === 'string' ? val : JSON.stringify(val, null, 2)}`);

// ── 测试集 ────────────────────────────────────────────

async function S_aggregateProbe() {
  const { selectBestOffers } = await import('file:///C:/kanet/kasia-console/src/services/broker-buy-handler.js');
  const r5 = selectBestOffers(5, 'bnb');
  const r50 = selectBestOffers(50, 'bnb');
  const r1k = selectBestOffers(1000, 'bnb');
  return { qty5: r5, qty50: r50, qty1k: r1k };
}

async function S1_buy5_direct() {
  const { finalizeBuy } = await import('file:///C:/kanet/kasia-console/src/services/broker-buy-handler.js');
  const r = await finalizeBuy({ user_kasia: 'kaspa:nwt_s1_' + Date.now(), qty: 5, pay_chain: 'bnb' });
  return r;
}

async function S2_buy50_direct() {
  const { finalizeBuy } = await import('file:///C:/kanet/kasia-console/src/services/broker-buy-handler.js');
  const r = await finalizeBuy({ user_kasia: 'kaspa:nwt_s2_' + Date.now(), qty: 50, pay_chain: 'bnb' });
  return r;
}

async function S12_paid_llm() {
  const peer = 'kaspa:nwt_s12_' + Date.now();
  const r = await llmReply(peer, '我付了 0x123abc456def789aaaa1234567890abcdef1234567890abcdef1234567890abcd');
  return r;
}

async function L1_es() {
  const peer = 'kaspa:nwt_L1_' + Date.now();
  const r1 = await llmReply(peer, 'Hola, quiero comprar 50 KAS');
  const r2 = await llmReply(peer, 'BSC, sí confirmo');
  return { r1, r2 };
}

async function L3_en() {
  const peer = 'kaspa:nwt_L3_' + Date.now();
  const r1 = await llmReply(peer, 'I want to buy 50 KAS');
  const r2 = await llmReply(peer, 'BSC, yes confirmed');
  return { r1, r2 };
}

async function L4_zh() {
  const peer = 'kaspa:nwt_L4_' + Date.now();
  const r1 = await llmReply(peer, '我要买 50 个 KAS');
  const r2 = await llmReply(peer, 'BSC, 对, 确认');
  return { r1, r2 };
}

// ── main ──────────────────────────────────────────────
const before = brokerOpenOffers();
log('BEFORE: open KAS offers', before);

log('Scenario A: selectBestOffers aggregate probe', await S_aggregateProbe());

const s1 = await S1_buy5_direct();
log('Scenario 1: 买 5 KAS BSC direct', s1);

const s2 = await S2_buy50_direct();
log('Scenario 2: 买 50 KAS BSC direct (auto-publish)', s2);

const s12 = await S12_paid_llm();
log('Scenario 12: "我付了 0x..." LLM single-shot', s12);

log('L1 西语', await L1_es());
log('L3 英语', await L3_en());
log('L4 中文', await L4_zh());

const after = brokerOpenOffers();
log('AFTER: open KAS offers', after);

// 释放测试期间挂的 broker 自挂单 (不污染共享 inventory)
log('Cleanup: cancelling broker_dynamic_quote offers from this run', '');
const dyn = after.filter(o => o.src === 'broker_dynamic_quote');
for (const o of dyn) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/exchange/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relayNodeId: TRADER_B, offer_id: o.id }),
  });
  const d = await r.json();
  console.log(`  cancel ${o.id.slice(0,8)} → ${d.ok ? 'ok' : d.error}`);
}
console.log('\n=== DONE ===');
