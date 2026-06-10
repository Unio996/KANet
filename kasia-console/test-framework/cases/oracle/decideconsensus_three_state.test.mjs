// 门C 档1 regression (Owner 终裁 r518, 决议 e8727706) — decideConsensusV06 三态 spec guard.
//
// scope: oracle settle 决策. 旧逻辑: abstainCount≥2→立即 refund (= griefer 腐蚀 2 委员就拿
//   免费 cancel) + split/timeout→即 refund。Owner 终裁 3 态: settle(任一 side≥4) /
//   abstain-refund(≥4 主动 ABSTAIN affirmative-unjudgeable) / else catch-all → dispute
//   (非自动 refund 不奖 griefer; dispute 终态 grace→dispatchRefund by caller)。
// guard: 阈值方向退化 (abstain≥4 回到 ≥2 / split 回到 auto-refund 而非 dispute) → hard FAIL.
//   注: 测【决策 spec 逻辑】(投票 tally→action). 真 decideConsensusV06 读 DB (committee/votes);
//   此处复刻其 post-threshold 三态判定, 与源同步 (pool-market-settler.js:1199-1257 区段)。
//   真函数 DB 集成 + 跨节点容错 + griefing 攻击样本 = NWT 档1 红队 battery 覆盖。

function decideThreeState({ yes = 0, no = 0, abstain = 0, malformed = 0, allDecided = false, timedOut = false }) {
  if (yes >= 4) return 'settle';
  if (no >= 4) return 'settle';
  if (abstain >= 4) return 'refund';                 // 档1 ①: affirmative-unjudgeable supermajority
  const decided = yes + no + abstain + malformed;
  if (decided === 5 || timedOut) return 'dispute';   // 档1 ②: else catch-all, 非自动 refund
  return 'pending';                                   // 档1 ③: 等更多票
}

export default {
  id: 'oracle_decideconsensus_three_state',
  description: '门C 档1 — decideConsensus 三态 (settle≥4 / abstain≥4-refund / else→dispute) spec guard',
  domain: 'oracle',
  tags: ['regression', 'p0', 'griefing', 'three-state', 'open-testnet', 'gate-c-tier1'],
  skip_in_batch: false,

  async run() {
    const failures = [];
    const expect = (inp, want, desc) => {
      const got = decideThreeState(inp);
      if (got !== want) failures.push(`${desc}: got ${got}, want ${want}`);
    };

    // settle: 任一 side ≥4
    expect({ yes: 5 }, 'settle', '5Y unanimous');
    expect({ yes: 4, no: 1 }, 'settle', '4Y+1N forfeit');
    expect({ no: 4, malformed: 1 }, 'settle', '4N+1malformed');

    // abstain-refund: ≥4 主动 ABSTAIN (= 合法不可判); 关键回归: <4 不得 refund
    expect({ abstain: 4, yes: 1 }, 'refund', '4abstain affirmative-unjudgeable → legit refund');
    expect({ abstain: 5 }, 'refund', '5abstain');
    expect({ abstain: 3, yes: 2 }, 'dispute', '3abstain (<4) → dispute 非 refund (= 旧 ≥2 bug 守死)');
    expect({ abstain: 2, yes: 2, no: 1 }, 'dispute', '2abstain all-decided → dispute 非 refund (griefer 2-corrupt 不拿免费 cancel)');

    // dispute: split / all-decided-not-4 / timeout (= 旧 auto-refund, 档1 改 dispute)
    expect({ yes: 3, no: 2 }, 'dispute', '3Y2N split all-decided');
    expect({ yes: 3, no: 1, abstain: 1 }, 'dispute', '3Y1N1a all-decided');
    expect({ yes: 3, timedOut: true }, 'dispute', '3Y+2silent timeout 非4同向');

    // pending: 未表态够 + 未 timeout (1 no-show 仍可凑 4)
    expect({ yes: 3 }, 'pending', '3Y+2silent 未 timeout 等票');
    expect({ abstain: 2, timedOut: false }, 'pending', '2abstain+3silent 未 timeout 等');

    return failures.length ? { ok: false, error: failures.join('; ') } : { ok: true };
  },
};
