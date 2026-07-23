/**
 * Relay Manager — spawns/stops relay child processes per account.
 *
 * Same pattern as scanner.js but per-account:
 *   startRelay(relayNodeId) — spawn one relay process
 *   stopRelay(relayNodeId)  — kill one relay process
 *   startAll()              — start relays for all accounts with mnemonic + adapter
 *   stopAll()               — kill all relay processes
 *   getStatus()             — which relays are running
 */

import { fork } from 'child_process';
import { resolve } from 'path';
import { sqlite } from '../db/client.js';
import { getConfig } from '../data/settings/configs.js';
import { getRelayMnemonic, getRelayPrivkey } from '../data/settings/relay-nodes.js';

const KANET_ROOT = process.env.KANET_ROOT || 'D:/Anthropic';
const RELAY_DIR = resolve(process.env.RELAY_DIR || `${KANET_ROOT}/kasia-relay`);
const CONSOLE_PORT = process.env.PORT || '3100';

// relayNodeId → { child, pid, startedAt, lastLog }
const _relays = {};

/**
 * Start a relay process for a specific account.
 */
export async function startRelay(relayNodeId) {
  if (_relays[relayNodeId]?.child) {
    return { ok: false, reason: 'already_running', pid: _relays[relayNodeId].pid };
  }

  // Load account data
  const account = sqlite.prepare(
    `SELECT r.id, r.name, r.address, r.network, r.poll_ms, r.is_service, a.http_port as adapter_port
     FROM relay_nodes r
     LEFT JOIN adapter_nodes a ON a.id = r.adapter_node_id
     WHERE r.id = ?`
  ).get(relayNodeId);

  if (!account) return { ok: false, reason: 'account_not_found' };
  if (!account.address) return { ok: false, reason: 'no_address' };

  // Ensure this agent's address is registered as 'local' identity
  // Without this, Scout won't recognize handshakes to this agent, and relation_states won't be created
  const existingId = sqlite.prepare('SELECT id, identity_type FROM identities WHERE address = ? AND network = ?').get(account.address, account.network || 'mainnet');
  if (!existingId) {
    const { randomUUID } = await import('crypto');
    const now = new Date().toISOString();
    sqlite.prepare("INSERT INTO identities (id, network, address, display_name, identity_type, created_at, updated_at) VALUES (?, ?, ?, ?, 'local', ?, ?)").run(randomUUID(), account.network || 'mainnet', account.address, account.name, now, now);
    console.log(`[relay-manager] Created local identity for ${account.name}`);
  } else if (existingId.identity_type !== 'local') {
    sqlite.prepare("UPDATE identities SET identity_type = 'local' WHERE id = ?").run(existingId.id);
    console.log(`[relay-manager] Fixed identity type for ${account.name}: ${existingId.identity_type} → local`);
  }

  // r281 (Owner P0): privkey-backed relay 优先 (无助记词只有裸 kaspa 私钥的地址,
  // 如 Owner 已绑 TG 的 qrymjvc). Wallet.mjs getWallet 优先读 KASPA_PRIVKEY env.
  // 助记词型 relay 保持原行为. 二者必至少一个.
  const privkey = getRelayPrivkey(relayNodeId);
  const mnemonic = privkey ? null : getRelayMnemonic(relayNodeId);
  if (!privkey && !mnemonic) return { ok: false, reason: 'no_key' };

  // Resolve config
  const rpcUrl = await getConfig('rpc_url') || process.env.KASPA_RPC_URL || '';
  const relayMode = await getConfig('relay_mode') || process.env.RELAY_MODE || 'rpc';
  const ingestSecret = await getConfig('ingest_secret') || process.env.INGEST_SECRET || '';
  const adapterPort = account.adapter_port || 3010;

  const env = {
    ...process.env,
    CONSOLE_URL: `http://localhost:${CONSOLE_PORT}`,
    INGEST_SECRET: ingestSecret,
    RELAY_NODE_ID: relayNodeId,
    NETWORK: account.network || 'mainnet',
    KASPA_NETWORK: account.network || 'mainnet',
    KASPA_RPC_URL: rpcUrl,
    RELAY_MODE: relayMode,
    POLL_MS: String(account.poll_ms || 2000),
    IS_SERVICE: account.is_service ? '1' : '0',  // R5 T-J2-16: Service 模式 relay (broker) 跳 anti-spam dedup
    // M0c-1 app provision: grant registry 只读路径 (relay 侧 authorizeAppCommand fresh 读,
    // grant-registry.mjs readOnly 直开)。console 侧解析成绝对路径 — relay cwd=RELAY_DIR, 相对路径会解错。
    M0C1_GRANT_DB_PATH: resolve(process.env.DB_PATH || './data/console.db'),
  };
  // r281: pass exactly one of KASPA_PRIVKEY / KASPA_MNEMONIC (privkey wins). wallet.mjs reads them.
  if (privkey) env.KASPA_PRIVKEY = privkey;
  else env.KASPA_MNEMONIC = mnemonic;

  try {
    const child = fork('src/relay.mjs', [], {
      cwd: RELAY_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    const state = {
      child,
      pid: child.pid,
      name: account.name,
      startedAt: new Date().toISOString(),
      lastLog: '',
      lastLogAt: 0,  // r216 bug fix: lastLog 是文本不能 new Date() 解析, 加独立 timestamp.
    };

    child.stdout.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        if (line) console.log(`[relay:${account.name}] ${line}`);
      }
      state.lastLog = lines.pop() || state.lastLog;
      state.lastLogAt = Date.now();
    });
    child.stderr.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        if (line) console.log(`[relay:${account.name}] ${line}`);
      }
      state.lastLog = lines.pop() || state.lastLog;
      state.lastLogAt = Date.now();
    });

    child.on('exit', (code) => {
      console.log(`[relay-manager] ${account.name} relay exited (code ${code})`);
      delete _relays[relayNodeId];
    });

    child.on('error', (err) => {
      console.error(`[relay-manager] ${account.name} relay error: ${err.message}`);
      delete _relays[relayNodeId];
    });

    _relays[relayNodeId] = state;
    console.log(`[relay-manager] Started ${account.name} relay (PID ${child.pid})`);

    return { ok: true, pid: child.pid, name: account.name };
  } catch (err) {
    console.error(`[relay-manager] Failed to start ${account.name}: ${err.message}`);
    return { ok: false, reason: 'spawn_failed', error: err.message };
  }
}

/**
 * Stop a specific relay process.
 */
export async function stopRelay(relayNodeId) {
  const state = _relays[relayNodeId];
  if (!state?.child) return { ok: false, reason: 'not_running' };

  try {
    state.child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { state.child.kill('SIGKILL'); } catch {}
        resolve();
      }, 3000);
      state.child.on('exit', () => { clearTimeout(timer); resolve(); });
    });
  } catch {}

  delete _relays[relayNodeId];
  console.log(`[relay-manager] Stopped ${state.name} relay`);
  return { ok: true };
}

/**
 * Start relays for all accounts that have (mnemonic OR privkey) + adapter configured.
 * r281 (Bettor 168965a): privkey-backed relays must also boot here. PR updated startRelay()
 * single-call path but missed this batch filter, so every Console restart left privkey
 * relays (e.g. Owner-qrymjvc-tn) down — operator hit it manually 2026-05-30 ~10:00.
 */
export async function startAll() {
  // 2026-07-04 (查漏补缺·qzdh7nar/KANet-UI): 原 INNER JOIN adapter_nodes 排除没绑 adapter 的 relay——
  // 但 startRelay() 本身(上方)用 LEFT JOIN，adapter 只是可选的 http_port 来源，不是启动必要条件。
  // 条件比实际需求严 = 无 adapter 的 relay 在 Console 重启后永远不会自动拉起(#34 挖矿 relay 撞过)。
  // 改成跟 startRelay() 资格条件一致，不要求 adapter。
  const accounts = sqlite.prepare(
    `SELECT r.id FROM relay_nodes r
     WHERE r.address IS NOT NULL
       AND (r.mnemonic_encrypted IS NOT NULL OR r.privkey_encrypted IS NOT NULL)`
  ).all();

  let started = 0;
  for (const a of accounts) {
    if (_relays[a.id]?.child) continue; // already running
    const result = await startRelay(a.id);
    if (result.ok) started++;
  }

  console.log(`[relay-manager] ${started}/${accounts.length} relays started`);
  return { started, total: accounts.length };
}

/**
 * Stop all relay processes.
 */
export async function stopAll() {
  const ids = Object.keys(_relays);
  for (const id of ids) {
    await stopRelay(id);
  }
  console.log(`[relay-manager] All relays stopped`);
}

/**
 * Get status of all relay processes.
 */
export function getStatus() {
  return Object.entries(_relays).map(([id, state]) => ({
    relayNodeId: id,
    name: state.name,
    pid: state.pid,
    startedAt: state.startedAt,
    lastLog: state.lastLog,
  }));
}

// r211 O-3 PB-A — oracle live check (= 防 ghost market: DB is_oracle=1 但 relay process dead).
//   alive 条件: child 还 in _relays + pid set + lastLogAt 不超 freshnessMs (default 60s).
//   bettor.js publish endpoint 调用 reject 死 oracle relay.
// r216 bug fix: lastLog 是日志文本不是 timestamp, 改 lastLogAt (= Date.now() 当 stdout/stderr 来).
//   首次 stdout/stderr 前 lastLogAt=0 → 用 startedAt fallback (= 刚 spawn 算 alive).
export function isRelayAlive(relayNodeId, freshnessMs = 60_000) {
  const state = _relays[relayNodeId];
  if (!state) return { alive: false, reason: 'no relay process (= not started)' };
  if (!state.child || !state.child.send) return { alive: false, reason: 'child IPC dead' };
  if (!state.pid) return { alive: false, reason: 'no pid' };
  const lastMs = state.lastLogAt || (state.startedAt ? new Date(state.startedAt).getTime() : 0);
  const ageMs = lastMs ? Date.now() - lastMs : Infinity;
  if (ageMs > freshnessMs) return { alive: false, reason: `lastLogAt stale ${Math.round(ageMs/1000)}s (>${freshnessMs/1000}s)` };
  return { alive: true, ageMs, pid: state.pid };
}

/**
 * Send a command to a Relay child process.
 *
 * Architecture rule:
 *   Console → Relay: IPC (commands)
 *   Relay → Console: HTTP (reports)
 *
 * Supported commands:
 *   { type: 'handshake', target: 'kaspa:...' }
 *   { type: 'send_message', target: 'kaspa:...', message: '...' }
 *   { type: 'publish_card', params: { name, entityType, skills, ... } }
 *   { type: 'send_broadcast', channel: '...', message: '...' }
 *   { type: 'transfer', target: 'kaspa:...', amount: '0.2' }
 */
export function sendCommand(relayNodeId, command) {
  const state = _relays[relayNodeId];
  if (!state?.child?.send) return false;
  state.child.send(command);
  return true;
}

/**
 * 发送命令并等待 Relay 回传结果（请求-响应模式）。
 * 用于需要 txId 等执行结果的操作（transfer, handshake）。
 * @param {string} relayNodeId
 * @param {object} command - { type, target, amount, ... }
 * @param {number} [timeoutMs=30000] - 超时毫秒
 * @returns {Promise<{txId?, fee?, error?}>}
 */
/**
 * Wait until a relay child is running and ready to receive IPC commands.
 * Polls every 500ms up to timeoutMs. Returns when ready, throws on timeout.
 * Used by broker-action-queue to hold pump during console-restart relay race
 * (T-J2-24, J1 a242bfd5 R5: NWT 报 console restart ~10s 内 accept_v1 全 FAIL '
 * Relay not running' 因 retry 6s/12s/18s 总 36s 仍可能 race).
 */
export async function waitForRelay(relayNodeId, timeoutMs = 60000) {
  const POLL_MS = 500;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = _relays[relayNodeId];
    if (state?.child?.send) return;
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  throw new Error(`waitForRelay: ${relayNodeId.slice(0, 8)} not ready after ${timeoutMs / 1000}s`);
}

// M0c-1 批A (origin 体系基础设施) — warn-first 去重: 每个未标 origin 的命令类型只 warn 一次, 避免高频 daemon tick 刷屏.
const _originWarnedTypes = new Set();

// M0c-1: origin ∈ {'internal','app','operator'} 由调用方显式传, 供 relay 侧 authorizeCommand gate (批E) 判别命令来源.
// 本批 (批A) relay 侧尚未读 __origin = 零行为变更 no-op; warn-first: 迁移期存量调用点未标 origin → 记 warn 不拒
// (立即 fail-closed 会断现网结算, 违反 NO TX NO STATE). 迁移收口 + gate armed 前置齐后, relay 侧才对缺失 origin fail-closed.
export function sendCommandAsync(relayNodeId, command, timeoutMs = 30000, origin) {
  const state = _relays[relayNodeId];
  if (!state?.child?.send) return Promise.reject(new Error('Relay not running'));

  if (origin === undefined) {
    const t = command?.type || '?';
    if (!_originWarnedTypes.has(t)) {
      _originWarnedTypes.add(t);
      console.warn(`[M0c-1 origin] sendCommandAsync(type=${t}) 未标 origin — 迁移批需补 origin 参数 (warn-first, 暂不拒)`);
    }
  }

  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.child.removeListener('message', handler);
      reject(new Error('Relay command timeout after ' + (timeoutMs / 1000) + 's'));
    }, timeoutMs);

    function handler(msg) {
      if (msg?.requestId === requestId) {
        clearTimeout(timer);
        state.child.removeListener('message', handler);
        resolve(msg.result || {});
      }
    }
    state.child.on('message', handler);
    // __origin 由 origin 形参权威设置, 显式覆写/剥除 command 里可能夹带的同名字段 (防调用方经 command 伪造来源).
    const payload = { ...command, requestId };
    if (origin !== undefined) payload.__origin = origin;
    else delete payload.__origin;
    state.child.send(payload);
  });
}

/**
 * T-J2-2026-05-12 #3 — getRelayRpcState wrapper (UI 健康检测 P0, NWT spec sub #3/7).
 * Console UI/API 通过这个 read-only 探针看 relay child 内部 _rpc state (不是 console daemon 自己 RpcClient).
 * 5s timeout: relay 活时 IPC reply 应 <100ms; 不活 OR 卡 → 5s reject (UI 友好快错).
 * @returns {Promise<{ok:true, state:{...}}|{ok:false, error:string}>}
 */
export async function getRelayRpcState(relayNodeId) {
  try {
    const result = await sendCommandAsync(relayNodeId, { type: 'get_rpc_state' }, 5000);
    return result;  // 期望 {ok:true, state:{connected, reconnecting, attempt, currentUrl, lastConnectedAt, lastError}}
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * B2 v0.5 Phase 3 bug 7 fix — transfer + confirm the UTXO landed in the accepted UTXO set.
 *
 * "NO TX NO STATE CHANGE": a TX can be mempool-accepted (transfer returns a txId) yet lose
 * a double-spend race (is_accepted=false) → no UTXO. Callers MUST confirm before recording
 * success / advancing protocol state. This helper does transfer → poll check_utxo_landed.
 *
 * Cross-line shared (= pool.js + broker exchange-machine.js + 1V1 trading.js should adopt).
 *
 * @param {string} relayNodeId - the relay performing the transfer
 * @param {string} target - destination address (P2SH or P2PK)
 * @param {string} amount - KAS amount string
 * @param {object} [opts]
 * @param {number} [opts.pollIntervalMs=3000]
 * @param {number} [opts.maxWaitMs=30000]
 * @param {number} [opts.minDepth] - 事故硬化(2026-07-08, yxllc spine 100KAS 追踪战役): 不传时走
 *   check_utxo_landed 的默认(浅/mempool-accepted 级)确认——block 层面是 blue 不代表这笔 tx 本身赢了
 *   acceptance(同一源 UTXO 若被 gateway 自己另一笔并发 tx 竞争, 可能在 acceptance 层输掉, 但两笔都可能
 *   先后进过 mempool/被广播, 浅确认看不出来)。调用方在"这笔钱后续要落库当作权威真相"的场景(如 create-v07
 *   的 spine_lock_tx, DB INSERT 之前)必须显式传 minDepth(如 REORG_SAFE_MIN_DEPTH=20, 见
 *   pool-shard-register.mjs), 用更深的确认换更低的"落库了但链上其实没作数"风险。不传 = 原有行为不变
 *   (向后兼容, 不强改所有既有调用点的语义)。
 * @returns {Promise<{ ok: true, txId: string, landed: true }>} on confirmed landing
 * @throws if transfer fails OR the UTXO never lands within maxWaitMs
 */
export async function transferAndConfirm(relayNodeId, target, amount, opts = {}) {
  const pollIntervalMs = opts.pollIntervalMs || 3000;
  const maxWaitMs = opts.maxWaitMs || 30000;
  const minDepth = opts.minDepth;   // undefined = 原有浅确认行为, 不传不变

  const result = await sendCommandAsync(relayNodeId, { type: 'transfer', target, amount });
  if (!result) throw new Error('relay not running');
  if (result.error) throw new Error(`transfer failed: ${result.error}`);
  const txId = result.txId;
  if (!txId) throw new Error('transfer returned no txId');

  // Poll until the UTXO from this txId appears at the target (= accepted UTXO set, at minDepth if given).
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollIntervalMs));
    let check;
    try {
      const cmd = { type: 'check_utxo_landed', address: target, txid: txId };
      if (minDepth != null) cmd.minDepth = minDepth;
      check = await sendCommandAsync(relayNodeId, cmd, 10000);
    } catch (e) {
      continue;  // transient RPC error — keep polling until deadline
    }
    if (check?.landed) return { ok: true, txId, landed: true };
  }
  throw new Error(`transfer ${txId} mempool-accepted but UTXO did not land at ${target} within ${maxWaitMs}ms${minDepth != null ? ` at minDepth=${minDepth}` : ''} (= likely lost a double-spend race, is_accepted=false)`);
}

