// NWT independent mutation run for D-026 (9c86a049). Each mutation: patch source, run the owning test file, record red tests, restore.
const fs = require('fs'), cp = require('child_process');
const SPL = 'src/services/utxo-splitter.js';
const BRC = 'src/lib/broadcaster-utxo.mjs';
const GATE_SPL = "if (process.env[UTXO_AUTOSPLIT_ON_START_ENV] !== '1') {";
const GATE_BRC = "if (process.env[BROADCASTER_UTXO_MAINTAIN_ENV] !== '1') {";
const PROTO_SKIP = "    if (_isProtoRelay(a)) {\n      console.log(`[utxo-splitter] ${a.name}: skip (proto relay — UTXO shape managed by execution page)`);\n      continue;\n    }\n";
const EARLY_SPL = /  if \(process\.env\[UTXO_AUTOSPLIT_ON_START_ENV\] !== '1'\) \{[\s\S]*?\n  \}\n/;
const EARLY_BRC = /  if \(process\.env\[BROADCASTER_UTXO_MAINTAIN_ENV\] !== '1'\) \{[\s\S]*?\n  \}\n/;
const PREPARE = "  const accounts = sqlite.prepare(";
const muts = [
  // ── utxo-splitter ──
  [SPL, 'utxo-splitter.test', 'M1 delete early-return block', (s) => s.replace(EARLY_SPL, '')],
  [SPL, 'utxo-splitter.test', 'M2 loose gate (!env)', (s) => s.replace(GATE_SPL, "if (!process.env[UTXO_AUTOSPLIT_ON_START_ENV]) {")],
  [SPL, 'utxo-splitter.test', 'M3 inverted gate', (s) => s.replace(GATE_SPL, "if (process.env[UTXO_AUTOSPLIT_ON_START_ENV] === '1') {")],
  [SPL, 'utxo-splitter.test', 'M4 (env=1) delete _isProtoRelay skip block', (s) => s.replace(PROTO_SKIP, '')],
  [SPL, 'utxo-splitter.test', 'M5 move early return AFTER sqlite.prepare', (s) => { const blk = s.match(EARLY_SPL)[0]; return s.replace(EARLY_SPL, '').replace("  ).all();\n\n  let splitCount = 0;", "  ).all();\n" + blk + "\n  let splitCount = 0;"); }],
  [SPL, 'utxo-splitter.test', 'N1 _isProtoRelay: drop PROTO_RELAY_ID id-check (name prefix only)', (s) => s.replace("if (process.env.PROTO_RELAY_ID && a.id === process.env.PROTO_RELAY_ID) return true;", "")],
  [SPL, 'utxo-splitter.test', 'N2 _isProtoRelay: drop proto- prefix check (id only)', (s) => s.replace("if (typeof a.name === 'string' && a.name.startsWith('proto-')) return true;", "")],
  [SPL, 'utxo-splitter.test', 'N3 disabled log drops raw=', (s) => s.replace(", raw=${JSON.stringify(process.env[UTXO_AUTOSPLIT_ON_START_ENV])})`);", ")`);")],
  [SPL, 'utxo-splitter.test', 'N4 disabled return lacks disabled:true', (s) => s.replace("return { ok: true, disabled: true, split: 0, total: 0 };", "return { ok: true, split: 0, total: 0 };")],
  [SPL, 'utxo-splitter.test', 'N5 trim() accepted (" 1", "1 ", "1\\n" would enable)', (s) => s.replace(GATE_SPL, "if (String(process.env[UTXO_AUTOSPLIT_ON_START_ENV]).trim() !== '1') {")],
  [SPL, 'utxo-splitter.test', 'N6 Number()===1 accepted ("01" would enable)', (s) => s.replace(GATE_SPL, "if (Number(process.env[UTXO_AUTOSPLIT_ON_START_ENV]) !== 1) {")],
  [SPL, 'utxo-splitter.test', 'N7 gate reads env at MODULE LOAD (const), not per call', (s) => s.replace(GATE_SPL, "if (LOADED_VALUE !== '1') {").replace("export async function autoSplitAll() {", "const LOADED_VALUE = process.env[UTXO_AUTOSPLIT_ON_START_ENV];\nexport async function autoSplitAll() {")],
  // ── broadcaster-utxo ──
  [BRC, 'broadcaster-utxo.test', 'M6 delete early-return block', (s) => s.replace(EARLY_BRC, '')],
  [BRC, 'broadcaster-utxo.test', 'M7 loose gate (!env)', (s) => s.replace(GATE_BRC, "if (!process.env[BROADCASTER_UTXO_MAINTAIN_ENV]) {")],
  [BRC, 'broadcaster-utxo.test', 'M8 inverted gate', (s) => s.replace(GATE_BRC, "if (process.env[BROADCASTER_UTXO_MAINTAIN_ENV] === '1') {")],
  [BRC, 'broadcaster-utxo.test', 'N8 gate AFTER timer registration (logs disabled but timers still registered)', (s) => { const blk = s.match(EARLY_BRC)[0]; return s.replace(EARLY_BRC, '').replace("  timer = setInterval(() => { broadcasterUtxoTick().catch(e => console.error('[broadcaster-utxo] tick:', e.message)); }, TICK_INTERVAL_MS);\n", "  timer = setInterval(() => { broadcasterUtxoTick().catch(e => console.error('[broadcaster-utxo] tick:', e.message)); }, TICK_INTERVAL_MS);\n" + blk); }],
  [BRC, 'broadcaster-utxo.test', 'N9 disabled log drops raw=', (s) => s.replace(", raw=${JSON.stringify(process.env[BROADCASTER_UTXO_MAINTAIN_ENV])})`);", ")`);")],
  [BRC, 'broadcaster-utxo.test', 'N10 gate also blocks on-demand ensureBroadcasterUtxos (design says it must NOT)', (s) => s.replace("export async function ensureBroadcasterUtxos(relayId, targetN = TARGET_UTXOS, timeoutMs = 60_000) {", "export async function ensureBroadcasterUtxos(relayId, targetN = TARGET_UTXOS, timeoutMs = 60_000) {\n  if (process.env.BROADCASTER_UTXO_MAINTAIN !== '1') return { ok: false, reason: 'gated' };")],
];
const backup = { [SPL]: fs.readFileSync(SPL, 'utf8'), [BRC]: fs.readFileSync(BRC, 'utf8') };
const out = [];
for (const [file, testName, name, fn] of muts) {
  const orig = backup[file];
  let m;
  try { m = fn(orig); } catch (e) { out.push(`?? PATCH-ERR ${name}: ${e.message}`); continue; }
  if (m === orig) { out.push(`?? NOOP (pattern not found): ${name}`); continue; }
  fs.writeFileSync(file, m);
  const testFile = testName === 'utxo-splitter.test' ? 'src/services/utxo-splitter.test.mjs' : 'src/lib/broadcaster-utxo.test.mjs';
  const r = cp.spawnSync('node', ['--experimental-test-module-mocks', '--test', testFile], { encoding: 'utf8', timeout: 120000 });
  const txt = (r.stdout || '') + (r.stderr || '');
  const red = [...txt.matchAll(/✖ (\(?[A-Za-z0-9\/\-]+\)?[^\n]{0,60})/g)].map((x) => x[1].replace(/\s+\(\d.*$/, '').trim());
  const uniq = [...new Set(red.map((x) => x.replace(/gate closed for .*/, 'gate closed for <v>').slice(0, 40)))];
  const nfail = (txt.match(/ℹ fail (\d+)/) || [])[1];
  out.push(`${r.status === 0 ? 'SURVIVED' : 'killed  '} ${name}  [fail=${nfail}]  ${uniq.join(' | ')}`);
}
for (const f of [SPL, BRC]) fs.writeFileSync(f, backup[f]);
console.log(out.join('\n'));
