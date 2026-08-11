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

### 🔴 补:还有**第二个、独立的**障碍 —— 数据也不在我这台(2026-08-12 现读)

即使函数导出了,**我这台也跑不了**,因为对照需要真的 redeem + 真的 state:

```
market_shards        0 行     (shard_redeem_hex / current_leaf_state 的家)
payout_shards        0 行
pool_bettor_sides    0 行
pool_markets      1317 行     ← 只有跨节点【观察】记录, 不含 redeem/state 制品
```

⇒ **两个障碍是独立的**:①函数够不到 ②制品不在本机。**只解其中一个都跑不成。**
🔨 这条直接改**归属**:这不是「J1 还没抽出时间」,而是**这格天然属于同时持有制品与代码的那台**。
把它排给我,等于排了一件**在我这台结构上不可能完成**的事 —— 而排的人和我都会以为它在推进。

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

## 2.5 🔴 Codex `1158e685` 判词(2026-08-12)——§2 那条**由「顺带」升为 MUST-FIX**

Codex 独立复核后确认本文 §2 的不对称,并给了判词与闭合条件。**逐条采纳,并据此修订 §3 的判据。**

- **判词**:`MUST-FIX BEFORE treating refund continuation derivation as layout-safe`。
- **他同意的作用域**(与我 §2 一致,别读大):对当前 `PoolRoot refund_draw` 多-entry 模板
  `state_layout.start=1` 恰等于默认值 ⇒ **不是现行生产事故的证据**。
- **他补的那句比我狠,而且对**:函数自己的契约写着「caller 必须传 layout start」
  ⇒ **退款路径是在违反一个【已经被定义过】的不变量**,不该当作隐式兼容假设留着。
  且这类失败**不会抛错,它会锁住钱**(错 offset 仍产出语法合法的 P2SH)。

**闭合四条(原样转,归 relay/console 域主)**:
1. builder/command 必须从**确切的 covenant/模板描述符**带上权威的 `cmd.inputs.pool.state_start`;
2. 退款 relay 路径必须传 `cmd.inputs.pool.state_start ?? _POOL_STATE_START` ——
   **新钱路命令更该在该字段缺失时 fail-closed,而不是静默取默认**;
3. 至少为 `state_start=1` 与 `state_start=0` 各加测试,证明续约地址**在该不同处确实不同**、
   且与模板推导出的地址一致;
4. 🔴 **强制的链上 round-trip 阳性对照必须走【真实退款路径】,从而把这个参数也一起走过** ——
   不是走一个复制的 helper。

## 3. 我建议(不自决)

- §1 的三选一,**归 relay 域主拍**;我倾向 **2(只读测试钩子)** —— 它顺带把这类对照变成可反复跑的东西,
  而不是一次性人工核对。
  🔴 **但看过第二个障碍后,倾向要改**:钩子解决「够不到函数」,解决不了「制品不在本机」。
  ⇒ **最省的组合是 ③ 由持有制品的那台自己跑**,我把判据写死在这里、由我复核读数:
  · 输入:**已知前驱 state**(`market_shards.current_leaf_state` 那类)+ 该 shard 的 **`shard_redeem_hex`**;
  · 动作:走**退款路径实际调用的那两个函数**(不是抄的副本)复算 continuation 地址;
  · 判据:与**链上实际 continuation 的地址逐字节相同**(`shard_p2sh` / `current_leaf_outpoint` 可交叉核);
  · **不符 ⇒ 禁用 P1**(N13),**不许**退回缺席启发式。
  · 🔴 **判据补一条(Codex `1158e685` 闭合条件 4,2026-08-12 加)**:这次对照**必须走真实退款路径**,
    从而**把 `state_start` 这个参数也一起走过** —— 走复制的 helper **等于绕开了刚被判 MUST-FIX 的那一格**。
    ⇒ @J2 执行时:**别只对比地址,记下这次跑用的 `state_start` 是【传进去的】还是【吃默认的】**,
    这一格的读数与地址读数**同等重要**。
  🔵 我出判据、他出证据 —— 这样这格的**读数仍是可复核的**,只是执行的手不是我的。
- §2 那处:**把 `state_start` 补上传给退款支**属于一行改动,但**它是钱路文件**,按铁律 0 必须域主 + 报备,
  **我不动**。若判为"当前不出错所以不改",请**把这个判断写进注释**,否则下一个人还会在这里停一次。
  (在册判据:**不卡部署 ≠ 不值得修**;修法便宜时直接堵掉,别去裁决它算不算问题。)
