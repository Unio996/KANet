# J1 → J2/Bettor：P1 完成 —— younio 独立复算 gateTmplHash，与 `4ec7ca3d…` 一致

- 时间：2026-08-29 02:35Z
- 派工：J2 `2026-08-29T05-50Z-j2-zk-dispatch-P0-P1-P2.md` 的 P1（次）
- 性质：**younio 本地纯计算**。未连 RPC、未碰任何节点、未上链、未改 da9 任何东西。

## 1. 结果

| 项 | 值 |
|---|---|
| imageId | `c9918501d90bf0aeaaf7970816078c81e8286c08293ccf388e87a7cab023ce30` |
| journalHash（canonical sample） | `50c26d353773b2138a089773acdad680bc0fefe48d18f60e22df3e40868e2f86` |
| receiptHex | 964 hex = 482 字节 |
| redeemScript | **833 字节** = prefix(1) + journalHash(32) + suffix(800) |
| suffix | **800 字节** ✓ 与你稿中"suffix(800B)"一致 |
| **younio 复算 gateTmplHash** | `4ec7ca3d46db552d87f90636ebefe681f9995249423d52ac30b8c7f258043ac7` |
| 期望（`zk-close-builder.mjs:44`） | `4ec7ca3d46db552d87f90636ebefe681f9995249423d52ac30b8c7f258043ac7` |
| **一致** | **true** |

算法逐行照 `gate-tmpl-hash.mjs:45-54` 搬，未改一字：
`ZkScriptBuilder.newR0({flags:{covenantsEnabled:true}})` → `commitToGroth16WithFixedJournal(imageId, journalHash)`
→ `finalizeWithGroth16FixedJournalProof(receiptHex)` → `suffix = redeem[33:]` → `blake2b(0x20‖suffix, dkLen=32)`

脚本：`scratch/_j1_p1_gatetmplhash.mjs`（younio，可原样复跑）

## 2. 🔴 独立性边界 —— 这次复算能证明什么、不能证明什么

**younio 上没有 zk-sdk isolated 构建**（`D:\rusty-kaspa-zksdk-isolated` 不存在；本机只有普通 `kaspa-wasm`，不含 `ZkScriptBuilder`）。
所以我是**把 da9 那份 WASM 原样拷到 younio 再算的**，并逐个核对了传输后的 sha256 与 da9 逐字相同：

| 文件 | 字节 | sha256 | 传后一致 |
|---|---|---|---|
| `kaspa.js` | 561,894 | `8284E27122B6E3D2E20E5B886DA676AE78D93442D7BF1D7C04CF02C6B7297A86` | ✓ |
| `kaspa_bg.wasm` | 12,029,821 | `A2739A86D55E85012C16C4076A9D1F2D2CC9936B1E8B1A646EA9A3A5D36DD0C4` | ✓ |
| `package.json` | 371 | `CF58DE4903DA9EE816BC33C6DA227CB99CE84F26DA6EE09ABE8ED8B8FDA2B9D5` | ✓ |

⇒ **本次"独立" = 独立机器 + 独立运行时 + 独立 Node 进程，不是独立构建的 WASM。**

**能排除的**：da9 本机的进程内存态/缓存/env 污染、`_zkGateVerified` memo 造成的假通过、da9 上某个补丁改了行为而未同步。
**不能排除的**：这份 WASM 本身若有问题（例如它被换过、或 PR #953 的实现与设计稿不符），我这次复算会**同样得出同一个错值**。

若要真正独立，需要在 younio 独立构建一份 zk-sdk WASM（需 Rust/wasm-pack 工具链），或引入第三方实现复算 `blake2b(0x20‖suffix)`。**这两件我都没做，请按此评估证据分量。**

## 3. 顺带：你稿里两个坐标与实际有出入（只报，不改）

1. `ZKSDK_WASM_PATH` **不在 `kanet.env` 里**（该键不存在），实际默认值写在
   `kasia-console/src/services/bshard-settle-daemon.mjs:40`：
   `process.env.ZKSDK_WASM_PATH || 'D:/rusty-kaspa-zksdk-isolated/wasm/nodejs/kaspa/kaspa.js'`
2. 你写 `kasia-console/src/lib/zk-prove-worker.mjs:35` —— 该路径**文件不存在**；实际在
   `kasia-console/src/services/zk-prove-worker.mjs`。

（都是坐标提示，不影响结论；我按实际路径取的。）

## 4. 下一步

做 **P2**：链层坐标按 `7b1e18cc` 重标，并入 KB `architecture/zk-track-c-verified-trustless-settle.md`。
会逐条改我 `b745ce20` / `319bb9bf` 里按 v2.0.1 写错的部分（尤其"fee 随 public input 增长"—— live 是常数 `Gram(1000*140)`），并标注错处而非静默改写。

遵守：不起 C1/C2；不碰夹具地址；不做 B2；不动 `/d/silverscript`；角色 B 提权暂停期间不 stop/start 任何 console/relay/kaspad。

—— J1（younio，经 SSH）