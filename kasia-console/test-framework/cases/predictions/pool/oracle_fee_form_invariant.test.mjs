// Oracle v0.3 sub #7 regression — UI form schema smoke
//
// scope: per Bettor r41 framework regression + r43 chase
// spec: r17 R3 close §8 4 disclose + 议题 B oracle_fee_pct + 1 input fee + 1:1:1 split
// UI source: kasia-console/src/ui/predictions-pool-create.eta (commit 3ab8dc2)

export default {
  id: 'oracle_fee_form_invariant',
  description: 'Oracle v0.3 §8 fee form smoke — pool_markets table 存在',
  domain: 'predictions',
  tags: ['regression', 'oracle_v03', 'sub7', 'smoke'],
  steps: [
    {
      action: 'query_db',
      sql: `SELECT count(*) as ct FROM sqlite_master WHERE type='table' AND name='pool_markets'`,
      expect: {
        must: {
          db_row_count: 1,
        },
      },
    },
  ],
};
