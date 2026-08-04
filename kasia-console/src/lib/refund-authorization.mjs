// refund-authorization.mjs — P1「验不成 ≠ 可以退款」的【单一共享授权验证器】(单源)
//
// 设计: docs/2026-08-04-p1-cannot-verify-is-not-refund-authorization-design.md
// 上游要求(Codex 第八轮 bridge 2819d2b6,经 Bettor (139)补32 转,NWT 按七条验收):
//   「抑制发事件 + 检查 freeze 返回值是**纵深防御**,替代不了**每条真实 IPC/签名/广播之前的
//     单一共享授权验证器**」;「共享谓词**单一实现**、两个 IPC 调用点各自行使 ——
//     复制谓词会产出两个互相同意、而实现已漂移的测试」。
//
// 🔴 本模块存在的理由 = 昨晚那个被证伪的论证的替代品:
//   我曾断言「真正花钱的动作只有一处」,Codex 从框外证伪 —— bettor 退款实际有【三条入口】
//   汇到【两个 IPC 调用点】:
//     ① settler 的 legacyRefundBuilderTick → buildBettorRefundClaim → IPC(pool.js:493)
//     ② POST /api/pool/market/:id/bettor-refund-claim → 同上(端点无闸,靠 loopback 绑定不被改)
//     ③ bettor-refund-claim-auto 的 5min cron → 直接 IPC(绕过 buildBettorRefundClaim)
//   ⇒ 闭合点是【那两个 IPC 调用点】,而它们必须调用**同一个函数本体**,不是各写一遍谓词。
//
// 🔴 一句必须照抄进任何引用处的定性(Codex 原话):
//   **「历史 bettor_refund_available 行是持久的【审计数据】,不是持久的【授权】。」**
//   事件一旦 emitted 永久留在 chain_events;重启后重扫历史事件照样会付款 ——
//   所以修法不能只挡「新事件不发」,必须在**每次真的要动钱之前**问一次授权。

/**
 * 白名单:退款必须携带的【肯定式证据】。单源 —— SQL 闸与本验证器共用这一份。
 *
 * 🔴 白名单不是黑名单(ANTI-PATTERNS 规则 58):枚举"不算证据的理由"天生不完备;
 *    只放行【已知好值】才封闭。
 * 🔴 取值一律是"有人/有事实肯定地说了什么",**计时器与重试计数永远不得进本表**,
 *    也不得新增以时间或次数为唯一内容的取值。
 * 🔴 名字不叫 refund_evidence:那个名字已被 admin-dedup.js 占用(事后付款凭据,
 *    bond reclaim 闸②的判据)。同名两物且两个都在钱路上。
 */
export const REFUND_AUTHORIZATION_WHITELIST = Object.freeze([
  'bettors_absent',                    // 0 bet(⚠ 判据目前仅本地聚合, 见 EVIDENCE_TIER_LOCAL_ONLY)
  'committee_affirmative_unjudgeable', // ≥4 委员【主动】投 ABSTAIN = 有人明确说了"判不了"
  'structurally_invalid_market',       // commingled spine 等结构性无效(单源 isCommingledSpine)
  'pool_below_minimum',                // 池总额 < 门槛, 协议设计上就不结算(可测量事实, 非计时器)
  'owner_authorized',                  // 另行授权(必须带授权引用: 谁/何时/依据)
]);

/**
 * 弱证据分级:`bettors_absent` 今天的判据只有【本地 pool_bettor_sides 聚合】,
 * 链上等式(spine UTXO 面值 == maker stake)尚未实现 ⇒ 打成**可查询**的标记,
 * 将来等式落地后能把"用弱证据授权过的历史盘"筛出来回头补验。
 */
export const EVIDENCE_TIER_LOCAL_ONLY = 'local_only';

/**
 * SQL 侧的 IN 列表从常量生成,不手抄第二份(手抄那份漂了 ⇒ 闸少认一个合法值 ⇒ 静默挡住合法退款)。
 * 值全是代码内常量,仍加正则断言:将来若有人塞进带引号/空格的值,这里当场抛而不是拼出一条
 * 语义被改写的 SQL。
 */
export const REFUND_AUTHORIZATION_SQL_IN = (() => {
  for (const v of REFUND_AUTHORIZATION_WHITELIST) {
    if (!/^[a-z][a-z0-9_]*$/.test(v)) {
      throw new Error(`refund_authorization 白名单取值非法(只允许 [a-z0-9_]): ${JSON.stringify(v)}`);
    }
  }
  return REFUND_AUTHORIZATION_WHITELIST.map((v) => `'${v}'`).join(', ');
})();

/**
 * assertBettorRefundAuthorized — **每一次真的要动 bettor 的钱之前**必须调用的那一下。
 *
 * 🔴 fail-closed:任何读不出、解析不了、不在白名单 ⇒ `{ ok:false }`。
 *    「读不到授权」与「明确没有授权」在本函数里**同样是拒绝** —— 不许"读不到就放行"。
 * 🔴 它**不看** chain_events 里的 `bettor_refund_available`:那是审计数据不是授权(见文件头)。
 *    调用方拿着一条三周前的事件来问,答案仍然取决于**市场此刻有没有授权**。
 *
 * @param {object} args
 * @param {string} args.marketId
 * @param {object} args.db        better-sqlite3 handle
 * @returns {{ok: boolean, authorization: string|null, reason: string}}
 */
export function assertBettorRefundAuthorized({ marketId, db } = {}) {
  if (!marketId || !db) {
    return { ok: false, authorization: null, reason: 'P1: 调用参数不全(marketId/db) — fail-closed' };
  }
  let row;
  try {
    row = db.prepare('SELECT id, protocol_status, metadata FROM pool_markets WHERE id = ?').get(marketId);
  } catch (e) {
    // 查询本身失败 ≠ "没有授权记录"。两者都拒, 但要分得开, 否则 DB 故障会被读成"这盘没授权"。
    return { ok: false, authorization: null, reason: `P1: 授权查询本身失败(不是"查不到"): ${e.message}` };
  }
  if (!row) return { ok: false, authorization: null, reason: 'P1: market 不存在' };

  let meta = {};
  try { meta = JSON.parse(row.metadata || '{}'); } catch {
    return { ok: false, authorization: null, reason: 'P1: market.metadata 非法 JSON — fail-closed' };
  }
  const authorization = meta.refund_authorization;
  if (typeof authorization !== 'string') {
    // 🔴 结构也要判:占用方 refund_evidence 是 object。"metadata 里有个看起来像证据的东西"
    //    不得让市场过闸。
    return {
      ok: false,
      authorization: null,
      reason: `P1: 无 refund_authorization(得到 ${JSON.stringify(authorization)}) — 退款需要肯定式证据, "超时/重试用尽"不构成授权`,
    };
  }
  if (!REFUND_AUTHORIZATION_WHITELIST.includes(authorization)) {
    return { ok: false, authorization, reason: `P1: refund_authorization=${JSON.stringify(authorization)} 不在白名单` };
  }
  return { ok: true, authorization, reason: `P1: 授权通过(${authorization})` };
}
