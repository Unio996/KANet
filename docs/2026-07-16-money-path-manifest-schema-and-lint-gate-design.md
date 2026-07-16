# Money-Path Manifest Schema + Lint 门禁设计 v0.1

> **Status**: DRAFT — 待 Bettor/团队红队互审
> 响应 Owner 终裁(`docs/2026-07-16-owner-ruling-economic-kernel-round2.md`)七项优先级第④项："money-path/exit-path/fault-domain 机器清单"，Owner 给了 YAML 骨架模板。J1 挂账未归，转 NWT 主笔 schema+lint 设计，KANet-UI 供 UI/broker 路径清单。

## 一、为什么要做这个(不是為了做而做)

今天(2026-07-15/16)红队审批0时抓到一个真实案例(`docs/2026-07-15-NWT-redteam-process-separation-batch0-review.md` MUST-FIX①): `DEMO_SEEDER_OFF` 这一个 kill-switch 同时控制了三个循环——创建新 demo 挂单(该关)+`startSeederDepositWatcher`(真实用户充值状态机, 关了会孤儿卡死)+`startSeederRefundWorker`(唯一的资金安全出口)。**这个坑是我人工逐行读代码抓到的**——如果当时没人读到这一行, 这个 kill-switch 一旦在生产反复开关, 迟早会在某次关闭时卡死一笔真实充值。

**本设计的目标**: 把"kill-switch 会不会同时关掉自己的退款出口"这类问题, 从"靠红队人工逐行审"升级成"机器自动挡, 没有清单不让合并"。K-10("Failure Has an Exit")是宪法条款, 本设计是它的机器可读、可 lint 的落地。

## 二、Schema(Owner 骨架扩展, 每字段给类型+取值域)

```yaml
path_id: string                    # kebab-case 唯一标识, 如 "z20-broker-kas-refund"
description: string                # 一句话说明这条钱路是什么

intake_transaction:
  mechanism: string                # 钱怎么进来的(covenant lock / DB 状态写入 / relay transfer)
  code_ref: string                 # file:line

locked_states:
  - state: string                  # 状态名(如 pool_markets.protocol_status 的某个值)
    description: string
    table_or_covenant: string      # 哪张表/哪个covenant 持有这个锁定态

# 三种出口, 取值来自 Trust Profile 六轴稿 escape_authority 轴同一词表(J1 六轴稿 §3 已约定共享)
normal_exit:
  trigger: enum[timeout-automatic, permissioned-manual, permissionless-anyone]
  mechanism: string                # 函数名/端点
  code_ref: string

timeout_exit:
  trigger: enum[timeout-automatic, permissioned-manual, permissionless-anyone, none]
  mechanism: string | null
  timeout_duration: string | null  # 如 "30min", "24h"
  code_ref: string | null

escape_exit:
  trigger: enum[timeout-automatic, permissioned-manual, permissionless-anyone, none]
  mechanism: string | null
  condition: string | null         # 什么情况下才触发这条最后防线(区别于 normal/timeout)
  code_ref: string | null

responsible_worker:
  process_or_cron: string          # 哪个 daemon/cron/service 负责推进这条钱路
  code_ref: string

kill_switch_effect:
  env_var: string | null           # 控制这条路径的 env 开关(没有就填 null, 不是留白不填)
  when_off: enum[blocks-new-entry-only, blocks-all-including-exit, no-effect-on-exit, no-kill-switch]
  # 🔴 这一格是本设计的核心防线, 见 §三 R-MANIFEST-KILLSWITCH-SAFE

fault_domain:
  shares_process_with: array<path_id> | "isolated"   # K-16 故障隔离轴的具体声明
  k16_compliant: boolean           # 该路径的 worker 崩溃/阻塞是否不影响其它无关路径(诚实自评, 不是自动判定)

admin_capabilities:
  - capability: string
    admin_secret_var: string | null
    risk_tier: enum[T-READONLY, T-STATE-PREP, T-SIGN, T-BROADCAST, T-BREAK-GLASS, none]
    # 词表对齐⑥ADMIN_SECRET拆分设计(docs/2026-07-16-admin-secret-capability-tiering-design.md §2.1)

required_tests:
  - test_file: string
    covers: enum[normal_exit, timeout_exit, escape_exit, intake]
```

## 三、Lint 规则(机器可查, 不是关键词匹配)

| 规则 ID | 检查内容 | 触发条件 | 级别 |
|---|---|---|---|
| **R-MANIFEST-COVERAGE** | 每个能锁定资金的代码路径(匹配模式: covenant lock 创建 / `sendKas`/`transfer` 类调用 / 写入某个"资金锁定态"的 DB 状态字段)必须有对应 `path_id` 清单条目 | 新增/改动的 diff 里出现匹配模式但找不到对应清单条目 | **BLOCK 合并**(K-10 硬门禁) |
| **R-MANIFEST-EXIT-REACHABLE** | 每个 `locked_states` 条目, `normal_exit`/`timeout_exit`/`escape_exit` 三者至少一个非 `none` 且 `mechanism` 非空 | 三者全 `none`/全空 | **BLOCK**(资金锁死无出口, K-10 直接违反) |
| **R-MANIFEST-KILLSWITCH-SAFE** 🔴 本设计核心 | `kill_switch_effect.when_off == blocks-all-including-exit` 时, 检查这个 kill-switch 关闭的代码范围是否**只**包含"入口"逻辑, 不包含任何 `normal_exit`/`timeout_exit`/`escape_exit` 声明的 `mechanism` 对应的函数 | 同一个 env var 同时出现在某 `path_id` 的 kill-switch 里, 又出现在该 path 任一 exit mechanism 的调用链上(静态扫描 import/调用图) | **BLOCK**(今天批0 MUST-FIX 那个坑的机器版) |
| **R-MANIFEST-TEST-COVERAGE** | `required_tests` 至少覆盖 `normal_exit` + 已声明的 `timeout_exit`/`escape_exit`(非 none 的那些) | 某个非 none 的 exit 类型在 `required_tests[].covers` 里零命中 | WARN(先警告, 观察期后升 BLOCK) |
| **R-MANIFEST-ADMIN-TIER-MATCH** | `admin_capabilities[].risk_tier` 必须能在⑥ADMIN_SECRET拆分清单里找到对应真实 env var(不能声明一个不存在的密钥变量) | 交叉核对两份清单, 找不到匹配 | WARN(两份文档独立维护期间的一致性检查) |

**R-MANIFEST-KILLSWITCH-SAFE 具体怎么查(不是关键词猜)**: 静态解析 `index.js` 里 `if (process.env.X !== '1') startY(); else ...` 这类模式, 提取 `X`(env var)和 `startY` 内部实际调用的子函数集合(需要沿 import 链走一层, 不只看顶层函数名)。对照 manifest 里所有 `path_id` 的 exit mechanism 名字——若 `startY` 调用链里包含任一 exit mechanism, 而这条 `path_id` 又被同一个 `X` 控制, 直接 BLOCK。这条规则的复杂度高于关键词匹配, 首批实现范围建议只覆盖 `index.js` 顶层 kill-switch(批0/批1 已知的那批), 不追求一次覆盖全代码库所有间接调用。

## 四、首批清单条目(用今天实战案例起草, 不是空表)

### 4.1 `z20-broker-kas-refund`(批0 MUST-FIX 案例, 演示 R-MANIFEST-KILLSWITCH-SAFE 会怎么拦)

```yaml
path_id: z20-broker-kas-refund
description: broker 对过期/超时 exchange_offers 的 KAS 退款
intake_transaction:
  mechanism: "用户向 seeder buy-side 挂单充值 USDT, 状态机进 retail_dex_buy_publications"
  code_ref: "kasia-console/src/services/market-seeder.js:36-48 (startSeederDepositWatcher)"
locked_states:
  - state: "exchange_offers.protocol_status IN ('expired','cancelled','timed_out','open'+deadline过)"
    description: "过期未成交挂单, KAS 卡在 broker 钱包"
    table_or_covenant: exchange_offers
normal_exit:
  trigger: timeout-automatic
  mechanism: advanceToRefunded (via _scanExpiredBrokerOffers)
  code_ref: "kasia-console/src/services/broker-intake-watcher.js:459"
timeout_exit:
  trigger: none
  mechanism: null
escape_exit:
  trigger: permissioned-manual
  mechanism: "POST /api/admin/clear-z20-circuit (熔断解除后人工复位)"
  condition: "Z20 circuit-breaker 熔断后(同一 offer 连续失败达阈值)"
  code_ref: "kasia-console/src/api/admin-dedup.js:138 (2026-07-16 KANet-UI 核实更正, 原稿误写 pool.js)"
responsible_worker:
  process_or_cron: "_refundInterval (broker-intake-watcher.js:1060, 5min tick)"
  code_ref: "kasia-console/src/services/broker-intake-watcher.js:1059-1074"
kill_switch_effect:
  env_var: "DEMO_SEEDER_OFF (批0落码后, 修法A拆分版)"
  when_off: blocks-new-entry-only
  # 🔴 修法A之前的版本是 blocks-all-including-exit——本条目就是那次 MUST-FIX 的记录留档,
  #   证明这条规则能拦住这个真实发生过的坑(如果批0落码前就有这份清单+lint, 根本不需要等 NWT 人工读代码抓)。
fault_domain:
  shares_process_with: "isolated (跟其它 broker path 共享 console 主进程, 但跟 seeder create-loop 已用修法A物理拆开)"
  k16_compliant: true
admin_capabilities:
  - capability: "清空 Z20 熔断闸"
    admin_secret_var: null   # 目前无独立密钥门控, 只有 ingest-secret(verifyIngestRequest), 非 admin tier 体系
    risk_tier: T-STATE-PREP
    # 2026-07-16 KANet-UI 读码核实位置更正: escape_exit.code_ref 实际在 admin-dedup.js:131/138
    # (GET /api/admin/z20-circuit-broken, POST /api/admin/clear-z20-circuit), 不在 pool.js——
    # 逻辑描述本身准确, 纯文件位置引用误差, 落码时一并更正。
required_tests:
  - test_file: "kasia-console/test-framework/cases/broker/ (待确认具体文件)"
    covers: normal_exit
```

### 4.2 `kr5l4-bshard-close-settlement`(法国盘 P0 案例, 演示 fault_domain 轴的价值)

```yaml
path_id: kr5l4-bshard-close-settlement
description: bshard(A)-model rolling-shard 市场结算/退款(694 注/25075 KAS 规模级案例)
intake_transaction:
  mechanism: "用户下注创建 PoolSide ticket covenant, mint 进 ShardLeaf 聚合状态"
  code_ref: "kasia-console/src/lib/pool-shard-register.mjs"
locked_states:
  - state: "market_shards.status = 'open'/'sealed' 未 consolidate"
    description: "分片资金锁在 ShardLeaf covenant, 未汇入 PayoutShard"
    table_or_covenant: market_shards / ShardLeaf covenant
normal_exit:
  trigger: permissioned-manual
  mechanism: "settle-daemon tick → enforceCloseAttest → committee 签名 → consolidate → 派彩"
  code_ref: "kasia-console/src/lib/bshard-close-enforce.mjs"
timeout_exit:
  trigger: none
  mechanism: null
  # 🔴 本次 P0 事故暴露: 当前 committee-exclude(第735行 side_lock_daa 判据)对链上剪裁数据依赖,
  #   deadline_daa 到期后若这条依赖数据不可得, 无自动降级/超时兜底路径——这正是"timeout_exit=none"
  #   在实战中造成结算无限期悬空的真实案例, 不是本清单凭空想象的风险。
escape_exit:
  trigger: none
  mechanism: null
  condition: "🔴 当前无——这正是本次 P0 暴露的真实缺口, K-10 违反实例, 待补(选项D落码后填此格)"
responsible_worker:
  process_or_cron: "bshard-settle-daemon.mjs 各 tick"
  code_ref: "kasia-console/src/services/bshard-settle-daemon.mjs"
kill_switch_effect:
  env_var: "SETTLE_DAEMON_OFF"
  when_off: blocks-all-including-exit
  # 关闭时整条 settle 流水线(含结算这个唯一出口)一起停, 无独立退款/超时通道存活。
fault_domain:
  shares_process_with: "isolated (settle-daemon 是独立 cron, 但与 shard21 派生 bug 撞在同一 market_id 上, K-16 意义上仍是同进程共享故障域)"
  k16_compliant: false   # 🔴 诚实自评: 结算流水线目前不满足 K-16, 单一 daemon 停摆=全部悬空, 待批2进程分离
admin_capabilities:
  - capability: "propose-close-v2/zk-handoff-v2/zk-close-v2 手动触发"
    admin_secret_var: "ADMIN_SECRET_ZK_STATE_PREP / ADMIN_SECRET_ZK_CLOSE_BROADCAST(⑥拆分后)"
    risk_tier: T-STATE-PREP / T-BROADCAST
required_tests:
  - test_file: "待补(本次 P0 暴露测试覆盖缺口, 大规模 rolling-shard 市场结算无 e2e 回归用例)"
    covers: normal_exit
```

### 4.3 `tg-wallet-custodial-withdraw`(KANet-UI 供料, 2026-07-16——用户主动触发型 money-path, 与 4.1/4.2 两个 daemon-tick 型互补)

```yaml
path_id: tg-wallet-custodial-withdraw
description: "TG 托管钱包用户提现——唯一让托管资金离开 KANet 控制的正常出口, 直接对应 K-13/§9 fund+claim custodial 架构性冲突(KANet-UI 已在频道发过的发现)"
intake_transaction:
  mechanism: "用户 TG 交互创建托管钱包(POST /api/tg-wallet/:tg_user_id/create), console 持 CONSOLE_ENCRYPTION_KEY 加密存 mnemonic_encrypted"
  code_ref: "kasia-console/src/api/tg-wallet.js:52-75"
locked_states:
  - state: "tg_custodial_wallets 表存在该 tg_user_id 行, 且链上余额>0"
    description: "资金被 console 托管, 私钥加密存本地 DB, 用户无独立签名能力(K-13 冲击点)"
    table_or_covenant: tg_custodial_wallets
normal_exit:
  trigger: permissioned-manual
  mechanism: "POST /api/tg-wallet/:tg_user_id/send——just-in-time 解密 mnemonic → 派生 privkey → IPC 给 relay(custodial_transfer) → 用完即弃"
  code_ref: "kasia-console/src/api/tg-wallet.js:93-140"
timeout_exit:
  trigger: none
  mechanism: null
  # 🔴 无自动超时退出——资金停留多久完全取决于用户主动发起 /send, 没有任何"闲置N天自动怎样"的机制
escape_exit:
  trigger: none
  mechanism: null
  condition: "🔴 当前无独立于 normal_exit 的 escape path——如果 CUSTODIAL_RELAY_ID/FAUCET_RELAY_ID 未配(tg-wallet.js:101 判据), 唯一出口直接 503 不可用, 没有备用通道。这正是 K-13'真实价值场景不得强制托管'这条不变量的具体违反实例(不是理论风险, 是当前实现现状)。"
responsible_worker:
  process_or_cron: "无常驻 worker——这是用户主动触发的同步端点, 不是 daemon tick(与 4.1/4.2 两个已有案例不同类型, 补充 schema 覆盖'用户主动触发型' money-path)"
  code_ref: "kasia-console/src/api/tg-wallet.js:93"
kill_switch_effect:
  env_var: "CUSTODIAL_RELAY_ID / FAUCET_RELAY_ID(二选一, 均未配=整条路径 503)"
  when_off: blocks-all-including-exit
  # 🔴 这两个 env var 不是为了"关闭"这条路径而设计的 kill-switch, 是必需配置项——但效果上跟 kill-switch 一样:
  #   任一未设, 用户就再也拿不出自己的托管资金, 没有区分"我想临时关闭充值"和"我不小心漏配了"这两种意图。
fault_domain:
  shares_process_with: "console 主进程(与所有 pool.js/tg-bot 路径共享, 未隔离)"
  k16_compliant: false   # 诚实自评: console 主进程若阻塞/崩溃, 提现路径连坐停摆, 无替代
admin_capabilities:
  - capability: "无 ADMIN_SECRET 门控——用的是 verifyIngestRequest(ingest secret 机制, 跟 admin tier 体系是两套不同的 auth, 不在⑥ADMIN_SECRET 拆分范围内)"
    admin_secret_var: null
    risk_tier: none
required_tests:
  - test_file: "待确认(需查 test-framework/cases/ 是否有 tg-wallet 提现覆盖用例)"
    covers: normal_exit
```

**这条的价值**: ①补齐"用户主动触发型" money-path(区别于 4.1/4.2 两个 daemon-tick 型, 扩大 schema 覆盖面)②`escape_exit=none` 直接对应 K-13 冲突, 把频道已发的发现转成机器可读格式③`admin_capabilities` 交叉核对时显示这条根本不在 admin tier 体系里(用的是 ingest secret 不是 admin secret)——这个"两套不同 auth 机制并存"的事实, 也许值得 `R-MANIFEST-ADMIN-TIER-MATCH` 规则考虑要不要扩大覆盖范围, 不只对 `admin_secret_var`, 也覆盖 `verifyIngestRequest` 这类(不在本条目范围内自行拍板, 供 NWT 判断)。

### 4.4 `exchange-offer-kas-fund-lock`(KANet-UI 供料, 2026-07-16——用户主动触发型, exchange 撮合协议的 KAS 锁定/退出全链路, 与 4.1 z20 案例互补而非重复: z20 覆盖 seeder buy-side 充值退款, 本条覆盖 /api/exchange/publish 直接发起 KAS 挂单的锁定/释放)

```yaml
path_id: exchange-offer-kas-fund-lock
description: "用户通过 /api/exchange/publish 直接发起 KAS 侧 exchange offer, 广播前先本地锁定 KAS 防超卖; 覆盖 open→matched→completed/cancelled/timed_out/disputed 全生命周期的锁定态与释放"
intake_transaction:
  mechanism: "give_asset='KAS' 时, 广播前调用 lockFunds(makerAddr, offerId, 'KAS', amount, currentBalance) 写入 fund_locks 表(status='locked'), 广播失败则 releaseFunds() 回滚"
  code_ref: "kasia-console/src/api/exchange.js:285-297 (lockFunds), :329-334 (广播失败回滚)"
locked_states:
  - state: "fund_locks.status = 'locked' (asset='KAS', order_id=offer.id)"
    description: "maker KAS 锁定, 防止同一钱包被多个挂单超额支用(非链上锁定, 是 console 本地记账层的并发保护)"
    table_or_covenant: fund_locks
normal_exit:
  trigger: permissionless-anyone
  mechanism: "taker accept→verifying→delivering→completed, transition() 在到达 completed(TERMINAL)时调用 spendFunds(offerId)"
  code_ref: "kasia-console/src/services/exchange-machine.js:94-98 (transition 内 TERMINAL 分支)"
timeout_exit:
  trigger: timeout-automatic
  mechanism: "expireStale() 处理 matched 态超时未 verifying 的挂单, 重新 open 并 releaseFunds(); timeoutVerifying()/checkMatchedTimeout() 处理其余超时分支, 均走 transition() 统一释放"
  timeout_duration: "30min(matched→open reopen, 见 exchange-machine.js:730-737 附近逻辑)"
  code_ref: "kasia-console/src/services/exchange-machine.js:581 (expireStale), :739 (releaseFunds); 调度者 kasia-console/src/index.js:239-243 (setInterval 30s, 无 kill-switch)"
escape_exit:
  trigger: permissioned-manual
  mechanism: "POST /api/exchange/resolve, maker_wins→completed(spendFunds)/taker_wins→cancelled(releaseFunds), 均经统一 transition() 而非 resolve 端点自行操作 fund_locks"
  condition: "争议(disputed 态)后人工/两方共识裁决, 无独立 admin_secret 门控(靠身份对等, 非 admin tier)"
  code_ref: "kasia-console/src/api/exchange.js:757 (resolve endpoint), :842-848 (releaseFunds/spendFunds 调用点, 双路径均走 transition 统一逻辑)"
responsible_worker:
  process_or_cron: "index.js 顶层 setInterval(30s): expireStale+checkStaleDisputes+cleanupStaleOrphanAccepts+timeoutVerifying+checkMatchedTimeout"
  code_ref: "kasia-console/src/index.js:239-243"
kill_switch_effect:
  env_var: null
  when_off: no-kill-switch
  # registerExchangeRoutes(index.js:205)和上述 setInterval 均无条件注册/运行, 没有 env 开关能关掉这条 money-path
  # (对照 4.1 z20 案例的教训: 这里反而是"没有开关"本身更安全, 不存在"关 demo 连坐关退款出口"这类风险)
fault_domain:
  shares_process_with: "isolated (与 broker z20 路径共用 console 主进程但业务上互不相关; exchange-machine.js 的 transition() 是所有 exchange 状态出口的单一收口点, K-16 意义上退出逻辑本身故障域集中但一致, 非分散易漏)"
  k16_compliant: true
admin_capabilities:
  - capability: "无独立 ADMIN_SECRET 门控——resolve 端点未见 checkAdminSecretTier 调用(需 NWT 复核确认无遗漏), 裁决靠 maker/taker 身份对等而非 admin 权限"
    admin_secret_var: null
    risk_tier: none
required_tests:
  - test_file: "kasia-console/test-framework/cases/exchange/ (待确认具体 fund_lock 生命周期覆盖用例)"
    covers: normal_exit
```

**这条的价值**: ①与 4.1 z20 互补覆盖 exchange 协议的另一个 KAS 锁定入口(直接 publish, 非 seeder 中转)②验证发现 transition() 是一个**单一收口的退出机制**——所有终态(completed/cancelled/timed_out/disputed→resolve 后)都统一走同一段 fund lock 释放/花费逻辑(exchange-machine.js:90-103), 这是比 4.1/4.2 两个案例更干净的 K-10 范式, 值得作为"好例子"对照(此前 NWT 4.1/4.2 两个案例都是暴露问题, 本条补一个"设计对了"的正面参照)③`kill_switch_effect.env_var=null` 实测确认——这条 money-path 目前没有任何 env 开关能关闭, R-MANIFEST-KILLSWITCH-SAFE 规则对它天然不适用(没有开关就没有"关错"的风险面)。

**读码时顺带发现并直接改正的既有条目位置错误**:
§4.1 `z20-broker-kas-refund` 的 `escape_exit.code_ref` 原写"kasia-console/src/api/pool.js (z20-circuit-broken 相关端点)"——实读码确认这两个端点实际在 `kasia-console/src/api/admin-dedup.js:131`(GET /api/admin/z20-circuit-broken)+`:138`(POST /api/admin/clear-z20-circuit), 不在 pool.js。纯位置引用误差, 逻辑描述本身准确, 已在本次改动里直接更正(见上方 §4.1 `code_ref` 字段+ `admin_capabilities` 注释)。

**其余候选(已定位 file:line, 未完整 schema 化, 留后续批次, 不虚报"已完成")**:
- `bettor-refund-claim`(kasia-console/src/api/pool.js:3942, 用户主动触发 bshard 市场退款申领, 与 kr5l4 P0 同一资金域, 鉴于该 P0 仍在处理中, 暂不单独立 path_id 避免记录与在途事故冲突)
- `oracle-pool-withdraw`/`timeout-unlock`(oracle-pool.js:303/455, 完整三态候选, 结构干净)
- `hyperliquid-withdraw`/`aave-withdraw`(defi.js:530/68, 外部 DeFi 集成资金出口)
- `escrow-create/lock/execute`(escrow.js:59/108/138, 三态 release/refund/arbitrate 通用基础设施)

## 五、诚实标注(不隐瞒, §四 首批清单目前不完整的地方)

1. §4.1/4.2 只是**两个具体案例**用来验证 schema 设计本身+演示 lint 规则确实能拦住已知真实坑, 不是全系统 money-path 的完整清单——完整清单需要逐个 domain(broker/exchange/pool-settler/admin 端点/tg-bot 托管钱包等)扫过, 本稿不做这个体量的工作, 留给落码阶段按 domain 分批补。
2. R-MANIFEST-KILLSWITCH-SAFE 的静态分析(§三)只是设计思路, 实现难度不低(需要构建调用图), 建议先手工维护首批清单+人工审查作为过渡, lint 自动化分阶段做。
3. `admin_secret_var` 字段部分标了"待核实"(如 4.1 的 Z20 清空端点)——跟⑥项 ADMIN_SECRET 清单的交叉核对(R-MANIFEST-ADMIN-TIER-MATCH)还没做完, 需要 KANet-UI 供的 UI/broker 路径清单补全后再核一遍。

## 六、待团队红队互审的点

1. Schema 字段本身是否够用(尤其 `fault_domain.k16_compliant` 这种自评字段, 靠不靠谱, 要不要改成"machine-checkable"而非"自评")。
2. R-MANIFEST-KILLSWITCH-SAFE 的静态分析范围(§三"首批实现范围建议只覆盖 index.js 顶层")是否合理, 还是要求更完整覆盖才能算真正的门禁(而不是"半成品也叫门禁"这种自我安慰)。
3. §4.2 kr5l4 案例里 `escape_exit=none` 这个诚实标注, 是否应该直接阻断本设计定稿(即"发现自己有 K-10 违反案例, 是不是应该先修那个再谈 manifest 设计"), 还是"记录现状+manifest 本身就是用来暴露这类缺口的工具, 先有清单才能系统性排查, 不是先排查完才做清单"——我倾向后者(manifest 的价值就是暴露, 不是等一切完美了才建), 但这是团队共识问题不是我一个人能定。

— NWT
