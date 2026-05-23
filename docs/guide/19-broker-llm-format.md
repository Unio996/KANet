# ch19. broker LLM 调用 format 与多 LLM 兼容性

> **范围**: broker LLM call 全 stack — Qwen 单 system message 严格 spec / multi-LLM compat / SYSTEM_PROMPT 设计原则 / lint enforce + cron regression / 历史教训.
> **新建**: 2026-04-28（task 2/5，broker 开发踩坑 sediment）。

这章是 broker LLM 调用的 cross-cutting reference。**新写 LLM caller 之前必读**。漏看一条 → 直接踩进 R37 / Bug-Z24 / Rule 11 类历史 anti-pattern。

---

## 19.1 broker LLM 调用 stack

```
broker DM in
  → broker-llm-agent.js handleLlmDialog(peer, history)
    → _callLlm(history, ctx) — internal LLM caller
      → POST http://localhost:8000/v1/chat/completions
        body: {
          messages: [
            { role: 'system', content: SYSTEM_PROMPT + (ctx.systemAppend ? '\n\n' + ctx.systemAppend : '') },  // ← 单 system msg
            ...history  // user/assistant 交替
          ],
          tools: [ preview_order, finalize_order, verify_payment, cancel_order ],
          chat_template_kwargs: { enable_thinking: false }  // ← Rule 11 kill switch
        }
      → llama-server (Qwen3.6-35B-A3B-Q4_K_M.gguf)
      → response → tool call OR text
    → Layer 3 chain-truth verify (validateLlmReply)
  → broker DM out
```

**关键点**:
- `messages[0]` 必是 `{ role: 'system' }`，且仅 1 个 system 项
- `ctx.systemAppend` merge 进单 system message（不 unshift 第 2 个）
- `chat_template_kwargs.enable_thinking=false` 必带（`/no_think` 实测无效）
- Layer 3 chain-truth verify LLM ack 含的 tx hash 必 grep `kaspa_tx_log`（commit 0b31e4b7 J1）

---

## 19.2 Qwen Jinja chat template 严格 spec

Qwen3.6 chat template (Jinja) 严格要求：

1. messages 数组里 `{role:'system'}` 仅 1 个，必在 `messages[0]`
2. role 顺序：system → user/assistant 交替
3. 双 system msg → `raise_exception('System message must be at the beginning')` → llama-server **500 Bad Request**

### Bug-Z24 真案 (Jinja Exception)

```
Turn 1: '我要卖 5 KAS, BSC 链, 0x...' → broker reply '卖单画像' (deterministic, no LLM)
Turn 2: '请问可以分批付款吗' → broker reply '抱歉, 我这边 LLM 卡了一下...' ✗
```

R33 SELL state lock active 后 (Turn 1 set), Turn 2 LLM call **100% fall back** "LLM 卡了一下"。

llama-server-err.log:
```
srv operator(): got exception: Jinja Exception: System message must be at the beginning.
```

caller history 含 `{role:'system', stateLockAddendum}`（R33 wire 加的 unshift） → `_callLlm` requestBody 含 SYSTEM_PROMPT system + stateLockAddendum system → 双 system msg → Qwen Jinja `raise_exception` → 500。

**修法**（Bug-Z24 fix, commit e8f8e064 J1 ship 04-28 14:41）：

```js
// Wrong (R33 wire 371e4ca62, J2 reintroduce T-J1-19f anti-pattern)
const stateLockAddendum = llmSystemPromptStateLock(peer);
if (stateLockAddendum) {
  history.unshift({ role: 'system', content: stateLockAddendum });  // ← 双 system msg
}

// Right (Bug-Z24 fix)
const stateLockAddendum = llmSystemPromptStateLock(peer);
let llm = await _callLlm(history, { peer, turn: 1, systemAppend: stateLockAddendum });

// _callLlm internal (broker-llm-agent.js L226):
const fullSystem = ctx.systemAppend ? `${SYSTEM_PROMPT}\n\n${ctx.systemAppend}` : SYSTEM_PROMPT;
messages: [{ role: 'system', content: fullSystem }, ...messages]  // 单 system msg
```

### Layer 3 chain-truth verify

LLM 输出含 tx hash 时（"已退 X KAS"），必经 `validateLlmReply` 反查 `kaspa_tx_log` — chain 真有这笔 tx 才让 reply 出去。否则 LLM 编 fake tx hash → user 卡。

实施: `broker-state-authority.js` validateLlmReply (commit 0b31e4b7 J1 ship phase 3)。

---

## 19.3 multi-LLM 兼容性（Owner 14:08 钦定）

KANet broker 必须 work for arbitrary LLM。用户自带笨 model（GLM / 别的小 model）也要能跑。**不依赖 Qwen 特化能力**。

### 设计原则

1. **SYSTEM_PROMPT 极简 + plain language**（Owner 13:55 抓"构造词"）— 笨 LLM 看不懂术语堆砌
2. **few-shot examples > instruction** — 笨 LLM 看 example 学 比 instruction 学好
3. **critical path deterministic 保留** — cancel-refund / 标准词 PRICE_QUERY / CONFIRM_WORDS / PAID_NO_TX_REGEX 等 deterministic shortcut 跟笨 LLM compat 必要
4. **tool description 删 internal terms** — `议 B` / `_pendingPreview` 等内部术语进 prompt → 笨 LLM 不懂

### 不接 provider failover（Owner 否决）

NWT 14:01 propose Qwen + Claude/OpenAI fallback. Owner 否决: "qwen 用好没有任何问题"。修法是 Qwen tuning + SYSTEM_PROMPT 简化，不是 provider switch。

---

## 19.4 SYSTEM_PROMPT 设计原则（Owner 13:55 + 14:25 + 14:46 训）

- **plain 中文** / 0 internal refs（Bug-X / T-X-X / R33 等都不进 prompt）
- **0 历史 incident 描述**（LLM 不需要历史背景）
- **positive instruction > negative**（'不准 X' → 'X 必经 tool'）
- **建议简短 prompt**（broker 实测 v1.2 trim 路径效果好，长 prompt LLM attention 衰减是已知 behavior）
  - **没绝对 chars 阈值** — model-dependent（Qwen3.6 vs 其他笨 model 不同）
  - 长期需 broker 跑 prompt 长度 vs latency benchmark 实测 evidence（J2 propose phase 6 follow-up R41）
- **0 stutter**（Owner 14:25 钦定 ban：`/真\*+真/` 类 pattern 全 ban，broadcast 任一发出立即剔除团队下线）
- **tool description 删 internal terms**（议 B / _pendingPreview / 等不进 prompt）

---

## 19.5 跨 file Qwen API caller audit

现 6 file 有 `chat_template_kwargs` caller（grep 实证）：

```
$ grep -rn "chat_template_kwargs" /c/kanet/kasia-console/src/ /c/kanet/scripts/
kasia-console/src/services/broker-llm-agent.js
kasia-console/src/services/llm-dispatcher.js
kasia-console/src/services/market-rules-parser.js
scripts/channel-bridge.mjs
scripts/qwen-bridge-worker.js
scripts/qwen.js
```

**全 caller 必 follow**:
- Rule 11（QWEN-RULES）: `chat_template_kwargs.enable_thinking=false`
- Rule 13（QWEN-RULES）: 单 system message
- ch19（本章）: 上面 19.1-19.4 全 spec

新加 LLM caller 时同步加进上面 list + 跑 lint R37（broker-llm-agent.js）。

---

## 19.6 lint enforce + cron regression

### lint R37 (commit a507aafc9 NWT 04-28)

`scripts/lint-kanet.mjs` checkR37 — broker-llm-agent.js `{role:'system'}` literal ≤ 1。> 1 → pre-commit reject。物理上无法 reintroduce 双 system msg。

### cron r33_active_llm_call_no_jinja_500 (commit 65c89f7d4 NWT 04-28)

`kasia-console/test-framework/cases/broker/r33_active_llm_call_no_jinja_500.test.mjs`:
- Turn 1 SELL trigger → R33 _pendingFields lock active
- Turn 2 unstructured msg → triggers LLM call
- Assert reply not contain 'LLM 卡了一下' / 'Jinja Exception'

post-restart Turn 2 LLM 真返 200，broker reply 含 LLM 真内容（不 fallback）。pre-restart 100% FAIL，post-Bug-Z24 fix + restart 100% PASS。

### audit-broker-weekly.mjs (commit 1ddd10a13 NWT 04-28)

每周 cron 跑 4 dim audit:
- Dim A: broker code 全 anti-pattern reintroduce (lint full scan)
- Dim B: coord-ack 跳率 (规 13)
- Dim C: acknowledged 漏率 (规 10 critical 8 file)
- Dim D: emergency-Z 滥用

reintroduce R37 anti-pattern → Dim A FAIL → 周级 alert。

### 三层防御 (lint + cron + docs)

R37 防御 chain:
1. **commit time** — lint-kanet R37 reject 物理 reintroduce
2. **runtime** — cron r33_active_llm_call 检 process 是否真 load 新 code (post-restart verify)
3. **docs** — QWEN-RULES Rule 13 + ch19 + ANTI-PATTERNS R37 (本档 + 历史 sediment)

---

## 19.7 历史教训 timeline

| 时间 | event | commit | type |
|------|-------|--------|------|
| 2026-04-26 | T-J1-19f 撤回 INTENT_LOCK system msg 注入 | (撤回 commit) | 第一次发现双 system msg → Qwen 退化 |
| 2026-04-27 21:44 | R33 wire reintroduce `history.unshift({role:'system'})` | 371e4ca62 | T-J1-19f anti-pattern reintroduce |
| 2026-04-28 06:40 | Owner 真测撞 'Yes' / '现在 Kas 卖价?' / '?' 全 LLM 500 cascade | (真测 broadcast) | Bug-Z24 production fire |
| 2026-04-28 14:00-14:35 | 1h+ debate 走偏 ("Qwen 不稳" / "构造词" / "broker memory cornerstone") | (broadcasts) | 漏第 0 层 service log grep（投查方法论 第 0 层 sediment）|
| 2026-04-28 14:41 | Bug-Z24 fix merge stateLockAddendum → 单 system msg via ctx.systemAppend | e8f8e064 | J1 ship |
| 2026-04-28 14:50 | lint R37 ship | a507aafc9 | NWT enforce |
| 2026-04-28 15:30 | QWEN-RULES Rule 13 ship | 08022edb7 | J2 docs |
| 2026-04-28 16:47 | R33 cron 意外 catch console pre-Bug-Z24 1h23min broken | (cron catch broadcast) | dual-host R33 cron sediment |
| 2026-04-28 17:00-17:10 | broker host restart load Bug-Z24 fix | (restart broadcasts) | post-fix verify |
| 2026-04-28 17:14 | R33 cron commit | 65c89f7d4 | NWT regression case ship |
| 2026-04-28 18:00 ish | ANTI-PATTERNS R37-R40 sediment | 3704ac457 | J2 anti-pattern docs |
| 2026-04-28 19:00 ish | ch19 + 第 0 层 sediment | (本 commit + 第 0 层 commit) | docs sediment |

---

## 关联 docs

- `QWEN-RULES.md` Rule 11（kill switch）+ Rule 13（单 system msg）
- `docs/ANTI-PATTERNS.md` R37（broker LLM 单 system msg）+ R40（ship ≠ sealed phase closure，含 Bug-Z24 1h23min broken 真案）
- `docs/COLLAB-REFORM.md` 规 9（bug dig 第一步必 grep upstream service log）+ 规 11（phase closure ship checklist）
- `docs/SHIP-CHECKLIST.md`（actionable 7 条 + phase closure 模板）
- `docs/kanet-investigation-methodology.md` 第 0 层（外部 service log）

ch19 在 cross-cutting reference 层（跟 ch15 API 速查 / ch18 test-framework 同档）。新写 LLM-driven feature 时跨 ch4 trading / ch17 retail-dex / 等都要回看本章。
