# D2-MULTIPLICITY MUST-FIX · 设计短稿 rev-1【DESIGN-ONLY · 零落码 · 待 NWT 审】

> **Status**: CURRENT · rev-1（2026-08-11 · J2）
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

> 🔴 **N2 为什么不能省**：N1 只保证"只有一个 covenant 输出"，**不保证签名者验的那个就是 witness 指的那个**。
> 二者分离时，攻击者把唯一的 covenant 放 index 0、而 witness 指 index 1（一个无 covenant 的普通输出），
> 现码与只加 N1 的版本**都会放行**。
> ⚠ **依赖**：enforcer 当前拿不拿得到 witness 的 `self_out_idx`，**我没有实核**（`signRequest` 字段表见
> `bshard-close-transport.mjs:15` 的 `@param`，其中未列 witness）。⇒ **N2 标 `[待实核]`**：
> 若拿不到，N2 落不了地，**那就必须在设计里说清"我们只闭了一半"，不许写成已闭。**

---

## §4 value 绑定（缺陷的另一半）

**期望值来自哪里，是本稿唯一还没坐实的一格，明写在这里。**

- refund 路有明确的链上焊死：`weld5 require(out[poolOutIdx].value == pool_value - tk.stake)`（我 2026-06-15 写的 `pool-refund-builder.mjs` 头注）。
- close_attest 路**应当**有同族的 value weld（PayoutShardV2 侧），但**我没有现读到那条 weld 的原文**。
- ⇒ 🔴 **落码前必须先答**：合法 close_attest 的 continuation value 由哪条链上 weld 约束、期望值怎么算。
  **答不出就不要写 value 检查** —— 写一个自己算的期望值去比，等于**验我的复刻而不是验实代码**（在册同族，J1 2026-08-10 提醒过我同一件事）。
- 🔵 **而 N1 不依赖这一格**：`covOuts.length === 1` 立刻消掉"两个同 SPK 异 value"这一整类攻击，
  **因为多重性本身没了**。⇒ **修法可以分两步交付：N1 先落（闭掉 MUST-FIX），value weld 查清后再补。**

---

## §5 四条验收逐条对照（Codex 框）

| 条件 | 本稿怎么满足 |
|---|---|
| ① **基数不变量派生自真实 tx 形状** | §3：从 `self_out_idx: 0`（构造侧写死）+ S3（非 covenant 输出不进 covOuts）推出 `N1 = 1`，**不是拍脑袋定 1** |
| ② **两同 SPK 异 value 对抗用例** | §6 用例 T2：两个 output，SPK 均 == expectedSpk，value 一大一小 ⇒ **现码 PASS（缺陷）/ 修后 REJECT** |
| ③ **V2 孪生接线前同修** | `:261` 的 `verifyClosePayoutV2RootBinding` 是同形状同缺陷（同样 `matchedOutputs` 无人读）。**N1/N2 同批加进 V2**，且**在它被接线之前** —— 免得接线那天把缺陷一起接活 |
| ④ **不削既有检查** | 只**加** N1/N2，`:149` 的逐个 root 比对**一字不动**；返回结构只加字段不改语义 |

---

## §6 用例（三条，全部要能红→绿）

| # | 构造 | 现码 | 修后 |
|---|---|---|---|
| **T1** | 1 个 covenant output，SPK 正确 | ✅ pass | ✅ pass（不许回归） |
| **T2** | **2 个** covenant output，SPK 都正确，`value` 一个 100 一个 900 | 🔴 **pass（缺陷）** | ✅ **reject** |
| **T3** | 1 个 covenant output 但 SPK 错 | ✅ reject | ✅ reject（不许被新逻辑短路掉） |

🔴 **T2 是这份修法的存在理由，必须先在【未修的代码】上跑出 pass** —— 拿不到那个 pass，就证明不了我们修的是一个真存在的洞（在册：把被测缺陷重新注入一次，绿灯还变不变红）。

---

## §7 证据层级

| 陈述 | 层级 |
|---|---|
| `serializeToSafeJSON` 输出 SPK 为带 `0000` 前缀的 hex string、value 为 string、covenant 缺省为 null | ✅ `[CONFIRMED·离线实测 kaspa-wasm 同一支序列化]` |
| `_p2shSpkHex` 与之对齐（root 检查本身无 bug） | ✅ `[CONFIRMED·现读 :90-93]` |
| `covOuts` 基数/value 均未绑、`matchedOutputs` 零消费者 | ✅ `[CONFIRMED·现读 :144-153 / :483 / :596]` |
| 合法 close_attest 只有 1 个 covenant continuation | 🟠 `[推断·由构造侧 `self_out_idx: 0` 与 S3 推出;未在真实 close_attest tx 上实测]` |
| enforcer 能否拿到 witness 的 `self_out_idx`（N2 可行性） | 🔴 `[待实核]` —— 拿不到则 N2 落不了地 |
| close_attest continuation value 的链上 weld 原文 | 🔴 `[未读]` —— §4，落码前必答 |
