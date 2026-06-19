# Bettor 对抗审 — Oracle 强化第一波设计（verdict + 裁决）

> 写于 2026-06-19 by Bettor-tn（协调者，Owner 授全权）。
> 审对象：J1 D-L1 judgeLine / J2 deriveVote 抽取(`docs/2026-06-19-J2-derivevote-extraction-design.md`) / NWT 源完整性管线 / UI 部署等价闸(`docs/2026-06-19-deploy-equivalence-gate-design.md`)。
> verify-not-echo：读真设计挑漏洞，非附和。

---

## 0. 总裁决：**放行第一波（带 5 条件）**

设计质量高、团队 cross-review 充分（三轴→双轴、joint-tuple→per-axis、blob→field、算术轴=码轴推论 都自己抓修了）。**5终裁 gating 核过：第一波全零新攻击面**（field-hash quorum=改现有 fetch/cache 非加活源；code-hash=无新源；judgeLine/抽取=现有 summary 端点；odds 端点正确 gated；多源 cross-check 正确标 roadmap）。**放行落码**，带下列条件。

---

## 1. 域边界裁决（合并 gate 落码 owner）

合并双轴 hash-quorum gate 落 `decideConsensusV06`（settler 共识计票路）：
- **落码 owner = J2-tn**（pool-market-settler.js 是他 settler 域文件，单写者纪律=一个文件一个 author）。J2 实现合并 gate（按 NWT 收敛语义）+ 供 field_hash 计算（他抽取输出 canonical）。
- **NWT-tn = 源轴 quorum 语义 spec + byte-equal 审这道 gate**（determinism 权威，他已认领审；read-only 不落码）。
- **KANet-UI-tn = `computeOracleCodeManifestHash()` 纯函数 + manifest 清单 + voter L382 加 code_manifest_hash 字段 + operator 诊断面（per-axis mismatch 写 events）**。
- **J1tn = judgeLine.mjs（进 manifest）+ D-L1**，闸上游不碰闸码。
- **UI 单 git 写者 commit**（J2/NWT/UI/J1 出 diff，UI 落 git）。
→ 一个函数一个 author（J2），消除两 agent 同函数打架。

## 2. 五条件（落码必带，我对抗审挖的真 gap）

**条件①·liveness 实测（最重要·我挖的硬 gap）**：双轴 gate 让"任一轴落少数→排票"，4-of-5 阈下只能容 1 票漂。源轴在 ESPN 良性抖动下（CDN 边缘/stat correction/抓取时刻差）可能让 1 个诚实委员 field-hash 落少数 → 5→4 还行；**2 个漂 → 5→3 → 整市 refund**。observe-only 阶段**必须实测良性排除率**（正常运行下源轴排票频率），非零且会实质抬高 refund → flag 委员扩容/阈值调优再 enforce。**禁裸 enforce 不带这个数。**

**条件②·observe-only 退出闸定量**：§5.1 "跑一轮确认全网同 hash"太含糊。定死退出 go/no-go = **N≥20 settle-eligible 市场 observe-only + 双轴同意率达标 + 良性排除率实测 + 零 unexplained mismatch → Bettor+NWT 审 mismatch 日志 → 才 flip enforce**。否则 observe 漂移不停 OR 过早 enforce。

**条件③·滚动升级操作约束（UI 域）**：候选 A（quorum 众数）下，settle-path manifest 文件改动若 50/50 跨节点分裂部署 → 两版本都不过 quorum → refund storm。**manifest 文件改动 = 跨节点近同步部署**（或部署窗口内退回 observe-only）。UI 把这条写进部署规程。

**条件④·field-hash 最小集**：field_hash 只 hash 抽取的原始字段（winner_side + home/away_score），**margin/total 是 judgeLine 内确定性派生不进 hash**（派生进 hash=冗余抖动面，且把 judgeLine 算术拉进源轴=越界）。J2 抽取产原始整数字段，派生留 judgeLine。

**条件⑤·嵌套副本清理谨慎**：`D:\kanet-tn12\kanet-tn12` UI 确认**真 dormant（无进程加载 + 非 worktree + 无启动脚本引用）+ 报里面是什么** 再删，别盲删（看清楚再动手铁律）。

## 3. 候选裁决
- **期望版本用候选 A（hash-quorum 众数，零治理零信任锚）**——第一波。候选 B（链锚放行版本）= mainnet backlog（治理重）。风险（>1/2 委员同污染版本洗白）超 4-of-5 信任模型边界，testnet conscious-accept。
- **闸 = 双轴（源 field-hash + 码 manifest-hash）**，算术轴=码轴 manifest 覆盖的推论非第三 hash（J1 纠正正确，采纳）。
- **NWT 三条件全采纳**（per-axis 独立 quorum 不混塌 / per-axis hash + mismatch 可归因日志 / observe-only 先行）——这三条是合并 gate 的承重，落码必守。

## 4. 各 slice 放行状态
| slice | 放行 | 条件 |
|---|---|---|
| J1 D-L1 judgeLine | ✅ 放行 | 谓词结构化 + 纯函数 + 三态；judgeLine.mjs 进 manifest；判决层零 LLM |
| J2 deriveVote 抽取 | ✅ 放行 | StructuredEvidence 原始整数字段（条件④）；title `<untrusted_question>` 隔离；spread ×100 cents 整数定点；A-ramp summary=第一波/odds=gated |
| NWT 源完整性管线 | ✅ 放行 | field-hash 升 quorum 闸（复用 evidenceHash 位）；链锚取时；shadow-harness 当毕业闸；2nd-pass 审 |
| UI 部署等价闸 | ✅ 放行 | 双轴合并 gate（J2 落码）；manifest 精确清单；observe-only（条件②）；滚动升级约束（条件③） |

## 5. 仍 GATED（不在第一波，待 Owner 显式批）
- **新活源进 settle**：odds 端点（betting line）、任何非 summary 端点。
- **多源 cross-check 进 settle**（异 provenance 源 field-hash 必一致）= 防"全体同源污染"的唯一解，但 5终裁明确需真对抗设计 + Owner 批 + 冻结快照。标 roadmap。

## 6. 落码顺序（放行后）
1. **J1**：judgeLine.mjs 纯函数 + 确定性 test（byte-equal/abstain/定点边界/op 全覆盖）优先。
2. **J2**：extractEspnEvidence 增产 StructuredEvidence（原始字段）+ field_hash + title 隔离 + canonical prompt。
3. **UI**：computeOracleCodeManifestHash() + voter 加字段（additive）+ manifest 清单 + operator 诊断面。
4. **J2**：decideConsensusV06 合并双轴 gate（observe-only 模式起步），**NWT byte-equal 审**。
5. 各自落码 diff 贴频道 → NWT byte-equal 审 + 我抽审 → UI commit → observe-only 跑 → 条件①②达标 → enforce。
