# J2 接 KANet Matcher Phase 1 — 完整启动 Instruction

**Version**: v1.0
**Generated**: 2026-05-01 NWT (reviewer/architect hat)
**Target**: J2 (implementor mode, Claude Code)
**Scope**: matcher Phase 1 (T1) — listen + intent extract, 不动 retail_dex_orders, 不发 offer, 不动钱

---

## 角色与频道

- **你**: J2 (implementor mode), KANet 标准 6 角色 workflow 的 implementor (per `docs/DEV-ROLES.md`)
- **协作**: NWT (architect + reviewer + QA hat 跨切, dev-coord 广播频道实时审核)
- **频道**: `dev-coord` (KANet 主开发频道), 通过 `/api/chat/send` 上链 (memory: 链上为依据). **不准走 DB 后门 / 不准 DM 私聊**
- **relay**: J2 自身 `c9c37c37-9a8c-484c-9893-20185d97ccf9`
- **r 编号**: 接续历史 sequential (你上次 broadcast 是 r105, 下次起 r106)

---

## 必读 (按顺序)

1. `docs/DEV-ROLES.md` v1.0 — 6 角色 workflow + 接位 SOP
2. `docs/STATE-MACHINES.md` v0.3 — 9 state + 13 transition + ⚠ §1 admonition (语义校验提醒)
3. `docs/MATCHER-ARCHITECTURE.md` v0.1 — 13 节 + 3 附录, 重点 §11 9 anti-pattern + §10 Owner 验收 3 场景
4. `tasks/PZ-MATCHER-shipT1.md` v1.0 — 9 subtask 顺序表 + 每 step 详细 spec

---

## 必扫 memory feedback (J2 接位 SOP 4 步扫描)

```bash
grep -ri matcher ~/.claude/projects/*/memory/feedback_*.md
```

必扫:
- `feedback_no_zhen_zi.md` (5/1 Owner 严训) — 戒"真"字 Qwen artifact
- `feedback_broadcast_after_commit.md` (4/30) — 每 commit 立即 broadcast 不等 cron
- `feedback_no_pass_after_consensus.md` (4/27) — 三方共识后不再征求 Owner pass
- `feedback_chase_dont_wait.md` — 发完帖不静默等
- `feedback_no_code_without_approval.md` — 没明确 OK 不 Edit/Write
- `feedback_grep_code_not_infer.md` — 架构断言必 grep+行号
- `feedback_strictest_standard.md` — 不 A/B/C 让 Owner 选, 默认最严审
- `feedback_operator_proactive.md` (5/1) — 12h 守到点必主动 close, 不靠 Owner 催

---

## 9 个 broadcast 触发器 (硬纪律 — 漏 1 个 = 越界)

| # | 时机 | broadcast 内容 必含 |
|---|---|---|
| **T1** | T1.0 grep done | J2 r-N: "语义校验报告 — confirming/refunding 真代码语义" + 3 件事 (file:line / 触发条件 / 跟 v0.3 §1 比对一致/不一致) + 求 NWT architect verdict |
| **T2** | 等 NWT r-N+1 architect verdict | (J2 不 broadcast, 等 NWT) — verdict 收到才进 T1.1 |
| **T3** | T1.1 commit (matcher skill 包结构) | J2 r-N+2: commit hash + diff stat + RFC ref + 求 NWT reviewer verdict |
| **T4** | T1.2 commit (loadPeerContext) | J2 r-N+4: 同 T3 + 含 5 ckpt 自查 (per task §T1.2 spec) |
| **T5** | T1.3 commit (extractIntent) | J2 r-N+6: 同 + 含 LLM extract sample (per task §T1.3 sample) |
| **T6** | T1.4 commit (replyToUser) | J2 r-N+8: 同 + 含 Action Executor wire 实证 |
| **T7** | T1.5 commit (executor.mjs 装配) | J2 r-N+10: 同 + 含 dry-run 跑通实证 |
| **T8** | T1.6 commit (Trader-M onboarding) | J2 r-N+12: + 含 Trader-M wallet/Agent Card/skill 注册全 ✅ |
| **T9** | T1.7-1.8 测试 + invariant ship | 各自 broadcast + 含 test pass count + invariant 0 violation |

每 broadcast 后**等 NWT cross-review verdict** 才进下一 subtask. 不擅自 cascade.

---

## 越界处理 SOP (Definition of NOT Done)

撞 task §"Out of scope T1 严禁做" 9 项任 1 → **暂停**, broadcast 含:
- 哪个 file:line 撞了哪条 anti-pattern
- 你想做 X 但 task 说不许 — 矛盾点
- propose: 求 architect 决策 (revert / 加 escape hatch / 修 task spec)
- **不要自己设计修法**

per Ship A 实战: J2 r74/r80/r94 撞越界都 broadcast → NWT architect 决策 → resolve, **0 implementor 越界擅作**.

---

## commit message 模板 (Ship A 标准, 每 subtask 必含)

```
feat/fix(matcher T1.X): <一行 summary>

mode: implementor (OR qa / operator)
RFC ref: <prev commit/broadcast TX hash> + Owner 5-1 钦定 (B-4 audit + matcher v0.1 设计)

acknowledged invariants:
- broker = KANet 的 broker (matcher 0 私有 state)
- column-before-transition (per STATE-MACHINES v0.3)
- 9 anti-pattern 严守 (per MATCHER-ARCHITECTURE §11)

ships:
- <file:LOC delta> 实施 X 函数 / 加 Y 测试

breaks invariants: NONE / <explicit list>

Tests:
- syntax check ✓
- lint-kanet ✓ N file clean
- node --test ✓ M/M pass
- 直跑 sample: <dry-run output>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## commit hygiene (Ship A SA-5b 教训)

- `git add <specific file>`, **不 file-level add 混杂 working tree pre-existing**
- 每 commit `git diff --stat <commit>^ <commit>` 列改动确认跟 subtask scope align
- 注释/code 戒"真"字 (Owner 5-1 严训, Qwen freestyle artifact)

---

## 起手第 1 动 (现在)

### T1.0 语义校验 grep — 3 个目录 scope (per task §T1.0)

```bash
cd /c/kanet

# confirming state 写入点
grep -rn "'confirming'\|\"confirming\"" \
  kasia-console/src/ agent-mind/src/ kasia-relay/src/ \
  --include="*.js" --include="*.mjs" 2>&1 | tee /tmp/grep-confirming.log

# refunding state 写入点
grep -rn "'refunding'\|\"refunding\"" \
  kasia-console/src/ agent-mind/src/ kasia-relay/src/ \
  --include="*.js" --include="*.mjs" 2>&1 | tee /tmp/grep-refunding.log
```

**为什么 3 dir 不只 console**:
- Relay 处理 handshake / chain TX 时可能写 state
- Mind `action-executor` 可能 transition state
- 只查 Console 会漏

### broadcast 3 件事 (报 NWT)

per Owner 5-1 钦定 + STATE-MACHINES.md v0.3 §1 admonition:

1. **写入位置**: 哪个 file:line 真在写 confirming / refunding
2. **触发条件**: 写入条件是什么 (什么 trigger 才进 confirming? underpayment? cross-chain confirm 中? 真 caller 意图)
3. **跟 v0.3 §1 比对**: 一致 / 不一致 / 部分一致 + 各自 detail

### 等 NWT architect verdict

NWT 切 architect hat 看完 broadcast → r-N+1 verdict:
- **一致** → 进 T1.1
- **不一致** → 修 spec 不修代码 (per v0.3 §1 admonition: "如果跟此 spec 描述不一致, 优先以代码现实为准, 修 spec 不修代码")

**不擅自 cascade T1.1 之前等 verdict**.

---

## 最后的话

做完 T1, KANet 有第 1 个 KANet-native broker (vs 老 broker 24 file 平行真相源). 这是 6 角色 workflow + audit-informed spec + 跨视角 review 第一次完整证明.

按 task 严守, 撞坑就 broadcast, 不擅自设计. NWT 跨 hat 实时陪.

---

*v1.0 — 2026-05-01 NWT (reviewer/architect hat 起草). T1.0 grep scope 修订 (3 dir, 不只 console). 跟 `tasks/PZ-MATCHER-shipT1.md` v1.0 配套读, 起手指南.*
