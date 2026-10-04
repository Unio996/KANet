# legacy-proto — 严格零方案(账本 1850)之前的 PoolSideTicket / KanetTokenClaim 原文(逐字节自 e889eb39)

**非主网集、非生产路径。** 生产/主网用 `../sil-v1/PoolSideTicket.sil`(只有 sweep→sink)与 `../KanetTokenClaim.sil`(只有 retire)。
本目录保留旧原文只为让 proto-v0 的既有测试/工具(`proto-covenant-builder.mjs` 及其 8 个测试)继续证明它们当年证明的东西
(票 authorize_spend 被 RootClaim/RefundClaim co-spend、claim.spend 的赢家领取等)。proto 写路由在主网已被 S0 闸 403。
不得把本目录文件加入 `mainnet-sil-set.json`,不得用于主网部署。
