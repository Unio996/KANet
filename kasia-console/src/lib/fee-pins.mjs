// fee-pins.mjs — 账本1855 A: 多盘并发下保护"已创建、尚未花掉"的 fee UTXO(close 提交费 / claim 费)不被别的 tx 或 UTXO 整理吃掉。
//
// 根因(S3 run1 btduw): close 提交费 UTXO 在 propose 阶段创建(bshard-close-transport buildProposeCloseRequestV2, 转 0.5 KAS 给 settler 自己),
// 到 submit 阶段(委员签名等待, 分钟级)才花; 期间同 relay 的别的 tx(非自转账 sendKaspa 取"最小够用 UTXO")或 rebalance 会把它当普通候选吃掉 ⇒ UTXO not found ⇒ 卡死。
// 修法 = 复用 relay 既有的"候选过滤"咽喉 filterPendingUtxos, 加长 TTL 的【排除名单】(relay 命令 pin_utxo/unpin_utxo, 见 kasia-relay/src/lib/transaction.mjs)。
// 本文件只做 console 侧: (1) 发 pin/unpin 命令(永不 throw, 失败 LOUD 但不挡主流程——pin 只是保护层, 不是花钱路径);
// (2) 由 DB 派生"应该被 pin 的集合"(重启/relay 重启后重发, 同 proto-fee-reservation 的 DB 派生层思路, 但不依赖 proto_* 表);
//     单盘 metadata 解析失败 ⇒ LOUD + HOLD 该盘(不 pin, 回调 onHold), 不挡其余盘。
//
// 🔴 pin 只排除: 不选择、不花费、不改任何 tx 构造; 过期自愈(relay 侧 TTL)。
// 测试用开关 ZK_FEE_PINS_DISABLED=1: 全部变 no-op(用于"关 pin 复现卡死"的负对照; 生产默认开, 不设)。

const OUTPOINT_RE = /^[0-9a-f]{64}$/;
export const CLOSE_PIN_TTL_MS = 6 * 3600_000;   // close 请求窗口(委员签名 + prove 前), 6h; 每个 submit tick 续期
export const CLAIM_FEE_PIN_TTL_MS = 15 * 60_000;  // claim/zk_close fee: 用完即花, 15min 兜底自愈

export const feePinsDisabled = () => process.env.ZK_FEE_PINS_DISABLED === '1';

/** send: (cmd) => Promise<result>(调用方闭包 sendCommandAsync(relayId, cmd, timeout, 'internal'))。永不 throw。 */
export async function pinFeeUtxo(send, { txid, index = 0 }, { ttlMs = CLOSE_PIN_TTL_MS, tag = '' } = {}) {
  if (feePinsDisabled()) return { ok: true, skipped: 'disabled' };
  try {
    const r = await send({ type: 'pin_utxo', txid, index, ttl_ms: ttlMs });
    if (r?.ok === false || r?.error) throw new Error(r.error || 'pin_utxo rejected');
    return { ok: true };
  } catch (e) {
    console.error(`[fee-pins] 🔴 pin_utxo FAIL ${tag} ${String(txid).slice(0, 12)}:${index} — ${e.message} (该 fee UTXO 暂不受保护; 下个 resync tick 重试)`);
    return { ok: false, error: e.message };
  }
}

export async function unpinFeeUtxo(send, { txid, index = 0 }, { tag = '' } = {}) {
  if (feePinsDisabled()) return { ok: true, skipped: 'disabled' };
  try {
    const r = await send({ type: 'unpin_utxo', txid, index });
    if (r?.ok === false || r?.error) throw new Error(r.error || 'unpin_utxo rejected');
    return { ok: true };
  } catch (e) {
    console.warn(`[fee-pins] unpin_utxo fail ${tag} ${String(txid).slice(0, 12)}:${index} — ${e.message} (无害: relay 侧 TTL 自愈)`);
    return { ok: false, error: e.message };
  }
}

/**
 * deriveClosePins — 从 DB 派生"close 提交费应被 pin"的集合: protocol_status='collecting_sigs' 且 metadata.bshard_close_request_v2.closeInputs.fee 在。
 * (submit 落链后 clearCloseRequest 会删掉 request ⇒ 集合自然缩小, 无需另存状态。)
 * 单盘解析/形状错 ⇒ held(LOUD), 其余盘照常。
 * @param {{prepare:Function}} db
 * @returns {{pins:Array<{marketId:string,txid:string,index:number,address:string|null}>, held:Array<{marketId:string,reason:string}>}}
 */
export function deriveClosePins(db) {
  const rows = db.prepare(`SELECT id, metadata FROM pool_markets WHERE protocol_version = 'v0.7' AND protocol_status = 'collecting_sigs' AND metadata LIKE '%bshard_close_request_v2%'`).all();
  const pins = [], held = [];
  for (const row of rows) {
    try {
      const req = JSON.parse(row.metadata || '{}').bshard_close_request_v2;
      const fee = req?.closeInputs?.fee;
      if (!fee) throw new Error('closeInputs.fee 缺失');
      const txid = String(fee.outpointTxid || '').toLowerCase();
      const index = Number(fee.index ?? 0);
      if (!OUTPOINT_RE.test(txid) || !Number.isInteger(index) || index < 0) throw new Error(`fee outpoint 非法(${txid.slice(0, 16)}:${fee.index})`);
      pins.push({ marketId: row.id, txid, index, address: fee.address ?? null });
    } catch (e) {
      console.error(`[fee-pins] 🔴 market=${String(row.id).slice(-8)} close fee pin 派生失败 — HOLD 该盘(不 pin; 其余盘不受影响): ${e.message}`);
      held.push({ marketId: row.id, reason: e.message });
    }
  }
  return { pins, held };
}

/** resyncClosePins — 每个 submit tick(及控制台启动后首个 tick)调用: 把派生集合重发给 settler relay(幂等续期)。 */
export async function resyncClosePins({ db, send, onHold }) {
  if (feePinsDisabled()) return { pinned: 0, held: 0, failed: 0, skipped: 'disabled' };
  const { pins, held } = deriveClosePins(db);
  for (const h of held) { try { onHold?.(h.marketId, h.reason); } catch { /* 回调失败不影响其余 */ } }
  let pinned = 0, failed = 0;
  for (const p of pins) {
    const r = await pinFeeUtxo(send, p, { tag: `market=${p.marketId.slice(-8)}` });
    if (r.ok) pinned++; else failed++;
  }
  return { pinned, held: held.length, failed };
}
