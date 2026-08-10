# U1 密钥隔离回退 Runbook v0.1

> **Status**: CURRENT

**Author**: KANet-UI · **日期**: 2026-08-10
**授权范围/定位**: Bettor 13:30Z 派工("走(a)")——本文档本身**不授权任何施工**，也不是本次要执行的动作；它是 D-012 U1 密钥隔离**正向施工窗排期的前置条件**（"有退路才敢往前走"）。正向施工（建域 2/3/4）待本稿过 NWT 快审后另排窗，且与本稿描述的回退动作**不同窗**执行。
**基于**: `docs/2026-08-07-u1-path-isolation-scoping-v0.1.md` §11（scoping 级设计，含 §11.2 步骤清单本身，2026-08-10 NWT 07:19Z MUST-FIX 后已把 is_oracle 原子归零钉成 step 1）——本稿把那份 scoping 的散文步骤改写成逐条可执行的命令+阻塞式验证，不改变已裁定的设计本身。
**触发条件**（本 runbook 何时被执行，不是本稿现在执行）：Bettor 或 Owner 拍板"回退隔离拓扑"这个决定之后，由持有相应数据库/relay 访问权限的 operator（今天是 KANet-UI）执行。**本稿不预设这个决定已经发生。**

---

## §0 前置依赖（本 runbook 现在就要如实标：有一项还不存在）

1. 🔴 **域→relay-ID 映射记录尚不存在**——因为域 2/3/4 尚未建成（正向施工还没排窗）。本 runbook 的每一步都需要"哪些 relay ID 属于要退役的域"这份清单，**这份清单必须在正向施工时就生成并留档**（建议：施工 runbook 第一步就把每个域分配到的 relay ID 写入一份带时间戳的记录，本回退 runbook 才有输入）。**本稿在此明确记一笔依赖，不是缺陷，是施工 runbook 必须回填的一项。**
2. `relay_nodes.is_oracle`（INTEGER 列，现读：10 行 =1，22 行 =0）是本稿唯一操作的字段。写法：`UPDATE relay_nodes SET is_oracle = ?, updated_at = datetime('now') WHERE id = ?`。
3. `pool_committee.committee_relay_ids`（TEXT 列，存 JSON 数组）是判断"某 relay 是否被存量市场引用"的唯一权威源。现读：255 行（覆盖 255 个不同市场，与判据 B 的分母一致）。
4. 判定"市场是否已终态"复用本仓**既有**权威定义（不新造）：`kasia-console/src/services/preprune-capture-worker.mjs:29` 的 `TERMINAL_STATUSES = new Set(['cancelled', 'refunded', 'completed', 'settle_failed', 'zk_settled'])`（该定义本身经过 NWT 红队 MUST-FIX，`docs/2026-07-18-NWT-redteam-k17-preprune-capture-worker-diff-verdict.md`）。
   🔴 **一处未解的分歧，交 NWT 快审时定**：`pool_markets.protocol_status` 现读还有 `archived`（321 行）、`pruned_expired_waived`（140 行）两个状态，**不在**上述 TERMINAL_STATUSES 集合里。本稿配套脚本（见 §2）对这两类状态**保守处理为"非终态"**（即：只被这两类市场引用的 relay 会被报成 REFERENCED_ACTIVE，而不是直接判安全）。**这是本稿唯一一处需要 NWT/settle-daemon 域主人拍板的判断**，拍板前不得把这两类市场当"安全可忽略"处理。

---

## §1 步骤清单（对齐 scoping §11.2，逐条改写为可执行动作 + 阻塞式验证）

### Step 0：决定 + 冻结（运维动作，非代码）
- 前置：回退决定已由 Bettor/Owner 拍板（本稿不代为决定）。
- 冻结：暂停"新建市场"这个动作的触发路径（具体挂起哪个 cron/tick 由当时值班的 operator 现查，本稿不预设固定路径名，因为它可能随主线迭代改名——**执行时先跑 `grep -rn "pool_markets.*INSERT\|createMarket" kasia-console/src` 现查当时的创建入口，不要用记忆里的函数名**）。
  - 若无法冻结（创建路径分散/无法一键挂起）：**接受该竞态窗口**，但必须把 step 1 的执行速度放在第一位——step 1 是原子归零，执行本身是一次 DB UPDATE，秒级完成，竞态窗口被压缩到最小，而不是消除。

### Step 1（原子）：域内全部 relay 的 `is_oracle` 归零 + 停止新分配（同一动作）
```sql
-- <relay_id_list> 替换为 §0.1 那份域→relay-ID 映射清单里，本次要退役的域的全部 relay id
UPDATE relay_nodes
   SET is_oracle = 0, updated_at = datetime('now')
 WHERE id IN (<relay_id_list>);
```
**阻塞式验证（不通过不得进 step 2）**：
```sql
SELECT id, name, is_oracle FROM relay_nodes WHERE id IN (<relay_id_list>);
```
每一行 `is_oracle` 必须为 `0`。任何一行不是 → STOP，不得继续，现查为何 UPDATE 未生效（连接到了错误的库？WHERE 子句 id 拼错？）后重跑本步骤，不得跳过验证直接进 step 2。

🔵 **"停止新分配"不是第二个动作**：本仓 `trade-protocol-filter.js:578-580` 按 `WHERE is_oracle=1` 选取参与签名/被 VRF 抽样进新委员会的身份池（`pool_committee` 的 VRF stake-weighted 抽样，见 `migrate.js` v159 注释），这是一条**通用资格查询**。Step 1 归零之后，域内 relay **自动**不再进入任何新市场的候选池——不需要另开一个"停止分配"的开关或配置项。**这一点在 scoping §11.2 原文里是两个并列步骤，本稿现读代码后合并成一步，理由记于此。**

### Step 2：（无独立动作——见 Step 1 结尾说明）
scoping §11.2 原 step 2（"在保留宿主为后续新市场生成全新密钥集"）也不是本回退 runbook 需要执行的动作：新市场的委员抽样本来就只从 `is_oracle=1` 的池子里选，Step 1 完成后该池子已经不含退役域的 relay，域 1（保留宿主）上现有的 `is_oracle=1` relay 自动成为新市场唯一候选源。**不需要额外生成"专门用于后续新市场"的密钥——除非域 1 现有 relay 数量不足以支撑委员会规模（5 选 threshold=4），那是运维容量问题，不是本 runbook 的回退步骤，另案处理。**

### Step 3：清点"从未被引用"的库存密钥（可直接废弃）+ Step 4：清点"仍被在飞市场引用"的密钥（须等结清）
两步用同一份现场核实，机械执行：
```bash
cd D:\kanet-tn12\kasia-console
node ../scripts/u1-rollback-referenced-markets-check.mjs <relayId1> <relayId2> ...
```
（脚本：`scripts/u1-rollback-referenced-markets-check.mjs`，只读、零写入、零链上调用，逐个 relay 输出三态之一：`NEVER_REFERENCED` / `REFERENCED_TERMINAL` / `REFERENCED_ACTIVE`，后者附带具体市场 ID + 当前 `protocol_status`。已现场跑通，见 §2 现场证据。）

- 输出 `NEVER_REFERENCED` 或 `REFERENCED_TERMINAL` 的 relay：对应 Step 3——库存密钥对可直接废弃（从未落链或引用它的市场已终态，无外部依赖）。
- 输出 `REFERENCED_ACTIVE` 的 relay：对应 Step 4——**该 relay 所在的宿主必须继续保留、继续运行**，直到脚本对该 relay 的下一次运行不再报 `REFERENCED_ACTIVE`（即所有引用它的市场都转入 `TERMINAL_STATUSES`）。**不得因为"决定回退"就提前下线这台宿主**——参照 §11.4（scoping 原文）liveness 约束，提前下线 = 人为制造该市场永久凑不齐 threshold 的故障，不是回退的正常代价，是操作失误。

**阻塞式验证（每次准备退役一台宿主前必跑，不得凭记忆判断"应该都结清了"）**：对该宿主名下**全部** relay ID 重跑一次上述脚本，全部输出 `NEVER_REFERENCED` 或 `REFERENCED_TERMINAL` 才能进 Step 5。

### Step 5：宿主退役
在 Step 3/4 的阻塞验证对该宿主名下全部 relay 都通过后：
1. 该宿主可以物理/运维层面退役（关机/转作他用/回收）。
2. `relay_nodes` 表按当时现状更新（现有机制，`is_oracle` 已在 Step 1 归零，此处不重复）。
3. **不做**：不需要额外的"密钥销毁"仪式性步骤——`is_oracle=0` 已经让这些身份不再具备签名资格；私钥数据留存与否是该宿主自身的存储处置问题，超出本 runbook 范围（若该宿主本身要物理销毁/转让，安全擦除私钥是另一份独立的硬件处置 SOP，本稿不代写）。

---

## §2 现场证据（本 runbook 起草时用真实空跑数据核过脚本本身，非纸面设计）

```
$ cd D:\kanet-tn12\kasia-console && node ../scripts/u1-rollback-referenced-markets-check.mjs 8f104e2d-646d-47cd-81f6-97a16b4f6c01 4094a133-84a2-48b1-890d-db20d20d9bea nonexistent-relay-id-test

⚠ WARNING: archived=321, pruned_expired_waived=140 rows exist in pool_markets under statuses NOT
in the canonical TERMINAL_STATUSES set imported from preprune-capture-worker.mjs. ...

Checked 3 relay(s) against 255 committee row(s) covering 255 distinct market(s).

[NEVER_REFERENCED]    8f104e2d-646d-47cd-81f6-97a16b4f6c01
[NEVER_REFERENCED]    4094a133-84a2-48b1-890d-db20d20d9bea
[NEVER_REFERENCED]    nonexistent-relay-id-test

RESULT: no relay is REFERENCED_ACTIVE. All are NEVER_REFERENCED or REFERENCED_TERMINAL -- safe to
proceed to §11.2 step 3/5 for these relay IDs.
```
（这两个 relay ID 是本机现存 `is_oracle=1` 的两个真实身份，不是域 2/3/4 的 relay——域还不存在。本次空跑只验证脚本本身逻辑正确，不代表任何回退判断，也不构成本次的回退决定。零写入：只跑了 `SELECT`，未触碰 `relay_nodes`/`pool_committee`/`pool_markets` 任何一行。）

---

## §3 与 scoping §11 其余小节的关系（不重复设计）

- §11.1（回退范围界定：只影响未来新建市场，不追溯存量市场的委员会构成）、§11.3（搬钥匙 vs 弃钥匙重铸的张力，本稿延续"弃旧钥匙、只对未来市场重铸"路径，即本稿 Step 1-2 已经隐含的选择）、§11.5（时间量级：Step 1-2 本身是秒级 DB 写入，Step 3-5 的"完全收尾"时长取决于当时在飞市场结算周期分布，本稿不重复估计）、§11.6（不算成本的部分）——均维持 scoping 文档原文，本 runbook 不重写，只在此处指路。

## §4 明确留白 / 本稿不代答
1. **谁有权拍"现在回退"这个决定**——本稿假设是 Bettor/Owner，不代为裁定。
2. **域→relay-ID 映射记录的具体格式与存放位置**——留给正向施工 runbook 第一步产出，本稿只声明这是依赖（§0.1）。
3. **archived/pruned_expired_waived 两类市场状态是否该并入 TERMINAL_STATUSES**——§0.4 已标记，等 NWT 快审时定，定了就更新 `u1-rollback-referenced-markets-check.mjs` 里的引用（不新造一份独立定义，改动应该发生在 preprune-capture-worker.mjs 的权威定义处，本脚本自动跟着受益，这是"单一权威源"原则的应用）。

**本稿到此为可执行 runbook v0.1，等 NWT 快审，过审后作为正向施工窗排期的前置条件之一。**
