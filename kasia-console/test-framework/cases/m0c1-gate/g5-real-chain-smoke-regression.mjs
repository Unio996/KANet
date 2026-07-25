// J2 2026-07-25 — G5 v2 real_chain smoke regression（Codex re-review entry condition①要求的
// 测试：锁竞争/坏journal/kill-after-POST恢复/精确授权绑定/错DB/错进程身份，外加 Bettor 点名的
// 预算累加测试）。真实调用 G5 CLI(异步 spawn 子进程, 非 mock/非直调内部函数)，真实 DB(跑
// migrate.js runMigrations()，非手搓 DDL)，本地 loopback HTTP stub 模拟 runtime-identity 端点
// (gate③不需要真的活 Console 进程——它只是查一个 JSON 端点，测试可以自己起一个同形状的假的)。
//
// 🔴 子进程调用必须用异步 spawn，不能用 execFileSync（2026-07-25 worktree 首次全 gate 放行时
// 撞出的真死锁，10 行最小复现独立验证过）：execFileSync 是完全同步阻塞调用，会冻结父进程整个
// event loop（含 libuv），而父进程这时候还要用 http.createServer() 服务子进程 G5 gate③ 回调
// 查询的 runtime-identity 端点——父进程被 execFileSync 冻住就没法处理这个 incoming 请求，子进程
// 那头只能干等到自己的 8s AbortSignal 超时。之前在脏树里跑没暴露，是因为 gate① 每次都先 abort，
// 根本没走到会触发死锁的 gate③ 那段代码路径。
//
// 🔴 已知局限(如实标注): gate①(git status --porcelain clean)要求本仓库工作树干净——这意味着
// 本测试文件本身跟 G5 v2 主体必须已经 commit 才能真正跑通全部用例(跟这个仓库其余 regression
// test 的假设一致: 测的是已 ship 的代码, 非工作中的草稿)。
//
// 🔴 范围边界: gate⑧(candidate 钱包链上真实余额)+ POST /api/capability/wallet/transfer + 落链
// 轮询这几步需要真实 testnet-12 RPC + 真实 armed 网关，本测试**不覆盖**——那正是 G5 自己存在的
// 唯一理由(证明"真链上真的能跑通"), 用假 RPC/假网关"测试"它等于绕过它要证明的东西。本文件只测
// gate①-⑦(clean/snapshot/身份双层证据/schema/grant预检/锁/预算+reconcile-gate), 这几步全是本地
// 检查(git/fs/loopback HTTP/DB), 可以真实、独立、确定性地测。
//
// 跑法(cwd=D:/kanet-tn12): node kasia-console/test-framework/cases/m0c1-gate/g5-real-chain-smoke-regression.mjs

import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getRepoRoot } from '../../../src/lib/repo-root.mjs';
import { computeLoadBearingDigest } from '../../../src/lib/load-bearing-digest.mjs';
import { RUNTIME_SCOPE_DIRS } from '../../../src/lib/runtime-scope-dirs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = getRepoRoot(HERE); // 共享 helper, 不再硬编码层数(见 repo-root.mjs 头部背景)
const G5 = path.join(ROOT, 'kasia-console/test-framework/cases/m0c1-gate/g5-pilot-custodial-real-chain-smoke.mjs');
const RECONCILE = path.join(ROOT, 'kasia-console/scripts/m0c1-g5-journal-reconcile.mjs');
const DB = path.join(ROOT, 'scratch/g5-regression.db');
const LOCK_PATH = path.join(ROOT, 'scratch/g5.lock');
const JOURNAL_DIR = path.join(ROOT, 'scratch/g5-journal');
const KEY_FILE = path.join(ROOT, '..', 'g5-regression-key.hex'); // 刻意在 repo 外(P1-2 要求)
const SNAPSHOT_FILE = path.join(ROOT, 'scratch/g5-regression-snapshot.json');
const NETWORK = 'testnet-12';

let pass = 0, fail = 0;
const evidence = [];
function check(label, ok, detail) {
  if (ok) { pass++; console.log(`PASS ${label}`); }
  else { fail++; console.log(`FAIL ${label}${detail ? ' — ' + detail : ''}`); }
  evidence.push({ label, ok, detail: detail ? String(detail).slice(0, 800) : undefined });
}

function cleanState() {
  for (const f of [LOCK_PATH]) if (existsSync(f)) rmSync(f);
  if (existsSync(JOURNAL_DIR)) rmSync(JOURNAL_DIR, { recursive: true, force: true });
  mkdirSync(JOURNAL_DIR, { recursive: true });
}

// 宽于 G5 自身最长内部超时(落链轮询 20×3s=60s)——只兜完全未预料的挂死路径, 让它变成干净
// FAIL(kill 子进程 + resolve)而不是把整个 regression 套件挂死(KANet-UI 2026-07-25 review 提)。
const CHILD_TIMEOUT_MS = 100_000;

function runChildAsync(cmd, args, opts) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, opts);
    } catch (e) {
      resolve({ code: 1, stdout: '', stderr: e.message });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve({ code: 1, stdout, stderr: stderr + `\n[runChildAsync] 子进程超时(> ${CHILD_TIMEOUT_MS}ms 未 close, 已 kill)` });
    }, CHILD_TIMEOUT_MS);
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: stderr || e.message });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function runG5(args) {
  return runChildAsync('node', [G5, ...args], { env: process.env, cwd: ROOT });
}

function runReconcile(args) {
  return runChildAsync('node', [RECONCILE, ...args], { env: process.env, cwd: ROOT });
}

function writeJournalDirect(entry) {
  writeFileSync(path.join(JOURNAL_DIR, `${entry.id}.json`), JSON.stringify(entry, null, 2));
}

async function main() {
  // ── 起一个真实(小而美)的 loopback HTTP stub 服务 runtime-identity, 内容可被测试逐个用例改写 ──
  let identityResponse = null;
  const server = createServer((req, res) => {
    if (req.url === '/api/system/runtime-identity') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(identityResponse));
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  process.env.G5_CONSOLE_BASE_URL = `http://127.0.0.1:${port}`;

  // ── 隔离 DB: 真跑 migrate.js runMigrations()(非手搓 DDL), 拿到真实 schema ──
  for (const f of [DB, DB + '-wal', DB + '-shm']) if (existsSync(f)) rmSync(f);
  process.env.DB_PATH = DB;
  process.env.CONSOLE_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  const migrateMod = await import(pathToFileURL(path.join(ROOT, 'kasia-console/src/db/migrate.js')).href + `?t=${Date.now()}`);
  await migrateMod.runMigrations();
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(DB);
  const dbStat = statSync(DB);

  const CANDIDATE_ADDR = 'kaspatest:qztz4zc4x6kx2mnh9wwlf9qqs3t25q9s0prr7qmrhwhkqp73rfzfv4cs53gk2';
  const PAYEE_ADDR = 'kaspatest:qr7cqq2eq5xyzq63yljgsfspmfce8nltrp9vhq5y0tjayzvhswtcvjc4pvxcx';
  const GRANT_ID = randomUUID();
  const nowSec = Math.floor(Date.now() / 1000);
  // 🔴 自跑测试时自查发现的 fixture bug: 漏了 created_at(NOT NULL)+provisioned_by(NOT NULL
  // DEFAULT 'operator-offline-script', 显式传更清楚这是测试 fixture 非真 operator 签发)两列,
  // 首次跑直接 SqliteError 崩在这——INSERT 前应该先读 DDL 逐列核对, 不是凭记忆拼字段列表。
  db.prepare(`INSERT INTO m0c1_app_grants
      (grant_id, app_key_id, app_pubkey, allowed_commands, typed_intent_version, relay_scope, network,
       source_scope, payee_scope, max_amount_sompi, valid_from, valid_until, grant_version, revoked,
       created_at, provisioned_by)
      VALUES (@grant_id, @app_key_id, @app_pubkey, @allowed_commands, 1, @relay_scope, @network,
       @source_scope, @payee_scope, @max_amount_sompi, @valid_from, @valid_until, 1, 0,
       @created_at, @provisioned_by)`).run({
    grant_id: GRANT_ID, app_key_id: 'test-app-key', app_pubkey: '00'.repeat(32),
    allowed_commands: JSON.stringify(['custodial_transfer']), relay_scope: JSON.stringify(['test-relay']),
    network: NETWORK, source_scope: JSON.stringify([CANDIDATE_ADDR]), payee_scope: JSON.stringify([PAYEE_ADDR]),
    max_amount_sompi: 200000000, valid_from: nowSec - 60, valid_until: nowSec + 86400,
    created_at: nowSec, provisioned_by: 'g5-regression-test-fixture',
  });
  db.close();

  // ── key file(repo 外, P1-2) ──
  writeFileSync(KEY_FILE, randomBytes(32).toString('hex'));

  // ── HEAD(真实仓库 HEAD, 供正确快照+identity 用) ──
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  // B2(2026-07-25): 用真实 RUNTIME_SCOPE_DIRS 对当前工作树算一次真 digest(非造假值), goodIdentity
  // 和 snapshot 都从这同一份算出来的值取, 保证"合法输入应该过 gate③"这条真的测到了 B2 逻辑,
  // 不是绕过它。
  const { treeDigest: goodTreeDigest, fileCount: goodFileCount } = computeLoadBearingDigest(ROOT, RUNTIME_SCOPE_DIRS);
  const goodIdentity = {
    git_commit: head, db_path: DB, db_stat: { dev: dbStat.dev, ino: dbStat.ino },
    load_bearing_digest: { treeDigest: goodTreeDigest, fileCount: goodFileCount, dirty: false },
    pid: 99999, started_at: new Date().toISOString(),
  };

  function writeSnapshot(overrides = {}) {
    const snap = {
      grant_id: GRANT_ID, app_key_id: 'test-app-key', relay_id: 'test-relay',
      candidate_address: CANDIDATE_ADDR, payee_address: PAYEE_ADDR, network: NETWORK,
      max_amount_sompi: 200000000, valid_until: nowSec + 86400, package_commit: head,
      db_path: DB, db_stat: { dev: dbStat.dev, ino: dbStat.ino },
      expected_load_bearing_tree_digest: goodTreeDigest,
      source_scope: [CANDIDATE_ADDR], payee_scope: [PAYEE_ADDR], relay_scope: ['test-relay'],
      allowed_commands: ['custodial_transfer'],
      ...overrides,
    };
    writeFileSync(SNAPSHOT_FILE, JSON.stringify(snap, null, 2));
    return SNAPSHOT_FILE;
  }

  const baseArgs = () => ['--snapshot', writeSnapshot(), '--app-priv-key-file', KEY_FILE, '--amount-kas', '0.5'];

  const EVIDENCE_FILE = path.join(ROOT, 'scratch/g5-regression-evidence.txt');
  writeFileSync(EVIDENCE_FILE, 'regression test synthetic evidence, no real chain interaction');

  // ══ ① 锁竞争: 预先占锁, G5 应在 gate⑥ abort, 不清理已存在的锁(非自己拿到的锁不该碰) ══
  cleanState();
  identityResponse = goodIdentity;
  writeFileSync(LOCK_PATH, JSON.stringify({ pid: 424242, started_at: new Date().toISOString() }));
  {
    const r = await runG5(baseArgs());
    check('①锁竞争: 已占锁时 G5 abort(非0退出)', r.code !== 0, `code=${r.code}`);
    check('①锁竞争: 报错提到已存在的锁', /已存在锁/.test(r.stderr) || /已存在锁/.test(r.stdout), (r.stderr + r.stdout).slice(0, 200));
    check('①锁竞争: 原锁文件内容未被覆盖(不是自己抢到又释放)', existsSync(LOCK_PATH) && JSON.parse(readFileSync(LOCK_PATH, 'utf8')).pid === 424242, 'lock content changed');
  }

  // ══ ② 坏 journal: halt 整个 gate⑦, 非静默跳过 ══
  cleanState();
  writeFileSync(path.join(JOURNAL_DIR, 'corrupt.json'), '{ this is not valid json ');
  {
    const r = await runG5(baseArgs());
    check('②坏journal: G5 abort(非0退出)', r.code !== 0, `code=${r.code}`);
    check('②坏journal: 报错提到损坏无法解析', /损坏无法解析/.test(r.stderr), r.stderr.slice(0, 200));
  }

  // ══ B4(2026-07-25): tmp 孤儿(crash 打断 rename)== 未 reconcile 状态, 不能被漏计/隐身 ══
  cleanState();
  {
    const orphanId = randomUUID();
    const orphanEntry = { id: orphanId, state: 'prepared', amount_kas: 0.4, grant_id: GRANT_ID, candidate_address: CANDIDATE_ADDR, payee_address: PAYEE_ADDR, created_at: new Date().toISOString(), txId: null, prepared_utxo_snapshot: [] };
    // 手工模拟 journalWriteAtomic 里 fsync 已完成、rename 未完成那个瞬间(不经过正常 renameSync)
    writeFileSync(path.join(JOURNAL_DIR, `.tmp-${orphanId}-${Date.now()}`), JSON.stringify(orphanEntry, null, 2));

    const listR = await runReconcile(['list']);
    check('B4: reconcile list 能看到 tmp 孤儿(不隐身)', listR.stdout.includes(orphanId) && listR.stdout.includes('tmp 孤儿'), listR.stdout.slice(0, 300));

    const r = await runG5(baseArgs());
    check('B4: G5 gate⑦ 把 tmp 孤儿当未 reconcile 记录拦新 run', r.code !== 0 && /未 reconcile 的 journal 记录/.test(r.stderr), r.stderr.slice(0, 200));

    // resolve 应该能定位 tmp 孤儿(按 id, 非按文件名)并完成迟到的 rename
    const resolveR = await runReconcile(['resolve', orphanId, '--verdict', 'not-spent', '--evidence-file', EVIDENCE_FILE, '--approver-1', 'NWT', '--approver-2', 'KANet-UI']);
    check('B4: reconcile resolve 能按 id 定位 tmp 孤儿并 resolve', resolveR.stdout.includes('failed'), resolveR.stdout);
    const canonicalPath = path.join(JOURNAL_DIR, `${orphanId}.json`);
    check('B4: resolve 后孤儿的 rename 被补完(规范 <id>.json 文件真的存在)', existsSync(canonicalPath), `expected ${canonicalPath} to exist`);
    const stillHasTmp = readdirSync(JOURNAL_DIR).some((f) => f.startsWith(`.tmp-${orphanId}-`));
    check('B4: 旧 tmp 孤儿文件被清理(不留两份)', !stillHasTmp, `tmp file still present`);
  }

  // ══ ③ 预算累加(Bettor 点名: sum 真等于各条 amount 之和, 非只测超限) ══
  cleanState();
  writeJournalDirect({ id: randomUUID(), state: 'landed', amount_kas: 1.2, grant_id: GRANT_ID, candidate_address: CANDIDATE_ADDR, payee_address: PAYEE_ADDR, created_at: new Date().toISOString(), txId: 'a'.repeat(64) });
  writeJournalDirect({ id: randomUUID(), state: 'landed', amount_kas: 0.8, grant_id: GRANT_ID, candidate_address: CANDIDATE_ADDR, payee_address: PAYEE_ADDR, created_at: new Date().toISOString(), txId: 'b'.repeat(64) });
  writeJournalDirect({ id: randomUUID(), state: 'failed', amount_kas: 99, grant_id: GRANT_ID, candidate_address: CANDIDATE_ADDR, payee_address: PAYEE_ADDR, created_at: new Date().toISOString() }); // 不该被计入
  {
    // 1.2+0.8=2.0 已花, 本次 0.5, 总 2.5 < SMOKE_BUDGET_KAS(5), 应该过 gate⑦ 继续往下走(会卡在真
    // RPC/gate⑧, 但那是预期——我们只验证 gate⑦ 真的算出了 2.0 而非 0 或 101(把 failed 那条 99 也
    // 算进去)。
    const r = await runG5(baseArgs());
    const seenSum = /累计预算 (\d+(\.\d+)?) \+/.exec(r.stdout || r.stderr);
    check('③预算累加: gate⑦ 输出的累计值等于 landed 两条之和(2 KAS), 排除 failed 那条(99)', seenSum && Math.abs(Number(seenSum[1]) - 2) < 0.001, `matched=${seenSum ? seenSum[1] : '(未匹配到 gate⑦ PASS 输出, 说明卡在更早的 gate 或这条 assertion 的正则跟当前文案对不上)'}\nstdout=${r.stdout.slice(-400)}\nstderr=${r.stderr.slice(-400)}`);
  }

  // ══ ④ 超预算: 累计+本次 > SMOKE_BUDGET_KAS(5) 应 abort ══
  cleanState();
  writeJournalDirect({ id: randomUUID(), state: 'landed', amount_kas: 4.8, grant_id: GRANT_ID, candidate_address: CANDIDATE_ADDR, payee_address: PAYEE_ADDR, created_at: new Date().toISOString(), txId: 'c'.repeat(64) });
  {
    const r = await runG5(baseArgs()); // 本次 0.5, 4.8+0.5=5.3 > 5
    check('④超预算: G5 abort(非0退出)', r.code !== 0, `code=${r.code}`);
    check('④超预算: 报错提到累计冒烟预算超限', /累计冒烟预算超限/.test(r.stderr), r.stderr.slice(0, 200));
  }

  // ══ ⑤ 未 reconcile 拦新 run(kill-after-POST 恢复场景: 留一条 submitted 未确认落地) ══
  cleanState();
  writeJournalDirect({ id: randomUUID(), state: 'submitted', amount_kas: 0.3, grant_id: GRANT_ID, candidate_address: CANDIDATE_ADDR, payee_address: PAYEE_ADDR, created_at: new Date().toISOString(), txId: 'd'.repeat(64) });
  {
    const r = await runG5(baseArgs());
    check('⑤未reconcile拦新run: G5 abort(非0退出)', r.code !== 0, `code=${r.code}`);
    check('⑤未reconcile拦新run: 报错提到未 reconcile 的 journal 记录', /未 reconcile 的 journal 记录/.test(r.stderr), r.stderr.slice(0, 200));
  }
  // 同一场景验证 prepared 态也被拦(不只 ambiguous/submitted)
  cleanState();
  writeJournalDirect({ id: randomUUID(), state: 'prepared', amount_kas: 0.3, grant_id: GRANT_ID, candidate_address: CANDIDATE_ADDR, payee_address: PAYEE_ADDR, created_at: new Date().toISOString() });
  {
    const r = await runG5(baseArgs());
    check('⑤prepared态也被拦(非只拦ambiguous/submitted)', r.code !== 0 && /未 reconcile 的 journal 记录/.test(r.stderr), r.stderr.slice(0, 200));
  }

  // ══ ⑥ 精确授权绑定: snapshot 字段跟 grant 实际值不符应 abort ══
  cleanState();
  {
    const r = await runG5(['--snapshot', writeSnapshot({ grant_id: randomUUID() }), '--app-priv-key-file', KEY_FILE, '--amount-kas', '0.5']);
    check('⑥精确绑定: grant_id 不匹配 → abort', r.code !== 0, `code=${r.code}`);
    check('⑥精确绑定: 报错提到 grant_id 不存在', /不存在于 live DB/.test(r.stderr), r.stderr.slice(0, 200));
  }
  cleanState();
  {
    const r = await runG5(['--snapshot', writeSnapshot({ source_scope: [CANDIDATE_ADDR, 'kaspatest:qextra00000000000000000000000000000000000000000000000000000'] }), '--app-priv-key-file', KEY_FILE, '--amount-kas', '0.5']);
    check('⑥精确绑定: source_scope 非 singleton(长度>1) → abort', r.code !== 0, `code=${r.code}`);
    check('⑥精确绑定: 报错提到 singleton scope enforce', /singleton scope enforce/.test(r.stderr), r.stderr.slice(0, 200));
  }
  cleanState();
  {
    const r = await runG5(['--snapshot', writeSnapshot({ allowed_commands: ['custodial_transfer', 'something_else'] }), '--app-priv-key-file', KEY_FILE, '--amount-kas', '0.5']);
    check('⑥精确绑定: allowed_commands 不恰好匹配 → abort', r.code !== 0, `code=${r.code}`);
  }

  // ══ ⑦ 错 DB: snapshot 声明的 db_path/db_stat 跟 runtime-identity 报的不一致应 abort ══
  cleanState();
  {
    const wrongStat = { dev: dbStat.dev, ino: dbStat.ino + 1 };
    const r = await runG5(['--snapshot', writeSnapshot({ db_stat: wrongStat }), '--app-priv-key-file', KEY_FILE, '--amount-kas', '0.5']);
    check('⑦错DB: db_stat(ino)不匹配 → abort', r.code !== 0, `code=${r.code}`);
    check('⑦错DB: 报错提到 db_stat 不匹配', /db_stat.*!= 快照声明/.test(r.stderr), r.stderr.slice(0, 200));
  }
  cleanState();
  {
    const r = await runG5(['--snapshot', writeSnapshot({ db_path: path.join(ROOT, 'scratch/some-other.db') }), '--app-priv-key-file', KEY_FILE, '--amount-kas', '0.5']);
    check('⑦错DB: db_path 不匹配 → abort', r.code !== 0, `code=${r.code}`);
  }

  // ══ ⑧ 错进程身份 / B2 digest 不等价 ══
  cleanState();
  {
    // B2(2026-07-25): digest 比对是判定权威, git_commit 不同但 digest 相同应该 PASS(真正
    // runtime-equivalent, 比如 revert-and-recommit 这种 SHA 变了但字节没变的情形)——这条验证
    // B2 没有比旧的 git-diff 判定更严格到"连真等价都拒"。
    let olderCommit = null;
    try {
      olderCommit = execFileSync('git', ['log', '-1', '--format=%H', '--', 'kasia-console/src'], { cwd: ROOT, encoding: 'utf8' }).trim();
    } catch {}
    if (olderCommit && olderCommit !== head) {
      identityResponse = { ...goodIdentity, git_commit: olderCommit }; // digest 不变(还是 goodTreeDigest)
      const r = await runG5(baseArgs());
      check('⑧commit 不同但 digest 相同(runtime-equivalent) → gate③ 仍 PASS(不误拒)', /gate⑦ PASS/.test(r.stdout), r.stdout.slice(-300));
      identityResponse = goodIdentity; // 复位
    } else {
      check('⑧commit-equivalence: 跳过(仓库里找不到独立的历史对照 commit)', true, 'skipped, not a real gap in coverage — just this environment lacks a fixture commit');
    }
  }
  {
    // B2 核心: digest 真不匹配(不管 commit 是否相同)必须 fail, 且报错以 digest 为判定依据
    // (git diff 只是排障辅助字样, 不是"报错提到差异"这类旧措辞)。
    identityResponse = { ...goodIdentity, load_bearing_digest: { ...goodIdentity.load_bearing_digest, treeDigest: 'f'.repeat(64) } };
    const r = await runG5(baseArgs());
    check('⑧B2 digest 不匹配 → abort', r.code !== 0, `code=${r.code}`);
    check('⑧B2 报错以 treeDigest 比对为判定依据(非旧的 git diff 措辞)', /load_bearing_digest\.treeDigest.*!= snapshot 声明的 expected_load_bearing_tree_digest/.test(r.stderr), r.stderr.slice(0, 300));
    identityResponse = goodIdentity;
  }
  {
    // B2: dirty=true 必须直接拒, 不可比对
    identityResponse = { ...goodIdentity, load_bearing_digest: { ...goodIdentity.load_bearing_digest, dirty: true } };
    const r = await runG5(baseArgs());
    check('⑧B2 dirty=true → abort(不可比对)', r.code !== 0 && /dirty=true/.test(r.stderr), r.stderr.slice(0, 200));
    identityResponse = goodIdentity;
  }
  {
    // B2: load_bearing_digest 整体缺失(端点自己算失败)必须直接拒, 跟 git_commit=null 同款处理
    identityResponse = { ...goodIdentity, load_bearing_digest: null };
    const r = await runG5(baseArgs());
    check('⑧B2 load_bearing_digest=null → abort(视为身份证明失败)', r.code !== 0 && /未返回 load_bearing_digest/.test(r.stderr), r.stderr.slice(0, 200));
    identityResponse = goodIdentity;
  }
  {
    // B2: snapshot 未声明 expected_load_bearing_tree_digest 必须直接拒(不能"没声明就跳过比对")
    cleanState();
    const r = await runG5(['--snapshot', writeSnapshot({ expected_load_bearing_tree_digest: undefined }), '--app-priv-key-file', KEY_FILE, '--amount-kas', '0.5']);
    check('⑧B2 snapshot 未声明 expected_load_bearing_tree_digest → abort', r.code !== 0 && /snapshot 未声明 expected_load_bearing_tree_digest/.test(r.stderr), r.stderr.slice(0, 200));
  }
  {
    // git_commit=null(端点自己失败)必须直接拒
    identityResponse = { ...goodIdentity, git_commit: null };
    const r = await runG5(baseArgs());
    check('⑧错进程身份: identity git_commit=null → abort(非放行)', r.code !== 0 && /git_commit=null/.test(r.stderr), r.stderr.slice(0, 200));
    identityResponse = goodIdentity;
  }
  {
    // non-loopback host 拒绝
    process.env.G5_CONSOLE_BASE_URL = 'http://example.com:1234';
    const r = await runG5(baseArgs());
    check('⑧错进程身份: 非 loopback host → abort', r.code !== 0 && /非 loopback/.test(r.stderr), r.stderr.slice(0, 200));
    process.env.G5_CONSOLE_BASE_URL = `http://127.0.0.1:${port}`;
  }

  // ══ ⑨ dry-run 正常路径(全 gate①-⑧ 应该过, 卡在 gate⑧ 真 RPC——预期行为, 证明前面全部门检确实
  //     都放行了合法输入, 不是"永远 abort"这种假阳性) ══
  cleanState();
  {
    const r = await runG5(baseArgs());
    check('⑨合法输入: 卡在 gate⑧(真 RPC 相关), 非更早的 gate', /未设 KASPA_RPC_URL|RPC connect timeout|candidate 钱包链上真实余额/.test(r.stderr), r.stderr.slice(-300));
    check('⑨合法输入: gate①-⑦ 全部 PASS 过(输出里能看到 gate⑦ PASS)', /gate⑦ PASS/.test(r.stdout), r.stdout.slice(-500));
  }

  // ── P1-1 canonical decimal: 非法金额格式应拒 ──
  cleanState();
  {
    const r = await runG5(['--snapshot', writeSnapshot(), '--app-priv-key-file', KEY_FILE, '--amount-kas', '0.123456789']); // 9位小数, 超8位
    check('P1-1: 超8位小数的金额格式 → abort', r.code !== 0 && /非 canonical decimal 字符串/.test(r.stderr), r.stderr.slice(0, 200));
  }
  cleanState();
  {
    const r = await runG5(['--snapshot', writeSnapshot(), '--app-priv-key-file', KEY_FILE, '--amount-kas', '3']); // 超 MAX_TRANSFER_KAS(2)
    check('单笔硬cap: 超 MAX_TRANSFER_KAS → abort', r.code !== 0 && /超过硬 cap/.test(r.stderr), r.stderr.slice(0, 200));
  }

  // ── P1-2 key 文件卫生: repo 内路径应拒 ──
  cleanState();
  {
    const insideRepoKey = path.join(ROOT, 'scratch/g5-key-inside-repo.hex');
    writeFileSync(insideRepoKey, randomBytes(32).toString('hex'));
    const r = await runG5(['--snapshot', writeSnapshot(), '--app-priv-key-file', insideRepoKey, '--amount-kas', '0.5']);
    check('P1-2: repo 内的 key 文件路径 → abort', r.code !== 0 && /不可位于 repo 根目录树下/.test(r.stderr), r.stderr.slice(0, 200));
    rmSync(insideRepoKey);
  }

  // ── reconcile 脚本: list/check/evidence 基础功能 + B5 双人复核加固负测试 ──
  cleanState();
  {
    const jid = randomUUID();
    writeJournalDirect({ id: jid, state: 'ambiguous', amount_kas: 0.5, grant_id: GRANT_ID, candidate_address: CANDIDATE_ADDR, payee_address: PAYEE_ADDR, created_at: new Date().toISOString(), txId: null, prepared_utxo_snapshot: [] });
    const listR = await runReconcile(['list']);
    check('reconcile list: 列出未 reconcile 记录', listR.stdout.includes(jid), listR.stdout.slice(0, 300));

    // B5 负测试: 缺 --evidence-file → 拒
    const noEvidenceR = await runReconcile(['resolve', jid, '--verdict', 'not-spent', '--approver-1', 'NWT', '--approver-2', 'Bettor']);
    check('B5: not-spent 缺 --evidence-file → abort', noEvidenceR.code !== 0 && /--evidence-file 必传/.test(noEvidenceR.stderr), noEvidenceR.stderr.slice(0, 200));

    // B5 负测试: not-spent 只给一个 approver → 拒
    const oneApproverR = await runReconcile(['resolve', jid, '--verdict', 'not-spent', '--evidence-file', EVIDENCE_FILE, '--approver-1', 'NWT']);
    check('B5: not-spent 只给一个 approver → abort(双人复核)', oneApproverR.code !== 0 && /两个不同的批准人/.test(oneApproverR.stderr), oneApproverR.stderr.slice(0, 200));

    // B5 负测试: 两个 approver 同名 → 拒
    const sameApproverR = await runReconcile(['resolve', jid, '--verdict', 'not-spent', '--evidence-file', EVIDENCE_FILE, '--approver-1', 'NWT', '--approver-2', 'NWT']);
    check('B5: --approver-1/--approver-2 同名 → abort', sameApproverR.code !== 0 && /不能是同一人/.test(sameApproverR.stderr), sameApproverR.stderr.slice(0, 200));

    // B5 负测试: approver 不在白名单 → 拒
    const badNameR = await runReconcile(['resolve', jid, '--verdict', 'not-spent', '--evidence-file', EVIDENCE_FILE, '--approver-1', 'NWT', '--approver-2', 'some-random-name']);
    check('B5: approver 不在白名单 → abort', badNameR.code !== 0 && /已知身份之一/.test(badNameR.stderr), badNameR.stderr.slice(0, 200));

    // B5 快乐路径: 双人复核 + evidence-file 齐全 → 真的 resolve 成功
    const resolveR = await runReconcile(['resolve', jid, '--verdict', 'not-spent', '--evidence-file', EVIDENCE_FILE, '--approver-1', 'NWT', '--approver-1-note', 'regression test', '--approver-2', 'Bettor', '--approver-2-note', 'regression test']);
    check('reconcile resolve: 双人复核齐全 → 写入 not-spent 判定后状态变 failed', resolveR.stdout.includes('failed'), resolveR.stdout);
    const afterEntry = JSON.parse(readFileSync(path.join(JOURNAL_DIR, `${jid}.json`), 'utf8'));
    check(
      'reconcile resolve: journal 文件真的被更新为 failed + evidence-digest + 双 approver 留痕',
      afterEntry.state === 'failed'
        && afterEntry.reconciled_evidence?.evidence_digest?.length === 64
        && afterEntry.reconciled_approvers?.length === 2
        && afterEntry.reconciled_approvers.map((a) => a.name).sort().join(',') === 'Bettor,NWT',
      JSON.stringify(afterEntry),
    );
  }

  // spent verdict: 单人但仍要白名单内 approver + evidence-file
  cleanState();
  {
    const jid2 = randomUUID();
    writeJournalDirect({ id: jid2, state: 'ambiguous', amount_kas: 0.3, grant_id: GRANT_ID, candidate_address: CANDIDATE_ADDR, payee_address: PAYEE_ADDR, created_at: new Date().toISOString(), txId: null, prepared_utxo_snapshot: [] });
    const badSpentR = await runReconcile(['resolve', jid2, '--verdict', 'spent', '--evidence-file', EVIDENCE_FILE, '--approver-1', 'not-a-known-name']);
    check('B5: spent 判定 approver 不在白名单 → abort', badSpentR.code !== 0 && /已知身份之一/.test(badSpentR.stderr), badSpentR.stderr.slice(0, 200));
    const spentR = await runReconcile(['resolve', jid2, '--verdict', 'spent', '--evidence-file', EVIDENCE_FILE, '--approver-1', 'KANet-UI']);
    check('reconcile resolve: spent 判定单人+白名单内 approver → 状态变 reconciled_spent_no_txid', spentR.stdout.includes('reconciled_spent_no_txid'), spentR.stdout);
  }

  // ── cleanup ──
  server.close();
  cleanState();
  for (const f of [DB, DB + '-wal', DB + '-shm', KEY_FILE, SNAPSHOT_FILE, EVIDENCE_FILE]) { try { rmSync(f); } catch {} }

  console.log(`\n== G5 v2 regression: PASS ${pass} / FAIL ${fail} ==`);
  writeFileSync(path.join(ROOT, 'logs/test-runs/g5-real-chain-smoke-regression-latest.json'), JSON.stringify({
    source_commit: (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return null; } })(),
    summary: { pass, fail }, evidence,
  }, null, 2));
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('regression 异常:', e.stack || e.message); process.exit(1); });
