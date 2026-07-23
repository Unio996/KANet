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
import { encrypt, decrypt } from '../services/crypto.js';
import { generateMnemonic, addressFromMnemonic, privKeyHexFromMnemonic } from '../services/wallet.js';
import { getWorkingRpc } from '../services/rpc-health.js';
import { verifyIngestRequest } from '../services/ingest-auth.js';

// KANet-UI 2026-06-23 (Bettor BLOCKING 修): 三端点全加 x-ingest-secret 鉴权 preHandler。
//   tg_user_id 取自 URL = 攻击者可控, "只载该 tg_user 钱包" 不是鉴权; 若 HOST=0.0.0.0 则任何人可
//   POST /:victim/send 抽干任意托管钱包。bot console-api.mjs 早就发 x-ingest-secret, 加上即通;
//   缺/错 secret → 401 fail-closed = 安全靠密钥非靠网络绑定 (defense-in-depth)。同 admin.js:20/chat.js:398。
const AUTH = { preHandler: [async (req, rep) => { await verifyIngestRequest(req, rep); }] };

const NETWORK = 'testnet-12';
// Path C (Bettor 拍): /send 经 relay 唯一链上出口转账。优先 CUSTODIAL_RELAY_ID, 退 FAUCET_RELAY_ID
// (faucet relay 是现成 localhost relay, 有 RPC+wasm; key 是 Console 传入, relay 自己 key 不参与)。
const CUSTODIAL_RELAY_ID = () => process.env.CUSTODIAL_RELAY_ID || process.env.FAUCET_RELAY_ID || null;

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
  fastify.post('/api/tg-wallet/create', AUTH, async (request, reply) => {
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
  fastify.get('/api/tg-wallet/:tg_user_id', AUTH, async (request, reply) => {
    const tgUser = String(request.params.tg_user_id || '').trim();
    const w = sqlite.prepare('SELECT kaspa_address, network, created_at FROM tg_custodial_wallets WHERE tg_user_id = ?').get(tgUser);
    if (!w) return reply.send({ ok: true, exists: false });
    const balance = await balanceKasForAddress(w.kaspa_address);
    return reply.send({ ok: true, exists: true, address: w.kaspa_address, network: w.network, balance_kas: balance, created_at: w.created_at });
  });

  // POST /api/tg-wallet/:tg_user_id/send { to, amount_kas } — custodial transfer via Path C
  //   (Bettor 拍·Owner 钦定). Console (持 CONSOLE_ENCRYPTION_KEY = 托管人) decrypts mnemonic just-in-time,
  //   derives privkey, hands it to the relay over localhost IPC (custodial_transfer); the relay is the
  //   ONLY chain exit and reuses transaction.mjs (KIP-9/broadcast/ledger). privkey 用完即弃, 绝不 log/回传。
  // Auth: the bot calls with tg_user_id = ctx.from.id (the Telegram-authenticated caller), and we only
  //   ever load THAT tg_user's wallet → a user can only send from their own wallet (Bettor a 属主授权).
  fastify.post('/api/tg-wallet/:tg_user_id/send', AUTH, async (request, reply) => {
    const tgUser = String(request.params.tg_user_id || '').trim();
    const to = String(request.body?.to || '').trim();
    const amountKas = Number(request.body?.amount_kas);
    if (!tgUser) return reply.code(400).send({ ok: false, error: 'tg_user_id required' });
    if (!to || !/^kaspa(test)?:[a-z0-9]+$/.test(to)) return reply.code(400).send({ ok: false, error: '收款地址非法 (须 kaspatest:...)' });
    if (!Number.isFinite(amountKas) || amountKas <= 0) return reply.code(400).send({ ok: false, error: '金额非法' });

    const relayId = CUSTODIAL_RELAY_ID();
    if (!relayId) return reply.code(503).send({ ok: false, error: '转账暂不可用 (CUSTODIAL_RELAY_ID/FAUCET_RELAY_ID 未配)' });

    const w = sqlite.prepare('SELECT kaspa_address, mnemonic_encrypted, network FROM tg_custodial_wallets WHERE tg_user_id = ?').get(tgUser);
    if (!w) return reply.code(404).send({ ok: false, error: '你还没有钱包' });
    if (to === w.kaspa_address) return reply.code(400).send({ ok: false, error: '不能转给自己 (收款地址=你的钱包地址)' });

    // 事前余额校验 (NO TX 前堵空转): need amount + fee headroom (~0.05 KAS 覆盖 KIP-9 floor)。
    const balance = await balanceKasForAddress(w.kaspa_address);
    if (balance == null) return reply.code(503).send({ ok: false, error: 'RPC 暂不可用, 稍后再试' });
    if (balance < amountKas + 0.05) {
      return reply.code(400).send({ ok: false, error: `余额不足 (有 ${balance} KAS, 需 ~${(amountKas + 0.05).toFixed(2)} KAS 含手续费)` });
    }

    // just-in-time: decrypt mnemonic → derive privkey → IPC to relay → discard. NEVER log/return privkey.
    let privKeyHex;
    try {
      const mnemonic = decrypt(w.mnemonic_encrypted); // crypto.js, fail-loud if KEY missing
      privKeyHex = privKeyHexFromMnemonic(mnemonic);
    } catch (e) {
      return reply.code(500).send({ ok: false, error: 'wallet decrypt failed (检查 CONSOLE_ENCRYPTION_KEY)' });
    }
    try {
      const { sendCommandAsync } = await import('../services/relay-manager.js');
      const result = await sendCommandAsync(relayId, {
        type: 'custodial_transfer',
        privkeyHex: privKeyHex,
        target: to,
        amount: amountKas.toFixed(8),
        fromAddress: w.kaspa_address,
        network: w.network || NETWORK,
      }, undefined, 'app');
      const txId = result?.txId || null;
      if (!txId) return reply.code(503).send({ ok: false, error: '转账未上链 (relay 无 txId, 可能 RPC down)' });
      return reply.send({ ok: true, txId, amount_kas: amountKas, to, from: w.kaspa_address });
    } catch (e) {
      // 不 echo privKeyHex; 通用错误。
      return reply.code(500).send({ ok: false, error: 'transfer failed: ' + (e?.message || 'unknown') });
    } finally {
      privKeyHex = null; // discard plaintext key reference
    }
  });
}
