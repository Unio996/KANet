# M0c-1 机制A — HTTP 能力网关设计 v0.1（外部 app 带信封受保护接入 / tg-bot 头号消费者）

> **Status**: CURRENT（v0.1 设计草案·待 Bettor 方向审 + NWT 5 角度红队 + Codex 外部对抗审）

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

### 3.2 双验模型（答 NWT 角度 2：网关验 or relay 验 or 双验 = **双验**）
- **网关早拒验**（Console 侧）: envelope 结构 strict-reject + 签名验证 + intent_type ∈ 本路由允许命令。**目的 = 早拒 + DoS 护栏**，非权威闸。
- **relay 权威验**（`authorizeCommand` → `authorizeAppCommand` → `verifyAppEnvelope`）: 读 grant registry 做 `intent⊆grant` + `intent==cmd` + 有效期/吊销 + 时间窗。**这是 load-bearing 最后闸**（母卡 §2.3：relay 侧 C 验证是命令执行前 fail-closed 闸；网关对场景 B 零防御，relay 侧验证 backstop 网关授权 bug + post-R 隔离预备）。
- **🔴 信封端到端不可变**: 网关**绝不重序列化/改动信封**——原样对象经 `sendCommandAsync` → IPC `child.send` → relay，relay 对同一 envelope 重跑 `canonicalJson` 重验签（`envelopeSigningMessage`）。网关篡改任一字段 = relay 重验签失败 = fail-closed 拒（自我 backstop）。

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
3. 网关早拒验（§3.2 网关验）：结构 strict + 签名。**复用 relay 侧 `app-envelope.mjs` 导出的 `canonicalJson`/`envelopeSigningMessage`/结构校验**——抽成共享 lib（`kasia-console` 与 `kasia-relay` 都能 import 的纯函数模块）避免两份漂移（同 grant-schema 单一真相源思路）。签名验证网关侧可选（relay 权威重验），但早拒 UX 好。
4. **强制 origin**: 构造 `cmd = { type: intent_type, ...env.intent 业务字段, envelope: env }`，调 `sendCommandAsync(relayId, cmd, undefined, 'app')`。入站任何 `origin` 声明被丢弃（网关只会传 `'app'`，母卡 §4.0：网关强制覆写任何入站 origin 为 `'app'`）。
5. relay 侧 `authorizeCommand` 见 `origin='app'` → 权威验（§3.2 relay 验）。deny → 网关返 403 + reason；allow → 命令执行，返 txId。

### 3.4 relayId 解析
网关按业务映射目标 relay（custodial_transfer → `CUSTODIAL_RELAY_ID`，同现 tg-wallet.js:28）。relayId **不从 app 请求体取**（防 app 指定任意 relay）；网关按能力 + grant.relay_scope 约束（relay 侧 `checkIntentWithinGrant` 再验 `relay_id ∈ grant.relay_scope`，双重）。

---

## 4. tg-bot 迁移映射 + 共享 secret 废除

### 4.1 grant 签发（operator 离线，§4.2 焊死）
operator 用 `scripts/m0c1-grant-provision.mjs gen-key` 生成 tg-bot app 密钥对（私钥带外交付，不落盘），`issue` 一条 grant：
- `app_key_id='tg-bot'`, `app_pubkey=<tg-bot 公钥>`
- `allowed_commands=['custodial_transfer', <faucet>, <bet-confirm>]`（**只钱路命令进 grant**；readonly 走白名单豁免不进 grant）
- `relay_scope=[CUSTODIAL_RELAY_ID]`, `network='testnet-12'`
- `payee_scope`=（见 §4.3 难点）, `max_amount_sompi`/`max_cumulative_sompi`=单笔/累计上限, `valid_until`=有效期
- 未授权维度列留 NULL = 触及即拒（缺维度默认最严）。

### 4.2 tg-bot 侧改造（`console-api.mjs`）
- 钱路端点从「`headers()` 带 `x-ingest-secret` 打 `/api/tg-wallet/:id/send`」改为「构造签名信封 → 打 `/api/capability/wallet/transfer`」。
- tg-bot 需持 app 私钥（env/文件·operator 带外交付），本地构造 + 签名信封（`envelopeSigningMessage` 定义共享）。
- **信封构造 SDK**: 抽 `tg-bot/envelope-sign.mjs`（或共享 lib），封装 nonce 生成 + issued_at/expires_at + intent_digest + `kaspa.signMessage`。
- 只读端点**可保留现状或也迁**（无副作用，优先级低）——先迁钱路面（最大风险）。

### 4.3 🔴 遗留难点（红队/设计必答）: /send 的端到端用户绑定
grant 收窄了「tg-bot 能发什么命令 + 额度」，但**未解**「一人只能转自己钱包」——`custodial_transfer` 的 `tg_user_id`（决定解密哪个托管钱包）仍是 tg-bot 传入的业务数据，对 gate 不透明（`app-envelope.mjs` callerId=service 身份，母卡 §5.1：命令 payload 里端用户标识对 gate 是不透明业务数据，不读不信不转述为身份）。
- **候选 A**: 把 `tg_user_id` 纳入 intent 字段 + payee_scope 绑定？不行——payee 是收款地址维度，tg_user 是钱包属主，语义不同。
- **候选 B**: 托管钱包属主绑定移到 **Console 侧业务鉴权**（不是 M0c-1 gate 职责）——即 `/api/capability/wallet/transfer` handler 或 tg-wallet 逻辑层保留「tg_user_id = Telegram 认证的调用者」不变式（现 tg-wallet.js:91-92 已有此设计意图，但依赖 tg-bot 诚实传 ctx.from.id）。gate 保证「tg-bot 这个 service 只能发限额 transfer」，属主绑定归 Console 业务层。
- **本 v0.1 倾向 B + 显式诚实标注**: M0c-1 gate 解决「共享 secret → 窄 service grant」（场景 A service 越权），**不解决**「tg-bot 内部 tg_user 冒名」（那是 Telegram 侧认证 + Console 业务层职责，另立卡）。红队请裁此边界是否可接受。

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
- **批 G2**: `capability.js` 网关路由 + `handleCapabilityCommand`（wallet/transfer 先行·钱路最大风险面）+ `sendCommandAsync(...,'app')` 唯一铸造点 lint 规则。armed=off 下网关路由存在但 relay gate inert（=现状不 live）。
- **批 G3**: tg-bot 信封签名 SDK + `console-api.mjs` 钱路端点切网关（tg-bot 侧改造）。
- **批 G4**: operator 签发 tg-bot grant（离线）+ 实战 harness（persona 平替真人：tg-bot 带信封走网关→relay→上链，端到端）。
- **批 G5（arm）**: 三前提焊死满足后 armed=on（gate 生效），tg-bot 走 app 面授权。共享 secret 钱路面废除（§4.4 阶段①）。

**armed 前置（authorize.mjs:9 焊死）**: grant/envelope 非 stub（已 true）+ 批 C 迁移收口全标 origin + provision 实。机制A arm 归批 G5，Owner 拍。

---

## 7. 诚实边界 / 待答问题（迎审清单）

1. **§2.4 proxy 公网可达性** — 威胁模型 load-bearing，需实核 reverse proxy 配置（红队）。
2. **§4.3 tg_user 属主绑定** — gate 管 service 越权，不管 tg_user 冒名；边界是否可接受，或需另立 Console 业务层鉴权卡（红队/Bettor 裁）。
3. **durable nonce 重放** — 本卡不实现（M0c-3 接口），expiry 窗口内原样重放不拦（TTL≤1h 收紧）。诚实残留。
4. **faucet 是否走 relay 命令** — faucet 现走 `/api/faucet/request` → FaucetRelay，是否纳入 capability 网关 or 保持独立反刷（faucet 是 fully-public money-path，靠反刷非 auth，母卡 §9 faucet 改判）——待定，倾向 faucet 独立不进 grant。
5. **只读面迁不迁** — 无副作用，优先级低，先迁钱路。
6. **共享 secret 全废时间线** — 依赖 scout/mind/adapter 各自迁移，非本卡范围（本卡只做 tg-bot 样板 + 阶段①）。

---

## 8. 测试计划（骨架·实战 harness DoD）
- 负向: 无信封拒 / 伪签拒 / 未知 grant 拒 / 过期拒 / intent_type 不匹配路由拒 / 注入 origin=internal 被覆写拒 / 超额度拒 / 收款人 ∉ payee_scope 拒 / 网关篡改信封后 relay 重验失败拒 / app 试 provision 拒。
- 正向: 合法信封 + 合法 grant → allow → 上链 txId。
- 实战 harness（G4）: tg-bot persona 真发带信封 transfer 走网关端到端上链（母卡实战 DoD·Owner 每子批实战钉死）。
