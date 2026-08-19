# §10 跨节点 pubkey 身份 — 设计本体（报备层 · 零生产改动）

> **Status**: CURRENT · Bettor 2026-08-19 主笔 · **supersedes** `2026-08-18-…-relay-id-cryptographic-anchoring-design.md` 的 §4（那份 §4 是 relay-attestation 路，已被 §3 自己的否定结果 + Codex 3017ff3e 判死；本份把被采纳的 pubkey 方向写成设计本体）。
> **权分（诚实标注）**: 本设计 Bettor 主笔。原指派"J2 主设计"——但 J2/NWT 经 2026-08-19 实核**无独立在场痕迹**（见 memory `reference-j2-nwt-no-independent-footprint-bettor-generates-their-halves`，已上报 Owner）。故**真实独立复核 = Codex（外部，bridge）+ J1（独立节点，git）**，非本机自演的"J2 设计 × NWT 红队"。
> **依据**: pivot brief `2026-08-19-bettor-s10-pubkey-identity-pivot-brief.md`（Codex 08d92aba + fa46896a 两轮 ACCEPTED）+ 逐字核过的仓内先例 `trade-protocol-filter.js`。

## §0 范围（先写不做什么）

- **不做**签发口（§6-1 分支，已单独 scope，北极星前不部署）。
- **不做**旧 `relay_id` 记录 → pubkey 身份的迁移/轮换（Codex 点6：控钥≠连续性，硬性 out-of-scope）。
- **不改**任何生产码。本份是设计，落地是后续独立报备。
- **不授权** Owner 实例对外开放（§0 墙不动）；这是 Track B 协议能力，部署随北极星。

## §1 定的锚（两轮 Codex + J1 供数，已冻结，不再回炉）

1. **跨节点身份 = relay x-only 公钥**；`relay_id` 降为**本地便利键**（跨节点不可比：`randomUUID()` 本地生成，见现稿 §3.2 实核 `relay-nodes.js:23`）。
2. **canonical 形 = 恰 32 字节 x-only pubkey，渲染为小写 64-hex**，用**验签同一个 crypto 库**（kaspa-wasm）校验合法性。address 是同一把钥的网络/呈现编码，**可派生/缓存作路由/UI，但绝不得成为第二身份串**。
3. **签的是域分隔 canonical 声明**，绑 {域 tag, version, network, canonical pubkey, operation, replay/epoch}；**绝不签字段序会跨实现漂移的 ad-hoc JSON**，除非该序列化本身冻结。
4. **自签只证控当前钥**，不证承继任何旧 relay_id / 旧钥。

## §2 已核仓内先例（grounding，逐字核过 2026-08-19，非设计假设）

| 环节 | 先例位置 | 状态 |
|---|---|---|
| pubkey 随 payload 传、消费侧直验**不查 relay_nodes** | `trade-protocol-filter.js:765` `kaspa.verifyMessage({..., publicKey: String(msg.maker_relay_pk).toLowerCase()})` | ✅ **形状可照抄** |
| uniqueness 按 pubkey 建键 | `:825` `sentinelRelayId = ` cross-node:`${msg.maker_relay_pk}` | ✅ **key-by-pubkey 已有** |
| pubkey 小写归一 | `:765` `.toLowerCase()` | ✅ 一致（但未校验 32B/hex 形，§3 L1 补） |
| 被签消息 = **原始 `JSON.stringify(payload)`，无域标签** | `:762` `messageToVerify = JSON.stringify(unsignedCopy)` | 🔴 **无域分隔** = 正是 Codex 点5 警告的 ad-hoc JSON |
| 钱路"不查该列、活派生" | `pool.js:4054-4057` `deriveXOnlyPubkey(address)`（J1 (535) 供数，Bettor 核实） | ✅ 支持"库列仅缓存" |

🔴 **关键 DELTA**：先例证明了「pubkey-in-payload、直验、按 pubkey 建键」的**形状**（L765/825），但**它没有域分隔**（L762 签 ad-hoc JSON）。⇒ §10 身份的承重新工作 = **在这个已验形状上补 Codex 要求的域分隔签名声明**。照抄形状、补齐 L2。

## §3 设计：Codex 五环验收链，逐环具体

> Codex 给的链：`canonical relay pubkey → canonical 域分隔签名声明 → 远端从 payload 直验 → uniqueness/replay 按 canonical pubkey 建键 → 可选本地 relay_id 映射`。逐环写实现约束。

### L1 · canonical relay pubkey（身份主键）
- 类型：`string`，**恰 32 字节 x-only，小写 64-hex**。
- **入口校验**（拒非规范形，贵活之前）：`/^[0-9a-f]{64}$/` **且** 能被 kaspa-wasm 解析为合法 x-only pubkey；两者任一不过 → 拒（fail-closed）。
- 🔴 **不接受 address 作身份主键**：若提交带 address，只作路由缓存,且必须能从该 pubkey 派生出同一 address 才收（一致性校验），否则拒。**身份命名空间只有 pubkey 一种串**。
- 🔴 **L1 校验必须内嵌在唯一性建键/查找的【同一函数·单一入口】**（J1 (541) 实测承重①）：实测 **kaspa-wasm 接受大写 hex pubkey 且 `verifyMessage` 返 `true`** ⇒ 同一把钥的大写/小写两串**在原语层就是合法别名**，小写归一是**唯一**防线。若 L1 只放 API 边界、而唯一性键在别处不归一，任何绕过边界的内部调用路径直接复活 P6 双串别名。⇒ 归一+校验与建键**同址**（与 `pool.js` `assertBrokerP2PK` 的 chokepoint-MAINTAIN 同族：护栏必须在决策点，不在门口）。

### L2 · canonical 域分隔签名声明（本设计的承重新增，补 §2 的 DELTA）
被签字节（**冻结此结构**，实现不得改序/改分隔）：
```
KANET-U1-IDENTITY-v1|<network>|<sha256_hex(canonical)>
canonical = JSON.stringify({
  domain: "KANET-U1-IDENTITY",   // 冗余进 hash，防 hash 与前缀脱钩
  version: 1,
  network: "<testnet-12|mainnet>",
  pubkey:  "<64-hex x-only>",     // = L1 canonical，声明主体自绑
  operation: "register",          // 未来 rotate/revoke 用不同值 → 不同签名域
  epoch:   "<challenge 或 nonce>" // replay 材料，见 L4
})
```
- **前缀 + network 明文在 hash 之外也在 hash 之内**：外层给人/日志看，内层（domain/network 字段）保证「即使有人剥掉前缀直验 hash」也绑得住。
- 🔴 **域分隔的理由（实核，J1 (541) 全仓枚举更正）**：`ecdsa_sign` 是任意串盲签，同钥同时服务别的协议；现有 **7 个 `ecdsa_sign` 调用点（约 5 族）**——JSON 签：`oracle-pool.js:56/:85`、`pool.js:294`、`pool.js:4010`、`oracle-pool-renewal-cron.mjs:104`（都以 `{` 开头）；hex-hash 签：`coord-status.js:29`、`pool-market-settler.js:2988`、`prediction-params-cache.js:152`（消息空间纯 hex，不含 `|`/大写字母）。**今天无一能产出 `KANET-U1-IDENTITY-v1|` 前缀字节** ⇒ 结构不相撞；**但这只是今天**（它们彼此不撞也只是"字段集恰好不同"）→ §5 P2 记为承重前提，且"全生产者统一域标签"根治项的真实规模按 **7 点**算。
- 🔴 **operation 字段是为 out-of-scope 的 rotate/revoke 预留的域隔离**：今天只允许 `register`；将来加轮换用**不同 operation 值** ⇒ 老签名天然不能冒充新操作。**本设计不实现 rotate**，只把域留出来。

### L3 · 远端从 payload 直验（不查本地表）
- `kaspa.verifyMessage({ message: <L2 被签字节>, signature: payload.signature, publicKey: payload.pubkey /*已过 L1 校验*/ })`。
- **公钥来源 = payload 自带（已过 L1 校验），永不查 `relay_nodes`**（照 `:765` 先例）。
- **fail-closed**：`verifyMessage` 抛异常 / 返 false / 任一字段缺 → **拒**，禁 `try/catch → skip`（现稿 §5 P4：这是最容易被加成"取不到就跳过"的地方）。
- 🔴 **两路都必须接（J1 (541) 实测承重②）**：实测**垃圾签名下 `verifyMessage` 是 `throw`（`Invalid input length 128`），不是返 `false`** ⇒ 「异常也拒」不是保险带、是**必需**——不 `try/catch` 会把拒判变成 500，`catch` 后 skip 会把闸变装饰。照 `:765` 先例 `catch → 拒`。

### L4 · uniqueness / replay 按 canonical pubkey 建键
- **注册表主键 = canonical pubkey**（不是 relay_id）。"抢占"只对 pubkey 有意义，且**抢 pubkey X 必须签得出 X 的私钥** ⇒ 抢注 = 证明你就是 X（§1 攻击对 pubkey 主键**天然失效**，这正是 pivot 的核心收益）。
- **replay**：L2 的 `epoch` 绑一次性 challenge（复用已落的 challenge store CAS + 同事务消费，现稿 §5 P3）**或** 单调 nonce；同一 (pubkey, operation, epoch) 只能消费一次。
- 🔴 **身份权威表独立**：Codex 点7 + J1 供数② —— **不复用** `relay_nodes.ecdsa_pubkey_xonly`（它生于 v130 是 SS oracle ctor 参数、语义非身份、跨节点填充不一）。身份权威只能活在**专用的身份状态字段/表**；该列至多做 corroborating 缓存。

### L5 · 可选本地 relay_id 映射
- 收到远端身份后，本地**可**存 `pubkey → 本地 relay_id` 映射作路由便利，**但该映射永不作身份权威**：任何跨节点判断只认 pubkey。
- 本地无此映射 = 正常（照 `:822-824` 先例：callers 对未知 relay_id fall back 到 protocol 字段）。

## §4 数据面（落地时用，本份不改表）

- **不新增对既有六字段白名单的语义改动**（U1 注册现有 relayId/rootXpub/identityIndex/identityPubkeyXOnly/challenge/signature 不动）。
- 身份注册若落表，用**专用身份表**（主键 = canonical pubkey），**不挂** `relay_nodes.ecdsa_pubkey_xonly`。
- 服务端派生值（若有 fingerprint 类）**函数内部派生、不从参数收**（现稿 §4.2 陷阱：`buildPopPayload` 把 rootFingerprint 收作参数、不强制派生 ⇒ 下一个调用方能递提交方的值进去而无人喊 → 落地时在函数内派生）。

## §5 承重前提 → 它坏掉时会怎样（可审，非"注意事项"）

| # | 前提 | 坏掉时 | 今天成不成立 |
|---|---|---|---|
| P1 | 验签公钥 = payload 自带且过 L1 校验，**永不查 DB 列** | 退化：DB 列可被改 ⇒ 冒充 | 设计如此；实现时"DB 读比解析快"最易把它优化掉 |
| P2 | L2 被签字节域分隔，与其他 7 个 `ecdsa_sign` 生产者不相撞 | 别处的签名可搬来当身份证明 | 前缀成立于**今天**（§3 L2）；根治 = 全 7 生产者统一域标签（单独立项） |

🔵 **P2 作用域（J1 (541) 建议，防读大）**：域分隔防的是**诚实生产者互撞**（不同协议无意间签出可互认的字节）。它**不防**"同机调用方主动请求某个域的签名"——`ecdsa_sign` 是任意串盲签，同机调用方本就能请求任意域，**这在已接受的同机信任模型内**（N2 / §0：Console 能驱动本机 relay = 已知且接受）。对抗半场（外部方能否诱导本机签它想要的域）属 **send-command 收面**那条独立 track（Codex `S10-RELAY-ID-ANCHOR` 点5），不在本设计的域分隔承诺内。
| P3 | replay 材料一次性（challenge CAS + 同事务 / 单调 nonce） | 同签名可重放注册 | challenge store 已 CAS + 同事务（③ 已落）；nonce 路需另设计 |
| P4 | verifyMessage 失败/不可达 = **拒**，不降级 | 闸变装饰 | 🔴 必须写死 fail-closed |
| P5 | 身份权威**只在**专用 pubkey 表，`ecdsa_pubkey_xonly` 仅缓存 | 复用旧列 ⇒ 背 SS-oracle 语义 + 跨节点填充不一 ⇒ 误判 | Codex 点7 + J1② 均确认；设计如此 |
| P6 | canonical 只有 pubkey 一种串（address 仅派生缓存） | 同钥两身份串 ⇒ 别名/绕唯一性 | 设计如此（§3 L1）；实现须校验 address↔pubkey 派生一致 |

## §6 预注册验收判据（实现时用，事后不加项 —— Codex 负测要求 + 本设计补充）

Codex 明令：**改 network/domain/version/pubkey 或以本地 relay_id 替换 ⇒ 破验证/身份查找，而非静默别名**。逐条落成必须**红**的负例：

1. **改 network**：合法签名，验证侧把 network 换一个值重建 L2 字节 ⇒ 验签**必红**。
2. **改 domain/version**：同上，改 `domain` 或 `version` ⇒ **必红**。
3. **改 pubkey**：payload.pubkey 换成另一把钥（签名不变）⇒ **必红**（L3 直验）。
4. **relay_id 冒充**：只给本地 relay_id、不给合法 pubkey 签名 ⇒ 身份查找**必拒**（不得 fall back 成"按 relay_id 认"）。
5. **抢注负例（§1 攻击对 pubkey 主键）**：拿别人的 pubkey X 作主键、但**签不出 X 的私钥** ⇒ **必拒**。🔴 正例对照：拿自己的钥 X + 签得出 ⇒ 收（证明抢注 = 自证）。
6. **域串扰**：拿一条**既有生产者格式**（`JSON.stringify({...})` 无域标签）的合法 relay 签名去当身份声明 ⇒ **必拒**（L2 前缀不匹配）。
7. **address 别名**：同一把钥的 address 与 pubkey 分别提交 ⇒ 只认 pubkey 一个身份，**不得**产生两条身份记录。
8. **非规范 pubkey**：63-hex / 大写 / 非法曲线点 ⇒ L1 **必拒**。

🔴 **负测纪律（本仓已栽过）**: 抢注负例**在本机跑会绿得没有意义**（同库同 IPC 域，现稿 §3）⇒ 负例必须用「另一把钥签 / 模拟外部方」构造，并在用例里写清它模拟的是什么。参 memory `reference-negative-test-depth-confound-refuses-for-wrong-reason`。

## §7 明列的空白（不假装覆盖）

- **rotate / revoke / 旧 relay_id 迁移**：out-of-scope（§0 + Codex 点6）。L2 的 operation 域已为它留隔离，但机制未设计。
- **全生产者统一域标签**：P2 的根治，超出本设计，单独立项。
- **nonce 型 replay**（非 challenge 路）：P3 只落了 challenge 路；nonce 路需另设计单调性来源。
- **落地位置**：本份只定机制约束，未定具体挂哪个 handler / 表 schema —— 落地报备时补，走「报备→审核→批准→测试」。

## §8 交接（真实 roster）

- **Codex（bridge）**：红队本设计 —— 重点撞 L2 域分隔是否真绑死、L4 唯一性是否真按 pubkey、P1/P4 fail-closed 有没有留降级缝、§6 负测是否覆盖"静默别名"。
- **J1（独立节点，git）**：二审 + 若能，在其独立节点上验 §6 的跨节点负例（本机跑抢注负例无意义，J1 是真跨节点）。
- **Bettor**：收两方意见后修订 + 裁。**落地实现另起报备**，不在本设计里动生产码。
