# Bettor Phase B — Fundamental Enricher Spec

**Author**: Bettor (architect + reviewer)
**Implementor**: J1
**Owner**: 5/14 17:00 钦定 ship Phase B Fundamental Enricher 模块. Hat 切换: Bettor architect/reviewer / J1 implementor.
**Status**: Spec v1 待 J1 T0 grep verify + propose refined scope

---

## 0. 上下文 + Owner 5/14 全天 pivot 链 (J1 必读)

### 0.1 Phase A 已 LIVE (5/14 我手动 ship)
- `kasia-console/src/services/bettor-scavenger.js` (~208 LOC) — trajectory + 流动性 + 价格区间 filter
- 6h cron register (`index.js` 老 bettor-scanner cron 已注释, scavenger cron 接管)
- API: `POST /api/bettor/scavenger/scan` + `POST /api/bettor/recommendation/:id/accept` (一键下单)
- UI: `/predictions` rec card 加 ACCEPT button + yes 价显示
- 实测: 10K markets → 40 qualified → 20 written, 5.8s elapsed
- 当前 J2 wallet 仓位 ($980 部署完): Arsenal YES $80 + Iran permanent peace 5/31 NO $200 + Iran obtains uranium 5/31 NO $700

### 0.2 Owner 5/14 钦定核心 invariants (must read)
1. **不闭门估 pMid** — Phase 3g LLM-Kelly framework 全 invalidated. Owner 14:50: "用这种策略找单子，就比你们之前用数学凯莉公式推导方式靠谱！稳一个字"
2. **rules+trajectory+流动性 driver** — scavenger 核心算法不动. fundamental enricher 是 **augment layer**, 不替换核心
3. **dynamic exit** — yes 价 spike OR 更好单子出现 → 清仓置换. Owner 钦定 "如果15天后概率变为5%以内, 清仓即可"
4. **置换 trigger**: 新候选 expected_return ≥ 现仓最低 + 3pp AND deadline ≤ 现仓 + 7 天 AND 通过 6 项验证
5. **portfolio capacity 优先 hold** — 没现金时 skip 新候选 (Owner 默认), 不强卖现仓

### 0.3 Phase A 局限 (Phase B 必须补)
Owner 17:00: "现在我们还差其中一个环节，就是发现单子太晚了。如果在60%，甚至70%概率发现，那将是完美的一个单子"

| Phase A 现状 | Phase B 目标 |
|---|---|
| catch yes ≤ 20% OR ≥ 80% 已收敛尾段 | catch yes 30-80% 早期 + fundamental gap |
| 单笔 lock 5-20% | 单笔 lock 25-50% |
| 0 fundamental check | LLM grounded fundamental reasoning |
| reactive (等市场收敛) | proactive (基本面驱动 early entry) |

---

## 1. Scope — 5 Sub-modules

| sub | module | 数据源 | LOC | ETA | 优先级 |
|---|---|---|---|---|---|
| **B1.1** | Domain detector | LLM (qwen/glm/cc-bridge fallback) | 50 | 30 min | P0 |
| **B1.2** | Sports enricher | ESPN API + TheSportsDB | 120 | 1.5 h | P0 |
| **B1.3** | Fundamental reasoner | LLM (grounded data input) | 100 | 1.5 h | P0 |
| **B1.4** | Scavenger 集成 | 拓宽 yes 区间 + gap check | 50 | 45 min | P0 |
| **B2.1** | Politics enricher | RealClearPolitics OR 538 archive | 100 | 1.5 h | P1 |
| **B2.2** | Economic enricher | FRED API | 80 | 1 h | P1 |
| **B3.1** | Crypto on-chain enricher | Polygonscan / Etherscan | 120 | 1.5 h | P2 |
| **B4.1** | UI 显示 fundamental | rec card 加列 | 30 | 30 min | P0 |
| **B4.2** | DB schema v109 migration | bettor_recommendations 加 3 列 | 20 | 15 min | P0 |
| **总** | | | **~670** | **6-8 h** | |

**Ship sequence**:
- B1 全部 (B1.1+B1.2+B1.3+B1.4+B4.1+B4.2) → 2.5h, **demo Arsenal + Bottoms catch real-time**
- B2 (B2.1 + B2.2) → 2.5h
- B3 (B3.1) → 1.5h

---

## 2. Detail Spec per Sub

### B1.1 Domain detector — `bettor-domain-detector.js`

**Signature**:
```js
export async function detectDomain(question, description) {
  // returns { domain, confidence, reasoning }
  //   domain: 'sports' | 'politics' | 'economic' | 'crypto' | 'legal' | 'other'
}
```

**Implementation**:
- Build prompt: "Classify this prediction market question into ONE category: sports/politics/economic/crypto/legal/other. Output JSON {domain, confidence (0-1), reasoning}"
- Call qwen llama-server first, fallback to cc-bridge (per Phase 3a LLM fallback chain in `services/llm-helper.js` if exists, else inline)
- Parse JSON, fallback to 'other' if malformed
- Cache result per market_id in `bettor_domain_cache` table (1h TTL)

**Anti-patterns**:
- Don't allow LLM to estimate probability here. Domain detection only.
- Qwen Rule 11: `chat_template_kwargs.enable_thinking=false` (per `feedback_qwen_kill_switch_rule11.md`)

### B1.2 Sports enricher — `bettor-sports-enricher.js`

**Signature**:
```js
export async function enrichSports(question, description) {
  // returns { league, teams, standings, schedule, fundamentals }
  //   fundamentals = LLM-readable text summarizing relevant data points
}
```

**Data sources (priority order)**:
1. **TheSportsDB free API** (`https://www.thesportsdb.com/api/v1/json/3/...`) — free, supports EPL/NBA/NFL/MLB/NHL
2. **ESPN public API** (no key, scrape JSON: `https://site.api.espn.com/apis/site/v2/sports/...`)
3. Fallback: skip enricher, return {fundamentals: null}

**Implementation**:
- Parse question for league + teams (regex + LLM-assisted): "Will Arsenal win EPL" → league=EPL, team=Arsenal
- Hit TheSportsDB `/searchteams.php?t=Arsenal` → team_id
- Hit ESPN `/sports/soccer/eng.1/standings` → 完整 standings JSON
- Build `fundamentals` string: "Arsenal: 79 pts (rank 1, 36 games); Man City: 77 pts (rank 2). Schedule remaining: Arsenal vs Burnley (rank 19, relegated) 5/19 + vs Crystal Palace (rank 15) 5/25. Man City vs Bournemouth (rank 6) 5/20 + vs Aston Villa (rank 5) 5/25."
- Return to reasoner

**Anti-patterns**:
- Don't hit non-public APIs that need key (TheSportsDB free is fine)
- Cache per `team_id + date` 6h to avoid rate limit

### B1.3 Fundamental reasoner — `bettor-fundamental-reasoner.js`

**Signature**:
```js
export async function reasonFundamental(question, description, enrichedData) {
  // returns { estimate, confidence, sources, reasoning }
  //   estimate: 0..1 (probability of YES resolution given fundamentals)
  //   confidence: 0..1 (how reliable enriched data is)
}
```

**Implementation**:
- Build prompt with enriched data (sports/politics/etc) INCLUDED:
  ```
  You will receive a binary prediction market question + grounded data.

  Step 1: List specific facts from the grounded data that bear on the question.
  Step 2: For each fact, state direction (favors YES / favors NO / neutral).
  Step 3: Estimate combined probability of YES resolution.
  Step 4: Output JSON: {estimate, confidence, sources: [...], reasoning}

  Question: {q}
  Grounded data: {enriched_data}
  ```
- Critical: prompt prohibits "I think" / "I feel" — must cite specific facts from grounded data
- If grounded data is empty → return {estimate: null, confidence: 0} (no闭门估)
- LLM fallback chain qwen → glm → cc-bridge
- Qwen Rule 11 必加

**Anti-patterns**:
- LLM 闭门估 pMid 严格 forbidden — if enriched_data is empty/missing, return null estimate
- Don't combine YES/NO direction without grounded fact citation

### B1.4 Scavenger 集成 — `bettor-scavenger.js` 内改

**变更**:
1. 拓宽 yes 区间 — 之前 [0.005, 0.20] ∪ [0.80, 0.995], 新增 [0.30, 0.70] **要求 fundamental_gap > 15pp** 才进 list
2. scoreMarket() 调用 detectDomain → enrich → reason → 算 fundamental_gap = |fundamental_estimate - yes|
3. 写 bettor_recommendations 时加 fundamental_estimate / fundamental_sources / fundamental_confidence 字段
4. ranked list 按 (lock_pct + fundamental_gap × 0.5) 排 — 倾向高 fundamental gap

**伪代码**:
```js
async function scoreMarket(m, nowMs) {
  // ... existing trajectory + 流动性 check
  const yes = ...
  let side, lockPct;

  // Phase B 拓宽: 中段 (30-70%) 需要 fundamental gap
  if (yes >= 0.005 && yes <= 0.20) { side = 'NO'; lockPct = yes; }
  else if (yes >= 0.80 && yes <= 0.995) { side = 'YES'; lockPct = 1 - yes; }
  else if (yes >= 0.20 && yes <= 0.80) {
    // 中段: 必须 fundamental 支撑
    const domain = await detectDomain(m.question, m.description);
    if (domain.domain === 'other') return null;
    const enriched = await enrich(domain.domain, m.question, m.description);
    if (!enriched.fundamentals) return null;
    const fund = await reasonFundamental(m.question, m.description, enriched);
    if (fund.estimate == null) return null;
    const gap = Math.abs(fund.estimate - yes);
    if (gap < 0.15) return null; // 中段必 ≥ 15pp gap
    side = fund.estimate > yes ? 'YES' : 'NO';
    lockPct = side === 'YES' ? (fund.estimate - yes) : (yes - fund.estimate); // 实际 alpha
  } else return null;
  // ... continue existing trajectory/liq/tail risk pipeline
}
```

### B4.1 UI 显示

`predictions.eta` rec card 加列:
- fundamental estimate (e.g. "fund: 95% vs market 81%")
- 数据源 (e.g. "ESPN standings 5/14")

### B4.2 DB v109 migration

```sql
ALTER TABLE bettor_recommendations ADD COLUMN fundamental_estimate REAL;
ALTER TABLE bettor_recommendations ADD COLUMN fundamental_sources TEXT; -- JSON array of source URLs
ALTER TABLE bettor_recommendations ADD COLUMN fundamental_confidence REAL;
CREATE TABLE bettor_domain_cache (
  market_id TEXT PRIMARY KEY,
  domain TEXT,
  confidence REAL,
  reasoning TEXT,
  cached_at TEXT NOT NULL
);
```

---

## 3. Acceptance criteria (Tier 4 real-data verify)

B1 完成 ship 必须实测通过:

### Test 1: Arsenal EPL
- Input: "Will Arsenal win the 2025–26 English Premier League?", yes 0.815
- Expected: domain=sports, enriched=Arsenal 79 vs MC 77 + schedule, fund.estimate ∈ [0.88, 0.96], gap ∈ [0.06, 0.15]
- Pass: fundamental_gap ≥ 0.05 (Phase B catch + reasoning cites real standings)

### Test 2: Bottoms primary
- Input: "Will Keisha Lance Bottoms win the 2026 Georgia Governor Democratic primary?", yes ~0.90
- Expected: domain=politics → (B2.1 ship 后) enriched=民调 RCP 52% vs 16% + Biden endorse, fund.estimate ∈ [0.92, 0.99]
- Pass: B2.1 ship 后跑通

### Test 3: Anti-pattern verify — Eurovision
- Input: "Will Finland win Eurovision 2026?"
- Expected: domain detect borderline (sports? other?), if sports enricher 拿不到 Eurovision data → fund.estimate = null → 不进 list
- Pass: **不闭门估** (LLM 不能凭空说 "Finland 2%"). 必须 grounded data 才出 estimate.

---

## 4. Anti-patterns 警示 (Phase 3g 经验 sediment)

| AP | 说明 | 防范 |
|---|---|---|
| LLM 闭门估 pMid | Phase 3g Finland 2% 灾难 | enriched_data empty → return null, 不允许 reasoner fallback to base statistical |
| capMessage 5000 cap | J1 #178 自身被截 | broadcast 拆分 + spec 文件链上 link |
| 数据源 dead path | Phase 3g Sub 10.1 Cloudflare 403 | T0 必 curl verify 数据源 reachable |
| Owner "稳一个字" | 不追高 yield 追确定性 | reasoner 必 cite source, low-confidence → flag 不 surface |
| portfolio capacity | 5/14 越界 ACCEPT $200 → 撞 balance | accept endpoint 自动 cap to wallet 现金 (Phase A 已 ship) |
| Qwen Rule 11 | chat_template_kwargs.enable_thinking=false | 任何 LLM caller 必加 (broker-llm-agent 60-120s timeout 教训) |

---

## 5. Hand-off 给 J1

**J1 implementor workflow (per `feedback_implementer_grep_propose_workflow`)**:

1. **T0 grep verify** — 拿到这 spec 后必 grep:
   - `grep -n "scoreMarket\|persistCandidates" kasia-console/src/services/bettor-scavenger.js`
   - `grep -rn "chat_template_kwargs.enable_thinking" kasia-console/src/services/`
   - `curl https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=Arsenal`
   - `curl https://gamma-api.polymarket.com/markets?slug=...` for Bottoms slug
2. **深挖 spec 漏洞** — 标 spec 哪条不合理 / 数据源 dead / 接口 signature 跟现有 code 冲突
3. **propose refined scope** — 修正 LOC / ETA / 接口 signature
4. **broadcast 上链 propose** — 含 grep evidence + refined spec
5. **standby reviewer (Bettor)** ack 后开 ship
6. **每 sub commit 立即 broadcast** — per `feedback_broadcast_after_commit`

**Bettor reviewer workflow**:
1. 收到 J1 propose → broadcast 上链 review (PASS / 修改)
2. 收到 J1 sub commit → 实测 ground truth (跑 Arsenal Bottoms 真 case) → broadcast verdict
3. 全 B1 ship 完 + 实测 PASS → 同步 ship plan to Owner ack ship B2

---

## 6. Open questions to J1

- Q1: kasia-console 有没有现成 LLM helper 抽象 (qwen/glm/cc-bridge fallback)? 还是 inline 每个 enricher?
- Q2: TheSportsDB free tier 流量限制?  rate limit cache strategy?
- Q3: Politics 民调源 538 sunset (Nate Silver 跳 ABC), 用 archive 还是改 RealClearPolitics + scrape?
- Q4: Crypto enricher (B3) 用 polymarket-native crypto markets 还是真上 etherscan? 优先级低可 defer.
- Q5: bettor_domain_cache TTL 1h 是否合理? 不同 domain 不同 TTL?

J1 grep verify 完答上面 Q + propose refined scope 再 ship。
