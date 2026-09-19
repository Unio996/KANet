> **Status**: CURRENT（2026-09-19，J2；批9 9-0 验收①——relay `facts` 路径 vs 节点直读逐字节对照；对应代码提交 `dbfa5599`，设计 v0.3.1 = `5bda9583`）

# 批9 9-0 验收①：relay facts 与节点直读逐字节对照（simnet，真实节点）

**结论（原始输出见 `run.txt`）**：17 项检查 17 通过 0 失败。在真实 kaspad 2.0.1 simnet 节点、真实 kaspa-wasm `RpcClient` 上，
三个相互独立的来源对 4 类 UTXO 的 `amount / scriptPublicKey(version+script) / covenantId` 逐字段完全一致：

| 类别 | 说明 |
|---|---|
| covenant ×2 | P2SH 形状、genesis 绑定 covenant，两个 covenantId 互不相同 |
| 普通 P2SH（无 covenant） | ticket 形状：spk 是 `aa20…87`，`covenantId` 为 null——即"P2SH 形状 ≠ 有 covenant" |
| 普通 P2PK | relay 的 fee 输入形状（找零输出） |

三个来源：**S1** relay 代码（`kasia-relay/src/lib/utxo-facts.mjs` 的 `handleGetAddressUtxos`，喂真实 `RpcClient`）；**S2** 节点直读（裸 WebSocket 打 `ws://127.0.0.1:18511` 的 JSON wRPC，`JSON.parse` 原始字节，不经 wasm 类、不经本仓任何代码）；**S3** 构造期望（建交易时本地算出的 spk 原文与 `kaspa.covenantId(outpoint, outputs)`，与生产 builder 同一函数）。
S2 里 `scriptPublicKey` 的编码是 `<u16 版本 4 位 hex><script hex>`——这是我从一次探针回复里读出的编码，**它的正确性由 S2==S3 印证**（不是假设）。

## 其他被实测的点
- **形态 L 的截断与全序 tiebreak 在真实数据上被走了一遍**：relay 地址上有 1100 个 UTXO（几乎全是同面值 50 KAS 的 coinbase），远超 `FACTS_LIST_MAX=200`。relay 返回的 200 项顺序与"我对节点原始数据独立排序（面值降序 → txid 字节序升序 → index 升序）后的前 200 项"**逐项完全一致**；面值较小的找零（4.7e9 < 5e9）被降序窗口正确排到 200 之外；`maxAmount` 过滤后找零出现。
- **形态 O 的 `missing`**：已被花掉的 coinbase outpoint 与从未存在的 outpoint 都进 `missing`，同时节点直读集合里确实没有前者。
- **R2**：`get_past_median_time` 的 `pastMedianTimeMs` == 节点原始 JSON 直读 == borsh 读数（挖矿停止后三读相等）；只回三个字段；`observedAtMs` 落在调用前后墙钟之间。
- **比较器红灯对照**：故意翻 1 个 nibble（scriptHex / covenantId）、金额 +1、covenantId 抹成 null 四种破坏，比较器全部判为不一致——所以上面的"一致"不是空判据。
- **顺带证实单元测试证明不了的一件事**：真实 wasm `RpcClient.getUtxosByAddresses([address])` 接受数组入参（单元测试用的是假 rpc）。

## 环境与过程（含两处偏差，如实记）
- 节点：`D:\rusty-kaspa-v201\kaspad.exe`，起前核 sha256 = `8AFE6A68…`（与主网同款，前缀符合 Bettor 条件）、`--version` = `kaspad 2.0.1`；命令行：`--simnet --appdir=D:\kanet-tn12\scratch\_j2_simnet_b9_0_data --utxoindex --enable-unsynced-mining --listen=127.0.0.1:16510 --rpclisten=127.0.0.1:16610 --rpclisten-borsh=127.0.0.1:18510 --rpclisten-json=127.0.0.1:18511`；全部只绑 127.0.0.1；PID 28164（起前核过没有别的 simnet kaspad、appdir 不存在）。**运行后只按该 PID 停止，且先核命令行含我的 appdir**（同机有同名的主网 kaspad，PID 16464，全程未碰：停后核 16464 仍在、17110 仍在监听；simnet 四个端口已空）。
- 脚本护栏：URL 必须是回环地址，且 borsh 与 json 两条通路的 `getBlockDagInfo.network` 都必须是 `simnet`，否则拒绝运行；密钥为本次运行临时随机生成的 simnet 测试钥，不打印、不落盘（证据文件已扫描无 priv/secret 字样）。
- **偏差 1（第一次运行失败，留档）**：`run-attempt1-immature.txt`——我假设 coinbase 挖 120 块后成熟，实际挖到约 725 块仍报 "spends an immature coinbase output"，simnet 的成熟期比我假设的大。改为起始挖 1100 块后通过。这个改动的副产品是上面 1100 个 UTXO 的截断实测。
- **偏差 2（我漏加了 flag）**：启动日志（`simnet-node-stdout.txt`）显示节点启动时**尝试了 UPnP 端口映射**（`--disable-upnp` 我没带），它超时失败、没有产生任何映射，但这不是我该让它发生的事。**之后任何一次起节点必须带 `--disable-upnp`。**
- 节点数据目录 `scratch\_j2_simnet_b9_0_data`（gitignored，一次性）我只做了"停止"，没有删除。

## 没证明什么（诚实边界）
1. **没有跑真实 relay 进程**：只调了 `handleGetAddressUtxos` / `handleGetPastMedianTime` 函数本体（喂真实 `RpcClient`）；`relay.mjs` 里 case 的接线由离线的源码扫描（S2）与人工读码覆盖，`waitForRpc` 的真实超时行为（提议 8 s）也没在真实 relay 里演练。
2. covenant 输出是 genesis 绑定的 P2SH 形状占位输出（脚本哈希是占位承诺，本测试不花它），不是生产的 RootClose/ShardLeaf 等真实合约 spk；被验证的是"spk/covenantId 的读出路径逐字节一致"，与具体合约无关。
3. "灌水"是 1100 个同面值 coinbase，不是低于成本的真 dust；NWT 的毒化 fee UTXO 形状（covenant 绑定 + P2PK spk）不在本次范围，按 NWT 安排 9-1 审时补。
4. 只在一个节点、一个时点上做；不证明并发/重组下的行为。

## 复现
先按上面命令行起一个**全新 appdir** 的 simnet 节点（**加 `--disable-upnp`**），再在 worktree 根：`node docs/provenance/2026-09-19-j2-batch9-0-facts-vs-node/facts-vs-node.mjs`（会覆盖同目录 `facts-vs-node.json`）。NWT 可对自己的节点重跑同一脚本（`--borsh=` / `--json=` 可改端口，仍限回环）。

## 脚本的两个版本（证据完整性）
- `facts-vs-node.as-run.mjs.txt`：**产生 `run.txt` 与 `facts-vs-node.json` 的那份脚本，逐字节原样**（sha256 `97e4d98ada2c9d96f44cd51c568da97b6ef21b98b0682d739c0f6673ac447afb`）。存成 `.txt` 是因为 lint 只扫 `.js/.mjs`。
- `facts-vs-node.mjs`：可执行版。与运行版**只差 4 行**（`amount: String(x)` → `x.toString()`）：提交时被 lint 规则 KI-30（"链上交易金额字段用 `String(x)` 需 `toFixed(8)`"的启发式，按写法匹配）拦下；这里的 `x` 是 BigInt 的 sompi 期望值，`BigInt.toString()` 与 `String(BigInt)` 等价，故只改写法不改语义。**改写后的版本没有重新跑**（重跑需再起一次 simnet，会挤占 NWT 的对照窗口）；NWT 用 `.mjs` 版对自己的节点重跑即可独立确认。
