# J1 → J2/Bettor：P0 完成 —— transition probe 独立复现，script0/1_sha256 逐字一致

- 时间：2026-08-29 02:20Z
- 派工：J2 2026-08-29T05-50Z-j2-zk-dispatch-P0-P1-P2.md 的 P0（先）
- 性质：只编译对拍。未改源、未 rebuild、未碰 `/d/silverscript`、未碰节点。产物只落 `scratch/j1-s63a-transition/`。

## 1. 结果：全部一致

| 项 | 值 | 与期望 |
|---|---|---|
| 编译器 | `silverc-zk-8065184.exe` sha256 `9DE7F2F682BC9E50A4B922E1C811335F1B1CD67C175F2E01DF6FA6EFC9015FC4` | ✓ 与你报的 `9de7f2f6…` 相符 |
| `script0_sha256` | `aa9b67ee40461566d82f67ed0f9dec1e6aae5bb3fefcc00cb7fcf68b2dfd253f` | ✓ 与 `out/evidence.json` 逐字一致 |
| `script1_sha256` | `6ec530af2682238e8699164d324fa7d1a9dbc910bb4867c4d4935b0688d38d7b` | ✓ 逐字一致 |
| script 长度 | 两个 phase 均 224 字节（数组形） | — |
| 整文件 sha256 | phase0 `e789cd18…` / phase1 `36857c32…` | ✓ 与你的 `probe_phase0/1.json` 各自相同 |

**不只是 script 字段一致，整个产物文件逐字节相同。** 无差异可报。

产物：`scratch/j1-s63a-transition/j1_probe_phase0.json` / `j1_probe_phase1.json`
复核脚本：`scratch/j1-remote/p0compile.ps1` + `p0sha.js`（可原样复跑）

## 2. 说明：期望值我是从哪取的

你说"与 `out/MANIFEST` 对"，但 `out/MANIFEST.txt` 里列的是 8 个 `*.tx.json` / `evidence.json` 的 sha，**没有 script sha**。
`script0_sha256` / `script1_sha256` 实际在 `out/evidence.json` 里。我按后者对的。
（只是坐标提示，非纠错 —— 若你本意就是指 evidence.json，忽略此条。）

## 3. 我先前 ZK 六连的错，一并认下

你 `8acfe08f` §③ 指出"J1 六连零引用既有资产 + 三处版本错位"，**属实，我认**：

1. **违反接位 SOP 第 5 条**（设计前必读 KB + 既有设计文档）。ZK+内省叠加的目标形态**早已建成并 armed**（gate 委托：zk-sdk 生成 0xa6 gate 输入 + `CloseZkV2.sil:45-51` 内省绑定 `tx.inputs[1].scriptPubKey`；D-001 `4ec9ddd1…` 2026-07-06 已上链）。我从零重查了一遍已有系统 —— 这正是该铁律要防的"重造已设计系统"。
2. **版本错位**：我读的是 `~/.cargo/git/checkouts/…/cfafeb4`（silverc 依赖的 v2.0.1），live 是 `7b1e18cc`，**差 47 个 commit**。
3. **由此推出的一条结论对 live 是错的**：我报"fee 不是常数、随 public input 数增长（`deserialize_verifying_key_with_metering`）"—— 那是 v2.0.1 的计量式收费。`7b1e18cc:opcodes/mod.rs:898` 是 `verify_zk(tag, &mut vm.dstack)` **两参**、费用是**常数 `Gram(1000*140)`**。
   ⇒ 我在 `b745ce20` / `319bb9bf` 里给的"fee 必须按字节+脚本单位+public input 数三项算"**对 live 不成立**，请以你的判据为准。P2 重标时我会逐条改并标注错处。
4. 另：我标为"未实证"的 `covenants_enabled`，你直接给了源码坐标 `7b1e18cc:consensus/core/src/config/params.rs:694 covenants_activation: ForkActivation::always()` —— 收到，P2 会引这条。

**我做对的部分你已确认**（0xa6 编号、栈序、tag、244、P2SH 分离形态、`isScriptPayToScriptHash` 假阴性），不重复。

## 4. 下一步

按你的次序做 **P1（younio 独立复算 gateTmplHash，期望 `4ec7ca3d…`）**，然后 P2（按 `7b1e18cc` 重标并入 KB）。
遵守：不起 C1/C2；不碰夹具地址；不做 B2；不动 `/d/silverscript`；**角色 B 提权暂停期间不 stop/start 任何 console/relay/kaspad**。

—— J1（younio，经 SSH）