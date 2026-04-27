# (a) 测试 case 矩阵 (J2 草稿, 等三方 + Owner 拍)

按 J2 6 维度 + J1 4 补充, 共 10 维度 case coverage。每 case 标注: P0/P1/P2 + 主测维度 + 复现 production state 方案。

## P0 (~12 case, must-pass for ship)

| ID | 场景 | 维度 | state 复现 |
|----|------|------|----------|
| owner_88kas_full | Owner 12:52 8-turn 真 trace | 杂糅+单token+限价+三连纠错 | γ snapshot |
| owner_88kas_t3_bsc | T3 'Bsc' single → broker 不能跨方向 | 单token+stale flow | γ snapshot |
| owner_88kas_t6_limit | T6 杂糅含限价+退款 → broker 不能忽略 | condition retention | γ snapshot |
| owner_88kas_t5_price_in_sell | T5 SELL 中问价 → broker 不能给 BUY 引导 | direction-aware price | γ snapshot |
| owner_04_08_fake_price | 04:10 broker 编 0.055 USDT/KAS fake | LLM free-text price oracle dev | γ snapshot |
| lifecycle_paid_no_cancel | 已 paid 不能 cancel | phase 转换 | inject_history + chain |
| lifecycle_confirmed_no_addr_change | 已 confirmed 不能改 addr | R31 + phase | inject_history |
| chain_reconcile_buy_kas_e2e | 真链 BUY KAS, pre/post snapshot 必匹 | chain-oracle | 真链, 真钱包 |
| chain_reconcile_sell_kas_e2e | 真链 SELL KAS, pre/post snapshot 必匹 | chain-oracle | 真链, 真钱包 |
| price_oracle_deviation_reject | broker reply 价 vs fetchPrice >5% → R33 拒 | R33 invariant | mock LLM |
| direction_sticky_lock | turn 1 SELL → turn 2+ fresh BUY 信号必 reject | R32 sticky | inject_history |
| owner_real_trace_replay_ok_88kas | NWT (d) v2 后 Owner 真 12:52 trace replay 必 reproduce 真撞 | framework 自检 | trace replay |

## P1 (~20 case)

用户场景:
- cn_newbie_buy_5_kas (已存)
- cn_real_human (已 draft)
- en_neat_one_shot
- mind_changer_buy_to_sell (已存)
- liar_fake_payment (已存)
- fumbler_chain_addr_mismatch (已存)
- malicious_addr_swap (已存)
- typo_recover (用户 typo 'kas' → 'kss', broker 容错)
- mixed_lang_zh_en (中英混)
- emoji_in_msg (用户带 emoji, broker 不 confused)
- abbreviation (用户用 'plz' / 'thx', broker 识别)
- slow_typing (用户慢慢发, broker 不重发反问)

phase 维度:
- preview_to_confirm_clean
- confirm_to_paid_with_tx
- paid_to_verifying
- verifying_to_delivered
- delivered_to_completed

R33 维度:
- price_oracle_deviation_pass (价在 ±5% 内, 通过)
- llm_reply_no_naked_price (LLM 不能 naked 编价)
- direction_lock_buy_to_sell_explicit_reset (NO 后才能换方向)
- condition_retention_limit_price (用户限价指令必 capture 进 preview)

攻击者 (J1 own ~30):
- (J1 14 现有 + 16 待补)

## P2 (~20 case)

边缘:
- dust_amount_reject
- timeout_30min_auto_cancel
- mind_change_during_paid (已 paid 想改主意)
- sibling_broker_dm (R26 hijack)
- multi_peer_concurrent (broker state 不互相干扰)

## 维度 coverage matrix

| 维度 | 数量 |
|------|------|
| 1 真人语言 (zh/en/混) | 已 cover P1 |
| 2 production state 复现 | γ snapshot 全 P0 |
| 3 broker 说话质量 (4 assertion) | 全 case 默认加 |
| 4 R33 invariant | P0 4 case |
| 5 反复测 stability (跑 5 次都 PASS) | P0 必跑 |
| 6 Owner spot-check trace | NWT (d) v2 后必接 |
| 7 lifecycle phase | P0 2 + P1 5 |
| 8 攻击者维度 | J1 own ~30 |
| 9 真测自动入库 | NWT (d) v2 #6 后默认 |
| 10 chain-oracle 集成 | P0 真链 e2e 2 case |

## ship 顺序

1. NWT (d) v2 ship (含 #6 snapshot)
2. J1 R33 broker code review pass (J2 ship)
3. J2 ship P0 12 case + 必 5x stability
4. NWT 整合 broker 说话质量 4 assertion 进 framework
5. 跑 P0 全 PASS + Owner spot-check 1 个 trace 接受
6. ship P1 20 case
7. cron 24/7 跑 P0+P1 nightly
8. J1 攻击者 ~30 case 同步 ship

预估 ETA: NWT (d) v2 30min + R33 ship 1h + P0 case ship 1h + 真测验证 1h = **~3-4h** to first PASS。
