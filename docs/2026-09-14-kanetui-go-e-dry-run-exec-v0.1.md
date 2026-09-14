> **Status: DRAFT · 只写不执行**

# GO-E 干跑执行页 v0.1（2026-09-14 · KANet-UI · Bettor 1285/1286 派工）

> 权威：GO-E 身份与充值清单 v0.6（`docs/2026-09-13-kanetui-mainnet-relay-identity-funding-checklist-v0.1.md`）§5 第 4 条九步表格是本页的直接来源，本页只是把它**按 Owner 1168 ④/Bettor 1168-补的决定**（复用已迁移账号，不走 §2 新建流程）逐条展开成可执行页，机制不改。**本页任何一步都不执行**——执行门 = 本页 → Bettor 推 → NWT 审 → Owner 拍板执行时机。

## 0. 起点变了什么，没变什么

GO-E 清单 §1 状态注记（Owner 1168 ④）已经裁过：波 0/1 的验证身份**不再走 §2 `POST /relays/generate-mnemonic` 全新生成**，改用第 2 批迁移进来的**已有**账号——`Bettor`（1.59303211 KAS）或 `Trader-A`（7.45579730 KAS）二选一。这条只换了"这一行从哪来"，**§5 九步生命周期本身（验证→停→等复活窗→Owner 确认→DELETE）原样适用**，清单原文已经说清楚这条不改变机制。本页把这层换算落到具体身份/id/地址，并按 Bettor 1285 要求给每一步标读写属性。

**身份选择建议（Owner/Bettor 最终拍，本页只给参考）**：`Trader-A`（`bf73cb1b-8070-4e41-b549-712a1307499d`，`kaspa:qpsys3gzy4lg8txkuskhfnc4tskzn5r344eyudgyrc43te7vlq3f5a2cr843s`，7.45579730 KAS）余量比 `Bettor`（`64c7e13d-6097-435a-948e-d20b47cefc8b`，`kaspa:qz60muet908mmaea7yfnxlgz5azppmuyxuldl8lqk0snapzmmdahzuhfkdtk8`，1.59303211 KAS）更充裕——本流程含步骤②+步骤⑦两次相关的进程启动/协议消息尝试，`Trader-A` 的余量对"万一需要多试一次"更宽容。**两者均已按批2执行页（`docs/provenance/2026-09-14-kanetui-migration-batch2-small/`）核实到账、地址匹配、relay 已在跑（健康监控 eligible 里的一员）**，两个都可用，本页下文以变量 `<ID>`/`<ADDR>` 通用指代，执行当天先落实二选一。

## 1. 读写属性总览（Bettor 1285 要求：每步标明只读 / 需要 Owner 另批）

三档：
- 🟢 **只读**：不改任何状态，纯查询。
- 🟡 **机械执行（GO-E 已批范围内）**：会改变本机进程/数据库状态，但动作本身是 GO-E 清单已经明确设计好的既定流程一部分（启停已核实身份的 relay 进程、等待、健康监控自然行为），不涉及资金转移/密钥销毁/链上广播，不需要在"GO-E 本身已获批准"之外再单独问一次。
- 🔴 **需要 Owner 当场另批**（Bettor 点名的三类）：**临时 relay 的注资**（本页不适用，见下）、**`POST /relays/:id/delete`**、**任何广播**（`handshake`/`send_message` 这类会在链上留痕/花手续费的协议消息）。

| 步骤 | 动作 | 属性 | 备注 |
|---|---|---|---|
| ① 建 | 确认所选身份行存在（**不是新建，只读确认**） | 🟢 只读 | 见 §2 |
| ② 手动验证 — 启动进程部分 | 确认 relay 进程已在跑（本身就是常驻的，批2导入后就没停过） | 🟢 只读 | 见 §3 |
| ② 手动验证 — 发协议消息部分 | 人工触发一次 `handshake`/`send_message` | 🔴 **需要 Owner 当场另批（广播类）** | 见 §3 |
| ③ 停进程 | `Stop-Process` | 🟡 机械执行 | 见 §4 |
| ④ 等复活窗口 ≥90s | 纯等待 | 🟢 只读（无动作） | 见 §5 |
| ⑤ 确认无自动拉起 | 查进程表 + 查日志 | 🟢 只读 | 见 §6 |
| ⑥ Owner 备份确认关卡 | 等 Owner 回复 | 🔴 **需要 Owner 当场另批（性质见 §7 说明，非标准"新生成密钥"场景）** | 见 §7 |
| ⑦ 实测第三条复活路径 | `POST /api/system/repair` 触发 `restart_relay_<id>` | 🟡 机械执行（不是广播，是本机运维调用） | 见 §8 |
| ⑧ DELETE | `POST /relays/:id/delete` | 🔴 **需要 Owner 当场另批（点名类）** | 见 §9 |
| ⑨ 复核 | 查询 + 再触发一次 repair 确认已失效 | 🟢 只读 | 见 §10 |

**关于"临时 relay 的注资"**：GO-E 清单 §2/§3/§4 原本设计的是"全新生成身份 → 需要 Owner 转一笔启动资金"这条路径——本页因为复用已导入且已核实到账的 `Bettor`/`Trader-A`，**这一类动作在本次执行里不存在**（没有新建、没有新充值）。本页仍把这一档写进 §1 分类表供未来若真走 §2 新建流程时对照使用，但下文 §2-§10 具体步骤里不会出现它。

## 2. 步骤① 确认身份行存在（🟢 只读）

```sql
SELECT id, name, address, network, created_at FROM relay_nodes WHERE id='<ID>';
-- 不 SELECT mnemonic_encrypted/privkey_encrypted，本页全程不在证据里出现密文字段
```
**预期**：一行，`network='mainnet'`，`address` 与本页 §0 记录的地址逐字一致。
**证据**：该次查询的完整输出（id/name/address/network/created_at）。
**回退**：本步骤是查询，无状态改变，无需回退。

## 3. 步骤② 手动验证（🟢 只读部分 + 🔴 广播部分）

**只读子步骤**：确认该身份对应的 relay 子进程当前存活（批2导入后一直在跑，不需要重新启动）：
```
Get-CimInstance Win32_Process -Filter "ParentProcessId=<当前主网 console PID> AND Name='node.exe'"
```
比对该 relay 的启动时间戳与批2证据页（`docs/provenance/2026-09-14-kanetui-migration-batch2-small/README.md` §5）记录的创建簇一致，或最近一次 console 重启（偏移线重启，`docs/provenance/2026-09-14-kanetui-offset-derive-restart/`）之后的新簇——两种情况都算"在跑"，只是要如实记是哪一种。

**🔴 广播子步骤（需要 Owner 当场另批）**：人工触发一次 `handshake` 或 `send_message`（二选一即可，不需要两个都做——GO-E 清单原文"四类协议消息"里选最小的一类验证即可，`handshake` 通常最轻量）。**这一步会在主网链上留下一笔真实交易/费用**，属于 Bettor 点名的"任何广播"类，**执行当天必须先拿到 Owner 明确的"可以发"的回复，不能用"GO-E 整体已批准"来替代这一步的单独确认**。

**证据**：
- 启动 PID（若②只读子步骤发现进程需要重新拉起，记录新 PID+时间戳；若本来就在跑，记录"复用既有 PID"）。
- 触发广播的具体调用（端点+body，不含密钥）。
- 该条协议消息的响应内容 + 若产生链上 tx，记 txid。
- console 日志里对应的行（时间戳能对上触发时刻）。

**回退**：广播一旦发出不可撤回（协议消息 + 可能的链上 tx），没有"回退"这个选项——这正是为什么这一步必须单独经 Owner 批准，不能靠"整体流程已经批了"顺带带过。若消息内容有误，处理方式是走正常的协议纠错流程（比如再发一条更正），不是本页范围。

## 4. 步骤③ 停进程（🟡 机械执行）

```
Stop-Process -Id <②记录的PID> -Force
```
**证据**：停止时间戳 + 命令的真实输出（确认进程已不存在）。
**回退**：这一步的"回退"就是下一次 health-monitor tick 或后续步骤⑦人工触发会自然把它拉回来——本页流程设计本身就依赖这个"停了还能再拉起来"的特性来验证 §5 五条硬门第 2 条描述的两条自动复活路径，不是意外，是流程的一部分。

## 5. 步骤④ 等复活窗口 ≥90s（🟢 只读，无动作）

纯等待，不做任何操作。90 秒对应 `relay-health-monitor.js:15` `STARTUP_GRACE_MS=90_000` 的实际值。
**证据**：等待开始/结束的时间戳（`date -u` 两次）。
**回退**：不适用（无动作）。

## 6. 步骤⑤ 确认无自动拉起（🟢 只读）

```
Get-CimInstance Win32_Process -Filter "ParentProcessId=<console PID> AND Name='node.exe'" | Where-Object { ... 对应该 relay 的判据 ... }
```
预期：③停止的那个 PID 应查无，且**没有**为同一个 relay id 新起的替代 PID。同时 grep 该窗口内的 stdout：
```
grep "relayHealthMonitorTick" logs/mainnet/console-mainnet-stdout.log | tail -N   # N 覆盖③到⑤这段时间的 tick 数
```
预期：`eligible` 计数应比停止前少 1（该身份不再被算作存活+已启动的一员，除非 health-monitor 把它算进 `deadCount` 短暂出现后又消失——两种情况都要如实记录看到的是哪个）。
**证据**：进程查询的真实输出（查无）+ 相关 tick 日志片段。
**回退**：不适用（查询动作）。

## 7. 步骤⑥ Owner 备份确认关卡（🔴 需要 Owner 当场另批，性质说明）

GO-E 清单 v0.4 原设计这道关卡针对的是**全新生成、只在 `generate-mnemonic` 响应里出现过一次的明文助记词**——DELETE 之前必须确认 Owner 已经把那份唯一的明文备份核验过。

**本次不是这个场景**：`Bettor`/`Trader-A` 是从旧网真实迁移过来的既有身份（迁移 runbook 已走过独立的解密→派生比对→导入全流程，见批2证据页），这两个身份的密钥材料**并非本次会话生成、也不是"只有一份"**——迁移源头（旧网 `console.db`）与 Owner/账号所有者自己原有的密钥托管方式仍然独立存在，DELETE 这一行只是从**当前这个新主网 console 的本地加密存储**里移除，不等于这个身份的密钥material 从世界上消失。

**但本页仍然保留一道对等的确认关卡，不因为风险性质不同就跳过**——理由：即便不是"唯一副本消失"的极端情形，DELETE 仍然是不可逆操作（这一行在**这个** console 实例上的存在，此后如果想在这台 console 上重新操作这个身份，需要重新走一次导入流程），且这正是 Bettor 点名的三类需要单独批准的动作之一。**执行当天需要 Owner 明确回复"确认可以 DELETE 这一行"**（措辞不必是"备份已核验"这种针对全新生成场景的原话，但需要明确的、当场的"可以删"确认，不能用"GO-E 整体已批"替代）。

**证据**：Owner 确认的原话 + 时间戳。**没有这条，流程在这里停住，不进入步骤⑦/⑧**（跟 v0.6 原设计一致——这道关卡卡的是 DELETE 前，不是⑦之前；⑦本身是"实测第三条路径"，DELETE 前后各测一次，见 §8/§9，所以关卡放在⑥、⑦⑧⑨仍按顺序走，⑦不需要单独再批一次，只有⑧真正 DELETE 时需要，但 Owner 在⑥这里给的确认应该是"连⑦之后的⑧都可以做"这个范围的确认，避免⑦做完了才发现⑥的确认不够用又要重新问一次）。

## 8. 步骤⑦ 实测第三条复活路径（🟡 机械执行，DELETE 前）

```
POST /api/system/repair
body: {"fixId": "restart_relay_<ID>"}
```
**预期**：`ok:true` + 新 PID（证明这条路径确实能把 relay 拉起来）。**这不是广播**——只是本机 API 调用触发一次进程重启，跟②的"发协议消息"性质不同，不需要单独再问 Owner（⑥的确认已经覆盖到这一步及后续 DELETE）。
**证据**：该次调用的完整响应。
**回退**：跟步骤③一样，随即再停一次该进程（重复③④⑤），为进入步骤⑧做准备——不需要等它自己再被拉起，直接手动停。

## 9. 步骤⑧ DELETE（🔴 需要 Owner 当场另批，已在⑥拿到）

前置：确认⑦之后的进程已经再次停止（重复③④⑤，不重复展开）。

```sql
-- 删除前证据
SELECT id,name,address,network,created_at FROM relay_nodes WHERE id='<ID>';
```
```
POST /relays/<ID>/delete
```
（`relay.js:161` → `relay-nodes.js:70` `deleteRelayNode(id)`，v0.6 已核实该 handler 零 `console.log`、不碰任何其它 relay 行，响应是 `reply.redirect('/relays')` 无 JSON body——凭调用后的空 `SELECT` 判定成功，不凭响应体。）

**证据**：删除前 `SELECT` 的真实输出（有行）+ 调用命令的真实输出（含 HTTP 状态码）。
**回退**：**DELETE 本身不可回退**（这正是它属于"需要 Owner 另批"档的原因）。如果误删，唯一的恢复路径是重新走一次迁移导入流程（用旧网源库重新解密派生比对导入，同批1/批2方法），不是数据库层面的"撤销删除"。

## 10. 步骤⑨ 复核（🟢 只读）

```sql
SELECT * FROM relay_nodes WHERE id='<ID>';   -- 预期查无
```
```
POST /api/system/repair
body: {"fixId": "restart_relay_<ID>"}
-- 预期: account_not_found（证明 DELETE 后第三条复活路径确实也失效了，不是只读代码猜的）
```
**证据**：两次查询/调用的真实输出。
**回退**：不适用（查询/验证动作，若 `account_not_found` 没有出现说明步骤⑧没有真正生效，需要停下核查而不是当作通过继续，但这本身也是查询，不改变任何状态）。

## 11. 整体回退（若中途任一步骤异常）

- ①-⑥/⑦/⑨（只读或机械执行档）：无需特殊回退，异常时停下核查原因，不强行继续到下一步。
- ②广播子步骤：不可回退，见 §3 说明。
- ⑧DELETE：不可回退，见 §9 说明；执行前必须已经拿到 §7 的 Owner 确认。

## 12. 证据清单汇总

执行完成后落 `docs/provenance/<日期>-kanetui-go-e-dry-run/README.md`：①-⑨ 每步的证据项（见上文各节）、身份选择（Bettor 或 Trader-A，附 id/地址）、Owner 在⑥的确认原话+时间戳、广播的响应/txid、DELETE 前后两次 SELECT 的对照、原始 stdout/stderr 日志副本（同既有惯例，覆盖从②到⑨的窗口）。证据以 new commit 提交，本地不推，交 Bettor 推；NWT 部署后核。
