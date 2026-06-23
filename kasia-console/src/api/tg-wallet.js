// TG custodial wallet API (Owner 钦定 2026-06-23, 紧急·零门槛玩). KANet-UI lead, Bettor 逐行审.
// ⚠ CUSTODIAL: node holds the encrypted mnemonic (打破现有 0-custody). Owner 钦定换零门槛 UX;
//   mitigation = testnet-only + "真钱用自己钱包" warning (唯一 mitigation, 守口径). Bot stays 0-key —
//   it only calls these Console endpoints; the key/decrypt/sign all live here (持 CONSOLE_ENCRYPTION_KEY).
//
// Security (Bettor 审):
//   - mnemonic encrypted via crypto.js encrypt = aes-256-gcm, KEY fail-loud (getKey throws if env missing,
//     NO fallback — NOT bettor.js:595 hardcoded fallback). Per-call unique 12B IV + gcm authTag.
//   - mnemonic returned ONCE at create (display-once); NO endpoint ever returns it again (no /export).
//   - entropy: wallet.generateMnemonic = kaspa-wasm Mnemonic.random (CSPRNG, not Math.random).
//   - /send (transfer) NOT here yet — pending Bettor Q3 decision on the custodial KAS signing path
//     (Console kaspa-wasm Generator vs privkey-relay). Build after Q3.
import { sqlite } from '../db/client.js';
import { encrypt } from '../services/crypto.js';
import { generateMnemonic, addressFromMnemonic } from '../services/wallet.js';
import { getWorkingRpc } from '../services/rpc-health.js';

const NETWORK = 'testnet-12';

// Balance by address — reuse the relay.js:329 pattern (getWorkingRpc + RpcClient.getUtxosByAddresses).
// Works for any address (custodial wallets have no relay process). Returns KAS number, or null on RPC fail.
async function balanceKasForAddress(address) {
  const { url: rpcUrl } = await getWorkingRpc();
  if (!rpcUrl) return null;
  const kaspa = await import('kaspa-wasm');
  const { RpcClient, Encoding, Address } = kaspa;
  const rpc = new RpcClient({ url: rpcUrl, encoding: Encoding.Borsh, networkId: NETWORK });
  try {
    await Promise.race([rpc.connect({}), new Promise((_, rej) => setTimeout(() => rej(new Error('RPC connect timeout')), 3000))]);
    const { entries } = await rpc.getUtxosByAddresses([new Address(address)]);
    const sompi = (entries || []).reduce((s, e) => s + BigInt(e.amount ?? e.utxoEntry?.amount ?? 0), 0n);
    return Number(sompi) / 1e8;
  } catch { return null; }
  finally { try { await rpc.disconnect(); } catch {} }
}

export async function registerTgWalletRoutes(fastify) {
  // POST /api/tg-wallet/create { tg_user_id } — generate custodial wallet if none; return address +
  //   mnemonic ONCE (display-once). Idempotent: if wallet exists, returns address only (never re-reveals mnemonic).
  fastify.post('/api/tg-wallet/create', async (request, reply) => {
    const tgUser = String(request.body?.tg_user_id || '').trim();
    if (!tgUser) return reply.code(400).send({ ok: false, error: 'tg_user_id required' });

    const existing = sqlite.prepare('SELECT kaspa_address FROM tg_custodial_wallets WHERE tg_user_id = ?').get(tgUser);
    if (existing) return reply.send({ ok: true, created: false, exists: true, address: existing.kaspa_address });

    // generate (CSPRNG) → derive address → encrypt mnemonic (fail-loud; throws if CONSOLE_ENCRYPTION_KEY unset)
    let mnemonic, address, mnemonicEnc;
    try {
      mnemonic = generateMnemonic();
      address = addressFromMnemonic(mnemonic, NETWORK);
      mnemonicEnc = encrypt(mnemonic); // aes-256-gcm, unique IV + tag; throws if KEY missing (no fallback)
    } catch (e) {
      return reply.code(500).send({ ok: false, error: 'wallet gen/encrypt failed: ' + e.message });
    }
    const now = new Date().toISOString();
    try {
      sqlite.prepare(`INSERT INTO tg_custodial_wallets (tg_user_id, kaspa_address, mnemonic_encrypted, network, created_at, updated_at)
        VALUES (?,?,?,?,?,?)`).run(tgUser, address, mnemonicEnc, NETWORK, now, now);
    } catch (e) {
      // UNIQUE(address) collision (astronomically unlikely) or race — fail safe, don't leak mnemonic on error
      return reply.code(500).send({ ok: false, error: 'store failed: ' + e.message });
    }
    // mnemonic returned ONCE here; never persisted plaintext, never returned again.
    return reply.send({ ok: true, created: true, address, mnemonic, network: NETWORK });
  });

  // GET /api/tg-wallet/:tg_user_id — wallet address + balance (NEVER mnemonic).
  fastify.get('/api/tg-wallet/:tg_user_id', async (request, reply) => {
    const tgUser = String(request.params.tg_user_id || '').trim();
    const w = sqlite.prepare('SELECT kaspa_address, network, created_at FROM tg_custodial_wallets WHERE tg_user_id = ?').get(tgUser);
    if (!w) return reply.send({ ok: true, exists: false });
    const balance = await balanceKasForAddress(w.kaspa_address);
    return reply.send({ ok: true, exists: true, address: w.kaspa_address, network: w.network, balance_kas: balance, created_at: w.created_at });
  });

  // NOTE: POST /:tg_user_id/send (custodial transfer) intentionally NOT implemented yet — blocked on
  // Bettor Q3 (signing path). Will add with: kaspa Address parse validation + owner auth (only this
  // tg_user) + amount/balance check + just-in-time decrypt → sign → broadcast → discard plaintext.
}
