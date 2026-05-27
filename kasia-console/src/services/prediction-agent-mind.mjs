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
 * Fetch active offers awaiting taker (= protocol_status='pending_taker' in exchange_offers,
 * since pool_markets is maker-first and taker-side flow uses exchange_offers per E pre-handshake).
 * Returns top N by handshake expiry asc (soonest first).
 */
function fetchActiveMarkets(limit = 5) {
  const db = getDb();
  // E pre-handshake flow uses exchange_offers (= /api/prediction/pending-offer L1490 bettor.js)
  return db.prepare(`
    SELECT id, maker_relay_id, outcome_oracle_relay_ids AS oracle_relay_ids,
           outcome_market_source, outcome_condition_id, outcome_token_id, outcome_side,
           pending_handshake_expires_at AS deadline, give_amount AS maker_stake_amount
    FROM exchange_offers
    WHERE protocol_status = 'pending_taker'
      AND pending_handshake_expires_at > datetime('now')
    ORDER BY pending_handshake_expires_at ASC
    LIMIT ?
  `).all(limit);
}

/**
 * Fetch user's own offers — exchange_offers where maker_relay_id == user OR taker (addr) == user.
 *
 * @param {string} senderAddress — user's kaspa addr
 * @param {string} [relayId] — user's relay_node_id (optional, for maker-side filter)
 */
function fetchUserBets(senderAddress, relayId) {
  const db = getDb();
  if (relayId) {
    return db.prepare(`
      SELECT id, outcome_market_source, outcome_condition_id, outcome_side,
             give_amount AS maker_stake_amount, protocol_status, pending_handshake_expires_at AS deadline, created_at
      FROM exchange_offers
      WHERE maker_relay_id = ? OR taker = ?
      ORDER BY created_at DESC
      LIMIT 10
    `).all(relayId, senderAddress);
  }
  return db.prepare(`
    SELECT id, outcome_market_source, outcome_condition_id, outcome_side,
           give_amount AS maker_stake_amount, protocol_status, pending_handshake_expires_at AS deadline, created_at
    FROM exchange_offers
    WHERE taker = ?
    ORDER BY created_at DESC
    LIMIT 10
  `).all(senderAddress);
}

/** Compose human-readable market name from outcome cols (no `question` col in schema). */
function marketLabel(m) {
  const src = (m.outcome_market_source || '?').slice(0, 12);
  const cond = (m.outcome_condition_id || '?').slice(0, 12);
  const side = m.outcome_side || '?';
  return `${src}/${cond} (${side})`;
}

/**
 * Get or initialize user's DM session (J2 v147 prediction_dm_session table).
 * Schema: sender_address PK + last_market_id + last_outcome + last_action + updated_at
 * State encoded in last_action prefix: "STATE:..." (= avoid schema dependency on `state` col).
 */
function getOrInitSession(senderAddress) {
  const db = getDb();
  let row = db.prepare(`SELECT * FROM prediction_dm_session WHERE sender_address = ?`).get(senderAddress);
  if (!row) {
    db.prepare(`
      INSERT INTO prediction_dm_session (sender_address, last_market_id, last_outcome, last_action, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(senderAddress, null, null, 'STATE:IDLE');
    row = db.prepare(`SELECT * FROM prediction_dm_session WHERE sender_address = ?`).get(senderAddress);
  }
  // Derive state from last_action prefix (= "STATE:SELECT_MARKET" etc.)
  const action = row.last_action || 'STATE:IDLE';
  row.state = action.startsWith('STATE:') ? action.slice(6).split('|')[0] : 'IDLE';
  // Derive aux from last_action suffix (= "STATE:CONFIRM_STAKE|stake=50" → 50)
  const auxPart = action.includes('|') ? action.split('|').slice(1).join('|') : '';
  row.aux = Object.fromEntries(
    auxPart.split('|').filter(Boolean).map(p => {
      const eq = p.indexOf('=');
      return eq >= 0 ? [p.slice(0, eq), p.slice(eq + 1)] : [p, true];
    })
  );
  return row;
}

/**
 * Update session state + market + outcome + aux.
 * aux encoded into last_action via "|key=value" suffix (= bypass schema lacking context_json).
 */
function updateSession(senderAddress, state, patch = {}) {
  const db = getDb();
  const cur = getOrInitSession(senderAddress);
  // Merge aux: new patch overrides cur.aux
  const auxMerged = { ...cur.aux, ...(patch.aux || {}) };
  const auxStr = Object.entries(auxMerged).map(([k, v]) => `${k}=${v}`).join('|');
  const lastAction = auxStr ? `STATE:${state}|${auxStr}` : `STATE:${state}`;
  const lastMarketId = patch.last_market_id !== undefined ? patch.last_market_id : cur.last_market_id;
  const lastOutcome = patch.last_outcome !== undefined ? patch.last_outcome : cur.last_outcome;
  db.prepare(`
    UPDATE prediction_dm_session
    SET last_market_id = ?, last_outcome = ?, last_action = ?, updated_at = datetime('now')
    WHERE sender_address = ?
  `).run(lastMarketId, lastOutcome, lastAction, senderAddress);
}

// ── DM reply formatters (= deterministic menu rendering) ────────────────

function renderHelp() {
  return [
    'KANet Prediction Agent — DM 菜单 (v1 pure betting)',
    '',
    '/predict   — 浏览活跃市场 + 下注',
    '/my_bets   — 我的下注 + 状态',
    '/cancel    — 取消当前流程',
    '/help      — 这个菜单',
    '',
    '直接回数字 (1-N) 选菜单项。',
    '自然语言 ("押 X 50") 会路由到 broker LLM agent (= 不是这里).',
    '',
    '想创建新市场? 浏览器开 http://192.168.1.105:3200/predictions/pool/create',
  ].join('\n');
}

function renderMarketList(markets) {
  if (!markets.length) {
    return [
      '当前 0 个等待 taker 的市场。',
      '',
      '想创建? 浏览器开 http://192.168.1.105:3200/predictions/pool/create',
      '回 /help 看完整 menu。',
    ].join('\n');
  }
  const lines = ['活跃市场:'];
  markets.forEach((m, i) => {
    const ddl = (m.deadline || '').slice(0, 10);
    const stake = (m.maker_stake_amount || 0) / 100_000_000; // sompi → KAS
    lines.push(`[${i + 1}] ${marketLabel(m)} (deadline ${ddl}, maker stake ${stake} KAS)`);
  });
  lines.push('', `回 1-${markets.length} 选市场, OR /create /my_bets /help`);
  return lines.join('\n');
}

function renderOutcomeList(market) {
  // pool_markets stores outcome_side as a single field (= YES/NO/winner_idx 等 binary by spec).
  // Render side selection: taker can pick the OPPOSITE side of maker.
  const makerSide = market.outcome_side || '?';
  const oppSide = makerSide === 'YES' ? 'NO' : (makerSide === 'NO' ? 'YES' : `opposite of ${makerSide}`);
  const lines = [
    `市场: ${marketLabel(market)}`,
    `Maker 押: ${makerSide}`,
    '',
    '选你的押注:',
    `[1] ${oppSide} (= 跟 maker 对赌)`,
  ];
  lines.push('', '回 1 确认对赌, OR /cancel');
  return lines.join('\n');
}

function renderStakeOptions(market, outcomeIdx) {
  const lines = [
    `市场: ${marketLabel(market)}`,
    `你押: outcome ${outcomeIdx + 1}`,
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
    `市场: ${ctx.market_label}`,
    `押: ${ctx.outcome_label}`,
    `Stake: ${ctx.stake_kas} KAS`,
    '',
    '回 /confirm 确认 (= taker-handshake + escrow lock)',
    '回 /cancel 取消',
  ].join('\n');
}

function renderMyBets(bets) {
  if (!bets.length) return '0 下注 history. 回 /predict 开始。';
  const lines = ['我的下注:'];
  bets.forEach((b, i) => {
    const ts = (b.created_at || '').slice(0, 16);
    const stake = (b.maker_stake_amount || 0) / 100_000_000;
    lines.push(`[${i + 1}] ${b.id.slice(0, 12)}... · ${marketLabel(b)} · ${stake} KAS · ${b.protocol_status} · ${ts}`);
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
 * @param {string} senderAddress — kaspa: sender address (= the OTHER party DM'ing us)
 * @param {string} text — raw DM message text
 * @param {object} [ctx] — optional context: { relayId, baseUrl }. relayId is our agent's relay_node_id.
 * @returns {Promise<string|null>} — reply text or null
 */
export async function handleDmMessage(senderAddress, text, ctx = {}) {
  if (!senderAddress || !text) return null;
  const { relayId, baseUrl = 'http://127.0.0.1:3200' } = ctx;

  const trimmed = text.trim();
  if (!trimmed) return null;

  const session = getOrInitSession(senderAddress);
  // session.state derived from last_action prefix, session.aux from suffix kv pairs
  // session.last_market_id + session.last_outcome from direct cols

  // /help — anywhere
  if (trimmed === MENU.HELP) return renderHelp();

  // /cancel — reset to IDLE
  if (trimmed === MENU.CANCEL) {
    updateSession(senderAddress, STATE.IDLE, { last_market_id: null, last_outcome: null, aux: {} });
    return '已取消. 回 /predict 重新开始 OR /help 菜单.';
  }

  // /create — v1 cut per Owner钦定 r104 (= pure betting MVP)
  // Reply with web UI delegation pointer if user attempts
  if (trimmed === MENU.CREATE) {
    return [
      'v1 DM 仅押注 (= 不含创单).',
      '想创建新市场? 浏览器开:',
      'http://192.168.1.105:3200/predictions/pool/create',
      '',
      '回 /help 看 v1 完整 menu.',
    ].join('\n');
  }

  // /my_bets — anywhere
  if (trimmed === MENU.MY_BETS) {
    return renderMyBets(fetchUserBets(senderAddress, relayId));
  }

  // /predict — enter SELECT_MARKET state
  if (trimmed === MENU.PREDICT) {
    const markets = fetchActiveMarkets();
    // Encode markets snapshot ids into aux as comma-list (= short enough for last_action col)
    updateSession(senderAddress, STATE.SELECT_MARKET, {
      aux: { ms: markets.map(m => m.id.slice(-8)).join(',') },
    });
    return renderMarketList(markets);
  }

  // /confirm — only valid in CONFIRM_STAKE state. Wire taker-handshake → taker-stake real call.
  if (trimmed === MENU.CONFIRM) {
    if (session.state !== STATE.CONFIRM_STAKE) {
      return '没有待确认的下注. 回 /predict 开始 OR /help 菜单.';
    }
    if (!relayId) {
      return [
        '⚠ /confirm 需 relay context (= NWT router 应 pass relayId 给 handleDmMessage).',
        '当前 session ready: market=' + (session.last_market_id || '?') + ', side=' + (session.last_outcome || '?') + ', stake=' + (session.aux.stake || '?') + ' KAS',
        '',
        '请 console restart load NWT 完整 router OR DM via UI 自行 publish-v2.',
      ].join('\n');
    }

    // Step 1: taker-handshake to register our taker_kaspa_addr → derive pubkey
    try {
      const handshakeRes = await fetch(`${baseUrl}/api/prediction/taker-handshake/${session.last_market_id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taker_kaspa_addr: senderAddress }),
      });
      const handshakeJson = await handshakeRes.json();
      if (!handshakeRes.ok || !handshakeJson.ok) {
        updateSession(senderAddress, STATE.IDLE, { aux: {} });
        return `❌ taker-handshake fail: ${handshakeJson.error || handshakeRes.status}. /predict 重来.`;
      }

      // Step 2: maker publishes-v2 (= maker-side action, NOT our DM scope, must already happened)
      // Per E pre-handshake flow: maker → pending-offer → wait taker handshake → maker publish-v2 → taker-stake
      // We are taker, so we wait for status='open_awaiting_taker_stake' then call taker-stake.

      // Step 3: taker-stake (= fund escrow)
      const stakeRes = await fetch(`${baseUrl}/api/prediction/taker-stake/${session.last_market_id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taker_relay_id: relayId }),
      });
      const stakeJson = await stakeRes.json();
      if (!stakeRes.ok || !stakeJson.ok) {
        // Common case: status mismatch (= maker has NOT yet publish-v2)
        updateSession(senderAddress, STATE.WAITING_TAKER, { aux: {} });
        return [
          '⏳ Handshake ✓ but taker-stake 等 maker publish-v2 first.',
          `Offer: ${session.last_market_id}`,
          `Reason: ${stakeJson.error || stakeRes.status}`,
          '',
          '等 maker publish (= push DM 后续).  /my_bets 查看.',
        ].join('\n');
      }

      updateSession(senderAddress, STATE.MATCHED, { aux: { tx: stakeJson.txid || stakeJson.tx } });
      return [
        '🎯 stake locked + MATCHED!',
        `Offer: ${session.last_market_id}`,
        `Taker stake: ${session.aux.stake} KAS → P2SH escrow`,
        `TX: ${(stakeJson.txid || stakeJson.tx || '?').slice(0, 20)}...`,
        '',
        '等 deadline + consensual settle. /my_bets 查状态.',
      ].join('\n');
    } catch (e) {
      return `❌ /confirm wire fail: ${e.message}. /predict 重来.`;
    }
  }

  // Number selection — context-dependent
  const num = parseInt(trimmed, 10);
  if (Number.isInteger(num) && num >= 1) {
    const db = getDb();

    if (session.state === STATE.SELECT_MARKET) {
      // Re-fetch fresh markets (= chain truth, snapshot may be stale)
      const markets = fetchActiveMarkets();
      if (num > markets.length) return `无效选项. 请回 1-${markets.length}.`;
      const market = markets[num - 1];
      updateSession(senderAddress, STATE.SELECT_OUTCOME, { last_market_id: market.id });
      return renderOutcomeList(market);
    }

    if (session.state === STATE.SELECT_OUTCOME) {
      const market = db.prepare(`SELECT * FROM pool_markets WHERE id = ?`).get(session.last_market_id);
      if (!market) return '市场已 closed. 回 /predict 刷新.';
      // Binary outcome: only 1 valid choice (= opposite of maker)
      if (num !== 1) return '无效选项. 回 1 确认对赌, OR /cancel.';
      const makerSide = market.outcome_side || '?';
      const oppSide = makerSide === 'YES' ? 'NO' : (makerSide === 'NO' ? 'YES' : `opposite of ${makerSide}`);
      updateSession(senderAddress, STATE.CONFIRM_STAKE, { last_outcome: oppSide });
      return renderStakeOptions(market, 0);
    }

    if (session.state === STATE.CONFIRM_STAKE) {
      let stakeKas;
      if (num <= STAKE_OPTIONS_KAS.length) {
        stakeKas = STAKE_OPTIONS_KAS[num - 1];
      } else {
        stakeKas = num;
      }
      updateSession(senderAddress, STATE.CONFIRM_STAKE, { aux: { stake: stakeKas } });
      const market = db.prepare(`SELECT * FROM pool_markets WHERE id = ?`).get(session.last_market_id);
      return renderConfirmation({
        market_label: market ? marketLabel(market) : session.last_market_id,
        outcome_label: session.last_outcome,
        stake_kas: stakeKas,
      });
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
    `市场: ${marketLabel(market)}`,
    `Deadline: ${(deadline || '').slice(0, 16)}`,
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
    `市场: ${marketLabel(market)}`,
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
    `市场: ${marketLabel(market)}`,
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
