// B2 v0.5 area-4 + 7b regression — decideConsensus refund_disagreement detection.
// Covers Gap 1A (3-vote split → silentOracleIndex=-1) and Gap 1B (2-vote split + 1 silent
// → silentOracleIndex = silent's index 0/1/2), plus the disagreement_detected_at stash
// once-and-readonly flow:
//   - first detection: action='pending' + stashDisagreementDetected=true + silentOracleIndex
//   - subsequent calls within DISAGREEMENT_TIMEOUT: action='pending' (no re-stash)
//   - subsequent calls past DISAGREEMENT_TIMEOUT: action='refund_disagreement' + silentOracleIndex
//
// All under DISAGREEMENT_TIMEOUT_MIN env override (= test sets it to 1 for snappiness).
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, unlinkSync } from 'node:fs';

const TEMP_DB = join(tmpdir(), `kanet-pool-decide-refund-dis-${Date.now()}.db`);
process.env.DB_PATH = TEMP_DB;
process.env.CONSOLE_ENCRYPTION_KEY = '0'.repeat(64);
process.env.NODE_ENV = 'test';
process.env.DISAGREEMENT_TIMEOUT_MIN = '1';   // 1 min for fast test
process.env.ORACLE_SILENT_TIMEOUT_MIN = '30'; // default

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  PASS ${m}`); } else { fail++; console.log(`  FAIL ${m}`); } };

try {
  const { sqlite } = await import('../src/db/client.js');
  const { runMigrations } = await import('../src/db/migrate.js');
  runMigrations();
  const { decideConsensus } = await import('../src/services/pool-market-settler.js');

  const ORACLE_RELAY_IDS = ['oracle-1', 'oracle-2', 'oracle-3'];

  const seedMarket = (id, updated_at, metadata = '{}') => {
    sqlite.prepare(`INSERT INTO pool_markets (
      id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline,
      oracle_relay_ids, protocol_status, updated_at, metadata
    ) VALUES (?,?,?,?,?,?,?,?,?)`).run(
      id, 'maker-1', 'kaspatest:test', 'a'.repeat(64),
      Math.floor((Date.now() - 60_000) / 1000),
      JSON.stringify(ORACLE_RELAY_IDS), 'verifying', updated_at, metadata,
    );
  };
  const seedVote = (marketId, oracleRelayId, outcome, observed_at) => {
    const payload = JSON.stringify({ t: 'pool_oracle_vote_v1', market_id: marketId, voter_relay_id: oracleRelayId, outcome });
    sqlite.prepare(`INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
                    VALUES (?, ?, 'pool_oracle_vote', ?, ?, ?, 'test', ?)`).run(
      `evt-${Math.random().toString(36).slice(2, 10)}`,
      `synthetic_vote:${marketId.slice(0,12)}:${oracleRelayId}:${Date.now()}`,
      null, null, payload, observed_at,
    );
  };
  const getMarket = (id) => sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(id);

  const VERIFYING_TS = new Date(Date.now() - 60_000).toISOString();

  // === Gap 1A: 3 votes split (e.g. 2 YES + 1 NO) — first detection ===
  {
    const MID = 'm-1a-first-' + Date.now();
    seedMarket(MID, VERIFYING_TS);
    seedVote(MID, 'oracle-1', 'YES', VERIFYING_TS);
    seedVote(MID, 'oracle-2', 'YES', VERIFYING_TS);
    seedVote(MID, 'oracle-3', 'NO', VERIFYING_TS);
    const d = decideConsensus(getMarket(MID));
    ok(d.action === 'pending', `Gap 1A first: action=pending (got ${d.action})`);
    ok(d.stashDisagreementDetected === true, `Gap 1A first: stashDisagreementDetected=true`);
    ok(d.silentOracleIndex === -1, `Gap 1A first: silentOracleIndex=-1 (got ${d.silentOracleIndex})`);
  }

  // === Gap 1A: 3 votes split + disagreement_detected_at past timeout → refund_disagreement ===
  {
    const MID = 'm-1a-past-' + Date.now();
    const OLD_DETECTED = new Date(Date.now() - 2 * 60_000).toISOString();  // 2 min ago > 1 min timeout
    seedMarket(MID, VERIFYING_TS, JSON.stringify({ disagreement_detected_at: OLD_DETECTED }));
    seedVote(MID, 'oracle-1', 'YES', VERIFYING_TS);
    seedVote(MID, 'oracle-2', 'NO', VERIFYING_TS);
    seedVote(MID, 'oracle-3', 'YES', VERIFYING_TS);  // mixed split
    const d = decideConsensus(getMarket(MID));
    ok(d.action === 'refund_disagreement', `Gap 1A past timeout: action=refund_disagreement (got ${d.action})`);
    ok(d.silentOracleIndex === -1, `Gap 1A past timeout: silentOracleIndex=-1`);
    ok(!d.stashDisagreementDetected, `Gap 1A past timeout: no re-stash`);
  }

  // === Gap 1A: 3 votes split + disagreement_detected_at within timeout → still pending ===
  {
    const MID = 'm-1a-within-' + Date.now();
    const RECENT_DETECTED = new Date(Date.now() - 30_000).toISOString();  // 30s ago < 1 min timeout
    seedMarket(MID, VERIFYING_TS, JSON.stringify({ disagreement_detected_at: RECENT_DETECTED }));
    seedVote(MID, 'oracle-1', 'YES', VERIFYING_TS);
    seedVote(MID, 'oracle-2', 'YES', VERIFYING_TS);
    seedVote(MID, 'oracle-3', 'NO', VERIFYING_TS);
    const d = decideConsensus(getMarket(MID));
    ok(d.action === 'pending', `Gap 1A within timeout: action=pending`);
    ok(!d.stashDisagreementDetected, `Gap 1A within timeout: no re-stash`);
  }

  // === Gap 1B: 2 votes split + 1 silent past silent_timeout — first detection ===
  {
    const MID = 'm-1b-first-' + Date.now();
    // verifying_at 31 min ago → pastSilentTimeout=true
    const OLD_VERIFYING = new Date(Date.now() - 31 * 60_000).toISOString();
    seedMarket(MID, OLD_VERIFYING);
    seedVote(MID, 'oracle-1', 'YES', OLD_VERIFYING);
    seedVote(MID, 'oracle-2', 'NO', OLD_VERIFYING);
    // oracle-3 silent (no vote)
    const d = decideConsensus(getMarket(MID));
    ok(d.action === 'pending', `Gap 1B first: action=pending`);
    ok(d.stashDisagreementDetected === true, `Gap 1B first: stashDisagreementDetected=true`);
    ok(d.silentOracleIndex === 2, `Gap 1B first: silentOracleIndex=2 (oracle-3 silent, got ${d.silentOracleIndex})`);
  }

  // === Gap 1B: silent oracle index 1 (oracle-2 silent) ===
  {
    const MID = 'm-1b-sIO1-' + Date.now();
    const OLD_VERIFYING = new Date(Date.now() - 31 * 60_000).toISOString();
    seedMarket(MID, OLD_VERIFYING);
    seedVote(MID, 'oracle-1', 'YES', OLD_VERIFYING);
    // oracle-2 silent
    seedVote(MID, 'oracle-3', 'NO', OLD_VERIFYING);
    const d = decideConsensus(getMarket(MID));
    ok(d.silentOracleIndex === 1, `Gap 1B silent oracle-2: silentOracleIndex=1 (got ${d.silentOracleIndex})`);
  }

  // === Gap 1B: silent oracle index 0 (oracle-1 silent) ===
  {
    const MID = 'm-1b-sIO0-' + Date.now();
    const OLD_VERIFYING = new Date(Date.now() - 31 * 60_000).toISOString();
    seedMarket(MID, OLD_VERIFYING);
    // oracle-1 silent
    seedVote(MID, 'oracle-2', 'NO', OLD_VERIFYING);
    seedVote(MID, 'oracle-3', 'YES', OLD_VERIFYING);
    const d = decideConsensus(getMarket(MID));
    ok(d.silentOracleIndex === 0, `Gap 1B silent oracle-1: silentOracleIndex=0 (got ${d.silentOracleIndex})`);
  }

  // === Gap 1B: past disagreement timeout → refund_disagreement ===
  {
    const MID = 'm-1b-past-' + Date.now();
    const OLD_VERIFYING = new Date(Date.now() - 31 * 60_000).toISOString();
    const OLD_DETECTED = new Date(Date.now() - 2 * 60_000).toISOString();
    seedMarket(MID, OLD_VERIFYING, JSON.stringify({ disagreement_detected_at: OLD_DETECTED }));
    seedVote(MID, 'oracle-1', 'YES', OLD_VERIFYING);
    seedVote(MID, 'oracle-2', 'NO', OLD_VERIFYING);
    const d = decideConsensus(getMarket(MID));
    ok(d.action === 'refund_disagreement', `Gap 1B past timeout: action=refund_disagreement`);
    ok(d.silentOracleIndex === 2, `Gap 1B past timeout: silentOracleIndex=2`);
  }

  // === Existing consensus path (3-of-3 same) — no regression ===
  {
    const MID = 'm-consensus-' + Date.now();
    seedMarket(MID, VERIFYING_TS);
    seedVote(MID, 'oracle-1', 'YES', VERIFYING_TS);
    seedVote(MID, 'oracle-2', 'YES', VERIFYING_TS);
    seedVote(MID, 'oracle-3', 'YES', VERIFYING_TS);
    const d = decideConsensus(getMarket(MID));
    ok(d.action === 'consensus' && d.unanimous === true, `3-of-3 YES → consensus unanimous (no regression)`);
  }

  // === Existing forfeit_1 path (2 same + 1 silent past timeout) — no regression ===
  {
    const MID = 'm-forfeit1-' + Date.now();
    const OLD_VERIFYING = new Date(Date.now() - 31 * 60_000).toISOString();
    seedMarket(MID, OLD_VERIFYING);
    seedVote(MID, 'oracle-1', 'YES', OLD_VERIFYING);
    seedVote(MID, 'oracle-2', 'YES', OLD_VERIFYING);
    // oracle-3 silent
    const d = decideConsensus(getMarket(MID));
    ok(d.action === 'consensus' && d.unanimous === false && d.silentOracleIndex === 2,
       `2 YES + oracle-3 silent → forfeit_1 consensus (no regression)`);
  }

  console.log(`\ntest-pool-decide-refund-disagreement: ${pass} PASS / ${fail} FAIL`);
} finally {
  if (existsSync(TEMP_DB)) try { unlinkSync(TEMP_DB); } catch {}
}

process.exit(fail ? 1 : 0);
