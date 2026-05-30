// 2-node test workaround (Bettor r106 + J1 r171 + UI r331 chain-truncation):
// Sync ext-pool-1779443903534-3gwlb metadata from :3300 to :3200 so consumer
// (trade-protocol-filter handlePoolOracleVote) finds the market when J1 voter
// broadcasts a vote to kanet-prediction channel.
//
// b-class market_publish gap workaround per Bettor r106 — markets aren't yet
// cross-node-synced via chain broadcast; this script does it manually.
//
// Run: cd kasia-console; node --input-type=module < ../scripts/_shared_market_3gwlb.mjs
// (or rename + invoke directly if the import resolution wants it)
//
// Idempotent: INSERT OR REPLACE. Stripped metadata to test-only marker.
// protocol_status forced to 'verifying' (= what consumer + settler want).

import { sqlite } from './src/db/client.js';

const row = {
  id: 'ext-pool-1779443903534-3gwlb',
  maker_relay_id: 'ede0772f-dba7-452d-a12a-ff9d3374d4fc',
  spine_p2sh: 'kaspatest:prq4zp892h6ajazkfzyu54j9jcdru6duy94w06ahzecke86wz7nx5xzp9h7w3',
  spine_lock_tx: '3a4d0aa72861e4274fef6e790d7ae492efff265da030721f163f0e9e85f85c3e',
  market_metadata_hash: '6583dcf1993e48e13f04f3664c8d7e9cc6f0116525743f926a9a6cadb55d6096',
  oracle1_pk: 'a102fbde59f8a07933d5c7165718a4b366248805a5bdafc606d0e2d60ba4a297',
  oracle2_pk: '9e2db8525f2e8803f0b87d7a5c19c0845b6bb4173fed52b407dce47d1aedbe25',
  oracle3_pk: '7013f11892b7c45c88af8701e73e4305be2512d728feb7f4b44b7d2434c38355',
  broker_pk: '6b39b42e6694ced6d730eaf1b1ac1a9ccdb7e0c7e204a7b29195b159a81023db',
  deadline: 1779444079,
  miner_fee: 20000,
  broker_fee_pct: 100,
  oracle_bond_amount: 100000000,
  maker_stake_amount: 200000000,
  outcome_market_source: 'kanet_native',
  outcome_condition_id: 's3-1779443899935',
  outcome_token_id: 's3-tok',
  outcome_side: 'YES',
  resolution_rule_spec: '{"data_source_canonical":"Scenario 3 tight deadline"}',
  protocol_status: 'verifying',
  settle_txid: null,
  refund_txid: null,
  sides_merkle_root: '92e34ff3517d606dd8989e4a7d7ff8ec0f6bc511a137537361f2970a6d4052ae',
  created_at: '2026-05-22 09:58:23',
  updated_at: '2026-05-30 15:41:05',
  oracle_relay_ids: '["6a0a8eed-ce4f-4192-bb37-1d2843c626e4","50902702-0646-4bb7-ae55-9b7b10ac7ab2","523f9eb7-92f2-4b91-9ba8-088e6dde665b"]',
  metadata: '{"_shared_for_2node_test":true,"j1_r171_workaround":"market_publish b-class gap pending"}',
  broker_relay_id: 'c1a81b8c-000e-41c6-b95f-63c4fbcc48eb',
  category: 'other',
  protocol_version: null,
  pool_merkle_root: null,
};

const cols = Object.keys(row);
const placeholders = cols.map(() => '?').join(',');
const sql = `INSERT OR REPLACE INTO pool_markets (${cols.join(',')}) VALUES (${placeholders})`;
const vals = cols.map(k => row[k]);

const before = sqlite.prepare('SELECT id, protocol_status FROM pool_markets WHERE id = ?').get(row.id);
console.log('[shared-market] before:', before ? JSON.stringify(before) : 'NOT FOUND');

sqlite.prepare(sql).run(...vals);

const after = sqlite.prepare('SELECT id, protocol_status, oracle_relay_ids FROM pool_markets WHERE id = ?').get(row.id);
console.log('[shared-market] after :', JSON.stringify(after));
console.log('[shared-market] DONE — market replicated to local DB. J1 can now trigger vote broadcast on :3300.');
