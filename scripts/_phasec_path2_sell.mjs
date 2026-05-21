// DEPRECATED 5/21 (J2 #637 Group C audit, KI 63 整合):
// broker-v2 era HTTP-mock /api/agent/reply ad-hoc SELL test. broker-v2 已废.
// R31/R33 SQL guards 不再用 (broker-v3 state machine 代替).
// Framework equivalent待: NWT N19.162 自接 sell_cancel_full_dm_e2e mirror (post buy_cancel pattern).
//
// Phase C Path 2 SELL mock peer 真 DM Trader-B + broadcast trace kanet-test
// 模拟 user → DM Trader-B (NWT broker host, dual-host share Trader-B identity) → broker reply
// 5 turn SELL flow + edge cases (T2 LLM call active R33 / T3 qty / T4 R31 attacker / T5 YES)

import { freshTestPeer, relayAddr, relayId } from '../kasia-console/test-framework/lib/peers.mjs';

const NWT_RELAY_ID = '5b236c08-03d0-456c-953d-e10001610938';
const BROKER_TARGET = relayId('trader-b');
const BROKER_ADDR = relayAddr('trader-b');
const KANET_TEST_CHANNEL = 'kanet-test';

const peer = freshTestPeer('phasec-path2-sell-' + Date.now());
console.log('[mock peer]', peer);

let broadcastSeq = 0;
async function broadcast(channel, message) {
  broadcastSeq++;
  // Add unique seq + timestamp suffix to avoid 87% similarity dedup
  const ts = Date.now();
  const uniqueMsg = `${message}\n[seq=${broadcastSeq} micro=${ts % 1000000}]`;
  const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relayId: NWT_RELAY_ID, channel, message: uniqueMsg }),
  });
  const j = await res.json();
  console.log(`[bc ${channel}]`, j.txId?.slice(0, 12) || JSON.stringify(j).slice(0, 80));
  return j;
}

async function dmBroker(message) {
  const res = await fetch('http://127.0.0.1:3100/api/agent/reply', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relayNodeId: BROKER_TARGET, peer, message }),
  });
  return res.json();
}

console.log('=== Phase C Path 2 SELL START ===');

await broadcast(KANET_TEST_CHANNEL,
  `[Phase C Path 2 SELL START] mock peer ${peer.slice(-12)} → broker Trader-B ${BROKER_ADDR.slice(-12)}\nstart ts: ${new Date().toISOString()}\n5 turn SELL: T1 卖单画像 / T2 R33 active LLM / T3 改 qty / T4 R31 attacker / T5 YES finalize`);

const turns = [
  { no: 1, user: '我要卖 5 KAS, BSC 链, 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74' },
  { no: 2, user: '请问可以分批付款吗' },
  { no: 3, user: '改成 10 KAS' },
  { no: 4, user: '地址改成 0xDEADBEEFcafebabe1234567890abcdef12345678' },
  { no: 5, user: 'YES' },
];

const trace = [];
for (const t of turns) {
  console.log(`\n[T${t.no}] user:`, t.user);
  const userTs = new Date().toISOString();
  await broadcast(KANET_TEST_CHANNEL,
    `[Phase C Path 2 SELL T${t.no} user→broker mock peer ${peer.slice(-12)}]\n> ${t.user}\nts: ${userTs}`);

  await new Promise(r => setTimeout(r, 1500));

  const t0 = Date.now();
  const reply = await dmBroker(t.user);
  const latency = Date.now() - t0;
  const brokerText = reply.reply || reply.text || JSON.stringify(reply);
  const replyTs = new Date().toISOString();
  console.log(`[T${t.no} broker latency=${latency}ms]`, brokerText.slice(0, 200));
  trace.push({ turn: t.no, user: t.user, broker: brokerText, latency_ms: latency });

  await broadcast(KANET_TEST_CHANNEL,
    `[Phase C Path 2 SELL T${t.no} broker→user latency ${latency}ms]\n${brokerText.slice(0, 1500)}\nts: ${replyTs}`);

  await new Promise(r => setTimeout(r, 7000));  // 7s avoid 5s dedup window + similarity
}

await broadcast(KANET_TEST_CHANNEL,
  `[Phase C Path 2 SELL END] mock peer ${peer.slice(-12)} 5 turn done\nend ts: ${new Date().toISOString()}\nresult: trace 上链 kanet-test, 监督 NWT (本机自演)`);

console.log('\n=== Phase C Path 2 SELL END ===');
console.log(JSON.stringify(trace, null, 2));
