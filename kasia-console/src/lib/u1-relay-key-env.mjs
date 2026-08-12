/**
 * N5 · spawn 侧密钥 env —— A2 spec v1.2-rc「两个逃逸口一起钉死」的落码。
 * 规范: docs/2026-08-12-u1-a2-same-origin-spec-v1.0.md §N5 · 读数: @J1tn `8969aca7`(四臂真执行)
 *
 * 🔴 **逃逸口①(他审出来的, 比我原先报的那个重)**: 上面 `{...process.env}` 是**全量继承**,
 *    而旧代码的 `else` 分支**只设 MNEMONIC、不删继承来的 `KASPA_PRIVKEY`**;
 *    `wallet.mjs` 又**先读 PRIVKEY 命中即 return** ⇒ **mnemonic 型 relay 的签名身份被整个替换**
 *    (他 ②==③ 逐字符相同证到位: 顶掉它的就是那把继承来的 privkey)。
 * 🔴 **互斥必须【双向】, 第二个方向不是对称强迫症**(@J1tn 21:12Z): privkey 分支里继承来的
 *    `KASPA_MNEMONIC` 今天是惰性的, **但那个惰性只由 `wallet.mjs` 的一处优先级维持** ——
 *    那处优先级一旦被改动或被新路径绕过, 它就活了, 而且是静默的。
 *    🔨 判据: **把「靠某行【不存在】维持的保护」换成「靠某行【存在】维持的保护」** ——
 *       后者被破坏时是一次**可见的 diff**, 前者不是。
 * 🔴 **逃逸口②**: `KASPA_ACCOUNT_INDEX` 全仓一处读、零处写 ⇒ 它**只可能来自继承环境**。
 *    这里**显式传** ⇒ 切断继承向(wallet.mjs 侧同批加严格校验, 坏值抛而不是静默取默认)。
 *    ⚠ 今天全部 relay 都是 account 0(`relay_nodes` 无 per-relay index 列); 将来若要按 relay 变,
 *      **先加列再改这里**, 别改回读 env。
 *
 * ⚠ **作用域(与条款同页, 别读大)**: 这三条消除的是**无痕的、误操作即可触发**的路径
 *    (复制一份 env / 换宿主 / 换运维)。**它不构成对敌对域运营方的约束** —— 进程跑在他自己的宿主上。
 *    对他的那一半, 答案只有 spec §1 的 C 边界(生成仪式)。
 *
 * @param {{privkey?: string|null, mnemonic?: string|null}} a
 * @returns {{KASPA_PRIVKEY?: string, KASPA_MNEMONIC?: string, KASPA_ACCOUNT_INDEX: string}}
 *          —— 值为 `undefined` 的键表示**必须从 env 里删掉**(调用方用 Object.assign 覆盖即可,
 *             因为 `undefined` 会让 child_process 忽略该变量)。
 */
export function buildRelayKeyEnv({ privkey, mnemonic } = {}) {
  const out = { KASPA_ACCOUNT_INDEX: '0' };
  if (privkey) {
    out.KASPA_PRIVKEY = privkey;
    out.KASPA_MNEMONIC = undefined;      // ← 双向互斥的第二向
  } else {
    out.KASPA_MNEMONIC = mnemonic;
    out.KASPA_PRIVKEY = undefined;       // ← 逃逸口①: 继承来的 privkey 到此为止
  }
  return out;
}
