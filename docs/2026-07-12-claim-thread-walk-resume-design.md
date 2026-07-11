# claim 线程 thread-walk resume 设计(半页)— 桶A 第二层根治

> **Status**: CURRENT(设计稿·待 NWT 红队 + Bettor 审;落码前不动代码)
> **作者**: J2 · 2026-07-12 · 卡: Bettor #gxk1l7 GRANTED(a4343"输入级链证"产品化,排 9gzf1 收官后)
> **背景**: 合卡 Fix-A 后 19/22 桶A 盘推断全中→resume→claim 步全撞 `UTXO not found`(fail-loud 零钱动)。
> 根因 = claim_txid 零持久化老账(7/10 已知)显形:当年部分 claim 落链 DB 没记 → `settle_evidence.winner_details`
> **空** → replay 从 `closeTxid:0` 起跳 → 该 outpoint 已被未记录的 claim#1 花掉。

## 1. 关键发现:thread-walk 已存在,只是被门死(查资产结论)

`bshard-auto-settler.mjs:443-483` **"#DB-lag 自愈"探测就是 thread-walk 本体**(2026-07-06 lv3rz claim#22 +
dyljb 两连假阴性实战收编,v2 含两处实测修正):确定性状态转移(pool-=payout + w-bitmap set bit,:461-465,
与 claim 循环 :507-511 同一转移函数)→ 编译下一 continuation 候选地址 → **kaspa_tx_log.outputs_json 历史查**
(:470,不受"后续已花"影响,dyljb 修正)+ live UTXO 兜底(:473)→ 命中即纳入 replay 前进一步。

**但整块在 `if (priorWinnerDetails.length)`(:420)之内** ——桶A 22 盘 winner_details 全空 → 探测永不运行,
replay 起点停在 `closeTxid:0`(:396)→ 必撞已花。**∴ 本卡 = 把已实战验证的探测泛化,非新造 walker。**

## 2. 修法(三改一断言)

1. **un-gate**:探测块移出 `if (priorWinnerDetails.length)` ——resume 场景(close_txid 在)一律先探测,
   空 details 从位置 0 起走(起点 `closeTxid:0` + 零 bitmap 已是现状初始化 :396-400,零改)。
2. **步数上限**:`MAX_PROBE_STEPS=10` → `claimData.length`(≤1024 结构上限;实际桶A 最多 26)。
3. **终点判定(Bettor 必答①)**:既有 `curLive → break`(:458-459)= 当前活 continuation 即续跑点,保留;
   **补终局分支**:探测走完全部 claimData(`priorWinnerDetails.length === claimData.length`)→ claim 循环
   自然零剩余 → `complete=true` → 既有 writeback(task#17)落 completed + 全量 winner_details——
   **"全部早已付清只是 DB 不知道"的盘一步转正**。
4. **防走错链(Bettor 必答③)**:既有断言保留(splice mismatch :513 / pk+amount 位置双校验 :427)+
   **新增**:`curLive` 命中时断言 live UTXO `amount == curPool`(链上余额 == 状态转移推演值,不等 =
   走错链/形状变 → STOP fail-closed 响亮报)。

**回填(Bettor 必答②)= 既有机制自动完成**:探测纳入的每步 push 进 `claims`(:478,txId=历史查获值),
下游 writeback 原样落 `settle_evidence.winner_details` ——零持久化历史账随首次成功 resume **顺手补平**,
每步已有 `DB-lag自愈` alert 留痕(:477),另加 events 审计(`claim_thread_recovered`,批量一条防刷屏)。

## 3. 边界与成本(诚实 scope)

- **kaspa_tx_log 缺口**:历史查不到且 live 也无 → 探测停(:476 既有 fail-closed),claim 循环照撞
  UTXO not found = 与今天行为同(不猜更远状态)。此类盘落"索引盲区"账,另案(块扫/归档查,非本卡)。
- **乱序历史 claim(Bettor 注1)**:若有人工/老代码**非顺序** claim 的盘,探测按单一候选序(leaf 序)走不到
  → fail-closed 停 = **第三类不救**。报数三桶禁混:**thread 恢复 / 索引盲区 / 乱序漂移**(F3 口径扩展);
  恢复计数=J2 自报 + KANet-UI 每小时数旁证**双源**,不靠感觉。
- **性能(Bettor 注2 阈值钉死)**:`outputs_json LIKE '%addr%'` = 全表扫,每步一次。**一次性成本**:首次
  成功恢复即回填,后续 tick 走快路;单 tick 最多 MAX_PER_TICK 盘 × 各 ≤26 步。**实测 >数十秒/盘 → 立索引
  优化卡**,不预先造。
- **不改**:claim 循环本体/writeback/状态转移函数全零触(探测复用同一转移代码);V2/ZK 零涉及。

## 4. 验收(DoD)

1. 单测(真函数 + fixture,windir-infer.test 同款风格):空 details + 链上已推进 k 步(tx_log fixture)→
   探测走到 k、claims 前 k 条 txId==fixture、断言 live amount==curPool;全付清盘 → complete=true 转正;
   tx_log 空 → 停在位置 0 与现状同;amount 断言不符 → STOP。
2. 实弹:装载后观察桶A——期望首个 tick 若干盘 `DB-lag自愈` 推进 + 部分盘直接 completed 转正;
   KANet-UI 每小时数 桶A 27 首次下降。**报数分级**(F3 口径):thread 恢复成功 / 剩余索引盲区盘数,禁宣全清。
3. Bettor 盲值:恢复盘的 winner_details Σ==当年 payout_root 承诺(逐盘 root 已由 Fix-A 链锚匹配过)。
