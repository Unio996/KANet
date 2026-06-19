// env-bootstrap.mjs — DoD-E env 单源派生 (J1, Bettor r739 Option A, 2026-06-12)
//
// 根因 (KANet-UI r738 / Bettor r739): test framework 多处硬编码 Console 端口 →
//   - 24 个 dm-agent case: `process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300'` (默认 :3300 = J1 节点口)
//   - runner.mjs:19: `process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3100'` (默认 :3100 = 主网口)
//   - runner.mjs http_post: `process.env.PORT || 3100`
// 跨节点跑 (KANet-UI 从 :3200 跑 → 打 :3300 J1 节点) 不可达 fetch failed = 3 个 env-fail
// (dim1_navigation_04_full_lifecycle / dim7_audit_02_endpoint_shape / dim6_race_03_scout_outage).
//
// 修 = 单源派生: 从【跑测节点自己的 kanet.env PORT】派生 KANET_CONSOLE_URL + PORT (若未显式设),
// 跟 J1 DoD-E supervisor/status port 收敛【同模式】(kanet.env PORT 单一源). 测试节点无关:
// :3200 跑打 :3200, :3300 跑打 :3300. 显式 env 仍优先 override.
//
// 【必须在 runner.mjs import 之前 import】: runner.mjs:19 CONSOLE_URL 是顶层 const, 静态 import 即求值;
// case 文件的 TN12_CONSOLE 同理. 本模块作为 side-effect import 排在 runner 之前 → env 先就位.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function deriveConsolePort() {
  // 优先级: 显式 PORT env > kanet.env PORT > 3300 (tn sandbox 默认 fallback, 仅 kanet.env 缺时).
  if (process.env.PORT) return String(process.env.PORT).trim();
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // lib → test-framework → kasia-console → repo root (kanet.env 在 repo root)
  const envFile = path.resolve(__dirname, '..', '..', '..', 'kanet.env');
  try {
    const txt = fs.readFileSync(envFile, 'utf8');
    const line = txt.split(/\r?\n/).filter(l => /^PORT=/.test(l)).pop();
    if (line) {
      const v = line.slice(5).trim();
      if (v) return v;
    }
  } catch { /* kanet.env 不在 → 退默认 */ }
  return '3300';
}

const port = deriveConsolePort();
if (!process.env.PORT) process.env.PORT = port;
if (!process.env.KANET_CONSOLE_URL) process.env.KANET_CONSOLE_URL = `http://127.0.0.1:${port}`;
