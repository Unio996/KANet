// fee-split.test.mjs — B线落1 组件验收(J2 2026-07-12, spec docs/2026-06-22-modular-fee-split-component-spec.md v1.3)。
// 守两条铁律: ①替代非新增——prediction 预设 == 既有 deriveFeeLeaves 逐字搬迁 byte-equal(spec §4/§5-4);
// ②V2 单源函数替换后 1dv70 真实链值回放不动(fee-single-source.test.mjs 另跑, 此处补组件视角断言)。
import {
  feeSplit, deriveRoleFeeLeaves, validateFeeRules, canonicalizeFeeRules, computeFeeRulesCommit,
  FEE_PRESETS, FEE_RULES_SCHEMA_V, PROVIDER_MIN_BPS,
} from './fee-split.mjs';
import { deriveFeeLeaves, deriveSettlementFeeLeaves, computePariMutuelPayout, FEE_CONFIG, canonicalPredicate } from './pool-shard-settle.mjs';

let fails = 0;
const ok = (cond, label) => { if (cond) console.log(`  ✅ ${label}`); else { console.error(`  ❌ ${label}`); fails++; } };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re ? re.test(e.message) || re.test(e.code || '') : true; } };

// ── 真实历史输入: 1dv70(5R-2, 2026-07-09 真实链上市场)——同 fee-single-source.test.mjs 单源数据 ──
const MARKET_1DV70 = { brokerPk: '27858b2f224f025d8b06d7ac1c562bab5d8f91052b49a3ae75328d353c0fc954', brokerFeePctBps: 190 };
const POOL_1DV70 = '320000000';
const EXPECT_FEE_1DV70 = '6080000';   // 真实 claim2 落链值
const WINNERS_1DV70 = [{ pk: 'ff18f539190b58077a6bbb5c7d469a506e434dfdcf793fedd375880a46845b0b', stake: '150000000' }];   // direction 0 真实赢家

const BROKER_PK = 'a'.repeat(64);
const INTRO_PK = 'b'.repeat(64);
const COMMITTEE = ['c'.repeat(64), 'd'.repeat(64), 'e'.repeat(64), 'f'.repeat(64), '0'.repeat(63) + '1'];

const predictionRulesWithAddrs = () => ({
  schema_v: FEE_RULES_SCHEMA_V,
  preset: 'prediction',
  roles: [
    { name: 'provider', bps: 9700 },
    { name: 'broker', bps: 160, address: BROKER_PK },
    { name: 'introducer', bps: 20, optional: true, address: INTRO_PK },
    { name: 'oracle', bps: 100, derive: 'committee' },
    { name: 'node', bps: 20, derive: 'committee' },
  ],
});

console.log('[test] ① validateFeeRules 硬不变量(spec §2 防恶意配置):');
{
  ok(validateFeeRules(predictionRulesWithAddrs()) === true, '合法 prediction 规则通过');
  ok(throws(() => validateFeeRules(FEE_PRESETS.prediction), /缺 address/), 'FEE_PRESETS.prediction 是模板——broker 未注地址不得直接上链(建单必须注入, 防拿模板当成品)');
  ok(throws(() => validateFeeRules({ ...predictionRulesWithAddrs(), roles: [{ name: 'provider', bps: 9700 }, { name: 'broker', bps: 200, address: BROKER_PK }] }), /Σbps.*!= 10000/), 'Σbps≠10000 拒');
  ok(throws(() => validateFeeRules({ schema_v: 1, roles: [{ name: 'provider', bps: 4000 }, { name: 'broker', bps: 6000, address: BROKER_PK }] }), /PROVIDER_MIN_BPS|ROLE_MAX_BPS/), `provider<${PROVIDER_MIN_BPS} 或 role 超上限 拒(facilitator 抢光防线)`);
  ok(throws(() => validateFeeRules({ schema_v: 1, roles: [{ name: 'provider', bps: 5000 }, { name: 'x', bps: 2500, address: BROKER_PK }, { name: 'x', bps: 2500, address: INTRO_PK }] }), /重复/), 'role name 重复 拒');
  ok(throws(() => validateFeeRules({ schema_v: 1, roles: [{ name: 'provider', bps: 9000 }, { name: 'broker', bps: 1000 }] }), /缺 address/), '非 optional 地址角色缺 address 拒');
  ok(throws(() => validateFeeRules({ schema_v: 1, roles: [{ name: 'provider', bps: 9000 }, { name: 'oracle', bps: 1000, derive: 'committee', address: BROKER_PK }] }), /禁 caller 供 address/), 'derive 角色带 caller 地址 拒(命门④)');
  ok(throws(() => validateFeeRules({ ...predictionRulesWithAddrs(), schema_v: 99 }), /FEE_RULES_SCHEMA_V_UNSUPPORTED/), 'schema_v 不支持 → 可辨识 err.code(spec v1.2-3, 非静默算错)');
  // F1(NWT 落1 红队 CONFIRMED repro): 未知键静默丢弃 → 两份语义不同的 feeRules 同 commit。白名单后必拒。
  const evilTop = { ...predictionRulesWithAddrs(), settlement_mode: 'evil-top-level' };
  ok(throws(() => validateFeeRules(evilTop), /未知顶层键/), 'F1: 未知顶层键(settlement_mode) 拒——canonicalize 剥除面封死');
  const evilRole = predictionRulesWithAddrs();
  evilRole.roles[1].refund_policy = 'attacker-extension';
  ok(throws(() => validateFeeRules(evilRole), /未知键/), 'F1: role 未知键(refund_policy) 拒——NWT repro 原样负测试');
  ok(throws(() => computeFeeRulesCommit(evilRole)), 'F1: commit 碰撞路径死(computeFeeRulesCommit 对 evil 输入直接 throw, 不再产出与 base 同 hash)');
}

console.log('[test] ② canonicalizeFeeRules 单源序列化(spec v1.2-2):');
{
  const a = predictionRulesWithAddrs();
  const b = predictionRulesWithAddrs();
  b.roles.reverse();   // 同规则乱序供给
  ok(canonicalizeFeeRules(a) === canonicalizeFeeRules(b), 'roles 数组序不影响 canonical(name 字典序归一)');
  const c = predictionRulesWithAddrs();
  c.roles[1].address = BROKER_PK.toUpperCase();
  ok(canonicalizeFeeRules(a) === canonicalizeFeeRules(c), 'address 大小写归一(lowercase)');
  // 与既有 canonicalPredicate(pool-shard-settle.mjs:182)对同一 object 产出 byte-identical(两实现同规范守护)
  const obj = { z: 1, a: [{ y: 2, x: 3 }], m: null };
  const viaCanonPred = canonicalPredicate(obj);
  ok(viaCanonPred === '{"a":[{"x":3,"y":2}],"m":null,"z":1}', 'canonicalPredicate 规范锚(递归 sorted-key)');
  // F3(NWT): fixpoint 跨实现等价守护——canonicalizeFeeRules 产物再过 canonicalPredicate 必须逐字节不动,
  //   _canonicalJson(私有)与 canonicalPredicate 边角(非ASCII键/数字形态)漂移时此断言即报。
  const canon = canonicalizeFeeRules(predictionRulesWithAddrs());
  ok(canonicalPredicate(JSON.parse(canon)) === canon, 'F3 fixpoint: canonicalPredicate(parse(canonical)) === canonical(两序列化实现等价守护)');
}

console.log('[test] ③ computeFeeRulesCommit(blake2b-256 hash-commit, spec v1.2-1):');
{
  const commit = computeFeeRulesCommit(predictionRulesWithAddrs());
  ok(/^[0-9a-f]{64}$/.test(commit), `固定 32B hex: ${commit.slice(0, 16)}…`);
  const tweaked = predictionRulesWithAddrs();
  tweaked.roles[1].bps = 170; tweaked.roles[0].bps = 9690;
  ok(computeFeeRulesCommit(tweaked) !== commit, 'bps 变 → commit 变(settler 改费率必被委员拒)');
  const shuffled = predictionRulesWithAddrs();
  shuffled.roles.reverse();
  ok(computeFeeRulesCommit(shuffled) === commit, '同规则乱序 → 同 commit(canonical 归一)');
}

console.log('[test] ④ 逐字搬迁 byte-equal: prediction 预设 == 既有 deriveFeeLeaves(FEE_CONFIG)(spec §4/§5-4 替代铁律):');
{
  const pool = '17613900000000';   // 28mln 量级真实池
  const legacy = deriveFeeLeaves({ poolSompi: pool, feeConfig: FEE_CONFIG, brokerPk: BROKER_PK, introducerPk: INTRO_PK, committeePks: COMMITTEE });
  const rules = predictionRulesWithAddrs();
  const component = deriveRoleFeeLeaves(rules, pool, { committeePks: COMMITTEE });
  ok(JSON.stringify(component.feeLeaves) === JSON.stringify(legacy.feeLeaves), `feeLeaves byte-equal(${legacy.feeLeaves.length} 叶: broker/introducer/committee×${COMMITTEE.length}, 序+值+type 全同)`);
  ok(component.feeSompi === legacy.feeSompi, `feeSompi byte-equal: ${component.feeSompi}`);
  // introducer 缺席 fallback 语义同款(bps 归 winners, 不发叶)
  const legacyNoIntro = deriveFeeLeaves({ poolSompi: pool, feeConfig: FEE_CONFIG, brokerPk: BROKER_PK, introducerPk: null, committeePks: COMMITTEE });
  const rulesNoIntro = predictionRulesWithAddrs();
  delete rulesNoIntro.roles[2].address;
  const componentNoIntro = deriveRoleFeeLeaves(rulesNoIntro, pool, { committeePks: COMMITTEE });
  ok(JSON.stringify(componentNoIntro.feeLeaves) === JSON.stringify(legacyNoIntro.feeLeaves), 'introducer 缺席 → 同款 fallback(winner 保, 叶集 byte-equal)');
}

console.log('[test] ⑤ V2 单源函数替换后回放(1dv70 真实链值, 与 fee-single-source.test.mjs 互证):');
{
  const { feeLeaves, feeSompi } = deriveSettlementFeeLeaves(MARKET_1DV70, POOL_1DV70);
  ok(feeSompi === EXPECT_FEE_1DV70 && feeLeaves.length === 1 && feeLeaves[0].type === 'broker', `替换后 feeSompi=${feeSompi} == 真实链上 ${EXPECT_FEE_1DV70}, 单 broker 叶 type 不变`);
}

console.log('[test] ⑥ feeSplit 端到端 == computePariMutuelPayout 组合(payoutLeaves byte-equal):');
{
  const v2Rules = { schema_v: 1, preset: 'prediction-v2-market', roles: [{ name: 'provider', bps: 10000 - 190 }, { name: 'broker', bps: 190, address: MARKET_1DV70.brokerPk }] };
  const split = feeSplit(v2Rules, POOL_1DV70, WINNERS_1DV70);
  const { feeLeaves } = deriveSettlementFeeLeaves(MARKET_1DV70, POOL_1DV70);
  const pm = computePariMutuelPayout({ bettors: WINNERS_1DV70.map(w => ({ ...w, direction: 0 })), winningDirection: 0, poolTotalSompi: POOL_1DV70, feeLeaves });
  ok(JSON.stringify(split.payoutLeaves) === JSON.stringify(pm.payoutLeaves), 'payoutLeaves byte-equal(赢家分配数学同款: floor+尘差→winners[0])');
  ok(split.distributable === pm.distributable && split.feeSompi === pm.feeSompi, `distributable=${split.distributable}/feeSompi=${split.feeSompi} 同款`);
  const sum = split.payoutLeaves.reduce((s, l) => s + BigInt(l.amount), 0n);
  ok(sum === BigInt(POOL_1DV70), `Σ(payoutLeaves)=${sum} == pool(精确清零守恒)`);
}

console.log('[test] ⑦ 尘差确定性 + degenerate:');
{
  const rules = { schema_v: 1, roles: [{ name: 'provider', bps: 9700 }, { name: 'broker', bps: 300, address: BROKER_PK }] };
  const winners3 = [{ pk: '1'.repeat(64), stake: '333' }, { pk: '2'.repeat(64), stake: '333' }, { pk: '3'.repeat(64), stake: '334' }];
  const s = feeSplit(rules, '1000001', winners3);
  const sum = s.payoutLeaves.reduce((t, l) => t + BigInt(l.amount), 0n);
  ok(sum === 1000001n, `除不尽池 Σ==pool 精确(尘差→winners[0]: ${s.winners[0].amount})`);
  const d = feeSplit(rules, '1000000', []);
  ok(d.degenerate === true && d.feeSompi === '0', 'degenerate(零赢家) → 退款路径, fee 不收');
}

console.log('[test] ⑧ fail-loud: pool<=0 拒绝派生:');
{
  ok(throws(() => deriveRoleFeeLeaves(predictionRulesWithAddrs(), '0'), /必须\s*>0/), 'pool=0 throw(caller 链读值可疑)');
}

console.log(fails === 0
  ? '\n✅✅ ALL PASS — fee-split 组件: 硬不变量/canonical 单源/hash-commit/逐字搬迁 byte-equal/1dv70 回放/守恒/fail-loud'
  : `\n❌ ${fails} assertions failed`);
process.exit(fails === 0 ? 0 : 1);
