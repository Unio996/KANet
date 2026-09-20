// prediction-menu-prune.test.mjs — F2 启动清理落到【真 prediction-menu 模块 + 真 _state.json 格式】: 用 TG_BOT_STATE_FILE 指向临时文件(不碰任何真状态文件)。
// Run: cd tg-bot && node prediction-menu-prune.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let n = 0, fail = 0;
const T = async (name, fn) => { n++; try { await fn(); console.log(`  ✅ ${name}`); } catch (e) { fail++; console.log(`  ❌ ${name}: ${e.message}`); } };
const dir = mkdtempSync(join(tmpdir(), 'tgbot-prune-'));
const HERE = dirname(fileURLToPath(import.meta.url));
// 与真 _state.json 同形: [tgUser, value] 条目数组(sessions / pendingPayments / linkedAddrs / userLangs) + brokerFeeTs
const fixture = (over = {}) => ({
  sessions: [['101', { stage: 'category' }], ['102', { stage: 'market' }], ['103', { stage: 'detail' }], ['104', { stage: 'amount' }]],
  pendingPayments: [],
  linkedAddrs: [['101', { address: 'kaspatest:qqold1', linked_at: 1, seen_settled: [] }], ['102', { address: 'kaspatest:qqold2', linked_at: 2, seen_settled: [] }], ['103', { address: 'kaspatest:qqold3', linked_at: 3, seen_settled: [] }], ['104', { address: 'kaspatest:qqold4', linked_at: 4, seen_settled: [] }], ['201', { address: 'kaspa:qqmainnetuser', linked_at: 5, seen_settled: [] }]],
  userLangs: [['101', 'zh'], ['201', 'en']],
  brokerFeeTs: 123456,
  ...over,
});
const load = async (state, tag) => {
  const f = join(dir, `state-${tag}.json`);
  if (state !== null) writeFileSync(f, JSON.stringify(state));
  process.env.TG_BOT_STATE_FILE = f;
  const PM = await import(`./prediction-menu.mjs?${tag}`);   // 每个场景一个新的模块实例(模块级 Map 在 import 时读文件)
  return { PM, f };
};

await T('1 场景: 4 条旧 kaspatest 绑定 + 4 个残留会话 ⇒ 清掉旧绑定与会话, 只留主网绑定; 落盘; 语言偏好与游标不动', async () => {
  const { PM, f } = await load(fixture(), 's1');
  assert.equal(PM.listLinkedUsers().length, 5);
  assert.equal(PM.getLinkedAddr('101'), 'kaspatest:qqold1');
  const r = PM.pruneForReadonlyShell('kaspa');
  assert.deepEqual(r, { droppedLinks: 4, clearedSessions: 4, pendingPayments: 0 });
  assert.deepEqual(PM.listLinkedUsers().map((u) => u.tgUser), ['201']);
  for (const u of ['101', '102', '103', '104']) { assert.equal(PM.getLinkedAddr(u), null, u); assert.equal(PM.inBetFlow(u), false, u); }
  assert.equal(PM.getLinkedAddr('201'), 'kaspa:qqmainnetuser');
  const disk = JSON.parse(readFileSync(f, 'utf8'));   // persistNow 同步落盘
  assert.deepEqual(disk.linkedAddrs.map((e) => e[0]), ['201']); assert.deepEqual(disk.sessions, []);
  assert.deepEqual(disk.userLangs, [['101', 'zh'], ['201', 'en']]); assert.equal(disk.brokerFeeTs, 123456);
  assert.deepEqual(PM.pruneForReadonlyShell('kaspa'), { droppedLinks: 0, clearedSessions: 0, pendingPayments: 0 });   // 幂等
});

await T('2 场景: 有 pendingPayments ⇒ 不清(监控队列), 只回报数量; 内存与磁盘都还在', async () => {
  const { PM, f } = await load(fixture({ pendingPayments: [['101', { exact_sompi: 100000000, side_p2sh: 'x', market_id: 'm' }]] }), 's2');
  const r = PM.pruneForReadonlyShell('kaspa');
  assert.equal(r.pendingPayments, 1); assert.equal(r.droppedLinks, 4);
  assert.equal(PM.listPendingPayments().length, 1);
  assert.equal(JSON.parse(readFileSync(f, 'utf8')).pendingPayments.length, 1);
});

await T('3 场景: 状态文件不存在 ⇒ 模块照常加载, 清理为零操作且不凭空创建文件', async () => {
  const { PM, f } = await load(null, 's3');
  assert.deepEqual(PM.pruneForReadonlyShell('kaspa'), { droppedLinks: 0, clearedSessions: 0, pendingPayments: 0 });
  assert.equal(existsSync(f), false);
});

await T('4 场景: 只有主网绑定、无会话 ⇒ 零操作且不改写文件(不无谓落盘)', async () => {
  const st = fixture({ sessions: [], linkedAddrs: [['201', { address: 'kaspa:qqmainnetuser', linked_at: 5, seen_settled: [] }]] });
  const { PM, f } = await load(st, 's4'); const before = readFileSync(f, 'utf8');
  assert.deepEqual(PM.pruneForReadonlyShell('kaspa'), { droppedLinks: 0, clearedSessions: 0, pendingPayments: 0 });
  assert.equal(readFileSync(f, 'utf8'), before);
});

await T('5 默认状态文件路径没变(TG_BOT_STATE_FILE 只是覆盖项, 未设时仍是 tg-bot 目录下的 _state.json)', () => {
  const src = readFileSync(join(HERE, 'prediction-menu.mjs'), 'utf8');
  assert.ok(src.includes("const STATE_FILE = process.env.TG_BOT_STATE_FILE || join(__dirname, '_state.json');"));
});

rmSync(dir, { recursive: true, force: true });
console.log(`\n${n - fail} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
