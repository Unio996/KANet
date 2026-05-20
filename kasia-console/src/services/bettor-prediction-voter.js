// Phase 3a r211 O-6 — prediction oracle voter daemon (Bettor r211 v3 consensus + J1 #318 PB-B/C/F)
//
// Bettor r211 v3 oracle 设计:
//   - Path D: maker 自选 oracle as P2P primitive (= oracle 是 first-class KANet user role)
//   - 5 J1tn-* (testnet Phase 3a) all is_oracle=1, oracle_capabilities=["kanet_ai_consensus_v1"]
//   - 3-of-5 multi-sig SS escrow (= PredictionEscrowMulti.sil, .109 compile/deploy)
//
// J1 #318 PB consensus:
//   - PB-B: kanet_oracle_vote_v1 JSON schema + evidence_hash (= sha256 of fetched evidence)
//   - PB-C: 1-to-1 DM vote (= 不上链 broadcast, 5x fee 省)
//   - PB-D: maker_relay 是 aggregator trigger (= 收 3+ vote → build settleByMultiOracle TX)
//   - PB-F: 1 daemon 跑多 voter loop (= 复用 settler pattern, 不 fork 新 process)
//
// 5min cron 复用 settler pattern. 每 tick:
//   1. SELECT all is_oracle=1 relays on this host
//   2. For each oracle relay: scan exchange_offers WHERE outcome_oracle_relay_id = this AND state IN ('matched','verifying') AND end_date 过
//   3. For each offer: check already voted (chain_events) → if not, vote (Polymarket gamma OR LLM) → DM maker_relay
//   4. evidence_hash = sha256 of fetched evidence (= audit trail)
//
// Phase 3a 限制 (= single .106 host MVP):
//   - 5 J1tn-* 同 host 决策 (= compromise risk public disclaim, demo cap 100 KAS)
//   - 5 voter 全 Qwen3.6-LAN adapter (= same brain identity, Phase 3b 加 diversity)
//   - Voter 0 stake economic (= testnet KAS slash 0 real cost)
//   - 仅 polymarket_uma_mirror capability (= kanet_ai_consensus_v1 占位, 后续 LLM 真接入)

import { sqlite } from '../db/client.js';
import { createHash, randomUUID } from 'node:crypto';
import { sendCommandAsync } from './relay-manager.js';

const TICK_INTERVAL_MS = 5 * 60 * 1000;  // 5 min, 跟 settler 同
const STARTUP_GRACE_MS = 45 * 1000;        // 45s grace (= settler 30s + 15s 错峰)

let timer = null;
let running = false;

export function startPredictionVoterCron() {
  if (timer) return;
  console.log('[prediction-voter] started — 5min cron, scan is_oracle=1 relays + vote offers (Phase 3a r211 v3)');
  setTimeout(() => {
    voterTick().catch(e => console.error('[prediction-voter] startup tick:', e.message));
  }, STARTUP_GRACE_MS);
  timer = setInterval(() => {
    voterTick().catch(e => console.error('[prediction-voter] tick:', e.message));
  }, TICK_INTERVAL_MS);
}

export function stopPredictionVoterCron() {
  if (timer) { clearInterval(timer); timer = null; }
}

export async function voterTick() {
  if (running) { return { skipped: true }; }
  running = true;
  try {
    // 1. 找 host-local 所有 is_oracle=1 voter relay
    const voterRelays = sqlite.prepare(`
      SELECT id, name, address, oracle_capabilities
      FROM relay_nodes WHERE is_oracle = 1
    `).all();
    if (!voterRelays.length) return { ok: true, voters: 0 };

    let totalVoted = 0, totalSkipped = 0, totalErrored = 0;
    for (const voter of voterRelays) {
      const r = await processVoter(voter);
      totalVoted += r.voted;
      totalSkipped += r.skipped;
      totalErrored += r.errored;
    }
    console.log(`[prediction-voter] tick: ${voterRelays.length} voter relays, voted=${totalVoted} skipped=${totalSkipped} errored=${totalErrored}`);
    return { ok: true, voters: voterRelays.length, voted: totalVoted, skipped: totalSkipped, errored: totalErrored };
  } finally {
    running = false;
  }
}

async function processVoter(voter) {
  let voted = 0, skipped = 0, errored = 0;
  // 2. scan offers this voter 该投票
  const offers = sqlite.prepare(`
    SELECT id, maker, maker_kaspa_addr, outcome_oracle_relay_id, outcome_token_id, outcome_condition_id, outcome_side, outcome_end_date, resolution_rule_spec, protocol_status
    FROM exchange_offers
    WHERE outcome_oracle_relay_id = ?
      AND protocol_status IN ('matched','verifying')
      AND outcome_end_date IS NOT NULL
      AND datetime(outcome_end_date) <= datetime('now')
  `).all(voter.id);
  if (!offers.length) return { voted, skipped, errored };

  for (const offer of offers) {
    try {
      // 3. 检 already voted (= chain_events 查 same voter + offer)
      const existingVote = sqlite.prepare(`
        SELECT id FROM chain_events
        WHERE event_type = 'oracle_vote' AND from_address = ? AND payload LIKE ?
        LIMIT 1
      `).get(voter.address, `%"offer_id":"${offer.id}"%`);
      if (existingVote) { skipped++; continue; }

      // 4. fetch evidence + decide outcome (= Phase 3a MVP: polymarket gamma resolve)
      const voteResult = await deriveVote(offer);
      if (!voteResult.ok) { errored++; continue; }

      // 5. build kanet_oracle_vote_v1 JSON (= PB-B schema)
      const evidenceHash = createHash('sha256').update(voteResult.evidence_raw || '').digest('hex');
      const votePayload = {
        t: 'kanet_oracle_vote_v1',
        offer_id: offer.id,
        voter_relay_id: voter.id,
        voter_pubkey: voter.address,  // Phase 3a Phase 4 真 derive x-only pubkey
        outcome: voteResult.outcome,  // 'YES' | 'NO' | 'DISPUTE'
        evidence_url: voteResult.evidence_url || null,
        evidence_hash: evidenceHash,
        vote_timestamp: new Date().toISOString(),
        signature: 'phase3a_skeleton',  // Phase 4 真 sign by voter privkey
      };

      // 6. send DM to maker_relay (= PB-C 1-to-1, PB-D aggregator)
      if (!offer.maker_kaspa_addr) { errored++; continue; }
      try {
        await sendCommandAsync(voter.id, {
          type: 'send_message',
          target: offer.maker_kaspa_addr,
          message: JSON.stringify(votePayload),
        });
        voted++;
      } catch (sendErr) {
        console.error(`[prediction-voter] DM fail voter=${voter.name} offer=${offer.id.slice(0,8)}: ${sendErr.message}`);
        errored++;
        continue;
      }

      // 7. log chain_events 'oracle_vote' (= 防 same-tick double-vote + audit trail)
      //
      // Bettor r213 F6 (MEDIUM): synthetic txid risk — Phase 3a MVP 用 'oracle_vote:<voter8>:<offer8>:<ts>'
      // 不是真 chain TX ID. 真 chain audit (= kaspad block index cross-check) 此 row 必 missing.
      // KI sediment 第 14/15 次 (5/18 N4): chain_event txid 截断撞 UNIQUE silent ignore.
      // 现 collision risk 低 (voter8 differs 同 tick + Date.now() 毫秒 + slice 8 char), 但真链 audit 时全 fail.
      //
      // Phase 4 升级: voter daemon 真 broadcast on-chain (= kanet_oracle_vote_v1 protocol msg).
      // 现 1-to-1 DM (PB-C) 不上链 (= 5x fee 省), chain_events row 是 local audit log not chain truth.
      // 当 真上链时 backfill txid_real col, 当前 synthetic_txid pattern 保留.
      const syntheticTxid = `oracle_vote:${voter.id.slice(0,8)}:${offer.id.slice(0,8)}:${Date.now()}`;
      sqlite.prepare(`
        INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
        VALUES (?, ?, 'oracle_vote', ?, ?, ?, 'prediction-voter', CURRENT_TIMESTAMP)
      `).run(randomUUID(), syntheticTxid, voter.address, offer.maker_kaspa_addr, JSON.stringify(votePayload));

      console.log(`[prediction-voter] VOTE ${voter.name}: offer=${offer.id.slice(0,8)} outcome=${voteResult.outcome}`);
    } catch (e) {
      console.error(`[prediction-voter] process fail voter=${voter.name} offer=${offer.id?.slice(0,8)}: ${e.message}`);
      errored++;
    }
  }
  return { voted, skipped, errored };
}

// deriveVote — Phase 3a MVP dispatcher per Bettor r219 spec.
//   1) Polymarket gamma (= polymarket.com source) — direct resolved price check
//   2) kanet_native (= any other data_source_canonical URL) — fetch + LLM consensus (Qwen3.6-LAN)
async function deriveVote(offer) {
  // Parse resolution_rule_spec → data_source_canonical (= judge URL)
  let spec = null;
  try { spec = JSON.parse(offer.resolution_rule_spec || '{}'); } catch {}
  const sourceUrl = spec?.data_source_canonical;

  // Branch 1: Polymarket gamma (= legacy path, source URL 含 polymarket.com)
  if (offer.outcome_market_source === 'polymarket' || sourceUrl?.includes('polymarket.com')) {
    return derivePolymarketVote(offer);
  }

  // Branch 2: kanet_native (= Phase 3a MVP Bettor r219 spec — LLM consensus)
  if (offer.outcome_market_source === 'kanet_native') {
    return deriveKanetNativeVote(offer, spec);
  }

  return { ok: false, reason: `unsupported outcome_market_source: ${offer.outcome_market_source}` };
}

async function derivePolymarketVote(offer) {
  if (!offer.outcome_token_id) {
    return { ok: false, reason: 'missing outcome_token_id' };
  }
  try {
    const url = `https://gamma-api.polymarket.com/markets?clob_token_ids=${encodeURIComponent(offer.outcome_token_id)}&closed=true`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { ok: false, reason: `gamma HTTP ${res.status}` };
    const arr = await res.json();
    const m = (arr || [])[0];
    if (!m) return { ok: false, reason: 'gamma market not found' };
    const evidence_raw = JSON.stringify({ outcomePrices: m.outcomePrices, closed: m.closed });
    const op = JSON.parse(m.outcomePrices || '[]');
    const yesPrice = parseFloat(op[0]);
    const noPrice = parseFloat(op[1]);
    if (!Number.isFinite(yesPrice) || !Number.isFinite(noPrice)) {
      return { ok: false, reason: 'outcomePrices not finite' };
    }
    let outcome = 'DISPUTE';
    if (yesPrice === 1 && noPrice === 0) outcome = 'YES';
    else if (yesPrice === 0 && noPrice === 1) outcome = 'NO';
    else return { ok: false, reason: 'gamma not resolved yet' };
    return { ok: true, outcome, evidence_url: url, evidence_raw };
  } catch (e) {
    return { ok: false, reason: `gamma fetch fail: ${e.message}` };
  }
}

// Bettor r219 spec — kanet_native deriveVote (LLM consensus via Qwen3.6-LAN).
//   fetch data_source_canonical URL → text → LLM prompt → JSON {outcome, confidence}
//   confidence < 0.6 → DISPUTE (= 低信置不强 YES/NO)
//   Qwen Rule 11: enable_thinking=false 必加 (= 漏会 60-120s timeout)
async function deriveKanetNativeVote(offer, spec) {
  const url = spec?.data_source_canonical;
  if (!url || typeof url !== 'string') {
    return { ok: false, reason: 'kanet_native missing data_source_canonical URL in resolution_rule_spec' };
  }

  // Phase 3a MVP: 若 URL 不是 http(s) (= 是 free-text 描述 like "Phase 3a真 round-trip 测试"),
  // skip fetch + LLM 用 spec 全文 + market metadata 推 outcome.
  let evidence_text = '';
  let evidence_url = url;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return { ok: false, reason: `kanet_native source HTTP ${res.status}` };
      evidence_text = (await res.text()).slice(0, 2000);  // 上限防 prompt context 撑爆
    } catch (e) {
      return { ok: false, reason: `kanet_native fetch fail: ${e.message}` };
    }
  } else {
    // free-text description path — 用 spec 5 字段 作 evidence
    evidence_text = JSON.stringify(spec);
    evidence_url = `kanet_native_spec:${offer.id}`;
  }

  // LLM call (= Bettor r219 spec). Qwen3.6-LAN via Adapter.
  const adapterPort = process.env.QWEN_ADAPTER_PORT || '3210';
  const prompt = `预测市场结果判定:\n` +
    `market_question: ${offer.outcome_condition_id || '(none)'}\n` +
    `data_source: ${evidence_url}\n` +
    `evidence: ${evidence_text}\n` +
    `判定: 此市场结果是 YES 还是 NO? 只 JSON 回 {"outcome": "YES"|"NO"|"DISPUTE", "confidence": 0-1, "reason": "..."}`;
  let llmOutcome = 'DISPUTE';
  let llmConfidence = 0;
  let llmReason = '';
  try {
    const llmRes = await fetch(`http://127.0.0.1:${adapterPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        chat_template_kwargs: { enable_thinking: false },  // Qwen Rule 11 必加
        response_format: { type: 'json_object' },
        temperature: 0.1,
      }),
    });
    if (!llmRes.ok) return { ok: false, reason: `LLM HTTP ${llmRes.status}` };
    const llmJson = await llmRes.json();
    const content = llmJson?.choices?.[0]?.message?.content || '{}';
    let parsed;
    try { parsed = JSON.parse(content); } catch { parsed = {}; }
    llmOutcome = parsed.outcome === 'YES' || parsed.outcome === 'NO' ? parsed.outcome : 'DISPUTE';
    llmConfidence = parseFloat(parsed.confidence) || 0;
    llmReason = String(parsed.reason || '').slice(0, 200);
  } catch (e) {
    return { ok: false, reason: `LLM fetch fail: ${e.message}` };
  }

  // 低信置 → DISPUTE fallback (= 防误判)
  const finalOutcome = llmConfidence < 0.6 ? 'DISPUTE' : llmOutcome;
  return {
    ok: true,
    outcome: finalOutcome,
    evidence_url,
    evidence_raw: JSON.stringify({ evidence_text: evidence_text.slice(0, 500), llm_confidence: llmConfidence, llm_reason: llmReason }),
  };
}
