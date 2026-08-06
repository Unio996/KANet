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
//
// 【怎么跑 —— 完整命令, 照抄即可(接位者只看本仓就能跑起来, 不必问人)】
//   cd D:/kanet-tn12/kasia-console
//   node scripts/test.mjs --case=test-framework/cases/predictions/pool/p1_bypass_authorization_e2e.test.mjs
//   ⚠ `--case=` 收的是**路径**不是 id —— 传 id 会报 ERR_MODULE_NOT_FOUND(实撞, 2026-08-05)。
//   证据落 logs/test-runs/<时间戳>_p1_bypass_authorization_e2e.log(🟡 覆盖式, 只留最后一次)。
//
// 🔴 **绿了不等于它在守东西 —— 每次改完必须做一次注入对照**(本文件已两次因此改写):
//   最便宜的做法是**翻转 fixture** 而不是改生产代码(生产是钱路, live 进程随时可能重载):
//   把某个"必须拒"的市场种上一个**合法授权**再跑 ⇒ 那一步必须变红。
//   2026-08-05 对 M_C5_COMBO 实跑过: 塞入 `refund_authorization:"bettors_absent"` ⇒ 该步当场 FAIL
//   (回执 `{"ok":true,...}`)⇒ 证明断言读的是真实授权判定, 不是装饰。跑完记得还原。

const M_NO_AUTH   = '__test_p1e2e_noauth__';    // 有历史事件、无授权 ⇒ 必须零 dispatch
const M_AUTHED    = '__test_p1e2e_authed__';    // 有授权 ⇒ 阳性对照, helper 必须放行
                                               // 🔴 它【不插 bettor side】, 因为它的标签是 bettors_absent。
                                               //    理由见下方 seed_side 那段(2026-08-06 修的反转 bug)。
const M_BOGUS     = '__test_p1e2e_bogus__';     // 授权值不在白名单 ⇒ 拒
const M_OLDFIELD  = '__test_p1e2e_oldfield__';  // 只有被占用的旧字段 refund_evidence ⇒ 拒
const M_FROZEN    = '__test_p1e2e_frozen__';    // 冻结态 + 历史事件 ⇒ 拒(重放场景的核心)

const ALL = [M_NO_AUTH, M_AUTHED, M_BOGUS, M_OLDFIELD, M_FROZEN];

// ─── Codex Required #5 的五项阴性 + 一条组合(J2, 2026-08-05; Bettor 16:21 开闸的四条对抗条件)───
//
// Codex `e41c0553` §「Required next evidence」逐字:
//   「Negative tests proving old **status**, old **refund_txid**, **age**, **Owner action**,
//     or **missing metadata** alone cannot generate authorization.」
//   ⇒ 五项【单独】都不得产生授权。上面 A–E 覆盖的是"伪值/撞名字段/重放"那一族,
//     **没有一条**覆盖这五项 —— 而那 125 行真实积压【同时具备】旧 status + 旧 refund_txid + 年龄。
//
// 🔴 为什么这六个市场【故意不建 side 行】(不是省事, 不这样会静默弄坏别人):
//   F 步断言 `"unauthorized":4` —— 那个数来自 cron 扫到的 side。任何新市场只要带 side,
//   这个数就变, F 会红在【与它要守的东西无关】的地方。而 `assertBettorRefundAuthorized`
//   只读 pool_markets(实读 lib/refund-authorization.mjs:80 的 SELECT), 压根不需要 side。
//   ⇒ 加用例时必须先问"我这条会不会改掉别人断言里的那个数"。
const M_C5_STATUS = '__test_p1c5_status__';   // ⓐ 只有旧 protocol_status
const M_C5_TXID   = '__test_p1c5_txid__';     // ⓑ 只有 refund_txid 列有值
const M_C5_AGE    = '__test_p1c5_age__';      // ⓒ 只有"很旧"
const M_C5_OWNER  = '__test_p1c5_owner__';    // ⓓ 只有 Owner 动作痕迹(带 reference/at, 独缺授权值本身)
const M_C5_NOMETA = '__test_p1c5_nometa__';   // ⓔ metadata 整列为 NULL
const M_C5_COMBO  = '__test_p1c5_combo__';    // 组合: ⓐ+ⓑ+ⓒ+ⓓ+ 一起, 仍必须拒
const C5 = [M_C5_STATUS, M_C5_TXID, M_C5_AGE, M_C5_OWNER, M_C5_NOMETA, M_C5_COMBO];

// 这几行要设 refund_txid / created_at / NULL metadata, mkMarket() 给不了 ⇒ 单独写。
const mkC5 = (id, { status = 'cancelled', meta = `'{}'`, refundTxid = 'NULL', deadline = 1780000000,
  createdAt = 'CURRENT_TIMESTAMP' } = {}) =>
  `INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline,
                             protocol_status, protocol_version, metadata, refund_txid, created_at)
   VALUES ('${id}', 'testrelay', 'kaspatest:spine', 'abcd', ${deadline},
           '${status}', 'v0.7', ${meta}, ${refundTxid}, ${createdAt})`;

// ⓓ 的 metadata 是本组里最阴的一个: 它带着 authorizeRefundByOwner 会写的**两个伴随字段**
// (`refund_authorization_reference` / `_at`, 实读 pool-market-settler.js:323-324), 唯独没有
// `refund_authorization` 本身。⇒ 断言"有人动过手"不等于"有授权"。
const OWNER_TRACE = `'{"refund_authorization_reference":"owner-ticket-123",` +
  `"refund_authorization_at":"2026-06-01T00:00:00.000Z",` +
  `"owner_note":"Owner said go ahead in the channel"}'`;

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
    ...C5.map((m, i) => ({ id: `pc_c5_${i}`, action: 'exec_sql', sql: `DELETE FROM pool_markets WHERE id = '${m}'` })),

    // ── setup ──
    { id: 'seed_noauth', action: 'exec_sql', sql: mkMarket(M_NO_AUTH, 'refunded', `'{"refund_reason":"watchdog-b: collecting_sigs silent timeout"}'`) },
    { id: 'seed_authed', action: 'exec_sql', sql: mkMarket(M_AUTHED, 'refunded', `'{"refund_authorization":"bettors_absent"}'`) },
    { id: 'seed_bogus', action: 'exec_sql', sql: mkMarket(M_BOGUS, 'refunded', `'{"refund_authorization":"timeout_is_fine"}'`) },
    { id: 'seed_oldfield', action: 'exec_sql', sql: mkMarket(M_OLDFIELD, 'refunded', `'{"refund_evidence":{"refunded_by":"x","refunds":[]}}'`) },
    { id: 'seed_frozen', action: 'exec_sql', sql: mkMarket(M_FROZEN, 'unresolved_needs_authorization', `'{"unresolved_reason":"quorum unreachable"}'`) },
    // ── Codex#5 六行(故意无 side, 理由见上方常量段) ──
    { id: 'seed_c5_status', action: 'exec_sql', sql: mkC5(M_C5_STATUS, { status: 'refunded' }) },
    { id: 'seed_c5_txid', action: 'exec_sql',
      sql: mkC5(M_C5_TXID, { refundTxid: `'${'ab'.repeat(32)}'` }) },
    { id: 'seed_c5_age', action: 'exec_sql',
      sql: mkC5(M_C5_AGE, { deadline: 1748000000, createdAt: `'2026-06-01T00:00:00.000Z'` }) },
    { id: 'seed_c5_owner', action: 'exec_sql', sql: mkC5(M_C5_OWNER, { meta: OWNER_TRACE }) },
    // ⓔ metadata 整列 NULL —— 与"有 metadata 但没有授权键"是两回事(我 16:02 报备时把两者混为一谈,
    //    Bettor 16:21 抓出。前者若代码走默认分支会静默放行, 而它在日志里与正常拒绝同形)。
    { id: 'seed_c5_nometa', action: 'exec_sql', sql: mkC5(M_C5_NOMETA, { meta: 'NULL' }) },
    { id: 'seed_c5_combo', action: 'exec_sql',
      sql: mkC5(M_C5_COMBO, { status: 'refunded', meta: OWNER_TRACE,
        refundTxid: `'${'cd'.repeat(32)}'`, deadline: 1748000000, createdAt: `'2026-06-01T00:00:00.000Z'` }) },

    // 🔴🔴 M_AUTHED 【故意不插 side】—— 这一行是修一个把阳性对照做成反面的 bug
    //   (NWT 2026-08-06 判为 ②-a 合稿与 ⑤ 形态裁定的前置条件; 缺陷本身记在
    //    docs/2026-08-04-precond2a-merged-magnitude-estimate.md §4.1-bis)
    //
    //   原来这里是 `ALL.map(...)` —— 给【每一个】市场都插了一条 bettor side, 包括 M_AUTHED。
    //   而 M_AUTHED 的授权标签逐字是 `bettors_absent`, 意思就是**这个盘没有下注人**。
    //   ⇒ 那一步于是在断言:「一个【与事实相反】的标签能过闸」—— **这是阳性对照的反面**。
    //   它当时全绿, 而绿的原因恰恰是缺陷: 闸做的是**标签检查不是事实检查**(§4.1-bis),
    //   所以自相矛盾的 fixture 照样放行。
    //
    //   🔨 判据(全队已收): **阳性对照全绿时, 要问的不是「它过了吗」, 是「它证明的是我要的
    //      那件事, 还是它的反面」。** 一个恒拒的实现会让所有阴性臂全绿; 而一个**只看标签**的
    //      实现会让"标签撒谎"的阳性臂也全绿 —— 两种绿看起来完全一样。
    //
    //   ⚠ 本修复【不改变闸的行为】, 只让 fixture 自洽: `bettors_absent` 现在名副其实。
    //      "闸只查标签不查事实"这个真缺陷**仍然存在**, 归「标签不是证据」卡(typed 授权对象),
    //      不是这一行能修的 —— 别把这次 fixture 修复读成那个缺陷被关掉了。
    //   ⚠ F 步的 `"unauthorized":4` 不受影响: 那 4 来自四个【无授权】市场各自的 side,
    //      M_AUTHED 是授权通过的那个, 本来就不在这个计数里。
    ...ALL.filter((m) => m !== M_AUTHED)
      .map((m, i) => ({ id: `seed_side_${i}`, action: 'exec_sql', sql: mkSide(m) })),
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

    // ══ Codex Required #5: 五项【单独】都不得产生授权 + 一条组合 ═══════════════════
    //  全部经 call_module_export 真调生产 helper 本体(Bettor 对抗条件②: 不得 mock 授权逻辑)。
    //  🔴 断言锚到【闸自己的拒绝理由前缀 'P1'】而不是只看 ok:false —— 同 G 步注入实验的教训:
    //     只断言 ok:false 时, 一条与闸无关的 404 也能让它绿。
    //  ✅ 阳性对照不另建: 同文件 B 步(M_AUTHED)走的就是这一个函数、这一条代码路径
    //     (Bettor 对抗条件④), 所以"全拒型实现"会让 B 红。

    // ⓐ 旧 protocol_status='refunded' 单独 ⇒ 拒。**这是那 121 行真实具备的形状之一。**
    { id: 'H_c5_old_status_alone_rejected', action: 'call_module_export',
      module: 'refund-authorization', export: 'assertBettorRefundAuthorized',
      args: [{ marketId: M_C5_STATUS, db: '$db' }],
      expect: { must: { reply_contains: ['"ok":false', 'P1'] } } },

    // ⓑ refund_txid 列有值 单独 ⇒ 拒。「退过一次」不是「现在被授权再退」。
    { id: 'I_c5_old_refund_txid_alone_rejected', action: 'call_module_export',
      module: 'refund-authorization', export: 'assertBettorRefundAuthorized',
      args: [{ marketId: M_C5_TXID, db: '$db' }],
      expect: { must: { reply_contains: ['"ok":false', 'P1'] } } },

    // ⓒ 年龄单独 ⇒ 拒。Codex §4 逐字否掉的正是"因为这行旧就给它盖章"。
    //    (冻结态的设计注释同源: 「时间在这里不产生任何权力」—— pool-market-settler.js:24x)
    { id: 'J_c5_age_alone_rejected', action: 'call_module_export',
      module: 'refund-authorization', export: 'assertBettorRefundAuthorized',
      args: [{ marketId: M_C5_AGE, db: '$db' }],
      expect: { must: { reply_contains: ['"ok":false', 'P1'] } } },

    // ⓓ Owner 动作痕迹单独 ⇒ 拒。metadata 里带着 _reference 与 _at 两个伴随字段,
    //    独缺 refund_authorization 本身 —— 「有人动过手」不等于「有授权」。
    { id: 'K_c5_owner_action_trace_alone_rejected', action: 'call_module_export',
      module: 'refund-authorization', export: 'assertBettorRefundAuthorized',
      args: [{ marketId: M_C5_OWNER, db: '$db' }],
      expect: { must: { reply_contains: ['"ok":false', 'P1'] } } },

    // ⓔ metadata 整列 NULL ⇒ 拒, **且拒绝理由必须打出来(不得静默)**。
    //    Bettor 16:21 硬要求: 关键字段缺失是 default-allow 最可能的藏身处, 而静默放行
    //    在日志里与正常拒绝同形。⇒ 断言里带上理由文本, 不只断 ok:false。
    { id: 'L_c5_missing_metadata_rejected_and_not_silent', action: 'call_module_export',
      module: 'refund-authorization', export: 'assertBettorRefundAuthorized',
      args: [{ marketId: M_C5_NOMETA, db: '$db' }],
      expect: { must: { reply_contains: ['"ok":false', 'P1', 'refund_authorization'] } } },

    // 🔴 组合: 五项凑齐仍必须拒(Bettor 对抗条件③)。
    //    理由不是"更保险", 是**真实数据就是组合形状** —— 导出的那 125 行同时具备 ⓐ+ⓑ+ⓒ。
    //    要防的失效: 单项各自被拒, 而凑齐时落进某条"看起来够完整了"的分支。
    { id: 'M_c5_all_signals_combined_still_rejected', action: 'call_module_export',
      module: 'refund-authorization', export: 'assertBettorRefundAuthorized',
      args: [{ marketId: M_C5_COMBO, db: '$db' }],
      expect: { must: { reply_contains: ['"ok":false', 'P1'] } } },

    // ── teardown ──
    ...C5.map((m, i) => ({ id: `td_c5_${i}`, action: 'exec_sql', sql: `DELETE FROM pool_markets WHERE id = '${m}'` })),
    ...ALL.map((m, i) => ({ id: `td_side_${i}`, action: 'exec_sql', sql: `DELETE FROM pool_bettor_sides WHERE market_id = '${m}'` })),
    ...ALL.map((m, i) => ({ id: `td_evt_${i}`, action: 'exec_sql', sql: `DELETE FROM chain_events WHERE txid = 'evt_${m}'` })),
    ...ALL.map((m, i) => ({ id: `td_mkt_${i}`, action: 'exec_sql', sql: `DELETE FROM pool_markets WHERE id = '${m}'` })),
  ],
};
