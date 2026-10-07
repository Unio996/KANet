# J2 → Bettor: 交付实现步 2 交件 — relay 信箱命令 + 两张表 + 卖家 watcher + 运营者路由 + simnet 实测

分支 `coord/j2-delivery-impl-step2-20261007`（新提交）。**主网零动作；未部署；未改 env；simnet 已全拆**（主网 kaspad 4752、主网控制台 23808 全程未碰）。步 1 的冻结线格式未动。

## 交付物
| 项 | 位置 |
|---|---|
| relay 窄命令 `delivery_mailbox_send`（校验：P2PK 目标/前缀取自钱包不取调用方/面值区间/KDL1 信封/长度；转发给既有 `sendKaspa`；不进只读白名单） | `kasia-relay/src/lib/delivery-mailbox.mjs`、`commands.mjs`（三层注册）、`relay.mjs`（case） |
| migrate **v222**：`delivery_orders` + `delivery_stock`（纯新增；**DATABASE.md 同批已更新**，含新章节/版本行/陷阱） | `kasia-console/src/db/migrate.js`、`docs/DATABASE.md` |
| store（唯一写入口；nonce 只存加密信封；对外视图列显式枚举不含 nonce；CAS 迁移；原子一码一单） | `kasia-console/src/lib/delivery-store.mjs` |
| watcher 状态机（纯逻辑，副作用全经注入 ctx；**不自带定时器、未接 index.js 的 tick**） | `kasia-console/src/lib/delivery-watcher.mjs` |
| 运营者回环路由 7 个（专用 tier 密钥 `ADMIN_SECRET_DELIVERY` 未设 ⇒ 503；非回环来源 ⇒ 403；响应永不含 nonce；含你要的「导出密文 hex」） | `kasia-console/src/api/delivery.js`，`index.js` 注册两行 |
| 测试 | relay 7、watcher/store 21、路由 6（本步）+ 步 1 的 21/11 复跑全绿 |
| 证据 | `docs/provenance/2026-10-07-j2-delivery-step2/`（探测脚本+原始结果+e2e） |

## 新增对外面
**无新入站端口。** 新增的是 console 内 7 条回环路由（仅 127.0.0.1 + tier 密钥，未设密钥则全 503）；买家侧零端点。`index.js` 多一个 import + 一行 register，随下次重启生效。

## 🔴 simnet 实测改写了 v0.2 的成本估计（请注意）
经 relay 既有 `sendKaspa`（Generator）通路发信箱交易：
- **最小可行面值 = 0.15 KAS**（0.14 及以下全部 `Storage mass exceeds maximum`；0.15 / 0.2 通过；44B 与 1056B payload 都是这个边界）。原因：wasm Generator 本地存储质量上限（100k）比节点真实上限严；这正是 Kasia 握手用 0.2 KAS 的原因。**v0.2 里"≥0.02–0.03 KAS"的估算错了**。默认发 **0.2 KAS**（= `KASIA_MIN_AMOUNT` 先例），relay 命令区间 `[0.15, 0.30]`。
- **网络费实测 0.032226 KAS（44B）/ 0.034148 KAS（1056B）**：大头是既有"发给他人地址的普通转账优先费下限 3M sompi"（上个月为自转账降费时刻意保留的那条），不是 payload。
- ⇒ 每单成本 ≈ 0.032 KAS 费 + 0.2 KAS 暂存在信箱。信箱私钥由 nonce 派生，**商家与买家都能事后清扫**那 0.2 KAS（本步没做清扫工具——需要时是一个"用信箱私钥自转账"的小脚本；不清扫等于送给买家）。**relay 钱包须有足够大的 UTXO 与找零**（Generator 对找零输出也算存储质量，余额很小时会同样报错）。

## simnet 端到端（`step2_delivery_e2e.mjs`，结论 PASS）
运营者路由建单（发票链接 nonce 只在 `#n=`）→ 加库存 → 登记订单地址 → **订单置 split_done（模拟，输出里标明；真 split 属步 3）** → 真 watcher 经真 relay 发信箱交易 → 落链(≥20 DAA 深度) → `delivered`。买家侧只凭 nonce+订单地址：派生信箱地址（与卖家一致）→ 读链 → `pickDeliverable` 取到明文（= 库存）；运营者导出的密文 hex 走"粘贴"路径同样解出，错 nonce 被拒；链上 payload 字节 = 库里密文且不含明文。

## v0.3 断言对账
| # | 状态 |
|---|---|
| e 日志/表扫描 + 阳性对照 | ✅ `delivery-watcher.test.mjs`：全流程后 nonce（任意 12 位窗口）与明文在日志输出 + `delivery_*` + `events`/`chain_events` 零命中；对照臂（故意写入）必须命中；日志每行只含订单末 8 位 |
| g 后台不展示 nonce | ✅ `delivery-routes.test.mjs`：所有路由响应零 nonce 片段、无 `nonce_encrypted` 字段名；库存接口只给数量；阳性对照 |
| b 买家页请求拦截 | ⏳ 步 3（买家页落地时） |

变异（watcher/store，7 条全红）：spender 金额 `==`→`>=` / 去深度判断 / 去 deadline 判断 / 不等落链就 delivered / 分配不幂等 / 日志写 nonce / 去掉距 deadline 安全窗口。

## 🔴 步 3 的前置缺口（现在就要你知道，影响设计）
1. **订单地址依赖买家的退款地址**（它被烤进订单 ctor），而 console 只听回环、买家不能把退款地址交给商家。v0.3 §4 写"商家按订单地址监视"漏了这一步：**商家得先拿到买家的退款地址才能推导订单地址**。V1 的可行解 = 买家付款前把退款地址（非秘密）经发票所在渠道回给商家，运营者调 `POST /api/delivery/orders/:id/address` 登记（该路由已就绪；推导函数复用结账页 `rebuildCommissionOrderAddress`，步 3 做校验：登记的地址必须能由 nonce+退款地址+报价重建出来）。需要你确认可接受这个"买家回一句话"的人工步骤，还是要更自动的方案。
2. **split 广播真适配器**（CommissionSplit：复用 `commission-plan-sdk.mjs buildCommissionSplitTx` + 节点提交 + PMT/deadline 守卫）和 **读后端真适配器**（api.kaspa.org `/addresses/{a}/full-transactions`）、**watcher 的 index.js 接线与启用开关（默认关）** 都属步 3，本步未做，故 watcher 当前**零运行时影响**。
3. 步 3 前我会先把买家页文案单独交你送 Owner 批。
