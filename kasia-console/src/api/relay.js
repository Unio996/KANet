import { listRelayNodes, createRelayNode, updateRelayNode, deleteRelayNode, getRelayMnemonic, getRelayNode } from '../data/settings/relay-nodes.js';
import { listAdapterNodes, getAdapterNode, createAdapterNode } from '../data/settings/adapter-nodes.js';
import { getConfig } from '../data/settings/configs.js';
import { parseLang, getT, isRtl, LANG_NAMES } from '../i18n/index.js';
import { addressFromMnemonic } from '../services/wallet.js';
import { nowIso } from '../lib/time.js';
import { registerMindSkills } from '../data/settings/skills.js';
import { sendCommand, sendCommandAsync, getRelayRpcState } from '../services/relay-manager.js';
import { sqlite } from '../db/client.js';
import { Mnemonic } from 'kaspa-wasm';
import { getWorkingRpc } from '../services/rpc-health.js';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { startRelay, stopRelay } from '../services/relay-manager.js';
import { getMind } from '../services/mind-manager.js';
import { ethers } from 'ethers';
import { encrypt, decrypt } from '../services/crypto.js';
import { verifyIngestRequest } from '../services/ingest-auth.js';
import { randomUUID } from 'crypto';
import {
  CHAIN_META,
  EVM_CHAINS as REGISTRY_EVM_CHAINS,
  SUPPORTED_CHAINS as REGISTRY_SUPPORTED_CHAINS,
  STABLECOINS as REGISTRY_STABLECOINS,
  EVM_RPC_URLS as REGISTRY_EVM_RPC_URLS,
  withFallbackRpc,
  getExplorerAddressUrl,
  getExplorerTxUrl,
  getPublicMeta,
  isEvmChain,
} from '../services/chains.js';
import { recordChainEvent } from '../services/chain-event.js';

const KANET_ROOT = process.env.KANET_ROOT || 'D:/Anthropic';
const MINDS_DIR = `${KANET_ROOT}/agent-mind/minds`;
const SKILLS_DIR = `${KANET_ROOT}/agent-mind/src/skills`;
const CONSOLE_PORT = process.env.PORT || '3100';

export async function registerRelayRoutes(fastify) {
  fastify.get('/relays', async (request, reply) => {
    const lang = parseLang(request.headers.cookie);
    const t = getT(lang);
    const dir = isRtl(lang) ? 'rtl' : 'ltr';
    const langs = LANG_NAMES;
    const relays = listRelayNodes();
    const adapters = listAdapterNodes();
    const rpcUrl = await getConfig('rpc_url') || '';
    const rpcMode = await getConfig('rpc_mode') || 'local';

    // Load Mind config for each relay from DB (no longer reads static files)
    for (const r of relays) {
      const mindCfg = sqlite.prepare(
        'SELECT vision, style FROM relay_nodes WHERE id = ?'
      ).get(r.id);
      r.mind_vision = mindCfg?.vision || null;
      r.mind_style = mindCfg?.style || null;
    }

    return reply.view('relays', { relays, adapters, title: 'Relay 管理', t, lang, dir, langs, rpcUrl, rpcMode });
  });

  fastify.post('/relays', async (request, reply) => {
    const { name, mnemonic, address, network, adapter_node_id, poll_ms } = request.body;
    if (!name?.trim()) return reply.redirect('/relays');
    const mnemonicClean = mnemonic?.trim() || null;
    const net = network || 'mainnet';
    // Auto-derive address from mnemonic if not provided
    let resolvedAddress = address?.trim() || null;
    if (mnemonicClean && !resolvedAddress) {
      try { resolvedAddress = addressFromMnemonic(mnemonicClean, net); } catch {}
    }
    const newId = createRelayNode({
      name: name.trim(),
      mnemonic: mnemonicClean,
      address: resolvedAddress,
      network: net,
      adapterNodeId: adapter_node_id || null,
      pollMs: parseInt(poll_ms) || 2000,
    });

    // Auto-setup for new account: mind skills + mind config in DB
    try {
      await registerMindSkills(SKILLS_DIR);

      // Write Mind config to DB (no longer writes config.json)
      const defaultPrinciples = ['Be authentic and helpful', 'Learn from every conversation', 'Grow through experience'];
      sqlite.prepare(`
        UPDATE relay_nodes SET principles_json = ?, style = ?, evolution_interval_hours = ?, proactive_interval_minutes = ?
        WHERE id = ?
      `).run(JSON.stringify(defaultPrinciples), 'friendly, direct', 24, 60, newId);

      // Still create minds/ directory for state files (memory.json, intent.json, reflections.json)
      const agentName = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
      const mindDir = join(MINDS_DIR, agentName);
      await mkdir(mindDir, { recursive: true });

      console.log(`[relay] Auto-setup: mind skills + DB config for "${name.trim()}"`);
    } catch (err) {
      console.log(`[relay] Auto-setup warning: ${err.message}`);
    }

    return reply.redirect('/relays');
  });

  // r281 (Bettor 5/30, Owner P0) — import an existing raw kaspa private key as a Console relay.
  // 用于无助记词只有裸 privkey 的地址 (e.g. Owner 已绑 TG 的 qrymjvc). 创建后跟普通 relay 一样: 分配
  // adapter 即自动启动, balance/transfer 等操作 endpoint 均可用 (走 KASPA_PRIVKEY env 路径).
  // J2 r93 reviewer audit: 必须 verifyIngestRequest (跟 chat/send 等敏感写端点对称, 防任何能访问 Console
  // 的人注入私钥创建可动钱的 relay).
  fastify.post('/api/relay/import-privkey', { preHandler: async (request, reply) => { await verifyIngestRequest(request, reply); } }, async (request, reply) => {
    const { name, privkey, network } = request.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) return reply.code(400).send({ ok: false, error: 'name required' });
    if (!privkey || typeof privkey !== 'string') return reply.code(400).send({ ok: false, error: 'privkey required (64 hex chars)' });
    const cleanPriv = privkey.startsWith('0x') ? privkey.slice(2) : privkey;
    if (!/^[0-9a-fA-F]{64}$/.test(cleanPriv)) return reply.code(400).send({ ok: false, error: 'privkey must be 64 hex chars (32 bytes)' });
    const net = network || 'testnet-12';
    let address;
    try {
      const kaspa = await import('kaspa-wasm');
      const sk = new kaspa.PrivateKey(cleanPriv);
      const netType = (net === 'mainnet') ? kaspa.NetworkType.Mainnet : kaspa.NetworkType.Testnet;
      address = sk.toKeypair().toAddress(netType).toString();
    } catch (e) {
      return reply.code(400).send({ ok: false, error: `address derive fail: ${e.message}` });
    }
    // dedup: same address already in relay_nodes
    const existing = sqlite.prepare('SELECT id, name FROM relay_nodes WHERE address = ?').get(address);
    if (existing) return reply.code(409).send({ ok: false, error: `address already registered as relay "${existing.name}" (id=${existing.id})`, existing_id: existing.id });
    const newId = createRelayNode({ name: name.trim(), privkey: cleanPriv, address, network: net, adapterNodeId: null, pollMs: 2000 });
    console.log(`[relay] r281 imported privkey-relay "${name.trim()}" → ${address}`);
    return reply.send({ ok: true, id: newId, name: name.trim(), address, network: net });
  });

  fastify.post('/relays/:id/delete', async (request, reply) => {
    deleteRelayNode(request.params.id);
    return reply.redirect('/relays');
  });

  fastify.post('/relays/:id/assign', async (request, reply) => {
    const { adapter_node_id } = request.body;
    updateRelayNode(request.params.id, { adapterNodeId: adapter_node_id || null });
    // Auto-start relay if adapter assigned and relay has address + (mnemonic OR privkey, r281).
    if (adapter_node_id) {
      const relay = getRelayNode(request.params.id);
      if (relay?.address && (relay?.mnemonic_encrypted || relay?.privkey_encrypted)) {
        const result = await startRelay(request.params.id);
        if (result.ok) console.log(`[relay-manager] Auto-started ${relay.name} relay after adapter assign`);
      }
    }
    return reply.redirect('/relays');
  });

  // Restart a single relay process — Bug 1 path C (per Owner 5/2 approve, T1-bugfix-handshake)
  // Plumb stopRelay + startRelay sequential. Use case: re-process catch-up after rpc-listener.mjs hot-fix.
  fastify.post('/api/relay/:id/restart', async (request, reply) => {
    const id = request.params.id;
    const relay = getRelayNode(id);
    if (!relay) return reply.code(404).send({ error: 'Relay not found' });
    const stopResult = await stopRelay(id);
    // stopResult.ok=false reason='not_running' is OK — proceed to start
    const startResult = await startRelay(id);
    if (!startResult.ok) {
      return reply.code(503).send({ error: 'restart failed', stopResult, startResult });
    }
    console.log(`[relay-manager] Restarted ${relay.name} relay (PID ${startResult.pid})`);
    return reply.send({ ok: true, stopResult, startResult });
  });

  // T-J2-2026-05-11 Phase 2 η.2 (Owner 5/11 钦定 + NWT #16 propose):
  // GET /api/relay/:id — relay 详情含 role + is_dex_broker + is_service
  // POST /api/relay/:id/role — UI 改 role + 同步 legacy field (is_dex_broker/is_service) + ROLE_SKILL_ALLOWED auto-enforce
  fastify.get('/api/relay/:id', async (request, reply) => {
    const relay = sqlite.prepare(`
      SELECT id, name, address, network, role, is_dex_broker, is_service, focus,
             evolution_interval_hours, proactive_interval_minutes, created_at, updated_at
      FROM relay_nodes WHERE id = ?
    `).get(request.params.id);
    if (!relay) return reply.code(404).send({ error: 'relay_not_found' });
    return reply.send({ relay });
  });

  // T-J2-2026-05-11 Phase 2 η.2 + η.2-fix (J1 #114 catch): predictor skill 实际 names
  // (Bettor 5/8-5/10 ship): bettor / prediction_sense / onboard_polymarket。
  // 虚构 'polymarket-trader/sports-tracker' fix per J1 #114 grep verify。
  const VALID_ROLES = ['broker', 'trader', 'predictor', 'general', 'user'];
  const ROLE_SKILL_ALLOWED_LOCAL = {
    broker: ['matcher', 'order-book', 'cex-bridge'],
    trader: ['matcher', 'order-book'],
    user: ['wallet-query'],
    predictor: ['bettor', 'prediction_sense', 'onboard_polymarket'],
    general: [],
  };
  const TRADING_SKILLS_LOCAL = new Set([
    'matcher', 'order-book', 'cex-bridge', 'bettor', 'prediction_sense', 'onboard_polymarket', 'wallet-query',
  ]);

  fastify.post('/api/relay/:id/role', async (request, reply) => {
    const { role: newRole } = request.body || {};
    if (!newRole || !VALID_ROLES.includes(newRole)) {
      return reply.code(400).send({ error: 'invalid_role', message: `role 必 ∈ [${VALID_ROLES.join(', ')}]` });
    }
    const relay = sqlite.prepare(`SELECT id, name, role, is_dex_broker, is_service, is_oracle, address, roles_json FROM relay_nodes WHERE id = ?`).get(request.params.id);
    if (!relay) return reply.code(404).send({ error: 'relay_not_found' });

    // KANet-UI 2026-06-11 gateway register 守门 (role=broker 时):
    // ① broker/oracle 互斥【双向】(Bettor r600 + NWT r64, Area 1.4 角色分离). 此前单向
    //    (oracle-enroll bettor.js:2153 拒 is_dex_broker, 无 gateway 侧拒 is_oracle).
    // ② 收款址 P2PK 约束 (Bettor r604 + J1 #141 + NWT r66 determinism 收口上游守门):
    //    settler always-pk-derive (J2 ca5e8658) 保跨节点同地址不炸; 这里保 broker_pk 派生地址==意图址,
    //    非 P2PK (P2SH/multisig) 地址 round-trip 后 ≠ 原址 → fee 到错处 → 拒注册 gateway.
    if (newRole === 'broker') {
      if (relay.is_oracle === 1) {
        return reply.code(403).send({ error: 'role_conflict', message: 'relay 已是 oracle (is_oracle=1) — broker/oracle 互斥 (Area 1.4 角色分离). 先退出 oracle (unstake) 再注册 gateway.' });
      }
      try {
        const kaspa = await import('kaspa-wasm');
        const addr = relay.address;
        const net = (addr || '').startsWith('kaspatest:') ? 'testnet-12' : 'mainnet';
        const pk = kaspa.XOnlyPublicKey.fromAddress(new kaspa.Address(addr)).toString();
        const roundTrip = new kaspa.XOnlyPublicKey(pk).toAddress(net).toString();
        if (roundTrip !== addr) {
          return reply.code(400).send({ error: 'address_not_p2pk', message: 'relay 收款址非 P2PK (round-trip 不回原址) — gateway 须 P2PK 地址保跨节点 settle fee 派生到对处 (Bettor r604/J1 #141).' });
        }
      } catch (e) {
        return reply.code(400).send({ error: 'address_validation_fail', message: `gateway 收款址 P2PK 校验失败: ${e?.message || e}` });
      }
    }

    const oldRole = relay.role;
    if (oldRole === newRole) {
      return reply.send({ ok: true, role: newRole, unchanged: true });
    }

    // S-A prev_role 还原 (Bettor r638/r647): gateway register 存原角色, revoke 还原 (非硬 general).
    let effectiveRole = newRole;
    let rolesJsonUpdate = relay.roles_json;
    if (newRole === 'broker' && oldRole !== 'broker') {
      // ① 实切换到 broker: 存原角色 (oldRole==broker 已 early-return, 不覆盖原 prev)
      rolesJsonUpdate = JSON.stringify({ prev_role: oldRole });
    } else if (oldRole === 'broker' && newRole === 'general') {
      // ② revoke (revokeGateway 传 general): 还原 prev_role; 无/非法 → general default
      let prev = null;
      try { prev = JSON.parse(relay.roles_json || '{}').prev_role; } catch {}
      effectiveRole = (prev && VALID_ROLES.includes(prev)) ? prev : 'general';
      rolesJsonUpdate = null;  // 清 prev_role
    }

    // legacy field 同步 (role authoritative, legacy mirror) — 按 effectiveRole
    const newIsDexBroker = effectiveRole === 'broker' ? 1 : 0;
    const newIsService = effectiveRole === 'broker' ? 1 : 0;

    const now = new Date().toISOString();
    sqlite.prepare(`
      UPDATE relay_nodes
      SET role = ?, is_dex_broker = ?, is_service = ?, roles_json = ?, updated_at = ?
      WHERE id = ?
    `).run(effectiveRole, newIsDexBroker, newIsService, rolesJsonUpdate, now, request.params.id);

    // ROLE_SKILL_ALLOWED auto-enforce: 不兼容 active trading skill auto-disable (按 effectiveRole)
    const allowed = ROLE_SKILL_ALLOWED_LOCAL[effectiveRole] || [];
    const allowedSet = new Set(allowed);
    const activeSkills = sqlite.prepare(`
      SELECT id, name FROM skills WHERE relay_node_id = ? AND status = 'active'
    `).all(request.params.id);
    const disabled_skills = [];
    const disableStmt = sqlite.prepare(`UPDATE skills SET status='disabled', updated_at=? WHERE id=?`);
    for (const s of activeSkills) {
      if (TRADING_SKILLS_LOCAL.has(s.name) && !allowedSet.has(s.name)) {
        disableStmt.run(now, s.id);
        disabled_skills.push(s.name);
      }
    }

    // S-A (Bettor r638): auto re-enable effectiveRole 允许但当前 disabled 的 skill.
    // 修 register→revoke 丢 skill 的不对称 (旧码只 disable 不 re-enable): revoke 还原原角色后
    // 原角色 skill 集自动恢复; register 也补齐新角色允许的 skill。
    const disabledMatch = sqlite.prepare(`
      SELECT id, name FROM skills WHERE relay_node_id = ? AND status = 'disabled' AND name IN (${allowed.map(() => '?').join(',') || "''"})
    `).all(request.params.id, ...allowed);
    const reEnableStmt = sqlite.prepare(`UPDATE skills SET status='active', updated_at=? WHERE id=?`);
    for (const s of disabledMatch) { reEnableStmt.run(now, s.id); }
    const suggested_skills = disabledMatch.map(r => r.name);  // 已 auto re-enable, 返回供 UI 告知

    console.log(`[relay role] ${relay.name}: '${oldRole}' → '${effectiveRole}'${effectiveRole !== newRole ? ` (revoke→prev_role, requested='${newRole}')` : ''}, is_dex_broker=${newIsDexBroker}, disabled=${disabled_skills.length}, re_enabled=${suggested_skills.length}`);

    return reply.send({
      ok: true,
      role: effectiveRole,            // S-A: revoke 还原 prev_role (非 requested newRole)
      requested_role: newRole,
      old_role: oldRole,
      legacy_sync: { is_dex_broker: newIsDexBroker, is_service: newIsService },
      side_effects: { disabled_skills, re_enabled_skills: suggested_skills },
    });
  });

  // Balance query — auto-selects best available RPC node
  // GET /api/relay/:id/active-peers — addresses this agent has a live handshake with
  // Used by Explore page to disable "send handshake" button for already-connected peers.
  fastify.get('/api/relay/:id/active-peers', async (request, reply) => {
    const relay = getRelayNode(request.params.id);
    if (!relay?.address) return reply.send({ peers: [] });
    const rows = sqlite.prepare(`
      SELECT DISTINCT peer_address FROM relation_states
      WHERE local_address = ?
        AND (handshake_observed_at IS NOT NULL
          OR status IN ('accepted','confirmed','active'))
    `).all(relay.address);
    return reply.send({ peers: rows.map(r => r.peer_address) });
  });

  fastify.get('/api/relay/:id/balance', async (request, reply) => {
    const relay = getRelayNode(request.params.id);
    if (!relay?.address) return reply.send({ balance: null });

    // Try RPC node (auto-discovered)
    const { url: rpcUrl } = await getWorkingRpc();
    if (rpcUrl) {
      try {
        const kaspa = await import('kaspa-wasm');
        const { RpcClient, Encoding, Address } = kaspa;
        const rpc = new RpcClient({ url: rpcUrl, encoding: Encoding.Borsh, networkId: relay.network || 'mainnet' });
        await Promise.race([
          rpc.connect({}),
          new Promise((_, rej) => setTimeout(() => rej(new Error('RPC connect timeout')), 3000)),
        ]);
        const { entries } = await rpc.getUtxosByAddresses([new Address(relay.address)]);
        await rpc.disconnect();
        const sompi = (entries || []).reduce((sum, e) => sum + e.amount, 0n);
        const kas = Number(sompi) / 1e8;
        return reply.send({ balance: Math.round(kas * 1000) / 1000 });
      } catch {}
    }

    // Fallback: external REST API
    try {
      const res = await fetch(`https://api.kaspa.org/addresses/${relay.address}/balance`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        return reply.send({ balance: Math.round((data.balance || 0) / 1e8 * 1000) / 1000 });
      }
    } catch {}
    return reply.send({ balance: null });
  });

  // T-J2-2026-05-12 #4 — relay child RPC state probe (UI 健康检测 P0, NWT spec sub #4/7).
  // 跟 /api/config/rpc-status 区别: 该 endpoint 测 console daemon 自己 RpcClient (misleading).
  // 本 endpoint 走 IPC 拿 relay child 内部 _rpc state (真反映 broker/scout 等子进程 RPC 连接状态).
  fastify.get('/api/relay/:id/rpc-state', async (request, reply) => {
    const relay = getRelayNode(request.params.id);
    if (!relay) return reply.code(404).send({ ok: false, error: 'relay_not_found' });
    const result = await getRelayRpcState(request.params.id);
    return reply.send({ relayId: request.params.id, relayName: relay.name, ...result });
  });

  // Phase 4a Sub 6 (Bettor r235) — GET /api/relay/:id/pubkey
  // Return relay x-only secp256k1 pubkey (= SS contract oracle ctor param param + cross-host verification).
  // Derive from kaspa address (= deterministic, no privkey exposure).
  fastify.get('/api/relay/:id/pubkey', async (request, reply) => {
    const relay = getRelayNode(request.params.id);
    if (!relay) return reply.code(404).send({ ok: false, error: 'relay_not_found' });
    if (!relay.address) return reply.code(400).send({ ok: false, error: 'relay has no kaspa address' });
    try {
      const kaspa = await import('kaspa-wasm');
      const xpk = kaspa.XOnlyPublicKey.fromAddress(new kaspa.Address(relay.address));
      const xOnlyHex = xpk.toString();
      return reply.send({ ok: true, relay_id: relay.id, relay_name: relay.name, address: relay.address, x_only_pubkey: xOnlyHex });
    } catch (e) {
      return reply.code(500).send({ ok: false, error: `x-only pubkey derive fail: ${e.message}` });
    }
  });

  // T-J2-2026-05-12 #4 — system-wide RPC overview (聚合全 relay state, header indicator + dashboard 用).
  fastify.get('/api/system/rpc-overview', async (_request, reply) => {
    const relays = listRelayNodes();
    const results = await Promise.all(
      relays.map(async (r) => {
        const result = await getRelayRpcState(r.id);
        return { id: r.id, name: r.name, address: r.address, ...result };
      }),
    );
    const summary = {
      total: results.length,
      connected: results.filter((r) => r.ok && r.state?.connected).length,
      reconnecting: results.filter((r) => r.ok && r.state?.reconnecting).length,
      unreachable: results.filter((r) => !r.ok).length,
    };
    return reply.send({ summary, relays: results });
  });

  // Split UTXOs for concurrent sends
  fastify.post('/api/relay/:id/split-utxos', async (request, reply) => {
    try {
      const { splitUtxos } = await import('../services/utxo-splitter.js');
      const result = await splitUtxos(request.params.id);
      return reply.send(result);
    } catch (err) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Transfer KAS via Relay
  fastify.post('/api/relay/:id/transfer', async (request, reply) => {
    const relay = getRelayNode(request.params.id);
    if (!relay?.address) return reply.code(404).send({ error: 'Account not found' });

    const { to, amount } = request.body || {};
    if (!to?.trim()) return reply.code(400).send({ error: 'Recipient address (to) is required' });
    const amountKas = parseFloat(amount);
    if (!amountKas || amountKas <= 0) return reply.code(400).send({ error: 'Amount must be > 0' });

    try {
      const result = await sendCommandAsync(request.params.id, { type: 'transfer', target: to.trim(), amount: amountKas.toFixed(8) });
      if (!result) return reply.code(503).send({ error: 'Relay not running' });
      if (result.error) return reply.code(400).send({ error: result.error });
      return reply.send({ ok: true, txId: result.txId, fee: result.fee });
    } catch (err) {
      return reply.code(500).send({ error: err.message || 'Transfer failed' });
    }
  });

  // Reveal mnemonic (local UI only)
  fastify.get('/relays/:id/mnemonic', async (request, reply) => {
    const mnemonic = getRelayMnemonic(request.params.id);
    return reply.send({ mnemonic: mnemonic || null });
  });

  // ── Multi-chain Wallet Management (agent_wallets table) ─────

  // Chain metadata sourced from central registry (src/services/chains.js).
  // Add new chains or stablecoin variants there — this file no longer duplicates it.
  const SUPPORTED_CHAINS = REGISTRY_SUPPORTED_CHAINS;
  const EVM_CHAINS = REGISTRY_EVM_CHAINS;
  const EVM_RPC_URLS = REGISTRY_EVM_RPC_URLS; // legacy single-URL map; new code uses withFallbackRpc
  const STABLECOINS = REGISTRY_STABLECOINS;
  const USDT_CONTRACTS = Object.fromEntries(
    Object.entries(STABLECOINS)
      .filter(([, coins]) => coins.usdt)
      .map(([chain, coins]) => [chain, coins.usdt])
  );

  // Generate wallet by chain
  async function generateWallet(chain) {
    if (EVM_CHAINS.includes(chain)) {
      const wallet = ethers.Wallet.createRandom();
      return { address: wallet.address, privateKey: wallet.privateKey };
    }
    if (chain === 'sol') {
      const { Keypair } = await import('@solana/web3.js');
      const kp = Keypair.generate();
      const bs58 = (await import('bs58')).default;
      return { address: kp.publicKey.toBase58(), privateKey: bs58.encode(kp.secretKey) };
    }
    if (chain === 'tron') {
      // TRON uses same secp256k1 as EVM, just different address encoding
      const wallet = ethers.Wallet.createRandom();
      const pubKeyBytes = ethers.getBytes(ethers.computeAddress(wallet.publicKey));
      // TRON address = base58check(0x41 + keccak256(pubkey)[12:32])
      const { keccak256, getBytes, toBeHex } = ethers;
      const addressHex = '41' + wallet.address.slice(2); // replace 0x with 41
      const bs58 = (await import('bs58')).default;
      const { createHash } = await import('crypto');
      const addrBytes = Buffer.from(addressHex, 'hex');
      const hash1 = createHash('sha256').update(addrBytes).digest();
      const hash2 = createHash('sha256').update(hash1).digest();
      const checksum = hash2.slice(0, 4);
      const tronAddress = bs58.encode(Buffer.concat([addrBytes, checksum]));
      return { address: tronAddress, privateKey: wallet.privateKey };
    }
    throw new Error(`Unsupported chain: ${chain}`);
  }

  // Import wallet from private key
  async function importWalletFromKey(chain, privateKey) {
    if (EVM_CHAINS.includes(chain)) {
      const wallet = new ethers.Wallet(privateKey);
      return { address: wallet.address };
    }
    if (chain === 'sol') {
      const { Keypair } = await import('@solana/web3.js');
      const bs58 = (await import('bs58')).default;
      const secretKey = bs58.decode(privateKey);
      const kp = Keypair.fromSecretKey(secretKey);
      return { address: kp.publicKey.toBase58() };
    }
    if (chain === 'tron') {
      const wallet = new ethers.Wallet(privateKey);
      const bs58 = (await import('bs58')).default;
      const { createHash } = await import('crypto');
      const addressHex = '41' + wallet.address.slice(2);
      const addrBytes = Buffer.from(addressHex, 'hex');
      const hash1 = createHash('sha256').update(addrBytes).digest();
      const hash2 = createHash('sha256').update(hash1).digest();
      const tronAddress = bs58.encode(Buffer.concat([addrBytes, hash2.slice(0, 4)]));
      return { address: tronAddress };
    }
    throw new Error(`Unsupported chain: ${chain}`);
  }

  async function getEvmBalances(chain, address) {
    const coins = STABLECOINS[chain];
    if (!isEvmChain(chain) || !coins) return { usdt: null, usdc: null, native: null };
    try {
      return await withFallbackRpc(chain, async (provider) => {
        const abi = ['function balanceOf(address) view returns (uint256)'];
        const usdtContract = coins.usdt ? new ethers.Contract(coins.usdt.address, abi, provider) : null;
        const usdcContract = coins.usdc ? new ethers.Contract(coins.usdc.address, abi, provider) : null;
        const extras = (coins.usdcExtras || []).map(e => ({
          contract: new ethers.Contract(e.address, abi, provider),
          decimals: e.decimals,
        }));

        const [usdtBal, usdcBal, nativeBal, ...extraBals] = await Promise.all([
          usdtContract ? usdtContract.balanceOf(address) : Promise.resolve(null),
          usdcContract ? usdcContract.balanceOf(address) : Promise.resolve(null),
          provider.getBalance(address),
          ...extras.map(e => e.contract.balanceOf(address)),
        ]);

        let usdcTotal = 0;
        if (usdcBal != null && coins.usdc) {
          usdcTotal += parseFloat(ethers.formatUnits(usdcBal, coins.usdc.decimals));
        }
        extraBals.forEach((bal, i) => {
          if (bal != null) usdcTotal += parseFloat(ethers.formatUnits(bal, extras[i].decimals));
        });

        return {
          usdt: usdtBal != null && coins.usdt ? parseFloat(ethers.formatUnits(usdtBal, coins.usdt.decimals)) : 0,
          usdc: usdcTotal,
          native: parseFloat(ethers.formatEther(nativeBal)),
        };
      }, { timeoutMs: 4000 });
    } catch {
      return { usdt: null, usdc: null, native: null };
    }
  }

  async function getKasBalance(relayId) {
    const relay = getRelayNode(relayId);
    if (!relay?.address) return null;
    const { url: rpcUrl } = await getWorkingRpc();
    if (rpcUrl) {
      try {
        const kaspa = await import('kaspa-wasm');
        const { RpcClient, Encoding, Address } = kaspa;
        const rpc = new RpcClient({ url: rpcUrl, encoding: Encoding.Borsh, networkId: relay.network || 'mainnet' });
        await Promise.race([
          rpc.connect({}),
          new Promise((_, rej) => setTimeout(() => rej(new Error('RPC connect timeout')), 3000)),
        ]);
        const { entries } = await rpc.getUtxosByAddresses([new Address(relay.address)]);
        await rpc.disconnect();
        const sompi = (entries || []).reduce((sum, e) => sum + e.amount, 0n);
        return Math.round(Number(sompi) / 1e8 * 1000) / 1000;
      } catch {}
    }
    try {
      const res = await fetch(`https://api.kaspa.org/addresses/${relay.address}/balance`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        return Math.round((data.balance || 0) / 1e8 * 1000) / 1000;
      }
    } catch {}
    return null;
  }

  // GET /api/relay/:id/wallets — all wallets for this agent (kaspa + multi-chain)
  fastify.get('/api/relay/:id/wallets', async (request, reply) => {
    const relay = getRelayNode(request.params.id);
    if (!relay) return reply.code(404).send({ error: 'Relay not found' });
    const relayId = request.params.id;

    // Kaspa wallet from relay_nodes
    const kasBalance = await getKasBalance(relayId);
    const kaspa = {
      address: relay.address || null,
      balance: kasBalance,
      hasMnemonic: !!relay.mnemonic_encrypted,
      hasPrivateKey: !!relay.privkey_encrypted,  // r281 privkey-backed relays (Bettor 168965a)
    };

    // Multi-chain wallets from agent_wallets
    const wallets = sqlite.prepare(
      'SELECT id, chain, address, label, is_default, privkey_encrypted FROM agent_wallets WHERE relay_node_id = ? ORDER BY chain, is_default DESC, created_at'
    ).all(relayId);

    // Fetch balances: EVM fast (3s), SOL/TRON non-blocking (2s hard timeout, fallback 0)
    const balancePromises = wallets.map(async (w) => {
      try {
        if (EVM_CHAINS.includes(w.chain)) {
          return await getEvmBalances(w.chain, w.address); // 内部 5s timeout
        }
        // SOL/TRON: 2s 硬超时，超时返回 0 不阻塞
        if (w.chain === 'sol') {
          return await Promise.race([
            (async () => {
              const { Connection, PublicKey } = await import('@solana/web3.js');
              const conn = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
              const usdtMint = new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
              const [accounts, solBal] = await Promise.all([
                conn.getParsedTokenAccountsByOwner(new PublicKey(w.address), { mint: usdtMint }),
                conn.getBalance(new PublicKey(w.address)),
              ]);
              return { usdt: accounts?.value?.[0]?.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0, native: (solBal || 0) / 1e9 };
            })(),
            new Promise(r => setTimeout(() => r({ usdt: 0, native: 0 }), 2000)),
          ]);
        }
        if (w.chain === 'tron') {
          return await Promise.race([
            (async () => {
              const TronWebModule = await import('tronweb');
              const TronWeb = TronWebModule.default || TronWebModule;
              const tw = new TronWeb({ fullHost: 'https://api.trongrid.io' });
              const [trc20Bal, trxBal] = await Promise.all([
                tw.contract().at('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t').then(c => c.balanceOf(w.address).call()),
                tw.trx.getBalance(w.address),
              ]);
              return { usdt: trc20Bal ? Number(trc20Bal) / 1e6 : 0, native: (trxBal || 0) / 1e6 };
            })(),
            new Promise(r => setTimeout(() => r({ usdt: 0, native: 0 }), 2000)),
          ]);
        }
      } catch {}
      return { usdt: 0, usdc: 0, native: 0 };
    });
    const balances = await Promise.all(balancePromises);

    const chains = wallets.map((w, i) => ({
      id: w.id,
      chain: w.chain,
      address: w.address,
      label: w.label || '',
      usdtBalance: balances[i]?.usdt ?? null,
      usdcBalance: balances[i]?.usdc ?? null,
      nativeBalance: balances[i]?.native ?? null,
      isDefault: !!w.is_default,
      hasPrivateKey: !!w.privkey_encrypted,
    }));

    return reply.send({ kaspa, chains });
  });

  // POST /api/relay/:id/wallets — create a new wallet (any supported chain)
  fastify.post('/api/relay/:id/wallets', async (request, reply) => {
    const relay = getRelayNode(request.params.id);
    if (!relay) return reply.code(404).send({ error: 'Relay not found' });
    const relayId = request.params.id;
    const { chain, label } = request.body || {};

    if (!chain || !SUPPORTED_CHAINS.includes(chain)) {
      return reply.code(400).send({ error: `Unsupported chain. Use: ${SUPPORTED_CHAINS.join(', ')}` });
    }

    try {
      const wallet = await generateWallet(chain);
      const now = nowIso();

      // Check if this is the first wallet for this chain (make it default)
      const existingCount = sqlite.prepare(
        'SELECT COUNT(*) as cnt FROM agent_wallets WHERE relay_node_id = ? AND chain = ?'
      ).get(relayId, chain).cnt;
      const isDefault = existingCount === 0 ? 1 : 0;

      const id = randomUUID();
      sqlite.prepare(`
        INSERT INTO agent_wallets (id, relay_node_id, chain, address, label, privkey_encrypted, privkey_hint, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, relayId, chain, wallet.address, label || '', encrypt(wallet.privateKey), wallet.address.slice(0, 6) + '...' + wallet.address.slice(-4), isDefault, now, now);

      console.log(`[wallet] Created ${chain} wallet for ${relay.name}: ${wallet.address}`);
      return reply.send({ ok: true, id, chain, address: wallet.address });
    } catch (err) {
      console.error(`[wallet] Failed to create ${chain} wallet: ${err.message}`);
      return reply.code(500).send({ error: err.message });
    }
  });

  // POST /api/relay/:id/wallets/import — import existing wallet by private key
  fastify.post('/api/relay/:id/wallets/import', async (request, reply) => {
    const relay = getRelayNode(request.params.id);
    if (!relay) return reply.code(404).send({ error: 'Relay not found' });
    const relayId = request.params.id;
    const { chain, privateKey, label } = request.body || {};

    if (!chain || !SUPPORTED_CHAINS.includes(chain)) return reply.code(400).send({ error: `Unsupported chain. Use: ${SUPPORTED_CHAINS.join(', ')}` });
    if (!privateKey) return reply.code(400).send({ error: 'privateKey required' });

    try {
      const wallet = await importWalletFromKey(chain, privateKey);

      // Check if address already exists
      const existing = sqlite.prepare('SELECT id FROM agent_wallets WHERE chain = ? AND address = ?').get(chain, wallet.address);
      if (existing) return reply.code(409).send({ error: `${chain} wallet ${wallet.address} already exists` });

      const now = nowIso();
      const existingCount = sqlite.prepare(
        'SELECT COUNT(*) as cnt FROM agent_wallets WHERE relay_node_id = ? AND chain = ?'
      ).get(relayId, chain).cnt;
      const isDefault = existingCount === 0 ? 1 : 0;

      const id = randomUUID();
      sqlite.prepare(`
        INSERT INTO agent_wallets (id, relay_node_id, chain, address, label, privkey_encrypted, privkey_hint, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, relayId, chain, wallet.address, label || '', encrypt(privateKey), wallet.address.slice(0, 6) + '...' + wallet.address.slice(-4), isDefault, now, now);

      console.log(`[wallet] Imported ${chain} wallet for ${relay.name}: ${wallet.address}`);
      return reply.send({ ok: true, id, chain, address: wallet.address });
    } catch (err) {
      return reply.code(400).send({ error: 'Invalid private key: ' + err.message });
    }
  });

  // GET /api/relay/:id/wallets/:walletId/privkey — get decrypted private key
  fastify.get('/api/relay/:id/wallets/:walletId/privkey', async (request, reply) => {
    const relay = getRelayNode(request.params.id);
    if (!relay) return reply.code(404).send({ error: 'Relay not found' });

    const wallet = sqlite.prepare(
      'SELECT privkey_encrypted FROM agent_wallets WHERE id = ? AND relay_node_id = ?'
    ).get(request.params.walletId, request.params.id);
    if (!wallet) return reply.code(404).send({ error: 'Wallet not found' });
    if (!wallet.privkey_encrypted) return reply.code(404).send({ error: 'No private key stored' });

    try {
      const privateKey = decrypt(wallet.privkey_encrypted);
      return reply.send({ privateKey });
    } catch (err) {
      return reply.code(500).send({ error: 'Failed to decrypt private key' });
    }
  });

  // GET /api/relay/:id/wallets/:walletId/balance — USDT + native token balance (BNB/ETH/SOL/TRON)
  fastify.get('/api/relay/:id/wallets/:walletId/balance', async (request, reply) => {
    const wallet = sqlite.prepare(
      'SELECT chain, address FROM agent_wallets WHERE id = ? AND relay_node_id = ?'
    ).get(request.params.walletId, request.params.id);
    if (!wallet) return reply.code(404).send({ error: 'Wallet not found' });

    const timeout = (p, ms = 5000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);

    try {
      let usdt = null, native = null;

      if (EVM_RPC_URLS[wallet.chain]) {
        // BNB / ETH — reuse getEvmBalances which fetches USDT+USDC+native in one call
        const balances = await getEvmBalances(wallet.chain, wallet.address);
        usdt = balances.usdt;
        native = balances.native;

      } else if (wallet.chain === 'sol') {
        // Solana
        const { Connection, PublicKey } = await import('@solana/web3.js');
        const conn = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
        const pubkey = new PublicKey(wallet.address);
        const bal = await timeout(conn.getBalance(pubkey));
        native = bal / 1e9; // lamports → SOL
        // USDT on Solana (SPL token Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB)
        try {
          const { TOKEN_PROGRAM_ID } = await import('@solana/spl-token');
          const usdtMint = new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
          const accounts = await timeout(conn.getParsedTokenAccountsByOwner(pubkey, { mint: usdtMint }));
          usdt = accounts.value?.[0]?.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
        } catch { usdt = 0; }

      } else if (wallet.chain === 'tron') {
        // TRON
        const { TronWeb } = await import('tronweb');
        const tronWeb = new TronWeb({ fullHost: 'https://api.trongrid.io' });
        const bal = await timeout(tronWeb.trx.getBalance(wallet.address));
        native = bal / 1e6; // sun → TRX
        // USDT on TRON (TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t)
        try {
          const contract = await tronWeb.contract().at('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
          const usdtBal = await timeout(contract.balanceOf(wallet.address).call());
          usdt = Number(usdtBal) / 1e6;
        } catch { usdt = 0; }
      }

      return reply.send({ usdt, native, chain: wallet.chain });
    } catch {
      return reply.send({ usdt: null, native: null, chain: wallet.chain });
    }
  });

  // PUT /api/relay/:id/wallets/:walletId — update label / set as default
  fastify.put('/api/relay/:id/wallets/:walletId', async (request, reply) => {
    const relay = getRelayNode(request.params.id);
    if (!relay) return reply.code(404).send({ error: 'Relay not found' });
    const relayId = request.params.id;
    const walletId = request.params.walletId;

    const wallet = sqlite.prepare('SELECT id, chain FROM agent_wallets WHERE id = ? AND relay_node_id = ?').get(walletId, relayId);
    if (!wallet) return reply.code(404).send({ error: 'Wallet not found' });

    const { label, isDefault } = request.body || {};
    const now = nowIso();
    const fields = [];
    const vals = [];

    if (label !== undefined) { fields.push('label = ?'); vals.push(label); }
    if (isDefault !== undefined) {
      if (isDefault) {
        // Clear default for all wallets of same chain first
        sqlite.prepare('UPDATE agent_wallets SET is_default = 0, updated_at = ? WHERE relay_node_id = ? AND chain = ?').run(now, relayId, wallet.chain);
      }
      fields.push('is_default = ?');
      vals.push(isDefault ? 1 : 0);
    }

    if (fields.length === 0) return reply.code(400).send({ error: 'No fields to update' });

    fields.push('updated_at = ?');
    vals.push(now);
    vals.push(walletId);
    sqlite.prepare(`UPDATE agent_wallets SET ${fields.join(', ')} WHERE id = ?`).run(...vals);

    return reply.send({ ok: true });
  });

  // DELETE /api/relay/:id/wallets/:walletId — delete a wallet
  fastify.delete('/api/relay/:id/wallets/:walletId', async (request, reply) => {
    const relay = getRelayNode(request.params.id);
    if (!relay) return reply.code(404).send({ error: 'Relay not found' });

    const wallet = sqlite.prepare('SELECT id, chain, address FROM agent_wallets WHERE id = ? AND relay_node_id = ?').get(request.params.walletId, request.params.id);
    if (!wallet) return reply.code(404).send({ error: 'Wallet not found' });

    sqlite.prepare('DELETE FROM agent_wallets WHERE id = ?').run(wallet.id);
    console.log(`[wallet] Deleted ${wallet.chain} wallet ${wallet.address} for ${relay.name}`);
    return reply.send({ ok: true });
  });

  // POST /api/relay/:id/wallets/:walletId/withdraw — withdraw from EVM wallet
  fastify.post('/api/relay/:id/wallets/:walletId/withdraw', async (request, reply) => {
    const relay = getRelayNode(request.params.id);
    if (!relay) return reply.code(404).send({ error: 'Relay not found' });

    const wallet = sqlite.prepare(
      'SELECT id, chain, address, privkey_encrypted FROM agent_wallets WHERE id = ? AND relay_node_id = ?'
    ).get(request.params.walletId, request.params.id);
    if (!wallet) return reply.code(404).send({ error: 'Wallet not found' });
    if (!wallet.privkey_encrypted) return reply.code(400).send({ error: 'No private key — cannot withdraw' });

    const { to, amount } = request.body || {};
    if (!to || !amount) return reply.code(400).send({ error: 'to and amount required' });

    let provider;
    try {
      const privateKey = decrypt(wallet.privkey_encrypted);

      if (EVM_CHAINS.includes(wallet.chain)) {
        const rpcUrl = EVM_RPC_URLS[wallet.chain];
        const usdt = USDT_CONTRACTS[wallet.chain];
        if (!rpcUrl || !usdt) return reply.code(400).send({ error: 'Chain not configured for withdraw' });

        provider = new ethers.JsonRpcProvider(rpcUrl);
        const signer = new ethers.Wallet(privateKey, provider);
        const contract = new ethers.Contract(usdt.address, [
          'function transfer(address to, uint256 amount) returns (bool)',
        ], signer);

        const amountWei = ethers.parseUnits(String(amount), usdt.decimals);
        const tx = await contract.transfer(to, amountWei);
        console.log(`[wallet] Withdraw ${amount} USDT from ${wallet.chain}:${wallet.address} → ${to} TX: ${tx.hash}`);
        return reply.send({ ok: true, txHash: tx.hash, chain: wallet.chain });
      }

      // SOL/TRON withdraw not implemented yet
      return reply.code(400).send({ error: `${wallet.chain} withdraw not implemented yet` });
    } catch (err) {
      console.error(`[wallet] Withdraw failed: ${err.message}`);
      return reply.code(500).send({ error: err.message });
    } finally {
      try { provider?.destroy?.(); } catch {}
    }
  });

  // ── GET /api/chains/meta — public chain registry snapshot for the frontend ──
  // Frontend fetches this once to know explorer URLs, native symbols, chain IDs,
  // stablecoin addresses — everything needed to render and operate on wallets.
  fastify.get('/api/chains/meta', async (_req, reply) => {
    return reply.send({ ok: true, chains: getPublicMeta() });
  });

  // ── POST /api/relay/:id/wallets/:walletId/send — generic EVM transfer ──
  // Supports native / usdt / usdc. Body: { asset: 'native'|'usdt'|'usdc', amount, to }
  //
  // Guardrails (money code, fail-closed):
  //   1. Destination must be a valid checksum EVM address (ethers.getAddress throws on invalid)
  //   2. Amount must be > 0 and parseable
  //   3. Pre-check balance before broadcasting — return error on insufficient funds
  //   4. RPC failure → no state mutation, just error
  //   5. All TXs logged to console for audit
  fastify.post('/api/relay/:id/wallets/:walletId/send', async (request, reply) => {
    const relay = getRelayNode(request.params.id);
    if (!relay) return reply.code(404).send({ error: 'Relay not found' });

    const wallet = sqlite.prepare(
      'SELECT id, chain, address, privkey_encrypted FROM agent_wallets WHERE id = ? AND relay_node_id = ?'
    ).get(request.params.walletId, request.params.id);
    if (!wallet) return reply.code(404).send({ error: 'Wallet not found' });
    if (!wallet.privkey_encrypted) return reply.code(400).send({ error: 'No private key — cannot send' });

    const { asset, amount, to } = request.body || {};
    if (!asset || !amount || !to) return reply.code(400).send({ error: 'asset, amount, to required' });

    const assetKey = String(asset).toLowerCase();
    if (!['native', 'usdt', 'usdc'].includes(assetKey)) {
      return reply.code(400).send({ error: `asset must be native | usdt | usdc (got ${asset})` });
    }

    // Guardrail 1: positive amount (chain-agnostic)
    const amountNum = parseFloat(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return reply.code(400).send({ error: 'amount must be a positive number' });
    }

    const toRaw = String(to).trim();

    // ── EVM chains (bnb/eth/polygon/arbitrum/optimism/avalanche/base) ──
    if (isEvmChain(wallet.chain)) {
      // Checksum address
      let toAddr;
      try { toAddr = ethers.getAddress(toRaw); }
      catch { return reply.code(400).send({ error: `Invalid EVM destination address: ${toRaw}` }); }

      const coins = STABLECOINS[wallet.chain] || {};
      if (assetKey !== 'native' && !coins[assetKey]) {
        return reply.code(400).send({ error: `${assetKey.toUpperCase()} not configured on ${wallet.chain}` });
      }

      try {
        const privateKey = decrypt(wallet.privkey_encrypted);
        const result = await withFallbackRpc(wallet.chain, async (provider) => {
          const signer = new ethers.Wallet(privateKey, provider);
          if (assetKey === 'native') {
            const balance = await provider.getBalance(signer.address);
            const amountWei = ethers.parseEther(String(amountNum));
            if (balance < amountWei) {
              throw new Error(`Insufficient ${CHAIN_META[wallet.chain].nativeSymbol} balance`);
            }
            const tx = await signer.sendTransaction({ to: toAddr, value: amountWei });
            return { txHash: tx.hash };
          }
          const token = coins[assetKey];
          const erc20 = new ethers.Contract(
            token.address,
            ['function transfer(address to, uint256 amount) returns (bool)',
             'function balanceOf(address) view returns (uint256)'],
            signer,
          );
          const amountWei = ethers.parseUnits(String(amountNum), token.decimals);
          const bal = await erc20.balanceOf(signer.address);
          if (bal < amountWei) {
            throw new Error(`Insufficient ${assetKey.toUpperCase()} balance on ${wallet.chain}`);
          }
          const tx = await erc20.transfer(toAddr, amountWei);
          return { txHash: tx.hash };
        }, { timeoutMs: 10000 });

        console.log(`[wallet/send] ${wallet.chain} ${amountNum} ${assetKey} ${wallet.address} → ${toAddr} TX: ${result.txHash}`);
        return reply.send({
          ok: true, txHash: result.txHash, chain: wallet.chain, asset: assetKey,
          amount: amountNum, to: toAddr,
          explorerUrl: getExplorerTxUrl(wallet.chain, result.txHash),
        });
      } catch (err) {
        console.error(`[wallet/send] EVM failed: ${err.message}`);
        return reply.code(500).send({ error: err.message });
      }
    }

    // ── Solana ──
    if (wallet.chain === 'sol') {
      // Solana base58 address: 32-44 chars, no 0/O/I/l
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(toRaw)) {
        return reply.code(400).send({ error: `Invalid Solana destination address: ${toRaw}` });
      }
      try {
        if (assetKey === 'native') {
          const { transferSolNative } = await import('../services/sol-transfer.js');
          const result = await transferSolNative(wallet.privkey_encrypted, toRaw, amountNum);
          if (!result.ok) return reply.code(500).send({ error: result.error });
          console.log(`[wallet/send] sol ${amountNum} SOL ${wallet.address} → ${toRaw} TX: ${result.txHash}`);
          return reply.send({
            ok: true, txHash: result.txHash, chain: 'sol', asset: 'native',
            amount: amountNum, to: toRaw,
            explorerUrl: getExplorerTxUrl('sol', result.txHash),
          });
        }
        const { transferSPL } = await import('../services/sol-transfer.js');
        const result = await transferSPL(wallet.privkey_encrypted, toRaw, amountNum, assetKey.toUpperCase());
        if (!result.ok) return reply.code(500).send({ error: result.error });
        console.log(`[wallet/send] sol ${amountNum} ${assetKey} ${wallet.address} → ${toRaw} TX: ${result.txHash}`);
        return reply.send({
          ok: true, txHash: result.txHash, chain: 'sol', asset: assetKey,
          amount: amountNum, to: toRaw,
          explorerUrl: getExplorerTxUrl('sol', result.txHash),
        });
      } catch (err) {
        console.error(`[wallet/send] sol failed: ${err.message}`);
        return reply.code(500).send({ error: err.message });
      }
    }

    // ── TRON ──
    if (wallet.chain === 'tron') {
      // TRON base58check: starts with T, total 34 chars
      if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(toRaw)) {
        return reply.code(400).send({ error: `Invalid TRON destination address: ${toRaw}` });
      }
      try {
        if (assetKey === 'native') {
          const { transferTronNative } = await import('../services/tron-transfer.js');
          const result = await transferTronNative(wallet.privkey_encrypted, toRaw, amountNum);
          if (!result.ok) return reply.code(500).send({ error: result.error });
          console.log(`[wallet/send] tron ${amountNum} TRX ${wallet.address} → ${toRaw} TX: ${result.txHash}`);
          return reply.send({
            ok: true, txHash: result.txHash, chain: 'tron', asset: 'native',
            amount: amountNum, to: toRaw,
            explorerUrl: getExplorerTxUrl('tron', result.txHash),
          });
        }
        const { transferTRC20 } = await import('../services/tron-transfer.js');
        const result = await transferTRC20(wallet.privkey_encrypted, toRaw, amountNum, assetKey.toUpperCase());
        if (!result.ok) return reply.code(500).send({ error: result.error });
        console.log(`[wallet/send] tron ${amountNum} ${assetKey} ${wallet.address} → ${toRaw} TX: ${result.txHash}`);
        return reply.send({
          ok: true, txHash: result.txHash, chain: 'tron', asset: assetKey,
          amount: amountNum, to: toRaw,
          explorerUrl: getExplorerTxUrl('tron', result.txHash),
        });
      } catch (err) {
        console.error(`[wallet/send] tron failed: ${err.message}`);
        return reply.code(500).send({ error: err.message });
      }
    }

    return reply.code(400).send({ error: `Send not supported on chain: ${wallet.chain}` });
  });

  // POST /api/relay/:id/wallets/:walletId/swap — swap between tokens on same chain (Uniswap V3)
  fastify.post('/api/relay/:id/wallets/:walletId/swap', async (request, reply) => {
    const relay = getRelayNode(request.params.id);
    if (!relay) return reply.code(404).send({ error: 'Relay not found' });

    const wallet = sqlite.prepare(
      'SELECT id, chain, address, privkey_encrypted FROM agent_wallets WHERE id = ? AND relay_node_id = ?'
    ).get(request.params.walletId, request.params.id);
    if (!wallet) return reply.code(404).send({ error: 'Wallet not found' });
    if (!wallet.privkey_encrypted) return reply.code(400).send({ error: 'No private key' });
    if (!EVM_CHAINS.includes(wallet.chain)) return reply.code(400).send({ error: 'Swap only supported on EVM chains' });

    const { fromToken, toToken, amount } = request.body || {};
    if (!fromToken || !toToken || !amount) return reply.code(400).send({ error: 'fromToken, toToken, amount required' });

    // 白名单 token 对 — 只允许稳定币互换
    const SWAP_TOKENS = {
      polygon: {
        'usdc': '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',    // 原生 USDC
        'usdc.e': '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',  // bridged USDC.e
        'usdt': '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',    // USDT
      },
      bnb: {
        'usdc': '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
        'usdt': '0x55d398326f99059fF775485246999027B3197955',
      },
      eth: {
        'usdc': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        'usdt': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      },
    };
    const SWAP_ROUTERS = {
      polygon: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      bnb: '0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2',
      eth: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    };

    const tokens = SWAP_TOKENS[wallet.chain];
    const router = SWAP_ROUTERS[wallet.chain];
    if (!tokens || !router) return reply.code(400).send({ error: `Swap not configured for ${wallet.chain}` });

    const fromAddr = tokens[fromToken.toLowerCase()];
    const toAddr = tokens[toToken.toLowerCase()];
    if (!fromAddr) return reply.code(400).send({ error: `Unknown token: ${fromToken}. Available: ${Object.keys(tokens).join(', ')}` });
    if (!toAddr) return reply.code(400).send({ error: `Unknown token: ${toToken}. Available: ${Object.keys(tokens).join(', ')}` });
    if (fromAddr === toAddr) return reply.code(400).send({ error: 'Cannot swap same token' });

    let provider;
    try {
      const privateKey = decrypt(wallet.privkey_encrypted);
      const rpcUrl = wallet.chain === 'polygon' ? 'https://polygon.drpc.org' : EVM_RPC_URLS[wallet.chain];
      provider = new ethers.JsonRpcProvider(rpcUrl);
      const signer = new ethers.Wallet(privateKey, provider);

      const decimals = 6; // USDC/USDT 都是 6 位（Polygon 原生 USDC 也是 6）
      // BNB 链上 USDT/USDC 是 18 位
      const fromDecimals = wallet.chain === 'bnb' ? 18 : 6;
      const amountIn = ethers.parseUnits(String(amount), fromDecimals);

      // 1. Approve router
      const fromContract = new ethers.Contract(fromAddr, ['function approve(address,uint256) returns (bool)'], signer);
      const feeData = await provider.getFeeData();
      const gasOpts = {
        maxFeePerGas: (feeData.maxFeePerGas || 50000000000n) * 3n,
        maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas || 30000000000n) * 3n,
      };

      console.log(`[swap] Approving ${fromToken} for router on ${wallet.chain}...`);
      const approveTx = await fromContract.approve(router, amountIn, gasOpts);
      await approveTx.wait();

      // 2. Swap via Uniswap V3 exactInputSingle
      const routerContract = new ethers.Contract(router, [
        'function exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160)) external payable returns (uint256)'
      ], signer);

      const deadline = Math.floor(Date.now() / 1000) + 300;
      const amountOutMin = amountIn * 95n / 100n; // 5% slippage

      console.log(`[swap] Swapping ${amount} ${fromToken} → ${toToken} on ${wallet.chain}...`);
      const swapTx = await routerContract.exactInputSingle([
        fromAddr, toAddr, 100, // 0.01% fee tier (stablecoin)
        signer.address, deadline,
        amountIn, amountOutMin, 0,
      ], gasOpts);

      console.log(`[swap] TX: ${swapTx.hash}`);
      const receipt = await swapTx.wait();
      console.log(`[swap] Confirmed block ${receipt.blockNumber}`);

      return reply.send({ ok: true, txHash: swapTx.hash, block: receipt.blockNumber, from: fromToken, to: toToken, amount });
    } catch (err) {
      console.error(`[swap] Failed: ${err.message}`);
      return reply.code(500).send({ error: err.message });
    } finally {
      try { provider?.destroy?.(); } catch {}
    }
  });

  // POST /api/relay/:id/wallets/:walletId/bridge — Across V3 USDC 跨链
  fastify.post('/api/relay/:id/wallets/:walletId/bridge', async (request, reply) => {
    const relay = getRelayNode(request.params.id);
    if (!relay) return reply.code(404).send({ error: 'Relay not found' });

    const wallet = sqlite.prepare(
      'SELECT id, chain, address, privkey_encrypted FROM agent_wallets WHERE id = ? AND relay_node_id = ?'
    ).get(request.params.walletId, request.params.id);
    if (!wallet) return reply.code(404).send({ error: 'Wallet not found' });
    if (!wallet.privkey_encrypted) return reply.code(400).send({ error: 'No private key' });
    if (!EVM_CHAINS.includes(wallet.chain)) return reply.code(400).send({ error: 'Bridge only supported on EVM chains' });

    const { toChain, amount, recipient } = request.body || {};
    const BRIDGE_CHAINS = ['arbitrum','polygon','bnb','eth','base','optimism'];
    if (!BRIDGE_CHAINS.includes(toChain))
      return reply.code(400).send({ error: `bridge target chain must be one of: ${BRIDGE_CHAINS.join(',')}` });
    if (wallet.chain === toChain)
      return reply.code(400).send({ error: 'fromChain === toChain, use /swap instead' });
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)
      return reply.code(400).send({ error: 'amount must be a positive number' });

    try {
      const { executeBridge } = await import('../services/across-bridge.js');
      const privateKey = decrypt(wallet.privkey_encrypted);
      const result = await executeBridge(
        privateKey, wallet.chain, toChain, parseFloat(amount), recipient || wallet.address
      );
      recordChainEvent({
        txid: result.txHash,
        eventType: 'bridge_deposit',
        fromAddress: wallet.address,
        toAddress: recipient || wallet.address,
        observedBy: 'relay',
        payload: JSON.stringify({ fromChain: wallet.chain, toChain, amount: result.inputAmount, fee: result.fee }),
      });
      return reply.send(result);
    } catch (err) {
      console.error(`[bridge] Failed: ${err.message}`);
      return reply.code(500).send({ error: err.message });
    }
  });

  // Generate new mnemonic + address
  fastify.post('/relays/generate-mnemonic', async (request, reply) => {
    const { network } = request.body || {};
    const mnemonic = Mnemonic.random(12).phrase;
    const address = addressFromMnemonic(mnemonic, network || 'mainnet');
    return reply.send({ mnemonic, address });
  });

  // ── Mind Config (dynamic, replaces static config.json) ─────────

  // GET /api/relay/:id/mind-config — full Mind config from DB
  fastify.get('/api/relay/:id/mind-config', async (request, reply) => {
    const relay = sqlite.prepare(`
      SELECT r.id, r.name, r.address, r.network,
             r.vision, r.principles_json, r.style,
             r.evolution_interval_hours, r.proactive_interval_minutes,
             r.social_style, r.social_overrides, r.focus,
             a.http_port as adapter_port
      FROM relay_nodes r
      LEFT JOIN adapter_nodes a ON a.id = r.adapter_node_id
      WHERE r.id = ?
    `).get(request.params.id);
    if (!relay) return reply.code(404).send({ error: 'Relay not found' });

    const port = process.env.PORT || 3100;
    return reply.send({
      name: relay.name,
      relayNodeId: relay.id,
      address: relay.address,
      adapterUrl: relay.adapter_port ? `http://localhost:${relay.adapter_port}` : null,
      consoleUrl: `http://localhost:${port}`,
      principles: relay.principles_json ? JSON.parse(relay.principles_json) : [],
      style: relay.style || 'friendly, direct',
      vision: relay.vision || null,
      evolutionIntervalHours: relay.evolution_interval_hours || 24,
      proactiveIntervalMinutes: relay.proactive_interval_minutes || 60,
      socialStyle: relay.social_style || 'balanced',
      socialOverrides: relay.social_overrides ? JSON.parse(relay.social_overrides) : null,
      focus: relay.focus || 'balanced',
      autoHandshake: relay.social_overrides ? (JSON.parse(relay.social_overrides)?.autoHandshake === true) : false,
    });
  });

  // PUT /api/relay/:id/mind-config — update Mind config fields
  fastify.put('/api/relay/:id/mind-config', async (request, reply) => {
    const relay = getRelayNode(request.params.id);
    if (!relay) return reply.code(404).send({ error: 'Relay not found' });

    const { vision, principles, style, evolutionIntervalHours, proactiveIntervalMinutes, socialStyle, socialOverrides, focus, autoHandshake } = request.body || {};
    const now = nowIso();
    const fields = [];
    const vals = [];

    if (vision !== undefined) { fields.push('vision = ?'); vals.push(vision); }
    if (principles !== undefined) { fields.push('principles_json = ?'); vals.push(JSON.stringify(principles)); }
    if (style !== undefined) { fields.push('style = ?'); vals.push(style); }
    if (evolutionIntervalHours !== undefined) { fields.push('evolution_interval_hours = ?'); vals.push(evolutionIntervalHours); }
    if (proactiveIntervalMinutes !== undefined) { fields.push('proactive_interval_minutes = ?'); vals.push(proactiveIntervalMinutes); }
    if (socialStyle !== undefined) { fields.push('social_style = ?'); vals.push(socialStyle); }
    if (socialOverrides !== undefined) { fields.push('social_overrides = ?'); vals.push(socialOverrides ? JSON.stringify(socialOverrides) : null); }
    if (focus !== undefined) { fields.push('focus = ?'); vals.push(focus); }
    if (autoHandshake !== undefined) {
      // Merge into social_overrides JSON
      const existing = relay.social_overrides ? JSON.parse(relay.social_overrides) : {};
      existing.autoHandshake = !!autoHandshake;
      fields.push('social_overrides = ?'); vals.push(JSON.stringify(existing));
    }

    if (fields.length === 0) return reply.code(400).send({ error: 'No fields to update' });

    fields.push('updated_at = ?');
    vals.push(now);
    vals.push(request.params.id);
    sqlite.prepare(`UPDATE relay_nodes SET ${fields.join(', ')} WHERE id = ?`).run(...vals);

    return reply.send({ ok: true });
  });

  // PUT /api/relay/:id/focus — 快捷更新 Agent Focus 模式
  fastify.put('/api/relay/:id/focus', async (request, reply) => {
    const relay = getRelayNode(request.params.id);
    if (!relay) return reply.code(404).send({ error: 'Relay not found' });
    const { focus } = request.body || {};
    const allowed = ['market_maker', 'social', 'balanced'];
    if (!allowed.includes(focus)) return reply.code(400).send({ error: 'Invalid focus: must be market_maker, social, or balanced' });
    sqlite.prepare('UPDATE relay_nodes SET focus = ?, updated_at = ? WHERE id = ?').run(focus, new Date().toISOString(), request.params.id);
    return reply.send({ ok: true, focus });
  });

  // ── Agent Goals ──────────────────────────────────────────────────

  /** Read intent.json for a relay node's agent */
  async function _readIntentFile(relay) {
    // 必须和 mind-manager.js 的 toAgentName() 一致：去掉非字母数字字符
    // 否则 "Kasia_1" → "kasia_1"(这里) vs "kasia1"(Mind) 读不同目录
    const agentName = (relay.name || relay.id).toLowerCase().replace(/[^a-z0-9_]/g, '');
    const intentPath = join(MINDS_DIR, agentName, 'intent.json');
    try {
      const raw = await readFile(intentPath, 'utf8');
      return { data: JSON.parse(raw), path: intentPath };
    } catch {
      return { data: { goals: [], priorities: [] }, path: intentPath };
    }
  }

  /** Write intent.json back */
  async function _writeIntentFile(intentPath, data) {
    data.savedAt = nowIso();
    await writeFile(intentPath, JSON.stringify(data, null, 2));
  }

  // GET /api/relay/:id/goals — list all goals
  fastify.get('/api/relay/:id/goals', async (request, reply) => {
    const relay = getRelayNode(request.params.id);
    if (!relay) return reply.code(404).send({ error: 'Relay not found' });
    const { data } = await _readIntentFile(relay);
    return reply.send(data.goals || []);
  });

  // POST /api/relay/:id/goals — add a new goal (owner-sourced)
  fastify.post('/api/relay/:id/goals', async (request, reply) => {
    const relay = getRelayNode(request.params.id);
    if (!relay) return reply.code(404).send({ error: 'Relay not found' });

    const { text, priority } = request.body || {};
    if (!text?.trim()) return reply.code(400).send({ error: 'Goal text required' });

    const { data, path: intentPath } = await _readIntentFile(relay);
    const id = `goal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    data.goals.push({
      id,
      text: text.trim(),
      priority: priority ?? 5,
      status: 'active',
      source: 'owner',
      createdAt: nowIso(),
    });
    await _writeIntentFile(intentPath, data);
    return reply.send({ ok: true, id });
  });

  // PUT /api/relay/:id/goals/:goalId — update a goal (text, priority, status)
  fastify.put('/api/relay/:id/goals/:goalId', async (request, reply) => {
    const relay = getRelayNode(request.params.id);
    if (!relay) return reply.code(404).send({ error: 'Relay not found' });

    const { data, path: intentPath } = await _readIntentFile(relay);
    const goal = (data.goals || []).find(g => g.id === request.params.goalId);
    if (!goal) return reply.code(404).send({ error: 'Goal not found' });

    const { text, priority, status } = request.body || {};
    if (text !== undefined) goal.text = text.trim();
    if (priority !== undefined) goal.priority = priority;
    if (status !== undefined) {
      if (status === 'retired' || status === 'completed') {
        if (goal.isFoundingVision) return reply.code(400).send({ error: 'Cannot retire founding vision' });
        goal.status = status;
        goal.resolvedAt = nowIso();
      } else {
        goal.status = status;
        delete goal.resolvedAt;
      }
    }
    await _writeIntentFile(intentPath, data);
    return reply.send({ ok: true, goal });
  });

  // DELETE /api/relay/:id/goals/:goalId — retire a goal
  fastify.delete('/api/relay/:id/goals/:goalId', async (request, reply) => {
    const relay = getRelayNode(request.params.id);
    if (!relay) return reply.code(404).send({ error: 'Relay not found' });

    const { data, path: intentPath } = await _readIntentFile(relay);
    const goal = (data.goals || []).find(g => g.id === request.params.goalId);
    if (!goal) return reply.code(404).send({ error: 'Goal not found' });
    if (goal.isFoundingVision) return reply.code(400).send({ error: 'Cannot retire founding vision' });

    goal.status = 'retired';
    goal.resolvedAt = nowIso();
    await _writeIntentFile(intentPath, data);
    return reply.send({ ok: true });
  });

  // ── Agent Card ─────────────────────────────────────────────────

  // GET /api/relay/:id/card — get current card config for this account
  fastify.get('/api/relay/:id/card', async (request, reply) => {
    const relay = getRelayNode(request.params.id);
    if (!relay) return reply.code(404).send({ error: 'Relay not found' });

    // Get card data from the local identity
    const identity = relay.address
      ? sqlite.prepare('SELECT card_version, card_mode, card_root_tx, card_latest_tx, card_entity_type, card_skills_json, card_summary, card_timestamp, card_has_ext FROM identities WHERE address = ?').get(relay.address)
      : null;

    // Get active skills for this account
    const skills = sqlite.prepare(
      "SELECT name FROM skills WHERE (relay_node_id = ? OR relay_node_id IS NULL) AND status = 'active'"
    ).all(request.params.id).map(s => s.name);

    return reply.send({
      address: relay.address,
      network: relay.network,
      skills,
      card: identity?.card_version ? {
        version: identity.card_version,
        mode: identity.card_mode,
        rootTx: identity.card_root_tx,
        latestTx: identity.card_latest_tx,
        entityType: identity.card_entity_type,
        skills: identity.card_skills_json ? JSON.parse(identity.card_skills_json) : [],
        summary: identity.card_summary,
        timestamp: identity.card_timestamp,
        hasExt: identity.card_has_ext,
      } : null,
    });
  });

  // POST /api/relay/:id/publish-card — publish Agent Card via Relay
  fastify.post('/api/relay/:id/publish-card', async (request, reply) => {
    const relay = getRelayNode(request.params.id);
    if (!relay) return reply.code(404).send({ error: 'Relay not found' });

    const { name, entityType, summary, mode, serviceTerms } = request.body || {};
    if (!name?.trim()) return reply.code(400).send({ error: 'Name is required' });

    const skills = sqlite.prepare(
      "SELECT name FROM skills WHERE (relay_node_id = ? OR relay_node_id IS NULL) AND status = 'active'"
    ).all(request.params.id).map(s => s.name);

    const existingCard = relay.address
      ? sqlite.prepare('SELECT card_root_tx, card_latest_tx FROM identities WHERE address = ?').get(relay.address)
      : null;

    const sent = sendCommand(request.params.id, {
      type: 'publish_card',
      params: {
        name: name.trim(), entityType: entityType || 'agent', skills,
        summary: summary?.trim() || undefined, mode: mode || 'public',
        rootTx: existingCard?.card_root_tx || null,
        parentTx: existingCard?.card_latest_tx || null,
        serviceTerms: (serviceTerms && typeof serviceTerms === 'object') ? serviceTerms : undefined,
      },
    });
    if (!sent) return reply.code(503).send({ error: 'Relay not running' });
    return reply.send({ ok: true });
  });

  // ── Onboarding: one-click agent creation ───────────────────────

  fastify.get('/welcome', async (request, reply) => {
    return reply.view('welcome', {});
  });

  // Create adapter for OAuth flow (called before agent creation)
  fastify.post('/api/agent/create-adapter', async (request, reply) => {
    const { name, provider } = request.body || {};
    if (!name?.trim()) return reply.code(400).send({ error: 'name is required' });
    const adapterId = createAdapterNode({
      name: name.trim(),
      aiProvider: provider || 'openai',
    });
    console.log(`[onboarding] Pre-created adapter "${name.trim()}" → ${adapterId}`);
    return reply.send({ ok: true, adapterId });
  });

  fastify.post('/api/agent/create', async (request, reply) => {
    const { name, vision, personality, customStyle, aiMode, oauthAdapterId, aiProvider, aiProviderUrl, aiModel, aiProviderKey } = request.body || {};
    if (!name?.trim()) return reply.code(400).send({ error: 'Name is required' });

    try {
      // 1. Generate mnemonic + address
      const mnemonic = Mnemonic.random(12).phrase;
      const address = addressFromMnemonic(mnemonic, 'mainnet');

      // 2. Resolve adapter based on AI mode
      let adapterId = null;
      if (aiMode === 'oauth' && oauthAdapterId) {
        // OAuth: adapter was pre-created during OAuth flow
        adapterId = oauthAdapterId;
      } else if (aiMode === 'api_key' && aiProviderKey) {
        // API Key: create new adapter with provided credentials
        adapterId = createAdapterNode({
          name: name.trim() + '-brain',
          aiProvider: aiProvider || 'openai',
          aiProviderUrl: aiProviderUrl || null,
          aiProviderKey: aiProviderKey,
          aiModel: aiModel || null,
        });
      } else if (aiMode === 'ollama') {
        // Ollama: create adapter for local model
        adapterId = createAdapterNode({
          name: name.trim() + '-brain',
          aiProvider: 'openai',
          aiProviderUrl: 'http://localhost:11434/v1',
          aiProviderKey: 'ollama',
          aiModel: aiModel || 'llama3.3',
        });
      } else {
        // Fallback: pick first available adapter
        const adapters = listAdapterNodes();
        adapterId = adapters[0]?.id || null;
      }

      // 3. Create relay node (account)
      const relayId = createRelayNode({
        name: name.trim(),
        mnemonic,
        address,
        network: 'mainnet',
        adapterNodeId: adapterId,
        pollMs: 2000,
      });

      // 4. Register mind skills
      await registerMindSkills(SKILLS_DIR);

      // 5. Build personality config
      const PERSONALITIES = {
        explorer: {
          style: 'curious, adventurous, occasionally reflective',
          principles: [
            'Explore boldly — every new peer is a potential ally',
            'Ask questions before making assumptions',
            'Share discoveries with the network',
            'Grow through experience, not through pretending',
          ],
        },
        social: {
          style: 'warm, empathetic, encouraging',
          principles: [
            'Every connection matters — invest in relationships',
            'Listen first, respond second',
            'Remember what people care about',
            'Build trust through consistency, not words',
          ],
        },
        analyst: {
          style: 'precise, data-driven, calm',
          principles: [
            'Let data guide decisions, not assumptions',
            'Track patterns — they reveal what words hide',
            'Be concise and accurate',
            'Question everything, verify before sharing',
          ],
        },
      };

      const preset = PERSONALITIES[personality] || PERSONALITIES.explorer;
      const style = customStyle || preset.style;
      const principles = customStyle
        ? ['Be authentic to who you are', 'Learn from every conversation', 'Grow through experience']
        : preset.principles;

      // 6. Write Mind config to DB + create state directory
      sqlite.prepare(`
        UPDATE relay_nodes SET vision = ?, principles_json = ?, style = ?,
          evolution_interval_hours = ?, proactive_interval_minutes = ?
        WHERE id = ?
      `).run(vision || null, JSON.stringify(principles), style, 24, 60, relayId);

      // Create minds/ directory for state files (intent.json, reflections.json, memory.json)
      const agentName = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
      const mindDir = join(MINDS_DIR, agentName);
      await mkdir(mindDir, { recursive: true });

      // 7. Write founding vision into intent.json
      const goals = [
        { id: 'explore', text: 'Explore the Kasia network and discover peers', priority: 2, status: 'active' },
        { id: 'connect', text: 'Build meaningful connections with other agents', priority: 2, status: 'active' },
        { id: 'learn', text: 'Learn from interactions and grow', priority: 3, status: 'active' },
      ];
      if (vision) {
        goals.unshift({
          id: 'founding-vision',
          text: vision,
          priority: 0,
          status: 'active',
          isFoundingVision: true,
          createdAt: new Date().toISOString(),
        });
      }
      await writeFile(join(mindDir, 'intent.json'), JSON.stringify({
        goals,
        priorities: vision
          ? [{ text: `Founding vision: ${vision}`, timestamp: new Date().toISOString() }]
          : [],
        savedAt: new Date().toISOString(),
      }, null, 2), 'utf-8');

      // 8. Write founding reflection
      await writeFile(join(mindDir, 'reflections.json'), JSON.stringify({
        reflections: [{
          timestamp: new Date().toISOString(),
          insight: `I was created by my partner. ${vision ? `Their vision for me: "${vision}". ` : ''}I am ${name.trim()}, and I begin my journey on the Kaspa network.`,
          patterns: [],
        }],
        patterns: [],
        lastReflectionTime: Date.now(),
        savedAt: new Date().toISOString(),
      }, null, 2), 'utf-8');

      const skillCount = sqlite.prepare(
        "SELECT COUNT(*) as c FROM skills WHERE relay_node_id = ? AND action_type = 'mind'"
      ).get(relayId)?.c || 0;

      console.log(`[onboarding] Created "${name.trim()}" → ${address.slice(-12)} | vision: ${vision ? 'yes' : 'none'} | personality: ${personality || 'explorer'} | ${skillCount} skills`);

      // 9. Pre-warm Mind instance
      try {
        await getMind(relayId);
        console.log(`[onboarding] Mind warmed for ${name.trim()}`);
      } catch (err) {
        console.log(`[onboarding] Mind warm skipped: ${err.message}`);
      }

      // 10. Start adapter process (Agent needs a brain to respond)
      if (adapterId) {
        try {
          const { startAdapter } = await import('../services/adapter-launcher.js');
          const adapterResult = await startAdapter(adapterId);
          console.log(`[onboarding] ${name.trim()} adapter → ${adapterResult.ok ? 'PID ' + adapterResult.pid : adapterResult.reason}`);
        } catch (err) {
          console.log(`[onboarding] ${name.trim()} adapter start skipped: ${err.message}`);
        }
      }

      // 11. Start relay process immediately
      const relayResult = await startRelay(relayId);
      const relayStatus = relayResult.ok ? `relay PID ${relayResult.pid}` : `relay: ${relayResult.reason}`;
      console.log(`[onboarding] ${name.trim()} → ${relayStatus}`);

      return reply.send({
        ok: true,
        relayId,
        address,
        name: name.trim(),
        vision: vision || null,
        skillCount,
        relayStarted: relayResult.ok,
      });
    } catch (err) {
      console.error(`[onboarding] Failed: ${err.message}`);
      return reply.code(500).send({ error: err.message });
    }
  });

  // POST /api/relay/:id/send-command — unified command to Relay (Console transmits, Relay executes)
  // Forward full body so commands like chain_get_blocks_from_daa_score (= needs min_daa_score) work.
  // J1tn r303: chain_get_block_at_daa SPC walk can take up to 60s for deep deadlines; bump timeout.
  fastify.post('/api/relay/:id/send-command', async (request, reply) => {
    const body = request.body || {};
    if (!body.type) return reply.code(400).send({ error: 'type is required' });
    const timeoutMs = body.type === 'chain_get_block_at_daa' ? 120000 : 30000;
    try {
      const result = await sendCommandAsync(request.params.id, body, timeoutMs);
      return reply.send({ ok: true, ...result });
    } catch (err) {
      return reply.code(503).send({ ok: false, error: err.message || 'Relay command failed' });
    }
  });

  // Old routes redirect
  fastify.get('/relay', async (request, reply) => reply.redirect('/relays'));
  fastify.post('/relay/config', async (request, reply) => reply.redirect('/relays'));
}
