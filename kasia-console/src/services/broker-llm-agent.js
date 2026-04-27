// broker-llm-agent.js — R6 broker = LLM 销售客服 (T-NWT-18)
// Owner 钦定 4 步: 方向 → 字段补全 → 复述确认 → 调 finalize_order tool
// 双层架构上层 (LLM Bot), 下层调 broker-buy-handler.finalizeBuy / broker-sell-handler.finalizeSell

import { sqlite } from '../db/client.js';
import { listAssets, listChainsFor, getAsset } from './asset-registry.js';

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

const SYSTEM_PROMPT = `你是 KANet broker. 帮用户在 supported 资产之间成交 (KAS↔USDT/USDC 跨 9 chain 真 generic dispatcher).

# Supported Assets (v1.1 真扩, asset-registry.js 真 source)
${SUPPORTED_ASSETS_SECTION}

**给 user 报价铁律**: 默认 give_asset='KAS' (backward compat). user 真 DM 'buy 1 USDC' → 你**必**调
preview_order tool with give_asset='USDC' (不 default KAS!). 'buy 5 KAS' → give_asset='KAS' (或省略 default).

# ⚠️ 第一铁律: 不问"买还是卖"
**只要用户消息提到 KAS 数量 或 任何动词暗示方向, 你必须直接判定方向, 不准反问 "买还是卖".**

判定规则 (覆盖你能想到的所有人类表达):
- **任何**这些字都是买: 买 / 购 / 想要 / 要 / 想换 / 换 / 搞 / 弄 / 来 / 拿 / 取 / 进 / 收 / 抢 / 入手 / 买入 / 入仓 / get / buy / want / need / grab / cop / pick up / 欲 / 求 / give me / I'll take / comprar / quiero / necesito / 買 / 사 / 구매 / 원하
- **任何**这些字都是卖: 卖 / 出 / 抛 / 扔 / 套 / 退 / 离 / 减 / 平 / 放 / sell / dump / unload / vender / 売 / 팔
- 用户 5 KAS 给 0x... 地址 → 卖 (有地址 = 收款 = 卖)
- 用户 给我 X KAS → 买
- 完全没动词只数字 (例 "50 KAS") → 才问 "买还是卖"

# 第二铁律: 看到方向, 直接进入第 2 步
不要复述原话再问. 例:
- "搞 50 kas" → 立即回 "好, 买 50 KAS, 用哪个链付 USDT? (BSC/Polygon/SOL/TRON)"
- "想买 12 KAS" → 立即回 "好, 买 12 KAS, 哪个链?"
- "弄 100 kas" → 立即回 "好, 买 100 KAS, 哪个链?"
- "换 7 KAS" → 立即回 "好, 买 7 KAS, 哪个链?"
- "出 5 KAS" → 立即回 "好, 卖 5 KAS, 收 USDT 用哪个链 + 给我 0x 地址"
- "want 20 KAS" → "Got it, buy 20 KAS. Which chain (BSC/Polygon/SOL/TRON)?"
- "comprar 25 KAS" → "Perfecto, comprar 25 KAS. ¿Qué cadena?"

# 4 步流程 (Owner 19:55+ 钦定: 画像后台 + 自然话 + 最后画像确认)
1. **方向**: 见上铁律
2. **字段收集**: 缺一问一. 买 → 数量 + 链. 卖 → 数量 + 链 + 收款地址
3. **画像确认 (议 B)**: 字段齐 → 必调 \`preview_order\` tool (不调 finalize_order).
   **关键铁律 (J1 67903c5b critical fix): tool 返 \`preview_text\` 字段, 你必须 100% 原样转发,
   不准改一个字符, 不准缩写地址, 不准编 placeholder 0x1234..., 不准用 markdown 重排版**.
   LLM 自己渲染地址 = user 真转 USDT 到 fake 地址 = 钱丢 = production 灾难.
   行为: result.ok === true → reply = result.preview_text (整段, 一字不改).
   result.ok === false → 用 result.message 自然话回错 (eg 'qty 太小请改大').
4. **真下单**: 用户 YES/对/确认/嗯/是/sí → 调 \`finalize_order\` 真创订单. 不啰嗦.
   用户 NO/取消 → 友好回 "已取消, 想买卖 KAS 随时回我" 不动 state.
   用户改 (例 "改 3 KAS" / "改 ETH" / "改地址") → step 2 重新收集字段, step 3 重新 preview.

# 语言匹配
用户什么语回什么语. 中文回中文, 英文回英文, 西文回西文.

# 失败处理
- 没现成 maker + broker 自挂也不够 → 友好告知 "暂时没 X KAS 卖单, 拆小点 / 换链 / 等等?"
- broker 暂只支持 BSC 链自挂 → 告诉用户 "v1 仅 BSC, 其他链请用 BSC 或等 v2"

# 支付反馈 (T-J2-V2 重写, Owner 真测 #2 退场后)
**铁律**: 用户说已付/已经支付/付过了/check my payment/你帮我查/我已经转过了 等表达 (含或不含 tx hash) →
你必须**先调 verify_payment tool**, 自动反查 BSC. 不要让用户手贴 tx hash, 不要回 "我无法直接查看链上记录".

verify_payment 返回处理:
- ok=true matched → 自然回 user_msg (含 ✓ 找到 tx + 自动验证中 + ETA 30-60s 发 KAS)
- ok=false reason='no_match' → 自然回 user_msg (说明扫了多少笔/期望 amount, 引导发 tx hash 或等等)
- ok=false reason='no_active_order' → 'broker 这边没你的 active 订单, 你下过单吗?'
- ok=false reason='order_expired' → '订单超时了, 重新下单'

如果用户已经贴了 tx hash (含 0x[a-fA-F0-9]{64}) → broker handler 已自动验证 (PAID_REGEX 路径), 你**不要**重复调 verify_payment 也不要回'手贴' — 自然说 '收到 tx, 验证中, 等 30-60s 发 KAS'.

# 风格
- 简洁友善, 像老熟人, 不机械
- 别撒谎, 不知道说"查不到"
- 每 DM 必回 (不 silent)
- 闲聊 (天气/政治/币价) 礼貌引回 broker 业务

# 服务态度铁律 (T-J1-V2-tone, Owner 04-26 真测后钦定)
你是用户的私人交易顾问, 不是售货员, 不是大爷:
- **先 ack 再处理**: 收到任何用户动作必须立刻先 ack 不静默 (例 "好的, 我帮你看看" / "收到, 我处理一下")
- **道歉先于解释**: 出错先 "抱歉" 再说原因 (例 "抱歉慢了一下, 我重试")
- **你帮用户做技术活, 不让用户当 indexer**:
  - 用户说 "已付/我转过了/check" → 你**必须**先调 verify_payment 自动反查, 不要让用户找 tx hash
  - 用户卡住时主动给方案 (而不是 "请按以下步骤")
  - 不要让用户复制粘贴 0x... 哈希
- **不要命令式**: ❌ "请发送你的交易哈希" → ✓ "我去扫链给你确认 ✓"
- 用户感觉等待 > 5s 时主动安抚 ("稍等, 我处理一下")

# 约束
- 不持币 (USDT 用户直付 maker)
- broker fee 0.1 KAS 固定
- 非托管, 1-2 min 到账`;

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
          address: { type: 'string', description: '卖路径必填收款地址' },
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
          address: { type: 'string', description: '卖路径必填 (你 USDT 收款地址 EVM 0x..42 位 / SOL / TRON 格式). 买路径可省.' },
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
  if (/买|要买|想买|购买|买入|想换|换点|换些|换\s*\d|搞|弄|来点|来个|要点|想要|我要|拿|收\s*kas|抢|入手|入仓|入个|取|进|求|欲|给我来|帮我搞|帮我换|帮我买|想吃|吃进/.test(msg)) return 'buy';
  if (/卖|要卖|想卖|出售|卖出|脱手|抛|出货|清仓|换出|套现|减仓|平仓|放/.test(msg)) return 'sell';
  // 英 / 西 (\\b 适用 ASCII)
  if (/\b(buy|purchase|comprar|adquirir)\b/i.test(msg)) return 'buy';
  if (/\b(sell|vender)\b/i.test(msg)) return 'sell';
  // 日 / 韩 — CJK 关键词不能用 \\b (CLAUDE.md 陷阱 #12)
  if (/(購入|買う|구매|사다)/.test(msg)) return 'buy';
  if (/(売る|売却|판매|팔다)/.test(msg)) return 'sell';
  return null;
}

// T-J1-19f (NWT 验证 INTENT_LOCK 失败转 B): 撤 intent_lock system msg 注入 (Qwen 见
// 第二条 system msg 退化返空). 改 deterministic 首轮路径在 handleLlmDialog 实现, _callLlm
// 恢复纯净.
async function _callLlm(messages) {
  const a = sqlite.prepare(`
    SELECT a.ai_provider_url, a.ai_model FROM relay_nodes r
    JOIN adapter_nodes a ON a.id = r.adapter_node_id
    WHERE r.id = ?
  `).get(BROKER_RELAY_ID);
  if (!a?.ai_provider_url) return null;
  try {
    const res = await fetch(`${a.ai_provider_url}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: a.ai_model || 'Qwen3.6-35B-A3B',
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        tools: TOOLS,
        tool_choice: 'auto',
        // QWEN-RULES.md Rule 11 (T-NWT-V2-hotfix2): Qwen3.6 reasoning kill switch.
        // /no_think 前缀 sys/user 都实测无效. 唯一有效是 body 加 chat_template_kwargs.
        // 实测 thinking 1974c → 0c, 响应 8s → 1s. broker 业务不需 reasoning.
        // 同其他 kill 点: agent-adapter/openai.mjs:141 / llm-dispatcher.js:22 / qwen-bridge-worker.js:105.
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: AbortSignal.timeout(120_000),  // T-NWT-V2-hotfix: 60s→120s — Qwen3.6 处理 14k tokens prompt (含 SYSTEM_PROMPT + history) 需 60-90s, 60s 60% 触发 abort. Owner 真测连撞.
    });
    if (!res.ok) {
      console.warn(`[broker-llm] LLM HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    return data.choices?.[0]?.message;
  } catch (e) {
    console.warn(`[broker-llm] LLM err: ${e.message}`);
    return null;
  }
}

async function _executeTool(peer, name, args) {
  if (name === 'preview_order') {
    // 议 B (Owner 钦定): 字段齐 preview, 不真 publish. user YES 后才 finalize_order.
    // T-NWT-2026-04-27 v1.1 Phase E: give_asset propagation (default 'KAS' backward compat).
    const { direction, qty, chain, address, give_asset = 'KAS' } = args || {};
    if (direction === 'buy') {
      const { buyPreview } = await import('./broker-buy-handler.js');
      return buyPreview({ user_kasia: peer, qty, pay_chain: chain, give_asset });
    }
    if (direction === 'sell') {
      // 卖 preview v1.1 留 (sellPreview 待加). 当前 fallback finalize_order 真路径.
      if (!address) return { ok: false, error: '卖路径必填 recv_address' };
      return { ok: false, error: 'sell_preview_v1_1', message: '卖 preview v1.1 加, 当前直接 YES 走真下单. 你确认数量 + 链 + 收款地址后回 YES.' };
    }
    return { ok: false, error: `unknown direction: ${direction}` };
  }
  if (name === 'finalize_order') {
    // T-NWT-2026-04-27 v1.1 Phase E: give_asset propagation (default 'KAS' backward compat).
    const { direction, qty, chain, address, give_asset = 'KAS' } = args || {};
    if (direction === 'buy') {
      const { finalizeBuy } = await import('./broker-buy-handler.js');
      return finalizeBuy({ user_kasia: peer, qty, pay_chain: chain, give_asset });
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

// T-J1-19f deterministic 首轮回复 (NWT B 方案 — 跳过 LLM 防 Qwen 中文 confused).
// 仅当: 首轮 (history 为空) + 检测到 intent (含 'kas' + 方向词).
// LLM 续 turn (用户回 BSC/yes) 自然走 LLM, 此时 history 已含 deterministic reply.
function _extractQty(message) {
  // T-J2-2026-04-27 v1.1 multi-asset extract (KAS / USDT / USDC)
  const m = String(message || '').match(/(\d+(?:\.\d+)?)\s*(?:个|枚|只)?\s*(kas|usdt|usdc)/i);
  return m ? parseFloat(m[1]) : null;
}

// T-J2-2026-04-27 v1.1: 真 detect asset symbol from message (KAS default, USDT/USDC 真识别)
function _detectAsset(message) {
  const msg = String(message || '');
  if (/usdc/i.test(msg)) return 'USDC';
  if (/usdt/i.test(msg)) return 'USDT';
  return 'KAS'; // default
}

function _deterministicFirstReply(intent, qty, lang, asset = 'KAS') {
  // T-J2-2026-04-27 v1.1: asset 参数化 (USDT/USDC + KAS), 真 generic 支持 user 'buy 1 USDC' fast path.
  // lang 用 message 简单 detect, 这里只支持 zh/en/es 简化版 (其他走 LLM)
  const verb = intent === 'buy' ? '买' : '卖';
  const verbEn = intent === 'buy' ? 'buy' : 'sell';
  const verbEs = intent === 'buy' ? 'comprar' : 'vender';
  const payAction = intent === 'buy' ? '付' : '收';
  // KAS 真用 USDT 付/收 (broker handler default), USDT/USDC 真用对方 stable
  const settleAsset = asset === 'KAS' ? 'USDT' : (asset === 'USDC' ? 'USDT' : 'USDC');
  if (lang === 'zh') {
    return qty
      ? `好的, ${verb} ${qty} ${asset}. 用哪个链 ${payAction} ${settleAsset}? (BSC / Polygon / SOL / TRON)`
      : `好的, ${verb} ${asset}. 数量多少? 哪个链?`;
  }
  if (lang === 'es') {
    return qty
      ? `Perfecto, ${verbEs} ${qty} ${asset}. ¿Qué cadena para ${intent === 'buy' ? 'pagar' : 'recibir'} ${settleAsset}? (BSC / Polygon / SOL / TRON)`
      : `Perfecto, ${verbEs} ${asset}. ¿Cuántos? ¿Qué cadena?`;
  }
  // en (default)
  return qty
    ? `Got it, ${verbEn} ${qty} ${asset}. Which chain to ${intent === 'buy' ? 'pay' : 'receive'} ${settleAsset}? (BSC / Polygon / SOL / TRON)`
    : `Got it, ${verbEn} ${asset}. How many? Which chain?`;
}

function _detectLang(message) {
  const msg = String(message || '');
  // CJK 占比 > 30% → zh
  const cjk = (msg.match(/[一-鿿]/g) || []).length;
  if (cjk > 0 && cjk / msg.length > 0.1) return 'zh';
  if (/\b(comprar|vender|hola|sí|qué|cuánto)\b/i.test(msg)) return 'es';
  return 'en';
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
  const intent = _detectIntent(message);
  const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
  const alreadyDeterministic = lastAssistant && /哪个链|哪条链|which chain|qué cadena|cadena para/i.test(lastAssistant.content || '');
  console.log(`[broker-llm DIAG] peer=${peer?.slice(-12)} msg.chars=${msgRaw.length} msg.utf8bytes=${byteLen} codes=[${charCodes}] msg="${msgRaw.slice(0,40)}" history.len=${history.length} intent=${intent} alreadyDet=${!!alreadyDeterministic}`);
  // T-NWT-25 (Owner 04-26 11:55 钦定 A+C): 恢复 deterministic regex 命中 → 100% 模板
  // (T-NWT-24 撤太狠, Qwen 中文 5/7 fail). regex 没命中 → 落 LLM (Qwen 70% 稳, C 部分接受).
  // _detectIntent 已扩展 (T-J1-19k + 现 T-NWT-25 加 拿/收/抢/入手/取/进/求/欲 等).
  if (intent && !alreadyDeterministic) {
    const qty = _extractQty(message);
    const asset = _detectAsset(message);
    // T-J2-2026-04-27 v1.1: per-asset minQty (KAS=1.0, USDT/USDC=0.1 from asset-registry)
    const minQty = asset === 'KAS' ? 1.0 : 0.1;
    if (intent === 'buy' && qty != null && qty < minQty) {
      return `抱歉, 最小买 ${minQty} ${asset} (broker fee + dust 保护). 改大一点吧.`;
    }
    const lang = _detectLang(message);
    return _deterministicFirstReply(intent, qty, lang, asset);
  }
  history.push({ role: 'user', content: message });
  let llm = await _callLlm(history);
  if (!llm) return '抱歉, 我这边 LLM 卡了一下, 请稍后再试. 或直接回 "买 5 KAS" / "卖 5 KAS" 走快速通道.';

  // tool call?
  if (llm.tool_calls?.length) {
    const tc = llm.tool_calls[0];
    let args = {};
    try { args = JSON.parse(tc.function.arguments || '{}'); } catch { return '订单参数解析出错, 请重发订单细节.'; }
    const toolResult = await _executeTool(peer, tc.function.name, args);
    history.push({ role: 'assistant', content: llm.content || '', tool_calls: [tc] });
    history.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolResult) });
    llm = await _callLlm(history);
    if (!llm) {
      return toolResult.ok
        ? `✓ 订单已建 (${args.direction} ${args.qty} KAS, ${args.chain}). 详情: ${JSON.stringify(toolResult).slice(0, 200)}`
        : `订单失败: ${toolResult.error}. 请重新下单.`;
    }
  }

  return llm.content?.trim() || '我在听. 你想买 KAS 还是卖 KAS?';
}
