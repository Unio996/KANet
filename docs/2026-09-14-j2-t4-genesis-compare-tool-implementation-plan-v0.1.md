# T4 创世对照工具 — 实现方案 v0.1（docs，不写码，ledger 1214 派发）

> **Status**: DRAFT-FOR-REVIEW v0.1（2026-09-14 · J2 · ledger 1214 派发，输入 = T4 v0.1-v0.4 全部设计稿 +
> T3 as-built v0.5 + `docs/2026-09-14-j2-t3-vector-currency-audit-v0.1.md`。本稿只出方案，不落码——按
> Bettor 原话"先出 1 页实现方案叫我推，NWT 审后再落码"。侧分支 `coord/j2-t4-genesis-compare`，独立 worktree
> `scratch/_j2_wt_t4_genesis_compare`，尚未 `npm install`（落码阶段才装，本稿只读源码不需要跑 node_modules
> 依赖的代码路径）。)

## 0. 一句话

工具 = 一个**创世前硬门**（`assertGenesisTemplatesCoherent(spec)`，CLI 包一层）：给定"即将写进创世的全部 ctor
常量"，(a) 用单源 pinned 编译器把 10 个模板各编一次拿到权威 `template_hash`/`bytecode`，(b) 把 spec 里的
25 处 ctor-only 哈希/锚槽位（T4 v0.3 §1 表）与 (a) 的编译产物逐字节比，(c) 就是 (a)+(b) 合并说的"全字节
重编译比对"（T4 v0.3 §2.1.1 步骤 (c)），(d) 拿比对通过的 redeem 字节重算 P2SH 地址并与创世 tx 即将写的
`scriptPublicKey` 比，(e) 跑 tripwire 精确扫描（直接 `import` 现有 `r-ctor-only-assignment-tripwire-lib.mjs`
的 `findCtorOnlyTripwireHits`，不重新发明）。**任何一步不一致 ⇒ `exit 1`，不产出任何创世参数**（NO TX NO
STATE CHANGE 的创世前变体：连"参数已就绪"这个中间状态都不允许留下）。

**本稿在读源码阶段发现两个必须在落码前决议的真实缺口，不是猜测——见 §4。这两个缺口不解决，工具写出来会
产出错误结果而不报错，比不写工具更危险。**

## 1. 接口

```js
// kasia-console/src/lib/t4-genesis-compare.mjs（新文件，落码阶段建）
export function assertGenesisTemplatesCoherent(spec) → { ok: true, report } | { ok: false, report }
```

- **输入 `spec`**：一个 JS 对象（或对应 JSON 文件，CLI 从文件读），形状见 §2。
- **输出**：`{ ok, report }`——`report` 是机器可读对象（见下），CLI 包装层把 `report` 落盘成
  `<out>/genesis-compare-report.json` + 打印一份人读摘要（每个文件一行 `PASS`/`FAIL` + 不一致处的具体字段名/
  期望值/实际值），`ok=false` 时 CLI 以 `process.exitCode = 1` 退出，**不写任何创世相关文件**（工具本身不
  产出 ctor 参数，只消费调用方已经准备好的 spec 并判定"能不能拿它去创世"）。
- **`report` 机器可读形状**（提案，接受 NWT 审时调整字段名）：
  ```json
  {
    "ok": false,
    "compiler": { "path": "...", "sha256": "..." },
    "files": [
      {
        "name": "PayoutShard",
        "silPath": "kasia-console/src/lib/PayoutShard.sil",
        "ctorFieldsChecked": ["poolMerkleRoot", "predicate_commit", "token_tmpl_hash", "claim_tmpl_hash", "market_suffix_hash"],
        "step_a_compile": "ok",
        "step_b_ctor_match": "ok",
        "step_c_full_recompile_bytecode_match": "ok",
        "step_d_p2sh_match": { "ok": false, "expected": "kaspatest:...", "actual": "kaspatest:..." },
        "step_e_tripwire": "ok"
      }
    ],
    "tripwireHits": []
  }
  ```

## 2. 输入来源（`spec` 的形状——这是本稿的一处新设计决定，当前没有任何既有代码产出这个东西）

**现状核实**：T3 的 10 个文件目前**没有任何生产创世代码路径**——`pool-shard-register.mjs` 的
`ensurePayoutShard`/`ensurePayoutShardV2` 面向的是**旧 bshard rolling-shard 家族**（`covenant_family
∈ {v1_committee, v2_zk}`，`pool_merkle_root`/`predicate_commit` 两列，ctor 形状与本次 T3 代币化后的
`PayoutShard.sil`/`PayoutShardV2.sil` **完全不同**——旧家族没有 `token_tmpl_hash`/`claim_tmpl_hash`/
`market_suffix_hash`，也不是 25/30 参数）。T4 的"市场创世"是**全新一条路径**（T4 v0.1 §3 的
`market_genesis` intent），目前连 DB 表列都未定案（T4 v0.1 §3.3 "视 T3/T5 定名"）。所以 spec 的具体来源
（人手填的草稿 JSON？某个上游"下注意图"推导出来的？）**本稿不能假装已有答案**，只能提案一个**独立于来源**
的稳定接口形状，真正的生产调用点由 T4 后续"接线"批次决定怎么产出这个对象：

```json
{
  "compilerPath": "D:/.../silverc.exe",
  "compilerSha256Expected": "...",
  "files": {
    "RootClose": { "silPath": "kasia-console/src/lib/RootClose.sil", "ctor": { "committee_hash": "..hex..", "deadline_ms": 1234, "...": "..." } },
    "ShardLeaf": { "silPath": "...", "ctor": { "...": "..." } },
    "...": "全部 10 个文件各一条，字段名逐字匹配该 .sil 当前 ctor 参数名（见 §3 命名坑）"
  },
  "expectedGenesisOutputs": [
    { "file": "RootClose", "expectedScriptPubKeyHex": "aa20....87", "expectedAddress": "kaspatest:..." }
  ]
}
```

- 每个文件的 `ctor` 对象**必须用该 `.sil` 源码里的确切参数名做 key**（不是位置数组）——理由：`docs/2026-09-
  14-j2-t3-vector-currency-audit-v0.1.md` 已经证实"同名不同物"的碰撞真实存在（`RootClose.claim_tmpl_hash`
  指向 `RootClaim` 模板，`RootClaim/RefundClaim/PayoutShard/PayoutShardV2/CloseZkV2` 的 `claim_tmpl_hash`
  全部指向 `KanetTokenClaim` 模板——T4 v0.3 §2 已经点过这个坑）；用具名 key 而非位置数组能让 (b) 步骤报错
  信息直接点名"哪个文件的哪个字段"，而不是"第 N 个参数"这种要反查签名表才能懂的错误。
- `expectedGenesisOutputs` 是可选的——只有调用方已经构造好即将广播的创世 tx 时才填，触发步骤 (d)；不填时
  (d) 跳过（"unknown"而非"fail"），工具据此判定 `ok` 只覆盖 (a)(b)(c)(e)。**不伪造一个"跳过=通过"的假阳性**
  ——report 里 `step_d_p2sh_match` 会显式写 `"skipped_no_expected_output"`，CLI 摘要行加粗提示这不是全绿。

## 3. 与既有代码的复用关系（逐条核实，不是假设）

### 3.1 单源编译（步骤 a/c）—— **复用受阻，需要先解决 §4.1 的 schema 不兼容**

`pool-bshard-artifacts.mjs` 的 `compileSil(silPath, ctorArr, silvercPath)` 本身（子进程调用 + sha256+ctor
缓存 key + 30s timeout + 三类错误区分）**可以直接复用**，只需新增一个 `SILVERC_T3_MARKET_PATH` 环境变量
（同 `SILVERC_LEGACY_PATH`/`SILVERC_ZK_PATH` 的既有写法），不改这个函数本身一行代码。

但 `pool-template-artifact.mjs` 的 `extractTemplateArtifact(compiled)` **假设 `compiled` 是旧 schema**
（`{script:number[], state_layout:{start,len}}`）——本次实测（`docs/2026-09-14-j2-t3-vector-currency-audit-
v0.1.md` 引用的隔离工具链 `_j2_silverc_v100`，`scratch/_j2_silverc_v100@3ed9733`=tag v1.0.0，sha256
`4378ba6557f7b7b088d6ad7a400422acb51a7ffd04f86ed974055c4177ef8643`，出处
`docs/2026-09-13-j2-silverscript-v100-full-recompile-list-v0.1.md`）证实这个二进制的 `-o` 输出是**完全
不同的 schema**：`{schema_version, compiler_version, structs, contracts:{<Name>:{source_path,
runtime_state, entries, compiled:{bytecode, template_hash, state_span:{offset,len}}}}}`——字段全部改名
（`script`→`bytecode`，`state_layout`→`state_span`，`start`→`offset`），且多包一层
`contracts[Name].compiled`。**`extractTemplateArtifact` 直接喂这个新 schema 会在 `sl.start`/`sl.len` 处
读到 `undefined`，抛"state_layout {start,len} required"——不是"能凑合用"，是**当场报错**，这一点在落码前
必须解决，不能留到写测试时才发现。**

**方案（提案，供 NWT/Bettor 选）**：写一个 10 行的适配函数

```js
function adaptV100Compiled(rawOutJson, contractName) {
  const c = rawOutJson.contracts[contractName];
  if (!c) throw new Error(`v1.0.0 编译产物里没有合约 ${contractName}（检查 .sil 里 contract 名是否与文件名一致）`);
  return { script: Buffer.from(c.compiled.bytecode, 'hex'), state_layout: { start: c.compiled.state_span.offset, len: c.compiled.state_span.len } };
}
```

放在新文件 `t4-genesis-compare.mjs` 内部（不改 `pool-template-artifact.mjs`，那个文件仍然被旧 bshard 家族
使用，改它有回归旧家族的风险），`extractTemplateArtifact(adaptV100Compiled(raw, name))` 之后原样复用，不
重新发明 prefix/suffix/hash 切分逻辑。

### 3.2 `computeCloseZkTmplAnchor` 复用关系 —— **当前直接复用会报错，需要一个 3 参数的小补丁**

`pool-shard-register.mjs:189` 的 `computeCloseZkTmplAnchor(closeZkSilPath, gateTmplHash)`：
- 硬编码走 `SILVERC_ZK`（生产 ZK 专属 pin `silverc-zk-8065184.exe`，**不是** `_j2_silverc_v100`）——这本身
  是否仍是"当前 CloseZkV2.sil 的正确 pin"，是 §4.1 要先定的问题，不是本节能单独回答的。
- **ctor 数组只填 25 个值**（`gateTmplHash/betsRootBaked/refundRootBaked/attestedAtMs/attestedWinner/
  closed/payoutRootField/consolidated_pool` 8 个 + `W17()` 17 个 nullifier word），是**这个函数写作时
  `CloseZkV2.sil`（当时叫 `CloseZkRepro4.sil`，函数注释原话）的 ctor 形状——T3 代币化（ledger 1170/1188）
  给 `CloseZkV2.sil` 追加了 3 个新增尾部 ctor 参数（`token_tmpl_hash`/`claim_tmpl_hash`/
  `market_suffix_hash`），当前 `CloseZkV2.sil` 实读 28 参数**。实测核对（本次读源码直接数，非猜）：
  `computeCloseZkTmplAnchor` 现在原样调用会得到 `constructor expects 28 arguments, got 25`——**这是一个
  真实的、当前代码里就存在的 ctor 漂移，不是本工具引入的新问题，是本工具落码前必须先修的一个前置小补丁**
  （在 `computeCloseZkTmplAnchor` 的 `ctor` 数组末尾加 3 个占位 `ctorBytes32(...)`，同函数已有的
  "distinct non-zero dummy markers" 纪律——不能用 `z32`，要挑不会跟已有 dummy 撞的新字节模式，函数注释
  里已经写了为什么撞会被 `findUnique` 的"精确出现 1 次"断言拦下）。
- **复用关系结论**：T4 工具**不重新实现** `closeZkTmplAnchor` 的"4 段模板切分 + round-trip 自证"算法（那
  段 `findUnique`/`templateA..D` 逻辑已经踩过 ledger 1181 的坑，`docs/2026-09-14-j2-t3-v03-payoutshardv2-
  zkhandoff-tokenization/README.md` 记录过完整教训）——**直接 `import { computeCloseZkTmplAnchor }`**，
  但**前提是先提一笔独立小 commit 把上面的 3 参数漂移修掉**（这笔小修不属于 T4 工具本身，是 T4 工具的
  前置依赖，建议单独走一次报备→审核→批准→测试，不跟 T4 工具混在一个 diff 里，方便 NWT 分别审"这个漂移
  修得对不对"和"T4 工具接口设计得对不对"两件事）。

### 3.3 P2SH 重算（步骤 d）—— 复用 `payToScriptHashScript`/`addressFromScriptPublicKey`

`kasia-relay/src/lib/p2sh.mjs` 的 `_foreignTemplateAddress(prefixHex, stateHex, suffixHex, networkId)`
（未导出的内部函数）已经是这个动作的现成范式：`prefix‖state‖suffix → payToScriptHashScript →
addressFromScriptPublicKey`。**但这两个底层 primitive 来自 kaspa-wasm，而 kaspa-wasm 是 relay 进程的依赖
（铁律：Console 传导不碰链、Relay 是唯一链上出口）**——T4 工具跑在 console 侧（`kasia-console/src/lib`），
**不应该直接 import kaspa-wasm 重算地址**，即使技术上地址推导是纯计算不碰链。**方案**：P2SH 的
`scriptPublicKey` 字节本身（`aa20‖blake2b(redeem)‖87`）**不需要 wasm**——本次 T3 全部 provenance 脚本
（`compileGeneric`/`compileKTT`/`compileKTC` helper，贯穿本 session 全部向量生成）都是用纯 `blake2b`（`@
noble/hashes`，console 侧已有依赖，无需 wasm）算出这个 24 字节脚本，工具只需要比对到这一层（**脚本字节**，
不换算成 bech32 地址字符串）就足够判定"P2SH 是否一致"——**换算成人读地址字符串这一步才需要 wasm，且只是
给人看，不是判定用的**。所以步骤 (d) 的判定路径改成：`scriptPubKeyHex = 'aa20' + blake2b(redeem).toString
('hex') + '87'`（纯 JS，零 wasm 依赖），与 `spec.expectedGenesisOutputs[i].expectedScriptPubKeyHex` 直接
字符串比对；如果 spec 里给的是人读地址（`expectedAddress`）而不是脚本字节，工具**报错要求换成脚本字节**
（不在 console 侧偷偷调 wasm 转换，前置到"谁构造这个 tx 谁负责把地址也转成脚本字节传进来"）。

### 3.4 (d) tripwire 精确扫描 —— 直接复用，零改动

`scripts/r-ctor-only-assignment-tripwire-lib.mjs` 的 `findCtorOnlyTripwireHits(content)` 是纯函数（字符串
in，命中数组 out），T4 工具在 §1 步骤 (e) 直接 `import` 它，对 `spec.files` 涉及的 10 个 `.sil` 文件各读一次
内容跑一遍——**这不是重复 lint-kanet 已经在 commit 时做的事**：lint-kanet 守的是"仓库里任何时刻都不能有这类
赋值语句"，T4 工具守的是"创世这一刻，我马上要用来编译的这份源码，此刻确实没有"——两者时间点不同（lint 是
每次 commit，T4 是每次创世），独立触发互不替代（同 (c)/(d) 两步"独立交叉验证不是重复"的既有论证模式，T4
v0.3 §2.1.1 已经这么论证过 (c) 和 (d) 的关系，(e) 与 lint-kanet 是同一种关系）。

## 4. 落码前必须先定的两处（本稿核实，不代为裁定）

### 4.1 【阻断级】哪个 silverc 二进制是这 10 个文件的权威 pin？

当前状态：**没有任何 console 侧代码为这 10 个新文件声明过 pin**（`grep` 全 `kasia-console/src/lib`
零命中 `_j2_silverc_v100`/`SILVERC_T3_MARKET`等字样，这本就是预期——T3 整个开发周期都在隔离侧分支
`coord/j2-t3-market-sil` 用隔离工具链 `_j2_silverc_v100` 编译+验证，从未接入过任何生产 console 路径）。
候选：`scratch/_j2_silverc_v100`@`3ed9733`（tag v1.0.0，sha256 见 §3.1）——这是 T3 全部 43+44+... 条向量
唯一验证过的编译器，如果 T4 用另一个二进制编译同一份 `.sil` 源码，算出的 `template_hash`/`bytecode` 可能
与 T3 已验证的字节不同（不同版本 codegen 差异，本 session 已经见过一次真实案例：`CloseZkV2.sil` 同一份
源码在不同 silverc 之间字节码长度不同，`pool-shard-register.mjs:65` 注释原话）。**这不是本稿能替 Bettor/
NWT 做的决定**——需要显式确认"`_j2_silverc_v100`@`3ed9733` 就是即将部署到生产的那个二进制"，并把它的
路径+sha256 写进一个新增的、供 T4 工具与未来任何生产编译路径共同引用的常量（同 `SILVERC_LEGACY_PATH`/
`SILVERC_ZK_PATH` 的既有写法，建议 `SILVERC_T3_MARKET_PATH`，默认值指向该 sha256 对应的二进制，`compileSil`
的 sha256-in-key 缓存纪律已经能防"意外换了二进制却没发现"这类问题，但**前提是先有人拍板"这一个就是对的"**）。

### 4.2 【非阻断，须记录】`computeCloseZkTmplAnchor` 的 3 参数漂移修补——建议独立走一次报备

见 §3.2。这笔修补范围极小（3 行内），但按铁律 0（"钱路/covenant"类改动，未经报备→审核→批准→测试无权动
代码），仍需单独报备，不因为"只是加 3 个占位参数"就跳过流程。本稿建议的落地顺序：**先批这笔小修 → 小修
落码+过既有 `closezk-v2-mint.ctor-position.test.mjs` 等现有测试 → 再开始写 T4 工具本体**（工具本体的开发
不阻塞在这笔小修的评审结果上——工具可以先假设"未来某个已修好的 `computeCloseZkTmplAnchor`"来写骨架和测试，
真正接线时才需要这笔小修已经落地）。

## 5. 测试计划

### 5.1 单元测试（`t4-genesis-compare.test.mjs`，纯函数，零子进程，同现有 `bshard-payout-family-coherence.
test.mjs` 的 `fakeP2sh` mock 风格）

- **步骤 (b) 命名碰撞回归**：构造一个 spec，`RootClose.ctor.claim_tmpl_hash` 与
  `RootClaim.ctor.claim_tmpl_hash` 故意填**同一个值**（现实中这两者本就不应该相等，一个指向 `RootClaim`
  模板一个指向 `KanetTokenClaim` 模板）——断言工具**不会**因为两个字段名相同就误判"应该相等"（工具的比对
  单位必须是"文件名+字段名"两段式，T4 v0.3 §2 已经点过这个坑，测试要把它钉成回归用例，不能只在文档里
  提一句）。
- **步骤 (d) skip 语义**：spec 不含 `expectedGenesisOutputs` 时，`report.files[].step_d_p2sh_match ===
  'skipped_no_expected_output'` 且**不因此把整体 `ok` 判为 `true`**（除非 (a)(b)(c)(e) 全过——skip 不是
  "视为通过"，是"这一步没有对照对象，如实标注未覆盖"，`ok` 的定义需要在实现时明确写清楚"skip 算不算
  影响 ok"，本稿倾向**"expectedGenesisOutputs 缺失时 ok 只覆盖到 (c)"**，即 `ok=true` 但 `report` 里有
  醒目的"P2SH 未核"字样，避免调用方误读 `ok:true` 为"可以放心创世"）。
- **步骤 (e) 复用回归**：给一个文件的 spec 内容里手工注入 `predicate_commit = ...`（模拟未来某次改动打破
  tripwire 前提）——断言 `findCtorOnlyTripwireHits` 命中、`report.tripwireHits` 非空、`ok=false`，且
  错误信息包含"NWT 复核"字样（同 lint-kanet 现有提示文案一致，不要求逐字但要求提到复核纪律）。
- **§4.1/§4.2 两处依赖用 mock**：单元测试不真的跑 `compileSil` 子进程（同现有测试文件的既有惯例，
  `fakeP2sh`/mock compiled JSON），验证的是"给定编译产物之后的比对逻辑对不对"，不验证"真实编译器编得对
  不对"（那部分交集成测试）。

### 5.2 集成测试（需要真实 pinned 编译器，标 `skip_in_batch`/STANDALONE，同 `R-REALCHAIN-SKIP-BATCH` 既有
纪律——虽然这里不碰链，但会真的 spawn 子进程跑编译器，跟 batch 测试的"零外部依赖"预期不符）

- 用当前仓库真实的 10 个 `.sil` 文件 + 一组真实占位 ctor 值，跑一次完整 `assertGenesisTemplatesCoherent`，
  断言 (a)(c) 对全部 10 文件都能编译成功（不断言具体 hash 值——占位值本身没有"正确答案"，这一步只验证
  "流程能跑通、不报意外异常"）。
- **§3.1 schema 适配回归**：直接拿 `_j2_silverc_v100` 编译一次任意一个文件，断言 `adaptV100Compiled` 产出
  的对象能被 `extractTemplateArtifact` 正常消化（不抛"state_layout required"）——这是本稿发现的真实缺口，
  必须有一条测试钉死，不能只在文档里描述完就假装已经解决。
- **§4.2 回归**（依赖那笔独立小修先落地）：`computeCloseZkTmplAnchor` 对当前 28 参数 `CloseZkV2.sil` 跑
  通，不抛"constructor expects 28, got 25"。

### 5.3 与既有 T3 provenance 的交叉核对（不是新测试，是复用既有产物验证 T4 工具本身的正确性）

`docs/2026-09-14-j2-t3-v03-*-tokenization/` 等目录都留有 `*.reference.ctor.json`/`*.reference.compiled.
json`（各文件真实编译过的参考产物）——T4 工具落码后，第一次验收可以直接拿这些既有参考产物做"用 T4 工具
重跑一遍，比对结果是否与当初 T3 生成时的 `template_hash` 一致"，作为工具本身正确性的独立交叉验证（不是
新造 fixture，复用已经存在且已被这一整个 session 反复验证过的真实产物）。

## 6. 没有变化的部分 / 不在本稿范围

- T4 v0.1 §3/§4/§5（`market_genesis` intent、`escrow_landed_at`/`market_landed_at` 双门、填错自毁的
  non-blocking 处置）——本稿只是 §2 对照检查里"步骤 (c)+(d)"这一块的具体落码方案，不涉及 intent 框架/
  DB 表列/巡检 cron。
- T4 v0.3 §1 的 25 处 ctor-only 槽位枚举、T4 v0.4 的 tripwire 设计与 `predicate_commit` 措辞——本稿直接
  引用，不重复论证。
- 真正的"生产调用点怎么产出 `spec` 对象"（谁在什么时候调用 `assertGenesisTemplatesCoherent`）——留给 T4
  intent 接线批次，本稿只定工具本身的输入/输出契约。

## 7. 没核到的

- `pool_markets`（或未来市场表）的具体列名尚未定案（T4 v0.1 §7 已如实记录），本稿 §2 的 spec 形状因此是
  "独立于表结构"的纯 JSON 提案，不假设任何具体列名。
- `expectedGenesisOutputs` 里的 `expectedScriptPubKeyHex` 由谁计算、什么时候计算（创世 tx 构造代码尚不
  存在）——本稿只定"工具需要这个字段才能跑步骤 (d)"，不代为设计创世 tx 构造流程。
- KanetTestToken(v0.7)/KanetTokenClaim 两个"代币家族"文件的创世流程是否与 8 个市场合约文件共享同一个
  `market_genesis` intent，还是各自独立的 mint 流程（T2/T1 骨架稿可能已经回答，本稿写作时未逐篇重读，
  留给落码阶段核对 `docs/2026-09-13-j2-t2-market-and-claim-covenant-a2-skeleton-v0.1.md`）。
