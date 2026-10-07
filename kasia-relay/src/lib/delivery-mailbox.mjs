// delivery-mailbox.mjs — 账本1877 步2: 数字商品交付「链上信箱」转账的【窄入口】校验(纯函数, 零 RPC)。
//   设计 docs/2026-10-07-j2-digital-goods-delivery-design-v0.2/0.3.md §4.B。
//   为什么不给现有 `transfer` 加通用 payload 字段: 那会让任何能发 transfer 的调用方带任意 payload 转任意额; 信箱只需要
//   「小额 + 交付密文信封(魔数 KDL1) + P2PK 目标」, 所以做成窄命令 `delivery_mailbox_send`, 校验全在这里, relay.mjs 只做转发给 sendKaspa。
//   线格式(魔数 KDL1 / iv 12B / 长度上限)与 kasia-console/src/lib/checkout-static/delivery-crypto.js 一致且为冻结项(账本1878)。
export const MAILBOX_MAGIC_HEX = '4b444c31';                 // "KDL1"
export const MAILBOX_MIN_PAYLOAD_BYTES = 4 + 12 + 16 + 1;     // 魔数 + iv + tag + ≥1 字节密文
export const MAILBOX_MAX_PAYLOAD_BYTES = 4 + 12 + 1024 + 16;  // 与 MAX_PLAINTEXT_BYTES=1024 对应
// 信箱输出面值上下限(KAS, 十进制字符串): 下限受 KIP-9 存储质量约束(simnet 实测定稿, 见 docs/provenance/2026-10-07-j2-delivery-step2/), 上限防"带 payload 的任意转账"被滥用。
export const MAILBOX_MIN_KAS = '0.03';
export const MAILBOX_MAX_KAS = '0.10';
const P2PK_ADDR_RE = /^(kaspa|kaspatest|kaspasim|kaspadev):q[a-z0-9]{50,80}$/;   // Schnorr P2PK(以 q 开头); P2SH(p)/ECDSA(q… 之外) 一律拒
const KAS_RE = /^(0|[1-9][0-9]*)(\.[0-9]{1,8})?$/;
const toSompi = (s) => { const [i, f = ''] = String(s).split('.'); return BigInt(i) * 100000000n + BigInt((f + '00000000').slice(0, 8)); };

/**
 * @param {{target:string, amount:string|number, payload_hex:string}} cmd
 * @param {string} networkPrefix 期望地址前缀('kaspa'|'kaspasim'|…), 来自 relay 钱包网络, 不收调用方的
 * @returns {{ok:true, amountKas:string, payloadBytes:number} | {ok:false, error:string}}
 */
export function validateMailboxSend(cmd, networkPrefix) {
  const target = String(cmd?.target || '');
  if (!P2PK_ADDR_RE.test(target)) return { ok: false, error: 'delivery_mailbox_send: target 必须是 Schnorr P2PK 地址(q…)' };
  if (networkPrefix && !target.startsWith(networkPrefix + ':')) return { ok: false, error: `delivery_mailbox_send: target 前缀与本 relay 网络(${networkPrefix})不符` };
  const amount = typeof cmd.amount === 'number' ? cmd.amount.toFixed(8) : String(cmd.amount ?? '');
  if (!KAS_RE.test(amount)) return { ok: false, error: 'delivery_mailbox_send: amount 必须是 ≤8 位小数的 KAS 十进制' };
  const a = toSompi(amount);
  if (a < toSompi(MAILBOX_MIN_KAS) || a > toSompi(MAILBOX_MAX_KAS)) return { ok: false, error: `delivery_mailbox_send: amount 须在 [${MAILBOX_MIN_KAS}, ${MAILBOX_MAX_KAS}] KAS(信箱不是通用转账)` };
  const ph = String(cmd.payload_hex || '');
  if (!/^(?:[0-9a-f]{2})+$/.test(ph)) return { ok: false, error: 'delivery_mailbox_send: payload_hex 必须是小写偶数位 hex' };
  const n = ph.length / 2;
  if (n < MAILBOX_MIN_PAYLOAD_BYTES || n > MAILBOX_MAX_PAYLOAD_BYTES) return { ok: false, error: `delivery_mailbox_send: payload 长度 ${n}B 不在 [${MAILBOX_MIN_PAYLOAD_BYTES}, ${MAILBOX_MAX_PAYLOAD_BYTES}]` };
  if (!ph.startsWith(MAILBOX_MAGIC_HEX)) return { ok: false, error: 'delivery_mailbox_send: payload 不是交付密文信封(魔数 KDL1)' };
  return { ok: true, amountKas: amount, payloadBytes: n };
}
