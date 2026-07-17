// sim-traffic-marker.mjs — 模拟流量标记凭证(2026-07-17, S1, KANet-UI)。
// 文件原名 test-harness-marker.mjs, 撞 .gitignore 的 `test-*.mjs` 规则(挡临时测试脚本用, 本文件
// 名字凑巧撞上前缀约定但实际是要入库的生产代码), 改名避免每次 add 都要 -f 强制。
// 设计 docs/2026-07-17-s1-support-cases-simulated-traffic-isolation-design.md(NWT红队GREEN,
// 0b46523f MUST-FIX x2 已折入 ee75914f, 复核GREEN 6ba63748)。
//
// 与 admin-secret-tier.mjs 物理独立(不 import/复用), 因为职责完全不同域: 那是生产管理权限分级,
// 这里唯一效果 = 允许当前请求把 execution_states.action_details.is_simulated 落库为 true,
// 不触碰任何资金/权限操作、不影响 H2 身份重校验/classifyEscalation/anchored 判定路径。
//
// fail-closed: 生产环境未配置 TEST_HARNESS_TOKEN 时, 任何带 X-Test-Harness-Token header 的请求
// 一律 403 拒绝(不静默放行, 不当成普通生产请求处理)——"想标记为模拟但环境不支持" != "当真实
// 流量处理"。没带 header = 正常生产请求路径, 不受影响, 返回 isSimulated:false。
//
// 常量时间比较(NWT MUST-FIX): provided !== secret 是时序侧信道, 猜中 token 能让真实钱类升级
// 工单被 is_simulated 标记吞掉转发(owner-bot.mjs pollFeedbackEscalations 会 continue 跳过)——
// 是 #7(伪造内容混进升级)方向相反的姊妹攻击, 必须同等严重度堵。写法逐字抄 54dd60d2
// ingest-auth.js isValidIngestSecret(先比长度短路再 timingSafeEqual, 长度不等不进
// timingSafeEqual 避免抛异常)。
import { timingSafeEqual } from 'crypto';

/**
 * @param {import('fastify').FastifyRequest} request
 * @returns {{isSimulated: true} | {isSimulated: false} | {ok: false, code: 403, error: string}}
 */
export function checkTestHarnessToken(request) {
  const provided = request.headers['x-test-harness-token'];
  if (!provided) return { isSimulated: false };
  const secret = process.env.TEST_HARNESS_TOKEN;
  if (!secret) return { ok: false, code: 403, error: 'test harness token 未配置' };
  try {
    const a = Buffer.from(provided), b = Buffer.from(secret);
    if (a.length === b.length && timingSafeEqual(a, b)) return { isSimulated: true };
  } catch { /* fall through to reject */ }
  return { ok: false, code: 403, error: 'test harness token 不匹配' };
}
