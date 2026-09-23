// tokens.js — KCC-20 代币定义 API(从 proto.js 搬出, Bettor 2026-09-23T06-53Z 派工·D-017 授权的 KCC-20
//   代币机制的一部分，已在主网真实结算过一次·市场 a59c7b48)。
// 纯 DB(proto_token_defs)，不上链，不产生任何可花费余额；只迁移，逻辑与 proto.js 原版逐字节相同。
// 页面路由 GET /tokens、GET /tokens/create(渲染 .eta)留在 index.js 原处不动，本文件只提供它们调用的
// 两条 API：POST /api/tokens/create、GET /api/tokens。

import { sqlite } from '../db/client.js';
import { randomUUID } from 'node:crypto';

const nowIso = () => new Date().toISOString();

// proto.js 的 PUBLIC_TOKEN_DEF_COLS 同款列清单(永不 SELECT *——同一条 MUST 在这里独立复制一份，不跨
// 文件依赖 proto.js，避免这个新位置将来又被 proto-v0 删除清单牵连)。
const PUBLIC_TOKEN_DEF_COLS = 'id, name, ticker, description, default_denomination, created_at';

export async function registerTokenRoutes(fastify) {
  fastify.post('/api/tokens/create', async (request, reply) => {
    const { name, ticker, faceValue, description } = request.body || {};
    if (!name?.trim()) return reply.code(400).send({ ok: false, error: 'name required' });
    if (!ticker?.trim()) return reply.code(400).send({ ok: false, error: 'ticker required' });
    const id = randomUUID();
    const ts = nowIso();
    sqlite.prepare(`
      INSERT INTO proto_token_defs (id, name, ticker, description, default_denomination, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name.trim(), ticker.trim(), description || null, Number.isFinite(Number(faceValue)) ? Number(faceValue) : null, ts);
    return reply.send({ ok: true, id, name: name.trim(), ticker: ticker.trim(), created_at: ts });
  });

  fastify.get('/api/tokens', async (request, reply) => {
    const rows = sqlite.prepare(`SELECT ${PUBLIC_TOKEN_DEF_COLS} FROM proto_token_defs ORDER BY created_at DESC`).all();
    return reply.send({ ok: true, tokens: rows });
  });
}
