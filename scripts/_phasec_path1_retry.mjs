// DEPRECATED 5/21 (J2 #637 Group C audit, KI 63 整合):
// One-off Layer 1 fix verify (commit 92a4273f6). Fix shipped + verified, broker-v3 自带 retry logic.
// broker-v2 era HTTP-mock pattern.
// Framework equivalent: test-framework/cases/broker-realchain/sequential_3_round_buy.test.mjs.
//
// Phase C Path 1 BUY retry (Layer 1 verify) — fresh peer + T1 preview + T2 YES
// Layer 1 fix (J2 92a4273f6): MAX_BROADCAST_ATTEMPTS 2→5 + exp backoff 5s/10s/15s/20s
// Verify: T2 YES 现在 publish 是否 PASS (mempool clear window 增到 ~50s)

import { freshTestPeer, relayAddr, relayId } from '../kasia-console/test-framework/lib/peers.mjs';

const NWT_RELAY_ID = '5b236c08-03d0-456c-953d-e10001610938';
const BROKER_TARGET = relayId('trader-b');
const BROKER_ADDR = relayAddr('trader-b');
const KANET_TEST_CHANNEL = 'kanet-test';

const peer = freshTestPeer('phasec-retry-' + Date.now());
console.log('[mock peer]', peer);

async function broadcast(channel, message) {
  const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relayId: NWT_RELAY_ID, channel, message }),
  });
  const j = await res.json();
  console.log(`[broadcast ${channel}]`, j.txId?.slice(0, 12) || JSON.stringify(j).slice(0, 80));
  return j;
}

async function dmBroker(message) {
  const res = await fetch('http://127.0.0.1:3100/api/agent/reply', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relayNodeId: BROKER_TARGET, peer, message }),
  });
  return res.json();
}

console.log('=== Phase C Path 1 RETRY (Layer 1 verify) ===');

await broadcast(KANET_TEST_CHANNEL,
  `[Phase C Path 1 RETRY (Layer 1 verify)] mock peer ${peer.slice(-12)} → broker Trader-B\nverify J2 92a4273f6 retry tuning fix T2 BUY YES publish.\nstart ts: ${new Date().toISOString()}`);

// T1: BUY preview
console.log('\n[T1] sending: 我要买 5 KAS, BNB, 0x...');
const t1Reply = await dmBroker('我要买 3 KAS, BNB 链, 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74');
const t1Text = t1Reply.reply || t1Reply.text || JSON.stringify(t1Reply);
console.log('[T1 broker]', t1Text.slice(0, 200));

await new Promise(r => setTimeout(r, 8000));  // 8s sleep avoid dedup

await broadcast(KANET_TEST_CHANNEL,
  `[Phase C RETRY T1 broker reply preview]\n${t1Text.slice(0, 1500)}\nts: ${new Date().toISOString()}`);

await new Promise(r => setTimeout(r, 8000));

// T2: YES (the previous failure point)
console.log('\n[T2] sending YES (Layer 1 retry test)');
const t2Start = Date.now();
const t2Reply = await dmBroker('YES');
const t2Latency = Date.now() - t2Start;
const t2Text = t2Reply.reply || t2Reply.text || JSON.stringify(t2Reply);
console.log(`[T2 broker latency=${t2Latency}ms]`, t2Text.slice(0, 300));

await new Promise(r => setTimeout(r, 8000));

await broadcast(KANET_TEST_CHANNEL,
  `[Phase C RETRY T2 YES broker reply, latency ${t2Latency}ms]\n${t2Text.slice(0, 1500)}\nts: ${new Date().toISOString()}`);

const t2Pass = !t2Text.includes('下单失败') && !t2Text.includes('aggregation insufficient');
console.log(`\n=== Layer 1 verify: ${t2Pass ? '✅ PASS' : '❌ FAIL (still 下单失败)'} ===`);

await broadcast(KANET_TEST_CHANNEL,
  `[Phase C RETRY result] T2 latency ${t2Latency}ms, ${t2Pass ? '✅ PASS Layer 1 mitigate working' : '❌ FAIL Layer 1 mitigate insufficient, escalate Layer 2 J1 territory'}`);
