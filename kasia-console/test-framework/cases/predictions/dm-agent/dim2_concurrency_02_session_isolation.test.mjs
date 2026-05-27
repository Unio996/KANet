// Dim 2.2 — 5 users each pick different market; verify prediction_dm_session has 5 distinct rows
// keyed by sender_address PK. Validates J2 R1 stateless principle + UI handler INSERT bug fix
// (baea285: 5 placeholder vs 4 cols was caught — this case守住).
// pending_dep: ui_baea285_handler + nwt_27aa21a_dispatcher

export default {
  id: 'dim2_concurrency_02_session_isolation',
  description: 'Dim 2.2: 5 users distinct sender_address → 5 distinct prediction_dm_session rows',
  domain: 'dm-agent',
  tags: ['dm_agent', 'dim2', 'concurrent', 'ship_block', 'pending_ui_bundle'],
  pending_dep: ['ui_baea285_handler', 'nwt_27aa21a_dispatcher'],
  skip_in_batch: true,
  steps: [
    { action: 'todo', note: 'send /predict from 5 distinct peers; each picks distinct market_id via DM "1","2","3","4","5"' },
    {
      action: 'query_db',
      sql: `SELECT sender_address, last_market_id FROM prediction_dm_session WHERE sender_address IN (?, ?, ?, ?, ?)`,
      params: [
        '${env.CONCUR_USER_0}', '${env.CONCUR_USER_1}', '${env.CONCUR_USER_2}',
        '${env.CONCUR_USER_3}', '${env.CONCUR_USER_4}',
      ],
      expect: {
        must: {
          db_row_count: 5,
          row_assert: {
            'rows[].sender_address_unique': true,  // = 5 distinct PKs
          },
        },
      },
    },
  ],
};
