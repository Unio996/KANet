// TG bot launcher — forked by services/tg-bot-manager.js (fork() injects { ...process.env, TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME }),
// or run by hand from the kasia-console CWD: node _launch_tg_bot.mjs
//
// CR-1 (docs/2026-09-19-kanetui-cr1-cr2-tg-bot-mainnet-guards-change-spec-v0.1.md §1): this launcher INHERITS the console's environment and fails
// closed when it is not a mainnet console's. It no longer reads any env file, opens no DB, and hard-codes no network / port / broker id:
//   * network/port/token/ingest secret all come from the inherited environment (the console wrote INGEST_SECRET into its own process.env at boot);
//   * CONSOLE_URL is derived from PORT (an inherited stale value is REJECTED, not overwritten);
//   * keys a 0-key/0-custody bot has no business holding (DB encryption key, ADMIN_SECRET*, key-export window) are deleted from this process;
//   * the broker identity resolves at runtime from DB config (tg-bot/config.mjs), never from an env fallback set here.
// Nothing here ever prints a secret value; failures name KEYS only.
import { resolveBotLaunchEnv } from './src/lib/tg-bot-launch-env.mjs';

const r = resolveBotLaunchEnv(process.env);
if (!r.ok) {
  console.error('[launch] FATAL: ' + r.problems.join('; '));
  process.exit(1);
}
process.env.CONSOLE_URL = r.consoleUrl;
for (const k of r.scrub) delete process.env[k];

console.log(`[launch] network=mainnet console=${r.consoleUrl} token=set ingest_secret=set scrubbed=${r.scrub.length}`);

const { startBot } = await import('../tg-bot/bot.mjs'); // import registers handlers (no side-effects)…
await startBot();                                        // …startBot() goes live (grammy bot.start + pollers; now async — 根治 getMe 校验先跑完再 bot.start())
