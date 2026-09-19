// watch-accounts.static.test.mjs — D-028 静态验收: A4(标识符只许出现在白名单文件,用共享扫描器)· A5(backup.js 不含新表、路由文件无写方法)· A6(冷存区块无发送入口)· A13(迁移 + DATABASE.md)。
// 共享扫描器 = kasia-console/test-fixtures/source-scan/scan-non-test-sources.mjs(J2 F5 状态机版 stripComments;扫描根含 kasia-console/scripts)。
// 结构性论据: 没有任何既有查询会读到 watch_accounts——这条扫描把"默认拒绝"钉成测试(新增读它的代码只能进白名单,评审可见)。
// Run: cd kasia-console && node --test src/services/watch-accounts.static.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findReferencesInNonTestSources, repoRootDir, stripComments } from '../../test-fixtures/source-scan/scan-non-test-sources.mjs';

const ROOT = repoRootDir();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// 允许出现 watch_accounts 标识符的非测试文件(其余任何文件出现 ⇒ 红):迁移建表 / 只读 API+汇总 / 登记逻辑
const ALLOWED = ['kasia-console/src/db/migrate.js', 'kasia-console/src/api/watch-accounts.js', 'kasia-console/src/lib/watch-account-register.mjs', 'kasia-console/scripts/watch-account-register.mjs'];

test('A4 the identifier watch_accounts appears in NO non-test source outside the allowlist (every spend / identity / spawn path is therefore unable to read it)', () => {
  const stray = findReferencesInNonTestSources(/\bwatch_accounts\b/, { exceptRel: ALLOWED });
  assert.deepStrictEqual(stray, [], `unexpected readers of watch_accounts: ${stray.join(', ')} — add them to the allowlist only after review (default-deny is the D-028 structural guarantee)`);
});
test('A4 control arm: the scan really does see the allowlisted files (so an empty result above is not an empty scan), and kasia-console/scripts is inside the scan root', () => {
  const all = findReferencesInNonTestSources(/\bwatch_accounts\b/, {});
  for (const f of ALLOWED) assert.ok(all.includes(f), `the scan must find ${f}`);
  const withScripts = findReferencesInNonTestSources(/parseInput/, {});
  assert.ok(withScripts.includes('kasia-console/scripts/watch-account-register.mjs'), 'kasia-console/scripts must be scanned (NWT F2-1: the scan root includes it)');
});
test('A4 the spend-path modules never mention the table (autoSplitAll / startAll / broadcaster / guards read relay_nodes only)', () => {
  for (const rel of ['kasia-console/src/services/utxo-splitter.js', 'kasia-console/src/services/relay-manager.js', 'kasia-console/src/lib/broadcaster-utxo.mjs', 'kasia-console/src/services/relay-health-monitor.js', 'kasia-console/src/services/relay-hotwallet-monitor.js']) {
    assert.ok(!/watch_accounts|watch-balance|watch-account/i.test(stripComments(read(rel))), `${rel} must not reference the watch account modules`);
  }
});
test('A5 api/backup.js does not include the new table (its import is a write path; whole-DB backup already contains the table)', () => {
  const src = stripComments(read('kasia-console/src/api/backup.js'));
  assert.ok(!/watch_accounts|watch-account/i.test(src));
});
test('A5 the watch route file registers only GET routes; the balance module contains no key material handling and does not reuse getKasBalance', () => {
  const routes = stripComments(read('kasia-console/src/api/watch-accounts.js'));
  assert.ok(!/fastify\.(post|put|patch|delete|route|all)\s*\(/.test(routes), 'no write method on a watch route');
  assert.ok((routes.match(/fastify\.get\s*\(/g) || []).length === 2);
  const bal = stripComments(read('kasia-console/src/services/watch-balance.js'));
  assert.ok(!/getKasBalance|mnemonic|privkey|decrypt\s*\(/i.test(bal));
  assert.ok(!/from\s+['"][^'"]*(relay-manager|sendCommand)/.test(bal), 'the reader never touches the relay command path');
});
test('A5 the router file registers the watch routes AFTER the portfolio routes and passes no writer', () => {
  const idx = stripComments(read('kasia-console/src/index.js'));
  assert.ok(/await registerWatchAccountRoutes\(fastify\);/.test(idx));
});

test('A6 the cold block of portfolio.eta has no send / transfer / split / key entry, only the copy button, and carries the badge text', () => {
  const eta = read('kasia-console/src/ui/portfolio.eta');
  const a = eta.indexOf('冷存(只读)账户 (D-028'); const b = eta.indexOf('Oracle Earnings (Oracle v0.3');
  assert.ok(a > 0 && b > a, 'block boundaries found');
  const block = eta.slice(a, b);
  for (const bad of ['sendModal', '/transfer', '/send', 'split', 'privkey', 'mnemonic', 'openSend', 'fetch(']) assert.ok(!block.includes(bad), `the cold block must not contain "${bad}"`);
  assert.ok(block.includes('冷存 · 只读 · 不可花'));
  assert.strictEqual((block.match(/<button/g) || []).length, 1, 'exactly one button: copy address');
  assert.ok(/@click="copyAddr\(w\.address, \$event\)"/.test(block));
  assert.ok(block.includes('—（无法读取）'), 'unreadable renders a dash, not 0');
  assert.ok(!/status === 'unavailable'[^>]*\|\| 0/.test(block));
  // sanity: the file's OTHER parts still have the send machinery, so the absence above is meaningful
  assert.ok(eta.includes('sendModal'));
});
test('A6 the headline breakdown flags an incomplete total instead of silently leaving cold money out', () => {
  const eta = read('kasia-console/src/ui/portfolio.eta');
  assert.ok(eta.includes('总计不完整') && eta.includes('watchUnreadable'));
  const gt = eta.slice(eta.indexOf('grandTotal() {'), eta.indexOf('async init()'));
  assert.ok(/const nativeKas = \(this\.data\?\.totals\?\.kas \|\| 0\) \+ \(this\.data\?\.totals\?\.watchKas \|\| 0\);/.test(gt),'grandTotal() adds the cold KAS to the hot native KAS (the code line, not a comment)');
});

test('A13 migration v211 creates the table after v210, and docs/DATABASE.md documents it', () => {
  const mig = read('kasia-console/src/db/migrate.js');
  const versions = [...mig.matchAll(/^\s*\/\/ ── v(\d+) /gm)].map((m) => Number(m[1]));
  assert.strictEqual(Math.max(...versions), 211, 'v211 is the latest migration');
  assert.ok(versions.filter((v) => v === 211).length === 1, 'exactly one v211 block');
  assert.ok(/CREATE TABLE IF NOT EXISTS watch_accounts/.test(mig) && /CHECK \(custody = 'cold_no_key'\)/.test(mig));
  assert.ok(!/mnemonic|privkey|hint/i.test(mig.slice(mig.indexOf('CREATE TABLE IF NOT EXISTS watch_accounts'), mig.indexOf('watch_accounts 建表(只读'))));
  const doc = read('docs/DATABASE.md');
  assert.ok(/### watch_accounts（v211/.test(doc));
});
