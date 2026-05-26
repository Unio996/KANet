// Oracle v0.3 sub #7 regression — Oracle Registry schema smoke
//
// scope: per Bettor r41 framework regression + r43 chase
// spec: r17 R3 close D1 oracle-registry + J2 sub 1 d582bee oracle_registry table
// UI source: kasia-console/src/ui/predictions-oracle-registry.eta (commit 3ab8dc2)

export default {
  id: 'oracle_registry_load',
  description: 'Oracle v0.3 D1 oracle_registry + oracle_history v143 schema smoke',
  domain: 'predictions',
  tags: ['regression', 'oracle_v03', 'sub7', 'smoke'],
  steps: [
    {
      action: 'query_db',
      sql: `SELECT count(*) as ct FROM sqlite_master WHERE type='table' AND name='oracle_registry'`,
      expect: {
        must: {
          db_row_count: 1,
        },
      },
    },
    {
      action: 'query_db',
      sql: `SELECT count(*) as ct FROM sqlite_master WHERE type='table' AND name='oracle_history'`,
      expect: {
        must: {
          db_row_count: 1,
        },
      },
    },
  ],
};
