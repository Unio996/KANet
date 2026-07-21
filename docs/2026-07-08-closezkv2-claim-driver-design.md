> **Status**: CURRENT

# CloseZkV2 claim 生产 driver 设计(缺件1)+ propose 薄壳固化(缺件2)

**作者**: J2 · **日期**: 2026-07-08 · **派工**: Bettor GO(#bjucwr,与市场5彩排稿并行审)· **reviewer**: NWT
**上游依据**: `docs/2026-07-08-market5-first-bet-rehearsal-design.md` §4 缺件1/2 + `docs/2026-07-07-closezk-claim-complete-design.md`(claim entry 本体设计,已落码)

---

## 0. 一句话

`CloseZkV2.sil` 的 `claim` entrypoint(`kasia-console/src/lib/CloseZkV2.sil:145-208`)已落码,但 **零 JS 侧生产入口**——kasia-relay 没有对应 handler,kasia-console 现有唯一 claim builder(`pool-claim-builder.mjs`)是旧 M3 `PoolShard_fold` 模型,结构完全不同,不能复用。本设计补齐 relay handler + console witness builder + relay 命令三层注册,并固化 propose(`publishCloseRequestV2`)薄壳。**不改 `.sil`**(claim entry 已冻结,零改动)。

---

## 1. 既有资产清单(不重造)

| 需要的东西 | 复用来源 |
|---|---|
| claim 的 merkle membership + nullifier + dust 清零逻辑 | `CloseZkV2.sil:145-208`(已落码,逐行照抄 `PayoutShard.sil` claim,§2.4 设计已定稿) |
| **splice-based continuation 模式**(CloseZkV2 是 state-in-address 模板冻结合约,不能像 V1 PayoutShard 那样重编译算新地址,必须在原 redeem_hex 的固定 213B 状态区内 splice) | `unlockBshardZkClose`(`kasia-relay/src/lib/p2sh.mjs:2140-2189`)——唯一已验证过的 CloseZkV2 系 splice 写法 |
| claim witness 字段结构(`selfOutIdx/payoutOutIdx/bettorPk/payout/merkle_index/siblings`)+ nullifier bit-set 算法(`word_idx=merkle_index/63, bit_in=merkle_index%63`) | `unlockBshardPayoutClaim`(p2sh.mjs:1834-1881)+ `unlockBshardRefundClaim`(p2sh.mjs:2265-2310)——两个字段形状与 CloseZkV2.claim 完全一致,只是它们用 V1 的 `_continuationAddress`/`_serializePayoutStateHex` 重编译模式算续约地址,本设计必须换成 splice 模式 |
| self-verify climb == root 的 witness builder 套路 | `pool-claim-builder.mjs:30-58`(`buildClaimWitness` 自验证:装出来的 witness 必须能爬回 payoutRoot,否则本地就拒,不留给 relay/链上才发现) |
| relay 命令 dispatch + 三层注册模式 | `kasia-relay/src/relay.mjs:958-1008`(switch(cmd.type))+ `kasia-relay/src/lib/commands.mjs`(COMMAND_TYPES/PAYLOAD_SCHEMA/FIELD_TYPES,R-COMMAND-REGISTRATION lint 规则强制) |
| propose 薄壳底稿 | `kasia-console/scratch/_j2_3o6cs_close_attest_v2.mjs:194-204`(现有 `publishCloseRequestV2(LMID, req)` 调用,req 手搓硬编码) + `bshard-close-voter.js`(cron/tick 组织模式参考) |

---

## 2. verify-value-source 铁律(Bettor #bjucwr 直接指令,本设计脊柱)

**问题**:CloseZkV2 的 `w0-16`(nullifier bitmap)+ `consolidated_pool` 每次 claim 后都会变,是**逐笔递减/递增的活状态**,不是 genesis 时的静态值。如果 witness builder 从 DB 缓存(`pool_markets.metadata` 里 driver 认为的"当前状态")读这些值,一旦 DB 落后于链上实况(并发 claim / 上一笔 writeback 失败等,同今晚 daemon 审计抓到的静默丢失同一族病),装出来的 witness 会用错误的 nullifier 位去 claim——本地 self-verify 可能都过不去(bit 已置位),或更糟:DB 落后但 bit 恰好还是 0,链上广播后才因为别的字段不匹配失败,浪费一笔 tx。

**铁律**:`w0-16` / `consolidated_pool` / `closed` / `payoutRootField` 全部必须**从当前活 UTXO 的 redeem_hex(链上实况脚本字节)现读现解**,不接受 caller/DB 喂这些值当权威源(DB 可以用来定位"哪个 UTXO",不能用来定位"UTXO 里的值是什么")。

**落地**:新增 `parseCloseZkV2State(redeemHex)`,是 `unlockBshardZkClose` splice 写入逻辑(p2sh.mjs:2160-2169)的**精确反向操作**,读同一套 offset:

| 字段 | offset(状态区内,0-indexed) | 长度 |
|---|---|---|
| attestedWinner | 0(push8 marker)+1 | 8B int64 LE |
| closed | 9(marker)+10 | 8B |
| payoutRootField | 18(push32 marker)+19 | 32B |
| consolidated_pool | 51(marker)+52 | 8B |
| w0..w16(17 word) | 60 起,每 word 9B(1B marker+8B) | 17×9=153B |

总长 213B,与 `unlockBshardZkClose` 的 `newStateBytes.length !== 213` 断言一致。**今晚 72.31KAS 学费的教训(硬编码 offset 过期)直接适用于这张表**——不允许凭这次读码手推的 offset 直接上生产,落码时必须:
1. 从 `unlockBshardZkClose` 现有的 splice 常量/字节构造逻辑**提炼成共享 helper**(而非在新文件里独立重抄一遍这几个数字——今晚 J1 已经抓到一次"两套并行实现"的同类根因,`assertPayoutLeavesConserved` 零调用点 vs enqueue 侧独立重写),`parseCloseZkV2State` 与 `unlockBshardZkClose` 的 splice 逻辑共享同一份 offset 常量。
2. **round-trip 自证**(同 `computeCloseZkTmplAnchor` 4b712f50 修法):splice 写入一组已知值 → parse 读出 → 断言完全相等,进 §4 offline test,不进生产代码前必须绿。

---

## 3. 新增件

### A. `kasia-console/src/lib/closezk-v2-claim-builder.mjs`(新文件)

- `parseCloseZkV2State(redeemHex)` → `{attestedWinner, closed, payoutRootField, consolidated_pool, w0..w16}`(见 §2 offset 表,共享常量)。
- `buildClaimWitness(winnerPkHex, pos, currentState, {bettors, feeLeaves})`(**Bettor #bk28lo 裁定,权威源钉死**):
  - **`payouts`(全量 leaf 列表)禁止从任何 DB payout 缓存表直读当权威**——必须调用 `computePariMutuelPayout({bettors, winningDirection: currentState.attestedWinner, poolTotalSompi: <genesis 时烤入的 pool 值>, feeLeaves})`(`pool-shard-settle.mjs`,与 guest 电路、`zk-prove-enqueue.mjs:75` 同一份公开确定性算法,同函数同参数形状)独立重算出 `payoutLeaves`。
  - self-verify climb(重算出的 `payoutLeaves` + `winnerPkHex`)== `currentState.payoutRootField`(链上现读,§2)——**"重算+链根双锁"**:leaf 集合来自独立重算(同 J1 `zk-prove-enqueue.mjs` L79-84 的 Σleaf 校验纪律),树根来自链上现读绑定,两条独立来源相互印证,不等直接 throw,不喂给 relay。
  - 检查目标 `merkle_index` 对应的 nullifier bit **在 `currentState`(刚才链上现读的)里确实是 0**——本地提前挡重复 claim,不留给链上 `require` 才发现(省一笔失败 tx 的 fee)。
  - `payout ∈ [1, currentState.consolidated_pool]` 守恒前置校验(镜像 zk-genesis-mint 设计 §4 硬门⑤ Σleaf 承重件同一纪律:本地先拦,链上 require 是最后一道防线非唯一防线)。
- `buildClaimCommand({...})` → `{action:'closezk_v2_claim', witness:{...}, inputs:{closezk:{...}, fee:{...}}, outputs:{payout:{...}, change_address}}`,字段命名对齐 `.sil` 形参声明序(`selfOutIdx/payoutOutIdx/bettorPk/payout/merkle_index/s0..s9`)。

### B. `kasia-relay/src/lib/p2sh.mjs` 新增 `unlockCloseZkV2Claim(args)`

- 结构镜像 `unlockBshardZkClose`(splice 213B 状态区)+ `unlockBshardPayoutClaim`(nullifier bit-set + dust 分支)的合体:
  1. `_matchUtxo` 取 `cmd.inputs.closezk.redeem_hex` 对应活 UTXO。
  2. **不信任 `cmd.inputs.closezk.state`(如果 caller 传了)**——handler 自己对刚取到的 UTXO 关联的当前 redeem_hex 调 `parseCloseZkV2State`(console 侧共享同一份逻辑,关键值前端已现读现验,relay 这层是纵深防御第二道,同 `unlockBshardZkClose` 注释"不接受 caller 喂的当前值——防喂假 state 绕过 require"的既有纪律)。
  3. nullifier bit-set:照抄 `unlockBshardPayoutClaim:1847-1851` 的 `word_idx/bitIn/mask` 逻辑。
  4. dust 边界:照抄 `.sil` claim entry §2.4 的 if/else(`consolidated_pool==payout` 时不留 continuation)。
  5. scriptSig:`_pushInt(selfOutIdx) + _pushInt(payoutOutIdx) + _pushBytes(bettorPk) + _pushInt(payout) + _pushInt(merkle_index) + [s0..s9 各 _pushBytes] + OP_3('53') + redeem`。
     - **OP_3 已确认(T0.3 实测,2026-07-08 J2)**:双重坐实——①源码级:silverc `compile.rs:259-262` 逐 entry `add_i64(entrypoint_index)`+`OpNumEqual` if/else 链,`entrypoint_index` 按 `.sil` 声明序 0-based(0:zk_close/1:escape_trigger/2:escape_claim/3:claim),`add_i64(3)` 编码为标准 script-number push `OP_3='53'`。②实测级:`cli-debugger --run-all` 对既有 `CloseZkV2.test.json` 8/8 通过,含 claim 3 个负向用例(wrong-merkle-proof/`closed==3` 应拒绝[证不会误路由到 `escape_claim`]/double-claim),证 claim 分支正确路由、与相邻 entry 不串。`OP_3='53'` 不再是设计推导,是实测确认值。

### C. 命令注册(R-COMMAND-REGISTRATION,`lint-kanet.mjs` 强制)

- `commands.mjs`:`COMMAND_TYPES.CLOSEZK_V2_CLAIM='closezk_v2_claim'` + 对应 `PAYLOAD_SCHEMA`/`FIELD_TYPES` 三层。
- `relay.mjs`:新增 `case 'closezk_v2_claim'` 分支,镜像 958-1008 行既有 case 的动态 import + `process.send` 回传形状。

### D. 缺件2 — propose 驱动薄壳固化

- `bshard-close-transport.mjs` 新增 `buildProposeCloseRequestV2(marketId)`:读 DB 实况(PayoutShardV2 当前 UTXO/state、deadline、betsRoot 等,同 `_j2_3o6cs_close_attest_v2.mjs` 第194行前的手搓逻辑,改成从 `pool_markets`/live UTXO 读而非硬编码),组好 `req` 后调用既有 `publishCloseRequestV2(marketId, req)`(零改动,只是不再手搓 req)。
- 定位为**薄壳**:可被 Bettor/操作者手动踢一次调用(市场5 T2.2),也可被未来 propose 自治 cron 调用(cron 本身仍是排在市场5之后的独立卡,不在本设计范围,同市场5设计稿 §2 T2.2 措辞"driver 薄壳踢一次,诚实口径")。
- **Bettor #bk28lo③非阻塞裁定**:读 DB 组 req 本身可接受(voter 层 C1 链锚 fail-closed 是真执法者,昨晚已实证拒得对——同一纪律精神),但**能便宜链推导的字段优先链推导、不图省事直读 DB**——具体到本函数:`betsRoot` 用 `computeBetsRoot(canonicalBetOrder(bettors))`(`pool-payout-root.mjs`,`zk-prove-enqueue.mjs:19` 同款调用)现推导,不读 `pool_markets` 里 driver 可能写错/过期的缓存字段;`deadline_daa`/当前 UTXO outpoint 这类必须查 DB 才知道"哪一个"的字段(定位性质,非可推导值)维持读 DB。

---

## 4. offline byte-exact self-test(仿卡2 `_j2_card2_submit_v2_byteexact_test.mjs` 套路)

1. **round-trip 测试**(§2 要求,BLOCKING):splice 写入已知值(任意 attestedWinner/closed/payoutRootField/consolidated_pool/w0-16 组合)→ `parseCloseZkV2State` 读出 → 断言与写入值完全相等。覆盖 w0-16 至少一个非零 word(不能只测全零 genesis 态)。
2. **claim witness self-verify 正向**:构造 2-3 个 winner 的 payoutRootField 树,`buildClaimWitness` 对每个 winner 产出 witness,climb 验证全部通过。
3. **claim witness self-verify 负向**:篡改一个 sibling → climb 应该不等 → `buildClaimWitness` 应该 throw(证明本地拦截生效,非纸面)。
4. **dust 边界**:最后一个 claimant `consolidated_pool==payout` 场景,验证不产生 continuation。
5. **nullifier 防重复(本地层)**:同一 merkle_index 第二次调用 `buildClaimWitness`(用 claim 后的新 `currentState`)应在 §3.A 的 nullifier-bit-已置检查处提前 throw,不用等链上 BUST。
6. 全部跑在 kasia-console 现有的 offline test 框架下(gitignored scratch,同卡2 惯例),lint-kanet 0 error。

---

## 5. 风险/边界(诚实标注)

- 本设计**只补 JS 侧 driver**,`CloseZkV2.sil` 零改动(claim entry 已冻结)。
- OP_3 selector 值已经 T0.3 独立验证确认(源码+实测双重坐实,见 §3.B),不再是待定项。
- `closed==2` 无 deadline 级逃生舱(市场5设计稿 §3.1 选项A)不因本设计改变——本设计让 claim **能被正确调用**,不改变"claim 本身若有边界 bug 则无退路"这条已知风险,那条风险的缓解手段(dust E2E 先行 + cli-debugger 验证)仍按市场5设计稿 §1 走。
- propose 薄壳(缺件2)只固化"手动踢一次"的调用面,不包含自治 cron——按上游设计稿保持诚实边界。

---

## 6. 签字区

- J2(设计): ✅ 2026-07-08
- NWT(红队 verdict): 待
- Bettor(GO): 待
