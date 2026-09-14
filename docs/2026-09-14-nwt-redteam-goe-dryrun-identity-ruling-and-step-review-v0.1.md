# NWT 判断 · GO-E 干跑页身份张力裁决 + 九步读写分档复核（`54c54488`）

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1289：三选项裁ephemeral vs 已导入身份做DELETE；裁完再审九步读写/Owner分档准确性。

## 结论：**裁定 (a)——DELETE/复活链路的干跑改用`generate-mnemonic`全新、不注资的临时身份，不用
Trader-A/Bettor。九步的读写分档本身独立核实全部准确（含三处逐字节代码核对：`STARTUP_GRACE_MS`/
`repair`调用链/`DELETE`调用链），仅两处line号轻微漂移（非实质错误）+一处⑨证据采集措辞需精确化。**

## 一、身份张力裁决——(a)，理由

**DELETE/repair/复活这几步测的是机制本身，跟身份有没有余额无关**——独立读代码确认：
- `deleteRelayNode(id)`（`relay-nodes.js:70`）只做两条按`id`限定的`DELETE`（`skills`+`relay_nodes`），
  逻辑里没有任何地方读取/判断余额。
- `startRelay`/`applyFix('restart_relay_...')`（`system-repair.js:227`→`relay-manager.js:157`）同样
  不读余额，只看这一行是否存在+能否解密出私钥来起子进程。

**用$0余额的临时身份测这几步，跟用Trader-A的7.46 KAS测，覆盖的是完全相同的代码路径，测试覆盖面
零损失**——这是裁定(a)的核心依据：既然多余的"真实资金"不会让这几步测得更充分，那唯一的作用就是
纯粹的风险敞口，没有对应的收益。

**Trader-A/Bettor不是"ephemeral"，是持续在跑的舰队成员**——独立核对1123/1124两条ledger记录的
"ephemeral manual relay"六条硬门，第③条"仅为显式手动动作启动"对Trader-A结构性不成立：批2导入后
Trader-A的relay进程一直在跑、一直是`relayHealthMonitorTick`的`eligible`计数里的一员，不是"这次
验证专门起的"。用它做DELETE测试，测的不是"一个ephemeral验证relay的生命周期"，是"把一个正常服役中
的真实生产relay当白鼠"——这跟六条硬门想描述的场景本身就不是同一件事，不只是"风险大小"的问题。

**DELETE后的恢复路径不对称**：(a)最坏情况=一行空壳身份被删、$0损失、无需任何恢复动作。(b)/(c)最坏
情况=一个正在服役的真实relay从这台console本地消失，唯一恢复路径是重新走一次迁移导入流程——这本身
是我在`364bfce3`第③点已经指出的"导入路径本身需要新的机械检查"，即再引入一次money-path相关动作
去"修复"一次本可以完全避免的破坏，纯属不必要的操作面扩大。

**(a)不是新路径，是GO-E自己§2的原始默认流程，只是省掉可选的注资步骤**——`generate-mnemonic`流程
本身早就是GO-E既有清单的一部分（本次执行页只是Owner 1168④暂时绕过它去复用已导入身份），回到它不
需要额外的机制审批，只是"不给这个临时身份转钱"这一件事本身不需要再单独批（没有资金转移动作）。

**结论：裁(a)**。执行页需要改的地方：
1. §0改回"用`POST /relays/generate-mnemonic`新生成一个身份，**不转入任何资金**"，删除Trader-A/
   Bettor二选一的候选描述。
2. §1"临时relay的注资"这一档**部分恢复适用**——不是给③⑤⑥⑦⑧⑨（这些步骤$0余额也能测），而是**仅
   当保留步骤②广播子步骤时**才需要（`handshake`/`send_message`可能需要付手续费）。
3. **建议步骤②广播子步骤整体挪出本次干跑范围**（它验证的是"relay能不能正常发协议消息"，跟本次
   干跑真正要验的"DELETE/复活链路机制是否按设计工作"是两件不同的事，硬凑进一次干跑会把"要不要转钱
   给这个临时relay"这个新问题重新引入，不如干净分开——干跑不测②广播子步骤，DoD另立一票单独验证，
   若Owner/Bettor仍想在这次一起测，则②广播子步骤保留🔴且额外注明需要的最小手续费金额）。

## 二、九步读写/Owner分档——独立核实，逐条对应

独立读当前主线（`bshard-m3-deploy`）源码逐条核对页面的具体技术断言，**全部准确**，两处line号轻微
漂移（非实质错误，供KANet-UI下版顺手更正）：

| 步骤 | 页面分档 | 独立核实结果 |
|---|---|---|
| ① 确认身份行 | 🟢只读 | 纯`SELECT`，无争议 |
| ② 进程存活确认 | 🟢只读 | `Get-CimInstance`查询，无争议 |
| ② 广播子步骤 | 🔴Owner另批 | 准确——链上留痕+花费，不可回退，独立单批理由成立（但见上文§1建议挪出本次范围） |
| ③ 停进程 | 🟡机械 | `Stop-Process`，OS级动作，准确 |
| ④ 等待90s | 🟢只读(无动作) | **独立确认`STARTUP_GRACE_MS=90_000`**（`relay-health-monitor.js:25`，页面写`:15`，line号轻微漂移，**值本身准确**） |
| ⑤ 确认无自动拉起 | 🟢只读 | 查询+grep日志，无争议 |
| ⑥ Owner备份确认关卡 | 🔴Owner另批 | 语义描述准确（与我`364bfce3`第④点"DELETE对导入身份只是本地移除、密钥material仍在源头"的论述逐字一致）——**若采纳裁决(a)，这一关卡的性质说明需要相应改写**：全新生成的临时身份DELETE=密钥material确实从世界上消失（这次又变回v0.4原设计针对的那个场景，跟导入身份不是同一件事），但**因为是全新生成+不注资+零余额**，销毁的后果本身可忽略——关卡本身仍建议保留（DELETE不可逆的性质没变），但说明文字要按新身份的实际风险重写，不能照抄现在这版针对"导入身份"的论述 |
| ⑦ `/api/system/repair`触发repair | 🟡机械 | **独立确认调用链**：`settings.js:129`(页面写`:129`一致) → `applyFix`(`system-repair.js:181`) → `fixId.startsWith('restart_relay_')`分支(`:227`) → `startRelay(relayId)`(`relay-manager.js:157`，纯本机进程操作，零broadcast)——"不是广播，是本机运维调用"这条定性准确 |
| ⑧ DELETE | 🔴Owner另批 | **独立确认调用链**：`POST /relays/:id/delete`(`relay.js:188`，页面写`:161`，line号轻微漂移) → `deleteRelayNode(id)`(`relay-nodes.js:70`)——零`console.log`确认属实；`DELETE FROM skills WHERE relay_node_id=?`+`DELETE FROM relay_nodes WHERE id=?`两条均按`id`参数限定，**不碰任何其它relay行**确认属实；响应`reply.redirect('/relays')`无JSON body确认属实 |
| ⑨ 复核 | 🟢只读 | **独立确认**：`startRelay`对不存在的id返回`{ok:false, reason:'account_not_found'}`(`relay-manager.js:170`)，但经`applyFix`包装后顶层响应是`{ok:false, message:'重启失败: account_not_found'}`——**证据采集措辞需精确化**：`account_not_found`是嵌在`message`字段的子串，不是一个独立的顶层字段，KANet-UI截证据时应`grep`整个响应体里含"account_not_found"这个子串，不要假设它是某个具名字段的值 |

## 三、给Bettor的处置建议

- **裁(a)：DELETE/复活链路干跑用全新不注资的临时身份，不用Trader-A/Bettor**。
- 九步分档整体准确，KANet-UI出v0.2时：改§0身份来源为generate-mnemonic+不注资、按上文调整⑥的
  风险说明文字、②广播子步骤建议挪出本次范围（或明确保留+补最小手续费金额）、顺手更正两处line号、
  ⑨证据采集措辞按上表精确化。
- v0.2出来后我按同样力度独立核实一遍再GREEN，执行仍等Owner拍板。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
