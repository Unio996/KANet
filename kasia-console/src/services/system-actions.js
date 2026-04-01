/**
 * System Actions — Agent 本地执行能力
 *
 * 白名单制：只允许预审批的下载 URL 和安装命令。
 * Agent 不能执行任意命令，只能执行注册在 ALLOWED_ACTIONS 中的操作。
 *
 * 安全原则：
 *   1. 只允许白名单 URL 下载
 *   2. 只允许白名单程序运行
 *   3. 每个操作都记录到 events 表
 *   4. 用户确认（前端 confirm）后才执行
 */

import { execFile, spawn } from 'child_process';
import { createWriteStream, existsSync, mkdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const KANET_ROOT = process.env.KANET_ROOT || 'D:/Anthropic';
const DOWNLOAD_DIR = join(KANET_ROOT, 'downloads');

// ── 白名单：只允许这些下载和安装 ──

const ALLOWED_DOWNLOADS = {
  'ibkr-gateway-windows': {
    url: 'https://download2.interactivebrokers.com/installers/ibgateway/latest-standalone/ibgateway-latest-standalone-windows-x64.exe',
    filename: 'ibgateway-setup.exe',
    description: 'IB Gateway (Windows)',
  },
  'ibkr-gateway-macos': {
    url: 'https://download2.interactivebrokers.com/installers/ibgateway/latest-standalone/ibgateway-latest-standalone-macos-x64.dmg',
    filename: 'ibgateway-setup.dmg',
    description: 'IB Gateway (macOS)',
  },
  'ibkr-gateway-linux': {
    url: 'https://download2.interactivebrokers.com/installers/ibgateway/latest-standalone/ibgateway-latest-standalone-linux-x64.sh',
    filename: 'ibgateway-setup.sh',
    description: 'IB Gateway (Linux)',
  },
};

const ALLOWED_INSTALLERS = {
  'ibkr-gateway-windows': {
    match: /ibgateway.*\.exe$/i,
    description: 'IB Gateway Windows Installer',
  },
};

// ── 核心函数 ──

/**
 * 下载文件（白名单校验）
 * @param {string} actionId — ALLOWED_DOWNLOADS 的 key
 * @returns {{ ok, filePath, size, error? }}
 */
export async function downloadFile(actionId) {
  const entry = ALLOWED_DOWNLOADS[actionId];
  if (!entry) return { ok: false, error: `不允许的下载: ${actionId}` };

  if (!existsSync(DOWNLOAD_DIR)) mkdirSync(DOWNLOAD_DIR, { recursive: true });
  const filePath = join(DOWNLOAD_DIR, entry.filename);

  // 如果已下载且文件大于 1MB，跳过
  if (existsSync(filePath)) {
    try {
      const stat = statSync(filePath);
      if (stat.size > 1_000_000) {
        return { ok: true, filePath, size: stat.size, cached: true, description: entry.description };
      }
    } catch {}
  }

  console.log(`[system-actions] Downloading ${entry.description} from ${entry.url}`);
  try {
    const res = await fetch(entry.url, {
      signal: AbortSignal.timeout(300_000), // 5 分钟超时
      headers: { 'User-Agent': 'KANet/1.0' },
    });
    if (!res.ok) return { ok: false, error: `下载失败: HTTP ${res.status}` };

    const fileStream = createWriteStream(filePath);
    await pipeline(Readable.fromWeb(res.body), fileStream);

    const stat = statSync(filePath);
    console.log(`[system-actions] Downloaded ${entry.filename}: ${(stat.size / 1024 / 1024).toFixed(1)} MB`);
    return { ok: true, filePath, size: stat.size, description: entry.description };
  } catch (e) {
    console.error(`[system-actions] Download error:`, e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * 运行安装程序（白名单校验）
 * @param {string} filePath — 要运行的文件
 * @returns {{ ok, pid, error? }}
 */
export function runInstaller(filePath) {
  const fileName = basename(filePath);

  // 白名单校验
  const allowed = Object.values(ALLOWED_INSTALLERS).some(rule => rule.match.test(fileName));
  if (!allowed) return { ok: false, error: `不允许运行: ${fileName}` };

  if (!existsSync(filePath)) return { ok: false, error: `文件不存在: ${filePath}` };

  console.log(`[system-actions] Running installer: ${filePath}`);
  try {
    const child = spawn(filePath, [], {
      detached: true,
      stdio: 'ignore',
      shell: true,
    });
    child.unref();
    return { ok: true, pid: child.pid, file: fileName };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 检查进程是否在运行
 * @param {string} processName — 进程名（如 'ibgateway', 'java'）
 */
export function checkProcess(processName) {
  const allowed = ['ibgateway', 'java', 'IB Gateway'].some(a =>
    processName.toLowerCase().includes(a.toLowerCase())
  );
  if (!allowed) return { ok: false, error: `不允许查询: ${processName}` };

  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'tasklist' : 'ps';
    const args = isWin ? ['/FI', `IMAGENAME eq ${processName}*`, '/NH'] : ['aux'];

    execFile(cmd, args, { timeout: 5000 }, (err, stdout) => {
      if (err) { resolve({ ok: true, running: false }); return; }
      const found = stdout.toLowerCase().includes(processName.toLowerCase());
      resolve({ ok: true, running: found, process: processName });
    });
  });
}

/**
 * 获取系统信息（平台、架构）
 */
export function getSystemInfo() {
  return {
    platform: process.platform,     // win32 / darwin / linux
    arch: process.arch,             // x64 / arm64
    nodeVersion: process.version,
  };
}

/**
 * 检查软件是否已安装（查常见安装路径）
 */
export function checkInstalled(name) {
  const allowed = ['ibgateway', 'ib gateway', 'tws'].some(a => name.toLowerCase().includes(a));
  if (!allowed) return { installed: false, error: `不允许查询: ${name}` };

  const isWin = process.platform === 'win32';
  const drives = isWin ? ['C:', 'D:', 'E:', 'F:'] : [];
  const paths = isWin
    ? [
        ...drives.flatMap(d => [`${d}/Jts/ibgateway`, `${d}/Jts`]),
        `${process.env.USERPROFILE}/Jts/ibgateway`,
        `${process.env.USERPROFILE}/Jts`,
        ...drives.flatMap(d => [`${d}/Program Files/IB Gateway`, `${d}/Program Files (x86)/IB Gateway`]),
      ]
    : [
        `${process.env.HOME}/Jts/ibgateway`,
        `${process.env.HOME}/Jts`,
        '/opt/ibgateway',
        '/opt/ibc',
      ];

  for (const p of paths) {
    if (existsSync(p)) {
      return { installed: true, path: p };
    }
  }
  return { installed: false };
}

/**
 * 获取可用的下载列表
 */
export function getAvailableDownloads() {
  return Object.entries(ALLOWED_DOWNLOADS).map(([id, entry]) => ({
    id,
    description: entry.description,
    filename: entry.filename,
  }));
}
