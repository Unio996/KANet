// Dim 5.3 — kill Console mid CONFIRM_STAKE → restart → DM /status → expect state per chain truth
// (= WAITING_TAKER if publish-v2 TX confirmed before crash, else IDLE if user must re-stake).
// Validates J2 R1 stateless principle: prediction_dm_session is only hint cache, chain truth is canonical.
// pending_dep: ui_baea285_handler + real_chain_market_create

export default {
  id: 'dim5_fail_recovery_03_console_restart_mid_flow',
  description: 'Dim 5.3: Console restart mid /confirm → recovered state matches chain truth (not stale cache)',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim5', 'recovery', 'real_chain', 'ship_block', 'pending_ui_bundle'],
  pending_dep: ['ui_baea285_handler', 'nwt_27aa21a_dispatcher', 'real_chain_market_create'],
  skip_in_batch: true,
  steps: [
    { action: 'todo', note: 'walk /predict → 1 → 1 → 10 → /confirm; mid publish-v2 broadcast, kill Console (PID kill)' },
    { action: 'todo', note: 'restart Console via kanet-start.sh; wait health-ready' },
    { action: 'todo', note: 'DM /status from same user → expect reply matching DB pool_bettor_sides existence' },
    {
      action: 'query_db',
      sql: `SELECT COUNT(*) AS sides FROM pool_bettor_sides WHERE bettor_pk = ? AND created_at > datetime('now', '-5 minutes')`,
      params: ['${env.TEST_USER_PK}'],
      save_as: 'post_restart',
    },
    { action: 'todo', note: 'assert: dm reply describes either "WAITING_TAKER" (sides=1) OR "IDLE" (sides=0) — NEVER stale CONFIRM_STAKE' },
  ],
};
