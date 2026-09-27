// resolve-order-wasm.js — 浏览器端订单地址推导, 主路径(D-034 §8 后续票①第三轮, Bettor 指示优先走
// (b) 真编译器编 wasm: silverscript-lang 库(非 silverc CLI bin)编 wasm32-unknown-unknown, 逐字对照
// src/bin/silverc.rs 真实调用路径(Vec<ArtifactValue> → compile_to_sil_abi_artifact → to_pretty_json)。
//
// 与 resolve-order-browser.js(order-template.js 固定偏移拼接, 见该文件头注三条独立证据)的关系:
// 本文件是**首选**——用的是真编译器, 不是对 ctor 编码格式做归纳假设, 对"ctor 值会改变脚本结构"的
// 合约类型(数组长度/for 展开依赖 ctor 值——CommissionSplit/ChannelDeposit 不属于这类, 但别的合约
// 可能属于)天然正确, 不用逐类型验证"这份合约结构不随参数变化"这条前提。resolve-order-browser.js
// 保留作为文档化的备选(Bettor 止损条款: 两条都不通就收——本条通了, 但另一条也已验证通过, 两条都留
// 证据链完整, 不删已验证工作)。
//
// resolveRulesForOrder 逻辑与 resolve-order-browser.js 完全相同(同一段角色解析/费用拆分, 不是这里
// 要动的部分), 只从那个文件 re-export, 避免重复维护同一段 MUST 纪律代码。
export { resolveRulesForOrder } from './resolve-order-browser.js';

const MAX_ROLES = 7;
const DEFAULT_DEADLINE_MS = 72 * 3600 * 1000;

function spkBytesFromAddress(kaspaWasm, addrStr) {
  const spk = kaspaWasm.payToAddressScript(new kaspaWasm.Address(addrStr));
  const versionBytes = new Uint8Array([spk.version & 0xff, (spk.version >> 8) & 0xff]);
  const scriptBytes = new Uint8Array(spk.script.length / 2);
  for (let i = 0; i < scriptBytes.length; i++) scriptBytes[i] = parseInt(spk.script.substr(i * 2, 2), 16);
  const out = new Uint8Array(2 + scriptBytes.length);
  out.set(versionBytes, 0); out.set(scriptBytes, 2);
  return out;
}
function padSpk37(fullBytes) {
  if (fullBytes.length > 37) throw new Error(`padSpk37: spk 长度 ${fullBytes.length} 超过槽位上限 37`);
  const out = new Uint8Array(37);
  out.set(fullBytes, 0);
  return out;
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(bytes) { return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''); }

// ArtifactValue ctor 节点构造(与 pool-bshard-artifacts.mjs ctorBytes32V100/ctorIntV100 同一方言,
// {kind:'bytes'|'int', value:...}——silverc v1.0.0 CLI 与本 wasm 库对同一份 JSON 输入的解析是同一段
// Rust 代码(ArtifactValue 的 serde Deserialize), 不是重新定义了一套格式)。
const ctorBytes = (buf) => ({ kind: 'bytes', value: Array.from(buf) });
const ctorInt = (n) => ({ kind: 'int', value: typeof n === 'bigint' ? Number(n) : n });

/**
 * deriveCommissionOrderAddress — wasm 真编译器版本, 逐字对应 commission-plan-sdk.mjs 的
 * createCommissionSplitProtocol(唯一区别: 浏览器原生 wasm compile() 代替 compileSilV100/silverc.exe,
 * 不需要 resolver.mjs)。
 * @param {object} silvercWasm 已 init 好的 vendor/silverc-wasm/silverc_lang.js 模块(export { compile })
 * @param {string} commissionSplitSource CommissionSplit.sil 源码文本(vendor/sil-source/ 下同源拷贝)
 * @param {object} cfg { network, finalRoles, payerRefundAddress, deadlineMs?, maxSplitFeeSompi, maxRefundFeeSompi, ruleCommitHex?, channelChainCommitmentHex? }
 */
export function deriveCommissionOrderAddress(kaspaWasm, silvercWasm, commissionSplitSource, cfg) {
  const roles = cfg.finalRoles;
  if (roles.length < 1 || roles.length > MAX_ROLES) throw new Error(`deriveCommissionOrderAddress(wasm): finalRoles.length=${roles.length} 必须在 1-${MAX_ROLES}`);
  const orderNonce = crypto.getRandomValues(new Uint8Array(16));
  const deadlineMs = cfg.deadlineMs != null ? Number(cfg.deadlineMs) : (Date.now() + DEFAULT_DEADLINE_MS);
  const ruleCommit = cfg.ruleCommitHex ? hexToBytes(cfg.ruleCommitHex) : new Uint8Array(32);
  const chainCommit = cfg.channelChainCommitmentHex ? hexToBytes(cfg.channelChainCommitmentHex) : new Uint8Array(32);
  const refundSpk = spkBytesFromAddress(kaspaWasm, cfg.payerRefundAddress);

  const ctor = [ctorInt(roles.length)];
  for (let i = 0; i < MAX_ROLES; i++) {
    const r = roles[i];
    if (r) ctor.push(ctorBytes(padSpk37(r.spk)), ctorInt(r.spk.length), ctorInt(r.amountSompi));
    else ctor.push(ctorBytes(new Uint8Array(37)), ctorInt(0), ctorInt(0));
  }
  ctor.push(ctorBytes(padSpk37(refundSpk)), ctorInt(refundSpk.length));
  ctor.push(ctorInt(deadlineMs), ctorInt(cfg.maxSplitFeeSompi), ctorInt(cfg.maxRefundFeeSompi));
  ctor.push(ctorBytes(ruleCommit), ctorBytes(chainCommit), ctorBytes(orderNonce));

  const outJson = silvercWasm.compile(commissionSplitSource, JSON.stringify(ctor));
  const artifact = JSON.parse(outJson);
  const compiled = artifact?.contracts?.CommissionSplit?.compiled;
  if (!compiled || !Array.isArray(compiled.bytecode)) {
    throw new Error(`deriveCommissionOrderAddress(wasm): 编译产物缺 contracts.CommissionSplit.compiled.bytecode — schema 漂移? raw=${outJson.slice(0, 200)}`);
  }
  const redeemScript = new Uint8Array(compiled.bytecode);
  const spk = kaspaWasm.payToScriptHashScript(redeemScript);
  const address = kaspaWasm.addressFromScriptPublicKey(spk, cfg.network).toString();

  return { address, deadlineMs, roles, redeemScript, orderNonceHex: bytesToHex(orderNonce) };
}
