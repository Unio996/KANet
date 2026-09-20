// readonly-handlers.test.mjs — 只读壳接线测试: 假 bot 收集注册的 handler, 假 ctx 调用, 假 api(Proxy: 任何非白名单的 api 调用都记录并让测试失败)。
// 零网络零 DB; 假 t 只断言键+变量, 不依赖措辞。Run: cd tg-bot && node readonly-handlers.test.mjs
import assert from 'node:assert/strict';
import { registerReadonlyShell, RO_HIDDEN_COMMANDS } from './readonly-handlers.mjs';

let n = 0, fail = 0;
const T = async (name, fn) => { n++; try { await fn(); console.log(`  ✅ ${name}`); } catch (e) { fail++; console.log(`  ❌ ${name}: ${e.message}`); } };
const t = (_l, key, vars = {}) => `${key}|${JSON.stringify(vars)}`;
const NOW = Date.UTC(2026, 8, 20, 12, 0, 0);
const HEX = (c) => c.repeat(64);
const mrow = (o = {}) => ({ id: HEX('a'), question: 'Will X happen?', status: 'betting', deadline_ms: NOW + 5 * 3600000, min_bet: 1, token_name: 'Test Token', token_ticker: 'KTT', winning_side: null, committee_pubkeys_json: '["pk"]', ...o });

function makeEnv({ rows = [], protoResp, linkResp, network = 'mainnet' } = {}) {
  const commands = new Map(); const callbacks = [];
  const bot = { command: (name, fn) => { if (!commands.has(name)) commands.set(name, fn); }, callbackQuery: (pat, fn) => callbacks.push({ pat, fn }) };
  const apiCalls = [];
  const realApi = {
    isTransportFailure: (r) => r.status === 0,
    protoMarkets: async () => { apiCalls.push('protoMarkets'); return protoResp ?? { ok: true, status: 200, json: { ok: true, markets: rows } }; },
    linkBind: async (addr, u) => { apiCalls.push(`linkBind:${addr}:${u}`); return linkResp ?? { ok: true, status: 200, json: { ok: true, linked: true } }; },
  };
  const api = new Proxy(realApi, { get: (o, k) => (k in o ? o[k] : (() => { apiCalls.push(`FORBIDDEN:${String(k)}`); throw new Error(`forbidden api call ${String(k)}`); })) });
  const langs = new Map(); const linkedAddrs = new Map(); const exits = [];
  const PM = {
    getUserLang: (u) => langs.get(u) || 'en', setUserLang: (u, l) => langs.set(u, l), maybeSetLang: (u, l) => { if (!langs.has(u)) langs.set(u, l); },
    setLinkedAddr: (u, a) => linkedAddrs.set(u, a), exitBetFlow: (u) => exits.push(u),
  };
  const linked = new Map();
  const getLang = (ctx) => PM.getUserLang(String(ctx.from.id)); const initLang = (ctx) => PM.maybeSetLang(String(ctx.from.id), ctx.from.language_code === 'zh' ? 'zh' : 'en');
  registerReadonlyShell(bot, { api, PM, CONFIG: { network }, linked, t, getLang, initLang, now: () => NOW });
  const mkCtx = (over = {}) => {
    const out = { replies: [], answered: 0, edits: [] };
    const ctx = { from: { id: 42, language_code: 'en' }, match: '', reply: async (text, opts) => { out.replies.push({ text, opts }); }, answerCallbackQuery: async () => { out.answered++; },
      editMessageText: async (text, opts) => { out.edits.push({ text, opts }); }, ...over };
    return { ctx, out };
  };
  const cb = (data) => { for (const { pat, fn } of callbacks) { const m = typeof pat === 'string' ? (pat === data ? [data] : null) : data.match(pat); if (m) return { fn, m }; } return null; };
  return { commands, callbacks, apiCalls, PM, langs, linkedAddrs, linked, exits, mkCtx, cb };
}
const run = async (env, cmd, matchStr = '') => { const { ctx, out } = env.mkCtx({ match: matchStr }); await env.commands.get(cmd)(ctx); return out; };
const runCb = async (env, data) => { const h = env.cb(data); assert.ok(h, `无 handler 命中回调 ${data}`); const { ctx, out } = env.mkCtx({ match: h.m }); await h.fn(ctx); return out; };

await T('1 注册覆盖: 命令与回调齐全(含全部隐藏入口与残留旧按钮)', () => {
  const e = makeEnv();
  for (const c of ['start', 'help', 'link', 'bet', 'hot', 'mybets', 'record', 'discover', 'champions', ...RO_HIDDEN_COMMANDS]) assert.ok(e.commands.has(c), c);
  for (const need of ['lang:toggle', 'nav:hot', 'nav:mybets', 'nav:faucet', 'ro:m:' + '0123456789abcdef', 'bet:market:xyz', 'bet:side:1', 'bet:side:2', 'mybet:addmore:xyz']) assert.ok(e.cb(need), need);
  // 字面量(不引用被测常量本身, 否则删掉一项测试也跟着变): Owner 已批 /wallet /send /faucet 隐藏(+其从属流程 balance/receive/confirm/cancel, /swap 无兑换), /broker_apply Owner 2026-09-20 定"藏"
  assert.deepEqual([...RO_HIDDEN_COMMANDS].sort(), ['balance', 'broker_apply', 'cancel', 'confirm', 'faucet', 'receive', 'send', 'swap', 'wallet']);
  // 回调形状钉死: ro:m: 后必须恰好 16 位小写 hex(过短/过长/大写都不接管)
  for (const bad of ['ro:m:abcd', 'ro:m:' + 'a'.repeat(15), 'ro:m:' + 'a'.repeat(17), 'ro:m:' + 'A'.repeat(16), 'ro:m:']) assert.equal(e.cb(bad), null, bad);
});

await T('2 /start: 只读说明+命令行+语言按钮; 清残留下注会话; 不调用任何 console api', async () => {
  const e = makeEnv(); const o = await run(e, 'start');
  assert.equal(o.replies.length, 1);
  assert.ok(o.replies[0].text.includes('ro_start_notice') && o.replies[0].text.includes('ro_start_commands'), o.replies[0].text);
  assert.equal(o.replies[0].opts.reply_markup.inline_keyboard[0][0].callback_data, 'lang:toggle');
  assert.deepEqual(e.exits, ['42']); assert.deepEqual(e.apiCalls, []);
});

await T('3 /start <市场id前缀>(深链): 直接详情; 非 hex 的 payload(如 promo)⇒ 走普通 /start 且不调 api', async () => {
  const e = makeEnv({ rows: [mrow({ id: 'ab' + '0'.repeat(62) })] });
  const o = await run(e, 'start', 'ab' + '0'.repeat(10));
  assert.ok(o.replies[0].text.includes('ro_detail_title') && o.replies[0].text.includes('ro_state_open'), o.replies[0].text);
  assert.deepEqual(e.apiCalls, ['protoMarkets']);
  const e2 = makeEnv(); const o2 = await run(e2, 'start', 'promo');
  assert.ok(o2.replies[0].text.includes('ro_start_notice')); assert.deepEqual(e2.apiCalls, []);
});

await T('4 /bet: 列表只含进行中/已封盘/已结算; cancelled 与 genesis_* 不出现; 每行一个详情按钮; 只调 protoMarkets 一次', async () => {
  const rows = [mrow({ id: HEX('1') }), mrow({ id: HEX('2'), status: 'cancelled' }), mrow({ id: HEX('3'), status: 'genesis_pending' }), mrow({ id: HEX('4'), status: 'resolved', winning_side: 1 })];
  const e = makeEnv({ rows }); const o = await run(e, 'bet');
  const r = o.replies[0];
  assert.ok(r.text.includes('1. ro_line_open') && r.text.includes('2. ro_line_settled') && !r.text.includes('3. '), r.text);
  assert.deepEqual(r.opts.reply_markup.inline_keyboard.map(([b]) => b.callback_data), ['ro:m:' + '1'.repeat(16), 'ro:m:' + '4'.repeat(16)]);
  assert.deepEqual(e.apiCalls, ['protoMarkets']);
});

await T('5 /bet 三种失败态: 传输失败⇒service_busy; 服务端非 ok⇒hot_fail; 空⇒ro_list_empty(不是失败文案)', async () => {
  const busy = await run(makeEnv({ protoResp: { ok: false, status: 0, json: { error: 'x' } } }), 'bet'); assert.ok(busy.replies[0].text.startsWith('service_busy'));
  const bad = await run(makeEnv({ protoResp: { ok: false, status: 500, json: {} } }), 'bet'); assert.ok(bad.replies[0].text.startsWith('hot_fail'));
  const bad2 = await run(makeEnv({ protoResp: { ok: true, status: 200, json: { ok: false } } }), 'bet'); assert.ok(bad2.replies[0].text.startsWith('hot_fail'));
  const empty = await run(makeEnv({ rows: [] }), 'bet'); assert.ok(empty.replies[0].text.startsWith('ro_list_empty') && !empty.replies[0].opts);
});

await T('6 /hot: 最多 5 条、标题键 ro_hot_title; nav:hot 回调同样', async () => {
  const rows = Array.from({ length: 7 }, (_, i) => mrow({ id: String(i + 1).repeat(64) }));
  const e = makeEnv({ rows }); const o = await run(e, 'hot');
  assert.equal(o.replies[0].opts.reply_markup.inline_keyboard.length, 5); assert.ok(o.replies[0].text.startsWith('ro_hot_title|{"n":5}'), o.replies[0].text);
  const o2 = await runCb(e, 'nav:hot'); assert.equal(o2.answered, 1); assert.equal(o2.replies[0].opts.reply_markup.inline_keyboard.length, 5);
});

await T('7 详情回调 ro:m:<16 位>: 命中⇒详情(无键盘); 未知/多命中/隐藏态(genesis)⇒ ro_detail_not_found', async () => {
  const rows = [mrow({ id: 'ab' + '0'.repeat(62) }), mrow({ id: 'cd' + '1'.repeat(62), status: 'genesis_submitted' }), mrow({ id: 'ef' + '2'.repeat(30) + '3'.repeat(32) }), mrow({ id: 'ef' + '2'.repeat(30) + '4'.repeat(32) })];
  const e = makeEnv({ rows });
  const hit = await runCb(e, 'ro:m:' + 'ab' + '0'.repeat(14)); assert.ok(hit.replies[0].text.includes('ro_detail_title') && !hit.replies[0].opts, hit.replies[0].text); assert.equal(hit.answered, 1);
  for (const p of ['0'.repeat(16), 'cd' + '1'.repeat(14), 'ef' + '2'.repeat(14)]) { const o = await runCb(e, 'ro:m:' + p); assert.ok(o.replies[0].text.startsWith('ro_detail_not_found'), `${p}: ${o.replies[0].text}`); }
});

await T('8 /link 主网地址: 调 linkBind 一次, 成功后持久化+回 ro_link_ok', async () => {
  const e = makeEnv(); const o = await run(e, 'link', 'kaspa:qqabc123');
  assert.deepEqual(e.apiCalls, ['linkBind:kaspa:qqabc123:42']); assert.ok(o.replies[0].text.startsWith('ro_link_ok|'));
  assert.equal(e.linkedAddrs.get('42'), 'kaspa:qqabc123'); assert.equal(e.linked.get('42').address, 'kaspa:qqabc123');
});

await T('9 /link 前置拒绝(不调 api、不持久化): kaspatest:⇒wrong_network; 乱写/空⇒usage', async () => {
  for (const [input, key] of [['kaspatest:qqabc123', 'ro_link_wrong_network'], ['kaspasim:qqabc', 'ro_link_wrong_network'], ['hello', 'ro_link_usage'], ['', 'ro_link_usage'], ['kaspa:', 'ro_link_usage']]) {
    const e = makeEnv(); const o = await run(e, 'link', input);
    assert.ok(o.replies[0].text.startsWith(key), `${input}: ${o.replies[0].text}`); assert.deepEqual(e.apiCalls, [], input); assert.equal(e.linkedAddrs.size, 0);
  }
});

await T('10 /link console 拒绝码映射: prefix-mismatch/invalid-checksum 各自键; 其它错误走既有 link_fail; 传输失败⇒service_busy; 一律不持久化', async () => {
  for (const [resp, key] of [
    [{ ok: false, status: 400, json: { ok: false, code: 'prefix-mismatch' } }, 'ro_link_wrong_network'],
    [{ ok: false, status: 400, json: { ok: false, code: 'invalid-checksum' } }, 'ro_link_invalid'],
    [{ ok: false, status: 503, json: { ok: false, code: 'network-unset', error: 'network not configured' } }, 'link_fail'],
    [{ ok: false, status: 401, json: { error: 'unauthorized' } }, 'link_fail'],
    [{ ok: false, status: 0, json: { error: 'timeout' } }, 'service_busy'],
    [{ ok: true, status: 200, json: { ok: true, linked: false } }, 'link_fail'],
  ]) {
    const e = makeEnv({ linkResp: resp }); const o = await run(e, 'link', 'kaspa:qqabc123');
    assert.ok(o.replies[0].text.startsWith(key), `${JSON.stringify(resp)}: ${o.replies[0].text}`); assert.equal(e.linkedAddrs.size, 0); assert.equal(e.linked.size, 0);
  }
});

await T('11 隐藏入口: /wallet /balance /receive /send /confirm /cancel /faucet /swap /broker_apply 都回 ro_unavailable、零 api 调用', async () => {
  for (const c of RO_HIDDEN_COMMANDS) { const e = makeEnv(); const o = await run(e, c, 'whatever'); assert.ok(o.replies[0].text.startsWith('ro_unavailable'), c); assert.deepEqual(e.apiCalls, [], c); }
});

await T('12 残留旧按钮(bet:market: / bet:side: / mybet:addmore: / nav:faucet)只回 ro_unavailable、零 api 调用、不进旧下注流程', async () => {
  for (const data of ['bet:market:abc', 'bet:side:1', 'bet:side:2', 'mybet:addmore:abc', 'nav:faucet']) { const e = makeEnv(); const o = await runCb(e, data); assert.equal(o.answered, 1, data); assert.ok(o.replies[0].text.startsWith('ro_unavailable'), data); assert.deepEqual(e.apiCalls, [], data); }
});

await T('13 /mybets /record /nav:mybets ⇒ ro_mybets_unavailable(无数据可读, 不调 pool 接口); /discover /champions ⇒ 各自键', async () => {
  for (const c of ['mybets', 'record']) { const e = makeEnv(); const o = await run(e, c); assert.ok(o.replies[0].text.startsWith('ro_mybets_unavailable'), c); assert.deepEqual(e.apiCalls, []); }
  const e = makeEnv(); const o = await runCb(e, 'nav:mybets'); assert.ok(o.replies[0].text.startsWith('ro_mybets_unavailable')); assert.equal(o.answered, 1);
  assert.ok((await run(makeEnv(), 'discover')).replies[0].text.startsWith('ro_discover')); assert.ok((await run(makeEnv(), 'champions')).replies[0].text.startsWith('ro_champions_ended'));
  assert.ok((await run(makeEnv(), 'help')).replies[0].text.startsWith('ro_help'));
});

await T('14 lang:toggle: 切语言并 editMessageText 出新语言的只读 /start 文本; editMessageText 抛错被吞', async () => {
  const e = makeEnv(); const h = e.cb('lang:toggle'); const { ctx, out } = e.mkCtx(); await h.fn(ctx);
  assert.equal(e.langs.get('42'), 'zh'); assert.equal(out.answered, 1); assert.ok(out.edits[0].text.includes('ro_start_notice'));
  const { ctx: c2 } = e.mkCtx({ editMessageText: async () => { throw new Error('message is not modified'); } }); await h.fn(c2);   // 不抛
  assert.equal(e.langs.get('42'), 'en'); assert.deepEqual(e.apiCalls, []);
});

await T('15 全局: 整个测试期间 api 只被调过 protoMarkets / linkBind, 没有任何 FORBIDDEN(下注/钱包/faucet/broker/pool 等)调用', () => {
  // 每个用例用独立 env, 这里对代表性全流程再跑一遍并汇总
  return (async () => {
    const e = makeEnv({ rows: [mrow()] });
    for (const c of ['start', 'help', 'bet', 'hot', 'mybets', 'record', 'discover', 'champions', ...RO_HIDDEN_COMMANDS]) await run(e, c);
    await run(e, 'link', 'kaspa:qqabc123');
    for (const d of ['nav:hot', 'nav:mybets', 'nav:faucet', 'bet:market:x', 'ro:m:' + 'a'.repeat(16)]) await runCb(e, d);
    assert.ok(e.apiCalls.every((c) => c === 'protoMarkets' || c.startsWith('linkBind:')), JSON.stringify(e.apiCalls));
    assert.ok(!e.apiCalls.some((c) => c.startsWith('FORBIDDEN')));
    assert.equal(e.apiCalls.filter((c) => c.startsWith('linkBind:')).length, 1);
  })();
});

console.log(`\n${n - fail} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
