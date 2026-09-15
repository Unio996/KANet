# GO-F：主网 covenant 金丝雀设计页 v0.2（2026-09-15 · KANet-UI · Bettor (1453) 派工，取代 v0.1 · 只写不执行）

> **Status: DRAFT（v0.2）**。v0.2 = D-020 单笔金丝雀，**取代** v0.1 的独立 KTT-genesis-only probe 方案（v0.1 原文完整保留在本页末尾 `## SUPERSEDED（v0.1）` 小节，不删不改，供追溯）。**取代原因**：v0.1 写作时（2026-09-14）原型 v0 后端还没有任何真实广播代码，"验证我们的实现能否被主网接受"只能靠一个专门为验证目的手写的一次性探针脚本；现在（2026-09-15）D-020 单笔 `register_append` 市场创建/下注路径已完整合入主线（`c019a933`，见 (1452)(1453)），已经过 NWT 集中复核 GREEN、有完整的执行门（`assertProtoRelayHealthy`/`validateFixedValueOutputs`/`validateNetLoss`/`assertLeafStateMatchesChain` 等）——**直接用这条真实产品路径做金丝雀，比另写一个不会被任何人复用的探针脚本更划算**：验证的是"我们准备实际使用的代码"，不是"一个专门为了验证而单独造的近似物"。执行门不变：① 本页 → NWT 审 → 方向批准；② 广播动作本身仍须 Owner 单独批（三道闸结构见 (1453)，本页对应**闸 3**，排在闸 1（执行页 A，重启+环境配置）与闸 2（种子转账执行页 v0.7）完成之后）。D-021 规矩：本页不写密钥值、不写余额、不写地址。

> 🔴 **规则（NWT MUST①，账本 1454）：任何人重新开启 `PROTO_DRIVER_ENABLED` 之前，必须先完成 §1 的前置检查。** `runProtoDriverTick`（`kasia-console/src/services/proto-driver.mjs`）每一轮都会查 `proto_markets`/`proto_bet_intents` 里状态未终结的行去推进/核落链，**不区分"本次新建"还是上一轮卡住的残留**——不做这个检查，重开驱动会把上次异常中止时留下的半成品意图当成新任务静默续发。

## 0. 前提（本页写清楚，不代为满足）

1. 闸 1（`docs/2026-09-15-kanetui-proto-v0-restart-window-execution-page.md`）与闸 2（`docs/2026-09-14-kanetui-proto-v0-funds-seed-transfer-execution-page.md` v0.7）必须已经完成、验收读数全过，proto-v0-funds relay 已持有种子资金（1.95 KAS，三笔 0.5/0.5/0.95），本页（闸 3）才能开始。
2. 本页只做**一个**市场、**一笔**下注——不是压力测试，不追加第二个市场/第二笔注。
3. resolve/claim/withdraw 端点当前仍是 501 占位（§6/§9 结算入口未定案）——本页**明确不包含**这三步，金丝雀跑完就停在"下注已确认"，见 §5 的锁定说明。

## 1. 前置检查（MUST，开驱动之前）+ 设置 `PROTO_DRIVER_ENABLED=1` 并重启

**只读查询，不改任何数据**，在改 env 之前对主网库跑：

```sql
SELECT id, status FROM proto_markets WHERE status NOT IN ('betting','sealed','resolved','cancelled');
SELECT intent_key, bet_id, step, status FROM proto_bet_intents WHERE step = 'append' AND status != 'landed';
SELECT id, status FROM proto_bets WHERE status != 'confirmed';
```

- **三条查询结果必须全部为 0 行才允许继续**——本页闸 1（执行页 A）之后、本页 §1 之前，proto 表理应一直是空的（种子转账不写这几张表，代币定义/市场/下注创建全部待本页才发生），0 行是预期结果，不是需要特意制造的条件。
- 若非 0 行：**停下来，不设 `PROTO_DRIVER_ENABLED`，SendMessage 报 Bettor**，附查询结果——这意味着上一次尝试（本页或别的什么操作）留下了未清理的残留状态，直接开驱动会让 `runProtoDriverTick` 把这些残留当新任务静默续发（见页首规则）。
- **另一条前置条件（账本 1455/1456，真实成本核算）**：执行前 proto-v0-funds 上必须存在单个 **≥ 0.82 KAS** 的 UTXO（下注这一步真实最小可行值，见 §5 成本明细）——`buildRegisterAppendTxJson` 要求单个 fee 输入一次性垫付全部构造成本，选不到这么大面值的单个 UTXO 会在构造阶段直接失败，报错码 `no_suitable_fee_utxo`。种子转账 v0.7 第 3 笔（0.95 KAS）满足此条件，正常情况下不需要额外操作，此处只是写清楚这个隐性前提，供出现 `no_suitable_fee_utxo` 时排查用。
- 三条全 0 行：`kanet.mainnet.env` 新增一行 `PROTO_DRIVER_ENABLED=1`（执行页 A 那次重启**特意没加**这一行，本页是它专属的重启窗）。
- 走标准六步重启（同执行页 A §4）：NO-TX 检查 → 停旧 PID → 确认端口释放 → 起新进程 → 记新 PID。
- 验收：stdout 应出现 `[proto-driver] enabled`（或等价的"已启动"日志，具体措辞以 `services/proto-driver.mjs` 实际打印为准，执行时对照源码确认，不猜字面）——**跟执行页 A §5b 的 `[proto-driver] disabled` 正好相反**，这是本页唯一预期会变化的读数，其余（资金路由 403、敏感路由 503、五屏 200 等）应保持执行页 A 验收过的状态不变。

## 2. 经 UI 创建 1 个市场

- 打开 `/proto-markets/create`，选一个已有代币定义（若没有，先走 `/tokens/create` 建一个——这一步不涉及广播，纯 DB）。
- **min_bet / seal_count 无需填写**：读 `proto.js:118-119` 源码确认——这两项**后端硬编码**（`minBet=1`、`sealCount=2`），从未在创建表单上暴露，UI 上只填 结算代币/议题标题/截止时间/结算说明（可选）即可，天然就是"最小参数"。
- 截止时间填一个近期但留够操作余量的时间点（例如提交后 1 小时），避免金丝雀还没跑完市场就过期进入 `sealed`。
- 提交后逐步记录（不用 D-021 禁写的形式——`marketId`、`txid` 是协议数据不是持仓信息，可以写）：
  1. `POST /api/proto-markets/create` 的响应（`id`/`status`，创建成功此时状态应为某个"pending 广播"态，如 `genesis_pending`，具体值以实际返回为准）
  2. 驱动是否在响应内立即尝试推进（源码里 handler 会做一次"立即尝试"，失败不阻塞响应，后台驱动 tick 继续重试——见 `proto.js` `POST /api/proto-markets/create` 里 `driveMarketGenesis`/`buildAndBroadcast` 调用段的注释）
  3. 轮询 `GET /api/proto-markets/:id`，观察 `market.status` 何时从 `genesis_pending`（或等价初始态）变为 `betting`——变化即代表 genesis 交易已落链确认
  4. 链上核对：`market.shardleaf_txid`（若响应字段暴露；未暴露则从驱动日志/DB 取）在区块浏览器上查一遍，确认存在、确认数达标
- 若长时间（建议设一个明确超时，如 10 分钟）状态未变化，按 §6 中止条件处置，不无限等待。

## 3. 下 1 笔最小注额

- 在市场详情页 `/proto-markets/:id`（此时应已是 `betting` 态）选 YES 或 NO、填最小金额（业务上任意值即可，不强求恰好等于 `min_bet`，但建议填一个小额如 `1`，降低金丝雀本身占用的种子资金）。
- 提交后同 §2 逐步记录：
  1. `POST /proto-markets/:id/bet` 响应（`202 {ok,id,status}`，`status` 初始应为 `pending`——前端页面已按这个契约实现，本页记录后端实际给出的值供交叉核对）
  2. 轮询 `GET /api/proto-markets/:id` 的 `bets[]` 数组按 `id` 找这一笔，观察 `status` 何时从 `pending` 变为 `confirmed`
  3. **leaf 状态推算与链上核对**：`deriveLeafState`（(1452) 集中复核确认的现有函数，`status='confirmed'` 才计入、`get_address_utxos` 失败或目标 outpoint 缺失即拒绝方向）算出的市场当前状态，与直接用 `GET /api/relay/:id/wallets` 或区块浏览器查该 outpoint 的真实链上内容做一次人工比对，确认一致——这是本金丝雀真正要验证的核心事实："我们的推算代码跟真实链上状态一致"，不是只看 API 返回 200 就算过。
- 同 §2，设超时上限，不无限等待。

## 4. 立即关闭

- 完成 §3 且核对一致后，**立即**从 `kanet.mainnet.env` 删除 `PROTO_DRIVER_ENABLED=1` 这一行，重启 console。
- 验收：stdout 恢复 `[proto-driver] disabled`（同执行页 A §5b 那条），资金路由/敏感路由/五屏读数复核一遍确认未受影响。
- **不因为"这次跑通了"就顺手再跑第二个市场/第二笔注**——本页范围就是"1 个市场 + 1 笔下注"，验证到此为止，扩大范围是另一次独立决定，不在本页授权内。
- **重跑 §1 那三条前置检查查询，逐行分类处理**（关闭后的收尾，跟 §1 的开驱动前检查是同一套查询，目的相反——一个是确认干净才敢开，一个是确认关闭后没留手尾）：
  - 状态为 `genesis_pending`/`pending`（`prepared_txid`/`genesis_submitted_txid` 等字段为空，说明从未真正发过 IPC）⇒ **可以删**，但只能由执行人经 Bettor 确认后删除，不自行删。
  - 状态为 `genesis_prepared`/`genesis_submitted`/`prepared`/`submitted`/`genesis_ambiguous`/`ambiguous`（交易可能已经广播出去，链上可能已经有记录）⇒ **禁止删除**——这正是 NO TX NO STATE CHANGE 的反面：本地记录可能对应一笔已经上链的真实交易，删记录不会撤销链上的事实，只会让我们自己失去追踪它的能力。处置：用记录里的 `txid`（`prepared_txid`/`genesis_submitted_txid`/等价字段）到区块浏览器/`get_address_utxos` 核实是否落链——落链了就转人工对账（这笔市场/下注实际发生了，只是驱动没能把它推进到终态，需要人工把 DB 状态修到跟链一致，不是本页范围内的自动化操作）；没落链也**不重发**（重发可能造成双花/冲突，具体处置留给人工判断）；把这些行整理成清单（`id`/`intent_key`/`status`/`prepared_txid` 等字段）报 Bettor → Owner，不自行决定。

## 5. 成本与锁定说明

🔴 **明确写给 Owner 看**：**resolve / claim / withdraw 三个端点目前仍是 501 未实现**（§6/§9 结算入口尚未定案）。这意味着本金丝雀锁进市场 covenant 的 KAS（下注那一笔的 stake，此时归属市场的 leaf/held 状态，不再是任何人钱包里的自由余额）**在结算入口真正落地之前，没有任何路径能取回**——这不是"暂时卡住等一下"，是"这条路径本身还没写"。金丝雀完成后，这笔资金会长期处于锁定态，直到未来某次独立的结算实现工作完成为止。

**真实数字**（账本 1455/1456 修复后，J2 用主线 `c019a933`+修复提交的真实 builder + 真实 `calculateTransactionMass` 离线构造算出，不签名不广播；来源 `docs/provenance/2026-09-15-j2-d020-register-append-fee-formula-fix/` 分支 `coord/j2-register-append-fee-bug-fix` `75dc9263`，Bettor 已逐 sompi 验算核对；**修复前该分支另一版本数字已过期，不要用**）：

| 交易 | 用的种子 UTXO | required_fee | 找零回 relay | 锁进合约 |
|---|---|---|---|---|
| ①建市场（genesis） | 0.5 KAS | 0.21333300 KAS | 0.08666700 KAS | 0.2 KAS |
| ②下第 1 笔（无 held） | 0.95 KAS | 0.43339900 KAS | 0.11660100 KAS | 0.6 KAS（累计） |

- 两笔合计：动用种子 UTXO 面值 1.45 KAS，找零回 relay 0.20326800 KAS，**净消耗（真正付出去，一去不复返）= 1.24673200 KAS**——其中付给网络的手续费 0.64673200 KAS，锁进合约的 0.6 KAS。
- proto-v0-funds 种子总额 1.95 KAS，本金丝雀只用掉 1.45 KAS（另一枚 0.5 KAS 种子 UTXO——原为 D-020 已取消的"步骤 A"预留——本次用不上，留在原地不构成风险，无需处置）；金丝雀跑完后 proto-v0-funds 应余 **0.70326800 KAS**（= 未动用的 0.5 + 找零 0.20326800）。
- 实际数字以广播时真实计算结果为准（`assertImpliedFeeMatches` 会在构造层强制核对，不符即拒绝构造），写入 §7 证据清单。

🔴 **结算入口落地前取不回的金额（账本 1456 追加纠正，非"稳态不变"，会随下注笔数累积）**：`0.4 KAS`（leaf 续约 + 合并 KanetTestToken genesis，这部分随每次 `register_append` 滚动前进、不新增）**+ `0.2 KAS × 已下注笔数`**（`PoolSideTicket` 是"spent-once"凭证，每笔下注各自新铸一个，只在该笔自己将来 `claim_draw`/`refund_payout` 时才会被消费，不会被后续下注合并或替换，会一笔笔累积）。**本金丝雀只下 1 笔，代入得 0.4 + 0.2×1 = 0.6 KAS**（与上表"锁进合约"累计列一致）——若未来在此基础上再下第 2 笔，取不回的金额会变成 0.4+0.2×2=0.8 KAS，不是继续停在 0.6 KAS。

## 6. 中止条件（任一触发 ⇒ 立即关闭驱动并上报，不重试）

- 任一步交易返回/被判定为 `ambiguous`（状态机存在但无法确定真实链上结果，如 `checkDependencyLanded`/驱动重试逻辑报告 ambiguous）。
- `GET /api/proto-markets/:id` 推算出的状态与链上实际观察（区块浏览器/`get_address_utxos` 直查）不一致。
- relay（proto-v0-funds）拒绝签名（`assertProtoRelayHealthy`/`validateFixedValueOutputs`/`validateSignedInputCeiling`/`validateNetLoss` 任一断言在正常参数下意外拒绝）。
- proto relay 余额断言触发（余额意外接近或超过 `PROTO_MAX_BALANCE_KAS=5`——正常情况下种子只有 1.95 KAS，不该发生，一旦发生说明有资金来源之外的异常）。

### 6a. 对着 stdout 查的具体错误码/前缀（读源码逐条核对，非猜测）

- Console 侧（`kasia-console/src/lib/proto-broadcast-ops.mjs`/`proto-leaf-state.mjs`）：`no_suitable_fee_utxo`、`leaf_state_drift`（`assertLeafStateMatchesChain`）、`held_ktt_drift`（`assertHeldKttOutpointMatchesChain`）、`market_append_in_flight`（`assertNoInFlightAppend`，ambiguous 存在时新的步骤不自动清）。
- Console API 层（`proto.js`）：`proto_driver_disabled`（驱动未开启时的 409）。
- Relay 侧（`kasia-relay/src/lib/covenant-broadcast-relay.mjs`，逐行核过，**不是所有拒绝都带 "REJECTED"**）：
  - **`REJECTED (<reason>): <detail>`** 格式的 5 个：`fixed_value_output_mismatch`（:130）、`signed_input_ceiling_exceeded`（:136）、`txid_mismatch`（:150）、`fee_calc_failed`（:158）、`net_loss_exceeded`（:170）。
  - **不带 "REJECTED"** 的几种，日志措辞各不同：`not_proto_relay`（:68-69，执行权限门，日志是 `COVENANT_BROADCAST <key> DENIED: ...`）、`sign_failed`（:143-144，`... sign failed: ...`）、`prepared_ingest_failed`（:180-181，`... prepared receipt failed ...`）、`broadcast_failed`（:188-189，`... broadcast failed: ...`）。
  - **执行时用更宽的前缀 `COVENANT_BROADCAST <key>` 去 grep**（不要只 grep `REJECTED`，会漏掉上面这几种）。
  - **额外一个本页起草时发现、NWT 清单未列但跟 MUST① 残留清理直接相关的 code：`ingest_after_broadcast_failed`**（:96、:198，`... submitted receipt not recorded ...`）——这是**广播已经成功发出、只是本地回执记录失败**的情况，比 `prepared_ingest_failed`/`broadcast_failed`（这两者是广播动作本身没成功）更需要走 §4/§6b 的"链上核对、不删、报 Bettor"处理：交易大概率已经在链上，只是我们的 DB 可能没跟上。

**这几个 code 里，`prepared_ingest_failed`/`broadcast_failed`/`ingest_after_broadcast_failed` 三者跟 §4/§6b 的残留清理直接相关——出现这三者中任一个，务必按那两节的分类处理（链上核对、不删、报 Bettor→Owner），不要因为"看着像是失败了"就直接删记录。

### 6b. 中止后同 §4 的收尾

触发中止后，除了立即关闭驱动，**同样跑 §4 那三条前置检查查询并按同一套规则分类处理**（`pending`/`genesis_pending` 经 Bettor 确认可删；`prepared`/`submitted`/`ambiguous` 一律禁止删除、链上核对、报 Bettor→Owner，不重发不自行处理）——中止跟正常完成后的"立即关闭"在清理这一步没有区别，都要走这套只读优先、有广播嫌疑就不删的规则。
- 出现以上任一情况：**立即**执行 §4 的关闭步骤（删 `PROTO_DRIVER_ENABLED` + 重启），保留现场（stdout 日志、DB 当前行、驱动 tick 记录）供诊断，SendMessage 报 Bettor，**不自行重试、不自行诊断后继续**。

## 7. 证据清单（执行完成后落 `docs/provenance/2026-09-15-kanetui-proto-v0-mainnet-canary/`）

- 市场创建：`marketId`、`shardleaf_txid`（或驱动日志记录的等价字段）、状态转移时间线（`genesis_pending`→`betting` 各自时间戳）、区块浏览器核对截图/链接。
- 下注：`betId`、`register_append` 的 txid、状态转移时间线（`pending`→`confirmed`）、leaf 状态推算 vs 链上直查的比对结论。
- 实际花费：两笔交易各自真实 mass 与 required_fee（`calculateTransactionMass` 真实输出，不是估算），确认落在 §5 数量级区间内。
- 关闭确认：`[proto-driver] disabled` 复现的 stdout 截取、重启前后各项读数对照。
- 明确写"本次不涉及"的范围：resolve/claim/withdraw、第二个市场、多笔下注、任何超出本页 §1-4 步骤的操作。

---

## SUPERSEDED（v0.1，2026-09-14 原文，完整保留供追溯，不再是当前执行路径）

> ⚠ 以下内容按 v0.2 (1453) 派工**已被取代**：本页 v0.2 改用 D-020 已合入主线的真实市场/下注路径做金丝雀，不再需要下面这个独立的、手写的 KTT-genesis-only 探针脚本方案。保留原文供追溯 v0.1 当时的技术判断（Toccata 激活状态核实、身份分歧讨论、成本核算方法论等仍有参考价值）。

# GO-F：主网 covenant 金丝雀设计页 v0.1（2026-09-14 · KANet-UI · Bettor 1191 派工 · 只写不执行）

> **Status: DRAFT**。权威：`docs/2026-09-14-nwt-redteam-rootclose-tokenization-and-mainnet-covenant-blocker-v0.1.md`（GO-F 这个名字的出处——该文档结论"本项目确实从未对真实主网节点广播测试过一笔 covenant 交易，端到端从未验证"，Bettor 明确认可，"已立 GO-F 金丝雀验证补上"）。**本页只设计，不执行任何广播/转账/签名**。执行门分两层，不能合并：① 本页 → NWT 红队审 → 方向批准（"设计可以照这个做"）；② **广播动作本身须 Owner 单独批**（Bettor 1191 原话），即便①已过，广播前仍要另一次独立的 Owner GO，不能"设计批了就等于广播批了"。

## 0. 背景与阻断前提

### 0.1 为什么现在做这件事
`docs/2026-09-14-nwt-redteam-rootclose-tokenization-and-mainnet-covenant-blocker-v0.1.md` 独立核实（`consensus/core/src/config/params.rs:269/:370/:724`，官方 `v2.0.1` 标签）：官方主网 `MAINNET_PARAMS.toccata_activation = ForkActivation::new(474_165_565)`，covenant 相关校验由 `toccata_activation.is_active(block_daa_score)` 门控（`tx_validation_in_utxo_context.rs::check_scripts()`）。**当前主网 DAA 远超这个阈值**（本人本次会话独立探针核实：`daa=539153306`，见标准 hourly probe 记录，`539,153,306 > 474,165,565`）——covenant 在官方主网上已经激活很久了，不是"即将激活"或"刚激活"。**唯一站得住的缺口**：本项目自己的代码，从未真的对一个真实主网节点广播过一笔 covenant 交易——所有既有 covenant 相关证据（P9/P10/P11/P12 探针、`.test.json` 向量、`cli-debugger` 运行期向量）都是**离线**的（`cli-debugger` 本地跑，不碰任何真实 RPC 节点），本项目现有唯一一处**真实广播过** covenant genesis 的代码路径（`kasia-relay/src/lib/p2sh.mjs:1865` `unlockBshardGenesisMintPayout()`，走 `populateGenesisCovenants`+`rpc.submitTransaction`）历史上只在 TN12 跑过，从未指向过官方主网节点。GO-F 要补的就是这一个具体、狭窄的缺口："我们的代码构造的 covenant genesis 交易，官方主网节点真的会接受"——不是重新验证 covenant 机制本身（那是共识层的事，源码已经核对过），是验证**我们这边的实现**。

### 0.2 阻断前提（本页写清楚，不代为满足）
1. **身份必须先存在且已启动**——GO-F 需要一个已经持有真实 KAS、relay 进程已在跑的 mainnet 身份来签名+广播（见 §1）。这个身份来自迁移第 2 批（`docs/2026-09-14-kanetui-mainnet-migration-batch2-small-exec-v0.1.md`），**本页写作时第 2 批尚未执行**——GO-F 的广播动作不能早于第 2 批验收通过。
2. 本页（设计）本身不需要等第 2 批完成就能写/审，但**广播执行**必须排在第 2 批之后。
3. NWT 2-1 热钱包硬上限（`RELAY_HOTWALLET_PER_RELAY_MAX_KAS=800`/`_TOTAL_MAX_KAS=1000`）已部署生效（`docs/provenance/2026-09-14-kanetui-hotwallet-mainnet-deploy/`）——GO-F 用的身份余额远低于两个上限（余额见 docs-private），不受影响，只是记录这条已满足的前提，不是待办。

## 1. 身份

**用迁移进来的小额账号**（迁移 runbook `docs/2026-09-14-kanetui-mainnet-account-migration-runbook-v0.1.md` §8、GO-E 清单 `docs/2026-09-13-kanetui-mainnet-relay-identity-funding-checklist-v0.1.md` 状态注记已定的同一条决定）：账户 A（余额见 docs-private）或账户 B（余额见 docs-private）二选一——两者选哪个对本页设计没有实质影响，留给 Bettor/Owner 定，本页不代为拍板。`Trader-B` 因 Rule 1 零引用 grep 命中源码硬编码常量，**永不能**用作这个用途，此前已定，本页不重复展开判据本身。

### 1.1 GO-E 纪律怎么用在这里——一个需要 Bettor/NWT/Owner 明确确认的分歧点

Bettor 1191 原话"走 GO-E 九步纪律（手动、一次性）"——**这句话有两种读法，本页必须先把分歧摊开，不能自己悄悄选一种**：

- **读法 A（本页采纳的读法）**：GO-F 的**广播这个动作本身**借用 GO-E 的**纪律模式**——手动触发、零自动化接线（不写 cron/watchdog 去做这件事）、每一步留证据、不因为"反正只是个小动作"就跳过任何一步。这跟 GO-E 清单里"ephemeral manual relay 五条硬门"是同一种精神，但**不要求**逐字套用 GO-E §5 的九步表格（那张表是为"一次性验证身份、验证完即删"这个场景设计的）。
- **读法 B（本页明确不采纳，原因如下）**：逐字套用 GO-E 九步流程，包括**步骤⑧ DELETE**——即 GO-F 广播用完这个身份就把它从 `relay_nodes` 删掉。**这条在当前语境下会跟迁移本身的目的冲突**：`Bettor`/`Trader-A` 是 Owner 1168 决定"所有已知账户都要导入"里的正式一员，迁移 runbook 把它们当作要长期留存的迁移结果，不是"验证完就扔"的一次性马甲身份——GO-E 九步表原本设计给的是一个**专门新建、只为验证用**的身份（v0.1-v0.4 那版"新建一行"），现在改成"复用刚迁移进来的这一行"之后，字面上还留着"步骤⑧ DELETE"这句话，但**没有人重新审过"删掉这一行"这个后果在新语境下还对不对**——迁移 runbook §8 那条状态注记只说"流程本身不变，换个行"，没有正面回答"这一行还要不要在验证完之后被删掉"这个问题。

**本页的立场**：GO-F 广播完成后**不删除** `Bettor`/`Trader-A` 这一行——它是迁移结果的一部分，删掉等于撤销了第 2 批迁移的一部分工作，这不是 GO-F 该做的决定。本页只借用 GO-E 的"手动、零自动化、留证据"这个纪律精神，不套用"用完即删"这个动作。**这个判断本页给出但不视为定论**——是否要重新审一次"迁移进来的账号，验证用途结束后要不要删"这个问题（跟 GO-F 本身无关，是任何"复用迁移账号做一次性验证"场景都会遇到的通用问题），留给 Bettor/NWT/Owner 在审这份设计页时明确表态，本页不代为拍板，只负责把分歧点摆出来不藏着。

## 2. 交易设计：选 KanetTestToken genesis，不新造 probe covenant

### 2.1 为什么选 KTT genesis
- `KanetTestToken`（`kasia-console/src/lib/sil-v1/KanetTestToken.sil`，设计文档 `docs/2026-09-13-j2-t1-kanet-test-token-kcc20-contract-design-v0.1.md` v0.5 A″ 定稿，NWT 红队审 `docs/2026-09-13-nwt-redteam-j2-t1-token-sil-implementation-review-v0.1.md` GREEN）**genesis 本身零权限、零签名、零上限**——设计文档原话（§2.1）："铸造 = 构造一个输出...用任意资金输入授权（`GenesisCovenantGroup`，同 relay `p2sh.mjs:1885` 形），得到新 covenant-id。零校验、零签名、零上限 = Owner 裁定 4"。共识层面：`covenant_id` 由共识重算比对（`WrongGenesisCovenantId` 规则，`covenants.rs::CovenantsContext::from_tx`，NWT/J2/源码三方互证），但**genesis 输出自己声明的状态字节完全不受检**（"genesis outputs are validated but do not populate covenant contexts"）——**这正好匹配 Bettor 要求的"免权限、dust级金额、无第三方受害者"**：genesis 这个动作不需要任何人签名/批准就能构造，不触碰除广播者自己以外的任何账户，天然没有第三方受害者。
- **本仓不存在比 KTT genesis 更简单的可部署候选**：`ProbeOutCovId.sil`/`ProbeBoutCombo.sil`/`ProbeBoutLoop.sil`/`ProbeBoutCov.sil`（`docs/provenance/2026-09-13-j2-t1-token-sil-implementation/`）都是 V-T-6 调试期用的**离线 debugger 专用隔离探针**，从未编译成可部署产物、不接 wallet、不是为真实广播设计的——拿它们改造成能广播的东西，工作量比直接用已经审过、已经编译好字节码（`KanetTestToken.compiled.json`，3863 B，NWT 独立重编字节一致）的 KTT 更大，且要重新走一轮红队审，不划算。
- **本页明确限定范围：只做 genesis，不调用 `transfer`**——KTT 的花费路径（`transfer`）有一个已知未闭合的坑 `V-T-6`（`docs/provenance/2026-09-13-j2-t1-token-sil-implementation/KNOWN-GAP-V-T-6.md`，状态 OPEN：`binding=cov` 框架下 `OpOutputCovenantId`+`validateOutputStateWithTemplate` 组合失败，隔离探针单独测两个原语都过）——**genesis 阶段不执行任何脚本**（见上一条），跟 `transfer` 的这个坑完全无关，选择"只 genesis 不 transfer"让 GO-F 天然绕开一个尚未解决的已知问题，不是碰巧躲过、是刻意这样设计范围。

### 2.2 具体构造（设计层面，不是可执行代码——脚本本身需要另派实现+另经 NWT 审）
KTT 的 genesis 输出（设计文档 §2.1 原话）：
```
scriptPubKey = P2SH(prefix ‖ encode(State{
  amount, owner, owner_scheme, borrow_scheme, borrow_guard, extension_commitment
}) ‖ suffix)
```
六个状态字段（设计文档 §1）里，**本页建议 GO-F 的 genesis 故意构造成"天生不可花"的实例**：
- `owner_scheme` 填 `0x04` 以外的值（如 `0x00`），或 `owner` 填任意/全零 32 字节——设计文档 §2.1 自己写明这样的结果"这些实例不可花（§2.2 只认 0x04 + 模板在场），等于自毁；不是漏洞，是免费无限的代价"。
- **这样做的好处对 GO-F 场景是双重的**：① 天然、永久排除任何人（包括我们自己）误花这笔 canary 输出的可能，不需要额外的"锁定"机制；② §5 的回滚/失败处置章节因此大幅简化——不存在"这笔资金后续要怎么处理"的问题，dust 从一开始就是有意、可预期、有界的一次性沉没成本，不是"卡住的资金"。
- `amount` 字段填一个任意小整数（如 `1`）——这是 KTT 内部的代币供应量记账单位，**跟这个 UTXO 本身承载的真实 KAS 面值（sompi）是两回事，不要混淆**（见 §4 成本核算专门强调这条）。
- 构造机制：镜像 `kasia-relay/src/lib/p2sh.mjs:1865` `unlockBshardGenesisMintPayout()` 已经验证过的模式——`populateGenesisCovenants([new GenesisCovenantGroup(...)])` + 签名 + `rpc.submitTransaction`，只是把目标脚本/状态编码换成 KTT 的（`KanetTestToken.compiled.json` 的 bytecode + 上面这组状态字段），不是从零设计广播机制，是复用本仓已经在 TN12 真实跑过的同一套 genesis 广播代码形状，换一个目标合约。
- 这段构造逻辑本身要写成**一次性、经 NWT 审查的脚本**（同迁移 runbook §3.1 对一次性高权限脚本的一贯要求），本页只给设计，脚本代码不在本页交付范围内，需要另派。

### 2.3（可选）第二枚金丝雀：post-Toccata 大 witness
Bettor 1191 item③要求验证"post-Toccata 大 witness（>10,000 B）被接受"，可选加一笔。背景核实（GO-F 出处文档 §3-4）：`max_signature_script_len` 是 `ForkedParam`（`params.rs:472-473`），Toccata 前 10,000 字节、**Toccata 后 250,000 字节**——当前主网早已过 Toccata（见 §0.1），理论上限是 250,000 字节。**本仓目前没有任何文档专门论证过"为什么要用一笔真实广播去验证这个新上限"**——这是本页新增的设计内容，不是抄自哪份既有文档，理由是：GO-E 清单里已经有先例（步骤⑦"实测兜底，不能只信静态审计"，NWT 抓到过一次静态列举有盲区被漏掉的真实坑）——只读 `params.rs` 源码确认新上限是 250,000，跟真的广播一笔超过旧上限（10,000）、验证真实主网节点确实按新上限接受而不是按旧上限拒绝，是两件不同确信度的事，同一种"读代码不能代替真实跑一次"的纪律,GO-F 既然要做第一笔就顺手把这条也测掉，比日后再单独立一次金丝雀划算。
- 构造方式（设计层面）：同 §2.2 的 genesis 交易，但把签名脚本人为填充到超过 10,000 字节（例如用无意义但语法合法的填充数据撑大 `sigScript`，具体填充方式留给实现脚本决定，只要求最终字节数明确超过 10,000 且明确低于 250,000，取一个有安全边界的中间值如 ~20,000-50,000 字节，不贴着上限走）。
- 这一笔是**可选**的——如果 Owner/Bettor 认为第一笔（普通大小的 genesis）已经足够回答"我们的实现能不能被主网接受"这个核心问题，可以先只做第一笔，第二笔另择时机。本页不强制两笔必须同批做。

## 3. 验证点

1. **节点 accept（mempool）**：`rpc.submitTransaction({transaction, allowOrphan:false})` 返回值本身（含 txId）是第一道确认——本仓已有 `p2sh.mjs:97` 附近的 mass-observe 包装模式（成功后查 `getMempoolEntry` 做权威 mass 对照）可以直接复用同一个观测模式，不需要另外设计一套"怎么确认进了 mempool"的机制。
2. **节点 accept（上链）**：等待若干确认（沿用本仓已有的"落地确认"惯例，同结算/`bshard`路径用的 `check_utxo_landed`/`minDepth` 判据，`pool.js`/`bshard-close-enforce.mjs` 已有先例——不新发明一套确认深度判据）。
3. **`OpCovenantId` 读回非零**：广播后用 `getUtxosByAddresses` 查这笔 genesis 输出对应的 UTXO，读 `entry.covenantId`（同 `kasia-relay/src/lib/p2sh.mjs:1850` `_psInputCovId()` 已经在用的字段路径——真实生产代码已经在用这个读法，不是新设计）。**光"非零"不够严谨**——本页要求同时**独立重算期望值**（`covenant_id(funding.outpoint, [genesis_output])`，同 `unlockBshardGenesisMintPayout()` 头注释描述的算法）并逐字比对，不是看到非零就算过，要看到"非零且等于我们自己独立算出来的那个值"，这才是真正验证了共识层的诚实性检查确实按预期工作，不是只验证了"这个字段有被填"这个更弱的事实。
4. **covenant 绑定字段在 RPC 里可见**：同第 3 点，`getUtxosByAddresses` 返回结构里能查到 `covenantId`（或 `entry.covenant`/`covenant.covenantId` 等价路径，`_psInputCovId()` 三选一兜底写法已经说明这个字段在不同 RPC/wasm 版本下的路径可能不完全一致，实现脚本要按跑起来的真实返回结构确认，不能假设哪个字段名一定对）这件事本身就是这一条的验证内容，不是独立于第 3 点的另一件事——第 3/4 两点其实是同一次查询产出的两个观察角度（"值对不对" vs "字段能不能被看到"），证据页可以合并记录。
5. **（可选）大 witness 被接受**：同第 1/2 点方法验证第二笔金丝雀，额外记录实际使用的 `sigScript` 字节数，确认落地成功且没有被 `max_signature_script_len` 拒绝。

## 4. 成本上限：≤0.1 KAS（含费），每笔独立核算

🔴 **不要混淆两个不同的"金额"**：KTT `State.amount` 字段是代币内部供应量记账单位（§2.2 建议填 `1`），**跟这笔 UTXO 本身承载的真实 KAS 面值（sompi）完全无关**——真正花钱的是 UTXO 的 `value` 字段（dust 级）+ 交易费，不是 `amount` 这个数字，实现脚本和后续证据页都要把这两者分开记录，不能把 `amount:1` 误读成"只花了 1 sompi"。

- **UTXO 面值**：取一个 dust 级但不会被节点当作粉尘拒绝的最小值（本仓有 `p2sh.mjs` 等既有代码里对 dust 阈值的处理经验，实现脚本应直接复用而不是猜一个数字——本页不猜具体 sompi 数，留给实现阶段读代码确认）。
- **交易费**：优先用真实 `kaspa-wasm calculateTransactionMass('mainnet', signedTx)` 算出真实 mass，再乘 `MIN_SOMPI_PER_MASS`（`p2sh.mjs:41` 附近定义，`tx-mass-ub.mjs` 上界证明表引用为 100 sompi/mass）——**mainnet 不受 `tx-mass-ub.mjs` 头注释描述的那个 wasm panic 影响**（`Params::from(NetworkId)` 缺分支的问题只发生在 `'testnet-12'`，注释原文逐字核实过），所以第一选择是直接调真实 wasm mass 计算，`tx-mass-ub.mjs` 的上界证明表可以作为独立交叉核对，不是必须依赖的主路径。
- **数量级判断（非精确数字，实现阶段以真实工具算出的数字为准）**：普通 genesis（§2.2）交易体积小（单输入单输出 + 几百字节的 P2SH 前后缀与状态编码），mass 大概率落在几百量级，费用远低于 0.1 KAS；大 witness 金丝雀（§2.3，签名脚本填充到 ~20,000-50,000 字节）的 mass 会显著更高（`size` 项与 `sigscript` 长度线性相关，`mass_per_tx_byte=1`），但即便按 50,000 字节估算，`50,000 × 1 × 100 sompi = 5,000,000 sompi = 0.05 KAS`，仍在 0.1 KAS 以内——**这是数量级判断，不是精确承诺**，实现脚本广播前必须用真实工具重新算一遍，确认真实数字确实 ≤0.1 KAS 才能广播，超出就要缩小填充字节数，不能凭这里的估算直接执行。
- **本页把 0.1 KAS 理解为每笔独立的上限**（UTXO 面值+费用合计），不是两笔金丝雀加总的上限——如果两笔都做，总花费上限是这两笔各自 0.1 KAS 之和（≤0.2 KAS）。这个理解如果跟 Bettor 原意不符，请在审这份设计页时明确纠正，本页只是把自己的理解写清楚，不代为扩大或缩小范围。

## 5. 回滚/失败处置

- **铁律基线**：`docs/guide/rules/00-no-tx-no-state.md`（NO TX NO STATE CHANGE）——任何 provenance/DB 记录只能在**真实确认落地**之后才能推进，不能在 `submitTransaction` 一返回就乐观写入"成功"，这条对 GO-F 同样适用，不因为是"金丝雀/低风险"就降低这条纪律。
- **§2.2 的设计选择本身就是最大的一层"回滚"**：genesis 构造成天生不可花的实例（`owner_scheme≠0x04`），dust 花费从一开始就是有界、可预期的一次性沉没成本，**不存在"资金卡住需要救援"这种场景**——这是刻意的范围收窄，不是碰运气。
- **失败模式逐条处置**：
  1. `submitTransaction` 直接被拒（RPC 层报错，例如格式不对/费用不够）——没有任何资金离开原地址，没有链上状态变化，按报错信息诊断+改脚本，不需要任何"回滚"动作。
  2. 进了 mempool 但迟迟不确认/被驱逐——标准 UTXO 行为，原 UTXO 会在 mempool entry 过期/被驱逐后恢复可花状态（这是 kaspad mempool 的既有机制，不是本项目要另写代码处理的东西）——**这条本页未独立验证 mainnet 节点的实际驱逐策略，只是基于标准 UTXO 语义的推断，如果执行阶段观察到跟预期不同，按实测结果为准，不要求预先证明**。
  3. 落地了，但 §3 第 3/4 点的 `covenantId` 读回结果跟独立重算的期望值不一致——**这不是资金损失事件**（genesis 本身已经不可花），是验证/实现层面的问题，需要停下来诊断具体哪一步的理解或代码有误，不需要任何链上补救动作。
  4. 一切按预期：广播成功、落地确认、读回值与期望值一致——完成，§6 证据清单据此收尾，没有后续动作。
- 本页产出本身（设计文档）不构成任何风险动作——真正的风险点在广播那一刻，且广播前有独立的 Owner 批准这一道闸（§0 执行门），本页不需要为"写这份文档"本身设计回滚。

## 6. 证据清单（执行完成后落 `docs/provenance/<日期>-kanetui-mainnet-covenant-canary-goF/`）

- 身份选定记录（`Bettor` 或 `Trader-A`，哪一个、为什么）。
- 实际使用的一次性构造脚本（经 NWT 审查版本，脚本本身或指向脚本 commit 的引用）。
- 广播响应：`submitTransaction` 完整返回（含 txId）、`getMempoolEntry` 观测结果。
- 落地确认：区块/确认深度、`getUtxosByAddresses` 查得的完整 UTXO 记录（含 `covenantId` 字段原始值）。
- 独立重算的期望 `covenant_id`（算法+输入值+计算结果），与读回值的逐字比对结论。
- 实际花费：UTXO 面值（sompi）+ 实际 mass + 实际费用（真实 `calculateTransactionMass` 调用输出，不是估算），确认 ≤0.1 KAS。
- KTT 状态字段实际取值（`amount`/`owner`/`owner_scheme`/`borrow_scheme`/`borrow_guard`/`extension_commitment`，均为公开链上数据，不含任何密钥材料）。
- 若执行了 §2.3 大 witness 金丝雀：实际字节数、mass 构成明细、落地确认结果。
- 明确写"本次不涉及"的范围：`transfer`/花费路径、`V-T-6` 相关行为、多输入/整合场景——本金丝雀严格只验证"我们的代码构造的 genesis covenant 交易，真实主网节点是否接受、字段是否如实回显"这一件事，不代表 KTT 花费路径或更复杂场景已经过主网验证。
