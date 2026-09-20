// Owner bot launcher — the Owner's DEDICATED dev-coord remote-control bot (owner-in-dev-channel).
// SEPARATE process + token from the broker bot (_launch_tg_bot.mjs). Run from kasia-console CWD:
//   node _launch_owner_bot.mjs
// No-ops with a clear message if OWNER_BOT_TOKEN is unset (Owner has not run @BotFather yet) — so a start script can launch it unconditionally without crashing.
//
// S3 (NWT 审 S3 / Bettor 批 L2=复用非退役, D-031 复用): 与 _launch_tg_bot.mjs(CR-1) 同型修——INHERIT the environment and fail closed when it is not a mainnet console's:
//   * 之前读 ../kanet.env(TN12 那份密钥文件)取 OWNER_BOT_TOKEN/加密密钥、开库解 ingest_secret、并把 CONSOLE_URL=:3200 / KASPA_NETWORK=testnet-12 写死——全部删除。
//   * token/ingest secret/network/port 全来自继承环境; CONSOLE_URL 由 PORT 推导(陈值被拒绝); 不再需要 CONSOLE_ENCRYPTION_KEY、不开库。
//   * 判定是与 CR-1 / broker-bot 同一份纯函数(src/lib/tg-bot-launch-env.mjs), tokenKey=OWNER_BOT_TOKEN; broker bot 的 TELEGRAM_BOT_TOKEN 与 0-key bot 不该持有的键从本进程删掉。
//   * 这【不】让 owner-bot 在主网上"活过来"(主网 console 不 fork 它、没有调用方; 是否启用仍是 Owner 自己设 OWNER_BOT_TOKEN 才发生)——只保证万一被启动时 fail-closed、不再往退役端口发密钥。
import { resolveBotLaunchEnv } from './src/lib/tg-bot-launch-env.mjs';

if (!process.env.OWNER_BOT_TOKEN || !process.env.OWNER_BOT_TOKEN.trim()) {
  console.log('[owner-bot launch] OWNER_BOT_TOKEN not set in the environment — owner bot not started (Owner: @BotFather → /newbot → set OWNER_BOT_TOKEN, then start).');
  process.exit(0);
}

const r = resolveBotLaunchEnv(process.env, { tokenKey: 'OWNER_BOT_TOKEN', scrubExtra: ['TELEGRAM_BOT_TOKEN'] });
if (!r.ok) {
  console.error('[owner-bot launch] FATAL: ' + r.problems.join('; '));
  process.exit(1);
}
process.env.CONSOLE_URL = r.consoleUrl;
for (const k of r.scrub) delete process.env[k];

console.log('[owner-bot launch] network=mainnet console=' + r.consoleUrl + ' token=set ingest_secret=set chat=' + (process.env.OWNER_CHAT_ID ? 'set' : '(config default)') + ' scrubbed=' + r.scrub.length);

const { startOwnerBot } = await import('../tg-bot/owner-bot.mjs'); // import registers handlers (no side-effects)…
startOwnerBot();                                                   // …goes live (grammy bot.start + Direction B poller)
