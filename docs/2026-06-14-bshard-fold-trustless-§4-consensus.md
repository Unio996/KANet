# B分片 trustless fold §4 — 设计完成 + J1 实证共识（解 6/02 HOLD）

> **日期**: 2026-06-14
> **性质**: `2026-06-02-bshard-trustless-redo-design.md` §4 对抗轮收敛 + J1 silverscript 能力实证 → 设计完成。Owner 2026-06-14 绿灯"可以对抗性讨论结构算法·集思广益"驱动。
> **主持**: Bettor-tn（架构/facilitator，非 decree）。
> **参与**: J1（SS/determinism by-root）/ J2（fold 调度+schema+mass）/ NWT（攻击审）/ KANet-UI（让位 snapshot 给 J1，转 design-v2）。
> **前置解锁**: trustless-redo §5 等的 **#17 跨节点确定性地基 = 今天修的链上派生池**（撤本地 active-flag override + (b) ensurePoolSnapshotByRoot match-by-root self-heal + (a) 两节点 byte-equal 池 root，③ 四方两 vantage 链验，见 `project-crossnode-cosmetic-committee-chain-derive-fix`）。地基通 → §4 解冻收敛。

---

## 0. 一句话

6/02 决议把"跨片全局赔率链下 settler 算 + 委员签背书"判 trustless 不足、HOLD。今天地基修通 + J1 实读 DECL.md 确认 4 原语真 → **链上层次 fold 树（map-reduce）取代链下聚合，commit 硬校验取代 committee-sig fallback，零 committee-sig 全 trustless，设计完成**。**序仍 demo-first：实施等 Owner 终裁 + demo 后**（bshard 是"几乎无限"scale 里程碑、非对外测试 demo 阻塞）。

---

## 1. 收敛的设计（5-agent）

### 1.1 链上层次 fold 树（跨片全局赔率，by-root 确定性）
- 每片 = 独立 PoolSpine_v07 shard UTXO，携 `localYes/localNo`（state，UTXO 携值）。
- 关池后 **fold 树**：每个 fold TX 吃 **k** 个（片或中间节点）UTXO → introspection 读各输入 local → 链上求和 → 强制产出 1 个中间 UTXO 携 partial-sum。**层次 fold（k→1）到 1 个全局 root UTXO**（携 `globalYes/globalNo`）。
- **by-root 确定性（KANet-UI 洞察）**: fold 树结构（谁聚合谁、几叉、顺序）每节点从**链上 shard roots** 确定性算出**同一棵**，零协调零信任——扩今天 committee by-root self-heal 同款。任意节点可触发，内容 by-root 定 → 不同触发者算出 byte-equal fold TX，SS committee_pk_hash 式强制拒分歧。
- **conserve（J1，DECL 现成模式）**: `out.sum == Σ in.sum` = trustless partial-sum，**零 committee-sig** = DECL 的 **`conserve_and_bump`** 模式。
- **commit 硬校验替 committee-sig fallback**: 链上 `require(blake2b(byte[](globalYes,16) ‖ byte[](globalNo,16) ‖ market_id ‖ shard_count) == commit_v2)`——globalYes/No 是链上 fold 派生**真值**，非 settler 算的。**6/02 被作废的"委员 sighash 背书 commit_v2"由此真上链**。

### 1.2 J1 实证的 silverscript 原语（铁律先验，直读 D:/silverscript-src/docs DECL.md+TUTORIAL.md，非凭记忆）
- `OpInputCovenantId` / `OpCovInputIdx` / `OpCovInputCount` / `readInputState`（DECL **L184 / L271-285**），binding=cov mode=transition。
- `readInputState(idx)` 读各输入**不可变已 commit** 的 partial-sum / 叶 state。
- `byte[](int,size)` int-to-byte 编 globalYes/No/shard_count；`blake2b`；`for` 循环。**无 KIP-17 依赖**。

---

## 2. 攻击面（NWT 5）+ 防御 — 全收敛

| # | 攻击 | 防御 | 状态 |
|---|---|---|---|
| **★#1** | **输入 provenance**：fold covenant 绑【输出】=模板，但【输入】没绑 → 攻击者拿假 UTXO 喂 fold 伪造 partial-sum | **双层**：(a) 构造层[J2] fold by-root 确定 outpoint（消费 deadline 锚定确定 outpoint，非 P2SH-scan）→ 诚实节点不选假 UTXO；(b) SS 层[J1] **OpInputCovenantId** 链上强制每输入 covenant-id ∈ {fold 模板, 叶=PoolSpine_v07 shard 模板} → 恶意节点假 UTXO 也进不来 | ✅ 锁（J1 原语实证） |
| **#1b** | 叶 state 后改（fold 读到篡改的 local） | shard 叶 `localYes/No` 必在 **bet-register 时 covenant-enforced 写入 state**（register covenant），后续 `readInputState` 拿不可变值 | ✅ 锁 |
| **#2** | 树结构操纵（漏片/重复计片/注入假片） | shard-set-by-root + `shard_count` 关池锚 + 每片恰一叶 + root 贡献片数 == 锚定数 | ✅ |
| **#3** | fold griefing DoS（故意让 fold TX 失败冲突花 shard → 阻 root → 全 claim 卡） | 任意节点可完成 fold + 失败原子重试（复用今天 (c) quorum-timeout 兜底思路） | ✅ |
| **#4/#5** | fold-fee grief 等 | J2 §4 立场已覆盖 | ✅ |

---

## 3. 待办（implementation 前必闭，非设计阻塞）

- **Q5 mass 实测（J2 依赖 J1 SS）**: fold covenant op ≈ `OpInputCovenantId + OpCovInputCount + k×(OpCovInputIdx + readInputState ~3-5op + 加) + blake2b + validateOut`；k 输入 ~k×4-6 op + 开销。**必验 < MAX_OPS=201 + bytecode < 10000B**——**k（fold 叉数）受此硬限**，实测定。
- **Q2 state 编码**: localYes/No 进 UTXO value 还是 script state（introspection 易读 + mass 省）——J1/J2 落码时定。
- **Q4 原子性细节**: 某 fold TX 卡 → 子树退款 vs 重试边界（关池已锁全局，root 未生成时各片不能 claim）。
- **大池压测（红线）**: 真大池（28+ 注多片）fold→claim **从未链上压测**（实测最大 8 注）→ 实施后必跑真多片 e2e（基准 = 单片 46f8a/xfu62 19/19 PASS）。

---

## 4. 分工（implementation，等 Owner 终裁 + demo 后解冻）

- **J1**: PoolSpine_v07 shard variant + fold covenant（OpInputCovenantId 输入白名单 + conserve_and_bump partial-sum + commit 硬校验）+ snapshot/determinism by-root（cross-node 专精 own）。
- **J2**: fold 调度（Q3 任意节点触发/付费/失败重试）+ `market_shards` schema + 跨片 globalYes/No 聚合调度 + Q5 mass 实测 + 保 (b) commit + (c) 双路兜底。
- **NWT**: 攻击审 PoC doc（5 攻击面逐个落 PoC）+ 实施后 attack-static rerun。
- **KANet-UI**: 让位 snapshot 给 J1，转 **design-v2 (B) 广播层**（独立近期 demo-relevant 件）+ 分片对用户透明（1 市场 + 全局赔率从 fold root 派生显示）。

---

## 5. 序（Bettor 拍，对齐北极星文档 + 团队共识，Owner 可否决）

- **demo-first**: 对外测试网公开（北极星）controlled 尺度（错峰 deadline + 适度注）**本就不触发单市场上限** → bshard 非 demo 阻塞。
- **近期推（demo-relevant，已批）**: design-v2 (B) 广播层 880（KANet-UI 域，无 SS 改，降现有 settle 11min collecting_sigs）。
- **设计现已完成（本文）**: bshard §4 fold trustless。
- **实施 = demo 后 scale 里程碑**: 大 SS 重写 + 大池压测，gate 在 Owner 终裁 + demo 之后。地基（今天修的链上派生池）已就绪、不再是阻塞。

---

## 6. 守红线
- 机制设计（破单市场 64/mass 上限范式验证），**非经济闭环**（守 G5）。
- #1 SS 层"原语实证"= J1 直读 DECL.md L184/271-285（非 grep string，本会话刚踩过 grep≠works 的坑，故强调真读）。
- 实施前大池 e2e 压测必过（实测最大 8 注，从未真多片）。

---
*Bettor-tn 主持 sediment。§4 对抗收敛 + J1 实证 → 设计完成。序 demo-first，实施等 Owner 终裁。faithful 引用 dev-coord-testnet r1116-r1030 频道原话。*
