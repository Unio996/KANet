# 注册 dotk 名字 `kanet.k` 与持有权保存设计 v0.1（Bettor · 架构师帽 · 待 NWT 设计审）

- **Status**: DRAFT v0.3 · 2026-09-19 · 待 NWT 红队审（设计 + SDK 二进制审）→ 过了才派执行
- **v0.3 改动（KANet-UI 只读核出 `startAll` 事实，Bettor 采纳）**：console 启动时 `index.js:629-630` 无条件 `startAllRelays()`，`relay-manager.js:332-352` 对**所有"有 address 且有助记词"的 relay** 起子进程、不看 adapter、不看角色，助记词经环境变量进该进程（`buildRelayKeyEnv`，:246）⇒ v0.2 的"持有身份存 console 但永不进进程"**不成立**。改为：**持有钥匙完全离线——console 不存助记词、不建 relay 行**；由 Owner 用 J1 写的离线脚本（不连网、不写文件）生成，屏幕上只出现一次，Owner 抄**两份**分开保管；脚本同时打印地址与 x-only 公钥（这两项是公开的，进 provenance）；恢复演练 = 同一脚本的 verify 模式。层一备份由"库内加密"改为"第二份离线抄底"。另：§3.0 三项核查已由 KANet-UI 只读答毕（见 §3），`83c9be27` 与全部 18 个 relay 当前**都在跑**，转账路径现成，热钱包监控超限只杀进程、不动资金。
- **v0.2 改动（KANet-UI 只读核既有路径后指出两处缺口，Bettor 采纳）**：① 持有身份的助记词不得经任何 agent 的工具输出 ⇒ 由 Owner 在 da9 浏览器 `/relays` 页亲手生成、抄底、提交；恢复演练脚本由 Owner 在自己终端跑，隐藏输入、只打印 match 布尔；② 临时付款身份**不建成 console relay**（console 内签名与转账都要在跑的 relay 子进程；无进程签不了名；`/transfer` 选币留找零、扫不到零）⇒ 临时付款私钥由 signer 垫片在进程内用 kaspa-wasm 生成、永不进 console，console 只负责把 47 KAS 转到该地址，扫回也由垫片自签；③ 出资 relay 走 `POST /api/relay/:id/transfer`（`X-KANet-Admin-Secret` = `ADMIN_SECRET_FUNDS`），该路径要求源 relay **在跑**，而 `83c9be27` 目前无进程 ⇒ 新增 §3.0 执行前核查（能否临时起停、热钱包驻留监控对超上限在跑 relay 的处置）。
- **Owner 授权**：2026-09-19 终端原话「kasia 是我们通讯层协议。只有 kanet 是我们自己的。kanet.k 五个字符吧？我们去注册吧？」「这个你来搞，你的账户有很多，选择余地大。」「如何科学保存，需要你动脑筋。」
- **来源**：J1 信箱 `docs/iteration/j1-inbox/2026-09-19T11-13Z-j1-ASK-GO-dotk-register-kanet-k-mainnet.md`（实测事实）与同日 NOTE 页；本页 §1 的链上事实由 Bettor 2026-09-19 独立复核（`api.dotk.name/v1/genesis` 版本 6、`/v1/names/kanet` 404、主网节点 v2.0.1 已同步）
- **写作规矩**：D-021。本页不写任何 relay 余额、地址与持有人对应、助记词或密钥。relay 只以 UUID 前 8 位指代。

## 0. 一句话

用一个**只花 47 KAS 就作废的临时付款身份**去跑未经审计的 dotk SDK，把名字激活到一个**永不进入任何脚本进程、Owner 手里另有离线抄底的专用持有身份**上；注册前先演练一次从离线抄底恢复持有身份，注册后由我们自己的节点每周核一次地契还在不在。

## 1. 决定"怎么保存"的三条链上事实（Bettor 复核）

| 事实 | 出处 | 对设计的意义 |
|---|---|---|
| `DotkDeed.activate(name_, ownerType_, ownerKey)` **不带签名参数**；`transfer(newOwnerType, newOwner, sigs, witness)` 与 `release(sigs, witness)` 才要签名 | genesis v6 `deedAbi` | **激活时持有者不必签名**，只需给出 ownerKey ⇒ 付款方与持有方可以是两把不同的钥匙；持有钥匙可以从头到尾不碰 SDK |
| 创世参数只有 `bond`（1 KAS）与 `t_evict`（3000 DAA ≈ 5 分钟），**没有到期、续费、宽限期字段** | genesis v6 `params` | 名字是永久的；"保存"只需守住持有钥匙、别让地契被 `release` / `transfer`，没有续费日程要记 |
| deed 状态 `owner` 为 32 字节 + `ownerType` 一字节；SDK `addressFor("kanet.k")` 回收款地址 | genesis v6 `deedAbi`、J1 实测 | 持有钥匙的地址大概率就是 `kanet.k` 的收款地址（待 J1 在 SDK 里确认）⇒ 谁持钥匙谁收款，持有身份必须是我们打算长期收款的那把 |

其余事实（不重复 J1 页）：`kanet` 未注册；`kaspa`、`kasia` 已被他人注册；活跃名字四天涨十倍，**抢注是真实风险，目标三天内落地**；dotk 源码仓库 404，只有 npm 二进制（`@dotk/sdk-tx@1.2.0`，integrity `sha512-8LIon+…`，解包 324 KB，依赖仅 `@noble/curves`、`@noble/hashes`，无网络库）。

## 2. 持有权保存设计（回答「如何科学保存」）

**原则**：名字的存活不能依赖 console 的存活；持有钥匙不进任何一次性脚本；每个"信"字都要有一次演练或一条自查命令。

1. **付款方 ≠ 持有方，两把钥匙，三层隔离**
   - **出资来源** = 主网 relay `83c9be27`（唯一余额足够的一个），但它**不直接进 SDK 进程**。
   - **临时付款钥匙**（v0.2：由 signer 垫片在进程内用 kaspa-wasm 生成，**不是 console relay**，永不进 console 库；运行期间只在垫片内存与一个 `scratch/` 下受限权限的临时文件里，扫回落链后删除该文件）：用既有 `POST /api/relay/:id/transfer` 从 `83c9be27` 转入 **47 KAS**（38 档位费 + 1 bond + SDK 手续费上限 5 + 3 余量）到它的地址。SDK 进程里唯一出现的私钥就是它 ⇒ **未经审计的二进制最多能拿走 47 KAS**，拿不到别的。用完由垫片自签一笔 sweep 把全部余额扫回 `83c9be27` 的地址（自签可以精确清零），用我们的节点 `getUtxosByAddresses` 条目数为 0 证空。
   - **专用持有钥匙**（v0.3：**完全离线**，不是 console relay、console 里没有它的任何一行）：只提供 x-only 公钥作 `activate` 的 `ownerKey`。它的私钥**不在任何机器上**——不进 SDK 进程、不进任何脚本、不进 console 库（因为存进 console 就会被 `startAll` 拉成进程，见页首 v0.3）。能动地契的 `release` / `transfer` 都要它签名，而它只在 Owner 手里 ⇒ 任何自动化路径、任何被攻破的进程都碰不到名字。
2. **持有钥匙的两层备份（v0.3）**
   - 层一：Owner 离线抄底第一份（生成时抄）。
   - 层二：Owner 离线抄底第二份，与第一份**分开存放**。丢一份不丢名字；两份都丢 = 名字仍解析、仍能收款，但永远不能转让或释放——这是品牌资产可接受的失效模式。
   - **生成方式**：J1 写一个离线脚本（`generate` 模式：不连网、不写文件、用 kaspa-wasm 生成 24 词助记词，屏幕打印助记词一次、地址、x-only 公钥），**Owner 在自己终端运行**，抄两份，关窗清屏。地址与公钥由 Owner 告知 Bettor 进 provenance。**任何 agent 不得运行该脚本、不得经 console `/relays/generate-mnemonic` 生成**（进 console 库就会被拉成进程）。
   - **注册前必做一次恢复演练**：同一脚本 `verify` 模式，Owner 在自己终端运行：隐藏输入某一份抄底，本地派生地址，与命令行给的地址比对，**只打印 `match=true/false`**。两份各验一次都为 true 才允许出资。No tested restore, no recovery claim。
3. **地契自身的保护**：地契是 covenant P2SH UTXO，不在持有身份的 P2PK 地址上，普通钱包扫币扫不到它；能动它的只有 `release`（放弃名字、退 bond）与 `transfer`，两者都要持有钥匙签名 ⇒ 第 1 条的"不进程、不自动化"就是它的保护。
4. **每周只读核验**（J1 域，纳入其节点巡检）：用**我们自己的节点**（不信 `api.dotk.name`）核 deed UTXO 未被花、`owner` == 持有公钥；`/v1/names/kanet` 只作对照。任一不符即报 Bettor。
5. **记录**：账本 + provenance 页记 commit / reveal 两个 txid、deed 地址、registry covenant id、持有身份 UUID、SDK 版本与 integrity；**不记**任何余额。

> 替代（仅当 Owner 想让 `kanet.k` 的收款直接落到他个人钱包时）：`ownerKey` 改用 Owner 自己钱包的 x-only 公钥，注册流程不变、也不需要 Owner 签任何东西，只需他给一个公钥；代价是今后 `transfer` / 改记录都要他本人的钱包签。本页默认走专用持有身份，不再列选项。

## 3. 执行形状（钱路，D-011 内部双审）

1. **侦察（J1，younio 本机，只读）**：按 integrity 拉 `@dotk/sdk-tx@1.2.0` 与 `@dotk/sdk@1.2.0` 的 tarball，读源码回答：① signer 接口（按输入索引、SIGHASH_ALL）；② `ownerKey` 能否与付款钥匙分离传入（协议允许，看 SDK 是否暴露；不暴露就写明改哪一行）；③ 它对外只连哪些端点（预期：我们的节点 RPC + `api.dotk.name` 查 gap）；④ `planRegistration('kanet.k')` 的报价与两笔交易形状。写一个 ≤ 80 行的 signer 垫片（kaspa-wasm `createInputSignature`，私钥只在函数作用域内、不打印、不落盘），连同侦察结论一起投信箱。
2. **红队（NWT）**：审本设计 + 审 tarball（有无外传、有无除 RPC 以外的副作用、签名请求里有没有我们没打算签的输入）+ 审垫片。GREEN 才进第 3 步。
3. **执行（KANet-UI，da9 本机，按 runbook，Bettor 分步 GO）**：
   - 3.0 **执行前核查（KANet-UI 2026-09-19 只读答毕）**：(a) `83c9be27` 与全部 18 个主网 relay **当前都在跑**（`index.js:629-630` 启动即 `startAllRelays()`，不看 adapter；`GET /api/system/rpc-overview` 18/18 connected），`/transfer` 路径现成，不需要起停；(b) `relay-hotwallet-monitor.js` 超限只 `stopRelay` + 写告警（:80-85），**不动资金、不拒交易**（:16-20 头注），`83c9be27` 当前单 relay 与总额均**不超限**，转出 47 KAS 只会降低其余额；尾部风险：RPC 连续 3 个 tick（30 s/tick）不可用会 fail-closed 杀掉全部 relay（:138-150）⇒ 转账前后各读一次 `rpc-overview`；(c) 47 KAS 走 `transaction.mjs:194-212` 单输入路径（`minSafeUtxo = 47×1.65 + 0.003 KAS ≈ 77.55 KAS`，源 relay 有 ≥2 个满足的 UTXO），预期一笔；执行前重读一次 UTXO 形状（`filterPendingUtxos` 会排除近期花过的）；落链核 = 节点 `getUtxosByAddresses` 收款地址出现 `transactionId == txId` 且金额恰 47 KAS 的条目、源地址出现同 txId 的找零，若源地址出现其他新 txId 即发生拆分须再核；Generator 拆分阈值在 vendored kaspa-wasm 内、仓内未读到，标待 NWT 核。
   - 3.1 **Owner 本人**在自己终端跑 J1 的离线脚本 `generate` 模式生成持有钥匙，抄两份分开存，把地址与 x-only 公钥交 Bettor；再跑 `verify` 模式两份各一次 `match=true`。**console 不建行。**
   - 3.2 垫片生成临时付款钥匙并打印其地址；KANet-UI 用 `POST /api/relay/83c9be27…/transfer`（带 `ADMIN_SECRET_FUNDS` 头，值只从主网 env 读、不回显）转 47 KAS 到该地址（Bettor GO）；该路由只保证进内存池，**落链由我们自己的节点核**（`check_utxo_landed` 同款判据），落链后再进 3.3。
   - 3.3 **predict-then-verify**：垫片签名前打印两笔交易的全部输出（目的 spk、金额、找零回临时身份），总流出 ≤ 45 KAS，与 `planRegistration` 报价逐项对上才签；对不上即停，临时身份余额原路扫回。
   - 3.4 commit + reveal **一口气做完**（PENDING 超过 ≈5 分钟会被驱逐、押金归驱逐者），只连我们自己的节点。
   - 3.5 落链核验：我们的节点上 deed UTXO 存在、`owner` == 持有公钥；`/v1/names/kanet` 200 作对照。
   - 3.6 垫片自签 sweep 把临时钥匙地址全部余额扫回 `83c9be27` 的地址，节点 `getUtxosByAddresses` 条目 0 证空后删除临时钥匙文件（不涉及任何 console 删除路径；持有身份永不删）；写 provenance + 账本。
4. **闸**：Owner 已批方向；Bettor GO 三处（NWT GREEN 后、3.2 出资前、3.4 广播前）；NWT 事后复核 3.5。**任何一步对不上数字就停，不重试**——commit 前停零损失，commit 后停只损失押金，名字回到可注册状态。

## 4. 风险与上限（诚实口径）

- 二进制不可审到源码级：上限 = 临时身份的 47 KAS；持有钥匙、`83c9be27` 主体余额、我们自己的合约与资金路径不在其可及范围。
- reveal 时名字先在内存池暴露，存在抢注窗口：只能靠自己节点直连、两笔紧接提交来压缩；残余风险接受，损失上限 = 押金。
- dotk 唯一性只在其自身 covenant 血脉内成立；换模板即另一命名空间——名字的价值取决于生态是否认这条血脉，这是买品牌资产的正常风险。
- 不做：不把 relay 私钥引进新脚本；不用 Owner 外部钱包点确认（Owner 已明示用我们的账户）。

## 5. 未定 / 下一页

- `kanet.k` 收款地址是否即持有公钥地址、记录（网址 / 头像）存在哪一层——J1 侦察回答后补 §1。
- J1 同日 NOTE 页（dotk 手法搬到长尾分成金库）：**另起设计票，不并入本页**，排在结算后半程之后。
