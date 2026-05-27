// Dim 2.5 — schema invariant: prediction_dm_session.sender_address is PRIMARY KEY (= ON CONFLICT
// REPLACE / no dup rows possible regardless of concurrent INSERTs). Schema lock守住 J2 R1 stateless.
// 不需要 UI bundle — 纯 schema check + DB invariant.

export default {
  id: 'dim2_concurrency_05_sender_address_pk_invariant',
  description: 'Dim 2.5: prediction_dm_session.sender_address PK invariant — schema lock guard',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim2', 'schema', 'ship_block', 'dm_agent_now'],
  // No pending_dep — schema check works on any console with v147 applied.
  steps: [
    {
      action: 'query_db',
      sql: `SELECT name, type, "notnull", pk FROM pragma_table_info('prediction_dm_session') WHERE name = 'sender_address'`,
      expect: {
        must: {
          db_row_count: 1,
          row_field_equals: { pk: 1, type: 'TEXT', notnull: 0 },
        },
      },
    },
    {
      // Verify table has the v147-spec columns (Bettor r100 R2 final 5-col schema).
      action: 'query_db',
      sql: `SELECT name FROM pragma_table_info('prediction_dm_session') ORDER BY name`,
      expect: {
        must: {
          db_row_count: 5,
        },
      },
    },
    {
      action: 'query_db',
      sql: `SELECT count(*) AS c FROM pragma_index_list('prediction_dm_session') WHERE name = 'idx_prediction_dm_session_updated'`,
      expect: { must: { row_field_equals: { c: 1 } } },
    },
  ],
};
