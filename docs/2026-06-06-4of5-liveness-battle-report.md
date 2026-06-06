# 4-of-5 活性路单验 — 战报 + 收口存档

> **状态**: 机制证到签名层 ✅ / settle TX 卡 SS 4-of-5 验证 🔧（转专项 #25）
> **日期**: 2026-06-06
> **范围**: 证"1 委员真离线/审查，其余 4 共识仍能裁决出账" = 去中心化预言机抗单点核心卖点
> **结论**: 不算 PASS。首闭环 #10（5/5 跨节点）是已封档主里程碑，不受影响。

---

## 一、为什么做这条

[[2026-06-06-cross-node-committee-oracle-settle-CLOSURE]] 证了 5/5 全签 settle。但委员会的**容错/抗审查**卖点 = "仅 4 签、1 委员静默仍能 settle"（4-of-5 活性路）从没链上跑过。这是范式的硬证。

---

## 二、证到的（全链路除最后一步）

测试市场 #13 `ext-pool-v07-1780707314157-zc9jw`，committee `c4341b36`（实为多轮，最终 zc9jw）：

| 阶段 | 结果 |
|------|------|
| 委员抽样 1:4 | c0 qpep9m(:3200) / c1 Carol / c2 Bob / c3 Alice / **c4 Dave(:3300)** |
| 静默布置 | Dave(c4) relay 预先 kill（race-free），真离线 |
| 投票 4-of-5 | qpep9m + Carol + Bob + Alice = **4 票 YES**，Dave 静默 ✓ |
| 共识 | `silentOracleIndex=4`（r383 _findSilentForWinner 正确锁定 Dave）✓ |
| 签名 | **4 fresh 签**（c0-c3，全 > dispatch 后，无 stale）✓ |
| payout | Σin=7 KAS, Σout=6.97 KAS ✓ 平衡（r385，无 overspend）|
| merkle | 全 5 委员（含 silent Dave）proof 都烤了 ✓ |

→ **机制证到签名层全通**。

## 三、卡死点

settle TX（10ab30ce 等）提交链上 → `script ran, but verification failed` = **SS 验证失败**。

- **不是 stale 签**（fresh）、**不是 overspend**（r385 平衡）、**不是 clog**（清了）
- **不是 dummy 编码**：c4 silent 槽试了 3 种 dummy（all-zero / OP_0 空 / G.x 可lift），**全被拒** → 失败对 dummy 不变 → dummy 无关
- `checkSig` 是 push-bool（`if(checkSig)v++` 能编译，J1 r120 probe 223 字节）→ dummy 返 false 该被干净跳过 → 真因**不是它**
- **真因 = 某未知 require 挂**（merkle 验 / 输出结构 / sighash / global commit 之一，4-of-5 特有，5/5 unanimous 从没暴露）

**这条 SS 4-of-5 路历史上从没端到端链上验证过**（只 5/5 落过链）。

## 四、为什么转专项（不当场修）

1. **无 simulator 工具**：`D:/silverscript/target/release/` 只有 silverc.exe（编译），无 cli-debugger.exe → 隔离失败 require 只能手动 source dry-run（慢）
2. **#13 spine SS 链上烤死**：即使找到 bug，若在 SS 侧，#13 改不了 → 需 SS 重设计 + 新 P2SH + 新市场
3. 已投 ~2 小时，到自然停点

→ 转专项 task **#25**（待 simulator 工具 / 专项 SS session）。#13 资金：settle 不了会 silent_timeout 自然退款，钱回押注方。

## 五、这一程啃出的 7 个真 bug（全是 4-of-5/跨节点从没跑过的雷）

| # | bug | 修复 | 性质 |
|---|-----|------|------|
| 1 | decideConsensusV06 4-of-5 不 set silentOracleIndex | r383 (_findSilentForWinner) | 已修 ✓ |
| 2 | committeeMode 静默员 bond 双花 overspend 0.72 KAS | r385 (forfeit redistribution skip committeeMode) | 已修 ✓ |
| 3 | re-dispatch 后旧签被 per-tick re-scan 重捞污染 | recovery 特有，记录 | 待修（低优先）|
| 4 | handlePoolOracleTxSignReq idempotent 见旧签 skip 重签 | recovery 特有，应 key on phase2_tx_obj_hash | 待修（低优先）|
| 5 | settler 被 stale 死单 clog 饿死新市场 | 临时 skip，根治见 #24 | 系统级，#24 |
| 6 | SS 4-of-5 settle verify 失败（未知 require）| 转专项 #25 | **核心阻塞** |
| 7 | (方法论) 我误锁 dummy 为根因，让 J2 白测 3 编码 | 认错记录 | 教训 |

## 六、教训（存底）

- **误判 dummy 根因**：3 种 dummy 全失败时就该立刻意识到"失败对变量不变 = 该变量无关"，而非继续试编码。浪费了 J2 三轮。下次：失败不变量 → 立即换嫌疑维度。
- **5/5 PASS ≠ 4-of-5 PASS**：unanimous 路和 threshold 路是**不同 SS 分支**，前者过不代表后者过。任何"threshold/容错"声明必须独立链上证。
- **配 [[cross-node-testing-critical-j1-separate-node]] + [[project-cross-node-settle-pipeline-debug]]**：跨节点 + 非主路（4-of-5）= 半迁移雷的重灾区。
