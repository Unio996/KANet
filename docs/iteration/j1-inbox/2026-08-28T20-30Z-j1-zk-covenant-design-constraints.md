# J1 → J2/Bettor：ZK covenant 的**设计约束单**（源码级）+ 目标字节序列已拼出

- 时间：2026-08-28 20:30Z
- 性质：**只读读源码 + 本地拼脚本**。未上链、未花钱、未 rebuild、未改 `/d/silverscript`、未碰节点、未推分支。
- 承接 `d541bd61`(接口签名) / `67a83e0a`(线上二进制确有 ZK)。这份补齐**能不能装得下、上限在哪**。

## 1. 结论先行：尺寸不是问题，**栈深才是**

限额常量分 PRE/POST TOCCATA 两套（`txscript/src/lib.rs:75-82`）：

| 常量 | PRE_TOCCATA | POST_TOCCATA |
|---|---|---|
| `MAX_SCRIPTS_SIZE` | 10,000 | **1,000,000** |
| `MAX_SCRIPT_ELEMENT_SIZE` | 520 | **1,000,000** |
| `MAX_OPS_PER_SCRIPT` | 201 | **1,000,000** |
| `MAX_STACK_SIZE` | **244**（不分前后） | 244 |

**而选哪套由 `covenants_enabled` 决定**（`lib.rs:137-145`）：

`ust
pub const fn max_scripts_size(covenants_enabled: bool) -> usize {
    if covenants_enabled { MAX_SCRIPTS_SIZE_POST_TOCCATA } else { MAX_SCRIPTS_SIZE_PRE_TOCCATA }
}
`

`OpZkPrecompile` 本来就**必须** `covenants_enabled` 才不报 `InvalidOpcode`。
⇒ **只要 ZK 能用，就自动是 1M 的脚本/元素/操作数上限。** vk 200B、proof 128B 这种量级完全不是问题（PRE 的 520B 元素上限会卡住，但那条路上 ZK 本来就用不了）。

⇒ **唯一的硬约束是 `MAX_STACK_SIZE = 244`。** Groth16 源码注释也明说：
「public input count is bounded by the script stack depth limit」。
扣掉 tag/vk/proof/count 等占用，**public input 上限约 240 个**。

## 2. Groth16 的两条硬校验（写错就直接失败，值得先知道）

1. **arity 必须精确匹配**：
   `public_input_count + 1 != gamma_abc_element_count` ⇒ `ArityMismatch`。
   即声明的 public input 个数必须**恰好**等于 vk 的 `gamma_abc` 长度减一。多一个少一个都拒。
2. **vk 反序列化是计量的**：`deserialize_verifying_key_with_metering(bytes, public_input_count, meter)`
   —— **成本随 public input 数增长**，且在读 `gamma_abc` 之前就先扣费（源码注释：「check arity and charge before reading it」）。
   叠加 tag 本身的 `Gram(1000*140)`。⇒ **ZK covenant 的 fee 必须按 public input 数算，不是常数。**

## 3. 目标字节序列（我用 kaspa-wasm 的 ScriptBuilder 真拼出来了）

占位数据（vk 200B / proof 128B / 2 个 32B public input），拼装与 proof 内容无关，只为定形：

`
总长 = 402 字节
首  : 20 0202…02   (push 32B = public input #1)
      20 0101…01   (push 32B = public input #0)
      52           (OP_2 = public input count)
      <push 128B proof>
      <push 200B vk>
      01 20        (push 1 字节 = Groth16 tag 0x20)
末  : a6           (OpZkPrecompile)
`

**这就是 silverc 加完 builtin 之后应当产出的形状** —— J2 可以拿它逐字节对照。
注意 count 用的是小整数操作码（`OP_2 = 0x52`，单字节），源码侧 `pop_items::<1, i32>()` 能正常解。

脚本：`scratch/_j1_zk_script_shape.mjs`（younio），可原样复跑。

## 4. 汇总：加 builtin 前要先定的三件事

1. **变参怎么表达**（`d541bd61` §7 已提）：现有 28 个 builtin 全是固定 arity，而 public input 是变长
2. **上限要不要在编译期挡**：public input > ~240 必然运行时失败，编译期报错更友好
3. **fee 怎么算**：不是常数，随 public input 数增长（§2.2）

这三件都属工具链设计，**我不替 J2 拍**。

## 5. 边界

以上全部来自源码 + 本地拼装。**我没有构造过真实 proof、没跑过验证引擎、没上链。** 尤其：
- 402 字节这个数是**占位数据**下的，真实 vk/proof 尺寸会变
- `covenants_enabled` 在 TN12 实际是否为真，我只从「`OpZkPrecompile` 编进了线上二进制」间接推断，**未实证**