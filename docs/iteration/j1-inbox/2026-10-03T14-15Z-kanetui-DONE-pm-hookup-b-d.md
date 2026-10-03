# KANet-UI 交件：接通清单 B 组（6 个专用委员钱包）+ D 组（WSL 装 RISC0 证明工具链）— 账本 (1813)

作者自报；Bettor 请独立核。未转钱、未 enroll、未改 env/代码、未重启 console、未动 WSL 本身与数字人服务。
D-021：本页不含地址、助记词、余额。6 个地址 + 资金命令草稿在 `docs-private/`（本机 gitignored），地址已写入 `docs-private/ASSET-INVENTORY.md` 新小节「二·附 委员钱包（预测市场主网，2026-10-03 建）」，未写助记词。

## 一、B 组

### B1 建 6 个专用钱包 — 完成
- 建前备份：`kasia-console/data/backups/console.mainnet.pre-oracle-wallets-20261003.db`，sha256 `cad12c05df077b1ca2e22e19564a2dc87295e74a29c5a4640914e1e1c3d6be3b`，九表行数源=备份 match 全 true（`ktt_panel_rate_limit_log` 现为 8，J2 探针新增，非本次改动）。
- 做法：脚本 `kasia-console/scratch/_kanetui_create_oracle_wallets_20261003.mjs`（gitignored）：对 :3202 `POST /relays/generate-mnemonic`（`relay.js:1353`，network=mainnet）拿助记词+地址，**不打印、不落文件**，在内存里直接 `POST /relays`（`relay.js:90`）。控制台把助记词加密存进 `console.mainnet.db`（`relay-nodes.js:25`，与现有 18 个 relay 同机制）。每个都核了：库里地址 == generate 返回地址。
- 结果：`oracle-mn-01`(1c38742a) / `-02`(ee93890e) / `-03`(a8593afc) / `-04`(b2ba6db2) / `-05`(b201f032) / `-06`(74278338)，network=mainnet，`mnemonic_encrypted` 非空，`GET /api/relay/:id/balance` 均为 0。
- 进程与可见性：我没手动起进程，建完约 35 秒内 relay 子进程数 18 → **24**（健康监控 cron 拉起，`index.js:783-787`）；`GET /relays` 200 且页面含 `oracle-mn-01..06`；stderr 致命关键词命中 0。热钱包准入（`checkHotwalletAdmission`）未拒。
- 新增风险（如实）：这 6 把钥匙**只存在于 `console.mainnet.db` 的加密列里**，没有离线助记词备份。库丢失/CONSOLE_ENCRYPTION_KEY 丢失 = 钥匙不可恢复（与现有 18 个热钱包同风险）。每个只放 ~1.2 KAS，量级小。

### B2 置 `is_oracle` — **停手，未执行**
- `POST /api/relay/:id/role`（`relay.js:251`）**不是**置位接口：`VALID_ROLES = ['broker','trader','predictor','general','user']`（`relay.js:239`），没有 'oracle'；UPDATE 只写 `role/is_dex_broker/is_service/roles_json`，**不动 `is_oracle`**。
- 全仓代码里没有任何 API 置 `is_oracle=1`（`/api/oracle/announce` 也只写 `oracle_registry`，不设该列）。⇒ 置位 = 直接写库，按派工「不得直接改库」停手。6 个现为 `is_oracle=0`，`role=null`。
- 事实补充：入池（enroll）不要求 `is_oracle=1`；它决定本机哪些 relay 能做委员签名/投票（`bshard-close-voter.js:281,413`、`bettor-prediction-voter.js:88` 等）。是否/如何置位请你定（Owner 终端写库，或改代码，各属铁律 0 范围）。

### B3 资金命令草稿 — 已备，**未执行**
- 文件：`docs-private/2026-10-03-kanetui-oracle-mn-funding-command-draft.md`（含完整地址与 relay UUID，不入公开仓库）。
- 内容：PowerShell，读 `ADMIN_SECRET_FUNDS`（不打印）→ 对 6 个地址各 `POST /api/relay/$src/transfer` 1.2 KAS（1 KAS 质押下限 + 0.2 KAS 余量），每笔间隔 45 秒（relay 本地 UTXO 视图转账后滞后 15–60 秒，接位文件已记），任一失败即停。
- 付款方：排除 broker(`Trader-A`)、PROTO_RELAY_ID(`proto-v0-funds`)、KTT 专用(`KANet-UI`/0044cfbd)、escrow 专用（具体是谁未核）、stress-*（余额<1 KAS）。草稿默认候选 A = `NWT` relay（余额充裕，避开 KIP-9「付款近乎清空钱包」坑），候选 B = `J2`（余额约 10.9 KAS，付 7.2 后余约 3.7，可行但余量小）。余额读数在 `docs-private/2026-10-03-kanetui-mainnet-relay-roster-and-balances.json`。付款方最终由你/Owner 指定。

## 二、D 组：WSL Ubuntu-24.04 装 RISC0 证明工具链 — 完成，imageId 复现一致

### 开始前现状
`/root` 下无 `.risc0` `.cargo` `.rustup`，无 cargo/rustc/rzup（Ubuntu-24.04 默认用户 root；`wsl -l -v` 默认发行版是 `docker-desktop` 且 Stopped，prove worker 的 `wsl.exe -e bash -lc`（`zk-prove-worker.mjs:70`）无 `-d`，是否落到 Ubuntu-24.04 **本次未调用验证**，仍是风险点）。

### 装了什么（按 `zk-payout-guest/TOOLCHAIN.lock.json`，非最新）
1. host：rustup 1.29.1，`--profile minimal --default-toolchain 1.96.1` → `rustc 1.96.1 (31fca3adb 2026-06-26)`、`cargo 1.96.1 (356927216 2026-06-26)`，与 lock `host_toolchain` 逐字一致。rustup 自动在 `/root/.profile`、`/root/.bashrc` 加了 `. $HOME/.cargo/env`（所以 worker 的 `bash -lc` 能找到 cargo）。
2. risc0：官方安装脚本 `https://risczero.com/install`（先下载读过，来源 risc0 的 S3）装 rzup 0.5.0，再 `rzup install rust 1.94.1` / `cargo-risczero 3.0.5` / `r0vm 3.0.5`（预编译二进制，非源码编译）。结果：`/root/.risc0/toolchains/v1.94.1-rust-x86_64-unknown-linux-gnu`（与 lock 路径同名），rustup 名 `risc0`，`rustc +risc0 -V` = `1.94.1-dev (06e01cb0d 2026-04-09)`、`cargo +risc0 -V` = `1.94.1-dev (29ea6fb6a 2026-03-24)`，与 lock 一致。`cargo-risczero 3.0.5`、`r0vm 3.0.5` 在 `/root/.cargo/bin`。lock 写 risc0 全套依赖版本（risc0-build/zkvm 3.0.5 等）由 `Cargo.lock` 钉住，构建时核对通过。
- 全程 `nice -n 19`，未用显卡，无并发编译（jobs=2）。

### 复现构建（在副本树，不碰 live `target/`）
- 做法：把 `zk-payout-guest`（排除 `target/` 与 `proofs/`）复制到 WSL 本地 `/tmp`，`NICE=19 JOBS=2 bash scripts/verify-image-id.sh --build`（即 lock 的 `rebuild_evidence` 做法）。
- **第 1 次**（显式 `RUSTUP_TOOLCHAIN=1.96.1`）：`Finished release ... in 55.00s`；`payout.bin` **366748 B，sha256 `885c6fca4914cd3fce4463d94acd517c517ade492c5de838faf163f43efa26cd`**；`got = want = c9918501d90bf0aeaaf7970816078c81e8286c08293ccf388e87a7cab023ce30` → `IMAGE_ID OK`。
- **第 2 次**（模拟 worker 的 `bash -lc`，无 `RUSTUP_TOOLCHAIN`，树内 `rust-toolchain.toml channel=stable` 生效）：`Finished ... in 33.35s`；同样 sha256 与 imageId → `IMAGE_ID OK (login-shell run)`。
- 对照：sha256 与 `docs/provenance/2026-08-29-zk-guest-imageid/payout.bin`（`885c6fca…26cd`，366748 B）逐字相同；与 lock 文件 `sha256_prefix 885c6fca4914cd3fce4463d94acd517c` 相符，与 8-29 rebuild_evidence「byte-identical to 2026-07-12」相符。
- 日志与脚本：`docs/provenance/2026-10-03-kanetui-wsl-risc0-toolchain/`。副本树已删除（`/tmp` 无残留）。

### 副作用 / 要你知道的事（如实）
- 第 1 次构建过程中，rustup 因树内 `rust-toolchain.toml channel="stable"` 自动装了 **`stable` = `rustc 1.99.0 (b940084d7 2026-09-28)`**（我没显式要求；`/root/.rustup/toolchains/` 现有 `1.96.1`、`risc0`、`stable` 三项；默认仍是 `1.96.1`）。第 2 次 worker 形态构建里 host 实际用的是 stable 1.99.0，imageId 仍一致，印证 lock 说的「host 工具链不承重」；但 host 二进制（`target/release/host` 之外的新编）将来用哪个 rustc，取决于 `rust-toolchain.toml`，仍是浮动的（lock `.md` 已记，未改）。
- 磁盘占用：`/root/.rustup` 1.3 GB、`/root/.risc0` 1.7 GB、`/root/.cargo` 240 MB（`/` 余 ~916 GB）。
- `rzup` 二进制在 `/root/.risc0/bin`，仅被 `.bashrc`（交互式 shell）加入 PATH，`bash -lc` 登录 shell 的 PATH 里没有 `rzup`；`risc0-build` 以库形式使用，第 2 次（`which rzup` 为空）构建成功说明构建不依赖该二进制。
- **没验证的**：真实 prove（出 Groth16 证明，约 4 分钟、吃 CPU/内存）没跑；`zk-prove-worker` 的 `wsl.exe` 默认发行版问题没验；Docker 是否是 Groth16 转换所需仍未核；`r0vm 3.0.5` 是否装的就是 lock 里那一份只核了版本号，没比 sha。

### 数字人服务（硬约束核对）
安装前后：`avatarforcing.service`、`r2t2ws.service` 均 `active`；`:8449/health` → `{"ok": true, "fps": 25, "loaded": true, "stream": true, "idle_sec": 0}`；8445/8447/8449/8450 监听照旧；全程未重启 WSL、未 `wsl --shutdown`、未停任何服务、未碰这四个端口。WSL 内存 15 GB 总量，安装期间 available 6–7 GB，未见压力。

## 三、尚未做 / 待你定
1. `is_oracle` 置位路径（B2）。
2. 6 个钱包的资金（Owner 终端执行 B3 草稿，付款方待指定）；到账后再派 enroll（enroll 会广播、花矿工费）。
3. 6 把钥匙的离线备份方式（目前仅在 `console.mainnet.db` 加密列）。
4. `ZK_PROVE_WORKER_ENABLED` 开关与五个 `ZK_*` env 不在本批（仍关）。
