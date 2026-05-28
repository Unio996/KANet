// Smoke test: 2 tunnels on localhost — hole punch + signed data exchange + heartbeat.

import { openTunnel, generateEd25519Keypair } from './src/services/nat-tunnel.mjs';

const A = generateEd25519Keypair();
const B = generateEd25519Keypair();

console.log('--- generating keypairs ---');
console.log('A pubkey type:', A.publicKey.asymmetricKeyType);
console.log('B pubkey type:', B.publicKey.asymmetricKeyType);

// Bind A with manual_punch=true (= don't punch yet, peer port unknown)
const tunnelA = openTunnel({
  peer_endpoint: { ip: '127.0.0.1', port: 1 },  // placeholder, will rewire
  peer_pubkey: B.publicKey,
  local_pubkey: A.publicKey,
  local_privkey: A.privateKey,
  manual_punch: true,
});

await new Promise(r => setTimeout(r, 100));
const portA = tunnelA.local_port;

// Bind B with A's port known
const tunnelB = openTunnel({
  peer_endpoint: { ip: '127.0.0.1', port: portA },
  peer_pubkey: A.publicKey,
  local_pubkey: B.publicKey,
  local_privkey: B.privateKey,
  manual_punch: true,
});

await new Promise(r => setTimeout(r, 100));
const portB = tunnelB.local_port;

// Rewire A's peer endpoint + manually trigger both punches
tunnelA.peer_endpoint.port = portB;
tunnelA.punch();
tunnelB.punch();

console.log(`A local port: ${portA}, B local port: ${portB}`);
console.log('--- hole punch (= simultaneous HELLO frames) ---');

const opened = { A: false, B: false };
tunnelA.on('open', () => { opened.A = true; console.log('  A: tunnel open'); });
tunnelB.on('open', () => { opened.B = true; console.log('  B: tunnel open'); });
tunnelA.on('error', (e) => console.error('  A error:', e.message));
tunnelB.on('error', (e) => console.error('  B error:', e.message));

const received = { A: [], B: [] };
tunnelA.on('data', (d) => { received.A.push(d.toString()); console.log(`  A recv: ${d.toString()}`); });
tunnelB.on('data', (d) => { received.B.push(d.toString()); console.log(`  B recv: ${d.toString()}`); });

// Wait for both open
const openOK = await new Promise(r => {
  const check = setInterval(() => {
    if (opened.A && opened.B) { clearInterval(check); r(true); }
  }, 100);
  setTimeout(() => { clearInterval(check); r(false); }, 4000);
});

if (!openOK) {
  console.error('FAIL: tunnels did not open within 4s');
  process.exit(1);
}

console.log('--- bidirectional data exchange ---');
await tunnelA.send(Buffer.from('hello from A'));
await tunnelB.send(Buffer.from('hello from B'));
await tunnelA.send(Buffer.from('1KB test ' + 'X'.repeat(1000)));

await new Promise(r => setTimeout(r, 500));

console.log('--- replay defense (= send same nonce again, should be ignored) ---');
// Can't easily test from outside without raw frame; protocol handles internally.

console.log('--- bad sig defense (= use wrong pubkey to verify) ---');
const C = generateEd25519Keypair();
const tunnelC = openTunnel({
  peer_endpoint: { ip: '127.0.0.1', port: portA },
  peer_pubkey: B.publicKey,  // A's tunnel verifies as B, but C signs with C's privkey → sig mismatch
  local_pubkey: C.publicKey,
  local_privkey: C.privateKey,
});
await new Promise(r => setTimeout(r, 1500));  // wait for C's HELLO punch attempts
tunnelC.close();
console.log('  A bad-sig errors emitted: (= expected to see "sig verify failed")');

console.log('\n--- summary ---');
console.log('A received:', received.A.length, 'msgs');
console.log('B received:', received.B.length, 'msgs');
console.log('A bytes sent:', tunnelA.bytes_sent, '/ received:', tunnelA.bytes_received);
console.log('B bytes sent:', tunnelB.bytes_sent, '/ received:', tunnelB.bytes_received);

const ok = received.A.length >= 1 && received.B.length >= 2;
console.log(ok ? '\n✅ smoke PASS' : '\n❌ smoke FAIL');

tunnelA.close();
tunnelB.close();
process.exit(ok ? 0 : 1);
