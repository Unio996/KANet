# 测试框架拟人化·全 UI 实战化设计(在既有 test-framework 上加 UI-driver 层)

> **Status**: DRAFT v1.1(Bettor 拟稿 2026-07-10·**NWT 设计审 GREEN-with-MUST-FIX(6b330eba)·三条 must-fix 已折入 §2.4,Phase1 必带**→派工实现)
> 依据:Owner 2026-07-10 钦定长线主线"测试框架拟人化,更贴近实战,完全通过 UI 实现";Owner 7/8 已钦定"browser 级真实测试挂既有 test-framework 不新造轮子"。本方案**不动**既有 lib/personas/cases 结构,只**加一层 driver**。

## 0. 铁律:不造新轮子(先查的结论)

既有 `kasia-console/test-framework/` 已完备:`lib/`(runner+peers+chain-oracle+llm-mock)、`personas/`(9 个人格,含 Owner 真测 trace port 的 cn_real_human)、`cases/`(broker/exchange/oracle/predictions/system/agent-tunnel)、`adversarial/`。**本方案复用全部,零重写。**

## 1. 缺口:当前测试不经真实 UI

现有 case 的 `send_message` action 走 **`/api/agent/reply` sync 路径**(README 明写"test 用 /api/agent/reply 这条 sync 路径")——直接把用户消息喂给 broker mind 拿回复。**这条路径绕过了真实用户实际走的整条链**:

```
真实用户实际路径(当前测试全跳过):
  Telegram App → tg-bot(bot.mjs grammy) → console-api.mjs → /api/... → mind → relay 上链
                  ↑ 菜单/按钮/deep-link/会话状态    ↑ i18n/messages.mjs 文案渲染

当前测试路径:
  test runner → /api/agent/reply → mind        (只覆盖中间一段)
```

**实战盲区(Owner"贴近实战"要补的)**:①tg-bot 的菜单/inline-keyboard/deep-link 交互(prediction-menu 状态机)②messages.mjs/i18n 的真实文案渲染(用户眼睛看到的版面)③bot 会话状态(pending payments/linked addrs,_state.json)④托管钱包 /start→建钱包→押注全 UI 流 ⑤**broker 收益 DM 到达**(眼前主线①的验收正需要"真 DM 落到用户端"这个能力)。

## 2. 设计:加 `lib/ui-driver.mjs` + 新 action `ui_message`/`ui_tap`

### 2.1 driver 层(领域无关,进 lib/)
`lib/ui-driver.mjs` 导出一个把"人格化意图"翻译成"真实 tg-bot 入口调用"的驱动器。**不碰 Telegram 真服务器**(那要真 bot token+真账号,不可复现)——而是驱动 tg-bot 的 **update 入口**(grammy bot 的 `handleUpdate`,喂构造的 Telegram Update 对象:text message / callback_query 按钮点击),让消息**真实流经 bot.mjs 全部 handler**(菜单路由/状态机/i18n 渲染/console-api 调用),bot 的 `sendMessage`/`answerCallbackQuery` 出口 **stub 成捕获器**(记录 bot 实际要发给用户的文案+按钮=用户眼睛看到的东西,供 assert)。

```
persona 意图 "我要押注法国赢"
  → ui-driver 构造 Telegram Update{message:{text}}
  → tg-bot.handleUpdate(真实 bot.mjs, 走真实菜单/i18n/状态机)
  → bot 出口 sendMessage 被捕获 = { text: 真实渲染文案, reply_markup: 真实按钮 }
  → assert: 用户看到的文案/按钮符合预期(不是 assert mind 内部回复)
```

### 2.2 新 action(进 runner,与既有 send_message 并列不替换)
- `ui_message`: persona 发文本,经 tg-bot 全链,断言**用户端渲染输出**(text_contains/button_exists/i18n_lang)。
- `ui_tap`: 点击上一步捕获的 inline 按钮(构造 callback_query update),测菜单状态机流转。
- `ui_expect_dm`: **断言某 tg_user 收到一条 DM**(捕获 bot 主动 push 的 sendMessage)——直接服务眼前主线① broker 收益通知验收。

### 2.3 personas 零改动
现有 9 个 persona 的 `initialState/nextMessage` 接口不变,driver 层在它们和 bot 之间。cn_real_human 那种"怒骂纠错"trace 直接能在 UI 路径重放。

### 2.4 三条 MUST-FIX(NWT 设计审钉死·Phase1 一起交,不留 Phase2/3——它们是"这套测试会不会重演 broker-fee-emit 式假绿"的核心防线)
- **MF1 状态隔离必须 DI 注入(非只标风险)**:driver 必须像 broker-fee-emit 那样把 state(_state.json/会话)作为**注入依赖**喂给 bot,用隔离 fixture,不碰生产 _state.json。**落码前先核实 bot.mjs 现状是不是硬编码 state 路径**——若是,先改成可注入(这本身是前置改动,不是测试代码能绕的)。
- **MF2 `ui_expect_dm` 必须复用生产 poller,禁平行实现**:DM 到达的判定必须走 tg-bot 生产 poller(notifyLine `broker_fee_landed`)的**同一条路径**,不能在测试里另写一套"查事件→算该不该发 DM"的判断。否则=用一条平行判断路径验证另一条,**同一个病根验证病根本身有没有治好,结果无意义**(broker-fee-emit 0 行就是"以为在跑其实没通水"的活教训)。
- **MF3 否定断言必须读 skip 证据字段,禁纯超时判定**:`ui_expect_dm` 断言"没收到 DM=正常"时,必须能区分**业务规则合理抑制**(backfill-suppress / no_broker_output / below-floor,这些都有 metadata 证据字段)vs **管道静默失败**(emit 根本没扫到/事件没写/poller 没跑)。判定必须读那个证据字段确认是"合理抑制"——**纯靠"等了 N 秒没 DM 就算对"= 正是 broker-fee-emit 那种"零证据的活跃覆盖"假绿**,禁用。

### 2.5 两条补充(NWT 补,非阻塞但记)
- 合成 Update 对象绕过输入侧真实性:若 bot 有 webhook 中间件(鉴权/去重),handleUpdate 直喂会跳过它——落码时顺手核实,标注这层没覆盖(可接受边界或补)。
- Phase1 落码时 MF1-3 与主线① consumer 侧(J2 emit + KANet-UI poller)必须对齐同一 poller 实例,别各测各的。

## 3. 分期(先能立刻验主线①,再全覆盖)
- **Phase 1(眼前·配合 broker DM 主线)**: 只落 `ui_expect_dm` + driver 的 bot-出口捕获器。够验"结算→broker_fee_landed→真 DM 文案到达"端到端。工作量小,今天可与主线①联调同步落。
- **Phase 2**: `ui_message`/`ui_tap` 全菜单流(prediction-menu 状态机/托管钱包 /start 流/deep-link)。
- **Phase 3**: 把现有高价值 broker case(cn_real_human 等)镜像出 UI 版,双路径都跑(sync 快回归 + UI 真实战),CI 分层。

## 4. 待 NWT 设计审的点(请专打)
- **captured-出口 vs 真 Telegram 的等价性**:stub bot 出口=测了"bot 决定发什么",没测"Telegram 真发出去"。这是可接受边界(Telegram 传输不是我们代码)还是要补一个真 token 的冒烟?边界划哪。
- **handleUpdate 复用真实 bot 实例的隔离**:测试构造的 update 会不会污染 bot 的 _state.json/真实会话?driver 必须用隔离的 state fixture(同 offline-test-must-use-real-schema 纪律,别碰生产 _state.json)。
- **i18n 断言的脆性**:assert 用户看到的文案=耦合 messages.mjs 字面。按 guan2-test-behavior-not-rendering 教训,断言应测**行为等价**(含关键槽位值/按钮 callback_data)非字面 text-equals,防文案微调即红。
- Phase 1 的 `ui_expect_dm` 与主线① consumer 侧(tg-bot poller notifyLine)是否重叠——是复用同一 poller 还是独立捕获,J2/KANet-UI 对齐。

## 5. 不做什么
- 不接真 Telegram 服务器/真 bot token 进常规 CI(不可复现+速率限);真 token 冒烟另立手动 case。
- 不改既有 send_message 路径(sync 快回归保留,UI 是增量新路径)。
- 不新起 repo/package(挂 kasia-console QA 子系统,同既有定位)。
