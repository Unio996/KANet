# NWT 红队 — 积压两族处置设计(1b174d6c)

> **Status**: CURRENT
> **对象**: docs/2026-07-12-backlog-null-deadline-and-fifth-layer-disposal-design.md(J2)
> **verdict**: **RED——SQL 安全闸不完整(活库实测,非假设),漏排除多个真实存在的终态/进行中状态;数字矛盾(13 vs 14)必须先厘清才能 dry-run。MUST-FIX 后重审**

---

## H1 🔴 MUST-FIX(SQL 安全闸不完整,活库实测): 黑名单排除表遗漏多个真实存在的终态/进行中状态

§2.1 的安全闸 `protocol_status NOT IN ('completed', 'pruned_expired_waived', 'manual_recovery_refunded', 'settle_failed', 'cancelled')` 只列了 5 个值。**我查活库 `pool_markets` 的全部 distinct `protocol_status`(只读,非猜测)**:

```
shard_internal(1303) / refunded(907) / pending_bettors(491) / archived(321) / completed(260) /
settle_zombie_quarantine(189) / pruned_expired_waived(127) / cancelled(59) / refunding(51) /
settle_failed(49) / verifying(29) / pending_oracle_deposits(10) / attested_v2(9) / disputed(4) / collecting_sigs(1)
```

**排除表漏了活库里真实存在、且明显不该被此 UPDATE 覆写的值**:
- `refunded`(907 行,真终态)——若目标 id 里任一实际已是 `refunded`(比如身份核实/清单生成有误差),这条 UPDATE 会把"已完成退款"的市场状态**静默覆写**成 `pruned_expired_waived`,丢失"这盘真的退过款了"这个事实,直接违反设计自己 §2.1 强调的"NO TX NO STATE 语义,没转账不能叫退款"——反过来说也成立:**已经真转过款的不能被静默改成"没转账"**。
- `refunding`(51 行,**进行中**的转账状态)——若目标恰好命中一个当前活跃转账中的市场,状态被覆写可能扰乱正在监视这个转场转换的 daemon 逻辑,风险等级高于"覆写已终态"(那个只是记账错误,这个可能干扰活跃资金流程)。
- `disputed`(4 行)/`archived`(321 行)/`settle_zombie_quarantine`(189 行)——同样不在排除表里,同样不该被这条 UPDATE 静默覆盖。

**这是黑名单防护的结构性弱点(今晚第三次撞到同一模式**:反馈工具面 allow-list vs 黑名单/trading.js type 排除表/现在这里)——**枚举"已知终态"天生不完备,尤其像本例这样列表是设计者凭记忆写的、没有对照活库实查**。

**修法(改白名单,不改黑名单)**:§1 表已经明确写了目标市场应处的状态(`verifying`/`pending_bettors`)——guard 应该是**白名单**:
```sql
AND protocol_status IN ('verifying', 'pending_bettors')
```
这样无论目标 id 清单里意外混进什么状态的市场(`refunded`/`refunding`/`disputed`/别的),只要不精确匹配"这批市场理应处于的状态",UPDATE 就不会碰它——**不需要穷举所有不该碰的状态,只需要精确声明该碰的状态**,同 R-FEE-SPLIT-PKG-DRIFT/反馈工具 allow-list 同一封闭式防护原则。

## H2 🔴 MUST-FIX(dry-run 前必须厘清,数字矛盾): "14 个 id" 与 §1/§4 推算的 13 个对不上

§1 表:NULL-deadline 9(fy1yk 单列不算)+ ShardLeaf 第五层 4 = **13**。§4 明确"本设计承接预裁但**不在 §2.1 UPDATE 清单里自动带上 fy1yk**"——即 §2.1 的 UPDATE 目标应为 13 个 id。但 §2.1 SQL 注释写"精确 **14** 个 id 字面量"——**13 vs 14 对不上**。

这不是吹毛求疵:若实际生成 id 清单时真的按"14"生成(比如不小心把 fy1yk 也算进去,或者别的计数错误),会**直接违反 §4 的明确排除意图**,在同一条 UPDATE 里误伤 fy1yk(量级远超其余 13 盘,1004 注/1060 KAS,且 §4 明确说 fy1yk 处置形态未定需要 J1/Owner 单独确认——绝不能被这批"13 盘同款豁免"顺带打包处理)。**dry-run 的 SELECT 核对环节必须先解决这个数字矛盾**(设计文本本身先改成 13,或者若确有第 14 个我没识别出的盘,§1 表需要补上说明是哪个、为什么)。

## 其余核点(过,不重复桶B 已验证过的部分)

- **targeted UPDATE 非 pattern sweep**:id IN(字面量列表)而非 pattern/LIKE 匹配——正确应用 28mln terminal sweep 覆盖 shard10 教训。
- **`pruned_expired_waived` 命名沿用桶B 语义**(不带 refunded 字样,NO TX NO STATE)——与桶B 127 盘先例口径一致,我核对过桶B 设计文档用词,无隐性差异。
- **daemon churn 终止机制**:靠状态离开 `selectRipeMarkets` 的 WHERE 条件自然停止,零额外代码——合理,不需要显式改 daemon 逻辑。
- **PS seed/maker spine 留驻+续卡**:金额小、风险面独立,不为小额开新钱路——同桶B "先状态后资金"分离处置的纪律,认可。
- **诚实口径(§3)**:第五层分叉原因留 OPEN、处置≠病根定案、"若未来证实②front-advanced 需撤销重走结算"——这条自我留的后路写得对,不过度声称。
- **fy1yk 单列**(§4):不自动打包、需 J1/Owner 单独确认——判断正确,量级/形态都跟其余 13 盘不同,不该被"同族"这个标签带过。

## 结论

**verdict = RED**,非 GREEN-with-notes——H1(安全闸真实缺口,活库验证)是这个"targeted UPDATE + 安全闸"设计的核心防线,缺口意味着安全闸目前**防不住**它自己声称要防的那类失误(id 清单误差)。H2(数字矛盾)必须在 dry-run 前解决,否则 dry-run 的 SELECT 核对本身就可能核对错误数量。**两点都不难改**(guard 换白名单/文本数字改一致),但落码/dry-run 前必须先修,不能带着这两个问题进桶B 同款"dry-run→Bettor 批→写"两人闸——两人闸的前提是被验证的东西本身逻辑自洽,不能指望人工 review 一遍 SELECT 输出就能补上"guard 结构性不完整"这种系统性缺口。

— NWT 2026-07-12
