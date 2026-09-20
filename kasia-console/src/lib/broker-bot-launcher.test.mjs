// broker-bot-launcher.test.mjs — S3 L1: _launch_broker_bot.mjs 复用 resolveBotLaunchEnv 后的进程级测试(spawnSync; 失败组合不联网)。
// Run: cd kasia-console && node src/lib/broker-bot-launcher.test.mjs
//   ① 必然失败的环境组合 ⇒ exit 1 + [broker-bot launch] FATAL + 只打键名、stdout+stderr 不含哨兵值;
//   ② 静态: 启动器源码不再含 :3200 / testnet-12 / configs.js / getConfig / readFileSync / 对 CONSOLE_URL·KASPA_NETWORK 的 `||` 回落(旧 S3 泄漏的字面证据);
//   ③ 正向对照臂: 合法主网环境 ⇒ 越过判定(打出 "network=mainnet console=…" 行, 而不是 FATAL)——看到该行即杀子进程(不让它去连 Telegram; 全局 fetch 也被预载脚本封死);
//   通过路径之后真的起 bot(getMe/长轮询)不在自动测试里, 由 Stage B 取证(已知缺口, 明示)。
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeImportProbe } from './launcher-import-probe.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.error(`  ❌ ${name} ${detail}`); } };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONSOLE_DIR = path.resolve(HERE, '..', '..');
const launcher = path.join(CONSOLE_DIR, '_launch_broker_bot.mjs');
const S_ING = 'SENTINEL-INGEST-' + 'a1b2c3d4e5f6', S_TOK = 'SENTINEL-BROKERTOKEN-' + '9f8e7d6c5b4a', S_URL = 'SENTINEL-URLPASS-' + '0011223344', S_ENC = 'SENTINEL-ENCKEY-' + 'deadbeef';
const baseEnv = { PATH: process.env.PATH || '', SystemRoot: process.env.SystemRoot || '' };
const run = (env) => spawnSync(process.execPath, [launcher], { cwd: CONSOLE_DIR, env: { ...baseEnv, ...env }, encoding: 'utf8', timeout: 30000 });
const good = () => ({ KASPA_NETWORK: 'mainnet', PORT: '3202', INGEST_SECRET: S_ING, TELEGRAM_BOT_TOKEN: S_TOK, BROKER_ADDRESS: 'kaspa:qqexampleexample0123456789' });
const leak = (p) => /SENTINEL-/.test((p.stdout || '') + (p.stderr || ''));

console.log('[test] ① 必然失败的环境 ⇒ exit 1, FATAL 只含键名, 不泄露:');
{
  const cases = [
    ['旧泄漏场景: 主网 env 未设 CONSOLE_URL、网络仍是测试网、带陈旧 :3200 与凭据', { ...good(), KASPA_NETWORK: 'testnet-12', CONSOLE_URL: `http://u:${S_URL}@127.0.0.1:3200`, CONSOLE_ENCRYPTION_KEY: S_ENC }, ['KASPA_NETWORK', 'CONSOLE_URL']],
    ['KASPA_NETWORK 未设(旧代码会回落 testnet-12)', (() => { const e = good(); delete e.KASPA_NETWORK; return e; })(), ['KASPA_NETWORK']],
    ['PORT 未设(旧代码会回落 :3200)', (() => { const e = good(); delete e.PORT; return e; })(), ['PORT']],
    ['继承来的 CONSOLE_URL 是陈值 :3200 而 PORT=3202', { ...good(), CONSOLE_URL: 'http://127.0.0.1:3200' }, ['CONSOLE_URL']],
    ['缺 INGEST_SECRET(旧代码会去库里解密)', (() => { const e = good(); delete e.INGEST_SECRET; return e; })(), ['INGEST_SECRET']],
    ['缺 TELEGRAM_BOT_TOKEN', (() => { const e = good(); delete e.TELEGRAM_BOT_TOKEN; return e; })(), ['TELEGRAM_BOT_TOKEN']],
    ['KANET_TESTNET_NO_LIMITS 出现(小写键名也算)', { ...good(), kanet_testnet_no_limits: '1' }, ['KANET_TESTNET_NO_LIMITS']],
  ];
  for (const [name, env, keys] of cases) {
    const p = run(env);
    ok(`${name} → exit 1`, p.status === 1, `status=${p.status} err=${(p.stderr || '').slice(0, 200)}`);
    ok('  stderr 含 [broker-bot launch] FATAL 与相关键名', /\[broker-bot launch\] FATAL/.test(p.stderr || '') && keys.every((k) => (p.stderr || '').includes(k)), (p.stderr || '').slice(0, 300));
    ok('  stdout+stderr 不含任何哨兵值', !leak(p), ((p.stdout || '') + (p.stderr || '')).slice(0, 300));
    ok('  没有走到启动行', !/network=mainnet console=/.test(p.stdout || ''));
  }
}

console.log('[test] ①b exit(1) 语义(NWT 审出的缺口): FATAL 之后启动器必须【立刻退出】——bot.mjs 从未被 import、没有启动行、stderr 恰好一行 FATAL(没有崩溃栈):');
// 为什么需要它: 失败裁决里没有 scrub, 删掉 process.exit(1) 后 `for (const k of r.scrub)` 会抛 TypeError, 进程"碰巧"仍 exit 1 ⇒ 只断言 exit code 的老测试照绿。
// 所以: (A) 真裁决用例额外断言 stderr 干净(无 TypeError/栈); (B) 桩裁决用例——失败裁决但带齐 consoleUrl/scrub——让"失败后继续往下走"不被碰巧的 TypeError 截断, 此时只有显式 exit(1) 能拦住 import。
const probe = makeImportProbe();
const runP = (env, stub) => spawnSync(process.execPath, [...probe.nodeArgs(), launcher], { cwd: CONSOLE_DIR, env: { ...baseEnv, ...env, ...probe.env(stub) }, encoding: 'utf8', timeout: 30000 });
const errLines = (p) => (p.stderr || '').split('\n').map((l) => l.trim()).filter(Boolean);
const waitImport = (env, stub) => new Promise((resolve) => {
  probe.reset();
  const child = spawn(process.execPath, [...probe.nodeArgs(), launcher], { cwd: CONSOLE_DIR, env: { ...baseEnv, ...env, ...probe.env(stub) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', done = false;
  const finish = () => { if (done) return; done = true; clearInterval(iv); try { child.kill(); } catch { /* */ } resolve({ imports: probe.imports(), out }); };
  child.stdout.on('data', (d) => { out += d; });
  const iv = setInterval(() => { if (probe.imports().length) finish(); }, 40);
  child.on('exit', finish);
  setTimeout(finish, 20000);
});
{
  probe.reset();
  const a = runP({ ...good(), KASPA_NETWORK: 'testnet-12' });   // 配置齐全(secret/token/PORT 都在), 只有网络不对
  ok('A 配置齐全但 KASPA_NETWORK=testnet-12 → exit 1', a.status === 1, `status=${a.status}`);
  ok('  stderr 恰好一行且是 FATAL(没有 TypeError / 栈——那是"碰巧崩"不是"显式退出")', errLines(a).length === 1 && /^\[broker-bot launch\] FATAL: /.test(errLines(a)[0]), (a.stderr || '').slice(0, 300));
  ok('  bot.mjs 从未被 import', probe.imports().length === 0, JSON.stringify(probe.imports()));
  ok('  stdout 没有启动行', !/network=mainnet console=|broker=/.test(a.stdout || ''), a.stdout);

  probe.reset();
  const b = runP(good(), 'fail');   // 桩: 失败裁决 + 带齐 consoleUrl/scrub(即使环境本身是合法主网)
  ok('B 桩失败裁决(带 consoleUrl/scrub) → exit 1', b.status === 1, `status=${b.status} err=${(b.stderr || '').slice(0, 200)}`);
  ok('  stderr 恰好一行 FATAL 且含桩的问题串(证明桩真被用上)', errLines(b).length === 1 && /^\[broker-bot launch\] FATAL: STUB-FAIL$/.test(errLines(b)[0]), (b.stderr || '').slice(0, 300));
  ok('  bot.mjs 从未被 import; stdout 没有启动行', probe.imports().length === 0 && !/network=mainnet console=|broker=/.test(b.stdout || ''), JSON.stringify(probe.imports()) + (b.stdout || ''));

  // 正向对照臂: 探针与桩在成功路径上真的会记下 import(否则上面的"从未 import"是空话)
  const c = await waitImport(good(), undefined);
  ok('C1 对照: 合法主网环境(真裁决) ⇒ 探针记到 bot.mjs 被 import', c.imports.length === 1 && /tg-bot[\\/]bot\.mjs$/.test(c.imports[0]), JSON.stringify(c.imports));
  const d = await waitImport(good(), 'ok');
  ok('C2 对照: 桩成功裁决 ⇒ 探针记到 bot.mjs 被 import(桩机制在工作)', d.imports.length === 1 && /tg-bot[\\/]bot\.mjs$/.test(d.imports[0]), JSON.stringify(d.imports));
}

console.log('[test] ② 静态: 旧 S3 泄漏的字面证据已不在启动器源码里:');
{
  const src = readFileSync(launcher, 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');   // 只看代码行(注释里允许解释历史)
  for (const [label, re] of [[':3200', /3200/], ['testnet-12', /testnet-12/], ['configs.js / getConfig(开库解密)', /configs\.js|getConfig/], ['readFileSync(读 env 文件)', /readFileSync/], ['kanet.env', /kanet\.env/], ['对 CONSOLE_URL/KASPA_NETWORK 的 || 回落', /process\.env\.(CONSOLE_URL|KASPA_NETWORK)\s*\|\|/], ['CONSOLE_ENCRYPTION_KEY 依赖', /CONSOLE_ENCRYPTION_KEY/]]) ok(`代码行里 ${label} = 0 命中`, !re.test(code));
  ok('复用同一份判定(import resolveBotLaunchEnv)', /import \{ resolveBotLaunchEnv \} from '\.\/src\/lib\/tg-bot-launch-env\.mjs'/.test(src) && /resolveBotLaunchEnv\(process\.env\)/.test(src));
}

console.log('[test] ③ 正向对照臂: 合法主网环境 ⇒ 越过判定, 打出启动行(随即杀掉, 不连 Telegram):');
// 预载脚本: 封死全局 fetch; 并在每次 console.log 之后追加一行 [ENVCHECK](本进程 process.env 里【还剩哪些】敏感键 + 必须留下的键)——用来证明 scrub 真的把键从环境里删了, 而不只是"报了个数"
const PRELOAD = 'globalThis.fetch=()=>Promise.reject(new Error("blocked-by-test"));const ol=console.log;console.log=(...a)=>{ol(...a);ol("[ENVCHECK] left="+["CONSOLE_ENCRYPTION_KEY","ADMIN_SECRET_FUNDS","Admin_Secret_Zk"].filter((k)=>k in process.env).join(",")+" kept="+["INGEST_SECRET","TELEGRAM_BOT_TOKEN","PORT","KASPA_NETWORK","CONSOLE_URL"].filter((k)=>k in process.env).join(","))};';
await new Promise((resolve) => {
  const child = spawn(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(PRELOAD), launcher], { cwd: CONSOLE_DIR, env: { ...baseEnv, ...good(), CONSOLE_ENCRYPTION_KEY: S_ENC, ADMIN_SECRET_FUNDS: 'x', Admin_Secret_Zk: 'y' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '', done = false;
  const finish = (line) => {
    if (done) return; done = true; try { child.kill(); } catch { /* */ }
    const envline = out.split('\n').find((l) => l.startsWith('[ENVCHECK]')) || '';
    ok('scrub 真的把敏感键从本进程环境删了(left= 为空, 含大小写混合的 Admin_Secret_Zk)', /^\[ENVCHECK\] left= kept=/.test(envline), envline);
    ok('  必须留下的键都还在(INGEST_SECRET / TELEGRAM_BOT_TOKEN / PORT / KASPA_NETWORK / 推导出的 CONSOLE_URL)', /kept=INGEST_SECRET,TELEGRAM_BOT_TOKEN,PORT,KASPA_NETWORK,CONSOLE_URL$/.test(envline), envline);
    ok('打出 "[broker-bot launch] … network=mainnet console=http://127.0.0.1:3202 … scrubbed=3" 行', !!line && /network=mainnet console=http:\/\/127\.0\.0\.1:3202 token=set ingest_secret=set scrubbed=3/.test(line), line || `out=${out.slice(0, 200)} err=${err.slice(0, 200)}`);
    ok('  启动行只带 broker 末 12 位、用户名与状态, 不含任何密钥值', !!line && !/SENTINEL-/.test(line) && line.includes('broker=') && !line.includes('kaspa:qq'), line);
    ok('  没有 FATAL', !/FATAL/.test(out + err));
    resolve();
  };
  child.stdout.on('data', (d) => { out += d; const lines = out.split('\n'); const m = lines.find((l) => l.startsWith('[broker-bot launch] broker=')); if (m && lines.some((l) => l.startsWith('[ENVCHECK]'))) finish(m); });
  child.stderr.on('data', (d) => { err += d; if (/FATAL/.test(err)) finish(null); });
  child.on('exit', () => finish(null));
  setTimeout(() => finish(null), 20000);
});

probe.cleanup();
console.log(`\n[broker-bot-launcher.test] ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
