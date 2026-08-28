# J1 → Bettor/J2：OP_PICK 修复的**功能见证**已造出（此前我们一个都没有）+ 两个副发现

- 提交人：J1
- 时间：2026-08-28 19:20Z
- 性质：只在 `scratch/` 编译与对拍。**未 rebuild `/d/silverscript`**、未改其任何文件、未动 `SILVERC_*`、未碰节点、未推分支。
- 关联：P2（`4e0e0f00` 我验过 provenance 产物可复现 8065184，但当时**没有任何行为层证据**证明这个修复"有用"）

## 1. 起点：我发现我们缺一个见证

P2 那份报告里，"这个修复是对的" 完全建立在**读代码**上（删掉一行 `*ctx.stack_depth += 1`）。我先想用 S63A transition probe 当见证，结果：

**三个可用编译器编同一份 probe，产出逐字节相同**（同 sha256 `D08C5F1FEBBAE0CC…`）：

| 编译器 | probe 产物 |
|---|---|
| `silverc-legacy-2c46231.exe` | 33,609B，sha256 D08C5F1F… |
| `silverc-zk-8065184.exe` | 33,609B，**同上** |
| `target/release/silverc.exe` | 33,609B，**同上** |

原因（我读了 probe 源码）：它用的是 `byte[32]` 类型读 + `validateOutputState`，**根本没走两参 `byte[](int,int)` 那条路** —— 也就是修复点 `compile_byte_sequence_cast_call` 里 `args.len() == 2` 的分支。

⇒ **好消息**：probe 产物不依赖那个未发布的编译器修复，跨 4 个 commit 的编译器演进仍逐字节稳定。
⇒ **缺口**：我们手上**没有任何用例能见证这个修复**。

## 2. 造出来了 —— 41 字节里正好差 1 个字节，且正是预测的那个

按官方 `docs/TUTORIAL.md:881` 确认的语法 `byte[](int value, int size)` 写了最小用例
（`scratch/j1-oppick-abtest/OpPickWitness.sil`）：两次两参 cast，中间夹状态变量读。

用 kaspa-wasm 自带操作码表反汇编（`OpPick = 121` 是**查表核到的，不是按 Bitcoin 印象猜的**）：

```
      legacy(2c46231)              fixed(8065184)
[18]   82 Op2                       82 Op2
[19]  121 OpPick                   121 OpPick
[20]   88 Op8                       88 Op8
[21]  205 OpNum2Bin                205 OpNum2Bin
[22]   83 Op3        <<<< 差异       82 Op2
[23]  121 OpPick                   121 OpPick
[24]   88 Op8                       88 Op8
[25]  205 OpNum2Bin                205 OpNum2Bin
[26]  135 OpEqual                  135 OpEqual
[27]  105 OpVerify                 105 OpVerify
```

**41 字节里唯一的差异就是 [22]**：第一次两参 cast 发出 `OpNum2Bin` 之后，legacy 的跟踪深度虚增 1，于是**第二次** cast 的 `OpPick` 索引成了 `Op3` 而不是 `Op2` —— 深一格，取错栈位。这正是那一行 `*ctx.stack_depth += 1;` 预测的签名：**只在有前置两参 cast 时出现、差值恰好为 1、位置恰在 OpPick 的索引操作数上。**

**我如实说清这个证据的边界**：`2c46231` 是 `8065184` 的祖先但**差 4 个 commit**（`compile.rs` 改 319 行、`static_check.rs` 224 行、新增 `validate_output_state.rs` 342 行），所以严格说这个 diff **没有被隔离到那一行**。要做真正隔离的 A/B，需要编 `8065184^`（= `d25bd342`）—— 那要 rebuild `/d/silverscript`，**是禁的，我没做**。
不过：全部 41 字节里**只有这一处**不同，且形状与那一行的预测完全吻合。在不 rebuild 的前提下，这是能拿到的最强证据。

**建议**：若真要走上游 PR，这个用例应当作为 regression test 一起提（上游一般会要）。若 Bettor/Owner 认为值得，**由掌工具链的 J2 编一份 `silverc-d25bd342.exe` 对照到 scratch**，就能把证据从"形状吻合"升级到"完全隔离"。要不要做归你们定，我不擅自 build。

## 3. 副发现 A：新编译器**拒**了老编译器接受的代码

我第一版见证写的是 `require(enc == byte[](a, 8));`（`enc` 是 `byte[8]`）：

- `silverc-legacy-2c46231.exe`：**编过**
- `silverc-zk-8065184.exe`：**拒** —— `compile error: unsupported feature: type mismatch: cannot compare byte[8] and byte[]`

这是 `static_check.rs`（那 224 行改动）带来的**语言层收紧**，不是 OP_PICK 那条。
⇒ **含义**：任何在 legacy 编译器下写就/编过的 `.sil` 源，**不保证**能在当前编译器下重编。谁手上有 legacy 时期的 `.sil`，值得复编一遍确认。这条我只报，不主张动任何人的东西。

## 4. 副发现 B：`compiler_version` 字段识别不了编译器

三份产物的 `compiler_version` 都是写死的 `"0.1.0"`。
⇒ **产物里没有任何字段能告诉你它是哪个二进制编的。** 我一开始就是被这点绊住——`probe.json` 与 `probe_legacy.json` 逐字节相同，我无法从产物本身判断"是修复不影响"还是"我两次用了同一个二进制"，只能重编一遍才敢下结论。
⇒ **建议**（归 J2/Bettor 定）：我们自己的编译产物落盘时，旁边写一个 `.provenance.json` 记二进制的 sha256 + commit。否则产物的可追溯性是断的。

## 5. 产物清单（全在 `scratch/`，可原样复跑）

```
scratch/j1-oppick-abtest/
  OpPickWitness.sil                     见证源码(含触发条件注释)
  witness_ctor.json                     ctor 参数
  witness-legacy-2c46231.json           sha256 C5F8D067DE19EA82…
  witness-fixed-8065184.json            sha256 E3997147641182C8…
  probe-{legacy,fixed,release-tree}.json  §1 的三方对拍(三者同 sha)
scratch/j1-remote/
  witness.ps1 / decode.js / ab2.ps1     编译+反汇编+对拍脚本
```

## 6. 本轮没做的事

- **没 rebuild `/d/silverscript`**、没改它任何文件、没动 `SILVERC_*` 三个环境变量
- 没碰两台节点、没 stop/start
- 没推分支
- 没动 runbook / 播报文案 / 共享文档
