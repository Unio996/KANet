/**
 * Regression test — chain naming 'bsc' vs 'bnb' consistency / normalize layer
 *
 * Bug 2 (5/12 sediment §3.2): broker-v3 menu/state-machine 用 'bsc', 但 DB schema
 * `/api/relay/:id/wallets` 返 'bnb' for BSC wallet, cross-chain-verify._SCAN_RPC_LIST 也用 'bnb'.
 * accept 校验 selected_chain against accepted_chains[].chain + taker wallet chain 两边都拒.
 *
 * Guard: source-level — 要么 (a) state-machine 改用 'bnb' OR (b) _SCAN_RPC_LIST 加 'bsc' alias
 * OR (c) 协议层加 normalize 函数 (bsc <-> bnb 双向).
 *
 * 失败说明 normalize layer 仍缺失 OR bug 被 reintroduce.
 *
 * 跑法: node --test cases/exchange/*.test.mjs
 *
 * NWT spec ea519032a §2.2, J2 ship P0.1 sub-task #2/3.
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_MACHINE = readFileSync(join(__dirname, '../../../src/services/broker-v3/state-machine.js'), 'utf-8');
const CROSS_VERIFY = readFileSync(join(__dirname, '../../../src/services/cross-chain-verify.mjs'), 'utf-8');
const EXCHANGE_API = readFileSync(join(__dirname, '../../../src/api/exchange.js'), 'utf-8');

test('chain naming bridged — literal-consistent OR normalize-layer present (regression guard)', () => {
  // T-J2-2026-05-12 修法 ship 后修订: literal-string 一致 OR normalize layer 存在 都视作 fix.
  // 5/12 fix 走 normalize layer (api/exchange.js + broker-v3/router.js 加 normalizeChainKey, runtime
  // 比较前双侧规范化), state-machine.js 仍用 'bsc' 显示 label, _SCAN_RPC_LIST 仍用 'bnb' DB-canonical —
  // literal 仍 differ 但 runtime 不撞 bug.
  const smHasBsc = /SUPPORTED_CHAINS[\s\S]{0,200}'bsc'/.test(STATE_MACHINE);
  const smHasBnb = /SUPPORTED_CHAINS[\s\S]{0,200}'bnb'/.test(STATE_MACHINE);
  const cvHasBnb = /_SCAN_RPC_LIST\s*=\s*\{[\s\S]{0,200}bnb\s*:/.test(CROSS_VERIFY);
  const cvHasBsc = /_SCAN_RPC_LIST\s*=\s*\{[\s\S]{0,200}bsc\s*:/.test(CROSS_VERIFY);
  const literalConsistent = (smHasBsc && cvHasBsc && !smHasBnb && !cvHasBnb)
                         || (smHasBnb && cvHasBnb && !smHasBsc && !cvHasBsc);

  // normalize layer 探测: api/exchange.js + broker-v3/router.js 都得有 normalizeChainKey()
  const apiHasNormalize = /normalizeChainKey\s*\(/.test(EXCHANGE_API);
  const routerJs = readFileSync(join(__dirname, '../../../src/services/broker-v3/router.js'), 'utf-8');
  const routerHasNormalize = /normalizeChainKey\s*\(/.test(routerJs);
  const normalizeLayerPresent = apiHasNormalize && routerHasNormalize;

  assert.ok(
    literalConsistent || normalizeLayerPresent,
    `chain naming bug §3.2 not bridged: literalConsistent=${literalConsistent}, normalizeLayer(api=${apiHasNormalize}, router=${routerHasNormalize}). 修法选 (a) 统一命名 OR (b) normalize layer 两端都有.`,
  );
});

test('api/exchange.js MUST have chain normalize OR accept both bsc/bnb aliases (regression guard)', () => {
  // 直到 (consistent naming) OR (normalize function) 一方成立, 本 case fail.
  // 检 normalize function 存在: 'normalizeChain' / 'chainAlias' / 'bnb' 跟 'bsc' map 一起出现
  const hasNormalize = /normalizeChain|chainAlias|chain.*alias|bnb.*['"]\s*:\s*['"]bsc|bsc.*['"]\s*:\s*['"]bnb/.test(EXCHANGE_API);
  // OR check accept handler 接受 'bsc' OR 'bnb' 两个 alias (字面 grep)
  const handlerAcceptsBoth = /['"]bsc['"]\s*\|\|\s*['"]bnb['"]|['"]bnb['"]\s*\|\|\s*['"]bsc['"]/.test(EXCHANGE_API);
  assert.ok(
    hasNormalize || handlerAcceptsBoth,
    "api/exchange.js missing chain normalize function OR bsc/bnb alias accept logic (5/12 sediment §3.2 bug 仍存在). 修法: 加 normalizeChainKey(input) 函数 OR /api/exchange/accept 内 selected_chain 接受 'bsc' OR 'bnb' 两 alias",
  );
});
