> **Status**: CURRENT

# 原型 v0 范围稿：代币/市场可跑原型 + 人类配置界面

**出处**：Owner 2026-09-14 终端直令三点（COORD-LEDGER 待补条目）——①尽快出可跑原型，不求完美；②人类设置/操控/使用必须简洁清晰完整；③代币属性配置需要界面互动。安全/漏洞/功能完善留后面。
**Bettor 裁**：市场原型走快车道；**资金闸（loopback-authz / admin-secret-tier）维持原节奏，不因本任务减速、不合并进本任务**——理由见 §3。

---

## §0 一句话目标

一个人能在浏览器里：填代币参数 → 生成/铸造一个 KTT 测试代币 → 用它开一个市场 → 有人下注 → 市场结算 → 赢家能在界面上看到并 claim。全程跑在 da9 主网 console 上，用测试币，不动任何真实 KAS。

**验收线（"能跑"的最低定义）**：上面这条链路人工点一遍，全部走通，不追求好看、不追求防攻击。

---

## §1 范围内（v0 做）

1. **代币创建界面**：表单填 genesis 参数（对照 `kasia-console/src/lib/sil-v1/KanetTestToken.sil` 当前 ctor：`init_amount` / `init_owner` / `init_owner_scheme` 等），生成创世 P2SH 输出并广播。人类只需要填有意义的那几项（数量、名称/ticker 这类展示用元数据，链上没有的放 DB），其余协议级常量（`market_tmpl_suffix`、`max_ins/outs` 等）界面不暴露、后端钉死。
2. **市场创建界面**：选一个已创建的代币 → 填市场参数（议题、结算方式、截止时间等）→ 生成市场创世。**T3 市场合约（PayoutShard/RootClaim 等）现在散落在 `docs/provenance/*` 和 worktree 里，没有收拢到 `src/lib/sil-v1/` 单一目录**——J2 第一步先把主网集 10 个 .sil 收拢成单一权威目录 + 列出每个合约真实 ctor 字段，这是界面能填什么的事实依据，不能靠猜。
   > 📌 **更正（2026-09-14 · J2 实核 `docs/2026-09-14-j2-mainnet-sil-ctor-fields-v0.1.md` §0 · Bettor 认）**：上面"散落在 provenance/worktree"是 Bettor 的错误前提——10 个主网集 .sil **已在 `kasia-console/src/lib/`**（9 个平铺 + T1 在 `sil-v1/`），git clean 与 HEAD 一致；真问题是与 ~30 个遗留/probe/rolling 架构 .sil 混在同一平铺目录，靠文件名分不出主网集。**Bettor 裁：v0 不做物理 `git mv`**（~50 处生产引用横跨活跃结算 daemon，且是 da9 生产进程在跑的同一份代码，改错 = 下次重启起不来，与"先跑起来"背道而驰）；改为 **J2 出一份主网集清单文件**（路径 + sha256，放 `scripts/` 与 D-019 的 `silverc-pin.json` 并列，作"哪 10 个是主网集"的单一声明）；物理搬迁 + 引用路径重写并入 (1317) 目录改名/合并运维窗（本来就要重启验证），不在原型期做。**禁用软链接方案**（规则 81 junction/链接事故族）。
3. **下注/参与界面**：复用现有 `market.eta` / `market-v2.eta` / `my-markets.eta` 页面框架，接到新合约。
   > 📌 **更正（2026-09-14 · KANet-UI 读源码发现 + Bettor 独立核实确认）**：`market.eta`/`market-v2.eta` 实为 OTC/exchange 订单簿页面（KAS↔USDT 买卖盘，Bettor 独立读源码确认：`market-v2.eta` 含"卖出 KAS"/"买入 KAS"/价格(USD) 字段，与预测市场下注无关）。真正对应"下注/参与"与"结算/领取"的既有页面是 `predictions.eta`（列表）+ `predictions-pool-detail.eta`（详情+下注+claim，Bettor 核实其源码含 oracle 审计/YES-NO/claim 相关内容）。§1.3/§1.4 以此订正为准，详见 `docs/2026-09-14-kanetui-token-market-prototype-v0-wireframe.md`。
   > 📌 **二次更正（2026-09-14 · KANet-UI 动手前核 · Bettor 独立核实后裁）**：`predictions-pool-create.eta`（989 行）是当前生产 bshard/ZK 结算管线的真实入口（POST `/api/pool/market/create` + prevet + oracle 委员会 registry + Polymarket 搜索，34 处引用），`partials/sidebar.eta:81-83` 记 Owner+Bettor 2026-07-04 刻意将其从公开导航隐藏（主用户面 = tg-bot）。**裁：市场创建/下注/claim 三屏不扩展任何既有 `predictions*` 页面，另起全新简单页面**（独立路由前缀，不得落在 `/predictions/pool/*` 下；复用 page-open/page-close partials + Editorial 样式——这才是 §1.5"复用模板体系"的本意，不是嫁接到承重生产页）。对既有 `predictions-pool-create.eta` / `predictions-pool-detail.eta` / `predictions.eta` / tg-bot **零改动**。**后端同构要求（J2）**：原型的市场/下注/claim 状态放**新表**（或明确命名空间），**禁止写入 `market_shards` / `payout_shards` 及任何 `bshard-settle-daemon.mjs`（31 处引用）等生产结算 daemon 轮询的表**——否则原型市场会被生产 ZK 结算线捡走处理。原型 = 与现网并存、可整体删除的独立薄层。
4. **结算/领取界面**：复用/扩展 `my-markets.eta`，显示 claim 状态与操作。
5. UI 一律复用 console 现有 `.eta` 模板体系与配色，不引入新前端框架。

## §2 范围外（v0 明确不做，写清楚防止范围蔓延）

- **T4 市场创世全量字节对照验证工具**——不做，v0 靠人工肉眼核对 + Bettor 独立核，不建自动化闸。
- **ZK 结算路径（CloseZkV2 / Groth16 证明生成）**——如果 J2 判定某条 claim 路径必须过 ZK proof 才能结算，v0 先绕开、用非 ZK 的简单 claim/refund 路径过一遍；ZK 路径留到"完善安全/功能"那一轮。
- **loopback-authz 第二道闸、admin-secret-tier**——继续独立跑，不并入本任务，也不因本任务延后。
- 完整红队审查——本任务只做 §3 定义的"轻量核"，不是标准 NWT 红队全流程。
- 多用户并发、美观度、i18n、错误提示打磨——都不是这轮的事。

## §3 唯一不能碰的边界：真实资金私钥

da9 这台 console 进程里同时持有 **≈584 KAS 热钱包私钥（17 relay）+ 21,300 KAS 冷存账户信息**（COORD-LEDGER 1320）。原型可以糙，但：

- 新代码**不得**新增任何读取/导出私钥、调用 `startRelay()`、碰 `ADMIN_SECRET_*` 相关路由的路径；
- 新界面**不得**复用/暴露现有 `/relays/*` `/api/relay/*` 系列私钥相关端点；
- 需要"发一笔交易"的地方，走市场/代币合约自己的花费逻辑（P2SH 构造 + 广播），不经过 relay 热钱包持仓管理那一套。

NWT 轻量核**只看这一条**：扫一遍新增代码有没有碰到上面三类路径，不做别的全面审查。

## §4 派工

| 谁 | 干什么 | 第一步交付 |
|---|---|---|
| **J2** | ①收拢 10 个主网集 .sil 到 `src/lib/sil-v1/` 单一目录并列出每个合约真实 ctor 字段清单；②后端 API：代币创世 / 市场创世 / 下注 / claim 各一组端点，只走合约花费逻辑，不碰 relay 私钥路径 | ctor 字段清单（今天内） |
| **KANet-UI** | 界面：代币配置表单 + 市场创建/浏览/下注/claim 页面，复用现有 `.eta` 框架；先出线框（哪几屏、每屏填什么），等 J2 的 ctor 字段清单定下来再接真实字段 | 线框稿 |
| **NWT** | §3 边界轻量核（新代码 diff 扫一遍上述三类路径），不做全面红队；同时继续原节奏审 loopback-authz，两件事不互相阻塞 | 边界核清单 + loopback-authz 照常推进 |
| **Bettor** | 协调 + 每个阶段独立核实（不信自报）+ 决定"能跑"验收是否达标 | 全程 |

## §5 时间预期

Owner 要求"尽快"。不设硬 deadline，但每一步做完立即报（COORD-LEDGER + SendMessage），不攒批。卡住立刻说，不憋着。
