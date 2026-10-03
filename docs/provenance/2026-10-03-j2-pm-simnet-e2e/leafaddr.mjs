import { pathToFileURL } from 'node:url';
process.env.DB_PATH = (process.env.TEMP || '/tmp') + '/_j2_cp.db'; process.env.KASPA_NETWORK = 'simnet'; process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
import { rpcConnect, kaspa } from './lib.mjs';
const imp = (p) => import(pathToFileURL('D:/kanet-tn12/scratch/_j2_wt_pm_e2e/kasia-console/src/' + p).href);
const { sqlite } = await imp('db/client.js');
const { spliceLeafState } = await imp('lib/pool-shard-register.mjs');
const rpc = await rpcConnect();
const sh = sqlite.prepare('select * from market_shards').get();
const ps = sqlite.prepare('select * from payout_shards').get();
const addr = (hex) => kaspa.addressFromScriptPublicKey(kaspa.payToScriptHashScript(new Uint8Array(Buffer.from(hex, 'hex'))), 'simnet').toString();
const leaf = addr(spliceLeafState(sh.shard_redeem_hex, JSON.parse(sh.current_leaf_state)));
const psRed = Buffer.from(ps.payout_redeem_hex, 'hex');
console.log('leaf addr', leaf);
for (const a of [leaf, addr(ps.payout_redeem_hex)]) {
  const { entries } = await rpc.getUtxosByAddresses([new kaspa.Address(a)]);
  console.log(a.slice(0, 30), entries.map((e) => `${e.outpoint.transactionId.slice(0, 10)}:${e.outpoint.index}=${Number(e.amount) / 1e8}KAS`));
}
process.exit(0);
