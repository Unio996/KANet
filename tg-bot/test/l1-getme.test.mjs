// L1 — Telegram transport check (Bettor r954 全自动测试 L1).
//
// Verifies the bot can connect to Telegram: a real getMe() round-trip with the configured token.
// This proves transport only (token valid + Telegram reachable). It does NOT prove the bot's
// handler logic — that's L2 (mock-update → handler → assert). Honest boundary (J1 co-review angle):
// L1 = "the wire works", L2 = "the logic is right", L4 = "a real user round-trip works end-to-end".
//
// getMe is read-only and does NOT conflict with a running bot's getUpdates poller (different method).
// Run:  node tg-bot/test/l1-getme.test.mjs   (lives in tg-bot/ so grammy resolves from tg-bot/node_modules)

import { Bot } from 'grammy';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${detail ? ` (${detail})` : ''}`); fail++; }
}

// token from kanet.env (same source as _launch_tg_bot.mjs) — fall back to env.
let token = process.env.TELEGRAM_BOT_TOKEN || '';
if (!token) {
  try {
    const env = readFileSync(new URL('../../kanet.env', import.meta.url), 'utf8');
    token = (env.match(/^TELEGRAM_BOT_TOKEN=(.*)$/m) || [])[1]?.trim() || '';
  } catch { /* no kanet.env */ }
}

if (!token) {
  console.log('  ✗ L1 getMe — no TELEGRAM_BOT_TOKEN (kanet.env / env)');
  console.log('\nL1: 0/1 PASS');
  process.exit(1);
}

const bot = new Bot(token);
try {
  const me = await bot.api.getMe();
  check('L1 getMe — bot connected to Telegram (transport)', !!me?.id && me.is_bot === true, JSON.stringify(me).slice(0, 80));
  check('L1 getMe — username present', !!me?.username, `username=${me?.username}`);
  console.log(`  bot: @${me.username} (id ${me.id})`);
} catch (e) {
  check('L1 getMe — bot connected to Telegram (transport)', false, e?.error?.description || e?.message || String(e));
}

console.log(`\nL1: ${pass}/${pass + fail} PASS`);
process.exit(fail > 0 ? 1 : 0);
