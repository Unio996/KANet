import { rpcConnect, kaspa } from './lib.mjs';
const rpc = await rpcConnect();
for (const a of process.argv.slice(2)) {
  const { entries } = await rpc.getUtxosByAddresses([new kaspa.Address(a)]);
  console.log(a.slice(0, 30), entries.length, 'utxos', entries.map((e) => `${e.outpoint.transactionId.slice(0, 10)}:${e.outpoint.index}=${Number(e.amount) / 1e8}KAS${e.covenantId ? ' cov=' + e.covenantId.slice(0, 8) : ''}`).join(' '));
}
process.exit(0);
