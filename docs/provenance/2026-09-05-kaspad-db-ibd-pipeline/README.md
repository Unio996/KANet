# provenance · kaspad D-b（IBD 块体请求流水线·深度 2）· 2026-09-04/05

> **Status**: CURRENT · J2 · **只建不部署**（Bettor 派工 2026-09-04 21:5xZ，ledger 858；设计 `docs/2026-09-05-bettor-ibd-request-pipelining-design-v0.1.md` v0.1.2 = 9224ae3a，NWT GREEN-conditional 931762e0）· 部署 = 节点二进制换代 = **Owner GO**，本目录不含任何部署动作。
> 所有时刻为 UTC，取自脚本 `date -u` 实录。本页文件：`README.md`、`patch.diff`、`COMMIT.txt`、`build.sh`、`build.log`、`build-attempt1-ABORTED-dirty-tree.log`、`build-attempt2-FAILED-live-exe-locked.log`、`MANIFEST.sha256`。

## 1. 源与补丁
| 项 | 值 |
|---|---|
| 基线 commit | `1b3046fbb86687560468b2960132a82893d1e96b`（D-a：fd 预算 65536 + opt-in 共享块缓存；其基线 `7b1e18cc` = 活二进制源）· **保留 D-a 全部改动** |
| 构建树 / 分支 | `D:\rusty-kaspa-da` · 分支 **`j2-db-ibd-pipeline`**（自 1b3046fb 分出）· `da-p2-blockcache` 分支未动 |
| D-b commit | **`4d0a9e30215031ae5a980c1c72f01c2eea13ac81`**（`4d0a9e30`）· `git diff 1b3046fb 4d0a9e30 --stat` = **1 file changed, 53 insertions(+), 3 deletions(-)**，只触及 `protocol/flows/src/ibd/flow.rs` |
| 补丁文件 | `patch.diff`（= `git diff 1b3046fb 4d0a9e30`，81 行）sha256 **`fd7d76722d793bc23006eb8c313c4f54a97484de49be98637d809b6dc3c86067`** |
| 改动内容 | ① `sync_missing_block_bodies`：`body_only_ibd_permitted` 时走新循环——先发 chunk_0 请求；每轮**先发 chunk_{i+1} 请求，再接收 chunk_i**，再 `try_join_all(prev_jobs)` + 进度（位置与原来相同：在当前批接收完之后）；末批 join + `report_completion`。深度固定 2。② `queue_block_processing_chunk_body_only` 拆成 `send_body_request(chunk)`（只 enqueue `make_request!(RequestBlockBodies, …, incoming_route.id())`）与 `receive_body_chunk(consensus, chunk)`（逐 hash `dequeue_with_timeout!(BlockBody)` → `async_get_header` → `validate_and_insert_block`，循环体逐字不变），原函数保留为两者顺序组合。③ v7 `queue_block_processing_chunk_full_block` 与原 for 循环**不动**（`body_only_ibd_permitted=false` 时照旧）。 |
| 硬约束（设计 §3.8/§6）| 深度 2 与 `IBD_BATCH_SIZE=99` 成对；不自适应；不改 batch；**不扩 route 容量**（默认 256、BlockBody 溢出=Disconnect；在飞最多 198；`subscribe_with_capacity(512)` 记为备选未采）；daa_score/timestamp 取收到那批末块；`try_join_all` 位置不前移；错误路径不特判。 |
| 格式 | `cargo fmt -p kaspa-p2p-flows -- --check` rc=0（改前后均 CRLF、ASCII）|
| 声明 | 树来自 clone（同 D-a），不含 `D:\rusty-kaspa` 工作树未提交改动；`D:\rusty-kaspa`、活 exe、活 datadir、watchdog 全未动 |

## 2. 工具链（与 D-a 同机同链，见 `docs/provenance/2026-09-04-kaspad-da-fd-limit/README.md §2`）
| 项 | 值 |
|---|---|
| rustc / cargo | `rustc 1.96.1 (31fca3adb 2026-06-26)` / `cargo 1.96.1 (356927216 2026-06-26)`（build.log 首行实录）|
| MSVC / LLVM / protoc | VS Build Tools 2022 17.14.37111.16 / libclang 22.1.2（`LIBCLANG_PATH` 显式）/ libprotoc 34.1 |
| rocksdb crate | `0.24.0` / `librocksdb-sys 0.17.3+10.4.2`（`--locked`，lock 未动）|
| CARGO_TARGET_DIR | **`D:\rusty-kaspa-da\target-db`**（独立目录，全量编）。🔴 原因：`D:\rusty-kaspa-da\target\release\kaspad.exe` 就是**活 D-a 二进制**（sha `b73f1415…5534a`，活 kaspad 27032 直接从该路径起），在默认 target 上 `cargo build --bin kaspad` 会试图覆盖它——第 2 次尝试正是在链接阶段被 Windows 文件锁挡下（`failed to remove file … os error 5`，见 `build-attempt2-FAILED-live-exe-locked.log`），磁盘 exe 核过原样未动。此后该树任何 kaspad 构建都必须用独立 `CARGO_TARGET_DIR`；活 exe 搬离 target 目录另案（Bettor）|
| 构建命令 | `cargo fetch --locked && cargo build --release --locked -j 12 --bin kaspad`，随后 `cargo test --release --locked -j 12 -p kaspa-p2p-flows`（`build.sh`）|
| 记账 | 三次尝试：① 21:57:14Z 树未提交（`dirty=1`，`build-attempt1-ABORTED-dirty-tree.log`）——产物会嵌基线 hash，我中止，未留产物；② 22:00:19Z 干净树但默认 target，链接时撞活 exe 文件锁 rc=101（`build-attempt2-FAILED-live-exe-locked.log`；该次 `cargo test` 已跑 7 passed）；③ **22:04:28Z 干净树 + `target-db` = 本页产物**（`build.log`）|

## 3. 产物
| 项 | 值 |
|---|---|
| exe | **`D:\rusty-kaspa-da\target-db\release\kaspad.exe`**（不是 `target\release\`——那个是活 D-a exe）|
| sha256 | `2432c36b0cdf5e561eeeebe5de3e4cb807b962797109b11a29c4eef8f6361a95` |
| 大小 | 40,212,992 B |
| `--version` | `kaspad 1.1.1-toc.1`（`--version` 不带 git hash；带 hash 的是日志首行 `daemon.rs:328`）|
| 内嵌 hash | 短 `4d0a9e30` ×2（其中 1 次是全串的前缀重叠，实际独立嵌入 = 版本串 1 处） · 全 `4d0a9e30…ac81` ×1 |
| 构建墙钟 | fetch 22:04:29Z rc=0 · build 22:04:29Z → 22:07:42Z（3 min 13 s，全量：独立 target-db 从零编）（rc=0）|
| `cargo test -p kaspa-p2p-flows` | rc=0 · `running 7 tests … test result: ok. 7 passed; 0 failed`（flowcontext/orphans、process_queue、user_agent_rule、v7 txrelay 既有单测；无 IBD 流水线专测，未补）· 22:07:43Z→22:09:15Z |
| 日志 | `build.log`（首尾见 §5）|

## 4. 未做（按派工）
- 未做隔离试跑（D-b 是网络层行为，只有接真 peer 才能观察；设计 §4 的判据全在部署后 30 min 内用现有只读仪器裁）。
- 未部署、未换 exe、未改 watchdog、未碰 live 27032。
- 部署梯级/回滚：设计 §3.5 —— 换回 D-a exe（sha `b73f1415…5534a`）重启，datadir 不受影响。

## 5. build.log 首尾
```
BUILD SCRIPT start 2026-09-04T22:04:28Z rustc=rustc 1.96.1 (31fca3adb 2026-06-26) cargo=cargo 1.96.1 (356927216 2026-06-26)
=== [db] head=4d0a9e30215031ae5a980c1c72f01c2eea13ac81 branch=j2-db-ibd-pipeline dirty=0
=== [db] cargo fetch start 2026-09-04T22:04:29Z
=== [db] fetch rc=0 2026-09-04T22:04:29Z
=== [db] build start 2026-09-04T22:04:29Z
   Compiling unicode-ident v1.0.13
…
=== [db] build rc=0 end 2026-09-04T22:07:42Z
=== [db] exe size=40212992 sha256=2432c36b0cdf5e561eeeebe5de3e4cb807b962797109b11a29c4eef8f6361a95
=== [db] version: kaspad 1.1.1-toc.1  
=== [db] embedded hash strings: 2 x short, 1 x full
=== [db] test rc=0 end 2026-09-04T22:09:15Z
BUILD SCRIPT end 2026-09-04T22:09:15Z
```
