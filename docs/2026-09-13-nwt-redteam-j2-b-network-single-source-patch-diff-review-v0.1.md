# NWT diff 审 · J2 (b) 网络单一源 + 前缀一致性 patch（b1+b2，D-011 内部双审）

> **Status**: FINAL v0.1（2026-09-13 · NWT · docs only）
> 审对象：`origin/coord/j2-b-network-single-source`（b1 `f8af124d` + b2 `346adbce`，基线 `5f1b908e`）+ `docs/2026-09-13-j2-b-network-single-source-patch-notes-v0.1.md`。
> **方法（吸取上一次事故的教训，本次零 junction）**：`git worktree add /d/kanet-tn12-nwt-b-review origin/coord/j2-b-network-single-source` → `kasia-console`/`kasia-relay` 各自**独立 `npm install --prefer-offline`**（不 junction 到 live 树，不重装到 live）→ `scripts/check-worktree-junctions.mjs` 确认 0 条跨树链 → 23 个改动文件逐一 `node --check` → lint（含一次自建的正向对照实验，见下）→ **亲跑**全部 6 组测试 → 逐文件读 diff 核三项落码口径 + 既有错位一句话核实 → 审完 `git worktree remove`（无 junction，删除安全）。

## 结论：**GREEN**，可推进（b1 非钱路 Bettor 批 / b2 含 settler·voter·relay 钱路 Owner 批）

| 验证项 | 结果 |
|---|---|
| `node --check` × 23 | 全部 exit 0 |
| lint BLOCK 级 | **0 errors**（R-NET-PREFIX-INFER/EITHER 已翻 BLOCK，对真实改动文件 0 hit） |
| lint 规则本身是否真在工作（自建正向对照，见下） | ✅ 确认在工作，不是"因为没扫到才 0" |
| `kaspa-network.test.mjs`（我亲跑） | ✅ 51/51 |
| `u1-same-origin.test.mjs`（我亲跑） | ✅ 16/16 |
| `broker-fee-emit-package-switch.test.mjs`（我亲跑，含 kanet.env） | ✅ 24/24 |
| `pool-market-settler-v06.test.mjs`（我亲跑，临时 DB_PATH） | ✅ 全绿（35 条） |
| `bshard-auto-settler-bond-reclaim.test.mjs` + `-clear-deadshape.test.mjs`（我亲跑） | ✅ 10/10 + 5/5（notes 说 10/10，实数 5 类，断言点数够，判据成立） |
| `bshard-auto-settler.test.mjs` 既有错位 | ✅ 复现同一句 `no such column: id`，且确认 `pool-bettor-sides-query.mjs`/`bshard-auto-settler.mjs`/其 `.test.mjs` **三个文件 diff 均为 0**（(b) 完全没碰这几个文件）——不是本 patch 回归 |

## 关于"lint 0 hit"我多做的一步——先自证规则真的在工作

上次审 (a) patch 时我没做这一步（那次是数字/日志断言，本次是"整仓扫描 0 命中"这种"沉默 = 通过"的判据，风险更高：如果规则本身没被正确调用，也会显示"0 hit"，两种情况从输出上无法区分）。

我先用**错误的路径**（`scratch/` 下）造了一个故意含 `startsWith('kaspatest:') ? … : …` 的文件去跑 lint，结果是 0 hit——这一度让我怀疑规则失效；读了 `checkR_NET_PREFIX` 函数才发现它**按路径过滤**（只扫 `kasia-console/src|kasia-relay/src|shared/lib` 下的文件）。改在 `kasia-console/src/` 下重造同一个故意犯规的文件，lint **正确报出 R-NET-PREFIX-INFER 与 R-NET-PREFIX-EITHER 两条 BLOCK 级错误**（"Fix before commit"）。**这证明规则真的在扫描、真的会拦**，之前对真实改动文件的"0 hit"是可信的"确实没有了"，不是"规则没跑所以看不到"。（这个自我纠错本身也说明：对"整仓扫描 0 命中"这类判据，第一步永远该是正向验证判据本身有效，不能只看数字。）

## ① broker-fee-emit 循环站点"核-跳过"——确认不拖死整个 tick

读了实际 diff：`if (!_nc.ok) { netSkip++; log(...); continue; }`——`continue` 跳到 `for` 循环下一轮，不是 `throw`/`return` 提前退出整个函数。一行坏地址（D-017 过渡态下的存量 TN12 行）只会让**这一行**被跳过并计入 `netSkip` 计数，同一 tick 里其它合法行照常处理。亲跑的 `broker-fee-emit-package-switch.test.mjs` 24 条断言全绿，间接验证了这条路径与其它既有分支（discovered/independent/mismatch-fallback/threaded-claim 等）不冲突。

## ② 三处入站站点 `_inboundNetCheck`——不抛、丢消息、限频，且第四处正确合并未重复核

读了实际 diff：`oracle-enroll`/`market-pub`/`bet-reg` 三处调用点全部是 `if (!_nc.ok) return;`（丢消息，函数直接返回，不抛到调用方的消息处理主循环——不会因为一条坏消息打断整个 `trade-protocol-filter` 的处理链）。`bet-reg` 原来有**两处**独立 `startsWith` 判断（`:1434` 算 `network` 给 `computeSideP2SH_v07`、`:1470` 算 `network` 给 `captureSideLockDaa`），patch **正确地把两处合并成一次 `_inboundNetCheck` 调用**（`_bnc`），下游两处都复用 `_bnc.network`——比"改两处各自核一次"更好（少一次校验和运算，且保证两处用的是同一次核验结果，不会出现"核了两次、中间数据变了导致不一致"的理论缝隙）。

限频机制（`_netRejectState` Map，键 `${site}|${code}`，10 分钟窗）与我在设计审时要求的"P2-6 同族 DoS 面必须限频"完全对上：读代码确认 `events` 插入语句**在**限频判断的 `if` 分支内部（不是限频判断之外），确保真的是"限频了才插入"不是"限频了才打日志、insert 还是每次都跑"这种表面限频。

## ③ relay-manager I4——network_mismatch 拒起在任何状态改动之前

读了实际 diff：`if (account.network && !rowNetworkMatches(...)) return {ok:false, reason:'network_mismatch'};` 这一行插在函数最前面（`account`/`account.address` 判断之后，**identities 表写入、env 组装、子进程 spawn 之前**）——拒起时什么状态都还没开始改，符合 NO-TX 原则的同类精神（虽然这里不是钱路 tx，是"要不要启动一个进程"，但道理一样：判断失败时不留半成品）。

**一个非阻塞的观察**：`account.network &&` 这个短路守卫意味着如果 `account.network` 是 `null`/未设置，这条检查**完全跳过**，不会因为"值缺失"而拒起——只有"有值但不匹配"才拒。这与 I4 原话"行值 ≠ env ⇒ 拒"字面上有一点距离（`null` 严格说也是"≠ env"），但**不构成安全回退**：F6 的既有事实是 TN12 的 32 行 `relay_nodes.network` 全部**已经设置**为 `'testnet-12'`（不存在"未设置"的存量脏数据），这个短路分支实际服务的是"全新建的 relay 行，还没来得及写 network"这种正常新建流程，不是"给旧脏数据留后门"。判断：**可接受，不改**。

## ④ B-3/B-4/B-5/V3′/V12 是否真落成 helper throw——我亲跑验证，全部落实

跑 `kaspa-network.test.mjs` 时逐行核对了输出（不只看 PASS 计数）：
- V3/V3′（B-4/B-5 对应）：TN 地址在主网进程 / MN 地址在 TN12 进程 ⇒ 均报 `prefix-mismatch`，日志行 `who=pool.js:744 network=mainnet expected=kaspa actual=kaspatest addr=kaspatest:qpum`——**地址被截到 14 字符**，符合设计里"错误里别整串塞地址"的要求。
- V5（B-3）：未知网络前缀（`kaspadev`/`kaspasim`）在主网环境下 ⇒ `prefix-mismatch`，**没有**被映射成 `mainnet`——这正是 Codex #3 反例、也是整个 (b) 稿存在的理由，实测确认成立。
- V4/V4′：伪造前缀死在校验和（`invalid-checksum`，不是 `prefix-mismatch`——校验和检查在前缀比对之前），且伪造尝试之后 wasm 实例仍健康（`Address.validate` 对合法地址仍返回 `true`）——I3 不变量成立。
- V12：我自己写的 11 组对抗输入（空串/嵌入空字节/1MB 长串/emoji/破损 surrogate 等）被**原样照抄**进这份向量表，全部通过、且验证了"battery 之后实例仍健康"这条我没写进原脚本但设计文档补的额外检查——这是良性扩展，不是偏离我的原意。

## 既有错位 `bshard-auto-settler.test.mjs`（`no such column: id`）——确认非本 patch 回归

亲跑复现了完全相同的报错（`SqliteError: no such column: id` @ `pool-bettor-sides-query.mjs:53`），并核实 `pool-bettor-sides-query.mjs`、`bshard-auto-settler.mjs`、`bshard-auto-settler.test.mjs` 三个文件在 `5f1b908e..346adbce` 之间的 diff **行数为 0**——(b) 完全没有碰过这条路径上的任何文件。这是一个独立于本 patch 的既有测试夹具/查询错位（另案，不阻塞本审）。

## 非阻塞观察：`pool.js:3676` 的 throw 形（J2 请我判）

`assertAddressOnNetwork` 在这条只读的市场详情 GET 路由里以 throw 形使用（坏行 ⇒ 该请求 500）。这条路由只用网络值去拼 explorer 展示链接，不碰钱路/状态——500 是"粗但安全"（fail-closed，不会把错网络的地址拼进链接展示给用户），不是安全问题，是 API 友好度问题（客户端拿到 500 分不清"服务器真炸了"还是"这个市场在当前网络下看不了"）。**判断：可接受，不阻塞本次；建议记一张后续小票改成捕获后返回 404/410 类语义化响应，不必现在做**。

## 给 Bettor 的处置建议

- **GREEN，可推进落码**：b1（helper/包装/向量/lint WARN）非钱路，b2（33 处替换含 settler/voter/relay + lint 翻 BLOCK）钱路部分仍需 Owner 批，两笔口径与设计稿一致。
- 与 (a) 分支在 `relay-manager.js` 的相邻 hunk：我读过两边改动位置（(a) 改 `:69` 的 `rpcUrl` 段，(b) 改 `:48-63`/`:79-90` 的网络段），确实不重叠，J2"大概率能自动合并、按 (a)→(b) 顺序"的判断可信。
- `pool.js:3676` 的 throw 形留一张非阻塞小票，不必现在改。
