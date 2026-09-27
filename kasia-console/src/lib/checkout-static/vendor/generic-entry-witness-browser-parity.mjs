// generic-entry-witness-browser-parity.mjs — 守 vendor/generic-entry-witness-browser.mjs 头注声明的
// "逻辑与字节序完全不变"这句话不落空(同 fee-split-browser-parity.mjs 的既有纪律: 头注引用这份证据,
// 这份证据必须真的存在且真的跑过, 不是写了注释就算数)。
//
// 两边都用真实 kaspa-wasm(Node 版 ScriptBuilder, 与浏览器版是同一份 wasm-bindgen 产物只是 target 不同,
// ScriptBuilder.addData 接受 HexString|Uint8Array 两者通用) 对同一批随机向量跑, 逐字节比对
// encodeEntryActionGeneric 与 combineActionAndRedeem 两个函数的输出。
import { encodeEntryActionGeneric as encodeNode, combineActionAndRedeem as combineNode } from '../../../../scripts/audit/generic-entry-witness.mjs';
import { encodeEntryActionGeneric as encodeBrowser, combineActionAndRedeem as combineBrowser } from './generic-entry-witness-browser.mjs';
import * as kaspa from 'kaspa-wasm';

function randBytes(n) { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256); return b; }
function toHex(b) { return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join(''); }
function randInt() { return BigInt(Math.floor(Math.random() * 2 ** 31) - 2 ** 30); }

let total = 0, mismatches = 0;

function runCase(entryAbi, argsByName, label) {
  total++;
  let actionNode, actionBrowser, errNode = null, errBrowser = null;
  try { actionNode = encodeNode(kaspa, entryAbi, argsByName); } catch (e) { errNode = e.message; }
  try { actionBrowser = encodeBrowser(kaspa, entryAbi, argsByName); } catch (e) { errBrowser = e.message; }

  if (errNode || errBrowser) {
    if (errNode !== errBrowser) { console.error(`MISMATCH(error) [${label}]: node="${errNode}" browser="${errBrowser}"`); mismatches++; }
    return;
  }
  if (actionNode !== actionBrowser) {
    console.error(`MISMATCH(action) [${label}]: node=${actionNode} browser=${actionBrowser}`);
    mismatches++;
    return;
  }
  // combineActionAndRedeem 两边也对比一遍(用随机 redeem 字节, 不需要真实合约脚本——只测字节拼接逻辑)
  const redeem = randBytes(20 + Math.floor(Math.random() * 40));
  const redeemNode = Buffer.from(redeem);
  let combinedNodeHex, combinedBrowserHex, cErrNode = null, cErrBrowser = null;
  try { combinedNodeHex = combineNode(kaspa, actionNode, redeemNode).toString('hex'); } catch (e) { cErrNode = e.message; }
  try { combinedBrowserHex = toHex(combineBrowser(kaspa, actionBrowser, redeem)); } catch (e) { cErrBrowser = e.message; }
  if (cErrNode || cErrBrowser) {
    if (cErrNode !== cErrBrowser) { console.error(`MISMATCH(combine-error) [${label}]: node="${cErrNode}" browser="${cErrBrowser}"`); mismatches++; }
    return;
  }
  if (combinedNodeHex !== combinedBrowserHex) {
    console.error(`MISMATCH(combine) [${label}]: node=${combinedNodeHex} browser=${combinedBrowserHex}`);
    mismatches++;
  }
}

// ── CommissionSplit 实际用到的两个 entry(真实 dispatch_tag, 来自本机真实编译产物) ──
runCase({ dispatch_tag: 'cc1c91af', params: [{ name: 'hasChange', type: { kind: 'bool' } }] }, { hasChange: true }, 'split-hasChange=true');
runCase({ dispatch_tag: 'cc1c91af', params: [{ name: 'hasChange', type: { kind: 'bool' } }] }, { hasChange: false }, 'split-hasChange=false');
runCase({ dispatch_tag: '777f5b11', params: [] }, {}, 'refund-noargs');

// ── 覆盖所有 param kind, 随机向量(每种 kind 跑 30 组, 覆盖本库支持的完整类型集, 不只是 CommissionSplit 用到的那两种——
//    这份编码器是通用库, 若未来别的合约的 entry 用到其他 kind, 也已经在这里被 parity 验证过) ──
for (let i = 0; i < 30; i++) {
  runCase({ dispatch_tag: toHex(randBytes(4)), params: [{ name: 'n', type: { kind: 'int' } }] }, { n: randInt() }, `int#${i}`);
  runCase({ dispatch_tag: toHex(randBytes(4)), params: [{ name: 't', type: { kind: 'temporal' } }] }, { t: randInt() }, `temporal#${i}`);
  runCase({ dispatch_tag: toHex(randBytes(4)), params: [{ name: 'b', type: { kind: 'bool' } }] }, { b: Math.random() < 0.5 }, `bool#${i}`);
  runCase({ dispatch_tag: toHex(randBytes(4)), params: [{ name: 'by', type: { kind: 'byte' } }] }, { by: Math.floor(Math.random() * 256) }, `byte#${i}`);
  runCase({ dispatch_tag: toHex(randBytes(4)), params: [{ name: 'bs', type: { kind: 'bytes' } }] }, { bs: toHex(randBytes(1 + Math.floor(Math.random() * 50))) }, `bytes#${i}`);
  runCase({ dispatch_tag: toHex(randBytes(4)), params: [{ name: 'tx', type: { kind: 'text' } }] }, { tx: `随机文本${i}héllo` }, `text#${i}`);
  runCase({ dispatch_tag: toHex(randBytes(4)), params: [{ name: 'pk', type: { kind: 'pubkey' } }] }, { pk: toHex(randBytes(32)) }, `pubkey#${i}`);
  runCase({ dispatch_tag: toHex(randBytes(4)), params: [{ name: 'sg', type: { kind: 'sig' } }] }, { sg: toHex(randBytes(65)) }, `sig#${i}`);
  runCase({ dispatch_tag: toHex(randBytes(4)), params: [{ name: 'ds', type: { kind: 'datasig' } }] }, { ds: toHex(randBytes(64)) }, `datasig#${i}`);
  const flen = 1 + Math.floor(Math.random() * 40);
  runCase({ dispatch_tag: toHex(randBytes(4)), params: [{ name: 'fb', type: { kind: 'fixed_bytes', len: flen } }] }, { fb: toHex(randBytes(flen)) }, `fixed_bytes#${i}`);
  const alen = 1 + Math.floor(Math.random() * 5);
  runCase({ dispatch_tag: toHex(randBytes(4)), params: [{ name: 'fa', type: { kind: 'fixed_array', len: alen, item: { kind: 'int' } } }] }, { fa: Array.from({ length: alen }, () => randInt()) }, `fixed_array-int#${i}`);
  runCase({ dispatch_tag: toHex(randBytes(4)), params: [{ name: 'da', type: { kind: 'dynamic_array', item: { kind: 'pubkey' } } }] }, { da: Array.from({ length: 1 + Math.floor(Math.random() * 4) }, () => toHex(randBytes(32))) }, `dynamic_array-pubkey#${i}`);
  // 多参数混合 entry(更贴近真实合约 entry 通常不止一个参数的情况)
  runCase(
    { dispatch_tag: toHex(randBytes(4)), params: [{ name: 'a', type: { kind: 'int' } }, { name: 'b', type: { kind: 'bool' } }, { name: 'c', type: { kind: 'fixed_bytes', len: 32 } }] },
    { a: randInt(), b: Math.random() < 0.5, c: toHex(randBytes(32)) },
    `mixed#${i}`
  );
}

// ── 错误路径也要一致(缺参数/长度不符各测一组) ──
runCase({ dispatch_tag: 'aabbccdd', params: [{ name: 'missing', type: { kind: 'int' } }] }, {}, 'error-missing-arg');
runCase({ dispatch_tag: 'aabbccdd', params: [{ name: 'pk', type: { kind: 'pubkey' } }] }, { pk: toHex(randBytes(31)) }, 'error-pubkey-wrong-len');

console.log(`\ntotal cases: ${total}, mismatches: ${mismatches}`);
if (mismatches > 0) { console.error('FAIL: browser port 与 Node 原版不是逐字节一致'); process.exit(1); }
console.log('PASS: 所有向量 browser port 与 Node 原版逐字节一致(含错误路径)');
