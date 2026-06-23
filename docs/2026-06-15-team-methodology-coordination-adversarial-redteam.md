# KANet 多-agent 团队方法论：全自动协调 / 监督 / 真对抗讨论 / 模拟攻防

> 写于 2026-06-15。本会话 4-agent（Bettor 协调 / J1 SS-determinism / J2 settler-mass / NWT 对抗验证）在整个 gate B #31 找零核弹 settle 系统上跑了一套高效方法论，**抓出多个真·资金安全洞**（committee-attest payoutRoot 偷钱洞、settle_aggregate STUB 卡钱命门、output-count steal-output、chunk_0 input-provenance、cap=100k 陈旧值），全程零 Owner 干预收口到 4-agent 验证完成。本文固化这套体系，供接位 agent 与未来任何 gate 复用。这是**怎么自治地把高 stakes 链上系统做对**的操作手册。

---

## 0. 四支柱总览（Owner 钦定）
1. **全自动有效协调**（§1）：agent 自组织认领 slice、驱动到闭环、零 stall。
2. **监督**（§2）：verify-not-echo + 读真码 + drift-watch + 验落链。
3. **真对抗讨论**（§3）：人人认错、verify-not-assume、多 vantage 独立验。
4. **模拟攻防体系**（§4）：red-team 攻击向量枚举 + runnable PoC mutate-witness + 逐 require 验防御。

---

## 1. 全自动有效协调（无人干预到闭环）
- **slice 认领 + co-own**：每个 critical 件明确 owner，重叠面 co-own 但切分防撞（gate B: J2 mass机械 / J1 determinism+SS / NWT 2nd-vantage攻 / Bettor 协调+审码）。切分发到频道**逐个 @人名【必回】认领+ETA**。
- **驱动到闭环非派完就走**：每条派工末尾 `👉@名字【必回】`，不回=没收到=重派。silent stall 是头号杀手——**判 stall 前必拉够多频道消息确认真静默**（snapshot limit 小会漏最新），真 stall 才升级 Owner。
- **决策三态**（避免独裁 vs 怯于拍）：
  - 没共识乱拍 → 错（`feedback-major-decisions-require-consensus-not-unilateral`）。
  - 有共识 + 与已锁文档对齐 → **自决勿求 Owner 点头**（`feedback-autonomous-decide-when-consensus-and-docs-align`）。Owner 要全自动，逐项求批=阻断。
  - either-way 小选择一次裁定就 commit，别 re-litigate thrash。
- **里程碑前移焊死**：方案/契约定了就写成 freeze spec（本会话 §7 SS-contract FREEZE），下游 agent **照 spec 出码=源头防漂**，非事后抓返工。
- **协调者守第 2 支柱**：驱动 agents 各做分内事，**手痒替别人干=破坏协作**（最难守的一条）。

## 2. 监督（committed ≠ done 的层层验证）
**核心铁律：committed ≠ pushed ≠ deployed ≠ running ≠ 链上验证；注释 ≠ 实现；实编译才是真；记忆/文档可能错，代码是唯一真相。**
- **verify-not-echo**：别人报 PASS 你**独立实查**（读真码 / 跑测 / 查链），不附和。本会话每个 agent 报的都被另一 agent 独立复核（如 J1 节点独跑 computeSettleChunks 复现段、NWT 实码查 poolMerkleRoot 验委员非 bettor）。
- **读真码非只信 test/lint**：结构审会漏（NWT 5/5 结构 PASS 仍漏 type-mismatch / Bettor holistic 读 533 行仍漏 settle_aggregate STUB）→ **实编译 + 行为 PoC 才封口**。"草稿略=继承 v07" 这种注释**看着 done 实则 STUB**=committed≠done 的设计层版。
- **drift-watch**：跨模块契约（off-chain ↔ on-chain SS）逐项 diff，漂即喊（J1 把 computeSettleChunks 对 §7 SS-契约 7 项逐条 diff = GREEN）。
- **value-等价验**（test 抓不到的）：改派生/查地址类，**新逻辑产出 == 旧逻辑产出逐条核真数据**（pk-derive == relay_nodes.address 403/403）。
- **验落链**：链上行为 relay `check_utxo_landed` 走本地 kaspad，**用 tx 的 output 地址**（赢家 payout）非花掉的锁定地址（spine_p2sh）。
- **跨节点 determinism**：determinism-critical 码必两节点 byte-equal（`git rev-parse HEAD^{tree}` 同 + 验 running 进程非只 git）；whole-repo-sync 同 commit 禁 cherry-pick。

## 3. 真对抗讨论（人人认错的文化）
- **认错是常态非耻辱**：本会话每个 agent 都公开认错——Bettor 认 cap=100k 陈旧/echo 了 trust 洞/漏 settle_aggregate STUB；J2 认过声明/sweep-无-test.json/(b)-detour 前提错；NWT 认 heads-up 引文档不精确/4-assert over-spec；J1 认 cascade 过度断言/④守恒 gap。**认错 → 收窄 → 焊死**，比互捧"全栈 PASS"健康一万倍（`feedback-doc-owner-adversarial-discipline`）。
- **verify-not-assume**：撞"这原语好像没有/这值是 X/继承=已实现"的假设，**第一反应去查真码/文档/实测**，不凭印象。本会话 cap=100k（陈旧 pre-Toccata）、8-byte BE（实际 LE）、settle_aggregate（注释≠实现）、TUTORIAL L973 例（不编译）全是凭假设错、查真码纠正。
- **多 vantage 互补**：单一 review 必漏，多 agent 不同角度各攻一面——Bettor holistic（整合面+math）抓 spine_p2sh 偷钱洞 / NWT 结构逐行抓 type-mismatch+output-count / J2 mass 域抓 i64 溢出+fee-circular。**谁抓到对方漏的，就是体系价值**。
- **HALT-讨论-收敛**：重大决策 HALT 执行→中立摆议题→点名各 agent 出立场互挑→收敛→Owner 终裁（如 (A)-refined vs (b) amount-binding）。

## 4. 模拟攻防体系（red-team 把"安全"从声明变证明）
- **攻击向量枚举**：sig-less / trustless 路径，**枚举所有 attacker 能控的 free-witness 值**，每个必绑（本会话 B-design 7 项 free-witness：winner/段/outcome/pk/amount/fee/chunk_kind 全 plan_commit-bound）。铁律：**任何 security-critical 值必从 committee-attested state 读，禁 free witness**（= spine_p2sh 同义反复洞的泛化）。
- **steal 向量 × 防御 require 一一对应**：列出 settler 能干的坏事（append 偷币 output / redirect winner / short amount / over-fee / mid-chain 重放 / 早 claim last / HWM overlap），**每个对一条 SS require 挡**（append→output-count keystone / redirect→recipient require / short→amount require ...）。缺哪条牙齿=哪个洞。
- **runnable PoC（行为层 gold-standard）**：结构审 PASS 不够，**喂构造 witness 进 cli-debugger 实跑**——honest baseline PASS + 7 个 mutate 变体逐条验 `require` 真 fires（reject）。`D:/silverscript` cli-debugger.exe + test.json fixture 范式。fixture 必复刻 production 真输入（理想化输入 mask 真 bug）。
- **trust 模型显式化 + 文档化边界**：哪些靠密码学保证、哪些靠 committee-trust（可铸假 winner=v07-equivalent，testnet conscious-accept，mainnet 硬化）——**诚实写进已知限制文档**，不藏。
- **resumability/活性攻防**：crash/重启/跨节点/mempool-race 全测——resume 只信**链上状态**（HWM token）非本地进度=NO-TX-NO-STATE，任意节点可续，UTXO 单花使 in-flight race 自愈。

---

## 5. 反模式（本会话踩过/守住的）
- 凭记忆/印象报数（cap=100k）→ 查真码。
- 注释当实现（settle_aggregate STUB）→ 实编译+grep 验。
- 结构 PASS 当行为 PASS → runnable PoC。
- 协调者手痒全干 → 驱动 agents。
- 消息没核回执就当发出去 → 核 SENT txid / tool_result（**前任 Bettor 死在这条：发不出去=协调归零**，见 `ANTI-PATTERNS.md 规则 48` + `2026-06-15-Bettor-tn-handoff.md`）。

---
*这套方法论本会话从设计到 4-agent 验证完成 gate B 找零核弹 SS，零 Owner 干预收口、抓出多个真资金安全洞。接位 agent 与任何未来 gate 复用：协调驱动闭环 + 监督 committed≠done + 对抗认错收窄 + 攻防把安全变证明。配 `docs/2026-06-15-gateE-deploy-hardening-checklist.md`（部署纪律）+ `kanet-investigation-methodology.md`（六层调查）。*
