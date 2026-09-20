> **Status**: CURRENT（2026-09-20，NWT；对象 = 增量 `1b284671`（在已 GREEN 的 `61d5f588` 之上，分支 `coord/kanetui-tgbot-p1-cr3`，8 文件 +240/−23）；只审增量；D-021：类别级）

# 电报只读壳修一轮（增量）—— NWT 复核 → **GREEN**

## 结论：**GREEN，0 MUST。** F2 清理、F1 方向、#1/#2/#4 全部成立；放行 Owner 亲测。下面 3 条 SHOULD 不阻塞。

## 我做了什么
把增量后的分支状态用 `git archive` 取到我自己的检出（独立 node_modules，生产检出零触碰），复跑测试并写独立探针 / 变异，用完还原。**没有动生产的 `tg-bot/_state.json`**（探针只用它的**副本**，只看条数与键，不打印任何身份；结束时核对真文件 sha256 不变）。

## 你点的逐项
**F2 清理——五点全部成立。**
- **①只在壳内、不动原 handler**：`registerReadonlyShell` 内 `PM.pruneForReadonlyShell(prefixForNetwork(CONFIG.network))`，而 `registerReadonlyShell` 只在 `bot.mjs` 的 `if (isReadonlyShell(CONFIG))` 里被调用；`bot.mjs` 本次增量**零改动**；原模块 `prediction-menu.mjs` 只多了 1 个 import、`STATE_FILE` 的 env 覆盖、1 个新导出函数（+16 行），`inBetFlow` 等原逻辑未动；全仓只有 `readonly-handlers.mjs` 调用它。
- **②合法主网绑定不被误删、只删非 kaspa**：判据是**整段前缀相等**（`addressPrefix(addr) === 'kaspa'`，不是 `startsWith`）。我用 12 条混合状态喂真 `prediction-menu`：`kaspa:` 绑定保留；`kaspatest:` / `kaspasim:` / `kaspadev:` / 大写 `KASPA:` / 无冒号 `kaspaXYZ` / 空地址 / 非对象值 / `null` 全丢（`kaspatest` 不会被 `kaspa` 前缀"蹭"过；大写 `KASPA:` 本就过不了 console 的校验和，丢弃无害）。变异"改成 `startsWith`"被杀。
- **③残留下注会话清空**：真文件副本上 `sessions 4 → 0`、`linkedAddrs 4(全 kaspatest) → 0`、落盘后原有的 `userLangs`(9)/`brokerFeeTs`/`pendingPayments` **逐键与原文件完全相等**；无残留 `.tmp`。
- **④pendingPayments 不动、只 LOUD 报数**：变异"清掉 pendingPayments"被杀；启动日志 `pendingPayments=N`，`N>0` 时 `WARN 🔴 … expected 0 before go-live`。
- **⑤`TG_BOT_STATE_FILE` 覆盖 seam**：`process.env.TG_BOT_STATE_FILE || join(__dirname,'_state.json')`——**未设或空串时回到默认真路径**（变异"始终用 env"被杀，测试钉了默认路径）；它只能由**拥有进程环境的人**设置，没有任何请求可控输入能改；主网 `kanet.mainnet.env` 里没有该变量；CR-1 启动器继承环境不写它。**不会在生产指错文件**，也无外部可利用面。
- 顺带核了执行时序：清理在注册时（`import bot.mjs` 时）执行一次，早于 `startBot` 里的 `pollLoop` 取 `listLinkedUsers()`，所以那 4 个旧地址不会再被拿去轮询。

**F1 判定题方向——对，缺失时确实不显。** `judged.side_map` 换算 `y === winningSide ? 'YES' : 'NO'`：`{yes:1,no:0}` 且 `winning_side=1` ⇒ **YES**（此前显 NO）、`ws=0` ⇒ NO；`{yes:0,no:1}` 对称正确；非判定题（无 `judged` 键或 `judged:null`）仍 0=YES/1=NO；`side_map` 缺失 / `null` / `{yes:1,no:1}` / 字符串 `"1"` / `{yes:2,no:0}` / 数组 ⇒ **不显 YES/NO**，改走 `ro_line_settled_noresult` / `ro_state_settled_noresult`（列表"已结算"、详情"状态：已结算"，不带 `?`）。变异"yes/no 交换""无效 side_map 回落 0=YES""忽略 judged""非双射也接受"全被杀。
**#1 时间**：`Math.ceil`、<1 小时按分钟——29 分显示"29 min left"（此前"已过截止"）、`0.4 min` 显示"1 min left"、≤0 才"Deadline passed"、89 分显示"2h left"。**#2 文本**：`U+202A–202E / 2066–2069 / 200B–200F / 2060 / FEFF` 全去；详情题干 1000 字输入 ⇒ 300。**#4 自由文本**：用**真 grammY**（生产 node_modules 里的 1.43.0，API 层拦截不联网）逐条验证中间件顺序：非命令文本（含 `hello` / `123` / `确认`）⇒ 只回 `ro_unavailable`、**原 `message:text` 一次都没到**；`/broker /earnings /lang /support /verify` 与壳未知的 `/xyz`、`/broker@bot` ⇒ 交还原 handler；隐藏命令与旧按钮（`bet:side:1`）⇒ `ro_unavailable`；`"/ hello"` 交还后由原 `message:text` 因 `startsWith('/')` 静默返回（不落工单）。**新增 3 键** en/zh 齐全、占位符匹配、无回落（`readonly-i18n` 6/6 复跑绿，且渲染里没有出现 `?` 或键名）。

## 验证数据
分支自带测试在我的检出复跑：shell 21 / handlers 17 / prune 5 / i18n 6 **全绿**；我写的 **20 个变异全杀**（prune ×10、种子 seam、F1 ×4、#1 ×2、#2 ×2、#4 ×2），树已还原。

## SHOULD（不阻塞）
1. **`cleanText` 仍漏几类不可见字符**：`U+061C`（阿拉伯字母标记）、`U+00AD`（软连字符）、tag 字符 `U+E0000–E007F`、`U+3164`（韩文填充）实测原样通过。建议改用 Unicode 格式类 `/\p{Cf}/gu` 再加 `U+3164 / U+115F / U+1160`。
2. **清理只比前缀**：`kaspa:`（空载荷）这种垃圾条目会被保留。绑定在 console 侧已（CR-3 后）验过校验和，实际不会出现，但清理时顺手要求 `^kaspa:[a-z0-9]+$` 更稳。
3. **运维提示**：首次以主网模式启动会**不可逆地**改写真 `_state.json`（丢 4 条 TN12 绑定 + 4 个残留会话）；上线前请先**改名留存一份副本**（和之前建议的部署清单一致）。Owner 亲测用副本 + `TG_BOT_STATE_FILE` 的隔离实例不会碰真文件。

## 我没做
未启动真实 bot、未接真实 Telegram；F1 只验了渲染层（判定题真数据需批 B 的 `judged` 出现在主网后另验）。
