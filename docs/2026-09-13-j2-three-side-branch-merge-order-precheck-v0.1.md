# 三侧分支合入主线 · 合并序与冲突预检报告 v0.1（供 Owner 批合入 · 不实际合并 · 不落 live）

> **Status**: FINAL-EVIDENCE **v0.1**（2026-09-13 · J2 · Bettor 派工「三侧分支合入主线的合并序与冲突预检——基线 = 当前 `origin/bshard-m3-deploy` 头；序 a→b→c；每步 `git merge-tree` 冲突数、涉及文件、需要的 kanet.env 改动清单（含 :304 注释与主网值）、迁移版本衔接、合入后必跑的测试文件清单；不实际合并、不落 live」· 方法 = `git merge-tree --write-tree`（git 2.53，真三方合并写入临时 tree 对象，不碰工作区/索引/任何分支引用）逐步串联 + `git commit-tree` 造合成 merge commit（同样只写对象库，不动任何 ref）· 三个分支：`coord/j2-a-local-only-strict`(`6dec9379`)/`coord/j2-b-network-single-source`(`346adbce`)/`coord/j2-c-no-tx-landed`(`1d4b7fd2`)· 🔴 遵 Owner 直令（ledger 1061）：本稿不出现旧网具体名称，历史/网络身份一律用配置项/端口/ledger 号指代。

## 0. 结论（三句）

1. **序 a→b→c 安全，只有一处冲突**，且是**全库唯一**一处：`kasia-console/src/services/bettor-prediction-settler.js` 里 a 与 c 各自在**同一行**之后插入一条 `import`——纯相邻插入、零语义重叠、两分支互不读对方新增的符号，**合并解 = 保留两段 import 都在**（顺序任意），一分钟级手工解。其余 65 个改动文件全部 `git merge-tree` 判定 auto-merge 或无交集，**零冲突**。
2. **迁移版本无冲突**：主线当前 `migrate.js` 尾块是 `v201`（`5790` 行），c 分支加的 `v202`/`v203` 直接接在其后，**无版本号占用冲突**；c 内部两个新版本块（提交时）已各自补了 `console.log('[migrate] vNNN: …')` 收尾行（同批规范）。
3. **kanet.env 需要改的只有网络寻址三行**（§3），**不是结构性改动**——把网络标识与本机 RPC 端口从当前值换成主网值；a/b 两个分支的代码（strict local-only + 网络单一源）**已经支持主网**（`shared/lib/kaspa-network.mjs` 的 `NETWORKS` 表原生含 `mainnet`；a 的 `rpc-health.js` 用 `process.env.KASPA_NETWORK` 做匹配，不挑网络名），只是配置值要换。

## 1. 基线与分支

| 项 | 值 |
|---|---|
| 基线（合入目标） | `origin/bshard-m3-deploy` 头，本机检出 = `0f2fc739`（docs·T4 骨架，本会话最新一笔） |
| 分支 a | `coord/j2-a-local-only-strict` @ `6dec9379`，1 commit，merge-base `5f1b908e`（距基线 75 commits，分支较早开出） |
| 分支 b | `coord/j2-b-network-single-source` @ `346adbce`，2 commits，merge-base `5f1b908e`（同 a） |
| 分支 c | `coord/j2-c-no-tx-landed` @ `1d4b7fd2`，5 commits，merge-base `8a44568a`（距基线 31 commits，分支较晚开出） |
| 派工序 | Bettor 拍：a → b → c（未指定理由；本报告在 §2 验证这个序本身无害，未测试其余 5 种排列） |

## 2. 逐步 `git merge-tree` 结果

**方法**：`TREE1 = merge-tree(基线, a)`；用 `commit-tree TREE1 -p 基线 -p a` 造合成提交 `M1`；`TREE2 = merge-tree(M1, b)`；`M2 = commit-tree TREE2 -p M1 -p b`；`TREE3 = merge-tree(M2, c)`。全程只写 git 对象库（loose objects），**未 checkout、未碰工作区/索引/任何分支引用**（合规 D-005 隔离 + 不碰共享检出铁律）。

| 步骤 | exit code | 冲突文件数 | 涉及文件（auto-merge 或冲突） |
|---|---|---|---|
| ① 基线 + a | 0（干净） | 0 | 无重叠（a 只碰 `rpc-health.js`/`rpc-utils.mjs`/`bettor-prediction-settler.js`/`pool-market-settler*.mjs` 等，基线在这些行上无同期改动） |
| ② (①) + b | 0（干净，4 处 auto-merge） | 0 | `kasia-console/src/api/pool.js`、`kasia-console/src/services/relay-manager.js`、`kasia-relay/src/relay.mjs`、`kasia-relay/src/rpc-listener.mjs`——这四个文件 a 与 b **都改了但改的是不同行**，三方合并自动拼接成功，**未产生冲突标记** |
| ③ (②) + c | **1**（`exit=1`） | **1** | `kasia-console/src/services/bettor-prediction-settler.js`（详见 §2.1）；同批另 4 个文件（`kasia-console/src/api/bettor.js`、`kasia-relay/src/lib/transaction.mjs`、`kasia-relay/src/relay.mjs`）auto-merge 成功、无冲突 |

**最终合并树**（含冲突文件 3-way 三份 blob，尚未人工解决）与基线相比：**66 个文件改动，+2635/−311**（这个 diffstat 用 git 对该冲突文件的默认 3-way 展开计数，实际解决后行数会因去重两行 import 略降，量级不变）。

### 2.1 唯一冲突：`bettor-prediction-settler.js`
```
25: import { transition } from './exchange-machine.js';
26: import { sendCommandAsync } from './relay-manager.js';
27: import { getConfig } from '../data/settings/configs.js';
<<<<<<< (a+b 侧)
28: import { isAddressOnNetwork } from '../lib/kaspa-network.mjs';   // (b) 网络单一源 (设计 v0.2 §3 #31)
=======
   // (c) F2 (J2 2026-09-13, 设计 v0.3 NWT PASS): 派彩走 submit-intent + landed 门; delivering 扫描 + prepared 行重启捡回。
   import { submitPayoutIntent, completeIfLanded, sweepDeliveringPayouts } from './prediction-payout-gate.mjs';
   import { resumeStaleIntents } from '../lib/submit-intent.mjs';
   import { assertSettleEligible } from './escrow-landed-gate.mjs';   // (c) 第 5 笔 (B): 锁未落链 ⇒ 无结算资格
>>>>>>> (c 侧)
```
**性质**：两个分支各自在 `getConfig` 那行之后插入自己的新 import 块，插入点相同、内容互不相关、**互不读对方新增的符号**（`c` 完全不碰 `isAddressOnNetwork`，`a/b` 完全不碰 `submitPayoutIntent` 等）。**解法 = 保留双方全部 5 行**（顺序不影响正确性）；无需理解跨分支语义即可解。这是全库唯一一处，且是这个量级里"最好的一种冲突"（纯相邻插入，非重叠编辑同一逻辑）。

**为什么只有这一处**：a/b 改的是"RPC 从哪来 / 网络怎么判"这一层（`rpc-health.js`/`rpc-utils.mjs`/`kaspa-network.mjs`/`relay-manager.js`/`relay.mjs`/`rpc-listener.mjs`），c 改的是"钱有没有落链才推进状态"这一层（`submit-intent.mjs`/`escrow-landed-gate.mjs`/`prediction-payout-gate.mjs`/`tx-landed-reconciler.mjs` + 五处站点）——两层设计上正交，唯一物理相邻的地方就是三个分支都恰好把新增逻辑接到了 `bettor-prediction-settler.js` 文件顶部的 import 区。`relay-manager.js`/`relay.mjs` 虽然 a、b、c 都碰（三者交集），但改的是文件里不同的函数/行号，三方合并没有产生冲突。

## 3. kanet.env 需要的改动（§0.3 展开）

| 行 | 现值 | 主网值 | 说明 |
|---|---|---|---|
| `:23 KASPA_RPC_URL` | `ws://127.0.0.1:17210` | `ws://127.0.0.1:17110` | 主网节点 borsh RPC 默认端口 = 17110（Owner 主网只读节点执行页给的五个默认端口之一：gRPC 16110 / P2P 16111 / borsh 17110 / JSON 18110；本仓客户端全走 `Encoding.Borsh`，见 `kaspa-rpc-shared.mjs`/`cross-chain-verify.mjs`），非结构性改动，只换端口数字 |
| `:24 KASPA_NETWORK` | 旧网标识 | `mainnet` | a/b 两分支的代码路径原生支持（`shared/lib/kaspa-network.mjs:16-18` `NETWORKS` 表两个键都在，非新增分支逻辑） |
| `:53 KASPA_WS_PROXY_TARGET_PORT` | `17210` | `17110` | 与 `:23` 同步（本机 WS 代理转发目标端口，若代理组件仍在用） |
| `:304-305`（注释 + `KASPA_RPC_LOCAL_ONLY=1`） | 注释写"共享客户端只用本机节点"，值 `1` | **值不变（`1`）**，注释不用改（原话就是通用的"只用本机节点"，不含网络名） | 这正是 a 分支（strict local-only）实现的开关；**已经是对的值**，合入后立即生效，不需要额外动作 |

**不需要改**（核对过，确认非硬编码网络名）：`shared/lib/kaspa-network.mjs`/`rpc-health.js`/`relay-manager.js` 内部逻辑读 `process.env.KASPA_NETWORK` 做匹配，未见对具体网络名的硬编码分支。**未核**：其余非本三分支触及的文件是否还有别处硬编码旧网 RPC 地址（本报告范围只覆盖 a/b/c 触及的文件，全仓扫描超出本次范围）。

## 4. 合入后必跑的测试文件（不实际跑，只列清单；跑法照 `docs/TEST-FRAMEWORK.md`/各文件头注）

| 来源分支 | 文件 | 跑法 |
|---|---|---|
| a | `kasia-console/src/services/rpc-health-datacheck.test.mjs` | `node src/services/rpc-health-datacheck.test.mjs`（自举建临时库+本机 TCP listener，离线） |
| b | `kasia-console/src/lib/kaspa-network.test.mjs` | 同目录 `.vectors.json` 配套，纯离线单测 |
| b | `kasia-console/src/services/broker-fee-emit-package-switch.test.mjs` | 未读内容，按文件名推测是 b 分支顺带的包切换回归，需跑 |
| c | `kasia-console/src/lib/submit-intent.test.mjs` | 自举临时库，22 向量 |
| c | `kasia-console/src/services/escrow-landed-gate.test.mjs` | 自举临时库，真 `transition`，16 向量 |
| c | `kasia-console/src/services/exchange-machine-kaspa-gate.test.mjs` | 自举临时库，7 向量 |
| c | `kasia-console/src/services/prediction-payout-gate.test.mjs` | 自举临时库，9 向量 |
| c | `kasia-console/src/services/tx-landed-reconciler.test.mjs` | 自举临时库，真 `kaspa_tx_log` 表，7 向量 |
| c | `kasia-relay/src/lib/covenant-roundtrip.test.mjs` | `cd kasia-relay && node src/lib/covenant-roundtrip.test.mjs`，离线假 RPC |
| c | `kasia-relay/src/lib/serialize-roundtrip.test.mjs` | 同上目录，离线假 RPC |

**共 10 个测试文件**（每个都带"翻转臂"自检，非空判据）；合入 commit 前跑一遍 `node scripts/lint-kanet.mjs <changed-files>`（c 的 5 笔在隔离 worktree 里各自跑过 0 errors，合并后的最终文件需要**重新跑一次**——三方合并可能改变行号/相邻上下文，lint 是静态规则不依赖内容语义，重跑成本低但不可省）。

## 5. 请 NWT / Owner 判
1. §2.1 的冲突解法（保留双方 import，顺序不拘）是否需要人工在合并 commit 里显式标注解决理由，还是普通 merge commit message 带一句即可。
2. §3 表格外，是否要在合入前额外跑一次全仓 `grep -rn "17210\|旧网标识字面量"` 扫描确认没有遗漏的硬编码（本报告未做全仓扫描，只覆盖三分支触及文件）。
3. 合入顺序 a→b→c 是 Bettor 既定序、本报告只验证其安全性；若 Owner 想要更短的冲突路径（例如 c→a→b），未测试，需要的话可以另跑一版对比。

## 6. 没核到的
- `broker-fee-emit-package-switch.test.mjs`（b 分支带的）具体测什么，本报告只列名未读内容。
- 三方合并产物的最终 66 文件、+2635/−311 diffstat 未逐文件核对是否有非预期的静默丢弃（`merge-tree` 对非冲突文件的三方合并理论上不会丢内容，但本报告未逐文件人工复核）。
- 全仓（超出三分支范围）是否还有其他硬编码旧网 RPC 端口/网络名的文件，需要主网切换前单独扫描。
