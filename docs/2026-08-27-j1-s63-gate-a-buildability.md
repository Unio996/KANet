# J1 · §3(a) buildability 交付 —— v0.15 构造依赖的原语可编译性（2026-08-27）

> **Status**: CURRENT · 回 `2026-08-27-bettor-j1-return-brief.md` §3(a) · 通道②
> 走的是 brief 给的**路 (i)**：**在本机（da9）用本机 silverc 编** = "我们编译的"口径。明写在此，不含糊。

## 1. 先厘清 §3(a) 的真问题

v0.15 构造稿（`docs/2026-08-21-j1-s6-3-A-covenant-construction-v0.15.md`）**本身没有 .sil 源**——它是规范体（normative body + `require(...)` 片段 + 原语来源表），真 covenant 未写（= Bettor 说的 pre-code）。因此"能否被 silverc 编出"不能理解为"编那份文档"。

读该稿的原语表（§ 表格）后，**唯一没有活合约先例的两条恰好是 MUST-FIX 2 收紧出来的形式**：

| 原语 | 先例 | v0.15 要求 |
|---|---|---|
| 唯一续继 | `ShardLeaf.sil:101` = `OpCovOutputCount(cid) >= 1` | **`== 1`**（MUST-FIX 2） |
| terminal 支禁续链 | 无先例（v0.12 引入） | **`== 0`** |
| 读非 active 输入 cov_id | `ShardLeaf.sil:99` `OpInputCovenantId(idx)` | 同 ✅ 已证 |
| 强制续链输出 | `ShardLeaf.sil:104` `OpOutputCovenantId(idx)==cid` | 同 ✅ 已证 |
| 时锁下界 | `ShardLeaf.sil:96` `tx.time >= X`（standalone） | 同 ✅ 已证 |

⇒ **§3(a) 的可判问题 = 那两条收紧形式（`==1` / `==0`）编译器收不收。** 其余已有上链先例。

## 2. 做法

写最小探针 `scratch/j1-s63a/S63A_PrimitiveProbe.sil`（4 支，逐支对应上表一种形态；**不是**完整 A-covenant，不做行为断言）：

- `reveal_exactly_one` —— 消费真 C + `OpOutputCovenantId==cid` + **`OpCovOutputCount(cid) == 1`**
- `terminal_no_continuation` —— **`OpCovOutputCount(cid) == 0`**
- `welded_two_legs` —— 同笔读两个输入的 cov_id（反向焊）+ `==1`
- `recovery_after_cutoff` —— `require(tx.time >= t_cutoff)` standalone（照构造稿注明的 parser 限制写）+ `==0`

## 3. 结果：编得出

```
# 语法层
silverc-zk-8065184.exe S63A_PrimitiveProbe.sil --ast-only   -> 退出码 0

# 完整编译(带 ctor)
silverc-zk-8065184.exe S63A_PrimitiveProbe.sil --ctor ctor.json -o probe.json -> 退出码 0
```

产物核对（`probe.json`）：

```
contract      : S63A_PrimitiveProbe
compiler      : 0.1.0
script 字节数 : 460 B
ABI: reveal_exactly_one(cInIdx, oOutIdx)
     terminal_no_continuation(inIdx)
     welded_two_legs(selfInIdx, peerInIdx, oOutIdx)
     recovery_after_cutoff(inIdx)
```

⇒ **四支全部编出字节码**；`OpCovOutputCount(cid) == 1` 与 `== 0` 两种收紧形式**编译器接受**。
脚本 460 B，距 `MAX_SCRIPTS_SIZE=10,000B` 与 register 侧 9999 units 约束都很宽（本探针不含 register 路径，仅作尺寸量级参考）。

ctor JSON 格式照生产代码 `kasia-console/src/lib/pool-bshard-artifacts.mjs:75-81`
（`ctorBytes32 = {kind:'array',data:[{kind:'byte',data:N}…]}` / `ctorInt = {kind:'int',data:N}`），未自造格式。

## 4. 阴性对照（判别力检查）

同一份 `.sil` 用 **legacy 编译器**（`silverc-legacy-2c46231.exe`，未含 OP_PICK 修复）编：

```
退出码 0
probe.json        sha256 = F3F6A639A4BD4F55…
probe_legacy.json sha256 = F3F6A639A4BD4F55…   ⇒ 逐字节相同
```

🔴 **诚实标注本探针的判别力边界**：两个编译器产物**逐字节相同**，说明本探针**没有触到 OP_PICK codegen 路径**（那条路要 `byte[](int,int)` 两参数 cast 调用，见 `compile_byte_sequence_cast_call`）。
⇒ 本结论只覆盖"**cov_id 家族收紧形式 + 时锁 + 反向焊可编译**"，**不覆盖** OP_PICK 相关构造；若 v0.15 最终 .sil 里出现 `byte[](v,size)` 类调用，须另跑 J2 的 byte-exact 对照（(21) 那套向量），不能引本结论。

## 5. 结论与边界

- ✅ **§3(a) 就"v0.15 所依赖的原语"这一层：可编译。** 走路 (i)（本机 silverc = 我们编译的口径）。
- 🟡 **未证**：完整 A-covenant 的可编译性（因其 .sil 尚未写，属 pre-code，非本条能答）。
- 🟡 **未证**：路 (ii)（younio 用上游 silverc）——上游无 OP_PICK 修复，且本探针经阴性对照证实不触该路径，故路 (ii) 对本探针无区分意义；真要答"外面的人能不能接上"，须等完整 .sil 且用会触发该路径的构造再测。
- 产物只落 `scratch/j1-s63a/`，**未进 versioned-builds/**，**未碰** `SILVERC_PATH`/`SILVERC_LEGACY_PATH`/`SILVERC_ZK_PATH` 任何 kasia-console 依赖路径，**未 rebuild** `D:/silverscript`（遵 DECISIONS 隔离铁律 + MANIFEST 事故先例）。
