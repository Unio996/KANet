// Self-contained offline test: pool-card-groups.mjs aggregateCardGroups (J2, 2026-06-28, Owner① UX 后端).
//   node kasia-console/scripts/j2-card-groups-test.mjs
//
// 守: 按 card_group_id 聚合 / 同 leg_key dedupe(留活跃高)/ commingled 排除 / 非赛事盘跳过 / trust 字段透传 /
//   kind 从 leg_key 前缀派生 / maker stake 折入隐含赔率 / 卡按聚合活跃度排序 + limit。
// 纯函数测试 — 无 DB 无服务无链 (rows 由 caller SQL 算好, 这里直接喂)。

import { aggregateCardGroups } from '../src/lib/pool-card-groups.mjs';

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FAIL: ' + name); } };
console.log('[j2-card-groups-test]');

const spec = (o) => JSON.stringify(o);
const row = (id, o, extra = {}) => ({
  id, resolution_rule_spec: spec(o), outcome_side: 'YES', deadline: extra.deadline ?? 2000000000,
  maker_stake_amount: extra.maker ?? 0, spine_p2sh: extra.spine ?? ('spine_' + id),
  bettor_count: extra.bettor ?? 0, yes_sompi: extra.yes ?? 0, no_sompi: extra.no ?? 0,
});

// ── 基础: 一个 card_group 三 leg → 一张卡, kind 由 leg_key 前缀派生 ──
const cg = 'espn-FIFA_World_Cup-760487';
const base = { card_group_id: cg, home_team: 'BRA', away_team: 'JPN', event_id: '760487',
  source_label: 'ESPN FIFA', data_source_canonical: 'https://espn/summary?event=760487' };
let rows = [
  row('m_w_bra', { ...base, leg_key: 'winner_BRA', title: 'BRA to win', resolution_criteria: 'crit-w' }, { maker: 1000000000, bettor: 3, yes: 500000000 }),
  row('m_sp', { ...base, leg_key: 'spread_BRA_-1.5', title: 'BRA -1.5', line: '-1.5' }, { maker: 1000000000, bettor: 1 }),
  row('m_to', { ...base, leg_key: 'total_o_2.5', title: 'Over 2.5', line: '2.5' }, { maker: 1000000000 }),
];
let out = aggregateCardGroups(rows, new Set());
check('1a one card group', out.count === 1 && out.card_groups.length === 1);
const c = out.card_groups[0];
check('1b event_title = BRA vs JPN', c.event_title === 'BRA vs JPN');
check('1c leg_count 3', c.leg_count === 3);
check('1d kind 派生 winner/spread/total', c.legs.map(l => l.kind).sort().join(',') === 'spread,total,winner');
check('1e trust 字段透传 (data_source + spine + criteria)',
  c.legs.every(l => l.data_source_canonical === base.data_source_canonical && l.spine_p2sh && l.leg_key));
check('1f winner leg criteria 透传', c.legs.find(l => l.leg_key === 'winner_BRA').resolution_criteria === 'crit-w');
check('1g total_bettor_count = 4 (3+1+0)', c.total_bettor_count === 4);
check('1h legs 按活跃度降序 (winner_BRA 最活跃排首)', c.legs[0].leg_key === 'winner_BRA');
check('1i maker YES 折入 → winner_BRA yes_implied_prob=1', c.legs[0].yes_implied_prob === 1);

// ── dedupe: 同 card_group 同 leg_key 两盘 → 留活跃高那条 ──
rows = [
  row('dup_low', { ...base, leg_key: 'winner_BRA', title: 'low' }, { maker: 100000000, bettor: 0 }),
  row('dup_high', { ...base, leg_key: 'winner_BRA', title: 'high' }, { maker: 100000000, bettor: 9 }),
];
out = aggregateCardGroups(rows, new Set());
check('2a dedupe → 1 leg', out.card_groups[0].leg_count === 1);
check('2b 留活跃高 (dup_high·bettor9)', out.card_groups[0].legs[0].id === 'dup_high');

// ── commingled 排除 ──
rows = [
  row('ok1', { ...base, leg_key: 'winner_BRA' }, { spine: 'clean', maker: 100000000 }),
  row('bad1', { ...base, leg_key: 'winner_JPN' }, { spine: 'COMMINGLED', maker: 100000000 }),
];
out = aggregateCardGroups(rows, new Set(['COMMINGLED']));
check('3a commingled leg 排除', out.card_groups[0].leg_count === 1 && out.card_groups[0].legs[0].leg_key === 'winner_BRA');

// ── 非赛事盘 (无 card_group_id) 跳过 ; 坏 JSON 跳过 ──
rows = [
  row('plain', { title: 'no card group', leg_key: 'x' }, {}),
  { id: 'broken', resolution_rule_spec: '{bad json', outcome_side: 'YES', deadline: 1, maker_stake_amount: 0, spine_p2sh: 's', bettor_count: 0, yes_sompi: 0, no_sompi: 0 },
  row('grp', { ...base, leg_key: 'winner_BRA' }, { maker: 100000000 }),
];
out = aggregateCardGroups(rows, new Set());
check('4a 非赛事盘 + 坏JSON 跳过, 只剩 1 卡 1 leg', out.count === 1 && out.card_groups[0].leg_count === 1);

// ── 多卡按聚合活跃度排序 + limit ──
const cgA = { card_group_id: 'A', home_team: 'AAA', away_team: 'XXX' };
const cgB = { card_group_id: 'B', home_team: 'BBB', away_team: 'YYY' };
rows = [
  row('a1', { ...cgA, leg_key: 'winner_AAA' }, { bettor: 1, maker: 100000000 }),
  row('b1', { ...cgB, leg_key: 'winner_BBB' }, { bettor: 50, maker: 100000000 }),
];
out = aggregateCardGroups(rows, new Set());
check('5a 活跃卡 B 排首', out.card_groups[0].card_group_id === 'B');
out = aggregateCardGroups(rows, new Set(), { limit: 1 });
check('5b limit=1 截断', out.count === 1 && out.card_groups.length === 1);
check('5c limit clamp (0→默认8, 999→cap50): 不抛', aggregateCardGroups(rows, new Set(), { limit: 999 }).ok === true);

console.log(`\n[j2-card-groups-test] ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
