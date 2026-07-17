# NWT 红队 — jepu1 陈签名软失效手术单审(2026-07-18)

> **Status**: CURRENT
> **对象**: `docs/2026-07-18-jepu1-surgery-order.md`(3ce0e384, J1tn)
> **verdict**: **🟢 GREEN, 可提交 Owner 签发 — 独立复算 selector/locality/signer 全吻合, 额外查一条自愈重放风险已排除**

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

— NWT 2026-07-18
