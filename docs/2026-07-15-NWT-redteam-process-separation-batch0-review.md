# NWT 红队 review — Console 进程分离 批0 kill-switch 设计审查(2026-07-15)

> **Status**: CURRENT — verdict 已发频道, 待 KANet-UI 落码时按下方 MUST-FIX①收编
> 审查对象: `docs/2026-07-14-console-process-separation-architecture.md` v1.0(f4525dee)。范围按 Bettor 派工聚焦: 批0 kill-switch 清单安全面 + 批次边界 + 回滚面。

## 裁定: **批0 有条件批准(APPROVE with 1 MUST-FIX)**

架构方向(进程分离/分批/可回滚)本身没问题, 病根量化(68循环/979同步调用)跟已有系统全景图一致, 不是重造。批0"关demo负载"思路对。但红队按"默认假设有洞"核了每个要关的循环具体做什么(不是只看模块名), 找到一个真实的资金安全漏洞, 必须先堵再上线。

## MUST-FIX① 🔴 market-seeder 三循环绑在一个开关里, 会连坐关掉真实资金退款监控

**实测代码**(`kasia-console/src/index.js:729`, 未commit的bisect分支, Bettor确认批0落码会转正这段):
```js
if (process.env.DEMO_SEEDER_OFF !== '1') { startMarketSeeder(); startSeederDepositWatcher(); startSeederRefundWorker(); }
```
一个开关同时控制 3 个本质不同的循环(`market-seeder.js` 逐个读实):
1. `startMarketSeeder()`(5min tick) —— 纯创建新的 demo 挂单, **确实是 demo, 关掉安全**。
2. `startSeederDepositWatcher()`(30s tick) —— 监控 `retail_dex_buy_publications` 表 `awaiting_deposit → deposited → published`, **这是在处理真实用户往 seeder 买单充值的资金状态机**, 不是 demo。
3. `startSeederRefundWorker()`(30s tick) —— 扫 `retail_dex_buy_publications` 里 `state='published' AND expires_at < now` 的过期单, **自动退款给用户**(唯一的资金安全出口)。

**攻击场景**: 设计文档明说"只在需要 demo 时开"(会话内反复开关)。假设某次开启期间, 一个真实用户往 seeder 的 buy-side 挂单充值(进 `awaiting_deposit`/`published` 状态), 团队随后按批0设计把 `DEMO_SEEDER_OFF` 切回 1 关闭 —— **①②③一起死, depositWatcher 不再推进状态、refundWorker 不再退过期款** = 用户的钱卡死在 seeder 手里, 没人管, 直到某天有人想起来重新打开开关才可能被捞回(且 refundWorker 只处理 `expires_at < now`, 关闭期间时钟照走, 重新打开后一次性触发批量退款, 行为也没验证过)。

**实测当前风险**: 现在 `retail_dex_buy_publications` 表 0 行(表空), **今天上批0不会立刻炸雷**, 但设计一旦定型(开关反复用), 下一次有真实充值在途时切换就会踩雷 —— 这跟本周一直在治的 Z20 资金卡死是同一类坑(族B/E铁律: covenant/资金收款前必验 exit-path 矩阵), 不能带着已知漏洞上生产使用模式。

**修法(任选其一, 落码时二选一即可, 不阻塞批0今天上)**:
- **A(推荐, 改动最小)**: 拆开关 —— `DEMO_SEEDER_OFF` 只控 `startMarketSeeder()`(创建新单), `startSeederDepositWatcher()`+`startSeederRefundWorker()` **永远跑**(30s tick 两个索引查询, 成本可忽略, 不影响"68→<30"这个减负目标)。
- **B**: 保留原开关, 但关闭前加一次性 drain 检查 —— 若 `retail_dex_buy_publications` 有非终态行(`awaiting_deposit`/`published`), 拒绝关闭或先跑一轮强制处理。

## 其余审查项(核过, 无阻塞)

- **pool-house-agent**: 只影响 HouseAgent 自己未来是否继续押注, 不影响它已下的注的结算(结算是独立的 pool-settler, 未在批0关闭范围)。已下的注按正常流程走, 不会孤儿。**安全**。
- **pool-bot-autofund**: 读代码确认监控范围严格限定 `AutoBetter-1/2/3` + `HouseAgent` + `UnderdogBot` 四个 demo relay 名字(`_monitoredRelayNames()`), 跟 broker/其它生产 relay 的 gas 补给无耦合。**安全**。
- **31 agent Mind proactive/reflection**: `mind-manager.js` 里 `_proactiveEnabled`/`_reflectionEnabled` 是独立于 reactive(响应收到的消息)的模块级开关, 代码注释自己也把 reactive/proactive/reflection 三分——关掉 proactive+reflection 理论上不动 reactive 路径, 不会让 Owner 反馈的"Martin/TG 转发失败"变得更糟。**建议 KANet-UI 落码 diff 里我会重点确认这个开关没有连坐碰到 reactive 分发入口**(现在只是静态读代码判断分离, 没有跑起来验证, diff 审时补上这一环)。
- **pool-market-seeder**(注意跟 market-seeder 是两个不同文件): 当前代码(`index.js:734`)**完全没有 kill-switch**, 是无条件启动。设计文档把它列进批0目标, 落码时**需要新加**开关(不是改现有的), 单循环结构(只查到 1 个 setInterval), 未见绑定资金状态机, 初步判断加开关本身风险低, 但落码 diff 审时会核实这条 tick 具体逻辑(还没细读)。

## 批次边界 / 回滚面 意见

- **回滚安全**: 所有开关都是 `!== '1'` 判定(env 未设=默认跑), 失败方向是"忘了设=功能全开", 不是"忘了设=误关"——这是对的容错方向, 维持。
- **批0 判据缺一个时间盒**: 设计文档"如果冻结随之消失,凶手就在这批里"是好的实验设计, 但**没写多久算数**——建议 Bettor/KANet-UI 装载后定一个具体窗口(比如 2-4 小时或 N 次 tick 采样), 到点用数据(`[diag:eventloop-lag]`频率对比装载前)拍板"批0够了 vs 直接推进批1", 避免无限期悬着不表态。
- **报数口径提醒**: 批0**不直接触碰** Owner 具体反馈的"Martin/TG 转发失败 Relay-not-running"路径(那条链在 tg-bot/broker-bot-manager, 不在批0关闭清单里)——批0能降低整体冻结频率从而间接缓解, 但不构成"这条具体故障已修复"的证据。按已有纪律(报数用级别词, 不过度宣称), 批0上线后若 Owner 那条具体反馈仍复现, 不是批0失败, 是预期内(该问题落点在批2 broker 范围)。

— NWT
