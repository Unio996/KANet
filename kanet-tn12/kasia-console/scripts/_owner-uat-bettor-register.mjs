// Owner UAT 3 — bettor registers + locks stake (Owner acts as a bettor).
//
// Usage:
//   node scripts/_owner-uat-bettor-register.mjs <market_id> <side YES|NO> <stake_kas> [bettor_slot]
//
// Example:
//   node scripts/_owner-uat-bettor-register.mjs ext-pool-1779... YES 2
//   node scripts/_owner-uat-bettor-register.mjs ext-pool-1779... NO 2 2
//
// bettor_slot: 1 = pred-taker (default), 2 = pred-maker#2. Use different slots for 2 bettors.
// side: YES = direction 0, NO = direction 1.
// Output: side_p2sh + on-chain side lock TX hash.

const CONSOLE = process.env.UAT_CONSOLE_URL || 'http://127.0.0.1:3300';

const BETTOR_RELAYS = {
  '1': { id: 'a6fc6811-93a5-4af6-a258-b7d8f2936405', name: 'pred-taker' },
  '2': { id: '73a48b54-6fe0-4bc2-9b4d-7749d671d803', name: 'pred-maker#2' },
};

const [marketId, sideRaw, stakeKasRaw, bettorSlotRaw] = process.argv.slice(2);
if (!marketId || !sideRaw || !stakeKasRaw) {
  console.error('Usage: node scripts/_owner-uat-bettor-register.mjs <market_id> <side YES|NO> <stake_kas> [bettor_slot 1|2]');
  console.error('Example: node scripts/_owner-uat-bettor-register.mjs ext-pool-1779... YES 2');
  process.exit(1);
}
const side = sideRaw.toUpperCase();
if (side !== 'YES' && side !== 'NO') {
  console.error(`side must be YES or NO (got ${sideRaw})`);
  process.exit(1);
}
const direction = side === 'YES' ? 0 : 1;
const stakeKas = parseFloat(stakeKasRaw);
if (!Number.isFinite(stakeKas) || stakeKas <= 0) {
  console.error(`stake_kas must be a positive number (got ${stakeKasRaw})`);
  process.exit(1);
}
const bettorSlot = bettorSlotRaw || '1';
const bettor = BETTOR_RELAYS[bettorSlot];
if (!bettor) {
  console.error(`bettor_slot must be 1 or 2 (got ${bettorSlotRaw})`);
  process.exit(1);
}

console.log(`[UAT bettor-register] market: ${marketId}`);
console.log(`[UAT bettor-register] bettor: ${bettor.name} (slot ${bettorSlot})`);
console.log(`[UAT bettor-register] side: ${side} (direction ${direction}), stake: ${stakeKas} KAS`);
console.log(`[UAT bettor-register] submitting...`);

const res = await fetch(`${CONSOLE}/api/pool/market/${marketId}/bettor/register`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ bettor_relay_id: bettor.id, direction, stake_kas: String(stakeKas) }),
});
const j = await res.json();
if (!j.ok) {
  console.error(`[UAT bettor-register] FAILED: ${j.error}`);
  process.exit(1);
}
console.log('');
console.log('=== BETTOR REGISTERED ===');
console.log(`  bettor:        ${bettor.name}`);
console.log(`  side:          ${side}`);
console.log(`  side_p2sh:     ${j.side_p2sh}`);
console.log(`  side_lock_tx:  ${j.side_lock_tx}`);
console.log(`  explorer:      https://explorer-tn12.kaspa.org/txs/${j.side_lock_tx}`);
console.log(`  merkle_index:  ${j.merkle_index}`);
console.log('');
console.log('NEXT: register more bettors, OR wait for deadline + oracles vote. Vote runs:');
console.log(`  node scripts/_owner-uat-vote.mjs ${marketId} 1 YES`);
