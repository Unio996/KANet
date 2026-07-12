// create-v07-fee-rules.test.mjs — B线深化件2 endpoint-wiring 回归(J2 2026-07-12, Bettor 裁"(a)修端点
// 不降级+缺省路径byte-equal回归" #hkgnxl.2)。覆盖: 缺省 introducer_pk byte-equal 于此前单 brokerPk 调用 /
// 合法 introducer_pk 正确产出双角色 / 坏格式 fail-loud(F2 建单时闸, 非 settle 时才炸)。
// Run: cd kasia-console && node src/lib/create-v07-fee-rules.test.mjs
import { buildFeeRulesForCreateRequest } from './create-v07-fee-rules.mjs';
import { buildPredictionV1InterimRules } from './fee-split.mjs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re ? re.test(e.message) : true; } };

const BROKER = 'a1'.repeat(32);
const INTRO = 'b2'.repeat(32);

console.log('[test] ① 缺省 introducer_pk(undefined/null/空串)byte-equal 于此前单 brokerPk 旧调用:');
{
  const before = buildPredictionV1InterimRules({ brokerPk: BROKER });
  for (const raw of [undefined, null, '']) {
    const after = buildFeeRulesForCreateRequest({ brokerPk: BROKER, introducerPkRaw: raw });
    ok(JSON.stringify(after) === JSON.stringify(before), `introducerPkRaw=${JSON.stringify(raw)} → byte-equal 旧行为(单 broker 4 roles, provider=9840)`);
  }
}

console.log('[test] ② 合法 introducer_pk(大小写混合)→ 正确产出双角色, 与直调 buildPredictionV1InterimRules 一致:');
{
  const mixed = INTRO.slice(0, 32).toUpperCase() + INTRO.slice(32);
  const viaWiring = buildFeeRulesForCreateRequest({ brokerPk: BROKER, introducerPkRaw: mixed });
  const direct = buildPredictionV1InterimRules({ brokerPk: BROKER, introducerPk: mixed });
  ok(JSON.stringify(viaWiring) === JSON.stringify(direct), 'wiring 层与直调组件 byte-equal(非新建平行逻辑)');
  ok(viaWiring.roles.some(r => r.name === 'introducer' && r.address === INTRO.toLowerCase()), 'introducer role 落地, 地址归一小写(与 broker 同规范)');
  ok(viaWiring.roles.find(r => r.name === 'provider').bps === 9820, 'provider=9820(有 introducer 分支)');
}

console.log('[test] ③ 坏格式 introducer_pk → fail-loud(F2 建单时闸, 不产生 settle 时才炸的延迟雷):');
{
  ok(throws(() => buildFeeRulesForCreateRequest({ brokerPk: BROKER, introducerPkRaw: 'not-hex-garbage' }), /64-hex/), '非 hex 串 throw');
  ok(throws(() => buildFeeRulesForCreateRequest({ brokerPk: BROKER, introducerPkRaw: 'aa'.repeat(31) }), /64-hex/), '长度不足 throw(62 char)');
  ok(throws(() => buildFeeRulesForCreateRequest({ brokerPk: BROKER, introducerPkRaw: 'aa'.repeat(33) }), /64-hex/), '长度超出 throw(66 char)');
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — create-v07 introducer_pk 接通: 缺省byte-equal/合法双角色/坏格式fail-loud 全绿'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
