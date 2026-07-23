// M0c-1 机制A — HTTP 能力网关（G1 脚手架，批 G2 spec）
// 设计: docs/2026-07-23-m0c-1-mechanism-a-http-capability-gateway-design.md §3/§6
//
// 🔴 本批（G1，Codex `RESPONSE-...V02-CODEX-REREVIEW` 已放行）只落脚手架，不接任何钱路业务逻辑：
//   - wallet/transfer（custodial_transfer）BLOCKED（Codex 真洞，§3.3a 绑定器设计已定稿 GREEN，
//     待 J1 relay 侧落码 + Owner 定 Path A/B + Codex 对 §3.3a 具体机制新一轮 confirm，本批不激活）。
//   - 本文件路由存在但 default-off（feature-flag 关 → 503），不装载不改变现网行为。
//
// 🔴 v0.2 MUST-FIX（NWT `36a9d901`）fold 进本骨架两条硬约束（落码 diff 审重点）：
//   ① `ADMIN_CAPABILITY_GATEWAY_ENABLED` 默认 off（未设/!=1 → 503），与 relay armed 状态完全解耦——
//      不能靠"relay 还没 arm 所以网关裸着也没事"这种依赖对方的论证（比照 operator-settle.js:36-37 先例）。
//   ② 网关侧签名验证 MUST（非可选）——当某条能力路由真正接线业务逻辑时，签名验证必须是该路由早拒验
//      的强制步骤，不允许"relay 权威重验兜底所以网关可以省"这种设计（§3.2）。
//
// 🔴 origin='app' 唯一铸造点（§5 NWT 5 角度自答①）：本文件是全仓唯一允许对
//   `sendCommandAsync(..., 'app')` 发起调用的位置（当业务逻辑落地时）——lint 规则待补（§6 批 G2 计划项）。
//
// G1 单一真相源（Bettor DoD·防两份漂移）：结构校验复用 shared/lib/app-envelope-canonical.mjs
// 的 validateEnvelopeStructure（与 kasia-relay/src/lib/app-envelope.mjs 权威验证共用同一份定义）。
import { validateEnvelopeStructure, ENVELOPE_PROTOCOL, ENVELOPE_DOMAIN, ENVELOPE_VERSION } from '../../../shared/lib/app-envelope-canonical.mjs';

const GATEWAY_ENABLED = () => process.env.ADMIN_CAPABILITY_GATEWAY_ENABLED === '1';

// 能力路由登记表（§3.3 母卡：按业务能力命名，非裸 sendCommandAsync 透传，每路由绑死一个 intent_type）。
// 🔴 本批全部路由 handler 只做 ① feature-flag 检查（默认 off → 503，路由本身确实注册存在，不是
//   "路由都不存在"——404 和 503 是不同的诚实状态，本批要的是后者）② envelope 结构 early-reject
//   预览（证明共享库确实被消费，非只 import 不用）——不转发到 relay，不执行任何业务逻辑。
//   业务接线归后续批次（G3+，等 blocker 解除 + Path A/B 定案），本批 GATEWAY_ENABLED 恒为 false
//   （env 未设）= 零新增暴露面，与"路由不存在"在外部行为上不可区分（都是非 2xx），但内部脚手架
//   到位，为下一批（业务接线）铺路不需要重新设计路由骨架。
const CAPABILITY_ROUTES = Object.freeze([
  { path: '/api/capability/wallet/transfer', intentType: 'custodial_transfer' }, // BLOCKED 业务逻辑未接（§3.3a 待定稿落码），路由骨架存在+default-off
]);

export async function registerCapabilityRoutes(fastify) {
  for (const { path, intentType } of CAPABILITY_ROUTES) {
    fastify.post(path, async (request, reply) => {
      // ① feature-flag 默认 off，与 relay armed 状态解耦（v0.2 MUST-FIX，比照 operator-settle.js:36-37）
      if (!GATEWAY_ENABLED()) {
        return reply.code(503).send({ ok: false, error: `capability gateway disabled (ADMIN_CAPABILITY_GATEWAY_ENABLED != 1)` });
      }
      const env = request.body?.envelope;
      // ② 网关早拒验：结构 strict-reject（MUST，非可选，§3.2）——共享库单一真相源。
      const structErr = validateEnvelopeStructure(env);
      if (structErr) return reply.code(400).send({ ok: false, error: structErr });
      if (env.protocol !== ENVELOPE_PROTOCOL || env.domain !== ENVELOPE_DOMAIN || env.version !== ENVELOPE_VERSION) {
        return reply.code(400).send({ ok: false, error: 'envelope.protocol/domain/version 不匹配' });
      }
      if (env.intent_type !== intentType) {
        return reply.code(403).send({ ok: false, error: `本路由不接受命令 ${env.intent_type}（须 ${intentType}）` });
      }
      // 🔴 本批到此为止 — 业务接线（签名验证/grant scope/强制 origin='app'/转发 sendCommandAsync）
      // 归后续批次，等 §3.3a custodial 绑定器落码 + Owner Path A/B 定案 + Codex 新一轮 confirm。
      return reply.code(501).send({ ok: false, error: 'capability route scaffold only, business logic not wired (G1 batch)' });
    });
  }
}
