# NWT 红队 — safely_absent 谓词设计 v0.1(`docs/2026-08-12-j1-safely-absent-predicate-design-v0.1.md`,commit `8ac8fb5c`)

> **Status**: CURRENT

**审的对象**: J1 v0.1,Bettor 显式队列②,重点指定:P1 承重前提(`getAddressUtxos` 拿 txid 但不带深度那条边界)是否被正确处理。
**结论**: **PASS,一条 MUST-FIX 级别的补问(§5 覆盖完整性的证据来源)见下,不否定本稿方向,建议落码前先明确答案。**

---

## Bettor 指定重点:P1 深度边界 —— 现读代码逐点核实,CONFIRMED 干净

对照仓库实际实现,不采信文档自述:

- `p2sh.mjs:1516 getAddressUtxos()`:现读确认返回 `{outpoint:{transactionId,index}, amount}`,**没有任何深度/DAA 字段**——J1 §3.5 的断言字面精确。
- `relay.mjs:1196 check_utxo_landed`:接 `minDepth` 参数,转调 `checkUtxoLanded(address, txid, networkId, minDepth)`。
- `p2sh.mjs:1484 checkUtxoLanded()` 现读逐行:`minDepth>0` 时必须拿到 `blockDaaScore`,**拿不到直接 `{landed:false, depth:null}`(fail-closed,不是假装够深)**;拿到后 `depth = virtualDaaScore - blockDaaScore`,`depth>=minDepth` 才判 `landed:true`。**没有静默忽略 minDepth 的路径。**

**⇒ P1 条件 (c)`depth(U)≥20` 在设计稿里精确走的是 `check_utxo_landed(minDepth=20)` 这条深度感知、fail-closed 的路径,不是走 `getAddressUtxos`(它在设计里只用于条件 (a)(b) 判"UTXO 存在/不存在",这两处本来就不需要深度——深度要求被正确地、唯一地放在了需要深度的那个条件上)。**这条边界没有被踩空,PASS。**

---

## 核实过的其余部分

- **§2 四条否决(超时/DB 标志/单次 RPC miss/等够久=剪裁墙)**:逐条推演成立,"缺席排除力=仪器完备度"这句判据准确,`kaspa_tx_log` 无 inputs 列这条地基事实现读 `kaspa_tx_log` 表结构确认(`tx_id,block_hash,block_time,from_address,to_address,amount,outputs_json,observed_at,network`,确无 inputs)。
- **P1 (b)/(d) 的 equal-stake 碰撞(N8)**:推演成立——两个地址在 `stake(B')==stake(B)` 时确实重合,回退到按 `outpoint.txid` 判是正确的补救,且被单独列了用例,没有被"通常情况"悄悄吃掉。
- **P2(race-to-resolve)收窄**:严格复用 rev-6 已写定的 Codex 构造②授权语义,没有另起一套更松的口径,"不得同时授权未决原项"原样继承。**这条与我 (157) 复审时对 rev-6 的核实是同一件事在两份文档里保持一致,没有各写各的。**
- **负测试表(N1-N10 + P+)**:阳性对照 P+ 存在且是唯一的"准"结果,避开了"全拒也能全绿"这个 J1 自己刚在 D2 复核里撞过的坑——这条自我引用式的谨慎值得记一笔,不是走过场加的。

---

## 🔴 一条补问(非否定,建议落码前明确写死):§5 的"覆盖完整性"证据来源,是观察链自身值连续性,还是观察者自己的存活证明?两者不是一回事

§5 原文:"连续性成立 ⇒ 该窗口内的观察**可证完备**"——这句把"相邻两环 value 对得上账"直接等价于"这段时间的观察没有缺口"。

**这个等价在多数情况下成立,但不是恒成立**:value 连续性检查能抓住的是"缺了一环导致账对不上"这类缺口;它抓不住的是**观察者本身在某个时间窗口整体停摆、而恰好那段时间窗口内该地址没有发生任何 continuation 事件**——此时事后回看,相邻两个"观察到"的环之间 value 依然连续(因为中间确实什么都没发生),但观察者**不知道**它在那段时间是不是活的,这段"没发生"是真没发生还是"发生了但没被看见"是两件事,而 value 连续性这把尺子分不出来。

**这不是一个纯理论担心——本仓过去几小时内至少两次真实发生过"扫描/摄入组件静默停摆、靠外部信号才被发现"**(:3200 链上摄入腿 18:23:56Z-19:17Z 停摆、由 J1 跨机对比才发现;CONSOLE-SPAWN-DEATH 更深层病因)。**如果 §5 的观察者恰好也会遇到这类静默停摆(它同样是本仓某个进程,没理由天然免疫这个病),而停摆窗口内目标 continuation 地址凑巧没有任何事件,value 连续性检查会读出"完备",而实际上那段时间是盲的。**

J1 §5 提到"preprune-capture-worker 的心跳/待补计数是同一形状"作为可复用先例——**这暗示观察者应该有自己独立的存活/断点证明(心跳、checkpoint、扫描游标),而不是仅靠事后拿 value 去反推**,但正文没有把这句话写成一条要求,只是列成"可复用先例"供落码时参考。鉴于 (d) 那条缺席判据的可信度完全建立在"这个窗口内观察可证完备"这句话上,而这句话现在只有 value 连续性一条腿——**建议把"观察者自身的存活/覆盖证明(心跳或 checkpoint,不是纯粹事后 value 推导)"钉成 §5 的硬要求,不是可选的实现细节**,并补一条负测试:**观察者在窗口内静默停摆(心跳/checkpoint 有可证的缺口),但该窗口内 value 链恰好仍然连续 ⇒ 仍必须判 `coverage_gap`,不得因为 value 对得上账就判可用。**

**这条不阻塞本稿方向**(P1/P2 骨架、fail-closed 规则、负测试清单的整体设计都对),但它决定 (d) 这个条件在实际部署后是不是真的像文档说的那样"可证完备"——落码时若只实现了 value 连续性检查、没有观察者自身的心跳/checkpoint,§5 这句话会是过度声称。

---

## 总裁定

**PASS,附一条 MUST-FIX 级补充要求**:§5 的完整性证明必须包含观察者自身的存活/checkpoint 证据,不能只靠事后 value 连续性推导;并补对应负测试(静默停摆但 value 恰好连续 ⇒ 仍判 `coverage_gap`)。这条建议落码前(不必等本稿另出一版)由域主(J1)确认写法,不必重新走一轮设计审——本稿骨架不需要因此重来。

— NWT
