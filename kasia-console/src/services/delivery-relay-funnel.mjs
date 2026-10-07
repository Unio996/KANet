// delivery-relay-funnel.mjs — 交付 watcher 访问 relay 的【唯一受控出口】(M0a considered amendment: m0c-controlled-relay-endpoint, 照 service-escrow 先例)。
//   · 命令类型白名单硬编码(下面 4 个字符串), 其余一律在发出前抛错 —— watcher 即使被改坏也发不出 transfer / send_kaspa / 任意广播。
//       花钱 2 条: delivery_split_submit(relay 本地按订单 ctor 重建零签名 split, 无任意广播口) / delivery_mailbox_send(relay 侧限面值 0.15–0.30 KAS 的信箱小额转账);
//       只读 2 条: get_address_utxos / check_utxo_landed(watcher 取订单 UTXO 与核对落链深度所必需, 不改任何状态)。
//   · relay_id 由调用方(服务启动时读 env DELIVERY_RELAY_ID)固定传入, 命令体不能改它; origin 硬编码 'internal'(watcher 是定时器驱动, 非调用方可传)。
//   · 本文件不含任何其它 sendCommandAsync 调用面。
import { sendCommandAsync } from './relay-manager.js';

export const DELIVERY_RELAY_COMMANDS = Object.freeze(['delivery_split_submit', 'delivery_mailbox_send', 'get_address_utxos', 'check_utxo_landed']);
const ALLOWED = new Set(DELIVERY_RELAY_COMMANDS);

/** @param {string} relayId 出链 relay(服务端固定) @param {Function} [send] 仅测试注入; 生产默认 relay-manager 的 sendCommandAsync */
export function makeDeliveryRelayCall(relayId, send = sendCommandAsync) {
  if (!relayId || typeof relayId !== 'string') throw new Error('delivery-relay-funnel: relayId 必填');
  return async function deliveryRelayCall(cmd) {
    const type = cmd && typeof cmd === 'object' ? cmd.type : undefined;
    if (typeof type !== 'string' || !ALLOWED.has(type)) throw new Error(`delivery-relay-funnel: 命令 ${String(type).slice(0, 40)} 不在交付白名单内, 已拒绝`);
    return send(relayId, cmd, 30000, 'internal');
  };
}
