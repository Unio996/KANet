// mailbox_boundary.mjs — 0.10 ~ 0.15 KAS 之间的失败/成功边界(simnet, 44B payload)。用法: node mailbox_boundary.mjs
import { relays, kaspa, rpcConnect, cmd, sleep } from '../2026-10-05-j2-strict-zero/szlib.mjs';
await rpcConnect();
const mk = (s) => new kaspa.PrivateKey(s.padEnd(64, '0').slice(0, 64)).toPublicKey().toAddress('simnet').toString();
for (const amt of ['0.11', '0.12', '0.13', '0.14']) {
  const r = await cmd('maker', { type: 'delivery_mailbox_send', target: mk(Buffer.from(`bd-${amt}-${Date.now()}`).toString('hex')), amount: amt, payload_hex: '4b444c31' + 'ab'.repeat(40) });
  console.log(JSON.stringify({ amount_kas: amt, ok: r.ok === true, fee_kas: r.fee, error: r.ok ? undefined : String(r.error).slice(0, 120) })); await sleep(2500);
}
process.exit(0);
