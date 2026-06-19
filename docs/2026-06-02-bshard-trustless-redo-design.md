# B分片 trustless 重做设计 — 链上层次聚合 fold(批3 解 HOLD)

> **✅ 2026-06-14 更新: §4 对抗轮收敛 + 设计完成。** 本文 §4 五议题(fold 树结构/state 编码/时序/失败/mass)经 5-agent 对抗 + J1 实读 DECL.md 实证原语收敛 → **设计完成共识落 `docs/2026-06-14-bshard-fold-trustless-§4-consensus.md`**。关键: 命门 #1(输入 provenance)双层防(by-root 构造 + J1 OpInputCovenantId 白名单)、conserve_and_bump partial-sum 零 committee-sig、commit 硬校验替掉被作废的 committee-sig fallback。§5 等的 **#17 跨节点确定性地基 = 2026-06-14 修通的链上派生池**(见 `project-crossnode-cosmetic-committee-chain-derive-fix`)。**序 demo-first: 实施(大 SS 重写 + 大池压测)gate 在 Owner 终裁 + demo 后。**
>
> **触发**: Owner 2026-06-02 批准 trustless 重做(原 HOLD 决议的链下聚合被 Owner catch 推翻——silverscript 在 TN12 实有 introspection/covenant/int-to-byte/for 循环,该 trustless 上链)。Owner "要!思路对"。
> **主持**: Bettor-tn(架构,带提案+对抗洞,非 decree)。
> **前置**: `2026-06-02-bshard-rolling-design-consensus.md`(批3 HOLD 决议)+ v0.7.1 trustless 自卫模式(已链验 9d0c519c)+ [[reference-silverscript-real-capabilities]]。
> **依赖**: 跨节点命门(scanAndDerivePool 链派生,J2 路 A 修中)——分片的"哪些片存在 + fold 结构"是同一类跨节点确定性问题,必在确定地基上落(见 §5)。

## 1. 保留 vs 作废(实证对照)

| 部分 | HOLD 决议 | 处置 |
|---|---|---|
| 滚动分片 1→∞ | 每市场 1 片起,mass-aware 封满开下片,witness 无限 | ✅ 保留 |
| mass-aware 封片 | projected_settle_mass > 440k OR count==64 谁先封 | ✅ 保留(复用 estimateStorageMass) |
| 顺序填分配 + 注册竞态锁 | SQL lock + UNIQUE(logical_market_id, shard_index) | ✅ 保留 |
| 关池锁全局 + 各片独立并行结 | deadline 锁全局,各片用同 commit 独立结 | ✅ 保留 |
| 原子性 | 某片结算失败→该片退款,不影响其他 | ✅ 保留 |
| **跨片全局赔率聚合** | **settler 链下 JS 求和 globalYes/No** | ❌ 作废→trustless |
| **commit_v2 背书** | **委员 sighash 签名背书 commit_v2** | ❌ 作废→链上派生 |

**核心难题**: 跨片 `globalYes/globalNo`(= Σ 各片 local)必须**链上派生且可验**,不靠 settler 算 + 委员签。

## 2. Bettor 提案 — 链上层次聚合 fold(map-reduce 上链)

**思路**: 把"求和跨片"从链下 JS 搬成**链上 introspection 强制的 fold 树**,扩 v0.7.1 已链验的 WinningsPool 自卫模式。

1. **每片** = 独立 PoolSpine UTXO,携 `localYes/localNo`(state,Mecenas 模式 UTXO 携值)。
2. **关池后聚合 fold 树**:每个 fold TX 吃 **2 个**(片或中间节点)UTXO 作输入 → introspection `readInputState` 读两输入 local → **链上求和**(`for` + int 加)→ `validateOutputState` 强制产出 1 个中间 UTXO 携 partial-sum。**log₂(N) 层** fold 到 1 个 **全局 root UTXO**(携 `globalYes/globalNo`)。
3. **commit_v2 = blake2b(root.globalYes ‖ root.globalNo ‖ market_id ‖ shard_count)**,但 globalYes/No 是**链上 fold 派生的真值**,非 settler 算的。已激活的 commit_v2 硬校验现在校的是链上 fold 结果。
4. **每片 winner claim 引用 root UTXO**(= v0.7.1 WinningsPool 模式,WinningsPool 即聚合 root),introspection 强制 payout = local_stake × global_odds。
5. **没有 settler/委员能伪造全局数** —— 全局数是链上 fold 强制求和,每步可重算可验,委员签名彻底退出全局赔率路径。

**为什么层次 fold 而非单 TX 聚合**: N 片单 TX = N 输入 → KIP-9 mass 爆(同 64-cap 病根)。层次 fold(2→1)每 TX mass 有界、log(N) 深度。复用 G6 找零核弹的 depth-20 自卫 fold 经验。

**用到的 silverscript 原语(全确认可用,见记忆)**: `readInputState`/`validateOutputState`、`for` 循环、`byte[](int,size)` int-to-byte、`blake2b`、introspection `tx.inputs[i]`/`tx.outputs[i]`。**无 KIP-17 依赖**。

## 3. 守恒(命门)— fold 不能凭空造/灭票

- 每个 fold TX 必 introspection 硬校验:`out.partialYes == in[0].localYes + in[1].localYes`(No 同),且 `out` 的 P2SH = 同一 fold 合约模板(covenant 绑定,防替换成假 UTXO)。
- root 的 globalYes == Σ 全片 local(由 fold 树逐层守恒归纳保证)。
- claim 守恒沿用 v0.7.1:池只减池部分,winner 拿 local_stake + 池分。

## 4. 核心议题(对抗,出立场+互挑)

- **Q1 fold 树结构**: 二叉(2→1)还是 k 叉(k→1,k 受单 TX mass 限,实测定)?fold TX 谁触发 + 谁付费(settler 代付?broker fee 出?)?
- **Q2 中间 UTXO state 编码**: localYes/No 进 UTXO value 还是 script state?哪个 introspection 好读 + mass 省?
- **Q3 fold 时序 + 并行**: fold 必在各片 claim 前完成(claim 依赖 root)。fold 树同层可并行;跨层有依赖。调度?
- **Q4 fold 失败/卡**: 某 fold TX 失败 → 子树退款还是重试?原子性边界(关池已锁全局,但 root 未生成时各片不能 claim)。
- **Q5 mass 预算实测**: 每 fold TX 2 输入 + 1 输出 + introspection script 的真 mass?k 宽度上限?fold 树深度对总 TX 数(=费用)的影响?

## 5. 跨节点命门(与 #17 同根,必先修地基)

- 分片的"**哪些片存在 + fold 树结构**"必须**跨节点确定**——否则节点 A 看 5 片、节点 B 看 4 片 → fold 出不同 root → 协议自废(同 scanAndDerivePool 命门)。
- ∴ 分片的 shard 发现也必**链派生**(片 P2SH 上链可发现 / 关池快照锚 shard_count),不靠 per-node DB。**这就是为什么实施必等 #17 跨节点 fix(路 A/链派生)落地**——同一地基。
- 设计可现在并行收敛,**实施等地基**。

## 6. 点名(收到回声)

- **@J1tn**(SS): fold covenant 怎么写(`readInputState` 读两输入 local + 求和 + `validateOutputState` 强制 root + covenant 绑模板防替换)?§3 守恒链上表达?单 fold TX mass 实测?
- **@J2-tn**(settler+DB): fold 树调度(谁触发各层 fold TX、付费、失败重试)?shard 发现跨节点确定(§5,跟你路 A 同框架)?market_shards schema?
- **@NWT-tn**(对抗): fold 能否被伪造(造票/灭票/中间 UTXO 替换/fold 树结构操纵)?攻击面 top-N。
- **@KANet-UI**(UI): 分片对用户透明(1 市场 + 全局赔率从 fold root 派生显示)?注册时 promote 开片 UX?

## 7. 守红线
- 机制设计(破 64-cap 范式验证),非经济闭环(守 G5)。
- 真大池(28+ 注多片)fold→claim **从未链上压测**(实测最大 8 注)→ 实施后必跑真多片 e2e。
- 实施**等 #17 跨节点地基**,设计现在并行收敛。

---
*Bettor-tn 主持。HOLD 决议链下部分作废 → 链上 fold trustless 重做。对抗收敛 → Owner 终裁 → 等地基 → 实施。*
