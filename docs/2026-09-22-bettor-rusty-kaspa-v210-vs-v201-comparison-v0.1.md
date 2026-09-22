# rusty-kaspa v2.1.0（2026-09-22 发布）与主网在用 v2.0.1 比对 v0.1

> **Status**: CURRENT · Bettor 2026-09-22 · Owner 本机终端「这是一个高质量更新。一定要认真比对。」· 依据 D-017（主网 = 官方 v2.0.1 原样）· 账本 1643
> 结论：**建议升级主网节点到 v2.1.0，但走分级门：先在 simnet 用现有 8 步结算 + F1/R-a harness 逐字节重跑，再随下一次 Owner 批的重启窗换二进制；主网换二进制 = Owner 单独 GO。** 本文只比对，不动任何生产物。

## 0. 地面事实（gh 直读 GitHub，2026-09-22 15:2x Z）

| 项 | 值 |
|---|---|
| 最新正式版 | v2.1.0，2026-09-22T13:55:36Z，非预发布 |
| 我们主网 | `D:\rusty-kaspa-v201\kaspad.exe` = `kaspad 2.0.1`，sha256 前缀 `8afe6a68…`（与账本 D-017 记录一致） |
| v2.0.1 → v2.1.0 | 21 个提交，无分叉（behind 0），跨 2026-06-17 ~ 09-22 |
| 发布资产 sha256（GitHub digest） | win64 `fb25743a4b432d376c4ca49d8799769dbc6d5b070f0b502350ce32cfdb38ec0f`；linux `5ba61c05…dad8`；osx `d9002392…d75d`；wasm SDK `ba674e10…6124` |
| 我们节点暴露面 | P2P `0.0.0.0:16111`（公网）；RPC gRPC `127.0.0.1:16110`、wRPC borsh `127.0.0.1:17110`（仅本机） |
| 我们 wasm | `shared/vendor/kaspa-wasm` 1.1.0，2026-06-20 自源码 build3（covenant 支持），非官方 SDK 包 |

## 1. 21 个提交按面归类与对我们的影响

| 面 | 提交（规模） | 内容 | 对 KANet 的影响 |
|---|---|---|---|
| **P2P 协议 v11 / 分块 IBD** | #1136（16 文件 +855）| 大 IBD 载荷按 20 MiB 分块，协议 11 向下兼容 10 | 我们节点与网络互通不受影响；IBD 更稳。**正向，无改动需求** |
| **P2P / 传输加固** | #1138（159 文件 +2257 −518，含算术审计）| 最大消息 1 GB→256 MB、线级交易/区块上限（区块 2 MB）、被 ban 入站立即拒、父数上限 | 我们 P2P 端口 16111 对公网开放 ⇒ **DoS 面收窄是直接收益**；covenant 交易远小于上限，无影响 |
| **共识清理（post-Toccata）** | #1082–#1089、#1101（约 140 文件，净 −7.6k 行）| 删除 Toccata 激活分支与过渡参数（`toccata_activation`、`prior/new` mass limits、mempool 延迟归一化）；`BLOCK_VERSION` 固定 2；sigops 改 script units、covenant 校验无条件；devnet 激活 Toccata | 主网早已过激活点，**有效行为不变，无主网参数数值改动**（params.rs / constants.rs diff 逐行核）。删掉的是我们从未走到的分支。**必须用 simnet 重放我们的生产字节确认（§3）** |
| **ZK SDK 独立 crate** | #953、#1064、#1067、#1071（约 70 文件）| `kaspa-txscript-zk-sdk`：Groth16 静态/动态 image id、控制证明长度界、Windows 链接修复 | **与 ZK 主线（铁律 0.5 / D-005）直接相关**：我们 `D:\rusty-kaspa-zksdk-isolated` 停在 v2.0.0，可改为跟官方 crate；另立票，不影响本次节点升级 |
| **mempool / 挖矿** | #1137、#1138 | mempool 显式拒 coinbase；relay fee 计算 saturating_mul | 无影响；`--enable-unsynced-mining` 与 pastMedianTime 逻辑**未改**（manager.rs diff 只删激活参数管道） |
| **RPC** | #1056、#1138 | vspcv2 输出补 covenant 字段；gRPC 可选头/交易解码用 checked 转换 | 我们**不使用** vspcv2（全仓 grep 仅一处注释）；wRPC borsh 路径无变更 |
| **wasm SDK** | #1085 | `AllAnyOneCanPay` sighash 映射修正 | 我们只用 `SighashType.All`（createInputSignature 四处），**不受影响**；且我们的 wasm 是自建 1.1.0，不随节点升级变 |
| **钱包 / 脚本诊断** | #1072、#1096 | bip32 xprv 常量时间比较修正；txscript `InvalidOutputIndex` 报输出数 | 我们不用 kaspa-bip32；诊断改进对 debugger 排错有利 |
| **Stratum 桥** | #1079 | 路径穿越、CLOSE_WAIT、metrics 基数 | 我们**不运行**桥，无影响 |
| **数据库 / 索引** | database、utxoindex | 仅 clippy 算术注解，**无 schema / 版本变更**（全 diff 无 DB_VERSION 改动） | **同一数据目录可直接换二进制；回滚到 2.0.1 同样无迁移** |

## 2. 结论

1. **不是硬分叉**，也没有主网共识参数数值变化；协议 11 与 10 互通。不升级不会掉队，但 P2P 公网端口的 DoS 面收窄是实打实的安全收益，上游"强烈建议升级"。
2. **风险集中在一处**：共识清理净删 7.6k 行 + txscript 大改（script units 取代 sigops、covenant 校验无条件）。逻辑上主网行为不变，但我们的结算链靠 11 个 .sil 编译字节，**必须以真共识重放证明**（工具版本先核纪律 + "自检一侧须独立来源"）。
3. **升级操作本身很轻**：无 DB 迁移，换目录重启即可；回滚 = 换回 2.0.1 二进制。

## 3. 升级门（默认方案 · Owner 可否决 · 主网换二进制须 Owner 单独 GO）

1. **取件核签**：下载 `rusty-kaspa-v2.1.0-win64.zip`，sha256 必须 = `fb25743a…ec0f`；解压到 `D:\rusty-kaspa-v210\`，`kaspad --version` = 2.1.0，记 kaspad.exe sha256 进 provenance 与本文。
2. **simnet 真共识重放（J2，复用现成 harness，D-031）**：用 v2.1.0 起隔离 simnet，重跑 ① 8 步结算链（账本 1486 / provenance @50019d4f 的脚本），② F1 / R-a harness（`docs/provenance/2026-09-22-j2-f1-adversarial-rerun/scripts`、NWT `_nwt_fz_repro` 副本），③ 生产 builder 字节的 mass 读数（storageMass / computeMass 两维）与 2.0.1 记录对照。判据：同一字节被 2.1.0 接受、mass 不变。
3. **NWT 独立核**：只审 provenance + 自己起一次 2.1.0 simnet 跑 8 步（关 3）。
4. **主网切换（Owner GO 后，随下一次 console 重启窗）**：停 kaspad 16464 → 同一 `--appdir=D:\kaspa-mainnet-data-v201` 用 v2.1.0 启动、参数不变 → 观察同步 / `isSynced` / utxoindex → console 健康检查通过（`proto-relay-guard` fail-closed 期间驱动自然 HOLD）。回滚：停 2.1.0，用 2.0.1 同目录重启。
5. **文档**：D-017 加状态注记（主网二进制版本），`docs-private` 不涉及；能力清单更新节点版本行。

## 4. 不做 / 另立票

- 不升级 `shared/vendor/kaspa-wasm`（自建 1.1.0，与本次节点无耦合；若要跟官方 SDK 2.1.0 另评估签名 / mass 差异）。
- ZK 主线改跟 `kaspa-txscript-zk-sdk` 官方 crate：另立票（J2 / ZK track）。
- devnet 现已激活 Toccata：仍用 simnet（skip_proof_of_work），不换。
- 本文不触碰主网、不下载安装任何东西。
