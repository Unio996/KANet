// ⚠ 这不是用例, 是【故意坏掉的 fixture】—— 给 step_ok_false_hard_red_regression.mjs 当被测材料。
//
// 🔴 文件名刻意【不是】 *.test.mjs + 【`_` 前缀】: runner 的 --all/--domain 只收 *.test.mjs
//    ⇒ 它永远不会进批量跑(否则它会把套件永久染红, 因为它【就该红】)。
//    只能被 `--case=<本文件路径>` 显式点名 —— 那正是 regression 要做的事。
//    🔵 `_` 前缀(2026-08-28 NWT · 案 A 第三守卫): 本文件【有 export default】, 若将来 glob 放宽到
//       cases/**/*.mjs, "只收 export default" 守卫挡不住它(它 export 了) ⇒ 会被当 case 跑而永久染红。
//       `_` 前缀让"跳 _ 前缀"守卫结构性排除它。消费者 step_ok_false_hard_red_regression 用 --case 显式点名, 不受影响。
//
// 它测的洞: 一个 handler 返回 {ok:false} 的步骤, 若【不带 expect】, 从前会显示 ✓ 且用例判 PASS。
//           翻硬红之后它必须让用例 FAIL。
export default {
  id: 'fixture_step_ok_false_no_expect',
  domain: 'predictions',
  title: 'fixture(故意坏): 一个失败且无断言的 exec_sql 步骤',
  steps: [
    // 表不存在 ⇒ exec_sql 返回 {ok:false, error}。本步【刻意不带 expect】。
    { id: 'broken_seed_no_expect', action: 'exec_sql',
      sql: 'INSERT INTO __no_such_table_for_regression__ (a) VALUES (1)' },
    // 一条必然通过的断言: 用来证明"用例判红"不是因为整个跑不起来, 而是因为上面那一步。
    { id: 'sanity_must_pass', action: 'query_db',
      sql: 'SELECT 1 AS one', expect: { must: { rows_min: 1 } } },
  ],
};
