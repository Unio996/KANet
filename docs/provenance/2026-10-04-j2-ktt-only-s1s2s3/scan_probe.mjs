import { rpcConnect, kaspa } from './s3lib.mjs';
const rpc = await rpcConnect();
const info = await rpc.getBlockDagInfo();
console.log('daa', info.virtualDaaScore, 'sink', info.sink, 'pp', info.pruningPointHash);
const want = process.argv[2];
let low = info.pruningPointHash, pages = 0, found = false, seen = new Set();
while (pages < 400 && !found) {
  const r = await rpc.getBlocks({ lowHash: low, includeBlocks: true, includeTransactions: true });
  const blocks = r.blocks || [];
  if (!blocks.length) break;
  for (const b of blocks) {
    const bh = b.header.hash;
    for (const tx of b.transactions || []) {
      const id = tx.verboseData?.transactionId; if (id === want) {
        console.log('FOUND in block', bh, 'tx keys', Object.keys(tx).join(','));
        console.log('inputs[0] keys', Object.keys(tx.inputs[0]).join(','));
        console.log('outputs', tx.outputs.map((o) => ({ v: String(o.value), keys: Object.keys(o).join(','), addr: o.verboseData?.scriptPublicKeyAddress, cov: JSON.stringify(o.covenant ?? null, (k, v) => typeof v === 'bigint' ? String(v) : v) })));
        found = true;
      }
    }
    low = bh;
  }
  pages++;
  if (blocks.length < 2) break;
}
console.log('pages', pages, 'found', found);
process.exit(0);
