# 主网账号迁移 runbook v0.4（2026-09-14 · KANet-UI · Bettor 派工 · 只写不执行）

> **Status: DRAFT**。权威：Bettor 派工，背景 = Owner 要把原主网系统（2026-03/04 主网期，同一代码库）的账号迁进新主网 console。**本文档任何一步都不执行**；执行门 = 本 runbook → NWT 红队审 → Owner 逐步批 → 执行。
>
> **v0.2 变更（Bettor 1132 派工：源已定位，补五项）**：§1 源库坐标/行数/余额改为**本人独立读代码+只读查库+只读查链核实过**的事实（不是转述 Bettor 原话）。新增 §1.2 加密格式兼容性核实（①，已做完，非待办）；新增 §1.4 no-privkey 事实（旧库没有 `privkey_encrypted` 列，19 行全是助记词，`import-privkey` 端点那条坑对本次源数据不适用，但仍作为一般性知识保留在 §1.5）。§2 改写为逐行验证方法（②）。§3 增补"解密动作本身在哪个进程跑、怎么保证不落明文"（③）。§4 改写为导入+对账方法（④），对账数字改成本人独立链上核实过的真实余额，不是预估。§5 改写为分批表（⑤），明确 Bettor 点名排除的两个账号，并如实标出一个未被点名但余额同样不小的账号，不代为扩大排除范围。§6 回滚改为引用 GO-E 清单 v0.6 的现成路由（`POST /relays/:id/delete`），不再提已作废的 `relay-delete-row.mjs` 脚本规格。
>
> **v0.3 变更（Bettor 1134 裁：NWT 行留白已有裁定，替掉 v0.2 的空白）**：v0.2 §6/§8 里"NWT 540.15 KAS 要不要导"那条留白，Bettor 1134 给了裁定——**归为"有资金档，不列冷，等 NWT 2-1 硬上限规格落地后按上限判，Owner 最终拍"**，不是本页自己判定，是 Bettor 明确给的分类。§6 分批候选表第 3 项、正文说明段同步改写，§8 对应留白项撤下（裁定已有，不再是"待明确指示"）。
>
> **v0.4 变更（Bettor 1137 派工：NWT 复核 v0.3 五点 PASS + 一条 MUST-FIX + 两处收尾）**：NWT 独立复核（diff 加解密代码、独立查源库、独立查链余额，均自己复现非读文档转述）判 v0.3 五点全部 PASS，但指出 §4"全程不重启 console"只是操作承诺、约束不了"另一个不知道导入正在进行的会话去重启"这种真实发生过的场景（这台机是多智能体共享，本会话历史上 console 被意外重启过好几次）——**判 MUST-FIX**：NWT 2-1 规格（`docs/2026-09-14-nwt-mainnet-relay-hotwallet-cap-and-cold-hot-separation-spec-v0.1.md`）的 `startRelay()` 三条准入检查（冷清单/per-relay 上限/总额上限）必须在**第一批（含 stress 账号）导入之前**就已部署生效，不是"以后转常驻前"才需要——这样即便 console 意外重启、`startAllRelays()` 把新导入的行都拉起来，每一行会不会真的被拉起、敞口多大，都被上限卡死在可接受范围，"不小心重启"从"可能任意敞口"降级成"敞口被机制盖顶"，这才是真正兜底，不是靠操作纪律。新增 **§0 执行前检查清单**（`console.db-shm` 持有者核查提为第一项 + 2-1 三条准入门部署生效列为第二项，均为阻断条件不是建议）；§4 改写"全程不重启"这条为"不足以单独作为兜底，需要 §0 第二项配合"；§5 新增"两层准入"小节，把"导入端点早失败 + `startRelay()` 准入门"写成执行步骤的一部分而不是一句引用；§6 分批表加显式引用 NWT 2-1 规格 §7（三档顺序：stress→≤21.5 小额→NWT，本页原有分批建议跟这个顺序实质一致，不需要重排，只补可追溯引用）；§8 移除"2-1 规格还没有独立落地方案文档"这条（规格文档已存在，改为"规格已有但 `startRelay()` 代码尚未实现/部署，是执行前阻断条件不是待办"）。

## 0. 执行前检查清单（v0.4 新增，NWT MUST-FIX + 收尾要求）

**以下两项是阻断条件，不是建议——任何一项未满足，包括第一批 stress 账号在内的任何导入都不能开始：**

1. **`console.db-shm`/`-wal` 持有者核查**——§1.1 记录的 `console.db-shm` mtime 是今天，本人核过：这是本人/Bettor/NWT 三方分别用只读连接打开源库核实数据时产生的（多次 `better-sqlite3 readonly:true` 连接各自留下的 WAL 伴生文件更新痕迹），**不是有进程在持续写这份库**。但这是本次核实时点的解释，**不能当作执行日的既成结论**——执行当天必须重新确认：`C:\KANet` 目录下没有任何 node 进程在跑（`tasklist`/`Get-Process` 按路径核），没有任何进程在监听 `:3100`/`:3200`（旧系统 console 惯用端口，核实那套系统真的处于关闭状态，不是"应该关了"）。
2. **NWT 2-1 三条准入门部署生效**——`RELAY_HOTWALLET_COLD_ADDRESSES` / `RELAY_HOTWALLET_PER_RELAY_MAX_KAS` / `RELAY_HOTWALLET_TOTAL_MAX_KAS` 三个 env + `relay-manager.js:startRelay()` 的对应检查代码（规格见 `docs/2026-09-14-nwt-mainnet-relay-hotwallet-cap-and-cold-hot-separation-spec-v0.1.md` §5），**必须在第一行导入（含 stress 账号）之前就已经部署到本次迁移使用的这个 mainnet console 实例并生效**。理由（NWT 判定，本页采纳）：§4 "导入期间全程不重启 console" 只是操作承诺，约束不了"另一个不知道导入正在进行的会话"去重启这台机器（本会话历史上 console 被意外重启过多次，不是假设性担忧）——一旦三条检查真的钉在 `startRelay()` 里，即便 console 意外重启把新导入的行都拉起来，每一行能不能被真的拉起、拉起后风险敞口多大，都被 per-relay/总额上限卡在可接受范围内，这才是机制兜底，不是操作纪律兜底。见 §4/§5 完整展开。

见 §8 未完成事项：第 2 项目前的状态是"规格已有，代码尚未实现/部署"，本页不能替 J2/Bettor 的实现进度打勾，执行前需要独立确认代码已经落地并跑过 §5 的场景测试（NWT 2-1 规格 §7 第一批"专门构造一次会被拒绝的场景，确认真的拒绝"）。

## 1. 源定位（已确认，本人独立核实）

### 1.1 源库坐标
- **文件**：`C:\KANet\kasia-console\data\console.db`（独立检出 `C:\KANet`，`git log -1` 核实分支 `docs/oracle-v06-runtime` @ `b3711784`；文件 mtime `2026-06-08`，本人 `ls -la` 核实）。
- **同目录另有 3 份不作源**：`console.db.pre-v2-cutover.db`、`console.db.test-t5b.db`（及其 `.bak-t5b`/多份 `.pre-vXXX-backup` 快照）是历史子集/迁移前快照，Bettor 明确排除，本页不碰。
- 🔴 **该 DB 目前有 `-shm`/`-wal` 伴生文件、`console.db-shm` mtime 是今天**——本人核过：这是本人/Bettor/NWT 三方各自用 `better-sqlite3` `readonly:true` 只读连接核实数据时留下的痕迹，不是有进程在持续写这份库。**这不能当作执行日的既成结论**，见 §0 第 1 项——执行前需要重新核实一遍。

### 1.2 加密格式兼容性核实（① Bettor 1132 派工，已做完）
逐字对比 `b3711784` 与本仓当前 HEAD 两份代码：
- **`kasia-console/src/services/crypto.js`**：`diff` 结果——`encrypt()`/`decrypt()` 两个函数本体**完全一致**（`aes-256-gcm`，`iv`12字节随机、`tag`、`ciphertext` 三段各自 base64、外层 JSON 信封 `{v,alg,iv,tag,ciphertext}`）。当前 HEAD 唯一新增的是一个无关的 `currentKeyFingerprint()`（sha256 指纹，供 operator 核对用哪把 key，不影响加解密本身）。
- **`kasia-console/src/services/wallet.js`**：`addressFromMnemonic(phrase, network)` 的派生逻辑（BIP44 `m/44'/111111'/0'/0/0` → `XPrv` → 提取 32 字节私钥 → `PrivateKey.toKeypair().toAddress()`）**完全一致**，当前 HEAD 只是把同一段逻辑抽成内部 `derivePrivKeyHex()` 供别处复用，`mainnet` 分支的行为没有变化；`getNetworkType()` 唯一新增的是 `testnet-12` 落到 `Testnet` 分支，跟 `mainnet` 无关。
- **结论：格式兼容，不需要在 `C:\KANet` 那份代码自己的进程里做解密**——用本仓当前 HEAD 的 `decrypt()`/`addressFromMnemonic()` 就能正确处理旧库的密文，只要调用时把 `CONSOLE_ENCRYPTION_KEY` 环境变量临时设成 `C:\KANet\kanet.env` 里那把旧密钥（Bettor 1132：64 字符，mtime `05-14`，与现网新旧两把 key 都不同）。**这把旧密钥的值本身不写进任何文档/commit/日志**，执行时只作为一次性进程环境变量传入，用完即弃。

### 1.3 行数与账号清单（本人只读查库核实，非转述）
```
SELECT id,name,address IS NOT NULL,mnemonic_encrypted IS NOT NULL,network
FROM relay_nodes WHERE network='mainnet'
```
共 **20 行**，**19 行**同时有 `address` 和 `mnemonic_encrypted`，**1 行**（`Opus`，id `0f0f0f0f-...-ff`）两者皆空——**这一行本身不含任何可迁移的密钥材料，不是"待处理的一个"，是"天然没有内容"**。19 行名单：`J2` / `NWT` / `KANet-UI` / `Trader-B` / `Trader-A` / `Qclaude` / `Trader-M` / `Bettor` / `MarketMaker-A` / `stress-user-01`~`08` / `stress-control-01`~`02`。

### 1.4 旧库 schema 事实：没有 `privkey_encrypted` 列
`PRAGMA table_info(relay_nodes)` 核实：这份旧库的 `relay_nodes` 表**根本没有 `privkey_encrypted` 这一列**（那是本仓后来 r281 才加的字段，给"直接导入原始私钥"这个后加功能用）。**⇒ 19 行全部是助记词身份，没有一行是纯私钥身份**——本次迁移**只会用到 `POST /relays`（mnemonic 路径），不会用到 `POST /api/relay/import-privkey`**。

### 1.5 `import-privkey` 端点的坑仍作为一般性知识保留
虽然本次源数据用不到这条端点，但如果以后出现"Owner 钱包直接给一段私钥 hex"这种来源（§1.3 原路径 (b) 的私钥变体），这条坑依然真实存在，写在这里留档：**`POST /api/relay/import-privkey`**（`relay.js:137`）读 `const net = network || 'testnet-12';`（`:143`）——**默认网络值是旧测试网名，不是 mainnet**。忘了显式传 `network:'mainnet'` 会把一个真实主网私钥按 `NetworkType.Testnet` 派生出一个 `kaspatest:` 前缀的错误地址，且 `relay_nodes.network` 落成 `'testnet-12'`，后续任何按这行查余额都会查错地址。**任何时候调用这条端点，必须显式传 `network:'mainnet'`**。

## 2. 逐行验证方法（② Bettor 1132 派工）
每一行迁移前，**先验证再导入，不是导入后再核**：
1. 用 §1.2 确认的旧密钥（一次性环境变量），对该行 `mnemonic_encrypted` 调本仓当前 HEAD 的 `decrypt()`，得到明文助记词。
2. 立即调 `addressFromMnemonic(phrase, 'mainnet')`，得到派生地址。
3. 与该行 `relay_nodes.address` 列（旧库里存的地址）逐字比对：
   - **一致** → 这一行的助记词与其存储地址在旧网环境下确实互相对应，可以进入 §5 导入。
   - **不一致** → **单列出来，不导入**——可能是当年数据写入方式不同（如私钥直接生成而非助记词派生，或该行地址是后来手动改过的），不能假设"反正是同一个人就无所谓"，必须先弄清楚这一行的真实情况再决定怎么处理，本页不代为下结论。
4. 比对完成、明文助记词用完后**立即从内存中的变量丢弃**（不写入任何文件/env 持久化，不 return 出这次比对函数的作用域）。

## 3. 全链路"不记明文"核查（③）

### 3.1 解密这一步本身（新增，非既有代码路径）
本仓目前**没有**一个"从旧库批量迁移"的现成端点/脚本——§1.2/§2 描述的解密+比对动作，执行阶段需要一次性脚本来做，这个脚本本身也要满足不落明文：
- 旧密钥只通过环境变量注入该脚本自己的进程（不写命令行参数——**命令行参数会出现在进程列表里，是明确的泄漏面，必须用 env 不能用 argv**），脚本退出后这个环境变量随进程一起消失，不持久化。
- 脚本对每一行的输出只打印 `id`/`name`/`address`/比对结果（`match`/`mismatch`），**不打印解密出来的助记词**，哪怕是比对失败的情况也只打印"mismatch"这个判定结果，不打印任何一侧的明文内容供人工排查——如果确实需要人工排查 mismatch 行，走 Owner 单独、面对面/受控信道核对，不进本仓任何脚本输出/日志/文档。
- 脚本本身在执行前需要经 NWT 代码审查（跟 GO-E 清单里"一次性高权限脚本必须先审查"是同一条纪律），本页不在此处写脚本代码，另派另审。

### 3.2 既有代码路径（沿用既有核实，未变）
| 环节 | 是否可能落明文 | 核实依据 |
|---|---|---|
| Fastify 请求日志 | **否** | `index.js:151` `Fastify({ logger: false, ... })`——框架自带的请求/响应日志整体关闭，不会自动记录 request body（含明文助记词）|
| `POST /relays` 自身的 `console.log` | **否** | 该端点仅打印 `[relay] Auto-setup: mind skills + DB config for "<name>"`（`:118`），不含 mnemonic 字段 |
| `createRelayNode()` 落库逻辑 | **否，且是有意为之** | `relay-nodes.js:22-34`：助记词一进这个函数就先 `encrypt()`，从未以明文形式进入任何变量之外的地方；`mnemonicHint` 只记词数（`makeMnemonicHint()`），不截取任何字符 |
| 全局错误处理器 | **否** | `index.js:168-171` `setErrorHandler` 只记 `error.message`/URL/`method`/stack 前 3 行，**不碰 `request.body`**——哪怕导入请求本身抛错，body 也不会进错误日志 |
| provenance 文件 | **待执行时注意，非代码层面能保证** | 本仓 `docs/provenance/` 惯例是人工留证据——任何留档动作只记 `id`/`name`/`address`/时间戳/比对结果，不贴 mnemonic 字段 |

**结论**：代码层面（框架日志/端点自身日志/落库函数/错误处理器）四处核过 + §3.1 新增的一次性脚本设计约束，**全链路不记明文**这条在设计层面是完整的；唯一的风险点在**人的操作**（终端历史、剪贴板），这部分不是代码/脚本能挡的，执行时靠操作纪律。

## 4. 自动拉起抑制

已知三条会把有地址+密钥的 `relay_nodes` 行自动拉起进程、让私钥进内存的路径（同 GO-E 清单 §5 第 2 条查过的三条，逐字复用不重新查一遍）：
1. `index.js:558` `startAllRelays()`——console 每次重启无条件跑。
2. `relay-health-monitor.js` 30 秒 cron，默认开启。
3. `system-repair.js` 的 `restart_relay_{id}` 修复动作（`POST /api/system/repair` 人工触发）。

**导入期间的抑制方案**：
- **导入前**，先设 `RH_OFF=1`（`kanet.mainnet.env` 加一行，需要 console 重启生效——导入这 17 个账号（19 行减去 §6 排除的 2 个）的窗口期内，接受健康监控暂时关闭这个代价）。
- **导入动作本身**（走 §1.4 确认的 `POST /relays`，mnemonic 路径）**不会自动启动 relay**——`createRelayNode()` 只是 `INSERT`，`startRelay()` 是另一个独立调用，端点代码里没有在建完行之后紧接着调 `startRelay`。所以"导入"这个动作本身是安全的，风险在导入**之后**这些行会不会被上面三条路径捡起来。
- **导入完成、`RH_OFF` 还没解除的这段时间**：`startAllRelays()` 仍然是无条件的（不受 `RH_OFF` 影响，那个 env 只管 30 秒 cron）——**如果导入期间 console 意外重启一次，所有新导入的行仍然会被 `startAllRelays()` 拉起**。
- 🔴 **v0.4 更正（NWT MUST-FIX）："导入这批账号全程不重启 console"这条操作承诺，不能单独作为兜底。** v0.3 曾把这条当作完整的抑制方案，NWT 指出这只是操作承诺，约束不了"另一个不知道导入正在进行的会话"去重启这台机器——这是多智能体共享同一台机的环境，本会话历史上 console 被意外重启过多次，不是假设性担忧。**真正的兜底是 §0 第 2 项：NWT 2-1 三条准入门（冷清单/per-relay 上限/总额上限）必须在第一行导入之前就部署生效**——这样即便"不重启"这条承诺被打破，`startAllRelays()` 把新导入的行都拉起来时，每一行能不能真的被拉起、拉起后敞口多大，都被上限卡在可接受范围内。"不重启"仍然是一条应该遵守的操作纪律（降低触发面），但**不再是唯一防线**，见 §5"两层准入"。
- **每导入一行，立即核对**（不是等全部导完再一起核）：`address` 字段跟 §1.3 记录的旧库地址是否逐字一致、`network` 字段是不是 `mainnet`——核完再导下一行，不要批量导入完再统一核，一旦某一行导错网络，后面几行可能是同一个操作失误重复犯。

## 5. 导入与对账（④ Bettor 1132 派工）

**导入**：每一行通过 §2 验证之后，调 `POST /relays`（`relay.js:89`），body 传 `{ mnemonic: <§2 解密出的明文>, name: <该行原 name>, network: 'mainnet' }`（`network` 显式传，不依赖默认值——虽然 §1.4 已核实这个端点默认值本身就是 `mainnet`，显式传是双重保险，不是多余）。该端点用**这个新 mainnet console 实例自己的** `CONSOLE_ENCRYPTION_KEY` 重新加密落库，跟旧库那把不是同一把钥匙。

### 5.1 两层准入（v0.4 新增，NWT 收尾要求·执行步骤而非引用）

导入这批账号的过程中，私钥进程内存的准入不能只靠一层检查，本页明确写成两层，导入每一行时都要按顺序走：

1. **第一层：导入端点早失败**——`POST /relays`/`POST /api/relay/import-privkey` 若已按 NWT 2-1 规格加上早失败校验（冷地址/上限检查前置到导入这一步），命中即在 `INSERT` 之前拒绝，行都不进 `relay_nodes`。**这一层是更友好的早失败，不是安全边界本身**（NWT 规格 §4 原话）——就算这一层因为某种原因没生效或被绕过（例如未来任何新增的写入路径、理论上的手工 DB 操作），第二层仍然要独立生效，不能依赖第一层已经挡住了就跳过第二层核实。
2. **第二层：`startRelay()` 准入门（唯一真正的安全边界）**——不管这一行是怎么进 `relay_nodes` 的，`relay-manager.js:startRelay()` 内部固定跑三条检查（NWT 2-1 规格 §5）：① 命中 `RELAY_HOTWALLET_COLD_ADDRESSES` 直接拒绝；② 候选自身余额超过 `RELAY_HOTWALLET_PER_RELAY_MAX_KAS` 拒绝；③ 候选余额加当前所有正在跑的 relay 余额之和超过 `RELAY_HOTWALLET_TOTAL_MAX_KAS` 拒绝。**这是本会话 GO-E 系列反复确认过的唯一私钥入内存前置点**，三条自动拉起路径（`startAllRelays()`/健康监控 cron/`system-repair.js` 修复动作）最终都收敛到这一个函数，把检查钉在这里意味着无论哪条路径触发，都会被同一套上限拦住。
3. **执行顺序要求**：§0 第 2 项已经把"这两层代码部署生效"列为第一行导入之前的阻断条件。导入第一批（stress 账号）之前，**必须先专门构造一次会被第二层拒绝的场景**（NWT 2-1 规格 §7 第一批的原话要求），确认这两层检查真的按预期工作——不是只测试"正常情况能过"这一面，要看到 `cold_address_denied`/`per_relay_cap_exceeded`/`hotwallet_total_cap_exceeded` 三种拒绝理由中至少一种真实触发过，才能开始第一批正式导入。

**对账**：本人已用本机同步中的主网节点（`ws://127.0.0.1:17110`，只读 `getBalancesByAddresses`）对 19 行地址逐一查过链上余额，作为"迁移前清单"的权威基线，供导入后逐行核对用（地址+余额两项都要对上）：

| 账号 | 链上余额（本人核实，2026-09-14） |
|---|---|
| Trader-B | 20,301.71703562 KAS |
| MarketMaker-A | 1,004.99573821 KAS |
| NWT | 540.15205663 KAS |
| J2 | 21.48052866 KAS |
| Trader-A | 7.45579730 KAS |
| Trader-M | 3.28361586 KAS |
| KANet-UI | 4.32263407 KAS |
| Bettor | 1.59303211 KAS |
| Qclaude | 0.77165257 KAS |
| stress-user-01~08、stress-control-01~02（10 个） | 各 ≈0.49–0.50 KAS |
| **合计（19 行）** | **21,890.75707383 KAS** |

跟 Bettor 1132 原话报的"21,890.76 KAS / Trader-B 20,301.72 / MarketMaker-A 1,004.996 / NWT 540.15"两位小数取整后完全一致——本人独立核实的精确值与 Bettor 报的数字互相印证，不是单一来源。

导入后每行的核对方法：新库里这一行的派生地址应与 §1.3/上表一致，且新库侧再查一次 `getBalancesByAddresses` 应得到与上表相同的余额（链上状态不因"迁进哪个 console"而改变，这张表是不随时间变化的对照基线，只要执行日期跟本次核实日期之间没有这些地址自己发生过链上转账）。**如果余额对不上**：先怀疑地址派生错了（§2 步骤 3 那个"不一致就不导"的检查本该已经挡住这种情况，走到这一步对不上说明流程哪里被跳过了，先停下核流程完整性，不是先怀疑链上数据）。

## 6. 分批策略（⑤ Bettor 1132 派工）

**Bettor 1132 明确点名排除、冷处理、不导入**：
- **Trader-B**（20,301.71703562 KAS）
- **MarketMaker-A**（1,004.99573821 KAS）

🔴 **NWT 行（v0.3 已有裁定，Bettor 1134）**：**NWT** 这一行余额 540.15205663 KAS，量级介于上面两个"冷、不导"账号与其余小额账号之间——v0.2 本页曾把这条列为留白（Bettor 1132 未点名，不代为扩大排除范围），Bettor 1134 已给出裁定：**归为"有资金档，不列冷、不并入 stress 类验证批"，导入时机等 NWT 2-1 热钱包硬上限规格真正落地后按上限判断，最终是否导、导后是否常驻由 Owner 拍**。这一条不是本页自己判定，本页照实记录裁定内容，不代为提前决定"导"或"不导"的最终结果。

**其余账号（按 Bettor 原话"其余按 Owner 勾选"）**：
- `J2` / `Trader-A` / `Trader-M` / `KANet-UI` / `Bettor` / `Qclaude`（各 0.77–21.5 KAS）
- `stress-user-01`~`08`、`stress-control-01`~`02`（共 10 个，各 ≈0.49–0.50 KAS，是全部 19 行里余额最小、且从命名看最可能符合原任务点①"Rule 1 零引用小额账号，验证用"的一批）

**分批建议（本页给判断依据，最终名单由 Owner 勾选）**——🔴 **v0.4 补引用**：下面的顺序与 NWT 2-1 规格（`docs/2026-09-14-nwt-mainnet-relay-hotwallet-cap-and-cold-hot-separation-spec-v0.1.md` §7"具体批次建议"）给出的三档顺序（stress → ≤21.5 小额 → NWT，冷账号不进任何批次）实质一致，本页原有建议不需要重排，只是本次显式补上这条可追溯引用：
1. **第一批候选（验证用）**：10 个 `stress-*` 账号——余额最小、最像一次性测试身份，适合先走一遍 §2/§3/§5 整套流程验证走得通，出问题时损失面最小。同时是 §5.1 要求的"专门构造一次会被拒绝的场景"验证批次。
2. **第二批候选**：`J2`/`Trader-A`/`Trader-M`/`KANet-UI`/`Bettor`/`Qclaude` 六个——余额在个位数到二十位数 KAS 之间，风险比 stress 组高但比冷处理组低两个数量级。
3. **NWT**——有资金档，不列冷、不并入验证批（Bettor 1134 裁），等 2-1 硬上限落地后按上限判断，最终由 Owner 拍。NWT 2-1 规格 §7 补充：这是第一次真正让 per-relay 上限（建议值 800）在有意义的量级附近生效的账号（540 离 800 还有余量，但已是这批账号里最大的"放行"个案），**必须先看到第一批的拒绝场景测试通过后才做**。
4. **Trader-B / MarketMaker-A**——冷、不导，除非 Owner 明确改变这条决定。

任何一批转入"常驻自动化用途"之前，仍然要满足 NWT 2-1 热钱包硬上限规格（per-relay 资金上限 + 热钱包总额上限写死 env + 冷热分离），这条跟 GO-E 清单 §4 第 2 条是同一条硬门，本页不重复展开——但见 §0/§5.1，"部署生效"本身已经是**这次迁移第一行导入前**的阻断条件，不是"以后常驻前才需要"。

## 7. 回滚：导入错的行怎么删

按 GO-E 清单 v0.6（`docs/2026-09-13-kanetui-mainnet-relay-identity-funding-checklist-v0.1.md` §5 步骤⑧，NWT 自纠、Bettor 1131 裁定）——**用现成路由，不新造删除代码**：`kasia-console/src/api/relay.js:161` `POST /relays/:id/delete` → `relay-nodes.js:70` `deleteRelayNode(id)`。已核实该路由零 `console.log`、`deleteRelayNode()` 只做两条 `DELETE`（先清 `skills` 表 FK 依赖，再删 `relay_nodes` 本行），不打印任何字段（含密文都不打印）、不碰其它 relay。
1. 停该 relay 进程（确认对应 PID 不在）。
2. 只读 `SELECT id,name,address,network,created_at FROM relay_nodes WHERE id=?` 留删除前证据（不选加密字段）。
3. 调 `POST /relays/:id/delete`。
4. 再次 `SELECT` 复核应查无。
删错行之后，如果源数据还在（`C:\KANet` 那份 DB / Owner 手上的备份没被这次操作破坏），可以重新走 §2/§5 正确的导入流程。

## 8. 未完成事项（本页故意留白）
- §6 第一批/第二批的最终名单——本页只给判断依据，最终勾选是 Owner 的选择题。
- 🔴 **v0.4 更正**：NWT 2-1 硬上限规格**已有**独立落地方案文档（`docs/2026-09-14-nwt-mainnet-relay-hotwallet-cap-and-cold-hot-separation-spec-v0.1.md`），不再是"还没有文档"——**当前状态是规格已定稿，`relay-manager.js:startRelay()` 的三条检查代码尚未实现/部署**，这是 §0 第 2 项列出的执行前阻断条件，不是可以并行推进的独立待办，本页不能替代码实现/部署进度打勾，执行前需要独立确认代码已落地并跑过 §5.1 第 3 点的拒绝场景测试。
- §3.1 提到的一次性迁移脚本（解密+比对+导入）——本页只写设计约束，脚本代码本身还没写，需要另派并经 NWT 代码审查后才能用，不在这次文档改动里一起交。
- `console.db-shm`/`-wal` 持有者核查——已在 v0.4 §0 第 1 项写清楚解释与执行前动作，不再是纯留白，但执行前仍需实际重新核实一次（不是本页能代为确认的）。
