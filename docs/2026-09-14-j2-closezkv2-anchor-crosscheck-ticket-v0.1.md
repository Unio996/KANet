> **Status**: DRAFT-FOR-REVIEW v0.1

# T-ANCHOR-XCHECK — `closeZkTmplAnchor` 与真实铸造产物交叉校验票 v0.1

**范围**：docs-only，不落码（Bettor 1293 派工，从 T-CLOSEZK-ATMS-WIDTH §1 拆出，见该票 §6 拆票说明的
依赖关系）。

## 0. 跟 T-CLOSEZK-ATMS-WIDTH 的关系（先说清楚，避免两票被当成重复工作）

T-CLOSEZK-ATMS-WIDTH 解决的是**一个字段**（`attestedAtMs`）的编码宽度会不会意外变化；本票解决的是
**anchor 机制本身**（覆盖 `gateTmplHash`/`tokenTmplHash`/`claimTmplHash`/`marketSuffixHash`/
`attestedAtMs`/`betsRootBaked`/`refundRootBaked` 全部相关字段）算出来的值，跟"用真实值实际铸造出来的
`CloseZkV2` 产物"是否真的一致——本票是**更宽、更强**的正确性校验，会把前一票要防的问题当成特例覆盖，
但落地位置、涉及字段范围、需要改的文件都不同，独立排期。两票互不阻塞，任意顺序可落码；若都做，推荐
先落 T-CLOSEZK-ATMS-WIDTH（更早、更聚焦的位置捕获问题，报错更好定位），本票作为兜底。若只做一个，
本票覆盖面更完整、优先级更高。

## 1. 现状（读源码核实）

`closezk-v2-mint.mjs:buildCloseZkV2GenesisFromAttestedState` 是唯一把 `computeCloseZkTmplAnchor`
（dummy 值算 anchor）和 `compileCloseZkV2Redeem`（真实值真编译）**同时**调用的地方：

```js
export function buildCloseZkV2GenesisFromAttestedState(psv2RedeemHex, gateTmplHash, tokenTmplHash, claimTmplHash, marketSuffixHash) {
  const state = readPayoutShardV2AttestedState(psv2RedeemHex);
  const anchor = computeCloseZkTmplAnchor(CLOSEZK_V2_SIL, gateTmplHash, tokenTmplHash, claimTmplHash, marketSuffixHash);
  const redeemHex = compileCloseZkV2Redeem({ gateTmplHash, betsRootBaked: state.betsRootHex, refundRootBaked: state.refundRootHex,
    attestedAtMs: state.attestedAtMs, attestedWinner: state.attestedWinner, consolidatedPool: state.consolidatedPool,
    tokenTmplHash, claimTmplHash, marketSuffixHash });
  return { redeemHex, anchorHex: anchor.anchorHex, ... };
}
```

两次调用**各自独立**产出结果，函数直接把两者原样返回给调用方，**中间没有任何代码比较过它们是否真的
互相吻合**。`anchor.anchorHex` 的语义（per `computeCloseZkTmplAnchor` 的设计）应该是"`CloseZkV2` 模板
部分（排除 `attestedWinner`/`closed`/`consolidatedPool`/`betsRootBaked`/`refundRootBaked`/
`attestedAtMs` 这些 attest 时才知道的值）的 hash，理论上**应该**能从 `redeemHex`（真实编译产物）用
同样的切分规则重新算出来、且结果一致"——但目前完全是**假设**，从未被验证过。

**为什么这不是"理论洁癖"**：`gateTmplHash`/`tokenTmplHash`/`claimTmplHash`/`marketSuffixHash` 这四个
值同时喂给了两次调用（同一份调用方传入的值，本身不会不一致）——但 `computeCloseZkTmplAnchor` 和
`compileCloseZkV2Redeem` 是**两个独立实现**（各自组装 ctor 数组、各自调用 `compileSilV100`），如果
未来任何一处的 ctor 字段顺序/数量跟 `.sil` 实际声明的 ctor 参数表出现哪怕一个位置的偏差（这正是本
session 全程反复出现的错误模式——ctor 漂移），两次调用会分别产出**内部各自自洽但彼此不匹配**的结果：
`compileCloseZkV2Redeem` 不会报错（它只管把给的值编译成字节，不知道"应该"跟 anchor 对上），
`computeCloseZkTmplAnchor` 自己的 round-trip 自证也不会报错（它只验证自己内部的 dummy 值重建一致，
不知道另一个函数的产物长什么样）——**两边各自绿，但合在一起是错的**，这正是交叉校验存在的意义。

## 2. 最小实现形式（Bettor 1293 原话）

铸造时（即 `buildCloseZkV2GenesisFromAttestedState` 内部，两次调用都完成之后）新增一步：**从
`redeemHex`（真实编译产物）里，用跟 `computeCloseZkTmplAnchor` 内部完全相同的切分规则（`extract
TemplateArtifact` 定位 state 区 + `findUnique` 定位 `betsRootBaked`/`refundRootBaked`/
`attestedAtMs` 三个 marker），把"模板部分"重新切出来，跟 `anchor.anchorHex` 的输入（`templateA+
templateB+templateC+templateD`）做逐字节比较（或者直接比较两边各自算出的 blake2b hash）——不一致
直接 throw，不产出这次铸造的任何后续状态。**

### 需要的前置小改动（不是新设计，是让现有代码能支持这个校验）

- `compileCloseZkV2Redeem` 目前**只返回一个 hex 字符串**（逐行核实原文就是
  `return Buffer.from(compileSilV100(CLOSEZK_V2_SIL, ctor, 'CloseZkV2').script).toString('hex');`，
  `compileSilV100` 自己返回的 `state_layout`/`_raw`/`template_hash_bytes` 全部被这一行丢弃），要做
  交叉校验需要拿到底层 `compiled` 对象（含 `state_layout`/`_raw`，供 `extractTemplateArtifact` 用）——
  这不是新逻辑，是让这个已有函数额外暴露一份它已经算出来但目前没往外传的中间产物（类似很多既有函数
  已经在做的"顺手多带一个字段出去，不重新算一遍"的模式，本 session 的 `bshard-close-transport.mjs`
  `ps` 查询扩展也是同一手法）。
- `computeCloseZkTmplAnchor` 内部的 `findUnique`/切分逻辑目前是该函数的**私有实现细节**（闭包在函数
  内部，没有导出）——要让一个新的交叉校验函数复用同一套切分规则（对**真实值**而不是 dummy 值跑一遍），
  需要把这部分逻辑抽成一个参数化的共享 helper（接收"要找哪几个 marker 的字节内容"作为参数，而不是
  硬编码 dummy 值），`computeCloseZkTmplAnchor`（喂 dummy）和新的交叉校验函数（喂真实值）各自调用同一个
  helper，不是复制粘贴一份改几个变量名——同 K-18/`deriveCommitteeCheckOffsets`"单源不重复发明"的既定
  纪律。

### 失败处置

`buildCloseZkV2GenesisFromAttestedState` throw，不返回 `redeemHex`/`anchorHex`——铸造流程在这一步
就被拦下，不会产出一个"内部自洽但跟 genesis 时的承诺对不上"的 `CloseZkV2`。跟 T-CLOSEZK-ATMS-WIDTH
一样，属于"花钱/铸造前硬门"的处置口径（throw = 拒绝，不是崩溃，同 K-18 拒签闸/`assertZkHandoffTmplCoherent`
既定纪律）。

## 3. 对已有模板锚点 / 主网现状的影响

同 T-CLOSEZK-ATMS-WIDTH §3——主网零市场，现在落地零迁移/兼容成本。

## 4. 推荐

落地本票的"最小实现形式"（Bettor 1293 原话），不需要额外选项对比——这本身就是"给一个从未被验证过的
假设加一次直接验证"，没有"要不要做"的技术权衡，只有"什么时候排"的优先级问题（见 §0 依赖关系）。

## 5. 验收标准（供落码时核对，本票不落码）

1. 正向：真实（测试用固定值）ctor 字段跟 dummy 版本切分规则一致时，交叉校验通过，`buildCloseZkV2
   GenesisFromAttestedState` 行为不变（现有 `closezk-v2-mint.e2e.test.mjs` 11/11 应保持全绿）。
2. 负向：人为构造一个"两次调用用了不一致输入"的场景（比如给 `compileCloseZkV2Redeem` 喂一个跟
   `computeCloseZkTmplAnchor` 不同的 `gateTmplHash`，模拟"两处实现意外不同步"这个真实故障模式）——交叉
   校验必须抓到并 throw，不能因为两边"各自内部自洽"而放过。
3. 报错信息含"anchor 跟真实产物不一致"的明确说明 + 可能原因提示（ctor 字段顺序/数量漂移），不是笼统
   "校验失败"。
4. lint 0 error；`compileCloseZkV2Redeem` 返回形状的改动（若采用 §2 的前置小改动）需要确认所有既有
   调用点（`grep` 全仓）没有假设它"只返回一个字符串"这种解构方式被破坏——若有其它调用点只需要 hex
   字符串，保持向后兼容（比如返回 `{redeemHex, compiled}`，既有解构 `const redeemHex = compileCloseZkV2Redeem(...)`
   这种写法需要相应改成 `.redeemHex`，本票只标出这个改动面，具体怎么改留给落码时按当时的既有调用点
   实际情况定）。
