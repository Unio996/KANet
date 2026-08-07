# ST-00 · 对外主张清单与证据分级 v0.2 + ST-07 骨架(CURRENT_PATH 五要素展开)

> **Status**: DRAFT(v0.2 · 首交付截止 2026-08-08T02:00+07 · BATCH-0 docs/evidence-only)
> **v0.2 变更(2026-08-07 10:2xZ)**: §2#3 并入退出图 v4 与 spine 普查数字;§3 对 CURRENT_PATH 场景做五要素展开;#7 divergence 实例按当日实测更正(OP_PICK 候选撤回、.sil 源码版本 epoch 实证);#4 并入 G-4 全弧证据。
> **v0.2-a 措辞降级(2026-08-07 11:1xZ · Codex 3486cb17 审后)**: 🔴 **本文件全部资金/计数数字(171,227 / 81,665 / 48% / 52% / 701 / 21+6 / 36,012 / 26 / 6,360 / 1,341 / 99.5% / 40-40 / 14-14 / 2,863 …)一律为 `OBSERVED · NOT-YET-INDEPENDENTLY-REPRODUCIBLE`**——它们是本机运行时观察,证据包 `docs/2026-08-07-st00-exposure-evidence.md`(J2 编,Codex 八项形态)落地并经 NWT 抽验前,**不得升为 VERIFIED 制度性主张**。唯一被 Codex 升级的是 **#5 V1 PayoutShard liveness 失败 = CONFIRMED-AT-CODE-LEVEL**(逐行读 `PayoutShard.sil`:cancel_attest 要 validSigs>=4、`closed 0→2`、零 tx.time/timelock/无许可逃生;作用域**仅 V1 PayoutShard 一族,禁外推**)。
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
| kaspad 二进制自报版本(J1 机) | `kaspad v1.1.1-toc.1-ab4c51a`(J1 07:06Z 供,**当前进程**横幅逐字,本次启动 02:06:42 本地,`rusty-kaspa.log:487430`) | 启动横幅 grep | 锚强弱序: 二进制自报 > 树 HEAD > 树 HEAD+未查改动((140)BBa) |
| 🔴 两机 kaspad 差异(基线事实) | **同版本线 `v1.1.1-toc.1` 但不同 build**: 本机 `7b1e18cc` vs J1 机 `ab4c51a` | 上两行并读 | (140)BBa 的源码树差异在二进制层坐实(J1 侧锚强、本机侧带"横幅是否当前进程"未核缺口);ST-01 跨实现矩阵的又一现成 divergence 候选行 |
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
| 3 | "permissionless exit" | 分子集,禁整体宣称 | **PARTIAL(按路径列,禁合并)** | ✅CONFIRMED·链上: v0.7 `CloseZkV2.claim` 零 checkSig merkle+nullifier,ZK settle landed(D-001,NWT 独立核);✅ v0.7 pool **本金**退出=covenant 自主分支(`PoolSide_v07.sil` refund 路,自签+宽限期,J2 07:06 现读)——**必要条件成立≠用户能退出**(差私钥托管+redeem script/outpoint 数据可获得性两个链下节点;timelock-grief 已排除·by construction: deadline=构造参数编进 P2SH 无重置路径(`PoolSide_v07.sil:73/:276`,J2 07:09;依赖 ST-01 轴工具链性质+节点 lockTime 接受两格如实标));**赢款/整盘结算**仍需 4-of-5 委员;🔴 v0.5/v0.6(当前真钱主力)放钱=oracle 亲签(`relay.mjs:711`,D-012 §2);🔴 三份 prediction escrow(`Unanimous5/ConsensualMid/Multi.sil` **仅此三文件,作用域勿扩**——J2 07:08 更正压缩引用在案)checkSig 9/4/1、hash 0/0/0;🔴 P3"零 checkSig≠完整授权证明"未闭 ⇒ 整体措辞禁用 |
| 4 | "snapshot guarantees recovery" | PROTOCOL_CAPABILITY_ONLY | **NOT PROVEN** | KANet 无 snapshot 集成;必要非充分(指令边界 2 的七条件全 OPEN);ST-02 设计未开 |
| 5 | "circuit guarantees value conservation" | 分层错置,禁此措辞 | **PARTIAL(分层后)** | 正确分层(指令边界 3): 守恒在透明 UTXO+covenant——v0.7 实证=守池子钱的是 covenant 链上 clamp 非委员签名(precond3,4992fa 系);circuit 只证处分资格;PB-S8-2 §11.5: 三锚点永远只是拒绝信号 |
| 6 | "indexer reconstructs canonical money flow" | OPERATOR-POLICY(display-only) | **明确为假(作为权威用法)** | 本仓自证: `kaspa_tx_log` 两向都不可靠(在案)· VERIFIED✓ 回执读本机 DB 不碰链(在案)· bcast sender=output0 可伪(在案)⇒ 钱路事实只认 outpoint/prevout/解锁条件/covenant ID/已验交易图/L1 确认 |
| 7 | "KANet is usable infrastructure" | 总判断 | **NOT PROVEN——当前=TESTABLE MACHINERY** | 指令五当前总判断冻结原文;升级条件=ST-07 失败场景可复现验证 |

## §2-bis 退出图 v4 与量化(2026-08-07 当日实测,并入 #3 行的数字底座)

> ⚠ **本节全部数字 = OBSERVED·NOT-YET-INDEPENDENTLY-REPRODUCIBLE**(证据包待落,见文件头 v0.2-a)。
- **非终态 v0.7 市场 381 个,377 个链上仍有钱,合计 ≈171,227 KAS**(直连 kaspad 全量普查,去重口径):**≈81,665(48%)在 spine 层 = bettor 零自主退出**(唯 `settle_aggregate` 5 委员 / `refund_maker_unjoined` maker 限额);≈89,496(52%)在 side 层——🔴 **脚本层暴露自主退出分支 = 必要条件,非充分**: 用户还须实际持有私钥 + redeem script + outpoint/proof 材料才真能退出(见 §2-bis 四路 + tg 托管那格: 钥匙在运营方 ⇒ 脚本有分支而用户退不出)。**"side=自主退出可用"是脚本能力陈述,不是可操作退出性陈述。**
- **四路退出形态**: bshard V1(701 shards)=5 委员签零 timelock 永锁面 🔴 · bshard V2+ZK close(21+6)=零签名 merkle 自证 🔵 · PoolSide(36,012 sides)=自签+不可 grief ctor deadline 🟡 · tg 托管(26)=钥匙大概率在运营方 🔴。**全局: 退出强弱差在要不要签名,瓶颈四路一致=链下数据在谁手上;零签名把依赖从私钥换成数据,没有消除依赖。**
- **锚材料实况**: 两套架构双锚(side_redeem_script_hex 6,360 条 99.5% 当前版可 byte-exact 再生成、31 条旧版可枚举 / shard_redeem_hex 1,341 全有 40/40 实测)——"实无从锚"档趋近空集;再生成前置=钉住 .sil 源码版本。**锚得住≠退得出。**
- 与 33,735 KAS 卡(`pruned_expired_waived` 137 盘)= **基本独立两问题**(A=没人去做,B=做不了;读数同处置反,维持两卡;65 KAS 双重归属扣重)。

## §3 ST-07 failure corpus 骨架(每场景先挂路径标签——缺当前路径=NOT-RUN,非 FAIL 亦非 PASS)

| # | 场景 | 路径标签(v0.1 初判) | 现有实名路径/证据锚 |
|---|---|---|---|
| 1 | 原 vProg 运营方永久消失 | **PROTOCOL_CAPABILITY_ONLY** | KANet 无 vProg lane;类比物=console 单机运营(其消失=另一场景,不混) |
| 2 | snapshot 恶意/过期/不完整/扣留 | **PROTOCOL_CAPABILITY_ONLY** | 无 snapshot 集成 |
| 3 | lane 历史越过 pruning window | **CURRENT_PATH(类比: 链剪枝)** | 实案: episode7 getBlock 打剪枝块((140)BAh);TN12 剪枝窗为真实约束 |
| 4 | 两 indexer 矛盾 | **CURRENT_PATH(单 indexer 变体,当日全弧证据)** | 两向不可靠档案 + **G-4 全弧(当日)**: settler 曾有分支拿 `from_address` 索引+输出个数写终态——已 fail-closed dearming 移除(`f5084779`,Codex 双审认);`from_address` 两台全 NULL=indexer 根本不填此列("禁止顺手修"牌=引信保险销);G-4 真对账能力(Codex 九项)OPEN,受影响 cross-node 市场=unresolved/manual-evidence-required 诚实态;双 indexer 场景=TARGET |
| 5 | Oracle 委员会分裂/串谋/失联 | **CURRENT_PATH(部分)** | 委员失联=实案已有(watchdog/stuck 族);串谋=设计层(PB-S8-1 [TESTED·未实弹]);equivocation 测试=卡② 七项之一未闭 |
| 6 | 钱包只完成部分签名 | **CURRENT_PATH** | collecting_sigs 超时→cancel+refund 路径实存(`pool-market-settler.js:1149`);对应 D4 语境 |
| 7 | SDK 升级致 descriptor/covenant ID 漂移 | **CURRENT_PATH(已有两个实测活体,当日更正)** | ①**.sil 源码版本 epoch**(当日实测确诊: grace 常量 `7200` 之有无 ⇒ 4 字节差 ⇒ P2SH 不同 ⇒ 花不动那笔钱;30 样本判定,零拟合)——**再生成/归档必须钉源码版本**;②OP_PICK 上下游 codegen 分歧——⚠ 当日实测**对 `PoolSide_v07` 产物无影响**(修复前后编译逐字节同,ST-01 divergence 候选按此撤回),但对触发深栈 OP_PICK 的脚本**有历史活体**(jepu1 盘 settle 被节点连拒 432 次,D-001 活体取证在案)⇒ 分歧按脚本族分档,不一概而论 |
| 8 | 费用暴涨/880-wall | **CURRENT_PATH** | J2 1c 实测费分布(159 样本,fee/输入 max 2.5e6 sompi)+90% 下界参数;拥堵翻 8 倍=误拒转正确告警的边界已量化 |
| 9 | proving service 停但用户要退款退出 | **CURRENT_PATH(v0.7 子集)** | escape_claim 路存在;⚠ exit-path 矩阵验证纪律在案(收真钱前必验);与 P1"验不成≠可退款"不变量交叉 |
| 10 | 运营方换程序版本/proving key | **TARGET_ARCHITECTURE** | D-009 imageId/gateTmplHash 冻结门=本场景的现行人工防线(机制未自动化) |
| 11 | 新运营方从同一 snapshot 得出不同 next state | **PROTOCOL_CAPABILITY_ONLY** | 无 snapshot;KANet 类比=跨节点重建验不成(bshard market_shards 不跨节点——D-001 立 ZK 路线的原始死结,实案在册) |
| 12 | 用户有全部资产证明但 incumbent 拒绝配合退出 | **CURRENT_PATH(v0.7)/TARGET(v0.5/0.6)** | v0.7: claim 不需 incumbent(merkle+nullifier);v0.5/0.6: 拒签→:1149 refund 或卡死=P1 实案(125 笔/1208.46 冻结在案) |
| — | (KANet 特有,建议增补) console 运营进程反复劣化 | **CURRENT_PATH** | CONSOLE-RECURRING-DEGRADATION,6 episode 实测,机制未定 |

## §3-bis CURRENT_PATH 场景五要素展开(v0.2 新增;格式: 前置态/注入/可观察量/预期 fail-closed/恢复退出 · 不变量 · 证据锚 · 状态)

**#3 剪枝越窗**: 前置=非终态市场 side 已越 pruningPoint(实况: 可测 2,863 条 100% 已越)。注入=无需注入,已是现状。可观察量=`side_lock_daa` vs 节点 `pruningPointDaa`(⚠ 覆盖率仅 8%,SIDE-LOCK-DAA-COVERAGE-8PCT 卡)。预期行为=**资金可花性不受影响**(剪枝丢历史不丢 UTXO 集,J1 38/38 实测),失去的是独立归属证明。恢复=归档锚 `hash(构造参数拼出的脚本)==UTXO 当前 scriptPubKey`(剪枝免疫,双架构实测 40/40+14/14)。不变量=锚得住≠退得出。状态=**PARTIAL**(现象已实测;可信归档 manifest 在途)。
**#4 indexer 失真**: 见 §3 表行 G-4 全弧。预期 fail-closed=终态只能由权威 outpoint 级对账写(九项清单),缺则 unresolved。状态=**PARTIAL**(危险分支已移除;对账能力 NOT-RUN)。
**#5 oracle 委员失效**: 前置=V1 PayoutShard 盘(≈701 OBSERVED)委员不可用。注入=委员不签 `cancel_attest`。可观察量=`closed` 停 0、spine 资金不动。预期=**当前无 fail-safe——`cancel_attest` 要 validSigs>=4、合约内零 tx.time/timelock/无许可逃生分支 ⇒ 委员签不出即永锁**。恢复=无协议内路径;升 V2 形态或委员恢复。不变量=「验不成 ≠ 可退款」同时成立 ⇒ 双向都不许自动。状态=🔴 **CONFIRMED-AT-CODE-LEVEL(Codex 3486cb17 逐行读 `PayoutShard.sil` 确认;作用域仅 V1 PayoutShard 一族)**——**这是本压力测试第一条被外部独立审升到代码级确认的实质缺陷**;是 ST-05/②-a liveness 面要解的本体。⚠ **禁外推**: `PredictionEscrowUnanimous5.sil` 等有 deadline refund 分支,是不同合约族不同退出模型,不适用本结论(Codex 明令,每行退出带确切合约文件名)。
**#6 部分签名**: 前置=collecting_sigs。注入=签名凑不齐。可观察量=`:1149` watchdog-b 超时 → cancel+maker refund 通道(实存)。预期=按 D-012 不变量,缺证据不得转成另一条不可逆钱路的许可——现状该通道自动,**与不变量的张力在案**(P1 卡族)。状态=**PARTIAL**。
**#7 工具链漂移**: 见 §3 表行两活体。预期=fail-closed: 再生成必须钉 .sil 版本+编译器身份,mismatch 即拒。状态=**PARTIAL**(判别器已有: hex 长度直方图;守卫未机制化)。
**#8 费用暴涨**: 前置=90% 下界参数。注入=fee/输入 涨至 ~19.6e6 sompi(观测 max 的 7.8 倍)。可观察量=毛额守恒锚拒签。预期=误拒即正确告警(J2 1c 实测判据: "不误拒"非"够防";10 KAS 抽水盲区已量化进 §0 已知不覆盖)。状态=**PARTIAL·参数已实测**。
**#9 proving 停摆(v0.7 ZK 子集)**: 前置=escape_grace 后。注入=prover 不可用。可观察量=`escape_trigger`/`escape_claim` 零签名路(源码实读)。预期=任何第三方可替用户推款回其 P2PK。⚠ 三格: 6h 宽限为占位未签认 / **链上从未实跑过一次 escape** / 作用域=27 盘。状态=**NOT-RUN**(合约里有≠跑通过)。
**#12 incumbent 拒退(v0.7)**: side 层(52% 资金)=自签自主路,实测退出分支 by-construction 不可 grief;spine 层(48%)=回到 #5。tg 托管 26 钱包=钥匙在运营方,"脚本有分支≠用户能退出"带实钱活实例。状态=**PARTIAL(按层分)**。
**#13(KANet 特有)console 反复劣化**: 六 episode 实测(第 6 轮右删失),机制未定(H-A 已葬,H-B 次序存疑);仪器已装(heartbeat 两字段下窗生效)。状态=**OPEN·仪器就位**。

## §4 缺口与下一步
- §1 两格待补(kaspad 二进制自报×2)——已在频道点名 J1/KANet-UI。
- §2 每行的"升级到 VERIFIED 需要什么"由 ST-01..06 各 DRI 设计稿逐条给,本稿不预编。
- ST-07 每场景的五要素(前置态/注入/可观察量/预期 fail-closed/恢复退出+不变量+证据引用)= v0.2 内容,只对 CURRENT_PATH 场景展开。
- NWT 红队本稿: 专查①路径标签有没有把 PROTOCOL_CAPABILITY_ONLY 标成 CURRENT;②§2 有没有"必要条件写成充分条件"。
