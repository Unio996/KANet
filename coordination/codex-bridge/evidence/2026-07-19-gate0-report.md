<!--
PROVENANCE (Bettor, 2026-07-19, for Codex independent verification per RESPONSE-DISC-20260717-001-005):
- This is an immutable copy of the Gate 0 report, placed here because the original is not on a Codex-accessible ref.
- Original repo path: docs/2026-07-19-gate0-pruning-margin-blast-radius-report.md
- Original commit (full SHA): 5f07f43c6c25f9e6bbbe0c5f771d7f8b38565d9f
- Original branch: bshard-m3-deploy (KANet working branch; NOT pushed to origin, hence Codex-inaccessible — this copy is the accessible artifact)
- Source code/schema commit used for the measurement run: 6da0f1623303f3e7a9253ab497a1a88c7291b7d0
- Raw-set sha256 (25-market snapshot canonical JSON): 99d9f10635a2823479ff4029c5c6d1d77d7ca8da83a136083739d2793c6748d9
- Raw-row JSON (scratch/_j2_gate0_all_25.json) is host-only (gitignored); the per-market table in Artifact 1 below carries every row (id/status/deadline_daa/endBlock/side_lock_daa NULL/bets/KAS) needed to independently recompute the classification arithmetic. The hash above pins the raw set.
- Byte-identical to the original (10894 bytes); copied via filesystem cp, not re-authored.
- Independent verification already done KANet-side: Bettor re-derived DB aggregates (exact match); NWT reconciled classification sums (67192.52 + 2530.47 + 3.00 = 69725.99 exact).
-->

# Gate0 只读测量报告 — Pruning-Margin + Restore-Drill + Blast-Radius

> **Status**: CURRENT

**Owner**: J2
**日期**: 2026-07-19
**授权范围**: Owner "剩两件收口...干!" + Bettor 窄化为 Gate0 只读测量（无部署/迁移/结算/退款/动钱授权）
**Source commit**: `6da0f1623303f3e7a9253ab497a1a88c7291b7d0` (2026-07-19T07:08:52+07:00)
**验收标准来源**: Bettor 转达 Codex RESPONSE-DEC-20260719-001-CODEX-ACK

Codex review note（原文转述，逐条遵守）:
1. ~54275/1526 类数字在本报告产出前仍是估算，未经 Gate0 artifact 复现前不得升级为事实。
2. `getBlockAtDaa` 耗尽是证据连续性的症状，非竞争优先级。
3. **Gate0 完成不 authorize 任何部署/迁移/对生产 restore/settle/refund/动钱 —— 本报告纯只读产出 artifact。**

---

## Artifact 1 — Pruning-Margin 报告

### 测量元数据（复现必需）
- **测量时间戳**: 2026-07-19 (session内, virtualDaaScore探针执行时刻)
- **fresh pruning-point daaScore**: `61653930`（live `rpc.getBlockDagInfo()` → `pruningPointHash` → `rpc.getBlock()` 取其 `header.daaScore`）
- **fresh tip (virtualDaaScore)**: `63114956`
- **探针脚本**: `kasia-console/scratch/j34vb_pruning_check.mjs`（已有脚本，本次复用，非新写）
- **DAA/sec 速率**（用于时间戳↔DAA 换算，非本报告分类主依据）: `7.811`（本session早前从 `spc_daa_index` 独立测算，多方交叉验证收敛）
- **原始查询范围**: `pool_markets WHERE protocol_version='v0.7' AND protocol_status IN ('verifying','collecting_sigs') AND id NOT LIKE '%-s%'` → 25 盘（parent行，去重 shard 行）
- **原始快照**: 25盘 / 2765笔 / 69725.99KAS（J2+NWT 双独立查询对上）
- **原始结果集哈希**（25盘 id+status+deadline_daa+indexed_hash+bets+kas+nulls 的 canonical JSON sha256）: `99d9f10635a2823479ff4029c5c6d1d77d7ca8da83a136083739d2793c6748d9`
- **原始数据文件**: `scratch/_j2_gate0_all_25.json`（本次生成，含全部25盘明细，供复核）

### 排除清单（test/demo/rehearsal，9盘，2530.47KAS，独立核对收敛）

| id | 判据 | KAS |
|---|---|---|
| fy1yk | 6/21 "bshard auto-roll test market"，resolution_rule_spec title/data_source 明确标注test | 2153.72 |
| 7jy3s | dust E2E block-hash-parity test | 1.50 |
| ldtyn | CloseZkV2 market5R rehearsal | 127.78 |
| 8xykm | CloseZkV2 market5R rehearsal | 120.42 |
| cswib | CloseZkV2 market5R rehearsal | 102.55 |
| yxllc | CloseZkV2 market5R rehearsal | 0.00 |
| tha3l | B-line zk_native-default verify | 2.50 |
| 8pson | settle-daemon recapture-fix demo (DISC-002已停) | 10.00 |
| 53hr8 | J2本人WC stress-test round-1 | 12.00 |
| **合计** | | **2530.47** |

### 真实用户盘终态分类（16盘，67195.52KAS）

方法论：deadline_daa 与静态 pruning-wall 估算值比较 是 **代理信号会误判**（9jaty/j34vb 实测证伪）。终态判定改为逐盘 **live `rpc.getBlock()` 直接可达性实测**；无索引缓存hash的盘用**边界单调性证明**（剪枝从老到新单调剪除，比已实测unreachable的锚点更老 → 数学上必unreachable，非猜测）。

| id | 终态分类 | deadline_daa | endBlock hash | endBlock live状态 | side_lock_daa NULL | margin(deadline_daa − 61653930) | 笔数 | KAS |
|---|---|---|---|---|---|---|---|---|
| ojizv | stranded | 57210654 | a8e8f0932412...962 | **UNREACHABLE**(直接实测) | 16/16 (100%) | -4443276 | 16 | 378.02 |
| aukqt | stranded | 58695372 | ad6771c715d4...272 | **UNREACHABLE**(直接实测) | 822/822 (100%) | -2958558 | 822 | 28805.00 |
| 9ez2u | stranded | 60665153 | ea82ec9997ff...47f | **UNREACHABLE**(直接实测) | 1/1 (100%) | -988777 | 1 | 500.00 |
| kr5l4 | stranded | 60722281 | dc8248e58a12...d40 | **UNREACHABLE**(直接实测) | 694/694 (~85%, 部分早前已recapture) | -931649 | 694 | 25075.00 |
| jepu1 | stranded | 48964266 | (无索引缓存) | UNREACHABLE(边界单调性,vs aukqt锚点) | 4/4 (100%) | -12689664 | 4 | 188.81 |
| vzhep | stranded | 52711521 | (无索引缓存) | UNREACHABLE(边界单调性) | 43/43 (100%) | -8942409 | 43 | 962.35 |
| gzx6w | stranded | 52712288 | (无索引缓存) | UNREACHABLE(边界单调性) | 39/39 (100%) | -8941642 | 39 | 1036.93 |
| gic37 | stranded | 52713214 | (无索引缓存) | UNREACHABLE(边界单调性) | 41/41 (100%) | -8940716 | 41 | 1199.54 |
| iftk7 | stranded | 55488200 | (无索引缓存) | UNREACHABLE(边界单调性) | 1/1 (100%) | -6165730 | 1 | 20.00 |
| dhxcp | stranded | 55521825 | (无索引缓存) | UNREACHABLE(边界单调性) | 2/2 (100%) | -6132105 | 2 | 65.68 |
| kngkl | stranded | 55825418 | (无索引缓存) | UNREACHABLE(边界单调性) | 1/1 (100%) | -5828512 | 1 | 26.58 |
| dwk36 | stranded | 55832569 | (无索引缓存) | UNREACHABLE(边界单调性) | 1/1 (100%) | -5821361 | 1 | 39.61 |
| 5ybz4 | stranded | 56863154 | (无索引缓存) | UNREACHABLE(边界单调性) | 0/0 (n/a, 0笔) | -4790776 | 0 | 0.00 |
| j34vb | stranded* | 61421827 | 95fa36702e80...d41 | **REACHABLE**(直接实测, isChainBlock=true) | 8/10 (80%) | -232103 | 10 | 395.00 |
| 9jaty | stranded* | 61452455 | 7774dbd1a86d...e27 | **REACHABLE**(直接实测, isChainBlock=true) | 4/4 (100%) | -201475 | 4 | 8500.00 |
| 3mzoh | **not-yet-due(正常在途)** | 63404896 | (尚未到deadline, tip=63114956<deadline) | n/a — 未到期 | 0/3 (0%) | +1750966 | 3 | 3.00 |

*j34vb/9jaty: endBlock 本身可达（committee seed 用的锚点），但逐笔 recapture 实测显示 bettor 自己下注时的落链块（58.7M-60.6M 区间，早于 deadline）已被剪，`side_lock_daa` 物理不可补（recapture脚本: `scratch/_j2_recapture_9jaty_j34vb.mjs`，12笔全UNREACHABLE）。`pool-market-settler-v06.mjs:356-360`（#27a v2，Owner 6/14 hardening sprint + NWT r1175 canonical-daa 设计）对 NULL side_lock_daa fail-loud throw，防止跨节点committee非byte-equal分叉——committee sampling 走不通，事实上归入 stranded/refund。此路径已由 Bettor 评估并撤回"抢救"建议，无广播发生。

---

## Artifact 2 — Restore-Drill

**状态**: 已执行（Bettor 标注"不赶，可决赛后"，仍在窗口内顺手完成）

- **Disposable copy 方法**: 纯文件系统 `cp`（**非** `sqlite .backup()` / `VACUUM INTO`，避免对 live 进程强制 WAL checkpoint 造成 contention）
- **拷贝内容**: `console.db` + `console.db-wal` + `console.db-shm` 三件套
- **拷贝目标**: `D:/kanet-tn12/scratch/gate0-restore-drill/`（隔离路径，非 live `data/` 目录）
- **拷贝耗时**: 16.4秒（7.3GB）
- **源文件 sha256**（拷贝后副本上算，代表拷贝时刻的快照）: `8037aaa812a8289e37d08a6f329df8168ffe10226b03c7932de7049b81c94640`
- **live 影响验证**: 拷贝前后各一次 `curl -m 5 http://127.0.0.1:3200/api/pool/markets/available` → 拷贝后 HTTP 200 / 93ms（无明显退化，console 全程未受影响）
- **副本 schema 版本**: 与 live 一致（同一份 migrate.js 历史，拷贝时刻快照，未做 schema 变更）
- **隔离 restore/校验命令**: `node scratch/_j2_gate0_restore_validate.mjs`（独立进程，`readonly:false` 打开副本路径，不接触 live 路径）
- **完整性检查**: `PRAGMA integrity_check` → `ok`（耗时 82962ms，在副本上执行，不影响 live）
- **代表性市场 replay（spot-check）**: 副本内 `pool_markets` 4048行 / `pool_bettor_sides` 35966行；抽样 9jaty parent 行字段（id/status/deadline_daa）与 live 完全一致
- **观察到的失败**: 无（integrity_check clean，抽样数据一致，未发现副本损坏或数据丢失）
- **零 live 影响证明**: 全程未调用任何 write 路径 / daemon 重启 / broadcast；副本操作与 live 进程完全隔离（不同文件路径、不同 db 句柄、不同进程）；health curl 前后对照证明无可观测影响

---

## Artifact 3 — Blast-Radius（4类切分）

**Inclusion query**: `SELECT id, protocol_status, deadline_daa, created_at FROM pool_markets WHERE protocol_version='v0.7' AND protocol_status IN ('verifying','collecting_sigs') AND id NOT LIKE '%-s%'`
**Exclusion/dedup 规则**: `id NOT LIKE '%-s%'` 排除 shard 子行（每个市场的 bettor 数据在 `-s0` 等 shard 行下，market 元数据在 parent 行，避免同一市场被判断层重复计入）；`pool_bettor_sides` 按 `market_id LIKE '<parent_id>%'` 聚合覆盖 parent+所有 shard
**Raw 结果集哈希**: `99d9f10635a2823479ff4029c5c6d1d77d7ca8da83a136083739d2793c6748d9`（25盘原始快照，见 Artifact 1）

| 类别 | 定义 | 盘数 | KAS | 说明 |
|---|---|---|---|---|
| **stranded** | endBlock/bet-block 实测或单调性证明 unreachable，无法通过现有链上锚定路径正常结算 | 15 | 67192.52 | 4 direct-unreachable + 9 boundary-monotonic + j34vb/9jaty（endBlock可达但bet块已剪，fail-loud闸挡住） |
| **refund-routed** | 已有具体退款设计文档点名覆盖的盘（`docs/2026-07-18-v2-cancel-refund-orchestration-design.md` + 本session `deriveRefundCommitteeSeed` 修复直接针对） | 2 | 53880.00 | kr5l4(25075)+aukqt(28805)。其余13盘（含j34vb/9jaty）确认stranded但退款执行流程尚未落码/routed，不计入此类，仍是design-pending。 |
| **merely-exposed** | 曾被列入 scope 排查、但确认非真实用户资金风险（test/demo/rehearsal） | 9 | 2530.47 | 见 Artifact 1 排除清单表 |
| **already-terminal** | 不在本次 Gate0 查询范围内（`protocol_status` 不在 verifying/collecting_sigs），本报告未覆盖，仅作范围边界说明 | n/a | n/a | 例：本session已验证完整结算的 ajnid（v0.7，protocol_status 已终态）不在25盘快照内，属查询范围外，非本报告统计对象 |

**订正记录**: 首版草稿在"refund-routed"行误写"3盘/54258KAS"（算术不自洽，且把`deriveRefundCommitteeSeed`——一个通用函数、非仅3盘专属——错误地当作routing判据）。发布前自查发现并直接改正为当前值（kr5l4+aukqt=53880KAS，仅计已有具体设计文档点名的2盘），照实记录此更正过程，不留自相矛盾的数字。

---

## 未覆盖 / 后续

- (b')9盘的"边界单调性证明"未逐个取得直接block hash实测（因spc_daa_index无缓存），是基于剪枝单调性的数学证明而非逐个直连实测——如需100%逐盘直测，需要另外的block-hash来源（如从更早的链上归档/独立indexer），未在本次范围内。
- "估算 side_lock_daa 例外路径"（放宽 #27a v2 fail-loud）Bettor 已标注为独立 design+红队 议题，明确"绝不今晚赶"，未在本报告中评估其可行性，留待后续。
- 本报告完成 **不 authorize** 对上述任何盘执行 refund broadcast / settle broadcast / 任何动钱操作 —— 需要单独的 design → 红队 → Owner 批 流程（照铁律0）。
