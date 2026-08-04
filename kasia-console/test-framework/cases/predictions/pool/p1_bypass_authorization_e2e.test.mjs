// P1 旁路闭合 e2e regression — **真调生产消费者与授权 helper 本体**(J2, 2026-08-04)
//
// 设计: docs/2026-08-04-p1-cannot-verify-is-not-refund-authorization-design.md
// 验收标准: Codex 第八轮(bridge 2819d2b6, 经 ledger (139)补32)+ NWT 七条
// action 依赖: call_module_export(spec `docs/2026-08-04-call-module-export-action-spec.md`, NWT GREEN)
//
// 🔴 为什么这条用例长这样(不是风格问题, 是被点名要求的):
//   Codex ④ 逐字:「必须调**生产消费者与授权 helper 本体**, **不得复刻 SQL 或做源码文本检查**;
//   共享谓词单一实现、两个 IPC 调用点各自行使 —— **复制谓词会产出两个互相同意而实现已漂移的测试**。」
//   ⇒ 本用例不写一行自己的授权 SQL, 全部经 call_module_export 调生产函数本体。
//   (我 2026-08-04 那条 p1_refund_authorization_gate 用的是"读源码锚谓词", 在本卡的标准下不合格,
//    它守的是另一件事[闸还在不在花钱点上], 与本用例互补, 不重叠。)
//
// 🔴 一句必须记住的定性(Codex 原话):
//   **「历史 bettor_refund_available 行是持久的【审计数据】, 不是持久的【授权】。」**
//   ⇒ 场景 E(重放)就是钉这一句: 修法若只挡"新事件不发", 重启后重扫历史事件照样付。
//
// Offline: exec_sql fixtures + call_module_export(进程内直调) + teardown。不碰链、不碰 relay。

const M_NO_AUTH   = '__test_p1e2e_noauth__';    // 有历史事件、无授权 ⇒ 必须零 dispatch
const M_AUTHED    = '__test_p1e2e_authed__';    // 有授权 ⇒ 阳性对照, helper 必须放行
const M_BOGUS     = '__test_p1e2e_bogus__';     // 授权值不在白名单 ⇒ 拒
const M_OLDFIELD  = '__test_p1e2e_oldfield__';  // 只有被占用的旧字段 refund_evidence ⇒ 拒
const M_FROZEN    = '__test_p1e2e_frozen__';    // 冻结态 + 历史事件 ⇒ 拒(重放场景的核心)

const ALL = [M_NO_AUTH, M_AUTHED, M_BOGUS, M_OLDFIELD, M_FROZEN];

const mkMarket = (id, status, metaJson) =>
  `INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_status, protocol_version, metadata)
   VALUES ('${id}', 'testrelay', 'kaspatest:spine', 'abcd', 1780000000, '${status}', 'v0.7', ${metaJson})`;

// pool_bettor_sides: id 是 INTEGER PK(不显式给); 非空无默认列 = market_id/bettor_pk/direction/stake_amount/side_p2sh
const mkSide = (marketId) =>
  `INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, side_p2sh, side_lock_tx, side_redeem_script_hex, stake_amount)
   VALUES ('${marketId}', 'aa${marketId.length}', 0, 'kaspatest:side', 'tx_${marketId}', 'deadbeef', 100000000)`;

// 🔴 历史 bettor_refund_available 事件 —— 这是"永久授权票"的载体, 场景 E 靠它复现重放
const mkEvent = (marketId) =>
  `INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
   VALUES (lower(hex(randomblob(16))), 'evt_${marketId}', 'bettor_refund_available', NULL, NULL,
           '{"market_id":"${marketId}","bettor_pk":"aa${marketId.length}"}', 'test', CURRENT_TIMESTAMP)`;

export default {
  id: 'p1_bypass_authorization_e2e',
  description: 'P1 旁路: 真调生产消费者(claimAutoDispatcherTick)与授权 helper 本体 — 无授权/伪值/旧字段名/冻结态重放 全零 dispatch, 合法授权放行',
  domain: 'predictions',
  tags: ['regression', 'refund', 'money-path', 'p1-invariant', 'e2e', 'offline'],
  skip_in_batch: false,

  steps: [
    // ── pre-clean(幂等) ──
    ...ALL.map((m, i) => ({ id: `pc_side_${i}`, action: 'exec_sql', sql: `DELETE FROM pool_bettor_sides WHERE market_id = '${m}'` })),
    ...ALL.map((m, i) => ({ id: `pc_evt_${i}`, action: 'exec_sql', sql: `DELETE FROM chain_events WHERE txid = 'evt_${m}'` })),
    ...ALL.map((m, i) => ({ id: `pc_mkt_${i}`, action: 'exec_sql', sql: `DELETE FROM pool_markets WHERE id = '${m}'` })),

    // ── setup ──
    { id: 'seed_noauth', action: 'exec_sql', sql: mkMarket(M_NO_AUTH, 'refunded', `'{"refund_reason":"watchdog-b: collecting_sigs silent timeout"}'`) },
    { id: 'seed_authed', action: 'exec_sql', sql: mkMarket(M_AUTHED, 'refunded', `'{"refund_authorization":"bettors_absent"}'`) },
    { id: 'seed_bogus', action: 'exec_sql', sql: mkMarket(M_BOGUS, 'refunded', `'{"refund_authorization":"timeout_is_fine"}'`) },
    { id: 'seed_oldfield', action: 'exec_sql', sql: mkMarket(M_OLDFIELD, 'refunded', `'{"refund_evidence":{"refunded_by":"x","refunds":[]}}'`) },
    { id: 'seed_frozen', action: 'exec_sql', sql: mkMarket(M_FROZEN, 'unresolved_needs_authorization', `'{"unresolved_reason":"quorum unreachable"}'`) },
    ...ALL.map((m, i) => ({ id: `seed_side_${i}`, action: 'exec_sql', sql: mkSide(m) })),
    ...ALL.map((m, i) => ({ id: `seed_evt_${i}`, action: 'exec_sql', sql: mkEvent(m) })),

    // ══ A. 无授权(有历史事件)⇒ helper 本体必须判否 ══════════════════════════════
    { id: 'A_no_authorization_rejected', action: 'call_module_export',
      module: 'refund-authorization', export: 'assertBettorRefundAuthorized',
      args: [{ marketId: M_NO_AUTH, db: '$db' }],
      expect: { must: { reply_contains: '"ok":false' } } },

    // ══ B. 阳性对照: 合法授权必须放行 ═══════════════════════════════════════════
    //  🔴 没有它, 一个恒拒的实现能让 A/C/D/E 全绿(在册"全拒型装饰")。
    { id: 'B_positive_control_authorized_passes', action: 'call_module_export',
      module: 'refund-authorization', export: 'assertBettorRefundAuthorized',
      args: [{ marketId: M_AUTHED, db: '$db' }],
      expect: { must: { reply_contains: ['"ok":true', 'bettors_absent'] } } },

    // ══ C. 伪授权值 ⇒ 拒(白名单不是"非空即可")═════════════════════════════════
    { id: 'C_bogus_value_rejected', action: 'call_module_export',
      module: 'refund-authorization', export: 'assertBettorRefundAuthorized',
      args: [{ marketId: M_BOGUS, db: '$db' }],
      expect: { must: { reply_contains: '"ok":false' } } },

    // ══ D. 只有被占用的旧字段名 refund_evidence ⇒ 拒 ════════════════════════════
    //  §10.2 那条撞名的阴性: metadata 里"有个看起来像证据的东西"不得让市场过闸。
    { id: 'D_old_field_name_rejected', action: 'call_module_export',
      module: 'refund-authorization', export: 'assertBettorRefundAuthorized',
      args: [{ marketId: M_OLDFIELD, db: '$db' }],
      expect: { must: { reply_contains: '"ok":false' } } },

    // ══ E. 🔴 重放: 冻结态市场 + 历史事件仍在 ⇒ 必须拒 ═════════════════════════
    //  Codex 第七轮增量。理由: 事件是持久的审计数据不是持久的授权 —— 修法若只挡"新事件不发",
    //  重启后重扫历史事件照样付。**这一格最容易漏, 因为它在"改完当下"看起来是绿的。**
    { id: 'E_replay_existing_event_still_rejected', action: 'call_module_export',
      module: 'refund-authorization', export: 'assertBettorRefundAuthorized',
      args: [{ marketId: M_FROZEN, db: '$db' }],
      expect: { must: { reply_contains: '"ok":false' } } },

    // ══ F. 真调【生产消费者本体】—— 整条 cron 跑一遍, 断言零 dispatch ═══════════
    //  🔴 这一步才是 Codex ④ 要的"调生产消费者": 上面 A–E 调的是 helper, 证明判据本身对;
    //     这一步证明**那个判据真的被消费者用上了**(判据对 ≠ 有人在用它 —— 今天数了一整天的形状)。
    //
    //  🔴🔴 **本步第一版断言的是 `"dispatched":0` —— 那是假绿, 实跑抓出来的, 这段留着别再犯**:
    //     2026-08-04 08:27 首跑时 P1 代码正处于 revert 状态(闸根本不在), 而本步**照样通过**:
    //     回执是 `{"processed":5,"dispatched":0,"skippedRemote":5,"errored":0}` ——
    //     五个 side 的 bettor_pk 不对应本机任何 relay, **全部在够到闸之前就被判 skippedRemote**,
    //     于是 dispatched 无论有没有闸都是 0。⇒ **该断言分不开"闸挡住了"与"压根没人能签"。**
    //     判据出处: Bettor 08:20「两侧都读数不够, 还要确认你读的那个数**在机制失效时会变得不一样**」。
    //
    //  ⇒ 改断言 `"unauthorized":N` —— 这个字段**只有闸跑过才存在**(闸放在 per-side 循环最开头,
    //     在 relay 匹配之前, 所以跨节点 side 也会被它数到; 这正是当初把闸前移的理由)。
    //     闸不在 ⇒ 回执里根本没有 unauthorized 字段 ⇒ 本步红在它自己身上。
    //     种的 5 个市场里 4 个无合法授权(noauth/bogus/oldfield/frozen)⇒ 期望 unauthorized:4。
    { id: 'F_production_consumer_gate_actually_ran', action: 'call_module_export',
      module: 'bettor-refund-claim-auto', export: 'claimAutoDispatcherTick',
      expect: { must: { reply_contains: ['"unauthorized":4', '"dispatched":0'] } } },

    // ══ G. 🔴 **另一个** IPC 调用点: buildBettorRefundClaim(settler tick + 无鉴权 HTTP 端点共用)══
    //  NWT 08:36 判决点名的那条 —— 而它抓的是我一个具体的半成品:
    //  **我把 pool-buildBettorRefundClaim 加进了 allowlist(spec v2 §3), 却没有写任何一步去调它。**
    //  ⇒ A–F 六步实际只碰了两个 module(refund-authorization ×5 / bettor-refund-claim-auto ×1),
    //     两个真实 IPC 调用点仍然**只测了 cron 那一个** —— 正是我加 allowlist 时说要防的那个洞
    //     (Codex round 6: 证明了 A 闭合就当成两条都闭合), 我把它在 regression 里又造了一遍。
    //  🔨 **判据: 往 allowlist 加一条 ≠ 覆盖。允许调用的清单和实际调用的步骤是两份东西。**
    //
    //  断言: 对无授权市场, 该函数必须返回拒绝形状(ok:false), 而不是走到 IPC 去构造退款。
    { id: 'G_other_ipc_call_site_also_gated', action: 'call_module_export',
      module: 'pool-buildBettorRefundClaim', export: 'buildBettorRefundClaim',
      args: [M_NO_AUTH, { bettorPk: `aa${M_NO_AUTH.length}` }],
      // 🔴 断言必须锚到【闸自己的拒绝理由】(P1 前缀), 不能只断言 ok:false ——
      //    注入实验实证: 把闸整段删掉, 只断言 ok:false 的版本【照样绿】, 因为它读到的是
      //    另一条 404(no local relay matches bettor_pk), 与闸无关。同 F 步第一版的病。
      expect: { must: { reply_contains: ['"ok":false', 'P1'] } } },

    // ── teardown ──
    ...ALL.map((m, i) => ({ id: `td_side_${i}`, action: 'exec_sql', sql: `DELETE FROM pool_bettor_sides WHERE market_id = '${m}'` })),
    ...ALL.map((m, i) => ({ id: `td_evt_${i}`, action: 'exec_sql', sql: `DELETE FROM chain_events WHERE txid = 'evt_${m}'` })),
    ...ALL.map((m, i) => ({ id: `td_mkt_${i}`, action: 'exec_sql', sql: `DELETE FROM pool_markets WHERE id = '${m}'` })),
  ],
};
