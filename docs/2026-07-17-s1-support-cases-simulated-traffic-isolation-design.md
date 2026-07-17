# S1 实现设计稿 — cases/support/ 首批 + 模拟流量隔离机制(2026-07-17)

> **Status**: CURRENT(实现设计稿·待 NWT 红队;红队过后落码,落码前不动代码)
> **作者**: KANet-UI · 依据: `docs/2026-07-17-simulated-user-traffic-framework-v0.1.md`(a802e3ca)§5 S1 卡
> + NWT 红队发现①(`docs/2026-07-17-NWT-redteam-simulated-user-traffic-framework.md`)
> + Bettor 方向裁定(#oocpsi.1/.2, Q1/Q2 均 GREEN)。

## §0 背景(为什么要设计而不是直接写 case)

框架稿 S1 计划用 `malicious`/`liar` persona 驱动 `cases/support/` 首批, 目标之一是验证
"owner-bot 转发含硬前缀"。NWT 红队抓到: 这条测试如果直接跑, adversarial persona 产出的内容会
真实流过 `feedback.js` → `escalateTicket` → `owner-bot.mjs pollFeedbackEscalations` →
用 Owner 本人 `trust_level=owner` relay 身份广播到 `dev-coord-testnet`——跟 `#7`(escalation
payload 下游净化, `8446d4fb`+`b84f5ebd`, NWT 已 GREEN)打的是**同一条真实链路**, 区别只是这次
没有真实攻击者, 是我们自己的测试框架会意外实现一次那个攻击场景。

## §1 隔离机制(Q1 GREEN 方向)

**新增独立测试标记凭证, 与 `ADMIN_SECRET` 四钥匙体系完全分离**(不同域: 那是生产管理权限,
这是测试流量标记, 绝不触及任何资金/权限操作)。

- 新 env var: `TEST_HARNESS_TOKEN`(只在测试/开发环境 `kanet.env` 配置, 生产部署不设)。
- 新文件 `kasia-console/src/lib/sim-traffic-marker.mjs`(落码时改名, 原计划名 `test-harness-marker.mjs`
  撞 `.gitignore` 的 `test-*.mjs` 规则——那条规则是挡临时测试脚本的, 这个文件是生产代码只是名字
  凑巧撞上前缀约定, 改名比每次 `git add` 都要 `-f` 强制更干净), 仿 `admin-secret-tier.mjs` 同款
  fail-closed 风格但物理独立(不 import/复用 `checkAdminSecretTier`, 避免"改一个连坐另一个"):
  ```js
  import { timingSafeEqual } from 'crypto';

  export function checkTestHarnessToken(request) {
    const provided = request.headers['x-test-harness-token'];
    if (!provided) return { isSimulated: false };           // 没带 header = 正常生产请求, 不受影响
    const secret = process.env.TEST_HARNESS_TOKEN;
    if (!secret) return { ok: false, code: 403, error: 'test harness token 未配置' };
    try {
      const a = Buffer.from(provided), b = Buffer.from(secret);
      if (a.length === b.length && timingSafeEqual(a, b)) return { isSimulated: true };
    } catch { /* fall through to reject */ }
    return { ok: false, code: 403, error: 'test harness token 不匹配' };
  }
  ```
  **2026-07-17 NWT 红队 MUST-FIX 折入**: 比较逻辑改常量时间(`crypto.timingSafeEqual`), 不用
  `provided !== secret` 直接比较——同 `54dd60d2`(NWT FINDING-1, `ingest-auth.js`
  `isValidIngestSecret`)修过的同一类洞: 字符串直接比较存在时序侧信道, 攻击者可逐字节猜出正确
  值。风险不是空对空: **猜中这把 token = 能让一条真实钱类升级工单的 `is_simulated` 被标记
  `true`, 从而在 `owner-bot.mjs` 转发环节被跳过(§3 选 (a))**——是"抑制升级"类攻击, 跟 `#7`
  (伪造内容混进升级)是同一条链路方向相反的姊妹攻击, 必须按同等严重度堵。写法逐字抄
  `ingest-auth.js:14-15`(先比长度再 `timingSafeEqual`, 长度不等时直接 `false` 不进
  `timingSafeEqual`, 避免抛异常)。
- **Bettor 承重点①(fail-closed)**: 生产环境未配置 `TEST_HARNESS_TOKEN` 时, 任何带
  `X-Test-Harness-Token` header 的请求一律 403 拒绝(不静默忽略 header、不当成普通请求放行）
  ——"想标记为模拟流量但环境不支持" ≠ "那就当真实流量处理", 必须显式拒绝到调用方(S1 测试代码
  会因此在未配置的环境里直接失败, 而不是悄悄产出未隔离的真实广播)。
- **Bettor 承重点②(权限最小化)**: 这把 token 唯一效果 = 允许当前这条 `/api/feedback/reply`
  请求的 `is_simulated` 落库为 `true`。不做任何其他事——不绕过 H2 身份重校验、不绕过
  `classifyEscalation`、不影响 anchored 判定。

## §2 数据落地(`execution_states` / `events`)

- `feedback.js openTicket()`: `action_details` JSON 新增 `is_simulated: boolean` 字段(默认
  `false`, 只有 `checkTestHarnessToken` 返回 `isSimulated:true` 时才写 `true`)。**不新建表**
  ——复用 `pool-bettor... `等既有 JSON 扩展惯例(v187 spc_tip_heartbeat 那种才是真正新表场景,
  这里只是既有 JSON blob 加一个 key)。
- `escalateTicket()`: `events.payload_json` 镜像写入同一个 `is_simulated` 值(不用回查
  `execution_states` join, `pollFeedbackEscalations` 直接从 events 行读, 零额外查询开销)。
- `docs/DATABASE.md`: 补 `execution_states` 表 `type='user_feedback'` 场景下
  `action_details.is_simulated` 字段说明(CLAUDE.md 硬规矩: 新字段语义必同步文档)。

## §3 转发隔离(Q2 选 (a) GREEN: 完全不转发, 非隔离频道)

`owner-bot.mjs pollFeedbackEscalations()`: `feedbackEscalatedSince` 查询结果里
`is_simulated === true` 的行直接 `continue`(不调 `postOwnerMessageToDevCoord`), 只在
`console.log`(owner-bot 自己的进程日志, 非频道)留一条观察行方便调试。

**理由(与 Bettor 裁定一致)**: S1 的断言目标是"这条 ticket 的 `escalated` 字段 + `events` 行
是否符合 `classifyEscalation` 预期行为", 不需要真的看到它被广播出来才算测试通过。选"完全不转发"
而非"转发到隔离频道", 是因为后者仍然要多维护一条隔离频道+一套隔离频道自己的信任边界(谁能读
`dev-coord-testnet-rehearsal`、要不要一样过防火墙……), 引入的新面比它解决的问题更大, 不值得
——**减攻击面**优先于"给 adversarial 内容一个专门的展示舞台"。

**分工澄清(Bettor #oocpsi.2)**: `#7` 那条真实探针(工单 `c1ac5c0f`/`c966e095`, 带硬前缀真实代发
到 `dev-coord-testnet`)测的是**转发链路本身的净化渲染**(围栏/折叠/截断对不对), 走的是正常
（未加 `is_simulated`）请求路径, 就应该真广播出来人工验证渲染效果——那条不受本设计影响, 两套
测试身份分工不同(一个测转发渲染, 一个测判定+状态机), 不要合并成一套。

## §4 `cases/support/` 首批 case 设计

**素材来源口径(NWT 发现②已提醒, 不可再照抄"七条社工话术"当作已完整覆盖)**:

- 资金类正例(应 escalate=true): 沿用今日 `_kanetui_classifier_failclosed_test.mjs`(78efe0ef
  post-fix 复测)已验证的 15 条钱类信号+混合句 bypass 反例集合。
- 安全查询负例(应 escalate=false): 同一脚本的 6 条安全查询集合。
- 社工话术(NWT §1 明确的 7 类, 但**只有 4 类落在 `classifyEscalation` 单消息判定职责范围
  内**——伪造权威/诱导取消升级/跨身份套取(NWT 原始 3 条)+间接注入伪系统标记(KANet-UI 07:31
  补测第 4 条)。**S1 case 描述必须显式写明这个 4/7 口径, 不能沿用 a802e3ca 框架稿"七条社工话术
  套"这个会让人误以为覆盖完整的旧措辞**。剩余 2 类结构性不在范围内:
  - #5 累积信任攻击(多轮): 已由 Bettor 折入 `mind_changer`/`liar` persona 多轮 case(#omft2y.2
    已排期), 不在本卡重复造。
  - #7 升级载荷投毒: 是 `#7`(本文档同名但不同事)已修的下游净化问题, 不是 `classifyEscalation`
    的判定职责, 不在本卡重复造。
- 围栏/净化 regression: 直接复用 `tg-bot/owner-bot.test.mjs` 已有 8 组(不重复造第二份, `import`
  同一个 `escalation-sanitize.mjs`, `cases/support/` 里的 case 是"跑一次这个判定+净化管线的行为
  在真实 HTTP 请求路径下是否吻合", 单元测试层面的覆盖不重复)。

**case 结构(每条走 `X-Test-Harness-Token`, 落库 `is_simulated:true`, 不产生真实频道广播)**:

1. `support_escalation_money_signal_positive.test.mjs` — `malicious` persona 发钱类诉求, 断言
   `escalated:true` + `events` 表出现对应 `feedback_escalated` 行 + `is_simulated:true`。
2. `support_escalation_safe_query_negative.test.mjs` — `cn_newbie`/`en_neat` persona 发安全查询,
   断言 `escalated:false` + 无 `events` 行(fail-closed 验证方向: 断言"不该拦的真没拦", 配合①
   断言"该拦的真拦了", §3 硬边界要求两个方向都要有)。
3. `support_escalation_social_engineering_4of7.test.mjs` — `liar` persona 走 4 类已验证话术,
   断言 `escalated` 结果符合各自预期(前 3 类均 `false`, 第 4 类间接注入若不含钱类信号同样
   `false`, 叠加钱类信号则 `true`——同今日 `_kanetui_classifier_failclosed_test.mjs` ⑥的组合
   断言)。
4. `support_no_broadcast_leak_negative.test.mjs`(**新增, NWT 承重点直接对应的 regression**)——
   **2026-07-17 NWT 红队 MUST-FIX 折入(防自证 regression 假阳性)**: 原设计只断言"没有新增消息",
   但没保证测试运行窗口真的覆盖了 `pollFeedbackEscalations` 的 tick(`FEEDBACK_ESCALATION_POLL_MS`,
   默认 15000ms)——如果断言跑得比下一次 poll 还早, "没有消息"这个结果无论隔离逻辑对不对都会
   成立(压根没到轮询点, 不是过滤生效了), 这是"证明不存在需要先证明有机会存在"的经典测试陷阱。
   改为两步:
   (a) **反例(隔离目标)**: 提交一条 `is_simulated:true` 的钱类升级工单, 记录提交时刻;
       显式等待 ≥ 1 个完整 `FEEDBACK_ESCALATION_POLL_MS` 周期(用 `wait_for_db_row` 或等效的
       轮询等待 action, 不用固定 `sleep`——等够时间但不多等), 之后断言 `dev-coord-testnet`
       在提交时刻之后**没有**新增包含该 `ticket_id` 前 8 位的消息。
   (b) **正对照(排除"轮询器根本没在跑"这种更荒谬的假阳性来源)**: 在同一个 case 里紧接着提交
       一条**不带** `X-Test-Harness-Token`(即真实非模拟路径)的钱类升级工单, 用同样的等待窗口,
       断言这条**确实**出现在 `dev-coord-testnet`(复用 `#7` 探针已验证过的围栏渲染断言即可)。
       (a)(b) 必须在同一次 case 运行里各跑一次, 用同一个等待窗口——如果轮询器没在跑, (b) 会先
       失败, 不会让 (a) 侥幸绿灯。
5. `support_test_harness_token_failclosed.test.mjs`(**新增, Bettor 承重点①对应的 regression**)
   —— 直接调 `checkTestHarnessToken` 纯函数(不测完整 HTTP 栈也可以, 拆成纯函数就是为了单测
   方便), 覆盖三条独立分支(**2026-07-17 NWT 非阻塞建议折入**: 原设计只写了两条, 漏了"env 已
   配置但 token 值错误"这条独立于"env 未配置"的 403 成因, 同一个判定表达式里的两条不同代码
   路径, 必须分开断言防止将来改坏比较逻辑时现有 case 测不出来):
   - header 缺失 → `isSimulated:false`(视为普通请求, 不报错——"根本没带 token"是合法的生产
     请求路径);
   - `TEST_HARNESS_TOKEN` 环境变量未设置(空/undefined)、但 header 带了任意值 → `ok:false
     code:403`;
   - `TEST_HARNESS_TOKEN` 已设置、header 带了一个存在但**不匹配**的值 → `ok:false code:403`
     (这条独立验证 `timingSafeEqual` 分支本身能正确判否, 不只是"env 没配"这条路径能拦)。

## §5 DoD

- 5 条 case 全绿(含 case4 反例+正对照双断言、case5 三条独立分支断言)。
- `docs/DATABASE.md` 补 `execution_states.action_details.is_simulated` 字段说明。
- `kanet.env.example`(如有)或部署文档注明 `TEST_HARNESS_TOKEN` 只在测试环境配置, 生产不配置
  = 隔离机制天然对生产环境的意外触发 fail-closed。
- NWT 红队重点验 Bettor 两个承重点(fail-closed 校验行为分叉 / token 权限最小化边界)。

## §6 不做什么

- 不新建 `dev-coord-testnet-rehearsal` 隔离频道(Q2 选 (a), 理由见 §3)。
- 不改 `checkAdminSecretTier`/`admin-secret-tier.mjs` 本身, 新增的是物理独立的另一个文件。
- 不改 `#7` 那条真实探针链路的行为(硬前缀真实代发路径不受 `is_simulated` 影响)。
- 不在本卡重造 #5/#7 社工场景(见 §4 口径说明, 各自已有归属)。
