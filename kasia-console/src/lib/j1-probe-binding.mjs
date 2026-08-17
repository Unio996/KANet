// j1-probe-binding.mjs — trough 探针的行绑定/记账判定(纯函数, 从仪器 v4 抽出以便测试与变异)
// 消费方: scripts/j1-trough-probe-instrument.mjs(经 sha256 钉定引用)。
// Codex MSG-235/236 的两条硬约束在此实现:
//   A: submit 阶段完整 txid 与 console 行 tx_hash 必须全 64-hex 相等, 不等=contradiction(零 credit);
//   D: 行绑定=content 全文逐字相等 ∧ sender_address 精确相等; txid 相等为独立第二绑定。
// 判定词表(唯一出口, 仪器按词行动):
//   invalid-submit-txid | no-row | not-bound | no-valid-txhash | contradiction | first-seen | confirmed
const HEX64 = /^[0-9a-f]{64}$/;

export function decideProbeBinding({ submitTxid, row, exactMsg, expectedSender }) {
  if (!HEX64.test(String(submitTxid || ''))) return { verdict: 'invalid-submit-txid' };
  if (!row) return { verdict: 'no-row' };
  if (String(row.content || '') !== String(exactMsg)) return { verdict: 'not-bound', detail: 'content-mismatch' };
  if (String(row.sender_address || '') !== String(expectedSender)) return { verdict: 'not-bound', detail: 'sender-mismatch' };
  const h = String(row.tx_hash || '');
  if (!HEX64.test(h)) return { verdict: 'no-valid-txhash' };
  if (h !== submitTxid) return { verdict: 'contradiction', txHash: h };
  return { verdict: row.status === 'confirmed' ? 'confirmed' : 'first-seen', txHash: h };
}
