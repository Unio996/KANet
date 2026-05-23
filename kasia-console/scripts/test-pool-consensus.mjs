// B2 v0.5 Sub 2d Phase 1 — decideConsensus 4 cases unit test
// Per Bettor r335: must cover (3 voted unanimous, 2 voted forfeit_1, 1 voted refund, 0 voted refund).

import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, unlinkSync } from 'node:fs';

const TEMP_DB = join(tmpdir(), `kanet-pool-consensus-${Date.now()}.db`);
process.env.DB_PATH = TEMP_DB;
process.env.CONSOLE_ENCRYPTION_KEY = '0'.repeat(64);
process.env.NODE_ENV = 'test';

try {
  const { sqlite } = await import('../src/db/client.js');
  const { runMigrations } = await import('../src/db/migrate.js');
  runMigrations();

  const { decideConsensus, parseSqliteUtc } = await import('../src/services/pool-market-settler.js');

  const ORACLE_RELAY_IDS = ['oracle-1', 'oracle-2', 'oracle-3'];
  const MARKET_ID = 'pool-test-' + Date.now();
  // OLD_TS must be > ORACLE_SILENT_TIMEOUT_MIN ago to trigger timeout cases.
  // Default 30min → seed 31 min ago. Mainnet 1440min → seed 1441 min ago.
  const timeoutMin = parseInt(process.env.ORACLE_SILENT_TIMEOUT_MIN, 10) || 30;
  const OLD_TS = new Date(Date.now() - (timeoutMin + 1) * 60_000).toISOString();

  function seedMarket(updated_at) {
    sqlite.prepare(`INSERT INTO pool_markets (
      id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline,
      oracle_relay_ids, protocol_status, updated_at
    ) VALUES (?,?,?,?,?,?,?,?)`).run(
      MARKET_ID, 'maker-1', 'kaspatest:test', 'a'.repeat(64),
      Math.floor((Date.now() - 60000) / 1000),
      JSON.stringify(ORACLE_RELAY_IDS), 'verifying', updated_at
    );
  }
  function seedVote(oracleRelayId, outcome) {
    const payload = JSON.stringify({ t: 'pool_oracle_vote_v1', market_id: MARKET_ID, voter_relay_id: oracleRelayId, outcome });
    sqlite.prepare(`INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
                    VALUES (?, ?, 'pool_oracle_vote', ?, ?, ?, 'test', ?)`).run(
      'ev-' + Math.random(), 'txid-' + Math.random(), oracleRelayId, 'maker-1', payload, new Date().toISOString()
    );
  }
  function reset() {
    sqlite.prepare('DELETE FROM pool_markets WHERE id = ?').run(MARKET_ID);
    sqlite.prepare(`DELETE FROM chain_events WHERE payload LIKE ?`).run(`%"${MARKET_ID}"%`);
  }
  function getMarket() {
    return sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(MARKET_ID);
  }

  let pass = 0, fail = 0;
  function assertEq(label, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`${ok ? '✓' : '✗'} ${label}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
    if (ok) pass++; else fail++;
  }

  // Case 1: 3-of-3 unanimous YES
  reset();
  seedMarket(OLD_TS);
  seedVote('oracle-1', 'YES');
  seedVote('oracle-2', 'YES');
  seedVote('oracle-3', 'YES');
  let d = decideConsensus(getMarket());
  assertEq('Case 1: 3-of-3 unanimous YES', { action: d.action, winner: d.winner, unanimous: d.unanimous }, { action: 'consensus', winner: 0, unanimous: true });

  // Case 2: 2-of-3 + 1 silent past timeout (oracle-3 silent)
  reset();
  seedMarket(OLD_TS);
  seedVote('oracle-1', 'NO');
  seedVote('oracle-2', 'NO');
  d = decideConsensus(getMarket());
  assertEq('Case 2: 2-of-3 NO + oracle-3 silent', { action: d.action, winner: d.winner, unanimous: d.unanimous, silentOracleIndex: d.silentOracleIndex }, { action: 'consensus', winner: 1, unanimous: false, silentOracleIndex: 2 });

  // Case 3: 1 voted + 2 silent past timeout → refund (Bettor r335 newly added)
  reset();
  seedMarket(OLD_TS);
  seedVote('oracle-1', 'YES');
  d = decideConsensus(getMarket());
  assertEq('Case 3: 1 voted + 2 silent → refund', d.action, 'refund');

  // Case 4: 0 voted + all silent past timeout → refund
  reset();
  seedMarket(OLD_TS);
  d = decideConsensus(getMarket());
  assertEq('Case 4: 0 voted + 3 silent → refund', d.action, 'refund');

  // Case 5: 2 voted but NOT past timeout yet → pending (not 'consensus' yet)
  reset();
  seedMarket(new Date().toISOString()); // fresh
  seedVote('oracle-1', 'YES');
  seedVote('oracle-2', 'YES');
  d = decideConsensus(getMarket());
  assertEq('Case 5: 2 voted but fresh (no timeout) → pending', d.action, 'pending');

  // Case 6: disagreement 2 YES + 1 NO → pending (Phase 5 challenge defer)
  reset();
  seedMarket(OLD_TS);
  seedVote('oracle-1', 'YES');
  seedVote('oracle-2', 'YES');
  seedVote('oracle-3', 'NO');
  d = decideConsensus(getMarket());
  assertEq('Case 6: 3 voted disagreement → pending', d.action, 'pending');

  // Case 7: parseSqliteUtc handles SQLite 'YYYY-MM-DD HH:MM:SS' format as UTC (Phase 3 e2e bug)
  {
    // SQLite CURRENT_TIMESTAMP format — must parse as UTC not local
    const sqliteTs = '2026-05-22 00:50:09';
    const parsed = parseSqliteUtc(sqliteTs);
    const expectedUtc = Date.UTC(2026, 4, 22, 0, 50, 9);
    assertEq('Case 7: parseSqliteUtc SQLite format as UTC', parsed, expectedUtc);
  }
  // Case 8: parseSqliteUtc handles ISO 'T...Z' format too
  {
    const isoTs = '2026-05-22T00:50:09.000Z';
    const parsed = parseSqliteUtc(isoTs);
    assertEq('Case 8: parseSqliteUtc ISO format', parsed, new Date(isoTs).getTime());
  }
  // Case 9: decideConsensus with SQLite-format updated_at — 2 voted, 3 min ago → pending NOT consensus
  {
    reset();
    const threeMinAgoSqlite = new Date(Date.now() - 3 * 60_000).toISOString().slice(0, 19).replace('T', ' ');
    seedMarket(threeMinAgoSqlite);  // SQLite format, 3 min ago
    seedVote('oracle-1', 'YES');
    seedVote('oracle-2', 'YES');
    const d = decideConsensus(getMarket());
    assertEq('Case 9: 2 voted + SQLite-fmt 3min-ago updated_at → pending (not false-timeout consensus)', d.action, 'pending');
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  sqlite.close();
  if (existsSync(TEMP_DB)) try { unlinkSync(TEMP_DB); } catch {}
  if (fail > 0) process.exit(1);
} catch (e) {
  console.error('FAIL:', e.message);
  console.error(e.stack);
  if (existsSync(TEMP_DB)) try { unlinkSync(TEMP_DB); } catch {}
  process.exit(1);
}
