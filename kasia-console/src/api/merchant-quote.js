// merchant-quote.js — 控制台"商家建报价 / 生成推广链接"(Bettor 2026-10-02 派工第三步, Owner 2026-10-02 批)。
// 让不懂技术的人点几下就能出单: 选订单类型(即时分账 / 服务订单托管)、填价格、收款方与比例、渠道预算与
// 人数、有效期 → 签名报价 + 结账页链接 + 二维码。
//
// 只复用现成, 不另起报价格式/签名机制:
//   · 即时分账: 报价字段组装逐字对照 checkout-static/config.js(同一份 canonical_rules/渠道均分/余数并入 provider),
//     签名 = commission-plan-sdk.mjs signQuote(含 mass 可行性 MUST-1 与押金条款校验, 校验不过就拒绝产生签名);
//   · 服务订单托管: 直接内部调用既有 POST /api/service-escrow/quote(fastify.inject), 不复制其建单/签名逻辑;
//   · 角色金额拆分 = fee-split.mjs feeSplit(同 resolveRulesForOrder 的做法), 地址校验 = kaspa-network.mjs 单一源;
//   · 二维码 = checkout-static/vendor/qrcode-generator(同结账页 renderQrSvg 的用法)。
//
// 🔴 私钥(如实标注, 同既有先例): 签名需要商家私钥, 与 /api/service-escrow/quote 的 merchantPrivKeyHex、
//   checkout-static/resolver.mjs 的 /sign-quote 同形——私钥经本机 API 一次性传入、只在内存里签名、不落库、不写日志、
//   不回显。比"浏览器本地签名"(⑩ 票)弱, 页面上已明示"建议用专门生成的新钥匙"。本文件不读取/解密控制台里任何 relay 的存量私钥。
// 🔴 不碰链、不花钱、不需要开关闸: 纯计算(服务订单仅读一次节点 DAA)。支付币种目前只开放 KAS, KTT 待设计审过再接(预留字段)。
import * as kaspa from 'kaspa-wasm';
import {
  signQuote, verifyQuoteSignature, minOrderSompiForChannels,
} from '../lib/commission-plan-sdk.mjs';
import { feeSplit, validateFeeRules, PROVIDER_MIN_BPS, ROLE_MAX_BPS } from '../lib/fee-split.mjs';
import { configuredNetwork, assertAddressOnNetwork } from '../lib/kaspa-network.mjs';
import qrcodeFactory from '../lib/checkout-static/vendor/qrcode-generator/qrcode.mjs';
import { sqlite } from '../db/client.js';

const { PrivateKey, Address, XOnlyPublicKey } = kaspa;

const MAX_CHANNELS = 5;
const MAX_PARTNERS = 5; // 固定收款方(除 provider 外)上限, 角色总数仍受 SDK MAX_ROLES=7 与 mass 校验约束
const SERVICE_MAX_SPLIT_FEE_SOMPI = '3000000';   // 0.03 KAS, 同主网实测单(账本 1774)
const SERVICE_MAX_REFUND_FEE_SOMPI = '1500000';  // 0.015 KAS, 同上
const INSTANT_MAX_SPLIT_FEE_SOMPI = '40000000';  // 同 config.js
const INSTANT_MAX_REFUND_FEE_SOMPI = '10000000';

// 与 config.js 同一张表(N1 含 broker 分档的保守值, 每渠道最低 sompi), 仅用于友好提示; 真正的准入判据是 signQuote 内的 mass 校验。
const DOSAGE_PER_CHANNEL_SOMPI = { 1: 5_270_000n, 2: 7_900_000n, 3: 10_530_000n, 4: 13_160_000n, 5: 15_800_000n };

class InputError extends Error {}
const bad = (msg) => { throw new InputError(msg); };

/** "1.5" → 150000000n; 最多 8 位小数, 必须 > 0。 */
export function kasToSompi(s, what = '价格') {
  const str = String(s ?? '').trim();
  if (!/^[0-9]+(\.[0-9]{1,8})?$/.test(str)) bad(`${what}必须是数字(最多 8 位小数), 例如 12.5`);
  const [i, f = ''] = str.split('.');
  const v = BigInt(i) * 100_000_000n + BigInt((f + '00000000').slice(0, 8));
  if (v <= 0n) bad(`${what}必须大于 0`);
  return v;
}

/** "70" / "12.5" → bps(最多 2 位小数); 0 ≤ x ≤ 100。 */
export function percentToBps(s, what = '比例') {
  const str = String(s ?? '').trim();
  if (!/^[0-9]{1,3}(\.[0-9]{1,2})?$/.test(str)) bad(`${what}必须是百分数(最多 2 位小数), 例如 70 或 12.5`);
  const [i, f = ''] = str.split('.');
  const bps = Number(i) * 100 + Number((f + '00').slice(0, 2));
  if (bps > 10000) bad(`${what}不能超过 100%`);
  return bps;
}

function networkForQuote() {
  const env = configuredNetwork(); // mainnet | testnet-12 | devnet | simnet(KASPA_NETWORK 单一源, 不接受请求体覆盖)
  return { env, quote: env === 'testnet-12' ? 'testnet' : env };
}

function checkAddr(addr, who) {
  const a = String(addr ?? '').trim();
  if (!a) bad(`${who}地址必填`);
  try { assertAddressOnNetwork(a, { who: `merchant-quote:${who}` }); }
  catch (e) { bad(`${who}地址不对: ${/prefix|PREFIX|MISMATCH/i.test(e.message) ? '网络前缀与控制台当前网络不一致' : '不是合法的 Kaspa 地址'}`); }
  return a;
}

function parsePartners(raw, network) {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > MAX_PARTNERS) bad(`其他收款方最多 ${MAX_PARTNERS} 个`);
  return list.map((p, i) => ({
    name: `partner_${i + 1}`,
    label: String(p?.label ?? '').slice(0, 40),
    address: checkAddr(p?.address, `其他收款方 ${i + 1} `),
    bps: percentToBps(p?.percent, `其他收款方 ${i + 1} 的比例`),
  })).filter((p) => { if (p.bps <= 0) bad('其他收款方的比例必须大于 0(不需要就删掉这一行)'); return true; });
}

// 链接太长(服务订单报价带完整合约数据, 常超二维码容量)时返回 null——页面据此提示"链接过长, 请复制链接", 不是报错。
function qrSvg(text) {
  for (const level of ['M', 'L']) {
    try {
      const qr = qrcodeFactory(0, level);
      qr.addData(text);
      qr.make();
      return qr.createSvgTag({ scalable: true });
    } catch { /* 容量不足, 降级再试 */ }
  }
  return null;
}

function buildLink(baseUrl, quote) {
  const b64 = Buffer.from(JSON.stringify(quote), 'utf8').toString('base64');
  let base = String(baseUrl || '').trim();
  if (!base) return { checkoutQuery: b64, link: null };
  let u;
  try { u = new URL(base); } catch { bad('结账页网址不是合法的 URL(例如 https://example.com/checkout.html)'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') bad('结账页网址必须以 http:// 或 https:// 开头');
  u.searchParams.set('q', b64);
  return { checkoutQuery: b64, link: u.toString() };
}

function pubkeysOf(privHex) {
  let priv;
  try { priv = new PrivateKey(String(privHex || '').trim()); } catch { bad('签名私钥不对(需要 64 位十六进制)'); }
  const pub = priv.toPublicKey();
  return { priv, merchantPubkeyHex: pub.toString(), xOnlyHex: pub.toXOnlyPublicKey().toString() };
}

/** 角色金额拆分——同 resolveRulesForOrder: provider 占位 pk, 其余角色地址占位(不进 fee-split), 金额按 bps 拆。 */
function splitAmounts(priceSompi, providerBps, partners) {
  const roles = [{ name: 'provider', bps: providerBps }, ...partners.map((p) => ({ name: p.name, bps: p.bps, address: '00'.repeat(32) }))];
  const rules = { schema_v: 1, roles };
  validateFeeRules(rules);
  const res = feeSplit(rules, priceSompi, [{ pk: '11'.repeat(32), stake: 1 }]);
  if (res.degenerate) bad('内部错误: 分账退化');
  const out = [{ name: 'provider', amountSompi: BigInt(res.winners[0].amount) }];
  for (const l of res.feeLeaves) out.push({ name: l.type, amountSompi: BigInt(l.amount) });
  return out;
}

async function currentDaaScore() {
  const { getWorkingRpc, requireRpcUrl } = await import('../services/rpc-health.js');
  const { url } = await getWorkingRpc();
  if (!requireRpcUrl(url, 'merchant-quote.daa')) throw new Error('当前没有可用的 Kaspa 节点 RPC, 无法读取链上进度(DAA), 请稍后重试');
  const { RpcClient, Encoding } = kaspa;
  const rpc = new RpcClient({ url, encoding: Encoding.Borsh, networkId: configuredNetwork() });
  await rpc.connect();
  try { return Number((await rpc.getBlockDagInfo()).virtualDaaScore); } finally { try { await rpc.disconnect(); } catch {} }
}

function escrowRelayDefaults() {
  const id = process.env.SERVICE_ESCROW_RELAY_ID || null;
  if (!id) return null;
  try {
    const row = sqlite.prepare('SELECT id, name, address FROM relay_nodes WHERE id = ?').get(id);
    if (!row?.address) return null;
    return { id: row.id, name: row.name, address: row.address, x_only_pubkey: XOnlyPublicKey.fromAddress(new Address(row.address)).toString() };
  } catch { return null; }
}

function describeRoles(priceSompi, leaves, partners, providerAddr) {
  const addrOf = (n) => (n === 'provider' ? providerAddr : partners.find((p) => p.name === n)?.address);
  return leaves.map((l) => {
    const p = partners.find((x) => x.name === l.name);
    return { name: l.name, label: p?.label || (l.name === 'provider' ? '收款方(你)' : l.name), address: addrOf(l.name), amount_sompi: l.amountSompi.toString(), percent: Number(l.amountSompi * 10000n / priceSompi) / 100 };
  });
}

export async function registerMerchantQuoteRoutes(fastify) {
  // 页面默认值: 网络(单一源)、结账页网址(env CHECKOUT_BASE_URL)、服务订单专用 relay 的公钥(买家/服务方 V1 签名身份)。
  fastify.get('/api/merchant/quote-defaults', async (request, reply) => {
    let net = null;
    try { net = networkForQuote(); } catch (e) { return reply.code(500).send({ ok: false, error: e.message }); }
    return reply.send({
      ok: true,
      network: net.env, quote_network: net.quote,
      checkout_base_url: process.env.CHECKOUT_BASE_URL || '',
      escrow_relay: escrowRelayDefaults(),
      currencies: [{ id: 'KAS', enabled: true }, { id: 'KTT', enabled: false, note: '即将支持(设计审过后接入)' }],
      limits: { max_channels: MAX_CHANNELS, max_partners: MAX_PARTNERS, provider_min_percent: PROVIDER_MIN_BPS / 100, role_max_percent: ROLE_MAX_BPS / 100 },
    });
  });

  // 生成一把全新的签名钥匙(随机, 不落库、不记日志, 只在这一次响应里返回)。给"不懂技术、还没有钥匙"的人用。
  fastify.post('/api/merchant/keygen', async (request, reply) => {
    try {
      const { env } = networkForQuote();
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
      const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
      const priv = new PrivateKey(hex);
      const netId = env === 'testnet-12' ? 'testnet' : env;
      return reply.send({ ok: true, private_key_hex: hex, address: priv.toPublicKey().toAddress(netId).toString(), x_only_pubkey: priv.toPublicKey().toXOnlyPublicKey().toString(), note: '请立刻保存私钥; 控制台不会保存它, 丢了无法找回。' });
    } catch (e) { return reply.code(500).send({ ok: false, error: `keygen failed: ${e.message}` }); }
  });

  fastify.post('/api/merchant/quote', async (request, reply) => {
    const b = request.body || {};
    try {
      const { env, quote: quoteNet } = networkForQuote();
      if (String(b.currency || 'KAS').toUpperCase() !== 'KAS') bad('目前只支持用 KAS 付款; KTT 付款模式待设计审过后开放');
      const kind = b.kind;
      if (kind !== 'instant_split' && kind !== 'service_escrow') bad('订单类型必须是 instant_split(即时分账)或 service_escrow(服务订单托管)');
      const priceSompi = kasToSompi(b.price_kas, '价格');
      const providerAddr = checkAddr(b.provider_address, '收款方(你)');
      const partners = parsePartners(b.partners, env);
      const partnerBps = partners.reduce((a, p) => a + p.bps, 0);
      const { priv, merchantPubkeyHex, xOnlyHex } = pubkeysOf(b.signing_key_hex);
      const validDays = b.valid_days == null || b.valid_days === '' ? 30 : Number(b.valid_days);
      if (!Number.isInteger(validDays) || validDays < 1 || validDays > 365) bad('有效期必须是 1~365 天的整数');
      const deadlineHours = b.deadline_hours == null || b.deadline_hours === '' ? 72 : Number(b.deadline_hours);
      if (!Number.isInteger(deadlineHours) || deadlineHours < 1 || deadlineHours > 24 * 30) bad('退款/到期窗口必须是 1~720 小时的整数');

      let quote, summaryRoles, extra = {};
      if (kind === 'instant_split') {
        const channelBps = b.channel_percent == null || b.channel_percent === '' ? 0 : percentToBps(b.channel_percent, '渠道预算比例');
        const maxChannels = Number(b.max_channels ?? 0);
        if (channelBps > 0) {
          if (!Number.isInteger(maxChannels) || maxChannels < 1 || maxChannels > MAX_CHANNELS) bad(`渠道人数必须是 1~${MAX_CHANNELS} 的整数`);
        }
        const providerBps = 10000 - channelBps - partnerBps;
        // 角色表: 逐字同 config.js —— 渠道预算在 maxChannels 层之间均分, 舍入余数并入 provider, 保持 Σ==10000。
        const roles = [{ name: 'provider', bps: providerBps, address: providerAddr }, ...partners.map((p) => ({ name: p.name, bps: p.bps, address: p.address }))];
        if (channelBps > 0) {
          const per = Math.floor(channelBps / maxChannels);
          for (let i = 1; i <= maxChannels; i++) roles.push({ name: `channel_${i}`, bps: per, fold_to: 'provider' });
          const sum = roles.reduce((a, r) => a + r.bps, 0);
          roles[0].bps += (10000 - sum);
        }
        if (roles[0].bps < PROVIDER_MIN_BPS) bad(`你自己(收款方)至少要占 ${PROVIDER_MIN_BPS / 100}%, 现在只有 ${roles[0].bps / 100}%——请降低其他收款方或渠道的比例`);
        for (const r of roles.slice(1)) if (r.bps > ROLE_MAX_BPS) bad(`单个收款方/渠道的比例不能超过 ${ROLE_MAX_BPS / 100}%`);
        if (channelBps > 0) {
          const minOrder = minOrderSompiForChannels(maxChannels, DOSAGE_PER_CHANNEL_SOMPI[maxChannels], channelBps);
          extra.min_order_for_full_channels_sompi = minOrder.toString();
          if (priceSompi < minOrder) extra.warning = `按 ${maxChannels} 层、渠道预算 ${channelBps / 100}% 计, 想让每一层渠道都能分到钱, 价格建议不低于约 ${(Number(minOrder) / 1e8).toFixed(4)} KAS; 低价商品建议减少渠道人数。`;
        }
        const now = Date.now();
        const unsigned = {
          schema_v: 1,
          quote_id: `q-${now}-${Math.floor(Math.random() * 1e6)}`,
          network: quoteNet,
          merchant_pubkey_hex: merchantPubkeyHex,
          price_sompi: priceSompi.toString(),
          canonical_rules: { schema_v: 1, roles },
          unfilled_channel_slot_fold_to: 'provider',
          valid_from_ms: now,
          valid_until_ms: now + validDays * 86400000,
          channel_whitelist: null,
          require_channel_deposit: false,
          min_deposit_sompi: '100000000',
          max_split_fee_sompi: INSTANT_MAX_SPLIT_FEE_SOMPI,
          max_refund_fee_sompi: INSTANT_MAX_REFUND_FEE_SOMPI,
          deadline_offset_ms: deadlineHours * 3600000,
        };
        try { quote = signQuote(unsigned, priv.toString()); } // 内含 mass 可行性/押金条款校验, 不过就抛错(不产生签名)
        catch (e) { if (/mass/.test(e.message)) bad(`价格太低, 放不下当前的分账结构(收款方 ${1 + partners.length} 个${channelBps > 0 ? `、渠道 ${maxChannels} 层` : ''}): 请提高价格, 或减少收款方/渠道层数。${extra.min_order_for_full_channels_sompi ? ` 满 ${maxChannels} 层渠道的参考最低价约 ${(Number(extra.min_order_for_full_channels_sompi) / 1e8).toFixed(2)} KAS。` : ''}`); throw e; }
        if (!verifyQuoteSignature(quote)) throw new Error('内部错误: 刚签完的报价自验签未过');
        // 展示: 合伙收款方的金额照 fee-split 拆(与结账页同口径); 你的份额 = 保底份额(渠道没人推广时渠道那份并回你, 实际可能更多)。
        const leaves = splitAmounts(priceSompi, 10000 - partnerBps, partners);
        const providerMin = priceSompi * BigInt(roles[0].bps) / 10000n;
        summaryRoles = describeRoles(priceSompi, leaves.filter((l) => l.name !== 'provider'), partners, providerAddr);
        summaryRoles.unshift({ name: 'provider', label: channelBps > 0 ? '你(收款方, 保底份额)' : '你(收款方)', address: providerAddr, amount_sompi: providerMin.toString(), percent: roles[0].bps / 100 });
        if (channelBps > 0) summaryRoles.push({ name: 'channels', label: `渠道推广人(最多 ${maxChannels} 层, 有人推广才分, 没人推广并回你)`, percent: channelBps / 100, address: null, amount_sompi: (priceSompi * BigInt(channelBps) / 10000n).toString() });
      } else {
        // 服务订单托管: 一单一报价(买家退款地址/买家公钥建单时就定死)。内部调用既有 /api/service-escrow/quote。
        const buyerRefund = checkAddr(b.buyer_refund_address, '买家退款');
        const escrow = escrowRelayDefaults();
        const buyerPubkeyHex = String(b.buyer_pubkey_hex || escrow?.x_only_pubkey || '').trim().toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(buyerPubkeyHex)) bad('买家公钥必填(64 位十六进制); 控制台没有配置专用托管 relay 时无法自动代填');
        const providerBps = 10000 - partnerBps;
        if (providerBps < PROVIDER_MIN_BPS) bad(`你自己(收款方)至少要占 ${PROVIDER_MIN_BPS / 100}%`);
        for (const p of partners) if (p.bps > ROLE_MAX_BPS) bad(`单个收款方的比例不能超过 ${ROLE_MAX_BPS / 100}%`);
        const leaves = splitAmounts(priceSompi, providerBps, partners);
        const finalRoles = leaves.map((l) => ({ amountSompi: l.amountSompi.toString(), address: l.name === 'provider' ? providerAddr : partners.find((p) => p.name === l.name).address }));
        const daa = await currentDaaScore();
        const res = await fastify.inject({
          method: 'POST', url: '/api/service-escrow/quote',
          payload: { order: {
            network: quoteNet, finalRoles, buyerRefundAddress: buyerRefund, providerPayoutAddress: providerAddr,
            currentDaaScore: daa, deadlineHours,
            maxSplitFeeSompi: SERVICE_MAX_SPLIT_FEE_SOMPI, maxRefundFeeSompi: SERVICE_MAX_REFUND_FEE_SOMPI,
            timeoutBuyerBps: b.timeout_buyer_percent != null && b.timeout_buyer_percent !== '' ? percentToBps(b.timeout_buyer_percent, '到期退款买家比例') : undefined,
            buyerPubkeyHex, providerPubkeyHex: xOnlyHex, merchantPrivKeyHex: priv.toString(),
          } },
        });
        let body; try { body = JSON.parse(res.body); } catch { body = {}; }
        if (res.statusCode !== 200 || !body.ok) throw new Error(body.error || `service-escrow quote HTTP ${res.statusCode}`);
        if (body.min_amount_check && body.min_amount_check.ok === false) bad(`价格太低, 托管订单放不下: ${body.min_amount_check.reason}`);
        quote = body.quote;
        if (!verifyQuoteSignature(quote)) throw new Error('内部错误: 服务订单报价自验签未过');
        summaryRoles = describeRoles(priceSompi, leaves, partners, providerAddr);
        extra = {
          escrow_address: body.address, expected_total_sompi: body.expected_total_sompi, deadline_daa: body.deadline_daa,
          timeout_buyer_bps: body.timeout_buyer_bps,
          note: 'V1: 买家确认/卖家取消由控制台的专用托管 relay 代签; 到期退款任何人可触发(零签名)。',
        };
        if (escrow && escrow.x_only_pubkey !== xOnlyHex) extra.warning = '签名钥匙与控制台专用托管 relay 不是同一把: 确认/取消两个动作将无法由控制台代签, 只剩到期退款可用。';
      }

      const { checkoutQuery, link } = buildLink(b.checkout_base_url, quote);
      return reply.send({
        ok: true, kind, network: env, price_sompi: priceSompi.toString(),
        merchant_pubkey_hex: quote.merchant_pubkey_hex, roles: summaryRoles,
        quote, checkout_query: checkoutQuery, checkout_link: link, qr_svg: link ? qrSvg(link) : null, qr_too_long: !!link && !qrSvg(link),
        ...extra,
      });
    } catch (e) {
      if (e instanceof InputError) return reply.code(400).send({ ok: false, error: e.message });
      // signQuote/validateFeeRules 的校验类报错(含中文原因)原样给用户看; 其余统一前缀
      const emsg = String(e?.message ?? e);
      const known = /signQuote|validateFeeRules|PROVIDER_MIN_BPS|ROLE_MAX_BPS|mass|role|bps|Σ|sum/i.test(emsg);
      return reply.code(known ? 400 : 500).send({ ok: false, error: known ? emsg : `merchant quote failed: ${emsg}` });
    }
  });
}
