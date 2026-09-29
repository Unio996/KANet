// service-escrow.js — D-034 §9 ServiceEscrow 控制台签名路径(Bettor 2026-09-28 派工, Owner"不要把系统
// 做复杂了, 特别是一开始, 跑通最重要"——照 D-035 unlockKttV2Transfer 那条现成 IPC 最小接线, 不加新页面
// (UI 美化后置)、不加新表(V1 无状态: 建单参数由调用方每次原样带回, 不落库)。
//
// 合约: kasia-console/src/lib/sil-v1/ServiceEscrow.sil(已 simnet 12/12 真实广播验证)。
// SDK: kasia-console/src/lib/commission-plan-sdk.mjs 的 createServiceEscrowProtocol/computeTimeoutSplit。
// relay 侧: kasia-relay/src/lib/p2sh.mjs 的 unlockServiceEscrowSigEntry/unlockServiceEscrowTimeoutDefault
// (commands.mjs 三个新 COMMAND_TYPES, relay.mjs 三个新 case)。
//
// 🔴 V1 无状态的代价(如实写明, 不是隐藏局限): 每次调用 buyer-confirm/provider-cancel/timeout-default
// 都要把建单时用过的全部 ctor 参数原样传回来(才能服务端重新算出同一份合约地址/redeemScriptHex)——
// 这是"不加新表"换来的, 持久化/订单追踪是 V2 的事, 这里不做。
//
// 安全模式同 D-035 KTT panel 先例(tokens.js kttPanelGate 一字不差抄一遍逻辑, 不跨文件依赖): 花钱路由
// 服务端固定读 env 里配置的唯一专用 relay, 不接受调用方指定 relay_id; 默认关。

import { sendCommandAsync } from '../services/relay-manager.js';
import {
  createServiceEscrowProtocol, computeTimeoutSplit, spkBytesFromAddress,
  SERVICE_ESCROW_DEFAULT_TIMEOUT_BUYER_BPS, validateServiceEscrowMinAmount,
  canonicalQuoteBytes, verifyQuoteSignature,
} from '../lib/commission-plan-sdk.mjs';
import * as kaspa from 'kaspa-wasm';

const { PrivateKey, signMessage } = kaspa;

// ── 开关 + relay 收紧(同 tokens.js kttPanelGate, 独立一套 env, 不跟 KTT panel 共用) ──
const SERVICE_ESCROW_ENABLED = () => process.env.SERVICE_ESCROW_ENABLED === '1';
const SERVICE_ESCROW_RELAY_ID = () => process.env.SERVICE_ESCROW_RELAY_ID || null;

function serviceEscrowGate() {
  if (!SERVICE_ESCROW_ENABLED()) return { ok: false, code: 403, error: 'ServiceEscrow 控制台签名路径 disabled(SERVICE_ESCROW_ENABLED != 1)' };
  const relayId = SERVICE_ESCROW_RELAY_ID();
  if (!relayId) return { ok: false, code: 403, error: 'ServiceEscrow 未配置专用 relay(SERVICE_ESCROW_RELAY_ID 未设, 拒绝 fallback 到其他 relay 身份)' };
  return { ok: true, relayId };
}

function relayRc(relayId) {
  // origin='app': 面板/调用方触发的应用层动作(R-SENDCMD-ORIGIN-REQUIRED 五值之一)。
  return (cmd) => sendCommandAsync(relayId, cmd, 90000, 'app');
}

/** 从建单参数(request body 的 order 字段)重建 createServiceEscrowProtocol 需要的 cfg——服务端重新
 * 算出合约, 不直接信任调用方传来的 redeem_script_hex(同 KTT mint 的既有纪律: 服务端算 artifact,
 * relay/console 都不信调用方现成给的编译产物)。 */
function protocolFromOrder(order) {
  if (!order || typeof order !== 'object') throw new Error('order 字段必需(建单时用过的 ctor 参数原样传回)');
  const finalRoles = (order.finalRoles || []).map((r) => ({ amountSompi: BigInt(r.amountSompi), spk: spkBytesFromAddress(r.address) }));
  if (!finalRoles.length) throw new Error('order.finalRoles 必需且非空');
  return createServiceEscrowProtocol({
    network: order.network, finalRoles,
    buyerRefundAddress: order.buyerRefundAddress, providerPayoutAddress: order.providerPayoutAddress,
    deadlineDaa: order.deadlineDaa, orderNonceHex: order.orderNonceHex, commissionDeadlineMs: order.commissionDeadlineMs,
    maxSplitFeeSompi: BigInt(order.maxSplitFeeSompi), maxRefundFeeSompi: BigInt(order.maxRefundFeeSompi),
    timeoutBuyerBps: order.timeoutBuyerBps != null ? Number(order.timeoutBuyerBps) : SERVICE_ESCROW_DEFAULT_TIMEOUT_BUYER_BPS,
    buyerPubkeyHex: order.buyerPubkeyHex, providerPubkeyHex: order.providerPubkeyHex,
    ruleCommitHex: order.ruleCommitHex, channelChainCommitmentHex: order.channelChainCommitmentHex,
  });
}

/** 查询 escrow 地址当前真实 UTXO(必须恰好 1 个——0 个=未充值或已花, 多个=不是本合约的正常状态)。
 * 不信任调用方声称的金额: 精确输出金额必须从这里查到的真实 UTXO 面值算, 不是 order 里的"预期总价"。 */
async function fetchEscrowUtxo(rc, address) {
  const resp = await rc({ type: 'get_address_utxos', address });
  const entries = resp?.utxos || resp?.entries || [];
  if (entries.length === 0) throw new Error(`escrow 地址 ${address} 当前没有 UTXO(未充值, 或已经被花掉)`);
  if (entries.length > 1) throw new Error(`escrow 地址 ${address} 有 ${entries.length} 个 UTXO(非正常状态, 拒绝在有歧义时代签)`);
  const e = entries[0];
  return {
    outpointTxid: e.outpoint?.transactionId ?? e.transactionId,
    index: e.outpoint?.index ?? e.index,
    valueSompi: BigInt(e.amount ?? e.entry?.amount ?? 0),
  };
}

const spkHex = (buf) => Buffer.from(buf).toString('hex');

const spkHexOf = (buf) => Buffer.from(buf).toString('hex');

export async function registerServiceEscrowRoutes(fastify) {
  // ── 建单报价(纯计算, 不碰链, 不需要闸——算出地址给调用方去充值) ──
  // 🔴 结账页签名(2026-09-28 Bettor 裁定, 会话重启后追加): 结账链接内容可被篡改会让买家把钱付进
  // 攻击者的托管地址, 是真实损失——照抄 D-034 §8 既有的 signQuote/verifyQuoteSignature 机制(不另起),
  // 但不直接调用 signQuote 本体(那个函数内部强制跑 CommissionSplit 专属的 validateQuoteMassFeasibility/
  // validateDepositTerms, 对 ServiceEscrow 的报价形状不适用)——复用它依赖的底层原语
  // canonicalQuoteBytes(规范化 JSON 排序去掉 signature_hex)+ kaspa-wasm signMessage(schnorr, 同一套
  // "message=hex(内容)"惯例), verifyQuoteSignature 本身是通用的(不关心 quote 内部形状), 结账页直接
  // 复用不用改。调用方(建单脚本/后台工具)必须自己持有服务方(provider)私钥并显式传
  // order.merchantPrivKeyHex 才会签(不传 = 返回未签名报价, 仅供内部/API 调用方使用, 不产出可分享链接)。
  fastify.post('/api/service-escrow/quote', async (request, reply) => {
    try {
      const order = request.body?.order;
      if (!order || typeof order !== 'object') return reply.code(400).send({ ok: false, error: 'order required' });
      const finalRoles = (order.finalRoles || []).map((r) => ({ amountSompi: BigInt(r.amountSompi), spk: spkBytesFromAddress(r.address) }));
      if (!finalRoles.length) return reply.code(400).send({ ok: false, error: 'order.finalRoles required and non-empty' });
      const protocol = createServiceEscrowProtocol({
        network: order.network, finalRoles,
        buyerRefundAddress: order.buyerRefundAddress, providerPayoutAddress: order.providerPayoutAddress,
        currentDaaScore: order.currentDaaScore, deadlineDaa: order.deadlineDaa, deadlineHours: order.deadlineHours,
        maxSplitFeeSompi: BigInt(order.maxSplitFeeSompi), maxRefundFeeSompi: BigInt(order.maxRefundFeeSompi),
        timeoutBuyerBps: order.timeoutBuyerBps != null ? Number(order.timeoutBuyerBps) : undefined,
        buyerPubkeyHex: order.buyerPubkeyHex, providerPubkeyHex: order.providerPubkeyHex,
        ruleCommitHex: order.ruleCommitHex, channelChainCommitmentHex: order.channelChainCommitmentHex,
      });
      const expectedTotalSompi = finalRoles.reduce((a, r) => a + r.amountSompi, 0n) + protocol.maxSplitFeeSompi;
      const minCheck = validateServiceEscrowMinAmount(expectedTotalSompi, BigInt(order.maxRefundFeeSompi), protocol.timeoutBuyerBps);

      // 结账页(order_kind 分支)要用到的完整数据——字段集合按 Bettor 裁定"完整 quote(含 order_kind、
      // 托管地址、timeout_buyer_bps、deadline、最终分润地址)"逐条列, 不多不少。
      const quoteWithoutSig = {
        order_kind: 'service_escrow',
        network: order.network,
        merchant_pubkey_hex: order.providerPubkeyHex, // 签名者 = 服务方(Bettor 裁定原话)
        service_escrow: {
          address: protocol.address,
          redeem_script_hex: protocol.redeemScriptHex,
          // 全量传 timeout_default 的 ABI(含 params:[], 不是只挑 dispatch_tag)——
          // encodeEntryActionGeneric 内部 `for (const p of entryAbi.params)` 需要这个字段可迭代,
          // 只传 dispatch_tag 会在浏览器端广播时炸 "entryAbi.params is not iterable"。
          entries: { timeout_default: protocol.entries.timeout_default },
          deadline_daa: protocol.deadlineDaa,
          timeout_buyer_bps: protocol.timeoutBuyerBps,
          max_refund_fee_sompi: protocol.maxRefundFeeSompi.toString(),
          provider_payout_spk_hex: spkHexOf(protocol.providerPayoutSpk),
          buyer_refund_spk_hex: spkHexOf(protocol.buyerRefundSpk),
          expected_total_sompi: expectedTotalSompi.toString(),
        },
      };
      let quote = quoteWithoutSig;
      let checkoutQuery = null;
      if (order.merchantPrivKeyHex) {
        const msgHex = canonicalQuoteBytes(quoteWithoutSig).toString('hex');
        const signature_hex = signMessage({ message: msgHex, privateKey: new PrivateKey(order.merchantPrivKeyHex) });
        quote = { ...quoteWithoutSig, signature_hex };
        if (!verifyQuoteSignature(quote)) throw new Error('内部错误: 刚签完的报价自验签未过(签名/公钥不匹配?)');
        checkoutQuery = Buffer.from(JSON.stringify(quote), 'utf8').toString('base64');
      }

      return reply.send({
        ok: true,
        address: protocol.address,
        commission_split_address: protocol.commissionSplitProtocol.address,
        redeem_script_hex: protocol.redeemScriptHex,
        // 调用方必须把这三样存下来、之后每次签名请求原样传回(V1 无状态的代价, 见头注)。
        order_nonce_hex: protocol.orderNonceHex,
        commission_deadline_ms: protocol.commissionDeadlineMs,
        deadline_daa: protocol.deadlineDaa,
        timeout_buyer_bps: protocol.timeoutBuyerBps,
        entries: Object.fromEntries(Object.entries(protocol.entries).map(([k, v]) => [k, v.dispatch_tag])),
        expected_total_sompi: expectedTotalSompi.toString(),
        min_amount_check: minCheck,
        quote, // 未签名时 = quoteWithoutSig 原样(无 signature_hex); 签了则含 signature_hex, 可直接喂 verifyQuoteSignature
        checkout_query: checkoutQuery, // 拼 `checkout.html?q=<这个值>` 即可分享; 未签名时为 null(不产出可分享链接)
      });
    } catch (e) {
      return reply.code(500).send({ ok: false, error: `service-escrow quote failed: ${e.message}` });
    }
  });

  // ── 买家确认: 单输出转下游 CommissionSplit 地址, 精确扣 max_split_fee ──
  fastify.post('/api/service-escrow/buyer-confirm', async (request, reply) => {
    const gate = serviceEscrowGate();
    if (!gate.ok) return reply.code(gate.code).send({ ok: false, error: gate.error });
    try {
      const protocol = protocolFromOrder(request.body?.order);
      const rc = relayRc(gate.relayId);
      const utxo = await fetchEscrowUtxo(rc, protocol.address);
      const outputValue = utxo.valueSompi - protocol.maxSplitFeeSompi;
      if (outputValue <= 0n) return reply.code(409).send({ ok: false, error: `escrow UTXO(${utxo.valueSompi})不够扣 max_split_fee(${protocol.maxSplitFeeSompi})` });
      const cmd = {
        type: 'service_escrow_buyer_confirm',
        escrow: { redeem_script_hex: protocol.redeemScriptHex, dispatch_tag_hex: protocol.entries.buyer_confirm.dispatch_tag, outpointTxid: utxo.outpointTxid, index: utxo.index },
        outputs: [{ value_sompi: outputValue.toString(), spk_hex: spkHex(protocol.commissionSpk) }],
      };
      const result = await rc(cmd);
      if (!result?.txId) return reply.code(502).send({ ok: false, error: result?.error || 'relay buyer_confirm 失败(无 txId 回执)' });
      return reply.send({ ok: true, txid: result.txId, commission_split_address: protocol.commissionSplitProtocol.address, forwarded_sompi: outputValue.toString() });
    } catch (e) {
      return reply.code(500).send({ ok: false, error: `buyer-confirm failed: ${e.message}` });
    }
  });

  // ── 服务方取消: 单输出全额退买家(减 max_refund_fee) ──
  fastify.post('/api/service-escrow/provider-cancel', async (request, reply) => {
    const gate = serviceEscrowGate();
    if (!gate.ok) return reply.code(gate.code).send({ ok: false, error: gate.error });
    try {
      const protocol = protocolFromOrder(request.body?.order);
      const rc = relayRc(gate.relayId);
      const utxo = await fetchEscrowUtxo(rc, protocol.address);
      const outputValue = utxo.valueSompi - protocol.maxRefundFeeSompi;
      if (outputValue <= 0n) return reply.code(409).send({ ok: false, error: `escrow UTXO(${utxo.valueSompi})不够扣 max_refund_fee(${protocol.maxRefundFeeSompi})` });
      const cmd = {
        type: 'service_escrow_provider_cancel',
        escrow: { redeem_script_hex: protocol.redeemScriptHex, dispatch_tag_hex: protocol.entries.provider_cancel.dispatch_tag, outpointTxid: utxo.outpointTxid, index: utxo.index },
        outputs: [{ value_sompi: outputValue.toString(), spk_hex: spkHex(protocol.buyerRefundSpk) }],
      };
      const result = await rc(cmd);
      if (!result?.txId) return reply.code(502).send({ ok: false, error: result?.error || 'relay provider_cancel 失败(无 txId 回执)' });
      return reply.send({ ok: true, txid: result.txId, refunded_sompi: outputValue.toString() });
    } catch (e) {
      return reply.code(500).send({ ok: false, error: `provider-cancel failed: ${e.message}` });
    }
  });

  // ── 到期兜底: 任何人可触发(零签名), 两输出精确 bps 分账 ──
  fastify.post('/api/service-escrow/timeout-default', async (request, reply) => {
    const gate = serviceEscrowGate();
    if (!gate.ok) return reply.code(gate.code).send({ ok: false, error: gate.error });
    try {
      const protocol = protocolFromOrder(request.body?.order);
      const rc = relayRc(gate.relayId);
      const utxo = await fetchEscrowUtxo(rc, protocol.address);
      const amountAfterFee = utxo.valueSompi - protocol.maxRefundFeeSompi;
      if (amountAfterFee <= 0n) return reply.code(409).send({ ok: false, error: `escrow UTXO(${utxo.valueSompi})不够扣 max_refund_fee(${protocol.maxRefundFeeSompi})` });
      const { providerCut, buyerAmt } = computeTimeoutSplit(amountAfterFee, protocol.timeoutBuyerBps);
      const cmd = {
        type: 'service_escrow_timeout_default',
        escrow: {
          redeem_script_hex: protocol.redeemScriptHex, dispatch_tag_hex: protocol.entries.timeout_default.dispatch_tag,
          outpointTxid: utxo.outpointTxid, index: utxo.index, deadline_daa: protocol.deadlineDaa,
        },
        outputs: [
          { value_sompi: providerCut.toString(), spk_hex: spkHex(protocol.providerPayoutSpk) },
          { value_sompi: buyerAmt.toString(), spk_hex: spkHex(protocol.buyerRefundSpk) },
        ],
      };
      const result = await rc(cmd);
      if (!result?.txId) return reply.code(502).send({ ok: false, error: result?.error || 'relay timeout_default 失败(无 txId 回执, 常见原因: 未到期)' });
      return reply.send({ ok: true, txid: result.txId, provider_cut_sompi: providerCut.toString(), buyer_amt_sompi: buyerAmt.toString() });
    } catch (e) {
      return reply.code(500).send({ ok: false, error: `timeout-default failed: ${e.message}` });
    }
  });
}
