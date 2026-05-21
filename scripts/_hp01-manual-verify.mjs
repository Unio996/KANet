#!/usr/bin/env node
// DEPRECATED — operator emergency recovery, NOT regression test.
// HP-01 manual verify fire — Bug AL post-fix offer c791df74 needs _verifyAndComplete trigger.
// Root cause Bug AL fixed in commit 00b0b8361 (broker-v3 _doPublishAfterPrepay BUY verification = kaspa_tx).
// Kept for historical reference (one-off 5/17). DO NOT integrate as test case.
// Audit: KI 63 整合 (NWT N19.161/162, J2 #636 5/21) — operator scripts not in test framework scope.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// _verifyAndComplete not exported — use processPaymentSubmit instead (public, idempotent).
// But payment_tx already UPDATED, processPaymentSubmit may UNIQUE conflict on its own re-INSERT.
// Try: manually trigger via /api/exchange path OR direct module import.

import('../kasia-console/src/services/exchange-machine.js').then(async (m) => {
  const offerId = 'c791df74-11bc-423c-a411-c191be0c56d7';
  const paymentTx = 'ac018243da2b76d10ccf5630b44c2f9348310293e69b3347a3719f0e2fe6830a';
  // processPaymentSubmit needs payer_addr too. Let's try direct call.
  if (m.processPaymentSubmit) {
    const r = await m.processPaymentSubmit({
      offer_id: offerId,
      payment_tx: paymentTx,
      payment_chain: 'kaspa',
      payment_asset: 'KAS',
      payer: 'kaspa:qr7km875u5hhl42eaz4sjgmlcdnzjan9fnplcct3q7gq4ujdtpqqqe78fjev3',
    });
    console.log('processPaymentSubmit result:', JSON.stringify(r));
  } else {
    console.log('processPaymentSubmit not exported. Available:', Object.keys(m).slice(0, 30));
  }
}).catch(e => { console.error('err:', e.message); process.exit(1); });
