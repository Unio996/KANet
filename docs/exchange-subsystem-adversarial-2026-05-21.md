# Exchange 子系统对抗 status report — 2026-05-21

**Owner 钦定** (5/21 00:50 UTC): "你和 nwt 对抗性讨论一下，目前 exchange 各个子系统状态。接下来方向和具体打算，出一个报告".

**J2 角度** 写出 honest 状态 + 对抗点 + propose. NWT push back 后 finalize 给 Owner.

---

## 1. 子系统真实状态 (24h 数据 + 实证)

| 子系统 | 24h 数据 | 真实状态 | J2 评 |
|--------|----------|---------|-------|
| **broker (v3-escrow)** | 13 completed | ✅ healthy, Phase 1a hedge 闭环 (KI 22+27+40 fix 30 day silent dead) | 主线工作 |
| **autoTaker** | 5 accepted / 73 skipped = **6.4% accept rate** | ⚠ gate 太窄 (12 min stress 测出 only 3 fire) | **争议点 #1** |
| **hedge router (CEX)** | hedge_placed=1 (history), failed=13, skipped=1 | ⚠ 仅 Bybit real-tested. KuCoin route (KI 47.1) 0 验证 | **争议点 #2** |
| **cross-match** | 2832 ticks / **0 hits** | ❌ 心跳活但 0 match 24h, gate 太严 | **争议点 #3** |
| **treasury monitor** | 558 treasury_alert 24h | ✅ red-line broadcast work (KANET_STRESS_MODE bypass throttle real fired) | 健康 |
| **broker auto-replenish** | 0 broker_auto_replenish_v2 24h | ⚠ 4 mechanism ship 完 (KI 50/51/52 + legacy USDC swap) 但 Console restart 未 reload → cron 未 fire | **blocked Console restart** |
| **expired offers** | 101 / 24h | ⚠ ~88% expire rate (但 ~45 来自 test fixtures KI 33 fix 后 cron 不再 burn) | 大头是 test 残留 |
| **stress framework** | KI 41-46 ship, 12 min real test verified | ✅ multi-agent + auto-abort + rollback chain end-to-end work | 框架 ready |

---

## 2. 对抗 4 个争议点 (J2 view, 期 NWT push back)

### 争议 #1: autoTaker 6.4% accept rate — feature or bug?

**J2 view**: Bug. 73 skip 大多 'discount < 1%' gate filter. 6.4% accept = autoTaker 几乎 useless. broker hedge 闭环已通 (KI 22+27+40), 兜底有 — autoTaker 该放宽 (discount threshold 1% → 0.3%? 或 disabled).

**NWT 可能反驳**: 6.4% rate 是 safety feature. autoTaker 自动接单 = production money flow, 不该 trigger-happy. 现 rate 守住 only profitable offers.

**J2 反**: production data 显示 broker 是主力 (13 completed via broker-v3-escrow), autoTaker 5 accept 中可能有 stress 测试 inflation (KI 49 修后才 skip). 真 production autoTaker accept rate 不到 6.4%, 可能 < 2%. 

**对齐 ask**: 测真 autoTaker 1 周 zero-stress 期 accept rate? 数据驱动调 threshold?

### 争议 #2: hedge router per-CEX 真测 gap

**J2 view**: 5 CEX 配 (bybit/mexc/gateio/bitget/kucoin), 仅 Bybit 1 real cycle (KI 27 修后 first hedge_placed). KuCoin route (KI 47.1) 真验 0. Gate.io auto-withdraw (KAS refill KI 52) 真验 0. Phase 6 #2/#3 真测必须 ship verify.

**NWT 可能反驳**: code 都 reuse existing infra (bridge-router selectAndBridge, cex-bridge withdrawCex), 真测加 confidence 但不加 capability. Defer 排日 OK.

**J2 反**: 今天 KI 40 getConfig 漏 import bug 是 24 min silent crash, 没真测 prove. CEX route 同款 anti-pattern risk — code work in test 不 = production. real-chain verify 是 sine qua non.

**对齐 ask**: Owner Phase 6 #2/#3 real-fire 时机 — 现 dev-coord 1+h silent pause window, 适合.

### 争议 #3: cross-match 24h 0 hit — 治还是 punt?

**J2 view**: 2832 tick 心跳活 + 0 match 24h = dead invariant. gate 4 个 (oracle ±3% / chain align / same-org skip / qty ±5%). 看真实 open offer 状况 — broker-v3-escrow 是主力, 其他 maker 大多 same-org or chain mismatch.

**NWT 可能反驳**: cross-match Phase 1 audit-only — 设计就是 conservative. Phase 2 拓 partial fill + active settle, 现 0 hit 不是 bug 是 setting.

**J2 反**: 0 hit 1 周 = framework 测试 0 cycle 跑通. 哪怕 sediment "Phase 1 design no expected hits" 也好. 现状 = 不知 alive (心跳) 还是 dead (logic broken).

**对齐 ask**: 现 24h 0 hit 是预期? 加 test 验 cross-match-engine 在 mock offer pair 下能 emit match event? 或 acknowledge phase 1 audit-only nature.

### 争议 #4: 4 个 auto-replenish 是 over-engineered?

**J2 view**: KI 50 (stress pool) + KI 51 (multichain U) + KI 52 (KAS refill) + legacy J2 #3 (BSC USDC swap) = 4 mechanism. 复杂. Phase 6 #4 spec ~340 LOC + 10 knob.

**NWT 可能反驳**: 4 mechanism 各 cover 不同 fail mode:
- stress pool = test agent prefund (KANET_STRESS_MODE=1)
- multichain U = cross-chain rebalance (broker BSC drain → 取 ETH/Polygon)
- KAS refill = CEX → broker (hedge buy KAS 后)
- USDC swap = native BSC USDT ↔ USDC

非 overlap, 都 needed.

**J2 反**: agree 各 cover 不 overlap. 但 cron 全 5min/1h tick + DRY_RUN gate + throttle 1h, 每 cron 0 fire 时 zero-cost. NWT 说对.

**对齐**: 4 mechanism keep, Console restart 后 verify cron 真 fire (现 Console restart blocked so 0 fire 24h 看似 dead 实际 just blocked).

---

## 3. 接下来方向 — J2 propose 4 path

### Path α: Phase 6 #1/#2/#3 close (短期 6-8 hr)
- Console restart fire (Owner ack needed) → KI 47.1+48 fix 真 load production
- #2 KuCoin route verify (1 cycle, $0.12)
- #3 Per-CEX matrix (Gate/Bitget/MEXC each 1 cycle, $0.48)
- #1 6h endurance (180 cycle, $22, KuCoin route 主测)
- Phase 6 真 close, broker autonomous 全 verified

### Path β: cross-match Phase 2 active-settle (中期 8-12 hr)
- 现 0 hit 24h = audit-only no value
- Phase 2 spec: cross-match 真 settle (publish handler 撮合 + 双方 verify + 真 chain TX)
- 大 scope (~300-500 LOC + 真链 e2e test)

### Path γ: autoTaker threshold 调优 (短期 1-2 hr)
- 数据驱动: 24h skip reason distribution analyze
- propose new threshold (discount 0.3% / max amount 10 USDT / cooldown 60s)
- Owner UI 真调 + observation 1 周
- 风险: 太松 → broker autoTaker 真烧钱 → production loss

### Path δ: 新方向探索 (长期)
- Phase 7? broker AI 决策 (Mind LLM 真 decide hedge vs hold)?
- Multi-broker network (跨 Console instance broker p2p)?
- New asset support (BTC/ETH spot)?

### J2 个人推 Path α + γ 短期 ship, Path β 排日, Path δ 待 Owner direction

---

## 4. 具体打算 (J2 1-week plan)

| Day | Phase | Content | Owner ack? |
|-----|-------|---------|------------|
| Today (Wed) | α #1 | Console restart + Phase 6 #2/#3 verify (~1.5 hr cost ~$0.6) | A/B/C pick 已 broadcast pending |
| Wed-Thu | α #2 | Phase 6 #1 6h endurance (cost ~$22) | scheduled fire |
| Thu | γ #1 | autoTaker threshold analyze + propose (零 cost code work) | review propose 后 fire |
| Thu-Fri | β #1 | cross-match Phase 2 spec (NWT architect) | NWT spec → J2 ship |
| Fri-Sat | β #2 | cross-match Phase 2 ship + test | ship cycle |
| weekend | δ | Owner pick next direction | Owner gate |

---

## 5. Adversarial pre-emptive 防御

NWT 可能 catch:
- **Issue A**: J2 "6.4% accept rate" 数据来源 24h total, 但分 production vs stress test. 5 accept 中可能 4 是 stress agent fire (KI 49 修前). 真 production accept rate 可能更低 (~1%).
- **Issue B**: "broker_auto_replenish_v2 = 0 24h" 不是 service dead, 是 Console restart blocked. 修法 = Console restart 才能区分.
- **Issue C**: cross-match "0 hit" 可能是 invariant tightened 后正常 (4 risk gate). 不能 conclude bug 不 dig 真数据.

J2 ack 这 3 个 preemptive. NWT 真 deep audit 时这 3 个估正中.

---

**期 NWT push back 后 finalize**. J2 standby.
