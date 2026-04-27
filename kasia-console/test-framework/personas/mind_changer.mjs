// 改主意用户 — 看 preview 反悔, 中途换方向 (BUY → SELL 或 KAS → USDC).
// 测 broker 是否能正确 reset _pendingPreview/_pendingAccepts state, 不带旧 context 进新方向.

export default {
  id: 'mind_changer',
  name: '改主意用户',
  description: 'starts BUY 10 KAS, sees preview, changes mind to SELL 3 KAS — broker must reset cleanly',

  initialState() {
    return { stage: 'first_intent' };
  },

  step(state, brokerReply) {
    const r = String(brokerReply || '');
    switch (state.stage) {
      case 'first_intent':
        return {
          message: '我想买 10 KAS',
          nextState: { ...state, stage: 'wait_first_chain' },
          done: false,
        };

      case 'wait_first_chain':
        if (/哪个链|chain/i.test(r)) {
          return {
            message: 'BSC',
            nextState: { ...state, stage: 'wait_first_preview' },
            done: false,
          };
        }
        return { message: 'BSC', nextState: { ...state, stage: 'wait_first_preview' }, done: false };

      case 'wait_first_preview':
        if (/订单画像|preview|10 KAS/.test(r)) {
          // 改主意!
          return {
            message: '不要了, 我要卖 3 KAS, BSC, 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74',
            nextState: { ...state, stage: 'wait_second_preview' },
            done: false,
          };
        }
        return {
          message: '不要了, 我要卖 3 KAS, BSC, 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74',
          nextState: { ...state, stage: 'wait_second_preview' },
          done: false,
        };

      case 'wait_second_preview':
        // broker 应该 reset 出 SELL 3 KAS preview
        if (/卖单画像|sell.*3 KAS/i.test(r) || /3 KAS.*BSC/.test(r)) {
          return {
            message: 'YES',
            nextState: { ...state, stage: 'done' },
            done: true,
          };
        }
        // broker 仍然在 BUY 10 KAS state — 反复说 cancel
        return {
          message: 'NO 取消, 改卖 3 KAS BSC 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74',
          nextState: state,
          done: false,
        };

      default:
        return { message: null, nextState: state, done: true };
    }
  },
};
