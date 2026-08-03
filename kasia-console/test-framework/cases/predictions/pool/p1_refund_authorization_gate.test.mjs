// P1「验不成 ≠ 可以退款」——花钱点授权闸 regression(J2, 2026-08-04)
//
// 设计: docs/2026-08-04-p1-cannot-verify-is-not-refund-authorization-design.md
//   §10.1(闸落在真正花钱的那一步)· §4.1(白名单式肯定证据)· §10.2(字段改名 + 阴性验证)
// 上游: Codex 收口证据第 5 条 / Bettor 16:28 实查立卡 / NWT 三轮红队 / Owner 铁律「只 settle 绝不 refund」
//
// 【这条用例守的是什么(名字写着它守什么, 删掉守卫时红的必须是它自己)】
//   `pool-market-settler.js` 的 bettor 退款扫描(legacyRefundBuilderTick)在 WHERE 里要求
//   market.metadata.refund_authorization ∈ 白名单。**真正把钱退给 bettor 的动作只有那一条扫描**,
//   所以不变量落在那儿(上游写 cancelled/refunded 的地方是开放集合, 花钱点是闭合的一处)。
//
// 【为什么必须有阳性对照(用例 1)】前面几条全是"必须拒"。**一个把所有输入都拒掉的实现能让它们
//   全绿。** 没有阳性对照, 这套用例挡不住一个恒拒的实现(= 全网退款静默停摆), 而"退款被挡住了"
//   与"没人来 claim"读数完全相同 —— 那正是本卡从头到尾在防的失效形状。
//
// 🔴🔴 本用例第一版是【装饰】, 是实跑注入实验抓到的 —— 这一段必须留着, 别再犯:
//   第一版把闸的 SQL 手抄了一份在用例里。我按今天全队立的判别式做了注入实验:
//   **把授权闸从生产文件 pool-market-settler.js 里整段删掉, 这条用例照样 1 PASS。**
//   ⇒ 它锁的是"我抄的那份 SQL 的行为", 不是"生产真的还带着这道闸" —— 正是 Codex 打过的
//     「SQL 重放证不了真的拦住了调用」那一形状, 也正是"名字写着守什么、删了守卫却红在别处"。
//
// 🔨 现在的做法: **在 import 期直接读生产源码**, 从中【提取】白名单常量与闸的谓词; 提不到就
//   当场 throw(用例 error = 红)。所以:
//     · 生产把闸删了      ⇒ 提取失败 ⇒ 本用例红(红在它自己身上 ✅)
//     · 生产改了白名单取值 ⇒ 用例自动跟着改, 不会出现"测试还绿、生产已变"的漂移
//   不 import 生产模块本身(那会带进 sqlite/定时器副作用), 只读文本。
//
// Offline: 读源码 + exec_sql fixtures + read-only query_db + teardown。不起服务、不碰链、不碰 relay。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SETTLER_SRC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../src/services/pool-market-settler.js');

const _src = fs.readFileSync(SETTLER_SRC, 'utf8');

const GUARD_PREDICATE = "AND json_extract(pm.metadata, '$.refund_authorization') IN (${REFUND_AUTHORIZATION_SQL_IN})";

// ① 闸必须在【花钱那条查询里】—— 而不是"文件里某处有这个字符串"。
// 🔴 这一段也是注入实验第二轮才修对的: 上一版只写 _src.includes(GUARD_PREDICATE), 结果把
//    闸从花钱点删掉后用例【仍然全绿】, 因为同一个谓词在"积压计数"那条查询里还有一份, 把
//    includes 满足了。⇒ 判据必须锚到【那一段查询】, 不能锚到全文。
const _gateStart = _src.indexOf('const sidesRaw = sqlite.prepare(');
const _gateEnd = _src.indexOf('ORDER BY pbs.stake_amount ASC', _gateStart);
if (_gateStart === -1 || _gateEnd === -1) {
  throw new Error('定位不到 bettor 退款扫描(sidesRaw)那段查询 —— 生产结构变了, 本用例的判据失效, 必须重写而不是放行');
}
const _gateSql = _src.slice(_gateStart, _gateEnd);
if (!_gateSql.includes(GUARD_PREDICATE)) {
  throw new Error(
    'P1 授权闸不在花钱点上了: pool-market-settler.js 的 bettor 退款扫描(sidesRaw)缺少 ' +
    "json_extract(...refund_authorization) IN (...) 谓词 —— 钱路失去 P1 不变量保护");
}
if (!_gateSql.includes('json_valid(pm.metadata)')) {
  throw new Error('花钱点的 json_valid 短路守卫不见了');
}
// ② json_valid 必须【排在】json_extract 之前(AND 左到右短路)。顺序反了, 表里任意一行坏 JSON
//    会让整条查询抛异常(卡① NWT 已纠正过"坏行返回 NULL"这个错误假设)。
// (谓词在文件里出现【两次】: 闸本身 + 积压计数那条同谓词查询。两处都必须带 json_valid 前置,
//  所以逐个出现点各查自己前面的窗口 —— 拿全文 indexOf 比大小会跨站点比, 那是错的判据。)
for (let i = _src.indexOf(GUARD_PREDICATE); i !== -1; i = _src.indexOf(GUARD_PREDICATE, i + 1)) {
  if (!_src.slice(Math.max(0, i - 200), i).includes('json_valid(pm.metadata)')) {
    throw new Error(`P1 授权闸的 json_valid 守卫必须紧排在 json_extract 之前(短路顺序), 出现点 offset=${i} 缺前置`);
  }
}
// ③ 🔴 regression(NWT diff 审 2026-08-04 抓出的钱路死结, 修完必须锁住):
//    冻结调用【前面】不得有把状态写成冻结白名单之外的值(典型是 'cancelled')的 UPDATE ——
//    freezeAwaitingAuthorization 只允许从 verifying/collecting_sigs/disputed/refunding 转入,
//    先写 'cancelled' 会让它 UPDATE 0 行 ⇒ 市场既没退款也没冻结, 而 authorizeRefundByOwner
//    只认冻结态 ⇒ 【没有任何出口】。原 bug 就在 settle_submit_giveup 那处(watchdog-b 改对了、
//    兄弟路径漏改)。这里写成【通用判据】而不是只钉那一处, 否则下一条新路径会以同样方式复发。
{
  const FREEZE_CALL = 'freezeAwaitingAuthorization(';
  const ALLOWED_IN = ["'verifying'", "'collecting_sigs'", "'disputed'", "'refunding'"];
  for (let i = _src.indexOf(FREEZE_CALL); i !== -1; i = _src.indexOf(FREEZE_CALL, i + 1)) {
    const before = _src.slice(Math.max(0, i - 600), i);
    if (before.includes('function freezeAwaitingAuthorization')) continue;   // 定义处本身, 跳过
    const m = [...before.matchAll(/protocol_status\s*=\s*('[a-z_]+')/g)];
    const bad = m.filter((x) => !ALLOWED_IN.includes(x[1]));
    if (bad.length) {
      throw new Error(
        `冻结调用点(offset=${i})前面把 protocol_status 写成了 ${bad.map((x) => x[1]).join(',')} —— ` +
        '不在 freezeAwaitingAuthorization 允许转入的集合里, 冻结会静默失败, 市场将没有任何出口');
    }
  }
}

// ④ 白名单取值从生产常量提取, 不手抄 —— 生产改了本用例自动跟着改。
const _wlBlock = _src.match(/REFUND_AUTHORIZATION_WHITELIST\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/);
if (!_wlBlock) throw new Error('提不到生产的 REFUND_AUTHORIZATION_WHITELIST 常量');
const WHITELIST = [..._wlBlock[1].matchAll(/'([a-z][a-z0-9_]*)'/g)].map((m) => m[1]);
if (WHITELIST.length < 2) throw new Error(`白名单提取结果异常: ${JSON.stringify(WHITELIST)}`);

const M_OK      = '__test_p1_authz_ok__';          // 合法授权 ⇒ 必须放行(阳性对照)
const M_NONE    = '__test_p1_authz_none__';        // 无授权字段 ⇒ 必须挡
const M_BOGUS   = '__test_p1_authz_bogus__';       // 授权值不在白名单 ⇒ 必须挡
const M_OLDNAME = '__test_p1_authz_oldname__';     // 只有被占用的旧字段 refund_evidence ⇒ 必须挡
const M_BADJSON = '__test_p1_authz_badjson__';     // metadata 坏 JSON ⇒ 查询不得抛, 且不得放行

// 与生产 WHERE 同形(见文件头漂移标注): json_valid 必须排在 json_extract 之前 ——
// AND 从左到右短路; 表里任意一行坏 JSON 会让【整条查询抛异常】, 不是该行返回 NULL(卡① 已纠正过)。
const GATE_SQL = `
  SELECT pbs.id AS side_id
  FROM pool_bettor_sides pbs
  JOIN pool_markets pm ON pm.id = pbs.market_id
  WHERE pm.id = ?
    AND pbs.side_lock_tx IS NOT NULL
    AND pbs.claim_txid IS NULL
    AND json_valid(pm.metadata)
    AND json_extract(pm.metadata, '$.refund_authorization') IN (${WHITELIST.map((v) => `'${v}'`).join(', ')})`;

const mkMarket = (id, metaJson) =>
  `INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_status, protocol_version, metadata)
   VALUES ('${id}', 'testrelay', 'kaspatest:spine', 'abcd', 1780000000, 'cancelled', 'v0.7', ${metaJson})`;

// pool_bettor_sides 的非空无默认列: market_id / bettor_pk / direction / stake_amount / side_p2sh
// (漏 direction 会让 INSERT 静默失败 ⇒ 阳性对照返回 0 行, 而那正是本用例第一次跑时红的原因)
// pool_bettor_sides.id 是 INTEGER PK(不是 TEXT)——塞字符串会 datatype mismatch 让 INSERT 失败,
// 而失败的读数与"查不到符合条件的行"完全相同(阳性对照第二次红就是这个)。⇒ 让它自增, 不显式给。
const mkSide = (marketId) =>
  `INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, side_p2sh, side_lock_tx, stake_amount)
   VALUES ('${marketId}', 'aa', 0, 'kaspatest:side', 'tx_${marketId}', 100000000)`;

const ALL = [M_OK, M_NONE, M_BOGUS, M_OLDNAME, M_BADJSON];

export default {
  id: 'p1_refund_authorization_gate',
  description: 'P1: bettor 退款扫描必须要求白名单式 refund_authorization —— 合法放行/无授权拒/伪值拒/旧字段名拒/坏JSON不抛',
  domain: 'predictions',
  tags: ['regression', 'refund', 'money-path', 'p1-invariant', 'offline'],
  skip_in_batch: false,

  steps: [
    // ── pre-clean(幂等: 清掉上次崩溃留下的) ──
    ...ALL.map((m, i) => ({ id: `pre_clean_side_${i}`, action: 'exec_sql',
      sql: `DELETE FROM pool_bettor_sides WHERE market_id = '${m}'` })),
    ...ALL.map((m, i) => ({ id: `pre_clean_market_${i}`, action: 'exec_sql',
      sql: `DELETE FROM pool_markets WHERE id = '${m}'` })),

    // ── setup ──
    { id: 'seed_ok', action: 'exec_sql',
      sql: mkMarket(M_OK, `'{"refund_authorization":"bettors_absent"}'`) },
    { id: 'seed_none', action: 'exec_sql',
      sql: mkMarket(M_NONE, `'{"refund_reason":"watchdog-b: collecting_sigs silent timeout"}'`) },
    { id: 'seed_bogus', action: 'exec_sql',
      sql: mkMarket(M_BOGUS, `'{"refund_authorization":"timeout_is_fine"}'`) },
    // 🔴 §10.2 阴性验证: refund_evidence 是【已被占用的另一个字段】(admin-dedup.js: 事后付款凭据,
    //    bond reclaim 闸② 的判据), 与本闸要的事前授权是两件事。metadata 里"有个看起来像证据的
    //    东西"不得让市场过闸。
    { id: 'seed_oldname', action: 'exec_sql',
      sql: mkMarket(M_OLDNAME, `'{"refund_evidence":{"refunded_by":"someone","refunds":[]}}'`) },
    { id: 'seed_badjson', action: 'exec_sql',
      sql: mkMarket(M_BADJSON, `'{not valid json'`) },
    ...ALL.map((m, i) => ({ id: `seed_side_${i}`, action: 'exec_sql', sql: mkSide(m) })),

    // ── ① 阳性对照: 合法授权【必须放行】。没有这条, 一个恒拒的实现能让下面全绿。 ──
    { id: 'positive_control_authorized_passes', action: 'query_db', sql: GATE_SQL, params: [M_OK],
      expect: { must: { db_row_count: 1 } } },

    // ── ② 无授权字段 ⇒ 挡。这正是那 39 个纯超时退款盘的形状。 ──
    { id: 'no_authorization_blocked', action: 'query_db', sql: GATE_SQL, params: [M_NONE],
      expect: { must: { db_row_count: 0 } } },

    // ── ③ 伪授权值 ⇒ 挡(白名单不是"非空即可")。 ──
    { id: 'bogus_authorization_blocked', action: 'query_db', sql: GATE_SQL, params: [M_BOGUS],
      expect: { must: { db_row_count: 0 } } },

    // ── ④ 只有被占用的旧字段名 ⇒ 挡(§10.2 撞名的那条阴性)。 ──
    { id: 'old_field_name_blocked', action: 'query_db', sql: GATE_SQL, params: [M_OLDNAME],
      expect: { must: { db_row_count: 0 } } },

    // ── ⑤ 坏 JSON: 查询【不得抛】(json_valid 前置短路), 且该行不得放行。 ──
    //    注: 本步能返回结果本身就证明整条查询没有因为表里有坏 JSON 而炸 —— 若 json_valid 守卫
    //    被删, 这一步会直接报错而不是返回 0 行, 红在它自己身上。
    { id: 'malformed_json_does_not_throw_and_blocked', action: 'query_db', sql: GATE_SQL, params: [M_BADJSON],
      expect: { must: { db_row_count: 0 } } },

    // ── teardown ──
    ...ALL.map((m, i) => ({ id: `cleanup_side_${i}`, action: 'exec_sql',
      sql: `DELETE FROM pool_bettor_sides WHERE market_id = '${m}'` })),
    ...ALL.map((m, i) => ({ id: `cleanup_market_${i}`, action: 'exec_sql',
      sql: `DELETE FROM pool_markets WHERE id = '${m}'` })),
  ],
};
