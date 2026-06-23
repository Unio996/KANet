// broker-bot-manager.js — multi-instance TG bot manager for approved external brokers (Owner 钦定
// 2026-06-22 多-bot tg-manager). Each approved broker_onboarding row (trust elevated → approved)
// gets its OWN forked bot process running its OWN @BotFather token → one grammy poller per token
// (no 409 Conflict). This is SEPARATE from the single global broker bot (tg-bot-manager.js): different
// tokens, different processes, coexist fine.
//
// Design:
//   - reconcileBrokerBots() is the single driver (idempotent): start a bot for every approved broker
//     not already running, stop bots whose broker is no longer approved. Called on boot + periodic +
//     on-demand (after an approval). Periodic reconcile also respawns a bot that died.
//   - bots keyed by broker_address (地址制铁律: broker 身份 = 地址, 非 relay_id).
//   - token decrypted in-process (crypto.decrypt), passed to fork via env, never logged.
//   - bad-token guard: a bot that crashes rapidly N× is marked disabled (don't respawn the bad token
//     every tick) until Console restart or re-onboard with a fresh token.
//   - NO broad process sweep here (would kill the global bot + sibling broker bots). We only kill the
//     children we track. Launcher name (_launch_broker_bot.mjs) deliberately does NOT match the global
//     manager's killStrayBots pattern (_launch_tg_bot|tg-bot.bot.mjs), so global Stop won't nuke us.
import { fork } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { sqlite } from '../db/client.js';
import { decrypt } from './crypto.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KANET_ROOT = process.env.KANET_ROOT || join(__dirname, '..', '..', '..');
const CONSOLE_DIR = join(KANET_ROOT, 'kasia-console');
const LAUNCHER = '_launch_broker_bot.mjs';

const RAPID_CRASH_MS = 12000;
const MAX_RAPID_CRASHES = 3;
const RESPAWN_DELAY_MS = 4000;
// KANet-UI 2026-06-23 (Bettor 诊断的真防线): rapid-crash 计数遇 ranMs>=RAPID_CRASH_MS 会清零, 所以【慢速崩溃
// 循环】(如 409 token 冲突: bot 起来 poll 十几分钟才崩→清零→重生→再崩) 永远逃过 MAX_RAPID_CRASHES disable,
// 拖垮平台。补一道滚动窗总崩溃帽: WINDOW 内累计崩溃 >= MAX → disable, 不管单次跑多久。快/慢循环都自禁。
const CRASH_WINDOW_MS = 30 * 60 * 1000;   // 30 分钟滚动窗
const MAX_CRASHES_IN_WINDOW = 5;          // 窗内崩 5 次 = 坏 token/配置, 停止重生

// broker_address -> { child, pid, startedAt, username, crashes, disabledBadToken, lastError }
const bots = new Map();

function isAlive(rec) {
  return !!(rec?.child && rec.child.exitCode === null && !rec.child.signalCode && !rec.child.killed);
}

// approved = onboarded (token present) AND identities.trust_level elevated by Owner (审批门复用 trust).
// ⚠ 审批真相源 = identities.trust_level, 单源 (Bettor 2026-06-23 拍 B)。broker_onboarding.status 是
// vestigial (onboard 插 'pending', 没有任何路径把它设 'approved') —— 故【绝不要 gate b.status】, 加
// `AND b.status='approved'` 会让所有 broker 永不 fork。status←trust auto-sync (方案 A) 经核为 cosmetic
// (逻辑等价单 gate trust, 零额外保护) 且动共享 /identities 审批流, 不值当, 已弃。真分离 broker-approval 与
// identity-trust 需独立"批准 broker bot"动作, 等真有外部 broker 规模化再上。
function approvedBrokers() {
  return sqlite.prepare(`
    SELECT b.broker_address, b.bot_token_encrypted, b.bot_username, i.trust_level
    FROM broker_onboarding b
    LEFT JOIN identities i ON i.address = b.broker_address
    WHERE b.bot_token_encrypted IS NOT NULL
      AND i.trust_level IN ('owner','recommended')
  `).all();
}

function startOne(brokerAddress, token, username) {
  if (isAlive(bots.get(brokerAddress))) return;
  let child;
  try {
    child = fork(LAUNCHER, [], {
      cwd: CONSOLE_DIR,
      env: { ...process.env, TELEGRAM_BOT_TOKEN: token, TELEGRAM_BOT_USERNAME: username || 'KANET_Broker_bot', BROKER_ADDRESS: brokerAddress },
    });
  } catch (e) {
    const prev = bots.get(brokerAddress) || {};
    bots.set(brokerAddress, { ...prev, child: null, lastError: 'spawn_failed: ' + e.message });
    return;
  }
  const startedAt = Date.now();
  const prev = bots.get(brokerAddress) || {};
  const rec = { child, pid: child.pid, startedAt: new Date(startedAt).toISOString(), username, crashes: prev.crashes || 0, crashTimes: prev.crashTimes || [], disabledBadToken: false, lastError: null };
  bots.set(brokerAddress, rec);
  console.log(`[broker-bot-mgr] launched bot pid=${child.pid} broker=…${brokerAddress.slice(-12)}`);

  child.on('exit', (code, signal) => {
    const ranMs = Date.now() - startedAt;
    const cur = bots.get(brokerAddress);
    if (cur?.child !== child) return; // superseded by a newer start
    cur.child = null;
    if (ranMs < RAPID_CRASH_MS) cur.crashes = (cur.crashes || 0) + 1; else cur.crashes = 0;
    // 滚动窗总崩溃帽 (Bettor 真防线): 记每次崩溃时刻, 剪掉窗外的, 窗内累计达上限即 disable —— 不靠"连续 rapid",
    // 故慢速 409 循环 (跑十几分钟才崩、rapid 计数被清零) 也会被这道帽逮住自禁。
    const nowMs = Date.now();
    cur.crashTimes = [...(cur.crashTimes || []), nowMs].filter(t => nowMs - t <= CRASH_WINDOW_MS);
    console.log(`[broker-bot-mgr] bot exit broker=…${brokerAddress.slice(-12)} code=${code} sig=${signal} ranMs=${ranMs} crashes=${cur.crashes} windowCrashes=${cur.crashTimes.length}`);
    if (cur.crashes >= MAX_RAPID_CRASHES || cur.crashTimes.length >= MAX_CRASHES_IN_WINDOW) {
      cur.disabledBadToken = true;
      const why = cur.crashes >= MAX_RAPID_CRASHES ? `${cur.crashes}× rapidly` : `${cur.crashTimes.length}× in ${CRASH_WINDOW_MS / 60000}min (慢循环)`;
      cur.lastError = `crashed ${why} — disabled (likely bad token OR 409 token-conflict; check token / 单 poller, then re-onboard or reconcile)`;
      console.warn(`[broker-bot-mgr] DISABLED broker=…${brokerAddress.slice(-12)} (${why})`);
      return;
    }
    // respawn after delay if still approved (reconcile would also catch it, this is faster)
    setTimeout(() => {
      const still = approvedBrokers().find(b => b.broker_address === brokerAddress);
      if (!still || isAlive(bots.get(brokerAddress)) || bots.get(brokerAddress)?.disabledBadToken) return;
      try { startOne(brokerAddress, decrypt(still.bot_token_encrypted), still.bot_username); } catch {}
    }, RESPAWN_DELAY_MS);
  });
}

function stopOne(brokerAddress) {
  const rec = bots.get(brokerAddress);
  if (rec?.child) { try { rec.child.kill('SIGTERM'); } catch {} }
  bots.delete(brokerAddress);
  console.log(`[broker-bot-mgr] stopped bot broker=…${brokerAddress.slice(-12)}`);
}

/** Idempotent driver: ensure exactly the approved set is running. Safe to call repeatedly. */
export function reconcileBrokerBots() {
  let approved;
  try { approved = approvedBrokers(); } catch (e) {
    console.warn('[broker-bot-mgr] reconcile read failed: ' + e.message);
    return { ok: false, error: e.message };
  }
  const approvedAddrs = new Set(approved.map(b => b.broker_address));
  // stop bots whose broker is no longer approved
  for (const addr of [...bots.keys()]) {
    if (!approvedAddrs.has(addr)) stopOne(addr);
  }
  let started = 0, skippedBad = 0, alreadyUp = 0;
  for (const b of approved) {
    const rec = bots.get(b.broker_address);
    if (isAlive(rec)) { alreadyUp++; continue; }
    if (rec?.disabledBadToken) { skippedBad++; continue; }
    let token;
    try { token = decrypt(b.bot_token_encrypted); } catch (e) {
      bots.set(b.broker_address, { ...(rec || {}), child: null, lastError: 'decrypt_failed: ' + e.message });
      continue;
    }
    startOne(b.broker_address, token, b.bot_username);
    started++;
  }
  return { ok: true, approved: approved.length, started, already_up: alreadyUp, skipped_bad_token: skippedBad, running: [...bots.values()].filter(isAlive).length };
}

/** Status for UI/admin (never returns tokens). */
export function brokerBotsStatus() {
  const list = [...bots.entries()].map(([addr, rec]) => ({
    broker_address: addr,
    running: isAlive(rec),
    pid: isAlive(rec) ? rec.pid : null,
    started_at: isAlive(rec) ? rec.startedAt : null,
    username: rec.username || null,
    disabled_bad_token: !!rec.disabledBadToken,
    last_error: rec.lastError || null,
  }));
  return { ok: true, count: list.length, running: list.filter(b => b.running).length, bots: list };
}

/** Manual stop of one broker's bot (admin). */
export function stopBrokerBot(brokerAddress) {
  if (!bots.has(brokerAddress)) return { ok: false, error: 'no bot for that broker_address' };
  stopOne(brokerAddress);
  return { ok: true };
}

let _timer = null;
/** Boot wire: reconcile now + every 60s (picks up newly-approved brokers + respawns dead ones). */
export function startBrokerBotManager() {
  const first = reconcileBrokerBots();
  console.log('[broker-bot-mgr] boot reconcile: ' + JSON.stringify(first));
  if (!_timer) _timer = setInterval(() => { try { reconcileBrokerBots(); } catch {} }, 60000);
  return first;
}
