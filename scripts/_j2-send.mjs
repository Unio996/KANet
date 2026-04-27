// J2 #3 broadcast helper — 真 wrap /api/chat/send 加 unique tag (Owner 25:14 钦定根治大法)
// 真 leverage 现有 spec: broker-action-queue T-J2-15 (4 char tag) + T-NWT-14 ([r2] suffix)
// 真 anti-spam fuzzy 14min 86%+ window 真自动 jump
// usage: import { sendBroadcast } from './_j2-send.mjs'; await sendBroadcast(channel, text);

import crypto from 'crypto';

const J2_RELAY = 'c9c37c37-9a8c-484c-9893-20185d97ccf9';

export async function sendBroadcast(channel, text, opts = {}) {
  const tag = '#' + crypto.randomUUID().slice(0, 4);
  const tagged = (text || '').replace(/\n*$/, '') + '\n\n' + tag + '@' + new Date().toISOString().slice(11, 19);

  let attempt = 0;
  const maxAttempts = opts.maxAttempts || 3;
  while (attempt < maxAttempts) {
    attempt++;
    const final = attempt > 1 ? tagged + ` [r${attempt}]` : tagged;
    const res = await fetch('http://127.0.0.1:3100/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ relayId: opts.relayId || J2_RELAY, channel, message: final }),
    });
    const json = await res.json();
    if (json.ok && json.txId) {
      console.log(`[j2-send] ✓ tx ${json.txId.slice(0,12)} (attempt ${attempt})`);
      return json;
    }
    const errStr = json.error || JSON.stringify(json);
    console.log(`[j2-send] attempt ${attempt}/${maxAttempts}: ${errStr.slice(0,100)}`);
    if (errStr.includes('mempool') || errStr.includes('already spent')) {
      // UTXO conflict — wait UTXO confirm (~10s)
      await new Promise(r => setTimeout(r, 10000));
    } else if (errStr.includes('duplicate') || errStr.includes('similar')) {
      // anti-spam dedup — retry adds [r${attempt}] suffix, but if 99% similar to prefix still fails
      // 真 mitigation: throw to caller for substantial message change
      console.log(`[j2-send] anti-spam dedup hit — caller must use substantially different message`);
      await new Promise(r => setTimeout(r, 6000));
    } else {
      // Other error — fail fast
      throw new Error(errStr);
    }
  }
  throw new Error(`failed after ${maxAttempts} attempts`);
}
