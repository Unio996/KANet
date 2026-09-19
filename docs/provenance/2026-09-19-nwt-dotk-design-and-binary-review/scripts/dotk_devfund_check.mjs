// NWT: 只读。包内清单的 devfund_spk 是否真在主网收到档位费? (本机主网节点 17110, getUtxosByAddresses; 不连任何外部端点)
const kaspa = await import('kaspa-wasm');
const spkHex = '207ee85afca8273d94739037e7b4c736fcfc9e12d5c468eea5ce7b89181b49386bac';
const addr = kaspa.addressFromScriptPublicKey(new kaspa.ScriptPublicKey(0, spkHex), 'mainnet');
console.log('devfund address (from package manifest spk):', addr.toString());
const rpc = new kaspa.RpcClient({ url: 'ws://127.0.0.1:17110', networkId: 'mainnet', encoding: kaspa.Encoding.Borsh });
await rpc.connect();
const info = await rpc.getServerInfo(); console.log('node hasUtxoIndex=', info.hasUtxoIndex, 'isSynced=', info.isSynced, 'network=', info.networkId);
const { entries } = await rpc.getUtxosByAddresses({ addresses: [addr.toString()] });
const byAmt = new Map(); for (const e of entries) { const a = String(e.amount); byAmt.set(a, (byAmt.get(a) || 0) + 1); }
console.log('UTXO count at devfund address:', entries.length);
console.log('amount histogram (sompi:count):', JSON.stringify([...byAmt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)));
await rpc.disconnect();
