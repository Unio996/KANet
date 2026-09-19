const kaspa = await import('kaspa-wasm');
const rpc = new kaspa.RpcClient({ url: 'ws://127.0.0.1:17110', networkId: 'mainnet', encoding: kaspa.Encoding.Borsh });
try { await rpc.connect(); const i = await rpc.getBlockDagInfo(); console.log('mainnet virtualDaaScore', i.virtualDaaScore, 'toccata@474165565 active=', BigInt(i.virtualDaaScore) >= 474165565n); await rpc.disconnect(); } catch (e) { console.log('err', String(e).slice(0,200)); }
