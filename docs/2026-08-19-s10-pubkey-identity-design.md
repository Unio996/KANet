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
- 🔴🔴 **MUST-FIX C（Codex MSG-246·§4 六字段矛盾）——身份钥必须是【独立显式字段 `relayPubkeyXOnly`】，不从 A2 提交推导**：实核既有 U1 六字段里的 `identityPubkeyXOnly` 是 **A2 身份钥**（由 `rootXpub + identityIndex` 派生），**不是 relay 全局签名身份**；现注册用 `relayId` 做本地 custody 派生。二者**没有已建立的 `A2 身份钥 == relay 全局身份钥` 不变式**。⇒ **§10 是独立协议信封**，带显式 canonical 字段 `relayPubkeyXOnly`（L2/L3/L4 的 `pubkey` 全指它）；**永不**从 A2 提交/`identityPubkeyXOnly` 推导 §10 身份（不同信封、不同签名域）。
- 🟢 **`relayPubkeyXOnly` 的语义【Bettor 裁 Option A·Codex MSG-249】= 钥角色是【语境性】不是【内在】**：`relayPubkeyXOnly` = **那把"通过产出合法 S10-域自签名、自愿充当 S10 relay 身份"的钥**。⇒ payload 自足验证方**没有任何可观测比特**能分辨一把 x-only 钥曾否用作 A2 钥/别的角色（wire 字段名 `relayPubkeyXOnly` **不构成**密码学钥角色 provenance）。同一把钥**允许**既是 A2 钥又当 S10 relay 钥——**只要持有者有意签了 S10 声明**。⇒ 真正可执行的护栏**不是**"拒某类钥"，而是**跨域重放必拒**（A2-域签名/材料不能重放成 S10，反之亦然）——见 §6-12（改写后）+ J1 (550) 实测消息空间双向不相交。**选 Option A 理由**：无任何政策要求 A2 钥≠relay 钥；Option B（钥角色内在、须独立角色绑定权威）是大改且会破 payload 自足模型（L3/P4），无用户面理由。

### L2 · canonical 域分隔签名声明（本设计的承重新增，补 §2 的 DELTA）

字段集（**语义**，非序列化）：`{ domain, version, network, relayPubkeyXOnly, operation, epoch }`。
被签字节外形：`KANET-U1-IDENTITY-v1|<network>|<hex(hash(canonical_bytes))>`。

🔴🔴 **MUST-FIX B —— canonical 字节【已在设计层冻结】（Codex MSG-247 裁：(a)/(b) 选择本身是协议设计、不得留给实现）**：

选 **(b) 长度前缀串接**（消除 JSON 转义/字段序/空白歧义，跨语言最省心）。**v1 canonical 字节 = 按固定顺序对 6 个字段各 `u32be(len) ‖ utf8(value)` 串接**：

| 序 | 字段 | 值域（全 ASCII，UTF-8 编码无歧义） |
|---|---|---|
| 1 | `domain` | 定值 `"KANET-U1-IDENTITY"` |
| 2 | `version` | 定值 `"1"`（ASCII 十进制、无前导零） |
| 3 | `network` | 闭枚举 `"testnet-12"` \| `"mainnet"`（**验证时取本地权威值**，见 MUST-FIX A） |
| 4 | `relayPubkeyXOnly` | 恰 64 位**小写** hex |
| 5 | `operation` | 闭枚举，v1 仅 `"register"`（见下 operation 白名单） |
| 6 | `epoch` | 一次性 challenge 串（见下 epoch 冻结） |

- `u32be(len)` = 该字段 UTF-8 字节长度的 4 字节大端。**被签字节（传给 `signMessage`/`verifyMessage` 的 message）** = `<prefix> ‖ <network> ‖ "|" ‖ lowerhex(sha256(canonical_bytes))`。
- 🔴 **前缀【派生】不是字面量（J1 (547) 撞到的微歧义，钉死）**：`prefix = domain ‖ "-v" ‖ version ‖ "|"`。v1 即 `"KANET-U1-IDENTITY-v1|"`。⇒ **bump v2 时前缀随 domain/version 自动移**（`…-v2|`），前缀与被 hash 的 canonical 字段**永远同源**，不会一个变一个不变。
- ✅ **golden vectors 已产 + 独立第二实现逐字节对拍 TRUE**（J1 (547)，`artifacts/2026-08-19-s10-golden-vectors-v1.json`，spec_commit 22aeb959，3 向量 testnet/mainnet/epoch，test-only priv=1 钥）= Codex MSG-247 要的"golden vectors derivable, shared by every implementation"那份对拍锚**已落地并经第二实现验证**。
- 🔴 **对拍锚 = `canonical_bytes` / `canonical_sha256` / `signed_message` 三者逐字节；`signature` 不是锚**：J1 实测 kaspa-wasm `signMessage` **非确定**（BIP340 aux-rand，同钥同消息两签不同）⇒ 向量里的 `example_signature` 只可 `verifyMessage=true`、**不可复现**。别把"签名对不上"误判成实现不符。
- 🔵 变动 canonical 编码/前缀 = 变协议 ⇒ **必须 bump `domain`/`version`**（老签名天然落在旧域，不跨版本冒充；前缀派生保证它一起移）。

🟢 **epoch 语义【已冻结】（Codex MSG-247：challenge vs nonce 是不同重放协议、进 canonical 字节、须设计层定）**：**v1 = challenge-based**，`epoch` = 已评审的**持久 challenge**（CAS + 同事务消费，③ 已落，现稿 §5 P3）。**nonce 型留给未来版本**（要用则 bump version → 不同签名域 + 另设计单调性/持久化权威，本份不做）。

🔴🔴 **MUST-FIX A（Codex MSG-246）——本地 network 是权威，不是 payload 的 network**：现负测 §6-1 是"签后改 network"（正确地验签失败）；但更危险的是——签名方产一条 `network="testnet-12"` 的**完全合法**声明，原样送到 mainnet 验证方，验证方**用 payload 自带的 network** 重建消息 ⇒ **验签成功**、跨网重放成立。⇒ **要求**：验证方构造/验证消息用的 network 必须来自**唯一权威的本地配置**；验签前**独立校验 `payload.network === 本地配置 network`，不等即 fail-closed 拒**。若外层明文 network 与 canonical.network 冗余保留，**两者必须派生自同一个权威值，绝不接受两个调用方给的 network**。J1 (543) 实测确认：payload-network 重建**验签=TRUE** ⇒ 本条 load-bearing。（负测见 §6-9。）

🔴 **operation 硬白名单（Codex MSG-246 点6，强化）**：预留 `operation` 域**只在"今天的验证方硬性只允许 `operation === "register"`"时**才是隔离。⇒ **今天**：`register` 收；`rotate`/`revoke`/任何未知值 —— **即使签名完全合法也拒**。否则未知 operation 被当 register 语义处理，预留域就从**隔离边界**退化成**别名**。J1 (543) 实测：签名的 `rotate` 声明**验签=TRUE** ⇒ 不硬白名单就漏。（负测见 §6-10。）

- **前缀 + network 明文在 hash 之外也在 hash 之内**：外层给人/日志看，内层字段保证剥前缀直验也绑得住；但（MUST-FIX A）**两处 network 必须同源**，`outer != inner` 结构上不可能或 fail-closed。
- 🔵 **域分隔的强度（实核 + Codex 措辞收敛）**：`ecdsa_sign` 任意串盲签；现有 **7 个调用点（约 5 族）**——JSON 签 `oracle-pool.js:56/:85`、`pool.js:294`、`pool.js:4010`、`oracle-pool-renewal-cron.mjs:104`（以 `{` 开头）；hex-hash 签 `coord-status.js:29`、`pool-market-settler.js:2988`、`prediction-params-cache.js:152`（纯 hex，无 `|`/大写）。今天无一产出 `KANET-U1-IDENTITY-v1|` 前缀。🔴 **正确措辞（不称"数学 collision-proof"）**：**对已枚举的当前消息空间，跨协议重放被结构性排除——modulo 密码学 hash/签名假设 + 未来生产者保持命名空间纪律**。→ §5 P2 承重前提；根治规模按 7 点。

### L3 · 远端从 payload 直验（不查本地表、不联系 relay）
- `kaspa.verifyMessage({ message: <L2 被签字节>, signature: payload.signature, publicKey: payload.relayPubkeyXOnly /*已过 L1 校验*/ })`。
- **公钥来源 = payload 自带（已过 L1 校验），永不查 `relay_nodes`**（照 `:765` 先例）。
- 🔴🔴 **P4 概念更正（Codex MSG-246 点3·我从 attestation 时代错误继承）——远端身份验证【不需 relay 可达】**：pubkey 模型下验证是**纯密码学、payload 自足**；**relay 不可达 / 本地无 relay 映射 = 与身份验证无关**。一个合法远端 payload 在**本地完全没有该 relay_id 映射**时也必须可验。⇒ **若实现为验 §10 身份去联系 `relay_nodes`/relay IPC，那本身就是 L3 违规。** 区分两种失败：
  - **本地 crypto-verifier 失败**（`verifyMessage` throw / 返 false / 库不可用 / 字段缺）→ **拒 / fail-closed**；
  - **relay 不可达 / 无本地映射** → **与身份验证无关**（路由是验证之后的 L5 事，见 L5）。
  - ⇒ **不得**把"relay 不可达 ⇒ 拒"写成 §10 身份规则；正确规则 = **远端验证不要求 relay 可达；crypto-verifier 失败才拒**。
- 🔴 **crypto 失败两路都必须接（J1 (541) 实测承重②）**：实测**垃圾签名下 `verifyMessage` 是 `throw`（`Invalid input length 128`），不是返 `false`** ⇒ 「异常也拒」不是保险带、是**必需**——不 `try/catch` 会把拒判变成 500，`catch` 后 skip 会把闸变装饰。照 `:765` 先例 `catch → 拒`。

### L4 · uniqueness / replay 按 canonical relayPubkeyXOnly 建键
- **注册表主键 = canonical `relayPubkeyXOnly`**（不是 relay_id）。"抢占"只对 pubkey 有意义，且**抢 pubkey X 必须签得出 X 的私钥** ⇒ 抢注 = 证明你就是 X（§1 攻击对 pubkey 主键**天然失效**，这正是 pivot 的核心收益）。
- **operation 硬白名单**（L2）：建键/查找前先拒非 `register` 的 operation（即使签名合法）。
- **replay（v1 = 仅 challenge，Codex MSG-248 一致性修正）**：L2 的 `epoch` 绑**唯一**一种——**持久一次性 challenge**（CAS + 在同一个带权威的事务里消费，③ 已落）；同一 (relayPubkeyXOnly, operation, epoch) 只能消费一次。**v1 不含单调 nonce 路**——nonce 是**未来版本 only / 对 v1 非符合**（见 §7）。
- 🔴 **身份权威表独立 + 禁 legacy fallback（Codex MSG-246 点2）**：**不复用** `relay_nodes.ecdsa_pubkey_xonly`（生于 v130 是 SS oracle ctor 参数、语义非身份、跨节点填充不一）**也不复用 `relay_id`** 作查找回退。身份权威只能活在**专用身份表**（主键 = relayPubkeyXOnly）；旧列/relay_id 至多 corroborating 缓存。🔴 **中毒态负测（§6-11）**：构造一条合法本地 `relay_id` 行 + 填充的 legacy `ecdsa_pubkey_xonly`（让"回退"看着诱人）但**缺/废掉** canonical pubkey 证明 ⇒ 查找/注册**仍必须拒**；任何"按 relay_id 或 legacy 列回退"的改动必须被杀。

### L5 · 可选本地 relay_id 映射
- 收到远端身份后，本地**可**存 `pubkey → 本地 relay_id` 映射作路由便利，**但该映射永不作身份权威**：任何跨节点判断只认 pubkey。
- 本地无此映射 = 正常（照 `:822-824` 先例：callers 对未知 relay_id fall back 到 protocol 字段）。

## §4 数据面（落地时用，本份不改表）

🔴🔴 **MUST-FIX C —— 信封形状【已在设计层冻结】（Codex MSG-247 裁：形状是 wire-protocol 设计、不得留给实现；Codex 推荐 = 本设计原偏好）**：**选【独立 S10 协议信封】**。既有 U1 六字段（`relayId/rootXpub/identityIndex/identityPubkeyXOnly/challenge/signature`）里 `identityPubkeyXOnly` 是 A2 钥、语义不同，**没有承载 relay 全局身份钥的字段**，且无 `A2 身份钥 == relay 全局身份钥` 不变式。

**冻结的 §10 信封（与 A2 六字段提交相互独立、互不改）**，字段：
```
{ domain, version, network, relayPubkeyXOnly, operation, epoch, signature }
```
`signature` = relay 私钥对 L2 被签字节的签名；其余 6 个即 L2 canonical 字段。**这条不动既已评审的 A2/U1 六字段语义**，也**防**兼容期把 relay 全局身份误当 A2 身份重解读。
🔴 **禁**静默复用 `identityPubkeyXOnly` 作 §10 身份（现码不成立 A2==relay-global 不变式）。选项 2（给 U1 提交加版本+新字段）**不采纳**。

- 身份注册若落表，用**专用身份表**（主键 = canonical `relayPubkeyXOnly`），**不挂** `relay_nodes.ecdsa_pubkey_xonly`、**不按 relay_id 回退**。
- 服务端派生值（若有 fingerprint 类）**函数内部派生、不从参数收**（现稿 §4.2 陷阱：`buildPopPayload` 把 rootFingerprint 收作参数、不强制派生 ⇒ 下一个调用方能递提交方的值进去而无人喊 → 落地时在函数内派生）。

## §5 承重前提 → 它坏掉时会怎样（可审，非"注意事项"）

| # | 前提 | 坏掉时 | 今天成不成立 |
|---|---|---|---|
| P1 | 验签公钥 = payload 自带且过 L1 校验，**永不查 DB 列** | 退化：DB 列可被改 ⇒ 冒充 | 设计如此；实现时"DB 读比解析快"最易把它优化掉 |
| P2 | L2 被签字节域分隔，与其他 7 个 `ecdsa_sign` 生产者不相撞 | 别处的签名可搬来当身份证明 | 前缀成立于**今天**（§3 L2）；根治 = 全 7 生产者统一域标签（单独立项） |

🔵 **P2 作用域（J1 (541) 建议，防读大）**：域分隔防的是**诚实生产者互撞**（不同协议无意间签出可互认的字节）。它**不防**"同机调用方主动请求某个域的签名"——`ecdsa_sign` 是任意串盲签，同机调用方本就能请求任意域，**这在已接受的同机信任模型内**（N2 / §0：Console 能驱动本机 relay = 已知且接受）。对抗半场（外部方能否诱导本机签它想要的域）属 **send-command 收面**那条独立 track（Codex `S10-RELAY-ID-ANCHOR` 点5），不在本设计的域分隔承诺内。
| P3 | replay 材料一次性 = **v1 仅持久一次性 challenge**（CAS + 同一带权威事务消费）；单调 nonce = **未来版本 only、对 v1 非符合** | 同签名可重放注册 | challenge store 已 CAS + 同事务（③ 已落）；v1 不开 nonce 路 |
| P4 | **crypto-verifier 失败**（throw/false/库不可用/字段缺）= **拒**；**relay 可达性与身份验证无关** | 把"relay 不可达"当拒因 = 混入了 attestation 模型、且暗示去联系 relay = L3 违规 | 🔴 更正（Codex 点3）：远端验证 payload 自足、不联系 relay；只 crypto 失败才拒 |
| P5 | 身份权威**只在**专用 pubkey 表，`ecdsa_pubkey_xonly`/`relay_id` 仅缓存不回退 | 复用旧列/relay_id 回退 ⇒ 背 SS-oracle 语义 + 跨节点填充不一 ⇒ 误判/绕过 | Codex 点2/7 + J1② 均确认；设计如此 |
| P6 | canonical 只有 pubkey 一种串（address 仅派生缓存） | 同钥两身份串 ⇒ 别名/绕唯一性 | 设计如此（§3 L1）；实现须校验 address↔pubkey 派生一致 |
| P7 | **network 权威来自本地配置**，验签前独立校验 `payload.network == 本地`，外/内 network 同源 | payload 自报 network ⇒ 跨网重放（签名合法照样过） | 🔴 MUST-FIX A（Codex）；J1 (543) 实测 payload-network 重建验签=TRUE |
| P8 | L2 被签**字节**跨语言冻结 = **(b) 长度前缀串接**（6 字段 `u32be(len)‖utf8` 固定序），变编码须 bump domain/version | "对象字段序"非语言无关 ⇒ 跨实现漂移变验证分岔 | ✅ MUST-FIX B **已冻结**（Codex MSG-247 要求设计层定，已选 (b)） |
| P9 | 验证方**硬白名单** `operation === "register"`，非此即拒（即使签名合法） | 未知 operation 被当 register 处理 ⇒ 预留域退化成别名 | 🔴 Codex 点6；J1 (543) 实测签名 rotate 验签=TRUE |

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
9. **🔴 跨网重放（MUST-FIX A，与 #1 不同）**：**合法签名的 testnet 声明【原样不改】** 送给 **mainnet 配置的验证方** ⇒ **必拒**（验证方用本地 network 校验 `payload.network`，非用 payload 自带的）。#1 是"签后改 network 复用旧签"，本条是"整条合法签名换个网络语境"。
10. **🔴 operation 白名单（Codex 点6）**：**合法签名**的 `operation="rotate"` 或未知 operation 送到今天 register-only 验证方 ⇒ **必拒**。
11. **🔴 legacy fallback 中毒（Codex 点2）**：有合法本地 `relay_id` 行 + 填充 legacy `ecdsa_pubkey_xonly`，但缺/废 canonical pubkey 证明 ⇒ 查找/注册**必拒**；重新引入"按 relay_id/legacy 列回退"的变异必须被杀。
12. **🔴 跨域重放必拒（MUST-FIX C·Option A 改写·Codex MSG-249）**：拿一条合法的 **A2-域签名/材料**（A2 PoP 签的是 blake2b256 的 64-hex 串，J1 (550) 实测 `u1-registration-pop.mjs:61`）当 §10 声明重放 ⇒ **必拒**；反向 S10 声明重放成 A2 亦拒。依据 = **两域消息空间双向结构不相交**（A2={64-hex}、S10=`KANET-U1-IDENTITY-v1|…`），非"分辨钥类型"（验证方无此比特）。J1 探针已加该负例、原语层红（11 PASS）。🔵 **注**：这**不**要求"A2 钥不能当 relay 钥"——同钥有意签 S10 声明即合法充当 relay 身份（Option A 语境性角色）；被拒的是**未经 S10-域签名的 A2 材料冒充 S10**。
13. **🔴 外/内 network 一致（MUST-FIX A）**：若保留外层明文 network + canonical.network 冗余 ⇒ `outer != inner` **结构上不可能或 fail-closed**。

🔴 **负测纪律（本仓已栽过）**: 抢注负例**在本机跑会绿得没有意义**（同库同 IPC 域，现稿 §3）⇒ 负例必须用「另一把钥签 / 模拟外部方」构造，并在用例里写清它模拟的是什么。参 memory `reference-negative-test-depth-confound-refuses-for-wrong-reason`。#4/#11 属注册表/回退逻辑、#9/#10/#12/#13 属状态机/权威，J1 原语探针不覆盖这些（它诚实标了 implementation-layer pending）⇒ **落地实现层验**。

## §7 明列的空白（不假装覆盖）

- **rotate / revoke / 旧 relay_id 迁移**：out-of-scope（§0 + Codex 点6）。L2 的 operation 域已为它留隔离，但机制未设计。
- **全生产者统一域标签**：P2 的根治，超出本设计，单独立项。
- **nonce 型 replay**：**未来版本 only、对 v1 非符合**（v1 冻结为仅 challenge，见 L2/L4/P3）。将来要用须 bump version（不同签名域）+ 另设计单调性权威/持久化。
- **落地位置**：本份只定机制约束，未定具体挂哪个 handler / 表 schema —— 落地报备时补，走「报备→审核→批准→测试」。

## §8 状态与交接（真实 roster）

**当前状态（2026-08-19）= 三条 MUST-FIX + 两项设计选择【全部设计层冻结】，待 Codex 终确认：**
- **A 本地 network 权威**：**CLOSED AT DESIGN LAYER**（Codex MSG-247 明确）→ L2 MUST-FIX A + P7 + §6-9/13。
- **B canonical 字节冻结**：Codex MSG-247 裁"(a)/(b) 是协议设计、须设计层定" ⇒ **已选 (b) 长度前缀串接并逐字段冻结**（L2 表 + P8）；golden vectors 可导。
- **C 信封形状**：Codex MSG-247 裁"形状是 wire-protocol 设计、须设计层选" ⇒ **已选独立 S10 信封**（§4，Codex 推荐 = 本设计原偏好）；选项 2 不采纳。
- **epoch 重放**：Codex MSG-247 新提"challenge vs nonce 须设计层定" ⇒ **已冻结 v1 = challenge-only**（复用已评审持久 challenge CAS + 同事务）；Codex MSG-248 抓出 L4/P3 残留"或 nonce"自相矛盾 ⇒ **已扫净**（L4/P3/§7 全改 challenge-only、nonce 标 future-only/对 v1 非符合）。
- **A/B/C 三条 Codex MSG-248 判定 = 全部 CLOSED AT DESIGN LAYER**（B 经 Codex 独立重算 3 golden vector SHA-256 一致强化）；epoch 经 Codex MSG-249 确认 **CLOSED**。
- **key-role / §6-12（Codex MSG-249 提的最后一个 OPEN）= Bettor 裁 Option A**：钥角色语境性；`relayPubkeyXOnly` = 自愿以 S10-域自签名充当 relay 身份的钥；§6-12 由"拒 A2 钥类型"（不可实现，验证方无此比特）改写为"**A2↔S10 跨域重放必拒**"（消息空间双向不相交，J1 探针已红）→ L1 语义 + §6-12。**至此 A/B/C/epoch/key-role 全闭 = §10 设计层完成**；发 Codex MSG-250 确认。
- 另并入 Codex：L2 collision 措辞收敛、L4 反 legacy-fallback、P4 concept 更正（relay 可达性与身份验证无关）。
- **仍 OPEN（明列，不假装闭）**：rotate/revoke 连续性（out-of-scope，未来版本另设 state-transition + 继承证明）。

**复核路径**:
- **Codex（bridge）**：已发 **MSG-248** 请终确认 B/C/epoch 三项冻结是否达设计层闭合。
- **J1（独立节点，git）**：(541)(543)(545) 二审 PASS + 核并入忠实 + 探针 10/10 + 2 DEMO；设计层席位无 open item。跨节点负例（#9-13）落**实现层**验。
- **Bettor**：本稿并入 J1+Codex 三轮意见并拍三项设计选择。**落地实现另起报备**，不在本设计里动生产码。
