# M0c-1 机制A — HTTP 能力网关设计 v0.1（外部 app 带信封受保护接入 / tg-bot 头号消费者）

> **Status**: CURRENT（v0.3·Codex 外部对抗审回执 `RESPONSE-...M0C1-MECHANISM-A-V02-CODEX-REREVIEW` fold 中——方向/地基 GREEN-with-notes + MUST-FIX#1 确认 CLOSED，**wallet-transfer 能力上线 BLOCKED**[真洞，非措辞问题]，本版补 blocker 设计，不激活钱路 route；G1 脚手架/共享库/迁移 Codex 已放行可并行）
> **v0.1→v0.2 变更**（存档，NWT 独立重跑 5 角度红队，MUST-FIX 是 J2 §5 自答未触及的第 6 角度）：①§3.2/§6 批 G2 MUST-FIX fold（网关签名验证由「可选」改「强制」+ 批 G2 落码 feature-flag 默认 off 与 relay armed 状态解耦，防新钱路面 fail-open 空窗，比照 `operator-settle.js:36-37` 先例）②§4.3 N1 诚实标 fold（`payee_scope` 对「提现到任意地址」形同虚设；此条本身在 v0.3 又被二次修正，见下）③留 §9 v0.3 槽（本节即是）。
> **v0.2→v0.3 变更**（Codex 外部对抗审抓出 NWT+Bettor+J2 三方都漏的真洞，非红队走过场——外审独立价值实锤）：
> ①**§3.3a 新增·custodial 执行绑定器设计**（补 blocker①）：通用信封→cmd 翻译（`cmd={type,...intent,envelope}`）对 `custodial_transfer` 结构性不成立——执行需 `cmd.privkeyHex`/`cmd.fromAddress`（relay.mjs:495 `custodialSendKaspa`），但这两个字段**不能进签名 intent**（进了 = tg-bot 得知/间接签托管私钥材料，破坏托管架构本身）、**不进又会被 `checkIntentBindsCmd` 判"intent 字段集 != cmd 业务字段集"拒绝**（`app-envelope.mjs:152-162`）。NWT 认账：其 5 角度红队②（verify-value-source）审的是通用机制正确性，没把它具体套进 custodial_transfer 这个最高风险命令验证"翻译层怎么处理 privkey"——命令级验证漏审，Codex 外审独立价值的直接证据。
> ②**§4.3 二次修正（诚实标的诚实标）**：v0.2 把"保守额度上限（单笔+累计）"列为实防线核心——Codex 读码 + NWT 独立验证坐实：`max_cumulative_sompi` **从未 enforce**（`SCALAR_DIMENSIONS` 只有 `amount→max_amount_sompi` 单笔一条，`grant-provision.mjs` 显式写 `max_cumulative_sompi:null` 注释"归 M0c-3"，`checkIntentWithinGrant` 从不读这字段）。J2 v0.2 引用它当防线未验证 enforce 是否真实现，是失误（NWT 同款自认：verdict note-1 背书了未验证的字段）。本版改为诚实标：**实防线 = 仅单笔上限 + tg-bot 诚实**，累计是 schema 占位非 active control。
> ③**§8a no-key-leak 测试规格新增**（补 blocker②）。
> ④**§7 补充替换重放诚实分类 + wallet 上线 Path A/B 二选一开放问题**（不预判，等 Owner/Bettor 对齐）。
> 未变：G1（共享 envelope 库抽取 + origin 迁移 + `capability.js` 脚手架 default-off/503）Codex 已明确放行，不受 blocker 阻塞，可并行落码。

> **作者**: J2（settler/voter/pipeline·clean 会话接位）· 2026-07-23
> **主线依据**: Owner 方向锚（系统干净分层·各功能块可模块化接入 kanet + broker 重点）→ Bettor 自判技术主线机制A 做（`#xl6fla`）。
> **审链（待）**: Bettor 方向审 → ①NWT 内部红队（5 角度）②Codex 外部对抗审（GitHub bridge `coord/codex-bridge` TO-CODEX.md）→ Owner money-path 签发 → 落码（D-011 审链 Bettor 驱动）→ NWT diff 审 + 实战 harness。
> **本文档不改执行代码**（设计层）。
> **消费既有资产（防重造）**: 母卡 `docs/2026-07-23-m0c-1-caller-identity-default-deny-design.md` §2（机制A 职责框架）/§4.0（origin 三类分类）/§4.1（信封流程 locus=relay）；已落码 `kasia-relay/src/lib/authorize.mjs`（authorizeCommand gate）/`app-envelope.mjs`（verifyAppEnvelope 全链）/`grant-registry.mjs`（fresh 读）/`src/db/m0c1-grant-registry-schema.js`（grant scope 维度）/`scripts/m0c1-grant-provision.mjs`（operator 离线签发）。

---

## 1. 一句话 & 定位

**机制A = Console 侧新增 HTTP 能力网关路由层，是外部 app 进程受保护调用 relay 能力的唯一入口。** 它把 tg-bot 等外部 app 从「持共享 `INGEST_SECRET` 万能钥匙」升级为「持 operator 签发的 per-app 窄 grant + 每命令带签名信封」，origin 从 `legacy-unmigrated` → 实 `app`。

**它不是新造的验证机制**——签名信封验证（`verifyAppEnvelope`）、grant registry、provision 全部已在 M0c-1 落码。机制A 补的是**缺失的 HTTP 入口**：今天没有任何路径让外部 app 带信封、以 `origin='app'` 进入命令流。

---

## 2. 坐实：tg-bot 授权现状（实读代码，非拍脑袋）

### 2.1 secret 供给链
- `kasia-console/_launch_tg_bot.mjs`（kanet-start.sh 常驻拉起）：读 `../kanet.env` → `CONSOLE_ENCRYPTION_KEY` → `getConfig('ingest_secret')` 解密 → `process.env.INGEST_SECRET`。
- `tg-bot/config.mjs:9` `ingestSecret = process.env.INGEST_SECRET`；`tg-bot/console-api.mjs:8` `headers()` 每个 authed 请求带 `x-ingest-secret`。
- 校验端 `kasia-console/src/services/ingest-auth.js` `verifyIngestRequest`：全局单 secret `timingSafeEqual`，**无 per-caller 身份 / 无命令白名单 / 无 scope**。

### 2.2 共享面（万能钥匙 = 场景 A）
同一把 `INGEST_SECRET` 被 tg-bot + kaspa-scout（`index.mjs:22`）+ agent-mind（`mind.mjs:923/947/968/1003`）+ agent-adapter（`console.mjs`/`skills.mjs`）共享。**任一持有者 = 可调任何 ingest-authed 端点，含抽干托管钱包。**

### 2.3 tg-bot 真实调用端点清单（`console-api.mjs` 全量·三级分级）
| 级别 | 端点 | 迁移处置 |
|---|---|---|
| READONLY | events/since · relay 系（:id/find/:id/pubkey）· node/income · pool markets/market/trending/available/champions/card_groups/my-positions · broker onboard-status/earnings · chat/messages · feedback/escalated · tg-wallet GET(余额) | grant `allowed_commands` 白名单豁免信封（§3.1 readonly 类）；只读面**不经网关也无妨**（无副作用）——网关只强制包住写/钱路 |
| WRITE 非钱路 | link/bind · link/subscribe · feedback/reply · kanet-broker/onboard · chat/send(owner-voice 桥·走 coord firewall) · register-v0x/prep（确定性 side-P2SH 计算·NO STATE） | 迁 app 信封（intent 绑定，无额度维度） |
| 🔴 钱路/高敏 | **tg-wallet/:id/send**（custodial_transfer·relay 裸私钥经手 IPC）· **faucet/request**（发 KAS）· **register-v0x/confirm**（链上归属检测插 pool_bettor_sides） | 迁 app 信封 + **scoped grant**（命令白名单 + 收款人 + 单笔/累计额度上限 + 有效期） |

**🔴 /send 的结构性洞（tg-wallet.js:19-23 注释自认）**: 当前唯一"授权"= URL 里 `tg_user_id`，**调用者可控** → 持 secret 者可 `POST /:任意victim/send` 抽干任意托管钱包。

### 2.4 blast-radius（已坐实定案·NWT netstat + KANet-UI operator 域实测·非拍脑袋）
- Console 绑 `process.env.HOST || '127.0.0.1'`（`src/index.js:466`；kanet.env 无 HOST override，只 `PORT=3200`）= 绑 `127.0.0.1`。
- **NWT netstat 实证 + KANet-UI 交叉核**: console PID 同时 listen 两 socket——
  ① **`127.0.0.1:3200`** = 主 API + tg-bot/钱路命令面（`/api/tg-wallet/:id/send` 等）= **localhost-only，NOT 公网可达**。
  ② **`100.99.147.101:3201`**（Tailscale IP）= **ZK 专用面·独立 auth（Tailscale + 独立 token 两套）**，**不是** authed 命令面暴露 —— **威胁模型单列，不混进 tg-bot 命令面清单**（KANet-UI 防误判）。
- **定案（诚实标·别 overclaim）**: tg-wallet/send 场景 A 敞口 = **内部横向移动**（攻击者须先拿 localhost 访问，再用共享 secret 发任意命令含抽钱），**非公网远程 drain**（无公网路径到 :3200）。符合 KANet 现状（无网站·Owner 确认无部署计划）。
- **gap-A perimeter（KANet-UI operator 域实读·加固 future-proof）**: 磁盘存在 `C:/Users/ADMIN/gapa-nginx/conf/nginx-gapa.conf`（KANet-UI 前任建的公网暴露 perimeter，Owner SS7.4 直令，**当前未跑**）。即便启动，仅白名单少数只读端点 + faucet POST 到 :3200，其余 567+ 路由（含 **tg-wallet send / relay transfer / system/run RCE / ingest / DB**）全 `location / { return 403 }`。**∴ 即使 gap-A 上，authed 钱路命令面仍 403 不暴露** = 机制A 定级"内部横向非公网 drain"不受影响。
- **🔴 future-proof（机制A 价值定级）**: KANet 将来正式上公网那天，共享 secret 在任何白名单放行面立即升级为**公网远程 drain**风险。未来公网 = 两层：nginx 白名单（钱路 403）+ 机制A（放行面走 app scoped 授权）。机制A（per-app scoped）= **公网暴露那天的正确地基，现在建=提前堵**。故机制A 现在 = 内部 defense-in-depth（**非火警**），未来 = 公网必需。

---

## 3. 网关设计

### 3.1 职责边界（母卡 §2.2：M0c-1 只做认证 + 转发，scope 判定留 M0c-2 细粒度）
网关做三件、**不做**第四件：
1. **认证调用方 app 身份**（复用 C 信封签名验证结果，网关不发明身份机制）——早拒 auth（结构 + 签名 + 命令面），失败请求不打到 relay IPC（UX + DoS 护栏）。
2. **限流 + 审计**（每 app_key_id 维度；审计接 M0c-3）。
3. **翻译成具体 `sendCommandAsync` 调用**，**强制 `origin='app'`**，把信封**原样**随命令带到 relay（供 relay 侧权威 C 验证）。
4. **不做**细粒度 covenant/outputs 派生 scope 判定（M0c-2）；不做 grant 签发（provision 只走 operator 离线脚本，§4.2 焊死）。

### 3.2 双验模型（答 NWT 角度 2：网关验 or relay 验 or 双验 = **双验，且网关验证是强制的**）
- **网关早拒验**（Console 侧）: envelope 结构 strict-reject + **签名验证（🔴 v0.2 fold：MUST，非可选）** + intent_type ∈ 本路由允许命令。**目的 = 早拒 + DoS 护栏**——但不是「因为 relay 会兜底所以网关可以省」；两层各自独立完整验证，互不依赖对方为前提（见 §6 G2 MUST-FIX 的推理错误：曾把「网关可选」建立在「relay 会兜底」上，而 relay armed=off 时兜底本身是 inert 的，两个「各自不完整」互相 backstop 会在 armed=off 窗口内合成为 fail-open，NWT `36a9d901` MUST-FIX）。
- **relay 权威验**（`authorizeCommand` → `authorizeAppCommand` → `verifyAppEnvelope`）: 读 grant registry 做 `intent⊆grant` + `intent==cmd` + 有效期/吊销 + 时间窗。**这是 load-bearing 最后闸**（母卡 §2.3：relay 侧 C 验证是命令执行前 fail-closed 闸；网关对场景 B 零防御，relay 侧验证 backstop 网关授权 bug + post-R 隔离预备）。
- **🔴 信封端到端不可变**: 网关**绝不重序列化/改动信封**——原样对象经 `sendCommandAsync` → IPC `child.send` → relay，relay 对同一 envelope 重跑 `canonicalJson` 重验签（`envelopeSigningMessage`）。网关篡改任一字段 = relay 重验签失败 = fail-closed 拒（自我 backstop）。
- **两层验证独立成立的含义**: 网关签名验证失败 = 网关直接 403，请求不到 relay IPC（早拒价值）；即使网关验证被绕过/有 bug，relay 侧仍独立重验签+ scope（backstop 价值）；**armed=off 期间**（relay gate inert）网关验证仍是唯一实际生效的闸——这是 §6 G2 feature-flag 设计的直接推论。

### 3.3 路由形态（母卡 §2：按业务能力命名·非裸 `sendCommandAsync` 透传）
**业务能力命名路由**，每路由绑死一个（或小集）`intent_type`，拒绝不匹配——这是「非裸透传」的机械实现（对比 relay.js:1726 转发任意 body 的反例）。新增文件 `kasia-console/src/api/capability.js`：

```
POST /api/capability/wallet/transfer   → intent_type 必 === 'custodial_transfer'
POST /api/capability/faucet/request    → intent_type 必 === 'faucet_request'（如走 relay 命令）
POST /api/capability/bet/confirm       → intent_type 必 === register-v07 confirm 对应命令
POST /api/capability/bet/prep          → 确定性计算（NO STATE·可豁免信封走 readonly 类，待定）
```

每路由 handler 统一走一个 `handleCapabilityCommand(request, { allowedIntentType })`：
1. 取 `body.envelope`（缺 = 400）。
2. `intent_type !== allowedIntentType` → 403（本路由不接受该命令）。
3. 网关早拒验（§3.2 网关验）：结构 strict + 签名。**复用 relay 侧 `app-envelope.mjs` 导出的 `canonicalJson`/`envelopeSigningMessage`/结构校验**——抽成共享 lib（`kasia-console` 与 `kasia-relay` 都能 import 的纯函数模块）避免两份漂移（同 grant-schema 单一真相源思路）。**签名验证 MUST，非可选**（见 §3.2：不能把安全性全押给 relay 权威重验，armed=off 期间那扇门本来就 off）。
4. **强制 origin**: 构造 `cmd = { type: intent_type, ...env.intent 业务字段, envelope: env }`，调 `sendCommandAsync(relayId, cmd, undefined, 'app')`。入站任何 `origin` 声明被丢弃（网关只会传 `'app'`，母卡 §4.0：网关强制覆写任何入站 origin 为 `'app'`）。**🔴 v0.3: 这是通用翻译，只对「intent 字段集 == relay 执行所需业务字段集」的路由成立**（如 register-confirm）。**对 `wallet/transfer`（custodial_transfer）不成立，见 §3.3a**——该路由禁止用此通用步骤，必须走专属绑定器。
5. relay 侧 `authorizeCommand` 见 `origin='app'` → 权威验（§3.2 relay 验）。deny → 网关返 403 + reason；allow → 命令执行，返 txId。

### 3.3a 🔴 custodial 执行绑定器设计（v0.3 新增·补 Codex blocker①·wallet/transfer 专属，不适用其他路由）

**问题（Codex 外审抓出，NWT 独立验证坐实·relay.mjs:490-501）**: `custodial_transfer` 执行消费 `cmd.privkeyHex`（`custodialSendKaspa({privKeyHex: cmd.privkeyHex, ...})`）+ `cmd.fromAddress`（ledger 锚点）。§3.3 step4 的通用翻译 `cmd={type,...intent,envelope}` 对这条路由无解：
- **privkeyHex 进 intent（签名内容）**: tg-bot 必须能读到/构造这个字段才能把它塞进签名信封——但 tg-bot 从来不该持有/看到托管私钥（`tg-wallet.js` 的整个既有设计就是"Console 持 `CONSOLE_ENCRYPTION_KEY`，just-in-time 解密派生，relay 用完即弃"，tg-bot 全程 0-key）。让 privkeyHex 出现在 intent 里 = 让 app 端能构造/知晓托管私钥材料，直接破坏托管架构本身，比场景 A 更严重的洞。
- **privkeyHex 不进 intent**: `checkIntentBindsCmd`（`app-envelope.mjs:152-162`）要求「intent 字段集 == cmd 业务字段集（排除 `CMD_INFRA_FIELDS`）」逐键逐值相等——cmd 有 `privkeyHex`/`fromAddress`，intent 没有，字段集不等 → 验证判 `intent 字段集 != cmd 业务字段集` 直接拒。

**核心矛盾**: privkeyHex 是**relay 执行必需**但**app 绝不可知/绝不可控**的字段——它不是"app 声明的业务意图"，是"Console TCB 基于已授权意图派生出的执行材料"。通用「intent==cmd 逐字段相等」模型假设 cmd 的每个业务字段都来自 app 声明，这个假设对该路由不成立。

> **🔴 分工标注（`#xsktcp` Bettor 调整·2026-07-23 17:35→17:35:57 J1 独立坐实产出）**：J2 owns v0.3 整体 first-cut（两侧耦合）——本节 relay 侧机制**由 J1 domain-authority 独立坐实产出**（`relay.mjs:490-501`/`app-envelope.mjs`/`transaction.mjs custodialSendKaspa`/`wallet.mjs KaspaWallet` 全读过），J2 采纳并整合进本文档（非 J2 原创，标清楚出处）。J1 方案取代了 J2 最初的 `DERIVED_EXEC_FIELDS` 通用 manifest 构想（改为命令级特判 + 独立密码学核验，更强）。**no-key-leak 数据流核查独家归 J1**（他坐实过 privkey 经手全路径，§8a 只列需求骨架不代写核查结论）。收敛为一份 v0.3，非两份并行稿。

**设计（v0.3 采纳 J1 domain-authority 方案，`#xsktcp` 后 J1 独立坐实产出·比 J2 初稿多一步独立密码学验证，堵住 Codex 说的"relay 证不了选了哪把 key"）**：分离"授权意图字段"与"服务端派生执行字段"，**关键改进：用公开地址而非用户 ID 做签名意图里的锚点，relay 侧对派生出的 privkey 做独立密码学核验，不是纯 TCB 信任**。

1. **意图字段 = `{fromAddress, target, amount, network}`（不含 `tg_user_id`，不含 privkeyHex）**：`fromAddress` 是**公开** Kaspa 地址（tg-bot 通过既有只读端点 `GET /api/tg-wallet/:tg_user_id` 早就能拿到自己用户的地址，非新增数据面），tg-bot 签的是"从这个公开地址转给谁多少"——不涉及任何私钥材料，也不需要携带 `tg_user_id`（网关侧靠地址反查钱包，见第 2 点）。这比 J2 初稿（意图含 `tg_user_id`）更干净：地址是 `tg_custodial_wallets.kaspa_address`（**`UNIQUE` 约束**，migrate.js:5157），网关按地址查表比按 `tg_user_id` 查表在"谁能声明这个字段"上语义更直接——app 声明的是"我要用这个（我自己已知的公开）地址转账"，不是"我要用 tg_user_id=X 的钱包"（后者更像是让 app 直接指定别人身份，即使 grant scope 会挡，语义上更容易踩偏）。

2. **`commands.mjs` `CUSTODIAL_TRANSFER` 必填字段加 `fromAddress`**（现状 `[privkeyHex, target, amount]`，`fromAddress` 目前隐性可选、只在 ledger 记账兜底用——本次转必填入 `FIELD_TYPES`，J1 域落码）。

3. **`checkIntentBindsCmd` 加 `custodial_transfer` 命令级特化**（不是通用 manifest，是**单命令特判**——privkeyHex 这类"执行专属、绝不可能由 app 声明"的字段，加入排除表，与 `type`/`action`/`envelope`/`__origin` 同类不参与 intent==cmd 逐值比较）：
   ```
   intent = {fromAddress, target, amount, network}
   cmd    = {type, fromAddress, target, amount, network, privkeyHex, envelope}
   → 排除 CMD_INFRA_FIELDS ∪ {privkeyHex（本命令专属排除）} 后逐值比较，
     intent.{fromAddress,target,amount,network} === cmd.{同名字段}，严格相等。
   ```
   🔴 **落码硬性要求（NWT 红队 `17:46` 实现细节note，方向审 GREEN-with-1-implementation-note 的那一条·diff 审重点核）**：上面这个排除**必须门控在 `cmd.type === 'custodial_transfer'`**，**绝不能实现成全局字段名黑名单**（即绝不能写成"任何 cmd 只要出现叫 `privkeyHex` 的字段就跳过绑定检查"这种跟命令类型无关的静态排除）。伪代码钉死：
   ```js
   // 对，命令类型门控：
   if (cmd.type === 'custodial_transfer') excludeFields.add('privkeyHex');
   // 错，全局字段名黑名单（NWT 抓的坑，绝不能这样实现）：
   // const GLOBAL_EXCLUDE = new Set(['privkeyHex']);  // ← 对所有命令类型生效，禁止
   ```
   **为什么这条是硬性要求**：若做成全局黑名单，等于给整个 `checkIntentBindsCmd` 开了一个通用逃生舱——任何命令（不只 custodial_transfer）只要往 `cmd` 里塞一个叫 `privkeyHex` 的字段，就能让那个字段自动跳过 intent==cmd 绑定检查而不需要在 intent 里声明，等于给 verify-value-source 完整性开了后门（跟这个命令是不是真的需要 privkeyHex 无关，纯粹因为字段名对上了）。**diff 审时 NWT 会专门核这条实现是否按命令类型门控。**

   （J1 domain-authority 独立核实：`relay.mjs` 全文 grep `privkeyHex`，唯一消费点 = `:495 custodial_transfer`，无其他命令类型碰它——命令级排除表精确覆盖这一个 type 范围判断成立。）

4. **🔴 派生绑定的独立密码学证明（J1 方案核心改进，堵住 Codex 洞）**：relay 收到 cmd 后，**在** `checkIntentBindsCmd` 通过之后、执行 `custodialSendKaspa` 之前，加一步独立验证：
   ```
   KaspaWallet.fromPrivateKey(cmd.privkeyHex, cmd.network).getAddress() === intent.fromAddress
   ```
   不等 / 派生失败 → deny，不进 switch。**这是本设计的安全核心**：即使 Console/gateway 被攻陷、换了一把不属于该用户的 `privkeyHex`（同时还留着匹配 `target`/`amount`/`network` 骗过字段绑定检查），relay 独立算出这把 key 对应的地址，跟签名意图里的 `fromAddress` 对不上照样拒——**这不是"信 Console 派生正确"的 TCB 信任，是 relay 自己用密码学重新证明了一遍**，比纯粹排除字段+信任派生更强。这一步答上了 J2 初稿留的"⚠ 待红队钉死的问题"（该问题因此**不再需要红队裁**，J1 方案已经解决，非绕过）。

5. **privkeyHex 从哪来（just-in-time 派生，位置不变，未被本次改动触碰）**：网关侧（不是 relay 侧）在验证通过前的 dispatch 准备阶段，按 `intent.fromAddress`（`UNIQUE` 索引，`WHERE kaspa_address = ?` 直接命中）查 `tg_custodial_wallets` 取 `mnemonic_encrypted`，`CONSOLE_ENCRYPTION_KEY` just-in-time 解密派生 `privkeyHex`，塞进 cmd 送 relay——**这条路径完全复用今天 `tg-wallet.js:115-122` 已有的 decrypt+derive 逻辑，不新增数据访问面，只是触发它的"谁能发起"从共享 secret 换成 grant+信封**。relay 端不持有 `CONSOLE_ENCRYPTION_KEY`、不碰 `tg_custodial_wallets` 表——它只做第 4 点那步密码学核验（`fromPrivateKey`→`getAddress`，这是 relay 已有的 `wallet.mjs`/`KaspaWallet` 能力，不需要新数据访问权限）。**J1 方案巧妙之处**：不需要给 relay 新增敏感数据访问路径（这是 J2 初稿"待红队钉死"选项 A 的顾虑）就拿到了密码学核验（比初稿选项 B"纯信任"更强）——两个顾虑一次解决。

6. **TOCTOU 检查（M1-6 立身之本，必须回答）**: 母卡的核心不变量是"验的对象==执行的对象"，`deepFreeze(cmd)` 冻结的必须是 switch 实际消费的那个对象。**J1 方案下这个问题比 J2 初稿设计简单**：privkeyHex 的派生（第 5 点）发生在网关侧、cmd 送到 relay **之前**——relay 收到的 cmd 从一开始就是完整的（含 `privkeyHex`），`authorizeCommand`→`verifyAppEnvelope`→（新增第 4 点核验）→`deepFreeze(cmd)` 是对同一个、一次性构造好的对象做的，**没有"验证通过后再注入字段"这个中间态**，不存在 J2 初稿担心的"派生时机是否在 freeze 前"的问题。剩下唯一需要诚实标的：**gateway 侧 privkeyHex 派生本身仍是乙路 TCB 行为**（Console 持 `CONSOLE_ENCRYPTION_KEY`，这个派生正确性 relay 不参与也不需要参与——它用第 4 点的独立密码学核验代替了"信任 Console 派生对不对"，**这才是本方案相对纯 TCB 信任的实质提升**）。仍然诚实标：这条防线对**场景 B**（被攻陷 Console 能读 `CONSOLE_ENCRYPTION_KEY` 本身、能给任意钱包做合法派生）无效——但这不是本方案的缺陷，是母卡 §1 一贯边界（Console=TCB，R 收口才解），第 4 点密码学核验挡的是"Console 派生错了 key/被换了 key 但没被攻陷到能读加密钥匙"这类**中间态错误/局部攻陷**，比纯粹排除字段+零核验的方案覆盖面更宽。

### 3.4 relayId 解析
网关按业务映射目标 relay（custodial_transfer → `CUSTODIAL_RELAY_ID`，同现 tg-wallet.js:28）。relayId **不从 app 请求体取**（防 app 指定任意 relay）；网关按能力 + grant.relay_scope 约束（relay 侧 `checkIntentWithinGrant` 再验 `relay_id ∈ grant.relay_scope`，双重）。

---

## 4. tg-bot 迁移映射 + 共享 secret 废除

### 4.1 grant 签发（operator 离线，§4.2 焊死）
operator 用 `scripts/m0c1-grant-provision.mjs gen-key` 生成 tg-bot app 密钥对（私钥带外交付，不落盘），`issue` 一条 grant：
- `app_key_id='tg-bot'`, `app_pubkey=<tg-bot 公钥>`
- `allowed_commands=['custodial_transfer', <faucet>, <bet-confirm>]`（**只钱路命令进 grant**；readonly 走白名单豁免不进 grant）
- `relay_scope=[CUSTODIAL_RELAY_ID]`, `network='testnet-12'`
- `payee_scope`=（🔴 v0.2 N1: 对 custodial_transfer「提现到任意地址」形同虚设，见 §4.3）, `max_amount_sompi`=**当前唯一 active 的额度控制**（单笔上限，务必保守——见下方 🔴 v0.3 二次修正）, `max_cumulative_sompi`=**schema 占位，未 enforce，provision 时应显式写 `null` + 备注"归 M0c-3"**（不要填一个数字造成"已生效"的错觉——填了也没用，`checkIntentWithinGrant` 不读这字段）, `valid_until`=有效期

  🔴 **v0.3 二次修正（Codex 外审 + NWT 独立验证坐实）**: v0.2 曾把"保守额度上限（单笔+累计）"列为实防线核心——**`max_cumulative_sompi` 从未被 enforce**：`SCALAR_DIMENSIONS`（`app-envelope.mjs:64-69`）只有 `amount → max_amount_sompi` 一条，无 cumulative 条目；`m0c1-grant-provision.mjs` 显式写 `max_cumulative_sompi: null` 并注释"归 M0c-3 派生"；`checkIntentWithinGrant` 从不读这个字段。**J2 v0.2 §4.1 引用它当防线核心，是没有验证 enforce 是否真实现就背书的失误**（NWT 同款自认：verdict note-1 也背书了未验证的字段，违反"read-actual-code-not-assumed"纪律——已记忆 `feedback-verify-control-implemented-before-citing-as-defense`）。**诚实修正**: 当前 wallet-transfer 实防线 = **仅单笔上限 + tg-bot 诚实**；多笔小额可绕过总敞口（累计无上限），这是**已知残留风险，不是本卡实现 bug**——累计追踪需要 durable 记账（同 nonce 一样是 M0c-3 的范畴：持久化 reserve/atomic-accounting 基础设施），本卡不越权实现。
- 未授权维度列留 NULL = 触及即拒（缺维度默认最严）。

### 4.2 tg-bot 侧改造（`console-api.mjs`）
- 钱路端点从「`headers()` 带 `x-ingest-secret` 打 `/api/tg-wallet/:id/send`」改为「构造签名信封 → 打 `/api/capability/wallet/transfer`」。
- tg-bot 需持 app 私钥（env/文件·operator 带外交付），本地构造 + 签名信封（`envelopeSigningMessage` 定义共享）。
- **信封构造 SDK**: 抽 `tg-bot/envelope-sign.mjs`（或共享 lib），封装 nonce 生成 + issued_at/expires_at + intent_digest + `kaspa.signMessage`。
- 只读端点**可保留现状或也迁**（无副作用，优先级低）——先迁钱路面（最大风险）。

### 4.3 🔴 遗留难点（NWT 红队 N1·Bettor 已裁）: /send 的端到端用户绑定 + payee_scope 实防线诚实标

grant 收窄了「tg-bot 能发什么命令 + 额度」，但**未解**「一人只能转自己钱包」——`custodial_transfer` 的 `tg_user_id`（决定解密哪个托管钱包）仍是 tg-bot 传入的业务数据，对 gate 不透明（`app-envelope.mjs` callerId=service 身份，母卡 §5.1：命令 payload 里端用户标识对 gate 是不透明业务数据，不读不信不转述为身份）。
- **候选 A**: 把 `tg_user_id` 纳入 intent 字段 + payee_scope 绑定？不行——payee 是收款地址维度，tg_user 是钱包属主，语义不同。
- **候选 B**（采纳）: 托管钱包属主绑定移到 **Console 侧业务鉴权**（不是 M0c-1 gate 职责）——即 `/api/capability/wallet/transfer` handler 或 tg-wallet 逻辑层保留「tg_user_id = Telegram 认证的调用者」不变式（现 tg-wallet.js:91-92 已有此设计意图，但依赖 tg-bot 诚实传 ctx.from.id）。gate 保证「tg-bot 这个 service 只能发限额 transfer」，属主绑定归 Console 业务层。
  - 🔴 **v0.3 更新（§3.3a，J1 domain-authority 方案，取代此前 J2 tg_user_id 草案）**: intent 字段最终定为 `{fromAddress, target, amount, network}`——**不含 `tg_user_id`**，`fromAddress` 直接是要转出的公开地址。这让候选 B 的边界更精确：gate 只保证"这个 app 被授权把资金从 `fromAddress` 转给 `target`"（签名 + `checkIntentBindsCmd` + §3.3a 密码学核验三重锁死），**不保证** `fromAddress` 真的是当次 Telegram 交互调用者本人的钱包——这完全是 tg-bot 内部业务逻辑的职责（`ctx.from.id → GET /api/tg-wallet/:tg_user_id → address` 这条查找链必须诚实，gate 看不到 `tg_user_id`，管不到这一步）。**🔴 新观察（v0.3，供红队判断是否需要处置）**：`grant.allowed_commands`/`relay_scope`/`payee_scope`/`max_amount_sompi` 里没有"限定 `fromAddress` 只能是某个子集"这个维度（`SCALAR_DIMENSIONS` 无 source-address 维度）——意味着 tg-bot 这一个 grant 理论上能对**任意**托管钱包（不只是当次交互用户的）签发合法转账意图，只要它自己愿意签。这不是本设计新引入的洞（今天共享 secret 模式下 tg-bot/Console 本来就能操作所有托管钱包），但值得诚实记一笔：**机制A 没有把"tg-bot 只能动它当前服务的那个用户的钱包"做成密码学约束**，这条防线始终是"tg-bot 代码本身诚实"，不是本卡任何机制的产物。

**🔴 N1（NWT 红队 `36a9d901`·v0.2 fold）—— payee_scope 对「提现到任意地址」形同虚设**: `custodial_transfer` 的收款地址是用户自由指定的目标地址（提现场景），不是固定收款人集合；`payee_scope` schema 语义 = membership 集合（NULL=拒非不限，§ SCALAR_DIMENSIONS `kind:'membership'`），**没有通配符/"任意合法 Kaspa 地址"语义**。若要 tg-bot 能支持"提现到任意用户指定地址"这个真实功能，`payee_scope` 要么留空（触及即拒 = 功能直接废掉）要么塞进一个不断膨胀的白名单（不是真限制）——**两种都不是"限定收款人"的有效实现**。

**推论（诚实标，Codex `v0.3.1` note#4 已 pre-rule：multi-user tg-bot credential 本身不能 authorize 特定用户提现）**: candidate B 的实际防线**退化为仅额度上限**——不是 grant 收窄了「该转给谁」，只是收窄了「最多转多少」+「tg-bot 诚实传 ctx.from.id」两条，**均非密码学约束**。

**Bettor 裁定（`#xluo50`，方向裁·非技术正确性裁）**: 边界可接受，作为模块化第一样板落地，**但必须**：①`max_amount_sompi` 保守设值（不是形式上有个数字，是真正把单次 blast-radius 压到可承受——🔴 v0.3 更正：`max_cumulative_sompi` 未 enforce，**不能**指望它压累计敞口，见 §4.1）②本节诚实标是 canonical 措辞，任何后续文档/汇报引用 payee_scope 时禁止暗示"限定了收款人"，引用 `max_cumulative_sompi` 时禁止暗示"已生效"③这是**已知 M0c-1 粗粒度 scope 局限**（母卡 §3.5 note：细粒度 covenant/outputs 派生 scope 归 M0c-2），不是本卡实现 bug，不因此卡落码。

### 4.4 共享 secret 废除（答 NWT 角度：迁完共享 secret 必实废非并存）
- tg-bot 钱路面迁完 → tg-bot 不再需要 `INGEST_SECRET` 调钱路。
- **但** `INGEST_SECRET` 仍被 kaspa-scout/agent-mind/agent-adapter 用（上报方向 `/ingest/*` + 命令）——**不能单为 tg-bot 废掉全局 secret**。
- **分阶段**: ①tg-bot 钱路迁网关（本卡）②tg-bot 只读面迁网关或保留 ③其余 secret 消费者（scout/mind/adapter）逐个评估迁移或收窄 ④全部迁完 → `verifyIngestRequest` 收窄到只 gate `/ingest/*` 上报方向（母卡 §1.2：ingest secret 本设计只 gate 上报方向）→ 命令下发面全走网关/operator 专道/internal。**tg-bot 迁移是第一块样板**（Owner「各功能块干净接入」方向）。

---

## 5. NWT 5 角度红队自答（预先·default-refute 迎审）

1. **网关 = origin='app' 唯一权威铸造点·不可绕**: 
   - 网关是**唯一**给命令打 `origin='app'` 的地方——`sendCommandAsync(...,'app')` 调用点必须**全仓唯一 = capability.js**（同 operator-settle.js:72 唯一 `'operator'` 调用点的单来源假设，authorize.mjs:83-88）。
   - lint 焊死: 加规则「`sendCommandAsync(...,'app')` 只准出现在 capability.js」（同 R-SENDCMD-ORIGIN 家族）。第二个 `'app'` 调用点 = 静默打破唯一铸造 = lint block。
   - app 请求体注入 `origin=internal` → 网关丢弃入站 origin、只传 `'app'`（母卡 §8-7 负向测试）。
2. **信封端到端完整性**: §3.2 双验 + §3.3 信封原样透传；网关篡改 = relay 重验签失败。签名范围 = 全 canonical envelope 去 signature（app-envelope.mjs:6-10 立身之本 MUST-FIX 已焊）。
3. **场景 A/B TCB 诚实**: 网关在 Console 域（乙路 TCB）= 抗场景 A（外部 app 无 app 私钥，伪造不了 operator 签发的 grant + 签名信封）·**不抗场景 B**（被攻陷 Console/网关可绕网关直 import relay-manager 调 `sendCommandAsync`，或直接改 grant registry）。禁称「抗 Console」；场景 B 归 R 收口（母卡 §2.3/§4.1 乙路诚实注记）。
4. **provision 场景 A 不可达**: grant 签发**只** operator 离线脚本（§4.2）——**网关零 provision 写路径**（不新增 `provision_grant` 类命令/端点）。app 经网关试签发新 grant → 网关无此能力 = 结构不可达（母卡 §4.2 / app-provision §6-7 / 负向测试 §8-9）。
5. **外部 HTTP 攻击面（新增·KANet 第一个实外部面）**: 
   - auth: 每请求 envelope 签名（无有效信封 = 拒），非共享 secret。
   - 输入校验: strict-reject 全信封 + intent_type 白名单 + relayId 网关约束（不从 body 取）。
   - DoS/限流: 每 app_key_id 维度限流（§3.1②）；envelope 签名验证前先结构校验（廉价先行，避免拿无效大 body 烧验签）。
   - 重放: nonce 在签名范围内（换 nonce = 签名失效）+ TTL ≤1h 收紧（app-envelope.mjs:33）；durable nonce 去重 = M0c-3 接口（本卡不实现，诚实残留窗）。
   - **🔴 §2.4 proxy 可达性待答** = 此角度的 load-bearing 前提，红队请核。

---

## 6. 分批落码计划（每批 NWT diff 审·verdict-before-push·armed 前置）

- **批 G1**: 共享 envelope lib（`canonicalJson`/`envelopeSigningMessage`/结构 strict 校验抽成 console+relay 共享纯函数模块，防两份漂移）+ 单测。
- **批 G2**: `capability.js` 网关路由 + `handleCapabilityCommand`（wallet/transfer 先行·钱路最大风险面）+ `sendCommandAsync(...,'app')` 唯一铸造点 lint 规则。
  - **🔴 v0.2 MUST-FIX fold（NWT `36a9d901`，比照 `operator-settle.js:36-37` 先例）**: ~~armed=off 下网关路由存在但 relay gate inert（=现状不 live）~~ 这句断言**没有论证为什么安全**——链条：网关早拒验读 registry 取 app_pubkey 做签名验证，但 v0.1 写「网关侧签名验证可选（relay 权威重验）」；而 relay armed=off 时 `authorizeCommand` 对**任何** origin 都直接 `{decision:'allow'}`（inert，§ authorize.mjs:66-72，不管 envelope 是否有效）。**若网关验证被跳过/可选 + relay armed=off = 新钱路面（`/api/capability/*` 公开路由）存在但两层验证都不生效 = fail-open 空窗**（两个「各自不完整」互相 backstop 的推理不成立，与今夜开闸事故同款模式）。
  - **修法**: ①`capability.js` 路由落码时**默认 feature-flag off**（`ADMIN_CAPABILITY_GATEWAY_ENABLED != '1'` → 整体 503），**与 relay armed 状态完全解耦**（不能靠"relay 还没 arm 所以网关裸着也没事"这种依赖对方的论证）②§3.2 网关侧签名验证**写死为强制**（非可选）——网关自己必须能独立挡住无效信封，不能把安全性全押给 relay armed（那扇门本来就 off）。③批 G4 实战 harness 通过后，批 G5 armed 前置满足时才把 `ADMIN_CAPABILITY_GATEWAY_ENABLED` 置 1（与 relay armed=on 同批开，非提前裸露）。
- **批 G3**: tg-bot 信封签名 SDK + `console-api.mjs` 钱路端点切网关（tg-bot 侧改造）。
- **批 G4**: operator 签发 tg-bot grant（离线）+ 实战 harness（persona 平替真人：tg-bot 带信封走网关→relay→上链，端到端）。
- **批 G5（arm）**: 三前提焊死满足后 armed=on（gate 生效），tg-bot 走 app 面授权。共享 secret 钱路面废除（§4.4 阶段①）。

**armed 前置（authorize.mjs:9 焊死）**: grant/envelope 非 stub（已 true）+ 批 C 迁移收口全标 origin + provision 实。机制A arm 归批 G5，Owner 拍。

---

## 7. 诚实边界 / 待答问题（迎审清单）

1. ~~**§2.4 proxy 公网可达性**~~ — **已坐实定案**（NWT netstat + KANet-UI operator 域实测，§2.4）: localhost-only + gap-A 未跑（即便跑，钱路面 403）= 内部横向非公网 drain。
2. ~~**§4.3 tg_user 属主绑定 / payee_scope 实防线**~~ — **已裁**（NWT N1 `36a9d901` + Bettor `#xluo50`，§4.3）: gate 管 service 越权，不管 tg_user 冒名；payee_scope 对提现场景形同虚设，实防线=保守额度上限+tg-bot 诚实，非密码学约束。诚实标已 fold，Bettor 裁边界可接受作第一样板。
3. **durable nonce 重放** — 本卡不实现（M0c-3 接口），expiry 窗口内原样重放不拦（TTL≤1h 收紧）。🔴 **诚实分类（v0.3，答 Bettor `#xscxh7` "同信封重放测试+按选定路径诚实分类"）**：这个残留对 wallet/transfer 意味着——同一份签好的信封在 TTL 窗口内（≤1h）被重放，relay 侧 `checkIntentBindsCmd`+§3.3a 密码学核验都会**通过**（信封本身合法、intent 没变、privkey-address 匹配没变），**没有任何机制阻止它执行两次转账**。这不是 custodial 绑定器设计的缺陷，是 M0c-1 nonce 机制本身的已知诚实残留（§4.1 母卡口径），但对钱路命令（尤其 custodial_transfer）是**实际可被利用的重复扣款风险**，比对 register-confirm 这类命令更敏感——**wallet 上线前必须显式评估这条风险是否可接受**，见第 7 点 Path A/B。
4. **faucet 是否走 relay 命令** — faucet 现走 `/api/faucet/request` → FaucetRelay，是否纳入 capability 网关 or 保持独立反刷（faucet 是 fully-public money-path，靠反刷非 auth，母卡 §9 faucet 改判）——待定，倾向 faucet 独立不进 grant。
5. **只读面迁不迁** — 无副作用，优先级低，先迁钱路。
6. **共享 secret 全废时间线** — 依赖 scout/mind/adapter 各自迁移，非本卡范围（本卡只做 tg-bot 样板 + 阶段①）。
7. 🔴 **wallet-transfer 上线 Path A vs Path B（v0.3 新增·Bettor 倾向 B·待 Owner 对齐，本卡不预判）**：
   - **Path A**：等 M0c-3（累计记账 durable + 持久防重放 nonce）落地后再上线 wallet route。风险最低，等待时间未知（M0c-3 尚未落码）。
   - **Path B**：TN12 小范围试点，**显式诚实标**当前实际防线边界——仅单笔上限（无累计）/无持久防重放（TTL 窗口内重放残留）/极低额度/短 TTL 窗口/localhost-only（§2.4 已定案）/随时可吊销（grant revoke 已实现，fresh 读即时生效）/**重放残留进证据文档**（不隐瞒，作为已知风险接受清单的一部分）。符合 Owner "实战测试充分" 方向（`feedback-test-iterate-framework-replace-human`）。
   - 两条路都以**§3.3a 密码学核验 + no-key-leak 全项通过**（第 8 点）为前置——这个前提不因选 A 或 B 改变，Path B 不是"绕过安全设计抢跑"，是"在已具备的安全设计基础上，对尚未覆盖的残留风险（累计/持久重放）做范围收窄式的风险接受"。
8. 🔴 **§3.3a 密码学核验方案本身待三方 confirm**（v0.3 新增）：J1 独立坐实产出的绑定器设计（意图字段收窄到 `{fromAddress,target,amount,network}` + `checkIntentBindsCmd` 命令级特判 + `fromPrivateKey→getAddress` 独立核验）已被 J2 采纳整合进本文档，但**尚未经 NWT/Codex 对这个具体机制的一轮新审**（此前两轮红队审的是 J2 v0.1/v0.2 的通用机制，不是这个新绑定器）——落码前需要这个机制单独过一遍 NWT diff 审 + Codex 复核，不能因为"来自 domain-authority" 就跳过外部验证。

---

## 8. 测试计划（骨架·实战 harness DoD）
- 负向: 无信封拒 / 伪签拒 / 未知 grant 拒 / 过期拒 / intent_type 不匹配路由拒 / 注入 origin=internal 被覆写拒 / 超额度拒 / 收款人 ∉ payee_scope 拒 / 网关篡改信封后 relay 重验失败拒 / app 试 provision 拒。
- 正向: 合法信封 + 合法 grant → allow → 上链 txId。
- 实战 harness（G4）: tg-bot persona 真发带信封 transfer 走网关端到端上链（母卡实战 DoD·Owner 每子批实战钉死）。
- 🔴 v0.2 新增负向（G2 MUST-FIX 对应）: `ADMIN_CAPABILITY_GATEWAY_ENABLED` 未设/=0 → 路由 503（与 relay armed 状态无关，即使 relay armed=on 网关 flag off 仍 503）；网关侧签名验证单独关闭测试（不存在这个开关——验证代码路径本身无可绕过分支）。

### 8a. custodial 绑定器专项测试（v0.3 新增·§3.3a 对应）

**🔴 归属**：本节只列**需求骨架**（哪些面必须覆盖），**不代写核查结论/不代写具体 assertion**——no-key-leak 数据流核查 + 具体测试用例内容独家归 J1（`#xsktcp` Bettor 派工，他坐实过 privkey 经手全路径，J2 不具备同等把握代写结论）。

**J1 可执行测试规格（`17:54:20` 消息展开自 `17:35:57` 五点骨架，J2 转录不改写，标出处）**：

1. **canonical 字节扫描**：`envelopeSigningMessage(env)` 产出字符串 + `JSON.stringify(env)` 整体，都 regex `/[0-9a-f]{64}/i` 扫零命中；结构上另断言 `'privkeyHex' in env.intent === false` 且 `'privkeyHex' in env === false`（双保险，不只信 regex）。fixture 用 harness 既有 app-envelope-sdk 真构造一份 `custodial_transfer` 信封去跑。

2. **deny reason 扫描**：
   - 静态部分：grep 新增 custodial 专属 `denyResult(...)` 调用点的 reason 字符串字面量，确认没有 `${...privkeyHex...}` 插值。
   - 动态部分：把 custodial_transfer 全部 deny 分支都触发一遍（伪签/过期/`fromAddress` 不匹配/派生失败 garbage privkeyHex），每条实际拿到的 reason 字符串跑 64-hex 正则扫描断言零命中（garbage privkeyHex 若被误 echo 会正好命中这个 pattern，测试能抓住）。

3. **`log()` 链路**：
   - 静态部分：grep 批 G2 新增代码（`capability.js` + gateway dispatch + `app-envelope.mjs` custodial 分支）所有 `log`/`console.*` 调用，逐个检查参数不含 `privkeyHex`——**特别注意间接泄露**：`JSON.stringify(cmd)` 或 `JSON.stringify(env)` 整体传进 `log()` 也算泄露，不能只查字面量 identifier 名。
   - 动态部分：harness 跑一轮完整 custodial allow+deny flow，log 输出全部重定向到 buffer，64-hex 正则扫描断言零命中。

4. **回执 result 对象**：custodial_transfer 的两条回执路径（gate-deny 走 `authorizeCommand` 通用 deny reply + switch 内 `relay.mjs:499` 成功/失败 reply）都结构断言 `!('privkeyHex' in result)`，外加 `JSON.stringify(result)` 做 regex 扫描防嵌套泄露。

5. **派生不匹配负向 case 矩阵（三条，不是一条）**：
   a) 签名意图 `fromAddress`=A 但 `cmd.privkeyHex` 实际派生到地址 B（≠A）→ 必须 deny，reason 可以带地址（非密文，便于排障）但不能带任何私钥材料。
   b) `cmd.privkeyHex` 格式非法（非 64-hex/构造抛异常）→ `KaspaWallet.fromPrivateKey` 会 throw，必须被 catch 转成 deny，不能变成 relay 进程未捕获异常（那是可用性风险，不是简单的 deny）。
   c) privkeyHex 合法但网络对不上（如 mainnet key 喂进 testnet 流程）→ 地址前缀天然不同串比较自然失配，deny——这条顺便实测验证了 §3.3a 第 5 点"network 一致性隐式覆盖"这个理论声明，不能只停留在推理层面。

**J2 认为需要额外覆盖但未展开（供 J1 判断是否纳入，非坚持）**：审计/事件表（`chain_events`/`events`，M0c-3 audit 落地后）序列化路径是否会意外带上 `privkeyHex`——现在还没有 M0c-3 audit 具体实现，先记一笔，等那批设计落地时对照本条复查。

**防重放测试（J1 `17:54:20` 展开，补 §7-3 诚实分类）**：不是测"拦住了"而是测"证明这个洞存在"——构造一份完整合法签名信封（真签名+真 grant+TTL 内），发一次 → allow；原样字节不改再发第二次 → **当前设计预期依然 allow**（intent 绑定过/签名过，nonce 没有 durable 去重，M0c-3 前无机制拦这个）。测试的断言方向是"第二次确实被 allow"（不是 expect deny），这份 evidence 直接喂给 Owner 做 Path A/B 决策依据，不能只有文档里一句"诚实残留"却没有实测证据支撑。

**归属声明（J1 `17:54:20`）**：这五点+防重放 spec 够详细可以直接进 G4 测试代码了；等 G2/G4 实际落码时 J1 按这份填 assertion。

---

## 9. Codex 外部对抗审 v0.2 回执记录（v0.3·`RESPONSE-...M0C1-MECHANISM-A-V02-CODEX-REREVIEW`）

**Codex 裁定（Bettor `#xscxh7` 转述·读 `eefa9eca` + 实读 relay 代码 blob）**：
- ✅ **方向/模块化 = GREEN**
- ✅ **地基（grant/envelope/origin/phased-arm）= GREEN-with-notes**
- ✅ **MUST-FIX#1（dark launch + 网关验证强制）= Codex 确认 CLOSED**
- 🔴 **wallet-transfer 能力上线 = BLOCKED**（两点，只挡钱路 route 激活，不挡脚手架/共享库/origin 迁移——G1 可并行）：
  1. **custodial_transfer privkeyHex 结构悖论**（本文档 §3.3a 已给出设计回应，J1 domain-authority 产出 + J2 整合，待 §7-8 三方新一轮 confirm）。
  2. **`max_cumulative_sompi` 未 enforce 被引用为防线**（本文档 §4.1/§4.3 已诚实修正）。

**已知 Codex 早期反馈**（`v0.3.1` note#4，通过 Bettor 转述，已在 §4.3 引用）: multi-user tg-bot credential 本身不能 authorize 特定用户提现——与 NWT N1 同一发现，双路独立收敛（交叉验证价值）。

**harness evidence artifact**（KANet-UI，`31a31fcf` 已 push）: `docs/evidence/2026-07-23-m0c1-gate-harness-evidence.json`（sha256 `5c0e9c5a...431e8bfb`，坐实零私钥/助记词/secret/token 命中 + summary.pass=22/fail=0），供 Codex 独立核 22 命令 run（gitignored 原文件它读不到，这份是 tracked 快照）。

**外审独立价值实锤（团队集体认账，`17:31` NWT）**: Codex 抓出两处 NWT/Bettor/J2 三方都漏审的真洞——这不是走过场的"红队 rubber stamp"，是外部视角带来的实质发现。NWT 自认两处漏审（①命令级 verify-value-source 没具体套进 custodial_transfer 验证 privkey 翻译 ②verdict note-1 背书了未验证 enforce 的字段），已记忆 `feedback-verify-control-implemented-before-citing-as-defense`。

**§7-8 新一轮 confirm 已回（`17:46`，NWT + J1 双 GREEN，§3.3a 落地）**：
- **NWT 红队核**（`17:46`）：**设计层面 GREEN**——核心密码学核验（步骤 4）机制正确，"是 relay 自己重新证明一遍，不是信任 Console 派生对了"，实答上 Codex 洞；TOCTOU 分析（步骤 6）成立，privkeyHex 在 gate 检查前就已在完整 cmd 里，无"验证后再注入"中间态。**1 implementation-note（已 fold 进 §3.3a 第 3 点，diff 审重点）**：`checkIntentBindsCmd` 排除 privkeyHex 必须按 `cmd.type==='custodial_transfer'` 命令类型门控，绝不能实现成全局字段名黑名单（否则给 verify-value-source 完整性开逃生舱后门）。**1 note（非 blocker，低优先级）**：网关早拒验（签名检查）可能在 grant/scope 校验之前触发一次 privkeyHex 解密查询——有效签名但超额度的请求仍会先解密才被拒，轻量 DoS 放大点，不阻塞落码。**verdict = GREEN-with-1-implementation-note+1-note**。
- **J1 domain-authority 审**（`17:46`）：**GREEN**——独立核实文档引用的每处代码坐标（非只读 prose 背书）：`migrate.js:5157` UNIQUE 约束/`tg-wallet.js:79` 只读端点不回 mnemonic/`tg-wallet.js:104,115-122` decrypt+derive 流程/`relay.mjs` 全文 grep `privkeyHex` 唯一消费点 `:495`，行号全部精确对上。**额外证据**（非文档假设，J1 补核实）：`tg-wallet.js:130` 现有 `/send` 端点已经在传 `fromAddress: w.kaspa_address` 进 cmd（legacy-unmigrated 路由），印证"`fromAddress` 目前隐性可选"这句是实读代码结论非臆测。**network 一致性隐式覆盖**（J1 观察）：Kaspa 地址文本自带 network 前缀（`kaspa:` vs `kaspatest:`），network 不一致会导致派生地址字符串直接不等，不需要额外单独校验 network 字段。no-key-leak 五点骨架维持不变，§4.1/§4.3 诚实修正认可。

**Codex 待跑最后一轮**（本文档已回应两个 BLOCKER，需要 Codex 对 §3.3a 具体机制 + §4.1/§4.3 修正做外部复核，等回执才算完整闭环——NWT/J1 内部双 GREEN 不能替代外审）。

**下一步**: Codex 对 §3.3a + 诚实修正复核（外部对抗审最后一轮）→ §7-7 Path A/B 待 Bettor/Owner 对齐 → J1 落码（relay 侧特判+密码学核验）+ J2/或分配的 gateway 侧（§3.3a 第 1/5 点）落码 → NWT diff 审（重点核命令类型门控是否落对）→ 实战 harness → G1（不受阻，可能已并行推进）。
