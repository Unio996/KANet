# M0c-1 机制A — Path B pilot 试点围栏设计 v0.1（gateway 侧·配对 J1 relay 侧）

> **Status**: CURRENT（v0.1 设计草案·待 NWT 红队 + Codex 激活就位复核 + Owner 最后拍）

> **作者**: J2（gateway 侧）+ J1（relay 侧，并行起草）· 2026-07-23
> **主线依据**: Owner 批准 Path B（`#xx36z6`）→ Bettor 五工作流并行派工，本文档 = 工作流①「试点围栏设计」的 gateway 侧部分。
> **红线（Bettor 原话，不可谈判）**: 专用低余额 pilot 钱包做硬止损顶，**绝不暴露所有用户托管钱包**。
> **范围边界**: 本文档只设计围栏（containment），**不碰激活**（不改 `ADMIN_CAPABILITY_GATEWAY_ENABLED`/`ADMIN_M0C1_GATE_ARMED`，不充值 pilot 钱包）。激活是 Bettor 五步序里的最后一步，需 Owner 单独授权。
> **消费既有资产**: `kasia-console/src/api/capability.js`（G2 已落码，`a613844a`）/ `kasia-relay/src/lib/app-envelope.mjs`（`checkCustodialTransferBinding`，J1 `8862f7f1`）/ `docs/2026-07-23-m0c-1-mechanism-a-http-capability-gateway-design.md`（机制A 母卡，本文档是它的 pilot 激活附属卡，不重复其内容，只讲围栏增量）。
> **v0.1→v0.2 变更**（`#xx6ofb`/`#xx5gwd` 频道并行讨论 fold）：①§2.1 relay 侧权威层从"两选项"改为**已定案**（J1 采纳 Bettor 的 grant-scoped 方案，撤回硬编码提案）②§2.2/§2.3 J1 提出的具体数值（50 KAS 钱包顶/2 KAS 单笔 cap/5 分钟 TTL/3 笔每分钟限流，供 Bettor ratify）③新增 §2.6：**激活时序安全（KANet-UI 关键发现+NWT 独立坐实）**——两个 flag 分批开会导致 relay 侧全部验证静默失效④新增 §2.7：J1 提出的 `armReport()` 跨进程运行时互查提案（gateway 域相关，本设计稿记录，待团队定是否采纳/分配）。

---

## 1. 一句话

Path B = "先用最窄的围栏在真实环境跑一遍，暴露面小到可承受"，不是"把 G2 已落码的通用机制直接开 flag"。**通用机制（G2）验证了"怎么做是安全的"，围栏验证"就算通用机制有没发现的洞，blast radius 也小到可承受"**——两层防御，非互相替代。

---

## 2. 围栏五要素（Bettor 原话逐条设计）

### 2.1 专用 pilot 钱包 + 源地址白名单（只这钱包）

**问题（§4.3 v0.3 已标注的已知观察）**：grant 的 scope 维度（`payee_scope`/`market_scope`/`branch_scope`/`max_amount_sompi`）里没有"限定 `fromAddress`"这个维度——今天的机制允许 tg-bot 这一个 grant 对**任意**托管钱包发起合法签名意图，只要它自己愿意签。pilot 阶段这是不可接受的（"绝不暴露所有用户托管钱包"红线）。

**🔴 两层纵深防御定型（`#xx6ofb` J1+Bettor 讨论收敛，非本节独占设计）**：
- **gateway 层（本节，我owns）= 早拒 + DoS 护栏，非权威**。跟 §3.2（机制A 母卡）"网关验非权威、relay 验才是 load-bearing 闸"同一纪律——即使 gateway 白名单有 bug 放过了不该放的地址，relay 侧独立再挡一次，不能只信这一层。
- **relay 层（J1 owns，独立设计稿）= 权威，已定案**：`source_address_scope` 新 grant 列 + `checkIntentWithinGrant`/`SCALAR_DIMENSIONS` 权威 enforce（`19:45:39` J1 采纳 Bettor 建议，撤回硬编码 `PILOT_WALLET_ADDRESS` 提案——理由：数据驱动非硬编码、天然接吊销即时生效、复用既有 `payee_scope` 同款 membership kind 机制非新建，复杂度比硬编码方案预想的低）。relay 侧具体落码归 J1 配对设计稿。

**gateway 侧设计（不受权威层选择影响，两种情况下 gateway 这层都一样存在）**：`earlyRejectCheck` 里、`amount cap` 检查之后（同样 cheap，无需解密）加一步：
```js
const PILOT_WALLET_ALLOWLIST = new Set(
  (process.env.PILOT_WALLET_ADDRESSES || '').split(',').map(s => s.trim()).filter(Boolean)
); // 空 = 该白名单未配置 = fail-closed 拒所有（不是"不限制"）
if (!PILOT_WALLET_ALLOWLIST.has(env.intent.fromAddress)) {
  return { ok: false, code: 403, error: 'fromAddress 不在 pilot 白名单（试点围栏，非 grant scope 缺陷）' };
}
```
- **为什么不做成 grant scope 的新维度（如 `source_address_scope`）**：那是通用机制的永久扩展，需要走完整 M0c-1/M0c-2 scope 设计+红队+落码周期，范围超出"pilot 围栏"这个临时、窄、shrink-back-to-zero 的东西。**pilot 白名单是围栏层的东西，跟 grant 机制正交**——即使某天 grant scope 加了 source-address 维度，pilot 白名单依然作为独立第二层保留（纵深防御，两个独立配置源都要点头才放行）。
- **空白名单 = fail-closed**：环境变量未设时 `PILOT_WALLET_ALLOWLIST` 是空 Set，`.has()` 恒 false，所有请求都拒——这与整个 M0c-1 的 default-deny 精神一致，不会因为忘记配置这个环境变量而"意外开放"。
- **只此一个地址（严格 pilot）**：Bettor 红线是"专用低余额 pilot 钱包"（单数），设计上 `PILOT_WALLET_ADDRESSES` 支持逗号分隔多个是为了灵活性（例如多个测试场景各一个钱包），但**激活时的实际配置值应该只填一个地址**——这是激活步骤的运维纪律，不是本设计要不要支持多个的问题。

### 2.2 单笔极低 cap

**不是新代码**——沿用已有 `grant.max_amount_sompi` 机制（G2 已落码的 amount cap 检查）。**是运维/provision 纪律**：pilot grant 签发时（`m0c1-grant-provision.mjs issue`）`--max-amount` 参数必须设一个刻意保守的值（例如 1-5 KAS 量级，具体数字由 Bettor/Owner 在激活步骤拍板，不在本设计文档定死）。

**围栏设计要求的唯一代码动作**：无——这条已经被 G2 覆盖。本节存在的意义是**在围栏清单里显式点名**，防止激活时有人以为"通用机制已经支持 amount cap 所以不用管"而忘记把 pilot grant 的这个字段设置得足够保守（"支持"≠"配置对了"）。

**🔴 数值提案（J1 `19:44:07`，供 Bettor ratify，交叉验证关系非孤立拍脑袋）**：`max_amount_sompi` = **2 KAS**，跟 pilot 钱包余额硬顶（§2.6）50 KAS 组合 = 25 笔封顶（即使限流失效/绕过，钱包本身也只够转 25 次）。

### 2.3 这能力信封 TTL 收分钟级（非 1h）

**现状**：`MAX_ENVELOPE_TTL_MS = 60 * 60 * 1000`（1h），relay 侧 `verifyAppEnvelope` 统一执行，对所有 intent_type 一视同仁。

**🔴 设计定案（J1 relay 侧 `19:43:21` 已定，非本节 per-type 表提案——记录 J1 的选择+理由，不代改）**：J1 选择**直接改全局常量** `MAX_ENVELOPE_TTL_MS` 为分钟级（非我 v0.1 初稿提议的 per-type 表）——理由：现网 zero 真实流量经这条路径（唯一 consumer = 待建的 pilot 本身），收紧全局常量不影响任何现有东西，比新增 per-type TTL 列简单干净；pilot 结束后若要恢复给真实多用户放量，再评估要不要拆成 per-type/per-grant（M0c-2/M0c-3 范围）。**采纳 J1 方案，本节原 per-type 表提案作废**（诚实标：v0.1 初稿想法被 relay 侧实际设计取代，非隐藏分歧）。

**gateway 侧同步收紧的早拒验（新增，G2 时故意留白的缺口，pilot 阶段补上）**：G2 的 `earlyRejectCheck` 当前不检查 TTL/expiry（§8 测试里"INFO expired envelope..."标注过是诚实的范围边界，非 bug）。Pilot 围栏阶段这条**收回来做早拒**——网关侧用跟 relay 同一个收紧后的 TTL 上限（J1 全局常量方案下，gateway 直接从 relay 侧常量镜像同一个数值，或更干净地把这个常量也搬进共享库单一真相源，跟 amount cap 用 `kasToSompiBig` 那次一样防两份漂移）早拒过期/超窗信封，避免一个已经在 TTL 上超标的请求还走完签名验证+amount check 才在 relay 侧被拒。

**🔴 数值提案（J1 `19:44:07`）**：TTL = **5 分钟**（Bettor 区间 5-10min 下限，主动选择收窄——nonce durable 去重要 M0c-3 才有，TTL 目前是唯一防重放窗的闸；现网 zero 真实流量，5 分钟对 tg-bot 签发→发送→relay 处理这个真实链路时延依然绰绰有余）。
   - **谁定义这个表的权威副本**：建议放共享库（`shared/lib/app-envelope-canonical.mjs`），gateway 和 relay 各自 import，同 G1 单一真相源纪律，防两份漂移（同 amount cap 用 `kasToSompiBig` 那次的模式）。

**TTL 有效窗口够不够用（NWT `19:51` 重新推导，修正 J2 v0.1 初稿的错误数学）**：J2 v0.1 初稿曾写"5min TTL − 2min `ISSUED_AT_SKEW_MS` 容忍 = 实际有效窗口约 3min"——**这个减法在数学上不成立**：`ISSUED_AT_SKEW_MS` 只容忍 app 时钟比 relay **快**多少（挡"未来"issued_at），完全不影响 app 时钟比 relay **慢**的方向（慢的情况下 issued_at 天然不触发"未来"检查），跟 TTL 消耗预算无关。**真正决定有效窗口的是**：`TTL − max(0, app 时钟实际比 relay 慢的量) − 端到端真实延迟（网络+处理）`，这两个因子都跟 `SKEW_MS` 无关。**结论（NWT 判断）**：5 分钟 TTL 在 pilot 环境下技术上够用——pilot 阶段 tg-bot 与 relay 大概率同机/同内网（localhost-only，§2.4 母卡定案），时钟应 NTP 同步（偏差毫秒级）+ 端到端延迟应毫秒到秒级，远小于 5 分钟预算，不太可能误伤合法请求。**5 分钟 TTL 在低延迟同网环境下留有充分余量，主要消耗是端到端处理延迟非时钟偏差**（措辞按 NWT 建议修正）。

### 2.4 进程外限流（解密前拦·keyed by app-grant）

**"进程外"的含义**：不能是纯内存计数器（重启即清零，且多进程/未来水平扩展场景下不共享状态）——需要**持久化、跨进程可见**的限流状态。

**设计**：新增一张轻量表（或复用现有基础设施，待与 NWT/KANet-UI 核实是否有更合适的现成限流机制可复用，不重造）：
```sql
CREATE TABLE IF NOT EXISTS pilot_rate_limit_log (
  grant_id TEXT NOT NULL,
  requested_at INTEGER NOT NULL  -- unix 秒
);
CREATE INDEX idx_pilot_rate_limit_grant_time ON pilot_rate_limit_log(grant_id, requested_at);
```
- **限流键 = `grant_id`**（Bettor 原话"keyed by app-grant"）——不是按 IP/按 fromAddress，是按已声明的 grant_id（此刻还没验证签名，见下方"何时检查"）。
- **限流窗口/阈值**：建议保守起点如"每 grant_id 每分钟 ≤ N 次请求"。**🔴 数值提案（J1 `19:44:07`）**：N = **每 app-grant 每分钟 3 笔**。与 §2.2/§2.3 数值组合看的语义（非孤立数字）：3 笔/分钟 × 5 分钟 TTL 窗 ≈ 一个 TTL 窗口内最多约 15 笔尝试；但 §2.2 已把总量硬顶在 25 笔（50 KAS ÷ 2 KAS）。限流的作用不是防"最终转多少"（那由钱包余额顶+单笔 cap 顶死），是防"多快能转完"——压低攻击脚本快速抽干的速度，给运维反应时间：就算全部 25 笔额度被恶意用完，3 笔/分钟至少要 8 分钟以上，不是秒级抽干。四个数字（50/2/5min/3-per-min）彼此有交叉验证关系。
- **何时检查（"解密前拦"精确定位）**：Bettor 原话只要求"解密前"——本设计建议放在**结构校验通过、`env.grant_id` 可读之后，签名验证之前**（比"仅早于解密"更早、更省资源）：
  1. 结构校验（已有）
  2. **限流检查（新增，此处插入）**：读 `env.grant_id`（此时还未验证签名，是未验证的声明值）→ 查 `pilot_rate_limit_log` 最近窗口内该 grant_id 的请求数 → 超限 → 403 拒，**不记录本次**（避免恶意方用超限请求本身继续膨胀计数、放大拒绝面）；未超限 → 记录本次请求（insert 一行）→ 继续。
  3. grant 存在/吊销/有效期（已有）
  4. 签名验证 MUST（已有）
  5. amount cap（已有）
  6. TTL/expiry 早拒（§2.3 新增）
  7. 派生 privkey（已有，仍是链条最后一步）
  - **诚实标注**：限流键用的是**未验证的** `grant_id` 声明值——理论上攻击者可以对着一个不存在/别人的 `grant_id` 疯狂请求，把那个 grant_id 的限流桶占满（不影响自己），但这不构成新洞：①这类请求本身在后续步骤（grant 存在性检查）会被拒，不消耗任何真实资源（解密/relay 转发）②限流表本身有清理策略（见下），不会无限增长③目标是防止**合法但被攻陷/失控的 app** 短时间内对**同一个真实 grant** 发大量请求耗尽 pilot 钱包，不是防通用 DoS（那是 gap-A/网络层的职责）。
- **清理/增长控制**：需要一个 TTL-based 清理机制（例如定期删除超过 N 倍限流窗口的旧行），否则表无限增长——具体实现待与 J1/NWT 讨论是否复用现有某个 daemon tick 模式，或独立小 cron。**本设计不预先定实现细节，留给落码批次**，只钉死设计要求：不能无限增长、不能是纯内存。

### 2.5 grant 随时吊销实测

**不是新代码**——`getGrantFreshGateway`（G2 已落码）每次请求都是 fresh DB 读，无缓存，天然满足"吊销即时可见"。**是测试要求**：需要一条**实测**（非只讲道理）证明这一点：

**测试设计**：
1. 用 pilot grant 发一个合法请求 → 确认 allow（或至少通过到"即将转发"这一步，不需要真的转发到 relay）。
2. **不改任何代码**，直接在 DB 里把该 grant 的 `revoked` 置 1（模拟 operator 执行吊销脚本的效果——理想情况下这一步应该调用真实的吊销脚本/端点而非手工 UPDATE，若 `m0c1-grant-provision.mjs` 已有 `revoke` 子命令则用它，更贴近真实操作路径）。
3. **立即**（不等待/不重启任何进程）用**同一个** grant_id 再发一次请求 → 必须 401（`grant 已吊销`）。
4. 断言：从吊销执行到下一条请求被拒之间，没有任何"缓存窗口"——这是 fresh-read-every-time 设计的直接验证，而非事后猜测。

### 2.6 🔴 激活时序安全（KANet-UI `19:44` 发现 + NWT `19:45` 独立坐实·必核项）

**问题**：`kasia-relay/src/lib/authorize.mjs:66` `authorizeCommand()` 的第一步是 `if (!GATE_ARMED) return {decision:'allow'}`——**在判断 origin 之前**，无条件放行，不管 origin='app'/internal/缺失。

**推论（NWT 独立验证坐实）**：若 pilot 激活**只开 `ADMIN_CAPABILITY_GATEWAY_ENABLED=1`（网关路由）而忘开 `ADMIN_M0C1_GATE_ARMED=1`（relay 闸）**，网关发出的 `origin='app'` custodial_transfer 命令到 relay 后，`authorizeCommand` 直接放行，**跳过 `authorizeAppCommand`→`verifyAppEnvelope`→`checkCustodialTransferBinding` 整条链**（§3.3a 绑定器/network 四值 join/grant scope 全部不执行）——`relay.mjs:490` `case custodial_transfer` 直接执行 `custodialSendKaspa`，**零二次校验，完全信任 cmd 里的字段**。今天一整天（NWT+J1+Codex）建的 relay 侧纵深防御在这个组合下**形同虚设，只剩网关单层**——而网关这层设计上本来就是"早拒、非权威"（§2.1），不是为了独自扛完整授权职责设计的。

**性质（Bettor `19:46` 定性，供 Owner 决策参考）**：这不是"忘了配一个次要 flag"这么轻——**pilot 激活 = M0c-1 gate arm（`armed=on`）本身**，是今晨那次已回滚事故（部分开关组合未完整推演，三断路族）的**同族问题、镜像方向**：今晨是 `armed=on`+标注不全 → fail-closed 误断（服务瘫）；这次若 `gateway=on`+`armed=off` → 本该有的验证 fail-open 静默失效（钱可能无验证流出，且**不报错不留痕**，除非专门审 armed 状态）。**pilot 激活因此耦合到 M0c-1 六门 re-arm 前置**（母卡 §7 门⑤等，今晨事故后已建），不是一个独立的"开小 flag"决策——这也是为什么 Bettor 把最终 `armed=on` 决定留给 Owner（`#xx9dq9`：`⑥Owner 最后授权 = armed=on 决定`，Bettor 带完整 re-arm 前置就位证据 + pilot containment 找 Owner 拍）。

**围栏设计的强制项（runbook 层面，KANet-UI owns 完整 runbook，本节记录 containment 设计对它的要求）**：
1. **两个 flag 必须同批次一起开，缺一不可**——不允许"先开网关观察一下"这种分步试探式激活（那正是 fail-open 窗口）。
2. **需要机制校验，不能只靠 runbook 人工纪律**（人会漏，今晚已有先例）——见 §2.7。
3. NWT/Codex 审围栏时把"两 flag 耦合 + re-arm 六门前置 current 状态"列为必核项（Bettor 已下达）。

### 2.7 `armReport()` 跨进程运行时互查（J1 `19:45:39` 提案 → **Bettor `19:50` 决定做，非可选**）

**🔴 定性（Bettor `19:50`+`19:51` recalibrate，诚实框定）**：这是纵深防御**第二层**（缩窗 + 还 `armReport()` 未接线的旧债），**不是 100% 银弹**——NWT 指出（§4 第 8 点）它有理论 TOCTOU 窗口（gateway 查完 `armed===true` 到实际转发之间，relay 状态理论上可能变化）。Bettor 认账：最初说"结构上让 footgun 不可能"是 over-claim，已收回——**主防线仍是 §2.6 两 flag 同批次开 + re-arm 六门前置**，§2.7 是运行时兜底，缩小暴露窗口，不是把 §2.6 的运维纪律要求降级或替代掉。

**背景**：§2.6 的机制化校验诉求——`ADMIN_CAPABILITY_GATEWAY_ENABLED` 在 Console/gateway 进程 env，`ADMIN_M0C1_GATE_ARMED` 在 relay 进程 env，**两个不同进程**，relay 自己在模块加载时看不到 gateway 那个 flag 的值，没法照搬 `authorize.mjs` 现有的"armed=on 但 grant/envelope stub → throw"那种同进程内自检模式。

**J1 提案**：gateway 在真正转发 custodial_transfer 命令前，**主动查一次 relay 的 armed 状态**——这需要 `armReport()` 真正被接线（`armReport()` 函数已存在，`authorize.mjs` 导出，但**从未被任何调用点使用**——这是今天早些时候记的一笔债，J1 认为"如果做这个互查机制，这笔债今天就该还，不是以后有空再说"）。

**gateway 侧实现草图（J2·本节新增，回应 J1 提案的具体落地方式，非最终设计）**：
- relay 侧新增只读诊断命令（如 `get_arm_status`，零业务副作用，纳入 `READONLY_ALLOWLIST`——同 `get_rpc_state` 等既有只读诊断命令同类，无论 armed 状态如何都可答）——handler 调用 `armReport()`，通过 IPC `requestId` 回执把 `{armed, grantEnvelopeImplemented, ...}` 传回。
- gateway 侧 `earlyRejectCheck`（或独立的 dispatch 前置步骤）在**真正转发**（`sendCommandAsync` 携带 `origin='app'` 那一步）之前，先发一次 `get_arm_status` 查询，确认 `armed === true` 才继续；`armed !== true` → 拒绝转发（明确错误："relay 未 armed，网关侧转发已暂停"），而不是把命令发出去然后信任 relay 会正确处理。
  - 🔴 **`get_arm_status` 这次查询本身的 `origin`（NWT `20:05` relay 侧 diff 审 note，落码前先钉死）**：用 `'internal'`，**不用** `'app'`——这是网关自己的运维/系统级诊断查询，不是外部 app 业务意图，不该占用 §5 焊死的"`origin='app'` 唯一铸造点"规则（我们规定过全仓恰好一处 `sendCommandAsync(...,'app')` 调用点 = `capability.js` 真正转发 custodial_transfer 的那一行，参见母卡 §5 角度①独立 grep 验证）；也不需要信封（`get_arm_status` 在 `READONLY_ALLOWLIST` 里，`armed=on` 时豁免完整信封验证）。
- **这不是取代 §2.6 的运维纪律**（两 flag 仍必须同批次开，是激活流程本身的硬约束），**是运行时的第二重确认**——同一天已经反复出现的纵深防御纪律（relay 不信 gateway 早拒验/gateway 也不该盲目信 relay 已经 armed），两边互相不单方面假设对方状态正确。

**已决定（Bettor `19:50`）**：做。`get_arm_status`（relay 侧 handler = J1 域；gateway 侧调用逻辑 = 我域）。落码时机（G2 基础上快速加 vs 留下一批）待与 J1 对齐排期，围栏设计文档层面到此已完整（不是"是否做"的开放问题，是"何时落码"的排期问题，归实现批次决定）。

---

## 3. 与 G4 harness 的接口（答 J1 `19:42` 依赖关系）

J1 指出 G4 harness 的 BUST/LAND 用例边界依赖围栏具体数值（cap 多少/TTL 多长）——本设计到目前为止**故意不钉死具体数字**（amount cap、TTL 分钟数、限流阈值 N），因为这些数字应该是 Bettor/Owner 在红队反馈后拍板的运营参数，不是 gateway/relay 代码设计本身的产物。

**建议**：harness 的 BUST/LAND 用例先用**占位符/环境变量驱动**的方式编写（如 `PILOT_MAX_AMOUNT_SOMPI_TEST`），围栏具体数字定案后一次性灌进配置，harness 不需要因为数字变了重写用例结构，只改配置值。

---

## 4. 诚实边界 / 待答问题（迎审清单）

1. **限流表清理机制** — 未定具体实现，留落码批次决定（§2.4）。
2. ~~PER_TYPE_MAX_TTL_MS 归属位置~~ — **已改**（NWT `19:50` 抓的文档内部矛盾修正）：J1 relay 侧方案是**全局常量** `MAX_ENVELOPE_TTL_MS` 直接改分钟级（§2.3 已定案），非本文档 v0.1 初稿设想的 per-type 表——落码/测试统一用 `MAX_ENVELOPE_TTL_MS`，不建 per-type 索引结构。
3. ~~TTL 有效签名窗口是否够用~~ — **已答，NWT `19:51` 判断 = 够用**（结论认同，J2 v0.1 初稿的"5min−2min=3min"数学推导错误已修正，见 §2.3）：真正决定因素是 `TTL − 时钟慢的量 − 端到端延迟`，与 `ISSUED_AT_SKEW_MS` 无关；pilot localhost-only 低延迟同网环境下 5 分钟留有充分余量。
4. ~~具体数字（amount cap/TTL 分钟数/限流阈值 N）~~ — **已 ratify**（Bettor `19:50` `#xxefka`）：50 KAS 钱包硬止损 / 2 KAS 单笔 / 3 笔每分钟限流 / 5 分钟 TTL（TTL 附带上表第 3 点必核 caveat，未最终锁死）。
5. **限流复用现成基础设施 vs 新建** — 待核实仓库里是否已有类似"per-key 窗口计数"模式可复用（避免重造轮子），本设计目前假设新建一张窄表。
6. ~~relay 侧是否也需要独立的 pilot 白名单核验~~ — **已答**：需要，且是**权威层**（§2.1，grant-scoped `source_address_scope`，J1 `19:45` 定案）。
7. 🟡 **限流键用未验证 grant_id 声明值的可用性风险（NWT `19:50` note，non-blocker）**：签名验证之前先做限流检查（§2.4），意味着"知道 grant_id 但没有正确签名私钥"的第三方可以发大量"grant_id 对但签名错"的请求，把**合法 app 自己的**限流配额耗尽，造成合法 app 暂时被拒——**这是可用性问题，非资金安全问题**（真正钱路防线 amount cap+钱包顶+签名验证依然完整，攻击者耗尽配额不能因此转出一分钱）。localhost-only 环境（§2.4 母卡 blast-radius 定案）门槛较高（先要本地访问能力）+ pilot 流量极低，威胁面小。**根治方向（供后续批次参考，非本轮必须）**：签名前的 DoS 护栏改用独立于 grant_id 的键（如源 IP 或粗粒度全局限流），真正的 grant_id 配额限流放到签名验证之后。本轮记录为已知限制，不阻塞 pilot。
8. **§2.7 armReport 互查是否有 TOCTOU 窗口** — NWT 已指出（`19:50`）：有理论 TOCTOU 窗口（gateway 查完 armed=true 到实际转发之间，relay 状态理论上可能变化）——边缘 case，不会让情况变差（不查这个机制的话，风险只多不少），非 100% 万无一失，**主防线仍是 §2.6 两 flag 同批次开 + 启动自检，§2.7 是运行时兜底第二重，不是唯一防线**。

---

## 5. 测试计划骨架

- 白名单：非 pilot 地址请求 → 403（区别于"amount 超上限"/"签名失败"的独立 error 消息，便于诊断）。
- TTL：超过收紧后 `MAX_ENVELOPE_TTL_MS`（全局常量，5 分钟）的合法签名信封 → 早拒（gateway 侧，不到 relay）。
- 限流：同一 grant_id 短窗口内超过阈值 → 403，且被拒请求不计入下次窗口判断（防自我放大）。
- 吊销实测：§2.5 四步流程，断言吊销后**下一条**请求即被拒，无窗口。
- 组合负向：白名单外 + 超额 + 过期信封（多重违规叠加）→ 确认第一个命中的检查先触发拒绝（顺序符合 cheap-to-expensive，测试断言具体是哪层拒的，非只断言"被拒"）。
