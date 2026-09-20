// owner-bot-launcher.test.mjs — S3 L2: _launch_owner_bot.mjs 复用 resolveBotLaunchEnv(tokenKey=OWNER_BOT_TOKEN) 后的进程级测试(spawnSync; 失败组合不联网)。
// Run: cd kasia-console && node src/lib/owner-bot-launcher.test.mjs
// 与 broker-bot-launcher.test.mjs 同构: ① OWNER_BOT_TOKEN 未设 ⇒ no-op exit 0(保持"可无条件拉起"的旧语义); ② 必然失败环境 ⇒ exit 1 + FATAL 只含键名; ③ 静态 0 命中(旧 TN12 写死的字面证据);
// ④ 正向对照臂: 合法主网环境 ⇒ 越过判定打出启动行(随即杀掉, 不连 Telegram), 且 scrub 真的把敏感键与 broker bot 的 TELEGRAM_BOT_TOKEN 从本进程环境删了。
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.error(`  ❌ ${name} ${detail}`); } };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONSOLE_DIR = path.resolve(HERE, '..', '..');
const launcher = path.join(CONSOLE_DIR, '_launch_owner_bot.mjs');
const S_ING = 'SENTINEL-INGEST-' + 'a1b2c3d4e5f6', S_OWN = 'SENTINEL-OWNERTOKEN-' + '9f8e7d6c5b4a', S_BRK = 'SENTINEL-BROKERTOKEN-' + '0011aabb22cc', S_URL = 'SENTINEL-URLPASS-' + '0011223344', S_ENC = 'SENTINEL-ENCKEY-' + 'deadbeef';
const baseEnv = { PATH: process.env.PATH || '', SystemRoot: process.env.SystemRoot || '' };
const run = (env) => spawnSync(process.execPath, [launcher], { cwd: CONSOLE_DIR, env: { ...baseEnv, ...env }, encoding: 'utf8', timeout: 30000 });
const good = () => ({ KASPA_NETWORK: 'mainnet', PORT: '3202', INGEST_SECRET: S_ING, OWNER_BOT_TOKEN: S_OWN, OWNER_CHAT_ID: '123456' });
const leak = (p) => /SENTINEL-/.test((p.stdout || '') + (p.stderr || ''));

console.log('[test] ① OWNER_BOT_TOKEN 未设/空白 ⇒ no-op exit 0(旧语义: 可无条件拉起而不崩):');
for (const v of [undefined, '', '   ']) {
  const env = { ...good() }; if (v === undefined) delete env.OWNER_BOT_TOKEN; else env.OWNER_BOT_TOKEN = v;
  const p = run({ ...env, TELEGRAM_BOT_TOKEN: S_BRK });
  ok(`OWNER_BOT_TOKEN=${JSON.stringify(v)} → exit 0 且说明"not started"`, p.status === 0 && /owner bot not started/.test(p.stdout || ''), `status=${p.status} ${(p.stdout || '') + (p.stderr || '')}`.slice(0, 200));
  ok('  不泄露、不报 FATAL', !leak(p) && !/FATAL/.test((p.stdout || '') + (p.stderr || '')));
}

console.log('[test] ② 有 token 但环境不对 ⇒ exit 1, FATAL 只含键名:');
{
  const cases = [
    ['旧泄漏场景: 网络是测试网+陈旧 :3200+带凭据 URL', { ...good(), KASPA_NETWORK: 'testnet-12', CONSOLE_URL: `http://u:${S_URL}@127.0.0.1:3200`, CONSOLE_ENCRYPTION_KEY: S_ENC }, ['KASPA_NETWORK', 'CONSOLE_URL']],
    ['KASPA_NETWORK 未设', (() => { const e = good(); delete e.KASPA_NETWORK; return e; })(), ['KASPA_NETWORK']],
    ['PORT 未设', (() => { const e = good(); delete e.PORT; return e; })(), ['PORT']],
    ['CONSOLE_URL 陈值', { ...good(), CONSOLE_URL: 'http://127.0.0.1:3200' }, ['CONSOLE_URL']],
    ['缺 INGEST_SECRET', (() => { const e = good(); delete e.INGEST_SECRET; return e; })(), ['INGEST_SECRET']],
    ['KANET_TESTNET_NO_LIMITS(小写键名)', { ...good(), kanet_testnet_no_limits: '1' }, ['KANET_TESTNET_NO_LIMITS']],
  ];
  for (const [name, env, keys] of cases) {
    const p = run({ ...env, TELEGRAM_BOT_TOKEN: S_BRK });
    ok(`${name} → exit 1`, p.status === 1, `status=${p.status} err=${(p.stderr || '').slice(0, 200)}`);
    ok('  stderr 含 [owner-bot launch] FATAL 与键名, 无哨兵值, 没走到启动行', /\[owner-bot launch\] FATAL/.test(p.stderr || '') && keys.every((k) => (p.stderr || '').includes(k)) && !leak(p) && !/network=mainnet console=/.test(p.stdout || ''), (p.stderr || '').slice(0, 300));
  }
}

console.log('[test] ③ 静态: 旧 TN12 写死的字面证据已不在启动器代码行里:');
{
  const src = readFileSync(launcher, 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  for (const [label, re] of [[':3200', /3200/], ['testnet-12', /testnet-12/], ['configs.js / getConfig(开库解密)', /configs\.js|getConfig/], ['readFileSync(读 env 文件)', /readFileSync/], ['kanet.env', /kanet\.env/], ['CONSOLE_ENCRYPTION_KEY 依赖', /CONSOLE_ENCRYPTION_KEY/], ['process.env.X = 覆盖 CONSOLE_URL 为写死值', /process\.env\.CONSOLE_URL = '/]]) ok(`代码行里 ${label} = 0 命中`, !re.test(code));
  ok('复用同一份判定(tokenKey=OWNER_BOT_TOKEN, scrubExtra 含 TELEGRAM_BOT_TOKEN)', /resolveBotLaunchEnv\(process\.env, \{ tokenKey: 'OWNER_BOT_TOKEN', scrubExtra: \['TELEGRAM_BOT_TOKEN'\] \}\)/.test(src));
}

console.log('[test] ④ 正向对照臂: 合法主网环境 ⇒ 启动行(随即杀掉), scrub 真删键:');
const PRELOAD = 'globalThis.fetch=()=>Promise.reject(new Error("blocked-by-test"));const ol=console.log;console.log=(...a)=>{ol(...a);ol("[ENVCHECK] left="+["CONSOLE_ENCRYPTION_KEY","ADMIN_SECRET_FUNDS","Admin_Secret_Zk","TELEGRAM_BOT_TOKEN"].filter((k)=>k in process.env).join(",")+" kept="+["OWNER_BOT_TOKEN","INGEST_SECRET","OWNER_CHAT_ID","PORT","KASPA_NETWORK","CONSOLE_URL"].filter((k)=>k in process.env).join(","))};';
await new Promise((resolve) => {
  const child = spawn(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(PRELOAD), launcher], { cwd: CONSOLE_DIR, env: { ...baseEnv, ...good(), TELEGRAM_BOT_TOKEN: S_BRK, CONSOLE_ENCRYPTION_KEY: S_ENC, ADMIN_SECRET_FUNDS: 'x', Admin_Secret_Zk: 'y' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '', done = false;
  const finish = (line) => {
    if (done) return; done = true; try { child.kill(); } catch { /* */ }
    const envline = out.split('\n').find((l) => l.startsWith('[ENVCHECK]')) || '';
    ok('打出 "[owner-bot launch] network=mainnet console=http://127.0.0.1:3202 … scrubbed=4" 行', !!line && /network=mainnet console=http:\/\/127\.0\.0\.1:3202 token=set ingest_secret=set chat=set scrubbed=4$/.test(line), line || `out=${out.slice(0, 200)} err=${err.slice(0, 200)}`);
    ok('  启动行不含任何密钥值/chat id 值', !!line && !/SENTINEL-|123456/.test(line), line);
    ok('scrub 真的删了 DB 加密密钥 / ADMIN_SECRET*(含混合大小写)/ broker bot 的 TELEGRAM_BOT_TOKEN', /^\[ENVCHECK\] left= kept=/.test(envline), envline);
    ok('  必须留下的键都还在(OWNER_BOT_TOKEN / INGEST_SECRET / OWNER_CHAT_ID / PORT / KASPA_NETWORK / 推导的 CONSOLE_URL)', /kept=OWNER_BOT_TOKEN,INGEST_SECRET,OWNER_CHAT_ID,PORT,KASPA_NETWORK,CONSOLE_URL$/.test(envline), envline);
    ok('  没有 FATAL', !/FATAL/.test(out + err));
    resolve();
  };
  child.stdout.on('data', (d) => { out += d; const lines = out.split('\n'); const m = lines.find((l) => l.startsWith('[owner-bot launch] network=')); if (m && lines.some((l) => l.startsWith('[ENVCHECK]'))) finish(m); });
  child.stderr.on('data', (d) => { err += d; if (/FATAL/.test(err)) finish(null); });
  child.on('exit', () => finish(null));
  setTimeout(() => finish(null), 20000);
});

console.log(`\n[owner-bot-launcher.test] ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
