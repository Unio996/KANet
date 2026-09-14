# D-019 silverc v1.0.0 迁移 — SILVERC_ZK_PATH 调用点盘点 + 迁移结果 v0.1

> **Status**: CURRENT（2026-09-14 · J2 · ledger 1216-1224 派发，侧分支 `coord/j2-t4-genesis-compare`）

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

### 2.2 `compilePayoutShardRedeem`/`compileShardLeafRedeem`（`SILVERC_LEGACY_PATH`）同类缺陷，本次未修

`pool-shard-register.mjs` 的 `compilePayoutShardRedeem`（22 参数）/`compileShardLeafRedeem`（11 参数）
分别编译 `PayoutShard.sil`/`ShardLeaf.sil`——**这两个文件正是 T3 代币化后的当前 25/12 参数主网集文件**
（同一份文件，不是历史快照）。这两个函数硬编码走 `SILVERC_LEGACY_PATH`（`silverc-legacy-2c46231.exe`），
未逐一验证该二进制对当前（v1.0.0 语法迁移后）`PayoutShard.sil`/`ShardLeaf.sil` 是否也像 `SILVERC_ZK_PATH`
对 `CloseZkV2.sil` 那样解析失败——**极可能是同一病灶的另一半（V1/委员签名 rolling-shard 家族的创世路径）**，
但严格说这不在 ledger 1218 点名的"全部 `SILVERC_ZK_PATH` 调用点盘点"范围内（这两个函数走的是
`SILVERC_LEGACY_PATH`），本次未动、未验证、未修，留给后续单独裁定是否需要同款迁移。

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
| `compileSilV100`/`assertSilvercV100Pinned`/`assertSilvercV100GoldenSample` | ✅ 正向+负向手工 smoke test 全部通过（正确 sha256/黄金样本匹配时放行；换错二进制/路径不存在/黄金样本不符均正确拒绝） |
| `pool.js` import | ✅ 语法/模块加载层面通过（在无关的 `KASPA_RPC_URL` 环境检查处停止，非本次改动引入的回归——该环境变量与本次改动无关，在隔离 worktree 里预期缺失） |

## 5. 提交序列

1. `a500d192` — `scripts/silverc-pin.json` + `pool-bshard-artifacts.mjs` 新增 `compileSilV100`/`assertSilvercV100Pinned`/`assertSilvercV100GoldenSample`/`ctorBytes32V100`/`ctorIntV100`
2. `ac0b8427` — `pool-shard-register.mjs`：`computeCloseZkTmplAnchor`/`compilePayoutShardV2Redeem` 迁移
3. `387e296d` — `closezk-v2-mint.mjs`：`compileCloseZkV2Redeem`/`buildCloseZkV2GenesisFromAttestedState` 迁移 + e2e 测试更新
4. 本笔 — `api/pool.js`/`bshard-close-transport.mjs` 两个生产调用点迁移 + 本文档
