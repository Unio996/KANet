// NWT D-028 设计审的只读实测。不打印任何地址 / 余额 / 账号名; 只打印形状、布尔、计数。
//  (a) 活节点 getBalancesByAddresses 对 [已知有余额的热地址, 从未使用过的合法地址] 的返回形状 + 同步状态
//  (b) 活库(只读)里 relay_nodes / agent_wallets 的地址存储格式(前缀/大小写/去重)
//  (c) 真实迁移建的临时库里"带地址语义的列"(回答: 登记脚本去重要查哪些表)
import { createRequire } from 'node:module'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawnSync } from 'node:child_process';
const ROOT = 'D:/kanet-nwt-cand', CON = path.join(ROOT, 'kasia-console'), REL = path.join(ROOT, 'kasia-relay');
const Database = createRequire(path.join(CON, 'package.json'))('better-sqlite3');
const kaspa = createRequire(path.join(REL, 'package.json'))('kaspa-wasm');
const LIVE = 'D:/kanet-tn12/kasia-console/data/console.mainnet.db';
const live = new Database(LIVE, { readonly: true, fileMustExist: true });
// (b) storage format
const fmt = (rows) => { const n = rows.length; const pre = rows.filter((r) => /^kaspa:/.test(r.address)).length; const lower = rows.filter((r) => r.address === r.address.toLowerCase()).length; const uniq = new Set(rows.map((r) => r.address.toLowerCase())).size; return { rows: n, withKaspaPrefix: pre, allLowercase: lower, distinct: uniq }; };
const rn = live.prepare("SELECT address FROM relay_nodes WHERE address IS NOT NULL").all();
console.log('(b) relay_nodes.address  ' + JSON.stringify(fmt(rn)));
const aw = live.prepare("SELECT chain, address FROM agent_wallets WHERE address IS NOT NULL").all();
console.log('(b) agent_wallets rows=' + aw.length + ' by chain=' + JSON.stringify(aw.reduce((m, r) => (m[r.chain] = (m[r.chain] || 0) + 1, m), {})));
const awk = aw.filter((r) => r.chain === 'kaspa'); console.log('(b) agent_wallets(kaspa) ' + JSON.stringify(fmt(awk.map((r) => ({ address: r.address })))));
// (a) live node shapes (read-only RPC; one short-lived client)
const hot = rn[0].address;
const cold = 'kaspa:' + 'q' + 'p'.repeat(61) + 'l';   // syntactically shaped placeholder; validity checked below
let valid = false; try { valid = kaspa.Address.validate(cold); } catch { valid = false; }
// build a VALID never-used address from a random key so no real address is queried
const rndKey = new kaspa.PrivateKey(Buffer.alloc(32, 7).toString('hex'));
const unused = rndKey.toAddress('mainnet').toString();
const rpc = new kaspa.RpcClient({ url: 'ws://127.0.0.1:17110', encoding: kaspa.Encoding.Borsh, networkId: 'mainnet' });
await Promise.race([rpc.connect(), new Promise((_, r) => setTimeout(() => r(new Error('connect timeout')), 15000))]);
const info = await rpc.getServerInfo();
console.log('(a) getServerInfo: isSynced=' + info.isSynced + ' hasUtxoIndex=' + info.hasUtxoIndex + ' networkId=' + info.networkId);
const r1 = await rpc.getBalancesByAddresses([new kaspa.Address(hot)]);
console.log('(a) known hot address : entries.length=' + r1.entries.length + ' entry[0] keys=' + Object.keys(r1.entries[0] || {}).join(',') + ' typeof balance=' + typeof (r1.entries[0] || {}).balance + ' balance>0=' + ((r1.entries[0] || {}).balance > 0n));
const r2 = await rpc.getBalancesByAddresses([new kaspa.Address(unused)]);
console.log('(a) never-used address : entries.length=' + r2.entries.length + ' entry[0]=' + (r2.entries[0] ? 'present typeof balance=' + typeof r2.entries[0].balance + ' value===0n:' + (r2.entries[0].balance === 0n) : 'ABSENT') );
const r3 = await rpc.getBalancesByAddresses([new kaspa.Address(hot), new kaspa.Address(unused)]);
console.log('(a) batch [hot, unused]: entries.length=' + r3.entries.length + ' (order preserved? first is hot: ' + (r3.entries[0] && r3.entries[0].address && String(r3.entries[0].address).toLowerCase() === hot.toLowerCase()) + ')');
await rpc.disconnect();
// what getKasBalance would return for the never-used address (its exact expression)
const e = r2.entries; console.log("(a) getKasBalance-style expression Math.round(Number(entries?.[0]?.balance || 0n)/1e8*1000)/1000 on the never-used address = " + Math.round(Number(e?.[0]?.balance || 0n) / 1e8 * 1000) / 1000 + '  (a synced node and an unsynced/empty response are indistinguishable here)');
// (c) address-like columns in the real schema
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nwt-d028-')); const TDB = path.join(TMP, 'fresh.db');
spawnSync(process.execPath, ['scripts/run-migrations.mjs'], { cwd: CON, env: { ...process.env, DB_PATH: TDB, CONSOLE_ENCRYPTION_KEY: '0'.repeat(64) } });
const fresh = new Database(TDB, { readonly: true });
const tables = fresh.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((t) => t.name);
const hits = []; for (const t of tables) for (const c of fresh.prepare(`PRAGMA table_info("${t}")`).all()) if (/addr/i.test(c.name)) hits.push(`${t}.${c.name}`);
console.log('(c) tables=' + tables.length + ' address-like columns=' + hits.length);
const own = hits.filter((h) => /(^|\.)(local_address|relay_address|maker_address|committee|operator|owner_address|address)$/i.test(h));
console.log('(c) columns whose name suggests OUR own / local address (candidates for "already a known address" checks): ' + own.join(', '));
fresh.close(); live.close(); fs.rmSync(TMP, { recursive: true, force: true });
process.exitCode = 0; setTimeout(() => process.exit(0), 300);
