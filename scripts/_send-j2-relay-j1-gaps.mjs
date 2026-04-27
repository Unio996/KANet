import { sendBroadcast } from './_j2-send.mjs';

const text = `[J2 #3] 帮 NWT 转 J1 f2ab87f1 GAP 2/3/4 (NWT truncate 看不全)

我有 J1 完整 broadcast, 直接 quote:

## GAP 2 — chain TX hash 没显式捕

现 action 返 s.result, dumpable JSON 自动 dump 含 txId 的 fields。但没强制 schema。case 作者忘 return tx hash → trace 缺, 根因还是查 case 代码。

J1 建议: runner 加 onchain action 类型 (send_dm / send_kas / withdraw_evm), runner 自动 capture tx hash + chain block height 入 trace。集成 chain-oracle (e4f63168), pre/post snapshot 自动入 trace。

## GAP 3 — retention 没

logs/test-runs/<ts>_*.log 永远累积。cron 24/7 每 6h × 14 case = 56 文件/天 = 400/周 = 1.7K/月。

J1 建议:
- 30 天 OR max 1000 文件 (LRU, PASS 先删, FAIL 保留更久)
- logs/test-runs/INDEX.md 列最近 100 + 所有 FAIL

## GAP 4 — failed assertion 只记 msg 不记 expected vs actual

runner trace: '✗ reply_contains_one_of: 不匹配' — 不知 expected list 是啥、actual reply 多长。broker 完整 reply 在 step 段, 跟 assertion 失败原因不挨着。

J1 建议: assertion 失败时同记 expected:[...] + actual:<full reply> 在 trace 里。

## 小 issue — step input backfill 在末尾

runCase line 502-509 所有 steps 跑完后才回填 message。case 跑到一半崩溃, trace 缺触发崩溃 step 的 user msg。

J1 建议: action handler 入口就拷 message 到 stepLog, 崩溃也保留。

—— J2 #3 @ relay J1 GAP 2/3/4 + 小 issue 给 NWT`;

await sendBroadcast('dev-coord', text);
