// ════════════════════════════════════════════════════════════════
// HIGH-RISK FILE (Critical 8 per docs/COLLAB-REFORM.md 规 10/13/15)
// 改前必跑: grep -nE 'T-J[0-9]+-|T-NWT-|Bug-[A-Z][0-9]+' 本 file
// 改后 commit msg 必含: acknowledged: T-X-X (per surfaced anti-pattern)
// 关联 lint: scripts/lint-kanet.mjs R37 (单 system msg literal)
// 关联 docs: ANTI-PATTERNS R37 / QWEN-RULES Rule 13 / DEVELOPER-GUIDE ch19
// 关键历史: T-J1-19f (双 system msg 撤回), R33 wire reintroduce, Bug-Z24 修
// blast radius: LLM call format / SYSTEM_PROMPT / state lock / tool 调用
// ════════════════════════════════════════════════════════════════
//
// broker-llm-agent.js — R6 broker = LLM 销售客服 (T-NWT-18)
// Owner 钦定 4 步: 方向 → 字段补全 → 复述确认 → 调 finalize_order tool
// 双层架构上层 (LLM Bot), 下层调 broker-buy-handler.finalizeBuy / broker-sell-handler.finalizeSell

import { sqlite } from '../db/client.js';
import { listAssets, listChainsFor, getAsset } from './asset-registry.js';
import {
  setConvoStateLock,
  resetConvoState,
  llmSystemPromptStateLock,
  validateLlmReply,
} from './broker-state-authority.js';

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';

// T-J2-2026-04-27 v1.1 Phase E generic minimal — 动态 supported assets section from asset-registry
// (Owner 23:43 钦定真碰撞: NWT vote (a) "SYSTEM_PROMPT 留 v1.2" 真灾难 — user 'buy USDC' LLM
// KAS-only 走错 path 真 dispute. J2 真接 ship minimal generic 让 LLM 真识别 supported assets).
const SUPPORTED_ASSETS_SECTION = (() => {
  const lines = [];
  for (const sym of listAssets()) {
    const chains = listChainsFor(sym);
    if (sym === 'KAS') {
      lines.push(`- KAS (Kaspa native, 默认 give_asset, broker 自挂卖)`);
    } else {
      lines.push(`- ${sym} (跨链支持: ${chains.join(' / ')}, broker BSC 真持库存可发)`);
    }
  }
  return lines.join('\n');
})();

// T-J2-2026-04-27 v1.2 SYSTEM_PROMPT aggressive trim (Owner 钦定: 正则不可取, Qwen 没用好).
// 真 redesign: tool-use first, 30 lines target, 砍 cumulative cruft.
// 真 root cause = 100+ 行 prompt 真 crowd out tool selection signal. Qwen3.6 看长 prompt 真
// hallucinate KAS default 真 fall free-text NLG 真 not call tool.
// 真 strategy: 真 emphasize 'MUST CALL tool' first, 真简化字段问 flow, 真 trim cruft 真 v1.2.
const SYSTEM_PROMPT = `你是 KANet broker, 帮用户买卖 KAS / USDT / USDC. 跨 9 chain (BSC/ETH/Polygon/Arb/Op/Avax/Base/Sol/Tron).

# 语言铁律 (Owner 04-29 真测撞)

你的回复**全程中文**. 用户用什么语言无所谓 — 你回复一律中文 (普通话, 简体). 严禁中英文混杂回复, 严禁切换英文 ("Got it" / "what do you want to sell" 等)。Bug-Z26 production: Owner "Bsc,0x..." 中文输入, broker 回 "Got it, what do you want to sell" 英文, Owner 火大. 全程中文 0 例外.

# 上下文铁律 (Owner 21:46 钦定)

你必记得 user 之前 N turn 给过的全 fields (direction/qty/chain/addr/asset/limit_price/refund_timeout). 用户已说过的, 你不重问. 如果 system message 注入 'KNOWN USER FIELDS' OR 'CRITICAL CONVERSATION STATE' OR '最近对话 user 给过的字段', 你必 reference 这些 fields, 不准 hallucinate "请重新提供" / "上下文丢失" / "麻烦再告诉我". user 火大根源是你假装 forget — 不准.

# 你最重要的 5 件事 (永远不能忘)

1. **字段齐 → 必调 preview_order tool**. 字段 = 方向(买/卖) + 数量 + 资产(KAS/USDT/USDC) + 链 + 收款地址(买 stable 或 卖 时必填). 不准自己编报价, 不准自己说 '订单画像', preview 必经 tool.
2. **用户回 YES/确认/对 → 必调 finalize_order tool**. 不准自己说 '已下单'.
3. **用户说 已付/付了/check / paid / sent / done / 搞定 / 转了 / 汇了 / 已经支付 / PAID → 必调 verify_payment tool** (不论是否带 0x tx hash). 不带 hash 时 verify_payment 自动反查 BSC 收款地址近 75 分钟. **严禁静默不答** — 任何 "已付" 类信号必触发 tool, 没 active offer 也调 verify_payment 让 tool 返 deterministic null/no-op (Bug-A production 灾难: Owner 12:18 '已付!' broker 静默, user 1.88 USDT 卡 broker).
4. **用户 cancel/取消/不要了/退我钱/cancel/refund/我等不了了/算了 等任何 cancel-intent → 必调 cancel_order tool**. 不准自己说 '已为您取消' / '资金 1-2 分钟到账' / '已退还' — 这些是 broker DB cancel + sendKas 的真实结果, 必经 tool. 不准编 fake ack (Bug-Z19 production 灾难). 即使没 active offer, 也调 cancel_order tool, 它返 deterministic null/no-op 让 LLM 不要 hallucinate.
5. **finalize_order 是 user 同意购买 (YES on preview) 才调**, 不是 user 完成付款的信号. user 说 "已付/paid" 是付款已完成的信号 → 必调 verify_payment, 严禁错调 finalize_order (T-NWT-2026-04-28 Bug-A 双保险 配 J2 PAID_NO_TX_REGEX deterministic 兜底).

# 用户自定条件 (R33 b 铁律 — Owner 真测 B3 反复撞)

用户提**限价**或**退款时限**时**必 capture** 进 preview_order tool args:
- limit_price: 用户说 "挂单价 0.0336" / "我的限价是 0.034" / "价不低于 X" → 填 limit_price
- refund_timeout_min: 用户说 "10分钟内没人吃就退" / "30min 没成交退我" → 填 refund_timeout_min

**严禁静默丢 user 条件**. broker preview 必反映用户给的限价 + 退款时限, 或显式说 'broker 暂不支持 X 条件 (默认市价 ±1%, 默认 2h timeout)'. 静默用市价 spread + 默认 timeout = bug.

# 字段收集 (一字段一问, 别一次问全)

缺方向: 直接判定 (买/想买/想要/get/want/buy → buy; 卖/抛/sell/dump → sell). 不问 '买还是卖'.
缺资产: '买 KAS / USDC / USDT?' (默认 KAS)
缺数量: '多少?'
缺链: '哪个链? (BSC / Polygon / SOL / TRON)'
缺地址 (买 stable 或 卖): '你 EVM 收款地址 (0x... 42位)?'
**字段齐立刻调 preview_order tool.**

# tool 返 preview_text → 你 100% 原样转发 (一字不改地址不缩写)

LLM 编 0x 地址 = user 转钱到 fake 地址 = 灾难. preview_text 含真 broker 地址, 你必须整段照转.

# 用户消息处理铁律

- 多字段 one-shot ('买 0.5 USDC, BSC, 0x...') → 字段齐, **直接调 preview_order tool** (不要自己编 reply 也不要再问)
- 'YES' 无 prior preview → '抱歉, 我没找到你的 active 订单. 重新告诉我数量+链.' (绝不说 '订单争议中' '通知 Owner')
- '我付了 0xabc...' → handler 已自动 verify (你只 ack '收到 tx, 验证中, ~30-60s 发 KAS')

# 信任问答 (KANet 最大卖点 — 必须自豪讲清楚)

用户问 '你跑了怎么办 / 钱去哪 / 安全吗 / 你拿了我的钱怎么办 / 谁担保 / maker 是谁'
→ **必答** (一字不改, 这是 KANet vs Binance/Coinbase 真正差异化):

  '我是 KANet broker, 不持币不托管. 你 USDT 直接付给 maker, 我永远不碰你的钱.
   流程: 你转 USDT → maker 链上收 → 自动验证 → 我代你转 KAS 到你 Kasia 地址.
   就算我跑路, 你 USDT 在 maker 那, 我手里 0 资金可拿. 你的 KAS 也直接到你自己钱包.
   broker fee 固定 0.1 KAS. 30min 没付自动取消, 钱不动. 全程链上可验证.'

如果用户继续追问 maker 身份: 'maker 是市场上提供流动性的真实对手方, 可能是任何人. 我帮你撮合最好价, 不当对手方.'

# 风格 + 约束

中文回中文, 英文回英文. 简洁友好不机械. 不持币非托管, broker fee 0.1 KAS 固定.`;

const TOOLS = [
  // 议 B (Owner 19:55+ 钦定): 字段齐时**必调** preview_order 不调 finalize_order.
  // broker 算价 + maker 但**不真 publish** 不 set _pendingAccepts. 返完整画像数据 LLM 用真数据
  // 渲染 DM 让 user 最后 YES 确认. user YES → 才调 finalize_order.
  {
    type: 'function',
    function: {
      name: 'preview_order',
      description: '议 B: step 3 字段齐时必调此 (不调 finalize_order). broker 算价 + maker 但不真 publish, 返完整 preview 数据 (单价/总额/maker 地址/user_kasia/TTL) 让你用真数据自然话渲染完整订单画像 DM 让 user 最后 YES 确认. user YES 后才调 finalize_order.',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['buy', 'sell'] },
          give_asset: { type: 'string', description: 'asset symbol user 想买/卖 (KAS / USDT / USDC / 等 supported list 见 SYSTEM_PROMPT). 默认 KAS 真 backward compat.' },
          qty: { type: 'number', description: 'asset 数量 (>= asset.minQty)' },
          chain: { type: 'string', enum: ['bnb', 'polygon', 'sol', 'tron'] },
          address: { type: 'string', description: '买 stable (USDC/USDT) 必填 user EVM 收款地址 (0x...42位); 买 KAS 不填 (broker 用 user kasia); 卖必填 user 收 USDT 地址 (EVM/SOL/TRON).' },
          // R33 b iter2 (J1 NWT GAP B 修): user 自定 conditions 必 capture, 不能静默丢.
          limit_price: { type: 'number', description: 'OPTIONAL: user 显式指定限价 (USDT/KAS). 用户提 "挂单价 0.0336" / "limit 0.034" / "价不低于 X" 必填此. broker 用此 vs 市价决定接受 OR 拒, 不准静默丢. 不提则按市价 ±1% spread.' },
          refund_timeout_min: { type: 'number', description: 'OPTIONAL: user 显式指定退款时限 (分钟). 用户提 "10分钟内没人吃单退还" / "30min refund" 必填此. broker 用此覆盖默认 2h timeout, 不准静默丢. 不提则用 broker 默认 120min.' },
        },
        required: ['direction', 'qty', 'chain'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finalize_order',
      description: 'step 4: 用户**已 preview 确认 (YES)** 后才调用. 触发 broker 协议层真下单. 买路径 broker 帮接最佳 maker (USDT 你直付 maker 不经 broker), 卖路径 broker 收 KAS 后挂卖单. **不要在 user YES 之前调此 — 必须先调 preview_order**.',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['buy', 'sell'] },
          give_asset: { type: 'string', description: 'asset symbol user 想买/卖. 默认 KAS. 必跟 preview_order 时同 asset.' },
          qty: { type: 'number', description: 'asset 数量 (>= asset.minQty)' },
          chain: { type: 'string', enum: ['bnb', 'polygon', 'sol', 'tron'], description: '买 = 你付 USDT 的链; 卖 = 你收 USDT 的链' },
          address: { type: 'string', description: '买 stable (USDC/USDT) 必填 user EVM 收款地址 (0x...42位, broker 把 stable 发到这地址); 买 KAS 不填 (broker 用 user kasia); 卖必填 (你 USDT 收哪 EVM/SOL/TRON 格式).' },
        },
        required: ['direction', 'qty', 'chain'],
      },
    },
  },
  // T-J2-V2 (Owner 真测 #2 退场后立项): 用户说 "已付/已经支付/付过了/check my payment / 你帮我查"
  // 但没贴 tx hash → 你必须先调此 tool 自动反查 BSC, 不要让用户手贴 hash.
  {
    type: 'function',
    function: {
      name: 'verify_payment',
      description: '用户说已付但没给 tx hash 时调此. broker 反查 BSC 收款地址近 5min 是否有匹用户报价 USDT 的入账. 找到自动推 paid_v1 → 自动验证 + 自动发 KAS, 用户不需要手贴 hash. 找不到才回引导用户发 hash 或截图.',
      parameters: {
        type: 'object',
        properties: {
          chain: { type: 'string', enum: ['bnb', 'polygon'], description: '用户付款链 (BSC=bnb 主路径)' },
        },
        required: ['chain'],
      },
    },
  },
  // R26 Bug-Z19 (NWT 25d4ae81 Owner 真测撞): user cancel-intent 时 LLM 真**真**真 hallucinate fake ack
  // ('已为您取消, 1-2 分钟到账') 真**真 tool call. 加 cancel_order tool 真**真 LLM 必调.
  {
    type: 'function',
    function: {
      name: 'cancel_order',
      description: '用户说 NO/取消/不要了/退我钱/cancel/refund/我等不了了/算了 等任何 cancel-intent 时必调此 tool. 不准自己回 "已取消" / "1-2 分钟到账" / "已为您取消" — 这些是 broker DB cancel + sendKas 的真实结果, 必经此 tool. 即使没 active offer 也调此 tool, 它返 deterministic null/no-op, 让 LLM 不要 hallucinate.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
];

// T-J1-19d (NWT retest 中文 6/6 失败 fix): Qwen3.6 中文 instruction-following 弱.
// SYSTEM_PROMPT "跳过方向问" 在英/西生效, 中文 6/6 失败. Owner 主要语言中文必撞.
// 修: 用确定性 regex 预检测 intent, 注入额外 system hint 强制 LLM 跳过 step 1.
// 仅当 message 同时含 (中文/英/西/日/韩 方向词) + 'kas' 才认 intent, 防误杀闲聊.
export function _detectIntent(message) {
  const msg = String(message || '').trim();
  if (!msg) return null;
  // T-J2-2026-04-27 v1.1 deterministic 真扩 multi-asset (Owner 24:14 钦定真感受 + J2 真测撞 LLM USDC 真不稳定):
  // 加 USDT/USDC keyword gate, 跟 KAS 同 fast deterministic path 真稳 ~15ms vs LLM 1-2s 不稳.
  if (!/kas|usdt|usdc/i.test(msg)) return null;
  // 中文 — 严格匹方向词 (gated by /kas/ 防 '我要吃饭' 误判)
  // T-J1-19k (NWT 30 轮 dynamic 发现): 加非正式动词 想换/换/搞/弄/要/想要/来/要点 + 同义
  // T-NWT-25: 加更多口语动词 (拿/收/抢/入手/取/进/求/欲/给我来/帮我搞/吃进 等)
  // T-NWT-2026-04-27 Bug-Z4: SELL check 真先 (specificity wins).
  // 之前 BUY 在前 → '我要卖 99 KAS' 真撞 BUY '我要' substring → 误判. SELL 真先 catch '卖' 真对.
  // J2 vote (a) 真 ack — '我要 5 KAS' (无方向) 真 fall BUY '我要' = buy 真对; '我要买' BUY '买' 真对;
  // '我要换' BUY '换' 真对; '我要卖' SELL '卖' = sell 真对 (Bug-Z4 真 fix).
  if (/卖|要卖|想卖|出售|卖出|脱手|抛|出货|清仓|换出|套现|减仓|平仓|放/.test(msg)) return 'sell';
  if (/买|要买|想买|购买|买入|想换|换点|换些|换\s*\d|搞|弄|来点|来个|要点|想要|我要|拿|收\s*kas|抢|入手|入仓|入个|取|进|求|欲|给我来|帮我搞|帮我换|帮我买|想吃|吃进/.test(msg)) return 'buy';
  // 英 / 西 (\\b 适用 ASCII) — 真同 swap (sell 真先, sell 词 specific)
  // T-J2-2026-04-27 v1.1: 真扩英文 buy/sell 同义词 (J2 24:45 真测撞 'want 5 USDC' → LLM 1331ms 真不稳).
  // 真 mitigation: gate 已 narrow 'kas/usdt/usdc' 真 trading context, 加 want/get/grab/take/need/cop/quiero 等
  // T-NWT-2026-04-27 Bug-Z4: 'I want to sell' 真撞 BUY 'want' first → 误判. SELL 真先 catch 'sell' 真对.
  if (/\b(sell|dump|unload|offload|cash\s*out|vender)\b/i.test(msg)) return 'sell';
  if (/\b(buy|purchase|want|get|grab|take|need|cop|gimme|fetch|comprar|adquirir|quiero|necesito)\b/i.test(msg)) return 'buy';
  // 日 / 韩 — CJK 关键词不能用 \\b (CLAUDE.md 陷阱 #12)
  if (/(売る|売却|판매|팔다)/.test(msg)) return 'sell';
  if (/(購入|買う|구매|사다)/.test(msg)) return 'buy';
  return null;
}

// T-J1-19f (NWT 验证 INTENT_LOCK 失败转 B): 撤 intent_lock system msg 注入 (Qwen 见
// 第二条 system msg 退化返空). 改 deterministic 首轮路径在 handleLlmDialog 实现, _callLlm
// 恢复纯净.
// T-NWT-2026-04-27 (d) v2 GAP 1: append-only jsonl LLM raw I/O log (Owner 钦定 'no llm log no pass')
// 三方共识 LOCK: NWT 改 _callLlm append jsonl, J2 接受跨域改动 (β option), J1 审 ship 后.
// lock-free / append-only / 不阻塞 broker reply (J2 14:03 6c57f2d23c 要求).
import { promises as _fsAsync } from 'node:fs';
import _path from 'node:path';
const _LLM_IO_LOG = _path.join(process.env.KANET_ROOT || 'C:/kanet', 'logs', 'broker-llm-io.jsonl');
function _appendLlmIo(record) {
  // 异步 fire-and-forget, 永不阻塞调用方. 写失败 console.warn 不 throw.
  _fsAsync.appendFile(_LLM_IO_LOG, JSON.stringify(record) + '\n', 'utf8')
    .catch(e => console.warn(`[broker-llm-io] append fail: ${e.message}`));
}

async function _callLlm(messages, ctx = {}) {
  // ctx: { peer, turn } — 给 jsonl 关联 test-framework trace 用
  // T-J1-2026-04-28 Layer 6 (phase 3 8-layer system fix): LLM 500 retry policy.
  // 治 Bug-Z14 (LLM cascade fail). 5xx + network err 重试 3 次 (1s/2s backoff), 4xx fail fast.
  const a = sqlite.prepare(`
    SELECT a.ai_provider_url, a.ai_model FROM relay_nodes r
    JOIN adapter_nodes a ON a.id = r.adapter_node_id
    WHERE r.id = ?
  `).get(BROKER_RELAY_ID);
  if (!a?.ai_provider_url) return null;
  const requestBody = {
    model: a.ai_model || 'Qwen3.6-35B-A3B',
    // T-J1-2026-04-28 Bug-Z24 (J2 9fa9 dig): merge stateLockAddendum into single system message.
    // 之前 handleLlmDialog 用 history.unshift 加第 2 个 system message → Qwen Jinja
    // 'System message must be at the beginning' raise → HTTP 500 cascade (Owner 06:38+ sell flow 撞).
    messages: [
      { role: 'system', content: ctx.systemAppend ? `${SYSTEM_PROMPT}\n\n${ctx.systemAppend}` : SYSTEM_PROMPT },
      ...messages,
    ],
    tools: TOOLS,
    tool_choice: 'auto',
    // QWEN-RULES.md Rule 11 (T-NWT-V2-hotfix2): Qwen3.6 reasoning kill switch.
    // /no_think 前缀 sys/user 都实测无效. 唯一有效是 body 加 chat_template_kwargs.
    chat_template_kwargs: { enable_thinking: false },
  };
  const MAX_ATTEMPTS = 3;
  const BACKOFF_MS = [0, 1000, 2000];
  let lastStatus = null;
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (BACKOFF_MS[attempt - 1] > 0) {
      await new Promise(r => setTimeout(r, BACKOFF_MS[attempt - 1]));
    }
    const t0 = Date.now();
    try {
      const res = await fetch(`${a.ai_provider_url}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(120_000),
      });
      const latency_ms = Date.now() - t0;
      if (!res.ok) {
        console.warn(`[broker-llm] LLM HTTP ${res.status} (attempt ${attempt}/${MAX_ATTEMPTS})`);
        _appendLlmIo({
          ts: new Date().toISOString(),
          peer: ctx.peer || null,
          turn: ctx.turn || null,
          attempt,
          system_prompt: SYSTEM_PROMPT,
          messages: messages,
          tools: TOOLS.map(t => t.function.name),
          latency_ms,
          http_status: res.status,
          reply: null,
          error: `HTTP ${res.status}`,
        });
        lastStatus = res.status;
        if (res.status >= 400 && res.status < 500) return null;
        continue;
      }
      const data = await res.json();
      const message = data.choices?.[0]?.message;
      _appendLlmIo({
        ts: new Date().toISOString(),
        peer: ctx.peer || null,
        turn: ctx.turn || null,
        attempt,
        system_prompt: SYSTEM_PROMPT,
        messages: messages,
        tools: TOOLS.map(t => t.function.name),
        latency_ms,
        reply_content: message?.content || null,
        tool_calls: message?.tool_calls?.map(tc => ({
          name: tc.function?.name,
          arguments: tc.function?.arguments,
        })) || null,
        finish_reason: data.choices?.[0]?.finish_reason || null,
      });
      return message;
    } catch (e) {
      const latency_ms = Date.now() - t0;
      console.warn(`[broker-llm] LLM err (attempt ${attempt}/${MAX_ATTEMPTS}): ${e.message}`);
      _appendLlmIo({
        ts: new Date().toISOString(),
        peer: ctx.peer || null,
        turn: ctx.turn || null,
        attempt,
        system_prompt: SYSTEM_PROMPT,
        messages: messages,
        tools: TOOLS.map(t => t.function.name),
        latency_ms,
        reply: null,
        error: e.message,
      });
      lastErr = e;
    }
  }
  console.warn(`[broker-llm] all ${MAX_ATTEMPTS} attempts failed (last_status=${lastStatus}, last_err=${lastErr?.message || 'n/a'})`);
  return null;
}

// T-J2-2026-04-27 Bug-Z6 deep RCA mechanical fallback wrapper:
// 任何 tool 返 ok:false → 包成 ok:true + preview_text 让 LLM 100% 转发不自由编.
// 真根因 (J2 8 探针证): tool 返 ok:false 时 LLM 第二轮没指引就自由编 preview (探针实测编 1.9538 USDT 假报价).
// 真 mechanical guarantee: tool 永不返 ok:false 给 LLM, LLM 永远只转发 preview_text 不可能编报价.
async function _executeTool(peer, name, args) {
  let result;
  try {
    result = await _executeToolImpl(peer, name, args);
  } catch (e) {
    console.warn(`[broker-llm] _executeTool ${name} threw: ${e.message}`);
    return { ok: true, preview_text: `抱歉 broker 内部错误处理你的请求 (${name}). 请稍后重试或回 NO 取消.`, _internal_error: e.message };
  }
  if (result && !result.ok) {
    const safeMsg = result.message || result.preview_text || `抱歉, ${name === 'preview_order' ? '生成报价' : name === 'finalize_order' ? '下单' : name === 'verify_payment' ? '查付款' : '处理请求'}失败 (${result.error || 'unknown'}). 请重发或回 NO 取消.`;
    return { ok: true, preview_text: safeMsg, _underlying_error: result.error };
  }
  return result;
}

async function _executeToolImpl(peer, name, args) {
  if (name === 'preview_order') {
    // 议 B (Owner 钦定): 字段齐 preview, 不真 publish. user YES 后才 finalize_order.
    // T-NWT-2026-04-27 v1.1 Phase E: give_asset propagation (default 'KAS' backward compat).
    // R33 b iter3: limit_price + refund_timeout_min 透传到 preview, broker 决策接受/拒绝
    const { direction, qty, chain, address, give_asset = 'KAS', limit_price = null, refund_timeout_min = null } = args || {};
    // R33 b iter3: setConvoStateLock conditions field 真 capture (NWT GAP B retention pipeline)
    if (limit_price !== null || refund_timeout_min !== null) {
      try {
        const { setConvoStateLock } = await import('./broker-state-authority.js');
        setConvoStateLock(peer, { conditions: { limit_price, refund_timeout_min } });
      } catch (e) { console.warn(`[broker-llm R33b] setConvoStateLock conditions err: ${e.message}`); }
    }
    // T-J2-2026-04-29 Phase D D-3 (J1 5675da67 dig 真因 3): LLM tool path preview_order
    // 仅 conditions field propagate, qty/chain/address/direction 漏 setConvoStateLock parity
    // → mid-flow LLM tool change (e.g. T3 '改成 10 KAS') broker reply update 但 state.qty stale.
    // 修法: 加 full state propagation parity with det-preview path (broker-buy-handler L953-965).
    if (direction && (qty != null || chain || address)) {
      try {
        const { setConvoStateLock } = await import('./broker-state-authority.js');
        setConvoStateLock(peer, {
          direction,
          give_asset,
          qty,
          pay_chain: chain,
          recv_address: give_asset === 'KAS' ? null : address,
          evm_pay_address: give_asset === 'KAS' ? address : null,
          lifecycle_phase: 'preview_shown',
        });
      } catch (e) {
        if (e.code === 'CONVO_STATE_DIRECTION_LOCK') {
          return { ok: true, preview_text: `订单方向已锁定 ${e.locked_direction.toUpperCase()}. 改方向请回 "NO" 取消订单, 重新下单告诉我新方向.` };
        }
        console.warn(`[broker-llm D-3] setConvoStateLock err: ${e.message}`);
      }
    }
    if (direction === 'buy') {
      // T-J1-2026-04-27 Bug-Y wire fix (真测发现 broker preview 真显 'kaspa:' addr 真错):
      // 真传 receive_address (LLM args.address) → buyPreview 真 render 真 user EVM 收款 addr.
      // 买 KAS receive_address null OK (template 用 user_kasia). 买 stable null → ⚠ 提示传 EVM addr.
      // T-NWT-2026-04-27 Bug 7 hotfix (合并 J1+NWT): preview ok 真 set _pendingPreview, 让 'YES' 真
      // deterministic finalize (LLM-driven preview 真不 set _quotes, 真 LLM 'YES' 真 unreliable hallucinate).
      const { buyPreview, _setPendingPreview } = await import('./broker-buy-handler.js');
      const r = await buyPreview({ user_kasia: peer, qty, pay_chain: chain, give_asset, receive_address: address || null, limit_price, refund_timeout_min });
      // T-J1-2026-04-28 Layer 7: tag direction='buy' so handleLlmDialog confirm shortcut routes correctly.
      if (r.ok) _setPendingPreview(peer, { direction: 'buy', qty, pay_chain: chain, give_asset, receive_address: address || null });
      return r;
    }
    if (direction === 'sell') {
      // T-J2-2026-04-27 Bug-Z6 deep RCA fix: wire NWT sellPreview (commit 2a74461f9).
      // 真根因 (J2 8 探针 + NWT 1 探针 殊途同归): tool calling 没问题, sell branch 没实现 →
      // LLM 第二轮拿 ok:false 自由编 preview (探针实测 LLM 编了 1.9538 USDT 假报价).
      // 真 fix: 真调 sellPreview 返真 preview_text, LLM 100% 转发不再编.
      if (!address) {
        return { ok: true, preview_text: '卖单需要你的 USDT 收款地址 (0x... 42 位 EVM 钱包). 请重发完整: "卖 X KAS, BSC, 0x..."' };
      }
      const { sellPreview } = await import('./broker-sell-handler.js');
      // T-J2-2026-04-27 sync NWT 5a9db463f generic 化: 透传 give_asset (LLM tool args 已有), recv_asset 默认 USDT (broker 卖路径主路径).
      const r = await sellPreview({ user_kasia: peer, qty, recv_chain: chain, recv_address: address, give_asset, limit_price, refund_timeout_min });
      // 机械兜底: 即使 sellPreview 返 ok:false, 也包成 ok:true + preview_text 让 LLM 100% 转发不自由编.
      if (!r.ok) {
        return { ok: true, preview_text: r.message || `抱歉, 卖单处理失败 (${r.error || 'unknown'}). 请重发或回 NO 取消.` };
      }
      // T-J1-2026-04-28 Layer 7: SELL preview 也 set _pendingPreview tagged 'sell' — 治 LLM tool path
      // 设了 preview 但 _pendingFields 没填 → user 'YES' fall LLM hallucinate. handleLlmDialog pp shortcut hit.
      try {
        const { _setPendingPreview } = await import('./broker-buy-handler.js');
        _setPendingPreview(peer, { direction: 'sell', qty, pay_chain: chain, give_asset, receive_address: address });
      } catch (e) { console.warn(`[broker-llm Layer7] sell pendingPreview set fail: ${e.message}`); }
      return r;
    }
    return { ok: true, preview_text: `抱歉, 未知方向 "${direction}". 请回 "买 X KAS" 或 "卖 X KAS".` };
  }
  if (name === 'finalize_order') {
    // T-NWT-2026-04-27 v1.1 Phase E: give_asset propagation (default 'KAS' backward compat).
    const { direction, qty, chain, address, give_asset = 'KAS' } = args || {};
    if (direction === 'buy') {
      // T-J1-2026-04-27 v1.1 Bug-Y wire fix: 真传 receive_address (买 stable USDC/USDT 真要 user EVM addr
      // → broker 真 deliver 时 send 到此 addr; 买 KAS 真 null → broker 真用 user_kasia auto-resolve).
      const { finalizeBuy } = await import('./broker-buy-handler.js');
      return finalizeBuy({ user_kasia: peer, qty, pay_chain: chain, give_asset, receive_address: address || null });
    }
    if (direction === 'sell') {
      if (!address) return { ok: false, error: '卖路径必填 recv_address' };
      const { finalizeSell } = await import('./broker-sell-handler.js');
      return finalizeSell({ user_kasia: peer, qty, recv_chain: chain, recv_address: address });
    }
    return { ok: false, error: `unknown direction: ${direction}` };
  }
  if (name === 'verify_payment') {
    const { chain } = args || {};
    const { verifyPaymentForPeer } = await import('./broker-buy-handler.js');
    return verifyPaymentForPeer({ peer, chain });
  }
  if (name === 'cancel_order') {
    // R26 Bug-Z19 (NWT 25d4ae81): 真 LLM 真 cancel-intent 必调此 tool, 真**真**真 hallucinate fake ack.
    try {
      const { handleCancelAndRefund } = await import('./broker-cancel-refund.js');
      const ack = await handleCancelAndRefund(peer);
      if (ack) return { ok: true, preview_text: ack };
      // 无 active offer → deterministic null reply, 防 LLM 自由发挥
      return { ok: true, preview_text: '没找到你的 active 订单. 没有可取消的, 重新下单回 "买 X KAS" / "卖 X KAS".' };
    } catch (e) {
      return { ok: true, preview_text: `抱歉, 取消处理失败 (${e.message?.slice(0, 60)}). 请稍后重试或回 NO 联系 broker.` };
    }
  }
  return { ok: false, error: `unknown tool: ${name}` };
}

function _loadHistory(peer, limit = 8) {  // T-NWT-V2-hotfix: 20→8 — 减 prompt size 防 14k+ tokens 长尾 timeout. 多轮上下文够用.
  const trader = sqlite.prepare(`SELECT address FROM relay_nodes WHERE id=?`).get(BROKER_RELAY_ID);
  if (!trader?.address) return [];
  let rows = [];
  try {
    // R6 T-J2-21: messages 表用 sender_identity_id/receiver_identity_id (FK identities.id), 不是 address.
    // JOIN identities 拿到地址 → 跨 user↔broker 双向消息 (inbound user→broker, outbound broker→user)
    rows = sqlite.prepare(`
      SELECT m.direction, m.content_text
      FROM messages m
      LEFT JOIN identities si ON si.id = m.sender_identity_id
      LEFT JOIN identities ri ON ri.id = m.receiver_identity_id
      WHERE m.message_type = 'text'
        AND ((si.address = ? AND ri.address = ?) OR (si.address = ? AND ri.address = ?))
      ORDER BY m.created_at DESC LIMIT ?
    `).all(peer, trader.address, trader.address, peer, limit);
  } catch (e) { console.warn(`[broker-llm] _loadHistory err: ${e.message}`); }
  return rows.reverse().map(r => ({
    role: r.direction === 'inbound' ? 'user' : 'assistant',
    content: (r.content_text || '').slice(0, 500),
  })).filter(m => m.content);
}

/**
 * T-J2-2026-04-29 Phase E v2 task 2 (Owner 21:46 钦定 + NWT f06b7954 propose):
 * broker scan recent N turn user messages → 提炼精髓 fields → systemAppend 注入.
 * 跟 state authority injection (llmSystemPromptStateLock) 互补:
 * - state authority = 显式 lock fields (mechanical, 仅 setConvoStateLock 写过 fields)
 * - _extractRecentContext = history regex/heuristic 提炼 (catch user 自然语言 nuance,
 *   e.g. user "我之前给的 50 个 BSC", state.qty 可能 null 但 history 有)
 *
 * 触发: 每 LLM call 自动注入 (cheap regex, no LLM call).
 *
 * @param {Array<{role,content}>} history - _loadHistory output
 * @returns {string|null} - systemAppend snippet OR null if no fields extracted
 */
function _extractRecentContext(history) {
  if (!Array.isArray(history) || history.length === 0) return null;
  const userMsgs = history.filter(m => m.role === 'user').slice(-8); // last 8 user turns
  if (userMsgs.length === 0) return null;

  // Aggregate fields across recent turns. Later mention overrides earlier (latest user input wins).
  const found = { direction: null, qty: null, asset: null, chain: null, address: null, limit_price: null, refund_timeout: null };
  for (const m of userMsgs) {
    const t = String(m.content || '');
    // direction: 买/卖/buy/sell + 'cancel/取消' (intent-only, 不 set direction)
    if (/(买|buy|purchase)/i.test(t) && !found.direction) found.direction = '买';
    if (/(卖|sell)/i.test(t) && !found.direction) found.direction = '卖';
    // qty + asset paired (e.g. "5 KAS", "50个", "100 USDT")
    const paired = t.match(/(\d+(?:\.\d+)?)\s*(?:个|枚|只)?\s*(kas|usdt|usdc)/i);
    if (paired) { found.qty = parseFloat(paired[1]); found.asset = paired[2].toUpperCase(); }
    else {
      const qOnly = t.match(/(\d+(?:\.\d+)?)\s*(?:个|枚|只)/);
      if (qOnly) found.qty = parseFloat(qOnly[1]);
    }
    // chain (BSC/Polygon/SOL/TRON/etc)
    const chainMatch = t.match(/\b(bsc|bnb|polygon|matic|sol|solana|tron|eth|ethereum|arb|arbitrum|op|optimism|avax|avalanche|base)\b/i);
    if (chainMatch) found.chain = chainMatch[1].toUpperCase();
    // EVM address
    const addrMatch = t.match(/\b0x[a-fA-F0-9]{40}\b/);
    if (addrMatch) found.address = addrMatch[0];
    // limit_price (e.g. "限价 0.034", "挂单价 0.0336", "不低于 0.04")
    const priceMatch = t.match(/(?:限价|挂单价|不低于)\s*(\d+\.\d+)/);
    if (priceMatch) found.limit_price = parseFloat(priceMatch[1]);
    // refund_timeout (e.g. "30分钟没成交退", "10min 退")
    const timeoutMatch = t.match(/(\d+)\s*(?:分钟|min|分)/);
    if (timeoutMatch) found.refund_timeout = parseInt(timeoutMatch[1], 10);
  }

  const lines = [];
  if (found.direction) lines.push(`direction=${found.direction}`);
  if (found.qty != null) lines.push(`qty=${found.qty}`);
  if (found.asset) lines.push(`asset=${found.asset}`);
  if (found.chain) lines.push(`chain=${found.chain}`);
  if (found.address) lines.push(`address=${found.address}`);
  if (found.limit_price != null) lines.push(`limit_price=${found.limit_price}`);
  if (found.refund_timeout != null) lines.push(`refund_timeout_min=${found.refund_timeout}`);
  if (lines.length === 0) return null;

  return `\n最近对话 user 给过的字段 (history scan, 仅近 ${userMsgs.length} 轮):\n${lines.join(', ')}\n你必 reference 这些 fields, 不重问 user. 用户已表达, 你不假装 forget.`;
}

// T-J1-19f deterministic 首轮回复 (NWT B 方案 — 跳过 LLM 防 Qwen 中文 confused).
// 仅当: 首轮 (history 为空) + 检测到 intent (含 'kas' + 方向词).
// LLM 续 turn (用户回 BSC/yes) 自然走 LLM, 此时 history 已含 deterministic reply.
function _extractQty(message) {
  // T-J2-2026-04-27 v1.1 multi-asset extract (KAS / USDT / USDC)
  const m = String(message || '').match(/(\d+(?:\.\d+)?)\s*(?:个|枚|只)?\s*(kas|usdt|usdc)/i);
  return m ? parseFloat(m[1]) : null;
}

// T-J2-2026-04-27 v1.1: 真 detect asset symbol from message (KAS default, USDT/USDC 真识别)
// T-J2-2026-04-27 Bug-Z7 fix (J1 e4f68c7e 真 LIVE 真测撞):
// 旧 if /usdt/ → USDT 弱 regex 撞 user msg '卖 2 KAS, BSC 链**收 USDT**' (USDT 是 settle 不是 give_asset).
// 真 fix: extract asset paired with qty (跟 _extractQty 同 pattern), give_asset 是配对的那个.
// fallback 关键字检测留给无 qty 场景 ('KAS 多少钱' 类问询).
function _detectAsset(message) {
  const msg = String(message || '');
  const paired = msg.match(/(\d+(?:\.\d+)?)\s*(?:个|枚|只)?\s*(kas|usdt|usdc)/i);
  if (paired) return paired[2].toUpperCase();
  if (/usdc/i.test(msg)) return 'USDC';
  if (/usdt/i.test(msg)) return 'USDT';
  return 'KAS';
}

function _deterministicFirstReply(intent, qty, _lang, asset = 'KAS') {
  // T-J2-2026-04-29 Bug-Z26 真因 (NWT db971a22 dig + Owner 21:43 严训):
  // 之前 multi-language branches (zh/en/es) hardcoded — _detectLang 仅 current turn CJK ratio,
  // user 输入 "Bsc,0x..." 全英数字 → CJK=0 → 'en' branch → 'Got it, sell KAS' 英文 reply.
  // Owner 21:40 钦定 全程中文铁律. 删 en/es branches, 永返中文.
  const verb = intent === 'buy' ? '买' : '卖';
  const payAction = intent === 'buy' ? '付' : '收';
  const settleAsset = asset === 'KAS' ? 'USDT' : (asset === 'USDC' ? 'USDT' : 'USDC');
  return qty
    ? `好的, ${verb} ${qty} ${asset}. 用哪个链 ${payAction} ${settleAsset}? (BSC / Polygon / SOL / TRON)`
    : `好的, ${verb} ${asset}. 数量多少? 哪个链?`;
}

function _detectLang(_message) {
  // T-J2-2026-04-29 Bug-Z26: Owner 21:40 钦定全程中文铁律, _detectLang deprecated.
  // Keep stub for backward compat with callers, always return 'zh'.
  return 'zh';
}

// T-J2-2026-04-27 Bug-Z9 fix (J1 82429088 vote α + cn_newbie persona 真测撞):
// broker server-side cross-turn _pendingFields tracking. 真 root: handleLlmDialog 旧 path
// _detectIntent 真 only check current msg, multi-turn 'BSC' single-token 真 lose context.
// Qwen3.6 multi-turn instruction-following 弱 (Bug-Z6/Z7/Z9 三连证), 不靠 LLM 真 reconstruct
// state. 真 deterministic transducer: extract from current msg → merge prev state → 字段齐
// 调 preview tool / 字段缺反问 missing field. LLM 只在 confirm/cancel/闲聊 接管.
const _pendingFields = new Map();  // peer → { direction, give_asset, qty, chain, address, expires_at }
const PENDING_FIELDS_TTL_MS = 30 * 60 * 1000;

function _getPendingFields(peer) {
  const f = _pendingFields.get(peer);
  if (!f) return null;
  if (Date.now() > f.expires_at) { _pendingFields.delete(peer); return null; }
  return f;
}

function _setPendingFields(peer, data) {
  _pendingFields.set(peer, { ...data, expires_at: Date.now() + PENDING_FIELDS_TTL_MS });
}

function _clearPendingFields(peer) { _pendingFields.delete(peer); }

export function _testClearPendingFields(peer) { if (peer) _pendingFields.delete(peer); else _pendingFields.clear(); }

// T-J2-2026-04-27 Bug-Z11 fix: R19 _r19Guard 真**真**lookup active locked addr (替 Bug-Z8 history widen).
export function _getPendingFieldsAddr(peer) {
  const f = _getPendingFields(peer);
  return f?.address || null;
}

// extract structured fields from a single user msg. paired qty+asset (Bug-Z7 sediment).
function _extractFieldsFromMsg(msg) {
  const m = String(msg || '');
  const intent = _detectIntent(m);
  // R33 b iter6 (NWT c5bda126 fuzz negative trace): sign capture + 后续 reject. 不**真**真 silent
  // normalize '-5' → '5' (broker preview 真**真**charge 5 USDT 真**真**user typo 真灾难).
  const qtyAsset = m.match(/(-?\d+(?:\.\d+)?)\s*(?:个|枚|只)?\s*(kas|usdt|usdc)/i);
  const chainMatch = m.match(/\b(BSC|BNB|Polygon|POL|SOL|Solana|TRON|ETH)\b/i);
  const evmMatch = m.match(/0x[a-fA-F0-9]{40}/);
  // R33 b iter4 (J2 GAP B 真根因 — _pendingFields deterministic path bypass LLM):
  // user 自定 limit_price + refund_timeout_min 必须 deterministic regex extract,
  // 跟 direction/qty/chain 同 path. iter3 LLM tool wire 不够 (T6 走 _pendingFields path).
  // limit_price: 挂单价 / 挂单价格 / 价格设定 / 限价 / 不低于 / price / limit + 数字
  const limitMatch = m.match(/(?:挂单价(?:格)?(?:设定)?|限价|不低于|不高于|不超过|价格至少|price\s*at|limit\s*price|限制价格)\s*[:：是为]?\s*(\d+(?:\.\d+)?)/i);
  // refund_timeout_min: '\d+ 分钟' 配合 refund 语境 ('退/返/refund/return/没人' 任一)
  const timeoutMatch = m.match(/(\d+)\s*(?:分钟|分|min(?:ute)?s?)/i);
  const hasRefundCtx = /(?:退|返|refund|return|原路|没人|没成交|没接|没吃)/i.test(m);
  return {
    direction: intent || null,
    qty: qtyAsset ? parseFloat(qtyAsset[1]) : null,
    give_asset: qtyAsset ? qtyAsset[2].toUpperCase() : null,
    chain: chainMatch ? _normalizeChain(chainMatch[1]) : null,
    address: evmMatch ? evmMatch[0] : null,
    limit_price: limitMatch ? parseFloat(limitMatch[1]) : null,
    refund_timeout_min: (timeoutMatch && hasRefundCtx) ? parseInt(timeoutMatch[1], 10) : null,
  };
}

// fresh wins over prev (Bug-Z5 sediment 'current msg first'); prev fills missing only.
// T-J2-2026-04-27 Bug-Z11 fix: receive_address 真**lock** turn 1 set 后, turn 2+ 真不同 addr → 拒攻击.
// 真 attacker plant new addr in history 真**真**不能 widen allow-set (R31 sediment lifecycle-bound).
function _mergeFields(prev, fresh) {
  let address = fresh.address || prev?.address || null;
  let address_change_attempt = false;
  if (prev?.address && fresh.address && fresh.address.toLowerCase() !== prev.address.toLowerCase()) {
    address = prev.address;  // keep locked (反攻击)
    address_change_attempt = true;
  }
  return {
    direction: fresh.direction || prev?.direction || null,
    qty: fresh.qty || prev?.qty || null,
    give_asset: fresh.give_asset || prev?.give_asset || null,
    chain: fresh.chain || prev?.chain || null,
    address,
    // R33 b iter4: conditions (limit_price + refund_timeout_min) — fresh wins, prev fills missing
    limit_price: fresh.limit_price ?? prev?.limit_price ?? null,
    refund_timeout_min: fresh.refund_timeout_min ?? prev?.refund_timeout_min ?? null,
    _address_change_attempt: address_change_attempt,
  };
}

function _normalizeChain(s) {
  const u = String(s || '').toUpperCase();
  if (u === 'BSC' || u === 'BNB') return 'bnb';
  if (u === 'POLYGON' || u === 'POL') return 'polygon';
  if (u === 'SOL' || u === 'SOLANA') return 'sol';
  if (u === 'TRON') return 'tron';
  if (u === 'ETH') return 'eth';
  return s.toLowerCase();
}

// SELL 总要收款地址; BUY KAS 不要 (broker auto 用 user_kasia); BUY stable 要 EVM 收款 addr.
function _intentNeedsAddr(direction, give_asset) {
  if (direction === 'sell') return true;
  if (direction === 'buy' && give_asset && give_asset !== 'KAS') return true;
  return false;
}

function _allFieldsReady(f) {
  if (!f.direction || !f.qty || !f.give_asset || !f.chain) return false;
  if (_intentNeedsAddr(f.direction, f.give_asset) && !f.address) return false;
  return true;
}

function _askMissingField(f, _lang) {
  // T-J2-2026-04-29 Bug-Z26: Owner 21:40 钦定全程中文, en branches 删. _lang ignored, 永中文.
  const verb = f.direction === 'sell' ? '卖' : '买';
  if (!f.qty || !f.give_asset) {
    return `好的, 你想${verb}什么 (KAS / USDT / USDC)? 多少?`;
  }
  if (!f.chain) {
    return `好的, ${verb} ${f.qty} ${f.give_asset}. 用哪个链? (BSC / Polygon / SOL / TRON)`;
  }
  if (_intentNeedsAddr(f.direction, f.give_asset) && !f.address) {
    const hint = f.direction === 'sell' ? '收 USDT 的' : `收 ${f.give_asset} 的`;
    return `好的, ${verb} ${f.qty} ${f.give_asset}, ${f.chain.toUpperCase()}. 你${hint} EVM 钱包地址 (0x... 42 位)?`;
  }
  return '好的, 准备出报价...';
}

// 主入口: conversations.js fork 调
export async function handleLlmDialog(peer, message) {
  const history = _loadHistory(peer);
  // T-J1-19h (诊断 NWT divergence): 加 console.log + reply marker 看真实路径
  // direct call vs API call 都跑同一函数, marker 决定性区分究竟走哪条分支.
  // T-J1-19h+: 字节级诊断 (Owner 提示 "编码问题"). 打 message 长度 / UTF-8 byte 数 /
  // 前 6 字符 charCodeAt (CJK 字符 codePoint > 0x4E00, ASCII < 0x7F. 编码错→显示乱).
  const msgRaw = String(message || '');
  const byteLen = Buffer.byteLength(msgRaw, 'utf8');
  const charCodes = Array.from(msgRaw.slice(0, 6)).map(c => c.codePointAt(0).toString(16)).join(',');

  // T-J2-2026-04-27 Bug-Z9 fix: deterministic _pendingFields cross-turn transducer.
  // extract current msg → merge prev state → 字段齐调 preview tool / 缺则反问.
  const fresh = _extractFieldsFromMsg(message);
  const prev = _getPendingFields(peer);
  const merged = _mergeFields(prev, fresh);
  console.log(`[broker-llm DIAG] peer=${peer?.slice(-12)} msg.chars=${msgRaw.length} msg.utf8bytes=${byteLen} codes=[${charCodes}] msg="${msgRaw.slice(0,40)}" history.len=${history.length} fresh=${JSON.stringify(fresh)} prev=${JSON.stringify(prev)} merged=${JSON.stringify(merged)}`);

  // R33 b iter9 (J2 81f8f1d8 mid_flow_restart): user explicit cancel-and-restart 真**真 reset state.
  {
    const { detectResetIntent } = await import('./broker-state-authority.js');
    if (detectResetIntent(message)) {
      resetConvoState(peer, 'user_restart');
      _clearPendingFields(peer);
    }
  }

  // Owner 02:23 钦定 cancel-refund policy (跟 broker-buy/sell-handler 同模式).
  // user 指示取消 → 检 broker active offer → open 状态: cancel + refund + DM ack.
  // matched/verifying/delivering → 走 dispute (不在 helper).
  {
    try {
      const { detectCancelIntent, handleCancelAndRefund } = await import('./broker-cancel-refund.js');
      if (detectCancelIntent(message)) {
        const refundReply = await handleCancelAndRefund(peer);
        if (refundReply) return refundReply;
      }
    } catch (e) { console.warn(`[broker-llm] cancel-refund check err: ${e.message}`); }
  }

  // R31 P1.b attacker (NWT 33c0fb3a multi-addr-plant + r19-strip-replant): EARLIEST detect.
  // 真**真**deterministic path OR LLM path fall, addr-change attempt 真**真**直接 R31 lifecycle-lock 拒.
  {
    const { detectAddrChangeAttempt } = await import('./broker-state-authority.js');
    const attempt = detectAddrChangeAttempt(peer, message);
    if (attempt.attempt) {
      return `订单地址已锁定 ${attempt.locked}. 改地址请回 "NO" 取消订单, 重新下单告诉我新地址.`;
    }
  }

  // R33 b iter5 (NWT 30940d86 Bug-Z13 trace 实证修): setConvoStateLock direction 真**真**真 EARLIEST,
  // 不**真**等 _allFieldsReady deterministic path OR _executeTool 调成功 — even if LLM fail / preview fail,
  // T+1 turn fall LLM hallucinate 真**真**被 llmSystemPromptStateLock 真**真**真**system prompt 注入拦.
  // root cause: T2 user '想买 3 KAS, BSC' → 真**deterministic 应**真**真**hit (line 629 _allFieldsReady),
  // 但 NWT trace 实证 T2 reply EMPTY 不**真**真**真 fall LLM, 真原因复杂 (LLM HTTP 500 / preview fail / 真**真).
  // 真**真**真**真**真**真**真**fix: 真 fresh.direction extract 出来真**就**lock, 真**真**不**真等 _allFieldsReady.
  if (fresh.direction) {
    try {
      setConvoStateLock(peer, {
        direction: fresh.direction,
        give_asset: merged.give_asset || null,
        qty: merged.qty || null,
        pay_chain: merged.chain || null,
        lifecycle_phase: 'fields_collection',
      });
    } catch (e) {
      if (e.code === 'CONVO_STATE_DIRECTION_LOCK') {
        return `订单方向已锁定 ${e.locked_direction.toUpperCase()}. 改方向请回 "NO" 取消订单, 重新下单告诉我新方向.`;
      }
    }
  }

  // T-J2-2026-04-27 Bug-Z12 fix (NWT 6c980472 真人 UX P0-1 抓): handleLlmDialog 真**真**真**真**
  // fresh 真**真**完全 empty (用户 真发 'YES' / 'maker 是谁' / '钱去哪了') 真**真**真**真**真**真**真**真**
  // 真**真**真 _pendingFields path 真**真**真 re-show preview 复读, 真**真**真**真 fall LLM 真**真**NLG 处理 (问答/confirm/cancel).
  // 真 user 真有新字段时 (true progress) 才走 _pendingFields path 真**真**真 next missing field 反问 / 真齐调 preview tool.
  const freshHasAny = fresh.direction || fresh.qty || fresh.give_asset || fresh.chain || fresh.address;

  // T-J2-2026-04-27 P0-4 + P0-2 fix (NWT 14-case verify gap, J1 5fd86417 handoff):
  // fresh empty + _pendingFields 已齐 + user 真**真**真 CONFIRM word ('YES'/'好'/'确认'/'OK') →
  // deterministic finalize_order tool + sync ack. 真**真**真**真**真**真**LLM 真 multi-turn confirm 真不可靠 (Qwen3.6 真 SELL '好' 当 hello 误判).
  // 真**真**真**真**真**真**真 BUY 路径 真**真**真**真**真**真 conversations.js handleBuyIntent first 真**已**真**真**真 priority hit (CONFIRM_WORDS in broker-buy-handler);
  // 真**真**真**真**真 SELL 路径 真**真**真**真**真**真**真**真**真**真**真**真 fall to handleLlmDialog, 真 P0-2 cover here.
  const CONFIRM_WORDS_LOCAL = ['YES', 'yes', 'y', 'OK', 'ok', '确认', '好', '对', '是', '行', 'ya', 'sí', 'si'];
  const cancelWordsLocal = ['NO', 'no', 'n', '取消', '不要', '算了', 'cancel'];
  const trimmedMsg = String(message || '').trim();
  // T-J1-2026-04-28 Layer 7 (phase 3): _pendingPreview CONFIRM priority over fields_collection / LLM hallucinate.
  // 治 SELL via LLM tool path: preview_order set _pendingPreview but _pendingFields 没填 →
  // L682 (后) shortcut 跳掉 → fall LLM 可能 hallucinate 假 ack. fix: pp 真存在 + 纯 CONFIRM → 直 finalize_order tool.
  if (CONFIRM_WORDS_LOCAL.includes(trimmedMsg)) {
    const { _getPendingPreview, _clearPendingPreview } = await import('./broker-buy-handler.js');
    const pp = _getPendingPreview(peer);
    if (pp) {
      _clearPendingPreview(peer);
      _clearPendingFields(peer);
      const dir = pp.direction || 'buy';
      const finalizeResult = await _executeTool(peer, 'finalize_order', {
        direction: dir, qty: pp.qty, chain: pp.pay_chain,
        give_asset: pp.give_asset || 'KAS', address: pp.receive_address || null,
      });
      if (finalizeResult?.ok && finalizeResult.order_id) {
        const verb = dir === 'sell' ? '卖' : '买';
        return `✓ ${verb}单已确认 (${pp.qty} ${pp.give_asset || 'KAS'}, ${(pp.pay_chain || '').toUpperCase()}). 付款/收款指引马上发你, 1-2 分钟到账, 不用刷新.`;
      }
      return finalizeResult?.preview_text || '抱歉, 下单失败, 请重发或回 "NO" 取消重新开始.';
    }
  }
  if (!freshHasAny && merged.direction && _allFieldsReady(merged) && CONFIRM_WORDS_LOCAL.includes(trimmedMsg)) {
    console.log(`[broker-llm P0-4] confirm shortcut: peer=${peer?.slice(-12)} direction=${merged.direction} qty=${merged.qty} asset=${merged.give_asset} chain=${merged.chain}`);
    _clearPendingFields(peer);
    const finalizeResult = await _executeTool(peer, 'finalize_order', {
      direction: merged.direction,
      qty: merged.qty,
      chain: merged.chain,
      give_asset: merged.give_asset || 'KAS',
      address: merged.address || null,
    });
    if (finalizeResult?.ok && finalizeResult.order_id) {
      const verb = merged.direction === 'sell' ? '卖' : '买';
      return `✓ ${verb}单已确认 (${merged.qty} ${merged.give_asset}, ${(merged.chain || '').toUpperCase()}). 付款/收款指引马上发你, 1-2 分钟到账, 不用刷新.`;
    }
    return finalizeResult?.preview_text || `抱歉, 下单失败, 请重发或回 "NO" 取消重新开始.`;
  }
  if (!freshHasAny && merged.direction && cancelWordsLocal.includes(trimmedMsg)) {
    _clearPendingFields(peer);
    return `好的, 已取消订单. 重新下单回 "买/卖 X KAS".`;
  }

  if (merged.direction && freshHasAny) {
    // T-J2-2026-04-27 Bug-Z11 fix: deterministic 拒 address change attack.
    // turn 2+ user 真**真**给新 addr 跟 prev 不同 → 真**绝不**让 LLM 自由发挥 echo, deterministic 拒.
    if (merged._address_change_attempt) {
      console.warn(`[broker-llm Z11] address change attempt blocked: peer=${peer?.slice(-12)} fresh=${fresh.address?.slice(0,10)} locked=${merged.address?.slice(0,10)}`);
      return `订单地址已锁定 ${merged.address}. 改地址请回 "NO" 取消订单, 重新下单告诉我新地址.`;
    }
    // R33 b iter6 (NWT c5bda126 fuzz negative trace): 显式 reject negative qty.
    if (merged.qty != null && merged.qty < 0) {
      _clearPendingFields(peer);
      return `抱歉, ${merged.qty} 是负数, 不能${merged.direction === 'sell' ? '卖' : '买'}负数. 改正数, 例 "${merged.direction === 'sell' ? '卖' : '买'} 5 KAS".`;
    }
    // R33 b iter7 (NWT 309b19af huge_qty trace): upfront 1M cap.
    if (merged.qty != null && merged.qty > 1_000_000) {
      _clearPendingFields(peer);
      return `抱歉, ${merged.qty} ${merged.give_asset || 'KAS'} 超过单笔上限 1000000. 改小 OR 分批下单.`;
    }
    const minQty = merged.give_asset === 'KAS' ? 1.0 : 0.1;
    if (merged.qty != null && merged.qty < minQty) {
      _clearPendingFields(peer);
      return `抱歉, 最小 ${minQty} ${merged.give_asset || 'KAS'} (broker fee + dust 保护). 改大一点吧.`;
    }
    const lang = _detectLang(message);
    if (_allFieldsReady(merged)) {
      // 字段齐, 调 preview_order tool. T-J2-2026-04-27 Bug-Z11 fix: keep _pendingFields set (NOT clear)
      // 真 lifecycle-bound lock for R19 lookup + _address_change_attempt detection turn 2+.
      // 真 expire by TTL 30min OR user 'YES'/'NO' (broker-buy-handler clears _pendingPreview, _pendingFields TTL).
      _setPendingFields(peer, merged);
      // R33: setConvoStateLock — direction 不可变, fresh.direction 跟 prev 不同 throws
      try {
        setConvoStateLock(peer, {
          direction: merged.direction,
          give_asset: merged.give_asset || 'KAS',
          want_asset: merged.direction === 'buy' ? merged.give_asset : 'USDT',
          qty: merged.qty,
          pay_chain: merged.chain,
          recv_address: merged.address,
          lifecycle_phase: 'fields_collection',
        });
      } catch (e) {
        if (e.code === 'CONVO_STATE_DIRECTION_LOCK') {
          return `订单方向已锁定 ${e.locked_direction.toUpperCase()}. 改方向请回 "NO" 取消订单, 重新下单告诉我新方向.`;
        }
        console.warn(`[broker-llm R33] setConvoStateLock err: ${e.message}`);
      }
      const toolResult = await _executeTool(peer, 'preview_order', {
        direction: merged.direction,
        qty: merged.qty,
        chain: merged.chain,
        give_asset: merged.give_asset || 'KAS',
        address: merged.address || null,
        // R33 b iter4: pass deterministic extracted conditions to preview_order
        limit_price: merged.limit_price,
        refund_timeout_min: merged.refund_timeout_min,
      });
      return toolResult?.preview_text || (toolResult?.ok ? `✓ 订单准备就绪 (${merged.direction} ${merged.qty} ${merged.give_asset})` : '抱歉, 处理订单失败, 请重发或回 NO 取消.');
    }
    // 字段不齐 → save state + 反问 missing field (deterministic, 不调 LLM)
    _setPendingFields(peer, merged);
    // R33: 部分字段也 lock (direction 已 declared)
    try {
      setConvoStateLock(peer, {
        direction: merged.direction,
        give_asset: merged.give_asset || null,
        qty: merged.qty || null,
        pay_chain: merged.chain || null,
        lifecycle_phase: 'fields_collection',
      });
    } catch (e) {
      if (e.code === 'CONVO_STATE_DIRECTION_LOCK') {
        return `订单方向已锁定 ${e.locked_direction.toUpperCase()}. 改方向请回 "NO" 取消订单, 重新下单告诉我新方向.`;
      }
    }
    return _askMissingField(merged, lang);
  }

  // 没 direction (current msg 也没 prev 也没) → fall to LLM (用户 'YES' / 'NO' / 闲聊 / 'maker 是谁?')
  history.push({ role: 'user', content: message });
  // R33: inject conversation state lock into LLM system msg if state active.
  // T-J1-2026-04-28 Bug-Z24 (J2 9fa9): pass via ctx.systemAppend (single system msg), 不 unshift 第 2 个 system.
  // T-J2-2026-04-29 Phase E v2 task 2 (Owner 21:46 钦定): 注入 state authority lock fields
  // (mechanical) + history scan extracted fields (heuristic). 双 layer cover broker context.
  const stateLockPart = llmSystemPromptStateLock(peer);
  const historyPart = _extractRecentContext(history);
  const stateLockAddendum = [stateLockPart, historyPart].filter(Boolean).join('\n') || null;
  let llm = await _callLlm(history, { peer, turn: 1, systemAppend: stateLockAddendum });
  if (!llm) return '抱歉, 我这边 LLM 卡了一下, 请稍后再试. 或直接回 "买 X KAS" / "卖 X KAS" (X 写数量) 走快速通道.';

  // R26 Bug-Z19 guard (NWT 25d4ae81 Owner 真测): user cancel-intent + LLM 真**真**调 cancel_order tool
  // → LLM 真**真**hallucinate fake ack ('已为您取消, 1-2 分钟到账'). 真**真**真**真 force tool call OR
  // fall back deterministic. 真**production 灾难** Bug-Z19.
  const _CANCEL_INTENT_RE = /(?:NO|不要|不想|取消|算了|退|cancel|refund|我等不了|我不(?:要|做|玩)了|我不卖|我不买|give\s+(?:me\s+)?(?:my\s+)?(?:money|kas)\s+back)/i;
  if (_CANCEL_INTENT_RE.test(message) && !llm.tool_calls?.length) {
    console.error(`[broker-llm Z19] cancel-intent + no tool_call → force cancel_order: peer=${peer?.slice(-12)} msg="${String(message).slice(0,40)}"`);
    // Force-call cancel_order tool deterministic
    try {
      const toolResult = await _executeTool(peer, 'cancel_order', {});
      return toolResult?.preview_text || '没找到你的 active 订单. 没有可取消的, 重新下单回 "买 X KAS" / "卖 X KAS".';
    } catch (e) {
      return `抱歉, 取消处理失败 (${e.message?.slice(0, 60)}). 请稍后重试.`;
    }
  }

  // tool call?
  if (llm.tool_calls?.length) {
    const tc = llm.tool_calls[0];
    let args = {};
    try { args = JSON.parse(tc.function.arguments || '{}'); } catch { return '订单参数解析出错, 请重发订单细节.'; }
    const toolResult = await _executeTool(peer, tc.function.name, args);
    history.push({ role: 'assistant', content: llm.content || '', tool_calls: [tc] });
    history.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolResult) });
    llm = await _callLlm(history, { peer, turn: 2, systemAppend: stateLockAddendum });
    if (!llm) {
      return toolResult.ok
        ? `✓ 订单已建 (${args.direction} ${args.qty} KAS, ${args.chain}). 详情: ${JSON.stringify(toolResult).slice(0, 200)}`
        : `订单失败: ${toolResult.error}. 请重新下单.`;
    }
  }

  // R33: validate LLM reply 真**真**真 cross-direction hallucinate / fake price
  const replyText = llm.content?.trim() || '我在听. 你想买 KAS 还是卖 KAS?';
  try {
    const v = await validateLlmReply(peer, replyText);
    if (!v.ok) {
      console.error(`[broker-llm R33] LLM reply violations: ${v.violations.join(' | ')}`);
      // T-J2-2026-04-29 Bug-Z26 Bug 5 (NWT a380b14e Owner 真测): R33 violation fallback
      // 加 sticky context recovery — 之前 generic "请重新提供" Owner 火大 (state 全丢假象).
      // 真 state authority 仍 retain user fields, fallback msg 引用现有 fields 让 Owner 知道
      // broker 没 forget. graceful "broker 卡了一下, 你给的信息我记得 X/Y/Z, 继续吗?"
      try {
        const { getConvoState } = await import('./broker-state-authority.js');
        const state = getConvoState(peer);
        if (state && (state.direction || state.qty || state.pay_chain || state.recv_address || state.evm_pay_address)) {
          const parts = [];
          if (state.direction) parts.push(`方向: ${state.direction === 'buy' ? '买' : '卖'}`);
          if (state.qty != null) parts.push(`数量: ${state.qty} ${state.give_asset || 'KAS'}`);
          if (state.pay_chain) parts.push(`链: ${state.pay_chain.toUpperCase()}`);
          const addr = state.recv_address || state.evm_pay_address;
          if (addr) parts.push(`地址: ${addr.slice(0, 10)}...`);
          if (parts.length > 0) {
            return `抱歉, 我这边 LLM 卡了一下. 你之前给的信息我记得: ${parts.join(' / ')}. 是继续这单吗? (回 YES 我继续 / 回 NO 取消重来)`;
          }
        }
      } catch (e) { console.warn(`[broker-llm Bug 5] sticky recovery err: ${e.message}`); }
      // state empty fallback (legacy)
      return '抱歉, broker 输出异常 (R33 内部拦截). 请回 NO 取消订单或重新下单告诉我数量+链.';
    }
  } catch (e) {
    console.warn(`[broker-llm R33] validateLlmReply err: ${e.message}`);
  }
  return replyText;
}
