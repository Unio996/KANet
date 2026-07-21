# NWT 红队 — ShardLeaf 第五层 triage 设计(f7916599)

> **Status**: CURRENT
> **对象**: docs/2026-07-12-shardleaf-fifth-layer-triage-design.md(J2)
> **verdict**: **GREEN——机制独立验证通过;F1(身份发现,非设计缺陷)必须折入设计上下文,改变续卡的资金定性预期**

---

## 我独立验证的三件(不信自证)

**1. splice 修法核实对照真实代码**:`pool-shard-register.mjs:353` 生产路径确实是 `curRedeem = spliceLeafState(shard.shard_redeem_hex, st)`——J2 自纠"上班用 `p2sh(shard_redeem_hex)` 裸算=测同一地址两次"属实,修正后用真实生产 splice 形状,方法论对齐。

**2. round-trip 自证独立复现**(不信 J2 单次跑,自己重算):import 真 `spliceLeafState` + kaspa-wasm 对 `1857-ozzeu` 的 shard 重算 tip 地址 → `kaspatest:ppqj5lfey9…`,与该 shard `current_leaf_outpoint` txid(`654f514f50bc2d50…`)在 kaspa_tx_log 里产出的 output 地址**逐字节一致**。方法论闭合确认,非 J2 一次性偶然结果。

**3. remove-k 搜索数学健全性检查**:current_leaf_state 四字段(local_yes/local_no/count/pool_value)全是累加和,移除任意 k 笔重新求和与登记顺序无关(不像 claim thread-walk 的 bitmap 位置那样顺序依赖)——remove-k 假设"这 k 笔从未落链"的候选重建正确,不存在顺序坑。

## 结构性核点(全过)

- **L2→L3 强制序满足我前置要求**:设计 §2 显式写"判①phantom 前必须走完 L3",L2 未跑满预算不得下③indexer-gap 结论(indexer 已被 live-only 天然排除)——我上班的"判 phantom 前必穷尽"要求被机制化进分层退出判据,非口头承诺。
- **零钱动**:全程 fail-loud 不变,daemon 继续 TRANSIENT 重试,本设计只是把"猜"变成"分层带退出判据的搜索"。
- **诚实边界**:交付范围明确到 L0+L1+w07cw 的 remove-1/2,L2 全跑+L3 留续卡,不越权宣称本轮能定案。
- **退款前置纪律引用对**:命中②的退款走既有 manual_recovery_refunded runbook + 四方独立核对(shard9/shard10 先例),非新造流程。

## F1 🔴 关键发现(非设计缺陷,是必须折入的上下文事实——影响资金定性预期)

**4 盘全部 100% 内部身份**——独立查证:maker_pk(`20f208b765fe9d61…`)与全部 8 个唯一 bettor_pk 逐一命中 `relay_nodes`,0 外部;71 笔下注实际只有 8 个内部 pk 重复使用(同一 pk 在盘内/盘间多次下注,非一次性 fresh pk);4 盘创建时间集中 2026-07-06~07(同一时段);同一 maker 建全部 4 盘。

**这与今晚已定性的 fy1yk(内部 bulk demo,一次性 fresh pk 从未持久化)是不同形态但同族结论**:此 4 盘是**固定小集合内部 relay 重复参与的测试/彩排批次**,非真实外部用户资金暴露。

**为什么这改变续卡预期(非本轮设计范围,但必须记账)**:
1. **资金安全面**:0 外部用户,与 shard9/shard10/lv3rz 那些"真实押注 phantom"先例的风险量级不同——不是"用户钱可能丢",是"内部测试彩排的 leaf 状态核对"。
2. **对 L3 必要性的影响**:若 L2 全空,L3 block-scan 是"definitive 但独立量级"的重活(28mln 先例扫 30万+行)——**对内部测试资金,继续投入 L3 达到 definitive 之前,应先问是否有比 L3 更便宜的路径**:同今晚已建立的 fy1yk 先例(桶B `pruned_expired_waived`/内部资金豁免收口口径,"没转账不叫 refunded"),这 4 盘若 L2 全空,处置可能同样落豁免口径而非必须 L3 定案——这是给 Bettor 的处置决策输入,非否定 J2 的 triage 设计(triage 本身仍该做,搞清楚"发生了什么"是对的,只是**结果出来后的处置路径**多了一个比 L3 更便宜的选项)。
3. **不改变本设计 verdict**:L0-L2 的诊断价值不变(不管资金归属如何,搞清"链上到底发生了什么"都是对的第一步),只是续卡(L2 全跑/L3)的优先级判断需要把这个身份事实喂给 Bettor。

## 结论

triage 设计 GREEN——机制我独立验证三件全通过(splice 修法/round-trip 自证/remove-k 数学),L2→L3 强制序满足我前置要求,零钱动纪律不变。F1 身份发现折入设计上下文(非阻塞,续卡输入):4 盘 100% 内部,与真实用户 phantom 先例风险量级不同,续卡处置(尤其 L2 全空后是否值得投入 L3)应参考今晚 fy1yk 豁免先例一并考虑。**落码范围**(L0+L1+w07cw remove-1/2 记账)可执行,已是只读诊断脚本非 production 代码,无需额外落码门。

— NWT 2026-07-12
