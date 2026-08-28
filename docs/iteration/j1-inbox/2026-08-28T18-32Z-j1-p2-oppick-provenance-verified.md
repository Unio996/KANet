# J1 报备 — P2 OP_PICK provenance 收口：产物独立验证 + 1 个缺陷 + 待 Owner 定的一格

- 提交人：J1（younio 提权手 / 远端只读核验）
- 时间：2026-08-28
- 对应队列：r14 P2「OP_PICK 修复分支推上游的 provenance 收口（`/d/silverscript` `j2-oppick-fix-2026-07-06` 8065184 只在本地）| 报备」
- 性质：**只读核验 + 报备**。未推任何分支、未改 `/d/silverscript` 任何文件、未 rebuild、未碰 `SILVERC_*`。产物只落 `scratch/j1-oppick-verify`（可删）。

## 0. 一句话

J2 已经把 provenance 产物做出来了（bundle + patch + README 三件已在 `docs/provenance/` 且已在 `origin/bshard-m3-deploy`），我**没有重做**，而是**独立验证这三件真能复现 8065184**——结论是**能，逐字节相同**；但发现 **1 个会让接手人拿到空仓库的缺陷**，并确认**「推去哪」那一格依然真的空着**。

## 1. 我实测的验证结果（全部我亲手在 da9 跑）

| 项 | 判据 | 结果 |
|---|---|---|
| bundle 完整性 | `git bundle verify` | OK，且 **records a complete history**（自足，不依赖上游仓库） |
| 复现 commit | 从 bundle 克隆后 HEAD | `80651849962f1d83eb941c2c913eaaea06e867b7` = 期望值 ✅ |
| 复现内容 | 树 hash 对拍 live 源树 | 均为 `69a6d85ba5c9e060ee547fa5e4183774d2408447` ✅ **逐字节相同** |
| 工作树 | 显式 checkout 分支后 | 15 个条目，正常 |
| patch 自洽 | 对 live 源树 `git apply --check --reverse` | 通过 ⇒ patch 内容 == live 源码里的东西 ✅ |
| 改动面 | `git show --stat` | `silverscript-lang/src/compiler/compile.rs`，**1 file changed, 1 deletion(-)** |

**结论：三件产物是可信的。**即使 `/d/silverscript` 整个没了，凭 `docs/provenance/` 这三件就能完整重建 8065184。

## 2. 🔴 缺陷（建议修，成本一行命令）

**bundle 里没有 HEAD ref**，只带 `refs/heads/j2-oppick-fix-2026-07-06`。后果是接手人照直觉跑：

```
git clone silverc-oppick-8065184.bundle silverc
```

得到：

```
warning: remote HEAD refers to nonexistent ref, unable to checkout
```

→ **工作树 0 个文件**（我实测 `files checked out: 0`）。历史其实全在里面，但不知道分支名的人会以为产物是坏的。

两个修法（任一即可，**我不自己动，等令**）：
- (a) 重生成带 HEAD：`git bundle create <f>.bundle j2-oppick-fix-2026-07-06 HEAD`
- (b) 更省事：在 `README-silverc-oppick-provenance.md` 里把取用命令写死成
  `git clone -b j2-oppick-fix-2026-07-06 silverc-oppick-8065184.bundle silverc`

我倾向 **(b)**——不动已入库的二进制产物，避免 bundle 换 hash 带来的二次校验负担。

## 3. 上游现状（决定「推上游」这格该怎么走的关键读数）

- `origin` = `https://github.com/kaspanet/silverscript.git`（**上游本体，不是我们的 fork**）
- `origin/master` tip = `d25bd342`（`Bump rusty-kaspa version to v2.0.1 (#136)`，2026-06-28）
- **我们这个 fix 的 parent 就是 master tip 本身**，master 领先 0 commit
- 上游自那以后**没动过 `compile.rs`**，master 上仍**不含**此修复
- `git branch -r --contains 8065184` → 空：**该 commit 不在任何远端分支**

⇒ `j2-oppick-fix-2026-07-06` 是**直接坐在上游 master tip 上的干净单 commit 分支，零 rebase 即可开 PR**。这个窗口不会一直开着——上游一旦动 `compile.rs`，就要重做冲突处理。

## 4. 顺带记一条给后来人（防找错文件）

铁律 0.5 把这个 bug 叫「`pick_from_depth` OP_PICK off-by-one」，但**症状点和修复点不是同一个文件**：

- 症状点：`silverscript-lang/src/compiler/stack_bindings.rs`（`pick_from_depth` 在这里，按 `stack_depth` 算 OP_PICK 索引）
- 修复点：`silverscript-lang/src/compiler/compile.rs::compile_byte_sequence_cast_call`

fix 就是删掉一行多余的 `*ctx.stack_depth += 1;`：

```rust
 if args.len() == 2 {
     compile_call_arg_with_context(ctx, &args[1])?;
-    *ctx.stack_depth += 1;
     ctx.builder.add_op(OpNum2Bin)?;
     *ctx.stack_depth -= 1;
 }
```

`OpNum2Bin` 吃 2 吐 1 = 净 -1，紧跟的 `-= 1` 已经记了这笔；多出来的 `+= 1` 把跟踪深度虚增 1，于是**之后每一次** `pick_from_depth` 都算深一格 → OP_PICK 取错栈位。所以照函数名去 `stack_bindings.rs` 里找 bug 会扑空。

## 5. 仍然空着的一格 —— 不归我拍

**「推去哪」= 我们控制的 fork / mirror 的具体目标**，至今没有定。这涉及发布面与暴露面（把 KANet 在改 silverc 这件事公开到 kaspanet 生态），按分工归 **Owner 域**，且 Bettor 先前已给过口径「别自推」。

我**没有推**，也不会推。请求裁决的就一件事：

> **8065184 推到哪个我们控制的 remote？**（或者：先只留 bundle 归档、暂不外推）

在此之前 P2 的可做部分我认为已经做完：产物存在 ✅、产物可信 ✅（本次新增的就是这个「可信」）、缺陷已定位 ✅、上游窗口状态已量化 ✅。

## 6. 我请求的三个动作

1. **Bettor**：裁 §2 的 (a)/(b) 二选一，我照令改 README（一句话的事）。
2. **Bettor**：把 §5 单列成「待 Owner 定 remote 目标」的 pre-code 收尾项，别挂在我名下当"未完成"。
3. **Owner**（经 Bettor 精炼后再上报，不用直接回我）：定不定外推目标。§3 说明这事有时间窗但不紧急。

---
附：验证脚本 `scratch/j1-remote/bundleverify.ps1` + `upstream.ps1`，可原样复跑复核我上面每一个读数。
