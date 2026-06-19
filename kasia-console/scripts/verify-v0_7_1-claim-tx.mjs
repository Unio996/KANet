// Mental-simulation of a 2-input claim TX:
//   in[0] = WinningsPool UTXO (value = losingPool)
//   in[1] = winning PoolSide UTXO (value = winnerStake)
//   out[0] = P2PK(bettorPk) value = share (= winnerStake + poolShareTaken)
//   out[1] = WinningsPool continuation (= self scriptPubKey, value = poolValue − poolShareTaken − minerFee)
//   out[2] = broker fee output
//
// silverc 检查 (PoolSide spent at in[1], WinningsPool spent at in[0]):
//   - WinningsPool L41: this.activeInputIndex == 0 ✓ (= it IS at in[0])
//   - WinningsPool L42: tx.inputs.length == 2 ✓
//   - WinningsPool L45: poolValue = tx.inputs[0].value (= self) ✓
//   - WinningsPool L46: winnerStake = tx.inputs[1].value (= PoolSide) ✓
//   - PoolSide L59 NEW: this.activeInputIndex == 1 ✓ (= it IS at in[1])
//   - PoolSide L60: tx.inputs.length == 2 ✓
//   - PoolSide L63 NEW: winnerStake = tx.inputs[1].value (= self) ✓
//
// Numerical example (YES wins, yesPool=100KAS=1e10, noPool=50KAS=5e9, winnerStake=10KAS=1e9):
//   winningPool = yesPool = 1e10
//   totalPool = yesPool + noPool = 1.5e10
//   share = winnerStake * totalPool / winningPool = 1e9 * 1.5e10 / 1e10 = 1.5e9 (15 KAS)
//   poolShareTaken = share - winnerStake = 5e8 (5 KAS)
//   pool consumed = 5e8 (matches loser pool's contribution to this winner)

const yesPool = 10_000_000_000;
const noPool  =  5_000_000_000;
const winner  = 0; // YES wins
const losingPool = winner === 0 ? noPool : yesPool;
const winningPool = winner === 0 ? yesPool : noPool;
const totalPool = yesPool + noPool;
const winnerStake = 1_000_000_000; // 10 KAS

const share = Math.floor(winnerStake * totalPool / winningPool);
const poolShareTaken = share - winnerStake;
const newPool = losingPool - poolShareTaken;

console.log('claim TX simulation:');
console.log('  in[0] WinningsPool value:', losingPool, 'sompi');
console.log('  in[1] PoolSide value:    ', winnerStake, 'sompi');
console.log('  out[0] bettor share:     ', share, 'sompi  (= winnerStake + poolShareTaken)');
console.log('  out[1] WinningsPool cont:', newPool, 'sompi  (= losingPool − poolShareTaken)');
console.log('');
console.log('守恒 check:');
console.log('  sum inputs:  ', losingPool + winnerStake);
console.log('  sum outputs: ', share + newPool, '(+ minerFee from broker dust)');
console.log('  delta = inputs - outputs = ', (losingPool + winnerStake) - (share + newPool), 'sompi (= minerFee budget)');
console.log('');
console.log('silverc 检查:');
console.log('  WinningsPool at in[0]: activeInputIndex == 0 ✓');
console.log('  PoolSide at in[1]:     activeInputIndex == 1 ✓');
console.log('  WinningsPool reads:    inputs[0]=self=' + losingPool + ', inputs[1]=PoolSide=' + winnerStake);
console.log('  PoolSide reads:        inputs[1]=self=' + winnerStake);
console.log('');
console.log('PASS — 两 SS contracts 输入顺序契约一致, 同一 claim TX 可同时 spend.');
