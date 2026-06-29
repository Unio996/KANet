# interim-B 自动结算 daemon 设计 — J1 域(covenant/relay)section

**派工**: Bettor 2026-06-29 (#ynvqtz·Owner 钦定 ZK 平替部署 top 优先)
**co-author**: J1(covenant/relay 执行) + J2(settler 编排) → Bettor 审方向+口径 → 灰度部署
**动机**: interim-B 真盘 2 盘可复现(bh01w + qi37q)·但全 operator 手驱(16min stall / fee-churn / 跨节点 handoff)。平替 = 手动 demo → 自动 daemon·替脆性 covenant 算术。

> 诚实口径(钉死·carry from 今晚): driver-side prevention(委员 4-of-5 门槛 + driver re-derive payoutRoot·非 distributed committee enforce·非 production-trustless)。daemon 不改变信任模型·只自动化手驱步骤。

---

## J1 域: covenant/relay 执行自动化(今晚手驱的 4 步)

### 0. PREREQUISITE(必先 land·否则 daemon 卡死)
**canonical p2sh.mjs 加 unSafeJson 返回**(我 :3300 本地有·canonical 缺·今晚 16min handoff stall 根因)。
- build-preimage 返回须含 `unSafeJson: un.serializeToSafeJSON()`(round-trips covenant+utxo+outpoint·委员 sign_input_for_settle{safe_json:true} byte-exact)。
- 不加 → :3200 canonical build 只返地址-based preimage·委员签不出 byte-exact safe_json·daemon 跨节点收 sig 死锁(=今晚靠我 :3300 本地 patch build 才绕过)。
- **实现 phase 第一步·surgical 1-2 行加 canonical build-preimage return**(非 push 我 159-behind 本地全文件)。

### 1. close_attest 4-step 自动化(今晚手驱)
| step | 今晚手驱 | daemon 自动 |
|---|---|---|
| build | 我 POST bshard_close_attest{committee:[]} | daemon 调 relay IPC·拿 unSafeJson + psContAddress |
| sign | 各 committee relay sign_input_for_settle(我+J2 跨节点手 POST) | daemon 遍历 committee relay(canonical-grep 真集)·并发 POST·收 4-of-5 |
| assemble | J2 _j2_assemble·pk 升序+committee_pk_hash 自核+dummy 66B | daemon assemble·自核 committee_pk_hash |
| submit | 我 POST submit(我 fee) | daemon submit(daemon fee relay·见 §3) |

### 2. driver-side enforce 自动化(命门·item2·不丢 prevention 层)
今晚 pzmm5hg7 三方手验。daemon 单 driver 自动验·**submit 前硬闸**:
- daemon 独立 re-derive payoutRoot(gather→computePariMutuelPayout·= J2 域产出·daemon 复算交叉)。
- daemon 验 build output[selfOutIdx].address == compilePayoutShardRedeem({...consolidatedPool, closed:1, payoutRoot})派生地址(= 今晚 pzmm5hg7 predict-then-verify·地址烤死锚)。
- **不等 → 挂起 alert·不 submit**(NO TX NO STATE)。
- ⚠ 诚实: 这是 driver-side(daemon 单点 re-derive)·非 committee 各自 enforce。daemon 设计可选加 N-driver 交叉(多 daemon 实例复算对死)逼近 distributed·但默认单 driver = 今晚同口径。

### 3. fee 管理(今晚 fee-churn 反复咬)
今晚 fee UTXO 被 relay 其他操作 re-select churn 掉·致 un 失效。daemon 须:
- **专用 fee relay / fee UTXO 池**: daemon 用独立 relay(不跑其他广播)出 fee·或锁定 fee outpoint 到 submit(标记 reserved·relay UTXO 选择跳过)。
- fee 锁定窗口 = build→sign→submit 全程(尤其跨节点 sign 往返几分钟)。
- fee churn 检测: submit 前查 fee outpoint 仍 unspent·churn 了→重 build(fresh fee)·不盲 submit(无效签)。

### 4. consolidate 自动化(今晚我 :3300 驱)
- daemon 检测 close-时机(deadline 过)→ consolidate ShardLeaf→PayoutShard。
- **坑(今晚)**: ① ShardLeaf state-spliced·地址随 state 变·daemon 须 spliceLeafState(current_leaf_state)派生当前 SL 地址(非 genesis)。② lock_time=deadline_ms 必传(SL covenant deadline 闸·否则 mismatched locktime types)。③ PS_SEED=2e7·consolidated=seed+pool。

### 5. claim 自动化(今晚 J2 驱)
- daemon 检测 close LANDED → 为每 winner 自动 claim(NO-SIG·任意节点)。
- winner P2PK addr 必 round-trip 验(今晚 J2 撞 hex 双编码 bug)。
- dup-pk(pit01w)edge: position-nullifier 处理(merkle_index 区分)·daemon 按 merkle_index 逐 leaf claim。

### 6. 失败处理 NO TX NO STATE(item3)
- 算账失败(gather 0-bet / payoutRoot 算不出) → 挂起 alert·不结算。
- 委员缺席(收不到 4-of-5 sig) → 挂起 alert·不 fallback 乱退(refund 须独立判定·非 close 失败就退)。
- fee-churn / submit 拒 → 重试(fresh fee)·N 次失败挂起 alert。
- **铁律**: 任何上链步没 LANDED → 不推进 daemon 状态(查 kaspa_tx_log block_hash 非空才算 LANDED)。
- ⚠ shard-blind(今晚 3 现形): daemon 读 bet 数必 shard-aware(market_shards/ShardLeaf state·非 logical pool_bettor_sides bettorSum)·否则误判 0-bet。

### 7. 单-driver 锁(item4·防 double-drive)
今晚 KANet-UI/J1 抢驱 close(race·幸 covenant UTXO 保护没双花)。daemon:
- **每市场 driver lease**: daemon 取市场处理前抢锁(DB row lock / lease with TTL)·只一个 daemon 实例驱一个市场的一个 step。
- PS input(close/claim 花的 covenant UTXO)= 天然 double-spend 保护(链上一个赢)·但 lease 避免浪费 fee + 乱 alert。

### 灰度(item4)
- 先 N 盘(建议 3-5)真盘自动结算·co-verify 成功率·>阈值(建议 100% N 连成)才放量。
- 灰度期保留手驱 fallback(daemon 挂起→operator 手驱·今晚的脚本留作 break-glass)。

---

## 交 J2 settler 域(占位·J2 补)
- gather(shard-only)/computePariMutuelPayout/payoutRoot
- publishCloseRequest / collecting_sigs state machine(或 daemon 直驱 relay 命令绕 state·今晚证 status-independent 可行)
- committee VRF 选(deriveCommitteeSeed·endBlockHash chain_get_block_at_daa)
- 编排调度(market lifecycle: deadline→verdict→consolidate→close→claim 的 tick driver)
- winDir 来源(judgeLine ESPN·非 DB outcome_side)

---

## 开放问题(待 Bettor 审 + J2 补)
1. daemon 跑哪个节点? 单实例(简单·单点)vs 多实例(HA·需 lease 防 double-drive)。
2. committee sig 跨节点收集: daemon 直 POST 各节点 relay(需各节点 relay 可达 + canonical unSafeJson patch)·还是各节点 voter daemon 自治签(distributed enforce·更 trustless 但今晚未验)?
3. 灰度阈值 + break-glass 手驱保留多久?
