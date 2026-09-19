// proto-winner-bet.mjs — "赢家那一条已确认下注"的选取(纯读、不 import 任何 DB 客户端; db 必填、无默认值)。
// 9-1 F3 笔(NWT D-2): 从 proto-settlement-inputs.mjs 拆出。proto-settlement-inputs.mjs 顶部 import { sqlite } from db/client.js, 指针模块为复用本函数而 import 它,
//   于是 import 指针模块即打开默认库; 本文件不 import 任何东西, 指针模块从这里取, 与 close_commit 一侧(经 proto-settlement-inputs 的同名导出)仍是同一份判定——不另写一份。

/**
 * 从 DB 取"赢家那一条已确认下注"——(A) 路线要求胜方恰好 1 条已确认下注, 否则 fail-closed(不自动挑一条)。
 * 【不含 proto_markets.status 闸】: close_commit 只在 sealed 时才允许(见 proto-settlement-inputs.deriveCloseCommitInputs 自己的检查), 而 claim_draw 取赢家票指针时市场已是 resolved——
 * 所以 status 闸留在 close_commit 一侧, 这里只做"胜方是谁"。
 * 每个 fail-closed 错误带 .code: winner_market_missing / winner_side_unset / winner_pool_empty / winner_count。
 * @param {string} marketId
 * @param {{db:object, who?:string}} o  db 必填(无默认值: 默认库属于 proto-settlement-inputs 那一层); who: 报文前缀(deriveCloseCommitInputs 传自己的, 保持原报文逐字不变)
 * @returns {{market:{id:string,status:string,winning_side:number,payout_root:string|null}, bets:object[], poolValue:number, winner:{id:string,bettor_pk:string,side:number,stake:number}}}
 */
export function deriveWinnerBet(marketId, { db, who = `deriveWinnerBet(${marketId})` } = {}) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('deriveWinnerBet: db 必填(注入; 本文件不 import 任何 DB 客户端、无默认库)');
  const E = (code, msg) => Object.assign(new Error(`${who}: fail-closed — ${msg}`), { code });
  const market = db.prepare('SELECT id, status, winning_side, payout_root FROM proto_markets WHERE id = ?').get(marketId);
  if (!market) throw E('winner_market_missing', '市场不存在');
  if (market.winning_side !== 0 && market.winning_side !== 1) {
    throw E('winner_side_unset', `proto_markets.winning_side=${market.winning_side}(必须是 0/1): 胜方必须由操作员的 resolve 裁决先写进 DB, 不接受调用方临时传入`);
  }
  const bets = db.prepare(`SELECT id, bettor_pk, side, stake FROM proto_bets WHERE market_id = ? AND status = 'confirmed'`).all(marketId);
  const poolValue = bets.reduce((s, b) => s + b.stake, 0);
  if (!(poolValue > 0)) throw E('winner_pool_empty', `已确认下注的 pool_value=${poolValue}, 没有可结算的池子`);
  const winners = bets.filter((b) => b.side === market.winning_side);
  if (winners.length !== 1) {
    throw E('winner_count', `胜方(side=${market.winning_side})的已确认下注有 ${winners.length} 条, (A) 路线要求恰好 1 条(v0 single-operator assumption violated, refusing to auto-pick one)`);
  }
  return { market, bets, poolValue, winner: winners[0] };
}
