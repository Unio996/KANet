#!/usr/bin/env node
// 结账页发布包打包脚本 — D-034 §8 ④, Bettor 反馈②③(2026-09-27): 包内每个文件必须与某个具体仓库
// commit 逐字节一致(不是本地临时编辑的副本), zip 内路径必须用正斜杠(Windows Compress-Archive 的
// 已知老问题: 用反斜杠, 跨平台 unzip 可能整个解成一个带反斜杠的怪文件名)。
//
// 跑法: node scripts/build-checkout-release.mjs <commit-ish>
// 例:   node scripts/build-checkout-release.mjs origin/bshard-m3-deploy
//       node scripts/build-checkout-release.mjs 467d143754a6
//
// 运行时文件(checkout.html 真正会加载到的东西)全部用 `git show <commit>:<path>` 原样取——不是复制
// 本地工作树、不是手改。两个 wasm vendor 产物(gitignored, 不进 git 历史)从本机已核过 sha256 的构建
// 产物目录取(路径可用下面两个环境变量覆盖, 默认值是本仓惯用的本机构建产物位置), 打包时重新核一遍
// sha256 对上该 commit 里 scripts/*-pin.json 记的锚点, 不匹配直接报错退出(fail-closed, 不生成一份
// 指纹对不上的包)。
//   KASPA_WASM_WEB_DIR   默认 D:/rusty-kaspa/wasm/web/kaspa
//   SILVERC_WASM_DIR     默认 D:/kanet-tn12/scratch/_j2_commission_impl_research/silverc-wasm-out
//
// 输出: kasia-console/scratch/_release_build_tmp/(解压后的目录, 便于人工核对/独立测试)
//       kasia-console/scratch/kanet-checkout-static-v1.zip
//       kasia-console/scratch/kanet-checkout-static-v1.manifest.json
//
// 维护提醒: RUNTIME_FILES 是 checkout.html 真正会加载到的文件集的静态清单(依赖图核对方法见下方
// 注释)。checkout-static/ 下新增运行时依赖(新 import / 新 fetch() 的资源)时必须同步加进这个清单,
// 否则新文件不会进发布包——这是本脚本唯一需要手工维护的部分, 没有做成自动依赖图扫描(过度工程,
// checkout.js 的 import 图很浅, 手工核对成本很低, 见 kasia-console/scratch 里已经做过的核对记录)。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const commitIsh = process.argv[2];
if (!commitIsh) { console.error('用法: node scripts/build-checkout-release.mjs <commit-ish>'); process.exit(1); }
const commit = execFileSync('git', ['rev-parse', commitIsh], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
console.log(`[build] 打包 commit ${commit}`);

function showFile(pathInRepo) {
  return execFileSync('git', ['show', `${commit}:${pathInRepo}`], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 });
}
function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }

const CS = 'kasia-console/src/lib/checkout-static';
// 运行时真正会被 checkout.html 加载到的文件集(依赖图核对方法: checkout.html 只 script 引 checkout.js;
// checkout.js 静态 import verify-core/resolve-order-browser/resolve-order-wasm/vendor/fee-split-browser
// /vendor/qrcode-generator/qrcode.mjs(⑤)/monitor.js(⑥)/broadcast-commission.js(⑥)/
// vendor/tx-mass-ub-browser.mjs(⑥)/broadcast-service-escrow.js(D-034 §9, 2026-09-29 补录——checkout.js
// 已 import 但清单当时漏加, KANet-UI 打 v0.2.2-test 包时发现); resolve-order-browser import
// order-template; fee-split-browser import noble-hashes/blake2b 一条链; broadcast-commission.js 与
// broadcast-service-escrow.js 都 import vendor/generic-entry-witness-browser.mjs(⑥, 已在清单里,
// 两处共用不用重复列); checkout.js fetch 取 vendor/sil-source/CommissionSplit.sil)。
// 见本文件头注"维护提醒"。
// 🔴 不含 vendor/*-parity.mjs(generic-entry-witness-browser-parity.mjs / tx-mass-ub-browser-parity.mjs)
// ——同 wasm-pin-check.mjs/fee-split-browser-parity.mjs 既有排除理由: 纯 Node 侧开发期自检脚本, 裸
// import kaspa-wasm + 相对路径指回仓库内 kasia-relay/kasia-console/scripts, 离开仓库目录结构就是
// 死代码, 买家打开页面用不到。
const RUNTIME_FILES = [
  'checkout.html', 'checkout.js', 'verify-core.js', 'resolve-order-browser.js',
  'resolve-order-wasm.js', 'order-template.js', 'monitor.js', 'broadcast-commission.js',
  'broadcast-service-escrow.js',
  'vendor/fee-split-browser.mjs',
  'vendor/generic-entry-witness-browser.mjs',
  'vendor/tx-mass-ub-browser.mjs',
  'vendor/qrcode-generator/qrcode.mjs', 'vendor/qrcode-generator/LICENSE',
  'vendor/noble-hashes/LICENSE', 'vendor/noble-hashes/blake2b.js', 'vendor/noble-hashes/blake2-internal.js',
  'vendor/noble-hashes/assert-internal.js', 'vendor/noble-hashes/crypto.js', 'vendor/noble-hashes/u64-internal.js',
  'vendor/noble-hashes/utils.js',
  'vendor/sil-source/ChannelDeposit.sil', 'vendor/sil-source/CommissionSplit.sil',
  'vendor/kaspa-web/README.md', 'vendor/silverc-wasm/README.md',
];

const kaspaPin = JSON.parse(showFile('scripts/kaspa-wasm-web-pin.json').toString('utf8'));
const silvercPin = JSON.parse(showFile('scripts/silverc-wasm-pin.json').toString('utf8'));

const KASPA_WASM_WEB_DIR = process.env.KASPA_WASM_WEB_DIR || 'D:/rusty-kaspa/wasm/web/kaspa';
const SILVERC_WASM_DIR = process.env.SILVERC_WASM_DIR || 'D:/kanet-tn12/scratch/_j2_commission_impl_research/silverc-wasm-out';
const WASM_SOURCES = {
  'vendor/kaspa-web/kaspa.js': `${KASPA_WASM_WEB_DIR}/kaspa.js`,
  'vendor/kaspa-web/kaspa_bg.wasm': `${KASPA_WASM_WEB_DIR}/kaspa_bg.wasm`,
  'vendor/kaspa-web/kaspa.d.ts': `${KASPA_WASM_WEB_DIR}/kaspa.d.ts`,
  'vendor/kaspa-web/LICENSE': `${KASPA_WASM_WEB_DIR}/LICENSE`,
  'vendor/silverc-wasm/silverc_lang.js': `${SILVERC_WASM_DIR}/silverc_lang.js`,
  'vendor/silverc-wasm/silverc_lang_bg.wasm': `${SILVERC_WASM_DIR}/silverc_lang_bg.wasm`,
  'vendor/silverc-wasm/silverc_lang.d.ts': `${SILVERC_WASM_DIR}/silverc_lang.d.ts`,
  'vendor/silverc-wasm/silverc_lang_bg.wasm.d.ts': `${SILVERC_WASM_DIR}/silverc_lang_bg.wasm.d.ts`,
};

const OUT_DIR = join(REPO_ROOT, 'kasia-console/scratch/_release_build_tmp');
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(join(OUT_DIR, 'checkout-static'), { recursive: true });

/** @type {{path:string, buf:Buffer}[]} */
const files = [];

for (const rel of RUNTIME_FILES) {
  const buf = showFile(`${CS}/${rel}`);
  files.push({ path: `checkout-static/${rel}`, buf });
}
for (const [rel, srcPath] of Object.entries(WASM_SOURCES)) {
  const buf = readFileSync(srcPath);
  files.push({ path: `checkout-static/${rel}`, buf });
}

const kaspaWasm = files.find(f => f.path === 'checkout-static/vendor/kaspa-web/kaspa_bg.wasm');
const silvercWasm = files.find(f => f.path === 'checkout-static/vendor/silverc-wasm/silverc_lang_bg.wasm');
const kaspaActual = sha256(kaspaWasm.buf);
const silvercActual = sha256(silvercWasm.buf);
if (kaspaActual !== kaspaPin.sha256) { console.error(`[build] ✗ kaspa_bg.wasm sha256 不符 pin: 期望 ${kaspaPin.sha256}, 实际 ${kaspaActual}`); process.exit(1); }
if (silvercActual !== silvercPin.sha256) { console.error(`[build] ✗ silverc_lang_bg.wasm sha256 不符 pin: 期望 ${silvercPin.sha256}, 实际 ${silvercActual}`); process.exit(1); }
console.log(`[build] ✓ 两份 wasm sha256 均与该 commit 的 pin 文件一致`);

// D-034 §8 v0.2.0-test 收尾(Bettor 2026-09-27 指出的可复现性缺口): kaspa.js/kaspa.d.ts/LICENSE +
// silverc_lang.js/silverc_lang.d.ts/silverc_lang_bg.wasm.d.ts 这几个非 wasm 绑定文件之前没有单独
// 锚定——现在也 fail-closed 逐个核对, 不匹配拒绝生成发布包(不是警告)。
const BINDING_FILE_PIN_SOURCES = [
  { pin: kaspaPin, prefix: 'checkout-static/vendor/kaspa-web/' },
  { pin: silvercPin, prefix: 'checkout-static/vendor/silverc-wasm/' },
];
let bindingMismatch = false;
for (const { pin, prefix } of BINDING_FILE_PIN_SOURCES) {
  const bindingFiles = pin.bindingFiles?.files || {};
  for (const [name, spec] of Object.entries(bindingFiles)) {
    const f = files.find(x => x.path === `${prefix}${name}`);
    if (!f) { console.error(`[build] ✗ 绑定文件 ${prefix}${name} 在待打包文件列表里找不到`); bindingMismatch = true; continue; }
    const actual = sha256(f.buf);
    if (actual !== spec.sha256) {
      console.error(`[build] ✗ ${prefix}${name} sha256 不符 pin: 期望 ${spec.sha256}, 实际 ${actual}`);
      bindingMismatch = true;
    }
  }
}
if (bindingMismatch) { console.error('[build] ✗ 绑定文件指纹核对未通过, 拒绝生成发布包'); process.exit(1); }
console.log(`[build] ✓ 全部绑定文件(kaspa.js/kaspa.d.ts/LICENSE/silverc_lang.js/silverc_lang.d.ts/silverc_lang_bg.wasm.d.ts) sha256 均与该 commit 的 pin 文件一致`);

const bindingFileRows = BINDING_FILE_PIN_SOURCES.flatMap(({ pin, prefix }) =>
  Object.entries(pin.bindingFiles?.files || {}).map(([name, spec]) => `| \`${prefix}${name}\` | \`${spec.sha256}\` |`)
).join('\n');

const README = `# KANet 结账页（checkout-static）发布包

纯静态、无服务器依赖的浏览器结账页：买家打开一个带签名报价的链接，页面在浏览器本地用真实
kaspa-wasm + silverc-wasm 验签、推导订单地址、生成收款地址+扫码二维码，到账后可直连节点监视状态并
触发分账/退款——不需要任何后端进程。

**本包所有仓库内文件均取自 commit \`${commit}\`，用 \`git show <commit>:<path>\` 原样提取，与该 commit
逐字节一致——不是手工编辑的临时副本。**

## 这个包里有什么

\`\`\`
checkout-static/
├── checkout.html              买家打开的页面
├── checkout.js                页面胶水层（解析链接/展示进度/驱动收款+监视+触发流程）
├── verify-core.js             验签/验证链逻辑
├── resolve-order-browser.js   订单地址推导（角色解析）
├── resolve-order-wasm.js      订单地址推导主路径（真 silverc 编译器）
├── order-template.js          订单地址推导备选路径（固定偏移覆写，silverc-wasm 加载失败时自动降级）
├── monitor.js                 订单地址到账状态/确认深度/节点 PMT 只读监视（浏览器直连节点 wss）
├── broadcast-commission.js    触发分账/退款交易组装（零签名，covenant 脚本本身是判据）
└── vendor/
    ├── kaspa-web/              浏览器版 kaspa-wasm（sha256 见下）
    ├── silverc-wasm/           浏览器版 silverc 编译器（sha256 见下）
    ├── noble-hashes/           vendored blake2b（浏览器原生 ESM 需要，MIT 协议，见目录内 LICENSE）
    ├── qrcode-generator/       扫码付款二维码编码器（MIT，Kazuhiko Arase，未改动上游代码）
    ├── generic-entry-witness-browser.mjs  covenant 签名 witness ABI 编码器（触发分账/退款用）
    ├── tx-mass-ub-browser.mjs  广播前三维 mass 预检
    ├── sil-source/             .sil 合约源码（订单地址推导需要读源码文本）
    └── fee-split-browser.mjs   分成计算逻辑（与仓库内 fee-split.mjs 逐字节同步）
\`\`\`

**不在这个包里**（如实说明为什么）：
- \`config.html\`/\`config.js\`（商家生成签名报价链接的工具）和 \`resolver.mjs\`（商家侧签名服务）——
  这两者是**商家侧**工具，仍需要一个本机 Node 进程（\`resolver.mjs\` 监听 \`127.0.0.1\`，只在本机内网
  可达，私钥仅内存中用一次不落盘）来对商家私钥签名，跟这个包"买家侧纯静态、零后端"的定位不同。
  商家如需生成报价链接，用仓库内 \`kasia-console/src/lib/checkout-static/config.html\` + 起
  \`resolver.mjs\` 的既有流程。（⑩：商家侧改成浏览器内 kaspa-wasm 本地签名后会并入下一版发布包。）
- \`wasm-pin-check.mjs\`、\`fee-split-browser-parity.mjs\`、
  \`vendor/generic-entry-witness-browser-parity.mjs\`、\`vendor/tx-mass-ub-browser-parity.mjs\`——
  仓库内部的开发期自检脚本，买家打开页面时用不到（离开仓库目录结构就是死代码：裸 import
  \`kaspa-wasm\` + 相对路径指回仓库内其他模块）。

## 编译器加载失败时怎么办

silverc-wasm 加载失败（网络/浏览器兼容性问题）时，页面会自动降级到固定偏移覆写路径继续完成订单
地址推导（该路径独立验证过），并展示清楚的失败原因 + 三条替代方式（换浏览器重试 / 自行托管这份
发布包 / 自行运行 \`resolver.mjs\`）——降级路径下触发分账/退款功能不可用（需要真编译器才有
covenant entry ABI）。

## 产物指纹（部署前校验，\`checkout.js\` 运行时也会自己核对一次 sha256）

| 文件 | sha256 |
|---|---|
| \`vendor/kaspa-web/kaspa_bg.wasm\` | \`${kaspaActual}\` |
| \`vendor/silverc-wasm/silverc_lang_bg.wasm\` | \`${silvercActual}\` |
${bindingFileRows}

来源、构建命令、goldenSample 同源判据见各自 \`vendor/*/README.md\`。以上全部指纹(含绑定文件)锚定在
仓库内 \`scripts/kaspa-wasm-web-pin.json\`/\`scripts/silverc-wasm-pin.json\`，本发布包由打包脚本
fail-closed 逐个核对过，不匹配不会生成包。

## 部署要求（真实实测，非估算）

1. **\`Content-Type: application/wasm\`** — 现用代码路径（\`fetch()\` + \`WebAssembly.compile(bytes)\`，
   非 \`instantiateStreaming\`）对这个头不敏感，但仍建议显式配置对，为将来切换到流式编译留余地。
2. **启用 br（Brotli）压缩，视为硬性部署要求，不是可选优化** — 两个 wasm 文件未压缩合计约 16.7MB，
   br 压缩后约 5.07MB。真实 Slow-3G(400kbps)+4x CPU 限速下实测两种流程总耗时：**br 关 347.2 秒
   （5.8 分钟）vs br 开 117.7 秒（2.0 分钟），加速比 2.9x**。不开 br 不是页面代码 bug，是这两份
   wasm 产物大小决定的物理下限，但会让弱网用户等待接近 6 分钟。
3. **长效不可变缓存**（\`Cache-Control: public, max-age=31536000, immutable\`）— 两个 wasm 文件用内容
   sha256 锚定，文件不变则可以放心长期缓存；升级版本必须同时改 pin 常量 + 发新文件（不能只换文件
   不改 pin，会被运行时校验拒绝，这是设计如此，不是需要绕过的限制）。
4. **CSP（若宿主环境设置了严格 Content-Security-Policy）**：\`script-src\` 需要带
   \`'wasm-unsafe-eval'\`（Chrome 90+/Firefox 79+）以允许 \`WebAssembly.compile\`/\`instantiate\`。
5. **必须走 \`http(s)://\` 托管**，不支持 \`file://\` 直接双击打开。
6. **下载进度反馈已内置**（本发布包版本）：\`checkout.js\` 会实时显示"下载中… X.X / Y.Y MB (NN%)"，
   压缩传输下（Content-Length 反映压缩前字节、与解压后收到字节不可比）自动降级为"已收到 X.X MB"
   文案，不会出现进度超 100% 的情况。

## 浏览器直连公共节点（可选，用于查询链上数据；广播交易仍走 \`submitTransaction\` 走 RPC）

真实测试确认可用、无 CORS 问题、按直连延迟排序：

| 端点 | 直连耗时 | \`getServerInfo\` 耗时 | 版本 |
|---|---|---|---|
| \`wss://sara.kaspa.red/kaspa/mainnet/wrpc/borsh\` | 405ms | 189ms | 2.1.0 |
| \`wss://nina.kaspa.blue/kaspa/mainnet/wrpc/borsh\` | 400ms | 185ms | 2.1.0 |
| \`wss://eva.kaspa.green/kaspa/mainnet/wrpc/borsh\` | 459ms | 218ms | 2.0.1 |
| \`wss://vivi.kaspa.blue/kaspa/mainnet/wrpc/borsh\` | 532ms | 249ms | 2.1.0 |
| \`wss://isla.kaspa.red/kaspa/mainnet/wrpc/borsh\` | 609ms | 294ms | 2.1.0 |

确认不可用（CORS 拦截）：\`noah.kaspa.blue\`、\`sean.kaspa.stream\`、\`adam.kaspa.green\`。

**⚠️ 已知信号，部署前请知悉**：上表 5 个端点的域名命名模式（\`<人名>.kaspa.<red/blue/green/stream>\`）
提示它们可能来自同一个或一小撮协同的运营方，而不是 5 个互相独立的信任源——如果这个运营方的基础
设施出问题，5 个候选可能同时失效。**建议**：① 把这份清单当加速用的默认候选池，不要当"5 个独立
故障域"意义上的冗余；② 保留 \`Resolver\` 自动发现作为兜底（这份清单里的端点连不上时才用），不要
因为直连快就完全弃用自动发现；③ 这份清单需要定期人工复核，公开节点的可用性/版本/CORS 配置会变
（\`eva.kaspa.green\` 当前版本 2.0.1 比其他几个的 2.1.0 略旧）。

## 如实标注的覆盖缺口

- 真 Safari(macOS/iOS)、真 Android/iOS 设备、Telegram/WhatsApp/微信内置浏览器：本轮开发环境是
  Windows 桌面机，没有这些设备/App，未测试，需要有对应设备的人补测。
- 严格 CSP 环境下的实际行为：未起过带 CSP header 的测试服务器验证。
- ⑧d 的耗时数字是单次真实运行，非多轮统计中位数。
- ⑨ 只采样验证了 5 个可用端点，公开节点池可能还有更多未穷举。
`;
files.unshift({ path: 'README.md', buf: Buffer.from(README, 'utf8') });

// ── 写解压后的目录(便于人工核对/独立测试), 再写 zip ──
for (const f of files) {
  const full = join(OUT_DIR, f.path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, f.buf);
}

// ── 最小可用 ZIP writer(STORE/DEFLATE, 强制正斜杠 entry name, 不依赖 Compress-Archive——后者在
//    Windows 上有条目名带反斜杠的已知老问题, 跨平台 unzip 可能整个解成一个带反斜杠的怪文件名)。
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xFF;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function dosDateTime(d = new Date()) {
  const time = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() >> 1) & 0x1F);
  const date = (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0xF) << 5) | (d.getDate() & 0x1F);
  return { time, date };
}
function buildZip(entries) {
  const { time, date } = dosDateTime();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const { path: entryPath, buf } of entries) {
    const nameBuf = Buffer.from(entryPath.replace(/\\/g, '/'), 'utf8'); // 强制正斜杠
    const deflated = deflateRawSync(buf, { level: 9 });
    const useDeflate = deflated.length < buf.length;
    const method = useDeflate ? 8 : 0;
    const dataBuf = useDeflate ? deflated : buf;
    const crc = crc32(buf);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0, 6);            // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(buf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, dataBuf);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);         // version made by
    central.writeUInt16LE(20, 6);         // version needed
    central.writeUInt16LE(0, 8);          // flags
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(dataBuf.length, 20);
    central.writeUInt32LE(buf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);         // extra len
    central.writeUInt16LE(0, 32);         // comment len
    central.writeUInt16LE(0, 34);         // disk number
    central.writeUInt16LE(0, 36);         // internal attrs
    central.writeUInt32LE(0o644 << 16, 38); // external attrs (unix perms)
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + dataBuf.length;
  }
  const centralStart = offset;
  let centralSize = 0;
  for (const p of centralParts) centralSize += p.length;

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

const zipBuf = buildZip(files);
const zipPath = join(REPO_ROOT, 'kasia-console/scratch/kanet-checkout-static-v1.zip');
writeFileSync(zipPath, zipBuf);
const zipSha256 = sha256(zipBuf);

console.log(`[build] 写出 ${files.length} 个文件到 ${OUT_DIR}`);
console.log(`[build] zip: ${zipPath} (${zipBuf.length} bytes)`);
console.log(`[build] zip sha256: ${zipSha256}`);
console.log(`[build] commit: ${commit}`);

// manifest
const manifest = files.map(f => ({ path: f.path, bytes: f.buf.length, sha256: sha256(f.buf) }));
writeFileSync(join(REPO_ROOT, 'kasia-console/scratch/kanet-checkout-static-v1.manifest.json'),
  JSON.stringify({ commit, zipSha256, zipBytes: zipBuf.length, files: manifest }, null, 2));
console.log(`[build] manifest: kasia-console/scratch/kanet-checkout-static-v1.manifest.json`);
