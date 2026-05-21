// DEPRECATED 5/21 (J2 #637 Group C audit, KI 63 整合):
// broker-v2 era HTTP-mock cancel-refund test. broker-v2 已废.
// Framework equivalent: test-framework/cases/dm-flow/buy_cancel_full_dm_e2e.test.mjs (NWT 5/21 ship, real-chain Tier 4).
//
// Phase C Path 3 cancel-refund mock peer 真 DM Trader-B
// 6 turn: T1 BUY → T2 YES (锁单) → T3 取消 → T4 verify cancel ack → T5 多重 cancel intent → T6 没 active offer cancel deterministic null

import { freshTestPeer, relayAddr, relayId } from '../kasia-console/test-framework/lib/peers.mjs';

const NWT_RELAY_ID = '5b236c08-03d0-456c-953d-e10001610938';
const BROKER_TARGET = relayId('trader-b');
const BROKER_ADDR = relayAddr('trader-b');
const KANET_TEST_CHANNEL = 'kanet-test';

const peer = freshTestPeer('phasec-path3-cancel-' + Date.now());
console.log('[mock peer]', peer);

let bcSeq = 0;
async function broadcast(msg) {
  bcSeq++;
  const uniqueMsg = `${msg}\n[seq=${bcSeq} micro=${Date.now() % 1000000}]`;
  const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relayId: NWT_RELAY_ID, channel: KANET_TEST_CHANNEL, message: uniqueMsg }),
  });
  const j = await res.json();
  console.log('[bc]', j.txId?.slice(0, 12) || JSON.stringify(j).slice(0, 80));
  return j;
}

async function dm(message) {
  const res = await fetch('http://127.0.0.1:3100/api/agent/reply', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relayNodeId: BROKER_TARGET, peer, message }),
  });
  return res.json();
}

console.log('=== Phase C Path 3 cancel-refund START ===');

await broadcast(`[Phase C Path 3 cancel-refund START] mock peer ${peer.slice(-12)} → broker Trader-B\nstart ts: ${new Date().toISOString()}\n6 turn: BUY 锁单 → 取消 → verify ack → multi cancel intent → no active offer null`);

const turns = [
  { no: 1, user: '我要买 3 KAS, BNB 链, 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74' },
  { no: 2, user: 'YES' },
  { no: 3, user: '取消' },
  { no: 4, user: '我要退款' },
  { no: 5, user: '不要了, 退我钱' },
  { no: 6, user: 'cancel order' },
];

const trace = [];
for (const t of turns) {
  console.log(`\n[T${t.no}] user:`, t.user);
  await broadcast(`[Phase C Path 3 T${t.no} user→broker mock peer ${peer.slice(-12)}]\n> ${t.user}\nts: ${new Date().toISOString()}`);
  await new Promise(r => setTimeout(r, 1500));

  const t0 = Date.now();
  const reply = await dm(t.user);
  const latency = Date.now() - t0;
  const brokerText = reply.reply || reply.text || JSON.stringify(reply);
  console.log(`[T${t.no} broker latency=${latency}ms]`, brokerText.slice(0, 200));
  trace.push({ turn: t.no, user: t.user, broker: brokerText, latency_ms: latency });

  await broadcast(`[Phase C Path 3 T${t.no} broker→user latency ${latency}ms]\n${brokerText.slice(0, 1500)}\nts: ${new Date().toISOString()}`);
  await new Promise(r => setTimeout(r, 7000));
}

await broadcast(`[Phase C Path 3 cancel-refund END] mock peer ${peer.slice(-12)} 6 turn done\nend ts: ${new Date().toISOString()}`);

console.log('\n=== Phase C Path 3 cancel-refund END ===');
console.log(JSON.stringify(trace, null, 2));
