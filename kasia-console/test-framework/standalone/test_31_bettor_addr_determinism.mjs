// J1tn #31 ②轴 — bettor payout addr cross-node determinism drift guard.
//
// scope: gate B #31 找零核弹 / chunk-determinism 硬前置. settle 的 bettor payout addr 必 pk-derive from
//   bettor_pk (chain-anchored, 两节点 pool_bettor_sides commit 同源), 禁 node-local relay_nodes 查 (非持该
//   relay 的节点查返 NULL → settle abort/异 addr → cross-node 命门 = #293 maker_pk / committee active-flag 同病).
// why critical: addr node-local → 非持 relay 节点查返 NULL → settle abort (非持 relay 节点结不了) 或异 recipient
//   (付错人) = cross-node 命门. pk-derive 单源 → 任意节点可结 + 输出 byte-equal (付对人).
//   (注: chunk 封片点由 output 值/序定 [merkle_index + computePoolPayouts 链锚], 与 addr 内容无关 — 全 P2PK 同
//   脚本长不动 storage/compute mass; addr 是独立"付对人"命门, 非 chunk-边界 [J2 纠正原 cascade 过度断言].)
// run: node test-framework/standalone/test_31_bettor_addr_determinism.mjs   (exit 0=PASS, 1=FAIL)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../../src/services/pool-market-settler.js'), 'utf8');

let fails = 0;
function check(name, ok, detail) {
  if (ok) console.log(`PASS ${name}`);
  else { fails++; console.error(`FAIL ${name}: ${detail || ''}`); }
}

// extract the sideAddrs map block (= bettor payout addr derivation)
const m = src.match(/const sideAddrs = sides\.map\(s => \{[\s\S]*?\n {4}\}\);/);
check('① sideAddrs map block found', !!m, 'could not locate `const sideAddrs = sides.map(...)` block');
const block = m ? m[0] : '';

// ② 硬前置: sideAddrs 必 pk-derive from bettor_pk (chain-anchored)
check('② sideAddrs pk-derives from bettor_pk (chain-anchored)',
  /XOnlyPublicKey\(\s*s\.bettor_pk\s*\)\.toAddress/.test(block),
  'expected `new kaspaWasm.XOnlyPublicKey(s.bettor_pk).toAddress(...)` in sideAddrs');

// ③ DRIFT GUARD (核心命门): sideAddrs 块禁 node-local relay_nodes 查 (= 重引 cross-node addr 分歧)
check('③ no node-local relay_nodes lookup in sideAddrs (cross-node determinism guard)',
  !/relay_nodes\s+WHERE\s+id/i.test(block),
  'found `SELECT ... FROM relay_nodes WHERE id` in sideAddrs — node-local bettor addr = cross-node settle 命门 (#31 ②轴 regression)');

// ④ sideAddrs 不依赖 bettor_relay_id 选址 (relay_id 只配 DM, 非 payout addr 来源)
check('④ sideAddrs does not branch on bettor_relay_id for address source',
  !/if\s*\(\s*s\.bettor_relay_id\s*\)/.test(block),
  'found `if (s.bettor_relay_id)` address branch in sideAddrs — payout addr must not depend on node-local relay registry');

if (fails === 0) { console.log('\n✅ #31 ②轴 bettor payout addr cross-node determinism: ALL PASS'); process.exit(0); }
else { console.error(`\n❌ ${fails} FAIL — bettor payout addr determinism not guarded`); process.exit(1); }
