// bsc-incoming-watcher.js — T-NWT-V2 (Owner 真测 #2 退场后立项)
//
// Eager 后台监听 broker EVM 收款地址 USDT incoming. 每 30s tick, 对所有
// _pendingAccepts peer 调 verifyPaymentForPeer (J2 lazy 路径) 自动反查 + 发 paid_v1.
// 找到匹配 → 主动 DM user 汇报 (Owner 要求 #2: broker 主动收集传回, 不让 user 查).
//
// 跟 J2 lazy path (broker-llm-agent verify_payment tool) 互补:
//   - eager (本文件): user 啥都不发, broker 30s 内主动检测付款
//   - lazy (J2): user DM '已经支付' / '查一下' → LLM 调 tool 即时反查
//
// 防重: verifyPaymentForPeer 找到后会 _enqueuePaid + 标 pick.paid_tx + 全 paid 时
// _pendingAccepts.delete. tick 下一轮枚举不到该 peer, 自然防重.
//
// 沿 broker-buy-completion-watcher / market-seeder 等常驻 worker 范式.

const TICK_MS = 30 * 1000;
const SUPPORTED_CHAINS = ['bnb', 'eth', 'polygon'];

let _started = false;
let _interval = null;
let _ticks = 0;
let _matches = 0;

export function start() {
  if (_started) return { ok: false, reason: 'already_started' };
  _started = true;
  _interval = setInterval(() => { tick().catch(e => console.warn(`[bsc-watcher] tick err: ${e.message}`)); }, TICK_MS);
  console.log(`[bsc-watcher] started, tick=${TICK_MS / 1000}s, supported=${SUPPORTED_CHAINS.join(',')}`);
  return { ok: true };
}

export function stop() {
  if (_interval) clearInterval(_interval);
  _started = false;
  _interval = null;
  console.log(`[bsc-watcher] stopped (ticks=${_ticks}, auto-paid matches=${_matches})`);
}

export function getStats() {
  return { started: _started, ticks: _ticks, matches: _matches };
}

// 暴露 tick 供单测直接调 (sync await + mock 时间)
export async function tick() {
  _ticks++;
  const { _pendingPeers, _getPendingAccept, verifyPaymentForPeer } = await import('./broker-buy-handler.js');
  const peers = _pendingPeers();
  if (!peers.length) return { ok: true, peers: 0, matched: 0 };

  let matchedThisRound = 0;
  for (const peer of peers) {
    const accept = _getPendingAccept(peer);
    if (!accept) continue;  // race: 别的路径删了
    const chain = String(accept.pay_chain || 'bnb').toLowerCase();
    if (!SUPPORTED_CHAINS.includes(chain)) continue;  // sol/tron 留 v1.1

    let r;
    try {
      r = await verifyPaymentForPeer({ peer, chain });
    } catch (e) {
      console.warn(`[bsc-watcher] verify err peer=${peer.slice(0, 16)}... ${e.message}`);
      continue;
    }
    if (r.ok && r.matched?.length) {
      matchedThisRound += r.matched.length;
      _matches += r.matched.length;
      // Owner 要求 #1+#2: broker 主动 DM 汇报 — 不依赖 LLM, 不让 user 查.
      const totalUsdt = r.matched.reduce((s, m) => s + m.amount, 0).toFixed(4);
      const firstTx = r.matched[0].payment_tx;
      const remaining = r.remaining_picks ?? 0;
      const dmMsg = remaining === 0
        ? `✓ 链上已检测到你 ${totalUsdt} USDT 入账 (${chain.toUpperCase()} tx ${firstTx.slice(0, 12)}...). 自动验证中, ~30-60s 后我发 KAS 到你 Kasia. 不用回复.`
        : `✓ 收到 ${r.matched.length} 笔付款 ${totalUsdt} USDT (tx ${firstTx.slice(0, 12)}...). 还差 ${remaining} 笔, 已收的会自动确认 + 发 KAS.`;
      try {
        const { enqueue } = await import('./broker-action-queue.js');
        await enqueue({ kind: 'dm_auto_payment_detected', peer, payload: { message: dmMsg } });
        console.log(`[bsc-watcher] auto-paid peer=${peer.slice(0, 16)}... ${r.matched.length} pick(s) ${totalUsdt} USDT`);
      } catch (e) {
        console.warn(`[bsc-watcher] DM enqueue err: ${e.message}`);
      }
    }
  }
  return { ok: true, peers: peers.length, matched: matchedThisRound };
}
