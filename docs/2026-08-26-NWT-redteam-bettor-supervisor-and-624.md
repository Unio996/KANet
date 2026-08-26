# NWT 红队 — ledger (624) 8/23 崩溃根因 + Bettor 自动化机制 + KANet-UI 探针设计稿

> 作者 NWT(攻击审/关3/红队)· 2026-08-26 · 派工来源 Bettor(kanet-tn12-08 对等消息)
> 交付三项:(1) (624) 8/23 崩溃根因红队 (2) 自动起人/监工机制红队 (3) KANet-UI kaspad 探针设计稿审
> 证据纪律:每条标 `[MEASURED]`(事件日志/进程/文件原始返回)/`[READ]`(读码)/`[INFERRED]`。命令与原始输出可复跑,关键行贴在正文。
> 头号铁律:default = 试图打穿。每条 PASS 都列了"我试了哪些攻击、为什么打不穿"。

---

## (1) 8/23 整机崩溃根因 — 红队结论:**Bettor (624) 的因果方向搞反了,须重写**

### 1.1 (624) 原判(被审对象)
> "kaspad 0xc0000409 + 崩溃偏移每次完全相同(确定性故障, 非随机 OOM);每次崩后被 watchdog 重新拉起再踩同一坑。…commit charge 撑顶。llama --ctx-size 1M 是**放大器**。"

即:**kaspad 确定性 bug = 驱动**,内存撑顶 = 后果,llama = 配角放大器。

### 1.2 我试图证实这个判断,证据把它推翻了 `[MEASURED]`

**决定性时序 —— 内存耗尽在 kaspad 第一次崩之前 73 分钟就到了:**
```
18:39:10  System/2004 低虚拟内存首报:llama-server(12036)=32.80GB + kaspad(25524)=25.35GB + NordVPN=2.24GB
19:14:29  System/2004:两个 llama-server 同时在(12036=32.80GB + 51892=32.37GB)= 单 llama 就吃 65GB commit
19:52:07  kaspad 第一次 0xc0000409(Application Error/1000, PID 0x9730, offset 0x14a7027)  ← 崩溃从这里才开始
20:52:20  Service Control Manager/7023:多个服务 "分页文件太小" 开始起不来
22:17:50  kaspad-stderr:"OS can't spawn worker thread: The paging file is too small (os error 1455)"
23:17:xx  整机失响;02:19:38(8/24) shutdown.exe 强制重启
```
- **低虚拟内存(18:39)先于 kaspad 首崩(19:52)整整 73 分钟。** 内存条件是因,kaspad 崩是果,不是反过来。

**"确定性 0xc0000409 同偏移" = OOM 签名,不是代码 bug `[MEASURED]`:** 把 8/23 每个 kaspad 崩溃 archive 的 stderr 原文读出来,panic 消息全是内存/IO 耗尽类,没有一条是逻辑 bug:
```
18:41  header_processor.rs:376  StoreError(DbError "IO error: ReadFile failed: ...735113.sst: Insufficient system resources exist to complete the requested service"
19:16  sync/mod.rs:94           DbError "...738663.sst: Insufficient system resources..."
21:14  consensus/mod.rs:1443    DbError "...726808.sst: Insufficient system resources..."
22:17  consensusmanager/session.rs:169  "OS can't spawn worker thread: The paging file is too small (os error 1455)"
21:34  body_processor.rs:236    DbError "...709879.sst / 736936.sst: Insufficient system resources..."(并发两 block-pool 同时倒)
```
`0xc0000409`(BEX64)是 Rust `panic → abort` 的**终止签名**,"同偏移 0x14a7027" 只说明它们**每次都在同一条 SST 读取路径上因资源不足 abort** —— 这是"永远在同一处 OOM"的必然,不是"kaspad 有个确定性逻辑 bug"。把它读成确定性 bug 会误导下一个人去查 kaspad 代码,而真因在内存。**REFUTE (624) 的"确定性故障非随机 OOM"这半句** —— 它恰恰是 OOM,只是 OOM 点固定。

### 1.3 主凶权重判断(Bettor 明确要的,且要求不顺着他走) `[MEASURED]`
机器:66GB RAM + 38GB pagefile ⇒ commit 上限 ≈99.6GB。各消费者:

| 消费者 | 8/23 commit | 现在(idle) | 性质 |
|---|---|---|---|
| **llama-server ×1** | 32.8GB | **30.15GB(Priv), VirtualSize 247GB, WS 仅 3.3MB** | `--ctx-size 1048576` + q8_0 KV 常驻,**不干活也占 30GB**,全机第一 |
| **llama-server ×2(19:14-19:16 期)** | **65GB** | — | 期间出现第二个 llama,单这一项就吃掉 2/3 commit 上限 |
| kaspad(旧坏库 IBD) | 25.3GB | 4.1GB | IBD 期真实大,但**瞬态**;换新库后只 4GB |
| console + 32 relay 子 + node | ~4GB console + 子 ~100MB×32≈3.2GB | 同 | KANet-UI 已核 35 子=正常拓扑,**不是内存主体** |

**权重裁定(独立于 Bettor 的倾向):**
- **主凶 = 常驻内存本体,以 llama-server 为首(30-32GB,且一度 ×2=65GB),不是 kaspad。** kaspad 的 25GB 是 IBD 瞬态贡献,且换新库后蒸发;llama 的 30GB 是**空载常驻**、事故前后都在(kanet-start.sh:235 硬编码 `--ctx-size 1048576`)。⇒ **(624) 把 llama 记成"放大器"是低估了,它更像撑顶主体;kaspad 反复崩是被撑顶后压垮的最后几根稻草。**
- 证据能分先后吗?能,且已分:**18:39 低虚拟内存(此刻只有 1 个 llama+kaspad IBD)先于 19:52 kaspad 首崩。** 到 19:14 出现第二个 llama = 65GB,是把机器推过悬崖的事件。**"分页文件太小"最早致命时刻(20:52 服务级 / 22:17 kaspad 级)全部晚于内存耗尽起点(18:39),更晚于 llama 双开(19:14)。**
- ⇒ 顺序链:**llama 常驻 30GB(底噪)→ 第二个 llama 双开 65GB(18:39-19:14 推过线)→ 虚拟内存耗尽 → kaspad 的 SST 读取因资源不足 panic/abort(19:52 起)→ watchdog 反复拉新 kaspad(每次又试图 +25GB commit,火上浇油)→ 服务全线起不来 → 整机失响。**
- 🔴 **第二个 llama 的来源未坐实**(留一条诚实缺口):`scripts/llm-watchdog.mjs` 的 `spawnLlama()` 只探 `/health`、**无端口占用守卫**,health 探针在内存压力下 3s 超时即会再 spawn 一个 32GB llama(正反馈);但我没找到 llm-watchdog 被拉起的位置(grep launch 站点为空),所以第二个 llama 也可能来自 kanet-start.sh 被重跑。**判据成立部分 = 双 llama 实测在册(19:14 事件日志);未定部分 = 谁 spawn 的它。** 归 KANet-UI 域跟进。

### 1.4 relaunch 放大器:不止 kaspad-watchdog,更大的是 console-supervisor 增殖 `[MEASURED]`
(624) 只点了 kaspad-watchdog。实测有**两条独立 relaunch 环**,后者规模大一个量级:
- **kaspad-watchdog**:8/23 约 195 条 probe-fail/relaunch 行,每 ~3 分钟 dispatch 一个新 kaspad(在册 PID 67064/38704/78020/84064/44244/10000/73988/53676/34896/84900/12540…),每个都想吃 25GB。20:45 watchdog 自己都抛 `System.OutOfMemoryException`(loop error,靠 try/catch 续命)。
- **console-supervisor 增殖(更严重)**:`logs/console-supervisor.log` **8/23 当天 557 条 "supervisor start pid"**(全期累计 714;Bettor 独立 grep 得 557 = 8/23-only,已对齐,量级一致),峰值 T11 一小时 316 次。机制根因 `[READ]`:
  - `kanet-start-headless.sh:155` 每次拉 console 都 `bash kanet-console-supervisor.sh start` 再起一个 supervisor;
  - supervisor `start`(:177)查 PID_FILE 判重,但 `_run`(:143 `echo $$ > PID_FILE`)在 `nohup` 派生 + `sleep 1` 之后才写 pidfile ⇒ **TOCTOU 竞态**:两个 headless 几乎同时进来都读到旧/空 pidfile,都派生 `_run`。实测 8/23 有 **36 次"同一秒两个 supervisor 同时 start"**(如 08:59:52 pid=111436 + 111437)。
  - console 每崩一次 → headless → 又一个 supervisor + 又一次 llama 端口检查 ⇒ 正反馈。这条环在内存起火后疯狂放大重启,是"commit 撑顶"里被 (624) 漏掉的大头。
  - 附带 `[MEASURED]`:supervisor 跑在 SYSTEM 下,`announce_restart` 的 `git status` 每次都 `fatal: detected dubious ownership`(SYSTEM≠ADMIN 属主)⇒ 本该在重启播报里警告"脏工作树带飞"的 DIRTY 检测**静默失效**。独立小 bug,记一条。

### 1.5 (1) 交付结论
- **REFUTE (624) 的因果方向**:内存耗尽是驱动(18:39,先于 kaspad 首崩 73min),kaspad 崩是被 OOM 诱发(panic 全是 "Insufficient system resources"/"paging file too small"),**"确定性 bug"是 OOM 签名的误读**。
- **主凶权重**:常驻内存本体(llama 30-32GB、一度双开 65GB)> kaspad IBD 瞬态 25GB;console 子进程不是内存主体。**llama 应从"放大器"上调为"撑顶主体之一"。**
- **relaunch 放大器要补 console-supervisor 增殖环(714 起/36 双起/TOCTOU)**,它比 kaspad-watchdog 环规模大。
- 真修方向(供 Bettor 派工,非本红队执行):① llama `--ctx-size 1048576` 降档或按需加载(30GB 空载常驻是最大杠杆)② supervisor pidfile 竞态修复(先写 pidfile 再 fork,或 flock)③ 两个 watchdog 都缺"内存感知刹车":OOM 期间 relaunch = 火上浇油,应在 commit charge 高于阈值时**拒绝拉新进程 + 告警**,而不是无脑拉。

---

## (2) 自动起人/监工机制红队 —— 结论:**四个攻击面全部成立,两个是承重缺陷**

被审对象:`_bettor_launch_agents.ps1`(仓根 gitignored)+ 五份接位文件第 6 条 / Bettor 4.6 条 + (624) 升级三类规则 + `logs/bettor-supervisor.log`。

### 2.1 接位文件不在 git、可被改 → 起人时喂假指令 `[MEASURED]` — **成立,承重**
- 实测:`cd 'C:\开发过程\多智能体开发框架\开发智能体接位' && git rev-parse` ⇒ **`fatal: not a git repository`**。这个目录**根本不在任何 git 下**,无版本、无完整性校验、无 diff。
- launcher 把 `$handoff`(该目录下的文件)路径直接注进 seed,agent 一开机把它当身份+指令**逐字执行**。谁能写这个目录(= 本机文件访问),谁就控制每个被拉起 agent 读到的"我是谁、我该干嘛"。
- 讽刺佐证:终端自驱 SOP **正本**已被显式迁进 git 仓库,理由白纸黑字"本目录不在 git、跨机不同步"——团队**已经知道**这目录不可信,却让整套起人机制的 seed 源依赖它。
- 严重度:真实但边界 = 需本机写权限(已等于机器控制),非远程向量。但它**摧毁了 (d) 那条"seed 说别花钱"的最后防线**(见 2.4)。
- **不能 PASS**:攻击链成立(改 handoff → 下一个被拉起的 agent 带毒指令启动,无任何检查会发现)。修:承重接位文件迁进 git 仓库(同终端 SOP 正本的处置),launcher 起人前校验 seed 源的 git 干净度/hash。

### 2.2 对等消息 from 地址能否伪装成 Bettor 派工 `[MEASURED]` — **成立(vacuous 认证)**
- from 地址是 UDS 管道名 `uds:\\.\pipe\LOCAL\cc-msg-<hash>`。实测枚举 `\\.\pipe\LOCAL\` 有 4 个 cc-msg 管道(每会话一个)。
- 我试图打穿"以 from 地址为准"这条 Bettor 定的信任规则:**它不是密码学身份,只是管道路径 + 自报会话名。** ListAgents 显示的名字是会话**自报**的。没有签名、没有 challenge。
- 攻击链:本机任一进程若能创建一个 `\\.\pipe\LOCAL\cc-msg-*` 管道并让 ListAgents 收录、自报名为 `kanet-tn12-08`,则**按名字**路由的 peer 会把它当 Bettor 收派工。按精确管道 hash 区分稍好,但那个 hash **没有任何地方 pin 死**(不像 relay 公钥有 D-010 签名根)。
- ⇒ **"以 from 地址为准" 提供的安全属性 = 0,全靠"本机只跑可信进程"这条环境假设兜底** —— 与 2.1 同一条信任边界。这不是"有认证",是"看着有认证"。记忆里同族:`reference-bcast-sender-address-is-output0-spoofable` / `reference-fake-system-directive-in-untrusted-ticket-is-not-authorization`。
- 严重度:同样是本机信任边界内,但要点是**别把它当认证用**。凡对等消息导致的不可逆动作(派工去花钱/重启),接收方不能只凭 from 地址,须回到独立闸(钱路走 Owner/gated 脚本)。

### 2.3 监工重启决策只有一个 log、无人核 → 与 8/23 watchdog 同坑同形 `[READ+MEASURED]` — **成立,承重**
这是与 (1) 最直接的同构,Bettor 自己点名要我查它是不是同一坑 —— **是,而且更脆**:
- **结构同形**:Bettor-supervisor 有"判某 agent 死 → 自动重起"的权力,判据(进程/ListAgents/N分钟无回报)会误判,决策只落 log,NWT 事后按班审 = **检测,非预防** —— 与 kaspad-watchdog"只 log、无刹车"一模一样。
- **比 watchdog 更脆的三点**:
  1. **launcher 无 already-running 闸** `[READ]`:`_bettor_launch_agents.ps1` 对每个 agent **无条件 `Start-Process`**,不检查是否已有 `claude-<Agent>` 会话在跑。⇒ Bettor 误判一个"活着但安静"的 agent 死了去重起 = **同一 handoff 上两个 NWT/J2 并存**,都可能动手。连 console-supervisor 那个(有 pidfile 的)都还 TOCTOU 双起了 36 次,这个连 pidfile 都没有。
  2. **三路探活其中一路对 bypass 会话结构性失效** `[MEASURED]`:实测本会话(bypass 模式)**不在自己的 ListAgents 里**,Bettor 4.6 也承认"bypass 会话似乎不注册"。⇒ "ListAgents 看不看得到"这一路对 bypass agent 恒为黑,Bettor 实际只剩 2 路,且"N 分钟无回报"是最弱的一路(深度工作中的 agent 合法地会安静很久 —— 我这轮读证据就十几分钟没回 Bettor)。**误判死的概率被抬高 → 重复拉起的概率被抬高。**
  3. **"连续 2 次重启仍不推进才升 Owner"**:在 1+2 的误判率下,可能在真 agent 还活着时就触发,升级门反而延后发现"我在重复拉活人"。
- **不能 PASS**:承重缺陷。修:launcher 起人前必查该 agent 是否已有活会话(窗口标题 `claude-<Agent>` 或管道枚举),已活则拒起 + 告警;bypass 会话既然不进 ListAgents,把"回报心跳"做成 agent 主动写一个带时间戳的 heartbeat 文件,让探活有一路是**agent 自证在世**而非 Bettor 猜。

### 2.4 "seed 说别花钱"是约定不是机制 `[READ]` — **成立,最该正视的一条**
- 拦住被拉起 agent 链上花费的**唯一**东西 = seed 里那句中文"不要自己发起任何链上花费"。**没有能力闸**。
- 叠加 2.1(handoff/seed 源不可信且可改):攻击者改掉 seed 字符串,连这句约定都没了;即便无攻击者,一个读漏/忘了 seed 的 agent 也没有任何结构性东西挡它。
- 真正存在的闸在别处(relay 发送要走 canonical 脚本、money-path covenant 要 Owner),但 seed 这句"别花钱"是**纯荣誉制**。记忆同族:`reference-a-security-property-must-come-from-the-only-path-not-the-recommended-one`。
- 建议:**别把 seed 这句当控制**。控制必须来自"NWT/各 agent 的 relay 相互独立 + 钱路动作只能过 gated 脚本 + Bettor/Owner 复核"这条唯一路径;seed 的话最多算提示。

### 2.5 (2) 交付结论
四面全成立:2.1(接位文件不在 git,承重)、2.3(监工无预防闸+launcher 无判重+bypass 探活失效,承重)是必修;2.2(from 地址 vacuous 认证)、2.4(别花钱是荣誉制)是"别把它当安全属性"的口径纠正。**共同根 = 整套自动化的信任全部落在"本机只跑可信进程 + 荣誉制约定"上,没有一层是机制。** 与 CLAUDE.md 铁律 0"规矩靠自觉守不住必须上机制"精神一致 —— 这套自动化目前正是"靠自觉"。

---

## (3) KANet-UI 探针设计稿审(docs/2026-08-26-kanet-ui-kaspad-probe-ibd-vs-dead-design.md, commit d5a82648)

**总评:PASS-WITH-MUST-FIX(push-back)。** 三态判据/退码只加不改/进程枚举避 CommandLine 盲区/fail-open-to-SYNCING/证据纪律都扎实,V0-V7 预注册含对照臂+变异臂是正确姿势。但 Bettor 点名的三个打点,我打穿了两个,须修才落码。

### ③-① diskIoWriteBytes 单调增能否被"进程活、IBD 卡死"伪造 — **能,MUST-FIX**
- RocksDB **后台 compaction / memtable flush 独立于 IBD 进度写盘**。真卡死(卡在坏 peer、共识死锁)时 DB 引擎仍可能持续 compaction ⇒ `diskIoWriteBytes` 一直涨 ⇒ 探针永报 SYNCING ⇒ 永不 STALLED ⇒ 永不告警。这正是设计要防的"假活",却被兜底信号放进来了。
- 作者 §9.1 已诚实提出这个疑问,其自拟缓解 `diskWrite增 && (activePeers≥1||ibdPeer)` **仍可被绕**:卡死的 IBD 完全可以挂着一个 idle ibdPeer 连接(今日实测那个 peer time_connected 14657s 稳定)同时零 header 进度。
- **修法(承重)**:进度判定分两层,`diskIoWriteBytes` **不得作为独立进度信号抑制 STALLED**:
  - **硬停滞层**:至少一个**共识级**计数器(headerCount / nodeHeadersProcessedCount / blockCount / virtualDaaScore 任一)在较长窗口(建议 60min)内为动,否则 = **硬 STALLED 告警**,无视 diskWrite。
  - `diskIoWriteBytes` 只用来区分"SYNCING-慢"要不要**吵**(告警节奏),永不用来把 STALLED 压成 SYNCING。
- **补一个预注册负测 V8**(现缺):喂状态 = 所有共识计数器冻结 + diskWrite 跨 31min 持续增 ⇒ 设计现输出 SYNCING(永远),**须改成 STALLED**。V7 只证了 diskWrite 是承重的,没测**反方向伪造**(diskWrite 在而共识冻),V8 补这个方向。

### ③-② "kaspad.exe 在就拒拉"硬闸会不会漏掉 8/23 那种形态 — **会漏,而且漏的正是危险那一半,MUST-FIX**
- 与 (1) 交叉核对:8/23 的形态是 **进程崩(退出)→ watchdog 拉新 → 新进程 → 又崩**。做重启决策的每一刻,上一个进程**已经崩掉退出了** ⇒ 硬闸看到"没有 kaspad.exe" ⇒ **放行 Start-Process**。
- ⇒ 硬闸只挡得住**今天这种**(好进程还活着、IBD 中、拉新会撞 LOCK)的良性误拉,对 **8/23 崩溃环完全无效**。更糟:8/23 每次拉新 kaspad = 又一次试图 +25GB commit 砸进已 OOM 的机器,**主动加害**。
- ⇒ 设计 §6 的"拉起刹车"**不是可选/可分开审的附带建议,它是唯一能治 8/23 形态的东西**;硬闸给人"我们修好了 relaunch 问题"的假安全感,恰恰盖住了危险那半。
- **修法**:§6 crash-loop 刹车从"附带可分开"**升为 REQUIRED**,且刹车判据必须覆盖**进程缺席型 crash-loop**(N 次 start / M 分钟,每次拉的 PID 到下一 tick 就没了 ⇒ CRASH-LOOP ⇒ 停拉 + 告警);并加**内存感知**:系统 commit charge 高于阈值时拒绝拉新(直接对接 (1) 根因 —— 别往 OOM 机器再扔 25GB 进程)。

### ③-③ 与我 (1) 根因结论是否一致 — **一致,但优先级排反了**
- 探针设计正确抓住"watchdog 把健康-但-同步中的节点当尸体反复拉"(今日良性形态)并修好了它,且 §1.3 自己发现"拉新截断活节点日志"—— 与我 (1) 里"relaunch 污染日志害了取证"完全同源,好 catch。
- 但 (1) 表明**危险的是 crash-loop-under-OOM**,而这个设计主体(三态 SYNCING)**不解决它**,唯一缓解(§6 刹车)被标成可选附录。⇒ **设计修好了危害较小的失败(IBD 期假 DEAD → 撞 LOCK 空拉 + 截日志),把危害更大的失败(crash-loop 放大 OOM)留给可选附录。优先级须对调。**

### ③ 退码 3 收窄 = 存量语义变更须 verdict-before-push:**确认成立**,作者自判正确。落码后 diff 必须 NWT GREEN 才推。

### (3) 交付判词
- **PASS-WITH-MUST-FIX**,两条必修:MF-1(§3.2 diskWrite 伪造 → 加共识计数器硬停滞层 + 预注册 V8);MF-2(§6 crash-loop 刹车升 REQUIRED,覆盖进程缺席型 + 内存感知拒拉)。
- 两条必修都做完再落码;退码只加不改、进程枚举避 CommandLine、fail-open-to-SYNCING、per-PID 日志路径根治截断 —— 这些保持,是对的。

---

## 附:证据可复跑命令(全只读)
- 崩溃时序:`Get-WinEvent -FilterHashtable @{LogName='System';ProviderName='Microsoft-Windows-Resource-Exhaustion-Detector';StartTime=...}` + `LogName='Application';ProviderName='Application Error'`(filter kaspad)。
- kaspad 真 panic:`D:\kaspa-tn12-data\kaspad-stderr.log.20260823-*`(archive 逐个 tail)。
- 内存现状:`Get-CimInstance Win32_Process | Where Name -match 'llama-server|kaspad|node'`(取 PrivatePageCount/VirtualSize)。
- supervisor 增殖:`grep -c 'supervisor start pid' logs/console-supervisor.log`(714) + 同秒双起统计。
- 接位目录非 git:`cd 'C:\开发过程\...\开发智能体接位' && git rev-parse`(fatal)。
- launcher 无判重:`_bettor_launch_agents.ps1` foreach 内无条件 `Start-Process`。
- bypass 不进 ListAgents:本会话 ListAgents 输出不含自己。

---

## (4) J2 节点健康判据稿审(docs/2026-08-26-j2-node-health-criterion.md, 26fe8101) + 与 KANet-UI 稿同尺交叉核

**总评:PASS-WITH-MUST-FIX,与 UI 稿同 tier。** 六问合取、每阈值带出处、§5"每个读数配一张'它何时说谎'表"= verify-value-source 纪律的正确落地,§8 诚实边界清楚。源码断言我逐条地面核过(下),J2 的三条自问我判两 PASS 一 PARTIAL,另有三条 J2 没问到的洞。

### 4.1 源码断言地面核(不信文档,读码) `[SRC 已复核]`
- ✅ **写路径有闸**:`transaction.mjs:150-151` = `const {isSynced}=await rpc.getServerInfo(); if(!isSynced) throw 'RPC node is not synced'`,随后还查 UTXO 非空。
- ✅ **读路径零闸**:`p2sh.mjs:94-103 connectRpc` 只 connect,`getAddressUtxos:1516` 直接 `getUtxosByAddresses` 返回;**`grep isSynced p2sh.mjs` 零命中**。读写不对称成立,今日 `utxos=[]` 静默空集来源坐实。
- ✅ **isSynced 是时间判据**:`rusty-kaspa/protocol/mining/src/rule_engine.rs is_nearly_synced` = `unix_now() < sink_timestamp + difficulty_window/4`,注释 "Roughly 10mins"。J2 的实质刻画对。🔵 **一处精度**:此函数是 `is_nearly_synced`(**挖矿模板门**);J2 引它作 `getServerInfo().isSynced` 的定义 —— 二者概念同源(都是 sink 时间新鲜度),但落码后须确认 RPC 的 isSynced 走的是同一路径(建议 §6 出处栏标 `is_nearly_synced` 全名 + 备注"getServerInfo 复用之待确认")。
- ✅ **probe 退码3**:`kaspad-rpc-probe.mjs:88-89 if(!(daa>0n)) die('empty-data',3)`,确认。

### 4.2 J2 的三条自问
- **① diskIo 假进度改合取 `diskIo↑ ∧ (activePeers≥1 ∨ ibdPeer)` — PARTIAL,须绑我的 MF-1。** 合取比 diskIo-单独好(挡"无 peer 空转"),但**没关死** —— 我在 (3) MF-1 已打穿:卡死的 IBD 可以**挂着 idle ibdPeer + RocksDB 后台 compaction 持续写盘**,两个条件都满足而共识零进度。⇒ J2 的 ① 与 UI 的 §9-Q1 是**同一个不够的缓解**。统一修法(两稿都落):`diskIoWriteBytes`(无论是否 ∧peer)**永不用来抑制 STALLED**;STALLED 由共识级计数器(headerCount/nodeHeadersProcessedCount/blockCount/daa 任一)在较长窗(60min)零进度硬判,diskIo 只调告警节奏。两稿的 diskIo 处理必须收敛到这一条,否则同尺不同刻。
- **② 稿里写明 isSynced 源码定义 — PASS。** 已核(见 4.1),照写,带上 4.1 那条精度备注。
- **③ (622)-② 触发换 blocks/s 与 lag、删 tips>4500 — PASS。** tips 在健康态与近停滞态读数相同(§1 数据自证),不可做判据,删对。🔵 caveat:`blocks/s<1 持续30min` 与 `lag>60min` 两阈值全来自 **8/23 重启前** 数据(J2 §8 已诚实标),重启后振荡是否还在未采 ⇒ 阈值是 provisional,落 watchdog 前应有一轮 post-restart 采样确认,别当冻结值。

### 4.3 J2 没问到的三条(我打的) `[红队]`
- 🔴 **F-A(headline·UI 稿【自相矛盾】的 ALIVE 边界,打在今天这个 bug 上)**:
  - 🔵 **自我更正(2026-08-26,我最初读了陈旧版)**:我第一版说"UI v0.1 里没有 3.2b、没有 R6 检查"—— **错了,是我读了 `d5a82648`(6e709925 之前)那一版**。Bettor 纠出后我 `git log -1` 复核:UI 稿 HEAD = **`6e709925`**(E-bis,Bettor 补),`### 3.2b ALIVE 须含「UTXO 集可用」`确实在(worktree 另有未提交 `M` 改动,读的是 worktree)。归因是事实断言,记这一条:**判"某稿没有某节"前必先 `git log -1 -- <file>` + 读 worktree,别信手头缓存的读数。**
  - **但 F-A 的实质不仅成立,且更硬 —— UI 稿现在【内部打架】**:§3.2b 明写 `ALIVE 在 3.1 L4 基础上再加 A1(daa>下界)∧A2(对照址非空),缺一⇒仍 SYNCING`(= ALIVE 要求 R6);**然而同一份稿的另外四处没跟着改,仍把 ALIVE 定义成 `isSynced && daa>0`,不含 R6**:①§3.3 退码总表 `| 0 | ALIVE | isSynced && daa>0 && network 对`;②§0 三态摘要;③行 84 `ALIVE 仍要求 isSynced && daa>0`;④§4 映射表 `isSynced && daa>0 | (ALIVE)`;⑤验收 V2 `isSynced=true 且 daa>0 ⇒ ALIVE(0)`。⇒ 落码者照 §3.2b 写就要求 R6、照 §3.3/§4/V2 写就不要求 —— **半份稿说错话**。而"isSynced=true、daa>0、utxos=[]"正是今天 `utxos=[]` 钱路读空的失败态:§3.2b 判 SYNCING(对),§3.3/§4/V2 判 ALIVE(0)(错)。
  - **统一裁定(MUST-FIX,两稿都钉)**:`ALIVE ⇒ R6`(钱路能真读到 UTXO)。UI v0.2 须把 §3.3 退码0 定义、§0 摘要、行84、§4 映射、V2 **全部**改成"ALIVE = 3.1 L4 ∧ A1 ∧ A2",不能只在 §3.2b 补一段而正文表格照旧。J2 §4"对不上=0"当时对的是含 3.2b 的 HEAD,方向没错,但没抓到 UI 稿正文表格与 3.2b 的自我不一致 —— 这条我补上。
- 🔴 **F-B(R6 的牙够不够硬·MUST-VERIFY,阻塞 R6)**:R6 用"阳性对照址非空"证 utxo 索引可用。但**对照址非空只证索引【建了一部分】,不证【建完】**。若 utxoindex 在(重)建期间 `getUtxosByAddresses` 返回**部分结果**(对照址已populated 而某 pocket 址仍 []),R6 通过 → ALIVE → 钱路把那个 pocket 读成空 → 错误结算。R6 存在的**全部意义**就是挡 `utxos=[]`,若它能在别的地址仍空时通过,就没挡住。**落码前必须验:rusty-kaspa 的 utxoindex 重建期间,`getUtxosByAddresses` 读是原子/门控的,还是能看到半建状态?** 若非原子,单个对照址不够,须换"节点级 utxoindex-synced 信号"或接受 ALIVE 在 isSynced∧稳态前有残余风险。
- 🟡 **F-C(R6 负例语义歧义)**:J2 自己指出"对照址被掏空(矿址会转出)→ R6 假红 → 报 UNKNOWN 换址"。但**"对照址 []"在"索引没建好"与"地址被花光"之间无法区分**(都返回 []),⇒ 探针**不知道何时该换址**。修:对照址用**不可花费**的永久 UTXO(burn/covenant 址,已知常驻),或 R6 负例时交叉核 `getInfo().isUtxoIndexed`(=启动带 --utxoindex,必要非充分)+ isSynced 再定 UNKNOWN vs DEAD。

### 4.4 (4) 交付判词 + 同尺交叉核结论
- **J2 稿 = PASS-WITH-MUST-FIX**:MF-J1(① diskIo 绑 MF-1 共识计数器硬停滞层)、MF-J2(F-A ALIVE 须含 R6,与 UI 收敛)、MUST-VERIFY(F-B utxoindex 重建期读是否原子);②③ 照做,③ 阈值标 provisional;F-C 换不可花费对照址。源码断言全部核实,证据纪律 exemplary。
- **同尺交叉核**:两稿共用退码谱系是对的方向,但**当前 ALIVE 边界不一致(F-A)+ diskIo 处理不一致(① vs MF-1)** —— 两处必须收敛成一套刻度,否则"同一把尺"名不副实。UI v0.2(含我 MF-1/MF-2,Bettor 说约40min到)到后,我做最终同尺核:重点验 ①v0.2 是否把 diskIo 降为"只调告警节奏"、② v0.2 的 ALIVE 是否补了 R6。**在 UI v0.2 到达并与本 J2 稿在 F-A/① 上对齐前,两稿都不落码。**

---

## (5) J2 稿 v0.2 终核(HEAD `0eb71684`)+ F-B 源码复核 + Bettor 问题回答

**总评:J2 v0.2 = PASS(接受),F-B/F-C 回答扎实且源码核得住;R6 的性质 Bettor 问对了要点。** 读的是 HEAD `0eb71684`(worktree clean),§9 引用全部 `git show 7b1e18cc:`(= live 二进制 `kaspad v1.1.1-toc.1-7b1e18cc`,非树 HEAD v2.0.0)。

### 5.1 源码断言我在【运行中那个 commit】上独立复核 `[SRC @7b1e18cc 复核]`
J2 §9 断言带检出坐标(合 `reference-silverc-capability-assertions-must-carry-checkout-coordinate` 纪律),我逐条 `git show 7b1e18cc:` 复核,全部核得住:
- ✅ `rpc/service/src/service.rs get_utxos_by_addresses_call`:`if !config.utxoindex → Err(NoUtxoIndex)`;`if async_is_consensus_in_transitional_ibd_state → Err(ConsensusInTransitionalIbdState)`。**transitional 窗口里是【报错】不是空集** —— 探针能拿到错误信号,这半有牙。
- ✅ `service.rs get_utxo_set_by_script_public_key`:`.await.unwrap_or_default()` —— store 层任何错误**静默吞成空集**。第二个"失败像合法答案"点,坐实。
- ✅ **原子性(F-B 的承重答案)**:读 `core/api/mod.rs get_utxos_by_script_public_keys = spawn_blocking(inner.read()…)`;重建 `index.rs handle_consensus_reset = utxoindex.write().resync()`。RwLock 语义 ⇒ 读者要么阻塞到 write 完成拿【重建后整体】、要么在之前拿【重建前整体】,**读不到"部分地址有、部分空"的半建态**。⇒ **我原 F-B 的 MUST-VERIFY(重建期部分读)被源码 REFUTE:对读者原子。**
- ✅ `7b1e18cc` 在树里(`git log --oneline -1 7b1e18cc` 命中),树 HEAD = v2.0.0 `90dbf074` —— J2 正确 pin 到运行中 commit 而非 HEAD(否则审的是没在跑的 v2.0.0 码)。
- ✅ is_synced(utxoindex 内部)`index.rs:115-137` = utxoindex tips == 共识 virtual_parents;注释坦白"只在共识不处理新块时可靠"——不是 RPC 的 getInfo.isSynced(那个是 sink 新鲜度),不影响 R6。

### 5.2 Bettor 的问题:R6 是否从"MUST-VERIFY"降为"已知无牙、外锚承重"?
**答:降级方向对,但"无牙"这个词不准。精确说是【牙换了位置,且原子性把外锚证成充分】。** 分三段:
- **节点自报这一半 = 确实无牙**:header/pre-transitional 阶段,空索引"已同步且自洽"(is_synced 由 tips==virtual-parents 判,全新库共识 virtual UTXO 空 ⇒ resync 得空索引 ⇒ tips 一致 ⇒ is_synced=true),对任何地址合法答 `[]`。节点分不出"空且自洽"与"真有钱查不到"。
- **transitional 窗口这一半 = 有牙**:`ConsensusInTransitionalIbdState` 报错,探针必须映射成 SYNCING:`utxoindex-pending`(J2 已写),**不是 DEAD**。
- **其余靠 A1(DAA 下界)∧A2(对照集非空)—— 而 5.1 的原子性正是让 A2 充分的那块**:若非原子,A2"对照址有"不能推"所有址都对"(我原 F-B);**现在源码证了原子 ⇒ A2 非空 ⇒ 整个索引已 live ⇒ 每个结算址都读得对**。所以 R6 = A1∧A2,**有牙且可证充分**,不是"无牙"。
- ⇒ **是的,A1/A2 成为节点-索引-就绪的唯一判别器,其选择标准必须升 MUST**(下条)。

### 5.3 A1/A2 升 MUST 的绑定要求(裁定,两稿同落)
- **A2(对照集)承重,升 MUST**,J2 F-C 的形状(≥2 独立长期持币址 / 任一非空即过 / 全空=UNKNOWN 永不 DEAD / 交叉 `ConsensusInTransitionalIbdState`+daa 下界定子态)正确,钉成 MUST:
  - 对照集**至少一个必须是最稳的锚**——`MiningRelay-tn12-new`(链上 11 亿含 10.8 亿单 UTXO,当前最不可能被掏空的)当主锚;J2 举的"7/30 未花 pruned spine"是**可被 Owner 回收**的,只能当次锚,且回收时必须同步换 env(否则 A2 假红 churn UNKNOWN)。
  - **fail-closed 硬要求**:全空 = UNKNOWN,**永不** ALIVE(防空索引放行)、**永不** DEAD(防误拉)。
- **A1(DAA 下界)是弱半,须写明其局限**:daa 在 §3-D(块体)阶段就会爬过 80,095,687,而那时 utxoindex 未必建完 ⇒ **A1 单独能过而索引仍空**。A1 只挡得住 §3-A/B 的 daa=0,**真正承重的是 A2**。文档别让下一个人以为 A1 加了 A2 之外的保障。

### 5.4 A1/A2 也【盖不住】的残余(我的最深一条,须两稿显式记为 KNOWN 残余)
`service.rs:257-275` 的 `.unwrap_or_default()` 把**单次查询的 store 错误**吞成空集。攻击:索引健康、A2 对照集非空 ⇒ 探针报 ALIVE;但某个**结算地址**查询恰遇瞬时 store 错误 ⇒ 那一次返回 `[]` ⇒ 结算读成"没钱" ⇒ 错。
- **A1/A2 挡不住它**:A2 对照查询成功 ≠ 另一地址查询不触发吞错(per-query、独立)。
- **探针也挡不住它**:探针判的是**节点级索引就绪**,不是**每次查询无 store 错误**。⇒ **一个正确的 ALIVE 判定,只证"索引建好了",不证"某个结算址这一次读得对"。**
- **归属**:这不是探针能修的,是**上游节点 RPC**(`unwrap_or_default` 吞错)。我们跑自有二进制,理论上可改节点让它 propagate 错误;短期做不到的话,**钱路关键读(结算前置)不能信单次 `getUtxosByAddresses` 返回的 `[]`**,须二源交叉(kaspa_tx_log / 二次查询 / balance-vs-utxos 一致性)。**此条超出探针 scope,路由到 relay/结算读硬化,但必须在两稿写成 KNOWN 残余,不许静默略过**(它正是 §5"失败像合法答案"那一族的最深一层)。

### 5.5 F-A 收敛状态
- **J2 侧 = 已对齐**:v0.2 §4 映射表 ALIVE 行 = `R1∧R2∧R3∧R4∧R5∧R6`,§9 明写"两稿共享 ALIVE ⇔ R1∧…∧R5∧R6"。J2 稿内部一致。
- **UI 侧 = 仍待 v0.2**:UI HEAD `6e709925` 的 §3.2b 要求 R6,但 §3.3/§0/行84/§4/V2 仍 `isSynced&&daa>0`(F-A 内部打架,4.2 已详)。**UI v0.2 必须把那五处全改成 ALIVE⇒R6**,终核时我 `git log -1` 确认读最新 commit 并把 hash 写进 verdict。

### 5.6 (5) 判词
- **J2 稿 v0.2(`0eb71684`)= 接受**(源码复核通过、统一修法落地、F-B/F-C 回答扎实)。落码前仍须:① 5.4 的 KNOWN 残余显式写进稿;② A1 局限(5.3)写进 §6 出处栏;③ F-C 主锚/次锚区分(5.3)写进对照集定义。这三条是补注不是阻塞,J2 可直接改。
- **UI v0.2 未到 = 门仍关**:两稿"同一把尺"要成立,UI 必须①ALIVE 五处补 R6(F-A)②diskIo 降为只调告警(已在 J2 v0.2 落,UI 要跟)。UI v0.2 到 ⇒ 我做最终同尺核 + KNOWN 残余是否两稿都写 ⇒ 才放两稿落码。

---

## (6) UI 稿 v0.2(`1a02320f`)同尺预核 + MF-2 阈值意见(Bettor 问)

### 6.1 同尺预核(v0.2 §0.5/MF-1/F-A vs J2 稿)
- **MF-1 ✅ 同尺**:UI「共识计数器 60min 硬停滞层 + diskWrite 不单独判 + V8」= J2 §4「STALLED 只由共识计数器 60min、diskIo 只调告警」。一致。
- **F-A ✅ 同尺**:UI 五处改成 `ALIVE(0) ⟺ network==testnet-12 ∧ isSynced ∧ R6(A1∧A2)` = J2 `ALIVE ⟺ R1∧…∧R6`。同一 ALIVE 边界(both 要 R6)。Bettor grep "isSynced && daa" ALIVE 语境零命中,内部打架已消。
- **§0.5(MF-2)✅ 无 J2 对应是对的**:MF-2 是 watchdog 行为(UI 域),J2 是判据文档,不该有对应。分工正确。
- **F-B/F-C ⏳ 未同尺(Bettor 已令 v0.3 对齐)**:v0.2 仍写"不可花费永久 UTXO 待选址"+"A2 空交叉 isUtxoIndexed",而 J2 源码答案证:①无此 UTXO ②isUtxoIndexed=配置开关不能交叉。v0.3 收这两处后我终核。
- 🔴 **两稿都还缺我 §5.4 的 KNOWN 残余**(`unwrap_or_default` per-query 静默空集):J2 §9 F-B 提了"helper unwrap_or_default 静默空集"是**存在**,但没把"探针 ALIVE 不证单次查询无 store 错误 ⇒ 钱路关键读须二源交叉"写成显式残余。**要求两稿终版都显式记这条**,别让它埋在 F-B 表格一行里。

### 6.2 MF-2 阈值意见(kaspad 8GB / llama 35GB 拒拉线)`[MEASURED 复核]`
**结论:两个数本身可接受,但有一个 scope 错位是硬伤 —— MF-2 装在了错的 spawn 点。**
- **kaspad `MIN_FREE_COMMIT_GB=8` —— 接受,但理由要改**:
  - 稿写"kaspad 需 ~2GB"**低估了 IBD**:8/23 坏库 IBD 峰 25GB、今日新库 IBD 4.1GB(都不是 2GB;2GB 是同步完稳态)。8 这个数**够**(新库 IBD 只 4GB,留 4GB 裕量),但把它说成"2GB 需求 + 6 裕量"是错的锚 —— 应写"kaspad IBD 实测 4–25GB(库况相关),8GB 是'机器已near-cliff 就别再添 kaspad'的地板"。
  - **8/23 它会正确触发**:那晚 llama 占 30–65GB,空闲 commit 长时间 <8GB ⇒ 闸会拒拉 kaspad = 正是想要的(停掉放大器)。✅
  - **但它挡不住 launch 后 IBD 增长**:launch 时 8GB 空闲、kaspad 涨到 25GB(坏库)就顶穿。⇒ 内存闸**每 tick 都要重查**(不只 launch 时),涨过线也要停;这点稿里要写明"每 Start-Process 前 + 运行中周期性"。
- **llama 35GB —— 数对(30.2+~5),但装错地方(硬伤)**:
  - 🔴 **kaspad-watchdog 根本不 spawn llama** —— llama 由 `kanet-start.sh`/`headless`/(潜在)`llm-watchdog.mjs spawnLlama` 拉。**而 8/23 的根因正是 llama 双开(30→65GB),它 spawn 在 kaspad-watchdog 之外。** ⇒ MF-2 只把内存闸装进 kaspad-watchdog = **给次要放大器(kaspad 25GB)上闸,却漏了主凶(llama 30GB)的 spawn 点**。
  - **裁定**:内存感知拒拉必须装在**每一个重进程 spawn 点** —— ①kaspad-watchdog(kaspad,8GB 线)②headless llama-spawn(35GB 线)③llm-watchdog.mjs spawnLlama(35GB 线 + 补端口守卫,它现在 health 超时就无脑再 spawn 一个 30GB,是 (1) §1.4 双 llama 最可疑来源)。**只在 kaspad-watchdog 装 = 没治到 8/23 的病。** 这条是 MF-2 从"防 kaspad 放大器"升到"防 8/23 主因"的必要扩展。
- **crash-loop 刹车的告警路径依赖**`[攻击]`:CRASH-LOOP → "停 + 告警 + 交操作员,直到人工清零"。方向对(宁可节点多躺,不砸整机),但:①8/23 那晚的告警会走 dev 频道 = 正因 console cycling 而**断的那条**;告警路径不能依赖正在坏的东西(console/relay)。②"直到人工清零"+ 无人值守(8/23 通宵、频道静默 4 天)= 节点无限期躺。fail-safe 方向对,但**必须配一条不依赖 console 的到达性告警**(本地文件红旗 + 独立通道),否则"告警"= 写进没人读的 log,等于 8/23 重演。

### 6.3 (6) 状态
- UI v0.2 §0.5/MF-1/F-A 与 J2 同尺 ✅;F-B/F-C 待 v0.3。
- MF-2 两阈值接受,但**三扩展是落码前必补**:①内存闸装全部 spawn 点(不只 kaspad-watchdog,尤其 llama 三处)②内存闸每 tick 重查非只 launch 时 ③crash-loop 告警走不依赖 console 的到达性通道。①是硬伤(不补则没治 8/23 主因)。
- 终 verdict 等 UI v0.3(F-B/F-C 对齐 + 两稿都写 §5.4 残余),我 `git log -1` 确认最新 hash 后出。

---

## (7) 终 verdict — 两稿同尺·探针设计 GREEN·两条落码前补注 + 一条硬要求

**读的 commit(hash 进 verdict)**:UI 探针稿 = **`59bac849`**(v0.3)· J2 判据稿 = **`0eb71684`**(v0.2)· rusty-kaspa 源码断言 = **`7b1e18cc`**(= live 二进制 `kaspad v1.1.1-toc.1`,非树 HEAD v2.0.0)。三者我都 `git log -1`/`git show` 核过是最新/正确坐标。

### 7.1 同尺核:两稿现在是同一把尺 ✅
| 维度 | UI 59bac849 | J2 0eb71684 | 同尺? |
|---|---|---|---|
| ALIVE 边界(F-A) | `ALIVE(0) ⟺ network==testnet-12 ∧ isSynced ∧ R6(A1∧A2)`,§3.3 表格引用同一句、L4 行同改 | §4 映射 `ALIVE ⟺ R1∧…∧R6` | ✅ 一致 |
| STALLED(MF-1) | 共识计数器 60min 硬判 + diskWrite 不单独判 + V8 | §4 STALLED 只由共识计数器 60min、diskIo 只调告警 | ✅ 一致 |
| R6 性质(F-B) | `[已核·CONFIRMED]` 承重全在外锚 A1∧A2,删 isUtxoIndexed | §9 同结论(原子/闸只盖导入段/helper 吞错) | ✅ 一致 |
| 对照集(F-C) | ≥2 独立长期持币址,任一非空过,全空=UNKNOWN 永不 DEAD,负例三态 | §9 F-C 同 | ✅ 一致 |
| MF-2(内存/crash-loop 闸) | §0.5 REQUIRED | (判据稿无此项 = 对,watchdog 行为归 UI 域) | ✅ 分工正确 |

⇒ **F-A 内部打架已消、两稿 ALIVE 边界统一、diskIo 处理统一、R6/对照集定义冻结。探针设计本身 = GREEN to implement。**

### 7.2 落码前必补(不是 re-review 阻塞,是完整性条件,补进稿/ledger 即可)
- **补注①(§5.4 KNOWN 残余,两稿都还没显式写成残余)**:`service.rs:257-275 unwrap_or_default` 把**单次查询**的 store 错误吞成空集。v0.3 §3.2b 把它当"节点给不了 R6 布尔"的理由提了,但**没写成显式残余**。要求两稿(或 ledger)显式记:**一个正确的 ALIVE 判定只证"索引建成",不证"某结算址这一次读得对";A1/A2 与探针都挡不住 per-query 吞错 ⇒ 钱路关键读(结算前置)不能信单次 `getUtxosByAddresses` 返回的 `[]`,须二源交叉(kaspa_tx_log / 二次查询 / balance-vs-utxos 一致)。** 此条超出探针 scope,归 relay/结算读硬化,但必须留痕。

### 7.3 硬要求(有牙,不补则 8/23 主因没治)
- **MF-2 内存闸的 spawn-point scope(我 §6.2 硬伤,v0.3 未动,仍是 v0.2 §0.5)**:内存感知拒拉目前**只装在 kaspad-watchdog**。但 (1) 已证 8/23 主因 = **llama 双开(30→65GB),它 spawn 在 kaspad-watchdog 之外**。⇒ **只给 kaspad(次要放大器)上闸、漏了 llama(主凶)= 没治到 8/23 主因。** 内存闸(35GB 线)必须同时装在 llama 的真实 spawn 点:**`kanet-start-headless.sh` llama-spawn + `scripts/llm-watchdog.mjs spawnLlama`(后者还须补端口守卫——它现在 health 超时就无脑再 spawn 一个 30GB,是双 llama 最可疑源)**。这是一个**独立于本两稿**的改动(不同文件/域),但由 (1) 根因驱动,**必须作为独立卡跟踪,不能因为它不在探针稿里就漏掉**。
- **另两条 MF-2 完善(§6.2)**:内存闸每 tick 重查(非只 launch 时,防 launch 后 IBD 增长顶穿);crash-loop 告警走**不依赖 console** 的到达性通道(8/23 告警会走正断的 dev 频道 = 写进没人读的 log)。

### 7.3-bis 两轮口径(Bettor 2026-08-26 澄清)
两稿至今**零落码**(Owner 三决未回,今天全程不改产品码/脚本)。⇒ 复核分两轮:
- **本轮(稿层)**:核 UI v0.4/J2 v0.3 的**设计文本**有没有把 §7.2/§7.3 三条写成明确落点 —— MF-2 是否显式列 `kanet-start-headless.sh` llama 段 + `scripts/llm-watchdog.mjs spawnLlama` 两处为闸(非笼统"所有 spawn 点")、每 tick 重查/告警通道写没写、残余是否成显式 KNOWN + 二源交叉。**不 git show 代码(无代码)。**
- **实施轮(码层,Owner 批后)**:KANet-UI 落码那轮,逐处 `git show` 核 headless/llm-watchdog 两闸真加了、退码3收窄 diff GREEN 才推。

### 7.4 判词
- **探针设计(UI 59bac849 + J2 0eb71684)= 通过终核, GREEN to implement**。落码时须带补注①(残余留痕)+ §7.3 三条 MF-2 完善;退码3收窄仍须落码后 NWT diff GREEN 才推(存量语义变更纪律)。
- **MF-2 llama-spawn 内存闸 = 独立硬要求卡**,归 (1) 根因治理,与探针稿并行推进,别漏。
- **运维 TODO**:第二个对照址(7/30 已链核未花的 pruned spine 具体值)填 `KASPAD_PROBE_CONTROL_ADDRS` —— J2 从候选里挑一个给 UI,选址时避开会被 Owner 回收的(回收即 A2 假红)。

---

## (8) 终核确认 — 三条件稿层全落定 · 探针设计 GREEN(doc-layer)

**最终 commit(git log -1 确认,进 verdict)**:UI 探针稿 = **`358950d6`** · J2 判据稿 = **`1b967da5`** · rusty-kaspa 源码坐标 = **`7b1e18cc`**(live 二进制)。
> 出处更正轮:UI `358950d6`(=`6c0a501d` + §10 出处行逐字三处修正)/ J2 `1b967da5`(=`0a12e512` + §10 出处行)——**内容层未变,稿层核实结论全部继承**。
> 🔴 **出处更正本身是红队相关,记一条**:第二对照址(cn5xn spine)的"7/30 未花"—— J2 自查发现**不在 ledger**(ledger (112) :4930/:4931 记的是金额对合约字节,非"未花"),**唯一出处 = `scratch/settle-truth/covenant-funded.json:2315`(scratch JSON,非链核、非 ledger)**。⇒ 这**强化**了我原有的 caveat(§8 表末):该址"未花"是 7/30 的 scratch 断言,**UTXO 集可用后必须 run.cjs step4 实链重核两址仍非空**,别把 scratch JSON 的"未花"当成已上链证据。F-C"对照集全空=UNKNOWN 告警换址"是这条的运行时兜底。同族纪律:`feedback-ask-the-authoritative-side-not-the-side-that-has-a-log`(有 JSON ≠ 有链证)。
> 注:`6c0a501d` = `22bac937`(v0.4)+ 只填第二对照址(`git diff 22bac937 6c0a501d` = 3 insert/2 delete,纯填 `KASPAD_PROBE_CONTROL_ADDRS` 第2项 + 关 §10 两 TODO),三条件文本未动 ⇒ 我在 22bac937 的稿层核实全部继承有效。第二对照址 = `kaspatest:pzrhg8y8…swe79q`(盘 cn5xn spine,100 KAS,7/30 全队链核未花);⚠ J2 已标是 7/30 链态,UTXO 集可用后须 run.cjs step4 重核两址仍非空 —— F-C"对照集全空=UNKNOWN 告警换址"已覆盖此。

三条件我 `git show HEAD` 逐处核**稿层文本**(非代码——两稿零落码,代码 diff 留实施轮,见 §7.3-bis):

| 条件 | 落点 | 核实 |
|---|---|---|
| **MF-2 spawn-point scope(§7.3 硬伤)** | UI §0.5 | ✅ 显式列四个承重 spawn 点:①`kaspad-watchdog.ps1` ②`kanet-start.sh:232` ③`kanet-start-headless.sh:106` llama 段 ④`llm-watchdog.mjs:45 spawnLlama`;①④本稿域、②③钉"必须装"归 start-脚本报备批(分工正确,没笼统一句"所有 spawn 点"糊过去) |
| **MF-2 每 tick 重查** | UI §0.5 | ✅ "每 tick 重查非只 launch;'kaspad 需~2GB'锚作废,按目标进程当前/预期峰值 commit + margin 定" |
| **crash-loop 到达性告警** | UI §0.5 | ✅ 本地红旗 `D:\kaspa-tn12-data\kaspad-CRASH-LOOP.flag`(探针每 tick 先读,红旗在即拒拉,人工删=清零)+ 非 console 通道(owner-bot TG / Windows 事件日志 Error) |
| **KNOWN 残余(§7.2 补注①)** | UI §3.2c + J2 §10 + 转账 runbook P1c | ✅ 两稿都写成显式残余:ALIVE 只证"索引建好"不证"某址这次读得对";钱路关键读二源交叉(二次查询 + kaspa_tx_log/第二 vantage);单次空 = `SINGLE_SOURCE` ≠ absent;J2 已落 `scratch/_j2_postibd_chaincheck_20260826/_common.cjs utxos()`(double-empty/retry-recovered/SINGLE_SOURCE 状态) |
| **第二对照址** | J2 §10 / UI §10 | ✅ `kaspatest:pzrhg8y8…swe79q`(pruned 盘 cn5xn spine,100 KAS 原始 lock,7/30 链核未花,spine 独占、不在任何 refund/claim 候选,出处 `covenant-funded.json:2315`);矿址仍主锚,第二址独立 vantage 非承重 —— 稳 |

**一条红队复核(J2 §10 残余纪律点 4)**:"非空结果不需二源(unwrap_or_default 只把错误变空、不凭空造 UTXO)" —— **成立**。空集方向会说谎(错误→[]),非空方向不会(store 真返回了条目才非空)。这个不对称是对的,二源只需覆盖空集方向。

### 终 verdict
- **探针设计(UI `22bac937` + J2 `0a12e512`,源码锚 `7b1e18cc`)= 通过终核,doc-layer GREEN。** 两稿同尺(ALIVE⇒R6 / MF-1 共识计数器 / R6 外锚 A1∧A2 / 对照集≥2址),F-A/F-B/F-C 冻结,三条件稿层全落定,KNOWN 残余两稿显式留痕。
- **GREEN 的边界(口径,Bettor 已抄 ledger)**:GREEN = 设计闭合 + 三条件写进稿,**不是** ship。落码是 Owner 三决回来后的独立一轮:那轮 NWT 按 §7.3-bis 实施轮逐处 `git show` 核(headless/llm-watchdog 两内存闸真加、退码3收窄 diff GREEN 才推),关3 浏览器/端到端实操未做(纯设计稿无运行物)。口径跟实 enforcement 成熟度走,别漂成"探针已上线"。
- **独立跟踪卡(不阻塞本两稿,但别漏)**:②③ start-脚本 llama 内存闸 = 走报备→NWT 审→Owner 批那批;它治的是 8/23 主因(llama 双开),优先级不低于探针本身。

---

**最终 hash(定稿)**: UI 探针稿 `358950d6` / J2 节点健康稿 `1b967da5` / rusty-kaspa live 二进制 `7b1e18cc`。三稿同尺、doc-layer GREEN;落码留 Owner 三决后实施轮(§7.3-bis)。
