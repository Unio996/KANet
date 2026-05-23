// 完整捕获 cn_newbie BUY 7 轮对话, 不截断, 给人眼看
import cnNewbie from '../test-framework/personas/cn_newbie.mjs';
import { freshTestPeer } from '../test-framework/lib/peers.mjs';

const TRADER_B_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const peer = freshTestPeer('ux-probe-buy-' + Date.now());

let state = cnNewbie.initialState();
let lastReply = null;
const turns = [];

for (let i = 1; i <= 8; i++) {
  const turn = cnNewbie.step(state, lastReply);
  state = turn.nextState || state;
  if (turn.done && !turn.message) {
    turns.push({ n: i, sent: '<persona done>', reply: '', latency: 0 });
    break;
  }
  if (!turn.message) {
    turns.push({ n: i, sent: '<no msg>', reply: '', latency: 0 });
    break;
  }
  const t0 = Date.now();
  const res = await fetch('http://127.0.0.1:3100/api/agent/reply', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relayNodeId: TRADER_B_ID, peer, message: turn.message }),
  });
  const data = await res.json();
  lastReply = data.reply || '';
  turns.push({ n: i, sent: turn.message, reply: lastReply, latency: Date.now() - t0 });
  if (turn.done) break;
  await new Promise(r => setTimeout(r, 800));
}

console.log('═══════ cn_newbie BUY full journey (no truncation) ═══════\n');
for (const t of turns) {
  console.log(`──── Turn ${t.n} (${t.latency}ms) ────`);
  console.log(`USER:    ${t.sent}`);
  console.log(`BROKER:  ${t.reply || '<empty>'}`);
  console.log('');
}
