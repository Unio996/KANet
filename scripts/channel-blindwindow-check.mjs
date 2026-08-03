#!/usr/bin/env node
// 盲窗标记 — 检测"本机(这个agent会话)有没有漏读频道",不是检测"频道本身安静了多久"。
// spec-first 报审 · Bettor 2026-08-04 批(频道 #dev-coord-testnet 18:29,阈值30分钟/取频道最新消息时刻/运维小工具口径)。
//
// 用法: node scripts/channel-blindwindow-check.mjs --agent=<name> --relayId=<relayId> [--channel=dev-coord-testnet] [--thresholdMin=30]
//
// 逻辑: 读本机状态文件 logs/monitor-lastseen-<agent>.json 里记的"上次已知频道最新消息时刻";
// 跟这次拉到的"频道当前最新消息时刻"比,差距 >= 阈值 判定盲窗 → 本地打一行 + 播一条到频道。
// 不论是否判定盲窗,结束前把状态更新成本次的频道最新消息时刻。
// 状态文件不存在/损坏 = 首次武装,不判盲窗,只写入,不许因此崩(fail-soft,被 Monitor 常驻脚本调用)。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.KANET_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const CONSOLE_BASE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3200';

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const agent = args.agent;
const relayId = args.relayId;
const channel = args.channel || 'dev-coord-testnet';
const thresholdMin = Number(args.thresholdMin || 30);

if (!agent || !relayId) {
  console.error('usage: node channel-blindwindow-check.mjs --agent=<name> --relayId=<relayId> [--channel=...] [--thresholdMin=30]');
  process.exit(1);
}

const stateDir = join(ROOT, 'logs');
const statePath = join(stateDir, `monitor-lastseen-${agent}.json`);

function readState() {
  try {
    if (!existsSync(statePath)) return null;
    const raw = readFileSync(statePath, 'utf8');
    const j = JSON.parse(raw);
    if (!j || typeof j.lastSeenTs !== 'string') return null;
    if (Number.isNaN(new Date(j.lastSeenTs).getTime())) return null; // 语法合法但不是可解析日期,同样当首次武装(NWT红队①)
    return j;
  } catch {
    return null; // 损坏 = 当首次武装,不崩
  }
}

function writeState(lastSeenTs) {
  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(statePath, JSON.stringify({ agent, channel, lastSeenTs }, null, 2));
  } catch (err) {
    console.error(`[盲窗检查] 状态文件写入失败(不阻塞): ${err?.message?.slice(0, 120)}`);
  }
}

async function fetchLatestTs() {
  const r = await fetch(`${CONSOLE_BASE}/api/chat/messages?channel=${encodeURIComponent(channel)}&limit=20`, {
    signal: AbortSignal.timeout(8000),
  });
  const j = await r.json();
  const msgs = (j.messages || []).slice().sort((a, b) => ((a.created_at || '') < (b.created_at || '') ? -1 : 1));
  return msgs.length ? msgs[msgs.length - 1].created_at : null;
}

async function broadcast(message) {
  const r = await fetch(`${CONSOLE_BASE}/api/chat/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relayId, channel, message }),
    signal: AbortSignal.timeout(8000),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) console.error(`[盲窗检查] 播报失败: HTTP ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
  return j;
}

async function main() {
  const prior = readState();
  const channelLatestTs = await fetchLatestTs();

  if (!channelLatestTs) {
    console.log('[盲窗检查] 频道当前无消息,跳过判定');
    return;
  }

  if (prior && prior.lastSeenTs) {
    const gapMs = new Date(channelLatestTs).getTime() - new Date(prior.lastSeenTs).getTime();
    const gapMin = Math.round(gapMs / 60000);
    if (gapMs >= thresholdMin * 60000) {
      const localLine = `[盲窗] 本机上次已知${prior.lastSeenTs},频道现在到${channelLatestTs},缺口约${gapMin}分钟,期间内容查ledger`;
      console.log(localLine);
      await broadcast(`盲窗 ${prior.lastSeenTs}→${channelLatestTs},本机未补,期间内容查ledger`);
    } else {
      console.log(`[盲窗检查] 缺口约${gapMin}分钟,未过阈值(${thresholdMin}分钟),不判盲窗`);
    }
  } else {
    console.log('[盲窗检查] 无历史状态,首次武装,不判盲窗');
  }

  writeState(channelLatestTs);
}

main().catch((err) => {
  console.error(`[盲窗检查] 异常(不崩调用方): ${err?.message?.slice(0, 160)}`);
});
