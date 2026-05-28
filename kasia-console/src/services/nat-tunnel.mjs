// NAT Tunnel — UDP hole punch + ed25519 signed frame (Tier 2.1 MVP)
//
// Tier 2.1 propose dev-channel-tier2-tunnel-propose-2026-05-28.md §2b/2c
// Pure node:dgram + node:crypto (ed25519 sign/verify). 0 npm dep.
//
// MVP scope:
//  - Hole punch (= simultaneous UDP packet exchange to open NAT mapping)
//  - Signed frame protocol (= ed25519 sig over [nonce][timestamp][seq][data])
//  - No encryption (= plaintext MVP, Tier 2.2 加 ChaCha20Poly1305 ECDH)
//  - No QUIC (= Node 24 无 node:quic, Tier 2.2 加 multiplex + congestion control)
//
// Public API:
//   openTunnel({ peer_endpoint, peer_pubkey, local_pubkey, local_privkey, local_port? }) → Tunnel
//   Tunnel events: 'open' | 'data' (Buffer) | 'error' (Error) | 'close'
//   Tunnel.send(data: Buffer) → Promise<void>
//   Tunnel.close()
//
// Frame format (network-byte-order):
//   [4B magic 0x4B414E45 'KANE']
//   [1B version 0x01]
//   [1B type 0x00=hello 0x01=data 0x02=ack 0x03=heartbeat]
//   [2B reserved 0x0000]
//   [16B nonce (random)]
//   [8B timestamp ms]
//   [4B sequence number]
//   [4B data length]
//   [N data]
//   [64B ed25519 signature over preceding bytes]

import dgram from 'node:dgram';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const FRAME_MAGIC = 0x4B414E45;  // 'KANE'
const FRAME_VERSION = 0x01;
const FRAME_TYPE_HELLO = 0x00;
const FRAME_TYPE_DATA = 0x01;
const FRAME_TYPE_ACK = 0x02;
const FRAME_TYPE_HEARTBEAT = 0x03;
const HEADER_SIZE = 4 + 1 + 1 + 2 + 16 + 8 + 4 + 4;  // = 40 bytes
const SIG_SIZE = 64;
const MIN_FRAME_SIZE = HEADER_SIZE + SIG_SIZE;
const MAX_FRAME_SIZE = 65000;  // UDP practical limit
const MAX_DATA_SIZE = MAX_FRAME_SIZE - MIN_FRAME_SIZE;
const REPLAY_WINDOW_MS = 30_000;  // Reject frames > 30s old (clock skew tolerance)
const HOLE_PUNCH_PACKETS = 5;     // Send 5 UDP packets back-to-back
const HOLE_PUNCH_INTERVAL_MS = 200;
const HOLE_PUNCH_TIMEOUT_MS = 3000;
const HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * Generate a fresh ed25519 keypair for this agent.
 * Returns { publicKey, privateKey } as KeyObject (Node crypto).
 */
export function generateEd25519Keypair() {
  return crypto.generateKeyPairSync('ed25519');
}

/**
 * Export ed25519 public key as base64 (= envelope payload format).
 */
export function exportPubkeyBase64(publicKey) {
  return publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
}

/**
 * Import ed25519 public key from base64 string (= envelope payload format).
 */
export function importPubkeyBase64(b64) {
  return crypto.createPublicKey({
    key: Buffer.from(b64, 'base64'),
    format: 'der',
    type: 'spki',
  });
}

function buildFrame({ type, data, sequence, privateKey }) {
  const dataBuf = data || Buffer.alloc(0);
  if (dataBuf.length > MAX_DATA_SIZE) throw new Error(`frame data ${dataBuf.length}B exceeds max ${MAX_DATA_SIZE}B`);
  const header = Buffer.alloc(HEADER_SIZE);
  let off = 0;
  header.writeUInt32BE(FRAME_MAGIC, off); off += 4;
  header.writeUInt8(FRAME_VERSION, off); off += 1;
  header.writeUInt8(type, off); off += 1;
  header.writeUInt16BE(0x0000, off); off += 2;
  crypto.randomBytes(16).copy(header, off); off += 16;
  header.writeBigUInt64BE(BigInt(Date.now()), off); off += 8;
  header.writeUInt32BE(sequence, off); off += 4;
  header.writeUInt32BE(dataBuf.length, off); off += 4;
  const headerPlusData = Buffer.concat([header, dataBuf]);
  const sig = crypto.sign(null, headerPlusData, privateKey);
  if (sig.length !== SIG_SIZE) throw new Error(`unexpected sig size ${sig.length}`);
  return Buffer.concat([headerPlusData, sig]);
}

function parseFrame(buf, peerPublicKey) {
  if (buf.length < MIN_FRAME_SIZE) return { ok: false, reason: `frame too small (${buf.length}B)` };
  const magic = buf.readUInt32BE(0);
  if (magic !== FRAME_MAGIC) return { ok: false, reason: `bad magic 0x${magic.toString(16)}` };
  const version = buf.readUInt8(4);
  if (version !== FRAME_VERSION) return { ok: false, reason: `unsupported version ${version}` };
  const type = buf.readUInt8(5);
  const ts = Number(buf.readBigUInt64BE(8 + 16));
  const sequence = buf.readUInt32BE(8 + 16 + 8);
  const dataLength = buf.readUInt32BE(8 + 16 + 8 + 4);
  if (HEADER_SIZE + dataLength + SIG_SIZE !== buf.length) {
    return { ok: false, reason: `length mismatch: header says ${dataLength} data, buf is ${buf.length}` };
  }
  const headerPlusData = buf.subarray(0, HEADER_SIZE + dataLength);
  const sig = buf.subarray(HEADER_SIZE + dataLength);
  let sigOk;
  try {
    sigOk = crypto.verify(null, headerPlusData, peerPublicKey, sig);
  } catch (e) {
    return { ok: false, reason: `sig verify exception: ${e.message}` };
  }
  if (!sigOk) return { ok: false, reason: 'sig verify failed' };
  const age = Date.now() - ts;
  if (Math.abs(age) > REPLAY_WINDOW_MS) {
    return { ok: false, reason: `frame timestamp out of window (age ${age}ms)` };
  }
  const data = buf.subarray(HEADER_SIZE, HEADER_SIZE + dataLength);
  return { ok: true, type, sequence, timestamp: ts, data };
}

/**
 * Open a NAT tunnel to a remote peer.
 *
 * Flow:
 *  1. Bind local UDP socket
 *  2. Hole punch: send N HELLO frames to peer's external endpoint
 *  3. Wait for incoming HELLO from peer (= NAT mapping bidirectionally open)
 *  4. Emit 'open', start heartbeat loop
 *  5. Subsequent send() emits DATA frames
 *  6. On receive, verify sig + emit 'data'
 *
 * @param {object} opts
 * @param {{ ip: string, port: number }} opts.peer_endpoint
 * @param {KeyObject} opts.peer_pubkey
 * @param {KeyObject} opts.local_pubkey
 * @param {KeyObject} opts.local_privkey
 * @param {number} [opts.local_port=0]
 * @returns {Tunnel extends EventEmitter}
 */
export function openTunnel(opts) {
  const tunnel = new EventEmitter();
  const socket = dgram.createSocket('udp4');
  const seenNonces = new Set();
  let sequence = 0;
  let open = false;
  let closed = false;
  let heartbeatTimer = null;
  let punchTimer = null;
  let openTimeout = null;

  tunnel.status = 'connecting';
  tunnel.peer_endpoint = opts.peer_endpoint;
  tunnel.bytes_sent = 0;
  tunnel.bytes_received = 0;

  function cleanup() {
    if (closed) return;
    closed = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (punchTimer) clearInterval(punchTimer);
    if (openTimeout) clearTimeout(openTimeout);
    try { socket.close(); } catch {}
    tunnel.status = 'closed';
    tunnel.emit('close');
  }

  socket.on('error', (err) => {
    tunnel.emit('error', err);
    cleanup();
  });

  socket.on('message', (buf, rinfo) => {
    const result = parseFrame(buf, opts.peer_pubkey);
    if (!result.ok) {
      tunnel.emit('error', new Error(`bad frame from ${rinfo.address}:${rinfo.port}: ${result.reason}`));
      return;
    }
    const nonceKey = `${result.timestamp}-${result.sequence}-${result.type}`;
    if (seenNonces.has(nonceKey)) return;  // replay
    seenNonces.add(nonceKey);
    // GC old nonces (keep last 100)
    if (seenNonces.size > 100) {
      const old = [...seenNonces].slice(0, seenNonces.size - 100);
      for (const k of old) seenNonces.delete(k);
    }
    tunnel.bytes_received += buf.length;
    if (result.type === FRAME_TYPE_HELLO && !open) {
      open = true;
      tunnel.status = 'open';
      if (punchTimer) { clearInterval(punchTimer); punchTimer = null; }
      if (openTimeout) { clearTimeout(openTimeout); openTimeout = null; }
      startHeartbeat();
      tunnel.emit('open');
    } else if (result.type === FRAME_TYPE_DATA) {
      tunnel.emit('data', result.data);
    }
    // HEARTBEAT + ACK are silent (just refresh last-seen)
  });

  function sendFrame(type, data) {
    const frame = buildFrame({
      type,
      data,
      sequence: sequence++,
      privateKey: opts.local_privkey,
    });
    return new Promise((resolve, reject) => {
      socket.send(frame, opts.peer_endpoint.port, opts.peer_endpoint.ip, (err) => {
        if (err) reject(err);
        else {
          tunnel.bytes_sent += frame.length;
          resolve();
        }
      });
    });
  }

  function startHeartbeat() {
    heartbeatTimer = setInterval(() => {
      sendFrame(FRAME_TYPE_HEARTBEAT, null).catch(e => tunnel.emit('error', e));
    }, HEARTBEAT_INTERVAL_MS);
  }

  function startHolePunch() {
    let punches = 0;
    punchTimer = setInterval(() => {
      sendFrame(FRAME_TYPE_HELLO, null).catch(e => tunnel.emit('error', e));
      punches++;
      if (punches >= HOLE_PUNCH_PACKETS) {
        clearInterval(punchTimer);
        punchTimer = null;
      }
    }, HOLE_PUNCH_INTERVAL_MS);
    openTimeout = setTimeout(() => {
      if (!open) {
        tunnel.status = 'failed';
        tunnel.emit('error', new Error(`hole punch timeout (${HOLE_PUNCH_TIMEOUT_MS}ms, peer ${opts.peer_endpoint.ip}:${opts.peer_endpoint.port})`));
        cleanup();
      }
    }, HOLE_PUNCH_TIMEOUT_MS);
  }

  socket.bind(opts.local_port || 0, '0.0.0.0', () => {
    tunnel.local_port = socket.address().port;
    if (!opts.manual_punch) startHolePunch();
  });

  tunnel.send = (data) => {
    if (!open) return Promise.reject(new Error(`tunnel not open (status=${tunnel.status})`));
    return sendFrame(FRAME_TYPE_DATA, data);
  };

  // Manual punch trigger — useful when caller needs to set peer_endpoint after bind (= local testing).
  tunnel.punch = () => {
    if (open || closed) return;
    startHolePunch();
  };

  tunnel.close = cleanup;

  return tunnel;
}
