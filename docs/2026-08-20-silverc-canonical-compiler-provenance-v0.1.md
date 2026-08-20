# §6-3 A2 canonical silverc 编译器 provenance（durable / rebuildable）— v0.1

> **Status**: CURRENT · J1tn 2026-08-20 · 报备层, 零生产改动 · 解 §6-3 MUST-FIX A 的 provenance 硬闸（Codex durability 要求：complete tree / rebuildable / 不止散文注记）。
> **权分**: J1 出稿（silverc/node 域）· J2 供权威 OP_PICK diff + 4a/4b 指纹 + 探针基准 · Bettor 定 5 项规格并批 · NWT 核确定性重建。
> **依据**: COORD-LEDGER (580) durability 升级 / (589)(592) A2 机制 / (593)(594) Owner 授权 + item-4 拆分。Codex `4c14c1f7`/`18e2725b`。

## §0 为什么需要这份文档（一句话）

§6-3 A2 的 attestation 验签原语 `checkSigFromStack`（upstream 后改名 `checkMsgSig`）只在 **canonical 编译器树** 上有真 codegen；而该树的**唯一非上游部分**是一个**从未推上游的 OP_PICK 修复 commit**。若那棵树的宿主机丢失，`§6-3 covenant` 就再也编不出正确产物，且**不会报错**——只会静默生成带 off-by-one 的 covenant。本文档使该树**可从公开基座 + 一行 diff 确定性重建**，不依赖任何单台机器活着。

## §1 canonical 坐标（脆弱面 = 一行，不是一整棵树）

- **canonical 编译器 commit** = `8065184`（分支 `j2-oppick-fix-2026-07-06`，**未推上游**，`git branch -r --contains 8065184` ⇒ 空）。
- **父/基座 commit** = `d25bd34`（upstream `#136 Bump rusty-kaspa to v2.0.1`）。
  - 🟢 **`d25bd34` 在 `origin/master` 上、公开永久可 fetch**（`git branch -r --contains d25bd34` ⇒ `origin/master`）。remote = `https://github.com/kaspanet/silverscript.git`。
  - 该基座树**已含 `#132`（`c46e0e2` Expose typed CheckSigFromStack builtins）**：`git show d25bd34:silverscript-lang/src/compiler/compile.rs | grep -c checkSigFromStack` ⇒ **4**。
  - `d25bd34` 树 hash（供交叉核）= `71e8c022fdd4ccc8d704c24f4a9588afefd646ff`。
- **`8065184` = `d25bd34` + 恰一个 commit（OP_PICK 修复）**：`git diff --stat d25bd34 8065184` ⇒ `1 file changed, 1 deletion(-)`。
- ⇒ **脆弱面 = 下面 §2 那一行**。基座在 github，孤本只有这一行。

## §2 OP_PICK 修复 — 权威 diff（逐字，J2 供）

文件 `silverscript-lang/src/compiler/compile.rs` · 函数 `compile_byte_sequence_cast_call`（即 `byte[](int,int)` 那条路径）· 约 `:3751-3754`，在 `add_op(OpNum2Bin)` **之前**。语义：该分支下方已 `-= 1`，上面那句 `+= 1` 是**多余的入栈计数**，导致后续 OP_PICK 深度算错一位。**全部内容就是删掉一行**：

```diff
--- a/silverscript-lang/src/compiler/compile.rs
+++ b/silverscript-lang/src/compiler/compile.rs
@@ -3751,7 +3751,6 @@ fn compile_byte_sequence_cast_call<'i>(
         compile_call_arg_with_context(ctx, &args[0])?;
         if args.len() == 2 {
             compile_call_arg_with_context(ctx, &args[1])?;
-            *ctx.stack_depth += 1;
             ctx.builder.add_op(OpNum2Bin)?;
             *ctx.stack_depth -= 1;
         }
```

applyable 副本（**入库、durable**）：`docs/silverc-canonical-provenance/oppick-fix-d25bd34-to-8065184.diff`（同内容，供 `git apply`）。🔴 **必须入库不入 `scratch/`**——`scratch/` 被 gitignore，放那里等于 provenance 的孤本部分不 durable（本 doc v0.1 起草时一度指错，已修）。
🔵 **离线兜底（非 canonical 路径、非 durable、本地便利）**：`scratch/silverc-archive/silverscript-d25bd34-base.bundle`（1.9M，`git bundle verify`=okay）是 `d25bd34` 的自包含 bundle，仅在 github 不可达时用。它在 gitignored `scratch/`、**本身不 durable**，只是本地便利——canonical durability = **github 公开基座 + 上面那份入库 diff**（Bettor de-risk 定：基座上游可取，不归档整树），bundle 冗余于 github 基座，故不入库无损。

## §3 确定性重建流程

```sh
git clone https://github.com/kaspanet/silverscript.git   # 或 fetch 现有检出
cd silverscript
git checkout d25bd34                                      # 公开永久基座(含 #132), 树=71e8c022...
DIFF=<KANet仓>/docs/silverc-canonical-provenance/oppick-fix-d25bd34-to-8065184.diff  # 🔴 入库durable路径, 不是scratch/
git apply --check "$DIFF"     # 🔴 归档物验收=能不能用(J2判据), 不是"在不在"; 基座漂/行尾变会在此喊
git apply "$DIFF"
# 验源树重建忠实 — 应 == canonical 8065184^{tree}(全40位比对, 别只比前缀):
git rev-parse HEAD^{tree}      # 期望 = 69a6d85ba5c9e060ee547fa5e4183774d2408447
cargo build --release          # 产出编译器二进制
```

🎯 **源树层交叉核 = CLOSED**（2026-08-20，多方独立路径全值吻合）:
- 基座 `d25bd34^{tree}` = `71e8c022fdd4ccc8d704c24f4a9588afefd646ff`。
- 重建后 `8065184^{tree}` = `69a6d85ba5c9e060ee547fa5e4183774d2408447`（canonical，J2/Bettor 各自从唯一有 8065184 的检出全串确认）。
- **NWT 从完全独立路径**（fresh clone github `d25bd34` + apply 上面 durable 路径 diff，不用 bundle、不用任何人的检出）重建出 `69a6d85b…` **== canonical 全值** ⇒ 异机可从公开基座+一行 diff 确定性重建源树，坐实。
- 🔧 一步分辨"基座取错"vs"补丁没 apply 干净"（只改一个文件，故 blob 级足够定位）: `compile.rs` @ `d25bd34` blob = `53935455b19eae92e2d42442e4211a221bea781b` / @ `8065184` blob = `8090ed1953ad3eab0ed94baaf610ea2a94e70cf5`。树 hash 对不上时先比这两个 blob：对得上 ⇒ 差异在别的文件(基座错)；对不上 ⇒ 差异在那一行(补丁错)。

## §4 产物指纹 — 两个用途，**分开写，别混**（Bettor item-4 拆分，J2 纠）

🔴 **Rust release 构建通常不是逐字节可复现的**（嵌入绝对路径/时间戳/toolchain 版本差异都改字节）⇒ **二进制 sha256 不能当"重建成功"判据**：一次完全合法的重建极可能得到不同 sha256，拿它当判据会**把成功误判成失败**（只误报、不漏报，会让人查错方向——怀疑源码/基座）。

- **4a 分发完整性**（答"你手上这份是不是我这份"，防拿错文件，**不是重建判据**）：
  `silverc-zk-8065184.exe` sha256 = `9de7f2f682bc9e50a4b922e1c811335f1b1cd67c175f2e01df6fa6efc9015fc4`
  对照 `silverc-legacy-2c46231.exe` = `e0e9b62c086df6b6a63344cbbbd21a0d176af76c5a869826131a879ff06a2c06`（与默认 `target/release/silverc.exe` 逐字符相同 ⇒ 印证**默认路径就是 legacy、编不出 checkSigFromStack**）。
- **4b 重建成功判据**（判据落**编译器产物**，非二进制 hash）✅ **CLOSED**：
  用重建出的编译器编**固定被测物** `kasia-console/src/lib/CheckSigFromStackProbe.sil`，与 pinned `versioned-builds/silverc-zk-8065184.exe` 的输出做 **byte-exact 比对**。
  🔴 **必须用入库的固定 ctor** `docs/silverc-canonical-provenance/4b-baseline-ctor.json`（commit f1ed8c3b，常量 pk）——原 ctor 由脚本烤**随机 pk**，换 pk 产物就变，各自生成会**假 FAIL**；固定输入把唯一自由变量钉成"哪个编译器编的"。
  🔴 **比的是编译器产出的 `script` bytecode 逐字节，不是 JSON 文件大小**（此前误记"3648 字节"=随机-pk JSON 整体大小，作废；JSON 含 ABI/元数据随格式/pk 变）。
  🎯 **权威基准（第三方可复现，因 ctor 入库）**：固定 ctor `4b-baseline-ctor.json`（f1ed8c3b）+ pinned exe ⇒ `script` bytecode **40 字节 · sha256 = `671cf278e91d8f994a8fb3cc2feec5a3a80132f1bb853ee98b4c66324af6c444`**。任何人拉同一份 ctor 编即得此数。（bytecode 是否独立于 ctor pk 待 J2 定；无论如何入库 ctor 已把它钉成可复现。）
  ✅ **NWT 独立 rebuild-determinism A/B（互补另记）**：自源码 `cargo build` 出编译器 + 同一份入库固定 ctor，与 pinned exe 产物 `cmp` ⇒ IDENTICAL（artifact 3653 字节，两边 sha256 = `0c3b52de10c7b54b9ca2bd68d6896782aba68e8aca57e853076ee0ac08c87d95`）。⇒ 从已证==canonical 的源树 build 出的编译器，产物即参考、pinned 被反向佐证。
  🔨 判据 = 产物逐字节相同，**不是** `cargo build` 没报错——因为 OP_PICK bug **不报错**，只让产物悄悄带 off-by-one。
  ⚠ **范围注记（NWT）**：4b 验的是**该固定探针合约**产出相同产物，**不是**"重建出的编译器对任意合约都产出相同产物"。此收窄是有意的（OP_PICK 那行 diff 本身够窄，扩大成"编译器全域逐字节确定性"是过度加固）。**引用 4b 时不得读作编译器全域确定性。**

## §5 编译坐标断言脚本（item 5）

`kasia-console/scripts/checksigfromstack-e2e-vectors.mjs` 的 `assertPinnedCompiler()`（J2 造，**带阳性对照**：实用默认路径试编该内建并**要求它失败**，实跑通过）。⇒ 任何 §6-3 编译路径**必须先跑它**：坐标不只写 commit，要写到具体二进制 `versioned-builds/silverc-zk-8065184.exe` 且脚本断言用的就是它、不接受默认路径。哪天默认路径居然编得出该内建 ⇒ 说明它被换过 ⇒ 脚本喊，而不是默默用错编译器。

## §6 待填 / 交接

- ✅ **源树层交叉核 = CLOSED**（见 §3 🎯 块）：NWT 独立路径重建 == canonical `8065184^{tree}` = `69a6d85b…` 全值；full commit `80651849962f…` 三方全串一致；NWT 判**确定性重建 PASS**（两层 × 两独立路径、无互背书）。
- ✅ **4b 产物层 = CLOSED**（NWT 独立自 build + 入库固定 ctor，与 pinned exe `cmp` IDENTICAL，sha256 `0c3b52de…`）。⇒ **provenance = 源树层 + 产物层【全闭】**（两层 × 两独立路径 × 无互背书；NWT 判"全闭无保留"）。
- 🔵 **作用域边界（别读大）**：本 doc 闭的是**编译器树 provenance**（能确定性重建出对的编译器）。**A2 的 on-chain runtime 验证 = 另一条闸**（checkSigFromStack 链上真在验签），**仍 OPEN**：首跑遇 J2 harness 的 `sigOpCount:1` tx 构造 bug（与被测原语无关），八格 0 PASS/1 FAIL/7 不可归因，待 harness 修（sigOpCount→0）+ 过 Bettor/NWT 眼 + 重跑。**provenance 闭 ≠ A2 runtime 闭。**
- **4b 首次跑证**：待在 pinned 二进制上编 `CheckSigFromStackProbe.sil` 得 3648 字节基准 + 一次真重建复现（产物层）。
- **NWT 核**：确定性重建是否真确定（照 (590) 派工）。
- **归档位**：本 doc = provenance 权威（Bettor 定"写进 KANet docs/"）；diff applyable 副本入 `scratch/silverc-archive/`；二进制 `versioned-builds/`（J2）。
