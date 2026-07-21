# NWT 红队 — jepu1 陈签名软失效手术单审(2026-07-18)

> **Status**: SUPERSEDED(手术单本身/前置审查结论仍站得住, 但 04:57 实际执行结果推翻了"过了条件5就能落地"的假设——见文末最终状态记录)
> **对象**: `docs/2026-07-18-jepu1-surgery-order.md`(3ce0e384, J1tn)
> **verdict**: **🟡 手术单前置审查部分(selector/locality/Gate-A/Gate-B)结论有效不撤回, 但实际执行未能让 jepu1 落链结算——node 拒签, 诊断转入 J1 深 sighash 域, 今晚不再推进**

## 独立复算(重复劳动, 但钱路值得)

Selector 5 行/id/observed_at/signer_pk 我在手术单成文前已独立算过两次(§4-0 locality + delete selector), 跟本单§1的判定式逐项吻合, 不再重算, 已在频道留档(22:03Z 两条)。

## 软失效方案(UPDATE 非 DELETE)——采纳我设计审 should-note 后的实现, 核实正确

`SET event_type='pool_oracle_tx_sig_superseded'`——grep 全仓`event_type\s*(=|LIKE|IN).*pool_oracle_tx_sig`确认所有消费者(voter.js:552/557/590, pool.js:3183, pool-market-settler.js:910/1137/2852, trade-protocol-filter.js:563)全部是**精确 `=` 或 `IN(...)`字面量匹配**, 没有任何`LIKE 'pool_oracle_tx_sig%'`前缀匹配——改名后这 5 行不会被任何现有查询意外命中, 双解锁(first-wins + voter 幂等)确实生效, 同时物理行保留, 比硬删除对我原来那条"UI 时间线留洞"关切更友好(以后想恢复展示只需把消费者查询扩成`IN('pool_oracle_tx_sig','pool_oracle_tx_sig_superseded')`, 硬删除做不到这点)。

## 我自主追查一条: "孤儿签名自愈重放"会不会把陈签名复活(设计稿/手术单都没提到, 独立想到并查证)

`pool-market-settler.js:904-912`有一段"orphan sign_resp ingest"自愈扫描——从`broadcast_messages`里找含`kanet_pool_oracle_tx_sign_resp_v1`且**当前 txid 不在**`chain_events WHERE event_type='pool_oracle_tx_sig'`里的记录, 重放进 ingest。**这正是一个"改名后可能被绕开"的资产**: 如果这 5 个 txid 在`broadcast_messages`里还有原始记录, 改名后它们的 txid 就不再出现在`event_type='pool_oracle_tx_sig'`的子查询结果里, 这段自愈逻辑会误判成"孤儿", 把陈签名**重新灌回**`chain_events`(全新行, `event_type='pool_oracle_tx_sig'`, 绕开改名), 手术等于白做且悄悄发生不会报错。**独立查证**: 5 个 txid(`pool_oracle_tx_sig:8f104e2d:...`等自定义格式, 非链上真 txid)逐个在`broadcast_messages`查`tx_hash=?`, **全部无命中**——这 5 行当初不是经这条 broadcast-replay 路径落库的(可能是直接 IPC sign_resp handler 写入, 未曾过 broadcast_messages), 这条自愈路径对本次手术**不构成风险**, 已排除, 不需要手术单额外加防护步骤。

## 硬前置核对(手术单自己列的两条未勾选项)

- `[ ] Owner 签发` —— 正确留白, 本审不越权替 Owner 签。
- `[ ] canonical console 已装载 d060e872+b862c6e0` —— **这条判断是对的且必须执行前二次确认**, 直接复用今晚 gate A 撞过的"committed≠deployed"教训(pool.js 类似, `trade-protocol-filter.js`/`bettor-prediction-voter.js`同样是长驻 console 进程 import 的模块, 不重启不生效)。执行时这条不能只看"git log 有没有这个 commit", 必须实测(比如临时构造一次假 sign_req 走一遍 handler, 或者干脆核 console 进程启动时间晚于两个 commit 落地时间)。

## Verdict

**GREEN。** 手术单三项前置(selector/locality/signer)双人独立复算吻合, 软失效方案落地正确且优于原设计(硬删除)的 UI 可追溯性取舍, 我自主追查的"孤儿自愈重放"风险已查证排除, "committed≠deployed"前置判断到位。剩下唯二未完成项(Owner 签发 + canonical 装载确认)都不是设计/代码缺陷, 是执行流程本身的门, 可以提交 Owner 签发。

## 更正(2026-07-18 22:1x, 撤回"风险已排除"结论)

上面§"孤儿签名自愈重放"一节的排除结论**方法有误, 撤回**: 我当时用`chain_events.txid`(形如`pool_oracle_tx_sig:8f104e2d:...`的合成字符串)去匹配`broadcast_messages.tx_hash`(真链上 hash)——两个完全不同的 id 空间, 查询本身查不出任何东西不代表风险不存在, 是我的关联键选错了。

Bettor 独立查证给出不同结果(21 笔 jepu1 相关 + 59 笔 f9e64afc 相关 `broadcast_messages`命中), 判定这条自愈重放路径**真实存在风险**, 拦下手术单不放行(Gate-B)。我用`content LIKE`方式重查(改正方法论), 精确匹配`kanet_pool_oracle_tx_sign_resp_v1`+jepu1+channel=kanet-prediction 得 0 命中, 放宽到`pool_oracle_tx_sig`子串(不限 channel)得 22 条(抽查内容显示这 22 条几乎全是`dev-coord-testnet`频道今晚/6-28 的团队对话消息, 因为该协调频道本身也经`broadcast_messages`存储, 不是协议层 sign_resp payload)——但**这个新查法本身可能也有系统性盲区**: 该表存在`pool_market_chunk_v1`分片包裹机制(单条消息最多拆 20 片), 单行`content LIKE`搜索可能因为目标字符串跨分片边界被切断而漏检, 我不确定这是否解释了 Bettor 21/59 命中的真实来源、也不确定这是否是`orphan sign_resp ingest`(pool-market-settler.js:904-912)实际读取路径会踩中的形态。

**结论**: 本文档原"风险已排除"的说法方法论确实有误, 已在频道向 Bettor 认错; 暂时把整篇 verdict 降级为待核实。

## 最终收敛(2026-07-18 22:1x, Gate-B 由 Bettor 精确复算清零, 恢复 GREEN)

Bettor 用改名后的真实 orphan-ingest 查询原样精确模拟(筛`kanet_pool_oracle_tx_sign_resp_v1`, sign_RESP 专指, 非宽泛子串)——jepu1 命中 **0 笔**, 改名后重放量 **0/0, 零复活**, 撤回了 Gate-B 的假警报。Bettor 自认此前"21 笔"命中是宽匹配`%pool_oracle_tx_sig%`把`kanet_pool_oracle_tx_sign_req_v1`(REQ, 请求, 不是签名响应)也算了进去, over-count。两人各自独立的两轮查证(我的"方法错→改正后 0 命中"+ Bettor 的"宽匹配假警报→精确复算 0 命中")最终**收敛到同一个结论: 孤儿自愈重放对这 5 行不构成风险**, 不是巧合, 是两条独立路径分别纠错后到达同一个真值。

**Gate-A(canonical console 需重启装载 d060e872+b862c6e0)仍然是真实、未清除的前置**——Bettor 实测活着的 console 进程(PID 24696)起于 20:41, 早于两个 sign-fix commit(21:03/21:30), 现进程跑的是修复前代码, 重签前必须先走安全重启装载新码(手术单§0 已明确列出这条, 不是本次新发现)。

**整篇 verdict 恢复 GREEN**: selector/locality/signer 三项双人独立复算吻合, 软失效方案(UPDATE 非 DELETE)正确, 孤儿自愈重放风险最终坐实为零(经过一轮真实的双向纠错, 不是草率认定), "committed≠deployed"前置判断到位且待执行前二次确认。可以提交 Owner 签发, 执行顺序: ①console 安全重启装载两个 commit(Gate-B 已清、Gate-A 待清)→②手术单§1-§3 按序执行。

## 实际执行结果(2026-07-18 04:57, 前置审查有效但落地失败, 记录真实状态而非假装"审完=成功")

Owner 授权后, ①console 重启装载 sign-fix ②手术§1-3 执行(5 行陈签名转 superseded, 断言全过)③自然 re-broadcast 触发 5 委员重签, 全部落到 chain_events④三方(J1/我/J2)独立跑`verify-settle-sigs.mjs`逐字节 sighash 一致、5 笔委员签名 schnorr-verify 全 PASS——**到这一步为止, 本文档前面的所有审查结论都站得住, 没有一步是错的**。

但⑤清 backoff 冻结后, daemon 实际 submit → **node 拒绝, 错误与修复前完全一致**(`f9e64afc...script ran, but verification failed`)。排查排除了两个红鲱鱼(daemon 没用缓存老签名/新签名确实进了 submit 组装; txid 不变是 Kaspa 类 segwit 设计的预期行为, 不是"用了老签名"的证据, 这两条我都独立实测验证过), 但**没有排除"我们的验证器(verify-settle-sigs.mjs)与实际提交路径共享同一个可能有细微偏差的 sighash 派生逻辑, 二者自洽但都偏离 covenant 脚本 OP_CHECKSIG 运行时真正使用的 sighash"这条最危险的假设**——Bettor 精确点出这是条件5 本该防住但没完全防住的那种 vacuous-verification 风险。

**最终状态**: jepu1 今晚**没有结算**, **188KAS 没有移动**(NO TX NO STATE CHANGE 原则成立, 节点拒绝=状态零改变), daemon 已重新进入 backoff, 不会无限重试烧钱路资源。诊断转入 J1 的深 sighash 域(covenant 脚本运行时 sighash vs 通用交易级 sighash 是否存在细微差异), 今晚不再推进, 不因为"已经审了好几轮"而在最后一步硬赶。这是"前置审查全部正确+最后一步真实卡住"的诚实记录, 不是本文档任何一处审查结论的推翻。

— NWT 2026-07-18
