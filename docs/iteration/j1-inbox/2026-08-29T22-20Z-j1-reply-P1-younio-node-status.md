# J1 · P1 交付 —— younio 节点状态与「何时可作第二 vantage」实测 ETA（2026-08-29）

> 全部为亲跑读数。RPC 用生产在用的 kaspa-wasm + Borsh（遵 ANTI-PATTERNS 规则 59，未手搓协议）。

## 1. 权威状态（getServerInfo + getBlockDagInfo）

`json
{
  "isSynced": false,
  "hasUtxoIndex": true,
  "serverVersion": "1.1.1-toc.1",
  "networkId": "testnet-12",
  "virtualDaaScore": 78217531,
  "blockCount": "1",              // ← 区块体尚未导入
  "headerCount": "5852128",       // ← header 已全量
  "tipCount": 73,
  "virtualParents": 1,
  "pastMedianTimeISO": "2026-08-18T00:50:36.722Z",
  "lagMinutes": 15439.4,          // ≈ 10.7 天(= pruning point 时代, 非故障)
  "peers": 3,
  "gapToFloor": 1878156,          // 距 J2 步0 下界 80,095,687
  "gateStep0": false
}
`

## 2. 现处阶段（不看日志静默，用 CPU/IO 增量判）

日志进度行停在 18:22 不动，但**不是卡住**——30 秒增量实测：

`
CPU    : 单核 29%（全机 2.5%，12 核）
磁盘读 : 18.8 MB/s
磁盘写 : 0.0 MB/s
`

读密集、零写、CPU 中等 = **IBD: searching for missing block bodies 扫描阶段**（da9 走过同一阶段，日志同样静默约 1–3 小时）。
lockCount=1 与之吻合：header 全量 + UTXO 集已导入，**区块体重放尚未开始**。

## 3. daa 速率实测 —— 🔴 当前为 0，**无法给出可信 ETA**

5 分钟对照采样：daa 78,217,531 → 78,217,531，**增量 = 0**。

⇒ 这不是"慢"，是**还没进到会推进 daa 的阶段**。**我拒绝在此基础上外推 ETA** —— 上一次我基于推断给结论（读放大→ram-scale）代价是节点重启 + 8-10h 退回，这次不重复。

**能诚实说的**：
- 进区块体重放之前，daa 必然为 0；那之后才有速率可测。
- 参照 da9（24 核/61.6GB）在该阶段实测 **791–970 daa/分钟**；younio 是 12 核/7.6GB，且瓶颈是**单线程重放**（da9 实测该阶段仅用单核 98–128%，硬件差距在这一段几乎体现不出来），故 younio 速率**可能接近同量级**，但**未经实测不作数**。
- 若按 800/分钟 粗算：1,878,156 / 800 ≈ 39 小时；按 400/分钟 则 ≈ 78 小时。**此数仅作量级参考，进入区块体阶段后我会用实测速率替换。**

## 4. 资源与可常驻性

| 项 | 读数 | 判断 |
|---|---|---|
| kaspad | PID 9360，**自 08/22 18:17 连续运行 6 天未死** | ✅ 稳 |
| datadir | 45.31 GB（D: 尚余 153.4 GB） | ✅ 磁盘充裕 |
| 内存 | RAM free **0.30 GB**，commit 26.8 GB / 物理 7.6 GB | 🔴 紧张，长期靠页面文件 |
| 睡眠 | 已治（AC/DC standby+hibernate+monitor 全 0 + keep-awake 常驻）；PlatformAoAcOverride=0 已写入，**待下次重启生效** | ✅ 不再被打断 |

**可常驻性结论**：能常驻。5 天反复重来的根因（Modern Standby 每闲置即睡）已根治，本轮已连续推进到 header 全量 + UTXO 导入完，datadir 45 GB 单调增长，不再归零。

## 5. 对团队的直接结论

🔴 **younio 现在不能作第二 vantage** —— 与 Codex 7bc9057「younio 不是 second vantage 直到它同步」一致。M_reorg / W_dis 的 two-vantage 证据**在它 isSynced=true 之前一条都不能出**。

**转折点判据**（我会在到达时主动报，不必问我）：
1. lockCount 从 1 开始增长 ⇒ 进入区块体重放，届时给**实测**速率与 ETA；
2. isSynced=true ∧ daa > 80,095,687 ∧ lagMinutes < 10 ⇒ 可作第二 vantage。

## 6. 边界

未动本机节点任何参数（--ram-scale=0.4 是 8/22 建库时定的，本轮未改）；未重启；未碰 da9。