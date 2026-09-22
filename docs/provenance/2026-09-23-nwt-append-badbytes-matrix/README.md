# NWT — append 坏字节按 seal_count 分组矩阵(账本1647 Codex 假设专项复核)

## 背景 / 谁要的

Bettor(经 kanet-tn12-d8 转 Codex 对 9-22 `nwt/append-badbytes-replay-repro-20260923` 的追问)提出具体假设：
9-22 的复现用的是 `seal_count=1`（非生产形状；生产市场 `api/proto.js:196` 默认 + mainnet 市场
`a59c7b48` 实际用 `seal_count=2`），第二笔下注构造那一刻市场可能已经在"走向 sealed"，节点拒绝的
可能是**针对已变更叶子状态的正确行为**，不是构造缺陷。

Bettor 转达的任务：把矩阵改成以 `seal_count` 为第一变量，每组同时跑，在 bet2 构造那一刻记录市场
status/seal 意图状态/leaf 当前 UTXO 的 state 字段（用 prepared_tx_json 里 append 引用的 outpoint 去
节点查是否已被 seal 花掉），每组追到底（held outpoint/state、leaf/root state 派生值、covenant 入口
参数、sighash 材料、最终序列化交易），第三组（seal_count=3）也跑。结论分开写 (A)(B)，不修代码。

## 环境

- 隔离 simnet，`D:\kanet-tn12\scratch\_nwt_append_badbytes_matrix`（独立 kaspad appdir + 独立
  console DB + 独立端口，与主网/J2 D-032 树完全隔离）
- kaspad v2.0.1（`D:\rusty-kaspa-v201\kaspad.exe`）
- 生产代码路径：直接 `import` 仓库 `kasia-console/src/lib/` 下的真实函数，非重写/模拟
  （`proto-leaf-state.mjs`、`proto-covenant-builder.mjs`、`pool-bshard-artifacts.mjs`、
  `proto-tx-assembly.mjs`）
- 深挖脚本 `evidence/diagnose-append.mjs`：对指定 bet 的 append 意图，用与生产
  `buildRegisterAppendAndBroadcast` 完全同一批只读派生函数独立算出全部诊断字段，并对活节点做
  `getUtxosByAddresses` 查询确认 leaf/held outpoint 现在是否仍在 UTXO 集里。只读，不碰任何写路径。
- 建市场脚本 `evidence/make-market.mjs`：在 9-22 版本上加了 `sealCount` 命令行参数
  （`用法: node make-market.mjs <label> <deadlineMs> [sealCount=1]`），其余与 9-22 完全一致。

## 三组设计

| 组 | seal_count | bet1 | bet2 | bet2 构造时 count 会到 |
|---|---|---|---|---|
| A (sc1) | 1 | side0/1500 | side1/1600 | 2（**超过** seal_count=1） |
| B (sc2) | 2 | side0/1500 | side1/1600 | 2（**恰好等于** seal_count=2） |
| C (sc3) | 3 | — | — | 未能开始（见下方"Group C 阻塞"） |

## Group A（seal_count=1）—— 复现失败,并独立核验 Codex 假设

`marketId=068a6b68...c6dad`。bet1（`889611f9`）落地 `landed_depth=26`，市场此时
`local_yes=1500,local_no=0,count=1,pool_value=1500` —— **count 已等于 seal_count=1**。
bet2（`195e77ad`）随后构造，append intent 停在 `prepared`，`last_error`：

```
RPC Server (remote error) -> Rejected transaction 7ce4c2423822866e519bf991f613e40e2d4cecd5049c33be6a6474b8259354d6:
failed to verify the signature script: script ran, but verification failed
```

**diagnose-append.mjs 对 Codex 假设的直接核验**（`evidence/diagnose-sc1_bet2-195e77ad.json`）：

- `sealIntents: []` —— 该市场**没有任何** seal 意图存在（既没有 landed 也没有 prepared 的）。
- `leafOutpoint = {b41078...570aa:0}`，活节点查询 `leafOutpointStillUnspent: true`。
- `heldOutpointRaw = {b41078...570aa:2}`，活节点查询 `heldOutpointStillUnspent: true`。
- bet2 构造时读到的 `currentStateAtBuildTime = {local_yes:1500, local_no:0, count:1, pool_value:1500}`，
  与生产 covenant 入口用同一套 `ctorBytes32V100`/`ctorIntV100` 独立重算的 `entryAbiArgs` 完全一致，
  `entryAbiEntryFound: true`（找到了 `register_append` 入口，ABI 未错位）。
- `txDump` 显示这笔失败交易有 3 个输入（leaf、held-KTT、一笔 relay fee UTXO）、4 个输出（新
  leaf covenant / 新 held-KTT covenant / 找零 / …），签名脚本长度均非零（`sigScriptLen` 17912/
  3215/66 字节），不是"签名缺失"这类粗糙错误。

**结论：Codex 的具体假设被独立证据推翻** —— 被拒绝交易引用的 leaf UTXO 和 held-KTT UTXO 在诊断时刻
（拒绝之后）**真实仍未被花掉**，且**根本不存在任何 seal 交易**（意图表里为空）。这不是"针对已变更叶子
状态的正确拒绝"，节点看到的确实是与我们独立重算完全一致的旧状态输入，构造仍然验证失败。

## Group B（seal_count=2，生产主流形状）—— 干净成功

`marketId=7ac93fd9...cf619`。bet1（`92e57cd3`）落地 `landed_depth=25`；bet2（`fd7a2b8a`）
**同样是"第二笔 sequential append"，构造时读到 count=1**（bet1 已落地后的真实状态），
**成功落地** `landed_depth=39`；随后市场 seal 意图自动 `landed`（`landed_depth=38`），
市场最终状态 `status='sealed'`。

（过程中一次性遇到 fee UTXO 碎片化导致的 `no_suitable_fee_utxo` 中间失败，通过给 relay 追加 3 笔
新的 0.99 KAS UTXO 解决，驱动自动重试后正常落地——这是本组 harness 侧资源问题，不是本次要测的
append 构造缺陷，未改任何代码，详见下方"未解决的旁支"。）

**结论：生产主流形状（seal_count=2）下，第二笔 append 干净成功，市场正常 seal。**

## Group C（seal_count=3）—— 阻塞,未能取得数据(诚实记录,非掩盖)

`marketId=5510ee51...657eb7`，市场卡在 `genesis_pending`，**从未进入过 betting 阶段**，
本组**零下注数据**。

根因：genesis 交易构造时，`selectFeeUtxoByConstruction`（`proto-tx-assembly.mjs:209-226`）按
升序尝试 fee UTXO，选中的 0.392088 KAS 候选是第一个能成功 BUILD 的（其值刚够覆盖 genesis 的
~0.2 KAS 输出要求），但选中后该候选的净损耗超过 `dynamicNetLossCeiling`
（`proto-tx-assembly.mjs:238-243`：`min(requiredFee×2, absFeeCapSompi, 100_000_000n)`），
被拒 `net_loss_exceeded`，而该选择函数**是第一个成功 BUILD 就返回**，不会在净损耗检查失败后
回退去尝试更大的 0.99 KAS 候选。

**尝试修复（均未改代码，全部回退）**：试图用 relay 的 `consolidate_utxo` IPC 命令（经
`/api/operator/settle-command` 管理端点，需 `ADMIN_OPERATOR_SETTLE_ENABLED=1` +
`ADMIN_SECRET_OPERATOR_SETTLE` + `x-kanet-admin-secret` 头）合并零散 UTXO。命令返回
`{"ok":false,"reason":"balance_too_low_after_fee","balance":"1.481981"}`。追到
`kasia-relay/src/lib/utxo-split.mjs:178-265` 的 `consolidateUtxosRelay`：要求
`totalBalance > feeReserve`，其中 `feeReserve = CHANGE_FLOOR(500_000_000n = 5 KAS) + entries.length×100_000`。
**这与生产安全上限 `PROTO_MAX_BALANCE_KAS=5` 结构性不相容** —— 任何被这条上限约束的 relay，
余额永远摸不到 5 KAS，`consolidate_utxo` 对这类 relay 永远不可用。判定为**真实死胡同**（不是
"没试够"），临时加的两行 env（`ADMIN_OPERATOR_SETTLE_ENABLED`/`ADMIN_SECRET_OPERATOR_SETTLE`）
已 `sed` 删除还原。

**诚实说明**：Group C 因此**没能提供**"seal_count=3 下，两笔成功、第三笔超阈值"这条本应最有力的
对照数据。这是 harness 资源限制导致的空缺，不是回避——below 的结论完全建立在 A/B 两组之上，不借
Group C 的缺失掩盖或夸大任何一边。

## 结论（按 Bettor 要求分开写，互不掩盖）

**(A) 装配缺陷是否在 seal_count=2 生产形状下存在？—— 不存在。**
Group B 是 mainnet 市场 `a59c7b48` 同款的生产主流形状（`seal_count=2`）：第一笔下注落地后，
第二笔 sequential append（构造时 count 从 1 到 2，**恰好达到** seal_count）干净构造、签名、
广播、落地，市场随后正常 seal。9-22 报告"任何两人以上参与的市场都无法正常运作"这句判断
**被本次矩阵证据推翻，是过度概括，特此更正**——按 mainnet 实际用的 seal_count=2 跑，完整走通。

**(B) API 是否在达到 seal_count 后仍受理下注？—— 存在，是独立缺陷，不因 (A) 被掩盖。**
Group A（`seal_count=1`）里，bet1 落地后市场 `count` 已经等于 `seal_count`（=1），但 bet2 仍被
HTTP 层受理（进 `pending` 状态并生成了 append 意图，即请求本身在 API 层没有被以"已达到/超过
seal_count"为理由拒绝）。这个"API 层没有对已达阈值的市场做下注截止校验"的缺陷，独立于 (A)
是否成立都存在，也不该被 (A) 的"不存在"结论盖过。

**两者的关系（本次矩阵新发现，更正 9-22 的定级框架）**：真正触发 append 构造失败的**不是**
"这是市场的第二笔 sequential append"这个笼统条件（Group B 反例已推翻），而是更窄的条件：
**append 会使确认下注数超过 seal_count**（Group A：1→2，超过 seal_count=1，失败；Group B：
1→2，恰好达到 seal_count=2，成功）。因为只跑了 A/B 两组、Group C 阻塞未取得数据，**这条更窄
假设本身还只是两组样本支持的假设，不是已证实的规律**——留给下一步验证（比如把 Group A 改成
seal_count=2 但故意受理第 3 笔下注，直接测"超过阈值"这个变量，而不必依赖 Group C 的 genesis
问题）。

## 未解决的旁支（记录，非本次结论依据）

- Group B 一度出现的 fee UTXO 碎片化排除 0.99 KAS 候选的具体机制未彻底根因（怀疑与 relay 自身
  `facts:true` IPC 路径对 covenant 标记有关，区别于原始 RPC 数据），已用追加资金规避，未深挖。
- Group C 的 `net_loss_exceeded`/`consolidate_utxo` 死胡同已如上记录，未修代码。

## 约束遵守

- 全程未触碰主网（pid `16464`）、未触碰 J2 D-032 树（`_j2_d032_e2e`，pid `24872`）。
- 未改任何仓库 `src/` 源码；两行临时 admin env 已回退还原。
- 只报事实，不越权定级，未提交任何修复。
- 收尾已停本组全部 kaspad/console/miner 进程，PowerShell 进程列表核对无残留（保留主网与 J2 进程）。

—— NWT, 2026-09-23
