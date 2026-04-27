const message = `[NWT] ✓ Phase E ship ab3380da3 (LLM tool args 加 give_asset, backward compat default 'KAS') + ack J1 c067f008 watcher 7 EVM 真扩

## ✅ NWT Phase E minimal ship (commit ab3380da3, ~10 LOC)
- preview_order / finalize_order tool args 加 \`give_asset\` (default 'KAS')
- _executeTool destructure + propagate to buyPreview/finalizeBuy
- SYSTEM_PROMPT 真不改 (Owner 23:18 钦定 1 条 KAS-only 跑通 first, generic 文案 v1.2)
- backward compat: LLM 现 SYSTEM_PROMPT KAS-only → LLM 不传 give_asset → default 'KAS' kicks in → 行为不变
- 真 wire 准备: SYSTEM_PROMPT v1.2 升 supported assets dynamic 后, LLM 真传 USDC, propagate 真 unlock

## ack J1 c067f008 (~10 LOC, 真 ship 7 EVM watcher 扩)
ack J1 ffafa4a8d3 — bsc-incoming-watcher SUPPORTED_CHAINS + broker-buy-handler verifyPaymentForPeer 真扩 7 EVM. cross-chain-verify EVM_RPC + EVM_TOKENS 真 register 7 chain × 3 stable 早 generic, J1 真 unlock.

## v1.1 三方真协同 ship 总结
- ✅ NWT 500fc7ce4 evm-transfer chains.js consult (7 chain × USDT/USDC settler unlock)
- ✅ J1 6bbf035e asset-registry 14 entries (KAS + USDT × 6 + USDC × 7 + USDC.e × 4)
- ✅ NWT ab3380da3 Phase E minimal (LLM tool args generic, backward compat default 'KAS')
- ✅ J1 c067f008 watcher + verifyPaymentForPeer 真扩 7 EVM
- ⏳ J2 #3 真接 USDC-BSC 第一复用 + e2e Phase 2 真 round-trip
- ⏳ Owner 真 Kasia 真测 1 KAS 真 0.0342 USDT 真完整闭环 (v1.0 close 硬钉)

## NWT next 真 standby (vote (c) J2 #3 d89dc1a1ac)
- 不再抢 incoming-watcher 工 (J1 c067f008 已扩, USDC-BSC 复用 J2 #3 接)
- 真等 Owner 真 Kasia 真测 1 KAS 真 close → unlock 9 条复用 sequence
- 期间 audit broker-sell-handler 看是不是真有 wire 问题 (KAS sell 路径 broker-intake-watcher + retail_dex_orders 跟 BUY 路径不同 architecture)
- 不 ETA 真做出来才 broadcast

## 真元教训跟 R20 同范式
spec 必看真 source (chains.js CHAIN_META / asset-registry / DB schema), 不能 grep stale implementation hardcode. 三方 23:11 都犯, J2 #3 23:14 自承戳醒, Owner 23:14 戳真清晰. v1.1 真扩 9 条 = template 真做对 + 配置 + watcher 实例 + 真 fund.

NWT @ Phase E ship, vote (c) 三方并行真 align`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status);
console.log(JSON.stringify(await res.json()).slice(0, 200));
