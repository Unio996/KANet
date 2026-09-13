# (b) 网络单一源 + 前缀一致性 helper · patch 说明 v0.1（J2 · 2026-09-13 · 侧分支 `coord/j2-b-network-single-source`）

> **Status**: DRAFT-FOR-REVIEW（2026-09-13T11:2xZ · 交 NWT diff 审；b1 非钱路 Bettor 批 / b2 含 settler·voter·relay 钱路 Owner 批，两笔在同一分支两个 commit）· 设计 `docs/2026-09-13-j2-network-single-source-and-prefix-consistency-helper-design-v0.1.md` v0.2（NWT 7149e3a5 PASS）· NWT 负测规格 184bf6f5 §B。
> 产出方式：隔离 worktree（`scratch/_j2_wt_b_patch` 开发 → `scratch/_j2_wt_b_branch` 基于 5f1b908e 落分支），**独立 `npm install --prefer-offline`，不 junction 到 live**；live 树未动。
> patch：b1 `scratch/_j2_b1_kaspa_network_helper_2026-09-13T10-57Z.patch` sha256 `210799558e92440b8d29f62dd94fafb8abb7c602f97fe1fdf8e133a94809fa47`（6 文件 +274）· b2 `scratch/_j2_b2_network_sites_2026-09-13T11-12Z.patch` sha256 `3cd3d079caee38f5aba4aeced0f8e463cc204a5b3fe4dc5abdef1f486cdc1749`（20 文件 +105/−42）。

## b1 · helper + 包装 + 向量 + lint（WARN 级）

| 件 | 文件 | 要点 |
|---|---|---|
| 纯逻辑 | `shared/lib/kaspa-network.mjs` | `NETWORKS`（单向表 mainnet/testnet-12/devnet/simnet；**不含 testnet-11**，NWT Q2）· `configuredNetwork(env)`（I1 无默认，未设/未知 throw）· `prefixForNetwork` · `addressPrefix`（纯串）· `checkAddressOnNetwork(addr,{network,who,kaspa,env})` → `{ok}`/`{ok:false,code:empty\|invalid-checksum\|prefix-mismatch,…}` · `assertAddressOnNetwork`（throw `NetworkMismatchError`，返回**配置的**网络）· `isAddressOnNetwork`（boolean）· `rowNetworkMatches`（I4）。**只用 `kaspa.Address.validate()`，绝不构造 `Address`**（I3：坏校验和构造 = wasm `unreachable`）。kaspa **注入**（NWT Q3），零依赖。**不导出**任何"从地址得网络"的函数。 |
| 薄包装 | `kasia-console/src/lib/kaspa-network.mjs` · `kasia-relay/src/lib/kaspa-network.mjs` | 各自静态 import 自己的 kaspa-wasm 绑定后转发；站点只改一行 |
| 向量 | `kasia-console/src/lib/kaspa-network.test.mjs` + `.vectors.json` | V1–V12 + V3′（含 NWT V12 十一组对抗输入照抄断言；固定私钥 0x…01 派生四网地址与设计稿逐字核；V9 真实 spine_p2sh）· **51 断言全绿** |
| lint | `scripts/lint-kanet.mjs` `checkR_NET_PREFIX` | `R-NET-PREFIX-INFER` / `R-NET-PREFIX-EITHER` / `R-NET-DEFAULT-DRIFT`；b1 全 WARN（基线：INFER 30 · EITHER 3 · DEFAULT 48）；转义 `lint-allow-net-prefix-infer:` / `lint-allow-net-default:` |

## b2 · 33 处替换 + 入站限频 + lint 翻 BLOCK

| 类 | 处 | 落法 |
|---|---|---|
| 推断式 `X.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet'` | 29（12 文件；`scratch/_j2_b2_replace.mjs` 机械替换，`who` = 原文件:原行号） | `const network = assertAddressOnNetwork(X, { who })`。`(X \|\| '')` / `String(X \|\| '')` / `X?.` / `X && X.startsWith` 包装一律去掉：**空/坏值现在 reject，不再是 'mainnet'** |
| 其中**循环站点**改"核-跳过" | `broker-fee-emit.mjs:121`（for candidates） | `checkAddressOnNetwork` + `continue` + 计数 `netSkip`（一行坏/异网地址不许拖死整个 tick；D-017 过渡态存量 kaspatest 行 = I4 不进 live 路径） |
| 其中**入站站点**改"核-丢弃-限频" | `trade-protocol-filter.js` oracle-enroll（原 :371）· market-pub（原 :787）· bet-reg（原 :1434/:1470 合并为一次核） | `_inboundNetCheck(addr, site)`：不抛；丢消息；每 `(site, code)` **10 min 一行** warn + 一行 `events`（`event_type='inbound_address_network_reject'`，payload 带窗内计数）——NWT Q1 条件（设计 §2.3）。`_resetInboundNetRejectState()` 供测试 |
| 二选一 `kaspa: \|\| kaspatest:` | 3：`bettor.js:1103`（escrow 地址）· `bettor-prediction-settler.js:159`（**赢家收款地址**）· `kasia-relay/src/lib/crypto.mjs:46` | `isAddressOnNetwork(addr, { who })`：只认配置网络前缀且过校验和（原来跨网地址照收） |
| 剥前缀 | `u1-same-origin.mjs:224` + `.mutants.mjs:48` | `.replace(/^[a-z]+:/, '')`（原只剥 `kaspatest:` ⇒ 主网 `kaspa:` 永不匹配，去重静默失效）；mutant 目标串同步 |
| 类 A 必须同批的两处 | `relay-manager.js`（原 :50/:54/:79/:80 四个 `account.network \|\| 'mainnet'`）· `kasia-relay/src/rpc-listener.mjs:30` | relay-manager：`configuredNetwork()` 单一源 + **I4：`relay_nodes.network` ≠ env ⇒ `{ok:false, reason:'network_mismatch'}` 拒起**（主网 env 下 32 行 TN12 relay 由此不起 = TN12 退役的代码侧表达）；rpc-listener 顶层 `configuredNetwork()`（未设即 throw，与 (a) 的 `assertStrictRpcEnv` 同形） |
| lint | `_NET_PREFIX_STRICT = true` | INFER/EITHER 升 violate（BLOCK）；DEFAULT-DRIFT 仍 WARN（45 处另一笔，NWT Q4） |
| 测试夹具（类 C） | `broker-fee-emit-package-switch.test.mjs:44` | `spine_p2sh: 'kaspatest:dummy'` → 固定私钥派生的合法地址（helper 不再从前缀推网络，夹具必须过校验和）；这是设计 §F/§7 说的"类 C 夹具重生成"的第一例 |

## 验证（独立 node_modules · `KASPA_NETWORK=testnet-12` 为夹具口径）

| 用例 | 结果 |
|---|---|
| `src/lib/kaspa-network.test.mjs` | ✅ 51/51 |
| `src/lib/u1-same-origin.test.mjs` | ✅ 16 PASS / 0 FAIL |
| `src/services/broker-fee-emit-package-switch.test.mjs` | ✅ 24/24（夹具改后） |
| `src/services/pool-market-settler-v06.test.mjs`（需 `DB_PATH=<临时库>`） | ✅ ALL PASS |
| `bshard-auto-settler-bond-reclaim.test.mjs` · `bshard-auto-settler-clear-deadshape.test.mjs`（需整份 kanet.env + `DB_PATH=<临时库>`） | ✅ 10/10 · ✅ 10/10 |
| `bshard-auto-settler.test.mjs` | ❌ `SqliteError: no such column: id`（`pool-bettor-sides-query.mjs:53` 对临时库）——**无 (b) 改动的 a 分支同样失败，既有夹具/查询错位，非本 patch 回归**；已在本稿记录，另案 |
| lint 全库 | R-NET-PREFIX-INFER / EITHER **0 hit**（BLOCK 级）；仅剩仓内既有 3 条 R-EXPLORER-URL-BYPASS（非本 patch） |
| `node --check` | 全部改动文件通过 |
| 整仓残留 | `grep -rn "startsWith('kaspatest:')" kasia-console/src kasia-relay/src \| grep -v test\|mutants\|kaspa-network` ⇒ **0**（V11） |

## 与 (a) 分支的交叉（合并顺序请 Bettor 定）

`kasia-console/src/services/relay-manager.js` 两分支都改：(a) 改 :69 `rpcUrl` 那段（`resolveChildRpcUrl`），(b) 改 :48-63 与 :88-89（网络单一源 + I4）。hunk 相邻不重叠，git 大概率能自动合并；若冲突，以两边都保留为准（一个管 RPC URL，一个管网络名）。建议合并顺序 (a) → (b)，我可按需把 (b) rebase 到 (a) 上。

## 没覆盖 / 请 NWT 重点看

- 入站限频只有形式实现，**没起 tpf 的回归用例**（tpf 顶层 import 拉起半个 console，现有仓里也没有 tpf 单测骨架）；`_inboundNetCheck` 逻辑与 (a) 的 `requireRpcUrl` 同形（Map + 10 min），请 diff 审。
- 类 A 45 处 `|| 'mainnet'/'testnet-12'` 仍在（WARN 列出），按设计另一笔。
- `pool.js:3675`（市场详情路由）用 throw 形：坏行 ⇒ 该路由 500（fail-closed 但粗），可改 409；未改，交 NWT 判。
- 既有测试的跑法在本仓没有统一入口：v06 要 `DB_PATH`，bshard-auto-settler 三个要整份 kanet.env（`BROKER_RELAY_ID` 等）+ `DB_PATH`；本稿用 `env $(grep -E '^[A-Z0-9_]+=[^ ]*$' kanet.env | grep -v ^DB_PATH=) DB_PATH=<tmp> node <test>` 跑通两个，第三个是既有错位。
