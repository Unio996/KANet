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

// 🔴 批9 9-2a(设计 docs/2026-09-19-j2-proto-v0-batch9-wiring-design-and-checklist-v0.2.md §3.8 / §19.1, 出口按 intent_key 前缀分闸):
//   write 命令的闸按 intent_key 分两把, 互相独立:
//     A 合法 'settle:' 键(S9 严格格式)⇒ 需 PROTO_SETTLEMENT_DRIVER_ENABLED==='1', 否则 proto_settlement_driver_disabled(与 PROTO_DRIVER_ENABLED 无关);
//     B 'settle:' 开头但格式不合法(含批9排除的 withdraw/reclaim/ticket、配对错、大写 UUID…)⇒ 一律 proto_settlement_intent_key_invalid, 不回落旧开关;
//     C 其余(缺失/genesis:/proto-bet:/xsettle:/Settle:/settle 无冒号…)⇒ 需 PROTO_DRIVER_ENABLED==='1', 否则 proto_driver_disabled(旧行为不变);
//     S9-b: 自有 intent_key 存在且不是原始 string(String 对象/数组/数字/对象)⇒ 一律 proto_intent_key_not_string——IPC 走 fork 默认 JSON 序列化,
//           String 对象会变成原始字符串而 relay 侧 intent_key:'string' 校验会通过, 出口若判"非字符串=C 类"就与线上值不一致。
//   闸与发送作用于同一份快照 out = { ...payload, type }(访问器/Proxy 只读一次)。read 不受约束。
//   诚实边界: 这是【按标签】的闸不是按内容的闸——PROTO_DRIVER_ENABLED=1 时标成 'proto-bet:…' 的结算形状交易仍放行;
//   防线 = 我方驱动是唯一调用方 + 本处 S9 + 源码扫描。S9 常量与校验【内联在本文件】(受 M0a content_digest 覆盖), 不从 proto-settlement-intent.mjs 导入
//   (那里的常量表不受摘要保护, 且含批9排除的 withdraw/reclaim/ticket); 漂移由 proto-relay-ipc.test.mjs 对 settlementIntentKeyFor 的产出核对。

import { PROTO_RELAY_ID } from './proto-relay-guard.mjs';

/** 批9 出口允许的结算步骤与其主体归属(withdraw/reclaim/ticket 不在其内——批9 排除, 在出口拒)。 */
export const PROTO_SETTLEMENT_EXIT_STEP_SUBJECT = Object.freeze({ seal: 'market', resolve: 'market', convert_to_claim: 'claim', claim_draw: 'claim' });
// settle:<subject_type>:<小写 UUID>:<step>[#<n>], n ≥ 2 十进制无前导零。无 m/i 标志; JS 的 $ 不匹配末尾换行。
const SETTLE_KEY_RE = /^settle:(market|claim):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(seal|resolve|convert_to_claim|claim_draw)(?:#([2-9]|[1-9][0-9]+))?$/;
/** S9 严格格式校验: 格式合法 ∧ step 与 subject_type 按 PROTO_SETTLEMENT_EXIT_STEP_SUBJECT 配对。 */
export function isValidSettlementIntentKey(key) {
  if (typeof key !== 'string') return false;
  const m = SETTLE_KEY_RE.exec(key);
  return !!m && PROTO_SETTLEMENT_EXIT_STEP_SUBJECT[m[3]] === m[1];
}

/** 命令白名单(读写标记表, 账本1441)——covenant_broadcast(relay.mjs:529, 真签名+真广播, 见
 * covenant-broadcast-relay.mjs)是这张表里唯一的 write, 其余四条对应的 relay.mjs handler 全部
 * 只读(见上方文件头注逐行标注), 加/改这张表本身就是安全边界变更, 必须走 NWT 审。
 * 批9 9-0(J2 2026-09-19, 设计 v0.3.1 R2)新增第四条 read: get_past_median_time(relay.mjs, 走共享 RpcClient,
 * 只调 getBlockDagInfo, 只回 pastMedianTimeMs/observedAtMs, 不签不广播不写钱包)——对旧表差分恰多这一行。 */
export const PROTO_COMMAND_ALLOWLIST = Object.freeze({
  covenant_broadcast: 'write',
  get_address_utxos: 'read',
  get_mempool_entry: 'read',
  check_utxo_landed: 'read',
  get_past_median_time: 'read',
});

/**
 * 🔴 账本1442(Bettor 审 e0d62784 抓到的两处真实漏洞, 已修):
 *   ① payload 里的 type 键会在 `{ type, ...payload }` 展开时覆盖已经过白名单/驱动闸检查的 type
 *      参数(例: sendProtoCommand('get_mempool_entry', {type:'transfer',...}) 按 read 放行、驱动闸
 *      不拦, 实际发出的却是 transfer)。protoSendCmd 因为先解构掉了 cmd.type 才碰巧安全, 但
 *      sendProtoCommand 本身是导出函数, 可以被直接调用绕过——修法: payload 携带 type 键(同
 *      relay_id/relayId)一律 throw; 且拼装顺序改成 `{ ...payload, type }`(双保险, 即使检查被绕过
 *      也不会被 payload 里的 type 覆盖真正发出的类型)。
 *   ② origin 原来由调用方通过 opts.origin 传入——relay-manager/relay 侧 origin 五值 fail-closed 授权
 *      闸(kasia-relay/src/lib/authorize.mjs §4.0, armed=on 时生效)按字面量区分权限, 不是自由文本标签
 *      (先例 capability.js 强制覆写 origin 就是防调用方绕过分类)。'proto' 不在 {internal/operator/
 *      app/legacy-unmigrated} 五值之列——一旦 arm, 会被 authorize.mjs 的兜底分支当"origin 缺失/非法"
 *      fail-closed 拒掉, 静默破坏整个 proto 功能。改用 'internal'(乙路 TCB 放行语义, 与 proto 出口
 *      "Console 自己内部决定发这个命令, 非外部签名 grant/非 operator-settle 单点白名单"的信任模型
 *      吻合), 且不接受调用方注入(防绕过分类)。
 * 🔴 账本1444(NWT 复核 Stage 1 抓到的真实原型链洞): `PROTO_COMMAND_ALLOWLIST[type]` 是普通属性
 * 访问, 会沿原型链查找——type 传 'toString'/'constructor'/'__proto__'/'valueOf' 等 Object.prototype
 * 自带属性名时, 取到的是真实存在的函数/对象, `!mode` 判断拦不住(它们都是 truthy), 且这些值
 * 都 !== 'write', 驱动闸也不生效, 命令会直接到达 sendCommandAsync——现在没出事只是因为 relay 侧
 * commands.mjs:118 用 Set 校验兜底拦下, 但这打破了"出口自身就是唯一强制点"的设计前提。修法: 查表
 * 前先用 Object.prototype.hasOwnProperty.call 判断自有属性, 且 mode 必须严格等于 'read'/'write'
 * 之一才放行, 其余(含原型链命中但值非法的情况)一律 throw。同笔卫生项: payload 是数组也 throw
 * (数组的数字下标/length 等不该被当成一个命令体的字段集合误用)。
 * @param {string} type  必须在 PROTO_COMMAND_ALLOWLIST 白名单里(自有属性, 非原型链继承)
 * @param {object} [payload]  命令体其余字段(不含 type/relay_id/relayId——出口恒用 PROTO_RELAY_ID 与真实 type; 不得是数组)
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @param {Function} [opts._sendCommandAsyncForTest]  测试专用注入点(默认真实 sendCommandAsync)——
 *   relay-manager.js 的 `_relays` 状态是模块私有、无法从外部起一个假子进程观测真正发给它的实参,
 *   这是验证"origin 恒为 'internal', 调用方传值不生效"这条不变量唯一可行的注入方式, 不是给生产
 *   代码开后门(生产路径永远不传这个参数, 落到下面的真实 sendCommandAsync)。
 * @returns {Promise<object>}
 */
export async function sendProtoCommand(type, payload = {}, { timeoutMs, _sendCommandAsyncForTest } = {}) {
  if (!Object.prototype.hasOwnProperty.call(PROTO_COMMAND_ALLOWLIST, type)) {
    throw new Error(`sendProtoCommand: type '${type}' not in allowlist {${Object.keys(PROTO_COMMAND_ALLOWLIST).join(', ')}}`);
  }
  const mode = PROTO_COMMAND_ALLOWLIST[type];
  if (mode !== 'read' && mode !== 'write') {
    throw new Error(`sendProtoCommand: type '${type}' resolved to an invalid allowlist mode '${mode}' — refusing (fail-closed)`);
  }
  if (Array.isArray(payload)) {
    throw new Error('sendProtoCommand: payload must not be an array');
  }
  if (payload && typeof payload === 'object') {
    for (const forbidden of ['relay_id', 'relayId', 'type']) {
      if (Object.prototype.hasOwnProperty.call(payload, forbidden)) {
        throw new Error(`sendProtoCommand: payload must not carry '${forbidden}' — this funnel always uses PROTO_RELAY_ID and the explicit type argument, callers cannot override either`);
      }
    }
  }
  if (!PROTO_RELAY_ID) {
    throw new Error('sendProtoCommand: PROTO_RELAY_ID not configured — refusing (fail-closed)');
  }
  // 闸与发送作用于同一份快照(访问器/Proxy 只在这里被读一次, 闸判的值 == 发出去的值)。
  const out = { ...payload, type };
  if (mode === 'write') {
    const key = out.intent_key;
    if (key !== undefined && typeof key !== 'string') {
      throw new Error(`sendProtoCommand: proto_intent_key_not_string — '${type}' refused (intent_key must be a primitive string when present, got ${Array.isArray(key) ? 'array' : typeof key})`);
    }
    if (typeof key === 'string' && key.startsWith('settle:')) {
      if (!isValidSettlementIntentKey(key)) {
        throw new Error(`sendProtoCommand: proto_settlement_intent_key_invalid — '${type}' refused (settle: intent_key fails strict format; not falling back to the legacy switch)`);
      }
      if (process.env.PROTO_SETTLEMENT_DRIVER_ENABLED !== '1') {
        throw new Error(`sendProtoCommand: proto_settlement_driver_disabled — '${type}' refused (settle: intent, PROTO_SETTLEMENT_DRIVER_ENABLED != 1; independent of PROTO_DRIVER_ENABLED)`);
      }
    } else if (process.env.PROTO_DRIVER_ENABLED !== '1') {
      throw new Error(`sendProtoCommand: proto_driver_disabled — '${type}' refused (write command, PROTO_DRIVER_ENABLED != 1; read commands are not affected by this gate)`);
    }
  }
  if (_sendCommandAsyncForTest) {
    return _sendCommandAsyncForTest(PROTO_RELAY_ID, out, timeoutMs, 'internal');
  }
  const { sendCommandAsync } = await import('../services/relay-manager.js');
  return sendCommandAsync(PROTO_RELAY_ID, out, timeoutMs, 'internal');
}

/**
 * 适配既有 sendCmd(relayId, cmd, timeoutMs, origin) 调用形状——driveMarketGenesis/driveBetIntent/
 * checkMarketGenesisLanded/checkBetIntentLanded(proto-market-intent.mjs/proto-bet-intent.mjs)与
 * proto-broadcast-ops.mjs 全部用这个签名, 改用这个适配器就不需要动那些已经测试过的文件。relayId/
 * origin 两个参数都被忽略(sendProtoCommand 内部恒用 PROTO_RELAY_ID 与字面量 'internal', 账本1442②)——
 * 调用方仍应传 PROTO_RELAY_ID(那些函数自己会校验 relayId 非空), 只是这里不会真的拿它去发命令。
 */
export function protoSendCmd(_relayIdIgnored, cmd, timeoutMs, _originIgnored) {
  const { type, ...payload } = cmd || {};
  return sendProtoCommand(type, payload, { timeoutMs });
}
