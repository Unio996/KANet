# Owner 指令存证 — KCC 生态标准参与策略(2026-07-16)

> **Status**: AUTHORITATIVE — Owner 经操作终端交付, Bettor 存证。核心定位判断与三件近期动作如下(要点摘录, 完整论述以 Owner 原文为准, 本文档即原文归档)。

## 核心定位(Owner 判断)

**KCC 补上了 KANet 从"开源项目"走向"开放基础协议"所缺的生态协作层。** KCC 是独立钱包/索引器/编译器/应用共同实现的约定(非 KIP 非官方唯一标准), 现状: KCC20 PR#2=Draft 未合并(185 行最小接口), KCC1 尚未出现(Michael 在开发中的方向, 不能当现有标准依赖)。

**成为开放协议的判断标准(Owner 原话)**: "如果一个第三方 Broker、钱包或索引器必须导入 KANet 私有代码才能与系统交互, 那么我们仍然是开源平台; 只有它依据公开 convention 就能独立实现, 我们才真正成为开放协议。"

**参与姿态**: 不提交庞大的"KANet KCC"(过早+像用标准推广项目)。**KANet 先做 KCC 的早期实现者、对抗测试场和测试向量提供者, 再从跨项目验证过的部分提炼新 convention。**

## 与 KANet 关系表(Owner 判定)

| KCC 方向 | 关系 | 优先级 |
|---|---|---|
| KCC1 状态 covenant 字节码 ABI | 直接触及全部 SilverScript 合约/状态编码/selector/prefix-suffix/模板版本 | 最高 |
| KCC20 代币 covenant | 当前原生 KAS 结算非直接依赖; 未来稳定币/资产/可转让收益权直接用 | 高 |
| Reader/Writer/Descriptor | 决定第三方能否不跑 KANet 代码独立识别 PoolSpine/Shard/Payout/CloseZk | 最高 |
| Economic Agreement/Broker | 未来可提炼新 KCC, 现在太早 | 中长期 |
| Agent Card/Trust Profile | 有标准化价值, 需第二个独立实现后再提 | 中长期 |

## KCC1 = 我们安全债的生态级根治

手工 offset/V1V2 layout 分叉/prefix-suffix 模板 hash/imageId-gateTmplHash 配对/selector——**D-009(imageId 更新 gateTmplHash 未同步)就是生态级 ABI 约定缺失的真实事故**。KCC1 若定义状态编码/selector/artifact/descriptor 版本/template commitment/round-trip 重建 P2SH/Reader 验证部署字节, KANet 可删除大量私有 offset 与模板解释逻辑。**不按传闻重构生产代码; 正确动作=先把编译器假设封装进 Adapter, 同时准备真实测试向量。**

## KCC20 已发现一个 KANet 直接相关的安全问题

`IDENTIFIER_COVENANT_ID=0x02` + Borrowed Receive 允许发送者未经所有者授权消费接收者已有 token UTXO 再重建——对 covenant actor: outpoint 被陌生人改变/已构造后续交易失效/watcher 索引漂移/exit-path 可能依赖旧 outpoint = **资金没被偷但活性可被攻击**。意见: `identifier_type==COVENANT_ID` 时 Borrowed Receive 默认拒绝, 仅接收 covenant 显式机器可读 opt-in 才允许。当前 PR 未含此层, 值得正式提出。

## 近期三件(Owner 钦定)

1. **向 KCC20 提交两个窄意见**: (a)covenant-owned state 的 Borrowed Receive 默认拒绝/显式 opt-in; (b)descriptor 必须来自版本化编译产物+能 round-trip 重建实际 genesis P2SH。
2. **为 KCC1 准备 KANet 测试语料**: 单/多入口、有/无 selector、空 prefix、PoolSpine/Shard/PayoutShard/CloseZk 状态布局、covenant ID 所有权、模板升级、负例(错误 offset/时间单位/配对常量)。
3. **内部 KCC Compatibility Matrix**: 哪些=Kaspa/KCC 公共约定 / 哪些=KANet Economic Kernel / 哪些=当前参考实现 / 哪些应由 Broker/Wallet/Reader 独立实现。

## 参考链接(Owner 提供)

- KCC 仓库: github.com/kaspanet/kccs
- KCC20 PR#2: github.com/kaspanet/kccs/pull/2 (Draft)
- 论坛讨论: kas-smiths.org/t/fungible-token-covenant-specification-kcc20/8
