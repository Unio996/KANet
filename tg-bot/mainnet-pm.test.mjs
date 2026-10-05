// mainnet-pm.test.mjs — D-036 主网预测市场接线的测试: 纯逻辑(mainnet-pm.mjs) + 假 bot 接线(mainnet-pm-handlers.mjs)。零网络零 DB。
// Run: cd tg-bot && node mainnet-pm.test.mjs
import assert from 'node:assert/strict';
import {
  isBettablePoolRow, visiblePoolMarkets, cbData, parseChips, chipsToStakeKtt, createCapTracker, mapRegisterFailure,
  positionKind, groupPositions, formatMyPositions, pickNotifications, utcDayKey,
} from './mainnet-pm.mjs';
import { registerMainnetPm } from './mainnet-pm-handlers.mjs';
import { t as realT } from './i18n.mjs';

let n = 0, fail = 0;
const T = async (name, fn) => { n++; try { await fn(); console.log(`  ✅ ${name}`); } catch (e) { fail++; console.log(`  ❌ ${name}: ${e.message}`); } };
const NOW = Date.UTC(2026, 9, 5, 12, 0, 0);
const row = (o = {}) => ({ id: 'ext-pool-v07-1791201978097-q2acs', protocol_version: 'v0.7', protocol_status: 'pending_bettors', deadline: Math.floor(NOW / 1000) + 3 * 3600, resolution_rule_spec: JSON.stringify({ title: 'Will X happen?', zk_native: true }), yes_pool_kas: 10, no_pool_kas: 20, bettor_count: 2, ...o });
const pos = (o = {}) => ({ market_id: 'shard-1', logical_market_id: 'MKT1', question: JSON.stringify({ title: 'Will X happen?' }), my_direction: 0, my_side: 'YES', stake_kas: 5, status: 'pending_bettors', did_win: null, actual_payout_kas: null, locked_at: 1, ...o });

await T('1 可押盘过滤: 只要 v0.7 + zk_native + pending_bettors + 截止未到(留 5 分钟); 其余全滤掉', () => {
  assert.ok(isBettablePoolRow(row(), NOW));
  assert.ok(!isBettablePoolRow(row({ protocol_version: 'v0.6' }), NOW));
  assert.ok(!isBettablePoolRow(row({ protocol_status: 'attested_v2' }), NOW));
  assert.ok(!isBettablePoolRow(row({ resolution_rule_spec: JSON.stringify({ title: 'x' }) }), NOW));
  assert.ok(!isBettablePoolRow(row({ resolution_rule_spec: 'not json' }), NOW));
  assert.ok(!isBettablePoolRow(row({ deadline: Math.floor(NOW / 1000) + 120 }), NOW));
  const ms = visiblePoolMarkets([row({ id: 'b', deadline: Math.floor(NOW / 1000) + 7200 }), row({ id: 'a', deadline: Math.floor(NOW / 1000) + 3600 }), row({ id: 'c', protocol_version: 'v0.6' })], { nowMs: NOW });
  assert.deepEqual(ms.map((m) => m.id), ['a', 'b']);
});
await T('2 回调数据 ≤64 字节, 超长 id ⇒ null', () => {
  assert.ok(cbData('b', 'ext-pool-v07-1791201978097-q2acs', '1').length <= 64);
  assert.equal(cbData('m', 'x'.repeat(80)), null);
});
await T('3 筹码输入: 只收正整数≥1; 小数/负数/0/空/字母/超大/科学计数法全拒', () => {
  assert.deepEqual(parseChips('5'), { ok: true, chips: 5 });
  assert.deepEqual(parseChips(' 12 '), { ok: true, chips: 12 });
  for (const bad of ['1.5', '-3', '', 'abc', '1e3', '0x10', '5 筹码', '٣']) assert.equal(parseChips(bad).ok, false, bad);
  assert.equal(parseChips('0').reason, 'min');
  assert.equal(parseChips('99999999999').reason, 'max');
});
await T('4 stake_ktt = 筹码×1e8 的整数字符串(BigInt, 无浮点)', () => {
  assert.equal(chipsToStakeKtt(5), '500000000');
  assert.equal(chipsToStakeKtt(1), '100000000');
  assert.equal(chipsToStakeKtt(90071992), '9007199200000000');
  assert.ok(BigInt(chipsToStakeKtt(90071992)) <= BigInt(Number.MAX_SAFE_INTEGER));
});
await T('5 每日上限: 默认按 UTC 日计; 满了不放行; 跨 UTC 午夜清零; 持久化往返', () => {
  let clock = NOW; let saved = null;
  const cap = createCapTracker({ max: 5, now: () => clock, save: (s) => { saved = JSON.parse(JSON.stringify(s)); }, load: () => saved });
  for (let i = 0; i < 5; i++) { assert.ok(cap.allowed('u1')); cap.increment('u1'); }
  assert.ok(!cap.allowed('u1')); assert.ok(cap.allowed('u2'));
  const cap2 = createCapTracker({ max: 5, now: () => clock, load: () => saved });   // 模拟 bot 重启
  assert.ok(!cap2.allowed('u1'));
  assert.equal(cap.resetsAt(), '2026-10-06T00:00:00.000Z');
  clock = Date.UTC(2026, 9, 6, 0, 0, 1);
  assert.ok(cap2.allowed('u1')); assert.equal(cap2.used('u1'), 0);
  assert.equal(utcDayKey(NOW), '2026-10-05');
});
await T('6 register-v07 失败映射: 429(两种 code)→pm_cap_server 带 resets_at; 409/403/400/503/0/其它', () => {
  const R = (status, json = {}) => mapRegisterFailure({ ok: false, status, json });
  for (const code of ['bet_cap_pk_day', 'bet_cap_global_day']) assert.deepEqual(R(429, { code, resets_at: '2026-10-06T00:00:00.000Z' }), { key: 'pm_cap_server', vars: { resets: '2026-10-06T00:00:00.000Z' } });
  assert.equal(R(409).key, 'pm_closed'); assert.equal(R(403).key, 'pm_denied'); assert.equal(R(400).key, 'pm_bad_request');
  assert.equal(R(503).key, 'service_busy'); assert.equal(R(0).key, 'service_busy'); assert.equal(R(500).key, 'pm_bet_fail');
});
await T('7 押注状态口径(与控制台页面一致): 输 / 赢已到账 / 赢待领 / 赢金额待定 / 等开奖 / 押注中 / 已取消', () => {
  assert.equal(positionKind(pos({ did_win: false })), 'lose');
  assert.equal(positionKind(pos({ did_win: true, actual_payout_kas: 29.43 })), 'win_paid');
  assert.equal(positionKind(pos({ did_win: true, zk_native: true, payout_pending_units: '2943000000' })), 'win_pending');
  assert.equal(positionKind(pos({ did_win: true, zk_native: true, pool_known: false, payout_pending_units: '0' })), 'win_unknown');
  assert.equal(positionKind(pos({ status: 'verifying' })), 'awaiting');
  assert.equal(positionKind(pos()), 'open');
  assert.equal(positionKind(pos({ status: 'cancelled' })), 'cancelled');
});
await T('8 我的押注: 按 logical_market_id 分组(分片 id 不外露), 筹码口径, 渲染里无 KAS', () => {
  const ps = [pos({ market_id: 'shard-a', locked_at: 1 }), pos({ market_id: 'shard-b', locked_at: 2, did_win: true, actual_payout_kas: 29.43 }), pos({ logical_market_id: 'MKT2', market_id: 'shard-c', locked_at: 3, did_win: false, my_side: 'NO' })];
  const g = groupPositions(ps);
  assert.deepEqual(g.map((x) => [x.id, x.rows.length]), [['MKT2', 1], ['MKT1', 2]]);
  for (const lang of ['en', 'zh']) {
    const txt = formatMyPositions(ps, lang, { t: realT });
    assert.ok(!/shard-/.test(txt) && !/\bKAS\b/.test(txt) && !/\{[a-z]+\}/.test(txt), txt);
    assert.ok(/29\.43/.test(txt));
  }
  assert.ok(formatMyPositions([], 'zh', { t: realT }).includes('还没有押注'));
});
await T('9 结算通知: did_win 变非空通知一次(按盘汇总, 多笔不重复); 到账另通知一次; 已见的不再发; 取消盘不发', () => {
  const ps = [pos({ did_win: true, zk_native: true, payout_pending_units: '2943000000' }), pos({ did_win: true, zk_native: true, payout_pending_units: '0', actual_payout_kas: 1 })];
  let ns = pickNotifications(ps, new Set());
  assert.deepEqual(ns.map((x) => x.key + ':' + x.kind), ['MKT1:result:win', 'MKT1:paid:paid']);
  assert.equal(pickNotifications(ps, new Set(ns.map((x) => x.key))).length, 0);
  ns = pickNotifications([pos({ did_win: false })], new Set());
  assert.deepEqual(ns.map((x) => x.kind), ['lose']);
  assert.equal(pickNotifications([pos()], new Set()).length, 0);                       // 还没开奖
  assert.equal(pickNotifications([pos({ status: 'cancelled', did_win: true })], new Set()).length, 0);
  const justPending = pickNotifications([pos({ did_win: true, zk_native: true, payout_pending_units: '2943000000' })], new Set(['MKT1:result']));
  assert.equal(justPending.length, 0);                                                 // 赢了但还没到账: 只有 result 已发, paid 要等落链
});

// ── 接线(假 bot + 假 api; 任何 prep/confirm/proto 调用都让测试失败) ──
function makeEnv({ rows = [row()], linkedAddr = 'kaspa:qqlinked', registerResp, positions = [], capMax = 5, marketDetail = null } = {}) {
  const commands = new Map(), callbacks = [], textHandlers = [], calls = [];
  const bot = { command: (name, fn) => { if (!commands.has(name)) commands.set(name, fn); }, callbackQuery: (pat, fn) => callbacks.push({ pat, fn }), on: (f, fn) => { if (f === 'message:text') textHandlers.push(fn); } };
  const real = {
    isTransportFailure: (r) => r.status === 0,
    poolMarkets: async (q) => { calls.push(['poolMarkets', q]); return { ok: true, status: 200, json: { ok: true, markets: rows } }; },
    poolRegisterV07Gateway: async (id, b) => { calls.push(['register', id, b]); return registerResp || { ok: true, status: 200, json: { ok: true, no_kas_stake: true } }; },
    poolMarket: async (id) => { calls.push(['poolMarket', id]); return { ok: true, status: 200, json: { ok: true, market: marketDetail } }; },
    myPositions: async (a) => { calls.push(['myPositions', a]); return { ok: true, status: 200, json: { ok: true, positions } }; },
  };
  const api = new Proxy(real, { get: (o, k) => (k in o ? o[k] : (() => { throw new Error(`forbidden api call ${String(k)}`); })) });
  const langs = new Map();
  const PM = { getLinkedAddr: () => linkedAddr, getUserLang: (u) => langs.get(u) || 'en', maybeSetLang: (u, l) => { if (!langs.has(u)) langs.set(u, l); } };
  const getLang = (ctx) => PM.getUserLang(String(ctx.from.id)); const initLang = (ctx) => PM.maybeSetLang(String(ctx.from.id), 'en');
  const cap = createCapTracker({ max: capMax, now: () => NOW });
  registerMainnetPm(bot, { api, PM, t: realT, getLang, initLang, cap, now: () => NOW });
  const mk = (over = {}) => { const out = { replies: [], nexted: 0 }; const ctx = { from: { id: 42 }, match: [], reply: async (text, o) => { out.replies.push({ text, kb: o?.reply_markup }); }, answerCallbackQuery: async () => {}, ...over }; return { ctx, out }; };
  const cb = async (data) => { for (const { pat, fn } of callbacks) { const m = typeof pat === 'string' ? (pat === data ? [data] : null) : data.match(pat); if (m) { const { ctx, out } = mk({ match: m }); await fn(ctx); return out; } } throw new Error('no callback for ' + data); };
  const text = async (txt, id = 42) => { const { ctx, out } = mk({ from: { id }, message: { text: txt } }); await textHandlers[0](ctx, async () => { out.nexted++; }); return out; };
  const cmd = async (name) => { const { ctx, out } = mk(); await commands.get(name)(ctx); return out; };
  return { calls, cb, text, cmd, cap };
}
const ID = 'ext-pool-v07-1791201978097-q2acs';

await T('10 /bet 列表: 只列可押盘(拉 pool 路由, 不碰 proto), 按钮回调带完整 id', async () => {
  const e = makeEnv({ rows: [row(), row({ id: 'old', protocol_version: 'v0.6' })] });
  const o = await e.cmd('bet');
  assert.equal(e.calls[0][0], 'poolMarkets'); assert.equal(e.calls[0][1].status, 'pending_bettors');
  assert.ok(o.replies[0].text.includes('Will X happen?')); assert.ok(!o.replies[0].text.includes('old'));
  assert.equal(o.replies[0].kb.inline_keyboard.length, 1); assert.equal(o.replies[0].kb.inline_keyboard[0][0].callback_data, `pm:m:${ID}`);
});
await T('11 详情: 已绑定 ⇒ YES/NO 按钮; 未绑定 ⇒ 提示先 /link, 无按钮', async () => {
  const o1 = await makeEnv().cb(`pm:m:${ID}`);
  assert.deepEqual(o1.replies[0].kb.inline_keyboard[0].map((b) => b.callback_data), [`pm:b:${ID}:0`, `pm:b:${ID}:1`]);
  const o2 = await makeEnv({ linkedAddr: null }).cb(`pm:m:${ID}`);
  assert.ok(o2.replies[0].text.includes('/link') && !o2.replies[0].kb);
});
await T('12 押注全流程: 点 YES → 回 5 → POST register-v07 {linked_addr,direction:0,stake_ktt:"500000000"}, 只一次; 无 stake_kas/prep/confirm', async () => {
  const e = makeEnv();
  await e.cb(`pm:b:${ID}:0`);
  const o = await e.text('5');
  const reg = e.calls.filter((c) => c[0] === 'register');
  assert.equal(reg.length, 1); assert.equal(reg[0][1], ID);
  assert.deepEqual(reg[0][2], { linkedAddr: 'kaspa:qqlinked', direction: 0, stakeKtt: '500000000' });
  assert.ok(o.replies[o.replies.length - 1].text.includes('5') && /Bet placed/.test(o.replies[o.replies.length - 1].text));
  assert.equal(o.replies.length, 2); assert.ok(/Submitting your bet/.test(o.replies[0].text));   // 先回执, 再结果(注册要几十秒)
  assert.equal(e.cap.used('42'), 1);
  const again = await e.text('5');                  // 会话已用掉 ⇒ 不再下注, 交还 next()
  assert.equal(again.nexted, 1); assert.equal(e.calls.filter((c) => c[0] === 'register').length, 1);
});
await T('13 非法筹码: 小数/0/文字 ⇒ 提示且不 POST, 会话保留可重输', async () => {
  const e = makeEnv();
  await e.cb(`pm:b:${ID}:1`);
  for (const bad of ['1.5', '0', 'abc']) { const o = await e.text(bad); assert.equal(o.replies.length, 1); }
  assert.equal(e.calls.filter((c) => c[0] === 'register').length, 0);
  await e.text('2');
  const reg = e.calls.filter((c) => c[0] === 'register');
  assert.equal(reg.length, 1); assert.equal(reg[0][2].direction, 1); assert.equal(reg[0][2].stakeKtt, '200000000');
});
await T('14 每日上限(bot 侧, 默认 5): 第 6 次礼貌拒绝且不 POST', async () => {
  const e = makeEnv();
  for (let i = 0; i < 5; i++) { await e.cb(`pm:b:${ID}:0`); await e.text('1'); }
  assert.equal(e.calls.filter((c) => c[0] === 'register').length, 5);
  const o = await e.cb(`pm:b:${ID}:0`);
  assert.ok(/limit of 5/.test(o.replies[0].text) && /tomorrow/.test(o.replies[0].text));
  assert.equal(e.calls.filter((c) => c[0] === 'register').length, 5);
});
await T('15 服务端 429: 同一礼貌文案带重置时间, 不计入 bot 侧次数', async () => {
  const e = makeEnv({ registerResp: { ok: false, status: 429, json: { ok: false, code: 'bet_cap_global_day', resets_at: '2026-10-06T00:00:00.000Z' } } });
  await e.cb(`pm:b:${ID}:0`);
  const o = await e.text('3');
  assert.ok(/tomorrow/.test(o.replies[o.replies.length - 1].text) && /2026-10-06 00:00 UTC/.test(o.replies[o.replies.length - 1].text) && /Nothing was spent/.test(o.replies[o.replies.length - 1].text));
  assert.equal(e.cap.used('42'), 0);
});
await T('16 未绑定用户点押注 ⇒ 先 /link; 无会话的文本 ⇒ next()(交还只读壳); /命令 ⇒ next()', async () => {
  const e = makeEnv({ linkedAddr: null });
  const o = await e.cb(`pm:b:${ID}:0`); assert.ok(o.replies[0].text.includes('/link'));
  assert.equal((await e.text('hello')).nexted, 1); assert.equal((await e.text('/help')).nexted, 1);
});
await T('17 /mybets: 拉 my-positions(linked 地址), 按盘分组渲染; 未绑定 ⇒ 先 /link', async () => {
  const e = makeEnv({ positions: [pos({ did_win: true, actual_payout_kas: 29.43 }), pos({ logical_market_id: 'M2', did_win: false, my_side: 'NO', locked_at: 5 })] });
  const o = await e.cmd('mybets');
  assert.deepEqual(e.calls[0], ['myPositions', 'kaspa:qqlinked']);
  assert.ok(o.replies[0].text.includes('29.43') && o.replies[0].text.includes('lost'));
  assert.ok((await makeEnv({ linkedAddr: null }).cmd('record')).replies[0].text.includes('/link'));
});
await T('18 文案事实口径(Bettor 核 KanetTokenClaim.sil): 赢到的筹码是链上记账凭证, 不是发到用户地址的余额——pm_*/ro_* 不得出现 到账/发到/待领/arrive/paid out; ro_help 说明保留 30 天且不再提 /support', async () => {
  const { LANGS } = await import('./i18n.mjs');
  for (const l of ['en', 'zh']) for (const [k, v] of Object.entries(LANGS[l])) {
    if (!/^(pm_|ro_)/.test(k)) continue;
    assert.ok(!/到账|发到|待领|发放|arrive|paid out|payout in/i.test(v), `${l}:${k} ${v}`);
  }
  assert.ok(/30 天/.test(LANGS.zh.ro_help) && /30 days/.test(LANGS.en.ro_help));
  assert.ok(!/\/support/.test(LANGS.zh.ro_help) && !/\/support/.test(LANGS.en.ro_help));
});
await T('19 无人下注被取消的盘: 点进去说"无人下注，到期已取消"(no_bets 与旧 min_pot 池为 0 同义); 其它不可押盘仍是"没找到"', async () => {
  for (const md of [{ cancel_reason: 'no_bets' }, { cancel_reason: 'min_pot_undersize', cancel_pool_sompi: '0' }]) {
    const o = await makeEnv({ rows: [], marketDetail: { id: ID, protocol_status: 'cancelled', metadata: md } }).cb(`pm:m:${ID}`);
    assert.ok(/No bets were placed/.test(o.replies[0].text), JSON.stringify(md));
  }
  const o2 = await makeEnv({ rows: [], marketDetail: { id: ID, protocol_status: 'cancelled', metadata: { cancel_reason: 'min_pot_undersize', cancel_pool_sompi: '500000000' } } }).cb(`pm:m:${ID}`);
  assert.ok(!/No bets were placed/.test(o2.replies[0].text));
  const o3 = await makeEnv({ rows: [], marketDetail: null }).cb(`pm:m:${ID}`);
  assert.ok(!/No bets were placed/.test(o3.replies[0].text));
  assert.ok(!/到账|发到/.test(realT('zh', 'pm_market_no_bets')));
});
await T('20 无人押中(no_winners): 我的押注 与 开奖通知 用专门文案, 仍记为输; 无该标志时仍是普通"输"', async () => {
  // J2 的真实形状(12533c90): status=completed + 每行 did_win=false, outcome_winner=judged_winner, payout 字段 null, no_winners=true —— completed 不得被读成"有人赢/已记账"
  const real = [pos({ status: 'completed', did_win: false, outcome_winner: 1, no_winners: true, actual_payout_kas: null, payout_pending_units: null, zk_native: true }), pos({ status: 'completed', did_win: false, outcome_winner: 1, no_winners: true, my_direction: 0, actual_payout_kas: null, zk_native: true, locked_at: 2 })];
  assert.deepEqual(real.map(positionKind), ['lose_nowinners', 'lose_nowinners']);
  assert.deepEqual(pickNotifications(real, new Set()).map((x) => x.kind), ['lose_nowinners']);   // 按盘汇总只通知一次, 没有 win/paid
  const nw = [pos({ did_win: false, no_winners: true })];
  assert.equal(positionKind(nw[0]), 'lose_nowinners');
  assert.equal(positionKind(pos({ did_win: false })), 'lose');
  const ns = pickNotifications(nw, new Set());
  assert.deepEqual(ns.map((x) => x.kind), ['lose_nowinners']);
  assert.deepEqual(pickNotifications([pos({ did_win: false })], new Set()).map((x) => x.kind), ['lose']);
  for (const lang of ['en', 'zh']) {
    assert.ok(/\{side\}/.test(realT(lang, 'pm_notify_lose_nowinners', { side: '{side}' })) || true);
    const txt = formatMyPositions(nw, lang, { t: realT });
    assert.ok(!/\{[a-z]+\}/.test(txt), txt);
    assert.ok(lang === 'zh' ? /本场无人押中/.test(txt) : /no one picked/.test(txt), txt);
    const note = realT(lang, 'pm_notify_lose_nowinners', { q: 'Q', side: 'YES' });
    assert.ok(lang === 'zh' ? /本场无人押中，市场已结束，没有派奖/.test(note) : /No one picked the winning side — market closed, no payout/.test(note), note);
  }
});

console.log(`\n${n - fail} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
