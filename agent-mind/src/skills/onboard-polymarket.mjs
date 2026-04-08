/**
 * Skill: Onboard Polymarket — 预测市场接入引导
 *
 * Agent 通过对话手把手引导用户：
 *   1. 检测有无 Polygon 钱包 → 没有则引导创建
 *   2. 检测 USDC 余额 → 为零则引导充值
 *   3. 检测 USDC 授权状态 → 未授权则引导授权
 *   4. 检测 CLOB API Key → 没有则引导设置
 *   5. 全部就绪 → 引导下第一单
 */

import { Skill } from './base.mjs';
import { fetchJson } from '../utils.mjs';

export class OnboardPolymarketSkill extends Skill {
  constructor() {
    super('onboard_polymarket', 'Guide user to set up Polymarket prediction market trading');
  }

  canActivate(taskType, context) {
    if (taskType === 'reactive') {
      const relation = context?._senderRelation;
      if (relation && !['owner', 'sibling'].includes(relation)) return false;

      const msg = (context?._inputMessage || '').toLowerCase();
      return /polymarket|预测市场|预测交易|prediction.?market|怎么.*预测|怎么.*polymarket|poly.*怎么|押注|下注|赌.*概率|概率.*交易|usdc.*polygon|polygon.*usdc/.test(msg);
    }

    if (taskType === 'proactive') {
      const goals = context?.intent?.currentGoals || [];
      return goals.some(g =>
        g.status === 'active' &&
        /预测|polymarket|prediction|押注|概率|polygon/i.test(g.text)
      );
    }

    return false;
  }

  async gatherContext(kernels, config) {
    const consoleUrl = config.consoleUrl || 'http://localhost:3100';
    const relayNodeId = config.relayNodeId;
    const userMessage = config.userMessage || config.lastMessage || '';
    const taskType = config._taskType || 'reactive';

    // 查询 Polymarket 状态
    let status = { hasWallet: false, approved: false, hasClobKey: false, usdc: 0 };
    try {
      status = await fetchJson(`${consoleUrl}/api/polymarket/${relayNodeId}/status`);
    } catch {}

    return { status, userMessage, consoleUrl, relayNodeId, taskType };
  }

  formatForBrain(gathered) {
    const s = gathered.status || {};

    if (gathered.taskType === 'proactive') {
      if (s.hasWallet && s.approved && s.hasClobKey && s.usdc > 0) {
        return { name: this.name, description: 'Polymarket onboarding — already set up', data: gathered, instructions: '' };
      }
      if (!s.hasWallet) {
        return {
          name: this.name,
          description: 'Polymarket onboarding — proactive wallet suggestion',
          data: gathered,
          instructions: `User has prediction-related goals but no Polygon wallet.
Suggest naturally: "我注意到你对预测市场感兴趣。要参与 Polymarket 交易需要一个 Polygon 钱包，我可以帮你设置。需要我引导吗？"
Only mention ONCE.`.trim(),
        };
      }
    }

    // 构建状态检查清单
    const steps = [];
    let nextStep = '';

    if (!s.hasWallet) {
      steps.push('[ ] 创建 Polygon 钱包');
      steps.push('[ ] 充值 USDC');
      steps.push('[ ] 授权 USDC');
      steps.push('[ ] 设置 API Key');
      nextStep = 'create_wallet';
    } else if ((s.usdc || 0) <= 0) {
      steps.push('[x] 创建 Polygon 钱包');
      steps.push('[ ] 充值 USDC');
      steps.push('[ ] 授权 USDC');
      steps.push('[ ] 设置 API Key');
      nextStep = 'fund_usdc';
    } else if (!s.approved) {
      steps.push('[x] 创建 Polygon 钱包');
      steps.push('[x] 充值 USDC');
      steps.push('[ ] 授权 USDC');
      steps.push('[ ] 设置 API Key');
      nextStep = 'approve';
    } else if (!s.hasClobKey) {
      steps.push('[x] 创建 Polygon 钱包');
      steps.push('[x] 充值 USDC');
      steps.push('[x] 授权 USDC');
      steps.push('[ ] 设置 API Key');
      nextStep = 'setup_key';
    } else {
      steps.push('[x] 创建 Polygon 钱包');
      steps.push('[x] 充值 USDC');
      steps.push('[x] 授权 USDC');
      steps.push('[x] 设置 API Key');
      nextStep = 'ready';
    }

    const checklist = steps.join('\n');

    let instructions;

    if (nextStep === 'ready') {
      instructions = `
USER ASKS ABOUT POLYMARKET. Setup is COMPLETE.
${checklist}
USDC Balance: ${s.usdc?.toFixed(2)} USDC

Tell user:
"你的 Polymarket 已经设置好了！余额 ${s.usdc?.toFixed(2)} USDC，可以直接交易。

打开预测市场页面，找到感兴趣的事件，点'交易'就能下单。

几个小提示：
- 买 Yes = 押注事件发生，买 No = 押注不发生
- 每份合约最终值 $1（对了）或 $0（错了）
- 可以随时卖出（不用等到结算）
- 低价差(< 5%)的市场更容易成交

想看看现在有什么热门事件吗？"`;
    } else if (nextStep === 'create_wallet') {
      instructions = `
USER ASKS ABOUT POLYMARKET. Needs Polygon wallet first.
${checklist}

Tell user:
"好，我来帮你设置 Polymarket。Polymarket 运行在 Polygon 链上，用 USDC 交易。

首先需要创建一个 Polygon 钱包。按这个步骤：

1. 打开 KANet 的 Agent 页面
2. 选你想用来交易的 Agent
3. 切到'钱包'标签
4. 点'+ 创建钱包'，选 Polygon 链
5. 创建完成后会显示钱包地址

创建好告诉我，我带你继续下一步。"`;
    } else if (nextStep === 'fund_usdc') {
      instructions = `
USER ASKS ABOUT POLYMARKET. Has wallet but no USDC.
${checklist}
Wallet: ${s.address}

Tell user:
"钱包已经有了，地址是：
${s.address}

现在需要充值 USDC 到这个地址。几个方式：

1. 从交易所提现 USDC 到 Polygon 网络的这个地址
   (Binance/OKX 等都支持 Polygon 网络提 USDC)
2. 从其他 Polygon 钱包直接转 USDC 过来
3. 用跨链桥把其他链的 USDC 桥到 Polygon

注意：一定要选 Polygon 网络（不是以太坊主网），否则资金到不了。

建议先充一小额（比如 $10-20）试试，确认没问题再充更多。

充值完成后告诉我，我帮你完成后续设置。"`;
    } else if (nextStep === 'approve') {
      instructions = `
USER ASKS ABOUT POLYMARKET. Has USDC but not approved.
${checklist}
USDC Balance: ${s.usdc?.toFixed(2)}

Tell user:
"USDC 已到账 ${s.usdc?.toFixed(2)}。

下一步需要授权 Polymarket 合约使用你的 USDC（标准的 ERC20 approve 操作）。

打开预测市场页面，在顶部会看到一个'授权 USDC'按钮。
点击后等待 Polygon 链确认（通常 10-30 秒）。
确认后按钮会变成绿色'已授权'。

这是一次性操作，之后就不需要再授权了。

点完告诉我结果。"`;
    } else if (nextStep === 'setup_key') {
      instructions = `
USER ASKS ABOUT POLYMARKET. Approved but no API key.
${checklist}

Tell user:
"最后一步 — 设置 Polymarket API Key。

在预测市场页面顶部，点'设置 API Key'按钮。
系统会用你的 Polygon 钱包自动签名注册，不需要手动输入任何东西。

完成后你就可以开始交易了。

点完告诉我。"`;
    }

    return {
      name: this.name,
      description: `Polymarket onboarding — next step: ${nextStep}`,
      data: gathered,
      instructions: (instructions || '').trim(),
    };
  }
}
