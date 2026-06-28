// broker-fee-emit.mjs — broker_fee_landed chain_event emitter (J2, 2026-06-28).
//
// Owner 主线: broker 佣金到账 DM 推送。consumer 侧 = tg-bot poller notifyLine 'broker_fee_landed' (KANet-UI d1f68dd1)。
// 本模块 = emit 侧。设计档: docs/2026-06-28-broker-fee-landed-emit-pass-spec.md。
//
// 诚实口径铁律 (Bettor 不超卖): DM 只在【链上 LANDED fee】触发·金额从 kaspa_tx_log.outputs_json 取·**禁 DB 估算**。
//   ∴ emit 不在 settle-submit 点 (那时 settle TX 刚提交·kaspa_tx_log 没 index) — 而是独立 post-index pass:
//   等 settle TX 进 kaspa_tx_log 再从 outputs_json 按 broker 地址取真金额 emit (镜像 path-b reconcile)。
//
// 幂等: pool_markets.metadata.broker_fee_landed_emitted_at 标记 (一盘一次·防重复 DM)。
// backfill-suppress (Bettor 采纳): 首次运行把【现存】completed 盘标记已 emit (不 emit DM)·只 deploy 后【新】settle
//   推 DM (历史佣金走 /earnings 汇总)。restart-safe: 一次性 backfill 由 sentinel chain_event 'broker_fee_emit_backfill' 守。
//
// DI 设计 (offline 可测): db + deriveBrokerAddress 注入·test 用 temp DB + stub deriver。

// ⚠ event_type 必【不以 'broker_' 开头】: migrate v83 trigger chain_events_txid_format_check 对 broker_* 事件
//   强制 txid=64-hex chain hash (禁 placeholder)。sentinel 是内部标记无真 txid → 用非 broker_ 前缀绕开 trigger。
const SENTINEL_EVENT = 'fee_emit_backfill_done';

/**
 * 一次性 backfill-suppress: 把现存 completed (broker_pk 非空·无 emit 标记) 盘标记已 emit (不 emit DM)。
 * 由 sentinel chain_event 守 → restart-safe·只跑一次。返回被抑制的盘数。
 */
export function ensureBackfillSuppressed(db) {
  const done = db.prepare(`SELECT 1 FROM chain_events WHERE event_type = '${SENTINEL_EVENT}' LIMIT 1`).get();
  if (done) return 0;
  const ts = new Date().toISOString();
  const res = db.prepare(`
    UPDATE pool_markets
       SET metadata = json_set(COALESCE(metadata, '{}'), '$.broker_fee_landed_emitted_at', ?)
     WHERE protocol_status = 'completed' AND broker_pk IS NOT NULL
       AND json_extract(COALESCE(metadata, '{}'), '$.broker_fee_landed_emitted_at') IS NULL
  `).run('backfill_suppressed:' + ts);
  db.prepare(`
    INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
    VALUES (lower(hex(randomblob(16))), ?, '${SENTINEL_EVENT}', NULL, NULL, ?, 'pool-settler', CURRENT_TIMESTAMP)
  `).run('broker_fee_emit_backfill:' + ts, JSON.stringify({
    suppressed: res.changes, at: ts,
    note: 'backfill-suppress: 现存 completed 盘标记已 emit (无 DM); 只 deploy 后新 settle emit; 历史走 /earnings',
  }));
  return res.changes;
}

/**
 * brokerFeeLandedEmitTick — scan completed markets, emit broker_fee_landed for those whose settle TX has
 *   landed in kaspa_tx_log with a broker fee output. 链验金额·幂等·非 DB 估。
 * @param {object}   db                   better-sqlite3 handle
 * @param {function} deriveBrokerAddress  (brokerPkHex, network) => kaspa address string (XOnlyPublicKey 派生·与 settle 同源)
 * @param {function} [log]                optional logger
 * @returns {{ backfillSuppressed:number, emitted:number, pendingIndex:number, noBrokerOutput:number, scanned:number }}
 */
export function brokerFeeLandedEmitTick(db, deriveBrokerAddress, log = () => {}) {
  const backfillSuppressed = ensureBackfillSuppressed(db);

  // 候选: completed + 有 settle_txid + broker_pk·尚未 emit (无 metadata 标记)。
  const candidates = db.prepare(`
    SELECT id, broker_pk, settle_txid, spine_p2sh, resolution_rule_spec
      FROM pool_markets
     WHERE protocol_status = 'completed'
       AND settle_txid IS NOT NULL
       AND broker_pk IS NOT NULL
       AND json_extract(COALESCE(metadata, '{}'), '$.broker_fee_landed_emitted_at') IS NULL
  `).all();

  let emitted = 0, pendingIndex = 0, noBrokerOutput = 0;
  for (const m of candidates) {
    // settle TX indexed? (NO TX NO STATE: 没 index 就不 emit·下 tick 重试)
    const txRow = db.prepare('SELECT outputs_json FROM kaspa_tx_log WHERE tx_id = ?').get(m.settle_txid);
    if (!txRow || !txRow.outputs_json) { pendingIndex++; continue; }

    let outs;
    try { outs = JSON.parse(txRow.outputs_json); } catch { pendingIndex++; continue; }
    if (!Array.isArray(outs) || !outs.length) { pendingIndex++; continue; }

    const network = String(m.spine_p2sh || '').startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';
    let brokerAddress;
    // 🔴 broker_pk 传【as-stored】(不 lowercase) — 与 settle 路 L1681 `XOnlyPublicKey(market.broker_pk).toAddress`
    //   逐字节同源·保证派生地址 == settle TX broker output 地址 (case-normalize 会与 settle 不一致→漏 output)。
    try { brokerAddress = deriveBrokerAddress(String(m.broker_pk), network); }
    catch (e) { log(`[broker-fee-emit] broker pk→addr fail market=${m.id.slice(0, 12)}: ${e.message}`); noBrokerOutput++; continue; }
    if (!brokerAddress) { noBrokerOutput++; continue; }

    // 按【地址】匹配 broker output (fee 常是次级 output·非 to_address 列 — reference-verify-covenant-multiout-distribution)。
    const idx = outs.findIndex(o => o && o.address === brokerAddress);
    if (idx < 0) {
      // broker fee 没单独 output (=0 / below-floor / 无 broker) — 标记已 emit 防每 tick 重扫·不 emit 幻象。
      markEmitted(db, m.id, { skipped: 'no_broker_output' });
      noBrokerOutput++;
      log(`[broker-fee-emit] market=${m.id.slice(0, 12)} settle_txid=${String(m.settle_txid).slice(0, 12)} 无 broker output (addr=${brokerAddress.slice(0, 16)}) → 标记跳过`);
      continue;
    }

    const feeSompi = Number(outs[idx].amount_sompi || 0);
    if (!Number.isFinite(feeSompi) || feeSompi <= 0) { markEmitted(db, m.id, { skipped: 'zero_fee' }); noBrokerOutput++; continue; }

    let marketTitle = m.id;
    try { const spec = JSON.parse(m.resolution_rule_spec || '{}'); marketTitle = spec.title || spec.question || m.id; } catch {}

    const payload = JSON.stringify({
      t: 'broker_fee_landed',
      market_id: m.id,
      broker_pk: String(m.broker_pk).toLowerCase(),
      broker_address: brokerAddress,
      fee_sompi: feeSompi,                 // 🔴 链验真金额 (kaspa_tx_log.outputs_json)·非 DB 估
      settle_txid: m.settle_txid,
      output_index: idx,
      market_title: marketTitle,
      landed_at: new Date().toISOString(),
    });
    // 🔴 txid = settle_txid (真 64-hex chain hash·满足 v83 trigger broker_* 禁 placeholder + 语义=fee 所在 settle TX)。
    //   UNIQUE(txid,event_type): 每盘 settle_txid 各异 → (settle_txid,'broker_fee_landed') 唯一·INSERT OR IGNORE 防竞态重 emit。
    db.prepare(`
      INSERT OR IGNORE INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
      VALUES (lower(hex(randomblob(16))), ?, 'broker_fee_landed', ?, ?, ?, 'pool-settler', CURRENT_TIMESTAMP)
    `).run(String(m.settle_txid), m.spine_p2sh || null, brokerAddress, payload);
    markEmitted(db, m.id, { emitted_fee_sompi: feeSompi, settle_txid: m.settle_txid });
    emitted++;
    log(`[broker-fee-emit] 💰 market=${m.id.slice(0, 12)} broker fee ${(feeSompi / 1e8).toFixed(4)} KAS LANDED (settle ${String(m.settle_txid).slice(0, 12)} out#${idx}) → broker_fee_landed emit`);
  }

  if (backfillSuppressed || emitted || noBrokerOutput) {
    log(`[broker-fee-emit] tick: backfillSuppressed=${backfillSuppressed} scanned=${candidates.length} emitted=${emitted} pendingIndex=${pendingIndex} noBrokerOutput=${noBrokerOutput}`);
  }
  return { backfillSuppressed, emitted, pendingIndex, noBrokerOutput, scanned: candidates.length };
}

function markEmitted(db, marketId, extra) {
  const stamp = JSON.stringify({ at: new Date().toISOString(), ...extra });
  db.prepare(`
    UPDATE pool_markets
       SET metadata = json_set(COALESCE(metadata, '{}'), '$.broker_fee_landed_emitted_at', ?)
     WHERE id = ?
  `).run(stamp, marketId);
}
