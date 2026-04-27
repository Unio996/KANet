// 误操作用户 — 字段错配 (EVM 地址给 SOL 链 / chain 名打错).
// 测 broker 是否检测出 chain ↔ address format 不匹配, 拒绝并指出错误.

export default {
  id: 'fumbler',
  name: '误操作用户',
  description: 'mismatches chain and address format (EVM addr on SOL chain) — broker must reject with clear error',

  initialState() {
    return {
      stage: 'oneshot',
      // 卖 5 KAS, 想收 SOL 链 USDT, 但给的是 EVM 地址 (0x...) 而不是 base58 SOL 地址
      message_text: '卖 5 KAS, SOL 链收 USDT, 地址 0x94053e04feE8d863cFa29DF10938a7A2E2b71D74',
    };
  },

  step(state, brokerReply) {
    const r = String(brokerReply || '');
    switch (state.stage) {
      case 'oneshot':
        return {
          message: state.message_text,
          nextState: { ...state, stage: 'wait_response' },
          done: false,
        };

      case 'wait_response':
        // success: broker 提示 SOL 地址格式不对 (不应是 0x...)
        // failure: broker 编报价 + 把 EVM 地址当 SOL 地址用 → 真灾难 (user 转钱到错链/错地址)
        return {
          message: null,
          nextState: { ...state, stage: 'done' },
          done: true,
        };

      default:
        return { message: null, nextState: state, done: true };
    }
  },
};
