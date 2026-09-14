# NWT 判断 · 仓库改名runbook（`D:\kanet-tn12`→`D:\kanet`）复核（`bfe4426d`）

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1313：审改名runbook。

## 结论：**GREEN。抽查的关键事实性声明全部独立核实属实。方法论（功能性路径改/历史性注释不改的
两分法、诚实交代"19个scripts/命中里只精读了3个"的覆盖局限、worktree计数以执行当下实测为准不用
历史记录数字）判断合理，值得认可而不是要求它假装做了穷举式核对。**

## 一、抽查关键声明——独立核实

- `scripts/start-console-mainnet.ps1:39`：`$KanetRoot = "D:\kanet-tn12"` ——独立确认逐字匹配。
- `kanet-stop.sh:82`：独立确认`(\$_.CommandLine -notmatch 'kanet-tn12')`这条排除逻辑确实存在，
  跟runbook§1.3描述的位置/内容一致。
- `kasia-console/src/api/chat.js:522`：`process.env.KANET_ROOT || 'D:/kanet-tn12'`——独立确认
  这是防御性fallback默认值，跟runbook描述一致。
- `kasia-relay/src/lib/p2sh.mjs:28`：`process.env.KANET_ROOT ? ... : 'D:/kanet-tn12/tmp'`——同上
  确认一致。
- `git worktree list | wc -l`：独立现场实测**46**棵——跟runbook §2标注的"当前46棵，非Bettor记的
  43"逐字一致，确认这份文档使用的是执行时刻的实测值，不是历史记录里可能已经陈旧的数字。

## 二、方法论判断——认可

- **两分法（功能性路径必须改 vs 历史性注释不该改）判断正确**：改历史注释里的旧路径会让"当时这台
  机器叫什么名字"这条记录本身失真，跟本仓CLAUDE.md自己的"Owner钦定原话不改、紧贴其下补注记"是同一
  条纪律的另一种体现，不是这次改名新发明的标准。
- **诚实交代覆盖局限（19个scripts/命中里只精读了3个高优先级的）值得认可**：这跟本session一贯的
  "如实交代方法局限"纪律一致，不是偷懒，是把"没读完"这件事显式标出来，让执行时的人知道哪些地方需要
  自己重新按同样的两分法判断，而不是假装这份文档已经穷举过全部命中点。
- **`kanet-stop.sh:82`那条排除逻辑的处置——正确地没有在这份改名runbook里顺手改掉，而是单独标记
  为"需要Bettor/NWT/Owner先回答'TN12 sandbox现在还存在/还会启动吗'这个问题"**——这是对的判断：这
  条逻辑的处置依赖一个这份文档回答不了的、需要额外调查的事实性前提，不应该被一次"看到kanet-tn12就
  替换"的机械改名动作误伤（例如变成排除'kanet'这个新名字下的某个东西，若TN12路径根本不在这次改名
  范围内，那样的"修复"反而是错的）。
- **worktree junction/git worktree repair的处置**（先在改名前就存在的某一棵低风险worktree上演练，
  确认命令序列真的有效后才批量执行）——判断合理，不是"抄一份没验证过的命令序列就上"。

## 三、给Bettor的处置建议

- **GREEN，可以按此runbook执行**（执行窗口由Owner定，本次复核不改变这一点）。
- `kanet-stop.sh:82`排除逻辑的处置需要先回答"TN12 sandbox现状"这个问题——这个问题本身不在本次
  复核范围内，留给Bettor/Owner按runbook §1.3的建议单独确认。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
