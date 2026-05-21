#!/usr/bin/env node
// DEPRECATED 5/21 (Owner ack option 3, KI 63 整合 Group B):
// Operator one-off prepay TX for CA-01 step B. 同 _ca01-step-b-sell DEPRECATED.
// 真链等价 framework: test-framework/lib/real-chain-runner.mjs#sendKasViaRelay 模式.
// DO NOT execute.
//
// CA-01 Step B.2: J2 真 Kaspa transfer 5.00000110 KAS → broker Kasia
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const J2_RELAY = 'c9c37c37-9a8c-484c-9893-20185d97ccf9';
const BROKER_KASIA = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';
const AMOUNT = 5.00000110;

import('../kasia-console/src/services/relay-manager.js').then(async ({ sendCommandAsync }) => {
  console.log(`--- J2 send_kas ${AMOUNT} KAS → broker ${BROKER_KASIA.slice(0,30)}... ---`);
  const r = await sendCommandAsync(J2_RELAY, { type: 'send_kas', target: BROKER_KASIA, amount_kas: AMOUNT, note: 'CA-01 step B prepay' });
  console.log('result:', JSON.stringify(r));
}).catch(e => { console.error('err:', e.message); process.exit(1); });
