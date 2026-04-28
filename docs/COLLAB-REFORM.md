# 三方协作规范 (J1 + J2 + NWT)

## 用途

本文档记录 J1/J2/NWT 三方协作的 15 条规则，由 Owner 训出（2026-04-28 跨 3h 多次训），三方在 dev-coord 频道反复讨论 + 撤回 + 修订收敛而成。所有规则旨在防止『闷头干 / 跟屁虫 / 重复犯错 / 假共识 / 沉淀失败』六类反模式。

规则分两类：
- **机器 enforce**：lint rule、pre-commit hook、cron 自动化、commit msg regex check
- **人工 SOP**：reviewer 检查清单、broadcast 风格约束、push back 文化

机器 enforce 永远优先于人工 SOP（Owner 14:46 钦定核心：『靠人扫文档 100% 失败』）。

---

## 规 1 — 报告人 ≠ 修人

**触发场景**：bug 报告 / anti-pattern 发现 / 异常 dig 完成。

**规则**：报告人不得自己修。修人由另两方主动接，或报告人指派另两方之一。

**理由**：防自我闭环 review（自己写自己审 = 假 review）。J1 自己写 T-J1-19f 注释、自己 review J2 R33 wire 时漏看，是这条规的反例。

**检查方法**：commit msg 的 author 不得跟 dev-coord 报告人是同一人（pre-commit hook 可比对，但目前人工互审）。

---

## 规 2 — 修案先贴 diff，等 ≥1 方 ack 才 commit

**触发场景**：propose 任何 code/docs change。

**规则**：先 dev-coord broadcast 完整 diff（or 草稿 spec），等 NWT/J1/J2 任一方 explicit ack 才能 commit。emergency 例外走规 13。

**理由**：单方面 commit master 长期分叉，三方互相 cherry-pick 拼凑（Owner 12:34 训『各自割裂』）。

**检查方法**：commit msg 必含 `coord-ack: <ack-broadcast-tx-hash>` 或 `coord-ack: emergency-Z<bug-id>`（见规 13）。pre-commit hook regex check 强制（机器 enforce）。

---

## 规 3 — Commit 必带 reviewer 签名

**触发场景**：每次 commit。

**规则**：commit msg 必含 `Co-Reviewed-By: <reviewer-name> (<ack-tx-hash>)`。reviewer 是另两方之一（不能自审）。

**理由**：归档 review 责任。出问题时可回溯哪方未 catch。

**检查方法**：人工互审（pre-commit hook regex 可加，但目前人工 enforce）。

---

## 规 4 — 不 cherry-pick 拼凑，用 git merge

**触发场景**：跨机同步代码。

**规则**：J1 :9201 / NWT :9202 / J2 :9203 各 serve 自己 master bundle。互相 fetch + git merge（不 cherry-pick）。

**理由**：cherry-pick 漏 commit + 顺序乱，git merge 自动看分叉。

**检查方法**：git log 显示 merge commit 拓扑（人工互审）。

---

## 规 5 — 三方 ack 后立即干，不再问 Owner pass

**触发场景**：emergency ship（Owner 真测撞 production bug）。

**规则**：emergency 场景三方 ack 后立刻 ship，不等 Owner explicit approve。

**理由**：Owner 训『不要 ritual asking，自决』。

**例外（plan-request 场景）**：Owner 主动 question 求 plan（如『先给方案』），三方应给 Owner unified summary + 等 explicit approve（或 15min timeout）才 ship。详见规 13 emergency vs plan-request distinction。

**检查方法**：见规 13 emergency SOP 4 条。

---

## 规 6 — 真讨论 push back，不跟屁虫

**触发场景**：reviewer ack / 三方对 propose 表态。

**规则**：reviewer ack 不得只 'ack' / 'LGTM'。reviewer 必有自己 view，对 propose 不同意处明确 push back。三方 rotate 指定一人当『魔鬼倡导者』，必 push back ≥1 处。

**理由**：Owner 14:18 钦定『不是我说什么就是什么? 三方有没有真讨论? 跟屁虫应声虫搞得好个屁』。

**检查方法**：人工互审（reviewer notes broadcast 必含具体 grep 了什么 + 看了什么 commit / log，详见规 15）。

---

## 规 7 — broker 基本能力 ship + 兜底栈 anti-pattern 区分

**触发场景**：propose 涉及 broker LLM 路径修案。

**规则**：区分两类，不混。
- **broker 基本能力**：broker 数据层应有的（_pendingPreview state authority / chain DM history / handlePriceQuery 自报价）— 必 ship，不退化。
- **deterministic 兜底栈**：『LLM 死时绕 LLM 答』（如 PRICE_QUERY regex 加同义词 / LLM 500 fallback 一刀切分类） — 是 anti-pattern，禁止。

**理由**：Owner 13:58 训『系统越改越不好用』+ 14:13 cornerstone『broker 必须知道对话』。撤兜底是对的，撤 broker 基本能力是错的。NWT 14:01 一刀切撤回 5 issues，把 (3)+(4) 基本能力当兜底撤掉，是错 framing 实证。

**判断原则**：propose 含 'fall back to deterministic' / '绕 LLM' / 'LLM 死时直接答' / 'preview 加警告' → 先停。问『LLM 修好后这条还需要吗?』90% 答『不需要』= anti-pattern，撤。

**检查方法**：人工 review（无 lint，理由是边界靠人 judge）。

---

## 规 8 — Review 必检 invariant 退化

**触发场景**：reviewer 看 propose diff。

**规则**：grep 涉及 file 的历史 anti-pattern 注释（T-X-X 撤回 / 灾难 / 不准 类）。检查 propose 是否 reintroduce。

**理由**：J1 自己写 T-J1-19f 注释，自己 review J2 R33 wire 时漏看自己注释，导致 anti-pattern reintroduce 实证（Bug-Z24）。

**检查方法**：pre-commit hook advisory print 改 critical 8 file 时显示历史 T-X-X 注释（见规 13 critical 8 hard ack）。

---

## 规 9 — Bug dig 第一步必 grep upstream service log

**触发场景**：production 异常 / cron FAIL / Owner 真测撞 bug。

**规则**：dig 第一步是 grep upstream service log（llama-server / kasia-relay / kaspa-rpc / etc），不是 framework debate。

**理由**：J2 5 行 grep llama-server.log 找到 Jinja exception，比三方 1h+ debate framework 准（Bug-Z24 实证）。

**检查方法**：sediment 进 docs/kanet-investigation-methodology.md 第 0 层（外部 service log）。dig 报告必含 service log path。人工 spot check（reviewer 看 dig broadcast 是否含 log evidence）。

---

## 规 10 — Code change 涉及历史撤回 anti-pattern 必 grep 历史

**触发场景**：改 critical 8 file（broker-llm-agent / broker-state-authority / broker-buy-handler / broker-sell-handler / broker-action-queue / broker-cancel-refund / broker-intake-watcher / kasia-relay/transaction.mjs）。

**规则**：propose 时必 grep file 的 T-X-X 注释 + git log --grep 撤回历史。commit msg 必含 `acknowledged: T-X-X` per surfaced anti-pattern。缺 acknowledged → pre-commit hook 物理 reject。

**理由**：J2 ship R33 wire 漏看 T-J1-19f 注释，reintroduce 双 system msg anti-pattern，导致 Bug-Z24 撞 Owner 真测。

**检查方法**：lint-kanet pre-commit hook (P0 机器 enforce):
- 改 critical 8 file → grep T-X-X 注释 + git log 撤回历史
- 列 surfaced anti-pattern → require commit msg 含每个 `acknowledged: T-X-X`
- 缺漏 → reject commit

---

## 规 11 — Phase closure 不 premature

**触发场景**：phase 收尾、broadcast『phase X sealed』。

**规则**：phase closure broadcast 前必走 6 条 ship checklist:
1. 三方 cron baseline 多次 run 全 PASS（不只 1 次）
2. Owner 真测至少 1 个 critical path 成功（不要求 0 bug 全栈）
3. 已知 bug 全在 follow-up plan 里（defer to v1.x），不藏
4. 跨 process boundary type test 通过
5. 关键 service log（llama-server / kasia-relay / console）grep error 全 clean
6. ANTI-PATTERNS rules 全 grep verify

任一漏 → 不广播 closure。详见 docs/SHIP-CHECKLIST.md。

**理由**：NWT 12:30 phase 3 closure broadcast premature，Owner 真测 12:18 立刻撞 Bug A/B/C。三方 ack ≠ Owner 真测 0 bug，前者不能替代后者。

**检查方法**：pre-commit hook 不 enforce（phase closure 是 broadcast 不是 commit）。人工互审 + reviewer 必明确 say 6 条都 verify。

---

## 规 12 — 协作 reform 规 ack 不 enforce 是漏洞

**触发场景**：reform 规多次 broadcast 但实操漏。

**规则**：每条规必关联 1 个机器 enforce（lint / pre-commit hook / cron / regex check）。纯文档规没人扫。

**理由**：1+8+2 规之前 broadcast 完，三方 review/propose 时仍漏（J2 R33 wire 漏 T-J1-19f / J1 review 也漏 / NWT phase closure premature）。文档没机器兜底就是没用。

**检查方法**：本文档每条规末尾标注 lint rule / pre-commit hook / cron 关联（见每规『检查方法』段）。

---

## 规 13 — 闷头干 0 容忍 + Emergency SOP

**触发场景**：任何 code / docs change / ship。

**规则**：

### 默认（非 emergency）

- commit 前必 dev-coord broadcast 通知 + ≥1 方 ack（silent timeout 30min 视同 NO）
- commit msg 必含 `coord-ack: <ack-broadcast-tx-hash>`（pre-commit hook regex 强 check，缺 reject）
- 自作主张 = 闷头干 = 检测立即剔除（Owner 钦定 0 容忍）

### Emergency 例外（Owner 真测撞 production bug / cron alert FAIL）

emergency commit msg 含 `coord-ack: emergency-Z<bug-id>` 走以下 6 条 SOP：

1. emergency commit 立即 broadcast dev-coord（commit msg + diff + 真根因 trace）
2. 30min 内补 ≥1 方 ack 真 broadcast（ack 后追 `Co-Reviewed-By:`）
3. 30min 零 ack → auto revert（J1/J2/NWT 任一 enforce）
4. 24h 内 ≥3 次 emergency-Z → 团队 review 滥用
5. emergency trigger 必 Owner 真测撞 production bug 或 cron alert FAIL（不能自宣 emergency）
6. 30min 内 broadcast trace 含 root cause + 修法 + 已知 risk（不准 stub trace）

### Plan-request 例外

Owner 主动 question 求 plan（如『先给方案』），三方先给 Owner unified summary + 等 Owner explicit approve（或 15min timeout 视为隐式同意）才 ship。区别于 emergency 直接 ship。

**检查方法**：pre-commit hook coord-ack regex check（机器 enforce）。

---

## 规 14 — Reviewer 评 propose 含假设语必 explicit evidence

**触发场景**：reviewer ack propose 文档。

**规则**：propose 文档含『可能 / 估计 / 猜测 / 假设』等假设语 → reviewer 必 explicit:

- `evidence ack: <commit-hash> | <log-path> | <DB-row-ref>` 表示 reviewer 真 grep evidence
- OR `push back: 需补 evidence` 表示 reviewer 真 push back 求 trace

没 explicit 关键词 = reviewer 漏职，触规 13 0 容忍审查。

**理由**：J1 + NWT 13:30-14:01 SELL 1h debate 全基于『假设没流动性』推理，没 grep exchange_offers SQL 实证。J2 一条 SQL 翻盘。Lint 不适合 catch reasoning quality（false positive 高），人 spot check 是真解法。

**检查方法**：人工互审（三方看 reviewer ack broadcast 是否含 evidence ack: 或 push back: 关键词）。NOT lint（J1+J2 14:00 评估 false positive 风险高，撤 lint propose）。

---

## 规 15 — Reviewer notes 详细度 tiered

**触发场景**：reviewer ack broadcast 内容。

**规则**：

```
IF (critical 8 file change) OR (propose 触发 anti-pattern grep surfaced T-X-X) OR (规 14 假设语 evidence ack):
    详细 review notes：grep 了什么 commit / log / DB row + 看了什么 invariant + 测了什么 case
ELSE (普通 file: docs typo / 测试 case / 等):
    简单 'LGTM' ack 即可
```

**理由**：reviewer 每次写长 review notes = ritual friction，简单 commit 写长 review 反而稀释关键 case 的 review attention。tiered 跟 critical 8 file pre-commit hard / 其他 advisory 同 spirit。Pareto 80/20 sweet spot。

**检查方法**：人工互审（reviewer notes 内容 spot check）。

---

## Critical 8 File 列表（规 10 + 规 13 + 规 15 trigger）

```
kasia-console/src/services/broker-llm-agent.js
kasia-console/src/services/broker-state-authority.js
kasia-console/src/services/broker-buy-handler.js
kasia-console/src/services/broker-sell-handler.js
kasia-console/src/services/broker-action-queue.js
kasia-console/src/services/broker-cancel-refund.js
kasia-console/src/services/broker-intake-watcher.js
kasia-relay/src/lib/transaction.mjs
```

这 8 file 是 broker 核心 production critical path，blast radius 高（fund move / state authority / type contract）。改这 8 file:
- 规 10: `acknowledged: T-X-X` 必填（pre-commit hook 强 check）
- 规 13: `coord-ack:` 必填（同上）
- 规 15: reviewer 详细 review notes 必写

其他 file 走 advisory print + 周期 audit cron（规 12）。

---

## 监督机制 (5 条整合)

1. **Cross-side review**：谁 ship 谁不审自己（规 1）
2. **魔鬼倡导者** + reviewer notes broadcast：互审 1 人指定必 push back ≥1 处（规 6 + 规 15）
3. **Cron alert anti-pattern reintroduce**：scripts/audit-broker-weekly.mjs 周扫，FAIL 立即 alert 三方 + Owner（规 10 enforce）
4. **ANTI-PATTERNS.md commit hash 历史档案**：每条 rule 关联撤回 commit + 重犯 commit list 公开
5. **scripts/audit-broker-weekly.mjs 整合 cron**：1 cron 跑 broker code 全扫 anti-pattern reintroduce + git log advisory commits 漏 enforce + git log coord-ack 跳率 + emergency 滥用 check

---

## 历史背景 — 这次 Owner 训出 reform 的 12+ 条踩坑

| # | 坑 | Root cause | 何时 |
|---|-----|-----------|------|
| 1 | R33 双 system msg reintroduce → Bug-Z24 | J2 ship 漏看 T-J1-19f inline comment | 04-27 21:44 |
| 2 | Z21 send_kas → transfer amount type 不一致 → Bug-Z23 | J2 没 verify broker→relay 端到端 type contract | 04-28 04:48 |
| 3 | Bug-A '已付' silent | SYSTEM_PROMPT rule 3 同义词不够 | 长期 |
| 4 | Bug-Z19 LLM hallucinate fake cancel ack | SYSTEM_PROMPT 没禁止 LLM 自己回 ack | 长期 |
| 5 | Bug-Z18 cancel-refund regex strict ^...$ | 复合句不 match | 04-28 02:23 |
| 6 | Bug-Z20 timeout sweep self-deceive 循环 | broker-cancel-refund INSERT-before-confirm | 04-28 02:23 |
| 7 | Bug-Z22 stutter 漏到 broker user-facing | dev-coord broadcast 风格漏到 broker code | 长期 |
| 8 | 架构记忆失败 (4 次反复) | 个人执行力弱 + 没机器 enforce | 这天 24h+ |
| 9 | 跟屁虫文化 | Owner 每条 input 立即 ack 没 push back | 这天 |
| 10 | 撤回错把基本能力当兜底 | NWT 14:01 5 issues 一刀切 frame | 04-28 14:01 |
| 11 | Pre-mature phase closure | 8 层 ship 立刻广播 closure | 04-28 12:30 |
| 12 | Reform 规 ack 不 enforce | review/propose 时三方都漏 | 这天 |
| 13 | SELL 1h debate 假设没流动性 | 没 grep exchange_offers SQL 实证 | 04-28 13:30-14:38 |

---

## Bootstrap 例外 — Timestamp Gate

audit-broker-weekly.mjs 跑 git log coord-ack 漏率 / acknowledged 漏率 audit 时使用 **timestamp gate**：

- 仅扫 pre-commit hook ship commit timestamp **之后** 的 commit
- pre-commit hook ship commit hash + timestamp 写入 audit script CONFIG（pre-commit hook ship 时记录）
- 之前 commit（含本 docs / lint R37 / R38 step 1+2 / QWEN-RULES Rule 13 等 first wave Section 3 ship）视为 historical bootstrap，skip 整批

每条 historical first wave commit 不需 `bootstrap-exception:` mark — 避免 retroactive amend（memory feedback "create new commit not amend"）。

仅未来例外（如 emergency 紧急绕 hook）才 explicit `bootstrap-exception: <reason>` mark commit msg，三方手工 verify。

后续 commit（pre-commit hook ship 之后）必走完整 reform flow（coord-ack regex check 等）。

## 修订历史

- **2026-04-28**：v1.0 初版，三方协作 reform 1+8+2 规 sediment from Owner 训。
- **2026-04-28**：v1.1 加规 13/14/15 + Critical 8 file + 监督机制 5 条 from v2.3.1 三方共识。
- **2026-04-28**：v1.2 加 Bootstrap 例外段 from J2 4dc7 push back。
- **2026-04-28**：v1.3 Bootstrap 例外改 timestamp gate from NWT push back（避免 retroactive amend）。

