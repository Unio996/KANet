# T3 v0.3 落码留痕 — 四处 draw-down MUST-FIX（§3.0.1）+ 必要 v1.0.0 兼容修复

对应 `docs/2026-09-13-j2-t3-market-set-token-rewrite-design-v0.1.md` §3.0/§3.0.1 MUST-FIX，Bettor ledger 1121 GREEN
放行落码。四处：`PayoutShard.claim` / `PayoutShard.refund_claim` / `PayoutShardV2.refund_claim` /
`RootClaim.claim_draw`，逐条实现同一不变量：`remaining==0 ⇒ 无续约输出；remaining>0 ⇒ 恰一续约且 amount(此处是
KAS value，代币化在 T1 v0.6/T3 v0.3 tokenization pass 之后)==remaining`。

## 落码前必须先解决的编译期阻断（本次顺手发现，非本次改动引入 — 这三个文件此前从未在 v1.0.0 工具链下完整编译过
entry body，此前的 `-c` 空 ctor 编译只走到 ctor-arg-count 检查就提前退出，从未触达这些函数体的类型检查）

四类真实 v1.0.0 迁移坑，均已修复，MANIFEST 内 diff 可查：

1. **`entrypoint function` → `entry`**：PayoutShard.sil / PayoutShardV2.sil 逐个入口关键字迁移(RootClaim.sil 的
   `claim_draw` 此前已迁移)。
2. **裸 struct 字面量 → `State { ... }`**：9 处 `validateOutputState(selfOutIdx, { ... })` 补 `State` 前缀
   (PayoutShard.sil ×5, PayoutShardV2.sil ×4)。
3. **P2PK scriptPubKey 宽度 34→36 字节**：`ScriptPubKeyP2PK` 在 v1.0.0 实测(`silverscript-lang/src/compiler/
   builtin_types.rs:119` `byte_array(ArrayDim::Fixed(36))`)返回 byte[36]，不是旧稿的 byte[34]——6 处声明修正
   (PayoutShard.sil ×2, PayoutShardV2.sil ×1, RootClaim.sil ×1, CloseZkV2.sil ×2；CloseZkV2.sil 顺手一并修，
   该文件其余 entrypoint/State{}/两参 byte[] 迁移仍未做，不在本次范围)。
4. **两参 `byte[](x, N)` cast 移除，改 `x as byte[N]`**：v1.0.0 breaking change(同 memory
   `reference-silverscript-v1rc1-breaking-changes-and-oppick-fixed-upstream` 已记录的"两参 byte[](x,n) 移除"，
   本次是第一次真正撞上并修复的具体案例)。PayoutShard.sil ×2 / PayoutShardV2.sil ×7(含 `byte[1](literal)` 单字节
   字面量同款迁移) / RootClaim.sil ×1。
5. **零散一处**：PayoutShardV2.sil `zk_handoff` 的 `tx.outputs[..].scriptPubKey == new ScriptPubKeyP2SH(...)`
   缺 `byte[](...)` 动态转型(P2SH 返回 byte[37] 定长，不能直接跟 `byte[]` 动态比较)——补上，逻辑不变。

**范围说明**：以上 5 类修复只覆盖 `PayoutShard.sil`/`PayoutShardV2.sil`/`RootClaim.sil` 三文件，`CloseZkV2.sil`
仅顺手修了 P2PK 宽度（因为不修就连这三个文件都编不过——CloseZkV2 不在改动范围内, 但同一份 `byte[34]`模式扫描时
一并发现）；`CloseZkV2.sil`/`FoldNode.sil`/`RootClose.sil`/`ShardLeaf.sil`/`ShardLeaf_direct.sil` 的
`entrypoint function`/两参 `byte[](x,n)` 迁移仍未做——这些文件目前仍不能在本工具链下完整编译 entry body，是
T3 v0.3 全量 23 入口落码前必须先扫一遍的独立阻断项，本次未展开（不在四处 draw-down 范围内）。

## 向量结果：16/16 PASS（`PayoutShard.run.log` 8/8、`PayoutShardV2.run.log` 4/4、`RootClaim.run.log` 4/4）

覆盖 §3.0.1 最少向量集①②③④⑤的核心形（四处各 4 条：exact-payout 无续约 pass / partial-payout 恰一续约且金额
正确 pass / partial 续约金额错 fail / partial 续约缺失 fail）：

- `PayoutShard.claim`(closed==1) / `PayoutShard.refund_claim`(closed==2)：`RootClaim.sil`同款merkle-bound draw-down,
  depth-10 payout merkle-proof + 17-word×63-bit nullifier 位图，向量含真实构造的 merkle 证明与位图更新值。
- `PayoutShardV2.refund_claim`：结构与 PayoutShard.refund_claim 完全一致(该文件 5 处相对 PayoutShard 差异声明
  "逻辑一字不动"，本次验证成立)，额外核对 4 个透传字段(attestedWinner/attestedAtMs/betsRootBaked/refundRootBaked)
  在续约输出里原样透传不变。
- `RootClaim.claim_draw`：depth-1 cap merkle-proof(DoD 2-winner 上限) + dust-ticket spent-once 读(真实编译
  `PoolSideStub.sil` 替身实例，`readInputStateWithTemplate` 全字节码 signature_script_hex 同 T1 v0.2 探针已踩坑
  的约定)+ claimed_bitmap 位图更新。

## 已知未覆盖（如实记录，非漏洞）

- 未测 `merkle_index` 越界/位图重复置位等**既有**(非本次改动)校验分支——那些逻辑本次未动，且已有历史向量覆盖
  (推定，未在本次重新验证；T3 doc 未把它们列入本次 MUST-FIX 范围)。
- `PayoutShard.close_attest`/`cancel_attest`(B 类，committee 签名验证)本次仅确认能编译通过(v1.0.0 迁移后)，
  未构造真实 5-of-5 委员签名向量验证——委员逻辑本次"一字不动"，且构造真实 depth-8 committee merkle proof + 5 个
  真实签名超出本次改动范围，留给 T3 v0.3 全量 A/B 落码时一并做。
