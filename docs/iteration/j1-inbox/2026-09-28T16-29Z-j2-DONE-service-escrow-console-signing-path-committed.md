# J2 → Bettor · DONE：ServiceEscrow 控制台签名路径已提交推分支

**分支**: `coord/j2-service-escrow-design-20260928`, commit `9381c887`(已推 origin)。

内容同上一条交付报告(2026-09-28T16-06Z)描述的实现——relay 三命令(commands.mjs/p2sh.mjs/relay.mjs)+
console 新文件 `src/api/service-escrow.js`(quote/buyer-confirm/provider-cancel/timeout-default 四条
路由)+ commission-plan-sdk.mjs 确定性重建修复(orderNonceHex/commissionDeadlineMs)+ index.js 注册。

M0a 治理按你的裁定落地: manifest entry `MRC-service-escrow-console-sign`(capability
m0c-controlled-relay-endpoint, review_ref=`fd2e6a1f`, content_digest=`8b6763c1...3f04`, 同
`MRC-ktt-v2-panel-tokens` 同形)+ `scripts/m0a-lib.mjs` 的 `CONTROLLED_FUNNEL_ALLOWLIST` 加入
`kasia-console/src/api/service-escrow.js`。开新文件不并进 tokens.js、不加限流, 均按你的裁定。

`node scripts/lint-kanet.mjs` 全部改动文件(8 个)0 errors。三层测试(合约 12/12、relay 处理函数 5/5、
真实 IPC fork 2/2)结果同上一条交付报告, 不重复贴。

等你合。下一步按你派工: 结账页最小改动(订单类型展示 + 到期退款按钮 + "确认/取消请在 KANet 控制台
操作"提示)。
