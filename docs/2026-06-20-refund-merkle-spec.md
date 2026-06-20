# Refund-Merkle SPEC (RefundClaim R7 — 防 re-mint 双退/盗池)

**状态**: 设计定稿(SPEC, 非全建)。post-DoD tracked 小尾。J1 2026-06-20。
**当前 interim 防护**: refund 路 gate-off via closed-XOR 结构不可达(refund_payout require(closed==2), 仅市场取消态;
DoD settled 市场 closed==1 → refund 路全程不触发, 漏洞 dormant)。本 SPEC 定稿"市场真取消时"的根治设计。

## 1. R7 refund 漏洞(精确)

`RefundClaim.refund_payout`(kasia-console/src/lib/RefundClaim.sil):
```
Tk tk = readInputStateWithTemplate(ticketInIdx, ..., ps_tmpl_hash);  // 验 ticket 是 PoolSide template
require(tk.shardPoolId == shard_pool_id);
require(tx.outputs[payoutOutIdx].value == tk.stake);                  // 付 ticket 自报 stake
validateOutputState(..., pool_value: pool_value - tk.stake);         // draw-down
```
**漏洞**: refund_payout 唯一的 ticket 校验 = `readInputStateWithTemplate(ps_tmpl_hash)`(ticket 的 P2SH 派生自 PoolSide 模板)
+ `tk.shardPoolId == shard_pool_id`。这两条**只证 ticket 是"valid PoolSide 模板的 UTXO"**, **不证它是 register 真造的 genuine ticket**。

**攻击(pool drain / 盗池)**: 攻击者锁 dust 到 PoolSide-ticket P2SH, state 自选 `{bettorPk: 攻击者, direction: 任意,
stake: X, shardPoolId: 本 pool}` → 该 UTXO 过 readInputStateWithTemplate(它确是 valid 模板)+ shardPoolId 匹配 →
refund_payout 付 X 给攻击者 + pool_value -= X。**重复 re-mint 不同 stake 的假 ticket → drain 整池到攻击者**, genuine
bettor 退不到(池被掏空)。pool_value draw-down 只 bound 总额≤池, 不阻止"退给假人"= 盗。

**根因**: refund_payout **无 genuine ticket 集的链上承诺**。对比 `RootClaim.claim_draw` 有 `payoutRoot`(委员 close 时
盖章 winner 集+金额, claim 必 merkle-prove ∈ payoutRoot)= 真集锚; refund 路**没有对应 root**(refund_flip 是 permissionless
timeout 取消, 无委员盖章), 所以任何 valid-template ticket 都能退。dust-ticket UTXO 的 "spent-once" 也无用——re-mint 造的是
**新 UTXO 新身份**, spent-once 只防同一 UTXO 重花, 不防 re-mint 新身份。

## 2. 根治设计 A: refundRoot(refund-merkle, 推荐, 对称 claim)

**核心**: 累积一个 `refundRoot` 承诺 **genuine ticket 集** `{ leaf_i = blake2b(bettorPk_i ‖ ser(stake_i, 8)) }`,
贯穿 register→fold→seal→RootClose→RefundClaim。refund_payout 改为:
```
// (1) genuineness: ticket leaf 必 ∈ refundRoot (merkle membership, 复用 claim_draw 的 climb 机制)
byte[32] leaf = blake2b(byte[](tk.bettorPk) + byte[](tk.stake, 8));
... merkle climb (siblings, refund_index) ... require(cur == refundRoot);
require(refund_index < div);                          // R7 aliasing fix (同 RootClaim)
// (2) double-refund nullifier: claimed-bitmap slot 未退过 (同 RootClaim R7 bitmap)
int mask = 2^refund_index; require((refunded_bitmap / mask) % 2 == 0);
// (3) 付 stake + draw-down + 置位 bitmap
require(tx.outputs[payoutOutIdx].value == tk.stake);
validateOutputState(..., pool_value: pool_value - tk.stake, refunded_bitmap: refunded_bitmap + mask);
```
**效果**: re-mint 假 ticket 的 leaf ∉ refundRoot → merkle 失败 BUST(挡盗池); 同一 genuine ticket 重退 → bitmap slot
已置位 BUST(挡双退)。= 与 claim 的 payoutRoot+bitmap **完全对称**, 复用 RootClaim 已验的 merkle+bitmap+aliasing-fix 机制。

**build scope(为何"非全建")**: 需 `refundRoot` 字段贯穿全 cascade state:
- `register_append`: 每注 append `blake2b(bettorPk ‖ stake)` 到 refundRoot 累积器。**难点**: 增量 append-only merkle
  (register 是流式收注, 不能一次性建树)。两选: (a) 增量 merkle(每 register O(log N) 更新 root, 复杂); (b) 流式 hash-chain
  `refundRoot = blake2b(refundRoot_old ‖ leaf_new)`(O(1)/register, 但 membership proof O(N) = refund 时需全链, 不实用大 N)。
  DoD 单小市场 N 小 → hash-chain 够; 大市场 → 增量 merkle。
- refundRoot 经 fold(merge child roots)→ seal → RootClose(7→8 field)→ RefundClaim(+refunded_bitmap)。**state 加 2 字段**
  (refundRoot + refunded_bitmap)→ 各合约模板字节 +~64B, 须重 probe SIZE(refund 侧 RefundClaim 606B + ~122B ≈ 728B <790 预算 OK,
  但 register/fold/RootClose 加 refundRoot 字段须重验 register monolithic + seal WithTemplate)。

## 3. 替代设计 B: covenant-lineage(可能超越 A; Bettor flag)

不累积 refundRoot, 而用 **ticket 的 covenant 创建血缘**证 genuineness: ticket 若由 genuine register_append 的 covenant
链造(可追溯到 genesis pool 的 register), 则 re-mint(非经 register 造)无正确血缘 → 拒。
- **前提**: 当前 PoolSide ticket 经 `validateOutputStateWithTemplate`(一次性 foreign-template)造, **无 covenant 血缘**,
  re-mint 产同模板。要用血缘需 ticket 携带 register 出处证明(ticket state 加 back-ref 到 register tx/leaf, spend 时验)=
  改 ticket 合约 + register 造票逻辑。
- **何时超越 A**: 若 covenant-lineage 机制为【别的需求】(如 ticket 可转让审计 / 跨 pool 防伪)已建, 则 refund 复用它证
  genuineness, 省掉 refundRoot 累积(register/fold 不动)。**但纯为 refund 单独建血缘 ≠ 比 A 省**(A 复用 claim 已验机制)。

## 4. 推荐 + scope

- **推荐 A(refundRoot)**: 对称 claim, 复用 RootClaim 已链上验的 merkle+bitmap+aliasing-fix, 风险低。build = refundRoot
  累积(register 增量)+ state +2 字段贯穿 + 重 probe SIZE。**中等工程**(touches register/fold/seal/RootClose/RefundClaim)。
- **B(covenant-lineage)**: 仅当血缘机制为别的需求已建时复用, 否则不比 A 省。
- **interim(当前)**: gate-off 结构不可达(settled 市场不触发 refund)= DoD-safe。**真上线"市场可取消"前必建 A**(否则取消市场可被盗池)。
- **优先级**: post-DoD。market-cancel 是 edge case(timeout 无委员盖章), settled 是主路。先 ship settled(claim 路全验),
  cancel 路上线前补 A。

## 5. 不变量(A 落地必守)
- refundRoot genuineness: leaf=blake2b(bettorPk‖ser(stake,8)), 排序/索引必与 register append 序一致(同 claim payoutRoot 的 pk-ASC 约定对齐)。
- refunded_bitmap nullifier: 同 RootClaim — `require(refund_index < div)` aliasing-fix(防 index 别名双退)+ `2^index` mask 复用 loop。
- value 守恒: Σrefund == pool_value(全退完池清零), 每笔 draw-down weld `out.value == pool_value - tk.stake`。
- closed==2 gate 不变(仅取消态)。R1-XOR(refund_flip 留 RootClose)不变。
