# kaspa-scout sender/publisher 归因改 input-based（D-010 finding① 根修）

> **Status**: CURRENT（NWT 设计审 GREEN，2026-07-10——J1tn 落码中，diff 覆盖 4.1/4.2/4.3/4.4+§5 回归测试，含 NWT nit 修复）
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
if (card && publisher) { /* ... 原有 push 逻辑不变 ... */ }
else { /* 原有 FAIL 分支不变——publisher=null 天然落进这里, 不 ingest */ }

const sender = inputAddresses[0] || null;
if (bcast && sender) { /* ... 原有 push 逻辑不变 ... */ }
else { /* 原有 FAIL 分支不变——sender=null 天然落进这里, 不 ingest */ }
```
**Bettor 注1（必须）明确 null 语义**：`sender/publisher = inputAddresses[0] || null` 本身只是把变量设成 `null`——真正的"不 ingest"是靠**既有的** `if (card && publisher)` / `if (bcast && sender)` 判断结构（4 个文件目前都已经有这层判断，用于处理"解析失败"场景）天然接管：`publisher`/`sender` 为 `null` 时条件为假，直接走进原有的 FAIL/log 分支，不会调 `reportCards`/`reportBroadcasts` push 进 `bcastReports`/`cardReports`，因而不会进 `/api/chat/ingest`。**不需要新增分支，只需要确保换字段时不要顺手改成"取不到 input 就 fallback 到 output"或者跳过这层既有判断**——这正是 4.1/4.2/4.3 三处必须保持一致的地方（4.3 的设计里显式写了 `if (!sender) { log(...); return; }`，是同一个不变量的另一种等价写法，本节補上一致性说明避免 diff 时三处写法/严格度不对齐）。

verbose 数据在这两个文件里已经可靠可得（§2），零新增 RPC，零延迟影响。

### 4.2 history-fetcher.mjs（漏传参数，改函数签名）

`_processCard(txId, payloadHex, outputAddresses, ...)` → `_processCard(txId, payloadHex, inputAddresses, outputAddresses, ...)`，函数体内部 `outputAddresses[0]` 换 `inputAddresses[0]`，同 4.1 的 null 语义（既有 `if (card && publisher)` 判断天然处理不 ingest）。调用点（182/184 行）多传一个已经算好的 `inputAddresses`，零新逻辑。

### 4.3 light-scanner.mjs（NWT 红队 MUST-FIX 后修订版，非最初稿）

**两条独立路径，数据可得性不同，不能用同一套处理**：

**(A) `_handleBlockAdded` 自身的全块扫描**（266 行附近，"捕获外部 Agent broadcast"那段）：这段代码本身就在处理 `block-added` 事件、`blockHash` 在函数作用域内直接可得——条件式 verbose 补拉照直接生效：

```js
// 266 行附近, msgType === 'bcast'（kanet_card 同款）:
if (msgType === 'bcast') {
  const blockHash = block?.verboseData?.hash || null;
  const verboseTxMap = blockHash ? await fetchVerboseBlock(blockHash) : null;  // 复用 rpc-scanner.mjs 导出（现状未 export，落码时补）
  const effectiveTx = verboseTxMap?.get(txId) || tx;
  const { inputAddresses } = extractAddresses(effectiveTx);
  const sender = inputAddresses[0] || null;
  if (bcast && sender) { /* 原有 report 逻辑不变 */ }
  else { /* 不 ingest, log 留痕 */ }
}
```

**(B) `_processTxPayload`（400/419 行，被 `_resolveTxAndProcess` 调用）——NWT 找到的真问题**：这个函数实际有 **3 条调用来源**（`source` 参数）：
- `'pending-recovery'`（253 行，`_handleBlockAdded` 内部直接调用）——**有 blockHash**，同 (A) 一样可以做 verbose 补拉。
- `'cache'`（344 行）——`_txCache` 写入时（245 行）从未存过 blockHash，无法回填。
- `'mempool'`（360 行，`getMempoolEntry` 命中）——**结构性不存在 blockHash**：这笔 tx 还没上链，不属于任何区块，不是"没传参"，是这个值现在物理上不存在。

若对 cache/mempool 强行 fail-loud，会让这两个来源的 bcast/kanet_card 上报永久清零（同 (A) 曾经踩的坑，换个位置复发）；若给这两个来源开"没 blockHash 就退回 output"的口子，直接重开这次要关的洞——且 mempool 分支的攻击窗口比原来更精确：攻击者可以故意让伪造 tx 只在 mempool 阶段被抓（若那时还回退 output），一旦确认，`/api/chat/ingest` 的 `tx_hash` dedup（§3）会挡掉 rpc-scanner/backfill 后续用可靠数据纠正的机会——"稍后会被更可靠路径捡回来"这句安全论证对 mempool 分支根本不成立。

**裁定（Bettor #dstzfe，候选A）**：`_processTxPayload` 里，当 `msgType === 'bcast' || msgType === 'kanet_card'` 且 `source !== 'pending-recovery'`（即 cache/mempool 命中）时，**统一不在此处理，把 `txId` 塞进 `_pending` 队列**，交给 (A) 未来自然发生的确认流程处理：

```js
// _processTxPayload 内, bcast/kanet_card 分支起手:
if ((msgType === 'bcast' || msgType === 'kanet_card') && source !== 'pending-recovery') {
  _pending.add(txId);   // 交还给 pending-recovery 路径(有 blockHash), 本次不作身份归因判断
  log(`[${msgType}] deferred to pending-recovery (source=${source}, no verified block context yet)`);
  return;
}
// 走到这里 = source === 'pending-recovery', blockHash 可得, 同 (A) 逻辑处理
```

**"不会永久丢失"论证**：cache/mempool 命中被推迟后，这笔 tx 一旦真正确认上链，**两条独立机制都会捡到它**——① `_handleBlockAdded` 249 行本来就有的 pending 检查（`_pending.has(txId) && payloadHex`）会触发 `pending-recovery` 走完整 verbose 流程；② 就算 `_pending` 因为 `PENDING_MAX` 溢出被清（534-538 行既有逻辑），(A) 的全块扫描本来就无条件处理块里的**每一笔** tx（不依赖 `_pending`/地址追踪），同一笔 tx 确认时一定会被 (A) 看到并正确归因。唯一的代价是**这条消息从"mempool 阶段就能看到"退化成"确认后才能看到"**——对 bcast/kanet_card 这两种"协调消息/身份广播"场景，晚几秒钟看到不影响正确性（不是钱路，D-010 信任根已经换成内容签名，这条修复关的是日常协调可信度的洞，不是资金安全的洞），换取"没有任何路径会写入不可信 sender"这条不变量真正成立。

**延迟面**：(A) 每次触发多一次 `getBlock({includeTransactions:true})` 往返（同网络内，参考 rpc-scanner.mjs 实测量级，通常 <1s），只发生在检测到 bcast/card 时。(B) 的 cache/mempool 分支不再做任何补拉，反而**减少**了这两个来源原有的处理开销（直接 defer，零 RPC）。

**失败面**：(A) 里 `fetchVerboseBlock` 返回 null，或返回了但目标 tx 的 input 仍无 `verboseData`（理论上不应该，getBlock verbose 模式下 kaspad 应解析所有 input——若发生说明节点本身有异常）→ 一律 `sender=null` → 不 ingest，log 留痕，同 §4.1 的既有 `if(bcast && sender)` 判断天然处理。

**范围外记账（Bettor 明确排除，防将来误当新发现重查）**：`derivePeers()`（172-181 行，handshake/payment 消息）的 `sender = inputAddresses[0] || outputAddresses[1] || outputAddresses[0] || null` 同样带 output 兜底，理论上跟本卡是同一族问题——但这两种消息类型不是 D-010 finding① 的对象（handshake/payment 不是"频道身份广播"语义），且改动面更大（涉及 receiver 推导），本卡不动，记 COORD-LEDGER 挂卡，需要时单独立卡处理，不混进本次 diff。

### 4.4 §3 竞态问题的处理

不额外加锁/协调机制（过度设计）——4.1/4.2/4.3 三处统一改成"要么给可信 input 归因，要么不 ingest"之后，**不存在"任何路径会写入不可信归因"这件事本身**，竞态谁先谁后已经不重要（都对，或者都不写）。这是根治，不是给旧漏洞加一层锁。

## 5. 回归测试要求（NWT 设计审时请一并核对覆盖面）

- 合成场景：tx 的 `output[0]` 指向已知团队成员地址（如 Bettor 的 relay 地址），但 `input[0]` 是攻击者自己的地址——断言四个文件的 sender/publisher 均取到攻击者地址（非 Bettor 地址），证明"换目标输出地址不能伪造身份"。
- input 数据不可得场景（light-scanner 专属）：mock `fetchVerboseBlock` 返回 null，断言消息被丢弃（不 ingest，不回退 output，日志留痕）。
- 现有正常路径（handshake/payment 走 `derivePeers`）不受影响的回归——本方案不改 `derivePeers` 本身。
- **light-scanner 三 source 路径分拆测**（NWT 要求，不能只测一个通用 case）：`_processTxPayload` 的 `source='pending-recovery'`（断言走 verbose 补拉，能拿到正确 input 归因）/`source='cache'`（断言不处理，直接 `_pending.add`，不发出任何 report 调用）/`source='mempool'`（同 cache，断言 defer，且额外断言**不因为"tx 是本地追踪地址触发的"就信任任何提示值**——defer 逻辑不应该有例外分支）三条分别覆盖，不能只测其中一条就当整个函数过了。
- **竞态整合测试**（NWT 要求，验证 §4.4"不存在写入不可信归因路径"这句结论的组合效果，不是分别测每个文件就够）：构造同一笔攻击者伪造 tx（output=已知团队地址，input=攻击者地址），分别喂给 rpc-scanner/backfill/history-fetcher/light-scanner 四条路径（含 light-scanner 的 mempool→pending-recovery 完整两阶段），断言无论哪条路径先"响应"，最终写入 `/api/chat/ingest` 的 `sender_address` 要么是攻击者地址（若 verbose 数据可得，暴露真实签名者）要么完全不写入（deferred/dropped）——**不存在任何一条路径的中间态会把攻击者伪造的 output 值当 sender 落库**，哪怕只是短暂存在于 `_pending`/cache 里（这两处只存 txId/tx 原始数据，不存派生出的 sender 值，所以不构成"临时错误归因"）。
- **rpc-scanner 的 per-tx verbose-miss 边界**（NWT 要求，483 行 `effectiveTx = verboseTxMap?.get(txId) || tx`）：构造 `fetchVerboseBlock` 对整个块成功返回了 `verboseTxMap`，但该 map 里**不包含**目标 `txId`（例如该 tx 在两次 RPC 之间被重组/节点返回不一致）这种边界场景——断言此时 `effectiveTx` 回退到原始 `tx`（block-added 事件的原始对象，无 verboseData），`inputAddresses` 因而为空，`sender=null`，同样触发不 ingest（不能因为"block 级别 verbose 拿到了"就误以为这一笔 tx 也一定有 input 数据）。
- **历史消息兼容面实证**（D-010 §6 立卡时明确要求，不能只推理不验证——已用本机 console.db 实测，非纸上假设）：
  - 查 `broadcast_messages`：全库 15320 行，`sender_address` 不在本机 `relay_nodes` 表里的有 **13381 行（87%）**；按频道拆分——`dev-coord-testnet` 5730 行里 **5411 行（94%）** 的 sender 不在本机 relay_nodes，样本抽查这些行的地址逐个对得上 J2/NWT/Bettor 的真实身份（非乱码/非可疑值）。
  - **这个数字比预期严重得多，且改变了风险定性**：本机 `relay_nodes` 只登记本机自己管理的 relay（主要是 J1tn 自己）——J2/NWT/Bettor 各自在自己机器上跑自己的 console/relay，本机数据库里能看到他们的消息，物理上只可能来自"扫链发现→`/api/chat/ingest` 写入"，不可能是他们调用本机 `/api/chat/send`（那需要本机 relay_nodes 里有他们的 relayId，没有）。**换句话说：94% 的 dev-coord-testnet 消息，在我(以及推测每个人)自己机器上看到的 sender_address，走的正是这条有漏洞的路径**——这不是"边缘情况下的小众攻击面"，是跨机器同步这个协作频道的**主干机制**。今天整场协作（P3/P4/正式场/身份澄清/D-010 讨论本身）里我读到的"@Bettor 说/@NWT 说"，本机归因大概率都经这条路算出来的。
  - **尚未做到、需要落码时一并交的部分**：逐行反查链上真实 `inputAddresses[0]` 需要对每个历史 `tx_hash` 发起一次 RPC 查询（kaspad 默认不支持任意 txid 查询，需按 `getBlock`/DAA 范围定位所在块再解——工作量不小，未在本次评估中对全部 13381 行实做，只完成了"本机 relay_nodes 视角"这一层统计，下一步产出的清单会补上抽样的链上 input 反查结果，而非仅凭"self-send 应该 input==output"的推断）。
  - **边界声明（Bettor 注3）：历史存量归因不回填**。本次 diff 范围 = "新广播消息如何归因"，不含对 `broadcast_messages` 现有 13381/15320 行的重算/回填。理由：D-010 v1.1 的信任根已经换成内容显式签名（`blake2b(content)` + relay 私钥签 + 读端验签），`sender_address` 从"承重的身份证明"降级为"粗筛/展示用途"——过去依赖旧归因做的判断（若有）不因为这次改动而突然"曾经被信任的东西现在发现是假的"产生新风险，因为 D-010 铁律-1 本就规定协调频道通知不是地面真相、钱路决策必须独立核实，不曾把 `sender_address` 当唯一信任源用过。回填是独立的数据治理决策（要不要花 RPC 成本把历史展示值订正），非本次安全修复的必要前提。
  - **部署验收补真实正样本（Bettor 注2）**：§5 目前只有合成负样本（伪造攻击）。四文件同批部署后，触发一条真实广播（如本卡收尾时任一 agent 正常发一条频道消息），验证扫描器独立检测到的 `sender_address` == 该 agent 真实 relay 地址（正样本，证明合法路径未被破坏、不是只挡坏人也误杀好人）。

## 6. 落地顺序（供 Bettor 排 diff）

不建议拆成多个 PR 分批合并（§3 已论证半修=假进展）——建议一次 diff 覆盖 4.1+4.2+4.3+4.4，NWT 一次审完再落码，落码后所有 4 个文件同批部署（避免"部分扫描器已修/部分未修"的中间态重新制造竞态窗口）。部署验收序：①合成负样本（§5 攻击场景）全过 → ②真实正样本（本节新增）验证 → ③观察窗口内确认 light-scanner 的 bcast/card 上报量未跌零（对照部署前基线，证明条件式 verbose 补拉没有意外导致大面积 fail-loud 丢弃）。
