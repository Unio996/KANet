# provenance · ZK guest `imageId` = canonical `c9918501…` 的同机零构建证据（2026-07-12 da9 WSL 构建产物副本）

> J2 2026-08-29 · Bettor 令（`802522de` 后："先抄进 provenance 防 cargo clean"）· 来源 = `zk-payout-guest/target/`（gitignored，`cargo clean` 即抹）· 自证 `verify-payout-id.mjs` **4/4**（两 cwd，`verify-run{1,2}.out`）· 方案稿 `docs/2026-08-29-j2-zk-guest-imageid-reproducibility-plan.md` §4.2。

## 1. 文件与来源
| 文件 | 来源（`zk-payout-guest/target/…`）| 源 mtime（`source-mtimes.txt`）| 内容 |
|---|---|---|---|
| `methods.rs` | `release/build/methods-306cf5e318a2f6e7/out/methods.rs` | **2026-07-12 03:17:19 +07** | risc0-build 生成：`PAYOUT_PATH`（指向 `/mnt/d/kanet-tn12/zk-payout-guest/target/…/payout.bin` ⇒ 构建发生在 WSL 挂载的本仓树）+ `PAYOUT_ID: [u32; 8]` |
| `payout.bin` | `riscv-guest/methods/payout/riscv32im-risc0-zkvm-elf/release/payout.bin` | 2026-07-12 03:17:18 +07 | guest 程序（**risc0-binfmt 格式，magic `R0BF`，不是裸 ELF**——首版自证按 ELF magic 断错一次），366,748 B，sha256 `885c6fca4914cd3fce4463d94acd517c…`（imageId 就是对它的承诺）|
| `guest.rustc_info.json` | `riscv-guest/methods/payout/.rustc_info.json` | 2026-07-08 08:09 +07（cargo 首次探测 rustc 时写，之后复用；7/12 构建沿用同一把）| `release: 1.94.1-dev`、`commit-hash: 06e01cb0d0077cdbda6b930b2f23c2f05c8a2421`、`host: x86_64-unknown-linux-gnu` = `~/.rustup/toolchains/risc0 → /root/.risc0/toolchains/v1.94.1-…` |
| `verify-payout-id.mjs` | 本目录 | — | 零依赖自证（4 条，见 §2）|

不抄 `Cargo.lock`：两份已 tracked（`68822fff` 2026-07-07），`git show 68822fff:zk-payout-guest/Cargo.lock` 即权威。

## 2. 证了什么
1. `methods.rs` 的 `PAYOUT_ID` 8 个 u32 按 LE 拼 32 B = **`c9918501d90bf0aeaaf7970816078c81e8286c08293ccf388e87a7cab023ce30`**（8/8 词）= `proofs/3o6cs-attest-0a358fa0/3o6cs_receipt.summary.json` 的 `image_id` = `kasia-console/src/lib/zk-close-builder.mjs` 的 `ZK_GATE.imageId`。
2. 那次构建的 guest 编译器 = risc0 工具链 `rustc 1.94.1-dev (06e01cb0d)`，不是 host 的 `stable`（1.96.1）——所以 host `channel="stable"` 浮动对 imageId 不承重（方案稿 §4.1-2）。
3. 时间线：`68822fff`（7/7 锁入库）→ 7/8 首次构建探测 rustc → **7/12 构建产出 canonical**。⇒ "锁入库后、同机、同工具链 ⇒ canonical" 至少成立过一次。

## 3. 没证什么
- **今天重建**是否仍 == canonical：归方案稿 §4.3 ③ `verify-image-id.sh --build`（NWT GO 后跑；相等/不等都记事实进方案稿 §3，不等也不改 canonical）。
- 跨机复现（younio 不装工具链，Bettor 裁）；docker 确定性构建（方案稿 §5 边界，不在本批）。

## 3-bis. 2026-08-29 `--build` #1（副本树全新重编）—— **== canonical，payout.bin 逐字节同 7/12**
- `rebuild1-build.log`：`nice -n 19` + `CARGO_BUILD_JOBS=2`，139 crates，1 m 04 s（14:48:29→14:49:33+07），guest rustc `1.94.1-dev (06e01cb0d)` / host `1.96.1`，末尾 `IMAGE_ID OK`。
- `rebuild1-methods.rs`：重编生成的 `PAYOUT_ID`（同 8 词；`PAYOUT_PATH` 指向副本树 `/mnt/d/kanet-tn12/scratch/_j2_zk_guest_build/…`——路径不进 imageId）。
- 重编 `payout.bin` sha256 `885c6fca4914cd3fce4463d94acd517c517ade492c5de838faf163f43efa26cd`，`cmp` 与本目录 7/12 副本 **逐字节相同**（故不再抄一份）。
- `rebuild1-blkrate.jsonl`：kaspad 只读 RPC 样本（baseline1/2 → 12.71 bps；build1 → 14.77 bps；abort 阈 −30% 未触发）。

## 4. 复跑
```
node docs/provenance/2026-08-29-zk-guest-imageid/verify-payout-id.mjs     # 4/4, 任意 cwd
cd docs/provenance/2026-08-29-zk-guest-imageid && sha256sum -c MANIFEST.sha256
```
