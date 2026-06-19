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
import { emitDmMenuAction } from '../api/audit-prediction.js';
function getDb() { return _sqlite; }

// KANet-UI 2026-06-13 (Bettor r787 ④): wire DM menu actions into the audit trail (fixes
// last_7_days_dm 空 — emitDmMenuAction existed but was never called). CRITICAL (Bettor r787 注):
// audit is a SIDE-EFFECT, never blocking — a failed emit MUST NOT break the DM/betting flow
// (register-v06 落链 main path must not depend on this). Every call goes through this swallow-wrapper.
function safeEmit(opts) {
  try { emitDmMenuAction(opts); } catch (e) { /* audit side-effect — swallow, never block betting */ }
}

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
 * Fetch active markets the user can bet on. DUAL-PATH (Bettor r728/r730 approved):
 *  - Path A (PRIMARY, kind='pool'): pool_markets v0.6/v0.7 committee-judged. Broker-introduced
 *    markets live here (seeder sets broker_relay_id). Bettors register via register-v06
 *    (= line-B proven path). This is what Owner task#3 (DM real betting) targets.
 *  - Path B (PRESERVED旁路, kind='offer'): exchange_offers E pre-handshake (P2P escrow).
 *    UNCHANGED — keeps r106 Bug A null-field filter intact, no regression of working路.
 * Pool markets first (主推 broker 经手 committee 市场), then offers, capped to limit.
 *
 * @param {string} [brokerRelayId] — if set, restrict pool path to this broker's markets
 *   (= broker-introduction filter, broker加强 Phase 2 hook).
 */
function fetchActiveMarkets(limit = 5, brokerRelayId = null) {
  const db = getDb();
  // Path A: pool_markets committee-judged (= register-v06 flow, my line-B 验通真路).
  // ONLY v0.6/v0.7 — confirmPoolBet uses register-v06 which rejects v0.5 (= /register-external path).
  // deadline > now (unix sec) drops expired markets (= can't usefully bet). M2 self-test caught the
  // v0.5 leak (stale 2026-05-29 markets ranked first by deadline ASC → register-v06 400).
  const nowUnix = Math.floor(Date.now() / 1000);
  const pools = db.prepare(`
    SELECT id, maker_relay_id, broker_relay_id, broker_fee_pct,
           outcome_market_source, outcome_condition_id, outcome_token_id, outcome_side,
           resolution_rule_spec, deadline, maker_stake_amount, 'pool' AS kind
    FROM pool_markets
    WHERE protocol_status = 'pending_bettors'
      AND protocol_version IN ('v0.6','v0.7')
      AND deadline > ?
      ${brokerRelayId ? 'AND broker_relay_id = ?' : ''}
    ORDER BY deadline ASC
    LIMIT ?
  `).all(...(brokerRelayId ? [nowUnix, brokerRelayId, limit] : [nowUnix, limit]));
  // Path B: exchange_offers E pre-handshake (= /api/prediction/pending-offer L1490 bettor.js).
  // Bettor r106 Bug A hotfix: 2 null-field offers cause marketLabel render all `?` — exclude via NOT NULL 3-col filter.
  const offers = db.prepare(`
    SELECT id, maker_relay_id, outcome_oracle_relay_ids AS oracle_relay_ids,
           outcome_market_source, outcome_condition_id, outcome_token_id, outcome_side,
           pending_handshake_expires_at AS deadline, give_amount AS maker_stake_amount, 'offer' AS kind
    FROM exchange_offers
    WHERE protocol_status = 'pending_taker'
      AND pending_handshake_expires_at > datetime('now')
      AND outcome_market_source IS NOT NULL
      AND outcome_side IS NOT NULL
      AND outcome_condition_id IS NOT NULL
    ORDER BY pending_handshake_expires_at ASC
    LIMIT ?
  `).all(limit);
  // pool first (主推 broker 经手), then offers, cap to limit.
  return [...pools, ...offers].slice(0, limit);
}

/** Derive x-only pubkey from a kaspa address (= pool_bettor_sides.bettor_pk key, mirrors pool.js L106). */
async function deriveXOnlyPk(address) {
  try {
    const kaspa = await import('kaspa-wasm');
    return kaspa.XOnlyPublicKey.fromAddress(new kaspa.Address(address)).toString();
  } catch { return null; }
}

/**
 * Fetch user's own bets. DUAL-PATH (mirror fetchActiveMarkets):
 *  - Path A (kind='pool'): pool_bettor_sides where bettor_pk = xonly(relay address) — the
 *    register-v06 external path stores bettor_relay_id=null, so bettor_pk is the only link.
 *  - Path B (kind='offer'): exchange_offers where maker_relay_id == user OR taker == user (UNCHANGED).
 *
 * @param {string} senderAddress — user's kaspa addr
 * @param {string} [relayId] — user's relay_node_id (needed for pool path: resolve bettor_pk)
 * @param {string} [baseUrl] — console base for relay address lookup
 */
async function fetchUserBets(senderAddress, relayId, baseUrl = 'http://127.0.0.1:3200') {
  const db = getDb();
  const bets = [];
  // Path A: pool_bettor_sides matched by bettor_pk = xonly(relay address). Best-effort (guarded).
  if (relayId) {
    try {
      const relayRes = await fetch(`${baseUrl}/api/relay/${relayId}`);
      const relayJson = await relayRes.json();
      const addr = relayJson.address || relayJson.relay?.address;
      const pk = addr ? await deriveXOnlyPk(addr) : null;
      if (pk) {
        const poolBets = db.prepare(`
          SELECT pbs.market_id AS id, pbs.direction, pbs.stake_amount AS maker_stake_amount,
                 pbs.side_lock_tx, pbs.claim_txid, pbs.created_at,
                 pm.protocol_status, pm.outcome_market_source, pm.outcome_condition_id,
                 pm.outcome_side, pm.resolution_rule_spec, pm.settle_txid, 'pool' AS kind
          FROM pool_bettor_sides pbs JOIN pool_markets pm ON pm.id = pbs.market_id
          WHERE pbs.bettor_pk = ?
          ORDER BY pbs.created_at DESC LIMIT 10
        `).all(pk);
        for (const b of poolBets) b.outcome_side = b.direction === 0 ? 'YES' : 'NO';
        bets.push(...poolBets);
      }
    } catch { /* best-effort — fall through to offer path */ }
  }
  // Path B: exchange_offers (UNCHANGED).
  const offerBets = relayId
    ? db.prepare(`
        SELECT id, outcome_market_source, outcome_condition_id, outcome_side,
               give_amount AS maker_stake_amount, protocol_status, pending_handshake_expires_at AS deadline, created_at, 'offer' AS kind
        FROM exchange_offers WHERE maker_relay_id = ? OR taker = ?
        ORDER BY created_at DESC LIMIT 10
      `).all(relayId, senderAddress)
    : db.prepare(`
        SELECT id, outcome_market_source, outcome_condition_id, outcome_side,
               give_amount AS maker_stake_amount, protocol_status, pending_handshake_expires_at AS deadline, created_at, 'offer' AS kind
        FROM exchange_offers WHERE taker = ?
        ORDER BY created_at DESC LIMIT 10
      `).all(senderAddress);
  bets.push(...offerBets);
  return bets;
}

/** Compose human-readable market name. Pool markets carry a structured spec title; offers use outcome cols. */
function marketLabel(m) {
  if (m.kind === 'pool' && m.resolution_rule_spec) {
    try {
      const spec = typeof m.resolution_rule_spec === 'string' ? JSON.parse(m.resolution_rule_spec) : m.resolution_rule_spec;
      if (spec && spec.title) return String(spec.title).slice(0, 60);
    } catch { /* fall through to outcome cols */ }
  }
  const src = (m.outcome_market_source || '?').slice(0, 12);
  const cond = (m.outcome_condition_id || '?').slice(0, 12);
  const side = m.outcome_side || '?';
  return `${src}/${cond} (${side})`;
}

/** Format a deadline (pool = INTEGER unix ts; offer = TEXT datetime) to a YYYY-MM-DD-ish hint. */
function fmtDeadline(d) {
  if (d == null) return '?';
  if (typeof d === 'number') {
    const ms = d > 1e12 ? d : d * 1000; // sec vs ms heuristic
    try { return new Date(ms).toISOString().slice(0, 10); } catch { return String(d); }
  }
  return String(d).slice(0, 10);
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
      '当前没有可下注的活跃市场。',
      '',
      '想创建? 浏览器开 http://192.168.1.105:3200/predictions/pool/create',
      '回 /help 看完整 menu。',
    ].join('\n');
  }
  const lines = ['活跃市场:'];
  markets.forEach((m, i) => {
    const ddl = fmtDeadline(m.deadline);
    const stake = (m.maker_stake_amount || 0) / 100_000_000; // sompi → KAS
    lines.push(`[${i + 1}] ${marketLabel(m)} (截止 ${ddl}, 创建者押注 ${stake} KAS)`);
  });
  lines.push('', `回 1-${markets.length} 选市场, OR /create /my_bets /help`);
  return lines.join('\n');
}

function renderOutcomeList(market) {
  // Pool markets (committee-judged): bettor freely picks a side (multiple bettors per side).
  if (market.kind === 'pool') {
    return [
      `市场: ${marketLabel(market)}`,
      '',
      '选你押哪边:',
      '[1] YES',
      '[2] NO',
      '',
      '回 1 (YES) 或 2 (NO), OR /cancel',
    ].join('\n');
  }
  // Offer (E pre-handshake P2P): binary, taker takes the OPPOSITE side of maker.
  const makerSide = market.outcome_side || '?';
  const oppSide = makerSide === 'YES' ? 'NO' : (makerSide === 'NO' ? 'YES' : `opposite of ${makerSide}`);
  const lines = [
    `市场: ${marketLabel(market)}`,
    `对家押: ${makerSide}`,
    '',
    '选你的押注:',
    `[1] ${oppSide} (= 跟对家对赌)`,
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
  const confirmLine = ctx.kind === 'pool'
    ? '回 /confirm 确认 (= 锁定押注上链, 等截止后委员会裁决结算)'
    : '回 /confirm 确认 (= 锁定押注上链, 跟对家对赌结算)';
  return [
    '准备下注:',
    `市场: ${ctx.market_label}`,
    `押: ${ctx.outcome_label}`,
    `金额: ${ctx.stake_kas} KAS`,
    '',
    confirmLine,
    '回 /cancel 取消',
  ].join('\n');
}

function renderMyBets(bets) {
  if (!bets.length) return '还没有下注记录. 回 /predict 开始。';
  const lines = ['我的下注:'];
  bets.forEach((b, i) => {
    const ts = (b.created_at || '').slice(0, 16);
    const stake = (b.maker_stake_amount || 0) / 100_000_000;
    const side = b.outcome_side ? ` · ${b.outcome_side}` : '';
    lines.push(`[${i + 1}] ${b.id.slice(0, 12)}...${side} · ${marketLabel(b)} · ${stake} KAS · ${b.protocol_status} · ${ts}`);
  });
  return lines.join('\n');
}

/**
 * Confirm a POOL-market bet via the line-B-proven register-v06 flow (Bettor r728/r730 dual-path):
 *   GET relay address (= linked_addr) → register-v06/prep (side_p2sh + exact stake)
 *   → relay send-command transfer (fund side_p2sh) → wait chain → register-v06/confirm (insert pool_bettor_sides).
 * The relay is the bettor; claim key binds to the relay address (parity w/ taker-stake using taker_relay_id).
 * Does NOT touch signed payloads (= same path my线B e2e cross-check proved).
 */
async function confirmPoolBet(senderAddress, session, relayId, baseUrl) {
  const marketId = session.last_market_id;
  const side = session.last_outcome;            // 'YES' | 'NO'
  const direction = side === 'YES' ? 0 : 1;     // pool: 0=YES, 1=NO (settle winner convention)
  const stakeKas = Number(session.aux.stake);
  if (!marketId || !(stakeKas > 0)) {
    updateSession(senderAddress, STATE.IDLE, { aux: {} });
    return '❌ 下注信息不完整. /predict 重来.';
  }
  try {
    // Step 1: resolve the relay's own kaspa address (= linked_addr, binds claim key to the relay).
    const relayRes = await fetch(`${baseUrl}/api/relay/${relayId}`);
    const relayJson = await relayRes.json();
    const linkedAddr = relayJson.address || relayJson.relay?.address;
    if (!linkedAddr) {
      updateSession(senderAddress, STATE.IDLE, { aux: {} });
      return '❌ 无法解析下注钱包地址. /predict 重来.';
    }
    // Step 2: register-v06/prep → side_p2sh + exact stake.
    const prepRes = await fetch(`${baseUrl}/api/pool/market/${marketId}/bettor/register-v06/prep`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linked_addr: linkedAddr, direction, stake_kas: stakeKas }),
    });
    const prep = await prepRes.json();
    if (!prepRes.ok || !prep.ok) {
      updateSession(senderAddress, STATE.IDLE, { aux: {} });
      return `❌ 下注准备失败: ${prep.error || prepRes.status}. /predict 重来.`;
    }
    // Step 3: fund the side P2SH from the relay wallet (exact stake).
    const trfRes = await fetch(`${baseUrl}/api/relay/${relayId}/send-command`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'transfer', target: prep.side_p2sh, amount: prep.exact_stake_kas }),
    });
    const trf = await trfRes.json();
    if (!trfRes.ok || !trf.ok) {
      updateSession(senderAddress, STATE.IDLE, { aux: {} });
      return `❌ 下注付款失败: ${trf.error || trfRes.status}. /predict 重来.`;
    }
    const payTxid = trf.txid || trf.tx || trf.txId;
    // Step 4: confirm — RPC detects the UTXO + inserts pool_bettor_sides. Chain needs ~12s; retry.
    let cfm = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      await new Promise(r => setTimeout(r, attempt === 0 ? 12000 : 6000));
      const cfmRes = await fetch(`${baseUrl}/api/pool/market/${marketId}/bettor/register-v06/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linked_addr: linkedAddr, direction, stake_kas: stakeKas }),
      });
      cfm = await cfmRes.json();
      if (cfm && cfm.ok && cfm.registered) break;
    }
    if (cfm && cfm.ok && cfm.registered) {
      updateSession(senderAddress, STATE.MATCHED, { aux: { tx: cfm.side_lock_tx || payTxid } });
      // Audit: bet confirmed on-chain — link DM action to the real side_lock_tx (Bettor r787 ④).
      safeEmit({ user_address: senderAddress, market_id: marketId, action_type: 'confirm_bet',
        action_payload: { side, stake_kas: stakeKas, kind: 'pool' }, dispatch_txid: cfm.side_lock_tx || payTxid });
      return [
        '🎯 下注成功 + 已上链!',
        `市场: ${marketId.slice(0, 16)}...`,
        `你押: ${side} · ${stakeKas} KAS`,
        `TX: ${String(cfm.side_lock_tx || payTxid || '?').slice(0, 20)}...`,
        '',
        '等截止后委员会裁决结算. /my_bets 查状态.',
      ].join('\n');
    }
    // Paid but not yet detected on-chain — keep the user informed, don't lose the bet.
    updateSession(senderAddress, STATE.WAITING_TAKER, { aux: { tx: payTxid } });
    return [
      '⏳ 付款已发, 链上确认中.',
      `市场: ${marketId.slice(0, 16)}...`,
      `TX: ${String(payTxid || '?').slice(0, 20)}...`,
      cfm && cfm.note ? `状态: ${cfm.note}` : '',
      '',
      '稍后回 /my_bets 查注册状态.',
    ].filter(Boolean).join('\n');
  } catch (e) {
    return `❌ 下注失败: ${e.message}. /predict 重来.`;
  }
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
    safeEmit({ user_address: senderAddress, action_type: 'my_bets' });
    return renderMyBets(await fetchUserBets(senderAddress, relayId, baseUrl));
  }

  // /predict — enter SELECT_MARKET state
  if (trimmed === MENU.PREDICT) {
    const markets = fetchActiveMarkets();
    safeEmit({ user_address: senderAddress, action_type: 'predict_browse', action_payload: { market_count: markets.length } });
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
        '⚠ 下注需要钱包上下文 (relay)。',
        `当前已选: 市场=${session.last_market_id || '?'}, 押=${session.last_outcome || '?'}, 金额=${session.aux.stake || '?'} KAS`,
        '',
        '请稍后重试 OR 浏览器自行下注。',
      ].join('\n');
    }

    // Route by market kind (Bettor r728/r730 dual-path): pool → register-v06; offer → taker-stake.
    const confirmKind = session.aux.kind || 'offer';
    if (confirmKind === 'pool') {
      return await confirmPoolBet(senderAddress, session, relayId, baseUrl);
    }

    // ── E pre-handshake (offer) path — UNCHANGED (保留 pre-handshake, Bettor caveat) ──
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
      // Audit: offer (E pre-handshake) bet matched — link to escrow stake TX (Bettor r787 ④).
      safeEmit({ user_address: senderAddress, market_id: session.last_market_id, action_type: 'confirm_bet',
        action_payload: { side: session.last_outcome, stake_kas: session.aux.stake, kind: 'offer' }, dispatch_txid: stakeJson.txid || stakeJson.tx });
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
      // Persist market kind in aux (= pool|offer) so SELECT_OUTCOME/CONFIRM_STAKE/confirm route correctly.
      updateSession(senderAddress, STATE.SELECT_OUTCOME, { last_market_id: market.id, aux: { kind: market.kind } });
      safeEmit({ user_address: senderAddress, market_id: market.id, action_type: 'select_market', action_payload: { kind: market.kind } });
      return renderOutcomeList(market);
    }

    if (session.state === STATE.SELECT_OUTCOME) {
      const kind = session.aux.kind || 'offer';
      if (kind === 'pool') {
        // Pool market: bettor freely picks YES (1) or NO (2).
        const market = db.prepare(`SELECT * FROM pool_markets WHERE id = ?`).get(session.last_market_id);
        if (!market) return '市场已结束 OR 失效. 回 /predict 刷新.';
        if (num !== 1 && num !== 2) return '无效选项. 回 1 (YES) 或 2 (NO), OR /cancel.';
        const side = num === 1 ? 'YES' : 'NO';
        updateSession(senderAddress, STATE.CONFIRM_STAKE, { last_outcome: side });
        market.kind = 'pool';
        return renderStakeOptions(market, num - 1);
      }
      // Offer (E pre-handshake) — Bettor r106 Bug B hotfix: sweep to exchange_offers. UNCHANGED.
      const market = db.prepare(`SELECT * FROM exchange_offers WHERE id = ?`).get(session.last_market_id);
      if (!market) return '订单已 closed OR 失效. 回 /predict 刷新.';
      // Binary outcome: only 1 valid choice (= opposite of maker)
      if (num !== 1) return '无效选项. 回 1 确认对赌, OR /cancel.';
      const makerSide = market.outcome_side || '?';
      const oppSide = makerSide === 'YES' ? 'NO' : (makerSide === 'NO' ? 'YES' : `opposite of ${makerSide}`);
      updateSession(senderAddress, STATE.CONFIRM_STAKE, { last_outcome: oppSide });
      market.kind = 'offer';
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
      const kind = session.aux.kind || 'offer';
      const market = kind === 'pool'
        ? db.prepare(`SELECT * FROM pool_markets WHERE id = ?`).get(session.last_market_id)
        : db.prepare(`SELECT * FROM exchange_offers WHERE id = ?`).get(session.last_market_id);
      if (market) market.kind = kind;
      return renderConfirmation({
        market_label: market ? marketLabel(market) : session.last_market_id,
        outcome_label: session.last_outcome,
        stake_kas: stakeKas,
        kind,
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
