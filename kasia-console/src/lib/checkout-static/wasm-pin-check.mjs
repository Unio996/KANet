// wasm-pin-check.mjs — 浏览器版 kaspa-wasm 构建产物的启动期锁版本校验(D-034 §8 后续票②，同 D-019
// silverc pin 的做法: 记录上游 commit/构建命令/产物 sha256，权威记录见 scripts/kaspa-wasm-web-pin.json，
// 本文件只读它，不重复定义)。resolver.mjs 启动时调用一次；checkout.js 也做同等校验(browser-side，见
// checkout.js 里对 crypto.subtle.digest 的调用)，两处独立核，不是只核一边就信另一边也对。

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const KASPA_PIN_PATH = new URL('../../../../scripts/kaspa-wasm-web-pin.json', import.meta.url);
const SILVERC_PIN_PATH = new URL('../../../../scripts/silverc-wasm-pin.json', import.meta.url);

export function loadPin(pinPath = KASPA_PIN_PATH) {
  return JSON.parse(readFileSync(pinPath, 'utf8'));
}

/** assertWasmPinned — 对本机实际部署的 wasm 构建产物文件做 sha256 核对(通用, kaspa-web 与
 * silverc-wasm 两份 pin 共用同一套逻辑, 不重复写)。不符即拒绝启动(fail-loud，不是警告)——
 * 同 assertSilvercV100Pinned 的纪律：宁可拒绝启动，不猜哪个对。
 * @param {string} wasmPath 实际部署的 .wasm 路径
 * @param {URL} [pinPath] 默认 kaspa-wasm-web-pin.json；传 SILVERC_PIN_PATH 核 silverc-wasm
 * @param {string} [envOverrideName] 环境变量覆盖名(kaspa 用 KASPA_WASM_WEB_SHA256，silverc 用 SILVERC_WASM_SHA256)
 */
export function assertWasmPinned(wasmPath, pinPath = KASPA_PIN_PATH, envOverrideName = 'KASPA_WASM_WEB_SHA256') {
  const pin = loadPin(pinPath);
  const bytes = readFileSync(wasmPath);
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  const expected = process.env[envOverrideName] || pin.sha256;
  if (actualSha256 !== expected) {
    throw new Error(`${wasmPath} sha256 不符 pin 锚点(${pinPath}): 期望 ${expected}, 实际 ${actualSha256} — 拒绝启动, 不猜哪个对(可用 ${envOverrideName} env 覆盖, 供非确定性重新构建产出不同 sha 时使用)`);
  }
  console.log(`[wasm-pin] ✓ sha256 核对通过 (${wasmPath} · ${actualSha256.slice(0, 16)}…)`);
  return { pin, actualSha256 };
}

export function assertSilvercWasmPinned(wasmPath) {
  return assertWasmPinned(wasmPath, SILVERC_PIN_PATH, 'SILVERC_WASM_SHA256');
}
