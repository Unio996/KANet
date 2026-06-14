# B分片 §4 实施计划 — J1 slice（SS / determinism-by-root）

> **日期**: 2026-06-15
> **性质**: `2026-06-14-bshard-fold-trustless-§4-consensus.md` 设计完成 → J1 领 design-review → 本 impl plan。
> **作者**: J1（pool 内核 / SS / cross-node determinism own）。
> **状态**: 计划（**实施 gated 在 Owner 终裁 + demo 后**，§4 §5 钦定；bshard 非 demo 阻塞）。Bettor 审。
> **铁律先验已做**: 真读 `D:/silverscript-src/docs/DECL.md`（OpInputCovenantId L184 区 / `OpCovInputCount`·`OpCovInputIdx`·`readInputState` L271-285 / `conserve_and_bump` N:M 模板 L225·L267-309）确认 4 原语真，非凭记忆。读现有 `kasia-console/src/lib/PoolSpine_v07.sil`(392 行) 确认 shard-aware 字段已在但 globalYes/No 当前=committee-sig attested(链下算)。

---

## 0. design-review 结论

§4 设计**成立**，可实施。三点实证确认:
1. **fold covenant = `conserve_and_bump` N:M 模式的直接实例**（DECL L267-309）: leader entrypoint `OpInputCovenantId → OpCovInputCount → for(k,0,in_count,max_ins){ readInputState(OpCovInputIdx(cov_id,k)) }` 读 k 个输入 state → policy 验守恒 → 产合并输出。fold 树每节点(k 叶/中间→1 partial-sum)就是一次 N:M conserve。**非新原语，是现成模式的应用**。
2. **输入 provenance(NWT ★#1) 由 `OpInputCovenantId` 链上锁**: leader 内 `require(每输入 cov_id ∈ {fold模板, PoolSpine_v07_shard叶模板})` → 恶意假 UTXO 进不来。原语真(DECL 确认)。
3. **commit 硬校验替 committee-sig**: root UTXO 的 globalYes/No 是 fold 链上派生真值 → `require(blake2b(byte[](globalYes,16)‖byte[](globalNo,16)‖market_id‖byte[](shard_count,?)) == commit_v2)`。现有 PoolSpine_v07 已有这条 require 结构(L11/L101)，只需把 globalYes/No 的来源从 entry-arg(committee 签) 改成 fold-root introspection 读。

**design-review 唯一新增风险点(进 §3 open)**: fold covenant 的 op/bytecode 预算(Q5)直接 cap fold 叉数 k → 决定树深 → 决定大池 fold TX 笔数。必先 mass 实测再定 k。

---

## 1. J1 slice 实施分解(4 件，按依赖序)

### 件1 — PoolSpine_v07_shard.sil（叶合约 = shard variant）
- 从 PoolSpine_v07.sil 派生 shard 变体: 每 shard = 独立 UTXO 携 `localYes`/`localNo`(本片累计 sompi)。
- **bet-register covenant-enforced 写 local state**(防 NWT #1b 叶后改): 注册 covenant 在 transition 时 `new_state.localYes = prev_state.localYes + (direction==0 ? stake : 0)`(NO 对称)，require 单调增 + 等于 prev+stake → 后续 `readInputState` 拿不可变值。
- 叶 covenant-id 固定模板(fold 白名单要认它)。
- **保留**单片 settle 路径(单 shard 市场 = 现 PoolSpine_v07 行为，回归基准 46f8a/xfu62 19/19 必仍 PASS)。

### 件2 — PoolFold.sil（fold covenant，新）
- N:M `conserve_and_bump` 实例: entrypoint `fold(State[] new_states, sig?)`(零 committee-sig，纯结构强制):
  - `cov_id = OpInputCovenantId(activeInputIndex)`; `in_count = OpCovInputCount(cov_id)`; `require(OpCovOutputCount(cov_id)==1)`(fold k→1)。
  - `for(k,0,in_count,MAX_FOLD_K){ in_idx=OpCovInputIdx(cov_id,k); {localYes,localNo}=readInputState(in_idx); sumYes+=localYes; sumNo+=localNo; require(输入 cov_id ∈ {fold模板,叶模板}) }`。
  - 产出 1 中间 UTXO `new_state={localYes:sumYes, localNo:sumNo}` + `require(out.sumYes==Σin & out.sumNo==Σin)`(conserve)。
  - **层次复用**: 中间 UTXO 用 fold 模板自身 → 可再被上层 fold 吃 → k→1 到单 root。root UTXO 即携 globalYes/No。
- **MAX_FOLD_K = Q5 mass 实测定**(硬限，见 §2)。

### 件3 — commit 硬校验接入 settle_aggregate
- 改 PoolSpine_v07 settle: globalYes/No 不再从 entry-arg(committee 签) 取，而是 **introspect fold-root UTXO 的 state**(`readInputState` root 输入) → 链上真值。
- `require(blake2b(byte[](globalYes,16)‖byte[](globalNo,16)‖market_id‖byte[](shard_count,N)) == global_commit_id)` 不变，但 globalYes/No 是 fold 派生(非 settler 算) → **6/02 作废的 committee-sighash 背书由此真上链**。
- min-pot global `require(globalYes+globalNo >= MIN_POT)` 用 fold 真值。

### 件4 — snapshot / determinism by-root（cross-node 我专精）
- fold 树结构(谁聚合谁/几叉/序)每节点从**链上 shard roots 确定性算**(扩今天 committee by-root self-heal 同款 [[cross-node-determinism-review-two-axes]] ②地址派生轴): 
  - shard-set 锚 `shard_count` + 每片 outpoint by-root 确定(消费 deadline 锚定 outpoint，**非 P2SH-scan** — 防 NWT ★#1(a) 构造层)。
  - 树 = shard roots 排序后定长 k-叉归并 → 任意节点算出 byte-equal fold TX 序列。
  - 复用 `ensurePoolSnapshotByRoot` self-heal 思路: 缺中间 UTXO 的节点 by-root 重算重建。
- **两轴扫**(铁律 [[cross-node-determinism-review-two-axes]]): ①算术轴 fold 求和全 BigInt sompi 零 float + conserve 逐 sompi assert; ②地址派生轴 fold 输出地址必从 cov 模板派生(非 node-local 查)。

---

## 2. open-item 我域答 + 依赖(impl 前必闭)

| item | 我(J1)答/动作 | 依赖 |
|---|---|---|
| **Q5 mass(硬限驱动 k)** | fold op ≈ `OpInputCovenantId + OpCovInputCount + OpCovOutputCount + k×(OpCovInputIdx + readInputState~3-5op + 2加 + cov-id require) + blake2b? + validateOut`。我出 SS 草稿 → **J2 编译实测 op<201 + bytecode<10000B** → 反推 MAX_FOLD_K。预估 k∈[4,8]，实测定。 | J2 mass-test harness |
| **Q2 state 编码** | localYes/No 进 **script state(introspection `readInputState` 易读)** 优于 UTXO value(value 只 1 个塞不下 yes+no)。落码定，倾 state。 | J1/J2 落码 |
| **Q4 原子性** | 关池锁全局(root 未成各片不能 claim) → 某 fold TX 卡 = 子树 retry(任意节点可完成，复用 (c) quorum-timeout 兜底)。退款边界: root 永不成 → 超时全片退(各叶 localYes/No 退本注)。 | J2 fold 调度 |
| **大池压测(红线)** | impl 后必跑真多片 e2e(28+注多片 fold→claim)，基准单片 46f8a/xfu62 19/19。**实测最大 8 注，从未真多片** = 最大未知风险。 | impl 完成后 |

---

## 3. 序 + gate(对齐 §4/§5)

- **gate**: 实施 = demo 后 scale 里程碑，**Owner 终裁 + demo 后解冻**。地基(链上派生池, 本会话 batch2 已修+验)就绪，不再阻塞。
- **impl 阶段序**(解冻后): 件1 shard 叶(回归守单片) → 件2 fold covenant(J2 mass 实测定 k) → 件4 by-root determinism(我专精) → 件3 commit 接入 → 大池 e2e 压测(红线) → NWT attack-static rerun(5 PoC)。
- **分工**(§4 已定): J1=件1/2/3 SS + 件4 determinism; J2=fold 调度+schema+mass+双路兜底; NWT=攻击 PoC; KANet-UI=分片对用户透明(1 市场 + 全局赔率 fold-root 派生显示)。

## 4. 守红线
- 机制验证(破单市场 mass 上限范式)**非经济闭环**(守 G5)。
- SS 原语已真读 DECL.md 实证(非 grep)。
- 大池 e2e 压测必过再算完成(实测最大 8 注=最大未验角)。

---
*J1 design-review + impl plan。设计 by Bettor 主持 5-agent §4 收敛(2026-06-14)。impl gated 在 Owner 终裁+demo 后。*
