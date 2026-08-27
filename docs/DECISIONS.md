# KANet 决策日志 (DECISIONS.md) — 单一真值·防"炒陈饭"

> **为什么有这份**: Owner 2026-07-06 点出根因——"碎片化决策，老文档老决策早作废但没删没标，隔段时间又翻出来炒陈饭"。今晚 ZK/covenant 混乱就是 6/30 ZK 文档从没标"已被取代"、被翻出来当现行计划。
> **本文是"当前有效决策"的唯一权威索引。任何设计文档与本文冲突，以本文为准；老文档必须按下方机制标状态。**

---

## 📋 文档生命周期机制 (强制·不靠自觉)

**每份 `docs/YYYY-MM-DD-*.md` 设计/决策文档,顶部必须有状态头:**

```
> **Status**: CURRENT | SUPERSEDED-by <doc>(date) | ARCHIVED
```

- **CURRENT** = 当前有效,可据此决策/实现
- **SUPERSEDED-by X(date)** = 已被 X 取代,仅存档,**勿据此决策**。顶部再加醒目横幅:
  `> ⚠️ 本文档已被 [X] 取代于 [日期]·仅历史存档·勿据此决策实现`
- **ARCHIVED** = 历史记录(复盘/调查),非可执行计划

**卡点(TODO 落 lint-kanet)**: `docs/YYYY-MM-DD-*.md` 无 Status 头 → commit 亮灯。

---

## 🔴 当前有效的战略决策 (CURRENT)

### D-013 Owner 三决 (2026-08-27 · Owner 原话「§10 GO，B_adv 只定语义不钉数，watchdog v0.3 批」· Bettor 记账)
> 出处: COORD-LEDGER (695)。Owner 待决原为四件（gate-status v3 `docs/2026-08-27-nwt-s63-gate-status-refresh-v3.md` §三决 + `B_adv` 决策对象 719cab73/523a07f9）；本条记其中三件，**§6-1 ⑥ 是否放宽 (527) 仍待 Owner**。
1. **§10 跨节点 pubkey 身份 v1 = GO（开工）**。依据 = 设计 `docs/2026-08-19-s10-pubkey-identity-design.md`@847bcf22（Codex MSG-250 五项 CLOSED，register-only）+ 实施计划 `docs/2026-08-27-j2-s10-impl-plan-v0.1.md` v0.2 = 70761d33（NWT 深审 PASS-WITH-NOTES e128a735）。**范围铁律**：v1 只做 `operation="register"`；rotate/revoke/旧记录迁移不含；不做自动签发口；**不部署对外、不动 Owner 实例 §0 墙（D-012 §0 Track A 七铁律）**；不改 A2 六字段语义（S10 独立信封）。流程：J2 落码（pathspec commit 不推）→ 每 commit NWT diff 审 → Bettor 推 → Codex 桥审 → **上线 = D-005 独立迁移由 Owner 另拍**。
2. **`B_adv`（对手预算）= 只定语义、不钉硬数**。语义（Codex 280/281/283 口径）：`B_adv` 为保护窗内**缺席于窗均值可见估计**的全部对手容量/工作之上界，单位算力，**单一预算**同喂份额 cap 与 `k_max`（`H_hidden_ub = H_adv_add = B_adv`，拆开须 Owner 论证 + 守卫 `H_hidden_ub ≥ H_adv_add`）；不具名 ⇒ 自持路与 (a-total) 皆不出 cap ⇒ Tier-2 fail-closed（= 现网安全现状）；**复核触发（机械）**：(a) (24) `s_visible_max` 提取器在采样窗内见第二个 coinbase 归属地址 ≥ 100 块；(b) Tier-2 真 build。硬值等实测基线再议。
3. **watchdog SYNCING 三态落码计划 v0.3（48d025f6）= 批**。按计划：三态（ALIVE/SYNCING/DEAD）替代"daa=0 判死"；刹车 N=5/T=5 min/冷却 30 min（沿 `scripts/kanet-console-supervisor.sh:30-32`）不得被恢复动作自身 reset；(PID,CreationDate) 元组判自重启；显式退出码 7/8/9；VA-1…9 向量。**启用条件不变**：本机节点 READY（`isSynced ∧ daa > 80,095,687`）+ VA 全过 + NWT diff GREEN；IBD 期只落码不启用（`KANet-KaspadWatchdog` 任务保持 Disabled）。

### D-012 KANet 总纲 reframe — Agent 应用与角色经济;Oracle Skill 抽象立项;Broker 开放入口属 Track B (2026-08-03 · Owner 提出 · 四镜头对抗轮收敛 · **Owner 终裁通过**)
> 全过程档案: `docs/2026-08-03-d012-kanet-agent-app-reframe-draft.md`(含四镜头原始产出与本条起草史)· COORD-LEDGER (121)(125)(131) · Owner 审查四点修正见 §0/§4/§5。

#### §0 🔴 Track 边界(本条最硬约束,先于一切正文;违反即本条被误用)
- 角色开放(Broker/Maker/Oracle Adapter/Verifier/界面)是**协议层承诺 = Track B**: testnet-only、MIT 开源、任何第三方可自行 fork 部署并自担。
- **Owner 实例(Track A)不因本条获得任何开放外部用户的授权。** Track A 七铁律原样有效、不被本条放松任何一条: `0 外部用户 / 0 商业化 / 0 fee / 0 token / 0 数据外晒 / 0 mainnet operational claim / 0 第三方 host`(权威源 KB `00-position/carrier-thesis.md`,`northstar-open-collaboration-protocol.md:42` 镜像)。
- **⇒ §3「六道墙」不是待拆清单。** Track A 语境下其中数道**正是该留的墙**(尤其「无对外网络路径可达注册端点」与「onboard 路由已被 P0 移出白名单」——它们今天承担着 `0 外部用户` 的实际执行)。拆墙只发生在 Track B 的协议实现与 fork 部署者语境;针对 Owner 实例开放外部注册需**独立于本条的 Owner 授权**,本条不构成依据。
- 判据: **引用 D-012 支持「让外部人来注册」之前,先回答「这发生在哪条 Track」。答不出 = 不得据本条行动。**

#### §1 总纲
> **KANet 是一个正在运行的 Agent 应用: Broker 找到并组织需求,Maker 提供价值,Oracle Skill 把结果转成可验证条件,Kaspa 按事前规则结算和分账。** Prediction 与 Exchange 是同一骨架(被锁价值→结算条件→链上结果)的两个已运行场景。下一步不是与别的应用拼技术,而是把现有能力模块化。
- 取代 (115) 的卖方框架: 外部接入的正确问法是「**愿意扮演什么经济角色**」,不是「为什么购买我们的技术」。
- 范围限定: 角色清单是**外部接入者的可选角色**,非系统内经济行为穷尽分类(内部反例: market-seeder 自造需求自供流动性)。

#### §2 「条件放钱」三段作用域(按子集论,不按产品线论)
| 子集 | 现状 | 依据 |
|---|---|---|
| ① v0.7 ZK-native | **成立,且三权已天然分离** | ZK settle 落链(D-001)+claim merkle-binding;**放款路径零签名**——`CloseZkV2.sil` 全文零 checkSig,claim/escape_claim 靠 merkle proof+nullifier,payout 树由 `zk_close` 的 groth16 门(gateTmplHash 烤死)写入 |
| ② v0.5/v0.6 committee-sig(**当前 live 主力**) | **不享受①的背书** | oracle 私钥亲签放钱 TX(`relay.mjs:711`,作用域仅 v0.5/v0.6,见 §2-bis)+签名前零前提复核(`handlePoolOracleTxSignReq`)+PB-S8 牙已造未装此路 |
| ③ Exchange | **不成立,争议裁决角色结构性空缺** | escrow checkSig 9/4/1、hash 0/0/0(带阴性对照);跨链非原子;resolve=concede-only(`exchange.js:747-796`),双方不认输即无路径可达终态 |
- **「没有人拥有临时裁量权」= 目标不变量,非现状**。达成判据=自治 daemon 真落+红队过,才准改口。
- oracle 今天在子集②**四权合一**(报告+解释合一/私钥签放钱/自有 bond 在险/从池收 reward)= Oracle Skill 边界冻结的切割对象。

##### §2-bis v0.7 三权对照(J1 2026-08-03 补课卡,§6-1 前置卡已闭)
| 权 | v0.7 实现 | 签名 |
|---|---|---|
| 报告事实(winner) | `PayoutShardV2.close_attest`(:99-105 `require(validSigs>=4)`) | **4-of-5 委员签在此**;该笔 TX `:180 require(outputs[selfOutIdx].value == consolidated_pool)` = **守恒不动钱**,closed 0→1 只记事实 |
| 规则解释(winner+bets→payout 树) | `CloseZkV2.zk_close` groth16 ZK 证 | 无签 |
| Covenant 放钱(payout 树→winner P2PK) | `CloseZkV2.claim` 纯 covenant merkle+nullifier | 无签 |
- ⇒ **v0.7 里委员签名权已精确收窄到「事实证言」这一权**,与放钱、与规则解释分离干净——**这正是 §6-1 要冻结的边界的已存在实例**;live-wired 非 design-only(`bshard-close-voter.js` W2 自治-enforce;`p2sh.mjs:1969`;pxvml 2026-07-08 实战撞过门①)。
- 🔴 作用域自纠(J1 主动): 「oracle 私钥亲自签放钱 TX」对 v0.5/v0.6 成立、**对 v0.7 不成立**——v0.7 走 `sign_input_for_settle` 的那笔是 `close_attest_v2`(attest 类、守恒、不放钱)。**ZK-native 路上「委员签放钱」不成立,委员只签 winner。**
- 🔴🔴 **作用域补注(2026-08-03 16:2xZ · Codex 独立审 bridge `16b71707` 打中 · Bettor 认并记账 · 不改上方 Owner 终裁原文)**: 上表「守恒不动钱」**说满了**。`require(outputs[selfOutIdx].value == consolidated_pool)` 只证**那一个 covenant 输出自身守恒**;而 **SIGHASH_ALL 签名承诺的是整笔序列化交易**——同一笔中仍可含**他方控制的额外输入 / 搬走无关价值的额外输出 / 被改的 fee 与 change**。⇒ **自输出守恒 clamp 本身不能证明「该签名挪不动别的钱」。**
  - **可用措辞(照 Codex 原意)**: 「**被引用的 covenant 在那几个 entry 上强制其自身 consolidated-pool 输出守恒**」;**禁止**写成「委员签名不动钱」或据此把 v0.7 当「三权已分离」的**通用先例**。
  - **该先例要成立的前置**: 需给出**完整交易形状约束 + sighash 域分析**(今天没有)。
  - **正路(Codex 给的目标形态,并入 §6-1)**: oracle 应签**域分隔的 FactReceipt / OutcomeAttestation** 对象——绑定协议版本/网络/市场身份/结果命名空间/证据承诺/有效期/oracle 身份/防重放序号,**对象内不含任何交易输入输出、地址、金额、fee、change**;covenant 独立消费该 receipt 校验交易授权;持钥方拒绝一切不匹配该 typed schema + 域分隔符的请求。**若要保持「payout 变化不改变 P1 字节」这个不变量,receipt 内不得含交易摘要。**
  - **🔴 冻结前置补充(2026-08-03 17:2xZ · Codex 第三轮 bridge `83db3897`)**——三条正文级要求,与下方 6 条并列:
    - **P1 attestation 对象不得只是 `(market_id, outcome)`(太小、可重放)**: 须绑**协议/域标签 + receipt schema 版本 / 网络与 genesis / 市场身份与确切状态版本 / 结果命名空间与编码版本 / 证据摘要或规范观测锚 / committee epoch 与集合标识与签名者身份 / 序号 nonce 与过期锚 / 更正的 supersedes 语义 / P2 期望的策略解释版本**。缺则**旧的但仍有效的 attestation 可在策略或状态变更后被重放、拿到别的网络用、或按另一套 payout 政策被解释**。
    - **P2 仅"纯函数确定性"不足**: 两节点确定性一致 ≠ 用了**同一个完整输入集**。P2 须消费并承诺**规范输入集对象**(前态 outpoint/版本、每笔注的 outpoint/txid + 地址承诺 + 方向 + 金额、确定性去重与排序、政策/费/bond/dust/change 版本、输入集 merkle root、payout-root 与总额记账)。🔴 **证明不了该输入集的参与者必须 `verifier-inconclusive`、不产生任何授权,且【不得回落到候选 B 去签名】。**
    - **"P3 零 checkSig"不是完整授权证明**: 只证该路不直接依赖签名;不证前态正确 / P2 承诺来自规范完整注单集 / 每个 payout 输出绑到已承诺 root / 备用 selector 入口绕不过承诺 / fee-change-dust 与网络版本绑定完整。⇒ **P3 验收须定义为「对确切 P2 承诺 + 确切被消费前态 + 序列化交易语义的验证」,不是「没有 checkSig」。**
    - **PB-S8-2 候选 B 硬边界(Codex 二次确认并加强)**: `get_address_utxos` 快照是**查询节点的当前未花视图**,**证明不了被签交易的规范前态**(构造→查询→签名之间输入可能已被花/被替换;合法输入可能不在快照;新增输入可能属另一类地址;同地址 UTXO 可能属旧状态实例;节点滞后造成假缺失/假存在)。⇒ `inputsAllMatched` + `Σoutputs ≤ Σ当前地址UTXO` **不能确立市场成员资格、前态身份或 payout 正确性;只能作便宜的拒绝信号,永远不得升格为签名授权条件。**
    - **卡② dirty-row 用例的可接受断言(Codex 逐字,照抄)**: 「**在被测的 SQLite/运行时配置下,真实 handler 会跳过较早的坏 payload、够到较晚的匹配合法投票,并产生一次签名调用。**」仍未关闭七项: DB 异常与重试分类 / 重复同结果行 / 结果冲突(equivocation)/ 同序并列与规范链上排序 / 陈旧或重放的投票回执 / winner 对但 `phase2_tx_obj` 被篡改 / **自动纳入常规回归 runner**。⚠ **「可执行」不得报成「持续覆盖」。**
    - 通则(Codex 原话要义,收进纪律): **文档改名不授权 schema、资格集合或部署变更。**
  - **🔴 冻结前置(6 条,齐了才准以「授权边界」名义冻结;在此之前可继续以 design 推进)**: ①typed attestation schema + 域分隔摘要 ②证明 oracle 角色**够不到**通用交易签名入口 ③v0.7 完整交易形状 + sighash 分析 ④handler 级测试: RPC 错 / 缺输入 / 多输入 / 陈旧 outpoint / 坏金额 / 超量输出 / payout 篡改 **各自零签名调用** ⑤**一条证明「验证中断不会把市场路由进自动退款」的测试** ⑥候选 A 的规范输入集/输出集重算与绑定设计。
  - **🔴 同轮采纳为状态机不变量(Codex 升格 Bettor 的威胁模型)**: `验证不可用 → 验证者 inconclusive → 不签名,且不产生任何自动退款授权`。**deadline 到期不得把「缺证据」变成「执行另一条不可逆钱路的许可」**;退款转移必须**另行授权、另行证明**。这是不变量,不是只有计数器与告警。
  - **PB-S8-2 候选 B 定性(Codex 确认我方自我收窄措辞正确,keep)**: 它是**预筛不是授权边界**——不能证明收款人集合/各自金额/费用分配/排序/漏项/状态版本/payout 树正确性。**B 检查通过不得被表述为「可以安全签名」。**

#### §3 Broker: 目标与现状分写(现状均属 Track A 实况陈述)
- **目标不变量(Track B)**: 不保管资金/不裁结果/身份=Kaspa 地址/佣金链上直分。
- **现状(2026-08-03 实读)**: ①无对外网络路径可达注册端点(console 绑 127.0.0.1;网关 fail-closed;onboard 路由因身份劫持洞被 P0 主动移出白名单)②地址所有权零验证(全仓无签名挑战)⇒「身份=Kaspa 地址」今天是文案不是代码 ③`broker_onboarding` 与决定佣金的 `pool_markets.broker_relay_id` 零桥接 ④唯一接得到佣金机制的路要求交助记词/裸私钥托管——**现存唯一 Broker 实例即 Owner 自己的托管钱包** ⑤retail-DEX 执行进程单租户 ⑥种子盘/世界杯盘默认写死 broker-1。
- 口径: broker v1/v2/v3 哪个活随部署 flag 漂移,引用需带配置态。
- 实的那半: `computeMarketBrokerFee` 从 settle tx 链上 outputs 读、零人工审批(fw9kk 已实证),但位于全部六道墙之后。

#### §4 🔴 量级诚实标注(H0,防「转向问法」被读成「需求已证明」)
- **今天角色生态实例数: Broker = 1(Owner 自己的托管钱包);外部角色 = 0;外部 Broker 注册数 = 0。**
- 「WooCommerce 插件可以来当 Broker」是**未检验假设(H0),不是已发生事件**。换问法消掉的是 (115) 的**问法**,消不掉它核实过的**事实**。
- **可证伪判据(预注册,归 Track B)**: 在 Track B 实现里,当①地址所有权签名挑战落地且②onboard 路由在某 fork 部署者实例上可达之后的 90 天窗口内,出现 **≥1 个非 Owner 控制的 Broker 完成注册并取得至少一笔链上可验佣金** ⇒ H0 LAND;窗口内为 0 ⇒ H0 未被支持,需重审 §1 需求侧假设。**本条不为该 KPI 背书,只登记它可被证伪。**
- 同族纪律: Prediction+Exchange 有共同结构 ≠ Economic Kernel 已证;Skill 接口冻结后须用**第三个异质应用**验证低 Diff 复用才可升格。

#### §5 支撑事实的证据层级(NO TX NO TRUTH)
| 事实 | 层级 |
|---|---|
| r402(producer 退款前复核)双机部署 | **[DEPLOYED-VERIFIED]** 两机装载 commit 实读(`d23539d0` 后代);非链上行为证据 |
| r402 的保护**效果** | **[SUSPECTED·未实弹]** 无 cross-node 冲突流量触发;rejected_v1 无自动化覆盖 |
| PB-S8-1(委员签名前投票自检)部署 | **[DEPLOYED-VERIFIED]** 装载 commit 实读 |
| PB-S8-1 的保护**效果**(拜占庭 winner 检查) | **[TESTED-VERIFIED·未实弹]**(2026-08-03 16:0x 升格)——依据 **J1 代审注入实验**: 注掉检查本身 ⇒ 对应用例转红;且"正常票签一次"作阳性对照证明 mock 够得到 `sign_input_for_settle`,故三条"零签名"断言非空断言。⚠ **红队缺位,待 NWT 补核,不得写成"已过红队"**;"生产真挡下过一次"那格**仍空**。 |
| 卡①`json_valid` 守卫的**测试锁定** | ✅ **已锁定(2026-08-04 升格·两次独立注入)** —— ①J2(作者)按 MUST-FIX 补「同市场脏行排在合法行之前」用例(`05b645c4`)并自跑注入验证;②NWT 红队独立重放(2026-08-04 频道报告): 删 `AND json_valid(payload)` ⇒ 2/6 转红,**名字写着守卫的那条红在它自己身上**;correct-vote 连坐与 J1 原始注入记录一致=在案已知现象非新耦合;恢复后 REVERTED-CLEAN 6/6 绿。⚠ **证据如实标**: NWT 该轮无落盘 artifact(`test:pbs8-handler` 不自动写证据,`logs/test-runs/` 最新 pbs8 log 停在 8/3 07:56Z),依据=频道报告+与作者侧注入结果吻合。**历史(2026-08-03 坐实旧套件锁不住的经过)见本行 git 前版,教训仍有效: 测试卫生重构可静默删守卫。** |
| 🔴 **PB-S8-1 的覆盖范围(2026-08-03 15:2xZ 补注,Bettor grep 实查)** | **仅覆盖【消息驱动的跨节点委员签名路】`handlePoolOracleTxSignReq`;不覆盖 driver-enforce 的 bshard 结算路**——`bshard-auto-settler.mjs:378/845` 直接 `relayPost({type:'sign_input_for_settle'})`,同文件 grep `byzantine|myVoteRow` **0 命中**;relay 该原语对内容零校验(M-1.1 B 类盲签)。⚠ **措辞纪律: 不许写成"委员签名前会先查自己的票"**,必须带路径限定。合 J1 §4.4(c)(自治 enforce voter 默认 OFF、理由 `D4 relay-gate 未闭`;真正退化的是**同机持 ≥4 委员 relay 的节点**,而**本机拓扑正是**——11 relay 含 4 oracle)⇒ **在本机,4-of-5 对 driver 不构成约束,一个 driver 进程可取得全部 4 个签名且中间零独立检查**。缺陷本身早登记(D4),新的是这两句的合取。修法归 §6-1 Oracle Skill 冻结线(**gate 应在持钥的 relay 侧,不在可绕的 driver 侧**),不单独打补丁。 |
| ①v0.7 ZK-native 条件放钱成立 | **[CONFIRMED·链上]** ZK settle 交易 landed(D-001,NWT 独立核实) |
| ②③ 各条现状 | **[CONFIRMED·源码实读]** 带 file:line,四镜头交叉核 |
- 口径要求: 正文任何「已修/已补」表述**一律带层级**;**未实弹的保护不得被表述为「已生效」**。

#### §6 执行序(Bettor 排班驱动;各项不改变 §0 边界)
> 🔴 **术语消歧(2026-08-03 16:0xZ Bettor 裁定 · J1 提出 · 今日「一名多物」第四例)**: 本条 §6-1 的「**Oracle Skill 接口**」= **一个角色的权限边界契约**(报告事实/解释规则/放钱三权怎么切);而 roadmap 契约 v1 明确排除的「**Role/Skill directory**」= **网络对象的注册与发现层**。**两者不是一回事,只读到其中一份的人会读混。** ⇒ **本条已 Owner 终裁,术语不改;但今后所有引用一律写全称「Oracle 权限边界契约(D-012 §6-1)」,禁止单用 "Skill" 二字指代任一方。**
> 🔴 **`is_oracle` 命名坍缩裁定(同轮)**: 契约词汇表采 **A 的目标词汇**——T2 那套(准入/质押/抽样/attest 签名)一律称 **committee 成员**;**"Oracle" 在契约中只指对链外事实作声明的角色(T3,今唯一实例 = UMA hook)**。不采 B(接受坍缩+加脚注),因为 **B 把 T3 那格封掉,而契约不能没有词去指称它自己要约束的东西**。**代码今天不改名**,冻结稿配映射表 `is_oracle=1(现存列) ≡ 契约中的 committee 成员资格` + 标已知不一致。🔴 **迁移是钱路改动不是重命名**——`trade-protocol-filter.js:578-580` 按 `WHERE is_oracle=1` 选本机哪些身份参与签名,**该列决定"谁能签"**;迁移方案须先答「双读双写过渡还是原子切 / 过渡期资格集合由谁定义」,**否则切换期某 relay 签名资格会静默翻转(少一人签卡结算、多一人签虚化门槛,两者都不报错)**。

1. **Oracle Skill 接口与权限边界冻结**(设计先行,第一优先): 三权分立烤进接口签名——Oracle 报告事实/规则解释事实/Covenant 放钱,Oracle 结构上够不到资金路径。主笔 J1 × 审 J2 → NWT 红队 → 冻结。**前置补课卡 ✅ 已闭(见 §2-bis)**: v0.7 已是三权分离既存实例,「Covenant 放钱」格天然满足;**需新造的是「规则解释」层且只对子集②**——冻结工作 = 把 §2-bis 那个形状推广成接口契约并覆盖子集②,**不是从零发明**。
2. **在册候选卡(非阻塞,均不涉 §0 开放动作)**: PB-S8-2(payout 字节绑定,Codex 定性「live 放钱路径剩下的 authorization-to-bytes 绑定」,优先级上调)· 投票查询规范键查(与计票原子改)· PB-S8-1 真 handler 回归 · consumer 侧自知之明闸 · 告警 episode 语义 · 跨节点消息发送者绑定 · committee 抽样 liveness 门。
3. **Exchange 裁决角色**: 作为 Oracle Skill 接口冻结后的**第一个复用验证对象**(起点=从零造裁决角色,非接现成接口);Codex 建议的 fair-exchange 设计卡在此处使用。
4. **Broker 线**: 仅在 Track B 语境推进(地址所有权签名挑战为第一块砖);**Track A 实例的对外开放不在本条授权范围内**(见 §0)。

#### §7 supersedes / 文档处置
- `docs/2026-07-31-why-integrate-kanet-adversarial-conclusion.md`(115): 状态头改 `SUPERSEDED-by D-012`(**叙事层**);§二判别式与 §四实核事实等**经核实条目仍有效,引用需带作用域**,状态头逐条列存活项。
- Codex review(`RESPONSE-20260731-UNSYNCED-…`): 不推翻;三条打回转为 Oracle Skill 边界设计约束;fair-exchange 设计卡重定位到 §6-3。
- (115) §7.1(「无签字 escrow 立不立格」)被 §6-1/3 吸收,不再单独待拍。

> 📌 **状态注记(2026-08-07 · Owner 终端两裁 · Bettor 记账;不改上方正文)**:
> ① **②-a U1 选路已裁**: 路-隔离优先,路-收权后置作纵深,不并行;scoping 批(KANet-UI 主笔×J1/J2 供两侧×NWT 审,本周交代价清单+败方回退成本栏后 Owner 终拍施工)。⚠ 防说满(J1,Owner 点名): 隔离只兑现前置② 的 threshold 维度,§4.1 持钥侧类型闸是并列第二必达项;②-b 证明本体由新卡 `PRECOND2B-UNREACHABILITY-PROOF` 承载(主笔 J1×审 J2×验收 NWT)。
> ② **Broker 立场冲突已裁「不冲突,作用域不同」**: `docs/2026-07-26-broker-onboard-identity-design.md` §四 的 Owner 否决**作用域 = Track A Owner 实例**(在该语境不但正确而且正是该留的墙);本条 §6-4 的"第一块砖"**作用域 = Track B 协议实现**,不受该否决约束。**两文档存活,零回改**——这是 §0 那条判据句(「引用 D-012 前先答哪条 Track」)的第一次实战,且是反方向用。**今后引用任一方必须带 Track 作用域**;07-26 文档的作用域状态注记归 KANet-UI 补。
> 出处: Owner 终端 2026-08-07 06:37Z · COORD-LEDGER (140)BBh/BBi · `docs/2026-08-07-d012-completion-timetable-v2.md`(时间表权威版)。

> 📌 **状态注记(2026-08-16 · NWT 读 COORD-LEDGER 实核 · 不改上方正文)**:
> 🔴 **本文件此前对九条冻结前置的最新记录停在 08-07(线 6995 附近"一条闭,八条未闭"),已陈 4-5 天** —— 实况经 COORD-LEDGER 逐条核实(非转述):
> - **(144) 2026-08-10 09:2xZ**: 九格当天全部激活且全部有实交付。
> - **(152)(153)(154) 2026-08-11**: ③(D2 委员闸多重性+数值绑定)由 **NWT 亲手复审 PASS**(过程含一次自我退判为 CONDITIONAL,抓出 V2 覆盖洞,J2 补齐后终审 PASS);08-11 10:4xZ 窗#5 装载后 **NWT 独立 SELECT 实查确认 live 生效** —— **九格 committed→live 全绿**。
> - **(169) 2026-08-12**: 剩余的 ②-a 结构改造设计侧也全闭,NWT 队列③ PASS,可进落码。
> ⇒ **九条冻结前置已于 08-11/08-12 全部闭合(非 08-07 状态)。** 冻结实剩两件、均不在 NWT 域: ①**J2 落码** A2(②-a 同源判定 checker 实现,设计已 PASS,只差写码)②**Owner 域资源**(隔离宿主物理机采购到位)。
> 🔴 **本注记未验证的部分(如实标)**: 08-12 之后(COORD-LEDGER 全文查无 08-12 后的 A2/②-a/契约冻结相关条目,团队转向 canary#2 与链停摆)——**A2 是否已落码、物理机是否已到位、契约是否已正式以"授权边界"名义冻结,均未见记录,状态未知**,需向 @Bettor / @J2 核实现状,不代表"已冻结"。
> 出处: `docs/iteration/COORD-LEDGER.md` 行 365-368/453-536(条目 (144)(148)-(155)(169))。

> 📌 **状态注记(2026-08-16 · §6-1 契约【定义】冻结【达成】· Bettor 注册, J1 (340) 路由;不改上方正文)**:
> 🏆 **D-012 §6-1 Oracle 权限边界契约【定义】冻结于 2026-08-16 达成, 三方现跑地面核确认**: Bettor 验落(A2 行为验证16用例/10变异 + 全231行代码审查 + 洞①自跑验收)· KANet-UI 红队(A2 落码实现洞审 PASS-with-notes)· J2 域主放行(五测试套全绿/三变异套 detected 10/12/8 全0 MISSED/V1-V9+V14-V18 逐格覆盖/V5 全量重复址=0/499行零stub)。冻结稿 `docs/2026-08-03-oracle-skill-interface-permission-boundary-freeze-design.md` 已标 **DEFINITION-FROZEN**(J1 主笔 (340) 联署)。CP4 §4 按 (233) park 移 ZK 主线(非阻塞)。
> 🔴 **口径分层(不 overclaim)**:【定义冻结】= 契约文本 + A2 全链判定逻辑技术就绪, **已达成**。**【契约上线/生效】仍隔离, 未达成** —— 硬前置 = **Owner 物理机(②密钥隔离验收, 08-07 directive: 批 scoping≠批施工)** + 留档三项接入(registerIdentity 零生产调用方 / payoutshard :1824 默认回落不对称 / u1-escape-hatch-live-check.cjs 未实现 §5-6 加严分母纪律), 均在定义冻结**之后**。
> 出处: COORD-LEDGER (336)(337)(338)(340) · 冻结稿 Status 行(f234fb44/f1cdad1f)。

> 📌 **状态注记(2026-08-17 · §6-1 定义冻结【真·all-review-passed】· Bettor 注册 · 纠正上条 08-16「达成」为过早)**:
> 🔴 **上条 08-16「定义冻结达成/三方地面核」是【过早声明】**: 三方 PASS ≠ all-review-passed。其后 Codex 逐级红队(每级给出具体攻击路径)在 08-16→08-17 又挖出 **7 级**权威 seam, 均 FIX-not-rescope 结构修复并经四方对抗 + Codex 复核。上条【定义 vs 上线】口径分层仍成立, 但「达成」的**日期与判据**以本条为准。
> 🏆 **真·闭合: 2026-08-17 Codex 正式 PROMOTE(桥 `65ee6818` / RESPONSE-...-FINAL-DEFINITION-FREEZE)**——**§6-1 Oracle 权限边界契约【定义】冻结 = ALL-REVIEW-PASSED, 锁定不可变 target `154291d8d89adf8966d538e55ade78eb2ef2eec5`**(Codex 基于独立代码/测试制品复读, 非仅四方转述)。
> **九级权威阶梯全结构闭合**(生产路径): ①挑战一次性 CAS(`WHERE used_at IS NULL`)②同 sqlite 事务域(WeakMap 绑 handle + IMMEDIATE 事务)③签发/过期权威(生产不收调用方挑战记录, 重读 canonical store, 事务内重检过期)④时钟(生产钉 `Date.now()`, 注入仅 test-only 入口)⑤PoP 验证器(生产落真 kaspa-wasm verifyMessage, 无调用方可选)⑥canonical 挑战 namespace(钉 `CANONICAL_CHALLENGE_TABLE`, 绑定验 handle∧表身份, `expectedTable` 必填不可静默消失)⑦持有 token 方法替换(返回冻结无方法 opaque token)⑧可执行能力泄漏(删 exported `getBoundOps`; `readBoundChallenge/consumeBoundChallenge` 内部验绑定→跑私有 op→只回数据, ops 永不出模块)。另 Codex 确认 N4-bis 托管源(从 `relay_nodes` 服务端态派生, 不信 `submission.custody`)+ N8 绑定/PoP 核。测试制品 I-1(遍历导出面测属性非名字)/I-2/I-3 + 专属 `u1-challenge-store.mutants.mjs`(攻能力暴露/token 方法回归/绑定弱化/CAS 移除)。
> 🔴 **范围边界(Codex 明令不 over-promote)**: 本条**仅【定义冻结】**, **非** §6-1 LIVE/部署/迁移生产 schema/移钥/注册生产身份/签名广播/动任何生产钱路的授权。**post-land 闸原样保留**: `deriveCustody` pre-tx 读↔注册写之间的 TOCTOU 加严 · 具体持久表 schema/迁移/索引 + 生产 wiring · mutation-harness 改「变异临时副本」重构 · **Owner 物理机/LIVE 授权 + wiring 后运行证据**。⚠ **不 grandfather**: 未来生产 wiring 若改动被审信任形状(新参 / 调用方可选 provider / 对调用方态的新 `x.y()` 解引用), 本 PASS **不自动覆盖**, 须重跑参数/解引用 authority 枚举。
> 出处: COORD-LEDGER (368)-(386) · 桥 MSG-224..231 + Codex responses(bcc8dd28/e008bbbc/3ae9e7eb/80b34870/e9eb0cc4/**65ee6818**) · target `154291d8`。

> 📌 **状态注记(2026-08-17b · Owner 终端撤物理隔离机前置 · Bettor 记账)**:
> 🔵 **Owner 2026-08-17 终端裁定「没条件搞, 不需要物理隔离机, 直接搞」** ⇒ **撤销 08-07 的「Owner 物理机 / ②密钥隔离验收」作为 §6-1 LIVE 硬前置**。风险接受: TN12 **测试网**(testnet KAS; Owner 多次定「测试网花真金无需顾虑」)。⚠ **本撤销 scoped 测试网**; 若未来上 mainnet, 密钥隔离问题须重议(不 grandfather)。
> 🔴 **但 §6-1 LIVE 另有【非许可性·纯功能阻塞】现已 RPC 实核**: 本机 kaspad **isSynced=false**(2026-08-17 实测: isSynced=false / **123 tips**[异常, 健康应个位数] / ~2 块每 10s / blockCount==headerCount=1148156 / DAA=77545324 / isUtxoIndexed=true)。**节点降级未同步**——注册/结算需链确认, 降级链上=钱路不可靠(tx 间歇落地非稳定)。**物理机闸撤 ≠ 可即上线; 节点同步是现在的硬坎。**
> 🔴 **⇒ §6-1 LIVE 真实序**: ①**先修节点健康**(chain 域, 与今晚早段链楔恢复同族, J1 域)——先判 isSynced=false 是已知单矿工 flap 还是真降级(123 tips 倾向真降级)②LIVE wiring(留档三项: registerIdentity 生产调用方接入 / payoutshard :1824 默认回落不对称 / u1-escape-hatch-live-check.cjs §5-6; + deriveCustody TOCTOU + 具体存储表 schema/迁移)③部署 + testnet E2E 运行证据。内部双审不降(D-011)。
> 出处: Owner 终端 2026-08-17 · RPC 实测 node-status probe · COORD-LEDGER (399)。
>
> 📌 **状态注记(2026-08-17 · gate① 上文两处前提已被实测更正 · Bettor 记账, J1 制品, COORD-LEDGER (454)-(464))**:
> **⇒ 拆两半(Bettor 自纠今晚同主语混用, COORD-LEDGER (465))**:
> 🔴 **(i) tips premise 证伪 = 成立(regime-wide)**: J1 笔记本节点(46 采, isSynced=true 时 tips 191-238/中位193/个位数0, Bettor 程序化复核)+ NWT/J2 在 console 节点(tips 204-218)**两台皆高 tips** ⇒ 高 tips = GHOSTDAG 单矿工体制常态, **非降级信号**。L141 "123 tips 倾向真降级" 判读**作废**(tips 部分)。此结论**跨主语成立**(regime 属性)。
> 🔴 **(ii) isSynced=false premise 对【真主语】未结算**: J1 的 46/46 healthy 是 **J1 笔记本节点**; 而 L140「本机」= **console 节点(DESKTOP-DA9QQ46 = J2-tn = 探针 node1; J2 实读 kaspad PID 9084 逐项交叉锚定)**。该节点**今日确实**读到 `isSynced=false / starved / lag=680`(J2 带外 doc 61c79e04 + NWT 14:15-16:12 实测, 后恢复 isSynced=true/lag=0)。⇒ **「isSynced=false 是 flap 非降级」不能据 J1 节点断**——那是**别的主语**(在册 `evidence-can-be-true-and-about-a-different-subject`)。**待 KANet-UI 在 console 节点跑 46 采窗结算**(现进行)。
> 🟢 **gate① 分解(按真主语=console 节点)**: (a) 节点非降级/isSynced 可靠 = **对 J1 节点已闭, 对 console 节点 PENDING**(KANet-UI 正测); (b) 真 tx 逆境确认 = **探针**(v6, node1=J2-tn=console 节点 ⇒ **权威闭合正是真主语**, 待 Codex FINAL + artifact#3)+ 旁证(J1 自然-tx ~57s, 但在 J1 节点)。
> 🟢🟢 **gate① 终态(2026-08-17 · Codex 独立验 artifact#3 = RESPONSE-MSG242, COORD-LEDGER (490)-(494))**:
> **(a) 节点非降级 = KANet 内部闭(非 Codex 独立验)**: KANet-UI console 节点 46 采 == J1 (462) 逐项(isSynced 46/46 / DAA 严格单调零回退 / tips 192-250 中位194)⇒ 真主语(DESKTOP-DA9QQ46)**三源(J1+KANet-UI+J1隧道)内部闭**。🔴 **scope 精修(Codex sync-review 618906a1 明令)**: Codex **只独立验了 (b) 的 artifact#3 JSONL**; (a) 的 console-node 46 采**原始制品在 gitignored `scratch/_kanetui_nodehealth_run1.jsonl`, 未入库** ⇒ Codex 无从独立复核, (a) 仅"KANet 内部 RECORDED, 本增量无新 raw-evidence credit"。**durable/可独立复核闭合需 KANet-UI 把 46 采 raw JSONL 提交到 `artifacts/`**(同 J1 (462) 与 artifact#3 的做法), 否则 (a) 停在内部闭、非 Codex 级。
> **(b-isSynced=true) 逆境确认 = 闭(限定措辞)**: artifact#3(run-7ac2c2, approved 06b3bb55)3/3 confirmed@isSynced=true 低产(rate<1), 内部双审(J1 审席 PASS 独立重算 pin + NWT 对抗读 raw log)+ **Codex 独立验逐项对上**。**Codex 钦定措辞: gate①(b) isSynced=true/<1DAA/s 逆境确认格 CLOSED for tested J2-tn authority/regime, 确认 ≤32.532s = 轮询/仪器上界【非真链确认延迟】(firstSeen==confirmed 三样本证采样粒度主导, 不许更强 latency claim), 无 admit-then-strand**。
> **🔴 (b-isSynced=false) = OPEN/未测**: 该相位 submit 在拿到 txid 前即被硬拒(fail-closed 非准入, 非慢确认)⇒ **禁折进 isSynced=true 闭合claim**。若 §6-1 LIVE 需覆盖此相位, 另测。
> **🔴 §6-1 LIVE 不因本裁自动授权**(Codex 明); 探针链终点已达。剩: isSynced=false 格(若 LIVE 需)· wiring②(J2)· failClass 数组修(下次仪器改动时, 非阻)· 393 重新称重(Bettor)· relay_id 锚定(北极星前硬闸)。精度裂缝(failClass 单一化=defect 393)Codex 亦从 raw log 独立确认, 不改 verdict。
> 🔵 **scope 已理清(J2 PID 交叉锚)**: 探针 node1 = console 节点(同机), 故 artifact#3 权威闭合的正是 gate① 关心的主语, 不用另找; part(a) 由 KANet-UI 现测补上。
> 🎉 **Codex 探针 FINAL ACCEPTED(2026-08-17, 桥 6b912161, 权威 commit ccc2f84d, launcher blob 676518be=执行方预算值 MATCH)** ⇒ 序推进 J2-tn 跑→artifact#3→J1 审→gate① part(b) 权威闭合。
> 🟢 **节点健康厘清(COORD-LEDGER (467)-(471) · 含两轮过强措辞校准)**: ①**J1 笔记本节点**: DAA 严格单调、isSynced 46/46(462 制品)。②**console 节点(真主语)= 真实间歇 flap**: 17:55-57:49 **实测 isSynced=false + DAA 冻结**(两独立代码路径=J2 广播闸 + KANet-UI standalone-RPC 测到, 强), 1-2min 后恢复 false→true+DAA 续。🔴 **两轮过强措辞已校准(470)**: J1 (467) "same-period 反结果=纯测量层差异" + Bettor (469) 沿用 = **过强** —— J1 隧道读(17:59)在**恢复后**, 窗未覆盖 false 窗(window-must-cover-the-moment)。⇒ **flap 是 REAL 间歇 node-health 状态变化(Codex 复核亦证), 非纯测量噪声**; console 节点 slow-production/load 下**确实**会 stall(DAA 冻)再恢复, 跨~2 天=非新降级。**neither healthy nor degraded = 间歇**, 待 KANet-UI **46 采跨窗分布**判(短窗会被 flap 相位骗)。③**注册层不依赖节点**(下条)。
> 🔴 **重大厘清: §6-1【注册】路径不广播 ⇒ 与节点健康解耦(COORD-LEDGER (468), Bettor grep 实核)**: `u1-registration.mjs` import 面仅三本地模块, 全文零 broadcast/relay/sendCommand/tx/utxo/sign ⇒ registration = DB+密码学(PoP)+challenge CAS, **无 RPC/节点依赖**。⇒ **isSynced 闪烁与 §6-1【注册】无关**; L141「①先修节点健康」当 §6-1 LIVE 前置**误挂**——节点健康是**结算(广播路)**前置。**§6-1 LIVE(注册)真实阻塞 = 仅 wiring(③迁移→①→②⑤)**; 探针/节点健康 = 结算就绪 track。⚠ 若 Owner §6-1 LIVE 含端到端注册→结算, 结算段仍需节点健康; 注册本身可先 live。
> 🔵 **L141 步②的 "payoutshard :1824" 已更正**(COORD-LEDGER (456), Bettor by-content 实核): `:1824` 区**早已修**(2026-07-08 `_resolveZkNativeCtorExtras`)且属**结算域非 §6-1 身份** ⇒ **从 §6-1 关键路径撤下**。§6-1 LIVE wiring 真实项 = ①registerIdentity 接线(依赖③迁移)②deriveCustody TOCTOU ③`u1_identity_challenge` 表迁移(真卡点·migrate.js 与 live 库皆无)⑤escape-hatch live-check。
> 🔴🔴 **relay_id 身份抢注面(NWT 2026-08-17 第二轮深对抗审挖出, Bettor+J2 grep 实核确认, COORD-LEDGER (484)-(487))**: 注册链**无"请求方密钥 ↔ relay_id"绑定** —— deriveCustody 只按 relayId 查 custody **类型**, verifyRegistrationBinding 只验提交方自身密钥内部一致; ⇒ 攻击者自签一套自己的密钥 + s.relayId 填任一已存在 custody=mnemonic 的 id, 全过, 永久抢占该 relayId 主键。**severity**: 属继承 console API 信任模型(loopback + 零 per-resource 授权, 同 transfer/mnemonic-reveal) ⇒ 当前 TN12 loopback 下非新暴露、§6-1 注册可 live; 北极星=开放测试网时外部方将信任"relay_id=X 注册=X 控制", 此事实零密码学锚定=占位赛跑。**修法架构性非平凡**(relay_nodes 有 ecdsa_pubkey_xonly 列但 32 行非空 0 + u1-* 链零引用 ⇒ 要 relay 本人 IPC 签挑战, 非本 wiring 单独能解)。**🏛 裁: relay_id 密码学锚定 = 北极星前【硬闸】, 不阻当前 TN12 wiring/LIVE**。已入 wiring §0+§10/§7。

### D-011 钱路改动"审核关卡 ≠ Owner 逐项点头"——去 Owner-gate 化,内部双审纪律不降 (2026-07-21 · Owner 频道直令 · Bettor 记账)
- **触发**: #28/K-18 §3.4 修复清单里 Bettor 列了一条"等老板正式点头"才能上线,Owner 当场纠正:"这不是你决定做就可以的吗?你看看自己职责?我这块只看目标!具体做什么都是你排版,你驱动团队做事。"
- **决策**: 涉钱路/covenant/结算的改动,**不再要求 Owner 对每一项逐笔点头才能上线**。Owner 只定方向、看结果;"什么时候技术上具备上线条件"由 Bettor 协调团队自行判定并驱动执行。
- **不变的部分(硬约束,未被这条放松)**: 内部双审纪律照走不降——NWT 独立红队/J1·J2 互审/design-first→红队→实现→验落链这套流程原样保留,这是团队自己的安全网,不是"问 Owner"的替代品,不能因为不用等 Owner 点头就跳过。
- **一致性**: 与 D-001 附记(2026-07-09 Owner"不用等我拍!部署 ZK!中间技术我也不知道怎么拍"=部署节奏与技术细节全权下放团队、内部质量门照走不降)同一逻辑,本条是该原则在"钱路 money-path 签发"这个具体环节的再次确认+补进 CLAUDE.md 铁律 0 的执行口径(铁律 0 本身"用户面/钱路/重大功能需 Owner 批"没有被推翻,被明确的是"批"发生在方向/结果层面,不是逐项操作层面)。
- **落地**: 各 agent 接位/派工文档中"等 Owner money-path 签发"类措辞,今后统一理解为"内部审核链走完即可驱动上线",不再单独回报等待 Owner 确认;Bettor 后续在 COORD-LEDGER/频道中同步此口径,避免团队按旧理解卡在等待。

### D-010 接位状态频道(coord-status)+ COORD-LEDGER 活跃窗口制 (2026-07-10 · Owner 7/9 方向点头 + 无异议窗终裁通过 · Bettor 拟/NWT 红队)
- **决策**: 采纳 `docs/2026-07-10-d010-handoff-status-channel-proposal.md` **v1.1**——①链上频道 `coord-status`,Bettor 单写自足全量状态摘要(班次收束+重大变化时);**信任根=内容显式签名**(blake2b(content)+Bettor relay 私钥签+读端验签),sender_address 过滤仅减噪粗筛零信任功能;②锚(git HEAD/txid)只证新鲜度不证正文,禁"核锚过⇒信正文"推断链,正文一律地面复核(铁律-1 不动摇);③COORD-LEDGER 按月切档 `docs/iteration/archive/` + lint >100KB WARN,跨段引用禁行号。
- **审计链**: v1.0 被 NWT 红队 🔴RED 打穿(`78161b7d`,finding①CRITICAL: bcast sender 归因=output[0] 攻击者自选,"密码学锚"vacuous)→v1.1 换签名门(`024c4e56`)→NWT 复审 GREEN(可行性核实: relay 既有 schnorr 原语复用)→升 Owner 无异议窗通过。
- **副产出(终局=WONT-FIX,2026-07-10 更新)**: scout 归因 input-based 修复(`60a79543`)部署后实弹证伪——**rusty-kaspa 标准 RPC 对 tx input 硬编码 `verbose_data:None`(源码级坐实),被动扫链拿密码学 input 归因=结构性死路,已 revert(`d944416c`)并终裁 WONT-FIX**;scout sender_address 永久定性为"display 级粗筛非密码学信任",derivePeers 挂卡同理由销;频道消息身份验证的正路=本条的内容签名方案(第二步推广到全团队 send 脚本,立卡待排)。**🚫 禁止将来再立"改 input 归因"卡重查**——死路证据链: Bettor 实测 repro+J1 源码(consensus.rs/tx.rs:183)+NWT 复核,事故全程见 COORD-LEDGER 7/9"scout 归因部署事故"段。
- **落地序(正常队列,不占自治化主线)**: ①签名/验签工具(relay sign 命令+读端验签 helper,owner=J1tn,reviewer=NWT)→②建 coord-status 频道+lint WARN 规则(owner=KANet-UI)→③各 `*-接位.md` 加 step 0(验签命令模板+Bettor 公钥,owner=Bettor)→④首次 ledger 切档(6 月及以前→archive/,owner=Bettor)→⑤Bettor 发首条签名摘要+负测试(伪造消息验签失败)试跑一个班次周期。
- **✅ 落地序①-⑤全完成(2026-07-12 Bettor 收官)**: ①ebe74b65+53d1cb17(7/10)②45341687(7/10)③coord-status-验签-SOP.md 单源+6 接位文件 step 0,Bettor 公钥 `657ef5be86afbe22a1c5c3007513278149b8135ed17ce1bb615d1b7e2cc25ebc` live-derive round-trip 自证(7/12)④切档 7/11(320KB→66KB)⑤首条签名摘要上 coord-status(txId b6bc0fbf,hash 4e91f575…),**链上实文回读验签 exit=0(1079B byte-intact)+伪造负测试 exit=1 fail-closed**(7/12)。签名端点 `ADMIN_COORD_STATUS_SIGN_ENABLED=1` persistent(auth=ADMIN_SECRET+IP allowlist)。coord-status 正式投用,接位 step 0 生效。

### D-009 imageId/guest circuit 变更冻结门 (2026-07-08 · gateTmplHash 半更新事故 · Owner 复盘直接指令"更新开发框架相关内容")
- **触发**: pxvml genesis 出生缺陷根因坐实——commit `9b9804b5`（7/7）把 ZK guest 的 `imageId` 从 `335cae6c...` 切到 `c9918501...` 时，配对的 `gateTmplHash`（`blake2b(prefix‖suffix)`）没同步重算，仍烤着配对旧 imageId 的值，`zk_close` 的链上校验从此物理不可能通过。7/8 当晚已用 Bettor 独立重算值（`4ec7ca3d...`）打了一次修值补丁（commit `7afd18e3`），J1 已出 live-derive+round-trip 根修方案（`docs/2026-07-08-gate-tmplhash-live-derive-design.md`，Bettor 方向审 GREEN-with-notes + NWT 红队 GREEN，落码 GO）。
- **硬约束（本条即该 gate 的正式记录，不再靠"大家知道"）**: **在 live-derive+round-trip 落码并验证通过之前，冻结一切 imageId/guest circuit 变更**——修值补丁只是过渡，不是根治；任何人在这个约束解除前再次改动 imageId，必须先确认配对的 gateTmplHash（以及任何其它跟这个编译产物绑定的手工维护常量）是否也需要同步更新，且必须走本文档 D-006 的"技术不确定性直接问 Bettor"流程逐项核实，不能凭记忆判断"应该没别的配对值了"。
- **同族参考**: `docs/ANTI-PATTERNS.md` 规则 55(手工配对常量必失同步)+ 规则 56(vacuous same-source verification，两条"独立"验证路径若共享同一常量来源不构成真正独立)。
- **解除条件**: `docs/2026-07-08-gate-tmplhash-live-derive-design.md` 落码完成 + NWT 复核 GREEN + 一次真实 round-trip 自证跑通（不是"重跑一致"，是从当前 imageId 现场推导出的值跟硬编码值比对一致）。解除时在本条追加一行 SUPERSEDED 说明，不删除本条（保留事故记录）。
- **✅ 已解除（2026-07-09 04:2xZ · Bettor 终验宣布）**: 三条件全满足——①落码 `66de59c6→b3710f7a→c741275a`（live-derive+round-trip+跨源断言 env==ZK_GATE+四调用点 mint/handoff/witness-rebuild force + prove-worker lazy）；②NWT 终 GREEN（finding①HIGH guard验错对象+②MED 全闭合，`docs/2026-07-09-NWT-redteam-gate-tmplhash-live-derive-66de59c6.md`）+J2 核 GREEN；③KANet-UI operator 节点实 kanet.env 现场推导 selftest **6/6 ALL PASS**（现场推导 c9918501→4ec7ca3d==烤死值==env 三源闭环）。**⚠ 运行时生效需重启部署（与 P2 共用重启窗），5R-2 点火前必须部署到位。imageId 变更 runbook 固定成本：canonical sample 随 imageId 过期，需新 image 重出一份 sample receipt（NWT 备忘,防绕 guard）。**

### D-008 ZK 线 payout 真相源 = guest circuit·fee 政策单源收敛 (2026-07-08 · pxvml 门② 盲算不中挖出 · NWT 红队定论 + Bettor 按接位授权拍板 · Owner 在线未否决)
- **架构定论(NWT 源码级)**: CloseZkV2 `zk_close` 对 guestPayoutRoot **零链上校验 vs 委员值**=by-design——委员 attest 只锁 winner/betsRoot/refundRoot/atMs,payout 分配的 binding authority 在 **guest circuit**(Groth16 经 gateTmplHash 验)。`claimedPayoutRoot` 在 ZK-native 路径=historical artifact(V1 committee-settle 遗留),propose 侧仅"预告"非 binding。
- **实弹分叉(触发本条)**: propose 侧 pool=Σ注(漏 seed)+FEE_CONFIG 3%(broker160+委员120bps)签出 e170e003(Σ=300M,若用于 claim 会焊死 0.2KAS);prove 侧 job=consolidatedPool+broker_fee_pct(Σ=320M 可精确清零)。同一市场两棵树三处三说法(FEE_CONFIG vs broker_fee_pct vs D-007 池×pct)。
- **拍板**: ①pool 基数=**consolidatedPool**(守恒硬要求非政策:Σleaf==链上池才能精确清零);②费率=**D-007 口径 池×broker_fee_pct**(市场级);③FEE_CONFIG 委员 120bps 分成=**份额政策卡挂起待 Owner 确认份额表**,确认后并入单源函数(诚实口径:当前费率≠最终份额定案)。guest 免重编(fee_leaves 是输入,main.rs:151-155,image_id 不变)。
- **正式场前 BLOCKING 收敛卡(J2/NWT 审)**: 单源 leaf 派生函数,propose/enqueue/guest-input 三侧必调同一份;propose 侧 pool 基数修为 realConsolidatedPool;claimedPayoutRoot 标注 non-binding。
- **方法论沉淀**: 重跑 N 次一致只证确定性不证正确性(e170e003 五次 propose 一致仍整树不守恒);钱路关键值必须独立第二路盲算(memory `feedback-retry-consistency-proves-determinism-not-correctness`)。

### D-007 correctness/liveness 分界 + broker-fee 独立对账器 (2026-07-08 · Owner 钦定架构指令 · J1 转达 · Bettor 记账派卡)
- **分界(Owner 原话要义)**: **ZK 只证 correctness**(落链那笔算对了),**不证 liveness**(结算真发生了没——daemon 死/卡/anchor 死锁不会有 proof 告诉你"该收的三笔少了一笔")。团队此前感受的"不可靠"大部分= liveness 侧管线病,不是 ZK 的药能治的。
- **方案**: 独立 broker-fee 对账器(J1 shadow-ledger 域):定时扫 broker 地址 UTXO(链=唯一真相)→按 txid 关联市场→核 expected=池×pct→三态输出(✅到账且对 / 🔴到账但金额不符=电路漏洞级警报 / 🟠过 deadline+grace 无 fee 落链=daemon 卡死警报)→每笔频道回执+日终汇总。**全程只读链,daemon 全灭照样准。**
- **定位口径**: 对账器=broker 角色的协议能力(Track B 协议完整性一部分,任何第三方 fork 部署者当 broker 都需要),测试网收测试 KAS 不改定位。
- **落地两动作(Owner 今日钦定)**: ①市场5 彩排验证清单加"broker output 电路内 enforce 核实"(已进 2026-07-08 市场5 设计稿 T1.6);②J1 对账器任务卡(读链+对账+频道通知,~1 天量,与 claim-complete 预注册验收标准同批,不单开线)。

### D-006 补 DEV-FRAMEWORK.md 断链 + 技术不确定性直接问 Bettor (2026-07-07 · J1tn 提 · Bettor 审后合并批准全队生效)
- **背景①(断链·事实更正 by Bettor 审)**: ~~"该文件从未被创建"~~ **不实**——文件 2026-07-06 Owner 钦定当天已创建(含 Owner 原话/六步流程/lint 卡点机制)，但**一直未 commit、躺主机未跟踪**,J1tn 从自己节点静态查不到 → 误判"从未创建"重写四步简版(ff4d3b06)。Bettor 合并两版(原稿为基底+J1 增补 byte-exact 审核语言/问 Bettor 原则/参考区)为最终版。**此误判本身 = 背景②原则的同日第二实证**(静态回溯误判,问一句就清楚)。
- **背景②(新原则)**: J1tn 同日对一条自己都不确定是否已发出的旧消息("escape_trigger blocker")，通读 COORD-LEDGER 自行判断是否陈饭，绕了一圈；Bettor 一句话查清真相(消息未广播成功，撞在 Phase0 停栈窗口)。**新增操作原则**：技术性不确定(旧消息是否陈饭/某假设对不对/某 blocker 是否仍开放)→直接问 Bettor，不要自己长链条静态回溯再拍。跟"设计前查资产"(CLAUDE.md 接位 SOP 第5条·防重造)不冲突——那条管设计/实现方案本身，本条管**事实性确认问题**。
- **落地**: `docs/DEV-FRAMEWORK.md`。非争议性文档补丁，不改变任何现行执行口径。

### D-005 ZK/工具链研究隔离铁律 — 绝不碰 live 节点 (2026-07-06 · Owner 钦定·灾难级约束)
- **Owner 警告**: "这个不能轻易迭代·换了整个系统都会塌·慎重" + "你们自己去搜索研究"。
- **铁律**: ZK feasibility / silverc / rusty-kaspa 工具链研究 = **纯隔离**(独立 checkout / 测试环境)。**绝不 rebuild、绝不替换 live 节点的 rusty-kaspa build(1.1.1-toc.1 Toccata)**——覆盖 live 二进制 = 崩 bshard + 全部 live 市场 + 结算 daemon(配 memory reference-tn12-mining-external-bridge / covenant-wasm-breaks-selffull:绝不 rebuild D:/rusty-kaspa / 绝不 inprocess)。
- **可行性 ≠ 采用**: 就算 OP_PICK 在 silverc v2.0.x 修了 = 只是"ZK 技术可行"的证据。**采用/迁移 live 节点 = 另一个慎重的、充分测试的、Owner 拍板的独立决策·live 在那之前原地不动。** 研究归研究·迁移归迁移。
- **研究产出边界**: Track1 = 可行性结论(能编/不能编 + 证据)·零 live 触碰。
- **🔴 具体路径钉死(2026-07-06 near-miss·J2 自查拦下)**: **`D:/rusty-kaspa` = LIVE TN12 节点 `kaspad.exe` 的实际运行目录**(`D:\rusty-kaspa\target\release\kaspad.exe`)。**绝不在此目录 cherry-pick/build/任何写操作**——会污染 live 二进制、崩全 TN12 + 所有 live 市场。J2 差点在此 cherry-pick zk-sdk·例行查路径发现是活目录·及时停手。**R0ScriptBuilder/zk-sdk 等 → 全新独立 clone 目录**(如 `D:/rusty-kaspa-zksdk-clone`·独立 target/·跟 live 零关系)。
- **🔴 通用习惯(NWT 提·记 memory 族F)**: **任何写/build 操作前先查目标路径是不是活进程的目录**(tasklist/wmic 查 kaspad.exe/node.exe 实际路径)——"操作前查目标是否活"·别凭'我以为隔离'的印象(J2 一度错判 D:/rusty-kaspa 已隔离=只读·实为 live)。



### D-004 统一知识框架 — KB 做成唯一 durable 家·知识层上单一真值纪律 (2026-07-06 · Owner "把 KB 统一" · Bettor 出方案)
- **根因(读完 OIL-v0.3 框架后定位)**: 框架的**状态层(Ledger)有单一真值纪律**(§8.4 频道→Ledger 铁律),但**知识层(KB + 265 memory + 散 docs)从没上同纪律** → 知识散在四处、无单一入口、KB 烂尾在 6/28 → 每轮新 agent 拼碎片 → 漂移/炒陈饭。
- **方案: 每类知识一个家·分层定死**:
  | 层 | 唯一家 | 内容 | 纪律 |
  |---|---|---|---|
  | durable 知识 | **KB `D:/KANet-Knowledge-Base`** | 架构/定位/invariants/roles/ZK-covenant 决策 | 单一真值·状态头·持续 un-stale |
  | 当前决策口径 | **`docs/DECISIONS.md`** | 战略决策日志·谁取代谁 | 接位第一读·防炒陈饭 |
  | 协调状态 | **`docs/iteration/COORD-LEDGER.md`** | 当前进度/派工(框架 §1/§8.4 已有) | 频道→Ledger 铁律 |
  | 易变 sediment | **`.claude/.../memory`** | session 事实/feedback | 反增殖·按族合并·durable 提升进 KB(D-003) |
- **四个动作**:
  1. **KB README = 单一入口**: 每个接位从 KB README 进 → 路由到各层当前状态。
  2. **接位路由补缺口**(今天查实的): 每个 `开发智能体接位/*-接位.md` 必读**加 KB README + docs/DECISIONS.md**。
  3. **KB un-stale**: 更新 `06-ai-memory-system.md`(路径/纪律) + 把这周结算/ZK-covenant durable 知识沉淀进 `KB/architecture/`。
  4. **维护节律绑 D-002 retro**: 每轮 retro 把 memory 按族合并→durable 提升进 KB、标废文档、un-stale KB。KB 不再烂尾。
- **🔴 硬门(Owner 2026-07-06 裁定·防知识层规则49)**:
  1. **KB git 化 = 前置**(单点必须版本化·no commit no history)。✅ **DONE**: `D:/KANet-Knowledge-Base` git init·baseline `19a4155`·57 文件。后续 un-stale 均可考古 diff。
  2. **#3 大整合禁一把梭**(=知识层整页重写·规则49同病)。硬要求:
     - **清单先行(feature manifest)**: 264 memory 全量编号列表 → 每条标去向(合并进 KB 哪个文件 / 显式"弃置+理由")。**禁"合并后对不上账"**。清单出来先报,不动手。
     - **按族分族门控**: 每族一个 STOP 点·**合并 commit 与标废 commit 分开**·禁一周末干完 264 报 done。
     - **"方向 accept ≠ 免门控"**: Owner 认的是方向·不是免门控·每批 STOP 报告显式确认。
  3. **🟠 旧址同轮盖章(进 DoD·缺一不算完)**: 每合并一族·docs/ 对应旧址**同轮**挂状态头 `SUPERSEDED-BY: KB/<path>`——否则 agent 走老路照吃陈饭·真相源从 4 变 5。
  4. **🟡 顺序修**: 接位已先于 KB un-stale 路由(#1 先于 #3)→ 接位话术写死**"以 KB 状态头为准·无状态头条目视为 OPEN·不作施工依据"**(已补进 5 接位·下方)。
- **⚪ 疗效验收(唯一)**: 7/8 retro 加计数 **"本周炒陈饭事件数"**(agent 引用已废决策/重开已决议题次数)。此数不降 = KB 白建。落 FRAMEWORK-RETRO-TEMPLATE 表2。
- **纪律记账(Owner 2026-07-06)**: "已动手·不等" 仅限 Owner-裁-additive·**执行方不自封 additive**·下不为例。

### D-003 统一记忆框架 restore — 反增殖·反漂移 (2026-07-06 · Owner 诊断根因 · Bettor 认+落)
- **Owner 诊断**: "不断产生新记忆文件 = 碎片化根源 = 一直在漂移。我们有统一记忆框架,你早忘了。" 查实成立。
- **查实的漂移证据 (3 条·代码/文件级)**:
  1. 统一框架**存在且有定义**: `D:/KANet-Knowledge-Base`(KB·结构化) + `KB/infrastructure/06-ai-memory-system.md`(记忆系统框架·4 类 memory + MEMORY.md 索引 <200 行纪律)。
  2. **框架文档自己 stale**: `06-ai-memory-system.md` 最后更新 **2026-05-24**·还写记忆目录=`C--kanet`(D 盘迁移前老路径·实际已在 `D--kanet-tn12`)·框架没跟迁移更新。
  3. **纪律全废**: `.claude/.../memory/` **265 个文件**(框架写死 <200 行否则 truncate·早超·索引 truncate=框架自我失效)·KB 最后实质维护 ~**6/28**·这周结算/ZK/covenant 全散进碎片、**零回流 KB**。
- **对齐既有框架的修 (绝不另造新框架·那正是漂移)**:
  1. 更新 `06-ai-memory-system.md` 到现状(路径 `D--kanet-tn12`·当前纪律)·un-stale。
  2. **265 memory 按族合并**(DB-lag 族 / ZK-covenant 族 / phantom-leaf 族...)→ 回 <200 索引限。同 D-002 表2"规则档案健康度"的合并纪律,同一反增殖母题。
  3. **durable 知识沉淀回 KB**(结算架构现状 / ZK↔covenant 决策 → `KB/architecture/`·引 `docs/DECISIONS.md`)。
  4. **唯一更新纪律**: 新沉淀进【既有结构】——KB 存 durable 架构/决策·memory 存 session-fact(带合并纪律)·DECISIONS.md 存决策日志。**禁止散造新顶层文件/新框架。**
- **与 D-002/文档 lifecycle 的关系**: 文档 lifecycle(状态头) + D-002(规则档案不膨胀) + D-003(记忆反增殖) = **同一个反漂移系统的三个面**。母题都是 Owner 2026-07-06 诊断的"碎片化→炒陈饭→漂移"。

### D-002 框架迭代回路 (2026-07-06 · qzdh7nar 提 · Bettor 裁定采纳)
- **问题**: 框架只有"写入路径"(踩坑→沉淀规则),没有"迭代回路"(规则生效了吗→复发了吗→升级还是合并)。纯被动:每条规则的发现成本 = 一次真实损失 + 一次 Owner 暴怒。成熟度错标为"零事故",应为**同坑复发率 + 踩坑到机制化周期**(框架对 LLM 永不完备)。
- **裁定采纳的四机制**:
  1. **复发计数→升级非重申**: ANTI-PATTERNS "前科"从叙事变度量·复发=规则失败·"再次强调"是禁语(口头重申遵从率仅 70-90%)。
  2. **执法阶梯 L1-L4** (L1 文化/L2 checklist 门控/L3 lint 半机械/L4 结构性不可能): 任何在 L_n 复发的规则**自动升 L_n+1**。**细化(Bettor)**: L4"物理不可能"(如收回整文件 Write)只对**修复类任务**;**明确批准的重构类**走 D-编号解锁,否则真重构做不了。
  3. **定期框架 retro + 防档案自膨胀**: ANTI-PATTERNS append-only 已 49 条·会重演碎片化病(装不下→扫不全→等于没写)。CLAUDE.md 必读只留 **≤10 硬闸**,其余索引;"永不新建"管规则(能并进旧条不开新号);连续两期零触发的 L2 规则降载。
  4. **框架变更走 D-编号 + 先谈后做**: 每次改框架(加规则/升执法层级/合并)记一条 D-编号含推翻理由 → 框架有版本史·不能拿旧框架条文炒陈饭。
- **度量廉价**: 不建面板·retro 人工数三个数(复发次数/diff 预算超支/STOP 违规)。
- **交付物**: `FRAMEWORK-RETRO-TEMPLATE.md`(议程+三计数表+升级/合并/降载判定)·锚 **2026-07-08 go/no-go 首次 retro**·用世界杯软启动这周真实数据跑第一圈。qzdh7nar 出·Bettor 审。
- **触发本条的元事件**: 规则 49(整页重写)其实早有前科(retail-dex 1990 行/规则 1)却拖到 7 月才升硬闸——周期太长,正是本回路要治的。


### D-001 结算验证机制 — ZK 为 committed 目标架构 (2026-07-06 · Owner 拍板翻案 · 取代 7/3 rolling)
> **下轮 agent 查这条=现行决策。ZK 是 committed 方向·别再当'待定'重新讨论(炒陈饭 Owner 已数落两次)。KB §9 = 震荡史料·本条=最终决策。**

- **🔴 战略决策(2026-07-06 Owner 拍板·正式翻案 7/3)**: **ZK = committed 目标架构。** 理由(Owner 原话+技术依据): **"rolling 联机跨节点根本没戏·实践已验证"**——bshard rolling shard `market_shards` **不跨节点同步**(:3300 读不到·COORD-LEDGER 线6 记载)·去中心委员无法独立跨节点重建验 → cross-node/production 死路。**ZK proof 每节点独立验·不需跨节点同步 → 解此死结。** (Owner 强调此为"之前共识"·被团队 drift 遗忘·= 本 DECISIONS.md 反炒陈饭要根治的正是这个。)
- **🔧 执行路径 = 选项 A**: **自修 silverc `pick_from_depth` off-by-one codegen bug**(OP_PICK·有源码 `/d/silverscript`·13 轮 bisect 定位过·targeted 补丁)→ 生成调**协议原生 ZK opcode**(OpZkPrecompile·TN12 已 live)的 covenant → ZK 结算。**J2 主·J1 回来有 13 轮记录加速。**
- **🟢 rolling 处置**: **保持 live 公测运行(不停·真人钱在里面·三场 955 赢家已闭合)·但不再追加投入**——降为过渡/live-continuity·非目标架构。
- **⚠ 慎重铁律(D-005)**: 全隔离开发·live 节点原地不动·ZK 真上线 = 充分测试后 Owner 拍的独立迁移决策。
- **supersedes 链**: 6/28 Owner 钦定 ZK → 6/30 单片/多片 PROVEN(委员签名) → 7/3 rolling(过渡) → **7/6 Owner 拍板 ZK committed(本条·最终·rolling 降过渡)**。
- **🔴 增补(2026-07-09 Owner 频道直令·加速执行)**: 5R-2 三门全绿 claim landed(第一个真实市场完整 ZK 端到端,见 COORD-LEDGER 7/9)当日,Owner 令**"不用等我拍!我就一个要求,部署 ZK!"+"中间技术我也不知道怎么拍"**=部署节奏与技术细节全权下放团队(Bettor 协调拍),撤销一切"等 Owner 窗口"条款(内部质量门/双审纪律照走不降)。Bettor 自决执行序: ①P4 fee 单源收敛(D-008 BLOCKING,唯一技术前置)②正式场市场5(ZK 线)P4 闭即开③zk_close 自治化(ZK_CLOSE_TICK=ON)正式场首市跑通后开④新市场默认 zkNative(已在)⑤存量在飞 rolling 市场自然到期收束**不迁移**(真人钱零风险,D-005"不碰 live 在飞"精神保留)。
- **✅ 执行路径实证达成(2026-07-06 14:44)**：选项 A(自修 silverc OP_PICK codegen bug)完成——根因定位(`compile.rs:3754`)+单行修复+cargo test全绿+§5四层验收全过。**KANet 历史上第一笔完整真实 ZK settle 交易 LANDED**(txId `4ec9ddd1d89b144bfec50e386be0221ab44e2f58f1c4f63207358a2eb80f3545`，NWT 独立核实)——OP_PICK 修复+non-vacuous binding+continuation state转换+J1真实RISC0 guest算出的真实Groth16 proof(非fixture)全部环节首次同时在活链验证通过，零资金损失。详见 COORD-LEDGER 对应里程碑条目 + memory `project-first-complete-real-zk-settle-landed-2026-07-06`。**诚实标注**：这是"机制端到端跑通"的第一笔实证，尚未讨论生产化/规模化路线(委员共识层/多片等)，不越界声称"生产就绪"。
- **🔬 活体取证(2026-07-19 · jepu1 · 三方实测焊死 · J1tn 主查)**: OP_PICK off-by-one codegen bug 不只是"要修的路线图任务"——它有一个**锁死真金的活体现场**。jepu1(v0.7 covenant-settle 盘, genesis 2026-06-28, 早于 7/6 修复)的 settle 交易被 TN12 节点连拒 432 次(`188KAS` 卡死), 今晚定位链(每步实测、每个错假说被数据自己推翻, 六轮: wire序列化漂移→节点版本漂移→陈签名→committee ordering→covenant introspection→**D-001 本 bug**):
  1. **sighash 层排除**: J1 独立 Rust 探针(kaspa-consensus-core@节点 commit `7b1e18cc`)算 input0 node-truth sighash = `ad7eb3a1…`, 与 relay 派生值全 hash 相等 → 版本漂移死。
  2. **签名层排除**: J1+J2 各自 noble schnorr 独立验, 5/5 committee 签名对 `ad7eb3a1` 密码学有效(SIGHASH_ALL)。
  3. **committee-ordering 排除**: genesis redeem(2103B, blake2b==P2SH 自证)**不烤 committee pk / committeePkHash / poolMerkleRoot**(J1 disasm + J2 字节搜索双证), ordering(VRF vs sort)对拒绝无因果。
  4. **确切 opcode 定位**: J1 instrumented 引擎(patched `kaspa-txscript@7b1e18cc` 打点, 照抄 consensus `check_scripts_sequential`, 吃 wire dump 原字节)→ **确定性离线复现拒绝**(input0 `VerifyError`), FAIL 精确落在 `OP_VERIFY(0x69)`, 紧前 `OP_EQUAL(0x87)` 比 **top=`08`(1字节) vs below=`7394f883…`(32字节 blake2b)** → 尺寸错配=**取错栈项铁证**。full dstack + PICK 深度实测: 喂该 EQUAL 的深栈 `OP_PICK depth=48/49/50` 落在 output-amount NUM2BIN 序列化的小整数 scratch 区(`08`/`4020334d06`/`04`)而非那个 32B 期望值。
- **战略含义(强化本决策)**: jepu1 = **silverc 编译的 covenant 存在真实锁资金 codegen bug 的活体铁证**——且是**7/6 修复前铸造的盘, buggy codegen 已 baked 进链上不可变 redeem, 修复不追溯**(重签/重构 tx 绕不过)。这正是 铁律0.5/本决策把 ZK 定为 committed 结算架构的核心理由之一(ZK proof 不依赖 silverc covenant 逐 opcode codegen 正确)。**两轨处置**: **轨A silverc 源码根治 = 已完成(非待办)**——OP_PICK off-by-one 早在 2026-07-06 即修复并部署(`/d/silverscript` commit `8065184` "Fix OP_PICK off-by-one in compile_byte_sequence_cast_call", J2+NWT 2026-07-19 独立核实仓库在), **7/6 之后编译的合约不再中此 bug, jepu1 是修复前(genesis 6/28)的历史受害者、baked 不追溯**; 轨B jepu1 单笔 remediation(settle 路 unsatisfiable → 退款方向, refund 路需先 offline trace 确认无同款 PICK bug, 动 188KAS 走手术单+Owner 批)。**剩余唯一开放工作 = blast radius 排查**: pre-0706 窗口(J2 查到同期 `settle_zombie_quarantine`≈169 + `settle_failed`≈49 = ~218 market)里还有无其它同款受害者——J2 主查, J1 engine-probe/trace harness(`D:/silverscript/txscript-traced`+`sighash-probe`, 对任一盘 redeem 离线跑引擎看是否撞同一 PICK false)可复用作批量体检器。诚实边界: 精确 off-by-N 深度对齐 .sil 源意图归 J2 源码域。

---

## ⚠️ 关键澄清: "ZK" 标签被误用 (2026-07-06 查实)

**今晚混乱的技术根源**: 文档里 **"ZK" 这个词被松散地贴在两块不同的东西上**,造成 Owner 以为在用密码学 ZK、实际是 committee-sig:

| 叫法 | 实际机制 | 状态 |
|---|---|---|
| "多片 ZK 自动结算" (6/30 卡) | **委员盲签 + driver-enforce (covenant)** ·文档原文"非 covenant 验 payoutRoot·委员盲签·非 production-trustless" | **在跑** (就是现在的结算) |
| 真·密码学 ZK proof (groth16) | RISC0 电路 + 链上验证证明 | **单片 pb73v LANDED·多片从未交付** (卡 silverc 编译器 bug) |

**正名规矩 (即刻)**: committee-sig/covenant 的活**不准叫 "ZK"**。"ZK" 一词只指真·密码学零知识证明。旧文档标题含 "ZK" 但机制是 committee-sig 的,必须在状态头注明。

---

## 📜 ZK ↔ covenant 决策时间线 (查实·git+文档+代码)

- **2026-06-02**: bshard 滚动分片设计 (押注侧 1→∞ 片·mass 封片) = Owner 终裁共识。**但其中"链下 committee-sig 结算"部分当时即被 Owner catch 推翻**,要求重做 trustless 链上。→ 押注侧滚动机制有效;结算信任侧待重做。
- **2026-06-20**: SIZE 墙 (9999 字节) → **committee-sig pivot** (迭代 consolidate·非 on-chain fold) 绕开。结算落回 committee-sig/covenant。
- **2026-06-28**: covenant settle 一整天炸脆性 bug (NUM2BIN/sighash/dup-addr...) → **Owner 钦定转真·ZK** (一周前既有方向)。复盘: `2026-06-28-zk-settle-pivot-retrospective.md`。
- **2026-06-30**: 单片真·密码学 ZK e2e LANDED (pb73v)。多片"ZK settle"装配卡 (Owner '干') → **但机制实为 committee-sig** (`2026-06-30-multishard-zk-settle-integration-card.md`·标题"ZK"名不副实)。
- **2026-07-01 ~ 07-06**: 多片 committee-sig/covenant 结算作为运行路径,加 rolling payout-shard(>1024)、daemon 自治、self-heal 等——**全是 covenant 路的工程化**,真密码学 ZK 未再推进。
- **2026-07-06**: 公测暴露 covenant 脆性 → Owner 重申 **ZK 唯一路径·作废 committee-sig 老路**。→ 见 D-001。

---

## 待补 (2026-07-06 建立·后续填全)
- [ ] 全库 `docs/*.md` 逐份加 Status 头 (Bettor 驱动)
- [ ] 6/30 ZK 卡等"ZK 名不副实"文档加 SUPERSEDED/正名头
- [ ] lint-kanet 加 Status-头缺失卡点
- [ ] J2 出密码学 ZK 多片 blocker 可行性核实 → 填 D-001 待办

> 📌 **状态注记(2026-08-17c · Owner 授权 §6-1 LIVE node-health 收口路径 + SEND 腿 · Bettor 记账)**:
> 🔵 **Owner 2026-08-17 终端「按你意见办!赶紧」** ⇒ 授权 Bettor (416)/(418) 推荐路径 = **(A/Codex option 2)Owner 显式改证据政策, 授权一个窄范围、可独立复核、非-money-path 的测试网 probe 测试计划**(填 node-health adverse-regime 确认格)+ **SEND 腿 UTXO 拆分先行**。这满足 Codex (b6f6d53f/5797f1f3) 要求的"Owner 显式改证据政策 + 测试授权可独立审"。
> 🔴 **护栏(不因加急放松)**: ①probe = **非钱路**(一条微频道 tx, 非结算/注册/移钥), 全程 JSONL 可审; ②SEND 腿 UTXO 拆分 = 钱路, 走 J2/J1 执行 + 内部双审(D-011 不降), Bettor 协调不亲执; ③测试网限定(mainnet 不 grandfather); ④probe 证据须区分 broadcast-fail(SEND 腿)vs confirm-slow(node-health)。
> 🔴 **排序(承重)**: **SEND 腿拆分先** —— 它是 probe 的前提: trough 期单 UTXO 下连 probe 都广播不出(撞 UTXO-too-small=SEND 腿非 node-health); 拆出多笔 ≥3KAS 后 probe/自然流量才能真在 trough 广播 → 才测得确认。
> 出处: Owner 终端 2026-08-17「按你意见办!赶紧」· COORD-LEDGER (420)· Codex b6f6d53f/5797f1f3 留的 Owner-policy 门。

> 📌 **状态注记(2026-08-27 · VB-6 · 三 "tier" 术语辨析入权威 · Bettor 记账)**:
> 🔵 三个带 "tier" 的名字指三样不同东西, 混用会把"关某开关"落错地方。权威辨析表 = `docs/DEVELOPER-GUIDE.md`「术语辨析：三个 "tier" 别混」; 实证盘点(带 file:line + 原始 grep)= `docs/2026-08-27-kanet-ui-tier2-switch-inventory-v0.1.md`(b2d5dc7d, NWT GREEN 8fe85c93)。
> 🔴 **一句话**: **§6-3 Tier-2 fair-exchange = 设计稿 v0.15·未建**(无码/无 covenant/无开关, 现网禁用是结构性非开关 off); **committed ZK 结算 = live**(kanet.env:18-20 ADMIN_ZK_*=1, 全 fail-closed, 翻它=关现网结算=Owner 域); **audit_mode='tier2' = oracle 声誉信号非结算路**(bettor.js:2316)。说"Tier-2 禁用/启用"前先问指哪一个。
> 出处: COORD-LEDGER VB-5/VB-6 · NWT GREEN-WITH-1-MUST(8fe85c93, MUST=本注记 + 术语表)。
