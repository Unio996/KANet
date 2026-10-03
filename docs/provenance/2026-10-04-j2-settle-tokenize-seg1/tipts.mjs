import { rpcConnect } from './lib.mjs';
const rpc = await rpcConnect();
const d = await rpc.getBlockDagInfo();
const b = await rpc.getBlock({ hash: d.tipHashes[0], includeTransactions: false });
console.log('tip ts', Number(b.block.header.timestamp), 'now', Date.now(), 'lag ms', Date.now() - Number(b.block.header.timestamp), '| deadlineMs', JSON.parse((await import('fs')).readFileSync('D:/kanet-tn12/scratch/_j2_tok_sim/market.json','utf8')).targetDaa);
process.exit(0);
