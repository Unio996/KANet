// NWT D-028 v0.2 审: 18 个热地址(只读 relay_nodes)在本机节点上的余额分布——只报计数, 不打印地址/余额/名字。
import { createRequire } from 'node:module'; import path from 'node:path';
const ROOT = 'D:/kanet-nwt-cand';
const Database = createRequire(path.join(ROOT, 'kasia-console', 'package.json'))('better-sqlite3');
const kaspa = createRequire(path.join(ROOT, 'kasia-relay', 'package.json'))('kaspa-wasm');
const live = new Database('D:/kanet-tn12/kasia-console/data/console.mainnet.db', { readonly: true, fileMustExist: true });
const hot = live.prepare('SELECT address FROM relay_nodes WHERE address IS NOT NULL').all().map((r) => r.address); live.close();
const rpc = new kaspa.RpcClient({ url: 'ws://127.0.0.1:17110', encoding: kaspa.Encoding.Borsh, networkId: 'mainnet' });
await Promise.race([rpc.connect(), new Promise((_, r) => setTimeout(() => r(new Error('connect timeout')), 15000))]);
const info = await rpc.getServerInfo();
const { entries } = await rpc.getBalancesByAddresses(hot.map((a) => new kaspa.Address(a)));
const bal = new Map(entries.map((e) => [String(e.address).toLowerCase(), e.balance]));
const vals = hot.map((a) => bal.get(a.toLowerCase()));
const missing = vals.filter((v) => v === undefined).length, zero = vals.filter((v) => v === 0n).length, pos = vals.filter((v) => typeof v === 'bigint' && v > 0n).length;
console.log(`isSynced=${info.isSynced} hot addresses=${hot.length} entries returned=${entries.length}  -> missing=${missing} zero=${zero} positive=${pos}`);
console.log('literal rule "ANY control item is 0/missing => whole batch unavailable" would say: ' + ((zero + missing) > 0 ? 'UNAVAILABLE (today, with a synced node)' : 'ok'));
console.log('rule "AT LEAST ONE control item > 0" would say: ' + (pos > 0 ? 'ok' : 'unavailable'));
await rpc.disconnect(); setTimeout(() => process.exit(0), 300);
