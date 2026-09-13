# NWT 红队复核 · 主网 console/relay 起服务方案 v0.3（MUST 闭合核查 + 独立启动骨架缺口）

> **Status**: FINAL v0.1（2026-09-13 · NWT · docs only）
> 审对象：`docs/2026-09-13-kanetui-mainnet-console-relay-startup-plan-v0.1.md` 提交 `f4173b8e`（v0.3，diff 见 `59d719bf..f4173b8e`）。合并审 v0.1+v0.2+v0.3。

## 结论：**MUST 已闭合(方案层面GREEN)**，**独立启动骨架本身找到两个必须补的 env 注入遗漏项(其中一个是真实安全风险)+ 三个操作性缺口**——都在"骨架"这个层级,不是方案方向问题,落地前必须补,不阻塞 GO-A/GO-B

## 一、上一轮 MUST 是否闭合——**是**

对比 `59d719bf→f4173b8e` 的 diff：改法与我上一轮给的两个可行选项里的"独立小启动脚本+手动 env"完全一致——新文件 `kanet.mainnet.env`(不碰 `kanet.env`)、不经过 `kanet-start.sh`、PowerShell 骨架逐行把新文件的 key=value 注入**这一个进程自己的环境**再起 `node`。**核对了它引用我上一轮的证据(`kanet-start.sh:19` `ENV_FILE` 硬编码路径)——引用准确,理由复述也准确,不是含糊地说"改了"就算**。§3.1 步骤 4 与 §4 的措辞同步改了("独立 kanet.env 段"这句已删,改成"独立 env 文件"),不再有 §1.3 与 §4 打架的问题。**MUST 闭合,PASS。**

## 二、独立启动骨架的缺口——Bettor 点名四项,逐项核

### ① env 注入遗漏项——**找到两处,一处是真实安全风险,必须在骨架定稿前补**

骨架现在只提"三行主网值 + `DB_PATH` + `PORT`",但 `console` 进程启动时**至少还有两个变量是硬性依赖,遗漏会导致完全不同性质的两种后果**：

**(1) `CONSOLE_ENCRYPTION_KEY`——遗漏的后果是好的(fail-loud),但"该用哪个值"这个问题本身是真实风险**：读了 `index.js:107-111`,缺失或不是 64 位 hex 直接 `console.error` + `process.exit(1)`——**遗漏本身不会造成静默的安全洞**,进程直接拒绝启动,这点是好消息。**但骨架文档完全没提这个变量**,如果照抄"三行+DB_PATH+PORT"这张清单去配 `kanet.mainnet.env`,进程会直接起不来——这只是体验问题。**真正要害的是**：一旦有人发现"起不来是因为缺这个 key",下一个自然反应是"从 `kanet.env` 里复制现成的那把过来"——**这正是不该做的事**：`CONSOLE_ENCRYPTION_KEY` 是这台机器上加密全部敏感数据(custodial wallet mnemonic 等)的密钥,跨网络复用同一把,等于让主网这套全新、本该独立的加密域,共享了 TN12 那套的密钥——这跟 §2.3 自己写的"不复用 TN12 那把私钥跨网络,复用是需要独立评估的安全问题"是同一条纪律,只是这次对象是加密密钥不是签名私钥,道理一样。**裁决 MUST**：骨架文档必须显式列出 `CONSOLE_ENCRYPTION_KEY`,并且写清楚"用 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` **新生成一把**,不要从 `kanet.env` 复制"——`index.js` 自己的错误提示里就带了这条生成命令,直接抄进 `kanet.mainnet.env` 的准备步骤即可,不需要额外设计。

**(2) `KANET_ROOT`——遗漏的后果是真正的静默错误,这条更要命**：`grep` 了全 `kasia-console/src` 下 `process.env.KANET_ROOT` 的用法,**十几个文件各自写了一个"缺失时的默认值",而且互相不一致**：`index.js:548` 默认 `'D:/Anthropic'`,`chat.js:522` 默认 `'D:/kanet-tn12'`,`bettor-reactor.js:30` 默认 `'C:/kanet'`——**这三个路径都不是"某个安全的空操作",是三个不同的、大概率在这台机器上根本不存在或指向别的东西的目录**。骨架现在完全没提 `KANET_ROOT`,如果照抄现有清单起服务,凡是依赖 `KANET_ROOT` 的子系统(scout 子进程 spawn、skills、adapter-launcher、agent-health、bettor-reactor 等)会各自静默用上一个**不同、且大概率错误**的路径,故障模式五花八门(某些功能报路径不存在,某些可能因为这台机器巧合存在同名目录而读写到完全不相关的地方)——**这种"多处不一致默认值"本身就是这个项目一直在打的那种坑(参考本项目自己的教训:默认值漂移比显式缺失更危险,因为它不报错,报的是别的莫名其妙的错)**。**裁决 MUST**：骨架必须显式在 `kanet.mainnet.env` 里写 `KANET_ROOT=D:/kanet-tn12`(真实项目根,不是任何一个文件里写的默认值),不能靠"沿用代码默认值"这句话带过——这条跟 `CONSOLE_ENCRYPTION_KEY` 不一样,**它是真的会被沿用默认值这句话坑到的那一类**。

### ② 工作目录——核实无虞,但骨架应该显式写出来

ESM `import` 语句按模块自身 URL 解析,不受 `process.cwd()` 影响,这条我核实过不是隐患。**但 `DB_PATH` 走 `resolve(env.DB_PATH)`(`client.js`)——如果 `kanet.mainnet.env` 里 `DB_PATH` 写成相对路径,它会相对于"PowerShell 脚本被执行时所在的目录"解析,不是相对项目根**。这个项目自己的既有纪律(CLAUDE.md"临时脚本铁律")就是"绝对路径"——`kanet.mainnet.env` 里的 `DB_PATH` 直接写绝对路径(如 `D:/kanet-tn12/kasia-console/data/console-mainnet.db`)就能完全绕开这个问题,不需要额外在骨架里加 `cd`。**建议**：骨架示例里把 `DB_PATH` 换成绝对路径示范,顺手把这条隐患堵死,不需要专门讨论"工作目录"这个概念。

### ③ 日志目录——骨架目前完全没提,遗漏

`kanet-start.sh` 自己的注释提过一次真实事故("脚本自己接管顶层输出"——历史上有过 stdout 被手动重定向到各种一次性文件名、一天攒 43 个大文件把 C 盘写满的事故)。**现在的 PowerShell 骨架只有 `node kasia-console/src/index.js` 这一行,没有任何输出重定向**——照字面执行,日志只会打在这个 PowerShell 窗口里,窗口一关全部丢失,排查问题时什么都没有。**裁决**：骨架补一行显式重定向,如 `node kasia-console/src/index.js *> logs\mainnet-console.log 2>&1`(或按 Windows 惯例拆 stdout/stderr 两个文件),日志目录建议独立于 TN12 现有 `logs/`(如 `logs/mainnet/`),避免混在一起不好找。

### ④ PID 文件与 supervisor 关系——骨架目前无 PID 追踪,建议补一行,不是硬性 MUST

`kanet-start.sh` 有 `PID_DIR` 机制,配套 `kanet-stop.sh` 靠它找进程停止。新骨架完全独立,没有 PID 文件——意味着以后想干净地停掉这个主网实例,只能手动在任务管理器/`Get-Process` 里找。**这条不是安全问题,是运维体验问题**,建议起动那一行顺手把 PID 写个文件(PowerShell `$p = Start-Process ... -PassThru; $p.Id | Out-File pid.mainnet-console.txt`),但不算 MUST,不阻塞。**与既有 supervisor/watchdog 的关系**：执行页与本方案都已经明确"不接入 `kaspad-watchdog.ps1`/`kanet-boot-sequence.ps1`"——这是刻意排除,不是遗漏;我没有找到任何其它跨进程共享的文件系统资源(除了 kaspad 节点本身,数据库/端口/日志目录三个维度都已经独立),**这条核实为无冲突,PASS**。

## 三、给 Bettor 的处置建议

- **MUST 闭合,方案方向 GREEN**——§1.3 与 §4 不再矛盾,可以推进到 GO-B/GO-C。
- **落地前(写实际启动脚本那一刻)必须补两处 env**：`CONSOLE_ENCRYPTION_KEY`(新生成,不复用 TN12 那把)、`KANET_ROOT`(显式写真实项目根,不能靠代码默认值,默认值本身在多个文件里互相不一致且可能是错的)。
- **建议补两处操作细节**：`DB_PATH` 用绝对路径(顺手堵掉相对路径隐患,不需要另外处理"工作目录"概念)、显式重定向 stdout/stderr 到独立日志文件(否则关窗口就丢日志,重演过既有事故的同一种病)。
- PID 文件是体验性建议,不阻塞;与既有 supervisor 的关系核实无冲突。
- 这四项都是"写实际启动脚本那一步"要处理的细节,不影响 GO-B/GO-C 现在就可以走——**只要求在真正写那份 PowerShell/启动脚本时,把这份清单核对一遍再执行,不要求现在重新过一轮文档审**。
