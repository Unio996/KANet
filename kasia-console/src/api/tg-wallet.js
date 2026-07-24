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
// Path C (Bettor 拍): /send 经 relay 唯一链上出口转账。
// 🔴 Codex MSG-124 真相校正 (K-13 一并了): 曾经 `|| process.env.FAUCET_RELAY_ID` 隐式 fallback
// 到 faucet relay (身份完全不同的 relay) — 同款 capability.js:30/relay.js:75 footgun 家族，
// 忘设 CUSTODIAL_RELAY_ID 会静默把 custodial_transfer 转发给错的 relay 处理，非本地址预期的
// relay 身份。改为显式必设，未设直接 503 fail-closed (同 capability.js:30 那次修法)。
const CUSTODIAL_RELAY_ID = () => process.env.CUSTODIAL_RELAY_ID || null;

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

  // GET /api/tg-wallet/:tg_user_id/diagnose — M0c-1 Path B pilot Codex MSG-125 MUST-FIX C:
  //   no-broadcast live-Console decrypt proof, 充值前跑 (runbook §3.6 重排后的验证步骤之一)。
  //   证明"live Console 用真实运行时 process.env.CONSOLE_ENCRYPTION_KEY + 真实 DB 连接" 能解密这行 —
  //   非 helper 自己 encrypt 自己 decrypt 那种内部一致性、也非人工核对 8-hex 指纹那种 sanity check。
  //   ok:true 语义 = decrypt 成功 **且** derive 出的地址 == 行里存的 kaspa_address 逐字符相同
  //   (证加密 mnemonic 内部一致 + live Console 确实能解出预期的那把钥匙, 非只是"decrypt 没抛异常")。
  //   绝不返回/log mnemonic、privkey、加密 blob 本身——只返 { ok, address }。
  fastify.get('/api/tg-wallet/:tg_user_id/diagnose', AUTH, async (request, reply) => {
    const tgUser = String(request.params.tg_user_id || '').trim();
    if (!tgUser) return reply.code(400).send({ ok: false, error: 'tg_user_id required' });

    const w = sqlite.prepare('SELECT kaspa_address, mnemonic_encrypted, network FROM tg_custodial_wallets WHERE tg_user_id = ?').get(tgUser);
    if (!w) return reply.code(404).send({ ok: false, error: '钱包不存在' });

    let derivedAddress;
    try {
      const mnemonic = decrypt(w.mnemonic_encrypted); // 用 live 进程实际的 CONSOLE_ENCRYPTION_KEY, 非 helper 传入的
      derivedAddress = addressFromMnemonic(mnemonic, w.network || NETWORK);
    } catch (e) {
      // 不 echo 任何密钥材料; 只报诊断失败这个事实。
      return reply.code(500).send({ ok: false, error: 'live decrypt 诊断失败 (检查 CONSOLE_ENCRYPTION_KEY 是否与写入这行时用的是同一把)' });
    }
    const match = derivedAddress === w.kaspa_address;
    return reply.send({ ok: match, address: match ? derivedAddress : undefined,
      error: match ? undefined : 'live decrypt 成功但 derive 出的地址与行内记录的 kaspa_address 不一致' });
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
    if (!relayId) return reply.code(503).send({ ok: false, error: '转账暂不可用 (CUSTODIAL_RELAY_ID 未配)' });

    const w = sqlite.prepare('SELECT kaspa_address, mnemonic_encrypted, network, access_mode FROM tg_custodial_wallets WHERE tg_user_id = ?').get(tgUser);
    if (!w) return reply.code(404).send({ ok: false, error: '你还没有钱包' });

    // M0c-1 Path B pilot 隔离 (Codex MSG-124 MUST-FIX E, MSG-125 结构性收紧): 这条 legacy 路径
    // 只挂 AUTH (shared ingest secret)，完全绕过 grant/source-scope/armed 闸/capability 网关 —
    // pilot 钱包一旦充值，持 ingest secret + pilot tg_user_id 者即可经这条路径把钱转走。
    // 🔴 MSG-125 修正：MSG-124 版本只靠 process.env.PILOT_WALLET_ADDRESSES env allowlist，
    // Codex 判这会 fail-open（env 缺失/畸形/重启未加载时隔离静默失效）。权威判据改成 durable
    // 的 `access_mode` 列（`tg_custodial_wallets` migrate.js v193，J2 落码）——pilot 钱包建行时
    // (`m0c1-pilot-custodial-insert.mjs`) 就把这一行显式设成 `'capability_only'`，从诞生那一刻
    // 起是权威标记，不依赖任何后续步骤/任何 env 变量存在。env allowlist 保留作 defense-in-depth
    // 早拒层（两层都查，任一命中即拒，不是"降级到只查一层"）。
    if (w.access_mode === 'capability_only') {
      return reply.code(403).send({ ok: false, error: 'M0c-1 pilot 隔离钱包 (access_mode=capability_only): 本 legacy 路径已 fail-closed 禁用，请走 capability 网关 custodial_transfer 路径' });
    }
    const pilotIsolationSet = new Set((process.env.PILOT_WALLET_ADDRESSES || '').split(',').map((s) => s.trim()).filter(Boolean));
    if (pilotIsolationSet.has(w.kaspa_address)) {
      return reply.code(403).send({ ok: false, error: 'M0c-1 pilot 隔离钱包 (env allowlist): 本 legacy 路径已 fail-closed 禁用，请走 capability 网关 custodial_transfer 路径' });
    }

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
      }, undefined, 'legacy-unmigrated');
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
