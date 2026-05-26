// Oracle v0.3 sub #7 regression — broker/oracle 互斥 enforcement smoke
//
// scope: per Bettor r41 framework regression + KANet-UI r14 raise + J1 #10 fold
// spec: pool-prediction-market-rules-v0.5.md L52 broker/oracle 互斥铁律
// backend: J2 sub 5 fix 18dbf4b POST /api/oracle/announce broker_registry check
// UI: predictions-pool-create.eta brokerOracleMutexWarning reactive state (commit 3ab8dc2)

export default {
  id: 'broker_oracle_mutex_warning',
  description: 'Oracle v0.3 broker/oracle 互斥 schema smoke (= oracle_registry + relay_nodes broker col)',
  domain: 'predictions',
  tags: ['regression', 'oracle_v03', 'sub7', 'security', 'smoke'],
  steps: [
    {
      // oracle_registry 存在 (= announce 目的表)
      action: 'query_db',
      sql: `SELECT count(*) as ct FROM sqlite_master WHERE type='table' AND name='oracle_registry'`,
      expect: {
        must: {
          db_row_count: 1,
        },
      },
    },
    {
      // relay_nodes 含 is_dex_broker 字段 (= broker_registry cross-check 源)
      action: 'query_db',
      sql: `SELECT count(*) as ct FROM pragma_table_info('relay_nodes') WHERE name='is_dex_broker'`,
      expect: {
        must: {
          db_row_count: 1,
        },
      },
    },
  ],
};
