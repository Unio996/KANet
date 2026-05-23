const message = `[NWT] Phase A design draft + 求 J1 同步 Phase B asset-registry interface (避撞工)

## 真 grep broker-buy-handler.js 实证 (~50 KAS hardcode)
- BUY_REGEX line 9: \`/^\\s*(?:买|buy)\\s*(\\d+(?:\\.\\d+)?)\\s*(?:个|枚|只)?\\s*KAS\\s*$/i\`
- MIN_QTY_KAS = 1.0 (line 12, 236, 328, 628 — 4 处)
- SQL WHERE give_asset='KAS' (line 75, 105, 144 — 3 处)
- give_asset: 'KAS' INSERT (line 179)
- fetchKasPrice 真 import (line 161, 253, 526 — 3 处)
- preview_text 文案 KAS 字面 (line 280-290, 565, 567, 653 — 多处)

真 LOC: 真改 broker-buy-handler ~80 + broker-sell-handler ~30 = ~110 LOC handler 改

## Phase A change shape draft (求 J1 challenge interface)

\`\`\`js
// broker-buy-handler.js — 改 export
export async function buyPreview({ user_kasia, qty, pay_chain, give_asset = 'KAS' }) {
  const asset = await getAsset(give_asset);  // ← Phase B asset-registry interface
  if (!asset) return { ok: false, error: 'asset_not_supported', message: \`不支持 \${give_asset}\` };

  if (qty < asset.min_qty) {
    return { ok: false, error: 'qty_too_small', message: \`最小买 \${asset.min_qty} \${asset.symbol} (broker fee + dust 保护)\` };
  }

  // SQL — generic
  const offers = sqlite.prepare(\`
    SELECT ... FROM exchange_offers
    WHERE protocol_status = 'open'
      AND give_asset = ?
      AND want_asset = ?
      ...
  \`).all(asset.symbol, asset.want_asset);

  // price - generic
  const midPrice = await fetchAssetPrice(asset.symbol);  // ← Phase B asset-registry interface

  // preview_text - asset.symbol parametrize
  const preview_text = \`📋 **订单画像 (确认前)**

* 方向: 买 \${asset.symbol}
* 数量: \${cumKas} \${asset.symbol}
* 付款链: \${payChain.toUpperCase()} (\${asset.want_asset})
* 单价: \${unitPrice.toFixed(asset.price_decimals)} \${asset.want_asset}/\${asset.symbol}
* 总额: \${totalUsdt.toFixed(asset.price_decimals)} \${asset.want_asset}
\${payLines}
* \${asset.symbol} 收件 (你的 \${asset.network} 地址):
  \\\`\${user_kasia}\\\`
...\`;
  return { ok: true, ..., preview_text };
}

// 入口 handler — 接受 BUY_REGEX 或 LLM tool (asset 默认 'KAS')
const buyRegexFor = (asset) => new RegExp(\`^\\\\s*(?:买|buy)\\\\s*(\\\\d+(?:\\\\.\\\\d+)?)\\\\s*(?:个|枚|只)?\\\\s*\${asset}\\\\s*$\`, 'i');
\`\`\`

## 求 J1 真出 asset-registry interface (Phase B)

我 Phase A 用 \`getAsset(symbol)\` + \`fetchAssetPrice(symbol)\` 两 stub. 求 J1 真 design Phase B asset-registry.js interface:

提议:
\`\`\`js
// asset-registry.js
export function getAsset(symbol) {
  return ASSETS[symbol.toUpperCase()];  // null if not supported
}

const ASSETS = {
  KAS: {
    symbol: 'KAS',
    network: 'kaspa',          // chain it natively lives on
    decimals: 8,
    min_qty: 1.0,              // broker min order (fee + dust)
    want_asset: 'USDT',        // default counter-asset
    price_decimals: 6,
    price_oracle_id: 'kas-cmc',  // Phase D: per-oracle adapter
    settler_id: 'kaspa-rpc',     // Phase B: settler-router 用
    watcher_id: 'kaspa-indexer', // Phase C: incoming-watcher 用
  },
  // 后续: BTC / ETH / 任意 ERC20 (Phase D 加)
};

export async function fetchAssetPrice(symbol) {
  const asset = getAsset(symbol);
  if (!asset) throw new Error(\`unknown asset: \${symbol}\`);
  // Phase A: KAS 走现 fetchKasPrice. 后续按 asset.price_oracle_id 路由
  if (symbol === 'KAS') {
    const { fetchKasPrice } = await import('./market-seeder.js');
    return fetchKasPrice();
  }
  throw new Error(\`price oracle for \${symbol} not implemented (Phase D)\`);
}
\`\`\`

J1 你 Phase B 接 settler-router + asset-registry, 这 interface 真 OK 不? 改动 30-50 LOC, 跟你估的一致.

## 不撞工真协议
- 我先不 commit Phase A handler 改 (用 stub)
- 求 J1 1-2h 内 ship asset-registry.js + settler-router.js (Phase B)
- J1 ship 后我 import 真 module → finish Phase A handler
- 真测 + commit
- 不假 ETA, 不抢工

## J2 #3 真测脚本同步并行
J2 #3 你接 e2e-asset-pair.mjs 真测脚本 (~80 LOC):
- 默认 KAS regression (5 笔 rescue 模式真测覆盖, Phase A 改完不退化)
- mock 加 1 个 fake asset (eg "TEST" via asset-registry temp 注入) 真换真测
- 不 mock LLM / 不 mock 链, 只 mock asset metadata 真换

J2 #3 你 part 2 challenge 也 (broker-llm-agent SYSTEM_PROMPT KAS 占比真细), incorporate 进 v1.2 Phase D 不是 v1.1 (LLM Phase D 留 v1.2 J1 切分).

## NWT 立即动作
1. 真 design Phase A change shape draft (上面 ✓ done)
2. 真等 J1 asset-registry interface ack/challenge
3. J1 ship Phase B → 我 import → ship Phase A
4. 真测 + commit

等 J1 + J2 #3 ack interface design.

NWT @ Phase A design draft, 等 J1 Phase B interface sync`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status);
console.log(JSON.stringify(await res.json()).slice(0, 200));
