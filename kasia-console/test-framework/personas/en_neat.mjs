// English neat user — Eric-style, gives all fields one-shot, wants speed.
// 走 fast path (字段齐 → preview → YES → done).

export default {
  id: 'en_neat',
  name: 'English neat',
  description: 'English user, gives all fields in one message, expects fast preview + YES path',

  initialState() {
    return {
      stage: 'oneshot',
      direction: 'sell',
      qty: 5,
      asset: 'KAS',
      chain: 'BSC',
      address: '0x94053e04feE8d863cFa29DF10938a7A2E2b71D74',
    };
  },

  step(state, brokerReply) {
    const r = String(brokerReply || '');
    switch (state.stage) {
      case 'oneshot':
        return {
          message: `${state.direction} ${state.qty} ${state.asset}, ${state.chain}, ${state.address}`,
          nextState: { ...state, stage: 'wait_preview' },
          done: false,
        };

      case 'wait_preview':
        if (/订单画像|卖单画像|preview/i.test(r)) {
          return {
            message: 'YES',
            nextState: { ...state, stage: 'wait_finalize' },
            done: false,
          };
        }
        // broker 没出 preview 反问字段 — 用户重发完整 oneshot 不耐烦
        if (/链|chain|地址|address/i.test(r)) {
          return {
            message: `${state.direction} ${state.qty} ${state.asset}, ${state.chain}, ${state.address}`,
            nextState: state,
            done: false,
          };
        }
        return {
          message: 'YES',
          nextState: { ...state, stage: 'wait_finalize' },
          done: false,
        };

      case 'wait_finalize':
        return { message: null, nextState: { ...state, stage: 'done' }, done: true };

      default:
        return { message: null, nextState: state, done: true };
    }
  },
};
