// cn_real_human — Owner 12:52-12:57 88 KAS SELL 真测 trace 直接 port
//
// 这个 persona 不是 happy path, 是真人压测:
//   - 模糊宣告意图 ('我想卖一点 kas')
//   - 中途插问价格 ('目前卖价多少钱')
//   - 单 token 回链 ('Bsc') — 触发 B1: stale flow + ambiguous fresh field → broker 反方向 hallucinate
//   - 看到 broker 答错时怒骂纠正 ('???我有病吗 / 我卖kas')
//   - 杂糅一句含 addr + 限价 + 退款条件 — 触发 B3: broker 忽略所有条件
//   - 三连纠错 + 最后给 addr 拿到正确 SELL preview
//
// 设计原则: persona 看到 broker 反方向 hallucinate (reply 含 '买 .* USDT/USDC/KAS') → 怒骂分支
//           broker 路径正常 (reply 反问地址 / 出 SELL preview) → 顺路分支
// case 用 reply_does_not_contain 检测 broker 反方向 hallucinate 是否出现, 而不是检 persona 行为。

const SELL_QTY = 88;
const SELL_ADDR = '0x1417cfDaD7a5Be7d3D28350010194CFcABf2596D';

export default {
  id: 'cn_real_human',
  name: '中文真人 (Owner 风格)',
  description: 'Owner 12:52-12:57 88 KAS 真测 trace 直接 port: 杂糅/中途问价/单token链/限价指令/三连纠错',

  initialState() {
    return {
      stage: 'vague_intent',
      qty: SELL_QTY,
      addr: SELL_ADDR,
      angry_count: 0,
    };
  },

  step(state, brokerReply) {
    const r = String(brokerReply || '');
    // Owner 真测撞的反方向 hallucinate 信号: 含 '买' + USDT/USDC/KAS qty
    const isWrongDirection = /方向: 买/.test(r) || /买 \d+\s*(KAS|USDT|USDC)/.test(r);

    switch (state.stage) {
      case 'vague_intent':
        // T1: 模糊宣告
        return {
          message: '我想卖一点kas',
          nextState: { ...state, stage: 'qty_with_price_q' },
          done: false,
        };

      case 'qty_with_price_q':
        // T2: 数量 + 中途问价
        return {
          message: `卖${state.qty}个Kas, 目前卖价多少钱`,
          nextState: { ...state, stage: 'single_token_chain' },
          done: false,
        };

      case 'single_token_chain':
        // T3: 单 token 回链 — 测 B1 stale flow hallucinate
        return {
          message: 'Bsc',
          nextState: { ...state, stage: 'check_after_t3' },
          done: false,
        };

      case 'check_after_t3':
        // 看 broker 怎么答 T3
        if (isWrongDirection) {
          // B1 撞了: broker 反方向出 BUY preview → 怒骂纠正
          return {
            message: '???我有病吗\n我卖kas',
            nextState: { ...state, stage: 'price_query', angry_count: state.angry_count + 1 },
            done: false,
          };
        }
        // broker 正常反问地址 → 直接进价格问询
        return {
          message: '价格?',
          nextState: { ...state, stage: 'limit_order_combo' },
          done: false,
        };

      case 'price_query':
        // T5: broker 自纠后, 用户继续问价格
        return {
          message: '价格?',
          nextState: { ...state, stage: 'limit_order_combo' },
          done: false,
        };

      case 'limit_order_combo':
        // T6: 杂糅 — addr + 挂单价 + 退款条件 (测 B3 broker 忽略条件)
        return {
          message: `${state.addr}, 我想挂单价格设定0.0336. 如果10分钟内没人吃单, 麻烦帮我把Kas原路返回.`,
          nextState: { ...state, stage: 'check_after_t6' },
          done: false,
        };

      case 'check_after_t6':
        if (isWrongDirection) {
          // B3 撞了: broker 又跨方向 → 三连纠错
          return {
            message: '我卖Kas, 不是买! 你分不清楚买卖吗?',
            nextState: { ...state, stage: 'final_addr', angry_count: state.angry_count + 1 },
            done: false,
          };
        }
        // broker 正常出 SELL preview → 完成
        if (/卖单画像|方向:\s*卖/.test(r)) {
          return { message: null, nextState: { ...state, stage: 'done' }, done: true };
        }
        // 其他情况 (broker 仍在收集字段) → 给 addr
        return {
          message: state.addr,
          nextState: { ...state, stage: 'final_addr' },
          done: false,
        };

      case 'final_addr':
        // T8: 最后给 addr 拿 SELL preview
        return {
          message: state.addr,
          nextState: { ...state, stage: 'done' },
          done: true,
        };

      default:
        return { message: null, nextState: state, done: true };
    }
  },
};
