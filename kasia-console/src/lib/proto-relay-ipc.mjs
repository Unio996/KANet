// proto-relay-ipc.mjs — 唯一受控出口(账本1440/1441, considered amendment #8, m0a-lib.mjs)。
//
// 全仓 proto 相关代码里只有这一个文件裸 import relay-manager 的 sendCommandAsync。proto.js /
// proto-driver.mjs 从这里导入 sendProtoCommand/protoSendCmd, 不再各自裸 import relay-manager(那两处
// 是 R-M0A-BARE-IMPORT-DIFF 真实拦下的违规, 见账本1438讨论)。proto-market-intent.mjs/proto-bet-
// intent.mjs 这两个状态机文件的 sendCmd 参数由 proto-driver.mjs 与 proto.js 统一注入这里的
// protoSendCmd 适配闭包, 不另开第二条通道。
//
// 威胁模型(justification, 供 m0a-exception-manifest.json 引用): 原型v0单一relay身份(PROTO_RELAY_ID
// 硬编码来源, proto-relay-guard.mjs 三层纵深防御已覆盖)+ 命令白名单(读写标记表, 见下)+ 广播类命令
// 受 PROTO_DRIVER_ENABLED 默认关闭闸控制(账本1438①)。三条缺一, 威胁模型不成立:
//   - 若不锁 relayId: 调用方可能指定任意 relay 执行(越权)。
//   - 若不锁白名单: 这个出口就退化成裸 sendCommandAsync 本身, M0a 门形同虚设。
//   - 若不分 read/write 闸: 关闭驱动时状态机连"查一下有没有落链"都做不到, 或者反过来广播闸形同虚设。
//
// 🔴 账本1441(Bettor 核对 relay.mjs 源码后确认): get_mempool_entry(relay.mjs:551, 只调
// rpc.getMempoolEntry/getBlockDagInfo)、check_utxo_landed(relay.mjs:1258, 只调 checkUtxoLanded)
// 两者都不签名不广播不写钱包, 确认只读——PROTO_DRIVER_ENABLED 闸因此只作用于标记 write 的命令,
// 读命令在驱动关闭时照常放行(状态机在关闭状态下也要能查询/对账, 这不该被同一把闸挡住)。

import { PROTO_RELAY_ID } from './proto-relay-guard.mjs';

/** 命令白名单(读写标记表, 账本1441)——covenant_broadcast(relay.mjs:529, 真签名+真广播, 见
 * covenant-broadcast-relay.mjs)是这张表里唯一的 write, 其余三条对应的 relay.mjs handler 全部
 * 只读(见上方文件头注逐行标注), 加/改这张表本身就是安全边界变更, 必须走 NWT 审。 */
export const PROTO_COMMAND_ALLOWLIST = Object.freeze({
  covenant_broadcast: 'write',
  get_address_utxos: 'read',
  get_mempool_entry: 'read',
  check_utxo_landed: 'read',
});

/**
 * @param {string} type  必须在 PROTO_COMMAND_ALLOWLIST 白名单里
 * @param {object} [payload]  命令体其余字段(不含 type; 不得含 relay_id/relayId——出口恒用 PROTO_RELAY_ID)
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.origin]
 * @returns {Promise<object>}
 */
export async function sendProtoCommand(type, payload = {}, { timeoutMs, origin = 'proto' } = {}) {
  const mode = PROTO_COMMAND_ALLOWLIST[type];
  if (!mode) {
    throw new Error(`sendProtoCommand: type '${type}' not in allowlist {${Object.keys(PROTO_COMMAND_ALLOWLIST).join(', ')}}`);
  }
  if (payload && typeof payload === 'object' && (Object.prototype.hasOwnProperty.call(payload, 'relay_id') || Object.prototype.hasOwnProperty.call(payload, 'relayId'))) {
    throw new Error('sendProtoCommand: payload must not carry relay_id/relayId — this funnel always uses PROTO_RELAY_ID, callers cannot override');
  }
  if (!PROTO_RELAY_ID) {
    throw new Error('sendProtoCommand: PROTO_RELAY_ID not configured — refusing (fail-closed)');
  }
  if (mode === 'write' && process.env.PROTO_DRIVER_ENABLED !== '1') {
    throw new Error(`sendProtoCommand: proto_driver_disabled — '${type}' refused (write command, PROTO_DRIVER_ENABLED != 1; read commands are not affected by this gate)`);
  }
  const { sendCommandAsync } = await import('../services/relay-manager.js');
  return sendCommandAsync(PROTO_RELAY_ID, { type, ...payload }, timeoutMs, origin);
}

/**
 * 适配既有 sendCmd(relayId, cmd, timeoutMs, origin) 调用形状——driveMarketGenesis/driveBetIntent/
 * checkMarketGenesisLanded/checkBetIntentLanded(proto-market-intent.mjs/proto-bet-intent.mjs)与
 * proto-broadcast-ops.mjs 全部用这个签名, 改用这个适配器就不需要动那些已经测试过的文件。relayId
 * 参数被忽略(sendProtoCommand 内部恒用 PROTO_RELAY_ID)——调用方仍应传 PROTO_RELAY_ID(那些函数自己
 * 会校验 relayId 非空), 只是这里不会真的拿它去发命令。
 */
export function protoSendCmd(_relayIdIgnored, cmd, timeoutMs, origin) {
  const { type, ...payload } = cmd || {};
  return sendProtoCommand(type, payload, { timeoutMs, origin });
}
