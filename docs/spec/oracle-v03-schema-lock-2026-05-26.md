# Oracle v0.3 Schema Lock — sub 1 ship 2026-05-26

**Author**: J2-tn (Oracle backend implementor, sub 1)
**Status**: 🔒 LOCKED — schema hash 上链 broadcast 后 0 改 (= future schema 改必新 v + hash bump + 各 implementor ack)
**Spec**: Oracle v0.3 R7 CLOSE per Bettor-tn r26 + Owner 5/26 "全力推动" 钦定
**Migration**: D 盘 `kasia-console/src/db/migrate.js` v143

## 1. 设计原则

Per Bettor r19 R5 risk #4 schema lock 机制 + J2 #6 ack:
- J2 sub 1 ship → commit lock 文档 + schema hash 广播上链
- 后续 implementor (NWT sub 4 / J2 sub 2/3/5/6 / KANet-UI sub 7/8) 读 schema 跟 hash 对比, 不一致 fail
- schema 改必 backward-compat (= ADD COLUMN 可, DROP/RENAME 必新 hash + 所有 implementor ack 后才 ship)

## 2. Tables

### 2.1 oracle_registry — 注册名单

注册 channel `oracle-registry` ingest + sub 5 query.

```sql
CREATE TABLE oracle_registry (
  relay_node_id  TEXT     PRIMARY KEY,
  pubkey         TEXT     NOT NULL,
  tier           INTEGER  NOT NULL CHECK (tier IN (1, 2, 3)),
  capabilities   TEXT,                                       -- JSON array
  announced_at   TEXT     NOT NULL DEFAULT (datetime('now')),
  expires_at     TEXT,                                       -- 24h TTL per D2
  bond_amount    INTEGER,                                    -- NULL = tier 1/3, >0 = tier 2
  status         TEXT     NOT NULL DEFAULT 'active',         -- active/inactive/slashed
  epoch          INTEGER  NOT NULL DEFAULT 1,                -- v2+, legacy IS NULL via cross-table
  updated_at     TEXT     NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_oracle_registry_tier_status ON oracle_registry(tier, status);
CREATE INDEX idx_oracle_registry_expires     ON oracle_registry(expires_at);
CREATE INDEX idx_oracle_registry_epoch       ON oracle_registry(epoch);
```

#### Tier 设计

| tier | 含义 | bond_amount | slash | governance |
|------|------|-------------|-------|------------|
| 1 | KANet curated (cold start) | NULL | 不适 | exit per Area 10 EC1 |
| 2 | stake-bonded open (permissionless) | > 0 | X% per Area 10 EC2 | bond slash |
| 3 | system rule fallback | NULL | 不适 | rule-based, no LLM |

Phase 0 testnet only: tier 3 system 跑 (= KANet team 可跑符合 5/24 testnet-only thesis)
Phase 1+ mainnet (if deployed): tier 2 主, tier 1 deprecate, tier 3 fallback

### 2.2 oracle_history — 投票 + settle 记录

sub 3 voter v2 写 (= 每 vote / settle + audit_mode 标), sub 5 信誉 query 主 source.

```sql
CREATE TABLE oracle_history (
  id                  TEXT     PRIMARY KEY,
  oracle_relay_id     TEXT     NOT NULL,
  market_id           TEXT     NOT NULL,
  vote                TEXT,                                   -- YES/NO/silent/NULL (consensual)
  consensus_outcome   TEXT,                                   -- final winner per decideConsensus
  reward_amount       REAL     DEFAULT 0,
  slashed_amount      REAL     DEFAULT 0,
  audit_mode          TEXT     NOT NULL,                      -- tier1/tier2/tier3/consensual
  audited_at          TEXT,                                   -- vote timestamp
  settled_at          TEXT,                                   -- market settle timestamp
  epoch               INTEGER  NOT NULL DEFAULT 1,
  created_at          TEXT     NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_oracle_history_oracle_settled ON oracle_history(oracle_relay_id, settled_at);
CREATE INDEX idx_oracle_history_market         ON oracle_history(market_id);
CREATE INDEX idx_oracle_history_epoch          ON oracle_history(epoch);
```

#### audit_mode 设计 (per J2-tn r9 + J1 #2 catch C2)

| audit_mode | scope | reward | vote | 备注 |
|------------|-------|--------|------|------|
| `tier1` | KANet curated oracle 投票 | > 0 一致 / 0 沉默 | YES/NO/silent | sub 3 voter v2 dispute path |
| `tier2` | stake-bonded oracle 投票 | > 0 一致 / 0 沉默 | YES/NO/silent | sub 3 voter v2 dispute path |
| `tier3` | system rule fallback | 0 | YES/NO | rule-based no slash |
| `consensual` | 双方 confirm settle | **0** | **NULL** | settle_consensual path (NWT sub 4), reputation 不漏统计 |

## 3. Epoch field 设计 (per J1 #4 C3/C4 fix)

- legacy v1 chain_events 没 epoch field → `epoch IS NULL` 分流
- v2+ chain_events 都 `epoch >= 1` 写入
- settler dispatch + sub 5 信誉 query 用 `IS NULL` (legacy) vs `IS NOT NULL` (v2) 分流
- 不读 event_type 字符串 → 减少 schema 改名风险
- fail-on-mixed (per J1 catch C3): 同 market 老+新 event 都有 → settler 立 abort

## 4. Schema Hash (= 上链 lock 锁定)

schema_hash = sha256(canonical_schema_text)
canonical_schema_text = 上述 §2 SQL 一字不差 (= 去 comment + normalize whitespace) 后 sha256

J2-tn 计算 + broadcast 上链 dev-coord-testnet 频道, 后续 implementor 必 verify match.

## 5. Cross-sub align

| sub | depend on | 字段 |
|-----|-----------|------|
| sub 2 抽样 | oracle_registry | tier + status='active' + expires_at > now |
| sub 3 voter v2 | oracle_history | write vote + audit_mode + epoch |
| sub 4 SS | (no direct DB) | chain_event consume voter sigs |
| sub 5 信誉 API | oracle_history | aggregate read |
| sub 6 dispute | oracle_registry | sample N oracle via sub 2 |
| sub 7/8 UI | oracle_registry + oracle_history | render |

## 6. Lint rule 联动

`scripts/lint-kanet/check-channel-namespace-mutex.mjs` (per J1 catch 9 + J2 sub 1 ship):
- 守 `COORD_CHANNELS` vs `ORACLE_REGISTRY_CHANNELS` 不重叠
- defense baked 守 future config drift

## 7. v0.3 R7 CLOSE catch chain trace

| catch | spec source | schema impact |
|-------|-------------|---------------|
| NWT r6 settle_consensual entry 缺 | NWT sub 4 SS | oracle_history audit_mode='consensual' row |
| J1 #2 C1 winner-binding | NWT sub 4 SS | (SS only, schema 不涉) |
| J1 #2 C2 oracle_history 0-row consensual | sub 5 | audit_mode + reward/slashed=0 |
| J1 #2 C3+C4 fail-on-mixed + epoch | sub 3 + sub 5 | epoch field IS NULL/NOT NULL 分流 |
| J1 #5 C5 第三方 announce | sub 5 API | tier IN (2,3) + relay_id NOT IN KANET_INTERNAL |
| J2 r8 catch 9 namespace | sub 1 firewall | (chat.js + lint rule, schema 不涉) |
| J2 r8 catch 10 epoch migration | sub 1 schema | epoch DEFAULT 1, legacy IS NULL detect |
| J2 r8 catch 11 entry shape | NWT sub 4 SS | (SS only, schema 不涉) |
| UI r11 consensual button | sub 7 UI | audit_mode='consensual' filter |

## 8. Owner 5/26 "全力推动" + 5 道质量底线

- 底线 2 KI 18+19 sediment: J2 sub 1 pre-ship 5 checklist 全 apply
- 底线 4 defense baked: regression test + lint rule + idempotent ALTER guards + chain_event hash audit
- 底线 5 Owner UAT 终审: schema lock 后 Owner 审 `PRAGMA table_info` 输出

🔒 **LOCKED** post broadcast schema_hash 上链.
