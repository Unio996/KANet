// NWT 只读: kaspa-wasm getUtxosByAddresses 返回条目的真实形状 —— 是否暴露 covenantId? (R1 的前提 F10)
const kaspa = await import('kaspa-wasm');
const rpc = new kaspa.RpcClient({ url: 'ws://127.0.0.1:18510', networkId: 'simnet' });
await rpc.connect();
const spk = new kaspa.ScriptPublicKey(0, 'aa20' + 'ee'.repeat(32) + '87'); // withdraw(批7)目的地 covenant genesis 输出, 未花费
const addr = kaspa.addressFromScriptPublicKey(spk, 'simnet');
const res = await rpc.getUtxosByAddresses([String(addr)]);
const es = res.entries || [];
console.log('entries', es.length, 'wasm-kaspa exports version-ish:', kaspa.version?.() ?? 'n/a');
const e = es[0];
if (e) {
  const names = new Set(); let o = e; while (o && o !== Object.prototype) { for (const n of Object.getOwnPropertyNames(o)) names.add(n); o = Object.getPrototypeOf(o); }
  console.log('props:', [...names].filter((n) => !n.startsWith('__')).join(','));
  for (const n of ['amount', 'scriptPublicKey', 'covenantId', 'covenant_id', 'blockDaaScore', 'isCoinbase', 'outpoint', 'entry', 'utxoEntry']) { let v; try { v = e[n]; } catch (x) { v = 'ERR ' + x.message; } console.log(' ', n, '=>', v === undefined ? 'undefined' : (typeof v === 'object' ? 'object:' + Object.getOwnPropertyNames(Object.getPrototypeOf(v) || {}).filter((k) => !k.startsWith('__')).join('|') : String(v).slice(0, 80))); }
  try { const j = JSON.parse(JSON.stringify(e, (k, v) => (typeof v === 'bigint' ? v.toString() : v))); console.log('JSON.stringify(e) keys:', Object.keys(j)); } catch (x) { console.log('stringify err', x.message); }
  try { console.log('toJSON?', typeof e.toJSON === 'function' ? JSON.stringify(e.toJSON(), (k, v) => (typeof v === 'bigint' ? v.toString() : v)).slice(0, 400) : 'no toJSON'); } catch (x) { console.log('toJSON err', x.message); }
}
await rpc.disconnect();
