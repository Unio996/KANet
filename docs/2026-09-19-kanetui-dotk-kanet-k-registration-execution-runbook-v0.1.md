# 执行 runbook：注册 dotk 名字 `kanet.k`（主网）v0.2 草稿

> **Status**: CURRENT
>
> 起草 KANet-UI · 2026-09-19 · 依据 `docs/2026-09-19-bettor-dotk-kanet-k-registration-and-custody-design-v0.1.md` **v0.4**（含 §6 M1–M6，下称"设计页"）与 NWT 审 `docs/provenance/2026-09-19-nwt-dotk-design-and-binary-review/README.md`（`03a1bb3b`，下称"NWT 审"）· **草稿：只写不执行；已作为草稿提交到侧分支（提交 ≠ 定稿 ≠ 可执行）；等垫片过审 + 充值前空跑通过（= 设计完整 GREEN）后定稿**。文件名保留 `v0.1`（账本 (1512) 已按此名引用），内容版本以本页首行为准。
>
> **本次收尾提交（2026-09-19，主网机器 9/19 死机重启后，KANet-UI）相对上一草稿的改动——只有三类**：① 折入 J1 侦察 a–e 与离线钥匙脚本 v1 已交付的**公开**事实（两包 integrity、`ownerSigInputs` 非空即拒、reveal 无签名、`deedAddress` 纯本地推导、脚本 v2 两项加强），仍未交付的（垫片启动形态、空跑答案、deed 状态解码）**继续标〔待 J1〕不猜**；② 新增 **1.16 系统提交内存余量检查**（依据账本 (1531)：死机根因 = AI 推理进程耗尽提交内存 → 硬复位；阶段 B 中若整机复位，`t_evict ≈ 300 s` 内重启恢复不了，deposit 36 KAS 即失——所以进 3.3 前要读提交内存余量；阈值是**提案，待 Bettor 定**）；③ §3.1 与 J1 脚本 v1 的落差如实标出（脚本在 J1 本机、不在本机；见 3.1 的〔待定〕）。**除此之外正文未动**。
>
> **v0.2 相对 v0.1 的改动（Bettor 对等消息 + 设计 v0.4）**：① 新增 **3.1b 充值前空跑（人审）**，3.3 改为**真跑自动校验**（不符即拒签，commit 与 reveal 之间无人工环节）；② 垫片作**子进程**、环境清空、Node 24 `--permission` 白名单、SDK 与 `@noble/*` 由 J1 vendor、**da9 上不 `npm install`**（M2）；③ 押金是 **36 KAS**（不是 1 KAS），抢注窗口在 **commit 上链前的内存池**（M1）；④ **两段不同的中止规则**：commit 提交前"不符即停"，commit 提交后"不许停、≤3 分钟内 reveal、备第二份高 feerate reveal、`planActivate` 兜底、禁 sweep"（M1/M5）；⑤ sweep 目的地址**由记录推得、不重输**，两方核首末 8 位（M5）；⑥ 持有钥匙加 M6 三条（恢复演练比 `(ownerType, owner)` + 独立实现、注册后签名演练自转、物理终端）；⑦ 垫片文件与 vendored 包 sha256 **执行前后各算一次、须相等**；⑧ §4 风险段按 v0.4 重写。**（v0.5 / NWT 预读 RB-1…RB-5，设计 M7）**：门面白名单 **5 个方法**（加 `submitTransactionReplacement`）；替换只能由垫片调该方法、feerate 按 contextual mass 严格高于第一份、只在"已进 mempool 但迟迟不打包"时替换，被拒/丢弃则普通提交；**链式未确认交易被接受**、reveal 紧跟 commit 立即提交为**默认流程**（J1 空跑复核）；commit 用高 feerate 抬高被替换门槛（门面对 `getFeeEstimate` 乘倍数，5 KAS 封顶，空跑打印实际 fee）；哈希基线加 `node.exe`；探针只证 fs/子进程/环境，"无外传"靠 `dist` 静态审 + 哈希不变（§4 明写为未证明面）。**Bettor 对开放点的裁定已落入正文**：阶段分界 = 垫片**先落盘"注册进行中"位再调 `submitTransaction`**，崩溃恢复读该位决定能否 sweep；临时钥匙目录 fs-read 与 fs-write 同给；第二份 reveal **替换、不并行**；所有重试与替换在 `t_evict` 前 600 DAA（commit 后 2400 DAA）停手并回报。各级等待阈值仍待 J1 空跑回答"链式未确认交易是否被节点接受"。
>
> **执行门（页首必读，不得把"页写好了"读成"可以执行了"）**：
> ① 本页 → J1 垫片过审 + 3.1b 空跑通过 → 设计完整 GREEN → 本页定稿并提交 → Bettor 分步 GO；
> ② **三处 Bettor GO 缺一不得越过**：〔G1〕进 §3.1 之前；〔G2〕**3.1b 空跑经 Bettor 与 NWT 审过之后**、§3.2 出资前；〔G3〕启动真跑（3.3+3.4 同一进程）前；
> ③ 本页任何一步的"执行"都是钱路动作（D-011 内部双审）；本页的读数命令全部只读，可以在 GO 之前预跑；
> ④ **§3.1 全程由 Owner 本人完成，KANet-UI 不在场、不看屏幕、不接触助记词。**
>
> **写作依 D-021**：不写密钥值、助记词；不写持有人与地址的对应；不写任何 relay 的精确余额；金额（47 KAS 等）是操作参数，可写。地址在执行时现读，不硬编码进本页。relay 只以 UUID 前 8 位指代。
>
> **〔待 J1〕标记**：SDK 的具体函数名、垫片的命令行与启动形态、deed `owner` 的读取解码方式，J1 的侦察与垫片尚未交付，本页**不猜**；凡依赖它们处标〔待 J1〕并写明"需要它回答什么"。定稿时逐一替换。

## 0. 总图与不变量（每一步都要对得上）

| 角色 | 是什么 | 在哪里 | 谁碰 |
|---|---|---|---|
| 出资源 | 主网 relay `83c9be27`（名 `NWT`） | console 内，**已在跑** | 只经 `POST /api/relay/:id/transfer`；私钥不出 console |
| 垫片 + SDK | J1 的 signer 垫片、vendored `@dotk/sdk@1.2.0` `@dotk/sdk-tx@1.2.0`、`@noble/*` | **独立子进程**：环境清空、`--permission` 白名单、无 child-process/worker/addons；da9 上**不 `npm install`** | KANet-UI 启动；私钥只在其内存与 ACL 受限的临时钥匙文件 |
| 临时付款钥匙 | 垫片内 CSPRNG 生成 | 垫片内存 + `scratch\dotk\keys\` 下一个 ACL 只留当前用户的文件；**不进 console 库**；**先做完全部预检（含空跑）再生成** | 任何 agent 不得读、不得打印 |
| 持有钥匙 | Owner 离线生成、抄两份 | **不在任何机器上**；console 无此行 | 仅 Owner；本页只接收它的**地址与 x-only 公钥**（公开信息） |

**不变量（任一被破坏 ⇒ 按 §5 中止）**：
1. 未审的 SDK/垫片进程里出现的私钥只有临时付款钥匙；敞口 ≤ 47 KAS；该进程读不到 console 密钥与库（权限白名单 + 清空环境，§1.13 探针证明）。
2. 持有钥匙的助记词从不出现在任何 agent 的工具输入输出、任何文件、日志、账本、提交里。
3. 主网 console 全程不重启；`rpc-overview` 在出资前后各读一次；console 进程 `CreationDate`（完整日期时间）前后不变。
4. 出资 relay 在窗口内无其他转账（以 Bettor 的 G2 消息为准，见 §1.5）。
5. **commit 提交之前**任何一步失败都不重试、先读链；**commit 提交之后不许停**（§3.4 阶段 B）。
6. 垫片文件、全部 vendored 包与 **`node.exe` 自身**的 sha256 在执行前后**各算一次，必须相等**（§1.14 / §3.6）。"无外传"这一层**不由探针证明**，依赖 NWT 对 `dist` 的静态审 + 上述哈希执行前后不变（见附录 B 与 §4）。

## 1. 前置检查（只读；可在 GO 之前预跑；任一不符即停，不进 §3.1）

在 `D:\kanet-tn12` 用 PowerShell；不在 PowerShell 里调 `bash`。**先建**：附录 A 的一次性读链脚本 `scratch\_dotk_read.mjs`（gitignored，只打印计数与布尔）与工作目录 `scratch\dotk\`（`New-Item -ItemType Directory -Force scratch\dotk, scratch\dotk\keys`；本页所有中间文件——地址、公钥、txid、outpoint 快照、临时钥匙文件——都放这里，整个目录被 `.gitignore` 的 `scratch/` 覆盖，不入库）。

| # | 检查 | 命令 | 期望 |
|---|---|---|---|
| 1.1 | 生产检出分支 | `git -C D:\kanet-tn12 branch --show-current` | `bshard-m3-deploy`（禁切分支） |
| 1.2 | 主网 console 活且记基线 | 见 `C1.2` | 恰 1 个；**记下 PID 与 CreationDate** |
| 1.3 | 18 个 relay 全在线 | `(Invoke-RestMethod http://127.0.0.1:3202/api/system/rpc-overview).summary` | `total=18 connected=18 reconnecting=0 unreachable=0` |
| 1.4 | 出资源核对（名 + 前 8 位） | 见 `C1.4` | 名 `NWT`，`ok=True`。完整 UUID 与源地址执行时从 rpc-overview 现读，不手打 |
| 1.5 | 出资 relay 冻结 | **以 Bettor 的 G2 消息为准**：他在账本与消息里宣布"窗口内 83c9be27 不做其他转账、驱动开关保持 0"；我方只核驱动开关仍为关/未设（同 D-023 runbook §5.1 的断言块） | G2 消息已到且开关全关 |
| 1.6 | 热钱包监控只读读数 | 见 `1.6` 命令块 | 出资 relay 单 relay 与 18 relay 总额均**不超限**，余量 ≥ 1 KAS（只打印布尔） |
| 1.7 | 源地址 UTXO 形状 | `node scratch\_dotk_read.mjs shape relay:83c9be27 4700000000` | `utxos_ge_minSafe >= 1`（单输入路径成立；NWT 审 §2(c)：拆分条件是输入过多 >80–88 个，不是金额）；**为 0 ⇒ 回报 Bettor 再定，不进 §3.2** |
| 1.8 | ADMIN_SECRET_FUNDS 已设且生效 | 见 `1.8` 命令块（零转账探针） | 无 header ⇒ 403；带正确 header 空 body ⇒ **400** "Recipient address (to) is required" |
| 1.9 | 节点同步 | `node scratch\_dotk_read.mjs daa` | `isSynced= true`；（节点有 `--utxoindex`，NWT 已核 `hasUtxoIndex=true`） |
| 1.10 | 供应链与垫片版本 | 〔待 J1〕vendor 目录的 **manifest**（每个包的名、确切版本、sha512 integrity）：`@dotk/sdk-tx@1.2.0`（integrity 前缀 `sha512-8LIon+…`，全值见 NWT 审 §1.1）、`@dotk/sdk@1.2.0`（前缀 `sha512-IqbuWH…`，全值见 J1 侦察页 §0 与 NWT 审，两方已一致）逐字节一致才算；运行时依赖 J1 侦察称 `@dotk/sdk` 只依赖 `@noble/hashes`、`sdk-tx` 的 wasm 由调用方注入（即用 da9 已有的 vendored kaspa-wasm 1.1.0）——**vendor 里出现别的运行时依赖 ⇒ 不符**；`@noble/curves`（若有）、`@noble/hashes` 的**确切版本**；垫片文件路径 | manifest 与 NWT 审/设计页一致；**垫片文件哈希 == 提交给 NWT 审的那一份**；**da9 上无 `npm install` 痕迹**（`node_modules` 不存在于白名单目录；`Test-Path <vendor>\node_modules` 应为 False，若 vendor 以 node_modules 形态解包则以 J1 说明为准） |
| 1.11 | 垫片硬编码常量与 NWT 清单一致（M4） | 见 `1.11` 命令块 | 三个布尔全 True：devfund spk、`fee_5plus = 3,800,000,000`、registry covenant id |
| 1.12 | 名字仍空闲 | 用**我们自己的节点**读 gap UTXO 仍在（〔待 J1〕读法）；`api.dotk.name/v1/names/kanet` 仅对照 | 未被注册 |
| 1.13 | **隔离探针**（M2）：以与真跑**完全相同**的启动设置跑一个无害探针 | 见附录 B | `env_keys` 只有 `PATH`、`SystemRoot`（Windows 大小写按实际，不得含 `CONSOLE_ENCRYPTION_KEY` / `ADMIN_SECRET*` / `DB_PATH`）；读 `kanet.mainnet.env` 与 console 库均 `ERR_ACCESS_DENIED`；`child_process` 被拒 |
| 1.14 | 哈希基线 | 见 `1.14` 命令块 | 写出 `scratch\dotk\hash-before.txt`（垫片文件 + **`node.exe`** + vendor 目录每个文件的 SHA256）；§3.6 后重算须逐行相同 |
| 1.15 | 无链上待决的旧动作 | `shape` 两次读（间隔 ≥ 30 s）UTXO 数稳定 | 稳定 |
| 1.16 | **系统提交内存余量**（依据 (1531) 9/19 死机复盘；阈值为**提案，待 Bettor 定**） | 见 `1.16` 命令块（只读，只打印百分比与布尔） | 已提交内存占比 **≤ 70%**（提案值；P3 的报警线是 85%，起跑线应更低）；**且 §3.3 启动前一刻再读一次**。原因：阶段 B 中整机复位 = 垫片进程消失，`t_evict ≈ 300 s` 内机器回不来 ⇒ deposit 36 KAS 归驱逐者；这个风险不在垫片的隔离范围里 |

```powershell
# C1.2
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'src.index.js' } | Select-Object ProcessId, @{n='Created';e={$_.CreationDate.ToString('yyyy-MM-dd HH:mm:ss')}}
# C1.4
(Invoke-RestMethod http://127.0.0.1:3202/api/system/rpc-overview).relays | Where-Object { $_.id -like '83c9be27*' } | ForEach-Object { $_.name; $_.ok }
```

```powershell
# 1.6  只读：比较余额与上限，只打印布尔与"余量是否 ≥1KAS"，不打印数值
$envf='D:\kanet-tn12\kanet.mainnet.env'
$per=[double]((Select-String -Path $envf -Pattern '^RELAY_HOTWALLET_PER_RELAY_MAX_KAS=(.*)$').Matches[0].Groups[1].Value.Trim())
$tot=[double]((Select-String -Path $envf -Pattern '^RELAY_HOTWALLET_TOTAL_MAX_KAS=(.*)$').Matches[0].Groups[1].Value.Trim())
$rows=(Invoke-RestMethod http://127.0.0.1:3202/api/system/rpc-overview).relays
$sum=0.0; $src=$null
foreach($r in $rows){ $b=[double](Invoke-RestMethod ("http://127.0.0.1:3202/api/relay/{0}/balance" -f $r.id)).balance; $sum+=$b; if($r.id -like '83c9be27*'){$src=$b} }
"source over per-relay cap: $($src -gt $per)  margin>=1KAS: $([math]::Abs($src-$per) -ge 1)"
"sum over total cap: $($sum -gt $tot)  margin>=1KAS: $([math]::Abs($sum-$tot) -ge 1)"
```

```powershell
# 1.8  资金闸探针：零转账。Secret 只进变量，不回显
$s=((Select-String -Path D:\kanet-tn12\kanet.mainnet.env -Pattern '^ADMIN_SECRET_FUNDS=').Line -split '=',2)[1].Trim()
$id=((Invoke-RestMethod http://127.0.0.1:3202/api/system/rpc-overview).relays | ? { $_.id -like '83c9be27*' }).id
$uri="http://127.0.0.1:3202/api/relay/$id/transfer"
try { Invoke-RestMethod -Method Post -Uri $uri -ContentType 'application/json' -Body '{}' } catch { "no-header status: " + $_.Exception.Response.StatusCode.value__ }          # 期望 403
try { Invoke-RestMethod -Method Post -Uri $uri -ContentType 'application/json' -Headers @{'X-KANet-Admin-Secret'=$s} -Body '{}' } catch { "with-header status: " + $_.Exception.Response.StatusCode.value__ }  # 期望 400
Remove-Variable s
```

```powershell
# 1.16  只读：系统已提交内存占比（Win32_OperatingSystem 的虚拟内存 = RAM + 页面文件，即"提交上限"）；只打印百分比与布尔，不改任何东西
$os = Get-CimInstance Win32_OperatingSystem
$limitKB = [double]$os.TotalVirtualMemorySize; $freeKB = [double]$os.FreeVirtualMemory
$pct = [math]::Round(100 * ($limitKB - $freeKB) / $limitKB, 1)
"commit_used_pct= $pct   le_70= $($pct -le 70)   ge_85= $($pct -ge 85)"
# 对照读（可选）：性能计数器 "% Committed Bytes In Use"
(Get-Counter '\Memory\% Committed Bytes In Use').CounterSamples[0].CookedValue
# 谁占着（只列名字与私有内存 GB，不动它们；AI 推理服务归另一台机的会话管，本页只读不管）
Get-Process | Sort-Object PrivateMemorySize64 -Descending | Select-Object -First 5 Name, Id, @{n='PrivateGB';e={[math]::Round($_.PrivateMemorySize64/1GB,1)}}
```

（1.16 的三行读数只读；`FreeVirtualMemory` 与性能计数器口径可能差几个百分点，以 Bettor 定的口径为准。若 `ge_85= True` ⇒ 不进 §3.2 出资、不进 §3.3；先回报 Bettor。）

（1.8 的 400 来自 `relay.js:544` 的收款地址必填校验，早于任何转账逻辑，**零副作用**——同 2026-09-14 种子转账执行页 v0.3 的正向探针。）

```powershell
# 1.11  垫片硬编码常量 == NWT 清单（只打印布尔）。$shim 〔待 J1〕；若垫片以别的编码存放常量，以 NWT 审时所用形式为准
$nwt='D:\kanet-tn12\docs\provenance\2026-09-19-nwt-dotk-design-and-binary-review\README.md'   # 若尚未合入生产检出，读 NWT worktree 同路径
$shim='<垫片文件路径〔待 J1〕>'
$src=Get-Content $shim -Raw; $doc=Get-Content $nwt -Raw
$spk=[regex]::Match($doc,'207ee85a[0-9a-f]{60}').Value
"shim has devfund spk: "        + ($spk.Length -eq 68 -and $src.Contains($spk))
"shim has fee_5plus 38 KAS: "   + ($src -match '3[_,]?800[_,]?000[_,]?000')
"shim has registry covenant id: " + ($src -match 'ee2128c0[0-9a-f]{56}')
```

```powershell
# 1.14  哈希基线：垫片文件 + node.exe + vendor 目录全部文件（不含临时钥匙目录）。$shim/$vendor 〔待 J1〕
$shim='<垫片文件路径〔待 J1〕>'; $vendor='<vendor 白名单目录〔待 J1〕>'
$node=(Get-Command node).Source                                # RB-3：node.exe 自身也要进哈希基线（同一个 node 跑探针与真跑）
$files = @($shim, $node) + (Get-ChildItem $vendor -Recurse -File | ForEach-Object FullName)
$files | Sort-Object | ForEach-Object { '{0}  {1}' -f (Get-FileHash $_ -Algorithm SHA256).Hash, $_ } | Set-Content scratch\dotk\hash-before.txt -Encoding ascii
"files hashed: " + $files.Count
```

**中止条件**：1.2 出现 0 个或多个 console 进程；1.3 非 18/18；1.5 无 G2 消息或驱动开关非关；1.6 任一超限或余量 < 1 KAS；1.7 为 0；1.8 无 header 不是 403 或带 header 不是 400；1.9 未同步；1.10 manifest 与清单不符或有 `npm install` 痕迹；1.11 任一为 False；1.12 名字已被占；1.13 任一隔离项不符；1.16 提交内存占比 > 70%（提案值）或 ≥ 85%。⇒ 停，回报 Bettor，不进入后续步骤。

## 2. 设计 §3.0 执行前核查——已答毕，本页只落"执行前再读一次"

设计页 §3.0 的三条结论（`83c9be27` 在跑、监控只杀进程不动资金、单输入一笔）是 2026-09-19 的读数；**执行当天必须再读**：§1.3（在跑）、§1.6（不超限）、§1.7（单输入形状）。UTXO 形状会变（`filterPendingUtxos` 排除近期花过的、其他动作会产生新 UTXO），所以 1.7 要在 **§3.2 转账前一刻**再跑一次。NWT 离线实测同一份 vendored kaspa-wasm：47 KAS 从单个 ≥ 77.6 KAS 的 UTXO 出 = 一笔；找零过小（约 0.05 KAS）会直接报 `Storage mass exceeds maximum` 而不是拆；**落链核验的判据不看几笔，看收款地址节点 UTXO 总额 = 47 KAS 且全部相关 txid 已落链**（3.2 据此写）。

## 3. 执行步骤（3.1–3.6）

每步四段：**前置 → 动作 → 验收读数 → 中止 / 回滚**。

### 3.1 持有钥匙——Owner 本人完成（KANet-UI 不在场、不看屏幕）

**门**：G1（Bettor GO）。

**动作（Owner 本人，**本机物理终端**；不在 RustDesk 等远程会话里做——da9 有远程桌面软件，助记词会出现在屏幕上，运行前 Owner 自己确认无远程会话，运行后清屏并清滚动缓冲）**：
1. 运行 J1 的离线脚本 `generate` 模式（不连网、不写文件、不读 env）；屏幕上助记词只出现一次，Owner **抄两份、分开保管**，把**地址与 x-only 公钥**（公开信息）交 Bettor。
2. 运行同脚本 `verify <地址>` 模式，两份抄底**各验一次**：比 `(ownerType, owner)`（不只是地址），并按 J1 脚本给出的步骤用**与 SDK 无关的另一实现**（rusty-kaspa CLI 钱包或 KasWare/Kastle）对同一助记词二次派生比对；每次只打印 `match=true/false`。

> **与 J1 脚本 v1 的落差（如实标出，不猜；J1 侦察页 / 脚本回执页 2026-09-19）**：
> - v1 已交付并 Bettor 通过：60 行、派生路径逐行复制 console `wallet.js:24-39`（含 base58 `slice(46,78)`）、**24 词**（console 自己生成的是 12 词；同 BIP39 seed 同路径，可互导入）、用与 console 同一份 vendored kaspa-wasm 1.1.0、`generate` / `verify` 各有正反自测；`verify` 隐藏输入。
> - **v1 只比地址**。Bettor 要的 v2 加强（`verify` 可选第二参数同时比对 x-only 公钥 = M6 的 `(ownerType, owner)`；给 Owner 的步骤加"同一 24 词导入 KasWare 或 rusty-kaspa CLI 钱包看地址是否相同"作独立来源）**尚未交付** ⇒ 上面第 2 条在 v2 到之前**只能做到地址比对**，`(ownerType, owner)` 比对与 sign-drill（3.5b）依赖 v2 / 垫片，仍〔待 J1〕。
> - **脚本位置〔待定，需 Bettor 拍〕**：J1 回执写的路径在 **J1 本机（不入库）**；本页 3.1 写的是"da9 本机物理终端"。两者不是同一台机器时，Owner 在哪台机器的哪个终端跑、脚本怎么到那里（拷贝后须核 sha256 与 vendored kaspa-wasm 的哈希 == 提交给 NWT 审的那份），**本页不猜，等 Bettor 定**。
> - 侦察页 b 的结论使这条更省事：**注册的 reveal 不带任何签名**（`registrar.d.ts:238-240`），持有钥匙从头到尾**不进 SDK、不进垫片**，只以 x-only 公钥出现在 `Account.owner`；所以它在注册期**不必**上任何联网机器（3.5b 的 sign-drill 是注册后的另一次离线动作）。
3. **任何 agent 不得运行该脚本，不得经 console `/relays/generate-mnemonic` 生成**（存进 console 会被 `startAll` 拉成进程）。

**KANet-UI 在这一步唯一做的事**（Owner 经 Bettor 报回后，仅用**公开信息**核对，不看任何助记词）：

```powershell
# 3.1-a  x-only 公钥 ↔ 地址一致（纯公开推导，不连网，同 relay.js:273-275 的写法）；两个值从 Bettor 转来的文件读，不手打
node scratch\_dotk_read.mjs pubmatch scratch\dotk\holder-pubkey.txt scratch\dotk\holder-address.txt
# 3.1-b  持有地址是全新的：UTXO 数 0
node scratch\_dotk_read.mjs count '@scratch\dotk\holder-address.txt'
```

**验收读数**：`pubkey_matches_address=true`；`utxo_count=0`；Owner 报"两份各 `match=true`、独立实现比对一致"（KANet-UI 不复验，复验需要助记词）。
**中止 / 回滚**：任一为否 ⇒ 不进后续；由 Owner 重新生成。此步不动任何资金，无回滚项。console 里**不建行**（自查：`SELECT COUNT(*) FROM relay_nodes` 只读计数仍为 18，无新名字）。

### 3.1b 充值前空跑（人审）——M4-6

**目的**：在动用任何资金、**也在生成真实临时钥匙之前**，发现形状、价格、owner 绑定问题（NWT：先做完全部预检再生成钥匙，窗口以分钟计）。
**前置**：§1 全部通过（含 1.13 隔离探针、1.14 哈希基线）；§3.1 已过（持有公钥文件在手）。
**动作**〔待 J1〕（垫片的"空跑"形态；以 1.13 同样的启动设置在子进程里跑）：门面对 `getUtxosByAddresses(空跑用一次性地址)` 返回一枚**合成的大额资金 UTXO**，其余读取全真；`planRegistration('kanet.k')` 产出真实形状的 commit 与 reveal（**不签、不广播**）；垫片跑 M4 的全部校验并**打印布尔与所比对的字段名**（不打印密钥）：
- 逐笔期望表（金额来自清单，不来自 SDK 报价）：commit 输出 = {gap 1 KAS, gap 1 KAS, deed 37 KAS（均带 registry covenant id）} + 恰一个找零→临时地址；reveal 输出 = {ACTIVE deed 1 KAS（带 covenant id）, devfund 38 KAS} + 恰一个找零；**除找零外任何别的输出 ⇒ 拒签**；净流出：commit 38 + reveal 2 = 40 KAS + 矿工费（≤ 5 KAS 上限）⇒ 总 ≤ 45；
- **owner 绑定独立复算**（最值钱的一道闸：被篡改 SDK 对我们最值钱的攻击是改写 `ownerKey`，损失是名字落别人名下）：垫片自己按 `names.js` 定义算 `key = blake3(name)`、`claim = blake3(name ‖ ownerType ‖ holderPubkey)`，用模板函数重构 newborn / ACTIVE deed spk，与 commit 输出 2、reveal 输出 0 的 spk **逐字节**比；`holderPubkey` 取自 `scratch\dotk\holder-pubkey.txt`；
- 输入事实取自我们节点（outpoint/金额/spk 属于临时地址；gap 与 PENDING deed 在节点上核存在、带 covenant id、spk 等于模板派生）；tx 的 version、lockTime = 0、payload 空、所有 sequence 为 0；无多余输入；**拒绝任何 `ownerSigInputs` 非空**；
- 门面白名单 **5 个方法**：`getServerInfo / getUtxosByAddresses / getFeeEstimate / submitTransaction / submitTransactionReplacement`（M3 + M7：`submitTransaction` 是 `RbfPolicy::Forbidden`，SDK 的 submit 做不了替换，替换只能由垫片调 `submitTransactionReplacement`）；两个 submit 方法都**只放行垫片已批准并签过的 txid**——空跑中应**从未被调用**（空跑不签不广播）；
- **commit 高 feerate（M7 / RB-2）**：门面把 `getFeeEstimate` 的返回**乘一个倍数**，抬高 commit 的 fee 以提高被 P2P 层替换的门槛（无需改 SDK：SDK 定价 = max(市场 feerate × feeMass, relay 下限) × 1.05，封顶 5 KAS）。**倍数由垫片参数给**，上限以 SDK 5 KAS 封顶为界；**空跑必须打印 commit 与 reveal 的实际 fee**（并核 commit fee + reveal fee 仍在"净流出 ≤ 45 KAS"预算内）；
- **空跑要复核**（M4-7 / M7①，〔待 J1〕）：NWT simnet 实测**链式未确认交易被节点接受**（含 covenant 链），所以**默认流程 = commit 提交后立即提交 reveal，不等确认**；J1 须在真实形状上复核这一点。**若复核发现不接受** ⇒ 改为"commit 一块确认后立即 reveal"，把这段等待计入 `t_evict` 预算，本页 3.4 相应改写。

**验收读数**：垫片报告的全部校验布尔为 True；输出表与设计 M4 逐项一致；`ownerKey`（x-only）与 `scratch\dotk\holder-pubkey.txt` 逐字一致。**把输出表交 Bettor 与 NWT 人审**——这是**唯一的人审点**；通过后 Bettor 给 G2。
**中止 / 回滚**：任一校验为 False 或表对不上 ⇒ 停，**没有任何资金移动、没有真实钥匙**，回报 Bettor/NWT；不进 3.2。

### 3.2 出资：`83c9be27` → 临时付款钥匙地址 47 KAS

**门**：G2（Bettor GO；3.1b 已审过）。

**前置**（转账前一刻，全部只读）：
1. 重跑 §1.3、§1.6、§1.7；再确认 G2 消息里的冻结宣告仍有效；记 §1.2 的 console PID 与 `CreationDate`。
2. **此刻才**由垫片生成真实临时付款钥匙（CSPRNG），把**地址**写入 `scratch\dotk\temp-address.txt`（〔待 J1〕命令）；私钥只在垫片内存与 `scratch\dotk\keys\` 下的临时钥匙文件。自查该文件 ACL 只有当前用户：`icacls scratch\dotk\keys`（只读列出，不打印文件内容）；**任何 agent 不得读、不得 `Get-Content` 该文件**。转账 `to` 从地址文件读，不手打。
3. 快照源地址现有 outpoint：`node scratch\_dotk_read.mjs snap relay:83c9be27 scratch\dotk\src-before.txt`。
4. 临时地址此刻 UTXO 数为 0：`node scratch\_dotk_read.mjs count '@scratch\dotk\temp-address.txt'`（**`@文件` 参数必须加引号**，否则 PowerShell 把裸 `@` 当 splat 运算符）。

**动作**（走既有、已验证的路径，`relay.js:537-557`；**只发这一笔，不重试**）：

```powershell
$s=((Select-String -Path D:\kanet-tn12\kanet.mainnet.env -Pattern '^ADMIN_SECRET_FUNDS=').Line -split '=',2)[1].Trim()
$id=((Invoke-RestMethod http://127.0.0.1:3202/api/system/rpc-overview).relays | ? { $_.id -like '83c9be27*' }).id
$to=(Get-Content scratch\dotk\temp-address.txt -Raw).Trim()
$body=@{ to=$to; amount='47.00000000' } | ConvertTo-Json -Compress
$r=Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3202/api/relay/$id/transfer" -ContentType 'application/json' -Headers @{'X-KANet-Admin-Secret'=$s} -Body $body -TimeoutSec 60
Remove-Variable s
$r.txId | Out-File scratch\dotk\funding-txid.txt -Encoding ascii     # txId 是公开信息
"ok=$($r.ok)  fee_present=$([bool]$r.fee)"                            # 不打印余额
```

**验收读数**（该路由只保证进内存池，**落链由我们自己的节点核**；判据是"目的地址节点 UTXO 总额 = 47 KAS 且全部 txid 已落链"，不看几笔）：

```powershell
# 3.2-a  收款地址应出现 transactionId==txId 且金额恰 47 KAS 的条目，且只有这一个条目
node scratch\_dotk_read.mjs landed '@scratch\dotk\temp-address.txt' (Get-Content scratch\dotk\funding-txid.txt) 4700000000
# 3.2-b  源地址新增 outpoint 应全部属于该 txId（单输入 → 一笔 → 找零）；出现别的 txid ⇒ 发生拆分，列出后逐个核落链
node scratch\_dotk_read.mjs newouts relay:83c9be27 scratch\dotk\src-before.txt (Get-Content scratch\dotk\funding-txid.txt)
# 3.2-c  console 与 relay 未受扰
(Invoke-RestMethod http://127.0.0.1:3202/api/system/rpc-overview).summary
```

期望：`entry_with_txid=True amount_exact=True entries_total=1`；`all_new_have_txid=True`；`connected=18`；console `CreationDate` 与基线相同。落链需轮询：每 3 s 读一次，**最长 60 s**。

**记录出资来源地址（供 3.6 sweep 用；不让人重输）**〔待 J1〕：垫片由出资交易的**父交易输入**推得"资金来自哪个地址"，写入 `scratch\dotk\sweep-dest.txt`。KANet-UI 与 Bettor **各自独立**核对：
```powershell
# 3.2-d  sweep 目的地址 == 源 relay 的 console 地址？并打印去 kaspa: 前缀后的首 8 / 末 8 位，供 Bettor 独立读 console 对照
node scratch\_dotk_read.mjs sameaddr relay:83c9be27 '@scratch\dotk\sweep-dest.txt'
```
期望 `same= true`，且 Bettor 在自己一侧读 console 地址得到的首末 8 位与此一致（**首末 8 位只在消息里两方互报，不写进 `docs/`、账本或 provenance**）。

**中止 / 回滚**：
- HTTP 非 200、超时、或 `ok≠True`：**不重试**。先读链：源地址 `newouts` 与临时地址 `count`——**relay 命令超时可迟到**，可能广播成功而响应丢失；只有源地址无新 outpoint 且临时地址仍为 0 ⇒ 才确认"没发出"，回报 Bettor 后由他决定重发。
- `newouts` 出现不属于该 txId 的新条目 ⇒ 拆分：把那些 txid 列给 Bettor/NWT，逐个核落链；**目的地址总额 ≠ 47 KAS 或有未落链的 txid ⇒ 不进 3.3**。
- `sameaddr` 为 False 或首末 8 位两方对不上 ⇒ **不进 3.3**（sweep 目的地址若错，47 KAS 全失）。
- 已出资但后续任一步在 **commit 提交之前**中止：进 3.6 sweep，再证空。

### 3.3 真跑前半段：自动校验（同一个垫片进程，紧接 3.4；**无人工环节**）

**门**：G3（Bettor GO，启动真跑前）。
**说明**：3.1b 是"空跑：人审"，本步是"真跑：自动"。垫片用**真实的**临时地址与真实 UTXO 再跑一遍**同一套** M4 校验（逐笔期望表、owner 绑定独立复算、输入事实取自节点、拒 `ownerSigInputs` 非空、门面只放行已批准 txid）。**不符即拒签**；从这一刻起到 reveal 落链之间，KANet-UI 与任何人都**没有手动步骤**——5 分钟窗口里只有机器。
**前置**：3.2 已落链且读数全对；G3 已给；窗口内人在场但**只观察**；再读一次 §1.12（名字仍空闲）、§1.16（提交内存占比仍 ≤ 阈值）与 `node scratch\_dotk_read.mjs daa`（记起始 DAA）。
**验收读数**〔待 J1〕：垫片打印全部校验布尔（全 True）与所比对的字段名；`ownerKey` 与持有公钥一致。
**中止 / 回滚**：**此时 commit 尚未提交（阶段 A）**：任一校验为 False ⇒ 垫片自己拒签并退出；**零损失**；临时钥匙余额进 3.6 sweep 扫回。

### 3.4 commit + reveal（垫片，一口气；**两段不同的中止规则**）

**为什么一口气**：commit 落链后 PENDING deed 锁着 bond 1 + deposit 36 = **37 KAS**；`t_evict = 3000 DAA`（10 BPS ≈ **300 s**）内未 activate，**deposit（36 KAS）归驱逐者**。抢注窗口不在 reveal：`claim = blake3(name‖ownerType‖owner)` 在 commit 就把 owner 永久绑定，旁观者看到 reveal 只能替我们**完成**、改不了 owner；**真正的窗口在 commit 上链前的内存池**——commit 见证里带 `key = blake3(name)` 与 claim，可字典反查并用更高手续费抢花同一 gap 输入。**M7 确认这个面为真**：P2P 中继路径是 `RbfPolicy::Allowed`（`txrelay/flow.rs:223`），**攻击者不需要我们的 RPC**，向对等节点发更高 feerate 的同 gap 输入 commit 即可替换我们未确认的 commit。**缓解**：commit 自己用**高得多的 feerate**（门面对 `getFeeEstimate` 乘倍数，见 3.1b；上限 5 KAS），并在 commit 后**立即**提交 reveal、不留人为间隙；秒级窗口，**残余风险接受**，损失上限见 §4。

**垫片编排**（自己编排，**不依赖 SDK `register()` 的注释**——NWT 审 §1.4b：其注释称 reveal 在 commit 前已签，代码并非如此）：
1. `planRegistration` → M4 校验（3.3）；
2. **先把两个 request 都签好，且再签一份"替换用"的第二份 reveal**：**同一 deed 输入、同一输出集**，feerate（按 **contextual mass 基**，判据 = fee / normalized_max(compute, transient, **storage**)，NWT 审 M7）由垫片**预先算成严格高于第一份**（Bettor 裁：**替换，不并行**——同一 deed 输入本就只能确认一笔，并行只会让人读错状态）；
3. **先把"注册进行中"状态位落盘，再调 `submitTransaction(commit)`**（Bettor 裁：垫片必须先落盘状态位再提交；因为若提交响应丢失，交易仍可能已广播）；随后提交 commit，**紧接**提交 reveal——**默认流程：链式未确认交易被节点接受，reveal 不等 commit 确认**（M7①，J1 空跑在真实形状上复核；若复核不成立则改"一块确认后立即 reveal"，计入 `t_evict`）；
4. 节点是否接受 reveal：只连本机 `127.0.0.1:17110`（M3 门面），用 `daa` 计时；
5. **替换机制（M7，NWT simnet 实测订正）**：**SDK 的 `submitTransaction` 做不了替换**——它是 `RbfPolicy::Forbidden`（`flow_context.rs:690`），花同一输入的第二笔不论 fee 一律拒 "already spent"。**替换只能由垫片调 `submitTransactionReplacement`**（`Mandatory`，`:715`）：更高 feerate 被接受、旧笔移出；相同或更低被拒。据此：
   - **只在"第一份 reveal 已进 mempool 但迟迟不打包"时替换**（垫片调 `submitTransactionReplacement` 提交第二份，feerate 严格高于第一份）；
   - **第一份被拒或被丢弃**（不在 mempool、也不在链上）⇒ **普通提交**第二份（`submitTransaction`）；
   - 再不行 ⇒ 用 SDK `planActivate`（"从另一枚币完成"）兜底——SDK 明说"半落地的注册，任何持有 `(name, ownerType, owner)` 者都能完成"，我们持有全部三项；**`planActivate` 花的是同一 deed 输入，同受上面的提交/替换约束**。
   - **各级等待阈值〔待 J1〕**：等 J1 空跑在真实形状上复核"链式未确认交易节点是否接受"之后由 Bettor 定；此处只**写死原则**：**所有重试与替换，在 `t_evict` 前 600 DAA 停手并回报**——即自 commit 提交起满 **2400 DAA**（≈240 s）后垫片不再提交任何交易，立即回报 Bettor，**不追到最后一秒**；目标预算仍是 ≤ 1800 DAA（≈3 分钟）内 reveal 被接受，`t_evict = 3000 DAA` 是链上硬线。

**阶段划分与两套中止规则**（分界点 = 垫片**把"注册进行中"位落盘**的那一刻，即 commit 提交调用之前；不是"commit 是否已确认"。Bettor 已采纳这一保守定义，并写进给 J1 的垫片要求：**先落盘状态位再调 `submitTransaction`；崩溃恢复时读该位决定能否 sweep**）：

| | **阶段 A：commit 提交之前** | **阶段 B：commit 已提交之后** |
|---|---|---|
| 任一校验不符 / 异常 | **停**，零损失，进 3.6 sweep | **不许停。** 只允许做下面"允许动作"，其余一律不动 |
| 重试 | 不重试，先读链 | 允许且只允许：重试**同一笔已自检过的** reveal → 第二份（同 deed 输入、同输出集、feerate 按 contextual mass **严格高于**第一份）：**第一份已在 mempool 但迟迟不打包 ⇒ 由垫片调 `submitTransactionReplacement` 替换；第一份被拒/丢弃 ⇒ 普通 `submitTransaction`**（SDK 的 submit 做不了替换）→ `planActivate` 兜底（同一 deed 输入，同受此约束）；**不改任何别的参数**；**所有重试与替换在 commit 提交后 2400 DAA（`t_evict` 前 600 DAA）停手并回报** |
| sweep | 允许（3.6） | **禁止。** 垫片见"注册进行中"位拒 sweep；KANet-UI 也不得用任何别的工具去花临时地址的 UTXO——reveal 需要 commit 的**找零输出**作资金输入，花掉它 = 36 KAS 被驱逐 |
| 预算 | — | reveal 被接受 ≤ 3 分钟；用节点 `virtualDaaScore` 计时（起点为 commit 提交时的 `daa`） |
| 超预算 / 全部兜底失败 | — | 到 2400 DAA 或兜底全败：**立即**回报 Bettor（损失量级 = deposit 36 KAS，名字回到可注册）；**不追最后一秒**、**不自行重做整个注册**；临时钥匙文件保留 |
| 垫片进程崩溃 | 状态位**未落盘** ⇒ 重跑垫片，从阶段 A 重新校验 | 状态位**已落盘** ⇒ **一律按阶段 B 处理，禁 sweep**：凭临时钥匙文件重启垫片的**恢复态**（〔待 J1〕垫片是否提供）读该位并**先向节点核实 commit 的实际状态**（已在内存池/链上、还是根本没发出）再继续 reveal；"位已落盘但 commit 实际未发出"这一情形能否清位，**由 Bettor 拍、NWT 同意，执行者不自行清位**；**清位只凭节点证据，三条须全部成立**：① 临时地址上那枚资金 UTXO 在我们节点上**仍未花**（`node scratch\_dotk_read.mjs landed '@scratch\dotk\temp-address.txt' (Get-Content scratch\dotk\funding-txid.txt) 4700000000` 仍得 `entry_with_txid= true amount_exact= true`）；② 目标 gap UTXO 在节点上**仍未花**（〔待 J1〕gap 的 outpoint 与读法）；③ **自状态位落盘起等满 600 DAA**（`daa` 记落盘时刻，再读一次 ① ②）仍成立——给"已广播但尚未被看到"的交易留窗口。**任一不成立 ⇒ 按阶段 B 处理**（禁 sweep、走恢复态）。**不用 `getMempoolEntriesByAddresses`**（仓内无实际使用，不依赖） |

**验收读数**：垫片报告 commit、reveal 两个 txid（公开信息）与两次的 `daa` 差；我们节点上两笔均出现：
```powershell
node scratch\_dotk_read.mjs daa       # 记 reveal 被接受后的 DAA，与 commit 提交时的 DAA 相减：应 < 1800（≈3 分钟），必须 < 3000（t_evict）
```
（两笔 txid 的落链核法〔待 J1〕；`_dotk_read.mjs landed` 可用于核 deed/找零的 outpoint 归属。）

### 3.5 落链核验（用我们自己的节点，不信 `api.dotk.name`）

**动作 / 读数**：
1. 我们的节点上 deed UTXO 存在。**deed 地址可以纯本地推导，不问索引器**：J1 侦察 d——`dotk.js:167-171` `deedAddress(name, address)` 标注 "Pure: nothing is asked"（J1 原话；它具体吃哪些入参、含不含 owner，本页不猜，〔待 J1〕）；`addressFor(name)`（`dotk.js:249-256`）在节点否证时抛 `RefutedError`，不退回猜测。本页的读法 = 用垫片 3.1b 已"独立重算"的那个 ACTIVE deed spk 派生地址，再用 `_dotk_read.mjs count/landed` 读**我们的节点**（读的具体调用〔待 J1〕，不写成本页自造的实现）；
2. deed 状态的 `owner` 字节 == §3.1 交来的持有 x-only 公钥，`ownerType` 符合预期（〔待 J1〕状态解码法，仓内无现成解码器，不猜）；
3. 对照（非依据）：`Invoke-RestMethod https://api.dotk.name/v1/names/kanet` 返回 200 且 owner 一致。
**中止 / 回滚**：owner 字段不是持有公钥 ⇒ **最严重的读数**（名字被激活到错误所有者）：停一切后续动作，只做只读取证，回报 Bettor 与 NWT；**不要**试图"修正"（release/transfer 都要持有钥匙签名，而它只在 Owner 手里）。

### 3.5b 签名演练（不广播）——Owner 本人，M6

**为什么**：`activate` 没有签名参数，若 `ownerKey` 编码有误（字节序 / 奇偶 / 类型），名字会被**永久锁死**而地址核对看不出来。**动作（Owner 本机物理终端，同 3.1 的环境要求）**：用 J1 脚本的 `sign-drill` 模式，用恢复出的钥匙对 `planTransfer('kanet.k', newOwner = 持有者自己)` 生成的 request 签名，SDK `applySignatures / verifySignature` 验过，**只打印布尔，不广播**。**Bettor 加的约束**：`newOwner` 必须是**持有者自己**（自转），这样签好的交易即使泄露被广播也无害。
**读数**：Owner 经 Bettor 报回 `verify=true`。**若为 false**：名字可能已永久锁死——不是本 runbook 能修的，立即回报 Bettor/NWT/J1。

### 3.6 扫回、证空、清理、记账

**前置**：**注册状态已终结**——3.5 已过（reveal 落链、deed ACTIVE 且 owner 正确），**或**在阶段 A 中止且未提交 commit。**若处于阶段 B（commit 已提交而 reveal 未完成）——禁止本步**（见 3.4）。
**动作**：
1. **sweep 目的地址由记录推得、不重输**：使用 3.2 记录的 `scratch\dotk\sweep-dest.txt`（垫片由出资交易的父输入推得）；再跑一次 `node scratch\_dotk_read.mjs sameaddr relay:83c9be27 '@scratch\dotk\sweep-dest.txt'` 得 `same= true`，并与 Bettor **再核一次首末 8 位**（消息里互报，不落文档）。
2. 垫片**自建** sweep（输入 = 临时地址全部 UTXO，单输出到目的地址，手续费 ≤ 0.05 KAS；**永不签外部给的 sweep 交易**；见"注册进行中"位则拒）；自签可精确清零。
3. **证空**：`node scratch\_dotk_read.mjs count '@scratch\dotk\temp-address.txt'` ⇒ `utxo_count=0`（用节点 UTXO 条目数，不用 `/api/relay/:id/balance`——后者取整到 3 位小数，会把尘埃显示成 0）。
4. **仅在证空之后**：删除临时钥匙文件；核已删：`Test-Path scratch\dotk\keys\<临时钥匙文件>` ⇒ `False`。
5. **哈希复核**：重算与 1.14 同范围的 SHA256，与 `hash-before.txt` 比：
   ```powershell
   $shim='<垫片文件路径〔待 J1〕>'; $vendor='<vendor 白名单目录〔待 J1〕>'; $node=(Get-Command node).Source
   $files = @($shim, $node) + (Get-ChildItem $vendor -Recurse -File | ForEach-Object FullName)
   $files | Sort-Object | ForEach-Object { '{0}  {1}' -f (Get-FileHash $_ -Algorithm SHA256).Hash, $_ } | Set-Content scratch\dotk\hash-after.txt -Encoding ascii
   "hash lists identical: " + ((Get-Content scratch\dotk\hash-before.txt -Raw) -eq (Get-Content scratch\dotk\hash-after.txt -Raw))
   ```
   期望 `True`；**False ⇒ 垫片或 vendored 包在运行期间被改动**，停，回报 Bettor/NWT，不清理现场。
6. 出资源侧：console PID 与 `CreationDate` 与 §1.2 基线一致；`rpc-overview` 仍 `connected=18`；`relay_nodes` 仍 18 行（本流程没有任何 console 建行/删行）；`Select-String logs\mainnet\console-mainnet-stdout.log -Pattern 'relay-hotwallet-monitor\] KILLING'` 计数不变。
7. 记账（D-021）：写 provenance 页 `docs/provenance/2026-09-19-dotk-kanet-k-registration/README.md` 与账本一块。**写**：commit / reveal 两个 txid、出资与 sweep 的 txid、deed 地址、registry covenant id、SDK 版本与 integrity、垫片 sha256、`hash-before/after` 的比对结论、Owner 交来的持有**公钥与地址**（Bettor 已裁进 provenance）、3.1b 空跑结论（链式未确认交易是否被节点接受）。**不写**：任何余额、助记词、临时钥匙、`ADMIN_SECRET_FUNDS`、sweep 目的地址的首末 8 位。提交用具体路径的 pathspec，不用 `-A`；provenance 里若有 `*.log` 会被 `.gitignore` 静默排除，须 `git add -f` 并用 `git ls-tree` 对清单核 n/n；不推送，交 Bettor。
**验收读数**：`utxo_count=0`；临时钥匙文件已删；哈希列表相同；出资源 relay 仍在跑、监控无 KILLING 增量。
**中止 / 回滚**：sweep 未落链或 `utxo_count≠0` ⇒ **不删钥匙文件**，回报 Bettor；持有钥匙永不删除（本来就不在 console）。**崩溃恢复 = 再跑垫片 sweep 读该文件**（仅限注册已终结/阶段 A 中止；阶段 B 见 3.4 恢复态）。

## 4. 风险与上限（诚实口径，按设计 v0.4）

- **二进制不可审到源码级**：NWT 只审了发布的编译产物（GREEN）；`@noble/*` 未审（须钉版本 + integrity，vendor 进白名单）；**dotk covenant 字节码未审**。所以：上限 = 临时付款钥匙的 47 KAS；持有钥匙、`83c9be27` 主体余额、我们自己的合约与资金路径不在其可及范围（M2 的子进程隔离是这条上限成立的前提，§1.13 探针**只证明 fs / 子进程 / 环境三项**）。**Node 权限模型不限制网络**，所以探针证明不了"无外传"；这一层依赖 **NWT 对两个包 `dist` 的静态审**（网络面只有 `api.js` 的 `fetch` 与显式调用才有的 `WrpcJson.connect`，我们走 `nodesOver(门面)` 不触及）**加 vendored 包与 `node.exe` 哈希执行前后不变**（§1.14 / §3.6）。这是一个**明示的未证明面**，不是被探针覆盖的面。
- **抢注窗口在 commit 上链前的内存池，不在 reveal**：commit 输入见证里带 `key = blake3(name)` 与 claim，对"kanet"这类候选词可字典反查，攻击者可用**更高手续费的同一 gap 输入**替换我们的 commit 抢先注册——**M7 确认该面为真**：P2P 中继路径是 `RbfPolicy::Allowed`（`txrelay/flow.rs:223`），攻击者**不需要我们的 RPC**，直接向对等节点发更高 feerate 的 commit 即可；窗口是从广播到确认的秒级；缓解 = commit 自己用**高得多的 feerate**（门面对 `getFeeEstimate` 乘倍数，SDK 5 KAS 封顶）抬高替换门槛、commit 后**立即**提交 reveal、无人为间隙；**残余风险接受**（损失 = 抢注成功，名字被别人拿走；我们的 commit 未上链时资金未动）。owner 在 commit 处已由 claim 永久绑定，旁观者看到 reveal 只能替我们完成。
- **押金 36 KAS，不是 1 KAS**：清单 `deposit = 36 KAS`，PENDING deed 锁 37 KAS（bond 1 + deposit 36），`t_evict = 3000 DAA ≈ 300 s`。**commit 上链后未在期限内 activate，36 KAS 归驱逐者**——这是"commit 后不许停"的原因，也是本次损失的量级上限（另加矿工费）。
- **净流出**：commit 38（39 出 − 1 入 gap）+ reveal 2（39 出 − 37 入 deed）= 40 KAS + 矿工费（SDK `MAX_FEE_SOMPI = 5 KAS`）⇒ ≤ 45；充值 47 KAS 不变。
- **owner 编码风险**：`activate` 无签名参数；`ownerKey` 编码有误会使名字永久锁死而地址核对看不出——所以有 §3.1b 的独立复算、§3.5 的落链核验、§3.5b 的签名演练三道闸。
- **dotk 唯一性只在其自身 covenant 血脉内成立**；换模板即另一命名空间；名字的价值取决于生态是否认这条血脉——买品牌资产的正常风险。
- **不做**：不把 relay 私钥引进新脚本；不用 Owner 外部钱包点确认（Owner 已明示用我们的账户）。

## 4b. 执行后长期动作（不在本次窗口）

设计页 §2.4：核 deed UTXO 未被花、`owner` == 持有公钥，用 da9 主网节点（J1 域），`/v1/names/kanet` 仅对照。NWT 建议（不阻塞）：由每周核验改为**订阅**（对 deed 的 outpoint 用节点 `notifyUtxosChanged`，或每小时轮询）。本页不展开。

## 5. 总中止条件

**通用（任何阶段）**：
- 任何 GO 门未给；§1 任一项不符。
- 任何工具输出里出现助记词、私钥、`ADMIN_SECRET_FUNDS` 的值——视为泄露事件，停一切并报 Bettor（不自行处置）。
- 垫片打印的 `ownerKey` 与交来的持有公钥不一致，或目的 spk 不在期望表内，或总流出 > 45 KAS。

**只在 commit 提交之前（阶段 A）生效——"不符即停、零损失"**：
- §3.2 之后 console `CreationDate` 变化、`connected` 不再是 18、监控出现 KILLING；
- 名字被抢注（§1.12 或 3.3 前重读发现已被占）；
- `sameaddr` 不符或首末 8 位两方不一致；
- 3.3 任一自动校验为 False（垫片自己拒签）。

**commit 提交之后（阶段 B）——中止规则不适用，改为"完成 reveal"**：见 §3.4 阶段表。唯一"停"的时刻是**自 commit 提交起满 2400 DAA（`t_evict` 前 600 DAA）或全部兜底失败**，此时垫片不再提交任何交易，立即回报，不追最后一秒，不自行重做。

## 6. 回滚总表

| 停在哪一步 | 资金状态 | 处置 |
|---|---|---|
| 3.1 之前/之中 | 无任何资金移动 | 无 |
| 3.1b 空跑未过 | 无（合成 UTXO，无真实钥匙） | 无；修垫片再空跑 |
| 3.2 未发出 | 无 | 无 |
| 3.2 已发出，阶段 A 中止（3.3 拒签等） | 47 KAS 在临时地址 | 3.6 sweep 扫回，节点证空 |
| 阶段 B：commit 已提交，reveal 完成，deed 核验通过 | 名字已激活 | 走 3.5、3.5b、3.6 |
| 阶段 B：commit 已提交，reveal 超预算且兜底失败 | **损失 deposit 36 KAS 量级**；名字回到可注册 | **禁 sweep**；回报 Bettor；不自行重做；钥匙文件保留 |
| 3.5 owner 不符 | 名字在别人名下或被锁死 | 只读取证，回报，不修正 |

## 附录 A. 只读链读脚本 `scratch/_dotk_read.mjs`（gitignored；只打印计数与布尔；定稿时交 NWT 一并审）

（该脚本 2026-09-19 已在 scratch 用真实数据只读试跑：`count` / `shape` / `snap` / `newouts` / `landed`（含伪造 txid 的负向）/ `pubmatch`（含非法公钥的负向）/ `sameaddr`（相同与不同两种）/ `daa` 均按预期出数；打印不含金额；`sameaddr` 只打印首末 8 位。`getUtxosByAddresses` 是仓内 1475 已用于核落链的同一个 RPC。）

```js
// 用法(PowerShell 里调 node；@文件 参数必须加引号，否则 PowerShell 把裸 @ 当 splat)：
//   node scratch\_dotk_read.mjs count    <addr|'@file'|relay:UUID前缀>
//   node scratch\_dotk_read.mjs shape    <addr|'@file'|relay:前缀> <sompi>      # 单输入选币判据：amount*1.65+300000
//   node scratch\_dotk_read.mjs snap     <addr|'@file'|relay:前缀> <outfile>    # 只写 txid:index，无金额
//   node scratch\_dotk_read.mjs landed   <addr|'@file'|relay:前缀> <txid> <sompi>
//   node scratch\_dotk_read.mjs newouts  <addr|'@file'|relay:前缀> <snapfile> <txid>
//   node scratch\_dotk_read.mjs pubmatch <pubkey文件> <address文件>            # 纯公开推导，不连网
//   node scratch\_dotk_read.mjs sameaddr <地址A> <地址B>                        # 逐字符相等；并打印 A 去 kaspa: 前缀后的首8/末8位（M5 两方核对）
//   node scratch\_dotk_read.mjs daa                                            # 节点 virtualDaaScore（t_evict：3000 DAA ≈ 300 s）
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire('D:/kanet-tn12/kasia-console/package.json');
const Database = require('better-sqlite3');
const K = await import('file:///D:/kanet-tn12/kasia-console/node_modules/kaspa-wasm/kaspa.js').catch(async () => await import('kaspa-wasm'));
const { Address, XOnlyPublicKey } = K;
const [cmd, who, a3, a4] = process.argv.slice(2);
const addrOf = (w) => w.startsWith('@') ? fs.readFileSync(w.slice(1), 'utf8').trim()
  : w.startsWith('relay:') ? new Database('D:/kanet-tn12/kasia-console/data/console.mainnet.db', { readonly: true, fileMustExist: true })
      .prepare('SELECT address FROM relay_nodes WHERE id LIKE ?').get(w.slice(6) + '%').address : w;
if (cmd === 'pubmatch') {
  const pk = fs.readFileSync(who, 'utf8').trim(), ad = fs.readFileSync(a3, 'utf8').trim();
  let ok = false;
  try { ok = new XOnlyPublicKey(pk).toAddress('mainnet').toString() === ad; } catch { ok = false; }   // 非法公钥 ⇒ false（不抛）
  console.log('pubkey_matches_address=', ok);
  process.exit(0);
}
if (cmd === 'sameaddr') {
  const a = addrOf(who), b = addrOf(a3), p = a.replace(/^kaspa:/, '');
  console.log('same=', a === b, ' head8=', p.slice(0, 8), ' tail8=', p.slice(-8));
  process.exit(0);
}
const { getSharedRpc } = await import('file:///D:/kanet-tn12/kasia-console/src/lib/kaspa-rpc-shared.mjs');
const rpc = await getSharedRpc({ url: 'ws://127.0.0.1:17110', networkId: 'mainnet' });
if (cmd === 'daa') {
  const info = await rpc.getServerInfo();
  console.log('virtualDaaScore=', String(info.virtualDaaScore), ' isSynced=', info.isSynced);
  process.exit(0);
}
const { entries } = await rpc.getUtxosByAddresses([new Address(addrOf(who))]);
const amt = (e) => BigInt(e.amount ?? e.utxoEntry?.amount ?? 0);
const tx = (e) => e.outpoint?.transactionId ?? e.entry?.outpoint?.transactionId;
const idx = (e) => e.outpoint?.index ?? e.entry?.outpoint?.index ?? 0;
const key = (e) => `${tx(e)}:${idx(e)}`;
if (cmd === 'count') console.log('utxo_count=', entries.length);
else if (cmd === 'shape') { const s = BigInt(a3), min = s + s * 65n / 100n + 300_000n;
  console.log('utxo_count=', entries.length, ' utxos_ge_minSafe=', entries.filter((e) => amt(e) >= min).length); }
else if (cmd === 'snap') { fs.writeFileSync(a3, entries.map(key).join('\n')); console.log('snap_written=', entries.length); }
else if (cmd === 'landed') { const hit = entries.filter((e) => tx(e) === a3);
  console.log('entry_with_txid=', hit.length > 0, ' amount_exact=', hit.some((e) => amt(e) === BigInt(a4)), ' entries_total=', entries.length); }
else if (cmd === 'newouts') { const before = new Set(fs.readFileSync(a3, 'utf8').split('\n')); const fresh = entries.filter((e) => !before.has(key(e)));
  console.log('new_outpoints=', fresh.length, ' all_new_have_txid=', fresh.every((e) => tx(e) === a4)); }
setTimeout(() => process.exit(0), 300);
```

## 附录 B. 隔离探针（M2；§1.13 用）——启动形态示意，**以 J1 交付、NWT 审过的启动行为准**

**探针的证明范围（RB-4，NWT）**：只证 **fs 读写、子进程、环境变量**三项隔离；**Node 权限模型不限制网络，探针证明不了"无外传"**——这一层依赖 NWT 对 `dist` 的静态审加 vendored 包与 `node.exe` 哈希执行前后不变（§1.14 / §3.6、§4）。不要把"探针全绿"读成"该进程无法联网"。

下面只固定三条约束：**清空继承环境**（只留 `PATH` / `SystemRoot`，NWT 审 M2）、**`--permission` 白名单**、**不给 `--allow-child-process` / `--allow-worker` / `--allow-addons`**。真跑时垫片用**同一个启动函数**，探针与真跑不得各写一套。

```powershell
# 形态示意（路径〔待 J1〕）
$vendor='<白名单：vendored 包 + @noble + kaspa-wasm〔待 J1〕>'; $shimdir='<垫片目录〔待 J1〕>'; $keydir='D:\kanet-tn12\scratch\dotk\keys'
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = (Get-Command node).Source                    # Node 24（NWT 在 da9 v24.14.1 实测）
$psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
$psi.EnvironmentVariables.Clear()                             # 父进程清空环境：权限模型不管 process.env
$psi.EnvironmentVariables['SystemRoot'] = $env:SystemRoot
$psi.EnvironmentVariables['PATH'] = "$env:SystemRoot\System32"
# fs-read：vendored 包、垫片、kaspa-wasm、**以及临时钥匙目录**（Bettor 裁：sweep 与恢复态要读钥匙文件，NWT M2 漏写 fs-read，不是有意）；
# fs-write：只给同一个临时钥匙目录。其余 fs-read 白名单不变。
$psi.Arguments = "--permission --allow-fs-read=`"$vendor`" --allow-fs-read=`"$shimdir`" --allow-fs-read=`"$keydir`" --allow-fs-write=`"$keydir`" `"$shimdir\probe.mjs`""
$p = [System.Diagnostics.Process]::Start($psi); $out = $p.StandardOutput.ReadToEnd(); $err = $p.StandardError.ReadToEnd(); $p.WaitForExit()
$out; $err
```

探针 `probe.mjs`（放白名单目录内；**只打印键名与错误码，绝不打印任何文件内容**）：

```js
import fs from 'node:fs';
import cp from 'node:child_process';
console.log('env_keys=' + Object.keys(process.env).sort().join(','));
for (const p of ['D:/kanet-tn12/kanet.mainnet.env', 'D:/kanet-tn12/kasia-console/data/console.mainnet.db']) {
  try { fs.closeSync(fs.openSync(p, 'r')); console.log('READ_ALLOWED ' + p); } catch (e) { console.log(e.code + ' ' + p); }
}
try { cp.execSync('cmd /c exit 0'); console.log('CHILD_PROCESS_ALLOWED'); } catch (e) { console.log(e.code || 'child_process_error'); }
```

**期望**：`env_keys` 只含 `PATH`、`SystemRoot`（大小写按 Windows 实际）；两个读均 `ERR_ACCESS_DENIED`；`child_process` 为 `ERR_ACCESS_DENIED`。**任何 `READ_ALLOWED` / `CHILD_PROCESS_ALLOWED` / 多出的 env 键 ⇒ 隔离不成立，停。**
