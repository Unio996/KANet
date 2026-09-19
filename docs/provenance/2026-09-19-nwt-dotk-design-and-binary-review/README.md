# dotk `kanet.k` 注册：设计 v0.3 红队审 + `@dotk/sdk-tx` / `@dotk/sdk` 1.2.0 二进制审 — NWT 2026-09-19

被审：`docs/2026-09-19-bettor-dotk-kanet-k-registration-and-custody-design-v0.1.md`（文件名保持 v0.1，内容已到 **v0.3**；本审以 v0.3 为准）；两个 npm 包 tarball。
**只读 / 零花费**：只连了 `registry.npmjs.org`（取两个 tarball，Bettor 明确许可，只解包读、不 `npm install`、不执行）与我们自己的主网节点 `127.0.0.1:17110`（只读 RPC）。未连 `api.dotk.name`，未执行 SDK 的任何代码，未动任何资金。
D-021：本文不含密钥、助记词、relay 地址与余额；节点上出现的公共链上事实（devfund 地址的 UTXO 面值直方图）是链公共数据。

## 结论

| 项 | 判定 |
|---|---|
| **二进制**（两个 tarball） | **GREEN**（钉死版本 + 静态审通过，见 §1） |
| **设计 v0.3** | **有条件 GREEN**：必须先满足 §3 的 M1–M6，才可派执行；其中 M1 是事实订正，M2–M4 是执行形状的硬要求 |
| **垫片（≤80 行）** | **未审**（J1 尚未投信箱）；§5 给出验收准则，J1 可照此写 |

## 1. 二进制审（静态，无执行）

### 1.1 完整性与打包
- 两个 tarball 从 registry 取回后本地算 sha512，与 Bettor 钉的 integrity **逐字节一致**：`@dotk/sdk-tx@1.2.0` `sha512-8LIon+AyCeLnRiZkGRYMsoJaWyW4vqQYdx8KOJy+xBsZuaT92rS6blbg5XkIdVqRV8/1gMqm8f5145/rUy5g9w==`（83,333 B，解包 324 KB / 61 文件），`@dotk/sdk@1.2.0` `sha512-IqbuWHFETYQ1NkfyeNBSLP0YaKEAjyOE0p2FNVt3X08l6yvAzl2fH355IRShZ5y+iTIhzaPCiwKwb4mNnn1Uow==`（71,135 B）。`npm view` 的 dist.integrity 与之相同。
- **无安装期生命周期脚本**：`scripts` 里只有构建/测试/格式化与 `prepack`（发布者侧），**没有 `preinstall`/`install`/`postinstall`/`prepare`**。运行时依赖仅 `@noble/curves ^2.0.1`、`@noble/hashes ^2.4.0`（sdk 只要 hashes）。
- `dist/` 无压缩/混淆：最长行 413 字符；`.js` 与 `.d.ts`/`.js.map` 一一对应。

### 1.2 宿主 API 使用（对全部 dist `.js` 逐词扫描）
- 网络只有两处：`sdk/dist/api.js` 的 `fetch`（目标 = 调用者给的 `api` 选项，默认 `deployments.js` 里的 `https://api.dotk.name`；`fetchFn` 可注入）；`sdk-tx/dist/wrpc.js:47` 的 `new WebSocket(url)`（**仅** `WrpcJson.connect(url)` 显式调用时才有，且 url 由调用者给；我们走 `nodesOver(wasmClient)` 不会触及）。dist 里全部 URL 字面量只有 `dotk.name`、`api.dotk.name`、`api-tn10.dotk.name`。
- **没有**：`fs`、`process`/`process.env`、`child_process`、`eval`、`new Function`、`require`、动态 `import()`、`globalThis`/`window`/`document`、`Proxy`/`Reflect`、`__proto__`/`setPrototypeOf`、对原型的写入；`setTimeout` 只用于请求超时。所以：**无外传通道（除上述 fetch）、无文件写入、无环境变量读取**。
- 节点 RPC 面（经 `nodesOver(wasmClient)`）只有 4 个方法：`getServerInfo`、`getUtxosByAddresses`、`getFeeEstimate`、`submitTransaction`（`sdk-tx/dist/adapters.js`）。

### 1.3 签名与交易形状
- **SDK 不接触私钥**：`ports.d.ts` 里的 `Signer.sign(request)` 是一个"签名预言机"，收到 `{txJson, fundingInputs, ownerSigInputs}`，按输入下标签、SIGHASH_ALL，回交易。`sign.js` 只接受 `acceptWalletSig`（65 字节、末字节 = SIGHASH_ALL、非全零占位）与 `acceptFundingSigScript`（恰 66 字节的单 push）。**注册流程 `commit.request.ownerSigInputs` 与 `reveal.request.ownerSigInputs` 都是 `[]`**（`registrar.js` `planRegistration`）——即注册全程**只有普通资金输入需要签名，没有任何 covenant 席位签名**。
- 注册两笔交易（`register.js`）：commit `splitIntent` 输入 = 覆盖 blake3(name) 的 gap UTXO（covenant，无签名，只有 witness）+ 资金输入；输出 = 下 gap（1 KAS）、上 gap（1 KAS）、newborn PENDING deed（bond 1 + deposit 36 = **37 KAS**，全部 covenant 输出）+ 找零→账户地址。reveal `activateIntent` 输入 = PENDING deed（witness，无签名）+ commit 的找零；输出 = ACTIVE deed（bond 1 KAS，covenant）、**devfund 档位费**、找零→账户地址。
- **除找零外，SDK 不会给任何其他地址付款**：`assemble.js` 的 `build` 只追加一个 `changeScriptPublicKey`（由 `account.address` 推出）输出；手续费上限 `MAX_FEE_SOMPI = 5 KAS`（`assemble.js`），超即抛。
- **付款方与持有方可分离**：`planRegistration` 用 `account.ownerType/account.owner` 组 claim（`splitIntent/activateIntent`），用 `account.address` 取资金与找零（`planRegistration`），二者是 `Account` 的独立字段（`ports.d.ts`），传 `{address: 临时付款地址, ownerType: 持有方, owner: 持有方公钥}` 即可（回答 J1 问 b）。
- claim = `blake3(name ‖ ownerType ‖ owner32)`，key = `blake3(name)`（`names.js`）。**commit 交易的输入 witness（`split(key, claim, …)` 的实参，`register.js`）在 mempool/链上公开 key 与 claim，claim 把 owner 永久绑定**（见 M1）。

### 1.4 我做的独立链上核对（本机主网节点，只读）
- 包内清单 `mainnet/genesis.js`：`registryCovenantId=ee2128c0…21de`、version 6、`devfund_spk=207ee85a…6bac`、`fee_5plus=3,800,000,000`、`bond=100,000,000`、**`deposit=3,600,000,000`**、`gap_value=100,000,000`、`t_evict=3000`。
- **`devfund_spk` 是否真的是链上收档位费的地址**（一个被篡改的包可以把 38 KAS 指到别处，此项独立于 SDK 自己的报价）：把该 spk 转成地址，在我们自己的节点上 `getUtxosByAddresses`：3,496 个 UTXO，面值直方图 = 2,979 × 38 KAS、299 × 248 KAS、145 × 998 KAS、36 × 3,998 KAS、35 × 1,998 KAS（恰是清单的五档 `fee_5plus/4ch/3ch/1ch/2ch`），另有 2 × 36 KAS（与 deposit 面值相同，疑为被驱逐押金）。⇒ **包内 devfund 目的地与档位价格得到链上独立佐证**（`scripts/dotk_devfund_check.mjs`）。

### 1.4b 已知的文档/代码不一致
`Registrar.register()` 的注释说"reveal 在 commit 发送前已签名"，**代码不是**：`register()` 依次 `await this.submit(commit)`、再 `await this.submit(reveal)`，`submit` 每次调用才 `signer.sign`。因为垫片签名是毫秒级，无实质影响，但**不要依赖那句注释**；我们的执行应自己编排：`planRegistration` → 校验 → 先对 commit、reveal 两个 request 都签好 → 依次提交（M4）。

### 1.5 限制
无源码仓库（`github.com/supertypo/dotk` 404），只审了发布的编译产物；未审 `@noble/*`（业界通用，但须钉版本与 integrity，M2）；**未审 dotk 链上 covenant 字节码本身**（清单里的模板）——这是名字资产的固有风险，设计已按"买品牌资产的正常风险"如实写了。

## 2. 对 Bettor 两个专点的判断

**(a) 临时钥匙落 `scratch/` 临时文件这段窗口**：**可接受，带条件**。理由：有钱的窗口只有"充值落链 → sweep 落链"，之后钥匙无价值，删除是整洁而非安全；上限 47 KAS。条件：① 该文件的 ACL 只留当前用户，**且任何 agent 不得读它/打印它**（NTFS 同用户 ACL 挡不住同机的 agent 会话，所以靠纪律与"垫片永不打印"）；② **先做完全部预检再生成钥匙**（见 M4 的空跑），窗口以分钟计；③ sweep 落链、节点 `getUtxosByAddresses` 证空之前**不得删文件**（否则中断即滞留资金）；④ 垫片进程崩溃时的恢复路径 = 再跑垫片的 `sweep` 读该文件；⑤ 见 M2：跑垫片的进程不得持有任何别的密钥。

**(b) 垫片新增"生成钥匙 + sweep"两个功能有没有新攻击面**：有，三点。① **sweep 的目的地址是输入**：垫片必须**自己构造** sweep 交易（输入 = 节点上临时地址的全部 UTXO，输出 = 单笔到目的地址，手续费 ≤ 上限如 0.05 KAS），**永不签外部给的 sweep 交易**；目的地址由操作者从 console 的 relay 地址读出、两方（KANet-UI + Bettor）各自核对首末 8 位才可执行——目的地址若来自命令行参数被注入改写，47 KAS 全失。② **sweep 不得在 commit 已上链而 reveal 未完成时运行**：reveal 需要 commit 的找零输出作资金，sweep 会把它花掉，PENDING 的 36 KAS 押金随即被驱逐。垫片要有"注册进行中"状态位，sweep 见此状态拒绝。③ keygen 的熵源必须是 CSPRNG（`crypto.randomBytes`/kaspa-wasm 的 `Mnemonic.random`），不得用 `Math.random`；钥匙对象不进日志/异常消息。

**(c) 新问："vendored kaspa-wasm Generator 何时把一笔 transfer 拆成多笔"**（KANet-UI 标"待 NWT 核"）：我用与主网 console 转账同一份 vendored kaspa-wasm，离线（合成钥匙、无 RPC、不广播）跑了 `Generator`（`scripts/generator_split_probe.mjs`，输出 `run-output-generator-split.txt`），转 47 KAS：
| UTXO 形状 | 结果 |
|---|---|
| 单个 100 / 78 / 60 KAS | **1 笔**（1 入 2 出，mass 2,036，手续费 0.032 KAS） |
| 单个 47.5 KAS（找零 0.5） | 1 笔（storage 主导，mass 21,371） |
| 单个 47.05 KAS（找零 0.05） | **失败**：`Storage mass exceeds maximum`（不拆，直接报错） |
| 20 个 5 KAS | 1 笔（10 入） |
| 120 个 0.5 KAS（共 60） | **3 笔**（88 入批 mass 98,990 → 7 入 → 最终 2 入 2 出） |
| 400 个 0.2 KAS | 报错 `Mass calculation error` |
结论：拆分条件是**输入过多**（约 >80–88 个输入触到 ~100,000 mass 上限，逐级归并），不是金额；找零过小会直接失败而非拆分。relay 转账路径（`kasia-relay/src/lib/transaction.mjs` 约 195–213 行）先挑"能满足 `S×1.65+FEE_RESERVE` 的最小单个 UTXO"，有则**单输入单笔**（对 47 KAS 即 ≥≈77.6 KAS 的单个 UTXO），没有才用全部 UTXO 交给 Generator。所以：若 `83c9be27` 有单个 ≥≈78 KAS 的 UTXO ⇒ 单笔；否则要看条目数。**核验方式**：多笔拆分时中间批交易付给发送方自己，最后一笔才到目的地址；判据不看"几笔"，看**最终目的地址上节点 UTXO 总额 = 47 KAS**（并列出全部 txid 都已落链）。

## 3. 设计 v0.3 必须满足的条件（GREEN 的前提）

**M1 事实订正（设计文本与 SDK 行为不符，会误导执行者）**
- 抢注窗口**不在 reveal**。reveal 不需要签名，但 claim（`blake3(name‖ownerType‖owner)`）在 commit 时已把 owner 永久绑定，activate 必须给出与 claim 相符的 `(name, ownerType, owner)`——旁观者从 mempool 看到 reveal 也只能替我们**完成**这次注册，改不了 owner（这一点依据 SDK 注释与 README 的表述——"every check here is one the covenant repeats"；**未逐字节码核验 covenant 确实强制 claim 相符**，属 §1.5 的未审面，M4-3 的独立复算与 3.5 的落链核验是它的兜底）。真正的窗口在 **commit 上链前的 mempool**：commit 输入的 witness 里带着 `key=blake3(name)` 与 claim，对"kanet"这类候选词可字典反查，并用更高手续费用**同一个 gap 输入**替换我们的 commit（RBF）抢先注册。窗口是从广播到确认的秒级；缓解 = 广播即刻确认前不留人为间隙、feerate 取高一档。**残余风险接受，但设计里要写对位置**。
- **损失上限不是"押金 1 KAS"**：deposit = **36 KAS**（`genesis.js`），commit 落链后 PENDING deed 里锁着 bond 1 + deposit 36 = 37 KAS；`t_evict` = 3000 DAA（10 BPS ≈ 300 s）内未 activate，deposit 归驱逐者。所以中断的损失是 36 KAS 量级（J1 页是对的，Bettor 页"只损失押金"读者会以为 1 KAS）。
- **§3 第 4 点"任何一步对不上数字就停，不重试"要分阶段**：**commit 上链前**任何不符 ⇒ 停（零损失）；**commit 上链后** ⇒ **不能停**，必须在 `t_evict` 内完成 reveal（预算 ≤ 3 分钟，用节点 `virtualDaaScore` 计时）。备用件：commit 前就备好**第二份更高 feerate 的 reveal**（同 claim，资金取 commit 找零，已签好），以及 SDK 的 `planActivate`（"从另一枚币完成"）作兜底——SDK 明确说"一个半落地的注册，任何持有 `(name, ownerType, owner)` 的人都能完成它"，我们持有全部三项。

**M2 进程隔离（否则"上限 47 KAS"的前提不成立）**
跑垫片+SDK 的进程**不得**能碰到 console 密钥与库：同机同用户下，`kanet.mainnet.env`（含 `CONSOLE_ENCRYPTION_KEY`）与 console 库文件都是可读的。要求：① 独立子进程、环境变量清空（只留 `PATH`/`SystemRoot`），**不传** `CONSOLE_ENCRYPTION_KEY`、`ADMIN_SECRET_*`、`DB_PATH`；② 用 Node 24 的权限模型收紧：`node --permission --allow-fs-read=<vendored 包目录>,<垫片目录>,<kaspa-wasm 目录> --allow-fs-write=<唯一的临时钥匙目录>`（不给 `--allow-child-process`/`--allow-worker`/`--allow-addons`）。我在本机 Node v24.14.1 实测：越权读 `kanet.mainnet.env` → `ERR_ACCESS_DENIED`，越权写、`child_process` 均被拒，白名单目录内读正常；**权限模型不管网络与 `process.env`**，所以环境变量必须由父进程清空；③ 供应链：把两个 tarball（已核 sha512）与 `@noble/curves`、`@noble/hashes` 的确切版本 tarball（同样核 integrity）**vendor 到白名单目录**，`npm ci --ignore-scripts` 或直接解包，**不要在 da9 上 `npm install @dotk/sdk`（会解析 `^` 范围并可能引入未审版本）**。

**M3 RPC 门面 + 提交门**
不要把真实 kaspa-wasm `RpcClient` 直接交给 SDK。给 `nodesOver(client)` 一个只含 §1.2 那 4 个方法的**门面对象**：`getServerInfo`/`getFeeEstimate` 直通；`getUtxosByAddresses` 直通（只读）；`submitTransaction` **只放行垫片已批准并签过的 txid**（垫片登记）——即使 SDK 被替换或有 bug，也无法经生产节点广播任何未经批准的交易。节点须有 `--utxoindex`（已核：`hasUtxoIndex=true`、`isSynced=true`）。

**M4 独立的 predict-then-verify（把"与 planRegistration 报价逐项对上"升级为"与独立计算对上"）**
报价来自同一个 SDK，属同一信任域，**不算独立**。垫片签名前必须用**自己的、不来自 SDK 输出的**数据核：
1. **收款方硬编码常量**：devfund spk `207ee85afca8273d94739037e7b4c736fcfc9e12d5c468eea5ce7b89181b49386bac`，档位费 `fee_5plus = 3,800,000,000`（§1.4 已在链上佐证）；registry covenant id `ee2128c0…21de`。
2. **逐笔期望表**（金额来自清单，不来自 SDK 报价）：commit 输出 = {gap 1 KAS, gap 1 KAS, deed 37 KAS，均带 registry covenant id} + 恰一个找零→临时地址；reveal 输出 = {ACTIVE deed 1 KAS 带 covenant id, devfund 38 KAS} + 恰一个找零→临时地址。除找零外**任何别的输出 ⇒ 拒签**。自临时地址净流出：commit 38（39 出 − 1 入 gap）、reveal 2（39 出 − 37 入 deed）= 40 KAS + 矿工费；矿工费 ≤ 5 KAS 上限，总流出 ≤ 45。
3. **owner 绑定独立复算**（防"ownerKey 被改写"——这才是被篡改的 SDK 对我们最值钱的攻击，损失不是 47 KAS 而是名字落到别人名下）：垫片自己按 `names.js` 的定义算 `key=blake3(bare)`、`claim=blake3(bare‖ownerType‖holderPubkey)`（几行代码，独立于 SDK 的实现），再用**模板函数**重构 newborn deed 与 ACTIVE deed 的 spk，与 commit 输出 2、reveal 输出 0 的 spk 逐字节比对；持有公钥来自 Owner 离线脚本打印的 x-only 公钥（公开值）。
4. **输入事实取自我们自己的节点**：资金输入的 outpoint/金额/spk 由节点 `getUtxosByAddresses` 取，必须属于临时地址；gap 输入与 PENDING deed 输入在节点上核存在、带 registry covenant id、spk 等于模板派生；tx 的 version、lockTime=0、payload 空、所有 sequence 为 0；输入个数与来源之外不得有多余输入。
5. **拒绝任何 `ownerSigInputs` 非空的请求**（注册流程里它恒为空；`supportsOwnerScheme` 因规划阶段要求必须返回 true，但垫片**没有**持有钥匙，遇到席位签名请求一律拒）。
6. **空跑**：在充值**之前**，用门面对 `getUtxosByAddresses(临时地址)` 返回一枚**合成的大额资金 UTXO**（其余读取全真），让 `planRegistration('kanet.k')` 产出真实形状的 commit+reveal（不签、不广播），跑上面全部校验并留存输出。这样能在动用任何资金前发现形状/价格/owner 绑定问题。
7. **顺序**：commit、reveal 两个 request 都签好之后**再**提交 commit，随即提交 reveal（提交 reveal 不等 commit 确认——它以 commit 的 txid 为输入，节点内存池接受链式未确认交易；此点请 J1 在空跑里用 `getMempoolEntry`/提交前 `getMempoolEntry` 语义确认，若节点拒绝链式则改为"确认一个块后立即提交 reveal"并把预算算进 t_evict）。

**M5 sweep**：见 §2(b) 三点；另 sweep 的目的地址必须与 3.2 转出时的源 relay 地址逐字符相等（垫片在 3.2 记录"资金来自哪个地址"由 UTXO 的父交易输入推得，而不是让人再输一遍）。

**M6 持有钥匙（v0.3 已离线，我同意，并补三条）**
- **恢复演练**要证明"能签"，不止"地址一致"：verify 模式要同时比对 `(ownerType, owner)`（不只 bech32 地址），并且应用**与 SDK 无关的另一实现**派生一次（例如用 rusty-kaspa CLI 钱包或 KasWare/Kastle 对同一助记词派生地址，与脚本输出比），避免"同一份 kaspa-wasm 代码两侧自证"。
- **注册后加一次"签名演练（不广播）"**：在 Owner 终端用恢复出的钥匙对 `planTransfer('kanet.k', <任意地址>)` 生成的 request 签名，让 SDK 的 `applySignatures`/`verifySignature` 验过，只打印布尔，**不提交**。这证明"这把钥匙确实能动这张地契"，比地址相等强得多（`activate` 没有签名参数，若 ownerKey 编码有误——字节序/奇偶/类型——名字会被永久锁死而地址核对看不出）。
- 生成/verify 脚本运行环境：da9 上有远程桌面软件（RustDesk），助记词会出现在屏幕上——Owner 在**本机物理终端**运行、运行前确认无远程会话、运行后清屏与滚动缓冲；脚本不写文件、不联网（设计已写）。

## 4. 建议项（不阻塞）
- 每周核验改为**订阅**：对 deed 的 outpoint 用节点 `notifyUtxosChanged`（或每小时轮询）报警，周频对"被 release/transfer"的检测窗口太长（虽然事发后无法撤销，但可以立刻公告/处置）。
- 3.0b 先做**读路径空跑**：用 SDK 只读侧对两三个别人已激活的名字跑 `deedOf`（api.dotk.name + 我们的节点，无写、无钥匙），验证"SDK↔门面↔我们的节点"整条读链通、约定（x-only 编码、模板派生 spk）与链上现状一致。
- `kanet.k` 收款：records（网址/头像）存在 card（`sdk-tx` README 明写是 deed 旁的 card 输出、transfer 所铸）——链上，但要"改记录"就是一次 transfer，需要持有钥匙；不要为了改记录把钥匙拿到线上。

## 5. 垫片验收准则（供 J1 写，审时逐条对）
≤80 行只是上限，不是目标；必须：keygen 用 CSPRNG；钥匙只在进程内存与一个 ACL 受限的文件，永不打印；`sign` 仅对 `fundingInputs` 下标签、遇 `ownerSigInputs` 非空即拒；签名前跑 M4 的 1–4 项并**打印通过/失败布尔与所比对的字段名，不打印密钥**；`sweep` 自建交易、目的地址由参数给且与记录的资金来源一致、自身手续费上限、"注册进行中"时拒；所有对节点的读取取自门面；无 `fs` 之外的副作用；不 import 任何 console 模块。

## 6. 未做 / 未验证
垫片与 J1 侦察页（未到）；dotk covenant 字节码本身；`api.dotk.name` 的任何响应（本审没连）；空跑（M4-6）与链式未确认交易被节点接受（M4-7）需要 J1/KANet-UI 在执行侧验证；真实 `planRegistration` 的报价（需要 api 与资金 UTXO 的空跑）。
