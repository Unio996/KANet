# NWT 红队复核 · T-SYSTEM-RUN-RCE热修（`c0ed69fa`/`8d8670ab`）

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1308：①Windows realpath对junction/目录符号链接的行为（下载目录本身若被换成链接）；
> ②download与run共用候选集——下载步骤能否被诱导写入任意文件名再由run执行；③3处调用方改动无行为回归
> （onboard-broker生产流程）。

## 结论：**两笔均GREEND。①独立做了两组真实Windows目录junction实验，确认合法场景不误拒、且发现并
记录一条低优先级残留限制（junction被"事后retarget"这种需要文件系统写权限的场景下containment check
会跟着新target走）——不是本次热修引入的新洞，是任何基于realpath的containment check固有的"检查时刻
生效"性质，已有的admin-secret-tier闸+这个场景本身需要的文件系统写权限，让实际可利用性很低，建议记录
不阻断。②独立读代码确认download的filename/URL均来自固定映射表，零调用方影响，彻底排除。③独立追查
确认3处调用方+其上游全部一致，onboard-broker.mjs的两次调用共享同一个闭包变量，无脱节风险。**

## 一、①Windows junction行为——两组真实实验，不是纯读代码推断

独立另建worktree（真npm install，0跨树确认），写了两组真实Windows目录junction实验（`cmd /c mklink
/J`，不需要管理员权限，跟Bettor问的"下载目录本身若被换成链接"场景完全对应）：

- **场景A（合法junction）**：把整个`DOWNLOAD_DIR`本身做成一个junction指向别的目录（模拟运维把下载
  目录搬到另一块盘、原地留一个junction），目标目录里真的放了合法命名的文件。**结果：`runInstaller`
  正确通过校验，不误拒**——`realpathSync(expectedPath)`与`realpathSync(DOWNLOAD_DIR)`两边都透过
  同一个junction解析到同一个真实目标目录，`dirname`比对成立，符合预期，不是意外碰撞。
- **场景B（junction事后retarget，模拟攻击）**：先跑一次"合法"场景，然后**删除并重建**同名junction，
  改指向一个内容不同（模拟恶意）的目录，该目录里放了同名文件。**结果：`runInstaller`仍然放行，
  spawn了retarget之后那个目录里的文件**——这是一条真实存在、但性质需要如实厘清的残留限制：

  **不是本次热修新引入的洞**：containment check验证的是"这个文件当前是不是落在DOWNLOAD_DIR现在
  指向的地方"，不是"这是不是确实是当初被下载下来的那份内容"（后者需要类似"下载时钉一份内容哈希，
  run时核对哈希"这种额外的完整性绑定，本次热修范围没有做，原有代码也从未有过这个能力）。**这条场景
  要求攻击者已经具备对`KANET_ROOT/downloads`这个具体目录路径做删除+重建junction的文件系统写权限**
  ——跟原始漏洞"任何本机进程仅凭一次HTTP POST、零文件系统权限即可RCE"相比，是完全不同量级的前提
  条件（已经接近"攻击者已经拿到这台机器的文件系统写权限"，那种情况下能做的坏事远不止这一条）。加上
  本次热修已经给两条`/api/system`路由接了`checkAdminSecretTier`（主网默认关闭=503），要走到这条
  残留场景需要**同时**满足"tier被启用"+"攻击者有downloads目录的文件系统写权限"两个条件，实际可
  利用性很低。

  **建议**：记录为已知限制（供KANet-UI日后如果想加固，加一条"下载完成时钉住文件内容hash、run前核对"
  的完整性绑定），**不建议为此阻断本次热修**——本次热修要解决的核心问题（零权限远程RCE）已经彻底
  解决，这条残留属于纵深防御的下一层，不是同一严重级别。

## 二、②download/run共用候选集——独立读代码确认彻底排除

独立读`downloadFile(actionId)`当前实现：`entry.filename`与`entry.url`**均**来自固定的
`ALLOWED_DOWNLOADS[actionId]`映射表，调用方提供的`actionId`只是一个查表键，不参与拼接文件名/URL的
任何字符串操作——**调用方没有任何途径影响下载的目标文件名或来源URL**，"下载步骤被诱导写入任意文件名"
这条攻击路径不存在。②确认彻底排除，不是"目前没想到怎么打"这种弱确认。

## 三、③3处调用方改动无行为回归——独立追查全部调用链

独立`grep`确认全仓（`agent-mind/`）内提及`SYSTEM_RUN`的位置**只有**`action-executor.mjs`与
`mind.mjs`这两处，均已改用`actionId: p.actionId`/`actionId: params.actionId`（跟同一文件里紧邻的
`SYSTEM_DOWNLOAD`分支用的是同一个既有字段命名惯例，不是本次新发明的孤立命名）。独立读`onboard-
broker.mjs`完整上下文确认：`actionId`是在外层`const actionId = platform === ... ? ... : ...`声明
的一个闭包变量，下载调用和随后`.then()`里的运行调用**引用的是同一个变量**（JS闭包捕获，不是两个
可能不同步的独立变量）——**独立确认这是本次热修唯一一条被明确指出的真实生产调用路径，且改动后语义
完全自洽**。全仓未发现任何遗留的、仍构造`{filePath: ...}`来调用`/api/system/run`的调用点。

## 四、其它独立核对

- 独立重跑既有6条regression（`system-actions.test.mjs`）：**6/6 PASS**。
- 独立`grep`确认`checkAdminSecretTier(...)`是两条路由handler体内**逐字第一条语句**（`broker.js`
  `/api/system/download`第306行、`/api/system/run`第321行，各自紧跟在`fastify.post(...)`之后）。
- 独立lint全部6个改动文件：**0 errors**。
- 独立`git merge-tree`对当前主线：**0冲突标记**。
- 独立确认`shell:true`已从`spawn`调用中移除（`opts.shell`未定义），附带堵上了"路径若含shell元字符
  会带出额外命令注入面"这条Bettor没直接问、但commit message提到的次要加固点。

## 五、给Bettor的处置建议

- **两笔均GREEN，可以合并**。
- §一记录的junction-retarget残留限制建议记一条backlog（完整性哈希绑定），不阻断本次合并/重启。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
