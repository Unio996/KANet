#!/usr/bin/env node
// Phase 3g Sub 1 (D-1) — LAN IP probe + DHCP discovery + 10min cron + atomic kanet.env update
//
// Owner 5/13 钦定 Phase 3g 选项 A 严格 (~60h). Bettor architect r76 spec PASS + 4 改:
//   1. dhcpScan 并发 Promise.all + ARP cache 过滤 (顺序 254×3s 太慢)
//   2. updateKanetEnv atomic write (tmp + rename + lock)
//   3. D-1 不发 dev-coord 告警 (C-1 才管), 只 stdout + log
//   4. D-1 限 kanet.env 1 cache, 其他 3 cache (adapter_nodes/agent_connections/adapter restart) 留 D-2
//
// 实证根因: 5/12 LAN kaspad .123→.107 + 5/13 .107→.109 二次漂移, 人工 6 步修. 此自愈让 0 步.

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import net from 'node:net';

const KANET_ROOT = process.env.KANET_ROOT || 'D:/Anthropic';
const ENV_FILE = `${KANET_ROOT}/kanet.env`;
const LOCK_FILE = `${KANET_ROOT}/kanet.env.lock`;
const LOG_FILE = `${KANET_ROOT}/logs/lan-ip-health.log`;
const KASPAD_PORT = Number(process.env.KASPA_NODE_PORT || 17110);
const PROBE_TIMEOUT_MS = 3_000;
const PROBE_CRON_MS = 10 * 60_000;  // 10min

function ts() { return new Date().toISOString().slice(11, 19); }
function log(msg) {
  const line = `[${ts()}] ${msg}`;
  process.stdout.write(line + '\n');
  try { writeFileSync(LOG_FILE, line + '\n', { flag: 'a' }); } catch {}
}

// TCP probe single (ip, port) with timeout
function probeKaspad(ip, port = KASPAD_PORT) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const t = setTimeout(() => { sock.destroy(); resolve(false); }, PROBE_TIMEOUT_MS);
    sock.connect(port, ip, () => { clearTimeout(t); sock.destroy(); resolve(true); });
    sock.on('error', () => { clearTimeout(t); resolve(false); });
  });
}

// ARP cache extract — much faster than blind 254 scan
function arpScanActive() {
  try {
    const out = execSync('arp -a', { encoding: 'utf8', timeout: 5_000 });
    // Match lines like "  192.168.1.109         xx-xx-xx-xx-xx-xx     dynamic" (Windows arp -a format)
    const ips = new Set();
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^\s+(192\.168\.\d+\.\d+)\s+/);
      if (m) ips.add(m[1]);
    }
    return [...ips];
  } catch (e) {
    log(`arp -a failed: ${e.message?.slice(0, 60)} — fallback to full subnet scan`);
    return null;
  }
}

// DHCP scan — concurrent probe ARP-active hosts first, fallback full 192.168.1.1-254
async function dhcpScan(currentSubnet = '192.168.1') {
  const arpActive = arpScanActive();
  const candidates = arpActive && arpActive.length > 0
    ? arpActive.filter(ip => ip.startsWith(currentSubnet))
    : Array.from({ length: 254 }, (_, i) => `${currentSubnet}.${i + 1}`);
  log(`scanning ${candidates.length} ${arpActive ? 'ARP-active' : 'subnet'} hosts on :${KASPAD_PORT}...`);
  const results = await Promise.all(candidates.map(async ip => ({ ip, alive: await probeKaspad(ip) })));
  const found = results.filter(r => r.alive).map(r => r.ip);
  log(`DHCP scan: ${found.length} hosts with kaspad ${KASPAD_PORT} alive — [${found.join(', ')}]`);
  return found;
}

// Read current KASPA_NODE from kanet.env
function readCurrentNode() {
  if (!existsSync(ENV_FILE)) return null;
  const content = readFileSync(ENV_FILE, 'utf8');
  const m = content.match(/^KASPA_NODE\s*=\s*([^\s#]+)/m);
  return m ? m[1] : null;
}

// Atomic update kanet.env KASPA_NODE — tmp write + lock + rename
function atomicUpdateKanetEnv(newIP) {
  // Acquire file lock (best-effort, no kill -9 case)
  let lockAcquired = false;
  try {
    writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
    lockAcquired = true;
  } catch (e) {
    log(`lock file exists (other process updating?), skip update — ${e.code}`);
    return false;
  }

  try {
    const content = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '';
    let updated;
    if (/^KASPA_NODE\s*=/m.test(content)) {
      updated = content.replace(/^KASPA_NODE\s*=.*$/m, `KASPA_NODE=${newIP}`);
    } else {
      // Append (idempotent)
      updated = content + (content.endsWith('\n') ? '' : '\n') + `KASPA_NODE=${newIP}\n`;
    }
    const tmpFile = ENV_FILE + '.tmp';
    writeFileSync(tmpFile, updated, 'utf8');
    renameSync(tmpFile, ENV_FILE);  // atomic on POSIX, near-atomic on Windows
    log(`atomic update kanet.env: KASPA_NODE=${newIP} ✓`);
    return true;
  } catch (e) {
    log(`atomic update FAIL: ${e.message?.slice(0, 100)}`);
    return false;
  } finally {
    if (lockAcquired) {
      try { execSync(`del "${LOCK_FILE}"`, { stdio: 'ignore' }); } catch { try { writeFileSync(LOCK_FILE, '', { flag: 'w' }); } catch {} }
    }
  }
}

async function checkAndHeal() {
  const current = readCurrentNode();
  if (!current) {
    log('kanet.env has no KASPA_NODE — running DHCP scan from scratch');
  } else {
    const alive = await probeKaspad(current);
    if (alive) {
      log(`current KASPA_NODE=${current} reachable ✓`);
      return { healthy: true, ip: current };
    }
    log(`KASPA_NODE=${current} UNREACHABLE — triggering DHCP self-heal`);
  }

  const found = await dhcpScan();
  if (found.length === 0) {
    log('DHCP scan found 0 kaspad hosts — manual intervention required (check kaspad process / firewall)');
    return { healthy: false, ip: null };
  }
  const newIP = found[0];  // first match wins (typically only 1 kaspad per LAN)
  const ok = atomicUpdateKanetEnv(newIP);
  log(`self-heal: KASPA_NODE ${current || '(unset)'} → ${newIP} (update=${ok ? 'OK' : 'FAIL'}) — restart ws-proxy + adapter to pick up (D-2 cron)`);
  return { healthy: ok, ip: newIP, changed: true };
}

// Main loop
log(`Phase 3g D-1 lan-ip-health starting · port=${KASPAD_PORT} · cron=${PROBE_CRON_MS / 60_000}min`);
await checkAndHeal();
setInterval(async () => {
  try { await checkAndHeal(); } catch (e) { log(`cron err: ${e.message?.slice(0, 80)}`); }
}, PROBE_CRON_MS);
