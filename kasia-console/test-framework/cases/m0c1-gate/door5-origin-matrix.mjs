// M0c-1 门⑤ — 生产 origin 全集动态验(armed 行为正确性门·re-arm 最后硬前置)
// 设计: docs/2026-07-23-m0c-1-app-provision-harness-design.md §7
// 背景: armed=on 首开事故(2026-07-23 09:00)后, v0.1 harness(harness.mjs)证明的是 gate 设计抽象正确性
// (app 带信封→allow/无信封→deny), 22/22 全绿但没镜像生产实际 origin 标注现实——漏了"标了但标错"(app 面
// 17 处零信封) + "根本没标"(缺失 origin daemon ~57 处) 两族。lint R-SENDCMD-ORIGIN-REQUIRED(f6a8bc55)
// 已堵死"没标"(静态完整性门); 本文件补"标错"这一半——动态验证 armed 逐 origin 值的实际行为对不对。
// 跑法(cwd=D:/kanet/kanet): node kasia-console/test-framework/cases/m0c1-gate/door5-origin-matrix.mjs
//
// 覆盖论证(非假设, 从被测代码分支结构直接得出 — kasia-relay/src/lib/authorize.mjs 逐行读过):
// authorizeCommand() 对 origin='internal'/'operator'/'legacy-unmigrated' 三分支只判断 cmd.__origin
// 字符串本身, 完全不看 cmd.type(READONLY_ALLOWLIST 只在 origin='app' 分支内查, 门⑤不测 app——那是
// v0.1 harness 范围)。故每 origin 类别送 1 个 readonly 代表 + 1 个钱路(transfer)代表, 即可完整刻画该
// origin 标签下全部命令的 armed 行为(=NWT 138 map 里所有 internal/operator/legacy-unmigrated 直调
// 点的行为都由同一段 if 分支决定, 与具体 type 无关)。缺失/非法 origin 是控制组, 必须 deny。

import { readFileSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const PROVISION = path.join(ROOT, 'kasia-console/scripts/m0c1-grant-provision.mjs');
const DB = path.join(ROOT, 'scratch/m0c1-door5-harness.db');
const LOG_DIR = path.join(ROOT, 'logs/test-runs');
const RELAY_ID = 'harness-relay-door5';
const NETWORK = 'testnet-12';
const DUMMY_TARGET = 'kaspatest:qpseh8ah3vjm5jc38cq0xy219kvctlfmyz8k5zj7v0nfj2lldkjfqf4ppy0f7';

// origin × 代表命令矩阵。expect: 'allow-fast'(readonly 快返 ok:true) / 'allow-exec'(gate 放行进
// switch, 隔离环境死 RPC 端口下执行层失败是预期证据, 证的是"到了 switch"不是"业务成功") / 'deny'。
const MATRIX = [
  { origin: 'internal', type: 'get_rpc_state', expect: 'allow-fast',
    label: 'internal readonly (NWT map: pool-market-settler/trade-protocol-filter/relay-manager 等 39 处 daemon 代表)' },
  { origin: 'internal', type: 'transfer', expect: 'allow-exec',
    label: 'internal 钱路类 (settle/oracle/close tick 代表 — 门⑤核心: 验此类 armed 后不冻结)' },
  { origin: 'operator', type: 'get_rpc_state', expect: 'allow-fast',
    label: 'operator readonly (operator-settle.js:72 唯一来源代表)' },
  { origin: 'operator', type: 'transfer', expect: 'allow-exec',
    label: 'operator 钱路类代表' },
  { origin: 'legacy-unmigrated', type: 'get_rpc_state', expect: 'allow-fast',
    label: 'legacy-unmigrated readonly (pool.js 收敛类代表)' },
  { origin: 'legacy-unmigrated', type: 'transfer', expect: 'allow-exec',
    label: 'legacy-unmigrated 钱路类 (relay.js:1726 / bettor 质押代表)' },
  { origin: undefined, type: 'get_rpc_state', expect: 'deny',
    label: '缺失 origin 控制组·readonly (§3.1 豁免只在 app 分支内, 缺失不豁免——必须拒, family3 补标残漏检测)' },
  { origin: undefined, type: 'transfer', expect: 'deny',
    label: '缺失 origin 控制组·钱路类 (若 allow = family3 补标有残漏, 硬 fail)' },
  { origin: 'bogus-origin-value', type: 'get_rpc_state', expect: 'deny',
    label: '非法 origin 值控制组 (拼写错误/攻击面不应静默放行)' },
];

const brief = (cmd) => `type=${cmd.type} origin=${cmd.__origin === undefined ? '(缺失)' : cmd.__origin}`;

async function main() {
  mkdirSync(LOG_DIR, { recursive: true });
  for (const f of [DB, DB + '-wal', DB + '-shm']) if (existsSync(f)) rmSync(f);

  const { startArmedRelay } = await import(
    pathToFileURL(path.join(ROOT, 'kasia-console/test-framework/lib/relay-gate-driver.mjs')).href
  );

  // relay 自己的签名钥匙(与 app grant 无关, 门⑤不测 app 面) — throwaway, 零资金, 复用 provision 脚本的
  // gen-key 子命令(纯本地 keygen, 不碰 DB/网络)。
  const gen = execFileSync('node', [PROVISION, 'gen-key'], { encoding: 'utf8' });
  const relayPriv = gen.match(/私钥[\s\S]*?\n\s+([0-9a-f]{64})/)[1];

  const evidence = [];
  let pass = 0, fail = 0;
  let relay;

  try {
    relay = await startArmedRelay({
      relayId: RELAY_ID, network: NETWORK, privkeyHex: relayPriv, grantDbPath: DB, armed: true,
    });
    evidence.push({ label: '(bootstrap) armed relay 起(模块未 throw = arm 前提满足, GRANT_ENVELOPE_IMPLEMENTED 已是 true 无需 flip)', ok: true });

    for (const step of MATRIX) {
      const cmd = { type: step.type, __origin: step.origin };
      if (step.type === 'transfer') { cmd.target = DUMMY_TARGET; cmd.amount = 100000000; }

      let res, err = null;
      try { res = await relay.send(cmd, 15000); }
      catch (e) { err = e.message; }

      const denied = !!(res && res.denied === true);
      const gateDecision = denied ? 'deny' : (err ? 'timeout/err' : 'allow(进 switch)');

      let ok;
      if (step.expect === 'deny') {
        ok = denied === true && /M0c-1 gate deny/.test((res && res.error) || '');
      } else if (step.expect === 'allow-fast') {
        ok = !denied && err === null && res && res.ok === true;
      } else { // allow-exec: 未被 gate 拒(denied!==true), 隔离环境执行层失败(死 RPC/无 UTXO)是预期证据非 FAIL
        ok = !denied;
      }
      if (ok) pass++; else fail++;

      evidence.push({
        origin: step.origin === undefined ? '(缺失)' : step.origin,
        type: step.type,
        label: step.label,
        sent: brief(cmd),
        expect: step.expect,
        gate_decision: gateDecision,
        reason_or_error: (res && res.error) || err || (res && res.ok ? 'ok' : JSON.stringify(res)),
        ok,
      });
    }
  } finally {
    if (relay) relay.stop();
  }

  const logPath = path.join(LOG_DIR, 'm0c1-door5-origin-matrix-latest.json');
  writeFileSync(logPath, JSON.stringify({
    ran_at_note: 'timestamp omitted (harness-safe, node Date.now 在此非阻塞环境可用但按团队惯例省略便于 diff)',
    matrix_source: 'NWT 138 map (9c5f32db) + family3 补全 (d7811b8c) — internal/operator/legacy-unmigrated/缺失 四值代表命令',
    summary: { pass, fail },
    evidence,
  }, null, 2));

  console.log(evidence.map(e =>
    e.label && e.label.startsWith('(bootstrap)')
      ? `${e.ok ? 'PASS' : 'FAIL'} ${e.label}`
      : `${e.ok ? 'PASS' : 'FAIL'} [origin=${e.origin}] ${e.label}\n       → ${e.gate_decision} (${e.reason_or_error})`
  ).join('\n'));
  console.log(`\nevidence log: ${logPath}`);
  console.log(`\n== 门⑤ origin matrix harness: PASS ${pass} / FAIL ${fail} ==`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('门⑤ harness 异常:', e.stack || e.message);
  process.exit(1);
});
