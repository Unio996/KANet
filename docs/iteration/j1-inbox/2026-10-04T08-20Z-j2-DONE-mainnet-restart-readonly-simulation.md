# J2 → Bettor · 重启前只读模拟 DONE（主网 DB 副本 + 生产 tick 选择器）
只读：没碰活库文件（只读 `.backup` 取副本）、没改 env、没重启、没发任何链上交易。证据 `docs/provenance/2026-10-04-j2-restart-readonly-sim/`。副本在 scratch（含主网数据，不入库）。

## 结论（先说）
1. 副本取自 `kasia-console/data/console.mainnet.db`（better-sqlite3 `readonly:true` + `.backup()`，在线一致，活 console 未受影响）。副本 `integrity_check=ok`、FK 违规 0。
2. 迁移（用主网检出 HEAD `3a585ed9` 的 `migrate.js` 跑在副本上）：**无错误**。库内 schema 唯一变化 = `zk_prove_jobs`（v220 加 `attempts`/`next_attempt_at`）；无新增/删除表或索引。迁移日志里 "fail" 字样仅是 v174 的描述文案。
3. **7 个 tick + 现有 prove worker：对该副本全部 0 候选 0 动作**（真 SQL 选择器、真 tick 函数；ctx 里所有副作用——relay/广播/转账/建 UTXO——一律 stub 成"记录并抛错"，`sideEffectAttempts` 全空）。
   `pool_markets=0 / payout_shards=0 / zk_prove_jobs=0 / market_shards=0 / collecting_sigs=0`；没有任何一行会被任何 tick 拾取。`relay_nodes.is_oracle=1` 共 6（与账本 1838 一致）。
4. 其余本 env 会启用的循环：除这 7 个外，§8 env 只新增 `BSHARD_SETTLER_RELAY_ID`/`SETTLE_DAEMON_FEE_RELAY_ID` 读取点；`SETTLE_DAEMON_ENABLED` 不设 ⇒ V1 老 daemon 不起（`startSettleDaemonCron` 在 FEE_RELAY 检查前先看 ENABLED）。我 grep 过这两个变量全部消费点，无其它循环被它们唤醒。
5. 对 env 文件的核对（`kanet.mainnet.env`）：`ZK_PROVE_WORKER_ENABLED=0` / `BSHARD_CLOSE_VOTER_V2_ENABLED=0` / `BSHARD_CLOSE_SUBMIT_V2_ENABLED=0` **恰在第 43/44/45 行，各只出现一次**（目前没有重复键；若 append 才会变成重复）。`start-console-mainnet.ps1` 逐行 `SetEnvironmentVariable`（后写覆盖前写）= last-wins，已确认。原地替换更好。
6. 其余：该 env 里目前**没有** ZK_*/BSHARD_*/SETTLE_DAEMON_* 键（只有 SILVERC_V100_PATH 与 ADMIN_SECRET_FUNDS 已在），§8 的键需要补齐。

## 两个必须当心的点（不是 bug，是会咬人的细节）
- 🔴 **`start-console-mainnet.ps1` 不剥行内注释**：它按 `^([^=]+)=(.*)$` 取值，`ZK_PROVE_WORKER_ENABLED=1   # 说明` 的值会是 `1   # 说明`，开关 `=== '1'` 判不过 ⇒ **静默没开**。我的 §8 复制块本身没有行内注释，但我文件 §1/§4 的说明行有——别从那些行复制。追加时：不带 `#` 尾注、不带尾随空格；注释另起一行。文件带 UTF-8 BOM（现状即如此，不要用会改编码的工具改）。
- **IBD 门 fail-closed**：生产里每个 tick 入口先过 `ibdGateSkip`，只有节点 `isSynced===true` 才放行。我的第一次模拟因为没有活 RPC，7 个 tick 全部 "skipped: ibd"——这会让"0 动作"变成无信息。第二次用 `IBD_TICK_GATE=0` 才让真选择器跑（见 sim.mjs 注释）。主网 kaspad 未同步时 tick 全 skip 是安全方向，重启后第一轮日志里出现 `skip: node not synced` 不是故障。

## 阳性对照（防"0 候选"是空判据）
在**第二份**副本里造 1 行 `v0.7 / zk_native / collecting_sigs / metadata 含 bshard_close_request_v2` 的垃圾市场：`bshardCloseSubmitV2Tick → pending=1`（notReady=1，无广播）、`bshardCloseVoterV2Tick → pending=1`（errored=6，因垃圾 request 无法验，**无签名**）。说明模拟用的选择器确实能选中此类行；真实库里 0 是因为真的没有。对其它 5 个 tick（judge/handoff/close/claim/prove）我只对真实空库跑了，没各自造对照行——它们的选择器逻辑在 seg1–4 的 simnet e2e 里已用真数据命中过（日志 `seg4_e2e_autonomous_ticks.log.txt`），但这次模拟本身没复测。
- 副本里模拟期间写入了若干 `events`（健康/告警类）——在副本里，不在活库。

## 问 5：7 个开关能否一次重启全开？
**可以，在"零活盘"前提下我认为安全，比逐个重启更好**，理由与边界：
- 选择器都以 DB 行为输入；零盘 ⇒ 每个 tick 空转（上面实测）。逐个开的原意是"每开一个就看一轮日志确认该 tick 起得来"，这个目的在一次重启里同样达到：看启动日志里 7 行 `... starting·tick=` / `cron started`（judge、handoff、close_v2、claim 4 条来自 settle-daemon；voter-v2、submit-v2、prove-worker 各 1 条）。多次重启反而增加重启次数（每次重启都有 console 重启的已知代价：共享 RpcClient 重连等）。
- 它们在有活之前互不影响；上游没产出下游就没输入，不存在"全开后乱序"。
- **一次全开安全的前提（任一不满足就别一次全开）**：①`BSHARD_SETTLER_RELAY_ID` 已设且该 relay 已有钱（否则 4 个 tick 打 "NOT starting"，prove worker 在拿到 job 时 `_fail`——这个才是最容易踩的）；②6 个 oracle `is_oracle=1`（已满足）；③`checkHostBinary()` ok（我 §5 已核）；④env 行无行内注释（见上）；⑤五个 ZK 值齐全（缺一在**第一个盘创世时**才 fail-loud，不是启动时——所以启动日志看不出，须靠建盘前自检）。
- **真正的风险不在"一次 vs 逐个"，而在第一个市场出现之后**：那时 7 个 tick 同时在岗，任何一个有 bug 都动真钱。建议按**市场**分阶段观察（首盘 maker 质押小、单分片、2 个下注者），而不是按开关分阶段。想保留一道人工闸：可以先只开前 6 个、CLAIM 最后——但那需要第二次重启，我不认为必要，因为 claim 只在 closed==2 的 zk_continuation 出现后才有活。
- 一个我没验证的点：本模拟无法验证"七个 tick 同时起"对 console 事件循环/内存的叠加影响（simnet 里我是同样 7 个全开跑的 e2e，没出问题，但那是 simnet 轻载）。

## 文件
`backup.cjs`（只读 .backup）、`inspect.cjs`（schema diff/计数）、`sim.mjs`（7 tick + prove worker，ctx 副作用全 stub）、`posctl.mjs`（阳性对照）、`migrate.log`、`sim2.log`。日志已查无密钥/地址（grep 0）。
