// Dim 2.3 — 50 DM messages from 5 users in 30 sec → no message lost, no wrong-recipient,
// dispatcher latency stays under threshold (J1 monitor for transient retry).
// pending_dep: ui_baea285_handler + nwt_27aa21a_dispatcher

const TN12_CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300';

export default {
  id: 'dim2_concurrency_03_50msg_stress',
  description: 'Dim 2.3: 50 msg / 5 user / 30s → 0 loss + p99 latency < 8s',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim2', 'stress', 'ship_block', 'pending_ui_bundle'],
  pending_dep: ['ui_baea285_handler', 'nwt_27aa21a_dispatcher'],
  skip_in_batch: true,
  steps: [
    {
      action: 'todo',
      note: '50 msg = 5 user × 10 msg/user. Mix /predict + digit + /cancel + /help. parallel with intra-user sequential.',
      // Implementation: lib needs new 'parallel_stream' action OR test driver script.
    },
    {
      action: 'query_db',
      sql: `SELECT COUNT(*) AS handled FROM messages WHERE direction='outbound' AND created_at > datetime('now', '-1 minute')`,
      expect: {
        should: {
          row_field_min: { handled: 50 },
        },
      },
    },
  ],
};
