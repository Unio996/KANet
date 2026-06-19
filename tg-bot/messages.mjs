// TG bot user-facing text + flow builders. v1.3: builder voice, testnet/MIT, reactive-only.
// Value/trust steps → the USER acts on-chain via Console/their relay. bot 0 持钥 / 0 execute (J1 S5).
import { CONFIG } from './config.mjs';

export const DISCLAIMER = 'testnet-only · MIT 开源 · 不运营主网 · 非投资建议';

export function startMessage() {
  // gate D onboarding tour (Bettor Q3: enhance /start into a low-friction guided sequence; copy is
  // placeholder, Owner待拍 final wording). 无账户无许可 + 每步给下一命令.
  return [
    '👋 KANet — 用 Kaspa 信任链把 AI agent 接到任何市场。无账户、无许可，bot 碰不到你的钱。',
    '',
    '👉 第一次来？三步上手:',
    '① /link <你的 kaspatest 地址> — 绑定你的地址（没有就用任意 Kaspa testnet 钱包生成一个）',
    '② /faucet — 领 5 个测试 KAS（约 10 秒到账）',
    '③ /bet — 押注一个预测市场（你自己链上锁定，5 个评判结算），再 /mybets 看赢/输/退款',
    '',
    '更多:',
    '· /swap — 兑换 KAS ↔ USDT（经 broker，链上结算）',
    '· /discover — 浏览开放挂单 / 预测市场',
    '· /help — 全部命令',
    '',
    '⚠ 你的钱始终由你自己链上掌控 —— 这个 bot 不持任何 key、碰不到你的资金。每笔付款都是你从自己地址链上发起。',
    '想自己 build？KANet 开源（MIT），fork 一个角色（broker / oracle / prediction / exchange）跑你自己的节点。',
    DISCLAIMER,
  ].join('\n');
}

// 兑换 flow — show broker X's KAS receiving address; the USER pays on-chain from their own wallet.
// bot 0 execute: 只显地址 + 引导 + deep-link。broker-intake-watcher 在链上检测到付款后继续。
export function swapFlow(broker) {
  const name = broker?.name || 'broker';
  const addr = broker?.address || '(broker 未配置 — Owner 在 Console 设置页选)';
  return [
    `💱 兑换 KAS ↔ USDT — 经 broker ${name}`,
    '',
    '1) 从你自己的钱包,把要兑换的 KAS 链上转到 broker 收款地址:',
    `   ${addr}`,
    '2) broker 会问你 USDT 收哪条链 + 地址(回复 "用 bnb 0x..." 之类),然后链上回款。',
    '',
    '⚠ 钱全程你自己链上掌控:你从自己地址发起付款,bot 不经手、碰不到你的钱。',
  ].join('\n');
}

// 押注 flow — deep-link 到预测市场;用户自己链上锁仓 + 签名,bot 0 execute。
export function betFlow(broker) {
  const name = broker?.name || 'broker';
  return [
    `🎲 押注预测市场 — 经 broker ${name}`,
    '',
    '在 Console 选市场押注:你自己链上锁定,5 个 oracle 投票结算,全程链上可审计。',
    'broker 只撮合/引导,收协议内置的 broker 佣金(落 broker 链上地址)。',
    '',
    '⚠ 你自己链上锁定 + 签名,bot 不碰你的钱。',
    '直接 /bet 开始押注 (全 Telegram 菜单交互, 不跳网页)。',
  ].join('\n');
}

export function notifyLine(ev) {
  const tx = (ev.txid || '').slice(0, 12);
  const t = ev.event_type || 'event';
  // KANet-UI 线B P1 (Bettor v2 ③): settle/refund 事件友好化 — 用户押注有结果时给可读+可执行通知,
  // 指向 /mybets 看赢/输/退 + 金额(原 generic '🔔 event tx' 用户看不懂)。金额/赢输详情在 /mybets。
  if (/settle|payout|winner|distribut/i.test(t)) {
    return `🎉 你押注的预测市场结算了! 押中的话 KAS 已到你 /link 地址。\ntx ${tx}… — 回 /mybets 看你赢了多少。`;
  }
  if (/refund/i.test(t)) {
    return `↩ 你押注的市场退款了 (裁决源不可得 / 仲裁人弃权, 押金退回你地址)。\ntx ${tx}… — /mybets 看详情。`;
  }
  if (t === 'tx') {
    return `💰 你的地址有链上入账 (可能是押注结算赢款或退款)。\ntx ${tx}… — /mybets 看你的押注结果。`;
  }
  return `🔔 链上动态: ${t} · tx ${tx}… · ${ev.observed_at || ''}`;
}

export function help() {
  return [
    '命令:',
    '/start — 介绍 + 三步上手',
    '/link <kaspatest地址> — 绑定你的地址',
    '/faucet — 领测试 KAS（先 /link）',
    '/swap — 兑换 KAS ↔ USDT(经 broker,链上)',
    '/bet — 押注预测市场',
    '/mybets — 看自己的押注 + 状态',
    '/discover — 浏览开放挂单 / 市场',
    '',
    DISCLAIMER,
  ].join('\n');
}
