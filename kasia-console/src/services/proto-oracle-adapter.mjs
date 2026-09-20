// proto-oracle-adapter.mjs — oracle 整合批 B: adapter 的启动接线(开关 / 启动 LOUD / 单飞 / 生产端口装配)。设计 §10 B5 / §11。
// 🔴 默认关闭: 只有 PROTO_ORACLE_ADAPTER_ENABLED==='1' ∧ PROTO_RELAY_ID 已配置才启动(读 pmt 要走 relay); 翻开须 Owner(与 driver 开关同级)。
// 🔴 N5b: 启动 LOUD 打印生效策略(网络 / 零价值代币白名单); 主网上只有白名单代币的判定题会被扫描 / promote(judgedMarketAllowedHere 三处强制之③在 core 里)。
// 🔴 UMA 定稿窗断言: voter 导出的生效值必须有限且 ≥ 24h, 否则拒启动(SHOULD①; NaN 会让 voter 的 \`> 0\` 判定为假 = 窗被静默关闭)。
// 独立 service(自己的 interval), 不塞进旧 voterTick——不碰旧 voter 的循环; 只复用 derive* 函数。
import { wrapTick } from '../lib/diag-step.mjs';
import { PROTO_RELAY_ID } from '../lib/proto-relay-guard.mjs';
import { configuredNetwork } from '../../../shared/lib/kaspa-network.mjs';
import { resolveOraclePolicy, logOraclePolicy, ENV_ADAPTER_ENABLED } from '../lib/proto-oracle-policy.mjs';
import { assertUmaWindowSafe } from '../lib/proto-oracle-verdict.mjs';
import { runOracleAdapterTick } from '../lib/proto-oracle-adapter-core.mjs';
import { resolveBudgetConfig, readValidatedPmt, sharedPmtValidator } from '../lib/proto-settlement-budget.mjs';
import { settlementIntervalMs } from './proto-settlement-driver.mjs';
import { sqlite } from '../db/client.js';

const DEFAULT_INTERVAL_MS = 300_000, MIN_INTERVAL_MS = 30_000;
export function oracleAdapterIntervalMs(env = process.env) { const v = Number(env.PROTO_ORACLE_ADAPTER_INTERVAL_MS); return Number.isInteger(v) && v >= MIN_INTERVAL_MS ? v : DEFAULT_INTERVAL_MS; }
export function isProtoOracleAdapterEnabled({ env = process.env, relayId = PROTO_RELAY_ID } = {}) { return env[ENV_ADAPTER_ENABLED] === '1' && !!relayId; }

let _started = false, _interval = null, _inFlight = false;
export function oracleAdapterState() { return { started: _started, inFlight: _inFlight }; }

export async function oracleAdapterTickBody({ relayId, network, cfg, log = console, deps = {} }) {
  if (_inFlight) { log.log?.('[proto-oracle-adapter] tick skipped (previous tick still in flight)'); return { skipped: true, reason: 'in_flight' }; }
  _inFlight = true;
  try {
    const voter = deps.voter || await import('./bettor-prediction-voter.js');
    const send = deps.sendCmd || (await import('../lib/proto-relay-ipc.mjs')).protoSendCmd;
    const s = await runOracleAdapterTick({
      db: deps.db || sqlite, cfg, network, log, umaWindowMs: voter.UMA_FINALIZATION_WINDOW_MS,
      readPmt: deps.readPmt || (() => readValidatedPmt({ sendCmd: send, relayId, validator: sharedPmtValidator(cfg.lagMaxMs) })),
      deriveExtractor: deps.deriveExtractor || voter.deriveKanetNativeVote, deriveUma: deps.deriveUma || voter.derivePolymarketVote,
    });
    if (s.scanned || s.aborted) log.log?.(`[proto-oracle-adapter] tick: ${JSON.stringify(s)}`);
    return s;
  } finally { _inFlight = false; }
}

export async function startProtoOracleAdapter({ env = process.env, relayId = PROTO_RELAY_ID, log = console, deps } = {}) {
  if (_started) return;
  if (!isProtoOracleAdapterEnabled({ env, relayId })) { log.log('[proto-oracle-adapter] disabled'); return; }
  let network;
  try { network = configuredNetwork(env); } catch (e) { log.error(`[proto-oracle-adapter] REFUSED to start: ${e.message}`); return; }
  logOraclePolicy(log, resolveOraclePolicy({ env, network }));
  let cfg;
  try { const r = resolveBudgetConfig(env, { tickMs: settlementIntervalMs(env) }); for (const w of r.warnings) log.error(`[proto-oracle-adapter] BUDGET CONFIG (LOUD): ${w}`); cfg = r.config; }
  catch (e) { log.error(`[proto-oracle-adapter] REFUSED to start: ${e.message}`); return; }
  // SHOULD①(NWT 复核): voter 模块导入失败(依赖缺失 / 语法错 / 环境)不得拖垮 console 顶层启动 ⇒ LOUD 拒启动(adapter 不启动 = 默认关闭同态, 安全)
  let voter;
  try { voter = (deps && deps.voter) || await (deps && deps.importVoter ? deps.importVoter() : import('./bettor-prediction-voter.js')); }
  catch (e) { log.error(`[proto-oracle-adapter] REFUSED to start: 无法导入 bettor-prediction-voter(UMA 定稿窗 / derive 引擎来源): ${e && e.message ? e.message : e}`); return; }
  const uma = assertUmaWindowSafe(voter && voter.UMA_FINALIZATION_WINDOW_MS);
  if (!uma.ok) { log.error(`[proto-oracle-adapter] REFUSED to start: ${uma.reason}`); return; }
  const intervalMs = oracleAdapterIntervalMs(env);
  _started = true;
  _interval = setInterval(wrapTick('proto-oracle-adapter.tick', () => oracleAdapterTickBody({ relayId, network, cfg, log, deps }).catch((e) => log.error('[proto-oracle-adapter] tick error:', e.message))), intervalMs);
  log.log(`[proto-oracle-adapter] started (tick ${intervalMs}ms, network=${network}, uma_window_ms=${voter.UMA_FINALIZATION_WINDOW_MS})`);
}

export function stopProtoOracleAdapter() { if (_interval) { clearInterval(_interval); _interval = null; } _started = false; }
