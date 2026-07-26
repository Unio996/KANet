import { getConfig } from '../data/settings/configs.js';
import { computeAllHealth } from '../services/agent-health.js';
import { dbPath } from '../db/client.js';
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { getRepoRoot } from '../lib/repo-root.mjs';
import { checkAdminSecretTier } from '../lib/admin-secret-tier.mjs';
import { computeLoadBearingDigest } from '../lib/load-bearing-digest.mjs';
import { RUNTIME_SCOPE_DIRS } from '../lib/runtime-scope-dirs.mjs';

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
  // B2(2026-07-25): git_commit 只证 repo HEAD, 证不了进程实际加载的字节(脏树启动后又被 revert
  // 干净/generated 文件等情形 git diff 看不出)。加逐文件 sha256 + tree digest, 在路由注册之前
  // 算好(Codex R2 原文明确要求 "captured before route registration")。dirty-state marker:
  // 若 RUNTIME_SCOPE_DIRS 范围内启动那刻就有未 commit 改动, 标 dirty=true——不阻止 Console
  // 启动(开发机脏树不该拒绝启动), 但 G5 gate③ 看到 dirty:true 必须直接 fail-closed 不可比对。
  let loadBearingDigest = null;
  try {
    const { treeDigest, fileCount } = computeLoadBearingDigest(ROOT, RUNTIME_SCOPE_DIRS);
    let dirty = false;
    try {
      const statusOut = execFileSync('git', ['status', '--porcelain', '--', ...RUNTIME_SCOPE_DIRS], { cwd: ROOT, encoding: 'utf8' });
      dirty = statusOut.trim() !== '';
    } catch { dirty = true; /* 查不清干净与否, 保守当脏处理, fail-closed 方向 */ }
    loadBearingDigest = { treeDigest, fileCount, dirty };
  } catch { /* best-effort, 见 db_stat 同款注释 */ }
  return {
    git_commit: gitCommit,
    db_path: dbPath,
    db_stat: dbStat, // {dev, ino} — 比纯路径字符串强一档(NTFS ino 也有效), 已知局限见下方端点注释
    load_bearing_digest: loadBearingDigest,
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
  // serving 那个进程"用, 见文件头 computeRuntimeIdentity 注释)。
  // 🔴 B1 加固(2026-07-25, Codex RESPONSE-20260725-G5-V2-COMMITTED-PARTIAL-CODEX-REVIEW B1,
  // team 三方审 GREEN): 原版零鉴权, 把"只有 loopback 调用方会用"这个信任完全托付给调用方自己
  // (G5 client 端检查 host), 服务端零防护——任何能连到 Console 的网络请求都能拿到 DB 绝对路径/
  // 进程 PID/启动时间/commit。改成服务端强制两层(镜像 operator-settle.js 既有 admin-tier +
  // IP allowlist 模式, 不新造机制): ① IP allowlist(默认 loopback-only) ② admin-secret tier
  // (专属 ADMIN_SECRET_RUNTIME_IDENTITY, 不复用其他端点的 secret)。
  // 已知局限(如实标注, 非隐藏): db_stat.{dev,ino} 是文件系统内唯一标识(比路径字符串强一档),
  // 但仍不覆盖 package.json/node_modules 依赖变更、不跨机器/跨挂载点比对(B2 补 load-bearing
  // digest 解决这块)。
  // 🔴 NWT 2026-07-25 review 抓到的机制性弱点, team 定案(NWT 最终改主意认同 Bettor, 见频道
  // 讨论): fastify 实例带 trustProxy:'127.0.0.1', 直连对端是 127.0.0.1 时 request.ip 会改读
  // X-Forwarded-For 头——单查 request.ip 不是 TCP 层意义上的"server-enforced loopback"。
  // operator-settle.js:44/tg-wallet diagnose:117 那两个既有同族端点有真实调用方+可能的反代
  // 场景负担, 改会牵动向后兼容, 留作触发条件待办(见设计文档)。但这个 runtime-identity 端点是
  // 本轮新增的, 除了本机跑的 G5 没有任何消费方, 零向后兼容负担——直接加 request.socket.
  // remoteAddress(TCP 层真对端, 不受 XFF 影响)双重校验, 成本≈零, 不依赖"现在没反代"这个环境
  // 假设。对 Codex 汇报口径: "服务端 IP allowlist(同时核 request.ip 和 TCP 层
  // socket.remoteAddress)+ 专属 admin-tier 鉴权"。
  fastify.get('/api/system/runtime-identity', async (request, reply) => {
    const ipAllowlist = (process.env.ADMIN_IP_ALLOWLIST || '127.0.0.1,::1,::ffff:127.0.0.1')
      .split(',').map((s) => s.trim());
    const remoteAddr = request.socket?.remoteAddress;
    if (!ipAllowlist.includes(request.ip) || !ipAllowlist.includes(remoteAddr)) {
      return reply.code(403).send({ ok: false, error: `runtime-identity: source IP(request.ip=${request.ip}, TCP remoteAddress=${remoteAddr}) 不在 ADMIN_IP_ALLOWLIST` });
    }
    const auth = checkAdminSecretTier(request, 'ADMIN_SECRET_RUNTIME_IDENTITY');
    if (!auth.ok) return reply.code(auth.code).send({ ok: false, error: auth.error });

    return reply.send(RUNTIME_IDENTITY);
  });
}
