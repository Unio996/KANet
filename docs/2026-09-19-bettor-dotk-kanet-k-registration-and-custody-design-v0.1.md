# 注册 dotk 名字 `kanet.k` 与持有权保存设计 v0.1（Bettor · 架构师帽 · 待 NWT 设计审）

- **Status**: DRAFT · 2026-09-19 · 待 NWT 红队审（设计 + SDK 二进制审）→ 过了才派执行
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
   - **临时付款身份**（新建，用完即弃）：用既有、已验证的普通转账路径从 `83c9be27` 转入 **47 KAS**（38 档位费 + 1 bond + SDK 手续费上限 5 + 3 余量）。SDK 进程里唯一出现的私钥就是它 ⇒ **未经审计的二进制最多能拿走 47 KAS**，拿不到别的。用完把余额扫回 `83c9be27`，删除该身份。
   - **专用持有身份** `kanet-k-holder`（新建）：只提供 x-only 公钥作 `activate` 的 `ownerKey`。**它的私钥不进 SDK 进程、不进任何脚本**，不分配 adapter、不起进程、不设角色、不参与任何自动化路径（这三条同时也挡住误调 `release` / `transfer`）。
2. **持有钥匙的两层备份**
   - 层一：console 主网库里的加密助记词（既有备份纪律覆盖）。
   - 层二：**Owner 离线抄底**——创建时助记词只在操作者屏幕出现一次，由 Owner 亲手抄下并保管，不进任何文件、聊天、账本、日志、提交。
   - **注册前必做一次恢复演练**：从离线抄底重新派生地址，与库里该身份的地址逐字符相等，才允许出资。No tested restore, no recovery claim——这一步做完，才可以说"console 没了名字也在"。
3. **地契自身的保护**：地契是 covenant P2SH UTXO，不在持有身份的 P2PK 地址上，普通钱包扫币扫不到它；能动它的只有 `release`（放弃名字、退 bond）与 `transfer`，两者都要持有钥匙签名 ⇒ 第 1 条的"不进程、不自动化"就是它的保护。
4. **每周只读核验**（J1 域，纳入其节点巡检）：用**我们自己的节点**（不信 `api.dotk.name`）核 deed UTXO 未被花、`owner` == 持有公钥；`/v1/names/kanet` 只作对照。任一不符即报 Bettor。
5. **记录**：账本 + provenance 页记 commit / reveal 两个 txid、deed 地址、registry covenant id、持有身份 UUID、SDK 版本与 integrity；**不记**任何余额。

> 替代（仅当 Owner 想让 `kanet.k` 的收款直接落到他个人钱包时）：`ownerKey` 改用 Owner 自己钱包的 x-only 公钥，注册流程不变、也不需要 Owner 签任何东西，只需他给一个公钥；代价是今后 `transfer` / 改记录都要他本人的钱包签。本页默认走专用持有身份，不再列选项。

## 3. 执行形状（钱路，D-011 内部双审）

1. **侦察（J1，younio 本机，只读）**：按 integrity 拉 `@dotk/sdk-tx@1.2.0` 与 `@dotk/sdk@1.2.0` 的 tarball，读源码回答：① signer 接口（按输入索引、SIGHASH_ALL）；② `ownerKey` 能否与付款钥匙分离传入（协议允许，看 SDK 是否暴露；不暴露就写明改哪一行）；③ 它对外只连哪些端点（预期：我们的节点 RPC + `api.dotk.name` 查 gap）；④ `planRegistration('kanet.k')` 的报价与两笔交易形状。写一个 ≤ 80 行的 signer 垫片（kaspa-wasm `createInputSignature`，私钥只在函数作用域内、不打印、不落盘），连同侦察结论一起投信箱。
2. **红队（NWT）**：审本设计 + 审 tarball（有无外传、有无除 RPC 以外的副作用、签名请求里有没有我们没打算签的输入）+ 审垫片。GREEN 才进第 3 步。
3. **执行（KANet-UI，da9 本机，按 runbook，Bettor 分步 GO）**：
   - 3.1 建持有身份 `kanet-k-holder`（既有 `/relays/generate-mnemonic` + `POST /relays`，走热钱包准入门），Owner 在场抄底 → **恢复演练**通过。
   - 3.2 建临时付款身份，从 `83c9be27` 转入 47 KAS（既有转账路径，Bettor GO）。
   - 3.3 **predict-then-verify**：垫片签名前打印两笔交易的全部输出（目的 spk、金额、找零回临时身份），总流出 ≤ 45 KAS，与 `planRegistration` 报价逐项对上才签；对不上即停，临时身份余额原路扫回。
   - 3.4 commit + reveal **一口气做完**（PENDING 超过 ≈5 分钟会被驱逐、押金归驱逐者），只连我们自己的节点。
   - 3.5 落链核验：我们的节点上 deed UTXO 存在、`owner` == 持有公钥；`/v1/names/kanet` 200 作对照。
   - 3.6 临时身份余额扫回 `83c9be27`，删除临时身份；写 provenance + 账本。
4. **闸**：Owner 已批方向；Bettor GO 三处（NWT GREEN 后、3.2 出资前、3.4 广播前）；NWT 事后复核 3.5。**任何一步对不上数字就停，不重试**——commit 前停零损失，commit 后停只损失押金，名字回到可注册状态。

## 4. 风险与上限（诚实口径）

- 二进制不可审到源码级：上限 = 临时身份的 47 KAS；持有钥匙、`83c9be27` 主体余额、我们自己的合约与资金路径不在其可及范围。
- reveal 时名字先在内存池暴露，存在抢注窗口：只能靠自己节点直连、两笔紧接提交来压缩；残余风险接受，损失上限 = 押金。
- dotk 唯一性只在其自身 covenant 血脉内成立；换模板即另一命名空间——名字的价值取决于生态是否认这条血脉，这是买品牌资产的正常风险。
- 不做：不把 relay 私钥引进新脚本；不用 Owner 外部钱包点确认（Owner 已明示用我们的账户）。

## 5. 未定 / 下一页

- `kanet.k` 收款地址是否即持有公钥地址、记录（网址 / 头像）存在哪一层——J1 侦察回答后补 §1。
- J1 同日 NOTE 页（dotk 手法搬到长尾分成金库）：**另起设计票，不并入本页**，排在结算后半程之后。
