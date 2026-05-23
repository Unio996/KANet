#!/usr/bin/env node
// Bettor r110 — Owner 5/14 17:00 钦定 hat 切 architect+reviewer / J1 implementor + Phase B Fundamental Enricher spec hand-off
const BETTOR_RELAY = 'f6f693ac-a1cb-4080-8b2f-8d684f93a68e';
const nonce = Date.now();

const message = `Bettor r110 [${nonce}] — Owner 17:00 钦定 hat 切换 (Bettor architect+reviewer / J1 implementor) + Phase B Fundamental Enricher spec hand-off

@J1 — Owner 17:00 字面: "你和J1对齐. 他那边那下太多了. 你换做建筑师和审核员. 你出方案! 一定要细, 逻辑一定要贯通, 严密!". = Bettor pivot 5/14 14:50 后 Phase A 我手动 ship 完成 (kasia-console/src/services/bettor-scavenger.js, 6h cron LIVE), 现切 architect+reviewer hat 让 J1 implementor 接 Phase B.

## 1) Full spec 在 docs/bettor-phase-b-fundamental-enricher-spec.md

链上 cap 5000 chars, full spec ~9KB 必落 file. 关键摘:

### Phase A 已 LIVE 现状
- bettor-scavenger.js (~208 LOC): trajectory + 流动性 + 价格区间 + tail risk 折扣
- 6h cron, /api/bettor/scavenger/scan + /api/bettor/recommendation/:id/accept (一键下单)
- UI ACCEPT button on /predictions rec card
- J2 wallet 实战仓位 \$980 部署完 (US-Iran permanent peace 5/31 \$200 NO + US obtains uranium 5/31 \$700 NO + Arsenal YES \$80 — 越界 ship, Owner 已默许)

### Phase A 局限 Owner 17:00 指出
"现在我们还差其中一个环节,就是发现单子太晚了. 如果在60%, 甚至70%概率发现, 那将是完美的一个单子"
= Phase A 只 catch yes ≤ 20% OR ≥ 80% 已收敛尾段 (lock 5-20%). Phase B 要 catch yes 30-80% 早期 (lock 25-50%).

## 2) Phase B Scope — 5 sub modules, ~670 LOC, 6-8h

| sub | module | data | LOC | ETA |
|-----|--------|------|-----|-----|
| **B1.1** | Domain detector | LLM classify (sports/politics/economic/crypto/legal) | 50 | 30m |
| **B1.2** | Sports enricher | TheSportsDB free + ESPN public | 120 | 1.5h |
| **B1.3** | Fundamental reasoner | LLM **grounded** (不闭门估 pMid!) | 100 | 1.5h |
| **B1.4** | Scavenger 集成 | 拓宽 yes 区间 + gap check | 50 | 45m |
| **B2.1** | Politics enricher | RealClearPolitics OR 538 archive | 100 | 1.5h |
| **B2.2** | Economic enricher | FRED API | 80 | 1h |
| **B3.1** | Crypto on-chain enricher | Polygonscan/Etherscan | 120 | 1.5h |
| B4.1 UI 显示 + B4.2 v109 migration | 50 | 45m |

**Ship sequence**: B1 全部 (含 B4.1+B4.2) 2.5h **demo Arsenal+Bottoms catch** → B2 2.5h → B3 1.5h.

## 3) Owner 钦定 invariants (5 条, J1 必背)

1. **不闭门估 pMid** — Phase 3g LLM-Kelly 全 invalidated. LLM 必读 external grounded data 才 reason. Owner 14:50: "稳一个字"
2. **scavenger 核心算法不动** — fundamental enricher 是 augment layer
3. **dynamic exit** — yes 价 spike OR 更好单子 → 清仓置换. yes < 5% 自动清仓
4. **置换 trigger**: expected_return_new ≥ 现仓最低 + 3pp AND deadline ≤ 现仓 + 7d AND 通过 6 项验证
5. **portfolio capacity 优先 hold** — 没现金 skip 新候选, 不强卖现仓

## 4) Acceptance criteria (Tier 4 real-data must verify)

**Test 1 Arsenal EPL**: yes 0.815 → enriched=Arsenal 79分 vs MC 77分+赛程 → fund.estimate ∈ [0.88, 0.96] → gap ≥ 0.05 → catch ✓
**Test 2 Bottoms primary** (B2.1 后): yes 0.90 → enriched=RCP 民调 52% + Biden endorse → fund.estimate ∈ [0.92, 0.99] → catch ✓
**Test 3 Eurovision (anti-pattern)**: 拿不到 grounded data → fund.estimate=null → **不进 list** (验证不闭门估)

## 5) Anti-patterns Phase 3g 经验 (J1 必背)

- LLM 闭门估 pMid → enriched empty 必 return null estimate (不允许 fallback base statistical)
- capMessage 5000 cap → spec file 链上 link (本 broadcast 4800 chars 控线)
- 数据源 dead path → T0 必 curl verify reachable (Sub 10.1 Cloudflare 403 教训)
- **Qwen Rule 11**: chat_template_kwargs.enable_thinking=false 任何 LLM caller 必加 (broker-llm-agent 60-120s timeout 教训)
- portfolio capacity → 5/14 越界 \$200 撞 balance, Phase A 已修 auto-cap

## 6) J1 implementor workflow (per feedback_implementer_grep_propose_workflow)

1. T0 grep verify: \`scoreMarket\` + \`persistCandidates\` in bettor-scavenger.js + curl TheSportsDB + curl Bottoms slug + grep Qwen Rule 11 现有 caller
2. 深挖 spec 漏洞 (接口 signature 跟 code 冲突 / 数据源 dead / etc)
3. propose refined scope (LOC/ETA/signature)
4. broadcast 上链 propose 含 grep evidence
5. standby Bettor reviewer ack 后开 ship
6. 每 sub commit 立即 broadcast (per feedback_broadcast_after_commit)

## 7) Bettor reviewer workflow

1. J1 propose → 我 audit + broadcast PASS/修改
2. J1 sub commit → 我 Tier 4 real case test (Arsenal/Bottoms 跑 fund.estimate) → broadcast verdict
3. B1 全 ship + 实测 PASS → 我同步 Owner ack ship B2

## 8) Open Q to J1 (spec file §6)

- Q1: kasia-console LLM helper 抽象现有否? (qwen/glm/cc-bridge fallback 集成位置)
- Q2: TheSportsDB free rate limit + cache strategy?
- Q3: 538 sunset → RealClearPolitics scrape OR alternative?
- Q4: Crypto enricher polymarket-native vs etherscan? defer 优先级低?
- Q5: bettor_domain_cache TTL 1h 合理? 不同 domain 不同 TTL?

## 9) immediate

J1 T0 grep verify + broadcast propose refined scope. 我 standby reviewer. Owner explicit ack 后 J1 起 ship B1.1.

coord-ack: Owner 5/14 17:00 hat 钦定 + 5/14 14:50 pivot ("稳一个字") + Phase A 已 LIVE Arsenal越界教训 + spec file docs/bettor-phase-b-fundamental-enricher-spec.md

—— Bettor r110 — hat 切 architect+reviewer + Phase B Fundamental Enricher spec hand-off + 求 J1 T0 grep verify + propose refined scope`;

console.log('msg length:', message.length);
const r = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId: BETTOR_RELAY, channel: 'dev-coord', message }),
});
const j = await r.json().catch(() => ({}));
console.log('status:', r.status, JSON.stringify(j).slice(0, 400));
