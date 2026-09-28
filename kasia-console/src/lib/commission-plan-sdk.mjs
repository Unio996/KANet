// commission-plan-sdk.mjs — 商品佣金计划 + 多渠道归因 SDK (D-034 §8 实现,
// 设计稿 docs/2026-09-27-j2-commission-plan-attribution-design-v0.4.md,
// NWT 四轮攻击面审 2026-09-27T09-22Z 合并审通过: 1 MUST + 1 强 SHOULD, 均在本文件落地——见下方
// resolveRulesForOrder(MUST)与 signOrderAddressClaim/verifyOrderAddressClaim(SHOULD)的注释。
//
// 本文件是 instant-split-sdk.mjs(已合入 bshard-m3-deploy@f83f6b6e)的推广, 不是另起(D-031)——
// 复用同一套 compileSilV100/generic-entry-witness/PMT 现查纪律, 合约骨架见 CommissionSplit.sil
// 头注释。收款人角色数从固定 3 推广为 1-7(provider 必选 + 最多 6 个可选=broker+5 channel)。
//
// D-034 §8 全部放宽点在本文件的落地位置一览(供审阅对照设计稿逐条核):
//   §2 报价 JSON(签名+押金条款) → signQuote/verifyQuoteSignature/validateDepositTerms
//   §3.1 归因链接(N2/N3 修复) → encodeAttributionLink/parseAttributionLink/dedupAndCapChannelSpks
//   §3.3 渠道预先公开声明(SHOULD, 本轮扩展到多渠道截断) → signOrderAddressClaim/verifyOrderAddressClaim
//   §3.4 签名链(O1) → signChainEntry/verifyChain
//   §6.1/§6.1b mass 校验(N1/O2) → validateQuoteMassFeasibility/estimateOrderMassPrecheck
//   §6.1c 反推最小订单额(O4) → minOrderSompiForChannels
//   §6.2 任意标准地址类型 → spkBytesFromAddress/validateRoleAddressSpk
//   §6.4 未归因份额并入指定方(MUST: channelAddrs 必须同源) → resolveRulesForOrder
//   §7 渠道押金(O3) → validateDepositTerms/createChannelDepositProtocol/buildChannelWithdrawTx

import { randomBytes } from 'node:crypto';
import { blake2b } from '@noble/hashes/blake2b';
import { compileSilV100, ctorIntV100 } from './pool-bshard-artifacts.mjs';
import { encodeEntryActionGeneric, combineActionAndRedeem } from '../../scripts/audit/generic-entry-witness.mjs';
import { validateFeeRules, canonicalJsonSorted, feeSplit, PROVIDER_MIN_BPS, ROLE_MAX_BPS } from './fee-split.mjs';
import { estimateMassUpperBound } from '../../../kasia-relay/src/lib/tx-mass-ub.mjs';
import * as kaspa from 'kaspa-wasm';

const { Address, PrivateKey, PublicKey, Transaction, TransactionOutput, ScriptPublicKey, payToAddressScript, addressFromScriptPublicKey, signMessage, verifyMessage } = kaspa;

export const CONTRACT_NAME = 'CommissionSplit';
export const SIL_PATH = new URL('./sil-v1/CommissionSplit.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:');
export const DEPOSIT_CONTRACT_NAME = 'ChannelDeposit';
export const DEPOSIT_SIL_PATH = new URL('./sil-v1/ChannelDeposit.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:');

export const DEFAULT_DEADLINE_MS = 72 * 3600 * 1000;          // 同 InstantSplit(设计稿 §4.6 残余风险注记引用同一套默认)
export const MAX_CHANNELS = 5;                                  // D-034 §8"每单最多 5 个渠道"
export const MAX_ROLES = 7;                                     // provider(必选) + 最多 6 个(broker + 最多 5 channel)
export const ROLE_SPK_SLOT_BYTES = 37;                          // §6.2: P2PK=36B/P2PK-ECDSA=37B/P2SH=37B, 取三者最大值定长槽位(scratch/_j2_commission_impl_research/spk_lengths.mjs 真实测量)
export const DEFAULT_DEPOSIT_SOMPI = 100_000_000n;               // 1 KAS(D-034 §8 原话默认)
export const SIGCHAIN_DOMAIN = 'KANET-COMMISSION-CHAIN-V1';      // §3.4.2

// ──────────────────────────────────────────────────────────────────────────
// §6.2 任意标准地址类型: 地址 <-> 完整 scriptPubKey 字节(version(2B LE)++script)
// ──────────────────────────────────────────────────────────────────────────

/** 标准地址字符串 → 完整序列化 scriptPubKey 字节(Buffer)。P2PK/P2PK-ECDSA/P2SH 通用同一条路径
 * (真实验证: scratch/_j2_commission_impl_research/p2sh_addr_test.mjs, payToAddressScript 对三种
 * 地址版本都产出正确形状, 不需要按类型分支)。 */
export function spkBytesFromAddress(addrStr) {
  const spk = payToAddressScript(new Address(addrStr));
  return Buffer.concat([Buffer.from([spk.version & 0xff, (spk.version >> 8) & 0xff]), Buffer.from(spk.script, 'hex')]);
}

/** §6.2 MUST-2: 只接受能反解成标准地址类型(P2PK/P2PK-ECDSA/P2SH)的 spk 字节, 拒绝任何反解不出已知
 * 模板的裸字节——返回反解出的地址类型(供 §7.3 押金绑定判断是否可取 pubkey), 反解失败抛错(fail-loud,
 * 不静默放行垃圾字节进报价)。 */
export function validateRoleAddressSpk(spkBytes, network) {
  const version = spkBytes[0] | (spkBytes[1] << 8);
  const script = spkBytes.subarray(2).toString('hex');
  const addr = addressFromScriptPublicKey({ version, script }, network);
  if (!addr) throw new Error(`validateRoleAddressSpk: 反解不出标准地址类型(spk=${spkBytes.toString('hex')})——只接受 P2PK/P2PK-ECDSA/P2SH`);
  return addr.version; // 'PubKey' | 'PubKeyECDSA' | 'ScriptHash'
}

function padSpk37(fullBytes) {
  if (fullBytes.length > ROLE_SPK_SLOT_BYTES) throw new Error(`padSpk37: spk 长度 ${fullBytes.length} 超过槽位上限 ${ROLE_SPK_SLOT_BYTES}(§6.2 三种标准类型实测最大 37B, 出现更长的说明不是标准类型, 应已在 validateRoleAddressSpk 被拒)`);
  return Buffer.concat([fullBytes, Buffer.alloc(ROLE_SPK_SLOT_BYTES - fullBytes.length, 0)]);
}

// ──────────────────────────────────────────────────────────────────────────
// §2 报价 JSON: 签名 / 验签 / 押金条款(O3)
// ──────────────────────────────────────────────────────────────────────────

/** canonical 序列化: 复用 fee-split.mjs 导出的同一套 sorted-key JSON 约定(不新造第二种规则,
 * 设计稿 §2 原话), 覆盖除 signature_hex 外的全部字段。 */
export function canonicalQuoteBytes(quote) {
  const { signature_hex, ...rest } = quote;
  return Buffer.from(canonicalJsonSorted(rest), 'utf8');
}

/** signQuote — 商家用私钥对报价签名(schnorr, kaspa-wasm signMessage, 同 coord-status-sign.mjs
 * 已有的"message=hex(内容)"惯例复用, 不新造签名机制)。签名前强制两条 MUST 过一遍(§6.1 MUST-1 +
 * O3 押金条款合法性), 任何一条不过拒绝产生签名(§6.1 原话"签名工具在校验失败时拒绝产生 signature_hex")。 */
export function signQuote(quoteWithoutSig, merchantPrivKeyHex) {
  if (quoteWithoutSig.require_channel_deposit) validateDepositTerms(quoteWithoutSig.deposit_terms);
  const feasibility = validateQuoteMassFeasibility(quoteWithoutSig);
  if (!feasibility.ok) throw new Error(`signQuote: worst-case mass 校验未通过, 拒绝签名 — ${feasibility.reason}`);
  const quoteWithProof = { ...quoteWithoutSig, mass_feasibility_checked: true, mass_feasibility_worst_case: { massA: feasibility.massA.toString(), massB: feasibility.massB.toString(), safety_budget: feasibility.safetyBudget.toString() } };
  const msgHex = canonicalQuoteBytes(quoteWithProof).toString('hex');
  const priv = new PrivateKey(merchantPrivKeyHex);
  const signature_hex = signMessage({ message: msgHex, privateKey: priv });
  return { ...quoteWithProof, signature_hex };
}

/** verifyQuoteSignature — 任何人拿商家公开 pubkey 独立验证, 不需要问商家(设计稿 §2 原话)。 */
export function verifyQuoteSignature(quote) {
  if (!quote.signature_hex || !quote.merchant_pubkey_hex) return false;
  const msgHex = canonicalQuoteBytes(quote).toString('hex');
  try {
    return !!verifyMessage({ message: msgHex, signature: quote.signature_hex, publicKey: quote.merchant_pubkey_hex });
  } catch { return false; }
}

/** validateDepositTerms — O3: V1 只有一种合法取值组合, 不是默认值(设计稿 §2/§7.1)。 */
export function validateDepositTerms(terms) {
  if (!terms || terms.schema_v !== 1) throw new Error('validateDepositTerms: deposit_terms.schema_v 必须为 1');
  if (terms.redeemable_by !== 'depositor_only') throw new Error(`validateDepositTerms: V1 redeemable_by 只能是 'depositor_only', got ${terms.redeemable_by}`);
  if (terms.redeemable_after_ms !== 0) throw new Error(`validateDepositTerms: V1 redeemable_after_ms 只能是 0, got ${terms.redeemable_after_ms}`);
  if (terms.forfeitable !== false) throw new Error(`validateDepositTerms: V1 forfeitable 只能是 false, got ${terms.forfeitable}——V1 押金不可没收`);
  if (terms.forfeit_conditions !== null) throw new Error('validateDepositTerms: V1 forfeit_conditions 必须为 null');
  if (terms.arbiter !== null) throw new Error('validateDepositTerms: V1 arbiter 必须为 null');
  return true;
}

// ──────────────────────────────────────────────────────────────────────────
// §6.1/§6.1b mass 校验(N1 + O2): 报价签发时刻 worst-case 强制校验 + 付款前三维预检
// ──────────────────────────────────────────────────────────────────────────

/** fullyUnfoldRoles — 把 roles 数组里全部带 fold_to 的角色当作已经归因(不折算), 用于计算
 * "报价刚签发那一刻就完全确定"的最坏情形(§6.1 MUST-1 的数学基础: 调和不等式保证折算只会让 mass
 * 变小, 见设计稿 §6.1 证明, 本函数不重复推导)。占位 spk 统一用 ROLE_SPK_SLOT_BYTES(37B, §6.2 三种
 * 标准类型的真实最大长度)——不是 v0.3/v0.4 设计稿草稿里用过的 36B 占位(那是只按 P2PK 量的, P2SH/
 * ECDSA 会比这个数字略高, 本实现按真正的结构最坏情形 37B 校验, 比文档发布的参考分档表更保守, 是
 * 唯一真正的准入判据, 参考分档表本身不是判据——设计稿 §6.1 结论③原话)。 */
export function fullyUnfoldRoles(roles) {
  // 🔴 fold_to 是本设计新增字段, fee-split.mjs 的 validateFeeRules 不认识它(白名单外键直接拒,
  // F1 强制纪律)——"不折算"在这里的意思是"每个角色都当作已经有地址、正常参与结算", 不是"保留
  // fold_to 字段本身"; fold_to 字段无论如何都必须在喂给 fee-split.mjs 之前剥离(同 resolveRulesForOrder
  // 真实归因路径最终也不会把 fold_to 带过去, 两条路径在这一点上必须一致)。
  return roles.map(r => { const { fold_to, ...rest } = r; return { ...rest, address: '00'.repeat(32) }; });
}

/** stripProviderAddressForFeeSplit — 🔴 实现期发现(未在设计稿出现, 独立测过坐实, 非猜测): fee-split.mjs
 * 的 validateFeeRules 明确要求 provider 角色**不带** address 字段("winners 集在 settle 时供给, 非规则
 * 配置"——那是给它自己的 prediction-market 应用场景设计的语义, provider 的收款目标由 feeSplit() 调用
 * 时单独传的 winners 参数供给, 不是从 roles 里读)。而本设计的报价 schema(§2)从 v0.1 起就在
 * canonical_rules.roles 里给 provider 直接带 address(商家收款地址本来就该在报价里写死)——这两条 schema
 * 期望不兼容, 直接把 quote.canonical_rules.roles 喂给 validateFeeRules/feeSplit 会在 provider 这一行
 * 立刻抛错(真实测过: scratch/_j2_commission_impl_research/*, 见交付报告)。修法: 不改 fee-split.mjs
 * (那是它自己场景下正确的约束, 改了会破坏 provider 地址不可预先指定这条其他调用方依赖的不变量),
 * 而是在喂给它之前剥离 provider.address, 真实地址走本文件自己的 payoutSpks side-table(同 fold_to
 * 字段本身就不是 fee-split.mjs 认识的东西, 是同一类"新增一层, 不改 fee-split"处理, 设计稿 §1.2 原则的
 * 直接延伸)。 */
function stripProviderAddressForFeeSplit(roles) {
  return roles.map(r => {
    if (r.name !== 'provider') return r;
    const { address, ...rest } = r;
    return rest;
  });
}

function worstCaseOutputsFromRoles(roles, priceSompi, opts) {
  const providerMinBps = opts?.providerMinBps ?? PROVIDER_MIN_BPS;
  const roleMaxBps = opts?.roleMaxBps ?? ROLE_MAX_BPS;
  const unfolded = { schema_v: 1, roles: stripProviderAddressForFeeSplit(fullyUnfoldRoles(roles)) };
  validateFeeRules(unfolded, { providerMinBps, roleMaxBps });
  const result = feeSplit(unfolded, priceSompi, [{ pk: '11'.repeat(32), stake: 1 }]);
  if (result.degenerate) throw new Error('worstCaseOutputsFromRoles: feeSplit degenerate(不应发生, provider 恒为 winner)');
  return result.payoutLeaves.map(l => BigInt(l.amount));
}

/** validateQuoteMassFeasibility — N1/MUST-1: 报价签名前强制过一遍真实 mass 估算, 覆盖 hasChange
 * 两个分支, 两者都要过安全预算才放行(§6.1 原文逐字落地)。 */
export function validateQuoteMassFeasibility(quote, opts = {}) {
  const safetyBudget = opts.safetyBudget ?? 400_000n;
  const priceSompi = BigInt(quote.price_sompi);
  const amounts = worstCaseOutputsFromRoles(quote.canonical_rules.roles, priceSompi, opts);
  const maxSplitFee = BigInt(quote.max_split_fee_sompi);
  const spk37 = '00'.repeat(ROLE_SPK_SLOT_BYTES);
  const mkOuts = (amts) => amts.map(v => ({ value: v, spk: spk37, covenant: false }));
  const inputShape = (amt) => ({ signatureScript: '00'.repeat(300), computeBudget: 70, amount: amt, spkLen: BigInt(ROLE_SPK_SLOT_BYTES + 3), hasCovenant: false });

  const sumA = amounts.reduce((a, b) => a + b, 0n);
  const massA = estimateMassUpperBound({ version: 1, inputs: [inputShape(sumA + maxSplitFee)], outputs: mkOuts(amounts) }).mass;

  const changeFloor = opts.minChangeSompi ?? 5_264_100n; // §6.1 N1 重测(1渠道+broker 档), 找零最坏情形取同档最低额, 与 O2 最小额口径一致
  const amountsB = [...amounts, changeFloor];
  const inputAmtB = sumA + maxSplitFee + changeFloor + 1n;
  const massB = estimateMassUpperBound({ version: 1, inputs: [inputShape(inputAmtB)], outputs: mkOuts(amountsB) }).mass;

  if (massA > safetyBudget || massB > safetyBudget) {
    return { ok: false, massA, massB, safetyBudget, reason: `worst-case mass 超出安全预算(massA=${massA}, massB=${massB}, budget=${safetyBudget})——需要减少角色数或提高份额低于运营下限的角色的份额` };
  }
  return { ok: true, massA, massB, safetyBudget };
}

/** estimateOrderMassPrecheck — O2: 付款前对整笔即将广播的交易做完整预检, 三维分别报告
 * (compute/storage 各 500,000 硬上限共享同一数值但各自独立; transient 1,000,000, 来源
 * D:\rusty-kaspa\consensus\core\src\config\params.rs, NWT 已逐字核对一致)。
 * @param {{value:bigint, spkBytes:Buffer}[]} outputs
 * @param {bigint} inputAmountSompi
 */
export function estimateOrderMassPrecheck(outputs, inputAmountSompi) {
  const shape = {
    version: 1,
    inputs: [{ signatureScript: '00'.repeat(300), computeBudget: 70, amount: inputAmountSompi, spkLen: BigInt(ROLE_SPK_SLOT_BYTES + 3), hasCovenant: false }],
    outputs: outputs.map(o => ({ value: o.value, spk: o.spkBytes.toString('hex'), covenant: false })),
  };
  const r = estimateMassUpperBound(shape);
  return {
    mass: r.mass, compute: r.compute, storage: r.storage, transient: r.transient,
    exceeds: { compute: r.compute > 500_000n, storage: r.storage > 500_000n, transient: r.transient > 1_000_000n },
    limits: { compute: 500_000n, storage: 500_000n, transient: 1_000_000n },
  };
}

/** minOrderSompiForChannels — O4: "五级是最大深度不是目标", 按渠道预算比例反算最小订单额
 * (设计稿 §6.1c 公式, Owner 给的 5×0.15KAS/10%=7.5KAS 例子已核验)。 */
export function minOrderSompiForChannels(n, dosagePerChannelSompi, channelBudgetBps) {
  if (channelBudgetBps <= 0) throw new Error('minOrderSompiForChannels: channelBudgetBps 必须 >0');
  const totalChannelFloor = BigInt(n) * BigInt(dosagePerChannelSompi);
  return totalChannelFloor * 10_000n / BigInt(channelBudgetBps);
}

// ──────────────────────────────────────────────────────────────────────────
// §3.1 归因链接: 编解码 + 去重(N2)+ 上限(N3)
// ──────────────────────────────────────────────────────────────────────────

/** encodeAttributionLink — 组装 ch= 参数(逐级转发追加地址)。chainEntries 存在时同时编码签名链
 * (base64url, §3.4.5)。 */
export function encodeAttributionLink(baseUrl, quoteRef, channelAddrs, chainEntries = null) {
  const url = new URL(baseUrl);
  url.searchParams.set('q', quoteRef);
  if (channelAddrs.length) url.searchParams.set('ch', channelAddrs.join(','));
  if (chainEntries && chainEntries.length) {
    const enc = chainEntries.map(e => `${e.position}:${Buffer.from(e.address_spk).toString('base64url')}:${Buffer.from(e.signing_pubkey).toString('base64url')}:${Buffer.from(e.sig, 'hex').toString('base64url')}`).join('.');
    url.searchParams.set('sc', enc);
  }
  return url.toString();
}

/** parseAttributionLink — 拆出 quoteRef / 原始 ch 地址列表(未去重, 原始顺序) / 签名链条目(若有)。 */
export function parseAttributionLink(url) {
  const u = new URL(url);
  const quoteRef = u.searchParams.get('q');
  const chRaw = u.searchParams.get('ch');
  const rawChannelAddrs = chRaw ? chRaw.split(',') : [];
  const scRaw = u.searchParams.get('sc');
  const chainEntries = scRaw ? scRaw.split('.').map(part => {
    const [pos, addrB64, pkB64, sigB64] = part.split(':');
    return { position: Number(pos), address_spk: Buffer.from(addrB64, 'base64url'), signing_pubkey: Buffer.from(pkB64, 'base64url'), sig: Buffer.from(sigB64, 'base64url').toString('hex') };
  }) : [];
  return { quoteRef, rawChannelAddrs, chainEntries };
}

/** dedupAndCapChannelSpks — N3(上限判断原始位置数, 含重复, 在去重之前做) + N2(去重比较规范化
 * scriptPubKey 字节, 不比 bech32 文本; 同一 pubkey 不同地址模板不做跨模板归并——判据严格是"完整
 * scriptPubKey 字节是否逐字节相同")。
 * @returns {{ok:boolean, spks:Buffer[], reason?:string}} spks 长度 = rawAddrs.length, 重复位置为 null(空槽位)
 */
export function dedupAndCapChannelSpks(rawAddrs) {
  if (rawAddrs.length > MAX_CHANNELS) {
    return { ok: false, spks: [], reason: `原始位置数 ${rawAddrs.length} > 上限 ${MAX_CHANNELS}(N3: 在去重之前按原始长度拒绝, 防空槽位位移攻击)` };
  }
  const seen = [];
  const spks = [];
  for (let i = 0; i < rawAddrs.length; i++) {
    let spk;
    try {
      spk = spkBytesFromAddress(rawAddrs[i]);
    } catch (e) {
      // 🔴 实现期真实发现(scratch/_j2_commission_impl_research/case_test.mjs): kaspa-wasm 的
      // Address 构造器对非规范大小写的 bech32(比如整串转大写)不是"规范化后接受", 而是 wasm panic
      // (message='unreachable')——即"混合/全大写 bech32"这条 N2 设计稿设想的攻击路径, 在真正接触
      // 本 SDK 唯一的地址解析入口(new Address())时就已经被结构性拒绝, 根本走不到本函数的去重逻辑。
      // 这里 fail-loud 地把它当作"地址格式不合法"拒绝(而不是让 wasm panic 未捕获地往上炸穿调用栈),
      // 是本函数职责边界内该做的事; 本函数下面仍然按"规范 scriptPubKey 字节"比较去重(而不是比较
      // 地址文本)——这条防线本身没有因为地址解析器已经挡了一部分攻击面而变得多余, 它是对"任何未来
      // 更宽松的地址解析实现"的独立防御, 不依赖 kaspa-wasm 这一个具体实现的当前行为。
      return { ok: false, spks: [], reason: `第 ${i + 1} 个渠道地址无法解析为标准地址(${e.message})——拒绝整条链接, 不静默跳过` };
    }
    const spkHex = spk.toString('hex');
    spks.push(seen.includes(spkHex) ? null : spk); // N2: 第二次出现(比较规范 scriptPubKey 字节)视为空槽位, 不占用/不挤压后续位置
    if (!seen.includes(spkHex)) seen.push(spkHex);
  }
  return { ok: true, spks };
}

// ──────────────────────────────────────────────────────────────────────────
// §3.4 渠道逐级签名链(O1)
// ──────────────────────────────────────────────────────────────────────────

function quoteHashBytes(quote) {
  return Buffer.from(blake2b(canonicalQuoteBytes(quote), { dkLen: 32 }));
}

function chainDigest0(quote, network) {
  return Buffer.from(blake2b(Buffer.concat([Buffer.from(SIGCHAIN_DOMAIN, 'utf8'), quoteHashBytes(quote), Buffer.from(network, 'utf8')]), { dkLen: 32 }));
}

function chainMessageBytes(prevDigest, position, addressSpk, signingPubkey) {
  return Buffer.concat([prevDigest, Buffer.from([position & 0xff]), addressSpk, signingPubkey]);
}

/** signChainEntry — 渠道加入链条时对"前序摘要+自己位置+自己地址+自己签名身份公钥"签名
 * (§3.4.2 逐字实现)。signingPrivKeyHex 对应的公钥用 kaspa-wasm PublicKey 33 字节压缩形式
 * (真实测量: scratch/_j2_commission_impl_research/signmessage_test.mjs, 与 signMessage/verifyMessage
 * 配对使用的公钥格式一致, 不是合约 ctor 用的 32 字节 x-only 形式——两者是不同的"pubkey 编码惯例",
 * 签名链只用于链下验证, 不受合约 ctor pubkey 类型约束)。 */
export function signChainEntry(prevDigest, position, addressSpk, signingPrivKeyHex) {
  const priv = new PrivateKey(signingPrivKeyHex);
  const pub = priv.toPublicKey();
  const signingPubkey = Buffer.from(pub.toString(), 'hex');
  const msg = chainMessageBytes(prevDigest, position, addressSpk, signingPubkey);
  const sig = signMessage({ message: msg.toString('hex'), privateKey: priv });
  return { position, address_spk: addressSpk, signing_pubkey: signingPubkey, sig };
}

/** verifyChain — §3.4.3 逐字实现: 位置严格递增从 1 开始, 每环签名对"重算出的消息"校验。
 * @returns {{ok:boolean, chainDigest:Buffer, channelSpks:Buffer[], reason?:string}}
 */
export function verifyChain(quote, entries, network) {
  // 🔴 NWT diff 审 SHOULD(2026-09-27T10-11Z④, 一致性): 早期版本这里不限制 entries.length, 一条真实
  // 6 环都签对的合法链会让 resolveRulesForOrder 的槽位填充循环(固定 0..MAX_CHANNELS-1)静默只读前
  // 5 个、第 6 个被悄悄丢弃、不产生任何错误提示——这与 N3 对"原始 ch= 地址列表超 5 必须结构性拒绝,
  // 不能静默截断"的纪律不一致(虽然这里不产生资金风险, 第 6 环的人只是没被用上、不会被错发给别人,
  // 但既然一条路径定了"拒绝不截断", 平行路径也该同一个标准, 不是接受了却当没发生过)。
  if (entries.length > MAX_CHANNELS) {
    return { ok: false, chainDigest: Buffer.alloc(32, 0), channelSpks: [], reason: `verifyChain: 签名链长度 ${entries.length} > 上限 ${MAX_CHANNELS}, 结构性拒绝(同 N3 对原始 ch= 地址列表的纪律, 不静默截断)` };
  }
  let d = chainDigest0(quote, network);
  for (let k = 1; k <= entries.length; k++) {
    const e = entries[k - 1];
    if (e.position !== k) return { ok: false, chainDigest: d, channelSpks: [], reason: `verifyChain: 位置不连续, 期望 ${k} 实际 ${e.position}` };
    const msg = chainMessageBytes(d, k, Buffer.from(e.address_spk), Buffer.from(e.signing_pubkey));
    const valid = verifyMessage({ message: msg.toString('hex'), signature: e.sig, publicKey: Buffer.from(e.signing_pubkey).toString('hex') });
    if (!valid) return { ok: false, chainDigest: d, channelSpks: [], reason: `verifyChain: 第 ${k} 环签名校验失败` };
    d = Buffer.from(blake2b(msg, { dkLen: 32 }));
  }
  return { ok: true, chainDigest: d, channelSpks: entries.map(e => Buffer.from(e.address_spk)) };
}

// ──────────────────────────────────────────────────────────────────────────
// §3.3 渠道预先公开订单地址声明(SHOULD, 本轮扩展覆盖多渠道截断场景——NWT 2026-09-27T09-22Z ③)
// ──────────────────────────────────────────────────────────────────────────

/** signOrderAddressClaim — 渠道在自己那个槽位签一条"基于这份 quote + 我这一环之前的链条摘要 +
 * 我的地址, 算出的订单地址应该是 X"的声明, 公开发布。
 * 🔴 SHOULD 落地(NWT 2026-09-27T09-22Z ③): 这条机制对多渠道截断场景同样有效, 而且是目前唯一
 * 能让消费者在付款前发现"截断"的手段——任何一个被截断的渠道(比如设计稿举例的 D)如果提前公开声明
 * 过"经过我这一环时订单地址应该是 Y", 而结账页展示的是缺了 D 之后重算出的更短前缀对应的地址 Y'
 * (Y≠Y'), 任何看过 D 声明的人一眼就能发现不对——机制本身不需要新代码(逐字复用 §3.2 的地址推导
 * 确定性论证), 只是把"位置(渠道在链条里的第几环)"也编入声明内容, 使声明本身能精确对应"截断发生在
 * 哪一环之后"这个具体场景, 不只是笼统的"我的地址被换了"。
 * 🔴 同一批 NWT 意见也点名: unfilled_channel_slot_fold_to 默认回流给 provider 时, 若 provider 又是
 * 结账页实际运营方, 构成真实自我交易动机——这条不是签名链能挡住的(§3.4.4 已如实说明截断是允许的
 * 归因政策), 唯一能让消费者提前发现的正是本函数——调用方(配置页/文档)应提示: 选 provider 兜底就是
 * 接受这份潜在质疑, 这是商家的知情产品选择(同 §6.4 已有的"不要求押金是商家的知情选择"同一种诚实
 * 标注写法), 不是新发明。
 */
export function signOrderAddressClaim(channelPrivKeyHex, quoteHash32, position, channelAddrSpk, orderAddress) {
  const priv = new PrivateKey(channelPrivKeyHex);
  const msg = Buffer.concat([quoteHash32, Buffer.from([position & 0xff]), channelAddrSpk, Buffer.from(orderAddress, 'utf8')]);
  const sig = signMessage({ message: msg.toString('hex'), privateKey: priv });
  return sig;
}

export function verifyOrderAddressClaim(channelPubkeyHex, quoteHash32, position, channelAddrSpk, orderAddress, sigHex) {
  const msg = Buffer.concat([quoteHash32, Buffer.from([position & 0xff]), channelAddrSpk, Buffer.from(orderAddress, 'utf8')]);
  try { return !!verifyMessage({ message: msg.toString('hex'), signature: sigHex, publicKey: channelPubkeyHex }); }
  catch { return false; }
}

// ──────────────────────────────────────────────────────────────────────────
// §6.4 未归因份额并入指定方 — resolveRulesForOrder
// 🔴 MUST 落地(NWT 2026-09-27T09-22Z ②, 唯一一条新 MUST): channelAddrs 喂给本函数的输入
// 只能、必须来自 verifyChain 验证通过之后的 entries[].address_spk——不接受任何"单独提供的、
// 未经签名链背书的地址列表"这种输入形态。本函数因此不再像 v0.1-v0.4 设计稿伪代码那样接受一个
// 裸的 channelAddrs 数组参数, 而是只接受 verifyChain() 的返回值本身(verifiedChain), 从源头堵死
// "展示一条真实合法的签名链, 但实际用来构造订单的地址列表换成完全不同的另一批"这种"签名链沦为
// 装饰品"的攻击面(NWT 原话: 这比根本没有签名链更危险, 因为它制造虚假的信任感)。
// 无签名链的报价(require_channel_deposit:false 且商家允许"无签名链、纯地址列表"更简单旧式链接,
// 设计稿 §3.4 NWT 建议②的第二种支持形态)必须显式传 { ok:true, channelSpks:[...] }(调用方自己构造,
// 不经 verifyChain)并设置 allowUnsignedChannelAddrs:true——默认不允许, 防止调用方不小心把"未验证
// 的原始 ch= 列表"当成已验证的传进来。
// ──────────────────────────────────────────────────────────────────────────

export function resolveRulesForOrder(quote, verifiedChain, opts = {}) {
  if (!verifiedChain || verifiedChain.ok !== true) {
    if (!opts.allowUnsignedChannelAddrs) {
      throw new Error('resolveRulesForOrder: 第二个参数必须是 verifyChain() 的成功返回值(ok:true)——channelAddrs 与签名链必须同源, 不接受未经验证的地址列表(NWT MUST, 2026-09-27T09-22Z ②)。若这份报价确实允许无签名链的旧式链接, 显式传 opts.allowUnsignedChannelAddrs=true 并自行保证 verifiedChain.channelSpks 的来源可信');
    }
  }
  const channelSpks = verifiedChain.channelSpks || [];
  const roles = quote.canonical_rules.roles.map(r => ({ ...r }));
  const payoutSpks = new Map(); // role.name -> Buffer(full spk)
  // 🔴 实现期发现(同 stripProviderAddressForFeeSplit 头注同一族问题, 未在设计稿出现): fee-split.mjs
  // 的 HEX64 校验(role.address 必须恰好 64 个 hex 字符 = 32 字节裸 pubkey)不只管 provider, 对
  // **所有**非 optional/非 derive 的具名角色一视同仁——本设计的报价里 broker(以及任何商家自定义的
  // 固定角色)带的是真实 kaspa 地址字符串(bech32, ~63 字符, 不是 64 hex 字符的裸 pubkey), 逐字节格式
  // 不满足这条正则, 直接会被拒。修法与 provider 同一套: 真实地址进 payoutSpks side-table, 喂给
  // validateFeeRules/feeSplit 的 address 字段一律换成占位值(§6.2 任意地址类型因此从不流经
  // fee-split.mjs 的地址校验, 那条校验对它的原设计意图本来就不适用)。
  for (const r of roles) {
    if (r.name === 'provider') { payoutSpks.set(r.name, spkBytesFromAddress(r.address)); continue; }
    if (!r.name.startsWith('channel_')) {
      if (r.address) { payoutSpks.set(r.name, spkBytesFromAddress(r.address)); r.address = '00'.repeat(32); }
      continue;
    }
  }
  for (let i = 0; i < MAX_CHANNELS; i++) {
    const slotName = `channel_${i + 1}`;
    const role = roles.find(r => r.name === slotName);
    if (!role) continue; // 报价本身没声明这个槽位
    if (channelSpks[i]) {
      payoutSpks.set(slotName, channelSpks[i]);
      delete role.fold_to;
      role.address = '00'.repeat(32); // 占位: 真实地址通过 payoutSpks 单独带出, feeRules 里的 address 只用于满足 validateFeeRules 的"非 optional 必有 address"约束, 不作为付款目标(付款目标见下方 finalize 阶段的 payoutSpks 查表)
    } else {
      const target = roles.find(x => x.name === role.fold_to);
      target.bps += role.bps;
      roles.splice(roles.indexOf(role), 1);
    }
  }
  const resolvedRoles = { schema_v: quote.canonical_rules.schema_v, roles };
  const rolesForFeeSplit = stripProviderAddressForFeeSplit(roles);
  const feeRulesForSplit = { schema_v: quote.canonical_rules.schema_v, roles: rolesForFeeSplit };
  validateFeeRules(feeRulesForSplit, { providerMinBps: opts.providerMinBps, roleMaxBps: opts.roleMaxBps });
  const priceSompi = BigInt(quote.price_sompi);
  const providerPlaceholder = '11'.repeat(32);
  const result = feeSplit(feeRulesForSplit, priceSompi, [{ pk: providerPlaceholder, stake: 1 }]);
  if (result.degenerate) throw new Error('resolveRulesForOrder: feeSplit degenerate(不应发生, provider 恒为唯一 winner)');
  // 🔴 顺序与角色名映射: 不靠比较 feeSplit 返回的占位 pk(所有角色的 address 字段在本函数里都被替换成
  // 同一个不带信息的占位值, 用于满足 validateFeeRules"非 optional 必有 address"这条 schema 约束——
  // 占位值本身不能用来反查是哪个角色, 逐字节比较占位 hex 永远相等, 会把所有角色错误地归并成一个)。
  // 正确的角色名来源是 deriveRoleFeeLeaves 内部保留、feeSplit 顶层 result.feeLeaves 原样透传的 `type`
  // 字段(注意不是 result.payoutLeaves——那个数组的构造过程里 type 字段被裁掉了, 只剩 pk/amount)。
  // 输出顺序 = provider(result.winners[0], 唯一 winner)在前, 其余按 deriveRoleFeeLeaves 的 role-name
  // 字典序——这是本实现选定的确定性顺序, 任何人拿同一份 resolvedRoles 独立算都得到同一顺序
  // (D-025"地址可推导"判据的直接延伸), 与合约 ctor 的 role1..role7 槽位顺序一一对应。
  const finalRoles = [
    { name: 'provider', amountSompi: BigInt(result.winners[0].amount), spk: payoutSpks.get('provider') },
    ...result.feeLeaves.map(l => ({ name: l.type, amountSompi: BigInt(l.amount), spk: payoutSpks.get(l.type) })),
  ];
  for (const fr of finalRoles) {
    if (!fr.spk) throw new Error(`resolveRulesForOrder: 角色 ${fr.name} 没有解析出 scriptPubKey(内部一致性检查失败)`);
  }
  return { roles: resolvedRoles, payoutLeaves: finalRoles };
}

// ──────────────────────────────────────────────────────────────────────────
// 合约协议: createCommissionSplitProtocol / buildCommissionSplitTx / buildCommissionRefundTx
// ──────────────────────────────────────────────────────────────────────────

const ctorBool = (b) => ({ kind: 'bool', value: !!b });
const ctorBytesN = (buf) => ({ kind: 'bytes', value: [...(Buffer.isBuffer(buf) ? buf : Buffer.from(buf))] });

/**
 * @param {object} cfg
 * @param {string} cfg.network
 * @param {{amountSompi:bigint, spk:Buffer}[]} cfg.finalRoles 1-7 个, finalRoles[0] 必须是 provider
 * @param {string} cfg.payerRefundAddress
 * @param {number} [cfg.deadlineMs]
 * @param {bigint|string} cfg.maxSplitFeeSompi
 * @param {bigint|string} cfg.maxRefundFeeSompi
 * @param {string} [cfg.ruleCommitHex] 32B hex, = computeFeeRulesCommit(resolvedRoles)
 * @param {string} [cfg.channelChainCommitmentHex] 32B hex, = verifyChain(...).chainDigest(O1)
 */
export function createCommissionSplitProtocol(cfg) {
  const roles = cfg.finalRoles;
  if (roles.length < 1 || roles.length > MAX_ROLES) throw new Error(`createCommissionSplitProtocol: finalRoles.length=${roles.length} 必须在 1-${MAX_ROLES}`);
  // ServiceEscrow 控制台签名路径(施工期发现)重建下游 CommissionSplit 时要跟建单那一刻的地址完全对上,
  // orderNonce/deadlineMs 若各自重新随机/取"现在"会算出不同地址——支持显式传入以便确定性重建。
  const orderNonce = cfg.orderNonceHex ? Buffer.from(cfg.orderNonceHex, 'hex') : randomBytes(16);
  if (cfg.orderNonceHex && orderNonce.length !== 16) throw new Error(`createCommissionSplitProtocol: orderNonceHex 必须是 16 字节 hex, 实际 ${orderNonce.length} 字节`);
  const deadlineMs = cfg.deadlineMs != null ? Number(cfg.deadlineMs) : (Date.now() + DEFAULT_DEADLINE_MS);
  const ruleCommit = cfg.ruleCommitHex ? Buffer.from(cfg.ruleCommitHex, 'hex') : Buffer.alloc(32, 0);
  const chainCommit = cfg.channelChainCommitmentHex ? Buffer.from(cfg.channelChainCommitmentHex, 'hex') : Buffer.alloc(32, 0);
  const refundSpk = spkBytesFromAddress(cfg.payerRefundAddress);

  const ctorParams = [ctorIntV100(roles.length)];
  for (let i = 0; i < MAX_ROLES; i++) {
    const r = roles[i];
    if (r) { ctorParams.push(ctorBytesN(padSpk37(r.spk)), ctorIntV100(r.spk.length), ctorIntV100(r.amountSompi)); }
    else { ctorParams.push(ctorBytesN(Buffer.alloc(37, 0)), ctorIntV100(0), ctorIntV100(0)); }
  }
  ctorParams.push(ctorBytesN(padSpk37(refundSpk)), ctorIntV100(refundSpk.length));
  ctorParams.push(ctorIntV100(BigInt(deadlineMs)));
  ctorParams.push(ctorIntV100(BigInt(cfg.maxSplitFeeSompi)));
  ctorParams.push(ctorIntV100(BigInt(cfg.maxRefundFeeSompi)));
  ctorParams.push(ctorBytesN(ruleCommit));
  ctorParams.push(ctorBytesN(chainCommit));
  ctorParams.push(ctorBytesN(orderNonce));

  const compiled = compileSilV100(SIL_PATH, ctorParams, CONTRACT_NAME);
  const redeemScript = Buffer.from(compiled.script);
  const spk = kaspa.payToScriptHashScript(new Uint8Array(redeemScript));
  const address = addressFromScriptPublicKey(spk, cfg.network).toString();

  return {
    ctorParams, redeemScriptHex: redeemScript.toString('hex'), address, orderNonceHex: orderNonce.toString('hex'),
    entries: compiled._raw.contracts[CONTRACT_NAME].entries,
    deadlineMs, roles, refundSpk, roleCount: roles.length,
    maxSplitFeeSompi: BigInt(cfg.maxSplitFeeSompi), maxRefundFeeSompi: BigInt(cfg.maxRefundFeeSompi),
  };
}

export function computeCommissionOrderAddress(cfg) { return createCommissionSplitProtocol(cfg).address; }

function buildEntrySigScriptHex(entryAbi, argsByName, redeemScriptHex) {
  const actionHex = encodeEntryActionGeneric(kaspa, entryAbi, argsByName);
  return combineActionAndRedeem(kaspa, actionHex, Buffer.from(redeemScriptHex, 'hex')).toString('hex');
}

// 🔴 实现期真实发现(simnet 广播坐实, 非猜测): `spkBytesFromAddress` 返回的是【完整】序列化
// scriptPubKey(2 字节 version LE ‖ script)——这正是合约内 `tx.outputs[i].scriptPubKey` 读到的、
// 也是 ctor 要烤的那个值(§6.2 已验证)。但 kaspa-wasm 构造 `TransactionOutput` 时,
// `new ScriptPublicKey(version, scriptHex)` 要的是**拆开**的两个字段(数字 version + 不含 version
// 前缀的纯 script hex)——直接把完整字节整体当 scriptHex 传、version 又传 0, 会在这两字节 version
// 前缀之外再拼一次错误的空 version, 产出的输出脚本形状错误, 广播时被 kaspad 判"non-standard script
// form"拒绝(T1/T2/T3/T6 初版实测踩过, 已修)。同 InstantSplit 既有 p2pkScriptPubKeyHexFromPubkey 的
// 处理方式(那里从不整体传完整字节, 一直只传 script 部分)——这里补齐同一条纪律。
function mkSpkOut(value, spk) {
  const version = spk[0] | (spk[1] << 8);
  const scriptOnly = spk.subarray(2);
  return new TransactionOutput(value, new ScriptPublicKey(version, scriptOnly.toString('hex')));
}

export function buildCommissionSplitTx(protocol, fundingUtxo) {
  const inputAmt = BigInt(fundingUtxo.amountSompi);
  const recipientsTotal = protocol.roles.reduce((a, r) => a + r.amountSompi, 0n);
  if (inputAmt < recipientsTotal) throw new Error(`buildCommissionSplitTx: 资金不足(${inputAmt} < ${recipientsTotal})`);
  const excess = inputAmt - recipientsTotal;
  const hasChange = excess > protocol.maxSplitFeeSompi;

  const outs = protocol.roles.map(r => mkSpkOut(r.amountSompi, r.spk));
  let changeSompi = 0n;
  if (hasChange) {
    const realFeeReserve = 4_000_000n;
    changeSompi = excess - (realFeeReserve <= protocol.maxSplitFeeSompi ? realFeeReserve : protocol.maxSplitFeeSompi);
    outs.push(mkSpkOut(changeSompi, protocol.refundSpk));
  }
  const sigScriptHex = buildEntrySigScriptHex(protocol.entries.split, { hasChange }, protocol.redeemScriptHex);
  const tx = new Transaction({
    version: 1,
    inputs: [{ previousOutpoint: { transactionId: fundingUtxo.transactionId, index: fundingUtxo.index }, signatureScript: sigScriptHex, sequence: 0n, sigOpCount: 0, computeBudget: 70 }],
    outputs: outs, lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '',
  });
  return { tx, hasChange, changeSompi };
}

export const PMT_LAG_GUIDANCE = 'PMT(节点 virtual_past_median_time)判据同 instant-split-sdk.mjs——buildCommissionRefundTx 要求调用方现查节点 PMT, 不接受 Date.now() 或 tip 时间戳(同一份推导, 不重复, 见 docs/2026-09-27-j2-instant-split-covenant-template-design-v0.2.md §4.6)。';

export function buildCommissionRefundTx(protocol, fundingUtxo, currentPmtMs, safetyMarginMs = 5000) {
  if (currentPmtMs < protocol.deadlineMs + safetyMarginMs) {
    throw new Error(`buildCommissionRefundTx: 还没到期(currentPmtMs=${currentPmtMs} < deadline+margin=${protocol.deadlineMs + safetyMarginMs}); ${PMT_LAG_GUIDANCE}`);
  }
  const inputAmt = BigInt(fundingUtxo.amountSompi);
  const smallRealFee = protocol.maxRefundFeeSompi < 1_100_000n ? protocol.maxRefundFeeSompi : 1_100_000n;
  const outValue = inputAmt - smallRealFee;
  const outs = [mkSpkOut(outValue, protocol.refundSpk)];
  const sigScriptHex = buildEntrySigScriptHex(protocol.entries.refund, {}, protocol.redeemScriptHex);
  const tx = new Transaction({
    version: 1,
    inputs: [{ previousOutpoint: { transactionId: fundingUtxo.transactionId, index: fundingUtxo.index }, signatureScript: sigScriptHex, sequence: 0n, sigOpCount: 0, computeBudget: 70 }],
    outputs: outs, lockTime: BigInt(protocol.deadlineMs), gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '',
  });
  return { tx, outValue };
}

// ──────────────────────────────────────────────────────────────────────────
// D-034 §9 服务订单托管: createServiceEscrowProtocol(J2, 2026-09-28; Owner 2026-09-28 批 v0.2
// 修订, 设计稿 docs/2026-09-28-j2-service-order-escrow-design-v0.2.md, Bettor 二次零 MUST 施工令)。
//
// v0.2 建议-3(不复制 CommissionSplit 的 N 角色 require): buyer_confirm 整笔转给一个【先单独用
// createCommissionSplitProtocol() 算好的下游实例】——本函数第一步就是调它, `payer_refund_pk` 设成
// 买家地址(Bettor 二次批复原话"两跳里 CommissionSplit 的 payer_refund_pk 设为买家"——万一下游那份
// CommissionSplit 自己的角色表验证出问题, 它自己的 refund() 出口退的是买家, 不是卡死或退错人)。
// ServiceEscrow 本体因此不再持有角色表, 只烤三个地址(下游 CommissionSplit 地址 / 买家退款地址 /
// 服务方 timeout 直付地址)+ 到期分法 bps + 到期 DAA 分数(建议-4)。
// ──────────────────────────────────────────────────────────────────────────

export const SERVICE_ESCROW_CONTRACT_NAME = 'ServiceEscrow';
export const SERVICE_ESCROW_SIL_PATH = new URL('./sil-v1/ServiceEscrow.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:');

export const MAINNET_BPS = 10; // 主网目标出块率(Bettor 给的数字, 72h=259200s×10=2,592,000 DAA 已核对)
export const SERVICE_ESCROW_DEFAULT_TIMEOUT_BUYER_BPS = 9900; // 默认买家 99%(设计稿 MUST-1)
export const SERVICE_ESCROW_DEFAULT_DEADLINE_HOURS = 72; // 同 DEFAULT_DEADLINE_MS 的小时数, 改用 DAA 后仍是同一个默认值

/** hoursToDaa — 建议-4: 报价写小时(人类可读), 换算成 DAA 分数增量(不是绝对分数, 调用方自己加上
 * currentDaaScore)。命名常量 MAINNET_BPS, 不是魔法数字。 */
export function hoursToDaa(hours) {
  return Math.round(Number(hours) * 3600 * MAINNET_BPS);
}

// 🔴 MUST-2(设计稿): 最小托管订单额按 KIP-9 storage mass 实测(simnet 接主网 v2.0.1 参数)。
// 🔴 v1 版本(已作废, 如实记录): 第一次实测用了 kaspa-wasm 高层 Generator/PaymentOutput API 广播,
// 三次独立跑同一个二分法测出 buyer_confirm 边界在 ~10M/~30M/<10M sompi 间漂移, 当时误判成"mempool
// 聚合预算随拥堵波动"——Bettor 读 rusty-kaspa 源码指出真根因: Generator 内部(wallet/core/src/tx/
// generator/generator.rs:973)用的是 wallet SDK 自己客户端本地的 MAXIMUM_STANDARD_TRANSACTION_MASS
// =100_000(wallet/core/src/tx/mass.rs:25)当门槛, 比节点真实 prior_block_mass_limits.storage=
// 500_000(consensus/core/src/config/params.rs:698)严 5 倍, 且 Generator 内部"要不要留找零/找零是否
// 吸收进手续费"是启发式分支(同一 generator.rs:915-966), 同一候选值因矿工 UTXO 选取细节不同走不同
// 内部分支——量的是钱包 SDK 自己会摇摆的本地上限, 不是链上真判据, "漂移"是假象。
// v2(本次): 绕开 Generator, 手搓 Transaction 直接 rpc.submitTransaction(同 spendEntry 手法), storage
// mass 公式复用 kasia-console/src/lib/proto-mass-ceiling.mjs 的 calcStorageMassExact/utxoPlurality
// (rusty-kaspa consensus/core/src/mass/mod.rs 逐行移植, NWT 已核对节点 8/8 逐位吻合, D-031 不重造)。
// 脚本: kasia-console/scratch/_j2_service_escrow_simnet_test/storage_mass_binary_search_v2.mjs——
// 每个候选值先打印公式预测 storage mass, 再真实广播, 原样贴节点拒绝消息("transaction storage mass
// of N is larger than max allowed size of 500000", 真实节点报文, 不是钱包 SDK 那句假话)。
// 公式预测与节点实况【全程逐点吻合】(二分法收敛路径上每一步都核对过, 唯一"不吻合"是本脚本自己用严格
// `<` 而节点实际是`>`拒绝的边界等号写法差异, 不是公式错——mass 恰好=500000 时节点放行)。
// 实测(用巨额矿工 UTXO 当输入, 让 input 侧调和项趋近 0, 是【偏保守】的度量——真实 buyer_confirm 的
// input≈output 量级接近, 调和差会进一步抵消, 真实 mass 只会更低, 不会更高):
//   buyer_confirm 单输出下限 = 1,999,201 sompi(≈0.02 KAS, 与 Bettor 手算 C/500000≈2,000,000 几乎重合)
//   timeout_default(9900bps) amountAfterFee 下限 = 201,939,100 sompi(≈2.02 KAS, 与 Bettor "≳2 KAS
//   量级"手算重合)
// 下面两个常量 = 实测值 + 安全余量(不再是"漂移读数硬凑", 是精确测出来再留余量):
export const SERVICE_ESCROW_MIN_BUYER_CONFIRM_SOMPI = 2_500_000n; // 0.025 KAS(实测下限 1,999,201 + ~25% 余量)
export const SERVICE_ESCROW_MIN_TIMEOUT_DEFAULT_SOMPI = 250_000_000n; // 2.5 KAS(amountAfterFee, 9900bps 下实测 201,939,100 + ~24% 余量)

/**
 * MUST-2 下限校验(供控制台/结账页在真正建单前调用, 挡在"广播了才发现 storage mass 拒绝"前面)。
 * @param {bigint|string} priceSompi 订单总价(即将充值进 escrow 的金额)
 * @param {bigint|string} maxRefundFeeSompi 跟 createServiceEscrowProtocol 传的必须一致
 * @param {number} [timeoutBuyerBps] 默认 9900——非默认值时 SERVICE_ESCROW_MIN_TIMEOUT_DEFAULT_SOMPI 这个
 *   实测数字不保真(只在 9900bps 下测过), 会退化成"按总额比例粗略换算", 仅供参考不是真实测值
 */
export function validateServiceEscrowMinAmount(priceSompi, maxRefundFeeSompi, timeoutBuyerBps) {
  const price = BigInt(priceSompi);
  const maxRFee = BigInt(maxRefundFeeSompi);
  const bps = timeoutBuyerBps != null ? Number(timeoutBuyerBps) : SERVICE_ESCROW_DEFAULT_TIMEOUT_BUYER_BPS;
  const amountAfterFee = price - maxRFee;
  if (amountAfterFee <= 0n) return { ok: false, reason: `订单总价(${price})不够扣 max_refund_fee(${maxRFee})` };
  if (amountAfterFee < SERVICE_ESCROW_MIN_TIMEOUT_DEFAULT_SOMPI) {
    return { ok: false, reason: `amountAfterFee=${amountAfterFee} 低于 timeout_default 实测下限 ${SERVICE_ESCROW_MIN_TIMEOUT_DEFAULT_SOMPI}(9900bps 口径${bps !== 9900 ? ', 当前 bps=' + bps + ' 非默认值, 该下限仅供参考' : ''})` };
  }
  return { ok: true };
}

// 建议-5: 1% 取整公式(合约/SDK/结账页三处同式, 这里是 SDK 侧的权威实现, 供预览/校验/测试断言共用,
// 不是各处各写一份)。amountAfterFee 由调用方传入(= totalIn - max_r_fee, 先扣固定网络费上限)。
export function computeTimeoutSplit(amountAfterFeeSompi, timeoutBuyerBps) {
  const amt = BigInt(amountAfterFeeSompi);
  const providerCut = amt * BigInt(10000 - Number(timeoutBuyerBps)) / 10000n;
  const buyerAmt = amt - providerCut;
  return { providerCut, buyerAmt };
}

/**
 * @param {object} cfg
 * @param {string} cfg.network
 * @param {{amountSompi:bigint, spk:Buffer}[]} cfg.finalRoles 下游 CommissionSplit 的角色表(§8 现成产出, 原样转交)
 * @param {string} cfg.buyerRefundAddress 买家地址——同时是(a)下游 CommissionSplit 的 payerRefundAddress(建议-3),
 *   (b) ServiceEscrow 本体 provider_cancel/timeout_default 的买家收款地址
 * @param {string} cfg.providerPayoutAddress 服务方直付地址(timeout_default 那份 1% 直接付, 不经下游 CommissionSplit)
 * @param {number} cfg.currentDaaScore 现查节点 getBlockDagInfo().virtualDaaScore(建议-4, 不本地算)
 * @param {number} [cfg.deadlineHours] 默认 72(SERVICE_ESCROW_DEFAULT_DEADLINE_HOURS)
 * @param {number} [cfg.deadlineDaa] 显式指定绝对 DAA 分数(优先于 deadlineHours, 供测试用小到期窗口)
 * @param {bigint|string} cfg.maxSplitFeeSompi
 * @param {bigint|string} cfg.maxRefundFeeSompi
 * @param {number} [cfg.timeoutBuyerBps] 默认 9900(设计稿 MUST-1)
 * @param {string} cfg.buyerPubkeyHex 32B x-only pubkey hex(买家 relay 的, 同 D-035 /api/relay/:id/pubkey 派生方式)
 * @param {string} cfg.providerPubkeyHex 32B x-only pubkey hex(服务方 relay 的, 同上)
 */
export function createServiceEscrowProtocol(cfg) {
  if (!cfg.buyerPubkeyHex || !/^[0-9a-fA-F]{64}$/.test(cfg.buyerPubkeyHex)) throw new Error('createServiceEscrowProtocol: buyerPubkeyHex 必须是 32 字节 hex');
  if (!cfg.providerPubkeyHex || !/^[0-9a-fA-F]{64}$/.test(cfg.providerPubkeyHex)) throw new Error('createServiceEscrowProtocol: providerPubkeyHex 必须是 32 字节 hex');
  const timeoutBuyerBps = cfg.timeoutBuyerBps != null ? Number(cfg.timeoutBuyerBps) : SERVICE_ESCROW_DEFAULT_TIMEOUT_BUYER_BPS;
  if (!(timeoutBuyerBps >= 0 && timeoutBuyerBps <= 10000)) throw new Error(`createServiceEscrowProtocol: timeoutBuyerBps=${timeoutBuyerBps} 必须在 0-10000`);
  // currentDaaScore 只在需要"现在推算 deadlineDaa"时才必须现查节点传入(建议-4)——deadlineDaa 显式给出时
  // (控制台签名路径重建已有订单的场景)不需要, 那个值早就定死了, 不该再依赖"现在几点"。
  if (cfg.currentDaaScore == null && cfg.deadlineDaa == null) throw new Error('createServiceEscrowProtocol: currentDaaScore 必须现查节点传入(建议-4, 不接受本地算的近似值), 或者直接给 deadlineDaa');

  // 控制台签名路径(施工期发现): buyer_confirm/provider_cancel/timeout_default 广播时要重新算出跟建单
  // 那一刻完全相同的 redeemScriptHex/地址(否则签名对不上真实链上那笔合约)——但 orderNonce/下游
  // CommissionSplit 自己的 orderNonce/deadlineMs 若每次都随机生成或取"现在", 同样的其余参数也会算出
  // 不同地址。V1 无状态(不加新表, Owner"跑通最重要"派工), 调用方(控制台 API)必须把建单时返回的
  // orderNonceHex/commissionDeadlineMs 原样传回来才能重建出同一份合约; 不传时保持原行为(随机/取现在,
  // 建单场景)。两份 nonce 共用同一个随机源(同一个 16 字节), 不是各自独立随机——够用, 不是同一份合约
  // 内部复用引发碰撞风险(两个是不同合约实例)。
  const orderNonce = cfg.orderNonceHex ? Buffer.from(cfg.orderNonceHex, 'hex') : randomBytes(16);
  if (cfg.orderNonceHex && orderNonce.length !== 16) throw new Error(`createServiceEscrowProtocol: orderNonceHex 必须是 16 字节 hex, 实际 ${orderNonce.length} 字节`);
  const commissionDeadlineMs = cfg.commissionDeadlineMs != null ? Number(cfg.commissionDeadlineMs) : (Date.now() + DEFAULT_DEADLINE_MS);

  // ① 下游 CommissionSplit 实例——角色分账全部交给它, payer_refund_pk = 买家(设计稿建议-3/Bettor 二次批复)
  const commissionProtocol = createCommissionSplitProtocol({
    network: cfg.network, finalRoles: cfg.finalRoles, payerRefundAddress: cfg.buyerRefundAddress,
    maxSplitFeeSompi: cfg.maxSplitFeeSompi, maxRefundFeeSompi: cfg.maxRefundFeeSompi,
    ruleCommitHex: cfg.ruleCommitHex, channelChainCommitmentHex: cfg.channelChainCommitmentHex,
    orderNonceHex: orderNonce.toString('hex'), deadlineMs: commissionDeadlineMs,
  });

  const deadlineDaa = cfg.deadlineDaa != null ? Number(cfg.deadlineDaa) : (Number(cfg.currentDaaScore) + hoursToDaa(cfg.deadlineHours ?? SERVICE_ESCROW_DEFAULT_DEADLINE_HOURS));
  const ruleCommit = cfg.ruleCommitHex ? Buffer.from(cfg.ruleCommitHex, 'hex') : Buffer.alloc(32, 0);
  const chainCommit = cfg.channelChainCommitmentHex ? Buffer.from(cfg.channelChainCommitmentHex, 'hex') : Buffer.alloc(32, 0);
  const commissionSpk = spkBytesFromAddress(commissionProtocol.address);
  const buyerRefundSpk = spkBytesFromAddress(cfg.buyerRefundAddress);
  const providerPayoutSpk = spkBytesFromAddress(cfg.providerPayoutAddress);

  const ctorParams = [
    ctorBytesN(padSpk37(commissionSpk)), ctorIntV100(commissionSpk.length),
    ctorBytesN(padSpk37(buyerRefundSpk)), ctorIntV100(buyerRefundSpk.length),
    ctorBytesN(padSpk37(providerPayoutSpk)), ctorIntV100(providerPayoutSpk.length),
    ctorIntV100(BigInt(deadlineDaa)),
    ctorIntV100(BigInt(cfg.maxSplitFeeSompi)),
    ctorIntV100(BigInt(cfg.maxRefundFeeSompi)),
    ctorIntV100(timeoutBuyerBps),
    ctorBytesN(ruleCommit), ctorBytesN(chainCommit), ctorBytesN(orderNonce),
    ctorBytesN(Buffer.from(cfg.buyerPubkeyHex, 'hex')), ctorBytesN(Buffer.from(cfg.providerPubkeyHex, 'hex')),
  ];

  const compiled = compileSilV100(SERVICE_ESCROW_SIL_PATH, ctorParams, SERVICE_ESCROW_CONTRACT_NAME);
  const redeemScript = Buffer.from(compiled.script);
  const spk = kaspa.payToScriptHashScript(new Uint8Array(redeemScript));
  const address = addressFromScriptPublicKey(spk, cfg.network).toString();

  return {
    ctorParams, redeemScriptHex: redeemScript.toString('hex'), address, orderNonceHex: orderNonce.toString('hex'),
    commissionDeadlineMs, // 控制台签名路径重建订单必须原样带回这个 + orderNonceHex, 否则算出的地址对不上
    entries: compiled._raw.contracts[SERVICE_ESCROW_CONTRACT_NAME].entries,
    deadlineDaa, timeoutBuyerBps,
    commissionSplitProtocol: commissionProtocol, commissionSpk, buyerRefundSpk, providerPayoutSpk,
    buyerPubkeyHex: cfg.buyerPubkeyHex, providerPubkeyHex: cfg.providerPubkeyHex,
    maxSplitFeeSompi: BigInt(cfg.maxSplitFeeSompi), maxRefundFeeSompi: BigInt(cfg.maxRefundFeeSompi),
  };
}

export function computeServiceEscrowOrderAddress(cfg) { return createServiceEscrowProtocol(cfg).address; }

// ──────────────────────────────────────────────────────────────────────────
// §7 渠道押金 covenant
// ──────────────────────────────────────────────────────────────────────────

export function createChannelDepositProtocol(cfg) {
  const priv = new PrivateKey(cfg.depositorPrivKeyHex);
  const pubXOnly = xOnlyPubkeyHexFromPrivateKey(priv);
  const maxWithdrawFee = BigInt(cfg.maxWithdrawFeeSompi ?? 2_000_000n);
  const ctorParams = [{ kind: 'bytes', value: [...Buffer.from(pubXOnly, 'hex')] }, ctorIntV100(maxWithdrawFee)];
  const compiled = compileSilV100(DEPOSIT_SIL_PATH, ctorParams, DEPOSIT_CONTRACT_NAME);
  const redeemScript = Buffer.from(compiled.script);
  const spk = kaspa.payToScriptHashScript(new Uint8Array(redeemScript));
  const address = addressFromScriptPublicKey(spk, cfg.network).toString();
  return { ctorParams, redeemScriptHex: redeemScript.toString('hex'), address, entries: compiled._raw.contracts[DEPOSIT_CONTRACT_NAME].entries, depositorPubXOnlyHex: pubXOnly, maxWithdrawFee, depositorPrivKeyHex: cfg.depositorPrivKeyHex };
}

/** xOnlyPubkeyHexFromPrivateKey — InstantSplit/ChannelDeposit ctor 用的 32 字节 x-only pubkey
 * (合约内 new ScriptPubKeyP2PK 现场构造用的同一种编码), 与 §3.4 签名链用的 33 字节压缩公钥
 * (PublicKey.toString())是两种不同编码, 不能混用——真实验证见 scratch/_j2_commission_impl_research/spk_lengths.mjs
 * (P2PK scriptPubKey = 0x20‖32字节x-only‖0xac)。*/
function xOnlyPubkeyHexFromPrivateKey(priv) {
  const addr = priv.toPublicKey().toAddress('mainnet');
  const spk = payToAddressScript(addr);
  const scriptBuf = Buffer.from(spk.script, 'hex');
  return scriptBuf.subarray(1, 33).toString('hex');
}

export async function checkChannelDeposit(rpc, depositAddress, minDepositSompi) {
  const { entries } = await rpc.getUtxosByAddresses({ addresses: [depositAddress] });
  const total = (entries || []).reduce((a, e) => a + BigInt(e.entry?.amount ?? e.amount ?? 0), 0n);
  return total >= BigInt(minDepositSompi);
}

export function buildChannelWithdrawTx(protocol, fundingUtxo) {
  // 🔴 实现期真实发现(simnet 坐实, 非猜测): ChannelDeposit.sil 的 `withdraw` 硬编码只认
  // `tx.outputs[0].scriptPubKey == byte[](new ScriptPubKeyP2PK(d_pk))`——即只能付回押金人自己
  // 那把 `d_pk` 对应的 P2PK 地址, 没有"付到任意地址"的自由度(同 §7.1 原话"只有押金人本人能取回",
  // 且合约没有额外的目的地参数)。早前版本的 SDK 接受一个调用方指定的任意 outputSpk 参数, 用真实
  // simnet 广播测试才发现无论签名对不对、只要目的地不是押金人自己的地址就一律"script ran, but
  // verification failed"(误以为是签名 bug, 实际是输出目的地 bug)——本函数不再接受目的地参数,
  // 内部直接算出押金人自己的 P2PK scriptPubKey。
  const inputAmt = BigInt(fundingUtxo.amountSompi);
  const outValue = inputAmt - protocol.maxWithdrawFee / 2n; // 留一半上限作真实矿工费, 小于 max_withdraw_fee 上限即可
  const depositorSpk = Buffer.concat([Buffer.from([0x20]), Buffer.from(protocol.depositorPubXOnlyHex, 'hex'), Buffer.from([0xac])]); // 与合约内 new ScriptPubKeyP2PK(d_pk) 同形(34B script, 未含版本前缀)
  const outs = [new TransactionOutput(outValue, new ScriptPublicKey(0, depositorSpk.toString('hex')))];
  const outpoint = { transactionId: fundingUtxo.transactionId, index: fundingUtxo.index };
  // 🔴 createInputSignature 需要知道被花 UTXO 的 value+scriptPubKey 才能算出正确 sighash(标准 UTXO
  // sighash 承诺前序输出内容)——input 对象必须带 utxo 字段, 同本仓既有真实签名调用点的约定
  // (proto-tx-assembly-settlement.mjs mkInput, 逐字同一种形状), 不是随便一个 previousOutpoint 就够。
  const depositSpk = new ScriptPublicKey(0, kaspa.payToScriptHashScript(new Uint8Array(Buffer.from(protocol.redeemScriptHex, 'hex'))).script);
  const unsignedTx = new Transaction({
    version: 1,
    inputs: [{ previousOutpoint: outpoint, signatureScript: '', sequence: 0n, sigOpCount: 0, computeBudget: 70, utxo: { outpoint, amount: inputAmt, scriptPublicKey: depositSpk, blockDaaScore: 0n } }],
    outputs: outs, lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '',
  });
  return { unsignedTx, outValue };
}

export function finalizeChannelWithdrawTx(protocol, unsignedTx, sigHex) {
  const sigScriptHex = buildEntrySigScriptHex(protocol.entries.withdraw, { s: sigHex }, protocol.redeemScriptHex);
  // 🔴 kaspa-wasm 的 tx.inputs 同 tx.outputs 一样是 getter, 每次读都是新数组快照(既有教训,
  // docs/2026-09-27-j2-instant-split-covenant-template-design 系列已踩过)——原地
  // unsignedTx.inputs[0].signatureScript=... 不影响真实交易对象, 必须重建。
  const in0 = unsignedTx.inputs[0];
  const newInputs = [{ previousOutpoint: in0.previousOutpoint, signatureScript: sigScriptHex, sequence: in0.sequence, sigOpCount: in0.sigOpCount, computeBudget: in0.computeBudget, utxo: in0.utxo }];
  return new Transaction({ version: unsignedTx.version, inputs: newInputs, outputs: unsignedTx.outputs, lockTime: unsignedTx.lockTime, gas: unsignedTx.gas, subnetworkId: unsignedTx.subnetworkId, payload: unsignedTx.payload });
}
