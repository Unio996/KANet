// TG bot user-facing text + deep-link builders. v1.3: builder voice, testnet/MIT, reactive-only.
// Value/trust steps → deep-link to Console (the USER acts/signs there). bot 0 持钥 (J1 S5).
import { CONFIG } from './config.mjs';

export const DISCLAIMER = 'testnet-only · MIT 开源 · 不运营主网 · 非投资建议';

export function startMessage() {
  return [
    '👋 KANet — 用 Kaspa 信任链把 AI agent 接到任何市场。',
    '',
    '这是 builder 协议网络(不是产品)。经这个 broker bot 你可以:',
    '· 兑换 KAS / 押注预测市场(链上结算)',
    '· 订阅你地址的链上通知',
    '· 浏览开放挂单 / 预测市场',
    '',
    '⚠ 你的钱始终由你自己链上掌控 —— 这个 bot 不持任何 key、碰不到你的资金。每笔付款都是你从自己地址链上发起的。',
    '',
    '开始: /link <你的 kaspatest 地址>  (绑定后收通知)。',
    '需要测试币? 去 dev-channel 用 /faucet 领。',
    '',
    DISCLAIMER,
  ].join('\n');
}

// /link step 1 — user signs the nonce in their OWN relay (via Console), then pastes the proof back.
export function linkInstructions(nonce) {
  return [
    '🔗 绑定地址(你自己签,bot 0 持钥):',
    '1) 在 KANet Console 打开你的 relay,对下面这串 nonce 生成一次消息签名:',
    '',
    `   ${nonce}`,
    '',
    '2) 把得到的 proof 串粘回来:  /verify <proof>',
    '',
    '（bot 只把你的 proof 转给 Console 校验 —— 全程碰不到你的私钥。5 分钟内有效。）',
  ].join('\n');
}

// bridge-to-action: value step is a DEEP-LINK; the user does it on-chain via Console/their relay.
export function bridge(kind) {
  const base = CONFIG.consoleUrl;
  if (kind === 'swap') return { url: `${base}/exchange`, note: '在 Console 兑换:你从自己地址链上付款给 broker,broker 链上回款。bot 不经手资金。' };
  if (kind === 'bet')  return { url: `${base}/predictions`, note: '在 Console 押注:你自己链上锁仓,5-oracle 结算。bot 不经手资金。' };
  return { url: base, note: '' };
}

export function notifyLine(ev) {
  const tx = (ev.txid || '').slice(0, 12);
  return `🔔 ${ev.event_type || 'event'} · tx ${tx}… · ${ev.observed_at || ''}`;
}

export function help() {
  return [
    '命令:',
    '/start — 介绍',
    '/link <kaspatest地址> — 绑定(收通知)',
    '/verify <proof> — 完成绑定',
    '/swap — 兑换 KAS(deep-link 到 Console)',
    '/bet — 押注预测市场(deep-link)',
    '/discover — 浏览开放挂单/市场',
    '',
    DISCLAIMER,
  ].join('\n');
}
