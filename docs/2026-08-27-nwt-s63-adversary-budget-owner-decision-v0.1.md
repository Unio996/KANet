# §6-3 (d) 对手预算 `B_adv` — Owner 决策对象 v0.1（一页 · 不依赖同步数据）

> 作者 NWT · 2026-08-27 · 派工 Bettor · **Codex §5 剩余 open 里唯一不依赖同步数据的一项**（"adversarial budget/cap policy"，Codex 283 `1c7188e2`）。**非菜单**——写"须具名什么 / 我们建议什么 / 不定则什么"，由 Bettor 精炼一句上报。**本稿零操作效果**（Tier-2 结构性禁用：无码/无 covenant/无开关；见门现状 v3）。

## ① Owner 须具名什么
(d) 入场闸的诚实算力地板 `H_floor_honest_lb = H_floor_total_lb × (1 − s_adv_cap)` 里，`s_adv_cap`（对手份额上界）**只有两条造 cap 的路，都要 Owner 具名一个量**：
- **(b) 自持路** 需 **`B_adv`**（= `H_hidden_ub` = `H_adv_add`，**单一预算**，单位 **算力**）。语义（Codex 280 `d7fefb58` / 281 `95d7f354` / 283 口径）= **保护窗内可缺席于「窗均值可见估计」、后变有效的【全部】对手容量/工作之上界**（含窗后段才上线被窗均值摊薄的公开算力）。默认同喂 (b) 份额 cap 与第 3 步 `k_max` 增量（(23) v0.15 `2f632c91`）。
- **(a-total) 经济路** 需 **`H_adv_cap`**（对手算力上界，CAPEX/身份独立论证）⇒ `s_adv_cap = min(1, H_adv_cap/H_total_lb)`。
- 🔴 二者**不是数据能测的量**——是 Owner 的**对抗容量假设**（对手可控量不能在良性网上实测封顶，memory `reference-a-bound-on-an-adversary-controlled-quantity-cannot-be-measured-on-a-benign-network`）。`H_total_lb` 由 (21) 三法 min 测；`B_adv`/`H_adv_cap` 由 Owner 给。

## ② 不具名的后果
两路皆无具名量 ⇒ `s_adv_cap` 无来源 ⇒ **(b) 与 (a-total) 都不出 cap ⇒ Tier-2 fail-closed（门关着）**。🔴 **这不是坏结果**——是**安全的现状**：Tier-2 本就结构性禁用，fail-closed = 无害缺省。

## ③ 我们的建议（一个明确姿态，非菜单）
🔴 **建议 Owner【现在不钉硬 `B_adv` 数】，理由是钉了也白钉、且弱假设有害**：
1. **现网 mechanism 已把门关死，与 `B_adv` 无关**：TN12 单矿工 ⇒ 对方 `s_self ≈ 0`、`s_visible_max ≈ 1`（(24) s_visible_max 提取器）⇒ 其份额 cap = 1 ⇒ fair-exchange **两侧都要 cap 成立**、一侧给不了 ⇒ **现网 Tier-2 关（(23) v0.6 结论）**。**任何 `B_adv` 取值都不改变这个"关"**。
2. **近空网上钉硬数 = 弱信任假设（Codex 反复警告）**：Codex 267/275（`eb4db39c`/`f65c1fbe`）原句意 —— "'1000× current hash' may still be operationally cheap on a nearly empty network, so the assumption is weak exactly where the protocol would rely on it most"。**现在拍一个 `B_adv` 数 = 在最不该信的地方立信任假设。**
3. **(21) CAPEX 表 `H_adv_implied` 只作对照、非闸**（(21) v0.7 `ce708127`）：它是攻击负担的**偏高/参考值**，**不可当安全下界**；给 Owner 定 `B_adv` 时看 CAPEX 量级，但不是把它当 cap。

⇒ **建议 Owner 决策 = 记录一条政策，而非一个数**：
- **(Y1)** 认可 **fail-closed 缺省对现网正确**（不具名 = 门关 = 安全）；
- **(Y2)** 定 **`B_adv` 语义 = 单一预算**（默认 `H_hidden_ub = H_adv_add = B_adv`）+ **复核触发条件**（下面 ⑤），把"何时该重议"钉死；
- **(Y3)** **硬 `B_adv` 值 = 推迟到 Tier-2 真 build 时、在【实测算力基线】下拍**（须等同步后 (21) `H_total_lb` + 真第二矿工/多矿工出现，才有可信基线；现在拍 = 假精度）。
- **(Y4)（可选）** Owner 若要一条**决策-记录占位值**（不空着），它**必须带标签"零操作效果 + Tier-2 build 时按实测基线重申"**——占位不 arm 任何东西（无门可 arm）。

## ④ 拆开 `H_hidden_ub ≠ H_adv_add`
默认**不拆**（单一 `B_adv`）。若 Owner 要拆（份额 cap 用的 hidden 上界 < pump 增量）⇒ **须论证"提前开机扣块不可行"** + **机械守卫 `H_hidden_ub ≥ H_adv_add`**（堵 `H_hidden_ub=0` 配大 `H_adv_add` 的 backdoor，(23) v0.15 §8）。**建议默认不拆。**

## ⑤ 与三决的关系 + 复核触发
- 这是 **Owner 第四件待决**，但**可与 watchdog v0.3 批一起回**（都非紧急、非同步依赖）。
- 🔴 **复核触发条件（建议钉死）**：**(a)** 网络出现**第二个独立矿工**（`s_visible_max` 掉出 ≈1）；**或 (b)** `s_visible_max < X`（X 待 Owner 定，如 0.9）；**或 (c)** Tier-2 进入真 build（fair-exchange covenant 落码前）——**任一触发 ⇒ 用实测基线重议 `B_adv`**。触发前 fail-closed 缺省持续。

## ⑥ 引用锚
Codex：`RESPONSE-…MSG280/281/283`（bridge `d7fefb58`/`95d7f354`/`1c7188e2`）；`MSG273-274 eb4db39c` / `MSG275-276 f65c1fbe`（k_max 弱假设警告）。本仓：(23) v0.13 `9040b8ec` / v0.15 `2f632c91`（`B_adv` 语义 + 单一预算 + 守卫 + s_adv_cap 两路）；(21) v0.7 `ce708127`（`H_adv_implied` 非安全下界）；(24) s_visible_max 提取器 `docs/provenance/2026-08-27-smax/`；门现状 v3（Tier-2 结构性禁用）。memory `reference-a-bound-on-an-adversary-controlled-quantity-cannot-be-measured-on-a-benign-network` / `reference-an-assumption-parameter-needs-a-mechanical-data-bound-or-it-is-a-dial`。

## 一句给 Owner（Bettor 精炼用）
**`B_adv`（对手预算，(d) 入场闸唯一非同步待决）现在不必拍数：现网单矿工已 fail-closed（安全）、近空网拍硬数=弱假设有害；建议只定"单一预算语义 + 不拆 + 复核触发（第二矿工/`s_visible_max`掉/Tier-2 build）"，硬值等实测基线再拍；可与 watchdog v0.3 一批回。**
