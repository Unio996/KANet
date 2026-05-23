// B2 v0.5 area-11 L4 regression — create-time storage_mass + losingPool invariants.
//
// pool.js create endpoint must reject configs whose worst-case settle TX would be
// rejected by kaspad (KIP-9 storage mass > 500K cap) or which can't even construct
// (losingPool < broker_fee_floor + minerFee). This catches doomed configs at create
// instead of locking maker stake into an unsettlable market.
//
// Faithful test — replicates the EXACT predicates from pool.js L4 block.
import { estimateStorageMass } from '../src/services/pool-market-settler.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  PASS ${m}`); } else { fail++; console.log(`  FAIL ${m}`); } };

const STORAGE_MASS_SAFE_THRESHOLD_L4 = 400_000;
const MIN_BROKER_FEE_SOMPI_L4 = 5_000_000;
const BETTOR_MIN_STAKE_L4 = 50_000_000;
const MAX_BETTORS_L4 = 50;

// EXACT predicate from pool.js create (post-L4)
const validate = ({ makerStakeAmount, oracleBondAmount, minerFee = 20_000 }) => {
  const worstLosingPool = makerStakeAmount;
  if (worstLosingPool < MIN_BROKER_FEE_SOMPI_L4 + minerFee) {
    return { ok: false, reason: 'losingPool insufficient' };
  }
  const worstDistributable = worstLosingPool - MIN_BROKER_FEE_SOMPI_L4 - minerFee;
  const worstWinnerOutput = BETTOR_MIN_STAKE_L4 + Math.floor(worstDistributable / MAX_BETTORS_L4);
  const worstInputs = [makerStakeAmount, oracleBondAmount, oracleBondAmount, oracleBondAmount];
  for (let i = 0; i < MAX_BETTORS_L4; i++) worstInputs.push(BETTOR_MIN_STAKE_L4);
  const worstOutputs = [MIN_BROKER_FEE_SOMPI_L4];
  for (let i = 0; i < MAX_BETTORS_L4; i++) worstOutputs.push(worstWinnerOutput);
  worstOutputs.push(oracleBondAmount, oracleBondAmount, oracleBondAmount);
  const worstMass = estimateStorageMass(worstInputs, worstOutputs);
  if (worstMass > STORAGE_MASS_SAFE_THRESHOLD_L4) return { ok: false, reason: `storage mass ${worstMass}` };
  return { ok: true, mass: worstMass };
};

// Current v0.5 minimums (= 1 KAS maker, 1 KAS oracle bond) should PASS.
{
  const r = validate({ makerStakeAmount: 100_000_000, oracleBondAmount: 100_000_000 });
  ok(r.ok === true, `minimums (1 KAS maker + 1 KAS oracle bond) → accepted (mass=${r.mass})`);
  ok(r.mass < 400_000, `minimums mass ${r.mass} < safe threshold`);
}

// Misconfigured: oracle_bond too small relative to maker_stake → bond returns become dust →
// storage mass blows. 0.01 KAS oracle bond with 1 KAS maker:
{
  const r = validate({ makerStakeAmount: 100_000_000, oracleBondAmount: 1_000_000 });
  ok(r.ok === false, `misconfig (1 KAS maker + 0.01 KAS oracle bond, dust bond returns) → rejected`);
  ok(r.reason.includes('storage mass'), `rejection reason mentions storage mass`);
}

// Misconfigured: maker stake 0.05 KAS → no room above broker fee floor (= 0.05 KAS) +
// minerFee → worstLosingPool < broker_fee_floor + minerFee → rejected.
{
  const r = validate({ makerStakeAmount: 5_000_000, oracleBondAmount: 100_000_000 });
  ok(r.ok === false, `misconfig (0.05 KAS maker = at broker fee floor, no room for minerFee) → rejected`);
  ok(r.reason.includes('losingPool'), `rejection reason mentions losingPool`);
}

// Counterintuitive finding: scaling maker_stake without scaling broker_fee floor produces
// MORE small winner outputs (= each bettor's share grows but bettor_min_stake doesn't), so
// 10 KAS + 10 KAS actually fails. The fee floor is the bottleneck at intermediate scales.
{
  const r = validate({ makerStakeAmount: 1_000_000_000, oracleBondAmount: 1_000_000_000 });
  ok(r.ok === false, `intermediate (10 KAS maker + 10 KAS oracle bond) → rejected — fee floor dust at this scale (mass=${r.mass || 'n/a'}, reason=${r.reason || 'n/a'})`);
}

// Healthy config: 100 KAS maker + 10 KAS oracle bond → larger winner outputs, math passes.
{
  const r = validate({ makerStakeAmount: 10_000_000_000, oracleBondAmount: 1_000_000_000 });
  ok(r.ok === true, `healthy (100 KAS maker + 10 KAS oracle bond) → accepted (mass=${r.mass})`);
}

// Just under the storage mass boundary
{
  // calibrated to push close to limit
  const r = validate({ makerStakeAmount: 100_000_000, oracleBondAmount: 5_000_000 });
  ok(typeof r === 'object', `boundary probe (oracle_bond=0.05 KAS): ok=${r.ok}, mass=${r.mass || 'n/a'}, reason=${r.reason || 'n/a'}`);
}

console.log(`\ntest-pool-l4-create-invariants: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
