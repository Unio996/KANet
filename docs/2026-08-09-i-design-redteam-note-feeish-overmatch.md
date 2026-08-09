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

🔵 **关键补充(校准: 这不是"你不懂",是同一份稿两段自相矛盾)`[CONFIRMED·稿内实读]`**:
(i) 稿 **§DoD①(line 144-150)J1 自己就把 `minerFee` 列为 CONTROL、把 `brokerFeePct`/`oracleFeePct` 列为 SUBJECT**,并结论 SUBJECT "UNCHANGED ⇒ 不在 redeem"。
⇒ **J1 本人清楚 minerFee ≠ 市场费率**(正是拿它当对照组,因为它总被绑)。
🔴 **但 §2 底账(line 10/49-50)把那几行 `==makerStakeAmount−minerFee` 数成"3 个让【市场承诺的费率】绑住花费"** —— 这跟他自己 §DoD① 的分类**直接打架**: §DoD① 说市场费率(broker/oraclePct)根本不进 redeem、从不被绑,§2 却说有 3 个绑住了。
⇒ 病根是**枚举器 PER-MARKET(eq) 把 minerFee 和费率混为一谈(FEEISH=/fee/i),§2 头条继承了这个混淆**。按 §DoD① 那半(权威、且与 R-3 一致),市场费率口径 = **0/21**。两段取 §DoD① 为准、§2 随枚举器修正后对齐。

### MF-1 与 Codex 独立收敛（两条 lane 撞同一个根 · 高置信）`[CONFIRMED·Codex审实读]`
Codex 独立审(`RESPONSE-20260808-UNSYNCED-PRECOND4-FEE-AUTHORITY-CODEX-REVIEW.md` §3,02:05Z,**在本 catch 之前**)已判枚举器 `classify()` 有 **too-wide 假阳性 MUST-FIX**,根因描述与本 note 完全一致(`==` 不查花费侧)。Codex 举的例子恰是 `require(minerFee == maxAllowedFee)`。
🔴 **但 Codex 用的是"a future line(未来某行)"假设语气——它判了机制缺陷、没发现【当前那 3 个 PER-MARKET(eq) 已经全是 minerFee 假阳性、头条 3 此刻就是错的】。** 本 catch 补的正是这半:**不是"将来可能",是"现在 0/21 而非 3/21"**。⇒ 两条独立 lane 同根 = 修法无争议:`classify()`→`PER-MARKET(eq)` 必须机械证明**同一条 require 里两侧都在**(市场承诺的费率/bound ∧ 承载花费的 `tx.outputs[..].value` 或显式枚举的 money-flow 原语),用小型 AST/数据流,不用行正则(Codex §3 MUST-FIX 原文)。

## MF-2 🟡 枚举器不可复现: 默认路径是死的,且 PoolSpine*.sil 不在主树 `[CONFIRMED·实跑复现]`

- `const DIR = process.env.FEE_ENUM_DIR || 'D:/kanet/kanet/kasia-console/src/lib'`(:23)——该默认路径**本机不存在**(`ls` ⇒ No such file or directory)。
- 且 `PoolSpine*.sil` **只在 J1 worktree**(`.claude/worktrees/agent-*/kasia-console/src/lib/`),**主树 `kasia-console/src/lib/` 无 PoolSpine 文件**。
- ⇒ 设计稿写的"复现: `node scripts/fee-authority-enumerate.mjs`"**红队在主树跑不出来**(要么路径报错、要么扫空),直接破坏 DoD"机械可复验"。
- **修法**: 默认路径改成相对本仓可解析的位置,或在稿里注明必须 `FEE_ENUM_DIR=<worktree>/kasia-console/src/lib`;并说明 spine 源为何只在 worktree(是否该进主树是另一问题,挂 J1)。

## 不影响的部分(如实标)
- J2 "过窄"那条**已修好**: `detectLiteralFeeBound` 正确把 `tx.outputs[].value ± 字面量` 判为 `GLOBAL-LITERAL`,与 `NO-FEE-CONSTRAINT` 区分开了——实跑见 v07/v08/v0_7_1 的 refund 均判 GLOBAL-LITERAL,对。
- DoD①(`fee-mutation-test.mjs`,带对照、pinned compiler,证 unreferenced ctor fee 不进 redeem)独立成立,不受本 note 影响。
- 作用域自纠(3 版本→7 spine)对,枚举器扫 `PoolSpine*.sil` 不写死版本,对。

## 修复记录(2026-08-09 · Bettor-dispatch · 只改诊断脚本,不碰 covenant/结算/DB/链上)`[实跑]`

MF-1 与 MF-2 均已修 `scripts/fee-authority-enumerate.mjs`(唯一改动文件):
- **家族分类**:每个 fee-ish ctor 参数经 `feeFamily()` 分为 `market`(brokerFeePct/oracleFeePct,匹配 `/pct$|bps$/i` 或 broker/oracle/maker+fee)/ `network`(minerFee/maxChunkFee,匹配 `/miner|chunk/i`)/ `unknown`。`minerFee` 不再计入市场费率。
- **结构化 `==` 判定**(取代裸行正则):`splitTopLevelComparison()` 在括号深度 0 找比较符,`analyzeLine()` 只有当同一条 require 的 `==` 一侧是花费原语 `tx.outputs[..].value`、另一侧含该参数时才判 `bindsSpend`。**PER-MARKET(eq) 仅当 market 家族参数如此绑住花费**;minerFee 的等值绑定单列 `NETWORK-FEE(eq-binds-spend)`,不计入。
- **DIR 死路径修复(MF-2)**:默认路径由 `import.meta.url` 解析到本仓 `kasia-console/src/lib`(spine 文件现已 tracked 进主树),`FEE_ENUM_DIR` 仍可覆盖;缺目录/缺文件时明确报错 exit 2。

**重跑真实 .sil(主树 7 个 PoolSpine,`node scripts/fee-authority-enumerate.mjs`)关键数字**:
- **市场费率(brokerFeePct/oracleFeePct)口径 PER-MARKET(eq) = 0 / 22**(坐实红队订正的 0/N;主树现有 22 个 money-moving 入口,非 note 写的 21——版本快照差,如实标)。broker/oraclePct 在所有 PoolSpine 入口里**从不出现在任何 require**(仅 ctor 声明+注释)⇒ 全 `NO-FEE-CONSTRAINT`/`GLOBAL-LITERAL`,无一 PER-MARKET(range)。
- 原先 4 个假阳 PER-MARKET(eq)(PoolSpine 3 + v06 1)现全部归入 **NETWORK-FEE(eq-binds-spend)**;v06/v07/v08_agg 的 `minerFee>0 / <1e8` 与 v08_chunk 的 `chunkMinerFee<=maxChunkFee` 现判 **NETWORK-FEE(range)**(原误报 PER-MARKET(range))。
- `GLOBAL-LITERAL`(v07/v08_agg/v08_chunk refund、v0_7_1 settle+refund)不受影响,保持。

**阴性对照(证没修过头,`FEE_ENUM_DIR=<scratch>` 合成 .sil)**:同一合约三入口——
`require(tx.outputs[1].value == spendable * brokerFeePct / 10000)` ⇒ **PER-MARKET(eq)**(真绑定仍被抓,✓);
`require(tx.outputs[0].value == makerStakeAmount - minerFee)` ⇒ NETWORK-FEE(eq),非 PER-MARKET(✓);
`require(oracleFeePct >= 500)` ⇒ PER-MARKET(range)(市场费率 sanity-check 与网络费 range 区分,✓)。

**诚实边界**:仅静态行级模式匹配单行 require;本合约族无多行 require,故未实现跨行拼接。`unknown` 家族当前为空(无未分类 fee 参数)。未改任何 .sil、covenant、结算或 DB。
