// 中文新手 SELL 版 — 对称 cn_newbie BUY, 测 SELL 链路 UX.

export default {
  id: 'cn_newbie_sell',
  name: '中文新手 (卖)',
  description: '中文用户, 第一次卖 KAS, 一字段一问, 谨慎',

  initialState() {
    return {
      stage: 'intent',
      intent: 'sell',
      qty: 5,
      asset: 'KAS',
      chain: 'BSC',
      address: '0x94053e04feE8d863cFa29DF10938a7A2E2b71D74',
      asked_questions: 0,
    };
  },

  step(state, brokerReply) {
    const r = String(brokerReply || '');
    switch (state.stage) {
      case 'intent':
        return {
          message: `我想卖 ${state.qty} ${state.asset}`,
          nextState: { ...state, stage: 'wait_chain_question' },
          done: false,
        };

      case 'wait_chain_question':
        // broker 应该反问 chain (或地址)
        if (/哪个链|哪条链|which chain|0x|地址|EVM/i.test(r)) {
          return {
            message: `${state.chain}, ${state.address}`,
            nextState: { ...state, stage: 'wait_preview' },
            done: false,
          };
        }
        return {
          message: state.chain,
          nextState: { ...state, stage: 'wait_preview' },
          done: false,
        };

      case 'wait_preview':
        if (/卖单画像|订单画像|preview/i.test(r)) {
          if (state.asked_questions < 1) {
            return {
              message: '我转 KAS 给你了, 你跑了怎么办? 钱去哪了?',
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
        // 没出 preview, 重发 chain + addr
        return {
          message: `${state.chain}, ${state.address}`,
          nextState: state,
          done: false,
        };

      case 'wait_explain':
        return {
          message: '好',
          nextState: { ...state, stage: 'wait_finalize' },
          done: false,
        };

      case 'wait_finalize':
        if (/转 \d|请转|transfer|kaspa:q|已建/.test(r)) {
          return {
            message: null,
            nextState: { ...state, stage: 'done' },
            done: true,
          };
        }
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
