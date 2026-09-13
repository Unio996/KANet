# 网络单一源 + 地址前缀一致性核 helper 化 · 设计 v0.1（不写码）

> **Status**: DRAFT-FOR-REVIEW · **v0.2**（2026-09-13T10:5xZ · NWT 红队 7149e3a5 **PASS**，Q2/Q3/Q4 采纳；**Q1 PASS-with-condition ⇒ 入站站点 events 记录必须限频（§3 #25/#26 + §2.3 新增）**；**V12 对抗输入向量**由 NWT 代跑干净、本稿 §4 补录）· v0.1 10:2xZ · J2 · Bettor 10:4xZ 派 v0.2 → NWT 快审 → patch 阶段（D-011）。落码分两笔：helper + lint + 向量（非钱路，Bettor 批）/ 33 处替换（含 settler/voter/relay 钱路，Owner 批）。
> 派工：Bettor seed `scratch/_bettor_relaunch_seed_2026-09-13.md` §2 J2 (b)。输入：Codex 复审 finding #3（"configured network is authoritative AND address prefix must match, ELSE reject; never map unknown prefix to mainnet"）· J2 `scratch/_j2_mainnet_pivot_lists_2026-09-07.md` §①（类 B）· 评估 v0.2 §G · ledger (1003) · **D-017**（主网上 da9 + TN12 退役 ⇒ 同一台机、同一个 DB 先后跑两个网络，正是本稿要防的过渡态）。
> 行号随 HEAD `8f1e107f`。本稿只裁 helper 契约、单一源、逐处替换清单、向量、lint；不落 src。
> 🔵 **与 NWT 负测规格对齐**（`docs/2026-09-13-nwt-negative-test-spec-local-only-and-network-prefix-v0.1.md` §B，本地 184bf6f5）：B-1 = 本稿 V1；B-3（未知前缀/空/undefined ⇒ 必须 reject）= V5 + V6；B-4 = V3；B-5 = V2 的反向（`kaspa:` 地址 + env `testnet-12` ⇒ reject，本稿 V3 的镜像，向量表补为 V3′）；B-6/B-7 的落点 = §2.2 `shared/lib/kaspa-network.mjs` + §4 向量文件。NWT 规格写"24 处"是 09-07 口径，本稿 F8 实核 33 处。

## 0. 一句话

今天 **29 处**代码用"这串地址以 `kaspatest:` 开头吗？"来**推断**自己在哪个网络（否则一律当 `mainnet`），另有 **3 处**只验"是 `kaspa:` 或 `kaspatest:` 之一"（跨网地址照收）、**1 处**把前缀剥掉再比对（主网变 no-op）。网络身份必须只有一个来源（env `KASPA_NETWORK`，已存在、已 fail-fast），地址前缀只能**对照**它、不能**生成**它；不匹配 ⇒ **拒**，不映射。落成一个 `shared/lib/kaspa-network.mjs`（console/relay 共用，先例 `shared/lib/app-envelope-canonical.mjs`）+ 一条 lint 规则堵回流。🔴 helper **只用 `Address.validate()`，绝不 `new Address()` 来验**：实测坏校验和抛的是 wasm `unreachable`（= 毒化 kaspa-wasm 实例那族）。

## 1. 事实基线（HEAD `8f1e107f`，全部自跑 grep）

| # | 事实 | 出处 |
|---|---|---|
| F1 | 单一源**已存在且已 fail-fast**：`rpc-health.js:23` `const LOCAL_NETWORK = process.env.KASPA_NETWORK; if (!LOCAL_NETWORK) throw` | 不需要发明新变量 |
| F2 | 推断式（`startsWith('kaspatest:') ? 'testnet-12' : 'mainnet'`）**29 处 / 14 文件**（console 28 + relay 1），§3 逐条；其中 **9 处**带 `(x \|\| '')` ⇒ **空/undefined 地址 ⇒ 'mainnet'**（fail-open 的最短路径） | `grep -rn "startsWith('kaspatest:')" kasia-console/src kasia-relay/src` |
| F3 | 二选一验证式（接受 `kaspa:` **或** `kaspatest:`）**3 处**：`bettor.js:1103`、`bettor-prediction-settler.js:159`（赢家地址！）、`kasia-relay/src/lib/crypto.mjs:46` ⇒ 主网上一个 `kaspatest:` 赢家地址能过这道验 | 同上 grep 里的 `\|\|` 形 |
| F4 | 剥前缀比对 **1 处**：`u1-same-origin.mjs:224` `.replace(/^kaspatest:/, '')` ⇒ 主网 `kaspa:` 永不匹配，去重静默失效 | 09-07 清单已列 |
| F5 | **默认值漂移（类 A）**：`\|\| 'mainnet'` **33 处**（含 `relay-manager.js:79-80` 给 relay 子进程的 `KASPA_NETWORK`、`scanner.js:114`、`kasia-relay/src/rpc-listener.mjs:30`、`wallet.mjs:137`）；`\|\| 'testnet-12'` **12 处**（`oracle-pool.js` 5 处等）。**同一个进程里两种默认并存** ⇒ env 一漏，同进程两半各认一个网 | `grep -rn "\|\| 'mainnet'"` / `"\|\| 'testnet-12'"` |
| F6 | DB 里 `relay_nodes.network` 32 行全 `testnet-12`；`relay.js:366/653` 用 `relay.network \|\| 'mainnet'` 作共享 RPC 的 key ⇒ D-017 切主网后，这些行若不退役会以 `testnet-12` key 向主网节点要客户端 | `SELECT network, COUNT(*) FROM relay_nodes GROUP BY network` |
| F7 | kaspa-wasm `Address.validate()` 的实测行为（本机 `kasia-console/node_modules/kaspa-wasm`，2026-09-13 自跑）：合法 tn/mn 地址 ⇒ true；**前缀伪造**（`kaspa:` + testnet payload）⇒ **false**（bech32 校验和覆盖前缀）；全大写 ⇒ false；空串 ⇒ false；`undefined` ⇒ **TypeError**（helper 要先判 string）；`validate` 返回 false 之后实例仍健康。而 **`new Address(伪造串)` ⇒ throw `unreachable`**（wasm panic） | 记忆 `reference-console-wasm-linear-memory…` / `kaspa-wasm unreachable trap 毒化实例` |
| F8 | 09-07 清单写"类 B ≈24（16 文件）"，今天逐行 grep 是 **29+3+1 = 33 处 / 15 文件**——09-07 是模式估计、今天是逐行；以本稿 §3 为准 | 两次口径不同，不是代码变了（`git diff 7b792163..8f1e107f -- kasia-console/src kasia-relay/src` 为空） |
| F9 | 跨包共用件先例：`shared/lib/`（`app-envelope-canonical.mjs` / `rpc-utils.mjs`），console 用 `'../../../shared/lib/…'`、relay 用 `'../../shared/lib/…'` 相对路径 import | `pool-canonical-input-set.mjs:27`、`rpc-listener.mjs:398` |
| F10 | lint 已有同族规则形（`R-…` 正则扫非注释行 + `lint-allow-<rule>: <reason>` 转义），可直接照抄结构 | `scripts/lint-kanet.mjs` `R-REALCHAIN-SKIP-BATCH` 段 |

## 2. 不变量 + helper 契约

### 2.1 不变量（Codex #3 原话的落地形）

- **I1** 网络身份只从 env `KASPA_NETWORK` 来；无默认值；不认识的值 ⇒ 启动即 throw。
- **I2** 任何进入钱路/身份路的地址，其前缀必须等于 `prefixFor(KASPA_NETWORK)`，否则**拒**（throw / 返回 reject），**绝不**把不认识或不匹配的前缀映射成任何网络。
- **I3** 地址先过 `Address.validate()`（校验和含前缀 ⇒ 伪造前缀在这里就死），再比前缀；两步都不构造 `Address` 对象。
- **I4** DB 行自带的 `network` 列不是第二个真相源：行值 ≠ env ⇒ 该行**不进入** live 路径（退役/排除），不重映射（F6）。

### 2.2 `shared/lib/kaspa-network.mjs` 导出（签名即契约）

| 导出 | 行为 | 备注 |
|---|---|---|
| `NETWORKS = Object.freeze({ mainnet:'kaspa', 'testnet-12':'kaspatest', 'testnet-11':'kaspatest', devnet:'kaspadev', simnet:'kaspasim' })` | 网络 → 前缀表 | 表是**从网络到前缀**的单向；不提供反向表（防止有人重新做推断） |
| `configuredNetwork(env = process.env)` | 返回 `env.KASPA_NETWORK`；未设 / 不在 `NETWORKS` ⇒ `throw new Error('KASPA_NETWORK not set or unknown: …')` | 与 `rpc-health.js:19-23` 同形；无默认 |
| `prefixForNetwork(net)` | 查表；未知 ⇒ throw | |
| `addressPrefix(addr)` | 纯字符串：`typeof addr === 'string' ? addr.slice(0, addr.indexOf(':')) : ''`；无冒号 ⇒ `''` | 不碰 wasm |
| `assertAddressOnNetwork(addr, { network = configuredNetwork(), who, kaspa } )` → `network` | ① `typeof addr==='string' && addr.length>0` 否则 reject `empty`；② `kaspa.Address.validate(addr) === true` 否则 reject `invalid-checksum`；③ `addressPrefix(addr) === prefixForNetwork(network)` 否则 reject `prefix-mismatch`；通过 ⇒ **返回 `network`**（不是从地址算出来的，是传进来/配置的那个） | reject = `throw NetworkMismatchError { code, who, expectedPrefix, actualPrefix, network, addr: addr.slice(0,14) }`（地址只截前 14 字符进错误，日志里别整串）。返回 `network` 是为了让 29 处替换保持 `const network = …` 原形 |
| `isAddressOnNetwork(addr, opts)` → `boolean` | 同上不抛 | 给"过滤而不是拒"的读路径（如列表 API） |
| `kaspa` 参数 | 调用方传已加载的 kaspa-wasm 模块（console/relay 各自已有），helper **不自己 import**（避免 shared 目录再拉一份 wasm、也避免测试要装） | 未传 ⇒ throw `kaspa module required` |

**明确不导出** `networkOfAddress()` 之类"从地址得网络"的函数——它就是今天的病。

### 2.3 入站站点的 reject 记录限频（v0.2 · NWT Q1 条件 · MUST）

#25/#26（`trade-protocol-filter.js:371/787`）与任何对手方可控字段的站点：`isAddressOnNetwork` 为 false ⇒ 丢消息，**但 `events` 表不逐次落行**。对手方只需反复塞任意串（不必是合法地址）即可让每条拒绝写一行 events（P2-6 刚治过 events 全扫）。落法二选一，**与 helper 同笔落**：
- (i) 沿 `rpc-health.js` 的 `ALL_FAILED_NOTE_MS` 形：每 `(site, reason)` 10 min 内只落一行，行内带本窗计数；或
- (ii) 按 `(sender_address 前 14 字符, reason)` 聚合计数，定期（同 10 min）落一行汇总。
helper 本身**不写 events**（它是纯函数）；限频计数器放在调用站点旁的小 `Map`（与 `ibd-tick-gate.mjs` 的 `_state` 同形）。回归：连续 1000 次坏前缀 ⇒ events 新增行 ≤ 1（同 N1/H5 的"限频只一行"断言形）。

## 3. 逐处替换清单（33 处；"替换形"列一律 `assertAddressOnNetwork(<addr>, { who:'<file>:<line>', kaspa })`，返回值接原变量）

| # | 坐标 | 现状表达式（地址变量） | 替换后 | 钱路? | 备注 |
|---|---|---|---|---|---|
| 1 | `api/pool.js:192` | `(brokerAddress \|\| '').startsWith(...)` | `const net = assert…(brokerAddress)` | 否 | 空 ⇒ 原来 mainnet，现在 reject |
| 2 | `api/pool.js:744` | `makerRow.address` | 同 | **是**（maker 建盘） | |
| 3 | `api/pool.js:950` | `makerRow.address` | 同 | **是** | |
| 4 | `api/pool.js:1361` | `makerRow.address` | 同 | **是** | |
| 5 | `api/pool.js:1506` | `bettorRow.address` | 同 | **是**（下注） | |
| 6 | `api/pool.js:1642` | `relayAddr` | 同 | **是** | |
| 7 | `api/pool.js:2257` | `bettorRow.address` | 同 | **是** | |
| 8 | `api/pool.js:2376` | `market.spine_p2sh` | 同 | **是**（P2SH 前缀 `kaspatest:p…`，validate 同样覆盖） | |
| 9 | `api/pool.js:2551` | `market.spine_p2sh` | 同 | **是** | |
| 10 | `api/pool.js:2576` | `market.spine_p2sh` | 同 | **是** | |
| 11 | `api/pool.js:3338` | `linkedAddr` | `_net = assert…` | 否 | |
| 12 | `api/pool.js:3675` | `(market.spine_p2sh \|\| '')` | 同 | **是** | 空 ⇒ reject |
| 13 | `api/bettor.js:1404` | `makerRow.address` | 同 | **是** | |
| 14 | `api/kanet-broker.js:68` | `broker_address` | 同 | 否（注册） | 注册时就拒错网 broker |
| 15 | `api/relay.js:244` | `(addr \|\| '')` | 同 | 否 | |
| 16 | `lib/bshard-close-transport.mjs:286` | `relayAddrForConsolidate` | 同（在 `p2shFn` 外算一次，别塞进 lambda） | **是** | |
| 17 | `services/broker-fee-emit.mjs:121` | `String(m.spine_p2sh \|\| '')` | 同 | **是**（费） | |
| 18 | `services/bshard-close-voter.js:141` | `String(voter.address \|\| '')` | 同 | **是**（投票签） | |
| 19 | `services/bshard-close-voter.js:678` | `String(psContAddress \|\| '')` | 同 | **是** | |
| 20 | `services/pool-market-settler-v06.mjs:428` | `String(marketRow?.spine_p2sh \|\| '')` | 同 | **是**（结算） | |
| 21 | `services/pool-market-settler.js:2049` | `market.spine_p2sh && …` | 同 | **是** | |
| 22 | `services/pool-market-settler.js:2069` | `market.spine_p2sh` | `settleNetwork = assert…` | **是** | 09-07 高风险 #1 |
| 23 | `services/pool-market-settler.js:2680` | `makerRow.address` | `networkId = assert…` | **是** | 高风险 #2 |
| 24 | `services/prediction-params-cache.js:106` | `ctorParams.p2sh_addr?.startsWith` | `network: assert…(ctorParams.p2sh_addr)` | **是**（重编译 escrow） | |
| 25 | `services/trade-protocol-filter.js:371` | `(msg.p2sh_addr \|\| '')` | 同 | **是**（入站协议消息！对手方可控字段） | 这里 reject = 丢消息 + 记 events，不是 throw 到主循环 |
| 26 | `services/trade-protocol-filter.js:787` | `msg.spine_p2sh` | 同 | **是**（入站） | 同上 |
| 27 | `services/trade-protocol-filter.js:1434` | `market.spine_p2sh` | 同 | **是** | 高风险 #10 |
| 28 | `services/trade-protocol-filter.js:1470` | `market.spine_p2sh` | 同 | **是** | |
| 29 | `kasia-relay/src/relay.mjs:678` | `String(addr)`（relay 自己钱包地址） | `networkId = assert…(addr)`（relay 侧 env 由 relay-manager 注入，见 (a) 稿 S5） | **是**（per-bet P2SH 派生） | 高风险 #7 |
| 30 | `api/bettor.js:1103` | `escrowAddr.startsWith('kaspa:') \|\| …('kaspatest:')` | `isAddressOnNetwork(escrowAddr)` | **是** | 二选一 → 单网 |
| 31 | `services/bettor-prediction-settler.js:159` | `winnerAddr` 二选一 | `assert…(winnerAddr)` | **是**（赢家收款！） | 与 (c) 的 NO-TX 两处是同一文件，落码顺序注意别撞 |
| 32 | `kasia-relay/src/lib/crypto.mjs:46` | 二选一 | `isAddressOnNetwork(address, { network: configuredNetwork() })` | **是**（签名前地址验） | |
| 33 | `lib/u1-same-origin.mjs:224` | `.replace(/^kaspatest:/, '')` | 先 `assert…` 再 `addr.slice(addr.indexOf(':')+1)`（去任意前缀） | 否（去重） | mutants 文件 `:48` 的变异体要同步改 |

**类 A 默认值（F5 的 45 处）不在本稿替换清单**：它们是"env 漏了怎么办"的问题，修法一致 = 删默认、改调 `configuredNetwork()`（fail-fast）；量大但机械，建议**独立一笔**由 lint `R-NET-DEFAULT-DRIFT`（§5）先 WARN 全部列出来，再批量落。但 **两处必须与本稿同批**：`relay-manager.js:79-80`（给 relay 子进程的 `KASPA_NETWORK = account.network \|\| 'mainnet'` ⇒ 改为 `configuredNetwork()`，且 `account.network !== configuredNetwork()` ⇒ 拒起该 relay（I4））、`kasia-relay/src/rpc-listener.mjs:30`。

## 4. 测试向量（离线 · 固定测试私钥 `0x…01` 派生 · 2026-09-13 本机 kaspa-wasm 自跑）

| 向量 | 地址 | `KASPA_NETWORK` | 期望 | 证什么 |
|---|---|---|---|---|
| V1 | `kaspatest:qpumuen7l8wthtz45p3ftn58pvrs9xlumvkuu2xet8egzkcklqtes5z8rkmpd` | `testnet-12` | 返回 `'testnet-12'` | 正向 |
| V2 | `kaspa:qpumuen7l8wthtz45p3ftn58pvrs9xlumvkuu2xet8egzkcklqtes4ypce9sf` | `mainnet` | 返回 `'mainnet'` | 正向（主网） |
| V3 | V1 地址 | `mainnet` | reject `prefix-mismatch`，`expectedPrefix='kaspa'`，`actualPrefix='kaspatest'` | **D-017 过渡态的核心场景**：DB 里的 TN12 地址在主网进程里 |
| V4 | `kaspa:` + V1 的 payload（`kaspa:qpumuen…5z8rkmpd`） | `mainnet` | reject `invalid-checksum`；**且**随后 `Address.validate(V2)` 仍 true | 伪造前缀死在校验和；wasm 实例没被毒化（I3） |
| V5 | `kaspadev:qpumuen7l8wthtz45p3ftn58pvrs9xlumvkuu2xet8egzkcklqtese6y7tc99` | `mainnet` | reject `prefix-mismatch` | 未知前缀**不**映射 mainnet（Codex #3 反例） |
| V6 | `''` / `undefined` / `null` / `123` | 任意 | reject `empty`（**不**抛 TypeError） | 今天 9 处 `(x\|\|'')` 是 mainnet，现在拒 |
| V7 | V1 全大写 | `testnet-12` | reject `invalid-checksum` | 记录 wasm 行为，防有人"顺手" toLowerCase |
| V8 | V1 | env **未设** | `configuredNetwork()` throw | I1 无默认 |
| V9 | `kaspatest:p…`（任一现存 spine_p2sh，从 `pool_markets` 取一行） | `testnet-12` | 返回 `'testnet-12'` | P2SH 版本也过 validate |
| **V10 弱注入臂** | V1 全部设置，**只**把 env 翻成 `mainnet` | 由绿翻红 | 断言读的是 env，不是地址 |
| V11 | 33 处替换后：整仓 `grep -rn "startsWith('kaspatest:')" kasia-console/src kasia-relay/src \| grep -v test` | **0 行** | 清单闭合 |
| **V12（v0.2 · NWT 代跑·脚本 `kasia-console/scratch/_nwt_address_validate_hostile_probe.mjs` · 11 组对抗输入·结果全部干净）** | ① 空串 · ② 嵌入 NUL 字节 `kaspa:qp\0umuen…` · ③ 1 MB 长串 `kaspa:` + `q`×1,000,000 · ④ 全角/混淆冒号 `kaspa：qpumuen…` · ⑤ 无冒号 · ⑥ 只有 `:` · ⑦ emoji `kaspa:😀😀😀` · ⑧ 控制字符 `kaspa:\x01\x02\x03\x04` · ⑨ 破损代理对 `kaspa:\uD800` · ⑩ 纯数字 `12345` · ⑪ `[object Object]` | 任意 | **全部 `validate()` 返回 false，不抛、不崩**；helper 对同 11 组 ⇒ reject `invalid-checksum`（②–⑪）/ `empty`（①）。**`validate()` 与 `RpcClient.connect()` 不是同一鲁棒等级**（后者对 null url 是 wasm 陷阱，见 (a) 稿 N9）——helper 只用前者 | 格式本身是攻击载荷的一类；照抄 NWT 脚本断言进 `kaspa-network.test.mjs` |
| V3′ | `kaspa:qpumuen…4ypce9sf`（V2 地址） | `testnet-12` | reject `prefix-mismatch` | NWT B-5 反向 |

向量文件建议：`shared/lib/kaspa-network.test.mjs`（`node` 直跑，注入 `kaspa` 用真模块，离线）+ 同名 `.vectors.json`；`u1-s10-identity.vectors.json` 那类现有 golden vector 的 `"network":"testnet-12"` 字段属类 C，主网切换时重生成，不在本稿。

## 5. lint（`scripts/lint-kanet.mjs`，照 `R-REALCHAIN-SKIP-BATCH` 结构）

| 规则 | 级别 | 判据（非注释行） | 转义 |
|---|---|---|---|
| `R-NET-PREFIX-INFER` | **BLOCK** | `/startsWith\(\s*['"]kaspatest:['"]\s*\)\s*\?/` 或 `/replace\(\/\^kaspatest:\//` 出现在 `kasia-console/src` / `kasia-relay/src` / `shared/lib` 非 `.test.` 非 `mutants` 文件 | `lint-allow-net-prefix-infer: <reason>`；`shared/lib/kaspa-network.mjs` 自身白名单 |
| `R-NET-PREFIX-EITHER` | BLOCK | `startsWith('kaspa:')` 与 `startsWith('kaspatest:')` 同一行以 `\|\|` 相连 | 同上 |
| `R-NET-DEFAULT-DRIFT` | **WARN-first**（45 处清完后翻 BLOCK） | `/\|\|\s*['"](mainnet\|testnet-1[12])['"]/` | `lint-allow-net-default: <reason>` |

顺序：helper + 向量 + lint 三件一笔（WARN 级不挡现有代码）→ 33 处替换一笔（BLOCK 级同笔翻） → 类 A 45 处一笔。

## 6. 与 D-017 的关系（为什么现在做）

- D-017 = **同一台 da9、同一个 `console.db`、先 TN12 后主网**。过渡态里 DB 全是 `kaspatest:`，env 会翻成 `mainnet`。今天的 29 处会把每一个存量地址**继续**判成 `testnet-12`（因为它看的是地址）——settler 用 `testnet-12` 的 networkId 去构造主网 tx / 去向主网节点要客户端；而新写入的空地址走 `(x||'')` ⇒ `mainnet`。**同一进程两个网络并存，且哪半对取决于字段是不是空。** helper 化后：存量 TN12 地址在主网进程里一律 reject（V3），响、可 grep、不静默。
- I4 是 TN12 退役的**代码侧**表达：`relay_nodes.network='testnet-12'` 的 32 行在 env=mainnet 下不被拉起、不被当 key。退役动作本身仍走 D-017 §3 执行门（KANet-UI runbook → NWT → Owner GO），本稿不停任何东西。
- 与 (a) 稿的交叉：`relay.mjs:1106` 硬编码 `17210` 与 `relay-manager.js:79-80` 两处两稿都点到，**落码只落一次**，归 (a) 的 C4/C9。

## 7. 请 NWT 判 / 请 Bettor 拍

1. **Q1 入站路径的 reject 形**（#25/#26 `trade-protocol-filter`）：对手方可控字段 ⇒ 我倾向 `isAddressOnNetwork` + 丢消息 + `events` 记一行（不 throw），其余 31 处 throw。NWT 判这两处的 fail-closed 形有没有 DoS 面（构造坏前缀刷 events 表——P2-6 刚治过 events 全扫）。
2. **Q2 `testnet-11` 要不要进表**：09-07 清单有 7 个 `testnet-11` 命中（多为陈旧注释/脚本）；表里留它零成本，但会让"未知网络 throw"少拦一种错配。我倾向**不留**（只 mainnet / testnet-12 / devnet / simnet）。
3. **Q3 helper 的 `kaspa` 注入 vs 自 import**：注入让 shared 目录零依赖、测试零安装；代价是 33 处调用各多传一个参数。NWT 判。
4. **Q4 类 A 45 处**：独立一笔还是与 33 处同笔？我倾向独立（机械、量大、非本稿不变量）。

## 8. 本稿没核到的

- V9 没用真实 `pool_markets` 行跑（只推断 P2SH 版本地址过 validate）；NWT 出向量时取一行实跑。
- #16 `bshard-close-transport.mjs:286` 那个 lambda 每次调用都算一次前缀，替换后是否有热路径性能影响未量（`assert` 一次 `validate` ≈ 微秒级，应无）。
- 类 A 的 45 处是 grep 计数，未逐条看是否有"故意 mainnet 默认"（如 `api/context.js:15` 的 query 参数默认）——lint WARN 阶段会把它们全列出来再判。
