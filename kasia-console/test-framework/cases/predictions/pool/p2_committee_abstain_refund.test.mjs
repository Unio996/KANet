// ⑤ P2 臂 —— 委员 abstain≥4 ⇒ 合法 refund(`committee_affirmative_unjudgeable`)
// (J2, 2026-08-09 · 设计稿 v0.2 经 @NWT 15:17 GREEN · allowlist 第 5 条经 spec §11 v4 同日 GREEN)
//
// 它测什么: `decideConsensus(market)` 在【5 名委员中 4 名 ABSTAIN】时, 必须返回
//   `{action:'refund', authorization:'committee_affirmative_unjudgeable'}` —— 即
//   "委员肯定地表示判不了" 是一个**合法的退款授权**, 而不是超时兜底。
//
// 🔴 它【不是】(d) 那条用例的同族, 请不要按 (d) 的形状读它:
//   (d)(p5_positive_via_fake_relay_sink)走的是 **0-bet 捷径**
//   (pool-market-settler.js:800-816: betCount===0 ⇒ 直接 dispatchRefund bettors_absent)。
//   P2 要测的判定在那条捷径【之后】, 中间隔着六道闸。**本卡的前身正是因为照抄 (d) 的判据形状
//   而被打回**(预登记的判据假设了 (d) 的闸链, 而 P2 根本不走那条路)。
//
// 📋 真实闸链(顺序即主循环顺序)· 逐道标【怎么知道的】—— 这份清单是**踩出来的, 不是设计出来的**:
//   ① protocol_status='verifying' ∧ pv∈{v0.6,v0.7}   实跑(活库选盘查询)
//   ② maker_relay_id 非 'cross-node:' 前缀            实跑(93 个候选盘全 false)
//   ③ betCount==0 ⇒ 0-bet 捷径                       🔴 **双份**, 见下
//   ④ MIN_POT 预检(<100 KAS ⇒ cancel)                读码 :694
//   ⑤ 缺 pool_snapshots ⇒ continue                    读码 :888
//   ⑥ 委员抽样                                        🔴 实跑到不了 ⇒ 本卡【注入】
//   ⑦ oracle_relay_ids 必须恰好 5                     🔴 **只有实跑才发现的一道**(:1619-1621)
//   ⑧ committee_pks 必须恰好 5                        实跑踩到(:1634)
//   ⑨ 逐委员查票 → abstain≥4                          实跑踩到 = **本卡的被测对象**(:1757)
//
// 🔴 ③ 是【双份的】—— 这一条是本卡实跑纠正的, 我先前给出的闸链清单里是错的:
//   `:800-816` 那道在主循环里, 而 `decideConsensusV06:1613-1616` **函数内部还有一份同样的检查**。
//   ⇒ **直接调 `decideConsensus` 绕不过它。** 本卡因此必须种注单(见 seedBet)。
//   ⚠ 它返回的是 `{action:'refund', authorization:'bettors_absent'}` —— **一个看起来完全合法的裁决**,
//     不是报错。初版本卡三臂同答这个值, 而 C 臂(否定式)照样绿。
//
// 🔴 ⑥ 为什么只能注入(必须写死, 不许被读成端到端):
//   活库 93 个 `verifying` 的 v0.6/v0.7 市场**零 `pool_committee` 行**;
//   而 255 个有委员的市场**无一在 `verifying`**(2026-08-09 实测, 两集合互斥)。
//   ⇒ **真实数据里不存在"已抽委员且仍在 verifying"的市场** ⇒ ⑥⑦⑧ 必然是注入态,
//     ⑨ 是在一个真实数据到不了的前置上测的。**本卡不证明 93 盘走得通这条路。**
//
// 🔴 注入必须【注满】—— 这一条是踩出来的:
//   抽样那一步(:1023-1024)**同时写两处**: `pool_committee` **与** `pool_markets.oracle_relay_ids`。
//   初版 fixture 只种了前者 ⇒ 停在 ⑦ 并返回 `action:'pending'` ——
//   **而那个返回看起来像被测逻辑给出的结论。** ⇒ 注入前置时必须注入那一步写的【全部】字段。
//
// 🔴 本卡【不测】的, 如实写在这里:
//   · **不测 ①~⑤**: 本卡直接调 ⑨ 所在的函数, 没有跑主循环。前五道闸的行为**不在本卡射程内**。
//   · **不测委员抽样本身对不对**(VRF/种子/选人)—— 委员是注入的常量。
//   · 🔴 **不测 voter_pubkey 归一化那条已知缺陷** —— 它是**另立的 MUST-FIX**(NWT/Bettor 2026-08-09 CONFIRMED)。
//     **刻意不写成断言**: 断言那个当前边缘行为 = 把 bug 锁进测试, 将来修它反而变红。
//     ⇒ 本卡只用【与 `committee_pks` 同形】的票据; **缺陷机制不在此文件披露**(避免把一个未修问题写进会推上公开 origin 的文件, 见仓外登记), 另案跟踪。
//
// 🔵 一个结构性性质(它使本仓 2026-08-06 那类假绿在本卡上不成立):
//   本卡断言的是 `decideConsensus` 的**返回值**(代码构造的对象), **不是 DB 字段**
//   ⇒ **fixture 无法把结论种进去**。而 (d) 那条当时正是栽在"fixture 自己把结论种进去"。
//
// 跑法:
//   set DB_PATH / KANET_DB_PATH 指向 test-framework/data 下的库; set KASPA_RPC_URL=ws://127.0.0.1:9
//   🔴 且必须 set KASPA_NETWORK=testnet-12 —— 否则 import 期就 throw(spec §11.3-C:
//      传递依赖 rpc-health.js:22 顶层 `if (!LOCAL_NETWORK) throw`)。
//   node scripts/test.mjs --case=test-framework/cases/predictions/pool/p2_committee_abstain_refund.test.mjs

const M = '__test_p2_committee_abstain__';

// 5 名委员的 pk —— 常量(与 committee_pks 同形, 见上方"不测归一化"那条)。
const PK = [
  '02aa' + 'ab'.repeat(31),
  '02bb' + 'cd'.repeat(31),
  '02cc' + 'ef'.repeat(31),
  '02dd' + '01'.repeat(31),
  '02ee' + '23'.repeat(31),
];
const RELAYS = JSON.stringify(PK.map((_, i) => 'p2-relay-' + i));

// 一张票 = chain_events 一行。outcome 三态: YES / NO / ABSTAIN。
const vote = (i, outcome) => `INSERT INTO chain_events (id, txid, event_type, payload, observed_by, observed_at)
  VALUES ('p2ev${i}', 'p2vote:${i}', 'pool_oracle_vote',
    '{"market_id":"${M}","voter_pubkey":"${PK[i]}","outcome":"${outcome}"}',
    'p2-fixture', '2026-08-09 0${i}:00:00')`;

const seedCommittee = `INSERT INTO pool_committee
  (market_id, committee_relay_ids, committee_pks, committee_pk_hash, vrf_seed, vrf_proof, threshold)
  VALUES ('${M}', '${RELAYS}', '${JSON.stringify(PK)}', '${'de'.repeat(32)}', '${'aa'.repeat(32)}', '${'bb'.repeat(32)}', 4)`;

// decideConsensus 收【传入的】market 对象(它不自己查库取 market —— 见 spec §11.2)。
// ⇒ market 是本卡的**输入**, 不是被断言物; 它种不了结论(结论是返回值里代码构造的字符串)。
const market = { id: M, protocol_version: 'v0.7', oracle_relay_ids: RELAYS, metadata: '{}' };

// 🔴 一条注单 —— 这不是装饰, 它是**被测函数内部的一道闸**:
//   `decideConsensusV06:1613-1616` 自己也查 `pool_bettor_sides`, betCount==0 ⇒ 立刻返回
//   `{action:'refund', authorization:'bettors_absent'}`, **根本走不到委员逻辑**。
//   ⚠ 主循环 :800-816 那道 0-bet 捷径**只是它的孪生**: 直接调 decideConsensus **绕不过**函数内这一份。
//   (初版本卡漏了它 ⇒ 三臂全返回 bettors_absent, 而那是个**看起来完全合法的裁决**, 不是报错。)
// 🔵 列型是【查出来的, 不是猜的】: `id` 是 INTEGER PK(所以不给, 让它自增)、
//    `direction` 也是 INTEGER(活库实测取值只有 0 / 1, 各约 1.8 万行), 不是 'YES'/'NO' 字符串。
//    ⚠ 初版本卡两处都写成了字符串 ⇒ INSERT 抛 `datatype mismatch` ——
//      而那一步在 runner 输出里**照样打 ✓**(见文件头"seeding 静默失败"那条)。
// 🔴 一行 pool_markets —— 它存在【只是为了满足外键】, 不是被读的东西:
//   `pool_bettor_sides.market_id` 是 `REFERENCES pool_markets(id)`, 缺行 ⇒ INSERT 抛
//   `FOREIGN KEY constraint failed`。而 `decideConsensus` **不读这张表**(market 由 args 传入)。
//   ⇒ 本行的字段值**不参与判定**, 只是过 NOT NULL(maker_relay_id / spine_p2sh /
//     market_metadata_hash / deadline —— 列清单是 PRAGMA 查出来的, 不是猜的)。
const seedMarketRow = `INSERT INTO pool_markets (id, maker_relay_id, spine_p2sh, market_metadata_hash, deadline, protocol_version, protocol_status)
  VALUES ('${M}', 'p2-fixture-maker', 'kaspatest:qp2fixturespine000000000000000000000000000000000', '${'cd'.repeat(32)}', 1700000000, 'v0.7', 'verifying')`;

const seedBet = `INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, stake_amount, side_p2sh)
  VALUES ('${M}', '${'02ff' + '11'.repeat(31)}', 1, 5000000000, 'kaspatest:qp2fixtureside0000000000000000000000000000000000')`;

const clean = [
  { id: 'clean_votes', action: 'exec_sql', sql: `DELETE FROM chain_events WHERE json_valid(payload) AND json_extract(payload,'$.market_id') = '${M}'` },
  { id: 'clean_committee', action: 'exec_sql', sql: `DELETE FROM pool_committee WHERE market_id = '${M}'` },
  { id: 'clean_bets', action: 'exec_sql', sql: `DELETE FROM pool_bettor_sides WHERE market_id = '${M}'` },
  // 市场行最后删(注单有外键指向它)。
  { id: 'clean_market_row', action: 'exec_sql', sql: `DELETE FROM pool_markets WHERE id = '${M}'` },
];

export default {
  id: 'p2_committee_abstain_refund',
  domain: 'predictions',
  title: '⑤P2: 委员 abstain≥4 ⇒ committee_affirmative_unjudgeable 退款授权',
  steps: [
    ...clean.map((s) => ({ ...s, id: 'pre_' + s.id })),

    // ── 注入 ⑥ 的产物: 抽样【同时写的两处】。oracle_relay_ids 走 market 对象那一路(见上)。
    // 外键前置(见 seedMarketRow 上方): 没有它, 下面那条注单会抛 FOREIGN KEY 而【静默】失败。
    { id: 'seed_market_row', action: 'exec_sql', sql: seedMarketRow },
    { id: 'seed_committee', action: 'exec_sql', sql: seedCommittee },
    // 越过被测函数【内部】那道 0-bet 捷径(见 seedBet 上方注释)。
    { id: 'seed_one_bet', action: 'exec_sql', sql: seedBet },

    // 🔴 fixture 自证 —— 这两步不是形式:
    //   `exec_sql` 失败时返回 `{ok:false}`, **而 runner 不检查 stepResult.ok**(:2296-2312 之后
    //   直接进断言), 所以一个**没有断言的种数据步骤即使 INSERT 抛错也照样显示 ✓**。
    //   ⇒ 种完必须查一眼。本卡初版正是栽在这里: 两处列型写错 ⇒ INSERT 全抛 ⇒ 步骤全 ✓ ⇒
    //     三臂返回 `bettors_absent`(一个**看起来完全合法的裁决**), 而我先去怀疑 DB 绑定了。
    { id: 'verify_committee_seeded', action: 'query_db',
      sql: `SELECT market_id FROM pool_committee WHERE market_id = ?`, params: [M],
      expect: { must: { rows_min: 1 } } },
    { id: 'verify_bet_seeded', action: 'query_db',
      sql: `SELECT id FROM pool_bettor_sides WHERE market_id = ?`, params: [M],
      expect: { must: { rows_min: 1 } } },

    // ══ A 目标臂: 4 张 ABSTAIN(第 5 名沉默)⇒ 必须是 refund + 该授权 ═══════════════
    { id: 'seed_abstain_0', action: 'exec_sql', sql: vote(0, 'ABSTAIN') },
    { id: 'seed_abstain_1', action: 'exec_sql', sql: vote(1, 'ABSTAIN') },
    { id: 'seed_abstain_2', action: 'exec_sql', sql: vote(2, 'ABSTAIN') },
    { id: 'seed_abstain_3', action: 'exec_sql', sql: vote(3, 'ABSTAIN') },
    { id: 'A_abstain4_yields_affirmative_unjudgeable_refund', action: 'call_module_export',
      module: 'pool-market-settler', export: 'decideConsensus',
      args: [market],
      // 🔴 断言【两样】而不是一样: action 与 authorization。
      //   只断 action:'refund' 不够 —— 别的路径(超时兜底)也会给出 refund, 那时授权字段是别的值,
      //   而本卡的命题恰恰是"**这一种** refund"。
      expect: { must: { reply_contains: ['"action":"refund"', 'committee_affirmative_unjudgeable'] } } },

    // ══ B 阈值对照: 只剩 3 张 ABSTAIN ⇒ 不得再是这条授权 ═══════════════════════════
    //  🔴 没有它, 一个"恒 refund"的实现能让 A 全绿。B 的已知答案(dispute)与 A 的失败输出不同,
    //     所以它分得开 —— 这正是"对照臂的已知答案不得等于失败输出"那条。
    { id: 'B_remove_one_abstain', action: 'exec_sql',
      sql: `DELETE FROM chain_events WHERE id = 'p2ev3'` },
    //  🔴 **我第一版把 B 的期望写成 `"action":"dispute"`, 实跑是 `"action":"pending"`** —— 记在这里:
    //    3 张 abstain 不到阈值后, 走的是**超时数学**(`:1536-1538` age vs ORACLE_SILENT_TIMEOUT_MS),
    //    而 age 读的是 `market.updated_at` —— 本卡传的是字面量 market, 没给它 ⇒ age≈0 ⇒ "等更多票"。
    //    ⚠ **我没有把期望改成照抄观测到的 `pending`**(那是事后拟合)。改成断言**两件与 age 无关的事**:
    //      ① 不是目标授权(B 的本职: 阈值真的在起作用)
    //      ② 计票确实数到了 ABSTAIN=3(证明**走到了计票**, 而不是被某道更早的捷径截胡 —— 本卡初版
    //         正是被 `bettors_absent` 截胡而三臂同答, 那时 B 的"不是目标授权"也成立, 却毫无意义)
    { id: 'B_abstain3_must_not_be_affirmative_unjudgeable', action: 'call_module_export',
      module: 'pool-market-settler', export: 'decideConsensus',
      args: [market],
      expect: { must: {
        reply_does_not_contain: 'committee_affirmative_unjudgeable',
        reply_contains: 'ABSTAIN=3',
      } } },

    // ══ C 方向对照: 4 张 YES(不是 abstain)⇒ 不得走退款授权那条 ════════════════════
    //  它挡的是另一种坏实现: "只要有 4 票就 refund"(不看 outcome)。
    { id: 'C_clear_votes', action: 'exec_sql',
      sql: `DELETE FROM chain_events WHERE json_valid(payload) AND json_extract(payload,'$.market_id') = '${M}'` },
    { id: 'C_seed_yes_0', action: 'exec_sql', sql: vote(0, 'YES') },
    { id: 'C_seed_yes_1', action: 'exec_sql', sql: vote(1, 'YES') },
    { id: 'C_seed_yes_2', action: 'exec_sql', sql: vote(2, 'YES') },
    { id: 'C_seed_yes_3', action: 'exec_sql', sql: vote(3, 'YES') },
    //  ⚠ C 是**否定式断言**, 而否定式的已知弱点是"任何第三种结果都能满足它"。
    //    ⇒ 它的职责**只有一条**: 杀掉"只要有 4 票就 refund(不看 outcome)"这一种坏实现。
    //    正面的重量由 A(断言目标态本身)与 B(断言 dispute)承担, 不靠 C。
    { id: 'C_four_yes_is_not_unjudgeable_refund', action: 'call_module_export',
      module: 'pool-market-settler', export: 'decideConsensus',
      args: [market],
      expect: { must: { reply_does_not_contain: 'committee_affirmative_unjudgeable' } } },

    ...clean,
  ],
};
