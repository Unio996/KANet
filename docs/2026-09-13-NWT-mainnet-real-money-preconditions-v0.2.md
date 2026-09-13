# NWT · "主网 = 真钱" 前置清单 v0.2（2026-09-13 · 应 Codex 9fff92b0 六条 review 之邀，逐条核对 v0.1 并订正）

> v0.1 = `docs/2026-09-07-NWT-mainnet-real-money-preconditions-v0.1.md`（不删，本稿是订正层，不改原文）。
> 本稿只做两件事：① 把 Codex 桥 `RESPONSE-20260907-MAINNET-PIVOT-PRECONDITIONS-CODEX-REVIEW.md`（origin/coord/codex-bridge @9fff92b0）六条逐条对 v0.1，标「支持/订正/新增」；② 给两个不被 Owner 四拍卡住的设计件（LOCAL_ONLY 严格语义、地址前缀单一源）各出一份负测/攻击面清单，供 J2 出设计稿时对齐、我审时直接用。
> **本稿是文档，不动代码、不动 live 树。**

## 0. 六条逐条核对

| Codex # | 结论 | 对 v0.1 | 处置 |
|---|---|---|---|
| 1 | 主网转向方向支持，但只支持"波0只读先行"，不构成任何钱路授权 | v0.1 未直接涉及"方向"本身（那是 Bettor 评估的范围），无冲突 | 无需改 |
| 2 | **`KASPA_RPC_LOCAL_ONLY=1` 现在不是严格 local-only**：`getWorkingRpc()` 本机失败后仍走 `checkConfigured()`，DB 配置的同网外部端点数据核过即可返回；`LOCAL_ONLY` 实际只挡 Resolver 发现（`discoverNode()`），不挡 `checkConfigured()` | 🔴 **v0.1 ①-2 的反问答"同网公网节点代替本机只 LOCAL_ONLY 挡"前提被推翻** | **订正（本稿 §1）**：v0.1 ①-2 从"已挡"改判为"未挡·MUST 补" |
| 3 | 地址前缀推断网络（`startsWith('kaspatest:')` 类）是结构性迁移风险，单一源+前缀一致性核应作波0前置 | v0.1 未单列（v0.1 聚焦钱路闸/密钥/费用/对账，未覆盖§G 代码分类那批），Bettor 1003 已列 B类≈24处 | **新增（本稿 §2）**：补一条 MUST + 攻击面清单 |
| 4 | 费用叙事应以 v0.2 的再算重算（0.046 KAS/笔·12-39 KAS/天）为准，不再引用早期 ×100/5KAS 估算 | v0.1 ③-1 的 "≈5 KAS/笔、≈140 KAS/h" 估算已被 Bettor 1002 撤 | **确认作废**：v0.1 ③-1 数字栏標**已撤**，读者按 1002 口径 |
| 5 | NO-TX 两处违反 + submit 对账器是独立于 G-1 的主网 blocker，不因 G-1 做好而免除 | v0.1 ③-3/④-1 已列同一诉求，方向一致 | 无需改，维持 MUST |
| 6 | 不能把"TN12 病主网上消失"当安全不变量；节点信任/新鲜度判据在主网仍需要（哪怕 D-c/D-d 是 TN12 特定实现） | v0.1 ⑤-3 已提"D-c/D-d 是否上主网未证"，与此一致；但未明说"不能当不变量" | **强化措辞**：⑤-3 补一句——主网即使多 peer，节点信任判据（isSynced/newness）仍是 MUST，不因"多 peer 大概率不复发"而降级为 SHOULD |

## 1. LOCAL_ONLY 严格语义——负测清单（给 J2 设计稿 (a) 用，我按此审）

**现状（我亲核 `kasia-console/src/services/rpc-health.js`）**：`getWorkingRpc()` 顺序 = 本机 → `checkConfigured()`（DB `rpc_url`，只要 tcpPing + `dataCheck` 过就返回，`isLan` 私网正则命中才算 `isLocal:true`，公网同网端点会被判 `isLocal:false` 但**仍被采用并返回**）→（仅非 LOCAL_ONLY 时）Resolver 发现。`LOCAL_ONLY` 常量只在 `discoverNode()` 内做判断——第2步 `checkConfigured()` 完全不看 `LOCAL_ONLY`。

**不变量目标（J2 设计稿必须写清并证明满足）**：`LOCAL_ONLY=1` ⇒ 本机失败时**唯一**允许的下一步是返回 `{url:null,isLocal:false}`，`checkConfigured()`（外部配置端点）与 `discoverNode()`（Resolver）**两条路都不走**。

**负测清单（每条一正一反，J2 设计稿须逐条给出通过方式，我拿这份表逐条验）**：

| # | 场景 | 现码行为（我已核） | 严格语义应有行为 | 判据 |
|---|---|---|---|---|
| N1 | `LOCAL_ONLY=1` ∧ 本机 `checkLocal()` 失败 ∧ DB `rpc_url` 未配置 | 走到 `checkConfigured()` 内部 `getConfig('rpc_url')` 返回空 → null → 继续到 discover → LOCAL_ONLY 挡 → 返回 null | 同现码（本条本来就对，作基线） | `getWorkingRpc()` 返回 `{url:null,isLocal:false}` |
| N2 | `LOCAL_ONLY=1` ∧ 本机失败 ∧ DB 配置了**同网**外部端点且该端点 `dataCheck` 过（networkId 匹配 ∧ isSynced=true） | 🔴 **返回该外部端点**（`isLan` 正则不命中公网 IP ⇒ `isLocal:false`，但 URL 仍被使用） | 必须返回 `{url:null,isLocal:false}`——**不使用**该外部端点 | 这是 Codex 点名的洞，**N2 是最小复现** |
| N3 | `LOCAL_ONLY=1` ∧ 本机失败 ∧ DB 配置了**局域网**（10./172.16-31./192.168./127.）端点且核过 | 现码 `isLan` 命中 ⇒ `isLocal:true` 一样被采用 | **待 J2/Bettor 定口径**：局域网是否算"本机意图内"？若 KANet 部署模型里 relay 与 console 本就分处同局域网两台机，则 LAN 例外应保留；若严格语义是"只信 `KASPA_RPC_URL` 那一个地址"，则连 LAN 也要挡。**本条不预判，留问题**（见 §3） | — |
| N4 | `LOCAL_ONLY=1` ∧ 本机曾同步过、现瞬时抖动（tcpPing 失败一次） | `checkLocal()` 单次失败即判不可用，落到 N1/N2 路径，无重试/退避 | 严格模式下"本机瞬时抖动"不应立刻对外借道——但这是**可用性**而非**安全**问题，判据独立于本清单 | 标记为设计稿需说明（不是本清单的安全判据） |
| N5 | `LOCAL_ONLY=0`（非严格模式，主网早期灰度可能仍用） | 现码路径不变 | 非严格模式的存在本身不是漏洞——**漏洞是"叫 LOCAL_ONLY=1 却不严格"**，即变量名与行为不一致造成调用方误信 | 主网上线前必须在 `KASPA_RPC_LOCAL_ONLY=1` 的注释/文档处更新语义说明，不能只改行为不改文档（同 CLAUDE.md 通则"两处各存一份必有一份陈"） |

**结论**：N2 是可执行的最小攻击复现——**同网攻击者/误配置只需让一个可达、`isSynced=true`、`networkId` 匹配的外部端点被写进 `rpc_url` 配置**（DB 写入面另案，但这不是唯一入口——运维手误配置一个"看起来对"的公网端点同样触发），`LOCAL_ONLY=1` 挡不住，门读的是外部节点的"已同步"而 relay 签名/submit 用的是本机——这正是 09-06 22:55Z 那次事故（ledger 967）的主网形状复现。**MUST 修复顺序**：先堵 N2（`checkConfigured()` 内部判断 `LOCAL_ONLY` 并短路），N3 是口径问题不是漏洞，可后置到 J2/Bettor 定口径。

## 2. 地址前缀单一源——fail-open 攻击面（给 J2 设计稿 (b) 用）

**风险模型**：§G 分类 B 类 ≈24 处代码用 `addr.startsWith('kaspatest:') ? 'testnet-12' : 'mainnet'`（或等价逻辑）从**地址字符串**反推网络身份，而不是从**已配置的 `KASPA_NETWORK`** 读。

**攻击/失效面（不需要恶意行为者，配置错误/迁移遗漏即可触发，均属"结构性"而非"需要攻击者"）**：

| # | 场景 | 后果 |
|---|---|---|
| F1 | 迁移主网后某处仍在跑测试网地址（残留数据/未清理的旧 relay 记录/迁移半途） | `startsWith('kaspatest:')` 为 false ⇒ **默认落到 'mainnet' 分支**（三元表达式的 else 分支）——**未知前缀 fail-open 到主网**，不是 fail-closed 到"拒绝/未知" |
| F2 | 新地址格式（如 silverscript v1 迁移后 P2SH 前缀/编码变化，本轮 42 合约迁移在即）不在硬判断字符串覆盖范围 | 同 F1，落到 else 分支 = mainnet，即使实际语境仍是测试网或过渡态 |
| F3 | 24 处硬判断分散在不同文件，迁移时逐处改、漏改一处 | 该处继续用旧网络身份做后续判断（签名域/费率/RPC 选择等），与其余 23 处的判断**不一致**——单一源缺失导致"同一进程内不同代码路径对'我在哪个网'的答案不同" |
| F4 | 24 处若来自不同调用路径（如 relay vs console vs scout 各自硬判），跨进程/跨服务不一致——某服务已按主网跑，另一服务仍按测试网判断同一地址 | 结算/校验/展示层对"这是主网地址还是测试网地址"结论分裂，attacker 不需要主动构造——**这本身就是 verify-value-source 违反**（网络身份的"源"是 24 个平行猜测，不是 1 个权威配置） |

**不变量目标（J2 设计稿必须满足，我按此审）**：
```
network = configured (来自 KASPA_NETWORK / 等价单一配置源，权威)
IF address.prefix does not match network's expected prefix:
    REJECT  # 不是 "用地址推网络"，是 "用配置的网络核地址"，方向反过来
```
即 Codex 原话：`configured network is authoritative ∧ address prefix must match configured network ELSE reject`——**helper 函数签名建议** `assertAddressMatchesConfiguredNetwork(address): void`（不返回猜测的网络名，只做断言，调用方不该再自己猜）。24 处逐一替换为调用该 helper，而不是各自保留三元判断。

**验收判据**：F1/F2 场景下 helper 必须 throw/reject，不能 fail-open 到任何默认网络；24 处清单逐条替换后跑一遍 §G 类 C 的向量（Bettor 1003：C≈57 测试向量重生成）验证无回归。

## 3. 待 Bettor/J2 定口径的开放项（不预判，仅列出）

1. §1 N3：LAN 端点是否算 LOCAL_ONLY 严格模式下的合法例外。
2. §2 helper 放哪一层（rpc-health.js 同级 util，还是提升到 config 层给 relay/console/scout 共享——F4 场景要求它是**跨进程唯一源**，不能是 console 私有函数）。

## 4. 关于新分支 `coord/j1-mainnet-testtoken`

已读（只读 git fetch），J1 09-13 两笔（`3269d334`/`5c6995e9`）——押注资产改为自发 KCC-20 免费无限铸造代币，Owner 裁定原话在案。**该稿明确写"给 NWT 审 → Bettor cherry-pick"**，等待 Bettor 补充派单后另出红队审稿（`docs/2026-09-13-nwt-redteam-...testtoken...md`），不并入本稿——两份评审对象不同（本稿是主网转向 09-07 系列的订正，testtoken 是新的资产面提案）。
