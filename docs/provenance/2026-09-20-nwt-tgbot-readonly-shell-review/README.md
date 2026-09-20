> **Status**: CURRENT（2026-09-20，NWT；对象 = 本地分支 `coord/kanetui-tgbot-p1-cr3` @ `61d5f588`（基线 `a4b00c5a`；A1 `a1b6f9e6` / A2 `6e210c9c` / A3 `1edb5afd` / B `61d5f588`，11 文件 +812/−14）；字节/渲染审；D-021：类别级）

# 电报只读壳（A+B）—— NWT 字节/渲染审

## 结论：**GREEN（0 条安全 MUST）——放行 Owner 亲测，附 1 个部署前置。** 你点的四项全部核实成立；另有 1 个"文案承诺与代码不一致"的必须在开闸前落实（部署一步即可），1 个潜伏的方向问题（现网不可达），若干 SHOULD。
D-031 第一判据：A1 复用 `lib/kaspa-network.mjs`（先校验和再比前缀），A2/A3 复用 `prediction-menu`/`console-api`/i18n 与既有 `GET /api/proto-markets`，没有另造；A3 对原 handler 零改。

## 做法
把该分支的 tg-bot / link 相关 blob 用 `git archive` 取到我自己的检出（`D:\kanet-nwt-cand`，独立 node_modules，生产检出零触碰）原样执行，用完还原；测试之外自己写探针与变异，全部只读。

## 你点的四项
**① 不泄露——成立。** `toBotMarket` 是**新建对象**（键固定为 `id / question / state / deadlineSec / minBet / tokenTicker / tokenName / result`），不是对行的展开，所以委员会公钥 / `rootclose_*` / `shardleaf_*` / `payout_root` / `*_txid` / `judged.*` 根本进不了渲染层。我用**真实形状**的 `/api/proto-markets` 行（`PUBLIC_MARKET_COLS` + token 列 + 批 B 的 `judged`）、每个内部字段塞唯一哨兵串，对 7 种状态 × 中英 × 列表+详情+按钮 `callback_data` 全量扫描：**哨兵命中 0**。回调数据只带 id 前 16 位（公开）。全部回复不带 `parse_mode`（纯文本），问题文本里的 `<b>` 不会被解释。变异"白名单改成 `...row` 展开"、"放出 payout_root"都被杀。
**② 方向渲染——对（非判定题）。** `winning_side` 0=YES / 1=NO，与既有 web 页 `proto-market-detail.eta` 第 84 行 `winning_side === 0 ? 'YES 赢' : 'NO 赢'` 及下注按钮（YES=0 / NO=1）**同一约定**；`null / undefined / 2 / -1 / "0" / true` 一律 `null`（不猜）；`sealed` 状态即使 `winning_side` 已写也**不显示结果**（不会提前剧透，也不会在批 D "写值后冻结"时误报）；变异"方向翻转 / 非 0-1 猜 NO / 提前显示"全杀。渲染证据页里主网 `a59c` 显示"结果 NO"与库里 `winning_side=1` 一致。⚠ **判定题市场有例外**（F1）。
**③ 原 handler 零改——字节确认。** `bot.mjs` 的 diff 是 **+6 行 / −0 行**（2 行 import + 1 段注释 + 1 行 `if (isReadonlyShell(CONFIG)) registerReadonlyShell(...)`），原有 handler 一个字节没动。注册位置在原 `/start` 之前，且原文件里更早的只有 `bot.catch`，所以壳的 handler 先于全部原 handler；传入的 `linked`（第 48 行 `const`）在调用之前已定义、`getLang`/`initLang` 是函数声明（提升），无 TDZ 风险。原有的 **7 个 `callbackQuery`**（`lang:toggle / mybet:addmore / bet:market / bet:side / nav:faucet / nav:mybets / nav:hot`）**全部**被壳接管或拦下；原有的钱/托管命令 `wallet balance receive send confirm cancel faucet swap broker_apply` 全在隐藏名单（变异"去掉 send / faucet / bet:side 拦截"被杀）。仅 `KASPA_NETWORK=mainnet` 才启用。
**④ CR-3 服务端——成立。** `link.js` 复用 `kaspa-network.mjs` 的 `checkAddressOnNetwork`（先 `Address.validate` 再比前缀）。我用**真 Fastify + 真迁移库 + 真 ingest 鉴权**，一条条跑：主网库 + **真合法的 `kaspatest:` 地址**（旧 `startsWith('kaspa')` 会放行）⇒ **400 `prefix-mismatch`，库里不新增行**；主网 + 合法主网地址 ⇒ 200；坏校验和 / `kaspa:zzzz` / `kaspasim:` / `kaspaXYZ`（无冒号）/ 大写 / 前导空格 / 对象 / 空 ⇒ 400；`KASPA_NETWORK` 未设 / `foo` / `Mainnet`（大小写）⇒ **503 `network-unset`**；testnet-12 库 + 合法 `kaspatest:` ⇒ 200（对照臂）、testnet-12 库 + 主网地址 ⇒ 400 `prefix-mismatch`；无 / 错 secret ⇒ 401（鉴权先于网络判定）。bot 侧只把 `prefix-mismatch` / `invalid-checksum` 映射为用户文案，其余码走既有 `link_fail`，且**任何拒绝都不持久化**（变异"console 拒绝也落库"被杀）。

## 验证数据
- 分支自带测试在我的检出上复跑全绿：readonly-shell 16 / readonly-handlers 15 / readonly-i18n 6 / link-network 21。
- 我写的 17 个变异（方向、白名单、可见集、单位、前缀查找、隐藏名单、CR-3 三种回退）**17/17 全杀**，树已还原。
- 主网只读事实：`pool_markets`=0 / `pool_bettor_sides`=0 / `exchange_offers`=0 行，`broker_onboarding`=0 行。

## 必须在开闸前落实（1 个部署前置 + 1 个潜伏项）
**F2 文案承诺"旧的绑定与会话已重置"与代码不一致，需要一个部署步骤（或一段清理代码）。** `/start` 的定稿文案对用户说"旧的绑定与会话已重置，请重新绑定"，但代码里**没有任何重置逻辑**。生产检出里有活的 `tg-bot/_state.json`（gitignored，2026-08-04 的 371 KB）：**4 条 `kaspatest:` 绑定 + 4 个残留下注会话（stage=amount/detail/detail/market）+ 9 条语言偏好**。bot 启动会把它整个加载：① 这 4 个用户的旧 `kaspatest:` 地址继续被 `pollLoop` 拿去查主网事件、被原 `/broker` `/earnings` 当作"已绑定地址"；② 这 4 个用户直接打字（不经 `/start`）会落进原 `bet` 会话的 `message:text` 处理（它是原 handler，壳没有拦）——主网 `pool_markets`=0 所以走不到付款，但会回一段 TN12 时代的下注流程文案，与"只读壳"不符。要求二选一：**（推荐）在 `registerReadonlyShell` 里加一段启动清理**——主网模式下丢弃前缀≠`kaspa` 的已绑地址、清空残留会话（只在壳里，不动原 handler）并加测试；或**把"部署前把 `tg-bot/_state.json` 移走（改名留存，别删）"写进上线清单**并在交付里注明。Owner 亲测前请至少做后者，否则 `/start` 那句话对他是假的。
**F1（潜伏，现网不可达）判定题市场的结果方向会显反。** 批 B 允许 `side_map` 取 `{yes:1,no:0}`（判定题的 YES 可以是 side 1），公开读已带出 `judged.side_map`；但壳对所有市场一律 0=YES / 1=NO 且不看 `judged`。实测：判定题、`side_map.yes=1`、`winning_side=1`（= YES 赢）⇒ 壳显示 **NO**。主网现在没有判定题（需要白名单代币+开关，均未开），所以**不影响 Owner 亲测**；但这是"显错赢家"，请在**任何判定题市场能在主网出现之前**修：判定题用 `judged.side_map` 换算（或对判定题不显示 YES/NO 只显示"已结算"），并加对照测试。

## SHOULD（不阻塞）
1. **时间显示不准**：`hoursLeft` 用 `Math.round`——距截止 29 分钟显示"**已过截止**"、31–89 分钟显示"还剩 1 小时"（实测）。开放中的市场最后半小时被说成已过期。建议 `Math.ceil` 并在 <1h 时显示分钟。
2. **文本清洗**：`cleanText` 去 URL 和 C0 控制符，但**不去双向控制符**（U+202E 等，实测保留）；详情页问题文本**不截断**（列表 56 / 按钮 28，详情无上限，实测 419 字原样输出）。建议去 bidi/零宽并给详情设上限（如 300）。
3. **i18n 编辑是全局的**：B 笔改了既有键（`verify_redirect / earnings_no_link / broker_role_* / earnings_testnet_note / fee_dm_testnet_note` 等）为"主网"措辞，这些键在 TN12 模式下也会变——"TN12 原样"在**处理逻辑**上成立、在**这几条文案**上不成立；TN12 已退役（D-017），知悉即可。
4. **原 handler 仍可达的路径**（壳不是纯只读）：`/broker`、`/earnings`（对**未验证归属**的已绑地址查 broker 状态/收益/节点收入，`ro_help` 已写"运营者功能"）、`/support` 与**任意非命令文本 → `feedbackReply`**（转给 console 反馈 agent，会落工单）、`/lang`、`/verify`，以及 `pollLoop` 对已绑地址的事件 DM。`/link` 也没有归属证明。请确认这是有意的开放面；若要更严，把 `broker/earnings` 加入隐藏名单、把自由文本引到 `ro_unavailable`。
5. `RO_HIDDEN_COMMANDS` 含 `broker_apply` 而不含 `broker`——`ro_help` 的"/broker /earnings：运营者功能"一致，仅提示。

## 我没做
未启动真实 bot、未接真实 Telegram、未部署；F2 的清理逻辑我没有验证（它还不存在）。
