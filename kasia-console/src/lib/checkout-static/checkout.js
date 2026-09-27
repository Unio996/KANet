// checkout.js — 浏览器页面胶水层。解析归因链接 §3.1, 展示报价/签名链校验结果, 展示 mass 预检提示。
// 真正的验证逻辑在 verify-core.js(零浏览器全局依赖, 与 Node 侧的 parity 测试共用同一份代码,
// 见 docs/provenance/2026-09-27-j2-commission-plan-impl/verify_core_parity_test.mjs)。
//
// NWT diff 审 SHOULD③(2026-09-27T10-11Z)落地: 报价验签/签名链验证/渠道地址去重与上限——这三步
// 现在直接用本仓 D:\rusty-kaspa\wasm\build-web --sdk 产出的浏览器版 kaspa-wasm(`./vendor/kaspa-web/`)
// + 已验证过与 npm 版逐字节一致的 vendored blake2b(`./vendor/noble-hashes/`)在浏览器原生跑,
// **不再经过本机 resolver.mjs**。
//
// 🔴 仍然需要 resolver.mjs 的部分(真实原因, 不是懒得做): 订单地址推导(createCommissionSplitProtocol)
// 依赖 silverc.exe——独立的原生编译器可执行文件, 跟 kaspa-wasm 编译成什么 target(node/web)完全无关,
// 没有浏览器版本, 也不是"下一个可以直接排的小任务"能解决的(除非把 silverc 本身也编译成 wasm, 量级
// 完全不同的独立工作)。实际广播交易(submitTransaction)同理需要 resolver.mjs 侧连节点 RPC——
// kaspa-wasm 的 RpcClient 在 web target 下原理上应该也能浏览器原生 WebSocket 直连, 但 V1 未验证过
// 这条路径, 如实标为"待验证", 不冒充已完成。
import * as verifyCore from './verify-core.js';

const RESOLVER_BASE = (new URLSearchParams(location.search).get('resolver')) || 'http://127.0.0.1:8787';

// D-034 §8 后续票②(同 D-019 pin 纪律): 启动期核 wasm 二进制 sha256, 不符即拒绝初始化。
// 🔴 这个值是从 scripts/kaspa-wasm-web-pin.json(仓库里的权威锚点)里抄来的常量, 不是从那个文件
// 现查——理由是③"任何人把 checkout-static/ 这个文件夹整个搬到任意静态托管即可用": 一旦这个文件夹
// 离开本仓目录结构(比如被复制到另一台机器的另一个路径), 相对路径指回仓库根目录的 scripts/ 就会
// 断; 硬编码在这里牺牲"改锚点要同时改两处"的一点点便利, 换来真正的自包含可移植性——人工核对纪律:
// 改 scripts/kaspa-wasm-web-pin.json 的 sha256 时必须同步改这里, 两处不一致会在本文件启动时被
// wasmPinStatus.ok===false 立刻发现(不是"悄悄漂移直到出事")。
const EXPECTED_KASPA_WASM_SHA256 = '732bdaa3ee8353c026654e9c7dd729674eb1bd064e8a0b8927b4cfb7df859e51';

let kaspaWasm = null, blake2b = null, wasmLoadError = null, wasmPinStatus = null;
try {
  const wasmResp = await fetch('./vendor/kaspa-web/kaspa_bg.wasm');
  const wasmBytes = await wasmResp.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', wasmBytes);
  const actualSha256 = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  if (actualSha256 !== EXPECTED_KASPA_WASM_SHA256) {
    wasmPinStatus = { ok: false, actualSha256, expected: EXPECTED_KASPA_WASM_SHA256 };
    throw new Error(`kaspa_bg.wasm sha256 不符 pin(期望 ${EXPECTED_KASPA_WASM_SHA256}, 实际 ${actualSha256}) — 拒绝初始化`);
  }
  wasmPinStatus = { ok: true, actualSha256 };
  const wasmMod = await import('./vendor/kaspa-web/kaspa.js');
  // 🔴 真实浏览器测试坐实(Node 模拟测不出来, Playwright/真 Chromium 才发现): `initSync` 内部用
  // `new WebAssembly.Instance(module, imports)`(同步构造), 而 Chrome 主线程**禁止**对 >4MB(实测
  // 报错阈值写的是 8MB, 官方文档口径 4KB 默认/可配置更大, 以实测报错为准)的模块做同步实例化——
  // 本产物 11.4MB, 直接撞这条限制("WebAssembly.Instance is disallowed on the main thread")。
  // 改用官方导出的异步 init()(`wasmMod.default`), 它内部走 `WebAssembly.instantiate`(异步), 没有
  // 这条大小限制——仍然用我们已经校验过 sha256 的同一份 `WebAssembly.Module` 对象, 不重新走一次
  // 未经校验的 fetch。
  const compiledModule = await WebAssembly.compile(wasmBytes);
  await wasmMod.default({ module_or_path: compiledModule });
  kaspaWasm = wasmMod;
  blake2b = (await import('./vendor/noble-hashes/blake2b.js')).blake2b;
} catch (e) { wasmLoadError = e; }

function el(id) { return document.getElementById(id); }
function renderBox(id, html) { el(id).innerHTML = html; }

async function callResolver(path, body) {
  const r = await fetch(RESOLVER_BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || `resolver ${path} failed`);
  return j;
}

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

async function main() {
  if (wasmLoadError) {
    const pinNote = wasmPinStatus && wasmPinStatus.ok === false
      ? `<br>sha256 不符: 期望 <code>${wasmPinStatus.expected}</code>, 实际 <code>${wasmPinStatus.actualSha256}</code>——可能是构建产物被替换, 也可能是本地重新构建产出了不同的 wasm-opt 结果(见 vendor/kaspa-web/README.md "非确定性构建"说明), 拒绝初始化不是误报, 请人工核实。`
      : '';
    renderBox('resolverStatus', `<span class="bad">✗ 浏览器版 kaspa-wasm 未部署或未通过 sha256 核对(${wasmLoadError.message})——见 vendor/kaspa-web/README.md 的构建命令; 这不是静默降级, 缺失/不符时不做任何验证${pinNote}</span>`);
    return;
  }
  renderBox('resolverStatus', `<span class="ok">✓ 浏览器原生 kaspa-wasm 已加载, sha256 核对通过(${wasmPinStatus.actualSha256.slice(0, 16)}…)——报价验签/签名链验证/渠道地址解析全部在本页运行, 不再依赖 resolver.mjs</span>`);

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

  let quote;
  try { quote = JSON.parse(atob(quoteRef)); }
  catch {
    renderBox('quoteInfo', `<span class="bad">✗ 无法解析报价(V1 参考实现只支持 q= 内联 base64 JSON)</span>`);
    return;
  }
  const quoteOk = verifyCore.verifyQuoteSignature(kaspaWasm, quote);
  renderBox('quoteInfo', `<b>报价</b>(浏览器原生验签, 无网络请求)<table>
    <tr><td>商家签名</td><td>${quoteOk ? '<span class="ok">✓ 验证通过</span>' : '<span class="bad">✗ 验证失败</span>'}</td></tr>
    <tr><td>价格</td><td>${quote.price_sompi} sompi</td></tr>
    <tr><td>mass 校验(签发时刻)</td><td>${quote.mass_feasibility_checked ? '<span class="ok">✓ 已过</span>' : '<span class="warn">未标注</span>'}</td></tr>
    <tr><td>要求渠道押金</td><td>${quote.require_channel_deposit ? '是' : '否'}</td></tr>
  </table>`);
  if (!quoteOk) return;

  const network = quote.network || 'simnet';
  let verifiedChain;
  if (chainEntries.length) {
    const entries = chainEntries.map(e => ({ position: e.position, address_spk: verifyCore.b64urlToBytes(e.address_spk_b64), signing_pubkey: verifyCore.b64urlToBytes(e.signing_pubkey_b64), sig: verifyCore.bytesToHex(verifyCore.b64urlToBytes(e.sig_b64)) }));
    const vc = verifyCore.verifyChain(kaspaWasm, blake2b, quote, entries, network);
    renderBox('chainInfo', `<b>签名链</b>(浏览器原生验证)<table>
      <tr><td>验证结果</td><td>${vc.ok ? '<span class="ok">✓ 通过</span>' : `<span class="bad">✗ ${vc.reason}</span>`}</td></tr>
      <tr><td>已验证渠道数</td><td>${vc.channelSpks ? vc.channelSpks.length : 0}</td></tr>
    </table><p style="font-size:0.8rem;color:#666">§3.4.4: 一条真实链的前缀本身就是合法链(截断是允许的归因政策, 不是攻击)——如果这里显示的渠道数少于你预期, 可能是正常的截断, 也可能是恶意截断; 唯一能在付款前分辨的手段是核对渠道自己预先公开的地址声明(§3.3), 本参考实现不代为判断, 只如实展示验证结果。</p>`);
    if (!vc.ok) return;
    verifiedChain = { ok: true, channelSpksHex: vc.channelSpks.map(verifyCore.bytesToHex) };
  } else {
    const dc = verifyCore.dedupAndCapChannelSpks(kaspaWasm, rawChannelAddrs);
    renderBox('chainInfo', `<b>渠道地址(无签名链背书, 浏览器原生解析)</b><table>
      <tr><td>解析结果</td><td>${dc.ok ? '<span class="warn">⚠ 已解析, 但无签名链背书</span>' : `<span class="bad">✗ ${dc.reason}</span>`}</td></tr>
    </table>`);
    if (!dc.ok) return;
    verifiedChain = { ok: true, channelSpksHex: dc.spks.map(s => s ? verifyCore.bytesToHex(s) : null) };
  }

  // 订单地址推导仍需 resolver.mjs(真实原因见文件头: silverc.exe 原生编译器, 跟 kaspa-wasm target 无关)。
  // 🔴 E2E 真实测试发现(第一轮跑出真 bug, 不是设计文档里就想到的): CommissionSplit ctor 结构上
  // 要求"付款人退款地址"这个字段, 而这个值只有消费者自己知道、报价里不可能预先填好——之前的版本
  // 直接用一个不存在的 quote 字段(quote.payer_refund_address_placeholder)兜底成 null, 传给 resolver
  // 之后在 spkBytesFromAddress(null) 这一步崩溃("Cannot read properties of null")。真实修法: 页面
  // 加一个"你的退款地址"输入框, 消费者填完之后再点按钮触发订单地址推导, 不是自动跑。
  document.getElementById('resolveOrderBtn').addEventListener('click', async () => {
    const refundAddr = document.getElementById('refundAddr').value.trim();
    if (!refundAddr) { renderBox('orderInfo', '<span class="bad">✗ 退款地址必填——订单地址的推导结构上依赖它(ctor 字段), 不是可选项</span>'); return; }
    try {
      const order = await callResolver('/resolve-order', { quote, verifiedChain, network, payerRefundAddress: refundAddr });
      const rolesHtml = order.roles.map(r => `<tr><td>${r.name}</td><td>${(Number(r.amountSompi) / 1e8).toFixed(4)} KAS</td></tr>`).join('');
      renderBox('orderInfo', `<b>订单</b>(地址推导经 resolver.mjs——需要 silverc.exe, 与 kaspa-wasm 浏览器化无关, 见文件头说明)
        <p>收款地址: <code>${order.address}</code></p>
        <p>截止时间: ${new Date(order.deadlineMs).toISOString()}</p>
        <table><tr><th>角色</th><th>金额</th></tr>${rolesHtml}</table>`);
    } catch (e) {
      renderBox('orderInfo', `<span class="warn">⚠ 已通过浏览器原生验证(签名/签名链均通过), 但订单地址推导需要本机 resolver.mjs(${e.message})——请 <code>node resolver.mjs</code></span>`);
    }
  });
}

main().catch(e => renderBox('orderInfo', `<span class="bad">✗ ${e.message}</span>`));
