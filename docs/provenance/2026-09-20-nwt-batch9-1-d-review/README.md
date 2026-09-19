> **Status**: CURRENT（2026-09-20，NWT；对象 = `origin/coord/j2-batch9-1-code-v0` 的 D 笔 `de0e7862`，父 E `a57db3d5`；J2 README `docs/provenance/2026-09-20-j2-batch9-1-d-pointers/README.md`）

# 批 9-1 D 笔审（结算指针模块 + `deriveWinnerBet` 抽取 + leaf-state rowid tiebreak）—— NWT

方法：独立检出（`D:\kanet-nwt-cand`，`de0e7862`，独立 `npm ci`）读全 diff（`proto-settlement-pointers.mjs` 214 行 + 测试 341 行、`proto-settlement-inputs.mjs` +28/−10、`proto-leaf-state.mjs` 两处 `ORDER BY`）；亲跑六套测试；对照我的 **N91-2 / N91-3**；做 **18 个我自己的变异**；并做一条 J2 自陈没做的独立验证——**把真实 builder 产出的整条链喂给真实指针模块**（`nwt-d-real-chain-probe-builder.cjs`，在一个临时副本里跑、跑完即删，`git status` 空）。D-021：无密钥 / 余额 / 地址。

## 结论：**GREEN，无 MUST；3 条 SHOULD**

本笔仍无生产调用方、纯读；我上轮 N91-2 / N91-3 两条 MUST 都落到位，且我用真实 builder 链验证了 J2 自陈的"夹具不是 builder 真实产物"这一缺口——**四步都被接受，指针与 builder 自己给出的 outpoint / covenantId 逐项吻合**。

| 类 | 编号 | 内容 |
|---|---|---|
| SHOULD | D-1 | **`tx.free()` 没有测试守着**（我的变异 d15 存活：把 `finally` 里的 `free` 删掉，全部测试仍绿）。指针模块每次 `loadProducedTx` 都造 wasm 交易对象；`finally` 里释放是对的，但无测试就没有回归保护（控制台是长驻进程，wasm 线性内存是我们反复吃亏的资源）。加一条：包一层 `kaspa.Transaction`，断言"每次装载恰好释放一次、包括 `finalize()` 抛错与 id 不符两条错误路径"。顺带：genesis 重算里 `new kaspa.TransactionOutput(...)`（每个 covenant 输出一个）没有显式 `free()`，靠 GC / FinalizationRegistry——可以一并显式释放。 |
| SHOULD | D-2 | **模块头注"纯读、不 import DB 客户端"被导入图打破**（J2 取舍 #7 已如实记录）：指针模块 import `proto-settlement-inputs.mjs`（为复用 `deriveWinnerBet`），后者顶部 `import { sqlite } from '../db/client.js'`（`:13`）——**import 指针模块即打开默认库**（M0a 无 `DB_PATH` 时拒绝）。指针模块自己的文件没 import DB，但"注入 db"这个设计意图（纯函数、可在任何进程 / 测试里用注入的库）被破坏了：将来任何非 console 进程（脚本、9-4 simnet 驱动）import 它都会被迫碰默认库。修法（一笔小事）：把 `deriveWinnerBet` 移到一个**不 import 任何 DB 客户端**的新文件（`db` 必填、无默认值），`proto-settlement-inputs.mjs` 从该文件 import 并保持原导出；指针模块从新文件 import。 |
| SHOULD | D-3 | `pointer_covenant_inconsistent` 现在承担三种语义（格 3/4 不等；genesis 重算不等；append leaf ≠ `shardleaf_cov_id`），靠 `.detail` 区分。9-2b 的报警分级若按 `.code` 分，会把三种混在一起。要么给 `.detail` 一个短枚举字段（`.kind`），要么在 9-2b 文档里写明"三种同归一类、人工看 detail"。J2 已声明没有新增码是有意的——这里只是提醒 9-2b 别按 code 做区分处理。 |

## 一、N91-2 / N91-3 落点核对（读码 + 变异 + 真实链）
| 项 | 判 | 依据 |
|---|---|---|
| **N91-2** `finalize()` 后再比 id；只读被 txid 覆盖的字段 | ✅ | `loadProducedTx`：`deserializeFromSafeJSON` → `tx.finalize()` → `lc(tx.id) === submitted_txid`；抽取的只有输入 `previousOutpoint`、输出 `value / scriptPublicKey.script / covenant.covenantId / covenant.authorizingInput`——都在我 `680b8bb8` 实测的"被 txid 覆盖"清单里；不读 `utxo` / `signatureScript` / `computeBudget` / `sigOpCount`。**变异**：d1（去掉 `finalize()`）红 3 条；d2（去掉 id 比对）红 3 条。J2 的 P9c（改不被覆盖的字段 ⇒ 四步结果逐字段不变；对照臂改被覆盖的 `sequence` ⇒ 拒）**证明篡改手段有效**，且 J2 另有源码扫描。 |
| **N91-3** 赢家票取自该下注的 landed append 意图，不直接信 `proto_bets` 列 | ✅ | `deriveWinnerBet` → 该下注自己的 `landedAppendOfBet` → `loadProducedTx`（同一套 `finalize()` + id 验证）→ 输出 1；`proto_bets.ticket_txid / ticket_vout` 只做交叉核对（不符 ⇒ `pointer_ticket_inconsistent`）；再核 ticket 输出**无 covenant**、spk = 由 `(bettorPk, side, stake, marketId)` 现算的 ticket spk。**变异**：d8（去 spk 现算）、d9 / d10（去两条列交叉核对）、d11（去无 covenant 核对）、d17（改取"最新 append"而非赢家那笔）**全红**。 |
| 谱系（§18.1 不变量 2） | ✅ | 每步全链复核：seal 输入 0/2 花掉最新 append 的输出 0/2；close_commit 输入 0 花掉 seal 输出 0；convert 输入 0/1 花掉 close_commit 输出 0 / seal 输出 1；covenantId 双重一致。输入下标用 E 笔导出的常量。**变异**：d5（`spends` 只比 txid 不比 index）、d6 / d7（少核一条输入）全红。 |
| 一个"额外"设计：genesis 组输出独立重算 covenantId | ✅ **且我用真实链验证了它不会误拒** | 这是 J2 加的（设计里没有）：对 append 的 KTT、seal 的 RootClose 与代币、convert 的 RootClaim 与代币，用 `kaspa.covenantId(authorizing 输入 outpoint, [该输出])` 独立重算并要求相等。**风险**：J2 的夹具是"按 builder 布局用同一组 wasm API 手造"（取舍 #8），如果这项检查对真实 builder 产物的语义有偏差（例如 builder 把两个 genesis 输出放在同一组），真实结算会全部 fail-closed 卡死、而夹具永远看不出来。**我核了 builder 源码**：`market_seal`（`proto-tx-assembly-settlement.mjs:247-250`）/ `convert_to_claim`（:659-662）/ `claim_draw`（:862-865）都是"每个 genesis 输出各自独立一个 `GenesisCovenantGroup`（单 index 数组）"，与模块的单输出重算一致；**并实测**：真实 builder 整链（两笔真实 `register_append` → seal → close_commit → convert_to_claim，取自 `proto-claim-draw.test.mjs` 的真实构造）写进临时库、喂真实 `resolveStepPointers` 跑四步——**全部被接受**，且 8 个指针（`seal.leaf/held`、`close_commit.rootClose`、`convert.rootClose/held`、`claim_draw.rootClaim/held/ticket`）与 builder 自己产出的 outpoint / covenantId **逐项 MATCH**（`outputs.txt` §2）。变异 d3（去重算比较）、d4（重算用错输出下标，红 20 条）说明该检查有测试守着。 |

## 二、亲跑与变异
- 亲跑（独立检出）：`proto-settlement-pointers` **23/0**、`proto-settlement-inputs` **21/0**、`proto-leaf-state` **33/0**、`proto-broadcast-ops` **16/0**、`proto-claim-draw` **53/0**、`proto-settlement-c1` **32/0**——与 J2、Bettor 自报逐项一致。
- **我的 18 个变异**（每个跑 pointers + inputs 两个测试文件；还原后 sha256 一致；`git status` 空）：**17 被抓，1 存活**——d15（`tx.free()` 从不调用）= **D-1**（资源卫生，非安全）。除 N91-2 / N91-3 承重点外，还覆盖：`ORDER BY` 少 `rowid` tiebreak（d12）、append 查询不限 `landed`（d16）、leaf covenant 与 `shardleaf_cov_id` 核对（d13）、close_commit 续约 covenant 相等（d14）、`deriveWinnerBet` 失败不映射（d18）。
- J2 自报第一轮 2 存活的处置**做法对**：M-05 根因是不可达死代码，**删死代码并把变异改为"去掉 SQL 的 `landed` 过滤"**（我的 d16 是同一类、被抓）；M-06 补"报文须指明 `submitted_txid` 本身有问题"的断言；旧输出改名留存。

## 三、J2 的 8 条取舍
1. `deriveWinnerBet` 抽取——**接受**。我核了 diff：`deriveCloseCommitInputs` 仍**先**自己的"市场存在 + `sealed` 状态闸"，再调 `deriveWinnerBet`；后者顺序 = 市场存在 → `winning_side` → 池子 → 胜方条数，与抽取前**同序**；报文靠 `who` 前缀逐字保持；新增的只有 `.code`（对既有捕获报文的调用方无影响）。两次读 `proto_markets`（`id,status` 与 `id,status,winning_side,payout_root`）之间无事务；但 `deriveCloseCommitInputs` 是**同步函数**、better-sqlite3 也是同步的，两次读之间没有 `await`，同进程内无从交错，可接受。
2. 签名加必填 `kaspa`——**接受**（`finalize()` / `covenantId` 必须）。
3. 码复用 / `pointer_winner_ambiguous` 涵盖 `deriveWinnerBet` 全部失败——**接受**，附 **D-3**。
4. 谱系每步全链复核（更严）——**接受**（seal 代币输出畸形时 close_commit 步就失败：方向是 fail-closed，我认同）。
5. genesis 回退（无任何 landed append）时 leaf 指针取 `proto_markets` 的 genesis 值、无 tx 字节可验——**接受**；且如 J2 所写，该分支产出目前没有实际用处（seal 无 held 必抛）。
6. P9c 用"合法但不同的值"而非"非法值"——**接受**，理由成立（非法 hex 会让反序列化直接失败，那是另一条路径 `pointer_tx_malformed`，P9d 另测）。
7. 导入图副作用——见 **D-2**。
8. 夹具不是 builder 真实产物——**已由我的真实链探针闭合**（§一）；真链证据仍在 9-4。

## 四、其余读码结论（无问题）
- `latestLandedAppend` 的排序 `landed_at DESC, rowid DESC` 与 `proto-leaf-state` 两处完全一致（J2 的 P1c / P14 与我的 d12 都盯着它）；`landedSettlement` 的排序无从起作用：`intent_key` 是主键（migrate.js v210），J2 夹具里键形态为 `settle:market:<id>:<step>`，故同一 (market, step) 至多一行（J2 已标"已知等价"；**生产写入点的键形态我没逐条核**，只据夹具与主键）。
- 赢家票指针只由 `deriveWinnerBet` 定；(A) 路线"恰好 1 条胜方下注"在 close_commit 与 claim_draw 两处共用同一份判定——这正是抽取的目的（J2 自报 M-35「`deriveCloseCommitInputs` 不再调它」红；我的 d17 / d18 是同类，被抓）。
- 该模块与 E-1 的接口：它已经产出每个角色的 `outpoint` 与 `expectedCovenantId`；F1 把 `outpoint` 带进 `chainParents`、F2 让 builder 逐项核对，D 这边**无需改动**。

## 没做 / 未证
- 没起 simnet；真实节点录制回执上的端到端（指针 → C1 取证 → builder）在 9-2b / 9-4。
- 我的真实链探针只覆盖"整条链都 landed 的正常路径"；各失败分支（未 landed、谱系断点、被改的 JSON）我信 J2 的 P10 / P11 / P13 并用 d5–d7 / d16 抽验，没有用真实 builder 产物逐个造失败。
