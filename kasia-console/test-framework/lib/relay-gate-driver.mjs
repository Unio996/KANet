// test-framework/lib/relay-gate-driver.mjs — fork 真 relay 子进程 + IPC 发命令收 gate 决策
// M0c-1 实战 harness 领域无关驱动 (M0c-2/M0c-3 harness 复用)。
// 设计: docs/2026-07-23-m0c-1-app-provision-harness-design.md §2/§4
//
// 为什么 fork 真 relay 而非调函数: gate locus 在 relay.mjs process.on('message') → validateCommandPayload
// → authorizeCommand → switch (生产执行路径)。fork 真进程 + child.send(cmd) = 走全链非孤立单测
// (NWT 红队判据 2)。deny 拒在 switch 前 = 链上零 tx = NO TX 天然守住 (判据 2)。
//
// 隔离非 live (判据 4/§2): 独立子进程 + throwaway KASPA_PRIVKEY(零资金) + 临时 grant DB(非 console.db)
// + CONSOLE_URL='' 不挂 console + RELAY_MODE=indexer。不重启/不碰 live relay。

import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RELAY_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../kasia-relay');

/**
 * 起一个隔离 armed relay 子进程。
 * @param {object} opts { relayId, network, privkeyHex, grantDbPath, armed=true, grantEnvImplemented=true }
 *   armed/grantEnvImplemented 通过 env 传给 relay (authorize.mjs 读)。
 * @returns {Promise<{send, stop, stderr}>}
 */
export async function startArmedRelay(opts) {
  const {
    relayId, network, privkeyHex, grantDbPath,
    armed = true, grantEnvImplemented = true,
  } = opts;

  const env = {
    ...process.env,
    RELAY_MODE: 'indexer',
    POLL_MS: '999999',           // 实质关掉 poll (只测 IPC gate, 不需扫链)
    CONSOLE_URL: '',             // 不挂 console
    // 🔴 隔离铁律: 指死端口, 绝不连本机 live kaspad(默认 ws://127.0.0.1:17210)。
    // allow 条 gate 放行后进 switch→sendKaspa 连死端口快速失败 = "进 switch" 的执行层错误证据,
    // 且零碰 live 链(非 live 隔离强化: 不读不写 live 节点)。
    KASPA_RPC_URL: 'ws://127.0.0.1:1',
    RELAY_NODE_ID: relayId,
    NETWORK: network,
    KASPA_NETWORK: network,
    KASPA_PRIVKEY: privkeyHex,   // throwaway 零资金
    IS_SERVICE: '0',
    M0C1_GRANT_DB_PATH: grantDbPath,
    ADMIN_M0C1_GATE_ARMED: armed ? '1' : '0',
    // 注: GRANT_ENVELOPE_IMPLEMENTED 是模块内常量, 由 harness 主控临时置 true(不 commit);
    // 这里暴露 env 仅供子进程侧断言用, authorize.mjs 读的是源码常量(harness flip 那一行)。
    M0C1_HARNESS_GRANT_ENV_EXPECTED: grantEnvImplemented ? '1' : '0',
  };

  const child = fork(path.join(RELAY_DIR, 'src/relay.mjs'), [], {
    cwd: RELAY_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  let stderrBuf = '';
  child.stderr.on('data', (d) => { stderrBuf += d.toString(); });
  child.stdout.on('data', () => {}); // drain

  const pending = new Map(); // requestId → {resolve, timer}
  child.on('message', (msg) => {
    if (msg && msg.requestId && pending.has(msg.requestId)) {
      const { resolve, timer } = pending.get(msg.requestId);
      clearTimeout(timer);
      pending.delete(msg.requestId);
      resolve(msg.result);
    }
  });

  let exited = null;
  child.on('exit', (code) => { exited = code; });

  /** 发一条命令, 返回 relay result (含 gate 的 denied/error/ok 形态)。 */
  function send(cmd, timeoutMs = 15000) {
    if (exited !== null) return Promise.reject(new Error(`relay 子进程已退出(code ${exited})\n${stderrBuf.slice(-800)}`));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`命令回执超时(${timeoutMs}ms): type=${cmd.type}`));
      }, timeoutMs);
      pending.set(requestId, { resolve, timer });
      child.send({ ...cmd, requestId });
    });
  }

  // 等 relay ready: 轮询一个 readonly 命令直到有回(process.on('message') 已注册)。
  const t0 = Date.now();
  let ready = false;
  while (Date.now() - t0 < 20000) {
    if (exited !== null) throw new Error(`relay 启动即退出(code ${exited})\n${stderrBuf.slice(-1200)}`);
    try {
      const r = await send({ type: 'get_pubkey', __origin: 'internal' }, 2000);
      if (r !== undefined) { ready = true; break; }
    } catch { /* 还没 ready, 重试 */ }
    await new Promise((x) => setTimeout(x, 400));
  }
  if (!ready) { child.kill(); throw new Error(`relay 20s 内未 ready\n${stderrBuf.slice(-1200)}`); }

  function stop() {
    try { child.kill(); } catch {}
  }

  return { send, stop, get stderr() { return stderrBuf; }, get exited() { return exited; } };
}
