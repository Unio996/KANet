// lib.mjs — 彩排 harness 共用: HTTP 到 simnet console(:3298)、独立 RPC 到 simnet kaspad、relays.json 读取。
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
export const WT = 'D:/kanet-tn12/scratch/_j2_wt_sz';
export const SIM = 'D:/kanet-tn12/scratch/_j2_tok_sim';
export const BASE = 'http://127.0.0.1:3298';
export const FUNDS_SECRET = 'simnet-funds-secret-e2e';
const require = createRequire(`${WT}/kasia-relay/`);
export const kaspa = require('kaspa-wasm');
export const relays = JSON.parse(readFileSync(`${SIM}/relays.json`, 'utf8'));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function rpcConnect() {
  const rpc = new kaspa.RpcClient({ url: 'ws://127.0.0.1:29717', encoding: kaspa.Encoding.Borsh, networkId: 'simnet' });
  await rpc.connect({});
  const info = await rpc.getServerInfo();
  if (info.networkId !== 'simnet') throw new Error('REFUSE: not simnet');
  return rpc;
}
export async function http(method, path, body, headers = {}) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(240000) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 400) }; }
  return { status: r.status, ...j };
}
export const cmd = (name, c) => http('POST', `/api/relay/${relays[name].id}/send-command`, c);
export const transfer = (name, to, kas) => http('POST', `/api/relay/${relays[name].id}/transfer`, { to, amount: Number(kas).toFixed(8) }, { 'x-kanet-admin-secret': FUNDS_SECRET });
export async function daa(rpc) { return Number((await rpc.getBlockDagInfo()).virtualDaaScore); }
export async function waitUtxo(rpc, addr, txid, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const { entries } = await rpc.getUtxosByAddresses([new kaspa.Address(addr)]);
    const e = entries.find((x) => x.outpoint.transactionId === txid);
    if (e) return { txid, index: e.outpoint.index, amount: String(e.amount), daa: String(e.blockDaaScore) };
    await sleep(400);
  }
  return null;
}
export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
