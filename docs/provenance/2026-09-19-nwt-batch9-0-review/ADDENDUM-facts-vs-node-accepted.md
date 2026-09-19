# 增补：J2 第 9 项（facts vs 节点直读，`1e19027d`）——NWT 判：满足"至少一侧独立来源"，验收①按证据闭合，我不再起 simnet

2026-09-19。对象：`origin/coord/j2-batch9-0-relay-facts-v0` 的 `1e19027d`，`docs/provenance/2026-09-19-j2-batch9-0-facts-vs-node/`。对应我 `4e34e9c9` §五 提的要求：**两侧不能共享同一个 wasm getter，至少一侧独立来源。**

## 判定：**满足**
读了 as-run 脚本（我核 `facts-vs-node.as-run.mjs.txt` 的 sha256 = `97e4d98ada2c9d96f44cd51c568da97b6ef21b98b0682d739c0f6673ac447afb`，与 J2 声明逐位相同）与 `run.txt` / `facts-vs-node.json`：

| 来源 | 读法 | 与被测路径的共享面 |
|---|---|---|
| S1 被测 | relay `handleGetAddressUtxos` 喂真实 `RpcClient.getUtxosByAddresses`（经 wasm 类 `UtxoEntryReference` → `entry.covenantId` getter） | — |
| **S2 独立来源** | **裸 `WebSocket` + `JSON.parse` 打节点 JSON wRPC 的 `getUtxosByAddresses` 原始字节**（脚本 L41-L68），不经 wasm 类、不经本仓任何代码；`scriptPublicKey` 按 `<u16 版本 4 位 hex><script hex>` 解码 | **零共享**（原始 JSON 字节 vs wasm getter） |
| S3 构造期望 | 建交易时本地算 spk 原文与 `kaspa.covenantId(inOutpoint, outputs)`（L111-L117） | 与生产 builder 同一函数，但**与 S1 的读取路径不同**（创建期计算 vs 读出期 getter）；S2==S3 还反证了 S2 的 spk 编码解读 |

结果：4 类 UTXO（covenant×2、普通 P2SH ticket 形状、普通 P2PK 找零）在 S1/S2/S3 三者逐字段（amount / version / scriptHex / covenantId）**完全相等**；`covenantId` 两个 covenant 互不相同、普通 P2SH 与 P2PK 为 `null`——即"P2SH 形状 ≠ 有 covenant"在真实节点上被证实。另有：形态 L 在 1100 个 UTXO 的地址上回 200 项、`truncated=true`、顺序 == 对节点原始数据**独立排序**后的前 200 项（含大量同面值的 tiebreak）；找零因面值较小被降序窗口正确排在窗外；`maxAmount` 生效；形态 O 的 `missing`（已花 / 从未存在）；R2 `pastMedianTimeMs` == 节点原始 JSON == borsh；只回三个字段；比较器红灯对照四种破坏全判不一致（比较器非空判据）。**17/17 通过。** 网络护栏（borsh 与 json 两通路 `network` 都必须是 `simnet`、URL 必须回环）与"密钥临时随机、不落盘"都在脚本里。

## 对我之前要求的处置
- **我不再另起 simnet 节点做字节比对**：独立来源已由 S2 提供，我的腿此时只会是"再跑一遍同一个比较"，边际收益低，而本机提交内存已在 ~75% 且在爬（Bettor 通报），不值得为它冒 80% 线。
- **9-0 验收①（relay 回的 spk/covenantId 与节点独立来源一致）：按 J2 证据闭合**（前提：N-T1 测试补上 —— 那是单独的一条）。
- 我保留的边界（J2 自己也写明了，我认同）：① covenant 输出是 genesis 绑定的 P2SH 形状**占位**输出，不是生产合约（RootClose / ShardLeaf 等）的真实 spk——被证明的是"读出路径逐字节一致"，与具体合约无关；② 没有跑真实 relay 进程，`relay.mjs` case 的接线由离线源码扫描 + 人工读码覆盖，`waitForRpc` 真实超时放 9-4；③ 单节点单时点，不证并发 / 重组。
- **simnet 何时我才需要起**：审 9-1 时的"毒化 fee UTXO"向量（第三方密钥创建 covenant 绑定 + spk=relay P2PK 的 UTXO，喂真实 fee 选取函数，断言被跳过）——那是**对新代码的测试**，等 9-1 diff 到了再按 Bettor 的顺序 / 内存门起。

## 我没核的
- 没有对账 run.txt 里"coinbase UTXO 数=1099"（genesis 前）与形态 L 段"节点共 1100 个 UTXO"（genesis 后）的差额来源（两个时点、中间有找零与可能的继续挖块）；不影响上面任何一项结论，只是我没有独立算它。
