/**
 * Skill: Onboard Market — Exchange Connection Guide
 *
 * Guides users through connecting external exchanges via conversation.
 * Does NOT create any new integration pipelines — only guides the
 * onboarding process using existing Console exchange_accounts API.
 *
 * Two modes:
 *   1. Chat-guided — Agent walks user through step by step
 *   2. Self-service — Agent points to settings page
 */

import { Skill } from './base.mjs';
import { fetchJson } from '../utils.mjs';

// ── Knowledge Base ──────────────────────────────────────────────────────────

const EXCHANGE_GUIDES = {
  binance: {
    name: 'Binance',
    aliases: ['币安', 'binance', 'bnb交易所'],
    register_url: 'https://www.binance.com/register',
    api_path: '右上角头像 → API 管理 → 创建 API',
    permissions_required: ['读取账户', '现货交易'],
    permissions_forbidden: ['提现'],
    permission_warning: '不要勾选提现权限，即使 Key 泄露资金也无法被转走',
    notes: 'Secret Key 只在创建时显示一次，请立刻复制保存',
    fields: ['apiKey', 'apiSecret'],
  },
  okx: {
    name: 'OKX',
    aliases: ['okx', 'ok', 'okex'],
    register_url: 'https://www.okx.com/join',
    api_path: '右上角头像 → API → 创建 API Key',
    permissions_required: ['读取', '交易'],
    permissions_forbidden: ['提现'],
    permission_warning: '提现权限务必不要开，只开读取和交易',
    notes: '绑定 IP 白名单可跳过。会生成一个 Passphrase，也要一起保存',
    fields: ['apiKey', 'apiSecret', 'passphrase'],
  },
  bybit: {
    name: 'Bybit',
    aliases: ['bybit', 'bb'],
    register_url: 'https://www.bybit.com/register',
    api_path: '右上角头像 → API → 创建新密钥',
    permissions_required: ['读取/写入 - 现货交易'],
    permissions_forbidden: ['资产转移', '提现'],
    permission_warning: '资产转移和提现都不要开，只开现货交易',
    notes: 'API Secret 只显示一次，请立即复制保存',
    fields: ['apiKey', 'apiSecret'],
  },
  gateio: {
    name: 'Gate.io',
    aliases: ['gate', 'gateio', 'gate.io'],
    register_url: 'https://www.gate.io/signup',
    api_path: '右上角头像 → API Keys → 创建 API Key',
    permissions_required: ['现货交易读写'],
    permissions_forbidden: ['提现'],
    permission_warning: '提现权限不要开，这是最重要的安全设置',
    notes: 'API Secret 生成后只显示一次，请立即保存',
    fields: ['apiKey', 'apiSecret'],
  },
  mexc: {
    name: 'MEXC',
    aliases: ['mexc', '抹茶'],
    register_url: 'https://www.mexc.com/register',
    api_path: '右上角头像 → API 管理 → 创建 API',
    permissions_required: ['读取', '现货交易'],
    permissions_forbidden: ['提现'],
    permission_warning: '不要勾选提现权限',
    notes: 'Secret Key 只在创建时显示一次，请立刻复制保存',
    fields: ['apiKey', 'apiSecret'],
  },
  kucoin: {
    name: 'KuCoin',
    aliases: ['kucoin', '库币'],
    register_url: 'https://www.kucoin.com/ucenter/signup',
    api_path: '右上角头像 → API Management → Create API',
    permissions_required: ['General', 'Trade'],
    permissions_forbidden: ['Transfer'],
    permission_warning: '不要勾选 Transfer 权限',
    notes: '会生成一个 Passphrase，和 API Key、Secret 一起保存',
    fields: ['apiKey', 'apiSecret', 'passphrase'],
  },
  bitget: {
    name: 'Bitget',
    aliases: ['bitget'],
    register_url: 'https://www.bitget.com/register',
    api_path: '右上角头像 → API Management → Create API',
    permissions_required: ['Read', 'Spot Trade'],
    permissions_forbidden: ['Withdraw'],
    permission_warning: '不要勾选 Withdraw 权限',
    notes: '会生成一个 Passphrase，和 API Key、Secret 一起保存',
    fields: ['apiKey', 'apiSecret', 'passphrase'],
  },
  htx: {
    name: 'HTX (Huobi)',
    aliases: ['htx', 'huobi', '火币'],
    register_url: 'https://www.htx.com/register',
    api_path: '右上角头像 → API Management → Create API Key',
    permissions_required: ['Read', 'Trade'],
    permissions_forbidden: ['Withdraw'],
    permission_warning: '不要勾选 Withdraw 权限',
    notes: 'Secret Key 只显示一次，请立即保存',
    fields: ['apiKey', 'apiSecret'],
  },
  kraken: {
    name: 'Kraken',
    aliases: ['海妖', 'kraken'],
    register_url: 'https://www.kraken.com/sign-up',
    api_path: 'Security → API → Create API Key',
    permissions_required: ['Query Funds', 'Create Orders'],
    permissions_forbidden: ['Withdraw Funds'],
    permission_warning: '不要勾选 Withdraw Funds，资金安全第一',
    notes: 'Private Key 只显示一次，请立即保存',
    fields: ['apiKey', 'apiSecret'],
    unsupported: true, // not in Console EXCHANGE_REGISTRY yet
  },
};

/**
 * Match user input to an exchange key.
 * Returns { key, guide } or null.
 */
function matchExchange(input) {
  const lower = (input || '').toLowerCase();
  for (const [key, guide] of Object.entries(EXCHANGE_GUIDES)) {
    if (guide.aliases.some(a => lower.includes(a.toLowerCase()))) {
      return { key, guide };
    }
  }
  return null;
}

// ── Skill Class ─────────────────────────────────────────────────────────────

export class OnboardMarketSkill extends Skill {
  constructor() {
    super('onboard_market', 'Guide user to connect external exchange — chat or form mode');
  }

  canActivate(taskType, context) {
    // Path 1: Reactive — OWNER explicitly asks about exchange connection
    // This skill is for the node operator, not for peers chatting with the Agent
    if (taskType === 'reactive') {
      const relation = context?._senderRelation;
      // Only activate for owner (or when relation is unknown — defensive fallback)
      if (relation && relation !== 'owner') return false;

      const msg = (context?._inputMessage || '').toLowerCase();
      return /接入|连接|交易所|api.?key|binance|币安|okx|kraken|海妖|bybit|gate|mexc|抹茶|kucoin|库币|bitget|htx|huobi|火币|看盘|行情|开始交易|我想交易|我有.*账号|连接.*账户/.test(msg);
    }

    // Path 2: Proactive — agent notices owner has trade goals but no exchange
    if (taskType === 'proactive') {
      const goals = context?.intent?.currentGoals || [];
      return goals.some(g =>
        g.status === 'active' &&
        /交易|赚钱|投资|看盘|行情|买入|卖出|trade|market|earn|invest/i.test(g.text)
      );
    }

    return false;
  }

  async gatherContext(kernels, config) {
    const consoleUrl = config.consoleUrl || 'http://localhost:3100';
    const relayNodeId = config.relayNodeId;
    const userMessage = config.userMessage || config.lastMessage || '';
    const taskType = config._taskType || 'reactive';

    // 1. Try to detect which exchange user is asking about
    const detectedExchange = matchExchange(userMessage);

    // 2. Query existing exchange connections
    let existingConnections = [];
    try {
      const accounts = await fetchJson(`${consoleUrl}/api/trade/accounts`);
      if (Array.isArray(accounts)) {
        existingConnections = accounts.map(a => ({
          id: a.id,
          exchange: a.exchange,
          name: a.exchangeName,
          hint: a.apiKeyHint,
          isDefault: a.isDefault,
        }));
      }
    } catch {
      // Console unreachable — not fatal, continue with empty list
    }

    // 3. Get list of supported exchanges from Console
    let supportedExchanges = [];
    try {
      const registry = await fetchJson(`${consoleUrl}/api/trade/exchanges`);
      if (Array.isArray(registry)) {
        supportedExchanges = registry.map(e => e.id);
      }
    } catch {}

    return {
      detectedExchange,
      userMessage,
      existingConnections,
      supportedExchanges,
      consoleUrl,
      settingsUrl: '/trading',
      taskType,
      availableExchanges: Object.entries(EXCHANGE_GUIDES)
        .filter(([, g]) => !g.unsupported)
        .map(([, g]) => `${g.name}`)
        .join('、'),
    };
  }

  formatForBrain(gathered) {
    let instructions;

    // Show existing connections context
    const connInfo = gathered.existingConnections.length > 0
      ? `\nALREADY CONNECTED: ${gathered.existingConnections.map(c => `${c.name} (${c.hint})`).join(', ')}\n`
      : '\nNo exchanges connected yet.\n';

    // ── Path 2/3: Proactive mode — check if onboarding is needed ──
    if (gathered.taskType === 'proactive') {
      if (gathered.existingConnections.length > 0) {
        // Already connected — no action needed, return empty
        return {
          name: this.name,
          description: 'Exchange onboarding — not needed (already connected)',
          data: gathered,
          instructions: '',
        };
      }
      // No connections — proactively suggest onboarding
      instructions = `
MARKET ONBOARDING OPPORTUNITY:
This user has trading goals but NO exchange connected yet.

Suggest onboarding naturally in your message. Don't be pushy. Example:
"我注意到你还没有接入任何外部市场。如果你有交易所账号（比如${gathered.availableExchanges}），我可以帮你快速接入，之后就能帮你看盘和交易了。需要我来引导吗？"

Only mention this ONCE. If user ignores it, don't repeat.`;

      return {
        name: this.name,
        description: 'Exchange onboarding — proactive suggestion',
        data: gathered,
        instructions: instructions.trim(),
      };
    }

    // ── Path 1: Reactive mode — user initiated ──
    if (gathered.detectedExchange) {
      // ── Situation A: specific exchange detected ──
      const { key, guide } = gathered.detectedExchange;

      const isSupported = gathered.supportedExchanges.includes(key);
      const needsPassphrase = guide.fields.includes('passphrase');

      if (!isSupported && !guide.unsupported) {
        // Exchange in guides but not in Console registry — shouldn't happen, but handle
        instructions = `
USER WANTS TO CONNECT: ${guide.name}
${connInfo}
This exchange is not yet supported by the system. Tell the user:
"${guide.name} 的接入正在开发中，目前支持的交易所有：${gathered.availableExchanges}。
你想先接入其中一个吗？"`;
      } else if (guide.unsupported) {
        instructions = `
USER WANTS TO CONNECT: ${guide.name}
${connInfo}
This exchange is not yet supported. Tell the user:
"${guide.name} 的接入正在开发中，目前支持的交易所有：${gathered.availableExchanges}。
你想先接入其中一个吗？"`;
      } else {
        // Normal flow — supported exchange
        const passphraseStep = needsPassphrase
          ? `\n\n步骤 3b — Passphrase：\n"${guide.name} 还会生成一个 Passphrase（口令），也一起复制给我。"\n`
          : '';

        const passphraseReceive = needsPassphrase
          ? '把 API Key、Secret Key 和 Passphrase 一起发给我。'
          : '把 API Key 和 Secret Key 发给我。';

        instructions = `
USER WANTS TO CONNECT: ${guide.name}
${connInfo}
Your task: guide the user to complete the connection. First ask which mode they prefer.

Say this (output verbatim, do not modify):
"好，我来帮你接入 ${guide.name}。你更喜欢哪种方式？

1. 我来引导你 — 我一步步告诉你怎么操作
2. 我自己来   — 给我一个页面，我自己填

哪种更适合你？"

When user picks 1, guide step by step:

Step 1 — Confirm account:
"你有 ${guide.name} 的账号吗？"
  Yes → continue to Step 2
  No → "没有也没关系，先去注册：${guide.register_url}
        注册完回来找我继续。"

Step 2 — Guide API Key creation:
"好，现在我带你生成 API Key：

  ${guide.api_path}
  名字可以填 KANet

  只勾选：${guide.permissions_required.join('、')}

  ⚠️ 不要勾选：${guide.permissions_forbidden.join('、')}
  ${guide.permission_warning}

  另外注意：${guide.notes}

  做完告诉我，遇到问题随时问我。"
${passphraseStep}
Step 3 — Receive keys:
"好，${passphraseReceive}
 它们只保存在你本地，加密存储，不会明文保留。"

After receiving keys, the system will call:
  POST ${gathered.consoleUrl}/api/trade/accounts
  body: { exchange: '${key}', apiKey: <user's key>, apiSecret: <user's secret>${needsPassphrase ? ", passphrase: <user's passphrase>" : ''} }

Then test with:
  POST ${gathered.consoleUrl}/api/trade/accounts/<id>/test

Success →
"连接成功！我看到你的账户了。
 我已经开始替你盯着市场，你想关注哪些交易对？"

Failure (permissions) →
"API Key 的权限好像没有勾选交易，我带你回去改一下。"

Failure (wrong key) →
"这个 Key 好像不对，我们重新复制一次，注意不要带空格。"

Failure (network) →
"现在连不上，可能是网络问题，稍后再试。"

When user picks 2:
"好，这是接入页面：${gathered.settingsUrl}
 页面上有每个字段的说明，填完保存我会自动验证。
 遇到不懂的随时回来问我。"

IMPORTANT:
- Talk like a knowledgeable friend, not a system prompt
- Never output raw technical error codes to the user
- If user asks questions mid-flow, answer them, then continue the process
- If user has already connected this exchange, mention it: "你已经接入了 ${guide.name}，要更新还是新增一个？"`;
      }
    } else {
      // ── Situation B: no specific exchange detected ──
      instructions = `
USER WANTS TO CONNECT AN EXCHANGE but didn't specify which one.
${connInfo}
Ask them:
"你想接入哪个交易所？目前支持：${gathered.availableExchanges}

告诉我名字，我来一步步带你。"

After user answers, match the exchange name and follow the corresponding guide.
If unrecognized:
"我还不熟悉这个交易所的界面，
 但如果你已经有 API Key，可以直接给我，我来接入。
 或者用这个页面自己填：${gathered.settingsUrl}"`;
    }

    return {
      name: this.name,
      description: 'Exchange onboarding — chat or form mode',
      data: gathered,
      instructions: instructions.trim(),
    };
  }
}
