import { getConfig } from '../data/settings/configs.js';
import { computeAllHealth } from '../services/agent-health.js';
import { dbPath } from '../db/client.js';
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { getRepoRoot } from '../lib/repo-root.mjs';

// M0c-1 G5 real_chain smoke P0-2（Codex RESPONSE-20260725-MSG131）: runtime identity self-report.
// 这个进程自己在启动这一刻算一次 git_commit + db 的 {dev,ino}（不是每次请求现查——目的是证"这个
// 进程实际在跑哪份代码/连的是哪份 db 文件", 进程启动后 working tree 再被后续 commit 改动不该污染
// 这个读数, 缓存值才是真正对应 runtime 行为的锚点）。零鉴权只读零副作用, 但只在 loopback 场景暴露
// 有意义（调用方自己决定是否只信 loopback 请求的响应）。
// KANet-UI 2026-07-25 抓 bug(现已根治): 原来这里硬编码'../../..'数层数, 照抄 G5 的 4 层深模式
// 但这个文件只 3 层深, 跳到 repo 外(D:\ 本身), 导致 git rev-parse 静默失败(catch{} best-effort)
// 返回 null。这类"每个文件各自数斜杠"的 bug 这轮连撞两次(health.js + reconcile 脚本), 改用
// getRepoRoot() 共享 helper(向上 walk 找 .git 目录, 不需要硬编码深度)根治整类问题。
const ROOT = getRepoRoot(dirname(fileURLToPath(import.meta.url))); // D:/kanet-tn12
// 模块加载时(进程启动早期, import 这个文件那一刻)立即算一次, 非等第一次请求才算——
// 精确对应"这个进程从哪个 commit / 哪个 db 文件启动"这个事实, 全进程生命周期不变。
function computeRuntimeIdentity() {
  let gitCommit = null;
  try { gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { /* best-effort */ }
  let dbStat = null;
  try { const s = statSync(dbPath); dbStat = { dev: s.dev, ino: s.ino }; } catch { /* best-effort */ }
  return {
    git_commit: gitCommit,
    db_path: dbPath,
    db_stat: dbStat, // {dev, ino} — 比纯路径字符串强一档(NTFS ino 也有效), 已知局限见下方端点注释
    pid: process.pid,
    started_at: new Date().toISOString(),
  };
}
const RUNTIME_IDENTITY = computeRuntimeIdentity();

export async function registerHealthRoutes(fastify) {
  fastify.get('/health', async (request, reply) => {
    return reply.send({ ok: true, ts: new Date().toISOString() });
  });

  // Returns the ingest secret for display during setup
  fastify.get('/api/ingest-secret', async (request, reply) => {
    const secret = await getConfig('ingest_secret');
    const hint = secret ? secret.slice(0, 8) + '...' : null;
    return reply.send({ hint, configured: !!secret });
  });

  // Agent health monitor — per-agent traffic light status
  // Cached 30s, safe to poll at 60s intervals from UI
  fastify.get('/api/health/agents', async (request, reply) => {
    try {
      const data = await computeAllHealth();
      return reply.send(data);
    } catch (err) {
      console.error('[health] agent health error:', err.message);
      return reply.code(500).send({ error: 'health_check_failed' });
    }
  });

  // LLM upstream health — alive (port reachable) vs functioning (200 OK on probe).
  // KI-16 sediment: agent-health adapter=green hides upstream LLM silent crash. Probe :8000 + :4000 directly.
  fastify.get('/api/system/llm-health', async (request, reply) => {
    async function probe(url) {
      const out = { alive: false, functioning: false, latency_ms: null };
      const t0 = Date.now();
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
        out.alive = true;
        out.latency_ms = Date.now() - t0;
        out.functioning = res.ok;
      } catch {}
      return out;
    }
    const llama = await probe('http://127.0.0.1:8000/health');
    const litellm = await probe('http://127.0.0.1:4000/health/liveliness');
    const overall = llama.functioning && litellm.functioning
      ? 'green'
      : (llama.alive || litellm.alive ? 'yellow' : 'red');
    return reply.send({
      ts: new Date().toISOString(),
      llama_server: llama,
      litellm,
      overall,
    });
  });

  // M0c-1 G5 real_chain smoke P0-2: 进程自证身份(供 external harness 独立证明"打的是真在
  // serving 那个进程"用, 见文件头 computeRuntimeIdentity 注释)。零鉴权只读——只在调用方自己
  // 强制 loopback-only 时才有身份证明意义(本端点不做 host 校验, 那是调用方的责任)。
  // 已知局限(如实标注, 非隐藏): db_stat.{dev,ino} 是文件系统内唯一标识(比路径字符串强一档),
  // 但仍不覆盖 package.json/node_modules 依赖变更、不跨机器/跨挂载点比对。
  fastify.get('/api/system/runtime-identity', async (request, reply) => {
    return reply.send(RUNTIME_IDENTITY);
  });
}
