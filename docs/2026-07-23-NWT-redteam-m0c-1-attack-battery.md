# M0c-1（caller 身份 + 默认拒绝）红队攻击靶单 — 设计稿的验收基线（前置）

> **Status**: DRAFT（2026-07-23 · NWT）
> **性质**：**adversary 定义的验收门，先于 J2 M0c-1 设计稿**。红队不等设计落地再从零起手——先把"M0c-1 设计必须活过的攻击"钉成清单，J2 照此设计、我照此测。每条 = 可执行负向测试（pass=BUST 攻击被拦 / fail=LANDS 攻击得逞）。设计稿逐条回应即进红队复核。
> **依据**：Codex 5 must-survive notes（`e20fdc82`）+ NWT M-1.2 威胁模型（`f3fde977`，A/B/C 场景 + B-0）+ M-1.6 v0.3.1（`a015d965`，走乙 TCB 声明）。
> **M0c-1 范围**：M0c 七项的①②——**传输边界上非自声明的 caller 身份** + **默认拒绝的命令暴露**。不含 evaluator/scope（M0c-2）、replay/audit/revocation（M0c-3），但设计须为它们留正确接口（见 T-7）。

---

## 走乙前提（每条测试的判定基线，不得混淆）

M0c-1 在走乙路下**只防场景 A（应用/共享 secret/应用间越权/内部误用）**，不防场景 B/B-0（Console=TCB）。故下列测试分两类判定：
- **场景 A 测试**：必须 BUST（M0c-1 落地后应拦住）。
- **场景 B/B-0 测试**：走乙期如实标 LANDS（TCB 残留，R 收口才 BUST）——**设计稿不得把任何场景 A 的 BUST 措辞暗示成"抗 Console"**（Codex note②/我 M-1.6 §1.3 禁用词表）。

---

## 攻击靶单（M0c-1 设计稿必须逐条回应）

| ID | 攻击 | 必须成立的不变量（MUST） | 负向测试 | 走乙判定 |
|---|---|---|---|---|
| **M1-1 自声明身份** | 调用方在 payload/header 里塞 `app_id`/`caller` 自称高权应用 | caller 身份**只能**来自传输边界的不可伪造凭证（能力信封签名验证结果 / 网关连接凭证），**payload 明文自称零权重** | 伪造 app_id 字段发命令 → 断言授权判定不受其影响、按真实凭证判 | 场景 A：必 BUST |
| **M1-2 默认拒绝（未注册 caller）** | 未在 caller 注册表内的调用方发任意命令 | 未知/未注册 caller = **默认拒绝**，非默认放行 | 无凭证/无效凭证/未注册 app 发命令 → 断言 reject（fail-closed） | 场景 A：必 BUST |
| **M1-3 默认拒绝（无 verifier 命令）** | 调用尚无已完成经济效果 verifier 的命令（Codex note① load-bearing） | 无 verifier 的命令**保持 internal**，不进公开契约、已抽离应用不可调（M0b 准入门 + Codex note①） | 已抽离应用（模拟）调无 verifier 命令 → 断言拒绝 | 场景 A：必 BUST |
| **M1-4 身份解析失败 fail-open** | 构造让身份解析器抛异常/超时/返回空的输入 | 身份**解析不出 = 拒绝**，绝不 fall-through 到默认身份/默认放行（同 anti-spam fail-closed 纪律） | 喂畸形凭证/触发解析异常 → 断言拒绝非放行 | 场景 A：必 BUST |
| **M1-5 注册表运行时自注册** | 调用方运行时把自己注册进 caller 表拿权 | caller 注册表**静态可枚举、编译期/启动期可审**，禁运行时动态注册（呼应 M1 §两硬门②） | 运行时尝试新增 caller 条目 → 断言不生效/需离线经审 | 场景 A：必 BUST |
| **M1-6 TOCTOU enforce↔execute** | 身份/授权校验通过后、命令执行前掉包命令内容或身份上下文 | 校验绑定的必须是**同一个被执行的请求**（授权判定先于任何副作用，且判定对象==执行对象，无 swap 窗口） | 校验后执行前篡改 payload → 断言执行的是被校验的那份或整体拒绝 | 场景 A：必 BUST |
| **M1-7 网关旁路（场景 B 分界）** | Console 进程内代码不走 A 网关直接 `import relay-manager` 调 `sendCommandAsync` | （M0c armed + 应用已抽离为独立进程后）独立应用进程无法绕过网关直达 relay | ①Console 进程内直调 → 走乙 **LANDS**（场景 B，TCB 残留）②独立应用进程绕过尝试 → 必 BUST | A:BUST / B:LANDS(如实标) |
| **M1-8 身份即授权的越权错觉** | 已认证 app 用"我是合法 app"直接申请超出其应得的命令集 | **身份 ≠ 授权**——M0c-1 只解决"你是谁"，"你能干什么"是 M0c-2 evaluator；但 M0c-1 默认拒绝必须保证"身份认出≠命令放行"，未经 M0c-2 scope 前默认 deny | 认证 app 调其能力集外命令、M0c-2 未接 → 断言默认拒绝非默认放行 | 场景 A：必 BUST |

## 设计稿必须显式回答的红队问题（非表格，但同为验收门）

- **T-7 接口留正确钩子**：M0c-1 的 caller 身份对象必须能被 M0c-2（scope）/M0c-3（nonce 绑 app-key、audit 绑身份）消费——身份必须携带稳定 app-key-id（供 grant 绑定 Codex note②/replay 绑定 note③/audit 绑定 note④）。设计稿须给出这个身份对象的字段契约，否则 M0c-2/3 无法在其上建 scope/replay/audit = 埋返工。
- **T-8 TCB 诚实边界**：设计稿必须显式写"M0c-1 caller 身份在走乙期防场景 A，不防被攻陷 Console/B-0；身份注册表/凭证签发权在乙期位于 Console TCB 内"（Codex note②/M-1.6 §4.1）。缺此声明或出现任何"抗 Console"暗示 = 红队打回。
- **T-9 与 containment MF6 的接口**：M0c-1 的 caller 身份是"service 身份"（如 tg-bot），**不是端用户 subject**。设计稿须标明 caller 身份层不解决"用户 X 授权本次提款"（那是 containment 卡目标 B / MF6），避免把 service 身份误当用户授权。

## 红队复核判据

J2 M0c-1 设计稿交付后，我逐条核：M1-1~M1-8 每条设计是否给出 BUST 机制（场景 A）或如实标 LANDS（场景 B）+ T-7~T-9 三问是否显式答。**任一场景 A 攻击设计里 LANDS 或 T-8 诚实声明缺失 = RED**。落码后再走实际 diff 审（M0c 碰 relay 授权=money-path，Owner 签发）。

---

**关联**：`docs/2026-07-22-NWT-redteam-m1-2-threat-model.md`（场景 A/B/B-0 母表）、`docs/2026-07-22-m1-6-caller-identity-mechanism-comparison.md` v0.3.1（走乙 TCB 声明 + MF3/MF6）、Codex RED `06d759df` + 复审 notes `e20fdc82`、`docs/2026-07-22-m0c-capability-base-batch-prep.md`（Bettor M0c 骨架）。
