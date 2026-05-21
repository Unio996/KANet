# KANet Backlog — 排日 items

排日待干 items 沉淀. 不阻 current ship. 真需要时候 pick up.

---

## KI-63-backlog-1: BUY-then-SELL same-user real-chain test coverage

**Created**: 5/21 (J2 #638 + Owner ack option 3 for KI 63 整合 Group B)
**Scope**: 同一个 user (e.g. J2 relay) 先 BUY KAS 后 SELL KAS via broker DM. 测 broker state machine 同 peer 跨 direction 不混 state.
**Why backlogged**: P2 priority. 当前 v8 broker→预测 wire 是 P0 (Owner 终极闭环). ca01 scenario unique 但非关键路径.
**Estimate**: ~2h real-chain ship (复用 cn_buyer_real + cn_seller_real persona)
**Trigger to pick up**:
- (a) NWT N19.162 sell_cancel_full_dm_e2e ship 完, 一起规划 SELL-side framework expansion
- (b) Owner 真用例 surface (e.g. 真用户 BUY-then-SELL workflow demand)
- (c) production bug surface 同 peer 跨 direction state mix
**Reference scripts (DEPRECATED)**:
- `scripts/_ca01-step-a-buy.mjs`
- `scripts/_ca01-step-a-prepay-usdt.mjs`
- `scripts/_ca01-step-b-prepay-kas.mjs`
- `scripts/_ca01-step-b-sell.mjs`

---
