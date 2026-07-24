// M0c-1 reviewed helper(scripts/m0c1-pilot-custodial-insert.mjs) regression — MF2 步骤4
// 设计: scratch/j2-reviewed-helper-design.txt(Bettor+NWT+KANet-UI 三人红队 GREEN 批落码)
// 真实调用 CLI（execFileSync spawn 子进程 + stdin 管道喂 mnemonic, 非 mock/非直调内部函数）。
// 跑法(cwd=D:/kanet/kanet): node kasia-console/test-framework/cases/m0c1-gate/pilot-custodial-insert-regression.mjs

import { existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { decrypt } from '../../../src/services/crypto.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const HELPER = path.join(ROOT, 'kasia-console/scripts/m0c1-pilot-custodial-insert.mjs');
const DB = path.join(ROOT, 'scratch/m0c1-pilot-custodial-insert-regression.db');
const LOG_DIR = path.join(ROOT, 'logs/test-runs');
const NETWORK = 'testnet-12';

for (const f of [DB, DB + '-wal', DB + '-shm']) if (existsSync(f)) rmSync(f);
mkdirSync(LOG_DIR, { recursive: true });
mkdirSync(path.dirname(DB), { recursive: true });

// 🔴 顺序 load-bearing: DB_PATH 必须在任何 db/client.js 触发导入之前设好(同 G4 harness 纪律)。
process.env.DB_PATH = DB;
process.env.CONSOLE_ENCRYPTION_KEY = randomBytes(32).toString('hex'); // throwaway, 仅本次测试用

let pass = 0, fail = 0;
const evidence = [];
function check(label, ok, detail) {
  if (ok) { pass++; console.log(`PASS ${label}`); }
  else { fail++; console.log(`FAIL ${label}${detail ? ' — ' + detail : ''}`); }
  evidence.push({ label, ok, detail: detail ? String(detail).slice(0, 500) : undefined });
}

/** 真实调用 helper CLI（execFileSync 语义, spawnSync 便于喂 stdin），mnemonic 走 stdin 管道
 * （非 CLI 参数, 同 helper 设计的暴露面收窄——测试也遵守同款喂法纪律, 不用 echo）。 */
function runHelper(args, mnemonic) {
  const r = spawnSync('node', [HELPER, ...args, '--db', DB],
    { input: mnemonic + '\n', encoding: 'utf8', env: process.env });
  return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// 测试用 mnemonic（合法 BIP39 12 词, 非任何真实密钥, 仅测试隔离环境用）。两条不同词组避免
// 跨 test case 共享同一 DB 时因 kaspa_address UNIQUE 约束互相打架(①④各用各的地址, 非同一条)。
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const TEST_MNEMONIC_2 = 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above';

async function main() {
  // 跟 helper 用同一份 reviewed 实现(kasia-console/src/services/wallet.js)独立派生测试地址,
  // 保证测试断言的"期望值"跟 helper 内部逻辑用的是同一个函数, 非另一套猜测实现。
  const consoleWallet = await import((await import('node:url')).pathToFileURL(
    path.join(ROOT, 'kasia-console/src/services/wallet.js')).href);
  const testAddress = consoleWallet.addressFromMnemonic(TEST_MNEMONIC, NETWORK);
  const testAddress2 = consoleWallet.addressFromMnemonic(TEST_MNEMONIC_2, NETWORK);

  // 建表：走 kasia-console/src/db/migrate.js 的 runMigrations()（跟 G4 harness 同一模式）,
  // 非本测试文件自己开写连接 CREATE TABLE——test-fixture capability 的静态限制要求这个文件
  // 内全部 new Database() 调用都是 readonly:true, 写操作交给正规 migrate 流程或 helper 本身。
  const migrateMod = await import(pathToFileURL(path.join(ROOT, 'kasia-console/src/db/migrate.js')).href);
  await migrateMod.runMigrations();

  // ── ① 候选地址匹配 → 正常插入 + readback PASS + DB 行内容正确 ──
  {
    const tgUserId = 'j2-regr-match-' + Date.now();
    const r = runHelper(['insert', '--tg-user-id', tgUserId, '--approved-address', testAddress, '--network', NETWORK], TEST_MNEMONIC);
    check('①候选地址匹配 → CLI exit code=0', r.code === 0, `code=${r.code} stderr=${r.stderr}`);
    check('①stdout 报告 readback 验证 PASS', /readback 验证: PASS/.test(r.stdout), r.stdout);
    const db = new Database(DB, { readonly: true });
    const row = db.prepare('SELECT * FROM tg_custodial_wallets WHERE tg_user_id = ?').get(tgUserId);
    check('①DB 行存在且 address 精确匹配', row && row.kaspa_address === testAddress, row ? row.kaspa_address : '(无行)');
    // 独立解密验证（不信 helper 自己的 readback 断言，测试脚本自己再解密+派生一次核对，
    // 用同一份 reviewed crypto.js/wallet.js，非另一套猜测实现）。
    if (row) {
      const decrypted = decrypt(row.mnemonic_encrypted);
      const rederived = consoleWallet.addressFromMnemonic(decrypted, NETWORK);
      check('①独立解密+重新派生地址与批准值一致(不信 helper 自己的 readback 断言)',
        rederived === testAddress, rederived);
    }
    db.close();
  }

  // ── ② 候选地址不匹配（③拦截）→ 非零 exit code + DB 不写入 ──
  {
    const tgUserId = 'j2-regr-mismatch-' + Date.now();
    const wrongAddress = 'kaspatest:qwrongaddr00000000000000000000000000000000000000000000000';
    const r = runHelper(['insert', '--tg-user-id', tgUserId, '--approved-address', wrongAddress, '--network', NETWORK], TEST_MNEMONIC);
    check('②候选地址不匹配 → CLI 非零 exit code(abort)', r.code !== 0, `code=${r.code} stderr=${r.stderr}`);
    check('②stderr 精确提示地址不匹配(非泛泛报错)', /派生地址.*!=.*approved-address/.test(r.stderr), r.stderr);
    const db = new Database(DB, { readonly: true });
    const row = db.prepare('SELECT * FROM tg_custodial_wallets WHERE tg_user_id = ?').get(tgUserId);
    check('②DB 里确实没有这条 wallet(abort 时不写库)', !row, row ? JSON.stringify(row) : '(无行, 符合预期)');
    db.close();
  }

  // ── ③ tg_user_id 占位符（②拦截）→ 拒绝 ──
  {
    const r = runHelper(['insert', '--tg-user-id', 'blank', '--approved-address', testAddress, '--network', NETWORK], TEST_MNEMONIC);
    check('③tg_user_id=占位符"blank" → CLI 非零 exit code(拒绝)', r.code !== 0, `code=${r.code} stderr=${r.stderr}`);
    check('③stderr 精确提示占位符非法(非泛泛报错)', /占位符/.test(r.stderr), r.stderr);
  }

  // ── ④ tg_user_id 重复 → 拒绝, 给出明确提示(友好报错先于 PK 约束报错, NWT 核实过④只是
  // 友好报错非安全边界——真防线是 tg_user_id PRIMARY KEY 约束本身)──
  {
    const tgUserId = 'j2-regr-dup-' + Date.now();
    const first = runHelper(['insert', '--tg-user-id', tgUserId, '--approved-address', testAddress2, '--network', NETWORK], TEST_MNEMONIC_2);
    check('④首次插入(为重复测试铺垫) → exit code=0', first.code === 0, `code=${first.code} stderr=${first.stderr}`);
    const dup = runHelper(['insert', '--tg-user-id', tgUserId, '--approved-address', testAddress2, '--network', NETWORK], TEST_MNEMONIC_2);
    check('④同 tg_user_id 重复插入 → CLI 非零 exit code(拒绝)', dup.code !== 0, `code=${dup.code} stderr=${dup.stderr}`);
    check('④stderr 精确提示已存在(友好报错先于 PK 约束报错)', /已存在于 tg_custodial_wallets/.test(dup.stderr), dup.stderr);
  }

  // ── ⑤ --network typo(NWT 红队发现④) → CLI 拒绝退出, 不进 getNetworkType() 的 mainnet-default
  // 分支(不到 addressFromMnemonic 那步, 更不会碰 DB) ──
  {
    const r = runHelper(['insert', '--tg-user-id', 'j2-regr-nettypo-' + Date.now(), '--approved-address', testAddress, '--network', 'testnet12'], TEST_MNEMONIC);
    check('⑤--network 打错("testnet12"漏横杠) → CLI 非零 exit code(白名单拒绝)', r.code !== 0, `code=${r.code} stderr=${r.stderr}`);
    check('⑤stderr 精确提示不在允许集合(非泛泛报错, 证明真是白名单挡的非其他原因)', /不在允许集合/.test(r.stderr), r.stderr);
  }

  // ── ⑥ 非法 mnemonic 错误路径的 TAINT(NWT 红队发现⑤) → e.message 恒 undefined, String(e)
  // 只含失败原因描述(checksum 数字等), 从不回显原始输入——实测验证, 非假设。用无意义乱码词
  // (非真实英文单词, 避免跟"mnemonic 派生地址失败"这类通用错误文案本身固有词汇撞词造成假阳性
  // ——比如若用真实单词"mnemonic"/"valid"当输入片段, 扫描会命中我们自己错误文案模板里同样出现
  // 的这些通用词, 那不是泄露输入, 是文案本身的固有词汇, 逐词扫描前先摸清这个坑) ──
  {
    const illegalMnemonic = 'zzqxpp wqrpxk nzzy77a uniqtok9 bbbcccd xyzzy42 qwrtpl9';
    const r = runHelper(['insert', '--tg-user-id', 'j2-regr-illegal-' + Date.now(), '--approved-address', testAddress, '--network', NETWORK], illegalMnemonic);
    check('⑥非法 mnemonic → CLI 非零 exit code(派生失败 abort)', r.code !== 0, `code=${r.code} stderr=${r.stderr}`);
    const leaked6 = r.stdout.includes(illegalMnemonic) || r.stderr.includes(illegalMnemonic)
      || illegalMnemonic.split(' ').some((w) => r.stdout.includes(w) || r.stderr.includes(w));
    check('⑥非法 mnemonic 错误路径 stdout/stderr 不含原始输入片段(含逐词扫描, 非只整串匹配)', !leaked6, leaked6 ? `LEAK DETECTED: stdout=${r.stdout} stderr=${r.stderr}` : '干净');
  }

  // ── TAINT: 全程 stdout/stderr 不含测试用明文 mnemonic 字符串(exact-secret 扫描)。用第三条
  // mnemonic 避免复用 testAddress/testAddress2(已被①④占用, UNIQUE 约束会挡) ──
  {
    const TEST_MNEMONIC_3 = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
    const testAddress3 = consoleWallet.addressFromMnemonic(TEST_MNEMONIC_3, NETWORK);
    const tgUserId = 'j2-regr-taint-' + Date.now();
    const r = runHelper(['insert', '--tg-user-id', tgUserId, '--approved-address', testAddress3, '--network', NETWORK], TEST_MNEMONIC_3);
    const leaked = r.stdout.includes(TEST_MNEMONIC_3) || r.stderr.includes(TEST_MNEMONIC_3);
    check('TAINT stdout/stderr 不含明文 mnemonic(exact-secret 扫描, 非形状匹配)', !leaked, leaked ? 'LEAK DETECTED' : '干净');
  }

  const logPath = path.join(LOG_DIR, 'm0c1-pilot-custodial-insert-regression-latest.json');
  writeFileSync(logPath, JSON.stringify({
    source: 'scratch/j2-reviewed-helper-design.txt(Bettor+NWT+KANet-UI 三人红队 GREEN) + docs/2026-07-23-m0c-1-pilot-activation-runbook.md §3.6',
    target: 'kasia-console/scripts/m0c1-pilot-custodial-insert.mjs (MF2 步骤4 reviewed helper)',
    method: '真实调用 CLI(spawnSync + stdin 管道喂 mnemonic, 非 mock) + DB 旁路核对',
    summary: { pass, fail }, evidence,
  }, null, 2));
  console.log(`\nevidence log: ${logPath}`);
  console.log(`\n== pilot-custodial-insert regression: PASS ${pass} / FAIL ${fail} ==`);
  for (const f of [DB, DB + '-wal', DB + '-shm']) if (existsSync(f)) { try { rmSync(f); } catch {} }
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('TEST ERROR', e); process.exit(1); });
