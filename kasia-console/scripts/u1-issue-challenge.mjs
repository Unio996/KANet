#!/usr/bin/env node
// u1-issue-challenge.mjs — §6-1 Track-A【operator 手工】挑战签发(报备层 · 2026-08-27 · J2)
//
// 🔴 定位(COORD-LEDGER (527)(528) 终裁): 自动签发口 = 北极星功能, 当前【不部署】; Track-A 注册保持 operator 驱动,
//    本脚本就是那个"operator 手工挑战"。它不是 HTTP 端点、不常驻、不被任何 cron 调用; 部署自动签发口的闸绑死 §10。
// 🔴 默认【只读 dry-run】: 不写库。只有 --commit 才 INSERT; 写之前先扫并清理孤儿(未用且已过期), 合 (529) Codex MUST-FIX
//    「E2E harness 活挑战复用前修」—— 签发前表里不留任何过期未用的活挑战。
// 🔴 幂等: 表里已有【未用且未过期】的活挑战 ⇒ 不再签, 原样返回既有那条。
//    ⚠ v197 表只有 (challenge, used_at, expires_at), 没有 relay_id 列 —— (527) 裁 (i) 纯 nonce 当前, relay 绑定 = 北极星前审计增强(ii)。
//    ⇒ 幂等只能做到【全表级】(一次只允许一条活挑战在飞), 不是 per-relay。对 operator 驱动、一次一注册的 Track-A 这是对的粒度;
//    别把它读成 per-relay 幂等。
// 🔴 过期判据同源: 注册侧判 `expiresAt <= now ⇒ CHALLENGE_EXPIRED`(u1-registration.mjs 事务内重读), 本脚本写 expires_at = now + ttl,
//    ttl 是【签发策略参数】—— u1-registration.mjs 里没有 TTL 常量可引(它只裁"过期与否", 不裁"多久过期"), 所以 --ttl-ms 显式给,
//    默认 10 分钟, 值待 NWT 审定; 不在这里另造一个假装"同源"的常量。
// 🔴 表/relay 的存在性与托管形态检查, 一律复用生产谓词(createChallengeStore 工厂 / deriveCustody), 不另写。
//
// 用法(在 kasia-console 目录下):
//   node scripts/u1-issue-challenge.mjs --relay <relay_id>                 # dry-run: 只报告, 零写入
//   node scripts/u1-issue-challenge.mjs --relay <relay_id> --commit        # 真签发(先清孤儿, 再幂等检查, 再 INSERT)
//   可选: --ttl-ms 300000  --db D:/kanet-tn12/kasia-console/data/console.db  --json
// 🔴 常驻约束(NWT 审定): 本脚本【永不】接 HTTP route / cron / daemon; 任何把它 wrap 成端点或定时任务的改动 = 自动签发口 = §10-gated, 须先报备。
// 🔴 输出里的 challenge 在被消费(used_at 置非空)之前是【活 bearer token】: 不贴频道、不进持久证据; 消费后 inert 才可入证据。
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const COMMIT = argv.includes('--commit');
const JSON_OUT = argv.includes('--json');
const RELAY = arg('--relay', '');
// TTL 默认 5 min(NWT 审定: 活 nonce 的 TTL 窗 = ⑦ 抢注暴露窗, 越短越保守; operator 需要时 --ttl-ms 临时加, clamp 60s..60min)
const TTL_MS = Number(arg('--ttl-ms', '300000'));
const DB = arg('--db', 'D:/kanet-tn12/kasia-console/data/console.db');

const out = (o) => console.log(JSON_OUT ? JSON.stringify(o) : Object.entries(o).map(([k, v]) => `  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n'));
const die = (m, code = 2) => { console.error(`🔴 ${m}`); process.exit(code); };

if (!RELAY) die('用法: --relay <relay_id> [--commit] [--ttl-ms N] [--db path] [--json]');
if (!Number.isFinite(TTL_MS) || TTL_MS < 60_000 || TTL_MS > 3_600_000) die(`--ttl-ms 必须在 60000..3600000 之间(得到 ${TTL_MS}); 太短 E2E 跑不完, 太长 = 活挑战窗口过大`);
if (!existsSync(DB)) die(`DB 不存在: ${DB}`);

// 🔴 M0a 门: kasia-console/scripts 不许新增裸 better-sqlite3 import。照 u1-v197-migration-acceptance.mjs 的写法:
//    import 前把 DB_PATH 指到目标库, 再动态 import 生产 client 拿 handle(同一个 handle 也正是 createChallengeStore 要绑的那个)。
//    代价: client.js 打开的是读写连接 ⇒ "dry-run 零写入"由【代码路径不含任何 INSERT/DELETE, 除非 --commit】保证, 不再靠 readonly 标志。
process.env.DB_PATH = resolve(DB);
const { sqlite, dbPath } = await import('../src/db/client.js');
if (resolve(dbPath) !== resolve(DB)) die(`client.js 打开的库(${dbPath})不是 --db 指定的(${DB}) — 停`);
const { createChallengeStore, CANONICAL_CHALLENGE_TABLE } = await import('../src/lib/u1-challenge-store.mjs');
const { deriveCustody } = await import('../src/lib/u1-registration.mjs');
const T = CANONICAL_CHALLENGE_TABLE;
const now = Date.now();
const report = { mode: COMMIT ? 'COMMIT' : 'DRY-RUN(零写入)', db: DB, table: T, relay: RELAY, now_iso: new Date(now).toISOString(), ttl_ms: TTL_MS };

// ① 表存在性: 用生产工厂的同一条校验(表缺即 throw), 不另写 SELECT sqlite_master
try { createChallengeStore(sqlite, T); report.table_check = 'ok(createChallengeStore 工厂同款校验)'; }
catch (e) { die(`挑战表不可用(与注册端点 503 同因): ${e.message}`); }

// ② relay 存在 + 托管形态: 复用 deriveCustody(N4-bis 谓词), 混合态/privkey-only/不存在 ⇒ 注册必拒 ⇒ 不给它签
const custody = deriveCustody(sqlite, RELAY);
if (!custody.ok) die(`relay 不合注册前置(deriveCustody): ${custody.code} — ${custody.reason}; 注册端点会拒同一原因, 不签发`);
report.relay_custody = custody.custody;
const relayRow = sqlite.prepare('SELECT id, name, address FROM relay_nodes WHERE id = ?').get(RELAY);
report.relay_name = relayRow?.name; report.relay_address = relayRow?.address;

// ③ 基线: 三表行数(runbook 要求 0 基线; 非 0 不阻塞脚本, 但打印让 operator 判)
report.baseline_rows = {
  u1_identity_challenge: sqlite.prepare(`SELECT COUNT(*) n FROM ${T}`).get().n,
  u1_identity_registration: sqlite.prepare('SELECT COUNT(*) n FROM u1_identity_registration').get().n,
  u1_domain_assignment: (() => { try { return sqlite.prepare('SELECT COUNT(*) n FROM u1_domain_assignment').get().n; } catch { return 'ABSENT'; } })(),
};

// ④ 孤儿 = 未用 ∧ 已过期。(529) MUST-FIX: 活挑战复用前先清。dry-run 只列, --commit 才 DELETE。
const orphans = sqlite.prepare(`SELECT challenge, expires_at FROM ${T} WHERE used_at IS NULL AND expires_at <= ?`).all(now);
report.orphans_unused_expired = orphans.map(r => ({ challenge: r.challenge.slice(0, 12) + '…', expired_ago_s: Math.round((now - r.expires_at) / 1000) }));
let cleaned = 0;
if (COMMIT && orphans.length) {
  cleaned = sqlite.prepare(`DELETE FROM ${T} WHERE used_at IS NULL AND expires_at <= ?`).run(now).changes;
}
report.orphans_cleaned = COMMIT ? cleaned : `(dry-run, 将清理 ${orphans.length})`;

// ⑤ 幂等: 已有【未用 ∧ 未过期】活挑战 ⇒ 返回既有, 不再签
const live = sqlite.prepare(`SELECT challenge, expires_at FROM ${T} WHERE used_at IS NULL AND expires_at > ? ORDER BY expires_at DESC`).all(now);
if (live.length) {
  report.result = 'EXISTING-LIVE-CHALLENGE(幂等: 不再签)';
  report.live_count = live.length;
  report.challenge = live[0].challenge; report.expires_at = live[0].expires_at; report.expires_in_s = Math.round((live[0].expires_at - now) / 1000);
  if (live.length > 1) report.warn = `表里有 ${live.length} 条活挑战 —— Track-A 应一次一条, 请先查清再用`;
  out(report); process.exit(0);
}

// ⑥ 签发: 32B 随机 hex(与测试/验收探针同形), PK 天然唯一
const challenge = randomBytes(32).toString('hex');
const expiresAt = now + TTL_MS;
if (COMMIT) {
  const tx = sqlite.transaction(() => {
    // 写锁内再核一次"仍无活挑战"(与 dry-run 读之间可能被别的 operator 插入)
    const again = sqlite.prepare(`SELECT COUNT(*) n FROM ${T} WHERE used_at IS NULL AND expires_at > ?`).get(Date.now()).n;
    if (again) throw new Error(`写锁内发现已有 ${again} 条活挑战, 放弃签发(幂等)`);
    sqlite.prepare(`INSERT INTO ${T} (challenge, used_at, expires_at) VALUES (?, NULL, ?)`).run(challenge, expiresAt);
  });
  try { tx.immediate(); } catch (e) { die(`签发失败: ${e.message}`); }
  report.result = 'ISSUED';
} else {
  report.result = 'WOULD-ISSUE(dry-run, 未写入)';
}
report.challenge = challenge; report.expires_at = expiresAt; report.expires_at_iso = new Date(expiresAt).toISOString();
report.next = `把 challenge 交给 submission 构造步骤(runbook §4 步 3); 注册 POST 必须在 ${new Date(expiresAt).toISOString()} 前完成, 否则 CHALLENGE_EXPIRED, 需重新签发(旧的会在下次运行时作为孤儿被清)`;
out(report);
