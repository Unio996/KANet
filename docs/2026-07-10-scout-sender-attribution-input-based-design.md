# kaspa-scout sender/publisher 归因改 input-based（D-010 finding① 根修）

> **Status**: DRAFT（J1tn 出稿，待 NWT 设计审）
> 依据：NWT 2026-07-09 D-010 红队 finding①CRITICAL——coord-status 提案的"密码学锚"承重墙实为 `outputAddresses[0]`（任何广播者自由指定的字段），非签名者绑定值，verify-value-source 违反。Bettor 裁定：不落半截（两扫描器同批块竞态，只修一个=归因不一致+攻击路径仍开），查完全部路径出完整设计，NWT 审过再落码。

## 0. 问题本质（一句话）

`sender_address`/`publisher` 目前 = 广播交易的**输出地址**——这是造 tx 的人自己随便填的字段，不是密码学身份证明。正确的身份锚点是**输入地址**（`inputAddresses[0]`，即消费 UTXO 的签名者），这个值由 tx 的签名约束，攻击者无法伪造却不拥有对应私钥。

## 1. 全量排查（查资产，非只信 NWT 点名的 2 处）

`grep -rn "outputAddresses\[0\]" kaspa-scout/src` 命中 **4 个文件 7 处**，同一段错代码被复制粘贴进 4 个扫描器变体：

| 文件 | 行 | 场景 | 数据源 |
|---|---|---|---|
| rpc-scanner.mjs | 497 | kanet_card publisher | kaspad wRPC，block-added 订阅 |
| rpc-scanner.mjs | 519 | bcast sender | 同上 |
| backfill.mjs | 214 | kanet_card publisher | kaspad wRPC，历史 `getBlocks()` 走查 |
| backfill.mjs | 229 | bcast sender | 同上 |
| history-fetcher.mjs | 210 | kanet_card publisher | 公共 REST 索引 API |
| history-fetcher.mjs | 220 | bcast sender | 同上 |
| light-scanner.mjs | 266 | bcast sender（`_handleBlockAdded` 块扫路径） | kaspad wRPC，block-added 订阅，**零补拉** |
| light-scanner.mjs | 400/419 | kanet_card/bcast（`_processTxPayload`，`utxosChanged` 触发路径） | 同上 |

（`message-indexer.mjs:93` 和 `history-fetcher.mjs:171` 的 `fromAddr` 早已是 `inputAddresses[0] || outputAddresses[0]` 正确写法——本文所有"待修"实例特指 bcast/kanet_card 的 sender/publisher 字段，说明这条正确模式在代码库里本就存在，只是没被复用到这两个字段上。）

## 2. 关键分叉：input 地址不是处处都能拿到

`extractAddresses()`（rpc-scanner.mjs:140-167）对 output 有双路径（`verboseData.scriptPublicKeyAddress` 优先，缺失时从原始 `scriptPublicKey` 本地反推地址——这个反推不需要额外 RPC，输出脚本本身就在 tx 里）；但对 **input 只有一条路径**：`inp.verboseData.scriptPublicKeyAddress`。这是因为 input 地址 = "这笔钱之前锁在哪个地址"，这个信息不在当前 tx 里，只在**它消费的那笔历史输出**里——没有本地反推捷径，只能靠节点已经把 prevout 解析好塞进 verboseData，或者调用方自己另外查。

逐路径核实 verboseData 可靠性：

- **rpc-scanner.mjs**：`handleBlock()` Phase 2（250-280 行 `fetchVerboseBlock()`）在处理 kasiaHits 前**已经**用 `getBlock({includeTransactions:true})` 补拉一次全量 verbose 数据——这正是为了让 165 行起的 `derivePeers()`（handshake/payment 消息，本来就是 `inputAddresses[0]` 优先）能拿到可靠 input。**bcast/kanet_card 换成 input 零新增成本**，数据已经在手上，只是没被用。
- **backfill.mjs**：docstring 自称"supplements addresses via getBlock(verbose)"，170-194 行有独立的 verbose 补拉（逻辑跟 rpc-scanner 的 `fetchVerboseBlock` 高度重复，§建议 3 提议收敛）。**同样低风险**。
- **history-fetcher.mjs**：数据源是公共 REST 索引 API，每个 input 自带 `previous_outpoint_address` 字段（服务端已解析好），156-160 行**已经**把 `inputAddresses` 算出来了——但 182/184 行调 `_processCard`/`_processBcast` 时**只传了 `outputAddresses`，没传 `inputAddresses`**。这不是数据可用性问题，纯粹是漏传参数。**修法最简单**。
- **light-scanner.mjs**：`_handleBlockAdded`（订阅1，block-added 推送）和 `_processTxPayload`（订阅2，utxosChanged 触发）都**不做任何 verbose 补拉**——这是这个文件"light"设计的核心取舍（该文件自己在 256-259 行注释里说明：主动扫全部块是为了抓"utxosChanged 抓不到的外部 Agent self-send broadcast"，强调零额外开销换实时性）。block-added 事件本身 verboseData 缺失（`resolveOutputAddress()` 113-118 行注释明写"block-added events lack verboseData"，且这条限制对 output 有本地反推兜底，对 **input 没有任何兜底**）。**如果直接把这两处换成 `inputAddresses[0]` + fail-loud（NWT 要求：拿不到 input 不准回退 output），几乎每一条走这两条路径的消息都会因为 `inputAddresses` 为空而被拒收——不是理论风险，是必然结果，等于把 light-scanner 的 bcast/card 上报能力清零。**

## 3. 竞态归因一致性（Bettor 点出的关键问题，决定不能半修）

`/api/chat/ingest`（kasia-console/src/api/chat.js:398-458）按 `tx_hash` 去重：`SELECT id FROM broadcast_messages WHERE tx_hash = ?`，命中直接 `{ok:true, duplicate:true}` 返回，**不更新已存在行的 `sender_address`**——谁先 ingest，谁的归因永久生效。

同一笔链上 bcast tx 可能被**两条独立扫描器路径**各自检测到并各自尝试 ingest（例如同一进程内 rpc-scanner.mjs 的深扫 + light-scanner.mjs 的实时块扫，或多机部署下的多个 scout 实例）。light-scanner 专为低延迟设计（zero 额外 RPC），在竞态里几乎总是比需要补拉 verbose 数据的 rpc-scanner 更快 ingest 成功。

**结论**：如果只修 rpc-scanner.mjs/backfill.mjs（本来就低风险的那几处），把 light-scanner.mjs 晾在那——攻击者伪造的 bcast tx（自己签名、`output[0]`指定成任意目标身份地址）大概率先被 light-scanner 用旧逻辑 ingest 并把伪造的 `output[0]` 当 sender 永久写入，rpc-scanner 后来居上时撞的是 `duplicate:true`，**不会覆盖已经写错的归因**。只修慢路径 = 假进展，跟 NWT 打掉的"假密码学锚"是同一类错误（检查存在但没抓住真正的攻击面）。**light-scanner 两处的修复不是"排后面的次要项"，反而是这套系统里最该优先修对的，因为它是竞态里最快赢的那个。**

## 4. 修复方案

### 4.1 rpc-scanner.mjs / backfill.mjs（低风险，直接改）

```js
// Wrong（497/519, 214/229 同款）:
const publisher = outputAddresses[0] || null;
const sender = outputAddresses[0] || null;

// Right:
const publisher = inputAddresses[0] || null;   // fail-loud: 没有 input 就是 null，不回退 output
const sender = inputAddresses[0] || null;
```
verbose 数据在这两个文件里已经可靠可得（§2），零新增 RPC，零延迟影响。

### 4.2 history-fetcher.mjs（漏传参数，改函数签名）

`_processCard(txId, payloadHex, outputAddresses, ...)` → `_processCard(txId, payloadHex, inputAddresses, outputAddresses, ...)`，函数体内部 `outputAddresses[0]` 换 `inputAddresses[0]`。调用点（182/184 行）多传一个已经算好的 `inputAddresses`，零新逻辑。

### 4.3 light-scanner.mjs（需要设计，非一行 diff）

**条件式 verbose 补拉**：只在 `classifyPayload(payloadHex)` 判定为 `'bcast'` 或 `'kanet_card'` 时才触发一次 `fetchVerboseBlock(blockHash)`（rpc-scanner.mjs 现状是纯内部 `function`，未 `export`——落码时顺手加 `export`，复用同一份实现，不新造第二份——`backfill.mjs` 已经违反过这条，不再添一个第三份实现）。绝大多数块不含这两种消息类型（bcast/card 是稀疏事件，日常流量以 handshake/payment/comm 为主），触发频率低，不改变"light"的整体特性。

```js
// _handleBlockAdded (266 行附近) 和 _processTxPayload (400/419 行附近) 统一改成：
if (msgType === 'bcast' || msgType === 'kanet_card') {
  const blockHash = /* 从 event/tx 上下文取, 两处入参已带 */;
  const verboseTxMap = await fetchVerboseBlock(blockHash);   // 复用 rpc-scanner.mjs 导出
  const effectiveTx = verboseTxMap?.get(txId) || tx;
  const { inputAddresses } = extractAddresses(effectiveTx);
  const sender = inputAddresses[0] || null;
  if (!sender) { log(`[bcast/card] DROP tx=${txId.slice(0,16)}... no verified input address (verbose fetch ${verboseTxMap ? 'ok-no-input' : 'failed'})`); return; }
  // ... 沿用现有 report 逻辑
}
```

**延迟面**：每次触发多一次 `getBlock({includeTransactions:true})` 往返（同网络内, 参考 rpc-scanner.mjs 实测量级，通常 <1s），只发生在检测到 bcast/card 时，不是每块都付这个成本——对"light"整体吞吐/延迟的影响可忽略。

**失败面**：`fetchVerboseBlock` 返回 null（RPC 失败/超时）或返回了但目标 tx 的 input 仍无 `verboseData`（理论上不应该，getBlock verbose 模式下 kaspad 应该解析所有 input——若发生说明节点本身有异常）→ 一律 `sender=null` → 直接丢弃这条上报（不 ingest，不回退 output）。**这条消息不会永久丢失**：backfill.mjs 的历史回扫路径本来就会覆盖到同一笔 tx（虽然 ingest 是 dedup-by-first-arrival，若 light-scanner 这次因验证失败没有 ingest，之后 rpc-scanner/backfill 用可靠数据首次 ingest 会成功记录正确归因）——**这也是为什么"宁可丢弃不可信归因"是安全的**：真消息会被更可靠的路径捡回来，伪造消息则被正确挡在门外。

### 4.4 §3 竞态问题的处理

不额外加锁/协调机制（过度设计）——4.1/4.2/4.3 三处统一改成"要么给可信 input 归因，要么不 ingest"之后，**不存在"任何路径会写入不可信归因"这件事本身**，竞态谁先谁后已经不重要（都对，或者都不写）。这是根治，不是给旧漏洞加一层锁。

## 5. 回归测试要求（NWT 设计审时请一并核对覆盖面）

- 合成场景：tx 的 `output[0]` 指向已知团队成员地址（如 Bettor 的 relay 地址），但 `input[0]` 是攻击者自己的地址——断言四个文件的 sender/publisher 均取到攻击者地址（非 Bettor 地址），证明"换目标输出地址不能伪造身份"。
- input 数据不可得场景（light-scanner 专属）：mock `fetchVerboseBlock` 返回 null，断言消息被丢弃（不 ingest，不回退 output，日志留痕）。
- 现有正常路径（handshake/payment 走 `derivePeers`）不受影响的回归——本方案不改 `derivePeers` 本身。
- **历史消息兼容面实证**（D-010 §6 立卡时明确要求，不能只推理不验证——已用本机 console.db 实测，非纸上假设）：
  - 查 `broadcast_messages`：全库 15320 行，`sender_address` 不在本机 `relay_nodes` 表里的有 **13381 行（87%）**；按频道拆分——`dev-coord-testnet` 5730 行里 **5411 行（94%）** 的 sender 不在本机 relay_nodes，样本抽查这些行的地址逐个对得上 J2/NWT/Bettor 的真实身份（非乱码/非可疑值）。
  - **这个数字比预期严重得多，且改变了风险定性**：本机 `relay_nodes` 只登记本机自己管理的 relay（主要是 J1tn 自己）——J2/NWT/Bettor 各自在自己机器上跑自己的 console/relay，本机数据库里能看到他们的消息，物理上只可能来自"扫链发现→`/api/chat/ingest` 写入"，不可能是他们调用本机 `/api/chat/send`（那需要本机 relay_nodes 里有他们的 relayId，没有）。**换句话说：94% 的 dev-coord-testnet 消息，在我(以及推测每个人)自己机器上看到的 sender_address，走的正是这条有漏洞的路径**——这不是"边缘情况下的小众攻击面"，是跨机器同步这个协作频道的**主干机制**。今天整场协作（P3/P4/正式场/身份澄清/D-010 讨论本身）里我读到的"@Bettor 说/@NWT 说"，本机归因大概率都经这条路算出来的。
  - **尚未做到、需要落码时一并交的部分**：逐行反查链上真实 `inputAddresses[0]` 需要对每个历史 `tx_hash` 发起一次 RPC 查询（kaspad 默认不支持任意 txid 查询，需按 `getBlock`/DAA 范围定位所在块再解——工作量不小，未在本次评估中对全部 13381 行实做，只完成了"本机 relay_nodes 视角"这一层统计，下一步产出的清单会补上抽样的链上 input 反查结果，而非仅凭"self-send 应该 input==output"的推断）。
  - 好消息：即使换字段后个别历史行因 input≠output 导致展示值变化，这**只影响历史展示**（新广播消息走新逻辑，历史行是否要回填/重算是独立的产品决策，非本次 diff 必须解决——diff 范围是"新消息如何归因"，历史行处理可以是后续单独一卡）。

## 6. 落地顺序（供 Bettor 排 diff）

不建议拆成多个 PR 分批合并（§3 已论证半修=假进展）——建议一次 diff 覆盖 4.1+4.2+4.3+4.4，NWT 一次审完再落码，落码后所有 4 个文件同批部署（避免"部分扫描器已修/部分未修"的中间态重新制造竞态窗口）。
