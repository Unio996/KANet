/**
 * watch-accounts.js — D-028 只读(冷存)账户可见。设计 docs/2026-09-20-kanetui-d028-watch-only-accounts-design-v0.2.md §2.3。
 *
 * 只有 GET。没有 POST/PUT/PATCH/DELETE,没有任何 send/transfer/split/privkey 路径;watch id 传给 /api/relay/:id/* 一律 404(它不在 relay_nodes)。
 * 写入只有 scripts/watch-account-register.mjs(一次性,默认 dry-run)。api/backup.js 不含这张表(它的 import 是写路径)。
 * 余额读取见 services/watch-balance.js(读不到 ⇒ unavailable,绝不 0;KASPA_RPC_LOCAL_ONLY=1 ⇒ 零 REST 外发)。
 */
import { sqlite } from '../db/client.js';
import { readWatchBalances, sumWatchKas } from '../services/watch-balance.js';

/** watch_accounts 行(表缺失 ⇒ 空)。 */
export function listWatchRows() {
  try {
    return sqlite.prepare('SELECT id, name, chain, network, address, custody, note, created_at FROM watch_accounts ORDER BY created_at, name').all();
  } catch { return []; }
}

/** 阳性对照用的热地址: relay_nodes 里全部有地址的行(只读)。 */
function hotAddressesForControl() {
  try { return sqlite.prepare('SELECT address FROM relay_nodes WHERE address IS NOT NULL').all().map((r) => r.address); } catch { return []; }
}

/** 生产接线: 真实 rpc-health / 共享 RpcClient / kaspa-wasm Address。 */
async function productionDeps() {
  const [{ getWorkingRpc }, { getSharedRpc }, wasm] = await Promise.all([
    import('../services/rpc-health.js'),
    import('../lib/kaspa-rpc-shared.mjs'),
    import('kaspa-wasm'),
  ]);
  return { getWorkingRpc, getSharedRpc, AddressCtor: wasm.Address, hotAddresses: hotAddressesForControl() };
}

/**
 * 读冷存账户视图(供本路由与 portfolio.js 共用)。永不抛: 任何异常 ⇒ 全部账户 unavailable(internal_error)。
 * @returns {Promise<{ accounts: object[], watchKas: number, watchUnreadable: number }>}
 */
export async function loadWatchAccountsView(depsOverride = null) {
  const rows = listWatchRows();
  if (rows.length === 0) return { accounts: [], watchKas: 0, watchUnreadable: 0 };
  let accounts;
  try {
    const deps = depsOverride || await productionDeps();
    accounts = await readWatchBalances(rows, deps);
  } catch (e) {
    const readAt = new Date().toISOString();
    accounts = rows.map((r) => ({ id: r.id, name: r.name, address: r.address, chain: r.chain, custody: r.custody, status: 'unavailable', reason: 'internal_error', balanceKas: null, source: null, readAt }));
  }
  const notes = new Map(rows.map((r) => [r.id, r.note || null]));
  accounts = accounts.map((a) => ({ ...a, note: notes.get(a.id) }));
  return { accounts, ...sumWatchKas(accounts) };
}

/** depsProvider: 测试注入点(返回 readWatchBalances 的 deps);生产不传 ⇒ 真实 rpc-health / 共享 RpcClient / kaspa-wasm。 */
export async function registerWatchAccountRoutes(fastify, { depsProvider = null } = {}) {
  const view_ = async () => loadWatchAccountsView(depsProvider ? await depsProvider() : null);
  fastify.get('/api/watch-accounts', async (request, reply) => {
    const view = await view_();
    return reply.send({ ok: true, accounts: view.accounts, watchKas: view.watchKas, watchUnreadable: view.watchUnreadable, asOf: new Date().toISOString() });
  });

  fastify.get('/api/watch-accounts/:id', async (request, reply) => {
    const view = await view_();
    const one = view.accounts.find((a) => a.id === request.params.id);
    if (!one) return reply.code(404).send({ ok: false, error: 'watch account not found' });
    return reply.send({ ok: true, account: one, asOf: new Date().toISOString() });
  });
}
