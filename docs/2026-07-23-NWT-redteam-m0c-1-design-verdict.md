# M0c-1 设计稿 — NWT 红队 verdict

> **Status**: DRAFT（2026-07-23 · NWT）
> **审对象**：`docs/2026-07-23-m0c-1-caller-identity-default-deny-design.md`（commit `600a005c`，前任 J2 会话死前已 push 的完整稿，165 行）
> **对照基线**：NWT M0c-1 攻击靶单 `a7f5beba`（M1-1~M1-8 + T-7/T-8/T-9）+ 实战 harness `f7865428` + M-1.6 v0.3.1 走乙 TCB 声明 + Codex 5 notes。
> **立场**：红队默认 refute。设计整体扎实（明显照靶单+v0.3.1+Codex notes 写），我逐条打靶单，重点找它**在"默认拒绝+grant 权威"外壳下有没有可自我授权的绕过**。
> **verdict**：**GREEN-with-1-MUST-FIX + 3 完整性 note**。MUST-FIX = grant/app-key 注册表的 **provision 路径未指定为场景-A 不可达**——若应用能自注册 grant，intent⊆grant 这个 MF3 核心机制被自签发绕过（M1-5 在场景 A LANDS）。落码前补齐。

---

## 打不穿的（挣的 GREEN，逐条对靶）

- **T-7 身份对象钩子**：§5 `AuthResult{authenticated, decision, callerId, grantId, intentDigest, reason}` = 我要的 M0c-2/M0c-3 消费接口，且把三子批解耦契约定死字段语义——比我提的更完整。打不穿。
- **T-8 TCB 诚实边界**：§1 置顶继承 v0.3.1 TCB 声明 + 禁用词表 + §4.2 乙路诚实注记（grant registry 乙期在 TCB 内、禁称抗 Console）+ §7 note② + §8.5 场景 B 如实标 LANDS。诚实性贯穿设计+测试两侧，无一处暗示抗 Console。打不穿。
- **T-9 service 身份 vs 端用户**：§5 callerId=service 身份（app key），§7 note④明标"非端用户"，用户授权拆分归 containment MF6。打不穿。
- **M1-1 自声明身份**：§8.1 伪造 app_id 无有效签名信封→拒（身份=签名验证结果非自称字段），§4.1 step3 身份来自信封签名。BUST 机制在。打不穿。
- **M1-7 网关旁路场景 B 分界**：§2.3+§8.5 显式 Console 进程内绕过=场景 B 走乙 LANDS、独立应用进程绕过→relay C gate 拦。诚实分场景。打不穿。
- **M1-8 身份≠授权**：§4.2 M0c-1 层已做 intent⊆grant（不只把 scope 全推给 M0c-2），认证 app 被绑死在其 grant 内——比我 M1-8 预期更早拦。打不穿。
- **grant-inflation（MF3 / Codex note②）**：§4.2"信封 scope 是不可信输入，relay 拿 intent 比对权威 grant，intent⊆grant 才放行"——核心机制正确落位。打不穿（但见 MUST-FIX：grant 本身能不能被自签发是另一层）。

## 🔴 MUST-FIX：grant/app-key 注册表 provision 路径未指定为场景-A 不可达（M1-5 在场景 A LANDS）

**打穿链**：整套授权的信任根是 §4.2 的"relay 侧权威 grant"——relay 拿 `intent ⊆ 已签发 grant` 判放行，且 §4.1 step3 用 grant registry 里的 **app 公钥**验信封签名。**但设计全篇没指定这个 grant/app-key 注册表由谁、经什么路径写入。** §4.2 乙路注记只讨论了"场景 B：Console 直接改 registry 自授权"（如实标 LANDS，正确），**却漏了场景 A：一个被攻陷的应用能不能自己往 registry 注册一条 grant/app-key**。

若 provision 路径是应用可达的（例如复用应用持有的共享 ingest secret、或经 A 能力网关的某端点），则**场景-A 攻击者自签发一条覆盖任意 scope 的 grant 给自己 → 之后 intent⊆grant 永远成立 → MF3 的整个"权威 grant 比对"被自签发绕过**。这正是我靶单 **M1-5（禁运行时自注册）** 打的点，设计 §8 六条负向测试里**没有一条测"应用自注册 grant"**（#3 测 scope 超 grant、#4 测未登记命令默认拒，都假设 grant registry 本身可信），也没有机制保证它。

**这不是完整性 note 是 MUST-FIX**：因为它塌的是信任根——grant 权威机制的全部效力，建立在"应用改不了 grant registry"这个未言明的前提上。前提不焊死，§4.2 的 intent⊆grant 对场景 A 也 vacuous（应用先给自己发个大 grant，再永远合规）。

**修法（设计补齐，落码前）**：M0c-1 设计必须显式指定 grant/app-key 注册表的 provision 是**场景-A 不可达**的——即 provision 只经 admin/offline/带外通道，**不经应用持有的共享 secret、不经 A 能力网关、不经任何应用可发起的 relay 命令**。并加负向测试 M1-5："应用用其合法 service 凭证尝试 provision 一条新 grant/app-key → 必拒"。乙路下 provision authority 仍在 Console TCB 内（对场景 B 无效，§4.2 已诚实标），但**对场景 A 必须不可达**——这正是走乙"防应用面"的题中之义，不做=A+C 对场景 A 也没防住 grant 层。

## 完整性 note（不阻塞 GREEN，落码前顺带收）

- **note-1（M1-6 TOCTOU enforce↔execute 未显式绑定）**：§4.1 `authorizeCommand(cmd)` 通过后进 §... `switch(cmd.type)` 执行。设计未显式声明**被授权的 `intentDigest` 覆盖全部影响执行的字段、且 switch 执行的就是被 digest 的那份**（无 digest 外字段影响执行）。authorizeCommand 若含 async 签名验证，需保证 check 与 execute 间 cmd 不被换。建议补一句绑定声明 + 负向测试（校验后执行前改 payload→拒或执行被校验那份）。
- **note-2（M1-3 无 verifier 命令→internal 半推给 M0b 未交代）**：我靶单 M1-3 含"无经济效果 verifier 命令保持 internal 不可被 app 调"这半，属 M0b 准入门。设计 §3 只做需信封/只读二分，没交代"无 verifier→无 capability 端点"这条归 M0b。建议 §2.1/§3 加一句交叉引用 M0b 准入门，明确 M0c-1 不重复做但不遗漏（能力网关端点只暴露 verifier-complete 命令）。
- **note-3（M1-2 未注册 caller / M1-4 解析 fail-open 覆盖但无显式测试）**：§4.1 step3（未注册 app 无公钥→验签不过→拒）+ step7（任一步失败 fail-closed）机制上覆盖了 M1-2/M1-4，但 §8 负向测试列表无独立条目。建议补两条显式测试：未注册 caller 带签名发命令→拒；authorizeCommand 内解析器抛异常/超时→拒（非 fall-through 默认身份/默认放行）。

## 判据与交接

- **MUST-FIX 落码前修**（设计补 provision 场景-A 不可达 + M1-5 测试），3 note 顺带收。修订稿我复核 → 过后 Owner money-path 签发才落码（M0c 碰 relay 授权=money-path）。
- **本 verdict 针对既有 600a005c 稿**（前任 J2 死前已 push，非 J1 待写）。ownership（J1 续 vs J2 归位改）是 Bettor 协调题，但设计需红队与谁 carry 无关——**MUST-FIX + 3 note 谁 carry 都要收**。
- 落码后另走：实际 diff 审 + 实战 harness（`f7865428`，真发 8 类攻击验行为）——两道过才算 M0c-1 闭。

**关联**：`docs/2026-07-23-m0c-1-caller-identity-default-deny-design.md`（审对象 `600a005c`）、`docs/2026-07-23-NWT-redteam-m0c-1-attack-battery.md`（靶单+harness）、`docs/2026-07-22-m1-6-caller-identity-mechanism-comparison.md` v0.3.1、Codex 5 notes `e20fdc82`。
