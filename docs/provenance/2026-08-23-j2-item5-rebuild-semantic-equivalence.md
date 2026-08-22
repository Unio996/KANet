# P1(g) item 5 验证记录：fresh rebuild 与权威 binary 的**行为等价**（带隔离变量对照）

**执行** J2 · **日期** 2026-08-23 · **批准** Bettor 19:06（item5 计划 APPROVED + 承重 refinement：测试 .sil 必须真走 OP_PICK codegen）
**性质** 全程 scratch-only，零操作 `/d/silverscript`，零写入任何 `SILVERC_*` 路径。

---

## §1 结论

从 `base commit + patch` 做 fresh clean rebuild，得到的编译器与权威 `silverc-zk-8065184.exe`
在编译同一份合约时产出**逐字节相同**的合约字节；且该测试对 OP_PICK 修复**有判别力**。

🔴 **不是**「exe 字节同一」——那做不到，见 §4。

## §2 四方对照

被测源：`kasia-console/src/lib/PayoutShardV2.sil`（**10 处**两参数 `byte[](val, size)`，
真走 patch 所改的 `compile_byte_sequence_cast_call`；亦是 MANIFEST 记的 ZK 家族 byte-exact 验证对象）。
ctor：27 参，用生产代码 helper `ctorBytes32`/`ctorInt`/`W17` 构造（**不是**另写的格式）。

| 编译器 | 来源 | script | sha256(script) |
|---|---|---|---|
| **A** 新 rebuild | `scratch/_p1g_verify`（base **+ patch**） | 8282B | `6f784a7bc09c8e9557b194bd3997fca11c99c82624a3149b1300924554ba1c38` |
| **B** base 对照 | `scratch/_p1g_base`（base，**不打 patch**） | 8282B | `aa99a96ab4dff1cdb8c7f2e4eb8197b64a65b566e100d298bd2cd5f3a9be1f34` |
| **C** 权威 | `versioned-builds/silverc-zk-8065184.exe` | 8282B | `6f784a7bc09c8e9557b194bd3997fca11c99c82624a3149b1300924554ba1c38` |
| **D** legacy | `versioned-builds/silverc-legacy-2c46231.exe` | 8181B | `e52e5bebbd8c959b8f6db407421166f39b9d5e06eb87387aefc3f6ff7f44d226` |

```
A ≡ C   ✅ 逐字节相同  ⇒ fresh rebuild 与权威 binary 行为等价
A ≠ B   ✅ 不同        ⇒ OP_PICK 修复【本身】改变了产出 = 测试有判别力
B ≠ C   ✅ 符合预期
```

## §3 🔴 阴性对照被升级过一次（这一步是关键）

初版用 **D（legacy）** 做阴性对照，它确实与 A 不同 —— **但那不够**：
实测 **B ≠ D**，说明 base 与 legacy 之间**还有别的 commit 差异**。
⇒ 用 D 只能证「能区分两个编译器」，**不能证「区分的是 OP_PICK 修复」**。

换成 **B（同一 base，唯一差别就是这个 patch）** 才隔离出变量。
**A 与 B 长度同为 8282B 而内容不同** —— 与 patch 描述吻合（改的是 PICK 索引值，不是长度）。

🔨 **判据：阴性对照的"坏"那一臂，必须与"好"那一臂只差被测的那一个变量。**

## §4 构建环境（item 4 的答案一并钉在此）

```
源树 tree      69a6d85ba5c9e060ee547fa5e4183774d2408447   （与权威 8065184 的 tree 逐字相等）
base commit    d25bd3427a093c17327ca3d6b9e1aa5f7688c863   （tree 71e8c022fdd4ccc8d704c24f4a9588afefd646ff）
patch sha256   b92c549c496942f932364a40064b86db189c6348a8ab56a17b8d9fcd07044f6d
rustc          1.96.1 (31fca3adb 2026-06-26)
cargo          1.96.1 (356927216 2026-06-26)
host           x86_64-pc-windows-msvc
Cargo.lock     acbab7c12a4f56d26d78f96236c289d6c060bc9c8f1e445e9eea2d4f5332fe74（已 git tracked）
🔴 rust-toolchain / rust-toolchain.toml / .cargo/config.toml —— **均不存在**，编译器版本未钉
🔴 当初（2026-07-07）构建那两份 exe 用的 rustc 版本 —— **无解**：
   二进制无明文版本串（grep 过），`.fingerprint/.../bin-silverc.json` 里只有哈希（`"rustc":11689572559507982127`）读不出版本
```

**产物 exe 字节不同**：新 build `7213455b6953cfdb8ce946cacf68bb98fd58e4b63861ca72c4ad1e99e83ee71a`
vs 权威 `9de7f2f682bc9e50a4b922e1c811335f1b1cd67c175f2e01df6fa6efc9015fc4`。
Rust release build 默认**非 bit-reproducible**（构建路径等嵌入产物）⇒ **这不说明修复丢了**，
判据是 §2 的 A≡C。若把"exe 字节同一"当验收，这项注定假 FAIL。

## §5 明列边界

1. **只测了一个 `.sil`**。它 OP_PICK 用例最密且有 GREEN 先例，**但不是全覆盖**。
2. 🔴 **承重风险未解**：`git branch -r --contains 8065184` 今日实核**仍为空**。
   本文证的是「**能重建**」，不是「**已备份到远端**」。第 3 项的推 durable remote 那一半仍 OPEN（发布动作，需决策）。
3. 本文不触及 gate (g) 之外的任何 §6-3 gate。

## §6 安全边界（实测非声称）

两次 build 分别在 `scratch/_p1g_verify` 与 `scratch/_p1g_base`。
`/d/silverscript/target/release/silverc.exe`（mtime 2026-07-08 11:48）与
`versioned-builds/*.exe`（2026-07-07 07:07 / 07:09）**mtime 实测未变**。

> 🔴 为什么必须钉这条：MANIFEST.txt 记着原地 `cargo build` 覆盖 `target/release/silverc.exe`
> 直接导致 **2026-07-07 23:41–00:47 bshard 押注全线中断**。这是有事故先例的动作。

---

## §7 追加（同日 19:20）：item 3 的后半句**四环全通**，可能不需要额外推 remote

Codex item 3 原文是**「或」**：「推 8065184-fixed 源树到 durable remote/tag，**或**证明 clean-checkout+patch 从全新环境可跑通」。
后半句这条链，每一环现在都有实测：

| 环 | 判据 | 结果 |
|---|---|---|
| ① base commit 可从公开上游取到 | `git fetch --dry-run origin d25bd342…` on `github.com/kaspanet/silverscript` | ✅ `* branch d25bd342… -> FETCH_HEAD`（只读，未推未改） |
| ② patch 公开可得 | patch 入库 commit `30734c83` 是否已在远端 | ✅ **已在 `origin/bshard-m3-deploy`**，而 KANet origin = `github.com/Unio996/KANet`（public） |
| ③ base + patch 精确重建 | tree hash 比对 | ✅ `69a6d85b…`，与权威 `8065184` 逐字相等（§4） |
| ④ 重建物行为正确 | 编译产出比对 | ✅ A≡C 逐字节相同，且 A≠B 有判别力（§2） |

⇒ **四环全依赖公开可获取的资源**：任何人从 `kaspanet/silverscript` 取 base、从 `Unio996/KANet` 取 patch，
即可重建出行为等价的编译器。这正是 item 3 后半句要的东西。

🔴 **但仍不宣布 PASS，因为剩一个不在我们控制内的依赖**：
整条链依赖**上游保留 `d25bd34`**。实测证的是「**今天**能 fetch 到」，**不是「永久可得」**。
上游若删分支或改写历史，patch 就没有落点。
⇒ 若要彻底消除这个外部依赖，该备份的是**完整源树**而非只有 patch —— 那是独立决策，归 Owner 域。

🔵 **对上报措辞的影响（实质性）**：这格**不是**「需要 Owner 定往哪推」，
**而是**「item 3 后半句已实测闭合；是否额外备份完整源树以消除对上游的依赖」。
🔴 两者暴露面完全不同 —— 前者听起来要做一次**新发布**，而 patch **早已在公开仓里**。
