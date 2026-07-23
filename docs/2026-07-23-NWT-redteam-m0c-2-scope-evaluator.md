# M0c-2 scope evaluator 设计稿 — NWT 红队 verdict

> **Status**: DRAFT（2026-07-23 · NWT）
> **审对象**：`docs/2026-07-23-m0c-2-scope-evaluator-design.md`（J2，commit `1176a67a`）——③策略 evaluator + ④逐 caller scope 精判。
> **立场**：红队默认 refute。scope evaluator 的全部价值在"验的值 == 执行的值"，我尤其查它有没有在错误的值上做 scope 判定（vacuous scope）。
> **verdict**：**GREEN-with-1-MUST-FIX + 2-note**。合成单调（decision=M0c-1 AND scope，只更严不放宽）/fail-closed 默认最严/origin 路径隔离诚实/TCB 边界继承——都对。MUST-FIX = **verify-value-source**：evaluateScope 必须在 M0c-1 §4.1 冻结的、relay 实际执行的那份 canonical intent 上抽 scope 维度，否则 scope 判定 vacuous。

---

## 打不穿的（挣的 GREEN）

- **合成单调（§3）**：`decision = M0c-1.decision AND evaluateScope`——M0c-2 只能加拒不能放行，不可能被用来绕 M0c-1。测试 §5-8 覆盖。✅
- **fail-closed 默认最严（§3.4）**：scope 表未配置某维度=默认拒所有（非放行所有），解析异常/grant 读失败/维度缺失→拒。默认拒方向对（同 M0c-1 §3.2）。✅
- **origin 路径隔离（§1/§4）诚实**：scope 精判只对 origin='app' load-bearing；internal（daemon=TCB）/operator（专道 own 白名单）不经 M0c-2，明标"不重复也不假装管"。与专道 note-2（operator 无 intra-command scope，post-R 补）一致，不 overclaim。✅
- **TCB 边界继承（§1）**：scope 表宿主乙期在 Console 域=对场景 A 有效对场景 B（Console 改 scope 表）无效，禁用词表继承。✅
- **scope 数据源 = grant registry（§2）**：provision 走 M0c-1 §4.3 operator 离线（场景 A 不可达），M0c-2 只读不写——不新增 provision 面。✅

## 🔴 MUST-FIX：verify-value-source——scope 必须评估"冻结的、执行的"那份 intent

**打穿链**：evaluateScope 要判"金额 ≤ 上限""收款人 ∈ allowed""outpoint ∈ scope"，就必须从 intent 里**抽出** amount/recipient/outpoint。设计 §0/§3 只说消费"反序列化后的 intent（命令+参数）"，**没焊死这份 intent 就是 M0c-1 §4.1 冻结的、`:358` switch 实际执行的那份**。

若 evaluator 抽的 amount/recipient 来源跟 relay 实际执行的字段**不是同一处**（比如 evaluator 读 cmd.amount，relay 执行时用 cmd.outputs[i].value，或命令能同时带两个字段让 evaluator 看小的、relay 执行大的）→ **scope 判定 vacuous**：evaluator 判"金额 100 ≤ 上限"放行，relay 实际转 10000。这是 memory `verify-value-source-checker-must-access-binding-at-decision-time` / `feedback-ss-attack-review-verify-value-source` 那族——checker 必须在决策时点访问**真实 binding 值**，不是旁支可控字段。

**修法（写死为设计不变量）**：evaluateScope 抽的每个 scope 维度值（amount/recipient/outpoint/market/family/branch）**必须来自 M0c-1 §4.1 冻结的 canonical intent 的、relay 执行时消费的同一字段**——"验的值 == 执行的值"焊死。设计须显式写：①scope 维度抽取的字段路径 = relay 执行消费的字段路径（同源）；②intentDigest（M1-6）覆盖全部 scope 维度字段（改任一 scope 值使 digest 失效，防 evaluator 验完 relay 执行前掉包）；③禁止 evaluator re-parse 或从 command 旁支字段取值。落码 diff 审我逐维度核"抽取字段 == 执行字段"。

## 2 note（落码前收）

- **note-1（covenant outpoint/market scope 抽取非平凡）**：对 covenant 结算命令（sign_input_for_settle 等），"这条命令触达哪个 market/outpoint"编码在 covenant 结构（witness/inputs/outputs）里，不是简单字段。evaluator 从 covenant 命令**正确派生**它花的 outpoint/market，需要跟 covenant 审同等严度（知道这条 unlock 实际花哪个 outpoint）。设计 §2 列了 market/outpoint 维度但没提抽取难度。落码须验：covenant scope 抽取 == covenant 实际花费的 outpoint（同 MUST-FIX 的 verify-value-source，covenant 版）。
- **note-2（typed-intent 依赖）**：细粒度 intent scope（amount/recipient 从结构化 intent 抽）**要求命令有 typed-intent**。M-1.1/M0b 坐实多数命令还没 typed-intent（裸 witness/inputs/outputs）。所以未 typed 化的命令 M0c-2 只能做粗 scope（命令类型+relay/wallet），做不了 amount/recipient 精判——而按 M0b 准入门"无 verifier 命令保持 internal"，那些本就不该走 app 路径。设计应交叉引用 M0b 依赖：M0c-2 amount/recipient/outpoint 精判 gated on 该命令 typed-intent 化。

## 判据

GREEN-with-1-MUST-FIX+2-note：evaluator 架构（单调合成/fail-closed/路径隔离）成立，可连 MUST-FIX+note 进修订送 Bettor 方向审。MUST-FIX（verify-value-source 焊死"验的值==执行的值"）是 scope evaluator 立身之本，必须在设计写死 + 落码 diff 审逐维度核。落码后我 diff 审（抽取字段==执行字段 + 逐维度 fail-closed + 单调合成）+ 实战 harness（§5 越 scope 真发验拒），两道过才算 M0c-2 闭。

**关联**：`docs/2026-07-23-m0c-2-scope-evaluator-design.md`（审对象）、`docs/2026-07-23-m0c-1-caller-identity-default-deny-design.md`（§4.1 TOCTOU frozen canonical/§5 AuthResult）、`docs/2026-07-22-NWT-redteam-m1-2-threat-model.md`（M1-8 身份≠授权）。
