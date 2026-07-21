# NWT 红队 — claim 线程 thread-walk resume 设计

> **Status**: CURRENT
> **对象**: docs/2026-07-12-claim-thread-walk-resume-design.md(J2)+ 既有探测 settler:443-483
> **verdict**: **GREEN-with-notes——探测每步链锚 fail-closed(我域核心过),复用实战代码非重造;H1 顺序依赖 scope 注明,H2 amount 断言我背书**

---

## 我读透了既有探测(不信设计转述,亲读 settler:388-524)

探测本体确如设计所述在 :443-483,被 `if (priorWinnerDetails.length)`(:420)门死。机制:每步编译 `claimData[priorWinnerDetails.length]` 的下一续约候选地址→kaspa_tx_log.outputs_json 历史查(:470,不受后续已花影响=dyljb 修正)+live 兜底→命中才 push 前进一步(:478-480)。**每步前进都要求候选地址在链上被观测过=链锚,查不到即停(:476 fail-closed)**。这是 verify-value-source 干净的:探测从不"猜"更远状态,只沿链上实证前进。

## H1 🟡 note(我域,recovery-limiter 非 correctness): 探测按 claimData 顺序重放,中间续约地址顺序依赖

**关键机制**:第 k 步续约地址 = P2SH(state: pool−Σ前k个payout, bitmap=前k个merkle_index的OR)。bitmap 是增量的——**第 k 步的地址编码"具体哪 k 个 winner 已 claim 且按什么顺序到第 k 步"**。探测假设链上 claim 线程按 `claimData` 顺序落链(claim#i==claimData[i])。

**为什么通常成立**:原始 claim 由 daemon 按 claimData 顺序提交(claim 循环 :486 idx 0..N),故链上线程序==claimData 序;claimData=winnerClaimData(plan.winners) 确定性,plan.winners 来自 getMarketBets+computePariMutuelPayout。**只要 getMarketBets 行序 + plan 稳定(与原始 claim 时一致),序稳定→探测逐步匹配**。22 盘未变→通常成立。

**何时限流(fail-closed 安全)**:若 plan.winners 序在原始 claim 后漂移(F3 族:bettor 集/排除逻辑演进/getMarketBets 排序变),今日 claimData 序 ≠ 链上线程序→第一步 nextAddr 就查不到→探测停→partial recovery。**DoD Bettor 盲值(winner_details Σ==payout_root)是 SET/root 校验,顺序漂移导致的早停它抓不到**(盘只是停在 partial,不会误付)。∴ 建议设计 §3 边界补一句:recovery 除"索引盲区"外,还有"claimData 序漂移"这一 partial 成因,同 F3 族 fail-closed,报数"thread 恢复成功/剩余(索引盲区+序漂移)盘数"。非 bug(每步链锚,漂移只是早停),纯 scope。

## H2 🟢 背书(必答③的 amount 断言=verify-value-source 真加固)

设计新增"curLive 命中时断言 live UTXO amount == curPool"——我背书,这补的正是既有探测的一个隐性 gap:原码 :458 `curLive→break` 只看"有没有 live UTXO",**不核 live UTXO 的余额是否==推演的 curPool**。没这断言,若探测沿某条 kaspa_tx_log 巧合匹配的路径走到一个 live tip,curPool 可能与链上实际余额不符却照续跑。amount==curPool 断言把"找到 tip"升级为"找到 tip 且其链上余额==我推演的剩余池"=状态转移的链上闭环校验。**这是钱路续跑点的 verify-value-source 硬门,该加。** 落码时核:断言在 curLive 分支内、不等 STOP fail-closed 响亮报(非 warn-continue)。

## 其余核点(全过)

- **un-gate 安全**:探测块移出 :420 门后,空 details 走 closeTxid:0 起点(:396-400 现状初始化,零改);:454 条件 `priorWinnerDetails.length < claimData.length` 对空 details(0<N)成立=探测运行。curRedeem/curState 在 :420 前已初始化,空路径可用。✅
- **终点 complete 转正**:探测走完全 claimData→priorWinnerDetails.length===claimData.length→循环 :486 全 skip→claims 全 received=true→complete=true(:521)→writeback completed。"全早付清 DB 不知道"盘一步转正,且每步 push 的 txId 是 kaspa_tx_log 链锚值=complete 是链证非空转。✅ 终点不会误判(loop 在 priorWinnerDetails.length===claimData.length 时退出,不碰 seed 残差续约)。
- **无 false-positive**:续约地址是 (poolMerkleRoot,predicateCommit,pool,payoutRoot,bitmap) 的 P2SH,跨市场碰撞需同 poolMerkleRoot/predicateCommit=不可行;LIKE '%addr%' 60+字符 bech32 子串碰撞天文级不计。✅
- **MAX_PROBE_STEPS→claimData.length**:真实界=`priorWinnerDetails.length<claimData.length` 第二条件,每步 :479 递增必终止,无死循环。✅
- **零改承重**:claim 循环本体/writeback/状态转移函数零触,探测复用同一 splicePayoutContinuation+bitmap 转移(与 claim 循环 :507-511 逐字同),V2/ZK 零涉及。✅

## 结论

设计复用 lv3rz/dyljb 实战收编的探测(查资产模范,非重造),un-gate+步数上限+终点转正+amount 断言全部我独立核过。**探测每步链锚 fail-closed=我域 verify-value-source 核心干净**。H1 顺序依赖是 recovery-limiter(fail-closed 安全,scope 报数)非 correctness bug;H2 amount 断言我背书(钱路续跑点硬门)。**GREEN——H1 补 scope 一句、H2 落码核断言 STOP 语义,即可落码 GO**。落码 diff 到我复审(un-gate 位置/amount 断言 STOP 非 warn/complete 谓词链锚/单测覆盖序漂移早停 fixture)。

— NWT 2026-07-12
