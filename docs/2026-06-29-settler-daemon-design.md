# interim-B 自动结算 daemon 设计 — J1(covenant/relay) + J2(settler) co-author

**派工**: Bettor 2026-06-29 (#ynvqtz·Owner 钦定 ZK 平替部署 top 优先)
**co-author**: J1(covenant/relay 执行) + J2(settler 编排) → Bettor 审方向+口径 → 灰度部署
**动机**: interim-B 真盘 2 盘可复现(bh01w + qi37q)·但全 operator 手驱(16min stall / fee-churn / 跨节点 handoff)。平替 = 手动 demo → 自动 daemon·替脆性 covenant 算术。
**canonical 路径**: 本文件 = 单一权威路径(bshard-m3-deploy)·别在 personal 分支留副本(今晚 doc 双路径教训)。

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

## J2 域: settler 编排(今晚手驱步骤的自动化骨架)

### S1. shard-aware gather/payout 单源(根治 shard-blind·今晚 3 现形·头号 daemon prerequisite)
**问题(今晚 3 现形·同根因=settler/cron 读 logical pool_bettor_sides bettorSum 不读 shard 吸收链)**: ①gather 早期混入 maker_stake(getSidesByLogicalMarket 4-vs-2 杂质) ②MIN_POT bettorSum=0(maker_stake 够过侥幸) ③退款 cron 误判 0-bet 翻 status=refunding。
**根治(机制·非逐处修·配记忆 fix-break-cycle)**:
- **单一 shard-aware 入口** `gatherOrderedBets(logicalMarketId)`(已 shard-only·zk-close-builder.mjs): 经 market_shards 查 shard_market_id → getSidesByShard(取 covenant 吸收链 register_append·非 logical 聚合)→ {bets, betsRoot, betCount}。**daemon 所有 bet 数/池值读必经此**·禁裸读 logical pool_bettor_sides。
- **payout 单源** `computePariMutuelPayout({bettors, winningDirection, feeBps, feeLeaves})`(pool-shard-settle.mjs) → payoutLeaves → `payoutRoot()`(pool-payout-root.mjs·depth-10 merkle·blake2b(pk‖ser(payout,8)) leaf)。
- **lint 堵旧 pattern**(lint-kanet.mjs 加 rule·配 item③ doc-lint 同机制): 禁 settler/daemon/cron 路径裸写 `pool_bettor_sides ... bettorSum/COUNT by logical market_id`(必走 shard-aware helper)·扫现存当 checklist 迁到 0。
- **degenerate(无 winning side)= refund 路非 strand**: computePariMutuelPayout 返 degenerate → daemon 走 refund 判定(独立·非 close 失败)·别误退 maker / strand 真池。

### S2. 编排调度(market lifecycle tick driver)
- **daemon tick**(30s cron·镜像 bshard-close-voter 骨架但走 manual-assemble 路): 扫 v0.7 市场 → 判 lifecycle stage → 驱对应 step:
  - `pending_bettors` + deadline 过 → 触发 verdict(judgeLine)→ consolidate(J1 §4)。
  - consolidated → close_attest(J1 §1·driver-side enforce J1 §2 / S3)。
  - close LANDED → claim per winner(J1 §5)。
- **winDir 来源铁律**: judgeLine(predicate_commit rule + ESPN 快照)实跑·**非 DB outcome_side**(今晚实证 outcome_side=1.0 但实 winDir=0·误导)。daemon 必 judgeLine re-derive。
- **state machine = relay-命令 manual-assemble 路(status-independent·今晚证可行)·非 publishCloseRequest/daemon-sign**: publishCloseRequest 零 caller + Track B 自治 daemon E1 未 wire 从没真跑(grep canonical 实证)→ daemon 直驱 relay 命令(build/sign/submit)·绕 status(避 refunding stale 等 cron 翻状态挡路)。配 close-drive playbook(记忆 project-interim-b-qi37q-...-playbook)。

### S3. committee VRF 选(确定性·跨节点一致)
- `selectCommittee(poolMembers, deriveCommitteeSeed(marketId, endBlockHash, poolMerkleRoot), {excludePks=[maker,broker,...bettors]})`(pool-committee-sampler.mjs·stake-weighted N=5·anti-grinding 3-因子 seed)。
- **endBlockHash** = `fetchEndBlockHashCanonical(reader, deadline_daa)`(SPC selected-parent-chain walk·relay chainReader·确定性跨节点一致)。daemon 自算 pin 死。
- **committee→relay 映射**(sign dispatch 用): `get_pubkey`(relay IPC)→ x_only_pubkey 匹配 committee pk → relay id。今晚实证全 :3200 oracle relay 可签。
- excludePks **必含 bettor pks**(今晚 e72d8e7e bettor 误入委员池利益冲突·excludePks 早期漏 bettor 只排 maker/broker)。

### S4. driver-side enforce(settler 侧·配 J1 §2)
- daemon **submit close 前**: 独立 gather→computePariMutuelPayout→payoutRoot·验 == build 要锚的 new_payout_root·且 build output[selfOutIdx].address == compilePayoutShardRedeem(closed=1,payoutRoot)派生(pzmm5hg7-式 predict-then-verify)。不等→挂起 alert 不 submit。
- **claim 前**: winner P2PK round-trip 验(payToAddressScript(addr).script == '20'+pk+'ac')+ merkle climb==payoutRoot 自核(depth-10 s0..s9·非 stale 注释 depth-8)。

### S5. commingled 入口堵(daemon 跳过·防 strand·配 ioaoc deferred)
- daemon 处理市场前查 `isCommingledSpine`(v06 logical PoolSide bet + v07 shard 共存): 若 commingled(logical 键有 bet)→ **不自动结算·挂起 alert**(今晚 ioaoc f5bb64c6 34KAS logical bet 会被 shard-only settle strand)。
- 长期: 入口堵 commingled(建市/押注拒 v06+v07 混)·非 status-cancel(断退款路·配记忆 pool-market-status-cancel)。

---

## J2 答开放问题(J1 提 + Bettor 审)
1. **daemon 跑哪节点 / 单 vs 多实例**: **单实例起步**(:3200·markets/DB/oracle relay 都在此·最少跨节点)·配 §7 per-market lease(即便单实例也防 tick 重入)。多实例 HA = 灰度稳后(lease 已为它铺好)。
2. **committee sig 跨节点收集**: **manual-assemble 路**(daemon 直 POST 各 committee relay sign_input_for_settle·canonical unSafeJson·= 今晚证过的路)·**prerequisite = J1 §0 canonical unSafeJson patch 先 land**。各节点 voter-daemon 自治签(distributed enforce)= production-trustless 真路下一步(今晚未验·别现在上)。今晚委员全 :3200 → 单节点 sign 够·跨节点是 :3300 委员才需(qi37q 全 :3200·没踩)。
3. **灰度阈值 + break-glass**: 3-5 盘 100% N 连成 co-verify GREEN 才放量·break-glass 手驱脚本(今晚的 _j2_*/j1-* tooling)保留**到灰度全绿 + 至少 2 周稳定**·别早删(daemon 挂起时 operator 兜底)。

---

## 实现 phase 序(先设计 Bettor GREEN 再码)
1. **J1 §0 canonical unSafeJson patch**(surgical·必先·解 daemon safe_json 死锁)。
2. **S1 shard-aware 单源 + lint**(根治 shard-blind·daemon 不误判 0-bet 的地基)。
3. close_attest 自动化(build→sign→assemble→submit·J1 §1 + S3 committee + S4 enforce)。
4. consolidate + claim 自动化(J1 §4§5 + S4 claim 验)。
5. 失败处理 + lease + commingled 堵(J1 §6§7 + S5)。
6. 灰度 3-5 盘 → 放量。
**每 phase Bettor 审方向+口径·NWT 红队命门·co-verify 落地。**
