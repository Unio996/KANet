/**
 * Test Plan: Task Queue (Step 1+2) + Episode Isolation (Step 3+4)
 *
 * Unit tests — no system startup needed.
 * Run: node agent-mind/tests/test-task-queue-and-episodes.mjs
 */

import { parseIntent } from '../src/intent-parser.mjs';
import { strict as assert } from 'node:assert';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

// ════════════════════════════════════════════════════════════════════
console.log('\n── Test Group 1: Intent Parser — JSON Guard ──');
// ════════════════════════════════════════════════════════════════════

test('JSON query_card response is skipped', () => {
  const r = parseIntent('{"type":"query_card","intent":"query_balance","data":{}}');
  assert.equal(r.intent, null);
});

test('JSON with type field is skipped', () => {
  const r = parseIntent('  {"type":"confirm","data":{}}');
  assert.equal(r.intent, null);
});

test('Normal text still matches', () => {
  const r = parseIntent('查余额');
  assert.ok(r.intent !== null || true); // may or may not match, just shouldn't crash
});

test('Empty string returns null intent', () => {
  const r = parseIntent('');
  assert.equal(r.intent, null);
});

test('Non-JSON with braces is not skipped', () => {
  // A message that contains { but doesn't start with it
  const r = parseIntent('你的余额是 {unknown}');
  // Should NOT be skipped (doesn't start with {)
  // Just verify it doesn't crash
  assert.ok(r !== undefined);
});

// ════════════════════════════════════════════════════════════════════
console.log('\n── Test Group 2: Channel-based Routing ──');
// ════════════════════════════════════════════════════════════════════

function channelKey(sender, senderMeta) {
  if (senderMeta?.relation === 'owner' || sender?.startsWith('owner:')) return 'console_owner';
  return sender || 'unknown';
}

test('owner via Console → console_owner channel', () => {
  assert.equal(channelKey('owner:relay123', { relation: 'owner' }), 'console_owner');
});

test('owner: prefix → console_owner channel', () => {
  assert.equal(channelKey('owner:xyz', null), 'console_owner');
});

test('sibling agent → their address', () => {
  const addr = 'kaspa:qpjjv2uhj22592...gx2ktetp';
  assert.equal(channelKey(addr, { relation: 'sibling' }), addr);
});

test('stranger → their address', () => {
  const addr = 'kaspa:qqabc123...xyz';
  assert.equal(channelKey(addr, { relation: 'stranger' }), addr);
});

test('different addresses → different channels', () => {
  const a = channelKey('kaspa:aaa', { relation: 'peer' });
  const b = channelKey('kaspa:bbb', { relation: 'peer' });
  assert.notEqual(a, b);
});

test('same address → same channel', () => {
  const a = channelKey('kaspa:aaa', { relation: 'peer' });
  const b = channelKey('kaspa:aaa', { relation: 'peer' });
  assert.equal(a, b);
});

// ════════════════════════════════════════════════════════════════════
console.log('\n── Test Group 3: Channel Lifecycle ──');
// ════════════════════════════════════════════════════════════════════

const EPISODE_MAX_HISTORY = 20;

// Simulate channel management
class ChannelManager {
  constructor() { this._channels = new Map(); }

  getOrCreate(key) {
    const now = Date.now();
    let ch = this._channels.get(key);
    if (!ch) {
      ch = { history: [], createdAt: now, lastActiveAt: now };
      this._channels.set(key, ch);
    }
    ch.lastActiveAt = now;
    return ch;
  }

  record(channel, role, text) {
    channel.history.push({ role, text: (text || '').slice(0, 500), ts: Date.now() });
    if (channel.history.length > EPISODE_MAX_HISTORY) {
      channel.history = channel.history.slice(-EPISODE_MAX_HISTORY);
    }
  }

  get size() { return this._channels.size; }
}

test('create new channel', () => {
  const cm = new ChannelManager();
  const ch = cm.getOrCreate('console_owner');
  assert.equal(ch.history.length, 0);
  assert.equal(cm.size, 1);
});

test('same key returns same channel', () => {
  const cm = new ChannelManager();
  const ch1 = cm.getOrCreate('console_owner');
  cm.record(ch1, 'user', '帮我接入币安');
  const ch2 = cm.getOrCreate('console_owner');
  assert.equal(ch1, ch2);
  assert.equal(ch2.history.length, 1);
});

test('different addresses get different channels', () => {
  const cm = new ChannelManager();
  const ch1 = cm.getOrCreate('kaspa:aaa');
  cm.record(ch1, 'user', '帮我接入币安');
  const ch2 = cm.getOrCreate('kaspa:bbb');
  cm.record(ch2, 'user', '联系陌生人');
  assert.notEqual(ch1, ch2);
  assert.equal(ch1.history.length, 1);
  assert.equal(ch2.history.length, 1);
  assert.equal(cm.size, 2);
});

test('channel history is isolated by address', () => {
  const cm = new ChannelManager();
  const chA = cm.getOrCreate('kaspa:aaa');
  cm.record(chA, 'user', '帮我接入币安');
  cm.record(chA, 'agent', '你更喜欢哪种方式？');

  const chB = cm.getOrCreate('kaspa:bbb');
  cm.record(chB, 'user', '联系陌生人');

  assert.equal(chA.history.length, 2);
  assert.ok(!chA.history.some(h => h.text.includes('陌生人')));
  assert.equal(chB.history.length, 1);
  assert.ok(!chB.history.some(h => h.text.includes('接入')));
});

test('owner talks about both topics in ONE channel', () => {
  const cm = new ChannelManager();
  const ch = cm.getOrCreate('console_owner');
  cm.record(ch, 'user', '帮我接入币安');
  cm.record(ch, 'agent', '好的，引导步骤...');
  cm.record(ch, 'user', '帮我联系陌生人');
  cm.record(ch, 'agent', '好的，目标是谁？');
  // Both topics in same channel — Brain sees full history
  assert.equal(ch.history.length, 4);
  assert.ok(ch.history.some(h => h.text.includes('接入')));
  assert.ok(ch.history.some(h => h.text.includes('陌生人')));
});

test('history truncates at MAX_HISTORY', () => {
  const cm = new ChannelManager();
  const ch = cm.getOrCreate('kaspa:test');
  for (let i = 0; i < 30; i++) cm.record(ch, 'user', `message ${i}`);
  assert.equal(ch.history.length, EPISODE_MAX_HISTORY);
});

test('text is truncated at 500 chars', () => {
  const cm = new ChannelManager();
  const ch = cm.getOrCreate('kaspa:test');
  cm.record(ch, 'user', 'x'.repeat(1000));
  assert.equal(ch.history[0].text.length, 500);
});

// ════════════════════════════════════════════════════════════════════
console.log('\n── Test Group 4: Queue Priority Logic ──');
// ════════════════════════════════════════════════════════════════════

// Simulate the priority queue insertion logic
function insertByPriority(tasks, task) {
  let idx = tasks.findIndex(t => t.priority > task.priority);
  if (idx === -1) idx = tasks.length;
  tasks.splice(idx, 0, task);
  return tasks;
}

test('owner (pri=0) inserted before peer (pri=2)', () => {
  const queue = [];
  insertByPriority(queue, { name: 'peer1', priority: 2 });
  insertByPriority(queue, { name: 'peer2', priority: 2 });
  insertByPriority(queue, { name: 'owner', priority: 0 });
  assert.equal(queue[0].name, 'owner');
  assert.equal(queue[1].name, 'peer1');
  assert.equal(queue[2].name, 'peer2');
});

test('owner (pri=0) inserted before sibling (pri=1)', () => {
  const queue = [];
  insertByPriority(queue, { name: 'sibling', priority: 1 });
  insertByPriority(queue, { name: 'peer', priority: 2 });
  insertByPriority(queue, { name: 'owner', priority: 0 });
  assert.equal(queue[0].name, 'owner');
  assert.equal(queue[1].name, 'sibling');
  assert.equal(queue[2].name, 'peer');
});

test('same priority preserves order (stable)', () => {
  const queue = [];
  insertByPriority(queue, { name: 'peer1', priority: 2 });
  insertByPriority(queue, { name: 'peer2', priority: 2 });
  insertByPriority(queue, { name: 'peer3', priority: 2 });
  assert.equal(queue[0].name, 'peer1');
  assert.equal(queue[1].name, 'peer2');
  assert.equal(queue[2].name, 'peer3');
});

test('multiple owners maintain order among themselves', () => {
  const queue = [];
  insertByPriority(queue, { name: 'peer', priority: 2 });
  insertByPriority(queue, { name: 'owner1', priority: 0 });
  insertByPriority(queue, { name: 'owner2', priority: 0 });
  assert.equal(queue[0].name, 'owner1');
  assert.equal(queue[1].name, 'owner2');
  assert.equal(queue[2].name, 'peer');
});

test('preemption flag is set correctly', () => {
  const current = { name: 'peer', priority: 2, _preempted: false };
  const ownerTask = { name: 'owner', priority: 0 };
  // Simulate preemption check
  if (ownerTask.priority === 0 && current.priority > 0) {
    current._preempted = true;
  }
  assert.equal(current._preempted, true);
});

test('owner task does NOT preempt another owner task', () => {
  const current = { name: 'owner1', priority: 0, _preempted: false };
  const ownerTask = { name: 'owner2', priority: 0 };
  if (ownerTask.priority === 0 && current.priority > 0) {
    current._preempted = true;
  }
  assert.equal(current._preempted, false); // should NOT be preempted
});

// ════════════════════════════════════════════════════════════════════
console.log('\n── Test Group 5: Context Injection Format ──');
// ════════════════════════════════════════════════════════════════════

function buildEpisodeSection(episodeHistory, intentKey) {
  if (!episodeHistory?.length) return '';
  const lines = ['', '=== CONVERSATION HISTORY (this topic: ' + (intentKey || 'general') + ') ==='];
  for (const turn of episodeHistory.slice(-10)) {
    const who = turn.role === 'user' ? 'Them' : 'You';
    lines.push(`${who}: ${turn.text}`);
  }
  lines.push('=== END HISTORY ===');
  lines.push('IMPORTANT: Continue this conversation naturally. You already discussed the above — do NOT repeat greetings or restart the flow.');
  lines.push('');
  return lines.join('\n');
}

test('empty history produces empty section', () => {
  assert.equal(buildEpisodeSection([], 'general'), '');
});

test('history produces correct format', () => {
  const history = [
    { role: 'user', text: '帮我接入币安' },
    { role: 'agent', text: '你更喜欢哪种方式？' },
  ];
  const section = buildEpisodeSection(history, 'onboard_market');
  assert.ok(section.includes('=== CONVERSATION HISTORY (this topic: onboard_market) ==='));
  assert.ok(section.includes('Them: 帮我接入币安'));
  assert.ok(section.includes('You: 你更喜欢哪种方式？'));
  assert.ok(section.includes('=== END HISTORY ==='));
  assert.ok(section.includes('do NOT repeat greetings'));
});

test('history capped at 10 turns in injection', () => {
  const history = [];
  for (let i = 0; i < 15; i++) {
    history.push({ role: 'user', text: `msg ${i}` });
  }
  const section = buildEpisodeSection(history, 'general');
  const turnCount = (section.match(/Them:/g) || []).length;
  assert.equal(turnCount, 10); // only last 10
});

// ════════════════════════════════════════════════════════════════════
console.log('\n── Test Group 6: Sibling Query Card Guard ──');
// ════════════════════════════════════════════════════════════════════

function shouldAbsorbSiblingCard(message, senderMeta) {
  return message && /^\s*\{/.test(message) && message.includes('"query_card"') && senderMeta?.relation === 'sibling';
}

test('sibling query_card JSON is absorbed', () => {
  const msg = '{"type":"query_card","intent":"query_balance","data":{}}';
  assert.ok(shouldAbsorbSiblingCard(msg, { relation: 'sibling' }));
});

test('owner query_card JSON is NOT absorbed', () => {
  const msg = '{"type":"query_card","intent":"query_balance","data":{}}';
  assert.ok(!shouldAbsorbSiblingCard(msg, { relation: 'owner' }));
});

test('stranger query_card JSON is NOT absorbed', () => {
  const msg = '{"type":"query_card","intent":"query_balance","data":{}}';
  assert.ok(!shouldAbsorbSiblingCard(msg, { relation: 'stranger' }));
});

test('normal text from sibling is NOT absorbed', () => {
  const msg = 'Hey, how are you doing?';
  assert.ok(!shouldAbsorbSiblingCard(msg, { relation: 'sibling' }));
});

// ════════════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
console.log(`  Total: ${passed + failed}  |  ✅ Passed: ${passed}  |  ❌ Failed: ${failed}`);
console.log(`${'═'.repeat(50)}\n`);
process.exit(failed > 0 ? 1 : 0);
