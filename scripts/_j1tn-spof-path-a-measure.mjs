// Measure SPOF Path A canonical payload size + propose compression
// per offer in our e2e fire. Run vs testnet DB.

import { createRequire } from 'node:module';
const require = createRequire('file:///D:/kanet-testnet/kasia-console/');
const Database = require('better-sqlite3');

const DB = process.env.KANET_DB_PATH || 'D:/kanet-testnet/kasia-console/data/console.db';
const OFFER_ID = 'ext-pred-1779931503151-ty096';

const db = new Database(DB, { readonly: true });

const offer = db.prepare(`
  SELECT id, escrow_p2sh, maker_kaspa_addr, taker, pending_taker_pubkey,
         outcome_oracle_relay_ids, metadata
  FROM exchange_offers WHERE id = ?
`).get(OFFER_ID);

if (!offer) { console.error('offer not found'); process.exit(1); }

const meta = JSON.parse(offer.metadata || '{}');
const oracleIds = JSON.parse(offer.outcome_oracle_relay_ids || '[]');

// Resolve oracle addresses + relay_ids (current Path A shape)
const oraclePksCurrent = oracleIds.map(rid => {
  const r = db.prepare(`SELECT address FROM relay_nodes WHERE id = ?`).get(rid);
  return { relay_id: rid, address: r?.address };
});

// Derive hex pubkeys (proposed compression)
const kaspaWasmPath = 'file:///D:/kanet-testnet/kasia-console/node_modules/kaspa-wasm/kaspa.js';
const { XOnlyPublicKey, Address } = await import(kaspaWasmPath);
const oraclePksHex = oraclePksCurrent.map(o => {
  try { return XOnlyPublicKey.fromAddress(new Address(o.address)).toString(); }
  catch { return null; }
}).filter(Boolean);

const ctorParamsCurrent = {
  offer_id: offer.id,
  p2sh_addr: offer.escrow_p2sh,
  maker_pk: meta.maker_pk,
  taker_pk: meta.taker_pk || offer.pending_taker_pubkey,
  broker_pk: meta.broker_pk,
  oracle_pks: oraclePksCurrent,                   // [{relay_id, address}, ...5]
  deadline: meta.deadline_seconds,
  miner_fee_sompi: parseInt(meta.miner_fee_sompi) || 1_000_000,
  broker_fee_pct: parseInt(meta.broker_fee_pct) || 100,
  oracle_fee_pct: parseInt(meta.oracle_fee_pct) || 100,
  maker_stake_sompi: parseInt(meta.maker_stake_sompi) || 0,
  taker_stake_sompi: parseInt(meta.taker_stake_sompi) || 0,
  market_metadata_hash: meta.market_metadata_hash,
  protocol_version: meta.protocol_version || 'v0.3-full',
};

const ctorParamsCompressed = {
  ...ctorParamsCurrent,
  oracle_pks: oraclePksHex,                       // just hex strings
};

// Full Path A payload (= what gets JSON.stringify'd + broadcast)
const payloadCurrent = {
  t: 'kanet_prediction_params_v1',
  offer_id: offer.id,
  p2sh_addr: offer.escrow_p2sh,
  ctor_params: ctorParamsCurrent,
  params_hash: 'a'.repeat(64),    // 32-byte sha256 hex
  maker_sig: 'b'.repeat(130),     // typical ECDSA sig hex 65 bytes
  taker_sig: 'c'.repeat(130),
};
const payloadCompressed = {
  ...payloadCurrent,
  ctor_params: ctorParamsCompressed,
};

// Hash-anchor proposal (D): payload carries only hash + small metadata,
// full params come via DM-only. Recovery: hash from chain → fetch from DM.
const payloadHashAnchor = {
  t: 'kanet_prediction_params_v1_anchor',
  offer_id: offer.id,
  p2sh_addr: offer.escrow_p2sh,
  params_hash: payloadCurrent.params_hash,        // canonical truth, immutable
  maker_sig: payloadCurrent.maker_sig,
  taker_sig: payloadCurrent.taker_sig,
};

const lenCurrent = JSON.stringify(payloadCurrent).length;
const lenCompressed = JSON.stringify(payloadCompressed).length;
const lenAnchor = JSON.stringify(payloadHashAnchor).length;

console.log('═══ Path A payload size measurement ═══');
console.log('offer_id:', OFFER_ID);
console.log('');
console.log('Current shape (oracle_pks = [{relay_id, address}]):');
console.log('  payload JSON chars:', lenCurrent);
console.log('  oracle_pks fraction:', JSON.stringify(oraclePksCurrent).length, 'B');
console.log('');
console.log('Compressed (oracle_pks = [hex_pubkey, ...]):');
console.log('  payload JSON chars:', lenCompressed);
console.log('  oracle_pks fraction:', JSON.stringify(oraclePksHex).length, 'B');
console.log('  reduction:', ((1 - lenCompressed / lenCurrent) * 100).toFixed(1) + '%');
console.log('');
console.log('Hash-anchor (chain carries hash + sigs only, full via DM):');
console.log('  payload JSON chars:', lenAnchor);
console.log('  reduction:', ((1 - lenAnchor / lenCurrent) * 100).toFixed(1) + '%');
console.log('');
console.log('Observed truncate fallback failures: 1635 → 1474 → 1329 (all fail).');
console.log('Kaspa storage mass cap on broadcast self-send ≈ < 1329 chars after UTXO aggregation.');

db.close();
