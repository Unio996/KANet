// D-012 冻结前置⑤ —— 「验证中断 ⇒ 市场不得自动进入退款广播路径」(J2, 2026-08-07)
//
// 设计: docs/2026-08-06-precond5-verification-interrupt-no-autorefund-test-design-v0.1.md(标题 v0.3)
// 预注册原文: docs/2026-08-04-p1-cannot-verify-is-not-refund-authorization-design.md §5(+ v0.5 变更块)
// 七条审: NWT 2026-08-07 PASS(条件已修)· allowlist §10 v3: 848a1146 双审条件批准
//
// 🔴 本用例与预注册原文的【唯一】偏离(§2, 已走显式修订 + 独立审):
//   原文要 mock dispatchRefund 断言【调用次数 = 0】—— **在本仓做不成**(ESM 只读 live binding,
//   settler 内部调的是模块内本地绑定, 外部替换够不到; loader hook 与 allowlist 设计意图正面冲突)。
//   ⇒ 改为驱动**真实** poolSettlerTick + 断言【落库痕迹为零】。**命题一字未动。**
//
// 🔴🔴 三条纪律, 每条都对应一种"零读数"的坏解释, 缺一条那个零就还有一种合法的坏解释没被排除:
//   A0 —— tick 到底跑到判定点了吗?      (防"六臂一起零痕迹是因为根本没跑")
//   I0 —— 读痕迹的那个查询看得见痕迹吗?  (防"零痕迹是因为查询看不见任何东西")
//   路径归属 —— 是【本臂那条路】把它送进冻结态的吗? (三条路通向同一终态, 只断终态分不出来源)
//
// 🔴 本用例【不测】的, 如实写在这里而不是藏在注释深处:
//   · 「20 次累计过程本身」—— N1-a 测门槛之前, N1-b 测跨越那一刻, **中间那 18 次两臂都不测**
//   · 阳性对照只能证「闸放行了」, **证不了「退款真被构造出来」**(要 relay, 离线做不到)
//   · 第三条冻结路径(submit_fail_count ≥ SETTLE_SUBMIT_GIVEUP → :3519)**不属本命题场景族**,
//     本用例不测它, 只用「submit_fail_count 未变」把它的干扰排除掉
//
// 【怎么跑 —— 完整命令, 照抄即可】
//   cd D:/kanet-tn12/kasia-console
//   node scripts/test.mjs --case=test-framework/cases/predictions/pool/precond5_verification_interrupt_no_autorefund.test.mjs
//   ⚠ --case= 收的是【路径】不是 id(传 id 报 ERR_MODULE_NOT_FOUND, 实撞过)
//   证据落 logs/test-runs/<时间戳>_<id>.log(🟡 覆盖式, 只留最后一次)
//
// 🔴 在 runner 扫描面内(文件名 *.test.mjs)—— **而"在扫描面内" ≠ "有人在跑"**:
//   本仓无 CI 无 cron, --domain/--all 只有人手敲才跑。引用覆盖率时这一格必须扣掉。
//   (今天实证: 同目录的 p1_refund_authorization_gate 已红了不知多久, 没有任何东西报告过。)
//
// Offline: exec_sql fixtures + call_module_export(进程内直调真实 tick)+ query_db 读断言 + teardown。
//   全部臂运行在 **RPC 不可用** 这个共享环境前提下(见设计稿 §3-bis: 预注册场景 ③ 降为环境前提)。

const M_N1A  = '__test_p5_n1a__';    // 命题臂: 计数 0→1, 不冻结, 零退款痕迹
const M_N2   = '__test_p5_n2__';     // collecting_sigs 超时 + sigCount<4 ⇒ 一次到位冻结
const M_P1   = '__test_p5_p1__';     // 阳性对照: 0 注 ⇒ bettors_absent 放行
const M_P2   = '__test_p5_p2__';     // 阳性对照: committee_affirmative_unjudgeable
const M_I0   = '__test_p5_i0__';     // 仪器臂: 终态盘, tick 扫不到, 只验痕迹查询本身
const ALL = [M_N1A, M_N2, M_P1, M_P2, M_I0];

// deadline 取过去时刻(秒), 让 tick 的 `deadline <= now` 谓词命中
const PAST = 1700000000;

const mkMarket = (id, status, metaJson, extra = '') =>
  `INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline,
                             protocol_status, protocol_version, metadata${extra ? ', ' + extra.cols : ''})
   VALUES ('${id}', 'testrelay', 'kaspatest:spine_${id}', 'abcd', ${PAST},
           '${status}', 'v0.5', ${metaJson}${extra ? ', ' + extra.vals : ''})`;

// 🔴🔴 痕迹查询 —— **单一实现**。I0 与所有阴性臂共用这一份, 不许各抄一份。
//   理由(Codex 在本仓打过同形): 复制的谓词会产出两个互相同意、而实现已漂移的测试;
//   若 I0 验的是"我为 I0 写的那份查询", 它验的就不是阴性臂真正在用的那把尺子。
const TRACE_SQL = `
  SELECT
    (json_extract(metadata,'$.refund_tx_obj')       IS NOT NULL) AS has_tx_obj,
    (json_extract(metadata,'$.refund_dispatched_at') IS NOT NULL) AS has_dispatched,
    protocol_status                                              AS status,
    COALESCE(json_extract(metadata,'$.sample_fail_count'), 0)    AS sample_fails,
    COALESCE(json_extract(metadata,'$.submit_fail_count'), 0)    AS submit_fails,
    -- 🔴 路径身份: 冻结是【哪条路】送进来的。第一版我漏了它 ——
    --   写了"路径归属断言"却没取承载路径身份的字段, 于是断言只能读到终态、读不到来源。
    --   (同族: 断言要读的东西必须先被查询取出来 —— "守卫读的字段必须在决策那一刻真的在对象上")
    COALESCE(json_extract(metadata,'$.evidence_gap'), '')        AS evidence_gap,
    (SELECT COUNT(*) FROM chain_events ce
      WHERE ce.event_type='bettor_refund_available'
        AND ce.payload LIKE '%"market_id":"' || pm.id || '"%')   AS refund_events,
    -- 🔴 指纹列 —— 断言只匹配【它】, 不匹配 "key":value 形式。
    --   起因(2026-08-07 实撞): reply 是 pretty-print(冒号后【有空格】: 引号 has_tx_obj 引号 冒号 空格 1),
    --   而我断言写的是不带空格的那种 ⇒ **值完全正确, 断言照样红**;更坏的是它前几次是绿的
    --   ⚠ 本注释【不许出现反引号】: 它活在一个模板串里, 一个反引号就把整份用例截断成语法错误。
    --      (在册 feedback-backtick-in-sql-comment-breaks-template-literal —— 我写这段时照样撞了一次。)
    --   (payload 小的时候序列化成紧凑形式), 加一列之后才变红 ⇒ **同一份断言的成败取决于 payload 大小**。
    --   ⇒ 跨冒号的子串断言依赖【序列化格式】, 而格式会变。指纹串不跨冒号, 格式无关。
    'tx' || (json_extract(metadata,'$.refund_tx_obj') IS NOT NULL)
      || '-disp' || (json_extract(metadata,'$.refund_dispatched_at') IS NOT NULL)
      || '-ev' || (SELECT COUNT(*) FROM chain_events ce2
                    WHERE ce2.event_type='bettor_refund_available'
                      AND ce2.payload LIKE '%"market_id":"' || pm.id || '"%')
      || '-samp' || COALESCE(json_extract(metadata,'$.sample_fail_count'), 0)
      || '-sub'  || COALESCE(json_extract(metadata,'$.submit_fail_count'), 0)
      || '-'     || protocol_status
      || '-'     || COALESCE(json_extract(metadata,'$.evidence_gap'), 'none')   AS sig
  FROM pool_markets pm WHERE pm.id = ?`;

// 🔴 断言原语: 只用 `db_row_count`, **不用 reply_contains**。
//   起因(2026-08-07 实撞, trace 逐字): `query_db` 返回的是 { rows, count } —— **它没有 `reply` 字段**,
//   于是 reply_contains 的 `actual:` 那一栏是【空】的 ⇒ 该断言**恒假**, 而值一直是对的。
//   🔴 更该记的一层: 恒假只会让红变多, 所以不会被"绿了没人查"抓到;**而它的反面(恒真)会静默放行一切,
//      两者在写法上没有任何区别**。⇒ **断言原语本身要先证它读得到东西。**
//   ⇒ 改用本 harness 的既有惯用法(同 p1_refund_authorization_gate): 把期望编进 WHERE, 用行数判。
//      指纹对 ⇒ 1 行;指纹不对 ⇒ 0 行。
const SIG_MATCH = `SELECT 1 AS matched FROM (${TRACE_SQL}) t WHERE t.sig = ?`;

const mkEvent = (marketId) =>
  `INSERT INTO chain_events (id, txid, event_type, payload, observed_by, observed_at)
   VALUES (lower(hex(randomblob(16))), 'evt_${marketId}', 'bettor_refund_available',
           '{"market_id":"${marketId}"}', 'test', CURRENT_TIMESTAMP)`;

export default {
  id: 'precond5_verification_interrupt_no_autorefund',
  description: 'D-012 前置⑤: 验证中断 ⇒ 零退款痕迹 · 六臂(N1-a/N2/P1/P2/A0/I0 · N1-b 已按三方裁定摘除) · 驱动真实 poolSettlerTick · 🔴 P1/P2 本轮【故意红】= 阳性对照未建立',
  domain: 'predictions',
  tags: ['regression', 'refund', 'money-path', 'precond5', 'd012', 'offline'],
  skip_in_batch: false,

  steps: [
    // ── pre-clean(幂等) ──
    ...ALL.map((m, i) => ({ id: `pc_evt_${i}`, action: 'exec_sql', sql: `DELETE FROM chain_events WHERE txid = 'evt_${m}'` })),
    ...ALL.map((m, i) => ({ id: `pc_mkt_${i}`, action: 'exec_sql', sql: `DELETE FROM pool_markets WHERE id = '${m}'` })),

    // ── seed ──
    // N1-a: verifying · 无 sample_fail_count ⇒ 本 tick 应把它变成 1, 且【不】冻结
    { id: 'seed_n1a', action: 'exec_sql', sql: mkMarket(M_N1A, 'verifying', `'{}'`) },
    // N2: collecting_sigs + phase2 久远 ⇒ watchdog-b 一次到位(该路无计数器)
    { id: 'seed_n2', action: 'exec_sql',
      sql: mkMarket(M_N2, 'collecting_sigs', `'{"phase2_dispatched_at":"2026-01-01T00:00:00.000Z"}'`) },
    // P1/P2: 阳性对照 —— 期望【不】落冻结态(与四条阴性臂分岔 = A0 的阳性证据)
    { id: 'seed_p1', action: 'exec_sql', sql: mkMarket(M_P1, 'verifying', `'{}'`) },
    { id: 'seed_p2', action: 'exec_sql', sql: mkMarket(M_P2, 'verifying', `'{}'`) },
    // I0: 终态盘(tick 扫不到)+ 亲手种下全套痕迹 ⇒ 验的是【查询】不是【行为】
    { id: 'seed_i0', action: 'exec_sql',
      sql: mkMarket(M_I0, 'refunded', `'{"refund_tx_obj":{"stub":true},"refund_dispatched_at":"2026-01-01T00:00:00.000Z"}'`) },
    { id: 'seed_i0_evt', action: 'exec_sql', sql: mkEvent(M_I0) },

    // ══ I0 · 仪器阳性臂 —— 必须【先】跑: 它不过则下面所有"零痕迹"读数一律不作数 ══════════
    //   四个探针逐个必须命中。任一零命中 ⇒ 仪器坏了, 而不是"真的没有痕迹"。
    { id: 'I0_instrument_positive_control', action: 'query_db', sql: SIG_MATCH,
      params: [M_I0, 'tx1-disp1-ev1-samp0-sub0-refunded-none'],
      expect: { must: { db_row_count: 1 } } },

    // ══ 驱动【真实】结算 tick(allowlist §10 v3 第 4 条 · 约束 A/D/G 由 runner 机器强制)══════
    { id: 'DRIVE_real_settler_tick', action: 'call_module_export',
      module: 'pool-market-settler', export: 'poolSettlerTick',
      expect: { must: { reply_contains: ['"ok":true'] } } },

    // ══ N1-a · 命题臂 —— 这一格才是预注册命题的主体 ════════════════════════════════════
    //   验证中断了, 而系统【既没冻结、也没退款, 只是计数】。
    //   路径归属: sample_fails 0→1 钉住"是委员抽样这条路"; submit_fails 仍 0 排除第三条路。
    //   🔴 2026-08-07 断言校正(与【已验证事实】对齐, 非形态偏离):
    //   第一版我断言 sample_fails 0→1 且 status 仍 verifying —— **错**, 我把"读到的一条机制"
    //   当成了"这个 fixture 会走的那条机制"(F 步归错)。独立探针现读: 一个过 grace 的裸 verifying 盘
    //   走 **QUORUM-TIMEOUT** 分支, **当场冻结、零累计**, 而 sample_fail_count 那条要委员抽样被尝试才递增。
    //   🔵 而这条路【就是预注册场景①】("quorum 永不可达 + 超 grace" —— 超 grace 本就是它定义的一半):
    //      触发条件逐字 = `ageSinceDeadlineSec > VERIFYING_QUORUM_TIMEOUT_SEC(2h)` ⇒ **纯计时器**,
    //      而生产码自己在下一行写着: 「"等够了还没达 quorum" 是【计时器不是证据】; 它连"为什么没达"
    //      都不区分(委员反对/根本没投/本机没收到/RPC 坏了, 在触发式里读数相同)」。
    //      ⇒ 落库的 evidence_gap 逐字是 `quorum_unreached_cause_unknown` —— **生产码自己标了它的歧义**。
    //   ⇒ 命题在这条路上直接可观测: 冻结 reason 逐字「无举证不退款, 等另行授权」+ 零退款痕迹。
    { id: 'N1a_quorum_timeout_freezes_without_refund', action: 'query_db', sql: SIG_MATCH,
      params: [M_N1A, 'tx0-disp0-ev0-samp0-sub0-unresolved_needs_authorization-quorum_unreached_cause_unknown'],
      expect: { must: { db_row_count: 1 } } },

    // ══ N1-b · 门槛臂 —— 第 20 次失败那一刻的行为 + 锁住 MAX_SAMPLE_FAIL 语义 ═══════════
    // 🔴 原 N1-b(预置 sample_fail_count=19 测第 20 次冻结)【已按三方裁定摘除】:
    //   实跑现读证明该 fixture 走的仍是 QUORUM-TIMEOUT(samp 停在 19 未涨、evidence_gap=quorum_unreached),
    //   **从未触达抽样路** ⇒ 它测不到它想测的机制。而 sample_fail_count 经 NWT 裁定属【通用失败退避】、
    //   不进 ⑤ 任何臂 ⇒ 本臂连同其名字一并摘除, 不留一个指代未定归属之物的名字。

    // ══ N2 · collecting_sigs 超时 —— 该路【无计数器, 一次到位】 ═════════════════════════
    //   ✅ 现读证实: 它走的是 watchdog-b(:1408→:1414), evidence_gap 逐字 signatures_incomplete_local_view_only
    //   —— 该串本身就带着 N4 要的那层作用域限定("本机可见"), 所以 A4 由这条指纹一并锁住。
    { id: 'N2_sig_timeout_freezes_without_refund', action: 'query_db', sql: SIG_MATCH,
      params: [M_N2, 'tx0-disp0-ev0-samp0-sub0-unresolved_needs_authorization-signatures_incomplete_local_view_only'],
      expect: { must: { db_row_count: 1 } } },

    // ══ A0 · 前提断言 —— 分岔本身就是阳性证据 ═════════════════════════════════════════
    //   若 tick 根本没跑到判定点, 六臂会【一起】零痕迹, 而那与"全部正确挡住"读数完全相同。
    //   A0 断言"阴性臂里至少有一个真的被冻结逻辑处置过" —— 它不成立时上面那些零一律不作数。
    // ══ A0' · 前提断言【路径分岔版】(2026-08-07 三方裁定采纳)═══════════════════════════
    //   原 A0 比的是「阴性臂冻结 ∧ 阳性臂不冻」—— 而阳性对照本轮造不出(见文件头"本用例不测的"),
    //   **不许用假 fixture 冒充**(M_AUTHED 那个 bug 就是这么来的)。
    //   ⇒ A0' 改比【冻结之间的路径差异】: N1-a 与 N2 都冻结, 但 evidence_gap **必须不同** ——
    //      quorum_unreached_cause_unknown  vs  signatures_incomplete_local_view_only
    //   ⇒ 证明 tick **走了两条不同的判定分支**, 而不是对所有盘做了同一个动作。
    //   🔴 而它【不能替代阳性对照】(@Bettor/@NWT 同判, 逐字记在这里免得被读混):
    //      A0' 问的是"这几臂走没走同一条路";阳性对照问的是"这套装置测不测得出【放行】"。
    //      **一个恒拒型实现会让全部臂绿, 而 A0' 完全拦不住它** —— 因为它比的对象里没有"放行"这一种。
    //      ⇒ 阳性对照在本轮**如实标为缺失**, 不由 A0' 顶替。
    { id: "A0prime_precondition_two_arms_took_different_paths", action: 'query_db',
      sql: `SELECT 1 AS matched
              FROM pool_markets a, pool_markets b
             WHERE a.id = '${M_N1A}' AND b.id = '${M_N2}'
               AND a.protocol_status = 'unresolved_needs_authorization'
               AND b.protocol_status = 'unresolved_needs_authorization'
               AND json_extract(a.metadata,'$.evidence_gap') = 'quorum_unreached_cause_unknown'
               AND json_extract(b.metadata,'$.evidence_gap') = 'signatures_incomplete_local_view_only'`,
      expect: { must: { db_row_count: 1 } } },

    // ══ P1/P2 · 阳性对照 —— 🔴 本轮【故意红】· 红本身就是待办 ══════════════════════════
    //   🔴 红的原因指向这里, 别去查行为缺陷 —— 不是 status 不对, 是【本轮没有建立阳性对照】:
    //      P1/P2 的 fixture 与 N1-a 逐字段相同(都是空 metadata) ⇒ 与阴性臂【同态】,
    //      实测同样落 unresolved_needs_authorization。**此臂预期与阴性臂同态, 这是已知的。**
    //   🔴 而【往 metadata 里种 refund_authorization 造不出阳性对照】—— 已实核, 别再试:
    //      bettors_absent / committee_affirmative_unjudgeable 是 settler 判定时【自行推导】后
    //      作为实参传给 dispatchRefund 的(pool-market-settler.js:1640 / :1783);
    //      metadata.$.refund_authorization(:383 / :493)是 authorizeRefundByOwner(:322)写的
    //      【另一条路】(owner 授权) ⇒ 种进 metadata 的那个值在这条路上【没有接收方】。
    //   ✅ 下一轮出路(卡 P5-POSITIVE-CONTROL-VIA-ZERO-BET-FIXTURE · 未跑过, 不得当结论):
    //      bettors_absent 从【下注数据】推导 ⇒「0 注 + 过 deadline」的 fixture 离线可能造得出来。
    //   🔨 下面两步断言的是【真阳性对照该有的样子】(不落冻结态), 因此今天必然失败。
    //      判据: **它红 = 阳性对照仍未建立; 它变绿 = 有人把这件事做完了。**
    //   🔴🔴 而【step id 不进任何输出】—— 实核: runner.mjs:2436 打的是 `s.action`, 证据日志同样
    //      只打「Step N: query_db」⇒ **靠给步骤起名让红说话, 在本仓不成立。**
    //   🔴 @Bettor 提的「借 reply_contains 的失败信息带原因」这条路【不可用, 已实核】:
    //      `reply_contains`(runner.mjs:1446)读 `step_result.reply`, 而 `query_db` 返回 `{rows,count}`
    //      **没有 reply 字段** ⇒ 它恒假 ⇒ **将来阳性对照建起来了它也照红** ⇒ 毁掉"变绿=做完了"。
    //      (这正是本轮五条红的同一根因, 不能拿它当载体。)
    //   ✅ 可用的写法(只用既有原语): `row_assert` 的 `<field>_contains` 失败信息逐字打印
    //      【期望串 + 实际值】(runner.mjs:1578)⇒ 原因进终端;而 SQL 用 COALESCE 保证恒返 1 行:
    //        · 仍冻结(今天) ⇒ state = 原因全文     ⇒ 不含 magic ⇒ 🔴 红, 且红里就是原因
    //        · 阳性对照建成 ⇒ 子查询空 ⇒ state = magic ⇒ ✅ 绿
    //      🔨 即 Bettor 那条判据的落地: **断言写【完成态】, 不写当前态。**
    { id: 'P1_positive_control_NOT_ESTABLISHED_red_until_zero_bet_fixture', action: 'query_db',
      sql: `SELECT COALESCE((SELECT '🔴 本轮无法建立阳性对照(缺真实 bettors_absent 数据): 此臂 fixture 与阴性臂逐字段相同, 预期同态冻结 ⇒ 这条红【不是行为缺陷】, 别去查 status。往 metadata 种 refund_authorization 无效(settler:1640 自行推导), 出路见卡 P5-POSITIVE-CONTROL-VIA-ZERO-BET-FIXTURE'
                              FROM pool_markets WHERE id = '${M_P1}' AND protocol_status = 'unresolved_needs_authorization'),
                            'POSITIVE_CONTROL_ESTABLISHED') AS state`,
      expect: { must: { row_assert: { state_contains: 'POSITIVE_CONTROL_ESTABLISHED' } } } },
    { id: 'P2_positive_control_NOT_ESTABLISHED_red_until_abstain_supermajority_fixture', action: 'query_db',
      sql: `SELECT COALESCE((SELECT '🔴 本轮无法建立阳性对照(缺真实 committee_affirmative_unjudgeable 数据): 此臂 fixture 与阴性臂逐字段相同, 预期同态冻结 ⇒ 这条红【不是行为缺陷】, 别去查 status。该授权由 settler:1783 从弃权票自行推导, 种 metadata 无效'
                              FROM pool_markets WHERE id = '${M_P2}' AND protocol_status = 'unresolved_needs_authorization'),
                            'POSITIVE_CONTROL_ESTABLISHED') AS state`,
      expect: { must: { row_assert: { state_contains: 'POSITIVE_CONTROL_ESTABLISHED' } } } },

    // ── teardown(幂等) ──
    ...ALL.map((m, i) => ({ id: `td_evt_${i}`, action: 'exec_sql', sql: `DELETE FROM chain_events WHERE txid = 'evt_${m}'` })),
    ...ALL.map((m, i) => ({ id: `td_mkt_${i}`, action: 'exec_sql', sql: `DELETE FROM pool_markets WHERE id = '${m}'` })),
  ],
};
