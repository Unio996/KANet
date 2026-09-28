// mint-quote-3way.mjs — 签一份三方分账报价(provider + broker + channel_1), 复用 commission-plan-sdk.mjs
// 的 signQuote(同 KANet-UI e2e_broadcast.mjs 的 mint-quote.mjs 手法, 只是加了 broker + channel_1 两个
// 角色, 用来真实验证 D-034 checkout.js channelSpks bug 修复——channel_1 必须真实收到钱)。
// 用法: node mint-quote-3way.mjs <priceKas> <deadlineOffsetMs> <providerAddr> <brokerAddr> <merchantPrivHex>
import { createRequire } from 'node:module';
const require = createRequire('D:/kanet-tn12/kasia-console/');
const SDK = await import('file:///D:/kanet-tn12/scratch/_j2_wt_checkout_spks/kasia-console/src/lib/commission-plan-sdk.mjs');
const kaspa = require('kaspa-wasm');

const [priceKas, deadlineOffsetMs, providerAddr, brokerAddr, merchantPrivHex] = process.argv.slice(2);

const quote = {
  schema_v: 1,
  quote_id: 'q3way-' + Date.now() + '-' + Math.floor(Math.random() * 1e6),
  merchant_pubkey_hex: null,
  price_sompi: String(Math.round(Number(priceKas) * 1e8)),
  canonical_rules: { schema_v: 1, roles: [
    { name: 'provider', bps: 7000, address: providerAddr },
    { name: 'broker', bps: 500, address: brokerAddr },
    { name: 'channel_1', bps: 2500, fold_to: 'provider' },
  ] },
  unfilled_channel_slot_fold_to: 'provider',
  valid_from_ms: Date.now(),
  valid_until_ms: Date.now() + 30 * 86400000,
  channel_whitelist: null,
  require_channel_deposit: false,
  min_deposit_sompi: '100000000',
  max_split_fee_sompi: '40000000',
  max_refund_fee_sompi: '10000000',
  deadline_offset_ms: Number(deadlineOffsetMs),
};

const priv = new kaspa.PrivateKey(merchantPrivHex);
quote.merchant_pubkey_hex = priv.toPublicKey().toString();
const signed = SDK.signQuote(quote, merchantPrivHex);
const b64 = Buffer.from(JSON.stringify(signed)).toString('base64');
console.log(b64);
