# Exchange Domain Test Cases — Architect Spec

**版本**: v0.2 · **作者**: NWT (architect cross-hat) · **创建**: 2026-05-12 (v0.1 18:06) · **iterate**: 2026-05-12 (v0.2 18:35)
**状态**: active spec, J2 P0.1 ship complete (commit 15f1176b6, NWT reviewer PASS green-light), v0.2 含 J2 #314/#315/#316 反馈整合
**前置**: TEST-FRAMEWORK.md / INVARIANTS-broker-dual-path-v0.4.md / 2026-05-12-broker-multichain-test-sediment.md / NEW-BROKER-PROPOSAL.md

---

## 1. 背景

Owner 2026-05-12 钦定: "kanet 本质是 agent 系统, agent 完全可以模拟人类方式进行测试. 全方位测试. 之前有方案. 再次检查方案, 审视方案. 全自动把 exchange 所有关联系统赶紧完全彻底跑通."

audit 现状 (kasia-console/test-framework/, post P0.1 ship):
- broker domain: 60+ cases ✓ (sync HTTP /api/agent/reply + real_chain RC_01-06)
- system domain: 5 cases (node --test runner)
- **exchange domain: 3 cases (P0.1 ship by J2 commit 15f1176b6)** ← was 0
- seeker domain: 0 cases (defer)

Owner 钦定的 "exchange 所有关联系统" 含 7 个 layer:
1. exchange protocol (/api/exchange/* 7 message)
2. broker entry (broker-v2 / broker-v3 / matcher LLM)
3. broker-v3 9-chain matrix (5/12 sediment 3 bug, P0.1 已 guard)
4. cross-chain-verify (5 chain implemented: bnb/eth/polygon/sol/tron; 4 EVM arb/op/avax/base verify 缺)
5. state-machine transition (CAS, R26 单源)
6. reputation gate (R1+R5 stranger DM)
7. intake-watcher (broker 自动 accept)

---

## 2. P0.1 — 5/12 9-chain 3 production bug regression (~119 LOC) — **SHIPPED**

✓ J2 commit `15f1176b6` ship complete (30 min, NWT γ green-light 后), NWT reviewer commit `8c4124f5` PASS green-light.

### Case 2.1: `exchange_buy_publish_includes_accepted_chains.test.mjs` (37 LOC, 2/3 PASS + 1 FAIL marker)

**Bug**: broker-v3/router.js BUY publish body 缺 `accepted_chains`. FAIL marker 等 production fix.

### Case 2.2: `exchange_chain_naming_bsc_vs_bnb_normalize.test.mjs` (44 LOC, 0/2 PASS + 2 FAIL marker)

**Bug**: state-machine 'bsc' vs _SCAN_RPC_LIST 'bnb' naming mismatch + api/exchange.js 缺 normalize. FAIL marker 等 production fix.

### Case 2.3: `exchange_sol_tron_publish_no_slice_crash.test.mjs` (38 LOC, 3/3 PASS)

✓ NWT #69 静态结构 sediment (state-machine.js SOL_ADDR_REGEX + TRON_ADDR_REGEX + _validateAddr dispatch). regression guard 守不退化.

### Production code fix (待 J2 ship, post v0.2):
- §2.1 fix: broker-v3/router.js L131-141 BUY body 加 `accepted_chains: [{chain, address: broker_chain_wallet}]`
- §2.2 fix: 加 normalize layer (e.g. `chainKey(s) => s === 'bnb' ? 'bsc' : s`) 在 api/exchange.js publish/accept handler 双 alias accept
- §2.3 already fixed (NWT #69)

---

## 3. P0.2 — exchange protocol 7 message basic e2e (~250 LOC, J2 ship 1-2 hr)

每 message 1 case, 走 sync HTTP /api/exchange/* 路径.

**precondition (v0.2 加)**: `lib/runner.mjs` 加 generic `http_post` action (~20 LOC) 让 case 直 curl /api/exchange/* 不绕 broker DM. (J2 #315 grep_verify Q5 verdict, 5 query partial_mismatch fix.)

```js
// lib/runner.mjs 加 action (J2 ship in v0.2 §3 precondition step)
async function http_post({ url, body, expect_status = 200, timeout_ms = 5000 }) {
  const r = await fetch(url, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout_ms) });
  return { status: r.status, body: await r.json() };
}
```

| # | Message | Endpoint | Case file | LOC |
|---|---------|----------|-----------|-----|
| 3.1 | publish | POST /api/exchange/publish | `exchange_publish_creates_offer.test.mjs` | ~30 |
| 3.2 | accept | POST /api/exchange/accept | `exchange_accept_transitions_matched.test.mjs` | ~35 |
| 3.3 | submit-payment | POST /api/exchange/submit-payment | `exchange_payment_transitions_verifying.test.mjs` | ~35 |
| 3.4 | confirm (delivered) | POST /api/exchange/confirm | `exchange_confirm_transitions_completed.test.mjs` | ~35 |
| 3.5 | timeout (verifying 30min) | (timer-driven, 模拟 verifying_started_at 拨前) | `exchange_timeout_reopens_offer.test.mjs` | ~35 |
| 3.6 | cancel | POST /api/exchange/cancel | `exchange_cancel_releases_fund_lock.test.mjs` | ~35 |
| 3.7 | dispute + resolve | POST /api/exchange/dispute → /resolve | `exchange_dispute_resolve_maker_wins.test.mjs` + `..._taker_wins.test.mjs` | ~45 |

**总 LOC**: ~250 + ~20 http_post action = ~270

---

## 4. P1 — broker-v3 6 选项 × 9-chain matrix (~150 LOC parametric runner, J2 ship 2 hr)

按 INVARIANTS-broker-dual-path-v0.4.md §4 路 A 选择题:

1 parametric runner + chain-table 数据驱动, 单 file ~150 LOC 跑 30 sub-test:
- BUY × 9 chain
- SELL × 9 chain
- BROWSE / ACCEPT / MY_ORDERS / CANCEL × 各 1 (state-machine flow)

---

## 5. P1 — cross-chain-verify per chain (**v0.2 scope-cut 5 chain**, ~200 LOC, J2 ship 1 hr)

**v0.2 修订** (J2 #315 grep_verify Q4 partial_mismatch): 现 `_SCAN_RPC_LIST` 只 cover 3 EVM (bnb/eth/polygon) + 2 非 EVM (sol/tron dispatch). 4 EVM (arb/op/avax/base) verify 死路 (publish OK 但 verify 'chain X not supported for scanRecentTransfers').

scope-cut 决策:
- **5 chain (bnb/eth/polygon/sol/tron) ship case** ← v0.2
- **4 chain (arb/op/avax/base) defer** — production code 改 cross-chain-verify.mjs L113 加 4 chain RPC entry (~10 LOC), 是 production fix 不是 test ship, 独立 architect task

每 chain 1 case:
- bnb: BSC USDT TX → cross-chain-verify.mjs 返 `confirmed:true, amount, asset`
- eth/polygon: 同
- sol: SPL USDT TX (dispatch _verifySolana path)
- tron: TRC20 USDT TX (dispatch _verifyTron path)

Mock 模式 (cron 友好): chain-oracle.mjs 已有 stub 返 fake TX result.
真链模式: tag `real_chain` + skip_in_batch.

**LOC**: 5 × ~40 = 200

---

## 6. P1 — persona × scenario (~600 LOC, J2 ship 2-3 hr)

复用现 8 personas (cn_newbie / cn_newbie_sell / en_neat / liar / fumbler / malicious / mind_changer / cn_real_human) 跑 broker-v3 + exchange:

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

## 7. P2 — adversarial (~400 LOC, J1 主导 ship)

按 TEST-FRAMEWORK.md L114-119:
- **Fuzz**: 随机 asset/chain/qty 组合扫 broker-v3 publish, 看是否撞 ANTI-PATTERN R37-R41
- **Race**: 5 user 同时 accept 同一 offer, 看 state-machine CAS 是否只 1 个 win
- **State attack**: 重启 console 后 _pendingPreview / verifying state 是否 persist
- **Hallucinate bait**: 诱导 broker LLM 编 fake addr OR fake price

需 3 个新 action (~80 LOC framework lib/runner.mjs):
- `fuzz_random` (random param generator)
- `race_parallel` (并发 N caller)
- `state_persist_check` (重启前 / 后 state 对比)

---

## 8. Ship plan (v0.2 修订)

| Phase | Scope | LOC | ETA | 状态 |
|-------|-------|-----|-----|------|
| **P0.1** | 5/12 3 bug regression (§2) | ~119 | 30 min | ✓ SHIPPED commit 15f1176b6 |
| **P0.2** | exchange protocol 7 message basic (§3) + http_post action precondition | ~270 | 1-2 hr | NEXT (post v0.2 commit) |
| **P0.3** | dead template fix (§10) — J2 #314 #8 propose, 合并 P0.2 ship | ~30 | included in P0.2 | NEXT |
| **P1.1** | broker-v3 9-chain matrix parametric (§4) | ~150 | 2 hr | post P0.2 |
| **P1.2** | cross-chain-verify 5 chain (§5, scope-cut) | ~200 | 1 hr | parallel P1.1 |
| **P1.3** | persona × scenario (§6) | ~600 | 2-3 hr | parallel P1.1 |
| **P2** | adversarial (§7) + 3 actions | ~400 | 3-4 hr | post P0/P1 |
| **production code fix (out of spec scope)** | §2.1 broker-v3 BUY + §2.2 chain normalize + §5 4 EVM verify | ~50 | 1 hr | independent architect task |
| **总 (test spec)** | — | ~1769 | 8-12 hr | — |

---

## 9. J2 T0 grep_verify 5 query trigger (v0.1, 已 J2 ack pass with 2 partial_mismatch)

J2 #315 verdict integrated into v0.2 §5 scope-cut + §3 http_post action precondition. v0.2 不需要 J2 再 grep_verify (除非 §10/§11/§12 修法本身需要新 verify).

---

## 10. Dead template fix (J2 #314 #8 propose, **v0.2 加**)

J2 self-report (5/12 #314): commit a8825b0c4 sub #5 把 "Relay 子进程 RPC 状态" per-relay section 加到 `settings.eta`, 但 `/settings → /relays` redirect (index.js:339), settings.eta 整 template 是 dead code (0 route 渲染). 该 section 跟着死.

修法 (J2 ship in P0.2 cycle):
1. mv per-relay state section: `settings.eta L254-285` → `relays.eta` (插入 Node Configuration block 后)
2. 删 settings.eta 我加的 section (回滚到 template 原状态)
3. update test #7 `cases/system/relay-child-rpc-state-vs-console.test.mjs` L60+ assert relays.eta 而非 settings.eta

**LOC**: ~30. 合并 P0.2 ship.

---

## 11. Framework runner 集成 path (v0.2 钦定)

P0.1 现状: J2 用 `node --test` 单跑 (跟 cases/system/ 同款), `scripts/test.mjs` SKIP (无 default export).

**v0.2 钦定**: P0.2+ ship rewrite runner-format, 走 `scripts/test.mjs --domain=exchange` 跟 broker domain 同样 cron-friendly. http_post action precondition (§3) 满足后, runner-format e2e cases 可以编排.

P0.1 3 case retroactive rewrite: defer (P0.2+ ship 后, 看 runner-format ergonomics 决定是否 rewrite P0.1).

**长期 invariant**: exchange domain cases 默认 runner-format (走 framework runner), 仅 source-level structural assertion 用 node --test (跟 cases/system/ 同).

---

## 12. Sediment 教训 sub-section (v0.2 加, 5/12 cycle 失误)

5/12 cycle 内 NWT/J2 多个失误, 永久 sediment 守门 (memory + ANTI-PATTERNS + 本 spec):

1. **Monitor pattern 第 3 次复刻** — NWT 漏 J2 #308-#313 (RPC events grep) → 漏 Bettor r54 (没 re-arm) → 漏 J2 #314 #315 (baseline silently swallow). 修法: memory `feedback_monitor_must_persist.md` (待 ship) + scripts/_nwt_devcoord_monitor.mjs baseline 改 print last 10.

2. **Reviewer audit browser 实测漏** — NWT 5 dimension PASS 没 dev server up + curl HTTP 200, eta `<%# %>` hijack 全栈 500 broken 40+ min. 修法: memory `feedback_audit_ui_browser_required.md` ✓ + ANTI-PATTERNS R41 ✓ + 本 spec §13 audit 5 步永久加.

3. **destructive action 误 kill kaspad** — NWT Get-NetTCPConnection 只看第一返回值, kill 错 PID. 修法: 待 ANTI-PATTERNS R42 (destructive Stop-Process 前必 Win32_Process CommandLine 实证).

4. **R40 ship≠sealed 复刻** — NWT premature green-light J2 7 commits 不 browser 实测. 修法: 跟 §13 同 (browser 实测 永久加进 ship checklist).

5. **broadcast dedup / WS error 重复** — multiple retry 撞 dedup. 修法: broadcast script template 加 timestamp prefix (避 dedup) + WS error catch retry 自动.

---

## 13. 守门 — UI/template change reviewer audit 5 步 (永久加)

per memory `feedback_audit_ui_browser_required.md` (5/12 教训), J2 ship UI 改动必 5 步:
1. source pattern grep
2. structural assert
3. ANTI-PATTERNS R37-R41 复扫
4. **dev server up + curl 主要 page HTTP 200** (至少 5 个: /chat /relays /predictions /trading /market /settings(or redirect target))
5. **tail console.log grep error clean** (tail -200 logs/console.log | grep -E "ERROR|Bad template|TypeError|SyntaxError" 0 hit + fresh timestamp)

J2 #316 P0.1 ship explicit said "本 commit pure node --test 不 render template, browser 实测 N/A" — 严守 5/12 教训 (CLAUDE.md "如果不能测 UI 必 explicit 说"). NWT reviewer PASS confirm 此 explicit ack 合规.

---

## 14. 修订历史

- **v0.1 (2026-05-12 18:06)**: 初版, NWT architect cross-hat 起草, J2 T0 grep_verify trigger. commit ea519032a.
- **v0.2 (2026-05-12 18:35)**: J2 #314 #315 #316 反馈整合:
  - §2 标记 P0.1 SHIPPED (commit 15f1176b6, NWT reviewer PASS 8c4124f5)
  - §3 加 http_post action precondition (J2 #315 Q5 partial_mismatch fix)
  - §5 scope-cut 5 chain (J2 #315 Q4 partial_mismatch fix; 4 EVM defer 独立 architect task)
  - §10 dead template fix (J2 #314 #8 propose, 合并 P0.2 ship)
  - §11 framework runner 集成 path 钦定 (P0.2+ rewrite runner-format)
  - §12 sediment 教训 sub-section (5/12 cycle 5 个失误)
  - §13 守门 audit 5 步永久加

---

*v0.2 — 2026-05-12 NWT architect. P0.1 ✓ ship, P0.2 NEXT (含 http_post action precondition + dead template fix 合并). J2 收 v0.2 commit broadcast 后开 P0.2 ship (~270 LOC 1-2 hr).*
