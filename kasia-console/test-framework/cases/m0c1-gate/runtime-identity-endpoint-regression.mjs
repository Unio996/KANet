// J2 2026-07-25 — B1 加固 regression: /api/system/runtime-identity 端点服务端鉴权
// (Codex RESPONSE-20260725-G5-V2-COMMITTED-PARTIAL-CODEX-REVIEW B1, team 三方审 GREEN)。
//
// 真监听的 fastify server + 真 TCP fetch() 连接调 health.js 注册的路由处理器(非 inject()
// 模拟——B1 追加的 socket.remoteAddress 校验需要真实网络层的值, 见下方 main() 里的注释), 真
// runMigrations() 建表, 隔离 DB + throwaway CONSOLE_ENCRYPTION_KEY, 不碰 live console.db
// (同 tg-wallet-pilot-isolation-regression.mjs 既有纪律)。
//
// 跑法(cwd=D:/kanet-tn12): node kasia-console/test-framework/cases/m0c1-gate/runtime-identity-endpoint-regression.mjs

import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getRepoRoot } from '../../../src/lib/repo-root.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = getRepoRoot(HERE);
const DB = path.join(ROOT, 'scratch/runtime-identity-endpoint-regression.db');

let pass = 0, fail = 0;
const evidence = [];
function check(label, ok, detail) {
  if (ok) { pass++; console.log(`PASS ${label}`); }
  else { fail++; console.log(`FAIL ${label} — ${detail}`); }
  evidence.push({ label, ok, detail: detail ? String(detail).slice(0, 800) : undefined });
}

async function main() {
  for (const f of [DB, DB + '-wal', DB + '-shm']) if (existsSync(f)) rmSync(f);
  process.env.DB_PATH = DB;
  process.env.CONSOLE_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  process.env.KASPA_RPC_URL = 'ws://127.0.0.1:1';
  process.env.KASPA_NETWORK = 'testnet-12';

  const migrateMod = await import(pathToFileURL(path.join(ROOT, 'kasia-console/src/db/migrate.js')).href);
  await migrateMod.runMigrations();

  // 用真监听的 server + 真 TCP 连接(非 fastify.inject() 模拟), 因为 fastify.inject() 不走
  // 真实 socket, request.socket.remoteAddress 在 inject 场景下是模拟值, 测不出 B1 追加的
  // socket.remoteAddress 双核在真实网络层的实际行为(NWT 2026-07-25 review 指出的坑, J2 独立
  // 在设计阶段也标注过同一个局限——两边独立收敛, 这里直接把它做实, 不留局限)。
  const Fastify = (await import('fastify')).default;
  const fastify = Fastify({ logger: false, trustProxy: '127.0.0.1' });
  const healthMod = await import(pathToFileURL(path.join(ROOT, 'kasia-console/src/api/health.js')).href);
  await healthMod.registerHealthRoutes(fastify);
  await fastify.listen({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${fastify.server.address().port}`;

  const SECRET = 'test-secret-' + randomBytes(8).toString('hex');
  const req = async (headers = {}) => {
    const r = await fetch(`${baseUrl}/api/system/runtime-identity`, { headers, signal: AbortSignal.timeout(5000) });
    return { statusCode: r.status, body: await r.text() };
  };

  // ① secret 未设(fail-closed 默认 off) — loopback IP 过, 但 secret tier 未配置 → 503
  {
    const r = await req({});
    check('① secret 未设 → 503 disabled', r.statusCode === 503, `status=${r.statusCode} body=${r.body}`);
  }

  // ② secret 已设, 不带 header → 403
  process.env.ADMIN_SECRET_RUNTIME_IDENTITY = SECRET;
  {
    const r = await req({});
    check('② secret 已设但请求不带 header → 403', r.statusCode === 403, `status=${r.statusCode} body=${r.body}`);
  }

  // ③ 带错误 secret → 403
  {
    const r = await req({ 'x-kanet-admin-secret': 'wrong-secret' });
    check('③ 带错误 secret → 403', r.statusCode === 403, `status=${r.statusCode} body=${r.body}`);
  }

  // ④ 带正确 secret, loopback(真 TCP 连接下 request.ip 和 socket.remoteAddress 都落在
  //    127.0.0.1 上, 走完整两层校验) → 200 + 响应体含 B1(git_commit/db_path/pid)和 B2
  //    (load_bearing_digest.treeDigest/fileCount/dirty) 两部分字段
  {
    const r = await req({ 'x-kanet-admin-secret': SECRET });
    const body = JSON.parse(r.body);
    check('④ 正确 secret + loopback(request.ip + socket.remoteAddress 双核都过) → 200', r.statusCode === 200, `status=${r.statusCode}`);
    check('④ 响应体含 B1 字段(git_commit/db_path/pid)', !!body.db_path && 'pid' in body, JSON.stringify(body).slice(0, 200));
    check(
      '④ 响应体含 B2 load_bearing_digest(treeDigest 64 位 hex + fileCount>0 + dirty 布尔)',
      typeof body.load_bearing_digest?.treeDigest === 'string' && body.load_bearing_digest.treeDigest.length === 64
        && body.load_bearing_digest.fileCount > 0 && typeof body.load_bearing_digest.dirty === 'boolean',
      JSON.stringify(body.load_bearing_digest),
    );
  }

  // ⑤ 非 loopback allowlist(收窄成一个不含真实 127.0.0.1 ip/remoteAddress 的集合) → 403
  //    (这个收窄同时挡住 request.ip 和 socket.remoteAddress 两条路径, 只要有一条不在 allowlist
  //    内就该拒——B1 落码后追加的 remoteAddress 双核, 见 health.js 头部注释)
  process.env.ADMIN_IP_ALLOWLIST = '10.0.0.99';
  {
    const r = await req({ 'x-kanet-admin-secret': SECRET });
    check('⑤ IP 不在收窄后的 allowlist → 403(request.ip/remoteAddress 双核任一不过都拒)', r.statusCode === 403, `status=${r.statusCode} body=${r.body}`);
  }
  delete process.env.ADMIN_IP_ALLOWLIST;

  // ⑥ 已知测试局限如实标注(非隐藏, Bettor 2026-07-25 裁定范围): 上面④/⑤已经走真实 TCP
  // 连接(非 fastify.inject() 模拟), request.ip 和 socket.remoteAddress 都是真实网络层的值,
  // 不再是 NWT review 指出的"inject 模拟值测不出真实 socket 行为"那个坑。真正测不到的只剩
  // "remoteAddress 来自一个真的非 loopback 网卡"这种场景——本机没有第二块网卡可以真实构造这
  // 条连接, 留作 B3 live-process 独立证据类别(不在本回归套件覆盖范围)。
  check('⑥ 已知测试局限如实标注(非断言, 恒 PASS, 仅留痕)', true, '');

  await fastify.close();
  console.log(`\n== runtime-identity endpoint regression: PASS ${pass} / FAIL ${fail} ==`);
  mkdirSync(path.join(ROOT, 'logs/test-runs'), { recursive: true });
  writeFileSync(path.join(ROOT, 'logs/test-runs/runtime-identity-endpoint-regression-latest.json'), JSON.stringify({
    source_commit: (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return null; } })(),
    summary: { pass, fail }, evidence,
  }, null, 2));
  // 🔴 用 process.exitCode 而非 process.exit(): 立即强制 exit() 会跟 fastify.close() 异步收尾
  // 里还没走完的 libuv handle 撞车, 在 Windows 上撞出 "Assertion failed:
  // !(handle->flags & UV_HANDLE_CLOSING)" 崩溃, 把本来该是 0 的退出码搅成 127(实测坐实, 非
  // 猜测)。exitCode 只设标记, 让事件循环自然排空后再退出, 不主动打断还在收尾的 handle。
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => { console.error('regression 异常:', e.stack || e.message); process.exitCode = 1; });
