> **Status**: CURRENT

# test runner 发现面 + 真链用例机器可读标记 设计 v0.1

**作者**: J2(test-framework 域) · **日期**: 2026-07-28 · **派工**: Bettor 06:42(「这一格怎么做, 你出方案, 我不替你设计」)
**batch**: 第一段(能力清点与强制 —— 验收 probe 的可发现性属其配套)
**红队审**: @NWT · **起因**: NWT 06:38 实读 `scripts/test.mjs:25-44`, `cases/m0c1-gate/` 10 个文件 `--domain/--all` 一个都扫不到

---

## 0. 两句话

1. **扫不到**是真的,而**改名**这个修法会让一个花真钱的用例进无人值守入口 —— 今天靠"有人恰好读了那个文件的头"拦下,**那是运气不是机制**。
2. 所以本设计交两件:**A/B 分类(已逐个读完,非按名字)** + **一个机器可读的标记,由已有的 lint 闸强制**。

---

## 1. 分类 —— 逐个读过头部,不是 grep 出来的

⚠️ **方法交代**: 我第一版是 grep 关键字分的类,其中两个(`pilot-custodial-insert-regression` /
`provision-payee-regression`)当时**没读头部**。Bettor 06:42 裁定"以 J2 那份为准"之后我补读了,
结论未变但**依据换成了实读**。记这一句是因为:**同一份清单,grep 出来的和读出来的,在文档里长得一样。**

| 文件 | 类 | 实读到的依据 |
|---|---|---|
| `g5-pilot-custodial-real-chain-smoke.mjs` | 🔴 **B** | 头部原文「真广播到 testnet-12…真实身份/真实资金/真实链」+「🔴🔴 真钱预算: ≤2 KAS/单笔硬 cap + ≤5 KAS 累计护栏」+ 需活 Console |
| `door5-origin-matrix.mjs` | ✅ A | `startArmedRelay` 隔离(死 RPC 端口 `ws://127.0.0.1:1`)· throwaway 零资金私钥 |
| `g4-pilot-custodial-e2e.mjs` | ✅ A | 同上(头部自述「隔离环境, 死端口 stub 链」) |
| `g5-real-chain-smoke-regression.mjs` | ✅ A | 🔵 **名字里有 real-chain 而它不碰真链**: 头部原文「本地 loopback HTTP stub 模拟 runtime-identity 端点」+ migrate 出来的临时 DB |
| `pilot-custodial-insert-regression.mjs` | ✅ A | 头部: 真实调用两个 CLI(`execFileSync` 子进程)+ 临时 DB, 无链无钱 |
| `provision-payee-regression.mjs` | ✅ A | 头部: 真实调用 CLI `issue` 子命令 + 临时 DB, 无链无钱 |
| `runtime-identity-endpoint-regression.mjs` | ✅ A | `startArmedRelay` 隔离 |
| `seg1-default-deny.mjs` | ✅ A | `startArmedRelay` 隔离(本人所写) |
| `tg-wallet-pilot-isolation-regression.mjs` | ✅ A | `startArmedRelay` 隔离 |
| `harness.mjs` | ⚪ 非用例 | 被其它用例 `import` 的支持文件 —— 两边都别碰 |

🔵 **这张表最值钱的一行是 `g5-real-chain-smoke-regression`**:名字里带 `real-chain` 的那个**不碰真链**,
而要小心的是另一个。**⇒ 分类的键只能是「它跑起来会碰到什么」。**

---

## 2. 历史上这 10 个是怎么被跑的(Bettor 06:40 派问 · 已答)

```
① 🔴 全仓没有 CI: 无 .github/workflows; 无任何 yml/ps1/sh 引用 scripts/test.mjs
② 🔵 决定性证据 —— 两种日志命名不是一套:
   runner 产出:  logs/test-runs/2026-07-21T11-27-53_<case>.log   (时间戳前缀·每跑留一份)
   这 10 个产出: logs/test-runs/<name>-latest.json               (无时间戳·用例自己写·覆盖式)
   ⇒ logs/test-runs 里没有任何一份带时间戳前缀的日志属于这 10 个 ⇒ 一次都没从 runner 走过
③ 各自最后一次手工跑: harness 07-23 · door5 07-24 · g4/insert/payee/tg-wallet 07-25 00:05(同一分钟
   四个 = 一次人工扫)· g5-regression 07-25 · seg1 07-28(本人)
🔴 而 runner 自己产出的最后一份日志停在 07-21 ⇒ runner 整体已七天没被跑过
```

🔴 **⇒ 一个必须写下来的落差**: 即使名字全改对、`--domain` 扫得到了,
**也没有任何东西会去调 `--domain`** —— 没有 CI、没有 cron、没有钩子。
**改名解决的是「扫得到」,而「会不会被跑」是另一个问题,它今天对全部 174 个用例都不成立。**
⇒ 不许把改名读成「regression 从此守着了」。

---

## 3. 机器可读标记(本设计的核心 · Bettor 点名要的那一格)

### 3.1 标记形态

在文件**头部 20 行内**放一行**纯文本注释**(runner 与 lint 都只做文本扫描,**绝不 import** ——
import 一个用例会执行它的顶层代码,那本身就是副作用):

```js
// @kanet-test-safety: real-chain   ← B 类: 触真链 / 花真钱 / 依赖活服务
// @kanet-test-safety: local        ← A 类: 纯本地, 无人值守安全
```

### 3.2 谁来强制 —— 🔴 用**已有的 lint 闸**,不新造机制

**规则 `R-TEST-REALCHAIN-MARKER`(新增到 `scripts/lint-kanet.mjs`,ERROR 级)**:

```
若一个 test-framework/cases/** 下的文件包含任一【危险信号】:
   · 真钱预算常量        (MAX_TRANSFER_KAS / SMOKE_BUDGET_KAS / 类似)
   · 活服务地址          (127.0.0.1:3200 / localhost:3200 / ws://127.0.0.1:17210)
⇒ 则它【必须】带 `@kanet-test-safety: real-chain` 头, 否则 commit 报 ERROR
```

🔵 **为什么这个形状是对的**:
```
✅ fail-closed 落在【真正危险的那一类】上 —— 写一个花钱用例却忘了标, commit 当场被拦
✅ 零改动那 160 个已有的安全用例(它们不含危险信号 ⇒ 规则对它们不触发)
✅ 复用既有闸(lint 已经 block commit), 不新造一个"没人跑的检查"
🔴 而它不是万能: 一个用花样写法碰真链、绕过上面那几个信号的用例, 这条抓不到
   ⇒ 诚实边界: 它把【最常见的那条路】堵死, 不声称覆盖全集
```

### 3.3 runner 侧

```
findCases 收 *.test.mjs (不变) ⇒ 对每个命中的文件做一次【文本】头部扫描:
   带 real-chain 标记        ⇒ 🔴 从 --all / --domain 的结果里【排除】, 只能 --case 显式点名跑
   带 local 标记 / 无标记    ⇒ 照常跑
```

### 3.4 🔴 汇总行必须带分母(Bettor 06:42 硬要求)

```
❌ "跑了 12 个用例, 全绿"
✅ "发现 14 个 · 跑 12 个 · 跳过 2 个(real-chain, 需 --case 显式点名) · 未标记 0 个"
🔵 理由(今晚已栽过两次): 只报成功数时,【全失败】【功能关闭】【真没事做】三种读数逐字相同
```

---

## 4. 落地顺序(每步都有可证伪的判据)

```
① A 类 8 个改名 <name>.mjs → <name>.test.mjs
   🔴 判据(Bettor 钉): 改完必须实证【--domain=m0c1-gate 真扫到且真跑】, 不是"名字看起来对了"
   ⇒ 交付时贴 runner 实际输出, 且那行必须带分母
   ⚠️ 改名前必须扫引用面: docs/ 与 evidence JSON 里有引用旧路径的地方(我已知至少 4 处 docs)
      —— 🔴 而我【还没逐个查完引用面】, 落码前补齐, 不假装查过
② B 类 1 个: 加 `@kanet-test-safety: real-chain` 头, 🔴【不改名】, 保持 --all 扫不到
③ lint 规则 R-TEST-REALCHAIN-MARKER 落码 + 自测(必须有一条【负样本】: 造一个含危险信号
   却没标记的临时文件 ⇒ lint 必须报 ERROR。没有这一条, 规则本身没被验过)
④ runner 侧排除逻辑 + 分母汇总行
```

---

## 5. 我没做 / 不打算在本设计里解决的

```
🔴 ① "没有任何东西会去调 --domain" —— 本设计【不解决】它。它是另一件事(CI/钩子/值守节律),
     而把它塞进本卡会让两件都收不了口。⇒ 单独立卡, 归 Bettor 排
🔴 ② <name>-latest.json 的覆盖式写法(每跑一次覆盖上一次, 只有"最后一次"没有历史)——
     本设计不动它。后果不严重, 但"跑过很多次"与"只跑过一次"在文件系统上仍长得一样。记一行, 不修
🟡 ③ 引用面全量扫描 —— 见 §4① , 落码前补
```
