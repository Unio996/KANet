// 中文新手 — 第一次买 KAS, 谨慎, 一字段一问, 看到不懂的会追问.
// state machine: intent → (broker 反问) → field → (broker preview) → confirm.
// v1 deterministic; phrasing 中文口语化, 跟 Owner 真测真自然语言一致.

export default {
  id: 'cn_newbie',
  name: '中文新手',
  description: '中文用户, 第一次买 KAS, 一字段一问, 谨慎',

  initialState() {
    return {
      stage: 'intent',
      intent: 'buy',
      qty: 5,
      asset: 'KAS',
      chain: 'BSC',
      address: null,        // 买 KAS 不需要 EVM
      asked_questions: 0,   // 谨慎 — preview 后会追问 1-2 个细节
    };
  },

  step(state, brokerReply) {
    const r = String(brokerReply || '');
    switch (state.stage) {
      case 'intent':
        return {
          message: `我想买 ${state.qty} ${state.asset}`,
          nextState: { ...state, stage: 'wait_chain_question' },
          done: false,
        };

      case 'wait_chain_question':
        // broker 应该反问 chain
        if (/哪个链|哪条链|which chain/i.test(r)) {
          return {
            message: state.chain,
            nextState: { ...state, stage: 'wait_preview' },
            done: false,
          };
        }
        // broker 直接出 preview (字段齐 fast path) → 跳到 review
        if (/订单画像|卖单画像|preview/i.test(r)) {
          return {
            message: '什么是 maker?',  // 谨慎追问
            nextState: { ...state, stage: 'wait_explain', asked_questions: state.asked_questions + 1 },
            done: false,
          };
        }
        return {
          message: state.chain,
          nextState: { ...state, stage: 'wait_preview' },
          done: false,
        };

      case 'wait_preview':
        if (/订单画像|preview/i.test(r)) {
          if (state.asked_questions < 1) {
            return {
              message: 'maker 是谁? 是你直接卖给我吗?',
              nextState: { ...state, stage: 'wait_explain', asked_questions: state.asked_questions + 1 },
              done: false,
            };
          }
          return {
            message: '好',
            nextState: { ...state, stage: 'wait_finalize' },
            done: false,
          };
        }
        // broker 在反问 (chain 没说清楚, 重发)
        return {
          message: state.chain,
          nextState: state,
          done: false,
        };

      case 'wait_explain':
        // broker 解释完, 我回 '好' 确认
        return {
          message: '好',
          nextState: { ...state, stage: 'wait_finalize' },
          done: false,
        };

      case 'wait_finalize':
        // broker finalize 给 Kaspa 收款地址 + 转账指引
        if (/转 \d|请转|transfer|kaspa:q/.test(r)) {
          return {
            message: null,
            nextState: { ...state, stage: 'done' },
            done: true,  // persona 完成对话部分, 后续真转 KAS 由 case 真链 step 接
          };
        }
        // broker 又问什么 — 不耐烦了, 取消
        return {
          message: '算了 NO',
          nextState: { ...state, stage: 'cancelled' },
          done: true,
        };

      default:
        return { message: null, nextState: state, done: true };
    }
  },
};
