# ADMIN_SECRET 能力级权限拆分设计 v0.2

> **Status**: DRAFT — v1(1fa4e847)break-glass 二步确认设计**已 SUPERSEDED**, 见下方"2026-07-16 v0.2 更新"
> 响应 Owner 终裁(`docs/2026-07-16-owner-ruling-economic-kernel-round2.md` 件⑥ + 七项优先级第⑥项)：
> "status signing / emergency registration / close propose / ZK handoff / ZK close broadcast / debugger dry-run 各自独立；`confirm-by-address` 标记 break-glass：默认关、单独密钥、完整审计、宜第二方确认。"
>
> **🔴 2026-07-16 v0.2 更新(Owner"系统不需要人工、没有人工闸"原则钦定, 走向 A)**: `confirm-by-address` break-glass 通道**彻底移除**, 不是"加固人工闸", 是"连人工闸本身一起砍掉"。移除前验死(KANet-UI 首查+NWT 独立复核+Bettor 独立复核, 三方收敛 GREEN): events 表对该端点 0 命中/pending_actions 表整表 0 行/唯一历史相关案例(7/8 KANetguy 孤儿单)钱包记录 8 天未更新已走默认路径收尾——**此端点自上线从未被实际调用**, 零在途依赖, 移除零风险。落码 commit: `pool.js` 端点移除 + `migrate.js` v186 永久审计记录(admin_confirm_by_address_removed)。原 §2.3 break-glass 二步确认设计(v1, 1fa4e847)因此整体作废, 保留在文档历史里供查, 不再是当前设计。

---

## 一、现状问题(实测, 非猜)

全代码库 `ADMIN_SECRET` 出现在 3 个文件, 共 **6 个能力点**(2026-07-16 起, 原第 3 项 `confirm-by-address` 已移除, 见文档头 v0.2 更新)共享**同一个** `process.env.ADMIN_SECRET` 值。谁知道这一个密钥, 就能同时做以下所有事——从"低风险只读"到"直接触发 covenant 真广播"混在一把钥匙里:

| # | 端点 | 文件:行 | 能力 | 风险等级(本稿评估) | 现有额外防线 |
|---|---|---|---|---|---|
| 1 | `POST /api/admin/coord-status/sign` | coord-status.js:12-19 | 用 relay 私钥签名任意内容(Schnorr, 历史误命名 ecdsa) | **高**(触碰私钥签名操作) | `ADMIN_COORD_STATUS_SIGN_ENABLED` 独立开关+IP allowlist |
| 2 | `POST /api/admin/visibility/:txid` | dev-channel-v1.js:366-374 | 翻转广播消息 internal↔public 可见性 | 低(不动资金/不动状态机, 纯展示层) | 无(仅裸 ADMIN_SECRET) |
| ~~3~~ | ~~`POST /api/admin/pool/register-v07/confirm-by-address`~~ | ~~pool.js:1804-1815~~ | **2026-07-16 已移除**(Owner"不要人工闸"原则, 见文档头) | — | — |
| 4 | `POST /api/admin/pool/propose-close-v2` | pool.js:~1978 | ZK close 门①propose | 中高(状态转换准备, 未广播) | IP allowlist+窄路由默认 OFF |
| 5 | `POST /api/admin/pool/zk-handoff-v2` | pool.js:~1990 | ZK handoff 门① | 中高(同上) | IP allowlist+窄路由默认 OFF, `dryRun` 默认 true |
| 6 | `POST /api/admin/pool/zk-close-v2` | pool.js:~2020 | ZK close 门②**真广播**(covenant money-entry) | **最高**(实际链上资金移动触发点) | IP allowlist+窄路由默认 OFF, 需显式 `dry_run:false` 才真广播(默认走 rehearsal 零广播) |
| 7 | `POST /api/admin/pool/zk-close-gate-debugger` | pool.js:~2116 | 重建 gate witness 跑 debugger, 纯只读不广播 | 低(只读, 复用生产同款构造函数但零链上副作用) | IP allowlist+窄路由默认 OFF |

**发现**: Owner 原文列了 6 项(含 emergency registration), 本稿实测发现 `visibility` 翻转也共享同一把密钥, 之前未被列入——虽然风险最低, 但既然本次是"能力级权限拆分", 应该一并纳入而不是遗漏一个未来复发的口子。emergency registration(`confirm-by-address`)后续被 Owner 判定整体移除, 不再是"6 项要拆分"里的一项。

---

## 二、拆分设计

### 2.1 分级(按本稿风险评估, 2026-07-16 v0.2: 移除 T-BREAK-GLASS 整层)

| 级别 | 定义 | 本次涉及能力 |
|---|---|---|
| ~~T-BREAK-GLASS~~ | ~~绕过正常密码学证明路径, 人工判断代替协议保证~~ | **2026-07-16 整层移除**(唯一成员 confirm-by-address 已删, Owner"不要人工闸"原则) |
| **T-BROADCAST** | 直接触发链上资金移动的真实广播 | ⑥zk-close-v2(真广播分支) |
| **T-SIGN** | 触碰私钥签名操作(即使不直接动钱, 签名本身是高价值动作) | ①coord-status/sign |
| **T-STATE-PREP** | 协议状态转换准备, 未广播(有 dry-run 默认) | ④propose-close-v2, ⑤zk-handoff-v2 |
| **T-READONLY** | 零链上副作用, 纯读/纯展示 | ②visibility, ⑦debugger |

### 2.2 每能力独立密钥(env var 拆分, 2026-07-16 v0.2: 移除 CONFIRM_BY_ADDRESS 相关密钥)

```
ADMIN_SECRET_ZK_CLOSE_BROADCAST   # T-BROADCAST
ADMIN_SECRET_STATUS_SIGN          # T-SIGN
ADMIN_SECRET_ZK_STATE_PREP        # T-STATE-PREP(propose-close-v2 + zk-handoff-v2 共用一把——
                                   #   两者是同一次操作的连续两步①门, 拆两把钥匙对同一操作
                                   #   者没有额外防线价值, 只增加操作摩擦; 但绝不与⑥共用)
ADMIN_SECRET_READONLY             # T-READONLY(visibility + debugger 共用——都是零副作用)
```

不再有单一 `ADMIN_SECRET` 兜底所有端点。每个端点的 header 校验只认自己那把钥匙, 拿 T-READONLY 的密钥去打 zk-close-v2 必须 403。

**迁移期**: 若某把新密钥未设置, 对应端点保持现有"未设=503 disabled"的失败方向(fail-closed 对未配置=禁用, 不是自动 fallback 到旧 `ADMIN_SECRET`——旧变量迁移期允许保留只读兼容一段时间, 但新老不混用同一次请求校验, 避免"设了新的但旧的还生效"这种双活漏洞)。

### 2.3(SUPERSEDED, 保留供历史查阅) `confirm-by-address` Break-Glass 强化设计——v1(1fa4e847)全文, 已被 v0.2 的"整体移除"决策取代

> **不再是当前设计**。以下 v1 内容(含 NWT 红队①发现的 vacuous 问题+ v2 两步两凭证修法)是通道被移除**之前**的最后一版设计, 保留只为记录设计演进过程, 不再指导落码。

<details>
<summary>展开查看 v1 原文(已作废)</summary>

| Owner 要求 | 现状 | 本稿设计动作 |
|---|---|---|
| 默认关 | 已有 `ADMIN_CONFIRM_BY_ADDRESS_ENABLED` 默认 OFF | 维持, 不变 |
| 单独密钥 | 现与其它 6 个共用 `ADMIN_SECRET` | 换成 `ADMIN_SECRET_CONFIRM_BY_ADDRESS`(§2.2) |
| 完整审计 | 已写 events 表(pool.js 注释确认) | 核实审计字段是否包含"谁触发+审批链依据"(txid/NWT 复核结论), 若缺补 |
| 宜第二方确认 | **当前无**——代码注释写"由知道 ADMIN_SECRET 的人自律执行", 不是机制强制 | 见下方(v1 设计已被 NWT 判定"牙没装上", 已重做) |

**🔴 v1 设计缺陷(NWT 红队①发现, 已修订)**: 最初版本要求 body 携带 `second_party_confirmation: { reviewer, note }` 字段, 缺失 400 拒绝——但 `reviewer` 是自由文本, **发起人自己就能在同一次请求里填一个名字进去, 没有任何独立凭证证明这个"第二方"真的看过**。这是"有校验动作但校验的东西是自报的"经典 vacuous 模式(同族: 本项目今天已记录的 hash-commit 静默剥除未知字段/共享 env 常量致"独立"路径吻合两例)。

**v2 设计(两步两凭证, maker-checker 模式)**:
1. **发起**: `POST /api/admin/pool/register-v07/confirm-by-address`(用 `ADMIN_SECRET_CONFIRM_BY_ADDRESS`)——不立即执行, 写入 `pending_break_glass_actions` 表(状态 `pending_review`), 返回 `confirmation_id`。
2. **批准**: `POST /api/admin/pool/confirm-by-address/:confirmation_id/approve`(**用另一把独立密钥** `ADMIN_SECRET_CONFIRM_BY_ADDRESS_REVIEWER`, 与发起密钥物理不同——第二方的身份证明就是"持有这把只有他知道的钥匙", 不是自报文本)——校验通过后才真正执行原逻辑(txid:output 精确匹配+写库)。
3. 两把密钥必须分给两个不同的人持有(运营纪律, 代码强制不了"谁拿到密钥", 但**代码强制"必须两次不同凭证的请求"**这个结构本身, 比自由文本 reviewer 字段是真实的两人控制)。
4. `pending_review` 状态超时(如 24h)未获批准则自动过期, 不遗留悬空的待执行动作。

</details>

**T-BROADCAST 是否需要第二方确认(2026-07-16 Owner 已裁定)**: Owner 原则钦定"系统不需要人工、没有人工闸"+ Bettor 把它当原则贯彻("系统正常钱路全自治零人工")——`zk-close-v2` 真广播分支**不加**第二方确认, 与移除 break-glass 通道是同一个原则的两个应用, 不再是待定项。

---

## 三、NWT 红队①结论(2026-07-16, 已折入 §2.3)+ 剩余待 Owner/落码前定的问题

1. ~~T-STATE-PREP 两端点共用一把钥匙是否合理~~ → **NWT 已核: 合理, 不拆**(同一操作者连续两步, 拆开无额外防线价值)。
2. **迁移期**: NWT 建议给死线 + 新增 lint 规则 `R-ADMIN-SECRET-LEGACY`(死线后旧变量若仍生效, 拦截), 同今天新增的 `R-SELF-HTTP-FETCH` 同款思路(机制防呆而非只靠自觉)——**采纳, 落码时一并加**。
3. ~~reviewer 身份绑定~~ → **不再适用**(confirm-by-address 通道整体移除, §2.3 v2 设计随之作废, 见文档头 v0.2 更新)。
4. **IP allowlist 现状核实**: NWT 建议本次一起做, 不要分两次改同一批端点的权限面——**采纳**, 落码前逐端点核实 allowlist 配置是否齐全(本稿尚未做, 落码 diff 需覆盖)。
5. ~~T-BROADCAST 是否补同款两步确认~~ → **Owner 已裁定: 不补**(§2.3 末尾, "系统不需要人工"原则统一应用)。

---

## 四、不做什么(本稿边界)

- 不改任何现有端点的业务逻辑(propose-close-v2/zk-handoff-v2/zk-close-v2 的构造/广播代码零改动)。
- 不涉及 relay 私钥本身的存储/加密方式, 只涉及"谁能调用触发签名/广播的 HTTP 端点"这层权限。
- 落码顺序: 本设计稿→NWT 红队→(若需要)第二方确认字段的身份绑定单独设计→落码→装载。
