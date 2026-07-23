# M0c-1 批C origin 标注 + lint 别名规则 — NWT diff 审 verdict

> **Status**: NWT diff 审 **GREEN**（2026-07-23）· arm 前提②（批C 迁移收口）标注侧+lint 侧闭环。
> **审对象**（6 commit 本地待审未 push）：`2b354852`（A桶 42 + B桶 22 TODO）/`5ca8411b`（trading 2 别名 TODO）/`2a3df7d2`（explorer URL 存量修）/`24da7ea9`（我的复核 doc）/`d40a345a`（完整清单 19 补标）/`7aa2d117`（lint R-SCA-ALIAS-ORIGIN）。
> **判据**（Bettor 派 load-bearing）：①origin 值==24da7ea9 清单 ②daemon 纯净 ③lint 别名检测正确+window-bleed 限界评估。

---

## ① origin 值 == 24da7ea9 清单：全匹配 ✅

**完整清单 19 处（d40a345a）逐 call 核**：
- 别名 8：bettor:1666 sca / exchange:600 sendCancelCmd / trading:2504+2589 sendCmd = **4 app**（请求触发通信）；settler:446+450 sca2 / exchange-machine:1021 sendCmd / mind:1080 sendCmd = **4 internal**（daemon 通信）。✅
- exchange.js 6 send_broadcast（publish:309/accept:498/confirm:657/dispute:721/resolve:804 + cancel:600）→ **app**。✅
- exchange-machine 4（:612/:708 timeout bcast + :974 transfer + :1018 delivered bcast）→ **internal**。✅
- mind:1080 → **internal**。✅

**A桶 42 + B桶 22 TODO（2b354852）**：零鉴权钱路面（pool 18 + relay :1726/:504 + trading action）**全标 `TODO(批3) 收敛类`，未误标 internal**——关键安全属性：收敛类钱路 call 不给 origin='internal'（否则 gate 当 daemon TCB 放行），留无 origin（当前 warn，armed 后 fail-closed 拒）+ TODO 待收敛。✅ daemon 真内部 call（voter ecdsa_sign/close-voter sign_input_for_settle/settler-router）标 internal 正确。

**机制 load-bearing 核（非装饰）**：`sendCommandAsync(relayNodeId, command, timeoutMs=30000, origin)` 第 4 参 → `if(origin!==undefined) payload.__origin=origin; else delete payload.__origin`。**origin 形参权威设置 __origin，且 else 分支显式 delete command 夹带的同名字段 = 防调用方经 command 对象伪造来源**——好的安全属性。批A relay 侧尚未读 __origin=当前 no-op（warn-first），gate arming 后读。标的值真流到 payload.__origin。✅

## ② daemon 纯净：7/8 纯，唯 exchange-machine:974 route-reachable（NOTE）

- **7/8 A桶 daemon 文件纯净**（0 route-import）：bshard-close-voter / settler-router / bettor-refund-claim-auto / oracle-pool-renewal-cron / relay-chain-reader / broker-buy-completion-watcher / retail-dex-pusher。其 internal 钱路 call（sign_input_for_settle/ecdsa_sign/sendAsset）只从 cron/tick 跑，非 route-reachable → internal 平凡安全。✅
- **bettor-prediction-voter "route-import 命中1" = 假阳**：`bettor.js:2308` 是一句注释（`// Called by bettor-prediction-voter.js sub 3`），非真 import。voter 是纯 cron daemon（startPredictionVoterCron/voterTick），internal 的 ecdsa_sign 只 cron 跑 → 纯净。✅
- **🔴 NOTE：exchange-machine.js 真 route-imported**（exchange.js:10 `import {processPaymentSubmit,...}` + bettor.js `transition`）。其 **:974 transfer（KAS auto-deliver，标 internal）经 processPaymentSubmit → _verifyAndComplete route-reachable**（trade-protocol-filter:2349 触发链）。
  - **internal 标注对不对？对**——:974 由 daemon deliveryAgent 执行（无 app 身份，标 app 会让 daemon 无信封 fail-closed 拒断 auto-deliver），且只在链上支付验证过后才发 → internal 是执行语义的正确标。
  - **但这是"共享模块 internal 钱路"非纯 daemon**：场景-A 攻击者经零鉴权 exchange route（收敛类 TODO）注入伪 offer/paymentSubmit → 驱动 daemon 到 :974。**gate 不会 scope-check :974（internal 放行）**，所以 :974 的场景-A 安全**完全依赖上游**：(a) exchange route 授权收敛（publish/accept 加 origin=app+grant，且 scope 必须绑 offer 经济量 give_amount/deliveryTarget，非只 scope send_broadcast 通信）+ (b) 链上跨链支付验证严实。**arm 收敛设计必须显式写死这两条**——否则 app-scope 只管住通信 call，管不住真 KAS 交割量。非本批标注错（值对），是 arm 前置收敛设计的场景-A 必备件。

## ③ lint R-SCA-ALIAS-ORIGIN：检测正确，window-bleed 非 gate-bypass ✅

- **检测覆盖对**：4 别名形态（解构重命名 `{sendCommandAsync:X}` / import-as / 裸值赋值 `const X=sendCommandAsync` / 裸值传参 callback `foo(sendCommandAsync)`）全覆盖，命中现存 8 别名族。自测三路（6 标注文件 0 warn / 隔离反例告警 / 裸值告警）。假阳风险低（import 静态 `{sendCommandAsync}` 前导 `{` 不在 `[(,]`，不误报）。✅
- **window-bleed 假阴（KANet-UI 诚实标）评估**：6 行窗口内任一 origin 字面量满足即放过 → 相邻 call 的 origin literal 可掩盖本 call 缺 origin = 漏报。**但这不是 gate-bypass**：gate（relay 侧 authorize.mjs）独立读 cmd.__origin，未标 origin 的 call → payload.__origin 被 delete → gate fail-closed 拒。lint 是**开发期预检**（让 dev 上线前补标），非执行闸。window-bleed 顶多让某未标别名 call 漏 warn → 上线 → armed 时 gate fail-closed 拒该路径（availability 断，实战 harness arm 测抓），**非静默安全洞**。且收敛类钱路 call 是**直接调用**（非别名），本规则不管它们 → window-bleed 只涉通信别名 call 的标注完整度，低危。
- **warn-first 可接受，升 ERROR 前修**：把 6 行窗口紧成"同一 call 实参跨度"检查（解析 call 的 arg span，非行窗口）即消假阴。KANet-UI 已诚实标"升 ERROR 前随 NWT diff 审定精化"——同意，作升 ERROR 的前置。

---

## 判据：GREEN → push OK

- ①origin 值全匹配我 24da7ea9 清单（含收敛类正确留 TODO 非误标 internal）；机制 __origin 权威+防伪造 load-bearing。
- ②daemon 纯净 7/8 + voter 假阳澄清；exchange-machine:974 route-reachable 是 NOTE（值对，场景-A 安全归 arm 收敛设计，非本批错）。
- ③lint 检测正确，window-bleed 非 gate-bypass、只涉通信别名、可接受 warn-first。
- **2 note 非 blocker**：(A) arm 收敛设计必须写死 exchange route app-scope 绑 offer 经济量 + 支付验证（因 :974 internal route-reachable）；(B) lint 升 ERROR 前把行窗口紧成 call-arg-span 消 window-bleed。均归 arm 前置，不挡本批 push。

**arm 前提②（批C 迁移收口含别名穷尽）标注侧+lint 侧闭 = 本 diff 审 GREEN**。剩 arm 前提①（grant/envelope 非 stub，J2 app provision 0bf4588a 落码待我审）+ ③（provision 实，同批）。

**关联**：`docs/2026-07-23-NWT-m0c-1-complete-list-alias-exchange-mindmgr.md`（完整清单复核）、`docs/2026-07-23-NWT-m0c-1-per-route-classification.md`（§9）。
