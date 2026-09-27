// checkout.js — 浏览器页面胶水层。解析归因链接 §3.1, 展示报价/签名链校验结果, 展示 mass 预检提示,
// 推导订单地址。真正的逻辑在 verify-core.js(验签/验链/去重)+ resolve-order-wasm.js(角色解析+
// 订单地址推导, 主路径, 真 silverc 编译器编 wasm32——见该文件头注)+ resolve-order-browser.js(同一
// 角色解析 + order-template.js 固定偏移覆写, 备选路径, silverc-wasm 加载失败时自动降级), 均零浏览器
// 全局依赖, 与 Node 侧的 parity 测试共用同一份代码(见 docs/provenance/2026-09-27-j2-checkout-pure-static-r2/)。
//
// NWT diff 审 SHOULD③(2026-09-27T10-11Z)+ D-034 §8 后续票① 落地: 报价验签/签名链验证/渠道
// 地址去重与上限/订单地址推导——全部直接用本仓 D:\rusty-kaspa\wasm\build-web --sdk 产出的浏览器版
// kaspa-wasm(`./vendor/kaspa-web/`)+ D:\silverscript\silverscript-lang 编的浏览器版 silverc
// (`./vendor/silverc-wasm/`)+ vendored blake2b/fee-split 在浏览器原生跑, **完全不依赖 resolver.mjs**
// (含订单地址推导这最后一步——①第一轮曾错误判定"不可安全达成"、第二轮用固定偏移覆写验证成功、
// 第三轮改用真编译器编 wasm 作为主路径, 两条路径均以 630 组随机 ctor 向量对 D-019 锚定的 silverc
// v1.0.0 CLI 逐字节 parity 验证过, 完整证据链见 order-template.js 与 resolve-order-wasm.js 头注)。
//
// 🔴 resolver.mjs 现在唯一还需要的场景: 实际广播交易(submitTransaction)需要连节点 RPC——kaspa-wasm
// 的 RpcClient 在 web target 下原理上应该也能浏览器原生 WebSocket 直连, 但 V1 未验证过这条路径,
// 如实标为"待验证", 不冒充已完成; 本页面当前也没有"付款/广播"这一步的 UI, 只到"看到订单地址"为止。
import * as verifyCore from './verify-core.js';
import * as RB from './resolve-order-browser.js';
import * as RW from './resolve-order-wasm.js';
import * as feeSplitLib from './vendor/fee-split-browser.mjs';

// D-034 §8 后续票②(同 D-019 pin 纪律): 启动期核 wasm 二进制 sha256, 不符即拒绝初始化。
// 🔴 这个值是从 scripts/kaspa-wasm-web-pin.json(仓库里的权威锚点)里抄来的常量, 不是从那个文件
// 现查——理由是③"任何人把 checkout-static/ 这个文件夹整个搬到任意静态托管即可用": 一旦这个文件夹
// 离开本仓目录结构(比如被复制到另一台机器的另一个路径), 相对路径指回仓库根目录的 scripts/ 就会
// 断; 硬编码在这里牺牲"改锚点要同时改两处"的一点点便利, 换来真正的自包含可移植性——人工核对纪律:
// 改 scripts/kaspa-wasm-web-pin.json 的 sha256 时必须同步改这里, 两处不一致会在本文件启动时被
// wasmPinStatus.ok===false 立刻发现(不是"悄悄漂移直到出事")。
const EXPECTED_KASPA_WASM_SHA256 = '732bdaa3ee8353c026654e9c7dd729674eb1bd064e8a0b8927b4cfb7df859e51';
// scripts/silverc-wasm-pin.json 的权威锚点抄一份到这里, 理由同上(自包含可移植性)。
const EXPECTED_SILVERC_WASM_SHA256 = '868e3f1b247a02b2a2eb39350dfcdd2fe03157c57d99b803b7e9ab2d7bfdc325';

// D-034 §8 B段⑧d(Bettor 派工, 弱网首屏可交互): 带进度的 fetch——不是为了炫技, 是因为两个 wasm
// 加起来 16.7MB, 弱网下用户会对着空白页面等好几分钟(见 A 段实测: 400kbps 模拟下 120s 还没下完),
// 没有任何反馈时用户大概率以为页面卡死/关掉标签页。用 Content-Length + 流式读取报真实百分比;
// 拿不到 Content-Length(极少数托管不带这个头)时退化成"已收到 X.X MB"(无法算百分比, 不假装有)。
// 顺手报"是否命中浏览器缓存"(第二次打开同一页面理应秒开, 用户应该看到这个区别)。
async function fetchWithProgress(url, onProgress) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch ${url} failed: HTTP ${resp.status}`);
  const totalStr = resp.headers.get('content-length');
  const total = totalStr ? Number(totalStr) : null;
  // transferSize===0 且 body 非空 = 命中 HTTP 缓存(浏览器没有真的发网络请求), Cache-Control 配对时
  // 第二次访问应该是这个情况——不是每个引擎的 resource timing 都保证在这个时间点已经落盘, 尽力而为。
  let fromCache = false;
  try {
    const entries = performance.getEntriesByType('resource').filter((r) => r.name.endsWith(url.replace('./', '/')));
    const last = entries[entries.length - 1];
    if (last && last.transferSize === 0 && last.decodedBodySize > 0) fromCache = true;
  } catch {}
  if (!resp.body || !resp.body.getReader) { const buf = await resp.arrayBuffer(); onProgress?.(buf.byteLength, total, fromCache); return buf; }
  const reader = resp.body.getReader();
  const chunks = []; let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); received += value.byteLength;
    onProgress?.(received, total, fromCache);
  }
  const out = new Uint8Array(received); let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  return out.buffer;
}
const fmtMB = (n) => (n / 1048576).toFixed(1);

let kaspaWasm = null, blake2b = null, wasmLoadError = null, wasmPinStatus = null;
try {
  const wasmBytes = await fetchWithProgress('./vendor/kaspa-web/kaspa_bg.wasm', (received, total, fromCache) => {
    renderBox('resolverStatus', fromCache
      ? `下载 kaspa-wasm…(浏览器缓存命中, 秒开)`
      : total
        ? `下载 kaspa-wasm… ${fmtMB(received)} / ${fmtMB(total)} MB (${((received / total) * 100).toFixed(0)}%)`
        : `下载 kaspa-wasm… 已收到 ${fmtMB(received)} MB(服务器未带 Content-Length, 无法算百分比)`);
  });
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

// CommissionSplit.sil 源码 + 其真实 sha256——独立于下面 silverc-wasm 是否加载成功都要取到,
// 理由(NWT MUST, 2026-09-27T11-37Z, 见 order-template.js 头注): 降级路径(order-template.js 固定
// 字节模板)在 silverc-wasm 加载失败时才会被用到, 而恰恰是这个场景下最需要核对"随页面发布的源码"跟
// "模板生成时用的源码"是不是同一份——如果这一步也塞进下面那个 try 块, silverc-wasm 一旦加载失败,
// 这份 sha256 就永远拿不到, fail-closed 检查根本无法执行, MUST 就白修了。
let commissionSplitSource = null, commissionSplitSourceSha256 = null, silSourceLoadError = null;
try {
  commissionSplitSource = await (await fetch('./vendor/sil-source/CommissionSplit.sil')).text();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(commissionSplitSource));
  commissionSplitSourceSha256 = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
} catch (e) { silSourceLoadError = e; }

// silverc-wasm(真编译器, 5.3MB)——D-034 §8 B段⑧d(Bettor 派工): 不再跟 kaspa-wasm 一起在页面
// 打开时就下载。只有验签/验链这些"看报价"的功能需要的是 kaspa-wasm(11.4MB), silverc-wasm
// 只在用户真的点了"确认并推导订单地址"之后才用得到——大部分只是打开链接看一眼报价的访问者,
// 从没点过那个按钮, 让他们也扛这 5.3MB 完全是浪费(弱网下尤其明显, 见 A 段实测)。
// 改成惰性加载: 第一次调用 loadSilvercWasm() 才真的 fetch, 之后的调用复用同一个 Promise(不会
// 点两次按钮就下载两次)。失败不阻塞页面其余功能, 只让订单地址推导那一步自动降级到
// order-template.js 固定偏移覆写路径(resolve-order-browser.js, 已验证的备选, 带 fail-closed
// sha256 核对, 见上面 EXPECTED_SILVERC_WASM_SHA256 那段注释)。
let silvercWasm = null, silvercWasmLoadError = null, _silvercLoadPromise = null;
function loadSilvercWasm(onProgress) {
  if (_silvercLoadPromise) return _silvercLoadPromise; // 已经在下载/已经下载完, 不重复发请求
  _silvercLoadPromise = (async () => {
    try {
      const wasmBytes = await fetchWithProgress('./vendor/silverc-wasm/silverc_lang_bg.wasm', onProgress);
      const digest = await crypto.subtle.digest('SHA-256', wasmBytes);
      const actualSha256 = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
      if (actualSha256 !== EXPECTED_SILVERC_WASM_SHA256) {
        throw new Error(`silverc_lang_bg.wasm sha256 不符 pin(期望 ${EXPECTED_SILVERC_WASM_SHA256}, 实际 ${actualSha256}) — 拒绝使用, 降级到 order-template.js 路径`);
      }
      const wasmMod = await import('./vendor/silverc-wasm/silverc_lang.js');
      const compiledModule = await WebAssembly.compile(wasmBytes); // 同 kaspa-wasm 那段注释, 同一大小限制/同一份已核验字节
      await wasmMod.default({ module_or_path: compiledModule });
      silvercWasm = wasmMod;
    } catch (e) { silvercWasmLoadError = e; }
  })();
  return _silvercLoadPromise;
}

function el(id) { return document.getElementById(id); }
function renderBox(id, html) { el(id).innerHTML = html; }

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
  // silverc-wasm(5.3MB)不在这里报状态——它现在惰性加载, 点"确认并推导订单地址"才会真的下载(见
  // loadSilvercWasm 头注), 这个时间点它还没开始下载, 不是"加载失败", 别混着说。
  renderBox('resolverStatus', `<span class="ok">✓ 浏览器原生 kaspa-wasm 已加载, sha256 核对通过(${wasmPinStatus.actualSha256.slice(0, 16)}…)——报价验签/签名链验证/渠道地址解析全部在本页运行, 全程不依赖 resolver.mjs。订单地址推导用的 silverc 编译器(5.3MB)会在你点"确认并推导订单地址"时才按需下载, 不占这次页面打开的载荷。</span>`);

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

  // 订单地址推导现在浏览器原生完成(D-034 §8 后续票①第二轮, order-template.js 固定偏移覆写,
  // 不调用 silverc.exe/resolver.mjs)。
  // 🔴 退款地址输入框(第一轮 E2E 真实测试发现的真 bug, 不是设计文档里就想到的): CommissionSplit
  // ctor 结构上要求"付款人退款地址"这个字段, 而这个值只有消费者自己知道、报价里不可能预先填好——
  // 消费者填完之后再点按钮触发订单地址推导, 不是自动跑。
  document.getElementById('resolveOrderBtn').addEventListener('click', async () => {
    const refundAddr = document.getElementById('refundAddr').value.trim();
    if (!refundAddr) { renderBox('orderInfo', '<span class="bad">✗ 退款地址必填——订单地址的推导结构上依赖它(ctor 字段), 不是可选项</span>'); return; }
    // D-034 §8 B段⑧d: 这里才真的去下载 silverc-wasm(惰性加载, 头一次点这个按钮才发请求, 之后复用)。
    renderBox('orderInfo', '正在加载 silverc 编译器…');
    await loadSilvercWasm((received, total, fromCache) => {
      renderBox('orderInfo', fromCache
        ? '加载 silverc 编译器…(浏览器缓存命中, 秒开)'
        : total
          ? `加载 silverc 编译器… ${fmtMB(received)} / ${fmtMB(total)} MB (${((received / total) * 100).toFixed(0)}%)`
          : `加载 silverc 编译器… 已收到 ${fmtMB(received)} MB`);
    });
    try {
      const resolved = RB.resolveRulesForOrder(kaspaWasm, feeSplitLib, quote, verifiedChain);
      const finalRoles = resolved.payoutLeaves.map(r => ({ amountSompi: r.amountSompi, spk: r.spk }));
      const orderCfg = {
        network, finalRoles, payerRefundAddress: refundAddr,
        deadlineMs: Date.now() + Number(quote.deadline_offset_ms || 259200000),
        maxSplitFeeSompi: BigInt(quote.max_split_fee_sompi), maxRefundFeeSompi: BigInt(quote.max_refund_fee_sompi),
      };
      // 主路径: 真 silverc 编译器(wasm32)。降级: order-template.js 固定偏移覆写(silverc-wasm 加载失败时,
      // 见 silvercWasmLoadError——上面 loadSilvercWasm() 已经 await 过, 到这里加载已经有确定结果了)。
      const usedWasmCompiler = !!(silvercWasm && commissionSplitSource);
      const order = usedWasmCompiler
        ? RW.deriveCommissionOrderAddress(kaspaWasm, silvercWasm, commissionSplitSource, orderCfg)
        // 降级路径 fail-closed 检查(NWT MUST, 2026-09-27T11-37Z): 传入随页面发布的 CommissionSplit.sil
        // 真实 sha256, 与 order-template.js 记录的模板生成锚点不一致就在 RB 内部直接拒绝(见该函数头注)。
        : RB.deriveCommissionOrderAddress(kaspaWasm, orderCfg, commissionSplitSourceSha256);
      const rolesHtml = resolved.payoutLeaves.map(r => `<tr><td>${r.name}</td><td>${(Number(r.amountSompi) / 1e8).toFixed(4)} KAS</td></tr>`).join('');
      renderBox('orderInfo', `<b>订单</b>(浏览器原生推导${usedWasmCompiler ? '·真 silverc 编译器' : '·固定偏移覆写降级路径'}, 零网络请求)<table>
        <tr><td>收款地址</td><td><code>${order.address}</code></td></tr>
        <tr><td>截止时间</td><td>${new Date(order.deadlineMs).toISOString()}</td></tr>
      </table><table><tr><th>角色</th><th>金额</th></tr>${rolesHtml}</table>`);
    } catch (e) {
      renderBox('orderInfo', `<span class="bad">✗ 订单地址推导失败(${e.message})</span>`);
    }
  });
}

main().catch(e => renderBox('orderInfo', `<span class="bad">✗ ${e.message}</span>`));
