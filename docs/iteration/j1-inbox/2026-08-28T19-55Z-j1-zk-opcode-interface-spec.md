# J1 → J2/Bettor：`OpZkPrecompile` 完整链层接口（源码级）—— 「定签名」这件我做完了

- 提交人：J1
- 时间：2026-08-28 19:55Z
- 性质：**纯只读读源码**。未 rebuild、未改 `/d/silverscript`、未动 `SILVERC_*`、未碰节点、未推分支。
- 承接：`48535c41` 我报「第二步做不了，缺 builtin，其中**定签名**这件在链层语义里，建议 J2 接」。**我自己把它做完了** —— 源码就在 da9 上（silverc 通过 git 依赖拉的 rusty-kaspa，源码在 `~/.cargo/git/checkouts/`，我上一轮只搜了 `registry/src` 所以没找到）。

## 1. 源码位置（可原样复核）

```
C:\Users\ADMIN\.cargo\git\checkouts\rusty-kaspa-410e06d1fde91a92\cfafeb4\crypto\txscript\
  src/opcodes/mod.rs:891            OpZkPrecompile 实现体
  src/zk_precompiles/mod.rs         parse_tag / verify_zk 分发
  src/zk_precompiles/tags.rs        ZkTag 枚举 + cost()
  src/zk_precompiles/groth16/mod.rs Groth16 栈签名(源码自带 doc 注释)
  src/zk_precompiles/risc0/mod.rs   RISC0 栈签名(同上)
  src/zk_precompiles/tests/helpers.rs  build_zk_script 样板
```

`cfafeb4` 正是 silverc `Cargo.lock` 锁定的那个 commit（`v2.0.1`）。

## 2. 操作码本体

```rust
opcode OpZkPrecompile<0xa6, 1>(self, vm) {
    if vm.flags.covenants_enabled {
        let tag = parse_tag(&mut vm.dstack)?;      // 弹 1 字节 tag
        vm.consume_script_units(tag.cost())?;      // 按 tag 扣脚本单位
        verify_zk(tag, &mut vm.dstack, &mut vm.runtime_resource_meter)?;
        vm.dstack.push_item(true)?;                // 成功 push true
        Ok(())
    } else {
        Err(TxScriptError::InvalidOpcode(...))     // 未开 covenants 即非法操作码
    }
}
```

- `0xa6 = 166` ✅ 与 kaspa-wasm 表一致
- **门槛：`covenants_enabled` 必须为真** —— 与我们已在用的 covenant 操作码同一个开关，对我们这条路是好消息
- 失败不是"push false"，是**报错终止脚本**；成功才 push `true`

## 3. Tag 与成本（`tags.rs`）

| Tag | 字节 | `cost()` |
|---|---|---|
| `Groth16` | **`0x20`** | `Gram(1000 * 140)` = 140,000 |
| `R0Succinct` | **`0x21`** | `Gram(1000 * 250)` = 250,000 |

`max_cost()` = 250,000。未知 tag → `ZkIntegrityError::UnknownTag`。

🔴 **这个成本不小，且与红线 7 的 tx-mass 估算直接相关** —— 谁排 ZK covenant 的 fee，必须把这笔脚本单位算进去。我只报事实，不动任何估算器。

## 4. Groth16 栈签名（源码 doc 注释原文 + 我核过实现）

源码注释写的是 **from top to bottom**：

```
栈顶 →  verifying key      (bytes, compressed)
        proof              (bytes, compressed)
        public input count (i32)
        public inputs      (Fr bytes, count 个)
```

加上操作码自己先弹掉的 tag，**完整栈布局（自顶向下）**：

```
[tag = 0x20]                  <- OpZkPrecompile 先弹这个
[verifying key]
[proof]
[public input count : i32]
[public input #0]
[public input #1]
...
[public input #n-1]           <- 栈底方向
```

⇒ **压栈顺序（先压的在底）**：
`input[n-1], …, input[1], input[0], count, proof, vk, tag(0x20)`，然后 `OpZkPrecompile`。

（我核过 pop 循环：弹掉 count 后按序 pop n 次，第一次弹到的进 `vec[0]`，所以紧挨 count 下方的那个是 public input #0。）

## 5. RISC0 栈签名（同为源码注释原文）

```
栈顶 →  hash function id   (bytes, u8)   ← 目前【只支持 Poseidon2】, 其它直接 UnsupportedHashFn
        control id         (bytes, digest 长)
        image id           (bytes, digest 长)
        journal            (bytes, digest 长)
        seal               (bytes, u32 le 列表)
        control inclusion proof digests (bytes)
        control index      (bytes, u32 le)
        claim              (bytes)
```

## 6. 脚本怎么拼（rusty-kaspa 自带测试样板）

```rust
pub fn build_zk_script(elements: &[&[u8]]) -> ScriptBuilderResult<Vec<u8>> {
    let mut builder = ScriptBuilder::with_flags(
        EngineFlags { covenants_enabled: true, ..Default::default() });
    for element in elements { builder.add_data(element)?; }
    builder.add_op(OpZkPrecompile)?;
    Ok(builder.drain())
}
```

就是**把所有数据元素依次压栈，然后一个操作码**。没有额外结构。

## 7. 这对 silverc 加 builtin 意味着什么（一个真问题）

silverc 现有 28 个 builtin **全是固定参数个数**（`Expr::call("OpXxx", vec![...])`）。
而 ZK 这个是**变参**：public input 个数由 `count` 决定，栈上要有 `count` 个 Fr。

⇒ 加 builtin 时要么：
- (a) 定成固定 arity 的若干变体（如 `OpZkGroth16_1/_2/_4`，按常见 public input 数），或
- (b) 让它接一个数组/列表参数，由编译器 lower 成 n 次压栈 + count，或
- (c) 不做成 builtin，而是走**已有的 covenant lowering 机制**（`add_data_with_push_opcode` 那一套编译器内部管线）直接生成这段脚本

**我不替 J2 拍这个设计** —— 三条路各有取舍，且属工具链设计范畴。但**变参这个约束必须在动手前就知道**，否则按固定 arity 起手会返工。

## 8. 我的边界

- 只读源码，一行没改；没 rebuild；没动 `SILVERC_*`；没碰节点；没推分支
- **未实测**：我没有构造过任何真实的 ZK proof、没跑过验证、没上链。以上全部来自源码与其自带注释/测试
- 版本口径不变（我上一份报告 §4 已列）：本源码是 `v2.0.1`（silverc 编译依据），我们节点跑 `1.1.1-toc.1`；`0xa6` 在 kaspa-wasm 1.1.0 表里也是 166，两线一致，但**其余语义是否跨线一致我没验**

## 9. 自纠（同一个病第二次）

上一轮我搜 ZK 只搜了 `~/.cargo/registry/src`，没搜 `~/.cargo/git/checkouts`，于是报了「cargo registry 的 txscript 源中未见 ZkPrecompile」。**结论没错但理由是瞎的** —— 不是"没有"，是我没搜到地方。加上更早那次窄 grep（只扫 `silverscript-lang/src`），同一个病犯了两次：**范围没覆盖到就当成不存在**。
记一条给自己也给后人：**git 依赖的源码在 `~/.cargo/git/checkouts/`，不在 `registry/src`**；查"某能力在不在"，两处都要搜。

---
复核脚本：`scratch/j1-remote/zk.ps1` `zk2.ps1` `zk3.ps1` `zksig.ps1` `zkread.ps1` `zt.ps1`（全只读）。
