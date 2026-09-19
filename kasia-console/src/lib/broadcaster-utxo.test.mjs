// broadcaster-utxo.test.mjs — D-026 M1 (NWT de2ded3d / design v0.2 §7.1, acceptance V8).
// startBroadcasterUtxoMaintainerCron() is OFF unless BROADCASTER_UTXO_MAINTAIN is the literal string '1'.
// Off ⇒ no timer registered, no DB access, no relay IPC, exactly one `[broadcaster-utxo] disabled (...)` line with raw=.
// On  ⇒ the pre-existing `started — tick=180000ms target=30 ...` line appears and the cron behaves as before
//        (first tick after the 90 s grace forces a split_utxo targetCount=30 on an is_oracle=1 relay). That positive control
//        is what stops the closed-state tests from being vacuous.
// The on-demand export ensureBroadcasterUtxos() is a caller-driven path and is deliberately NOT gated (asserted below).
//
// Real DB (temp SQLite via DB_PATH, migrated fresh) + node:test mock timers; only the relay IPC boundary is stubbed.
// Run: cd kasia-console && node --experimental-test-module-mocks --test src/lib/broadcaster-utxo.test.mjs

import { test, mock } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDir = mkdtempSync(join(tmpdir(), 'kanetui-broadcaster-utxo-test-'));
const DB_PATH = join(tmpDir, 'console.db');
process.env.DB_PATH = DB_PATH;
execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH }, stdio: 'pipe' });
// this file must not depend on ambient env for the target set
delete process.env.BROADCASTER_RELAY_IDS; delete process.env.POOL_SEEDER_MAKER_RELAY; delete process.env.PROTO_RELAY_ID;

const calls = [];
async function mockSendCommandAsync(relayId, cmd) {
  calls.push({ relayId, cmd });
  return { ok: true, split: true, utxosBefore: 1, utxosAfter: 30, txId: 'deadbeefdeadbeef' };
}
mock.module('../services/relay-manager.js', { namedExports: { sendCommandAsync: mockSendCommandAsync } });

const { sqlite } = await import('../db/client.js');
const { startBroadcasterUtxoMaintainerCron, stopBroadcasterUtxoMaintainerCron, ensureBroadcasterUtxos, BROADCASTER_UTXO_MAINTAIN_ENV } = await import('./broadcaster-utxo.mjs');

const ENV = BROADCASTER_UTXO_MAINTAIN_ENV;
assert.strictEqual(ENV, 'BROADCASTER_UTXO_MAINTAIN', 'env key name is part of the D-026 contract');
const ENV_BEFORE_FILE = Object.prototype.hasOwnProperty.call(process.env, ENV) ? process.env[ENV] : undefined;
function setEnv(v) { if (v === undefined) delete process.env[ENV]; else process.env[ENV] = v; }

function insertOracleRelay({ id, name }) {
  const now = new Date().toISOString();
  sqlite.prepare(`INSERT INTO relay_nodes (id, name, mnemonic_encrypted, address, network, created_at, updated_at, is_oracle)
    VALUES (?, ?, 'enc-blob', ?, 'mainnet', ?, ?, 1)`).run(id, name, `kaspatest:fake-${id.slice(0, 8)}`, now, now);
}
async function captureLogs(fn) {
  const lines = []; const orig = console.log;
  console.log = (...a) => { lines.push(a.map(String).join(' ')); };
  try { const ret = await fn(); return { ret, lines }; } finally { console.log = orig; }
}
const flush = () => new Promise((r) => setImmediate(r));

const CLOSED_VALUES = [undefined, '0', 'true', ' 1', 'yes', '', '01', '１', '1\n', '"1"', 'TRUE', '1 '];

for (const v of CLOSED_VALUES) {
  test(`(V8) gate closed for ${v === undefined ? 'UNSET' : JSON.stringify(v)}: no timer, zero IPC, zero DB access, exactly one disabled line with raw=`, async (t) => {
    calls.length = 0;
    sqlite.prepare('DELETE FROM relay_nodes').run();
    insertOracleRelay({ id: randomUUID(), name: 'OracleRelay-would-be-rebalanced-if-open' }); // a real target: only the gate keeps it out
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const setI = mock.method(globalThis, 'setInterval');
    const setT = mock.method(globalThis, 'setTimeout');
    const prep = mock.method(sqlite, 'prepare');
    try {
      setEnv(v);
      const { lines } = await captureLogs(() => startBroadcasterUtxoMaintainerCron());
      t.mock.timers.tick(10 * 60 * 1000); await flush();   // ten minutes of mock time: a leaked timer would have fired by now
      assert.strictEqual(setI.mock.calls.length, 0, 'no setInterval registered');
      assert.strictEqual(setT.mock.calls.length, 0, 'no setTimeout registered');
      assert.strictEqual(calls.length, 0, 'zero relay IPC');
      assert.strictEqual(prep.mock.calls.length, 0, 'zero sqlite.prepare');
      assert.deepStrictEqual(lines, [`[broadcaster-utxo] disabled (${ENV}!=1, raw=${JSON.stringify(v)})`]);
    } finally { stopBroadcasterUtxoMaintainerCron(); prep.mock.restore(); setI.mock.restore(); setT.mock.restore(); setEnv(ENV_BEFORE_FILE); }
  });
}

test("(V8-control) env='1': started line appears unchanged, timers are registered, and the first tick after 90 s forces split_utxo target 30 on the is_oracle relay", async (t) => {
  calls.length = 0;
  sqlite.prepare('DELETE FROM relay_nodes').run();
  const id = randomUUID();
  insertOracleRelay({ id, name: 'OracleRelay-target' });
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    process.env[ENV] = '1';
    const { lines } = await captureLogs(() => startBroadcasterUtxoMaintainerCron());
    assert.ok(lines.some(l => l.startsWith('[broadcaster-utxo] started — tick=180000ms target=30 UTXOs/broadcaster')), `expected the pre-existing started line, got ${JSON.stringify(lines)}`);
    assert.ok(!lines.some(l => l.includes('] disabled (')), 'no disabled line when enabled');
    assert.strictEqual(calls.length, 0, 'nothing sent before the 90 s grace');
    t.mock.timers.tick(90_000); await flush(); await flush();
    const mine = calls.filter(c => c.relayId === id);
    assert.strictEqual(mine.length, 1, 'exactly one split_utxo on the first tick');
    assert.deepStrictEqual(mine[0].cmd, { type: 'split_utxo', targetCount: 30, force: true }, 'the forced rebalance command shape is unchanged');
  } finally { stopBroadcasterUtxoMaintainerCron(); setEnv(ENV_BEFORE_FILE); }
});

test('(V8-ondemand) ensureBroadcasterUtxos() is a caller-driven path and is NOT affected by the cron switch', async () => {
  calls.length = 0;
  setEnv(undefined);
  const id = randomUUID();
  const r = await ensureBroadcasterUtxos(id, 30);
  assert.strictEqual(calls.filter(c => c.relayId === id).length, 1, 'the on-demand export still sends when the cron switch is off');
  assert.strictEqual(r.split, true);
  setEnv(ENV_BEFORE_FILE);
});

// ── NWT D-026 SHOULD (9c86a049 review) + NWT 9b2e7943 §五 fixes: pin "the ONLY callers of the two cron-bypassing exports are inside this file" ──
// BOTH exports bypass the BROADCASTER_UTXO_MAINTAIN switch: ensureBroadcasterUtxos() (caller-driven `split_utxo force:true` =
// consolidate + resplit, real fees) and broadcasterUtxoTick() (the tick body itself). A future second caller — e.g. a pool-settle
// path "warming up" broadcasters — would spend while everyone believes the switch keeps this module quiet. This scan makes that a
// red test instead of a surprise. Non-test source only (tests legitimately call them).
//
// v2 (NWT probes A/C/D, all three bypassed v1 for real):
//   A  a call placed under kasia-console/src/data/… was skipped because v1 matched directory NAMES at any depth; kasia-console/src/data
//      is real runtime source. ⇒ data/logs/scratch/docs/.claude are skipped ONLY at the repository ROOT (relative-path match);
//      only node_modules and .git are skipped at any depth.
//   C  `/* warm */ export const f = () => B.ensureBroadcasterUtxos(…)` was dropped because v1 judged comments per line by prefix.
//      ⇒ the whole file is comment-stripped first by a small string/template/regex-escape-aware state machine (over-keeping is the
//      safe direction: a reference that survives inside a comment fails the test loudly; over-stripping real code is what we avoid).
//   D  an external call of broadcasterUtxoTick() was never looked for. ⇒ BOTH export names are checked.
// Known boundary: dynamic names (B['ensure' + 'BroadcasterUtxos']) defeat any text scan.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, relative, sep } from 'node:path';   // `join` is already imported at the top of this file

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');   // kasia-console/src/lib → repo root
const SELF_REL = 'kasia-console/src/lib/broadcaster-utxo.mjs';
const GUARDED_NAMES = ['ensureBroadcasterUtxos', 'broadcasterUtxoTick'];
const SKIP_ANYWHERE = new Set(['node_modules', '.git']);
const SKIP_AT_ROOT = new Set(['scratch', '.claude', 'logs', 'data', 'docs']);

// pure: should a directory named `name` located at `parentRel` (posix, '' = repo root) be skipped?
export function shouldSkipDir(parentRel, name) {
  if (SKIP_ANYWHERE.has(name)) return true;
  return parentRel === '' && SKIP_AT_ROOT.has(name);
}
// pure: is this a test file (tests may legitimately call the guarded exports)?
export function isTestPath(relPosix) {
  return /\.test\.(mjs|cjs|js|ts)$/.test(relPosix) || relPosix.split('/').some(seg => seg === 'test' || seg === 'test-framework');
}
// pure: remove // and /* */ comments while leaving string / template / char-escape contents intact
export function stripComments(src) {
  let out = '', i = 0, state = 'code', quote = '';
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && n === '*') { state = 'block'; i += 2; continue; }
      if (c === "'" || c === '"' || c === '`') { state = 'str'; quote = c; out += c; i++; continue; }
      if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }   // an escaped char in code (e.g. inside a regex literal) never opens a comment
      out += c; i++; continue;
    }
    if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } i++; continue; }
    if (state === 'block') { if (c === '*' && n === '/') { state = 'code'; i += 2; out += ' '; } else { if (c === '\n') out += c; i++; } continue; }
    // string / template: copy verbatim (template ${…} expressions stay visible = treated as code = safe direction)
    if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
    if (c === quote) { state = 'code'; out += c; i++; continue; }
    if (c === '\n' && quote !== '`') { state = 'code'; }   // unterminated single-line string: resync at newline
    out += c; i++;
  }
  return out;
}
// pure: which entries reference a guarded name outside the module itself? entries = [{ rel: posix path, text }]
export function findExternalReferences(entries) {
  const found = [];
  for (const { rel, text } of entries) {
    if (rel === SELF_REL || isTestPath(rel)) continue;
    const code = stripComments(text);
    for (const name of GUARDED_NAMES) if (code.includes(name)) found.push(`${rel}:${name}`);
  }
  return found;
}
function* walkRepo(dir, parentRel = '') {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { if (shouldSkipDir(parentRel, name)) continue; yield* walkRepo(p, parentRel ? `${parentRel}/${name}` : name); }
    else if (/\.(mjs|cjs|js|ts)$/.test(name)) yield { p, rel: (parentRel ? `${parentRel}/${name}` : name) };
  }
}

test('(D26-scan) the two cron-bypassing exports have no non-test caller outside broadcaster-utxo.mjs; inside it: 1 call of ensureBroadcasterUtxos (in the tick) and 2 calls of broadcasterUtxoTick (in the cron starter)', () => {
  const entries = [];
  for (const { p, rel } of walkRepo(REPO_ROOT)) entries.push({ rel, text: readFileSync(p, 'utf8') });
  assert.ok(entries.length > 50, `the scan must actually have walked the repo (scanned ${entries.length} files)`);
  assert.ok(entries.some(e => e.rel === SELF_REL), 'the scan must have seen the module itself (positive control on the relative-path logic)');
  const ext = findExternalReferences(entries);
  assert.deepStrictEqual(ext, [], `guarded export referenced outside broadcaster-utxo.mjs — it is NOT covered by the ${ENV} switch, so a new caller needs its own gate (D-026): ${ext.join(' | ')}`);
  // inside the module (comment-stripped): exact structure
  const code = stripComments(readFileSync(join(REPO_ROOT, SELF_REL), 'utf8'));
  const count = (needle) => code.split(needle).length - 1;
  assert.strictEqual(count('ensureBroadcasterUtxos'), 2, 'ensureBroadcasterUtxos: the export + exactly one call');
  assert.strictEqual(count('broadcasterUtxoTick'), 3, 'broadcasterUtxoTick: the export + exactly two calls (startup timeout + interval)');
  assert.ok(/export\s+async\s+function\s+ensureBroadcasterUtxos\s*\(/.test(code), 'ensureBroadcasterUtxos is the exported function');
  assert.ok(/export\s+async\s+function\s+broadcasterUtxoTick\s*\(/.test(code), 'broadcasterUtxoTick is the exported function');
  const tickBody = code.slice(code.indexOf('export async function broadcasterUtxoTick'), code.indexOf('export function startBroadcasterUtxoMaintainerCron'));
  assert.ok(/await\s+ensureBroadcasterUtxos\s*\(/.test(tickBody), 'the single ensureBroadcasterUtxos call is inside broadcasterUtxoTick()');
  const starterBody = code.slice(code.indexOf('export function startBroadcasterUtxoMaintainerCron'), code.indexOf('export function stopBroadcasterUtxoMaintainerCron'));
  assert.strictEqual(starterBody.split('broadcasterUtxoTick().catch').length - 1, 2, 'both tick calls sit inside startBroadcasterUtxoMaintainerCron() (i.e. behind the switch)');
});

// NWT's four probes as permanent control tests of the scanner itself (v1 passed B and silently missed A, C, D):
const CALL = "export const f = (id) => B.ensureBroadcasterUtxos(id, 30);";
test('(D26-scan-probe B) a plain external call is detected', () => {
  assert.deepStrictEqual(findExternalReferences([{ rel: 'kasia-console/src/services/_probe.js', text: CALL }]), ['kasia-console/src/services/_probe.js:ensureBroadcasterUtxos']);
});
test('(D26-scan-probe A) the same call under kasia-console/src/data/ is detected — data/logs/scratch/docs are skipped only at the repo root', () => {
  assert.strictEqual(shouldSkipDir('kasia-console/src', 'data'), false, 'src/data is real source');
  assert.strictEqual(shouldSkipDir('', 'data'), true, 'root-level data/ is skipped');
  assert.strictEqual(shouldSkipDir('kasia-console', 'scratch'), false);
  assert.strictEqual(shouldSkipDir('', 'scratch'), true);
  assert.strictEqual(shouldSkipDir('kasia-console/src', 'node_modules'), true, 'node_modules is skipped at any depth');
  assert.deepStrictEqual(findExternalReferences([{ rel: 'kasia-console/src/data/_probe/a.js', text: CALL }]), ['kasia-console/src/data/_probe/a.js:ensureBroadcasterUtxos']);
});
test('(D26-scan-probe C) a real call on a line that starts with a block comment is detected; genuine comments are still ignored', () => {
  assert.deepStrictEqual(findExternalReferences([{ rel: 'kasia-console/src/services/_c.js', text: `/* warm */ ${CALL}` }]), ['kasia-console/src/services/_c.js:ensureBroadcasterUtxos']);
  assert.deepStrictEqual(findExternalReferences([{ rel: 'kasia-console/src/services/_c2.js', text: `/* B.ensureBroadcasterUtxos(x) */\n// broadcasterUtxoTick()\n/**\n * ensureBroadcasterUtxos usage doc\n */\nconst a = 1;` }]), [], 'names inside real comments (block, line) are not references');
  assert.deepStrictEqual(findExternalReferences([{ rel: 'kasia-console/src/services/_c3.js', text: "const u = 'http://x'; B.ensureBroadcasterUtxos(1); // trailing" }]), ['kasia-console/src/services/_c3.js:ensureBroadcasterUtxos'], '// inside a string literal must not eat the real call after it');
  assert.deepStrictEqual(findExternalReferences([{ rel: 'kasia-console/src/services/_c4.js', text: "const r = /https?:\\/\\//; B.ensureBroadcasterUtxos(1);" }]), ['kasia-console/src/services/_c4.js:ensureBroadcasterUtxos'], 'an escaped-slash regex must not open a line comment');
});
test('(D26-scan-probe D) an external call of the OTHER guarded export broadcasterUtxoTick() is detected', () => {
  assert.deepStrictEqual(findExternalReferences([{ rel: 'kasia-console/src/services/_d.js', text: 'await broadcasterUtxoTick();' }]), ['kasia-console/src/services/_d.js:broadcasterUtxoTick']);
});
test('(D26-scan-probe T) test files and the module itself are exempt; a test dir / *.test.mjs may call the exports', () => {
  assert.deepStrictEqual(findExternalReferences([
    { rel: 'kasia-console/src/lib/broadcaster-utxo.mjs', text: CALL },
    { rel: 'kasia-console/src/lib/x.test.mjs', text: CALL },
    { rel: 'kasia-console/test/y.js', text: CALL },
    { rel: 'kasia-console/test-framework/cases/z.mjs', text: CALL },
  ]), []);
});

test.after(() => {
  setEnv(ENV_BEFORE_FILE);
  try { sqlite.close(); } catch {}
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// mutation checks (run by hand, then reverted):
//  M6  delete the early-return block in startBroadcasterUtxoMaintainerCron()  ⇒ every (V8) closed-value test RED (timers registered, IPC after 90 s)
//  M7  gate written loosely (`if (!process.env[ENV])`)                        ⇒ (V8) 'true' ' 1' 'yes' '01' '１' '1\n' '"1"' 'TRUE' '1 ' RED
//  M8  gate condition inverted                                                ⇒ (V8-control) RED
