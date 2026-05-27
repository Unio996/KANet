// Dim 5.5 — kill relay child mid /confirm → restart relay → state recoverable from chain_events ingest.
// Tests that prediction_dm_session is purely a UX hint — chain is canonical.
// pending_dep: ui_baea285_handler + real_chain_market_create

const TN12_CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300';

export default {
  id: 'dim5_fail_recovery_05_relay_child_crash',
  description: 'Dim 5.5: relay child crash mid /confirm → relay restart → chain_events ingest restores state',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim5', 'recovery', 'real_chain', 'ship_block', 'pending_ui_bundle'],
  pending_dep: ['ui_baea285_handler', 'nwt_27aa21a_dispatcher', 'real_chain_market_create'],
  skip_in_batch: true,
  steps: [
    { action: 'todo', note: 'walk to CONFIRM_STAKE; pre-broadcast: kill relay via POST /api/relay/:id/restart' },
    {
      action: 'http_post',
      url: `${TN12_CONSOLE}/api/relay/${'${env.TEST_USER_RELAY_ID}'}/restart`,
      expect: { must: { http_status: 200, response_has_keys: ['ok'] } },
    },
    { action: 'sleep', ms: 5000 },
    { action: 'todo', note: 'DM /status → handler reads pool_bettor_sides; expect state matches DB row presence' },
    {
      action: 'http_get',
      url: `${TN12_CONSOLE}/api/relay/${'${env.TEST_USER_RELAY_ID}'}/rpc-state`,
      expect: { should: { row_field_equals: { ok: true } } },
    },
  ],
};
