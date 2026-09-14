# 主网 CloseZkV2 创世四函数自动触发面核查 v0.1（2026-09-14 · KANet-UI · Bettor 1217-补 派工 · 只读核实）

> **Status: CURRENT**。背景：主网 console PID 15396 跑的是合入前代码，磁盘上 `kasia-console/src/lib` 的 `.sil` 已是合入后版本；`SILVERC_ZK_PATH`/`SILVERC_LEGACY_PATH` 指向的旧编译器解析不了新语法。本页只读核实：`ensurePayoutShardV2`/`computeCloseZkTmplAnchor`/`compileCloseZkV2Redeem`/`buildCloseZkV2GenesisFromAttestedState` 这四个函数，当前主网 console 上有没有任何**自动**路径能摸到——**结论：没有，且不是单一原因兜底，是四层独立阻断同时成立**。本页不改任何代码/配置。

## 0. 调用链（从下游到上游逐层核实，全部读代码得出，不猜）

```
ensurePayoutShardV2(pool-shard-register.mjs:283)
  ← _registerBettorOnShardInner(同文件:355，三元表达式，仅当 zkNative===true 才走这个分支)
    ← registerBettorOnShard(同文件:329，导出函数)
      ← pool.js:1587/:1846（POST /api/pool/market/:id/bettor/register-v07 与 .../register-v07/confirm 两个端点，各自把 zkNative 传进去）
        ← zkNative 的值来自 _resolveZkNativeCtorExtras(pool.js:163) 读 market.resolution_rule_spec 的 zk_native 字段（市场自己的建市元数据，不是运行期推断）

computeCloseZkTmplAnchor(pool-shard-register.mjs:189)
  ← 同上 pool.js 两处端点（经 _resolveZkNativeCtorExtras 内部调用，pool.js:180）
  ← buildZkHandoffRequestV2(bshard-close-transport.mjs:481，同函数内部调用，:518)

compileCloseZkV2Redeem(closezk-v2-mint.mjs:67)
  ← buildCloseZkV2GenesisFromAttestedState(同文件:224/:227)

buildCloseZkV2GenesisFromAttestedState(closezk-v2-mint.mjs:224)
  ← 本仓非测试代码里**零调用点**（只有 closezk-v2-mint.e2e.test.mjs 调用它，生产代码里没有任何文件 import 这个函数）——独立于下面 buildZkHandoffRequestV2 是否被触发这个问题之外，这个函数目前连"有没有被自动调"这个问题都不成立，因为它现在压根没有生产调用点。

buildZkHandoffRequestV2(bshard-close-transport.mjs:481)
  ← POST /api/admin/pool/zk-handoff-v2（pool.js:1918，人工 admin 端点）
  ← zk-autonomy-ticks.mjs 的 zkHandoffAutonomousTick（bshard-settle-daemon.mjs 通过 ctx 注入，:1121/:359）
    ← startZkHandoffAutonomousTickCron()（bshard-settle-daemon.mjs:1115 附近，index.js:725 import）
```

## 1. 四层独立阻断（任何一层单独成立就够，本页确认四层同时成立）

### 层① 零市场——即便下面三层全部失效，这一层单独就够
```
pool_markets count: 0
payout_shards count: 0
```
（本人只读查 `console.mainnet.db` 实核，2026-09-14）。`registerBettorOnShard`/`ensurePayoutShardV2`/`buildZkHandoffRequestV2` 全部要求一个已存在的 `market_id`/`logicalMarketId`（`buildZkHandoffRequestV2` 甚至要求这个市场已经有 `payout_shards` 行且状态 `closed===1`，即走完整个 committee-attest 流程之后）——**当前库里连一个市场行都没有，这四个函数目前没有任何输入可以作用**，不是"路径关着但市场已经在排队等"。

### 层② 五个自治 cron 定时器全部未启用——`kanet.mainnet.env` 里根本没写这五行
```
SETTLE_DAEMON_ENABLED        （absent，代码判据 === '1'，unset ⇒ false）
ZK_CLOSE_TICK_V2_ENABLED     （absent）
ZK_CLAIM_TICK_ENABLED        （absent）
ZK_HANDOFF_TICK_ENABLED      （absent——这一个正是会调 buildZkHandoffRequestV2 的那个 tick 的开关）
ZK_JUDGE_PROPOSE_TICK_ENABLED（absent）
```
本人 `cat kanet.mainnet.env` 全文核实过，这五个变量名在文件里一次都没出现；`bshard-settle-daemon.mjs` 每个 `start*Cron()` 函数开头都是 `if (!ENABLED) { log('...not starting'); return; }` 这个模式（同 `startSettleDaemonCron():1036` 一致写法）——`index.js:725` 虽然 import 了这五个函数，**import 只是把函数定义拿进来，不等于启动**，真正的启动由 `index.js` 里各自调用点决定，且调用点内部第一行就是这个 env 门，未设就直接 return，不进 `setInterval`。

另外 `BSHARD_CLOSE_VOTER_V2_ENABLED=0`/`BSHARD_CLOSE_SUBMIT_V2_ENABLED=0` 是**显式写成 0**（不是缺失）——这两个门控的是让市场能走到 `closed=1` 状态的 V2 committee-attest 投票/提交本身，即便有人手工建了一个 zkNative 市场，这两个显式关闭也会挡住它走到"能被 `buildZkHandoffRequestV2` 处理"的状态。

### 层③ 市场创建/自动下注三大开关全部为 0——没有任何自动路径会创建 zkNative 市场
```
POOL_SEEDER_ENABLED=0       （唯一已知的自动建市场机制，市场创建这一步就被挡住）
PREDICTION_AGENT_ENABLED=0
AUTO_BET_TICK_MS=0
```
`registerBettorOnShard` 的 `zkNative` 参数**必须由上层市场创建流程显式传 `true`**（`pool-shard-register.mjs:349` 注释原话："上层市场创建流程必须自己知道这是 ZK-native 市场才传 zkNative:true，ShardLeaf/register 主体逻辑本身不感知/不判断市场类型"）——不存在"默认判定成 zkNative"这种推断路径，且这三个自动建市场/自动下注开关全部是 0，没有任何自动机制会去创建带 `zk_native:true` 的市场行本身。

### 层④ 唯一的人工触发口（admin 端点）本身在这个实例上不可用，不只是"需要人手"
`POST /api/admin/pool/zk-handoff-v2`（`pool.js:1918`）：
- 第一道门 `process.env.ADMIN_ZK_HANDOFF_V2_ENABLED !== '1'` → 直接 503（这个 env 同样在 `kanet.mainnet.env` 里缺失）。
- 第二道门 `checkAdminSecretTier(request, 'ADMIN_SECRET_ZK_STATE_PREP')`——`kanet.mainnet.env` 本身在"未决定"区块明确写着"ADMIN_SECRET* 系列...待定，本文件先不写=对应 admin 端点在这个实例上不可用"，这不是本页新发现，是部署时就已经记录在案的既有状态。
- 第三道门 IP allowlist（默认只放行 `127.0.0.1`/`::1`）。
三道门都在，第一道已经 503，后两道压根摸不到——**这个端点当前不是"存在但要有权限的人才能调"，是"字面意义上调不通"**。

## 2. 最小守卫方案（②，只写不做——因为①已确认"无"，这里给的是防御性、面向 pin 修补部署之后的建议，不是当下必须马上做的补丁）

**当前结论是"无自动触发"，不是"有但概率低"——所以严格意义上不需要立即打任何补丁。** 但 Bettor 1217-补 末尾"操作纪律：pin 修补部署前，主网 console 不创建任何市场、不触发创世"这条本身就是最有效的守卫——本页把它翻译成三条具体、可核的操作边界，供部署前对照：

1. **不新写以下五个 env 到 `kanet.mainnet.env`**（在 pin 修补部署、旧编译器换掉之前）：`SETTLE_DAEMON_ENABLED` / `ZK_CLOSE_TICK_V2_ENABLED` / `ZK_CLAIM_TICK_ENABLED` / `ZK_HANDOFF_TICK_ENABLED` / `ZK_JUDGE_PROPOSE_TICK_ENABLED` / `ADMIN_ZK_HANDOFF_V2_ENABLED` / `POOL_SEEDER_ENABLED`（改非 0）——这些都已经是 unset/0 的默认安全态，纪律就是"维持现状，不主动开"。
2. **不手工调用** `POST /api/pool/market/create*`（带 `zk_native:true` 的 `resolution_rule_spec`）——即便所有 cron 都关着，人手动建一个 zkNative 市场仍然会让这四个函数第一次被真实调用，届时会撞上旧编译器解析不了新 `.sil` 语法这个问题（本页调查触发的原因）。
3. **`BSHARD_CLOSE_VOTER_V2_ENABLED`/`BSHARD_CLOSE_SUBMIT_V2_ENABLED` 保持 `0`**（当前值，不要求改动，只要求维持）——这是层②里独立于五个 cron 之外的第二道闸，即便前面全部被打开，这两个还关着，市场也走不到 `closed=1`。

**是否要额外加一条代码层面的前置检查**（比如 `computeCloseZkTmplAnchor`/`ensurePayoutShardV2` 内部主动检测"当前编译器能不能解析这份 `.sil`，解析不了就 fail-loud 而不是产出错误字节"）——本页认为这属于"pin 修补"本身要解决的问题（既然合入后的 `.sil` 语法变了，正确修法是让主网侧的编译器/`SILVERC_*_PATH` 指向也跟着更新，而不是给旧编译器加一层"猜它会不会解析错"的检测），不在本页范围内重复设计，留给 pin 修补方案自己解决。

## 3. 结论

**①**：本人独立核实过——当前主网 console 上，`ensurePayoutShardV2`/`computeCloseZkTmplAnchor`/`compileCloseZkV2Redeem`/`buildCloseZkV2GenesisFromAttestedState` 这四个函数**没有任何自动路径**（cron/scanner/Mind/settle-daemon 均未启用，且即便启用了也无市场可作用）能触达。四层独立阻断（零市场 / 五个自治 cron 全 unset / 建市场三开关全 0 / 唯一人工 admin 端点字面不可用）同时成立，不是靠单一薄弱环节撑着。**③**：证据见 §1 四层核实，均为本人直接读代码 + 只读查 `console.mainnet.db` 得出，非转述。

`pin` 修补部署前，操作纪律按 Bettor 1217-补原话执行：主网 console 不创建任何市场、不触发创世。
