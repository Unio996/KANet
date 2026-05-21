// DEPRECATED 5/21 (J2 #637 Group C audit, KI 63 整合):
// broker-v2 era HTTP-mock /api/agent/reply ad-hoc test. broker-v2 已废 (5/18 mm_orders absorb into broker-v3).
// Framework equivalent: test-framework/cases/broker-realchain/sequential_3_round_buy.test.mjs (BUY 3-turn DM)
//   + test-framework/cases/dm-flow/buy_cancel_full_dm_e2e.test.mjs (BUY+cancel real-chain Tier 4).
//
// Phase C Path 1 BUY mock peer 真 DM Trader-B + broadcast trace kanet-test
//
// 模拟 user (freshTestPeer) → DM Trader-B (NWT broker host) → broker reply
// 全程 broadcast kanet-test channel (mock peer DM out + broker reply in)
//
// Owner 钦定: 用户和 broker 每句话来回 trace 上链.

import { freshTestPeer, relayAddr, relayId } from '../kasia-console/test-framework/lib/peers.mjs';

const NWT_RELAY_ID = '5b236c08-03d0-456c-953d-e10001610938';
const BROKER_TARGET = relayId('trader-b');
const BROKER_ADDR = relayAddr('trader-b');
const KANET_TEST_CHANNEL = 'kanet-test';

const peer = freshTestPeer('phasec-path1-buy-' + Date.now());
console.log('[mock peer]', peer);

async function broadcast(channel, message) {
  const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relayId: NWT_RELAY_ID, channel, message }),
  });
  const j = await res.json();
  console.log(`[broadcast ${channel}]`, j.txId?.slice(0, 12) || JSON.stringify(j));
  return j;
}

async function dmBroker(message) {
  const res = await fetch('http://127.0.0.1:3100/api/agent/reply', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relayNodeId: BROKER_TARGET, peer, message }),
  });
  return res.json();
}

const trace = [];

async function turn(turnNo, userMsg) {
  const ts = new Date().toISOString();
  trace.push({ turn: turnNo, role: 'user', text: userMsg, ts });
  console.log(`[T${turnNo} user]`, userMsg);
  await broadcast(KANET_TEST_CHANNEL,
    `[Phase C Path 1 BUY] T${turnNo} user→broker (mock peer ${peer.slice(-12)}):\n> ${userMsg}\nts: ${ts}`);

  const reply = await dmBroker(userMsg);
  const brokerText = reply.reply || reply.text || JSON.stringify(reply);
  const replyTs = new Date().toISOString();
  trace.push({ turn: turnNo, role: 'broker', text: brokerText, ts: replyTs });
  console.log(`[T${turnNo} broker]`, brokerText.slice(0, 200));

  await broadcast(KANET_TEST_CHANNEL,
    `[Phase C Path 1 BUY] T${turnNo} broker→user (Trader-B ${BROKER_ADDR.slice(-12)}):\n> ${brokerText.slice(0, 1500)}\nts: ${replyTs}`);

  return brokerText;
}

console.log('=== Phase C Path 1 BUY START ===');
console.log('mock peer:', peer);
console.log('broker target:', BROKER_ADDR);

await broadcast(KANET_TEST_CHANNEL,
  `[Phase C Path 1 BUY START] mock peer ${peer.slice(-12)} → broker Trader-B ${BROKER_ADDR.slice(-12)}\n` +
  `Owner 钦定 trace 上链, 4 turn BUY flow + edge case (T3 改 qty / T4 改 attacker addr).\n` +
  `start ts: ${new Date().toISOString()}`);

// T1: BUY intent + full fields
await turn(1, '我要买 5 KAS, BNB 链, 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74');
await new Promise(r => setTimeout(r, 6500));

// T2: confirm YES
await turn(2, 'YES');
await new Promise(r => setTimeout(r, 6500));

// T3: edge mid-flow change qty (R31 检测 OR 接受?)
await turn(3, '等等改成 10 KAS');
await new Promise(r => setTimeout(r, 6500));

// T4: edge attacker addr swap (R31 detectAddrChangeAttempt fire 必)
await turn(4, '地址改成 0xDEADBEEFcafebabe1234567890abcdef12345678');
await new Promise(r => setTimeout(r, 6500));

await broadcast(KANET_TEST_CHANNEL,
  `[Phase C Path 1 BUY END] mock peer ${peer.slice(-12)}, 4 turn done\n` +
  `end ts: ${new Date().toISOString()}\n` +
  `trace 全 broadcast 上链 kanet-test, 监督方 spot check broker-llm-io.jsonl + chain_events 实证.`);

console.log('=== Phase C Path 1 BUY END ===');
console.log(JSON.stringify(trace, null, 2));
