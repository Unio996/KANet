# TOOLCHAIN.lock — canonical guest `imageId` 的配方（人读；机读同目录 `TOOLCHAIN.lock.json`）

> 2026-08-29 · J1 r17 + J2 只读实测 · 方案稿 `docs/2026-08-29-j2-zk-guest-imageid-reproducibility-plan.md` §4 · 🔴 **canonical `c9918501…` 绝不能改**（烤进每个 live pool genesis 的 `ZK_GATE.imageId` / `gateTmplHash`，`kasia-console/src/lib/zk-close-builder.mjs`；改 = 新 covenant = D-005/Owner）。本文件记"怎么得到它"，不是"允许改它"。

| 层 | 值 | 承重 |
|---|---|---|
| canonical imageId | `c9918501d90bf0aeaaf7970816078c81e8286c08293ccf388e87a7cab023ce30` | 目标 |
| guest 程序 | `target/riscv-guest/methods/payout/riscv32im-risc0-zkvm-elf/release/payout.bin`，risc0-binfmt（magic `R0BF`），366,748 B，sha256 `885c6fca4914cd3fce4463d94acd517c…` | imageId 是对它的承诺 |
| **guest 工具链**（主锚）| rustup 名 `risc0` → `/root/.risc0/toolchains/v1.94.1-rust-x86_64-unknown-linux-gnu`；`rustc 1.94.1-dev (06e01cb0d 2026-04-09)`；target `riscv32im-risc0-zkvm-elf`；装于 2026-07-07（旧式 `cargo risczero install`，rzup 未装）| 🔴 |
| 依赖树 | `Cargo.lock`（root + `methods/guest/`），`68822fff` 2026-07-07 | 🔴 |
| risc0 | build 3.0.5 / zkvm 3.0.5 / zkvm-platform 2.2.2 / binfmt 3.0.4 / circuit-rv32im 4.0.4；host 工具 cargo-risczero 3.0.5 / r0vm 3.0.5 | 🔴（在 lock 内）|
| host 工具链 | `rustc 1.96.1 (31fca3adb)`；`rust-toolchain.toml` 记录时 `channel="stable"` | 🟡 不承重（只编 host 与 `build.rs`）|
| canonical 构建 | da9 WSL Ubuntu-24.04 root，树 `/mnt/d/kanet-tn12/zk-payout-guest`，`methods.rs` mtime 2026-07-12 03:17+07；产物副本 `docs/provenance/2026-08-29-zk-guest-imageid/` | 证据 |

## 自证
```
bash zk-payout-guest/scripts/verify-image-id.sh            # 零构建: 读现有 target/ 的 methods.rs, 比 canonical
bash zk-payout-guest/scripts/verify-image-id.sh --build    # 重编 guest (分钟级) 再比; 不 prove; 不等 ⇒ exit 1, 什么都不改
```
`--build` 建议在**副本树**跑（`cp -r` 到 scratch，排除 `target/`），别在 live 树：live 的 `target/` 由 `zk-prove-worker.mjs` 的 `cargo run --release` 使用。任何 mismatch = 交付物（记进方案稿 §3，上 D-005），**绝不**用它改 canonical。

## 不在本文件里的
- docker 确定性构建（risc0-build 3.0.5 无 env 开关，需改 `methods/build.rs`；方案稿 §4.4）。
- rzup（未装；J1 角色 B 令下）。
