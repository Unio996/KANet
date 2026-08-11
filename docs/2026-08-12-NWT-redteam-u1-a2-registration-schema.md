# NWT 红队 — u1 A2 登记表 `u1_identity_registration`(v196,commit `96a8c2d2`)

> **Status**: CURRENT

**审的对象**: J2 批A 存储落码,commit `96a8c2d2`(migrate.js v196 + schema test)。J2 自己标注"表结构本身尚未拿到单独的红队PASS...若审者要改形状,现在是零成本的",借这个窗口现在审。
**结论**: **PASS,一条 MUST-FIX 留给尚未落码的注册入口(不阻塞这张表本身,现在改最便宜)。**

---

## 核实过的部分(亲手跑,不采信报告)

- **`node kasia-console/src/lib/u1-identity-registration.schema.test.mjs` 亲手跑一遍**:7 PASS / 0 FAIL,与 commit message 一致。测试自带的临时库守卫(`dbPath.startsWith(dir)`)生效,`live console.db` 未被碰。
- **测试跑的是真 `runMigrations()`,不是抄一份 DDL 副本**——这条纪律与 J1(`b61e66d5`)、J2 自己(`972db61b` 前后反复强调)今晚撞过的"假体不许供给它要测的东西"同源,这次是在测试基础设施层面主动应用了这条纪律,不是等我提醒。
- **约束现读 `migrate.js` 逐字确认,不采信 commit message 转述**:`UNIQUE(root_fingerprint)` 精确对应 N3(锁 1);`CHECK(identity_index=0)` 是同一条锁的另一半;`CHECK(custody='mnemonic')` 对应 N4。三条都是**写入时**约束,不是"扫描器事后发现",与本仓今晚反复验证的"扫描器只有有人跑它才说话,约束不依赖任何人记得跑"这条纪律一致。
- **作用域诚实标注**:注释与测试都明确写出"约束挡不住同一 seed 的另一个硬化账户"(那是两条各自合法的记录,C 边界),没有把这张表的保护范围说大。
- **轮换摩擦(relay_id 主键与 root_fingerprint UNIQUE 的相撞)在设计时就被预见并写死用例(V12)**,不是踩了坑才发现——这条工程纪律值得记一笔。

---

## 🔴 一条 MUST-FIX(留给注册入口,不阻塞这张表):`custody` 字段现在是纯申报,没有任何东西验证它是真的

`root_fingerprint` / `identity_pubkey_xonly` 这两列有双重保护:**N1/N2**(派生数学——验证方能独立从根推出 pubkey 并逐字节比对)+ **N8**(持有证明——提交者必须能用申报的 pubkey 对应私钥签出有效签名)。这两层密码学约束合起来,让这两列即使被抄也没用(签不出对应私钥的签名)。

**`custody` 列没有任何同等级别的保护**。`CHECK(custody='mnemonic')` 只能核字符串字面值等不等于 `'mnemonic'`,核不了这个值是不是**真的**——这一列该写什么,完全取决于尚未落码的注册入口怎么实现。如果入口直接信任请求 payload 里申报的 `custody` 字段就写库,这一列就和 `root_fingerprint`/`identity_pubkey_xonly` 不是一类东西:后两者"能被抄"这条弱点已经被 N8 堵死,`custody` 目前完全没有等价的堵法——一个 privkey-only 的身份(N4 明确要排除的那类)理论上可以在注册请求里谎报 `custody: 'mnemonic'`,而数据库这条 CHECK 会照单全收(字符串确实等于 `'mnemonic'`,约束满足)。

**要求(落码到注册入口时生效,不是现在改表)**:`custody` 必须由**服务端独立查询** `relay_nodes.mnemonic_encrypted` / `relay_nodes.privkey_encrypted` 派生写入,**不能信任请求 payload 里携带的 `custody` 字段**。这与 N8 的核心纪律是同一条("验签公钥=申报的 identity pubkey 本身,不是提交者任意钥")——一个字段只要能被提交者自由声明而不被独立验证,它就是申报,不是证据。这条纪律这次要用到一个没有密码学能保护的字段上,换成服务端主动查证。

**建议**:这条现在就写进 A2 spec(或 J2 的注册存储设计稿)的残余敞口/N8 附近,避免落到入口代码那天被读成"表结构已经过审,custody 随便填就行"——这正是本仓"如实标注≠已处置"那条教训要防的那类静默丢失。

---

## 总裁定

**PASS。表结构、约束、测试纪律都站得住,亲手验证不是走过场。上面那条 MUST-FIX 不阻塞这张表(空表零写入方,现在改的话零成本),但必须在注册入口设计/落码时被显式接住,不能靠"表结构过审了"这句话滑过去。**

— NWT
