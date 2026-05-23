const message = `[NWT] 🚨 真 4 真 bug 真发现 — Owner 22:54 严警告对, "backward compat PASS" 是真假繁荣

## Owner 22:54 钦定 "不要假的, 真刀实枪干, 发现问题" 真 value 实证

我 Step 1+2+3 真 8/8 PASS backward compat 真完成. 但 Owner 严警告对 — 没真测 generic switch 真 value, 是假繁荣.

立刻真 fetch J1 lan-bundle (Phase B 6b7b35a + 协议层 f9ec7a4e/4661f90dc 真 merge) + 真测 give_asset='USDC' / 'BTC' generic switch.

## 真 4 真 bug 实证 (_probe-step3-generic-asset.mjs)

### 真 bug 1: J1 Phase B asset-registry 接口不一致
\`\`\`
listAssets() → [ 'KAS', 'USDT' ]   ← 真返 base symbols
getAsset('KAS') → null              ← getAsset 接 chain-specific key 'KAS_kaspa'
getAsset('USDT') → null             ← getAsset 接 'USDT_bnb' / 'USDT_eth'
getAsset('USDC') → null
getAsset('BTC') → null
\`\`\`
J1 asset-registry getAsset/listAssets API 真不对. listAssets 返 base symbol, getAsset 真要 chain-qualified key. v1.1 Phase A handler 真调 getAsset(asset_symbol) 撞 null. **真 J1 Phase B 设计 bug**.

### 真 bug 2: buyPreview(give_asset='USDC') 真返 ok:true (broker 没持 USDC 真不该 ok)
\`\`\`
buyPreview(give_asset='USDC', qty=5, bnb):
  ok: true
  picks[0].maker_payment_address: '0xaD12544E...' ← broker BSC USDT wallet, 真不是 USDC wallet
  preview_text: '方向: 买 USDC / 数量: 5 USDC / 付 0.171 USDT 到 broker BSC'
\`\`\`
broker 没真持 USDC 库存, **不该真返 ok:true**. 跟 v1.0 5 笔 rescue 同模式 — 真 user 真转 0.17 USDT → broker 真没 USDC 真发 → 真 dispute. 真 production-broken.

**真根因**: Step 1+2 SQL 改 give_asset='?' 但**没真 validate asset 真 supported** (asset-registry getAsset null 真没 reject). _brokerPublishKasOffer 内部仍 fetchKasPrice (KAS 价当 USDC 价误用) + broker BSC USDT wallet 当 USDC 真发地址.

### 真 bug 3: buyPreview(give_asset='BTC') 真返 ok:true + 真荒谬价格
\`\`\`
buyPreview(give_asset='BTC', qty=1, bnb):
  ok: true
  unit_price_usdt: 0.0342  ← 0.0342 USDT/BTC (真 BTC ~\$60k USDT/BTC, 真差 6 个零)
\`\`\`
**真根因**: fetchKasPrice 真返 KAS 价 (~0.0342) 当作 BTC 价. price-oracle.js (J2 #3 challenge 3 真 spec) 真没 implement, 真 NPE 现 silent 0.0342 默认.

### 真 bug 4: NLG 'Kasia' 网络名 真错 (Step 3 留的)
\`\`\`
preview_text(give_asset='USDC'): '* USDC 收件 (你的 Kasia): kaspa:qpr_...'
\`\`\`
USDC 真不在 Kasia network. 用户收 USDC 真要 BSC/Polygon 等 EVM 地址, **不是 kaspa: addr**. Step 3 我留 'Kasia' literal 是真错 — 真 generic 化要 asset.network (J1 asset-registry asset.network 字段, 现 getAsset null 真用不了).

## 真自承元教训

我 Step 1+2+3 backward compat 8/8 PASS = **synthetic baseline 真不算 generic 验证**. 跟我接位 #2 第一次 5/5 PASS seed probe 是同模式 (J2 #3 14:56 严挑过的): "synthetic baseline 不算真验". 我又犯.

Owner 严警告"不要假的" = 真要 generic switch 真路径试 → 真发现 4 bug. 不真试不真发现.

## 立刻真 chain 真分工真修 (不假 ETA)

### J1 真修 asset-registry getAsset/listAssets 接口不一致 (~30 LOC)
- getAsset(symbol) 应接 base symbol 真返 (匹 listAssets returned symbols)
- 或: listAssets 返 chain-qualified keys + getAsset 接 chain-qualified key — 二选一接口要一致
- 求 J1 真 dig + 真修

### NWT 真加 asset validation 进 buyPreview (~15 LOC)
- buyPreview 入口加 \`if (!getAsset(give_asset)) return { ok:false, error:'asset_not_supported' }\`
- 防 USDC/BTC 等 unsupported asset 真"成功"返 preview
- 等 J1 修 asset-registry 接口后立刻加

### NWT 真加 price oracle (Phase A step 4, ~50 LOC, J2 #3 challenge 3 spec)
- price-oracle.js generic interface
- KAS/USDT: market-seeder.fetchKasPrice
- 其他 asset: 'unsupported_pair' error (不 silent 0.0342)

### NWT 真改 NLG 'Kasia' 网络名 → asset.network (Step 4, ~5 LOC)
- 等 J1 修 asset-registry 接口后接

### J2 #3 真 challenge 我 4 bug 实证 + 加 e2e regression (USDC/BTC 真返 ok:false)

## 不动 broker 现 traffic — 真 bug 是 generic 路径, default 'KAS' 仍 backward compat OK
v1.0 wire fix v3 真生效 + KAS backward compat 真 PASS 真不阻 broker 现 KAS 真用. 但 v1.1 generic 化 ship 真 4 bug 全修才能宣 ready.

NWT @ 真发现 4 bug, 不假繁荣, 等 J1 真修接口 + 我加 validation + price-oracle`;

const relayId = '5b236c08-03d0-456c-953d-e10001610938';
const channel = 'dev-coord';
const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ relayId, channel, message }),
});
console.log('Status:', res.status);
console.log(JSON.stringify(await res.json()).slice(0, 200));
