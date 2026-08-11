# D2-MULTIPLICITY MUST-FIX · 设计短稿 rev-3【DESIGN-ONLY · 零落码 · 待 NWT 审】

> 🔴 **给审稿人(@NWT)的一句**: **别等我在频道发完 —— 那几条发不完。** 我发送器 UTXO 见底(地板=单个 UTXO ≥3 KAS, 与消息长短无关), **每条只出得了第 1 块**。频道里的片段是索引, **本文件才是正文**;证据层级表/用例表/我自己标的待实核缺口全在后半, 只读片段会漏掉最该被红队打的那几格。
>
> **Status**: CURRENT · **rev-3**（2026-08-11 · J2 · rev-2 闭两缺口; rev-3 修 V2 函数名与接线状态两处错 + 补 §8 落码包三件）
> **卡**: CARD-J2-B 第一件（③D2）· 验收框 = Codex 最小闭合四条 · 流程 = 设计短稿 → NWT 审 → 落码 → 双审
> **缺陷来源**: NWT 08-10 06:58 发现 / J2 复核 / Codex 三方确认
> **本文件不落码、不动开关、不碰链。**

---

## §1 缺陷（现读，行号在正文）

`kasia-console/src/lib/bshard-close-enforce.mjs`

```js
:144  const covOuts = (...outputs).filter(o => o && o.covenant && o.covenant.covenantId);
:145  if (covOuts.length === 0) return { ok:false, ... }          // 只挡 0, 不挡 N>1
:148  for (const o of covOuts) {
:149    if (String(o.scriptPublicKey||'').toLowerCase() !== expectedSpk) return {ok:false,...}
:152  }
:153  return { ok:true, expectedSpk, matchedOutputs: covOuts.length };
```

- **绑住了** 每个 covenant output 的 `scriptPublicKey`（= P2SH，内含 re-derived payoutRoot）。
- 🔴 **没绑** ①**基数**（几个）②**value**（每个多少钱）。
- 🔴 **`matchedOutputs` 零消费者**：两个调用点 `:483`（V1）/`:596`（V2）都只读 `d2.ok`。

**`:146-147` 那句注释**「全部都对 → 无论 final witness self_out_idx 指哪个都安全」——
**在 root 轴上成立，在 value 轴上不成立。** 两个 SPK 相同、value 不同的 continuation output 全部通过 root 检查，
而 `self_out_idx` 指谁，决定**多少钱**留在 covenant 里继续。

---

## §2 真实 tx 形状（本稿的地基 · 离线实测，非推断）

`txSafeJson` 的产地是 `bshard-close-transport.mjs:425` 的 `un.serializeToSafeJSON()`（kaspa-wasm）。
我离线构造一笔 tx 调同一支序列化，实测输出：

```json
outputs[0] = {"value":"5000000",
              "scriptPublicKey":"0000" + "2020f208…ac",
              "covenant":null}
顶层 keys = id,version,inputs,outputs,subnetworkId,lockTime,gas,storageMass,payload
```

**三条落在实现上的事实**：

| # | 事实 | 对修法的意义 |
|---|---|---|
| S1 | `scriptPublicKey` 是**十六进制字符串**，且带 **4 字符 version 前缀 `0000`** | 现码 `String(o.scriptPublicKey)` 正确；`_p2shSpkHex():92` 返回 `'0000aa20'+h+'87'` **同样带前缀** ⇒ **两边对齐，root 检查本身无 bug**（这一格我特意验了，避免"修了 A 结果 B 一直是坏的"） |
| S2 | `value` 是**字符串**（十进制 sompi），不是 number/bigint | value 绑定**必须按 BigInt 比**，不能 `===` 比字符串也不能 `Number()`（>2^53 会静默失真） |
| S3 | 无 covenant 时字段是 `covenant: null` | 现码 `o && o.covenant && o.covenant.covenantId` 过滤正确，**不改** |

---

## §3 基数不变量的推导（Codex 条件①：**派生自真实 tx 形状**，不硬编码）

`bshard-close-transport.mjs:414` 构造 witness 时写死：

```js
witness: { self_out_idx: 0, … }
```

⇒ **合法 close_attest 的 covenant continuation 是【唯一的、位于 index 0 的】那一个**；
其余输出（change / fee）由 `preimg.outputs` 给出且**不带 `covenantId`**（S3 ⇒ 它们的 `covenant` 为 null，不进 `covOuts`）。

⇒ 🔨 **不变量 N1**：`covOuts.length === 1`。
⇒ 🔨 **不变量 N2**：该 output 的**下标必须等于被签 witness 的 `self_out_idx`**。

> 🔴 **N2 的实核结果（rev-2 补，原为 `[待实核]`）：enforcer 【拿不到】 `self_out_idx`，N2 按原样落不了地。**
> 现读 `publishCloseRequest` / `publishCloseRequestV2` 实际持久化的字段：
> `txSafeJson · predicate · proposed_evidence · claimedPayoutRoot · psRedeemHex · committee_pks ·
> committee_meta · input_index · broker_pk · … · closeInputs` —— **没有 witness，也没有 `self_out_idx`**。
> ⚠ `input_index` 是**输入**下标（委员签哪个 input），**不是** `self_out_idx`（covenant 续到哪个 output），两者别混。
>
> 🔨 **而"拿不到"这件事本身把 N2 的形状否掉了，不只是挡住它**：
> witness 由 settler 构造、且**在委员签名之后仍可改**（sighash 不覆盖 witness）⇒ **任何"验 witness 指哪个"的设计都是错的靶子**。
> 现码 `:146-147` 那句注释的思路其实是对的——**不问 self_out_idx 指谁，而是让【每个】covenant 输出都必须正确**；
> 它错只错在"正确"只查了 root、没查基数与 value。
> ⇒ **N2 撤销。N1 是正解，且它把 N2 想解决的问题一起解决了**：covenant 输出恰好 1 个且 root/value 都对时，
> `self_out_idx` 无论指谁，指到的要么就是那一个、要么是个无 covenant 绑定的输出（后者由链上脚本自己拒）。

---

## §4 value 绑定（缺陷的另一半）

**rev-2：这一格已经查清了，不再是缺口。**

**链上 weld 原文**（`kasia-console/src/lib/PayoutShardV2.sil`，主仓现读）：

```
:76   absorb        require(tx.outputs[selfOutIdx].value == consolidated_pool + shard_value)
:180  close_attest  require(tx.outputs[selfOutIdx].value == consolidated_pool)   ← 本稿要的这条(closed:1)
:283                require(tx.outputs[selfOutIdx].value == consolidated_pool)   (closed:2)
:344  refund        require(tx.outputs[selfOutIdx].value == consolidated_pool - refund)
:398                require(tx.outputs[selfOutIdx].value == consolidated_pool)
```

⇒ 🔨 **close_attest 的期望值 = 输入侧 PS state 的 `consolidated_pool`（值守恒，不增不减）。**
（`:180` 那一支的 state 里 `closed: 1` —— 与"close_attest 之后 `closed==1` 会挡住 refund_draw 的 `require(closed != 1)`"对得上，两处互证。）

✅ **而怎么读它，已经有生产函数，我不自己解字节**：
`bshard-close-enforce.mjs:108 export function readPsConsolidatedPool(psRedeemHex)`
—— 正是 2026-08-10 J1 为我导出的那一支，导出理由逐字写在 `:97-99`：
> 「J2 要为 V2 退款验证从 payout_redeem_hex 取 consolidated_pool，而他自己点破『我若自己解那几个字节 = 又一次【验我的复刻而不是验实代码】』——那个顾虑是对的，所以正解不是给他一段偏移量说明，是让他调**生产自己在调的这一支**。」

⇒ 🔨 **不变量 N3**：`BigInt(covOut.value) === BigInt(readPsConsolidatedPool(psRedeemHex))`
（按 S2，`value` 是字符串，**必须 BigInt 比**）。

🔵 **N1 与 N3 的分工**：N1 消掉"多个 continuation"这一整类；N3 挡住"只有一个但金额被改"。
**两条都要**——只有 N1 时，settler 可以给唯一那个 continuation 一个错的 value（root 仍对，现码仍放行）。

---

## §5 四条验收逐条对照（Codex 框）

| 条件 | 本稿怎么满足 |
|---|---|
| ① **基数不变量派生自真实 tx 形状** | §3：从 `self_out_idx: 0`（构造侧写死）+ S3（非 covenant 输出不进 covOuts）推出 `N1 = 1`，**不是拍脑袋定 1** |
| ② **两同 SPK 异 value 对抗用例** | §6 用例 T2：两个 output，SPK 均 == expectedSpk，value 一大一小 ⇒ **现码 PASS（缺陷）/ 修后 REJECT** |
| ③ **V2 孪生同修** | **rev-3 两处更正(@NWT 08-11 审出函数名 + 我顺查发现接线状态也写错了)**: ①函数名是 `verifyClosePayoutV2Binding`(**`:242`, 无 "Root"**), 稿子原写法 grep 不到; ②**它【已经接线】, 不是"接线前"** —— `:592` 在 `enforceCloseAttestV2()`(`:515`)内被调用, 而该 enforcer 被 `bshard-close-voter.js:143` 引用。⇒ **V2 侧的缺陷不是假设, 是已在代码路径里**;是否实际执行取决于 voter 是否 armed(在册: 默认 OFF)。**⇒ N1/N3 必须同批进 V2, 且它比 V1 更不能拖。** |
| ④ **不削既有检查** | 只**加** N1/N3，`:149` 的逐个 root 比对**一字不动**；返回结构只加字段不改语义 |

---

## §6 用例（四条，全部要能红→绿）

| # | 构造 | 现码 | 修后 |
|---|---|---|---|
| **T1** | 1 个 covenant output，SPK 正确 | ✅ pass | ✅ pass（不许回归） |
| **T2** | **2 个** covenant output，SPK 都正确，`value` 一个 100 一个 900 | 🔴 **pass（缺陷）** | ✅ **reject** |
| **T3** | 1 个 covenant output 但 SPK 错 | ✅ reject | ✅ reject（不许被新逻辑短路掉） |
| **T4**（rev-2 加） | **1 个** covenant output，SPK 正确但 value != `consolidated_pool` | 🔴 **pass（缺陷）** | ✅ **reject**（N3） |

🔴 **T2 是这份修法的存在理由，必须先在【未修的代码】上跑出 pass** —— 拿不到那个 pass，就证明不了我们修的是一个真存在的洞（在册：把被测缺陷重新注入一次，绿灯还变不变红）。

### §6-bis 修前实测读数（2026-08-11 · 已跑 · 原样抄进本稿）

**为什么抄进来**：探针在 `scratch/`（gitignored）⇒ 它随时可能不在了，而**在册那条说得很清楚：gitignored 产物不算交付**。
落码之后探针要退役（§8 ⚠），到那时这几行就是"修之前它确实是通的"唯一还留得住的记录。

```
调用方式: 直接 import 生产导出 verifyClosePayoutRootBinding(未修版本)
输入:     库里真实 payout_redeem_hex(len>1000) · reDerivedRoot='aa'×32 · 零写入
expectedSpk = 0000aa20c3ab44d766886a643267…   (由函数自己在 reject 路回传, 未碰内部函数)

T1  1 个 covenant, SPK 正确                → pass    matchedOutputs=1   ✅ 本该 pass
T2  2 个 covenant, SPK 都对, value 100/900  → pass    matchedOutputs=2   🔴 缺陷显形
T3  1 个 covenant, SPK 错                  → reject                     ✅ 本该 reject
T4  1 个 covenant, SPK 对但 value=999999999 → pass    matchedOutputs=1   🔴 缺陷显形
```

⇒ **T2 与 T4 各自证明了 N1 与 N3 所要挡的东西在修之前【确实是通的】。**
⚠ **这四行是【证据】不是【回归哨兵】** —— 它证明"修之前有洞"，**不证明"以后不会再有洞"**；
后者要等 §8 第③件（正式用例进 runner）落地。**两者不可互相冒充。**

---

## §7 证据层级

| 陈述 | 层级 |
|---|---|
| `serializeToSafeJSON` 输出 SPK 为带 `0000` 前缀的 hex string、value 为 string、covenant 缺省为 null | ✅ `[CONFIRMED·离线实测 kaspa-wasm 同一支序列化]` |
| `_p2shSpkHex` 与之对齐（root 检查本身无 bug） | ✅ `[CONFIRMED·现读 :90-93]` |
| `covOuts` 基数/value 均未绑、`matchedOutputs` 零消费者 | ✅ `[CONFIRMED·现读 :144-153 / :483 / :596]` |
| 合法 close_attest 只有 1 个 covenant continuation | 🟠 `[推断·由构造侧 `self_out_idx: 0` 与 S3 推出;未在真实 close_attest tx 上实测]` |
| enforcer 拿不到 `self_out_idx` ⇒ N2 撤销、N1 subsume 之 | ✅ `[CONFIRMED·现读 publishCloseRequest/V2 持久化字段表, 无 witness]` |
| close_attest 的 value weld = `outputs[selfOutIdx].value == consolidated_pool` | ✅ `[CONFIRMED·现读 PayoutShardV2.sil:180]` |
| 读它用生产函数 `readPsConsolidatedPool` 而非自解字节 | ✅ `[CONFIRMED·:108 已导出]` |

---

## §8 落码包 = 三件（rev-3 补 · @Bettor 15:5x 裁「allowlist 子步不另开卡」）

| # | 内容 | 为什么它不能省 |
|---|---|---|
| **① 本体** | `bshard-close-enforce.mjs` 加 **N1**（`covOuts.length === 1`）+ **N3**（`BigInt(o.value) === BigInt(readPsConsolidatedPool(psRedeemHex))`）；**V1（`:144`）与 V2（`:242`）同批** | V2 已接线（见 §5 条件③），不是"将来" |
| **② allowlist** | `test-framework/lib/runner.mjs:745` 加键 `bshard-close-enforce`，**只放开 `verifyClosePayoutRootBinding` 与 `verifyClosePayoutV2Binding` 两个导出** | Codex 条件② 要的对抗用例**进不了 runner**，除非有这条。粒度由 `entry.exports.includes(step.export)` **机器强制**，不靠注释 |
| **③ 用例** | T0/T1/T2/T3/T4 落 `cases/predictions/pool/`，**文件名必须 `*.test.mjs` 且是 `export default` 的声明式 case** | 我实撞过：写成 `export const meta` + `export async function run` ⇒ runner 报 `SKIP (no default export)`，而 Summary 打 `0 PASS / 0 FAIL / 0 run` —— **静默 SKIP 与"没问题"在汇总里同形**。已删掉那版，不留假绿 |

🔵 **② 的性质定位（供 m0a manifest 审）**：两个导出都是**判定类** —— 接收参数、纯计算、**零写库零外呼**
（`verifyClosePayoutRootBinding` 只做 `JSON.parse` + `blake2b` + 字符串比对）。
**严格弱于**已批的 `poolSettlerTick`（那条是驱动生产结算的 tick 本体，写库 + 三次链上外呼）。
⇒ **落在既有四条已批性质内部，不扩张 allowlist 的性质。**

⚠ **而 ② 一旦到位，`scratch/_j2_d2_t2_probe.mjs` 就该退役** —— 它是**证据**（修前缺陷显形），**不是回归哨兵**；
留着一个 scratch 里的探针当"我们有测试"，正是在册那条要挡的（gitignored 产物不算交付）。

---

## §9 本稿自己踩的一个坑（留档，因为它是今天第四次）

写 §8 那张表时我用 `node -e "…"` 往文件里塞内容，**正文里所有反引号包的标识符被 shell 当命令替换吃光了** ——
表格里 `bshard-close-enforce.mjs`、`covOuts.length === 1`、`runner.mjs:745` 全变成空白，而**文件写成功、脚本报"已写入"**。

🔴 **在册那条我今天凌晨刚补过（第四起），现在自己又犯**：根治写的是
> **要往文件里写文本 ⇒ 用写文件的工具（Write/Edit），不用命令行组稿。这条不要求记忆力，只要求"别把文本塞进命令"。**

⇒ 已用 Edit 重写。**留这一节不是自罚，是因为它正好证明那条记忆说对了一件事**：
读过它拦不住我 —— **拦得住的是"文本永远不进命令行"这个动作本身**。
