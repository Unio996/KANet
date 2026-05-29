// S5 half-2 (Bettor r211/r212) — TG bot 0-write / 0-custody test.
//
// The TG bot is a reach/notification layer, NOT a trust layer. It exposes 0 endpoints that can
// write/sign/move value. The ONLY mutation it permits is the user's own notification subscription
// (user_notification_prefs subscribe/unsubscribe). Any escrow/settle/dispute/sign/transfer write
// path in the bot = hard fail.
//
// Pairs with the compile-time guard: scripts/lint-kanet.mjs rule S5 (0-key — bot can't import/call
// any key/signing primitive or execute a value/sign relay command). lint = compile-time, this = test-time.
//
// status: spec/stub — the bot service (S4) is token-gated (Owner @BotFather) and not yet built.
// Becomes runnable when tg-bot/ ships. Baked-from-start so S4 must satisfy it.

export default {
  id: 'tg_bot_zero_write_endpoints',
  description: 'S5: TG bot exposes 0 write/sign/value endpoints except user_notification_prefs subscribe/unsubscribe',
  domain: 'tg-bot',
  tags: ['s5', 'guardrail', 'zero_custody', 'zero_key', 'security', 'bettor_r211'],
  skip_in_batch: true,
  steps: [
    { action: 'todo', note: 'enumerate every route/handler the bot service registers (grammY commands + any HTTP it exposes)' },
    { action: 'todo', note: 'assert: the ONLY state-mutating path is subscribe/unsubscribe on user_notification_prefs' },
    { action: 'todo', note: 'assert: bot makes 0 Console writes to escrow/settle/dispute/publish/stake/transfer endpoints (read-only + deep-link only)' },
    { action: 'todo', note: 'assert: every value/trust action the bot surfaces is a deep-link (Console UI / user relay), never an in-bot execution' },
    { action: 'todo', note: 'negative control: a hypothetical bot handler that POSTs /api/prediction/publish-v2 or relay type:transfer MUST be caught (by this test AND lint rule S5)' },
    { action: 'todo', note: 'cross-check with compile-time lint: scripts/lint-kanet.mjs rule S5 already rejects key/signing primitives + value relay commands in tg-bot/*.{js,mjs}' },
  ],
};
