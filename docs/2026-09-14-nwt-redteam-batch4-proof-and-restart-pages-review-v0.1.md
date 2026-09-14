# NWT 判断 · 第4批"导入不起relay"源码证明复核 + 两执行页审（`b8fff6d9`/`60a7479e`）

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1309/1310：①核对KANet-UI源码证明是否有遗漏的拉起路径（如`POST /relays/:id/restart`、
> `assign`、mind自动化）；②"解密前"是否对全部路径成立；③审两执行页验收项完整性。

## 结论：**KANet-UI的三点源码证明独立核实全部属实。独立追查发现`startRelay(`在kasia-console全仓
共有六处调用点（比证明里点名的三处多三处：`/relays/:id/assign`、`/api/relay/:id/restart`、一次性
onboarding流程），六处全部收敛到同一个`startRelay()`，"解密前拒绝"对全部六处无一例外成立。独立grep
确认`agent-mind/`（"mind自动化"）全仓零处调用`startRelay`，Mind没有绕过HTTP层直接拉起relay的能力。
两执行页独立核对：验收项完整，`b8fff6d9`对"导入即被拒"这个预期更强的结果给出了正确的处置态度（不是
异常，是防线更早生效），`60a7479e`的四线ancestor核实我独立验证目前确实全部为真（含RCE热修，已经
合并，对应我自己的GREEN verdict 06faf504）。**

## 一、遗漏拉起路径排查——独立枚举全部六处，比证明多找出三处

独立`grep -rn "startRelay("`覆盖整个`kasia-console/src/`（排除函数定义本身），确认全仓恰好**六处**
真实调用点：

| # | 位置 | 证明里是否已点名 |
|---|---|---|
| 1 | `relay-health-monitor.js:111`（`doStartRelay`默认值，30s tick） | ✅已点名 |
| 2 | `relay-manager.js:346`（`startAll()`，console重启路径） | ✅已点名 |
| 3 | `system-repair.js:231`（`restart_relay_`人工触发） | ✅已点名 |
| 4 | `relay.js:200`（**`POST /relays/:id/assign`**，绑adapter后自动拉起） | ⚠**证明未点名，独立追查补上** |
| 5 | `relay.js:215`（**`POST /api/relay/:id/restart`**，单relay手动重启） | ⚠**证明未点名，独立追查补上** |
| 6 | `relay.js:1805`（一次性onboarding流程"11. Start relay process immediately"，跟批4无关但同样是真实拉起路径） | ⚠**证明未点名，独立追查补上** |

**独立确认全部六处，逐字读了每一处的调用代码，均是`startRelay(id)`/`startRelay(relayId)`/
`startRelay(request.params.id)`直接调用同一个函数，没有任何一处绕开它自己实现一套平行的拉起逻辑。**

## 二、"解密前"对全部六处无一例外成立——独立读`startRelay()`函数体确认

独立读`relay-manager.js:157-215`完整函数体：`checkHotwalletAdmission({address, network, rpcUrl})`
——三个参数全部是公开信息（DB里的地址列 + env里的网络配置 + RPC健康检查结果），**在这次调用之前，
函数体内没有任何一行代码读取过`mnemonic_encrypted`/`privkey_encrypted`列或调用过`decrypt(`**。
`if (!admission.ok) { ...; return admission; }`（207-210行）短路返回，函数在这一行之后才会（若准入
通过）继续往下走到真正读取/解密密钥材料的部分。**因为六处调用点全部是对这同一个函数的直接调用，
不存在任何"六处里有一处走的是函数内部另一条分支、可能在准入检查之前就摸到密钥"的可能性**——独立
确认"解密前拒绝"对全部六处无一例外成立，不是"对已点名的三处成立、对另外三处未知"。

## 三、"mind自动化"——独立确认Mind没有绕过HTTP层的直接拉起能力

独立`grep -rn "startRelay("`扫描`agent-mind/`整个包：**零命中**。Mind只能通过HTTP调用console的API
间接触发相关动作（比如`/api/relay/:id/restart`），而这些HTTP端点本身就是上面六处清单里已经覆盖的
调用点——**不存在Mind绕过HTTP层、在agent-mind包内部直接import/调用`startRelay`的旁路**。

## 四、批4执行页（`b8fff6d9`）——独立核对验收项完整性

独立读全文确认这份执行页对"两种可能结果"都给出了正确的处置态度，不是只写了乐观路径：
- **§3步骤⑤/⑥明确写了"若导入这一步就被拒绝（预期路径）"该如何处理**——如实记录"冷清单在导入层就
  已完全拦截"，**判断为"比预期更早的一层防御生效"，不算异常**，跟我独立读`relay.js:90-141`确认的
  代码行为完全一致（`POST /relays`的早失败层确实会在`resolvedAddress`存在时跑`checkHotwalletAdmission`，
  两行都会传`mnemonic`从而触发地址派生，届时确实会在`createRelayNode`之前就被拒）。
- **§3步骤⑤也明确写了"若两行意外被创建成功"该停下核查**，不是假设后续防线一定兜得住——跟这份页面
  自己在§0点明的"三条自动拉起路径的安全性质是'不会被成功拉起'不是'从不被尝试'"这条区分保持一致。
- §5观察窗口的验收项（≥3 tick、relay子进程数恒17、零解密日志、链上余额前后一致）逐条对应§0/§三
  的代码事实，没有要求验证任何代码里实际不存在的性质。
- §2前置检查第3项（冷清单env含两地址+两上限未变）是本批特有的"第二道独立门"，独立确认跟
  `checkHotwalletAdmission`内部逻辑（冷名单检查与per-relay/total上限检查是两个独立子检查，见既有
  `RELAY_HOTWALLET_COLD_ADDRESSES`/`RELAY_HOTWALLET_PER_RELAY_MAX_KAS`两组env）的既有设计一致，
  不是本页新发明的判据。

**结论：批4执行页GREEN，可以按此执行；且我独立读代码后判断，"导入这一步就被拒绝"（§3步骤⑥描述的
"预期路径"）几乎必然会是真实结果——`POST /relays`的早失败层逻辑本身没有"先建行再判断是否要跳过
startRelay"这种中间态设计，只有"建行前直接拒绝"或"建行"两个分支，没有第三个"建但标记不自动拉起"
的分支。**

## 五、合并重启页（`60a7479e`）——独立核对四线祖先关系+验收项

独立`git merge-base --is-ancestor`核实四条线（`a5e5514d`/`e49ee43e`/`03d8e403`/`c0ed69fa`）**当前
全部已经是`bshard-m3-deploy`头的祖先**（本文档撰写时头已经是`88dec0a7`，四线均已合入）——独立追查
三条对应的"merge:"提交信息，确认它们逐字引用的正是我自己给出的GREEN verdict commit
（`7d4afe4b`/`db0eb7ba`/`1de9e34a`），不是转述或凑数。RCE热修合并点`d266d0ce`同样正确引用了我的
`06faf504`。

§2 env核实清单/§5重启后验证清单独立核对：新增的`ADMIN_SECRET_SYSTEM_ACTIONS`检查项（应为0，即
RCE热修锁的两条路由维持主网默认关闭）与`system-actions`两路由应503——跟RCE热修落码内容逐字对应；
`committee-offset参考值WARN`这次预期从"应出现"反转为"应为0行"——独立核对跟`T-REF-OFFSETS-REFRESH`
的落地内容（参考值已刷新为当前真实派生值）逐字对应，页面自己也明确提醒"跟上次判据正好相反，不要
套用上次的预期"，这条提醒是必要且准确的，不是画蛇添足。

## 六、给Bettor的处置建议

- **批4执行页GREEN，可以执行**；批4的"预期结果"几乎必然是"两行在导入这步就被拒绝，不会真的产生
  新relay行"——这不是异常，按§3步骤⑥处理即可。
- **合并重启页GREEN，四线祖先关系当前确认全部成立，可以执行重启**。
- 独立追查补上的三处遗漏拉起路径（`assign`/`restart`/onboarding）建议KANet-UI后续把这份源码证明
  文档本身更新一下，补全六处清单（不影响本次批4执行，纯粹是让这份证明文档本身更完整，供以后的人
  直接引用不用重新grep一遍）。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
