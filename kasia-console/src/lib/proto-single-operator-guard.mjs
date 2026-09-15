// proto-single-operator-guard.mjs — PROTO_SINGLE_OPERATOR 运行时开关(J2, Bettor 复核裁定
// 2026-09-14, 出处：候选④/②选型讨论期间 NWT 提出的金丝雀先行机制化条件，与 market_genesis
// 同笔纳入实现计划)。
//
// v0 单操作员假设已经在 proto.js 各 handler 里以"读 request.params.id 查 proto_markets"这种形状
// 自然成立（外部人没有任何写入 proto_markets 的入口——唯一的 INSERT 只发生在 market_genesis 广播
// 成功之后，见 proto.js 文件头注 NO-TX-NO-STATE 纪律）。**本文件把这条"隐含在代码形状里"的性质
// 变成显式、可测试、可断言的门禁**——不依赖"以后没人不小心加一条别的写入路径"这种脆弱的隐性保证。
//
// 同 proto-relay-guard.mjs 的既有纪律形状：一个 env 开关常量 + 一个"请求体里出现禁用字段就直接
// 拒绝"的纯函数，调用方在参数解构后立即调用，命中就 400，不进入任何业务逻辑。
//
// 🔴 头注更正(2026-09-15, 账本1423, Bettor 复核裁定): `PROTO_SINGLE_OPERATOR` 这个开关**不控制**
// `rejectExternalMarketIdentityInBody(...)` 本身是否生效——proto.js 的 5 个 handler 无条件调用它
// (不读这个 flag)，禁用字段检查**永远生效**，不受这个开关值影响。这个开关唯一实际影响的两处：
// ① `logProtoSingleOperatorMode(...)` 打印哪一行启动期日志(纯观测性，不改变任何拦截行为)；
// ② `proto.wiring.test.mjs` 用它带出一整轮"显式设 PROTO_SINGLE_OPERATOR=1"的真实 spawn 测试
//    (为了在日志里断言那一行 LOUD 提示确实打印了)。下面 `logProtoSingleOperatorMode` 函数自己的
//    文档注释以前写"关掉这条额外的显式校验"——那句话是错的，已订正，不改这个函数的实现本身。

export const PROTO_SINGLE_OPERATOR = process.env.PROTO_SINGLE_OPERATOR === '1';

// 这些字段如果出现在请求体里，意味着调用方试图绕过"market_id 只能来自 proto_markets 已落表记录"
// 这条唯一合法路径，去指定一个外部/任意的市场身份或 bettor 身份——不管调用方是恶意探测还是纯粹
// 对协议理解有误，一律直接拒绝，不静默忽略（同 rejectRelayIdInBody 的既有纪律："请求体里携带这个
// 字段本身就是一个信号"）。
const FORBIDDEN_EXTERNAL_IDENTITY_FIELDS = [
  'covenant_id', 'market_covenant_id', 'shardleaf_txid', 'shardleaf_vout', // 外部指定"这是哪个市场"
  'bettor_pk', 'bettor_pubkey', 'bettor_privkey', // 外部指定"这是哪个 bettor"(v0 复用市场自己的 committee keypair, 见 proto.js 文件头注 Bettor 1354 裁定)
];

/**
 * @param {object} body  request.body
 * @returns {string|null}  非 null = 拒绝理由(调用方直接 400 这个字符串), null = 放行
 */
export function rejectExternalMarketIdentityInBody(body) {
  if (!body || typeof body !== 'object') return null;
  for (const field of FORBIDDEN_EXTERNAL_IDENTITY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      return `${field} must not be provided in the request body — proto v0 single-operator mode only recognizes market/bettor identity via server-side proto_markets records (path param market id), not caller-supplied identity fields`;
    }
  }
  return null;
}

/**
 * 启动期 LOUD 日志(index.js 调用一次，纯观测性，不是任何拦截逻辑的开关)。
 * 🔴 订正(2026-09-15, 账本1423): 旧注释"关闭这个开关...关掉这条额外的显式校验"是错的——
 * `rejectExternalMarketIdentityInBody(...)` 的禁用字段检查永远生效，不读 PROTO_SINGLE_OPERATOR
 * 这个值，这个函数只是打印哪一行日志字符串，不改变任何 handler 的实际拦截行为。
 */
export function logProtoSingleOperatorMode(log = console.log) {
  log(PROTO_SINGLE_OPERATOR
    ? '🔒 PROTO_SINGLE_OPERATOR=1: proto v0 端点只认 proto_markets 已落表的 market_id，外部市场/bettor 身份字段一律拒绝'
    : '⚠ PROTO_SINGLE_OPERATOR 未开启(非 "1")——启动日志不再显式提示这条纪律，但 rejectExternalMarketIdentityInBody 的禁用字段检查本身不受影响、始终生效');
}
