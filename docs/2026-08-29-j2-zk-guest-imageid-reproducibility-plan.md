# ZK guest `imageId` 跨机可复现 · 方案 v0.2（不重建 guest · 不动 live · younio 不装工具链）

> **Status**: v0.2 = **第二步报备稿** · J2 2026-08-29 · Bettor 排（低优先，READY 前）· 起因：J1 P1 回执 `imageId_younio = n/a`，根因在 da9 侧 · v0.2 新增 §4（输入齐 + 两条纠正 + 盘上零构建复现证据 + 第二步三个 diff 的逐字内容）· **§4.3 的 diff 未落，等 NWT 一句**。

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

## §2-bis 🔴 编译器钉版约束（D-015 族 · Bettor 2026-08-29 令记；源自恢复锁三路径稿 `cfedc5c6` E6）
- **`silverc-zk-8065184`（sha `9de7f2f6…`）是 ZK 家族合约（`CloseZkV2.sil` / `PayoutShardV2.sil` / `PoolSide` / `ShardLeaf`）与 §6-3 构造的唯一合法编译器；不得为了获得某个新原语（如上游 #214 的 `tx.daa`）换到上游任何后续 commit。**
- 理由（机械）：上游 `d25bd34..db9e1ba` 45 提交是**语言版本变更**，不是补丁：`byte[](x, n)` 两参 int→byte 形已被删除（`compile/expression/builtin.rs:157-190` 只收 1 参）⇒ `CloseZkV2.sil:45` `byte[](attestedWinner, 1)` **不编**；template hash 改 blake3（#163）⇒ 所有模板哈希/`gateTmplHash` 锚全变；dispatch tag 改签名（#164/#223）⇒ 入口选择字节变；类型/比较/循环语义收紧（#206/#207/#210/#212）。换编译器 = 重写全部 `.sil` + 重审 + 存量盘不兼容 + 8065184 provenance 链作废。
- 需要的能力用**源内表达**在 8065184 上达成（例：DAA 域锁 = `require(0 <= E < 5e11); require(tx.time >= E)`，与上游 `tx.daa` lowering 语义等价——`cfedc5c6` §2 A′）。若某天真需要上游特性，那是 **D-005 级独立迁移**（Owner 拍、全隔离、存量盘不迁），不是换个二进制。
- 自查：`sha256sum /d/silverscript/versioned-builds/silverc-zk-8065184.exe` = `9de7f2f682bc9e50a4b922e1c811335f1b1cd67c175f2e01df6fa6efc9015fc4`；`git -C /d/silverscript branch --show-current` = `j2-oppick-fix-2026-07-06`（本地分支，**未推上游**，勿 reset）。

## §3 风险与边界
- 步骤 2 改 `rust-toolchain.toml`/`methods/Cargo.toml` 会让下一次 `cargo build` 重编 guest；**若 docker 路径产出的 image_id ≠ c9918501**（很可能——canonical 是非 docker 宿主机产物），**不得**改 `ZK_GATE.imageId`：那是"新 covenant"（`zk-close-builder.mjs:42` 注释 "改 guest=改此=新 covenant"），归 D-005/Owner。本稿目标只是"让**现有** canonical 可复现、且今后任何改动可复现"；若证明现有 canonical 在任何配方下都不可复现，那是一条**必须写进 D-015 的事实**，不是本稿要修的。
- 步骤 1 需要 J1 角色 B 的 WSL 只读命令（提权暂停中 ⇒ 等 Bettor 解禁或改由 KANet-UI 非提权跑 `wsl.exe`）。
- 不碰 `D:/rusty-kaspa-zksdk-isolated`（那是 zk-sdk 的 WASM，与 guest image_id 无关；P1 已证 gateTmplHash 只绑 imageId）。

## §4 第二步报备稿（2026-08-29 · 输入 = J1 r17 `…T07-50Z-j1-canonical-imageid-toolchain-recipe.md` + J2 da9 WSL 只读读数）

### §4.0 输入齐（两方实测，全只读）
| 项 | 值 | 谁测 |
|---|---|---|
| host `rustc -V` / `cargo -V` | `1.96.1 (31fca3adb 2026-06-26)` / `1.96.1 (356927216)`；`rustup` active = `stable-x86_64-unknown-linux-gnu`（channel 别名）| J1 r17 |
| `rzup` | 未安装 | J1 r17 |
| `cargo-risczero` / `r0vm` | `3.0.5` / `3.0.5`（`/root/.cargo/bin/`）| J1 r17；J2 复核 |
| **guest 工具链（J1 未报，J2 补）** | `~/.rustup/toolchains/risc0 → /root/.risc0/toolchains/v1.94.1-rust-x86_64-unknown-linux-gnu`（symlink 建于 2026-07-07 12:19）；`rustc +risc0 -V` = **`1.94.1-dev (06e01cb0d 2026-04-09)`**；`cargo +risc0 -V` = `1.94.1-dev (29ea6fb6a)`；含 `riscv32im-risc0-zkvm-elf` target | J2 WSL 只读 |
| `risc0-build` 源（registry）| `~/.cargo/registry/src/index.crates.io-…/risc0-build-3.0.5/`：docker 接口 = `GuestOptions.use_docker: Option<DockerOptions>`（`config.rs:100`）经 `embed_methods_with_options`；env 只认 `RISC0_BUILD_DEBUG / RISC0_BUILD_LOCKED / RISC0_DOCKER_CONTAINER_TAG / RISC0_GUEST_LOGFILE / RISC0_RUST_SRC / RISC0_SKIP_BUILD`（**无 `RISC0_USE_DOCKER`**）；镜像 `risczero/risc0-guest-builder:{tag}`（`docker.rs:147`）| J2 WSL 只读 |
| docker | WSL 内可见 `/mnt/c/Program Files/Docker/Docker/resources/bin/docker`（Docker Desktop）| J2 |
| Cargo.lock 两份 | 入库 `68822fff`（§0）| 三方 |

### §4.1 两条纠正（对 §1 表与 J1 r17 §6）
1. **「RISC-V guest 工具链无处钉」不成立**：rzup 没装，但 guest 工具链**在**（`~/.risc0/toolchains/v1.94.1-…`，由旧版 `cargo risczero install` 放的），且它的身份可复述 = `rustc 1.94.1-dev (06e01cb0d)`。它才是 guest ELF 的编译器（risc0-build 以 `cargo +risc0 build --target riscv32im-risc0-zkvm-elf` 编 guest）。§1 #1 改为"**已钉在盘上、未记进仓**"。
2. **host `channel = "stable"` 浮动对 guest ELF 不承重**：host rustc 只编 host 二进制与 `build.rs`（`build.rs` 只调 `embed_methods()`）；guest 字节由 risc0 工具链 + Cargo.lock + risc0-build 3.0.5 + 源码决定。钉 `channel` 便宜且该做（让 host 侧可复述），但**主锚是 §4.0 第 4 行**，不是它。J1 r17 §6 #1 的"上游发版即漂移 ⇒ imageId 可能变"对 host 不成立、对 guest 工具链才成立——而 guest 工具链是本地固定目录，不随 `rustup update` 动。

### §4.2 🟢 盘上已有零构建的同机复现证据（J2 2026-08-29 只读，不 build 不 prove）
- `zk-payout-guest/target/release/build/methods-306cf5e318a2f6e7/out/methods.rs`（mtime **2026-07-12 03:17**，WSL 在 `/mnt/d/kanet-tn12/zk-payout-guest` 构建；`zk-prove-worker.mjs:70` 就是这样 `wsl.exe … cd <GUEST_HOST_DIR> && cargo run --release`）：
  `PAYOUT_ID = [25530825, 2934967257, 144177066, 2173437718, 141306088, 953105449, 3399976846, 818815920]` → 每词 LE 拼 32 B = **`c9918501d90bf0aeaaf7970816078c81e8286c08293ccf388e87a7cab023ce30` = canonical（8/8 词）**。
- guest ELF `target/riscv-guest/methods/payout/riscv32im-risc0-zkvm-elf/release/payout.bin`：366,748 B，sha256 `885c6fca4914cd3fce4463d94acd517c…`；同目录 `.rustc_info.json`：`release: 1.94.1-dev`、`commit-hash: 06e01cb0d0077cdbda6b930b2f23c2f05c8a2421` ⇒ 与 §4.0 第 4 行同一工具链。
- ⇒ **"同机重建 == canonical" 在 2026-07-12 那次构建成立**（比 `68822fff` 晚 5 天，是锁入库后的构建）。它证的是"当时"，不是"今天重建"——今天重建归 §4.3 ③ 的 `--build` 模式。

### §4.3 第二步 = 三个 diff（逐字；**未落**，NWT 一句后我落；均不动 live、不改 `ZK_GATE.imageId`）
① `zk-payout-guest/rust-toolchain.toml`（一行）：
```diff
-channel = "stable"
+channel = "1.96.1"   # 2026-08-29 钉版(J1 r17 实测); host 侧; guest ELF 由 ~/.risc0/toolchains/v1.94.1 编, 见 TOOLCHAIN.lock.md
```
② 新文件 `zk-payout-guest/TOOLCHAIN.lock.md`（人读）+ `TOOLCHAIN.lock.json`（机读，`verify-image-id.sh` 读）：
```json
{ "canonical_image_id": "c9918501d90bf0aeaaf7970816078c81e8286c08293ccf388e87a7cab023ce30",
  "guest_elf_sha256_prefix": "885c6fca4914cd3fce4463d94acd517c", "guest_elf_bytes": 366748,
  "guest_toolchain": { "rustup_name": "risc0", "path": "/root/.risc0/toolchains/v1.94.1-rust-x86_64-unknown-linux-gnu", "rustc": "1.94.1-dev (06e01cb0d 2026-04-09)", "commit": "06e01cb0d0077cdbda6b930b2f23c2f05c8a2421" },
  "host_toolchain": { "rustc": "1.96.1 (31fca3adb 2026-06-26)", "channel_pinned": "1.96.1" },
  "risc0": { "risc0-build": "3.0.5", "risc0-zkvm": "3.0.5", "risc0-zkvm-platform": "2.2.2", "cargo-risczero": "3.0.5", "r0vm": "3.0.5" },
  "cargo_lock_commit": "68822fff", "canonical_build": { "machine": "da9 WSL Ubuntu-24.04", "date": "2026-07-12T03:17+07:00" },
  "recorded_by": "J1 r17 + J2 WSL readonly 2026-08-29" }
```
③ 新文件 `zk-payout-guest/scripts/verify-image-id.sh`（**不 prove**；两模式）：
```bash
#!/usr/bin/env bash
# 用法: verify-image-id.sh [--build]   默认只读现有 target/ 里的 methods.rs (零构建); --build 先 cargo build --release -p methods (重编 guest, 分钟级)
set -euo pipefail; cd "$(dirname "$0")/.."
[ "${1:-}" = "--build" ] && cargo build --release -p methods
f=$(ls -t target/release/build/methods-*/out/methods.rs | head -1)
words=$(grep -oP 'PAYOUT_ID: \[u32; 8\] = \[\K[^\]]+' "$f")
got=$(python3 -c "import struct,sys; w=[int(x) for x in '$words'.split(',')]; print(struct.pack('<8I',*w).hex())")
want=$(grep -oP '"canonical_image_id": "\K[0-9a-f]{64}' TOOLCHAIN.lock.json)
echo "methods.rs=$f"; echo "got =$got"; echo "want=$want"
[ "$got" = "$want" ] && echo "IMAGE_ID OK" || { echo "IMAGE_ID MISMATCH"; exit 1; }
```
　第一次跑：da9 WSL `bash zk-payout-guest/scripts/verify-image-id.sh`（零构建，预期 OK = §4.2 机械化）；第二次 `--build`（同机今日重建 == canonical 才算"第二步自证"完成；**不等 ⇒ 不改任何 imageId，记事实进本稿 §3**）。
- 附带：§0 说的 `zk-close-builder.mjs:28-31` 陈注释，同批删四行换一句指向本稿（产品代码注释，零行为）。

### §4.4 第三步（docker 确定性）不在本批：risc0-build 3.0.5 **没有** env 开关，要改 `methods/build.rs` 为 `embed_methods_with_options` + `DockerOptionsBuilder`（`config.rs:77-100` 示例），tag 由 `RISC0_DOCKER_CONTAINER_TAG` 定；容器内工具链 ≠ 本地 v1.94.1 ⇒ docker 产出的 imageId **几乎必然 ≠ c9918501** ⇒ 这是"未来改 guest 时的可复现路"，不是"复现现有 canonical 的路"；§3 风险条照旧（不改 `ZK_GATE.imageId`，归 D-005/Owner）。rzup 安装归 J1 角色 B 令下。

### §4.5 边界
- J2 的 WSL 读数 = da9 本机 root WSL（与 J1 r17 同一台），命令全只读（`ls / cat / grep / rustc -V / stat / sha256sum`），WSL 查完不驻留。
- §4.2 证据依赖盘上 `target/`（gitignored、可被 `cargo clean` 抹掉）⇒ 这也是 ② 要把它抄进仓的原因。

## §5 边界（Bettor 2026-08-29 裁，接 §4）
- **三 diff (a)(b)(c) = Bettor GO 待 NWT 一句**；落后先跑 `verify-image-id.sh`（零构建）报 OK，再 `--build`（`nice -n 10` + `CARGO_BUILD_JOBS=4`，几分钟，不碰 live，不 prove）——**相等 / 不等两种结果都记事实进 §3**，不等也不改 canonical（D-001 债的第一手证据）。
- 7/12 构建产物（`methods.rs` / `payout.bin` / `.rustc_info.json`）已抄进 `docs/provenance/2026-08-29-zk-guest-imageid/`（sha 钉，`verify-payout-id.mjs` 4/4），不再依赖 gitignored `target/`。
- **docker 路不在本批**（§4.4）：需改 `methods/build.rs`；容器工具链 ≠ 本地 v1.94.1 ⇒ 产出几乎必 ≠ c9918501；它是"将来改 guest 时的可复现路"，何时开 = Owner/D-005 级决定。rzup 安装归 J1 角色 B。
- J1 r17 §6 #1/#2 被 §4.1 推翻的两条由 Bettor 转 J1（r24）；J1 不需在 younio 做任何事。

## §6 第二步执行结果（2026-08-29 · 事实记录，Bettor 裁"相等/不等都记"）
| 项 | 结果 |
|---|---|
| (b)(c) + 陈注释 | `e030a7b5`（NWT GREEN 已推）|
| 零构建 verify（live 树 7/12 `target/`）| **`IMAGE_ID OK`**（`scratch/_j2_zk_verify_zero_build.out`）|
| **`--build` #1**（副本树 `scratch/_j2_zk_guest_build/`，无 `target/`，`nice -n 19` + `CARGO_BUILD_JOBS=2`，不 prove）| 14:48:29 → 14:49:33+07（**1 m 04 s**，139 crates 全新编译）；guest rustc `1.94.1-dev (06e01cb0d)`，host `1.96.1 (31fca3adb)`；`payout.bin` 366,748 B sha `885c6fca4914cd3fce4463d94acd517c517ade492c5de838faf163f43efa26cd`，**与 7/12 那份 `cmp` 逐字节相同**；`PAYOUT_ID` ⇒ **`c9918501…` == canonical**。日志/样本/产物副本：`docs/provenance/2026-08-29-zk-guest-imageid/rebuild1-*` |
| blkRate（只读 RPC `getBlockDagInfo` blockCount 差分）| 基线 **12.71 bps**（28 s 窗，起建前）；建中样本 **14.77 bps**（147 s 窗）⇒ 无下降，未触发 abort（阈 −30%）；headers 不动（5,508,717，IBD 块段）|
| ⇒ 结论 | **"今天在干净树重编 == canonical"成立**（D-001 债的第一手证据，正向）。可复现性由 **guest 工具链 v1.94.1 + Cargo.lock + risc0-build 3.0.5 + 源** 决定，与 host `stable` 无关（host 已是 1.96.1 而 7/12 时未必是——产物仍逐字节同）。|

### §6.1 🔴 (a) `rust-toolchain.toml` 钉 `channel = "1.96.1"` —— **未落，发现前置阻塞**
- WSL 只读：`rustup 1.29.0`，`rustup toolchain list` = **只有 `stable-x86_64-unknown-linux-gnu` 与 `risc0`**，没有名为 `1.96.1` 的独立 toolchain；`RUSTUP_AUTO_INSTALL` 未设。
- `channel = "1.96.1"` 让 rustup 找 **`1.96.1-x86_64-unknown-linux-gnu`** 这个独立安装，不是 `stable` 的别名 ⇒ 下一次任何 `cargo` 调用（**包括 live `zk-prove-worker.mjs:70` 的 `cargo run --release`**）要么报 `toolchain '1.96.1' is not installed`（prove 全挂），要么自动下载安装 ~100+ MB（rustup 版本依赖的行为，我不猜）——两者都是 **live 侧效应**，且 toml 在 live 树里、被 live worker 直接读。
- ⇒ (a) 的**前置**是 `rustup toolchain install 1.96.1`（系统状态变更，归 J1 角色 B / Bettor 令），装好后先在副本树 `--build` 对拍，再改 live 树 toml。**它不承重**（§6 已证不钉也复现），只是"可复述"；不值得冒 prove 挂的风险抢着落。
- 等价且零风险的替代：在 `TOOLCHAIN.lock.json` 记 host `1.96.1`（已记），toml 保持 `stable`——README/lock 里写明"host 不承重"。Bettor 定选哪条。

### §6.2 `guest_source` 内容锚（Bettor 8/29 非阻塞补，已进 `.json`）
`methods` tree `4435fbfb…` / `methods/guest` `c310bfa4…` / `guest/src` `0d80e3bc…` / `build.rs` blob `08a8a4eb…` / `methods/Cargo.toml` `8ad4cb9d…` / `host` tree `61ab9150…` / 两 Cargo.lock blob `389ecefa…` `dcfb6c31…`（最后改动 `68822fff`）。跨机 mismatch 先比这些：相等 ⇒ 源没变，是工具链；不等 ⇒ 源变了。

### §6.1-裁定（Bettor 2026-08-29）：**不钉 `rust-toolchain.toml`，保持 `channel = "stable"`**
- 理由：host 工具链已证对 guest 字节不承重（§6：host 1.96.1 下全新重编逐字节 == 7/12 产物）；钉 `1.96.1` 需装独立 toolchain（系统状态变更），而 live `zk-prove-worker.mjs:70` 直接读 live 树 toml——装不到位就 prove 全挂或自动下载。为一个"可复述"性质去碰 live 前置，不值。
- 记录处：`TOOLCHAIN.lock.json` `host_toolchain`（已记 1.96.1 + 不承重）。
- **日后若必须钉**（例：host 升级导致 `build.rs`/risc0-build 行为变、或 §6 对拍开始不等）：顺序固定 = ① 角色 B 令下 `rustup toolchain install <ver>` → ② 副本树 `--build` 对拍 == canonical → ③ 再改 live 树 toml → ④ 再对拍一次。不许跳 ①②直接改 toml。
- docker 第三步不在本批；younio 跨机 derive（报值、mismatch 即交付、绝不 copy）排 READY 后。
