// handshake-switch.mjs — relay 入站握手"自动接受"总开关(设计 docs/2026-09-20-bettor-relay-handshake-auto-accept-switch-design-v0.1.md v0.4)。
//
// 只认字面 '1'(与 D-026 两开关同一约定): 'on' / 'true' / ' 1' / '"1"' / '01' / 全角 '１' / '1\n' / 未设 / 空串 一律关。默认关, 不按网络分支。
// 【每次调用读】(v0.2 §6.2 ②): 不缓存成模块常量——测试传 env 即可切换, 不必重载有网络副作用的 rpc-listener 顶层模块。
// 本模块零 import、零副作用, 可被任何调用点(chain.mjs / rpc-listener.mjs / handshake-accept.mjs / relay.mjs)安全引用。
//
// 策略层(对端白名单 / 速率预算 / 每日上限)是另一次钱路决定(须 Owner 批): 它落在本函数之后、acceptHandshake 之前, 本页不做。
export function handshakeAutoAcceptEnabled(env = process.env) {
  return env.RELAY_HANDSHAKE_AUTO_ACCEPT === '1';
}

// 启动日志(relay.mjs 顶层、RELAY_MODE 分支之前打恰一行; console 会以 [relay:<name>] 前缀转发, 部署后 grep -c 'handshake auto-accept: DISABLED' 应恰等于 relay 子进程数)。
// raw 用 JSON.stringify 原始值(未设 ⇒ <unset>), 让"写成了 'on' 却没开"这类拼写错误在日志里一眼可见。
export function handshakeStartupLine(env = process.env, relayMode) {
  const v = env.RELAY_HANDSHAKE_AUTO_ACCEPT;
  const mode = `RELAY_MODE=${relayMode}`;
  if (handshakeAutoAcceptEnabled(env)) return `handshake auto-accept: ENABLED (${mode})`;
  return `handshake auto-accept: DISABLED (RELAY_HANDSHAKE_AUTO_ACCEPT!=1, raw=${v === undefined ? '<unset>' : JSON.stringify(v)}, ${mode})`;
}

// 关闭态日志的"每个 key 每进程只打一次"去重(§7.4 / §8.3): 对端地址数来自外部、无界, 所以 Set 有上限——满了停止新增并打恰一行
// 'suppressing further disabled-peer logs', 之后静默。不复制既有 _acceptedPeers 的无界先例。
export const DISABLED_LOG_CAP = 1000;
export function createOncePerKeyLogger(log, { cap = DISABLED_LOG_CAP } = {}) {
  const seen = new Set();
  let capped = false;
  return function logOnce(key, text) {
    if (seen.has(key)) return;
    if (seen.size >= cap) {
      if (!capped) { capped = true; log('suppressing further disabled-peer logs'); }
      return;
    }
    seen.add(key);
    log(text);
  };
}
