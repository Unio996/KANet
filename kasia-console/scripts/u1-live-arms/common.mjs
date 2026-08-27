// u1-live-arms/common.mjs — GREEN-at-live 八臂共用件(J2 2026-08-28 · Bettor 派 (B) · NWT GO · runbook v0.5 §4-bis L1–L8 · Codex MSG-285 回 5bf01a28 §5)
//
// 🔴 定位: 让 Owner 拍 D-005(v197/v198 迁移 + console 重启)之后, 八臂是"跑八条命令"而不是"现写"。**本目录任何脚本都不授权部署**。
// 🔴 写臂(L2/L3/L4/L5)默认 dry-run(只打印将做什么, 零 POST 零写); 只有 `--execute` 才 POST。**`--execute` 须 Owner D-005 GO 之后由 operator 跑**。
// 🔴 只读臂(L1/L7/L8)永不写; L6 是"POST 一个必被拒的跨网信封"(端点在事务外拒 ⇒ 零写入), 归只读列但仍走 HTTP, 头注写明。
// 🔴 库身份断言(C4 fix-up 198012ae 同三道 + (A) 617ea127 后 client.js 非 console 入口必须显式 DB_PATH): --db 默认 live 绝对路径, 打开后
//    断言 relay_nodes / u1_identity_challenge 存在且 relay_nodes 非空; 否则 FAIL "不像 live 库"。每份输出带 db 绝对路径(L8 = 阳性对照)。
// 🔴 输出统一 JSON 一行 { arm, verdict: PASS|FAIL|DRY, db, console_url, execute, utc, evidence, sha256 } + 落 --out-dir(默认 scratch/u1-live-arms/, gitignored)。
// 🔴 挑战签发仍走 scripts/u1-issue-challenge.mjs(不新增签发口); submission 由 scripts/u1-build-submission.mjs 生成(含 s10)。
//    L6 用的 mainnet 域签名件由 builder 以 KASPA_NETWORK=mainnet 生成【只为造反例】, 放 scratch 不入库(Bettor 条件)。
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

export const argv = process.argv.slice(2);
export const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
export const EXECUTE = argv.includes('--execute');
export const DB = resolve(arg('--db', 'D:/kanet-tn12/kasia-console/data/console.db'));
export const CONSOLE_URL = arg('--console-url', process.env.CONSOLE_URL || 'http://127.0.0.1:3200');
export const OUT_DIR = resolve(arg('--out-dir', 'D:/kanet-tn12/scratch/u1-live-arms'));
export const REGISTER_URL = `${CONSOLE_URL}/api/identity/u1-register`;
process.env.DB_PATH = DB;   // (A) 之后: 非 console 入口无 DB_PATH ⇒ client.js throw; 这里显式钉到 --db

export const S10_KEYS = ['domain', 'version', 'network', 'relayPubkeyXOnly', 'operation', 'epoch', 'signature'];
export const SUB_KEYS = ['relayId', 'rootXpub', 'identityIndex', 'identityPubkeyXOnly', 'challenge', 'signature', 's10'];

let _sqlite = null;
export async function openDb() {
  const { sqlite, dbPath } = await import('../../src/db/client.js');
  if (resolve(dbPath) !== DB) return fail('DB_OPEN', `client.js 打开的库(${dbPath})不是 --db 指定的(${DB})`);
  const has = (t) => !!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(t);
  if (!has('relay_nodes') || !has('u1_identity_challenge')) return fail('DB_IDENTITY', `${DB} 不像 live 库(缺 relay_nodes / u1_identity_challenge) —— 别信一个可能刚被静默建出来的空库`);
  if (sqlite.prepare('SELECT COUNT(*) c FROM relay_nodes').get().c === 0) return fail('DB_IDENTITY', `${DB} relay_nodes 为空 —— 不像 live 库`);
  _sqlite = sqlite;
  return sqlite;
}
export const hasTable = (sqlite, t) => !!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(t);
export const one = (sqlite, sql, ...p) => sqlite.prepare(sql).get(...p);
export const cnt = (sqlite, sql, ...p) => sqlite.prepare(sql).get(...p).c;
export const tableSql = (sqlite, t) => one(sqlite, "SELECT sql FROM sqlite_master WHERE type='table' AND name = ?", t)?.sql || null;

export function loadSubmission(path, { requireS10 = true } = {}) {
  if (!path) return fail('ARGS', '缺 --submission <file>(由 scripts/u1-build-submission.mjs --commit 生成)');
  const s = JSON.parse(readFileSync(resolve(path), 'utf8'));
  for (const k of SUB_KEYS) if (k !== 's10' && !(k in s)) return fail('SUBMISSION', `submission 缺 ${k}`);
  if (requireS10 && (!s.s10 || typeof s.s10 !== 'object')) return fail('SUBMISSION', 'submission 缺 s10(builder 须是 C4 之后版本)');
  const out = {}; for (const k of SUB_KEYS) if (k in s) out[k] = k === 's10' ? Object.fromEntries(S10_KEYS.filter((x) => x in s.s10).map((x) => [x, s.s10[x]])) : s[k];
  return out;
}
export async function addrKeyOf(address) {
  const k = await import('kaspa-wasm');
  return k.XOnlyPublicKey.fromAddress(new k.Address(String(address).trim())).toString();
}
export async function post(body) {
  const r = await fetch(REGISTER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  return { code: r.status, payload: await r.json().catch(() => null) };
}
export function snapshot(sqlite, relayId, challenge, addrKey) {
  return {
    a2_rows_relay: hasTable(sqlite, 'u1_identity_registration') ? cnt(sqlite, 'SELECT COUNT(*) c FROM u1_identity_registration WHERE relay_id = ?', relayId) : null,
    identity_rows_total: hasTable(sqlite, 'u1_relay_identity') ? cnt(sqlite, 'SELECT COUNT(*) c FROM u1_relay_identity') : null,
    identity_rows_key: hasTable(sqlite, 'u1_relay_identity') && addrKey ? cnt(sqlite, 'SELECT COUNT(*) c FROM u1_relay_identity WHERE relay_pubkey_xonly = ?', addrKey) : null,
    challenge_used_at: one(sqlite, 'SELECT used_at FROM u1_identity_challenge WHERE challenge = ?', challenge)?.used_at ?? null,
    challenge_exists: !!one(sqlite, 'SELECT 1 x FROM u1_identity_challenge WHERE challenge = ?', challenge),
  };
}
export const rollbackSql = (relayId, addrKey, challenge) => [
  `DELETE FROM u1_identity_registration WHERE relay_id = '${relayId}';`,
  `DELETE FROM u1_relay_identity        WHERE relay_pubkey_xonly = '${addrKey}';`,
  `DELETE FROM u1_identity_challenge   WHERE challenge = '${challenge}';`,
];
export function banner(arm) {
  if (EXECUTE) console.error(`🔴 ${arm} --execute: 写臂将真 POST 到 ${REGISTER_URL} —— 须 Owner D-005 GO(v197/v198 迁移 + console 重启)之后由 operator 跑; 本脚本不授权部署。`);
  else console.error(`🔵 ${arm} dry-run(未传 --execute): 只打印将做什么, 零 POST 零写入。`);
}
export function emit(arm, verdict, evidence) {
  const o = { arm, verdict, db: DB, console_url: CONSOLE_URL, execute: EXECUTE, utc: new Date().toISOString(), evidence };
  o.sha256 = createHash('sha256').update(JSON.stringify(o)).digest('hex');
  try { mkdirSync(OUT_DIR, { recursive: true }); writeFileSync(join(OUT_DIR, `${arm}-${o.utc.replace(/[:.]/g, '-')}.json`), JSON.stringify(o, null, 1)); } catch {}
  console.log(JSON.stringify(o));
  process.exit(verdict === 'FAIL' ? 1 : 0);
}
export function fail(code, reason, extra = {}) { return emit(currentArm, 'FAIL', { code, reason, ...extra }); }
export let currentArm = 'L?';
export const setArm = (a) => { currentArm = a; };
