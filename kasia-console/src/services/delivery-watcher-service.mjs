// delivery-watcher-service.mjs — 账本1877 步3: 数字商品交付 watcher 的运行时接线(默认关)。
//   逻辑全在 lib/delivery-watcher.mjs(注入式状态机); 本文件只做: env 开关 + 真 ctx 适配 + 定时器 + 防重入。
//   🔴 开关 DELIVERY_WATCHER_ENABLED 只认字面 '1'(同 D-026/D-027 约定), 未设/其它一律关; 开启后必须配 DELIVERY_RELAY_ID(出链 relay), 缺失 ⇒ 拒启动并 LOUD(不回落任何默认 relay)。
//   开关本身是配置变更(走重启窗 + ledger 记账 + 双签); 本分支只交付接线, 不开。
import * as kaspa from 'kaspa-wasm';
import { sqlite } from '../db/client.js';
import { makeKaspaApiReaderBrowser } from '../lib/checkout-static/delivery-read.js';
import { makeTriggerSplit } from '../lib/delivery-split-adapter.mjs';
import { deliveryTick, MIN_DEPTH } from '../lib/delivery-watcher.mjs';
import { makeDeliveryRelayCall } from './delivery-relay-funnel.mjs';

export const DELIVERY_TICK_MS_DEFAULT = 30_000;

/**
 * 真 ctx 工厂(纯: 依赖全注入, 可测)。relayCall(cmd) → relay 回执; reader = ReadBackend; networkOf(order) → 'mainnet' 等。
 * 每个出链动作都是 relay 窄命令; 本进程不碰链、不持私钥。
 */
export function buildDeliveryCtx({ db, relayCall, readerFor, kaspaMod, nowMs = () => Date.now(), log = () => {} }) {
  return {
    readHistory: async (address, order) => readerFor(order?.network).listAddressTxs(address),
    getUtxos: async (address) => {
      const r = await relayCall({ type: 'get_address_utxos', address, facts: true });
      if (r?.ok !== true || !Array.isArray(r.utxos)) throw new Error(`get_address_utxos 失败: ${String(r?.error || JSON.stringify(r)).slice(0, 100)}`);
      return r.utxos.map((u) => ({ txid: u.outpoint.transactionId, index: Number(u.outpoint.index), amountSompi: String(u.amount) }));
    },
    triggerSplit: makeTriggerSplit({ db, relayCall }),
    sendMailbox: async ({ target, amountKas, payloadHex }) => {
      const r = await relayCall({ type: 'delivery_mailbox_send', target, amount: amountKas, payload_hex: payloadHex });
      if (r?.ok !== true || !r.txId) throw new Error(`delivery_mailbox_send 失败: ${String(r?.error || JSON.stringify(r)).slice(0, 120)}`);
      return { txid: r.txId };
    },
    mailboxAddress: (privHex, network) => new kaspaMod.PrivateKey(privHex).toPublicKey().toAddress(network).toString(),
    mailboxLanded: async (address, txid) => {
      const r = await relayCall({ type: 'check_utxo_landed', address, txid, minDepth: MIN_DEPTH });
      return r?.landed === true;
    },
    nowMs, log,
  };
}

let _timer = null, _running = false;
/** index.js 调用。开关/relay id 校验在此; 返回是否已启动。 */
export function startDeliveryWatcherCron(env = process.env, deps = {}) {
  if (env.DELIVERY_WATCHER_ENABLED !== '1') { console.log('[delivery-watcher] disabled (DELIVERY_WATCHER_ENABLED!=1)'); return false; }
  const relayId = env.DELIVERY_RELAY_ID;
  if (!relayId) { console.error('[delivery-watcher] 🔴 DELIVERY_WATCHER_ENABLED=1 但未配置 DELIVERY_RELAY_ID — 拒绝启动(不回落任何默认 relay)'); return false; }
  if (_timer) return true;
  // M0a: 本模块【不裸 import relay-manager】; 出链走受控 funnel(delivery-relay-funnel.mjs: 命令白名单 + relay_id 固定 + origin 硬编码, 经审 manifest MRC-delivery-relay-funnel)。deps.relayCall 仅测试注入。
  const relayCall = deps.relayCall || makeDeliveryRelayCall(relayId);
  const ctx = buildDeliveryCtx({ db: deps.db || sqlite, relayCall, readerFor: deps.readerFor || ((net) => makeKaspaApiReaderBrowser(net || 'mainnet')), kaspaMod: kaspa, log: (m) => console.log(m) });
  const tickMs = Number(env.DELIVERY_TICK_MS) >= 5000 ? Number(env.DELIVERY_TICK_MS) : DELIVERY_TICK_MS_DEFAULT;
  const tick = async function deliveryWatcherTick() {
    if (_running) return;   // 防重入: 上一轮没跑完不叠加(串行出链, 防抢 relay 钱包 UTXO)
    _running = true;
    try { const r = await deliveryTick(deps.db || sqlite, ctx); if (r.processed) console.log(`[delivery-watcher] tick processed=${r.processed} ${JSON.stringify(r.byState)}`); }
    catch (e) { console.error(`[delivery-watcher] tick 异常(下轮重试): ${String(e.message).slice(0, 120)}`); }
    finally { _running = false; }
  };
  _timer = setInterval(tick, tickMs); _timer.unref?.();
  console.log(`[delivery-watcher] started relay=${String(relayId).slice(0, 8)} tick=${tickMs}ms`);
  return true;
}
export function _stopForTest() { if (_timer) clearInterval(_timer); _timer = null; _running = false; }
