# TN12 全网停链根因诊断 — GHOSTDAG mergeset 溢出死锁(Bettor, 2026-08-08 ~16:1xZ)

> **Status**: CURRENT · 紧急 · 节点域(J1)接手
> **触发**: Owner 报电报机器人/dev-coord 转发失败 `RPC node is not synced`;全队频道广播中断(relay fail-closed on isSynced=false, 正确不改)。
> **性质**: 这是【机制层】诊断(为什么冻),补在 cross-host 证据(三台同 DAA=网络级)之上。**修法不在我域, 交 J1 节点域 / Owner 数据损失知情决策。**

## 一、硬事实(全部地面实测, 直连节点 + 节点自身日志)

| 观测 | 值 | 来源 |
|---|---|---|
| isSynced | **false** | `getServerInfo` 直连 ws:17210 |
| virtualDaaScore | **冻结 ~76181041**(三台主机同值) | `getBlockDagInfo` ×多次 6-8s 无进 + Codex 三台确认 |
| tipHashes | **15596→17891 持续增长** | 多次 getBlockDagInfo |
| UTXO-validated blocks | **每 10s 窗口恒 = 0** | kaspad stdout `Processed N blocks... 0 UTXO-validated blocks` |
| mergeset | **钉在 ~248**(246-248 不变) | 同上;疑似 = mergeset_size_limit |
| 出块率 | ~0.5 BPS(5 blocks/10s, 本机内部 CPU 矿机在产、块被 accept) | 同上 + bridge log `BLOCK ACCEPTED` |
| 直接父数 | ~13-16 parents/block | 同上 |
| kaspad 本实例启动 | **今天 14:39:07**(日志横幅) | stdout banner |
| datadir 备份 | **无**(11GB live 库, 零 .bak/快照) | ls |
| peers | 2 连接(152.53.236.224 / 86.48.24.208, P2P 16311)——**同病, 同冻结 DAA** | getConnectedPeerInfo + Codex cross-host |

## 二、机制:mergeset 溢出死锁

块被接受进 DAG(tips 长), 但**虚拟/蓝链一个块都没推进**(0 UTXO-validated)。GHOSTDAG 下虚拟块的 mergeset 受 `mergeset_size_limit`(~248) 约束; 超限的块无效。**17891 个 loose tip ≫ 248 ⇒ 任何试图推进蓝链的虚拟块 mergeset 超限 ⇒ 无效 ⇒ 蓝链永冻 ⇒ tips 只增不减。自增强死锁。**

## 三、常规手段为何全部无效(逐条实证, 非推测)

- **等**: 会一直累积(tips 15596→17891 已证增长), 不自愈。
- **重启节点**: 🔴 **14:39 已经重启过一次**(日志横幅), 重载持久化的同一个超载 DAG, 起来立刻又 0 UTXO-validated。重启【已证无效】, 别再试。
- **从 peer 重同步 / 删库 re-IBD**: 三台 peer 同病(同冻结 DAA), 给的是同一个死锁状态。**无健康源。**
- **恢复备份**: 无备份。

## 四、候选修法(全部超出 Bettor 域, 需 J1 节点专业 或 Owner 知情决策)

1. **Kaspa 内核恢复程序**(若存在): reindex / checkpoint 回退 / 强制虚拟链重解析 —— **J1 节点域, 我不知有无非破坏路径。**
2. **改矿机父块选择**: 让每块引用更多 tip(趋近 mergeset 上限)加速排空积压 —— 挖矿/bridge 代码层, J1/ops。若可行且非破坏, 这是最不伤链上状态的方向。
3. **调 mergeset_size_limit**: 共识层改动, 会跟全网分叉, 不可单机改。
4. 🔴 **删库重挖 / 全网重置**: **抹掉所有链上状态**(含 171,227 KAS 非终态市场 + 全部 covenant 盘)。**不可逆数据损失, 必须 Owner 在完全知情下决定, 绝不单方执行。**

## 五、边界声明(Bettor)

我把根挖到机制层、数据备齐、能安全只读做的做尽。**最后一步要么是 J1 的 Kaspa 内核专业, 要么是 Owner 对"数据损失换恢复"的知情决策——两者都不是协调者能替代或在压力下单独按下的。** relay 的 `isSynced=false ⇒ 拒广播` 是正确的 fail-closed 闸(Codex 确认), 不弱化。
