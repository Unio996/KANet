/**
 * UTXO Splitter — Console-side orchestrator.
 *
 * Delegates actual signing/RPC to Relay via IPC (split_utxo command).
 * Console never touches kaspa-wasm or private keys.
 */
import { sqlite } from '../db/client.js';
import { sendCommandAsync } from './relay-manager.js';

// Round 1 真测 (2026-04-25) 显示 broker 高峰一分钟 7 笔, 3 个 UTXO 不够 → mempool 双花风暴.
// J2 raw log 03:09:34 累积 17 次 Trader-B Reply send failed. 调到 8 给高频 Agent 留余量.
const TARGET_UTXO_COUNT = 8;

// TREASURY-UTXO-UNREADABLE card (2026-08-10): these two addresses' UTXO sets are so large that
// getUtxosByAddresses traps the wasm client (kaspa-wasm has no server-side pagination). autoSplitAll
// must never touch them until the card's root-cause fix lands — each attempt re-poisons the process.
const UNREADABLE_RELAY_IDS = new Set([
  'd9a8fffb-e9d6-4019-a9cb-fcdb4760dea1', // FaucetRelay-tn-2
  'ce43e1b1-f16b-4e2b-ba22-56cc9bb26762', // MiningRelay-tn12-new
]);

/**
 * Split UTXOs for a single relay account via Relay IPC.
 */
export async function splitUtxos(relayNodeId, targetCount = TARGET_UTXO_COUNT, opts = {}) {
  try {
    // #G4 (2026-07-04): force=true → REBALANCE (relay.mjs case 'split_utxo' → splitUtxosRelay force mode) —
    // without it, utxosBefore >= targetCount short-circuits as "sufficient" even when existing UTXOs are
    // individually too small for the caller's real need (faucet re-split: 84 dust-ish → fewer/larger, not
    // "already have enough count").
    const result = await sendCommandAsync(relayNodeId, { type: 'split_utxo', targetCount, force: opts.force === true }, 20_000, 'internal');
    return result || { ok: false, reason: 'no_response' };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// 账本 1459(闸3阻断修复, Bettor/NWT 复核): 原型 v0(proto-tx-assembly.mjs 的 market_genesis/register_append)
// 的 UTXO 形状是执行页(canary execution page)按每笔真实构造需要的最小可行 fee-input 手动/半手动摆的
// (见 docs/provenance/2026-09-15-j2-d020-register-append-fee-formula-fix/recompute-fixed-cost.mjs 算出的
// 真实阈值)，不是"越多小额 UTXO 越好"这个通用假设的适用对象——autoSplitAll 每次 console 启动都无条件对
// 全部 relay 跑 split_utxo(targetCount=8), 若原型 relay 余额不为 0(闸2 种子转账后就会是), 会把它拆成
// 8 份均等小额 UTXO, 按 KIP-9 公式那 1.95 KAS 拆 8 份每份 ≈0.24 KAS——不够任何一笔下注需要的 ≥0.56 KAS
// fee-input 门槛(见上面同一份 provenance 的注脚), 首笔下注直接 no_suitable_fee_utxo, 且白付一笔拆分手续费。
// 闸3(打开 PROTO_DRIVER_ENABLED)恰好需要重启 console 触发, 必然撞上这条——原型 relay 的 UTXO 形状交给
// 执行页自己管理, autoSplitAll 必须跳过它(同 UNREADABLE_RELAY_IDS 那条"这类 relay 不适用通用逻辑"的先例)。
function _isProtoRelay(a) {
  if (process.env.PROTO_RELAY_ID && a.id === process.env.PROTO_RELAY_ID) return true;
  if (typeof a.name === 'string' && a.name.startsWith('proto-')) return true;
  return false;
}

// D-026 (Owner 2026-09-19「加开关，主网默认关。」): every console start used to run this unconditionally and burn real mainnet
// fees (~0.045 KAS per start on 4 accounts whose UTXO count oscillates 5→4→5). Only the literal string '1' enables it; every
// other value (unset, '0', 'true', ' 1', '"1"', '01', full-width '１', '1\n', ...) leaves it OFF — the same convention as
// PROTO_DRIVER_ENABLED. Design: docs/2026-09-19-bettor-utxo-autosplit-startup-switch-design-v0.1.md (v0.2 body + §7).
export const UTXO_AUTOSPLIT_ON_START_ENV = 'UTXO_AUTOSPLIT_ON_START';

/**
 * Auto-split all relay accounts. Called after relays are started.
 */
export async function autoSplitAll() {
  // Gate FIRST — before any DB access or relay IPC. start-console-mainnet.ps1 injects env values verbatim (no trim, no
  // unquoting), so the log carries the raw value: an operator who wrote `KEY=1 ` or `KEY="1"` sees why it is still off.
  if (process.env[UTXO_AUTOSPLIT_ON_START_ENV] !== '1') {
    console.log(`[utxo-splitter] disabled (${UTXO_AUTOSPLIT_ON_START_ENV}!=1, raw=${JSON.stringify(process.env[UTXO_AUTOSPLIT_ON_START_ENV])})`);
    return { ok: true, disabled: true, split: 0, total: 0 };
  }
  console.log(`[utxo-splitter] startup autosplit enabled (${UTXO_AUTOSPLIT_ON_START_ENV}=1)`);
  const accounts = sqlite.prepare(
    `SELECT id, name FROM relay_nodes WHERE address IS NOT NULL AND mnemonic_encrypted IS NOT NULL`
  ).all();

  let splitCount = 0;
  for (const a of accounts) {
    if (UNREADABLE_RELAY_IDS.has(a.id)) {
      console.warn(`[utxo-splitter] ${a.name}: skipped: address unreadable, see card (TREASURY-UTXO-UNREADABLE)`);
      continue;
    }
    if (_isProtoRelay(a)) {
      console.log(`[utxo-splitter] ${a.name}: skip (proto relay — UTXO shape managed by execution page)`);
      continue;
    }
    try {
      const result = await splitUtxos(a.id);
      if (result.split) {
        splitCount++;
        console.log(`[utxo-splitter] ${a.name}: ${result.utxosBefore} → ${result.utxosAfter} UTXOs (fee: ${result.fee} KAS)`);
      }
    } catch (err) {
      console.log(`[utxo-splitter] ${a.name}: skip (${err.message})`);
    }
  }

  console.log(`[utxo-splitter] ${splitCount}/${accounts.length} accounts split`);
  return { ok: true, disabled: false, split: splitCount, total: accounts.length };   // for tests only; the index.js call site does not use it
}
