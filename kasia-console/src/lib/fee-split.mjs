// fee-split.mjs — 模块化分润组件(B线, spec docs/2026-06-22-modular-fee-split-component-spec.md v1.3)。
// J2 2026-07-12 落1: 组件本体 + prediction 预设 + canonicalize/commit 单源。
//
// 定位(Owner 钦定): 社会资源协调原语——「谁该得多少」焊死在链上、自动履行 → 每个角色确定能拿到自己那份。
// 本文件 = 纯函数层: 不持状态、不碰链、不碰 DB、不知道行业。determinism = 同输入同输出 = 跨节点 byte-equal。
// ③好用层边界(spec §3.2, NWT 边界修正): 推送/notify 永不进本文件——feeSplit() 纯函数零副作用是
// determinism 的根基, 委员 settle-time re-derive 是纯计算, 永不触发推送。notify 层=落3 独立交付。
//
// 🔴 canonicalize 单源铁律(spec v1.2-2): create-time commit 与 settle-time re-derive 必须 import 本文件的
// canonicalizeFeeRules()——两处各自实现同一规范 = driver/committee 漏配家族的根。lint R-FEERULES-CANON-BYPASS 封旁路。

import { blake2b } from '@noble/hashes/blake2b';

// ── schema 版本(spec v1.2-3: schema_v 进 canonicalize 载荷, 版本不符 = 可辨识错误非静默算错) ──
export const FEE_RULES_SCHEMA_V = 1;
const SUPPORTED_SCHEMA_VERSIONS = new Set([1]);

// ── schema 层硬不变量常量(spec §2 防恶意配置)──
// ⚠ 数值 = Owner 经济政策位(spec §7: 经济数值=Owner 决策, 非机制); 此处为保守默认, 机制保证任意【合法】配置 trustless。
export const PROVIDER_MIN_BPS = 5000;   // provider(winners/卖家)下限: 防 facilitator 配 100% 抢光
export const ROLE_MAX_BPS = 5000;       // 单个非 provider role 上限

// ── 行业预设(spec §4)。prediction = 现有分法逐字搬迁(FEE_CONFIG 同值, pool-shard-settle.mjs:23 单源对应):
//    winners 9700 / broker 160 / introducer 20(optional) / oracle 100 + node 20(委员派生)。
//    role name = 既有 leaf type 命名(broker/introducer/committee 族), 与 spec §2 通名映射:
//    provider=winners, facilitator=broker, affiliate=introducer, verifier=oracle, infra=node。
//    ⚠ 预设是【模板】非成品: broker 等地址角色地址=建单时注入(create-committed), 未注址的模板过不了
//    validateFeeRules(刻意——防拿模板直接上链)。
export const FEE_PRESETS = Object.freeze({
  prediction: Object.freeze({
    schema_v: FEE_RULES_SCHEMA_V,
    preset: 'prediction',
    roles: Object.freeze([
      Object.freeze({ name: 'provider', bps: 9700 }),
      Object.freeze({ name: 'broker', bps: 160 }),                                   // address 建单时注入(create-committed)
      Object.freeze({ name: 'introducer', bps: 20, optional: true }),                // 无 introducer → bps 归 winners(既有 fallback 语义)
      Object.freeze({ name: 'oracle', bps: 100, derive: 'committee' }),              // 委员集链派生, 非 caller 供地址
      Object.freeze({ name: 'node', bps: 20, derive: 'committee' }),
    ]),
  }),
});

const HEX64 = /^[0-9a-f]{64}$/;
// F1 白名单(NWT 落1 红队): canonicalize 拾取的键集与此必须一致——validate 拒绝白名单外的一切。
const _TOP_KEYS = new Set(['schema_v', 'preset', 'roles']);
const _ROLE_KEYS = new Set(['name', 'bps', 'address', 'derive', 'optional']);

/**
 * validateFeeRules — schema 层硬不变量(spec §2, 组件入口 + commit 前双验的那一份)。
 * 不合法 → throw(fail-loud, 防恶意预设上链)。版本不符 → err.code='FEE_RULES_SCHEMA_V_UNSUPPORTED'(可辨识,
 * spec v1.2-3: 非静默算错非裸 BUST——委员 re-derive 前先查版本支持集)。
 * @param {object} feeRules { schema_v, preset?, roles:[{name, bps, address?, derive?, optional?}] }
 */
export function validateFeeRules(feeRules) {
  if (!feeRules || typeof feeRules !== 'object' || Array.isArray(feeRules)) throw new Error('feeRules 必须是 object');
  // 🔴 strict whitelist(NWT 落1 红队 F1, CONFIRMED repro): 未知键必 fail-loud——canonicalize 只拾取已知键,
  //   未知键若放行会被静默剥除 → 两份语义不同的 feeRules 同 commit(链上 commit 验证被旁路)。白名单强制
  //   "加字段必 bump schema_v" 从流程纪律升为机制(spec v1.2-3 的版本保障靠这里闭合)。
  for (const k of Object.keys(feeRules)) {
    if (!_TOP_KEYS.has(k)) throw new Error(`feeRules 未知顶层键 '${k}'(白名单 ${[..._TOP_KEYS]}; 扩展字段必须 bump schema_v 走新版本, 禁静默附加)`);
  }
  if (!Number.isInteger(feeRules.schema_v)) throw new Error('feeRules.schema_v 必须是 int(spec v1.2-3: 版本进载荷)');
  if (!SUPPORTED_SCHEMA_VERSIONS.has(feeRules.schema_v)) {
    const e = new Error(`feeRules schema_v=${feeRules.schema_v} 不在本节点支持集 [${[...SUPPORTED_SCHEMA_VERSIONS]}](可辨识版本不符, 非配置非法)`);
    e.code = 'FEE_RULES_SCHEMA_V_UNSUPPORTED';
    throw e;
  }
  const roles = feeRules.roles;
  if (!Array.isArray(roles) || roles.length === 0) throw new Error('feeRules.roles 必须是非空数组');
  const names = new Set();
  let sumBps = 0;
  let providers = 0;
  for (const r of roles) {
    if (!r || typeof r !== 'object') throw new Error('role 必须是 object');
    for (const k of Object.keys(r)) {
      if (!_ROLE_KEYS.has(k)) throw new Error(`role 未知键 '${k}'(白名单 ${[..._ROLE_KEYS]}; F1 同上, 扩展必 bump schema_v)`);
    }
    if (typeof r.name !== 'string' || !r.name) throw new Error('role.name 必须是非空 string');
    if (names.has(r.name)) throw new Error(`role name 重复: ${r.name}(canonical 序/leaf 归属都靠 name 唯一)`);
    names.add(r.name);
    if (!Number.isInteger(r.bps) || r.bps < 0) throw new Error(`role ${r.name}: bps 必须是 int >= 0, got ${r.bps}`);
    sumBps += r.bps;
    if (r.name === 'provider') {
      providers++;
      if (r.address != null || r.derive != null) throw new Error('provider role 不带 address/derive(winners 集在 settle 时供给, 非规则配置)');
      if (r.bps < PROVIDER_MIN_BPS) throw new Error(`provider.bps=${r.bps} < PROVIDER_MIN_BPS=${PROVIDER_MIN_BPS}(防 facilitator 抢光)`);
    } else {
      if (r.bps > ROLE_MAX_BPS) throw new Error(`role ${r.name}: bps=${r.bps} > ROLE_MAX_BPS=${ROLE_MAX_BPS}`);
      if (r.derive != null) {
        if (r.derive !== 'committee') throw new Error(`role ${r.name}: derive 只支持 'committee', got ${r.derive}`);
        if (r.address != null) throw new Error(`role ${r.name}: derive 角色地址=委员集链派生, 禁 caller 供 address(命门④ provenance)`);
      } else if (r.address != null) {
        if (typeof r.address !== 'string' || !HEX64.test(String(r.address).toLowerCase())) {
          throw new Error(`role ${r.name}: address 必须是 32B pk hex(64 hex chars), got ${String(r.address).slice(0, 20)}…`);
        }
      } else if (!r.optional) {
        throw new Error(`role ${r.name}: 非 optional 的地址角色缺 address(optional:true 才允许缺席→bps 归 winners)`);
      }
    }
  }
  if (providers !== 1) throw new Error(`必须恰好 1 个 provider role, got ${providers}`);
  if (sumBps !== 10000) throw new Error(`Σbps=${sumBps} != 10000(总和守恒, 拒)`);
  return true;
}

// 递归 sorted-key canonical JSON(同 canonicalPredicate 规范, pool-shard-settle.mjs:182 先例——本文件不 import 它:
// 组件零 console 依赖, 但两者对同一 object 产出 byte-identical, fee-split.test.mjs ② 有 fixpoint 等价断言
// canonicalPredicate(JSON.parse(canonicalizeFeeRules(r))) === canonicalizeFeeRules(r)(NWT F3))。
function _canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(_canonicalJson).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + _canonicalJson(v[k])).join(',') + '}';
}

/**
 * canonicalizeFeeRules — feeRules 的唯一 canonical 序列化(spec v1.2-2 单一共享函数)。
 * 规范: roles 按 name 字典序 + 全层 sorted-key + address lowercase + optional/derive 缺省归一(null 剥除)。
 * ⚠ roles 的 canonical 序同时是 fee-leaf 的发射序(见 feeSplit)——序列化序 == 行为序, 否则同 commit 可产不同 root。
 * @returns {string} canonical 字符串(hash 的 preimage)
 */
export function canonicalizeFeeRules(feeRules) {
  validateFeeRules(feeRules);
  const roles = [...feeRules.roles]
    .map(r => {
      const o = { name: r.name, bps: r.bps };
      if (r.address != null) o.address = String(r.address).toLowerCase();
      if (r.derive != null) o.derive = r.derive;
      if (r.optional) o.optional = true;
      return o;
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const canonical = { schema_v: feeRules.schema_v, roles };
  if (feeRules.preset != null) canonical.preset = String(feeRules.preset);
  return _canonicalJson(canonical);
}

/** feeRules hash-commit = blake2b-256(canonicalizeFeeRules(feeRules)), 固定 32B hex(spec v1.2-1, 同 computeMarketCommit 模式)。 */
export function computeFeeRulesCommit(feeRules) {
  return Buffer.from(blake2b(Buffer.from(canonicalizeFeeRules(feeRules)), { dkLen: 32 })).toString('hex');
}

/**
 * deriveRoleFeeLeaves — 从 feeRules 派生 fee-recipient leaves(feeSplit 的 fee 半边, 也是
 * deriveSettlementFeeLeaves 内部实现的替换目标, spec v1.1-A)。
 * 数学与既有 deriveFeeLeaves/deriveSettlementFeeLeaves 完全同款: 每 leaf = floor(pool*bps/10000) BigInt,
 * flooring 尘差自然归 winners(distributable = pool − Σleaves); 委员组合 bps 先 floor 总额再均分, 余数给
 * pk 排序后的 committee[0](既有确定性惯例)。
 * 发射序 = canonical role name 字典序(addressed 角色), 委员合并组殿后(pk asc)——与 canonicalizeFeeRules 同序,
 * commit 绑行为。
 * @param {object} feeRules 已 validate 的规则(本函数内再 validate 一次, 双验入口)
 * @param {string|number|bigint} poolSompi 分配基数(caller 独立链读, 反 vacuous 铁律见 deriveSettlementFeeLeaves)
 * @param {object} [opts] { committeePks?: hex[](链上派生委员集, derive:'committee' 角色的收款集) }
 * @returns {{ feeLeaves:[{pk,amount,type}], feeSompi:string }}
 */
export function deriveRoleFeeLeaves(feeRules, poolSompi, { committeePks = [] } = {}) {
  validateFeeRules(feeRules);
  const pool = BigInt(poolSompi);
  if (pool <= 0n) throw new Error(`deriveRoleFeeLeaves: poolSompi=${poolSompi} 必须 >0(caller 链读值可疑, 拒绝派生)`);
  const bpsAmt = (bps) => pool * BigInt(bps) / 10000n;

  const sorted = [...feeRules.roles].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const leaves = [];
  let committeeBps = 0;
  for (const r of sorted) {
    if (r.name === 'provider' || r.bps <= 0) continue;
    if (r.derive === 'committee') { committeeBps += r.bps; continue; }
    if (r.address == null) continue;   // optional 角色缺席 → bps 归 winners(validate 已保证非 optional 必有址)
    leaves.push({ pk: String(r.address).toLowerCase(), amount: bpsAmt(r.bps), type: r.name });
  }
  if (committeeBps > 0 && committeePks.length) {
    const total = bpsAmt(committeeBps);
    const pks = [...committeePks].map(p => String(p).toLowerCase()).sort();
    const each = total / BigInt(pks.length);
    pks.forEach((pk, i) => leaves.push({ pk, amount: each + (i === 0 ? total - each * BigInt(pks.length) : 0n), type: 'committee' }));
  }
  const feeSompi = leaves.reduce((s, l) => s + l.amount, 0n);
  return { feeLeaves: leaves.map(l => ({ pk: l.pk, amount: l.amount.toString(), type: l.type })), feeSompi: feeSompi.toString() };
}

/**
 * feeSplit — 组件核心纯函数(spec §1): feeSplit(feeRules, poolSompi, winners) → { feeLeaves, payoutLeaves }。
 * winners = 赢家集 [{pk, stake}](谁是赢家由 caller 的领域逻辑判定——组件不知道行业)。
 * 分配数学(与 computePariMutuelPayout 逐位同款, fee-split.test.mjs ⑦ 有 byte-equal 守护):
 *   distributable = pool − Σ(feeLeaves); 每赢家 floor(stake*distributable/totalWinStake); 尘差→winners[0]。
 * degenerate(赢家集空/零 stake) → { degenerate:true }(退款路径, caller 领域处理——fee 不收, 组件不发明政策)。
 * @returns {{ degenerate:boolean, reason?:string, winners:[{pk,amount}], feeLeaves, payoutLeaves, poolTotal, distributable, feeSompi }}
 */
export function feeSplit(feeRules, poolSompi, winners, { committeePks = [] } = {}) {
  const { feeLeaves, feeSompi } = deriveRoleFeeLeaves(feeRules, poolSompi, { committeePks });
  const pool = BigInt(poolSompi);
  const distributable = pool - BigInt(feeSompi);
  const winnerList = Array.isArray(winners) ? winners : [];
  const totalWinStake = winnerList.reduce((s, w) => s + BigInt(w.stake), 0n);
  if (winnerList.length === 0 || totalWinStake === 0n) {
    return { degenerate: true, reason: 'no winners → refund(领域侧退款路径, fee 不收)', winners: [], feeLeaves: [], payoutLeaves: [], poolTotal: pool.toString(), distributable: pool.toString(), feeSompi: '0' };
  }
  const payouts = winnerList.map(w => ({ pk: String(w.pk).toLowerCase(), amount: BigInt(w.stake) * distributable / totalWinStake }));
  const assigned = payouts.reduce((s, p) => s + p.amount, 0n);
  payouts[0].amount += (distributable - assigned);   // 尘差 → winners[0](Σ == distributable 精确, 既有惯例)
  const winnerLeaves = payouts.map(p => ({ pk: p.pk, amount: p.amount.toString() }));
  const payoutLeaves = [...winnerLeaves, ...feeLeaves.map(l => ({ pk: l.pk, amount: l.amount }))];
  return {
    degenerate: false,
    winners: winnerLeaves,
    feeLeaves,
    payoutLeaves,
    poolTotal: pool.toString(),
    distributable: distributable.toString(),
    feeSompi,
  };
}
