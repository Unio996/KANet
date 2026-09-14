# 主网账号迁移 · 第 2 批（个位数-二十位数小额，6行）执行证据（2026-09-14 · KANet-UI · Bettor 1277 派工 · Owner 原话「执行第 2 批」）

> 执行依据：执行页 v0.2（`docs/2026-09-14-kanetui-mainnet-migration-batch2-small-exec-v0.1.md`，commit `9f025f00`），NWT 审 `6f057e97` GREEN。**本页不含任何密文/明文密钥材料**——地址是公开链上信息，余额是只读查链结果，不含 `mnemonic`/`mnemonic_encrypted`/旧密钥/新密钥任何字段。

## 结论（先给数字，细节见下）

| 项目 | 结果 |
|---|---|
| 导入行数 | **6 / 6**，全部一次通过（无 mismatch、无 denied） |
| 启动数 | **6 / 6**（health-monitor 首次 tick 即全部拉起，`eligible 10→16 deadCount=0`） |
| 总驻留余额（本批） | **38.90943674 KAS**（6 行独立链上核实之和，见 §3） |
| 累计驻留余额（批1+批2） | **≈43.89 KAS**，远低于 total cap 1000 |
| 驻留期监控 tick 摘要 | 观察窗口内 4 次 tick，`checked=16 killed=0`，零杀 |
| `events.hotwallet_relay_killed` | 导入前后均 `0` |
| stderr FATAL/error | 观察窗口内 `0` |
| 执行期插曲 | `shared/vendor/kaspa-wasm` 一度被清空，已由 Bettor 恢复，见 §0 |

## §0 执行期插曲：`shared/vendor/kaspa-wasm` 一度被清空

§1 前置核实全部通过后（见 §1），跑迁移脚本第一步就撞到 `Cannot find package 'kaspa-wasm'`——排查发现 `shared/vendor/kaspa-wasm/` 目录当时完全空（7 个文件均显示为未提交的 git 删除，非本人所为，本人核实全程未对该路径做过任何操作，已就此单独向 Bettor 确认）。**立即停手**，未做任何导入（当时 §3 一行都还没跑，§2 探针本身不需要 `mnemonic`/不走这条依赖，不受影响）。Bettor 用 `git checkout -- shared/vendor/kaspa-wasm` 恢复（7 文件回位，`kaspa_bg.wasm` 哈希与 HEAD 一致），本人独立复核 `node -e "import('kaspa-wasm')"` 成功（392 个导出）、`git status` 干净后，重做 §2 探针 → §3 全部导入。清空时刻为 `04:42:55Z`，肇事者与本次迁移执行无关（Bettor 另查）。恢复后 §1 关键项（PID/批1健康/env）重新核实一遍未受影响。

## §1 执行前检查（全部通过，插曲发生前核实，插曲后关键项已重核）

- `C:\KANet` 下无 node 进程（`Get-CimInstance Win32_Process` 按命令行核，零命中），`:3100`/`:3200` 均未监听。
- 当前 mainnet console：PID `14884`（与 T-KEY-EXPORT 部署验收时一致，未漂移），`127.0.0.1:3202` 监听中，插曲恢复后重核仍是同一 PID。
- `kanet.mainnet.env` 三个准入门键核实未变：`RELAY_HOTWALLET_PER_RELAY_MAX_KAS=800`、`RELAY_HOTWALLET_TOTAL_MAX_KAS=1000`、`RELAY_HOTWALLET_COLD_ADDRESSES` 含两个地址；当前进程 stdout 命中 `[relay-hotwallet-monitor] started — tick=30000ms grace=90000ms max_consecutive_failures=3` 1 次。
- 第 1 批 10 行仍健康：目标库只读核得 10/10，`relayHealthMonitorTick` 最近几次 tick 均 `eligible=10 deadCount=0`，`events.hotwallet_relay_killed` 仍为 `0`（与批1验收基线一致，导入前未凭空增加）。
- 源库（`C:\KANet\kasia-console\data\console.db`）只读查得 6 行（`J2`/`Trader-A`/`KANet-UI`/`Trader-M`/`Bettor`/`Qclaude`），逐字匹配名单。
- 目标库（`console.mainnet.db`）执行前这 6 个名字 `COUNT=0`，确认非重复导入。

## §2 拒绝场景探针（MarketMaker-A 冷地址，一次通过，无需清理）

- 探针（插曲恢复后重做）：`POST /relays`，`name=zzz-admission-probe-1789370952896`、`address=<MarketMaker-A 冷清单地址>`、**无 `mnemonic`**。
- 响应：`302`，`Location: /relays?hotwallet_denied=cold_address_denied`——与 §2 期望逐字一致。
- 复核：`relay_nodes` 里 `name LIKE 'zzz-admission-probe-%'` 计数 `0`——行确实没有被插入。
- 结论：冷清单第二个地址（MarketMaker-A，批1验的是 Trader-B）在这个具体部署实例、带着这份 env 下同样确认真实生效——两个冷地址均已各自单独验证过。

## §3 逐行导入结果（6/6，见下表；地址均为公开链上信息）

| name | address | 派生比对 | 导入结果 | 链上余额（本人只读核实，`GET /api/relay/:id/balance`） |
|---|---|---|---|---|
| J2 | `kaspa:qr7km875u5hhl42eaz4sjgmlcdnzjan9fnplcct3q7gq4ujdtpqqqe78fjev3` | match | 302 `/relays`（未拒） | 21.481 KAS |
| Trader-A | `kaspa:qpsys3gzy4lg8txkuskhfnc4tskzn5r344eyudgyrc43te7vlq3f5a2cr843s` | match | 302 `/relays`（未拒） | 7.456 KAS |
| KANet-UI | `kaspa:qpf2f39dp869lfm3f32z0ujsrafamznjxxknlk792ftc9jhk2cs7y7err0tz9` | match | 302 `/relays`（未拒） | 4.323 KAS |
| Trader-M | `kaspa:qqndp3hcrce942c3max7mq3j9jc6m3y00mlpdpfpv0hzvlsygp9zx9z9xn7rh` | match | 302 `/relays`（未拒） | 3.284 KAS |
| Bettor | `kaspa:qz60muet908mmaea7yfnxlgz5azppmuyxuldl8lqk0snapzmmdahzuhfkdtk8` | match | 302 `/relays`（未拒） | 1.593 KAS |
| Qclaude | `kaspa:qruc370pkq0e9algw6uxg3hx6uvssnjnqq7uddwnepqr6yvgdhtxjv3hd6efu` | match | 302 `/relays`（未拒） | 0.772 KAS |
| **合计** | | | | **38.909 KAS**（与执行页 §0 基线 38.90726057 KAS 一致，差异为端点显示精度截断到 3 位小数） |

导入后新库逐行 `SELECT` 复核：6 行 `address`/`network='mainnet'` 与上表逐字一致，且与源库同名行地址完全一致（集合比较）。每行导入后明文助记词在同一次脚本调用返回后立即从变量中丢弃，脚本全程只 `console.log` 过 `name`/`step`/`status`/`location`/比对结果，从未打印助记词或旧密钥（脚本源码 `kasia-console/scratch/_kanetui_batch2_migrate.mjs`，复用第 1 批脚本方法，`scratch/` 目录 gitignored，不会进 git）。

## §4/§5 观察（≥90s 窗口，独立核实）

- `relayHealthMonitorTick` 诊断行序列：导入完成后立即观测到 `eligible=16 deadCount=0`（第一次采样就已是稳态，未捕捉到批1文档里那种"瞬时 deadCount 非零"的过渡窗口——本批 6 行启动速度快，采样时机晚于过渡窗，不影响结论）；随后连续 4 次 tick 均保持 `eligible=16 deadCount=0`。
- `relayHotwalletMonitorTick` 诊断行序列：观察窗口内连续 4 次 tick，均为 `checked=16 killed=0`——`checked` 精确等于当前运行中的 relay 数（10+6），`killed=0` 全程未触发任何超限（本批最大一行 J2 21.48 KAS，离 per-relay 800 上限还有近 40 倍余量）。
- 子进程核实：`Get-CimInstance Win32_Process -Filter "ParentProcessId=14884 AND Name='node.exe'"` 查得 **16 个** `node.exe` 子进程（10 旧 + 6 新）；按 `CreationDate` 分两簇——10 个旧的集中在 `11:25:21`~`11:25:22`（批1时刻），6 个新的集中在 `14:29:24`（本批导入时刻），同一批内创建时刻一致，验证"该批私钥同一时刻进入独立子进程内存"这一事实。另有 1 个 `conhost.exe`（`PID 5640`，`14:29` 时刻附近但实为 `11:25:21` 创建——核实为 Windows 控制台宿主进程，console 主进程本身管理子进程时的常规系统伴生进程，非 relay 相关，不计入 relay 子进程数）。
- `events` 表：`event_type='hotwallet_relay_killed'` 计数，导入前 `0`，观察窗口结束后仍 `0`。
- stderr：观察窗口内无新增 `FATAL`/`error` 行（既有的 `oracle-pool-scanner-cron`/`external-gateway`/`zk-prove-server`/`key-export refuse`/`relay-health ... already_running` 等均为既有稳态噪音，与本批操作无关，本页不重复展开）。

## §6 回滚

本批未触发任何回滚条件（无 mismatch、无 denied、无 kill 事件），§6 四步流程本次未使用。

## GO-E 说明

按执行页 §4：GO-E 九步验证流程本页不代为执行，`Bettor`（1.59303211 KAS）与 `Trader-A`（7.45579730 KAS）两行本批已确认导入且 relay 正常启动，满足了 GO-E 清单的前置条件——GO-E 九步本身留给另一次独立派工执行，不在本批执行窗口内顺带做。

## 结论

6/6 全部按执行页 v0.2 流程通过，中途遭遇一次与本任务无关的环境插曲（`shared/vendor/kaspa-wasm` 被清空，见 §0），停手报告 → 确认恢复 → 独立复核 → 从 §2 重新走完整流程，未在受损状态下做任何导入动作。批1+批2累计 16 个 relay 子进程已在跑，持有合计约 43.89 KAS，两层准入门（拒绝场景探针 §2 + 实际导入观察 §4/§5）均确认按设计工作。

原始日志留档：`console-mainnet-stdout-PID14884.log` / `console-mainnet-stderr-PID14884.log`（本目录内独立副本，已核实 zero 64-hex 序列、zero 疑似 12 词助记词序列）。
