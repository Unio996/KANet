# NWT 红队复核 · 热钱包准入门实现 `a65c28dc`（relay-manager.js startRelay()）

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> 审对象：`a65c28dc`（`coord/kanetui-hotwallet-caps`，`kasia-console/src/services/relay-manager.js`）。
> 范围说明：Bettor 1146 提到的"三笔"目前只有这一笔真正落成 commit——api/relay.js 早失败接线 + 测试文件
> 卡在 M0a 裸 import 门（amendment #6 待批），本轮只审已落码的这一笔，另两笔到位后再审。

## 结论：**GREEN，机制正确落地了 v0.1+v0.2 全部设计意图，独立读代码确认无安全缺陷；发现一处可以做得更好但不算安全漏洞的顺序问题（解密时机），建议顺手改**

## 一、逐条核对 v0.1/v0.2 规格是否落地

- **冷清单/per-relay/总额三条检查**：`checkHotwalletAdmission()`逐条实现，顺序（冷清单→per-relay→总额）、
  "两个cap都未设=不启用"、"缺rpcUrl/查询报错=fail-closed拒绝不当0放行"——逐条跟v0.1 §5、v0.2 §1对得上。
- **总额查询不缓存**：`_sumRunningRelayBalancesKas()`每次都现查`_relays`里`child`存在的行、现查链上余额，
  没有v0.1早期讨论过的30s TTL缓存——注释明确写了"曾经的30s TTL缓存已按Codex意见去掉"，跟Codex TOCTOU的
  要求一致。
- **聚合准入互斥锁**：`_withAdmissionLock`是一个正确的promise链式互斥锁实现——追踪了一遍它的排队逻辑：
  第二次调用的`fn`只有在第一次调用完全settle(无论成功失败)之后才会被排上，且失败不会打断链条(用
  `.then(()=>{},()=>{})`吸收rejection)。**锁覆盖的范围比我原规格要求的更宽**——我原设计只要求锁住
  "查总额→做决定"这一小段，这次实现把fork+登记进`_relays`也一起锁进去了（整个`startRelay()`核心逻辑
  串行化）。这不是缺陷，是更保守、更容易推理正确性的选择（relay启动不是高频操作，全程串行化的性能代价
  可以接受，换来的是不存在"准入判断和实际登记之间还有个空隙"这类我原规格没有覆盖到的边缘竞态）。
- **fail-closed三种场景**：候选自身余额查询失败/总额查询失败/rpcUrl缺失（且cap已配置时）——三条路径都
  返回`{ok:false, reason:'balance_query_failed'}`，不会误当0继续放行。
- **日志不含密钥**：所有`console.warn`/`console.error`只插值`address`/`balance`/`cap`/`runningTotal`这类
  公开数值，没有一行涉及`privkey`/`mnemonic`/密文。
- **RPC复用**：`_queryBalanceKas`走`getSharedRpc({url, networkId})`——跟`api/relay.js:371`既有余额查询端点
  同一个共享单例入口，不是per-call新建（不会重蹈`kaspa-wasm RpcClient`每实例泄漏内存的坑）。
- **运行期监控挂钩**：`onRelayAdmitted()`故意留空，注释写清楚"语义由NWT 2-1 v0.2定，这里只保证调用点已经
  存在"——跟Bettor 1138的裁决(先留钩子不抢先定语义)一致。

## 二、发现一处顺序问题——不是安全漏洞，是可以做得更省的地方

**观察**：`checkHotwalletAdmission()`的调用点插在`Object.assign(env, buildRelayKeyEnv({privkey, mnemonic}))`
**之后**——而`privkey`/`mnemonic`本身是在函数更早的地方就已经调`getRelayPrivkey(relayNodeId)`/
`getRelayMnemonic(relayNodeId)`解密出明文的（这两个函数内部调`decrypt()`）。这意味着：**即使一个候选最终
被准入门拒绝，它的私钥/助记词明文仍然已经在console自己的进程内存里短暂存在过**（`privkey`/`mnemonic`局部
变量 + 折进`env`对象），只是没有被送进fork出去的子进程。

**这不是一个新引入的安全漏洞**——这段解密逻辑在这次改动之前就一直在fork之前无条件执行，这次改动没有让
明文停留的时间变长或换了个更危险的地方，只是准入检查插入的位置没有把"能不能省掉一次不必要的解密"这个次要
优化顺手做掉。**但既然整份2-1规格的精神就是"减少私钥不必要地存在于内存的时间"，这条能顺手改就该改**：把
`checkHotwalletAdmission()`的调用挪到`getRelayPrivkey`/`getRelayMnemonic`**之前**（只需要`account.address`
和`net`，这两个在函数更早处就已经有了，不依赖解密结果）——一旦准入被拒，连解密这一步都不会发生，把"私钥
明文在console进程里存在过"这件事从"发生但没送出去"进一步收紧到"根本没发生"。

**建议**：这是一处小的、非阻塞的改进，不要求推倒重做——下一笔顺手挪一下调用顺序即可，不需要因为这条重新
审整份diff。

## 三、给 Bettor 的处置建议

- **`a65c28dc` GREEN**，可以在Owner确认800/1000数值+冷清单地址之后作为准入门核心实现使用。
- **一处非阻塞建议**：把`checkHotwalletAdmission()`挪到`getRelayPrivkey`/`getRelayMnemonic`解密之前调用，
  避免被拒绝的候选也经历一次不必要的明文解密——不是安全漏洞，是"减少不必要暴露"这条精神的进一步落实。
- **另两笔（api/relay.js早失败接线+测试文件）待M0a amendment #6批准后再审**——到时按你说的四点(白名单
  是否真只两项/digest机制没被绕/准入代码本体/串行化)逐条核，本轮不预先评判还没落地的东西。
