// coord-status.js — D-010 落地①(J1tn, 2026-07-10): coord-status 内容签名 admin endpoint。
//
// 签名本身复用既有 relay IPC 命令 `ecdsa_sign`(kasia-relay/src/relay.mjs, Phase 4a 已有,
// 底层是 kaspa-wasm signMessage=schnorr,历史命名"ecdsa"是遗留误命名——本文件不新增 relay 侧
// 逻辑, 只是把"算 blake2b(content) → 调 ecdsa_sign → 拼 SIG: 行"这个流程接一个 admin 入口,
// 免得 Bettor 每次手写脚本。auth 镜像 zk-close-v2 端点(ADMIN_SECRET+IP allowlist+env 开关默认
// OFF), 因为这条路径最终会触碰 relay 私钥签名操作, 按同等敏感度处理。
import { sendCommandAsync } from '../services/relay-manager.js';
import { computeContentHashHex, buildSignedMessage } from '../lib/coord-status-sign.mjs';

export async function registerCoordStatusRoutes(fastify) {
  // POST /api/admin/coord-status/sign { content, relayId }
  fastify.post('/api/admin/coord-status/sign', async (request, reply) => {
    if (process.env.ADMIN_COORD_STATUS_SIGN_ENABLED !== '1') {
      return reply.code(503).send({ ok: false, error: 'admin endpoint disabled (ADMIN_COORD_STATUS_SIGN_ENABLED != 1)' });
    }
    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret) return reply.code(503).send({ ok: false, error: 'admin endpoint disabled (ADMIN_SECRET env 未设)' });
    const provided = request.headers['x-kanet-admin-secret'];
    if (!provided || provided !== adminSecret) {
      return reply.code(403).send({ ok: false, error: 'admin auth fail (X-KANet-Admin-Secret 缺失/不匹配)' });
    }
    const ipAllowlist = (process.env.ADMIN_IP_ALLOWLIST || '127.0.0.1,::1,::ffff:127.0.0.1').split(',').map(s => s.trim());
    if (!ipAllowlist.includes(request.ip)) {
      return reply.code(403).send({ ok: false, error: `admin auth fail (source IP ${request.ip} 不在 ADMIN_IP_ALLOWLIST)` });
    }
    const { content, relayId } = request.body || {};
    if (!content || !relayId) return reply.code(400).send({ ok: false, error: 'content, relayId 全部必需' });
    try {
      const hashHex = computeContentHashHex(content);
      const signResult = await sendCommandAsync(relayId, { type: 'ecdsa_sign', message: hashHex });
      if (!signResult?.signature) return reply.code(502).send({ ok: false, error: 'relay ecdsa_sign returned empty signature' });
      const signedMessage = buildSignedMessage(content, signResult.signature);
      return reply.send({ ok: true, hashHex, signature: signResult.signature, signedMessage });
    } catch (e) {
      return reply.code(500).send({ ok: false, error: e.message });
    }
  });
}
