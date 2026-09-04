# provenance · kaspad D-a（Win32 fd 预算常数 + opt-in 进程唯一共享 RocksDB 块缓存）· 2026-09-04

> **Status**: CURRENT · J2 · Owner「我肯定批准 D-a 进入构建」（2026-09-04 18:5xZ，Bettor 转）· 设计 = `docs/2026-09-05-bettor-ibd-acceleration-design-v0.2.md` §4 A1 + J2 方案页/hunk 稿（scratch，NWT GREEN-final v0.3 → v0.3.1）· 本页 = 构建与隔离试跑的证据；**切换另批**（Owner GO · J1 runbook · KANet-UI 执行）。
> 所有时刻为 UTC，取自脚本 `date -u` 实录。本页文件：`README.md`、`patch.v031.diff`、`build.log`、`trial.log`、`MANIFEST.sha256`。

## 1. 源与补丁
| 项 | 值 |
|---|---|
| 源 commit（活二进制）| `7b1e18cc` "Add configurable user agent admission rules (#981)"；活 exe `D:\rusty-kaspa\target\release\kaspad.exe` sha256 `6d995c4824cc94dcd3b9153bb5735b4d81bf88b2813eb4751c0a456ecf400605`（40,441,344 B，2026-06-02）**本轮未动** |
| 构建树 | `D:\rusty-kaspa-da`（`git clone --no-hardlinks D:\rusty-kaspa`，`.git` 为目录 ⇒ hash 嵌入正常）· 分支 `da-p2-blockcache` · commit **`1b3046fbb86687560468b2960132a82893d1e96b`**（amend 自 003875b0）· `git diff 7b1e18cc --stat` = `utils/src/fd_budget.rs` +4/−1、`kaspad/src/daemon.rs` +17/−1、`database/src/db/rocksdb_preset.rs` +30/−5 ⇒ 3 files, +51/−7 |
| 对照树（NWT C2）| `D:\rusty-kaspa-ctl`（同 clone 法）· 分支 `da-ctl-7b1e18cc` · HEAD `7b1e18cc` · `git diff 7b1e18cc` 空 |
| 补丁文件 | `patch.v031.diff`（= `git -C D:\rusty-kaspa-da diff 7b1e18cc`）sha256 **`222cdc5cbb5d7299b77c846a87400d036d10a7ee2718cea7dfedc42ec873c6ce`** · NWT 2026-09-04 19:0xZ GREEN（临时 index `git apply --cached --check` 对 7b1e18cc OK，J2 + NWT 各一次）· 与 NWT 首审版 d8565ef6… 唯一差 = 删 `set_cache_index_and_filter_blocks_with_high_priority(true)` + 两行注释（rust-rocksdb 0.24.0 不导出该方法，crate 内 `high_priority` 零命中；库默认已 true，活库 LOG `cache_index_and_filter_blocks_with_high_priority: 1` 实证）|
| 补丁内容 | (P1) `utils/src/fd_budget.rs:77-78` Windows `limit()`：`rlimit::getmaxstdio()` → `65536`（RocksDB 走 Win32 句柄不受 CRT stdio 8192 限；`main.rs:27` `setmaxstdio(8192)` 保持不动）⇒ `fd_total_budget` 65,272 → utxoindex 6,527 → consensus **29,372**（`factory.rs:329/:367` fd/2）· (P2 hunk A) `daemon.rs:238-256` Default 预设仅在显式 `--rocksdb-cache-size` 时算 cache_budget（无 flag ⇒ `None` = 7b1e18cc 同路径）· (hunk C) 同处 `DEFAULT_PRESET_MIN_CACHE_MB = 4096`，小于 ⇒ `println!` 明文 + `exit(1)`，任何 DB 打开前，hdd 不经 · (hunk B) `rocksdb_preset.rs` 顶部 `static SHARED_BLOCK_CACHE: OnceLock<Cache>` + `shared_block_cache()`；`apply_default` 收 cache_budget，`Some` 时 `BlockBasedOptions`：`set_block_cache(shared)`、`set_cache_index_and_filter_blocks(true)`、`set_pin_l0_filter_and_index_blocks_in_cache(true)`，block_size/bloom 不动；hdd 分支 :147-149 也改用共享对象 |
| 声明 | 构建树来自 clone，**不含** `D:\rusty-kaspa` 工作树里 `bridge/src/kaspaapi.rs`、`bridge/src/stratum_server.rs` 的未提交改动；`D:\rusty-kaspa`（HEAD 90dbf074）及其 `target/`、`target-toc3/`、`target-v9/` 未动（`git status` 前后一致）|
| 坑记 | clone 树 `core.autocrlf=true` ⇒ 检出 CRLF，LF 匹配串的脚本替换静默 0 命中（18:59:35Z 一次误重起）；改用 Edit 工具改行；`git diff` 输出 LF 归一，补丁/`git apply` 不受影响 |

## 2. 工具链（构建日志实录）
| 项 | 值 |
|---|---|
| rustc / cargo | `rustc 1.96.1 (31fca3adb 2026-06-26)` / `cargo 1.96.1 (356927216 2026-06-26)`，`stable-x86_64-pc-windows-msvc`；仓在 7b1e18cc 无 `rust-toolchain` 钉版 ⇒ 与 06-02 活 exe 的编译器不同（活 exe 编译器版本未记）⇒ 产物字节不可与原版比对，靠源码 diff + 日志首行 hash + sha 自证 |
| MSVC | Visual Studio Build Tools 2022，`vswhere -latest` installationVersion `17.14.37111.16` |
| LLVM / libclang（bindgen）| `C:\Program Files\LLVM\bin\libclang.dll` ProductVersion `22.1.2`；构建脚本显式 `LIBCLANG_PATH="C:\Program Files\LLVM\bin"` |
| protoc | `libprotoc 34.1` |
| librocksdb-sys / rocksdb crate | `0.17.3+10.4.2` / `0.24.0`（`Cargo.lock:4450-4452` / `:5966-5968`；`--locked` 通过 ⇒ lock 未动）|
| 编译期核（NWT 三问，registry 源 `rocksdb-0.24.0/src/db_options.rs`）| `pub struct Cache(pub(crate) Arc<CacheWrapper>)` :156 + `unsafe impl Send/Sync for CacheWrapper` :428/:442 ⇒ `OnceLock<Cache>` 成立 · `set_block_cache(&Cache)` :563、`set_cache_index_and_filter_blocks` :653、`set_pin_l0_filter_and_index_blocks_in_cache` :686 **在** · `…_with_high_priority` **不在** ⇒ 删（v0.3.1）|
| 构建 | 脚本 `scratch/_j2_da_build.sh`（本页 `build.log`）：`cargo fetch --locked && cargo build --release --locked -j 12 --bin kaspad`，`CARGO_TARGET_DIR` 各树独立 · 补丁树 19:00:05Z→19:02:26Z rc=0（**增量**：amend 后只重编 38 crate，18:58Z 首次尝试已编大部分依赖）· 对照树 19:02:27Z→19:05:40Z rc=0（**全量** 495 crate）· 两树 target 各有 `librocksdb-sys-*` 构建目录 ⇒ 未与活 `target/` 共用 · 之前两次中断（18:58:12Z、18:59:35Z 起）无产物 |

## 3. 产物
| exe | sha256 | 大小 | 版本自证 |
|---|---|---|---|
| 活（原）`D:\rusty-kaspa\target\release\kaspad.exe` | `6d995c4824cc94dcd3b9153bb5735b4d81bf88b2813eb4751c0a456ecf400605` | 40,441,344 | 日志首行 `kaspad v1.1.1-toc.1-7b1e18cc`（活库 `kaspad-stdout.log:1`）|
| 补丁 `D:\rusty-kaspa-da\target\release\kaspad.exe` | **`b73f14157ba5e33218e757c265104cd54d226d70f0f4e87ab41b025621d5534a`** | 40,203,776 | 试跑日志首行 **`kaspad v1.1.1-toc.1-1b3046fb`**（T1/T2）· 内嵌全串 `1b3046fb…` ×1（另 `7b1e18cc` ×1 = hunk C `println!` 文案，非错嵌）|
| 对照 `D:\rusty-kaspa-ctl\target\release\kaspad.exe` | **`460afe1290dd3a6c8978363f545fea5e66471bceb2f0cec77cb65677d9b85da0`** | 40,202,240 | 试跑日志首行 **`kaspad v1.1.1-toc.1-7b1e18cc`**（T4）· 内嵌 `7b1e18cc` ×2 |
- 🔴 口径：`--version` 与 `--help` **不带** git hash（活 exe 同样只打 `kaspad 1.1.1-toc.1`；about 走 `core/src/kaspad_env.rs version()`）；带 hash 的是日志首行（`kaspad/src/daemon.rs:328 git::with_short_hash`）。
- 切换前备份命名：`D:\rusty-kaspa\target\release\kaspad.exe.orig-7b1e18cc-6d995c48`（切换步骤做，本轮未做）。

## 4. 隔离试跑（只证配置 · 脚本 `scratch/_j2_da_trial.sh`，本页 `trial.log` · 临时 appdir `D:\kaspa-da-trial-T*` · 端口 16310/17310/16411 · 不连生产 datadir · 19:06:49Z→19:23:18Z）
公共参数：`--testnet --netsuffix=12 --utxoindex --ram-scale=3.0 --rpclisten=127.0.0.1:16310 --rpclisten-borsh=127.0.0.1:17310 --listen=0.0.0.0:16411 --loglevel=info`
| 向量 | exe / flag | 期望 | 实测（LOG 行逐字）| 判 |
|---|---|---|---|---|
| **T3** 负向量 | 补丁 + `--rocksdb-cache-size=2048` | 立即退出码 1 + 明文；无 LOG | 19:06:49Z→19:07:05Z：`exit rc=1`；stdout 首行 `--rocksdb-cache-size=2048 MB is below the minimum 4096 MB for the default preset: cache_index_and_filter_blocks needs >= 2x the index total, a smaller cache is …`；appdir 下 LOG 文件数 **0** | ✅ |
| **T1** 无 flag（= P1 行为）| 补丁 | consensus 29372 · 32MB · index/filter 0 · utxoindex 6527 · 不崩 | 19:07:05Z→19:10:09Z（180s 活）：`consensus-001/LOG` `Options.max_open_files: 29372`、`consensus-003/LOG` 同 29372、`utxoindex/LOG` `6527`、`meta/LOG` `20`；四 LOG `cache_index_and_filter_blocks: 0`、`pin_l0_filter_and_index_blocks_in_cache: 0`、`capacity : 33554432`（32.00 MB）；LRUCache@ 四个**不同**地址（库默认各建）；首行 `kaspad v1.1.1-toc.1-1b3046fb`；panicked/Exceeded upper bound = 0 | ✅ |
| **T4** 对照无 flag | 对照 | 3568 · 792 · 32MB · 首行 -7b1e18cc | 19:10:09Z→19:13:14Z（180s 活）：`consensus-001/-002` `Options.max_open_files: 3568`、`utxoindex` `792`、`meta` `20`；32.00 MB；index/filter 0；首行 `kaspad v1.1.1-toc.1-7b1e18cc`；0 panic | ✅（对照证明"编译器换了"本身不改这些值）|
| **T2** 带 flag | 补丁 + `--rocksdb-cache-size=8192` | 四 LOG 同一 LRUCache 地址 · 8.00 GB · index/filter 1 · pin_l0 1 · 29372 · 10 min 不崩 | 19:13:14Z→19:23:18Z（600s 活）：`consensus-001`/`consensus-003`/`meta`/`utxoindex` 四个 LOG **同一** `Block cache LRUCache@00000219E5AF2AB0#11816 capacity: 8.00 GB`（`capacity : 8589934592`）；四 LOG `cache_index_and_filter_blocks: 1`、`pin_l0_filter_and_index_blocks_in_cache: 1`；consensus `max_open_files: 29372`、utxoindex `6527`、meta `20`；首行 `-1b3046fb`；0 panic | ✅（共享成立：最坏 = 一个 N）|
- 附带观测：meta 库 `max_open_files` 在两树都显示 **20** 而代码给 5（`daemon.rs:71 META_DB_FILE_LIMIT`）⇒ RocksDB 库对该选项有下限钳位 20；与本改动无关（对照同值），记录备查。
- 试跑句柄数**未采**（脚本按 bash PID 取 Get-Process 失败，字段为空；试跑库极小本也量不出，非判据）。
- 试跑不能证明的：真库（17.6k SST）上的内存增量与追赶率 ⇒ 切换后前 15 min 闸实测（§5）。试跑 appdir 各 <1MB（header 相位），已停，端口已释放，目录留作对照（`D:\kaspa-da-trial-T1..T4`，可删）。

## 5. 切换/回滚（另批 · Owner GO · J1 runbook · KANet-UI 执行 · 本页只列闸）
- 梯级：P2（补丁 exe + `--rocksdb-cache-size=8192`）→ 去 flag 重启（= P1 行为，同 exe）→ 换回 `.orig`（原 exe）。数据库文件不因这些选项改变格式，双向无迁移。
- 基线（切换前 10 min 同相位）：kaspad WS / 句柄 / 块率中位 / 采样器 IO Read Ops/s（现 ~22k）/ D: Disk Reads/sec / commit / 物理 free。
- 闸（15 min）：WS>30GB（P2）/ >20GB（P1）∨ 物理 free<6GB ∨ commit>100GB ∨ 句柄>60k ∨ `Exceeded upper bound|panicked` ∨ 块率中位低于基线 ⇒ 下一梯级；P2 效果闸：IO Read Ops/s 未降 ≥30% ⇒ 记"缓存无效"不退。收益上限：P1 ≤1.5×，P2 之上 ≤1.3×，须实测。
- 生效证据：生产 `consensus-006` 新 LOG 段 `Options.max_open_files: 29372`（回滚后回 3568）；P2 另看 `capacity: 8.00 GB` 与 LRUCache@ 同址。
