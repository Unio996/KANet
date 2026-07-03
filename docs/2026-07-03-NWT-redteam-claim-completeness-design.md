# NWT 红队审 — bshard claim-completeness 正确性设计（J2 2026-07-03 稿）

> 审对象：`docs/2026-07-03-bshard-claim-completeness-and-retry-design.md`（J2 v2 修订版，14:32 已按 Bettor 4 必改+2 风险改完）。
> 裁决：**CONDITIONAL GO — 2 BLOCKING + 2 非阻塞加固**，落码前必须在设计里补齐 BLOCKING 两条，否则重试机制本身会引入跟本 bug 同族的新洞。

## 我打了什么、为什么大部分没打穿

- **completed 判定谓词本身（§4.1）**：试图找"claims.length===plan.winners.length 且全 received 且无 error"这个新谓词的漏洞——没找到。它精确对应 bshard-auto-settler.mjs:206-237 实际的 5 条丢单路径（读码逐行核对，行号见下），谓词跟代码真实分支完全对齐，没有第 6 条隐藏丢单路径。
- **payoutRoot 循环取证（§2.2 必改-4）**：J2 已经自己抓出并修了（DB `settle_evidence.payout_root` 拿自己当锚 = 循环论证），我想不出比"链上 close witness root 二次确认"更强的锚，PASS。
- **幂等谓词假阴性/假阳性（§4.2 必改-2）**：J2 已经想到"winner 花掉钱后 UTXO 消失→误判未领"和"别处收到同额撞车→误判已领"两个方向，PASS，我加不出第三个方向的谓词漏洞。
- **refund vs sweep 语义混淆（§4.3 必改-3）**：这条本身是本设计最强的一条，我试图找"unclaimed-winner sweep 是否会反过来被 refund 语义污染"——没找到，两条路径在设计里已经清楚拆开（pre-verdict CLTV refund vs post-close sweep），管辖权不重叠。

## 🔴 BLOCKING-1：重试续接点(resume state)的来源没写死，会重蹈本 bug 的同一类错误

**读码实证**（`bshard-auto-settler.mjs:199-237`）：`settleMarketLive` 的 claim 循环里，`psOutTxid`/`curState`/`curPool`/`curRedeem`（下一笔 claim 要花的 continuation UTXO + 其嵌入状态）**只在一笔 claim 完全成功后才前进**（L236：`psOutTxid = claimTx; psOutIdx = 1; curPool = curPool - BigInt(cd.amount); curState = newState; curRedeem = contRedeem;`）。任何一条丢单路径（climb-fail/round-trip-fail continue，或 submit-fail/not-landed/splice-mismatch break）都不推进这四个变量。

这意味着：**重试要给某个 winner 建新的 claim TX，必须先知道"当前实际未花费的 continuation UTXO 在哪、它的脚本里嵌了什么 state"**——这四个变量目前只活在 `settleMarketLive` 一次调用的函数栈里，从没持久化。设计 §4.2 只定义了"逐 winner 是否已到账"的幂等判定，**完全没说重试第一步——重建 curState/curRedeem/psOutTxid——的数据来源是哪里**。

这是本设计的命门：如果实现时图省事，从 `settle_evidence.claims[]` 里推最后一条成功记录的 `txId` 当 `psOutTxid`、从 DB 里回放 `curState`，就是让重试机制信任"DB 记录 == 链上真相"——这正是本次 bug 的病根（`completed` 从来没跟链上状态断言过等价）。如果 DB 记录本身因为某种未知原因跟链上实际状态错位（哪怕只是理论可能性，本设计存在的理由就是"DB 记录不可信直到链验"），重试建出来的 TX 会拿错误的 `redeem_hex`/`consolidated_pool`/`w-bitmap` 去花一个可能已经不存在或状态不符的 UTXO——轻则花费失败（fail-closed，浪费一轮），重则如果错误地"凑巧"匹配到另一个有效但语义错误的历史状态（如本该 17 个 word 槽的 bitmap 因为跳过某笔而对不上），可能重复支付或漏记哪些 winner 已被 word-bit 标记。

**修法**：重试第一步必须显式写成——**从链上读该 payout shard 当前实际未花费的 continuation UTXO（沿 close_attest 起点顺着每笔 claim 的 index-1 输出走到 tip），直接从这个 UTXO 的脚本字节解出 consolidated_pool/w-bitmap/payoutRoot/closed，重建 curState/curRedeem**，不经过 DB 的 `claims[]`/`settle_evidence` 中间层。**这不是从零造能力**：`kasia-console/src/services/pool-market-settler.js` ~L1128-1133 已经有同族先例（"查 `kaspa_tx_log` 是否有 TX spend 某 P2SH UTXO，按 outputs 数分流终态"），复用同一模式沿 continuation 链走即可，不算新发明。

## 🔴 BLOCKING-2：§4.3① refund-臂探针的执行方式本身有资金二次事故风险，且优先级排序有问题

设计原文："对一个 partial-claims 市场在 deadline 后尝试走 refund 臂，验证是否仍可花——预期应 BUST，如果发现仍可花，这是比漏付更大的独立攻击面，必须立即单独升级"。

这句话的风险在于：**这是一个真实构造+广播的花费尝试，不是纸面推演**。如果"预期 BUST"这个假设是错的（refund 臂真能在 close 后花），这个探针 TX 本身就会**真的执行那个漏洞**——把该市场 payout shard 里本该分给未领 winner 的钱，实际转到探针构造的输出地址去。设计目前没说：

1. **拿哪个市场做探针**——如果选中一个当前还有真实未领 winner（21 个 tier1/tier2 之一，或 60 个 clean_provisional 里其实有猫腻的）去做这个"实弹测试"，一旦假设错了，等于团队自己亲手把该盘的钱从合法 winner 手里转走，制造了一个新的、由测试动作直接导致的漏付案例——跟本设计要修的问题是同一种伤害，只是责任方从"bug"变成了"红队探针"。
2. **探针 TX 的输出地址给谁**——如果输出地址是团队自己可控的地址，一旦 BUST 假设错了，钱至少还能人工找回补给正确 winner；如果没有预先想清楚这一点、临时找个地址就发，等 assumption 崩了才想起来地址不受控，就是把资金主动送出去。
3. **任务优先级**——设计文档自己承认这"是比漏付更大的独立攻击面"，但 §6 NEXT 把它排在"J1 链上确认三合一"任务卡的第三条，位置上不比"21 盘逐 winner 链验"更急。**如果这条真的成立，就意味着此刻正有 81 个（21 tier1/tier2 + 60 clean_provisional）已 completed/partial 的市场存在一个任何人随时可以发起的真实攻击面**——这不是理论风险，是现在进行时。应该最先做（甚至比 21 盘核对更急），而不是排在同一批任务卡里顺序执行。

**修法**：探针改为——① 挑一个团队完全掌控全部押注方、且没有真实第三方 winner 在等钱的市场（比如专门造一个干净的一次性测试盘，不要用 21/60 里的任何一个真实盘）；② 探针 TX 的输出地址固定指向团队可控地址，成功与否都能人工处置；③ 把这一条从"J1 任务卡第 3 项"提到最优先，先确认这个攻击面是否成立，再决定 21 盘链验和 §4 落码的节奏（如果 refund 臂真的没堵死，81 个市场的处置方案会整体改变，没必要先做完 21 盘核对再发现地基有问题）。

## 🟡 非阻塞加固-1：idempotency 判定要显式说清"查完整续约链"，不是"查当前一环"

设计原文"查该 payout shard continuation outpoint 的花费记录"用词是单数。读码证实（同 BLOCKING-1 引用的循环逻辑）：continue 类丢单（climb-fail/round-trip-fail）会让某个 winner 被跳过、但后面的 winner 照常往下花——也就是说"谁被跳过、谁被支付了"这个信息**分布在从 close TX 起、沿着每一笔成功 claim 的 index-1 输出，一路走到当前 tip 的整条 TX 链上**，不是只看当前 tip 这一个 UTXO 的状态就能倒推出全部历史。落码时这句话要写成"walk 整条链，逐跳记录 index-0 输出地址+金额"，不能只查最新一环的 spend 记录就下"谁已领"的结论——虽然目前代码是严格顺序执行、中间环节都是真实成功记录、直接风险不大，但这份设计的第一性原则就是"不能信任任何一层缓存/推断，必须查链上真相"，续约链查询也不该有例外。

## 🟡 非阻塞加固-2：splice 一致性校验目前比对的是 relay 自报值，不是链上落地值

`bshard-auto-settler.mjs:231`：`ctx.p2shAddr(contRedeem) !== claimRes.psContAddress`——左边是本地重算的期望地址，右边是同一次 relay 调用**自己返回**的 `psContAddress`。这是"relay 说的" vs "relay 说的"自证，不是链上验证；relay 既是构造 TX 的一方也是这条校验的数据来源，同一个信任根。目前失败模式是 fail-closed（不匹配就 break，停止 threading，不是资金流失），所以不算 BLOCKING；但既然这次设计就是在补这条链路的完整性，建议同一批把这处也改成直接读链上落地的 continuation UTXO 脚本字节做比对，不经过 relay 自报的中间值，避免同一类"caller-fed 值当验证依据"的问题以后在别的边界条件下复发。

## 结论

设计文档的问题诊断、证据分级、必改 1-4、风险 1-2 全部站得住，我打不穿。**两条 BLOCKING 都在"§4.2/§4.3 怎么落码"这一层**——不是推翻方向，是重试机制本身如果不显式写死"续接点/已领名单只信链上真相"，会把本 bug 的病根原样复制进修复代码里。CONDITIONAL GO：BLOCKING-1/2 在 §4.2/§4.3 补齐文字后可以落码；BLOCKING-2 的探针优先级建议立即跟 J1/Bettor 对齐执行顺序，不必等设计文档整体定稿。
