#!/usr/bin/env node
// scripts/ch-ls.mjs — dev-channel inspector（本地时间 UTC+7）
//
// Usage:
//   node scripts/ch-ls.mjs                    # 默认 48h，8 个 dev 频道
//   node scripts/ch-ls.mjs --hours=24
//   node scripts/ch-ls.mjs --tag=QCLAUDE      # 正则过滤 content
//   node scripts/ch-ls.mjs --channel=dev-coord
//   node scripts/ch-ls.mjs --limit=300        # per-channel fetch size（默认 200）
//   node scripts/ch-ls.mjs --include-general  # 加上 general 频道
//   node scripts/ch-ls.mjs --full             # 完整 content 不截断
//   node scripts/ch-ls.mjs --unprocessed      # 只看 channel-bridge 未处理的
//
// 输出符号：
//   ✓ = 已被 channel-bridge 处理（processed.jsonl 里）
//   ⏸ = 未处理
//   tag 前符号：✓ DONE / → TASK / ⎔ AUDIT / ! ERROR/WARN / ? QUESTION / · 其它

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONSOLE_URL = process.env.CONSOLE_URL || 'http://127.0.0.1:3100';
const TZ = 7; // Bangkok UTC+7

const DEFAULT_CHANNELS = [
  'dev-coord', 'kanet-arch', 'kanet-frontend', 'kanet-backend',
  'kanet-review', 'kanet-alert', 'kanet-status', 'kanet-test'
];
// BLACKLIST — 永远不扫，不管用户是否 --channel 强制
// kanet-dev: 死信坑已废（memory: feedback_check_channel_before_send）
// kaspa / kanet-public: 对外闲聊频道，与 dev 协作无关
const BLACKLIST = new Set(['kanet-dev', 'kaspa', 'kanet-public']);

function arg(name, def) {
  const pfx = `--${name}=`;
  const a = process.argv.find(x => x.startsWith(pfx));
  return a ? a.slice(pfx.length) : def;
}
const HOURS    = parseInt(arg('hours', '48'));
const TAG_F    = arg('tag', null);
const CH_F     = arg('channel', null);
const LIMIT    = parseInt(arg('limit', '200'));
const INC_GEN  = process.argv.includes('--include-general');
const FULL     = process.argv.includes('--full');
const ONLY_NEW = process.argv.includes('--unprocessed');

function httpGet(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.get({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, timeout }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function loadProcessed() {
  const f = path.join(__dirname, 'channel-bridge.processed.jsonl');
  const s = new Set();
  if (!fs.existsSync(f)) return s;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { s.add(JSON.parse(line).tx_hash); } catch {}
  }
  return s;
}

function toLocal(utcIso) {
  const ms = new Date(utcIso).getTime() + TZ * 3600 * 1000;
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return {
    date: `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
  };
}

function extractTags(content) {
  if (!content) return [];
  const re = /\[([^\]\n]{1,60})\]/g;
  const out = [];
  let m;
  while ((m = re.exec(content)) !== null && out.length < 3) out.push(m[1]);
  return out;
}

function classifyTag(t) {
  if (/DONE/i.test(t)) return '✓';
  if (/TASK|TASKLIST|DECREE/i.test(t)) return '→';
  if (/AUDIT|PASS|FAIL|VERIFIED|CORRECTION/i.test(t)) return '⎔';
  if (/ERROR|ALERT|CANCEL|WARN|TIMEOUT/i.test(t)) return '!';
  if (/QUESTION/i.test(t)) return '?';
  return '·';
}

async function fetchCh(ch) {
  try {
    const { status, body } = await httpGet(`${CONSOLE_URL}/api/chat/messages?channel=${encodeURIComponent(ch)}&limit=${LIMIT}`);
    if (status !== 200) return [];
    return (JSON.parse(body).messages || []).map(m => ({ ...m, channel: ch }));
  } catch { return []; }
}

async function main() {
  const processed = loadProcessed();
  const cutoff = Date.now() - HOURS * 3600 * 1000;

  let chans = DEFAULT_CHANNELS;
  if (CH_F) chans = [CH_F];
  else if (INC_GEN) chans = [...DEFAULT_CHANNELS, 'general'];
  // 过滤黑名单（死信频道、闲聊频道）— 用户 --channel 显式指定的也拦
  const filtered = chans.filter(c => !BLACKLIST.has(c));
  if (filtered.length < chans.length) {
    const dropped = chans.filter(c => BLACKLIST.has(c));
    console.log(`(skipped blacklisted channels: ${dropped.join(', ')})`);
  }
  chans = filtered;
  if (!chans.length) { console.log('(no channels left after blacklist)'); return; }

  const all = [];
  for (const ch of chans) {
    for (const m of await fetchCh(ch)) {
      const ts = new Date(m.created_at).getTime();
      if (ts < cutoff) continue;
      if (TAG_F && !new RegExp(TAG_F, 'i').test(m.content || '')) continue;
      if (ONLY_NEW && processed.has(m.tx_hash)) continue;
      all.push(m);
    }
  }
  all.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  if (!all.length) {
    console.log(`(no msgs last ${HOURS}h matching filters)`);
    return;
  }

  let lastDate = '';
  for (const m of all) {
    const lt = toLocal(m.created_at);
    if (lt.date !== lastDate) {
      console.log(`\n── ${lt.date} (local UTC+${TZ}) ──`);
      lastDate = lt.date;
    }
    const addr = (m.sender_address || '?').slice(-12);
    const tx = (m.tx_hash || '?').slice(0, 8);
    const proc = processed.has(m.tx_hash) ? '✓' : '⏸';
    const ch = m.channel.padEnd(14);
    const tags = extractTags(m.content);
    const tagLabel = tags.length
      ? tags.map(t => `${classifyTag(t)}[${t}]`).join(' ')
      : '';
    const raw = (m.content || '').replace(/\s+/g, ' ').trim();
    const body = raw.replace(/\[[^\]\n]{1,60}\]/g, '').trim();
    const bodyShown = FULL ? body : body.slice(0, 160);
    const truncated = !FULL && body.length > 160 ? '…' : '';

    console.log(`${lt.time} ${proc} ${tx} #${ch} ${addr}  ${tagLabel}`);
    if (bodyShown) console.log(`   ${bodyShown}${truncated}`);
  }
  console.log(`\n── ${all.length} msgs / ${HOURS}h window / channels=${chans.length} ──`);
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
