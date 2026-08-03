// pbs8-signreq-byzantine-handler.test.mjs — PB-S8-1 real-handler regression (Codex 卡②,
// Bettor #czopcr P1: "唯一能把 PB-S8-1 从 [SUSPECTED·未实弹] 升格的东西").
//
// Existing offline case (test-framework/cases/predictions/pool/
// pbs8_signreq_byzantine_check_regression.test.mjs) only replays the SQL — it never imports or
// calls handlePoolOracleTxSignReq itself, so it cannot prove "a mismatched vote really prevents
// sign_input_for_settle from being called." This file closes that gap: it imports and calls the
// REAL exported function, with relay IPC (get_pubkey/sign_input_for_settle/send_broadcast) and
// the kaspa-wasm-backed toSettleSafeJsonTxHex mocked via node:test's mock.module (spike-verified
// working with --experimental-test-module-mocks, 2026-08-03) — mocking those two is in-scope
// (they're not what PB-S8-1 protects), everything else (DB reads, the byzantine comparison
// itself) runs as real production code against a throwaway in-memory-backed sqlite file.
//
// DB_PATH must be set BEFORE any static import touches ../db/client.js (module-level singleton,
// bound to DB_PATH at first import) — this file has zero static app imports for that reason;
// everything relevant is dynamically imported after DB_PATH + mock.module are set up.
//
// Run: cd kasia-console && node --experimental-test-module-mocks --test src/services/pbs8-signreq-byzantine-handler.test.mjs
// (also: npm run test:pbs8-handler, kasia-console/package.json)
//
// Bettor 2026-08-03(卡②代审收口, J1代审): (133)的"写死在可执行处"这条本文件满足了
// (npm script + docs/TEST-FRAMEWORK.md都指得到跑法)——但这不等于它进了"回归覆盖":
// scripts/test.mjs --domain/--all只收test-framework/cases/下的*.test.mjs, 本文件在
// src/services/下, 永远不会被--domain/--all扫到, 同m0c1-gate那10个文件同族。证据只在
// "有人手动跑npm run test:pbs8-handler"的时候才新鲜, 别把"能跑"读成"在被跑"。

import { test, mock } from 'node:test';
import assert from 'node:assert';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmpDir = mkdtempSync(join(tmpdir(), 'pbs8-handler-test-'));
process.env.DB_PATH = join(tmpDir, 'test.db');

const { sqlite } = await import('../db/client.js');
sqlite.exec(`
  CREATE TABLE pool_markets (id TEXT PRIMARY KEY, protocol_status TEXT, metadata TEXT);
  CREATE TABLE pool_committee (market_id TEXT PRIMARY KEY, committee_pks TEXT NOT NULL);
  CREATE TABLE relay_nodes (id TEXT PRIMARY KEY, name TEXT, address TEXT, is_oracle INTEGER DEFAULT 0);
  CREATE TABLE chain_events (id TEXT PRIMARY KEY, txid TEXT, from_address TEXT, to_address TEXT,
    event_type TEXT, payload TEXT, observed_by TEXT, observed_at TEXT);
`);

const ORACLE_ID = 'test-oracle-relay-1';
const ORACLE_PK = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff66660000777788889999';
const MARKET_YES = 'test_pbs8h_market_yes';   // oracle voted YES, msg claims winner=0 (YES) — should sign
const MARKET_MISMATCH = 'test_pbs8h_market_mismatch'; // oracle voted NO, msg claims winner=0 (YES) — must refuse
const MARKET_MISSING = 'test_pbs8h_market_missing';   // oracle never voted — must refuse
const MARKET_MALFORMED = 'test_pbs8h_market_malformed'; // oracle's vote row is malformed JSON — must refuse
// J1 代审 MUST-FIX(2026-08-03, 注入实验 1+2 坐实): all four MARKET_* fixtures share ONE
// chain_events table. Without the json_valid guard, querying MARKET_YES's row throws on ANY
// malformed row present anywhere in the table (not just rows for the queried market) — so the
// suite's own coincidental cross-market pollution masked which assertion the guard actually
// protects: removing the guard flipped MARKET_YES's "signs once" test red, while
// MARKET_MALFORMED's dedicated guard test stayed green (0 signs either way — guarded-and-filtered
// vs unguarded-and-thrown-then-caught are observationally identical to that assertion). A routine
// test-hygiene refactor (isolate each test's own DB) would have silently deleted this suite's only
// signal for a card① regression while staying all-green. Fix: a same-market dirty-row-BEFORE-
// legit-row case whose assertion (still signs) can only pass if the guard genuinely skips the
// dirty row and reaches the legit one — without the guard, the query throws before reaching the
// legit row, gets caught, and this specific assertion goes red (not a neighboring market's).
const MARKET_DIRTY_FIRST = 'test_pbs8h_market_dirty_first';

function seedMarket(id) {
  sqlite.prepare(`INSERT INTO pool_markets (id, protocol_status, metadata) VALUES (?, 'verifying', ?)`)
    .run(id, JSON.stringify({ phase2_tx_obj: { inputs: [], outputs: [], lockTime: 0, gas: 0 } }));
  sqlite.prepare(`INSERT INTO pool_committee (market_id, committee_pks) VALUES (?, ?)`)
    .run(id, JSON.stringify([ORACLE_PK]));
}
function seedVote(marketId, outcome, observedAt) {
  sqlite.prepare(`INSERT INTO chain_events (id, txid, event_type, observed_by, observed_at, payload) VALUES (?, ?, 'pool_oracle_vote', 'test-fixture', ?, ?)`)
    .run(randomBytes(8).toString('hex'), randomBytes(8).toString('hex'), observedAt || new Date().toISOString(),
      JSON.stringify({ market_id: marketId, voter_pubkey: ORACLE_PK, outcome }));
}
function seedMalformedVote(observedAt) {
  // Deliberately no market_id in the payload (it's not even valid JSON) — this row pollutes
  // the shared chain_events table for EVERY market's query when the json_valid guard is missing,
  // which is the whole point of MARKET_DIRTY_FIRST below.
  sqlite.prepare(`INSERT INTO chain_events (id, txid, event_type, observed_by, observed_at, payload) VALUES (?, ?, 'pool_oracle_vote', 'test-fixture', ?, 'not valid json {{{')`)
    .run(randomBytes(8).toString('hex'), randomBytes(8).toString('hex'), observedAt || new Date().toISOString());
}
sqlite.prepare(`INSERT INTO relay_nodes (id, name, address, is_oracle) VALUES (?, 'TestOracle', 'kaspatest:testoracle', 1)`).run(ORACLE_ID);
seedMarket(MARKET_YES); seedVote(MARKET_YES, 'YES');
seedMarket(MARKET_MISMATCH); seedVote(MARKET_MISMATCH, 'NO');
seedMarket(MARKET_MISSING); // no vote seeded
seedMarket(MARKET_MALFORMED); seedMalformedVote();
// J1 MUST-FIX fixture: malformed row sorted BEFORE (earlier observed_at than) the legit vote row
// for the SAME market. ORDER BY observed_at ASC LIMIT 1 means the guard must skip past this row
// to reach the legit one — this is the case that actually exercises the guard end-to-end.
seedMarket(MARKET_DIRTY_FIRST);
seedMalformedVote('2020-01-01T00:00:00.000Z');
seedVote(MARKET_DIRTY_FIRST, 'YES', '2020-01-01T00:00:01.000Z');

// Mock relay-manager.sendCommandAsync: records every call, returns canned results per cmd.type.
// Named function (not an inline `sendCommandAsync: async (...) =>` object-literal shorthand) —
// lint rule R-SCA-ALIAS-ORIGIN's alias-detector regex captures whatever token follows
// `sendCommandAsync:`, and the `async` keyword itself parses as a valid identifier there,
// producing a false "alias named 'async'" match against this file's unrelated `async () => {}`
// test callbacks. Naming the mock function sidesteps the false positive without weakening the
// rule (the mock is invoked BY the real handler code, which already carries 'internal' as its
// 4th arg — verified at trade-protocol-filter.js:594/669/... — this file has no direct
// sendCommandAsync call sites for the rule to legitimately flag).
const calls = [];
async function mockSendCommandAsync(relayId, cmd) {
  calls.push({ relayId, type: cmd.type });
  if (cmd.type === 'get_pubkey') return { x_only_pubkey: ORACLE_PK };
  if (cmd.type === 'sign_input_for_settle') return { ok: true, signature: 'deadbeef'.repeat(16) };
  if (cmd.type === 'send_broadcast') return { txId: 'fake-tx-' + randomBytes(4).toString('hex') };
  return { ok: false, error: 'unmocked command type ' + cmd.type };
}
mock.module('./relay-manager.js', { namedExports: { sendCommandAsync: mockSendCommandAsync } });
// Mock settle-safe-json's kaspa-wasm-backed conversion — out of scope for what PB-S8-1 protects
// (it converts an already-approved tx_obj to a signing format; PB-S8-1 protects whether we get
// to that point at all). Real kaspa-wasm Transaction construction needs a fully-shaped tx_obj
// this fixture doesn't provide, and testing it here would test something else's job.
mock.module('../lib/settle-safe-json.mjs', {
  namedExports: { toSettleSafeJsonTxHex: async () => 'fake-safe-json-hex' },
});

const { handlePoolOracleTxSignReq } = await import('./trade-protocol-filter.js');

const signCallCount = () => calls.filter(c => c.type === 'sign_input_for_settle').length;
const baseMsg = { winner: 0, input_count: 1, spine_input_count: 1 };

test('correct vote (YES matches winner=0) — signs exactly once', async () => {
  calls.length = 0;
  await handlePoolOracleTxSignReq({ ...baseMsg, market_id: MARKET_YES });
  assert.strictEqual(signCallCount(), 1, `expected exactly 1 sign_input_for_settle call, got ${signCallCount()}`);
});

test('byzantine mismatch (voted NO, winner claims YES) — refuses, zero signs', async () => {
  calls.length = 0;
  await handlePoolOracleTxSignReq({ ...baseMsg, market_id: MARKET_MISMATCH });
  assert.strictEqual(signCallCount(), 0, `expected 0 sign_input_for_settle calls on mismatch, got ${signCallCount()}`);
});

test('missing vote (oracle never voted) — refuses, zero signs', async () => {
  calls.length = 0;
  await handlePoolOracleTxSignReq({ ...baseMsg, market_id: MARKET_MISSING });
  assert.strictEqual(signCallCount(), 0, `expected 0 sign_input_for_settle calls on missing vote, got ${signCallCount()}`);
});

test('malformed vote payload (json_valid guard) — refuses, zero signs, no throw', async () => {
  calls.length = 0;
  await assert.doesNotReject(handlePoolOracleTxSignReq({ ...baseMsg, market_id: MARKET_MALFORMED }),
    'handler must not throw on a malformed own-vote row (json_valid guard, card①)');
  assert.strictEqual(signCallCount(), 0, `expected 0 sign_input_for_settle calls on malformed vote, got ${signCallCount()}`);
});

// J1 代审 MUST-FIX(2026-08-03): the ONLY assertion in this file that can exclusively fail when
// the json_valid guard is missing — see MARKET_DIRTY_FIRST fixture comment above. With the
// guard: query skips the malformed row (sorted first), finds the legit YES vote, signs (count=1).
// Without the guard: query throws scanning the malformed row before reaching the legit one,
// caught by handlePoolOracleTxSignReq's try/catch, 0 signs — THIS test goes red, not a
// neighboring market's, and not for a misleading "signing path is broken" reason.
test('dirty row sorted before legit row, same market — guard skips it, signs exactly once', async () => {
  calls.length = 0;
  await handlePoolOracleTxSignReq({ ...baseMsg, market_id: MARKET_DIRTY_FIRST });
  assert.strictEqual(signCallCount(), 1, `expected exactly 1 sign_input_for_settle call (guard should skip the earlier malformed row and reach the legit vote), got ${signCallCount()}`);
});

test('teardown', () => {
  mock.reset();
  sqlite.close();
  rmSync(tmpDir, { recursive: true, force: true });
});
