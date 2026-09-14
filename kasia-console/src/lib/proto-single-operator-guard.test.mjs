// proto-single-operator-guard.test.mjs — PROTO_SINGLE_OPERATOR 基础设施回归(J2 2026-09-14,
// Bettor 复核裁定, 与 market_genesis 同笔纳入实现计划)。纯函数, 无 DB 依赖, 不需要 migration
// 隔离库 bootstrap(同 proto-relay-guard.test.mjs 的 rejectRelayIdInBody 部分手法, 但那部分
// 混在需要 DB 的文件里; 本文件整体都不碰 DB, 直接跑)。
// Run: cd kasia-console && node src/lib/proto-single-operator-guard.test.mjs

import { rejectExternalMarketIdentityInBody } from './proto-single-operator-guard.mjs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };

console.log('[test] rejectExternalMarketIdentityInBody:');

ok(rejectExternalMarketIdentityInBody({ direction: 0, amount: 100 }) === null, '正常请求体(无禁用字段) ⇒ 放行(null)');
ok(rejectExternalMarketIdentityInBody(undefined) === null, 'body 为 undefined ⇒ 放行(不 throw)');
ok(rejectExternalMarketIdentityInBody(null) === null, 'body 为 null ⇒ 放行(不 throw)');
ok(rejectExternalMarketIdentityInBody({}) === null, '空对象 ⇒ 放行');

for (const field of ['covenant_id', 'market_covenant_id', 'shardleaf_txid', 'shardleaf_vout', 'bettor_pk', 'bettor_pubkey', 'bettor_privkey']) {
  const r = rejectExternalMarketIdentityInBody({ [field]: 'x' });
  ok(typeof r === 'string' && r.includes(field), `请求体含 ${field} ⇒ 拒绝且错误信息点名该字段(实际: ${JSON.stringify(r)})`);
}

// 值为 falsy(0/''/null)但字段本身存在(hasOwnProperty) ⇒ 仍应拒绝——用 `body.covenant_id` 真值判断
// 会漏掉 `{covenant_id: ''}` 这种"字段存在但值是假值"的绕过尝试, 必须用 hasOwnProperty 语义。
ok(rejectExternalMarketIdentityInBody({ bettor_pk: '' }) !== null, '字段存在但值为空字符串 ⇒ 仍拒绝(hasOwnProperty 语义, 不是真值判断)');
ok(rejectExternalMarketIdentityInBody({ bettor_pk: null }) !== null, '字段存在但值为 null ⇒ 仍拒绝');

// 一次只命中一个禁用字段的错误信息里不应该意外提到其它禁用字段名(简单起见只断言不为 null 且只含
// 触发字段名, 不逐一排除其余 6 个字段名, 因为函数实现本就是遇到第一个命中就返回, 不会拼接多个)。
{
  const r = rejectExternalMarketIdentityInBody({ covenant_id: 'x', direction: 0 });
  ok(r !== null && r.includes('covenant_id'), '混合正常字段(direction)与禁用字段(covenant_id) ⇒ 仍拒绝');
}

console.log(fails === 0 ? '\n✅✅ ALL PASS' : `\n❌ ${fails} assertions failed`);
process.exitCode = fails === 0 ? 0 : 1;
