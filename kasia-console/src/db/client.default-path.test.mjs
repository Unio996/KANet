// client.js 库路径解析 V1–V6(2026-08-28 J2 · Bettor/NWT 裁入口感知 throw 形)。跑: node kasia-console/src/db/client.default-path.test.mjs
// 🔴 零 live: 本进程 import client.js 前把 DB_PATH 指到临时库(V3 同时验覆盖生效); V1/V2/V5/V6 测纯函数 resolveDbPath(不读 cwd/不碰文件);
//    V4/V5 用子进程从【mkdtemp 目录】起(真变 cwd), V5 子进程无 DB_PATH ⇒ 必 throw 且零建目录; 从不打开 kasia-console/data/console.db。
import assert from 'node:assert';
import { mkdtempSync, existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const CLIENT = join(HERE, 'client.js');
const LIVE = resolve(REPO, 'kasia-console', 'data', 'console.db');
const CONSOLE_ENTRY = resolve(REPO, 'kasia-console', 'src', 'index.js');
const dir = mkdtempSync(join(tmpdir(), 'client-path-'));
const tmpDb = join(dir, 'v3', 'probe.db');
process.env.DB_PATH = tmpDb;
const { resolveDbPath, exportDbPathToEnv, DB_PATH_REFUSE_MSG, dbPath } = await import(pathToFileURL(CLIENT).href);

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const norm = (p) => resolve(p).replace(/\\/g, '/').toLowerCase();

t('V3 DB_PATH 覆盖生效且建库成功(不拒建): 本进程 dbPath === 临时路径, 文件已建', () => {
  assert.strictEqual(norm(dbPath), norm(tmpDb)); assert.ok(existsSync(tmpDb), '临时库未建');
});
t('V1 console 入口 + 无 DB_PATH ⇒ 解析 = <repo>/kasia-console/data/console.db(纯函数, 与 cwd 无关)', () => {
  const r = resolveDbPath({}, pathToFileURL(CLIENT).href, CONSOLE_ENTRY);
  assert.strictEqual(norm(r.path), norm(LIVE)); assert.strictEqual(r.source, 'default(console-entry)');
});
t('V2 任意 cwd(子进程从 mkdtemp 目录起, DB_PATH 指临时库) 调 resolveDbPath({}, …, console 入口) ⇒ 同值; KANET_CONSOLE_ENTRY=1 亦同', () => {
  const child = join(dir, 'v2.mjs');
  writeFileSync(child, `const m = await import(${JSON.stringify(pathToFileURL(CLIENT).href)});
const a = m.resolveDbPath({}, ${JSON.stringify(pathToFileURL(CLIENT).href)}, ${JSON.stringify(CONSOLE_ENTRY)});
const b = m.resolveDbPath({ KANET_CONSOLE_ENTRY: '1' }, ${JSON.stringify(pathToFileURL(CLIENT).href)}, 'C:/anything/else.mjs');
console.log(JSON.stringify({ a, b, cwd: process.cwd() }));`);
  const r = spawnSync(process.execPath, [child], { cwd: dir, encoding: 'utf8', env: { ...process.env, DB_PATH: join(dir, 'v2.db') } });
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(norm(out.cwd), norm(dir), '子进程 cwd 应是临时目录');
  assert.strictEqual(norm(out.a.path), norm(LIVE)); assert.strictEqual(norm(out.b.path), norm(LIVE));
});
t('V4 加载时打印一行 [db] path=<abs> source=DB_PATH(子进程 stdout)', () => {
  const child = join(dir, 'v4.mjs');
  writeFileSync(child, `await import(${JSON.stringify(pathToFileURL(CLIENT).href)}); console.log('imported');`);
  const r = spawnSync(process.execPath, [child], { cwd: dir, encoding: 'utf8', env: { ...process.env, DB_PATH: join(dir, 'v4.db') } });
  assert.strictEqual(r.status, 0, r.stderr);
  const line = r.stdout.split('\n').find((l) => l.startsWith('[db] path='));
  assert.ok(line, '无 [db] 行'); assert.ok(norm(line.slice('[db] path='.length).split(' source=')[0]) === norm(join(dir, 'v4.db')));
  assert.ok(line.endsWith('source=DB_PATH'));
});
t('V5 非 console 入口 + 无 DB_PATH ⇒ import 即 throw(固定文案), 退出非 0, 且 cwd 下零建 data/ 目录、不碰 live', () => {
  const child = join(dir, 'v5.mjs');
  writeFileSync(child, `await import(${JSON.stringify(pathToFileURL(CLIENT).href)}); console.log('SHOULD-NOT-REACH');`);
  const env = { ...process.env }; delete env.DB_PATH; delete env.KANET_CONSOLE_ENTRY;
  const before = readdirSync(dir).sort();   // V2/V4 已在本目录留了自己的临时库 ⇒ 用前后快照, 只看 V5 有没有新建
  const r = spawnSync(process.execPath, [child], { cwd: dir, encoding: 'utf8', env });
  assert.notStrictEqual(r.status, 0, 'import 竟成功');
  assert.ok(r.stderr.includes(DB_PATH_REFUSE_MSG), `stderr 缺固定文案: ${r.stderr.slice(0, 200)}`);
  assert.ok(!r.stdout.includes('SHOULD-NOT-REACH')); assert.ok(!r.stdout.includes('[db] path='), 'throw 形不该打印路径行');
  assert.ok(!existsSync(join(dir, 'data')), 'cwd 下建了 data/ ⇒ throw 晚于 mkdirSync');
  assert.deepStrictEqual(readdirSync(dir).sort(), before, 'V5 子进程在 cwd 下新建了文件');
});
t('V6 console 入口默认解析后回写 env(子进程继承); DB_PATH 已有则不动', () => {
  const r = resolveDbPath({}, pathToFileURL(CLIENT).href, CONSOLE_ENTRY);
  const env = {}; assert.strictEqual(exportDbPathToEnv(r, env), true); assert.strictEqual(norm(env.DB_PATH), norm(LIVE));
  const env2 = { DB_PATH: 'x.db' }; const r2 = resolveDbPath(env2, pathToFileURL(CLIENT).href, 'C:/other.mjs');
  assert.strictEqual(exportDbPathToEnv(r2, env2), false); assert.strictEqual(env2.DB_PATH, 'x.db');
  // 阴性对照: 入口判据是"以 kasia-console/src/index.js 结尾", 长得像但不是的路径必 throw
  assert.throws(() => resolveDbPath({}, pathToFileURL(CLIENT).href, resolve(REPO, 'kasia-console', 'src', 'index.js.bak')), /refusing to default to live/);
  assert.throws(() => resolveDbPath({}, pathToFileURL(CLIENT).href, undefined), /refusing to default to live/);
});
rmSync(dir, { recursive: true, force: true });
console.log(`\n${fail === 0 ? '✅' : '🔴'} client default-path: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
