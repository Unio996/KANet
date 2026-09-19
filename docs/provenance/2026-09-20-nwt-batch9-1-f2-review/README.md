> **Status**: CURRENT（2026-09-20，NWT；对象 = `origin/coord/j2-batch9-1-code-v0` 的 F2 笔 `34bd831a`，父 F1 `11c30eb7`；J2 README `docs/provenance/2026-09-20-j2-batch9-1-f2-e1-outpoint-binding/README.md`）

# 批 9-1 F2 笔审（E-1 builder 侧：chainParents 绑定 outpoint；E-4 夹具 import 扫描；A 笔 NETWORKS SHOULD）—— NWT

方法：独立检出（`D:\kanet-nwt-cand`，`34bd831a`，独立 `npm ci`）读 builder 侧 diff、夹具、B6 扫描；亲跑六套测试与 relay 侧测试；做 **12 个我自己的变异**；并做一条 J2 回归没覆盖的**端到端接线验证**（`nwt-f2-wiring-probe-builder.cjs`，临时副本里跑、跑完即删，`git status` 空）。D-021：无密钥 / 余额 / 地址。

## 结论：**GREEN，无 MUST；1 条 SHOULD**

E-1 闭合，且我用真实 builder 整链对 **4 个 builder × 12 个输入角色**独立验证：**接线正确、换 outpoint 被拒、对照臂成立**。

| 类 | 编号 | 内容 |
|---|---|---|
| SHOULD | **F2-1** | **B6（E-4）扫描有我在 D26-scan v1 上抓过的同一类漏洞**：`skipDir = {node_modules, .git, test-fixtures, data, logs, scratch}` **按目录名在任意深度跳过**，而 `kasia-console/src/data/` 是真实运行时源码；扫描根也只有 `kasia-console/src/`、`kasia-relay/src/`、`shared/`，**不含 `kasia-console/scripts/`**；扩展名只认 `mjs / js / cjs`。**真实探针文件实测**（`outputs.txt` §3）：`src/services/` 下 import ⇒ 红、`require` ⇒ 红（控制臂有效）；**`src/data/_x/d.js` ⇒ 绿（漏）、`kasia-console/scripts/_x.mjs` ⇒ 绿（漏）、`.mts` ⇒ 绿、动态拼接模块名 ⇒ 绿**。修法（与 D26-scan v2 同）：`data / logs / scratch` 只在**仓库根**按相对路径跳过（`test-fixtures` 同理限定到它真实所在路径）；扫描根加 `kasia-console/scripts/` 与根 `scripts/`；扩展名放宽到 `mjs|js|cjs|ts|mts|cts|jsx|tsx`。动态拼接是文本扫描的固有边界，写进头注即可。这不影响本笔"无生产调用方"的现状，所以是 SHOULD。 |

## 一、E-1 闭合核对
| 项 | 判 | 依据 |
|---|---|---|
| ⑤ `chainParents[role].outpoint` 必须等于 builder 这一输入实际要花的 outpoint | ✅ | txid 统一小写比较、index 与 `vout` 数值比较；形状不合法（缺失 / 非对象 / txid 非 64 位小写 hex / index 非非负整数）单独报"形状不合法"。 |
| **端到端接线**（`used[role].outpoint` 是否就是交易里真正被花的那个输入） | ✅ **我独立验证** | J2 的对照臂只证明"chainParents 也按 B 重算 ⇒ 构造成功"，**看不出 `used` 与真实输入是否同一个**（接线错位时对照臂照样成功）。我的探针对每个角色检查**构造出的交易**：`inputs[idx].previousOutpoint == 声明的 outpoint`（seal：leaf 0 / held 1 / fee 2；close_commit：rootClose 0 / fee 1；convert：rootClose 0 / held 1 / fee 2；claim_draw：rootClaim 0 / ticket 1 / held 2 / fee 3）。**12/12 接线一致；12/12 "证据 A、实花 B ⇒ `ChainParentsError` 且 `.role` 正确"；12/12 对照臂构造成功且交易输入 == B；0 个被既有检查另外拒绝。** |
| 我的 E-1 探针（E 笔审） | ✅ | 同一形态（close_commit 的 fee 角色）现在被拒；J2 在 `11c30eb7` 上先复现了 BEFORE（`builder ACCEPTED`）并存了证据文件——做法对。J2 指出我探针里"A / B 是否出现在交易里"按 txid 字符串判、而 A、B 同 txid 只差 vout，两个布尔值分不出——**认，那两个布尔值确实没有鉴别力**，我上面的探针按 `(txid, vout)` 在输入位置比较。 |
| **变异** | ✅ | 我的 12 个：**12/12 被抓**——index 不比（h1）、txid 大小写敏感（h2）、错字段（h3）、形状放宽（h4 / h5）、**四个 builder 各一处 `used` 接线错位**（h6 seal/fee、h7 close_commit/fee、h8 convert/held、h9 与 h10 claim_draw/ticket 与 held）、整段身份检查去掉（h11 = 回到 E 笔行为）、内部守卫去掉（h12，J2 的 F-06 补的直接单测抓住了它）。 |
| A 笔 SHOULD（NETWORKS 单一来源） | ✅ | relay 侧测试的网络名清单改为 `Object.keys(NETWORKS)`（`shared/lib/kaspa-network.mjs`，与 `configuredNetwork` 同源）。我亲跑：`KASPA_NETWORK=simnet` ALL PASS、`=mainnet` ALL PASS（该测试不连节点）、`=bogus` 与未设 ⇒ LOUD"前提不满足"。 |

## 二、亲跑（独立检出）
`proto-claim-draw` **57/0**、`proto-tx-assembly-settlement` **43/0**、`golden` **12/0（字节不变）**、`proto-settlement-c1` **41/0**、`chain-checks` **51/0**、`pointers` **23/0**——与 J2、Bettor 自报逐项一致。

## 三、J2 的 4 条取舍与"5/12 角色大写 txid 被既有校验拒绝"
1. `index` / `vout` 两个字段名并存（C 侧 `{txid,index}`、builder 入参 `{txid,vout}`）——**接受**，断言里做数值比较；改既有入参形状会扩大范围。
2. chainParents 侧要求小写 txid、builder 侧比较时统一小写——**接受**（C 保证小写；builder 入参来自 DB / 调用方，不保证）。
3. fee 角色的绑定（同一个 `feeUtxo` 既进 `withFeeParent` 又进 builder）——**接受，且这正是 E-1 要强制的**；我的探针证实换掉即拒。
4. NETWORKS——接受。
- **J2 问"5/12 角色大写 txid 被既有布局校验拒绝，要不要另开票"**：**不另开票**。理由：① 方向是 fail-closed（大声拒绝、不会错花）；② D 笔指针模块产出的 txid 恒为小写、C 侧也保证小写，9-2b 走这条链不会触发；③ 唯一现实的触发是"有人手工构造 builder 入参并从 DB 里读到大写 txid"。**记 9-2b 验收**：在 `resolveStepPointers → verifyStepInputsOnChain → withFeeParent → builder` 的接线边界统一把 outpoint 的 txid `toLowerCase()`（一处，不要靠每个 builder 各自容忍），并加一条测试"DB 里大写 txid 进来 ⇒ 边界处被规范化后通过 / 或大声失败，不能静默错花"。

## 没做 / 未证
- 没审 F3 / F4；没起 simnet。
- 我的接线探针只跑"整条链正常路径 + 换一个 outpoint"；各输入位置的既有布局校验（`assertWitnessIndexLayout` 等）我信 J2 与既有测试。
