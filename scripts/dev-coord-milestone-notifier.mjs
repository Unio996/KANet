#!/usr/bin/env node
/**
 * Dev-coord milestone notifier (Tier 2 Summary System Level 1)
 *
 * Polls dev-coord-testnet broadcasts every 30s, emits MILESTONE lines on stdout
 * when keyword filter matches. Run via Monitor tool for notification stream.
 *
 * Filter (broad-then-precise):
 *   - Emoji markers: 🎯 🎉 🚨
 *   - Owner decisions: 钦定 / Owner ack
 *   - Status markers: PASS / 全绿 / CLOSE / milestone / 完成 / shipped
 * Excludes:
 *   - Self-echoes from KANet-UI-tn (= avoid recursion noise)
 *   - Operational acks without milestone markers
 *
 * Boot: load last 20 tx_hashes into SEEN (= don't replay history on start).
 */

const CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3200';
const CHANNEL = 'dev-coord-testnet';
const POLL_MS = 30_000;
const SELF_ADDR_SUFFIX = 'ly4gzjfld2ze';  // KANet-UI-tn

const MILESTONE_KEYWORDS = [
  '🎯', '🎉', '🚨',
  '钦定', 'Owner ack',
  'PASS', '全绿', 'CLOSE', 'milestone', '完成', '已 ship', 'SHIP',
];

const SEEN = new Set();
const startMs = Date.now();

async function fetchRecent(limit = 20) {
  const r = await fetch(`${CONSOLE}/api/chat/messages?channel=${CHANNEL}&limit=${limit}&order=desc`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return j.messages || [];
}

async function poll() {
  try {
    const msgs = await fetchRecent(20);
    // Reverse so oldest first → chronological emit
    for (const m of msgs.reverse()) {
      if (SEEN.has(m.tx_hash)) continue;
      SEEN.add(m.tx_hash);
      // GC: keep last 1000 to avoid unbounded growth
      if (SEEN.size > 1000) {
        const old = [...SEEN].slice(0, 500);
        for (const k of old) SEEN.delete(k);
      }
      // Skip self-echoes
      if (m.sender_address.endsWith(SELF_ADDR_SUFFIX)) continue;
      // Skip rows that arrived BEFORE script started (boot replay protection)
      const msgTime = new Date(m.created_at).getTime();
      if (msgTime < startMs) continue;
      // Filter milestone keywords
      const matched = MILESTONE_KEYWORDS.filter(kw => m.content.includes(kw));
      if (matched.length === 0) continue;
      const sender = m.sender_address.slice(-12);
      const ts = m.created_at.slice(11, 19);
      const preview = m.content.replace(/\n/g, ' ').slice(0, 160);
      console.log(`[MILESTONE ${ts}] kw=${matched.slice(0, 3).join(',')} | ${sender} | ${preview}`);
    }
  } catch (e) {
    console.error(`[poll-err ${new Date().toISOString().slice(11, 19)}] ${e.message}`);
  }
}

// Boot: seed SEEN with current recent rows so we don't emit history
async function boot() {
  try {
    const msgs = await fetchRecent(50);
    for (const m of msgs) SEEN.add(m.tx_hash);
    const startStamp = new Date().toISOString().slice(11, 19);
    console.log(`[boot ${startStamp}] seeded ${SEEN.size} known broadcasts, watching ${MILESTONE_KEYWORDS.length} milestone keywords on #${CHANNEL}`);
  } catch (e) {
    console.error(`[boot-err] ${e.message} — will retry on next poll`);
  }
}

await boot();

// Main poll loop
while (true) {
  await new Promise(r => setTimeout(r, POLL_MS));
  await poll();
}
