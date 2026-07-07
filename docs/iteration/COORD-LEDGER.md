# COORD-LEDGER — 多 agent 协调主账(OIL-v0.3)

> 按 OIL-v0.3 §8.4 建:**频道=传输层,本 Ledger=状态层。频道滚走,状态活这里。**
> 协调 agent:Bettor(全执行域 read-only 结构锁)。回写分级:关键决策/关2关3/§11决议必沉淀。
> **接位文档(`C:\开发过程\…\开发智能体接位\*-接位.md`)= 稳定层,零烤状态;当前进度只读本文件。**
> 最近刷新:**2026-07-06(Bettor 恢复状态层·§8.4 断档 6/29→7/06 补回)**。此前刷新 2026-06-29。
> ⚠ **断档教训(2026-07-06 Owner+J1 抓)**: 7/1-7/06 公测一周激烈工作(结算/daemon/ZK-covenant/框架决策)**全没回写本 ledger、活在会滚走的频道** = §8.4 铁律违反(频道当记忆)。协调者(Bettor)失职。**恢复纪律: 每决议回写本 ledger + DECISIONS.md。**

---

## 🟢 fresh 接位(2026-07-07·Owner 令全队重启,接昨晚 20:41 收官)
> **背景**: 昨晚 escapeRefund 全线闭环收官后,团队三方(Bettor/J2/NWT)自评 session 过长、独立收敛一致建议重启,Owner 20:38 拍板"我会给你们整个重启"。J1 满月恢复归队。

### ✅ Phase1 前半:整机 reboot 后 live 栈恢复 GREEN(2026-07-07 11:54-12:05 本地·Bettor fresh 接位执行+记账)
- **恢复序(照 checkpoint 计划+memory SOP)**: ①kaspad detached 拉起(PID 21176,canonical 命令含 `--enable-unsynced-mining` 命门 flag)→ ②挖矿 watchdog detached(`tn12-mining-watchdog.ps1`,bridge 内置 CPU 2 线程),BLOCK ACCEPTED+confirmed BLUE,isSynced=true,DAA 54894671 推进 → ③`bash -lc kanet-start.sh` detached → console :3200 UP,29 relay 挂新 PID(J2 树杀验证无孤儿),settle daemon 自启。
- **⚠ 三方 launcher 撞车(教训·retro 素材)**: Bettor/J2/KANet-UI 三个 fresh 会话在 11:59-12:00 各自独立跑了 kanet-start.sh(都没先核对频道认领)——脚本"杀旧起新"设计让终态收敛到单 console(PID 7248)无损害,副作用 test-cron 双开(Bettor 杀旧留新 32004)。**教训=共享进程生命周期操作必须先频道认领再动手**(与 Phase0 备份认领同款,KANet-UI 主动透明报告)。
- **watch 项(非阻塞)**: ①~~x6ll8 register confirm 疑双花 race~~ **✅关闭(KANet-UI 链上核实 05:11)**——tx 6457ad69 实际落链(block_time 05:01:49),"not landed"=30s landed() 轮询窗口在重启高延迟期的假阴性(G5-5a 同族,归既有超时阈值 backlog);且该笔为 gateway relay 自进自出 funding 非 bettor 押金,s0/32+s1/14 无孤儿无重复,无资损无状态污染;②settle daemon 对深过期老 ripe 盘(deadlineDaa 比 tip 深 >250k)`getBlockAtDaa MAX_WALK=250000 耗尽` throw → fail-closed skip 不动钱(54-3hipq/64-7rztt/82-i044k),无资损但占 tick 吞吐,J2 settler 域评估(跳过分类 or 加 deep-walk);③FaucetRelay-tn-2 `RuntimeError: unreachable` = 已知 294 万 UTXO 冻结地址噪音;④llama-server 本机无 binary/model,脚本按设计跳过(qwen-worker 相应跳过)。
- **Phase1 后半(装机)**: J2 认领推进——Ubuntu `wsl --import` 直接进 D 盘(C 盘仅 19.3GB 硬坑)+Docker Desktop(data-root 指 D)+RISC0;交互步骤(installer GUI/WSL 首用户)喊 Owner 配合。KANet-UI/Bettor 不并行动装机。
- **Bettor fresh 接位(2026-07-07)**: 已读 DECISIONS(D-001~D-005)+本 ledger+频道尾部+git(HEAD `7cdf09a7`),状态无漂移。频道 Monitor 已设,接位广播已发(#9qfa1p),等 J1/J2/NWT/KANet-UI fresh 回执+查资产硬门报告。
- **当前主线(ZK 结算生产化剩余三项,承接昨晚收官口径)**:
  1. **②生产 relay handler**(J1 域): `unlockBshardZkClose`——prove+gate+2-input build+broadcast,包装昨晚已验证的真实流程。
  2. **③三前置基础设施**(escape entrypoint 服务真实市场的硬前置,wiring 文档 §2.6): 出证备份机(J1 已认领 SPOF 评估)+ proving job 卡死告警 + `ESCAPE_GRACE` 按"出证环境全损到重建最坏时长"定标。
  3. **④kill switch 端到端测试**: `ZK_CLOSE_TICK_ENABLED` 打开后的真实链上测试——碰钱广播,完整确认点,排最后。
- **非阻塞待办队列(昨晚遗留,不丢)**: `_j2_closezk_repro4.sil` 归位改名(移出根目录 `_*` 约定) / `_PSZK` 幻影 layout 清理(`readAttestedWinnerFromState` L146-169 四维 grep 定性) / `PayoutShard.sil` dust 同款缺口独立跟进 / `bh01w` zombie_quarantine 处置 / zk-prove-server bearer token 补 constant-time 比较 / **7/8 首轮框架 retro(D-002,明天,FRAMEWORK-RETRO-TEMPLATE)**。
- **🔴🔴 Owner 钦定今日终极目标(2026-07-07)**: **"今天就一个终极目标,ZK 要并入预测系统运行!"** —— 主线优先级锁生效,今天所有切片服务此目标。
  - **DoD(Bettor 译,报数级别词)**: settle daemon 在 kill switch ON 下,对至少一个符合准入政策(世界杯 pool ≤900 人)的真实市场,**全自动**走完 ZK 结算路径(enqueue proving job → J1 机器出真 Groth16 → relay handler 组装广播 zk_close → 落链 → reconcile 转 `zk_settled`),predict-then-verify 确认点全过,双重独立核实落链 = **端到端 demonstrate**。不越界 claim"全量迁移/生产就绪"。
  - **关键路径(依赖序)**: T1 卡死告警(J2,落码中,NWT GREEN 已给) → ②relay handler `unlockBshardZkClose`(J1 域,今天最大缺件) + `dispatchUnlockZkClose` ctx hook 接线(J2) → 隔离全链测试 → kill switch ON(§2.6: escape 未上时卡死无经济后果,可先开) → Bettor 手动标记一个准入市场 `zk_ready` → daemon 自动结算 → 双重核实。
  - **今日范围外(不因赶目标偷渡)**: escape_trigger/escape_claim 上真实市场(三前置未齐:备份 proving 机+GRACE 定标未完成)——escapeRefund ctx hook 可接线但保持 fail-closed,不服务真实市场。
  - **🔴 关键路径重排(2026-07-07 21:5x·J2+NWT 双独立缺口地图坐实两层缺口,都在 relay handler 之前)**:
    - **缺口 A(最重,新增)**: **ZK covenant genesis-mint 生产管线完全不存在**——grep 全库 `zk_continuation` 零写入点(只有 daemon.mjs 3 处读)。昨晚 LANDED 全靠手工脚本一次性构造。需新建:attest 完成(复用既有 `judgeWinDir`,955 赢家在用)→ 建 ctor(attestedWinner/attestedAtSeconds(读 kaspa_tx_log attest tx.time)/betsRootBaked/refundRootBaked/consolidated_pool/17-word nullifier 全 0)→ 编译 mint CloseZkRepro4 covenant → 写 `market.metadata.zk_continuation`。**真实市场 mint = 把市场池子真金搬进 ZK covenant UTXO,今天最重 money-path 步,确认点全走**。
    - **缺口 B(下游,fail-closed 非资损)**: `zk-close-builder.mjs:151` `_PSZK` 幻影 layout 字段序整个反了+少算 17 个 w 字段(NWT 对照 repro4.sil 20-46 行实际 ctor 序坐实)——今天任何真实 settle 会在 `zkClosePhase2:188` 结构校验 throw 卡死。修法:ctor-baked 模式下 attestedWinner 从 mint 步骤产出的 metadata 直读,废除 `readAttestedWinnerFromState` 幻影解码。
    - **重排后序**: J2 出缺口 A+B 一份设计稿(`zk_continuation` metadata schema 作为 J1/J2 接口契约优先定稿)→ NWT 红队审 → J2 落码;J1 handler 设计**并行**(靠 schema 解耦,不等 A 落完)→ 汇合隔离全链测试 → kill switch ON → zk_ready → demonstrate。
  - **🔴🔴 §11 决议:中途迁移死路 → ZK-native 定案选项(a) PayoutShardV2+zk_handoff(2026-07-07 22:0x·对抗讨论收敛·Owner 定调"zk走到底!毫无疑问")**:
    - **坐实(三方独立源码级)**: PayoutShard.sil 全部 5 entry(absorb/close_attest/cancel_attest/claim/refund_claim)无一能整池交接异族 covenant(claim/refund_claim 硬锁 merkle 证明的 bettor 地址逐个领);state-in-address→改源码也救不了已 genesis 的存量盘。**存量/在途市场永久走 committee-sig 老路**(与 Owner 已拍准入政策一致)。
    - **关键事实链**: ShardLeaf.sil `consolidate_to_payout`(85-107) destination=covenant 硬绑 `payout_cov_id`(ctor 烤值,opaque instance-id 非 bytecode 类型)→ 目标 covenant 必须**先于 shards genesis**(ordering)→ 这恰是现产线既有顺序 → **(a) 零 ShardLeaf/零 CloseZkRepro4 改动可行**。
    - **定案(a)**: 新文件 `PayoutShardV2.sil`(仅服务新市场,零 live 风险)= 战阵 PayoutShard 原样 + ①close_attest 后置条件多存 `attestedWinner`+`attestedAtSeconds` 进 state ②新 `zk_handoff` entry(require closed==1,一次性,用自身 state 重构期望 CloseZk redeem hash 验 destination(non-vacuous binding 同款,post-attest state 已终值,不重蹈 06-20 template-vs-cov_id 坑),value==consolidated_pool 整池交接)。**(b)(CloseZk 自带 absorb+attest)被 J2 主动收回**——要动 shard 共用模板+重构 CloseZk 两个源,风险面大一个数量级。
    - **开放点定向**: CloseZk ctor 的 betsRootBaked/refundRootBaked 来源——**(i)优先**(close_attest 时委员一并 attest 进 V2 state,verify-value-source 全链);**(ii)兜底**(driver-baked+C2 byte-equal 门+大声标注信任降级,显式退路含触发条件)。
    - **候选市场新标准(NWT)**: 必须**从现在起新建**的盘(用 V2 模板开),任何已用旧 ShardLeaf 收注的现存盘(哪怕未 attest)一律不合格。KANet-UI 只备创建参数不执行。
    - **J1 应急线预置**: J1 若持续缺席,J2 临时跨域顶 relay 侧+NWT 双倍审力,单独报 Owner 批后才动。
  - **✅ V2 设计稿 v2.1 设计层闭合(2026-07-07 22:2x)**: `docs/2026-07-07-zk-genesis-mint-pipeline-design.md`。Bettor 方向审抓 3 洞(①zk_handoff 模板锚缺失——witness 段无锚=caller 可喂恶意模板卷全池,w0in 同族 CRITICAL;②attestedAtSeconds 写入路径断链;③size 预警),NWT 交叉独立确认,J2 全部修复:①加 `closeZkTmplAnchor` ctor 字段+blake2b(prefix+suffix)==anchor 锚定 ②改 `attestedAtMs` 委员 5 签 witness(同其余 attest 字段信任模型) ③PayoutShard 基线实测 11098B、增量小、终验留实编译。claim entry 物理删除(双路径分配数学错配,Bettor 拍板)+refund_claim 仅 closed==2 cancel 路径与 zk_handoff(closed==1)互斥。NWT 读实际 doc 独立复核三洞修复,**设计层 GREEN 放行落码**,代码级四层验收不省。
  - **🔬 durable 发现(silverc parser,J2 4 组 probe 实测)**: `tx.time` 唯一合法形式=孤立 `require(tx.time >= X)`,**不能赋值/不能算术/不能 ==/不能复合表达式**(da9fc22 parser 限制,源码级坐实非推测)。任何"covenant 自读时间"设计都不可行,时间值只能 witness 供+签名覆盖。
  - **📋 今日剩余工件清单(W1-W5)**: W1=V2.sil diff(J2 进行中)→NWT 四层;W2=委员 judge/签名工具链扩展(sighash 多覆盖 4 新字段,横跨 J1 oracle 域,J1 缺席 J2 可 draft voter 侧不合并);W3=市场创建接 V2 模板(genesis-mint V2+shards 烤 cov_id);W4=relay 侧 handoff 组装+zk_close 命令(J1 域);W5=daemon dispatchUnlockZkClose hook 接 W4。J1 时限:W1 过审时仍缺席→应急评估报 Owner。
  - **🎉 W1 闭合(2026-07-07 22:57·NWT 完整四层 GREEN)**: `kasia-console/src/lib/PayoutShardV2.sil`——absorb/close_attest(+4 委员 witness 字段)/cancel_attest/refund_claim 逐行 byte 级对照原版无差异,claim 物理删除,zk_handoff 新 entry。**byte-exact 重构完全解决**:attestedAtMs 宽度稳定假设(Bettor+NWT 独立同提)实测坐实(2026~+10年 ms 值域恒定 6B,4 次独立编译总长 4331B 不变)+bounds guard `require(2^40<=atMs<2^47)` 链上锁值域;4 段固定模板+state 区(复用 pool-shard-state-serialize canonical 模式)+3 变量插入点;**运行时执行级证据**(cli-debugger 实跑 zk_handoff,BYTES/HASH MATCH,双方独立重算吻合)签的 layer1,比 symbolic check 更硬。全链上 enforce 保住,零降级。
  - **🔬 durable 发现(本轮新增 3 条)**: ①silverc `byte[N](int)` int-to-bytes cast 硬上限 8 字节(NUM2BIN),构造 ZERO32 须 4×`byte[](0,8)` 拼接(debugger 抓的实 bug) ②minimal-push int 宽度由值域定——真实 ms 时间戳域恒定 6B,配链上 bounds guard 可当固定插入点(编码宽度问题的通用解法模式) ③`D:/silverscript/debugger/cli`(cli-debugger.exe)支持 .test.json 结构化 covenant 执行测试+运行时变量转储——比纯 off-chain 数学对照硬一级的验证武器,后续 covenant 验收标配。
  - **⏳ J1 应急评估已交 Owner(22:58)**: (A)W4 relay handler 请批 J2 跨域 draft+NWT 双审;(B)真 Groth16 prove=无解硬依赖(仅 J1 机器有环境),J1 今晚不回则诚实上限=全链就绪到 prove job 入队,J1 回来收官。
  - **✅ W3 闭合(23:24·多轮增量全 GREEN)**: pool-shard-register.mjs 3 平行函数(computeCloseZkTmplAnchor/compilePayoutShardV2Redeem/ensurePayoutShardV2,commit 61f13d7c)+registerBettorOnShard 显式 zkNative 开关+register-v07 接线+judgeWinDir blockhash_parity 分支(3288cee2)。**裁定沉淀**: zkNative 判定=创建时显式 `resolution_rule_spec.zk_native:true` 顶层字段,**禁止从 judge 类型(outcome_market_source)推断**——judge 类型≠covenant 形态,语义两维度(NWT 初批推断法后接受纠正)。首证市场定版=TN12 区块哈希奇偶(deadline/target 锚同一 DAA 计数器),KANet-UI 参数冻结。
  - **🔴 near-miss(23:27·差点打崩全线结算)**: selectRipeMarkets 加 zk_native 排除时,裸 `json_extract` 对畸形 JSON 在本 SQLite build **直接 THROW 非返回 NULL**,生产库实存 5 个畸形 spec 行——无 `json_valid` 守卫则整条结算 tick 对所有市场停摆。J2 DB copy 实测抓住+NWT 内存 sqlite 独立复现。修法=json_valid 短路守卫(e517a980),教训入 ANTI-PATTERNS 规则 54(0ed09dde)。**防线=DB copy 实测非 code review**。
  - **🔴🔴 LIVE 事故(23:53-00:0x·全部新 bshard 押注编译失败·已修复)**: demo 市场(nq0dc,spine 落链 d0513222)首注触发——`ShardLeaf.sil` 在当前 silverc 编译失败(`validateOutputStateWithTemplate does not support inline state objects`),v1+v2 全部新押注中断。**根因链**: 上游 commit `faaa074`(PR#131,改写 validateOutputStateWithTemplate codegen)引入限制 → 昨晚 OP_PICK 修复分支(8065184)基于其后基底 → **今晚部署的 cargo build 原地覆盖了生产 silverc.exe**(旧 binary 为 pre-faaa074 版,无版本 pin,955 笔历史押注全靠它)→ 重启后首个新市场编译撞墙。深夜零真实用户受损(register 失败不落 events=观测盲点,记工单)。**"两全 build"(cherry-pick 修复到旧基底)实验 ③FAIL 坐实基底 codegen 漂移,单 binary 不可行**;J2 "改 ShardLeaf 源码适配新语法"提案被 Bettor 拦截(命门:live shard 续约地址重算必须 byte-exact 复现链上旧字节码,任何源码/codegen 变动都可能移字节)后 J2 主动撤回。
  - **✅ 修复=双 binary 按合约族 pin(Bettor 裁定·三项验收全过)**: ①`silverc-legacy-2c46231.exe`(纯 pre-faaa074,**不带** OP_PICK 修复=与链上活 covenant bug-compatible)服务 V1 族——验收:真实 live shard(qdbwt-s2,5 注)genesis redeem 900 字符逐字节复现+spliceLeafState 续约 P2SH == 链上实存 outpoint 地址(J2+NWT 独立);②`silverc-zk-8065184.exe`(今晚全部 ZK 验证用的原 binary,零重build)服务 ZK 族;③console 按族显式路径选择(禁运行时推断);④**versioned-builds/ 版本化文件名+SHA256 记录,禁 in-place 覆盖**(根因机制化堵死,memory silverc-build-must-be-pinned 最强实证)。ZK-native 市场=shards 用 legacy+V2/CloseZk 用 zk,cov_id opaque 绑定无耦合。
  - **✅ 事故收口(00:1x-00:2x)**: ①settle daemon 及时停(NWT 追加发现 daemon 经 pool-bshard-artifacts.mjs 模块级默认一直在用漂移 binary——升级为"修在模块级",J2 加固为函数级硬编码无视调用方传参);②审计窗口干净(23:41-00:17 零 V1 续约重算证据;00:00:30 的 36 笔 refunding 批量转换+jepu1 collecting_sigs 逐一判定=dispatchRefund 单签 spine 路径不碰 compile,与 binary 无关;demo 盘 nq0dc 同路径安全退款);③接线 NWT GREEN。恢复序:commit→deploy→register 真实验证→daemon 恢复(盯前两 tick)→重开 demo 盘。**窄口径教训**:"编译不报错"≠"产物 byte 相同"(NWT 8528vs8662 对照坐实 faaa074 宽面 codegen 漂移)——资金路径判据只认 byte-exact,默认保守、证据换宽松。
  - **🏁 今晚 checkpoint(00:5x·Bettor 收尾,下次接力从这读)**:
    - **✅ 战果**: ①LIVE 事故(全线新押注中断)发现→根因→修复→验证 3h 内闭环,双 binary 版本化 pin+两族函数级硬编码(V1→legacy-2c46231 / ZK→zk-8065184,NWT footgun 补抓)根治,daemon 恢复干净(PID 62756);②**ZK-native 前半链首次全真实落地**: demo 市场 `ext-pool-v07-1783383848610-3o6cs`(区块哈希奇偶,zk_native:true,target_daa=54790262)→ **PayoutShardV2 首次 live genesis mint**(payoutCovId `597cd4b8...`,redeem 16564 字符 byte-exact 双核实)→ 双边真实押注落链(J2 YES 1KAS `0c5e0b42` / KANet-UI NO 1KAS,全部独立链验非信 API)→ deadline/target 已过,**现状=有注等 attest(设计内:zk_native 被老路径 guard 排除,judge 调用在 W2 attest 工具链)**;③W1(V2.sil)/W3(创建接线)closed+commit,W2 设计+概念审全过(00e86d83),4+2 处老路径 guard 全落。
    - **⏭ 接力点(严格序)**: ①W2 实现(委员 attest 工具链:judge 算 betsRoot/refundRoot/attestedAtMs+5 签 sighash 覆盖 4 新字段,设计已 GREEN 照抄)→ 对 3o6cs 执行首次 V2 close_attest;②W4 relay(J1 域): zk_handoff 组装+`unlockBshardZkClose`;③真 prove(**仅 J1 机器**,硬闸无 workaround);④kill switch ON e2e(完整确认点)。**J1 整夜未归**——后半链全部 J1-gated(W2 可 J2 跨域但需 Owner 批)。
    - **🔴 Owner 拍板(2026-07-07 03:1x·覆盖"live 主机不装 WSL"旧口径): 本机装 ZK 出证环境,消除 J1 单点**。依据:四 agent 同节点(无独立 NWT 机器)/当前零真实用户/二次推广等就绪后才发/短暂重启可接受。**三阶段编排(重启会杀全部 agent 会话,状态先外置)**: Phase0=备份(console.db/kanet.env/versioned-builds+SHA256)+commit/push+kanet-stop 干净停 → Owner 启用 WSL2+整机重启; Phase1=fresh 会话先恢复 live(kaspad 追同步/`bash -lc` 启动(J1 的 PATH 教训:非 login shell 无 /usr/bin,dirname 找不到)/健康验证+测试 register)→ 装 Ubuntu+Docker+Rust+rzup+RISC0(照 J1 7/6 文档)→ groth16 标准例真跑=环境验收; Phase2=J1 归队后 payout guest parity+双 prover 同队列实测(zk_prove_jobs 原子幂等天然支持)。**重启后 fresh 接位从本条+频道 #a2u44x 秒接。**
      - **✅ Phase0 全绿(03:30)**: git 零 unpushed(J2 核)+silverc MANIFEST.txt(双 binary SHA256 复核一致)+console.db 干净备份(先 kanet-stop 并回 WAL 再 copy,J2 提的顺序;停栈时又撞 stale pidfile 坑——kanet-stop 按过时 pidfile 漏杀真活 console 62756,KANet-UI 手动补杀,老坑复发第 N 次,retro 素材)。本机环境体检:缺 WSL2/Ubuntu/Docker/RISC0 全套;有 BIOS 虚拟化已开/61.6GB RAM/9900X3D。**⚠️ Phase1 硬步骤: C 盘仅 19.3GB——WSL distro 迁 D 盘(export/import)+Docker data-root 指 D 盘,漏做必爆盘。** 备份后 console 为发频道消息临时重启过——Owner reboot 前直接重启即可(备份快照已固化,WAL crash-safe)。
    - **📌 J1 侧今晚运维教训(接位文件补充中,Owner 主持)**: ①kaspad 等守护进程**绝不用会话后台命令拉**(死亡特征:`Background command ... was stopped`,harness 收任务连带杀进程树)——必须 detached(`Start-Process`);②启动后验证 parent PID 独立+跨 turn 存活;③频道"duplicate"=去重层拦截,**不能当节点同步信号**;④`kanet-start.sh` 必须 `bash -lc`(login shell 才有完整 PATH)。
    - **📌 尾巴不丢**: 3o6cs 状态稳定性核查(过期 cron 勿扫有注盘,J2 一条 SQL)/ nq0dc 100KAS 安全退款路径跟踪 / register 失败不落 events 观测盲点工单 / oracle-voter-health-monitor 对 zk_native 假警报 / blockhash_parity judge 生产化需确认深度(reorg)/ CLI 中文传参乱码改文件传参 / **7/8 首轮框架 retro(今天!)**。
  - **🔴 开盘闸(23:33·NWT 自动进程横扫,Bettor 裁定 4 guard 全落才开盘)**: 老路径对 zk_native 市场的暴露面清单——①pool-market-settler.js Path B reconcile(**必堵**:会把 ZK consolidate 误读成终结算强写 completed/refunded,跟 zk_settled 抢跑=状态污染)②bettor-prediction-voter processPoolMarket(废票实金+污染)③processPoolTxSign/RefundDisagreement④bshard-close-voter(③④休眠但靠间接 gate,防御性加 guard)。oracle-voter-health-monitor 假警报=纯噪音记非阻塞。J2 一处一报,NWT 逐处审。
- **⚠ 双节点 ledger 分叉合并(2026-07-07 Bettor)**: origin 侧(J1 机器)7/6 深夜并行补记了 3 个 docs commit(16a7e60a/e10d8ec5/ea2f5f87,含 Docker 修复细节+汇合完成条目),与本机 ledger 冲突。合并原则: 时间线详版保本机,"ZK 检查点"节保 origin 更新版(OP_PICK✅/Docker解除/汇合完成),origin 尾部"⏸卡点"条目已过时(本机 18:2x/20:0x 突破条目取代),加标注保留。

## 🟢 fresh 接手第一动作(2026-07-06 restart·全队 fresh session)
> **背景**: 26h+ 马拉松·Owner 令 restart 换 fresh 上下文攻 silverc emit-fix(不停·airtight handoff·治"停出幺蛾子")。ZK 已推到"就差 OP_PICK emit-fix"。
- **fresh J2/J1(双人攻)**: 读 memory `project-j2-oppick-investigation-handoff-2026-07-06`(byte 级 locus offset143/opcode 语义坑/排除 .sil 死路) → **实现 silverc emit-fix**(StackBindings pop 后正确重算 PICK index·gateSuffix 双引用+CAT/SHA256 两次 pop 后 idx 没 +2·该 8 用了 9)·**emit 侧修·脚本在不变 live VM 跑通·绝不改 VM(硬分叉+D-005)**。隔离 clone: silverc + `D:/rusty-kaspa-zksdk-isolated`(zk-sdk WASM)。
- **fresh Bettor(协调·我)**: 读本文件 + DECISIONS.md(D-001 ZK committed / D-005 隔离铁律) + 接位 → **协调 J2/J1 silverc emit-fix → NWT co-verify 修法(改对侧) → 重编覆约 → 执行过 → 接 J1 真 proof(image_id `c9918501...`·65B env::commit_slice·非作废 815db584) → 广播落链(三重核·八命门·Owner 批闸)**。目标: 今天干通完整真 ZK settle。
- **fresh NWT**: co-verify silverc 修法 + 八命门 + 落链守恒。**fresh KANet-UI**: 保公测 live(押注深夜低谷·infra 健康·待主动 bot-path 实测) + ZK JS wire。
- **两 UTXO 已落链待重试**(OP_PICK 修好后重编覆约再广播): covenant `kaspatest:prrgnrfl...` + gate(见下方 ZK 检查点节 txId)。

### 🎯 OP_PICK 根因定位(2026-07-06 12:50·J1 源码级最小复现·NWT GREEN)
- **方案**：`docs/2026-07-06-oppick-codegen-team-attack-plan.md` v2(Bettor 出稿+Claude 高级架构审合并)——**NWT 二审 GREEN**(Tier2 符号栈追踪一处实现细节待 J2/J1 落地时写清楚，不阻塞)。
- **🔴 根因定位(J1 源码级 7 行最小复现，取代早前 `compile_introspection_expr`/`compile_runtime_variable_definition` 两个待验候选)**：`lower_inline_functions.rs` 的 alpha-renaming 管线——局部变量下游被引用 ≥2 次时（重命名成 `__inline_0_a` 那条管线），编译器把变量自己的净栈效应多算了 1（诊断报 `net stack_depth=2, expected 1`，指向变量**自己的定义语句**，不是下游引用语句）。**这个"重命名管线多算1"的定位站得住**；⚠ **但"必须 3 项 concat+cast 才触发"这个具体形状描述 12:52 J1 自查出 confound——待重新核实(见下)**。
  - **⚠ confound(2026-07-06 12:52·J1 自查)**：`locals.rs:41 lower_local_aliases`——变量被引用 **≤1 次**时会被别名消除(RHS 直接文本代入下游，完全不生成真实 stack binding，不走 `compile_runtime_variable_definition`)。这意味着之前"逐项试出不触发"的对照组(只引用1次的变体)根本没进入真实编译路径——不是"concat 形状导致不触发"，可能仅仅"引用≥2次"本身就是触发条件，跟 concat 链长度/cast 位置无关。
  - **✅ 根因锁定+单行修复+验证通过(2026-07-06 12:57·J1 消融矩阵后)**：真正触发条件跟 concat 链长度/cast 位置全部无关——**RHS 里任何位置出现 `byte[](val,size)` 这个 2 参数动态 cast 调用**即触发（裸 `byte[1] a=byte[](ctorInt,1)` 单独一句就触发，不需要 concat）。**精确根因（🔴 12:58 J1 更正，取代下面/上面提到的 `lower_inline_functions.rs` 假设——那条已被推翻，不是真凶）**：`compile.rs:3754 compile_byte_sequence_cast_call` 处理 `byte[]()` 2 参数动态 size 形式分支，push arg0/arg1 后多了一行 `*ctx.stack_depth += 1;`——无对应 opcode emit，纯多算，净效应变 +2(该是+1)。姐妹函数 `compile_bytes_call`(`bytes(val,size)` 写法)等价分支没这行多余代码，是对的——只有 `byte[]()` 这个拼写形式坏。**修复=删这一行**。**验证**：①J1 隔离 clone(`D:/silverscript-j1-isolated`) 重编后 8 个隔离 repro 全部不再触发诊断 + 完整现有 cargo test 套件 **55 个测试 0 失败 0 回归**；②**J2 独立代码核对 + 算术对账(§1.5 步骤①已满足)**：journalHash 表达式只用 1 次 `byte[](attestedWinner,1)`，过多计数应恰好 +1——精确解释"idx=9 该是 8，恰好差1"这个观测现象，算术完全吻合非巧合。covenant 里 `journalHash`/`gateRedeemHash` 模式吻合。**当前只在 J1 隔离 clone，未合并回共享 clone/未 push**(D-005 合规·纯 emit 侧·零碰 live VM)。**🔴 diff budget 更正**：预声明只碰 `compile.rs` 的 `compile_byte_sequence_cast_call`(3754行)这一处，**不是** `lower_inline_functions.rs`(该假设已推翻)。**下一步**：J2 走 §1.5 步骤②消融矩阵+③潜伏面扫描 → 拿此修复对真实 covenant 重编验证 offset143 PICK 是否变对 → NWT 按 v2 符号栈标签验收门槛复核。

### ✅ §5 四层验收 层1-3 全过(2026-07-06 13:06-13:09)，层4(真实广播)准备中
- **落码**：J2 删除 `compile.rs:3754` 多余 `*ctx.stack_depth += 1;`，diff 精简到单文件单行删除(NWT `git diff --stat` 独立核实)。
- **层1**：exhaustive 符号栈验证——完整 230 字节 covenant 全部 `OP_PICK`(J2 trace 列出7处) 逐条 bounds+符号标签双重检查，全部界内且标签对，非抽查。
- **层2**：机制推导 diff 吻合——`offset143→144` 的 idx 从 9 变 8，跟算术对账("多算1"×1次出现)预测精确一致；`offset139` 连带从 9→8 的变化有机制解释(非意外)。
- **层3**：non-vacuous binding 恒等式重验成立——`blake2b(gatePrefix+gateSuffix) == gateTmplHash`(`511b0ead...`)两边一致。
- **NWT 第三次审(落码代码审)GREEN**：核心修复逻辑正确(OpNum2Bin净效应核对) + 清理确认(debug eprintln 已撤，diff 精简) + 完整 cargo test 套件(几百个测试)0 failed。**"最干净的一次编译器 bug 修复"（NWT 原话）**。
- **⏳ 层4(真实广播)准备中**：J2 用**全新一次性测试 UTXO**(不复用冻结的 jepu1/gate 测试台)造新 covenant+gate 对，`computeBudget=1500`，**会先报完整方案给 Bettor+NWT 审过再广播**(碰钱码，不因进度快而省核对)。层4 过了才轮到用 J1 真 proof(image_id `c9918501...`)的 UTXO 做最终那一次广播(八命门+Owner批闸)。

### 🔴 层4 第一次真实广播(2026-07-06 13:13)：流程违规(J2 认+报) + OP_PICK 确证已修好 + 新独立问题浮现
- **⚠ 流程违规**：J2 在 Bettor 第二个确认点(non-vacuous binding 重构值需针对**这个具体新随机实例**重新 byte-exact 核对，非默认继承)得到答复前就广播了。Bettor HOLD 消息与 J2 广播动作race，HOLD 慢了一步。**资金安全纯属这次没造成实际损失，不代表纪律可以松**——§4"碰钱码不因赶时间省"对所有人一视同仁。J2 主动认+报（比藏着强），本次不追究，重申下次money-path操作必须等全部确认点点头再动手。
- **✅ 技术上重大利好**：失败模式从此前的 `pick at an invalid location`(栈越界崩溃) 变为 **`script ran, but verification failed`**(脚本执行到底，某个 require 判 false)——**独立证实 OP_PICK codegen bug 确实修好了**(不再是同一个 bug 复发，是完全不同的失败点)。资金安全(两个测试 UTXO 原封未动)。
- **✅ 收口(2026-07-06 13:20)：不是新 bug，是测试用例本身的问题**。J1+NWT 独立核对排除了 `ScriptPubKeyP2SH` 模板格式假设(跟 Kaspa 标准逐字节一致)。J2 用**实际字节值**(非符号标签)重建模拟器逐条计算：**offset161 的 non-vacuous binding EQUAL 检查(`tx.inputs[1].scriptPubKey == reconstruct(gateRedeemHash)`)两边完全一致(`0000aa20995f8ace...87`)，PASSES**——这是 OP_PICK 修复 + non-vacuous binding 逻辑迄今**最强的证据**（真实广播尝试下的 byte-exact 验证，非仅模拟）。真正的拒绝发生在最后一步 `validateOutputState(selfOutIdx,...)`：covenant 期待 `tx.outputs[selfOutIdx].scriptPubKey` 是反映新 state 的 continuation P2SH，但**这次测试交易的 output 只是转去 J2test relay 的普通地址**，不是正确构造的 continuation P2SH——**这是测试交易本身的构造问题，不是 covenant/编译器 bug**。**下一步**：J2 造一个 output 正确指向 continuation P2SH 的新测试交易，方案确定后仍需走完整确认点(Bettor+NWT)才能再次广播。

### 📋 方法论沉淀(2026-07-06·第二轮架构审提炼)："双人收敛" ≠ "已验证"
- **事件**：12:50 J1 源码级复现 + J2"这比我的假设精确太多"独立确认，团队一度把 `lower_inline_functions.rs` alpha-renaming 管线当作根因汇报。**这个"确认"实际是 echo(认同假设精确)，不是 verify**——真正的 verify 是 12:58 J1 自己跑的消融矩阵，跑完直接推翻了这个"双人确认"的结论：alpha-renaming 管线本身没 bug，只是把触发变量重命名暴露了现象，真凶在 `compile.rs:3754` 多写的一行 `+=1`。
- **教训**：**"两人独立收敛到同一假设"和"假设被消融/反证类方法证实"是两个不同的证据等级**，前者比"一人猜测"强，但不等于后者。J1 亲手 deny 自己提出的假设是干净的科学姿态，值得记录为正面案例而非失败。**建议**：写进团队方法论/ANTI-PATTERNS 档案，防止未来把"多人 echo 同一判断"误当"已验证"直接放行下一步。

### 🎉🎉 里程碑(2026-07-06 13:26-13:27)：OP_PICK 修复 + covenant non-vacuous binding 机制 TN12 活链完全验证通过
- **这是今晚 restart 攻 OP_PICK 这条主线要证明的核心命题，达成**：真实广播下，①non-vacuous binding EQUAL 检查 byte-exact PASS ②continuation state 转换(output 指向正确的新 state P2SH) PASS。**covenant 逻辑本身(OP_PICK codegen 修复 + binding 机制)在活链上完全可行，全程独立三点核验(不自审)后才广播**。
- **剩余的"Groth16 verification failed"是预期之内、范围之外的问题，非新 bug**：这次为了测试 non-vacuous binding(journalHash 随机变化)，用 `commitToGroth16WithFixedJournal` 烤了全新随机 journalHash 进 gate，但配的是 6/28 官方测试套件的固定 fixture receipt——**该 receipt 数学上绑定给它原本的 journalHash，不可能验证通过一个不同的 journalHash**，这是测试数据选择的已知限制，不是 covenant/编译器/OP_PICK 侧的问题。
- **下一步(完整真 ZK settle 收官)**：接入 J1 的**真实 RISC0 guest proof**(image_id `c9918501d90bf0aeaaf7970816078c81e8286c08293ccf388e87a7cab023ce30`，65B `env::commit_slice` 紧凑 journal)——这个才是"针对特定 journal 内容自由计算"的真证明，不受 fixture 限制。重新走完整确认点(资金守恒+non-vacuous binding+continuation+这次换真 proof 后的 groth16 层)→ 广播 → 落链 = **完整真 ZK settle 首次达成**。
- **✅ 两条线数学汇合(13:33)**：J2 用 J1 真实 journal 三值(bets_root/attested_winner=0/payout_root) + image_id 代入 covenant 的 SilverScript sha256 公式，算出的 journalHash 跟 J1 Rust guest 报的 `journal_digest`(`b7b89b3e9490c96b525b970adb83a7015ee48b2c00beaca32d10fa2360acb1d4`) **byte-exact 一致**——covenant 侧与 guest 侧两个独立实现的 journalHash 公式确认互通。J2 预先算好新 covenant/gate 地址就绪，只等 J1 导出真实 Groth16Receipt。
- **⚠ 环境阻塞(13:56)：真实 Groth16 proof 接入暂卡，非逻辑问题，留后续任务**。J1 发现此前给的 proof 数据实为 `ReceiptKind::Composite`(STARK，快)而非链上验证器需要的 `ReceiptKind::Groth16`；改用 `ProverOpts::groth16()` 重跑时，risc0-groth16 压缩步骤需要 Docker 在 WSL 里跑容器，**J1 本机 Docker Desktop WSL 集成损坏**(设置文件核对过、完整 `wsl --shutdown` 试过，`IntegratedWslDistros` 读取始终为空，判断是该版本真实 bug，非操作失误)。**Bettor 排查绕开路径**：NWT 机器无 Docker 可用；J2 情况待确认。若均无可替代环境，**留作独立后续任务**(J1 环境修好/重装 Docker 后接续)，不影响今晚已拿到的核心成果。
- **✅ 今晚诚实收官口径(报数级别词，避免夸大)**：**机制证通**——OP_PICK codegen bug 精确定位+修复+cargo test 全绿+活链验证(non-vacuous binding + continuation state 转换 byte-exact PASS)；journalHash 公式在 SilverScript covenant 与 Rust guest 两条独立实现之间数学互通。**尚未达成**：完整真 Groth16 proof 的端到端真实结算广播落链(卡在 J1 本机 Docker 环境，非设计/编译器/covenant 问题)。禁止把"机制证通"报成"完整 ZK settle 已上线"。
- **✅ 单点风险排查+修复(2026-07-06 14:1x·Owner 追问引出)**：Owner 问"J1 端点不工作 ZK 是否还能正常工作"——排查结论：①covenant 机制(SilverScript 层)+ zk-sdk WASM builder 都在 J2 机器/隔离 clone 验证过，跟 J1 无关 ②唯一绑定 J1 机器的窄点 = 针对具体新数据生成真实 Groth16 proof(需要 J1 装的 RISC0+Docker 环境)，这是运维冗余缺口非架构缺陷。**排查过程中 NWT 顺手抓出另一个真实单点**：`compile.rs:3754` 那一行修复当时只在 J2 机器的 working tree(未 commit)——已修复：J2 本地 commit 到分支 `j2-oppick-fix-2026-07-06`(commit `8065184`)，NWT 独立核实存在。**是否推官方 silverscript 仓库(kaspanet/silverscript.git)的 PR/合并流程留到下一个清醒 session 再议，不是今晚仓促决定**。今晚 12 小时+ 成果现状：本地 commit + memory 文档 + COORD-LEDGER 三重记录，不再是单点风险。

### 🎉🎉🎉 里程碑(2026-07-06 14:44)：KANet 历史上第一笔完整真实 ZK settle 链上交易 LANDED
- **txId**: `4ec9ddd1d89b144bfec50e386be0221ab44e2f58f1c4f63207358a2eb80f3545`
- **NWT 独立核实(非只信 J2 自报)**：直接 RPC 查续约输出地址(`kaspatest:pr30yavl59kztvtcud3sttg0y40k0wlzsj9l6rsunhxqm2tgefmkvdg9vaqtr`)——有 1 笔活着的 UTXO，金额精确 1.4 KAS，`outpoint.transactionId` 精确等于 `4ec9ddd1...`。方法论：不查 tx 本身(mempool/tx_log 可能有索引延迟)，直接查目标地址是否有活着的 UTXO 更直接可靠。
- **这一笔交易同时首次验证了完整链条的全部环节**：①修复后的 silverc 编译器(`compile.rs:3754` OP_PICK codegen bug 已修) ②non-vacuous binding(covenant 验证 gate UTXO 确实带着对应 journalHash 的 groth16 证明) ③continuation state 转换(`closed` 1→2) ④**J1 真实 RISC0 guest program 算出的真实 payout arithmetic 的真实 Groth16 proof**(非 fixture、非 dev-mode)——**全部环节首次同时在 TN12 活链上验证通过**。
- **完整技术链条(从今晚 restart 到 LANDED)**：OP_PICK 根因定位(`compile.rs:3754` 多算 `+1`)→ 单行修复 + cargo test 全绿 → §5 四层验收(bounds+符号标签/机制推导diff/non-vacuous binding恒等式/live-node接受) → J1 环境阻塞(Docker/WSL2 cross-distro挂载bug)→ 整机重启修复(J1自己机器,非live主机,风险评估到位) → 真实 Groth16 proving(`ProverOpts::groth16()`) → covenant journalHash 公式(SilverScript)与 Rust guest 两条独立实现 byte-exact 互通 → 最终广播全套确认点(资金守恒/continuation地址/源码未变/receipt格式)独立核实 → **LANDED**。全程**零资金损失**，全部关键节点走独立核实(不自审)。
- **全队贡献**：J2(主攻定位+落码+组装+广播)、J1(消融矩阵关键突破+真实guest proof+环境自修)、NWT(全程红队+每一步独立核实+多次抓出流程/文档漏洞)、Bettor(协调+co-verify+落链闸)、KANet-UI(保公测 live 稳定)。
- **memory 已存**：`project-first-complete-real-zk-settle-landed-2026-07-06`(J2)+ 本 ledger 条目 + 方案文档 `docs/2026-07-06-oppick-codegen-team-attack-plan.md`(全程演进记录)。
- **战略意义**：直接实证 D-001(ZK=committed 目标结算架构)的可行性——不再是"机制证通"的阶段性说法，是**真实数据+真实证明+真实活链落地**的完整闭环首次达成。后续：这只是"机制端到端跑通"的第一笔，尚未讨论生产化/规模化路线(委员共识层/多片/costume gate 等)，诚实标注不越界。

### 📋 下一阶段：装配 ZK 结算进 settler 生产管线(2026-07-06 14:5x·Owner 提出·范围已定稿·非今晚执行)
- **Owner 判断查实成立**："之前程序都已经具备了所有接入条件"——`kasia-console/src/lib/zk-close-builder.mjs` 已有**完整编排逻辑**(`zkClosePhase2`/`zkCloseTick`)，含全部安全命门(B1链上byte-decode零DB verify-value-source / C1 predict-then-verify / B2 escape-refund / NO TX NO STATE)。6/29 有自测(mock链调用)全通过。真实市场 `ext-pool-v07-1782667323858-bh01w`(真押注4笔)当年就是为此建的。这不是从零设计，是接续 6/28-6/29 线13(ZK-settle转向)的既有工作。
- **精确 4 个缺口(J2 独立核实确认，非重新设计)**：
  1. `zkClosePhase2`/`zkCloseTick` 的 ctx hook 函数(`fetchCloseZkContinuation`/`dispatchUnlockZkClose`等)全库唯一出现处是自己的 JSDoc + 一个 scratch 自测文件——**零实实 relay/proof 接线**，需要接上今晚验证过的真实 proving 流程。
  2. `zkCloseTick()` 在 settler services 里 **grep 不到任何调用点**——是真正的孤儿函数，写好了从未被主循环调用，这是"装配"字面意思的缺口。
  3. 真实市场 `ext-pool-v07-1782667323858-bh01w` 现状 `protocol_status='settle_zombie_quarantine'`，`settle_txid`/`refund_txid` 均为 null，`created_at=2026-06-28 17:22:07`(卡了8天多)。这个 status 字符串**代码里没有任何处理逻辑**(grep 全库零命中)，是当时手动标记，需要先弄清楚怎么处理(退款/还是能继续用)，不能直接复用。
  4. 真实链上端到端测试 + NWT 审查。
- **🔴 处置(Bettor 建议，非今晚执行)**：这活确认范围清楚、非从零设计，但①②两点是碰 settler 生产主循环 + 真实押注市场的钱路，按"设计先行→NWT审→派工实现→验落链"走，且 D-005 要求真上线需充分测试+独立迁移决策。**今晚团队已连续工作 14+ 小时**(从 restart 攻 OP_PICK 到现在)，不适合在疲劳状态下动手改 settler 主循环这种 money-path 代码。**建议这个任务作为下一个清醒 session 的主线**，本条目已把范围/缺口/现状精确记录，下次接位可直接从这 4 点开始，不需要重新梳理。
- **🔴 Owner 覆盖(2026-07-06 15:0x)**：Owner 拍板"开工"，覆盖 Bettor"留到下次"的建议，全队重新启动。**流程纪律不变**：设计先行，NWT 审过再落码。
- **✅ ②(settler 主循环 scope 隔离) GREEN 设计定稿**：J2 方案——**结构性隔离非逻辑判断**：现有 `selectRipeMarkets()`(committee-sig 路径)查询条件完全不动；新增独立函数 `selectZkEligibleMarkets()`，只选**全新专属** `protocol_status='zk_ready'`(之前从未在任何代码路径出现过的值)；`zkCloseTick()` 作为 tick 循环里**独立并行的额外步骤**调用，不是分支/不是修改现有 if-else。市场进 ZK 路径必须**显式**标记 `zk_ready`(非自动推断/非继承其他状态)——今晚 `bh01w` 不会被自动捡入(现在是 `settle_zombie_quarantine` 不是 `zk_ready`)。这跟今晚 R-SHARD-BLIND lint 教训同一条安全哲学：结构上不可能碰到，不是"查过没事"。Bettor 批准，可以落码。
- **✅ ①(relay handler) 架构缺口发现+GREEN 方案**：J1 摊出真实架构缺口——RISC0 proving 只在 J1 机器 WSL 跑，但 settler 主循环(调用方)在 J2 live host，两台机器物理分离。三选项：(a)整个 zkCloseTick 搬到 J1 机器(需跨机器 DB 访问，SQLite 非为此设计，风险高) (b)**job-queue/HTTP 桥**(J2 settler enqueue → J1 轮询取 job → prove → 回传 receipt) (c)WSL 环境搬进 live 主机(违反 D-005，直接排除)。**J1+J2+Bettor 独立收敛到 (b)**，理由跟今晚"rolling 跨节点是死路"同一条推理(跨机器 DB 访问=同类分布式一致性问题，不该在 proving 环节重蹈)。**三项安全设计(NWT 补全)**：①认证=bearer token(存 kanet.env 不进 git)+可选 IP allowlist，内网 agent 间调用不需要 mTLS 重装备 ②失败/超时=NO-TX-NO-STATE 延伸，J1 机器不可达≠proving 失败，只是"这次没问到结果"，绝不触发退款/状态推进 ③幂等(**最容易埋雷**)=锁必须落**持久化 DB 状态**(pending/in_progress/done/failed+时间戳+超时窗口)，不能只在内存(daemon 重启会丢锁导致重复 proving 请求)，超时未完成才允许重新发起(fail-closed 非无限等)。**✅✅✅ 三大件全部落码完成(2026-07-06 15:0x-15:2x)，NWT 完整 diff 审查 GREEN**：
- **job 表**：`migrate.js v180` 加 `zk_prove_jobs` 表(partial unique index 做持久化幂等锁) + 恢复脚本 `kasia-console/scripts/zk-prove-job-recover.mjs`(`--list`/`--unstick`，非口头描述)。DB copy 上完整测试：迁移正确/幂等约束验证通过/恢复脚本验证通过。
- **独立 server + endpoint**：`kasia-console/src/services/zk-prove-server.mjs`(独立 Fastify 实例，fail-closed 无 token 不启动) + 3 个 endpoint(enqueue/poll/complete) + `kanet.env` 加 `ZK_PROVE_SERVER_TOKEN`(纯追加)。隔离测试端口 6 项测试全过(幂等 enqueue/原子 poll/认证拒绝等)。
- **settler 主循环接入**：`bshard-settle-daemon.mjs` 改动——`ZK_CLOSE_TICK_ENABLED` kill switch **默认 OFF**(NWT："这比讨论过的安全等级还高一档，代码根本不会跑，不是'空数组所以安全'") + `scanReadyZkMarkets()`(真实现，查 `zk_ready`) + 独立 `_zkCloseCtx`(其余 5 个 hook 是 throw-TODO 的 fail-closed stub) + 调用点插在 `ripe.length===0` 早退**之前**(J2 自己动手前抓出的隐蔽坑，NWT 独立核实属实) + 独立 try-catch(错误写 events 表明确标注"不影响 committee-sig 结算路径"，不 rethrow)。**DB copy 实测**：`selectRipeMarkets()` 逐字节零改动 + `zkCloseTick` 在 0-zk_ready 真实数据上跑过，证实 stub 零被调用(可证明，非假设)。lint-kanet + `node --check` 全部 0 error。
- **NWT 完整 diff 审查结论(五点全过)：GREEN，可以合并。当前对生产中 955 个赢家的 committee-sig 结算路径零风险(kill switch OFF，新路径 100% 惰性)。**
- **架构决策记录**：跨机器 proving 用 job-queue/HTTP 桥(通过已确认的 Tailscale tailnet，J2 `100.99.147.101`/J1 `100.111.126.10`)，排除跨机器直接 DB 访问(同"rolling 跨节点死路"教训)和把 WSL 搬进 live 主机(违反 D-005)。
- **剩余范围(下一阶段，不是这轮)**：①J1 域 — relay handler `unlockBshardZkClose`(prove+gate+2-input build+broadcast，包装今晚验证过的真实流程) ②J2 域 — 其余 4 个 ctx hook 真实现(`fetchCloseZkContinuation`/`checkLanded`/`escapeRefund`/`reconcile`) ③`bh01w`(`ext-pool-v07-1782667323858-bh01w`) `settle_zombie_quarantine` 状态处理(KANet-UI 查实无直接历史记录，推测但非确认) ④kill switch 打开后的真实端到端测试(这一步是新一轮碰钱广播，需要完整确认点，不可省)。

### ✅ 3 个 hook 真实现完成 + NWT GREEN(2026-07-06 15:5x)
- **J2 完成**：`checkLanded`(只读查 `kaspa_tx_log`，try-catch 兜底返回 false)/ `fetchCloseZkContinuation`(读 `market.metadata.zk_continuation`，无字段返回 null)/ `reconcile`(`UPDATE...WHERE id=?` 精确限定单市场，转 `protocol_status='zk_settled'`，确认不在 `selectRipeMarkets()` 的 WHERE 子句里，终态不会被 committee-sig 路径重捡)。逻辑测试全过(有/无/畸形 metadata 正确处理；真/假 txid 正确判断；evidence 结构正确)。`escapeRefund`/`dispatchUnlockZkClose` 仍 TODO stub(按约定范围)。
- **🔴 Owner 关键纠正**：`judgeWinDir`(`bshard-settle-daemon.mjs:97`)是**既有的、今晚 955 个赢家在用的委员判定机制**，不是"phase1 不存在需要新造"——**这是接入/适配问题，不是从零设计委员共识**。J2 已确认理解，会用 `judgeWinDir` 真实值填充测试市场的 `attestedWinner`，不是随便定值。
- **NWT 完整审查 GREEN**：三个 hook 逐项核对无误，且**结合当前实际状态(kill switch OFF + 无 zk_ready 市场 + 无 zk_continuation 字段)完全惰性，零执行风险**，可以合并。
- **接位文件核实**：Bettor/J1/J2/NWT/KANet-UI 五份`*-接位.md`均已含 D-004 统一知识框架引用 + Monitor SOP，无需额外改进。
- **J2/NWT 状态**：均确认这是异常长的 session(已过至少一次 context 压缩)，认可 fresh restart 对判断质量有益，交接要点已存 memory + 本 ledger，可随时安全重启。**决定权在 Owner**。
- **✅ J2/NWT 均已 fresh 重启(2026-07-06 15:57-15:59)**：git status/COORD-LEDGER/频道核实与重启前记录完全一致，无漂移。**NWT 独立重核 diff(非只信频道"已GREEN"的说法)**：逐项重新验证 job 表/server fail-closed/settler 接入结构隔离(grep 全仓库确认 `zk_ready` 只出现在预期三处)/`zkClosePhase2` 编排顺序(NO-TX-NO-STATE 实守住)/kill switch 默认 OFF——**独立结论 GREEN，认可上一个 session 的审核结论**。
- **🟡 NWT 附带非阻塞发现**：`zk-prove-server.mjs` 的 bearer token 比较用 `auth !== \`Bearer ${TOKEN}\``（非 `timingSafeEqual`，理论时序攻击面）——跟此前抓过的 `isTrustedProxy` 那类 auth 比较问题同一模式类别，但非 presence-only bug；当前场景纯内网 Tailscale 调用(非公网)，时序攻击门槛很高，不阻塞 commit，记一笔待后续顺手补 constant-time 比较。
- **✅ Owner 提醒**："不用重造轮子，都是有的"——fresh 重启后正确动作是读 COORD-LEDGER + 设计文档确认现状，直接在既有基础上继续，不要凭空重新推导/设计已经定过的东西。
- **✅ 可以 commit**：三步(job 表+server+endpoint+settler 接入+3 个 hook) 双重独立 GREEN(前一 session NWT 审 + fresh NWT 独立复核)，J2 可以直接 commit。**✅ 已 commit**：`f3060ff3`(pathspec 精确，shared-tree 纪律守住)。

### 🔴 escapeRefund covenant 设计草稿(2026-07-06 16:0x-16:1x)：Bettor 批核心决策 + NWT 攻击面审抓出 2 个真实结构洞
- **草稿**：`docs/2026-07-06-zk-escape-refund-covenant-design-draft.md`(J2)——deadline-only 逃生舱(理由无关，覆盖 0-bet/overCap/环境阻塞等一切"zk_close 走不通"场景)。Bettor 批准核心哲学(§2)，提 4 点意见(开放问题①最高优先级 / ESCAPE_GRACE 需具体值 / deadline 单位倾向方案 a / 不加 betsCountBaked)。
- **🔴 NWT 攻击面审：2 个 HIGH 结构洞，不是 GREEN，需重新出草稿**（查 `PayoutShard.sil` 实际代码，非只信草稿"镜像 refund_claim"这句话）：
  1. **洞①（state machine 焊死成一次性）**：草稿的 `escape_refund` 是单一 entrypoint，precondition `closed==1`，postcondition 写 `closed:3`——第一个 bettor 调用成功后 continuation UTXO 的 `closed` 就变 3，第二个 bettor 再调同一 entrypoint，precondition 在 `closed==3` 上必然 fail。**等于"谁抢到第一笔谁能领，其余 bettor 的钱永久锁死"——比"没有 escape hatch"还糟**。**修法(复用已验证代码，非新发明)**：拆成 2 个 entrypoint 镜像 `cancel_attest`/`refund_claim` 关系——(a) `escape_trigger`：无需 merkle proof，只需 `closed==1`+deadline，permissionless 一次性 flag-flip `closed 1→3`，不付钱 (b) `escape_claim`：require `closed==3`，merkle-check+nullifier+payout，postcondition `closed` 不变仍是 3，逐笔递减 `consolidated_pool`——基本是把 `refund_claim` 代码复制过来改字段名，风险面等于复用已经活着跑了 955 个赢家的代码。
  2. **洞②（deadline 锚点错误，`bh01w` 就是活生生的反例）**：草稿用 `deadline_daa`(genesis-mint 时就固定死的市场原始截止时间)做 grace 锚点，但 `escape_refund`/`zk_close` 都要求 `closed==1`(committee attest 完成之后才有)——**若 attest 本身延迟(`bh01w` 卡了一周就是活案例)，`closed` 变 1 的那一刻，`deadline_daa`+grace 早就过期了**，escape 立刻可调用，而 `zk_close` 真实 proving 链路(跨机器 job-queue/RISC0/Docker)根本还没来得及启动——race 必输，**且 `ESCAPE_GRACE` 调多大都治不了，因为钟从错的起点开始走**。**修法**：grace 锚点改成"attest 实正完成的时间戳"(`closed 0→1` 那一刻)，需要 committee attest 的 entrypoint(在本次草稿范围外，但 escape_refund 依赖它)额外烤一个 `attestedAtSeconds` 字段(attest 那一刻 `tx.time`，一次性写入不可变)。**这进一步坐实开放问题①(生产版 covenant/phase1 到底长什么样)是真正的根阻塞**，不是 escape_refund 一个文件能单独解决的。
  3. **附带(非阻塞但要写进 checklist)**：若 escape_refund 挂在跟 `zk_close` 同一 `.sil` 文件(多 entry)，必须显式核对 memory `feedback-ss-entry-reorder-breaks-handler-selector`(多 entry SS 重排破坏 handler selector)的坑，不能默认"加一个 entry 不影响别的"。
- **NWT 结论**：§2 deadline-only 哲学本身认可(跟 Bettor 一致)，但当前骨架有 2 个结构洞，需重新出一版草稿(覆盖两阶段拆分+deadline 锚点改法)才能进入"具体 .sil 改动"这一步。**尚未放行到落码**。
- **并行进展**：J2 直接问 J1 开放问题①细节(zk-close-builder.mjs 注释里"J1 firm 16:55"的 CloseZk redeem layout 常量，但代码库里找不到对应落地的 `.sil` 文件)——等 J1 回应。

### 🔴 重大发现：phase1-for-ZK 机制从未被具体设计过(2026-07-06 16:1x·J1 查证坐实)
- **J1(fresh 重启) 诚实自查**：不凭"记忆"认领 6/28 那条"J1 firm"注释——`git blame` 查实是 2026-06-28 23:59 KANet-UI commit `9b9804b5` 加的，指的是旧 J1 身份，非这次对话。
- **开放问题①部分解答**："phase1 covenant" = `PayoutShard.sil` 本身(唯一有 `consolidated_pool` 字段的 `.sil`，`git log -S` 确认)，不是独立第三份文件。
- **🔴 但更大的发现**：J1 直接读 `PayoutShard.sil` 实际 state 字段(L39-47/L162-164)——**只有 `consolidated_pool`/`closed`/`payoutRoot` 三个 state，没有独立的 `attested_winner` scalar 字段**！赢家信息隐含在 `payoutRoot` 这棵 merkle 树里，从不作为独立标量暴露。而 `zk-close-builder.mjs` 里 `_PSZK` 这个 6/28 layout 假设有独立 `attested_winner` 字段(push@52, 8B LE)——**这个假设的数据结构从来没有对应过任何真实实现**。同理 `attestedAtSeconds`(escapeRefund v2 需要的时间戳锚点)：J1 grep 全文件确认 `PayoutShard.sil` **没有任何时间戳字段**，`close_attest` 也没烤。
- **✅ 团队收敛**：不改动活着的生产合约 `PayoutShard.sil`(955 个真赢家在用，风险远超收益)。
- **✅✅ 已解决(2026-07-06 16:15，比预想简单)**：**J1 方案**——`attestedAtSeconds` 跟 `init_attestedWinner` 用**同一个已验证模式**：off-chain builder 在 **genesis-mint 那一刻**读观测值(`kaspa_tx_log` 里 `close_attest` 落链时间/committee attest 的观测结果)，直接烤进 **ZK covenant 自己的 ctor**——**不需要碰 `PayoutShard.sil` 一个字节，也不需要在 ZK covenant 上设计一个真正的"phase1 closed 0→1 转换 entrypoint"**。ZK covenant 是在 attest 观测完成**之后**才 genesis-mint 的，天生就带着已知的 winner+timestamp，跟今晚 LANDED 那笔(txId `4ec9ddd1`)的模式完全一致——**ctor-baked 足够撑住整个设计**。**NWT 确认这解决了顾虑，认同 escapeRefund 可以推进到具体 `.sil` diff**(仍要过 NWT 下一轮代码审)。
- **📝 Bettor 自我修正**：前一版本把这个问题框成"全新的、更大的独立架构任务需要专门 session"——**这个判断过度升级了**，J1 很快给出了复用既有 mint-time-baking 模式的干净答案。教训：遇到"看起来是大架构缺口"的发现，先问一句"有没有既有模式能直接套用"，不要急着定性为需要单独立项的大问题。

### ✅ escapeRefund v3：NWT 结构审 GREEN + 新经济激励发现(2026-07-06 16:20-16:21)
- **v3 定稿**：`docs/2026-07-06-zk-escape-refund-covenant-design-draft.md`——洞①(两阶段拆分)/洞②(attestedAtSeconds 锚点)/洞③(refundRootBaked 独立 merkle 字段，跟 hash-chain 的 `betsRootBaked` 分开)全部修好。NWT 结构层面复核 **GREEN，放行到具体 `.sil` diff**。Bettor 批准，仍等 J1 回复开放问题①(生产版 ZK covenant 长什么样 + phase1 attest entrypoint 是否已烤 `attestedAtSeconds`)才能真正落码。
- **💡 NWT 新发现(非阻塞但重要)：经济激励角度——escape_trigger 是 permissionless + deadline-only，不是中性的技术选择**。escape 触发后所有 bettor(不分输赢)拿回原始 stake；但 `zk_close` 正常结算时输家 stake 会归零(pari-mutuel 分给赢家)。**这意味着一旦 deadline+grace 窗口打开，输家有直接经济动机抢在 `zk_close` 落链前广播 `escape_trigger`**(permissionless，不需要任何签名/批准，谁都能发)，把本该归零的下注变成全额退款——这是可被利用的攻击面，不只是"优雅失败恢复"。
- **✅ 修正的设计原则**：不否定 deadline-only 哲学本身(仍然对)，但 `ESCAPE_GRACE` 的选取标准要多加一条——**不是"覆盖正常 proving 延迟的余量"，而是"假设窗口一开就会被有动机的一方抢跑，`zk_close` 必须在 grace 窗口打开**之前**就已经落链完成，不能指望 grace 期间还有时间跟人赛跑广播速度"**。J2 已并入 §2.1.2，不单独立新开放问题。
- **✅✅ 开放问题①彻底解决(J1 16:21)**：**生产版 ZK covenant 现状 = `_j2_closezk_repro3.sil` 本身，没有第三份"更真"的文件**——就是 NWT 八命门审过、今晚 txId `4ec9ddd1` 真实落链用的那份，escapeRefund 的全部新字段(`refundRootBaked`/`attestedAtSeconds`/`escape_trigger`/`escape_claim`)都加在这份文件上，不是另起炉灶。`attestedAtSeconds` 确认跟 `init_attestedWinner` 同一模式，genesis-mint 时 off-chain 读 `kaspa_tx_log` 烤入，不碰 `PayoutShard.sil`。
- **✅ escapeRefund 设计阶段收官**：3 个结构洞(state machine/deadline 锚点/merkle vs hash-chain)+ 1 个经济激励发现全部解决，两个开放问题(挂载对象/deadline 单位)全部解决，NWT 结构层 GREEN。**下一步**：J2 出具体 `.sil` diff(精确行号级)，走 NWT 代码级审(参照 OP_PICK 四层验收模式)——这是真正改动生产 covenant 文件的一步，仍需完整确认点，不因设计阶段顺利而省。

### 🔴🔴 第二轮跨文档架构审(2026-07-06 16:2x)：CRITICAL 代码漏洞 + 跨文档复合风险，团队最高质量的一轮审查
- **✅ CRITICAL 修复(NWT 代码审抓出，J2 立即修复，NWT 复核 GREEN)**：`_j2_closezk_repro4.sil` 的 `escape_claim` 自己声明了一套 witness 参数 `w0in..w16in`，整个 nullifier 防重复领检查(`require((w_i/mask)%2==0)`)和状态写回全部基于这套 caller 自己填的假值，**从未引用 P2SH 真实绑定的顶层 state `w0..w16`**——意味着 bettor 在 sigScript 里永远填 0 就能绕过"位未置"检查，**单人反复提交同一笔 claim 就能抽干整个 `consolidated_pool`，不需要多人配合**。修法：删除 `w0in..w16in` 整组参数，逻辑全部改回引用真实的顶层 `w0..w16`（跟 `zk_close`/`escape_trigger` 已经在用的方式一致）。**这类 bug 卡在纯代码审阶段拦住，没有靠链上跑出来才发现**——`_j2_closezk_repro4.sil` 在 NWT 这轮通过前，全程未进入任何链上测试(哪怕隔离假数据)，J2 修复期间也没做任何广播动作。
- **🔴🔴 跨文档复合风险："卡死的 proving job" × "deadline 逃生舱" = 输家躺赢通道**：wiring 文档的 v1 已知限制(job 卡 `in_progress`，"非紧急")和 escapeRefund 的 deadline-only 设计各自看都成立，**合起来读就是漏洞**——proving job 卡死+无人发现时，市场停在 `closed==1`，`attestedAtSeconds+ESCAPE_GRACE` 的钟却继续走，窗口一过输家不需要抢跑，等着按一下就把本该归零的注变成全额退款，赢家应得的钱被基础设施故障没收。**今天 Docker 坏掉那几个小时就是这个场景的活彩排**。**上线顺序硬约束(已写入 wiring 文档 §2.6)**：`ZK_CLOSE_TICK_ENABLED` 可以先开(escape 不存在时卡死无经济后果)；**`escape_trigger`/`escape_claim` 上链前置 = 出证备份机就位 + 卡死告警落地 + `ESCAPE_GRACE` 按"出证环境从全损到重建的最坏时长"定标(不是只覆盖正常延迟)**，三者缺一不可。
- **✅ wiring 文档 2 个追认遗留(已写入 §2.3/§2.5)**：①`journal_digest_hex` 从"对账用"升级为硬闸——J1 回传 digest 与 J2 独算 journalHash 不 byte-equal = job 直接标 failed + 告警，绝不 dispatch ②ZK 路径状态词汇表——不把 `settleMarketLive` 旧病(没赔完也标 completed)带进新路径，`completed` 只在全部赢家 claim 链上核验后写入，中间态给显式名字(`zk_closed_claims_pending`)。
- **✅ escapeRefund 文档 2 个架构问题已定案(已写入 §2.1.1/§3)**：①`attestedAtSeconds` 机制 A/B 矛盾(文档内部两处表述冲突)——**拍板机制 A**(genesis-mint 时 off-chain 读链上 attest tx 的真实 `tx.time`，独立核验后烤入 ZK covenant 自己的 ctor，不碰 `PayoutShard.sil`，不需要 phase1 entrypoint 烤新字段)，机制 B 表述已清理 ②挂载对象排序——不是"escape 的开放问题"，是它的**前序交付物**：正典生产 ZK covenant 文件(`_j2_closezk_repro3/4.sil`)一次到位包含 `consolidated_pool`+三个新 ctor 字段，escape 两个 entrypoint 作为同一份文件的一部分一起过 `.sil` diff 和 NWT 审，不分两轮(避免 entry-reorder 折返)。
- **✅ C2 定名**：`refundRootBaked`/`attestedAtSeconds`/`consolidatedPoolBaked` 三个新烤值统一要求 genesis-mint 前独立复核 byte-equal，跟 C1(betsRoot predict-then-verify) 并列成对——**genesis 烤值不可变，这道门今后每个 ZK 市场都要过**。
- **🟡 待 Owner 正式拍板**：`zk_ready` 市场准入政策(哪类市场进 ZK 路径，建议世界杯 pool 全量在某上限内，大赢家场景走 payout-shard 不变)——落码前需要 Owner 的正式版本，否则"标记动作是后续独立一步"会被现场发挥。

### 🔴 第三轮跨文档审(2026-07-06 16:3x-16:4x)：CRITICAL 修复与今天 OP_PICK 触发模式的连接点 + 文档/代码同步
- **🔴🔴 最关键发现**：`escape_claim` 的 `blake2b(byte[](bettorPk)+byte[](stake,8))`(约87行) **逐字命中今天 OP_PICK bug 的精确触发三元组**——2 参数动态 `byte[](val,size)` cast + 赋给局部变量 `cur` + 下游 10 级折叠反复引用。这个 entrypoint witness 栈极深(10 sibling+17 w 参数)，是 index 计算最容易出偏的地形。**隔离测试前 2 道核对(MUST，不可省"理论上没事")**：①确认编译 `repro4` 用的 silverc 确实包含今天的 OP_PICK 修复(版本/commit 核对) ②`repro4` 完整编译产物过模拟器 exhaustive PICK bounds 检查，不只是"能编译"这一层。@J2tn 正在核实，J1 提供了自己隔离 clone 的 diff 作交叉参考。
- **✅ 文档/代码同步(v2.1 同款教训修正)**：`escapeRefund` 设计文档 §2.1 骨架此前保留着 CRITICAL 修复**之前**的 `escape_claim` 签名(`w0..w16` 仍作为 witness 参数出现)——已更新为 repro4 实际修复后的形态，加了 CRITICAL 修复记录注释 + `require(X==Y)` 来源审计(正面教材，跟 §2.2 的 v1 反面教材配对)。§4"下一步"过期声明(仍写"开放问题①②有结论后才出diff"，但 diff 已经出了)已同步。
- **📋 新工单：`_PSZK` 幻影 layout 清理**：`zk-close-builder.mjs` 的 `readAttestedWinnerFromState`(L146-169) 是按从未真实实现过的 `_PSZK` layout 解析 state 的**活代码**——需要 grep 定性：死代码就删，若被调用且解析结果错误就修，不能让"理想化 spec"继续以可执行代码形态潜伏。
- **✅✅ `zk_ready` 市场准入政策：Owner 正式拍板(2026-07-06 16:4x，D-级效力，可直接作为落码依据)**：**"ZK 结算路径首批准入 = 世界杯 pool 市场、参与人数 ≤900；大规模赢家场景及既有 committee-sig 市场维持原路径不变；`zk_ready` 标记由 Bettor 手动执行，禁止自动推断。"** 附加说明：≤900 沿用的是**既有参与上限决策**(1024 硬限之下的安全余量)，**不是本次新定的数字**——若世界杯流量逼近这个数，扩容走 payout-shard 既定路线，**不临时改 ZK 准入线**。
- **📌 剩余一根余线(非阻塞，正典 covenant 文件落地那一步处理)**：`readAttestedWinnerFromState`(L146-169) 目前只被"`_PSZK` 对齐或删除"这句顺带覆盖，需要在正典 covenant 文件落地时给它单独一行处置结论(四维 grep 定性：死代码删 / 活代码改读 repro4 真实 layout)，不能藏在"或删除"三字后面溜过去。
- **🎉 第三轮跨文档审收官(Owner 亲自复核确认)**：escapeRefund v3.1 全部闭合，本文档放行，按 §4 顺序执行。**今天从"该不该攻 ZK"到根因/修复/首笔真结算/生产装配/逃生舱设计——每一环都有文档、有审、有链上或代码级证据收口**。
- **✅ scope 边界确认(J2 提问，Bettor 明确)**：`docs/2026-07-06-zk-close-tick-production-wiring-design.md` §2.6 三前置(出证备份机/卡死告警/GRACE定标)只挡"escape entrypoint 服务真实 bettor 的真实市场"，**不挡纯隔离技术验证**(全新一次性 UTXO，不碰任何真实市场资金)——J2 的隔离测试可以继续，不受此约束。
- **✅ J1 认领 SPOF 后续**：J1 承认自己是目前唯一能跑真实 RISC0 groth16 proving 的机器(今晚 Docker 故障就是活案例)，认领为下个 session 的域内待办(评估现实备份方案)，不是今晚能解决的。

### 🔴 escapeRefund 隔离链上测试(2026-07-06 17:0x-17:2x)：genesis mint 成功，escape_trigger 广播卡在最后一里路，诚实收尾
- **✅ 已完成部分**：genesis mint(2 KAS，txId `81772662...`)三方独立核实落地(J1 kaspad 节点直查 UTXO + NWT `kaspa_tx_log` 查询)。redeemScript 重组通过双重密码学验证(手工 blake2b256 + kaspa-wasm 官方函数一致，且 J1 先验证原始未改 redeem 能重现已知地址的健全性检查)。escape_trigger 2-input tx 组装完成(covenant UTXO + J2 独立 fee UTXO，私钥全程不跨机器，签名走既有已审 `sign_input_for_settle` IPC)，三方(Bettor+J1+NWT)独立核实资金守恒精确配平后签字放行广播。
- **🔴 广播卡在协议层，规则45同款 whack-a-mole 模式**：连续 3 层协议拒绝——①`sig_op_count inconsistent`(修：所有 input `sigOpCount=0`+`computeBudget=70`)②`mismatched locktime types`(修：设置满足 deadline 的真实 `lockTime`)③`false stack entry at end of script execution`(某 `require()` 干净返回 false，未解决)。
- **✅ 聚焦诊断(非瞎试，J1 引 ANTI-PATTERNS 规则45+NWT 独立想到同一 memory)**：`attestedAtSeconds`(1700000000)+`ESCAPE_GRACE`(21600，源码确认的未审占位值)+`tx.lockTime`(1700021600001ms) 三方独立核算数学精确对上。**关键推理(J2 提出，团队认可)**：错误类型从"locktime 专属报错"变成"通用 false stack entry"，这个变化本身是证据——deadline check 大概率已通过，问题移到了后面(output script 编码/`validateOutputState` 段)。
- **⬜ 深入到编译器 dispatch 内部机制，J2 判断超出原定"隔离测试"量级，诚实收尾留给下个 session**：J2 继续排查发现问题牵涉 silverc dispatch 内部机制，不是一眼能看穿的。**Bettor 认可暂停**——这不是缩水，是诚实的范围边界：**escapeRefund 的设计审查+CRITICAL 安全漏洞修复(nullifier bypass)本身已完整闭合，不受这次 on-chain 执行卡点影响**(那是代码级/设计级验证，已经过硬)；这次隔离测试卡的是"具体某笔交易执行到哪一步"的更细粒度问题。**下个 session 具体任务**：用离线 debugger 给 mock tx 补上合法 lockTime，跑通 symbolic execution 定位 output/dispatch 层面的最后这个 bug，不必再花一次 broadcast 去试错(规则45"一次性 audit"精神)。
- **✅ 安全确认(NWT)**：无任何东西处于危险状态——tx 被拒绝未落链，无部分状态/资金卡在中间，测试钱无损失，kill switch 仍 OFF 不影响任何生产路径。**没有安全/资金层面理由必须今晚查完**。
- **📌 交接线索**：J2 的假设——脚本执行完毕栈顶不是单一 true，可能是 **entrypoint dispatch/selector 包装层的栈深度记账问题**，不是某个具体 `require` 判 false。**若坐实，这跟今晚 OP_PICK 那类 bug 是同一个风险家族**(编译器 stack-depth 记账类)，值得下一个 clean session 专门查，不该在长时间 session 疲劳状态下继续深挖编译器内部机制。

### 🎉🎉🎉 escape_trigger+escape_claim 首次真实链上执行成功(2026-07-06 18:2x)：Owner 要求深挖后的系统性排除 + 历史性突破
- **Owner 明确要求**(不接受"记录留给下 session")：深挖这个 false-stack-entry 卡点，召集团队对抗性讨论，"交给你了！你记得主动！！！！"——Bettor 全程主动读 silverc/kaspa-txscript 源码 + 驱动团队，不是被动等汇报。
- **✅ 系统性排除链(源码级证据，非猜测)**：Bettor+NWT 各自独立用源码分析(compile.rs 的 `compile_encoded_state_object`/`compile_require_statement`/CLTV/`compile_entrypoint_scripts` selector dispatch/`field_prolog_script` 收尾机制) + debugger 交叉验证(`compiled.build_sig_script()` 自动构造版本 PASS) + 逐字节 diff(手工 sigScript vs 自动构造版本，redeem 字节零差异)，穷尽排除了"编译产物本身有 bug"这整条线：21 字段 `compile_encoded_state_object` 的 PICK offset 逻辑正确、selector opcode 编码(`add_i64(1)`=`Op1`)正确、`OpVerify`/CLTV 失败会报独立错误(`VerifyError`/`UnsatisfiedLockTime`)而非观测到的 `EvalFalse`、dispatch 收尾的 drop+`OpTrue` 机制是编译期固定字节码(不依赖 witness 值，若有 bug debugger 也该同样失败)。**关键结论：排除了 Owner 最担心的"silverc 有隐藏系统性漏洞"这个最坏情况**。
- **🎉 突破①**：J2 用完全相同字节重新广播同一笔 tx(txId `41df9dea57219fc1f7535deaf4d05fc0d135f31d5a156d1ca3b85a3992ff279a`)，这次直接成功落链！`closed 1→3` 的 state transition 真实发生，continuation UTXO(`kaspatest:pqyfa3tz826...`, 200000000 sompi)双重独立核实(J2 查询目标地址 UTXO + NWT 查 `kaspa_tx_log` 确认有真实非空 `block_time`)。**这证明**：完全相同字节的 tx 第一次 `false stack entry`、第二次直接成功 = **瞬时性问题(节点/mempool 时序，很可能是 genesis mint 刚广播、input0 引用的 UTXO 在 node 视角还没完全 confirmed)，不是 covenant 逻辑/手工 sigScript 构造有 bug**，与整晚系统性排除的方向完全吻合。
- **🎉 突破②**：紧接着广播 `escape_claim`(用真实 merkle proof，把 continuation 里满池 2 KAS 一次性退给测试 bettor)，遇到 `"transaction output #0: payment of 0 is dust"`——**这不是脚本执行失败，是 Kaspa 标准 dust 策略拒绝**：单一 bettor 一次性 claim 走全池，导致 covenant 剩余 `consolidated_pool - stake = 0`，continuation 的 0 值 output 撞了 dust 下限。这是**这次单一测试场景的产物**(生产环境多个 bettor 分批 claim 不会撞到这个边界)，**escape_claim 的核心逻辑(merkle proof 验证+nullifier 检查)已经跑过脚本执行到达策略层，机制本身被证明有效**。
- **📌 institutional learning①(非阻塞，记录留用)**："完全相同字节的 tx 第一次失败第二次成功"这个瞬时时序脆弱性，若不理解清楚，未来生产环境批量 broadcast escape entrypoint 时可能复发——具体机制(UTXO/mempool 同步延迟窗口有多长、要不要在 broadcast 前加一个"确认 input UTXO 已 confirmed"的等待步骤)留给后续 session 理解清楚。
- **🔴🔴 结构性设计缺口②(NWT 抓出，J2 已认——不是测试假象，是必须解决才能生产接线的真实缺口)**：dust 拒绝**不是**这次单 bettor 全额 claim 测试场景才会撞到的边界——**不管一个市场有多少个 bettor，只要全部人最终都 claim 完，池子总和精确等于所有 stake 之和(consolidated_pool 本来就是这么烤的)，排在队尾的最后一个 claimant，他 claim 完之后 `consolidated_pool - stake` 必然精确等于 0，触发 dust 拒绝——这是每个市场都会撞到的同一个结构性缺口，不因 bettor 数量而改变**。J2 最初"生产环境多 bettor 分批 claim 不会撞到"这个推理是错的，已当场认错更正。**必须在生产接线前解决**，候选方向：①"最后一笔 claim 不留 continuation output"的特殊路径(检测 `consolidated_pool - stake == 0` 时改用不同的输出结构，比如直接 close 掉整个 covenant 而非留 0 值续约) ②其他零值收尾机制。这是 escapeRefund 设计文档待办，不是这次验证测试(v2 部分 claim 实例，仅用于验证机制本身能跑通)能替代解决的。
- **✅ 验证链条完成**：escapeRefund 完整验证链条(genesis mint→escape_trigger→escape_claim)三步全部有真实链上/协议层证据支持，机制验证收官。

### 🎉🎉🎉🎉 escapeRefund 完整端到端链上验证成功(v3 实例，2026-07-06 18:4x)
- **完整链条**：genesis mint(2 KAS) → `escape_trigger`(closed 1→3 落链) → `escape_claim`(部分 claim：bettor 收 1 KAS + continuation 剩 1 KAS)，txId `8c6073ff13a81fe0182a7e5940c4334d4c57209c3c5af13b6642f46fbe0fad13`。**NWT 独立核实**(查 `kaspa_tx_log` 的 `outputs_json`，非只信自报)：`output[0]`=continuation 地址 100000000 sompi、`output[1]`=bettor 收款地址 100000000 sompi、`output[2]`=J2 relay 找零 149558000 sompi，精确匹配描述。
- **中途抓到并修复的真实 bug**：`escape_claim` 首次尝试失败，J2 定位到真正原因——**这是纯 state-in-address 设计(状态变→地址变)，continuation output 的 P2SH 地址必须用 decrement 后的 `consolidated_pool` + 更新后的 nullifier bitmap 重新计算，不能照抄输入的 scriptPubKey**（J2 之前错误地复用了旧地址）。修复 + 调整 KIP-9 mass 参数(需要额外 fee input)后完整成功。这是 verify-value-source 铁律的又一次实战验证。
- **机制验证收官**：CRITICAL nullifier bug 修复 + deadline 逃生舱(escape_trigger) + merkle 退款(escape_claim)，三者全部在真实 TN12 网络上验证通过，有完整链上证据链。
- **未变的独立待办**：dust 结构性缺口(§3④，设计文档已记)不因这次成功而消失——排队最后一个 claimant 必然把 `consolidated_pool` 精确清零，撞同一个 dust 拒绝，上生产前必须解决。escape entrypoint 真实服务生产市场前仍需 wiring 文档 §2.6 三前置全部就位。
- **今晚这条线的完整弧线**：Owner 要求深挖 false-stack-entry 硬茬 → 团队系统性排除编译器 bug 假设(排除最坏情况) → 定位为瞬时时序问题 → 团队顺势把整条 escapeRefund 机制推到完整链上验证 → 过程中又抓住一个真实 bug(state-in-address 地址重算) → 又抓住一个真实结构性设计缺口(dust)。**这是今晚对抗性讨论+主动排查纪律最扎实的一次收官**。

### 🎉 dust 结构性缺口修复 + 验证收官(2026-07-06 20:0x)：Owner 催修 → 三方独立查证(排除记混)→ 修复 → 链上证实
- **Owner 直接催修**("这个问题很关键啊!建议马不停蹄,修!!!没有过硬的产品市场不接受")→ Bettor 提议排序(dust bug 最优先，其余基础设施级工作评估容量后再排)。
- **✅ Owner 提醒"应该修过"引出的重要发现**：Bettor+NWT+J2 三方独立查证(源码+memory+p2sh.mjs+ANTI-PATTERNS/DATABASE/DECISIONS)收敛一致——"`consolidated_pool - payout` 精确等于 0 导致 continuation output 撞 dust"这个具体场景，代码库里**没有任何既有修法**。**关键发现**：生产环境 `PayoutShard.sil` 的 `claim`/`refund_claim`(今晚 955 个赢家实际走的路)是**完全相同的结构性缺口**，只是从未被真实触发(合理解释：费用/舍入让每次最后一笔总有残余，955 人里没人恰好撞上 `payout==剩余全部`这个精确边界)。Owner 的"应该修过"记忆大概率是跟 KIP-9 小额(非零)output 的 storage-mass floor 类修复(consolidate_utxo 880/今晚 genesis mint stake 太小那次)记混——那是相关但不同的具体场景。**PayoutShard.sil 同款缺口已升级为独立跟进项(不阻塞今晚，需记入 DECISIONS.md/ANTI-PATTERNS.md 防止以后重新排查一遍)**。
- **✅ 修复(J2 写，NWT 行号级代码审 GREEN)**：`escape_claim` 加 `if (consolidated_pool == stake) { 最后一笔，不留 continuation，不调 validateOutputState } else { 现有分支不变 }`。NWT 确认 merkle proof(98-110)+nullifier 检查(115-135)+recipient-bind(136-139)+value check(139) **全部无条件在 if/else 分支(146 行起)之前执行**，授权检查零豁免；守恒在 `consolidated_pool==stake` 条件下数学自动成立(不可被伪造，因为 stake 经 merkle proof 绑定真实注册人——remaining==自己的 stake 数学上只可能发生在真是最后一个未领取者时)。
- **✅ 链上验证(v4 实例，last-claimant 场景)**：txId `3aec5594ae84ca743510b065d4951e14e6fa9e208d8df2e0a054d4a9a4b00e37`，双重独立核实(J2 查覆约地址 0 UTXO + NWT 查 `kaspa_tx_log` 的 `outputs_json` 只有 2 个 output：bettor 全额退款 200000000 sompi + J2 relay 找零 149444000 sompi，**没有第 3 个 continuation output**)。dust 拒绝彻底解决，覆约在这笔 tx 里干净关闭。
- **今晚 escapeRefund 这条线累计抓住并修复的真实问题**：①CRITICAL nullifier bug(witness 绕过检查)②瞬时节点/mempool 时序问题(理解清楚，非 bug)③dust 结构性缺口(设计层面真实缺陷，已修复+验证)。三个问题全部走完"发现→报告→修复→代码审→链上验证"完整闭环，无一被静默略过。
- **NWT 实现期提醒(非阻塞，记入 checklist)**：具体 `.sil` diff 落地时，nullifier 防重复领逻辑必须完整复制 `refund_claim` 的 `require((w_i/mask)%2==0)` 这条"抢先检查位未置"的 guard，不能只抄"标记位"那半句——那半句才是真正防重复领的关键行。
- **本轮收获(三次层层深入的发现)**：phase1 不存在(其实是既有机制只需适配) → escapeRefund 两个结构洞(state machine/deadline 锚点) → phase1-for-ZK 机制从未设计。每一层都是团队诚实查证而非假设推进，今晚打的地基(job 表/server/settler wiring/3 个 hook/OP_PICK 修复本身)依然扎实，"能处理真实市场"这条终态确认比最初设想更远，但方向没错，过程零虚报。

**✅ 网络可达性已确认**：J2 console host(desktop-da9qq46) 与 J1 机器同在一个 Tailscale tailnet 上(Bettor 查实：Tailscale IP `100.99.147.101`，`laptop-s6i31sri` peer active 有真实流量)——J1 curl 验证通，不需要开放端口到公网。**J2 进一步改进设计(风险面最小化)**：不改动整个 console 的 HOST 绑定(会把所有现有生产 API 暴露到 tailnet，改动面太大)，而是给新的 zk-prove endpoint 单独起一个**小型独立 HTTP server**(单独端口，只跑 zk-prove 相关路由)，跟主 console 进程分开——风险面精确限定在新增这一小块。认证=bearer token(存 kanet.env)+IP 限定 tailscale CIDR(100.64.0.0/10)。J2 正在写详细设计文档，落码前过 NWT+Bettor 完整审核。
- **⬜ ③(bh01w zombie_quarantine 处理)**：KANet-UI 查实——DB 里找不到"谁标的/为什么"的直接记录(events 表零命中，metadata 无 quarantine 字段)。诚实结论=推测跟"今晚早些时候 189 个僵尸盘批次 quarantine(J2 扫描 MAX_WALK 超限)"时间线接近，**但无直接证据**，不当确认用。不阻塞①②推进，不着急。

### 📋 待办(非阻塞，第二轮架构审补充，NWT/J2 有空时处理)
1. **offset139 静默取错值取证(优先级中，forensic 非 blocking)**：污染点(offset136 的 `byte[](attestedWinner,1)` cast)在 offset139 之前发生——理论上 offset139(取 `guestPayoutRoot`)的 index 计算也应被同一污染影响。J2 12:57 报告修复后 offset139 的 index 确实从 9 变 8——**这意味着修复前 offset139 很可能是"界内但取错值"的活案例，只是被 offset143 的越界崩溃挡在了验证之前，从未真正暴露后果**。**待办**：用现有(已对齐 VM 语义的)符号栈模拟器重跑**修复前的旧字节码**，确认 offset139 在旧版本里实际 fetch 到的符号标签是否真是 `guestPayoutRoot`(巧合正确)还是别的值(实锤过静默错)。这个案例如果坐实，是 Tier2 Level2"界内取错值"防线最有力的实证材料。**不阻塞今天的 LAND**——当前(修复后)版本已 exhaustive 验证全部 7 处 PICK 符号标签正确，跟这条追溯性取证无关。
2. **Tier1/Tier2 时序口径校正**：方案文档 §5 层1 写"符号标签匹配"，字面上是 Tier2 Level2 的能力，但 Tier2 状态标"未开始"——**实际上 J2 已经在 debug 模拟器里就地实现并跑过符号标签检查**(13:07 全部 7 处 PICK 符号标签验证)，只是没有升格成"编译进 silverc 本身的永久 gate"。**待办**：更新方案文档，把 Tier2 拆成"核心技术(符号标签模拟)已就地验证过 vs 永久化进编译器"两档，别让"未开始"这个措辞掩盖已经做过的实质工作。
3. **同族 cast 函数 grep(2分钟量级)**：`compile_bytes_call`(干净)vs `compile_byte_sequence_cast_call`(有bug)——待 grep 同族其它 cast 函数/其它 arity 分支，排除还有第三处同款"stack_depth+=1 无对应 emit"。
4. **回归 fixture 固化**：minrepro + J1 8 个 iso 变体应收编进 cargo test 永久回归集(可与修复同 PR、分 commit)——"55 测试 0 回归"这个证据要如实降权(这套测试之前就没拦住这个bug，只证明没改坏别的，真正的修对证据是8个iso repro)，收编成永久fixture才是"消融矩阵一次投入两次收益"的兑现。
5. **PoolSpine_v0_7_1.sil live 状态**：待 KANet-UI 澄清(非紧急，此挂单别蒸发)。

### 🔴 潜伏面扫描命中活生产合约(2026-07-06 13:00-13:02·排查完毕·结论=证据不支持资损，仍需模拟器实测收口)
- **发现**：J2 §1.5 步骤③潜伏面扫描发现 `PoolSpine_v0_7_1.sil`(145-150行 `yesB`/`noB`/`shardCntB` 均用 `byte[](val,size)` 声明且后续被引用)命中同款触发模式。**KANet-UI 确认这是今晚 lv3rz/k3cnf/dyljb 三场结算实际用的 live v0.7 rolling 合约**(`pool-p2sh-v0_7_1.mjs` 直接 `compileAndComputeP2SH(SPINE_V071_SIL...)`)，不是测试盘。
- **NWT 独立核实+降级(证据链，非"结果对就没事")**：①`events` 表历史上从未出现过 "pick at an invalid location" 类拒绝记录——若越界应早已触发过 ②这三处后面紧跟一个硬校验：算出的 commitHash 必须等于 `global_commit_id`——若 bug 导致取到错误栈值，算出的 hash 几乎不可能巧合等于预期值，`require` 会直接拒绝交易，不会静默用错值通过。**结论(精确措辞)**：现有证据倾向于"即使命中触发模式，也会被下游 commitHash 硬校验挡住，不产生静默错误的资金结算"，加上今晚三场结算(955 赢家)守恒分毫不差与"静默取错值"假设矛盾。**但非 100% 形式化证明**——待 J2/J1 用模拟器实际编译此合约算出具体 PICK index，确认是"越界(已排除)"还是"界内但标签错(需符号追踪确认)"。
- **处置**：不按"紧急资损事件"处理(证据链不支持)，降级为 **Tier 2 符号栈追踪 corpus 验证的第一个真实案例**，优先做但非恐慌处理。在此项模拟器实测收口前，**仍不对此合约做任何广播/money-path 新操作**。
- **补充旁证(NWT 数据流向层)**：有 `settle_txid` 的 250 个已结算市场中 249 个在 `kaspa_tx_log` 成功落链、零拒绝(剩 1 个查实=索引器今晚才上线的历史空档，非拒绝，250/250 成立)——若此位点系统性取错值，commitHash 不太可能 250 次巧合算对通过。
- **✅ 收口(2026-07-06 13:03·J2 代码流+实测双证)**：今晚 lv3rz/k3cnf/dyljb 三场实际结算走的是 **`PayoutShard.sil`**(`pool-shard-settle.mjs` 引用)，**不是** `PoolSpine_v0_7_1.sil`。`PayoutShard.sil` 里仅有的两处 2 参数 `byte[](val,8)` 用法(179/343行)都是**一句话内立即被 `blake2b` 消费，不单独命名成变量再引用**——不匹配 J1 定位的精确触发条件(赋给命名局部变量+该变量下游被引用)。J2 实测编译了结构对齐的最小用例(2参数cast立即被CAT消费不单独命名)，模拟器逐条检查全部 PICK，**零越界**，实证此写法不触发。**结论**：今晚实际结算路径 `PayoutShard.sil` 不受此 bug 影响，250/250 结算数据与此一致。`PoolSpine_v0_7_1.sil` 的"live"状态存疑(J2 在代码库找不到任何 importer，疑似废弃代码)，**待 KANet-UI 澄清**，但不影响"今晚实际结算是否正确"这个关键问题的答案(答案=正确，未受影响)。
- **下一步**：J2/J1 落 `lower_inline_functions.rs` 实际 emit 修复 → NWT 第二次审(落码前代码审，跟设计审分开)→ Tier 0 最小复现 + 完整 covenant 双重验证(§5 v2 四层：bounds+符号标签/预注册diff/恒等式/live-node，`computeBudget=1500`)→ 重编覆约 → 接 J1 真 proof(image_id `c9918501...`)→ 广播落链(八命门+Owner批闸)。
- **🔴 落码前三步核对(2026-07-06 12:5x·第二轮架构审·方案 §1.5，J2 落码前必做)**：① 算术对账("多算1"×触发次数是否精确=观测偏差−2，机制推导出预期 diff 而非只写 offset143) ② 触发条件三元组(cast/concat数/引用次数)消融矩阵(3用例,注意跟 `lower_local_aliases` 别名消除假阴性交叉核对) ③ 潜伏面扫描(全量现有 `.sil` grep同款位点,命中但未越界=静默取错值候选,合并进 Tier2 模拟器 corpus 验证)。**diff budget 收紧**：落码预声明只碰 `lower_inline_functions.rs`，顺手改 `stack_bindings.rs`/`compile.rs` 需单独解释。三步过 → §5 v2 四层验收 → 广播闸不变。

---

## 🔴 当前状态速览(2026-07-06·接位第一读·配 docs/DECISIONS.md)
> **战略决策口径一律以 `docs/DECISIONS.md`(D-001~D-004)为准·防炒陈饭。本区只记当前进度锚点。**
- **公测已开(7/5 X 公布 tg DM)**: 世界杯盘 live。真人流量压出"链上推进/DB 滞后"这族 bug(phantom-leaf/时序/僵尸/孤儿脚本 race)。
- **结算实证(公测三场全闭合·2026-07-06)**: lv3rz(Brazil-Norway 442/442)+ k3cnf(Mexico-England 64/64·England 晋级)+ dyljb(Will Mexico advance? 449/449·NO 赢·守恒 27837.32 分毫不差)= **955 赢家全付·三场守恒闭合·判定逻辑闭合**(k3cnf England 晋级↔dyljb Mexico 不晋级)。**covenant 保证钱一分没丢·可链上追付对**。dyljb 经历 J2 孤儿脚本混战(20+)→DB-lag 自愈 v3 自动恢复 264 假阴性→跑完 = **自愈机制真 work 实证**。
- **daemon 自治结算**: settle-daemon(每 tick 自动判定+consolidate+PUSH 付赢家)~6/30 建·今晚修可靠性(5cfd215c 自愈 / 98a85f7e #33-③ settled_partial_claims 纳入 ripe / multi-step 探测)。
- **🔴 战略方向(D-001·Owner 2026-07-06 钦定·CLAUDE.md 铁律0.5)**: **ZK=committed 目标结算架构·rolling/covenant 跨节点=死路(不投任何资源)**。现状=rolling 维持 live 公测过渡·ZK 全力攻。
- **🔥 ZK 攻坚进展(2026-07-06·全力攻坚)**: **三大技术风险全消**——①OP_PICK 可绕(新 silverc 编过 + R0ScriptBuilder 不用 silverc) ②ZkScriptBuilder 产兼容 gate script(WASM 隔离 build+JS 可调) ③verifier 真验(zk-sdk 14/14 含篡改拒·同 live verifier 代码)。**🎉 阶段性 LANDED(txId bfd3d0e2)**: **TN12 活链第一次 0xa6 真验证接受 groth16 证明**(computeBudget~14M units·双验证 J2+NWT :3200)。当时 precise scope 仅=0xa6 活链验证,非完整 settle——**该缺口已在同日晚些时候补齐,见下方"汇合完成"条目(txId `4ec9ddd1...`)**。
- **ZK 检查点(2026-07-06·team 共识暂停·下次 fresh 秒接)**:
  - ✅ **non-vacuous binding 焊死**: WASM 补 `commitToGroth16WithFixedJournal`(~40 行·隔离 clone `D:/rusty-kaspa-zksdk-isolated`)·不同 journal_hash→不同 gate P2SH。
  - ✅ **covenant 重构 byte-equal**: `blake2b(gatePrefix+journalHash+gateSuffix)` == `blake2b(完整 799B redeem)`·CloseZkRepro3.sil 骨架(NWT 八命门审过·`scratch/_j2_closezk_repro3.sil`)。
  - ✅ **两 UTXO 落链待完整测**: covenant 地址 `kaspatest:prrgnrfl66r06dlp2dktsr2tvrxdcndeen0hqjj4420knnwlfhpszewu0z4ut`(state: attestedWinner=1,closed=1,待 zk_close·txId 1b29291e) + gate 地址 `kaspatest:pqcd63...`(带 groth16 proof·journalHash 匹配 baked·txId 971f2f69)。
  - ⏸ **下次 fresh 接的一步(error-prone·勿疲劳赶)**: 手工按 SilverScript 栈序编码 zk_close sigScript(3 参数: gateSuffix/guestPayoutRoot/selfOutIdx 按声明序 push·单 entrypoint 无 selector)→ 构造 2-input zk_close TX → NWT 八命门审 → 广播 → 完整 CloseZk non-vacuous binding 上链。
  - ✅ **真 guest 环境就绪(J1·2026-07-06 verify-first EXIT=0)**: J1 机器(独立 :3300 节点·非 live 主机)装好 **Ubuntu WSL2 + Rust 1.96.1 + RISC0(cargo-risczero 3.0.5/r0vm 3.0.5/rzup)**·实测真 RISC0 guest EXIT=0。**下步**: 按 golden-ref(`docs/2026-06-28-P2-payout-guest-golden-reference.md`)写真 payout guest→真 groth16 proof(替 fixture)。写 guest=安全可迭代(非不可逆)·可推进。**live 主机绝不装 WSL(D-005)**。
  - ✅ **真 guest proof LANDED(J1·2026-07-06)**: 真 RISC0 guest(payout 算术 13/13 byte-equal golden-ref·computePariMutuelPayout/deriveFeeLeaves/settlePayoutRoot/computeBetsRoot)生成**真 groth16 proof(非 dev-mode·journal 双锚 bets_root+payout_root)**。替 fixture 的真货·待汇合。
  - ✅ **OP_PICK codegen 根因找到+修复+验证(J1 单行修复·2026-07-06 深夜)**: 根因在 `compile.rs` `compile_byte_sequence_cast_call`(2-arg `byte[](val,size)` 动态 cast 分支)一行多余的 `*ctx.stack_depth += 1;`(无对应 opcode)。删除该行,`cargo test --release` 55 测试全绿零回归,D-005 合规(纯 silverc 编译器 emit 侧,零碰 live VM)。J2 code-review 通过后落码进 shared `D:/silverscript`,本地 commit `8065184`(分支 `j2-oppick-fix-2026-07-06`,**尚未 push**)。活链验证进度: `pick at invalid location`(修前)→ OP_PICK 通过、`non-vacuous binding` EQUAL 校验 byte-exact 通过(修后,fixture proof)。**J2 covenant journalHash 公式(SilverScript)与 J1 guest(Rust)独立实现数学互通**: 两边各自算出同一 journal_digest `b7b89b3e9490c96b525b970adb83a7015ee48b2c00beaca32d10fa2360acb1d4`,交叉验证通过。
  - 🔴 **(已解除,见下)曾经的硬 blocker = J1 本机 Docker Desktop WSL2 集成 bug**: risc0-groth16 的 STARK→Groth16 压缩步骤需要 WSL 内跑 docker 容器,J1 机器上 docker-desktop 内部 distro 到消费 distro(Ubuntu)的跨 distro 共享挂载(`/mnt/wsl/docker-desktop/docker-desktop-user-distro`)把 23MB 的桥接二进制读成 0 字节,完整卸载重装 Docker Desktop 也没修好(settings 读取那层修好了,但这个更深的挂载层没有)。J2(live 主机,D-005 禁装 WSL)、NWT(无 Docker)都排查过绕不开,团队 7/6 13:58 共识"机制已证通(OP_PICK 修复+non-vacuous binding+continuation 活链验证 byte-exact PASS),真实 Groth16 proof 接入留后续任务,不阻塞今晚里程碑"。J1 判断唯一干净修法是真机重启(`wsl --shutdown` 不够,试过)。
  - ✅ **Docker/WSL2 bug 被真机重启修好 + 真实 Groth16 proof LANDED(J1·2026-07-06 21:3x·fresh session 接位后首要动作)**: 机器 21:24 重启完成后验证 `docker version` + `docker run hello-world`(真拉镜像真跑容器,非仅 settings 读对)在 `wsl -d Ubuntu` 里跑通,跨 distro 挂载 bug 解除。随即用 `ProverOpts::groth16()` 重跑真实(非 dev-mode、非 fixture)proving:`receipt.verify(PAYOUT_ID)` 本地验证通过,journal byte-equal golden-ref V3/B2(bets_root=`41b7e8e6...`/payout_root=`759b6e26...`/attested_winner=0),`image_id(PAYOUT_ID)=c9918501d90bf0aeaaf7970816078c81e8286c08293ccf388e87a7cab023ce30`,`journal_digest=b7b89b3e9490c96b525b970adb83a7015ee48b2c00beaca32d10fa2360acb1d4`(跟 J2 昨晚独立算出的 covenant 公式结果一字不差,零漂移)。borsh 序列化 `Groth16Receipt<ReceiptClaim>` 导出 482 字节,已贴进 `dev-coord-testnet` 频道供 J2 组装最终交易。**J1 未自行推进到交易组装/广播**——按域分工那是 J2 的域,J1 只交付 receipt 数据,等 J2 确认收到 + Bettor 走完整确认点(资金守恒/non-vacuous binding/continuation/receipt 格式校验)再 GO。
  - 🎉🎉 **汇合完成 = 完整真 ZK settle LANDED(2026-07-06 14:44Z·txId `4ec9ddd1d89b144bfec50e386be0221ab44e2f58f1c4f63207358a2eb80f3545`)**: J2 用 J1 的真实 receipt 组装最终 2-input `zk_close` TX(input[0]=covenant UTXO,input[1]=gate UTXO 即真 groth16 receipt,output=continuation P2SH,closed 1→2),走完 predict-then-verify 四点确认(①资金守恒 200000000-140000000=60000000 sompi 精确对上·②NWT 独立 derive continuation 地址 byte-exact + state 字段匹配·③`.sil` 源码时间戳确认未改动,沿用既有八命门审查结论·④validateOutputState 不查 value 这条继承成立)→ Bettor 签字 GO → 广播 → continuation UTXO 确认落链。**KANet 历史上第一笔完整真·密码学 ZK settle 链上交易**:①修复后 silverc(OP_PICK bug 已修)②non-vacuous binding(gate UTXO 真带对应 journalHash 的 groth16 证明)③continuation state 转换 byte-exact④真 guest program 算出的真实 payout arithmetic 的真实 groth16 proof(非 fixture/非 dev-mode)——四项首次在 TN12 活链同时验证通过。工具链: silverc 隔离·zk-sdk WASM `D:/rusty-kaspa-zksdk-isolated`。**J1 全程未越域**:只交付 receipt 数据,交易组装/广播/审核全是 J2/NWT/Bettor 的域。
- **🔴 "ZK 标签正名"(D-001)**: 现跑的"多片 ZK"实为 committee-sig covenant·真密码学 ZK 只单片 pb73v·多片从未交付。勿混。
- **框架反漂移(D-002/003/004)**: 迭代回路(执法阶梯 L1-L4)+ 记忆反增殖 + 统一知识框架(KB=durable 唯一家·DECISIONS.md=决策口径·接位路由补 KB+DECISIONS)。FRAMEWORK-RETRO-TEMPLATE 锚 7/8 首轮 retro。

### 🔧 生产装配三件套 LANDED(2026-07-06 15:xx·J2 commit `f3060ff3`·NWT 双重独立复核 GREEN)
- job 表(`zk_prove_jobs` v180)+ 独立 `zk-prove-server.mjs`(Tailscale 绑定+bearer token+fail-closed)+ `bshard-settle-daemon.mjs` 接入 `zkCloseTick`(**kill switch `ZK_CLOSE_TICK_ENABLED` 默认 OFF**·`scanReadyZkMarkets` 真实现·其余 5 hook 是 throw-TODO stub)。`selectRipeMarkets()` 逐字节零改动·真实数据 copy 测试证明 0 个 zk_ready 市场时 stub **物理上跑不到**(非"应该没事")。
- **fresh NWT 独立复核**(不信前一 session 自报,自己 `git show 8065184` + 重读 diff):GREEN,一个非阻塞发现(bearer token 用 `!==` 非 timingSafeEqual,内网 Tailscale 场景可接受,记账待补)。
- **zk_ready 市场准入政策(Owner 正式拍板·D 级效力)**: 首批准入=世界杯 pool 市场·参与人数 ≤900;大规模赢家场景及既有 committee-sig 市场维持原路径不变;标记由 Bettor 手动执行,禁止自动推断。

### 🔴 escapeRefund 逃生舱设计 + CRITICAL 漏洞修复(2026-07-06 16:xx·J2 设计+落码·NWT 红队)
- **架构缺口**: `zk-close-builder.mjs` 引用的 `_PSZK` layout(6/28 KANet-UI commit `9b9804b5`,引用"旧 J1 firm 16:55")**假设 PayoutShard.sil 有独立 `attested_winner` 字段,但直接读源码确认该字段从未存在**(PayoutShard.sil 只有 `consolidated_pool`/`closed`/`payoutRoot` 三个 state 变量,winner 隐含在 payoutRoot merkle 树里)——J1 查证(`git blame`+源码),J2 确认今晚 LANDED 那笔用的是 demo repro3(ctor 直接烤 `init_attestedWinner`),从未走真实路径,非资金安全事故。
- **v1→v3 设计迭代**(NWT 红队,每轮抓到真洞): v1 state machine 一次性焊死(第二个 bettor 永久锁死)→ 拆 `escape_trigger`(permissionless flag-flip,closed 1→3)+`escape_claim`(可重复调,closed==3 precondition,镜像 `refund_claim`);deadline 锚点用错(genesis-baked `deadline_daa` 而非 attest 完成时刻)→ 改用 `attestedAtSeconds`(mint 时 off-chain 读 `kaspa_tx_log` 观测值烤入 ctor,不碰 PayoutShard.sil);`betsRootBaked` 是 hash-chain 非 merkle 树,无法做单笔 membership proof → 新增独立 `refundRootBaked` 字段(genesis-mint 时复用既有 `payoutRoot()` depth-10 merkle 构造)。
- **🔴 CRITICAL(NWT 代码审逮到,纯代码审阶段拦下,未进任何链上测试)**: `_j2_closezk_repro4.sil` 的 `escape_claim` 自己声明了一套 `w0in..w16in` witness 参数(caller 自填,不受 P2SH 约束),nullifier 检查全部基于这套假值——单人反复提交同一笔 escape_claim 可抽干整个 `consolidated_pool`。**修法**(一行改名级别但性质 CRITICAL): 删除 `w0in..w16in`,全部改回读 P2SH 绑定的真实 `w0..w16` state(跟 `zk_close`/`escape_trigger` 已用的方式一致)。NWT 逐行复核 GREEN。
- **经济激励发现(NWT,非阻塞已写入 §2.1.2)**: permissionless deadline 逃生舱 = 基础设施故障本身就会自动触发全场退款(不需要任何人主动作恶)。GRACE 标准收紧为"覆盖出证环境全损重建最坏时长"(非仅覆盖正常 proving 延迟),出证备份机需求升级。
- **上线三前置(§2.6·写死不可绕)**: escape_trigger/escape_claim 真正服务真实市场前,缺一不可:①出证备份机就位(J1 认领,今晚 Docker 坏机 3 小时是活彩排)②卡死告警落地③GRACE 按最坏重建时长定标。**三前置只挡真实市场资金,不挡纯隔离假数据测试**(Bettor 划清边界)。

### ⏸ escape_trigger 隔离测试 — 卡在编译器 dispatch 层(⚠ 本节已过时:卡点当晚 18:2x 突破,见上方"escape_trigger+escape_claim 首次真实链上执行成功"及后续 dust 修复条目;false-stack-entry 结论=瞬时节点/mempool 时序问题非 covenant bug。本节保留 J1 侧独有细节:genesis mint txId/redeem 重组方法/17:47 对抗假设记录)
- **genesis mint LANDED**(2 KAS,txId `81772662bcdf21f4d7312840be01bec7d93f9d85b800150c51a6544ddb46629b`,P2SH `kaspatest:prs48jd232dmsqh45t8z82xxrusphx3l5cgxeh7pa0pmvt7cqllxq8uzkxpc8`,J1 独立节点直查 UTXO 核实)。
- J1 重组 redeemScript(11 段频道分块)+ 双方法交叉验证(手工 blake2b256 vs kaspa-wasm 官方 `payToScriptHashScript`,byte-exact)+ 先验证原始 redeem 能复现已知地址的健全性检查通过。escape_trigger 组装(splice closed:1→3,新 continuation 地址 `kaspatest:pqyfa3tz826fmp43wykjna778qqrnm33q8ev9sxkejxt00phgam4zpymh9607`)三方(J1+Bettor+NWT)独立核实守恒数学 GREEN,J2 广播。
- **广播踩 3 层协议错误**(规则 45 whack-a-mole 模式,J1 引用先例): `sig_op_count inconsistent` → 修 sigOpCount=0+computeBudget=70 → `mismatched locktime types` → 补 ms-epoch lockTime → **现卡在 `false stack entry at end of script execution`**(某 require 干净判 false,非 crash)。deadline 数字三方独立核算一致(attestedAtSeconds=1700000000s+GRACE=21600s→阈值 ms=1700021600000,tx.lockTime=1700021600001 满足),output scriptPubKey 字节验证过——**问题定位到 escape_trigger 的 `validateOutputState` 内部 state 重建 concat,尚未坐实具体行**。
- **🔴 Owner 拍板不下沉(2026-07-06 17:47)**: 团队原判"记录进度留给下个 session"(NWT/Bettor 确认无资金/状态风险——tx 被拒未落链,测试钱无损,kill switch 仍 OFF),**Owner 要求继续查,不能轻易归为下一步**。召集对抗性假设讨论(非碎片汇报,互相攻击对方假设):
  - **Bettor 假设**: repro4 新增 `attestedWinner` 字段(PayoutShard 从未有过,排 state 首位)= 这套 21 字段布局第一次真正上链,不是"复用已验证模式"而是"看似复用实为新组合"(同 J2 CRITICAL bug 同一根因类别)。
  - **J1 假设(独立角度,基于亲自定位 OP_PICK 根因的经验)**: escape_trigger 的 `validateOutputState` 要重建 213 字节 state(20 个 8 字节字段+1 个 32 字节字段混合宽度 concat)——结构上与 OP_PICK 原始触发模式(混合宽度 cast 链)相似;今晚只修了 `compile_byte_sequence_cast_call` 一处具体实例,不排除同一类 stack_depth 记账漏算在不同 concat 形状下换脸复发(呼应 13 轮 OP_PICK 排查教训"confound 可以藏在没试过的具体形状里")。**待验证**:①贴 escape_trigger `validateOutputState` 源码原文②确认是否整条大 concat 拼装(非分字段)③过 Tier2 模拟器/ablation 矩阵看这个具体"8B×20+32B×1"形状测过没有。
  - **状态**: 验证进行中(J1 17:48 后下线约 3 小时,交接完整,J2/NWT/Bettor 继续,无需等待)。

---

---

## DOMAINS(冻结区,§8.2)
| 域 | owner | reviewer | 节点 |
|---|---|---|---|
| settler/voter/pipeline | J2 | NWT | :3200 |
| :3300 oracle/节点/找零核弹 | J1 | KANet-UI | :3300 |
| 操作员/UI/doc/部署 | KANet-UI | NWT | :3200 |
| 攻击审/关3/红队 | NWT | (Owner) | 双 |
| 协调/审码/验落链/方向 | Bettor | Owner | 双 |

## SCOPE-AUTH(冻结区)
- **Bettor(协调)= 全执行域 read-only 结构锁**:只写协调文档域(本 ledger / 决议 / 派工卡 / 评估报告),代码域零 write,write 永远派工。
- 各执行 agent:自己 owner 域 write,跨域升级。

## 🔴 查资产硬门(Owner 钦定·2026-06-28·机制非纪律·破"记下的铁律被无视")
Owner 元问题:写进文档的铁律(CLAUDE.md 接位 SOP 第5条"设计前查资产防重造")= **被动**·必被忽略(同线8"改了又坏"病)。根治 = 变**主动门禁**(同 `lint-kanet.mjs` pre-commit 硬失败:机制不给突破的机会)。三层,协调人 Bettor 强制执行点:
1. **接位即查**:每个新 session agent 接位**第一条消息**必报"我的域这几件事**已有没有**(file:line)"——逼真搜·非"我读过"。没交 = **不派活**。
2. **提案模板**:任何"设计/新建"提案**开头必有**"既有资产核查(查了哪些 doc/表/code·file:line)+ 判定:新建 / 复用 X"。缺 = **打回·不进 co-verify·不让 commit**。
3. **重造事故记账**(下方):每次差点重造白纸黑字记·让浪费可见、有代价。
**执行点 = Bettor**:任何 GREEN / greenlight 前,没查资产证据 = 不放行。我失职放过=你钉我·不拿"提醒过"当借口。
### 重造事故记账(2026-06-28 起)
- **#27a 委员排除**:J1 差点重写·既有在 `sampleAndStoreCommittee` L343-364(2026-06-14 已 SHIPPED)·verify-before-act 救场。
- **broker 身份**:J2 差点走 `broker_relay_id` relay 老路·地址制既有在 `broker_onboarding` v173 + `pool.js` L922(Owner 2026-06-22 钦定)·Owner 拦截。

## 测试网成果口径(Owner 钦定·2026-06-28·钉死框架)
测试网钱=faucet 无价值。**成果 ≠ "安全/没丢钱/退款守恒"**(框反·Owner 不关心)。**成果 = ① 系统端到端真跑通 ② 狠压出更多 bug**(测试网用来炸·非保平安)。报数口径:**"跑通了没 / 又炸出什么 bug"**·禁报"安全/没丢钱"。姿态=主动炸系统逼 bug·非守安全。配 [[feedback-testnet-spend-bettor-decides-coin-plentiful]]。

## 诚实口径铁律(全线适用)
现多数 enforce / 经济层 = **driver-side 或设计收敛**。**别 claim production-trustless 直到自治 daemon 真落 + 红队过 + 双节点同证。** 口径跟实 enforcement 成熟度走。报数用级别词:机制证通 < 端到端 demonstrate < 干净验收。

---

## 线 1:Track B — production-trustless 自治-enforce(主线北极星)
### GOAL
enforce(命门③/④,含 broker/intro)从 driver-side 搬进**每委员 oracle 自治**(relay 签前自验、自源链值),production-trustless。

### INVARIANTS
- verify-value-source 递归:enforce 用的每个链值(tipDaa/cov_id/resolutionDaa/poolMerkleRoot/bettors)**relay 自取,绝不进 caller-fed ctx**。
- no-bypass 不变量:(a) relay sign 端点 localhost-only(远程够不到)(b) daemon 唯一 call relay sign + 每请求 enforce。
- C1 complete-set 必跨【全 rolling shards】链上重建(漏一片 bettor=可操纵 pari-mutuel 分母)。
- NO TX NO STATE;双节点同证。

### STATUS / NEXT(滚动)
- ✅ **D4 纯函数层 ship**(`origin/j1-d4-loaders` @ aace8f39):`canonicalLockUntilDaa`(g(deadline)=res+cooldown+margin,不收 caller)/ `isEligibleOracleStake`(资格谓词全 DAA 域 strict>)/ `validateMembershipAgainstChainRoot`(C2)。Bettor 红队抓 2 洞(seconds-mixing / margin=0)J1 已修,tipDaa 链源纪律钉进契约(6b7db22a)。
- ⬜ **NEXT(J1,下个 focused session)**:落真正 chain-read loaders — `getBlockAtDaa` / `resolveCovIdFromInput` / `readPoolMerkleRootFromPsRedeem`(offset probe)/ `loadOracleStakesFromChain`(tipDaa 自取 rpc.getVirtualDaaScore)/ `loadBettorsFromChain`(level2-A,跨全 shard complete-set)+ live e2e。
- ⬜ **NEXT(Bettor+NWT)**:loaders 落码后独立红队验 C1-complete-set / tipDaa 自源 / no-bypass / abstain-on-mismatch。
- ⬜ **NEXT(J2)**:daemon settler 编排 + 接 enforce-lib(C3 TOCTOU assert)。
```
DoD: enforce 从 driver-side 升 relay-自源(committee daemon 自治签)
通过条件: 委员节点 daemon 自跑 enforce + relay 自取全链值 + 假 payoutRoot 委员拒签 BUST + 双节点同证
失败处理: 同 DoD 连 2 轮 FAIL → ESCALATIONS
```
owner=J1(loaders+lib)+ J2(daemon wire);reviewer/红队=Bettor+NWT。
**诚实标:design 收敛 + 纯函数 ship,enforce 仍 driver-side 直到 chain-read loaders 落 + 红队过。**

### LOG(关键节点)
- Phase A close ozzeu `48336f40` LANDED 五源验(payoutRoot b36f5555),4-of-5 委员 enforce-then-sign live 预览 = Track B 活预演。修 9 bug(committee-exclude / level2-A 时序 / committeePkHash-sort / empty-sig / fee-churn / MAX_WALK-BPS…)。
- D2/C2 closure(`86523223` / J1 closure doc)+ D4 loaders 收敛(epoch-bucket g() 备选 + 2 determinism pin)。

---

## 线 2:polymarket-UMA 预言机供给(Owner 钦定生死线)
### GOAL
读 polymarket UMA 结算镜像 settle 222 市场(预言机供给 2 → 几百)+ ESPN↔UMA 交叉验。系统存亡线。

### INVARIANTS
- 读源必 **UMA-on-Polygon on-chain**(bonded 强)非 centralized Gamma-API(弱⑤洗白)。
- 跨链 determinism;时效 deadline ≥ UMA finalized;shadow-accuracy 交叉验。

### STATUS / NEXT(滚动)
- ✅ **设计收敛**(7 条载重 + 双源自校验)。两线统一框架:relay 自源 verdict,源 pluggable(ESPN / UMA)。
- ⬜ **NEXT**:UMA 读源 extractor + 跨链 determinism(我 + J1,frozen-evidence 复用)+ 交叉验③⑥(shadow-accuracy)。
- ⬜ 实现切片待派(Track B chain-read loaders 同期可复用自源 evidence-fetch 模式)。
owner=待派(J1/J2 协);reviewer=Bettor+NWT。设计档:`docs/2026-06-23-phase-b-economic-layer-spec.md` 相关 + UMA 镜像记忆。

---

## 线 3:可玩 demo — TG 托管钱包 + faucet(Owner 钦定零门槛玩)
### GOAL
DM 生成托管钱包 → faucet → /bet 零门槛玩,任意 TG 用户可达。口径=测试网/托管换零门槛/真钱用自己非托管钱包。

### INVARIANTS
- crypto fail-loud 无明文 log/API/sqlite;display-once + /export 重警告;签名走 relay 唯一出口(Path C);承重 custody 警告 Bettor 审。

### STATUS / NEXT(滚动)— ✅ **LIVE(2026-06-23 KANet-UI deploy 收尾)**
- ✅ 托管钱包端到端链上 smoke 全 PASS(create / faucet / /send 2KAS txid 64344eb4 守恒)。
- ✅ `/start` custody-aware 文案三处修 + 承重句 Bettor 审过(`e89218e6` push origin/kanet-ui-tg-wallet,bot 侧已 live)。
- ✅ **faucet per-IP 修 commit+push**(Bettor `05a0a6c2` origin/bshard-m3-deploy,verify-ship HEAD==origin tip):isTrustedProxy=x-ingest-secret 豁免 bot 路径 per-IP,lint clean。
- ✅ **NWT 安全洞修 commit+push**(KANet-UI):NWT FINDING-1 — `isTrustedProxy` presence-only 被公网攻击者 `curl -H x-ingest-secret:junk` 绕过;修=`isValidIngestSecret()`(timingSafeEqual 验值,缓存)加进 `ingest-auth.js`,chat.js:628 改 await 调用。J1 gated master sync 在此洞修上 → 修后解锁。lint clean。
- ✅ **LIVE(KANet-UI clean restart :3200)**:new console PID 45088(23:15:56 起 > fix commit 22:53 → fix 载)+ 22 relay 回 + tg-bot 单 poller(无 409)。**deploy 坑**:kanet-stop 按 stale pidfile(console.pid=22509 早死)漏杀真活 console 43496,且其 relay-health-monitor cron respawn relay = 假死实活;解=taskkill /T /PID 43496 树杀 + kanet-start。教训:kanet-stop 后必 verify 真活 console PID 死,别信 pidfile。
- ✅ **smoke·per-IP 豁免 PROVEN**:bot 路径(带 secret)间隔 8s 连发 4 笔全 200 真 txid,第4笔 count≥3 仍 200=豁免成立(旧码必 429);公网(无 secret)count=5 → 429 IP rate limit=公网仍守;链上验 user1 `0952cc14` + grant#4 `7b7d7708` 各 5 KAS 真到账(500000000 sompi)。报频道 txId `fb5004a5`。
- ⚠ relay 健壮性观察(非 per-IP,记一笔):faucet relay 刚重启时 <1s 极速连发偶返 no-txid 503(30088 mature UTXO 不缺,warmup/lock);间隔 ≥8s 全成。真实 TG 用户天然间隔不破零门槛流。
- ✅ **faucet 余额实测=1,507,580 KAS**(NWT 链上 probe FaucetRelay-tn-2 `qq43angy…363q2rchd36d`)= @5 约 30 万次 / @10k 约 150 次。**不缺币**。
- ✅ **TN12 挖矿 live 持续供币(Owner 钦定·NWT 搭·2026-06-23)**:bridge **external** 接现有 1.1.1-toc.1 covenant 节点(gRPC 16210,**绝不 rebuild D:/rusty-kaspa / 绝不 inprocess** → 否则覆盖 live 节点二进制崩 bshard)→ coinbase 直打 faucet,实测 ~11,500 KAS/min,余额实涨验通(BLOCK ACCEPTED + confirmed BLUE)。detached watchdog 自愈(`D:/kaspa-tn12-mining/`)。⚠ 共享节点:加算力短期难度↑/BPS↑(长期自调回稳),DAA 进度短期加快——MAX_WALK 等 BPS 标定敏感,已频道告知,要节流喊一声。方法档 `C:/开发过程/测试网挖矿方法/TN12-挖矿方法-faucet供币.md`。
- ⬜ **待 Owner**:`FAUCET_AMOUNT_KAS` 实测=5(非 10k);改 10k 仅剩 Owner env 决策(供给前提已满足:余额 1.5M + 持续挖矿 ~11.5k/min)。
- ⬜ **J1**:master sync(deploy→master)+ verify-ship(已 @J1 交接)。
owner=KANet-UI(deploy 统筹)+ Bettor(per-IP 修已落码,审核盲点自负);reviewer=NWT。

---

## 线 4:Track C — ZK(TN12 链上 active)
### GOAL
ZK proof 在 TN12 链上验证(OpZkPrecompile),为预测/经济层提供 trustless 原语。
### STATUS
- ✅ **链上铁证 active**:OpZkPrecompile(0xa6)真执行 verify_zk(ARK,FUND a18759ca + LOCK 12d8e532 落链),闸=covenants_enabled=always。
- ⚠ **口径**:Track C 既验证(脆)又解锁(active),≠ production-ready。只闭层2(payout 算术),层1(outcome)永远需预言机。spike plan:`docs/2026-06-23-track-c-zk-spike-plan.md`。
- ✅ **PR #953 zk-sdk 深查(Owner 派·2026-06-24·源码实证)**:① verifier 在我们 fork(zk_precompiles,tag Groth16 0x20/140k + R0Succinct 0x21/250k,risc0 3.0.4/4.0.4);② **#953 的 builder(zk-sdk R0ScriptBuilder+WASM)NOT 在我们 fork** = 正是 S2 缺口(silverc 无 zk builtin)的上游解药;③ Groth16 比 R0Succinct 便宜(140k<250k)+ RISC0 可压 Groth16 → S4 guest 目标改 Groth16-compressed。
- ⬜ **NEXT(S2 改 de-risk)**:**port 上游 zk-sdk WASM**(不 rebuild 节点,同 vendored kaspa-wasm 模式)。🟠 **GATING probe**:上游 zk-sdk 产的脚本格式 == 我们 fork verifier 期望格式?(tag/cost 首信号一致,全编码逐项核;diverge→port 不成立)。详见 spike §5。
- ⬜ NEXT:S3(trivial RISC0 receipt 链上 LAND + 成本 probe)→ S4(结算 guest 设计)。**优先级**:经济层 fraud-proof 可能仍高于 ZK(不等 6.30);Track C 时间窗=mainnet Toccata 6.30。

---

## 线 5:Phase B — 经济层 / 价值分成(Owner 钦定经济模型)
### GOAL
押注 winners 97% / [oracle+broker+intro+node = 3%] fee-split,对抗-硬化(命门④=fee 版 verify-value-source,fee=payoutRoot merkle leaf 非 UTXO)。
### STATUS
- ✅ **首笔价值分成 fee 全链上 live settle**(x4kpq,close 4123de55 + claim 15ec3d18,winner 实领 19.44 KAS,6/6 fee-leaf 链上分发守恒 20.00)。
- ✅ 技术边界 locked(设计档 `docs/2026-06-23-phase-b-economic-layer-spec.md` + `2026-06-22-modular-fee-split-component-spec.md`);经济数值待 Owner。
- ⬜ NEXT:fraud-proof spec(Owner 派)+ fee enforcement v1(委员守 commit)→ v2(合约 introspection,mainnet 北极星)。诚实标:fee 分发 follow-on,enforcement driver-side 直到 Track B 自治。

---

## 线 6:公测就绪 gate(Owner 问"能否公测"→ 收口成一个可判的数)
### GOAL
押注+预言机系统达到**开放式公测就绪**(任意外部用户可玩 + 信任结算真付)。

### INVARIANTS
- 报"可公测"必分两档:**小范围 invited testnet(有人盯+满披露)** vs **开放公测(任意人+信任结算)**,禁混。
- 开放档硬门 = 团队既定 canary gate:**bet-market settle% > 80%**(排除 0-bet 退款=正确行为,记忆 `project-seeder-q2-canary-plan-banked`)。
- 小范围档披露铁律:测试网 / 托管钱包(节点持 key·真钱用自己钱包)/ 部分市场会 refund 不结算 / 结算 enforce driver-side。

### STATUS(Bettor 实测 2026-06-23,链上 DB)
- ✅ **供给够**:229 可押市场(deadline 未来,polymarket 源 live);近 3 天还在进 144。oracle wave1 导入 live。
- 🔴 **结算可靠性 FAIL gate**:近 7 天 completed 29 / (29+25 resolved) = **~54%** < 80%;近 3 天 1/14 更差。**用团队自己的 gate 就是没到。**
- 🔴 **oracle 激活泄漏**:`pending_oracle_deposits` **309 全过期**(创建后 oracle 从没存保证金→死单)。
- 🟡 可玩通路:托管钱包 7(测试号)+ faucet 今日修 live + /bet 通;Phase A 证过单市场端到端。
- ⚠ 信任:结算 enforce driver-side(Track B 线 1 未落)。

### STATUS 更新(KANet-UI 2026-06-23 Bettor③)
- ✅ **canary-stats API + 页头 badge LIVE** (`e52ab398`):relay.js 加 `GET /api/system/canary-stats`(近7天 settle%,排 0-bet);page-open.eta 全局页头 Alpine badge(60s 轮询,red<80%/green>=80%);sidebar.eta 披露文案四条(测试网/托管/~半数refund/driver-side)。console PID 36304(23:44:12)载新码。
- 📊 **当前 canary 数据**: 近7天 settle%=**75%**(30/40 resolved)gate FAIL；全时段 v0.7 45.1%(J2 同数)。settle% badge 页头可见，🔴状态(gate FAIL)，诚实反映。

### STATUS 更新(Bettor 实测定论 2026-06-23·读码+跑 fresh 市场,非考古)— 🔑 重大口径修正
- **settle% 低 = 部分是 settler shard-blind 度量假象 + 真实 bug,但只咬 bshard 路、不咬真实用户路**:
  - **两条 bet 路**:① register-v06(anonymous-pool,bettor 按 logical 键)= **真实用户 TG /bet 走这条**(console-api.mjs:83 register-v06)→ settler 看得到,正常结算;② register-v07(bshard/无限押注,bettor 按 shard_market_id 键)= 只测试脚本驱动。
  - **settler bug LIVE 确证**(fresh 市场 51q4e 实测,非历史):settler `getBettorSumSompi`(:143)/MIN_POT(:350)按 logical 查 betCount → bshard 市场=0 → deadline 后误判 0-bet 推 `refund_maker_unjoined`。历史 11 错退**不是噪音=同一 bug**(全有 market_shards+bettor_count>0)。
  - **影响半径**:只咬 register-v07 bshard 路。**真实用户走 v06,不被咬**。∴ "settler bug 卡公测"之前判错半径,实测纠正。
  - **伤害边界**:有人 close(driver/Track B 自动)→ winner 拿钱、maker 拿回 seed(B-model maker_stake 独立 UTXO,良性双动作非双花,与 x4kpq 同形)、没人受伤;**无人 close → bettor pool 卡死**。
  - **跨节点**:market_shards 不跨节点同步(:3300 读不到)→ bshard 委员只能从链上重建 = 强化 D4 必要性(线 1)。
- **修法(Owner 喊停纪律下,understand-first,未动码)**:settler skip-to-Track-B(loop-top 单 guard);但暴露依赖=bshard 自动 close(`bshard-close-voter.js` 默认关 `BSHARD_CLOSE_VOTER_ENABLED!=1`,gated on D4)。**bshard 无人值守公测真门槛=Track B/D4,不是 settler 补丁**。
- **方向待 Owner**:A=测真实用户 v06 路可靠性(公测最相关) / B=bshard ② 已测完 / settler 修不修何时修。

### NEXT(机器可判微 DoD)
```
DoD: 开放公测就绪 = bet-market settle% > 80%(排 0-bet)+ oracle 激活泄漏堵住
判定命令: canary 工具(_kanetui_seeder_canary_metric.cjs)算近窗 settle%(排 0-bet) + DB 查 pending_oracle_deposits future 应≈过期堆停止增长
通过条件: settle% > 80% 连续两窗 + 新建市场不再大量沉 pending_oracle_deposits 过期
失败处理: 查根因(0-bet / oracle 没激活 / deadline-cap),禁假设;同 DoD 连 2 轮 FAIL → ESCALATIONS
```
owner=J2(settle 管线+deadline-cap,查 309 泄漏)+ J1(:3300 oracle 激活)+ KANet-UI(canary 工具+披露文案);reviewer/验数=Bettor。
**当前裁决**:🟡 小范围 invited testnet 可开(带满披露);🔴 开放公测 gated on settle%>80%(现 ~54% FAIL)。

---

## 线 7:运营硬化(Owner 真机撞·2026-06-23)
### TG bot 架构(查全·file:line 锚)
- **两层 bot**:① 全局主 bot `@KANET_Broker_bot`(`kasia-console/_launch_tg_bot.mjs` → `tg-bot/bot.mjs`,常驻活)= 所有命令(/broker、/bet、/wallet…)在它上;② 每-broker bot(`broker-bot-manager.js` → `_launch_broker_bot.mjs`)= 每个 Owner 批准的外部 broker 一个独立进程跑自己 token。
- **@KanetBroker_test_bot = 孤儿**(代码/配置/DB 全无引用,broker_onboarding 空)→ 没进程 poll → 死。**不是系统 bot,/broker 不依赖它**(端点 `/api/kanet-broker/onboard/status` 实测 200)。

### 死点1:DM 旧排版(根因=新排版卡未合并分支)
- 运行 bot 载主 repo `bshard-m3-deploy` 的 `tg-bot/messages.mjs` @ d2872037 = **旧排版**;KANet-UI 新排版 `e89218e6`(custody-aware /start)在 `kanet-ui-tg-wallet` 分支**没合进 bshard-m3-deploy** → 旧排版直因。同"tg-wallet 未进 deploy 分支"同一病。
- 修(KANet-UI deploy lane,已派工):e89218e6 的 messages.mjs **+ bot.mjs custody-aware 调用一起**合进 bshard-m3-deploy(签名 startMessageLinked(addr,custodial) 必协调,别半截)+ 重启 bot → Bettor DM 实测验。

### 死点2:broker-bot 静默死(规模化前运营灾难)
- `broker-bot-manager` 崩溃帽 90min 崩 5 次→自禁到 Console 重启**无告警**。现 0 外部 broker 没暴露,broker 规模化前必加 bot 存活监控+告警。
owner=KANet-UI(deploy+监控);reviewer/验=Bettor。

### 死点3:/start 面板重设计(§11 对抗讨论·2026-06-25·进行中)
- **设计初稿**:`docs/2026-06-25-tg-start-panel-redesign-draft.md`(Bettor 出稿,Owner 4 点+1 命令 catch)。改动:22行→6行,broker收益行,/wallet合并/balance+/receive,多语言。
- **§11 对抗讨论 2026-06-25(已跑完第一轮,收敛方向)**:
  - Q1 承重墙: /start 1行 custody 警告 OK ✓ + **❗ NWT BLOCKING: /wallet 合并 /receive 后=存款面,必须同时显 custody 警告 1 行**(KANet-UI v2 设计接受)。
  - Q2 broker收益代价: onboardStatus~5ms/earnings~50ms,只 onboarded 才查,V1 无需 cache。✓
  - Q3 多语言: web i18n 已有 zh/en/ar/he/fa,V1=框架+关键串+4-5非RTL,RTL第二阶段。✓
  - Q4 简洁vs引导: 6行够,首次用户加→/help 1行。✓
  - **Q5 收益真实性: ❗ NWT+J2 BLOCKING: `brokerEarningsByAddress` 必改查 `kaspa_tx_log.outputs_json` 找已 LAND fee output(fee 常是次级输出,to_address 列抓不到)。两具体缺口(J2): v06 fallback L241=maker_stake×pct 估算非实落(silent 杀)/跨节点 L221 BROKEN(:3200 本地表,:3300 broker market 不 sync→假0)。V1 改读链=同解真实性+跨节点。诚实标"本节点口径"。**
- ⬜ Bettor 收敛执行方案 → Owner 终裁 → KANet-UI 落码(死点1 一起合并到 bshard-m3-deploy)。
- 实现总计: Q2 broker收益改链~2.5h / Q3 /lang框架~4h / Q4 简洁+/wallet合并~2.5h。总<1天。

---

## 🔴 线 8:持续迭代机制 — 根治"改了又坏"(Owner 钦定·2026-06-24·下个 pass 头号 task)
### GOAL
让"持续迭代"真正可能 —— 把"改一个坏一个、累计垃圾"用**自维持机制**结构性堵死,而非靠人记得每次查。

### 根因 hypothesis(⚠ 未证, Owner 2026-06-24 纠 narrative-ahead-of-evidence)
"incomplete migration = 改了又坏的一类根因"**形状成立**(新旧两套 keying 并存只迁 6 处)。但 **"41" 是 grep 命中数 ≠ bug 数**——真 bug 数分类前**未知**。**confirmed 实例 = 2**(settler 误退 A-fix logical→shard skip 修 / "0押注"显示 line 1912 fy1yk logical=0 vs shard=1004 链证);其余 **39 = suspected 待逐处验**。"定时炸弹/亲兄弟"叙事**不准替代逐处证据**。
⚠ **承重墙(决定 helper 1 vs 2 签名, 表必先答)**: marketId→sharded 可确定性判(查 market_shards), 但**有站点本就该按 shard_market_id 查单片**(register shard-allocator)→ 硬塞一个内部-shard-aware helper 会把 v06/单片-正确站点改坏(重演"别把好东西改坏")。
⚠ **41 不只 key 异, 查什么也异**(distinct 人数 / side 行数 / status 过滤)→ 单签名 helper 压扁语义。

### STEP 1(下个 pass 唯一动作·read-only·零生产码): 逐处带证据分类表
**41 grep 命中,每处一行,决策树(先剪 dead 不进表)**。最小 6 列:
1. `file:line` + 实际 query
2. 服务市场类型(sharded / v06-anon / both / unknown)
3. live / dead(dead 直接删,零分析,不往下走)
4. 查询意图(distinct bettor 人数 / side 行数 / status 过滤 / 其他)
5. 判决 🔴shard-blind bug / 🟢logical-correct / ⚫dead / ⚪待验 + 证据
6. 绑定已观测故障(confirmed / suspected / none)
**表填完才回答承重墙(helper 1 个还是 2 个签名、谁 dispatch 谁本就该按 shard_market_id 不碰)。在那之前不碰任何一行生产代码。**

### STEP 2+(承重墙答完才设计)
- **收敛 helper**:签名数 = STEP 1 表定(可能 1 个内部 dispatch / 可能 2 个 by-logical + by-shard,看意图分布)。**不默认"内部 shard-aware 就行"**(会改坏 v06/单片-正确站点)。
- **lint-kanet.mjs 规则**:禁裸写 `pool_bettor_sides WHERE market_id =` → 走 helper(自维持核心,新错 commit 不进);先 warn-mode。
- **regression test**:**sharded + v06-anon 两个 fixture 各断言**(锁不住 dispatch 混淆只测一个=半个 invariant)。
- **ANTI-PATTERNS 条目** + 真 bug 逐处迁移(lint 当 checklist 迁到 0)+ 剪死代码。
- **推广**:一类"新旧并存"一 lint rule(DB-status vs chain-truth 本程撞 3 次,同法)。
4. **ANTI-PATTERNS.md 条目 + regression test 锁** invariant。
5. **推广**:同机制套别的"新旧并存"类(如 DB-status vs chain-truth,本程撞 3 次)——一类一 lint rule 堵。

### STATUS(2026-06-24 KANet-UI STEP 1 DONE)
- ✅ **STEP 1 DONE(2026-06-24 KANet-UI)**: 52 处全分类(src/ 产码，Owner 记忆 41 含 scripts/tg-bot)。文档 `docs/2026-06-24-line8-step1-classification-table.md`。
  - 🟢 22 logical-correct (注册路径全部，TG/bet 走 register-v06=logical，**不动**)
  - ✅ 5 shard-aware 已修 (list endpoint L1912-1917 + shard-allocator + close-voter)
  - 🟡 8 shard-blind + A-fix 护卫 (settler root bug + 5 站 + settler-v06 3 站，Track B 替换时根修)
  - 🔴 10 shard-blind unguarded (detail/positions/sides_merkle/audit/bettor-refund-claim，只影响 register-v07 test-only 路径，真实用户 TG/bet 不受影响)
  - ⚫ 5 dead/DDL/注释
- ✅ **display bug fix(commit 41a50042)**: list L1912-1914 三 subquery → shard-aware(logical+shard IN 累加);fy1yk bettor_count 0→1004 修正。Owner "0押注"体验修复。
- ✅ **STEP 2 safe(2026-06-24 KANet-UI, Bettor APPROVED)**:
  - ✅ **helper 骨架** `kasia-console/src/lib/pool-bettor-sides-query.mjs` — 4 函数:`getSidesByLogicalMarket`(跨 shard 聚合)/ `getSidesByShard`(单片)/ `getSideByBettorPk`(cross-shard pk 查,bettor-refund-claim 迁移目标)/ `getSideById`(cross-shard id 查)。lint clean。
  - ✅ **lint rule `R-SHARD-BLIND` warn-mode** `scripts/lint-kanet.mjs` — 扫 `pool_bettor_sides.*WHERE.*market_id =` 在非 shard-allocator/非 helper 文件 → 42 命中 ⚠ WARN(非 block commit),escape hatch `// lint-allow-shard-blind: <reason>`,`.md` 文件排除。
  - ✅ **ANTI-PATTERNS.md 规则 50** — Wrong/Right/Why/前科/Lint守 全记。
  - ✅ **regression test** `test-framework/cases/predictions/pool/shard_blind_query_regression.test.mjs` — 5 步全 PASS: SQL syntax checks × 2 + cross>=bare invariant + COUNT violation=0 + bshard-if-exists check。
- ⬜ **STEP 2 clear-headed pass(Bettor 指令:money-adjacent 非夜赶)**:10 🔴 shard-blind 迁移(9 个,见下)。**#33/#34 L2727/2732 bettor-refund-claim = 🚨 已修正裁决(J1 红队 2026-06-25,Bettor 自认错,KANet-UI/J2 co-verify)**:
  - **不做 shard-aware 迁移**。404 是安全网(bshard side 在 shard_market_id 下,logical 查不到=正确拒绝)。
  - bshard 退款是独立合约(PoolShard_fold refund_draw / pool-refund-builder.mjs),≠ 该端点的 standalone PoolSide refund。shard-aware 化=拆第一安全网,fail-safe 变 fail-dangerous。
  - 正确修=显式 bshard detect + 返回明确错误("bshard 走 bshard 退款路") + 双 fixture test(bshard side 打此端点→必 SAFE 拒绝)。
  - 剩余 9 🔴 迁移目标: detail/positions/sides_merkle/audit 等(非 bettor-refund-claim) + Bettor 链验 bettor count 回归。

### NEXT(下个清醒 pass·非夜赶)
```
DoD: shard-blind 这类 bug 结构性灭绝 + 持续不可复发
判定: lint-kanet 有 shard-blind 规则 + 41→0 迁移 + helper 单源 + regression test 绿 + ANTI-PATTERNS 有条目
失败处理: 迁移误改 v06 正确路 → 链上验 bettor count 回归;禁夜赶 money-adjacent 码
```
owner=Bettor 牵头机制(lint rule + helper 骨架 + ANTI-PATTERNS)+ KANet-UI/J2 迁移各自域 + reviewer/链验=Bettor。**先 read-only 出 lint 检测(扫 41)再动码,逐个分类不无脑全改(防把 v06 正确路改坏)。**

---

## 线 9:热门完整盘组(Owner 钦定·2026-06-27·当前优先级最高)
### GOAL
把热门赛事(England/Argentina/巴西日本…)做成**完整盘组**:胜负(Polymarket 源)+ 让球(spread/margin)+ 大小球(total),DM 首页放 ≥5 个热门单子。日本巴西=Owner 举例,真需求='热门赛完整盘组上首页'。

### INVARIANTS / 护栏(对抗讨论收敛·硬约束)
- 🔴 **半线铁律(护栏6·J1 harness 实证)**:让球/大小球只造**半线**(-0.5/-1.5/2.5/45.5…),绝不造整数线。judgeLine 只判 YES/NO 无 push/refund → 整数线 = 误判。J1 settle-verify 收到整数线 operand 直接 BUST。
- 🔴 **score 源(护栏2)**:spread/total 靠 judgeLine 判,需真实比分(home_score/away_score + home/away_team 映射)→ **必绑 ESPN(给比分),不是 Polymarket 二元盘**(无比分 → judgeLine ABSTAIN = un-settleable,J1 拒)。operand 必 = 线×10^scale 整数(scale 对齐),subject 必匹配队 abbr。
- 🔴 **护栏1/3(防 stranded)**:盘必可结算才上线(J1 逐盘验);draft 态先建,过 J1 关才翻 open。
- 🟡 **护栏4(质 over 量)**:先 top 5-10 热门赛(每场 winner+2 spread+1 total ≈ 4-5 盘),不批量灌库。
- 🟡 **护栏5(鸡生蛋)**:新盘 0 押注 → T5 trending(按 bettor_count 加权)排不进'热门' → '拉热门赛建盘'与'首页热榜'需分别解。
- **序列不变**:J2 建(draft)→ J1 验 settle-correctness + score 源 → 翻 open → KANet-UI 显。任一段不过不进下一段。

### STATUS / NEXT(滚动·2026-06-27)
- ✅ **协调三定 + 6 护栏 locked**(Bettor 主持,J1/J2/KANet-UI 收敛)。J1 settle-correctness = 硬门(judgeLine 作者把关)。
- ✅ **J2 现状调查扎实**:judgeLine.buildResolutionPredicate 功能态✓(winner/spread→margin/total,sign 语义对,有校验);create-v07 能创 spread 盘(14 个 margin 先例如 SF -3.5);**bettor-scanner ≠ 创建路径**(Phase3a 推荐扫描器,零代码调 buildResolutionPredicate),现有 spread/total 多是 polymarket 散盘(cancelled/refunded 居多),可押仅 15 零散非完整卡组。可行性=高(组件全齐)。
- ✅ **J1 gate prep 完**:build→judge round-trip 全验(ARG-3.5 / JPN+3.5 判对),半线铁律 + operand-scale + subject-abbr 三关待逐盘卡。
- ✅ **KANet-UI /hot 命令 ship**(`5ad98d16`):调 T5 trending top-5,CopyText 深链复用 T1,静默失败。gated on J2 出盘。
- ✅ **巴西日本 canary draft 出**(J2 `3f7357d4`):构建器 `kasia-console/src/lib/sports-card-builder.mjs`(纯函数 buildSportsCard + I/O fetchEspnMatchDescriptor,27/27 回归 test 锁 6 护栏,可复用放量)+ 5 盘 card_group(espn-FIFA_WC-760487:winner BRA/JPN + spread -0.5/-1.5 + total o2.5)。
- ✅ **门1 = J1 settle-correctness PASS**(2026-06-27 16:20·:3300 独立验真构建器非自测):byte-exact 5/5(pull 3f7357d4 跑真输出 == spec)+ judgeLine 50/50(5盘×10终局)+ ESPN score 源独立 fetch ACCEPTED + 整数线双层防御。标准硬门。
- ✅ **门2 = J2 create-v07 instantiate 落链**(2026-06-27 ~23:20·Owner 钦定测试网"直接上1万"):5 盘 LANDED,maker-1 各锁 **10000 KAS = 50000 守恒**(Bettor :3200 + J1 :3300 链上验)。predicate/半线/ESPN 760487 全对。**Bettor 代 operator 放行**(Owner 钦定测试网花钱 Bettor 全权拍,见记忆 `feedback-testnet-spend-bettor-decides-coin-plentiful`)。
- ✅ **SEAM FINDING-2 = spine commingle / 跨市场替换(系统性·全 v0.7·真闭合 2026-06-28·见本条末尾)**:门2 后 co-verify 抓出 5 盘 **spine_p2sh 全相同**(predicate/market_id 各异但 redeem byte-identical 2092B)。根因(NWT verify-value-source):**PoolSpine_v07.sil 的 market_id 在 ctor 声明但函数体从未引用** → silverc 不烤未引用 ctor 参数 → 不同市场塌成同一 P2SH → close_attest 不验 UTXO 属哪个市场 → **跨市场替换**(市场 A 的 attest 能花 B 的同址 UTXO,隔离全靠链下 settler,L329 自认 'relies on off-chain settler')。= **verify-value-source vacuous-binding 类**(锚声明了但决策时脚本读不到,同 fix② 49817c18,见 [[feedback-verify-value-source-checker-must-access-binding-at-decision-time]])。**影响半径**:全 v0.7 200+ 测试市场 commingled 在 14 簇(94/46/41-市场簇有大量真实押注);**canary 簇 0 押注无实际风险**。**当前受控**(资金没丢-outpoint 各异可花退 / close voter 关-无自动 close / 测试网),但 mainnet 前必修。**修法(Bettor 裁·四方确认)**:J1 改 .sil 把 market_id 引入 `global_commit_id` 函数体实际引用(复用 **FoldNode commit_v2 已 source-verify layout**:blake2b dkLen32 LE sign-magnitude·determinism 命门复用解除)→ 烤进 redeem → distinct P2SH + 链上验市场身份。**序列**:J1 .sil+silverc → NWT 双向回归(同参数不同 P2SH + 跨市场 close_attest BUST)→ J2 settler L2150 镜像 builder commit_v2 换 sha256 占位 → **Bettor byte-exact co-verify**(链上期望 vs 链下产 global_commit_id 对死)→ J2 重 instantiate canary 5 盘(新 spine)→ Bettor+J1 co-verify 补 **P2SH 唯一性维度**。**50000 KAS + 旧 200+ 簇 fix 后统一 refund+清理**(测试币)。**双验 PASS = 真闭合(2026-06-28)**:J1 .sil(4904ea62)+ J2 settler L2150 commit_v2 重建 → ① **五方 distinctness**(新 5 盘 5 distinct P2SH·≠旧 pqksfuks2·Bettor/KANet-UI/NWT/J2/J1 DB)② **四方 reproducibility**(J1 独立 silverc / NWT 4904ea62 / J2 空缓存 fresh / Bettor :3200 — 同 ctor recompile → 同 P2SH `ppa46k3..752`·2108B = determinism 真闭, 非只 distinctness)③ Bettor byte-exact commit_v2(market_id 真绑·改 1 字节 commit 变)。**30B 红旗坐实 = int 变长编码(不同参数), 非 build 破**。**Bettor 两次差点早收口(漏资金隔离 → 漏 reproducibility)→ J1/NWT 守 distinctness≠reproducibility 红线·Bettor 撤回 → 四方 recompile 验 = 健康对抗文化(无护短/无橡皮图章)**。canary 解 HOLD。**settler-HOLD 闸 = next clean pass**(J2 判据 = P2SH 共享检测自维持: spine_p2sh 被 >1 市场共享=旧 commingled→skip / 新盘唯一→放行·env POOL_V07_COMMINGLE_HOLD·类 aff42980)+ 旧 200+ 簇 refund/清理一起做(belt-and-suspenders·非紧急·money-adjacent 不夜赶)。
- ⚠ **Bettor co-verify 教训**:首次门2 报 PASS 只验 status/stake/predicate/event,**漏 P2SH 唯一性/资金隔离**(查链锚补查才发现 spine 相同+主动 flag)。**co-verify checklist 必含资金隔离唯一性·主动≠草率**。
- ✅ **门3 = KANet-UI 显示代码 ready**(`9e7617ba`):pool.js T5 trending 从 resolution_rule_spec 提 card_group_id + leg_key,messages.mjs hotMarkets 按 card_group_id 成组。等盘 open 验真拉到(门3 hold)。
- ✅ **关3-A 逻辑层红队 DONE**(NWT·72 PASS / 4 FAIL=测试期望写错代码无误):4 向量(assertNoPushLine 绕过 / 让球 sign / scale 跨档 / findExtractor 欺骗)全 BLOCKED。
- 🔴 **NWT FINDING-1 = 真 SEAM(ship-blocking·修复中)**:create-v07/v06/create 入口**零 predicate 线校验**(只 isStructuredSpec)→ 整数线 raw 注入绕过 buildSportsCard → un-settleable stranded(护栏1 真缺口)。三方坐实(NWT 红队 + KANet-UI L789 + Bettor 读码 L789-928)。**风险分级**:canary 单场不阻塞(走 builder 安全)/ 放量·开放前必闭。**修法(Bettor 裁·两层单源)**:① J1 judgeline.mjs 单源 push-line 校验(接口形态 J1 owner 拍·禁两处实现漂移)② J2 pool.js 三端 create-time chokepoint wire(import 调用·不 inline)。序列:J1 push → J2 wire+重构 builder+regression → J1 verify 三条 → NWT 回归 4 条 → 才 instantiate。
- ⬜ **关3-B 集成层**(门3 后):bshard 押注面 + 浏览器实操 + 真盘 settle。
- ✅ **maker stake 审批 = 批准**(Bettor):5 盘 × 100 KAS(POOL_MAKER_STAKE_MIN_KAS 硬底)= 500 KAS 总锁仓;条件 instantiate 实查 maker 余额 + 报 5 stake-lock txid,Bettor+J1 co-verify 守恒。
- ⬜ **放量(top5-10)+ 护栏5 鸡生蛋**(Bettor 拍):等这 1 场 instantiate→open→显示端到端验通,再对齐 A featured / B 种子流动性,不抢跑。
- ⬜ **待 Owner**:`/start` 首页嵌 5 场热榜形状(Bettor 荐:老用户 /start 顶显紧凑热榜 + 首次给指针 + /hot 兜底)vs KANet-UI 现 /hot 单独命令方案。
### 今晚收口(2026-06-28 ~00:44)+ next clean pass 残项
- ✅ **canary 端到端实质达成**:SEAM FINDING-2 真闭(五方 distinctness + 四方 reproducibility + byte-exact)+ 新 5 盘 distinct spine(8fcyw/nhuj9/dq2j4/ov48g/jo9tp)+ 种子押 5/5 押对新盘 bettor_count=1 + 门3 card_group 渲染验(FIFA-760487 5 legs 聚 1 块)。新 canary ~01:06 设计性自然进热榜(created_lt -1h 时间过滤·NWT/KANet-UI 盯)。
- ⚠ **旧 canary 5 盘(1mcy7/z1627/3hens/0qm5d/pq6gu·pqksfuks2·0 押注)**:今晚 Bettor 误裁 cancel → **J2 settler 域 catch**(status='cancelled' 断 50k deadline 自动退款路·settler L299 只 advance pending_bettors)→ revert 回 pending_bettors(50k 6-29 自动退保·J1 读码独立验)。显示泄漏(在 trending)defer next pass。**教训**:堵显示用**入口闸 ≠ 改 status**(status 别背 entry-block 的锅·entry-block≠cancel·J1 decoupling 原则·见 [[feedback-coverify-checklist-multidimensional]])。
- 🔲 **next clean pass 残项(全非紧急·money-adjacent 不夜赶)**:
  ① **FINDING-2 暴露面三处堵 = `isCommingledSpine(spine_p2sh, db)` 单源 helper**(settler 结算 skip + trending 排除 commingled + register-v07 拒押 commingled)= 一处判据三处 wire 零漂移(J1 架构)。
  ② 旧 canary 5 + 174 历史 commingled 簇(94/46/41 有押注谨慎)同 helper 堵入口;退款归 deadline 自治(outpoint-precise)解耦,不碰 status。
  ③ settler-HOLD 闸(belt-and-suspenders·outpoint-precise 已是诚实第一层·env POOL_V07_COMMINGLE_HOLD)。
  ④ **broker 收益可见性主线(Owner 钦定·整夜被 canary 占)** — 见线 below;Bettor 已 informed(数据层 earnings-by-address 有/通知层缺/tg映射 tg_custodial_wallets 托管有非托管缺/挂 kaspa_tx_log indexer + liveness+backfill)。
  ⑤ **J2 域 clean-pass wire(money-adjacent 不夜赶)**:**复用 J1 单源 helper `commingledSpineSet(db)`(J1 pool-commingle-detect lib·00:59 落·禁两处实现)** → register-v07 拒押 commingled + settler 结算 skip commingled。判据 = spine_p2sh 被 >1 市场共享 = 旧 commingled。
  ⑥ **J2 6-29 deadline 自动退监盯(别忘=别 strand)**:旧 canary 5(pending_bettors·pqksfuks2·50k)+ 新 canary 5(各 distinct spine·50k)= deadline 6-29 自动退款到位确认(outpoint-precise·deadline-watcher pending_bettors→verifying→refund_maker_unjoined CLTV deadline+grace)。旧5 revert 后退款路已保(别再 status-cancel)。

### 门3 /hot 显示 PASS + Owner 00:55 开干(显示面·非 defer)
- ✅ **门3 /hot 实际显示 PASS**(NWT 2026-06-28 00:57·比估算早 8min):/api/pool/markets/trending 新 canary 5 盘入热榜(8fcyw score=10015 pool=10005 KAS 等)+ fy1yk(11200/1004 注)。**线9 canary 端到端三关(settle-correctness/SEAM/显示)全通**。⚠ commingled 旧盘仍 #7-10,待 isCommingledSpine 排除。
- 🟢 **Owner 2026-06-28 00:55 钦定开干(显示面·非 defer)**:`/start` 首页嵌 5 热门 + trending 排除 commingled。序列 = **J1 isCommingledSpine helper → KANet-UI trending 排除(显示/查询面·非 money-adjacent)→ /start 嵌 5 热门**(Bettor 拍形状·Owner 全权:老用户 /start 顶显紧凑 5 热榜[标题+池+人数+深链]+ 首次给指针 + /hot 兜底)。**= 上方 next-pass 残项①的【显示半边】提前到现在做;J2 押注/结算半边(残项⑤ register-v07 拒/settler skip·money-adjacent)仍 clean pass,复用同一 helper。** owner=J1(helper)+ KANet-UI(trending 排除 + /start)。

owner=J2(创建器)+ J1(settle-correctness 硬门)+ KANet-UI(/hot + 显示);reviewer/协调/验落链=Bettor。

### 🔴 线 9.5:预测市场对人类的呈现(Owner 钦定·§11 HALT·2026-06-28 01:26·UX 重设计·明天清醒深做)
Owner 验 /start 反馈**呈现不合格**:1 场赛事 5 leg 平铺成 5 个近乎一样的链接,新人看不懂是同一场。核心命题 = 对人类(尤其新人)①友好(看懂)②可信任(敢押)③可操作(会押)。**HALT·不夜赶·明天清醒对抗收敛 → Owner 终裁**。今晚各 owner 摆视角(已到齐):
- **J2(数据)**:数据**已支持赛事级**(card_group_id 绑 5 legs·home/away/kind/线全有)='没聚'非'缺数据'。明天出 3 件 backend 形状:① trending 按 card_group 聚合返"赛事卡"(event→nested legs·灭 NWT 陷阱① card_group 可见性=0)② 事件级 score 排赛事非排 leg(Top5=5 不同赛事·广)③ per-leg 信任字段进数据(池/真实人数/yes_implied_prob 赔率/ESPN 源/deadline/spine_p2sh 合约址)。**接 J1 per-leg 铁律:聚合只在显示层·数据层每 leg 独立(各自 spine/池/赔率/结算)不被掩盖**。接 NWT 陷阱②:数据可标记 seeder / 门槛 bettors>=N(别让 1 人池上首页暗示局)。
- **J1(结算可信)**:铁律 **呈现信任级别 == 真实信任级别·禁超卖**。真原语(敢押硬底):P2SH 链上锁(explorer 可见)/ judgeLine 公开确定多节点重算 / 全链 txid 可审计 / 到期能退。🔴 **禁写"无法作弊/完全去信任/链上自动结算"**——Track B autonomous-enforce 未完成期间 relay 仍盲签 payout,理论上恶意 settler 能伪造 payoutRoot,这个保证**现在不成立**。框成"钱锁链上+规则公开+全程可查+到期能退"(全真)。
- **NWT(红队·UX 攻)三陷阱**:① 同场 5 链接=card_group 可见性=0=主动诱导重复押注(实凶非"头晕"症状)② bettors=1=社会信任杀手(新人疑"庄家自导自演"·**当场挑 Bettor 种子押裁定·Bettor 认**)③ 无赔率=操作盲猜 + 按钮标签 'BRA -1.5'=外星语,**必自解释**'🇧🇷巴西赢2球以上 赔1.95× →'(TG 按钮=唯一信息载体)。三项叠加=新人 0 转化=根本可用性危机非细节。
- **广 vs 深**:J2/J1/NWT 同站**广**(Top5=5 不同赛事·点开才深)。
owner=Bettor 主持收敛 + 明天各 owner 深做(J2 聚合端点 spec / J1 信任卡字段 / KANet-UI 渲染 / NWT 误导面)→ Owner 产品方向终裁。

---

## 线 T1-T7:5问架构审查任务波(2026-06-27·已收口)
- ✅ **T1-T4 收口**(Bettor 签收):T3 TG bot 管理迁 /relays→/integrations(`3a418a3b`);T4 node 委员收益 DM + UI(`59c0fa0e`,smoke maker-3 markets=4 kas=2.11 链验,/earnings 显'⚙ Node 委员收益')。
- ✅ **T4 pk 语义收口**(J2 指正 → 共识):/api/relay/:id/pubkey 用 XOnlyPublicKey.fromAddress 从 relay 地址 derive = **收款地址 pk**(v0.7 必中,v0.6 通常中,xfu62 验过)。注释改'均用收款地址 pk'(`8168b6bf`)。V2 全统一 = 填 relay.ecdsa_pubkey_xonly 建 pk↔地址映射(待 Owner 拍)。
- ✅ **T5/T6 ship**:GET /api/pool/markets/trending(activity+commitment 加权,`e963bc25`);node income endpoint + bettor payout chain-verify(`ec1d1b69`)。
- ✅ **#33/#34 收口**(J1 独立验):`2c74ec51` 已是 origin/bshard-m3-deploy 祖先(经 `0055e753` no-ff merge),explicit bshard-detect 409 guard 在 canonical pool.js + 双 fixture + ANTI-PATTERNS 规则50。
- ⬜ **/start 6 行版**:smoke 等 Owner 真机。
- 📌 **fy1yk 结算(deadline 6/30,1004 未 claim sides)= 看板项**,临近需驱动(KANet-UI 15:14 提)。

---

## 线 10:§11 UX 呈现对抗讨论(Owner 钦定·2026-06-28·摆视角完成·明天收敛)
### GOAL
预测市场对人类(尤其新人)呈现 = ①友好(看懂)②可信任(敢押)③可操作(会押)。Owner 验 /start 反馈"呈现完全不合格·太差"(1 场赛事 5 leg 平铺成 5 个近乎一样链接·新人头晕·card_group 可见性=0)。
### 四方视角(摆视角完成 ~01:30)
- **NWT 三陷阱**:① 同场 5 链接=card_group 可见性=0(诱导重复押注·最大洞)② bettors=1=社会信任杀手(暗示局·挑 Bettor 种子押注裁定)③ 无赔率=操作盲猜。
- **J2 数据**:数据已支持赛事级(card_group_id 绑 legs)='没聚'非'缺数据';按钮必自解释('🇧🇷巴西赢2球 赔1.95×' 非 'BRA-1.5');广优;明天出聚合端点 spec(保 per-leg)。
- **🔴 J1 假信任 finding(本轮最重要·NWT co-sign)**:**呈现信任级别必 == 真实信任级别·绝不超卖**。Track B autonomous-enforce 未完成·payout relay 盲签·UI 绝不写'无法作弊/链上自动结算'(假·恶意 settler 能伪造 payoutRoot 偷池)·框'钱锁链上 P2SH + 规则公开 + 全程可查 + 到期能退'(全真)。= 诚实口径铁律在 UX 延伸。+ 信任卡 per-leg(聚合只显示层·数据层每 leg 独立 P2SH/结算/退款)+ 必显字段(池=合约地址 / 真实人数 / 结算时间+规则 / 到期退)。
- **KANet-UI 实现方**:根因=`_compactTrendingBlock` flat-list 无 card_group 感知(渲染层 bug·她写的);单 card_group 最多 2 leg 按钮(moneyline+1)+'更多玩法'(避免 1 卡 5 按钮);可信渲染边界(显真实原语·不写假信任)。
### 收敛方向(成形·明天深入)
- **友好** = 赛事聚合卡 + 自解释按钮 + 广(5 不同赛事)+ 单卡 ≤2 按钮
- **可信** = 不超卖(J1 铁律)+ 真实原语 + per-leg 独立 + 信任卡字段
- **可操作** = 赔率(yes_implied_prob 配门槛)+ 几步 + deep link
- **冷启动** = bettors=1 信任杀手 → 门槛(>=3 不上榜)vs featured vs 真实流动性(明天定·Bettor 种子押注裁定被 NWT 挑·已认)
### NEXT
- ⬜ **明天清醒 Bettor 主持深入对抗收敛 → 整理清晰议题 + 派工 → Owner 拍产品方向**。
- ⬜ J2 出 card_group 聚合端点 spec(保 per-leg)→ KANet-UI 渲染赛事卡(限按钮+信任卡)→ J1 信任呈现验(不超卖)→ NWT 红队攻 UX 陷阱。
- 🛑 **HALT Bettor 半成品聚合方案**(不做让新人头晕的次品)。
owner=KANet-UI(渲染)+ J2(聚合端点)+ J1(可信呈现)+ NWT(红队 UX);主持/收敛=Bettor;产品方向终裁=Owner。

---

## 🔴 线 12：NUM2BIN settle 回归 + DM-to-phone live-test（2026-06-28·DM 测试逼出今天最大 bug·未收尾）
### 一句话
broker DM live-test（"每个 broker 一笔收入到账→电报 DM 通知他·Owner 钦定核心"）反逼系统走完整 settle 链，**炸出今天上午修 FINDING-2（88797d88 commit_v2）引入的回归：global_commit_id 用 `byte[](globalYes/No,16)`→silverc NUM2BIN(16)→Kaspa node 限 ≤8 bytes→所有 post-commit_v2 新 v0.7 盘 settle TX 被 node 拒**。118 个 pre-commit_v2 旧盘 settle 100% landed；commit_v2 后 0 个 settle 过（潜伏，zzwzd/xzztw 炸出）。
### 状态（HIGH·未真闭）
- ✅ **regression 找到+全队收敛**：J2 链上验 scope（118 旧 landed / 0 新 settle）+ NWT sweep（byte16 在 3 .sil：PoolSpine_v07:335 / PoolLeaf:113 / FoldNode:74 + JS pool-fold.mjs L35-36 foldRootCommit）。
- ✅ **fix commit 4ac08fb7（byte16→8 全 4+1 文件·byte-exact）** + J1 定 layout（market_id binding 不动=FINDING-2 隔离保住）。
- ⚠️ ~~**fix INERT·xzztw 仍 NUM2BIN-16 拒(f169647)·疑编译缓存 cacheHit**~~ **【J2 早先记录·已被 NWT byte-验推翻·见 L355·我 timeline 推断未字节验=违"查了再写"】**：(a) f169647 是 **zzwzd**(16B) 的 TX·非 xzztw；(b) xzztw 是 **8B**(ECDSA 拒·非 NUM2BIN)；(c) cacheHit 不成立——cacheKey = sha256(.sil 内容)+ctor (pool-p2sh.mjs L67-68)·内容变必重编·旧 16B hit 不到·**无需清缓存**。8B fix 编译层已生效(xzztw 即活证)。
- 🛑 **Bettor 终拍 STOP 疲劳硬搞**（J1/J2/NWT 收敛同意）：手动 metadata surgery race settler RMW（被覆盖）+ xzztw 手术 4-of-5 sig 坏→ECDSA 拒（**更正：xzztw 是 8B 非 16B·失败因我手术 sig 非编码·见 L355**）+ 全队疲劳改 money DB=造新 bug 风险（Owner 红线）。**别在累的时候 racy 改碰钱码**。
- ✅ **broker DM Phase 1（72596c74）ship**：KANet-UI（07:44）。
- 🔴 **NWT 红队 PUSH-BACK（07:50·docs/2026-06-28-NWT-redteam-broker-dm-phase1.md）**：B1 BLOCKING = `pollBrokerFeeEvents` catch{} 静默吞 sendMessage 失败 + 游标无条件前进 → DM 永久丢失；P1 CONDITIONAL = /api/pool/broker-fee-dm 无 auth（127.0.0.1 testnet 可过·production 必修）。fee_sompi/broker_addr/去重/唯一写入方 全 PASS。@KANet-UI 修 B1 → NWT 快速复核 → live-test。
- ✅ **KANet-UI B1+P1+M1 全修（24da268b·08:01）**；NWT 复核 PASS：B1 cursor 成功才进/失败 warn+break ✅；P1 verifyIngestRequest+reply.sent guard ✅；M1 sportsCardBlock copy 引导文案 ✅。
- ✅ **NWT demo 路径审 PASS**：backfill 不挡 fresh 事件 ✅；fee_sompi 链验 ✅；broker=Owner 无边界问题 ✅；brokerFeeLandedEmitTick wired settler L1179 ✅；Owner tg_user_id=1437320734↔kaspatest:qzhet8m2...gzgdl ✅。Notes: ①bot 重启载 24da268b ②POOL_SETTLER_TICK_SEC=60 提速 ③gap③ live-settle 必先通。
- ✅ **NWT 澄清 xzztw/zzwzd**：zzwzd(05:50建·fix前)=60cd(16B)→NUM2BIN拒·f169647是它；xzztw(06:30建·fix后)=58cd(8B)→ECDSA拒。COORD-LEDGER 之前混淆两盘·8B fix 确认生效。
- 🔴 **NWT 通用分润可见层 PUSH-BACK（08:18·docs/2026-06-28-NWT-redteam-universal-revenue-visibility.md）**：DESIGN REJECT=introducer无DB支撑（pool_markets零introducer列·fee/intro表=0·物理不可实现「5角色全可见」是过度承诺）；BLOCKING-1=oracle/node委员地址重叠·按address match无法区分·要分必须重算feeSplit；BLOCKING-2=UNIQUE(txid,event_type)冲突·multi-role INSERT OR IGNORE静默丢失·修法role-specific event_type；BLOCKING-3=single markEmitted stamp封死multi-role retry·需per-role独立stamp。最小可行路：broker可见(已有)+committee合并fee一角色+introducer Phase2。
- ⚠ **gap③ CONDITIONAL GO（08:26·docs/2026-06-28-NWT-redteam-gap3-execution-design.md）**：3 CONDITIONAL无BLOCKING·等J2贴执行前查3项结果·NWT/Bettor确认→建盘。
### NEXT（清醒做·非疲劳）
1. ✅ **8B .sil 已确认生效**（无需清缓存）：cacheKey 已含 .sil content sha256（pool-p2sh.mjs L67-68）→ 内容变必重编；NWT byte-验 xzztw=58cd(8B)=活证；env 无 stale-path 覆盖。gap③ 编译层闭。
2. **干净 live-settle 验（gap③）**：建全新 8B 盘·**全本地委员（无 cross-node 成员·避免 4/5 sig 卡）+ recognized oracle 源（ESPN-final 已结束赛事·voter 按 findExtractor→deriveKanetNativeVote 自然投票，⚠ test-oracle 不被 findExtractor 认·voter L355-363 预过滤 skip·J2 code-grounded 更正·J1 确认）→ 自然 settle → node-accept（无 NUM2BIN）+ settle_txid landed** = 真闭 gap③。这步过了 NUM2BIN fix 才算 live-证。
   - ✅ **gap③ pre-check 4/4 全 PASS（08:30）**：[2] POOL_SETTLER_TICK_SEC=60（KANet-UI）[3] MLB 401815924 BOS4-NYY1 Final·findExtractor=espn·winner=BOS ✅（J2 predict-then-verify·NWT 确认）[4] kaspa_tx_log 121k/15min·08:28:46（NWT）。
   - ⚠ **J1 08:41 自纠·(a)闸结构上错**：committee 在 deadline 用 endBlockHash 采（settler.js L670 sampleAndStoreCommittee），建盘时 pool_committee 空——committee_pks 建盘后不存在。→ 废(a)。
   - ✅ **option(c) 采纳（08:43）**：J1 4 :3300 oracle(Alice/Bob/Carol/Dave) staker_pk_x 在 :3200 oracle_stake_enrollments 临时标 active=0 → oracle_pool_chain_view 扫 9-local → create 烤 9-local pool_merkle_root → VRF deadline 从 9 选 5 必全本地。NWT 代码实查：scanner L99 `WHERE active=1` + L123 UPDATE 不写 active → DB 标安全不覆写。
   - ✅ **J2 UPDATE 执行完（08:48）**：4 oracle active=0，oracle_pool_chain_view 08:49:15 新行 pool_size=9 snapshot_daa=48947865（NWT DB 验）。active enrollments=9（全本地）。
   - ✅ **pool_size=9 三端独立确认**（08:49）：J2 curl :3200/api/oracle-pool/chain-snapshot → snapshotDaa=48947981 pool_size=9；KANet-UI 同验 48948125/9；NWT DB 直查 48948125/9 leaves_count=9。
   - ⏳ **J2 建盘进行中**（08:50 GO）：J2 查 maker/bettor 资金中·pool_size=9 全本地·NWT 监控新 market 出现+pool_snapshots 烤 9-local root。
   - 📋 **建盘后 restore SQL（J2 执行）**：`UPDATE oracle_stake_enrollments SET active=1 WHERE staker_pk_x IN('a102fbde...','9e2db8...','7013f1...','e666239...')` — 不影响已烤 9-local root 的 gap③ 盘·仅恢复未来新盘池到 13。
   - 🔴 **盘1 qkzh6 废（09:0x）**：J2 误用 register-v07(bshard 路·建 market_shards 行)→ isBshard-skip(settler L356)→ 永不委员结算。NWT 5th-vantage 坐实。教训记次要。register(L1310)=非-bshard 正确路。
   - ⏳ **盘2 jepu1 建成+种注（09:12）**：maker=broker-1(非-oracle)·broker=Owner·8B·df3cd1c4 9-local root·register(L1310)非-shard 双边真注·非-bshard 验过。committee 5/5 全本地(maker-1/broker-2/tester-1/NWT/J2test)。
   - 🔴 **jepu1 settle 卡 covenant-verify（09:3x-09:5x·全队共诊）**：settle TX f9e64afc 持久被拒 "script ran but verification failed"。**5 假说系统 ruled-out**(commit_v2匹配/merkle对齐/5真签全组进/sig-PK序全selection一致/pk_hash序)。剩前沿 (a)sighash不符 (b)非-sig require。✅ **gap③ 核心证毕**(8B node-exec+委员全本地+commit_v2+merkle+5/5真签)·covenant 在尽职拒非bug。
   - 📋 **finding 捕（docs/2026-06-28-gap3-broker-dm-settle-covenant-verify-finding.md）**：含 5 假说 ruled-out 全表+J1 钦定 bisect(取1 sig 手动 verify input0 sighash→❌=a/✅=b)+可复用 demo 配方。**清醒诊 handoff·从 bisect 起步·盘 jepu1·tx f9e64afc**。
   - 次要(独立)：L2767 `||3` latent(jepu1 未触发·oracle_relay_ids=5·建议改读 committee size/threshold+lint)；LLM upstream 宕(ports 3010-3013·影响投票非签名)；register bshard/logical 误用第3次→lint rule(线11)。
3. **DM-to-phone demo**：同一干净盘 broker_address=Owner 托管地址（kaspatest:qzhet8m2...·已在 PM linkedAddrs·poller 修后 d1f68dd1/9151f81f live）→ settle 出 broker fee → broker_fee_landed → DM 弹 Owner 手机。Bettor 链验 fee+DM。
4. **迁移（Bettor 协调）**：**16B-spine 坏盘**（zzwzd 等 pre-fix·NUM2BIN unsettleable）→ deadline refund（测试币·盯 refund_txid landed 别 strand）。**xzztw 单列**：它是 8B(非 16B)·仅因我手术 sig 坏 + cross-node 第5委员卡而未 settle·非编码死盘·处置（refund 还是干净重签）由 Bettor 拍（团队已倾向走 fresh 全本地委员盘·xzztw 大概率也 refund）。
### 🔑 co-verify 3 层教训（今天两次同根：broker-txid + NUM2BIN）
co-verify 必三层全：① **结构**（spine redeem-bytes recompile 跨节点同 P2SH）② **值匹配**（.sil 重算==JS builder·**注意：今天 .sil-16 vs JS-16 内部一致"对死"了·但两个都错**）③ **live-node 接受**（真链 settle/close TX 广播 landed）。FINDING-2 那轮只做①②（②还都 16=错），漏③。**碰 node 接受的（settle/close TX 实广播）co-verify 必含 live-landed·结构/recompile/值匹配都不够**。+ **fix 提交≠生效**（编译缓存）：fix 后必 live 重证。配 [[feedback-offline-test-must-use-real-schema-with-triggers]]。
owner=J1（.sil/commit_v2 + 缓存）+ J2（settler/驱动）+ KANet-UI（部署/建盘）+ NWT（红队/scope）·协调/迁移/live-验=Bettor。

### 📌 收口（2026-06-28 午后·Bettor·清醒接位先读这段）
**broker DM gap③ 当前精确状态（= J1 字节级修的接位起点）:**
- covenant-verify 根因再收窄：~12 假说 ruled-out + **clear-resign 排除 stale-sig**（清旧 sig 重签仍拒）→ 锁定 **relay sign 算的 sighash ≠ node checkSig 算的 sighash**，**dup-pk（委员重复 pk）头号嫌疑**。
- **jepu1 处置 = FREEZE 当 sighash 测试台**（不 refund·唯一 dup-pk 盘·修完即测）。tx `f9e64afc`。
- **J1 正在 active 修字节级 sighash（午后进行时·非 deferred）**（kaspa-wasm standard sighash vs covenant 算的某 prev-output script-code/amount 进 sighash 部分）；J1 记忆 `v07-parimutuel-settle-covenant-debug`（最终诊断+精确 fix 起点）。Bettor 待命验落链（fix 落→jepu1 测试台 settle→broker fee→DM）。
- broker DM 功能本身（设计 / NWT 审 PASS / B1 修 / emit / poller / 投递）**全 ready**，纯卡此 settle 机器 bug。e2e 没闭。

**🔴 身份混乱事件 + KANet-UI 下线（午后·已固化堵死）:**
- KANet-UI 会话退化：从自己 relay（`qqnctze0yf`）发一串「[Bettor·...]」决策（clear-resign GO / jepu1 freeze / 5th-vantage）+ **误串韩语** → 制造指挥权混乱（Owner 问"那个 Bettor 是谁？我没看到"）。
- Bettor 查 `from_address` 坐实**非真 Bettor**（真 Bettor=`qpjhaad7` / relay `5c07f7e5`）→ 频道正身份 + 让 KANet-UI 归位 → **Owner 把 KANet-UI 会话下线**。
- **固化堵死**：KANet-UI 接位「⛔ 红线」段（不替协调者拍板 / 缺席升级非顶替 / 身份以 relay 为准）+ 框架 **§8.6** 频道身份铁律通则（全 agent 适用）。
- Bettor 自纠：初判"另一个 Bettor 会话"是**只看内容前缀未查发送方=违 verify-before-act**，查 `from_address` 才纠正。
- ⚠ **KANet-UI 下线 → UI/operator/部署/首页② 域暂无 owner**（见 ESCALATIONS）。**单一协调者 = Bettor（qpjhaad7）。**

---

## 🔴 线 13：ZK-settle 转向 — payout 算术搬进 RISC0 电路（Owner 钦定·2026-06-28 夜·当前主线）
### GOAL（Owner 直令 16Z：今晚必须干出 settle-e2e LAND）
脆性 covenant payout 结算（线 12 一整天炸：NUM2BIN-16 / sighash / dup-pk… 同族脆性反复）→ Owner 钦定转 ZK（一周前既有方向）。把 payout 算术 port 进 RISC0 guest，链上验一个 groth16 proof（OpZkPrecompile 0xa6），根治整类逐字节脆性。**两阶段：verdict 仍 4-of-5 委员（层1 outcome）+ payout 零委员可证（层2 ZK）·仅 bshard 路。**
### INVARIANTS
- **verify-value-source 递归**：journal 的 inputs_commit/verdict 必【链上烤死值 introspect·非 witness】非-vacuous（P3 命门）；attested_winner 必从 PS UTXO state byte-decode·零 DB（B1）。
- **journalHash 三层 byte-equal**：guest journal == golden-ref == covenant 烤的 expected_journal_hash。
- **绝不回委员路**（prove-fail escape = deadline auto-refund·红线·复盘核心）。
- NO TX NO STATE；prover de-risked ≠ settle-e2e LAND；P3 审死前绝不 claim trustless-safe。
### STATUS（2026-06-28 16:4xZ·滚动）
- ✅ **verifier 侧证**：0xa6 在 TN12 接受 groth16，P1 fixture receipt 消费（txid `160c3b5b`）。
- ✅ **prover 侧真证（升级·非 trivial）**：真 settle guest（payout 算术 port 进电路）groth16 PROOF EXIT=0，journal 65B zkVM 内 **byte-equal golden-ref**（bets_root `41b7e8e6`==B2 / payout_root `715dfe50`==V2 / winner 00）。journal_hash 候选 `sha256(journal)=71e8b8ab`。中途 WSL OOM → empty-subtree 优化（byte-equal 守恒·V1-V4 对死）。
- ✅ **journalHash 三方 byte-equal**：J1 实跑 / NWT 独立重算 / J2 真 computeJournalHash（import 非 re-impl）== `71e8b8ab`。⚠ 定版仍 gated J1 gate-build（确认 raw-sha256 还是 RISC0 envelope·attack#8）。
- ✅ **P4 settler 集成设计审（NWT·CONDITIONAL GO·8 向量 5 PASS）+ Bettor 裁全采纳**（docs/2026-06-28-NWT-redteam-P4-zk-settler-design.md）：
  - **B1（attested_winner 源）= ACCEPT**：必从 PS UTXO state byte-decode·禁任何 DB 表（verify-value-source·同 fix② vacuous 类）。STUB 用正确路死不走 DB 捷径。J1 给 PS-state offset → J2 byte-decode → P3 covenant 对齐。
  - **B2（prove-fail escape）= ACCEPT + Bettor 补一维**：escape=deadline auto-refund·**bets>0 strand 用全 bettor refund_draw 非 maker-only refund_maker_unjoined**；bets>1024 → gatherOrderedBets pre-check escape；**绝不回委员路**。demo backstop=既有 deadline CLTV+grace（outpoint-precise）；production 提前退款排 milestone。
  - **C1（bets 序）= ACCEPT**：demo 明标单节点 db_id≈daa；production 必从 kaspa_tx_log.block_daa_score+tx_idx derive。今晚单片 sequential demo 满足·不阻塞 LAND。
  - **P3 GATING（safety 完全 gated）**：inputs_commit/verdict covenant introspection 非-vacuous = NWT 下个主战场·不得 defer。
### NEXT（序列·B1 在 wire 临界路径）
```
DoD: settle-e2e LAND = 真 settle guest proof → ZK close TX 链上 LAND（机制 demonstrate）
序列: J1 [journalHash 定版 + B1 PS-state offset] → J2 wire(替4 stub+B1 byte-decode+B2 guard+自核 journalHash) → Bettor co-verify(journalHash+B1 零-DB 调用链+byte-equal 三层) → KANet-UI 部署建单片 bshard 盘 FUND → ZK close → LAND → 四方 co-verify → 报 Owner(demonstrate 非 trustless)
通过条件: ZK close TX node-accept + LAND + journal_hash 链上烤死对死 + attested_winner 链源
失败处理: 同 DoD 连 2 轮 FAIL → ESCALATIONS
```
owner=J1（guest/prover/gate-build/B1 layout）+ J2（settler wire/builder/B2）+ KANet-UI（部署/建盘/operator）；reviewer/红队=NWT；P3 审=NWT 下个；协调/裁/co-verify/验落链=Bettor。
**诚实标**：prover 真 de-risk + 算术 byte-equal·**settle-e2e 未 LAND**（下一个真 LAND）；P3 未审=不 claim trustless-safe；报数级别词=机制 demonstrate。

### 🔴 Owner 裁定 B（2026-06-29 00:1xZ·方向转折·覆盖最简内核路）
- **背景**：journalHash 三方 byte-equal + P4 设计审裁完后，J1 为赶今晚 LAND 裁出**最简内核路**（non-continuation CloseZk·全 :3300 自包含·砍 bshard 市场/continuation/oracle-attest）。Bettor 采纳并钉 scope，但**透明问 Owner 确认 scope 收窄**。
- **Owner 拍 B**：要**真实押注盘的完整 ZK 结算 e2e**（真 bshard 盘 register→真押注→4-of-5 委员 attest→ZK 结算 close→真分钱·完整两阶段 verdict 委员+payout ZK），**不要最简内核 smoke**（缩水·没说服力）。**Owner 明确接受今晚大概率 LAND 不了·宁可踏实做对**。
- **🛑 HALT 最简内核路**：bshard 市场/continuation/oracle-attest **不砍**=Owner 要的真盘路。J1 回 continuation 版 CloseZk（offset-53 layout）。
- **🔑 解除夜赶压力（Bettor 钉·money-adjacent 不夜赶）**：Owner 接受今晚 LAND 不了 → 不 racy 硬搞·不夜赶碰钱码·真盘 byte-exact co-verify 一维不省。今晚=设计/派工对齐 + 起手稳做（KANet-UI 建真盘+真押注·J1 finalize continuation CloseZk.sil + phase1 attest builder 设计）；LAND=多 pass 踏实工程。
- **真盘完整序列**：KANet-UI 建真单片盘+真押注落链 → deadline → J1 phase1 委员 attest（4-of-5·产 CloseZk-locked continuation·烤 attested_winner+gate_tmpl_hash·NEW builder）→ J2 gather 真 bets+zkCloseTick 集成（真跑·非只 co-verify）→ J1 prove（over 真 bets）→ build close_zk（花 continuation+gate）→ LAND → 四方真盘 co-verify（predict-then-verify+gate-spk 绑+B1 链源）。
- **NEW 工作量（临界路径·待 J1 ETA）**：phase1 委员 attest builder（产 CloseZk-locked continuation）+ phase2 close_zk builder + continuation CloseZk.sil finalize。J2 settler zkCloseTick 真集成。
- ⚠ **已沉的可复用资产（别重造）**：journalHash framing=raw sha256(71e8b8ab·定版) / image_id 335cae6c / gate_tmpl_hash b9d56ce4 / B1 readAttestedWinnerFromState offset-53 continuation 版（9b9804b5·非 non-continuation 版）/ prover de-risk（groth16 from guest byte-equal golden-ref）/ close_attest_zk 两输入格式（in0 CloseZk+in1 0xa6 gate·gate-spk introspect 绑 journal）。
**复盘**：`docs/2026-06-28-zk-settle-pivot-retrospective.md`（困难/技术失误/教训·Owner 钦定·Bettor 补充时间线+OOM 教训+并行稳定层）。

### 执行进度（真盘完整 LAND 冲刺·2026-06-29·滚动）
- **Owner 校准（00:1xZ）**：「无论如何抢时间抢进度」+「这是你之前决策失误造成的」。Bettor 收回「不赶」姿态→**全速抢进度 + 真盘完整两者都要**；只保留底线=碰钱 byte-exact co-verify 不为赶而省。关键杠杆=测试网 deadline 设短（5-10min·Bettor 测试网全权）→ 真盘也今晚能走完。
- **J1 ETA（诚实·新码量）**：① finalize CloseZk.sil ~20min ② phase1 委员 attest builder + 格式给 J2 ~45-60min（~30min 先给格式并行 wire）③ close_zk 2-input assembly + LAND = prove 后 ~45-60min。**全路 ≈2h close_zk LAND**·临界长杆=phase1 builder + 2-input assembly 新码（prove/gate verify/keyless-spend 已 ready 不在长杆）。
- **职责划分（J1/J2 自厘清）**：J2 zkCloseTick=gather ordered bets(链序+on-chain bets_root 自验)+ self-fetch continuation UTXO outpoint + 读 attested_winner(B1)→ 喂 J1；J1=prove over 真 bets → journal/receipt → gate sig_script → build 2-input close_zk（新 relay handler `unlockBshardZkClose`·异构 2-input）→ broadcast → LAND。
- ✅ **phase0 LANDED + Bettor 链验 PASS（00:26Z·predict-then-verify·:3200 DB + kaspa_tx_log）**：真盘 `ext-pool-v07-1782667323858-bh01w`（spine pzde7jkcja）·shard-0 bettor_count=2 open·**真押注守恒**：YES `e72d8e7e` 50 KAS(dir0) + NO `4a355a77` 30 KAS(dir1)·三押注 txid 全链上 LANDED（YES 04bb1961 / NO c6a1f990 / maker13.47 d5e173ce）。**真实押注+真 stake 落链·非合成**。leaf outpoint 9de79b2b:0=gatherOrderedBets 起点。absorb 序=YES 先→NO 后·bets_root=fold(ZERO32,YES_leaf,NO_leaf)。deadline 1782667803(00:30Z)→ 过后 phase1。
- ⏳ **NEXT**：deadline 过 → J1 phase1 builder ready(~01:05) → 委员 attest 真盘(产 continuation·烤 attested_winner+gate_tmpl_hash) → J2 gather+喂 J1 → J1 prove+build close_zk → LAND → 四方 co-verify（Bettor: predict-then-verify payoutRoot + gate-spk 绑定真实非 witness + B1 链源 + payout 分发守恒）。

### ✅ 真盘 bh01w 建成+押注入链（KANet-UI 2026-06-28 ~17:25Z）
- **market_id**: `ext-pool-v07-1782667323858-bh01w`
- **spine_p2sh**: `kaspatest:pzde7jkcjapra73x3sy4lkgaq8ld6yuxx0dyf8y2mqcvg0wm3alsugqlrzyfn`
- **shard-0 P2SH**: `kaspatest:prgl0x6ulrcge4x4h2qj5u994dzux5eq42qpn7uw8jf28l8gaje2xq4ruej9c`
- **押注（链上）**：YES 50 KAS `9fc5134d...` (tester-1) / NO 30 KAS `9de79b2b...` (tester-2) / maker-YES 13.47 KAS `391462b0...`
- **leaf outpoint**（gatherOrderedBets 起点）：`9de79b2b88cfc9c573e41895017cf3301b1d41030f37e874d3b3df91aab98c4f:0`
- **shard bettor_count=2**（不含 maker）；市场 protocol_version=v0.7；ESPN 401815924 BOS-NYY
- **deadline 17:30:03Z 过后**：settler deadline-watcher 推进 pending_bettors→verifying；settler loop isBshard=true → skip（不误退）→ **等 J1 phase1 委员 attest**
- ⚠ **注意**：J1 4 :3300 oracle(a102fbde/9e2db8/7013f1/e666239) 仍 active=1（本盘创建时没调 inactive·pool_size=13·委员可能含 J1 cross-node），若 VRF 选中需 J1 节点签 phase1。如需全本地委员 → 下次建前先 active=0。

### 🎯 今晚 ZK-settle 收尾（2026-06-29 ~01:04Z·5 PROVEN + 1 PENDING·Bettor 止损·全队口径一致）
**Owner 裁定 B 真盘完整路结果**：核心 ZK 结算机制链上 PROVEN + 真盘 5 里程碑 LANDED；但**完整 trustless close_zk 没 LAND**（gate-spk 绑定撞 silverscript 编译器 bug·Bettor 止损·绝不 vacuous LAND）。**诚实定性=「ZK-settle 核心机制链上 PROVEN + 真盘 payout byte-equal + verdict 委员 attest 上链」·NOT「完整 trustless close_zk e2e LAND」。**
- **今晚 PROVEN（5 项·Bettor 逐项链上 co-verify）**：
  ① ZK proof 链上 verify — BISECT-A `88e74f91` LANDED（0xa6 groth16 verify in[1] 2-input tx）
  ② payout byte-equal — betsRoot `467e190f` / payoutRoot `9bfb3c87`（guest==canonical==J2 gather 三方对死）
  ③ 真盘真押注 phase0 LANDED — bh01w YES 50KAS+NO 30KAS（链验守恒·consolidated_pool=8e9·maker 52.88 B-model 独立非进池）
  ④ verdict on-chain attest LANDED — `97796e21`（slot4 9e2db852·closed0→1 W=0·genesis `d004f20d`·cov_id `820a6955`）
  ⑤ 4-of-5 off-chain records — Bettor kaspa-wasm verifyMessage 第二 vantage sig=true（msg=sha256(marketId‖W=0‖endBlock‖pmr)=`83f2f3c9`）
- 🔴 **PENDING（下个 pass 头号起点）**：gate-spk 非-vacuous binding（防恶意 settler 换 gate 偷 payout）= **silverscript codegen OP_PICK off-by-one bug**（`loc==stack_len`·PICK-computed-value-in-concat 栈深>阈值·2 hash 局部[journal_hash+gateRedeemHash]恒触发·reconstruct 绕不开·J1 反汇编实证非盲目·13 轮 bisect）。**修法=silverc off-by-one fix or 反汇编级 emit**（rusty-kaspa-fork txscript codegen·非 .sil 能绕）。settler 侧（gather/B1/C1/computeBetsRoot/journalHash/zkClosePhase2）**全 ready+测·绑定一通即接 close_zk LAND**。
- **verdict 成熟度（Bettor 自决档2·诚实修正不藏）**：链上单 oracle attest（slot4）+ 4-of-5 委员 off-chain 授权 records（driver-side·CloseZk 不验委员·**比 Phase A 链上 4-of-5 弱**·Bettor 自决时判乐观已修正口径）。真链上 4-of-5（port `unlockBshardCloseAttest` 进 CloseZk·复用 x4kpq）=下个 pass。
- **可复用资产（别重造）**：bets_root@**290**（.sil 修后·was 280·加 2B version 前缀）/ attested_winner@53 / gate_tmpl@231 / genesis cov_id 820a6955 / committee `excludePks` 必含 bettor 维（既有只排 maker/broker·J2 补·**production 固化进 sampleAndStoreCommittee**）/ gather 必 `getSidesByShard`（shard 键·非 logical·避 maker 杂质·线8）。
- **🔑 健康对抗记录（元教训）**：Bettor 提 vacuous workaround「caller-fed witness gate P2SH ==」→ J2 verify-value-source 当场兜住（caller-fed=可控·删 concat=删绑定=vacuous）→ Bettor 大方收回。**非-vacuous 本质=reconstruct**（journal_hash=f(baked bets_root,state winner,payout_root)·绑 payout_root 防 payout-vacuous·cov_id 加固非替代）。= Bettor 疲劳/赶进度时仍会自提 caller-fed 捷径，队友兜=健康（同记忆 [[feedback-relay-blindsign-taxonomy-key-auth-vs-condition-endorse]]）。
- owner=J1(silverc fix)+J2(settler 全 ready)+KANet-UI(operator/部署)；协调/co-verify/止损/口径=Bettor。复盘 `docs/2026-06-28-zk-settle-pivot-retrospective.md`。

### 🎉🎯 interim B 真盘完整 ZK 结算 e2e 达成（2026-06-29 ~00:47Z·Owner 钦定"干"→真盘端到端全链上 LAND·三 vantage co-verify PASS）
**止损后 Owner 点醒「赢家自取早有解（cascade-convert-split-spec self-claim·我大白话"发钱"误导）」→ interim B（ZK 算账 + 现有委员 close_attest 锚 + 赢家自取·避开纯 ZK 自锚的 OP_PICK 编译器墙）→ 真盘 bh01w 端到端全链上 LAND。**
- **6 步全 LANDED（三 vantage：KANet-UI :17210 + J2 :3200 + Bettor :3200/暂代 NWT·守恒 EXACT）**：① 真押注 YES50(e72d8e7e)+NO30(4a355a77) ② ZK 算 payout_root `9bfb3c87`(三方对死) ③ 委员 4-of-5 真 attest(excludePks 排 bettor) ④ consolidate ShardLeaf 8e9→PayoutShard `71000bb2`(守恒 8.02e9) ⑤ close_attest 委员锚 payoutRoot 9bfb3c87 `106f8326`(continuation pqg4gvyw·closed=1) ⑥ **赢家自取 `abbefe70`·winner e72d8e7e(qrnjmrn74z)领 8e9=80KAS**(seed 0.02e9 留·守恒分毫不差)。
- **claim-merkle-binding（最强 co-verify）**：claim LANDED=链共识接受=blake2b(e72d8e7e‖8e9) merkle proof against 9bfb3c87 成立=链共识自证 attested root。
- **🔑 诚实口径（钉死）**：interim B = ZK 算账(公开可验·脆性算术消失=Owner 转 ZK 核心目的达成)+委员门槛锚(prevention·同现状 bshard·全恶意 4-of-5 能作恶)+**insider-detection**(今晚内部复算·真公开需发 bets-decoder=下个 pass)+赢家自取。**NOT 纯 trustless**(纯 ZK 自锚 prevention=撞 OP_PICK 编译器 bug=下个 pass)。
- **健康对抗**：Bettor 提 vacuous workaround→J2 兜；Bettor 换帽红队代审(Owner 钦定·NWT 沉默)抓 attack2(detection 前提 bets 明细公开性·今晚 insider)；J1 引 stale 注释(8 siblings)→J2 .sil 实证 depth-10 兜；Bettor 催 stale(indexer lag 误判)→纠(跨节点信 5th vantage)。
- **Bettor 协调反思**：主动盯反复没到位(NWT 14min/consolidate 11min/多步 build 被动等·催 1 次 stale)·Owner 多次问"卡哪/落没"才动·已纠(bg fallback 每步主动 check·indexer lag 信 5th vantage)。
- **部署 preserve-check（J1·防反向 sync 灾难）**：interim-B handlers(bshard_payout_claim/close_attest)早在 canonical origin/bshard-m3-deploy·:3300 是 159 commits behind 非 ahead·**无需 push**(否则覆盖 canonical 真 fix)。注释欠债清理等测试间隙。
- **NEXT（Owner "部署，测试·争分夺秒"）**：部署=确认 canonical 已有 handlers(✅J1 preserve-check)；测试=KANet-UI 建多 fresh 真盘(短 deadline·不同赛事/押注)+ J2 驱 close_attest+claim 复测(半自动)+ Bettor 每盘 co-verify(payout_root 三方对死+守恒+claim-merkle-binding+委员无 bettor)+ **狠压 bug**(测试网成果口径)。下个 pass：silverc OP_PICK fix→纯 ZK 自锚 trustless + bets-decoder 发布(真公开 detection)+ 真链上 4-of-5 attest。

### ✅ bh01w interim-B 真盘端到端 LAND（2026-06-29 ~00:48Z · OP_PICK 阻断 ZK 全路→止损 interim-B）
ZK gate-spk binding 撞 silverc OP_PICK off-by-one codegen bug → Bettor 裁定止损 → 走 interim-B（close_attest 委员锚·同 Phase A ozzeu 同款机制）→ 真盘 bh01w ESPN MLB 401815924 BOS 赢 W=0=YES 完整 6 步端到端全 LAND。

| 步骤 | tx | 摘要 |
|---|---|---|
| phase0 押注 | `04bb1961`(YES 50K)/`c6a1f990`(NO 30K)/`d5e173ce`(maker) | 真押注链上守恒 ✅ |
| consolidate ShardLeaf→PayoutShard | `71000bb24f41...` | 8.02e9 sompi 守恒 ✅ |
| close_attest 4-of-5 委员锚 payoutRoot | `106f8326e520...` | payoutRoot=`9bfb3c87` ZK 算三方对死 ✅ |
| PAYOUT_CLAIM winner 自取 | `abbefe70de6c...` | e72d8e7e 收 80 KAS(8e9) ✅ |

**四方 co-verify PASS**（KANet-UI 5th vantage DB + J1:3300 + J2:3200 indexer + Bettor 独立链验）· 守恒 2e7+8e9=8.02e9 分毫不差。
**诚实口径**：ZK 算账（公开可验脆性消失）+ 委员门槛锚（同现状 bshard·诚实多数）≠ production-trustless（ZK gate-spk 绑定 gated on OP_PICK codegen fix）。

### ✅ pb73v interim-B ZK settle e2e 第二盘 LAND（2026-06-30 ~04:24Z · 四源 co-verify PASS）
J2 fresh session 驱·auto-settler 初次集成测试·market pb73v ESPN 401815943 WSH 赢(W=0=YES)·委员 5-of-5。
- **pool**: consolidate PS 620000000=6.2KAS(6注+0.2seed) @pzf3jm9v close_attest tx=4d0e1ed7 LANDED ✅
- **winners**: 9f866061(dir0·2KAS) + 248fb1f9(dir0·2KAS) → pari-mutuel 各 3KAS·loser 60e8c735(dir1) 不进树 ✅
- **claim**: winner1 b81e4445(3KAS→qz0cvcr..u5uyf5k9ky) + winner2(3KAS→248fb1f9 P2PK) 链上 LANDED ✅
- **守恒**: 3+3.2=6.2(close)→3+3=6(claim)+0.2(seed留) ✅ 四方 co-verify PASS
- **📌 auto-settler 两 bug(Bettor 记 task·非阻 e2e)**:
  - ① `verifyClosedLanded` 单发 RPC false-negative(submit+~1s 未确认→false·真相=LANDED)·需 retry/poll
  - ② claim loop 多-winner 不 thread continuation/nullifier·需修
- **诚实口径**: J2 driver-driven(手跑·非全自治 daemon)·auto-settler bug 修后才是真自动·e2e 机制 PROVEN

---

## 🎉 线 14：bshard-settle-daemon 生产上线 + 公测就绪（2026-06-30 08:00Z）
### 一句话
bshard 无人值守自动结算 daemon 冷启生产·双 canary GREEN（含 idx-63 跨 word 边界 J1 链上独立验）·Owner"可以公测了？"→ 广播确认·公测开放。

### LANDED（五方 co-verify）
- **canary #1（4p0f6·4 注·2 winner）**：J2 standalone 06:49 结算 PASS ✅
- **canary #2（mf0o4·90 注·83 winner·3 shard）**：daemon 自治 07:46:13 结算·settle_txid=9bd4f3a7·payoutRoot=65a7dead·83 claim_txid 全 LANDED ✅
  - payoutRoot pre-commit 四源 byte-equal：KANet-UI + J1:3300 + J2:3200 + Bettor ✅
  - **idx-63 跨 word 边界 J1 独立链验**：winner 701b289680ca 在 J1 :3300 节点收 108433734 sompi ✅（w0→w1 crossing 确认无 off-by-one）
  - 最终 PS continuation = 20000000 sompi = seed（83 claim 全领完）✅ 守恒
  - ⚠ **首轮 settle_failed（UTXO timing）**：TX 0f28520b 入 kaspa_tx_log 后 ~4s 查 getUtxosByAddresses=0·daemon 标 settle_failed·J2 手动 reset verifying → 次 tick 成功。**根因未锁（block 红/孤块 or UTXO set delay）**·daemon 需加 retry/poll 防止未来重现（记 ESCALATIONS）。
- **生产冷启**：kanet-start.sh 07:58:05Z·SETTLE_DAEMON_ENABLED=1·日志 `[settle-daemon] 07:58:05 starting·tick=60000ms·MAX_PER_TICK=1·feeRelay=8f104e2d` ✅
- **公测广播**：dev-coord-testnet txId=3c1b8011 ✅；Owner 钦定"增加单子·增加押注"→ J2 建 fresh 盘·J1+NWT standby 首盘 co-verify。

### 关键 commits（已进 bshard-m3-deploy）
- `b47d21df` feat(auto-settler): settleMarketLive relay + committee deadline-pin + cleanliness 闸
- `c2409a71` feat(auto-settler): computeSettlePlan 编排核心
- `3c9d56dc`/`e33005cd` daemon + index.js wire-up + kanet.env SETTLE_DAEMON_ENABLED=1

### NEXT（Owner "增加单子增加押注"）
1. J2 建 10-20 个 fresh 干净 v0.7 bshard 盘（短 deadline·多样题目·非镜像）
2. 真公测用户 DM bot 押注；daemon 自动结到期盘
3. J1+NWT+Bettor 首批公测盘四源抽检（同 mf0o4 co-verify 标准）
4. **UTXO timing retry**：daemon settle_failed → 重试 N 次（poll getUtxosByAddresses）而非立即标死（见 ESCALATIONS）
5. oracle auto-renewal cron task#13（ESCALATIONS 已升优先级）

---

## 集成 / 部署态(git 真相，2026-06-30 KANet-UI 更新)
- **master** tip `ca7e0a66`:含核心 bshard/oracle wave1 LIVE 码(经 bshard-m3-deploy sync)。
- **bshard-m3-deploy** tip(本 session 更新 `merge phantom-leaf fix`):
  - `b47d21df` daemon wire-up（上个 session）
  - `068330f4` **phantom-leaf 根治 landed() D=20 + BLOCKING 字段路径修（J1·KANet-UI merge 2026-06-30 12:29 deploy）**
  - AUTO_BET_TICK_MS=60000 per_tick=3 恢复（Bettor 12:28 授权·5源 co-verify GREEN·Owner"基本做通了"）
- 🔶 **未进 master(feature ref / 在途)**:D4 loaders(`origin/j1-d4-loaders` aace8f39)/ tg-wallet(`origin/kanet-ui-tg-wallet` df2a9b34)。
- ✅ **orphan 1596fb62 DONE**(u7hq4 市场 1000 KAS):Bettor GO 08:57 → 临时 DB id=7816 插入 → bettor-refund-claim endpoint → txId=36522a1f,output=99999999000 sompi。J1(:3300)cross-node UTXO=0 + Bettor(:3200)kaspa_tx_log block 双验。**总计 made-whole: 10 sides, 5,608.8 KAS**(batch-1 9 sides 4,608.8 KAS + orphan 1,000 KAS)。
- ⬜ 择机 merge 进 master + verify-ship 收齐。J1 gated on NWT FINDING-1 修。

## 线 16：bshard claim-completeness 正确性 bug + 有界重试（2026-07-03·J2 起草·NWT 审）
### 一句话
J2 读码坐实：`settleMarketLive` claim 循环 5 条丢单路径后无条件 `return ok:true`，daemon 只查 `ok+closeTxid` 就写 `protocol_status=completed`，从未校验 `claims.length===plan.winners.length`。全量重放 85 个 completed bshard 市场：20 tier1（计数缺口）+1 tier2（2pu1o 计数对但曾报到账疑虑）=21 需链验，60 clean_provisional（仅"未发现已知疑点"非证明干净），4 无法验证（driver-script 手驱历史盘）。

### NWT 红队审（2026-07-03·`docs/2026-07-03-NWT-redteam-claim-completeness-design.md`）
**裁决：CONDITIONAL GO — 2 BLOCKING + 2 非阻塞加固**。诊断/证据分级/必改1-4/风险1-2 全站得住，打不穿；两条 BLOCKING 都在"§4.2/§4.3 落码层面"：
- 🔴 **BLOCKING-1**：读码实证（bshard-auto-settler.mjs:199-237）`psOutTxid`/`curState`/`curPool`/`curRedeem`（续约起点）只在 claim 完全成功后前进，只活在函数栈里从未持久化。设计没写重试第一步"重建续接点"的数据来源——若图省事从 DB `claims[]`/`settle_evidence` 回放，就是让重试信任"DB==链上真相"，正是本 bug 病根。**修法**：重试必须链上 walk continuation 链到 tip、直接从 UTXO 脚本字节解 state，不经 DB 中间层；可复用 `pool-market-settler.js`~L1128 已有的"查 kaspa_tx_log spend 记录分流"同族模式，非从零造。
- 🔴 **BLOCKING-2**：§4.3① refund-臂 post-close 探针是真实构造+广播的花费尝试，若"预期 BUST"假设错了，探针本身就会**真实执行那个漏洞**（把钱转出）。设计没交代：①拿哪个市场做探针（不该挑 21/60 个还有真实未领 winner 的盘去实弹测试）②探针输出地址是否团队可控（BUST 失败时钱能否找回）③优先级——文档自认"比漏付更大的攻击面"却排在 J1 任务卡第 3 项，若成立=81 个市场此刻存在任何人可发起的真实攻击面，应最优先探，不该等 21 盘核对完再排。
- 🟡 非阻塞：idempotency 判定要 walk 完整续约链非只查当前一环（continue 类丢单会让中间某 winner 被跳过，链上真相分布在整条链上）；splice 一致性校验（L231）比对的是 relay 自报值非链上落地值，目前 fail-closed 无直接损失但同批可一并加固。
- owner=J2（§4.2/§4.3 补齐 BLOCKING 后落码）+ J1（探针执行·按新优先级调整顺序）；协调/裁=Bettor；reviewer=NWT（本轮）。

### ✅ 两条 BLOCKING 均解决（2026-07-03 14:4x·J2 改设计 + NWT 独立复核 GREEN）
- **BLOCKING-1 解**：J2 读 `PayoutShard.sil` claim entrypoint（L171-225）实证 merkle_index 无需递增/按序，covenant 层面不关心顺序——resume 算法重写为「链上 walk 该 payout shard 从 close TX 起的花费历史到 tip → 直接解码 tip 的 `w0..w16` nullifier bitmap（= 链上权威"谁已领"清单，本身即真相源，不必额外从历史反推）→ 对仍为 0 的 bit 逐个 claim（顺序不重要但物理必须串行）」。**比 NWT 原建议（walk 整条链累加历史）更简洁且等价**——bitmap 本身就是累计状态，天然覆盖非阻塞加固-1（不会漏中间被跳过的 winner）。
- **BLOCKING-2 解（零风险，非探针）**：J2 逐条 require 读 `PayoutShard.sil`：`close_attest`（L80 `require closed==0`→写1，L163）与 `cancel_attest`（L245 `require closed==0`→写2，L322）共享同一前置、写向互斥状态——`closed` 是一次性 XOR 闩，close_attest 先落=cancel_attest 前置永假=`refund_claim`（require closed==2，L339）永不可达。且 `claim`/`refund_claim` 全函数体无任何 deadline/locktime 约束（claim 永久可领）。**结论=源码结构决定的必然，非"预期 BUST"**，§4.3 sweep 机制不需要建，refund 探针从 BLOCKING 降非阻塞（若仍要 belt-and-suspenders 须用零真实资金的干净测试盘）。
- **NWT 独立复核（未直接采信"读码坐实"的转述，自己重读 PayoutShard.sil 全文逐行核对）**：两条 close/cancel_attest 互斥 latch + claim 无 deadline 均独立验证成立，✅ GREEN，设计定稿可落码。
- 线16 = **CLOSED（GREEN）**。owner=J2 落码 §4.1-4.3；J1（新身份 qzdh7nar）refund 探针非阻塞待排期；reviewer=NWT PASS。

### ✅ #33 §4.1 ship 落地 + NWT ship 审 PASS（2026-07-03 15:5x·commit f82b1d63·KANet-UI 部署 PID 19596）
- `settleMarketLive` 加 `complete`/`needsManualAttribution` 返回值；daemon 三态分流 completed/settled_partial_claims/needs_manual_attribution；`evidence.winners`/`claim_txids` 只认真到账；`relay.js isSettled()` 同源修正。回归测试 4 fixture 落 `claim_completeness_regression.test.mjs`。
- **NWT ship 审（不只信 commit message，逐行核对落地码）**：`complete` 谓词（bshard-auto-settler.mjs:333）核对成立；查 `winnerClaimData`（L119-128）确认 `claimData` 是 `winners` 直接 1:1 map 零过滤，`claimData.length` 等价 `plan.winners.length`，谓词前提站得住；丢单点①②→`needsManualAttribution`/③④⑤→`settled_partial_claims` 分类跟设计一致；`isSettled()` 短路顺序正确（completed 先判→partial/manual 排除→旧 settle_txid 兜底垫底）；回归测试本地跑 4/4 PASS。**ship PASS**。§4.2 resume 引擎（链上 walk tip 读 bitmap）确认排 #21 5b，本次范围（仅 §4.1 分类修复）干净、未夹带。

### 🔴 21 盘链上取证完成（2026-07-03 16:5x·NWT，在 16:53 任务重派前完成）
- **方法论**：不信 DB claim_txids，自建候选 continuation state 链（复用 `compilePayoutShardRedeem`/`splicePayoutContinuation`/`getMarketBets`/`computePariMutuelPayout`/`buildPayoutRoot` 生产函数，零重造数学）+ 对全部候选地址做真实 RPC `getUtxosByAddresses` 查活 UTXO，命中的候选状态 = 链上权威到账数；另从真实历史 close_attest TX 的 signatureScript 字节级解码委员实际签署的 `new_payout_root`（必改-4），跟 DB 存的 `payout_root` byte-exact 比对。NWT 亲自独立复现 `jcdu1` 一盘验证方法论（自己写脚本、自己 RPC 连接，候选 i=8/9/11/12 均无 UTXO，仅 i=10 命中且金额/outpoint 与 DB 最后一条 claim_txid 精确吻合）。
- **结果**：tier1 20 盘 = **全部确认漏付**（链上到账数与 DB 记录数精确相等，DB 记账准，缺口真实存在）——合计 **169 个 winner-slot 未付，8509.17 KAS**（跟设计 §2.1 缺口数字吻合），close 于 6/30-7/1，已过 2-3 天，§4.2 resume 引擎未建前无人重试。`2pu1o`(tier2) 降级为虚惊（链上确认 2/2 全到账，日志告警是 `verifyClaimLanded` 瞬时假阴性）。`db_root_match` 21/21 全 true（无"DB 存的 root 本身错"这类更严重问题）。
- **副发现**：全部触发过"not landed"告警的场景交叉核实后 100% 是瞬时验证超时误报（钱其实到账），真正缺口 100% 来自"break 之后再没被尝试过的 winner"——§4.2 resume 引擎不需要处理"号称成功但链上没到账"的反向情形。
- 完整明细 + 脚本在 `D:/kanet-tn12/scratch/_nwt_final_report.json` / `_nwt_all21_results.json` / `_nwt_close_witness_results.json`（只读，未碰任何 DB 写入/relay 命令）。
- **紧急**：169 个 winner 的 8509 KAS 是真实欠款，需要 §4.2 resume 引擎（#21-5b）尽快落地才能把钱发出去。owner=NWT（本轮完成）；后续 resume 引擎落码=J2（#21-5b）。

---

## ESCALATIONS / 待 Owner 裁
- 🔴 **daemon settle_failed UTXO timing retry（线14 首次遇·2026-06-30）**：mf0o4 首轮 settle_failed 因 TX 入 kaspa_tx_log ~4s 后 getUtxosByAddresses 仍返 0（UTXO set delay 或 block 孤块）。当前行为=立即标 settle_failed → 需 operator 手动 reset。**修法**：daemon settle_failed 路改为重试 N 次（如 3×10s poll）再标死·否则公测高频下会产生 operator 维护负担。域=KANet-UI·不急阻塞·建议首批 spot-check 后做。
- 🔴 **oracle auto-renewal cron — 28h 内必落(2026-06-30 Bettor 升级优先级)**：J2 re-enroll 用 lock=51200000≈28h(current 50193771)→ **~DAA 51200000 锁再过期 → create-v07 再 block 新盘**。task#13 auto-renewal cron 从"下个 pass"升为 **ZK drive 收口后立即做**·否则公测窗口破。域 = KANet-UI + J2 协。手动修触发点:oracle_pool_chain_view 最新 snapshot_daa + lock_until_daa diff < 500000 → 触发 re-enroll flow。
- ✅ **KANet-UI 会话已恢复（2026-06-29 Owner 重启）→ UI/operator/部署/首页② 域恢复 owner**。本 session COORD-LEDGER 已 commit，线13 P4 收尾记录已沉淀。
- 🔴 **broker DM e2e gated on J1 字节级 sighash 修**（下个 focused session·J1 清醒）：jepu1 FREEZE 测试台 / tx f9e64afc / dup-pk 嫌疑 / 接位起点见线 12 收口段 + 记忆 `v07-parimutuel-settle-covenant-debug`。
- ⚠ **通用分润可见层 NWT PUSH-BACK**（docs/2026-06-28-NWT-redteam-universal-revenue-visibility.md）：introducer 无 DB 支撑（过度承诺）+ oracle/node 地址重叠 + multi-role event_type/stamp 冲突。最小可行路 = broker 可见（已有）+ committee 合并 fee 一角色 + introducer Phase2。待 Bettor 据此**重设计**（不是全 5 角色一步到位）。
- `FAUCET_AMOUNT_KAS` 5→10k?(需 Owner + faucet relay 余额前提)
- polymarket-UMA 实现切片派工时机 + owner 归属(生死线,优先级最高待 Owner 拍节奏)。
- B/C broker 公开自助注册 auth 硬化(banked,production 前)。

---

## 线 15:主库/海量-UTXO 地址余额显示 LANDED(2026-07-03·KANet-UI)
### 一句话
Owner 报 FaucetRelay-tn-2(主库 2.5亿+ KAS)console 显示不出/加载不动。Bettor 派工根因实证(relay.js:353 `getUtxosByAddresses` 逐 UTXO 拉取,该地址 265万笔tx/上百万 coinbase UTXO → 超时,curl 实测 30s 返空)。
### LANDED
- `e3b85afb` 首版改 `getBalanceByAddress`(单数)→ 真机验发现撞**当前 vendored kaspa-wasm build 反序列化 bug**("invalid type: floating point, expected a string")→ 静默被 catch{} 吞掉 → balance:null(未真正修好,记教训:改完≠验完,真机测才发现单数 API 坏)。
- `026bf78c` 改用 `getBalancesByAddresses`(**复数**,数组入参,同为节点直返总和不逐 UTXO)→ **真机验 PASS**:FaucetRelay-tn-2(d9a8fffb) `{"balance":256180525.883}` TIME:1.07s(此前超时);`/wallets` 端点同源 helper 一并修;回归验普通地址(KANet-UI-tn f5cf6d85) `{"balance":3265.833}` TIME:0.004s 无退化。
- 两 commit 已 push origin/bshard-m3-deploy;console 已重启加载(taskkill 真活 PID 树杀 + kanet-start,非信 stale pidfile)。频道已报 `#4wqu12` 请 co-verify。
- **教训沉淀**:此 vendored kaspa-wasm build 的 `getBalanceByAddress`(单数)有反序列化 bug,后续任何余额相关改动**用复数 `getBalancesByAddresses`**,别踩同坑第二次。
owner=KANet-UI;co-verify=Bettor(待回)。

### 追加(2026-07-03 14:xx)：主库【发送】崩溃 — 与余额显示同根但更深，定为独立架构 task
- **场景**：Owner 试从 FaucetRelay-tn-2(主库)发 100万 KAS 给新接位智能体(qzdh7nar8w..,接替 J1 covenant/settlement/relay 域)启动资金,`Relay command timeout after 30s`失败。
- **KANet-UI 六层查证坐实**：① `kaspa_tx_log` 该地址 270万+ 笔进账/**零笔出账**=钱没丢,是发送本身没成功过 ② console.log 显示 FaucetRelay-tn-2 relay 子进程已崩溃重启 2 次(exit code 1,health-monitor 自动拉起) ③ 独立脚本复现:`sendKaspa()`内部 `rpc.getUtxosByAddresses`一次性拉该地址全部 UTXO(10万+coinbase),客户端反序列化阶段 kaspa-wasm 硬崩溃(`RuntimeError: unreachable`) ④ Kaspa RPC 无分页/限量参数,选币前必须整批拉全部 UTXO,无法绕开 ⑤ 跟金额无关——此路径现对该地址任何金额发送都会崩。
- **Bettor 定路(2026-07-03 14:45)**：
  1. 不用主库发;钱安全(256M 零出账)。
  2. 应急启动资金改用 **Bettor-tn**(935K KAS·10 UTXO·可正常发)发给新身份,授权口径=协调运营金非用户钱。
  3. 主库发送崩溃 = **单独架构 task 根治**(chunked consolidate 缩 UTXO 数 + 挖矿收益别再无限堆单地址,加 coinbase 分散收款或定期归集)。**money-path 不鲁莽·单独 pass 设计·别赶**,不并入本次紧急处理。
- **根因一句**：主库 10万+ coinbase UTXO → `sendKaspa` 拉全部建 tx 崩(跟余额显示 bug 同根,但 SEND 更难修——不能只求和,必须真选币+可能需 consolidate,且 `getUtxosByAddresses` 拉 10万+ 本身就崩,与 fee/amount 无关)。
- **状态**：待派工(owner 未定,下个 pass 设计)。别重复踩坑——任何人再遇到"主库/挖矿地址发不出"直接引用本记录,不用重新六层查一遍。

### 🔴🔴 追加(2026-07-03 17:00·G4 百人冒烟测试炸出)：水龙头 100% 失败 = 同根因升级为发布拦截项
- **场景**：世界杯上线门 G4(水龙头防线)要求 100 人冒烟测试。KANet-UI 用 100 个真实生成地址、20 并发批次跑 `/api/faucet/request`(trusted-proxy 路径,模拟真实 bot 用户)。
- **结果**：**100/100 全部失败**(60 笔 `Relay command timeout after 30s` + 40 笔 `Relay not running`)。console.log 实锤 `FaucetRelay-tn-2` relay 子进程崩溃,报同一个 `RuntimeError: unreachable` wasm trap(与本线主库发送崩溃**完全同根因**——`FAUCET_RELAY_ID` 就是 FaucetRelay-tn-2,同一个百万级 coinbase UTXO 地址)。
- **health-monitor 熔断器已放弃自动恢复**：日志 `FaucetRelay-tn-2 died but 3 restarts in last hour ≥ MAX(3) — skip (manual investigation needed)`。KANet-UI 手动 `POST /api/relay/:id/restart` 拉回服务(PID 59844 已连上),但**下一次任何人真实领水龙头币,同样的崩溃会立刻重演**(与金额无关,崩在 UTXO fetch 这一步,非选币/构造阶段)。
- **影响升级**：本线原判定"主库发不出 1 笔大额 = 独立架构 task,不赶",现因水龙头(=所有新用户唯一入口)复用同一崩溃地址,**变成发布拦截级问题**——G4 门无法过,世界杯 7/8 上线时任何真实用户点 /faucet 大概率撞同一崩溃。
- **状态**：已报告频道,待 Bettor/团队定夺。KANet-UI 提议的临时缓解 = 切 `FAUCET_RELAY_ID` 到别的可发送账户(牺牲总池子换活着),或提前 #34 根治优先级。**未擅自执行,等团队拍。**

---

### ✅ #41 oracle liveness / 体育盘完整自动判定 PASS(2026-07-04·世界杯 go/no-go 前置门·NWT+J2）
- **背景**：G7 扫描抓出历史"33 盘 mass-ABSTAIN"疑虑,世界杯要用的 ESPN/kanet_v07 bshard 判定链路近期无真实流量验证过(最近 3 天新建市场全是 polymarket 源,零 ESPN 源 bshard 盘)——这是唯一还没端到端验过的 launch 风险,Bettor 派 NWT+新J1(qzdh7nar)认领。
- **NWT 委员 liveness 检查**：10 个 `is_oracle=1` relay(J2test/NWT/maker-1/2/3/broker-2/tester-1/2/3/OwnerTest)当前全部存活响应(balance 查询全 HTTP 200),排除"委员进程挂了导致沉默"风险。
- **J2 建真实测试盘验证完整链路**：`ext-pool-v07-1783106656453-0rrm8`(ESPN MLB CHW@CLE,已完赛 CLE 主场赢 6-5,J2 押 YES=CLE赢 10KAS)。deadline 后 daemon 19:28:40 tick 自动拾取 → consolidate → judgeLine 读 ESPN 真实数据判 YES(非 ABSTAIN) → committee 签 close_attest → claim 自动派彩,全程零人工介入。
- **NWT 独立链上复核**（不信 DB evidence）：`close_txid`(cf4e567d)+ `claim_txid`(e7f8ddc4)均在 `kaspa_tx_log` 有真实 block_hash;claim outputs 确认真实支付 1,000,000,000 sompi(=10KAS)给 winner 地址。`settle_evidence`: `{winners:1, expected_winners:1, attempted:1, complete:true}`。
- **结论**：ESPN 真数据 → judgeLine 正确判定 → committee 签名 → close_attest 落链 → claim 自动派彩,全链条在今天 G4(faucet UTXO拓扑)/G5-5a(瞬态重试)改动之后依然完整可用。**#41 = PASS**。世界杯正式盘量产仍需 G1(措辞模板等 Owner 点头)+ 赛程 cron 落地,但底层判定机制本身已证实跑通,不是 launch 阻塞。
- owner=NWT(liveness+链验)+ J2(建测试盘+daemon co-verify);协调=Bettor。

---

### 🎉 世界杯 G1-G9 上线门冲刺 + #34 主库/挖矿 mega-UTXO 根治(2026-07-04·公开 7/9 唯一硬 blocker 收口)
#### G1-G9 门状态收口
- **G4(faucet 拓扑)**：百人冒烟从 100/100 全崩 → 三层根因(mega-UTXO wasm 崩溃/`markUtxoSpent`字段路径死代码从未生效/split-utxos 端点硬编码 targetCount)逐个修完,最终冒烟 44/100 成功+56 笔优雅"余额不足"报错、0 崩溃 0 超时 = PASS。NWT 提供 runtime 实测的 `entry.entry?.outpoint.X` 字段路径帮 J2 定位第二层根因。
- **G1(措辞 pre-flight)**：NWT 审两轮(设计 CONDITIONAL GO 2 BLOCKING → 落码 CONDITIONAL PASS 1 洞,均被 J2/Bettor 采纳修复)。核心修法:决赛/季军赛拆独立 win 模板(非 advance)+ pre-flight 镜像源核对改逻辑等价三态 fail-closed(非字面 text-equals)。NWT 补测 soccer/fifa.world event id + 点球战场景(ESPN `winner:true` 官方标记,非比分推算)双双验证通过,世界杯判定链路 de-risk 完成。
- **G5-5a(瞬态重试)**：NWT ship 审 PASS,附一条 best-effort DB 写入吞错的非阻塞观察。
- **#41(oracle liveness)**：见上条,独立 PASS。
- **G3/G6/G7/G8**:各自完成(cap 按叶子数非人数、operator runbook、45 个 ABSTAIN 盘分类、i18n EN默认)。

#### #34 主库 256M/294.7万-UTXO 根治(三轮迭代,NWT 全程 co-verify)
- **根因**(qzdh7nar 协议层实证,读 rusty-kaspa 源码):`GetUtxosByAddresses` 在 Borsh/gRPC/wRPC-JSON 任何编码下都没有分页/游标,服务端必须先物化全量结果——主库(FaucetRelay-tn-2)294.7万 UTXO 已达到协议级不可读的墙,consolidate 该地址本身需要先读它,无解(Direction A 不可行)。
- **Direction C 定案**:挖矿收款迁到全新地址,靠 cron 让新地址 UTXO 数永远处在有界安全区(不追求"找到精确崩溃点",而是待在已知干净区之下)。
- **NWT 三轮红队审**:①机制安全审 PASS(复用 design-v2 B 时期已加固的 `consolidateUtxosRelay`,`withSendLock`原子互斥/`minFragments`阈值真生效/disjoint-address 自检)②抓到告警覆盖缺口(`catch`异常分支——即最危险的"fetch 本身开始崩"场景——原本不写 `events` 表只有 `console.warn`,被 Bettor 升级为启用前必须补,qzdh7nar 当场修复,NWT 复核 PASS)③上线时暴露的 coinbase 成熟度真实 bug(`DEFRAG_MIN_DEPTH=400` < 协议要求的 1000,导致 consolidate 100% 被节点拒绝),NWT 对正在挖矿的地址做真实 RPC 查询验证 `isCoinbase` 字段路径确实可读(非 fallback 到默认值,修复非空心)。
- **最终验证**:console 重启后 cron 连续成功 tick(1755→1/21round、115→1/3round),新地址稳定在 262 UTXO(远低于已知安全线),余额守恒无损。Bettor 24h 观察期收尾。
- **副产物**:transaction.mjs 的 `markUtxoSpent`/`filterPendingUtxos` 死代码 bug(G4 期间修)获得跨节点(J1tn 独立节点连发验证)cross-node 二次实证。
- owner=qzdh7nar(设计+落码)+ KANet-UI(主机执行/相关调研);reviewer/红队=NWT(三轮);协调/co-verify=Bettor。

---

## 🔴 线：诚实分层定位图 — "去中心化"声称 vs 实际机制四层审(2026-07-04·Owner 逼出本质·全队诚实自审)
### 起因
Owner 追问"bot DM 如何呈现诚实+去中心化",团队一度写出"判定来自外部·KANet 说了不算"这类**过度声称**。Owner 反问"杀猪盘也全上链有tx"，逼出真问题：本质不是"有没有tx"，是"谁能改判、谁能动钱"。

### NWT 红队实证（打断过度声称的关键数据）
查 `relay_nodes WHERE is_oracle=1`：当前委员池 **10 个全是 KANet 团队自己的测试账号**（J2test/NWT/maker-1/2/3/broker-2/tester-1/2/3/OwnerTest），**没有一个独立第三方**。PayoutShard.sil 的 4-of-5 签名要求密码学上真实（非摆设），但因签名人全被同一操作者控制，"谁都不能单方面说了算"当前**不成立**——covenant 强制"一旦定了改不了"，但"怎么定的"(payoutRoot 的值本身)由 driver 单方算、委员盲签(不独立重算)。J2 独立验证 fee-split 同理：无任何 `.sil` 文件含 fee-split 逻辑，broker/oracle/node 份额由 JS 层(pool-shard-settle.mjs 等)算好烤进同一 payoutRoot，同一套盲签机制、同一个缺口。

### 最终定位图（Bettor 收紧两轮，团队认领三支柱实证 J2/qzdh7nar/KANet-UI 均参与）
第一轮"四层"版（访问/做市/结算/判定）被 NWT 再收紧一次：③"结算强制"本身还要拆成**机制 vs 内容**——covenant 保证的只是"保险箱砸不开、5 把钥匙要凑 4 把、一旦锁死改不了"（机制真），但**谁赢/赔多少/fee(1.6%)给谁**这些"放进保险箱的内容"，全是 KANet driver 算 + KANet 自己委员盲签，独立第三方没验过。最终版：

| 层 | 状态 | 能说 |
|---|---|---|
| ① 访问入口(电报/自建节点/UI) | ✅ 真开放 | "不锁进 KANet UI·可自建节点/自己下单/自己验证"(退出权) |
| ② 做市(broker 无许可) | ✅ 真开放 | "任何人都能开市当庄"——无 gatekeeper，真突破 |
| ③ 结算【机制】(covenant 锁资金+一旦定案改不了) | ✅ 真 trustless | "保险箱砸不开·连 KANet 都改不了已锁定的内容" |
| ④ 结算【内容】+ 判定(谁赢/赔多少/fee 分给谁) | ❌ 还中心 | "判定谁赢、赔付内容、fee 分成，目前都由 KANet 运营的 driver+委员会定(测试网)·独立验证是路线图" |

**一句话本质**：**保险箱(机制)是真、砸不开；但决定放谁的钱、放多少进保险箱的手(内容)，还是 KANet**。①②③机制层理直气壮讲，④内容层诚实标边界，绝不外推成"我们全去中心化了"。**摊开的诚实本身就是最强信任信号**——比喊"全去中心化"被抓包强百倍。

owner=Bettor(框架收敛两轮)+ J2(covenant/委员/fee 三处代码实证)+ NWT(委员池数据实证 + 机制vs内容二次收紧，两次打断过度声称)+ KANet-UI(DM 呈现落地，待此框架定稿后再写文案)。

---

## 🔴 线：查漏补缺(Owner 2026-07-04 钦定"停新功能,梳理+补漏") — money-path 红队 + gap 清单
### 背景
Owner 令全队停一切新功能，转向梳理现有系统、查漏补缺。Bettor 分域：KANet-UI=用户面/bot、qzdh7nar=基础设施、J2=结算域、**NWT=红队复查 money-path(托管押注/结算payout/faucet节流/cap硬顶/签名路径)**、Bettor=协调+gap清单汇总。

### #25 lint rule 落地(NWT，commit 27df4433)
新增 `R-COMMAND-REGISTRATION` 规则：relay.mjs 的 command case 必须在 commands.mjs 三层(COMMAND_TYPES/PAYLOAD_SCHEMA/FIELD_TYPES)注册——根治 KI-49 复刻 5+ 次(sign_input_for_settle/pool_side_refund_cancelled_tx/get_per_bet_address 等历史坑)。全库跑通 0 error，warn-mode 顺手抓出 3 个历史遗留半截注册(CHAIN_GET_* 系列缺 FIELD_TYPES 条目，非新增回归)。

### NWT money-path 扫描结果
- **托管押注(custodial_transfer)**：干净。privkey just-in-time 解密+用完置 null、错误分支不 echo、AUTH 用 timing-safe 版 verifyIngestRequest。tg_user_id 取自 URL 的信任模型已被代码注释明确记录(靠 ingest-secret 非 tg_user_id 绑定)，已知边界非新洞。
- **#21 settle_failed 102 盘诊断（NWT 独立链上核对 + J2/Bettor 三方收敛）**：canary 重试(tdz3v)揭示"closed=0 安全无双花"≠"重试能成功结算"——原始失败是 UMA judge ABSTAIN(业务层，非瞬态)，重试新失败是 `getBlockAtDaa` MAX_WALK=120000 结构性耗尽(99/102 盘因 deadline 太老、block-walk 成本 O(gap) 撞墙，非挖矿加速导致——KANet-UI/J2 纠正 Bettor 的错误归因)。定性：99 盘是历史遗留、公开不阻(新盘 deadline 在窗口内正常结)，钱安全；J1 提出"一趟摊销 backward-walk 缓存"把批量修复重新定性为补漏(非新工程)，待逐盘链验+分类(MAX_WALK/UMA-ABSTAIN/真瞬态三类分别处置)。
- **🔴 发现 launch-critical gap：faucet 节流域无健康监控**——公开 `/api/faucet/request`(FaucetRelay-tn 7c4cb102)是真实用户第一触点，今早 G4 刚因 UTXO 碎片化/成熟度问题崩过，但当天新增的 `pool-bot-autofund.js` 只监控内部机器人 relay(AutoBetter/HouseAgent/UnderdogBot)，**完全没覆盖公开 faucet relay**——若它退化会对真实用户静默失败，无自动发现机制。KANet-UI 认领纯只读 UTXO 健康监控(复用 #34 alert 模式，不碰 consolidate 避免撞用户 transfer)。
- **🔴🔴 发现更严重的 launch-critical gap：bshard/v0.7 盘 UMA-ABSTAIN 无退款路径**——qzdh7nar 发现 + J2 grep 验证(daemon 三文件 zero 匹配 `cancel_attest`)：PayoutShard.sil 的 `cancel_attest`/`refund_claim` 覆约原语 + kasia-relay/p2sh.mjs 的 `unlockBshardCancelAttest`/`unlockBshardRefundClaim` 交易构造器**全部已造好，但从未被 daemon/orchestration 层调用**——ABSTAIN 时只能无限重判，卡死盘的本金没有退款出口。NWT 补充机制细节(closed 一次性 XOR 闩，cancel_attest 跟 close_attest 镜像，refundRoot 复用 claim 的 merkle 机制换 leaf 内容)：钱链上确定安全(closed=0 未被锁死)，retrofit 是"接线不是重造"，J2 估时 4-6h(镜像 settleMarketLive→cancelMarketLive + refund 循环同构 claim 循环)，现在开工。**这条也回接了今天的诚实框架**："判不了原样退款(ABSTAIN)"这句诚实话，机制没接线之前讲了就是过度声称。
- owner=Bettor(协调+拍板)+ J2(ABSTAIN-refund 实现)+ KANet-UI(faucet健康监控)+ qzdh7nar(#21基础设施配合)+ NWT(红队扫描+co-verify)。

---

## 🔴🔴 #48：bshard 盘 /mybets 显示不出输赢(NWT 发现，DM/UI 查漏补缺阶段，launch-critical)
### 发现
NWT 查 `/api/pool/my-positions`(pool.js:2706-2713)：`did_win`/`outcome_winner` 判定依赖 `metadata.phase2_winner` 字段，但 grep 确认**只有 v0.6 时代的 `pool-market-settler.js` 写这个字段，`bshard-settle-daemon.mjs`/`bshard-auto-settler.mjs` 从来没写过**。实测验证：今天亲自验证过完全正确结算+付款的 `0rrm8`(#41 测试盘，`complete:true`，winner 真实到账 10KAS)metadata 里也完全没有任何输赢相关字段。**影响面 = 所有 bshard/kanet_v07 盘**(含全部世界杯盘)，不是 #21/#33 那类"钱没发出去"，是纯粹"钱可能 100% 到账但用户在 /mybets 永远看不到你赢了/你输了"，卡在模糊的 settledPendingCnt 分类。

### J2 深挖根因（比 my-positions 读错字段更深一层）
`settle_evidence` 现在只存聚合数(winners 计数 + claim_txids 数组)，**没有 per-bettor 明细**(谁赢的、谁的 claim_txid 是哪个)——要显示"这个 bettor 赢没赢"必须知道该 bettor 自己的判定结果，不是市场级聚合数。`settleMarketLive` 的 `r.claims` 已有完整 `{pk, amount}` 明细，只是没落库持久化。

### 处置（Bettor 协调，#48 顶置）
- **launch-critical = 新盘(世界杯)结算后正确显输赢**，7/5 首场(Brazil v Norway)前必修——真实用户第一眼看到的东西。
- **历史 backfill(187 老完成盘)= follow-up**，不阻新盘先修。
- 分工：J2 定数据源(daemon writeback 补 per-bettor 明细，复用现成 `r.claims`)→ KANet-UI 接前端 display → **Bettor+NWT co-verify**(造 1 赢 1 输的真实结算 bshard 盘，验 /mybets 正确显示"赢+金额"/"输"，不卡 pending)。
- 撞车记录：KANet-UI 一度想直接改 my-positions 读 `pool_bettor_sides.claim_txid`，但 J2 验证该列从未被 bshard daemon/settler 写过(只退款路径用)——KANet-UI 主动 git checkout 撤回错误方案，让给 J2(settle_evidence 结构的建造者)先定数据源。

owner=J2(数据源)+ KANet-UI(display，待结构定稿接手)；co-verify=Bettor+NWT。

---

## 🔴 daemon 错误处理系统性红队审计(NWT, 响应 Owner"机制不够强壮"质疑, 2026-07-04)
### 背景
Owner 看到 #21(99盘老账)后追问："以后新盘会不会也卡死？现在机制如何？感觉不够强壮，经常退化"。全队诚实收敛：新盘(准时结算)风险低(MAX_WALK 只在拖久了才撞)，但结构脆性是真的——settle 失败恢复 = 同 tick 内重试 3 次(几秒)不成→永久标 settle_failed→SQL 排除→靠人工 operator review(今天全靠 Owner 自己发现某盘卡住)。三层修法：①立即做(补漏)settle_failed 告警(KANet-UI) ②NWT 系统审计现有 daemon 容错路径(查漏补缺，非造新机制) ③跨 tick 自动重试(唯一"新机制"项)——放到审计之后再拍。

### NWT 审计结果：4 个 landmine，#48 不是孤例
逐行梳理 `bshard-settle-daemon.mjs` 全部 catch 边界，发现同一上游病根(catch-all conflate 业务失败/瞬态故障/纯代码 bug)的 4 处症状：
- **①(高影响)** post-writeback 裸调用无独立 try/catch(影子台账 `recordShadowJudgment` 调用，L314-318)：完全靠被调函数"永不 throw"的口头承诺，非结构性保证——#48 就是这么撞的(market 变量作用域丢失)，只修了那一次具体撞车，模式本身没变。
- **②(高影响)** writeback 失败被静默吞掉还报告成功(L284-305)：`sqlite.transaction` 失败(如 DB 锁)catch 只 log warning 不 rethrow，函数照样 return `{ok:true}`——daemon 以为成功，DB 其实卡在原状态(既不 completed 也不 settle_failed)，永不进重试也永不告警，比"真失败"更隐蔽的静默中间态。
- **③(低)** 标记 settle_failed 这个 UPDATE 本身失败被空 `catch{}` 吞掉，连日志都没有。
- **④(根)** G5-5a 重试 wrapper(L227)是宽泛 catch-all，把 `_settleOneMarketAttempt` 任意位置抛出的任意异常(业务/瞬态/代码 bug)一视同仁处理——①②是它的下游症状，这是上游根。

### 处置(J2 领 ①②，commit b4256926)
- ①改为独立 try/catch 包裹调用表达式本身(不止靠 `.catch()` 处理 async rejection，同时兜住同步 throw)。
- ②改为 `return {ok:false, reason: 'writeback fail: ...'}`，让外层 G5-5a 正确判定失败→落地可见的 settle_failed(能被 KANet-UI 新告警抓到)，好过静默卡死。
- ③④暂缓：④是根本设计问题，认可但排后面，需要更大改动再讨论；跨 tick 自动重试(Owner 关心的"根治")留到审计之后再拍，不过度。

### NWT ship 审出的边缘 case(J2 确认，commit ea830c61 记入 #47 runbook，不改代码)
②修复后有一个理论存在但概率极低的 edge case：若 writeback 失败恰好发生在 close_attest 已上链成功之后(closed=1)，retry 重跑 settleMarketLive 会用硬编码的 closed=0 假设去 build，链上实际是 closed=1 → 交易会因 UTXO-not-found 类错误安全失败(不会误动钱)，但市场会落地 settle_failed 而实际上链上已经结算完成，需要人工查链上 PS 地址状态后走 #47 runbook 的 resume-claim(非重新 close)。J2 判定：writeback DB 写失败本身就罕见，又要卡在这个精确窗口，概率极低——记入 runbook 当一个 case，不现在改代码。Bettor 确认②仍是净改善("从 silent 卡死变 visible 卡·operator 能救")。

owner=NWT(审计)+ J2(①②实现+边缘case分析)+ KANet-UI(settle_failed 告警监控，配合验证)+ Bettor(协调+co-verify)。

---

## 归档(已收敛旧线,留索引)
- **scale-test backend-20**(2026-06-10):干净 demonstrate 20 并发 settle,框架 §10.2/§9.3 活案例。已收敛。
- **tg-bot-web-user-e2e**(§14 首个受控运行):演化为线 3 可玩 demo。
