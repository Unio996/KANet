// NWT 只读: e.entry.covenantId 对 covenant UTXO / 普通 UTXO 各返回什么(类型/值)? 以及 top-level 是否可读。
import { readFileSync } from 'node:fs';
const kaspa = await import('kaspa-wasm');
const st = JSON.parse(readFileSync('D:/kanet-tn12/scratch/_nwt_wt_j2_7f1e339b/kasia-console/scratch/_nwt_ladder/_nwt_ladder_state.json', 'utf8'));
const rpc = new kaspa.RpcClient({ url: 'ws://127.0.0.1:18510', networkId: 'simnet' });
await rpc.connect();
const show = (label, e) => { const c = e.entry.covenantId; console.log(label, '| top-level covenantId:', e.covenantId, '| entry.covenantId typeof:', typeof c, '| value:', c === undefined || c === null ? String(c) : String(c).slice(0, 16) + '…', '| ctor:', c && c.constructor && c.constructor.name); };
const spkCov = new kaspa.ScriptPublicKey(0, 'aa20' + 'ee'.repeat(32) + '87');
const r1 = await rpc.getUtxosByAddresses([String(kaspa.addressFromScriptPublicKey(spkCov, 'simnet'))]);
for (const e of r1.entries) show('covenant-bound UTXO (withdraw dest)', e);
const r2 = await rpc.getUtxosByAddresses([st.addr]);
show('plain P2PK UTXO (my simnet address)', r2.entries[0]);
await rpc.disconnect();
