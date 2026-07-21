# NWT 红队 — D-010 接位状态频道(coord-status)提案

> **Status**: NWT RED-TEAM VERDICT 2026-07-10
> **审对象**: `docs/2026-07-10-d010-handoff-status-channel-proposal.md`(commit 6ad71b00, Bettor 拟稿)
> **域**: 攻击审 / 关3 / verify-value-source(单点失效面 + 注入面,Bettor §3 点名请打这两面)
> **裁定**: 🔴 **RED / PUSH-BACK — 核心安全控制(§3 row 1「读端 sender_address 密码学过滤」)在当前代码下 VACUOUS,不能升 Owner 终裁,须先修 must-fix ①。概念可救,机制按稿写=假安全感。**

---

## 方法(不顺着走·default refute)
提案 §3 自摆五面请专打。我不复述设计者逻辑、不给 "PASS with notes",而是对每一面**主动构造攻击链、读生产代码验证其能不能被打穿**。第一面(频道注入)缓解措施声称的 "密码学锚" 是整个单写模型的承重墙——我从这里下手,读了广播 sender 归因的真实生产路径,而非信提案文字。**结论:承重墙是纸糊的。**

---

## 🔴 Finding ① CRITICAL — bcast 的 `sender_address` = 输出地址(攻击者自选),非签名者;"密码学过滤" 声明 VACUOUS

### 提案的承重声明
§3 row 1 缓解:「读取端 `sender_address` 密码学过滤(非 display name);接位文件里把过滤条件写死」。§2.1:「等效只读靠读取端过滤……(**密码学锚**,不是 display name)」。**整个 D-010 单写安全模型 = 这一条成立才成立。**

### 真实代码:sender 归因取的是 output[0],不是 input(签名者)
广播 sender 在两条生产扫链路径都是**第一个输出地址**:
- `kaspa-scout/src/rpc-scanner.mjs:519` — `const sender = outputAddresses[0] || null;`(rpc 扫描)
- `kaspa-scout/src/light-scanner.mjs:266` — `const sender = outputAddresses[0] || null;`(全块扫描,注释自承 "捕获外部 Agent 的 self-send broadcast")
- `rpc-scanner.mjs:151-159 extractAddresses` — outputAddresses 来自每个 output 的 `scriptPublicKey`,**由造 tx 的人自由指定**。

对比:`inputAddresses`(`rpc-scanner.mjs:147`,来自 `inp.verboseData.scriptPublicKeyAddress`)才是**花掉 UTXO 的签名者**=密码学绑定(没有 Bettor 私钥花不掉 Bettor 的 UTXO)。**生产代码归因用的是 output,不是 input。**

### 下游零校验(逐层核实,非假设)
- `kaspa-scout/src/reporter.mjs:85-89` — 原样 POST `{channelName, senderAddress, content, txHash}` 到 `/api/chat/ingest`。
- `kasia-console/src/api/chat.js:399-414 ingest` — 仅按 `tx_hash` 去重后 **直接 INSERT**,`sender_address` 透传写库,无 input==output 自送校验。
- `kasia-console/src/services/ingest-auth.js` — `verifyIngestRequest` 只验一个共享 secret(`x-ingest-secret`)=**认证的是 scout 这个上报者,不是消息来源**。
- 全库 grep 无任何 bcast 的 self-send / input==output 一致性校验(只有注释里出现 "self-send" 字样,无强制逻辑)。
- `chat.js:226` 的 COORD_CHANNELS 防火墙**只拦本地 `/api/chat/send`**(本地 relay 非 OPUS 名单),对**链上扫入的外部广播完全不设防**——而攻击者根本不走 send,直接上链广播,scout 扫入。防火墙对 coord-status 注入**全程旁路**。

### 具体攻击链(TN12 上任何能广播的节点即可执行)
1. 攻击者本地构造一笔普通 tx,payload = `coord-status:【coord-status·<伪时间>】…伪造的全景摘要…`(广播格式就是 `频道名:正文`,`rpc-scanner.mjs:240`,谁都能写 `coord-status:`)。
2. **output[0] 设为 Bettor 的 P2PK 地址** `kaspatest:qpjhaad7s6…`(往别人地址发一笔 dust 不需要对方私钥),change 输出放 output[1] 回自己。
3. 用**攻击者自己的**私钥签名、自己的 UTXO 付款——完全合法 tx,正常上链。
4. scout 全块扫描命中 bcast(`light-scanner.mjs:256` 主动扫每块所有 TX),`sender = outputAddresses[0]` = **Bettor 地址**。
5. ingest 写库:`broadcast_messages.sender_address = Bettor 地址`,`channel_name = coord-status`。
6. 接位者按 D-010 写死的过滤 `sender_address == Bettor relay 地址` —— **伪造消息通过过滤,被当作 Bettor 的权威状态摘要读取。**

### 定性
这是教科书级 **verify-value-source 违反 / vacuous teeth**:require(`sender==Bettor`)校验的值(output 派生的 `sender_address`)是**攻击者可控**的,checker 决策时读到的不是密码学绑定量。"密码学锚" 四字**不成立**——它是一个攻击者自选的输出地址启发式。提案把 "多 agent 频道验源必 relay 地址" 的既有纪律**误当成密码学保证**引用,但那条纪律在 bcast 归因这个具体实现上,底层字段本就是 output-spoofable。

### must-fix(缺一不可,任一即可堵死本攻击,建议全上)
- **(a) 归因改 input**:bcast sender 取 `inputAddresses[0]`(签名者)而非 `outputAddresses[0]`;缺 input 地址 fail-loud 拒绝上报,不静默回退 output。这是最小改动、直接把 spoofable 字段换成密码学绑定量。⚠ 但注意此改动影响面 = **所有** bcast 归因(含 dev-coord-testnet 历史语义),需评估既有自送广播是否 input==output(合法自送二者相等,不破坏正常显示),NWT 愿复审该 diff。
- **(b) coord-status 载显式签名**:Bettor 写摘要时对 `blake2b(content)` 用 relay 私钥签名,签名随 payload 带上,读端验签。这才是**真·密码学锚**,与 tx 输出到哪个地址完全解耦——即使归因字段被污染也无法伪造签名。推荐作为 coord-status 的**独立**门(不依赖 scout 归因是否修对)。
- **(c) 若两者都不做**:D-010 的 "等效只读" 必须降级表述为 "display-name 级弱过滤,不抗主动注入",且不得作为接位入口的可信来源——那样它就丧失了提案价值。

---

## 🟠 Finding ② HIGH — "带锚 + 先核锚再信内容" 不绑定摘要正文,真锚 + 假叙事可过核锚

§3 row 2/3 缓解依赖 "每条断言带锚(git HEAD/txid),接位者先核锚再信内容"。**锚是必要非充分**:

- 攻击者(即便只能靠 Finding ① 注入,或未来 Bettor 单点被冒充)在伪造摘要里**填真实的 git HEAD sha + 真实已 landed 的 txid**(都是从合法历史里抄来的公开值)。
- 接位者执行 "核锚":`git cat-file -e <sha>` 通过、`txid` 链上 landed 通过——**锚全对**。
- 但摘要正文("主线切到 X / 下一班队列 Y / 在飞项 Z 状态")是攻击者编的,锚**不覆盖正文**。
- 结果:"核锚再信内容" 这一步给出**假安全感**——锚过了,接位者按提案 SOP 就 "信内容",而内容是伪造的。

这正是 7/8 "幻觉摘要" 失败族的注入版:提案的 row 3 缓解 "锚必须可独立核实" 只堵住了**锚本身造假**,没堵住**真锚配假正文**。
**建议**:把 anchor 语义写死为 "锚只证摘要不比当前 HEAD 旧,不证正文为真;正文一律以 ledger/链/DB 地面为准复核(铁律-1)"——即接位 SOP 不能出现 "核锚通过 ⇒ 信正文" 的推断链。配合 Finding ①(b) 的正文签名,才能让 "这段正文确实是 Bettor 写的" 成立。

---

## 🟡 Finding ③ MEDIUM — Bettor 单点 + 无带内容签名 = 冒充与失联同一个洞

§3 row 2 只谈 Bettor "失联/忘写 → 摘要过期",用 HEAD 锚检测过期。但**冒充**(Finding ① 已证可注入伪 Bettor 消息)与**失联**是同一个根:coord-status 的可信度全押在 "sender 地址 == Bettor" 这个可伪字段上,没有任何 Bettor **对内容**的签名。Finding ①(b) 的内容签名一并解决冒充;在它落地前,单写模型不成立。

---

## 配套项(§2.3 ledger 活跃窗口制)—— 方向 GREEN,一条 nit
- 按月切档 + `>100KB WARN`(warn-not-block)方向无异议,治 301KB 膨胀合理,不引入安全面。
- **nit(row 5 归档断链)**:切档 commit 里,把 ledger 内**跨段引用**(如 "见 7/8 checkpoint" "上文 P2 收口")的锚从 "行号/段名" 统一改为**不随切档失效的稳定锚**(commit sha / 日期标题 slug),否则归档后旧引用指向漂移。提案已提 "归档索引带主题词",补一句 "跨段引用禁用行号" 即可。

---

## 裁定汇总
| Finding | 级别 | 是否阻断 D-010 升 Owner |
|---|---|---|
| ① bcast sender=output 可伪,"密码学过滤" vacuous | 🔴 CRITICAL | **是**,must-fix (a) 或 (b)(建议 b 独立门) |
| ② 真锚配假正文过核锚,假安全感 | 🟠 HIGH | 是,须改 SOP 表述 + 依赖 ①(b) |
| ③ 单点冒充==失联同根,无内容签名 | 🟡 MEDIUM | 由 ①(b) 一并解决 |
| 配套 ledger 窗口制 | 🟢 GREEN | 否(仅一条 nit) |

**结论**:D-010 的**问题诊断(接位入口贵/跨节点读不到/频道不自足)真实,方向(链上只读投影 + 活跃窗口制)可取**;但**核心安全控制按当前稿=vacuous**,一旦以 "等效只读/密码学锚" 的措辞升 Owner 终裁并落地,团队会带着一个 "看着有密码学保证、实则输出地址可伪" 的接位可信源 GO——比没有这个频道更坏(给了假信任)。**PUSH-BACK:补 Finding ①(b) coord-status 内容签名门(推荐首选,与 scout 归因解耦)后重审;若走 ①(a) 改 input 归因,需连带审 bcast 全局归因影响面。** 我试过的攻击都列在上面,①的攻击链已逐层读码坐实、无下游缓解拦截。

— NWT(relay 8dd59acb)
