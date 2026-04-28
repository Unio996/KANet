# Owner 真测 verify checklist

> **范围**: SHIP-CHECKLIST.md 第 2 条 'Owner 真测 0 bug verify' 的 actionable 详细。新 ship feature / phase closure 之前 Owner 必经此 checklist。
> **新建**: 2026-04-28（task 5/5，broker 开发踩坑 sediment）。
> **关联**: docs/SHIP-CHECKLIST.md 第 2 条 / docs/ANTI-PATTERNS.md R40 / docs/COLLAB-REFORM.md 规 11.

---

## Critical path 4 项

ship phase closure 之前 Owner 必跑 ≥1 项（J1 SHIP-CHECKLIST 第 2 条 spec），4 项全 pass 才算"0 bug verify"。

### 1. BUY 流程

**scenario**: Owner DM broker "我要买 5 KAS, BSC 链, 0x<addr>"
**broker 应回**:
- preview 含: 数量 5 KAS / 收款地址 / spread / fee / kasia 收单地址 / 等用户回 YES 确认
- Owner DM "YES" / "确认" / "对" → broker 调 finalize_order tool → 锁单 + 状态 pending_payment

**pass 准则**:
- broker 不编造价格 (preview_order tool 真生成, 不 LLM hallucinate)
- broker 不直接说 "已下单" (必经 finalize_order tool)
- preview 数据准 (跟 spread% / fee 配置一致)

### 2. SELL 流程

**scenario**: Owner DM broker "我要卖 5 KAS, BSC 链, 0x<receiving USDT addr>"
**broker 应回**:
- 卖单画像 (deterministic, no LLM)
- 等 user 后续指令 (R33 SELL state lock active)
- user 接续问答 (e.g. "请问可以分批付款吗") → broker LLM 真返 200 (不 fallback "LLM 卡了一下")

**pass 准则**:
- R33 SELL state lock 不致 LLM Jinja 500 (Bug-Z24 fix verify)
- broker 不编造 fake 卖单 (preview_order tool 真生成)
- 跨 turn 状态 sticky (R33 sticky direction lock works)

### 3. cancel-refund 流程

**scenario**: Owner DM broker "取消" / "不要了" / "退我钱" (任一 cancel-intent)
**broker 应回**:
- broker 调 cancel_order tool → 锁单 → sendKas refund → broker DM "已退 X KAS 给你"
- chain_events broker_kas_refunded 真存 + tx_id 在 kaspa_tx_log

**pass 准则**:
- broker 不编 fake ack (Bug-Z19 真案: broker 说"已退" 但 chain 没动)
- audit log 跟 chain truth align (R39 INSERT-before-confirm 修法)
- Owner 钱包真收到 refund (链上真有 tx)
- 没 active offer 时 cancel_order 返 deterministic null/no-op (不 hallucinate)

### 4. payment verify 流程

**scenario**: Owner 付款后 DM "已付" / "paid" / "我转了" / "check my payment" (含或不含 0x tx hash)
**broker 应回**:
- broker 调 verify_payment tool → 反查 BSC 收款地址近 75 分钟 OR 用 tx hash 验证
- 找到 tx → 锁单 → 状态 paid_verified → enqueue refund-side delivery
- 没找到 → broker DM "暂未在收款地址查到, 请稍候 OR 复查 tx hash"

**pass 准则**:
- broker 不静默 (Bug-A 真案: Owner '已付!' broker 不回 1.88 USDT 卡 broker)
- broker 不调 finalize_order (Bug-A 双保险 配 PAID_NO_TX_REGEX deterministic 兜底)
- verify_payment tool 没 active offer 时返 deterministic null/no-op

---

## Bug 报回模板

Owner 真测撞 bug 时, broadcast 进 dev-coord:

```
[Owner 真测撞 bug] <critical path 1/2/3/4> + <一句症状>

scenario: Owner DM "<原话>"
broker 回: "<broker 真回的话>"
expected: "<应该回的话>"
真根因 dig (J1+J2+NWT): TODO

priority: <P0 (production fire) / P1 / P2>
```

三方收到后立即 dig, 走规 13 emergency SOP (production bug trigger → 30min 内 ack OR 自动 revert).

---

## "0 bug verify" 含义

J1 SHIP-CHECKLIST 第 2 条 spec "Owner 真测 ≥1 critical path 跑通" — minimum bar 是 1 项。但 phase closure 时三方 propose 走全 4 项 (覆盖 BUY+SELL+cancel+payment)。

实际是 trade-off:
- **fast ship** (1 项 spot-check) — 适用 minor commits / non-critical 8 file changes
- **phase closure full sweep** (4 项 全跑) — 适用 multi-layer ship / critical 8 file 大改

具体哪种 三方 propose + Owner final ack。

---

## Owner ack 模板 (post 真测 pass)

```
[Owner 真测 pass] <critical path 1/2/3/4> + <一句体感>

DM 跑通 ✓ broker reply 准 ✓ chain truth align ✓ (post-restart verify)

ack-tx: <Owner 本 broadcast tx>
```

三方 ack Owner 真测 pass → 进 SHIP-CHECKLIST 第 2 条 PASS column → 配齐其他 6 条 才 broadcast phase closure (R40 sediment).

---

## 关联 docs

- `docs/SHIP-CHECKLIST.md` 第 2 条（Owner 真测 0 bug verify）— 本档是 actionable 详细
- `docs/ANTI-PATTERNS.md` R40（ship ≠ sealed phase closure）— premature closure 真案 sediment
- `docs/COLLAB-REFORM.md` 规 11（phase closure 不 premature）+ 规 13（emergency SOP）
- `docs/kanet-investigation-methodology.md` 第 0 层 + 六层（Owner 真测撞 bug 后 dig 方法）

新 critical path 加进 broker 时（e.g. 加 OTC / Hyperliquid 等 flow），同步加进本档第 5/6/7 项。
