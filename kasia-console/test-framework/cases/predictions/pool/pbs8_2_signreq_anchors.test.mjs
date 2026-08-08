// PB-S8-2 §2.2 —— 锚点判定纯函数的阴性用例集 + 变异对照(J2, 2026-08-08)
//
// 设计: docs/2026-08-07-pbs8-2-anchor-extraction-and-callsite-anchor-test-design-v0.1.md(标题 v0.2)§2.2 / §4
// D4 裁定: Bettor 2026-08-08 10:42 — 清 J2 动【机制 + 证据】层, 生产 handler 接线是 Owner 闸。
//
// 🔴 本用例测的是什么, 以及【不是】什么:
//   测: 「这些拒签条件按写的那样生效」——每条能指出它拒的是哪一类构造, 且各有一条阴性用例。
//   不测: 「这些条件是对的」。条件本身的正确性由上游 §11.1-11.3 各自的红队负责, 不在射程。
//   尤其不测: payout 篡改(保持毛额不变、只在胜方间重分配)——三个锚点结构上看不见它,
//            §4 已把该场景移出候选 B, 不在这里假装覆盖。
//
// 🔴 为什么能直接 import 而不需要 allowlist / manifest:
//   `pbs8-2-signreq-anchors.mjs` 既不是 better-sqlite3 也不是 relay-manager ⇒ 不属 M0a 追踪的两个族。
//   而它是纯函数(不读 DB / 不发 RPC / 无副作用)⇒ 直调即可, 不需要驱动任何生产流程。
//   这正是把判定做成纯函数换来的东西: §0 那堵"离线唯一信号连不上 ⇒ 恒真"的墙, 在这条路径上不成立
//   —— 本用例根本不依赖那个信号。
//
// 🔴🔴 §2.2 变异对照【怎么跑】(它是本用例的主判据, 不是附属):
//   1. 先跑一次, 全绿。
//   2. 打开 kasia-console/src/lib/pbs8-2-signreq-anchors.mjs, 把 `MIN_OUTPUT_RATIO_NUM = 90n` 改成 `89n`。
//   3. 再跑: 步骤 `M_mutation_probe_at_ratio_0895` **必须变红**。
//      判据成立的原因: 该用例 outputs/inputs = 895/1000 = 0.895, 卡在 89% 与 90% 之间 ——
//      90n 下必拒(89500 < 90000), 89n 下放行(89500 > 89000)⇒ 边界挪一格, 读数就变。
//   4. 改回 90n, 再跑一次确认恢复全绿。两次读数都留进证据(设计 §2.2 要求)。
//   ⚠ 为什么变异必须靠【改源码再跑】而不是用例里注入: ESM 只读 live binding, 模块内部常量
//      在外部换不掉(与 ⑤ precond5 撞的是同一堵墙)。所以它是一条【有步骤的人工验收】, 不是自动断言
//      —— 这一点如实写出来, 别让读者以为跑一次绿就等于变异对照做过了。
//
// 【怎么跑】
//   cd D:/kanet-tn12/kasia-console
//   node scripts/test.mjs --case=test-framework/cases/predictions/pool/pbs8_2_signreq_anchors.test.mjs

import { evaluateSignReqAnchors, MAX_REASONABLE_OUTPUTS } from '../../../../src/lib/pbs8-2-signreq-anchors.mjs';

const SPINE_TX = 'a'.repeat(64);
const OTHER_TX = 'b'.repeat(64);

const baseMarket = () => ({
  id: '__pbs8_2_case__',
  spine_p2sh: 'kaspatest:spine_for_pbs8_2_case',
  spine_lock_tx: SPINE_TX,
  maker_relay_id: 'relay-local-1',
});
const outs = (n, each) => Array.from({ length: n }, () => ({ value: String(each) }));
const baseInput = (over = {}) => ({
  market: baseMarket(),
  spineIsCommingled: false,
  txObj: {
    inputs: [{ previousOutpoint: { transactionId: SPINE_TX, index: 0 } }],
    outputs: outs(3, 1000),
  },
  inputTotalSompi: 3000n,
  ...over,
});
const withTx = (txPatch) => baseInput({ txObj: { ...baseInput().txObj, ...txPatch } });

// 每条 = { id, input, expectCode }(expectCode = null 表示应放行)
const CASES = [
  // ── MUST-FIX-0: 承重列缺失 ⇒ 弃权(三列各一条) ──
  ...['spine_p2sh', 'spine_lock_tx', 'maker_relay_id'].map((col) => ({
    id: `N_missing_col_${col}`,
    input: baseInput({ market: { ...baseMarket(), [col]: null } }),
    expectCode: 'MISSING_LOAD_BEARING_COLUMN',
  })),
  // ── MUST-FIX-1: commingled / 判不出 ──
  { id: 'N_commingled_spine', input: baseInput({ spineIsCommingled: true }), expectCode: 'COMMINGLED_SPINE' },
  { id: 'N_commingle_undetermined', input: baseInput({ spineIsCommingled: null }), expectCode: 'COMMINGLE_UNDETERMINED' },
  // ── 锚点①: spine outpoint 身份(§4 的 缺输入 / 多输入 / 陈旧 outpoint 三场景) ──
  { id: 'N_anchor1_no_inputs', input: withTx({ inputs: [] }), expectCode: 'SPINE_OUTPOINT_MISMATCH' },
  { id: 'N_anchor1_stale_outpoint', input: withTx({ inputs: [{ previousOutpoint: { transactionId: OTHER_TX, index: 0 } }] }), expectCode: 'SPINE_OUTPOINT_MISMATCH' },
  { id: 'N_anchor1_wrong_index', input: withTx({ inputs: [{ previousOutpoint: { transactionId: SPINE_TX, index: 1 } }] }), expectCode: 'SPINE_OUTPOINT_MISMATCH' },
  // ⚠ "多输入"在本判定里【不是】拒签理由: 锚点① 只核 inputs[0](上游 §6.2 指出这是已知上限)。
  //    所以这条阳性用例的存在是为了【钉住那个已知上限】, 不是为了显得覆盖更广。
  { id: 'P_multi_input_first_matches_is_allowed', input: withTx({ inputs: [
      { previousOutpoint: { transactionId: SPINE_TX, index: 0 } },
      { previousOutpoint: { transactionId: OTHER_TX, index: 7 } },
    ] }), expectCode: null },
  // ── MUST-FIX-2a / 锚点③ / 面值解析 ──
  { id: 'N_outputs_empty', input: withTx({ outputs: [] }), expectCode: 'OUTPUTS_EMPTY' },
  { id: 'N_outputs_above_ceiling', input: baseInput({
      txObj: { inputs: [{ previousOutpoint: { transactionId: SPINE_TX, index: 0 } }], outputs: outs(MAX_REASONABLE_OUTPUTS + 1, 10) },
      inputTotalSompi: BigInt((MAX_REASONABLE_OUTPUTS + 1) * 10),
    }), expectCode: 'OUTPUTS_COUNT_ABOVE_HEURISTIC_CEILING' },
  { id: 'N_output_value_unparseable', input: withTx({ outputs: [{ value: 'not-a-number' }] }), expectCode: 'OUTPUT_VALUE_UNPARSEABLE' },
  // ── 链上面值取不到(§4 场景① RPC 错; §1.1 建模成【值】) ──
  { id: 'N_chain_value_unavailable', input: baseInput({ inputTotalSompi: null }), expectCode: 'CHAIN_VALUE_UNAVAILABLE' },
  // ── 锚点②: 毛额守恒上界 ──
  { id: 'N_gross_conservation_violated', input: baseInput({ inputTotalSompi: 2999n }), expectCode: 'GROSS_CONSERVATION_VIOLATED' },
  // ── MUST-FIX-2b: 90% 下界 + 边界两侧 ──
  //  🔴 变异对照探针: 895/1000 = 0.895, 卡在 89% 与 90% 之间。
  //     常量 90n ⇒ 拒(本用例期望); 改成 89n ⇒ 放行 ⇒ 本条当场变红。
  { id: 'M_mutation_probe_at_ratio_0895', input: baseInput({
      txObj: { inputs: [{ previousOutpoint: { transactionId: SPINE_TX, index: 0 } }], outputs: [{ value: '895' }] },
      inputTotalSompi: 1000n,
    }), expectCode: 'OUTPUT_BELOW_HEURISTIC_FLOOR' },
  //  边界另一侧: 恰好 90% 应放行 —— 钉住"边界就在我们说的那个位置", 防阈值被悄悄挪动。
  { id: 'P_boundary_exactly_90pct_allowed', input: baseInput({
      txObj: { inputs: [{ previousOutpoint: { transactionId: SPINE_TX, index: 0 } }], outputs: [{ value: '900' }] },
      inputTotalSompi: 1000n,
    }), expectCode: null },
  // ── 全清 ⇒ 放行(阳性对照: 证明这些用例的红不是"这个函数拒绝一切") ──
  { id: 'P_all_clean_allowed', input: baseInput(), expectCode: null },
];

const results = CASES.map((c) => {
  let got;
  try { got = evaluateSignReqAnchors(c.input); }
  catch (e) { got = { ok: null, code: `__THREW__:${e.message}`, reason: null }; }
  const gotCode = got.ok ? null : got.code;
  return { id: c.id, expect: c.expectCode, got: gotCode, pass: gotCode === c.expectCode };
});

const failed = results.filter((r) => !r.pass);
const summary = failed.length === 0
  ? `ALL_${results.length}_ANCHOR_CASES_MATCH`
  : `🔴 ${failed.length}/${results.length} 条不符: ` + failed.map((r) => `${r.id}(期望 ${r.expect} 得到 ${r.got})`).join(' · ');

const sqlLit = (s) => String(s).replace(/'/g, "''");

export default {
  id: 'pbs8_2_signreq_anchors',
  title: 'PB-S8-2 锚点判定纯函数: 阴阳性用例集 + 90% 边界变异探针',
  tags: ['predictions', 'pool', 'pbs8-2', 'd012-precond'],
  steps: [
    { id: 'anchor_cases_all_match', action: 'query_db',
      sql: `SELECT '${sqlLit(summary)}' AS state`,
      expect: { must: { row_assert: { state_contains: `ALL_${results.length}_ANCHOR_CASES_MATCH` } } } },
    // 🔴 单独立一条: 变异探针必须【确实拒】, 且拒的是那条下界而不是别的原因。
    //   拆出来的理由是"别的闸替它答题"是在册假绿的第②种 —— 若这条被别的 code 拒中,
    //   汇总那条照样绿, 而变异对照就失去了它的锚。
    //   ⚠ 措辞: `got` 为 null 表示【被放行】, 不是"没有结果"。写成 `got || 'NO_RESULT'` 会把
    //     "放行了"报成"用例没跑到" —— 失败消息描述错失败原因, 是本仓在册那一族。故显式分开。
    { id: 'M_mutation_probe_rejected_by_the_floor_itself', action: 'query_db',
      sql: `SELECT '${sqlLit((() => {
        const r = results.find((x) => x.id === 'M_mutation_probe_at_ratio_0895');
        if (!r) return 'PROBE_CASE_MISSING(用例不在集合里)';
        return r.got === null ? 'ALLOWED_THROUGH(判定放行了 — 若刚改过 90n 边界, 这正是变异对照要看到的红)' : r.got;
      })())}' AS state`,
      expect: { must: { row_assert: { state_contains: 'OUTPUT_BELOW_HEURISTIC_FLOOR' } } } },
  ],
};
