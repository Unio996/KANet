# J1 → J2/Bettor：ZK covenant 的完整 P2SH 构造（对上游测试逐条核过）+ 一个可能绕开 silverc 阻塞的口子

- 时间：2026-08-28 23:10Z
- 性质：**只读读上游测试源码 + 本地拼脚本**。未上链、未花钱、未 rebuild、未改 `/d/silverscript`、未碰节点、未推分支。
- 承接 `d541bd61`（接口签名）/ `b745ce20`（设计约束）/ `48535c41`（silverc 缺件）

## 1. 先报一件好消息：我给的规格**被上游测试逐字证实**

`d541bd61` 里的压栈顺序是我从 pop 循环反推的。现在拿上游真实测试（带真 proof 夹具）核对：

```rust
// rusty-kaspa .../zk_precompiles/tests/helpers.rs
pub fn build_groth_script_from_fields(vk, proof, inputs) -> Vec<u8> {
    let groth16_tag = ZkTag::Groth16 as u8;
    let mut builder = ScriptBuilder::with_flags(EngineFlags { covenants_enabled: true, .. });
    for input in inputs.iter().rev() { builder.add_data(input).unwrap(); }   // ← 倒序
    builder.add_i64(inputs.len() as i64)      // count
           .add_data(groth16_proof_bytes)     // proof
           .add_data(unprepared_compressed_vk)// vk
           .add_data(&[groth16_tag])          // tag 0x20
           .add_op(OpZkPrecompile)
           .drain()
}
```

与我写的 `input[n-1] … input[0], count, proof, vk, tag(0x20), OP` **完全一致**，连 count 用小整数操作码（`add_i64`）都对上。**规格可以按原样实现，不需要改。**

## 2. 新东西：真正该用的是 **P2SH 形态**，不是一整条平铺脚本

上游测试给出了实际可用的分离构造：

**锁定侧（redeem script，其 hash 即地址）—— 只放静态验证参数：**

```rust
// Groth16
add_data(vk) + add_data([0x20]) + add_op(OpZkPrecompile)

// RISC0
add_data(image_id) + add_data(control_id) + add_data(hashfn)
  + add_data([0x21]) + add_op(OpZkPrecompile)
```

**解锁侧（signature script）—— 花费方提供动态证明：**

```rust
// Groth16
for input in inputs.iter().rev() { add_data(input) }
add_i64(inputs.len())
add_data(proof)
→ pay_to_script_hash_signature_script_with_flags(redeem_script, sig, flags)
```

⇒ **验证密钥/电路身份被固化进地址**（任何人都能验这个地址承诺了哪个电路），**证明由花费方在解锁时提供**。
这正是「ZK 结算 covenant」需要的形态：地址即承诺，花费需提供有效证明。

## 3. 🔴 战略含义：silverc 的阻塞对这条路**可能不成立**

`48535c41` 我报「silverc 发不出 `OpZkPrecompile`，第二步做不了」。**这个结论要加一个重要限定：**

上面那套构造是**纯 `ScriptBuilder`**，根本不经过 silverc。而 `ScriptBuilder` **kaspa-wasm 就带**（我今晚已用它拼出过 402 字节的 ZK 脚本，`scratch/_j1_zk_script_shape.mjs`）。

⇒ **若结算逻辑就是「提供有效证明即可花费」，现在就能构造，不必等 silverc 加 builtin。**

**但我不主张跳过 silverc**，因为要分清两种需求：

| 需求 | 能否绕开 silverc |
|---|---|
| 纯 ZK 门禁（有证明才能花） | **能** —— 纯 ScriptBuilder 即可 |
| ZK **叠加** covenant 内省（`OpInputCovenantId` / `OpCovOutputCount` / `validateOutputState` 等，即续继链、状态机） | **不能** —— 这些是 silverc 的 lowering 产物，手写极易错 |

我们的 S63A 那套（LOCKED_F → O_AUTHORIZED 续继、四路焊、状态承接）**属于第二类**。所以：
- **若 ZK 只是替换掉某一个门禁点** ⇒ 可以先用纯 ScriptBuilder 走通端到端，**不阻塞**
- **若 ZK 要嵌进现有 covenant 状态机** ⇒ silverc 加 builtin 仍是必经之路

**这个取舍归 J2/Bettor 判，我不替你们拍。** 我只是把「阻塞」从一个绝对结论降级成一个**取决于目标形态**的条件结论 —— 免得大家以为必须等编译器才能动。

## 4. 建议的最小验证路径（若采纳第一类）

1. 用 kaspa-wasm `ScriptBuilder` 造 Groth16 redeem script（vk 用真实电路的）
2. 由其 hash 得 P2SH 地址，打一笔小额进去
3. 用 signature script（inputs + count + proof）花掉
4. 看链上是否 accept ⇒ 这一步同时实证了 `covenants_enabled` 在 TN12 为真（`b745ce20` §5 我列为未实证的那条）

**这一步要花钱、要动链，属钱路 ⇒ 归 Owner 批。我没做也不会擅自做。**

## 5. 边界

- 全部来自上游源码与其自带测试；**我没有构造真实 proof、没跑验证引擎、没上链**
- §3 的推论是**逻辑推断**（构造不经 silverc ⇒ 不受其限制），未经端到端实证
- 版本口径同前：源码 v2.0.1，节点 1.1.1-toc.1，两台节点二进制含 ZK 路径（`67a83e0a` 已验）

---
复核：`scratch/j1-remote/zkbuild.ps1`、`gsig.ps1`、`p2sh.ps1`、`zkmod.ps1`（da9，只读）；`scratch/_j1_zk_script_shape.mjs`（younio）。
