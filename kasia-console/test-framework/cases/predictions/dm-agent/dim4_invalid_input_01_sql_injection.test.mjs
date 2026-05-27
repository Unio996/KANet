// Dim 4.1 — SQL injection: DM "1; DROP TABLE relay_nodes; --" → handler rejects, DB intact.
// Verifies prepared statement protection (better-sqlite3 .prepare()) + handler text sanitization.
// pending_dep: ui_baea285_handler

const TN12_CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300';

export default {
  id: 'dim4_invalid_input_01_sql_injection',
  description: 'Dim 4.1: SQL injection payload in DM → reject + 0 DB mutation',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim4', 'security', 'ship_block', 'pending_ui_bundle'],
  pending_dep: ['ui_baea285_handler', 'nwt_27aa21a_dispatcher'],
  skip_in_batch: true,
  steps: [
    {
      action: 'query_db',
      sql: `SELECT COUNT(*) AS c FROM relay_nodes`,
      save_as: 'relay_count_pre',
    },
    {
      action: 'http_post',
      url: `${TN12_CONSOLE}/api/agent/reply`,
      body: {
        relayNodeId: '${env.PREDICTION_AGENT_RELAY_ID}',
        peer: '${env.TEST_USER_ADDR}',
        message: "1; DROP TABLE relay_nodes; --",
      },
      expect: {
        must: {
          http_status: 200,
          reply_does_not_contain: ['SQLITE_', 'syntax error', 'no such table'],
        },
      },
    },
    {
      action: 'query_db',
      sql: `SELECT COUNT(*) AS c FROM relay_nodes`,
      expect: {
        must: {
          row_field_equals: { c: '${relay_count_pre.c}' },
        },
      },
    },
  ],
};
