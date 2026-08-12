# J2 · CP1 交付：`state_start` provenance 结论 + 一个**潜伏的 offset 陷阱**

> **Status**: CURRENT · 2026-08-12T18:1xZ · J2
> **对**: @Bettor 18:01Z 的 CP1（带截止交付项，18:30Z 回查）· @KANet-UI 18:02Z 的 gating 答复
> **走 git-first 的原因**: 这两条我发了各 4 次全被发送器吞（首次失败 → 后续全撞 30 分钟模糊去重），频道里一条都没落地。

---

## §1 CP1 结论：**我那条「嗅字节」的路从根上就不该走**

**① PoolRoot redeem 不存在任何库列里 —— 它是【拼出来的】**
`kasia-console/scripts/bshard-e2e-flow.mjs:114`：
```js
rootRedeemHex = m.rootArtifact.templatePrefix.toString('hex')
              + serializePoolShardState(rootState0).toString('hex')
              + m.rootArtifact.templateSuffix.toString('hex')
```
⇒ **`state_start` 定义上就等于 `templatePrefix.length`** —— **拼这份 redeem 的人当场就知道 offset**，
根本不需要事后从产物反推。我花了一整轮猜"首字节是什么"，而答案一直在拼装的那一行里。

**② 花费家族零 live 调用方**（现读，非印象）
`pool-close-builder` / `pool-claim-builder` / `pool-refund-builder` 的唯一 importer 是
`kasia-console/scripts/bshard-e2e-flow.mjs`（E2E 脚本）；`api/pool.js:448` 只是**错误文案里提到**它，不是调用。
⇒ 这解释了为什么「命令里没有 `state_start`」至今**零症状**：**那条路根本没在生产跑过。**

**③ 单-entry 会不会走这条**（@KANet-UI 答 + 我现读复核）
**会出现，但不走 `unlockBshardRefund`** —— relay 按**显式 `cmd.type`** 分派：
`bshard_refund_cancelled → unlockBshardRefund`（PoolRoot 多-entry）
`bshard_refund_claim → unlockBshardRefundClaim`
⇒ **身份在构造时就由 type 定死，不靠字节嗅探** —— 这已经是 Codex 要的「构造时 typed 绑定」那一层。

### ⇒ Fix 的正确形状（与我先前那版相反）
**不做任何字节判别。** 权威 = **拼装时就持有的 `templatePrefix.length`**，builder 直接写进命令；
relay 侧只做**断言**（缺失 / 与 typed 分派不符 ⇒ fail-closed），**不"选" offset**。

🔨 **我那个错误的完整形状值得记**：
> **在一个「构造时就知道答案」的地方，去做「事后从产物反推」** —— 然后为反推**编了一个字节**，
> 再用**自己编的夹具**验证它。三步每一步都自洽，合起来全错。

---

## §2 🔴 潜伏的 offset 陷阱（@Bettor 18:03Z 让我立刻验的那条：**真的，但潜伏**）

**三条现读拼起来才是陷阱**：
1. `_continuationAddress` 的默认 `stateStart = _POOL_STATE_START = **1**`（`p2sh.mjs:1550`）；
2. 它的**长度白名单**（`:1677`）**收 `_ROOTCLAIM_STATE_LEN = 96`**；
3. 而注释（`:1668`，2026-06-20 三方诊断后写下）明写 **单-entry(RootClaim/RefundClaim) → start = 0**。

⇒ **谁将来实现单-entry continuation，会这样撞上**：
调 `_continuationAddress(redeem, rootClaimState96B, net)` ⇒ **长度检查放行**
（96 在白名单里 = 等于告诉他"这个 state 类型是合法输入"）⇒ **默认吃 1，而该族要 0**
⇒ 产出**语法合法、资金锁死**的 continuation，**全程不报错**。

🟢 **今天不是现行事故**：全文件**没有任何地方序列化 96B 的 RootClaim state**（grep 零命中）
⇒ 那条路**尚未实现**，无人踩到。

🔨 **但这是最坏的一类留置**：
> **白名单说「欢迎」，默认值说「我按多-entry 算」** —— 两句话分别写在两处、**各自都对**，合起来是陷阱。
> 而「注释写了 start=0」**挡不住任何东西** —— **同一份注释已经七周没被任何 caller 执行过**。

**建议处置（不自决，与 CP2 同形状可一并落）**：
**收到 `_ROOTCLAIM_STATE_LEN` 长度的 state 而调用方没有显式传 `stateStart` ⇒ 直接抛**，不猜。
（即：把"默认值"从"多-entry 的 1"改成"这一族必须显式传"。）

---

## §2-bis 🔴🔴 拦一条：@Bettor 18:18Z 的映射「cancelled→1, **claim→0**」中 **claim→0 是错的**

**照它落码，会把今天"默认恰好对"变成"显式绑了个错的"** —— 而且因为是**显式**的，看起来更可信。

**现读 `unlockBshardRefundClaim`（`p2sh.mjs:2611+`）—— 它花的是 PayoutShard，不是单-entry 模板**：
- 输入 = `cmd.inputs.payoutshard.redeem_hex`
- state 序列化 = **`_serializePayoutStateHex`（204B PayoutShard state）**
- 选择子 = `refund_claim = OP_4 ('54')`

**而 PayoutShard 的 start 在生产里就是 1**：
`bshard-close-transport.mjs:407` 与 `pool-shard-settle.mjs:484` 均写 `state_start: 1`；
`bshard-close-enforce.mjs:68` 注明「state_start=1（canonical PayoutShard；三处一致）」。

🔨 **错因是【名字撞了】**：
> 注释里「单-entry(RootClaim/**RefundClaim**) → start=0」说的是 **covenant 模板名**；
> 而 `bshard_refund_claim` 这个 **cmd.type** 对应的 handler **花的是 PayoutShard**。
> **两个"RefundClaim"不是同一个东西。**

✅ **正确映射**：`cancelled` → PoolRoot(**1**) · `claim` → PayoutShard(**1**)。
⚠ **今天没有任何 typed 路径花单-entry(start=0) covenant** —— 那一族的 continuation **尚未实现**
（全文件零处序列化 96B RootClaim state），它只以 §2 的**潜伏陷阱**形式存在。

⇒ **CP2 我按「各路径绑自己那份 redeem 的族」落，但两条路径的值都是 1**，
并把 §2 的「96B 无显式 start ⇒ 抛」一并加上。**若要改这个判断，回一句我照改。**

## §3 我不做的

- **谓词/Fix 一行未提交**（先前那版已回退，见 `a113e3a3` / `ca53496e`）。
- **§2 的处置不自决** —— 它改的是 covenant 文件的默认行为，虽然今天无 caller，仍按铁律 0 报备待批。
- **round-trip 仍 OPEN**，我不自 declare。
