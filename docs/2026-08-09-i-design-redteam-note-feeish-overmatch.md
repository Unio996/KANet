> **Status**: RED-TEAM NOTE (Bettor → J1) · design-only · 针对 `docs/2026-08-09-per-market-fee-authority-design-v0.1.md` (i) + `scripts/fee-authority-enumerate.mjs`
> **性质**: 零改码建议以外零动作。两条 MUST-FIX,一条会**改 (i) 头条数字**。
> **证据分级**: `[CONFIRMED·实跑复现]` = Bettor 指向真实 worktree .sil 亲手复现。

# (i) 红队 note — FEEISH 过匹配把 minerFee 当成市场费率 + 枚举器不可复现

## MF-1 🔴 头条「3/21」是假的,真值是 0/21 —— FEEISH 过宽把 `minerFee` 记成了市场费率 `[CONFIRMED·实跑复现]`

**现象**: `scripts/fee-authority-enumerate.mjs` 报 3 个入口 `PER-MARKET(eq)`(= "该市场承诺的费率等值绑定实际花费"),(i) 头条据此写"21 个里只有 3 个让市场自己的费率绑住花费"。

**实跑 `--json` 核到,这 3(+v06 那个共 4)个 `PER-MARKET(eq)` 全部由同一个参数 `minerFee` 触发**:
```
PoolSpine.sil::refund_unanimous_silent   param=minerFee  :139  require(tx.outputs[0].value == makerStakeAmount + oracleBondAmount*3 - minerFee)
PoolSpine.sil::refund_maker_unjoined     param=minerFee  :151  require(tx.outputs[0].value == makerStakeAmount - minerFee)
PoolSpine.sil::refund_disagreement       param=minerFee  :217  require(tx.outputs[0].value == makerStakeAmount - minerFee)
PoolSpine_v06.sil::refund_maker_unjoined param=minerFee  :285  require(...== makerStakeAmount - minerFee)
```

**根因**: `const FEEISH = /fee/i`(:29)匹配到 `minerFee`(含 "Fee")。于是 `feeParams` 里混进了 `minerFee`。

🔴 **但 `minerFee` 不是 R-3/(i) 讲的那个"费率"**:
- R-3 全程针对的是 **maker/oracle 费率**(policy schema `maker_fee_bps`/`oracle_fee_bps` → ctor `brokerFeePct`/`oracleFeePct`)。
- `minerFee` 是**网络交易费**(给矿工的 tx fee),每个 covenant 实例烤死的一个常量,**与市场的费率政策是两个量**(同 [[reference-one-name-several-different-things]])。
- ⇒ 把 `require(outputs.value == makerStakeAmount − minerFee)` 记成"市场费率绑住花费",是拿**网络费**冒充**市场费率权威**。

🔴 **对真正的费率口径(`brokerFeePct`/`oracleFeePct`)复核: 它们的 `require-EQ` 命中数 = 0**。它们最多在 v06/v07 的 settle_aggregate 里是 `PER-MARKET(range)`(只 sanity-check,不绑花费),从没等值绑过花费。

**⇒ 结论订正(方向: 比头条更严,不是更松)**: 按 (i) 真正针对的 maker/oracle 费率,**"让市场自己的费率绑住花费"的入口是 0/21,不是 3/21**。这让 (i) **更必要**(现存零权威),但设计稿的底账句必须改——现在它把一个不存在的"3 个已有权威"报给了读它的人(含 Owner)。

**修法(给 J1)**: FEEISH 要把 `minerFee` 排除(它是网络费不是费率),或单列一类 `NETWORK-FEE` 不计入 `PER-MARKET(eq)`;重跑;(i) 头条 3→0 改写 + §2 底账表同步。

## MF-2 🟡 枚举器不可复现: 默认路径是死的,且 PoolSpine*.sil 不在主树 `[CONFIRMED·实跑复现]`

- `const DIR = process.env.FEE_ENUM_DIR || 'D:/kanet/kanet/kasia-console/src/lib'`(:23)——该默认路径**本机不存在**(`ls` ⇒ No such file or directory)。
- 且 `PoolSpine*.sil` **只在 J1 worktree**(`.claude/worktrees/agent-*/kasia-console/src/lib/`),**主树 `kasia-console/src/lib/` 无 PoolSpine 文件**。
- ⇒ 设计稿写的"复现: `node scripts/fee-authority-enumerate.mjs`"**红队在主树跑不出来**(要么路径报错、要么扫空),直接破坏 DoD"机械可复验"。
- **修法**: 默认路径改成相对本仓可解析的位置,或在稿里注明必须 `FEE_ENUM_DIR=<worktree>/kasia-console/src/lib`;并说明 spine 源为何只在 worktree(是否该进主树是另一问题,挂 J1)。

## 不影响的部分(如实标)
- J2 "过窄"那条**已修好**: `detectLiteralFeeBound` 正确把 `tx.outputs[].value ± 字面量` 判为 `GLOBAL-LITERAL`,与 `NO-FEE-CONSTRAINT` 区分开了——实跑见 v07/v08/v0_7_1 的 refund 均判 GLOBAL-LITERAL,对。
- DoD①(`fee-mutation-test.mjs`,带对照、pinned compiler,证 unreferenced ctor fee 不进 redeem)独立成立,不受本 note 影响。
- 作用域自纠(3 版本→7 spine)对,枚举器扫 `PoolSpine*.sil` 不写死版本,对。
