# broker-fee-landed emit-pass — spec (J2, 2026-06-28)

> Owner 钦定主线: broker 佣金到账 DM 推送。consumer 侧已 ship (KANet-UI `d1f68dd1`:
> tg-bot poller → `eventsSince(broker_addr)` → notifyLine `broker_fee_landed`)。本 spec = **emit 侧 (J2 域)**。
> 诚实口径铁律 (Bettor): DM 只在【链上 LANDED fee】触发·金额必从 `kaspa_tx_log.outputs_json` 取·**禁 DB 估算**。

## 1. 为什么不能在 settle-submit 点 emit

`dispatchPhase2` settle TX 提交点 (`pool-market-settler.js` L3011, status→`completed` + `settle_txid`)
是 TX **刚 submit**·此刻 `kaspa_tx_log` 还没 index 这笔 TX (relay block-added indexer 要等 confirmed)。
→ 拿不到链验金额。在此 emit = 要么用 DB 估算 (违 Bettor 铁律)·要么 fee_sompi 缺失。

∴ emit 必须是**独立 pass·post-index**:等 settle TX 进了 `kaspa_tx_log` 再从 `outputs_json` 取真金额。

## 2. 设计:emit-pass (镜像 path-b reconcile L1124-1155)

settler tick 内加一个 pass (或独立 cron·复用 settler 节奏):

```
扫: pool_markets WHERE protocol_status='completed' AND settle_txid IS NOT NULL
    AND broker_pk IS NOT NULL
    AND <尚未 emit 过 broker_fee_landed>     -- 幂等 (见 §3)
每盘:
  1. row = kaspa_tx_log WHERE tx_id = settle_txid     -- 链上 indexed?
     无 → skip (下 tick 重试·settle TX 还没 confirmed/index)
  2. brokerAddress = XOnlyPublicKey(broker_pk).toAddress(net)   -- 与 settle 同源派生 (L1677-1681)
  3. outs = JSON.parse(row.outputs_json)
     brokerOut = outs.find(o => o.address === brokerAddress)    -- 按【地址】匹配·非位置·非 to_address
                                                                 -- (multiout-distribution 记忆: fee 常次级 output)
     无 brokerOut → skip + log (broker fee=0/below-floor/无 broker·不 emit 幻象)
  4. fee_sompi = brokerOut.amount_sompi                          -- 🔴 链验真金额·非 DB 估
  5. emit chain_event 'broker_fee_landed':
       from_address = spine_p2sh (settle TX 源) · to_address = brokerAddress
       payload = { market_id, broker_pk, broker_address, fee_sompi,
                   settle_txid, output_index, market_title (resolution_rule_spec), landed_at }
  6. 标记已 emit (§3)
```

## 3. 幂等 (一盘一次·防重复 DM)

两选一 (co-verify 定):
- **A (metadata 标记)**: `pool_markets.metadata.broker_fee_landed_emitted_at` 设后跳过。单源·随盘走。
- **B (chain_events 查重)**: emit 前查 `chain_events WHERE event_type='broker_fee_landed' AND payload LIKE '%market_id%'`·已有则跳。无新字段·但每 tick 多一次查。

倾向 **A** (metadata 标记·随盘·O(1)·与 settler 既有 metadata 模式一致)。

## 4. backfill 决策 (🔴 待 Bettor 拍)

现有 `completed` 盘 (24 commingled completed + 历史 settled) 已落 broker fee 但从没 emit 过。
首次 pass 上线会把这些**历史 fee 当新 DM 推**给 broker → 刷屏 + 误导 ("旧 fee 假装刚到")。
选项:
- **A (backfill-suppress·推荐)**: 首次 pass 把所有现存 `completed` 盘标记 `broker_fee_landed_emitted_at=<deploy>` (不 emit)·只有 deploy 后【新 settle】才推 DM。诚实 (DM=真·新·到账)·不刷屏。
- **B (silent backfill)**: 历史 fee emit 但 consumer 侧 lastTs cursor 自然跳过 (poller 只读 cursor 后的)。但若 broker 新 /link·会收到全部历史 = 刷屏。不如 A。
- **C (DM backfill)**: 主动补推历史佣金汇总 1 条 (非逐笔)。UX 友好但额外逻辑。

推荐 **A**·历史汇总走 `/earnings` (已有链验 earnings-by-address·kanet-broker.js:212)。

## 5. 诚实口径 / 边界

- 金额=链上 `outputs_json.amount_sompi`·绝不 DB 估 (Bettor 不超卖铁律)。
- settle TX 未 index → 不 emit (NO TX NO STATE·延迟到 confirmed)。
- broker fee 是 settle 的【次级 output】·必按 address 匹配·非 `to_address` 列 (记忆 `reference-verify-covenant-multiout-distribution`)。
- DM 时序: settle 后【略延迟】(等 confirmed+indexed)·非 settle 瞬间。诚实必要·已告知 KANet-UI。
- 跨节点: broker fee output 在 settle TX·任意 indexed 该 TX 的节点可 emit。本节点 (:3200) emit 即可 (settle 由 :3200 driver)。幂等防双节点重 emit (metadata 标记随盘 sync)。

## 6. 测试

- regression (offline): seed completed 盘 + 伪 kaspa_tx_log row (outputs_json 含 broker output) → 断言 emit pass 产 broker_fee_landed event·fee_sompi==outputs_json 值·幂等 (二次 run 不重 emit)·无 broker output→不 emit。
- live (gated on 真 fee): auto-better (Bettor 讨论中) 跑出真 v06 settle → broker fee LAND → emit → KANet-UI DM 实测。= bird② 依赖。

## 7. 序列

J2 spec (本) → Bettor backfill 决策 (§4) + co-verify (J1 settle 路 / NWT 单源+幂等+honest / Bettor 链验金额源) → J2 实现 + regression → live (auto-better 真 fee 后)。
