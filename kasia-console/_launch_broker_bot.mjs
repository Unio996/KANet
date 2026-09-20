// Per-broker TG bot launcher — forked by src/services/broker-bot-manager.js (one process per
// approved external broker, so each @BotFather token has exactly one grammy poller → no 409 Conflict).
// The per-broker token + broker identity are passed via fork ENV by the manager ({ ...process.env, TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME, BROKER_ADDRESS }).
// NEVER prints the token. Run (manager only): node _launch_broker_bot.mjs
//
// S3 (NWT 审 S3 / Bettor 批, D-031 复用): 与 _launch_tg_bot.mjs(CR-1) 同型修——INHERIT the console's environment and fail closed when it is not a mainnet console's:
//   * 之前 `CONSOLE_URL || 'http://127.0.0.1:3200'` / `KASPA_NETWORK || 'testnet-12'` 的回落: 主网 env 没设 CONSOLE_URL ⇒ 一旦有 broker 入驻就把主网 ingest secret 发往退役的 TN12 端口——已删除。
//   * network/port/ingest secret 全部来自继承环境(console 启动时已把 INGEST_SECRET 写进自己的 process.env); 不再 import configs.js / 开库 / 需要 CONSOLE_ENCRYPTION_KEY。
//   * CONSOLE_URL 由 PORT 推导(继承来的陈值被【拒绝】而不是覆盖); 0-key bot 不该持有的键(DB 加密密钥 / ADMIN_SECRET* / 密钥导出窗口)从本进程删掉。
//   * 判定与 CR-1 是同一份纯函数(src/lib/tg-bot-launch-env.mjs), 失败 exit(1) 且只打印键名。
import { resolveBotLaunchEnv } from './src/lib/tg-bot-launch-env.mjs';

const r = resolveBotLaunchEnv(process.env);
if (!r.ok) {
  console.error('[broker-bot launch] FATAL: ' + r.problems.join('; '));
  process.exit(1);
}
process.env.CONSOLE_URL = r.consoleUrl;
for (const k of r.scrub) delete process.env[k];
process.env.TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'KANET_Broker_bot';

console.log('[broker-bot launch] broker=' + (process.env.BROKER_ADDRESS || '?').slice(-12) +
            ' username=' + process.env.TELEGRAM_BOT_USERNAME +
            ' network=mainnet console=' + r.consoleUrl + ' token=set ingest_secret=set scrubbed=' + r.scrub.length);

// bot.mjs creates the grammy Bot from process.env.TELEGRAM_BOT_TOKEN at import; startBot() goes live.
// Each forked process = its own module graph = its own Bot/token/poller (no cross-bot 409).
const { startBot } = await import('../tg-bot/bot.mjs');
startBot();
