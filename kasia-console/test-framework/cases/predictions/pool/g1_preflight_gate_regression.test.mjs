// Regression guard: G1 世界杯 pre-flight gate (2026-07-04, docs/2026-07-04-worldcup-G1-market-wording-
// preflight-design.md, NWT v2 GREEN).
//
// Core invariant under test (NWT BLOCKING-2): mirror-source check is LOGICAL EQUIVALENCE across three
// attributes (match identity / resolution source / penalty-shootout classification), NOT literal text
// comparison. Our templates deliberately say "advance/晋级"; the mirror source's wording is usually
// "win/获胜" for the same underlying event — a text-equals check would self-lock every market.

import assert from 'node:assert/strict';
import {
  checkMirrorSourceEquivalence,
  checkDeadlineSufficient,
  checkJudgeTimingConfigured,
  runPreflightGate,
} from '../../../../src/lib/pool-preflight-gate.mjs';

// ── §2.1 mirror-source: different WORDING, same match → must PASS (the whole point of NWT's fix) ──
{
  const r = checkMirrorSourceEquivalence({
    ourMatchId: 'fifa-2026-r16-042', ourTeamA: 'Brazil', ourTeamB: 'Japan', ourKickoffUtc: 1783094400,
    ourResolutionSource: 'official_fifa_result', ourPenaltyCountsAsAdvance: true,
    mirrorMatchId: 'fifa-2026-r16-042', mirrorTeamA: 'Brazil', mirrorTeamB: 'Japan', mirrorKickoffUtc: 1783094400,
    mirrorResolutionSource: 'official_fifa_result', mirrorPenaltyCountsAsAdvance: true,
  });
  assert.equal(r.pass, true, 'same matchId + same resolution source + same penalty classification must pass regardless of wording (our title says advance, mirror says win — never compared as text)');
}

// ── team-pair + kickoff-close match (no matchId available) → must PASS ──
{
  const r = checkMirrorSourceEquivalence({
    ourMatchId: null, ourTeamA: 'Argentina', ourTeamB: 'France', ourKickoffUtc: 1000000,
    ourResolutionSource: 'espn_final', ourPenaltyCountsAsAdvance: 'N/A',
    mirrorMatchId: 'polymarket-xyz', mirrorTeamA: 'france', mirrorTeamB: 'ARGENTINA', mirrorKickoffUtc: 1000500, // case-insensitive, order-insensitive, 500s apart
    mirrorResolutionSource: 'espn_final', mirrorPenaltyCountsAsAdvance: 'N/A',
  });
  assert.equal(r.pass, true, 'team-pair match (case/order-insensitive) + kickoff within 30min tolerance must pass without matchId');
}

// ── mismatched match → must FAIL ──
{
  const r = checkMirrorSourceEquivalence({
    ourMatchId: 'a', ourTeamA: 'Brazil', ourTeamB: 'Japan', ourKickoffUtc: 1000000,
    ourResolutionSource: 'official_fifa_result', ourPenaltyCountsAsAdvance: true,
    mirrorMatchId: 'b', mirrorTeamA: 'Germany', mirrorTeamB: 'Spain', mirrorKickoffUtc: 5000000,
    mirrorResolutionSource: 'official_fifa_result', mirrorPenaltyCountsAsAdvance: true,
  });
  assert.equal(r.pass, false, 'different match entirely must fail');
}

// ── penalty-classification mismatch → must FAIL (this is the safety-critical check that prevents ABSTAIN) ──
{
  const r = checkMirrorSourceEquivalence({
    ourMatchId: 'a', ourTeamA: 'Brazil', ourTeamB: 'Japan', ourKickoffUtc: 1000000,
    ourResolutionSource: 'official_fifa_result', ourPenaltyCountsAsAdvance: true,   // we count penalty-win as advance=YES
    mirrorMatchId: 'a', mirrorTeamA: 'Brazil', mirrorTeamB: 'Japan', mirrorKickoffUtc: 1000000,
    mirrorResolutionSource: 'official_fifa_result', mirrorPenaltyCountsAsAdvance: false, // mirror source does NOT
  });
  assert.equal(r.pass, false, 'penalty-shootout classification disagreement must fail — this is exactly the ABSTAIN-inducing gap the gate exists to catch');
}

// ── win-style markets (final/3rd-place, §1.3): both sides explicitly 'N/A' → must PASS (legitimately not applicable) ──
{
  const r = checkMirrorSourceEquivalence({
    ourMatchId: 'final', ourTeamA: 'A', ourTeamB: 'B', ourKickoffUtc: 1000000,
    ourResolutionSource: 'official_fifa_result', ourPenaltyCountsAsAdvance: 'N/A',
    mirrorMatchId: 'final', mirrorTeamA: 'A', mirrorTeamB: 'B', mirrorKickoffUtc: 1000000,
    mirrorResolutionSource: 'official_fifa_result', mirrorPenaltyCountsAsAdvance: 'N/A',
  });
  assert.equal(r.pass, true, "§1.3 win-style markets (final/3rd-place) — both sides explicitly 'N/A' must pass (legitimately not applicable, not a mismatch)");
}

// ── NWT 审 ab84985a 抓的洞: null/undefined (未提供) 必须 fail-closed, 不能被静默当"不适用"放行 ──
{
  const r = checkMirrorSourceEquivalence({
    ourMatchId: 'a', ourTeamA: 'X', ourTeamB: 'Y', ourKickoffUtc: 1000000,
    ourResolutionSource: 's', ourPenaltyCountsAsAdvance: null,   // 镜像源 criteria 解析失败, caller 没能确定值
    mirrorMatchId: 'a', mirrorTeamA: 'X', mirrorTeamB: 'Y', mirrorKickoffUtc: 1000000,
    mirrorResolutionSource: 's', mirrorPenaltyCountsAsAdvance: null,
  });
  assert.equal(r.pass, false, "未提供(null) != 不适用('N/A') — 两边都是 null 必须 fail(查不到不能默认放行), 这正是 NWT 抓的洞: 若镜像源解析失败返回 null, 旧实现会静默通过, 恰好放过设计唯一要防的东西");
}
{
  const r = checkMirrorSourceEquivalence({
    ourMatchId: 'a', ourTeamA: 'X', ourTeamB: 'Y', ourKickoffUtc: 1000000,
    ourResolutionSource: 's', ourPenaltyCountsAsAdvance: 'N/A',
    mirrorMatchId: 'a', mirrorTeamA: 'X', mirrorTeamB: 'Y', mirrorKickoffUtc: 1000000,
    mirrorResolutionSource: 's', mirrorPenaltyCountsAsAdvance: true,   // 一边说不适用一边说适用
  });
  assert.equal(r.pass, false, "一边判'N/A'(类型不适用) 一边判 true/false(类型适用) = 盘类型认定本身分歧, 必须 fail, 不能有一边说了算");
}

// ── §2 item 2: deadline sufficiency ──
{
  const kickoff = 1000000;
  assert.equal(checkDeadlineSufficient({ deadlineUnixSec: kickoff + 4 * 3600, kickoffUtcUnixSec: kickoff }).pass, true, 'exactly 4h buffer passes (boundary inclusive)');
  assert.equal(checkDeadlineSufficient({ deadlineUnixSec: kickoff + 3 * 3600, kickoffUtcUnixSec: kickoff }).pass, false, '3h buffer must fail (need >=4h)');
  assert.equal(checkDeadlineSufficient({ deadlineUnixSec: NaN, kickoffUtcUnixSec: kickoff }).pass, false, 'non-numeric deadline must fail closed, not throw');
}

// ── §2 item 3: judge timing must be explicitly configured (no silent default-to-0) ──
{
  assert.equal(checkJudgeTimingConfigured({ judgeDelayMinutes: 30 }).pass, true);
  assert.equal(checkJudgeTimingConfigured({ judgeDelayMinutes: undefined }).pass, false, 'unset judge delay must fail closed (no silent 0-default)');
  assert.equal(checkJudgeTimingConfigured({ judgeDelayMinutes: -5 }).pass, false, 'negative delay is invalid');
}

// ── runPreflightGate: all three must be green for overall pass; any one red fails the whole gate ──
{
  const goodMirror = { ourMatchId: 'a', ourTeamA: 'X', ourTeamB: 'Y', ourKickoffUtc: 1000000, ourResolutionSource: 's', ourPenaltyCountsAsAdvance: 'N/A', mirrorMatchId: 'a', mirrorTeamA: 'X', mirrorTeamB: 'Y', mirrorKickoffUtc: 1000000, mirrorResolutionSource: 's', mirrorPenaltyCountsAsAdvance: 'N/A' };
  const goodDeadline = { deadlineUnixSec: 1000000 + 4 * 3600, kickoffUtcUnixSec: 1000000 };
  const goodJudge = { judgeDelayMinutes: 15 };
  const allGreen = runPreflightGate({ mirrorCheck: goodMirror, deadlineCheck: goodDeadline, judgeTimingCheck: goodJudge });
  assert.equal(allGreen.pass, true, 'all three green → overall pass');

  const badJudge = { judgeDelayMinutes: undefined };
  const oneRed = runPreflightGate({ mirrorCheck: goodMirror, deadlineCheck: goodDeadline, judgeTimingCheck: badJudge });
  assert.equal(oneRed.pass, false, 'one red (judge timing unconfigured) must fail the whole gate even if the other two are green');
  assert.equal(oneRed.checks.mirrorSource.pass, true);
  assert.equal(oneRed.checks.deadline.pass, true);
  assert.equal(oneRed.checks.judgeTiming.pass, false);
}

console.log('✅ g1_preflight_gate_regression: all cases pass — logic-equivalence (not text-equals) confirmed, deadline/judge-timing boundaries locked');
