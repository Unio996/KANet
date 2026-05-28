#!/usr/bin/env node
/**
 * Daily Digest (Tier 2 Summary System Level 2)
 *
 * Scans dev-coord-testnet broadcasts over last N hours, generates Markdown digest
 * categorized by: 🎯 milestone / 🚨 blocker / 📋 Owner-ack / ⚙️ ops-routine.
 *
 * Output: D:/KANet-Knowledge-Base/digests/YYYY-MM-DD-HHMM.md
 *
 * Usage:
 *   node scripts/digest-daily.mjs                 # last 12h, output to KB dir
 *   node scripts/digest-daily.mjs --hours 24      # last 24h
 *   node scripts/digest-daily.mjs --print         # dump to stdout instead of file
 *
 * Cron (recommended): 09:00 + 21:00 daily = morning + evening briefings.
 */

import fs from 'node:fs';
import path from 'node:path';

const CONSOLE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3200';
const CHANNEL = 'dev-coord-testnet';
const KB_DIGEST_DIR = 'D:/KANet-Knowledge-Base/digests';

// Parse args
const args = process.argv.slice(2);
const hoursArg = args.includes('--hours') ? parseInt(args[args.indexOf('--hours') + 1], 10) : 12;
const printOnly = args.includes('--print');

// Classification keyword sets (precedence: blocker > milestone > owner > ops)
const KW_BLOCKER = ['🚨', '🚫', 'FAIL', 'blocker', 'stuck', '阻塞', 'rejected', 'fatal'];
const KW_MILESTONE = ['🎯', '🎉', 'PASS', 'CLOSE', '全绿', '完成', '已 ship', 'SHIPPED', 'milestone'];
const KW_OWNER_ACK = ['钦定', 'Owner —', 'Owner 待', '@Owner', 'ask Owner', '待 Owner', 'standby Owner'];

// Sender → display name (= 链上 addr 最后 12 字符 → 智能体名)
const SENDER_NAMES = {
  'ly4gzjfld2ze': 'KANet-UI-tn',
  'f0tctpnx9rql': 'Bettor-tn',
  'rl33afery94s': 'NWT-tn',
  'j3fw7a0pge09': 'J1-tn',
  'pnx9rql': 'Bettor-tn',
  '8f104e2d6': 'J2-tn',
  'klz2kyjkky25': 'J1-tn',
};

function senderName(addr) {
  if (!addr) return 'unknown';
  const suffix = addr.slice(-12);
  return SENDER_NAMES[suffix] || `${suffix.slice(0, 6)}…`;
}

function classifyMessage(content) {
  // Precedence: blocker first (= most urgent), then milestone, then owner-ack, else ops
  if (KW_BLOCKER.some(kw => content.includes(kw))) return 'blocker';
  if (KW_MILESTONE.some(kw => content.includes(kw))) return 'milestone';
  if (KW_OWNER_ACK.some(kw => content.includes(kw))) return 'owner_ack';
  return 'ops';
}

function extractRNumber(content) {
  // Match patterns like "[KANet-UI-tn r79 ...]" or "[J1tn R5 — ...]" or "[Bettor-tn r110 1/3]"
  const m = content.match(/\[([\w-]+)\s+[Rr](\d+(?:\.\d+)?(?:\/\d+)?(?:\s\d+\/\d+)?)/);
  return m ? `${m[1]} r${m[2]}` : null;
}

function shortSubject(content) {
  // First non-empty meaningful line after the [tag rN] prefix
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return '(empty)';
  // Strip the [...] prefix if present
  const first = lines[0].replace(/^\[[^\]]+\]\s*/, '');
  return first.slice(0, 140);
}

async function fetchRecent(hours) {
  // Console doesn't have time-filtered fetch — pull up to 500 recent + filter client-side
  const r = await fetch(`${CONSOLE}/api/chat/messages?channel=${CHANNEL}&limit=500&order=desc`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  const cutoff = Date.now() - hours * 3600 * 1000;
  return (j.messages || []).filter(m => new Date(m.created_at).getTime() >= cutoff);
}

async function generate() {
  const since = new Date(Date.now() - hoursArg * 3600 * 1000);
  const sinceISO = since.toISOString();
  const now = new Date();
  const nowISO = now.toISOString();

  console.log(`[digest] scanning #${CHANNEL} since ${sinceISO} (${hoursArg}h window)`);

  const msgs = await fetchRecent(hoursArg);
  console.log(`[digest] ${msgs.length} broadcasts in window`);

  // Categorize
  const buckets = { milestone: [], blocker: [], owner_ack: [], ops: [] };
  const senderCounts = new Map();

  for (const m of msgs.reverse()) {  // chronological
    const cat = classifyMessage(m.content);
    const rNum = extractRNumber(m.content);
    const subject = shortSubject(m.content);
    const sender = senderName(m.sender_address);
    const ts = m.created_at.slice(11, 19);
    senderCounts.set(sender, (senderCounts.get(sender) || 0) + 1);
    buckets[cat].push({ ts, sender, rNum, subject, tx: m.tx_hash, content: m.content });
  }

  // Build markdown
  const lines = [];
  lines.push(`# KANet Dev-Coord Digest — ${nowISO.slice(0, 16).replace('T', ' ')}`);
  lines.push('');
  lines.push(`**Window**: ${hoursArg}h (since ${sinceISO.slice(0, 19).replace('T', ' ')})`);
  lines.push(`**Channel**: #${CHANNEL}`);
  lines.push(`**Total broadcasts**: ${msgs.length} (= 🎯 ${buckets.milestone.length} milestone / 🚨 ${buckets.blocker.length} blocker / 📋 ${buckets.owner_ack.length} owner-ack / ⚙️ ${buckets.ops.length} ops)`);
  lines.push('');
  lines.push(`## 智能体活跃度 (sender × count)`);
  lines.push('');
  for (const [name, ct] of [...senderCounts.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`- **${name}**: ${ct} broadcasts`);
  }
  lines.push('');

  // Section by category
  function renderBucket(name, emoji, items) {
    if (items.length === 0) return;
    lines.push(`## ${emoji} ${name} (${items.length})`);
    lines.push('');
    for (const it of items) {
      lines.push(`- **[${it.ts}] ${it.sender}** ${it.rNum ? `\`${it.rNum}\`` : ''} — ${it.subject}`);
    }
    lines.push('');
  }

  renderBucket('Blocker / 阻塞', '🚨', buckets.blocker);
  renderBucket('Milestone / 里程碑', '🎯', buckets.milestone);
  renderBucket('Owner 待 ack', '📋', buckets.owner_ack);
  if (buckets.ops.length > 0) {
    lines.push(`## ⚙️ Ops routine (${buckets.ops.length})`);
    lines.push('');
    lines.push(`<details><summary>展开查看</summary>`);
    lines.push('');
    for (const it of buckets.ops) {
      lines.push(`- [${it.ts}] ${it.sender} ${it.rNum ? `\`${it.rNum}\`` : ''} — ${it.subject}`);
    }
    lines.push('');
    lines.push(`</details>`);
    lines.push('');
  }

  lines.push(`---`);
  lines.push('');
  lines.push(`*Auto-generated by \`scripts/digest-daily.mjs\` — Summary System L2*`);
  lines.push(`*Updated*: ${nowISO}`);

  const md = lines.join('\n');

  if (printOnly) {
    console.log('\n--- digest output ---');
    console.log(md);
    return;
  }

  // Write to KB dir
  if (!fs.existsSync(KB_DIGEST_DIR)) {
    fs.mkdirSync(KB_DIGEST_DIR, { recursive: true });
    console.log(`[digest] created dir ${KB_DIGEST_DIR}`);
  }
  // Filename: YYYY-MM-DD-HHMM.md (= local time stamp for human reading)
  const local = new Date();
  const fn = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}` +
             `-${String(local.getHours()).padStart(2, '0')}${String(local.getMinutes()).padStart(2, '0')}.md`;
  const fp = path.join(KB_DIGEST_DIR, fn);
  fs.writeFileSync(fp, md, 'utf-8');
  console.log(`[digest] ✅ wrote ${fp} (${md.length} bytes, ${msgs.length} broadcasts, ${buckets.milestone.length}🎯 ${buckets.blocker.length}🚨 ${buckets.owner_ack.length}📋 ${buckets.ops.length}⚙️)`);
}

await generate();
