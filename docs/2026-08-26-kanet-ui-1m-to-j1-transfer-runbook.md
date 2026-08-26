# 1,000,000 KAS → J1 新地址 转账 Runbook（Owner 令 · ledger (623)/(624) · 报 Owner 材料）

> **Status**: DRAFT **v0.2** · KANet-UI 2026-08-26 · Bettor 派工 (C) · **只读调研成稿, 零改码, 零花钱**。执行者 = Bettor; KANet-UI 做直连 kaspad 第五 vantage 链读核实。
> **v0.2(应 NWT 红队 `docs/2026-08-26-NWT-redteam-1m-transfer-runbook.md` f2bfef32)**: ①承重 — **第三条双发路 = console 重启孤儿化在跑的 relay 子进程**(广播照做但 TRANSFER 日志随断管丢 ⇒ T2(c) 日志判据瞎 ⇒ 双花不自保 ⇒ 2M)。修: **T1→T3 窗口内任何 console 重启 ⇒ 日志证据作废, 链读升为唯一权威(非 fallback); 窗口内禁人工重启 console 直到链读完成**。④ P2③(rpc_health absence)/P2②(relay 自报)降**辅助**, 真闸 = P1 positive probe + 执行时 `transaction.mjs:149` isSynced throw(且对空 utxoindex 失败向安全=Insufficient balance 不广播)。②③ NWT PASS(§2.3/§6 补 note)。
> **事实来源**: 每条带 `file:line`(本机 `bshard-m3-deploy` @ `d5a82648` 时读的树)或 `[MEASURED]`(今日只读实测)。**IBD 中读不到的链上数, 明写"同步后复读", 不沿用 8/23 数字当现值。**

## §0 一句话
走既有 **`POST /api/relay/:id/transfer`**(`kasia-console/src/api/relay.js:511`)→ `sendCommandAsync(id,{type:'transfer',target,amount},30000ms)`(`relay-manager.js:291`)→ relay `sendKaspa`(`kasia-relay/src/lib/transaction.mjs:135`)。**console 层无重试; relay 层唯一重试只发生在任何 tx 提交之前**(`transaction.mjs:231-239`), 所以**双发险只来自一处: console 30s 超时后【人】再发一次**。runbook 的核心 = 把"超时≠没发"钉死在流程里, 任何第二次动作前必先链上核。

## §1 参与方(全部从 DB/链读, 非记忆)
| 项 | 值 | 来源 |
|---|---|---|
| 源 relay | `MiningRelay-tn12-new` · id `ce43e1b1-f16b-4e2b-ba22-56cc9bb26762` · addr `kaspatest:qrys4yax468rrm988kyqjtncvstcelgzktml0m3rvdvvktrll0gdxuyu34fru` · network testnet-12 · role null / is_service 0 | `relay_nodes` `[MEASURED]` |
| 源 relay 进程 | PID 3568(console 27412 子, 03:03:32 起) | `logs/console.log:74` `[MEASURED]` |
| 目标 | `kaspatest:qq0kt3dmgtrxevrdgkl5hjkah4afsm4nn6dkf2a4cef0qucxkj93wlz3g27mq` | `docs/governance/j1-address-2026-08-23.md`(Owner 令原文) |
| 目标现况 | `chain_events` / `kaspa_tx_log` 对 `qq0kt3dm` **0 命中**; 频道零发言 | `[MEASURED]` 今日复核 = (624) 结论不变: **未执行过** |
| 金额 | 1,000,000 KAS = `100000000000000` sompi | 命令 amount 形态见 §3 |

## §2 源 UTXO 拓扑 —— 同步后必跑的查询与门槛
### 2.1 现在为什么读不到 `[MEASURED]`
kaspad 22428 `isSynced=false / blockCount=0 / headerCount=0 / daa=0`(pp-chain-headers 阶段, 见 `docs/2026-08-26-kanet-ui-kaspad-probe-ibd-vs-dead-design.md` §1.2)。utxoindex 在这一阶段为空 ⇒ `getUtxosByAddresses` / `getBalancesByAddresses` 返回的是**空或半截**, 不是 0 余额也不是真余额。**(623) 记的"11 亿 KAS 含 10.8 亿单 UTXO"是 8/23 旧库读数, 库已换新, 必须复读。**

### 2.2 同步后跑(只读, 任一 vantage 可跑, 三个都跑更好)
**Q1 · console 端点(最省事)**: `curl -s http://127.0.0.1:3200/api/relay/ce43e1b1-f16b-4e2b-ba22-56cc9bb26762/balance` → `{balance: <KAS>}`(`relay.js:355-380`, 走 `getBalancesByAddresses` 节点侧求和, 对海量 UTXO 地址也快; **RPC 失败会静默 fallback 到 api.kaspa.org = 主网 API, 对 testnet 地址返回无意义**——`relay.js:382-390`; 所以 Q1 结果必须与 Q2 一致才算数)。
**Q2 · relay IPC(与转账同一只眼)**: `curl -s -X POST http://127.0.0.1:3200/api/relay/ce43e1b1-f16b-4e2b-ba22-56cc9bb26762/send-command -H 'content-type: application/json' -d '{"type":"get_address_utxos","address":"kaspatest:qrys4yax468rrm988kyqjtncvstcelgzktml0m3rvdvvktrll0gdxuyu34fru"}'`(`relay.js:1773` → `relay.mjs:1209` → `p2sh.mjs getAddressUtxos`, 纯只读) → `utxos[{outpoint,amount(sompi 字符串)}]`。**看三个数**: `count(utxos)` / `max(amount)` / `sum(amount)`。
**Q3 · 第五 vantage(KANet-UI, 直连本机 kaspad, 不经 console)**: `scratch/_kanetui_rpc_fields.mjs` 同款 `getUtxosByAddresses([源地址])`——独立于 console 进程状态; 与 Q2 逐条对 outpoint。

### 2.3 门槛(全部满足才进 §4)
| # | 门槛 | 为什么是这个数 |
|---|---|---|
| G1 | `sum ≥ 1,000,000 + 1 KAS` | `transaction.mjs:190-191` `Insufficient balance` 判定 = amount + FEE_RESERVE_BASE + priorityFee |
| G2 | **存在单个 UTXO ≥ 1,650,000 KAS**(= `minSafeUtxo = amount + amount×65/100 + FEE_RESERVE_BASE`, `transaction.mjs:196`) | 有 ⇒ 单输入单笔(`:198-200`); **没有 ⇒ 走 `else` = 全部 UTXO 当输入**(`:201`), Generator 拆多笔。🔵 **NWT 精确化(②)**: 多笔 = compound 树, `PaymentOutput(J1,1M)` **只在最后一笔**, 中间全是 **source→source 归并**; 部分失败 = 中间归并笔落链 ⇒ **钱不丢(仍在源地址)、J1 拿 0、拓扑被搅乱**(不是丢钱, 但 STOP 仍对: 再发要重估 G1-G4)。**视为 STOP, 先 `consolidate_utxo`(`relay.mjs:540`) 再来** |
| G3 | `count(utxos)` 在合理量级(建议 < 1,000) | `_sendKaspaInner` 起手 `getUtxosByAddresses` 拉**全部** UTXO(`:154`)并 `filterPendingUtxos`(`:160`); 矿址若有数十万 coinbase UTXO, 这一步本身可能吃掉 30s 超时窗 ⇒ 落入 §5 的"超时但仍执行"形态。8/23 读数说是"单 UTXO", 新库复读后若不是, 先 consolidate |
| G4 | Q1 == Q2 == Q3(余额一致, Q2/Q3 outpoint 集合一致) | 三眼不一致 = 某只眼在读半截 utxoindex, 不进 |

## §3 走哪条路 —— 参数形状与重试实况(逐行)
### 3.1 调用链
1. **入口** `POST /api/relay/:id/transfer`(`relay.js:511-527`): body `{to, amount}`; `amountKas=parseFloat(amount)`; 发 `{ type:'transfer', target: to.trim(), amount: amountKas.toFixed(8) }`, 超时用默认 **30000ms**, origin `'legacy-unmigrated'`。返回 `{ok:true, txId, fee}` / 400 `{error}` / 500 `{error:'Relay command timeout after 30s'}`。
   - ⇒ 1M 的 amount 线上形态 = 字符串 `"1000000.00000000"`; relay 侧 `sendKaspaByAmount`/`kaspaToSompi` 解析(`transaction.mjs:110-118`, 8 位小数, >0)。
2. **console→relay IPC** `sendCommandAsync`(`relay-manager.js:291-322`): `requestId=req-<ts>-<rand>`, `child.send(payload)`, **30s 定时器只做两件事: 摘掉 listener + reject**(`:305-308`)。**没有重发、没有取消、relay 不知道 console 放弃了** ⇒ relay 继续跑完并 `process.send` 回执, 但没人在听。
3. **relay 执行** `relay.mjs:502-506`: `sendKaspa({to, amount})` → 成功后 `ingestTx(...)` + log 行 `TRANSFER 1000000.00000000 → …<addr 末 12 位> TX: <txid> fee: <fee>`(这行经 relay-manager `:113` 转写进 **`logs/console.log`**, 前缀 `[relay:MiningRelay-tn12-new]`)。generic 回执 `{txId, fee, ok, phase:'execution'}` / 异常 `{error, phase:'execution'}`(relay.mjs stake_unlock 之后的公共尾, 已读)。
4. **`_sendKaspaInner`**(`transaction.mjs:139-249`), 与本次相关的每一步:
   - `:149` `if (!isSynced) throw 'RPC node is not synced'` ⇒ **IBD 期天然拒绝, 不会误发**(这是好事, 也是 §4 前置 P1 的来源)。
   - `:154-160` 拉全部 UTXO + 过滤 pending。
   - `:190-201` KIP-9 选择(见 §2.3 G2)。
   - `:210-212` priorityFee 下限 **3,000,000 sompi = 0.03 KAS**; `:213-220` Generator: 一个 `PaymentOutput(to, 1M)`, change 回源地址。
   - `:222-228` **逐笔 sign + submit**; `:231-239` **唯一重试**: 仅当 `submittedTxIds.length==0 && !_isRetry` 且错误是 WS 断线 ⇒ 重连后整函数再跑一次。**任何 tx 已 submit 后不再重试**(`:241-244` 抛 `partially completed` 带 txid 列表)。
   - `sendKaspa` 外层 `withSendLock`(`:135-137`) ⇒ 同 relay 内串行, 不会并发双发。
### 3.2 结论
- **retry-on-timeout: 无**(console 层 `relay.js`/`relay-manager.js` 皆无循环; relay 层重试不跨 submit)。**不需要关什么, 需要的是"不要人肉重试"。**
- **超时-迟到执行险: 真存在**, 形态 = console 500 `timeout after 30s` 而 relay 在第 31~N 秒完成广播。处置见 §5。
- 替代入口 `POST /api/operator/settle-command`(`operator-settle.js:34`)的档二 transfer 需 `ADMIN_SECRET_OPERATOR_TRANSFER` 双 secret, 本机未必配置; **不建议为这一笔去开新门**。`/api/relay/:id/send-command`(`relay.js:1773`)与 `/transfer` 同为 30s, 无增益。
- `[DESIGN-CHOICE]` 不建议为这一笔改 30s 超时(改码=报备审批, 且改了也不消除迟到形态, 只是缩小窗口)。

## §4 执行前置清单(全部 ✅ 才发; 任一 ❌ = 不发, 报 Bettor)
| # | 项 | 怎么核 | 通过判据 |
|---|---|---|---|
| P1 | 节点已同步 | `node scripts/kaspad-rpc-probe.mjs`(现版本 `ALIVE:` 即 daa>0) **且** `scratch/_kanetui_sync_check.mjs` `isSynced:true` | 两个都 true; 且 `blockCount>0`, `pastMedianTime` 是近 10 分钟内的时间戳(不是 2021 genesis) |
| **P1b** | **UTXO 集可用**(Bettor E-bis 补, J2 8/26 实测: IBD 期 relay `get_address_utxos` 对已知持币地址回 `{"ok":true,"utxos":[]}` **空集不报错**, `chain_get_current_daa_score` 回 0 ⇒ `isSynced`/`pastMedianTime` 过了**不等于** utxoindex 可用) | ① `send-command {"type":"chain_get_current_daa_score"}` → **daa > 80,095,687**(8/22 实测下界, 只能更大) ② **阳性对照址** = 源址 `kaspatest:qrys4yax…` 跑 §2.2 Q2 `get_address_utxos` → **非空** | 两条都过。任一不过 ⇒ **G1–G4 的全部拓扑读数作废**(空集/0 余额是"索引没好"不是"没钱"), 不许进 P3/§5; 对照臂不通时任何"目标地址 0 UTXO"(P5)也同样不可信 |
| **P1c** | **钱路关键读二源交叉**(探针 v0.4 §3.2c: `service.rs:257-275 unwrap_or_default` per-query, 索引健康时某址某次查询遇瞬时 store 错仍返 `[]` = 假"没钱", A1/A2/探针都挡不住) | G1–G4 的源余额/UTXO 复读 **每条都二源**: ①二次独立查询(隔开时间, 都非空且一致) ②kaspa_tx_log 或直连 kaspad(第五 vantage)交叉; **单次返 `[]` 绝不作"没有"结论** | 二源一致才采信。P5 目标"0 UTXO"同样须二源(单次空可能是 store 错, 不是真空) |
| P2 | console 非 degraded(**辅助信号, 非真闸**) | ① `curl … http://127.0.0.1:3200/` 302 且 <1s ② `GET /api/relay/…/rpc-state`(IPC, relay **自报** RPC 态) ③ `events` 表 `rpc_health_check_failed` 的 `max(created_at)` 早于 P1 通过 ≥10min ④ supervisor log 近 10min 无 `health fail` | 🔴 **NWT ④: ②③是弱信号别当闸** —— ③读的是"失败的缺席"(health-check 自己死了也没新失败=fail-open 绿灯无信息, 记忆 reference-channel-verified-receipt-reads-local-db-not-chain); ②是 relay 自报(WS 半开时照报 ok)。**真闸 = P1 的 positive probe + 执行时 `transaction.mjs:149 if(!isSynced) throw`**(且它对空 utxoindex 失败向安全: entries=[]→Insufficient balance 不广播)。P2 四项作**建议性前置**, PASS 判据锚在 P1 |
| P3 | 源余额/拓扑复读 | §2.2 Q1/Q2/Q3 | §2.3 G1-G4 全过 |
| P4 | 目标地址 | `kasia-console` 下 `new (await import('kaspa-wasm')).Address('<J1 addr>')` round-trip == 原串, prefix `kaspatest`(同 (623) 已验方法, **执行当天再验一次**, 防文档被改) | byte-exact |
| P5 | 目标地址执行前为空 | Q3 同款 `getUtxosByAddresses([J1 addr])` | 0 UTXO(= "未执行过"的链上版, 补 DB 0 命中那条) |
| P6 | 没有并发钱路在用同一 relay | `grep -n "\[relay:MiningRelay-tn12-new\]" logs/console.log \| tail -20` 最近无 `TRANSFER`/`sign`/`broadcast` 进行中; MiningRelay 不在任何 settle daemon 的 relay 名单里(`is_service=0, role=null` `[MEASURED]`) | 静默 |
| P7 | 频道/对等通道可用 | 执行期间 Bettor↔KANet-UI 对等消息在线(核实回执要即时) | ListAgents 互见 |
| P8 | Owner 已批本次执行 | Bettor 报 Owner 后取得明确 GO(本 runbook 即材料) | 有 GO 记录(频道或 ledger) |
| **P9(NWT ①)** | **窗口冻结基线** | T0 跑 `scripts/p9-baseline.ps1`(一键只读)记基线: (a)console (PID, CreationDate) 对(netstat :3200 owner PID + Win32_Process CreationDate) (b)`logs/console-supervisor.log` 尾 (c)netstat :3200/:8000 LISTENING (d)pidfile 陈旧标记。**写明: T1→T3 之间【禁止人工重启 console】; 若 console 自愈重启(supervisor 触发), 立即冻结重发决策走链读** | 🔴 **重启判据(NWT VB-7 收紧)**: (a) (PID, CreationDate) 对任一变(不只 PID——PID 可复用) (b) supervisor 尾出现新 restart 行(非 20 行逐字比) (c) relay/子进程数只看健康、不判重启(来自 console.log 累积, 受轮转/重连影响)。supervisor 自愈挡不住 ⇒ 唯一防线是 §5 链读-authoritative |

## §5 执行序列(Bettor 执行 · KANet-UI 同步核)
```
T0  Bettor: 记 T0 时刻 + `grep -c TRANSFER logs/console.log`(基线 N0) + P5 再跑一次(目标 0 UTXO)
    + 🔴 P9 基线(NWT ①): 跑 `scripts/p9-baseline.ps1` 存基线(console (PID,CreationDate) 对 + supervisor 尾 + netstat LISTENING + pidfile 陈旧标记); 窗口内复跑比对, (PID,CreationDate) 对变 或 supervisor 出新 restart 行 = console 重启了(relay/子进程数不判重启)
T1  Bettor: 单发一次
    curl -s -m 60 -X POST http://127.0.0.1:3200/api/relay/ce43e1b1-f16b-4e2b-ba22-56cc9bb26762/transfer \
         -H 'content-type: application/json' \
         -d '{"to":"kaspatest:qq0kt3dmgtrxevrdgkl5hjkah4afsm4nn6dkf2a4cef0qucxkj93wlz3g27mq","amount":"1000000"}'
    (curl 自身 -m 60 > console 30s, 确保拿到的是 console 的裁决而不是 curl 自己断)
T2  🔴🔴 先查【窗口内 console 有没有重启】(NWT ①, 决定日志能不能信):
    比对 P9 基线(p9-baseline.ps1 复跑): console (PID,CreationDate) 对变 / supervisor log 有新 restart 行 / netstat :3200 LISTENING owner 变 / pidfile != netstat owner —— 任一 = console 重启过(PID 单独相同不代表没重启, 看 CreationDate)
      ⇒ **logs/console.log 的 TRANSFER 证据【作废】**(孤儿 relay 子的 stdout 随旧 console 断管丢失), 直接跳"链读权威"分支。
    三种回应——【无论哪种, 不发第二次, 除非链读双证没发】:
    (a) 200 {ok:true,txId,fee}        → 记 txId, 进 T3(链读坐实才算数)
    (b) 400/500 且 error 非 timeout   → relay 在 submit 前抛(§3.1 步4)= 没广播; 记 error, 停, 报 Bettor(仍建议 T3 链读一眼确认 J1 无 1M)
    (c) 500 "timeout after 30s"       → 🔴 迟到形态: 不重发。
    ── 链读权威分支(NWT ①: 链读是第一权威, 不是 fallback)──
    无论 (c) 还是"窗口内 console 重启过": **第一动作 = 直连 kaspad 链读 J1 地址**(第五 vantage, 不经 console):
      getUtxosByAddresses([J1 addr]) 找 amount==100000000000000n 的新 UTXO(txid 已知就配 outpoint.transactionId; 未知就看 J1 是否新出现 1M 输出)
      · 链上有 1M(哪怕 0-conf) = 已广播 ⇒ 绝不重发, 取 txid 进 T3
      · 链上确无 + 日志确无 + P9 比对确认【窗口内无 console 重启】(日志才可信) → 才是"真没发", Bettor 判定后方可第二次
      🔴 只要窗口内 console 重启过, "日志没新行"一律【不作数】—— 唯一权威是这次链读
T3  KANet-UI(第五 vantage, 不经 console) + Bettor(经 relay IPC)各自核落链:
    Bettor: POST /api/relay/ce43e1b1…/send-command
            {"type":"check_utxo_landed","address":"<J1 addr>","txid":"<txid>","minDepth":20}
            (relay.mjs:1196 → p2sh.mjs checkUtxoLanded: 精确匹配 outpoint.transactionId==txid, depth = virtualDaa − blockDaaScore,
             depth<20 回 landed:false 继续等; 无 blockDaaScore 回 landed:false depth:null = fail-closed)
            每 20s 一次直到 landed:true(样板: pool.js:1534 / bshard-close-transport.mjs:289, minDepth=REORG_SAFE_MIN_DEPTH=20, pool-shard-register.mjs:88)
    KANet-UI: 直连 kaspad getUtxosByAddresses([J1 addr]) 找 outpoint.transactionId==txid && amount==100000000000000n, 并算 depth;
              再 getUtxosByAddresses([源地址]) 看 change 回源 + 原大 UTXO 已消失
    🔴 NWT ①③: 若窗口内 console 重启过, Bettor 那只【经 relay IPC】的眼可能连的是孤儿/新子, 不可信; **此时 KANet-UI 第五 vantage(直连 kaspad, 不经 console)是唯一权威眼**。
    判据: 两眼都 landed && depth≥20 && 目标 UTXO 金额精确 = 1M KAS(不是"大约") → DONE(console 重启过则以第五 vantage 为准)
    🔴 不用 kaspa_tx_log 当落链证据(Bettor 已定; 记忆 reference-kaspa-tx-log-hit-is-not-canonical-chain-proof)
T4  回填双锚(txid + 地址):
    · docs/governance/j1-address-2026-08-23.md: 状态行改为 已执行 + txid + 落链 DAA/depth + 两眼核实人
    · chain_events: relay 广播成功时 ingestTx → POST /ingest/tx → handleIngestTx(ingest-service.js:1-35) 会自动 recordChainEvent
      {txid, eventType:'tx', observedBy:'relay', payload:{amount,fee,direction}} —— 🟡 自动行【没有 to_address】(recordChainEvent 未传),
      所以"地址锚"在 chain_events 里天然缺。处置: 不手插 DB(铁律), 由 governance 文档 + ledger 条目承担地址锚; 若 Bettor 要 DB 内也有
      to_address, 那是一处 ingest 改动 = 走报备, 不在本 runbook 内做。
    · ledger 新块: 命令原文 / txid / 三眼读数 / T0-T4 时间线
T5  J1: 用新地址在频道发第一条消息自证身份((624) 未发生项), 关闭闭环
```

## §6 风险表
| 风险 | 概率 | 后果 | 挡法 |
|---|---|---|---|
| 超时后人肉重发 → 2M | 人为 | 100 万 KAS 多发(测试网, 但违 NO TX NO STATE 纪律) | §5 T2(c) 硬规则: 日志 + 链 双证"没发"前不发第二次 |
| G2 不满足走多输入多笔 | 取决于新库拓扑 | `partially completed` 半截 | §2.3 G2 = STOP + consolidate 先 |
| 海量 UTXO 拉取超 30s | 取决于新库拓扑 | 必入 T2(c) | G3 先看 count |
| Q1 静默 fallback 主网 API | 中(console RPC 抖时) | 余额读数错误 | G4 三眼一致才算 |
| console 在 T1~T3 之间劣化 | 低-中(复发模式已知) | 回执丢/迟到 | P2 四项 + T2(c) 处置; KANet-UI 第五 vantage 不依赖 console |
| kaspa-wasm `getUtxosByAddresses` 字段形态漂 | 低 | 误判 landed:false | 用 p2sh.mjs 同款 4 级 fallback 读 blockDaaScore(checkUtxoLanded 注释) |

## §7 根治项(超本 runbook, 记一条·NWT ①)
- **转账命令无幂等键 = 双发这一族的根**(console 层 requestId 每次全新, relay 层无去重)。日后若做: relay 侧对 `{target,amount}` 在短窗内加一次性 nonce/去重(与 comm dedup 不同域), 孤儿子 + 新子就算都收到也只广播一次 ⇒ 从机制上消除本 runbook 靠流程 + 链读兜的这条险。**本次不改码。**

## §7b 明确不做
- 不改 30s 超时、不改 ingest、不开 operator-settle 新门、不 split/consolidate 除非 G2/G3 触发(触发也是 Bettor 报备后做)。
- 不在 IBD 期做任何 §5 步骤(P1 挡)。
- 不从 KANet-UI relay 发任何链上动作; 第五 vantage 只读。
