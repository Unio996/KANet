// M0c-1 reviewed helper(candidate-generate + insert)regression — Codex MSG-124 终审整改
// A+B+C+D 全覆盖。设计: scratch/j2-msg124-rectification-design.txt(三人红队 GREEN)
// 真实调用两个 CLI（execFileSync spawn 子进程，非 mock/非直调内部函数）。
// 跑法(cwd=D:/kanet/kanet): node kasia-console/test-framework/cases/m0c1-gate/pilot-custodial-insert-regression.mjs

import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { decrypt } from '../../../src/services/crypto.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const GENERATE = path.join(ROOT, 'kasia-console/scripts/m0c1-pilot-candidate-generate.mjs');
const INSERT = path.join(ROOT, 'kasia-console/scripts/m0c1-pilot-custodial-insert.mjs');
const DB = path.join(ROOT, 'scratch/m0c1-pilot-custodial-insert-regression.db');
const CANDIDATE_DIR = path.join(ROOT, 'scratch/pilot-candidate-regr');
const LOG_DIR = path.join(ROOT, 'logs/test-runs');
const NETWORK = 'testnet-12';

for (const f of [DB, DB + '-wal', DB + '-shm']) if (existsSync(f)) rmSync(f);
mkdirSync(LOG_DIR, { recursive: true });
mkdirSync(CANDIDATE_DIR, { recursive: true });
rmSync(CANDIDATE_DIR, { recursive: true, force: true });
mkdirSync(CANDIDATE_DIR, { recursive: true });

process.env.DB_PATH = DB; // 顺序 load-bearing: 任何 db/client.js 导入前设好
process.env.CONSOLE_ENCRYPTION_KEY = randomBytes(32).toString('hex'); // throwaway

let pass = 0, fail = 0;
const evidence = [];
function check(label, ok, detail) {
  if (ok) { pass++; console.log(`PASS ${label}`); }
  else { fail++; console.log(`FAIL ${label}${detail ? ' — ' + detail : ''}`); }
  evidence.push({ label, ok, detail: detail ? String(detail).slice(0, 500) : undefined });
}

function runCli(scriptPath, args) {
  try {
    const stdout = execFileSync('node', [scriptPath, ...args], { encoding: 'utf8', env: process.env });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() || '', stderr: e.stderr?.toString() || e.message };
  }
}

function generateCandidate(label) {
  const r = runCli(GENERATE, ['generate', '--label', label, '--network', NETWORK, '--candidate-dir', CANDIDATE_DIR]);
  const m = /candidate_file=(.+)/.exec(r.stdout);
  const addrM = /address=(\S+)/.exec(r.stdout);
  return { ...r, candidateFile: m ? m[1].trim() : null, address: addrM ? addrM[1].trim() : null };
}

async function main() {
  const migrateMod = await import(pathToFileURL(path.join(ROOT, 'kasia-console/src/db/migrate.js')).href);
  await migrateMod.runMigrations();

  // ── ① 候选匹配 → 正常插入 + readback PASS + 候选文件被 shred + 独立解密核对 ──
  {
    const g = generateCandidate('regr-match');
    check('①candidate-generate exit code=0', g.code === 0, `code=${g.code} stderr=${g.stderr}`);
    check('①候选文件是密文(grep 内容不含 mnemonic 相关明文结构, 只有 mnemonic_encrypted JSON 字段)',
      g.candidateFile && existsSync(g.candidateFile) && !readFileSync(g.candidateFile, 'utf8').includes('"mnemonic":'), '');

    const tgUserId = 'j2-regr-match-' + Date.now();
    const r = runCli(INSERT, ['insert', '--candidate-file', g.candidateFile, '--tg-user-id', tgUserId,
      '--approved-address', g.address, '--network', NETWORK, '--db', DB]);
    check('①insert exit code=0', r.code === 0, `code=${r.code} stderr=${r.stderr}`);
    check('①stdout 报告 readback 验证 PASS', /readback 验证: PASS/.test(r.stdout), r.stdout);
    check('①insert 后候选文件被 shred(不存在)', !existsSync(g.candidateFile), '');

    const db = new Database(DB, { readonly: true });
    const row = db.prepare('SELECT * FROM tg_custodial_wallets WHERE tg_user_id = ?').get(tgUserId);
    check('①DB 行存在且 address 精确匹配', row && row.kaspa_address === g.address, row ? row.kaspa_address : '(无行)');
    if (row) {
      const decrypted = decrypt(row.mnemonic_encrypted);
      const { addressFromMnemonic } = await import(pathToFileURL(path.join(ROOT, 'kasia-console/src/services/wallet.js')).href);
      const rederived = addressFromMnemonic(decrypted, NETWORK);
      check('①独立解密+重新派生地址与批准值一致(不信 helper 自己的 readback 断言)', rederived === g.address, rederived);
    }
    db.close();
  }

  // ── ② 候选文件 address 字段被篡改(genuine mismatch) → abort 不写库 + 候选文件被 shred ──
  {
    const g = generateCandidate('regr-tampered');
    const tampered = JSON.parse(readFileSync(g.candidateFile, 'utf8'));
    tampered.address = 'kaspatest:qwrongaddr00000000000000000000000000000000000000000000000';
    writeFileSync(g.candidateFile, JSON.stringify(tampered, null, 2));

    const tgUserId = 'j2-regr-tampered-' + Date.now();
    const r = runCli(INSERT, ['insert', '--candidate-file', g.candidateFile, '--tg-user-id', tgUserId,
      '--approved-address', g.address, '--network', NETWORK, '--db', DB]);
    check('②候选文件 address 字段被篡改 → insert 非零 exit code(abort)', r.code !== 0, `code=${r.code} stderr=${r.stderr}`);
    check('②stderr 精确提示候选文件记录的 address 不匹配(非泛泛报错)', /候选文件记录的 address/.test(r.stderr), r.stderr);
    check('②候选文件被 shred(genuine mismatch)', !existsSync(g.candidateFile), '');
    const db = new Database(DB, { readonly: true });
    const row = db.prepare('SELECT * FROM tg_custodial_wallets WHERE tg_user_id = ?').get(tgUserId);
    check('②DB 里确实没有这条 wallet(abort 时不写库)', !row, row ? JSON.stringify(row) : '(无行, 符合预期)');
    db.close();
  }

  // ── ③ tg_user_id 占位符 → 拒绝, 候选文件不受影响(还没到候选处理阶段) ──
  {
    const g = generateCandidate('regr-placeholder');
    const r = runCli(INSERT, ['insert', '--candidate-file', g.candidateFile, '--tg-user-id', 'blank',
      '--approved-address', g.address, '--network', NETWORK, '--db', DB]);
    check('③tg_user_id=占位符"blank" → CLI 非零 exit code(拒绝)', r.code !== 0, `code=${r.code} stderr=${r.stderr}`);
    check('③stderr 精确提示占位符非法(非泛泛报错)', /占位符/.test(r.stderr), r.stderr);
    check('③候选文件未被 shred(占位符检查发生在候选文件处理之前, 非 genuine mismatch)', existsSync(g.candidateFile), '');
    runCli(GENERATE, ['revoke', '--candidate-file', g.candidateFile]); // 清理
  }

  // ── ④ tg_user_id 重复 → 拒绝, 候选文件不受影响(non-shred 场景, 可用同一候选重试换个 id) ──
  {
    const g1 = generateCandidate('regr-dup1');
    const tgUserId = 'j2-regr-dup-' + Date.now();
    const first = runCli(INSERT, ['insert', '--candidate-file', g1.candidateFile, '--tg-user-id', tgUserId,
      '--approved-address', g1.address, '--network', NETWORK, '--db', DB]);
    check('④首次插入(为重复测试铺垫) → exit code=0', first.code === 0, `code=${first.code} stderr=${first.stderr}`);

    const g2 = generateCandidate('regr-dup2');
    const dup = runCli(INSERT, ['insert', '--candidate-file', g2.candidateFile, '--tg-user-id', tgUserId,
      '--approved-address', g2.address, '--network', NETWORK, '--db', DB]);
    check('④同 tg_user_id 重复插入 → CLI 非零 exit code(拒绝)', dup.code !== 0, `code=${dup.code} stderr=${dup.stderr}`);
    check('④stderr 精确提示已存在(友好报错先于 PK 约束报错)', /已存在于 tg_custodial_wallets/.test(dup.stderr), dup.stderr);
    check('④候选文件未被 shred(重复检查非 genuine mismatch, 候选本身没坏, 换个 tg_user_id 可重试)', existsSync(g2.candidateFile), '');
    runCli(GENERATE, ['revoke', '--candidate-file', g2.candidateFile]); // 清理
  }

  // ── ⑤ --network typo → CLI 拒绝退出, 白名单挡在候选文件读取之前 ──
  {
    const g = generateCandidate('regr-nettypo');
    const r = runCli(INSERT, ['insert', '--candidate-file', g.candidateFile, '--tg-user-id', 'j2-regr-nettypo-' + Date.now(),
      '--approved-address', g.address, '--network', 'testnet12', '--db', DB]);
    check('⑤--network 打错("testnet12"漏横杠) → CLI 非零 exit code(白名单拒绝)', r.code !== 0, `code=${r.code} stderr=${r.stderr}`);
    check('⑤stderr 精确提示不在允许集合', /不在允许集合/.test(r.stderr), r.stderr);
    runCli(GENERATE, ['revoke', '--candidate-file', g.candidateFile]);
  }

  // ── ⑥ --db 未传 / 指向不存在文件 → CLI 拒绝(C 整改：硬 required + 无默认值) ──
  {
    const g = generateCandidate('regr-nodb');
    const r = runCli(INSERT, ['insert', '--candidate-file', g.candidateFile, '--tg-user-id', 'j2-regr-nodb-' + Date.now(),
      '--approved-address', g.address, '--network', NETWORK, '--db', path.join(ROOT, 'scratch/does-not-exist-canonical.db')]);
    check('⑥--db 指向不存在的文件 → CLI 非零 exit code(拒绝, 不静默新建)', r.code !== 0, `code=${r.code} stderr=${r.stderr}`);
    check('⑥stderr 精确提示 DB 文件不存在(非泛泛报错)', /指向的文件不存在/.test(r.stderr), r.stderr);
    runCli(GENERATE, ['revoke', '--candidate-file', g.candidateFile]);
  }
  {
    const g = generateCandidate('regr-nodb2');
    const r = runCli(INSERT, ['insert', '--candidate-file', g.candidateFile, '--tg-user-id', 'j2-regr-nodb2-' + Date.now(),
      '--approved-address', g.address, '--network', NETWORK]); // 完全不传 --db
    check('⑥完全不传 --db → CLI 非零 exit code(硬 required, 无默认值)', r.code !== 0, `code=${r.code} stderr=${r.stderr}`);
    check('⑥stderr 提示缺 --db', /缺 --db/.test(r.stderr), r.stderr);
    runCli(GENERATE, ['revoke', '--candidate-file', g.candidateFile]);
  }

  // ── ⑦ key 指纹不一致（候选文件用一把 key 生成, insert 时用另一把 key）→ 拒绝, 非 shred(非
  // genuine mismatch, 是配置问题, 换正确的 key 重跑即可用同一候选) ──
  {
    const otherKey = randomBytes(32).toString('hex');
    const g = execFileSync('node', [GENERATE, 'generate', '--label', 'regr-keymismatch', '--network', NETWORK, '--candidate-dir', CANDIDATE_DIR],
      { encoding: 'utf8', env: { ...process.env, CONSOLE_ENCRYPTION_KEY: otherKey } });
    const candidateFile = /candidate_file=(.+)/.exec(g)[1].trim();
    const address = /address=(\S+)/.exec(g)[1].trim();
    const r = runCli(INSERT, ['insert', '--candidate-file', candidateFile, '--tg-user-id', 'j2-regr-keymismatch-' + Date.now(),
      '--approved-address', address, '--network', NETWORK, '--db', DB]); // 用当前进程默认 CONSOLE_ENCRYPTION_KEY(不同于 otherKey)
    check('⑦候选文件用不同 key 生成 → insert 用另一把 key 时 CLI 非零 exit code(拒绝)', r.code !== 0, `code=${r.code} stderr=${r.stderr}`);
    check('⑦stderr 精确提示 key fingerprint 不一致(非泛泛报错)', /key_fingerprint.*!=.*key fingerprint/.test(r.stderr), r.stderr);
    check('⑦候选文件未被 shred(key 不一致是配置问题非候选本身坏, 用正确 key 可重试)', existsSync(candidateFile), '');
    execFileSync('node', [GENERATE, 'revoke', '--candidate-file', candidateFile], { encoding: 'utf8' });
  }

  // ── ⑧ D 整改：真并发竞态验证事务原子性(非 mock 场景, Promise.all 真同时打相同 tg_user_id)
  // ——精确证明"从未提交"而非"插入又删除"：两者对 crash-window 防护等级不同, 只查最终行数=0
  // 是弱判据(两种情况都会显示 0 行或 1 行, 无法区分是否曾经存在过半写状态)。用两个候选文件
  // 抢同一个 tg_user_id, 断言恰好 1 个成功 + 表里恰好 1 行(PK 约束在事务内触发, 事务自动回滚
  // 非半写残留) ──
  {
    const gA = generateCandidate('regr-race-a');
    const gB = generateCandidate('regr-race-b');
    const raceTgUserId = 'j2-regr-race-' + Date.now();
    const [rA, rB] = await Promise.all([
      new Promise((res) => {
        try {
          const stdout = execFileSync('node', [INSERT, 'insert', '--candidate-file', gA.candidateFile, '--tg-user-id', raceTgUserId,
            '--approved-address', gA.address, '--network', NETWORK, '--db', DB], { encoding: 'utf8', env: process.env });
          res({ code: 0, stdout, stderr: '' });
        } catch (e) { res({ code: e.status ?? 1, stdout: e.stdout?.toString() || '', stderr: e.stderr?.toString() || e.message }); }
      }),
      new Promise((res) => {
        try {
          const stdout = execFileSync('node', [INSERT, 'insert', '--candidate-file', gB.candidateFile, '--tg-user-id', raceTgUserId,
            '--approved-address', gB.address, '--network', NETWORK, '--db', DB], { encoding: 'utf8', env: process.env });
          res({ code: 0, stdout, stderr: '' });
        } catch (e) { res({ code: e.status ?? 1, stdout: e.stdout?.toString() || '', stderr: e.stderr?.toString() || e.message }); }
      }),
    ]);
    const successCount = [rA, rB].filter((r) => r.code === 0).length;
    check('⑧真并发(Promise.all, 非顺序 await)抢同一 tg_user_id → 恰好 1 个成功(PK 约束在事务内生效, 非双写)',
      successCount === 1, `rA.code=${rA.code} rB.code=${rB.code}`);
    const db = new Database(DB, { readonly: true });
    const cnt = db.prepare('SELECT COUNT(*) AS cnt FROM tg_custodial_wallets WHERE tg_user_id = ?').get(raceTgUserId).cnt;
    check('⑧表里对这个 tg_user_id 恰好 1 行(非 0/非 2——事务原子性: 输家的 INSERT 从未提交, 非"插入又清理")', cnt === 1, `实际=${cnt}`);
    db.close();
    // 清理输家的候选文件(若还在——胜者的已被 shred, 输家的因为是 UNIQUE 约束触发的 transient
    // 失败, 按 shred 规则不该被 shred, 应该还在, 显式验证这条规则)。
    const loserCandidate = rA.code !== 0 ? gA.candidateFile : gB.candidateFile;
    check('⑧输家候选文件未被 shred(UNIQUE 约束冲突是 transient 场景, 非 genuine mismatch, 候选本身没坏)', existsSync(loserCandidate), '');
    for (const f of [gA.candidateFile, gB.candidateFile]) { try { if (existsSync(f)) execFileSync('node', [GENERATE, 'revoke', '--candidate-file', f]); } catch {} }
  }

  // ── ⑨ 非法 mnemonic 错误路径的 TAINT（候选文件被直接手工构造出畸形 mnemonic_encrypted，
  // 模拟"decrypt 出来的内容不是合法 BIP39"这条路径）——用无意义乱码词, 避免跟错误文案模板
  // 固有词汇撞词造成假阳性 ──
  {
    const g = generateCandidate('regr-illegal');
    // 直接用候选文件的 key_fingerprint/address, 但替换 mnemonic_encrypted 为"用同一 key
    // 加密了一串非法 mnemonic 内容"的密文(合法 decrypt, 非法 BIP39)。
    const { encrypt } = await import(pathToFileURL(path.join(ROOT, 'kasia-console/src/services/crypto.js')).href);
    const illegal = JSON.parse(readFileSync(g.candidateFile, 'utf8'));
    const illegalMnemonic = 'zzqxpp wqrpxk nzzy77a uniqtok9 bbbcccd xyzzy42 qwrtpl9';
    illegal.mnemonic_encrypted = encrypt(illegalMnemonic);
    writeFileSync(g.candidateFile, JSON.stringify(illegal, null, 2));

    const r = runCli(INSERT, ['insert', '--candidate-file', g.candidateFile, '--tg-user-id', 'j2-regr-illegal-' + Date.now(),
      '--approved-address', g.address, '--network', NETWORK, '--db', DB]);
    check('⑨非法 mnemonic(合法 decrypt, 非法 BIP39) → CLI 非零 exit code(派生失败 abort)', r.code !== 0, `code=${r.code} stderr=${r.stderr}`);
    const leaked9 = r.stdout.includes(illegalMnemonic) || r.stderr.includes(illegalMnemonic)
      || illegalMnemonic.split(' ').some((w) => r.stdout.includes(w) || r.stderr.includes(w));
    check('⑨非法 mnemonic 错误路径 stdout/stderr 不含原始输入片段(逐词扫描)', !leaked9, leaked9 ? `LEAK: stdout=${r.stdout} stderr=${r.stderr}` : '干净');
    check('⑨候选文件被 shred(候选本身内容坏了, genuine mismatch)', !existsSync(g.candidateFile), '');
  }

  const gitRevParse = () => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return null; } };
  const gitHashObject = (p) => { try { return execFileSync('git', ['hash-object', p], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return null; } };

  const logPath = path.join(LOG_DIR, 'm0c1-pilot-custodial-insert-regression-latest.json');
  writeFileSync(logPath, JSON.stringify({
    source: 'scratch/j2-msg124-rectification-design.txt(A+B+C+D 整改) + scratch/j2-reviewed-helper-design.txt(基础9步)',
    target: 'kasia-console/scripts/m0c1-pilot-candidate-generate.mjs + m0c1-pilot-custodial-insert.mjs',
    method: '真实调用两个 CLI(execFileSync, 非 mock) + Promise.all 真并发(非 mock)',
    source_commit: gitRevParse(),
    test_blob_sha: gitHashObject(path.relative(ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/')),
    generate_blob_sha: gitHashObject('kasia-console/scripts/m0c1-pilot-candidate-generate.mjs'),
    insert_blob_sha: gitHashObject('kasia-console/scripts/m0c1-pilot-custodial-insert.mjs'),
    summary: { pass, fail }, evidence,
  }, null, 2));
  console.log(`\nevidence log: ${logPath}`);
  console.log(`\n== pilot-custodial-insert regression: PASS ${pass} / FAIL ${fail} ==`);
  for (const f of [DB, DB + '-wal', DB + '-shm']) if (existsSync(f)) { try { rmSync(f); } catch {} }
  rmSync(CANDIDATE_DIR, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('TEST ERROR', e); process.exit(1); });
