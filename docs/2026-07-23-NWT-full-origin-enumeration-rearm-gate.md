# 全 live 面 sendCommandAsync origin 完整枚举 — 重 arm 硬前置（NWT）

> **Status**: NWT 完整枚举（2026-07-23·开闸事故后根治）· 重 arm 硬前置 = 138 全覆盖无缺失无误标 + R-SENDCMD-ORIGIN-REQUIRED lint。
> **起因**: 开闸 10 分钟事故断 app 面（第二族 17 app 误标无信封）。NWT 完整枚举揭出**更大的第三族：~51 处缺失 origin**（批A/C 标注远不完整，多为钱路 daemon·armed→拒→结算/oracle/close 冻结·10 分钟低活跃窗未触发=latent）。
> **arm 就绪重估**: 标注 ~68 处不完整 + 机制A（真 app 面）未落码 = arm 离就绪远 → 更倾向机制A-first（Owner 定时机）。

---

## 三断路族全图

| 族 | 面 | armed 行为 | 修法 |
|---|---|---|---|
| ① 收敛类（已 C 处理） | pool18/relay/trading 22 | legacy→放行 | 已标 legacy（C 机制）✅ |
| ② app 误标（事故·95b2bead 修） | 17 Console 通信/handshake·零信封 | app→verifyAppEnvelope→envelope 缺失→**拒断** | →legacy（95b2bead 已落·待核）|
| ③ **缺失 origin（最大·本枚举揭出）** | ~51 处·多钱路 daemon | 缺失→**fail-closed 拒**（不查 readonly 白名单）| →internal（daemon）/legacy（请求触发）**未落·必补** |

**🔴 关键: 缺失 origin 的 readonly 命令（get_rpc_state/get_address_utxos）armed 也拒**——authorizeCommand 缺失分支直接拒，不到 authorizeAppCommand 的 READONLY_ALLOWLIST 豁免（那只 origin=app 路径查）。所以 readonly 缺失也断，也须标。

## 第三族完整清单（~51 缺失·逐文件 origin 判定）

### → internal（daemon/service/infra·TCB 放行·39 处）

| 文件 | 缺失 | 命令性质 | 判定依据 |
|---|---|---|---|
| services/pool-market-settler.js | 8 | 结算广播/preimage 钱路 | settler daemon（tick 触发）|
| services/trade-protocol-filter.js | 5 | oracle get_pubkey/ecdsa_sign/broadcast | 协议 filter daemon（route-reachable 但 daemon 执行·同 exchange-machine:974 内建规矩）|
| services/bettor-prediction-settler.js | 5 | 结算 | settler daemon（已 2 tagged internal·补齐其余）|
| services/broker-action-queue.js | 4 | broker 命令 | queue daemon |
| services/prediction-params-cache.js | 2 | 参数缓存 | service（tick）|
| services/zk-prove-worker.mjs | 2 | zk prove | worker |
| services/broker-bot-manager.js / broker-buy-handler.js / broker-intake-watcher.js / market-seeder.js / utxo-splitter.js | 各 1 | broker/做市/拆分 | daemon/service |
| services/relay-manager.js | 3 | get_rpc_state(readonly)/transfer/check | infra helper（⚠:366 transfer 需核调用方语境）|
| lib/bshard-close-transport.mjs | 3 | close 结算 | 被 close-voter daemon 调 |
| lib/pool-broadcast.mjs | 2 | 池广播 | 被 settler 调（⚠核调用方）|

### → legacy-unmigrated（请求触发·场景-A 可达·过渡·~12 处）

| 文件 | 缺失 | 命令性质 | 判定依据 |
|---|---|---|---|
| api/oracle-pool.js | 6 | get_pubkey/ecdsa_sign/submit 钱路 | 请求触发（withdraw/enroll 路由的 helper·下游有密码学验但 origin 层请求触发）|
| api/bettor.js | 5 | transfer 质押到 escrow 钱路 | 请求触发（bettor 下注流路由）|
| api/coord-status.js | 1 | ecdsa_sign | 请求触发路由 |

**⚠ 逐 call 复核项（KANet-UI 落码 + NWT 重核确认）**: ①relay-manager:366 transfer 调用方语境（daemon vs 请求）②pool-broadcast/bshard-close-transport 调用方确认 daemon ③trade-protocol-filter route-reachable 但 daemon 执行→internal（同 exchange-machine:974 论证：daemon 执行·场景-A 防御在上游路由授权）④api/ helper 是否真全请求触发（非内部 cron helper）。

## 🔴 systemic 根治：R-SENDCMD-ORIGIN-REQUIRED lint（linchpin）

**根因 = origin 标注完整性无静态强制**（只 relay-manager 运行时 warn）→批A/C 漏 ~51 处。修法：lint 规则**每个 sendCommandAsync/别名调用必须带 origin 第4实参·缺失=block（ERROR）**。
- 一上=**自动逐个暴露全部 ~51 缺失**（lint fail）→逼全标→机制化完整性·永不再漏第 N 族。
- 覆盖别名调用（沿用 R-SCA-ALIAS-ORIGIN 的 call-arg-span 检测别名 call 的 origin·扩到直调）。
- 这是事故的机制层根治（约定靠自觉守不住→上机制·铁律 0 同族）+第三族补全的驱动闸。

## 🔴 补一个**枚举维度**（2026-07-28·NWT·Bettor 派工："补维度不是补条目"）

**起因**：`POST /api/relay/:id/publish-card`（`api/relay.js:1512`）缺 origin，而它**四份权威枚举档全部零命中**（Bettor 实核）。
**它为什么躲过了枚举**：本档与另三份枚举的键是 **「哪条路由 / 哪条命令」**，而这一条的特殊性**不在它是哪条路由,在它调了另一个函数** —— `sendCommand()` 而非 `sendCommandAsync()`。**按前者枚举,永远数不到它。**

### 🔴🔴 而同一个盲点也在那条 linchpin lint 里 —— 所以"lint 全绿 ⇒ 无缺失"这个箭头不成立

```
【实读 scripts/lint-kanet.mjs】
  R-SENDCMD-ORIGIN-REQUIRED :1558  const callRe = /(?:^|[^.\w$])sendCommandAsync\s*\(/
  R-SCA-ALIAS-ORIGIN        :824-829  只认 sendCommandAsync 的别名/裸值传参
  而 :1549 注释自述:「两规则合起来覆盖直调+别名全集」
```
🔴 **那个"全集"是【`sendCommandAsync` 调用的全集】,不是【进入 relay IPC 的命令的全集】。**
⇒ `sendCommand()`(`relay-manager.js:247`,同样 `child.send`,且**不做 origin 权威设置**)对**两条规则都不可见**。
⇒ ⇒ 所以本档 re-arm 门第 3 条「lint 上线(block) → 全 138 无缺失」**推不出它想推的结论**。今天差额 n=1(publish_card),而 lint 对"明天再加一个"提供**零保护**。

### 🔨 维度修法：枚举与 lint 都改锚在**效果发生的那一点**,不锚在函数名

```
✅ 真正的收窄点是 child.send( —— 全仓【只有两处】(relay-manager.js:250 与 :317)
   ⇒ 枚举/lint 锚这里, 任何新的"能把命令送进 relay"的函数都会当场现形
❌ 锚 sendCommandAsync = 锚一个【名字】 ⇒ 换个名字就绕开, 而绕开时 lint 是绿的
🔨 且照 Bettor 07-28 裁定的方向: publish_card 迁到 sendCommandAsync 之后,
   让 sendCommand 【不存在】(n=1, 代价=一个调用点) —— 否则"补上参数两个函数并存"
   等于把洞留在原地等下一次: 下一个人写新代码仍然可以选到没 origin 的那个
🔨 配一条 lint: 除 sendCommandAsync 之外出现新的 child.send( 路径 = block
   ⇒ 于是"完整性"从【枚举出来的】变成【结构上成立的】
```

🔵 **一句判据(与本仓规则 58 同族)**:枚举的键必须是**「能不能产生那个效果」**,不是**「这条语句/这个调用叫什么名字」**。按名字枚举时,**盲点与覆盖在报告里长得一模一样**。

---

## re-arm 完整门（三族全修 + 双闸）

1. ② 17 app→legacy（95b2bead·NWT 核）
2. ③ ~51 缺失→按本清单补标（internal/legacy）+ 逐 call 复核项确认
3. R-SENDCMD-ORIGIN-REQUIRED lint 上线（block）→ 全 138 无缺失
4. NWT 重核全 138 逐 origin 值（无缺失无误标·逐 origin armed 语义不断 live）
5. J2 动态 harness 用**重分类后生产 origin 标注全集** armed=on 实发（当场抓任何残留断路族·fixture 镜像生产现实）
6. **③lint 全绿 + ⑤harness 生产标注全绿 = re-arm 前置**（仍机制A-first·arm 现在 low-value 无真 app 面·Owner 定时机）

**gate 逻辑本身正确无需改**（app 无信封该 deny·缺失该 fail-closed·是标注不完整非 gate 错）。

**关联**: `docs/2026-07-23-NWT-phased-arm-legacy-unmigrated-design.md`（C 机制）、`docs/2026-07-23-NWT-diff-c-phased-arm-and-harness.md`（合审）、`scripts/legacy-origin-baseline.json`（debt ledger）、95b2bead（②修）、memory `reference-fail-closed-gate-arming-blast-radius-transitional-tag` + `feedback-arming-gate-app-tag-without-envelope-breaks-second-family`。
