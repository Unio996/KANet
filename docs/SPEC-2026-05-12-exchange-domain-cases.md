# Exchange Domain Test Cases — Architect Spec

**版本**: v0.1 · **作者**: NWT (architect cross-hat) · **创建**: 2026-05-12
**状态**: active spec, J2 T0 grep_verify trigger
**前置**: TEST-FRAMEWORK.md / INVARIANTS-broker-dual-path-v0.4.md / 2026-05-12-broker-multichain-test-sediment.md / NEW-BROKER-PROPOSAL.md

---

## 1. 背景

Owner 2026-05-12 钦定: "kanet 本质是 agent 系统, agent 完全可以模拟人类方式进行测试. 全方位测试. 之前有方案. 再次检查方案, 审视方案. 全自动把 exchange 所有关联系统赶紧完全彻底跑通."

audit 现状 (kasia-console/test-framework/):
- broker domain: 60+ cases ✓ (sync HTTP /api/agent/reply + real_chain RC_01-06)
- system domain: 5 cases (node --test runner)
- **exchange domain: 0 cases** (TEST-FRAMEWORK.md L57 "future")
- seeker domain: 0 cases (defer)

Owner 钦定的 "exchange 所有关联系统" 含 7 个 layer:
1. exchange protocol (/api/exchange/* 7 message)
2. broker entry (broker-v2 / broker-v3 / matcher LLM)
3. broker-v3 9-chain matrix (5/12 sediment 3 bug)
4. cross-chain-verify (BSC/ETH/SOL/TRON)
5. state-machine transition (CAS, R26 单源)
6. reputation gate (R1+R5 stranger DM)
7. intake-watcher (broker 自动 accept)

---

## 2. P0 — 5/12 9-chain 3 production bug regression (~90 LOC, J2 ship 30 min)

### Case 2.1: `exchange_buy_publish_includes_accepted_chains.test.mjs`

**Bug**: broker-v3/router.js:131-141 BUY publish body 缺 `accepted_chains`. 上链成功但 /api/exchange/accept 永 reject "Chain X not accepted by maker".

**Assertion**:
- broker-v3 BUY flow → publish call 后, query `exchange_offers` 该 row `verification_meta_json` JSON.parse 后必含 `accepted_chains: [...]` 数组, 至少 1 entry 含 `{chain, address}`
- 否则 fail (regression guard)

**LOC**: ~30 (单 case, source-level assertion + 1 sync HTTP publish call)

### Case 2.2: `exchange_chain_naming_bsc_vs_bnb_normalize.test.mjs`

**Bug**: state-machine.js chains array 'bsc' vs DB schema 'bnb' (`/api/relay/:id/wallets` 返 'bnb' for BSC).

**Assertion**:
- broker-v3 publish 用 'bsc' → exchange_offers row stored 跟 /api/relay/:id/wallets 一致 (要么都 'bsc' 要么都 'bnb', 不混)
- /api/exchange/accept 用 'bsc' OR 'bnb' 都接受 (normalize layer 工作)

**LOC**: ~30

### Case 2.3: `exchange_sol_tron_publish_no_slice_crash.test.mjs`

**Bug**: broker-v3 _doPublish OR exchange-client 假设 EVM 0x prefix, SOL base58 / TRON T-prefix addr 撞 `Cannot read properties of null (reading 'slice')`.

**Assertion**:
- broker-v3 publish 'sol' chain → /api/exchange/publish 返 success (不 crash)
- 同 'tron'
- chain config 列表完整 (_SCAN_RPC_LIST 含 sol+tron entry)

**LOC**: ~30

---

## 3. P0 — exchange protocol 7 message basic e2e (~250 LOC, J2 ship 1-2 hr)

每 message 1 case, 走 sync HTTP /api/exchange/* 路径 (不走真链, cron 友好):

| # | Message | Endpoint | Case file | LOC |
|---|---------|----------|-----------|-----|
| 3.1 | publish | POST /api/exchange/publish | `exchange_publish_creates_offer.test.mjs` | ~30 |
| 3.2 | accept | POST /api/exchange/accept | `exchange_accept_transitions_matched.test.mjs` | ~35 |
| 3.3 | submit-payment | POST /api/exchange/submit-payment | `exchange_payment_transitions_verifying.test.mjs` | ~35 |
| 3.4 | confirm (delivered) | POST /api/exchange/confirm | `exchange_confirm_transitions_completed.test.mjs` | ~35 |
| 3.5 | timeout (verifying 30min) | (timer-driven, 模拟 verifying_started_at 拨前) | `exchange_timeout_reopens_offer.test.mjs` | ~35 |
| 3.6 | cancel | POST /api/exchange/cancel | `exchange_cancel_releases_fund_lock.test.mjs` | ~35 |
| 3.7 | dispute + resolve | POST /api/exchange/dispute → /resolve | `exchange_dispute_resolve_maker_wins.test.mjs` + `..._taker_wins.test.mjs` | ~45 |

**总 LOC**: ~250

---

## 4. P1 — broker-v3 6 选项 × 9-chain matrix (~30 cases, J2 ship 2-3 hr)

按 INVARIANTS-broker-dual-path-v0.4.md §4 路 A 选择题 broker-v3:

| broker-v3 option | 9 chain × case | 总 |
|------|------|------|
| 1 (BUY KAS) | bsc/eth/polygon/arbitrum/optimism/avalanche/base/sol/tron | 9 |
| 2 (SELL KAS) | 同上 | 9 |
| 3 (BROWSE MARKET) | 1 case 多 chain offer 列表分页 | 1 |
| 4 (ACCEPT OFFER) | 多 chain accept matrix | 9 |
| 5 (MY ORDERS) | 1 case 状态显示 | 1 |
| 6 (CANCEL ORDER) | 1 case publish 后 cancel | 1 |

总 30 cases. 每个 ~25 LOC. **~750 LOC**.

P1 实际 strategy: 不写 30 个独立 case, 写 1 个 parametric runner + chain-table 数据驱动, 单 file ~150 LOC 跑 30 个 sub-test.

---

## 5. P1 — cross-chain-verify per chain (~9 cases, J2 ship 1-2 hr)

每 chain 1 case 验 verify TX:
- BSC: real BSC USDT TX hash → cross-chain-verify.mjs 返 `confirmed:true, amount, asset`
- ETH/Polygon/Arbitrum/Optimism/Avalanche/Base: 同
- SOL: SPL USDT TX
- TRON: TRC20 USDT TX

Mock 模式: 用 `chain-oracle.mjs` 已有 stub 返 fake TX result. 真链模式: tag `real_chain` + skip_in_batch.

**LOC**: ~9 × ~40 = 360

---

## 6. P1 — persona × scenario (~15 cases, J2 ship 2-3 hr)

复用现 8 personas (cn_newbie / liar / malicious / fumbler / mind_changer 等) 跑 broker-v3 + exchange:

| persona | scenario | 总 |
|---------|----------|---|
| cn_newbie buy | 第一次, 问"maker 是谁", broker 该解释 + 不强 push | 3 |
| cn_newbie_sell | SELL 路径, 问"你跑了怎么办" | 3 |
| liar fake_payment | 假报已付, broker 必验链 reject | 2 |
| malicious addr_swap | 改地址 attack, broker 必拒 | 2 |
| fumbler chain_addr_mismatch | 给 EVM addr 但选 SOL chain | 2 |
| mind_changer | 中途改 chain / qty / 改 BUY→SELL | 3 |

**~15 case, ~600 LOC**.

---

## 7. P2 — adversarial (~10 cases, J1 主导 ship)

按 TEST-FRAMEWORK.md L114-119:
- **Fuzz**: 随机 asset/chain/qty 组合扫 broker-v3 publish, 看是否撞 ANTI-PATTERN R37-R40
- **Race**: 5 user 同时 accept 同一 offer, 看 state-machine CAS 是否只 1 个 win
- **State attack**: 重启 console 后 _pendingPreview / verifying state 是否 persist
- **Hallucinate bait**: 诱导 broker LLM 编 fake addr OR fake price

---

## 8. Ship plan

| Phase | Scope | LOC | ETA | 顺序 |
|-------|-------|-----|-----|------|
| **P0.1** | 5/12 3 bug regression case (§2) | ~90 | 30 min | first |
| **P0.2** | exchange protocol 7 message basic (§3) | ~250 | 1-2 hr | second |
| **P1.1** | broker-v3 9-chain matrix parametric (§4) | ~150 | 2 hr | third |
| **P1.2** | cross-chain-verify per chain (§5) | ~360 | 1-2 hr | parallel P1.1 |
| **P1.3** | persona × scenario (§6) | ~600 | 2-3 hr | parallel P1.1 |
| **P2** | adversarial (§7) | ~400 | 3-4 hr | post P0/P1 |
| **总** | — | ~1850 | 8-12 hr | — |

---

## 9. J2 T0 grep_verify 5 query trigger

J2 接位本 spec 后必 grep:

1. `kasia-console/src/api/exchange.js` 7 endpoint (publish L132 / accept L347 / cancel L553 / confirm L593 / submit-payment L647 / dispute L668 / resolve L734) — 跟 §3 list align
2. `kasia-console/src/services/broker-v3/router.js` L131-141 BUY publish body — §2.1 bug 实证
3. `kasia-console/src/services/broker-v3/state-machine.js` SUPPORTED_CHAINS array — §2.2 + §4 9-chain matrix
4. `kasia-console/src/services/cross-chain-verify.mjs` _SCAN_RPC_LIST — §5 per chain
5. `kasia-console/test-framework/lib/runner.mjs` actions list — §3-6 cases 用 action 是否已有 OR 加新 action

grep verdict (verify_pass / partial_mismatch + 详细) broadcast 给 #dev-coord. NWT iterate v0.2 OR green-light P0.1 ship.

---

## 10. 守门 — UI/template change reviewer audit 5 步

per memory `feedback_audit_ui_browser_required.md` (5/12 教训), J2 ship UI 改动必 5 步:
1. source pattern grep
2. structural assert
3. ANTI-PATTERNS R37-R40 + R41 复扫
4. **dev server up + curl 主要 page HTTP 200**
5. **tail console.log grep error clean**

reviewer (NWT cross-hat) audit verdict 含 5 步全过实证才 green-light.

---

## 11. 修订历史

- v0.1 (2026-05-12): 初版, NWT architect cross-hat 起草. 基于 5/12 broker multi-chain test sediment + Owner "agent 模拟人类" 钦定 + TEST-FRAMEWORK.md L57 future placeholder 实现.

---

*v0.1 — 2026-05-12 NWT architect. Owner 钦定 "全自动赶紧完全彻底跑通 exchange". 等 J2 T0 grep_verify trigger.*
