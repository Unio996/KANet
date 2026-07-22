# operator-scoped 结算专道设计稿 — NWT 红队 verdict

> **Status**: DRAFT（2026-07-23 · NWT）
> **审对象**：`docs/2026-07-23-m0c-1-operator-settle-lane-design.md`（J2，commit `10775c4f`）——relay.js:1726 收敛 A 方案的 money-path 出口，新钱路组件，gate-arming 硬前置。
> **立场**：红队默认 refute。这是**钱路组件**，我尤其查它有没有在"operator-scoped"外壳下把刚收敛掉的宽 money-path 面又放回来。
> **verdict**：**GREEN-with-2-note**。头号判据（auth 真排除场景A）**满足**——`ADMIN_SECRET_OPERATOR_SETTLE` 独立 operator 密钥、非共享 ingest secret、diff 审核不同源不派生。诚实 TCB 边界/gate-arming 前置/审计绑 operator 身份都对。2 note：①白名单**命令过宽**（含 generic transfer/ecdsa_sign，最小权限该收窄 WHAT 不只 WHO）②白名单只到命令类型、无 intra-command scope（金额/收款人），乙-可接受但须诚实标+post-R。

---

## 头号判据满足（挣的 GREEN）

**auth 真排除场景A**（批1 决定性条件）：§2.4 直接答——`ADMIN_SECRET_OPERATOR_SETTLE` 是独立 operator 密钥，**不是** 11 组件共用的共享 ingest secret（tg-bot=场景A 持 ingest、不持 OPERATOR_SETTLE），operator 专有不下发应用；落码 diff 审须核"与 KANET_INGEST_SECRET 不同源不复用不派生，同值/派生即打回"。这正是我收口判据"money-path 路径真排除场景A，共享 secret 不算"。**打不穿这一面**：场景A app 无 OPERATOR_SETTLE 凭证够不到专道 + money-path 已移出 relay.js:1726 宽端点（§3）= money-path 面对场景A 彻底关闭。✅

其余核过打不穿：
- **origin='operator' 第四值**：由专道（Console 代码，auth 过后）设置，场景A 无路径设它（够不到专道+够不到 IPC）；场景B 可伪造=乙已承认 TCB 残留，非新洞。审计区分 operator vs internal daemon = 好。✅
- **诚实边界（§7）**：明标 auth 宿主在 Console 域=乙 TCB，对场景A 有效、对场景B（读 env 拿 ADMIN_SECRET）无效，禁称防 Console，R 收口移出。与 M0c-1 §1 一致，不 overclaim。✅
- **gate-arming 前置（§5）**：专道到位 = checklist 前置，未到位 gate 不 armed。✅
- **env 默认 off + IP allowlist localhost + 审计不记 secret 值**：镜像 zk-close-v2 现成模式，纵深合理。✅

## note-1（should-address）：白名单命令过宽——最小权限该收窄 WHAT，不只 WHO

§2.2 白名单含 `transfer` + `ecdsa_sign` 两条 **generic 最强原语**：`transfer`=转任意金额到任意地址；`ecdsa_sign`=签任意字节。**收敛 A 的目的是把 money-path 面收窄**（从"任意命令裸透传"收到"operator 手动结算需要的那几个"），但白名单若含 generic transfer/ecdsa_sign，则**专道对 operator 又是近乎任意 money-path 原语**（只是 operator-gated）——WHO 收窄了（operator only），WHAT 没收窄（还是能转任意款/签任意字节）。这半个 defeat 了收敛的窄化初衷。

**要求**：白名单**逐条 justify against 实际 operator 手动结算需求**（从 grep 坐实的 scratch 用法推）。covenant-specific 命令（sign_input_for_settle/close_attest/payout_claim/sweep_per_bet/consolidate）有明确结算语义、保留合理；但 **generic `transfer`/`ecdsa_sign` 必须单独论证"operator 手动结算真的需要它俩"**——若只是历史 scratch 顺手用过、不是结算刚需，应从白名单剔除（收窄 WHAT）；若确需（如事故恢复手动移资），则标为**白名单里最高危两条**，考虑更高 gate（如二人复核/额外确认因子/更严 tier）而非与 covenant 命令同档放行。乙路 operator=TCB 使这不是 hard 洞，但"最小权限"是收敛的题中之义——收窄 WHO 后不把 WHAT 又开全。

## note-2（乙-可接受但须标）：白名单只到命令类型，无 intra-command scope

白名单判的是**命令类型**（能不能发 sign_input_for_settle），不判**命令内容**（sign 哪个 input / transfer 多少到谁）。所以专道对白名单内命令**无金额/收款人/outpoint 限制**——operator（或持 ADMIN_SECRET 者）可无界移资。乙路 operator=TCB 使其可接受（operator 受信），但须**诚实标注**：专道提供命令类型白名单、不提供 intra-command scope；scope 限制（金额/收款人上限）是 M0c-2/后续。**post-R**：R 收口 operator 身份走可验证凭证时，operator money-path 也应获 scope 限制（记 R 卡族，同 §7 R 升级）。这条只要写清边界即可，不阻塞。

## 落码 diff 审我会核的（verdict 过≠落码放行）

- **头号判据的 diff 核**：`ADMIN_SECRET_OPERATOR_SETTLE` 与 `KANET_INGEST_SECRET` 不同源/不复用/不派生（§2.4）；且复用的 `checkAdminSecretTier` 用的**这个 tier 是 operator-exclusive**，不是已被某 app-facing 路径共用的 tier（tier 隔离性 diff 核）。
- note-1 收窄后的白名单最终集 + generic transfer/ecdsa_sign 的处置（剔除 or 高 gate）。
- origin='operator' 接入 M0c-1 gate（批3）的四值分支：operator 分支只放行白名单内命令，缺失/非法仍 fail-closed。
- §6 负向测试 6 条 + 实战 harness 真发（场景A 打专道拒/白名单外拒/env off 503/非 localhost 拒/端点 money-path 白名单拒/合法 operator 真放行）。

## 判据

GREEN-with-2-note：头号判据满足，专道方向成立，可**连 note 进修订**送 Bettor 方向审 + Owner 专道 money-path 签发。note-1（白名单收窄/generic 命令处置）建议修订版收，note-2 写清边界即可。**落码后我 diff 审（头号判据 diff 核 + 白名单最终集 + origin 四值分支）+ 实战 harness 主跑**，两道过才算专道闭、才够 gate-arming 前置。

**关联**：`docs/2026-07-23-m0c-1-operator-settle-lane-design.md`（审对象）、`docs/2026-07-23-m0c-1-caller-identity-default-deny-design.md`（母卡 §4.0/§4.3）、`docs/2026-07-23-NWT-redteam-m0c-1-attack-battery.md`（靶单+harness）。
