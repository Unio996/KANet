// covenant-broadcast-relay.mjs — relay 侧 covenant_broadcast 命令的胶水逻辑(J2 2026-09-14, 接线笔①,
// Owner §6=B′ 拍板后·设计 docs/2026-09-14-j2-proto-v0-backend-api-design-v0.1.md §9/§9.5)。
//
// 职责分层(同 submit-intent-relay.mjs 既有模式): covenant-broadcast.mjs 那 6 个纯函数/薄适配层不碰
// IPC/HTTP/RPC/私钥存取——本文件才是"把它们拼起来、真的去签、真的去广播、真的去落两阶段回执"的那一层。
//
// 🔴 执行权限门(设计 §9.2③, Bettor 1365 接线笔①): 只有 process.env.RELAY_NODE_ID === PROTO_RELAY_ID
// 的那一个 relay 才允许执行这条命令——其余 relay 直接拒绝 + LOUD 日志, 不进入任何签名/广播逻辑。
// PROTO_RELAY_ID 未配置 = 无人被授权(fail-closed 方向), 不是"随便哪个 relay 都能执行"。
//
// 两阶段回执(设计 §9.5): prepared 在真正广播前落 proto_bet_intents 表(fail-closed: ingest 失败就不
// 广播), submitted 在广播后落表(失败不可撤回, 返回 code:'ingest_after_broadcast_failed' 让 console
// 侧调用方有机会本地立即补一次, 不必等 resumeStaleBetIntents 下一轮扫描)。
//
// 🔴 net_loss 上限设计(Bettor 1386①/NWT 1387 架构裁定, 覆盖 covenant construction spec §9.2 修订):
// relay 侧**硬编码** `GLOBAL_ABS_FEE_CAP_SOMPI`(1.0 KAS)作为 `validateNetLoss` 的 `absFeeCapSompi`
// 参数——**绝不从 `cmd` 读取任何"这次该用哪个 cap"的字段**。NWT 明确裁定: kind→cap 的精细映射必须
// 硬编码在 console 侧各 kind 自己的代码路径里(buildAndBroadcast 内部为每个 kind 分别调一次
// `validateNetLoss(..., absFeeCapSompi=CAP_<KIND>)` 做预检查), 不能由请求体/调用方/命令字段影响
// relay 侧用哪个 cap——否则攻击者能给任意一笔交易贴上"cap 最宽的 kind"标签绕过更严格的限制。
// relay 侧因此只做一层粗粒度、与 kind 无关的最终兜底(GLOBAL 硬顶)，per-kind 的精细校验在 console
// 侧完成、relay 完全不信任、也不需要知道"这是哪个 kind"。
import {
  validateSignedInputCeiling, computeRequiredFeeSompi, validateNetLoss,
  extractTxShape, assertFinalTxid, signOnlyDeclaredInputs, GLOBAL_ABS_FEE_CAP_SOMPI,
} from './covenant-broadcast.mjs';
import { ingestProtoBetIntentPhase } from '../ingest.mjs';

// 🔴 transaction.mjs 顶层 `import * as kaspa from 'kaspa-wasm'`——静态 import 它(哪怕只是为了默认
// 参数值)会在没装 kaspa-wasm 的环境(如本文件自己的离线单测)直接在模块加载阶段炸掉, 即使测试从不
// 真的走 replay path。改成惰性动态 import, 只有调用方没注入 replayFn 时才真的加载它。

const _done = new Map(); // intent_key → { txId } — 同 submit-intent-relay.mjs 既有模式(进程内幂等)

export function _covenantDoneSize() { return _done.size; }

/**
 * @param {object} o
 * @param {object} o.cmd  relay.mjs 收到的 IPC 命令体(covenant_broadcast 类型)
 * @param {*} o.kaspa  kaspa-wasm 模块(注入, 供测试用假实现替换)
 * @param {*} o.rpc  已连接的 RPC client(submitTransaction 用)
 * @param {*} o.wallet  relay 自己的 KaspaWallet(getPrivateKey()/getAddress())
 * @param {string} o.networkId  computeRequiredFeeSompi 用
 * @param {string} o.senderAddress  replay path 的 replayPreparedTransactions 用(relay 自己地址)
 * @param {Function} [o.log]
 * @param {Function} [o.replayFn]  注入点, 供测试替换
 * @param {Function} [o.ingestPhase]  注入点, 供测试替换(默认 ingestProtoBetIntentPhase)
 * @returns {Promise<{ok:boolean, txId?:string, code?:string, error?:string, intent_key?:string, reused?:boolean}>}
 */
export async function covenantBroadcastRelay({
  cmd, kaspa, rpc, wallet, networkId, senderAddress,
  log = console.log, replayFn = null, ingestPhase = ingestProtoBetIntentPhase,
}) {
  const key = cmd.intent_key;
  if (!key) return { ok: false, error: 'intent_key required' };

  // 🔴 执行权限门 — 在任何签名/广播逻辑之前拒绝, LOUD 日志(§9.2③)。
  const RELAY_NODE_ID = process.env.RELAY_NODE_ID || '';
  const PROTO_RELAY_ID = process.env.PROTO_RELAY_ID || '';
  if (!PROTO_RELAY_ID || RELAY_NODE_ID !== PROTO_RELAY_ID) {
    log(`🔴 COVENANT_BROADCAST ${key} DENIED: this relay(RELAY_NODE_ID=${RELAY_NODE_ID || '(unset)'}) is not PROTO_RELAY_ID(${PROTO_RELAY_ID || 'NOT SET'}) — refusing before touching tx/signing`);
    return { ok: false, code: 'not_proto_relay', error: 'this relay is not authorized to execute covenant_broadcast', intent_key: key };
  }

  const prev = _done.get(key);
  if (prev) {
    log(`COVENANT_BROADCAST ${key} already submitted in this process → ${prev.txId?.slice(0, 12)} (no rebroadcast)`);
    return { ok: true, txId: prev.txId, intent_key: key, reused: true };
  }

  // ── replay path(同字节重播, 复用 replayPreparedTransactions——它对任意已签名交易通用, 不局限于
  //    plain transfer, 只做反序列化+finalize+mempool/UTXO 检查+提交) ──
  if (cmd.replay_tx_json) {
    if (!cmd.prepared_txid) return { ok: false, code: 'replay_txid_mismatch', error: 'replay requires prepared_txid', intent_key: key };
    let list;
    try {
      list = JSON.parse(cmd.replay_tx_json);
      if (!Array.isArray(list) || !list.length) throw new Error('expected non-empty array');
    } catch (e) {
      return { ok: false, code: 'replay_bad_json', error: `replay_tx_json unparsable: ${e.message}`, intent_key: key };
    }
    const doReplay = replayFn || (await import('./transaction.mjs')).replayPreparedTransactions;
    const r = await doReplay({ txJsonList: list, expectedTxId: cmd.prepared_txid, senderAddress, targetAddress: cmd.target_address || null, rpcOverride: rpc });
    if (r.ok) {
      _done.set(key, { txId: r.txId });
      try { await ingestPhase({ intentKey: key, phase: 'submitted', txid: r.txId }); }
      catch (e) {
        log(`⚠ COVENANT_BROADCAST ${key} submitted receipt not recorded (post-replay): ${e.message} (IPC reply still carries txId)`);
        return { ...r, intent_key: key, code: 'ingest_after_broadcast_failed' };
      }
      log(`COVENANT_BROADCAST ${key} replay ${r.alreadyInMempool ? 'already in mempool' : r.alreadyLanded ? 'already landed' : 'rebroadcast same bytes'} → ${r.txId.slice(0, 12)}`);
    } else {
      log(`COVENANT_BROADCAST ${key} replay refused: ${r.code} ${r.error}`);
    }
    return { ...r, intent_key: key };
  }

  // ── fresh path(首次构造: 校验→签名→§9.2 校验→prepared 落表→广播→submitted 落表) ──
  if (!cmd.tx_json) return { ok: false, error: 'tx_json required (fresh construction path)', intent_key: key };
  if (!Array.isArray(cmd.sign_input_indices) || !cmd.sign_input_indices.length) return { ok: false, error: 'sign_input_indices must be a non-empty array', intent_key: key };
  if (!cmd.expected_txid) return { ok: false, error: 'expected_txid required', intent_key: key };

  const { Transaction, Address, payToAddressScript } = kaspa;
  let tx;
  try {
    tx = Transaction.deserializeFromSafeJSON(typeof cmd.tx_json === 'string' ? cmd.tx_json : JSON.stringify(cmd.tx_json));
  } catch (e) {
    return { ok: false, code: 'bad_tx_json', error: `deserialize failed: ${e.message}`, intent_key: key };
  }

  const shape = extractTxShape(tx); // 只提取一次——amountSompi/scriptPubKeyRaw 都不受后续签名影响

  const sic = validateSignedInputCeiling({ inputs: shape.inputs, signInputIndices: cmd.sign_input_indices });
  if (!sic.ok) {
    log(`COVENANT_BROADCAST ${key} REJECTED (signed input ceiling): ${sic.reason}`);
    return { ok: false, code: 'signed_input_ceiling_exceeded', error: sic.reason, intent_key: key };
  }

  try {
    signOnlyDeclaredInputs({ tx, signInputIndices: cmd.sign_input_indices, privateKey: wallet.getPrivateKey(), kaspa });
  } catch (e) {
    log(`COVENANT_BROADCAST ${key} sign failed: ${e.message}`);
    return { ok: false, code: 'sign_failed', error: e.message, intent_key: key };
  }

  tx.finalize();
  const txidCheck = assertFinalTxid(tx, cmd.expected_txid);
  if (!txidCheck.ok) {
    log(`COVENANT_BROADCAST ${key} REJECTED (txid mismatch): expected ${cmd.expected_txid?.slice(0, 12)} got ${txidCheck.actualTxid?.slice(0, 12)}`);
    return { ok: false, code: 'txid_mismatch', error: `finalized txid ${txidCheck.actualTxid} != expected_txid ${cmd.expected_txid}`, intent_key: key };
  }

  let requiredFeeSompi;
  try {
    requiredFeeSompi = computeRequiredFeeSompi({ kaspa, networkId, signedTx: tx });
  } catch (e) {
    log(`COVENANT_BROADCAST ${key} REJECTED (fee calc failed): ${e.message}`);
    return { ok: false, code: 'fee_calc_failed', error: e.message, intent_key: key };
  }

  const relayScriptPubKey = payToAddressScript(new Address(wallet.getAddress()));
  // 🔴 硬编码 GLOBAL_ABS_FEE_CAP_SOMPI, 不读 cmd 的任何字段(见文件头注)——relay 这一层只做
  // kind-无关的最终兜底, per-kind 更严格的上限是 console 侧的责任, relay 不信任、不需要知道 kind。
  const nl = validateNetLoss({
    inputs: shape.inputs, outputs: shape.outputs, signInputIndices: cmd.sign_input_indices,
    relayScriptPubKey, requiredFeeSompi, absFeeCapSompi: GLOBAL_ABS_FEE_CAP_SOMPI,
  });
  if (!nl.ok) {
    log(`COVENANT_BROADCAST ${key} REJECTED (net loss exceeds ceiling): ${nl.reason}`);
    return { ok: false, code: 'net_loss_exceeded', error: nl.reason, intent_key: key };
  }

  const txid = tx.id;
  const txJson = tx.serializeToSafeJSON();
  // 🔴 prepared 阶段 fail-closed(设计 §9.5③): ingest 失败 ⇒ 不广播。
  try {
    await ingestPhase({ intentKey: key, phase: 'prepared', txid, txJson: JSON.stringify([txJson]) });
  } catch (e) {
    log(`COVENANT_BROADCAST ${key} prepared receipt failed, refusing to broadcast: ${e.message}`);
    return { ok: false, code: 'prepared_ingest_failed', error: e.message, intent_key: key };
  }
  log(`COVENANT_BROADCAST ${key} prepared txid ${txid.slice(0, 12)} (bytes persisted at console) → broadcasting`);

  try {
    await rpc.submitTransaction({ transaction: tx, allowOrphan: false });
  } catch (e) {
    log(`COVENANT_BROADCAST ${key} broadcast failed: ${e.message}`);
    return { ok: false, code: 'broadcast_failed', error: e.message, intent_key: key };
  }
  _done.set(key, { txId: txid });

  // submitted 阶段: 已广播的事实不可撤——ingest 失败也返回 ok:true, 但带 code 让调用方知道要不要兜底。
  try {
    await ingestPhase({ intentKey: key, phase: 'submitted', txid });
  } catch (e) {
    log(`⚠ COVENANT_BROADCAST ${key} submitted receipt not recorded: ${e.message} (IPC reply still carries txId)`);
    return { ok: true, txId: txid, intent_key: key, code: 'ingest_after_broadcast_failed' };
  }
  return { ok: true, txId: txid, intent_key: key };
}
