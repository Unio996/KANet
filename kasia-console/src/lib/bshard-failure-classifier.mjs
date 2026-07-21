// bshard-failure-classifier.mjs — #49 daemon 错误处理模块化设计① (J2, 2026-07-04)
//
// 设计: docs/2026-07-04-daemon-error-handling-modular-design.md
// 目的: 把 _settleOneMarketAttempt 抛出的异常分成三类, 各走各的处置路径, 不再一视同仁塞进
// "重试3次不行就永久 settle_failed" 的桶里(今天从 Owner"经常退化"的质疑一路查实的根因)。
//
// 判定顺序(NWT 指出顺序敏感, 写死不可调换):
//   TRANSIENT_RE(复用 G5-5a 现有常量, 不重新定义等价一份) → BUSINESS_PENDING(UMA-ABSTAIN 专属)
//   → CODE_BUG(instanceof 优先, 正则次要兜底) → UNCLASSIFIED(当 CODE_BUG 同款处置)。
// 为什么这个顺序: 畸形 RPC 响应可能触发看起来像"Cannot read property"的错误(代码访问了 RPC
// 返回的不完整对象的某个字段)——这本质是瞬态基础设施问题, 不是我们代码坏了。先查 TRANSIENT_RE
// 能把这类情况正确分流, 避免误判成 CODE_BUG(误判后果不严重, 只是多余告警噪音, 但顺序写清楚
// 能减少噪音)。

const CODE_BUG_HINT_RE = /is not defined|is not a function|Cannot read propert/i;

/**
 * classifyFailure — 纯函数, 无副作用, 可单独单测。
 * @param {Error} error
 * @param {object} market — pool_markets 行(至少需要 outcome_market_source)
 * @param {RegExp} transientRe — 复用调用方(bshard-settle-daemon.mjs)现有的 TRANSIENT_RE 常量,
 *   不在本模块内重新定义一份等价的(NWT 指出: 分开维护两份判据以后各自改动容易跑偏)。
 * @returns {{ type: 'TRANSIENT'|'BUSINESS_PENDING'|'CODE_BUG'|'UNCLASSIFIED', detail: string }}
 */
export function classifyFailure(error, market, transientRe) {
  const message = String(error?.message || error || '');

  // ① TRANSIENT — 先查(顺序见上方注释)
  if (transientRe && transientRe.test(message)) {
    return { type: 'TRANSIENT', detail: message };
  }

  // ② BUSINESS_PENDING — UMA-ABSTAIN 专属(ESPN 的 ABSTAIN 没有慢速裁决场景, 走 #47 人工评估,
  //   不进 re-judge 调度器)。
  if (/UMA judge ABSTAIN|judge ABSTAIN/i.test(message) && market?.outcome_market_source === 'polymarket') {
    return { type: 'BUSINESS_PENDING', detail: message };
  }

  // ③ CODE_BUG — 优先用结构化类型判定(Bettor 指出: JS 运行时错误类型确定, 比字符串正则稳,
  //   错误文案会变但 instanceof 不会)。正则只作次要信号兜底(某些库把错误包装成普通 Error)。
  if (error instanceof TypeError || error instanceof ReferenceError) {
    return { type: 'CODE_BUG', detail: message };
  }
  if (CODE_BUG_HINT_RE.test(message)) {
    return { type: 'CODE_BUG', detail: message };
  }

  // ④ 兜底 UNCLASSIFIED — 保守当 CODE_BUG 同款处置(fail-safe: 宁可多告警, 不可误判成
  //   "业务正常等待"而实际是代码坏了; 不管误判成哪一类, 默认路径不改 protocol_status/不碰钱,
  //   出错代价只是"多告警", 不会造成资金/状态风险 — NWT 认可的设计点)。
  return { type: 'UNCLASSIFIED', detail: message };
}

/**
 * shouldKeepStatus — 分类结果是否意味着"别覆盖 protocol_status"(CODE_BUG/UNCLASSIFIED/TRANSIENT
 *   重试耗尽都不该武断标 settle_failed; 只有真正确认的失败才该改状态)。
 *   BUSINESS_PENDING 不查这个函数——它走独立的 uma_pending 调度路径(见 scheduleUmaRejudge)。
 */
export function shouldKeepStatus(classification) {
  return classification.type === 'CODE_BUG' || classification.type === 'UNCLASSIFIED' || classification.type === 'TRANSIENT';
}
