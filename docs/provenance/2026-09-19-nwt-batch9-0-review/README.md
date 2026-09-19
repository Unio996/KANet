# 批 9-0（relay 只读扩展 R1/R2）代码 diff 审 —— NWT

2026-09-19。对象：`origin/coord/j2-batch9-0-relay-facts-v0`，基线 `6f6f9901`，`dbfa5599`（代码 + 测试 + manifest，8 文件 +744/−7）与 `9c045b22`（证据目录）。对照：设计 v0.3.1 = `5bda9583`，我的 `82cd2fb9`（N1/E1/O1）/ `de2ded3d`。方法：先离线读全部代码 diff；再在**我自己的 worktree**（`scratch/_nwt_wt_b90`，检出 `9c045b22`，`kasia-relay` 与 `kasia-console` 各自独立 `npm ci`，无 junction；`kaspa_bg.wasm` sha256 前缀 `51cec45e7f21dd79` = 生产同一份）亲跑测试并做自己的变异。**simnet 腿尚未做**（J2 正占用 simnet 做第 9 项，释放后我再起，见 §五）。D-021：无真实地址 / 密钥 / 余额。

## 结论

**代码：离线 GREEN——1 条必补的测试缺口（N-T1，纯测试、几行）+ 3 条 SHOULD；补 N-T1 后可合入主线（合入无运行时效果：relay 子进程需重启才加载新代码，主网重启另走闸）。9-0 验收①（"relay 回的 spk/covenantId 与节点独立来源一致"）在我的 simnet 独立腿做完之前不算闭合。** N1 / E1 / O1、M1–M6 相关条目在代码里全部落实，我没有在实现里找到与设计相反的地方。

| 项 | 判 | 依据 |
|---|---|---|
| N1 outpoints 精确形态、无 truncated、不受 N 影响 | ✅ | `buildFactsResponse` 形态 O 只在**完整**条目集里按 outpoint 取，回 `found`/`missing`；O3（>N 个 dust 仍取到目标）+ 变异 NWT-j（C1 退化成列表形态）被 O1/O2/O3/O4/H1/H3 抓到 |
| E1 回声 | ✅ | 响应恒带 `facts:true` / `factsVersion:1` / `form`，每项含 `scriptPublicKey.scriptHex` 与 `covenantId` 键（null 或 64 hex）；NWT-c/d（去回声）被 O1/L6 抓到；R4 用**真实旧版** `6f6f9901` 的 `commands.mjs` 证明旧验证器静默放行未知字段、对 R2 回 `unknown command type` |
| O1 排序方向 | ✅ | 过滤 → 面值降序 → `(txid, index)` 全序 → 截断；NWT-a（升序）被 L1/L3/L4/L5 抓到；NWT-i（先截断后过滤）被 O3/L1/L3/L4 抓到；NWT-n（去 index tiebreak）被 L2 抓到；金额全程 BigInt，NWT-g（Number）被 L5 抓到 |
| M1 哨兵 / 读取位置 | ✅ | 读 `e.entry.covenantId`，`'covenantId' in inner` 为假 ⇒ `covenant_id_field_missing`；NWT-b/o（去哨兵 / 缺键回 null）被 M1-b/c 抓到；M1-a 用真实 wasm 对象复核了"顶层 undefined / entry 原型 getter / `in` 恒真" |
| M2 共享 RpcClient、无回退 | ✅ | `utxo-facts.mjs` 不 import `connectRpc` / `kaspa-wasm` / `p2sh.mjs` / `process.env`（S1 源码扫描 + 扫描器自证变异）；`relay.mjs` 两个 case 各恰一处 `waitForRpc(FACTS_RPC_WAIT_MS)`（S2）；`waitForRpc` 超时抛错原样上抛，H2 证明**不回落**旧路径 |
| M3 登记面六处 | ✅ | 我用 sibling 命令 `get_mempool_entry` 做**平行核对**：它的登记位置（console 表、`commands.mjs` ×3、`authorize.mjs`、`relay.mjs` case）逐处对得上 `get_past_median_time` 的六处，`git grep` 没有第七个登记面；枚举器自证用例 b2 有效；lint 0 error、`R-COMMAND-REGISTRATION` 仍是既有 3 条 `chain_get_*`、无第 4 个（我自跑，输出未见 `get_past_median_time`/`get_address_utxos`） |
| R2 | ✅ | 只回 `{ok, pastMedianTimeMs, observedAtMs}`；`observedAtMs` 在读回之后取；pmt 不可用 fail-closed；字段读法与既有 `readPastMedianTimeMs` 同一个 `getBlockDagInfo().pastMedianTime`（relay 版更严：`isSafeInteger`） |
| 旧路径字节不变 | ✅ | B1（深比较 + 同一对象引用 + `JSON.stringify` 相等）；现有调用方（`bshard-close-transport.mjs:305`、`proto-broadcast-ops.mjs:77/163/178`）只传 `{type, address}`，不触发新字段 |
| M0a 摘要 | ✅ | `content_digest` 是文件内容 `sha256Hex(funnelContent)`（`m0a-lib.mjs:431`）；我对 `dbfa5599:kasia-console/src/lib/proto-relay-ipc.mjs` 独立重算 = `212303895bbca47377ed9c999bc284df67eabc0fed91a6edd6450244ade81b8b`，与 manifest 一致；该文件 diff 共 7 行改动（一行白名单 + 注释） |

## 一、必补：N-T1（测试缺口——一个真实存活的变异）

我在自己的 worktree 对 `utxo-facts.mjs` 做了 17 个变异（脚本与原始输出在本目录：`nwt-mutate-utxo-facts.cjs`、`nwt-mutation-run-raw.txt`）。**15 个被抓，2 个存活：**
- **NWT-e（真缺口）**：形态 O 的匹配键去掉 `index`（只按 `txid` 匹配）。J2 的 33 项测试**全部照样通过**——因为所有夹具里每个 txid 只有一个输出，"请求错误的 index" 从未被测。后果：同一笔交易的两个输出落在同一地址（例如续约输出与另一个同址输出），请求 `(txid, 1)` 却拿到 `(txid, 0)` 的事实——`found[].outpoint` 会回显真实 outpoint，所以 9-1 的 M6（`expectedOutpoints` 相等）**还能兜住**，但 relay 这一层的"按 outpoint 精确匹配"没有测试守着，而 9-0 验收声称 22 个变异全被抓到。
  **修法**：加一条向量（`nwt-O5-killer-vector.txt`，可直接粘贴到 O4 之后）：同一 txid 两个输出（index 0 = covenant，index 1 = 普通 P2PK），请求 `(txid,1)` 必须回 index=1 那一项（`covenantId:null`、spk = P2PK），请求 `(txid,2)` 必须进 `missing`。我已验证：对原实现 14/14 通过，对 NWT-e 变异 `[FAIL] NWT-O5`。
- NWT-f（**等价变异，不算缺口**）：去掉 `wanted.has(k)` 预过滤——输出循环只读请求过的键，多存的 hit 不影响结果，只是少一点内存。可留可去。

## 二、J2 交我定的五项

| # | 问题 | 我的裁定 |
|---|---|---|
| ① | 无 `facts` 却带 `outpoints/min/max` ⇒ `facts_params_without_facts`（比 v0.3.1 更严） | **留**。它是 E1 在 relay 侧的对偶：旧 relay 静默忽略未知字段，新 relay 不该复刻这个形状。我 `git grep` 确认现有调用方只传 `{type, address}`，没有人会被误伤。B3 有测试、NWT-h（去掉）被抓到 |
| ② | `FACTS_RPC_WAIT_MS = 8000` | **接受 8000**，附两条约束：(a) 具名常量、测试断言 `< 15000`（S2 已有，NWT-q 改成 20000 被抓到）；(b) **9-1 的 console 消费方 IPC 超时必须 ≥ 15000 且写进 9-1 清单**——relay 侧上限是 8 s（等共享客户端）+ RPC 调用本身。见 SHOULD S-1：RPC 调用本身现在没有超时 |
| ③ | 夹具真实性只到一半 | **接受**。我复核：普通条目是**完全真实**的 `UtxoEntryReference`；covenant 条目 = 真实引用 + 真实 setter 设的真实 `Hash`，合成层只有一个 `Object.create` 包装（`e.entry` 换成设置过 covenantId 的真实 `UtxoEntry`），且 `toFactsItem` 每条目只读一次 `e.entry`，包装与真实"每次新克隆"的差别不影响读取。字节层真实性由第 9 项承担——**但见 §五：第 9 项两侧读的是同一个 wasm getter，不是独立来源，我另加一条独立来源比对** |
| ④ | M0a 摘要更新，`review_ref` 仍 `4c693999`，审后给新号 | 摘要我已独立重算相符（见上表）。**`review_ref` = 本审查提交的 hash**（本文推送后由 Bettor 记账，J2 另起一个只改 `review_ref` 的提交；`review_ref` 不进摘要计算，摘要不变）。我批准的内容是 `proto-relay-ipc.mjs` sha256 `212303895bbca47377ed9c999bc284df67eabc0fed91a6edd6450244ade81b8b`，此后该文件任何改动都要重审 |
| ⑤ | 真实 RPC 与 `waitForRpc` 超时未跑真实节点 | `waitForRpc` 我读了源码（`rpc-listener.mjs:91-98`：每 200 ms 轮询 `isRpcConnected()`，超时抛 `Shared RpcClient not ready after Nms`），语义与 H2 的注入桩一致；**真实 RPC 行为由 simnet 腿覆盖**（§五）。真实超时（断开共享客户端后 8 s 内出错回执）需要起一个真 relay 子进程，放 9-4 端到端，不放 9-0 |

**M5 锚点确认**：9-0 对 `proto-relay-ipc.test.mjs` 是**纯新增**（+70/−0，diff 里没有一条删除行或改动行）；既有用例 ①–⑥b 与 ⑦ 我亲跑 17/17 通过，其中 ③（无 `intent_key` 的 write 在旧开关关时抛 `proto_driver_disabled`）与 ④（write 恰只有 `covenant_broadcast`）原样通过——9-2a 出口分闸的红旗锚点成立。9-0 没动写闸（`sendProtoCommand` 的 diff 只有白名单一行 + 注释）。

## 三、SHOULD

- **S-1 RPC 调用本身没有超时**：`handleGetAddressUtxos` / `handleGetPastMedianTime` 在拿到共享客户端后 `await rpc.getUtxosByAddresses(...)` / `getBlockDagInfo()` 不带截止时间。共享客户端"连着但节点卡死"时，relay 侧永远不回执，console 15 s 后超时（fail-closed，安全），但**relay 侧那个挂起的 promise 与延迟到达的回执**没人管，也无法区分"relay 卡住"与"relay 慢"。建议给 RPC 调用加总预算（例如 `Promise.race`，`FACTS_RPC_CALL_MS ≈ 5000`，与 8000 之和 < 15000）并把超时作为 `facts_rpc_timeout` 回执。不阻塞。
- **S-2 错误回执没有 `ok:false`**：`FactsError` 走 `relay.mjs` 外层 catch，回 `{error, phase:'execution'}`（无 `ok` 字段）。9-1 消费方判定必须是"`ok === true` ∧ `facts === true` ∧ `factsVersion === 1` ∧ `form` 相符 ∧ 条目级键齐全"，**不能**用 `!result.error` 或 `result.ok !== false`——错误回执里 `ok` 是 `undefined`。写进 9-1 清单。
- **S-3 返回集大小的上界只在响应侧**：`getUtxosByAddresses` 把整个地址 UTXO 集读进 wasm 内存后才过滤；形态 O 与旧路径同量级，未新增风险，但也没有降低。地址上撒到"不可读"量级（既往记录里 kaspa-wasm 对超大集会 trap）时，trap 是**整个 wasm 实例**级的（共享 / 每次新建客户端都一样），会波及同一 relay 进程里的签名——这是既有的、与 9-0 无关的残余风险，写进 9-4 的威胁说明即可。

## 四、我试过的攻击（PASS 是打不穿挣来的）
1. **空判据 / 变异存活**：对 `utxo-facts.mjs` 做 17 个变异（含设计三条 MUST 的反向、金额精度、排序方向、先截断后过滤、回声删除、哨兵删除、facts 真值化、超时常量）——15 被抓；**NWT-e 存活（真缺口，已给杀手向量）**；NWT-f 等价。
2. **输出被 GC 依赖**：J2 断言 wasm 对象靠 `FinalizationRegistry` 释放、不手动 `free()`。我核了 `kaspa.js` 胶水：`UtxoEntryReference` / `UtxoEntry` / `Hash` / `TransactionOutpoint` / `ScriptPublicKey` 五个类都有 `*Finalization.register`——成立。残余：wasm 线性内存的回收依赖 JS GC 被触发；每次调用的克隆量很小（形态 O ≤ 8 项、形态 L ≤ 200 项），relay 进程本身有常规分配，不构成实际泄漏路径，但 9-4 后应看一次 relay 的 wasm 内存曲线。
3. **未知字段静默放行**（旧 relay + 新 console）：用真实旧版 `commands.mjs` 复现，成立；靠回声 + 条目级键 + 消费方 fail-closed（9-1）闭合。
4. **登记面遗漏**：拿 sibling 命令做平行 `git grep`，无第七个登记面。
5. **写闸被牵动**：diff 只有白名单一行；既有 ③④ 原样通过。
6. **全新调用方误伤**：现有 `get_address_utxos` 调用方只传 `{type,address}`。
7. **摘要门是不是活的**：J2 证据里有"故意写错 → exit 1 → 还原 → exit 0"；我另外独立重算了 sha256 并与 manifest 对上。
8. **没打穿**：形态 O 的 `missing` 语义（已花 / 未落链 / 被 reorg 都进 `missing`，消费方一律中止，方向安全）；`readKey` 对非法条目 fail-closed 而不是静默丢项；R2 的字段读取。

## 五、simnet 腿（我还没做，先说清计划，起节点前按 Bettor 顺序报）
J2 正在做第 9 项：facts 与节点直读逐字节对照。**两点补充请 J2 / Bettor 知悉**：
1. **第 9 项两侧读的是同一个 wasm getter**（relay `facts` 回的 `covenantId` 来自 `e.entry.covenantId`，"节点直读"若也是 `getUtxosByAddresses` 的同一字段，则两侧共享同一个可能出错的读取器——正是我自检规则里的"两份自己的实现互相比"陷阱）。**要求至少一侧独立来源**：covenant 绑定用**创建该 UTXO 的交易**里的输出 covenant 数据（`getBlock` / 交易详情里的 `outputs[i].covenant`）逐字节比对；spk / amount / outpoint 同理取自创建交易而非 UTXO 索引。我的独立腿就这样做，并同时覆盖 covenant 与普通 P2PK 各一。
2. **共享 RpcClient 的真实性**：facts 走 `waitForRpc()` 返回的 `_rpc`，与本地脚本 `new RpcClient` 是同一个类但不同实例；我的腿用真实 `RpcClient` 经真实 `utxo-facts.mjs`，覆盖字节层；`waitForRpc` 超时放 9-4。

**放行顺序建议**：J2 补 N-T1 → 合入主线（无运行时效果）；simnet 独立腿两边（J2 第 9 项 + 我的独立来源比对）都通过后，9-0 验收①才记闭合；主网 relay 重启（新命令生效）并入下一次本来要做的 console 重启，与 D-026 开关 / P3 同批，**且必须在 D-026 已上线之后**（否则那次重启仍会跑启动期拆分）。

## 我没做 / 未证
- 没有 simnet 腿；没有真 relay 子进程 + 断开共享客户端的超时实测；没审 9-1…9-4 代码（不存在）；没读 `waitForRpc` 之外的 `rpc-listener.mjs` 连接管理（`isRpcConnected()` 的判据我未读）。
- worktree `scratch/_nwt_wt_b90` 内我只临时改过 `utxo-facts.mjs` 做变异，每次还原并 `git status` 干净；未提交任何东西到 J2 的分支。
