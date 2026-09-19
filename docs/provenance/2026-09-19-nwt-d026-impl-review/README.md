# D-026 实现审（启动期 UTXO 自动拆分 + broadcaster-utxo cron 开关）—— NWT

2026-09-19。对象：`origin/coord/kanetui-d026-startup-utxo-switches` 头 `9c86a049`（基于主线 `4d222bac`，4 文件 +254/−29）：`utxo-splitter.js` +14、`broadcaster-utxo.mjs` +11、`utxo-splitter.test.mjs` 重写、新增 `broadcaster-utxo.test.mjs`。对照：我的 `de2ded3d`（D26-M1/M2）与设计 v0.2 §7。方法：读全部 diff；在**我自己的 worktree**（`scratch/_nwt_wt_b90`，切到 `9c86a049`；`kasia-console` 独立 `npm ci`，lockfile 与已装一致，无 junction，`check-worktree-junctions` 0 跨树）亲跑两份测试并做我自己的 18 个变异。D-021：无密钥 / 余额 / 地址。

## 结论：**GREEN**（无必改项；两条 SHOULD 不阻塞）

- 亲跑：`utxo-splitter.test.mjs` **18/18**、`broadcaster-utxo.test.mjs` **14/14**（命令与 KANet-UI 文档一致：`node --experimental-test-module-mocks --test <file>`）。
- 我的独立变异：**18 个全部被抓，0 存活，0 空操作**（脚本与原始输出：`nwt-mutate-d026.cjs`、`nwt-mutation-run-raw.txt`），含 KANet-UI 自报的 M1–M8 全部复现 + 我另加的 10 个（N1–N10）。
- `index.js` 与 `kanet.mainnet.env` 相对 `4d222bac` **零 diff**（`git diff --stat` 二者为空）；lint 4 文件 0 error。

## 一、Bettor 五个重点

**① "env=1 下删 `_isProtoRelay` 早退 ⇒ 1/2/4 红"——自己复现了**：M4（删掉 `if (_isProtoRelay(a)) {…continue}` 整块）`fail=3`，红的恰是 **A1 / A2 / A4**，**A3 保持绿**（A3 只有普通中继、没有 proto 中继，本来就不该红）——与 KANet-UI 自报一致。我再加了两个更细的：N1（只删按 `PROTO_RELAY_ID` 判定的那半）⇒ A1、A4 红；N2（只删 `proto-` 前缀那半）⇒ A2 红。**即"两半各自被单独守着"**，不是只守一个总开关。这正是 D26-M2 要的：1459 的守卫没有被闸吞掉。

**② 文件作用域 `env='1'` + `test.after` 还原会不会泄漏到同进程其他测试文件**：
- 运行方式核实：`kasia-console/package.json` 的 `scripts` 里**没有**汇总测试脚本（只有 `test:pbs8-handler` 一条）；这两份测试都是**逐文件手动**用 `node --experimental-test-module-mocks --test <file>` 跑，`node --test` 默认**每个文件独立子进程**，进程内 env 不会跨文件；
- `git grep` 全仓：除这两份测试外，**没有任何其他测试文件** import 或提到 `utxo-splitter` / `broadcaster-utxo` / 这两个 env 键；
- 即便有人改成单进程（`--experimental-test-isolation=none`），`test.after` 用 `ENV_BEFORE_FILE`（先记后还原，未设则 `delete`）恢复，且每个闭合值用例在 `finally` 里把 env 拨回 `'1'`；broadcaster 那份每个用例 `finally` 都还原到 `ENV_BEFORE_FILE`。我认为泄漏路径不成立。唯一残余：单进程模式下文件**加载期**（模块顶层）就把 env 设成 `'1'`，先于本文件 `test.after`，会短暂影响同进程里"更早已加载"的其他文件——目前没有这样的文件，不构成问题。

**③ 12 个关闭取值是否覆盖我列的全部**：我在 de2ded3d 列的 V2 值是 `''`、`'0'`、`'true'`、`' 1'`、`'yes'`、`'01'`、全角 `'１'`、带换行的 `'1\n'`，加未设。实现的 `CLOSED_VALUES` = `undefined, '0', 'true', ' 1', 'yes', '', '01', '１', '1\n', '"1"', 'TRUE', '1 '`——**我列的全部都在**，另多了 `'"1"'`（ps1 不去引号的注入形状）、`'TRUE'`、`'1 '`（尾空格）。**覆盖是否足够我用变异验证而不是数值清单**：N5（`trim()` 放行）被 `' 1'` / `'1 '` / `'1\n'` 三条抓到；N6（`Number()===1` 放行）被 `'01'` 等四条抓到；M2（`!env` 宽松）被九个非 `'1'` 真值抓到——每种"放宽方式"都至少有一个具体值把它抓住。

**④ `ensureBroadcasterUtxos()` 按需路径不受闸影响**：**接受**。`git grep` 全仓（`9c86a049`）显示它**唯一的调用者**是同文件 `broadcasterUtxoTick`（经 cron 触发），没有其他调用点，所以"不受闸影响"目前不留后门：闸在 cron 入口，cron 关则 tick 不会有，`ensureBroadcasterUtxos` 就不会被到达。变异 N10（把闸也套到 `ensureBroadcasterUtxos` 上）被 `V8-ondemand` 抓到，说明"按需路径不被闸影响"这条设计意图本身有测试守着。SHOULD-1（见下）建议把"唯一调用者"固化成一条源码扫描断言，防止将来有人加第二个调用者而误以为它受闸保护。手动接口无鉴权另票 `T-SPLIT-UTXOS-API-AUTHZ`，本审不涉及。

**⑤ 返回对象有无调用方接**：**没有**。`autoSplitAll()` 全仓（非测试）唯一调用点 = `index.js:871` 的 `await autoSplitAll();`（不接返回值）；`startBroadcasterUtxoMaintainerCron()` 唯一调用点 = `index.js:815`（不接，且开关关时本来就 `return undefined`，开时也 `return undefined`，行为未变）。新增的 `{ok, disabled, split, total}` 只被测试断言。

## 二、我读代码时核的其余点（全部成立）
- **闸在函数第一行**：`autoSplitAll()` 的早退先于 `sqlite.prepare`（M5 变异"把早退挪到 prepare 之后"被 `prep.mock.calls.length === 0` 抓到）；cron 的早退先于 `if (timer) return`、`console.log('started')`、`setTimeout`、`setInterval`（N8 变异"先注册定时器再判闸"被抓到）。
- **关闭态恰一行且带 raw**：`raw=${JSON.stringify(process.env[KEY])}`——未设时 `JSON.stringify(undefined)` 是 `undefined`，日志形如 `raw=undefined`，测试里 `JSON.stringify(v)` 同样得到 `undefined`，两侧一致；`''` 得到 `""`，`'1\n'` 得到 `"1\n"`（转义可见）——运维者能一眼看出原因。N3/N9（去掉 raw）被抓到。
- **只认字面 `'1'`**，且**每次调用读 env**（不是模块加载期常量）：N7（改成加载期读取）被抓到，说明"运行期读取"这个性质有测试守着（对"先 import 后设 env"的测试与将来热改都重要）。
- **开启态行为逐字节不变**：V3 断言 `enabled` 行 + 既有 `1/1 accounts split` 汇总行原样 + 返回对象；`V8-control` 断言 `started — tick=180000ms target=30 …` 原样、90 s 宽限之前零 IPC、宽限后第一 tick 恰发一条 `{type:'split_utxo', targetCount:30, force:true}`——即"打开"路径与改动前一致，闸真的只是闸。
- **测试非空判据**：闭合态用例都用一个"若闸开着就会被处理"的真实候选（普通中继 / `is_oracle=1` 中继）+ 对照用例（`V2-control` / `V8-control`）证明同一夹具在 `'1'` 下确实会发命令；`prepare` 与定时器用 `mock.method` 计数（且在夹具插入**之后**才装 spy，不被测试自己的插入污染）。

## 三、SHOULD（不阻塞）
- **SHOULD-1 固化"`ensureBroadcasterUtxos` 唯一调用者是 cron"**：加一条源码扫描测试（`git grep` 式：`src/` 下除 `broadcaster-utxo.mjs` 自身与测试外，出现 `ensureBroadcasterUtxos` 即红），使将来任何新增调用者必须显式面对"它不受开关保护"。（否则今天成立的"不留后门"会悄悄失效。）
- **SHOULD-2 让运维者能发现这两个键**：`kanet.env.example` / `kanet.env.template` 里目前**没有**这两个键（`git grep` 零命中）。设计要求主网 env"不写键 = 关"，同意；但示例文件应写成**注释行 + 说明**（`# UTXO_AUTOSPLIT_ON_START=1   # 默认关，只认字面 1；启动期会在主网真实花手续费` / `# BROADCASTER_UTXO_MAINTAIN=1  # 默认关；开启后每 3 分钟对 is_oracle 中继强制重平衡`），否则要开的人只能读源码。注意示例里**必须保持注释掉**（V5 判据是"实际生效 env 里键不存在"，示例被误当作模板整份拷贝时，注释行不会生效）。

## 四、上线时的现场判据（与 P2 注册门衔接）
合入主线后不会自动生效，须随下一次 console 重启。上线后 **V6 以运行中 console 自己的 stdout 为准**（不是 env 文件、不是 `git grep`），两个开关各一条阳性证据：
1. `[utxo-splitter] disabled (UTXO_AUTOSPLIT_ON_START!=1, raw=undefined)` 恰 1 行，且 `[utxo-splitter] … → … UTXOs` 0 行、`accounts split` 0 行；
2. `[broadcaster-utxo] disabled (BROADCASTER_UTXO_MAINTAIN!=1, raw=undefined)` 恰 1 行，且 `[broadcaster-utxo] started` **0 行**（旧日志里恒有这一行——它的消失本身就是"闸生效"的阳性信号，别把它当异常）。
两条都读到才算 D-026 上线；P2 的注册门（自启前必须"开关已上线并被日志证明"）以此为准。**注意继承环境**：`start-console-mainnet.ps1` 只往进程环境里加文件值、不清继承来的变量，若启动者 shell 恰有其中一个变量 = `1`，日志会是 `enabled`/`started`——那就是阳性（打开了），不要靠 env 文件推断。

## 我没做 / 未证
- 没有在真实主网 console 上验证（合入 + 重启后才有 V6）；没审 `autoSplitAll` 内部拆分判据（设计已另开票 `T-UTXO-SPLIT-NONCONVERGENT`）；没审 `T-SPLIT-UTXOS-API-AUTHZ`。
- 变异只在我自己的 worktree 里做，每次还原，`git status` 干净；未向 KANet-UI 的分支提交任何东西。
