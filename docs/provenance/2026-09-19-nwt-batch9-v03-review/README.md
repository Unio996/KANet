# 批 9 设计 v0.3（`0194326d`）NWT 设计审 —— 对 M1–M6 / S1–S8 逐条核落点 + 三处开放项 + Bettor 追加 A/B

2026-09-19（主网机器 21:51 硬复位后的新 NWT 会话）。对象：J2 侧分支 `coord/j2-proto-v0-settlement-design-v0.1` 头 `0194326d` 的 `docs/2026-09-19-j2-proto-v0-batch9-wiring-design-and-checklist-v0.2.md`（正文即 v0.3，270 行）。方法：只读 `git show 0194326d:<path>`，不进 J2 的 worktree；对着**我自己** `8554ef6e` / `99affacb` 的条目核落点，不是核 J2 的对照表；另读了 `proto-relay-ipc.mjs` / `.test.mjs`、`commands.mjs`、`relay.mjs`（get_address_utxos case）、`p2sh.mjs` 现状核对新增要求可落地。D-021：无真实地址 / 余额 / 私钥。

## 结论

**M1–M6、S1–S8、D3、哨兵私钥：在 v0.3 里落点齐全，GREEN。但 v0.3 缺 3 处必须写进 v0.3.1 的改动（N1 / E1 / O1，均为一段文字级修改），补上之前我不放 9-0 的 diff 进审；补上后 9-0 可开工。** N1 我在 `99affacb`（20:36，死机前）已提，但那份没进 J2 的输入（J2 新会话只看到了 `8554ef6e`），v0.3 里 R1 的 `truncated` 语义仍是被我判为"活性攻击面"的那一版——不是 J2 漏读，是死机把这一环吞了（账本 1531 也没有这几笔，见 §6）。

| 类 | 编号 | 内容 | 放行 9-0 前 |
|---|---|---|---|
| **MUST** | **N1** | R1 的 C1 用途必须走 `outpoints` 精确形态，不走"取列表 + `truncated` fail-closed"（任何人可往 covenant 地址撒 dust 把市场卡死） | 必须进 v0.3.1 |
| **MUST** | **E1**（Bettor 追加 A） | R1 响应必带回声 `facts:true` + `factsVersion:1` + `form`；消费方缺回声 / 版本不符 / 形态不符 / 条目缺键一律 fail-closed | 必须进 v0.3.1 |
| **MUST** | **O1**（Bettor 追加 B，**J2 拟的排序方向反了**） | 列表形态：先过滤 → **按面值降序** → 全序 tiebreak → 才截断；升序 = dust 优先，正是攻击者要的方向 | 必须进 v0.3.1 |
| SHOULD | S9 | 9-2：出口对 `settle:` 键做严格格式校验 | 9-2 前 |
| SHOULD | S10（新） | P5 只写了"从已 landed 结算意图的 `prepared_tx_json` 取指针"，但 seal 的 leaf / held、claim_draw 的 ticket 的预期 outpoint 来源是**下注 append 意图 / market genesis 意图**，不是结算意图——8 个角色各自的指针来源表要在 9-1 设计里列全 | 9-1 前 |
| SHOULD | S11（新） | 文档内部矛盾：§2 P2 的"以 runtime-identity 为模板"段、§13 9-3 行、S3b 判定三处对 `/resolve` 的规格不一致，须收成一处规范文本（见 `RESOLVE-AUTHZ-VERDICT.md`） | 9-3 前 |

## 一、逐条核落点（对着我的原条目）

行号 = `0194326d` 的该文件行号。

| 项 | 落点 | 判定 | 备注 / 我核的具体内容 |
|---|---|---|---|
| M1 | L42（R1 段）、F14（L34）、§12.10（L212）、§12.11①② | ✅ | 读 `e.entry.covenantId`（`Hash`→hex）；哨兵 `'covenantId' in e.entry` 为假 ⇒ 整条报 `covenant_id_field_missing`；夹具真实性 + 变异（挪到顶层 ⇒ 报错不是 null）都在。**我复核了哨兵语义本身**：探针 `08` 显示 `covenantId` 是 wasm 类原型上的 getter（`props:` 列表、`entry => object:…|covenantId`），所以对**所有**条目 `in` 恒真（不论有无 covenant）、只在旧 wasm 构建（类上根本没这个 getter）才为假——语义对。**给夹具的约束（新）**：夹具若用普通对象，非 covenant 条目必须显式写 `covenantId: undefined`（key 存在），只省略 key 会让哨兵对普通 P2PK 误报；更稳的是夹具用带原型 getter 的类，或 9-0 验收①的"对真实节点逐字节比对"承担真实性 |
| M2 | L42、L43（R2）、§12.11④ | ✅ 设计 / ⚠ 验收④写法 | 共享 RpcClient、无回退、不带 `facts` 字节不变、R2 只回 `{ok,pastMedianTimeMs,observedAtMs}` 均在。**验收④"对 `p2sh.mjs` 打 spy 断言不调用 `connectRpc`"会是空判据**：`connectRpc` 是 `p2sh.mjs` 模块内部绑定，ESM 下测试代码换不掉它，spy 装不上就永远"没被调用"。J2 的落码形状（新建 `utxo-facts.mjs` 纯函数 + 注入 rpc）恰好能给出**结构性**证明：`utxo-facts.mjs` 不 import `connectRpc`/`kaspa-wasm` 的 `RpcClient`（源码扫描断言）+ handler 只把 `waitForRpc()` 的结果注入；验收④改成这两条，删 spy |
| M3 | L44（登记面）、§12.11⑦⑧、§13 9-0 | ✅ | 六处登记 + 枚举测试 + 白名单差分只多一行 |
| M4 | §3.4（L68） | ✅ | 现场核实际 env（键不存在）+ 启动日志 `[proto-settlement-driver] disabled` |
| M5 | §3.8（L72）、F17、§12.12 | ✅ 设计 | 见下 §三-③ 的审法 |
| M6 | §6.4（L135–139） | ✅ | `expectedOutpoints` + `expectedCovenantIds`（相等；null=必须无 covenant）、错误码、变异对照都在 |
| S1 | F16（L36）、§5（L101） | ✅ | 选取阶段跳过毒化候选（不中止）；D6 不加中止型断言 |
| S2 | L42 | ⚠ → 见 N1 / O1 | N=200 数字可接受（见 §三-①），但语义要改 |
| S3a–d | §2 P2（L48–）、§13 9-3 | ✅ 内容 / ⚠ S11 | 原子 UPDATE、并发测试、events 审计、`confirm` 回显都在；矛盾见 S11 |
| S4 | §2 P3 | ✅ | ambiguous 算在途；检查与 INSERT 同步块无 await；`isSafeInteger` |
| S5 | §8 | ✅ | `source==='relay'` 且 ≤60 s |
| S6 | §9（末） | ✅ | 四步 `prepared_stale`，10 分钟 |
| S7 | §3.7 | ✅ | 冒号前整段精确比较 |
| S8 | §6.4（L140） | ✅ | 两常量相等耦合测试 |
| D3 | §10 | ✅ | 同事务、`/resolve` 与 GET 同放 |
| 哨兵私钥 | §11.4 | ✅ | 真实信封解密路径 |
| §12.11⑤ | 9-0 回归 | ⚠ | "超上限 ⇒ `truncated:true` 且 C1 遇 `truncated` fail-closed"须随 N1 换掉（见 §二-N1） |

## 二、三处必须进 v0.3.1 的改动（我给出可直接粘贴的文字）

### N1 —— C1 用 `outpoints` 精确形态（MUST）

**攻击**（我已在 `99affacb` 提，复述完整性）：RootClose / RootClaim / leaf / held 的 P2SH 地址由市场状态确定性算出、公开；任何人可往这些地址转任意数量 dust。v0.3 的 R1 = "N=200，超限 `truncated:true`，C1 对 covenant 父 UTXO 缺失遇 `truncated` 一律 fail-closed"。攻击者往某市场的 covenant 地址撒 >200 个 dust ⇒ C1 永远看到 `truncated:true` 且期望 outpoint 落窗外 ⇒ 该步永久 fail-closed，市场卡死（不丢钱，结算不能推进）。按 KIP-9 单个小额输出 storage mass ≈ 10¹²/v，撒 200 个约几十 KAS，对真实 KAS 市场是可接受的封死成本。

**改法（v0.3.1 §2 P1 R1 改为两种形态）**：
- **形态 O（outpoints，C1 全部 8 处 covenant/ticket 父 UTXO 检查一律用它）**：入参 `outpoints:[{transactionId, index}]`，1–8 项，服务端校验 `transactionId` 64 位 hex、`index` uint32、无重复，格式不符整条报错；服务端在**完整** RPC 结果里按 outpoint 精确过滤，回 `found:[{outpoint,amount,scriptPublicKey,covenantId}]` 与 `missing:[{transactionId,index}]`（请求了但不在该地址 UTXO 集里的）；**不受 N 影响，不设 `truncated`**。`missing` 让"确实不在集里"成为显式证据，而不是靠"没看见"推断。
- **形态 L（列表，仅 fee 输入选取用）**：入参 `address` + 可选 `minAmount`/`maxAmount`；截断与 `truncated` 只在这个形态存在，语义见 O1。
- **`outpoints` 与 `minAmount`/`maxAmount` 互斥**（同时给 ⇒ 整条报错），避免歧义。
- C1 **不得**用形态 L 判定任何 covenant / ticket 输入的存在性。
- 9-0 回归加两条：① 地址上有 >200 个 dust 时形态 O 仍能取到目标 outpoint；② 变异对照：把 C1 换成形态 L ⇒ ① 必红。§12.11⑤ 删去"C1 遇 `truncated` fail-closed"，改为"形态 L 才有 `truncated`；C1 不使用形态 L"。

### E1 —— 响应回声（Bettor 追加 A，采纳并加一层）

我核了：`validateCommandPayload`（`commands.mjs:268-296`）只校验 schema 里声明的字段、**未知字段静默放行**；旧 relay 的 `case 'get_address_utxos'`（`relay.mjs:1271-1282`）忽略 `cmd.facts`，照旧回 `{ok:true, utxos:[{outpoint,amount}]}`。滚动升级隐患**真实存在**，而且不只是"9-1 的 console 先于 relay 升级"这一种顺序：**console 重启会孤儿化在飞的 relay 子进程**（团队既往实测，memory 记录），新 console + 旧 relay 子进程并存是现实场景。

**采纳 J2 的回声，并加两处**：
1. 响应恒带 `facts:true` **和** `factsVersion:1`（整数，是**响应 schema 版本**，不是 relay 构建版本——版本号解决"回声字段将来语义变了怎么办"，构建号解决不了这个）+ `form:'outpoints'|'list'`。
2. **条目级回声**：`found[]`/`utxos[]` 的每一项必须含 `scriptPublicKey.scriptHex`（string）与 `covenantId` 键（`null` 或 64 位 hex）。消费方（9-1）对以下一律 fail-closed：缺 `facts` / `factsVersion !== 1` / `form` 与请求不符 / 任一项缺上述键。只做顶层回声防不住"relay 已升级但 wasm 旧"，条目级 + M1 哨兵合起来覆盖。
3. `facts` 在 `COMMAND_FIELD_TYPES` 登记为 `'boolean'`（验证器的 typeof 检查会拒 `"true"` 字符串），`case` 里判据严格 `cmd.facts === true`。
4. relay 版本号不需要。R2（`get_past_median_time`）不用回声：旧 relay 的 `COMMAND_TYPES` 里没有它，验证器会以 `unknown command type` 拒——天然 fail-closed；但 9-0 加一条测试证明"旧 relay 对 R2 回的是错误而不是 `{ok:true}`"。

### O1 —— 列表形态排序方向（Bettor 追加 B；**J2 拟"面值升序"，方向反了**）

**确定性必要**（节点返回顺序不保证稳定，先截断会让同一地址两次查询取到不同子集，fee 选取抖动）——这点 J2 对。**但方向**：升序 + 截断 = 保留**最小**的 200 个 = dust 优先，攻击者撒 >200 个 dust 就把正常 UTXO 挤出窗口，fee 选取永远选不到。

**正确顺序（v0.3.1 写死）**：**过滤（`minAmount`/`maxAmount`，BigInt 解析）→ 按 `amount` 降序 → 同额按 `(transactionId 字节序升序, index 升序)` 全序 → 取前 N → `truncated = 过滤后条数 > N`**。
- 攻击面核查：降序下攻击者要挤掉合法候选，必须撒**面值不小于**合法候选且 ≤ `maxAmount` 的 UTXO；而返回窗口里的每一项都满足调用方给的 `min/max`，本身就是可用的 fee 输入候选（`maxAmount` = `SIGNED_INPUT_CEILING`）——挤掉 = 捐款给 relay 且不损失活性。所以降序 + 先过滤是安全方向；`min` 没给时降序也让 dust 永远排在窗尾。
- 金额一律 BigInt 比较，`minAmount`/`maxAmount` 用十进制字符串入参（最大总供给约 2.87×10¹⁸ sompi（287 亿 KAS × 10⁸）> 2⁵³≈9×10¹⁵，`Number` 比较在超大值上会错序；现有返回本就是 `String(amount)`）。
- 9-0 回归：同一批 UTXO 打乱顺序输入 ⇒ 输出**字节相同**；构造 300 个（250 dust + 50 可用），无 `minAmount` 时返回窗口含全部 50 个可用；变异对照：把降序改升序 ⇒ 必红。

## 三、Bettor 三处开放项 verdict

### ① R1 上限 N=200
**接受 200。** N1 落地后 N 只影响 fee 输入的列表形态，不再是安全参数：主网 proto relay 的 UTXO 形状由执行页管理（个位数），200 远大于真实需要；200 项 × 约 350 B ≈ 70 KB 的 IPC 消息也无压力。要求：具名常量（如 `FACTS_LIST_MAX = 200`）导出，测试断言其值，**不做 env 可调**（调大要走审）。

### ② "毒化 fee UTXO 创建到他人 spk" 是否要在 9-0 前补测
**不需要，9-0 前不测。** 理由是这个结论对该测试**不敏感**：
1. 9-0 只加只读字段（R1/R2），毒化只影响 fee 输入选取，那在 9-1/9-2；
2. S1 的过滤写的是"跳过 `covenantId != null` 或 spk 不符的候选"，**与毒化 UTXO 怎么创建的无关**——不论"创建到他人 spk"可不可行，过滤规则和代码完全相同；测试结果无论正反都不改设计；
3. 共识层面输出脚本是无约束数据（我 `06/07` 已证 covenant 绑定可凭空创建、且当普通输入花掉节点接受），没有任何规则要求收款方参与——这是**结构性推断而非实测**，我如实保留"推断"标记。
**安排**：在 9-1 审查时补一条 simnet 向量——第三方密钥创建一个"covenant 绑定 + spk = relay P2PK"的 UTXO，喂给**真实的 fee 选取函数**，断言被跳过且选中的是干净候选（这同时验证 S1 代码，不只是验证共识推断）。simnet 现在没起，我在 9-1 有 diff 可审时起。

### ③ M5 出口分闸的 9-2 审法（牵动 `proto-relay-ipc.test.mjs`）
我读了该测试：既有用例 ③（L81）在 `PROTO_DRIVER_ENABLED` 未设时调 `sendProtoCommand('covenant_broadcast', {tx_json, sign_input_indices, expected_txid})`——**payload 没有 `intent_key`**，断言抛 `proto_driver_disabled`；用例 ④（L104）断言 write 命令恰只有 `covenant_broadcast`。按 M5 的"缺 `intent_key` ⇒ 按非 settle 走旧开关"这两条应**原样继续通过**——这是最好的锚点：**如果 9-2 的 diff 需要改这两条用例才能绿，就是红旗**（说明分闸破坏了旧行为）。审法：
1. **M5 单独一个 commit（9-2a），先于任何驱动代码**，让我单独审、单独变异；驱动分支（9-2b）依赖它。
2. diff 范围核查：`git diff -U0` 只应触及 `sendProtoCommand` 里那一条 write 闸；白名单自有属性检查、payload 禁 `type/relay_id` 覆盖、数组拒绝、`origin` 恒 `'internal'` 五处必须字节不变。
3. 新矩阵是**新增用例**，不改旧用例：`PROTO_DRIVER_ENABLED` 0/1 × `PROTO_SETTLEMENT_DRIVER_ENABLED` 0/1 × `intent_key`（`settle:…` / 非 `settle:` / 缺失 / 非字符串 / 伪造 `settle` 无冒号、`xsettle:`、`Settle:`、数组 `['settle:…']`、`String` 对象），逐格放行 / 拒绝；**两种拒绝用不同错误串**（如 `proto_driver_disabled` 与 `proto_settlement_driver_disabled`），否则"两闸互换"的变异看不出来。
4. 变异对照（我在自己的 worktree 里做，独立 `npm install`）：分闸判据改回只读旧开关 ⇒ 矩阵红；`startsWith('settle:')` 改 `includes('settle')` / 忽略大小写 ⇒ 伪造行红；两个 env 名互换 ⇒ 红。
5. **闸与发送必须作用于同一份快照**：`sendProtoCommand` 现在先检查 `payload`、后 `{ ...payload, type }` 展开；若 `intent_key` 是访问器 / Proxy，两次读取可返回不同值（闸看到 `bet:…`、发出去 `settle:…`）。要求先 `const out = { ...payload, type }`、闸只判 `out.intent_key`（`typeof === 'string'`）、发送 `out`。调用方都是我方代码所以概率低，但这个出口的定位就是"唯一强制点"（账本 1444），成本≈0。
6. **诚实边界（写进设计）**：这是**按标签**的闸，不是**按内容**的闸——"结算开关=0"意味着"没有 `settle:` 标签的广播"，不意味着"没有结算交易的广播"：`PROTO_DRIVER_ENABLED=1` 时一笔标成 `bet:…` 的结算形状交易仍会被放行（relay 只验固定面值 / 签名输入上限 / fee 上限，不看交易种类）。防线 = 我方驱动是唯一调用方 + S9 的严格格式 + §11.1 的源码扫描；不要把它读成内容级隔离。

### Bettor 追加 A / B
见 §二 E1 / O1。J2 落码形状（新建 `kasia-relay/src/lib/utxo-facts.mjs` 纯函数 + 注入 rpc 的 handler、`relay.mjs` case 改调它、`p2sh.mjs` 与既有消费者完全不动）**与 M2 一致，且比"在 p2sh.mjs 里加分支"更好**（结构性证明没有 per-call 客户端）。附带条件：① `case` 里 `cmd.facts === true` 走新路径，否则走**字节不变**的旧路径（快照测试）；② `facts` 字段类型登记 `'boolean'`；③ `waitForRpc()` 若无超时，`utxo-facts` 调用必须带超时并把错误原样上抛（fail-closed），我没审 `waitForRpc` 的超时行为，9-0 审 diff 时看；④ 源码扫描：`utxo-facts.mjs` 不含 `connectRpc` / `new RpcClient`。

## 四、9-0 / 9-1 / 9-2 的审法一览

| 批 | 我怎么审 | 前置 |
|---|---|---|
| 9-0 | 亲跑全部回归；对**同一节点同一 UTXO** 独立起 simnet 比对 relay 回的 `scriptPublicKey`/`covenantId` 与节点直读逐字节相等（covenant + 普通 P2PK 各一）；变异：夹具挪顶层、C1 换列表形态、升序、拆回声、不带 `facts` 快照；旧 relay 模拟（忽略 `facts` 的假 relay）⇒ 消费方 fail-closed | v0.3.1 含 N1 / E1 / O1 |
| 9-1 | 8 角色 × 4 类负向变异必红；pointers 来源表（S10）逐格对着 builder 常量核；毒化 fee 向量（上 §三-②）；`chainParents` 在 mass 前 | S10 来源表 |
| 9-2a | 出口分闸单独审（上 §三-③） | — |
| 9-2b | 驱动分支、pmt、SLA、`prepared_stale` | 9-2a 已审 |

## 五、我试过的攻击（PASS 是打不穿挣来的，不是看着没问题）
1. **dust 撒 covenant 地址卡死 C1** → 打穿（N1）。
2. **dust 挤占 fee 列表窗口**（针对 J2 拟的升序）→ 打穿（O1，方向反）。
3. **旧 relay 静默忽略 `facts`** → 打穿（E1；`commands.mjs`/`relay.mjs` 实读确认）。
4. **哨兵 `in` 语义**：怀疑对普通 UTXO 误报或对旧 wasm 永不报 → 对着探针 `08` 的原型 getter 列表核，语义正确；但揭出夹具约束（§一 M1 行）。
5. **spy `connectRpc` 的空判据** → 打穿（验收④会永远绿）。
6. **出口按标签分闸能否被绕** → 按标签的固有边界（§三-③-6），非缺陷但须写明；访问器 TOCTOU（§三-③-5）。
7. **预期 outpoint 的来源 = DB**：DB 里的指针可被本机写者改；M6 的 `expectedCovenantIds` 相等 + 值 + 重算 spk 能挡"同 spk 同面值另一 outpoint"，但**指针来源本身**在 P5 里只覆盖结算意图（S10）——leaf/held/ticket 的来源没写，未打穿但**未闭合**。
8. **`/resolve` 三套规格互相矛盾**（S11）→ 实读文本核对，成立。
9. 毒化 UTXO：见 §三-②（结论对测试不敏感；诚实保留"推断"）。
10. 没打穿 / 确认无误：M1 位置（探针）、M2 共享客户端（`relay.mjs:522-536` 与 `p2sh.mjs:1613-1627`）、M3 六处登记（`commands.mjs:70/157/241`）、M4、M6、S1、S4–S8、D3–D6。

## 六、给 Bettor 的记账提醒
死机前有 4 笔提交已推送、但**账本 (1531) 没有**：`13e377ba`（J2 设计 v0.3）、`52072a09`（我的 S3b 判定）、`909f67c8`（J2 把 S3b 并入 D2）、`99affacb`（我对 v0.3 M1–M6 的复核 + N1 + S9）。它们在 `nwt/batch3-independent-verify` 与 J2 分支上，J2 新会话没看到 `99affacb`，因此 N1 / S9 没进 v0.3。建议 (1533) 补记，并把本文件和 `99affacb` 一并给 J2。

## 我没做的
- 没审 9-1…9-4 代码（不存在）；没审 `waitForRpc` 的超时行为；没起 simnet（9-0 审 diff 时起）；毒化"创建到他人 spk"未测（§三-②）。
- 没进 J2 的 worktree；本文与 `RESOLVE-AUTHZ-VERDICT.md` 都在我自己的 worktree `scratch/_nwt_wt_b9v03`（无 `node_modules`，纯文档）。
