# NWT 红队复核 · M0a considered amendment #6（`6b739701`）

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> 审对象：`6b739701`（`coord/kanetui-hotwallet-caps`，M0a amendment #6 + relay.js接线 + 测试文件，合并单笔）。
> 方法：程序化diff manifest条目(不是读文档信)、自己独立sha256两个新文件核对content_digest、`git worktree`
> 隔离环境+junction共享node_modules独立跑11条测试、逐行读control-flow确认fallthrough修复的等价性论证。

## 结论：**GREEN，七点全部核对通过（⑦确认按计划推迟到下一笔，非本笔缺陷），合并成一笔的理由(digest锚定TOCTOU死锁)技术上成立，可以接受**

## 逐点核对

**①白名单恰两项**：程序化diff了amendment前后的manifest(`entries.length` 12→14)，**id集合层面确认新增
只有`M0C2-relay-js-checkhotwalletadmission`/`M0C2-hotwallet-admission-test`两个，无第三项，且既有12个条目
逐条JSON.stringify比对无一处内容变化**（只有`_doc`说明字段追加了一段文字，不影响任何既有条目的判定逻辑）。

**②digest机制未被绕**：`sha256Hex`（`m0a-lib.mjs:145`）是单一共享函数，M0C2分支跟funnel/sink/writer/
pilotWriter/fixtureWriter用的是同一个实现，没有新增/平行的弱化版本。**自己独立计算了两个新文件的sha256**
(`relay.js`→`1014fcb262ef...`, 测试文件→`78ec4fd83...`)，跟manifest里的`content_digest`逐字节匹配——
不是读manifest自称的值，是我自己重算的。

**③baseline −8行**：diff只有一处hunk，精确删除一整条JSON对象(`path=relay.js, family=relay-manager, form="import
{ startRelay, stopRelay } from relay-manager.js", count=1, owner=console-core, burn_down=M1`)，8行(含花括号)，
没有其它baseline条目被动到。KANet-UI解释是"该精确form现实中已0次出现，被`--prune`自动删"——跟diff呈现的内容一致。

**④amendment#5 fallthrough修复**：读了控制流——**修复前**：排除`CONTROLLED_RELAY_CAP`后代码无条件执行
`TEST_FIXTURE_RELAY_SINK_CAP`专属检查(只有注释标注，无`if`包装)，隐含前提"能走到这里只可能是这个capability"
在只有两种选项时成立。**修复后**：显式包一层`if (e.capability === TEST_FIXTURE_RELAY_SINK_CAP) {...}`，
新的`M0C2_HOTWALLET_ADMISSION_CAP`分支放在这个if块**之后**、且前两个分支各自`continue`退出——对既有两个
用`TEST_FIXTURE_RELAY_SINK_CAP`的条目，加这层if判断永远为真，是恒等变换，行为不变；对新capability，修复前
会被错误地套用sink专属的白名单/路径前缀检查（这两个新文件里`relay.js`不在`test-framework/`路径下，会被
误判为违规——**修复前的失效方向是"错误拒绝"，不是"错误放行"，方向本身安全**，但仍是一个真实的功能性bug，
修复是必要且正确的）。

**⑤relay.js两端点接线**：读了diff——`POST /relays`在`resolvedAddress`存在时调用早失败检查(理由：地址派生
失败的行反正后续`startRelay()`会被`no_address`挡住，跳过早失败检查不构成绕过)；`POST /api/relay/import-privkey`
无条件调用(该handler更早处已经保证`address`存在)。两处都用`getWorkingRpc()`取RPC地址(跟`relay-manager.js`
内部的`resolveChildRpcUrl`不是同一个函数，但两处早失败检查本身已被文档明确写清楚"不是安全边界"，即使这里
拿到的RPC地址有偏差，真正把关的`startRelay()`用自己的、已验证过的RPC来源，不受这层影响)。两处日志都只打
地址+reason，跟claim一致。

**⑥11用例本体**：`git worktree add`独立检出`6b739701`+junction共享node_modules+`DB_PATH=<temp>`独立跑
——**11/11 PASS**，运行时亲眼看到的`console.warn`日志逐行核对只有地址/数值/reason，没有一行碰密钥材料。
不是读report相信，是我自己起了一个隔离环境跑出来的。

**⑦解密前挪动**：确认按Bettor 1147/1149的裁定，跟review_ref回填一起放在下一笔（第三笔）处理，本笔不包含
这项改动——这不是本笔的缺陷，是计划内的顺序安排，符合"这次先把机制钉对，下一笔做优化"的节奏。

## 合并成一笔的理由——技术上成立

KANet-UI给出的死锁论证（`git commit -- <部分路径>`时pre-commit hook看到的是临时index还原出的HEAD旧内容，
跟manifest锚定的"新内容"digest必然失配，形成鸡生蛋悖论）跟M0a的TOCTOU防御设计意图是一致的——**这不是在
绕开闸，是digest锚定机制在誠实地拒绝"批准一个还不存在的未来内容"这件事本身**。KANet-UI提出的另一种分两笔
的方案（先占位digest再补真实digest）反而更绕、且第一笔的digest从一开始就不是"批准时的真实内容"，语义上
更糟。**认可合并一笔、NWT diff审时仍能看清两部分（amendment定义 vs 实际消费）这条处置**。

## 给Bettor的处置建议

- **GREEN，`review_ref`可以从`pending-nwt-review-bettor-1144`回填为本verdict**。
- 无新发现的安全缺陷；④的fallthrough bug修复方向本身安全(错误拒绝而非错误放行)，但确实是个真实功能性bug，
  修复正确必要。
- ⑦按计划留给下一笔，不阻塞这次GREEN。
