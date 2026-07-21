// FINDING-2 ③ regression — assertNotCommingled single-source guard (J1 2026-06-28).
//
// scope: commit1 inlined the commingled check in register-v07 ONLY and missed the other 5 bettor stake-lock
//        handlers (register / register-v06{prep,confirm} / register-external{prep,confirm}) → auto-bet + TG
//        /bet (register-v06 dual-handle) let commingled-spine bets through. Fix = single-source
//        assertNotCommingled(market, reply, db) called at the top of EVERY stake-lock handler; lint-kanet
//        R-COMMINGLE-GUARD enforces no handler can forget it. This file tests the guard's BEHAVIOR directly
//        against the production export on a REAL migrated temp DB (= real chain_events triggers + constraints,
//        per the live-e2e>synthetic lesson: never test against a bare temp DB without migrations).
//
// run: KASPA_NETWORK=testnet-12 node test-framework/standalone/test_f2_assert_not_commingled.mjs  (exit 0=PASS)

import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync } from 'fs';

const TMP = join(tmpdir(), `kanet_f2_assert_test_${process.pid}.db`);
process.env.DB_PATH = TMP;
process.env.KASPA_RPC_URL = process.env.KASPA_RPC_URL || 'ws://127.0.0.1:17210';
process.env.KASPA_NETWORK = process.env.KASPA_NETWORK || 'testnet-12';

let fails = 0;
function check(name, ok, detail) {
  if (ok) console.log(`PASS ${name}`);
  else { fails++; console.error(`FAIL ${name}: ${detail || ''}`); }
}

const { runMigrations } = await import('../../src/db/migrate.js');
runMigrations();
const { sqlite } = await import('../../src/db/client.js');
const { assertNotCommingled, isCommingledSpine } = await import('../../src/lib/pool-commingle-detect.mjs');

// minimal fake fastify reply — captures the 409 code/body the guard sends
function fakeReply() {
  const r = { _code: null, _body: null };
  r.code = (c) => { r._code = c; return r; };
  r.send = (b) => { r._body = b; return r; };
  return r;
}

const SHARED = 'kaspatest:shared_commingled_spine';   // 2 v0.7 markets share it → commingled
const UNIQUE = 'kaspatest:unique_isolated_spine';      // 1 v0.7 market → isolated
const ins = sqlite.prepare(
  `INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_version)
   VALUES (?,?,?,?,?,?)`,
);
ins.run('f2-A', 'r', SHARED, 'h', 1782000000, 'v0.7');
ins.run('f2-B', 'r', SHARED, 'h', 1782000000, 'v0.7');
ins.run('f2-C', 'r', UNIQUE, 'h', 1782000000, 'v0.7');

// 1) commingled market → guard returns true (caller must `return`) + 409 sent with commingled error
const r1 = fakeReply();
const rejected = assertNotCommingled({ spine_p2sh: SHARED }, r1, sqlite);
check('commingled spine → returns true (rejected)', rejected === true, `got ${rejected}`);
check('commingled spine → 409 sent', r1._code === 409, `code=${r1._code}`);
check('commingled spine → error body says commingled', /commingled/i.test(r1._body?.error || ''), JSON.stringify(r1._body));

// 2) isolated market → returns false (clean), no reply touched → caller proceeds
const r2 = fakeReply();
const clean = assertNotCommingled({ spine_p2sh: UNIQUE }, r2, sqlite);
check('isolated spine → returns false (clean)', clean === false, `got ${clean}`);
check('isolated spine → no reply sent', r2._code === null, `code=${r2._code}`);

// 3) defensive no-op: null spine / null market → false, no crash (register-external v0.5 path: helper no-ops,
//    so wiring the guard there is zero-harm even though commingled is a v0.7-only condition)
const r3 = fakeReply();
check('null spine → false (no-op)', assertNotCommingled({ spine_p2sh: null }, r3, sqlite) === false && r3._code === null);
check('null market → false (no crash)', assertNotCommingled(null, fakeReply(), sqlite) === false);

// 4) single-source consistency: guard verdict == isCommingledSpine (the guard is a thin reply wrapper)
check('consistency: SHARED → isCommingledSpine true', isCommingledSpine(SHARED, sqlite) === true);
check('consistency: UNIQUE → isCommingledSpine false', isCommingledSpine(UNIQUE, sqlite) === false);

try { sqlite.close(); } catch {}
try { rmSync(TMP, { force: true }); rmSync(TMP + '-wal', { force: true }); rmSync(TMP + '-shm', { force: true }); } catch {}

console.log(fails === 0 ? '\n✅ FINDING-2 ③ assertNotCommingled guard regression PASS' : `\n❌ ${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);
