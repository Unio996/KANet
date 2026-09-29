// checkout.js — 浏览器页面胶水层。解析归因链接 §3.1, 展示报价/签名链校验结果, 展示 mass 预检提示,
// 推导订单地址。真正的逻辑在 verify-core.js(验签/验链/去重)+ resolve-order-wasm.js(角色解析+
// 订单地址推导, 主路径, 真 silverc 编译器编 wasm32——见该文件头注)+ resolve-order-browser.js(同一
// 角色解析 + order-template.js 固定偏移覆写, 备选路径, silverc-wasm 加载失败时自动降级), 均零浏览器
// 全局依赖, 与 Node 侧的 parity 测试共用同一份代码(见 docs/provenance/2026-09-27-j2-checkout-pure-static-r2/)。
//
// NWT diff 审 SHOULD③(2026-09-27T10-11Z)+ D-034 §8 后续票① 落地: 报价验签/签名链验证/渠道
// 地址去重与上限/订单地址推导——全部直接用 rusty-kaspa `wasm/build-web --sdk` 产出的浏览器版
// kaspa-wasm(`./vendor/kaspa-web/`, 重建方法见该目录 README.md)+ silverscript-lang 编的浏览器版
// silverc(`./vendor/silverc-wasm/`, 重建方法见该目录 README.md)+ vendored blake2b/fee-split 在浏览器
// 原生跑, **完全不依赖 resolver.mjs**
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
// D-034 §8 B段⑤(Bettor 派工, 2026-09-27): 收款页展示 QR 码, 让任何钱包扫码就能付——页面自己零依赖
// 私钥, 只是把已经推导出来的收款地址/金额编码成 kaspa: URI 给用户扫。qrcode-generator(MIT, Kazuhiko
// Arase) 是纯 JS、零依赖的小型编码器, vendor 进来(同 noble-hashes 惯例), 不需要 canvas/网络。
import qrcodeFactory from './vendor/qrcode-generator/qrcode.mjs';
// D-034 §8 B段⑥(Bettor 派工, 2026-09-27): 付款到账后, 浏览器直连节点触发分账/退款——两个入口零签名
// (covenant 脚本本身就是判据, 不需要买家私钥), 广播前完整三维 mass 预检, 广播后回链核实落地。
import { connectMonitorRpc, getOrderPaymentStatus, getCurrentPmtMs, getCurrentDaaScore, REORG_SAFE_MIN_DEPTH } from './monitor.js';
import { buildCommissionSplitTx, buildCommissionRefundTx } from './broadcast-commission.js';
// D-034 §9(2026-09-28, Bettor 派工): ServiceEscrow 订单的到期退款——零签名, 逐字复用
// commission-plan-sdk.mjs::computeTimeoutSplit 的公式(见该文件头注)。
import { buildServiceEscrowTimeoutDefaultTx } from './broadcast-service-escrow.js';
import { estimateMassUpperBound } from './vendor/tx-mass-ub-browser.mjs';

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
  // 🔴 NWT MUST(2026-09-27T12-23Z, 真机复现): fetch() 对 Content-Encoding: br/gzip 的响应体是浏览器
  // 透明解压的——reader 吐出来的是【解压后】字节, 但 Content-Length 响应头描述的是【压缩前、实际过线】
  // 的字节数, 两者不是同一个量纲, 拿"解压后累计接收量 / 压缩前总量"算百分比会在接近下载完时飙到远超
  // 100%(真实 wasm 文件的压缩比推算会到 ~290%, 不是危言耸听的极端案例)。而这份交付自己在 ⑧a 建议
  // "部署必须开 br"——即恰好是这个 bug 必然触发的配置, 不能只在未压缩场景测过就当通过。
  // 修法: Content-Encoding 存在且不是 identity 时不信任 Content-Length 做分母, 退化到已有的
  // "已收到 X.X MB"分支(那条分支本身没问题, 只是触发条件之前没把"压缩传输"这个情况算进去)。
  const contentEncoding = (resp.headers.get('content-encoding') || 'identity').toLowerCase();
  const isCompressed = contentEncoding !== 'identity';
  const totalStr = isCompressed ? null : resp.headers.get('content-length');
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

// sompi(BigInt) → KAS 十进制字符串, 整数算术不经浮点——1 sompi = 1e-8 KAS, Number()/toFixed() 那条路径
// (既有 rolesHtml 那行用的) 在 amount 大到超过 2^53 以后会丢精度, 且扫码付款这个场景金额必须精确到
// 最后一个 sompi(少付一点点买家自己承担, 多付找零由 covenant 逻辑处理, 但地址栏显示的数字不能就先错)。
function sompiToKasString(sompiBigInt) {
  const neg = sompiBigInt < 0n;
  const abs = neg ? -sompiBigInt : sompiBigInt;
  const whole = abs / 100000000n;
  const frac = (abs % 100000000n).toString().padStart(8, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + whole.toString() + (frac ? '.' + frac : '');
}

// kaspa: 付款 URI(格式按 BIP21 同族惯例——Kaspa 生态里 Kaspium/KDX 等钱包的收款链接常用这个形状,
// 但本页未拿真机逐一验证过每个钱包是否识别 amount 参数, 真机扫码兼容性待验证, 不冒充"通用支持"
// 这个更强的断言)——只编码地址+金额两个公开字段, 页面本身从不持有/传输任何私钥, 扫码方用自己的
// 钱包自己签名广播。
function buildKaspaPaymentUri(address, totalSompi) {
  return `${address}?amount=${sompiToKasString(totalSompi)}`;
}

// 用 vendor 进来的 qrcode-generator(MIT)编 SVG——不用 canvas(避免污染画布权限模型这类边缘情况),
// scalable:true 让 SVG 自适应容器宽度, 缩放不失真, 适合手机扫码时的各种屏幕尺寸。
function renderQrSvg(text) {
  const qr = qrcodeFactory(0, 'M'); // typeNumber=0 自动选版本, errorCorrectionLevel='M'(中等纠错, 常见二维码默认档位)
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ scalable: true });
}

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
// D-034 §8 后续票⑦(Bettor 派工 2026-09-27): silverc-wasm(真编译器)加载失败时给清楚的原因+可行的
// 替代方式——不是只说"降级了"就完事, 也不建议任何我们自己运营的服务(本页/本仓库的定位是协议基础
// 设施, 不是产品, 见 docs/KANet-Positioning.md "只建地基不造房子")。三条选项按"最省事→最独立"排列。
function compilerFailureAlternativesHtml(errMsg) {
  return `<div class="box" style="border-color:#b36b00">
    <b class="warn">⚠ silverc 编译器(真实合约编译器)加载失败</b>：<code>${errMsg}</code><br>
    本页已自动降级到固定偏移覆写路径继续完成订单地址推导(该路径同样用 320+ 组随机向量独立验证过,
    订单地址本身仍然有效)，但触发分账/退款需要真编译器，这个功能这次不可用。
    <p style="margin-top:0.5rem">如果你想用主路径(真编译器 + 可触发分账/退款)，有这几个办法：</p>
    <ol style="margin:0.3rem 0 0 1.2rem; padding:0">
      <li>换一个支持 WebAssembly 的浏览器，或检查网络连接后刷新页面重试(最简单，多数情况下这样就够了)。</li>
      <li>自己从这个项目的 GitHub Release 下载发布包(纯静态文件)，托管到任何你信得过的地方(自己的
        服务器、对象存储、任意静态托管)——不需要依赖我们的服务器，这份发布包设计成整个文件夹拿去
        随便放哪都能用。</li>
      <li>在自己的电脑上运行这仓库自带的 <code>resolver.mjs</code>(走真实 silverc 命令行编译器，不
        需要浏览器 WASM)——这条路径任何人都能自己跑，源码开放，不依赖我们运营任何东西。</li>
    </ol>
    <p style="font-size:0.8rem;color:#666;margin-top:0.4rem">这不是我们服务器出问题——本页本身零后端
    依赖，"加载失败"通常是浏览器兼容性或网络问题，上面三条里换浏览器/重试网络通常最快解决。</p>
  </div>`;
}

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

// 导出供回归测试直接调用(同 buildVerifiedChain 的理由: 测试要走 checkout.js 的真实解析代码,
// 不是自己重新手搓一份 chainEntries/rawChannelAddrs 的等价 shape——那样万一 checkout.js 这边的
// 解析逻辑本身漂移了, 测试也发现不了)。
export function parseAttributionLink(url) {
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

// ── D-034 §8 B段⑥: 订单状态监控 + 触发分账/退款(仅真 silverc 编译器主路径可用——entries/redeemScriptHex
// 等字段只有真编译才有, 降级路径 order-template.js 固定偏移覆写没有这些, 见 startOrderMonitor 调用点判断) ──
let _monitorPollTimer = null;
let _monitorBusy = false; // 广播进行中禁止并发触发(防重复点击造成竞态花费同一笔 UTXO)

async function startOrderMonitor(order, totalSompi, network) {
  if (_monitorPollTimer) clearInterval(_monitorPollTimer);
  const rpcUrlOverride = new URLSearchParams(location.search).get('rpcUrl') || undefined; // simnet 测试用, 见 monitor.js connectMonitorRpc 头注
  renderBox('monitorInfo', '<b>订单状态监控</b><br>连接节点中…');
  let rpc, connectedUrl;
  try {
    ({ rpc, url: connectedUrl } = await connectMonitorRpc(kaspaWasm, { network, rpcUrl: rpcUrlOverride }));
  } catch (e) {
    renderBox('monitorInfo', `<b>订单状态监控</b><br><span class="bad">✗ 连接节点失败: ${e.message}</span>`);
    return;
  }

  let alreadyFunded = false; // 用于区分"从没到过账"和"到过账后地址变空(=已被 split/refund 花掉)"

  async function renderMonitorState() {
    if (_monitorBusy) return; // 广播流程自己接管渲染, 轮询期间不要覆盖
    let status;
    try { status = await getOrderPaymentStatus(rpc, order.address, totalSompi); }
    catch (e) { renderBox('monitorInfo', `<b>订单状态监控</b>(连 ${connectedUrl})<br><span class="bad">✗ 查询失败: ${e.message}</span>`); return; }

    if (status.state === 'unfunded') {
      if (alreadyFunded) {
        renderBox('monitorInfo', `<b>订单状态监控</b>(连 ${connectedUrl})<br><span class="ok">✓ 订单已完成——收款地址资金已离开(分账或退款已被节点接受)</span>`);
        clearInterval(_monitorPollTimer);
        return;
      }
      renderBox('monitorInfo', `<b>订单状态监控</b>(连 ${connectedUrl})<br>状态: <span class="warn">未到账</span>——等待买家扫码付款`);
      return;
    }
    alreadyFunded = true;

    const receivedKas = sompiToKasString(status.totalSompi);
    const expectedKas = sompiToKasString(totalSompi);
    const depthText = status.depth == null ? '未知' : `${status.depth}(需要 ≥${REORG_SAFE_MIN_DEPTH} 才算深确认)`;
    let stateHtml;
    if (status.state === 'underfunded') stateHtml = `<span class="warn">⚠ 到账不足</span>——已收到 ${receivedKas} KAS, 应付 ${expectedKas} KAS`;
    else if (status.state === 'overfunded') stateHtml = `<span class="warn">⚠ 超额到账</span>——已收到 ${receivedKas} KAS, 应付 ${expectedKas} KAS(多出部分会在触发分账时作为找零退给付款人)`;
    else stateHtml = `<span class="ok">✓ 已到账</span>——${receivedKas} KAS`;

    let currentPmtMs = null, pmtErr = null;
    try { currentPmtMs = await getCurrentPmtMs(rpc); } catch (e) { pmtErr = e.message; }
    const deadlineDate = new Date(order.deadlineMs).toISOString();
    const pmtEligibleForRefund = currentPmtMs != null && currentPmtMs >= order.deadlineMs + 5000;
    const depthOkForSplit = status.state !== 'unfunded' && status.depth != null && status.depth >= REORG_SAFE_MIN_DEPTH && status.state !== 'underfunded';

    renderBox('monitorInfo', `<b>订单状态监控</b>(连 ${connectedUrl})<br>
      状态: ${stateHtml}<br>确认深度: ${depthText}<br>
      退款截止时间: ${deadlineDate}${pmtErr ? `(节点 PMT 查询失败: ${pmtErr})` : ` · 节点当前 PMT: ${currentPmtMs != null ? new Date(currentPmtMs).toISOString() : '?'}`}<br>
      <div style="margin-top:0.5rem">
        <button type="button" id="triggerSplitBtn" ${depthOkForSplit ? '' : 'disabled'}>触发分账${depthOkForSplit ? '' : '(需先到账+深确认)'}</button>
        <button type="button" id="triggerRefundBtn" style="margin-left:0.5rem" ${pmtEligibleForRefund ? '' : 'disabled'}>触发退款${pmtEligibleForRefund ? '' : '(未到期)'}</button>
      </div>
      <p style="font-size:0.8rem;color:#666">两个入口零签名(covenant 脚本本身是判据, 触发者不需要买家私钥)——任何人(买家/商家/第三方)都能触发, 这是"资金出口自主"设计的直接体现: 服务全离线时任何人仍能完成分账/超时退款。</p>`);

    document.getElementById('triggerSplitBtn')?.addEventListener('click', () => triggerBroadcast('split', rpc, order, status, connectedUrl, renderMonitorState));
    document.getElementById('triggerRefundBtn')?.addEventListener('click', () => triggerBroadcast('refund', rpc, order, status, connectedUrl, renderMonitorState));
  }

  await renderMonitorState();
  _monitorPollTimer = setInterval(renderMonitorState, 5000);
}

const MASS_LIMITS = { compute: 500_000n, storage: 500_000n, transient: 1_000_000n }; // 同 commission-plan-sdk.mjs estimateOrderMassPrecheck 既有阈值

async function triggerBroadcast(kind, rpc, order, status, connectedUrl, onDone) {
  if (_monitorBusy) return;
  _monitorBusy = true;
  const utxo = status.utxos[0]; // getOrderPaymentStatus 只按地址查, 通常单 UTXO(结账页只生成一笔资助); 多笔只取第一笔——协议约定订单地址应只被资助一次
  try {
    renderBox('monitorInfo', `<b>订单状态监控</b>(连 ${connectedUrl})<br>正在构造${kind === 'split' ? '分账' : '退款'}交易…`);
    const fundingUtxo = { transactionId: utxo.outpoint.transactionId, index: utxo.outpoint.index, amountSompi: utxo.amountSompi };

    let built;
    if (kind === 'split') {
      built = buildCommissionSplitTx(kaspaWasm, order, fundingUtxo);
    } else {
      const currentPmtMs = await getCurrentPmtMs(rpc);
      built = buildCommissionRefundTx(kaspaWasm, order, fundingUtxo, currentPmtMs, 5000);
    }

    renderBox('monitorInfo', `<b>订单状态监控</b>(连 ${connectedUrl})<br>交易已构造, 做三维 mass 预检…`);
    const massResult = estimateMassUpperBound(built.massShape);
    const exceeds = massResult.compute > MASS_LIMITS.compute || massResult.storage > MASS_LIMITS.storage || massResult.transient > MASS_LIMITS.transient;
    if (exceeds) {
      throw new Error(`mass 预检未过: compute=${massResult.compute}(限 ${MASS_LIMITS.compute}) storage=${massResult.storage}(限 ${MASS_LIMITS.storage}) transient=${massResult.transient}(限 ${MASS_LIMITS.transient})——拒绝广播, 不是共识会不会接受的问题, 是本地预检主动挡下`);
    }

    renderBox('monitorInfo', `<b>订单状态监控</b>(连 ${connectedUrl})<br>mass 预检通过(compute=${massResult.compute} storage=${massResult.storage} transient=${massResult.transient}), 广播中…`);
    const result = await rpc.submitTransaction({ transaction: built.tx, allowOrphan: false });
    const txid = result.transactionId;
    renderBox('monitorInfo', `<b>订单状态监控</b>(连 ${connectedUrl})<br><span class="ok">✓ 已广播</span> txid=<code>${txid}</code><br>等待链上核实落地(NO TX NO STATE CHANGE——广播成功不等于落地, mempool 可能丢/被双花竞争淘汰, 轮询确认收款地址资金真的离开)…`);
  } catch (e) {
    renderBox('monitorInfo', `<b>订单状态监控</b>(连 ${connectedUrl})<br><span class="bad">✗ ${kind === 'split' ? '分账' : '退款'}失败: ${e.message}</span>`);
  } finally {
    _monitorBusy = false;
    setTimeout(onDone, 2000); // 广播后短暂延迟再恢复轮询渲染, 给节点一点时间把 tx 收进 mempool/UTXO 集变化能被下一次查询看到
  }
}

/**
 * buildVerifiedChain — 主网真实事故修复(2026-09-28, Bettor 核·账本待补): 从签名链条目或裸渠道
 * 地址构造 verifiedChain, 喂给 resolve-order-browser.js 的 resolveRulesForOrder()。
 * 🔴 这就是事故根源代码本身(不是事后仿写的一份平行逻辑)——原来的 bug: 这里写的字段名是
 * `channelSpksHex`(值也真的 hex 编码过), 但 resolve-order-browser.js/commission-plan-sdk.mjs
 * 两处消费者读的都是 `verifiedChain.channelSpks`(要求原始字节 Uint8Array, 不要 hex)。字段名不对
 * ⇒ `verifiedChain.channelSpks` 恒 undefined ⇒ resolveRulesForOrder() 里 `channelSpks[i]` 恒 falsy
 * ⇒ 所有 channel_N 角色全部静默 fold 给 fold_to 目标(通常是 provider)——页面不报错, 因为这条路径
 * 在结构上就是"没有这个渠道"的正常分支, 不是异常。主网真实实证: txid 24f07ace…(80/10/10 报价,
 * provider 收了全额 1.0 KAS)。
 * 🔴 `channelSpksHex` 这个名字是从 resolver.mjs(旧服务端 HTTP JSON 协议, 那边确实需要 hex 是因为
 * JSON 不能装 Uint8Array, 见该文件 `channelSpksHex`/`hexToBuf` 用法)误抄过来的——浏览器内存对象
 * 之间传数据不经过 JSON 序列化, 根本不需要 hex 编码这一步, 从源头上这个字段就不该存在。
 * 修法: 直接用 verifyChain()/dedupAndCapChannelSpks() 返回的 `channelSpks`(已经是 Uint8Array 数组),
 * 不再转 hex、不再改名。
 * 导出供回归测试直接调用(NWT/Bettor 要求"从 checkout.js 的真实入口, 不是直接调 resolver")——
 * main() 本身也调用这同一个函数, 测试跑的就是生产实际执行的这段代码, 不是重新实现一份影子逻辑。
 * @returns {{ok:boolean, mode:'chain'|'raw', reason?:string, channelSpks?:Uint8Array[], detail:object}}
 *   detail = 原始 verifyChain()/dedupAndCapChannelSpks() 返回值(供调用方渲染用, 字段不变)。
 */
export function buildVerifiedChain(kaspaWasm, blake2b, quote, chainEntries, rawChannelAddrs, network) {
  if (chainEntries.length) {
    const entries = chainEntries.map(e => ({ position: e.position, address_spk: verifyCore.b64urlToBytes(e.address_spk_b64), signing_pubkey: verifyCore.b64urlToBytes(e.signing_pubkey_b64), sig: verifyCore.bytesToHex(verifyCore.b64urlToBytes(e.sig_b64)) }));
    const vc = verifyCore.verifyChain(kaspaWasm, blake2b, quote, entries, network);
    return vc.ok
      ? { ok: true, mode: 'chain', channelSpks: vc.channelSpks, detail: vc }
      : { ok: false, mode: 'chain', reason: vc.reason, detail: vc };
  }
  const dc = verifyCore.dedupAndCapChannelSpks(kaspaWasm, rawChannelAddrs);
  return dc.ok
    ? { ok: true, mode: 'raw', channelSpks: dc.spks, detail: dc }
    : { ok: false, mode: 'raw', reason: dc.reason, detail: dc };
}

// ── D-034 §9(2026-09-28/29, Bettor 派工+裁定): ServiceEscrow 订单展示 + 到期退款 ──────────────
// 架构(跟 Bettor 确认过, 2026-09-29): 不复刻 CommissionSplit 那套"浏览器现场 silverc-wasm 编译推导
// 地址"的路径(工作量大、非最小改动)——服务端(/api/service-escrow/quote)已经算好整份产物, 链接直接
// 带完整数据, 页面不重算。安全性靠 Bettor 裁定的签名机制补: 报价必须经服务方(provider)签名
// (verifyCore.verifyQuoteSignature, 跟 CommissionSplit 复用同一个通用验签函数, 不关心 quote 内部
// 形状), 验签失败不展示任何收款地址——这是防"链接被篡改, 买家把钱付进攻击者地址"的唯一防线, 页面
// 本身不在本地重算地址(如实告知, 不冒充"已核对")。
function seHexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

let _seMonitorPollTimer = null;
let _seMonitorBusy = false;

async function renderServiceEscrowOrder(quote, quoteRef) {
  // Owner 批·三处体验改动(2026-09-29, Bettor Playwright 核主线后发现, 只改展示层, 不动验签/地址/广播逻辑) ──
  // ① 页头标题(服务订单托管跟即时分账是两回事, 别让买家以为走错了页面)。
  document.title = 'KANet 服务订单托管 · 结账页(V1 参考实现)';
  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = 'KANet 服务订单托管 · 结账页(V1 参考实现)';
  // ② 即时分账专属的"退款地址填空+推导订单地址"输入块——服务订单的退款地址已经在报价里烤死(签名
  // 担保), 不需要买家现场填、也没有"推导"这一步, 显示这块只会让人误以为还要操作。
  const refundBox = document.getElementById('refundInputBox');
  if (refundBox) refundBox.style.display = 'none';
  // ③ 归因链接参数(那一大段 base64 原文)默认折叠, 点开才看; 报价表里醒目显示服务方签名公钥
  // (merchant_pubkey_hex)+复制按钮, 旁注核对提示——这是买家唯一能在链接之外独立核实"这确实是
  // 服务方发的"的手段(签名验证只证明"跟这个公钥配对", 不证明"这个公钥就是真正的服务方")。
  renderBox('linkInfo', `<details><summary style="cursor:pointer;color:#666;font-size:0.85rem">归因链接参数(原文, 默认折叠——点击展开)</summary>
    <table style="margin-top:0.5rem"><tr><td>quote 引用</td><td><code style="word-break:break-all">${quoteRef || '(缺失)'}</code></td></tr></table>
  </details>`);

  const quoteOk = verifyCore.verifyQuoteSignature(kaspaWasm, quote);
  const pubkeyHex = quote.merchant_pubkey_hex || '(缺失)';
  renderBox('quoteInfo', `<b>报价</b>(浏览器原生验签, 无网络请求)<table>
    <tr><td>订单类型</td><td>服务订单托管(ServiceEscrow, D-034 §9)</td></tr>
    <tr><td>服务方签名</td><td>${quoteOk ? '<span class="ok">✓ 验证通过</span>' : '<span class="bad">✗ 验证失败——拒绝展示收款地址</span>'}</td></tr>
    <tr><td>签名者公钥</td><td><code id="seMerchantPubkey" style="word-break:break-all">${pubkeyHex}</code>
      <button type="button" id="seCopyPubkeyBtn" style="margin-left:0.4rem">复制</button></td></tr>
  </table>
  <p style="font-size:0.8rem;color:#b36b00;margin-top:0.4rem">⚠ 请与服务方事先公开的公钥核对, 不一致勿付款——签名验证只证明"报价跟这个公钥配对",
    不证明"这个公钥就是你要交易的那个服务方"。</p>`);
  document.getElementById('seCopyPubkeyBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('seCopyPubkeyBtn');
    try { await navigator.clipboard.writeText(pubkeyHex); btn.textContent = '已复制'; setTimeout(() => { btn.textContent = '复制'; }, 1500); }
    catch { btn.textContent = '复制失败(手动选中)'; }
  });
  if (!quoteOk) { renderBox('orderInfo', '<span class="bad">✗ 报价签名验证失败, 出于安全考虑不展示收款地址(可能是链接被篡改)</span>'); return; }

  const se = quote.service_escrow;
  const network = quote.network || 'simnet';
  const totalSompi = BigInt(se.expected_total_sompi);
  const totalKas = sompiToKasString(totalSompi);
  const paymentUri = buildKaspaPaymentUri(se.address, totalSompi);
  const qrSvg = renderQrSvg(paymentUri);

  renderBox('chainInfo', ''); // ServiceEscrow 订单没有多渠道归因/签名链这回事, 清空(避免留着上次渲染的残留)
  renderBox('orderInfo', `<b>订单</b>(服务端预算好, 未在本地重算——地址由上面的服务方签名担保)<table>
    <tr><td>收款(托管)地址</td><td><code>${se.address}</code></td></tr>
    <tr><td>应付总额</td><td><code>${totalKas} KAS</code></td></tr>
    <tr><td>到期 DAA 分数</td><td>${se.deadline_daa}</td></tr>
    <tr><td>到期后服务方份额</td><td>${(10000 - se.timeout_buyer_bps) / 100}%</td></tr>
  </table>
  <div style="margin-top:0.75rem">
    <b>扫码付款</b>(任意 Kaspa 钱包扫描——本页从不持有/传输私钥)<br>
    <div style="max-width:220px;margin:0.5rem 0">${qrSvg}</div>
    <div style="font-size:0.8rem;color:#666">付款链接：<br><code style="word-break:break-all">${paymentUri}</code>
    <button type="button" id="seCopyPaymentUriBtn" style="margin-left:0.4rem">复制</button></div>
  </div>
  <p style="font-size:0.85rem;color:#b36b00;margin-top:0.6rem">⚠ 买家确认(buyer_confirm)/服务方取消(provider_cancel)需要签名, 页面本身不持有任何私钥——
    <b>确认/取消请在 KANet 控制台操作</b>。到期后任何人可触发退款分账(零签名), 见下方"订单状态监控"。</p>`);
  document.getElementById('seCopyPaymentUriBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('seCopyPaymentUriBtn');
    try { await navigator.clipboard.writeText(paymentUri); btn.textContent = '已复制'; setTimeout(() => { btn.textContent = '复制'; }, 1500); }
    catch { btn.textContent = '复制失败(手动选中)'; }
  });

  await startServiceEscrowMonitor(se, totalSompi, network);
}

async function startServiceEscrowMonitor(se, totalSompi, network) {
  if (_seMonitorPollTimer) clearInterval(_seMonitorPollTimer);
  const rpcUrlOverride = new URLSearchParams(location.search).get('rpcUrl') || undefined;
  renderBox('monitorInfo', '<b>订单状态监控</b><br>连接节点中…');
  let rpc, connectedUrl;
  try { ({ rpc, url: connectedUrl } = await connectMonitorRpc(kaspaWasm, { network, rpcUrl: rpcUrlOverride })); }
  catch (e) { renderBox('monitorInfo', `<b>订单状态监控</b><br><span class="bad">✗ 连接节点失败: ${e.message}</span>`); return; }

  let alreadyFunded = false;

  async function renderMonitorState() {
    if (_seMonitorBusy) return;
    let status;
    try { status = await getOrderPaymentStatus(rpc, se.address, totalSompi); }
    catch (e) { renderBox('monitorInfo', `<b>订单状态监控</b>(连 ${connectedUrl})<br><span class="bad">✗ 查询失败: ${e.message}</span>`); return; }

    if (status.state === 'unfunded') {
      if (alreadyFunded) {
        renderBox('monitorInfo', `<b>订单状态监控</b>(连 ${connectedUrl})<br><span class="ok">✓ 订单已完成——托管地址资金已离开(确认/取消/到期退款已被节点接受)</span>`);
        clearInterval(_seMonitorPollTimer);
        return;
      }
      renderBox('monitorInfo', `<b>订单状态监控</b>(连 ${connectedUrl})<br>状态: <span class="warn">未到账</span>——等待买家扫码付款`);
      return;
    }
    alreadyFunded = true;

    const receivedKas = sompiToKasString(status.totalSompi);
    const expectedKas = sompiToKasString(totalSompi);
    const depthText = status.depth == null ? '未知' : `${status.depth}`;
    let stateHtml;
    if (status.state === 'underfunded') stateHtml = `<span class="warn">⚠ 到账不足</span>——已收到 ${receivedKas} KAS, 应付 ${expectedKas} KAS`;
    else if (status.state === 'overfunded') stateHtml = `<span class="warn">⚠ 超额到账</span>——已收到 ${receivedKas} KAS, 应付 ${expectedKas} KAS`;
    else stateHtml = `<span class="ok">✓ 已到账</span>——${receivedKas} KAS`;

    let currentDaaScore = null, daaErr = null;
    try { currentDaaScore = await getCurrentDaaScore(rpc); } catch (e) { daaErr = e.message; }
    const daaEligibleForTimeout = currentDaaScore != null && currentDaaScore >= se.deadline_daa;

    renderBox('monitorInfo', `<b>订单状态监控</b>(连 ${connectedUrl})<br>
      状态: ${stateHtml}<br>确认深度: ${depthText}<br>
      到期 DAA: ${se.deadline_daa}${daaErr ? `(节点 DAA 查询失败: ${daaErr})` : ` · 节点当前 DAA: ${currentDaaScore}`}<br>
      <div style="margin-top:0.5rem">
        <button type="button" id="seTriggerTimeoutBtn" ${daaEligibleForTimeout ? '' : 'disabled'}>触发到期退款分账${daaEligibleForTimeout ? '' : '(未到期)'}</button>
      </div>
      <p style="font-size:0.8rem;color:#666">到期退款零签名(合约本身是判据, 触发者不需要买家/服务方私钥)——任何人都能触发。买家确认/服务方取消需要在 KANet 控制台操作(需要签名)。</p>`);

    document.getElementById('seTriggerTimeoutBtn')?.addEventListener('click', () => triggerServiceEscrowTimeout(rpc, se, status, connectedUrl, renderMonitorState));
  }

  await renderMonitorState();
  _seMonitorPollTimer = setInterval(renderMonitorState, 5000);
}

async function triggerServiceEscrowTimeout(rpc, se, status, connectedUrl, onDone) {
  if (_seMonitorBusy) return;
  _seMonitorBusy = true;
  const utxo = status.utxos[0];
  try {
    renderBox('monitorInfo', `<b>订单状态监控</b>(连 ${connectedUrl})<br>正在构造到期退款分账交易…`);
    const fundingUtxo = { transactionId: utxo.outpoint.transactionId, index: utxo.outpoint.index, amountSompi: utxo.amountSompi };
    const currentDaaScore = await getCurrentDaaScore(rpc);
    const order = {
      redeemScriptHex: se.redeem_script_hex,
      entries: se.entries,
      deadlineDaa: se.deadline_daa,
      timeoutBuyerBps: se.timeout_buyer_bps,
      maxRefundFeeSompi: BigInt(se.max_refund_fee_sompi),
      providerPayoutSpk: seHexToBytes(se.provider_payout_spk_hex),
      buyerRefundSpk: seHexToBytes(se.buyer_refund_spk_hex),
    };
    const built = buildServiceEscrowTimeoutDefaultTx(kaspaWasm, order, fundingUtxo, currentDaaScore);

    renderBox('monitorInfo', `<b>订单状态监控</b>(连 ${connectedUrl})<br>交易已构造, 做三维 mass 预检…`);
    const massResult = estimateMassUpperBound(built.massShape);
    const exceeds = massResult.compute > MASS_LIMITS.compute || massResult.storage > MASS_LIMITS.storage || massResult.transient > MASS_LIMITS.transient;
    if (exceeds) throw new Error(`mass 预检未过: compute=${massResult.compute} storage=${massResult.storage} transient=${massResult.transient}——拒绝广播`);

    renderBox('monitorInfo', `<b>订单状态监控</b>(连 ${connectedUrl})<br>mass 预检通过, 广播中…`);
    const result = await rpc.submitTransaction({ transaction: built.tx, allowOrphan: false });
    renderBox('monitorInfo', `<b>订单状态监控</b>(连 ${connectedUrl})<br><span class="ok">✓ 已广播</span> txid=<code>${result.transactionId}</code><br>等待链上核实落地(NO TX NO STATE CHANGE)…`);
  } catch (e) {
    renderBox('monitorInfo', `<b>订单状态监控</b>(连 ${connectedUrl})<br><span class="bad">✗ 到期退款失败: ${e.message}</span>`);
  } finally {
    _seMonitorBusy = false;
    setTimeout(onDone, 2000);
  }
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

  // D-034 §9(2026-09-28/29, Bettor 派工+裁定): ServiceEscrow 订单跟 CommissionSplit 完全是两回事
  // (买家/服务方身份建单时已经定死, 不需要渠道归因/签名链/退款地址填空这一整套)——单独一条分支, 早
  // return, 不跟下面的 CommissionSplit 专属流程混在一起。
  if (quote.order_kind === 'service_escrow') {
    await renderServiceEscrowOrder(quote, quoteRef);
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
  const vr = buildVerifiedChain(kaspaWasm, blake2b, quote, chainEntries, rawChannelAddrs, network);
  if (vr.mode === 'chain') {
    const vc = vr.detail;
    renderBox('chainInfo', `<b>签名链</b>(浏览器原生验证)<table>
      <tr><td>验证结果</td><td>${vc.ok ? '<span class="ok">✓ 通过</span>' : `<span class="bad">✗ ${vc.reason}</span>`}</td></tr>
      <tr><td>已验证渠道数</td><td>${vc.channelSpks ? vc.channelSpks.length : 0}</td></tr>
    </table><p style="font-size:0.8rem;color:#666">§3.4.4: 一条真实链的前缀本身就是合法链(截断是允许的归因政策, 不是攻击)——如果这里显示的渠道数少于你预期, 可能是正常的截断, 也可能是恶意截断; 唯一能在付款前分辨的手段是核对渠道自己预先公开的地址声明(§3.3), 本参考实现不代为判断, 只如实展示验证结果。</p>`);
  } else {
    const dc = vr.detail;
    renderBox('chainInfo', `<b>渠道地址(无签名链背书, 浏览器原生解析)</b><table>
      <tr><td>解析结果</td><td>${dc.ok ? '<span class="warn">⚠ 已解析, 但无签名链背书</span>' : `<span class="bad">✗ ${dc.reason}</span>`}</td></tr>
    </table>`);
  }
  if (!vr.ok) return;
  const verifiedChain = { ok: true, channelSpks: vr.channelSpks };

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
      const totalSompi = resolved.payoutLeaves.reduce((acc, r) => acc + r.amountSompi, 0n);
      const totalKas = sompiToKasString(totalSompi);
      const paymentUri = buildKaspaPaymentUri(order.address, totalSompi);
      const qrSvg = renderQrSvg(paymentUri);
      const compilerFailureNotice = usedWasmCompiler ? '' : compilerFailureAlternativesHtml((silvercWasmLoadError || silSourceLoadError)?.message || '未知原因');
      renderBox('orderInfo', `<b>订单</b>(浏览器原生推导${usedWasmCompiler ? '·真 silverc 编译器' : '·固定偏移覆写降级路径'}, 零网络请求)<table>
        <tr><td>收款地址</td><td><code>${order.address}</code></td></tr>
        <tr><td>应付总额</td><td><code>${totalKas} KAS</code></td></tr>
        <tr><td>截止时间</td><td>${new Date(order.deadlineMs).toISOString()}</td></tr>
      </table><table><tr><th>角色</th><th>金额</th></tr>${rolesHtml}</table>
      <div style="margin-top:0.75rem">
        <b>扫码付款</b>(任意 Kaspa 钱包扫描——本页从不持有/传输私钥, 只编码下面这个公开地址+金额)<br>
        <div style="max-width:220px;margin:0.5rem 0">${qrSvg}</div>
        <div style="font-size:0.8rem;color:#666">付款链接(不支持扫码的钱包可手动复制)：<br><code style="word-break:break-all">${paymentUri}</code>
        <button type="button" id="copyPaymentUriBtn" style="margin-left:0.4rem">复制</button></div>
      </div>
      ${compilerFailureNotice}`);
      document.getElementById('copyPaymentUriBtn')?.addEventListener('click', async () => {
        const btn = document.getElementById('copyPaymentUriBtn');
        try { await navigator.clipboard.writeText(paymentUri); btn.textContent = '已复制'; setTimeout(() => { btn.textContent = '复制'; }, 1500); }
        catch { btn.textContent = '复制失败(手动选中)'; }
      });

      // D-034 §8 B段⑥: 订单状态监控+触发分账/退款只在真 silverc 编译器主路径可用——order.entries/
      // redeemScriptHex 等字段只有真编译才有(见 resolve-order-wasm.js 扩展), 降级路径(order-template.js
      // 固定偏移覆写)没有这些字段, 不冒充能触发, 如实告知原因。
      if (usedWasmCompiler) {
        startOrderMonitor(order, totalSompi, network).catch(e => {
          renderBox('monitorInfo', `<b>订单状态监控</b><br><span class="bad">✗ 启动监控失败: ${e.message}</span>`);
        });
      } else {
        renderBox('monitorInfo', `<b>订单状态监控</b><br><span class="warn">⚠ 此订单用固定偏移覆写降级路径推导——触发分账/退款需要真 silverc 编译器(降级路径没有 entries ABI), 这次不可用。详情与替代方式见上方订单信息里的说明。</span>`);
      }
    } catch (e) {
      renderBox('orderInfo', `<span class="bad">✗ 订单地址推导失败(${e.message})</span>`);
    }
  });
}

main().catch(e => renderBox('orderInfo', `<span class="bad">✗ ${e.message}</span>`));
