/**
 * payout_shards 的 redeem/outpoint/addr 持久化 —— **唯一写入口**。
 *
 * 为什么要收成一个函数(Codex MUST-FIX, 2026-08-09):
 *   第一版守卫判的是「不刷 addr 的 UPDATE 必须在 15 行内挨着一条刷 addr 的 UPDATE」。
 *   🔴 **那证的是【物理邻近】, 不是【结构配对】** —— 未来第五个漏刷 addr 的写点, 只要恰好落在
 *   某个无关但合规的写点 15 行内, 就会被错配成一对而放行(false-green)。
 *   @NWT 的缺陷重注入证的是「当前 4 个写点被抓到」, Codex 指的是「未来第 5 个抓不到」——
 *   两个 scope 都成立, 而后者只能靠**结构**判据解决, 不能靠距离。
 *   ⇒ 收成唯一入口后, 第五条写路径要么走这里(构造上就正确), 要么触发守卫。
 *
 * 病史: payout_ps_addr 是 write-once 陈列(genesis = p2sh(redeem)), 而 consolidation/close
 * 在 redeem 上原地 splice。四条写路径全漏刷 addr ⇒ K-18 §3.3 coherence gate step(d)
 * 拿当前 redeem 比 genesis addr ⇒ 必不等 ⇒ 拦住结算 20 天。
 * 设计: docs/2026-08-09-zk-settle-writer-fix-design-v0.1.md §1
 */
import { randomUUID } from 'node:crypto';

/**
 * @param {object}   a
 * @param {object}   a.sqlite      better-sqlite3 句柄
 * @param {string}   a.marketId    logical_market_id
 * @param {string}   a.redeemHex   splice 后的权威 redeem 字节
 * @param {string}   a.outpoint    新的 payout_ps_outpoint
 * @param {Function} a.p2sh        该调用点自己作用域里的 p2sh 实现(不新造, 避免网络参数漂移)
 * @param {string}   a.source      events.source, 便于分辨是哪条写路径在降级
 * @returns {string|null} 算出的 addr; null = 走了降级路径(addr 未刷新)
 */
export function persistPayoutShardState({ sqlite, marketId, redeemHex, outpoint, p2sh, source }) {
  // 🔴 addr 计算单独一个 try, 失败时【仍写 redeem/outpoint】。
  // 原设计稿把它放进同一个 try —— 那样 p2sh 一 throw, redeem+outpoint 这两列承重数据会跟着丢,
  // 让本该改善的一次 tick 反而【比今天更坏】(今天只是 addr 陈旧, gate 拦着, 没人受伤;
  // redeem 陈旧则会让下游读到过期字节)。降级方向必须是"回到今天"。 —— @NWT 红队批准并加强了这条。
  let addr = null;
  try { addr = p2sh(redeemHex); }
  catch (e) { logAddrDegraded({ sqlite, marketId, source, err: e }); }

  try {
    if (addr) {
      sqlite.prepare('UPDATE payout_shards SET payout_ps_outpoint = ?, payout_redeem_hex = ?, payout_ps_addr = ? WHERE logical_market_id = ?')
        .run(outpoint, redeemHex, addr, marketId);
    } else {
      sqlite.prepare('UPDATE payout_shards SET payout_ps_outpoint = ?, payout_redeem_hex = ? WHERE logical_market_id = ?')
        .run(outpoint, redeemHex, marketId);
    }
  } catch (e) {
    // 写失败不倒灌钱路(链上 splice 已是既成事实), 但也绝不静默。
    console.error(`[${source}] 🔴 market=${String(marketId).slice(-8)} payout_shards 持久化失败: ${e.message}`);
    return null;
  }
  return addr;
}

/**
 * J2 红队 2026-08-09(实证驱动): addr 计算过 kaspa-wasm, 而 08-07T20:55 起的 wasm trap 持续
 * 33.7 小时 —— 那种窗口里本补丁会【每次】走降级: 刷 redeem、不刷 addr ⇒ gate 继续拦 ⇒ 结算继续停,
 * 而现象与"还没修"逐字相同。**补丁的全部价值会被静默归零。**
 * console 输出不够: 结算停 20 天零人察觉, 就是它不是报告通道的证据。
 * level 用 'error' 是查过的 —— /api/events 按 `level = ?` 过滤并回传, 落在真实读路径上
 * (@NWT: 别发明没人读的 severity)。
 */
function logAddrDegraded({ sqlite, marketId, source, err }) {
  const summary = `payout_ps_addr 刷新失败 market=${String(marketId).slice(-8)} — 仅写 redeem/outpoint, coherence gate step(d) 将继续拦住该盘结算`;
  console.warn(`[${source}] 🔴 ${summary}: ${err && err.message}`);
  try {
    sqlite.prepare(`INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'system', 'payout_ps_addr_refresh_degraded', ?, 'error', ?, ?, datetime('now'))`)
      .run(randomUUID(), source, summary, JSON.stringify({ marketId, error: String(err && err.message || err) }));
  } catch (e) {
    console.error(`[${source}] events 落账失败 (non-fatal): ${e.message}`);
  }
}
