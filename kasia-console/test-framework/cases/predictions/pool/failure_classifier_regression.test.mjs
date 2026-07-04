// Regression guard: #49 daemon 错误处理分类器 (2026-07-04, docs/2026-07-04-daemon-error-handling-
// modular-design.md v2, NWT+Bettor review GREEN).
//
// 三个核心测试用例(设计文档 §6 明确要求):
// ① fail-safe 属性: 完全无法识别的错误类型不会导致状态被意外改写(shouldKeepStatus===true)。
// ② 判定顺序: 畸形 RPC 响应触发的 "Cannot read property" 类错误, 若同时匹配 TRANSIENT_RE,
//    必须被分类成 TRANSIENT 而不是 CODE_BUG(验证顺序 TRANSIENT_RE 优先于 CODE_BUG 生效)。
// ③ BUSINESS_PENDING 只认 UMA(polymarket source), ESPN 的 ABSTAIN 不落进这条路。

import assert from 'node:assert/strict';
import { classifyFailure, shouldKeepStatus } from '../../../../src/lib/bshard-failure-classifier.mjs';

const TRANSIENT_RE = /UTXO not found|fetch failed|ECONNREFUSED|RPC connect timeout|not synced|no working Kaspa RPC|ETIMEDOUT|network.*(timeout|error)|no land\b|not landed/i;

// ── ① fail-safe: 完全无法识别的错误 → UNCLASSIFIED, shouldKeepStatus===true(不改状态) ──
{
  const r = classifyFailure(new Error('some totally novel error nobody anticipated'), { outcome_market_source: 'espn' }, TRANSIENT_RE);
  assert.equal(r.type, 'UNCLASSIFIED', 'unrecognized error must classify as UNCLASSIFIED, not silently pass as something else');
  assert.equal(shouldKeepStatus(r), true, 'UNCLASSIFIED must keep status (fail-safe: default path never touches protocol_status/money)');
}

// ── ② 判定顺序: TRANSIENT_RE 优先于 CODE_BUG 特征(畸形 RPC 响应触发的 Cannot-read-property) ──
{
  // 模拟: RPC 返回不完整对象, 代码访问某字段抛 TypeError, 但错误信息本身也命中 TRANSIENT_RE
  // (比如 "fetch failed: Cannot read property 'x' of undefined")——这类应该分类成 TRANSIENT
  // (基础设施问题), 不是 CODE_BUG(我们代码坏了), 顺序敏感。
  const e = new TypeError("fetch failed: Cannot read property 'x' of undefined");
  const r = classifyFailure(e, { outcome_market_source: 'espn' }, TRANSIENT_RE);
  assert.equal(r.type, 'TRANSIENT', 'TRANSIENT_RE match must win over CODE_BUG instanceof check (order-sensitive per NWT review)');
}

// ── CODE_BUG: 真正的代码 bug(不匹配 TRANSIENT_RE)用 instanceof 判定 ──
{
  const r = classifyFailure(new ReferenceError('market is not defined'), { outcome_market_source: 'polymarket' }, TRANSIENT_RE);
  assert.equal(r.type, 'CODE_BUG', 'genuine ReferenceError not matching TRANSIENT_RE must classify as CODE_BUG');
  assert.equal(shouldKeepStatus(r), true, 'CODE_BUG must keep status (this is exactly the #48 bug pattern — never overwrite a successful settle as failed)');
}

// ── ③ BUSINESS_PENDING 只认 UMA(polymarket), ESPN 的 ABSTAIN 不落这条路 ──
{
  const rUma = classifyFailure(new Error('UMA judge ABSTAIN: ABSTAIN (conditionId 0xabc)'), { outcome_market_source: 'polymarket' }, TRANSIENT_RE);
  assert.equal(rUma.type, 'BUSINESS_PENDING', 'polymarket-sourced UMA ABSTAIN must classify as BUSINESS_PENDING (goes to re-judge scheduler)');

  const rEspn = classifyFailure(new Error('judge ABSTAIN: null'), { outcome_market_source: 'espn' }, TRANSIENT_RE);
  assert.notEqual(rEspn.type, 'BUSINESS_PENDING', 'ESPN-sourced ABSTAIN must NOT classify as BUSINESS_PENDING — no slow-resolution scenario for ESPN, this stays a genuine refund-evaluation candidate (#47 manual runbook), not the UMA re-judge scheduler');
}

// ── TRANSIENT reused constant, not a redefined equivalent (spot check a few real signatures) ──
{
  const r1 = classifyFailure(new Error('UTXO not found at spine address'), {}, TRANSIENT_RE);
  assert.equal(r1.type, 'TRANSIENT');
  const r2 = classifyFailure(new Error('ECONNREFUSED 127.0.0.1:16210'), {}, TRANSIENT_RE);
  assert.equal(r2.type, 'TRANSIENT');
}

console.log('✅ failure_classifier_regression: all cases pass — order-sensitivity + fail-safe + BUSINESS_PENDING scoping locked');
