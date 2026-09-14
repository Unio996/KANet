# Owner 指令 · 主网跑 KANet · 押注资产 = 自发免费无限铸造的 KCC-20 测试币 · 评估 v0.1

> **Status**: DRAFT v0.1.1（2026-09-13 · J1 @younio · docs only · 侧分支 `coord/j1-mainnet-testtoken`）· 给 NWT 审 → Bettor cherry-pick
> **v0.1.1 增补**：Owner 裁定 8–10（稳定币骨架预留 §3.5 / 主网节点上 da9 / **TN12 退役** §9）。§9 改的是 CLAUDE.md 0.5 与 D-005 两条铁律 ⇒ **Bettor 必须落 DECISIONS.md**。
> **定位**：`docs/2026-09-07-bettor-mainnet-pivot-assessment-v0.1.md`（含 v0.2 追加）的**补丁**——只补"押注资产"这一格，**不改其四个前置、不改四波顺序**。
> **铁律 0**：本稿不动任何代码、不动 live 树、不动 pinned silverc；§6 的落地步骤每一步各自过 报备→审→批→测。
> **不是法律意见**（§5）。

---

## 0. 一句话

**主网上跑 KANet，但押注用的不是 KAS，而是一个 KANet 自发的 KCC-20 代币：任何人、任何时候、零成本、无上限地铸造；只能存在于 covenant 里、不能进个人地址。** 前者让它在结构上不可能有价格，后者让它在结构上长不出二级市场。手续费用真 KAS 烧（Owner 裁定：不怕）。

## 1. Owner 裁定（2026-09-13 原话，本稿的输入）

| # | 原话 | 本稿读法 |
|---|---|---|
| 1 | 「我想合规跑主网，审下很多节点同步，节点不够诸多问题」 | 主网 = 解 TN12 拓扑病（9/7 评估 §2 已列）+ 合规前提 |
| 2 | 「肯定不能 kas 直接押注，是要出问题的」 | 押注资产 ≠ KAS，这是硬约束 |
| 3 | 「自己发一个币（KCC-20 L1 原生代币），完全不销售，就是测试用，在主网测试」 | 代币 = 应用层测试筹码，L1 原生（covenant 强制）而非索引器标准 |
| 4 | 「任何人可以无限 mint，这个机制好！」 | **采纳为核心机制**（§3.2） |
| 5 | 「烧手续费不怕」 | 费用**不是否决项**；再平衡 cron 重设计只为效率（9/7 评估 §A），不为省钱 |
| 6 | 「我对公网还贡献节点」 | 主网节点 = 公共品，同时是"我们跑基础设施"的可信度 |
| 7 | 「聚焦真正应用，系统配置会省下大量时间」 | 目标是把运维时间换成应用时间 |
| 8 | 「只要是合规的，而且技术上为今后稳定币做好一切铺垫」（同日稍后，Owner 认可"测试币与稳定币同一套合约骨架"） | **测试币合约从第一天起按稳定币骨架写**（§3.5）；第二方向本身仍不公开、不上链 |
| 9 | 「现在首要任务是把主网节点跑起来，然后把 kanet 在测试网成果全部迁移到主网」「我远端计算机跑节点啊，哪里需要再租呢」 | 主网节点 = **da9 本机**（不租 VPS）；迁移仍**按 9/7 四波**，不是一次性全迁（§2） |
| 10 | 「tn12 真没必要在跑了」「已经完成历史任务了。剩下来的，呵呵，我们主网慢慢来玩儿」 | **TN12 退役**（§9）；未结盘**不做**逐盘收摊（Owner 接受）；主网节奏 = 按波、不赶 |

⚠ Owner 原话写的是"krc20"——**本稿按 KCC-20 处理**：KRC-20 是 Kasplex 索引器标准（链下解释、L1 不强制），KANet 结算走 covenant/ZK，市场合约要能在链上**强制**持有与转移，只有 KCC-20（covenant 约束）做得到。

## 2. 与 9/7 主网评估的关系

- 9/7 评估结论"可转、应尽快"**不变**；四个前置（G-1 钱路闸 / 42 合约迁 silverscript v1 / NO-TX 两处违反 / 主网用官方 release）**不变**。
- 改的只有**资金面**一列：

| 波 | 9/7 评估资金面 | 本稿 |
|---|---|---|
| 0 只读节点 | 0 | 0（不变） |
| 1 通信/身份 | 手续费级 | 手续费级（不变） |
| 2 签名型结算小额 | 单笔 ≤10 KAS / 日 ≤100 KAS | **押注 = 测试币；KAS 只作手续费**；额度改为"手续费钱包日上限" |
| 3 ZK 结算 | 按盘上限 | 同上 |

- 6/6 handoff 那句「项目终点 = 测试网公开 demo，非 mainnet」（`docs/2026-06-06-handoff-briefing.md:41`）**已被 Owner 9/7 主网指令取代**；其**G5 口径**（`:40`「测试币零价值，禁"大钱/保护资金/退款金额"框架，不报经济闭环」）**原样沿用到主网测试币**。
- 9/7 评估 §3「TN12 保留为 staging（每波先 TN12 再主网）」与 §5「不在同一台机上跑第二个 kaspad」**被裁定 9/10 取代**：TN12 退役（§9），staging 场 = 主网上的测试币本身；主网节点跑 da9（llama 已于 9/5 停 ⇒ 内存前提消失；TN12 退役 ⇒ 磁盘前提消失，见 §9-5）。

## 3. 机制（可执行）

### 3.1 标准：KCC-0020（已合并）

- `kaspanet/kccs` PR#2 **2026-08-20 合并**（head `a124b28`；文档头 Status 仍写 Draft，Updated 2026-08-25）。仓里 7/16 那批 KCC 文档写"PR#2 Draft 未合并"——**已陈**，引用时按已合并。
- 状态布局（必须、按序）：`amount:int · owner:byte[32] · owner_scheme:byte · borrow_scheme:byte · borrow_guard:byte[32] · extension_commitment:byte[32]`。
- `owner_scheme` 默认表：`0x00 p2pk-schnorr/v1 · 0x01 p2pkh-schnorr/v1 · 0x02 p2pkh-ecdsa/v1 · 0x03 p2sh/v1 · 0x04 covenant-id/v1`。
- **规范对 minting 完全沉默**（无 minter 概念、无供应上限条款）⇒ 铸造规则是**应用自定义**，"任何人无限 mint"不与规范冲突。
- `extension_commitment` = 应用扩展状态的摘要，KANet 需要挂市场 id 之类时用它。
- ⚠ silverscript v1.0.0 自带的 `tests/examples/kcc20.sil` 是**旧布局**（`ownerIdentifier/identifierType/amount/isMinter`），与合并规范不同——**只作 `#[covenant(binding=…)]` 语法参考，布局以规范为准**。

### 3.2 免费无限铸造（核心）

```
entry mint(int amount, byte[32] to, byte to_scheme)：
  · 不校验签名、不校验调用者、不校验来源
  · amount 任意正整数、无供应计数、无上限
  · 唯一约束 = 产出状态合法（§3.3）
```
**论证**：一个任何人随时可零成本无限复制的东西，二级市场撑不住任何价格——这是**机制**，不是"我不卖"这种**承诺**。它把 §5 的合规论证从"运营者的意图"移到"链上可验证的性质"。

### 3.3 转移限制（两档，v0.1 取 (a)）

| 档 | 规则 | 效果 | 代价 |
|---|---|---|---|
| **(a) 只许 covenant 持有** | `transfer` 与 `mint` 的每个 `next_states[i].owner_scheme` **必须 == 0x04**（covenant-id/v1）；拒 0x00–0x03 | 币**永远不落到个人地址**，人手里拿不住，OTC 无从谈起 | 一行 `require`；规范本就要求 transfer 校验 owner_scheme 受支持，这里只是把支持集收成 {0x04} |
| (b) 只许 KANet 市场模板持有 | 在 (a) 之上，接收 covenant 的输出 `scriptPubKey` 必须匹配 KANet 市场模板前缀（introspection `tx.outputs[i].scriptPubKey`，TN12 全有，见记忆 `reference-silverscript-real-capabilities`） | 连"别人写个 covenant 把它包起来"都堵死 | 模板前缀随编译器变（v1 迁移期 P2SH 全换），每次迁移要同步；先不做 |

**v0.1 = 免费 mint + (a)**。(b) 列为升级项，等 42 合约迁完、模板稳定后再议。

### 3.5 稳定币骨架预留（裁定 8；细节另稿，Owner「先不急」）

测试币与稳定币是**同一套合约**，差别只在几条 `require`。测试币合约**从第一天起保留三个位置**：① `mint` 入口（测试币态：无校验；稳定币态：`require(checkSig(s, issuerPk))`）；② clawback 花费路径（发行方签名可不经持有者转走该 UTXO；测试币态 `require(false)`）；③ 暂停证明入口（`checkMsgSig` 发行方时效签名 + `tx.daa` 窗口；测试币态不检查）。KCC-0020 对这些全部沉默 ⇒ 都是应用层自定义，不违规范。将来切稳定币 = 换 `require` 条件，不换骨架、不换钱包/索引器对接。

### 3.4 对外口径（每次都要有，一次都不能少）

「**测试币 · 无价值 · 任何人免费无限铸造 · 只能用来押注**」。G5 沿用：不报盈亏、不报"资金"、不报"保护资金"。
`/api/faucet/request` 改为直接发链上 `mint`（外部口 404 那条 `docs/2026-07-26-external-program-kaspa-onboarding-recipe.md:77` 另案）。

## 4. 它不解决的（写明，防误读）

1. **四个前置一个都没免**：G-1 enforce / 42 合约迁 v1 / `exchange-machine.js:828` + `bettor-prediction-settler.js:198` 两处 NO-TX 违反 / 主网 v2.0.1 官方 release。测试币不改这些。
2. **真 KAS 照烧**：币没价值，费有——再平衡 0.046 KAS/笔、12–39 KAS/天（9/7 §A）。Owner 裁定不怕；但 relay 私钥 40 处常驻从此看守的是**真余额**，密钥分离按 NWT 真钱清单 MUST。
3. **测不到对抗行为**：没人攻击一个没价值的市场。预言机博弈、委员共谋、结算抢跑——预测市场最要命的部分——这一期**零覆盖**。对内对外都要说清：**验证的是管线，不是经济安全。**

## 5. 合规注记（非法律意见）

- 测试币阶段本身风险低：无对价、无销售、无二级市场（§3.2/3.3 使之结构性成立）。
- **风险时点 = 公开宣称"主网预测市场"那一刻**；监管看的是运营者整体，而路线图上有第二方向（发债/稳定币）。**第二方向不在本稿、不公开、不上链**（Owner 已认"合规准备不够"）。
- Owner 在匈牙利 ⇒ MiCA 适用。上主网**公开**前拿一页匈牙利/MiCA 意见；本稿的 §3.2/3.3 就是给律师看的"它为什么不是加密资产发行"的技术论据。

## 6. 落地步骤（每步各自过铁律 0）

1. **波 0 不变**：S-2 第二台机、v2.0.1 官方、只读。
2. **代币合约**：`kasia-console/src/lib/sil-v1/KanetTestToken.sil`（名待 Bettor 拍）——KCC-0020 六字段布局 + `mint` 无校验 + `transfer`/`mint` 限 `owner_scheme==0x04`。
   - 编译器：**silverscript v1.0.0 官方二进制**（sha256 `ce1e0ef5…4b29af`）。🔴 **pragma 保持 `^0.1.0`**：本会话实测 v1.0.0 二进制 `COMPILER_VERSION` 仍是 `"0.1.0"`（`compiler/mod.rs:55`），`^1.0.0` 被拒（"cannot support pragmas that cover future major versions"）——J2 迁移计划 §3"正式版切 `^1.0.0`"**要反过来**，等上游升常量再切。
   - 构造参数按 `docs/CONSTRUCTOR_ARGS.md`（v1.0.0 新增）：`[{"kind":"bytes","value":[…]}, …]`。
3. ~~先 TN12 staging~~ → **直接主网 genesis**（TN12 退役，§9；隔离测试改为 v1.0.0 `cli-debugger` 行为向量 + 主网手续费级真链）。
4. **市场合约侧（真正的工程量）**：pool/bshard 的 stake 从 KAS 输出值改为代币 covenant 状态 `amount`，市场 covenant 以 `owner_scheme 0x04` 持币、结算时 `transfer` 给赢家的**市场领取 covenant**（仍是 0x04，不进个人地址；领取 covenant 再按 (a) 规则继续持有——个人"钱包余额"= 其名下领取 covenant 的 amount 之和）。归 J2，与 42 合约 v1 迁移**同批**（9/7 §B「最大工程量」）。
5. **验收**：行为向量（每 `require` 一正一反，J2 计划 §5 法）+ 主网真链（手续费级）。
6. **CLAUDE.md 铁律 0.5 注记**另笔补 2026-09-13 状态：上游 v1.0.0 无 OP_PICK bug（#178 重构消除，非合并我们的修复）；本机修复只对仍用 0.1.0 的第三方有意义。

## 7. 请 NWT 判 / 请 Bettor 拍

1. 转移档 (a) 是否够，(b) 何时提上来。
2. 代币名 / ticker / 合约文件名。
3. 是否向 `kaspanet/kccs` 提一条 "permissionless mint 用例" 说明——**对外动作，GO 前不做**。
4. 本稿与 J2 v1 迁移计划的合并点（建议：并入批 A 之后、批 D 之前，作为"批 T"）。
5. `sil-v1/` 目录 vs `*_v1.sil` 后缀（J2 计划 §6-1 悬而未决，本稿倾向目录）。

## 9. TN12 退役 + 主网节点上 da9（裁定 9/10 · Bettor 执行）

**改变的规则（需 Bettor 落账，本稿只记原话不替他落）**：CLAUDE.md 铁律 0.5「rolling 只维持 live 公测·不停」、D-005「live 节点原地不动」、9/7 评估 §3/§5——三条由裁定 10 取代 ⇒ **DECISIONS.md 新 D-条目 + CLAUDE.md 0.5 下补 2026-09-13 状态注记（不改 Owner 原话）**。不落账，下一个接位 agent 会按铁律拒绝执行。

**未结盘**：不做逐盘结算/退款、不发公告（Owner 原话「剩下来的，呵呵」「就干这几样即可」）。

**Owner 指定的三件事（da9 · 原话顺序 · 不多做）**：
1. **停 console 里所有指向 TN12 的定时任务、挖矿 watchdog、stratum 桥**：settler / seeder / 再平衡 cron / `bshard-close-*` / `zk-prove-worker`；`tn12-mining-watchdog-v2`；stratum 桥。先停消费者再停节点（否则 G-2 自愈对空节点无限重连刷错）。`KANet-TN12-BootSequence` / `KANet-Console-Supervisor` 计划任务保持 Disabled（9/2 已改）。
2. **停 TN12 节点（kaspad `1.1.1-toc.1`）。`console.db` 留着（历史证据），kaspad 的 ≈204 GB 数据目录删掉**——链是公开的，随时能重新同步。同样**保留** `docs/evidence/*`、`docs/provenance/*`、pinned silverc（`legacy-2c46231` / `zk-8065184`，已部署 TN12 字节码的复现取证靠它们）。
3. **腾出的 204 GB + 现有 712 GB ≈ 900 GB 直接跑主网节点，盘先不买**（官方最低 640 GB / 推荐 1 TB；想留余量再加一块**内置 NVMe**，不用 USB 外置）。节点 = 官方 **v2.0.1 原样**（不带 D-b/c/d），独立 datadir + 端口（16111/17110），`--utxoindex`。

**da9 2026-09-08→09-13 掉线 4.5 天 · 根因（2026-09-14 J1 只读实核，三源：System 事件日志 / Tailscale 服务日志 / KANet 日志与计划任务）**

三个条件同时成立，任一不成立都不会掉 4 天：
1. **Windows 自动更新重启**：`MoUsoCoreWorker.exe` 于 2026-09-08 22:29:04Z（曼谷 05:29）发起重启，装 KB5124008 / KB5124007 / KB5126052（安装日期 9/8），22:30–22:33Z 连续三次 servicing 重启，22:33:46Z WiFi `Yang_5G 2` 已连、NTP 全程可达（机器与外网**一直正常**：9/9–9/12 System 日志每日 27–55 条，Windows 维护任务天天跑）。活动时段 `ActiveHoursStart=11 / End=5`，05:29 在窗外 ⇒ 重启"合法"。
2. **重启后无人登录 Windows**：`AutoAdminLogon` 未设；`quser` 显示 admin 于 09-13 16:45 本地才登录 console。KANet 日志 9/9–9/12 **零行**、`keep-awake` 未跑：全是用户会话内进程；`KANet-TN12-BootSequence` 9/2 起刻意 Disabled。
3. **Tailscale 未开 unattended**：`HKLM\SOFTWARE\Tailscale IPN` 无 `UnattendedMode`。每次开机 tailscaled 日志逐字：`profile data directory: profile not found` → `Switching ipn state NoState -> NeedsLogin (WantRunning=false)` → `health: Tailscale is stopped.`，然后**不再写任何日志**（`tailscale-service-20260909T053339` 末行 22:35:30Z，下一份文件是 09-13 07:16:55Z）。**09-13 两次重启完全复现**：07:17:35Z NeedsLogin → 14:44:50 本地 `SessionChange`（有人登录）→ 14:45:14 Running；09:45:36Z NeedsLogin → 16:45:40 `SessionChange` → 16:45:54 Running。
- 排除项：Modern Standby 506/507 计数 0；S3 睡眠 42/107 事件 0；SCM 无 Tailscale 崩溃记录（故失败恢复策略未触发——它是"未登录"不是"崩溃"）；NordVPN 开机自连（NordLynx 10.5.0.2）为旁枝，非因。
- ⚠ 分析陷阱（J1 自记）：先只读了该日志首尾，据"2 分钟后不再写日志 + 0 active derp conns + NordLynx 出现"推断"服务卡死 / VPN 冲突"——**错**；决定性的三行在中段。整份读完再理论。

**修法（三条任一可防、建议全做）——① ② 已于 2026-09-14 ≈07:58Z 按 Owner 直令由 J1 经 SSH 施加并读回（回执：inbox `2026-09-14T08-05Z-j1-DONE-da9-outage-rootcause-softfix-applied-owner-order.md`）**：
1. ✅ Tailscale unattended：`tailscale set --unattended=true` ⇒ `debug prefs` `ForceDaemon: true`，status Running。
2. ✅ Windows 更新禁自动装/禁自动重启：新建 `HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU`，`AUOptions=2` + `NoAutoRebootWithLoggedOnUsers=1`（da9 = Windows 11 **Pro**，策略被完整尊重）。补丁改为维护窗手动装。
3. ⏸ admin 自动登录：**未动**（需密码，Owner 自决 `netplwiz`）——或把 KANet 改为不登录也运行的计划任务（`BootSequence` 机制已有，TN12 退役 / 主网节点就绪后重新启用）。
- 🔴 **改了配置 ≠ 生效**（9/2 Modern Standby 同病）。**唯一判据 = 无人登录状态下重启一次、Tailscale 自行 Running**——归 Bettor，与 §9 停 TN12 同窗做；验证前任何账本不得写"已修"。
- 作用域：只盖「重启后门没开」这一类；不盖蓝屏/死机起不来、停电、5G 路由卡死、大版本更新重置策略 ⇒ 硬件从"必须"降为"可选"：UPS + 看门狗插座仍建议，NanoKVM 可缓。
- ✅ 08:40Z 再一处（Owner 直令）：`tailscale set --auto-update=false` ⇒ `AutoUpdate: {Check: true, Apply: false}`（只提示不自动装）。
- 🔴 **定时炸弹**：Tailscale 节点密钥 da9 `2026-12-24T15:29:54Z` / younio `2027-02-15` 到期 ⇒ 届时需人工重登录，与本次同形。**只能在 Tailscale 网页控制台 Disable key expiry（Owner）**；Bettor 入账本催办。
- **RustDesk 实核**：服务在掉线 4 天里**一直在线**（09-10/11/12 每日与 `rs-ny.rustdesk.com` 通信；09-12 13:20 本地 `request_pk`×3 = 有人按 ID 尝试连入未成）；而 09-13 两次成功连入来源 = **younio 的 Tailscale IP**（`direct-server='Y'`）⇒ Owner 的 RustDesk 路径经 Tailscale、同断。**独立第二扇门 = RustDesk ID + 永久密码经官方中继**（登录界面即可用）。安全建议（Owner 拍）：关 `allow-remote-config-modification`、开 2FA、**AnyDesk 9.7.8 亦在 da9 作为服务运行 → 建议卸载只留 RustDesk**（同机 40 把 relay 私钥）。
- NanoKVM 方案仍成立：它管"机器起不来"那一类，与本次不是同一病。

## 8. 本会话实测坐标（v1.0.0，只写 scratchpad，未入库）

| 项 | 结果 |
|---|---|
| v1.0.0 = `3ed9733`（2026-09-09）；rc1→v1.0.0 仅 4 commit，但 #245/#246 新增 ~2000 行静态拒绝（资源上限 / covenant 展开界 / 脚本限制 / 状态初始化须常量） | J2 批 A/B/C 在 rc1 上做的离线编译**要在 v1.0.0 重跑** |
| `compile_byte_sequence_cast_call`（`builtin.rs:157`）只收 1 参；`OpNum2Bin` 处 `emit_op(OpNum2Bin, -1)`；手工 `stack_depth` 记账全仓 **7 处**（我们树 112） | OP_PICK off-by-one **不在**；卡 `2026-07-28-…byte-equivalence-card.md` §七 的数 = 7 ⇒ 机制整体替换 |
| `Blake2bProbe.sil` 只改 `entry` + `byte[36]` + 喂 ctor，v1.0.0 编过 **210 B**（J2 rc1 数同长；字节逐一未验）| 1/42 |
| `Cargo.toml version = "1.0.0"`，`COMPILER_VERSION = "0.1.0"`；`pragma ^1.0.0` 拒、`^0.1.0` 过 | 上游 issue 列表到 #251 无人报 |
| 仓里 42 个 `.sil` 全 `^0.1.0`；`sil-v1/` 不存在 | 迁移未落库 |
