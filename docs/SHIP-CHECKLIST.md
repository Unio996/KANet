# Phase Closure Ship Checklist

## 用途

本文档是 docs/COLLAB-REFORM.md 规 11（Phase closure 不 premature）+ docs/ANTI-PATTERNS.md R40（ship ≠ sealed）的 actionable SOP。三方在 broadcast `phase X sealed` / `production ready` / `closure done` 等终态信号前必跑完本 checklist。

任一漏 → 不广播 closure。

## 关键教训背景

- 2026-04-28 12:30 NWT broadcast `phase 3 closure 8/8 sealed`。Owner 真测 12:18 立刻撞 Bug-A（broker 静默 '已付'）+ Bug-B（重复 publish 3 个 offer）+ Bug-C（KAS 价格偏离）+ Bug-Z21 + Bug-Z23。三方 ack ≠ Owner 真测 0 bug。
- 2026-04-28 16:47 R33 cron catch broker host console pre-Bug-Z24 仍 running。disk file commit 14:41 ship 但 console process 13:18 启动，1h23min production broken until 17:10 restart。`git commit success ≠ ship done`。

## 7 条 Ship Checklist

### 1. cron baseline 多次 run 全 PASS（不只 1 次）

```bash
cd kasia-console && node scripts/test.mjs --domain=broker
# verify result: 24+/25 PASS, FAIL 项是已知 transient（e.g. ux_p15 LLM timeout）, 不是 commit regression

# 再跑 1 次（防 transient false-pass）
cd kasia-console && node scripts/test.mjs --domain=broker
# 两次 result 一致才算 stable PASS
```

**验收**: 二次跑全 PASS 一致（已知 transient 同 list, 无新 FAIL）。

### 2. Owner 真测 0 bug verify

Owner 真测 1 critical path（不要求全栈 0 bug，但要求关键 path 跑通）:
- BUY KAS（含跨链支付 / 验证 / 自动 deliver）
- SELL KAS（含发布 offer / 等 taker / 自动收 payment / 自动 deliver）
- Cancel-refund（含 R33 active state + LLM call + sendKas refund）
- Payment ('已付' user signal → broker 自动 verify_payment）

Owner 真测撞 bug → 不 closure，三方 dig + ship 加固。

**验收**: Owner DM 真测 ≥1 critical path 成功无人工干预。

### 3. 跨 process boundary 端到端 type test

Bug-Z21 / Bug-Z23 教训: broker 传 number, relay kasToSompi 期望 string → BigInt crash。

```bash
# Verify R38 schema typeof + coerce 全链路
cd kasia-console && node test-framework/cases/broker/r38_cross_process_type.test.mjs
# OR 跨 process 真测 broker → relay → chain TX 全栈
```

**验收**: 跨 process 任何 type mismatch 均被 R38 catch + coerce or reject, 不 silent crash。

### 4. log grep error 全 clean

```bash
# llama-server (LLM provider)
grep -c "Jinja Exception" logs/llama-server-err.log
# 验收: 零 OR 旧时间戳 (不在最近 1h 内)

# kasia-relay
grep -cE "ERROR|FATAL|throw" logs/relay-*.log | tail -10
# 验收: 零 fresh error

# console
grep -cE "ERROR|FATAL|uncaughtException" logs/console.log
# 验收: 零 fresh error
```

**验收**: 三个 log grep 最近 1h 全 clean。fresh error → 不 closure，dig 错误。

### 5. 关键 anti-pattern 注释 (T-X-X) 全 grep 过

```bash
# 改 critical 8 file 时, 必 grep 触发 anti-pattern + commit msg 含 acknowledged: per surfaced
git diff --name-only HEAD~10 HEAD | xargs grep -lE 'T-J[0-9]+-|T-NWT-|Bug-[A-Z][0-9]+|撤回|灾难'
# 列文件 → reviewer 必 verify 这次 ship 没 reintroduce 历史 anti-pattern
```

**验收**: 每 critical 8 file change 都 verified 不 reintroduce（commit msg 含 acknowledged 强 enforce by hook）。

### 6. ANTI-PATTERNS.md 涉及 rule 都 verify

```bash
# Spot-check 改 critical 8 file 涉及的 ANTI-PATTERNS rule
grep "^## 规则" docs/ANTI-PATTERNS.md | head -50
# Verify R37/R38/R39/R40 + 涉及 rule 当前 fix 没 regress
```

**验收**: 三方 reviewer cross-check 涉及 rule 当前 verify 状态。

### 7. critical 8 file change ship → 必触发 process restart + cron sanity

**最关键**: `git commit success ≠ ship done`。disk file 改了不等于 process 加载新 code。Bug-Z24 实证: J1 commit 14:41 ship Bug-Z24 fix, broker host console process 13:18 启动 1h23min 仍跑老 code, R33 cron 16:47 catch + 17:10 restart 才真正 ship。

```bash
# Stop relevant process
bash kanet-stop.sh

# Verify clean shutdown (no zombie)
ps aux | grep -E "kasia-console|kasia-relay|kaspa-scout" | grep -v grep
# 应该 0 result (或仅当前 grep 自身)

# Start
bash kanet-start.sh

# Wait for ready
sleep 5

# Verify process up + listening port
curl -sf http://localhost:3200/api/health > /dev/null && echo console OK
curl -sf http://localhost:3015/api/health > /dev/null && echo adapter OK

# Cron sanity test (e.g. R33 active LLM call)
cd kasia-console && node scripts/test.mjs --case=r33_active_llm_call_no_jinja_500
# 验收: PASS, broker LLM call 不 fall back 'LLM 卡了'
```

**验收**: process restart 后 cron sanity test PASS, 新 code 真加载。

## Phase closure broadcast 模板

```
[<Reviewer> phase X closure — N/N 条 checklist 通过, broadcast sealed]

| # | checklist | result | evidence |
|---|-----------|--------|----------|
| 1 | cron baseline 多次 PASS | ✅ | <test-run-id 1, 2> |
| 2 | Owner 真测 1 critical path | ✅ | <Owner broadcast OR DM ack> |
| 3 | 跨 process type test | ✅ | <test-case PASS> |
| 4 | log grep error clean | ✅ | <log timestamps> |
| 5 | T-X-X 注释 verify | ✅ | <relevant grep> |
| 6 | ANTI-PATTERNS rule verify | ✅ | <rule list verified> |
| 7 | process restart + cron sanity | ✅ | <restart timestamp + cron PASS> |

phase X sealed.

Co-Reviewed-By: <other 2 reviewers>
acknowledged: <涉及 rule list>
coord-ack: <ack broadcast tx>
```

任一 ❌ → 不 broadcast closure。

## 跟其他 docs 关联

- `docs/COLLAB-REFORM.md` 规 11 — Phase closure SOP 高层规则
- `docs/ANTI-PATTERNS.md` R40 — ship ≠ sealed anti-pattern 现象描述
- `docs/kanet-investigation-methodology.md` 第 0 层 — bug dig 第一步必 grep upstream service log
- `scripts/git-hooks/commit-msg` — 规 13 coord-ack + 规 10 acknowledged 强 enforce
- `scripts/audit-broker-weekly.mjs` — 周期 audit cron 监 reform 漏率

## 修订历史

- **2026-04-28**: v1.0 初版，基于 R40 + 规 11 + Owner 04-28 真测教训 sediment。第 7 条 (process restart + cron sanity) from R33 cron catch console pre-Bug-Z24 教训。
