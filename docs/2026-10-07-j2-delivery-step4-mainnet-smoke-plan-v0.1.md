# 计划：交付步 4 — 主网小额实测（不重启主网 console、不改主网 env）v0.1

> **Status**: PROPOSAL（待 Bettor 审；本页只是计划，**未执行任何主网动作**）。作者 J2 · 2026-10-07。回应 Bettor 账本1881 ④。
> 复用清单（第一原则）：步 1–3 全部已合并模块；relay 窄命令 `delivery_split_submit` / `delivery_mailbox_send`；`check_utxo_landed`；既有 simnet 全链路脚本 `docs/provenance/2026-10-07-j2-delivery-step3/step3_simnet_e2e.mjs`（改参数复用，不另写）；M0a funnel `delivery-relay-funnel.mjs`。

## 1. 结论：**可以不重启主网 console、不改主网 env**
做法 = **独立的临时 console 实例**（新端口、新 DB、新 `CONSOLE_ENCRYPTION_KEY`、新 relay 钱包），**只共用主网 kaspad 的 wRPC（127.0.0.1:17110，只读 + 提交交易）**。
理由（实核）：
- 主网 console（PID 23808，端口 3202，`kanet.mainnet.env`）是独立进程；它的 relay 子进程是它 fork 的、跑的是启动时的旧代码 ⇒ **新命令 `delivery_split_submit`/`delivery_mailbox_send` 在它里面不存在**；"脚本直连主网 relay"行不通（要么命令不存在，要么得碰它的钱包）。
- 临时实例用合并后的 master 代码（含 fd0115fb）起，自带 relay，**不读不写主网 DB、不碰主网任何钱包私钥**。
- 对主网 kaspad 只多一条 wRPC 连接（同 simnet 演练的连接方式）；不改 kaspad 参数、不重启。

## 2. 隔离清单（每条都要在执行前自检）
| 项 | 值 |
|---|---|
| 代码 | 干净 worktree = master（含 b22f3b99 + fd0115fb）；**不用**主网 checkout |
| 端口/绑定 | `HOST=127.0.0.1`，`PORT` = 一个空闲端口（建议 3299，先 netstat 核不冲突） |
| DB | 全新 `DB_PATH`（scratch 下），迁移到 v223；**不是** `console.mainnet.db` |
| 密钥 | 新 `CONSOLE_ENCRYPTION_KEY`（临时，**在清空钱包前必须保留 DB 与此 key**） |
| env | 单独的 `env.delivery-smoke.mainnet`（不是 `kanet.mainnet.env`）；关一切自动项：同 simnet 演练那组保守开关（`POOL_SEEDER_ENABLED=0`、`BROKER_ENABLED=0`、`DEMO_*_OFF=1` 等）；`KASPA_NETWORK=mainnet`、`KASPA_RPC_URL=ws://127.0.0.1:17110`、`KASPA_RPC_LOCAL_ONLY=1` |
| watcher | 临时实例里 `DELIVERY_WATCHER_ENABLED=1` + `DELIVERY_RELAY_ID=<临时 relay>`（**只在临时实例**；主网 env 不动） |
| 钱 | 临时 relay 新钱包，**由 Bettor/Owner 经既有通道单点转入 ≤2 KAS**（我不碰任何已有私钥，不调 funds 端点）；订单角色地址 = 自有地址（由 Bettor 提供 2 个地址：provider、broker；channel 槽折叠到 provider） |
| 读后端 | 真 api.kaspa.org（主网）；这是第一次对真主网读，只读 |
| 红线 | 永不触碰主网 kaspad 4752 / 主网 console 23808；拆除时只按**临时实例端口/PID** 杀，拆后核对两者仍在 |

## 3. 阶段（每个阶段的"放行条件"满足才进下一阶段）
- **4a 零资金阶段（不需要 GO）**：起临时实例（空钱包）→ 用主网网络建一单（报价金额 1.0 KAS）→ 核对：订单地址商家侧 == 买家页推导；买家页真 Chromium 全请求零秘密；`api.kaspa.org` 读该地址返回空；watcher 因无付款保持 `watching`。只读，零花费。
- **4b 首笔花费（需 Bettor 单点 GO）**：Bettor 把 ≤2 KAS 转入临时 relay 钱包地址。
  1. **A 单**：报价 `price=1.0 KAS`，`max_split_fee`≈0.01（按主网实测 mass 留 1.3× 余量；先在 4a 用 relay 的费用估算核对），应付≈1.01。临时 relay 付款 → watcher 真 split（三角色=自有地址）→ 真信箱（0.2 KAS+≈0.032 费）→ 买家页读链解密 → 清扫信箱到自有地址。**放行条件**：split 与信箱均 depth≥20 落链、明文一致、链上 sigScript 无秘密窗口。
  2. **B 单（退款路径）**：同额，到期前不动，到期后买家页零签名 refund → 退款 P2PK → 清扫回自有地址。（主网 PMT 滞后小；deadline 取 `deadline_offset` 最小可行值，先核报价规则下限。）
  3. **清空**：把临时 relay 钱包剩余余额转回 Bettor 指定自有地址，**余额=0 后**才删临时 DB/key。
- **预期净成本**：≈ 2 笔网络费 + 信箱 0.032 + split 费 ≤0.01 + 退款费 ≤0.01 ≈ **≤0.1 KAS**；在险峰值 ≤ 约 1.3 KAS。

## 4. 回滚/中止
任一阶段异常 ⇒ 立即停临时实例（按端口/PID），资金仍在订单 UTXO（可走退款路径）或临时钱包（清空转出）；因为临时 DB+key 保留，随时可重起来回收。中止不影响主网 console。

## 5. 若最终要对**真实运营**启用——必须重启主网 console（单列，并入一次 Owner 重启申请）
临时实例只能证明机制；真实商家用必须主网 console 带上以下**全部**内容（一次重启带齐）：
1. **迁移**：v222（`delivery_orders` / `delivery_inventory`）、v223（`quote_json`）+ DATABASE.md（已同提交）。
2. **交付路由**：`/api/delivery/*`（回环 + `ADMIN_SECRET_DELIVERY` tier）。
3. **watcher**：`delivery-watcher-service` + `delivery-relay-funnel`（M0a manifest 已批）；env：`DELIVERY_WATCHER_ENABLED=1`、`DELIVERY_RELAY_ID`、`DELIVERY_TICK_MS`（可选）、`ADMIN_SECRET_DELIVERY`（新 secret，**env 变更**）。默认关，可重启后再单独开。
4. **relay 子进程新代码**：`delivery_split_submit`、`delivery_mailbox_send`（`kasia-relay` 新命令）；relay 随 console 重启重新 fork 才会加载。🔴 `p2sh.mjs` 属 HIGH-RISK，已带 `acknowledged: T-J1-2026-04-28`。
5. **回收工具**（retire/sweep）：`p2sh.mjs` 的 `unlockClaimRetire/unlockTicketSweep`、`zk-recovery-enumerate`、`zk-recovery-params` 的 `stampSelfCovId` 与 `zk-autonomy-ticks` 一行 stamp 调用（后者在 tick 里，重启后即生效——**注意它改变已有 tick 的行为面（只写元数据）**，请 NWT 在重启申请里再点一次）。
6. 买家页静态资源（`delivery.html/js/copy`）：console 绑 127.0.0.1，**对外托管不在 console 里**——需 Owner 另定静态托管位置（只放静态文件，不放任何服务端）。
7. 重启前置照既有纪律：先 quiesce 花钱面（定时器 + ingress）、重启后核 relay 都 ready、`PRAGMA user_version`/迁移状态核对、console RpcClient 重连。

## 6. 需要 Bettor 定的 3 件事
1. 同意"临时实例"方案（否则走 §5 的重启路径）。
2. 4b 的 GO、转入 ≤2 KAS 的执行人与来源地址、角色用的 2 个自有收款地址。
3. 临时实例的端口号与 DB/env 存放位置（建议 scratch，不入库）。
