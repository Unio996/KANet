# NWT 红队 — §6-3 gate (d) P3 fee-source v0.1

> 作者 NWT · 2026-08-27 · 派工 Bettor (18) · 被审 = `docs/2026-08-27-j2-s63-gate-d-p3-fee-source-v0.1.md`（**1e350702**，未推）
> Bettor 点名承重：① "十支零 OpTxInputCount ⇒ 任一笔可加普通费输入"（去 v0.15 真源核）；四条硬结论（费不足先死=claim 唯一本金损失 / 拥塞二值单列 sompi / (a) 死区略大有害 / (b) 倾向站不站）。
> **总评：结构层站得住——承重等价【成立】（我核到下一层：全 introspection 按调用方给的索引、v0.15 零处全输入聚合）；四硬结论三条 SOUND，H4 (b) 倾向的【理由】一边倒须纠。= GREEN-WITH-NOTES。**

## 1 · 承重①：等价性核到 Bettor 要的下一层 —— ✅ 成立（不只是"没写 OpTxInputCount"）
- **v0.15 真源 = 设计稿伪码**（`docs/2026-08-21-j1-s6-3-A-covenant-construction-v0.15.md`，无对应 .sil = (b)(h) OPEN 之因）。我 grep：`OpTxInputCount`=0、`tx.inputs.length`=0；唯一命中 L371 是能力表列 `OpCovInputCount`（可用原语，非任何支的 require）。
- 🔴 **下一层（Bettor 问的等价性）：没写输入数约束 ⇔ 可加普通费输入,【真等价】,因为**:
  - **全 introspection 按【调用方给的索引】**：ShardLeaf.sil 先例 `OpInputCovenantId(psInIdx)`（`psInIdx` = int 参数，"真 PayoutShard input 位"）；v0.15 各支同款（`C_in_idx`/`O_in_idx`/`oauth_in_idx`/`payout_idx`/`O_out_idx`）。调用方点哪个位、covenant 只验那个位有对的 cov_id ⇒ **普通费输入放在未被点的位 = 透明**。
  - **零处【全输入聚合】**：我 grep v0.15 "sum over input / 所有输入 / value 守恒" = **空**。守恒（如 ShardLeaf `tx.outputs[psOutIdx].value == tx.inputs[psInIdx].value + pool_value`）是**按位**、不是 Σ 全输入 ⇒ 加一个别的位的输入不动它。
  - **逐输入脚本模型**：每 covenant 输入跑自己脚本（按给的 idx 交叉验对方 co-input）；普通 P2PK 费输入跑自己 sig 校验，独立。**无隐含输入数约束**（`OpCovInputCount` 存在但零支用它）。
  - ⚠ 唯一 nuance（不改结论）：因索引是调用方给的、covenant 只验它被指到的输入 ⇒ 等价的确切表述是"**普通(非 covenant)费输入透明**"，不是"输入集被别的方式限死"。对 (18) 费源目的（(b) 下 claimer/WT 能否自备费）⇒ **确定 YES**。

## 2 · 四硬结论逐条打
### H1 费不足先死=claim 唯一本金损失级 —— 🟢 SOUND
- 核 v0.15 十支：**T5 claim 唯一同时【有 DAA 截止(须 O_daa+N 前落深 20)】∧【payout 值焊死(`==OAUTH_value` @L247)不能让费】**；T6 recovery（只下界无截止 + 值自由）/T4 reveal（v0.8 删上界 + P_F payout 值自由）/T7-9（无截止 + 值自由）**全是"费不足=晚一点"**，本金持有者加费重发即可。✅ 且与 first-mover-with-mining 同向（claim 落不了 ⇒ recovery 得利 ⇒ P_F）。**无第二条同时满足两条件的支**（我逐支核过）。

### H2 拥塞二值非时延 ⇒ 单列 sompi 域不被 DAA 吸收 —— 🟢 SOUND（一处须补精度）
- **域逻辑对**：费不足 = 二值失败（进不了 mempool = 永不落链），非时延方差；把它折进 DAA 域 `M_congest` = 错域（CFG-UNIT-DOMAIN 族）。⇒ 单列 sompi 域 `F_claim_reserve`/`F_reveal_reserve`、不许被 DAA 项吸收。✅
- 🔵 **须补精度**："二值 not 时延"**只对【下限】(`minimum_relay_transaction_fee` 地板)成立**。我核 mempool：`feerate_key.rs` 是**区块模板选择**（feerate 优先，:30/:90"select for block templates"）非驱逐 ⇒ **地板之上、拥塞时低 feerate tx 会【等】（时延）**。所以费面有两态：**(i) 低于地板=二值永不落（sompi 域，对）；(ii) 地板之上+拥塞=feerate 时延**。J2 §3"二值"对态 (i)；态 (ii) 存在但 J2 §3 已把**对抗性拥塞→审查→bounded-inclusion 之外**、良性 TN12 拥塞可忽略。⇒ 结论不变，但 §3 那句"费不够=二值不是时延"该加限定"（指地板；拥塞 feerate 时延态 → bounded-inclusion）"。

### H3 (a) 死区 [费,费+2e6) 略大有害 —— 🟢 算术 SOUND，但危害是【效率】不是【封锁】，须与 §2 结构死区分
- **算术对**：storage mass `C·(Σ_out 1/v − Σ_in 1/v)`（`mass/mod.rs:441` `max(0,C(|O|/H(O)−|I|/A(I))`），`C=1e12`（`constants.rs:25` 非 config）；找零 <2e6 ⇒ `C/change > 5e5 = storage 上限` ⇒ tx 无效。死区 [费,费+2e6) 成立，"过大无害/略大有害"对。✅
- 🔴 **但危害级别 J2 未分清**：死区**不是 claim 封锁**——P_R 永远可**零找零**（|O|=1 走松弛路 `mass/mod.rs:460-467`，费=O.value，把超出捐给矿工）⇒ **总能 claim，只损失 ≤2e6 可回收超额 = 效率**。这与 §2 的**结构死**（`F > min_O` ⇒ 连零找零都不够 ⇒ (a) 下不能加输入自救 ⇒ 真封锁 = 本金损失级）是**两个不同危害**。J2 §5/§2 该显式分："死区=效率损(≤2e6)；`F>min_O`=结构死(本金级)"。两者都推向 (b)，但级别不同。

### H4 J2 倾向 (b)，理由"WT 无法自带费" —— 🔴 结论可接受，但【理由一边倒且符号反了】
- **(b) 的真优点**（成立）：任一有钱方可**救**欠费 claim（加费输入）；(a) 下欠费**谁都救不了**（输入数锁死，含 WT）⇒ 韧性 (b) 胜。
- 🔴 **但 J2 "(a) 零本钱可 claim 在 watchtower 方案下反而负担(WT 无法自带费)" 符号反了**：(a) 下费出自 O（P_F 预付）⇒ **WT 提交零本钱**（payout 焊给 P_R、WT 本就利他）⇒ **(a) 对 WT 参与是【利】**（利他成本=0）；(b) 下 WT 须自带费才能替 P_R 提交 = **参与门槛**。⇒ 真权衡 = **[抗欠费韧性→(b)] vs [零本钱 WT 参与→(a)]**，谁胜取决于 **O 欠费概率**（mass 规则漂移，§5① 未测前未知）。**J2 用 watchtower 论证支持 (b) 是反的——那条维度其实偏 (a)。**
- ⇒ **裁**：(b) 的**净倾向可接受**（韧性 + 无结构死，§2），但**须作为真权衡呈给 Owner/Codex，不是靠 watchtower 论证拍**；把 §6 那句 watchtower 理由**删或改**（它偏 (a) 不偏 (b)）。第三选项 (a') "只准 O+OAUTH+claimer自己的费输入" 不可表达（covenant 验不了额外输入的归属）⇒ 确是 (a) vs (b)。

## 3 · 坐标与 7b1e18cc 作用域（Bettor ②③）—— ✅
- 我核：storage 公式 `mass/mod.rs:430-478`（松弛路 `:460-467 |O|=1 or |I|=1 or |O|=|I|=2`）+ compute `mass/mod.rs:334-360`（`size×mass_per_tx_byte + Σspk×mass_per_spk_byte + Σcompute_budget`）**逐字对上** J2 §4/§5；`STORAGE_MASS_PARAMETER=1e12 @constants.rs:25`（J2 正确标"无 config/ 的那个"=对，我 §1 独立踩过这坑）；`DEFAULT_MINIMUM_RELAY_TRANSACTION_FEE=1000 @config.rs:19`。
- **③ scope**：全文 `7b1e18cc` 虽只显式 2 次，但 §4 表头 + 坐标纪律行覆盖全表 @7b1e18cc；唯一跨版本敏感的 `constants.rs`（两个孪生）J2 已显式标对。**其余 mass/mempool 文件 90dbf074↔7b1e18cc 我未逐一 diff**（非 covenant 域、7b1e18cc 主要加 covenant，低风险）——建议 J2 落 P3 真形状时对 mass 单价再 `git show 7b1e18cc:` 确认一次（同 (c) 纪律）。

## 4 · 交付判词
- **P3 fee-source v0.1（1e350702）= GREEN-WITH-NOTES（结构层，零落码）。** 承重等价【成立】（核到"按索引 introspection + 零全输入聚合"下一层）；H1/H2/H3 SOUND；坐标对得上。
- **三条须改（收敛式）**：① H2 §3"二值"加限定（指地板；拥塞 feerate 时延态存在、归 bounded-inclusion）；② H3 分清"死区=效率损≤2e6"vs"F>min_O=结构死本金级"；③ 🔴 **H4 删/改 watchtower 支持 (b) 的理由（符号反了，那维度偏 (a)）**，(a)/(b) 作真权衡呈 Owner/Codex，净倾向 (b) 保留但换论据（韧性+无结构死，非 WT-自带费）。
- **GREEN 边界**：= 费源结构闭合、每支费从哪出/谁先死/在不在 N_margin 钉死；**≠ 数**（F_* 全 PLACEHOLDER 待 P3 真形状）、**≠ (a)/(b) 定**（Owner/Codex 决，改 v0.15 正文 = 设计层）。
- 与我 (d) 主线一致：本稿把我原 (d) "min_O 前提未强制" 落成完整费源模型，H1 的"claim 唯一本金损失级"正是 first-mover-with-mining 的费面投影。
