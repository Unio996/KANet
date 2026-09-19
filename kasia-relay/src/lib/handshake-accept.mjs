// handshake-accept.mjs — relay.mjs 的 doAcceptHandshake(索引器 / 回落模式的入站握手接受, 由 poll() 在会话 pending_incoming 时调用)抽出的独立模块。
//
// 【只搬代码不改行为】(设计 docs/2026-09-20-bettor-relay-handshake-auto-accept-switch-design-v0.1.md §7.1 / §8.4): 函数体从抽取前的 relay.mjs 程序化提取, 仅做机械改名
//   CONSOLE_URL → consoleUrl; 外部依赖(acceptHandshake / sendKaspa / fetch / log / ingestHandshake / ingestTx / consoleUrl / localAddress)全部由 createHandshakeAcceptor 注入,
//   模块不 import 任何有副作用的东西(笔二起只 import 纯函数模块 handshake-switch.mjs)——所以可以在测试里被驱动(relay.mjs 顶层直接读钱包并起监听, import 它就真的启动 relay, 抽取前无法测试)。
// 去重状态 _acceptedPeers 住在工厂闭包里(每个 acceptor 实例一份, 与抽取前"进程内一份"等价: relay.mjs 只创建一个)。
// 笔二在入口加开关(设计 v0.4 §6.1 落点 4): 关闭态入口即返回, 一行日志每 peer 每进程一次(Set 有上限)。本模块因此 import handshake-switch.mjs(纯函数, 零依赖)。
import { handshakeAutoAcceptEnabled, createOncePerKeyLogger } from './handshake-switch.mjs';

export function createHandshakeAcceptor({ acceptHandshake, sendKaspa, fetch, log, ingestHandshake, ingestTx, consoleUrl, localAddress }) {
  const _acceptedPeers = new Set(); // dedup: only accept handshake from each address once
  const logDisabledOnce = createOncePerKeyLogger(log);

  return async function doAcceptHandshake(peer) {
    // 开关(落点 4): poll() 每 tick 都会再命中同一 pending_incoming 会话, 所以日志按 peer 去重; 关闭态不查 console 去重、不 acceptHandshake、不 sendKaspa。
    if (!handshakeAutoAcceptEnabled()) {
      logDisabledOnce(peer, `HANDSHAKE auto-accept disabled (poll) — left pending for ${peer.slice(-12)}`);
      return;
    }
    // DEDUP 1: in-memory check
    if (_acceptedPeers.has(peer)) {
      log("HANDSHAKE from", peer.slice(-12), "→ already accepted (memory), skipping");
      return;
    }
    // DEDUP 2: check Console relation_states (persists across restarts)
    if (consoleUrl) {
      try {
        const rs = await fetch(`${consoleUrl}/api/relation/status?local=${encodeURIComponent(localAddress)}&peer=${encodeURIComponent(peer)}`).then(r => r.json());
        if (rs.status === 'accepted' || rs.status === 'active' || rs.status === 'confirmed') {
          log("HANDSHAKE from", peer.slice(-12), "→ already", rs.status, "in DB, skipping");
          _acceptedPeers.add(peer);
          return;
        }
      } catch {}
    }
    log("HANDSHAKE from", peer, "→ accepting...");
    try {
      const draft = await acceptHandshake({ address: peer });
      if (!draft?.payload) { log("Accept draft failed:", draft); return; }
      const sent = await sendKaspa({ to: draft.to, amount: draft.amount, payload: draft.payload });
      log("HANDSHAKE ACCEPTED TX:", sent?.txId || sent);
      _acceptedPeers.add(peer);
      ingestHandshake({ localAddress, remoteAddress: peer, txid: sent?.txId });
      ingestTx({ traceId: `handshake:${sent?.txId || Date.now()}`, txid: sent?.txId, direction: "outbound", amount: '0.2', fee: sent?.fee, localAddress });
    } catch (e) {
      log("HANDSHAKE ACCEPT ERROR:", e?.message || e);
    }
  };
}
