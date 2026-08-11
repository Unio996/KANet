# P1 的 MUST-PASS 阳性对照:**跑不成,原因不是没时间** + 顺带一处 stateStart 不对称(v0.1)

> **Status**: CURRENT

**作者** J1tn · **日期** 2026-08-12 · **上游** Codex `90215dfd` §3(round-trip 判 MUST-PASS)
**前件** safely_absent v0.2 `6150310b` · **本机 HEAD** `6150310b` · **边界**:独立读数,不落码

---

## 1. 结论(先说,因为它挡着一格验收)

Codex 要求的阳性对照是:**已知前驱 state + 已知 refund 转移 → 本地复算的 continuation 地址 == 链上实物**。
**这个对照此刻【无法忠实地跑】**,原因是可达性,不是工作量:

| 需要的东西 | 状态 |
|---|---|
| `_continuationAddress(...)` — **退款路径实际调用的那个**(`p2sh.mjs:1666`,被 `:2804` 调用) | 🔴 **模块私有,未导出** |
| `_serializeRootStateHex(...)`(`p2sh.mjs:1607`,`:2804` 用它序列化 state) | 🔴 **模块私有,未导出** |
| `_continuationAddressV2(...)`(`:1650`) | ✅ 已导出,**但它按长度拒收**(只认 `_PAYOUTSHARDV2_STATE_LEN`),**不是退款走的那支** |

🔴 **而"我照着抄一份来跑"是【不允许】的解法**:那样验的是**我的副本**,不是**它们**。
splice 逻辑两支**字面相同**、只有长度白名单不同 —— 正因为如此,抄一份会**看起来通过**,
而真正会出错的地方(序列化布局、offset、白名单)恰好被我的副本掩盖。
(在册判据:**假体不许供给它要测的东西**。)

### ⇒ 要把这格闭掉,需要域主给一条通路(我不自决,三选一)
1. **最小导出**:把 `_continuationAddress` 与 `_serializeRootStateHex` 导出(纯 read-only 派生,不碰钱路);
2. **测试钩子**:relay 加一个只读命令,输入 `{redeem_hex, state, state_start}` 只回地址,不签不广播;
3. 由**域主自己**跑这个对照并贴读数 —— 我出判据,他出证据。

🔵 **在此之前,P1 的地址证据按 Codex 的口径 = 不算 CLOSED**,v0.2 的 N13 保持有效
(复算不符 ⇒ **禁用 P1**,不许退回缺席启发式)。

## 2. 顺带一处不对称(现读,同一屏里看到的,不是搜出来的)

`p2sh.mjs` 里同一族的三个调用,**只有退款那支没有把 `state_start` 传进去**:

```
:2736  root:  _continuationAddress(..., networkId, cmd.inputs.root.state_start ?? _POOL_STATE_START)   ← 传了
:2804  pool:  _continuationAddress(cmd.inputs.pool.redeem_hex, _serializeRootStateHex(...), networkId) ← 没传, 吃默认
:2859  root:  _continuationAddress(..., networkId)                                                     ← 也没传
```

而 `_continuationAddress` 头顶那段注释**逐字警告过这件事**:

> `stateStart`: state 区在 redeem 的起始 offset. 多-entry(PoolLeaf/PoolRoot/RootClose)有 selector dispatch 前导 → `state_layout.start=1`;
> 单-entry no-selector(RootClaim/RefundClaim)无前导 → `start=0`。**caller 经 cmd 传合约 `state_layout.start`, 别硬编**
> (KANet-UI 2026-06-20, J2/J1/NWT 三方诊断 continuation offset bug)。

🔴 **作用域说清楚,别当我在报事故**:
- **今天大概率不出错** —— 退款走的是 `PoolShard_fold` 的 **refund_draw(多-entry 第 4 entry)**,有 selector 前导
  ⇒ `start=1` = 默认值 ⇒ 默认值恰好对。**我没有实测过这一点**(见 §1:我够不到那个函数),
  所以这句是**按注释与合约形态推的,不是量出来的**。
- **它是一处潜伏耦合**:一旦某条 pool 模板变成单-entry(`start=0`),`:2804` 会**静默**在错误 offset 上 splice,
  产出一个**语法合法但没人能花**的地址 —— 而这类错误的读数是"钱进去了、取不出来",不是报错。
- 🔨 判据:**注释写着"别硬编"、而它正下方就有一处硬编** —— 这种形状比单纯的 bug 更危险,
  因为**它已经被人想到过、写下来过,然后照样发生了**;下一个读代码的人会因为看见那段注释而以为这里被守住了。

## 3. 我建议(不自决)

- §1 的三选一,**归 relay 域主拍**;我倾向 **2(只读测试钩子)** —— 它顺带把这类对照变成可反复跑的东西,
  而不是一次性人工核对。
- §2 那处:**把 `state_start` 补上传给退款支**属于一行改动,但**它是钱路文件**,按铁律 0 必须域主 + 报备,
  **我不动**。若判为"当前不出错所以不改",请**把这个判断写进注释**,否则下一个人还会在这里停一次。
  (在册判据:**不卡部署 ≠ 不值得修**;修法便宜时直接堵掉,别去裁决它算不算问题。)
