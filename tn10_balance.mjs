import { RpcClient, Encoding, sompiToKaspaString } from './shared/vendor/kaspa-wasm/kaspa.js';

async function main() {
  // Initialize WASM if needed
  await kaspa.initWASM32Bindings();

  const client = new RpcClient();
  await client.connect({ host: '127.0.0.1', port: 16215, secure: false });
  console.log('Connected! nodeId:', client.nodeId);

  const dag = await client.getBlockDAGInfo();
  console.log('Block height:', dag.bestNodeBlock);
  console.log('Virtual DAA score:', dag.virtualDaaScore);

  const address = 'kaspatest:qpa4z45nxuqptg8cvewyyt8t9mvs7tcrh5l2yv69y5sqrh5y8mywc98naqkhk';
  const balance = await client.getBalanceByAddress(address);
  console.log('Available sompi:', balance.availableSompi);
  console.log('Immature sompi:', balance.immatureSompi);
  console.log('Locked sompi:', balance.lockedSompi);

  const kas = sompiToKaspaString(balance.availableSompi);
  console.log('Available KAS:', kas);

  await client.disconnect();
}

main().catch(e => console.error('ERROR:', e));
