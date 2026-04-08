import { sqlite } from '../../db/client.js';
import { nowIso } from '../../lib/time.js';
import { registerDiscoveredAddress } from './discovery.js';

/**
 * Process a detected Agent Card and update the identity record.
 * Called when Scout reports a kanet:v1:card: transaction.
 *
 * @param {{ network: string, address: string, txHash: string, cardData: object, relayNodeId?: string }} params
 * @returns {{ identityId: string, isNew: boolean, updated: boolean }}
 */
export function processAgentCard({ network = 'mainnet', address, txHash, cardData, relayNodeId = null }) {
  const now = nowIso();

  // Step 1: Ensure the address exists in identities (via existing discovery flow)
  const reg = registerDiscoveredAddress({
    network,
    address,
    sourceProtocol: 'kanet',
    txHash,
    relayNodeId,
  });

  const identityId = reg.id;

  // Step 2: Check if this card is newer than what we already have
  const existing = sqlite.prepare(
    'SELECT card_timestamp, card_root_tx FROM identities WHERE id = ?'
  ).get(identityId);

  if (existing.card_timestamp && cardData.timestamp <= existing.card_timestamp) {
    return { identityId, isNew: false, updated: false };
  }

  // Step 3: Determine root_tx
  // If card declares root_tx, use it. If it's a root card (null), use this txHash.
  // If we already have a root_tx and this card doesn't declare one, keep existing.
  let cardRootTx;
  if (cardData.root_tx) {
    cardRootTx = cardData.root_tx;
  } else if (!existing.card_root_tx) {
    cardRootTx = txHash; // This is the root card
  } else {
    cardRootTx = existing.card_root_tx;
  }

  // Step 4: Update identity with card data
  sqlite.prepare(`
    UPDATE identities SET
      identity_type = 'kanet_agent',
      discovery_status = 'identified',
      display_name = COALESCE(?, display_name),
      card_version = ?,
      card_mode = ?,
      card_root_tx = ?,
      card_parent_tx = ?,
      card_latest_tx = ?,
      card_entity_type = ?,
      card_skills_json = ?,
      card_summary = ?,
      card_timestamp = ?,
      card_has_ext = ?,
      card_raw_json = ?,
      confidence_score = CASE WHEN ? > confidence_score THEN ? ELSE confidence_score END,
      updated_at = ?
    WHERE id = ?
  `).run(
    cardData.name || null,
    cardData.version,
    cardData.mode,
    cardRootTx,
    cardData.parent_tx || null,
    txHash,
    cardData.entity_type,
    cardData.skills ? JSON.stringify(cardData.skills) : null,
    cardData.summary || null,
    cardData.timestamp,
    cardData._ext ? 1 : 0,
    JSON.stringify(cardData),
    0.8, 0.8, // Card declaration = high confidence
    now,
    identityId,
  );

  // 收到 Agent Card → 升级 classification（只从 seen_candidate 升）
  sqlite.prepare(`
    UPDATE relation_states SET classification = 'declared_candidate'
    WHERE peer_address = ? AND classification = 'seen_candidate'
  `).run(address);

  return { identityId, isNew: reg.isNew, updated: true };
}
