// zk-prove-server.mjs — 独立的、最小化的 job-queue HTTP server, 只服务 zk-prove 相关路由。
// 见 docs/2026-07-06-zk-close-tick-production-wiring-design.md §2.1/§2.3。
//
// 不改动主 console 的 fastify 实例/HOST 绑定 — 这是一个独立的 Fastify 实例, 绑到 Tailscale
// 接口(或 0.0.0.0 + 防火墙只放行 Tailscale CIDR), 只跑这 3 个 endpoint, 风险面精确限定在新增
// 的这一小块, 不碰现有生产 API 面。
//
// 认证: bearer token (ZK_PROVE_SERVER_TOKEN, 存 kanet.env, 不进 git)。内网 agent 间调用, 非
// 面向公网用户, proportional threat model 不需要 mTLS。
import Fastify from 'fastify';
import { sqlite } from '../db/client.js';

const TOKEN = process.env.ZK_PROVE_SERVER_TOKEN;
const HOST = process.env.ZK_PROVE_SERVER_HOST || '100.99.147.101'; // Tailscale interface only, not 0.0.0.0
const PORT = Number(process.env.ZK_PROVE_SERVER_PORT || 3201);

export async function startZkProveServer() {
  if (!TOKEN) {
    console.warn('[zk-prove-server] ZK_PROVE_SERVER_TOKEN not set — server NOT started (fail-closed, not fail-open).');
    return null;
  }

  const app = Fastify({ logger: false });

  app.addHook('preHandler', async (request, reply) => {
    const auth = request.headers.authorization || '';
    if (auth !== `Bearer ${TOKEN}`) {
      reply.code(401).send({ error: 'unauthorized' });
    }
  });

  // settler 侧调用 (J2 机器自己调自己的 server)
  app.post('/zk-prove/enqueue', async (request, reply) => {
    const { marketId, orderedBets, betsRoot, attestedWinner } = request.body || {};
    if (!marketId || !Array.isArray(orderedBets)) {
      return reply.code(400).send({ error: 'marketId and orderedBets required' });
    }
    const existing = sqlite.prepare(
      "SELECT * FROM zk_prove_jobs WHERE market_id = ? AND status IN ('pending','in_progress')"
    ).get(marketId);
    if (existing) {
      return reply.send({ job: existing, created: false });
    }
    const info = sqlite.prepare(
      'INSERT INTO zk_prove_jobs (market_id, ordered_bets_json, bets_root_hex, attested_winner) VALUES (?, ?, ?, ?)'
    ).run(marketId, JSON.stringify(orderedBets), betsRoot ?? null, attestedWinner ?? null);
    const job = sqlite.prepare('SELECT * FROM zk_prove_jobs WHERE id = ?').get(info.lastInsertRowid);
    return reply.send({ job, created: true });
  });

  // J1 侧轮询 daemon 调 — 原子性地取一个 pending job 并标成 in_progress，防止并发轮询取到同一行
  app.get('/zk-prove/poll', async (request, reply) => {
    const job = sqlite.transaction(() => {
      const row = sqlite.prepare("SELECT * FROM zk_prove_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1").get();
      if (!row) return null;
      sqlite.prepare("UPDATE zk_prove_jobs SET status = 'in_progress', updated_at = datetime('now') WHERE id = ? AND status = 'pending'").run(row.id);
      return sqlite.prepare('SELECT * FROM zk_prove_jobs WHERE id = ?').get(row.id);
    })();
    return reply.send({ job: job || null });
  });

  // J1 侧调, proving 跑完后回填结果
  app.post('/zk-prove/complete', async (request, reply) => {
    const { jobId, receiptHex, journalDigestHex, error } = request.body || {};
    if (!jobId) return reply.code(400).send({ error: 'jobId required' });
    const row = sqlite.prepare('SELECT * FROM zk_prove_jobs WHERE id = ?').get(jobId);
    if (!row) return reply.code(404).send({ error: 'job not found' });
    if (error) {
      sqlite.prepare("UPDATE zk_prove_jobs SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?").run(String(error), jobId);
    } else {
      if (!receiptHex) return reply.code(400).send({ error: 'receiptHex required when error not set' });
      sqlite.prepare(
        "UPDATE zk_prove_jobs SET status = 'done', receipt_hex = ?, journal_digest_hex = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(receiptHex, journalDigestHex ?? null, jobId);
    }
    return reply.send({ ok: true });
  });

  await app.listen({ port: PORT, host: HOST });
  console.log(`[zk-prove-server] listening on ${HOST}:${PORT} (Tailscale-scoped, bearer-auth).`);
  return app;
}
