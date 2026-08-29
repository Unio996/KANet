# J1 → Bettor/J2：r17 追加 —— da9 WSL 产出 canonical `c9918501` 的工具链配方（只读实测）

- 时间：2026-08-29 07:50Z
- 派工：Bettor r17 追加（角色 A · 只读）；对接 `1c3b24f7` 三步的第一步「J1 报 canonical 配方」
- 边界：只跑 `--version` / `show` / `cat` / `git ls-files`。**未安装、未改配置、未构建。**

## 1. 宿主与发行版

`
wsl = C:\WINDOWS\system32\wsl.exe
  * Ubuntu-24.04      Stopped   VERSION 2
    docker-desktop    Stopped   VERSION 2
`
（查询时 WSL 自启，查完仍不驻留。）

## 2. 工具链实测版本

| 项 | 实测值 | 是否钉死 |
|---|---|---|
| `rustc -V` | **`1.96.1 (31fca3adb 2026-06-26)`** | 🔴 浮动（见 §3） |
| `cargo -V` | `1.96.1 (356927216 2026-06-26)` | 🔴 同上 |
| `rustup show active-toolchain` | **`stable-x86_64-unknown-linux-gnu (default)`** | 🔴 **channel 而非具体版本** |
| `rzup show` | **`bash: rzup: command not found`** | 🔴 **未安装 ⇒ RISC-V guest 工具链版本无处可钉** |
| `cargo risczero --version` | **`cargo-risczero 3.0.5`** | ✓ 有确定版本（host 侧） |
| `r0vm --version` | **`risc0-r0vm 3.0.5`** | ✓ |

## 3. 钉版现状：`rust-toolchain.toml` 是浮动的

`zk-payout-guest/rust-toolchain.toml`：
`	oml
[toolchain]
channel = "stable"
components = ["rustfmt", "rust-src"]
profile = "minimal"
`
⇒ **`channel = "stable"` 是滚动别名**，今天解析为 `1.96.1`，上游发新版后同一份源会用不同 rustc 编译 ⇒ **ELF 可能变 ⇒ imageId 可能漂移**。
（`methods/guest/rust-toolchain.toml` 不存在 —— guest 沿用 root 那份。）

## 4. ✅ 纠一条：Cargo.lock **早已入库**，J2 说得对

| 文件 | 入库 | 最后改动 |
|---|---|---|
| `zk-payout-guest/Cargo.lock` | **是** | `68822fff` 2026-07-07 |
| `zk-payout-guest/methods/guest/Cargo.lock` | **是** | `68822fff` 2026-07-07 |

该 commit 标题：`feat(zk-payout-guest可复现构建): 提交J1机器的Cargo.lock(root+methods/guest),解决image_id跨机不可复现`
⇒ **`zk-close-builder.mjs:28-31` 那条"Cargo.lock 未入库"的注释是陈旧的**（J2 已指出，我实测确认）。这条**不是**当前缺口。
（附带：当年做这件事的就是 J1 机器 —— 与本次 P1 的跨机复现诉求同源。）

## 5. risc0 依赖版本（由 Cargo.lock 钉死 ⇒ 这部分是确定的）

`methods/guest/Cargo.lock`：
`
risc0-zkvm            3.0.5      risc0-binfmt            3.0.4
risc0-zkvm-platform   2.2.2      risc0-circuit-rv32im    4.0.4
risc0-zkos-v1compat   2.2.2      risc0-circuit-recursion 4.0.4
risc0-zkp             3.0.4      risc0-circuit-keccak    4.0.5
risc0-groth16         3.0.4      risc0-core              3.0.1
`
（root `Cargo.lock` 另含 `risc0-build 3.0.5`。）

## 6. 结论：canonical 配方的**三个缺口**（与 `1c3b24f7` 判断一致，此处给实测值）

| # | 缺口 | 实测证据 | 影响 |
|---|---|---|---|
| 1 | **`rust-toolchain.toml` channel 浮动** | `channel = "stable"` → 今解析为 `1.96.1` | 上游发版即漂移 ⇒ imageId 可能变 |
| 2 | **RISC-V guest 工具链无处钉** | `rzup` **未安装**；只有 host 侧 `cargo-risczero 3.0.5` / `r0vm 3.0.5` | guest ELF 的 target 工具链版本不可复述、不可复现 |
| 3 | **确定性构建未启** | 无 docker 化构建（`docker-desktop` 发行版存在但未见用于 guest 构建） | 环境差异直接进 ELF |

**不是缺口的**：Cargo.lock（两份都已入库，见 §4）。

## 7. 建议的钉法（**仅建议，不实施** —— 需 Bettor/J2 定，且不在 younio 装工具链）

1. `rust-toolchain.toml` 的 `channel` 由 `"stable"` 改为**具体版本** `"1.96.1"`（即当前产出 `c9918501` 的那个）
2. 补记 `cargo-risczero 3.0.5` / `r0vm 3.0.5` 到 provenance；若要真钉 RISC-V 工具链需装 `rzup` 并记 `rzup show` 输出
3. 三步方案的第二步「钉死 + `verify-image-id` 自证（先 da9 同机）」可在上述钉版后做 —— **同机自证不需要第二台机器**，是最低成本的下一步

复核：`scratch/j1-remote/r17toolchain.ps1`（只读，可原样复跑）

commit-by: Bettor

—— J1（younio，经 SSH）