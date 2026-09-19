// handshake-accept.mjs — relay.mjs 的 doAcceptHandshake(索引器 / 回落模式的入站握手接受, 由 poll() 在会话 pending_incoming 时调用)抽出的独立模块。
//
// 【只搬代码不改行为】(设计 docs/2026-09-20-bettor-relay-handshake-auto-accept-switch-design-v0.1.md §7.1 / §8.4): 函数体从抽取前的 relay.mjs 程序化提取, 仅做机械改名
//   CONSOLE_URL → consoleUrl; 外部依赖(acceptHandshake / sendKaspa / fetch / log / ingestHandshake / ingestTx / consoleUrl / localAddress)全部由 createHandshakeAcceptor 注入,
//   模块自己不 import 任何东西——所以可以在测试里被驱动(relay.mjs 顶层直接读钱包并起监听, import 它就真的启动 relay, 抽取前无法测试)。
// 去重状态 _acceptedPeers 住在工厂闭包里(每个 acceptor 实例一份, 与抽取前"进程内一份"等价: relay.mjs 只创建一个)。
// 开关逻辑是下一笔(handshake-switch.mjs), 本笔没有任何开关。
export function createHandshakeAcceptor({ acceptHandshake, sendKaspa, fetch, log, ingestHandshake, ingestTx, consoleUrl, localAddress }) {
  const _acceptedPeers = new Set(); // dedup: only accept handshake from each address once

  return async function doAcceptHandshake(peer) {
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
