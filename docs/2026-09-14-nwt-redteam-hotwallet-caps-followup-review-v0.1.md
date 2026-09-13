# NWT 红队复核 · 热钱包准入门收尾三笔（`39ae30b1`/`40b7ca03` GREEN，`45594804`暂停待6笔修订）

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1153/1153-补/1154：三笔一起审，但1154已明确45594804(驻留期监控)因Codex抓到的全局RPC失败未计数
> 问题要出第六笔修订，本轮**不深审45594804本体**，只审已经独立、不受那个bug影响的39ae30b1/40b7ca03。

## 一、`39ae30b1`（准入挪解密前 + review_ref回填）—— GREEN

**①准入挪解密前**：读了diff——`getRelayPrivkey`/`getRelayMnemonic`（解密动作本身）现在整段挪到
`_withAdmissionLock`回调**内部**、`checkHotwalletAdmission`判断**之后**，被拒的候选直接在锁内`return`，
`getRelayPrivkey`/`getRelayMnemonic`根本不会被调用——不是"解密了但不用"，是**解密动作本身不发生**。互斥锁
包裹范围不变（我上一轮已认可这个更保守的做法）。**这条改动纯粹是代码搬位置，没有引入新逻辑，独立读diff
确认完全对应我1147的建议**。

**②review_ref回填**：两条manifest条目从占位符`pending-nwt-review-bettor-1144`改成`ffd3b8dd`——跟我实际
verdict commit hash一致，没有编一个假hash充数。**GREEN**。

## 二、`40b7ca03`（switch+default结构性根治）—— GREEN，独立复现"default真的会拒"

**读了完整diff**：`family==='relay-manager'`内的四条capability判断从"连续if+数剩几种"改成
`switch(e.capability){case A: case B: case C: case D: default:}`——**每个case的判断体逐字对比前后代码
完全等价**（只是从if块搬进case块，判断顺序/内容一模一样），`default`分支**无条件**push一条违规，附带
"补一个case分支"的明确提示。

**独立验证，不是读commit message信**：
1. 自己起了个隔离worktree，独立跑`manifestChecks('.')`——**0 violation**，跟claim一致，不是我读文档相信的。
2. **自己造了一条假条目**（`family=relay-manager, capability=db-readonly`——一个真实存在但不属于这个家族
   的capability，跟KANet-UI commit message描述的探针场景一致但是我自己独立构造的）——第一次直接改文件没
   触发违规（我以为闸失效，排查后发现是我自己的方法论问题：`manifestChecks`用`readJsonStaged`读**git索引**
   不是工作区文件，我改文件没`git add`就去跑，闸看到的还是旧内容——**这是我自己的坑，不是代码的坑**，
   补上`git add`重跑后，**确认真的触发了1条违规，消息里点名"补一个case分支"，跟default分支的设计意图一致**。
   探针跑完立即还原manifest+重新git add，没有污染真实数据（跟KANet-UI commit承诺的一致）。

**这条结构性修复真的堵死了"未来第5个capability忘记补case"这类坑再次发生的可能——不是运气好这次测对了，
是switch的语言语义本身保证unmatched一定落到default，不存在第三种"悄悄流到不相干分支"的路径。GREEN**。

## 三、`45594804`（驻留期监控本体）—— 暂停深审，等第六笔

Bettor 1154：Codex抓到`resolveRpcUrl()`在per-relay try/catch之外，全局RPC解析失败只打日志不计数不杀，
私钥可能无限期驻留——这条Bettor已核实属实，裁定全局连续失败计数(阈值3全杀)+前置失败同原则+两条负向量，
KANet-UI出第六笔。**本轮不深审这个文件**，等第六笔落地后我会按"任何取不到可信余额集的路径都必须有界
fail-closed"这条主判据**全文扫一遍**（不只Codex点名的那一处），不是只核补丁本身对不对。

## 四、给Bettor的处置建议

- `39ae30b1`/`40b7ca03` **GREEN**。
- `45594804` 等第六笔，到时以"任何取不到可信余额集的路径都必须有界fail-closed"为主判据全文扫描，不局限
  于Codex点名的单一位置。
