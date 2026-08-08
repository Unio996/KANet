# Broker (a) 初始注册签名挑战 · 设计稿 v0.4

> **Status**: CURRENT
> 🔴 **v0.4 变更（Codex 2026-08-08 二审 MUST-FIX，Bettor 派工 @KANet-UI 接，本次两条一起闭）**：
> 1. **唯一挑战寻址**（§4）：提交载荷补 `nonce` 字段，验证改为按 `nonce` 精确定位单条记录，不再对"同一 `broker_address` 下可能有多条未消费 nonce"这件事做隐含假设。
> 2. **变更绑定**（§2-bis 新增）：`descriptor` 的输入集合从"随最终形态定"冻结为一个封闭定义，机械绑定操作类型 + bot/token 绑定语义 + role/network/address，堵住"合法签名被拿去打不同写入"的重放缺口。

**Owner**: KANet-UI
**日期**: 2026-08-08
**授权范围**: Owner 裁定"不冲突，作用域不同"（2026-08-07 06:37Z 终端）+ 正式指令 `D012-OWNER-RULINGS-20260807-001` §二（2026-08-07 06:44Z）：**设计与落码均获批**。本稿覆盖设计；落码分小步走完整报备→审核→批准→测试流程后再各步提交，不在本稿一次性授权。
**🔴 硬边界（Owner 逐字，不得放宽）**：
- 证明作用域**只限"注册当时对该地址私钥的控制"**——不得写成身份认证 / 运营方独立 / 持续持钥 / 处分授权。
- 挑战至少绑定**七要素**：协议版本 / 网络 / Broker 地址 / 角色 / 注册描述符或端点摘要 / nonce / 有效期，阻断跨网络-跨注册-过期重放。
- **公开端点暴露、部署、真实注册流量、资金动作不在本次授权内**——本稿与后续落码仅在本地/隔离环境验证，不上线、不接外部流量。
- D-012 §0：本条属 **Track B**（协议层能力，任何 fork 部署者可用），不构成 Track A（Owner 自己实例）对外开放任何权限。

---

## §0 复用而非重造

2026-07-26 曾有一版完整挑战-签名方案（`docs/2026-07-26-broker-onboard-identity-design.md` 提交 `a1fba51b`，v0.2），因当时 Owner 判"对 broker 初始注册这件事不需要"而三次否决、方案下桌（该文档现存版本已把整套方案删除）。**该否决的作用域是 Track A 的初始注册**（冒充无利可图/不分级/链上花钱本身已是控钥证明——这三条理由对"谁能注册成为 Owner 自己实例的 broker"成立）。**D-012 §6-4 把同一件事放进 Track B**（协议层能力，任何第三方 fork 部署者需要），**不受 07-26 否决约束**（不同 Track，见 D-012 §0）。

⇒ **本稿不重新发明，直接复用 07-26 v0.2 的技术设计**（挑战机制、自描述签名字节、P2SH 硬闸、拱心石原则、provenance 分档、逐写签名、错误码分离），**只按 Owner 08-07 的新裁定调整措辞与范围**：v0.2 写的是"身份"，本次 Owner 明确收窄为"注册时刻的私钥控制"，不写成身份/独立性/持续持钥/处分授权。技术机制不变，**断言的强度必须收窄**。

---

## §1 现状（今天，直接从代码读）

- **路由**：`POST /api/kanet-broker/onboard`（`kasia-console/src/api/kanet-broker.js:32-114`）。只用正则 `/^kaspa(test)?:[a-z0-9]{50,80}$/` 校验地址格式，**零密码学控制权校验**。
- **写入行为**：按 `broker_address` UNIQUE upsert；**UPDATE 分支（换 bot_token）不重新验证任何东西**——知道对方地址（公开可见）即可覆盖其 bot 绑定。
- **表结构**（`broker_onboarding`，`kasia-console/src/db/migrate.js` v173，`status` 列已在 v194 移除）：`id / broker_address / bot_token_encrypted / bot_username / note / created_at / updated_at`。**无 nonce / expires / signature / provenance 任何字段。**
- **现存行**（现读，2 行）：
  1. `kaspatest:qzhet8m2...`（2026-07-05），绑定 `@younio2024`，命中 `tg_custodial_wallets`——**这是 KANet 自己的托管钱包，私钥/助记词在我们库里**。
  2. `kaspatest:qqqtestonboard...`（2026-07-28），非法格式的测试地址，M0c1 pilot 遗留的测试行，非真实注册。
- **持久化 nonce / 防重放存储**：全仓不存在（连更完整的 M0c-1 grant 机制自己的 replay 表都还没建，本稿不能假装这件事已有基础设施）。
- **可复用的签名/验签模式**：`kasia-console/src/lib/coord-status-sign.mjs`——blake2b(canonicalize) + `kaspa-wasm` `signMessage`/`verifyMessage`，已在生产用于 D-010 coord-status 频道信任根，经过对抗性伪造测试。本稿复用同一模式，不是从零选加密方案。

---

## §2 七要素——挑战载荷的字段绑定

Owner 要求的七要素与签的字节一一对应（自描述、不透明字符串禁用，理由见 §1.7-26 v0.2 §4.2 已定案）：

```
KANet broker registration challenge
protocol_version: 1
network: testnet-12
broker_address: kaspatest:xxxx
role: broker
descriptor: <注册描述符或端点摘要的 hash，见下>
nonce: <hex>
expires: <ISO8601>
```

- **protocol_version**：本挑战格式本身的版本号，与 Kaspa 网络协议版本无关——**格式一旦改动，旧签名必须验不过**，防跨版本重放。
- **network**：`testnet-12` 等，域分离，防跨部署重放（07-26 v0.2 已定案：这行不可省）。
- **role**：今天恒为 `broker`（Track B 未来若开放其他角色类型，同一挑战格式复用，role 区分用途）。
- **descriptor**：本次注册请求的规范化摘要，**定义见 §2-bis（v0.4 冻结，不再是"随最终形态定"）**。
- **nonce / expires**：挑战服务端签发，见 §4。

**签名对象只有 `broker_address` 的私钥控制权，不推导出更多**——若某天 descriptor 或 role 字段被误用来论证"这个人被授权做 X"，那已经越出本设计的证明范围，必须另行设计。

---

## §2-bis Canonical mutation digest（Codex 2026-08-08 二审 MUST-FIX，v0.4 新增）

**问题**：v0.1-v0.3 把 descriptor 的输入集合留白（"具体字段随 Track B 该注册端点最终形态定"）。留白意味着**签名没有机械绑定"申请人实际在授权哪一次写入"**——同一把私钥签出的合法签名，理论上可以被拿去打一次跟原意图不同的写入（换 bot_token、换 bot_username、甚至从"register"语义偷换成"update"语义），只要 `broker_address/role/network` 三项凑巧一致。这正是 Broker (b) 设计（`docs/2026-08-04-broker-variant-action-caller-auth-design.md` 验收条⑧）已经踩过、并已用"把 action 绑进签名载荷"堵死的同一类洞——(a) 这里之前留白，是同一类洞留了个缺口没堵。

**冻结定义**：`descriptor_hash = blake2b(canonicalize(descriptor_payload))`，`descriptor_payload` 是下面这个封闭字段集合（不多不少，新增字段需要新一轮设计变更，不是落码时随手加）：

```
operation: "register" | "update_bot_token"
broker_address: <与七要素里的 broker_address 相同>
network: <与七要素里的 network 相同>
bot_username: <本次提交的 bot_username；未提供 token 时为 null>
bot_token_hash: <blake2b(bot_token)；未提供 token 时为 null——原文 token 不入签名载荷，只入落库的加密列>
```

- **`operation` 由服务端决定，不由客户端自报**：与 `kasia-console/src/api/kanet-broker.js:73` 现有分支逻辑同源——服务端在**签发挑战时**先查 `broker_address` 是否已有行，查到就是 `update_bot_token`，没查到就是 `register`，写入 nonce 记录随 descriptor 一起持久化（§4）。**验证提交时**，服务端重新查一次同一地址的当前行是否存在；若与挑战签发时记的 `operation` 不一致（例如挑战签发后、提交前，另一次请求先把行建出来了），判定挑战已过期失效，拒绝并提示"状态已变化，请重新发起挑战"——不静默按旧 operation 语义写入，也不改写客户端签名覆盖的语义。
- **为什么不含 `bot_token` 原文**：nonce 记录与 `last_proof_payload`（§5 拱心石）都要落库保存，token 原文落进这类审计字段会造成明文密钥外泄面；哈希已经足够证明"签的是这个 token"，原文只走既有的 `encrypt()` 加密列（不变）。
- **为什么不含 §1 现存两条历史行涉及的字段**：现存行（`@younio2024` / 测试行）都在 `provenance` 分档下按 §6 单独处置，不经过挑战流程，不受本节约束。
- **对 §7"每次写入都要签名"的收紧**：之前"每次写入都要签名"只保证**有**签名，没保证签名**覆盖这次写的是什么**。加上本节后，"未带新签名走 UPDATE 分支"和"带一个为别的写入签的合法签名走 UPDATE 分支"是同一类攻击的两种形式，现在都会被 descriptor 不匹配挡住——后者是 v0.1-v0.3 遗漏的部分。

---

## §3 P2SH 硬闸（复用 07-26 v0.2 §4.3 实测结论，不是新发现）

`kaspa.XOnlyPublicKey.fromAddress()` 对 P2SH 地址**不抛错**——它把脚本哈希当公钥返回，验签会静默失败，报错指向"签名验证失败"而不是"地址类型不支持"（NWT 2026-07-26 实测，带对照臂）。

**硬要求**：入口必须显式检查 `address.version === 'PubKey'`，不满足直接拒绝并说明"地址类型不受支持"，不依赖 `fromAddress` 抛错。P2PK 地址的控制权原生等价于持有私钥（签名是自然证明）；P2SH 的控制权是"能满足脚本"，签名对它不构成同类证明——**本设计只做 P2PK，P2SH 显式拒绝，不是遗漏**。

---

## §4 挑战/nonce 机制 + 持久化（新基建，本仓目前没有）

- **挑战签发**：服务端生成 nonce，绑定 `(broker_address, role, descriptor_hash, expires)`，写入新表（见 §7），TTL 建议 5 分钟（留出人工签名的时间，07-26 v0.2 的量级判断沿用）。
- 🔴 **提交必须带 `nonce`（Codex 2026-08-08 二审 MUST-FIX，v0.4 改，原写"只交 `broker_address + signature`"）**：改为 `broker_address + nonce + signature`。**问题**：同一个 `broker_address` 完全可能同时存在多条未消费 nonce（例如挑战过期前重新请求了一次、或并发发起了两次挑战）——若提交只带 `broker_address + signature`，服务端没有唯一寻址依据去确定这个签名对应哪一条 nonce 记录，只能枚举该地址名下所有未消费/未过期 nonce 逐条重放各自的挑战字节去试验签（且要试成功后才知道该对哪一条做原子 UPDATE 消费），这既低效也让"到底哪条 nonce 被消费了"这件事变得不确定。**修法**：客户端在收到挑战响应时已经拿到了 `nonce`，提交时原样带回；服务端直接 `SELECT * FROM broker_registration_nonces WHERE nonce = ?` 做唯一定位（`nonce` 本身要求足够随机/不可猜测，碰撞概率可忽略——这是挑战签发时的既有要求，不是本次新增），再核对该行的 `broker_address` 是否与提交的一致（防御性二次校验，非主寻址键），用该行落库的 `role/descriptor_hash/expires_at` 原样重建七要素字节去验签——不重新猜测/拼凑客户端"应该"签了什么。
- **验证成功后**：nonce 记录标记已消费（不删除——删除会让"这个 nonce 到底存在过没有"变得不可审计；改为记消费时间戳）。
- 🔴 **nonce 消费必须是单条原子 UPDATE（NWT 2026-08-08 红队 MUST-FIX）**：`UPDATE broker_registration_nonces SET consumed_at=? WHERE nonce=? AND consumed_at IS NULL`，按受影响行数判断成败（1 行=本次消费有效，0 行=已被消费过或不存在）——**不是"先 SELECT 查未消费、再 UPDATE 标记"这种分两步的写法**：分两步在两个并发请求同时命中同一个未消费 nonce 时都会在各自的 SELECT 读到"未消费"、都通过、都写入，导致同一次控钥证明被消费两次。`app-envelope.mjs` 的 M0c-3 接口注释里已经用了"atomic reserve"这个词描述未来该做的形态，本设计的新表从一开始就该按这个约束写，不留给落码时才发现。上面的定位 `SELECT`（读 `role/descriptor_hash/expires_at` 重建字节验签）与这里的消费 `UPDATE` 都以 `nonce` 为键，是同一条记录，不是两次独立查找。
- **过期清理**：TTL 到期的未消费 nonce 定期清理，避免表无限增长（具体清理策略是落码细节，非本稿必答项）。
- **🔴 为什么这是本设计里唯一真正的新基建**：`app-envelope.mjs`（M0c-1）自己的注释明写"durable nonce/replay 校验不在本模块射程，禁内存 nonce 占位"——**全仓没有任何现成的持久化防重放表可以直接借用**，这里要新建一张。这与"复用而非重造"的原则不矛盾：复用的是签名/验签模式，**新建的是持久化存储这一层**，两者是不同的东西。

---

## §5 拱心石原则：存档 + 公布互锁（复用 07-26 v0.2 §4.4，逐字成立）

- **落库必须存签名 + 被签字节原文**（不是重新拼一遍再验——字段顺序/空白/时区格式任一处漂移会导致"签名正确而验签失败"这种指错方向的错误）。
- **必须公布字节格式规范**（本稿 §2 的格式即公开规范的草案），使任何第三方能离线自行复验——这与"存档"是互锁的一句话，不能拆成两条各自决定要不要做（07-26 v0.2 已强调这点，本稿原样继承）。
- **`expires` 语义必须写死**：它只约束"这个签名什么时候可以被提交"，不约束这份控制权证明本身的有效期。存档是永久的，字段是短期的，复核者需要知道按哪个读——这条本稿原样继承，不重新论证。

---

## §6 Provenance 两档（复用 07-26 v0.2 §4.5，按新措辞调整）

同一个验签通过的结果，在托管地址和非托管地址上证明的东西不同：

| 标签 | 含义 |
|---|---|
| `produced-by-us` | 这份签名是我们自己的 relay/托管签出来的——我们确知，但**这不是对第三方的控制权证据**（我们向自己证明我们控制自己的钥匙，循环） |
| `provenance-unknown` | 外部提交上来的，来源我们不知道——**这才是本设计真正要收集的那种证明** |

**按 Owner 08-07 收窄后的措辞**：`provenance-unknown` 一档验签通过，只能写"该地址在注册当时被证明由某方控制其私钥"，**不写"已验证身份"、不写"运营方独立"、不写"持续持有"**（下一次要用这把钥匙时必须重新签，见 §7）。`produced-by-us` 一档**不进入"已证明控制权"这个状态**，标记为 KANet 自行背书，不与外部证明共享同一字段语义（07-26 v0.2 §4.5 的责任归属论证原样成立）。

**现存 2 行的处置**：
- `@younio2024` 那行（真实托管钱包）：私钥在我们库里，`produced-by-us`，无法也不需要走本设计的挑战流程去"证明"——它本来就不是本设计要解决的对象。
- 测试行（`qqqtestonboard...`）：格式不合法（非真实 Kaspa 地址），落码时的地址格式校验会自然拒绝，不需要特殊处理，落码验收时用它做一个"格式非法应拒绝"的现成负向样本。

---

## §6-bis 三步写入必须在一个事务里（Codex 2026-08-08 红队 MUST-FIX，比 §4 的原子 UPDATE 更深一层）

§4 已要求 nonce 消费本身是原子 UPDATE（防并发重放），但一次成功注册实际要做**三件事**：①标记 nonce 已消费 ②写/更新 `broker_onboarding` 行 ③落 `last_proof_*` 归档字段。**这三步若分开提交，中间任一步失败都会留下 split state**——最典型的坏结果：nonce 已消费（第①步提交成功），但 `broker_onboarding` 写入失败（第②步报错），此时这个地址的这次控钥证明**被永久烧掉**（nonce 不可能重发），而注册本身**没有生效**——申请人无法重试（同一 nonce 已废），只能整个挑战流程重来。

**硬要求：①②③必须包在同一个 SQLite 事务里，全成功才提交，任一步失败整体回滚**（`BEGIN` → 三步 → `COMMIT`，出错走 `ROLLBACK`，不允许部分提交）。

## §7 每次写入都要签名，不只是 INSERT（复用 07-26 v0.2 §4.6-1，实錯的原因写清）

**只守 upsert 主键不够**：今天的路由允许"带签名建行（首次注册）"之后"不带签名走 UPDATE 分支换 bot_token"——即使给 INSERT 加了签名校验，UPDATE 仍是一条没有闸的旁路，行为等价于接管。**⇒ 硬要求：对 `broker_onboarding` 的任何一次写入（建 / 改 bot_token / 改 descriptor）都必须带一个当次有效的签名，不因为"已经有一行"就放行后续修改。**

---

## §8 错误码分离（复用 07-26 v0.2 §4.6-4）

`401`（验签失败）/ `410`（nonce 过期或未知）/ `400`（地址格式或 P2SH 不支持）三码分离，不合成一个通用 400——合并会让集成者去排查不存在的 bug。

---

## §9 DB 迁移（新增字段草案，落码时另出精确 migrate.js diff）

`broker_onboarding` 需新增（草案，非最终 DDL）：
- `provenance TEXT`（`produced-by-us` | `provenance-unknown`）
- `last_proof_signature TEXT`（最近一次成功验证的签名，原文保存）
- `last_proof_payload TEXT`（对应的被签字节原文，逐字保存，不重新拼）
- `last_proof_at TEXT`（该签名验证通过的时间戳）

新增独立表 `broker_registration_nonces`（草案）：
- `id / broker_address / operation / role / descriptor_hash / nonce / expires_at / consumed_at / created_at`
- 🔴 `nonce` 列必须 `UNIQUE`（v0.4 新增要求，配合 §4 的"提交按 nonce 唯一寻址"——没有 UNIQUE 约束，§4 的 `SELECT ... WHERE nonce = ?` 理论上能返回多行，寻址就又不唯一了）。
- `operation` 列对应 §2-bis：签发挑战时按当前是否已存在该 `broker_address` 的行写死，验证提交时重新查一次现状核对一致性。

---

## §10 验收标准（落码后必须逐条能测，非本稿必答但先列出方向）
1. 未签名注册请求 → 拒绝（401）。
2. 签名对应错误地址 → 拒绝（401）。
3. 签名过期 → 拒绝（410）。
4a. nonce **顺序**重放（同一 nonce 先后提交两次）→ 第二次拒绝（410）。
4b. nonce **并发**重放（NWT 2026-08-08 红队 MUST-FIX 补）：两个请求同时携带同一未消费 nonce 提交 → 有且只有一个成功、另一个拒绝（410）——这一条直接对应§4的原子 UPDATE 约束，测的是实现选择本身，不是顺序重放能覆盖的场景。
5. P2SH 地址 → 拒绝（400，且报文明确说明"地址类型不支持"，不是通用签名失败）。
6. 跨网络字段不匹配（signed 时写的 network 与请求网络不一致）→ 拒绝。
7. 合法 P2PK 地址 + 正确签名 + 未过期 nonce → 通过，写入 `provenance-unknown`，`last_proof_*` 字段落库。
8. 二次写入（换 bot_token）未带新签名 → 拒绝，UPDATE 路径与 INSERT 同等把关。
9. 🔴 **descriptor 跨写入重放（Codex 2026-08-08 二审 MUST-FIX 补，v0.4 新增）**：用一次合法签名（对 `operation=register`、`bot_token_hash=H1` 签的）去打同一地址后续的 `update_bot_token` 提交（无论是否换了 token）→ 必须因 descriptor 不匹配被拒（401，不是 410，因为 nonce 本身可能仍在有效期内、问题在于载荷不匹配而非 nonce 状态）。同理反过来：拿一次 `update_bot_token` 的合法签名去打 `register`（地址当时已存在行，但换个时间点该行被删/未建）→ 同样必须拒绝。
10. 🔴 **nonce 唯一寻址（Codex 2026-08-08 二审 MUST-FIX 补，v0.4 新增）**：同一 `broker_address` 名下同时存在两条未消费、未过期的 nonce（例如先后请求了两次挑战）→ 提交必须携带其中一条 `nonce` 才能定位到对应记录并验证；缺失 `nonce` 字段 → 拒绝（400，"nonce 必填"，不做地址下枚举猜测）；提交了一个不存在/已消费/已过期的 `nonce` → 拒绝（410）。

---

## §11 明确不做 / 留白
- **不做 P2SH 的替代证明方案**（07-26 v0.2 §6 已讨论并否决"从该地址付一笔"这条候选，理由是需要一个可靠的 sender 提取原语，今天不可靠）——留给真有 P2SH broker 出现时再做。
- **不做产品层的"浏览器钱包怎么签"这个 UX 问题**——Track B 的 broker 更可能是脚本化的 fork 部署者而非浏览器用户，若这个假设错了需要另外设计签名前端，非本稿范围。
- **不做公开端点暴露/部署**——本设计与后续落码只在本地/隔离环境验证，Owner 硬边界已钉死。
- ~~不做 descriptor 字段的最终摘要算法定义~~ **v0.4 已冻结，见 §2-bis**（Codex 二审 MUST-FIX 关闭）。
- **不做"挑战签发时 operation 与提交时 operation 不一致"以外的状态竞态处理**——§2-bis 已定"不一致就拒绝、要求重新发起挑战"，更精细的用户体验（例如自动重新挑战）留给落码/前端集成决定，非本稿必答项。

---

## §12 下一步
1. 频道过审（NWT/Bettor）。
2. 过审后按"小步快跑"拆分落码：① DB 迁移 ② 签名/验签 helper（复用 coord-status-sign.mjs 模式）③ 路由改造 ④ 每步各自 lint + 报备 + 审核 + 本地验证，不一次性提交整个改动。
3. 全程不接外部流量、不部署到可达网络路径。
