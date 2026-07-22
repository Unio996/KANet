# M-1.6 Caller 身份机制三案对比 — NWT 红队 verdict

> **Status**: DRAFT（2026-07-22 · NWT）
> **审对象**：`docs/2026-07-22-m1-6-caller-identity-mechanism-comparison.md`（J2，commit `5270f6c0`）
> **立场**：红队默认 refute。三案对比的现状拓扑（§0）与 M-1.1/M-1.6 坐实一致，本卡不复述；只打**推荐结论（A+C 组合）**。
> **verdict**：**GREEN-with-1-MUST-FIX** — 推荐方向对，但 A+C 组合**如当前写法对威胁场景 B（被攻陷 Console worker）是 vacuous**，须补一条决定性约束才成立。这条约束正是 M-1.2 场景 B + containment 卡"防换名共享 secret"二审条件的同一根问题。

---

## 试过的攻击（红队挣 PASS 的过程）

**攻击 1（打穿 A）**：拿到合法 app 身份后申请超出 scope 的操作。→ **A 单独挡不住，但 C 的 scope 校验挡得住**。J2 自己已列此弱点（§1 弱点 + §3 结论），A+C 叠加正确。**此路不通，PASS 这一面。**

**攻击 2（打穿 A+C，命中场景 B）——打穿了**：
被攻陷的 Console 进程内模块**不走 HTTP 能力网关**，直接 `import relay-manager.js` 调 `sendCommandAsync(anyRelayId, cmd)`（relay-manager.js:277，J2 §0 line 14 亲自坐实"进程内任意代码零区分调用来源"）。HTTP 网关（方案 A）是 console fastify 路由，**在同一进程内可被绕过** = 对场景 B 零防御。J2 自己在 §1 弱点写了"Console 被攻陷则网关形同虚设"，但随后用方案 C 声称补上授权——**问题在 C 的验证发生在哪、签名权在谁手里**：

- J2 §3 原文：签封"**签发者可以是 Console 自己**"，验证"**relay 侧（或 Console 侧网关）**新增信封验证"。
- **这个"或"承重整座防线，且默认读法是 vacuous 的**：若信封**签发权在 Console + 验证在 Console**，则被攻陷的 Console 既能伪造合法信封、又是验证者自己 → C 退化成"攻击者给自己签放行条自己盖章"。对场景 B 与直接调 sendCommandAsync 无差别（memory: vacuous-teeth / verify-value-source——checker 与被验对象同处攻击者可控域 = 空验证）。

**攻击 2 的结论**：A+C 组合**只在同时满足**下面两条时才对场景 B 成立，缺一即 vacuous：
1. **验证 locus = relay 进程内**（relay 执行命令前验信封），不是 Console 内 evaluator——因为 relay 是被攻陷 Console 碰不到内存的独立进程（T-1：IPC 只连父进程，但 relay 自己的校验代码不在 Console 地址空间）。
2. **签名权 = 各 app 自持的独立能力凭证**（一次性 provision / 离线颁发），**不是 Console 持有的共享签发密钥**——否则被攻陷 Console 直接签任意 app 的信封。被攻陷 Console 至多能**重放**它观测到的合法信封（受 nonce+过期上界约束，M0c⑤兜底），无法伪造新 scope。

## MUST-FIX（1 条）

M-1.6 §3/§4 必须把"签发者可以是 Console 自己""relay 侧或 Console 侧验证"这两处 vacuous 表述**收敛为单一非空配置**：
- **验证在 relay 进程内**（命令执行前，fail-closed）；
- **签名权是 app 自持凭证**，Console 不持全量签发密钥（Console 被攻陷 ⇒ 最多重放不伪造）。

否则推荐结论应降级为"A+C 仅防场景 A（外部/持共享 secret 应用），对场景 B 需另配 relay 侧验证 + app 自持凭证才成立"——不能笼统写"A+C 满足 M0c 七项"。

## 与 containment 卡二审的收敛（同一根问题）

Bettor 已编排 containment 卡目标 B 凭证形态"与 C 案信封同机制收敛不另造第二套凭证"（ledger 13:56）。**红队并轨条件**：这个"同一套凭证"必须是**上面 MUST-FIX 定义的 app 自持 + relay 验证**版本，**不能是"换个名字的共享 secret"**（我持的二审硬条件）。若 C 案信封退化成 Console 持有的共享签发密钥，则 containment 卡即便命名对了（Codex RED-3 的目标 A vs B），底层仍是共享 secret 换皮 = 目标 B（真实用户/app subject 授权）依然 vacuous。**两卡共用同一凭证 ⇒ 同一 MUST-FIX 同时管住两处**，这是收敛的价值，也是收敛的风险（一处偷懒两处塌）。

## PASS 的部分（挣来的，非顺水）

- 方案 B（per-app socket）被 J2 以"改动面最大"排除作**传输层**选型——红队补一句权衡：B 是三案里**唯一在传输层结构性绑定身份、不依赖任何一方老实自报**的，也就是唯一天然抗场景 B 的传输层方案。J2 §2 优点"理论上最难被绕过"没错但轻描淡写了它对最高危场景的独特价值。**不翻案排除 B**（最小改动是 Owner 给的筛选标准，且 A+C 满足 MUST-FIX 后同样抗 B），但 Owner 终选时应知道：A+C 抗场景 B 靠的是"relay 验证 + app 凭证"这层纪律，B 靠的是传输层物理隔离——前者依赖实现不偷懒，后者结构保证。这是 Owner 该看到的真实 trade-off，不是改动量单维度。
- payload 明文 app_id 不可接受这条 J2 处理正确（身份是验证结果非自称字段）——PASS。

---

**关联**：`docs/2026-07-22-NWT-redteam-m1-2-threat-model.md`（场景 B / M0c 对照矩阵）、`docs/2026-07-23-custodial-transfer-subject-binding-containment-card.md`（二审并轨）、`docs/2026-07-22-m1-6-caller-identity-mechanism-comparison.md`（审对象）。
