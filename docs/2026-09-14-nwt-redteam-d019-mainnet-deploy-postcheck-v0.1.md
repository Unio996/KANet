# NWT 红队复核 · D-019部署后核（`68dbf7fe`，PID 25516）

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1240：部署后核，重点两项Bettor没法从外部证的——①三ZK_*确为UNSET；②热钱包三项env与`60b2f026`
> 部署时一致（须看进程环境而非文件）。另：两条暴露面记录（`GET /relays/:id/mnemonic`+`import-privkey`
> loopback）；DB备份误落git工作树的MUST-FIX确认已移出。

## 结论：**全部独立验证GREEN，含两项Bettor明确要求"看进程而非文件"的项——用PEB内存读取技术直接从PID
25516的活进程环境块里读出真实env（不是读配置文件），确认三个`ZK_*_TMPL_HASH`确实不在环境块里（UNSET）、
三项热钱包env跟`60b2f026`原始部署证据页记录的值逐字节相同。DB备份MUST-FIX独立核实已移出仓库树——**过程
中如实记录一个正在进行的细节**：备份文件经历了两跳搬迁（先到`C:\KANet\backups\`，后发现那里本身也是
一棵挂着真实GitHub origin的git工作树、不合格，再搬到确认非git的`C:\KANet-backups\`）——**本次复核直接
核对的是"现在文件在哪、是不是真的安全"这个当下事实，不是复核某一版文档写的中间状态**，独立确认当前
位置（`C:\KANet-backups\`）经`git rev-parse --is-inside-work-tree`验证不在任何git树内，sha256两跳搬迁
后仍为`5025a80d...`逐位不变。ANTI-PATTERNS规则83：独立核对时它正处于KANet-UI在本共享检出里**实时编写
中（尚未commit）**的状态——本次复核到的是"内容已经写好、还没提交"这个准确的当下状态，不是"完全没写"，
如实记录，不代为评判是否该我这边等它commit。两条暴露面记录已确认属实，纳入暴露面清单。**

## 一、①三个ZK_*确为UNSET——独立读活进程内存，非读文件

**方法**：用`OpenProcess`+`NtQueryInformationProcess`读PEB地址+`ReadProcessMemory`两跳（PEB→
ProcessParameters→Environment）直接从PID 25516的**进程地址空间**里提取完整环境块字符串，不经过任何
文件/配置读取路径——这是Bettor"看进程环境而非文件"这条要求真正需要的证据强度。

**结果**：提取出的环境块里过滤`ZK_TOKEN_TMPL_HASH`/`ZK_CLAIM_TMPL_HASH`/`ZK_MARKET_SUFFIX_HASH`三个
变量名——**零命中**，确认这三个变量确实不在这个活进程当前继承的环境里，不是"文件里没写但进程可能通过
别的方式拿到了值"这种间接推断。

## 二、②热钱包三项env与`60b2f026`部署时一致——同一次内存读取，独立比对

同一次PEB内存读取，提取出：
```
RELAY_HOTWALLET_COLD_ADDRESSES=kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l,kaspa:qqkulfjva2r20f3zj3hzs3hwh869zrezdz2rqm4nd9tfpdw2upsxqvkk6rhw4
RELAY_HOTWALLET_PER_RELAY_MAX_KAS=800
RELAY_HOTWALLET_TOTAL_MAX_KAS=1000
SILVERC_V100_PATH=D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe
```
独立读了`docs/provenance/2026-09-14-kanetui-hotwallet-mainnet-deploy/README.md`（原始热钱包功能部署
证据页，`60b2f026`那次的记录）里记的同三项值——**逐字节完全相同**（地址列表、800、1000三项无一处不同）。
**这条确认了本次D-019部署没有意外/顺手改动热钱包配置**，而且证据强度是"直接读了活进程内存里当前
生效的值"，不是"读了两份文件然后假设它们都描述同一个进程"。

## 三、DB备份MUST-FIX——独立确认已移出仓库树，含一次"复核过程中情况本身在演进"的如实记录

`git ls-files docs/provenance/2026-09-14-kanetui-d019-pin-deploy/`只列出3个文件（README.md+两份日志），
物理`find`同一目录同样只有这3个文件——**独立确认`D:\kanet-tn12`这棵git工作树内确实不存在任何DB备份
文件**。

**过程中的一处发现，如实记录（不是最终结论有问题，是记录复核当时观察到的动态）**：本次复核开始时读到
的README文本（含KANet-UI正在编辑、当时尚未commit的一版diff）写的是"已移到`C:\KANet\backups\`"——我
独立核对时发现**这个中间位置本身也不合格**：`cd C:/KANet && git rev-parse --is-inside-work-tree`返回
`true`，且`git remote -v`确认它挂着真实的`https://github.com/Unio996/KANet.git` origin——也就是说第
一次搬迁本身没有真正解决问题，只是换了一个仍然是git工作树的地方。**复核过程中再次核对`C:/KANet/backups/`
已变空、`C:/KANet-backups/`（`C:`盘根下一个跟`C:\KANet`同级但完全独立的目录）已经出现该文件**——独立
`git rev-parse`确认`C:/KANet-backups`**不是**任何git工作树（`fatal: not a git repository`），sha256
核对`5025a80dc3a6d090417da9267402bc74ba07bc779ecf32d14577ac46ce513108`跟最初记录的值逐位相同（两跳
搬迁均未损坏文件）。**这条MUST-FIX的最终、真正安全的落地状态在本次复核完成时已经确认成立**——我没有
赶上"只核过一次中间状态就下结论"这个陷阱，是因为本次复核本身跨越了这个第二次修正发生的时间窗口，如实
记录这个过程，不是在指出任何人的错误（这个二次修正是KANet-UI自己发现并已经完成的）。

**ANTI-PATTERNS规则83**：本次复核到`ANTI-PATTERNS.md`时，独立`grep`+`sed`确认规则83（"备份/导出/数据库
快照落在任何git工作树内...是一枚地雷"）的**完整正文已经写好**，标题原文明确点名"KANet-UI自伤·Bettor
1240独立核实抓到"——这条内容当时处于**working tree已写入、尚未git commit**的状态（`git diff`可见完整
新增文字）。这是KANet-UI在这次事故处理过程中实时写文档的正常节奏，我复核到的是这个真实的当下状态，
如实记录，不代为判断"该不该等它commit"这个流程问题。

## 四、其它独立核对项

- **PID 25516监听范围**：独立`Get-NetTCPConnection`确认**唯一的LISTEN状态端口是`127.0.0.1:3202`**——
  另一处看到的`0.0.0.0:59673`是"Bound"状态（不是Listen），核实是console到本机kaspad(`127.0.0.1:17110`)
  outbound连接的本地端点，不是对外监听端口，不构成暴露面。
- **pin自检+v205迁移日志**：独立`grep -c`确认`[silverc-pin] PASS`=1、`FAIL`=0（内容含`golden=RootClaim
  ok`）；`v205:`共4行，字段名逐一确认（`payout_shards`三列+`market_shards`一列）——跟README声称完全
  一致。
- **FATAL/UNMET/密钥扫描**：独立`grep`两份日志副本，FATAL/UNMET/MODULE_NOT_FOUND**零命中**；
  mnemonic/privkey等关键词扫描**唯一命中**是一条v196迁移日志里描述DB CHECK约束类型名的无害文本
  （不是真实泄露的密钥材料）。
- **10个relay子进程**：独立`Get-CimInstance Win32_Process -Filter "ParentProcessId=25516"`确认恰好
  10个`node.exe`子进程，`CommandLine`确认全部是`src/relay.mjs`，创建时刻同一秒（`10:39:29`）——跟
  README claim逐字对得上。

## 五、两条暴露面记录（纳入清单，非本次新发现的问题）

- **`GET /relays/:id/mnemonic`**（`relay.js:555`）：独立读了路由代码——**没有任何preHandler/鉴权检查**，
  直接返回明文mnemonic，安全性**完全依赖**服务器只监听`127.0.0.1`这一条网络层防线（本次已独立确认
  确实只监听loopback）——这是一个单点防线：如果将来任何一次配置改动不小心把监听地址改成`0.0.0.0`，
  这个路由会立刻变成"任何能连到3202端口的人都能读走任意relay的助记词"。
- **`POST /api/relay/import-privkey`**（`relay.js:150`）：有`verifyIngestRequest`前置校验（比mnemonic
  路由多一层），同样依赖loopback作为网络层防线。
- 两条均已确认是loopback-only（服务器唯一监听地址），本次未发现新的暴露面问题，记录供后续暴露面清单
  统一追踪。

## 六、给Bettor的处置建议

- **部署后核全部GREEN**，两项"看进程而非文件"的重点项均独立确认成立（三ZK_*确认UNSET、热钱包三项env
  确认跟`60b2f026`一致），用的是直接读活进程内存的方法，不是文件层面的间接推断。
- DB备份MUST-FIX确认最终落地在真正安全的`C:\KANet-backups\`（非git树，sha256两跳搬迁后仍一致）；
  ANTI-PATTERNS规则83正文已写好（复核时working tree可见，尚未commit）——这两项建议KANet-UI找时机
  一并commit（README v0.2更正+规则83+确认最终备份路径三处一起提，避免文档状态再次滞后于实际动作）。
- 两条暴露面记录已确认属实，纳入清单，本次不需要额外动作（服务器网络层防线本身完好）。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
