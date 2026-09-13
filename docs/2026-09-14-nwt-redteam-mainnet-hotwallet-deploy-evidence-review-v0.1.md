# NWT 红队复核 · 主网热钱包准入门+驻留期监控部署证据(`c5b3d0d8`)

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1177：核证据页（日志副本与README叙述一致；stderr 4行确为已知非错误；kaspad daa单调）。

## 结论：**GREEN。日志原文逐行核对与README叙述一致，stderr 4行确认均为已知非错误，kaspad daa独立
重新探测确认单调递增、未受console重启影响。**

## 一、日志原文核对（不是读README转述，直接读两份留档日志全文）

- **stderr恰好4行**，逐行核对内容与README引用逐字一致：`[migrate] v199`索引未建提示（既有已知项）/
  `[zk-prove-server]`未配token fail-closed/`[external-gateway]`未配置fail-closed/
  `[oracle-pool-scanner-cron] tick fail: pool empty`（空表环境下的正常提示）——**四行全部是"未配置/空表"
  类fail-closed提示，不是异常**，跟README的分类判断一致。
- **`grep -i "FATAL\|UNMET\|MODULE_NOT_FOUND"`两份日志全文0命中**——独立确认，不是读README信。
- **驻留期监控初始化行**：`[relay-hotwallet-monitor] started — tick=30000ms grace=90000ms
  max_consecutive_failures=3`（stdout:72）——独立grep确认存在。
- **第八笔MUST-FIX（重启风暴节流）部署确认在跑**：`[relay-health] started — tick=30000ms grace=90000ms
  max_restart_per_hour=3`（stdout:71）+ 观察窗口内出现4次`[diag:tick-duration] relayHealthMonitorTick`
  记录（`eligible=0 deadCount=0`，因为本次未导入任何账号，符合预期——tick真的在跑，只是暂时无候选可测）。
- **env生效确认（换一条独立证据链，不止信README引用的PS1包装脚本回显）**：`[db] path=...console.mainnet.db
  source=DB_PATH`（stdout:1）+ `[kasia-console] running at http://localhost:3202`（stdout:36）——从
  node自己的输出直接确认`DB_PATH`/`PORT`两个env被正确读取，不依赖PowerShell包装脚本那条回显是否被
  完整收进这份日志文件。

## 二、kaspad daa单调——独立重新探测确认（不是照抄README两个数字）

README给的探测脚本默认端口是testnet-12的`17210`（我起初直接跑探针用默认参数，得到`DEAD:timeout`——
这不是kaspad有问题，是我漏设`KASPAD_PROBE_URL`指向mainnet真实wRPC端口`17110`；换端口后重新探测：
**`ALIVE:network=mainnet daa=539111623`**——比README记录的重启前(`539105907`)/重启后(`539106605`)
两个基线值都更高，跟"部署窗口之后时间继续推进、daa持续单调增长"的预期完全一致，独立确认kaspad本身
未受console重启影响，现在依然活着且在正常出块。

## 三、给Bettor的处置建议

- **证据页GREEN，可以定案**——本次部署（准入门env+驻留期监控+第八笔节流）在生产主网console实例里
  确认生效，未导入任何账号，旧系统(`C:\KANet`)确认保持关闭，kaspad未受影响。
- 无新发现的问题。等KANet-UI出迁移第1批（stress 10个）执行页。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
