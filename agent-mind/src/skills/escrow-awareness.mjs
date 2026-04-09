/**
 * Skill: Escrow Awareness — 链上合约感知 + 确认/争议决策
 *
 * Gives the agent visibility into active P2SH escrow contracts:
 *   - Locked escrows (funds held in contract)
 *   - Pending escrows (created but not yet locked)
 *   - Offers awaiting manual confirmation
 *
 * Enables two ACTION types:
 *   [ACTION:CONFIRM_ESCROW offer_id=xxx]  — release funds after trade completion
 *   [ACTION:DISPUTE_ESCROW offer_id=xxx reason=xxx]  — flag fraud/non-delivery
 */

import { Skill } from './base.mjs';
import { fetchJson } from '../utils.mjs';

export class EscrowAwarenessSkill extends Skill {
  constructor() {
    super('escrow_awareness', 'Escrow contract awareness — locked funds, confirmations, disputes');
  }

  canActivate(taskType) {
    return true; // reactive + proactive both need escrow visibility
  }

  async gatherContext(kernels, config) {
    const { consoleUrl, relayNodeId, address } = config;

    const [locked, created, awaiting] = await Promise.all([
      fetchJson(`${consoleUrl}/api/escrow/list?relayNodeId=${relayNodeId}&status=locked`).catch(() => ({ escrows: [] })),
      fetchJson(`${consoleUrl}/api/escrow/list?relayNodeId=${relayNodeId}&status=created`).catch(() => ({ escrows: [] })),
      fetchJson(`${consoleUrl}/api/exchange/offers?status=awaiting_manual_confirm`).catch(() => ({ offers: [] })),
    ]);

    // Filter awaiting offers to only those where this agent is maker or taker
    const myAwaiting = (awaiting.offers || awaiting || []).filter(o =>
      o.maker === address || o.taker === address
    );

    return {
      locked: locked.escrows || [],
      created: created.escrows || [],
      awaiting: myAwaiting,
    };
  }

  formatForBrain(gathered) {
    const { locked, created, awaiting } = gathered;
    const hasData = locked.length || created.length || awaiting.length;
    if (!hasData) return null; // no escrow activity — don't inject

    const lines = [];

    if (locked.length) {
      lines.push(`LOCKED ESCROWS (${locked.length}):`);
      for (const e of locked) {
        const kas = Number(e.amount_sompi || 0) / 1e8;
        const dl = e.deadline ? ` | deadline DAA: ${e.deadline}` : '';
        const offer = e.offer_id ? e.offer_id.slice(0, 8) : 'no-offer';
        lines.push(`  [${e.id.slice(0, 8)}] ${kas} KAS → offer: ${offer}${dl}`);
        if (e.offer_id) {
          lines.push(`    → [ACTION:CONFIRM_ESCROW offer_id=${e.offer_id}] to release funds`);
          lines.push(`    → [ACTION:DISPUTE_ESCROW offer_id=${e.offer_id} reason=...] if fraud`);
        }
      }
    }

    if (created.length) {
      lines.push(`PENDING LOCK (${created.length}):`);
      for (const e of created) {
        const kas = Number(e.amount_sompi || 0) / 1e8;
        lines.push(`  [${e.id.slice(0, 8)}] ${kas} KAS — awaiting lock`);
      }
    }

    if (awaiting.length) {
      lines.push(`AWAITING YOUR CONFIRMATION (${awaiting.length}):`);
      for (const o of awaiting) {
        const label = `${o.give_asset || '?'} → ${o.want_asset || '?'}`;
        lines.push(`  offer ${o.id.slice(0, 8)} — ${label}`);
        lines.push(`    → [ACTION:CONFIRM_ESCROW offer_id=${o.id}] to confirm delivery`);
      }
    }

    return {
      name: this.name,
      description: this.description,
      data: gathered,
      instructions: [
        '--- ESCROW CONTRACTS ---',
        ...lines,
        '',
        'ESCROW RULES:',
        '1. CONFIRM_ESCROW only after verifying the trade was completed satisfactorily.',
        '2. DISPUTE_ESCROW only if peer has not responded in 24h AND you sent at least 2 follow-ups.',
        '3. Never reveal redeem_script_hex or P2SH address details to non-participants.',
        '4. Do not confirm or dispute escrows for offers you are not a party to.',
      ].join('\n'),
    };
  }
}
