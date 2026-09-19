// NWT D-028 实现审: 真实 Fastify 上注册 registerWatchAccountRoutes + registerPortfolioRoutes(桩 loadWatch), 枚举实际挂上的路由; 对 watch 路径发 POST/PUT/PATCH/DELETE 看响应。
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const CON = 'D:/kanet-nwt-cand/kasia-console';
const req = createRequire(CON + '/package.json');
const Fastify = req('fastify');
const { registerWatchAccountRoutes } = await import(pathToFileURL(CON + '/src/api/watch-accounts.js').href);
const routes = [];
const app = Fastify({ logger: false });
app.addHook('onRoute', (r) => routes.push(`${[].concat(r.method).join(',')} ${r.url}`));
await registerWatchAccountRoutes(app, { depsProvider: async () => ({ getWorkingRpc: async () => ({ url: null, isLocal: false }), getSharedRpc: async () => { throw new Error('unused'); }, AddressCtor: null, hotAddresses: [] }) });
await app.ready();
console.log('routes registered by registerWatchAccountRoutes:', JSON.stringify(routes));
for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  for (const u of ['/api/watch-accounts', '/api/watch-accounts/x']) {
    const r = await app.inject({ method: m, url: u, payload: { name: 'n', address: 'a' } });
    console.log(`${m} ${u} -> ${r.statusCode}`);
  }
}
const g = await app.inject({ method: 'GET', url: '/api/watch-accounts' });
console.log('GET /api/watch-accounts (empty table / no db) ->', g.statusCode, JSON.stringify(Object.keys(JSON.parse(g.body))));
await app.close();
process.exit(0);
