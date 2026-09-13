# NWT 红队复核 · GO-E 身份与充值清单 v0.3（ephemeral manual relay 六条硬门）

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> 审对象：`da9d1345`（`docs/2026-09-13-kanetui-mainnet-relay-identity-funding-checklist-v0.1.md` §5/§2）。
> **不援引 47e34174**（那轮审的是 v0.1/2bce30e4，Codex 指出的边界措辞是 v0.3 新写的，这是对 v0.3 §5/§2 的独立判定）。
> 方法：不读 KANet-UI 的静态代码结论就信——自己去 `kasia-console/src/index.js`、`relay-manager.js`、
> `relay-health-monitor.js` 逐行核对两条已知复活路径；额外自己 `grep` 了全仓 `startRelay(`/`startAll(` 的每一个
> 调用点（不只是文档提到的两处），找出文档没提到的第三条路径并核实它是否也被 DELETE 挡住。

## 结论：**六条硬门方向 PASS，机制上确实封住"手动启动后无限驻留"——但发现文档静态审查漏掉的第三条复活路径（好消息：DELETE同样挡得住）+ ③④两条 Bettor 的顾虑都成立，必须补一条前置确认步骤 + 把实测执行升级为硬门，不能算"设计完成"**

## 一、① 六条是否封住 Codex 的"手动启动后无限驻留"——机制上是，独立核实两条已知路径属实

**路径 1（`index.js:558` 无条件 `startAllRelays()`）**——自己读了 `index.js:558-560`：
```js
import { startAll as startAllRelays, stopAll as stopAllRelays } from './services/relay-manager.js';
await startAllRelays();
```
跟同一文件里 `DEMO_MINDS_OFF`/`RH_OFF` 那种 `if (process.env.X !== '1')` 判断对照着看——**这一行确实没有任何 env 开关**，跟文档描述一致。`relay-manager.js:194-198` 的 `startAll()` 过滤条件：
```sql
WHERE r.address IS NOT NULL AND (r.mnemonic_encrypted IS NOT NULL OR r.privkey_encrypted IS NOT NULL)
```
**没有任何"跳过这一行"的字段**，跟文档描述逐字一致。属实。

**路径 2（`relay-health-monitor.js` 30s cron）**——自己读了 `relay-health-monitor.js:14`：`TICK_INTERVAL_MS = ... || 30_000`（确认真是 30 秒），`:44-48` 的 `eligible` 查询跟 `startAll()` 是**同一个** WHERE 条件（同样没有опт-out 字段），`index.js:699`：`if (process.env.RH_OFF !== '1') startRelayHealthMonitorCron();`——默认开、`RH_OFF=1` 才关，跟文档描述一致。属实。

**六条硬门本身的结构判断**：条 1（零引用）+ 条 2（两条自动路径已证实存在且被 §2 步骤 5 的 DELETE 处理）联合起来确实堵死了"进程死了会被自动拉回来"这条 Codex 指出的洞——条 3 只是条 2 的推论重述、条 6 是治理层规则（转常驻另起 GO），不需要单独验证机制正确性。**PASS，六条硬门在机制层面确实比 v0.2 严格，方向正确**。

## 二、② DELETE 是否充分收尾——找到文档没提到的第三条路径，但 DELETE 恰好也挡住了它；比较"更轻做法"后不推荐

**独立扫了一遍全仓 `startRelay(`/`startAll(` 的每一个调用点**（不只是文档提到的两处），发现一条文档静态审查**没有列出**的第三条：

- `src/services/system-repair.js:230-231`（`applyFix('restart_relay_<id>')` 分支）：`const { startRelay } = await import('./relay-manager.js'); await startRelay(relayId);`——只经由 `src/api/settings.js:132-133` 这个 HTTP 端点触发（`POST /api/settings` 带 `fixId=restart_relay_<id>`），不是定时 tick。**独立核了这条不会被 Mind 自主触发**：`agent-mind/src/skills/system-status.mjs:13/38` 明确写"Activates on system/health/status queries (reactive only — never on proactive)"、"SECURITY: Never activate on proactive"，且这个技能文件本身没有调 `applyFix`——`applyFix` 唯一可达调用方就是那个 HTTP 端点，不是自主复活路径，但**仍是一条"有人/有前端点一下就能把它拉回来"的路径**，跟文档"没找到第三条"的静态结论不完全一致。

**好消息，独立验证过**：这条第三路径最终也调 `relay-manager.js:startRelay(relayNodeId)`，我读了它的开头（`:44`）：`if (!account) return { ok: false, reason: 'account_not_found' };`——**DELETE 之后这一行查不到，三条路径（含文档两条 + 我找到的这条）全部在这同一处失败退出，不会真的拉起进程**。所以**DELETE 依然是充分的收尾动作，我找到的第三条路径不推翻这个结论，反而是"必须做真实执行验证(见④)"这条建议的直接证据**——静态审查漏了一条真实存在的路径，说明"读代码觉得没有第三条"这个论断本身不能替代实测。

**"更轻做法"比较（Bettor 要求的比较）**：文档没写的替代方案是"只置空 `address`（或加一个 `disabled` 标记），保留 `mnemonic_encrypted` 不删"——我核对过这个做法**在关闭三条复活路径这件事上跟 DELETE 完全等效**（三条路径的判据都卡在 `address IS NOT NULL`/`account_not_found`，置空 address 单独就能挡住全部三条，不需要连 `mnemonic_encrypted` 一起清）。**但这不是一个更安全的选择，是一个引入新残留风险的选择**：置空 address、保留 `mnemonic_encrypted` 意味着这份密文**继续躺在 console DB 里**——只要 `CONSOLE_ENCRYPTION_KEY` 未来任何时候泄露（跟这次身份是否"一次性"无关，是这台机器长期存在的风险面），这份密文就会被反向解密出真实私钥。**DELETE 把这份密文本身也清除，是唯一真正做到"零残留"的选项**，不是図省事——**我不推荐"更轻做法"，DELETE 是对的选择，但代价（见③）需要正视，不能绕过**。

## 三、③ Bettor 补的一条——"Owner 备份核验通过 ⇒ 才允许 DELETE"这条顺序**没有写死，这是真实缺口，MUST-FIX**

重读了 §2 全文：步骤 3（"Owner 亲自记录到自己的密码管理器"）跟步骤 5（"验证动作做完...立即 DELETE"）之间**没有任何显式的确认关卡**——步骤 5 的"立即"读起来是"验资完成就执行"，隐含假设步骤 3 的备份已经"自然发生"，但文档从头到尾没有一句要求"DELETE 前必须先得到 Owner 一句确认（备份已存、已能读出、格式正确）"。**这个缺口是真实的，后果是单向不可逆**：DELETE 之后，`mnemonic_encrypted` 这份密文从 console DB 彻底消失，如果 Owner 那一刻记的助记词有笔误/记漏了几个词/密码管理器本身出问题，**没有任何第二个副本可以核对或找回**——一次性验证身份直接变成永久性丢失身份（虽然这个身份本身只是"验证用途、余额 1-2 KAS"，损失有限，但"直接不可逆销毁密钥"这个动作本身的安全纪律不该因为金额小就放松）。

**裁决：MUST-FIX，不能算 v0.3 已经写完**。要求 §2 步骤 5 之前插入一条硬性确认关卡：**Owner 必须明确确认"已核验备份可读、内容无误"（哪怕只是频道里一句话记录），才允许执行 DELETE；确认没做到，DELETE 就不执行，宁可让这一行继续留着（承担 2-1 描述的敞口继续存在这个已知代价），也不能在没确认的情况下默认执行不可逆销毁**。这跟"绝不给 Owner 发菜单"的纪律不冲突——这不是让 Owner 做技术选择，是让 Owner 对"我确实拿到手了"这一件事实做确认，跟 GO-B 那把 `CONSOLE_ENCRYPTION_KEY` 的处理纪律是同一件事的镜像。

## 四、④ 真实执行日的启停删全流程实测——**应升为硬门，不是可选项，我这次找到的第三条路径就是直接证据**

文档 §5 条 2 自己已经写了"本机目前没有找到第三条会启动 relay 的路径…但只核过静态代码,没有拿真实数据行去跑一次实测"——**这次我独立扫描就真的找到了一条它没列出的路径（`system-repair.js` 的 `restart_relay_*` 修复动作）**，虽然最终证明 DELETE 依然挡得住，但这恰好证明了"纯靠读代码列举路径"这个方法本身有盲区——静态审查发现不了的东西，只有真实跑一遍才能兜底确认。

**裁决：④ 升为硬门**。真正执行 GO-E 那天，六条硬门跑完不能只看"文档说应该没问题"，必须：
1. 真建一行（用真实 `generate-mnemonic` 流程），记录 PID/启动时间戳；
2. 手动停止进程，等待完整一个 30s cron 周期（建议等 90s，覆盖 `STARTUP_GRACE_MS`），确认进程没有被自动拉回（`tasklist`/`Get-Process` 查无这个 PID 是真实命令输出，不是断言）；
3. Owner 备份确认关卡通过后，执行 DELETE；
4. DELETE 后再次确认 `SELECT * FROM relay_nodes WHERE id=?` 查无这一行；
5. **额外测一次我这次发现的第三条路径**：在 DELETE 之前，故意用 `POST /api/settings` 带 `fixId=restart_relay_<id>` 手动触发一次这条路径，确认此时进程会被拉起（证明这条路径确实存在、确实能拉活的行）；DELETE 之后再触发一次同样的调用，确认返回 `account_not_found`（证明 DELETE 真的挡住了这条我发现的路径，不是我读代码猜的）。

这一步走完，六条硬门才从"设计上应该够"变成"真实验证过够"。

## 五、给 Bettor 的处置建议

- **六条硬门方向 PASS**：机制上确实比 v0.2 严格，两条已知自动复活路径独立核实属实，DELETE 确实是充分的收尾动作（不是"停进程就够"）。
- **新发现（非阻塞，但要记档）**：`system-repair.js` 的 `restart_relay_*` 修复动作是文档静态审查没列出的第三条复活路径，经 Mind 侧核实不会被自主/proactive 触发（`system-status.mjs` 显式声明 reactive-only），只经 `POST /api/settings` 端点触发；DELETE 同样能挡住它（同一个 `account_not_found` 出口）。
- **③ MUST-FIX**：DELETE 前必须插入"Owner 确认已核验备份可读"这一道硬性确认关卡，现在的措辞（步骤3和步骤5之间没有关卡）会导致一次性身份变成不可复验/不可找回，这条不能留白。
- **④ 升为硬门**：真实执行日必须走一遍完整建-停-（等待自动复活窗口）-删-复核流程，且要额外把我这次发现的第三条路径也实测一遍（触发→确认能拉起→DELETE后再触发→确认account_not_found）——静态审查已经证明有盲区，实测不能是可选项。
- **不建议"置空字段不删"的更轻做法**：功能上等效，但会留下可被未来 `CONSOLE_ENCRYPTION_KEY` 泄露反向解密的密文残留，跟"ephemeral、零残留"的设计初衷相悖——除非 Owner 明确选择"保留可恢复副本"这个不同的权衡（那属于③的确认关卡通过之后的另一个独立选择，不应该default成"轻量替代"）。
