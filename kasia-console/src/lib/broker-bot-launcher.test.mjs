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

console.log(`\n[broker-bot-launcher.test] ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
