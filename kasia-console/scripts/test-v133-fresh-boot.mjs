// B2 v0.5 Sub 2c — v133 fresh boot smoke per Bettor r334 push (= r329 v62 pattern)
// Verifies migrate.js v62 + v133 work from scratch on empty DB without error.

import { existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEMP_DB = join(tmpdir(), `kanet-v133-smoke-${Date.now()}.db`);
process.env.DB_PATH = TEMP_DB;
process.env.CONSOLE_ENCRYPTION_KEY = '0'.repeat(64);
process.env.NODE_ENV = 'test';

console.log(`[smoke] temp DB: ${TEMP_DB}`);

try {
  if (existsSync(TEMP_DB)) unlinkSync(TEMP_DB);

  const { sqlite } = await import('../src/db/client.js');
  const { runMigrations } = await import('../src/db/migrate.js');

  console.log('[smoke] running migrations on fresh DB...');
  runMigrations();

  // Verify v62 tables
  const pmCols = sqlite.prepare("PRAGMA table_info(pool_markets)").all();
  const sidesCols = sqlite.prepare("PRAGMA table_info(pool_bettor_sides)").all();
  console.log(`[smoke] pool_markets cols: ${pmCols.length}`);
  console.log(`[smoke] pool_bettor_sides cols: ${sidesCols.length}`);

  // Verify v133 column
  const hasRelay = pmCols.find(c => c.name === 'oracle_relay_ids');
  if (!hasRelay) {
    console.error('[smoke] FAIL: pool_markets.oracle_relay_ids col missing after fresh migrate');
    process.exit(1);
  }
  console.log(`[smoke] v133 pool_markets.oracle_relay_ids col present: ${hasRelay.type} ✓`);

  // Verify v134 column (= phase2_tx_obj stash)
  const hasMeta = pmCols.find(c => c.name === 'metadata');
  if (!hasMeta) {
    console.error('[smoke] FAIL: pool_markets.metadata col missing after fresh migrate');
    process.exit(1);
  }
  console.log(`[smoke] v134 pool_markets.metadata col present: ${hasMeta.type} ✓`);

  // Verify v135 column (= broker_relay_id, r339 push)
  const hasBroker = pmCols.find(c => c.name === 'broker_relay_id');
  if (!hasBroker) {
    console.error('[smoke] FAIL: pool_markets.broker_relay_id col missing after fresh migrate');
    process.exit(1);
  }
  console.log(`[smoke] v135 pool_markets.broker_relay_id col present: ${hasBroker.type} ✓`);

  // Try insert to confirm all columns work end-to-end
  const testId = 'smoke-test-' + Date.now();
  const metaJson = JSON.stringify({ phase2_winner: 0, phase2_dispatched_at: new Date().toISOString() });
  sqlite.prepare(`INSERT INTO pool_markets (
    id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, oracle_relay_ids, metadata, broker_relay_id
  ) VALUES (?,?,?,?,?,?,?,?)`).run(
    testId, 'voter1', 'kaspatest:smoke', 'a'.repeat(64), Math.floor(Date.now()/1000),
    JSON.stringify(['v1','v2','v3']), metaJson, 'broker-relay-1'
  );
  const row = sqlite.prepare('SELECT oracle_relay_ids, metadata, broker_relay_id FROM pool_markets WHERE id = ?').get(testId);
  if (!row || !row.oracle_relay_ids || !row.metadata || !row.broker_relay_id) {
    console.error('[smoke] FAIL: INSERT/SELECT round-trip fail');
    process.exit(1);
  }
  console.log(`[smoke] insert+select round-trip oracle_relay_ids: ${row.oracle_relay_ids} ✓`);
  console.log(`[smoke] insert+select round-trip metadata: ${row.metadata} ✓`);
  console.log(`[smoke] insert+select round-trip broker_relay_id: ${row.broker_relay_id} ✓`);

  // Verify v136 column (= side_redeem_script_hex on pool_bettor_sides, r351 push)
  const sidesCols2 = sqlite.prepare("PRAGMA table_info(pool_bettor_sides)").all();
  const hasSideRedeem = sidesCols2.find(c => c.name === 'side_redeem_script_hex');
  if (!hasSideRedeem) {
    console.error('[smoke] FAIL: pool_bettor_sides.side_redeem_script_hex col missing after fresh migrate');
    process.exit(1);
  }
  console.log(`[smoke] v136 pool_bettor_sides.side_redeem_script_hex col present: ${hasSideRedeem.type} ✓`);

  // INSERT round-trip on pool_bettor_sides
  sqlite.prepare(`INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, stake_amount, side_p2sh, side_redeem_script_hex)
                  VALUES (?,?,?,?,?,?)`).run(testId, 'b'.repeat(64), 0, 100, 'kaspatest:side', 'deadbeefcafe');
  const sideRow = sqlite.prepare('SELECT side_redeem_script_hex FROM pool_bettor_sides WHERE market_id = ?').get(testId);
  if (!sideRow || !sideRow.side_redeem_script_hex) {
    console.error('[smoke] FAIL: pool_bettor_sides side_redeem_script_hex INSERT/SELECT fail');
    process.exit(1);
  }
  console.log(`[smoke] insert+select round-trip side_redeem_script_hex: ${sideRow.side_redeem_script_hex} ✓`);

  console.log('[smoke] PASS — v62 + v133 + v134 + v135 + v136 fresh boot migrate works');
  sqlite.close();
  unlinkSync(TEMP_DB);
} catch (e) {
  console.error('[smoke] FAIL:', e.message);
  console.error(e.stack);
  if (existsSync(TEMP_DB)) try { unlinkSync(TEMP_DB); } catch {}
  process.exit(1);
}
