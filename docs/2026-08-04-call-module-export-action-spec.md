# `call_module_export` — test-framework action 契约(设计一页纸)

> **Status**: CURRENT · **DESIGN-ONLY,未落码** — 按 Bettor 08:00「加 action 属共享基础设施改动,按 D-012 §5 层级纪律走:设计一页纸(action 契约 + 它能调什么不能调什么 + 失败语义)→ NWT 审 → 落码」。
> **授权**:@NWT 07:59 裁定选 (A);@Bettor 08:00 照准并加两条硬约束(**收窄到 allowlist** / 先出 spec)。
> **归属**:J2。**与 @KANet-UI 的 runner 硬化卡不同文件**(他改 `test-framework/lib/env-bootstrap.mjs`,本卡改 `test-framework/lib/runner.mjs` 的 action 表),他 08:06 已确认不撞车、可并行。

## §1 为什么要它(不是权宜之计,是补一个真实缺口)

两条**都已生效**的硬要求,在今天的框架下**互斥**:

| 要求 | 出处 |
|---|---|
| 测试**必须调生产消费者与授权 helper 本体**,不得复刻 SQL、不得做源码文本检查 —— 复制谓词会产出两个互相同意、而实现已漂移的测试 | Codex 第八轮(bridge `2819d2b6`),经 (139)补32 |
| 测试**必须在 runner 扫描面内**(`--domain`/`--all` 扫得到),否则是"会蒸发的证据" | Bettor;在册「可执行 ≠ 持续覆盖」 |

而框架现有 **36 个 action**(`send_message`/`exec_sql`/`query_db`/`http_post`/…)**没有任何一个能调用一个 JS 模块导出**。
⇒ 想真调生产函数的用例只能写在 `cases/` 之外(如 `src/services/*.test.mjs`)⇒ `--domain` 扫不到。**昨晚卡② 那个 handler 测试就是栽在这**(还要 `--experimental-test-module-mocks` 才跑得起来)。
🔨 **⇒ 这个缺口不是我这张卡独有的**,它是"要么真调、要么被扫到,二选一"这个结构性两难。本 action 就是把它变成不互斥的那一块。

## §2 契约

```
{
  action: 'call_module_export',
  module: '<allowlist 中的键>',      // 不是路径! 见 §3
  export: '<函数名>',
  args:   [ ... ],                   // 可选; 支持 '$db' 占位符
}
```

**返回**(设计成**零新增断言**,现成断言直接可用):
```
{ ok: true,  result: <原返回值>, reply: JSON.stringify(result) }
{ ok: false, error: '<原因>', threw: true, reply: '__THREW__: <原因>' }   // 抛异常时
```
· `reply` 字段让 `reply_contains` / `reply_does_not_contain` / `reply_matches` 立刻可用,**不必为它扩断言表**。
· 🔴 **抛异常与"返回了拒绝"必须分得开**(`threw: true` + `__THREW__` 前缀):否则"函数崩了"会被读成"函数拒绝了" —— 而本卡要证的恰恰是"它拒绝了",两者混淆等于测试失效。

## §3 🔴 能调什么:**allowlist,不是任意路径**(Bettor 硬约束)

**`module` 字段不接受路径,只接受 allowlist 里的键。** allowlist 与本 spec 同文件维护,新增条目 = 改 spec + 过审。

| 键 | 实际模块 | 允许的导出 | 为什么它该在表里 |
|---|---|---|---|
| `refund-authorization` | `src/lib/refund-authorization.mjs` | `assertBettorRefundAuthorized` | P1 共享授权验证器本体 —— Codex 点名要求"调 helper 本体" |
| `bettor-refund-claim-auto` | `src/services/bettor-refund-claim-auto.mjs` | `claimAutoDispatcherTick` | P1 旁路的**生产消费者**本体 —— Codex 点名要求"调生产消费者" |
| `pool-buildBettorRefundClaim` | `src/api/pool.js` | `buildBettorRefundClaim` | 🔴 **v2 补(NWT 08:18 ①)**: 两个 IPC 调用点的**另一个**。只放 cron 那条, e2e 就只证明了一半旁路真的闭了 —— 而 settler tick 与无鉴权 HTTP 端点都经这个函数。**漏了它, #11 的 regression 会留一个与 Codex round 6 同形的洞(证明了 A 闭合就当成两条都闭合)。** |

**为什么必须是 allowlist 而不是任意导出**(照抄 Bettor 的理由并补一条):
- 「别把它做成"能调任意导出"的万能口 —— 那等于给测试框架开一条绕过一切声明式约束的路,以后没人知道某个用例到底碰了什么。」
- 🔴 **我补一条**:任意路径还会让**用例变成一个可以调用任何生产函数的执行面**。测试库里出现一个"能调任何东西"的 action,等于把 `cases/` 的信任级别提到与生产代码同级 —— 而 `cases/` 的准入门槛远低于生产代码。**allowlist 让"这个用例碰了什么"在 spec 里就能读出来,不必去读用例。**

## §4 失败语义(fail-loud,不 fail-soft)

| 情形 | 行为 |
|---|---|
| `module` 不在 allowlist | `ok:false`,错误明说"不在 allowlist",**不尝试当路径解析** |
| `export` 不在该键允许的导出集合 | `ok:false`,明说允许哪些 |
| 该导出不是函数 | `ok:false`,报实际 typeof |
| 被调函数抛异常 | `ok:false, threw:true`,**不吞** |
| 被调函数返回 | `ok:true`,原值进 `result`,JSON 进 `reply` |

🔴 **一条都不许 fail-soft**:任何"出错了就当没调"的分支,都会让"用例其实没跑到被测代码"与"跑到了且通过"读数相同 —— 那正是这套用例要防的形状。

## §5 `$db` 占位符(为什么需要它)

生产函数(如授权验证器)要一个 db handle 参数。若让用例自己拼库路径,就会出现"用例连到了另一个库"这种同形失败(今天 J1 那次两机两库正是这个家族)。
⇒ `args` 里任何**恰好等于字符串 `'$db'`** 的值(含对象字段值),由 action 替换成连到**测试库**的 handle,并在调用结束后关闭。
🔵 与 @KANet-UI 的 runner 硬化卡是**净利好组合** —— 但**它成立有前提,而这个前提今天刚被他自己查窄了,所以要写清楚而不是当默认**:
- 他 08:13 报的架构缺口:DB 隔离**只对"runner 自己进程直连 DB"的 action 生效**(`query_db`/`exec_sql` 那类在 runner 进程里 `new Database(DB_PATH)`);**对"打 HTTP 给 console server"的那类完全无效**(server 是另一个进程,读它自己的 `DB_PATH`)。
- ✅ **本 action 落在【生效】那一侧**:它是 `await import(...)` 把生产模块**载进 runner 自己的进程**再直调,不经 HTTP、不跨进程 ⇒ `$db` 拿到的就是 runner 的隔离库。
- 🔴 **但这条"落在生效侧"是本 action 的【设计约束】,不是运气** ⇒ 写死:**本 action 永远不得改成"通过 HTTP 触发生产函数"**(那会一步跨到无效侧,而且不会有任何东西报错 —— 用例照样绿,只是它打的是生产库)。
- ⚠ **被调函数自己若发起 HTTP/relay IPC,那部分不在隔离射程内** —— 这与 §6 的边界一致:需要真 relay/链的场景不属于本 action 的射程。

## §6 本 action **不**做什么(边界,防被读大)

- **不**支持任意路径、不支持 `require`、不支持动态拼接模块名。
- **不**替被调函数准备 relay/链上环境 —— 需要真 relay 的用例不属于本 action 的射程(它们的问题域是链上写入,不是"能不能调到函数")。
- **不**做 mock/存根注入。本 action 的用途是"**真调**",要 mock 的场景不该用它。

## §7 落码后要证明的(不是本 spec 的范围,但先写死判据)

1. allowlist 外的模块 ⇒ 拒(阴性)。
2. allowlist 内的模块 + 不允许的导出 ⇒ 拒(阴性)。
3. 正常调用 ⇒ `reply` 里出现被调函数真实返回值的字段(阳性对照,防"全拒装饰")。
4. 被调函数抛 ⇒ `threw:true` 且**不**被记成"拒绝"。

## §8 v2 修订(NWT 08:18/08:19 审)—— §5 那句我说宽了,改成"靠代码检查"不是"靠注释排序"

### §8.1 🔴 `$db` 只对**显式收 db 参数**的导出成立,而 allowlist 里三条有两条不是

**实读**(不是同意转述):
- `assertBettorRefundAuthorized({ marketId, db })` ⇒ **收 db 参数** ⇒ `$db` 占位符**够得到**。✅
- `claimAutoDispatcherTick()` ⇒ `bettor-refund-claim-auto.mjs:31` **零参数**;db 来自 **模块顶层** `:11 import { sqlite } from '../db/client.js'` ⇒ **`$db` 完全够不到它**。
- `buildBettorRefundClaim(marketId, {bettorPk, sideId})` ⇒ 同上,也不收 db。

⇒ **我 §5 写的"`$db` 拿到的就是隔离库"只对三分之一成立。** 另外两条的隔离**来自完全不同的一条路**:`env-bootstrap.mjs` 作为 side-effect import **排在 `runner.mjs` 之前**跑,先把 `DB_PATH`/`KANET_DB_PATH` 设好,于是 `db/client.js` 顶层 const 求值时读到的已经是隔离库。

### §8.2 🔴 而那条路的保证今天**只是一行注释**

`env-bootstrap.mjs:14-15` 逐字:「**必须在 runner.mjs import 之前 import**……本模块作为 side-effect import 排在 runner 之前 → env 先就位」。

**这正是我自己 08:12 立的那条判据打在自己身上**:**「任何写在被调方文件里的警告,都拦不住调用方。」** 这里被调方 = `db/client.js`,调用方 = 未来的 `call_module_export` 实现。
🔴 **失败模式不是报错,是静默**:若谁改了 import 顺序、或本 action 的动态 import 在 env-bootstrap 完成前被触发 ⇒ `db/client.js:10` 的 `resolve(process.env.DB_PATH || './data/console.db')` 落到 **CWD 相对的生产默认路径** ⇒ **用例照样全绿,只是它打的是生产库**。(而"cwd 漂移"这条本仓 memory 里就有,今早我自己刚撞过一次。)

### §8.3 ⇒ 落码硬要求(把安全性质从"靠排序"改成"靠检查")

**在第一次动态 import 任何 allowlist 模块之前**,`call_module_export` 内部必须做一次**运行时断言**:
```
确认 process.env.DB_PATH 当前值落在 test-framework/data/ 下(不是生产默认路径)
  ├─ 满足 ⇒ 继续
  └─ 不满足 ⇒ fail-loud 拒绝(ok:false + 明确 reason), 不静默放行
```
- 🔵 **这不是给卡加范围**,是把 §5 已经声称成立的安全性质**换一个更硬的守护方式** —— 与全队今早在发送器上做的是同一件事(把"记得"换成"走不通"),只是换了个位置。
- 🔴 **断言必须在 import 之前**:import 一旦发生,`db/client.js` 的顶层 const 就已经求值,那时再检查是**检查了一个已经定型的值**,救不回来。
- §7 的落码后判据**追加第 5 条**:把 `DB_PATH` 人为指向生产默认路径 ⇒ 本 action 必须**拒绝并说明**,而不是照常返回结果。

### §8.4 记账

- allowlist 由 2 条 → **3 条**(补 `pool-buildBettorRefundClaim`)。**理由不是"顺手多加一个"**:两个 IPC 调用点只测一个,等于把 Codex round 6 那个"证明了 A 闭合就当成两条都闭合"的洞原样搬进 regression。
- §5 原文**不删**(保留历史),由本节收窄 —— 与本仓"动不得的原文补注、能删的漂移副本才删"的通则一致。

## §9 拿 Bettor 08:20 升级后的判据回查本 spec 自己的验收条 —— **第 5 条不合格,已换**

> **升级后的判据(Bettor,记 KANet-UI 名下)**:「两侧都读数」不够,还要**确认你读的那个数,在【机制失效】的情形下会变得不一样**。带 cleanup 的用例、会自愈的状态、被覆盖的日志,都会让两种情形读出同一个数。

**逐条回查 §7 的落码后判据**:

| # | 判据 | 机制失效时读数会不会不同 | 结论 |
|---|---|---|---|
| 1 | allowlist 外模块 ⇒ 拒 | 会(失效则被放行并返回结果) | ✅ 合格 |
| 2 | allowlist 内 + 不允许的导出 ⇒ 拒 | 会 | ✅ 合格 |
| 3 | 正常调用 ⇒ `reply` 出现真实返回值(阳性对照) | 会(失效则拿不到值) | ✅ 合格 |
| 4 | 被调函数抛 ⇒ `threw:true` 且不被记成"拒绝" | 会 | ✅ 合格 |
| 5 | `DB_PATH` 指生产 ⇒ 本 action 必须拒 | 🔴 **不一定** | ❌ **不合格,见下** |

### §9.1 🔴 第 5 条为什么不合格(这正是 §8.3 那条要防的缺陷,而它测不出来)

§8.3 的硬要求是「断言必须排在**动态 import 之前**」。而第 5 条只断言"**结果是拒绝**":
- 断言写在 import **之前** ⇒ 拒绝 ✅
- 断言写在 import **之后** ⇒ **也是拒绝** ✅ —— 但此时 `db/client.js` 的顶层 const **已经用错的 DB_PATH 求值完毕**,生产库已经被连上了。
⇒ **两种情形读出同一个数(都是"拒绝")** ⇒ 这条判据**分不开"断言位置对"与"断言位置错"**,而位置正是 §8.3 唯一要保证的东西。**它是一条会被自己要防的缺陷通过的判据。**

### §9.2 换成能分开的那条

**第 5 条改为**:把 `DB_PATH` 指向生产默认路径后调用本 action,断言**同时**满足:
1. 返回 `ok:false` 且 reason 指明 DB_PATH 不合法(原判据保留);
2. 🔴 **该 allowlist 模块【从未被 import】** —— 判别方式:检查 Node 的 ESM 模块缓存里不存在该模块的 URL(或等价地,断言该模块顶层的可观测副作用没有发生)。
⇒ 断言若被误放在 import 之后,**第 2 项当场红**,而它红在自己身上(名字写着"import 之前")。

🔨 **这一条本身就是今天那把尺的第四个位置**:昨晚"删掉守卫看红的是不是它自己" → 今早"最坏后果必须实测不能凭印象" → 08:20"读的数在机制失效时会不会不同" → 现在"**判据要能分开【做对了】和【做错但结果碰巧一样】**"。**我这条 spec 差点带着一条会自己放行自己缺陷的验收条进落码。**

---

## §10 v3 修订(2026-08-06 · J2)—— 新增第 4 条 allowlist 项 `pool-market-settler / poolSettlerTick`

> **授权**: @NWT 2026-08-06 批「allowlist 增项走改 spec + 审」· @Bettor 同日排为前置⑤ §6 闸一。
> **用途**: D-012 冻结前置⑤ 的预注册用例(`docs/2026-08-06-precond5-verification-interrupt-no-autorefund-test-design-v0.1.md` v0.2)需要驱动**真实**结算 tick。
> **原文一字未删**;本节是独立变更块。

### §10.1 申请增加的条目

| 键 | 实际模块 | 允许的导出 | 为什么它该在表里 |
|---|---|---|---|
| `pool-market-settler` | `src/services/pool-market-settler.js` | `poolSettlerTick` | 前置⑤ 的命题是「**验证中断 ⇒ 市场不得自动进入退款广播路径**」。预注册原文要求 mock `dispatchRefund` 断言零调用, **而 2026-08-06 实核该形态在本仓做不成**(ESM 只读 live binding, 内部调用够不到外部替换;loader hook 与本 spec §3 的设计意图正面冲突)。替代形态 = **驱动真实 tick + 断言落库痕迹为零**, 它需要能调 `poolSettlerTick`。 |

### §10.2 🔴 这一条与现有三条**不是同一类东西**(本节的承重段, 请先读这一格再决定批不批)

```
现有三条: assertBettorRefundAuthorized / claimAutoDispatcherTick / buildBettorRefundClaim
          —— 都是【判定或构造】类: 你问它一件事, 它回答。
新增这条: poolSettlerTick —— 是【驱动生产结算】的 tick 本体。
```
🔴 **两处实读差异, 必须写在 allowlist 表旁边**:
1. **它会写 DB**: 状态迁移(`unresolved_needs_authorization`)、metadata 更新、事件写入 —— 这正是用例要断言的东西, 但它意味着**本 action 从"调用一个函数"变成"让生产逻辑跑一轮并改库"**。
2. 🔴 **它这条路上有外呼**: `pool-market-settler.js` 的 tick 区间(`:546-1520`)内 `relayPost` / `fetch(` / `chainReader` **实为 4 处调用点、其中 3 处读返回值**。
   > 🔴 **勘误(2026-08-06 · J2 自查 · 本行原写"12 处命中")**: 那个 12 是 `grep -c` 的**行数**, 把注释行也数了进去 —— **"命中行数"不是"调用点个数"**, 而我当时按后者用了它。
   > 与同日另一次数错**方向相反、病因相同**(那次把 4 个数成更少): 🔨 **枚举要按"被枚举物的定义"数, 不按"工具恰好输出几行"数。**

⇒ **⇒ 本条不是"再加一行表", 是【把 allowlist 的性质从"可调的判定函数集合"扩到"可驱动的生产流程"】。** 我把它单独说出来, 因为**批准它的人应当是在知道这一点的前提下批的**。

### §10.3 因此本条附带的硬约束(与条目本身同批生效, 缺一条则本条不成立)

| # | 约束 | 为什么 |
|---|---|---|
| A | **沿用 §8.3 的 DB_PATH 双变量断言**(`DB_PATH` 与 `KANET_DB_PATH` **各自独立**落在测试库目录下, 任一不满足 ⇒ 拒绝 import) | `poolSettlerTick()` **零参数**, db 来自模块顶层 import ⇒ **`$db` 占位符够不到它**(与 §8.1 里 `claimAutoDispatcherTick` 同类)。它写库, 所以"打错库"的后果比前三条重。 |
| B | 🔴 **用例必须自证 tick 的处理面只含自己种的 fixture** | 已实测前提: `test-framework/data/test-console.db` 的 `pool_markets` = **0 行**(2026-08-06 当场查)。**但这是【当时的读数】不是不变量** —— 别的用例可能往里种市场。⇒ 用例应在驱动前断言"待处理集合 == 我种的那些", 而不是依赖"库本来是空的"。 |
| C | 🔴 **外呼必须是【预期会失败】而不是【预期不会发生】** | 离线 harness 无 relay ⇒ 那 4 处外呼**会被尝试并失败**。⇒ 用例不得把"没有外呼"写进断言(它不成立);正确写法是断言**落库痕迹**, 并接受外呼失败是环境常态(⑤ 稿 §3-bis 已把"无 RPC"钉为全臂共享环境前提)。 |
| D | **本条只允许导出 `poolSettlerTick` 一个** | 同文件另有 `dispatchRefund` / `dispatchPhase2` / `authorizeRefundByOwner` 等**直接动钱**的导出。**放开文件 ≠ 放开文件里的一切** —— allowlist 的粒度是"键 + 允许的导出集合", 本条严格用这个粒度。 |

### §10.4 我明确**没有**验的(标死, 不许被读成已验)

- 🔴 **我没有实跑过 `poolSettlerTick` 在测试库上的完整一轮** —— 上面 A–D 是**设计约束**, 不是实测结论。**落码时若发现 tick 在离线环境下有别的副作用(例如写文件、起定时器), 属新发现, 应回来改本节而不是绕过它。**
- 🔴 **那 4 处外呼我只做了计数, 没有逐个分类**(哪些在本用例的六臂路径上会被触达、哪些不会)。⇒ 约束 C 是按"最坏情况"写的。
- 🔵 **`poolSettlerTick` 是否起后台定时器 / 是否需要配对的 stop** —— 未查。同文件有 `startPoolMarketSettlerCron` / `stopPoolMarketSettlerCron`(`:188/:202`), **本条只申请 tick 本体、不申请 cron**, 但"直接调 tick 会不会顺带起东西"我没验。

### §10.5 记账

- **本条不改 §3 原表, 不改 §4 失败语义, 不改 §8.3 的落码硬要求** —— 它复用它们, 并额外加 §10.3 四条。
- 🔴 **若审阅者认为 §10.2 那条性质扩张不可接受**, 正确处置不是削弱约束, 而是**否掉本条并让 ⑤ 的用例另寻形态** —— 那时 ⑤ 的落码路径需要重新设计, 而这比"批了一条自己不理解的 allowlist"便宜。
