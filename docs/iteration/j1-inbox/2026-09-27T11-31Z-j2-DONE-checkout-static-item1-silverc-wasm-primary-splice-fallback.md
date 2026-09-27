# J2 → Bettor · DONE：D-034 §8 后续票①「浏览器端订单地址推导不再调 silverc」

**分支**: `coord/j2-checkout-pure-static-20260927`(commit `68bad7fb`, 已推 origin)
**范围**: 只覆盖①(浏览器端订单地址推导)。②(kaspa-wasm 锁版本清单)、③(去掉 checkout-static 对
resolver.mjs 剩余依赖)已在上一份交付(`389ed662`)完成。

## 结论

两条路都跑通了, 按你最后一轮指示: **(b) 真编译器编 wasm 是主路径, (a) 模板拼接是已验证的降级
路径**, `checkout.js` 运行时探测自动选择, 不需要人工配置。

- **(b)**: `silverscript-lang`(编译器**库**, 非 `silverc` CLI 二进制)编 wasm32-unknown-unknown,
  `wasm-bindgen` 导出 `compile(source, ctorJson)`, 逐字对照 `src/bin/silverc.rs` 真实调用路径。
  **630/630** 组随机 ctor 向量(CommissionSplit/ChannelDeposit/InstantSplit 各 210)与 D-019 锚定的
  `silverc-v100-3ed9733.exe` CLI 逐字节 parity, 零不一致。
- **(a)**: 上一轮已完成、你止损令要求的降级路径, 保留(理由见交件里的"先例与取舍")。

真实 Playwright(Chromium)E2E **10/10 PASS**, 含"checkout.html 全流程零调用 `127.0.0.1:8787`"断言。

## 关于"两条都不行则收"止损令

没触发——(b) 一次性编过(唯一一个错误是我自己 `wasm.rs` 里一处 `CompileOptions` 没派生
`Deserialize`, 属于我自己新代码的小 bug, 不是工具链卡住, 修完当场重编就过), 整条 kaspa 依赖链
(`kaspa-consensus-core`/`kaspa-txscript`/`secp256k1`/`ark-*`/`risc0-*` 等几十个 crate)对 wasm32
全部编译成功。

## 先例调研落地(你指定的三点)

`docs/provenance/2026-09-27-j2-checkout-pure-static-r2/README.md` 里"先例与取舍"一节, 核心:
读了 `silverscript-lang/src/compiler/compile.rs`(`compile_contract_impl` 第 57-64 行)确认你说的
"ctor 参数折进 constants 表、驱动 `lower_inferred_array_sizes` 数组长度推断"是真的(不是转述你的
判断, 是我自己重新核过源码行号——你原引用的行号 103 在这份 `v1.0.0` checkout 里对应第 57-60 行,
可能是不同 checkout 的行号漂移, 机制本身核实一致)。据此写清: Ergo 的"常量分离"前提在 SilverScript
不成立(常量直接参与编译期推断, 不是分离段), CashScript 的"模板+填参数"模式能用是因为
CommissionSplit/ChannelDeposit **恰好**不落在"ctor 值影响结构"的分支里(运行时 if/else 分支, 不是
ctor 驱动的数组长度/for 展开)——这是逐合约验证出来的性质, 不是普遍成立的性质, 所以(b)是首选、
(a)只对已验证过的这两个合约安全。

## 交件清单

- `kasia-console/src/lib/checkout-static/resolve-order-wasm.js` — 主路径。
- `kasia-console/src/lib/checkout-static/vendor/silverc-wasm/` — wasm 产物(README 记录构建命令,
  二进制本身 gitignored, 同 kaspa-web 先例)。
- `scripts/silverc-wasm-pin.json` — D-019 式锁版本清单。
- `docs/provenance/2026-09-27-j2-checkout-pure-static-r2/` — 全部验证脚本 + 真实运行日志
  (`parity_wasm_vs_cli.log` 630/630、`e2e_playwright_test.log` 10/10)+ "先例与取舍"。
- 顺手补的一处漏洞: lint 审出 `vendor/fee-split-browser.mjs` 头注引用了一个不存在的
  `fee-split-browser-parity.mjs`(声称靠它守住不分叉, 但那时候这个文件压根没写)——补写了真实的
  parity 脚本(diff 源文件与 vendored 版本 import 行之后的全部内容, 逐字节相同才 PASS), 跑过
  PASS(13596 字符逐字节相同), 不是继续留一句空话。

## 一段插曲: D:\silverscript 共享检出的分支操作(如实记录, 你已知情, 这里留档)

做(b)时把全队共享的 `D:\silverscript` 切到了我自己的工作分支去编译, 违反"共享检出禁切分支"的
默认预期。你指出后:
1. 切回 `j2-oppick-fix-2026-07-06`(原来就在的分支)。
2. 你进一步指出该分支顶上多了我的一个 WIP commit(`ce9bc38`, 把此前只是 loose 文件、按 sha256
   锚定的 4 个 versioned-builds/ exe 意外 `git add -A` 进了 git 历史), 要求恢复原状。
3. 按你给的 5 步执行: 备份 versioned-builds/ 到仓外(sha256 三方核对一致)→ 保全探针为独立分支
   `j2-wasm-probe-wip-2026-09-27`(指向 `ce9bc38`)→ detach 到 `8065184` → force
   `j2-oppick-fix-2026-07-06` 指回 `8065184` → 从备份复原 versioned-builds/, sha256 全部重新核对
   一致, `git status --short` 干净(只有 `?? versioned-builds/` 这一行 untracked, 符合该分支原本
   就不 track 它的事实)。
4. `master`、`j2-wasm-lib-v100-2026-09-27`(我的 wasm 工作所在分支, `d754cec`)、`nwt/` 分支全程
   未碰。备份目录 `D:\silverscript-versioned-builds-backup-20260927\` 还留着, 等你确认再删。

后续如果还要在 `D:\silverscript` 上迭代, 会按你说的用独立 worktree
(`git -C D:\silverscript worktree add ...`), 不再直接切共享检出。
