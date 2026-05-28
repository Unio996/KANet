// Debug: spawn J1tn-Alice the same way relay-manager does and capture child stdout/stderr.
// Exit code 3221225794 (= 0xC0000142 STATUS_DLL_INIT_FAILED) appears when console manages it
// but disappears when we spawn directly — narrow which env/path differs.

import { sqlite } from 'file:///D:/kanet-testnet/kasia-console/src/db/client.js';
import { decrypt } from 'file:///D:/kanet-testnet/kasia-console/src/services/crypto.js';
import { fork } from 'child_process';

const RELAY_ID = process.argv[2] || '6a0a8eed-ce4f-4192-bb37-1d2843c626e4';

const row = sqlite.prepare('SELECT mnemonic_encrypted, name FROM relay_nodes WHERE id = ?').get(RELAY_ID);
if (!row?.mnemonic_encrypted) { console.error('no mnemonic for', RELAY_ID); process.exit(2); }
const mnemonic = decrypt(row.mnemonic_encrypted);
console.log('spawning', row.name, '(mnemonic words:', mnemonic.split(/\s+/).length, ')');

const child = fork('src/relay.mjs', [], {
  cwd: 'D:/kanet-testnet/kasia-relay',
  env: {
    ...process.env,
    NODE_OPTIONS: '',                     // strip any --input-type leakage
    KASPA_MNEMONIC: mnemonic,
    KASPA_NETWORK: 'testnet-12',
    KASPA_RPC_URL: 'ws://192.168.1.105:17210',
    CONSOLE_URL: 'http://127.0.0.1:3300',
    RELAY_NODE_ID: RELAY_ID,
    NETWORK: 'testnet-12',
    RELAY_MODE: 'rpc',
    POLL_MS: '2000',
    IS_SERVICE: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
});

child.stdout.on('data', d => console.log('[OUT]', d.toString().trimEnd()));
child.stderr.on('data', d => console.log('[ERR]', d.toString().trimEnd()));
child.on('exit', code => { console.log(`EXITED code=${code} (0x${(code>>>0).toString(16).toUpperCase()})`); });
child.on('error', err => console.log('SPAWN ERR:', err.message));

setTimeout(() => {
  console.log('--- 15s timeout, killing ---');
  try { child.kill('SIGKILL'); } catch {}
  process.exit(0);
}, 15000);
