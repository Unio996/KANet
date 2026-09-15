# 账本 1458/1459: committee-offset-derive WARMUP FAIL 回归修复 — 隔离实例验证证据

## 背景

Owner 批准"闸1"执行、主网 console 重启后，stderr 出现 4 行
`[committee-offset-derive] WARMUP FAIL`（重启前 0 行）。根因：账本 1415 从
PayoutShard.sil/PayoutShardV2.sil/RootClaim.sil/RefundClaim.sil/CloseZkV2.sil 的构造参数里删除了
`market_suffix_hash`（v0.3 方案C 同病同治），但同一轮明确裁定"12 个 JS 消费者这次不改"。
`committee-offset-derive.mjs` 的启动期预热（ledger 1247，observability-only）用的占位 ctor
（`_ctorV1`/`_ctorV2`）仍按旧的 25/30 参数形状构造，导致 silverc 编译报
`constructor argument count mismatch: expected 24, got 25`（V1）/ `expected 29, got 30`（V2）。

复核过程中发现，同一根因（1415 删除 market_suffix_hash 未全仓传播）实际影响范围比 committee-offset-derive
的预热更大——多个**生产编译函数**（真正会在市场创建/settle/zk_handoff 路径上跑）仍传旧参数，一旦有人真的
创建 v1_committee/v2_zk 市场就会 100% 编译失败。见下方"分类清单"。

## 修复范围（分类清单，逐个说明是否作用于生产运行期）

### (a) 主网 console 运行期会执行 — 必须改，已改

| 文件 | 函数 | 原因 |
|---|---|---|
| `kasia-console/src/lib/committee-offset-derive.mjs` | `_ctorV1`/`_ctorV2` | 启动期预热（ledger 1247），4 行 WARMUP FAIL 的直接根因 |
| `kasia-console/src/lib/pool-shard-register.mjs` | `compilePayoutShardRedeem` | `ensurePayoutShard`（市场注册主路径）调用，传 25 个值（应 24） |
| `kasia-console/src/lib/pool-shard-register.mjs` | `compilePayoutShardV2Redeem` | `ensurePayoutShardV2`（ZK-native 市场注册）调用，传 30 个值（应 29） |
| `kasia-console/src/lib/pool-shard-register.mjs` | `computeCloseZkTmplAnchor` | `pool.js`（genesis-mint）+ `bshard-close-transport.mjs`（zk_handoff）两条生产路径调用，传 5 个位置参数（应 4） |
| `kasia-console/src/lib/closezk-v2-mint.mjs` | `compileCloseZkV2Redeem` | zk_handoff 铸 CloseZkV2 genesis 的实际调用点，传 28 个值（应 27） |
| `kasia-console/src/lib/closezk-v2-mint.mjs` | `buildCloseZkV2GenesisFromAttestedState` | 对 `computeCloseZkTmplAnchor` 的 5 参调用——签名收窄后若不同步删，`marketSuffixHash` 会静默错位绑到新的第 5 位形参 `v100Path`（暗雷，不抛错） |
| `kasia-console/src/lib/bshard-close-transport.mjs` | `buildZkHandoffRequestV2` 内对 `computeCloseZkTmplAnchor` 的调用 | 同上位置参数收窄同步 |
| `kasia-console/src/api/pool.js` | `_resolveZkNativeCtorExtras` 内对 `computeCloseZkTmplAnchor` 的调用 | genesis-mint 请求处理路径同步 |
| `kasia-console/src/services/utxo-splitter.js` | `autoSplitAll` | 账本 1459 追加：闸3阻断——每次 console 启动都会对原型 relay 发 split_utxo，破坏 canary 的 UTXO 形状 |

### (a′) 生产运行期会执行、但因参数是具名对象属性而"意外无害"——未改（保留 marketSuffixHash 传递，多余属性被目标函数忽略，不抛错，已用真实测试确认）

`kasia-console/src/lib/bshard-payout-family-coherence.mjs`（`assertPayoutShardCoherence` 步骤(c)）、
`kasia-console/src/services/bshard-auto-settler.mjs`（6 处 `compilePayoutShardRedeem` 调用）、
`kasia-console/src/services/bshard-settle-daemon.mjs`（2 处）、`kasia-console/src/lib/bshard-close-transport.mjs`
的 `assertZkHandoffTmplCoherent`（DB-vs-env 一致性核对，与 ctor 编译无关，未改动，功能不变）——均通过
JS 对象解构自动丢弃未声明的 `marketSuffixHash` 属性，不产生编译错误。`bshard-settle-daemon.mjs` 那一处此前
甚至因为该 bug 每次都进 catch 分支被非阻塞跳过（K-18 §3.3(c) 校验降级），本次修复后该校验反而能真正跑通了
（正面副作用，非本次目标）。

### (b) legacy TN12 脚本 / 只读诊断工具 — 不改

`kasia-console/scripts/t4-zk-tmpl-env-db-compare.mjs`（手动运行的只读比对脚本，非 console 运行期代码）、
`kasia-console/src/db/migrate.js`（market_suffix_hash 列定义 + NULL 回填诊断，按 1415 原裁定不做迁移改动）。

### (c) 测试夹具 — 已同步更新以保持全绿

`committee-offset-derive.test.mjs`、`closezk-v2-mint.e2e.test.mjs`、`closezk-v2-mint.ctor-position.test.mjs`（顺手修复一个与本次无关但同样已失效的既有缺口：BASE 一直缺 tokenTmplHash/claimTmplHash）、
`closezk-v2-anchor-crosscheck.test.mjs`。`bshard-payout-family-coherence.test.mjs`、
`payoutshardv2-offset-tripwire.test.mjs`、`closezk-v2-mint-atms-width.test.mjs`、
`bshard-consolidated-pool-rederive.test.mjs`、`thread-walk.test.mjs`、`windir-infer.test.mjs`、
`bshard-close-transport-zk-tmpl-coherent.test.mjs`、`bshard-payout-coherence-perf.test.mjs`——均以对象属性形式
传 marketSuffixHash，无需改动，已逐一真实跑通确认（见下）。

### 排除（Bettor 追问的其它自动 UTXO 管理路径，逐一核实）

- `kasia-console/src/lib/mining-utxo-consolidate.mjs`：只对 `process.env.MINING_RELAY_ID`（独立、显式配置的固定 env
  变量）操作，与 `PROTO_RELAY_ID` 无关，除非运维人员误将两者配成同一个 relay id（配置错误，非代码缺陷）。未改。
- `kasia-console/src/lib/broadcaster-utxo.mjs`：默认目标集 = `relay_nodes.is_oracle=1` 的行 ∪
  `POOL_SEEDER_MAKER_RELAY`。原型 relay 通常不会被标 `is_oracle=1`，但这是数据依赖、无法从代码静态排除——
  按 Bettor"可能的一律加同样的豁免"，已加同款 `PROTO_RELAY_ID`/`proto-` 前缀过滤，防御性收紧，功能不变。
- `kasia-console/src/services/broker-intake-watcher.js`：grep 未命中任何 `split_utxo`/`consolidate_utxo` 调用，
  文件里的"sweep"指 retail_dex_orders 超时清理，与 relay UTXO 管理无关。未改，无需改。
- `kasia-console/src/lib/pool-shard-register.mjs:104`（`_maybeDefrag`，`rc({type:'consolidate_utxo'})`）：
  `rc` 是调用方传入的市场网关 relay 命令函数，只作用于走 `ensurePayoutShard`/`registerShard` 这条 v1_committee/
  v2_zk 市场注册路径的网关 relay；proto-v0 canary 走完全独立的 `proto-tx-assembly.mjs`/`proto-covenant-builder.mjs`
  模块树，代码里没有任何路径把 proto relay 的 `rc` 传给这个函数。未改，无需改。

## 隔离实例验证（Bettor 要求③：全新缓存/独立端口/空库/PROTO_RELAY_ID=proto-前缀）

```
DB_PATH=<全新迁移过的临时 sqlite 文件>
CONSOLE_ENCRYPTION_KEY=<测试用 64-hex>
PORT=39173（与生产 3100/3200 隔离）
PROTO_RELAY_ID=proto-test-relay-isolated
KASPA_RPC_URL=ws://127.0.0.1:19999（不存在的本地端口, 允许后续 RPC 相关逻辑 fail-closed, 不影响预热本身
  ——预热在 index.js:141, 早于任何 kaspad RPC 连接尝试）
node src/index.js
```

结果：`isolated-instance-stdout.log` + `isolated-instance-stderr.log`(本目录) 完整启动日志。
`grep -c "WARMUP FAIL"` 两个文件均为 **0**（对照：修复前主网重启产生 4 行）。控制台正常跑到
`[kasia-console] running at http://localhost:39173` 并继续初始化后台服务；`PROTO_RELAY_ID health check
failed` 是预期行为（这是一个全新空库，`relay_nodes` 表里本来就没有这个 id 对应的真实 relay 行，与
WARMUP 修复无关，fail-closed 是设计意图）。

## 测试证据（真实 silverc 编译，非 mock）

全部在本次修复后重跑，进程输出摘要见各文件自身（不逐条粘贴到本 README，避免过期漂移——命令如下，
需要时自行重跑核对）：

```
cd kasia-console
node src/lib/committee-offset-derive.test.mjs                     # ALL PASS
node src/lib/bshard-payout-family-coherence.test.mjs               # all checks passed
node src/lib/closezk-v2-anchor-crosscheck.test.mjs                 # ALL PASS
DB_PATH=<tmp> node src/lib/closezk-v2-mint.ctor-position.test.mjs   # ALL PASS
DB_PATH=<tmp> node src/lib/closezk-v2-mint.e2e.test.mjs             # ALL PASS
node src/lib/closezk-v2-mint-atms-width.test.mjs                   # ALL PASS
node src/lib/payoutshardv2-offset-tripwire.test.mjs                 # ALL PASS
node src/lib/bshard-close-transport-zk-tmpl-coherent.test.mjs       # ALL PASS
node src/lib/bshard-close-transport-coherence-gate.test.mjs         # all checks passed
DB_PATH=<tmp> node src/lib/bshard-payout-coherence-perf.test.mjs    # all checks passed
DB_PATH=<tmp> node src/services/bshard-consolidated-pool-rederive.test.mjs   # all checks passed
KASPA_RPC_URL=... KASPA_NETWORK=mainnet node src/services/thread-walk.test.mjs  # ALL PASS
DB_PATH=<tmp> KASPA_RPC_URL=... KASPA_NETWORK=mainnet node src/services/windir-infer.test.mjs  # ALL PASS
node --experimental-test-module-mocks --test src/services/utxo-splitter.test.mjs  # 4/4 pass（新增）
node scripts/lint-kanet.mjs <全部改动文件>                           # 0 errors
```

## D-021 合规

本文档 + 提交说明只写协议常量/测试夹具值（sentinel、dummy 32B hex）与文件路径/行为描述，不含任何真实
账户余额、私钥、或未修复漏洞的可利用细节。legacy bshard 路径的处置按 D-001 与铁律 0.5：零追加投入——
本次修复只为消除编译参数不一致（让 v1_committee/v2_zk 市场创建/结算路径重新能编译），不恢复、不新增任何
功能，不代表 rolling/covenant 跨节点方向的投入。
