> **Status**: CURRENT（2026-09-20，NWT；对象 = `coord/kanetui-d028-watch-only-accounts-impl` 头 `c1eec6bf`（已随 `32b4bee4` 合入主线，审后补）；Bettor 令：一轮、只报 MUST）

# D-028 实现审（冷存只读账户）—— NWT：**GREEN，无 MUST**

独立检出（`D:\kanet-nwt-cand`，`c1eec6bf`）；亲跑五份测试；用**真实依赖**对本机主网节点做只读端到端（`outputs.txt` §1，只打印状态 / 布尔 / 计数，不含地址、金额、名字）。

| Bettor 点名的 MUST | 结果 |
|---|---|
| 不持钥 | ✅ `watch_accounts` 无任何密钥列，`custody` 被 CHECK 钉成唯一值 `cold_no_key`；登记脚本只收"名字 + 地址"文本（`--from-file` 仓库外路径 / stdin，拒任何命令行地址），无密钥入口；读取服务无密钥代码。 |
| 无写口 | ✅ 真实 Fastify 上注册后路由只有 `GET`/`HEAD` 的 `/api/watch-accounts[/:id]`；对这两个路径发 `POST/PUT/PATCH/DELETE` 全部 404（`outputs.txt` §2）。全仓对 `watch_accounts` 的引用只有迁移、登记库 / 脚本、读取服务与 GET 路由。 |
| 不渲染 0 | ✅ **真实形状端到端**（本机主网节点 + 活库 `relay_nodes` 18 个 `kaspa:` 地址做阳性对照）：E1 从未使用地址 ⇒ `ok` 且为 0（有阳性对照才认）；E2 有余额地址与直接读同一节点**数值相等**；E3 批量按地址匹配、顺序无关；**E4 没有热地址可对照 ⇒ `unavailable(no_positive_control)`、`balanceKas=null`**；**E5 节点不通 ⇒ 5 s 内 `unavailable`、`null`**。模板对非 ok 状态渲染"—（无法读取）"而不是 0，总计里有读不到的账户时明示"总计不完整"。 |
| 不进有钥集合 | ✅ 表不进 `relay_nodes`；登记脚本对 `watch_accounts / relay_nodes / agent_wallets` **规范化后**去重并拒绝（防冷热双计）；隔离测试 3/3（真实迁移临时库 + 真实 `autoSplitAll`，冷存被选中 0 次且有阳性对照）；portfolio 仅"全部 agents"视图并入，`?relayId=` 不含，`totals.kas` / `grandTotalKas` 既有含义不变。 |
| 迁移号不撞主线 | ✅ 主线上唯一的 `v211` 就是本笔；我扫了 origin 全部其它分支，无别处占用 v211；主线原最新为 v210。 |
| 登记脚本 `--apply` 前的核对 | ✅ 默认 dry-run；必须 `DB_PATH`（client.js 拒绝猜活库）；输入文件必须在仓库外；只认 mainnet `kaspa:` 前缀；全有或全无（任一行被拒 ⇒ 什么都不写）；回执只打条数与前缀 + 末 6 位。**未做**：我没有对活库跑该脚本（输入是 Owner 的真实冷存地址）。 |

亲跑：static 9/9、balance 24/24、register 15/15、api 9/9、isolation 3/3（需 `--experimental-test-module-mocks`）。

**非 MUST（一行记票，不要求下一版）**：读数依赖"本机节点已同步"，未同步窗口页面会显示"无法读取"（诚实但会闪）；阳性对照依赖至少一个热钱包余额 > 0，热钱包全部清零时冷存页整体变成 `no_positive_control`。都是设计里已知的取舍。上线还需重启 console 才会建表（迁移）。
