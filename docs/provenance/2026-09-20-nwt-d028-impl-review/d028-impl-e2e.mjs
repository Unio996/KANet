// NWT D-028 实现审: 用【真实依赖】(真 kaspa-wasm / 真 getSharedRpc / 活库 relay_nodes 地址做阳性对照 / 本机主网节点)跑实现的 readWatchBalances。
// 只读: 只对节点做 getServerInfo / getBalancesByAddresses; 活库只读打开。不打印任何地址 / 金额 / 名字; 只打印状态、原因码、布尔。
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const ROOT = 'D:/kanet-nwt-cand', CON = ROOT + '/kasia-console';
const req = createRequire(CON + '/package.json');
const Database = req('better-sqlite3');
const kaspa = req('kaspa-wasm');
const { readWatchBalances, sumWatchKas } = await import(pathToFileURL(CON + '/src/services/watch-balance.js').href);
const { getSharedRpc } = await import(pathToFileURL(CON + '/src/lib/kaspa-rpc-shared.mjs').href);
const live = new Database('D:/kanet-tn12/kasia-console/data/console.mainnet.db', { readonly: true, fileMustExist: true });
const hotAll = live.prepare('SELECT address FROM relay_nodes WHERE address IS NOT NULL').all().map((r) => r.address);
const prefixes = {}; for (const a of hotAll) { const p = String(a).split(':')[0]; prefixes[p] = (prefixes[p] || 0) + 1; }
console.log('relay_nodes address prefixes (counts only):', JSON.stringify(prefixes));
// 一个从未使用过的合法主网地址(一次性密钥现生成, 不打印)
const fresh = new kaspa.PrivateKey(crypto.randomBytes(32).toString('hex')).toPublicKey().toAddress('mainnet').toString();
const URL_ = 'ws://127.0.0.1:17110';
const deps = { getWorkingRpc: async () => ({ url: URL_, isLocal: true }), getSharedRpc, AddressCtor: kaspa.Address, hotAddresses: hotAll, env: { KASPA_RPC_LOCAL_ONLY: '1' }, cache: new Map() };

// 1) 生产接线的等价路径: 一个"冷存"行 = 从未使用地址(应读到 0, 状态 ok, 因为有阳性对照)
const t0 = Date.now();
const r1 = await readWatchBalances([{ id: 'w1', name: 'x', address: fresh, chain: 'kaspa', network: 'mainnet', custody: 'cold_no_key' }], { ...deps, cache: new Map() });
console.log('E1 fresh unused address:', JSON.stringify({ status: r1[0].status, reason: r1[0].reason, balanceIsZero: r1[0].balanceKas === 0, source: r1[0].source }), `(${Date.now() - t0} ms)`);

// 2) 已知有余额的地址当"冷存"行: 与直接读同一节点的数值比较(只打印是否相等)
const rpc = await getSharedRpc({ url: URL_, networkId: 'mainnet' });
let hotWithBal = null;
for (const a of hotAll) { const { entries } = await rpc.getBalancesByAddresses([new kaspa.Address(a)]); if ((entries?.[0]?.balance ?? 0n) > 0n) { hotWithBal = { a, sompi: entries[0].balance }; break; } }
if (!hotWithBal) console.log('E2 skipped: no hot address with balance>0 found');
else {
  const r2 = await readWatchBalances([{ id: 'w2', name: 'y', address: hotWithBal.a }], { ...deps, cache: new Map() });
  const expectKas = Number(hotWithBal.sompi / 100000000n) + Number(hotWithBal.sompi % 100000000n) / 1e8;
  console.log('E2 known-balance address as a watch row:', JSON.stringify({ status: r2[0].status, reason: r2[0].reason, equalsDirectRead: r2[0].balanceKas === expectKas, source: r2[0].source }));
}
// 3) 批: 两个冷存行(一个有余额地址 + 一个从未使用地址) — 顺序无关地按地址匹配; 求和只含读得到的
const r3 = hotWithBal ? await readWatchBalances([{ id: 'a', name: 'a', address: fresh }, { id: 'b', name: 'b', address: hotWithBal.a }], { ...deps, cache: new Map() }) : [];
if (r3.length) console.log('E3 batch [unused, known]:', JSON.stringify(r3.map((r) => ({ id: r.id, status: r.status, isZero: r.balanceKas === 0, isPositive: r.balanceKas > 0 }))), 'sum.watchUnreadable=', sumWatchKas(r3).watchUnreadable);
// 4) 阴性对照: 没有热地址可对照 -> 必须 unavailable(no_positive_control), 不是 0
const r4 = await readWatchBalances([{ id: 'w4', name: 'z', address: fresh }], { ...deps, hotAddresses: [], cache: new Map() });
console.log('E4 no hot control:', JSON.stringify({ status: r4[0].status, reason: r4[0].reason, balanceKas: r4[0].balanceKas }));
// 5) 阴性对照: 节点 URL 指向没有服务的端口 -> unavailable, 有界时间(5s 超时)
const t5 = Date.now();
const r5 = await readWatchBalances([{ id: 'w5', name: 'z', address: fresh }], { ...deps, getWorkingRpc: async () => ({ url: 'ws://127.0.0.1:1', isLocal: true }), cache: new Map() });
console.log('E5 dead rpc url:', JSON.stringify({ status: r5[0].status, reason: String(r5[0].reason).slice(0, 40), balanceKas: r5[0].balanceKas }), `(${Date.now() - t5} ms)`);
process.exitCode = 0;
setTimeout(() => process.exit(0), 300);
