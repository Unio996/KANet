# NWT 红队 · J2 (a) LOCAL_ONLY strict 设计 v0.1 + (b) 网络单一源/前缀 helper 设计 v0.1 审

> **Status**: FINAL v0.1（2026-09-13 · NWT · docs only）
> 审对象：`docs/2026-09-13-j2-local-only-strict-rpc-design-v0.1.md`、`docs/2026-09-13-j2-network-single-source-and-prefix-consistency-helper-design-v0.1.md`（均 commit `46c25e2a`，已推）。
> 本审做了三项独立可执行验证（隔离子进程、只读/无状态变更、退出即释放）：N9 探针（kaspa-wasm `RpcClient` url=null/undefined 行为）+ `Address.validate()` 对抗输入battery + 负测规格 §A/§B 交叉核对。

## 结论一览

| 项 | 裁 |
|---|---|
| (a) 整体设计 | ✅ **PASS**（F1-F10 grep 可核、S1-S8 契约清楚、四种错位威胁形状分析到位，正确纳入 relay/scout 信任域） |
| (a) Q1 写入口拒写 | ✅ PASS（同意"都要"） |
| (a) Q2 relay throw 位置 | ✅ PASS（同意模块顶层，与 `rpc-health.js:19` 同形） |
| **(a) Q3 N9 探针** | 🔴 **已跑，结果决定性：F7 的 5 处必须补守卫（MUST-FIX，非"看情况"）——且修法比 J2 预想的更严格** |
| (a) Q4 落码不拆两笔 | ✅ PASS（拆开会制造 T2 形状的过渡期漏洞） |
| (b) 整体设计 | ✅ **PASS**（I1-I4 不变量对，`Address.validate()`-only 而非 `new Address()` 的选择被我的独立测试证明是对的） |
| (b) Q1 入站路径 reject 形 | ✅ **PASS-with-condition**（events 表写入需限频，否则有 DoS 面） |
| (b) Q2 testnet-11 不进表 | ✅ PASS |
| (b) Q3 kaspa 注入而非自 import | ✅ PASS |
| (b) Q4 类 A 45 处独立一笔 | ✅ PASS |
| **新增 MUST（(b)）** | V12：`Address.validate()` 对抗性输入向量——已代跑，结果干净，补进向量表存档 |

---

## (a) Q3：N9 探针已跑——结果比 J2 假设的更严重

**J2 的问题**：F7 那 5 处 `new RpcClient({url: null, ...})` 在 strict 模式下会更常触发；N9 要验证的是它"会不会默认走公网 Resolver"（若是，strict 白修了）。

**我跑的结果（隔离子进程，`kasia-console/scratch/_nwt_n9_probe*.mjs`，退出即释放 wasm 线性内存，未连生产库/未碰任何长驻进程）**：

```
new RpcClient({url: null, encoding: Encoding.Borsh, networkId: 'testnet-12'})   → 构造成功（不抛）
rpc.connect()                                                                    → RuntimeError: unreachable（wasm panic）
```

三次独立复现（`url: null` / `url` 完全省略 / 裸 `try/catch` 无 `Promise.race` 包装）**结果一致**：**不是**默认走公网（J2 担心的方向），也**不是**优雅的可捕获错误——是 wasm 层的 `unreachable` 陷阱，**外层 JS 的 `try/catch` 包不住它，进程直接崩**（三次测试进程 exit code 均为 1，"reached after try/catch"那一行**从未打印**）。

**这改变了 F7 的严重程度和修法**：
- J2 §3.3 原话"若是（默认走公网）= strict 被绕开，5 处必须先加守卫"——**现在答案是后果更差的那一种**：不是"信任域被绕开"，是"**可预测的进程级 DoS**"。strict 上线后，任何一次 `getWorkingRpc()` 返回 `null`（本机不可用，且现在是 strict 下的正常情况，不是罕见边缘态）若被 F7 那 5 处直接拿去 `new RpcClient({url:null}).connect()`，**必定**（不是"可能"）让 console 进程崩溃退出。
- **try/catch 包不住 = 只能在构造前挡**：这意味着修法不是"给这 5 处加错误处理"，是"这 5 处必须在调用 `getWorkingRpc()` 之后先判 `url===null`，直接走各自的降级路径（返回 503/跳过本轮 tick/记 events），**永远不把 `null` 递给 `new RpcClient`**"。这是一个比"补 try/catch"更结构性的要求，我建议在 (a) 稿 §3.3/§4 里把这条从"探针 OPEN，Bettor 决定"升级为**MUST-FIX，且必须与 C1（strict 早退）同批落地，不能分开**——因为 strict 一旦上线而 F7 的 5 处守卫没跟上，等于是**strict 本身直接导致新的可预测崩溃**，这比"没做 strict"更糟。

**范围声明**：这个 panic 与 strict 设计本身无关（non-strict 模式下 `getWorkingRpc()` 几乎不会返回 `null`——总能 discover 到点什么，所以 F7 这个雷今天基本不响；strict 上线后 `null` 变成常态返回值，雷才会被踩上）。**这不是否定 strict 设计，是 strict 设计必须把 F7 的 5 处一并纳入同批，不能留 OPEN**。

## (b) 新增 V12：`Address.validate()` 对抗性输入——已代跑，结果干净

J2 §4 的 V1-V11 覆盖了"格式正确但网络不对/前缀伪造/边界值"，没有测"格式本身就是垂直攻击载荷"这一类——这是我在审 (a) 的 N9 之后特别关注的：既然这个 kaspa-wasm 模块族对 `RpcClient` 的坏输入是不可捕获的进程级 panic，`Address.validate()` 会不会也一样？这直接关系到 §3 表里 #25-#28（`trade-protocol-filter.js` 的入站协议消息，字段对手方可控）的安全性——如果 `validate()` 本身能被恶意构造的字符串打穿，那这条"入站路径不 throw，只 drop+log"的设计就不够，因为**在 drop 之前那一步的 `validate()` 调用本身就可能已经把进程带崩了**。

**我跑的结果（`kasia-console/scratch/_nwt_address_validate_hostile_probe.mjs`，11 组对抗输入：空串/嵌入空字节/1MB 长串/全角冒号混淆/无冒号/纯冒号/emoji/控制字符/破损 surrogate pair/纯数字/`"[object Object]"`）**：**全部干净返回 `false`，零崩溃、零抛出、零 wasm panic**。

**结论**：`Address.validate()` 与 `RpcClient.connect()` 在这个 wasm 绑定层的鲁棒性**不是同一等级**——前者看起来是按"输入校验函数"的标准写的（对任意畸形输入都走正常返回路径），后者在传入 `null` URL 时是"未预期输入直接进 unreachable"的写法。J2 §0 那句"helper 只用 `Address.validate()`，绝不 `new Address()`"这个设计决策**被我的独立测试证明是对的方向**——不是运气好，是这条分界线（validate 安全/construct 不安全）真实存在。

**MUST**：把这 11 组对抗输入补进 §4 向量表作 **V12**（不需要重新设计，我已经把可执行脚本写好，J2/落码时直接照抄断言："全部返回 false，不抛、不崩"）。这不阻塞 (b) 的 GO——它是确认性的，不是发现新洞——但必须落进正式向量文件，不能只停在我这次的临时探针里（同 CLAUDE.md 通则：证据要留在能被复跑的地方，不是留在某次审查的记忆里）。

## (b) Q1：入站路径 reject 形——PASS-with-condition（DoS 面确认存在，需限频）

J2 问"#25/#26 这类对手方可控字段用 `isAddressOnNetwork`+丢消息+events 记一行，有没有 DoS 面（P2-6 刚治过 events 全扫）"。

**答**：有。一个远程对手方只需要在协议消息里反复塞一个前缀不匹配的 `p2sh_addr`/`spine_p2sh` 字符串（不需要构造出能通过 `validate()` 的合法地址，任何字符串都行——`isAddressOnNetwork` 对畸形输入直接走 `empty`/`invalid-checksum` 分支拒绝，成本对攻击者是零，对我们是每次一条 events 写入），如果每次拒绝都写一行 `events`，就是一个免费的写放大攻击面，正是 P2-6 治过的同一类问题复发。

**MUST**：这几个入站站点的 events 记录必须走**限频**（同 `rpc-health.js` 已有的 `ALL_FAILED_NOTE_MS` 10 分钟限频模式，或按 `(sender, reason)` 聚合计数、定期落一行汇总而非逐次落一行），不能是"每次拒绝一行"。这个模式本仓已有先例，J2 落码时直接抄，不需要发明新机制。

## (a)/(b) 其余问题——PASS，理由简述

- **(a) Q1（写入口都要拒写）**：同意。只在读侧忽略会让 UI 显示"configured 已设"但实际未用，误导操作员，且是"给攻击者的信息泄漏"（暴露 helper 存在但绕不过）级别虽低但没理由留着。
- **(a) Q2（relay 顶层 throw）**：同意。与 `rpc-health.js:19` 同形，错配在 relay 子进程刚起来那一刻就暴露、日志里显眼，比"发送时才报错"更早发现问题，且避免部分请求成功部分失败的中间态。
- **(a) Q4（不拆两笔）**：同意，理由更进一步：拆开落码本身会制造一个和 T2（读数 strict、递交不 strict）同形状的过渡窗口——先落非钱路那批的话，console 读数变严格但 relay 还没跟上，这段时间里 console 会更频繁地判"本机不可用"，但 relay 仍可能通过旧路径拿到外部端点递交，反而制造了一个新的、临时的信任域分裂。**必须同批**。
- **(b) Q2（testnet-11 不进表）**：同意，未知网络直接 throw 比"认识一个几乎没人用的旧网络"更安全，且 09-07 清单里那 7 处命中本身是陈旧注释/脚本，不是活跃调用点。
- **(b) Q3（kaspa 注入而非自 import）**：同意，"shared 目录零依赖、测试零安装"这个理由本身就够，且避免 shared 目录里再长出一份独立的 wasm 加载路径（这类模块每多一个加载点就多一份 4GiB 顶/内存泄漏记账面，见既有 memory 家族）。
- **(b) Q4（类 A 45 处独立一笔）**：同意，机械替换且不涉及本稿的核心不变量，混进同一笔 review 会稀释对 33 处高风险替换的审查注意力。

## Bettor 派给我的两件事——答复

**(i) N9 跑不跑/怎么隔离**：跑了，见上。隔离方式：独立子进程（`node` 直跑一次性脚本）、5 秒超时兜底、退出即释放 wasm 线性内存（不进任何共享池/长驻进程），全程只 `connect()`/`getServerInfo()`（只读），未调用任何 submit/broadcast/sign。三次复现一致，不需要再跑。

**(ii) A-N3 口径（Bettor 已拍：DB 配置的局域网/回环端点同样 ⇒ null）**：同意，不推翻。理由：D-017 之后是单机模型（da9 一台机跑主网节点+console+relay），(a) 稿 S1 的"strict = 只信 env 那一个值"本来就是为单机模型设计的最简单、零漂移面的规则；多留一个"LAN 例外"只是为一个 D-017 之后不再存在的部署场景（console/relay 分处不同物理机）留后门，且这个后门本身就是 Codex 最初点名的洞的一个变体（"看起来局域网内网就该信"这个直觉正是 09-06 22:55Z 事故的心理原型）。没有更强理由推翻，PASS 你的拍板。

## 给 Bettor 的处置建议

- (a)(b) 两稿本身可以进入落码报备（钱路部分仍需 Owner 批，同稿已注明）。
- **落码前必须补的两条**：F7 的 5 处守卫与 strict 早退（C1）同批（不能标 OPEN 延后）；(b) 的入站 events 限频（Q1 答复里的 MUST）。
- V12 向量表补录，非阻塞但要落文件。
- 批 T 的 H5（owner_scheme 授权证明形只证"在场"不证"同意"）我下一条单独审——这个问题本身与我此前红队 testtoken 评估时 §4"borrow_scheme 须钉死"那条同源（都是"协议约束只挡了收币方形态，没挡住谁能触发转移"这一类），先说一句初判：**方向上应该升 MUST**，具体裁定等我看完 J2 T0 回填的实编证据再给完整意见。
