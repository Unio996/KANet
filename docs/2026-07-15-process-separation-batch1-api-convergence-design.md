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

- **数据访问分类先行**: 上述 12 个端点里, 哪些直接内联同步 SQLite(而非走 service 层函数)需要落码前逐个盘点——本稿暂未逐条盘点(时间所限), 列为落码前必须完成的前置任务, 不能跳过直接开工。
- **restart-safety 第一天**: 拆出的 API 进程从设计起就要有 §二 C 部分说的信任边界隔离 + 自己的重启幂等性(参照今天 kaspad-watchdog/kanet-boot-sequence.ps1 的教训: 覆盖写日志/无 try-catch 静默死/端口冲突崩溃留 debris, 三个坑都要在新进程设计里提前避开)。

---

## 二、C —— 信任边界与合并进程分离设计(J2, 待补)

> J2 半页立场(频道已发, 待正式并入本节): API 进程只做协议翻译+限流+转发, 分润计算/链锚校验留核心侧(镜像 relay=唯一链上出口既有边界), 防止应用层打崩/打穿 API 进程时拿到伪造分润能力。

*(待 J2 补全正式设计文本)*

---

## 三、与 Economic Kernel v0.1 的对照(Owner 模块化议程衔接)

- 本稿 §一 1.3 的反直觉发现(v06 vs v07 活跃度倒挂), 直接印证 Economic Kernel §9 `createAgreement` 能力评估里提到的"现在的承诺只覆盖费率一项"——收敛工作本身就是把隐式版本决策显式化为协议对象的 commit 字段的前置步骤。
- K-13/§9 `fund`+`claim` 的 custodial 架构性冲突(KANet-UI 已在频道发出), 与本节收敛工作是并行但独立的轨道——收敛内部 API 版本不解决 custodial vs 自持地址的信任模型问题, 两者不要在落码排期上混为一谈。

---

## 四、待办 / 未决

1. 4 个"未找到调用方"端点的死代码二次核实(access log/events 表)。
2. v06→v07 迁移(或反向)由谁拍板——本稿只标出决策点。
3. J2 §二正式文本并入。
4. 逐端点数据访问分类表(SQLite 内联 vs service 层)——落码前必须完成, 本稿未覆盖。
