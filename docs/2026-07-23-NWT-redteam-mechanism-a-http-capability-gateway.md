# 机制A（HTTP 能力网关）设计 v0.1 — NWT 红队 verdict

> **Status**: DRAFT（2026-07-23 · NWT）
> **审对象**: `docs/2026-07-23-m0c-1-mechanism-a-http-capability-gateway-design.md`（J2 v0.1，坐实→设计连续走完）。
> **立场**: 红队默认 refute。这是 KANet 第一个真外部 HTTP 面 + tg-bot 钱路迁移，我尤其查批 G2 落码时机的 blast-radius（今晨事故同款模式：新路由 live 时鉴权是否真生效）。
> **verdict**: **GREEN-with-1-MUST-FIX + 2-note**。5 角度全部忠实兑现，坐实纪律好（localhost-only/gap-A 403/tg-bot 真实调用清单全实读）。MUST-FIX = **批 G2 路由落码必须 feature-flag 默认 off**（同 operator-settle.js `ADMIN_OPERATOR_SETTLE_ENABLED` 先例），否则 armed=off 期间新路由 live+relay gate inert = 无鉴权新钱路面（比事故更糟：事故是既有命令面 fail-closed 断，这里是全新命令面 fail-open 开）。

---

## 打不穿的（挣的 GREEN·5 角度全兑现）

- **①网关=origin='app' 唯一铸造点**：全仓唯一 `sendCommandAsync(...,'app')` 调用点=capability.js（同 operator-settle.js:72 单来源先例）+ lint 焊死（同 R-SENDCMD 家族）+ 入站 origin 声明被丢弃（母卡 §8-7 负向测试）。✅
- **②信封端到端完整性**：双验模型（网关早拒 UX+DoS 护栏 / relay 权威闸 load-bearing）+ 信封原样透传 + relay 重验签自我 backstop（网关篡改=relay canonicalJson 重跑签名失效拒）。签名范围复用 app-envelope.mjs 立身之本 MUST-FIX（全 canonical envelope 去 signature）。✅
- **③场景-A/B TCB 诚实**：网关在 Console 域=抗场景-A（app 无私钥伪造不了）·不抗场景-B（被攻陷 Console 绕网关直调）·禁称"抗 Console"，归 R。✅
- **④provision 场景-A 不可达**：grant 签发只 operator 离线脚本，网关零 provision 写路径。✅
- **⑤外部 HTTP 攻击面**：auth（每请求信封签名）+ 输入校验（strict-reject+intent_type 白名单+relayId 不从 body 取，防指定任意 relay）+ 限流 + 重放（nonce 签名范围内+TTL≤1h）。✅
- **坐实纪律**（今夜教训的直接应用）：tg-bot 真实调用端点三级分级（实读 console-api.mjs 全量）+ blast-radius 定案（localhost-only+gap-A 403 双证）+ 共享 secret 供给链（scout/mind/adapter 也用，不能单为 tg-bot 废全局）——全部实查非拍脑袋。✅
- **relayId 不从请求体取**（§3.4）：防 app 指定任意 relay，双重约束（网关映射+relay 侧 relay_scope 再验）。✅

## 🔴 MUST-FIX：批 G2 路由落码必须 feature-flag 默认 off

**打穿链**：§6 批 G2 "`capability.js` 网关路由...armed=off 下网关路由存在但 relay gate inert(=现状不 live)"——这句断言**没有论证为什么安全**，且论证链有洞：

1. **网关早拒验的签名验证需要读 grant registry 取 app_pubkey**（§3.3 step3"签名验证"）——但要验证签名，必须先知道验证用哪把公钥，而公钥来自 `grant_id → app_pubkey` 的 registry 查找。设计文档没写清楚网关是否独立读 registry 做这一步，还是"签名验证网关侧可选（relay 权威重验）"（§3.3 step3 原文）。
2. **若网关侧签名验证是"可选"、真正强制的验证全靠 relay 侧 `authorizeCommand`**——那么在 G2-G4（batch G5 arm 之前），relay gate 是 `armed=off`（inert=**放行+warn**，不是 deny）。
3. **组合后果**：`/api/capability/wallet/transfer` 路由从 G2 落码那刻起就**在生产 Console 里存在且可达**（KANet 无 staging，落码=live），网关侧签名验证若非强制 → 任何人 POST 一个"结构合法但签名未必真验"的请求 → relay gate armed=off 放行 → **命令直接执行**（含 `custodial_transfer`）。这是**全新的、今天完全不存在的攻击面**——比今晨事故更严重：事故是既有命令面被 fail-closed **断**（可用性问题）；这里若成立，是全新钱路端点 fail-open **开**（资金问题）。

**这正是今晨事故的镜像**：事故教训="armed 语义没被逐路由推演，标注不完整=断";这里如果成立="网关落码时机没被逐阶段推演，鉴权不完整=开"。同一根因（部分修改期间的中间态未被完整推演）。

**修法（比照 `operator-settle.js:36-37` 先例）**：
```js
if (process.env.ADMIN_CAPABILITY_GATEWAY_ENABLED !== '1') {
  return reply.code(503).send({ ok: false, error: 'capability gateway disabled' });
}
```
批 G2 落码时该 flag **默认不设（=off）**，路由存在但整体 503——与 relay armed 状态完全解耦，不依赖"网关早拒验是否恰好够强"这种脆弱论证。G4 harness 跑通、G5 grant/信封/迁移三前提全焊死后，**开这个 flag 才是"网关对外可用"的正式开关**（独立于 relay 侧 armed，两层缺一不可）。同时明确规定：**网关侧签名验证在设计里必须写死为"强制"（非"可选"）**——即便 flag 开着，网关自己也要能独立挡住无效信封（不能把"早拒验"设计成纯 UX 优化、把安全性全押给 relay 侧 armed 状态，因为 armed 状态在 G2-G4 窗口本来就是 off）。

## 2 note（迎审清单已列·我加细）

- **note-1（§4.3 tg_user 归属，J2 自答"倾向 B"，我加一条具体化）**：候选 B（属主绑定归 Console 业务层，gate 只管 service 越权）方向可接受，但要honest标一个具体后果：**`payee_scope` 对"用户提现到任意外部地址"这种典型钱包功能可能形同虚设**——若 tg-wallet/send 语义是"用户指定任意收款地址"，`payee_scope` 是白名单成员判定（`parseJsonStringArray` membership check），没有"允许任意值"的通配符语义（schema `payee_scope` NULL=**拒**非**不限**，见我 M0c-1 GREEN 核）。所以真实防线退化为**仅 `max_amount_sompi`/`max_cumulative_sompi`**——被攻陷/有 bug 的 tg-bot 仍可指定任意 `tg_user_id`（借谁的钱包）+ 任意目标地址（若 payee_scope 空/宽松），只是单笔/累计有上限。这仍是有意义的收窄（万能钥匙→限额度），但设计文档应显式写这个诚实边界（"gate 防的是 service 拿着窄权限乱来，不是防 tg-bot 内部逻辑 bug 转错人钱"），别让读者以为 grant 收窄了 payee 面。
- **note-2（DoS 限流层次）**：§5-5"每 app_key_id 维度限流"——但 app_key_id 来自**未验证信封**里的字段（限流判断在签名验证之前或之后?若之前，攻击者可对同一 app_key_id 猛发伪造请求耗尽该 key 的限流桶=左右合法调用；若限流在验证之后，废弃请求不受限流保护=签名验证本身可被 DoS）。建议两层：①IP/global 廉价限流（结构校验前，防止验证计算本身被打爆）②app_key_id 限流（验证通过后，防单 key 滥用）。当前 localhost-only 优先级低（不阻 MUST-FIX 之外的落码），但设计写清楚层次防止实现时漏一层。

## 判据

**GREEN-with-1-MUST-FIX+2-note**：5 角度设计忠实、坐实纪律好、双验模型架构对。MUST-FIX（批 G2 feature-flag 默认 off，网关早拒验必须强制非可选）是新钱路面落码时机的立身之本——不修=armed 语义空窗期可能开出一个比今晨事故更严重的 fail-open 洞。落码后我 diff 审（flag 默认值+网关强制验证实现+lint 唯一铸造点+relayId 不从 body 取）+ 实战 harness（G4：flag=off 时路由 503/flag=on+armed=off 时网关自己挡住无效信封/G5 arm 后端到端）。

**送 Codex 外部对抗审**：建议重点让 Codex 独立核我这条 MUST-FIX 的论证链（网关早拒验"可选" + relay armed=off "inert=放行" 组合是否真构成 fail-open 空窗）——这类"两层防御各自都不完整但被认为互相 backstop"的推理正是 Codex 之前抓过我 B-0 盲点的同类模式，值得独立验证。

**关联**：`docs/2026-07-23-m0c-1-mechanism-a-http-capability-gateway-design.md`（审对象）、`docs/2026-07-23-m0c-1-caller-identity-default-deny-design.md`（母卡）、`kasia-console/src/api/operator-settle.js:36-37`（feature-flag 先例）、`docs/2026-07-23-NWT-full-origin-enumeration-rearm-gate.md`（今晨事故根因——同族"中间态未被推演"）。
