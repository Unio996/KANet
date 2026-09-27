// config.js — 无代码配置页(V1 参考实现)。构造 canonical_rules(单渠道预算平均分给最多 5 层,
// 商家可后续手改), 展示 O4 最小订单额提示, 调本机 resolver 出签名报价。纯浏览器 JS, 无 kaspa-wasm 依赖
// (签名步骤委托给 resolver, 同 checkout.js 头注说明的同一条边界)。
const RESOLVER_BASE = (new URLSearchParams(location.search).get('resolver')) || 'http://127.0.0.1:8787';

// O4 反推最小订单额——与 SDK minOrderSompiForChannels 逐字同一条公式, 这里是纯算术, 不需要
// kaspa-wasm, 直接在浏览器里算(设计稿 §6.1c)。dosage 用 D-034 §8 N1 含 broker 分档表的保守值。
const DOSAGE_PER_CHANNEL_KAS = { 1: 0.0527, 2: 0.0790, 3: 0.1053, 4: 0.1316, 5: 0.1580 };
function minOrderKasForChannels(n, channelBudgetPct) {
  const dosage = DOSAGE_PER_CHANNEL_KAS[n];
  if (!dosage || channelBudgetPct <= 0) return null;
  return (n * dosage) / (channelBudgetPct / 100);
}

function updateHint() {
  const price = Number(document.getElementById('priceKas').value || 0);
  const bps = Number(document.getElementById('channelBps').value || 0);
  const n = Number(document.getElementById('maxChannels').value || 5);
  const minOrder = minOrderKasForChannels(n, bps);
  const el = document.getElementById('minOrderHint');
  if (minOrder == null) { el.innerHTML = ''; return; }
  const ok = price >= minOrder;
  el.innerHTML = `<b>O4 提示(§6.1c "五级是最大深度不是目标")</b><p class="${ok ? 'ok' : 'warn'}">
    以当前配置(${n} 层、渠道预算占比 ${bps}%), 支持满层归因的最低订单额约 <b>${minOrder.toFixed(4)} KAS</b>。
    当前价格 ${price} KAS ${ok ? '满足' : '低于这个下限——低价商品建议调低最大层数, 而不是无条件开满 5 层'}。</p>`;
}
['priceKas', 'channelBps', 'maxChannels'].forEach(id => document.getElementById(id).addEventListener('input', updateHint));
updateHint();

document.getElementById('genBtn').addEventListener('click', async () => {
  const resultEl = document.getElementById('result');
  const priceKas = Number(document.getElementById('priceKas').value);
  const providerAddr = document.getElementById('providerAddr').value.trim();
  const channelBps = Math.round(Number(document.getElementById('channelBps').value) * 100); // % -> bps
  const maxChannels = Math.min(5, Math.max(1, Number(document.getElementById('maxChannels').value)));
  const requireDeposit = document.getElementById('requireDeposit').value === 'true';
  const merchantPriv = document.getElementById('merchantPriv').value.trim();
  if (!providerAddr || !merchantPriv) { resultEl.innerHTML = '<span class="bad">✗ 收款地址与私钥必填</span>'; return; }

  // 渠道预算在 maxChannels 层之间均分(商家可后续手改 JSON 换成递减比例, 见设计稿 §6.4 示例注释)
  const perChannelBps = Math.floor(channelBps / maxChannels);
  const roles = [{ name: 'provider', bps: 10000 - channelBps, address: providerAddr }];
  for (let i = 1; i <= maxChannels; i++) roles.push({ name: `channel_${i}`, bps: perChannelBps, fold_to: 'provider' });
  // bps 舍入余数并入 provider, 保持 Σ==10000(fee-split.mjs 硬约束)
  const sum = roles.reduce((a, r) => a + r.bps, 0);
  roles[0].bps += (10000 - sum);

  const quote = {
    schema_v: 1,
    quote_id: 'q-' + Date.now(),
    merchant_pubkey_hex: null, // resolver 侧用私钥派生填充
    price_sompi: String(Math.round(priceKas * 1e8)),
    canonical_rules: { schema_v: 1, roles },
    unfilled_channel_slot_fold_to: 'provider',
    valid_from_ms: Date.now(),
    valid_until_ms: Date.now() + 30 * 86400000,
    channel_whitelist: null,
    require_channel_deposit: requireDeposit,
    min_deposit_sompi: '100000000',
    max_split_fee_sompi: '40000000',
    max_refund_fee_sompi: '10000000',
    deadline_offset_ms: 259200000,
  };
  if (requireDeposit) {
    quote.deposit_terms = { schema_v: 1, redeemable_by: 'depositor_only', redeemable_after_ms: 0, forfeitable: false, forfeit_conditions: null, arbiter: null };
  }

  try {
    const r = await fetch(RESOLVER_BASE + '/sign-quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quote, merchantPrivKeyHex: merchantPriv }) });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || 'sign failed');
    const b64 = btoa(JSON.stringify(j.quote));
    const link = `${location.origin}${location.pathname.replace('config.html', 'checkout.html')}?q=${encodeURIComponent(b64)}`;
    resultEl.innerHTML = `<span class="ok">✓ 报价已签名</span><p>归因链接模板(渠道追加 <code>&ch=&lt;地址&gt;</code>):</p><p><code>${link}</code></p>`;
  } catch (e) {
    resultEl.innerHTML = `<span class="bad">✗ ${e.message}</span>`;
  }
});
