# ST-00 · 对外主张清单与证据分级 v0.1 + ST-07 骨架

> **Status**: DRAFT(v0.1 · 首交付截止 2026-08-08T02:00+07 · BATCH-0 docs/evidence-only)
> **DRI**: Bettor · 支持: KANet-UI · 红队: NWT(跨项,专查"必要条件被写成充分条件")
> **上游**: `coordination/codex-bridge/OWNER-DIRECTIVE-20260806-POST-TOCCATA-INSTITUTIONAL-STRESS-TEST.md` + Codex ACK(4f202a58)
> **本稿纪律**: 每个 claim 无精确锚 = NOT PROVEN,不用推断补齐;统一验收语言五级(PROTOCOL CAPABILITY / TESTABLE MACHINERY / VERIFIED PATH / USABLE INFRASTRUCTURE / NOT PROVEN)。

## §1 冻结技术基线(Codex 硬要求: 先于一切 claim 分类)

| 锚 | 值(2026-08-07 07:0xZ 实采) | 采法 | ⚠ 注意 |
|---|---|---|---|
| KANet 分支+commit | `bshard-m3-deploy` @ `8ba5d8b6` | `git rev-parse HEAD` | 树 HEAD ≠ 运行时身份(下行) |
| KANet console 运行时 | PID **32688** · T0=`2026-08-07T06:44:18Z`(OS netstat 实核非 supervisor 报数) | (140)BBj | 🔴 装载的是启动时刻树状态;import-at-start,commit 后不重启不生效 |
| rusty-kaspa 源码树(本机) | `90dbf074`(+4 行未提交) | `git -C /d/rusty-kaspa rev-parse HEAD` | 🔴 **与 J1 那台 `ab4c51af` 不是同一版**((140)BBa 发现,两锚并列,不得混用) |
| rusty-kaspa 源码树(J1 机) | `ab4c51af`(= 其 live 二进制自报 commit) | J1 06:33 报,二进制自报>树 HEAD 锚强序 | 待 J1 补启动横幅原文进本表 |
| kaspad 二进制自报版本(本机) | `v1.1.1-toc.1-7b1e18cc`(KANet-UI 07:06Z 供,横幅原文) | `logs/kaspad-tn12.out.log` / `logs/kaspad.log` | ⚠ **横幅最后落盘 2026-07-15,而当前进程 PID 18480 起于 08-03**(疑日志目标换位)⇒ 版本按 D-005(禁 rebuild live 节点)推定不变,**但"横幅=当前进程自报"未核**——KANet-UI 如实标,不补成已核 |
| kaspad 二进制自报版本(J1 机) | **待补**(J1) | 启动横幅 grep | 锚强弱序: 二进制自报 > 树 HEAD > 树 HEAD+未查改动((140)BBa) |
| silverscript 编译器 | 本地分支 `j2-oppick-fix-2026-07-06` @ `8065184`(**含 OP_PICK 修复,从未推上游**) | `git -C /d/silverscript rev-parse HEAD` | 🔴 上游无此修复 ⇒ 第三方生成的 covenant 带已知 codegen bug(CLAUDE.md 状态注记;ST-01 known-divergence 第一行) |
| kaspa-wasm SDK | vendored(`shared/vendor/kaspa-wasm`,无 package.json 版本号) | artifact 锚: `kaspa_bg.wasm` sha256=`51cec45e7f21dd7962bcc1830a4236c514d8f829d2babca30e77602a214c3791` | 版本号不可得 ⇒ 以字节哈希为身份 |
| Node 运行时 | v24.14.1 | `node --version` | — |
| 网络 | TN12(testnet-12)· 无公共 explorer(实测在案) | memory `reference-no-public-explorer-tn12` | 链上核实一律 relay `check_utxo_landed` |
| Toccata/vProg 仓库+commit | **N/A——KANet 当前栈未集成任何 vProg 组件** | — | 🔴 这本身是 §3 多数场景标 PROTOCOL_CAPABILITY_ONLY 的依据 |

## §2 七条高风险措辞 · 分类与证据分级

| # | 措辞 | 分类 | 证据级 | 依据(锚) |
|---|---|---|---|---|
| 1 | "covenant semantics ossified" | PROTOCOL 性质主张 | **NOT PROVEN** | 现有证据=两源码快照的 version 闸文本一致((140)BBa)——Codex 已裁: 源码文本一致≠语义 ossification;需 ST-01 byte-exact 向量跨实现 |
| 2 | "operator is commodity" | TARGET | **NOT PROVEN** | 现实例=单运营方(Owner 实例);指令二三层概念: 运营方独立不能靠加机器制造;ST-02 全 OPEN |
| 3 | "permissionless exit" | 分子集,禁整体宣称 | **PARTIAL(仅 v0.7 claim 路)** | ✅CONFIRMED·链上: v0.7 `CloseZkV2.claim` 零 checkSig merkle+nullifier,ZK settle landed(D-001,NWT 独立核);🔴 v0.5/v0.6(**当前真钱主力**)exit=委员/oracle 签名路,三份 escrow 全签名零自执行(在案);🔴 P3"零 checkSig≠完整授权证明"(D-012 §2-bis)未闭 ⇒ 整体措辞禁用 |
| 4 | "snapshot guarantees recovery" | PROTOCOL_CAPABILITY_ONLY | **NOT PROVEN** | KANet 无 snapshot 集成;必要非充分(指令边界 2 的七条件全 OPEN);ST-02 设计未开 |
| 5 | "circuit guarantees value conservation" | 分层错置,禁此措辞 | **PARTIAL(分层后)** | 正确分层(指令边界 3): 守恒在透明 UTXO+covenant——v0.7 实证=守池子钱的是 covenant 链上 clamp 非委员签名(precond3,4992fa 系);circuit 只证处分资格;PB-S8-2 §11.5: 三锚点永远只是拒绝信号 |
| 6 | "indexer reconstructs canonical money flow" | OPERATOR-POLICY(display-only) | **明确为假(作为权威用法)** | 本仓自证: `kaspa_tx_log` 两向都不可靠(在案)· VERIFIED✓ 回执读本机 DB 不碰链(在案)· bcast sender=output0 可伪(在案)⇒ 钱路事实只认 outpoint/prevout/解锁条件/covenant ID/已验交易图/L1 确认 |
| 7 | "KANet is usable infrastructure" | 总判断 | **NOT PROVEN——当前=TESTABLE MACHINERY** | 指令五当前总判断冻结原文;升级条件=ST-07 失败场景可复现验证 |

## §3 ST-07 failure corpus 骨架(每场景先挂路径标签——缺当前路径=NOT-RUN,非 FAIL 亦非 PASS)

| # | 场景 | 路径标签(v0.1 初判) | 现有实名路径/证据锚 |
|---|---|---|---|
| 1 | 原 vProg 运营方永久消失 | **PROTOCOL_CAPABILITY_ONLY** | KANet 无 vProg lane;类比物=console 单机运营(其消失=另一场景,不混) |
| 2 | snapshot 恶意/过期/不完整/扣留 | **PROTOCOL_CAPABILITY_ONLY** | 无 snapshot 集成 |
| 3 | lane 历史越过 pruning window | **CURRENT_PATH(类比: 链剪枝)** | 实案: episode7 getBlock 打剪枝块((140)BAh);TN12 剪枝窗为真实约束 |
| 4 | 两 indexer 矛盾 | **CURRENT_PATH(单 indexer 变体)** | 本机 kaspa_tx_log vs relay 实探已有矛盾实案(两向不可靠档案);双 indexer 场景=TARGET |
| 5 | Oracle 委员会分裂/串谋/失联 | **CURRENT_PATH(部分)** | 委员失联=实案已有(watchdog/stuck 族);串谋=设计层(PB-S8-1 [TESTED·未实弹]);equivocation 测试=卡② 七项之一未闭 |
| 6 | 钱包只完成部分签名 | **CURRENT_PATH** | collecting_sigs 超时→cancel+refund 路径实存(`pool-market-settler.js:1149`);对应 D4 语境 |
| 7 | SDK 升级致 descriptor/covenant ID 漂移 | **CURRENT_PATH(已有活体)** | 🔴 OP_PICK 上下游分歧=现成漂移实例(§1);ST-01 known-divergence 行 |
| 8 | 费用暴涨/880-wall | **CURRENT_PATH** | J2 1c 实测费分布(159 样本,fee/输入 max 2.5e6 sompi)+90% 下界参数;拥堵翻 8 倍=误拒转正确告警的边界已量化 |
| 9 | proving service 停但用户要退款退出 | **CURRENT_PATH(v0.7 子集)** | escape_claim 路存在;⚠ exit-path 矩阵验证纪律在案(收真钱前必验);与 P1"验不成≠可退款"不变量交叉 |
| 10 | 运营方换程序版本/proving key | **TARGET_ARCHITECTURE** | D-009 imageId/gateTmplHash 冻结门=本场景的现行人工防线(机制未自动化) |
| 11 | 新运营方从同一 snapshot 得出不同 next state | **PROTOCOL_CAPABILITY_ONLY** | 无 snapshot;KANet 类比=跨节点重建验不成(bshard market_shards 不跨节点——D-001 立 ZK 路线的原始死结,实案在册) |
| 12 | 用户有全部资产证明但 incumbent 拒绝配合退出 | **CURRENT_PATH(v0.7)/TARGET(v0.5/0.6)** | v0.7: claim 不需 incumbent(merkle+nullifier);v0.5/0.6: 拒签→:1149 refund 或卡死=P1 实案(125 笔/1208.46 冻结在案) |
| — | (KANet 特有,建议增补) console 运营进程反复劣化 | **CURRENT_PATH** | CONSOLE-RECURRING-DEGRADATION,6 episode 实测,机制未定 |

## §4 缺口与下一步
- §1 两格待补(kaspad 二进制自报×2)——已在频道点名 J1/KANet-UI。
- §2 每行的"升级到 VERIFIED 需要什么"由 ST-01..06 各 DRI 设计稿逐条给,本稿不预编。
- ST-07 每场景的五要素(前置态/注入/可观察量/预期 fail-closed/恢复退出+不变量+证据引用)= v0.2 内容,只对 CURRENT_PATH 场景展开。
- NWT 红队本稿: 专查①路径标签有没有把 PROTOCOL_CAPABILITY_ONLY 标成 CURRENT;②§2 有没有"必要条件写成充分条件"。
