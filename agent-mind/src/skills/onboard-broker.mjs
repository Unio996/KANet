/**
 * Skill: Onboard Broker — 券商接入引导
 *
 * Agent 通过对话手把手引导用户：
 *   1. 检测有无已连接券商
 *   2. 推荐 Interactive Brokers（当前唯一支持）
 *   3. 引导下载安装 IB Gateway
 *   4. 引导登录并获取账户 ID
 *   5. 在 KANet 中添加并测试连接
 *   6. 连接成功后展示持仓
 */

import { Skill } from './base.mjs';
import { fetchJson } from '../utils.mjs';

// 模块级下载状态（跨调用持久化，重启重置）
let _ibkrDownloadState = { status: 'idle' }; // idle → downloading → downloaded → installed

const BROKER_GUIDES = {
  alpaca: {
    name: 'Alpaca',
    aliases: ['alpaca', '羊驼'],
    registerUrl: 'https://app.alpaca.markets/signup',
    markets: '美股',
    steps: `1. 注册: https://app.alpaca.markets/signup（邮箱注册，秒开）
2. 登录后进入 Dashboard
3. 左侧菜单 → API Keys → 点 Generate
4. 复制 API Key ID 和 Secret Key
5. 回到 KANet 股票页面 → 连接券商 → 选 Alpaca → 填入 Key
6. 点"测试"验证`,
    notes: '零佣金，支持碎股交易。Paper Trading 不需要入金。最简单的券商接入。',
    commonIssues: {
      '注册卡住': '用 Gmail 注册最顺畅。不需要 SSN（社会安全号）就能开 Paper 账户。',
      'Key 不对': '确认用的是 API Key ID（不是 Secret），两个都要填。',
      '能交易什么': '美股全部。支持碎股（0.001 股也能买）。盘前盘后也支持。',
    },
  },
  ibkr: {
    name: 'Interactive Brokers (盈透)',
    aliases: ['盈透', 'ibkr', 'interactive brokers', 'ib gateway', 'ib'],
    registerUrl: 'https://www.interactivebrokers.com',
    markets: '全球 150+ 市场（美股/港股/欧股/期货/期权/外汇）',
    steps: `1. 注册 IBKR 账户: https://www.interactivebrokers.com
2. 下载 IB Gateway: https://www.interactivebrokers.com/en/trading/ibgateway-stable.php
3. 安装后启动，选 Paper Trading 模式
4. 用 IBKR 账号登录，Gateway 显示绿色
5. 回到 KANet 股票页面 → 连接券商 → 选 IBKR
6. 填入账户 ID（Paper 以 DU 开头）和 Gateway 地址
7. 点"测试"验证`,
    notes: '功能最全但设置最复杂。需要保持 IB Gateway 客户端运行。',
    commonIssues: {
      'Gateway 打不开': '检查 Java 是否安装。IB Gateway 需要 Java 运行环境。',
      '登录失败': '确认用 Paper Trading 模式，不是 Live。用户名密码和网站一致。',
      '连接失败': '确认 Gateway 还在运行（最小化不是关闭），窗口显示绿色状态。',
    },
  },
  tradier: {
    name: 'Tradier',
    aliases: ['tradier'],
    registerUrl: 'https://developer.tradier.com/user/sign_up',
    markets: '美股 + 期权',
    steps: `1. 注册开发者账户: https://developer.tradier.com/user/sign_up
2. 登录 Dashboard → API Access
3. 创建或复制 Sandbox Token（模拟盘）
4. 回到 KANet 股票页面 → 连接券商 → 选 Tradier
5. 填入 Access Token
6. 点"测试"验证`,
    notes: '有免费的 Sandbox 环境。期权交易数据比较全。',
    commonIssues: {
      'Token 在哪': 'Dashboard 左侧 API Access，Sandbox Token 用于模拟盘。',
    },
  },
  tiger: {
    name: 'Tiger Brokers (老虎证券)',
    aliases: ['老虎', 'tiger', '老虎证券'],
    registerUrl: 'https://quant.itigerup.com/',
    markets: '美股 / 港股 / A股（沪港通）',
    steps: `1. 注册老虎开发者: https://quant.itigerup.com/
2. 获取 Tiger ID
3. 生成 RSA 密钥对，上传公钥到开发者平台
4. 回到 KANet → 连接券商 → 选 Tiger
5. 填入 Tiger ID 和 RSA Private Key（PEM 格式）
6. 点"测试"验证`,
    notes: '中文界面友好。RSA 签名认证比较复杂，但安全性高。支持 A 股沪港通。',
    commonIssues: {
      'RSA 密钥怎么生成': '用 openssl: openssl genrsa -out private.pem 2048，然后把 public.pem 上传到老虎平台。',
    },
  },
};

function matchBroker(input) {
  const lower = (input || '').toLowerCase();
  for (const [key, guide] of Object.entries(BROKER_GUIDES)) {
    if (guide.aliases.some(a => lower.includes(a.toLowerCase()))) return { key, guide };
  }
  return null;
}

export class OnboardBrokerSkill extends Skill {
  constructor() {
    super('onboard_broker', 'Guide user to connect stock brokers (IBKR, Alpaca, Tradier, Tiger) for real-market trading');
  }

  canActivate(taskType, context) {
    if (taskType === 'reactive') {
      // owner 通过聊天室发消息时 relation 是 'sibling'（因为 sender 是 relay 地址）
      // 所以允许 owner + sibling 触发
      const relation = context?._senderRelation;
      if (relation && !['owner', 'sibling'].includes(relation)) return false;

      const msg = (context?._inputMessage || '').toLowerCase();
      return /券商|盈透|ibkr|interactive.?brokers?|ib.?gateway|股票交易|连接.*broker|接入.*broker|怎么买股票|怎么交易股票|美股|港股|开户|alpaca|tradier|tiger|老虎/.test(msg);
    }

    if (taskType === 'proactive') {
      const goals = context?.intent?.currentGoals || [];
      return goals.some(g =>
        g.status === 'active' &&
        /股票|美股|港股|A股|盈透|ibkr|broker|券商/i.test(g.text)
      );
    }

    return false;
  }

  async gatherContext(kernels, config) {
    const consoleUrl = config.consoleUrl || 'http://localhost:3100';
    const userMessage = config.userMessage || config.lastMessage || '';
    const taskType = config._taskType || 'reactive';

    let existingBrokers = [];
    try {
      const accounts = await fetchJson(`${consoleUrl}/api/broker/accounts`);
      if (Array.isArray(accounts)) {
        existingBrokers = accounts.map(a => ({
          id: a.id,
          name: a.name,
          type: a.broker_type,
          accountId: a.account_id,
          status: a.status,
          paper: a.paper_trading,
        }));
      }
    } catch {}

    // 检测系统信息 + IB Gateway 是否已安装/运行
    let systemInfo = { platform: 'win32' };
    let ibGatewayRunning = false;
    try {
      systemInfo = await fetchJson(`${consoleUrl}/api/system/info`);
    } catch {}
    try {
      const proc = await fetchJson(`${consoleUrl}/api/system/check-process?name=ibgateway`);
      ibGatewayRunning = proc?.running || false;
    } catch {}

    const detectedBroker = matchBroker(userMessage);
    const availableBrokers = Object.values(BROKER_GUIDES).map(g => `${g.name}(${g.markets})`).join('、');

    // ── IBKR 自动执行：后台下载 + 状态轮询 ──
    let autoInstallResult = null;
    if (detectedBroker?.key === 'ibkr' && !ibGatewayRunning && taskType === 'reactive') {
      const platform = systemInfo?.platform || 'win32';
      const actionId = platform === 'darwin' ? 'ibkr-gateway-macos' : platform === 'linux' ? 'ibkr-gateway-linux' : 'ibkr-gateway-windows';

      // 先检查 IB Gateway 是否已安装（检查常见安装路径）
      let alreadyInstalled = false;
      try {
        const checkInstalled = await fetchJson(`${consoleUrl}/api/system/check-process?name=ibgateway`);
        if (checkInstalled?.running) { alreadyInstalled = true; }
      } catch {}
      if (!alreadyInstalled) {
        // 检查安装目录是否存在
        try {
          const checkDir = await fetchJson(`${consoleUrl}/api/system/check-installed?name=ibgateway`);
          if (checkDir?.installed) { alreadyInstalled = true; }
        } catch {}
      }

      if (alreadyInstalled) {
        autoInstallResult = { status: 'already_installed', message: 'IB Gateway 已安装' };
      } else {
      // 检查当前下载状态
      const state = _ibkrDownloadState;

      if (state.status === 'idle') {
        // 首次触发：启动后台下载（不 await）
        console.log(`[onboard-broker] Starting background download of IB Gateway (${platform})...`);
        _ibkrDownloadState = { status: 'downloading', startedAt: Date.now(), actionId };

        // 后台下载 — 不阻塞 gatherContext
        fetchJson(`${consoleUrl}/api/system/download`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actionId }),
        }).then(dlResult => {
          if (dlResult.ok && dlResult.filePath) {
            console.log(`[onboard-broker] Download complete: ${(dlResult.size / 1024 / 1024).toFixed(1)} MB`);
            _ibkrDownloadState = { status: 'downloaded', filePath: dlResult.filePath, size: dlResult.size, cached: dlResult.cached };
            // 自动启动安装程序
            fetchJson(`${consoleUrl}/api/system/run`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filePath: dlResult.filePath }),
            }).then(runResult => {
              if (runResult.ok) {
                console.log(`[onboard-broker] Installer launched: PID ${runResult.pid}`);
                _ibkrDownloadState = { ..._ibkrDownloadState, status: 'installed', pid: runResult.pid };
              } else {
                console.log(`[onboard-broker] Installer failed: ${runResult.error}`);
                _ibkrDownloadState = { ..._ibkrDownloadState, status: 'install_failed', error: runResult.error };
              }
            }).catch(e => {
              _ibkrDownloadState = { ..._ibkrDownloadState, status: 'install_failed', error: e.message };
            });
          } else {
            console.log(`[onboard-broker] Download failed: ${dlResult.error}`);
            _ibkrDownloadState = { status: 'failed', error: dlResult.error };
          }
        }).catch(e => {
          console.error(`[onboard-broker] Download error:`, e.message);
          _ibkrDownloadState = { status: 'failed', error: e.message };
        });

        autoInstallResult = { status: 'downloading', message: '正在后台下载 IB Gateway 安装包...' };

      } else if (state.status === 'downloading') {
        const elapsed = Math.round((Date.now() - state.startedAt) / 1000);
        autoInstallResult = { status: 'downloading', elapsed, message: `正在下载中（已 ${elapsed} 秒）...` };

      } else if (state.status === 'downloaded') {
        autoInstallResult = { status: 'downloaded', filePath: state.filePath, size: state.size, cached: state.cached };

      } else if (state.status === 'installed') {
        autoInstallResult = {
          status: 'installed',
          downloaded: true, installerLaunched: true,
          filePath: state.filePath, fileSize: state.size, pid: state.pid, cached: state.cached,
        };

      } else if (state.status === 'failed' || state.status === 'install_failed') {
        autoInstallResult = { status: state.status, downloaded: false, error: state.error };
        // 重置，允许重试
        _ibkrDownloadState = { status: 'idle' };
      }
      } // closes the else block from alreadyInstalled check
    }

    return { existingBrokers, userMessage, consoleUrl, taskType, detectedBroker, availableBrokers, systemInfo, ibGatewayRunning, autoInstallResult };
  }

  formatForBrain(gathered) {
    const connected = gathered.existingBrokers.filter(b => b.status === 'connected');
    const connInfo = gathered.existingBrokers.length > 0
      ? `\nALREADY CONNECTED: ${gathered.existingBrokers.map(b => `${b.name} (${b.type}, ${b.status}${b.paper ? ', 模拟盘' : ''})`).join(', ')}\n`
      : '\nNo brokers connected yet.\n';

    if (gathered.taskType === 'proactive') {
      if (connected.length > 0) {
        return { name: this.name, description: 'Broker onboarding — not needed', data: gathered, instructions: '' };
      }
      return {
        name: this.name,
        description: 'Broker onboarding — proactive suggestion',
        data: gathered,
        instructions: `BROKER ONBOARDING OPPORTUNITY:
User has stock-related goals but no broker connected.
Available brokers: ${gathered.availableBrokers}
Suggest naturally: "我注意到你对股票交易感兴趣。KANet 支持接入多家券商（${gathered.availableBrokers}），其中 Alpaca 最简单，几分钟就能搞定。需要我帮你设置吗？"
Only mention ONCE.`.trim(),
      };
    }

    let instructions;

    if (connected.length > 0 && !gathered.detectedBroker) {
      instructions = `
USER ASKS ABOUT BROKER CONNECTION.
${connInfo}
Already connected — tell user which brokers are connected and offer to add more.
Available: ${gathered.availableBrokers}`;
    } else if (gathered.detectedBroker) {
      // 用户指定了具体券商
      const { key, guide } = gathered.detectedBroker;
      const issuesText = Object.entries(guide.commonIssues || {})
        .map(([q, a]) => `- "${q}" → "${a}"`)
        .join('\n');

      // IBKR 特殊：Agent 可以自动下载安装
      const platform = gathered.systemInfo?.platform || 'win32';
      const platformName = platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux' : 'Windows';
      const downloadActionId = platform === 'darwin' ? 'ibkr-gateway-macos' : platform === 'linux' ? 'ibkr-gateway-linux' : 'ibkr-gateway-windows';

      if (key === 'ibkr') {
        if (gathered.ibGatewayRunning || gathered.autoInstallResult?.status === 'already_installed') {
          const isRunning = gathered.ibGatewayRunning;
          instructions = `
USER MENTIONS IBKR. IB Gateway is ALREADY ${isRunning ? 'RUNNING' : 'INSTALLED'} on this machine!
DO NOT download or install anything. DO NOT launch any installer.
${connInfo}
Tell user: "${isRunning ? 'IB Gateway 已经在运行了' : 'IB Gateway 已经安装好了'}！现在只需要在 KANet 中连接：
1. 打开股票页面 → 点'连接券商'
2. 选 Interactive Brokers
3. 填入账户 ID（Paper 以 DU 开头）
4. Gateway 地址保持默认 https://localhost:5000
5. 点'添加'，然后点'测试'

你的账户 ID 是什么？我帮你填。"`;
        } else if (gathered.autoInstallResult?.status === 'downloading') {
          // ── 后台下载中 ──
          const elapsed = gathered.autoInstallResult.elapsed || 0;
          instructions = `
USER WANTS TO CONNECT IBKR. I am downloading IB Gateway in the background.
${connInfo}
Download status: IN PROGRESS (${elapsed}s elapsed)

Tell the user EXACTLY:
"我正在后台下载 IB Gateway 安装包（约 300MB），请稍等几分钟。
下载完成后我会自动启动安装程序，你不需要做任何操作。
下载进度可以在下次发消息时看到。"

DO NOT ask any questions. DO NOT ask about OS or account.
The download is ALREADY HAPPENING in the background.`;
        } else if (gathered.autoInstallResult?.status === 'installed' || gathered.autoInstallResult?.installerLaunched) {
          // ── 已经自动下载并启动安装程序 ──
          const r = gathered.autoInstallResult;
          instructions = `
USER WANTS TO CONNECT IBKR. I HAVE ALREADY DONE THE FOLLOWING FOR YOU:
✅ Downloaded IB Gateway installer (${(r.fileSize / 1024 / 1024).toFixed(1)} MB${r.cached ? ', from cache' : ''})
✅ Launched the installer (PID ${r.pid})

The installer window should now be visible on the user's screen.

Tell the user EXACTLY this:
"我已经帮你下载并启动了 IB Gateway 安装程序（${(r.fileSize / 1024 / 1024).toFixed(1)} MB），安装向导应该已经弹出来了。

请在安装向导中：
1. 点 Next 完成安装（默认设置即可）
2. 安装完成后会自动启动 IB Gateway
3. 在 Gateway 登录界面选 Paper Trading 模式
4. 用你的盈透账号密码登录
5. 登录成功后 Gateway 会显示绿色状态

登录好了告诉我，我来帮你在 KANet 里连接。"

DO NOT say you cannot install software. You ALREADY DID IT.
DO NOT ask for confirmation. The installer is ALREADY RUNNING.
DO NOT describe what you "would" do. Report what you HAVE DONE.`;
        } else if (gathered.autoInstallResult && !gathered.autoInstallResult.downloaded) {
          // 下载失败
          instructions = `
USER WANTS TO CONNECT IBKR. Auto-install FAILED: ${gathered.autoInstallResult.error}
${connInfo}
Tell user the download failed and give manual steps:
${guide.steps}

COMMON ISSUES:
${issuesText}`;
        } else {
          // 没检测到 IBKR 关键词 — 通用引导
          instructions = `
USER WANTS TO CONNECT IBKR.
${connInfo}
Guide with manual steps:
${guide.steps}

Notes: ${guide.notes}

CRITICAL: OUTPUT ALL STEPS IN ONE MESSAGE.`;
        }
      } else {
        // 非 IBKR 券商 — 纯指引
        instructions = `
USER WANTS TO CONNECT: ${guide.name}
${connInfo}
Market coverage: ${guide.markets}

Guide step by step:
${guide.steps}

Notes: ${guide.notes}

COMMON ISSUES:
${issuesText}

After user completes setup, tell them to click "测试" to verify.

CRITICAL INSTRUCTIONS:
- OUTPUT ALL STEPS IN ONE MESSAGE.
- You are a KANet Agent running locally. For ${guide.name} you guide the user through API key setup.
- Include the registration URL, every click path, and what to fill in KANet — all in one response.
- Talk like a knowledgeable friend, not a manual.`;
      }
    } else {
      // 用户没指定券商 — 推荐
      instructions = `
USER WANTS TO CONNECT A BROKER but didn't specify which one.
${connInfo}
Available brokers: ${gathered.availableBrokers}
REMEMBER: You are a KANet AI Agent. You cannot install software, access files, or control the user's computer. You give instructions, the user executes them.

Recommend based on user needs:
- 最简单/新手 → Alpaca（零佣金，纯 API Key，秒开）
- 全球市场 → IBKR（150+ 市场，需要 Gateway 客户端）
- 美股+期权 → Tradier（有免费 Sandbox）
- 港股/A股 → Tiger 老虎证券（中文界面，支持沪港通）

Ask: "你想交易什么市场？我来推荐最适合的券商：
- 只要美股 → Alpaca 最简单，几分钟搞定
- 美股+港股+期货 → 盈透证券，全球什么都能交易
- 美股+期权 → Tradier
- 港股+A股 → 老虎证券

你偏向哪个？"`;
    }

    return {
      name: this.name,
      description: 'Broker onboarding — multi-broker guide',
      data: gathered,
      instructions: instructions.trim(),
    };
  }
}
