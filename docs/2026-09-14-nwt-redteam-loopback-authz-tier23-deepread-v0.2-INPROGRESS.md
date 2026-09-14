# NWT 判断 · T-LOOPBACK-AUTHZ Tier2/3逐文件深读 v0.2（进行中，因主机重启中断）

> **Status**: DRAFT-FOR-REVIEW（进行中，非完稿——J1自动重启da9中断了这次深读，先如实提交已完成部分，
> 恢复会话后续做）

## 方法

对`fccfee59`分档文档里"未逐条深读"的约200条Tier2/3路由，先跑了一个扩展信号扫描
（`fundKey`/`spawn`/`fsWrite`/`startRelay`四类关键词，覆盖全部方法含GET），列出全部命中，逐条判断是
真实fundKey/spawn/fsWrite信号还是误判，再决定是否需要从原分档升级。

## 已完成部分

### `pool.js` — `/api/pool/market/:id/bettor/register-v07`与`/confirm`（L1474/1729）

**信号来源**：扫描命中`sendCommandAsync`（`fundKey`类）。

**独立读代码判断**：`/prep`只返回一个付款地址+精确金额（不移动任何资金）；`/confirm`用
`sendCommandAsync`发起的是**只读**RPC调用（`rpc.getUtxosByAddresses([...])`，查询已有UTXO，不是
转账/签名类命令），用来检测"这个地址上是否已经出现一笔匹配精确金额的、尚未被消费过的真实链上付款"
——**真正的资金移动发生在调用方自己的外部钱包主动付款这一步，不在这个HTTP端点内部**。攻击者调用
`/confirm`而没有真实付款，因为查不到匹配UTXO，直接拿到"未注册"的响应，不会造成任何状态改变。

**判断：维持Tier2（状态类），fundKey信号是误判**（`sendCommandAsync`确实出现在窗口内，但那次调用
是只读查询，不是转账命令；广义正则没有区分调用的command type）。**已知的、这个机制真正的风险面**
（比如"精确金额碰撞"竞态）属于协议设计层面既有的、本session此前已经审过的话题（"唯一nonce"归属机制），
不是本次HTTP鉴权分档要处理的新发现。

## 未完成部分（如实交代，恢复后继续）

以下文件/路由尚未深读，只有信号扫描的粗筛结果，**不能视为已确认分档**：

- `bettor.js`：`prediction/publish`/`taker-stake`/`refund`三条命中fundKey，**优先级最高**（"taker-
  stake"/"refund"字面上就是资金相关动作，需要跟pool.js同款方法逐条确认是"只读检测已有链上状态"还是
  "端点自己触发转账"）。
- `exchange.js`：`cancel`/`confirm`/`dispute`/`resolve`四条命中fundKey，同优先级（P2P交易结算，
  `resolve`字面听起来像会真的推进资金归属）。
- `escrow.js`：`create`/`lock`/`execute`三条，`fccfee59`已经标注"待后续单独评估"，本次应该给出
  确定结论而不是继续搁置。
- `oracle-pool.js`：`timeout-unlock`一条，"unlock"字面像资金释放。
- `chat.js`：`send`/`confirm`两条命中fundKey（`send`可能是走`sendCommandAsync`广播消息，非资金，
  需确认；`confirm`需读代码）；`dashboard/digest/generate`命中`spawn`信号，需要单独确认是不是真的
  spawn子进程、spawn的是什么。
- `skills.js`：`upload`命中`fsWrite`——**这条值得比其它高，因为`runInstaller`那次RCE教训表明"写文件
  到磁盘+文件名/路径校验不严"是这个代码库出过真事故的病灶类型**，需要确认upload端点有没有同类路径
  穿越/覆盖风险。
- `trading.js`的一批GET路由（`accounts/:id/balance`/`balances`/`spreads`/`portfolio`/
  `order/:orderId`）命中fundKey——这些是读操作不是写，不是本次"状态变更路由"分档的范围，但独立发现
  它们会解密存储的交易所API凭据去发起外部请求，跟Tier1.2"凭据存取"是相关但不同的一类暴露面
  （"未授权的读也能触发凭据使用"），值得记一笔供后续参考，不在本次Tier2/3分档任务范围内展开。
- `pool.js`剩余命中（`oracle/deposit`/`bettor/register`(非v07)/`oracle/vote`）——同`register-v07`
  方法论，需要逐条确认。
- 剩余约150条**未命中任何信号**的路由（`identities.js`/`discovery.js`/`conversations.js`/
  `adapter.js`/`monitor-dashboard.js`/`kanet-broker.js`/`chain-data.js`/`dev-channel-v1.js`/
  `auth.js`/`oauth.js`/`peer-coord.js`/`budget.js`/`skills.js`其余/`feedback.js`/`backup.js`/
  `settings.js`）——信号扫描零命中不等于确认无害，只是优先级较低，仍需要逐文件读一遍确认没有信号
  扫描漏掉的写副作用（比如直接拼SQL做大范围DELETE、或者GET路由里藏着写操作——这正是`fccfee59`已经
  抓到一个真实案例`GET /ingest/pending-handshakes`的那类模式，信号扫描本身不专门找这个，需要人工读）。

## 下一步

恢复会话后按优先级（fundKey命中路由 → spawn/fsWrite命中路由 → 剩余未命中路由逐文件通读）继续，
产出正式v0.2定稿。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
