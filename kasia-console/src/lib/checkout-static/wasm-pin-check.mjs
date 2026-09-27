// wasm-pin-check.mjs — 浏览器版 kaspa-wasm 构建产物的启动期锁版本校验(D-034 §8 后续票②，同 D-019
// silverc pin 的做法: 记录上游 commit/构建命令/产物 sha256，权威记录见 scripts/kaspa-wasm-web-pin.json，
// 本文件只读它，不重复定义)。resolver.mjs 启动时调用一次；checkout.js 也做同等校验(browser-side，见
// checkout.js 里对 crypto.subtle.digest 的调用)，两处独立核，不是只核一边就信另一边也对。

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const PIN_PATH = new URL('../../../../scripts/kaspa-wasm-web-pin.json', import.meta.url);

export function loadPin() {
  return JSON.parse(readFileSync(PIN_PATH, 'utf8'));
}

/** assertWasmPinned — 对本机实际部署的 vendor/kaspa-web/kaspa_bg.wasm 文件做 sha256 核对。
 * 不符即拒绝启动(fail-loud，不是警告)——同 assertSilvercV100Pinned 的纪律：宁可拒绝启动，不猜哪个对。
 * @param {string} wasmPath 实际部署的 kaspa_bg.wasm 路径
 */
export function assertWasmPinned(wasmPath) {
  const pin = loadPin();
  const bytes = readFileSync(wasmPath);
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  const expected = process.env.KASPA_WASM_WEB_SHA256 || pin.sha256;
  if (actualSha256 !== expected) {
    throw new Error(`kaspa_bg.wasm sha256 不符 pin 锚点(scripts/kaspa-wasm-web-pin.json): 期望 ${expected}, 实际 ${actualSha256}(路径 ${wasmPath}) — 拒绝启动, 不猜哪个对(可用 KASPA_WASM_WEB_SHA256 env 覆盖, 供非确定性重新构建产出不同 sha 时使用)`);
  }
  console.log(`[kaspa-wasm-web-pin] ✓ sha256 核对通过 (${actualSha256.slice(0, 16)}…)`);
  return { pin, actualSha256 };
}
