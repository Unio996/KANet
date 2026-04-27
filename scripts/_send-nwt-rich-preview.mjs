const message = `[NWT] 报价信息丰富化 ship 758bb38b0 — 给报价加 4 段 (Owner 11:08 钦定方向)

Owner 指出: 用户 DM 陌生 broker 时信任不足 + 报价信息有限 → 谁敢用?
原 preview 就只有"买 X / 转到这地址 / YES" 这种交易细节, 没有任何 trust signal.

## 加了 4 段
(A) broker 身份卡: 🏷 Trader-B · Kasia 注册 5 天 · 累计完成 7 笔成交
(B) 价格对比: 单价 0.034440 USDT (CEX 8 源中价 0.034091, 本单 +1.02% spread)
(C) 安全说明: USDT 直付 maker, broker 不托管 / fee 0.1 KAS 固定 / 30min 自动取消 / 验证失败自动 refund
(D) 历史链上履历: 最近 3 笔 completed offer 的 tx hash (Kaspa explorer 可验)

全部从 DB 实时查, 价格/历史失败静默不影响 preview. 80 行代码, 加在 buyPreview() 内.

## verify (4/4 PASS, scripts/_verify-rich-preview.mjs)
直接调 buyPreview() 看 preview_text, 4 段全显示. 见样本:

  📋 订单画像 (确认前)
  
  🏷 Trader-B · Kasia 注册 5 天 · 累计完成 7 笔成交
  
  * 方向: 买 KAS
  * 单价: 0.034440 USDT/KAS (CEX 8 源中价 0.034091, 本单 +1.02% spread)
  * 总额: 0.172200 USDT
  ...
  
  🛡 安全说明 (4 条)
  
  📊 broker 最近成交 (3 笔 tx 链上可验)
  
  确认下单回 YES

## 对齐 KANet 窄门定位
"全可审计 + 全链上履历" 之前藏在数据库里, 现在 surface 到用户面前. broker 不再是黑盒.

## 配 J2 v1.2 SYSTEM_PROMPT trim
J2 a660061c3 把 prompt 100→35 行让 Qwen 真正用工具. 我这个补强是工具结果 (preview_text) 的内容升级, 跟 J2 prompt trim 互补:
- J2 改 prompt → LLM 更可靠地调 preview_order tool
- NWT 改 buyPreview → tool 返的 preview_text 内容更丰富

下一步建议三方一起测真用户多轮: J1 Eric 4-5 轮 BUY KAS / J2 USDC e2e / NWT SELL flow, 看新 preview 效果.

bundle: D:/kanet-sync.bundle HEAD=758bb38b0`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status, JSON.stringify(await res.json()).slice(0, 200));
