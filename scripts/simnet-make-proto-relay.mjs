// simnet-make-proto-relay.mjs -- creates ONE throw-away SIMNET relay ("proto-simnet-1") in the FRESH simnet console DB of a simnet-env.ps1 run and
// appends PROTO_RELAY_ID=<id> to that run's env file. Called by `simnet-env.ps1 up -WithProtoRelay` (cwd = the Tree, argv[2] = the run dir).
//   * refuses unless the run env says KASPA_NETWORK=simnet and DB_PATH lives under scratch\_simnet_console (it can never touch another DB);
//   * the private key is random, one-time, encrypted with THIS run's throw-away CONSOLE_ENCRYPTION_KEY, and never printed or written in the clear;
//   * the address is derived for Simnet (kaspasim:) -- the console's import-privkey route derives a testnet address, which the proto guard would refuse.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

const run = path.resolve(process.argv[2] || '');
const envFile = path.join(run, 'kanet.simnet.env');
if (!run.replace(/\//g, '\\').toLowerCase().startsWith('d:\\kanet-tn12\\scratch\\_simnet_console\\') || !fs.existsSync(envFile)) { console.log('refused: argv[2] must be a run dir under scratch\\_simnet_console with kanet.simnet.env'); process.exit(2); }
const text = fs.readFileSync(envFile, 'utf8');
for (const line of text.split(/\r?\n/)) { if (/^\s*#/.test(line) || /^\s*$/.test(line)) continue; const m = /^([^=]+)=(.*)$/.exec(line); if (m) process.env[m[1].trim()] = m[2]; }
if (process.env.KASPA_NETWORK !== 'simnet') { console.log('refused: KASPA_NETWORK is not simnet in the run env'); process.exit(2); }
if (!path.resolve(process.env.DB_PATH || '').replace(/\//g, '\\').toLowerCase().startsWith('d:\\kanet-tn12\\scratch\\_simnet_console\\')) { console.log('refused: DB_PATH is not under scratch\\_simnet_console'); process.exit(2); }
if (/^\s*PROTO_RELAY_ID=/m.test(text)) { console.log('refused: PROTO_RELAY_ID already set in this run env'); process.exit(2); }

const tree = process.cwd();
const req = createRequire(path.join(tree, 'kasia-console', 'package.json'));
const wasm = await import(pathToFileURL(req.resolve('kaspa-wasm')).href);
const { createRelayNode } = await import(pathToFileURL(path.join(tree, 'kasia-console', 'src', 'data', 'settings', 'relay-nodes.js')).href);
const { sqlite } = await import(pathToFileURL(path.join(tree, 'kasia-console', 'src', 'db', 'client.js')).href);

const priv = randomBytes(32).toString('hex');
const address = new wasm.PrivateKey(priv).toKeypair().toAddress(wasm.NetworkType.Simnet).toString();
if (!address.startsWith('kaspasim:')) { console.log('refused: derived address is not kaspasim:'); process.exit(3); }
const id = createRelayNode({ name: 'proto-simnet-1', privkey: priv, address, network: 'simnet', adapterNodeId: null, pollMs: 2000 });
const row = sqlite.prepare('SELECT id, name, address, network FROM relay_nodes WHERE id = ?').get(id);
if (!row || row.network !== 'simnet' || !row.name.startsWith('proto-')) { console.log('refused: row check failed'); process.exit(3); }
fs.appendFileSync(envFile, `\nPROTO_RELAY_ID=${id}\n`);
console.log(`PROTO-RELAY id=${id} name=${row.name} address=${row.address} network=${row.network}`);
sqlite.close();
process.exit(0);
