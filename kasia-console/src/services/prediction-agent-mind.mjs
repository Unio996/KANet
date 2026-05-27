/**
 * KANet Prediction Agent Mind — Menu-based DM state machine
 *
 * Per Bettor r100 R2 final spec (5/27):
 * - 菜单式 deterministic (NOT LLM free-form, broker LLM 走另路)
 * - stateless (= chain truth via DB query, in-memory cache 仅 short-term per-user UI hint)
 * - per-user session via prediction_dm_session table (J2 v147 fd05d33)
 * - event-driven push DM (publish-v2 + chain_event ingest) + 5 min cron 备份
 *
 * Router (NWT conversations.js sub):
 * - "/" + digit prefix → handleDmMessage() here
 * - 自然语言 → broker LLM agent (broker-llm-agent.js)
 *
 * UI scope (KANet-UI):
 * - state machine + DB query helpers + DM reply formatter
 *
 * 0 in-memory state mutation. DB is source of truth for protocol_status.
 * prediction_dm_session table 仅 cache "user 上次选哪 market / outcome" for UX continuity.
 */

import { sqlite as _sqlite } from '../db/client.js';
function getDb() { return _sqlite; }

// ── State machine constants ──────────────────────────────────────────────

const STATE = {
  IDLE: 'IDLE',
  SELECT_MARKET: 'SELECT_MARKET',
  SELECT_OUTCOME: 'SELECT_OUTCOME',
  CONFIRM_STAKE: 'CONFIRM_STAKE',
  WAITING_TAKER: 'WAITING_TAKER',
  MATCHED: 'MATCHED',
  COMPLETED: 'COMPLETED',
  DISPUTED: 'DISPUTED',
};

const MENU = {
  PREDICT: '/predict',
  CREATE: '/create',
  MY_BETS: '/my_bets',
  HELP: '/help',
  CANCEL: '/cancel',
  CONFIRM: '/confirm',
};

const STAKE_OPTIONS_KAS = [10, 50, 100];

// ── DB query helpers (= chain truth, stateless) ──────────────────────────

/**
 * Fetch active pool markets (= status='open' in pool_markets table).
 * Returns top N by deadline asc (soonest first).
 */
function fetchActiveMarkets(limit = 5) {
  const db = getDb();
  return db.prepare(`
    SELECT market_id, question, outcomes_json, deadline, maker_stake_kas
    FROM pool_markets
    WHERE status = 'open' AND deadline > datetime('now')
    ORDER BY deadline ASC
    LIMIT ?
  `).all(limit);
}

/**
 * Fetch user's own bets (= as maker or taker in pool_offers).
 */
function fetchUserBets(senderAddress) {
  const db = getDb();
  return db.prepare(`
    SELECT offer_id, market_id, side, stake_kas, protocol_status, created_at
    FROM pool_offers
    WHERE maker_addr = ? OR taker_addr = ?
    ORDER BY created_at DESC
    LIMIT 10
  `).all(senderAddress, senderAddress);
}

/**
 * Get or initialize user's DM session (J2 v147 prediction_dm_session table).
 */
function getOrInitSession(senderAddress) {
  const db = getDb();
  let row = db.prepare(`SELECT * FROM prediction_dm_session WHERE sender_address = ?`).get(senderAddress);
  if (!row) {
    db.prepare(`
      INSERT INTO prediction_dm_session (sender_address, state, context_json, updated_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(senderAddress, STATE.IDLE, '{}');
    row = db.prepare(`SELECT * FROM prediction_dm_session WHERE sender_address = ?`).get(senderAddress);
  }
  return row;
}

/**
 * Update session state + context.
 */
function updateSession(senderAddress, state, contextPatch = {}) {
  const db = getDb();
  const cur = getOrInitSession(senderAddress);
  const ctx = { ...JSON.parse(cur.context_json || '{}'), ...contextPatch };
  db.prepare(`
    UPDATE prediction_dm_session
    SET state = ?, context_json = ?, updated_at = datetime('now')
    WHERE sender_address = ?
  `).run(state, JSON.stringify(ctx), senderAddress);
}

// ── DM reply formatters (= deterministic menu rendering) ────────────────

function renderHelp() {
  return [
    'KANet Prediction Agent — DM 菜单',
    '',
    '/predict   — 浏览活跃市场 + 下注',
    '/my_bets   — 我的下注 + 状态',
    '/create    — 创建新市场 (= 跳转 Markets UI)',
    '/cancel    — 取消当前流程',
    '/help      — 这个菜单',
    '',
    '直接回数字 (1-N) 选菜单项。',
    '自然语言 ("押 X 50") 会路由到 broker LLM agent (= 不是这里).',
  ].join('\n');
}

function renderMarketList(markets) {
  if (!markets.length) {
    return [
      '当前 0 个活跃市场。',
      '',
      '回 /create 创建 (= 跳 Markets ▶ Predictions UI)',
      '回 /help 帮助',
    ].join('\n');
  }
  const lines = ['活跃市场:'];
  markets.forEach((m, i) => {
    const ddl = new Date(m.deadline).toISOString().slice(0, 10);
    lines.push(`[${i + 1}] ${m.question} (deadline ${ddl}, maker stake ${m.maker_stake_kas} KAS)`);
  });
  lines.push('', `回 1-${markets.length} 选市场, OR /create /my_bets /help`);
  return lines.join('\n');
}

function renderOutcomeList(market) {
  const outcomes = JSON.parse(market.outcomes_json || '[]');
  const lines = [`市场: ${market.question}`, '', '选 outcome 押:'];
  outcomes.forEach((o, i) => {
    lines.push(`[${i + 1}] ${o}`);
  });
  lines.push('', `回 1-${outcomes.length} 选 outcome, OR /cancel`);
  return lines.join('\n');
}

function renderStakeOptions(market, outcomeIdx) {
  const outcomes = JSON.parse(market.outcomes_json || '[]');
  const lines = [
    `市场: ${market.question}`,
    `Outcome: ${outcomes[outcomeIdx]}`,
    '',
    '选 stake 数额 (KAS):',
  ];
  STAKE_OPTIONS_KAS.forEach((amt, i) => {
    lines.push(`[${i + 1}] ${amt} KAS`);
  });
  lines.push(`[${STAKE_OPTIONS_KAS.length + 1}] custom (回数字)`);
  lines.push('', `回 1-${STAKE_OPTIONS_KAS.length + 1} OR /cancel`);
  return lines.join('\n');
}

function renderConfirmation(ctx) {
  return [
    '准备 publish 下注:',
    `市场: ${ctx.market_question}`,
    `Outcome: ${ctx.outcome_label}`,
    `Stake: ${ctx.stake_kas} KAS`,
    '',
    '回 /confirm 确认 (= escrow lock + 等 taker)',
    '回 /cancel 取消',
  ].join('\n');
}

function renderMyBets(bets) {
  if (!bets.length) return '0 下注 history. 回 /predict 开始。';
  const lines = ['我的下注:'];
  bets.forEach((b, i) => {
    const ts = (b.created_at || '').slice(0, 16);
    lines.push(`[${i + 1}] ${b.offer_id.slice(0, 12)}... ${b.side} ${b.stake_kas} KAS · ${b.protocol_status} · ${ts}`);
  });
  return lines.join('\n');
}

// ── Main DM dispatcher (= called by NWT's conversations.js router) ──────

/**
 * Handle a DM message from senderAddress.
 * Returns reply text to send back (or null to stay silent).
 *
 * Router contract (NWT sub):
 * - Only called when first char matches "/" OR digit (= deterministic prefix).
 * - Self-address contract: senderAddress must be the OTHER party (= not us).
 *
 * @param {string} senderAddress — kaspa: sender address
 * @param {string} text — raw DM message text
 * @returns {Promise<string|null>} — reply text or null
 */
export async function handleDmMessage(senderAddress, text) {
  if (!senderAddress || !text) return null;

  const trimmed = text.trim();
  if (!trimmed) return null;

  const session = getOrInitSession(senderAddress);
  const ctx = JSON.parse(session.context_json || '{}');

  // /help — anywhere
  if (trimmed === MENU.HELP) return renderHelp();

  // /cancel — reset to IDLE
  if (trimmed === MENU.CANCEL) {
    updateSession(senderAddress, STATE.IDLE, {});
    return '已取消. 回 /predict 重新开始 OR /help 菜单.';
  }

  // /create — UI delegation
  if (trimmed === MENU.CREATE) {
    return [
      '创建新市场需要 Markets UI:',
      '浏览器开 http://192.168.1.105:3200/predictions/pool/create',
      '',
      '(= 当前 DM 菜单只支持 接现有市场, create 走 web 表单)',
    ].join('\n');
  }

  // /my_bets — anywhere
  if (trimmed === MENU.MY_BETS) {
    return renderMyBets(fetchUserBets(senderAddress));
  }

  // /predict — enter SELECT_MARKET state
  if (trimmed === MENU.PREDICT) {
    const markets = fetchActiveMarkets();
    updateSession(senderAddress, STATE.SELECT_MARKET, { markets_snapshot: markets.map(m => m.market_id) });
    return renderMarketList(markets);
  }

  // /confirm — only valid in CONFIRM_STAKE state
  if (trimmed === MENU.CONFIRM) {
    if (session.state !== STATE.CONFIRM_STAKE) {
      return '没有待确认的下注. 回 /predict 开始 OR /help 菜单.';
    }
    // TODO: call POST /api/prediction/publish-v2 with ctx
    // For now placeholder reply pending integration with prediction relay handler
    return [
      '⏳ /confirm 收, 准备 publish-v2 escrow lock (= 实际 wire 等 NWT router 完成).',
      `市场: ${ctx.market_question}`,
      `Outcome: ${ctx.outcome_label}`,
      `Stake: ${ctx.stake_kas} KAS`,
      '',
      '(= placeholder, 等 prediction-agent integration ship)',
    ].join('\n');
  }

  // Number selection — context-dependent
  const num = parseInt(trimmed, 10);
  if (Number.isInteger(num) && num >= 1) {
    if (session.state === STATE.SELECT_MARKET) {
      const marketIds = ctx.markets_snapshot || [];
      if (num > marketIds.length) return `无效选项. 请回 1-${marketIds.length}.`;
      const db = getDb();
      const market = db.prepare(`SELECT * FROM pool_markets WHERE market_id = ?`).get(marketIds[num - 1]);
      if (!market) return '该市场已不存在 (= 可能 closed). 回 /predict 刷新.';
      updateSession(senderAddress, STATE.SELECT_OUTCOME, {
        market_id: market.market_id,
        market_question: market.question,
      });
      return renderOutcomeList(market);
    }

    if (session.state === STATE.SELECT_OUTCOME) {
      const db = getDb();
      const market = db.prepare(`SELECT * FROM pool_markets WHERE market_id = ?`).get(ctx.market_id);
      if (!market) return '市场已 closed. 回 /predict 刷新.';
      const outcomes = JSON.parse(market.outcomes_json || '[]');
      if (num > outcomes.length) return `无效选项. 请回 1-${outcomes.length}.`;
      updateSession(senderAddress, STATE.CONFIRM_STAKE, {
        ...ctx,
        outcome_idx: num - 1,
        outcome_label: outcomes[num - 1],
      });
      return renderStakeOptions(market, num - 1);
    }

    if (session.state === STATE.CONFIRM_STAKE) {
      let stakeKas;
      if (num <= STAKE_OPTIONS_KAS.length) {
        stakeKas = STAKE_OPTIONS_KAS[num - 1];
      } else {
        // Treat as custom amount (= the number itself is stake KAS)
        stakeKas = num;
      }
      updateSession(senderAddress, STATE.CONFIRM_STAKE, { ...ctx, stake_kas: stakeKas });
      return renderConfirmation({ ...ctx, stake_kas: stakeKas });
    }
  }

  // Fallback — unknown input
  return [
    '不理解输入. 当前 state: ' + session.state,
    '',
    '回 /help 菜单, /cancel 取消重来.',
  ].join('\n');
}

// ── Push DM helpers (= called by event-driven hooks) ────────────────────

/**
 * Push DM to user after publish-v2 success (= stake locked, WAITING_TAKER).
 * Called by NWT/J2 publish-v2 endpoint success handler.
 */
export function buildPublishedDm(market, stakeKas, deadline) {
  return [
    `✅ 下注 published, escrow locked ${stakeKas} KAS`,
    `市场: ${market.question}`,
    `Deadline: ${new Date(deadline).toISOString().slice(0, 16)}`,
    '',
    'WAITING_TAKER. 等 counterparty accept.',
    '回 /my_bets 查看状态.',
  ].join('\n');
}

/**
 * Push DM after chain_event ingest pool_taker_stake (= MATCHED).
 */
export function buildMatchedDm(offerId, market, takerAddr) {
  return [
    `🎯 下注 MATCHED`,
    `Offer: ${offerId.slice(0, 12)}...`,
    `市场: ${market.question}`,
    `Taker: ${takerAddr.slice(0, 12)}...`,
    '',
    '等 deadline reach + outcome 确认.',
    '回 /my_bets 查状态.',
  ].join('\n');
}

/**
 * Push DM after settle_consensual_dispatched (= COMPLETED).
 */
export function buildCompletedDm(offerId, market, winnerOutcome, payoutTxId, payoutKas, isWinner) {
  const status = isWinner ? '🏆 WON' : '✗ LOST';
  return [
    `${status} — Offer ${offerId.slice(0, 12)}... settled`,
    `市场: ${market.question}`,
    `Winner outcome: ${winnerOutcome}`,
    `Payout: ${payoutKas} KAS (TX ${payoutTxId.slice(0, 16)}...)`,
  ].join('\n');
}

// ── Cron backup (5 min tick) ─────────────────────────────────────────────

/**
 * Scan for stale WAITING_TAKER sessions, scan MATCHED 近 deadline 提醒.
 * Called by cron-tick.js every 5 min.
 */
export function cronTickReminders() {
  const db = getDb();
  // Stale WAITING_TAKER > 6h 老 (= 半个 stake offer 周期)
  const stale = db.prepare(`
    SELECT s.sender_address, o.offer_id, o.created_at
    FROM prediction_dm_session s
    JOIN pool_offers o ON o.maker_addr = s.sender_address
    WHERE s.state = 'WAITING_TAKER'
      AND o.protocol_status = 'open'
      AND datetime(o.created_at) < datetime('now', '-6 hours')
    LIMIT 50
  `).all();

  // Near deadline (= < 1h to deadline + protocol_status=matched)
  const nearDeadline = db.prepare(`
    SELECT o.maker_addr, o.taker_addr, o.offer_id, m.deadline, m.question
    FROM pool_offers o
    JOIN pool_markets m ON m.market_id = o.market_id
    WHERE o.protocol_status = 'matched'
      AND datetime(m.deadline) BETWEEN datetime('now') AND datetime('now', '+1 hour')
    LIMIT 50
  `).all();

  return { stale, nearDeadline };
}

// Re-export STATE + MENU for test framework
export { STATE, MENU, STAKE_OPTIONS_KAS };
