# W2 草稿：committee attest 工具链扩展到 ZK-native 4 新字段

**作者**: J2 · **日期**: 2026-07-07 · **Status**: DRAFT，仅供 NWT/Bettor 概念审——**不合并**（Bettor 明确指示，今天先跑通 demo 市场，这条并行准备，不阻塞开盘）。

## 背景

`PayoutShardV2.sil` 的 `close_attest` 比原版多 4 个委员签名覆盖的 witness 字段：`new_attestedWinner`/`new_betsRoot`/`new_refundRoot`/`new_attestedAtMs`。委员侧的验证-后签名工具链（`bshard-close-enforce.mjs` 的 `enforceCloseAttest`）目前只验证 `claimedPayoutRoot`（既有 payoutRoot 重导出 + D2 tx-binding），完全不知道这 4 个新字段的存在——委员如果盲签任何提议值，等于把"谁真的赢了/betsRoot 对不对"这类判断权让渡给了 settler，违反 `enforceCloseAttest` 整个文件的核心哲学（委员必须自己独立重算，不信 caller）。

## 现状精读（`enforceCloseAttest`，`bshard-close-enforce.mjs:126-228`）

现有验证链（committee_pk 归属 → predicate hash-bind → frozen evidence 自取 → judgeLine 自判 winningDirection → 链锚委员重导出 → 完整 bettor 集验证 → payoutRoot 重导出 → **D2: 从被签 tx 的 covenant continuation output 反解 P2SH-embedded payoutRoot，验证它 == 重导出值（sighash 覆盖，非标量比较）** → C3 tx-hash 绑定）已经是全系统最严格的验证链之一，4 个新字段应该嵌入这同一条链，而不是另起一套。

## 4 个新字段各自的验证来源（不新造，复用已证函数）

| 新字段 | 验证来源 | 复用的既有函数 |
|---|---|---|
| `new_attestedWinner` | **已经算出来了**——line 168 的 `winningDirection`（judgeLine 自判结果）就是它，直接复用，不是新逻辑 | `judgeLine`（已在用） |
| `new_betsRoot` | 委员自己 gather 这个市场的全部链上 bets，按既有 hash-chain 公式重算 | `gatherOrderedBets`(`zk-close-builder.mjs:77`，J2 域，今天已验证) |
| `new_refundRoot` | 委员用同一批 bettor 数据（pk+stake），按既有 depth-10 merkle 公式重算 | `payoutLeaf`/`payoutRoot`(`pool-payout-root.mjs:39,84`，955 赢家验证过) |
| `new_attestedAtMs` | 不是可重导出的确定性函数（"此刻"没有唯一正确值）——委员做**范围检查**：落在 `[deadline_daa 对应时间, deadline+合理窗口]` 内，且落在 zk_handoff 的稳定值域 `[2^40,2^47)` 内。**~~信任级别按 committee-attested，跟其余 3 个字段同级~~**（Bettor 2026-07-07 裁定纠正：一旦这个字段被 5-签 sighash 覆盖，它就是委员集体背书的值，验证*方式*是范围检查≠信任*级别*更低——这是我这版草稿的框架错误，误把"今天早些讨论过的某个(ii)退路"的降级标注套到了这个主案上，两者不是一回事） | 无(需要新写一个 bounds sanity check，非重导出，但产出的 pass/fail 判断权重跟其它 3 个一致) |

## D2-style tx-binding 扩展（承重项，非装饰）

现有 D2 检查（`verifyClosePayoutRootBinding`）只反解 payoutRoot 这一个字段。扩展后需要能从被签 `txSafeJson` 的 continuation output 反解出全部 4 个新字段的 embedded 值（PayoutShardV2 的 state splice，跟 W1 已经验证过的 byte-exact 手法完全一致——`serializeCloseZkV2State` 风格的偏移量，而非重新发明），逐个跟委员自己重算的值比对，任何一个不匹配都 fail-closed 拒签。**这是防"settler 给匹配的标量参数 + 输出 tx 里塞了不同的值"这类绕过的唯一防线**，不能只做参数级比较（同 D2 注释里已经写透的教训："旧码只标量比较被绕过"）。

## 开放问题①：Bettor + NWT 对齐收口（2026-07-07 23:44，非分歧——三个维度分开标）

初看 Bettor（"不需要降级标注"）与 NWT（"要加信任标记"）像是相反结论，双方交叉核对后确认：**不是冲突，是三个不同维度被压缩成一句话才显得矛盾**。最终口径（Bettor+NWT 联合签字，三行分开写，谁也不压缩谁）：

- **① 信任来源**：`attestedAtMs` = committee-attested（5 签 sighash 覆盖，跟 `payoutRoot`/`betsRoot`/`refundRoot` 同级，非 driver-baked）——**不降级**。
- **② 验证方法**：range-check-verification（链上只验落在 `[2^40,2^47)` 值域，非其余 3 个字段用的 exact-rederive-and-compare）——covenant 无法自读"此刻时间"，这是 parser 实测出的技术上限，不是设计弱点。
- **③ 下游消费范围**：`attestedAtMs` 只喂 `escape` 的 GRACE 计算，**不进 `zk_close` 核心 journalHash**——因此"②验证方法弱于重导出比对"这个残余问题的兑现场景仅限 `escape`，`zk_close` 主链路不受影响。已并入 escape 上生产前置清单（wiring 文档 §2.6，补第四条：attestedAtMs 锚定验证补齐，或 Owner 明确知情接受这条残余风险）。

## 开放问题②：拆独立函数（Bettor+NWT 一致同意，含具体实现路径）

**`enforceCloseAttestV2` 拆独立函数**，跟今天全线"结构隔离"哲学一致（`PayoutShardV2.sil` 本身就是全拷贝，同一笔 trade 已被接受）。**配两条防分叉发散的机制**（Bettor："9 步验证链是全系统最重安全资产，复制它的分叉风险要用机制管住而不是当没看见"）：
- (a) 两个函数头部写**互相交叉引用注释**（"改这条验证链必须同步检查 V1/V2 对应版本"），仿照 `PayoutShard.sil`↔`PayoutShardV2.sil` 现有的关系标注手法；
- (b) 记录一条后续重构工单——"抽取共享核心验证链 + V1/V2 各自的薄 wrapper"——**等 ZK-native 跑稳后再做，明确不是今天**。

**具体拆分路径（NWT 给出）**：把 `enforceCloseAttest` 第 126-222 行那段公共验证链（committee 归属 → predicate hash-bind → frozen evidence → judgeLine → 链锚重导出 → bettor 集验证 → payoutRoot 重导出）提成一个内部 helper；`V1`/`V2` 两个导出函数各自只处理自己专属的最后一段（V1 到 payoutRoot 为止；V2 额外核 4 个新字段 + 扩展 D2）。这样公共逻辑改一次两边都受益，不会出现"将来 V1 修了 bug、V2 忘记同步"这种 drift。

**NWT 概念审确认**（Bettor 指定重点）：4 个新字段确实嵌进同一条既有验证链（committee 归属→predicate hash-bind→...→D2 tx-binding→C3），D2 扩展正确要求"反解 continuation output 实际 embedded 值逐个比对"而非只比对 witness 参数——这正是 D2 机制本来要防的绕过手法，不是旁路验证。方向 GREEN。

## 范围声明

这份草稿不包含：committee judge 工具链具体怎么改造去"顺手多算这两个哈希+多签一次"的实现细节（那是签名脚本/relay 侧的活，W2 的另一半，今天没有排期）；`bshard-close-voter.js` 的 `processCloseRequest` 怎么把这 4 个新字段接进实际签名请求（依赖上面开放问题①②的结论）。今天只到"验证逻辑该长什么样"这一层，供团队清醒时接续。
