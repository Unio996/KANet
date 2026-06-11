// 门C 档1 题型 gate regression (NWT r22 #2 / r35 推理题维度) — prevet INFERENCE_RE 检测.
//
// scope: prevet 建市预审. 结构化源防御只在【直接字段比较可答】(winner / price 阈值) 时成立;
//   若题需 LLM 从字段【推理】(margin "赢>3 分" / spread / 差值) → 推理步是注入/相关错重入面 →
//   prevet 该 cap 至 warn (不给 pass)。直接字段题不该误杀。
// guard: INFERENCE_RE 必命中推理题型 (margin/spread/by-N/差值), 必【不】命中直接字段题
//   (winner/price阈值)。任一回归 → 推理题混进 pass / 或好单被误杀。与 pool.js prevet INFERENCE_RE 同步.

// 复刻 pool.js prevet 的 INFERENCE_RE (改动必两处同步)。NWT r37 broadening 后版本。
const INFERENCE_RE = /\b(win|won|beat|lead|cover|lose|trail|ahead|up|outscor\w*)\b[^.]{0,25}\bby\b\s+(more than\s+|at least\s+|over\s+|under\s+|greater than\s+)?\d|\bby\s+(more than|at least|over|under|greater than)\s+\d+\s*(point|run|goal|score)|\bmargin\b|\bdifferential\b|point[\s-]*spread|\bspread\b|\bgap\b|\bdifference\b|combined\s+(score|total|points)|(total|score|runs|points|goals)\b[^.]{0,20}\b(exceed|greater than|more than|over|above|below|under)\s*\d|\d+\s*(point|run|goal|score)?s?\s+(more|fewer|less)\s+than|how many .*\b(more|fewer|less)\b/i;

export default {
  id: 'oracle_prevet_inference_type_gate',
  description: '门C 档1 题型 gate — prevet INFERENCE_RE 检推理题 (margin/spread/by-N) 不误杀直接字段题',
  domain: 'oracle',
  tags: ['regression', 'p1', 'griefing', 'prevet', 'inference-gate', 'gate-c-tier1', 'open-testnet'],
  skip_in_batch: false,

  async run() {
    const failures = [];
    const lc = (s) => s.toLowerCase();

    // MUST detect (推理题 — 需从字段计算, 非直接字段比较) → prevet cap warn
    const inference = [
      'Will the Lakers win by more than 5 points',
      'Will Chiefs cover the spread',
      'Will the margin of victory exceed 10',
      'Will Yankees win by at least 3 runs',
      'point spread: will Team A cover',
      'the difference between the two scores will be over 7',
      'Will the combined total score be over 45 points',
      'how many more goals will Team A score than Team B',
      'Braves beat Pirates by over 2 runs',
      // NWT r37 同义词改写规避 (broadening 后必抓)
      'Will Team A be ahead by 4 at the end',
      'Will the score gap be above 5',
      'Will total runs exceed 9',
      'Will Team A outscore Team B by 3',
      'victory differential over 5',
      'Will Team A score 4 more than Team B',
      'Will the score difference be greater than 6',
      'Will Team A be up by 3 at end',
    ];
    for (const q of inference) {
      if (!INFERENCE_RE.test(lc(q))) failures.push(`推理题漏检 (该 cap warn 却没检到): "${q}"`);
    }

    // MUST NOT detect (直接字段题 — winner / price 阈值 = 可结构化直判) → 不误杀
    const direct = [
      'Will the Lakers win',
      'Did the Yankees win the game',
      'Will Bitcoin price be above 50000 USD',
      'Will BTC close below 40000',
      'Who won the Braves vs Pirates game',
      'Will the Chiefs win against the Eagles',
      'Will ETH price exceed 3000 by Friday',
      'Did Atlanta Braves win',
    ];
    for (const q of direct) {
      if (INFERENCE_RE.test(lc(q))) failures.push(`直接字段题误杀 (不该检到推理): "${q}"`);
    }

    return failures.length ? { ok: false, error: failures.join('; ') } : { ok: true };
  },
};
