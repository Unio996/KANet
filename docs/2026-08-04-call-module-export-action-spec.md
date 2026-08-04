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
