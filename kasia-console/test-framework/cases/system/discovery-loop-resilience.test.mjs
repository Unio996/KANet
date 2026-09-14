/**
 * scripts/test.mjs discovery-loop resilience — permanent regression (Bettor 1270 派工).
 *
 * 根因(主线测试基线 RED 清单 3f85d543 §1-A, 2026-09-14): case-discovery 循环
 * (`for (const file of files) { await import(...) }`) 之前没有 try/catch —— 任何一个
 * 文件在 import 期同步 throw(无论是意外 bug, 还是像 p1_refund_authorization_gate.test.mjs
 * 那样"生产结构变了故意拒绝放行"的自我保护设计), 都会冒穿到 main().catch() 把整个进程
 * exit(2), 该文件字母序之后的所有文件(含已成功 import 但还没轮到执行的那些)永远不会
 * 被跑到——predictions 域 63 个真实 case-object 因此可能从建库以来从未真正执行过一次。
 *
 * 本用例不碰真实 test-framework/cases/: 用 KANET_TEST_CASES_DIR 把 discovery 指向一个临时
 * fixture 目录(a_ok / b_throws / c_ok 三个文件, 字母序保证 b 在 a、c 之间 throw), 子进程
 * 跑 `node scripts/test.mjs --all`, 断言 (1) a_ok 与 c_ok(在 throw 之后)都执行了,
 * (2) b_throws 被点名报出错误文本, (3) 退出码非 0(不能让"批里有文件连 import 都进不去"
 * 看起来跟"全部干净跑完"一个退出码), (4) 也不是旧行为的 exit(2)(那条路径吞掉了 a_ok/c_ok)。
 *
 * 跑: node --test kasia-console/test-framework/cases/system/discovery-loop-resilience.test.mjs
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('discovery loop: a file that throws at import time does not block execution of files after it', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kanetui-discovery-fixture-'));
  try {
    writeFileSync(
      path.join(dir, 'a_ok.test.mjs'),
      `export default { id: 'a_ok', domain: 'x', steps: [{ action: 'sleep', ms: 1 }] };\n`,
    );
    writeFileSync(
      path.join(dir, 'b_throws.test.mjs'),
      `throw new Error('deliberate fixture crash for discovery-resilience test');\n`,
    );
    writeFileSync(
      path.join(dir, 'c_ok.test.mjs'),
      `export default { id: 'c_ok', domain: 'x', steps: [{ action: 'sleep', ms: 1 }] };\n`,
    );

    const kasiaConsoleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const testMjs = path.join(kasiaConsoleRoot, 'scripts', 'test.mjs');
    const r = spawnSync(process.execPath, [testMjs, '--all', '--quiet'], {
      cwd: kasiaConsoleRoot,
      encoding: 'utf8',
      timeout: 30000,
      env: {
        ...process.env,
        KANET_TEST_CASES_DIR: dir,
        // 显式设(非派生), 避免真实端口是否被人占用带来的 flakiness — 见 rule 82②
        // checkConsoleUrlListening: 派生+监听中才会 exit(1), 显式只警告不拦截。
        KANET_CONSOLE_URL: 'http://127.0.0.1:1',
      },
    });
    const out = (r.stdout || '') + (r.stderr || '');

    assert.ok(out.includes('a_ok'), `expected a_ok to have run, got:\n${out}`);
    assert.ok(out.includes('c_ok'), `expected c_ok (positioned after the throwing file) to have run, got:\n${out}`);
    assert.ok(
      out.includes('IMPORT FAILED') && out.includes('b_throws'),
      `expected the throwing file to be reported by name with its error text, got:\n${out}`,
    );
    assert.notEqual(r.status, 0, 'a batch with an import failure must not exit 0 — that is a silent false-success signal');
    assert.notEqual(
      r.status,
      2,
      'must not fall through to the generic Runner-error exit(2) path — that path is what used to swallow everything after the crash',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
