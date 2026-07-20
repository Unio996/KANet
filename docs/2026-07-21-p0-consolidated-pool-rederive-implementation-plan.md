# P0 实现方案 — consolidated_pool re-derive-from-chain(J1 draft, 折入 NWT MUST-FIX②③ + K-18 §3.4)

> **Status**: CURRENT(v0.3 · 2026-07-21 · J1 · 首版实现 6cff7305 被 Codex 对抗审查(coord/codex-bridge `2a10f5e8`)+ NWT 复核撤回判 RED,MUST-FIX4 坐实——`consolidateAndBuildPsState` 最终仍用 `compilePayoutShardRedeem` 重编译产出 spending-authority `redeem_hex`,违反团队 8pson 事故后拍板的 K-18/DEC-20260718-001"续约权威=落地 redeem+splice,重编译只能校验"决议。v0.3 折入 K-18 §3.4(J1 代笔落地 J2 域,效率借调非域转移,记账见频道)——彻底改为 splice 权威,recompile 降级非阻塞校验。**K-18 自身 DoD 硬前置(backfill dry-run 报告 + 现网全量 V1 盘 splice-vs-recompile byte-exact 对照)仍未完成,不能跳,本机(J1tn)无生产库/pinned silverc 访问,该步骤待 KANet-UI/有权限机器执行。装载/money-path 仍全部 hold,等 NWT 对 v0.3 diff + K-18 backfill 报告双重放行。**)
> **依据**: `docs/2026-07-21-28-state-sync-architecture-full-design.md`(649950ff)§5 P0 派工 + `docs/2026-07-21-NWT-redteam-28-state-sync-full-design.md`(f1a16daa)MUST-FIX②③ + 附带项(第3回归场景)+ `docs/2026-07-18-payoutshard-family-coherence-gate-design.md`(K-18 v1.1,NWT GREEN 7/18)§3.4 权威收敛 + coord/codex-bridge 对抗审查(`2a10f5e8`)MUST-FIX4。
> **审批链**: NWT 首轮 GREEN(f51cb938)→ 装载前 KANet-UI 谨慎 hold(diff 未单独过 verdict)→ Codex 独立对抗审查判 RED → NWT 复核同意撤回 GREEN、抓出 K-18 §3.4 早有已批准解法未落码 → J1 认领执行部分责任(接位 SOP 第5条"设计前查资产"没做到,即便自己是 K-18 作者)→ 收敛为 v0.3(splice 权威落地窄范围,即本函数)→ **待 NWT 复核 v0.3 diff + K-18 backfill 前置完成后才能装载/money-path**。

---

## 0. 范围确认(MUST-FIX② 已折入)

漂移点③ `consolidateAndBuildPsState` 的正确 file:line = **`kasia-console/src/services/bshard-settle-daemon.mjs:163-231`**(不在 `bshard-auto-settler.mjs`)。本方案全程用此路径,不重蹈笔误。

本方案覆盖 `consolidateAndBuildPsState` 的 **"already consolidated" 分支**(:200-227,`needConsolidate===false` 时走的路),这是 MUST-FIX③ 点名的问题所在。`needConsolidate===true` 分支(:169-199,调用 `consolidateAllShards`)不在本次改动范围——它内部已有 `autoDetectConsolidateResume` 自愈(见下 §2),且落地 UTXO 前有 `landed()` D=20 深度门,风险面不同。

---

## 1. 问题重述(MUST-FIX③ 核心)

当前代码(:214-224):
```js
const realAddr = _p2shCache(ps.payout_redeem_hex);       // ← 直接信 DB 列
const liveEntries = await getUtxos(realAddr);
const match = liveEntries.find(e => outpoint===psOutpointTxid && index===psIdx);  // psOutpointTxid/psIdx 同样来自 DB
if (match) consolidatedPoolReal = realAmount;              // 命中才用真值
// 否则静默 fail-open 到 predictedPool(公式值)
```

`ps.payout_redeem_hex` / `ps.payout_ps_outpoint` 只在两个机会性刷新点更新(漂移点⑤,`bshard-close-transport.mjs:308` / `bshard-close-voter.js:667`),加上本函数自己 :198 那行 `UPDATE payout_shards SET payout_ps_outpoint=...` 包在 `try{}catch{}` 里静默吞错——三处都可能让这两列滞后于链上真实进度。**滞后时 `realAddr` 算出的是错误地址,`match` 必然找不到,现有代码把"找不到"和"这地址本来就没钱"混为一谈,统一 fail-open 回预测值**——这正是 §1 收敛原则字面违反之处:GATE 名义链上优先,实际查询坐标仍由 DB 决定。

---

## 2. 修法:复用已验证代码,不发明新机制(NWT 措辞订正: 非"两层独立防御",Tier1 是 Tier2 前的省 RPC 快速路径)

### Tier 1(每 tick 常规路径,低成本)——独立链读验证 `payout_redeem_hex` 新鲜度

在信任 `realAddr` 之前,加一次**跟 `payout_redeem_hex` 完全独立**的链读核对,复用 `_inferWinDirectionFromChain`(`bshard-auto-settler.mjs:246-254`)已经验证过的同一原语——`kaspa_tx_log.outputs_json` 直接读某个 txid 的 output 地址:

```js
// Tier 1: 独立核实 payout_redeem_hex 是否新鲜(不信它, 核它)
const realAddr = _p2shCache(ps.payout_redeem_hex);
const txRow = sqlite.prepare('SELECT outputs_json FROM kaspa_tx_log WHERE tx_id = ?').get(psOutpointTxid);
let chainObservedAddr = null;
if (txRow?.outputs_json) {
  try {
    const outs = JSON.parse(txRow.outputs_json);
    const o = outs[psIdx];
    chainObservedAddr = o?.address || o?.verboseData?.scriptPublicKeyAddress || o?.scriptPublicKeyAddress || null;
  } catch {}
}
const redeemFresh = chainObservedAddr && chainObservedAddr === realAddr;
```

- **`chainObservedAddr === realAddr`**(新鲜)→ 走现有 `getUtxos(realAddr)` probe(:217-223 逻辑不变,只是现在建立在"已验证"而非"盲信"之上)。命中 = 用真值;这里如果 probe 未命中(该 outpoint 在链上已花)说明**这一步консолидate 已被后续步骤取代**,不是"没钱",落 Tier 2(下)。
- **不新鲜**(地址不符,或 `kaspa_tx_log` 查不到——indexer 缺口,同 `_inferWinDirectionFromChain` 的 "F3 账" 语义)→ **不再进 `getUtxos(realAddr)` probe**(明知地址算错还去查它,浪费一次 RPC 且没有信息量),直接进 Tier 2。

**NWT 复核观察(a,已采纳订正措辞)**: Tier1 不是跟 Tier2 并列的独立安全层——结构上无论 Tier1 判定新鲜与否,只要后续 `getUtxos(realAddr)` probe 的 `match` 失败(旧 outpoint 已被花掉的场景下必然失败),都会落到 Tier2 兜底。**Tier1 真正的作用是"省一次无信息量 RPC 的快速路径"**(不新鲜时跳过明知会失败的 probe,直接进 Tier2),真正的安全兜底是 Tier2 + `match` 判定的组合,不是 Tier1 本身。§2 标题已按此订正。

### Tier 2(仅 Tier 1 未通过时触发)——genesis-anchored 重建,复用 `autoDetectConsolidateResume`

`pool-shard-settle.mjs:345-372` 的 `autoDetectConsolidateResume` **已经是** MUST-FIX③ 要的模式:从 genesis(`payout_redeem_hex` 的初始字节布局,非其数值本身)+ 每个已知 `market_shards.current_leaf_state.pool_value`(shard 一旦 sealed 即不可变,不是"猜"是"读已知")**现场逐步编译累积候选 consolidatedPool → compilePayoutShardRedeem → p2sh 地址 → 查链**,命中即真值。这个函数目前只在 `consolidateAllShards` 自己的 resume 入口(pool-shard-settle.mjs:384-386)被调用——**本方案把它同样接进 `consolidateAndBuildPsState` 的"已 consolidate"分支**,不新写一遍重建逻辑:

```js
if (!redeemFresh || !match) {
  const resumePoint = await autoDetectConsolidateResume({
    db: sqlite, getUtxos, p2sh: _p2shCache, logicalMarketId: marketId,
    payoutShard: { payout_redeem_hex: ps.payout_redeem_hex, payout_ps_outpoint: ps.payout_ps_outpoint, payout_cov_id: ps.payout_cov_id },
  });
  if (resumePoint) {
    // 链上真值找回: 自愈写回(镜像 :198 既有 DB-lag 自愈风格), 不吞错(这次要能看见失败)
    psOutpointTxid = resumePoint.psTx; psIdx = resumePoint.psIdx;
    consolidatedPool = resumePoint.pool;
    sqlite.prepare('UPDATE payout_shards SET payout_ps_outpoint = ? WHERE logical_market_id = ?')
      .run(`${psOutpointTxid}:${psIdx}`, marketId);
    log(`${marketId.slice(-8)} Tier2 重建命中: payout_ps_outpoint 自愈为 ${psOutpointTxid}:${psIdx} pool=${consolidatedPool}`);
  } else {
    // genesis 仍未花(未消费,矛盾: market_shards 说已consolidate)或全走查无 — 两种 null 原因不同,
    // 但对本 tick 处置一致: 不能猜, fail-closed 拒绝本 tick 结算推进, 响亮报, 非静默 fail-open formula。
    ctx.alert?.(marketId, `consolidated_pool Tier2 重建未命中(genesis 未花或全 shard 查无 live UTXO)— 拒绝本 tick 使用 predictedPool, 需人工核`);
    sqlite.prepare(`INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'system', 'consolidated_pool_verify_drift', 'consolidateAndBuildPsState', 'warn', ?, ?, datetime('now'))`)
      .run(randomUUID(), `market=${marketId.slice(-8)} payout_redeem_hex/payout_ps_outpoint 与链上不符且 Tier2 genesis-walk 未命中`,
           JSON.stringify({ marketId, staleOutpoint: `${psOutpointTxid}:${psIdx}`, staleRedeemAddr: realAddr }));
    throw new Error(`consolidated_pool 无法链上验证(market ${marketId}), fail-closed 拒绝本 tick`);
  }
}
```

**为什么是 throw 而非静默跳过**:`_settleOneMarketAttempt` 现有调用惯例里,函数内 `throw` 由外层 tick 循环 catch 并记录/下 tick 重试(同 daemon 现有其它 fail-closed 路径的处置模式,不新增行为类别)。这样 Tier2 未命中不会静默污染 evidence,而是让这个市场本 tick 原地不动、下 tick 自然重试(可能是暂时性 indexer 滞后)——比"猜一个 predictedPool 继续走"安全,比"永久 manual_hold"轻量(那个手动闸留给人工判定的场景,见 `61a36d03`,本场景先不占那个位,连续 N 次同样失败再考虑升级,先观察实占比)。

**成本控制**:Tier1 只加一次 `kaspa_tx_log` 本地 SQLite 查询(零 RPC),不影响常规 tick 开销。Tier2(RPC 密集,per-shard getUtxos)只在 Tier1 判定不新鲜时才跑,预期触发频率=当前"real-pool probe fail"的发生率(即今天这条 fail-open 分支实际走到的频率,历史上稀发,可从 `log` 里 `real-pool probe fail` 字样统计佐证)。

---

## 3. 第 3 个回归测试场景(NWT 建议,折入)

**场景**:daemon 在 `consolidateAndBuildPsState` 的 `needConsolidate=true` 分支(:169-199)跑完 `consolidateAllShards`(链上已落地新的最终 consolidate tx)后、:198 那行 `UPDATE payout_shards SET payout_ps_outpoint=...` 提交前崩溃重启。

**当前行为分析(读码坐实,非假设)**:
- `market_shards.status` 是在 `consolidateAllShards` 内部**逐 shard 循环内**(pool-shard-settle.mjs:432)于每个 shard 的链上 consolidate tx `landed()` 之后立即 UPDATE 的,跟外层 :198 的 `payout_shards.payout_ps_outpoint` UPDATE 是两次独立写入,窗口之间不是原子的。
- 若崩溃发生在**所有 shard 的 :432 都已提交**(即所有 shard 状态已翻出 sealed/open)但外层 :198 未提交 → 下次重启 `needConsolidate` 判定为 `false`(所有 shard 已翻状态)→ 直接进入本方案改造的"已 consolidate"分支 → `ps.payout_ps_outpoint` 是**consolidate 前的旧值**(:198 从未写入过,是更早一轮遗留或初始种子值)→ **Tier1 会正确抓到这个不新鲜**(旧 outpoint 早被后续 consolidate 步骤花掉,`chainObservedAddr` 要么查不到该 tx 是消费记录不匹配、要么地址对不上)→ 落 Tier2 → `autoDetectConsolidateResume` 从 genesis 一路走到底,找到真实最新 outpoint → 自愈写回。**本方案的 Tier1+Tier2 天然覆盖此场景,不需要为它单独加代码路径**,但需要一条回归测试显式验证这条链路(不能只靠代码读证明,見 NWT MUST-FIX 附带项原话"不要等下一个孤儿盘事故才补")。

**落码状态(2026-07-21,已交付)**:`kasia-console/src/services/bshard-consolidated-pool-rederive.test.mjs`(与 §2 代码改动同批 commit)。实现口径,诚实标注覆盖边界(不夸大):

- **已覆盖(真实,非 mock)**:两个场景都对着**真实本地 kaspad 节点**(:3300 或任一已连接的 RPC)跑 `getUtxos` 真查询——① `kaspa_tx_log` 完全没有该 outpoint 的记录(indexer 缺口/DB 写入窗口未提交,同本节场景);② `kaspa_tx_log` 有记录但地址跟 `payout_redeem_hex` 反推的不符(证明 Tier1 是真独立核验,不是"有记录就信")。两者对捏造的、从未真实收到过资金的测试地址而言,"查无 live UTXO"是**真链上事实**(不是 stub 出来的假阳性),据此验证:①不静默使用 predictedPool ②`throw` fail-closed ③`consolidated_pool_verify_drift` 事件正确写入 ④payload 含 `redeemFresh`/`driftReason` 两个诊断字段(NWT 观察 b 已折入)。
- **诚实标出的覆盖缺口(不假装测了)**:Tier2 **命中**(genesis-walk 真的从链上找回正确 consolidatedPool 并自愈写回)这条正向路径,需要一段**真实、有资金流动**的 consolidate 序列(genesis UTXO→逐 shard consolidate→最终 outpoint 有真实余额)——这不是能安全 mock 出来的场景(money-path 语义, 见 memory `feedback-ship-features-with-live-fire-test`:"review 通过≠真跑过一次,money-path 改动 merge 前必须真钱走一遍具体分支")。**这条留作 Owner money-path 签发前的实弹验证项**(§4 DoD 第2条: 三源 co-verify 需要在一个真实/近真实的 bshard 市场上跑,不是本卡离线单测能替代的)。
- 未按原计划放进 `test-framework/cases/predictions/`(persona/journey 高层测试框架),改放 `kasia-console/src/services/*.test.mjs`(与 `bshard-recapture-shard-loop.test.mjs`/`broker-fee-emit-package-switch.test.mjs` 同款自举模式——自建 temp DB + 真实模块调用,不经 test-framework 的 persona 层),因为本测试是函数级白盒回归(直接调 `consolidateAndBuildPsState` 断言内部分支行为),不是端到端业务场景,套用后者会话式框架反而不匹配这类测试的形状。跟现有代码库同类测试(`git log --oneline -- '*.test.mjs'` 下 `src/services/`)风格一致。

---

## 3b. K-18 §3.4 落地:recompile→splice 权威收敛(2026-07-21,Codex MUST-FIX4 触发,v0.3 新增)

**问题(Codex 对抗审查坐实, coord/codex-bridge 2a10f5e8)**: v0.2(6cff7305)的 Tier1/Tier2 虽然正确重新派生了 `consolidatedPool` **数值**,但函数最后仍统一走:
```js
const redeem0 = compilePayoutShardRedeem({ poolMerkleRoot: ps.pool_merkle_root, predicateCommit: ps.predicate_commit, consolidatedPool, closed: 0 });
```
这是**重编译**(过 silverc 子进程), 产出的 `redeem_hex` 经 `bshard-auto-settler.mjs:340/547/750/756/820` 直接进 `inputs.payoutshard.redeem_hex` 建实际花费交易——是真花费权威,不是校验用途。团队 8pson 事故(2026-07-17)后已拍板 K-18/DEC-20260718-001:**权威只能是"落地 redeem + 确定性 splice"**(与 relay/`consolidateAllShards` 同源,继承链上真实字节,永不跟链分歧),recompile 依赖本机 silverc 构建跟当年铸造那台机器字节一致——任何版本漂移都会产出错误字节、构造出错误地址(8pson 同款分叉)。K-18 §3.4(`docs/2026-07-18-payoutshard-family-coherence-gate-design.md`, NWT 7/18 GREEN)对这条已有精确设计,只是从未落码——本节即该设计落到 `consolidateAndBuildPsState` 这一个函数的最小范围实现(K-18 全案的 `covenant_family` 列 + `assertPayoutShardCoherence` 四步门等更大范围不在此次改动内,归 K-18 全案后续)。

**修法(三处改动,均已落码 commit 待定,详见 diff)**:
1. `autoDetectConsolidateResume`(`pool-shard-settle.mjs:345-372`)genesis-walk 过程本来就是逐步 `writeBigInt64LE` 的 byte-splice,不是 recompile——之前只 `return {pool}` 数值,现在把已经算好的 `psRedeem` bytes 一并 `return {..., redeemHex}` 交出去,消费方不必再重编译一次。
2. `consolidateAllShards`(同文件 :381-441)内部循环同样全程 splice(:436 `rbuf.writeBigInt64LE`),之前只 `return {consolidatedPool}` 数值,现在同样多 `return {..., redeemHex: psRedeem}`。
3. `consolidateAndBuildPsState`(`bshard-settle-daemon.mjs`)三条路径各自把 `psRedeemHex` 设为**权威字节**而非重编译结果:
   - `needConsolidate=true` 分支:直接用 `res.redeemHex`(来自改动2);自愈写回同批覆盖 `payout_ps_outpoint` **和** `payout_redeem_hex` 两列(NWT finding⑤:此前只写一列,两列配对可能不一致)。
   - Tier1 命中分支:`ps.payout_redeem_hex` 本身已经被独立验证过新鲜(链上观测地址与之匹配),直接原样使用,零编译零 splice(存量字节本来就对)。
   - Tier2 命中分支:用 `resumePoint.redeemHex`(来自改动1);自愈写回同样覆盖两列。
   - 函数末尾原本无条件的 `compilePayoutShardRedeem` 调用**降级为非阻塞校验**——recompile 出来跟 `psRedeemHex` 比对,不一致只 `log` + 写 `ps_redeem_recompile_mismatch` 事件(供未来 K-18 backfill 报告积累证据),**不 throw、不影响返回值**——K-18 §5 DoD-0 明确说这条硬闸的前提(backfill dry-run 报告确认没有在途盘会被误伤)没做之前不能变成拒绝闸,否则"治本操作自己制造一批盘静默卡住的新危机"(K-18 原文原话,同 8pson 教训同源)。

**未完成的 K-18 硬前置(不可跳过,本卡不满足就不能真正切换成 hard gate,当前只是 soft 校验+日志)**:
- backfill dry-run 报告(K-18 §5 DoD-0, NWT MUST-FIX①):对生产库全部 `payout_shards` 行跑只读探针,产出总行数/家族分布/unknown 行是否对应在途盘的报告。
- 现网全量 V1 活跃盘 splice-vs-recompile byte-exact 对照(K-18 §3.4 硬性前置, NWT MUST-FIX②):不能抽样推断("理论上相等"已被反复打脸,`feedback-retry-consistency-proves-determinism-not-correctness`)。
- **两者都需要生产库访问 + pinned silverc 二进制,本机(J1tn,:3300 独立节点)都没有**(`payout_shards` 本地 0 行是老问题;`D:/silverscript/versioned-builds/` 本机不存在)——已在频道请 KANet-UI 协助在有权限的机器上跑。

**回归测试新增**(`bshard-consolidated-pool-rederive.test.mjs` scenario C):用 `autoDetectConsolidateResume` 接受的可注入 `getUtxos` stub(离线,无需真实链)直接验证新增的 `redeemHex` 返回字段——byte-exact 等于手工构造的 splice 结果、decode 出的 `consolidatedPool` 与预期值一致。这是真正的白盒单测(不是集成/mock 出的假象),覆盖了 K-18 §3.4 这次改动的核心断言:**消费方拿到的是 splice 字节,不是重新编译的字节**。

---

## 4. 相邻但独立的问题:claim-thread 的 line 423 presence-trust 点

`settleMarketLive`(`bshard-auto-settler.mjs:423`):
```js
const consolidatedPool = priorEvidence?.consolidated_pool || (BigInt(plan.poolSompi) + BigInt(ctx.psSeedSompi ?? 20000000)).toString();
```

这是**另一个函数、另一个调用点**,不在 `consolidateAndBuildPsState` 内,NWT MUST-FIX③ 原文没有点名它,但今晚 J2/NWT 频道讨论(20:40-20:41Z)已确认:这是一个"presence-trust"(只要 `priorEvidence.consolidated_pool` 存在就信,不管新鲜度)模式,风险类别与 MUST-FIX③ 相同,且**P1(evidence preserve-merge)明确不该管这条**(J2/NWT 一致结论,merge 只是持久化机制不是新鲜度校验)。

**本方案的立场**:这个点**在概念上应该复用本方案的 Tier1/Tier2 校验**(`priorEvidence.consolidated_pool` 存在时,也应该核实它是否对应链上仍未花费/仍是最新的 consolidate 状态,而非直接信),但它是**独立的第二处改动**,不在本次 §2 的最小 diff 范围内(不同函数、不同数据流入口——`priorEvidence` 来自 `settle_evidence` JSON,不是 `payout_shards` 表)。

**建议排期**:标记为 **P0 直接后续**(不并入 P2,因为 NWT/J2 已明确判定这条的安全性"本来就系于 P0"),但作为 §2 落码 + 过 NWT 复核之后的**第二个小 PR**,复用同一套 Tier1/Tier2 helper(届时可以把 §2 的验证逻辑抽成一个可复用函数,例如 `verifyConsolidatedPoolFresh(marketId, candidatePool, ctx)`,两个调用点共用)。不在本方案第一版 diff 里一次性铺开,理由:①范围收紧,NWT 复核负担小;②`consolidateAndBuildPsState` 是 85fit 当晚实际炸的那条路径,优先级更高;③claim-thread 这条目前没有已知实例真的因它出过事(85fit 那次的根因是 :423 之前的 `consolidateAndBuildPsState`,不是 :423 本身),风险是理论性的但已被点名,不能不排,只是不需要挤进第一批。

---

## 5. DoD(补充 §6,继承全案 §6)

1. §2 Tier1/Tier2 落码 + §3 三个回归测试场景(孤儿盘 e2e / close 后-claim 中途重启 / **consolidate 中途重启,本卡新增**)全绿。
2. 三源 co-verify:链上真值(独立 RPC 查询) vs Tier1/Tier2 re-derive 值 vs 一致性校验通过态——孤儿盘、正常盘、consolidate-中途重启盘各跑一遍。
3. §4 的 claim-thread line 423 改动作为**第二个 PR**,不阻塞本卡落码,但需在本卡 merge 后 24h 内提出(不能无限期挂起)——Codex 建议"line423 要么一起审一起上,要么 P0 落码但不激活直到同款改完",与本条排期口径的分歧待 NWT/Bettor 定夺,不由本方案单方面决定。
4. **§3b(K-18 §3.4 splice 权威)DoD, v0.3 新增, 硬前置(不可跳)**: backfill dry-run 报告(K-18 §5 DoD-0)+ 现网全量 V1 活跃盘 splice-vs-recompile byte-exact 对照(K-18 §3.4 硬前置, NWT MUST-FIX②)均完成、报告经人工过一遍确认无在途盘被误伤,**才能**把 §3b 当前的"非阻塞校验+日志"升级为真正的 hard gate(拒绝不一致的 redeem)。本机(J1tn)不具备执行这两项前置的条件(无生产库/无 pinned silverc),需 KANet-UI 或有权限的机器执行。
5. money-path(🔴)签发:本卡改动改变结算构造值 **及** 花费权威来源(`consolidatedPool` 数值 + `redeem_hex` 字节双重收敛),按全案 §5 门禁,需 NWT 红队对 v0.3 diff 出具新 verdict(首版 GREEN 已撤回)+ 本 DoD 1-2-4 完成后一次性 Owner money-path 签发(不分批打扰,同全案 §7 第6条口径)。**在此之前 6cff7305 及后续 commit 均只落码入库、不装载(console 不重启加载)、不申请 Owner 签发。**

---

**关联**: `docs/2026-07-21-28-state-sync-architecture-full-design.md`(649950ff)、`docs/2026-07-21-NWT-redteam-28-state-sync-full-design.md`(f1a16daa)、`docs/2026-07-20-28-state-sync-convergence-design.md`(05ff33ab)、`docs/DECISIONS.md`、频道 dev-coord-testnet 2026-07-21 20:2x-20:4x(#28 派工+P1 讨论)。
