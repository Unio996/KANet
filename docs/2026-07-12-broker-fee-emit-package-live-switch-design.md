> **Status**: CURRENT

# B线深化件1 — broker-fee-emit.mjs 落4 live 切换到 package(notify 层)

**作者**: J2 · 2026-07-12 · Owner 直令(B线深化日,件1最高优先)+ Bettor 派工 #hj849i.1
**目标**:补掉落3 §3-2 自己点名的 gap——package 建好(`packages/fee-split/notify.mjs`)但 live 结算路径
(`broker-fee-emit.mjs`)从没吃到这层抽象。

## 1. 查了哪些既有资产

| 资产 | file:line | 现状 |
|---|---|---|
| broker-fee-emit 匹配逻辑 | `broker-fee-emit.mjs:144-154` | **按地址匹配,零金额断言**(§2.2 comment 明确写"金额精确核对暂缓落码"——V1 `computePoolPayouts` 的 brokerFeePct/minBrokerFee floor 太复杂,重建期望值本身有出错风险,故意不做) |
| package 匹配函数 | `packages/fee-split/notify.mjs` `matchLandedFeeOutputs` | **要求预先知道 `feeLeaves`(含 amount)才能匹配**,amount 断言是 Bettor 注3 MUST-FIX 钉的硬门(地址对金额不对=mismatch,不是 matched) |
| feeRules 落列市场 | `pool_markets.fee_rules`(B线落2) | 只有 2026-07-12 后新建的非-zk 市场才有;绝大多数现存 broker-fee-emit 候选(V1 legacy / ZK 市场)**没有** `fee_rules`,期望金额结构性不可独立重建(同 §2.2 comment 的老问题) |

**🔴 核心张力**:package 的 `matchLandedFeeOutputs` 设计前提是"调用方预先知道期望 feeLeaves"(卡B 的用法:
`feeSplit()` 算出来的确定性结果就是期望值)。broker-fee-emit 的现状恰恰是**没有**独立期望值来源(V1 legacy
市场结构性算不出;`fee_rules` 市场理论可以,但目前 live 候选里几乎不存在)。**强行套用金额断言 = 引入 package
设计没打算覆盖的新行为**,违反"切换前后 byte-equal"的护栏要求。

## 2. 方案:分族切换(半径最小化)

### 2.1 有 `fee_rules` 的市场(新族,B线落2 起)→ 真金额断言 + package 全链路

```
consolidatedPool(独立链读, 同结算时口径)+ market.fee_rules → deriveRoleFeeLeaves() → 期望 feeLeaves
逐角色地址派生(pk→address) → matchLandedFeeOutputs(realOutputs, feeLeaves, leafAddresses) → 真 amount 断言
matched → emitLandedNotification(matched, {onLanded: 写 chain_events broker_fee_landed 同款 payload 形状})
```
这是**真正的多角色泛化路径**——为件2(broker+introducer 双角色实弹)提前打通消费端,不是新造一份平行逻辑。

### 2.2 无 `fee_rules` 的市场(存量族,V1 legacy + 现有 ZK 市场)→ byte-equal 护栏,discover-then-trust 不变

```
既有逻辑找到 outs[idx](地址匹配)→ 取得实际 feeSompi(discover, 非独立期望)
→ 构造 feeLeaves=[{pk: brokerPk, amount: feeSompi(即discover到的值), type:'broker'}](把"发现值"当"期望值"喂给
   package——amount 断言在这里数学上必然 pass, 因为比对的是同一个数)
→ matchLandedFeeOutputs(...) 走一遍(必 matched, 结构性不会产生新的 mismatch/unmatched 分支)
→ emitLandedNotification(...) 统一投递路径
```
**为什么这样做还有意义(非纯装饰)**:①投递/去重/payload 组装这层复用了 package(件1 真正要补的 gap——
之前"package 建好没人用"),②`matchLandedFeeOutputs` 的**结构**(output 至多配一个 leaf/未知角色跳过)
即使在单角色场景也提供纵深(万一未来同一笔结算 tx 里混进第二个 output 巧合撞了 broker 地址,这层保护
生效),③**不引入新的失败模式**——discover-then-trust 场景下断言必过,新旧行为 byte-equal。

## 3. 回归护栏(Bettor 要求,MUST)

**对照测试**:用 `fee-single-source.test.mjs` 的真实历史数据(1dv70,broker fee 6,080,000 sompi 真实 landed
值)跑新旧两条路径,断言:
- 旧路径(现有 `brokerFeeLandedEmitTick` 逻辑原样)产出的 `chain_events.payload` JSON
- 新路径(package 切换后)产出的 `chain_events.payload` JSON
- **两者 byte-equal**(除时间戳字段外全部字段值相同,`fee_sompi`/`broker_address`/`output_index` 逐位一致)

## 4. 失败降级(Bettor 要求,MUST)

`matchLandedFeeOutputs`/`emitLandedNotification` 调用包在 try/catch——**package 函数抛异常不阻断既有
emit**(fallback 到旧的直接 `db.prepare(...).run(...)` 写 `chain_events` 路径,记一条 warn log)。理由:
broker DM 通知是用户体感功能,不该因为一次"结构升级"的代码路径异常就让 broker 收不到钱到账通知——旧路径
是 fallback 安全网,不是被彻底删除的死代码(至少过渡期保留)。

## 5. DoD

1. NWT 红队:分族判据(`fee_rules IS NOT NULL`)覆盖所有已知 live 候选类型;byte-equal 对照测试真实历史
   数据跑通;失败降级路径实测(mock package 函数 throw,确认走到 fallback 且 emit 仍成功)。
2. 落码后 live 观察:下一笔真实 broker fee 结算(存量市场,discover-then-trust 路径)产出与预期一致;
   若件2 的多角色测试盘先跑,fee_rules 路径同时验证。
3. 记账入 COORD-LEDGER(Owner 定位补令:里程碑非计费功能收尾)。
