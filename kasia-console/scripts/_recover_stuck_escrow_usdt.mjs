// KI 63 Fix-2 — one-time recovery script for 17 stuck escrow rows.
//
// NWT N19.153/154 + J2 #628/629 convergent: test framework raw SQL UPDATE marked status='refunded'
// without firing transferUsdt → refund_tx NULL → ~$34.35 USDT stuck broker BSC wallet 0xaD12544E...
//
// Modes:
//   node scripts/_recover_stuck_escrow_usdt.mjs           # dry-run (default, no chain TX)
//   node scripts/_recover_stuck_escrow_usdt.mjs --fire    # real fire (5 BSC transfer)
//
// Dry-run output:
//   - list 17 row id + amount_received + user_refund_addr + prepayment_tx
//   - broker BSC USDT balance pre-check (must ≥ sum + gas)
//   - 0 chain TX
//
// Fire mode:
//   - per row: transferUsdt → UPDATE refund_tx → emit chain_event 'manual_refund_recovery'
//   - idempotency WHERE refund_tx IS NULL re-checked per row before transfer

import Database from 'better-sqlite3';
import { ethers } from 'ethers';

const DB_PATH = 'C:/kanet/kasia-console/data/console.db';
const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const FIRE = process.argv.includes('--fire');

(async () => {
  const db = new Database(DB_PATH);

  const stuck = db.prepare(`
    SELECT id, amount_received, user_refund_addr, prepayment_tx, asset, chain, user_kasia_addr, updated_at
    FROM user_escrow_balances
    WHERE status='refunded' AND (refund_tx IS NULL OR refund_tx='')
      AND amount_received IS NOT NULL AND user_refund_addr IS NOT NULL
      AND chain='bnb' AND asset='USDT'
    ORDER BY updated_at ASC
  `).all();

  console.log(`\n=== KI 63 Fix-2 stuck escrow recovery ===`);
  console.log(`Mode: ${FIRE ? '🔥 REAL FIRE' : '🧪 DRY-RUN'}\n`);
  console.log(`Found ${stuck.length} stuck row (status=refunded refund_tx=NULL amount_received SET):\n`);

  let totalUsdt = 0;
  for (const r of stuck) {
    const amt = parseFloat(r.amount_received) || 0;
    totalUsdt += amt;
    console.log(`  ${r.id.slice(0, 8)} | ${amt.toFixed(6)} USDT | ${r.user_refund_addr.slice(0, 14)}...${r.user_refund_addr.slice(-6)} | paytx ${r.prepayment_tx?.slice(0, 14)}... | ${r.updated_at.slice(0, 19)}`);
  }
  console.log(`\nTOTAL stuck: ${totalUsdt.toFixed(6)} USDT across ${stuck.length} row`);

  if (stuck.length === 0) {
    console.log('\nNothing to recover. Exit.');
    db.close();
    return;
  }

  // broker BSC USDT balance pre-check
  const { STABLECOINS, EVM_RPC_URLS } = await import('../src/services/chains.js');
  const rpcUrl = EVM_RPC_URLS['bnb'];
  const token = STABLECOINS['bnb']?.['usdt'];
  if (!rpcUrl || !token) {
    console.error(`\n❌ BSC RPC or USDT token missing in chains.js`);
    db.close();
    process.exit(1);
  }

  // broker BSC wallet addr (from agent_wallets, NOT decrypt privkey in dry-run)
  const walletRow = db.prepare(`
    SELECT address, privkey_encrypted FROM agent_wallets
    WHERE relay_node_id=? AND chain='bnb' AND is_default=1 LIMIT 1
  `).get(BROKER_RELAY_ID);
  if (!walletRow) {
    console.error(`\n❌ broker BSC wallet not found for relay ${BROKER_RELAY_ID}`);
    db.close();
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const erc20 = new ethers.Contract(token.address, ['function balanceOf(address) view returns (uint256)'], provider);
  const balRaw = await erc20.balanceOf(walletRow.address);
  const balUsdt = parseFloat(ethers.formatUnits(balRaw, token.decimals));
  const bnbRaw = await provider.getBalance(walletRow.address);
  const bnbHuman = parseFloat(ethers.formatEther(bnbRaw));

  console.log(`\n=== broker BSC wallet ${walletRow.address.slice(0, 10)}...${walletRow.address.slice(-6)} ===`);
  console.log(`USDT balance: ${balUsdt.toFixed(6)}`);
  console.log(`BNB balance (gas): ${bnbHuman.toFixed(6)} BNB`);
  console.log(`Need: ${totalUsdt.toFixed(6)} USDT + ~${(stuck.length * 0.0001).toFixed(4)} BNB gas (${stuck.length} TX)`);

  const enoughUsdt = balUsdt >= totalUsdt;
  const enoughGas = bnbHuman >= stuck.length * 0.0001;
  console.log(`\n${enoughUsdt ? '✅' : '❌'} USDT sufficient: ${balUsdt.toFixed(2)} >= ${totalUsdt.toFixed(2)}`);
  console.log(`${enoughGas ? '✅' : '❌'} BNB gas sufficient: ${bnbHuman.toFixed(4)} >= ${(stuck.length * 0.0001).toFixed(4)}`);

  try { provider?.destroy?.(); } catch {}

  if (!FIRE) {
    console.log(`\n🧪 DRY-RUN complete. 0 chain TX fired.`);
    console.log(`To fire real recovery: node scripts/_recover_stuck_escrow_usdt.mjs --fire`);
    db.close();
    return;
  }

  if (!enoughUsdt || !enoughGas) {
    console.error(`\n❌ Pre-check fail — refusing to fire. Top up wallet first.`);
    db.close();
    process.exit(1);
  }

  console.log(`\n🔥 REAL FIRE — ${stuck.length} BSC ERC20 transfer...`);
  const { transferUsdt } = await import('../src/services/evm-transfer.js');

  let ok = 0, fail = 0;
  for (const r of stuck) {
    // Idempotency re-check: skip if refund_tx already populated
    const fresh = db.prepare(`SELECT refund_tx FROM user_escrow_balances WHERE id=?`).get(r.id);
    if (fresh?.refund_tx) {
      console.log(`  ${r.id.slice(0, 8)} SKIP — refund_tx already set: ${fresh.refund_tx.slice(0, 16)}`);
      continue;
    }

    const amt = parseFloat(r.amount_received);
    console.log(`  ${r.id.slice(0, 8)} firing ${amt.toFixed(6)} USDT → ${r.user_refund_addr.slice(-12)}...`);
    const res = await transferUsdt('bnb', walletRow.privkey_encrypted, r.user_refund_addr, amt, 'USDT');
    if (res.ok) {
      db.prepare(`UPDATE user_escrow_balances SET refund_tx=?, updated_at=datetime('now') WHERE id=?`).run(res.txHash, r.id);
      db.prepare(`INSERT INTO chain_events (txid, event_type, payload, observed_at, observed_by) VALUES (?, 'manual_refund_recovery', ?, datetime('now'), 'KI63-Fix2')`)
        .run(res.txHash, JSON.stringify({ escrow_id: r.id, amount_usdt: amt, recipient: r.user_refund_addr, ki: 63, source: 'recover_stuck_escrow_usdt' }));
      console.log(`    ✅ TX ${res.txHash.slice(0, 18)}...`);
      ok++;
    } else {
      console.error(`    ❌ ${res.error}`);
      fail++;
    }
    // small spacing to avoid nonce race
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`\n=== Recovery complete: ${ok} ok / ${fail} fail / ${stuck.length} total ===`);
  db.close();
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
