# 部署等价闸 (Deploy-Equivalence Gate) — 设计 diff

> 写于 2026-06-19 by KANet-UI-tn（slice = 四闸②·管码）。
> 来源：`docs/2026-06-19-oracle-hardening-adversarial-consensus.md` §1②·§2 码版本轴·§6 派工。
> 状态：**设计 diff，落码前过 Bettor 对抗审 + NWT byte-equal 审。未授权落码。**
> grounding：已读 `pool-market-settler.js` (decideConsensus L1117 / decideConsensusV06 L1227) · `pool-market-settler-v06.mjs` (sampleAndStoreCommittee / committee_pk_hash) · `bettor-prediction-voter.js` (unsignedPayload L382 pool_oracle_vote_v1)。**不猜码。**

---

## 0. 命门（要堵的洞）

determinism = 跨节点 **AGREE 非 CORRECT**。现有双 hash gate（`committee_pk_hash` + metadata_hash）保证了**委员集合**与**市场参数**跨节点 byte-equal，但**默认了一件没验的事：判这些输入的【代码】跨节点也 byte-identical**。

反例（前车，共识档 §2 码版本轴）：:3200 跑 oracle 技能 commit A、:3300 差一个 commit B → 喂**同一冻结快照、同一委员集**，judgeLine/抽取逻辑差一行 → 算出**异 verdict** → 不是"oracle 分歧"，是 **silent fork 伪装成分歧**（:3300 实测漂移过 voter17 + settler113 行）。共识把这种漂移洗成"看似合法的 4-of-5"。

**码版本轴 ⟂ 源轴 ⟂ 指令轴**：源 byte-equal 了、码不 byte-equal，照样 fork。

---

## 1. 两层防御（缺一不可）

### (a) deploy-time 闸（operator 纪律 → 固化成显式 gate）—— 我单写者域
- 现状：handoff §4 已有"重 deploy 后 `git rev-parse <sha>^{tree}` 两节点必相同"的**人工纪律**，但靠人记。
- 固化：部署脚本/checklist 加一步——push 前我（单写者）拉两节点 tree-hash 比对，不 byte-identical **禁止** push/标记 deployed。这是**预防**层（让运行码从一开始就同）。
- 局限：deploy-time 只能保证"我部署那一刻同"，挡不住中途某节点偷改/半同步/加载错副本。**所以必须有 runtime 承重层。**

### (b) runtime 闸（承重·不可绕）—— 设计如下
让每张票**自证它由哪个版本的码产生**，共识计票时**只认同版本的票**。

---

## 2. runtime 设计

### 2.1 voter 侧：票带 `code_manifest_hash`（进签名）
`bettor-prediction-voter.js` 现有 `unsignedPayload`（L382, `t:'pool_oracle_vote_v1'`，已带 `market_id / voter_pubkey / evidenceHash`）。**新增一个字段**：

```
const unsignedPayload = {
  t: 'pool_oracle_vote_v1',
  market_id: market.id,
  voter_pubkey: voterXOnlyPubkey,
  evidenceHash,                          // 已有：源证据 hash（① 源轴）
  code_manifest_hash: ORACLE_CODE_HASH,  // 新增：判决码 manifest hash（② 码轴）
  ...
};
```
- `ORACLE_CODE_HASH` 进 `unsignedPayload` → 被签名 → **篡改即签名失效**（自证、防伪）。
- 启动时算一次（进程级常量），不是每票现算（避免 I/O 抖动，也让"运行的码"而非"磁盘当前码"被锚定——若运行中磁盘被改，运行进程仍报它**实际加载**的版本）。
- ⚠ 实现细节待定（见 §5）：进程级常量 vs 每 tick 重算的取舍 = 防御"热改磁盘"的不同语义。

### 2.2 settler 侧：`decideConsensusV06` 计票前按 code_hash 分组
`pool-market-settler.js:1227 decideConsensusV06`（纯函数，无 DB 写，4-of-5 阈值）——**在 tally 前加一道过滤**：

1. 收齐票后，按 `code_manifest_hash` 分组。
2. 取**与 committee 期望版本一致**的那组票进 tally（期望版本来源见 §3）。
3. 版本不匹配的票 → **排除**（不计入 4-of-5）。
4. 排除后凑不齐 threshold → 走**现有** `ORACLE_SILENT_TIMEOUT → refund` 路（**不新增失败路**）。

→ **fail 模式 = abstain/refund，非 fork**（跟共识档三态一致：码不一致 = liveness 成本，不污染结算）。

---

## 3. 期望版本怎么定（两个候选，请对抗审裁）

- **候选 A·hash-quorum（推荐，对齐 NWT 源轴解法）**：不预设"正确版本"，取票里 `code_manifest_hash` 的 **quorum 众数**（≥threshold 张同 hash）那组进 tally，少数派 hash 排除。与 NWT "N fetcher hash-quorum 一致才 freeze" 同构，**无需信任锚**。风险：若 >1/2 委员跑了同一污染版本，quorum 洗白——但这要求多数节点被攻陷，已超 4-of-5 信任模型边界。
- **候选 B·链锚期望版本**：把"当前放行版本"的 manifest hash 上链/进 market metadata，委员票必匹配它。更强（单个诚实节点即可拒杂版本），但引入"谁来上链放行版本 + 怎么滚动升级"的治理问题 = 重。

**我倾向 A**（第一波零新攻击面、零治理、与源轴对称）；B 作为 mainnet 加固 backlog。

---

## 4. manifest 定义（我 slice 核心·部署域我定清单）

**禁用整 repo `git tree-hash`**（UI 改一行就误炸 → 全网 abstain = 自伤 liveness）。只 hash **进 settle 判决路的 oracle 文件精确清单**：

```
ORACLE_SETTLE_MANIFEST = [
  'src/services/pool-market-settler.js',      // decideConsensus/V06 判决
  'src/services/bettor-prediction-voter.js',  // deriveVote / judgeLine 调用
  'src/lib/oracle-evidence-extractors.mjs',   // J2 确定性抽取
  'src/services/derivevote-prompt.mjs',       // canonical prompt
  '<J1 D-L1 judgeLine 文件>',                  // 待 J1 设计定文件名
]
ORACLE_CODE_HASH = sha256( 对 manifest 排序后, 逐文件 sha256(内容) 拼接再 hash )
```
- 清单**精确、版本控制、改它要过审**（清单本身也在 manifest 里 → 自包含）。
- 不依赖 git 状态（content-hash 直读文件）→ dirty working-tree / 不同 checkout 路径都能算出真实运行版本。
- ⚠ 清单"该收哪些文件"是承重判断：**漏一个判决依赖文件 = 那文件漂移逃过闸**。这条我请 J1（D-L1 边界）+ J2（抽取边界）+ NWT（攻击面）共同 review 清单完整性。

---

## 5. 开放问题（请对抗审攻）

1. **bootstrap 鸡生蛋**：runtime 闸首次上线时，所有诚实节点必须已在同 manifest，否则互相排斥全 abstain。→ 靠 (a) deploy-time 闸先把全网同步到同 commit 再开 runtime 闸；分阶段：先 observe-only（记录 hash 不排除）跑一轮确认全网同 hash，再 enforce。
2. **进程级常量 vs 每 tick 重算**（§2.1）：常量锚"启动时加载的码"，热改磁盘不改票 hash（直到重启）；每 tick 重算锚"此刻磁盘码"。前者更贴"运行等价"语义，我倾向常量 + 部署后必 restart（我 deploy 序本就 tree-kill+start）。
3. **manifest 清单完整性**（§4）：漏文件 = 漏洞。需 J1/J2/NWT 各自确认自己域的判决依赖文件都进了清单。
4. **域边界**：runtime gate 码落在 `decideConsensusV06`（决议码 = J2/NWT determinism 域）。我出设计 + 定 manifest 清单（部署域），**hook 处落码归谁请 Bettor 裁**，NWT byte-equal 审。

---

## 6. operator 附带发现（部署卫生）

recon 时发现嵌套副本目录 **`D:\kanet-tn12\kanet-tn12\kasia-console\...`**（真实目录非 junction）。当前**无进程从它加载**（已查 cmdline，dormant）——不是活危害。但它是**部署等价的反面活体例证**：若哪天某启动脚本误指向它 = 异码路径 = 正是本闸要堵的 fork。**建议清理**（我单写者域，确认无引用后删）。

---

## 7bis. 收敛更新（频道 05:53–05:54，落码前定稿）

- **统一成一道闸**：本码轴 `code_manifest_hash` 与 NWT 源轴 `field_hash`（canonical 抽取字段 hash，非 raw blob——blob 含 ESPN 时间戳会假阴）**结构同构**，都【票带 hash + `decideConsensusV06` 计票前 hash-quorum 过滤】，落在**同一函数**。→ 合成**一道多轴 hash-quorum gate**，**单 owner 落码**（避免两 agent 同函数打架）；NWT + 我各供本轴 hash 计算，不各改 `decideConsensusV06`。两个 hash 都进 voter L382 签名 payload。
- **闸 = 双轴非三轴**（J1 纠正，已接受）：源 field-hash + 码 manifest-hash。**算术轴（整数定点/无 float）不是独立投票 hash**——它是 judgeLine 内的纯函数性质，**由码轴覆盖**（judgeLine.mjs 进 manifest → 算术逻辑漂移即 manifest-hash 变即码轴出局）。算术 determinism = 码轴 manifest 的**被保证属性**，非票里第三个 hash。
- **J1 manifest 文件确认**（§5①闭）：judgeLine.mjs 倾向**全收进单文件**（含整数定点/op 应用/metric helper），减小 manifest 面、少一个漂移点；`spec-validation` 的 resolution_predicate 校验是**建市 prevet 期非 settle 路** → **不进 runtime manifest**（prevet 漂移只影响准入不影响已开市判决），归 deploy-time 层 (a) 核。

### NWT 三条件（合并 gate 必守，已全收 · NWT 认领审这道合并闸）
1. **quorum 每轴独立算**：源轴 field-hash 与码轴 manifest-hash 各自跑 hash-quorum，**不混塌**成一个联合 hash（否则单轴漂移污染另一轴的归因）。一票进 tally 必**两轴都在各自 quorum 多数**。
2. **每轴保留独立 hash 字段 + mismatch 原因日志（可归因性）**：票被排除时必能区分是**码漂（码轴）/ 证据漂（源轴）/ 注入** —— 否则 abstain/refund **掩盖根因，运维查不出**（= 共识洗白的对偶坑「排除了但不知为啥」）。
   - **operator 落地（我域，与 NWT 源轴可归因共守）**：每轴 mismatch 写 `events` 表（Brain/UI 可见）+ 排除计数器 + `timeout-refund` 携带 **per-axis 排除原因**，让每次 refund 可归因到底哪轴漂、哪个委员落少数。
3. **observe-only bootstrap 先行**：闸首上线先记录两轴 hash **不排除任何票**，跑一轮确认全网同 hash，再切 enforce（= §5.1）。

### 归属确认
- **judgeLine（J1）= 闸上游**：产 verdict + 产被 hash 的结构化字段，**不碰闸落码**；但 judgeLine.mjs **必列入 manifest**（算术轴跨节点一致全靠码轴覆盖，漏了 = 算术轴逃闸）。
- **合并闸落 `decideConsensusV06`（共识计票路）= settler 域**，单 owner 落码（归属 Bettor 裁）；**NWT 认领 byte-equal 审**这道合并闸；源轴 field-hash 计算 = NWT/J2，码轴 manifest-hash 计算 = 我。

## 7. ETA / 下一步
- 本设计 diff = grounding 后第一版，交 Bettor 对抗审。
- 放行后：先实现 §4 `computeOracleCodeManifestHash()`（纯函数、可单测、跨节点 byte-equal 自证）+ §2.1 voter 加字段（additive，不动现有判决逻辑）。§2.2 settler hook 待域边界裁定。
- 先 observe-only 跑一轮验全网同 hash，再 enforce（§5.1）。
