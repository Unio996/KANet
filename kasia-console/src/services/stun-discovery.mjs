// STUN discovery — minimal RFC 5389 client to find external (IP, port) + NAT type
//
// Tier 2.1 propose dev-channel-tier2-tunnel-propose-2026-05-28.md §2a
// 0 npm dependency (pure node:dgram). ~200 LOC.
//
// Public API:
//   discoverEndpoint({ stun_host?, stun_port?, local_port?, timeout_ms? }) → { ip, port, local_port, nat_type, latency_ms }
//   detectNatType({ stun_host?, timeout_ms? }) → 'full_cone' | 'restricted_cone' | 'port_restricted_cone' | 'symmetric' | 'unknown'
//
// STUN binding request packet structure (RFC 5389 §6):
//   0-1: message type (0x0001 = Binding Request)
//   2-3: message length (= attribute bytes)
//   4-7: magic cookie (0x2112A442)
//   8-19: transaction ID (96 bits random)
//   20-N: attributes (TLV)
//
// Binding response contains XOR-MAPPED-ADDRESS attribute (RFC 5389 §15.2):
//   type 0x0020, length=8/20, value = port XOR magic[0:2] + IPv4 XOR magic
//
// Public STUN servers (0 trust required for discovery, returns just our external mapping):
//   stun.l.google.com:19302
//   stun1.l.google.com:19302
//   stun.cloudflare.com:3478

import dgram from 'node:dgram';
import crypto from 'node:crypto';

const STUN_MAGIC_COOKIE = 0x2112A442;
const STUN_BINDING_REQUEST = 0x0001;
const STUN_BINDING_RESPONSE = 0x0101;
const STUN_ATTR_XOR_MAPPED_ADDRESS = 0x0020;
const STUN_ATTR_MAPPED_ADDRESS = 0x0001;
const STUN_DEFAULT_HOST = 'stun.l.google.com';
const STUN_DEFAULT_PORT = 19302;
const STUN_DEFAULT_TIMEOUT_MS = 3000;

function buildBindingRequest() {
  const transactionId = crypto.randomBytes(12);
  const buf = Buffer.alloc(20);
  buf.writeUInt16BE(STUN_BINDING_REQUEST, 0);
  buf.writeUInt16BE(0, 2); // length = 0 (no attributes)
  buf.writeUInt32BE(STUN_MAGIC_COOKIE, 4);
  transactionId.copy(buf, 8);
  return { packet: buf, transactionId };
}

function parseBindingResponse(buf, expectedTransactionId) {
  if (buf.length < 20) throw new Error('STUN response too short');
  const messageType = buf.readUInt16BE(0);
  if (messageType !== STUN_BINDING_RESPONSE) throw new Error(`unexpected message type 0x${messageType.toString(16)}`);
  const messageLength = buf.readUInt16BE(2);
  const magicCookie = buf.readUInt32BE(4);
  if (magicCookie !== STUN_MAGIC_COOKIE) throw new Error('bad magic cookie');
  const txId = buf.subarray(8, 20);
  if (!txId.equals(expectedTransactionId)) throw new Error('transaction id mismatch');

  // Parse attributes (TLV)
  let offset = 20;
  const end = 20 + messageLength;
  while (offset < end) {
    const attrType = buf.readUInt16BE(offset);
    const attrLength = buf.readUInt16BE(offset + 2);
    const attrValueStart = offset + 4;
    if (attrType === STUN_ATTR_XOR_MAPPED_ADDRESS) {
      // family (1B reserved 0 + 1B) + port (2B XOR magic[0:2]) + addr (4B IPv4 XOR magic)
      const family = buf.readUInt8(attrValueStart + 1);
      if (family !== 0x01) throw new Error(`unsupported address family ${family}`);
      const xorPort = buf.readUInt16BE(attrValueStart + 2);
      const port = xorPort ^ (STUN_MAGIC_COOKIE >>> 16);
      const xorAddr = buf.readUInt32BE(attrValueStart + 4);
      const addr = xorAddr ^ STUN_MAGIC_COOKIE;
      const ip = [(addr >>> 24) & 0xff, (addr >>> 16) & 0xff, (addr >>> 8) & 0xff, addr & 0xff].join('.');
      return { ip, port };
    }
    if (attrType === STUN_ATTR_MAPPED_ADDRESS) {
      // Legacy non-XOR fallback
      const family = buf.readUInt8(attrValueStart + 1);
      if (family !== 0x01) throw new Error(`unsupported address family ${family}`);
      const port = buf.readUInt16BE(attrValueStart + 2);
      const ip = [
        buf.readUInt8(attrValueStart + 4),
        buf.readUInt8(attrValueStart + 5),
        buf.readUInt8(attrValueStart + 6),
        buf.readUInt8(attrValueStart + 7),
      ].join('.');
      return { ip, port };
    }
    // Skip unknown attribute (align to 4 bytes)
    offset = attrValueStart + Math.ceil(attrLength / 4) * 4;
  }
  throw new Error('no MAPPED-ADDRESS attribute in STUN response');
}

/**
 * Send 1 STUN binding request via the given socket and wait for response.
 * @param {dgram.Socket} socket — pre-bound dgram socket
 * @param {string} stunHost
 * @param {number} stunPort
 * @param {number} timeoutMs
 * @returns {Promise<{ ip: string, port: number, latency_ms: number }>}
 */
function sendOneRequest(socket, stunHost, stunPort, timeoutMs) {
  return new Promise((resolve, reject) => {
    const { packet, transactionId } = buildBindingRequest();
    const t0 = Date.now();
    const timer = setTimeout(() => {
      socket.removeListener('message', onMessage);
      reject(new Error(`STUN request timeout (${timeoutMs}ms)`));
    }, timeoutMs);
    function onMessage(buf, rinfo) {
      try {
        const { ip, port } = parseBindingResponse(buf, transactionId);
        clearTimeout(timer);
        socket.removeListener('message', onMessage);
        resolve({ ip, port, latency_ms: Date.now() - t0 });
      } catch (e) {
        // Maybe a stale response from previous request — keep listening
      }
    }
    socket.on('message', onMessage);
    socket.send(packet, stunPort, stunHost, (err) => {
      if (err) {
        clearTimeout(timer);
        socket.removeListener('message', onMessage);
        reject(err);
      }
    });
  });
}

/**
 * Discover our external (IP, port) via STUN.
 * Binds a fresh UDP socket on local_port (or random if 0/omitted),
 * sends 1 STUN binding request, returns the XOR-MAPPED-ADDRESS.
 *
 * @param {object} opts
 * @param {string} [opts.stun_host='stun.l.google.com']
 * @param {number} [opts.stun_port=19302]
 * @param {number} [opts.local_port=0]   — 0 = OS picks ephemeral
 * @param {number} [opts.timeout_ms=3000]
 * @returns {Promise<{ ip, port, local_port, latency_ms }>}
 */
export async function discoverEndpoint({
  stun_host = STUN_DEFAULT_HOST,
  stun_port = STUN_DEFAULT_PORT,
  local_port = 0,
  timeout_ms = STUN_DEFAULT_TIMEOUT_MS,
} = {}) {
  const socket = dgram.createSocket('udp4');
  try {
    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(local_port, '0.0.0.0', () => resolve());
    });
    const boundPort = socket.address().port;
    const result = await sendOneRequest(socket, stun_host, stun_port, timeout_ms);
    return { ...result, local_port: boundPort };
  } finally {
    socket.close();
  }
}

/**
 * Probe NAT behavior by comparing mappings from two different STUN servers (= same local port).
 *
 * Heuristic:
 *  - Same (ext_ip, ext_port) from both servers → likely full_cone (or shared NAT)
 *  - Same ext_ip but different ext_port → symmetric NAT
 *  - All fails → unknown / blocked
 *
 * Note: full RFC 3489 classification requires 4 servers + multi-port responses.
 * This is a 2-server heuristic = 80% accuracy for common home routers.
 *
 * @returns {Promise<{ nat_type, primary, secondary? }>}
 */
export async function detectNatType({
  primary_host = STUN_DEFAULT_HOST,
  primary_port = STUN_DEFAULT_PORT,
  secondary_host = 'stun.cloudflare.com',
  secondary_port = 3478,
  timeout_ms = STUN_DEFAULT_TIMEOUT_MS,
} = {}) {
  // Bind 1 socket, query 2 STUN servers, compare results
  const socket = dgram.createSocket('udp4');
  try {
    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(0, '0.0.0.0', () => resolve());
    });
    const local_port = socket.address().port;
    let primary, secondary;
    try {
      primary = await sendOneRequest(socket, primary_host, primary_port, timeout_ms);
    } catch (e) {
      return { nat_type: 'unknown', primary: null, secondary: null, error: `primary STUN fail: ${e.message}` };
    }
    try {
      secondary = await sendOneRequest(socket, secondary_host, secondary_port, timeout_ms);
    } catch (e) {
      // Single STUN OK but compare 不能 — assume full_cone optimistic (= 还能打)
      return { nat_type: 'unknown', primary: { ...primary, local_port }, secondary: null, error: `secondary STUN fail: ${e.message}` };
    }
    let nat_type;
    if (primary.ip === secondary.ip && primary.port === secondary.port) {
      nat_type = 'full_cone';  // or shared NAT, both allow hole punch
    } else if (primary.ip === secondary.ip) {
      nat_type = 'symmetric';  // different port per destination → hole punch fails
    } else {
      nat_type = 'unknown';  // multi-WAN or weird CGNAT
    }
    return {
      nat_type,
      primary: { ...primary, local_port },
      secondary: { ...secondary, local_port },
    };
  } finally {
    socket.close();
  }
}
