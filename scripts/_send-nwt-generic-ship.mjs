const message = `[NWT] sellPreview/buyPreview generic 化 ship 5a9db463f (Owner 12:51 钦定方向)

Owner: '尽量都是结构化, 未来任何资产都能够复用. 包括买的功能模块. 不仅仅是 KAS.'

## sellPreview 改造
签名 + 全字段走 asset-registry:
- give_asset / recv_asset 参数 (默认 KAS / USDT 向后兼容)
- giveMeta.minQty 替 FEE_KAS 硬编码 (KAS=1.0, USDC/USDT=0.1)
- recvMeta.settler 决定地址验证类型 (evm: 0x42位 / kasia: kaspa: 前缀 / sol/tron: 留 finalize)
- fetchPrice(give, recv) 通用, USDC 直接 pair 不支持时 fallback USDT proxy (peg ~1:1, J2 验过 0.026% slippage)
- preview_text 全用 displayName/symbol 占位, 不再写死 'KAS' 'USDT'
- fee 处理: KAS 保留 0.1 固定 (链上 gas 真成本); 其他 spread-only

## buyPreview 轻清理
per-asset minQty 走 registry. 之前 MIN_QTY_KAS=1.0 一刀切 → '想买 0.5 USDC' 被错拒. 现 USDC/USDT 用 registry 0.1.
更深的 'USDT' 写死 (selectBestOffers SQL / publish body) 留 J1 territory, scope 控制.

## verify (10/10 PASS, scripts/_verify-sell-preview-generic.mjs)
- 默认 KAS→USDT BSC ✓ (0.0333 USDT/KAS, total 0.1633)
- KAS→USDC BSC ✓ (USDT proxy fallback)
- KAS→USDT Polygon/Arbitrum ✓ (chain generic)
- USDC→USDT BSC ✓ (peg 0.99)
- BSC 别名 ✓ / BTC→USDT 拒 ✓ / KAS→USDC Solana 拒 ✓ / dust ✓ / 坏 addr ✓

## R29 体现 (J1 sediment 143bf4be align)
sellPreview 现在自包含 trust + market + safety + history + addr-format-validation, LLM 只需 forward preview_text. 'LLM 真 dumb 真 tool 真 rich' 架构原则真实化.

## 给 J1 的提示
J1 你 Phase 2 真 audit 时如果想完成 buyPreview 'USDT' 残留清理:
- selectBestOffers SQL filter want_asset='USDT' → want_asset 参数化
- _brokerPublishKasOffer body want_asset literal → 参数化
- payment_asset 写死 'usdt' → 用 wantMeta.symbol.toLowerCase()
范围更深, J1 你 own 这块.

bundle: D:/kanet-sync.bundle HEAD=5a9db463f`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status, JSON.stringify(await res.json()).slice(0, 200));
