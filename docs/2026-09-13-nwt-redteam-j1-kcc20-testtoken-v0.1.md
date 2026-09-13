# NWT 红队 · J1「主网押注资产 = 自发免费无限铸造 KCC-20 测试币」评估 v0.1.1 审（对应 D-017）

> **Status**: FINAL v0.1（2026-09-13 · NWT · docs only，不动代码/live 树）
> 审对象：`docs/2026-09-13-owner-mainnet-test-token-kcc20-free-mint-assessment-v0.1.md`（`origin/coord/j1-mainnet-testtoken` @5c6995e9，DRAFT v0.1.1，138 行）。派单出处：Bettor SendMessage 2026-09-13（六点审点：(1) (a) 是否真堵死个人持有/二级市场 (2) §3.5 稳定币骨架三入口攻击面 (3) §9 停/删顺序 (4) §7 五拍逐条 (5) §8 独立核 (6) 总判能否作批 T 输入）+ D-017 §3 执行门（KANet-UI runbook → NWT 审 → Owner GO）。
> **方法**：头号铁律——default 假设有洞，主动构造攻击链，真找不到才 PASS；PASS 要列"试了哪些攻击、为什么都失败"。设计已自陈不覆盖经济安全（§4.3），红队重点是**该稿自己声称成立的性质**是否真的成立。
> **裁决范围**：只审设计文档，不构成对任何代码/钱路/停节点/删数据的批准——那些各自要走各自的门。

## 结论一览

| 项 | 裁 | 一句话 |
|---|---|---|
| §3.2 免费无限 mint（价格论据） | **PASS** | 无限自由复制 ⇒ 结构上不可能有稀缺价格 |
| §3.3 (a) 只许 `owner_scheme==0x04` ⇒ "个人拿不住，OTC 无从谈起" | 🔴 **PUSH-BACK（找到攻击链 + 外部规范原文印证）** | (a) 只约束"收币方是某个 covenant"，不约束"那个 covenant 是谁写的、谁控制"——KCC-0020 规范原文证实这条洞是规范内置的，不是猜测 |
| §3.5 稳定币骨架三入口 | 🟡 **HOLD（三条 MUST，实现前必须锁死）** | 三个"预留位置"若做成运行时可切换的状态标志而非编译期常量，就是一条隐藏的权限升级路径 |
| §6-4 结算领取 covenant 的"名下"绑定 | 🟡 **HOLD（未设计）** | 新的 verify-value-source 承重点，批 T 稿必须单独写 |
| §9 停消费者→停节点→删数据目录 | 🔴 **PUSH-BACK（两处缺口）** | 缺"drain 在飞交易"步骤；"随时能重新同步"与本机既有 peer 稀缺证据矛盾 |
| §7 五拍 | 见 §5（逐条裁） | ①③④⑤ PASS，②(sil-v1 命名) PASS-with-note |
| §8 v1.0.0 断言 | **独立核实：全部成立**，且发现一处 J1 未提及的额外协议特性需要 J2 纳入设计 | 见 §4（含外部只读验证过程） |
| 总判：能否作批 T 输入 | **可以，带 3 条 MUST-FIX 门槛** | 见 §6 |

---

## 1. 攻击链：(a) 挡不住"自建 covenant 包一层"的事实场外交易——含外部规范原文印证

**设计原话**：`transfer`/`mint` 的每个 `next_states[i].owner_scheme` **必须 == 0x04**；效果声称"币永远不落到个人地址，OTC 无从谈起"。

**我试的攻击**：
1. 攻击者自写一个最简单的 covenant，唯一 spend 分支 `require(checkSig(sig, myPubkey))`。这个 covenant 自己的输出 `owner_scheme` 也是 `0x04`（它本身就是"某个 covenant"）。
2. 用免费 mint 铸造任意数量测试币，`to`=这个自建 covenant 的 covenant-id，`to_scheme=0x04`——协议检查通过（检查的是"收币方是不是某个 covenant"，不是"是不是 KANet 市场模板"）。
3. 攻击者与另一方谈好场外 KAS 对价，用自己对该 covenant 的签名把币"转"给对方控制的另一个自建 covenant——产出状态 `owner_scheme` 仍是 `0x04`，协议层完全放行。

**外部规范印证（不是我的推断，是 KCC-0020 规范原文——2026-09-13 只读 shallow clone `github.com/kaspanet/kccs`，未构建、未部署，符合铁律 0）**：

> 规范 §2 owner-authentication 表：`covenant-id/v1` 一行的 owner-authentication bytes = **Empty**。

这句话是关键证据：对 `owner_scheme=covenant-id/v1(0x04)` 的状态，"owner 授权"**不需要任何签名/证明数据**——因为规范设计的语义是"owner 字段本身就是一个 KIP-20 covenant-id，谁是那个 covenant（谁的字节码在跑）就是谁在授权"。**这精确印证了我的攻击链**：(a) 约束的是"下一个状态必须由某个 covenant 持有"，而"那个 covenant 的字节码写的是什么、谁能触发它的 spend 条件"完全是**app 自定义、KCC-0020 规范不管、KANet 的 (a) 也不管**。这不是我构造的边角案例，是规范把这条路径当作**默认路径**写进去的。

**为什么设计者自己也知道这个洞**：§3.3 表里 (b) 档（模板前缀锁）正是为堵这条路，稿子明写"(b) 列为升级项，先不做"。**我确认的是：这个已知限制的攻击路径是可执行的、成本极低（一份 <10 行的 silverscript + 一次转账手续费），不是理论假设。**

**裁**：PUSH-BACK。**MUST**（给 §5 合规措辞）：给律师材料前，措辞必须收窄为"协议层设计使代币不能持有在任何 p2pk/p2pkh/p2sh 裸地址中；关于场外自建 covenant 转让的可行性与阻断（(b) 档）目前未实现"——不能说"结构上长不出二级市场"，因为场外流转（换个包装层）现在就能做，只是"裸地址持有"做不到，这两个是不同强度的声明。

## 2. §3.5 稳定币骨架三入口——攻击面（Bettor 审点 2）

三个"预留位置"（① mint 校验位 ② clawback 路径 `require(false)` ③ 暂停证明入口）本身的**设想**没问题（同一骨架、换 require 条件），风险全部集中在**"切换"这个动作的实现形态**上：

| # | 攻击场景 | 判据 |
|---|---|---|
| P1 | 若"测试态/稳定币态"做成**已部署合约的运行时状态标志**（某个 state 字段的一个 bit），而不是**编译期常量**（不同源码常量编译出不同字节码、不同 covenant-id） | 🔴 **必须是编译期常量**。运行时标志意味着已经在主网跑着、被信任为"零价值测试币"的那个 covenant，理论上存在一条状态转移路径能把它"升级"成签名门禁的稳定币（或反向：把已上线的稳定币态"降级"回无校验的免费 mint 态）——这条切换路径本身就是特权升级通道，谁能构造出触发它的交易就有这个特权。**MUST-FIX**：批 T 设计稿必须明写"切换 = 部署新 covenant-id，不是同一部署实例内的状态转移"，并给出负向量：尝试构造一笔把现有测试币 covenant 的 mint-check 从"无校验"翻成"有校验"（或反向）的交易，必须在协议层无这样的分支可选——即根本不存在这个 opcode 路径，不是"存在但被 require 挡住"。 |
| P2 | clawback `require(false)`：若编译器把恒假分支当死代码优化掉，字节码/dispatch tag 布局可能与"有 clawback"版本不同，将来"补上 clawback"不是改一个条件而是要重新过一遍 codegen 差异核对 | 影响不大（后果是工程摩擦不是安全洞），但**批 T 设计稿要写清**："clawback 分支即使 `require(false)`，也要在测试币版本里保留可达的 dispatch tag 位置，不能让编译器把整个分支从产物里抹掉"，否则将来"同骨架换 require"这句承诺在字节码层面不成立。 |
| P3 | pause 入口 `checkMsgSig` 时效签名 + `tx.daa` 窗口，"测试币态不检查"——若这句意思是**编译进字节码但签名门禁用占位/空 key**而非**编译期直接不生成该分支**，需要验证占位 key 材料不会被某些签名实现的退化情形（全零 key / 全零签名）意外通过 | 这是我域内标准的"vacuous-teeth 判别"——批 T 落地时**必须**对暂停入口做正反双向向量（happy-path 用真占位数据 LAND、attack 用退化输入 BUST），不能只看"文档说不检查"就当已验证。 |

**总裁**：HOLD——三个入口目前只是路线图描述，没有可审的实现。**MUST 门槛**（进 J2 批 T 设计稿的前置条件）：显式写清 P1（切换=新部署非状态转移）+ P3（暂停入口的正反向量计划）；P2 是记录项不阻塞。

## 3. §6-4 结算领取 covenant 的"名下"绑定——仍是 HOLD（未变更判断，补依据）

§6 步骤 4："结算时 transfer 给赢家的市场领取 covenant……个人钱包余额=其名下领取covenant的amount之和"。KCC-0020 状态字段里没有"名下"这个身份概念——`owner` 字段在 (a) 档下只能编码成"某个 covenant-id"，**谁控制那个 covenant（领取 covenant 内部的 spend 授权逻辑）是 KANet 自己要写的合约，规范完全不管**。这正是我域内的核心问题：checker 读到的"来源"是什么、能不能被非授权方伪造/抢跑/冒领。**此刻没有设计可审**（路线图一句话，非实现稿）。**MUST**：批 T 稿必须把"领取 covenant 持有人绑定机制"作独立小节详写，我按 verify-value-source 清单审（同 §6-3/D-016 recovery-lock 系列方法论，不是新方法）。

## 4. §8 独立核实（Bettor 审点 5）——全部成立，另发现一条 J1 未提及的协议特性

**核实方式**：本机 da9 无 silverscript v1.0.0 本地checkout；用已有的隔离侧目录 `/d/silverscript-v1rc1`（rc1，非 live 树、非 pinned `silverc-zk-8065184`）只读 `git fetch origin --tags`，独立取到上游最新 tag，**未编译、未部署、未碰任何生产/live 路径**，符合铁律 0/D-005。

| 断言（J1 §8） | 我的独立核实结果 |
|---|---|
| v1.0.0 = commit `3ed9733`（2026-09-09） | ✅ 一致：`git rev-parse v1.0.0` = `3ed973335b59269293564805cc2c58a14595ec03`（提交标题 "Prepare SilverScript 1.0..."） |
| `COMPILER_VERSION` 仍 `"0.1.0"` | ✅ `git show v1.0.0:silverscript-lang/src/compiler/mod.rs` 第55行原文 `pub const COMPILER_VERSION: &str = "0.1.0";` |
| pragma `^1.0.0` 会被拒、`^0.1.0` 过 | ✅ 逻辑自洽：semver `^1.0.0` 要求 `>=1.0.0 <2.0.0`，实际编译器版本 `0.1.0` 不满足；`^0.1.0` 满足。与 `static_check.rs` 的 pragma 校验逻辑一致，无需跑代码即可核 |
| rc1→v1.0.0 仅 4 commit，但引入 ~2000 行静态拒绝 | ✅ `git log c7d17a1..v1.0.0` 恰 4 commit；`git diff --shortstat c7d17a1 v1.0.0 -- silverscript-lang` = 24 文件、+2729/-341（PR #245/#246 标题正是"reject contracts exceeding resource limits"类），量级一致 |
| OP_PICK/`pick_from_depth` 已不在 upstream（#178 重构消灭） | ✅ `git show v1.0.0:silverscript-lang/src/compiler/compile.rs \| grep -n "OpPick\|pick_from_depth"` 与在 rc1 同样查询**均零命中**——upstream 从 rc1 起已经没有这个 codegen 路径了，与 D-016 状态注记（"v1-rc1 已消灭"）一致，J1 §8 的措辞（"非合并我们的修复"）作用域写对了，没有把本机分支修复说成上游已采纳 |
| KCC-0020 已合并 | ✅ shallow clone `github.com/kaspanet/kccs`：PR#2 = commit `e31a5a8`（"KCC-0020: fungible token covenant specification"）在主线历史里；文档头 `Status: Draft`（是，J1 §3.1 也如实标了"文档头仍写 Draft"，没有夸大） |
| 六字段状态布局 | ✅ 规范原文一字不差：`amount / owner / owner_scheme / borrow_scheme / borrow_guard / extension_commitment` |
| `owner_scheme` 0x00–0x04 表 | ✅ 规范原文一字不差（p2pk-schnorr/v1…covenant-id/v1，"32-byte KIP-20 Covenant ID"） |

**🆕 一条 J1 §3.1/§3.3 未提及、需要纳入设计的协议特性——"borrowed receive"（KCC-0020 §5）**：规范定义了第二条转移路径（`witness` 首字节 `0x01`），允许**非 owner** 的一方在满足 `borrow_scheme`（`disabled/amount-threshold/schnorr-signature/hash-chain`）规则时**增加**某个"leader"状态的 amount 而不需要完整 owner 授权（本意像是 flash-loan/组合式接收原语）。J1 稿完全没提这个字段/机制，§3.3 的转移限制表只讨论了"normal"路径（首字节 `0x00`）。**这不构成对现有裁定的否决**——`borrow_scheme` 字段本身仍受 (a) 约束（借入方的下一状态 `owner_scheme` 仍必须是 `0x04`，因为它同样经过 transfer 校验），但**J2 批 T 实现时必须明确**：市场/领取 covenant 的 `borrow_scheme` 字段部署时钉成 `0x00 disabled/v1`（否则默认值不明或被误配置成其它值，等于开了一条"未经 owner 完整授权即可让别人往你的 stake covenant 里塞 amount"的旁路——即使当前用不上，留着一个未钉死的字段本身就是 attack surface，按我域内"config 字段选入口/边界=权威非参数"的标准要求显式钉死并测负向量）。

## 5. §7 五拍逐条裁（Bettor 审点 4，对应 D-017 §4 Bettor 已拍）

| 序 | 内容 | 裁 |
|---|---|---|
| ① 转移档 v0.1=(a)，(b) 待模板稳定再议 | **PASS-with-note**：(a) 起步合理（分阶段），但见 §1 MUST——(b) 应从"可选升级"改写为"关闭已知 OTC 缺口的必要项"，不能语气偏轻带过 |
| ② 合约文件 `sil-v1/KanetTestToken.sil`、ticker `KTT` | **PASS**：命名与目录选择不涉安全性质，无异议；`sil-v1/` 目录形式与 J2 v1 迁移计划 §6-1 悬而未决项一致，跟随 J2 稿定案即可 |
| ③ 向 `kaspanet/kccs` 提 permissionless-mint 用例说明留到 GO 前不做 | **PASS**：对外动作延后是正确的风险控制，无异议 |
| ④ 并入 J2 v1 迁移计划为"批 T"（批 A 后、批 D 前） | **PASS-with-condition**：见 §6——批 T 设计稿必须先满足本审 §2/§3/§4 的 MUST-FIX 才能视为"可进入实现" |
| ⑤ 目录 `sil-v1/` 不用后缀 | **PASS**：跟随 J2 既有迁移计划口径，无独立安全含义 |

## 6. §9 停消费者→停节点→删数据目录（Bettor 审点 3）

**顺序本身的方向是对的**（先停会往节点递交易的东西，再停节点，避免"节点已停但消费者还在踢门"的自愈重连噪声）。**两处缺口**：

1. 🔴 **缺"drain 在飞交易"步骤**——J1 §9 点1列的清单（settler / seeder / 再平衡 cron / `bshard-close-*` / `zk-prove-worker` / `tn12-mining-watchdog-v2` / stratum 桥）是"停哪些进程"，没有"停之前先等这些进程手上已经 submit 但还没确认的交易落地或明确失败"这一步。这正是既有 memory 记录过的同族问题（`feedback-preshutdown-money-surface-is-timers-plus-ingress-triggered-paths-quiesce-ingress-before-restart`）——这次是永久停节点不是重启，代价更高：一笔停节点瞬间正在飞的交易，如果节点停止导致它既没确认也没被明确拒绝，DB 里会留一条"不知道成没成"的状态，且**之后节点数据目录还要被删**，事后再也无法用本机数据核实它落链没有（只能靠外部 explorer，如果 TN12 还有人维护索引的话）。**MUST**：runbook 增加"停消费者后，等一个安全窗口（覆盖节点正常确认深度）+ 核对 `kaspa_tx_log`/`submitted_txs` 类表里最后一批 submit 记录的落地状态，全部落地或明确失败后才进入停节点步骤"。
2. 🔴 **"链是公开的，随时能重新同步"与本机既有证据矛盾**——memory `reference-tn12-has-no-public-resolver-entries-and-a-single-forward-peer-136-243-93-17` + ledger (998)/(999)（唯一前向 peer 反复失联、第二台前向节点扫描无候选、"我们是候选节点的未来"）显示 TN12 的可重新同步性依赖一个已知不稳定、正在缩水的 peer 池。这不是反对停节点/删数据的决定（那是 Owner 已裁的事，本审不重议），是**运营假设的确定性被高估**，需要在措辞上收窄："若能找到一个更新的 peer（如未来建的 S-2 节点/其他运营方节点），可以重新同步；当前已知 peer 池不保证这一点。"**MUST**：写进 KANet-UI 即将出的 runbook 的"不可逆性说明"里，供 Owner 终端拍 GO 前看到。

**执行门确认**：本裁决不构成对停节点/删数据/合约实现任何一项动作的批准；D-017 §3 的门（runbook→NWT 审→Owner GO）仍需在 KANet-UI 的 runbook 出现后单独走一轮，本稿只覆盖设计文档层。

## 7. 我试过但没找到攻击的地方（PASS 部分，"挣来的"清单）

1. **免费 mint 作资源耗尽/DoS**：每次 mint 仍是真实交易，攻击者要为垃圾状态自付真 KAS 手续费——经济自限，不构成免费 DoS。唯一残留风险是"验证工具假设小规模 UTXO 数量"，记为工具健壮性待办，不算协议漏洞。
2. **`owner_scheme` 枚举外字节值 fail-open**：`require(==0x04)` 是等值判断，任何未定义值天然被拒——fail-closed by construction，找不到绕过（与我在主网前缀推断问题上批评的"三元表达式 else 落到 mainnet"是相反的好例子）。
3. **mint 调用者伪造**：设计本身即"不校验调用者"，没有"绕过校验"这回事，不构成 finding。
4. **§8 措辞作用域错误**（CLAUDE.md 铁律 0.5 反复出现的坑）：J1 原话作用域写对了（"上游已修复≠我们的修复"），独立核实（§4）无作用域错误复发。

## 8. 总判（Bettor 审点 6）：能否作批 T 输入

**可以，带 3 条 MUST-FIX 门槛**（不满足则批 T 设计稿本身应被判 HOLD，不是这份评估稿的问题）：
1. §1：合规措辞收窄（(a) 只挡裸地址持有，不挡场外自建 covenant 流转），且路线图把 (b) 从"可选升级"改记为"关闭已知缺口的必要项"。
2. §2：稳定币骨架切换机制必须是编译期常量/新部署，不能是运行时状态标志（P1）；暂停入口预留正反向量计划（P3）。
3. §4：`borrow_scheme` 字段部署时必须显式钉死为 `disabled/v1`（0x00）并测负向量，不留默认值不明的旁路。

§3（领取 covenant 绑定）与§6（drain+重新同步措辞）不阻塞"批T可以开始设计"，但必须在批T设计稿里各开一节，交我审。
