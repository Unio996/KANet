// M0c-1 provision 规则 regression — Codex v0.10 re-review 项②
// 背景: docs/2026-07-24-m0c1-pilot-comprehensive-defect-sweep.md A3 项落码后(m0c1-grant-provision.mjs
// commit cbec6837), Codex 要求留一份 regression 证据 artifact(非仅频道里贴一次手工测试输出) ——
// 真实调用 CLI(execFileSync 走 issue 子命令, 非 mock/非直调内部函数), 覆盖 --payee 强制规则的
// 正反两面 + 一条"不过度约束"的对照组, 产出 sanitized evidence JSON 供 Codex/未来审查者独立核对。
// 跑法(cwd=D:/kanet/kanet): node kasia-console/test-framework/cases/m0c1-gate/provision-payee-regression.mjs

import { existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const PROVISION = path.join(ROOT, 'kasia-console/scripts/m0c1-grant-provision.mjs');
const DB = path.join(ROOT, 'scratch/m0c1-provision-payee-regression.db');
const LOG_DIR = path.join(ROOT, 'logs/test-runs');

for (const f of [DB, DB + '-wal', DB + '-shm']) if (existsSync(f)) rmSync(f);
mkdirSync(LOG_DIR, { recursive: true });

let pass = 0, fail = 0;
const evidence = [];
function check(label, ok, detail) {
  if (ok) { pass++; console.log(`PASS ${label}`); }
  else { fail++; console.log(`FAIL ${label}${detail ? ' — ' + detail : ''}`); }
  evidence.push({ label, ok, detail: detail ? String(detail).slice(0, 500) : undefined });
}

/** 真实调用 provision CLI（execFileSync，非 mock/非直调内部函数），返回 {code, stdout, stderr}。 */
function runProvision(args) {
  try {
    const stdout = execFileSync('node', [PROVISION, ...args, '--db', DB], { encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() || '', stderr: e.stderr?.toString() || e.message };
  }
}

function xonlyHex() { return randomBytes(32).toString('hex'); }

async function main() {
  // provision 脚本自己幂等建表（openDb），不依赖 console 的 db/client.js —— 这里只用 better-sqlite3
  // 直连 DB 文件做旁路核对（不经 provision 脚本自身逻辑，独立验证 payee_scope 真值）。

  // ── ① custodial_transfer 不传 --payee → CLI 拒绝退出（非零 exit code），且不写库 ──
  {
    const appKeyId = 'regr-nopayeecmd-' + Date.now();
    const r = runProvision(['issue', '--app-key-id', appKeyId, '--app-pubkey', xonlyHex(),
      '--commands', 'custodial_transfer', '--relay', 'r1', '--network', 'testnet-12']);
    check('①custodial_transfer 不传 --payee → CLI 非零 exit code(拒绝签发)', r.code !== 0, `code=${r.code} stderr=${r.stderr}`);
    check('①stderr 精确提示"--payee 必传"(非泛泛报错)', /--payee 必传/.test(r.stderr), r.stderr);
    // 🔴 这是本轮跑的第一个 issue 调用, 若被拒在 openDb() 之前(设计意图), 连表都不会被建——
    // "表不存在"本身就是"没写库"的更强证据(不止这一行没写, 是整个签发流程连数据库连接都没碰),
    // 比"表存在但查不到这一行"更强。用 tableExists 显式区分两种情况, 避免 SqliteError 掩盖了
    // 这个更强的证据（未捕获异常会让脚本直接崩溃退出, 反而丢失了这条断言）。
    const tableExists = existsSync(DB) && (() => {
      const probe = new Database(DB, { readonly: true });
      const has = probe.prepare("SELECT count(*) AS cnt FROM sqlite_master WHERE type='table' AND name='m0c1_app_grants'").get().cnt > 0;
      probe.close();
      return has;
    })();
    if (!tableExists) {
      check('①DB 里确实没有这条 grant(拒绝发生在 openDb() 之前, 连表都未建——最强的"未写库"证据)', true, '(sqlite_master 里连 m0c1_app_grants 表都不存在)');
    } else {
      const db = new Database(DB, { readonly: true });
      const row = db.prepare('SELECT * FROM m0c1_app_grants WHERE app_key_id = ?').get(appKeyId);
      check('①DB 里确实没有这条 grant(拒绝时不写库, 非"写了但 payee_scope 为空")', !row, row ? JSON.stringify(row) : '(无行, 符合预期)');
      db.close();
    }
  }

  // ── ② custodial_transfer 传 --payee → CLI 正常签发, payee_scope 真值正确写入 ──
  {
    const appKeyId = 'regr-haspayee-' + Date.now();
    const payeeAddr = 'kaspatest:qregr0000000000000000000000000000000000000000000000000000';
    const r = runProvision(['issue', '--app-key-id', appKeyId, '--app-pubkey', xonlyHex(),
      '--commands', 'custodial_transfer', '--relay', 'r1', '--network', 'testnet-12', '--payee', payeeAddr]);
    check('②custodial_transfer 传 --payee → CLI exit code=0(正常签发)', r.code === 0, `code=${r.code} stderr=${r.stderr}`);
    const db = new Database(DB, { readonly: true });
    const row = db.prepare('SELECT payee_scope FROM m0c1_app_grants WHERE app_key_id = ?').get(appKeyId);
    check('②DB 里 payee_scope 真值 = JSON 数组含批准地址(非 NULL/非其他值)', row && JSON.parse(row.payee_scope).includes(payeeAddr),
      row ? row.payee_scope : '(无行)');
    db.close();
  }

  // ── ③ 非涉款命令(如 get_arm_status) 不传 --payee → 仍正常签发(不过度约束通用工具的对照组) ──
  {
    const appKeyId = 'regr-readonly-' + Date.now();
    const r = runProvision(['issue', '--app-key-id', appKeyId, '--app-pubkey', xonlyHex(),
      '--commands', 'get_arm_status', '--relay', 'r1', '--network', 'testnet-12']);
    check('③非涉款命令不传 --payee → CLI exit code=0(不误伤非涉款 grant)', r.code === 0, `code=${r.code} stderr=${r.stderr}`);
    const db = new Database(DB, { readonly: true });
    const row = db.prepare('SELECT payee_scope FROM m0c1_app_grants WHERE app_key_id = ?').get(appKeyId);
    check('③DB 里 payee_scope = NULL(该维度未授权, 非该维度不相关命令的错误值)', row && row.payee_scope === null, row ? String(row.payee_scope) : '(无行)');
    db.close();
  }

  // ── ④ 混合 commands(同时含涉款+非涉款) 不传 --payee → 仍要求 --payee(以最严命令为准, 非按多数豁免) ──
  {
    const appKeyId = 'regr-mixed-' + Date.now();
    const r = runProvision(['issue', '--app-key-id', appKeyId, '--app-pubkey', xonlyHex(),
      '--commands', 'get_arm_status,custodial_transfer', '--relay', 'r1', '--network', 'testnet-12']);
    check('④commands 混合涉款+非涉款、不传 --payee → 仍拒绝(以最严命令为准)', r.code !== 0, `code=${r.code} stderr=${r.stderr}`);
  }

  const logPath = path.join(LOG_DIR, 'm0c1-provision-payee-regression-latest.json');
  writeFileSync(logPath, JSON.stringify({
    source: 'docs/2026-07-24-m0c1-pilot-comprehensive-defect-sweep.md A3 + Codex v0.10 re-review 项②(regression evidence artifact)',
    target: 'kasia-console/scripts/m0c1-grant-provision.mjs issue 子命令 --payee 强制规则(commit cbec6837)',
    method: '真实调用 CLI(execFileSync, 非 mock/非直调内部函数) + DB 旁路核对 payee_scope 真值',
    summary: { pass, fail }, evidence,
  }, null, 2));
  console.log(`\nevidence log: ${logPath}`);
  console.log(`\n== provision --payee regression: PASS ${pass} / FAIL ${fail} ==`);
  for (const f of [DB, DB + '-wal', DB + '-shm']) if (existsSync(f)) { try { rmSync(f); } catch {} }
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('TEST ERROR', e); process.exit(1); });
