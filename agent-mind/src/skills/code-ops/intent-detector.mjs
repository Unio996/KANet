/**
 * intent-detector.mjs — Semantic intent classification for behavior layer escalation.
 *
 * NOT keyword matching. Uses pattern groups to classify user intent into target layer.
 * Patterns are broad enough to catch natural language ("帮我看看怎么回事" → L3).
 *
 * Returns: { targetLayer: 'L1'|'L2'|'L3'|'L4', confidence: number, category: string }
 */

// Pattern groups: each has multiple regex patterns, any match → that category
const INTENT_PATTERNS = {
  // L4: Execute / modify / fix
  act: {
    targetLayer: 'L4',
    patterns: [
      // English
      /\b(fix|repair|patch|modify|change|update|edit|write|deploy|install|restart|reboot|kill|stop|start)\b/i,
      /\b(run|execute|apply|do it|go ahead|proceed|confirm|approve)\b/i,
      /(就这样改|改吧|执行|确认|修|部署|更新|重启|安装|删除|移除)/,
      /(改一下|修一下|弄一下|搞一下|处理一下)/,
      // Context: user approving a prior L2 plan
      /^(ok|yes|好|行|可以|没问题|确认|同意|去吧|干吧|就这样)$/i,
    ],
  },

  // L3: Diagnose / observe / check
  observe: {
    targetLayer: 'L3',
    patterns: [
      /\b(check|diagnose|debug|investigate|analyze|inspect|look at|examine|monitor|trace)\b/i,
      /\b(read|show|display|list|find|search|scan|grep|view|see)\b/i,
      /\bwh(at|y|ere|en|ich).*\b(wrong|broken|error|fail|issue|problem|bug|crash)\b/i,
      /(查|看|检查|诊断|分析|调查|排查|监控|追踪)/,
      /(怎么回事|什么问题|什么情况|出了什么|为什么.*不|为啥.*不|好像挂了|好像不对|不正常)/,
      /(日志|log|error|报错|异常)/i,
    ],
  },

  // L2: Plan / design / write code (text output, no execution)
  task: {
    targetLayer: 'L2',
    patterns: [
      /\b(plan|design|draft|write|create|generate|suggest|propose|outline|architect)\b.*\b(code|script|patch|fix|solution|approach|scheme)\b/i,
      /\b(how to|how would|how should|what if|help me.*方案)\b/i,
      /(写.*方案|写.*代码|设计|草案|规划|建议|怎么.*对接|如何.*实现|帮我写)/,
      /(API.*文档|接入.*文档|对接方案)/,
    ],
  },
};

// Confirmation patterns (user saying "yes" to a pending escalation)
const CONFIRM_PATTERNS = [
  /^(ok|yes|yeah|yep|sure|go|do it|proceed|confirm|y)$/i,
  /^(好|行|可以|没问题|确认|同意|去吧|干吧|就这样|对|嗯|是|是的|好的|确定|查吧|看吧|开始|继续)$/i,
  /^(就这样改|改吧|修吧|执行吧|开始吧)$/i,
];

/**
 * Detect user intent and map to target behavior layer.
 *
 * @param {string} message — user's input message
 * @param {string} currentLayer — current behavior layer
 * @param {boolean} hasPendingConfirm — whether we're waiting for escalation confirmation
 * @returns {{ targetLayer: string, confidence: number, category: string, isConfirmation: boolean }}
 */
export function detectIntent(message, currentLayer = 'L1', hasPendingConfirm = false) {
  const trimmed = (message || '').trim();
  if (!trimmed) return { targetLayer: 'L1', confidence: 0, category: 'empty', isConfirmation: false };

  // Check if this is a confirmation of a pending escalation
  if (hasPendingConfirm) {
    for (const p of CONFIRM_PATTERNS) {
      if (p.test(trimmed)) {
        return { targetLayer: null, confidence: 1.0, category: 'confirm', isConfirmation: true };
      }
    }
    // Negative confirmation
    if (/^(no|nah|cancel|stop|不|算了|取消|不要|不用)$/i.test(trimmed)) {
      return { targetLayer: 'L1', confidence: 1.0, category: 'deny', isConfirmation: false };
    }
  }

  // Check L4 first (most specific), then L3, then L2
  // If in L2 and user sends a short affirmation, it's a L2→L4 jump
  if (currentLayer === 'L2') {
    for (const p of INTENT_PATTERNS.act.patterns) {
      if (p.test(trimmed)) {
        return { targetLayer: 'L4', confidence: 0.9, category: 'act_from_l2', isConfirmation: false };
      }
    }
  }

  for (const [category, config] of Object.entries(INTENT_PATTERNS)) {
    for (const p of config.patterns) {
      if (p.test(trimmed)) {
        return {
          targetLayer: config.targetLayer,
          confidence: 0.8,
          category,
          isConfirmation: false,
        };
      }
    }
  }

  // No match → stay at current or L1
  return { targetLayer: 'L1', confidence: 0.5, category: 'social', isConfirmation: false };
}

/**
 * Check if a sender is allowed to trigger layer escalation.
 * @param {string} relation — 'owner' | 'sibling' | 'trusted' | 'stranger' | 'blocked'
 * @param {string} targetLayer
 * @returns {{ allowed: boolean, maxLayer: string }}
 */
export function checkSenderPermission(relation, targetLayer) {
  if (relation === 'owner') return { allowed: true, maxLayer: 'L4' };
  if (relation === 'sibling' || relation === 'trusted') {
    const allowed = targetLayer !== 'L4';
    return { allowed, maxLayer: 'L3' };
  }
  // stranger / blocked: L1 only
  return { allowed: targetLayer === 'L1', maxLayer: 'L1' };
}
