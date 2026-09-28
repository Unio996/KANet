# J2 → Bettor · DONE：D-034 §9 ServiceEscrow 合约+SDK+simnet 真共识测(v0.2 施工令第一阶段)

**分支**: `coord/j2-service-escrow-design-20260928`, commit `5e4efe3b`(已推 origin)。
新文件 `kasia-console/src/lib/sil-v1/ServiceEscrow.sil`, 改 `kasia-console/src/lib/commission-plan-sdk.mjs`。
`node scripts/lint-kanet.mjs` 两个改动文件 0 errors。

## 结果: simnet 12/12 PASS(真实广播, 真实节点判定, 非本地断言)

三入口(buyer_confirm / provider_cancel / timeout_default)逐一真实测过, 覆盖你派工里
补的那条(timeout_default 两输出都精确金额, 差 1 sompi 负向)+⑥第三方触发+⑦结构互斥:

```
PASS ①负向: 非买家签名不能 buyer_confirm
PASS ①buyer_confirm 成功: 下游 CommissionSplit 地址收到资金精确等于 totalIn-max_s_fee
PASS ①两跳全链路打通: provider 最终真实收到钱(扣两段真实网络费后)
PASS ②负向: 非服务方签名不能 provider_cancel
PASS ②provider_cancel 成功: 买家几乎全额退款
PASS ⑦互斥: provider_cancel 后 escrow UTXO 已不存在
PASS ③负向: 到期前(DAA)不能 timeout_default
PASS ③负向: provider 那份多 1 sompi 应被拒
PASS ③负向: buyer 那份多 1 sompi 应被拒
PASS ③⑥timeout_default 真实成功(第三方触发): provider 精确 1%
PASS ③⑥timeout_default 真实成功: 买家精确 99%
PASS ⑦互斥: timeout_default 后 escrow UTXO 已不存在
```

## 施工期真实撞出的两个 bug(如实记录, 不是设计稿写错, 是写码/broadcast 才显形)

**① CLTV 字段用反了**: 最初照抄 CommissionSplit.refund() 的 `require(tx.time >=
temporal(dl_ms))` 改成 `require(tx.time >= temporal(dl_daa))`——但 SilverScript 源码层
`tx.time`/`tx.daa` 是两个独立字段, 不是"数值量级自动分诊"(那句只对底层 kaspa 共识层
CLTV opcode 成立)。`tx.time` 只收 `temporal` 阈值且编译器插入 `阈值>=
LOCK_TIME_THRESHOLD(5×10^11)` 域校验, DAA 量级的 dl_daa 送进去恒失败, 跟到期时间早晚
无关(哪怕 deadline 设成极端过去值仍失败)。真实广播只报"script ran, but verification
failed"看不出是哪一行——**用 `/d/silverscript-versioned-builds-backup-20260927/cli-debugger-v100-3ed9733.exe`
(跟 silverc-v100-3ed9733 版本对齐的调试器, 直接 `/d/silverscript/target/release/`
那份是别的分支构建, 语法都对不上会先炸解析)单步真跑, 一步定位到具体 require 行**。
改法: `require(tx.daa >= dl_daa)`(裸 int, 不套 temporal())。

**② 一个后续跟着来的假象**: 修完①后, 广播先撞"transaction input #0 is not finalized",
一度误判成要把 sequence 设成 u64::MAX——这是错的, 会反过来撞 CLTV opcode 自己那条
"transaction input is finalized"(kaspa 用 sequence!=MAX 证明 CLTV 有牙齿, 是 Bitcoin
BIP65 那套约定)。真根因: `check_tx_is_finalized`(rusty-kaspa
consensus/src/processes/transaction_validator/tx_validation_in_header_context.rs)
要求 `tx.lockTime < 当前链尖 DAA` 才能在 sequence≠MAX 时放行——测试脚本原来"现查一次
当下 DAA 当 lockTime"反而是把余量主动缩到零, 改成用订单自己已经 ctor 烤死、且已经
`waitFor` 确认链尖越过的 `shortDeadlineDaa`, 稳定不再撞。

## MUST-2: storage mass 最小订单额, simnet(主网 v2.0.1 参数)二分法实测, 不套公式

方法+脚本: `kasia-console/scratch/_j2_service_escrow_simnet_test/storage_mass_binary_search.mjs`
(直接从矿工巨额 UTXO 广播目标形状的输出, 找零腿巨大对 KIP-9 调和和贡献≈0, 二分法收敛到
mempool 恰好翻脸拒收的 sompi 值)。

**如实报一个不太舒服但重要的发现**: 连续三次独立跑同一个二分法, `buyer_confirm` 单输出
边界分别测到 ~10.08M / ~29.75M / <10M sompi——同一拓扑同一节点, 边界会漂移。最合理的
解释贴合你原话"mempool 按 mempool_block_mass_limits.storage 拒"里的"block"字样: 更像是
对 mempool 当下已排队 storage mass 的**聚合预算**判定, 不是每笔交易独立不变的硬阈值,
跟二分法自己密集广播几十笔候选值造成的短暂拥堵有关。⇒ 不存在一个"精确到 sompi"的常量
能诚实写死。已登记为**保守下限**(三次实测最差读数 × ~1.7-2 倍余量, 不是公式也不是
精确边界):

- `SERVICE_ESCROW_MIN_BUYER_CONFIRM_SOMPI = 50_000_000n`(0.5 KAS)
- `SERVICE_ESCROW_MIN_TIMEOUT_DEFAULT_SOMPI = 2_000_000_000n`(20 KAS, amountAfterFee 总额,
  仅对默认 9900bps 口径实测有效)

新增 `validateServiceEscrowMinAmount(priceSompi, maxRefundFeeSompi, timeoutBuyerBps)`
导出函数, 供后续控制台/结账页在真正建单前挡住(而不是广播了才发现被拒)。

## 抽核清单(对照你 v0.2 批复原话逐条)

- ✅ timeout_default 两输出都 require 精确金额(providerCut/amountAfterFee-providerCut),
  差 1 sompi 负向用例两侧都测(③负向两条)
- ✅ 两跳里下游 CommissionSplit 的 payer_refund_pk = 买家(`buyerRefundAddress` 传给
  `createCommissionSplitProtocol` 的 `payerRefundAddress`)
- ✅ 顺序: 合约+SDK+simnet(含 storage mass 二分实测回填下限)——第一阶段完成, 尚未动
  控制台签名路径/结账页

## 尚未开始(按你定的顺序, 下一步)

- 控制台签名路径: relay IPC 命令注册(参照 D-035 `unlockKttV2Transfer` 模式)、控制台
  API routes、可能需要新 DB 表(参照 `ktt_holdings_ledger`)
- 结账页: 订单类型展示、到期退款按钮(零签名)、"确认/取消请在 KANet 钱包里操作"提示

simnet 节点(`scratch/_j2_service_escrow_simnet`)还开着, 省得重新搭, 下一阶段控制台
签名路径联调还用得上。

停在这里等审。
