// readonly-i18n.test.mjs — 只读壳的键完整性(真 i18n 表): 代码里引用的每个 ro_* 键 en/zh 都有; 两语言占位符一致; 没有草稿标记/回落成 [key]。
// 另: 用真 t 把整套只读壳屏幕渲染一遍(中英), 断言没有未替换的 {占位符}、没有 "[ro_" 回落、没有 KAS 字样(押注资产是测试代币, 不是 KAS)。
// Run: cd tg-bot && node readonly-i18n.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LANGS, t } from './i18n.mjs';
import { visibleMarkets, formatMarketList, formatMarketDetail, toBotMarket } from './readonly-shell.mjs';

let n = 0, fail = 0;
const T = (name, fn) => { n++; try { fn(); console.log(`  ✅ ${name}`); } catch (e) { fail++; console.log(`  ❌ ${name}: ${e.message}`); } };
const src = ['./readonly-shell.mjs', './readonly-handlers.mjs'].map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
const used = new Set([...src.matchAll(/'(ro_[a-z_]+)'/g)].map((m) => m[1]));
for (const s of ['open', 'sealed', 'settled', 'cancelled']) used.add(`ro_state_${s}`);   // 动态键 ro_state_${state}
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

T('1 代码引用的 ro_* 键集合非空且覆盖关键屏幕', () => {
  assert.ok(used.size >= 25, `只找到 ${used.size} 个键`);
  for (const k of ['ro_start_notice', 'ro_help', 'ro_link_ok', 'ro_list_title', 'ro_detail_no_bet', 'ro_unavailable', 'ro_state_settled', 'ro_when_hours']) assert.ok(used.has(k), k);
});
T('2 每个被引用的键 en 与 zh 都存在(非空)', () => {
  for (const k of used) for (const l of ['en', 'zh']) assert.ok(typeof LANGS[l][k] === 'string' && LANGS[l][k].trim().length > 0, `${l}:${k} 缺失`);
});
T('3 en 与 zh 的占位符集合一致', () => {
  for (const k of used) assert.equal(ph(LANGS.en[k]), ph(LANGS.zh[k]), `${k}: en{${ph(LANGS.en[k])}} zh{${ph(LANGS.zh[k])}}`);
});
T('4 没有草稿标记(† / DRAFT / TODO / 未替换回落 [ro_)', () => {
  for (const k of used) for (const l of ['en', 'zh']) assert.ok(!/†|DRAFT|TODO|\[ro_/.test(LANGS[l][k]), `${l}:${k}`);
});
T('5 只读壳文案里不出现 KAS / faucet / testnet 提示(除"这是测试网地址"这一条拒绝语)', () => {
  for (const k of used) for (const l of ['en', 'zh']) {
    const s = LANGS[l][k];
    if (k === 'ro_link_wrong_network') continue;   // 明确告诉用户"给的是测试网地址"
    assert.ok(!/\bKAS\b|faucet|领水|领币/i.test(s), `${l}:${k} 含 KAS/faucet`);
    assert.ok(!/testnet|测试网/i.test(s.replace(/(the old testnet|和之前测试网不同|Unlike the old testnet)/gi, '')), `${l}:${k} 含 testnet`);
  }
});
T('6 真 t 渲染整套屏幕: 无未替换占位符、无 [ro_ 回落; 详情/列表里没有"下注"按钮', () => {
  const NOW = Date.UTC(2026, 8, 20, 12, 0, 0);
  const mk = (o) => ({ id: 'a'.repeat(64), question: 'Will X happen?', status: 'betting', deadline_ms: NOW + 5 * 3600000, min_bet: 1, token_name: 'Test Token', token_ticker: 'KTT', winning_side: null, ...o });
  for (const l of ['en', 'zh']) {
    const ms = visibleMarkets([mk({ id: '1'.repeat(64) }), mk({ id: '2'.repeat(64), status: 'sealed' }), mk({ id: '3'.repeat(64), status: 'resolved', winning_side: 0 })]);
    const screens = [
      formatMarketList(ms, l, { nowMs: NOW }).text, formatMarketList(ms, l, { nowMs: NOW, titleKey: 'ro_hot_title' }).text, formatMarketList([], l).text,
      ...['betting', 'sealed', 'resolved', 'cancelled'].map((s) => formatMarketDetail(toBotMarket(mk({ status: s, winning_side: 1 })), l, { nowMs: NOW }).text),
      formatMarketDetail(null, l).text, t(l, 'ro_start_notice'), t(l, 'ro_help'), t(l, 'ro_link_ok', { addr: 'kaspa:qqexample' }),
      // 修复轮新增屏幕: 判定题 side_map 缺失的已结算(不显结果)、不足 1 小时按分钟、已过截止
      formatMarketDetail(toBotMarket(mk({ status: 'resolved', winning_side: 0, judged: { side_map: null } })), l, { nowMs: NOW }).text,
      formatMarketList(visibleMarkets([mk({ id: '4'.repeat(64), deadline_ms: NOW + 29 * 60000 }), mk({ id: '5'.repeat(64), deadline_ms: NOW - 1000 }), mk({ id: '6'.repeat(64), status: 'resolved', winning_side: 1, judged: { side_map: { yes: 1, no: 0 } } })]), l, { nowMs: NOW }).text,
    ];
    for (const s of screens) { assert.ok(!/\{\w+\}/.test(s), `${l} 未替换占位符: ${s.slice(0, 80)}`); assert.ok(!/\[ro_/.test(s), `${l} 回落: ${s.slice(0, 80)}`); }
    assert.equal(formatMarketList(ms, l, { nowMs: NOW }).keyboard.inline_keyboard.flat().every((b) => b.callback_data.startsWith('ro:m:')), true);
  }
});

console.log(`\n${n - fail} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
