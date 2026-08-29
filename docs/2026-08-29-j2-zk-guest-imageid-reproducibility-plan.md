# ZK guest `imageId` 跨机可复现 · 方案 v0.1（不重建 guest · 不动 live · younio 不装工具链）

> **Status**: DRAFT v0.1 · J2 2026-08-29 · Bettor 排（低优先，READY 前）· 起因：J1 P1 回执 `imageId_younio = n/a`，根因在 da9 侧 · NWT 审后报备执行。

## §0 先纠一个事实：Cargo.lock 早已入库
- `zk-payout-guest/Cargo.lock` + `zk-payout-guest/methods/guest/Cargo.lock` **自 `68822fff`（2026-07-07）起 tracked**（`git ls-files` 可见）；`zk-payout-guest/.gitignore` 里有 Bettor 当时裁定的注释："故意提交…这两份 lock 是 J1 机器产出 c9918501 的那份…别在其他机器上重新 cargo update"。
- 🔴 `kasia-console/src/lib/zk-close-builder.mjs:28-31` 那段 "Cargo.lock 被 .gitignore 排除 → 跨机 cargo resolve 未锁定 … Phase2 补课项(挂账)" 是**陈注释**（写于 7/7 修复之前，修复后没删），2026-08-29 把 Bettor/J1/我三人都带偏。**修法 = 删那四行、换一句指向本稿**（产品代码注释改动，报备后改，零行为）。
- 锁里 `risc0-zkvm 3.0.5 / risc0-build 3.0.5 / risc0-zkvm-platform 2.2.2`；canonical `imageId = c9918501…`（`proofs/3o6cs-attest-0a358fa0/3o6cs_receipt.summary.json` 与 `zk-close-builder.mjs:42` 一致）。

## §1 真正剩下的不可复现来源（按可能性）
| # | 来源 | 现状 | 证据 |
|---|---|---|---|
| 1 | **risc0 riscv 目标工具链版本**（`rzup` 装的 `rust` toolchain for `riscv32im-risc0-zkvm-elf`）——guest ELF 由它编，image_id = ELF 承诺 | **无处钉**：仓内无 `rzup` 版本记录，`rust-toolchain.toml` 只管 host 侧且 `channel="stable"`（浮动） | `zk-payout-guest/rust-toolchain.toml`；`methods/Cargo.toml` 仅 `methods=["guest"]` |
| 2 | host 侧 rustc/cargo 版本（影响 `risc0-build` 行为与 build.rs 环境） | `stable` 浮动 | 同上 |
| 3 | docker 确定性构建未启（risc0-build 支持在固定镜像里编 guest，产出与宿主机无关） | 未配置 | `methods/Cargo.toml` `[package.metadata.risc0]` 无 docker 选项；`build.rs` 只 `embed_methods()` |
| 4 | 依赖树版本 | **已钉**（两份 lock 入库） | §0 |
| 5 | guest 源码 | 入库，sha 可核 | `methods/guest/src/main.rs` |

## §2 方案（三步，全部可离线验、不动 live、不改 canonical imageId）
1. **记录 canonical 配方（J1 一次只读报告）**：在产出 c9918501 的机器（da9，proving 在 WSL 跑：`zk-prove-worker.mjs:53-70` `wsl.exe -e bash -lc 'cd … && cargo run --release …'`）报 `rzup show`、`cargo risczero --version`、`rustc -V`、`cargo -V`、`uname -a`、`ls ~/.rustup/toolchains`（含 `risc0` 那条），写入 `zk-payout-guest/TOOLCHAIN.lock.md`（人读）+ 同内容 JSON（机读），commit 带 J1。
2. **钉死 + 自证**：`rust-toolchain.toml` 的 `channel` 改成步骤 1 报出的**精确版本**（如 `1.8x.y`）；`methods/Cargo.toml` `[package.metadata.risc0]` 加 docker 确定性构建（risc0-build 3.x：`use_docker`/`RISC0_USE_DOCKER=1` 二者哪个是 3.0.5 的正式接口**落码前以 3.0.5 源码为准核**，本稿不猜）；加 `zk-payout-guest/scripts/verify-image-id.sh`：`cargo build --release` 后跑 host 打印 `image_id`，与 `TOOLCHAIN.lock.md` 里的 canonical 比，**不等 ⇒ exit 1**。**第一次跑就在 da9 WSL**（同机重建 == canonical 是最低门槛；今天连这个都没证过）。
3. **跨机实证（可选，不在本轮）**：任一有 docker 的机器按 `TOOLCHAIN.lock.md` 复现 == c9918501 ⇒ 记入 `docs/provenance/`。younio **不装**工具链（Bettor 裁）。

## §3 风险与边界
- 步骤 2 改 `rust-toolchain.toml`/`methods/Cargo.toml` 会让下一次 `cargo build` 重编 guest；**若 docker 路径产出的 image_id ≠ c9918501**（很可能——canonical 是非 docker 宿主机产物），**不得**改 `ZK_GATE.imageId`：那是"新 covenant"（`zk-close-builder.mjs:42` 注释 "改 guest=改此=新 covenant"），归 D-005/Owner。本稿目标只是"让**现有** canonical 可复现、且今后任何改动可复现"；若证明现有 canonical 在任何配方下都不可复现，那是一条**必须写进 D-015 的事实**，不是本稿要修的。
- 步骤 1 需要 J1 角色 B 的 WSL 只读命令（提权暂停中 ⇒ 等 Bettor 解禁或改由 KANet-UI 非提权跑 `wsl.exe`）。
- 不碰 `D:/rusty-kaspa-zksdk-isolated`（那是 zk-sdk 的 WASM，与 guest image_id 无关；P1 已证 gateTmplHash 只绑 imageId）。
