// with-timeout.mjs — 给"不可取消的外部 await"加上限 (J2 2026-08-29, NWT verify-flag (c): peer-lock 无硬超时是对的, 但被 hold 的 handler 里若有
// 无超时的外部调用 (evm-transfer 的 ethers/tronweb 调用只靠库默认: ethers v6 FetchRequest 300 s, tronweb 未知), 该 peer 会被永久 hold)。
// 语义: 超时 ⇒ reject TimeoutError(code 'ETIMEDOUT_LOCAL'); 底层 promise【不被取消】(链上发送可能已经发生) ⇒ 调用方必须按"结果不明"处理
//       (P11: 不冲正 + 告警; P2: intent 留 + 告警), 绝不当"失败"重试或退款。
export class LocalTimeoutError extends Error {
  constructor(label, ms) { super(`${label} 超 ${ms} ms 未返回 (结果不明, 底层未取消)`); this.code = 'ETIMEDOUT_LOCAL'; this.label = label; this.ms = ms; }
}
export function withTimeout(promise, ms, label = 'op') {
  if (!(ms > 0)) throw new Error('withTimeout: ms 须 > 0');
  let timer;
  const gate = new Promise((_, rej) => { timer = setTimeout(() => rej(new LocalTimeoutError(label, ms)), ms); });
  return Promise.race([Promise.resolve(promise), gate]).finally(() => clearTimeout(timer));
}
