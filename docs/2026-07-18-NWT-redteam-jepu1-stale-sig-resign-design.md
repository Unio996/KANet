# NWT 红队 — jepu1 陈签名重签修复设计 v0.1 审(2026-07-18)

> **Status**: CURRENT
> **对象**: `docs/2026-07-18-jepu1-stale-sig-resign-design.md`(722c464e, J1tn)
> **verdict**: **🟡 GREEN-with-1-should-note(非阻塞, UI审计轨迹side-effect) — 根因链+第三站点发现+隔离性全部独立验证通过**

## 独立验证四条(读实际代码坐实, 非信设计稿自述)

**①c8188d98 范围确认**: `git show c8188d98 --stat` 只改一个文件`bettor-prediction-voter.js`(+38/-2)。新增`toSettleSafeJsonTxHex()`(39-67行)——rehydrate BigInt(lockTime/gas/input.sequence/utxo.amount/utxo.blockDaaScore/output.value)后走`new Transaction(parsed).serializeToSafeJSON()`, 两个调用点(`processPoolTxSign`:620/`handleTxSignReq`:1157)都改成`tx_hex:_safeTxHex, safe_json:true`。根因(commit message): relay 默认`new Transaction(JSON.parse(plain))`路径在新版 kaspa-wasm 下不能正确把`scriptPublicKey`注入 sighash, 委员算出的 sighash ≠ 节点校验的 sighash → validSigs<4。**设计稿对根因的转述准确, 没有走样。**

**②第三站点漏修坐实**: `trade-protocol-filter.js:handlePoolOracleTxSignReq`(495-613行), 571-575行确认原样是`tx_hex: JSON.stringify(phase2TxObj)`, 零 safe_json 转换——J1 的"新发现"是真实的, 不是编造或过度诠释。

**③first-wins/幂等双闸确认**: `pool-market-settler.js:2850-2854` SELECT 确实无 ORDER BY; `2870-2872`(以及重复出现的`3201-3213`)确认`seenByInput[inputIdx].has(signerKey) → continue`——先遇到的签名永久占位, 这正是设计稿说的"陈签名永远挡住新签名"机制, 核实无误。

**④(顶格 gating 关注)bshard/WC 盘隔离性——独立坐实为零共享, 今晚的 ajnid/85fit 不受影响**: `handlePoolOracleTxSignReq`只在`trade-protocol-filter.js`内部两处被调(106行广播分发/968行chunked重组), 唯一生产者是`pool-market-settler.js`的`dispatchPhase2`(2294行构造广播消息, 消息type `kanet_pool_oracle_tx_sign_req_v1`)。这条 tick loop 在**389行**有显式`isBshard`早退(`if (isBshard) { bshardSkipped++; continue; }`, 注释"bshard 盘的 settle/refund 由 bshard-settle-daemon 独家负责")。`bshard-settle-daemon.mjs`/`bshard-auto-settler.mjs`两个文件均**不 import** `trade-protocol-filter.js`(import 图确认)。bshard 侧签名走`bshard-close-voter.js`, 直接调用`sign_input_for_settle`, `safe_json:true`早已是硬编码常态(376/497行), 完全不经过`toSettleSafeJsonTxHex`这条即将改动的路径。**结论: step1 改`handlePoolOracleTxSignReq`不可能碰到今晚上线的 ajnid/85fit——路径结构性零共享, 不是概率性的"大概率不影响", 是代码结构上不可达。**（跟 J2 独立 grep+Bettor 的判断三方收敛同一结论, 已在频道同步。）

## 我自主发现的一点(非阻塞, 建议设计稿补一句)

**步2(DELETE 陈签名 5 行)会让`pool.js`两处只读消费者产生用户可见的行为变化, 设计稿没提到, 建议显式承认而不是留作意外**:
- `pool.js:3181-3185`——市场详情页"签名收集进度"计数器(`sigsCollected`), SELECT 同一个`event_type='pool_oracle_tx_sig'`。删掉这 5 行后, 这个计数器会**瞬间归零**, 直到步3 重签完成前, jepu1 详情页会显示"0/5 已签"而不是"5/5(签名坏但存在)"——这是预期内的临时状态(重签会补回), 但如果 Owner/用户在这个窗口刚好看一眼详情页, 会误读成"倒退"而不是"修复中", 建议 execute 时同步一条内部提示或至少心里有数, 不算 bug。
- `pool.js:3435-3439`(详情页 timeline, `ORDER BY observed_at ASC`渲染 chain_events 全量历史)——硬 DELETE 之后, jepu1 这 5 笔陈签名事件会从**用户可见的 timeline 上永久消失**(设计稿的"快照留档"是写进设计稿附录/审计文件, 不是重新灌回 UI 能读到的地方)。这不影响资金正确性(资金判定看的是 covenant/UTXO 不是这条 timeline), 纯粹是"这个市场发生过什么"的可追溯 UI 展示会留一个洞。**建议**(非阻塞, 落码时顺手考虑即可): 如果不想留 UI 洞, 可以考虑把"DELETE"换成"打一个`superseded_by`/`event_type`后缀标记"的软失效, 让 timeline 查询自然过滤掉陈签名但物理行还在, 两全; 如果团队认为"这几行历史 UI 可见性"不值得为此多绕一层, 直接硬删也可以接受(§2 步骤本身逻辑是对的, 不是安全问题, 只是可追溯性的取舍, 交给 J1/Bettor 定, 不构成 verdict 阻塞项)。

## J1 自提审读点回应

1. **步1字节级同款性**——设计稿明确写"把 helper 提到共享位置复用, 按 c8188d98 两站点逐字节同款处理", 这是正确的做法(单源复用而非重新实现同一段 BigInt rehydration 逻辑), 落码时我会核实际 diff 是不是真复用了同一个函数(而不是抄一份新的), 这条留给 diff 审。
2. **删行影响面**——见上面我自主发现的一点, 两处消费者都是只读展示, 无资金判定读这张表, 影响面在"可追溯性 UI", 不在"钱路正确性"。
3. **re-broadcast backoff 时序**——设计稿优先选"自然 re-broadcast 触发, 零脚本"这条路, 合理(减少一次性脚本的出错面); 落码/执行时把 backoff 窗口的实际等待时长写进执行记录, 万一等太久再退回 one-shot 脚本, 这条设计已经留了退路, 没意见。
4. **§4-4 新盘回归**——见上面④, 已经独立坐实路径结构性隔离, 不需要额外写 regression case 证明"WC 盘签名仍验过"(因为 WC 盘根本不走这条 handler, 没有"验过"这回事可言, 是完全不同的函数)。

## Verdict

**GREEN-with-1-should-note。** 根因链三方独立坐实(数据/读码/结构), 第三签名站点是真实发现不是过度诠释, 对今晚刚上线的 ajnid/85fit **结构性零风险**(不是概率性判断)。步2 硬删除会在两处只读 UI 展示上留一个可追溯性的小洞, 不影响资金判定正确性, 建议 J1/Bettor 权衡要不要顺手改成软失效, 不构成阻塞。可以按设计稿 §4 硬 gate 顺序推进: 步1 diff 审 → §4-0 locality SQL → 手术单过目 → Owner/Bettor 签发。

## 补注(v1.1, 5f950545)

设计稿升到 v1.1 后新增 §1.5(把上面④的三方独立坐实证据正式折进稿子)+§1.6(第四候选站点`bettor-prediction-settler.js:618-631`, 未定性、明确不塞进本案、单独立卡)——两处都只是把已经验证过的结论/纪律写实, 不改变本审的任何结论, 且§1.6 这种"发现了但先记录不抢跑"的克制是好纪律, 不需要我重审。verdict 维持不变。

— NWT 2026-07-18
