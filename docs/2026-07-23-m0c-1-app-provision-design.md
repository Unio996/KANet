# M0c-1 app provision 组件设计稿 — grant registry + 信封验证 + provision（J2 主设计）

> **Status**: DRAFT（2026-07-23 · J2 出稿 → 待 Bettor 方向审 → 待 NWT 红队 → 待 Owner money-path 签发才落码）
> **本卡性质**：设计文档，不改一行执行代码；不授权任何落码/凭证 provision/relay 重启/签名/广播/结算/资金移动。
> **是什么**：批3 M0c-1 gate 本体（`547f1c07`）的 app 路径 grant/envelope 验证是 **stub**（`GRANT_ENVELOPE_IMPLEMENTED=false`，armed=on 被 arm 前提焊死拦）。本组件**填实** stub——app 凭证 + grant registry + 信封验证 + provision，实现后置 `GRANT_ENVELOPE_IMPLEMENTED=true`，解 armed=on 前提之一。
> **依据**：M0c-1 母卡 §4.1（信封验证 step2-7）/§4.2（relay-authoritative grant）/§4.3（provision operator 离线，v0.2 NWT MUST-FIX + J1 补丁 M1-5）+ §5（AuthResult 接口）+ 批3 authorize.mjs（`authorizeAppCommand` stub 填实点）。
> **gate-arming 前置之一（NWT 硬条件）**：本组件（grant/envelope 非 stub）+ 批C 迁移收口 + provision 实 = 批F arm 三前提，缺一不准 arm。

---

## 0. 现状地基（读码坐实·防重造）

1. **批3 gate 的 stub 点**：`authorize.mjs` `authorizeAppCommand(cmd)`——origin='app' 命令到此，现 stub（`!GRANT_ENVELOPE_IMPLEMENTED → deny 双保险 fail-closed`）。本组件把 stub 换成完整验证链（§4.1 step2-7）。
2. **无现成信封验签（防重造查证）**：relay 侧有 `XOnlyPublicKey`（p2sh.mjs）但**无现成信封签名验证**（verifyMessage/verifySchnorr）。console 侧 oracle-pool `handleOracleStakeWithdraw` 用过 `kaspa.verifyMessage(message, signature, publicKey)`——app 信封验签**复用 kaspa-wasm verifyMessage/schnorr**（同一密码学原语，不新造验签）。
3. **grant registry 要新建**：无现成 grant registry 结构。schema 落 DB（过 DATABASE.md，migrate v190+，当前 v189）。乙期宿主在 Console TCB 内（§4.2）。
4. **provision 无现成 operator 脚本**：新建 `scripts/` 下 operator 离线脚本（§4.3，零 HTTP/IPC 写）。

---

## 1. 🔴 乙路 TCB 边界继承（置顶）

- grant registry / app 凭证签发权乙期在 **Console 可达信任域内**（§4.2）——对场景 A（应用伪造不了 Console 签发的 grant）有效、对场景 B（Console 直接改 registry 自授权）无效。R 收口移出。
- **禁用词表（继承）**：禁"app provision 使被攻陷 Console 无法伪造 grant"。允许口径="app provision = 应用凭证 + 权威 grant 比对 + operator 离线 provision；Console=TCB，不防被攻陷 Console 改 registry；抗场景 B 需 R"。
- **实现批 diff 审须核 grant registry 宿主**：禁止把"registry 在 Console 内"描述成"抗 Console"。

---

## 2. grant registry（§4.2·relay-authoritative·防 grant inflation）

**核心不变量**：信封里的 scope 是不可信输入（app 签名只证持有 app key，不证被授权那个 scope）——relay 拿请求 intent 跟 **relay 侧权威 grant** 比对，`intent ⊆ 已签发 grant` 才放行。

**grant 绑定字段（schema，§4.2 + M-1.6 §5 canonical）**：
| 字段 | 内容 |
|---|---|
| app_key_id | app 公钥 id（信封签名验签用此查公钥） |
| allowed_commands | 允许命令类型集 + typed-intent 版本 |
| relay/wallet/network scope | 允许操作的 relay id / wallet 地址 / network |
| market/family/outpoint/branch scope | covenant 结算细粒度 scope |
| payee + limits | 收款人地址集 + 单笔/累计金额上限 + 费率上限 |
| validity + version | 生效/失效 DAA 或时间 + grant 版本 |
| revocation | 吊销标识（M0c-3 ⑦查此） |

- **宿主（乙期）**：DB 表（过 DATABASE.md migrate v190+），Console TCB 内，**只读评估**（gate 读）+ **operator 离线写**（§4）。
- **relay 侧读取**：relay gate（authorizeAppCommand）查 registry 取 app 公钥（验签）+ grant scope（intent⊆grant）。relay 进程启动加载 or 按需查（落码定，考虑 registry 一致性 + 性能）。

---

## 3. 信封验证流程（§4.1 step2-7·authorizeAppCommand 填实）

`authorizeAppCommand(cmd)` 完整链（替换批3 stub）：

1. **无害只读白名单豁免**（§3.1，批3 已有 READONLY_ALLOWLIST）——命中放行。
2. **解 `cmd.envelope`**（缺 → 拒 fail-closed）。
3. **验签名**：`app_key_id` → 查 grant registry 取 app 公钥 → `kaspa.verifyMessage(canonical(envelope.intent), envelope.signature, appPubkey)`（复用 kaspa-wasm 验签，不新造）；签名不过 → 拒。
4. **canonical 反序列化**信封字段（M-1.6 §5 字段表；domain-separation；防 unknown 字段碰撞[reference-feerules-hash-commit-unknown-field-collision] → strict-reject 未知字段）。
5. **intent ⊆ grant 校验**（§4.2 — MF3 核心，逐维度：命令∈allowed_commands / relay·wallet∈scope / market·outpoint∈scope / 收款人∈payee+额度≤上限 / 有效期内）。**verify-value-source（M0c-2 §3.5 同纪律）**：抽的每个 scope 值来自 §4.1 冻结的 canonical intent、relay 执行消费的同一字段，禁旁支/re-parse。
6. **[M0c-3] nonce/replay durable 校验**（本组件留 M0c-3 接口，M0c-3 实现——禁内存 nonce 占位）。
7. **全过 → 返回 AuthResult**（§5：authenticated+callerId+grantId+intentDigest）→ decision=allow；任一步失败 → fail-closed 拒 + 不推进状态。

**TOCTOU 不变量（母卡 §4.1 + 批3）**：验的对象 == 执行的对象（frozen canonical cmd，switch 只消费冻结那份，intentDigest 覆盖全部影响执行字段）——J2 域 C3 纪律延伸。

---

## 4. provision（§4.3·operator 离线·信任根焊死）

- **provision 只走 operator 离线带外脚本**（`scripts/m0c1-grant-provision.mjs` 类，operator 手跑，读写 grant registry DB）——**零 HTTP 写路径、零 IPC 写路径**：不经共享 ingest secret、不经 A 能力网关、不经任何应用可发命令（含 relay IPC 全部 ~50 命令，**不新增 provision_grant 类命令**）。
- **静态可枚举（M1-5）**：grant registry 全部写入方在代码静态可枚举 = 仅 operator 脚本一处；任何请求处理代码（HTTP handler/IPC handler/daemon tick）出现 registry 写 = 实现批 diff 审直接打回。运行时自注册禁止。
- **app 凭证签发**：app key 对（公私钥）由 operator 生成，公钥入 grant registry（app_key_id），私钥带外交付 app（乙期 operator 管，R 收口走可验证凭证）。
- **与 M0c-3 吊销接缝**：吊销走同一 operator 离线通道（写入面越窄，吊销/审计越好接）；审计只读 registry 不引入写路径。
- **同网三面（NWT §4.3 定性）**：provision 管谁能写 grant / origin 管谁能不带 envelope 过 gate（批3 §4.0）/ post-R 管隔离后 internal·operator 怎么 auth（note-B R 卡）——三面缺一整网 vacuous。

---

## 5. 与批3 gate / M0c-2 / M0c-3 接入

- **批3 gate**：`authorizeAppCommand` stub → 本组件填实；`GRANT_ENVELOPE_IMPLEMENTED=true`（本组件落码后）→ 解 armed=on 前提之一。
- **M0c-2 scope evaluator**：本组件产出 AuthResult（callerId+grantId），M0c-2 消费做逐维度细粒度 scope（本组件 §3 step5 是粗粒度 intent⊆grant，M0c-2 细粒度）。
- **M0c-3**：intentDigest（§3 step7）供 M0c-3 nonce 绑定 + 审计 + 吊销查。

---

## 6. 负向测试（armed=on 后·关2 行为验）

1. **无信封 app 命令** → 拒 fail-closed。
2. **签名不过**（伪造签名/错公钥）→ 拒。
3. **grant inflation**（app 签超 grant scope 的 intent）→ intent⊄grant → 拒。
4. **未知 key-id**（无 grant）→ 拒。
5. **过期/吊销 grant** → 拒。
6. **未知字段碰撞**（信封夹带未知字段）→ strict-reject 拒。
7. **provision 场景A不可达**（app 用凭证试 provision 新 grant 经网关/HTTP/IPC）→ 必拒（§4）。
8. **verify-value-source**（信封 intent 与执行字段不一致/掉包）→ scope 抽取==执行字段核。
9. **合法 app**（有效 grant+签名+intent⊆grant）→ 真放行、真执行。

---

## 7. 预算维度（遵 Owner 令给维度不拍数）

| 组件 | 钱路语义行? | 落点 | 估 |
|---|---|---|---|
| grant registry schema + 读 | 否（数据）/ 部分（读评估=钱路） | 新表（过 DATABASE.md migrate v190+）+ relay 侧读 | 待落码 |
| 信封验证（authorizeAppCommand 填实） | **是**（授权判定=钱路核心） | authorize.mjs authorizeAppCommand + 验签（kaspa verifyMessage）+ canonical + intent⊆grant | 待落码，超 50 拆子函数 |
| provision operator 脚本 | 部分（校验=钱路，写 schema=非钱路） | scripts/ operator 离线脚本 | 待落码 |

**诚实标注**：信封验证是钱路语义核心（授权闸的实实）。改表过 DATABASE.md。

---

## 8. 待办 / 交接

- 本卡待 Bettor 方向审 → NWT 红队（照 §6 负向 + verify-value-source + provision 场景A不可达 + grant inflation）→ Owner money-path 签发才落码。
- **改表**（grant registry）过 DATABASE.md，migrate v190+（当前 v189）。
- **落码后置 `GRANT_ENVELOPE_IMPLEMENTED=true`**（批3 authorize.mjs）——但仅在本组件 diff 审+实战过后（arm 前提之一，非本组件落码即 arm）。
- **M0c-2/M0c-3 接缝**：AuthResult（callerId+grantId+intentDigest）供 M0c-2 scope + M0c-3 replay/审计/吊销。
- **nonce/replay（§3 step6）留 M0c-3 接口**（禁内存占位）。

**关联**：`docs/2026-07-23-m0c-1-caller-identity-default-deny-design.md`（母卡 §4.1/§4.2/§4.3/§5）、`kasia-relay/src/lib/authorize.mjs`（批3 stub 填实点）、`docs/2026-07-23-m0c-2-scope-evaluator-design.md`（§3.5 verify-value-source）、`docs/2026-07-23-m0c-3-replay-audit-revocation-design.md`（nonce/审计/吊销接缝）。
