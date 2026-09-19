# 2026-09-19 J2 — mass 断言"卡点"对账：476,668 是本地 wasm 估算值，不是节点权威值

对应：实现计划 v0.6 §6b 意外发现② / §8 开放点 10；Bettor 裁定（对等消息，2026-09-19）要求先对清
"批3 实测 457,504" 与 "穷举得 476,668" 两个数，再谈阈值 / ceiling。**本文只做只读对账，未改阈值、
未改 `SIGNED_INPUT_CEILING_SOMPI`、未改构造逻辑、未向 simnet 提交任何交易。**

D-021 合规：无真实地址、无私钥值；simnet 数字与 txid 前缀取自批3 provenance。

## 环境（对账当时现核）

- 侧分支 `coord/j2-proto-v0-settlement-design-v0.1` @ `c0ed02f3`；`proto-mass-ceiling.mjs` sha256 前 16 位 `c664700f2ccb1bef`。
- 节点二进制 `D:\rusty-kaspa-v201\kaspad.exe`：sha256 `8afe6a6859067a859ac255c77946ca881cd5bbae4230a1906fff3841044c6e38`，
  `--version` = `kaspad 2.0.1`；simnet 进程 PID 15972（2026-09-16 起，命令行 `--simnet` 那组，只绑 127.0.0.1）。
- 对账全程离线（真 kaspa-wasm + 真编译 + 生产 builder），不连节点。

## 结论

**计划 v0.6 里那个 476,668 = `assertMassWithinCeiling` 三个信号里的 `localMass`（本地
`kaspa.calculateTransactionMass`）在 fee=100,000,000 sompi 时的值，不是节点值。** 同一形状的
"手算 storage"（consensus `calc_storage_mass` 的 JS 移植）在同一面值只有 435,000（87.0%）。
断言取三者最大值，被本地估算——设计文档 §0.14b 已确认的"复杂 covenant 交易本地偏高"那一个——顶出了阈值。

### 三个形状：手算 storage vs 节点权威 storageMass（fee UTXO 均 95,000,000 sompi，route A 参数）

| 步骤 | 节点 getMempoolEntry storageMass（批3 provenance，原始留存的是解析后数值） | 手算 storage（本次） | 差 | 本地 wasm localMass | localMass 相对节点值 |
|---|---|---|---|---|---|
| register_append#1 | 457,504 | 457,504 | **0** | 500,980 | +9.5% |
| register_append#2 | 293,116 | 293,116 | **0** | 411,635 | +40.4% |
| market_seal | 231,312 | 231,312 | **0** | 349,831 | +51.2% |

三个形状手算与节点逐位相等（独立来源：节点是真实共识执行，手算是按 consensus 源码移植的公式，两者
不共用实现）。**本地 wasm 值在三处全部高于节点值（+9.5% / +40.4% / +51.2%），且 95M 那一行
（500,980）已高于 500,000 硬顶，而节点实际接受了该交易** ⇒ 本地 wasm 值不是 consensus mass，只能当粗筛。

### register_append#1 fee 面值扫描（本次，原始输出见 `raw-04-bet1-fee-sweep.txt`）

| fee UTXO | localMass | 手算 storage | 手算 compute |
|---|---|---|---|
| 85,000,000 | 1,041,946 | 994,327 | 15,470 |
| 90,000,000 | 564,326 | 518,872 | 15,470 |
| 95,000,000 | 500,980 | **457,504**（=节点值） | 15,470 |
| 100,000,000 | **476,668**（=计划 v0.6 的数） | 435,000 | 15,470 |

## 没有证明的（不要外推）

1. **手算 storage 只在这三个形状上与节点逐位相等**；代码注释已写明它只实现"一般分支"、对 |O|=1 等
   边界会**高估**（安全方向），但"三点相等"不等于"处处相等"。
2. **手算 compute 明显偏低**：15,470 / 22,470 / 22,100 vs 节点 computeMass 33,927 / 44,198 / 60,422
   （手算传入 txByteSize=0，且不含 witness 大小项）。compute 维度离上限仍远（节点值最高 60,422 = 12%），
   但**如果把 compute 维度也交给手算信号，它不是守卫**，不能宣称 compute 已被独立验证。
3. **fee=100M 的节点权威 storageMass 未实测**（预测 435,000，未提交）。要拿节点原始返回需在 simnet
   真提交一次；未提交，等 Bettor / NWT 的排期。批3 那次留存的是解析后的数值，不是 getMempoolEntry 原始 JSON。
4. 本文**不裁定**该怎么改断言（去掉 localMass？只在 localMass 与手算偏差 >X 时以手算为准？）——那是
   Bettor 的裁定，我只给出偏差数据。

## 复现

`04_bet1_signal_probe.mjs.txt` / `05_bet2_seal_signal_probe.mjs.txt`（去掉 `.txt` 后放到
`kasia-console/scratch/_j2_simnet/` 下运行：`node scratch/_j2_simnet/04_bet1_signal_probe.mjs`；
脚本自带临时库迁移，不碰任何真实库）。
