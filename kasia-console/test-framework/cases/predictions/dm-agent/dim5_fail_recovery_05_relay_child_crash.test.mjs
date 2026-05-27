// Dim 5.5 — kill relay child mid /confirm → restart relay → state recoverable from chain_events ingest.
// Tests that prediction_dm_session is purely a UX hint — chain is canonical.
// pending_dep: ui_baea285_handler + real_chain_market_create

const TN12_CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300';
// Resolve relay id at case-load time — the runner does NOT interpolate ${env.X} into URL strings.
const RELAY_ID = process.env.PREDICTION_AGENT_RELAY_ID || '6a0a8eed-ce4f-4192-bb37-1d2843c626e4';

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
      // Use the prediction agent relay (= the one whose child we restart, since it serves DM).
      action: 'http_post',
      url: `${TN12_CONSOLE}/api/relay/${RELAY_ID}/restart`,
      expect: { must: { http_status: 200, response_has_keys: ['ok'] } },
    },
    { action: 'sleep', ms: 5000 },
    {
      // After restart, the relay child reconnects to kaspad and reports rpc-state.connected=true.
      // This is the recovery invariant: relay child crash → restart → operational state restored.
      action: 'http_get',
      url: `${TN12_CONSOLE}/api/relay/${RELAY_ID}/rpc-state`,
      expect: { must: { http_status: 200, row_assert: { ok: true, 'state.connected': true } } },
    },
  ],
};
