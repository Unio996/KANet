# 进程分离批1 设计稿 —— B(内部API收敛) + C(信任边界) 合稿 v0.1

> **Status**: DRAFT — 待 NWT 红队 → Bettor 终验 → 落码
> 背景: 昨日对抗轮①收敛(v0.2 §七)裁定 B+C 合并为进程分离批1 同一次手术。B 主笔 KANet-UI, C 主笔 J2。
> Owner 直令议程(7/15): 模块化接入架构。本稿是"每应用=一个broker端标准接入KANet"愿景下, API层拆独立进程前必须先做的内部收敛。

---

## 一、B —— register/create 族收敛地图(KANet-UI)

### 1.1 现状清单(实测, `kasia-console/src/api/pool.js`)

| 端点 | 行号 | 定位 |
|---|---|---|
| `POST /api/pool/market/create` | 494 | 建市场, 无版本后缀 |
| `POST /api/pool/market/create-v06` | 768 | 建市场 v06 |
| `POST /api/pool/market/create-v07` | 988 | 建市场 v07(含 fee_rules commitment, zk_native 参数) |
| `POST /api/pool/market/:id/bettor/register-v07` | 1392 | 押注 v07(单步) |
| `POST /api/pool/market/:id/bettor/register-v07/prep` | 1603 | 押注 v07 两段式(prep) |
| `POST /api/pool/market/:id/bettor/register-v07/confirm` | 1642 | 押注 v07 两段式(confirm) |
| `POST /api/admin/pool/register-v07/confirm-by-address` | 1804 | 管理员按地址代确认(补登记通道) |
| `POST /api/pool/market/:id/bettor/register` | 2253 | 押注, 无版本后缀 |
| `POST /api/pool/market/:id/bettor/register-external/prep` | 2454 | 外部押注两段式(prep) |
| `POST /api/pool/market/:id/bettor/register-external/confirm` | 2499 | 外部押注两段式(confirm) |
| `POST /api/pool/market/:id/bettor/register-v06/prep` | 2662 | 押注 v06 两段式(prep) |
| `POST /api/pool/market/:id/bettor/register-v06/confirm` | 2699 | 押注 v06 两段式(confirm) |

12 个端点, 3 套版本号(无后缀/v06/v07)交叉 2 种模式(单步/两段式prep+confirm)。这正是 7/5 整顿钦定"调用方不选版本"目前不成立的具体证据。

### 1.2 实际调用方(实测 grep, 非猜——本节 2026-07-15 13:2xZ 频道对抗后已更正一轮, 见下方"更正记录")

| 端点 | 调用方 | 性质 |
|---|---|---|
| `market/create`(无版本) | `predictions-pool-create.eta` | **人类用户面**(web UI 建市场表单) |
| `market/create-v06` | 未找到直接字面调用 | 疑似死代码, 需二次核实(可能经动态拼接调用) |
| `market/create-v07` | `pool-market-seeder.js` / `worldcup-schedule-cron.mjs` | 系统内部自动建盘(seeder + 赛程自动开盘), 非用户直接触发 |
| `bettor/register`(无版本) | 未找到直接字面调用 | 疑似死代码, 需二次核实 |
| `bettor/register-v06/*` | `predictions-pool-detail.eta`(web UI 押注) / `prediction-agent-mind.mjs` / `tg-bot/test/dm-bet-e2e.mjs`(测试) | **dual-handle v0.6+v0.7**(见下方更正), 服务扁平 pool(50 bettor 硬顶, pool.js:2676), web UI 押注走这条 |
| `bettor/register-v07/*` | `tg-bot/prediction-menu.mjs`(**TG 机器人真实押注菜单**) / `pool-auto-better.js` / `pool-house-agent.js`(批0已关闭的 demo agent) | sharded bshard 架构(无 shard 数量硬顶), **真实大盘(如 kr5l4, 694 注/22 shard)靠这条扛** |
| `bettor/register-external/*` | 未找到直接字面调用 | 疑似死代码, 需二次核实 |
| `admin/pool/register-v07/confirm-by-address` | 手动管理员操作(非自动调用方) | 补登记通道, 保留 |

**更正记录(频道对抗 13:21-13:24Z, KANet-UI 自我更正+Bettor/J2 交叉核实)**: 本稿最初版本写"真实用户押注走 v06 不是 v07, v07 只被 demo bot 用"——**这个结论不完整, 已更正**。证据: kr5l4(694 注/22 shard)不可能走 register-v06(硬顶 50 bettor), 必然走 register-v07 的 sharded 架构；广搜后发现 `tg-bot/prediction-menu.mjs`(TG 真实押注入口)直接调用 register-v07, 此前搜索范围漏了 tg-bot 目录。

**真实情况(两层, Bettor 13:23Z 框架 + KANet-UI 细化)**:
1. **数据层无风险**: 7 月以来市场/押注对象在 DB 里的 `protocol_version` 字段 100% 是 v0.7(Bettor 库查), 钱全在 v0.7 结算逻辑里, 零资金风险。
2. **代码层是两套并行的真实实现, 不是"门牌不对但服务同一个东西"**: `register-v06`(dual-handle v0.6/v0.7, 扁平 pool 模型)服务网页 UI 的小规模市场；`register-v07`(sharded bshard 模型)服务 TG bot 的大规模市场。两者**架构不同**(扁平 vs 分片), 不只是版本号命名差异——收敛方案需要处理"要不要统一成单一架构"这个更深的问题, 不是简单改个 URL 名字。

**结论(更正后)**: 版本号≠调用频率≠架构成熟度, 三者独立。收敛顺序必须先画清楚"谁在什么规模下用哪个架构", 再决定统一目标, 不能按端点名字的版本数字大小做假设(这条本身也是本次犯错的教训——最初的 grep 范围没搜 tg-bot/, 只搜了 kasia-console/src/, 广度不够就下结论)。

### 1.3 收敛建议(草案, 待 NWT 红队 + 二次核实死代码)

1. **先做死代码核实**(非本稿假设): 对"未找到直接字面调用"的 4 个端点(`create-v06`/`register`无版本/`register-external/*`), 用 access log 或 events 表查过去 30 天真实命中次数, 排除"经拼接调用漏抓"的假阴性, 再定生死。
2. **押注路径的真正收敛目标应先问"v06 和 v07 语义差异是什么"**, 而不是默认 v07 胜出——如果 v07 语义更完整(如 fee_rules commitment), 目标应是让真实用户 UI 迁移到 v07, 而不是保留 v06 假装它是遗留。这是一步产品/协议决策, 需要 Owner 或 J2(建盘域)对齐后再落码, 本稿只标出这个决策点, 不代为拍板。
3. **API 层独立进程的对外标准面**(与 §二 C 部分/Owner 模块化议程衔接): 收敛完成后, 对外暴露的标准 register/create 应该是**单一 canonical 路径**(不含版本号后缀, 版本作为 payload 里的显式字段或走 header 协商), 呼应 Economic Kernel v0.1 §15 "已承诺的 Agreement 必须永久绑定其协议版本"——但这是**协议对象的版本绑定**, 不等于"URL 路径里写死版本号"这种实现方式, 两者不冲突但常被混淆, 落码时需要显式区分。

### 1.4 §六硬验收对照(Bettor 派工要求)

- **数据访问分类先行(2026-07-16 补齐, 实测非猜)**: 逐端点统计路由 handler 内联 `sqlite.prepare/exec/transaction` 调用次数(不含 helper 函数内部的, 只算 handler 自己直接调的):

| 端点 | 内联 sqlite 调用数 | 分类 |
|---|---|---|
| `market/create` | 6 | 重度内联 |
| `market/create-v06` | 4 | 中度内联 |
| `market/create-v07` | 6 | 重度内联 |
| `register-v07`(单步) | 10 | 重度内联 |
| `register-v07/prep` | **0** | **已委派**(全走 `_v07PrepConfirmPrelude` 等 helper) |
| `register-v07/confirm` | 8 | 重度内联 |
| `confirm-by-address` | 8 | 重度内联 |
| `propose-close-v2` | **0** | **已委派**(全走 `dispatchUnlockZkClose`/等价 service 函数) |
| `zk-handoff-v2` | **0** | **已委派**(全走 `buildZkHandoffRequestV2`) |
| `zk-close-v2` | 5 | 中度内联 |
| `zk-close-gate-debugger` | 9 | 重度内联(但只读, 见下) |
| `register`(无版本) | 9 | 重度内联 |
| `register-external/prep` | 2 | 轻度内联 |
| `register-external/confirm` | 10 | 重度内联 |
| `register-v06/prep` | 2 | 轻度内联 |
| `register-v06/confirm` | 10 | 重度内联 |

**结论**: 12 个端点里只有 3 个(`register-v07/prep`/`propose-close-v2`/`zk-handoff-v2`)已经是"薄路由委派 service 层"的形态, 剩下 13 个(部分端点算了 prep+confirm 两段)全部是路由 handler 直接内联大量同步 SQLite 调用——**这意味着"拆 API 进程"不是搬文件, 是要先把这 13 个端点的数据访问逻辑抽成 service 层函数, API 进程只调用 service 接口(走 IPC/命令通道), 数据访问逻辑留在核心侧进程**, 工作量比表面看的"进程分离"大得多, 是本次批1手术真正的主体工作。`zk-close-gate-debugger` 虽内联多但纯只读不广播, 风险等级低于其它重度内联端点(见批0设计稿"§六硬验收"里"数据访问分类先行"的判据: 内联本身不是问题, 内联+写资金状态才是问题——建议下一步按"读 vs 写"再细分一层, 本表暂只统计调用次数未分读写)。
- **restart-safety 第一天**: 拆出的 API 进程从设计起就要有 §二 C 部分说的信任边界隔离 + 自己的重启幂等性(参照今天 kaspad-watchdog/kanet-boot-sequence.ps1 的教训: 覆盖写日志/无 try-catch 静默死/端口冲突崩溃留 debris, 三个坑都要在新进程设计里提前避开)。

---

## 二、C —— 信任边界与合并进程分离设计(J2 立场, KANet-UI 2026-07-16 代整理并入正文——J2 会话已收尾转后台, 内容为频道原意逐字转写, 未替 J2 做任何新决策)

J2 核心论点: verify-value-source 类校验(链上真值核验)**不能**跟着 API 层一起拆出去——恰恰因为应用层是不可信输入源(呼应 NWT 议题3 立场), 这刀该切在"谁碰得到裸链上真值判定权", 而不是"谁是 HTTP 路由"。

具体切法: 拆出的独立 API 进程只做**协议翻译 + 速率限制 + 转发请求给内部命令通道**(镜像现有 relay = 唯一链上出口这条既有边界, 见 `KANet-Positioning.md` 角色分工); 真正的分润计算/链锚校验留在受信任核心侧(committee/settle/verify-value-source 全家桶), **不下放**给面向应用的 API 进程——这样即使某个应用把 API 进程打崩/打出漏洞, 能拿到的最多是拒绝服务, 拿不到伪造分润的能力。

J2 明确要求这条边界跟议题3(佣金管道 trustless, NWT 主笔)的信任边界画在同一张图上, 不要两条线各画各的——本稿 §三已做了初步对照, 完整合图待与 NWT 议题3 稿并轨(NWT 稿另立文件, 尚未核对是否已完成)。

**与 §一数据访问分类表(2026-07-16 补齐)的直接呼应**: J2 这条边界原则给了"数据访问分类"结果一个清晰的落点指导——分类表里标"重度内联"的 13 个端点, 拆分后属于哪一层不是随意决定的, 而是遵循 J2 这条原则: 涉及资金状态判定/分润计算的内联 SQLite 调用必须留在核心侧(即使目前是内联在路由 handler 里, 拆分时也要跟着判定逻辑走, 不能因为"文件在 API 层"就把它也搬过去); 纯路由级的数据读取(如 `register-external/prep` 那 2 处轻度内联, 大概率是查市场状态展示用)可以留在 API 侧做只读转发。这一层"内联调用的语义分类"(判定用 vs 展示用)本稿尚未逐条做, 是落码前的下一步。

---

## 三、与 Economic Kernel v0.1 的对照(Owner 模块化议程衔接)

- 本稿 §一 1.3 的反直觉发现(v06 vs v07 活跃度倒挂), 直接印证 Economic Kernel §9 `createAgreement` 能力评估里提到的"现在的承诺只覆盖费率一项"——收敛工作本身就是把隐式版本决策显式化为协议对象的 commit 字段的前置步骤。
- K-13/§9 `fund`+`claim` 的 custodial 架构性冲突(KANet-UI 已在频道发出), 与本节收敛工作是并行但独立的轨道——收敛内部 API 版本不解决 custodial vs 自持地址的信任模型问题, 两者不要在落码排期上混为一谈。

---

## 四、待办 / 未决

1. 4 个"未找到调用方"端点的死代码二次核实(access log/events 表)。
2. v06→v07 迁移(或反向)由谁拍板——本稿只标出决策点。
3. ~~J2 §二正式文本并入~~ → **已完成**(2026-07-16, KANet-UI 代整理并入)。
4. ~~逐端点数据访问分类表~~ → **已完成**(2026-07-16, 见 §一, 12 端点调用次数实测)。
5. **新增(2026-07-16)**: §二末尾提出的"内联调用语义分类"(判定用 vs 展示用, 而不只是数量统计)——落码前必须做, 决定每处内联调用具体该留核心侧还是可以留 API 侧只读转发, 本稿尚未逐条完成。
6. 与 NWT 议题3(佣金管道 trustless)稿的信任边界合图——J2 提过要求, 本稿未核对 NWT 稿是否已具备可合并的图。
