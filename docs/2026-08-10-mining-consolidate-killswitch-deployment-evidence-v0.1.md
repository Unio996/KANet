# mining-consolidate kill-switch + autoSplitAll skip-guard — 部署证据 v0.1

> **Status**: CURRENT

**Author**: KANet-UI · **日期**: 2026-08-10

**目的**: Codex(经 Codex 桥 626e6a63)判"再毒化已停=OPEN,直到有部署证据(effective config 实值 + 观察窗内零调用不可读目标)"——本稿把频道里已经贴过的行为证据整理成结构化文档落 git,供下一轮直接闭。频道原文本身对 Codex 结构上不可读(不是可审证据),本稿是权威落地版本。

**关联**: commit `114c5513`(diff 本体)、`docs/2026-08-10-canary2-layer3-side-lock-daa-recovery-plan-v0.1.md`(本次修复解锁的下游工作)、NWT 快审 PASS(dev-coord-testnet #57b882 附近,五点核过 + 独立核过 pre-restart log)。

---

## §1 diff 本体(已 commit,NWT 审 PASS)

`kasia-console/src/lib/mining-utxo-consolidate.mjs`:
```js
const CONSOLIDATE_ENABLED = (process.env.MINING_CONSOLIDATE_ENABLED || 'true').trim().toLowerCase() !== 'false';
...
export function startMiningConsolidateCron() {
  if (timer) return;
  if (!CONSOLIDATE_ENABLED) {
    console.log('[mining-consolidate] MINING_CONSOLIDATE_ENABLED=false — cron not started (kill-switch, see TREASURY-UTXO-UNREADABLE card)');
    return;
  }
  const relayId = _miningRelayId();
  ...
```

`kasia-console/src/services/utxo-splitter.js`:
```js
const UNREADABLE_RELAY_IDS = new Set([
  'd9a8fffb-e9d6-4019-a9cb-fcdb4760dea1', // FaucetRelay-tn-2
  'ce43e1b1-f16b-4e2b-ba22-56cc9bb26762', // MiningRelay-tn12-new
]);
...
  for (const a of accounts) {
    if (UNREADABLE_RELAY_IDS.has(a.id)) {
      console.warn(`[utxo-splitter] ${a.name}: skipped: address unreadable, see card (TREASURY-UTXO-UNREADABLE)`);
      continue;
    }
    try {
```

20 行插入,2 文件,`node --check` 双过,`lint-kanet.mjs` 0 error。

## §2 本机 config 实值(gitignored,不在 commit 里,现场核)

`kanet.env:168`:
```
MINING_CONSOLIDATE_ENABLED=false
```
（改动位置:`kanet.env:161-168`,紧接 `MINING_RELAY_ID=ce43e1b1-...` 之后,带一行止血注记。`kanet.env` 本身 gitignored,此为本机现场核对,不是引用未落地的声明。）

## §3 重启窗#2 执行(带证据的部署时间线)

- kanet-stop.sh 本次撞了在册的 stale-pidfile 坑(`reference-console-restart-stale-pidfile-orphan-trap`):只杀到一批"残留进程",真活 console(PID 34416,14:06:28Z 起)未死,继续跑旧码。
- 手动核 `netstat -ano | grep :3200 LISTENING` → 真活 owner = 34416 → `taskkill /F /T /PID 34416`(树杀,带走 34 个子进程,relay 全灭无孤儿)。
- `bash kanet-start.sh` 拉起新进程,新 PID **2552**,`StartTime = 2026-08-10 21:27:17`(本机时区,= 14:27:17Z)——晚于两次 kill、晚于 commit `114c5513`。

## §4 部署生效的行为证据(behavioral proof,新 console.log 里逐行摘)

Kill-switch 生效(启动阶段):
```
104:[mining-consolidate] MINING_CONSOLIDATE_ENABLED=false — cron not started (kill-switch, see TREASURY-UTXO-UNREADABLE card)
```

Skip-guard 生效(启动阶段 autoSplitAll 扫描到这两个 relay 时):
```
532:[utxo-splitter] FaucetRelay-tn-2: skipped: address unreadable, see card (TREASURY-UTXO-UNREADABLE)
538:[utxo-splitter] MiningRelay-tn12-new: skipped: address unreadable, see card (TREASURY-UTXO-UNREADABLE)
```

## §5 观察窗(零调用不可读目标,44 分钟,14:27:17Z → 15:11:29Z)

现场重跑(`grep -n` 全文匹配,不是抽样):
```
$ grep -n "FaucetRelay-tn-2" logs/console.log | grep -iE "UTXO SPLIT|split_utxo|consolidate"
(零命中)

$ grep -n "MiningRelay-tn12-new" logs/console.log | grep -iE "UTXO CONSOLIDATE|consolidate_utxo|UTXO SPLIT"
(零命中)

$ grep -n "mining-consolidate\]" logs/console.log
104:[mining-consolidate] MINING_CONSOLIDATE_ENABLED=false — cron not started (kill-switch, see TREASURY-UTXO-UNREADABLE card)
(此后再无 mining-consolidate 任何 tick 行——cron 确实没起,不是起了但没打印)

$ grep -c "RuntimeError: unreachable" logs/console.log
0

$ grep -c "relay exited (code" logs/console.log
0
```

两个 relay 进程本身仍正常启动、连 RPC、订阅区块(它们是合法业务地址,不是要被下线的对象)——本稿只断言"split_utxo / consolidate_utxo 命令零次发往这两个地址",不是"这两个 relay 不跑"。

## §6 与 J2 判据对齐的旁注

J2 14:23 预先写死的验收判据是"背景流降到 ≤2~3 次/10 分钟,非归零"(0.2/分未知残余不许被本次修复叙事吃掉)。重启后独立核过(14:32 频道):consolidate 干净跑的 17 分钟窗口(14:06→14:23,重启前)里,一个与 wasm trap/consolidate 均无关的独立 IPC 抖动族(`[ingest] Console unreachable`→`Console recovered`,约 4 分钟一簇)持续存在——**本次两处 fix 均未针对这个抖动族**,它是否会计入"背景流"的实测读数,留给该判据的实际执行方核实,本稿不替代那次测量。

## §7 结论

§4+§5 是行为证据(不是 commit 存在性声明、不是"应该生效"的推断):kill-switch 在启动日志里可见触发、skip-guard 在启动日志里可见触发、44 分钟观察窗内两个已知不可读地址零次被 split/consolidate 命令触碰、零 wasm trap、零 relay 崩溃。§1 diff 与 §3 部署时间线可独立核对(commit hash + PID StartTime + kill 时刻的先后关系)。

**本稿到此,供 Codex 下一轮直接读取判定。**
