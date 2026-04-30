/**
 * SA-3 lint R-NWT-STATE-MACHINE 单元测试.
 *
 * Run: node --test test/lint-state-machine.test.mjs
 *
 * 验 lint rule:
 *   1. broker-* file 直 UPDATE retail_dex_orders.state → hit violation
 *   2. escape hatch // lint-allow-state-update 加上 → violation 消失
 *   3. broker-state-machine.js 自身 (canonical entry) 例外
 *   4. 非 broker-* file (e.g. broker-state-authority.test.mjs) 不 hit (path filter 严)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const REPO_ROOT = path.resolve(import.meta.dirname || path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..', '..');
const LINT = path.join(REPO_ROOT, 'scripts', 'lint-kanet.mjs');
const TMP = path.join(os.tmpdir(), `lint-sm-test-${Date.now()}`);

// 创 fixture file with given content + path. 返 absolute path.
function makeFixture(relPath, content) {
  fs.mkdirSync(TMP, { recursive: true });
  const dir = path.join(TMP, path.dirname(relPath));
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(TMP, relPath);
  fs.writeFileSync(fp, content);
  return fp;
}

function runLint(fp) {
  const r = spawnSync('node', [LINT, fp], { encoding: 'utf8', cwd: REPO_ROOT });
  return { exitCode: r.status, out: r.stdout || '', err: r.stderr || '' };
}

describe('SA-3 lint R-NWT-STATE-MACHINE', () => {
  it('1. broker-* file 直 UPDATE retail_dex_orders.state → 报 violation', () => {
    const fp = makeFixture('kasia-console/src/services/broker-foo.js', `
sqlite.prepare(\`
  UPDATE retail_dex_orders
  SET state = 'paid', updated_at = datetime('now')
  WHERE id = ?
\`).run(orderId);
`);
    const r = runLint(fp);
    assert.notEqual(r.exitCode, 0, 'lint should fail');
    assert.match(r.out, /R-NWT-STATE-MACHINE/);
  });

  it('2. escape hatch // lint-allow-state-update → violation 消失', () => {
    const fp = makeFixture('kasia-console/src/services/broker-bar.js', `
// lint-allow-state-update: PZ-STATE-T-BUY phase 2 multi-asset 后置
sqlite.prepare(\`
  UPDATE retail_dex_orders
  SET state = 'paid', updated_at = datetime('now')
  WHERE id = ?
\`).run(orderId);
`);
    const r = runLint(fp);
    assert.equal(r.exitCode, 0, 'lint should pass with escape hatch');
    assert.doesNotMatch(r.out, /R-NWT-STATE-MACHINE/);
  });

  it('3. broker-state-machine.js 自身 (canonical entry) 例外', () => {
    const fp = makeFixture('kasia-console/src/services/broker-state-machine.js', `
sqlite.prepare(\`
  UPDATE retail_dex_orders
  SET state = ?, updated_at = datetime('now')
  WHERE id = ? AND state = ?
\`).run(toState, orderId, expectedFromState);
`);
    const r = runLint(fp);
    assert.equal(r.exitCode, 0, 'broker-state-machine.js 自身 lint pass (canonical entry)');
    assert.doesNotMatch(r.out, /R-NWT-STATE-MACHINE/);
  });

  it('4. 非 broker-* path (services/exchange-machine.js) 也 hit (per spec scope)', () => {
    // exchange-machine.js 在 spec scope (per task v1.2 SA-3 regex)
    const fp = makeFixture('kasia-console/src/services/exchange-machine.js', `
sqlite.prepare(\`UPDATE retail_dex_orders SET state = 'completed', deliver_tx_hash = ? WHERE id = ?\`).run(tx, id);
`);
    const r = runLint(fp);
    assert.notEqual(r.exitCode, 0, 'exchange-machine.js 在 lint scope');
    assert.match(r.out, /R-NWT-STATE-MACHINE/);
  });

  it('5. 非 services/ path (e.g. test/) 不 hit (path filter 严)', () => {
    const fp = makeFixture('kasia-console/test/some-test.js', `
sqlite.prepare(\`UPDATE retail_dex_orders SET state = 'paid' WHERE id = ?\`).run(id);
`);
    const r = runLint(fp);
    assert.equal(r.exitCode, 0, 'test/ path 不 hit lint');
  });

  // cleanup
  it('cleanup', () => {
    fs.rmSync(TMP, { recursive: true, force: true });
    assert.ok(true);
  });
});
