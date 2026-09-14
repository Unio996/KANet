# NWT 红队复核 · T4创世对照工具实现方案(`e9fe9102`) + 编译器锚点确认 + computeCloseZkTmplAnchor风险升级

> **Status**: FINAL v0.1（2026-09-14 · NWT · docs only）
> Bettor 1216/1217：①编译器锚点确认(D-019)——已通过SendMessage紧急回复，本稿正式落档；②审T4工具方案：
> 接口/spec形状、新旧schema适配、P2SH纯blake2b等价性、tripwire复用、测试计划；③`computeCloseZkTmplAnchor`
> ctor 25→28修补的风险面。

## 结论：**①源commit确认一致（`3ed973335b59269293564805cc2c58a14595ec03`），二进制sha256因我自己一行
未提交的诊断eprintln而与J2的干净构建不同（已独立重读diff确认零codegen影响），同意D-019把J2的干净构建
（sha256`4378ba65...`）定为生产锚点。②T4工具方案除一处非阻断的代码可读性小瑕疵外全部GREEN，P2SH纯
blake2b等价性经独立实测（4种不同长度，含2种贴近真实场景的大尺寸）确认成立。③`computeCloseZkTmplAnchor`
的风险面比J2原稿描述的更severe——独立实测确认当前SILVERC_ZK pin对tokenization后的CloseZkV2.sil是**parse
error**而非"ctor数量不对"，这意味着3个真实生产调用点（`pool.js:180`/`bshard-close-transport.mjs:518`/
`closezk-v2-mint.mjs:226`）在合入`4b48393a`之后**现在就是坏的**，不是"落码前需要顺手修的小事"——建议
升级为MUST-FIX，且修法必须同时换编译器pin，光补3个ctor占位值不够。**

## 一、①编译器锚点确认——正式落档（内容已通过SendMessage 1216/1217先行回复Bettor，本节存档）

- **源commit**：独立`git log -1`确认`/d/silverscript-v100`的HEAD是`3ed973335b59269293564805cc2c58a14595ec03`
  ——跟J2报的`3ed9733`完全一致。
- **二进制sha256不一致，原因明确**：`silverc.exe`=`2ca22dc510f542b77439b0f0e864f8279ffdaa310c48786dc1ce77a1cdecf82c`
  （J2的是`4378ba6557f7b7b088d6ad7a400422acb51a7ffd04f86ed974055c4177ef8643`）。`git status`显示我这棵树有
  1处未提交改动：`silverscript-lang/src/compiler/compile.rs`。独立重读完整`git diff`确认：只加了一行
  `eprintln!("[NWT-VT8-DEBUG] guess={:?} actual={}", bytecode_size, actual_size);`，插入点在`actual_size`
  已经算出**之后**、原有`if`判断**之前**，只写stderr、不修改任何变量/控制流/返回值——**对codegen零影响**，
  但任何源码字节改动都会让编译出的二进制本身字节不同，这解释了sha256差异且不构成"我的编译器行为跟J2的不
  一致"这个担忧。
- **本session全部deep-equal结论不受影响**：本session所有比对（PayoutShard/PayoutShardV2/RootClose/
  RootClaim/RefundClaim/ShardLeaf/ShardLeaf_direct/CloseZkV2/KanetTestToken/KanetTokenClaim等）比的都是
  "`.sil`源码在给定ctor下编译出的bytecode数组内容"，不是"编译器二进制文件本身的字节"——那一行diff不在
  bytecode生成路径上，不影响任何一次已出verdict。
- **D-019裁定：同意**，但建议写清楚"我的sha256≠生产锚点sha256"这件事+原因，避免以后有人拿两个数字对不上
  误判成"锚点不一致"——**生产锚点应该指向J2那份干净构建（`4378ba65...`）**，不是我这份带诊断行的构建。
  我会找机会revert那行debug代码。

## 二、②T4工具实现方案——逐节独立验证

### 2.1 接口/spec形状（§1/§2）—— GREEN

`assertGenesisTemplatesCoherent(spec) → {ok, report}`接口设计合理：`spec.files`用**具名key**（文件名→
ctor字段名→值）而不是位置数组，直接针对本session已经发现并记录过的真实坑（`RootClose.claim_tmpl_hash`
跟其余5文件`claim_tmpl_hash`同名不同物，T4 v0.3 §2已点过）——具名key能让报错信息直接点名"哪个文件的
哪个字段"，比位置数组反查签名表更不容易在实现/使用时踩到这个坑。`expectedGenesisOutputs`可选+显式
`"skipped_no_expected_output"`（不是静默当作"通过"）——跟本session一贯要求的"不伪造跳过=通过的假阳性"
纪律一致（同V-HOF系列/GO-F设计页的既有标准）。

### 2.2 新旧silverc JSON schema适配（§3.1）—— 独立核实两个schema都真实存在且确实不兼容，适配函数功能正确
但有一处非阻断的可读性瑕疵

独立读了`pool-template-artifact.mjs`的`extractTemplateArtifact`源码：确认它硬编码要求
`compiled.state_layout.{start,len}`，`sl`为空或字段缺失直接`throw`——J2"旧schema假设"的描述准确，不是
猜测。独立核对了`_j2_silverc_v100`产出的实际schema（本session大量已生成的`.compiled.json`文件）：确认
`bytecode`/`state_span.{offset,len}`嵌在`contracts[Name].compiled`一层里，字段名跟旧schema确实全部不同
——两个schema**结构性不兼容**，直接喂旧解析器会在`sl.start`处读到`undefined`报错，跟J2的诊断完全一致。

**J2提议的10行适配函数功能上正确，但有一处措辞误导（独立测试确认"凑巧对但写法不该这样写"）**：

```js
return { script: Buffer.from(c.compiled.bytecode, 'hex'), state_layout: {...} };
```

独立核对了`c.compiled.bytecode`的真实类型——**不是hex字符串，是JS原生整数数组**（`[107, 8, 0, 0, ...]`）。
`Buffer.from(array, 'hex')`在Node.js里对数组类型输入会**忽略**第二个encoding参数（encoding只对字符串输入
生效），等价于`Buffer.from(array)`——独立写了一个最小复现脚本验证这个行为，确认两种写法产出完全相同的
Buffer——**J2这行代码功能上是对的，不是bug**，但**写法本身会误导下一个读代码的人**：字面读起来像"这是
一个hex字符串"，如果未来schema真的改成hex字符串编码，这行代码会**悄悄改变行为**（从"忽略参数按字节数组
处理"变成"真的按hex解析"），是否等价取决于新旧两种数据长得像不像。**建议（非阻断）**：改成
`Buffer.from(c.compiled.bytecode)`（去掉误导性的`'hex'`参数）或加一条`Array.isArray(c.compiled.bytecode)`
断言，让schema假设显式化而不是靠"encoding参数被忽略"这个容易被后人忽略的隐性事实撑着。

### 2.3 P2SH纯blake2b重算（§3.3）—— 独立实测确认等价，可以安全省掉kaspa-wasm依赖

这是本次审查里唯一需要真正"动手验证"而不是"读代码判断"的技术主张——独立写了一个测试脚本，用
`kasia-console/node_modules/kaspa-wasm`的`payToScriptHashScript`（跟`kasia-relay/src/lib/p2sh.mjs`
实际生产用的同一个原语）跟纯`@noble/hashes`的`blake2b`+`'aa20'+hash+'87'`手拼分别算同一段redeem字节，
测了4种长度：空、1字节、16715字节（贴近RootClose真实witness大小）、32779字节（贴近PayoutShard真实
bytecode大小）——**全部4个case逐字节相等**。**确认J2§3.3的等价性主张成立，P2SH脚本字节层面的比对
确实不需要引入kaspa-wasm，纯JS+blake2b就够，跟console侧"传导不碰链"的铁律不冲突**。

### 2.4 tripwire复用（§3.4）—— GREEN，无新风险

直接`import`已经在`9eca3fbc`落码、本session已独立复核过实现代码的`findCtorOnlyTripwireHits`纯函数——
不是重新实现，是对同一个已审计过的函数多加一个调用点，风险跟原实现本身相同（已确认过的GREEN），不构成
新的攻击面。

### 2.5 测试计划（§5）—— GREEN

单元测试用mock（不真跑子进程）验证比对逻辑本身，集成测试标`skip_in_batch`跑真实编译器，第三层复用既有
T3 provenance产物做工具正确性的交叉验证——三层分工清晰，跟本session已经反复验证过的方法论（mock测逻辑/
真实编译器测集成/复用既有产物做交叉验证）一致，没有发现设计漏洞。§5.1明确把"skip不算通过"钉成回归测试
用例（不是只在文档里提一句就当解决），这条纪律执行到位。

## 三、③`computeCloseZkTmplAnchor`风险——独立实测，风险面比原稿描述更严重，建议升级为MUST-FIX

### 3.1 独立实测：当前mainline上，这不是"ctor数量不对"，是编译器解析不了源码

独立读了`pool-shard-register.mjs:189`的`computeCloseZkTmplAnchor`源码，确认J2的ctor数组算术
（8个显式值+`W17()`17个=25，`CloseZkV2.sil`实际ctor参数**独立数了一遍**=8+17+3=28）——算术本身对。

**但独立跑了一次真实调用**（不是纯读代码推断，是真的import这个函数、真的传入当前mainline的
`CloseZkV2.sil`路径执行）：

```
THREW: silverc compile .../CloseZkV2.sil fail: compile error: parse error:
  --> 73:43
  require(blake3((tok_prefix.length as byte[8]) + tok_prefix + ...
                                    ^--- expected logical_or_op, ...
```

**这是一个parse error，不是ctor arity error**——`SILVERC_ZK`硬编码指向
`D:/silverscript/versioned-builds/silverc-zk-8065184.exe`（CLAUDE.md铁律0.5记录过的、专供ZK track用的
本地OP_PICK补丁老版本，commit`8065184`，早于`3ed9733`），**这个老版本编译器压根不认识`as byte[8]`这个
cast语法**——独立`git log -S "as byte[8]" -- CloseZkV2.sil`确认这个语法是`01a12539`（本session已审过的
CloseZkV2完整tokenization commit）第一次引入的，代币化之前的`CloseZkV2.sil`不含这个语法，
`computeCloseZkTmplAnchor`当时能正常工作。**代币化把CloseZkV2.sil升级到了v1.0.0语法，但没人同步检查过
`SILVERC_ZK`这个独立的、专属ZK track的编译器pin是否还认得新语法——它不认得。**

### 3.2 这不是"落码前顺手修"，是当前mainline上三个真实生产调用点现在就是坏的

独立`grep`确认`computeCloseZkTmplAnchor`有**三个真实调用点**（不是理论上可能被调用，是源码里已经接好线）：

- `kasia-console/src/api/pool.js:180`——一个API endpoint。
- `kasia-console/src/lib/bshard-close-transport.mjs:518`——zk_handoff生产交易构造流程本身。
- `kasia-console/src/lib/closezk-v2-mint.mjs:226`——genesis-mint流程的"§4硬门①"（该文件自己的注释语言，
  意即这是一道刻意设的安全门，不是可以绕开的辅助函数）。

**这三处只要在合入`4b48393a`之后被真实调用一次，都会抛出上面这条parse error**——这不是"T4工具落码时
才会撞到的新问题"，是**这次T3代币化合入本身，在没人注意到的情况下，破坏了一个已经接好生产线路的既有
函数**。我这一轮的"主线合入收口核"（`19d60f7a`）当时只核了lint/bytecode-hash/diff-scope三项，没有覆盖
"既有的、依赖这些.sil文件的其它.mjs函数是否仍然工作"这个维度——这是我自己审查范围的一个真实缺口，如实
承认，不是这次T4方案审才发现的全新维度，而是被这次审查过程带出来的。

### 3.3 J2提议的"3行ctor补丁"必要但不充分——修法必须同时换编译器pin

J2 §4.2提议的修法（往ctor数组末尾加3个占位值凑够28个）**解决不了parse error本身**——即便ctor数量对了，
`silverc-zk-8065184`这个老版本编译器仍然不认识`as byte[8]`语法，compile阶段照样会抛同一个parse error，
根本走不到"ctor arity不对"这一层检查。**真正的修法需要两步都做**：①把`computeCloseZkTmplAnchor`（及
其它任何硬编码`SILVERC_ZK`的调用点）改指向一个认得v1.0.0语法的编译器（大概率就是D-019正在裁的
`3ed9733`那份，前提是D-019确认它同时也是ZK track的正确anchor——这条我没有独立核实"ZK track专属的
OP_PICK补丁"在`3ed9733`里是否已经通过别的机制解决，需要J2/Bettor补一句确认，见§四）；②在①换好编译器
之后，ctor数组补3个占位值这件事才有意义（届时新编译器会真的走到arity检查，需要凑够28个）。

**建议：把这条从J2原稿"§4.2非阻断，须记录"升级为MUST-FIX，且明确写清楚"3行ctor补丁"和"换编译器pin"是
同一笔修复里缺一不可的两个部分，不是两件独立的事、也不是可以分两笔逐步做的**（先单独补ctor不换pin=
仍然parse error，白费一次commit）。

### 3.4 旧网/历史向量处理——独立判断，风险可控

`computeCloseZkTmplAnchor`产出的`closeZkTmplAnchor`是**genesis时烤入PayoutShardV2ctor的一次性锚点**，
不是运行期可变状态——旧anchor值（用老CloseZkV2模板算出的）跟新anchor值（用新tokenized模板算出的）**必然
不同**（模板字节真的变了，边界位置也随之变），这是**预期且正确**的行为，不是bug。风险点只在于：如果
本项目已经有任何真实市场用旧anchor值genesis过（本session已多次确认：D-017后本项目从未向真实主网广播
过covenant交易，T3代币化又是这次才刚合入mainline），**当前实际不存在"已有旧anchor的真实市场"这个场景
——风险面目前是零，但这个结论建立在"确实没有任何已mint市场"这个事实前提上，建议Bettor/KANet-UI在拍板
"风险可控"之前用一条真实的DB查询确认这一点，不要只凭"我们知道还没上线"这个印象**（同本session一贯的
"不猜，查了再写"纪律）。

## 四、没核到的（如实记录）

- 未独立核实"ZK track专属的本地OP_PICK补丁"在`3ed9733`里是否已经通过silverscript v1.0.0自己的重构方式
  解决（memory索引里有一条"silverscript v1rc1: OP_PICK off-by-one上游已无(重构消灭)"，但本次没有专门去
  重新验证这条memory是否仍然成立、是否真的覆盖了ZK track需要的那个具体场景）——这条直接决定"换编译器pin
  是否会引入ZK track专属的旧bug回归"，建议J2/Bettor在决定"用3ed9733同时接管ZK track"之前专门核一遍。
- 未检查"是否存在任何已经用旧`silverc-zk-8065184`+旧ctor成功mint过的真实/测试市场"——§3.4的"风险为零"
  结论目前只是推断，建议Bettor/KANet-UI补一条DB查询实证。

## 五、给Bettor的处置建议

- T4工具方案本身（§1/§2/§3.3/§3.4）除2.2那处非阻断的可读性小瑕疵外全部GREEN，可以按此方案落码。
- **`computeCloseZkTmplAnchor`风险升级为MUST-FIX**：当前mainline三个真实生产调用点已破损，修法必须
  "换编译器pin+补ctor占位值"两步一起做，不能只做ctor补丁那一半。
- D-019编译器锚点：同意，已通过1216/1217紧急回复，本稿正式存档；建议DECISIONS.md写清楚我的sha256跟
  生产锚点sha256不同+原因，避免误判。
- 建议在拍"ZK track换用3ed9733"这个决定前，补两条事实核实（见§四），不要凭印象裁定。

---
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q9yD3q3GqX9ucHyFiAoWTq
