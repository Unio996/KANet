# D-034 §8 结账页真正纯静态 · Round 2 证据目录

Bettor 派工(2026-09-27, `coord/j2-checkout-pure-static-20260927`)后续票三项(①②③)中,
①"浏览器端订单地址推导不再调 silverc"的完整调查/实现/验证证据。②(kaspa-wasm 锁版本清单)、
③(去掉 resolver.mjs 剩余依赖)已在 Round 1(见同仓另一份交付)完成, 本目录只覆盖①。

## 时间线(三轮, 每轮 Bettor 的判断都推进了下一轮)

1. **第一轮**: 用"比较两个任意 ctor int 值、取字节差异区间"的方法判断 ctor 字段是变长编码,
   结论"浏览器端固定偏移拼接不可安全达成", 建议关闭方向。**这个结论是错的**——根因是方法论
   缺陷: 两个比较值的高位字节恰好都是 0 时, diff 算法只报告"实际不同的字节", 会把定长字段的
   真实宽度报小。
2. **第二轮**(Bettor 止损令: 两条都不通就收): 修method 后用三条独立证据坐实——① 编译产物总长度
   在 ctor int 全值域(0 到 2^53-1)下恒定; ② 直接读字节, 每个 int 字段固定是 `0x08` push-opcode +
   8 字节 LE, 全值域一致; ③ 用两组完全不重叠的哨兵值同时 diff 全部 30 个字段, 干净地定位每个
   字段的起始偏移。据此实现 `order-template.js`(模板 + 固定偏移覆写), 320/320 组随机向量与真实
   `silverc.exe` 逐字节 parity, 8/8 真实 Playwright E2E(含"零调用 resolver.mjs"断言)。
3. **第三轮**(Bettor 先做了 CashScript/sCrypt/Ergo/silverscript 上游的先例调研 + 自己核
   `compile.rs` 源码, 指出第二轮方法论对**这份合约**成立、但不是通用解——见下方"先例与取舍"):
   改为让 `silverscript-lang`(编译器**库**, 非 `silverc` CLI 二进制)编成 `wasm32-unknown-unknown`
   真编译器, 浏览器直接调用**同一段编译逻辑**。630/630 组随机向量(210×3, CommissionSplit/
   ChannelDeposit/InstantSplit)与 D-019 锚定的 `silverc-v100-3ed9733.exe` CLI 二进制逐字节 parity,
   10/10 真实 Playwright E2E(以此为主路径, 第二轮的 `order-template.js` 保留为验证过的自动降级
   路径, 见 `checkout.js`)。

## 先例与取舍(Bettor 指定引用三点)

### 1. CashScript(Bitcoin Cash)的 artifact 模式

CashScript 编译产物(`.json` artifact)带一份**已预置字节码的模板**(`bytecode` 字段, 常量参数处
留占位), JS SDK 的 `new Contract(artifact, args)` 在客户端**填参数**生成地址, 不需要浏览器里跑
编译器本身。这正是第二轮(`order-template.js`)采用的模式——**对适用的合约形状是对的**: 结构不随
参数变化, 只需要"编译一次、填参数很多次"。

### 2. Ergo(sigma-rust)的常量分离

Ergo 的 ErgoTree 把"脚本结构"与"常量段"物理分离——常量在字节码的一个独立、可寻址的段里, 运行时
替换常量不改变脚本树结构本身。这是"模板 + 参数槽位"这类设计能安全工作的**前提条件**: 常量替换
不能影响结构, 否则模板就不是同一个模板了。

### 3. silverc 自己的常量折叠(这是取舍的关键, 不是照抄前例就够)

真读了 `silverscript-lang/src/compiler/compile.rs`(`compile_contract_impl`, 本仓 `v1.0.0` tag
`3ed9733` 第 57-64 行)——ctor 参数在编译**最早期**就被塞进一张 `constants: HashMap<String, Expr>`
(第 57-60 行), 紧接着这张表被传给 `lower_inferred_array_sizes(contract, &constants)`(第 64 行)
去**推断数组长度**、驱动 `for` 循环展开、做长度定点迭代——不是元数据, 是真的会改变编译输出的
结构(不只是某个固定偏移的字节值, 而是整个脚本的长度和形状都可能随 ctor 值变化)。

**这就是为什么 Ergo 的"常量分离"前提在 SilverScript 不成立**: SilverScript 的常量不是分离在一个
独立段里的、替换不影响结构的值——它们直接参与编译期的类型/长度推断。CashScript 的"模板 + 填参数"
模式能用, 是因为它先验证过(第二轮做的三条独立证据)**这份具体合约不落在"ctor 值影响结构"的分支
里**——CommissionSplit/ChannelDeposit 的角色数/长度都是运行时 `if/else` 分支, 不是 ctor 驱动的数组
长度/for 展开, 所以碰巧安全。但这是**逐合约验证**才能确认的性质, 不是普遍成立的性质——对使用
ctor 值做数组长度推断的合约(SilverScript 语言层面允许、也被 `lower_inferred_array_sizes` 明确
支持), 模板拼接在原理上就是错的, 不是"还没验证过", 而是**验证也救不了**(用有限随机向量对一个
理论上无限的结构空间做归纳, 本身就不构成证明)。

### 取舍结论

**第三轮(b, 真编译器编 wasm)是首选**: 因为它跑的是**同一段编译逻辑**(不是重新实现/归纳一份等价
逻辑), 对任何合约形状都天然正确, 不需要逐合约验证"这份合约结构不随参数变化"这条前提。
**第二轮(a, 模板拼接)保留作已验证的降级路径**, 理由是: ① 对 CommissionSplit/ChannelDeposit 这两
份**已验证过**的合约, 它是对的, 删掉已验证的工作没有必要; ② `checkout.js` 运行时探测(silverc-wasm
加载失败时自动切换), 提供一层容错, 不是设计上依赖它兜底(b 失败率理论上应该趋近于 0, 因为它没有
"这份合约是否属于安全子集"这个前提假设)。

## 目录内容

- `parity_wasm_vs_cli.mjs` / `.log` — silverc-wasm(b) 与 D-019 锚定的 CLI 二进制, 630 组随机
  ctor 向量(CommissionSplit/ChannelDeposit/InstantSplit 各 210)逐字节 parity, 全通过。
- `e2e_playwright_test.mjs` / `.log` — 真实 Chromium(Playwright)端到端: 建报价 → 归因链接 →
  结账页浏览器原生验签/验链/去重 → 订单地址推导(silverc-wasm 主路径)→ 断言零调用 `resolver.mjs`。
  10/10 PASS。
- `static_server2.mjs` — 测试用最小静态文件服务器(本地 `127.0.0.1:8899`, 不是生产组件)。
- `reverse_engineer_int_encoding.{sil,mjs}` / `verify_ctor_int_fixed_width.mjs` /
  `verify_width_vs_magnitude.mjs` / `find_offsets_v3_clean.mjs` — 第二轮三条独立证据的落地脚本
  (总长度不变性/直接读字节/双哨兵集 diff), 坐实"第一轮方法论有缺陷"这个判断本身。
- `build_and_verify_template_splicer.mjs` / `verify_deposit_splicer.mjs` /
  `verify_order_template_production_file.mjs` / `verify_resolve_order_browser_parity.mjs` —
  第二轮 `order-template.js`/`resolve-order-browser.js`(降级路径)的构建与 320/320 + 45/45 parity
  验证脚本。

## 相关权威文件(不在本目录, 在 checkout-static/ 与 scripts/ 下)

- `kasia-console/src/lib/checkout-static/order-template.js` — 降级路径: 模板 + 固定偏移覆写。
- `kasia-console/src/lib/checkout-static/resolve-order-browser.js` — 降级路径的角色解析+地址推导。
- `kasia-console/src/lib/checkout-static/resolve-order-wasm.js` — **主路径**: 真编译器 wasm 调用。
- `kasia-console/src/lib/checkout-static/vendor/silverc-wasm/README.md` — wasm 产物构建/核验说明。
- `scripts/silverc-wasm-pin.json` — D-019 式锁版本清单(sha256/goldenSample/parity 证据指针)。
