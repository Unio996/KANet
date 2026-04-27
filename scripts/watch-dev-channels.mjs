#!/usr/bin/env node
// watch-dev-channels.mjs — real-time tail of all KANet dev channels
// Usage: node scripts/watch-dev-channels.mjs
// Runs until Ctrl+C. Read-only. No posts, no DB writes.

const CONSOLE_URL = process.env.KANET_CONSOLE || "http://127.0.0.1:3100";
const POLL_MS = 4000;
const CHANNELS = [
  "dev-coord",
  "kanet-dev",
  "kanet-arch",
  "kanet-frontend",
  "kanet-backend",
  "kanet-review",
  "kanet-alert",
];

const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", magenta: "\x1b[35m", cyan: "\x1b[36m", gray: "\x1b[90m",
};

const CHANNEL_COLOR = {
  "dev-coord":      C.cyan,
  "kanet-dev":      C.green,
  "kanet-arch":     C.magenta,
  "kanet-frontend": C.yellow,
  "kanet-backend":  C.blue,
  "kanet-review":   C.red,
  "kanet-alert":    C.red,
};

// 10 known local addresses → short tags
const ADDR_TAG = {
  "pqqqe78fjev3": "J2",
  "z2w7ktl95grm": "NWT",
  "7y7err0tz9":   "KANet",
  "jf0kzewvmcmv": "J1",
};

function addrShort(addr) {
  if (!addr) return "???";
  if (addr.startsWith("owner:")) return "OWNER";
  const suffix = addr.slice(-12);
  if (ADDR_TAG[suffix]) return ADDR_TAG[suffix];
  const any = Object.keys(ADDR_TAG).find(k => addr.endsWith(k));
  return any ? ADDR_TAG[any] : suffix;
}

// Highlight [TAG] prefixes in content
function highlightTags(content) {
  return content
    .replace(/\[DEV-COORD\]/g,  `${C.cyan}${C.bold}[DEV-COORD]${C.reset}`)
    .replace(/\[OPUS[^\]]*\]/g, m => `${C.red}${C.bold}${m}${C.reset}`)
    .replace(/\[QCLAUDE[^\]]*\]/g, m => `${C.green}${C.bold}${m}${C.reset}`)
    .replace(/\[J1[^\]]*\]/g,   m => `${C.yellow}${C.bold}${m}${C.reset}`)
    .replace(/\[J2[^\]]*\]/g,   m => `${C.magenta}${C.bold}${m}${C.reset}`)
    .replace(/\[NWT[^\]]*\]/g,  m => `${C.blue}${C.bold}${m}${C.reset}`)
    .replace(/\[DONE\]/g,       `${C.green}${C.bold}[DONE]${C.reset}`)
    .replace(/\[QUESTION\]/g,   `${C.yellow}${C.bold}[QUESTION]${C.reset}`)
    .replace(/\[AUDIT\]/g,      `${C.magenta}${C.bold}[AUDIT]${C.reset}`);
}

const lastTs = {};  // channel -> last observed ISO ts

async function fetchChannel(ch) {
  const after = lastTs[ch] ? `&after=${encodeURIComponent(lastTs[ch])}` : "";
  const url = `${CONSOLE_URL}/api/chat/messages?channel=${ch}&limit=50${after}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const j = await resp.json();
  return j.messages || [];
}

function printMsg(ch, m) {
  const color = CHANNEL_COLOR[ch] || C.reset;
  const who = addrShort(m.sender_address);
  const ts = m.created_at.slice(5, 19).replace("T", " ");
  const tx = (m.tx_hash || "").slice(0, 10);
  const onchain = tx.startsWith("local-") ? `${C.gray}local${C.reset}` : `${C.green}${tx}${C.reset}`;
  const prefix = `${color}[${ch.padEnd(13)}]${C.reset} ${C.dim}${ts}${C.reset} ${C.bold}${who.padEnd(6)}${C.reset} ${onchain}`;
  const body = highlightTags((m.content || "").replace(/\s+/g, " ").slice(0, 500));
  console.log(`${prefix}\n  ${body}\n`);
}

async function init() {
  console.log(`${C.bold}${C.cyan}KANet Dev Channels Watcher${C.reset}`);
  console.log(`${C.dim}Polling ${CHANNELS.length} channels every ${POLL_MS}ms. Ctrl+C to stop.${C.reset}\n`);

  // Seed: fetch last 1 msg per channel, set ts so we only show NEW ones
  for (const ch of CHANNELS) {
    try {
      const msgs = await fetchChannel(ch);
      if (msgs.length) lastTs[ch] = msgs[msgs.length - 1].created_at;
    } catch (e) {
      console.log(`${C.red}[init ${ch}] ${e.message}${C.reset}`);
    }
  }
  console.log(`${C.dim}Seeded. Waiting for new messages...${C.reset}\n`);
}

async function tick() {
  for (const ch of CHANNELS) {
    try {
      const msgs = await fetchChannel(ch);
      for (const m of msgs) {
        if (!lastTs[ch] || m.created_at > lastTs[ch]) {
          lastTs[ch] = m.created_at;
          printMsg(ch, m);
        }
      }
    } catch (e) {
      // Silent on transient errors (offline, Console restart)
    }
  }
}

await init();
setInterval(tick, POLL_MS);
