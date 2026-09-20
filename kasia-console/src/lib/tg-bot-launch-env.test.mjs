// tg-bot-launch-env.test.mjs — CR-1 测试(设计: docs/2026-09-19-kanetui-cr1-cr2-tg-bot-mainnet-guards-change-spec-v0.1.md §3.1 / §3.2)。
// Run: cd kasia-console && node src/lib/tg-bot-launch-env.test.mjs
//
// 三块: ① 纯函数 resolveBotLaunchEnv(每条失败路径都配一条正向对照臂, 证明断言不是恒失败);
//       ② 不泄露: 失败时把 INGEST_SECRET/TOKEN/带凭据的 CONSOLE_URL 设成哨兵串, 断言 problems 不含哨兵;
//       ③ 启动器进程级(spawnSync, 必然失败的环境组合, 不会走到 startBot(), 不联网、不碰 Telegram): exit 1、stderr 含 [launch] FATAL 与键名、
//          stdout+stderr 不含哨兵值; 外加静态断言启动器源码里没有 kanet.env / 3200 / testnet-12 / BROKER_RELAY_ID。
//       通过路径(ok:true 之后真的起 bot)不在自动测试里跑——它会连 Telegram; 由 runbook Stage B 的 B4/B5 在主网开闸后取证(已知缺口, 明示)。
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBotLaunchEnv } from './tg-bot-launch-env.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.error(`  ❌ ${name} ${detail}`); }
};

const SENTINEL_INGEST = 'SENTINEL-INGEST-' + 'a1b2c3d4e5f6';
const SENTINEL_TOKEN = 'SENTINEL-TOKEN-' + '9f8e7d6c5b4a';
const SENTINEL_URLCRED = 'SENTINEL-URLPASS-' + '0011223344';
const good = () => ({ KASPA_NETWORK: 'mainnet', PORT: '3202', INGEST_SECRET: SENTINEL_INGEST, TELEGRAM_BOT_TOKEN: SENTINEL_TOKEN });
const has = (r, key) => r.ok === false && r.problems.some((p) => p.includes(key));
const noLeak = (r) => !JSON.stringify(r).includes('SENTINEL-');

console.log('[test] 正向对照臂: 全部正确 → ok:true');
{
  const r = resolveBotLaunchEnv(good());
  ok('全部正确 → ok:true, consoleUrl 由 PORT 推导', r.ok === true && r.consoleUrl === 'http://127.0.0.1:3202', JSON.stringify(r));
  ok('  scrub 是空数组(env 里没有可删的键)', Array.isArray(r.scrub) && r.scrub.length === 0, JSON.stringify(r));
}

console.log('[test] a. KASPA_NETWORK:');
for (const v of ['testnet-12', 'testnet-10', 'simnet', '', undefined, 'Mainnet']) {
  const e = good(); if (v === undefined) delete e.KASPA_NETWORK; else e.KASPA_NETWORK = v;
  const r = resolveBotLaunchEnv(e);
  ok(`KASPA_NETWORK=${JSON.stringify(v)} → ok:false 且含 KASPA_NETWORK`, has(r, 'KASPA_NETWORK'), JSON.stringify(r));
}

console.log('[test] b. PORT:');
for (const v of ['abc', '0', '70000', '65536', '-1', '3202.5', ' 3202', '03202', '', undefined]) {
  const e = good(); if (v === undefined) delete e.PORT; else e.PORT = v;
  const r = resolveBotLaunchEnv(e);
  ok(`PORT=${JSON.stringify(v)} → ok:false 且含 PORT`, has(r, 'PORT'), JSON.stringify(r));
}
for (const v of ['1', '3202', '65535']) {
  const e = good(); e.PORT = v;
  const r = resolveBotLaunchEnv(e);
  ok(`PORT=${v} → ok:true(边界对照臂), consoleUrl=127.0.0.1:${v}`, r.ok === true && r.consoleUrl === `http://127.0.0.1:${v}`, JSON.stringify(r));
}

console.log('[test] c. CONSOLE_URL:');
{
  const stale = resolveBotLaunchEnv({ ...good(), CONSOLE_URL: 'http://127.0.0.1:3200' });
  ok('继承来的陈值 :3200 而 PORT=3202 → ok:false 且含 CONSOLE_URL', has(stale, 'CONSOLE_URL'), JSON.stringify(stale));
  const other = resolveBotLaunchEnv({ ...good(), CONSOLE_URL: 'https://example.com' });
  ok('指向非本机 console → ok:false', has(other, 'CONSOLE_URL'), JSON.stringify(other));
  const same = resolveBotLaunchEnv({ ...good(), CONSOLE_URL: 'http://127.0.0.1:3202' });
  ok('CONSOLE_URL 等于推导值 → ok:true(对照臂)', same.ok === true, JSON.stringify(same));
  const blank = resolveBotLaunchEnv({ ...good(), CONSOLE_URL: '' });
  ok('CONSOLE_URL 为空串 → 视为未设, ok:true', blank.ok === true, JSON.stringify(blank));
}

console.log('[test] d/e. INGEST_SECRET / TELEGRAM_BOT_TOKEN:');
for (const k of ['INGEST_SECRET', 'TELEGRAM_BOT_TOKEN']) {
  for (const v of ['', '   ', undefined]) {
    const e = good(); if (v === undefined) delete e[k]; else e[k] = v;
    const r = resolveBotLaunchEnv(e);
    ok(`${k}=${JSON.stringify(v)} → ok:false 且含 ${k}`, has(r, k), JSON.stringify(r));
  }
}

console.log('[test] f. KANET_TESTNET_NO_LIMITS:');
for (const v of ['1', '0', '']) {
  const r = resolveBotLaunchEnv({ ...good(), KANET_TESTNET_NO_LIMITS: v });
  ok(`KANET_TESTNET_NO_LIMITS=${JSON.stringify(v)}(键存在即拒, 不看值) → ok:false`, has(r, 'KANET_TESTNET_NO_LIMITS'), JSON.stringify(r));
}

console.log('[test] 多个问题一起报(不是遇错即停):');
{
  const r = resolveBotLaunchEnv({ KASPA_NETWORK: 'testnet-12' });
  ok('缺一堆 → problems 同时含 KASPA_NETWORK / PORT / INGEST_SECRET / TELEGRAM_BOT_TOKEN', ['KASPA_NETWORK', 'PORT', 'INGEST_SECRET', 'TELEGRAM_BOT_TOKEN'].every((k) => has(r, k)), JSON.stringify(r));
  const n = resolveBotLaunchEnv(undefined);
  ok('env 为 undefined 不抛, ok:false', n.ok === false && n.problems.length >= 3, JSON.stringify(n));
}

console.log('[test] 不泄露: 失败用例里所有敏感值都是哨兵串, problems 里一个都不许出现:');
{
  const cases = [
    { ...good(), KASPA_NETWORK: 'testnet-12' },
    { ...good(), PORT: 'abc' },
    { ...good(), CONSOLE_URL: `http://user:${SENTINEL_URLCRED}@127.0.0.1:3200/path?token=${SENTINEL_TOKEN}` },
    { ...good(), INGEST_SECRET: '' },
    { ...good(), TELEGRAM_BOT_TOKEN: '' },
    { ...good(), KANET_TESTNET_NO_LIMITS: '1' },
    { ...good(), KASPA_NETWORK: 'testnet-12', PORT: '0', CONSOLE_URL: `http://x:${SENTINEL_URLCRED}@h:1`, KANET_TESTNET_NO_LIMITS: SENTINEL_TOKEN },
  ];
  cases.forEach((e, i) => { const r = resolveBotLaunchEnv(e); ok(`失败用例 #${i + 1}: ok:false 且 problems 不含任何哨兵串`, r.ok === false && noLeak(r), JSON.stringify(r)); });
  const cu = resolveBotLaunchEnv({ ...good(), CONSOLE_URL: `http://user:${SENTINEL_URLCRED}@127.0.0.1:3200/p` });
  ok('CONSOLE_URL 不一致时只打印 origin(主机:端口), 不带 userinfo/路径', has(cu, 'http://127.0.0.1:3200') && noLeak(cu), JSON.stringify(cu));
  const bad = resolveBotLaunchEnv({ ...good(), CONSOLE_URL: 'not a url' });
  ok('CONSOLE_URL 解析不了 → 固定占位(不回显原串)', has(bad, '(unparseable)') && !JSON.stringify(bad).includes('not a url'), JSON.stringify(bad));
}

console.log('[test] scrub 黑名单:');
{
  const r = resolveBotLaunchEnv({ ...good(), CONSOLE_ENCRYPTION_KEY: 'x', ADMIN_SECRET_FUNDS: 'y', ADMIN_SECRET_ZK_STATE_PREP: 'z', RELAY_KEY_EXPORT_ENABLED_UNTIL: '1', SystemRoot: 'C:\\Windows', PATH: 'p' });
  ok('ok:true', r.ok === true, JSON.stringify(r));
  ok('scrub 含 CONSOLE_ENCRYPTION_KEY / ADMIN_SECRET_FUNDS / ADMIN_SECRET_ZK_STATE_PREP / RELAY_KEY_EXPORT_ENABLED_UNTIL',
    ['CONSOLE_ENCRYPTION_KEY', 'ADMIN_SECRET_FUNDS', 'ADMIN_SECRET_ZK_STATE_PREP', 'RELAY_KEY_EXPORT_ENABLED_UNTIL'].every((k) => r.scrub.includes(k)), JSON.stringify(r.scrub));
  ok('scrub 不含 PORT / KASPA_NETWORK / INGEST_SECRET(bot 需要) / TELEGRAM_BOT_TOKEN / SystemRoot / PATH',
    ['PORT', 'KASPA_NETWORK', 'INGEST_SECRET', 'TELEGRAM_BOT_TOKEN', 'SystemRoot', 'PATH'].every((k) => !r.scrub.includes(k)), JSON.stringify(r.scrub));
  ok('scrub 只列 env 里真存在的键(不凭空列)', r.scrub.length === 4, JSON.stringify(r.scrub));
}

console.log('[test] 启动器进程级(spawnSync; 必然失败的组合, 不会走到 startBot, 不联网):');
{
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const CONSOLE_DIR = path.resolve(HERE, '..', '..');
  const launcher = path.join(CONSOLE_DIR, '_launch_tg_bot.mjs');
  const baseEnv = { PATH: process.env.PATH || '', SystemRoot: process.env.SystemRoot || '' };
  const run = (env) => spawnSync(process.execPath, [launcher], { cwd: CONSOLE_DIR, env: { ...baseEnv, ...env }, encoding: 'utf8', timeout: 30000 });

  const p = run({ KASPA_NETWORK: 'testnet-12', PORT: '3202', CONSOLE_URL: `http://u:${SENTINEL_URLCRED}@127.0.0.1:3200`, INGEST_SECRET: SENTINEL_INGEST, TELEGRAM_BOT_TOKEN: SENTINEL_TOKEN, CONSOLE_ENCRYPTION_KEY: 'SENTINEL-ENCKEY-deadbeef' });
  const all = (p.stdout || '') + (p.stderr || '');
  ok('测试网环境 → exit code 1', p.status === 1, `status=${p.status} signal=${p.signal} out=${all.slice(0, 200)}`);
  ok('stderr 含 [launch] FATAL 与 KASPA_NETWORK / CONSOLE_URL 键名', /\[launch\] FATAL/.test(p.stderr || '') && /KASPA_NETWORK/.test(p.stderr || '') && /CONSOLE_URL/.test(p.stderr || ''), (p.stderr || '').slice(0, 300));
  ok('stdout+stderr 不含任何哨兵值(INGEST / TOKEN / URL 凭据 / 加密密钥)', !/SENTINEL-/.test(all), all.slice(0, 300));
  ok('没有走到 bot 启动(stdout 无 "[launch] network=" 成功行)', !/\[launch\] network=/.test(p.stdout || ''), (p.stdout || '').slice(0, 200));

  const p2 = run({ KASPA_NETWORK: 'mainnet', PORT: '3202', INGEST_SECRET: SENTINEL_INGEST });   // 缺 token → 必然失败, 仍不联网
  ok('主网环境但缺 TELEGRAM_BOT_TOKEN → exit 1 且只说键名', p2.status === 1 && /TELEGRAM_BOT_TOKEN/.test(p2.stderr || '') && !/SENTINEL-/.test((p2.stdout || '') + (p2.stderr || '')), `status=${p2.status} ${(p2.stderr || '').slice(0, 200)}`);

  const src = readFileSync(launcher, 'utf8');
  for (const pat of ['kanet\\.env', '3200', 'testnet-12', 'BROKER_RELAY_ID', 'readFileSync']) {
    ok(`静态: 启动器源码里 /${pat}/ = 0 命中`, !new RegExp(pat).test(src));
  }
}

console.log(`\n[tg-bot-launch-env.test] ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
