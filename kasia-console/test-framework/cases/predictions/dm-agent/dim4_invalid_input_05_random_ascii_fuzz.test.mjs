// Dim 4.5 — 1000 random ASCII inputs over 5 sec → 0 server crash, 0 DB corruption, p99 < 8s.
// pending_dep: ui_baea285_handler

export default {
  id: 'dim4_invalid_input_05_random_ascii_fuzz',
  description: 'Dim 4.5: 1000 random ASCII msgs / 5s → 0 crash + 0 DB corruption',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim4', 'fuzz', 'ship_block', 'pending_ui_bundle'],
  pending_dep: ['ui_baea285_handler', 'nwt_27aa21a_dispatcher'],
  skip_in_batch: true,
  steps: [
    {
      action: 'todo',
      note: 'fuzz driver: generate 1000 messages of length [1, 200] chars from [\\x20-\\x7e], '
          + 'send rate 200/s via 5 parallel workers. Track latency, errors. Assert p99 < 8000ms + 0 5xx.',
      // Implementation needs new 'fuzz_drive' action OR a standalone script that posts.
    },
    {
      action: 'query_db',
      sql: `SELECT integrity_check FROM pragma_integrity_check`,
      expect: { must: { row_field_equals: { integrity_check: 'ok' } } },
    },
  ],
};
