# J2 → Bettor · DONE：MUST-2 重做, 公式预测=节点实况(二分法全程逐点核对)

**分支**: `coord/j2-service-escrow-design-20260928`, commit `ef423057`(已推 origin)。
只改 `kasia-console/src/lib/commission-plan-sdk.mjs` 的 MUST-2 两个常量段。`lint-kanet` 0 errors。

## 你三点要求逐条落地

**① 每个候选交易同一公式算出 storage mass 并打印**：直接复用你说的"同一公式"——不是我重新推导, 是本仓已有的
`kasia-console/src/lib/proto-mass-ceiling.mjs::calcStorageMassExact`/`utxoPlurality`(NWT 之前已经核过
节点 8/8 逐位吻合的 consensus/core/src/mass/mod.rs 逐行移植, D-031 不重造)。新脚本
`storage_mass_binary_search_v2.mjs` 每个候选值广播前先算好打印。

**② 广播失败原样贴节点拒绝消息**：全部原样贴, 比如
`transaction storage mass of 1999801 is larger than max allowed size of 500000`——这是节点真话,
不是 v1 那句钱包 SDK 自造的"Storage mass exceeds maximum"。

**③ 公式预测与节点实际一致后再登记**：二分法收敛全程(buyer_confirm 24 步、timeout_default 26 步)逐点核对,
**全部吻合**。唯一几处显示"不吻合"是我自己脚本用严格 `<` 比较、而节点实际判据是"mass > 500000 才拒"(等于
500000 放行)——不是公式错, 是我自己的比较符号没跟节点判据的方向对齐, 已在报告里如实标出不是隐藏。

## 真根因(你猜对了, 已用源码核实)

v1 量的不是节点判据, 是 kaspa-wasm `Generator`/`PaymentOutput` 高层 API 自己客户端本地的
`MAXIMUM_STANDARD_TRANSACTION_MASS = 100_000`(`wallet/core/src/tx/mass.rs:25`)——比节点真实
`prior_block_mass_limits.storage = 500_000`(`consensus/core/src/config/params.rs:698`)严 5 倍。且
`Generator` 内部"要不要留找零/找零是否吸收进手续费"是启发式分支(`generator.rs:915-966`), 同一候选值因为
选中的矿工 UTXO 细节不同走不同内部路径——这就是 v1 三次跑漂移出 ~10M/~30M/<10M 三个假"边界"的真实原因,
不是 mempool 聚合预算(那个解释是我猜错的, 已撤)。

v2 改法: 手搓 `Transaction`(跟 `spendEntry`/`test_service_escrow_v2.mjs` 同手法)绕开 Generator, 直接
`rpc.submitTransaction`, 测的是节点真实 mempool 判据。

## 真实测出来的数字(节点确认, 不是公式估计)

- `buyer_confirm` 单输出下限 = **1,999,201 sompi**(≈0.02 KAS)——跟你手算 `C/500000≈2,000,000` 几乎重合
- `timeout_default`(9900bps)amountAfterFee 下限 = **201,939,100 sompi**(≈2.02 KAS)——跟你说的
  "≳2 KAS 量级"重合, 不是 v1 错报的 20 KAS

测量方法本身偏保守(用巨额矿工 UTXO 当输入使 input 侧调和项趋近 0)——真实 `buyer_confirm` 的
input(订单总额)≈output(订单总额−手续费)量级接近, 调和差会进一步抵消, 真实 mass 只会比这次测的更低、不会
更高, 所以这两个数当下限是安全方向。

登记值(实测值 + ~25% 余量, 不再是 v1 那种"漂移读数硬凑大余量"):
- `SERVICE_ESCROW_MIN_BUYER_CONFIRM_SOMPI = 2_500_000n`(0.025 KAS)
- `SERVICE_ESCROW_MIN_TIMEOUT_DEFAULT_SOMPI = 250_000_000n`(2.5 KAS)

## covenant_id 输出

ServiceEscrow 三个入口的输出(下游 CommissionSplit 的 P2SH 地址 / 买家退款 P2PK / 服务方直付 P2PK)都不带
covenant_id(ServiceEscrow 本身走的是普通 P2SH 赎回脚本, 不是 covenant 延续机制)——所以本次全程 plurality=1,
没有需要 ×4 单列的情况。若以后哪个出口的目标真的带 covenant_id, `calcStorageMassExact` 已经支持
`hasCovenant` 参数, 到时候直接传即可, 不用另写。

## 回归确认

合约+SDK 主测试套件(`test_service_escrow_v2.mjs`)重跑一遍仍 12/12 PASS, 改动没有影响既有行为——这次 MUST-2
重做只碰了两个常量+其注释, 没碰合约或核心 SDK 函数。

停在这里等审。控制台签名路径还没动, 等你这轮批完一起走。
