// J1tn #27a v2 regression (part 2/2) — chain-anchored bettor-exclude: NULL side_lock_daa = FAIL-LOUD.
//
// scope: #27a v2 (Owner hardening sprint 2026-06-14). The committee bettor-exclude set is chain-anchored to
//        side_lock_daa <= deadline_daa (canonical accepting-block daa). A bet with NULL side_lock_daa is
//        AMBIGUOUS (legacy / pre-v170 / un-ingested daa) → sampleAndStoreCommittee MUST throw (fail-loud),
//        never silently include OR exclude it (silent handling diverges across nodes → committee_pk_hash fork).
// bug guarded: the determinism hole NWT r1170/r1175 caught — reading a bettor set where some daa is unknown
//        and guessing → two nodes compute different excludePks → different committee → settle fork / stuck.
// fix verified: settler-v06 sampleAndStoreCommittee L351-357 throws on any NULL side_lock_daa row.
//
// 真调生产 export sampleAndStoreCommittee against a REAL temp DB (runMigrations + real inserts) = 非拷贝逻辑.
// run: KASPA_RPC_URL=ws://127.0.0.1:17210 KASPA_NETWORK=testnet-12 DB_PATH=<temp> \
//        node test-framework/standalone/test_27a_null_daa_failloud.mjs   (exit 0=PASS, 1=FAIL)
//   (the test sets its own temp DB_PATH + dummy RPC env if unset — sampleAndStoreCommittee does no RPC.)

import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync } from 'fs';

// isolate to a throwaway DB BEFORE importing db/client (it reads DB_PATH at module load)
const TMP = join(tmpdir(), `kanet_27a_test_${process.pid}.db`);
process.env.DB_PATH = TMP;
process.env.KASPA_RPC_URL = process.env.KASPA_RPC_URL || 'ws://127.0.0.1:17210'; // rpc-health throws at load if unset; sampleAndStoreCommittee uses no RPC
process.env.KASPA_NETWORK = process.env.KASPA_NETWORK || 'testnet-12';

let fails = 0;
function check(name, ok, detail) {
  if (ok) console.log(`PASS ${name}`);
  else { fails++; console.error(`FAIL ${name}: ${detail || ''}`); }
}

const { runMigrations } = await import('../../src/db/migrate.js');
runMigrations();
const { sqlite } = await import('../../src/db/client.js');
const { sampleAndStoreCommittee, recaptureSideLockDaaForMarket } = await import('../../src/services/pool-market-settler-v06.mjs');

// 6 oracle pool pks (>= COMMITTEE_SIZE 5), equal stakes
const POOL = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'].map(h => h.repeat(32)); // 6 × 64-hex
const STAKES = POOL.map(() => '100000000'); // 1 KAS each
const POOL_ROOT = '00'.repeat(32);
const DEADLINE_DAA = 1000;
const END_BLOCK = 'ab'.repeat(32); // any 64-hex endBlockHash → VRF seed

function setupMarket(marketId) {
  sqlite.prepare(`INSERT INTO pool_snapshots (market_id, pool_merkle_root, pool_size, pool_pks_json, pool_stakes_json)
    VALUES (?,?,?,?,?)`).run(marketId, POOL_ROOT, POOL.length, JSON.stringify(POOL), JSON.stringify(STAKES));
  // maker/broker relay ids point at non-existent relays → LEFT JOIN address NULL → no maker/broker exclude lookup
  sqlite.prepare(`INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, deadline_daa)
    VALUES (?,?,?,?,?,?)`).run(marketId, '__none__', 'kaspatest:spine', '00'.repeat(32), DEADLINE_DAA, DEADLINE_DAA);
}
function addBet(marketId, bettorPk, daa, txSuffix) {
  sqlite.prepare(`INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, stake_amount, side_p2sh, side_lock_tx, side_lock_daa)
    VALUES (?,?,?,?,?,?,?)`).run(marketId, bettorPk, 0, '100000000', 'kaspatest:side', 'tx' + txSuffix, daa);
}

// CASE 1: a bet with NULL side_lock_daa → sampleAndStoreCommittee MUST throw (fail-loud)
setupMarket('mkt-null');
addBet('mkt-null', POOL[0], DEADLINE_DAA - 1, 'A'); // valid daa
addBet('mkt-null', '99'.repeat(32), null, 'B');     // NULL daa → must trip fail-loud
let threw = false, msg = '';
try { sampleAndStoreCommittee('mkt-null', END_BLOCK); }
catch (e) { threw = true; msg = e.message; }
check('NULL side_lock_daa bet → sampleAndStoreCommittee fail-loud throw', threw && /NULL side_lock_daa/.test(msg), `threw=${threw} msg=${msg}`);

// CASE 2: control — all bettors have non-NULL daa → must NOT throw the NULL-daa error (gets PAST the daa loop).
//   (it may throw later for enrollment reasons — assert specifically the NULL error is absent = daa loop accepted valid daa.)
setupMarket('mkt-ok');
addBet('mkt-ok', POOL[0], DEADLINE_DAA - 5, 'C');  // <= deadline → eligible bettor (would be excluded if oracle)
addBet('mkt-ok', POOL[1], DEADLINE_DAA + 50, 'D'); // > deadline → post-deadline straggler (not excluded)
let nullErr = false, err2 = '';
try { sampleAndStoreCommittee('mkt-ok', END_BLOCK); }
catch (e) { err2 = e.message; if (/NULL side_lock_daa/.test(e.message)) nullErr = true; }
check('non-NULL daa bets → NO NULL-daa fail-loud (daa loop accepts valid daa)', !nullErr, `unexpected NULL error: ${err2}`);

// CASE 3: missing deadline_daa → #27a cannot chain-anchor → fail-loud (distinct guard, L347-350)
sqlite.prepare(`INSERT INTO pool_snapshots (market_id, pool_merkle_root, pool_size, pool_pks_json, pool_stakes_json)
  VALUES (?,?,?,?,?)`).run('mkt-nodd', POOL_ROOT, POOL.length, JSON.stringify(POOL), JSON.stringify(STAKES));
sqlite.prepare(`INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline)
  VALUES (?,?,?,?,?)`).run('mkt-nodd', '__none__', 'kaspatest:spine', '00'.repeat(32), 0); // deadline_daa NULL
addBet('mkt-nodd', POOL[0], 500, 'E');
let ddThrew = false, ddMsg = '';
try { sampleAndStoreCommittee('mkt-nodd', END_BLOCK); }
catch (e) { ddThrew = true; ddMsg = e.message; }
check('missing deadline_daa → fail-loud (cannot chain-anchor)', ddThrew && /deadline_daa/.test(ddMsg), `threw=${ddThrew} msg=${ddMsg}`);

// CASE 4: #27a v2.1 forward-break recapture — no-op on a market whose bets all have daa (no NULL → no RPC).
setupMarket('mkt-recap-noop');
addBet('mkt-recap-noop', POOL[0], DEADLINE_DAA - 3, 'F');
const rc0 = await recaptureSideLockDaaForMarket('mkt-recap-noop');
check('recapture no-op when no NULL bets', rc0.recaptured === 0 && rc0.remaining === 0, JSON.stringify(rc0));

// CASE 5: recapture GRACEFUL when chain unreachable (dummy RPC) — NULL bet stays NULL (re-tries next tick),
//   set-daa bet is NEVER overwritten, no crash. (The real mempool→confirmed fill is covered by live 2-node e2e.)
setupMarket('mkt-recap-graceful');
addBet('mkt-recap-graceful', POOL[0], DEADLINE_DAA - 2, 'G');   // already has daa — must NOT be touched
addBet('mkt-recap-graceful', '88'.repeat(32), null, 'H');        // NULL — recapture attempts, RPC unreachable → stays NULL
const rc1 = await recaptureSideLockDaaForMarket('mkt-recap-graceful');
const keptDaa = sqlite.prepare("SELECT side_lock_daa FROM pool_bettor_sides WHERE market_id='mkt-recap-graceful' AND side_lock_tx='txG'").get().side_lock_daa;
const stillNull = sqlite.prepare("SELECT side_lock_daa FROM pool_bettor_sides WHERE market_id='mkt-recap-graceful' AND side_lock_tx='txH'").get().side_lock_daa;
check('recapture graceful: unreachable chain → no crash, returns remaining>0', rc1.remaining >= 1, JSON.stringify(rc1));
check('recapture NEVER overwrites an already-set daa (idempotent)', Number(keptDaa) === DEADLINE_DAA - 2, `keptDaa=${keptDaa}`);
check('recapture leaves truly-unresolvable bet NULL (→ fail-loud later, not silent)', stillNull === null, `stillNull=${stillNull}`);

try { sqlite.close(); } catch {}
try { rmSync(TMP, { force: true }); rmSync(TMP + '-wal', { force: true }); rmSync(TMP + '-shm', { force: true }); } catch {}

console.log(fails === 0 ? '\n✅ #27a v2 NULL-daa fail-loud regression PASS' : `\n❌ ${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);
