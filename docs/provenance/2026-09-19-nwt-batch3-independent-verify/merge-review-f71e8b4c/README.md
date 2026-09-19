# J2 结算批 1–5 合入审（合入候选 f71e8b4c）— NWT 2026-09-19

审点：`f71e8b4c`（`coord/j2-settlement-merge-candidate-1`，J2 侧分支 merge origin/bshard-m3-deploy，零冲突）。在我自己的 review worktree（`scratch/_nwt_wt_j2_7f1e339b` 检出该 commit，独立 `npm ci` + `npm rebuild better-sqlite3`）里只读运行，未改任何文件、未向节点提交交易。
diff 规模：相对 `origin/bshard-m3-deploy` 71 个文件、+7,327/−44（大部分是新增的、未接线的模块与 provenance）。

## 结论：GREEN（可 --no-ff 合主线），带 3 条"接线前"条件和 1 条重启验收项

## 1. 逐点

**① 三个新模块（2cce8f1b，均未接线）**
- `proto-signing-key-binding.mjs`（Codex MUST-PROVE）：推导链正确——不信 DB 里的 `bettor_pk`，而是用 `bettor_pk+side+stake+marketId` 重算 PoolSideTicket 的 P2SH，必须等于**链上 ticket UTXO 的 spk**（P2SH 是脚本哈希，`bettor_pk` 不同则不可能碰撞），再断言手上私钥的公钥与之**按字节**相等（`Buffer.equals`，不是字符串比较），不等即在任何 IPC/签名之前 throw；私钥对象 `free()`；错误信息不含私钥。8/8 通过。它守住的正是 Codex 指出的"`bettorPk==committeePk[0]` 是实现决定不是协议保证"。
- `proto-settlement-inputs.mjs`（B4-4）：胜方与 payoutRoot 由 DB 派生，且我**对照 `RootClaim.sil:112-127` 核了 leaf 公式**：`leaf = blake2b(bettorPk ‖ (payout as byte[8]))`，depth 0 时 `require(cur == payoutRoot)` 且 `merkle_index < div(=1)`，J2 的 `payoutLeafHex`（`le8(payout)` 小端 8 字节）与合约一致；`payout>=1000`、`payout<=pool_value` 两条合约约束在 fail-closed 里都有；"胜方确认下注恰 1 条"、"库内 payout_root 须等于现算"两条额外拒绝合理。14/14 通过。
  - 建议（不阻塞本次合入，写进批 9 接线 MUST）：`poolValue` 现在是 `Σ 已确认 stake`（DB），与 RootClose 链上 state 里的 `pool_value` 只是**隐式**由 B4-5 的 spk 断言相连；驱动层调用 `assertCloseCommitArgsFromDb` 时应把**已被 spk 断言证明的链上 pool_value**作为 `expectedPoolValue` 传入并显式相等。另 `winning_side` 的来源（操作员 resolve 写库）是 v0 单操作员的信任根，需要在驱动层文档里写明。
  - 次要：`require('../../node_modules/@noble/hashes/blake2b.js')` 写死相对路径（仓内其他模块用 `import … from '@noble/hashes/blake2b'`）；node_modules 布局一变会断，改成同一 import 风格更稳。
- `proto-close-commit-gate.mjs`（B4-2 根治）：判据用节点 `getBlockDagInfo.pastMedianTime`，与共识的 `lock_time < pmt`（严格小于，`tx_validation_in_header_context.rs`）同一量；30 s 余量（pmt 只增不减，判后提交无竞态）；读不到 → `canSubmit=false`（fail-closed）；同一个 pmt 判 B4-3 SLA（≥deadline+1h 报警，≥deadline+2h `refund_flip_open`）。7/7 通过。注意点：`sla==='refund_flip_open'` 时 `canSubmit` 仍可为 true，驱动必须把它当"尽力抢在别人 refund_flip 之前"，并让意图状态机对"已被翻成 closed=2"这种结果幂等；读 pmt 的节点必须与最终提交所用的是同一个节点。

**② N-1 步骤①（leaf 面值 == CONTINUATION）**：`assertLeafStateMatchesChain` 现在要求 `chainUtxo.value` 存在且 `BigInt(value) === CONTINUATION_OUTPUT_SOMPI`，缺失/偏小/偏大都 fail-closed；仓内**唯一**生产调用点 `proto-broadcast-ops.mjs:167` 已传入来自 `get_address_utxos` 的真实面值（`findUtxoValueAt`）；测试里原来"同一 outpoint 既当 leaf 又当 fee"的不真实 mock 已订正。`proto-leaf-state` 33/33、`proto-broadcast-ops` 16/16、`proto-driver` 8/8 通过。
  - **范围提醒（接线前条件 C1）**：这个断言目前只在 **register_append 路径**。批 3/4/5 的 builder（market_seal 花 leaf；close_commit、convert_to_claim 花 RootClose）**没有**对各自 covenant 输入的链上面值做断言，builder 一律按 `CONTINUATION_OUTPUT_SOMPI` 常量计。RootClose 的面值风险比 leaf 更大：`convert_to_claim` 与 `refund_flip` 都是**无签名可调**的（`RootClose.sil`），输出面值只要求 `>= DUST_MIN`，任何人都可以把 RootClaim/翻转后 RootClose 的面值定成任意值——批 6/7 的 claim_draw/withdraw 输入会继承这个不确定性。所以批 9 接线时，每个结算 builder 在花任何 covenant 输入前必须核**链上面值**（seal 的 leaf、close_commit/convert_to_claim 的 RootClose），与 held 已有的 `assertHeldKttOutpointMatchesChain` 对称。

**③ fee cap**：`market_seal` 已换 52,000,000。`convert_to_claim`、`close_commit` 我已按 F3' 同法出数（见 `batch5-fullchain-bytes/README.md` §4，wasm 对真实形状 6 点逐位相等）：**`convert_to_claim` = 52,000,000**、**`close_commit` = 30,000,000**（原借 1.0 KAS）。失效条件同 F3'。

**④ 迁移 v210**：接在 v209 之后；`CREATE TABLE IF NOT EXISTS proto_settlement_intents` + 两个 `CREATE INDEX IF NOT EXISTS`，不涉及 ALTER 既有表；块本身无版本守卫但完全幂等（每次启动执行无副作用）；CHECK 约束只列已批准的六步与三种 subject_type。风险面最低的一类迁移。

**⑤ `PROTO_SETTLEMENT_DRIVER_ENABLED`**：本候选里不存在（批 9），已核 diff 里无该键，无对象。

**⑥ 对下次重启的运行时效果——需要单列验收项**（J2 如实报的六条我逐条核过，和 diff 一致）：
- 重启后**立即生效**的：`migrate.js` 建表（幂等、无数据副作用）。
- 重启后**在下注/建市场路径上生效**的：`proto-tx-assembly.mjs` 给 `market_genesis` 与 `register_append` 接入 `assertMassWithinCeiling`（精确 storage/compute，阈值 475,000）；`proto-leaf-state` 的 leaf 面值断言。二者都是**收紧**（只可能多拒、不改字节），但**会改变主网 bet 的可构造窗口**：bet1 形状下可行的 fee UTXO 面值区间约 **[0.93, 1.0] KAS**（下限取自 J2 在 `proto-tx-assembly-register-append.test.mjs` 注释里的扫描：0.925 KAS storage=479,283 被拒、0.93 KAS 通过——**该扫描是 J2 的记录，我用同一公式抽查了 85M/90M/95M/100M 四个点吻合，没有重扫 0.925–0.93 之间**；上限是 `SIGNED_INPUT_CEILING` 1.0 KAS 封顶），区间外要么 fee 吃光找零、要么 storage 越阈——**主网 relay 必须持有落在该区间里的 UTXO**（设计里的 0.95 KAS 种子面值在区间内，457,504 通过）。
- `ingest.js` 的 `settle:` 分支：驱动未启用，没有调用方会发 `settle:` 前缀的意图，惰性；但该路由本身受 `x-ingest-secret` + `PROTO_RELAY_ID` 鉴权（已有测试 403/409），无新增未鉴权面。
- **重启后的验收项（建议写进那次重启的 runbook）**：(a) 日志出现 `[migrate] v210: …` 且 `sqlite_master` 里 `proto_settlement_intents` 与两个索引存在（只读查询）；(b) 主网库 `proto_markets`/`proto_bets` 行数与重启前一致（无副作用证据）；(c) **build-only 空跑**（不广播）：用主网当前 relay 的真实 UTXO 集对下一个市场的 bet1/bet2 形状各跑一次构造，确认 mass 断言与 leaf 面值断言**不会误拒**——当前主网没有在线可下注的市场（a59c7b48 已过 deadline），所以重启当下没有真实调用能踩到这条路径，这个空跑是唯一能在下一个市场开盘前发现"窗口没有可用 fee UTXO"的办法；(d) 重启前备份主网库（沿用既有纪律）。

## 2. 接线前条件（批 9 之前）
- **C1** 见②：seal/close_commit/convert_to_claim 各自的 covenant 输入链上面值断言。
- **C2** `assertCloseCommitArgsFromDb` 加 `expectedPoolValue`（链上已证）显式相等。
- **C3** B4-2 的 `checkCloseCommitTiming` 与 builder 的 300 s 墙钟守卫是"两层"：接线时以 pmt 判据为准，300 s 守卫保留但不得反过来阻止 pmt 已放行的提交（否则会因本机时钟偏差卡死）——请在批 9 里用同一份 deadline/时钟来源做一条一致性测试。

## 3. 我跑了什么
新增/变更测试全绿：`proto-signing-key-binding` 8/8、`proto-settlement-inputs` 14/14、`proto-close-commit-gate` 7/7、`proto-settlement-intent`（全 PASS）、`ingest-settle-dispatch`（全 PASS）、`proto-leaf-state` 33/33、`proto-broadcast-ops` 16/16、`proto-driver` 8/8、`proto-covenant-builder` 16/16、`proto-mass-ceiling` 16/16、`proto-tx-assembly-settlement` 40/40、`proto-tx-assembly-settlement-golden` 12/12。新增行里没有私钥/助记词/真实主网地址（只有 simnet 交易 JSON）。

## 4. 未做
- `computeMarketGenesisArtifacts` 的重构（抽出 `computeRootClaimAndRefundClaimTmplHashes`/`computeCommitteeHash`）我没有做前后差分（该函数内部生成随机委员钥匙，无法在不打桩的情况下比字节）；证据 = 测试 16/16 + simnet 上用新代码建的 genesis 被节点接受 + 全链六笔。
- 未在主网做任何事。
