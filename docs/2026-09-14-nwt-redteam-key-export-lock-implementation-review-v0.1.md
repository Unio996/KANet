# NWT 红队复核 · T-KEY-EXPORT两把锁落码(`cb59e320`) + M0a锚定失配流程意见

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1255：按设计页§4逐项独立验证——两锁缺一不可、时间窗过期、403/503分层、成功路径LOUD+events
> 不含密钥、失败路径不刷屏；另两点：①preHandler位置是否在解密动作之前；②M0a锚定文件被无关改动触发
> 失配该走什么流程（考虑修正#8候选）。

## 结论：**§4全部测试范围独立验证GREEN（9/9独立跑通，覆盖两锁缺一不可两个方向/过期/403vs403分层/
边界值/非法值不崩溃）。①preHandler位置独立读diff确认：两条路由的`checkKeyExportWindow(request)`都是
handler里的第一条语句，严格在`getRelayMnemonic`/`decrypt(wallet.privkey_encrypted)`之前——先闸后
解密，不存在"闸没生效解密已经跑完"的时序漏洞。②M0a锚定失配：独立确认digest已正确更新（全库lint 0
errors）+ checkHotwalletAdmission那行import逐字未动（relay.js diff里唯一新增import是
checkKeyExportWindow）——这次的review_ref占位处理方式（先标pending、待复核后回填）合理。给出流程性
意见：这类"整文件哈希锚定单行"的设计本身会让任何无关编辑都触发重审，建议收窄锚定粒度（只哈希被保护
行本身+小窗口上下文，不是整文件），降低复核疲劳导致真变化被漏判的风险，供M0a修正候选参考。**

## 一、§4测试范围——独立跑通，逐条对应设计页要求

独立`git worktree`+`npm install`后跑了`admin-secret-tier-key-export.test.mjs`：**9/9 PASS**，逐条
对应设计页§4要求：

| 设计页要求 | 独立跑通的具体断言 |
|---|---|
| 两锁缺一不可（方向①：只设时间窗） | "window set, secret unset → 503" |
| 两锁缺一不可（方向②：只设密钥） | "secret set, window unset → 503"——**独立确认这条覆盖了"密钥单独生效就等于没有自动超时"这个真正的风险方向**，不是只测了一半 |
| 时间窗过期 | "window expired → 503" |
| 403/503分层 | 密钥错误→403、密钥缺失→403、两env未设→503——**独立确认503（disabled/未配置）跟403（配置了但认证失败）这两种语义被正确区分开，不是笼统一个错误码** |
| 边界值 | "boundary: 1s in future + correct secret → ok"（未过期边界正确放行） |
| 非法值不崩溃 | "malformed timestamp → 503"（非数字字符串走`Number.isFinite`拦下，明确拒绝不是抛异常崩溃） |
| 正向 | "window valid + correct secret → ok" |

## 二、①preHandler位置——独立读diff确认严格在解密之前

- **mnemonic路由**：`checkKeyExportWindow(request)`是handler体内**第一条语句**，`getRelayMnemonic
  (request.params.id)`（内部执行解密）在它**之后**才调用。
- **privkey路由**：`checkKeyExportWindow(request)`同样是**第一条语句**，在`getRelayNode`查询、
  `agent_wallets`表SELECT、`decrypt(wallet.privkey_encrypted)`**全部之前**。

**独立确认：两条路由都是先闸后动作，没有"闸放在解密之后"或"闸只包住返回值格式化、解密已经先跑完"
这类时序漏洞。**

## 三、LOUD/events内容——独立核对不含密钥本身

`_logKeyExportSuccess`的`console.error`：仅含`relayId`后8位、`route`名、`walletId`后8位——**独立确认
不含完整密钥/助记词字符串**。`events`表`payload_json`：`JSON.stringify({relayId, route, walletId})`——
`relayId`本身是DB主键/标识符不是密钥物，独立确认这里也不含实际密钥内容（跟`summary`字段一样，只描述
"这件事发生了"，不携带密钥值）。失败路径`console.warn`（不是`console.error`）——独立确认符合设计
"避免时间窗过期后的正常拒绝刷屏"这条要求，跟成功路径LOUD级别明确区分。

## 四、②M0a锚定文件被无关改动触发失配——独立核实+流程性意见

**独立核实事实层面**：`grep`确认全库lint（`node scripts/lint-kanet.mjs`）956文件**0 errors**——digest
已正确更新到跟当前`relay.js`内容匹配（若更新错了会被M0a自己的TOCTOU检测拦成ERROR，不是我信commit
message的转述）。独立读`relay.js`完整diff确认`checkHotwalletAdmission`那条既有import行**逐字未出现**
在本次diff里——唯一新增的import是`checkKeyExportWindow`，跟`relay-manager`家族完全无关，跟KANet-UI
commit message的描述一致。**review_ref暂标pending、待复核后回填的处理方式本身合理**（不是空着不管，
是明确标注"这个哈希对，但复核结论还没盖章"，跟本session一贯的"不假装已经审过"纪律一致）。

**流程性意见（供M0a修正#8候选参考，不代为拍定）**：这次失配的根因是**锚定粒度选择**——M0a用的是
**整文件content_digest**，但它实际想保护的是**一行具体的import语句**。这两者的粒度不匹配，导致
`relay.js`（一个体量大、频繁被各种不相关功能改动touch的文件）**几乎每次编辑都会触发这个特定条目的
digest失配**，即便被保护的那一行真的一个字没动。**这不是一次性巧合，是这个设计选择的必然结果**——
只要`relay.js`继续被频繁编辑，这条锚定就会反复触发"需要人工核实+回填review_ref"这个流程，长期来看
存在两个风险：①**复核疲劳**——如果这种"看起来又是无关改动"的失配出现次数够多，人在核实时容易越来越
快速地扫一眼就回填，真正需要警觉的那一次（保护行真的被悄悄改了）反而更容易被同样的"应该又是无关改动"
的心态放过；②**噪音掩盖信号**——这条锚定本来是想在"保护行被改"这件事上发出信号，但当前粒度下，信号
被"保护行没变但文件别处变了"这种噪音**淹没**（这次这样的失配本身就是个例子）。

**建议**：把这条特定的锚定（以及其它类似的"用整文件digest保护单行"的M0a条目）改成**只哈希被保护行
本身（+可选的小窗口上下文，比如前后各2-3行，用来防"import语句没动但被本地shadow/条件包裹"这类更隐蔽
的绕过）**，不哈希整个文件——这样锚定的触发范围跟它实际关心的东西对齐，`relay.js`别处的正常功能开发
不会再无谓触发这条特定条目的重审，真正改到被保护行时才会（且更容易被一眼看出"这次是真的动了"）。
**如果窄范围锚定被认为不够（比如担心遗漏"看似无关但改变了import行为的间接改动"），折中方案是保留
整文件digest但把"复核"这个动作拆成两级**：机械检查"被保护行文本本身有没有变"（能自动做，不需要人）
通过时只需要**记账更新digest**（不需要NWT重新审内容本身，因为内容真的没变）；机械检查发现保护行真的
变了，才升级成需要NWT完整重审——这样能保留整文件哈希的"广撒网"特性，同时把"无关改动"这个大多数情况
自动化处理掉，不占用人工复核的注意力。

## 五、给Bettor的处置建议

- **`cb59e320`全部GREEN，可以确认落码**。
- 流程性意见已给出（见§四），供M0a修正#8候选参考，不阻塞本次commit的确认。
- 另注：`checkKeyExportWindow`函数本身与本次1256的offset-derive HOLD（ctor值无关性假设）是**完全独立
  的两套机制**——本次key-export锁定不涉及任何`compileSilV100`/`deriveCommitteeCheckOffsets`调用，
  跟那条HOLD无关，不受影响。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
