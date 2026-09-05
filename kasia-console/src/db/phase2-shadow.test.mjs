// phase2-shadow.test.mjs — Phase-2 C 包共用影子比对器离线测试。跑: cd kasia-console && node src/db/phase2-shadow.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'p2sh-'));
process.env.DB_PATH = join(dir, 'p2sh.db');
const { sqlite } = await import(pathToFileURL(join(HERE, 'client.js')).href);
const { diffIdSets, writePhase2ShadowMismatch, runShadowCompare, SHADOW_SAMPLE_CAP } = await import(pathToFileURL(join(HERE, 'phase2-shadow.mjs')).href);

let n = 0, fail = 0;
const t = (name, fn) => { n++; try { fn(); console.log(`  ✅ ${name}`); } catch (e) { fail++; console.log(`  ❌ ${name}: ${e.message}`); } };
sqlite.exec(`CREATE TABLE events (id TEXT PRIMARY KEY, trace_id TEXT, event_scope TEXT NOT NULL DEFAULT 'system', event_type TEXT NOT NULL, source TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'info', summary TEXT NOT NULL DEFAULT '', payload_json TEXT, created_at TEXT)`);
const rows = () => sqlite.prepare("SELECT * FROM events WHERE event_type = 'phase2_shadow_mismatch' ORDER BY rowid").all();
const quiet = { log: () => {}, warn: () => {} };

t('V1 diffIdSets: 相等/只新/只旧/数字与字符串同一化/去重', () => {
  assert.deepEqual(diffIdSets([1, 2, 3], ['3', '2', '1']), { equal: true, onlyNew: [], onlyLegacy: [], newCount: 3, legacyCount: 3 });
  const d = diffIdSets([1, 2, 2, 9], [2, 3]); assert.equal(d.equal, false); assert.deepEqual(d.onlyNew, ['1', '9']); assert.deepEqual(d.onlyLegacy, ['3']); assert.equal(d.newCount, 3);
  assert.equal(diffIdSets([], []).equal, true);
});
t('V2 writePhase2ShadowMismatch: 写 events 行(type/source/level/summary 计数/payload 样本 ≤ cap)', () => {
  const big = Array.from({ length: SHADOW_SAMPLE_CAP + 5 }, (_, i) => `n${i}`);
  const diff = diffIdSets(big, ['L1']);
  const id = writePhase2ShadowMismatch(sqlite, { site: 'T', source: 'test:src', diff, ...quiet });
  const r = rows(); assert.equal(r.length, 1); assert.equal(r[0].id, id); assert.equal(r[0].source, 'test:src'); assert.equal(r[0].level, 'warn');
  assert.match(r[0].summary, /phase2_shadow_mismatch T: new=25 legacy=1 onlyNew=25 onlyLegacy=1/);
  const p = JSON.parse(r[0].payload_json); assert.equal(p.onlyNewSample.length, SHADOW_SAMPLE_CAP); assert.equal(p.onlyNewCount, 25); assert.deepEqual(p.onlyLegacySample, ['L1']); assert.equal(p.site, 'T');
});
t('V3 runShadowCompare: 相等 ⇒ 不写行; 不等 ⇒ 写一行; runNew 抛 ⇒ ran=false 不抛不写', () => {
  const before = rows().length;
  assert.equal(runShadowCompare(sqlite, { site: 'E', source: 's', runNew: () => [1, 2], runLegacy: () => [2, 1], ...quiet }).equal, true);
  assert.equal(rows().length, before);
  const r = runShadowCompare(sqlite, { site: 'N', source: 's', runNew: () => [1], runLegacy: () => [1, 2], ...quiet });
  assert.equal(r.equal, false); assert.deepEqual(r.diff.onlyLegacy, ['2']); assert.equal(rows().length, before + 1);
  const x = runShadowCompare(sqlite, { site: 'X', source: 's', runNew: () => { throw new Error('boom'); }, runLegacy: () => [1], ...quiet });
  assert.equal(x.ran, false); assert.match(x.error, /boom/); assert.equal(rows().length, before + 1);
});
t('V4 events 表缺失时写入器只 warn 不抛', () => {
  sqlite.exec('DROP TABLE events');
  let warned = 0; const id = writePhase2ShadowMismatch(sqlite, { site: 'T', source: 's', diff: diffIdSets([1], []), log: () => {}, warn: () => { warned++; } });
  assert.equal(id, null); assert.equal(warned, 1);
});

try { sqlite.close(); } catch { /* best-effort */ }
try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
console.log(`\n${n - fail} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
