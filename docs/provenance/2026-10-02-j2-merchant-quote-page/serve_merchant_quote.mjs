// serve_merchant_quote.mjs — 验收用的最小控制台: 真 Fastify + 真 @fastify/view(与 index.js 同配置)+ 真路由
// (merchant-quote + service-escrow), 不起整个 console(它需要主网 env/DB/relay)。
// 用法: PORT=18801 node serve_merchant_quote.mjs   (env: KASPA_NETWORK=simnet KASPA_RPC_URL=ws://127.0.0.1:29935 …)
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const WT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const CON = join(WT, 'kasia-console');
process.chdir(CON);
const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_mq_serve_${process.pid}.db`;
for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
execSync('node scripts/run-migrations.mjs', { cwd: CON, env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
process.env.DB_PATH = tmpDb;
process.env.KASPA_NETWORK = process.env.KASPA_NETWORK || 'simnet';
process.env.KASPA_RPC_URL = process.env.KASPA_RPC_URL || 'ws://127.0.0.1:29935';
process.env.KASPA_RPC_LOCAL_ONLY = '1';
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
const imp = (p) => import(pathToFileURL(join(CON, 'src', p)).href);
const req = createRequire(join(CON, 'package.json'));
const Fastify = req('fastify');
const { parseLang, getT, isRtl } = await imp('i18n/index.js');
const { registerServiceEscrowRoutes } = await imp('api/service-escrow.js');
const { registerMerchantQuoteRoutes } = await imp('api/merchant-quote.js');
const app = Fastify();
await app.register(req('@fastify/view'), {
  engine: { eta: new (req('eta').Eta)() },
  root: join(CON, 'src/ui'), viewExt: 'eta', defaultContext: { appName: 'Kasia Console' }, options: { useWith: true },
});
await registerServiceEscrowRoutes(app);
await registerMerchantQuoteRoutes(app);
app.get('/merchant/quote', async (req, reply) => {
  const lang = parseLang(req.headers.cookie); const t = getT(lang);
  return reply.viewAsync('merchant-quote', { lang, t, dir: isRtl(lang) ? 'rtl' : 'ltr', _page: 'merchant-quote' });
});
await app.listen({ port: Number(process.env.PORT || 18801), host: '127.0.0.1' });
console.log(`[mq-test-console] http://127.0.0.1:${process.env.PORT || 18801}/merchant/quote  network=${process.env.KASPA_NETWORK}`);
