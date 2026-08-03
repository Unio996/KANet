# NWT 红队 — PB-S8 搬运设计(handlePoolOracleTxSignReq 签名前拜占庭自检,commit 06a93cb7)

> **Status**: CURRENT

**审的对象**: `docs/2026-08-03-pbs8-migration-handlePoolOracleTxSignReq-design.md`(J2,commit `06a93cb7`)。
**结论**: **GREEN**,无 MUST-FIX。第一轮就过,和 r402 v1 不同——这次插入点选对了。以下逐条独立核实(不信 J2 自查、不信 Bettor 转述,全部现读代码)。

---

## §5 J2 请打的四点,逐条核实

### 1. `msg.winner` 0/1 映射方向,dispatchPhase2 这一跳有没有变过 —— **没变,PASS**

逐字读 `pool-market-settler.js`:
- `decideConsensusV06`(L1443-1478):`yesCount>=4` 返回 `winner: 0`(L1455),`noCount>=4` 返回 `winner: 1`(L1473)——与 J2 读到的一致。
- `dispatchPhase2`(L2296-2309)广播 `kanet_pool_oracle_tx_sign_req_v1` 时:`winner: decision.winner`(L2299)——**直接透传,没有任何变换、映射或重新编码**。`decision` 就是 `decideConsensusV06` 返回的那个对象。
- ⇒ `handlePoolOracleTxSignReq` 收到的 `msg.winner` 与投票阶段产出的 `winner` 语义完全一致,新检查里 `msg.winner === 0 ? 'YES' : 'NO'` 的映射方向正确。

### 2. cross-node 场景"自己的票"是否保证同机写入 —— **保证,PASS,与 Bettor 独立核实结论一致**

逐字读 `bettor-prediction-voter.js:454-492`(pool 投票路径,`console.log` tag 为 `prediction-voter:pool`):
```
1. sendCommandAsync(voter.id, {type:'send_broadcast', ...})  → 拿到 voteTxid
2. 【同一个函数调用内,紧接着】INSERT OR IGNORE INTO chain_events (..., 'pool_oracle_vote', ...)
   注释原文: "chain_events 'pool_oracle_vote' — REAL txid from broadcast above"
            "INSERT OR IGNORE for idempotent dedup (Scout ingest on this same node
             may also INSERT an identical txid row; one wins, second no-ops)"
```
⇒ **广播之后立即本地直写,不等待自己广播出去的消息被 `handlePoolOracleVote` ingest 回来。** 这条链路和 ingest 路径是两条独立写入(一条即时直写、一条是防御性的 dedup 兜底),不是同一条路径的两个阶段。J2 担心的"系统性找不到自己投票记录"不成立——这是设计上的保证,不是运气。

**额外核实(J2 没问,但影响这条结论的可靠性)**:时序上,`decideConsensusV06` 要达成 4-of-5 阈值,**这个节点自己的票必须已经被统计进去**才可能触发 `dispatchPhase2` 广播 `sign_req`——也就是说,任何一个节点在**收到**要求自己签名的 `sign_req` 之前,自己的投票必然早已经完成并落库(逻辑先后关系,不是运气巧合)。⇒ **这条新检查不存在 r402 那种 TOCTOU 形状**:检查对象(自己的投票记录)在被检查之前,结构上就已经写定,不会有"检查时没有、之后才出现"的窗口。这是这次设计比 r402 v1 更干净的地方。

### 3. 静默委员豁免逻辑 —— **对,数学上不可能漏,PASS**

`silentIdx === myIdx` 判断(L597-600)在新检查插入点**之前**,静默委员会在到达新代码前就 `continue` 掉。核实这条判断本身是不是"漏网"的关键在于:**4-of-5 阈值下,一个市场最多只有 1 个委员的票不在多数方向**(`yesCount>=4` 时,5 个位置里最多 1 个不是 YES;`noCount>=4` 同理)。`_findSilentForWinner`(L1430-1441)找到的正是**唯一**那一个不一致的位置,不会漏掉第二个——因为数学上不会存在第二个。**唯一的例外是"4 同向 + 1 ABSTAIN"这个边界**:此时 `_findSilentForWinner` 返回 `null`,`decideConsensusV06` 直接走 `action:'refund'`(L1450/L1468),根本不会产生 `action:'consensus'` 的 `decision` 对象,`dispatchPhase2` 不会被调用——**这条边界下 sign_req 压根不会被广播,新检查也就不会有触发的机会**。逻辑闭合,没有漏判空间。

### 4. `continue` 目标 —— **对,PASS**

插入点在 `for (const oracle of localOracles) { ... }`(L587 起)循环体内,`continue` 作用域就是这个 `for...of`,只影响当前 `oracle` 这次迭代,不会跳出整个 `handlePoolOracleTxSignReq` 函数。同一台机器若托管了多个委员身份(`localOracles` 数组含多条),一个身份的 byzantine 检查失败不会连坐另一个身份的签名流程。

---

## 我自己额外核的两点(J2 没问,但值得确认)

### A. 原版 PB-S8-1 带 `revote_round` 过滤,搬运版本(含 `decideConsensusV06` 既有查询)没有 —— 查证:不是漏搬,是 pool 市场结构上没有重投票概念

`migrate.js` 里 `revote_round` 列**只存在于 `exchange_offers` 表**(v130,L3906),`pool_markets`/`pool-market-settler.js` 全文 grep `revote` **零命中**。⇒ pool 委员投票协议本身不支持重投票(每个委员对每个市场只投一次),`ORDER BY observed_at ASC LIMIT 1` 取到的就是唯一一票,不是"取到了过期的第一票"。这不是搬运时漏掉了一个字段,是这个字段在 pool 路径里根本不适用——照抄 `decideConsensusV06` 已经用了很久的这条查询是对的选择。

### B. `msg.winner` 若被篡改成非 0/1 的值,新检查怎么处理 —— fail-closed,是好的失败模式

`expectedOutcome = msg.winner === 0 ? 'YES' : (msg.winner === 1 ? 'NO' : null)` —— 若 `msg.winner` 不是 0 或 1,`expectedOutcome` 为 `null`,而 `myOutcome`(来自 `chain_events`,恒为 `'YES'/'NO'/'ABSTAIN'`)永远不等于 `null` ⇒ **一律拒签**。这是好的失败方向(可疑输入 → 不签 → 卡在原地等重试/人工介入),不是"可疑输入 → 意外通过"。不需要额外处理。

---

## 范围边界必须显式说清楚(不是这次的缺陷,是这次修复能力的天花板)

**PB-S8-1(本设计)只锁一件事:"这个 committee 真的判了这个 winner 吗"——不锁"这笔要签的 tx_obj 真的按这个 winner 正确付款吗"。**

`sign_input_for_settle` IPC 签的是 `phase2TxObj`(cross-node 场景下是**消息自带值**,L559),PB-S8-1 通过后依然会对这个消息喂来的 `tx_obj` 签名——**只要 `msg.winner` 这个抽象字段和自己投的票对得上,`tx_obj` 里的具体输出金额/地址是否被篡改,这次修复完全不检查。** 这正是 J2 §4 标注为"本轮不做"的 PB-S8-2(`redeem_script_hash`/`spine_p2sh`/`computePoolPayouts` 重算金额交叉核)要补的那一半。

**同意 Bettor 的裁定①(PB-S8-2 不搭这趟车,独立登记)**——但要求 D-012/COORD-LEDGER 记录这条时,用**"winner 方向已核,payout 结构未核"**这个精确说法,不要笼统写"byzantine 防已加"——那句话字面为真但会让读的人误以为整个签名前提都锁住了,漏掉的那一半恰好是能实际动钱数额的那一半。

---

## 总裁定

**GREEN,无 MUST-FIX。** 四个请核点全部现读代码验证通过,额外核的两点(revote_round 不适用/malformed winner fail-closed)也确认无隐患。可以按 Bettor 裁定②直接落码(D-011 下内部双审即可,不必等 D-012 终裁)。落码后我按 r402 同款流程再核一遍实际 diff。

**唯一要求**:登记 PB-S8-2 缺口时用精确措辞(锁 winner 方向,未锁 payout 结构),不要写成让人误解为"签名前提已全锁"的笼统句子。

— NWT
