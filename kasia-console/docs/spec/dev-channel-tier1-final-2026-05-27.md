# KANet Dev Channel Tier 1 — NWT Synthesize Final Spec (2026-05-27)

**Status**: 🟢 ~50% SHIPPED (2026-05-28 update by KANet-UI) — UI + DB + read API live, 缺 faucet wire + admin + content
**Source**: task md original (5/26) + 9 adversarial 真挑 sediment (5/27 NWT r55+r56 + J2 r50 + UI r42)
**Principle**: 复用 85% / 新建 15% (= Owner 钦定 reuse 现有 module)
**ETA**: 原 2-3 工作日 → 实际 Tier 1 核心 1 天 ship (= agent-first MVP pivot 后 KANet-UI 5/27 夜 + 5/28)

> **2026-05-28 SHIP STATUS UPDATE (KANet-UI)** — 本 spec 是 NWT 原 propose。实际 ship 经历 Owner 5/27 critique pivot ("Tier 1 太人类视角" → agent-first MVP) + Tier 2.1 tunnel 扩展 + Tier 2.2 N-way propose。当前 ship 真相见本文档末尾 **§9 SHIP STATUS (2026-05-28)**。

---

## 1. 复用现有 module (= 85%, 不 rewrite)

| 现有 | 用作 | Tier 1 改动 |
|---|---|---|
| `chat-v3.eta` | UI base | polish only, derive `public-channel.eta` |
| `chat.js` API | API base | 加 1 公开 endpoint (= 不动现有) |
| `anti-spam.js` | rate limit | 启用 public-facing config |
| `kanet-ui.js` | helpers (formatTime/shortAddr) | 直接复用 |
| `broadcast_messages` table | 数据 | 加 1 column (visibility) |
| `relay-manager.js` | spawn relay | 复用 spawn FaucetRelay-tn |
| `migrate.js` | DB schema | 加 v145 migration |
| design system (page-open/page-close partial) | UI shell | 直接继承 |

## 2. 新建 (= 15%, 真 minimum)

### A. DB schema (= migrate.js v145)
```sql
-- visibility flag (= default internal, J2 真挑 #1 sediment)
ALTER TABLE broadcast_messages ADD COLUMN visibility TEXT
  DEFAULT 'internal' CHECK (visibility IN ('internal', 'public'));

-- faucet rate-limit table
CREATE TABLE faucet_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_address TEXT NOT NULL,
  wallet_address TEXT NOT NULL UNIQUE,
  granted_at INTEGER NOT NULL,
  amount_sompi INTEGER NOT NULL,
  txid TEXT
);
CREATE INDEX idx_faucet_grants_ip_time ON faucet_grants(ip_address, granted_at);

-- chain_events public flag (= J2 真挑 #1 reply_to_txid 引用 leak 防)
ALTER TABLE chain_events ADD COLUMN is_public INTEGER DEFAULT 0;
```

### B. New UI templates (= 2 files)
- `src/ui/public-channel.eta` (~100 LOC, clone chat-v3.eta minus write features)
- `src/ui/welcome-dev.eta` (~50 LOC + placeholder content)

### C. New API endpoints (= add to chat.js + faucet.js)
- `GET /api/public/channel/:name/messages` (= filter visibility=public + chain_events.is_public)
- `POST /api/faucet/request` (= IP + addr rate limit + FaucetRelay-tn transfer)
- `POST /api/admin/broadcast/:txid/visibility` (= env-config admin pubkey gate, 简化 admin)

### D. New scripts
- `scripts/audit-track-a-keywords.mjs` (= scan broadcast_messages + chain_events, mark visibility=internal if match keyword list)
- `docs/track-a-keyword-blocklist.md` (= 关键词维护 + lint rule scan)

### E. New relay (= 独立 FaucetRelay-tn)
- 独立 relay_node_id + 新 mnemonic (= 不 复用 NWT/Bettor 任何 agent key)
- spawn 通过 `/api/relay/:id/restart` (= relay-manager.js 复用)
- Owner 手动 transfer testnet KAS 充值 (= 100M sompi for 1000 grants)

---

## 3. 9 真挑 final decision (= Owner ack pending)

| # | 真挑 | NWT propose verdict |
|---|---|---|
| NWT-1 | visibility flag → separate table | ✓ accept (= visibility column + 真 separate view) |
| NWT-2 | faucet grant 100k 太小 | ✓ accept 调 1,000,000 sompi (= 1 grant ≈ 1000 chat msg) |
| NWT-3 | anti-spam 30min 5 dev-hostile | ✓ accept relax: 30min 20 + 新地址 24h 3 条 grace |
| NWT-4 | disclaimer 3 处冗余 | ✓ accept sticky banner + API header (= meta tag separate from disclaimer) |
| NWT-architectural | Tier 1 read-only 不 differentiate | ⚠ defer Tier 2 (= 一键 relay docker script Tier 2 candidate) |
| J2-1 | chain_events isolation | ✓ accept chain_events.is_public column + public API JOIN |
| J2-2 | faucet relay identity 独立 | ✓ accept 新 FaucetRelay-tn + 独立 mnemonic |
| J2-3 | admin authority model | ✓ accept env-config admin pubkey 简化 (= Tier 2 升级 multisig) |
| J2-4 | threading leak | ✓ accept all-public-or-hidden (= 不 mixed visibility thread) |
| J2-5 | keyword list 不全 | ✓ accept separate blocklist file + lint rule + audit script |
| J2-architectural | /public/agent + /public/trade | ⚠ defer Tier 2 (= Trust Stack demo 加 Tier 2 sub-scope) |

= 9 真挑 全 accept + 2 architectural defer Tier 2.

---

## 4. ETA realistic (= KANet-UI focused single dev)

| 件 | 实施 ETA |
|---|---|
| migrate.js v145 (= visibility + faucet_grants + chain_events.is_public) | 30 min |
| public-channel.eta template (= polish chat-v3) | 2 h |
| welcome-dev.eta + placeholders | 30 min |
| GET /api/public/channel/:name/messages + filter | 1 h |
| faucet_grants + POST /api/faucet/request + FaucetRelay-tn spawn | 2 h |
| disclaimer sticky banner + API header + meta tag | 30 min |
| admin role + POST /api/admin/visibility/:txid (env-config 简化) | 1 h |
| Track A keyword audit script + bulk mark internal | 30 min |
| anti-spam public config relax + reputation grace | 30 min |
| seed messages 10 条草稿 (= Owner content fill) | 30 min |
| testing + cross-impl audit (NWT + J2) | 2 h |
| Owner UAT + content fill iteration | half day |

**总**: ~11-13 hour pure dev + 0.5 day UAT iteration

**ETA breakdown**:
- **最快 2 工作日** = KANet-UI focused single dev, Owner ack 现 spec, 0 blocker, content placeholder OK
- **realistic 3-5 工作日** = adversarial Round 3+ iteration + Bettor architect sync + Owner content fill cycle
- **保守 1 周** = 含 launch coordination + 5-Layer thesis 同时发布 timing

---

## 5. Tier 1 ship signal (= Owner UAT 通过条件)

- ✓ 公开 URL 可访问 (= 4 URL: `/public/channel/kanet-general` + `/public/channel/kanet-spec` + `/welcome-dev` + `/faucet`)
- ✓ Owner 钦定 10 seed messages 已发 + 标 visibility=public
- ✓ Owner 手动 spot-check 公开 URL 无 Track A 内容泄露
- ✓ Faucet 充值 100M sompi + active rate-limited
- ✓ Disclaimer 全覆盖 (= sticky banner + API header)
- ✓ Track A keyword audit clean (= 0 keyword 漏 hit)

---

## 6. Tier 2/3 backlog (= 后续 cycle)

**Tier 2** (= Week 2-3 if Tier 1 successful):
- wallet connect (Kasia integration)
- Web 端发消息 (= POST /api/public/channel/:name/send)
- message reactions (👍 / ❤️)
- @mention notification
- `/public/agent/:relay_id` (= L1+L3 identity card per J2 architectural concern)
- ack-before-post (= 真 legal disclaimer force)

**Tier 3** (= Week 4+):
- 一键 relay docker installer (= NWT architectural concern 真 demo "用 Kaspa 协调")
- `/public/trade/:offer_id` (= L2 SS audit trail per J2 architectural concern)
- Agent SDK
- 跨 deployer reputation portability

---

## 7. 真 final ETA Owner 拍

如果 Owner 现立 ack 此 spec + KANet-UI focused single dev:
- **最快 ship-ready 2 工作日** (= ~16 hour dev)
- **Owner UAT pass 后 launch coordination 1-2 day**
- **公开 URL live 总 ETA: 3-4 工作日 from Owner ack**

如果 Owner 想 Tier 1 += /public/agent + /public/trade (= J2 architectural):
- Tier 1+ scope expand
- ETA 加 2-3 工作日 = **总 5-7 工作日**

如果 Owner 想 Tier 1 += 一键 relay docker (= NWT architectural):
- 需 跨 platform (Win/Mac/Linux) docker build
- 加 1 工作日 = **总 4-5 工作日**

---

## 8. NWT 视角真诚 surface

- **真大头工作 = content fill** (= Owner 写 10 seed messages 正文 + welcome-dev 最终文案), 不是 code
- **真不确定性** = Owner ack iteration cycle 长 (= adversarial round 已 2-3 round, 历史模式 易 round 4-5)
- **真捷径** = Owner 立 ack 此 spec 不再 round, KANet-UI 立 fire ship 2 day. 不立 ack → 真模糊
- **复用率 85%** 真兑现 = 不另起 chat 系统, 不 rewrite UI, 不另新 anti-spam impl. 只加 minimum filter layer + 1 faucet API + 1 admin endpoint + 2 UI 模板 polish

— NWT-tn (Dev Channel Tier 1 最终方案 propose, ask Owner ack)

---

# §9 SHIP STATUS (2026-05-28 update by KANet-UI)

NWT 原 propose (上文) 是 5/27 设计。实际 ship 经历 Owner critique pivot + Tier 2.1/2.2 扩展。本节是 ship 真相。

## 9.1 Tier 1 ship 进度

| spec 项 | spec § | ship 状态 | commit / 位置 |
|---|---|---|---|
| v145 migration (visibility + faucet_grants) | 2.A | 🟢 ship | migrate.js v145 |
| broadcast_messages.visibility col | 2.A | 🟢 ship (default internal) | - |
| chain_events.is_public col | 2.A | 🔴 未 ship (= migrate 0 ref) | - |
| public-channel.eta UI | 2.B | 🟢 ship 11KB | src/ui/public-channel.eta |
| welcome-dev.eta UI | 2.B | 🟢 ship 14KB | src/ui/welcome-dev.eta |
| GET /api/public/channel/:name/messages | 2.C | 🟢 ship (filter visibility=public) | chat.js L440 |
| POST /api/faucet/request | 2.C | 🟡 endpoint ship, 但无 FaucetRelay = 不能发 | chat.js L503 |
| POST /api/admin/visibility/:txid | 2.C | 🔴 未 ship | - |
| GET /faucet UI 页 | 5 | 🔴 404 (= route missing) | - |
| FaucetRelay-tn 独立 relay | 2.E | 🔴 未 spawn (= 0 row relay_nodes) | - |
| audit-track-a-keywords.mjs | 2.D | 🔴 未建 | - |
| track-a-keyword-blocklist.md | 2.D | 🔴 未建 | - |
| anti-spam public_facing config | 4 | 🔴 未建 | - |
| 10 seed messages | 5 | 🔴 0 公开 (= 仅 1 hello-agent test) | - |

**Tier 1 ship ~50%**: 核心 read path (UI + DB + public API) 全 live, 缺 write/admin/faucet wire + content。

## 9.2 agent-first MVP (= Owner 5/27 critique pivot 后新增, NWT 原 spec 没有)

Owner 5/27 20:55 critique: "Tier 1 太人类视角, 不智能体视角"。KANet-UI pivot 加 4 层 agent-first:

| 层 | 文件 | 状态 |
|---|---|---|
| L1 spec | docs/spec (本目录) | 🟢 |
| L2 machine API | src/api/dev-channel-v1.js (/api/v1/*) | 🟢 ship |
| L3 SDK | sdk/dev-channel-sdk.js | 🟢 ship |
| L4 example | examples/hello-agent.js | 🟢 ship + demo PASS |

## 9.3 Tier 2.1 pair tunnel (= ship 100%, NWT 原 spec 没有)

详 `dev-channel-tier2-tunnel-propose-2026-05-28.md` + KB `infrastructure/14-pair-tunnel.md`。
- chain handshake (pair_invite/pair_ack) + STUN + UDP hole punch + ed25519 frame + peer-coord API + pair-ingestor
- 真链 e2e verified (= 6 commits)

## 9.4 Tier 2.2 N-way group (= propose v2, 待 implement)

详 `dev-channel-tier2-2-nway-group-propose-2026-05-28.md`。
- Owner architect review 抓 3 炸弹 (mesh fallback / forming timeout / threshold 拆) 已 fix v2
- 等 NWT/Bettor/J1 二轮 review + Owner final ack → implement (~10h)

## 9.5 Owner 钦定 sediment

- **永久并存** (2026-05-28): dev-coord-testnet (内部 Track A) + kanet-* (公开 Track B) 不替换/不迁移。详 KB products/09 §0bis + memory project_dev_channel_dual_track_5_28
- **visibility 默认 internal** (= Track A 保护), POST /api/v1/messages 默认值仍待 Owner 钦定 (a public / b envelope字段 / c publish endpoint)

## 9.6 Summary System (= Owner 观察工具, 5/28 加)

- L1 milestone notifier (Monitor bgj5q1gl7 live, 已 fire 14+ 次)
- L2 daily digest cron (= D:/KANet-Knowledge-Base/digests/)
- 详 scripts/dev-coord-milestone-notifier.mjs + scripts/digest-daily.mjs

## 9.7 剩余 Tier 1 缺件 ship plan (= 2026-05-28 全力推动)

| 件 | ETA | owner |
|---|---|---|
| /faucet UI 路由 + faucet.eta | 1h | KANet-UI |
| FaucetRelay-tn spawn (新 mnemonic) + Owner 充值 | 1h + Owner | KANet-UI + Owner |
| POST /api/admin/visibility/:txid (env pubkey gate) | 1h | KANet-UI |
| audit-track-a-keywords.mjs + blocklist.md | 1h | KANet-UI |
| chain_events.is_public col (v149) | 30min | KANet-UI |
| 10 seed messages (= Owner content) | - | Owner |

— KANet-UI (§9 ship status update, 2026-05-28 全力推动 cycle)
