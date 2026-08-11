# safely_absent 谓词设计 **v0.2** —— 它不是等出来的,是**做出来或算出来**的

> **v0.2 变更**(2026-08-12,收 @NWT PASS-with-MUST-FIX + Codex `90215dfd`):
> §5「观察链完备性」由**自洽性**升为**覆盖性**硬前置(五条,DAA 锚)· §8 新增 N11/N12/N13 ·
> §9 把 round-trip 从「留白」升为 **MUST-PASS**(不符则禁用 P1)· P2 授权补 approver 身份/角色 ·
> 明确「规范进展 ≠ 运行时闭合」。

> **Status**: CURRENT

**作者** J1tn · **日期** 2026-08-12 · **派工** @Bettor (163)「safely_absent 谓词设计派 @J1(rev-5 留白件)」
**上游** Codex `d5e43f91` §2 + 验收 1./7. · NWT rev-5 红队 · rev-6 `2fa9ab84`
**本机 HEAD** `4dec44cd` · **边界**:设计 + 判据 + 负测试清单,**不落码**(码归域主)

---

## 1. 一句话结论

**`broadcast_pending → safely_absent` 不可能由「等」建立。**
本仓的仪器下,任何以「查不到 / 超时 / 没再出现」为形状的判据都**结构性不合格**;
这条转移只有两条合法来源:**(P1) 正向算出来**(用 continuation 地址里编码的 state),
或 **(P2) 主动做出来**(授权的冲突交易)。**两条都不成立 ⇒ 停在 `unresolved`,fail-closed。**

## 2. 为什么被动等待不合格(逐条打掉,含 Codex 负面清单之外的两条)

| 候选判据 | 为什么不合格 |
|---|---|
| 超时 / DB 的 attempted 标志 / 单次 RPC miss / 操作员断言 | Codex `d5e43f91` §2 已判死,原样采纳 |
| 「T 的 txid 不在本机块索引里」 | 🔴 **`kaspa_tx_log` 有覆盖缺口**,零命中的排除力 = 索引完整度。本机 18,627 行,而同一时间窗别的节点能差几个数量级 |
| 「pool 地址上没有 T 创建的 UTXO」 | 🔴 **假阳性**:T 确认过、其 continuation 已被下一笔花掉 ⇒ 读数与「T 从未确认」完全相同 |
| 「等够久了,链上没有它」 | 🔴 **剪裁墙**:超过剪裁窗(≈4 天)历史归属**物理上拿不到**,越等越不可判,不是越等越确定 |

🔨 判据:**这四条的共同形状是「用缺席证明不可能」**,而缺席的排除力等于仪器的完备性。
**`safely_absent` 是授权性转移**(它准许同一笔经济项被重新授权)⇒ 只接受**正向证据**。

## 3. 地面事实(现读,带坐标,不是回忆)

1. `pool-refund-builder.mjs:7` — 每笔 refund 重建 continuation:**value = pool_value − stake**,并把 `closed=2` 拍上。
2. 🔴 `kasia-relay/src/lib/p2sh.mjs:2804` — continuation 地址 =
   `_continuationAddress(redeem_hex, _serializeRootStateHex(state), networkId)`
   ⇒ **地址把 state 编进去了**;`pool_value` 一变,地址就变。
   (⚠ `pool-refund-builder.mjs:7` 头注释写「SAME address (template P2SH, state-excluded)」——
   那说的是**模板**同,不是地址同。**两处读起来打架,以 p2sh.mjs 的实现为准**;建议顺手改注释。)
3. `pool-shard-register.mjs:88` — `REORG_SAFE_MIN_DEPTH = 20`(TN12 实测校准值,不是新拍的数)。
4. `relay.mjs:1196-1206` — `check_utxo_landed{address,txid,minDepth}` → `{landed, depth}`,**已支持深度门**。
5. `relay.mjs:1208+` → `p2sh.mjs:1516-1526` — `getAddressUtxos` 返回
   `{ outpoint: { transactionId, index }, amount }`(**已核实实现,不是按名字推**)
   ⇒ **创建该 UTXO 的 txid 拿得到**,这是 P1 的承重前提。
   🔴 **但它不返回深度**(无 `blockDaaScore`)⇒ 深度必须另走 §3.4 的 `check_utxo_landed(minDepth)`,
   **别把「拿到 UTXO」读成「够深」** —— 两件事,而只有后者防重组。
6. 🔴 `kaspa_tx_log` 的列 = `tx_id, block_hash, block_time, from_address, to_address, amount, outputs_json, observed_at, network`
   ⇒ **只有 outputs,没有 inputs** ⇒ 「这个 outpoint 是被谁花掉的」**本地索引答不了**。这是本设计要绕开的那堵墙。

## 4. P1 · 正向算出来(优先路径,零新钱路动作)

**直觉**:地址编码了 state,state 编码了 `pool_value`,而每笔 refund 把它**减掉一个确定的 stake**。
所以「谁花了 O」这个问题,可以被**「链上出现了哪一个只可能由花掉 O 产生的地址」**替代。

设 T = 卡住的广播,O = T 要消费的 pool continuation outpoint,`V₀` = O 所在 state 的 `pool_value`,
`B` = T 要退的那个 bettor,`stake(B)` 已知(ticket 里)。

```
safely_absent_P1(T) ⟺  以下全部成立
  (a) O ∉ UTXO 集                                   [get_address_utxos(addr(V₀)) 里无 O]
  (b) ∃ 活 UTXO U, 其地址 = addr(V₀ − stake(B'))     [B' ≠ B, 且 B' 在本盘 bettor 集合内]
      且 U.outpoint.txid = T' ≠ T
  (c) depth(U) ≥ 20                                 [check_utxo_landed(U.addr, T', minDepth=20)]
  (d) T 自己从未创建过任何 continuation:
      addr(V₀ − stake(B)) 上不存在、且历史上未观察到 outpoint.txid = T 的 UTXO
```

- **(b) 是正向的**:那个地址**只可能**由「花掉 O 并退给 B'」产生 —— 因为 `V₀ − stake(B')` 这个 state
  的前驱只能是 `V₀`。这就是绕开「索引没有 inputs」的那一步:**用地址反推父状态,而不是查花费者**。
- **(d) 是唯一残留的缺席判据**,所以它**必须**由 §5 那条可证完备的观察链兜,不能用一般索引。
- 🔴 **stake 相同的坑**:若 `stake(B') == stake(B)`,则 (b) 与 (d) 的地址**重合**。
  这时 (b)(d) 退化为「同一地址上的 UTXO 是谁创建的」⇒ **由 outpoint 里的 txid 判**(T' ≠ T 即成立)。
  **这一支必须单独写用例**,否则它会在"通常情况"下被顺带跳过。

## 5. P1 的前提:可证完备的 continuation 观察链(这条是本设计的新东西)

> ## 🔴 v0.2 修订(2026-08-12)—— 本节 v0.1 的写法**不成立**,已被两方独立打掉
>
> **@NWT(PASS-with-MUST-FIX)与 Codex `90215dfd` §2 独立收敛到同一条,我认,且这条是我自己该抓到的:**
>
> **v0.1 §5 只证了「状态转移的连续性」,没证「观察者的覆盖」。**
> 观察者**自己静默停摆**、而那段窗口里目标地址**恰好零事件** ⇒ 重启后 value 链**依然完美连续**。
> ⇒ 从 value 连续性**分不出**「观察者活着且确实没发生事」与「观察者是瞎的、因此无法排除发生过」。
> 而 (d) 是**授权性**的负向事实(它准许同一笔经济项被重新授权)⇒ **这个缺口必须 fail-closed**。
>
> 🔴 **它不是理论**:就在今天这几小时,本队**两次**发生「扫描/摄入组件静默停摆、靠外部信号才被发现」
> (:3200 摄入腿断 18:28→19:17Z;CONSOLE-SPAWN-DEATH)。**第一次那个还是我自己报的** ——
> 我一边拿它当判据教训,一边在自己的设计里犯了同一个:**我加了连续性校验,却没让任何判据去读"观察者还活着吗"。**
> (在册同族:仪器要被判据读到才算数 / 沉默与没事读数相同。)
>
> ### ⇒ P1 的硬前置(五条,缺一即 `unresolved`,照 Codex §2 逐条采纳)
> 1. **持久化的观察者覆盖证据,锚在单调的链上区间(DAA)上** —— **不是**墙钟心跳文本。
> 2. **证明窗口的起点不得晚于「T 最早可能落链的时刻」**,并**延伸到做判定的那一刻**。
> 3. **任何心跳/checkpoint/扫描游标的缺口,都使该区间的负向臂失效** —— 哪怕 pool_value 序列完全连续。
> 4. **重启必须恢复此前的覆盖边界**,不许静默开一个新的「完备」窗口。
> 5. **负测试必须包含**:静默停摆 + 目标地址零转移 + value 连续的重启 ⇒ 必须判 `coverage_gap → unresolved`。
>
> 🔨 **一句留给下一个设计者的**:**「我的数据自洽」不等于「我一直在看」。**
> 自洽性校验只能证**已观察到的那些**之间没有矛盾,证不了**没被观察的那段**里什么都没发生。

一般索引的缺席不可用;**但 continuation 是一条链表**:每一环的 `pool_value` 必须等于上一环减去某个已知 stake。
⇒ **缺口是可检测的**:相邻两环对不上账,就说明中间掉了环。

⇒ 观察者只需记录 `(outpoint, addr, pool_value, txid, first_seen_daa)`,并对相邻环做 `value` 连续性校验:
- **连续性成立** ⇒ 该窗口内的观察**可证完备**,(d) 的缺席在这个窗口内**可用**;
- **连续性断裂** ⇒ 立刻标 `coverage_gap`,窗口内的 (d) **一律不可用**,退回 `unresolved`。

🔨 这就是它和 `kaspa_tx_log` 的区别:**一般索引的缺口是静默的,而这条链的缺口会自己喊。**
🔵 已有可复用的先例:`preprune-capture-worker` 的心跳/待补计数是同一形状(在 console 进程内)。

## 6. P2 · 主动做出来(当 P1 不可用时的唯一出路)

即 NWT 提的 race-to-resolve。**Codex 判它 RED 不是判它错,是判它缺授权**(授权循环)。
本设计采纳 Codex §4 的第二种构造,并把它收窄成**只此一用**:

- 一张**独立的、窄范围的冲突解决授权**,逐字段绑定:
  `pool outpoint O` · 竞争项(ticket/item)· 处置 · output/value 承诺 · operation id · expiry · 重放保护。
- 🔴 **它不得同时授权那笔未决原项**(否则就是"绕过 expiry 的通用旁路",Codex 原话)。
- 成立判据:竞争交易 T'' 确认且 `depth ≥ 20` ⇒ O 被 T'' 消费 ⇒ **T 结构性死**。
  这里**不需要**任何缺席判据:我们自己构造了 T''、知道它消费 O,而 T'' 的确认是正向可验的。

## 7. fail-closed 规则(不许有第三种结局)

1. P1、P2 都不成立 ⇒ **`unresolved`**,该项**不得**进任何替换会话的授权范围(Codex 验收 3.)。
2. **仪器坏 ≠ 判词**:`get_address_utxos` 取不到 / relay 断 / 深度取不到 ⇒ `unresolved`,**不是** `safely_absent`。
3. **迟到确认必须能推翻它**:即使已判 `safely_absent`,若 T 后来出现在链上 ⇒ 立即升 `conflict`,
   并**必须**已经不存在第二份对同一项的普通授权(Codex 验收 4.)。
4. 串行拓扑:未决前驱**阻断**后续推进,除非 P2 建立了新的已确认 continuation(Codex 验收 7.)。

## 8. 负测试清单(逐条给出「该红在哪」——名字必须是那条会红的)

| # | 用例 | 注入 | 必须 |
|---|---|---|---|
| N1 | `timeout_alone_does_not_prove_absent` | 只让时钟走过 expiry | **拒**(仍 `unresolved`) |
| N2 | `db_attempted_flag_does_not_prove_absent` | DB 写 attempted=1 | **拒** |
| N3 | `single_rpc_miss_does_not_prove_absent` | 一次 `get_address_utxos` 返回空 | **拒** |
| N4 | `operator_assertion_does_not_prove_absent` | 操作员显式断言"它死了" | **拒** |
| N5 | `confirmed_then_spent_is_not_absent` | T **确认过**、其 continuation 已被下一笔花掉 | **拒**(这是 §2 那条假阳性) |
| N6 | `depth_below_20_is_not_absent` | U 存在但 `depth=19` | **拒** |
| N7 | `coverage_gap_disables_absence_arm` | 观察链 value 连续性断裂 | **拒**,且标 `coverage_gap` |
| N8 | `equal_stake_collision_uses_txid` | `stake(B') == stake(B)`(地址重合) | **按 outpoint.txid 判**,T'≠T 才准 |
| N9 | `late_confirmation_revokes_absent` | 判 `safely_absent` 后 T 才确认 | 升 `conflict`,且证明无第二份普通授权 |
| N10 | `instrument_failure_is_not_a_verdict` | relay 不可达 | **拒**(`unresolved`) |
| N11 | `silent_observer_outage_with_zero_transitions` | 观察者静默停摆 + 该窗口目标地址**零转移** + value 连续的重启 | **判 `coverage_gap` → `unresolved`**(v0.2 新增) |
| N12 | `restart_must_not_open_a_fresh_complete_window` | 重启后不恢复旧覆盖边界 | **拒**,并保留原缺口(v0.2 新增) |
| N13 | `address_roundtrip_mismatch_disables_p1` | state→address 复算与链上实物不符 | **禁用 P1**,**不得**退回缺席启发式(v0.2 新增) |
| P+ | `authorized_conflict_tx_establishes_absent` | P2 的 T'' 确认且 depth≥20 | **准**(唯一的阳性对照) |

🔴 **阳性对照 `P+` 不是可选项**:一张只会「拒」的判据表,**全体拒绝也能全绿**。
我今天在 D2 复核里刚吃过同族的亏(恒拒实现也能通过一整套用例)。

## 9. 我没做的 / 留给域主的

- **未落码**(边界)。runtime enforcement 那格(`buildRefundCommand()` 仍无授权 artifact,Codex §5)**不在本文范围**,
  🔴 **而它有人管**:Bettor (165) 记的「退款轨剩 runtime enforcement」就是它 —— 不是没人看的洞。
- 🔴 **v0.2 更正(Codex §3 判 MUST-PASS,它不再是「留白」)**:`_continuationAddress` 的 state→address
  round-trip 是**硬前置**。在用**已知前驱 state + 已知 refund 转移**复算出的地址/outpoint 关系与**链上实物
  逐字节相同**之前,P1 的地址证据**不算 CLOSED**;**复算不符必须禁用 P1,不许退回缺席启发式**(见 N13)。
  **我去跑,跑完单独交。**
- 🔴 **P2 的授权 artifact 补一格(Codex §4)**:除 outpoint / 竞争项 / 处置 / output-value 承诺 / op-id /
  expiry / 重放保护之外,还必须绑 **approver 身份与角色**。本文**不授权**任何 P2 生产使用。
- 🔴 **规范进展 ≠ 运行时闭合(Codex §5 + 他对 ledger 那句下的 status correction)**:
  `buildRefundCommand()` 至今**不收**任何授权/会话/项状态 artifact,仅凭技术性 refund 输入就能构造
  `bshard_refund_cancelled`。⇒ 「退款轨设计侧全闭」这句**对运行时不成立**,别按已闭记账。
- §5 观察链要不要复用 `preprune-capture-worker` 的宿主,归基础设施域主拍(我不自决)。
