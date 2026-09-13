// submit-intent-relay.mjs — (c) F2 relay 侧: transfer 带 intent_key 的两阶段 + 进程内幂等 + 同字节重播 (J2 2026-09-13,
// 设计 docs/2026-09-13-j2-no-tx-no-state-two-violations-and-landed-reconciler-design-v0.1.md v0.3 NWT PASS · Bettor 1044)。
//
//   fresh:  sendKaspa({ beforeSubmit }) → 广播前 POST /ingest/submit-intent phase=prepared{txid, bytes}(console 2xx 才广播, fail-closed)
//           → submitTransaction → POST phase=submitted(失败只 warn, IPC 回执带 txId)
//   replay: replayPreparedTransactions(同字节; txid 断言; mempool/landed 已有 ⇒ 不再广播; 输入被花 ⇒ inputs_spent)
//   进程内 Map<intent_key, txId>: 同 key 二次到达 ⇒ 直接回同一 txId, 不再广播(跨进程靠 console 表 + 上面两条)。
import { ingestSubmitIntentPhase } from '../ingest.mjs';
import { replayPreparedTransactions } from './transaction.mjs';

const _done = new Map();   // intent_key → { txId, fee }

export function _intentDoneSize() { return _done.size; }

export async function transferWithIntentRelay({ cmd, sendKaspa, localAddress, log = console.log, replayFn = replayPreparedTransactions, ingestPhase = ingestSubmitIntentPhase }) {
  const key = cmd.intent_key;
  if (!key) return { ok: false, error: 'intent_key required' };
  const prev = _done.get(key);
  if (prev) {
    log(`INTENT ${key} already submitted in this process → ${prev.txId?.slice(0, 12)} (no rebroadcast)`);
    return { ok: true, txId: prev.txId, fee: prev.fee, intent_key: key, reused: true };
  }
  if (cmd.replay_tx_json) {
    if (!cmd.prepared_txid) return { ok: false, code: 'replay_txid_mismatch', error: 'replay requires prepared_txid', intent_key: key };
    let list;
    try {
      list = JSON.parse(cmd.replay_tx_json);
      if (!Array.isArray(list) || !list.length) throw new Error('expected non-empty array');
    } catch (e) {
      return { ok: false, code: 'replay_bad_json', error: `replay_tx_json unparsable: ${e.message}`, intent_key: key };
    }
    const r = await replayFn({ txJsonList: list, expectedTxId: cmd.prepared_txid, senderAddress: localAddress, targetAddress: cmd.target });
    if (r.ok) {
      _done.set(key, { txId: r.txId, fee: null });
      try { await ingestPhase({ intentKey: key, phase: 'submitted', txid: r.txId }); }
      catch (e) { log(`⚠ INTENT ${key} submitted receipt not recorded: ${e.message} (IPC reply still carries txId)`); }
      log(`INTENT ${key} replay ${r.alreadyInMempool ? 'already in mempool' : r.alreadyLanded ? 'already landed' : 'rebroadcast same bytes'} → ${r.txId.slice(0, 12)}`);
    } else {
      log(`INTENT ${key} replay refused: ${r.code} ${r.error}`);
    }
    return { ...r, intent_key: key };
  }
  // fresh send — prepared 回执在广播之前, 失败 = 不广播
  const sent = await sendKaspa({
    to: cmd.target, amount: cmd.amount,
    beforeSubmit: async (prepared) => {
      const last = prepared[prepared.length - 1];
      await ingestPhase({ intentKey: key, phase: 'prepared', txid: last.txid, txJson: JSON.stringify(prepared.map(p => p.txJson)) });
      log(`INTENT ${key} prepared txid ${last.txid.slice(0, 12)} (${prepared.length} tx, bytes persisted at console) → broadcasting`);
    },
  });
  _done.set(key, { txId: sent.txId, fee: sent.fee });
  try { await ingestPhase({ intentKey: key, phase: 'submitted', txid: sent.txId }); }
  catch (e) { log(`⚠ INTENT ${key} submitted receipt not recorded: ${e.message} (IPC reply still carries txId)`); }
  return { ok: true, txId: sent.txId, fee: sent.fee, intent_key: key };
}
