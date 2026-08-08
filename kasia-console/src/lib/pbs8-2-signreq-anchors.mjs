/**
 * PB-S8-2 · sign_req 锚点判定(单源纯函数)
 *
 * 设计: docs/2026-08-07-pbs8-2-anchor-extraction-and-callsite-anchor-test-design-v0.1.md(标题 v0.2)§1
 * 上游判定原文: docs/2026-08-03-pbs8-2-candidate-b-implementation-design.md §1(锚点①②③)+ §11.1/11.2/11.3
 * D4 裁定: Bettor 2026-08-08 10:42 —— D4【适用】(v0.1 判"不适用"所依据的"纯提取一字节不变"前提已被证伪)
 *
 * 🔴🔴 本文件【没有被任何生产代码调用】, 这是【被批准的状态】不是遗漏:
 *   把这套 enforce 接进 `handlePoolOracleTxSignReq`, 让生产在这三条件下真的拒签
 *   = 钱路行为改变 = **Owner 闸**(Bettor 10:42 明示不在其裁量内)。
 *   ⇒ 本批准许建到"机制 + 弃权率证据"为止。**接线是另一次、由 Owner 批的动作。**
 *   ⇒ 谁要接线, 先去看那条裁定, 别因为"函数都写好了"就顺手接上。
 *
 * 🔴 这是【首次实装】不是【提取】: handler 今天在这个位置没有任何锚点判定
 *   (2026-08-08 实核 trade-protocol-filter.js: outputTotalSompi / inputTotalSompi /
 *    MIN_OUTPUT_RATIO / isCommingledSpine 逐条 0 命中; PB-S8-2 仅 :609 一句注释)。
 *
 * 🔴 覆盖边界(v4 Codex 硬边界, 优先于其余措辞): 这里每一条都只是**便宜的拒绝信号**,
 *   **永不得升格为签名授权条件**。全部通过 ≠ 可以安全签名, 也不确立市场成员资格 /
 *   前态身份 / payout 正确性中的任何一项。**本函数只产出拒绝, 永不产出授权。**
 *   尤其不覆盖: 市场内胜方之间的再分配(保持毛额不变、只改分配的篡改, 三个锚点结构上看不见)。
 */

/**
 * 🔴 纯函数硬约束: 不读 DB、不发 RPC、不写日志、无副作用。所有外部事实由 input 传入。
 *
 * 🔴 为什么"取不到"必须是【值】不是【异常】(设计 §1.1, R9 扫射咬出):
 *   若建模成抛异常, 用例只能断言"它抛了" —— 而【抛异常】与【离线环境本来就没有 RPC】
 *   在离线下读数完全相同 ⇒ "恒真"墙原样复活。**"取不到"与"没去取"必须在类型层面是两个东西。**
 *   同理 `spineIsCommingled` 也是【入参布尔】而不是在函数里调 isCommingledSpine(..., sqlite):
 *   上游原文那行是 DB 调用, 直接照抄会让本函数不纯 ⇒ 提到调用方去查, 值传进来。
 *
 * @param {object} input
 * @param {{id:string, spine_p2sh:?string, spine_lock_tx:?string, maker_relay_id:?string}} input.market
 *        本地 pool_markets 行。🔴 承重列缺任一 ⇒ 弃权(见 MISSING_LOAD_BEARING_COLUMN)。
 * @param {boolean|null} input.spineIsCommingled
 *        由调用方以 isCommingledSpine(market.spine_p2sh, sqlite) 求得。null = 判不出 ⇒ 弃权。
 * @param {{inputs?:Array, outputs?:Array}|null} input.txObj  待签的 phase2 tx_obj。
 * @param {bigint|null} input.inputTotalSompi
 *        链上现查的 input outpoint 面值合计。**null = 取不到 ⇒ 弃权(不是 0, 不是回落)。**
 * @returns {{ok:boolean, reason:string|null, code:string|null}}
 */
export function evaluateSignReqAnchors(input) {
  const market = input?.market;
  const mid = typeof market?.id === 'string' ? market.id.slice(0, 12) : '(no-id)';

  // ── MUST-FIX-0(上游 §11.1): 承重列缺失 ⇒ 弃权 ────────────────────────────────
  //  🔴 它是另外两条的前置: 不先判它, MUST-FIX-1 的守卫会 fail-open 成装饰
  //     (spine_p2sh=undefined ⇒ isCommingledSpine 恒返 false)。
  //  🔴 "读不到判据的值"也是一种 cannot-verify ⇒ 弃权不签, 不许降级成"那就不查这层了"。
  if (!market) {
    return rej('MISSING_LOAD_BEARING_COLUMN', 'PB-S8-2 弃权: 没有 market 行 ⇒ 本机无判断资格, 不签');
  }
  for (const col of ['spine_p2sh', 'spine_lock_tx', 'maker_relay_id']) {
    if (!market[col]) {
      return rej('MISSING_LOAD_BEARING_COLUMN',
        `PB-S8-2 弃权: market 缺承重列 ${col} ⇒ 本机无判断资格, 不签 market=${mid}`);
    }
  }

  // ── MUST-FIX-1(上游 §11.2, NWT 主攻): commingled spine ⇒ 拒签 ────────────────
  //  同址混着别市场的钱 ⇒ 锚点②那个"链上真值"天然不可用(别市场的 UTXO 会抬高本市场的
  //  "合法输入总额", 毛额守恒对这一族当场失效)。插在锚点序列最前面。
  if (input.spineIsCommingled === null || input.spineIsCommingled === undefined) {
    return rej('COMMINGLE_UNDETERMINED',
      `PB-S8-2 弃权: 判不出 spine 是否 commingled ⇒ cannot-verify, 不签 market=${mid}`);
  }
  if (input.spineIsCommingled) {
    return rej('COMMINGLED_SPINE',
      `PB-S8-2 拒签: spine_p2sh 为 commingled(FINDING-2, >1 个 v0.7 市场共享同址)⇒ `
      + `同址 UTXO 混入别市场资金, 毛额守恒不成立 market=${mid}`);
  }

  const txObj = input.txObj;
  if (!txObj || typeof txObj !== 'object') {
    return rej('TX_OBJ_UNREADABLE', `PB-S8-2 弃权: tx_obj 读不出 ⇒ 不签 market=${mid}`);
  }

  // ── 锚点①(上游 §1): spine outpoint 身份(不只地址) ──────────────────────────
  //  地址匹配挡不住"拿本市场一笔旧的/已花费的 UTXO, 或另一个共用同 redeem script 的市场的
  //  UTXO"构造 tx —— outpoint(txid+index)才是唯一确定的那一笔, 地址只是类型。
  const firstInput = txObj?.inputs?.[0];
  const po = firstInput?.previousOutpoint;
  if (!po || po.transactionId !== market.spine_lock_tx || Number(po.index) !== 0) {
    return rej('SPINE_OUTPOINT_MISMATCH',
      `PB-S8-2 拒签: tx_obj 第一个 input 的 outpoint(${short(po?.transactionId)}:${po?.index}) `
      + `!= 本市场当前 spine outpoint(${short(market.spine_lock_tx)}:0) — 疑似跨市场/陈旧 UTXO 替换 market=${mid}`);
  }

  const outputs = Array.isArray(txObj.outputs) ? txObj.outputs : [];

  // ── MUST-FIX-2a(上游 §11.3): outputs 为空 = 全额烧掉 ⇒ 拒签 + 高噪 ──────────
  if (outputs.length === 0) {
    return rej('OUTPUTS_EMPTY', `PB-S8-2 拒签+高噪: outputs 为空 = 全额烧掉 market=${mid}`);
  }

  // ── 锚点③(上游 §1): outputs 数量上界 ──────────────────────────────────────
  //  🔴 启发式, 不是协议常量。出处 migrate.js:5037 的注释原文带"~"(≤~64 bettors)。
  //  超限最可能的原因是【这个阈值自己过期了】(bshard 分片上限被后续迁移改过而它没跟着),
  //  不是攻击 ⇒ 拒签但日志级别刻意拉高, 静默 continue 会把"该更新常量了"永远埋起来。
  if (outputs.length > MAX_REASONABLE_OUTPUTS) {
    return rej('OUTPUTS_COUNT_ABOVE_HEURISTIC_CEILING',
      `PB-S8-2 拒签+高噪: outputs 数量 ${outputs.length} 超出启发式上界 ${MAX_REASONABLE_OUTPUTS}`
      + `(非协议常量, 见 migrate.js:5037 "~64" 注释)— 大概率是这个阈值过期需要更新, `
      + `也可能是灌水攻击, 两者都需要人看 market=${mid}`);
  }

  // 输出面值严格解析: 字段是 `.value`(Codex §6.1 更正了 v2 那行 `.amountSompi || .value` 的猜测)。
  // 🔴 解析不出 ⇒ 弃权, 不是当 0(当 0 会把"读不懂"伪装成"金额很小"再撞下界, 理由说错、方向也可能错)。
  let outputTotalSompi = 0n;
  for (let i = 0; i < outputs.length; i++) {
    const v = readOutputValueSompi(outputs[i]);
    if (v === null) {
      return rej('OUTPUT_VALUE_UNPARSEABLE',
        `PB-S8-2 弃权: outputs[${i}].value 解析不出 sompi ⇒ 不签 market=${mid}`);
    }
    outputTotalSompi += v;
  }

  // ── 链上输入面值: 取不到 ⇒ 弃权(§1.1 + Bettor R2 裁定: cannot-verify ⇒ 弃权不签、不回落) ──
  const inputTotalSompi = input.inputTotalSompi;
  if (inputTotalSompi === null || inputTotalSompi === undefined) {
    return rej('CHAIN_VALUE_UNAVAILABLE',
      `PB-S8-2 弃权: input outpoint 的链上面值取不到 ⇒ cannot-verify, 不签(不回落) market=${mid}`);
  }
  if (typeof inputTotalSompi !== 'bigint') {
    return rej('CHAIN_VALUE_UNAVAILABLE',
      `PB-S8-2 弃权: inputTotalSompi 不是 bigint(${typeof inputTotalSompi})⇒ 不签 market=${mid}`);
  }

  // ── 锚点②(上游 §1): 毛额守恒上界 ────────────────────────────────────────────
  if (outputTotalSompi > inputTotalSompi) {
    return rej('GROSS_CONSERVATION_VIOLATED',
      `PB-S8-2 拒签: outputs 总额 ${outputTotalSompi} > 链上 inputs 总额 ${inputTotalSompi} market=${mid}`);
  }

  // ── MUST-FIX-2b(上游 §11.3): 守恒下界(启发式) ─────────────────────────────
  //  🔴 已知代价, 如实标: 若真实 fee/bond 占比超过 10%, 这条会【误拒合法结算】。
  //     90% 的正当性只到"拒绝信号"级别, 永不得被引用为"派彩金额已校验"。
  if (outputTotalSompi * MIN_OUTPUT_RATIO_DEN < inputTotalSompi * MIN_OUTPUT_RATIO_NUM) {
    return rej('OUTPUT_BELOW_HEURISTIC_FLOOR',
      `PB-S8-2 拒签+高噪: outputs 总额 ${outputTotalSompi} 低于输入 ${inputTotalSompi} 的 `
      + `${MIN_OUTPUT_RATIO_NUM}%(启发式下界, 非协议常量)— 可能是烧钱型退化 tx, `
      + `也可能是本阈值/费用模型过期, 两者都需要人看 market=${mid}`);
  }

  // 🔴 ok:true 的含义仅仅是"这几条便宜的拒绝信号都没有触发", 不是授权。见文件头覆盖边界。
  return { ok: true, reason: null, code: null };
}

/** 启发式上界: 参与方上限(migrate.js:5037 注释 "≤~64")+ fee/bond 输出留白。非协议常量。 */
export const MAX_REASONABLE_OUTPUTS = 64 + 10;
/** 启发式下界: 派彩总额不应低于输入的 90%。非协议常量, 红队/Bettor 可改。 */
export const MIN_OUTPUT_RATIO_NUM = 90n;
export const MIN_OUTPUT_RATIO_DEN = 100n;

/**
 * 严格解析一个 output 的面值为 sompi。解析不出返回 null(调用方须当作 cannot-verify)。
 * 🔴 字段名是 `.value` —— v2 稿写的 `.amountSompi || .value` 把优先级猜错了, Codex §6.1 更正。
 *    这里只认 `.value`, 不做"哪个有就用哪个"的兜底: 兜底会让字段改名变成静默的语义漂移。
 */
export function readOutputValueSompi(out) {
  if (!out || typeof out !== 'object') return null;
  const raw = out.value;
  if (typeof raw === 'bigint') return raw >= 0n ? raw : null;
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw < 0) return null;
    return BigInt(raw);
  }
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return BigInt(raw);
  return null;
}

function rej(code, reason) { return { ok: false, reason, code }; }
function short(s) { return typeof s === 'string' ? s.slice(0, 12) : String(s); }
