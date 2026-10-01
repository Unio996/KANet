# KTT 指定数量铸币（Bettor 2026-10-02 派工第一步；Owner 2026-10-02「测试币非常重要」）

问题：原 `/api/ktt/mint` 把整个 funding UTXO 减手续费全锁进代币，代币数量 = 锁入的 sompi（Codex R11 已指出），
等于每铸 1 KTT 锁 1 sompi，且一笔铸币吃掉 relay 一整个 UTXO。合约 `KanetTestTokenV2.sil` 的 `amount` 是 State 字段，
只要求输出 value>0，所以数量与 KAS 面值本可解耦。**合约、转账合约路径均未改。**

## 改动
- `kasia-console/src/api/tokens.js`：请求体加 `amount`（整数字符串，BigInt 全程，≤2^53-1，否则 400——同时关闭 R11 第②条）；
  代币 UTXO 只锁 `KTT_V2_MIN_LOCK_SOMPI = 70,000,000`（0.7 KAS），其余找零回 relay；transfer 路由把 State 数量传给 relay。
- `kasia-relay/src/lib/p2sh.mjs`：`unlockKttV2Mint` 支持 `ktt.change_address`（给了就只锁 seed、扣 mass-aware 手续费后找零；
  不给走旧行为，向后兼容）；`unlockKttV2Transfer` 的 State.amount 取 `cmd.ktt.amount`（缺省=UTXO 面值，旧持仓不变）。
  转账手续费仍是固定 6,500,000，本次未改。
- UI：`/tokens` 铸币表单加数量输入；钱包页 KTT 行原先把 amount 当 sompi 显示成 KAS，改为显示 KTT 数量（否则会把 100 万 KTT 显示成 0.01 KAS）。
- manifest `MRC-ktt-v2-panel-tokens` 刷新 content_digest（沿用原 review_ref，待 Bettor 复审增量）。

## 最小锁量怎么定的（真 simnet 共识实测，节点 29935）
covenant 输出 KIP-9 plurality p=2，storage mass ≈ C·p²/v = 4e12/v 克；节点最低中继费 100 sompi/克。

| 锁量 v | mint storage mass | mint 手续费 | transfer（固定 6.5M 手续费） |
|---|---|---|---|
| 100,000,000 | 40,017 | 4,401,870 | 通过（旧数据） |
| 70,000,000 | 57,158 | 6,287,270 | **通过**（mass 53,584 ≤ 65,000） |
| 60,000,000 | 66,677 | 7,334,360 | 本机偶然通过（手续费 UTXO 25 KAS 时 mass 被算术项压低）；手续费 UTXO 很大时 4e12/v=66.7k 克 > 65k，会被 pre-submit mass 闸拒 |
| 40,000,000 | 100,009 | 11,000,880 | **被拒**：`fee 6500000 < mempool floor 9650700 (mass=96507)` |
| 理论硬下限 8,000,000 | 500,000（节点上限） | ≈50M+ | — |

取 **70,000,000 sompi（0.7 KAS）**：恰使现有固定 6.5M 的转账手续费对任意大小的手续费 UTXO 都够付（4e12/7e7=57.1k 克）。
结果：铸任意数量都只花 ≈0.7 KAS 锁量 + ≈0.063 KAS 手续费。若将来愿意把转账手续费也做成 mass-aware，锁量可降到 ~0.2 KAS（总成本最低点），代价是每笔转账手续费升到 ~0.2 KAS——未做，留给 Bettor 裁。

## 验收（sim_mint_amount.mjs / .log，直调 relay 生产 handler，真广播）
- 铸 1,000,003 KTT：代币 UTXO 面值 = 70,000,000 sompi，数量 1,000,003；→ 自转 → 转给他人，数量守恒，covenant_id 全程延续。
- 铸 2^53-1 = 9,007,199,254,740,991 KTT：mint → transfer → transfer 全过。
- 守恒负例：State.amount 比源多 1 的转账被共识拒绝（`script ran, but verification failed`）。
- 2^53 / 2^53+1：API 层 400（`tokens-ktt-mint-amount.test.mjs`，含 JSON 数字字面量已失精度的情形）。
- 回归：`tokens-ktt-panel-gate.test.mjs` 全绿、`p2sh-ktt-panel-gate.test.mjs` 6/6、lint 0 error。

## 未覆盖（如实）
- 没有跑「真起 console + 真 relay 子进程」的 HTTP→IPC→广播全链（需主网 env/DB 引导）；路由构造的 cmd 键名与 handler 直调所用逐字段一致，路由层有请求体校验单测。
- 没有部分数量转账（relay transfer 仍是整笔转移，沿用原行为）。
- 旧持仓（amount=锁量）的转账路径未改，仅 State.amount 的取值在 cmd 里显式给出。
