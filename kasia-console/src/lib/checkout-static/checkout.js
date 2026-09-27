// checkout.js — 纯浏览器 JS(无打包步骤、无 kaspa-wasm 依赖)。解析归因链接 §3.1, 展示报价/签名链
// 校验结果, 展示 mass 预检提示, 通过本机 resolver.mjs(见该文件头注)完成需要 kaspa-wasm 的几步
// (验签/验链/地址推导/构造广播交易)。
const RESOLVER_BASE = (new URLSearchParams(location.search).get('resolver')) || 'http://127.0.0.1:8787';

function el(id) { return document.getElementById(id); }
function renderBox(id, html) { el(id).innerHTML = html; }

async function callResolver(path, body) {
  const r = await fetch(RESOLVER_BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || `resolver ${path} failed`);
  return j;
}

// §3.1 链接解析(与 SDK parseAttributionLink 逐字同一套规则, 纯浏览器实现——不依赖 kaspa-wasm,
// 这部分本来就是纯字符串/URL 操作)。
function parseAttributionLink(url) {
  const u = new URL(url);
  const quoteRef = u.searchParams.get('q');
  const chRaw = u.searchParams.get('ch');
  const rawChannelAddrs = chRaw ? chRaw.split(',') : [];
  const scRaw = u.searchParams.get('sc');
  const chainEntries = scRaw ? scRaw.split('.').map(part => {
    const [pos, addrB64, pkB64, sigB64] = part.split(':');
    return { position: Number(pos), address_spk_b64: addrB64, signing_pubkey_b64: pkB64, sig_b64: sigB64 };
  }) : [];
  return { quoteRef, rawChannelAddrs, chainEntries };
}

function b64urlToHex(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  let hex = '';
  for (let i = 0; i < bin.length; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, '0');
  return hex;
}

async function main() {
  // ① resolver 健康检查
  try {
    await fetch(RESOLVER_BASE + '/dedup-cap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"rawAddrs":[]}' });
    renderBox('resolverStatus', `<span class="ok">✓ resolver 已连接(${RESOLVER_BASE})</span>`);
  } catch {
    renderBox('resolverStatus', `<span class="bad">✗ 未连接到本机 resolver(${RESOLVER_BASE})——请先 <code>node resolver.mjs</code>。本页所有需要 kaspa-wasm 的步骤(验签/验链/构造交易)都依赖它, 详见页面顶部说明。</span>`);
    return;
  }

  // ② 解析链接
  const { quoteRef, rawChannelAddrs, chainEntries } = parseAttributionLink(location.href);
  renderBox('linkInfo', `<b>归因链接参数</b><table>
    <tr><td>quote 引用</td><td><code>${quoteRef || '(缺失)'}</code></td></tr>
    <tr><td>渠道地址(原始位置数)</td><td>${rawChannelAddrs.length}</td></tr>
    <tr><td>签名链条目数</td><td>${chainEntries.length}</td></tr>
  </table>`);
  if (rawChannelAddrs.length > 5) {
    renderBox('linkInfo', el('linkInfo').innerHTML + `<p class="bad">✗ N3: 原始位置数 ${rawChannelAddrs.length} > 5, 链接结构性无效, 拒绝继续</p>`);
    return;
  }

  // ③ 拉取报价(V1: q 参数直接是 base64 编码的完整报价 JSON, 或者 quote_id 需要调用方自行提供获取方式——
  // 本参考实现只演示 base64 内联形式, 与 §4.1"结账页只做本地计算, 不连我们的服务器"一致)。
  let quote;
  try {
    quote = JSON.parse(atob(quoteRef));
  } catch {
    renderBox('quoteInfo', `<span class="bad">✗ 无法解析报价(V1 参考实现只支持 q= 内联 base64 JSON, 不支持 quote_id 间接引用——间接引用需要商家自行提供报价托管方式)</span>`);
    return;
  }
  const vq = await callResolver('/verify-quote', { quote });
  renderBox('quoteInfo', `<b>报价</b><table>
    <tr><td>商家签名</td><td>${vq.ok ? '<span class="ok">✓ 验证通过</span>' : '<span class="bad">✗ 验证失败</span>'}</td></tr>
    <tr><td>价格</td><td>${quote.price_sompi} sompi</td></tr>
    <tr><td>mass 校验(签发时刻)</td><td>${quote.mass_feasibility_checked ? '<span class="ok">✓ 已过</span>' : '<span class="warn">未标注</span>'}</td></tr>
    <tr><td>要求渠道押金</td><td>${quote.require_channel_deposit ? '是' : '否'}</td></tr>
  </table>`);
  if (!vq.ok) return;

  // ④ 去重+上限(N2/N3) + 签名链验证(MUST: 下面只把 verifyChain 的结果喂给 resolveOrder, 不接受
  // rawChannelAddrs 单独作为付款地址来源——同 resolveRulesForOrder 头注同一条 MUST 纪律, 结账页
  // 这一层也不留一个"跳过验链直接用 ch= 地址"的旁路)。
  let verifiedChain;
  if (chainEntries.length) {
    const entries = chainEntries.map(e => ({ position: e.position, address_spk_hex: b64urlToHex(e.address_spk_b64), signing_pubkey_hex: b64urlToHex(e.signing_pubkey_b64), sig_hex: b64urlToHex(e.sig_b64) }));
    const vc = await callResolver('/verify-chain', { quote, entries, network: quote.network || 'simnet' });
    renderBox('chainInfo', `<b>签名链</b><table>
      <tr><td>验证结果</td><td>${vc.ok ? '<span class="ok">✓ 通过</span>' : `<span class="bad">✗ ${vc.reason}</span>`}</td></tr>
      <tr><td>已验证渠道数</td><td>${vc.channelSpksHex ? vc.channelSpksHex.length : 0}</td></tr>
    </table><p style="font-size:0.8rem;color:#666">§3.4.4: 一条真实链的前缀本身就是合法链(截断是允许的归因政策, 不是攻击)——如果这里显示的渠道数少于你预期, 可能是正常的截断, 也可能是恶意截断; 唯一能在付款前分辨的手段是核对渠道自己预先公开的地址声明(§3.3), 本参考实现不代为判断, 只如实展示验证结果。</p>`);
    if (!vc.ok) return;
    verifiedChain = { ok: true, channelSpksHex: vc.channelSpksHex };
  } else {
    // 无签名链的旧式纯地址链接: 走 dedup-cap(N2/N3), 但明确标注这是"无签名背书"的归因, 风险更高
    const dc = await callResolver('/dedup-cap', { rawAddrs: rawChannelAddrs });
    renderBox('chainInfo', `<b>渠道地址(无签名链背书)</b><table>
      <tr><td>解析结果</td><td>${dc.ok ? '<span class="warn">⚠ 已解析, 但无签名链背书</span>' : `<span class="bad">✗ ${dc.reason}</span>`}</td></tr>
    </table>`);
    if (!dc.ok) return;
    verifiedChain = { ok: true, channelSpksHex: dc.spksHex };
  }

  // ⑤ 订单地址推导(通过 resolver, 见文件头"为什么需要 resolver"说明)
  const order = await callResolver('/resolve-order', {
    quote, verifiedChain, network: quote.network || 'simnet', payerRefundAddress: quote.payer_refund_address_placeholder || null,
  });
  const rolesHtml = order.roles.map(r => `<tr><td>${r.name}</td><td>${(Number(r.amountSompi) / 1e8).toFixed(4)} KAS</td></tr>`).join('');
  renderBox('orderInfo', `<b>订单</b>
    <p>收款地址: <code>${order.address}</code></p>
    <p>截止时间: ${new Date(order.deadlineMs).toISOString()}</p>
    <table><tr><th>角色</th><th>金额</th></tr>${rolesHtml}</table>
    <p style="font-size:0.8rem;color:#666">付款前完整交易预检(O2, 三维度 mass)与实际广播由 resolver 在你提交付款 UTXO 后完成(V1 参考实现未接完整轮询 UI, 见 resolver.mjs 的 /build-and-broadcast-split 路由)。</p>`);
}

main().catch(e => renderBox('orderInfo', `<span class="bad">✗ ${e.message}</span>`));
