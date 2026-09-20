// readonly-shell.test.mjs — 只读壳纯函数测试(零链零 DB 零网络; 假 t 只断言"用了哪个键+变量", 不依赖最终措辞)。Run: cd tg-bot && node readonly-shell.test.mjs
import assert from 'node:assert/strict';
import { isReadonlyShell, protoStateOf, resultLabel, toBotMarket, visibleMarkets, marketLine, formatMarketList, formatMarketDetail, findByIdPrefix, classifyLinkInput, linkRejectKey, truncate, pruneStateForMainnet, QUESTION_MAX_DETAIL } from './readonly-shell.mjs';

let n = 0, fail = 0;
const T = (name, fn) => { n++; try { fn(); console.log(`  ✅ ${name}`); } catch (e) { fail++; console.log(`  ❌ ${name}: ${e.message}`); } };
const t = (_lang, key, vars = {}) => `${key}|${JSON.stringify(vars)}`;   // 假 t: 键 + 变量
const NOW = Date.UTC(2026, 8, 20, 12, 0, 0);
const HEX = (c) => c.repeat(64);
const row = (o = {}) => ({ id: HEX('a'), question: 'Will X happen?', status: 'betting', deadline_ms: NOW + 5 * 3600000, min_bet: 1, token_name: 'Test Token', token_ticker: 'KTT', winning_side: null,
  committee_pubkeys_json: '["pk"]', rootclose_txid: 'tx1', shardleaf_txid: 'tx2', payout_root: 'root', created_at: 'c', updated_at: 'u', seal_count: 2, ...o });

T('1 isReadonlyShell: 仅 mainnet 为真(TN12 旧行为原样保留)', () => {
  assert.equal(isReadonlyShell({ network: 'mainnet' }), true);
  for (const v of ['testnet-12', 'simnet', '', undefined, 'mainnet-2', 'Mainnet']) assert.equal(isReadonlyShell({ network: v }), false, String(v));
  assert.equal(isReadonlyShell(null), false); assert.equal(isReadonlyShell(undefined), false);
});

T('2 protoStateOf: 四态映射; genesis_*/未知/空 一律 hidden(内部态不展示)', () => {
  assert.equal(protoStateOf('betting'), 'open'); assert.equal(protoStateOf('sealed'), 'sealed');
  assert.equal(protoStateOf('resolved'), 'settled'); assert.equal(protoStateOf('cancelled'), 'cancelled');
  for (const s of ['genesis_pending', 'genesis_prepared', 'genesis_submitted', 'genesis_ambiguous', 'weird', '', null, undefined]) assert.equal(protoStateOf(s), 'hidden', String(s));
});

T('3 resultLabel: 0=YES / 1=NO(不是 pool 的 1/2); 其它 ⇒ null 不猜', () => {
  assert.equal(resultLabel(0), 'YES'); assert.equal(resultLabel(1), 'NO');
  for (const v of [2, '0', '1', null, undefined, -1, NaN, true]) assert.equal(resultLabel(v), null, String(v));
});

T('4 toBotMarket 白名单: 输出键恰为白名单, 公钥/txid/payout_root 等一个都不带', () => {
  const m = toBotMarket(row());
  assert.deepEqual(Object.keys(m).sort(), ['deadlineSec', 'id', 'minBet', 'question', 'result', 'state', 'tokenName', 'tokenTicker']);
  const blob = JSON.stringify(m);
  for (const leak of ['committee', 'pk"', 'tx1', 'tx2', 'root', 'rootclose', 'shardleaf', 'payout']) assert.ok(!blob.includes(leak), `泄漏 ${leak}`);
});

T('5 toBotMarket 单位: deadline_ms(毫秒)→ deadlineSec(秒); 不是把毫秒当秒', () => {
  const m = toBotMarket(row({ deadline_ms: 1_800_000_000_000 }));
  assert.equal(m.deadlineSec, 1_800_000_000);
  for (const bad of [0, -5, 'abc', null, undefined]) assert.equal(toBotMarket(row({ deadline_ms: bad })).deadlineSec, null, String(bad));
});

T('6 toBotMarket: result 只在 settled 时有; 非 settled 即使 winning_side 有值也为 null', () => {
  assert.equal(toBotMarket(row({ status: 'resolved', winning_side: 0 })).result, 'YES');
  assert.equal(toBotMarket(row({ status: 'resolved', winning_side: 1 })).result, 'NO');
  assert.equal(toBotMarket(row({ status: 'resolved', winning_side: null })).result, null);
  assert.equal(toBotMarket(row({ status: 'sealed', winning_side: 1 })).result, null);
  assert.equal(toBotMarket(row({ status: 'betting', winning_side: 0 })).result, null);
});

T('7 toBotMarket: 题干去 URL/控制符/多余空白; id 缺失/非字符串 ⇒ null; min_bet 非数 ⇒ null', () => {
  assert.equal(toBotMarket(row({ question: '  A\nB  http://127.0.0.1:1/x?y=1 C\t' })).question, 'A B C');
  for (const bad of [null, undefined, 'x', 5, {}, { id: '' }, { id: 5 }]) assert.equal(toBotMarket(bad), null, JSON.stringify(bad));
  assert.equal(toBotMarket(row({ min_bet: 'abc' })).minBet, null);
  assert.equal(toBotMarket(row({ min_bet: 3 })).minBet, 3);
});

T('8 visibleMarkets: cancelled 与 genesis_* 不进列表; 进行中→已封盘→已结算; 进行中按截止近→远; limit 生效', () => {
  const rows = [
    row({ id: HEX('1'), status: 'resolved', winning_side: 0 }),
    row({ id: HEX('2'), status: 'cancelled' }),
    row({ id: HEX('3'), status: 'betting', deadline_ms: NOW + 9 * 3600000 }),
    row({ id: HEX('4'), status: 'genesis_submitted' }),
    row({ id: HEX('5'), status: 'sealed' }),
    row({ id: HEX('6'), status: 'betting', deadline_ms: NOW + 2 * 3600000 }),
  ];
  const v = visibleMarkets(rows, { limit: 10 });
  assert.deepEqual(v.map((m) => m.id[0]), ['6', '3', '5', '1']);
  assert.equal(visibleMarkets(rows, { limit: 2 }).length, 2);
  assert.deepEqual(visibleMarkets(null), []); assert.deepEqual(visibleMarkets(undefined), []); assert.deepEqual(visibleMarkets('x'), []);
  assert.deepEqual(visibleMarkets([row({ status: 'cancelled' })]), []);
});

T('9 marketLine: 进行中用既有 ro_when_hours(h=5, 不是几万小时); 过期用 ro_when_expired; sealed/settled 用各自键', () => {
  const open = toBotMarket(row({ deadline_ms: NOW + 5 * 3600000 }));
  const dl = marketLine(open, 'zh', { t, nowMs: NOW });
  assert.ok(dl.startsWith('ro_line_open|') && dl.includes('ro_when_hours') && /h\\?":5\b/.test(dl) && !/h\\?":\d{3,}/.test(dl), dl);
  const exp = marketLine(toBotMarket(row({ deadline_ms: NOW - 3600000 })), 'zh', { t, nowMs: NOW });
  assert.ok(exp.includes('ro_when_expired'), exp);
  assert.ok(marketLine(toBotMarket(row({ status: 'sealed' })), 'en', { t, nowMs: NOW }).startsWith('ro_line_sealed|'));
  const st = marketLine(toBotMarket(row({ status: 'resolved', winning_side: 1 })), 'en', { t, nowMs: NOW });
  assert.ok(st.startsWith('ro_line_settled|') && st.includes('"result":"NO"'), st);
});

T('10 formatMarketList: 空 ⇒ ro_list_empty 无键盘; 非空 ⇒ 编号行 + 详情按钮, callback 只带 id 前 16 位且 ≤64 字节; 任何按钮都不是下注', () => {
  const e = formatMarketList([], 'zh', { t }); assert.equal(e.keyboard, null); assert.ok(e.text.startsWith('ro_list_empty'));
  const ms = visibleMarkets([row({ id: HEX('a') }), row({ id: HEX('b'), status: 'sealed' })]);
  const r = formatMarketList(ms, 'zh', { t, nowMs: NOW });
  assert.ok(r.text.includes('1. ro_line_open') && r.text.includes('2. ro_line_sealed') && r.text.includes('ro_list_footer'), r.text);
  assert.equal(r.keyboard.inline_keyboard.length, 2);
  for (const [b] of r.keyboard.inline_keyboard) {
    assert.match(b.callback_data, /^ro:m:[0-9a-f]{16}$/); assert.ok(Buffer.byteLength(b.callback_data) <= 64);
    assert.ok(!/bet:|side|stake|pay/i.test(b.callback_data));
  }
});

T('11 formatMarketDetail: 无键盘、含"暂不能下注"键; 未找到 ⇒ ro_detail_not_found; settled 带 result; 代币简称优先于全名', () => {
  const d = formatMarketDetail(toBotMarket(row({ status: 'resolved', winning_side: 0 })), 'en', { t, nowMs: NOW });
  assert.equal(d.keyboard, null);
  assert.ok(d.text.includes('ro_detail_no_bet') && d.text.includes('ro_state_settled|{"result":"YES"}') && d.text.includes('"ticker":"KTT"'), d.text);
  assert.ok(!d.text.includes('ro_detail_deadline'), '非进行中不显示截止行');
  const o = formatMarketDetail(toBotMarket(row()), 'en', { t, nowMs: NOW });
  assert.ok(o.text.includes('ro_state_open') && o.text.includes('ro_detail_deadline'), o.text);
  assert.ok(formatMarketDetail(null, 'en', { t }).text.startsWith('ro_detail_not_found'));
  const noTicker = formatMarketDetail(toBotMarket(row({ token_ticker: '' })), 'en', { t, nowMs: NOW });
  assert.ok(noTicker.text.includes('"ticker":"Test Token"'), noTicker.text);
});

T('12 findByIdPrefix: 唯一命中才返回; 多命中/无命中/太短/非 hex ⇒ null(不猜)', () => {
  const rows = [row({ id: 'ab' + '0'.repeat(62) }), row({ id: 'ab' + '1'.repeat(62) }), row({ id: 'cd' + '2'.repeat(62) })];
  assert.equal(findByIdPrefix(rows, 'cd' + '2'.repeat(14)).id[0], 'c');
  assert.equal(findByIdPrefix(rows, 'ab' + '0'.repeat(14)).id.slice(2, 4), '00');
  assert.equal(findByIdPrefix(rows, 'ab'.repeat(4)), null);   // 前缀 abababab 无命中
  assert.equal(findByIdPrefix([row({ id: 'ab' + '0'.repeat(62) }), row({ id: 'ab' + '0'.repeat(30) + '1'.repeat(32) })], 'ab' + '0'.repeat(14)), null);   // 多命中
  for (const bad of ['', 'abc', 'zz'.repeat(8), null, undefined]) assert.equal(findByIdPrefix(rows, bad), null, String(bad));
  assert.equal(findByIdPrefix(null, 'ab'.repeat(8)), null);
});

T('13 classifyLinkInput(mainnet): kaspa: 通过; kaspatest:/kaspasim: ⇒ wrong_network; 其它 ⇒ usage', () => {
  assert.deepEqual(classifyLinkInput('kaspa:qqabc123', 'mainnet'), { ok: true });
  assert.deepEqual(classifyLinkInput('kaspatest:qqabc123', 'mainnet'), { ok: false, reason: 'wrong_network' });
  assert.deepEqual(classifyLinkInput('kaspasim:qqabc123', 'mainnet'), { ok: false, reason: 'wrong_network' });
  assert.deepEqual(classifyLinkInput('kaspadev:qqabc123', 'mainnet'), { ok: false, reason: 'wrong_network' });
  for (const bad of ['', '  ', 'kaspa:', 'kaspa:QQ', 'KASPA:qq', 'kaspa:qq abc', 'hello', 'bitcoin:abc', 'kaspa', undefined, null, ' kaspa:qq']) assert.deepEqual(classifyLinkInput(bad, 'mainnet'), { ok: false, reason: 'usage' }, JSON.stringify(bad));
});

T('14 classifyLinkInput: 对称(testnet-12 下 kaspatest: 通过、kaspa: 是 wrong_network); 未知网络 fail-closed', () => {
  assert.deepEqual(classifyLinkInput('kaspatest:qqabc', 'testnet-12'), { ok: true });
  assert.deepEqual(classifyLinkInput('kaspa:qqabc', 'testnet-12'), { ok: false, reason: 'wrong_network' });
  for (const net of ['mainnet-2', '', undefined, 'Mainnet']) assert.deepEqual(classifyLinkInput('kaspa:qqabc', net), { ok: false, reason: 'usage' }, String(net));
});

T('15 linkRejectKey: 已知码映射键, 未知码 ⇒ null(走既有 link_fail)', () => {
  assert.equal(linkRejectKey('prefix-mismatch'), 'ro_link_wrong_network'); assert.equal(linkRejectKey('invalid-checksum'), 'ro_link_invalid');
  for (const c of ['empty', 'network-unset', undefined, null, '', 'x']) assert.equal(linkRejectKey(c), null, String(c));
});

T('16 truncate: 超长截断带省略号; 不超长原样(去 URL 后)', () => {
  assert.equal(truncate('abcdef', 4), 'abc…'); assert.equal(truncate('abc', 4), 'abc'); assert.equal(truncate(null, 4), '');
});

T('17 F1 判定题赢家换算: 按 judged.side_map(label→side)——{yes:1,no:0} 时 winning_side=1 是 YES(不能套 0=YES)', () => {
  const smA = { side_map: { yes: 0, no: 1 } }, smB = { side_map: { yes: 1, no: 0 } };
  assert.equal(resultLabel(0, smA), 'YES'); assert.equal(resultLabel(1, smA), 'NO');
  assert.equal(resultLabel(1, smB), 'YES'); assert.equal(resultLabel(0, smB), 'NO');
  assert.equal(toBotMarket(row({ status: 'resolved', winning_side: 1, judged: smB })).result, 'YES');
  assert.equal(toBotMarket(row({ status: 'resolved', winning_side: 1 })).result, 'NO');   // 非判定题维持 0=YES/1=NO
});

T('18 F1 判定题 side_map 缺失/非法 ⇒ 不显 YES/NO(不猜); winning_side 非 0/1 ⇒ null', () => {
  for (const j of [{}, { side_map: null }, { side_map: 'x' }, { side_map: { yes: 0, no: 0 } }, { side_map: { yes: 2, no: 1 } }, { side_map: { yes: 0 } }, { side_map: { yes: '0', no: '1' } }, 'judged', 5]) assert.equal(resultLabel(0, j), null, JSON.stringify(j));
  for (const w of [null, undefined, 2, -1, '0']) assert.equal(resultLabel(w, { side_map: { yes: 0, no: 1 } }), null, String(w));
  const m = toBotMarket(row({ status: 'resolved', winning_side: 0, judged: { side_map: null } }));
  assert.equal(m.result, null);
  assert.ok(marketLine(m, 'en', { t, nowMs: NOW }).startsWith('ro_line_settled_noresult|'));
  const d = formatMarketDetail(m, 'en', { t, nowMs: NOW }); assert.ok(d.text.includes('ro_state_settled_noresult') && !d.text.includes('YES') && !d.text.includes('"NO"'), d.text);
  const m2 = toBotMarket(row({ status: 'resolved', winning_side: null })); assert.ok(marketLine(m2, 'en', { t, nowMs: NOW }).startsWith('ro_line_settled_noresult|'));   // 已结算但 winning_side 缺失(非判定题)同样不显结果
});

// 时钟用例的假 t: 把三个"还剩多久"键换成短记号, 避免嵌套 JSON 转义
const tw = (l, k, v = {}) => (k === 'ro_when_hours' ? `H${v.h}` : k === 'ro_when_minutes' ? `M${v.m}` : k === 'ro_when_expired' ? 'EXP' : t(l, k, v));
const whenAt = (leftMs, over = {}) => { const s = marketLine(toBotMarket(row({ deadline_ms: NOW + leftMs, ...over })), 'zh', { t: tw, nowMs: NOW }); const m = /"when":"([^"]*)"/.exec(s); return m ? m[1] : null; };

T('19 SHOULD#1 时钟: 不足 1 小时按分钟(向上取整, 至少 1); 已到/已过 ⇒ 已过截止; ≥1 小时向上取整', () => {
  assert.equal(whenAt(29 * 60000), 'M29');   // 旧 Math.round 会显"已过截止"
  assert.equal(whenAt(31 * 60000), 'M31'); assert.equal(whenAt(59 * 60000), 'M59'); assert.equal(whenAt(1 * 60000), 'M1'); assert.equal(whenAt(1000), 'M1'); assert.equal(whenAt(59 * 60000 + 1000), 'M60');
  assert.equal(whenAt(3600000), 'H1'); assert.equal(whenAt(61 * 60000), 'H2'); assert.equal(whenAt(89 * 60000), 'H2');   // 旧 Math.round 把 31–89 分都显成"1 小时"
  assert.equal(whenAt(5 * 3600000), 'H5'); assert.equal(whenAt(5 * 3600000 + 1000), 'H6');
  assert.equal(whenAt(0), 'EXP'); assert.equal(whenAt(-1000), 'EXP'); assert.equal(whenAt(-5 * 3600000), 'EXP');
  assert.equal(whenAt(0, { deadline_ms: undefined }), '', '无截止 ⇒ when 为空(不显 ?)');
  const det = formatMarketDetail(toBotMarket(row({ deadline_ms: NOW + 29 * 60000 })), 'en', { t: tw, nowMs: NOW }); assert.ok(det.text.includes('M29') && !det.text.includes('EXP'), det.text);
});

T('20 SHOULD#2 文本: 去双向控制符/零宽字符; 详情题干设上限; 列表仍 56', () => {
  const nasty = 'a‮b‪c⁦d⁩e​f‍g‏h⁠i﻿j';
  assert.equal(toBotMarket(row({ question: nasty })).question, 'abcdefghij');
  assert.equal(truncate('x‮y', 10), 'xy');
  const long = 'q'.repeat(1000);
  const d = formatMarketDetail(toBotMarket(row({ question: long })), 'en', { t, nowMs: NOW });
  const title = d.text.split('\n')[0]; assert.ok(title.length < QUESTION_MAX_DETAIL + 60 && title.includes('…'), `详情标题长度 ${title.length}`);
  assert.equal(QUESTION_MAX_DETAIL, 300);
  assert.ok(marketLine(toBotMarket(row({ question: long })), 'en', { t, nowMs: NOW }).length < 200);
});

T('20b S3·SHOULD cleanText: 整个 Unicode Cf 类(软连字符/阿拉伯格式符/tag 字符)被剥; 被不可见字符切开的 URL 不会拼回活链接', () => {
  assert.equal(truncate('a\u00ADb', 10), 'ab');                  // U+00AD 软连字符(Cf, 不在原显式段内)
  assert.equal(truncate('x\u0600y', 10), 'xy');                  // U+0600 阿拉伯数字符号(Cf)
  assert.equal(truncate('t\u{E0041}z', 10), 'tz');               // U+E0041 tag 字符(Cf, 代理对)
  assert.equal(truncate('a\u180Eb', 10), 'ab');                  // U+180E 蒙古文元音分隔符(Cf)
  assert.equal(truncate('a\uFFF9b', 10), 'ab');                  // U+FFF9 行间注释锚(Cf)
  // 顺序: 先剥不可见再剥 URL —— 否则 "ht<ZWSP>tp://…" 躲过 URL 剥离、ZWSP 被删后拼回 "http://…"
  for (const u of ['ht\u200Btp://evil.example/x', 'ht\u00ADtp://evil.example/x', 'http\u200D://evil.example/x', 'https:/\u2060/evil.example', 'ht\u{E0041}tps://evil.example']) {
    const out = truncate(u, 200);
    assert.ok(!/https?:/i.test(out) && !out.includes('evil.example'), `${JSON.stringify(u)} => ${JSON.stringify(out)}`);
  }
  assert.equal(truncate('see ht\u200Btp://evil.example/x now', 200), 'see now');   // 零宽切开的 URL 与明文 URL 同结果(只剥 URL 本体, 两侧文字保留)
  assert.equal(truncate('see http://evil.example/x now', 200), 'see now');          // 对照臂: 明文 URL 的既有行为不变
  assert.equal(truncate('a b\tc  d', 200), 'a b c d');           // 对照臂: 普通空白折叠不变
  assert.equal(toBotMarket(row({ question: 'q\u00AD?\u200B' })).question, 'q?');
});

T('21 F2 pruneStateForMainnet: 只留 kaspa 前缀绑定; kaspatest/缺地址/畸形条目全丢; sessions 全清; pendingPayments 不动只回报数', () => {
  const st = { linkedAddrs: [['1', { address: 'kaspatest:qqa' }], ['2', { address: 'kaspa:qqb' }], ['3', { address: 'kaspasim:qqc' }], ['4', { address: '' }], ['5', {}], ['6', null], ['7', { address: 5 }], ['8', { address: 'kaspa:qqd' }], null, ['9', { address: 'nokaspa' }]],
    sessions: [['1', {}], ['2', {}], ['3', {}], ['4', {}]], pendingPayments: [['1', { x: 1 }], ['2', { x: 2 }]] };
  const r = pruneStateForMainnet(st, 'kaspa');
  assert.deepEqual(r.linkedAddrs.map((e) => e[0]), ['2', '8']); assert.equal(r.droppedLinks, 8);
  assert.deepEqual(r.sessions, []); assert.equal(r.clearedSessions, 4); assert.equal(r.pendingPayments, 2);
  assert.equal(st.linkedAddrs.length, 10, '不就地修改入参');
  assert.deepEqual(pruneStateForMainnet({}, 'kaspa'), { linkedAddrs: [], sessions: [], droppedLinks: 0, clearedSessions: 0, pendingPayments: 0 });
  assert.deepEqual(pruneStateForMainnet(undefined, 'kaspa').linkedAddrs, []);
  assert.deepEqual(pruneStateForMainnet({ linkedAddrs: [['1', { address: 'kaspatest:qqa' }], ['2', { address: 'kaspa:qqb' }]] }, 'kaspatest').linkedAddrs.map((e) => e[0]), ['1']);   // 判据是前缀相等, 不是写死 kaspa
  assert.equal(pruneStateForMainnet({ linkedAddrs: [['1', { address: 'kaspatest:qq' }]] }, 'kaspa').linkedAddrs.length, 0);   // 整段比较, 不是 startsWith
});

console.log(`\n${n - fail} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
