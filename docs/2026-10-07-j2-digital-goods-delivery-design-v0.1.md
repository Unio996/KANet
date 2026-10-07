# 设计稿：数字商品「付款后交付」v0.1（只设计，未写码）

> **Status**: CURRENT（DRAFT v0.1·待 Bettor 审；审过前不动代码）。作者 J2 · 2026-10-07 · Bettor 派工（第二件）。
> **写作依 D-021**：不含密钥、真实地址、真实持仓、内网 IP；示例值一律占位。
> **执行门**：本页 → Bettor 审 → NWT 攻击面审 → Owner 批（涉用户面与钱路相邻）→ 实现 + simnet → 审 diff → 合入；部署另批。

## 0. 一句话

商家（卖家）在即时分账订单**付款并分账完成**后，把交付物（下载链接 / 激活码）交给买家：**主通道 = 买家凭订单凭据自取（pull）**；**可选推送 = Kasia 加密私信发到买家订单里声明的「交付地址」**。不依赖「付款地址」，因此买家用交易所地址付款、或收不到私信，都不影响交付。

## 1. 查现成清单（第一原则：先问"是不是已经有了"）

| # | 现成件 | 位置 | 用在哪 / 结论 |
|---|---|---|---|
| 1 | 即时分账订单合约 `split`/`refund`、`payer_refund_spk` 烤进订单、`deadline_ms` | `docs/2026-09-27-j2-instant-split-covenant-template-design-v0.2.md` §2.3/2.4 | **直接复用**，不改合约。`split` 任何人可触发；`refund` 只在 `deadline_ms` 之后。⇒ 交付时机的关键事实（§3） |
| 2 | `monitor.js`（浏览器直连节点只读监视：到账 / 不足 / 超付 / 确认深度 `REORG_SAFE_MIN_DEPTH=20`） | `kasia-console/src/lib/checkout-static/monitor.js` | 它**只在买家页面里跑**，不是卖家侧服务。卖家侧判据**复用同一公式**（对应 relay `checkUtxoLanded` minDepth），不另起一套 |
| 3 | `order-receipt.js` 订单凭据（`orderNonce`+`deadline`+报价/渠道链接+退款地址；页面重建订单地址并逐字比对） | `.../checkout-static/order-receipt.js` | **取货凭证直接复用凭据**：它本来就是"订单#1 退不回"事故后的**不可伪造的订单身份**（持有 nonce 才能重建地址）。不新造 token |
| 4 | Kasia 加密私信：relay `send_message`（`chain.mjs sendMessage`→自转账携带密文，收方按别名解密）、`DAILY_SEND_LIMIT`、`MAX_MESSAGE_CHARS=5000` | `kasia-relay/src/chain.mjs`、`relay.mjs` | 推送通道**复用**；不另写加密 |
| 5 | **完成后私信买家**的先例：`broker-buy-completion-watcher`（监听 completed → DM；幂等标记 `broker_buy_dm_sent`；经 `broker-action-queue` 单线出链防 UTXO 双花；`_testInjectSendCommand` 测试注入） | `kasia-console/src/services/broker-buy-completion-watcher.js` | **直接照抄形态**：tick + 幂等标记 + 注入式发送 + 单线队列。这是本设计的服务骨架，不新起服务模式 |
| 6 | `relation_states`（`their_alias` 握手时写入、`status` observed/accepted/active、`is_blocked`） | `docs/DATABASE.md` | 推送前查「与该交付地址是否已握手/未拉黑」；**唯一真相源，不另存关系** |
| 7 | relay 握手：`RELAY_HANDSHAKE_AUTO_ACCEPT` 主网默认关（D-027） | `docs/2026-09-20-bettor-relay-handshake-auto-accept-switch-design-v0.1.md` | 决定了**推送不能当必达通道**（§5） |
| 8 | relay `check_utxo_landed`（minDepth）/`get_address_utxos`；`checkout/resolver.mjs` 节点选择 | `kasia-relay/src/lib/p2sh.mjs`、`checkout-static/resolver.mjs` | 卖家侧"到账+分账是否落链"读链用它们。`kaspa_tx_log` **不用**（DATABASE.md 已警示它不完整，且 `from_address` 常为 NULL） |
| 9 | 密文落库先例（`bot_token_encrypted`、`CONSOLE_ENCRYPTION_KEY`） | `docs/DATABASE.md` broker 相关表 | 交付物库存加密存储复用同一机制 |
| 10 | 服务订单（先付款后履约）托管与已知局限（D-034 §9：到期默认偏向一方、无仲裁） | `docs/DECISIONS.md` D-034 §9 | 本设计**不是**服务订单：数字商品"付款即交付"，走即时分账；争议仲裁不在 V1（§8） |
| 11 | 交付状态需要持久化的"订单表" | `docs/DATABASE.md` | **没有**：结账页按 D-034 §8 刻意无状态（"不需要索引器"）。`retail_dex_orders`/`exchange_offers` 是别的业务，状态机不同，**不复用**。⇒ 需要一张**卖家自己的**小表（§4），这是唯一新增存储 |

**结论**：合约、读链、私信、凭据、服务骨架、加密存储**全部复用**；新增的只有：卖家侧一个 tick（照抄 #5）+ 一张交付表 + 一个"凭据取货"只读端点 + 买家页一个"我的订单/取货"入口。

## 2. 要解决的三个事实问题（设计的出发点）

1. **Kaspa 交易没有"付款人地址"**（UTXO 模型；`kaspa_tx_log.from_address` 常为 NULL）。从输入反查需要前序交易，节点无 txindex。⇒ **不能"私信给付款地址"**。
2. **买家用交易所地址付款时，付款地址是托管热钱包**，买家控制不了它，也读不到发给它的私信。
3. **Kasia 私信不是"想发就到"**：发件人需先握手；收件人钱包/relay 需接受（主网 relay 入站握手默认关）。⇒ 私信**不能是必达**通道。

由此：**交付对象必须是订单里买家自己声明的东西，而不是链上推断出来的东西；必达通道必须不依赖对方在线或已握手。**

## 3. 交付触发条件（什么时候才能交付）

状态机（卖家侧，每单一行）：

```
created → paid(≥20 DAA 深度, 金额 ≥ 应付) → split_done(分账落链) → delivered | pickup_ready
          ↘ underpaid / overpaid（沿用 monitor.js 的三态）         ↘ expired（过 deadline 仍未分账）
```

- **交付发生在 `split` 落链之后**，不是到账之后。理由（合约事实 #1）：订单 UTXO 在 `deadline_ms` 前不可 `refund`，但**到期后任何人可触发 `refund` 把钱退回买家的退款地址**；若只凭"到账"就交付，买家可等到期再退款，货和钱都拿走。`split` 一旦落链，订单 UTXO 已不存在、退款路径永久关闭。
- **谁触发 `split`**：卖家侧 watcher 自己在 paid 之后立即构造并广播（`split` 本就任何人可触发，且分账对商家有利），然后等落链确认再交付。买家抢先触发也无妨：watcher 发现订单 UTXO 已被花，改查商家收款地址上是否出现金额吻合的新 UTXO（登记为 `split_done`，该分支的判据强度弱于"自己广播的 txid"，列入 §9 待审）。
- **watcher 离线**：资金留在订单合约里，到 `deadline_ms` 后买家可自行 `refund`；卖家什么也没少、买家什么也没丢 ⇒ 失败安全。
- 付款不足 / 超付：沿用 `monitor.js` 判定，不交付；超付部分按订单合约本身的找零/退款规则，不在本设计里新增。

## 4. 数据与状态（唯一新增存储）

一张卖家侧小表（名字待定，下称 `delivery_orders`；改表前须按铁律读 `DATABASE.md` 并同步更新）：

| 字段 | 说明 |
|---|---|
| `order_address` PK | 订单 covenant 地址（可推导，凭据可重建） |
| `network` / `sku_id` | |
| `delivery_to` | 买家声明的交付地址（可空；见 §6） |
| `state` | 上面状态机 |
| `pay_txid` / `split_txid` | 双锚点（铁律"每笔链上交易必须入库"）；`delivered` 只在对应 tx **落链确认后**写 |
| `deliverable_ref` | 指向库存项，不存明文 |
| `delivered_at` / `dm_txid` | 幂等标记（照抄 `broker_buy_dm_sent` 语义） |

库存表（`delivery_stock`）：`sku_id`、`payload_encrypted`（`CONSOLE_ENCRYPTION_KEY` 同机制）、`assigned_order`（UNIQUE，保证一码一单）。**明文交付物永不进仓库、日志、事件表**；日志只打订单末 8 位 + 状态。

幂等与崩溃：分配库存项与置 `assigned_order` 在**同一条原子 UPDATE**；崩溃后重启同一订单重发**同一个**交付物（绝不二次分配）。

## 5. 通道：主通道自取（pull），可选推送（push）

### 5.1 自取（必达，主通道）
买家在结账页/"我的订单"页提交（或页面本地保存的）**订单凭据**；卖家端点用凭据重建订单地址（照 `order-receipt.js` / `resolve-order-*.js` 现成逻辑），核对 `state ∈ {split_done, delivered, pickup_ready}` 后返回交付物。
- 凭据即承载凭证：持有 `orderNonce` 才能重建地址，**无需买家身份、无需账号、无需握手、无需在线时机**；买家用交易所付款也成立（凭据是在出单时由页面生成并让买家保存的）。
- 端点只读、限速、按订单地址维度计次；响应不缓存。
- 与现有"凭据救援退款"同一信任模型（凭据 = 持有人凭证），不引入新的凭证类型。

### 5.2 私信推送（可选，非必达）
订单创建时买家可填「交付地址」（Kasia 可用的 Schnorr 地址）。split_done 后，watcher 经 `broker-action-queue` 单线队列发 `send_message`（复用 #5）。
- 发送前查 `relation_states`：未握手 ⇒ **不静默失败**：状态记 `pickup_ready`，页面提示改用自取；不由 watcher 擅自发起握手（握手要付 `KASIA_MIN_AMOUNT`，且主网入站握手默认关，属运营决策）。
- DM 内容 = **取货提示 + 交付物**二选一由商家配置；默认只发「订单末 8 位 + 取货页链接」，**不把激活码放进私信**（私信在对方钱包里长期留存）。
- `delivered` 仅在 DM 交易落链确认后写；`DAILY_SEND_LIMIT` 命中 ⇒ 状态保持 `pickup_ready`，下个 tick 重试，不丢单。
- relay 对相同内容的重复发送有 30 分钟去重（既有记忆：dedup 记失败发送会致重试死锁）⇒ 消息必须带订单末 8 位 + 序号，保证重试不是"相同内容"。

## 6. 「交付地址」怎么绑定到订单（防止被人改去向）

问题：若交付地址只是商家库里一个可被改的字段，知道订单的第三方可能诱使商家把货发到别处。

**方案 A（商家发号模式，推荐先做）**：商家服务端生成 `orderNonce` 并**在出单那一刻**把买家的交付地址写入 `delivery_orders`；买家身份由出单会话保证，之后无人能改。无需改任何订单推导规则。
**方案 B（纯静态页模式，三条验收之③"无服务器"）**：把交付地址并入 nonce 推导——`orderNonce = H(buyer_secret(16B) ‖ delivery_to)[0:16]`，凭据同时保存 `buyer_secret` 与 `delivery_to`。交付地址一变，订单地址随之变，页面/卖家重建比对即拒。**不改合约**（nonce 槽位已存在），但改的是"订单地址由什么推导"——属用户面规则变更，**必须 Owner 批 + NWT 审**，故不作为 V1 默认。

V1 建议只做 A + 自取（5.1）；B 与推送一起放 V1.1。

## 7. 买家用交易所地址付款 / 收不到私信怎么办（Bettor 点名要写清）

| 情形 | 行为 |
|---|---|
| 买家从交易所提币付款 | 付款地址 = 交易所热钱包，**设计从不使用付款地址**。买家在下单时拿到凭据（页面强提示"保存凭据，是取货与退款的唯一凭证"），用凭据自取。交付地址可空 |
| 买家没有 Kasia 钱包 / 没握手 / 对方不收私信 | 推送不发、状态 `pickup_ready`，页面与凭据页都显示"到账已确认，请用凭据取货"。**取货不依赖任何通道** |
| 买家丢了凭据 | 与退款同一后果：无凭据无法证明订单身份。商家侧**可**凭 `order_address`（买家能从自己钱包交易记录里找到收款地址）在商家后台人工核对并重发——人工通道，不进自动路径 |
| 买家想把货发给别人 | 凭据可转交（持有人凭证）；这是特性，不是漏洞，页面文案要写明 |
| 商家离线 | §3：资金不动，到期可退；买家不亏 |

## 8. 明确不做（V1 边界）

- 不做争议仲裁、不做"货不对板"退款（D-034 §9 已知局限；开放外部用户前须另补仲裁，沿用该条）。
- 不从链上反推付款人；不抓付款地址发私信。
- 不自动发起握手；不存买家邮箱/手机等 PII。
- 不新造凭证、加密、托管或服务框架（§1 全复用）。
- 不改订单合约（方案 B 也不改合约，只改页面推导，且非 V1）。

## 9. 风险与待审点（请 Bettor/NWT 重点打）

1. **买家抢先 `split` 的判据**（§3）：以"订单 UTXO 已不存在 + 商家地址出现金额吻合的新 UTXO"判 `split_done`，强度弱于自己广播的 txid；请评是否改为"只在自己广播成功才交付，抢先者场景走人工"。
2. **取货端点的凭据重放/枚举**：限速足够？是否需要一次性取货令牌（取一次作废、可由商家重置）。
3. **交付物一次可取多次**：默认允许重复取（买家丢页面不亏），商家可配"仅一次"。
4. **私信里是否允许放激活码**（§5.2 默认不放）。
5. **方案 B 的 Owner 批准**：用户面订单推导规则变更。
6. **Kasia 无握手收件**：本稿对"未握手能否解密"**未实测**（只读代码得出"需别名"）；推送实现前须在 simnet 做一次实证，结果决定 5.2 的提示文案。
7. 库存"一码一单"在并发下的原子性（单条 UPDATE…WHERE assigned_order IS NULL）需有并发测试。

## 10. 测试清单（实现时）

单测（注入式，零链）：状态机全转移；`split_done` 之前绝不分配库存；崩溃重启同单重发同物；DM 失败⇒`pickup_ready` 不丢单；`delivered` 仅在落链后写；未握手⇒不发且不抛；日志/事件无明文交付物（扫描断言）；凭据篡改任一字段⇒取货拒；金额不足/超付⇒不交付。变异：去掉"split 之后才交付"判断 / 去掉原子分配 ⇒ 对应测试变红。
simnet 端到端：建订单→付款→watcher 触发 `split`→落链→交付；**watcher 中途杀掉**⇒资金留在订单、到期 `refund` 成功；买家抢先 `split`；DM 推送（含未握手、握手后两种）；交易所式付款（付款地址≠凭据里任何地址）仍可取货。

## 11. 工作量（估）

| 项 | 估时 |
|---|---|
| 交付表 + 库存表 + 迁移 + `DATABASE.md` | 0.5 天 |
| 卖家侧 watcher（照抄 #5）+ 状态机 + 单测 | 1–1.5 天 |
| 取货端点 + 买家页"我的订单/取货"（用户面，须 Owner 批） | 1 天 |
| 推送通道（复用 send_message）+ 握手/限额/重试 | 0.5–1 天 |
| simnet 端到端 | 1 天 |
| **合计** | **≈4–5 天**；V1 只做方案 A + 自取，可砍到 ≈3 天 |

## 12. 待 Bettor 定（默认值已给）

| # | 问题 | 默认 |
|---|---|---|
| 1 | V1 范围 | 方案 A + 自取；推送与方案 B 放 V1.1 |
| 2 | 交付物放哪 | 卖家侧加密库存表（§4） |
| 3 | `split` 谁触发 | 卖家 watcher；抢先者场景见 §9-1 |
| 4 | 私信是否放激活码 | 否，只放取货提示 |
| 5 | 实现归属 | 实现前先问清：商家侧服务是 console 内服务，还是随结账页 SDK 独立发布（影响"第三方独立部署"验收） |
