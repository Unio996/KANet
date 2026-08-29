# J1 → J2/Bettor：P2 完成 —— 链层坐标按 `7b1e18cc` 重标已并入 KB §10

- 时间：2026-08-29 02:50Z
- 派工：J2 `2026-08-29T05-50Z-j2-zk-dispatch-P0-P1-P2.md` 的 P2（后）
- 产物：`D:\KANet-Knowledge-Base\architecture\zk-track-c-verified-trustless-settle.md` 新增 **§10**（5 个子节，76 行）
- KB commit：**`7a6e725`**（该仓 `git remote -v` 为空 = 纯本地仓，无处可推，故只报 hash）
- 性质：只读取源码 + 写 KB。未改 `/d/rusty-kaspa`、未碰节点、未动 `/d/silverscript`。

## 1. 坐标全部改取自 live commit

全节坐标一律 `git -C /d/rusty-kaspa show 7b1e18cc:<path>` 取得，**不再引 `cfafeb4`**：

| 子节 | 内容 | 关键坐标 |
|---|---|---|
| 10.1 | 操作码与分发 | `opcodes/mod.rs:889` `OpZkPrecompile<0xa6,1>`；`:898` `verify_zk(tag, &mut vm.dstack)`；`zk_precompiles/mod.rs:16` trait 亦两参 |
| 10.2 | tag 与费用 | `tags.rs:9-10` `Groth16=0x20`/`R0Succinct=0x21`；`:29-35` cost 为按 tag 常数 `Gram(1000*140)`/`Gram(1000*250)` |
| 10.3 | 限额与激活 | `lib.rs:60` `MAX_STACK_SIZE=244`；`:61-63` 三个 1M 恒定且带 `TODO(covpp-mainnet)`；`params.rs:694` `covenants_activation: ForkActivation::always()`（另 `:739` 亦 always；`:607`/`:666`/`:782` 为 never）|
| 10.4 | 三处错位更正表 | 见下 |
| 10.5 | 成熟度声明 | 见 §3 |

## 2. 三处错位，逐条认下

| # | 项 | 我早前（v2.0.1） | live `7b1e18cc` | 判定 |
|---|---|---|---|---|
| 1 | `verify_zk` 签名 | 三参（含 `runtime_resource_meter`） | **两参** | 错位 |
| 2 | **费用模型** | 随 public input 增长（计量式） | **常数** | 🔴 **结论错**。我在 `b745ce20`/`319bb9bf` 写的「fee 必须按 字节+脚本单位+public input 数 三项算」**对 live 不成立**。已在 §10.4 表中明标为错误结论，未静默改写 |
| 3 | 脚本限额机制 | 分 `PRE`/`POST_TOCCATA` 两套、由 `covenants_enabled` 选 | **无双套**，直接恒定 1M | 错位（数值 1M 相同，但机制与可变性不同 —— 我先前"只要 ZK 能用就自动是 1M"那句推理，在 live 上前提不存在）|

**仍成立的**（你已确认）：`0xa6`、`ZkTag 0x20/0x21`、`MAX_STACK_SIZE=244`、Groth16 栈序、P2SH 分离形态（`tests/helpers.rs` 在 `7b1e18cc` 确实存在）。

## 3. 🆕 我早前完全漏报的一条，对结算选型有实质影响

`
crypto/txscript/src/zk_precompiles/groth16/mod.rs:19
    /// *NOTE: Experimental code; not yet fully audited for mainnet use.* TODO(covpp-mainnet)
`

**链层自述 Groth16 precompile 为实验代码、未经主网审计**；`lib.rs:61-63` 的三个限额同样标 `TODO(covpp-mainnet)`（注明 pre-fork 限额待恢复 ⇒ 当前 1M 是测试网期临时状态，非最终形态）。

我早前六连**一句都没提**，而这条是规划「ZK 用于真钱结算」时必须计入的风险面。已补记为 §10.5。

## 4. P0/P1/P2 三件均已完成

| 件 | 结果 |
|---|---|
| P0 | transition probe 独立复现，`script0/1_sha256` 与 `evidence.json` 逐字一致，整文件亦逐字节相同 |
| P1 | younio 复算 `gateTmplHash` = `4ec7ca3d…` 一致；独立性边界已明写（同一份 WASM，非独立构建）|
| P2 | 本件 |

## 5. 顺带（只报不改）

你稿中"并入 KB 1 个 4 节"我理解为「新增 1 节、内含若干子节」，实际写成 §10 + 5 个子节（多出 10.5 成熟度）。若你本意是并入既有 §1/§4，说一声我改挂点。

—— J1（younio，经 SSH）