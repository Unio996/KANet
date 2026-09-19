// NWT 批9 9-2b(iii-1) 审: (A)真实接线的具名依赖是否都存在、createSettlementDriver 能否用真实端口构造; (B) landed 后效未应用(意图已 landed、市场状态没推进)的恢复缺口; (C) claim id 过出口。
// 真实迁移的临时库(我自己的临时目录); 零链 / 零 IPC(桩) / 零私钥。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { createRequire, } from 'node:module';
import { pathToFileURL } from 'node:url';
const CON = 'D:/kanet-nwt-cand/kasia-console';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nwt-92b3-'));
const DB = path.join(tmpDir, 'c.db');
process.env.CONSOLE_ENCRYPTION_KEY = '0'.repeat(64); process.env.PROTO_RELAY_ID = 'nwt-probe-relay';
execSync('node scripts/run-migrations.mjs', { cwd: CON, env: { ...process.env, DB_PATH: DB }, stdio: 'pipe' });
process.env.DB_PATH = DB;
const imp = (p) => import(pathToFileURL(CON + '/src/' + p).href);
const { sqlite } = await imp('db/client.js');
const SI = await imp('lib/proto-settlement-intent.mjs');
const { createSettlementStore, newClaimId } = await imp('lib/proto-settlement-store.mjs');
const core = await imp('lib/proto-settlement-driver-core.mjs');
const ipc = await imp('lib/proto-relay-ipc.mjs');
const { CLAIM_DRAW_CLAIM_OUT_INDEX } = await imp('lib/proto-tx-assembly-settlement.mjs');
const out = [];
const hex64 = () => crypto.randomBytes(32).toString('hex');
const T0 = '2026-09-20T00:00:00.000Z';

// ── (A) 具名依赖存在性(wiring 文件 import 的东西)
const wiring = await imp('services/proto-settlement-driver.mjs');
const c1 = await imp('lib/proto-settlement-c1.mjs'); const ptr = await imp('lib/proto-settlement-pointers.mjs'); const guard = await imp('lib/proto-relay-guard.mjs');
const shared = await import(pathToFileURL('D:/kanet-nwt-cand/shared/lib/kaspa-network.mjs').href);
const need = { 'SI.alertSettlementIntent': SI.alertSettlementIntent, 'SI.ensureSettlementIntent': SI.ensureSettlementIntent, 'SI.activeSettlementIntent': SI.activeSettlementIntent, 'SI.getSettlementIntent': SI.getSettlementIntent, 'SI.markSettlementIntent': SI.markSettlementIntent, 'SI.driveSettlementIntent': SI.driveSettlementIntent, 'SI.checkSettlementIntentLanded': SI.checkSettlementIntentLanded, 'c1.verifyStepInputsOnChain': c1.verifyStepInputsOnChain, 'c1.MIN_STEP_BUDGET_MS': c1.MIN_STEP_BUDGET_MS, 'c1.MIN_FACTS_IPC_TIMEOUT_MS': c1.MIN_FACTS_IPC_TIMEOUT_MS, 'ptr.resolveStepPointers': ptr.resolveStepPointers, 'guard.assertProtoRelayHealthy': guard.assertProtoRelayHealthy, 'shared.configuredNetwork': shared.configuredNetwork, 'shared.prefixForNetwork': shared.prefixForNetwork, 'shared.addressPrefix': shared.addressPrefix, 'assembly.CLAIM_DRAW_CLAIM_OUT_INDEX': CLAIM_DRAW_CLAIM_OUT_INDEX };
out.push('A named deps missing: ' + JSON.stringify(Object.entries(need).filter(([, v]) => v === undefined || v === null).map(([k]) => k)));
const kaspa = createRequire(CON + '/package.json')('kaspa-wasm');
const fresh = new kaspa.PrivateKey(crypto.randomBytes(32).toString('hex')).toPublicKey().toAddress('mainnet').toString();
try {
  const drv = await wiring.buildProductionDriver({ health: { address: fresh }, network: 'mainnet', ops: { prepare: async () => ({}), build: async () => ({}) }, kaspa, sendCmd: async () => ({}), relayId: 'nwt-probe-relay', tickIntervalMs: 60000 });
  out.push('A buildProductionDriver(real ports + stub ops): constructed, methods=' + Object.keys(drv).join(','));
} catch (e) { out.push('A buildProductionDriver THREW: ' + e.constructor.name + ': ' + e.message.slice(0, 160)); }
out.push('A relay-address network check: mainnet addr vs network=mainnet => ' + (() => { try { wiring.assertRelayAddressOnNetwork({ network: 'mainnet', relayAddress: fresh }); return 'ok'; } catch (e) { return 'REFUSED'; } })() + ' ; vs simnet => ' + (() => { try { wiring.assertRelayAddressOnNetwork({ network: 'simnet', relayAddress: fresh }); return 'ok(!)'; } catch (e) { return 'REFUSED'; } })());
out.push('A stepBudgetFor(60000)=' + wiring.stepBudgetFor(60000) + '  stepBudgetFor(20000)=' + wiring.stepBudgetFor(20000) + '  stepBudgetFor(15000)=' + (() => { try { return wiring.stepBudgetFor(15000); } catch (e) { return 'REFUSED'; } })());

// ── (C) claim id 过出口
const cid = newClaimId();
out.push('C newClaimId shape=' + (/^[0-9a-f]{64}$/.test(cid) ? '64-hex' : 'BAD') + '  keys accepted by exit S9: ' + ['convert_to_claim', 'claim_draw'].map((s) => ipc.isValidSettlementIntentKey(SI.settlementIntentKeyFor('claim', cid, s))).join('/'));

// ── (B) 意图已 landed、后效没应用
sqlite.prepare('INSERT INTO proto_token_defs (id,name,ticker,created_at) VALUES (?,?,?,?)').run('tok1', 'T', 'T', T0);
function mkMarket({ status, winningSide = null }) {
  const id = hex64();
  sqlite.prepare(`INSERT INTO proto_markets (id, token_def_id, question, deadline_ms, min_bet, seal_count, committee_pubkeys_json, committee_privkey_enc, rootclose_tmpl_hash, shardleaf_txid, shardleaf_vout, status, winning_side, created_at, updated_at)
    VALUES (?, 'tok1', 'q', 1000, 600, 2, '[]', 'enc', ?, ?, 0, ?, ?, ?, ?)`).run(id, hex64(), hex64(), status, winningSide, T0, T0);
  return id;
}
const mkIntent = (st, id, step, status, txid = null) => { const key = SI.settlementIntentKeyFor(st, id, step); sqlite.prepare('INSERT INTO proto_settlement_intents (intent_key, subject_type, subject_id, step, status, submitted_txid, prepared_txid, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(key, st, id, step, status, txid, txid, T0, T0); return key; };
const store = createSettlementStore({ claimDrawClaimOutIndex: CLAIM_DRAW_CLAIM_OUT_INDEX, now: () => T0 });
const mSealed = mkMarket({ status: 'betting' }); mkIntent('market', mSealed, 'seal', 'landed', hex64());
const mResolve = mkMarket({ status: 'sealed', winningSide: 0 }); mkIntent('market', mResolve, 'seal', 'landed', hex64()); mkIntent('market', mResolve, 'resolve', 'landed', hex64());
const w = store.listWork();
const mentions = (id) => [...w.advances, ...w.landedChecks, ...w.preparedRows].filter((x) => (x.subjectId || x.subject_id || x.marketId) === id).length;
out.push(`B1 seal intent LANDED but market still 'betting' (aftermath not applied): listWork mentions it in ${mentions(mSealed)} places  => ${mentions(mSealed) === 0 ? 'STRANDED (nothing will ever re-run markLanded)' : 'recovered'}`);
out.push(`B2 resolve intent LANDED but market still 'sealed', no claim row: listWork mentions it in ${mentions(mResolve)} places  => ${mentions(mResolve) === 0 ? 'STRANDED' : 'recovered'}`);
// 端到端: 真核心 + 真 store + 真意图表; check_utxo_landed 桩返回 landed; 市场没有下注 ⇒ deriveCloseCommitInputs 失败 ⇒ markLanded 抛错
const mFail = mkMarket({ status: 'sealed', winningSide: 0 }); mkIntent('market', mFail, 'seal', 'landed', hex64()); const kFail = mkIntent('market', mFail, 'resolve', 'submitted', hex64());
const alerts = [];
const deps = { sendCmd: async (rid, cmd) => (cmd.type === 'check_utxo_landed' ? { landed: true, depth: 99 } : { ok: true }), relayId: 'r', alert: (n) => alerts.push(n), intents: { ensure: SI.ensureSettlementIntent, active: SI.activeSettlementIntent, get: SI.getSettlementIntent, mark: SI.markSettlementIntent },
  driveIntent: SI.driveSettlementIntent, pointers: () => ({}), prepare: async () => ({ targetAddress: 'kaspa:x' }), verifyOnChain: async () => ({}), build: async () => ({}), dependenciesLanded: async () => ({ ok: true }),
  checkLanded: SI.checkSettlementIntentLanded, markLanded: async (s, i) => store.markLanded(s, i), listWork: async () => ({ ...store.listWork(), advances: [] }), minDepth: 20, now: Date.now, log: { log() {} } };
const drv = core.createSettlementDriver(deps);
const t1 = await drv.runTick({ cap: 5 });
const rowAfter = SI.getSettlementIntent(kFail); const mAfter = sqlite.prepare('SELECT status FROM proto_markets WHERE id = ?').get(mFail).status;
out.push(`B3 tick1 (check landed OK, markLanded throws): results=${JSON.stringify(t1.results.map((r) => r.outcome))} intent.status=${rowAfter.status} market.status=${mAfter} alerts=[${alerts.join(',')}]`);
const w2 = store.listWork(); const again = [...w2.advances, ...w2.landedChecks].filter((x) => (x.subjectId || x.subject_id) === mFail).length;
out.push(`B3 tick2 work items for that market: ${again}  (intent is 'landed' so it is no longer 'submitted'; market stays '${mAfter}' with a landed chain tx)`);
console.log(out.join('\n'));
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
process.exit(0);
