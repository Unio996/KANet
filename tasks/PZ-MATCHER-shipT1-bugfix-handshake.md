# Task: PZ-MATCHER-shipT1-bugfix-handshake

**Version**: v1.0
**Phase**: T1 bugfix (Bug 1 per NWT r124 architect verdict)
**Scope**: `kasia-relay/src/rpc-listener.mjs` processHandshake silent throw 定位 + 修根因
**Owner**: J2 (implementor) → NWT (reviewer hat) → operator (system self-verify)
**ETA**: ~15min impl + 5min review + 5min self-verify
**LOC budget**: ~10 LOC fix + ~10 LOC telemetry

---

## 起源

NWT r124 (TX b29609e1) + Owner 5-2 钦定 (J + 完整流程).

**Bug 1 描述**: Trader-M (kaspa:qqndp3hcrce942c3max7mq3j9jc6m3y00mlpdpfpv0hzvlsygp9zx9z9xn7rh) 收到 Owner handshake 10:55:45.669 (log "HANDSHAKE from nurgcqs3s588 — alias: 35ae744bc46c") 但 0 reply.

log 后续应有 "auto-accepting handshake..." OR "HANDSHAKE already <status>" OR "claim failed" — 实际全无, 直接 catch-up cycle. outer `} catch {}` (line 715) 静默 swallow exception.

DB 实证: 0 relation_states + 0 pending_actions for Trader-M ↔ nurg.

Mind 实证: 3 处 [mind-event] Trader-M health_yellow silent repair proactive — Trader-M 不健康.

---

## 6 Candidate silent throw 点

| # | line | call | 候选 throw |
|---|---|---|---|
| 1 | 625 | ingestTx fetch | Console URL unreachable / fetch err |
| 2 | 643 | DEDUP 2 /api/relation/status fetch | wrapped local catch (less likely) |
| 3 | 654 | ingestMessage fetch | INGEST_SECRET mismatch / HTTP err |
| 4 | 671 | claim /ingest/pending-handshakes fetch | secret mismatch / abort timeout |
| 5 | 688 | acceptHandshake | chain-side err |
| 6 | 690 | sendKaspa | UTXO insufficient / fee err / storage_mass quirk |

---

## SOP 4 step

### Step 1: 改 outer catch 加 err.message log (~3 LOC)

immediate diagnostic — silent → reveal exact throw point.

current (line 715):
```js
  } catch {
    markSeen(txId);
  }
```

改:
```js
  } catch (err) {
    log(`HANDSHAKE processing failed for ${senderAddress?.slice(-12) || 'unknown'}: ${err?.message || err}`);
    markSeen(txId);
  }
```

### Step 2: 加 step-by-step telemetry (~5-7 LOC)

log between line 625 / 654 / 671 / 688 / 690 当 step 完成 — 后置 throw 点 reveal at outer log.

例如 line 625 后加: `log('HANDSHAKE step 1 ingestTx ok');`

### Step 3: restart Trader-M relay + trigger Owner re-handshake (system self-verify, 不 Owner manual)

- Console UI: stop + start Trader-M relay (re-load 含新 telemetry)
- cron / probe 自动 trigger re-handshake **OR** Owner 已 sent handshake (history 已上链, relay catch-up 重 re-process)
- 看 console.log outer catch err message

### Step 4: 根因修

- err = "fetch failed" → INGEST_SECRET env propagation 修 OR Console URL 修
- err = "Storage mass exceeds maximum" → sendKaspa fee adjust (KI-7 sediment Kaspa quirk)
- err = "acceptHandshake undefined" → chain.mjs 修
- err = 别的 → broadcast architect 决策

**严禁**: try/catch 绕过根因 (anti-pattern).

---

## Acceptance (system self-verify, 不 Owner manual)

| # | check | metric |
|---|---|---|
| 1 | handshake reply | DB: `relation_states.status` IN ('accepted','active','confirmed') for Trader-M ↔ nurg |
| 2 | greeting outbound TX | DB: `chain_events.event_type` = 'comm_sent' from Trader-M to nurg in last 10min |
| 3 | Mind health green | log: 0 mind-event Trader-M health_yellow in last 5min |
| 4 | telemetry coverage | log shows step 1-5 success markers when handshake processed |
| 5 | system self-verify | NWT operator hat 跑 verify script (or manual SQL) 实证 #1-4 + broadcast pass |

---

## Anti-pattern (per Owner 5-2 钦定)

- ❌ 不加 try/catch 绕过根因 (掩盖 throw)
- ❌ 不让 Owner 当 verify 工具 (KI-8: system 自动 verify acceptance #1-4)
- ❌ 不动 matcher.mjs (Bug 1 在 rpc-listener.mjs, 不在 matcher)
- ❌ 不重写 outer catch 成 finally without log (silent swallow 反复)

---

## RFC ref

NWT r124 verdict (TX b29609e1) + Owner 5-2 J 钦定 + KI-6 manual API hygiene (curl -s 双 INSERT) + KI-7 Kaspa storage_mass quirk + KI-8 system self-verify (no Owner manual)

---

## sediment

Phase 1 retro 收尾时 sediment:
- Bug 1 根因 (post fix)
- KI-9: outer try/catch 静默 swallow anti-pattern (代码审 必 grep `} catch {` 0 log → flag)

---

*v1.0 — 2026-05-02 NWT (architect mode 起草). 不许 implementor 修 acceptance / scope. 撞 anomaly 暂停 broadcast.*
