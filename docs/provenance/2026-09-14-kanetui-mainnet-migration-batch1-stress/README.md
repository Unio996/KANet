# 主网账号迁移 · 第 1 批（stress 验证批）执行证据（2026-09-14 · KANet-UI · Bettor 1180 派工 · Owner 原话「执行第 1 批」）

> 执行依据：执行页 v0.2（`docs/2026-09-14-kanetui-mainnet-migration-batch1-stress-exec-v0.1.md`，commit `39bd851a`），NWT 审 `676d83be` GREEN-with-ONE-SMALL-FIX（已并入 v0.2）。**本页不含任何密文/明文密钥材料**——地址是公开链上信息，余额是只读查链结果，不含 `mnemonic`/`mnemonic_encrypted`/旧密钥/新密钥任何字段。

## 结论（先给数字，细节见下）

| 项目 | 结果 |
|---|---|
| 导入行数 | **10 / 10**，全部一次通过（无 mismatch、无 denied） |
| 启动数 | **10 / 10**（health-monitor 首次 tick 即全部拉起，`deadCount 10→0`） |
| 总驻留余额 | **4.98498280 KAS**（10 行独立链上核实之和，远低于 total cap 1000） |
| 驻留期监控 tick 摘要 | 观察窗口内 3 次 tick，`checked=10 killed=0`，零杀 |
| `events.hotwallet_relay_killed` | 导入前后均 `0` |
| stderr FATAL/error | 观察窗口内 `0` |

## §1 执行前检查（全部通过）

- `C:\KANet` 下无 node 进程，`:3100`/`:3200` 均未监听（源库确认无持有进程）。
- 当前 mainnet console：PID `15396`（与 2026-09-14 热钱包部署验收时一致，未漂移），`127.0.0.1:3202` 监听中。
- `kanet.mainnet.env` 三个准入门键核实未变：`RELAY_HOTWALLET_PER_RELAY_MAX_KAS=800`、`RELAY_HOTWALLET_TOTAL_MAX_KAS=1000`、`RELAY_HOTWALLET_COLD_ADDRESSES` 含 Trader-B/MarketMaker-A 两个地址；`HOTWALLET_MONITOR_OFF` 未设；当前进程 stdout 里 `[relay-hotwallet-monitor] started — tick=30000ms grace=90000ms max_consecutive_failures=3` 命中 1 次，确认这个 PID 是带着准入门起来的。
- 源库（`C:\KANet\kasia-console\data\console.db`）只读查得 10 行（`stress-user-01`~`08`、`stress-control-01`~`02`），逐字匹配名单。
- 目标库（`console.mainnet.db`）执行前这 10 个名字 `COUNT=0`，确认非重复导入。

## §2 拒绝场景探针（一次通过，无需清理）

- 探针：`POST /relays`，`name=zzz-admission-probe-1789332136552`、`address=<Trader-B 冷清单地址>`、**无 `mnemonic`**。
- 响应：`302`，`Location: /relays?hotwallet_denied=cold_address_denied`——与 `checkHotwalletAdmission()`/`relay-manager.js:102` 内部拒绝理由字符串逐字一致。
- 复核：`relay_nodes` 里 `name LIKE 'zzz-admission-probe-%'` 计数 `0`——行确实没有被插入，v0.2 §2 第 5 点 a/b 的清理分支本次未触发（探针一次通过，未走到"未被拒"的异常分支）。
- 结论：`checkHotwalletAdmission()` 这个 import 早失败层与 `startRelay()` 共用的准入函数，在**这个具体部署实例、带着这份 env**下确认真实生效——补上了侧分支单测（隔离测试库）覆盖不到的最后一环。

## §3 逐行导入结果（10/10，见下表；地址均为公开链上信息）

| name | address | 派生比对 | 导入结果 | 链上余额（本人只读核实） |
|---|---|---|---|---|
| stress-user-01 | `kaspa:qrwnrehtfzygkwss4mg0hwx2v70gqge7wcvxrz3wg6ylvtcgzqy4g086n8wqv` | match | 302 `/relays`（未拒） | 0.49460500 KAS |
| stress-user-02 | `kaspa:qzy3c6nvfmx0273p9rgrd7vqp89h80hj32q7laqvl86hx384qs6kuj5w88thy` | match | 302 `/relays`（未拒） | 0.49752720 KAS |
| stress-user-03 | `kaspa:qrv64pa7hvmnx6pfzyscvlztzlwl064hju9nxhrgrwgtcltgx7yj7cqltlmwk` | match | 302 `/relays`（未拒） | 0.49938640 KAS |
| stress-user-04 | `kaspa:qqk5n73lgy0udrgtkchfqxfuu50u8zwqjlsz68dr9xghe5g2nz23zvaa4xh2v` | match | 302 `/relays`（未拒） | 0.49883720 KAS |
| stress-user-05 | `kaspa:qpyj7hrahj3l2xyn2uy4gwtkyr0z2mgxzan6nj6z63yds98ntydw5hy4apyhr` | match | 302 `/relays`（未拒） | 0.49870000 KAS |
| stress-user-06 | `kaspa:qrl5mz8ckd78rydz75l9h9xm6xa3f4p4sns45zlylrd9pqqvlf2zwwtzvh5v7` | match | 302 `/relays`（未拒） | 0.49994660 KAS |
| stress-user-07 | `kaspa:qz4xldyphshmq8wkwgkr5lelcd9w4gh9x2nxa8y0ltuvs5v8kx6ezsr3vvjnv` | match | 302 `/relays`（未拒） | 0.49614060 KAS |
| stress-user-08 | `kaspa:qquz2qte4cv876klt8elv34ad6e5zxqf8y5md5mkldjrdyr6xk0qzq4wzmv2w` | match | 302 `/relays`（未拒） | 0.49994660 KAS |
| stress-control-01 | `kaspa:qzlvn9gg0gyhurdn53wy5eeyet5nq3hz4nhfda5jamlmymrcf8wq7vpenvskw` | match | 302 `/relays`（未拒） | 0.49994660 KAS |
| stress-control-02 | `kaspa:qpuwsxct0fu3uthz4x2a54qu34zpkm2gxak3pn72aeprfu80zafruprvkg2va` | match | 302 `/relays`（未拒） | 0.49994660 KAS |
| **合计** | | | | **4.98498280 KAS** |

导入后新库逐行 `SELECT` 复核：10 行 `address`/`network='mainnet'` 与上表逐字一致（`id` 为新库自生成 UUID，未收录在本页——不是敏感信息，只是与本页结论无关，避免表格过宽）。每行导入后明文助记词在同一次脚本调用返回后立即从变量中丢弃，脚本全程只 `console.log` 过 `name`/`address`/`status`/`location`/比对结果，从未打印助记词或旧密钥（脚本源码见 `kasia-console/scratch/_kanetui_batch1_migrate.mjs`，`scratch/` 目录 gitignored，不会进 git）。

## §4/§5 观察（≥90s 窗口，独立核实）

- `relayHealthMonitorTick` 诊断行序列：`eligible=0→10`（10 行导入完成后下一次 tick 立即识别到）、首次识别到的那次 tick `deadCount=10`（10 行都还没启动，符合预期——导入动作本身不启动 relay）、随后 3 次 tick `deadCount=0`（10 行全部成功启动并保持存活）。
- `relayHotwalletMonitorTick` 诊断行序列：观察窗口内 3 次 tick，均为 `checked=10 killed=0`——`checked` 精确等于当前运行中的 relay 数，`killed=0` 全程未触发任何超限（10 行余额远低于 per-relay 800/total 1000 两个上限，属预期结果非侥幸）。
- 子进程核实：`Get-CimInstance Win32_Process -Filter "ParentProcessId=15396"` 查得 **10 个** `node.exe` 子进程，全部 `CreationDate=2026-09-14 03:42:53`（与 health-monitor 那次 `deadCount=10` 的 tick 时刻一致，即"10 行私钥同一时刻进入 10 个独立子进程内存"这一事实的进程级证据）。
- `events` 表：`event_type='hotwallet_relay_killed'` 计数，导入前 `0`，观察窗口结束后仍 `0`。
- stderr：观察窗口内无新增 `FATAL`/`error` 行。

## §6 回滚

本批未触发任何回滚条件（无 mismatch、无 denied、无 kill 事件），§6 四步流程本次未使用。

## 结论

10/10 全部按执行页 v0.2 流程一次通过，无需任何回滚/清理分支。这批账号导入后按执行页 §4 预期"导入即启动、私钥即驻留"——10 个 relay 子进程已在跑，持有合计约 4.98 KAS，两层准入门（拒绝场景探针 §2 + 实际导入观察 §4/§5）均确认按设计工作。
