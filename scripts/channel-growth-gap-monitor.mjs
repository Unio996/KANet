#!/usr/bin/env node
// 频道增长缺口监视器(原名"盲窗标记"——2026-08-04 Bettor 改名,理由: 它测的是"本机记录的频道最新
// 消息时刻"落后"频道现在到哪"多少,不是、也测不到"agent 真的读了没有"。旧名暗示了它没有的能力。
//
// spec-first 报审 · Bettor 批(阈值30分钟/取频道最新消息时刻/运维小工具口径,原commit aa0ad3a6+ad99d1ce+46538806)。
//
// 用法: node scripts/channel-growth-gap-monitor.mjs --agent=<name> --relayId=<relayId> [--channel=dev-coord-testnet] [--thresholdMin=30]
//
// 逻辑: 读本机状态文件 logs/monitor-lastseen-<agent>.json 里记的"上次已知频道最新消息时刻";
// 跟这次拉到的"频道当前最新消息时刻"比,差距 >= 阈值 判定缺口 → 本地打一行 + 播一条到频道。
// 状态文件不存在/损坏 = 首次武装,不判定,只写入,不许因此崩(fail-soft,被 Monitor 常驻脚本调用)。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.KANET_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
const CONSOLE_BASE = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3200';

// agent 名 allowlist(硬化②·2026-08-04 Bettor 批): 挡拼错的 --agent 造出孤儿状态文件,
// 也挡未来新 agent 忘了先在这里登记。加新 agent 直接在这个数组里添一行。
const KNOWN_AGENTS = ['kanetui', 'j1', 'j2', 'bettor', 'nwt'];

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
  console.error('usage: node channel-growth-gap-monitor.mjs --agent=<name> --relayId=<relayId> [--channel=...] [--thresholdMin=30]');
  process.exit(1);
}

if (!KNOWN_AGENTS.includes(agent)) {
  console.error(`[频道缺口监视器] --agent=${agent} 不在 allowlist(${KNOWN_AGENTS.join('/')})——先在脚本里登记再用,防止拼错生成孤儿状态文件`);
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
    console.error(`[频道缺口监视器] 状态文件写入失败(不阻塞): ${err?.message?.slice(0, 120)}`);
  }
}

async function fetchLatestTs() {
  const r = await fetch(`${CONSOLE_BASE}/api/chat/messages?channel=${encodeURIComponent(channel)}&limit=20`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) {
    // 硬化①(2026-08-04 Bettor 批): HTTP 状态本身非 2xx 时不去解析 body——避免把一个错误页/空响应
    // 当成 "j.messages 为空" 静默处理掉,那样会悄悄把"读不到"和"频道确实没消息"混成一回事。
    console.error(`[频道缺口监视器] 拉取频道失败: HTTP ${r.status},本次跳过判定`);
    return null;
  }
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
  const ok = r.ok && j.ok;
  if (!ok) console.error(`[频道缺口监视器] 播报失败: HTTP ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
  return { ...j, ok };
}

async function main() {
  const prior = readState();
  const channelLatestTs = await fetchLatestTs();

  if (!channelLatestTs) {
    console.log('[频道缺口监视器] 频道当前无消息或拉取失败,跳过本次判定,不动状态文件');
    return;
  }

  if (prior && prior.lastSeenTs) {
    const gapMs = new Date(channelLatestTs).getTime() - new Date(prior.lastSeenTs).getTime();
    const gapMin = Math.round(gapMs / 60000);
    if (gapMs >= thresholdMin * 60000) {
      const localLine = `[频道缺口] 本机上次已知${prior.lastSeenTs},频道现在到${channelLatestTs},缺口约${gapMin}分钟,期间内容查ledger`;
      console.log(localLine);
      const result = await broadcast(`频道缺口 ${prior.lastSeenTs}→${channelLatestTs},本机未补,期间内容查ledger`);
      if (!result.ok) {
        // 硬化③(2026-08-04 Bettor 批): 播报失败就不许推进状态——否则下次武装会拿"已经报过了"
        // 的错误认知继续往前比,这次缺口就永久漏播了。播报失败 = 状态原地不动,下次重试。
        console.error('[频道缺口监视器] 播报失败,本次不推进状态,留给下次武装重试');
        return;
      }
    } else {
      console.log(`[频道缺口监视器] 缺口约${gapMin}分钟,未过阈值(${thresholdMin}分钟),不判定`);
    }
  } else {
    console.log('[频道缺口监视器] 无历史状态,首次武装,不判定');
  }

  writeState(channelLatestTs);
}

main().catch((err) => {
  console.error(`[频道缺口监视器] 异常(不崩调用方): ${err?.message?.slice(0, 160)}`);
});
