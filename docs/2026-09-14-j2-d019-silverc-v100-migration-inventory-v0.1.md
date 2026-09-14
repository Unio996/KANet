# D-019 silverc v1.0.0 迁移 — SILVERC_ZK_PATH 调用点盘点 + 迁移结果 v0.1

> **Status**: CURRENT（2026-09-14 · J2 · ledger 1216-1227 派发，侧分支 `coord/j2-t4-genesis-compare`）

## 0. 一句话

`SILVERC_ZK_PATH`（`silverc-zk-8065184.exe`）对当前（T3 语法迁移后）主网集 `.sil` 源码已**结构性失效**——
不只是 ctor 参数数不对，是这个二进制**连解析都过不了**（`as byte[8]` 转型语法直接 parse error，实测确认，
非猜测）。本文档盘点全部 `SILVERC_ZK_PATH` 真实调用点，逐一迁移到 D-019 锚点（`silverc v1.0.0`@`3ed9733`，
`scripts/silverc-pin.json` 单源声明 + 二进制 sha256 + 黄金样本 deep-equal 双重同源校验），并如实记录一处
本次范围之外、同一病灶但更严重的相邻发现（`bshard-close-enforce.mjs`，已交 Bettor 裁另开独立笔）。

## 1. 调用点盘点表

| 文件 | 用法 | 编译哪个 `.sil` | 是否属主网集 | 是否已迁语法(v1.0.0) | 处置 |
|---|---|---|---|---|---|
| `pool-shard-register.mjs` `computeCloseZkTmplAnchor` | 真实调用 | `closeZkSilPath`(参数，生产实践中恒为 `CloseZkV2.sil`) | ✅ 是 | ✅ 是（`b5a2924c`） | **已迁**，ctor 25→28，`ac0b8427` |
| `pool-shard-register.mjs` `compilePayoutShardV2Redeem` | 真实调用 | `PayoutShardV2.sil` | ✅ 是 | ✅ 是（`f2fce916`） | **已迁**，ctor 27→30，`ac0b8427` |
| `closezk-v2-mint.mjs` `compileCloseZkV2Redeem` | 真实调用 | `CloseZkV2.sil` | ✅ 是 | ✅ 是 | **已迁**，ctor 25→28，`387e296d` |
| `pool-bshard-artifacts.mjs` | 仅注释提及，无实际编译调用 | — | — | — | N/A，无需处置 |
| `kasia-relay/src/lib/p2sh.mjs` | 仅注释提及（描述 `computeCloseZkTmplAnchor` 输出用途），无实际编译调用 | — | — | — | N/A，无需处置 |
| `kasia-console/scripts/verify-settle-sigs.mjs` | 仅注释提及（方法论引用），无实际编译调用 | — | — | — | N/A，无需处置 |

**生产调用点**（不直接定义 `SILVERC_ZK`，但调用上面已迁移的函数，本次一并跟进）：

| 文件 | 函数 | 处置 |
|---|---|---|
| `api/pool.js` `_resolveZkNativeCtorExtras`（两处调用，L1582/L1853） | zkNative 市场 genesis-mint ctor 组装点 | **已迁**：新增 `ZK_TOKEN_TMPL_HASH`/`ZK_CLAIM_TMPL_HASH`/`ZK_MARKET_SUFFIX_HASH` 三个 env（fail-loud，同 `ZK_GATE_TMPL_HASH`/`ZK_CLOSEZK_SIL_PATH` 既有纪律一致）。顺手删除一处死传参：原代码把 `silverc`（一个 `SILVERC_LEGACY_PATH` 路径字符串）当第三个位置参数传给 `computeCloseZkTmplAnchor`——该函数从来只有 2 个具名参数，这个位置参数一直被内部硬编码逻辑忽略（旧版函数注释原话"硬编码，不依赖调用方传参正确"），现在这个位置是真参数 `tokenTmplHash`，不删会让一个文件路径字符串被塞进 hex 校验（好在会被 fail-loud 拒绝，但报错费解）。 |
| `bshard-close-transport.mjs` `buildZkHandoffRequestV2`（L518） | zk_handoff 铸 CloseZkV2 genesis 的实际调用点 | **已迁**：同上三个新 env，同款 fail-loud。 |

## 2. 顺手发现、本次范围之外、如实记录的相邻问题

### 2.1 `bshard-close-enforce.mjs` 委员签名校验 offset 全部漂移（已交 Bettor 裁，ledger 1224 另开独立笔）

`payoutshardv2-offset-tripwire.test.mjs`（补齐 `compilePayoutShardV2Redeem` 新增调用参数后）实测确认
`bshard-close-enforce.mjs` 硬编码的 `_PREDICATE_COMMIT_REDEEM_OFFSET_V2=642` / `_PMR_COMMITTEE_CHECK_
OFFSETS_V2=[1126,1390,1654,1918,2182]` **全部漂移**——实测新位置 `predicate_commit` 落在
`[16569,16603,19990,20024]`，`poolMerkleRoot` 5 个委员检查点落在 `[17089,17385,17681,17977,18273]`，差了
约 15000 字节量级。这两组常量是 `close_attest`/`cancel_attest` 委员签名校验真正比对的字节位置——比
"ctor 参数数不对"更 severe（错了不一定报编译错误，可能悄悄比对无关字节）。

**处置（ledger 1224 Bettor 裁）**：另开独立报备笔（pin 收尾之后），范围：① 该文件生产调用链与语义梳理；
② 重新 live-derive + 拆分归因（ctor 位移 vs v1.0.0 codegen 各占多少）；③ 优先评估把硬编码 offset 改为
运行时从编译产物派生（或从 T4 单源产物读），tripwire 测试保留作漂移守卫；④ 厘清 `predicate_commit` 4 处/
`poolMerkleRoot` 5 处里哪一处才是真正的校验点、为什么；⑤ NWT 独立 live-derive 复核。

**本次处置**：`payoutshardv2-offset-tripwire.test.mjs` 已补齐调用参数（否则连编译都跑不到），但**保留该
测试文件当前 6 条断言 RED**——按测试自己的既定纪律"漂移了不准偷偷改常量，要去查原因"，不在本次范围内
静默修补。**这是已知的、有意保留的 RED，不是遗漏。**

### 2.2 `compilePayoutShardRedeem`/`compileShardLeafRedeem`（`SILVERC_LEGACY_PATH`）——已纳入本次范围，第 5 笔解决（ledger 1225-1227）

原 §2.2 记录的"未验证未修"缺口已由 Bettor 1225 纳入本次范围（"第 5 笔"）。前提确认（Bettor 1227，只读查
生产 `console.mainnet.db`）：`pool_markets=0`、`payout_shards=0`（9 列，无新字段）——**主网零存量市场、零
旧 shape 实例需要兼容**，不做新旧 shape 分支，直接迁移。

**5a（schema，`f09fcb31`）**：`payout_shards` 加 `token_tmpl_hash`/`claim_tmpl_hash`/`market_suffix_hash`，
`market_shards` 加 `shard_token_tmpl_hash`（v205，全 TEXT 允许 NULL，K-18"谁编译谁 declare"纪律的延伸）。

**5b（函数+调用点+DB 读写+测试，本笔）**：
- `compilePayoutShardRedeem`（22→25 参数）/`compileShardLeafRedeem`（11→12 参数）迁 `compileSilV100`，
  三个新字段 fail-loud（同 PayoutShardV2/CloseZkV2 那半一致纪律：ctor-only 字面量，不接受占位符）。
- `ensurePayoutShard`（genesis-mint INSERT 写入三新列）+ `registerBettorOnShard`'open_new'分支（写入
  `market_shards.shard_token_tmpl_hash`，经 `shard-allocator.mjs` `registerShard` 新增字段透传）。
- `bshard-payout-family-coherence.mjs`（`assertPayoutShardCoherence` tier=full 步骤(c)新增三列格式校验，
  同 `pool_merkle_root`/`predicate_commit` 一样"数据问题不是环境问题"分类）、`bshard-auto-settler.mjs`
  （6 处调用点+5 处窄 SELECT 全部拓宽）、`bshard-settle-daemon.mjs`（1 处非阻塞 recompile 校验+
  `consolidateAndBuildPsState` 返回值新增三字段透传给下游 `cancelMarketLive`）——**全部实测确认在
  R-PS-FAMILY-DISPATCH 白名单内，零新增调用点**。
- 顺手确认 `SILVERC_LEGACY_PATH` **不**标 deprecated：本文件内仍有 2 处真实调用点编译 `PoolSide_v08_shard.sil`
  （dust-ticket 模板，非主网集 10 文件之一，未在本次范围核实是否也需要迁移，留待独立评估）。

### 2.3 装配 5b 期间新增确认的两类发现（如实记录）

**① V1 offset 同样漂移（`bshard-consolidated-pool-rederive.test.mjs` 实测新证据，扩大 §2.1 的已知范围）**：
之前 §2.1 只确认了 V2（PayoutShardV2）的 `_PMR_COMMITTEE_CHECK_OFFSETS_V2`/`_PREDICATE_COMMIT_REDEEM_
OFFSET_V2` 漂移，`DATABASE.md` payout_shards 陷阱段落当时状态注记里"V1 offset（518/1002）未在 D-019 本批
范围内验证是否同样受影响"——**本次用真实 v100 编译器实测确认 V1 的 `predicateCommit@518` 同样漂移**
（`bshard-payout-family-coherence.mjs` `probeStructuralSignature` 内部硬编码的 `V1_PREDICATE_COMMIT_OFF=
518`/`V1_POOL_MERKLE_ROOT_OFF=1002`），归入 ledger 1224/1226 已裁定的"offset 重新 live-derive"独立报备笔
范围，不在本次单独处理。

**② 三个下游测试文件存在与 D-019 无关的既有 fixture/schema 陈旧（如实记录，未修，非本次引入）**：
`thread-walk.test.mjs`/`windir-infer.test.mjs`/`bshard-consolidated-pool-rederive.test.mjs`（场景 A/B）
在补齐三个新字段、绕过 ctor-arity 检查之后，**各自在更深处撞上与代币化字段完全无关的既有问题**——
- `windir-infer.test.mjs`：自带的 in-memory 手搓 schema（`CREATE TABLE payout_shards(...)`）与生产
  `pool_bettor_sides` 真实列（`id` 等）早已不一致，`getSidesByShard` 直接 `no such column: id`——这个
  schema 漂移与 token_tmpl_hash 无关，是这份 fixture 自己没跟上 `pool_bettor_sides` 某次既有改表。
- `thread-walk.test.mjs`：`settleMarketLive` 内部 `verifyRedeemMatchesChainObservedOutput` 对 `closeTxid:0`
  的链上核验缺对应 fixture（该文件的 `kaspa_tx_log`/`liveMap` 只覆盖了 `steps[k].txId` 这些续约态，从未
  覆盖过 `CLOSE_TXID` 本身这笔）——这条校验逻辑本身也不是本次改动引入的。
- **关键事实**：这三个文件在 D-019 迁移之前**本来就无法跑到这些问题**——`compilePayoutShardRedeem`
  原本 22 参数编 25 参数源码会直接抛 ctor-arity 错误（或 `SILVERC_LEGACY_PATH` 对当前语法解析失败），
  这些测试从合入 mainline (`4b48393a`) 那一刻起就已经是红的，只是从未被人跑过 / 跑过但被更早的报错掩盖，
  没人看到这一层更深的问题。**本次修补没有"弄坏一个原本能跑的测试"——是把一个更早的报错往后推了一层，
  露出了另一个本来就存在、与代币化无关的旧坑。**
- **处置**：已把三个新字段的 fixture 缺口补上（`TTH`/`CTH`/`MSH` 常量 + INSERT/SELECT 拓宽），这部分改
  动本身正确且必要；但**未继续修这两类无关的 schema/fixture 陈旧**（不在本次授权范围，且是与 D-019 完全
  独立的两个问题，各自需要独立诊断），如实标记为"预先存在、非本次引入、留待另行处理"。

## 3. D-019 锚点摘要（`scripts/silverc-pin.json`，单源，本文档不重复内嵌数值）

- 二进制 sha256（防调包指纹）+ 黄金样本 `RootClaim.sil`+13参数全零ctor+期望 bytecode sha256（真正同源判据，
  Rust 非可复现构建下二进制 sha256 本身不是同源判据——ledger 1221）。
- 生产二进制已放置：`D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe`（KANet-UI，provenance
  `66086cb6`，sha256 复制前后一致，ledger 1222）。
- 产物 schema：`contracts[<ContractName>].compiled.{bytecode(number[]), template_hash(number[]), state_span:{offset,len}}`
  ——落码期间自测更正一处最初的错误假设：`bytecode` 是字节数组不是 hex 字符串。
- ctor JSON 方言：`{kind:'bytes',value:[...]}`/`{kind:'int',value:n}`，与旧编译器的
  `{kind:'array',data:[...]}`/`{kind:'int',data:n}` 不通用（实测：旧方言喂 v1.0.0 CLI 直接
  `missing field 'value'` 拒收）。

## 4. 测试现状

| 测试 | 结果 |
|---|---|
| `closezk-v2-mint.e2e.test.mjs` | ✅ 11/11 PASS（新增 3 条断言验证三个新字段真的被烤进 redeem 字节） |
| `payoutshardv2-offset-tripwire.test.mjs` | 🔴 6/7 FAIL（**已知 RED**，见 §2.1，独立笔处理，不在本次范围内修） |
| `bshard-payout-family-coherence.test.mjs` | ✅ all checks passed（含 `seedRow`/两处 genesis-mint fixture 补齐三新字段，flip 式复核确认"hand-crafted fixture 拒于(c)"这条断言仍精确落在 recompile byte-compare、不是被新格式校验巧合掩盖） |
| `bshard-payout-coherence-perf.test.mjs` | ✅ all checks passed |
| `compileSilV100`/`assertSilvercV100Pinned`/`assertSilvercV100GoldenSample` | ✅ 正向+负向手工 smoke test 全部通过（正确 sha256/黄金样本匹配时放行；换错二进制/路径不存在/黄金样本不符均正确拒绝） |
| `bshard-consolidated-pool-rederive.test.mjs` | 🟡 部分 FAIL——场景 C/D/E 全 PASS；场景 A/B 撞上 §2.3① 的 V1 offset 漂移（同一 `bshard-payout-family-coherence.mjs` 步骤(b) 结构签名, 已知归属现有独立报备笔, 非新缺口） |
| `thread-walk.test.mjs` | 🔴 FAIL——撞上 §2.3② 的既有 fixture 缺口（`closeTxid:0` 无对应 `kaspa_tx_log`/`liveMap` 覆盖），与 D-019 无关，本次未修 |
| `windir-infer.test.mjs` | 🔴 FAIL——撞上 §2.3② 的既有 schema 陈旧（`pool_bettor_sides` 手搓 schema 缺 `id` 列），与 D-019 无关，本次未修 |
| `pool.js` import | ✅ 语法/模块加载层面通过（在无关的 `KASPA_RPC_URL` 环境检查处停止，非本次改动引入的回归——该环境变量与本次改动无关，在隔离 worktree 里预期缺失） |

## 5. 提交序列

1. `a500d192` — `scripts/silverc-pin.json` + `pool-bshard-artifacts.mjs` 新增 `compileSilV100`/`assertSilvercV100Pinned`/`assertSilvercV100GoldenSample`/`ctorBytes32V100`/`ctorIntV100`
2. `ac0b8427` — `pool-shard-register.mjs`：`computeCloseZkTmplAnchor`/`compilePayoutShardV2Redeem` 迁移
3. `387e296d` — `closezk-v2-mint.mjs`：`compileCloseZkV2Redeem`/`buildCloseZkV2GenesisFromAttestedState` 迁移 + e2e 测试更新
4. `051af204` — `api/pool.js`/`bshard-close-transport.mjs` 两个生产调用点迁移 + 本文档初版
5. `f09fcb31` — 5a：schema migration v205（`payout_shards`/`market_shards` 加代币化 ctor-only 列）
6. 本笔 — 5b：`compilePayoutShardRedeem`/`compileShardLeafRedeem` 迁移 + 全部消费点（`ensurePayoutShard`/
   `registerBettorOnShard`/`bshard-payout-family-coherence.mjs`/`bshard-auto-settler.mjs`/
   `bshard-settle-daemon.mjs`）改参 + 既有测试补齐三新字段 + 本文档 §2.2/§2.3 更新

## 6. 未完成/留待后续（ledger 1230 追加，尚未落码）

**启动期自检**：console 启动时若 `SILVERC_V100_PATH` 已设，跑 `assertSilvercV100Pinned`+
`assertSilvercV100GoldenSample`，LOUD 打印固定格式日志行（PASS/FAIL），失败不阻止 console 启动（只阻止
真正调用编译的路径，调用时的断言仍是唯一承重守卫）。另需确认三个 `ZK_*` env 是调用时读取（不是模块加载
时），部署环境未设置这些 env 不影响 console 正常启动。本笔尚未实现，留作独立小笔（"5c"）。
