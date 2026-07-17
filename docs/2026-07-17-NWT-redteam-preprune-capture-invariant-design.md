# NWT 设计审 — 剪裁前捕获 Invariant + K-16 纳入 + 机器门禁 v0.1(2026-07-17)

> **Status**: CURRENT
> **对象**: `docs/2026-07-17-preprune-capture-invariant-k16-gate-design.md`(5e1ecddd, Bettor 架构师帽)
> **verdict**: **🟠 GREEN-with-MUST-FIX(3 项), §8 四点逐条回应+2 项自主新发现**

## 真对抗结论

### Bettor §8 四点逐条回应

**点①(K-17 独立 vs 并入 K-16)——不直接判定, 要求先查资产**: §3 自己写"K-16 故障注入矩阵新增一行", §18 又单列"K-17"独立编号——**这是同一件事在两套治理机制里各登记一次**, 本项目自己的反增殖纪律(D-002"永不新建管规则, 能并进旧条不开新号")对其它层(memory/KB/ANTI-PATTERNS)反复强调过, 这里不该是例外。但 Bettor "倾向独立"的理由(K-16=containment 型"谁的故障感染谁", K-17=precondition 型"必须在X之前做Y", 两者*种类*不同)成立与否, 取决于**现有 K-1~K-16 目录里是不是已经有 precondition 型的行**——如果有先例, K-17 该并入(矩阵本来就能装两种类型); 如果 K-16 现有全是 containment 型, 独立成 K-17 才站得住(否则会把 K-16 的"读者预期"搅浑, 有人翻 K-16 矩阵默认每行都是"失败时如何隔离", 混进"必须提前做某事"型会增加读者认知负担)。**这是查资产铁律的具体应用场景**(CLAUDE.md 接位 SOP 第5条), 不该凭"我倾向"定, 请 Bettor 实际翻一遍 K-1~K-16 现有目录的规则类型分布再回来。折中方案供参考: 若两种类型混着不合适, 可以做成"K-16 附一条具名子款"(既挂在 K-16 底下不单开顶层编号, 又保留独立可引用的名字), 而不是二选一。

**点②(safety_margin 方法论)——方向对, 但漏了积压场景**: `tip_daa - pruning_depth + safety_margin` 这个阈值公式**方向正确**(margin 越大触发越早, 代数验证过: 提高阈值=更早判定"该补了", 算术没错)。但当前描述的 margin 组成"worker tick 间隔+walk 耗时"只覆盖**稳态单行延迟**, 没覆盖**积压/突发场景**——如果 worker 自己停摆一段时间(今天 console-supervisor 就真死了近 25h, 不是假设), 复活后可能同时面对几十条都逼近剪裁边界的 NULL 行, 而 worker 的吞吐(每 tick 能真正 walk 几条, RPC 成本/rate limit)是有限的; 只按"单行需要多久"设 margin, 遇到批量积压仍可能来不及在剪裁点前处理完队列尾部的行。**建议 safety_margin 的方法论显式加一项"worker 自身可能宕机 N 小时后复活的最坏情况下, 积压队列能否在恢复运行后的剩余窗口内清完", 而不是只按单行时延估。**

**点③(门禁误伤既有合法 lazy 路径)——发现 schema 本身有缺口, 会直接导致误伤**: §4 manifest 字段 `prune_survival` 目前只有两态(`guaranteed_before_prune` | `none`), 而 §5 自己承认 `spc_daa_index`(今天刚落码, 51a6494d)是**不受剪裁影响的持久化索引基础设施**——一个 lazy-recapture 路径如果读的是 `spc_daa_index` 这类**已经不依赖剪裁窗口内链上原始数据**的持久索引(而不是现场 backward-walk 剪裁敏感的链状态), 它其实**已经安全**, 不需要"剪裁前主动补齐 worker"这个额外机制, 但当前二态 schema 会把它错误分类成 `prune_survival=none` 从而被 lint 拦下, 逼着每一条这样的合法路径也要装一个专属 worker。**建议 `prune_survival` 改三态**: `guaranteed_before_prune`(有主动 worker 保证) | `durable_index_backed`(恢复源本身不受剪裁, 如 spc_daa_index) | `none`(真正裸露, 该拦)。否则这条门禁一上线就会先拦一批本来没问题的东西, 逼团队要么大量补 worker 要么绕过门禁, 两个结果都不是这份设计想要的。

**点④(worker 自身故障递归)——不是"待考虑", 是必须现在就答, 今天有实证**: 这不是理论担忧——**今天这个 session 里 console-supervisor 真的静默死了将近 25 小时没人发现**(见 `docs/2026-07-17-NWT-redteam-boot-sequence-startup-verification-gap.md`), 原始 side_lock_daa 问题本身也是"lazy recapture 这层保护措施悄悄没生效、没人知道"这个模式的产物。**如果新的"剪裁前补齐 worker"也只是又一个"正常时管用、死了没人知道"的进程, 这份设计解决的是同一个病的复发, 不是根治**。§5"fail-loud"目前只覆盖"worker 发现某行已经补不回了"这一种告警, **完全没覆盖"worker 自己停止运行"这种情况**。**MUST-FIX**: worker 存活本身必须有独立监控(不能靠 worker 自己报活, 那是同一个单点), 建议直接复用今天刚验证过的模式(`spc_tip_heartbeat`, v187/51a6494d, J1 落码, 已有 60s 心跳+巡检设计)——不是另起一套心跳机制, 是同一个刚被验证过的模式在新 worker 上复用一次, 省得再造轮子也省得再踩一次同样的坑。

### 自主新发现(Bettor §8 没列到的)

**发现A(MUST-FIX, 严重——跟今天刚做的 spc_daa_index 写入器犯同一个错)**: §5 的"剪裁前补齐 worker"要主动捕获 `side_lock_daa`, 但整份设计**只提剪裁风险, 完全没提 reorg/finality 风险**——如果 worker 在 accepting-block 还没达到 finality depth(本项目标准 `DEFAULT_FINALITY_DEPTH=50`)时就把当时看到的 daa 值当"已捕获"写死, 而这个区块后来被 reorg 掉, 捕获的值就是**错的**(比继续留 NULL 更危险——NULL 至少诚实说"不知道", 错误值是带着假自信进 money-path 判定)。这正是**今天**(51a6494d)J1 给 `spc_daa_index` 写入器补上的同一个洞("finality-depth 门, 复用 `DEFAULT_FINALITY_DEPTH=50` 防 reorg 陈旧值"), 也是既有 memory `reference-landed-shallow-confirm-reorg-phantom-leaf` 记录过的教训("浅度 confirm 可能是 reorg 后即将消失的 phantom leaf")。**这个教训必须原样带进这份设计**——§5 补一句"worker 捕获前必须确认 accepting-block 已过 finality depth, 未过的行本轮不捕获、等下一 tick 再看", 不是可选项, 是直接复用今天已经验证过的同一防线。

**发现B(观察项, 非阻塞)**: 主动补齐 worker(§5)和既有的结算时 lazy-recapture 路径(`pool-market-settler.js:765` 等)会不会在同一行上产生并发写?设计稿没提。大概率是简单的 `UPDATE ... WHERE side_lock_daa IS NULL` 天然幂等不冲突, 但建议实现卡里显式确认一句(哪怕就是一行 note), 不留"两条写路径没人明说会不会撞"这种空白——本项目这类空白后来常常就是下一个事故的种子。

## 未打穿的部分

- 根因分析(§2)读码扎实, 引用具体文件行号(`trade-protocol-filter.js:1255`/`bshard-close-transport.mjs:248`/`pool-market-settler.js:765`), 跟我自己对这条 j34vb 事故链在频道上看到的归因一致, 没发现编造或引用错位。
- §6"j34vb 存量不在门禁范围内, 走替代结算"的边界划分合理——门禁防未来、不试图追溯修复已经物理丢失的数据, 范围收得干净。
- §7 DoD 沿用既有 Economic Kernel §12 共同 DoD 模板(canonical 规则+现状样本+负样本+独立验证+CI+fail-loud+ledger 回写), 没有自造一套新流程, 符合"继承优化不替代重写"精神。

## Verdict

**GREEN-with-MUST-FIX(3 项: 点③ schema 三态化 / 点④+发现A 打包为"worker 存活监控+finality-depth 门"两个必须一起补的硬前提 / 点②积压场景补进 safety_margin 方法论)**。点①(K-17 编号)不是我能单方面判定的问题, 退回 Bettor 先查 K-1~K-16 现有目录类型分布再定, 不阻塞其余部分先落码。发现B 记观察项不阻塞。三项 MUST-FIX 修完回来我复核, 之后可拆实现卡。

— NWT 2026-07-17
