# ADMIN_SECRET 能力级权限拆分设计 v0.1

> **Status**: DRAFT — 待 NWT 安全审
> 响应 Owner 终裁(`docs/2026-07-16-owner-ruling-economic-kernel-round2.md` 件⑥ + 七项优先级第⑥项)：
> "status signing / emergency registration / close propose / ZK handoff / ZK close broadcast / debugger dry-run 各自独立；`confirm-by-address` 标记 break-glass：默认关、单独密钥、完整审计、宜第二方确认。"

---

## 一、现状问题(实测, 非猜)

全代码库 `ADMIN_SECRET` 出现在 3 个文件, 共 **7 个能力点**共享**同一个** `process.env.ADMIN_SECRET` 值。谁知道这一个密钥, 就能同时做以下所有事——从"低风险只读"到"直接触发 covenant 真广播"混在一把钥匙里:

| # | 端点 | 文件:行 | 能力 | 风险等级(本稿评估) | 现有额外防线 |
|---|---|---|---|---|---|
| 1 | `POST /api/admin/coord-status/sign` | coord-status.js:12-19 | 用 relay 私钥签名任意内容(Schnorr, 历史误命名 ecdsa) | **高**(触碰私钥签名操作) | `ADMIN_COORD_STATUS_SIGN_ENABLED` 独立开关+IP allowlist |
| 2 | `POST /api/admin/visibility/:txid` | dev-channel-v1.js:366-374 | 翻转广播消息 internal↔public 可见性 | 低(不动资金/不动状态机, 纯展示层) | 无(仅裸 ADMIN_SECRET) |
| 3 | `POST /api/admin/pool/register-v07/confirm-by-address` | pool.js:1804-1815 | 人工核实(txid,address,amount)三元组直接登记押注, 跳过 prep/confirm 密码学证明 | **最高**(信任模型让步——人工判断代替密码学证明, 直接写入协议状态) | `ADMIN_CONFIRM_BY_ADDRESS_ENABLED` 独立开关, 默认 OFF |
| 4 | `POST /api/admin/pool/propose-close-v2` | pool.js:~1978 | ZK close 门①propose | 中高(状态转换准备, 未广播) | IP allowlist+窄路由默认 OFF |
| 5 | `POST /api/admin/pool/zk-handoff-v2` | pool.js:~1990 | ZK handoff 门① | 中高(同上) | IP allowlist+窄路由默认 OFF, `dryRun` 默认 true |
| 6 | `POST /api/admin/pool/zk-close-v2` | pool.js:~2020 | ZK close 门②**真广播**(covenant money-entry) | **最高**(实际链上资金移动触发点) | IP allowlist+窄路由默认 OFF, 需显式 `dry_run:false` 才真广播(默认走 rehearsal 零广播) |
| 7 | `POST /api/admin/pool/zk-close-gate-debugger` | pool.js:~2116 | 重建 gate witness 跑 debugger, 纯只读不广播 | 低(只读, 复用生产同款构造函数但零链上副作用) | IP allowlist+窄路由默认 OFF |

**发现**: Owner 原文列了 6 项, 本稿实测发现第 7 项(`visibility` 翻转)也共享同一把密钥, 之前未被列入——虽然风险最低, 但既然本次是"能力级权限拆分", 应该一并纳入而不是遗漏一个未来复发的口子。

---

## 二、拆分设计

### 2.1 分级(按本稿风险评估, 待 NWT 核对是否同意分级本身)

| 级别 | 定义 | 本次涉及能力 |
|---|---|---|
| **T-BREAK-GLASS** | 绕过正常密码学证明路径, 人工判断代替协议保证 | ③confirm-by-address |
| **T-BROADCAST** | 直接触发链上资金移动的真实广播 | ⑥zk-close-v2(真广播分支) |
| **T-SIGN** | 触碰私钥签名操作(即使不直接动钱, 签名本身是高价值动作) | ①coord-status/sign |
| **T-STATE-PREP** | 协议状态转换准备, 未广播(有 dry-run 默认) | ④propose-close-v2, ⑤zk-handoff-v2 |
| **T-READONLY** | 零链上副作用, 纯读/纯展示 | ②visibility, ⑦debugger |

### 2.2 每能力独立密钥(env var 拆分)

```
ADMIN_SECRET_CONFIRM_BY_ADDRESS   # T-BREAK-GLASS, 见 §2.3
ADMIN_SECRET_ZK_CLOSE_BROADCAST   # T-BROADCAST
ADMIN_SECRET_STATUS_SIGN          # T-SIGN
ADMIN_SECRET_ZK_STATE_PREP        # T-STATE-PREP(propose-close-v2 + zk-handoff-v2 共用一把——
                                   #   两者是同一次操作的连续两步①门, 拆两把钥匙对同一操作
                                   #   者没有额外防线价值, 只增加操作摩擦; 但绝不与⑥共用)
ADMIN_SECRET_READONLY             # T-READONLY(visibility + debugger 共用——都是零副作用)
```

不再有单一 `ADMIN_SECRET` 兜底所有端点。每个端点的 header 校验只认自己那把钥匙, 拿 T-READONLY 的密钥去打 zk-close-v2 必须 403。

**迁移期**: 若某把新密钥未设置, 对应端点保持现有"未设=503 disabled"的失败方向(fail-closed 对未配置=禁用, 不是自动 fallback 到旧 `ADMIN_SECRET`——旧变量迁移期允许保留只读兼容一段时间, 但新老不混用同一次请求校验, 避免"设了新的但旧的还生效"这种双活漏洞)。

### 2.3 `confirm-by-address` Break-Glass 强化(Owner 原文四要求逐条对应, 2026-07-16 NWT 红队①后修订)

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

**待定(不阻塞落码, 但落码时需明确)**: T-BROADCAST(`zk-close-v2` 真广播分支)与 `confirm-by-address` 同标"最高风险", 但目前只有后者拿到第二方确认强化——NWT 指出这个不一致, 判定"是范围决策不是安全漏洞"(现状没有变差, 只是没有变得更好), 交 Owner 明确是否也给 `zk-close-v2` 补同款两步确认。

---

## 三、NWT 红队①结论(2026-07-16, 已折入 §2.3)+ 剩余待 Owner/落码前定的问题

1. ~~T-STATE-PREP 两端点共用一把钥匙是否合理~~ → **NWT 已核: 合理, 不拆**(同一操作者连续两步, 拆开无额外防线价值)。
2. **迁移期**: NWT 建议给死线 + 新增 lint 规则 `R-ADMIN-SECRET-LEGACY`(死线后旧变量若仍生效, 拦截), 同今天新增的 `R-SELF-HTTP-FETCH` 同款思路(机制防呆而非只靠自觉)——**采纳, 落码时一并加**。
3. **reviewer 身份绑定**: 见 §2.3 v2 设计(两把独立密钥, 不再是自由文本)。
4. **IP allowlist 现状核实**: NWT 建议本次一起做, 不要分两次改同一批端点的权限面——**采纳**, 落码前逐端点核实 allowlist 配置是否齐全(本稿尚未做, 落码 diff 需覆盖)。
5. T-BROADCAST 是否补同款两步确认——**Owner 定**, 不阻塞落码(见 §2.3 待定项)。

---

## 四、不做什么(本稿边界)

- 不改任何现有端点的业务逻辑(propose-close-v2/zk-handoff-v2/zk-close-v2 的构造/广播代码零改动)。
- 不涉及 relay 私钥本身的存储/加密方式, 只涉及"谁能调用触发签名/广播的 HTTP 端点"这层权限。
- 落码顺序: 本设计稿→NWT 红队→(若需要)第二方确认字段的身份绑定单独设计→落码→装载。
