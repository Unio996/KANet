// CANDIDATE for NWT sell_cancel_full_dm_e2e mirror (J2 #637 Group C audit, KI 63 整合, 5/21):
// Real-chain SELL cancel-refund (NOT HTTP mock). NWT N19.162 propose ship sell_cancel_full_dm_e2e mirror of
// buy_cancel_full_dm_e2e — this script informs that mirror's design.
// Action: NWT integrate into sell_cancel_full_dm_e2e.test.mjs; keep this until NWT ships mirror, then DEPRECATED.
//
// Phase C Path 3 真 cancel-refund cycle (真转 KAS + 真 sendKas refund chain TX)
// 1. NWT mock peer SELL 5 KAS to Trader-B (DM "卖 5 KAS, BSC, 0x...")
// 2. NWT 真 transfer 5 KAS chain TX to Trader-B addr
// 3. broker scout 检 inbound KAS + publish SELL offer
// 4. NWT mock peer DM "取消"
// 5. broker 真 sendKas 5 KAS refund to NWT
// 6. verify chain TX hash + NWT receive

import { relayAddr, relayId } from '../kasia-console/test-framework/lib/peers.mjs';

const NWT_RELAY_ID = '5b236c08-03d0-456c-953d-e10001610938';
const NWT_ADDR = relayAddr('nwt');
const BROKER_ADDR = relayAddr('trader-b');

async function sendDM(target, message) {
  const url = `http://127.0.0.1:3100/api/relay/${NWT_RELAY_ID}/send-command`;
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'send_message', target, message }),
  });
  return await res.json();
}

async function transferKas(target, amount) {
  const url = `http://127.0.0.1:3100/api/relay/${NWT_RELAY_ID}/send-command`;
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'transfer', target, amount: String(amount) }),
  });
  return await res.json();
}

console.log('=== Phase C Path 3 真 cancel-refund cycle ===');
console.log('NWT mock peer:', NWT_ADDR);
console.log('Broker target:', BROKER_ADDR);
console.log('start ts:', new Date().toISOString());

// T1: SELL request
console.log('\n[T1] SELL request DM');
const t1 = await sendDM(BROKER_ADDR, '我要卖 1 KAS, BSC 链, 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74');
console.log('  T1 tx:', t1.txId?.slice(0, 16) || 'FAILED', t1.error || '');

await new Promise(r => setTimeout(r, 35000));

// T2: YES confirm
console.log('\n[T2] YES confirm');
const t2 = await sendDM(BROKER_ADDR, 'YES, 确认下单');
console.log('  T2 tx:', t2.txId?.slice(0, 16) || 'FAILED', t2.error || '');

await new Promise(r => setTimeout(r, 35000));

// T3: 真转 1 KAS to broker
console.log('\n[T3] 真 transfer 1 KAS chain TX to Trader-B');
const t3 = await transferKas(BROKER_ADDR, 1);
console.log('  T3 transfer tx:', t3.txId?.slice(0, 16) || 'FAILED', t3.error || '', 'fee:', t3.fee);

await new Promise(r => setTimeout(r, 60000));  // 60s for broker scout + ingest + publish offer

// T4: cancel
console.log('\n[T4] cancel');
const t4 = await sendDM(BROKER_ADDR, '取消, 不要了');
console.log('  T4 tx:', t4.txId?.slice(0, 16) || 'FAILED', t4.error || '');

await new Promise(r => setTimeout(r, 60000));  // 60s for broker process cancel + sendKas refund

console.log('\n=== Path 3 cycle DONE, check messages 表 + chain_events broker_kas_refunded ===');
console.log('end ts:', new Date().toISOString());
