// Spawn Alice via the EXACT relay-manager.startRelay path used by the live console.
// If this succeeds where console-triggered restart fails, the diff is in the running
// console process's env (some inherited var poisons the child).

process.env.DB_PATH = process.env.DB_PATH || 'D:/kanet-testnet/kasia-console/data/console.db';
process.env.KANET_ROOT = process.env.KANET_ROOT || 'D:/kanet-testnet';

const ALICE_ID = '6a0a8eed-ce4f-4192-bb37-1d2843c626e4';

const { startRelay, getStatus } = await import('file:///D:/kanet-testnet/kasia-console/src/services/relay-manager.js');

console.log('starting Alice via mgr.startRelay...');
const result = await startRelay(ALICE_ID);
console.log('result:', result);

await new Promise(r => setTimeout(r, 10000));
console.log('status after 10s:', getStatus());
process.exit(0);
