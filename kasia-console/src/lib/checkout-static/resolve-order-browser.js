// resolve-order-browser.js — 浏览器端订单地址推导(D-034 §8 后续票①第二轮, Bettor 指出上一轮方向
// 判断错误后重新验证成功: 见 order-template.js 头注的三条独立证据)。逐字对应
// commission-plan-sdk.mjs 的 resolveRulesForOrder + createCommissionSplitProtocol 两个函数的逻辑,
// 唯一区别是最后一步用 order-template.js 的固定偏移覆写(spliceCommissionSplitScript)代替
// compileSilV100(silverc.exe 原生编译器调用), 不需要 resolver.mjs。
//
// 🔴 MUST 纪律照搬不变(同 commission-plan-sdk.mjs resolveRulesForOrder 头注, NWT 2026-09-27T09-22Z②):
// channelAddrs 只能来自 verifyChain() 的验证结果, 本函数同样不接受一个独立的裸地址数组参数。
import { spliceCommissionSplitScript, INT_DATA_LEN } from './order-template.js';

const MAX_CHANNELS = 5;
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

function stripProviderAddressForFeeSplit(roles) {
  return roles.map(r => {
    if (r.name !== 'provider') return r;
    const { address, ...rest } = r;
    return rest;
  });
}

/** resolveRulesForOrder — 逐字对应 commission-plan-sdk.mjs 同名函数, 见该文件头注 MUST 纪律。 */
export function resolveRulesForOrder(kaspaWasm, feeSplitLib, quote, verifiedChain, opts = {}) {
  if (!verifiedChain || verifiedChain.ok !== true) {
    if (!opts.allowUnsignedChannelAddrs) {
      throw new Error('resolveRulesForOrder: 第二个参数必须是 verifyChain() 的成功返回值(ok:true)——channelAddrs 与签名链必须同源, 不接受未经验证的地址列表(NWT MUST, 2026-09-27T09-22Z②)');
    }
  }
  const channelSpks = verifiedChain.channelSpks || [];
  const roles = quote.canonical_rules.roles.map(r => ({ ...r }));
  const payoutSpks = new Map();
  for (const r of roles) {
    if (r.name === 'provider') { payoutSpks.set(r.name, spkBytesFromAddress(kaspaWasm, r.address)); continue; }
    if (!r.name.startsWith('channel_')) {
      if (r.address) { payoutSpks.set(r.name, spkBytesFromAddress(kaspaWasm, r.address)); r.address = '00'.repeat(32); }
      continue;
    }
  }
  for (let i = 0; i < MAX_CHANNELS; i++) {
    const slotName = `channel_${i + 1}`;
    const role = roles.find(r => r.name === slotName);
    if (!role) continue;
    if (channelSpks[i]) {
      payoutSpks.set(slotName, channelSpks[i]);
      delete role.fold_to;
      role.address = '00'.repeat(32);
    } else {
      const target = roles.find(x => x.name === role.fold_to);
      target.bps += role.bps;
      roles.splice(roles.indexOf(role), 1);
    }
  }
  const resolvedRoles = { schema_v: quote.canonical_rules.schema_v, roles };
  const rolesForFeeSplit = stripProviderAddressForFeeSplit(roles);
  const feeRulesForSplit = { schema_v: quote.canonical_rules.schema_v, roles: rolesForFeeSplit };
  feeSplitLib.validateFeeRules(feeRulesForSplit, { providerMinBps: opts.providerMinBps, roleMaxBps: opts.roleMaxBps });
  const priceSompi = BigInt(quote.price_sompi);
  const providerPlaceholder = '11'.repeat(32);
  const result = feeSplitLib.feeSplit(feeRulesForSplit, priceSompi, [{ pk: providerPlaceholder, stake: 1 }]);
  if (result.degenerate) throw new Error('resolveRulesForOrder: feeSplit degenerate(不应发生, provider 恒为唯一 winner)');
  const finalRoles = [
    { name: 'provider', amountSompi: BigInt(result.winners[0].amount), spk: payoutSpks.get('provider') },
    ...result.feeLeaves.map(l => ({ name: l.type, amountSompi: BigInt(l.amount), spk: payoutSpks.get(l.type) })),
  ];
  for (const fr of finalRoles) {
    if (!fr.spk) throw new Error(`resolveRulesForOrder: 角色 ${fr.name} 没有解析出 scriptPubKey(内部一致性检查失败)`);
  }
  return { roles: resolvedRoles, payoutLeaves: finalRoles };
}

function padSpk37(fullBytes) {
  if (fullBytes.length > 37) throw new Error(`padSpk37: spk 长度 ${fullBytes.length} 超过槽位上限 37`);
  const out = new Uint8Array(37);
  out.set(fullBytes, 0);
  return out;
}

/** deriveCommissionOrderAddress — 逐字对应 createCommissionSplitProtocol, 唯一区别: 用
 * spliceCommissionSplitScript(固定偏移覆写)代替 compileSilV100(silverc.exe), 不需要 resolver.mjs。
 * @param {object} cfg { network, finalRoles, payerRefundAddress, deadlineMs?, maxSplitFeeSompi, maxRefundFeeSompi, ruleCommitHex?, channelChainCommitmentHex? }
 */
export function deriveCommissionOrderAddress(kaspaWasm, cfg) {
  const roles = cfg.finalRoles;
  if (roles.length < 1 || roles.length > MAX_ROLES) throw new Error(`deriveCommissionOrderAddress: finalRoles.length=${roles.length} 必须在 1-${MAX_ROLES}`);
  const orderNonce = crypto.getRandomValues(new Uint8Array(16));
  const deadlineMs = cfg.deadlineMs != null ? Number(cfg.deadlineMs) : (Date.now() + DEFAULT_DEADLINE_MS);
  const ruleCommit = cfg.ruleCommitHex ? hexToBytes(cfg.ruleCommitHex) : new Uint8Array(32);
  const chainCommit = cfg.channelChainCommitmentHex ? hexToBytes(cfg.channelChainCommitmentHex) : new Uint8Array(32);
  const refundSpk = spkBytesFromAddress(kaspaWasm, cfg.payerRefundAddress);

  const values = { role_count: roles.length };
  for (let i = 0; i < MAX_ROLES; i++) {
    const r = roles[i];
    const n = i + 1;
    if (r) { values[`role${n}_spk`] = padSpk37(r.spk); values[`role${n}_len`] = r.spk.length; values[`role${n}_amt`] = r.amountSompi; }
    else { values[`role${n}_spk`] = new Uint8Array(37); values[`role${n}_len`] = 0; values[`role${n}_amt`] = 0n; }
  }
  values.refund_spk = padSpk37(refundSpk); values.refund_len = refundSpk.length;
  values.deadline_ms = BigInt(deadlineMs);
  values.max_split_fee = BigInt(cfg.maxSplitFeeSompi);
  values.max_refund_fee = BigInt(cfg.maxRefundFeeSompi);
  values.rule_commit = ruleCommit; values.channel_chain_commitment = chainCommit; values.order_nonce = orderNonce;

  const redeemScript = spliceCommissionSplitScript(values);
  const spk = kaspaWasm.payToScriptHashScript(redeemScript);
  const address = kaspaWasm.addressFromScriptPublicKey(spk, cfg.network).toString();

  return { address, deadlineMs, roles, redeemScript, orderNonceHex: bytesToHex(orderNonce) };
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(bytes) { return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''); }
