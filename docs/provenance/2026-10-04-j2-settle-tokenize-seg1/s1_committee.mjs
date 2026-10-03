// s1_committee.mjs — 6 委员 enroll(生产 POST /api/oracle-pool/enroll, signing_relay_id=委员 relay → 链上 envelope) + 押金 1.05 KAS 转 P2SH + 生产 scanner 入池。
import { http, relays, transfer, rpcConnect, waitUtxo, daa, sleep, log } from './lib.mjs';
const rpc = await rpcConnect();
const names = [1, 2, 3, 4, 5, 6].map((i) => `oracle-${i}`);
const lockUntil = (await daa(rpc)) + 5_000_000;
for (const n of names) {
  const r = relays[n];
  const en = await http('POST', '/api/oracle-pool/enroll', { staker_pk_x: r.xonly, lock_until_daa: lockUntil, signing_relay_id: r.id, source: 'chain_envelope' });
  log(n, 'enroll', JSON.stringify({ ok: en.ok, status: en.status, p2sh: en.p2sh_addr, broadcast: en.broadcast }).slice(0, 400));
  if (!en.ok) throw new Error('enroll failed ' + JSON.stringify(en));
  await sleep(2500);
  const tr = await transfer(n, en.p2sh_addr, '1.05');
  log(n, 'stake transfer', JSON.stringify(tr));
  if (!tr.txId) throw new Error('stake transfer failed');
  const u = await waitUtxo(rpc, en.p2sh_addr, tr.txId);
  log(n, 'node UTXO @stake p2sh:', JSON.stringify(u));
  await sleep(1500);
}
const snap = await http('GET', '/api/oracle-pool/chain-snapshot');
log('chain-snapshot', JSON.stringify({ ok: snap.ok, poolSize: snap.poolSize, scanned: snap.scanned, valid: snap.valid, rejected: snap.rejected, snapshotDaa: snap.snapshotDaa, currentDaa: snap.currentDaa, merkleRoot: snap.merkleRoot }));
process.exit(0);
