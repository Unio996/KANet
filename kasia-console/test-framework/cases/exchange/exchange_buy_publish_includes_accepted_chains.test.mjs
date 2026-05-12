/**
 * Regression test — broker-v3 BUY publish body must include accepted_chains
 *
 * Bug 1 (5/12 sediment §3.1): broker-v3/router.js:131-141 BUY publish body verification_meta
 * 缺 `accepted_chains`. publish 上链成功但 /api/exchange/accept 永 reject "Chain X not accepted by maker".
 * SELL 分支 (L142-151) 正确含 accepted_chains.
 *
 * Guard: 静态 source assertion — BUY 分支必含 `accepted_chains` 字面 (同 SELL 分支).
 * 失败说明 bug 仍存在 OR 被 reintroduce.
 *
 * 注: 本 case 是 source-pattern 静态 guard (node --test), framework runner (scripts/test.mjs)
 * 因无 default export 而 SKIP. 跑法: node --test cases/exchange/*.test.mjs
 *
 * NWT spec ea519032a §2.1, J2 ship P0.1 sub-task #1/3.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTER_JS = readFileSync(join(__dirname, '../../../src/services/broker-v3/router.js'), 'utf-8');

// 提取 _doPublish 函数 body — 找下一个 export/async 函数为 delimiter
function extractDoPublishBody() {
  const m = ROUTER_JS.match(/async\s+function\s+_doPublish[\s\S]*?(?=async\s+function\s+_|\nasync\s+function\s+_)/);
  return m ? m[0] : null;
}

test('_doPublish exists in broker-v3/router.js', () => {
  assert.match(ROUTER_JS, /async\s+function\s+_doPublish\b/, '_doPublish function not found');
});

test('_doPublish BUY branch verification_meta MUST include accepted_chains (regression guard)', () => {
  const body = extractDoPublishBody();
  assert.ok(body, '_doPublish function body not extractable');
  // BUY 分支应该跟 SELL 分支一样含 accepted_chains.
  // 静态 heuristic: BUY ternary 分支应在 isBuy/buy_kas 上下文中含 'accepted_chains'.
  // 严守: BUY 跟 SELL 都必含 accepted_chains 字面 (出现 2 次 OR 1 次但在 BUY 分支后被 SELL 共享逻辑)
  const acceptedChainsMatches = (body.match(/accepted_chains/g) || []).length;
  assert.ok(
    acceptedChainsMatches >= 2,
    `_doPublish must include 'accepted_chains' in BOTH BUY and SELL branches (found ${acceptedChainsMatches} occurrence(s); bug: BUY branch missing per 5/12 sediment §3.1)`,
  );
});

test('SELL branch already includes accepted_chains (baseline sanity)', () => {
  const body = extractDoPublishBody();
  // SELL 分支位置: ternary false-side, 含 'sell_kas' 跟 'accepted_chains' 共存
  // 用 less brittle 检查: 全 body 至少 1 处 'accepted_chains' (SELL 已有, 不该退化)
  assert.match(body, /accepted_chains[\s\S]{0,200}sell_kas|sell_kas[\s\S]{0,300}accepted_chains/, 'SELL branch lost accepted_chains (regression in working code)');
});
