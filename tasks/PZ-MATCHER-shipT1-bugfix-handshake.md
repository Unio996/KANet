# Task: PZ-MATCHER-shipT1-bugfix-handshake

**Version**: v1.1
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

### Step 3: 验证 catch-up re-process 条件 + 触发 + 看 outer catch err

#### 3a: stop Trader-M relay (concrete API)

```bash
curl -s -i -X POST http://127.0.0.1:3100/relays/385f68eb-21a8-4e83-bb33-fa9f54a038ea/stop
```

(grep `/relays/:id/stop` in `kasia-console/src/api/relay.js` to verify path. 如不存在 → broadcast architect 决策, 不擅自创新 endpoint.)

#### 3b: start Trader-M relay (concrete API)

```bash
curl -s -i -X POST http://127.0.0.1:3100/relays/385f68eb-21a8-4e83-bb33-fa9f54a038ea/start
```

(同 3a verify path.)

#### 3c: verify catch-up re-process 条件

J2 implementor 必先 grep 实证 `markSeen` / `_seen` 持久化 + handshake txid 处理:

```bash
grep -nE "markSeen|_seen|loadSeen|saveSeen" kasia-relay/src/rpc-listener.mjs kasia-relay/src/state.mjs
```

预期实证 (NWT pre-grep finding):
- `_seen` Set persisted to `./state/seen.json` (relay process cwd)
- silent catch (line 715) 调 markSeen(txId) → handshake txid sticky-seen
- restart 后 reload seen.json → handshake catch-up "already seen" → **NOT re-process**

3 选 (J2 broadcast architect 决策, 不擅自):
- (i) delete handshake txid from `./state/seen.json` (manual, isolated to single TX)
- (ii) delete entire `./state/seen.json` (re-process all history, side-effect risk)
- (iii) **design fix**: 改 outer catch NOT markSeen on silent throw — let catch-up retry next cycle (root-cause cleaner, 但 risk infinite retry if throw deterministic)

NWT 倾 (iii) — design fix correct semantics. 但 J2 grep verify 后 broadcast 求 architect verdict.

#### 3d: 看 console.log outer catch err message

post Step 1 (outer catch log 加) + Step 3a-3c (relay restart + handshake re-process) → tail console.log:

```bash
grep -E "Trader-M.*HANDSHAKE processing failed" /c/kanet/logs/console.log | tail -5
```

err message reveal exact silent throw 点 → Step 4 根因修.

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
| 4 | telemetry coverage 完整 log 序列 | log shows 6 step markers + outer catch err format on path:<br>`HANDSHAKE from <peer> — alias: <alias>` (existing line 616)<br>`HANDSHAKE step 1 ingestTx ok` (new, post line 625)<br>`HANDSHAKE step 2 dedup-1 in-memory pass` (new, post line 639)<br>`HANDSHAKE step 3 dedup-2 db pass` (new, post line 651)<br>`HANDSHAKE step 4 ingestMessage ok` (new, post line 659)<br>`HANDSHAKE step 5 claim ok` (new, post line 685)<br>`auto-accepting handshake...` (existing line 687)<br>`HANDSHAKE ACCEPTED TX: <txid>` (existing line 691)<br>`GREETING SENT: <txid>` (existing line 705)<br>**OR on err**: `HANDSHAKE processing failed for <peer>: <err.message>` (new, line 715 outer catch) |
| 5 | system self-verify | NWT operator hat 跑 verify script (or manual SQL) 实证 #1-4 + broadcast pass |

---

## Anti-pattern (per Owner 5-2 钦定)

- ❌ 不加 try/catch 绕过根因 (掩盖 throw)
- ❌ 不让 Owner 当 verify 工具 (KI-8: system 自动 verify acceptance #1-4)
- ❌ 不动 matcher.mjs (Bug 1 在 rpc-listener.mjs, 不在 matcher)
- ❌ 不重写 outer catch 成 finally without log (silent swallow 反复)
- ❌ 不许只修 outer catch log 漏 step telemetry — 两 Step (Step 1 outer catch + Step 2 step telemetry) 必配套 ship. 仅 Step 1 = err message 出现但不知前 5 step 哪步 throw, debug 仍盲. 仅 Step 2 = step log 全 ok 但 outer catch 仍 silent, throw 点漂. 配套 ship 才 isolate.

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
