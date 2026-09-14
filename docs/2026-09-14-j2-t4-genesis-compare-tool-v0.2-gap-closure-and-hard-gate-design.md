> **Status**: DRAFT-FOR-REVIEW v0.2（docs-only，J2，ledger 1266/1271 派发；不改代码；侧分支
> `coord/j2-t4-zk-tmpl-compare`）

# T4 创世对照工具 v0.2 — §4 前置缺口复核 + `assertGenesisTemplatesCoherent` 硬门设计

## 0. 一句话

v0.1 方案（`docs/2026-09-14-j2-t4-genesis-compare-tool-implementation-plan-v0.1.md`）§4 点的两个"落码前
必须先解决"的缺口——**已经在 D-019 迁移（ledger 1216-1247，本 session 同一批工作）里被顺手解决了，不是
本次要重新设计的东西**（§1 给出确切代码位置 + 真实测试证据）。真正还没做的是：把"这两处 genesis 调用点
之间的值必须一致"这条 T4 设计原本就要防的风险，从"手工跑只读工具才能看见"升级成一道跑在真实 handoff
广播之前的硬门（§2）。

## 1. §4 两个前置缺口 — 复核结论：已关闭

### 1.1 schema 适配器（v0.1 §3.1，原提案：新写 `adaptV100Compiled`，10 行）

**已存在，就是 `compileSilV100`**（`kasia-console/src/lib/pool-bshard-artifacts.mjs:214-235`）——D-019 迁移
落码时（ledger 1216 GO 之后）直接把这个适配层做进了单一编译入口，不是一个独立的、还没写的函数：

```js
export function compileSilV100(silPath, ctorArr, contractName, v100Path = ...) {
  ...
  const { bytecode, template_hash, state_span } = c.compiled;
  ...
  return {
    script: bytecode,
    state_layout: { start: state_span.offset, len: state_span.len },
    ...
  };
}
```

`extractTemplateArtifact`（`pool-template-artifact.mjs:28`）消费的正是 `{script, state_layout:{start,len}}`
这个旧形状——`compileSilV100` 的返回值可以**零改动**直接喂给它。这不是纸面上"形状匹配应该没问题"，是
**真实生产代码已经在这样用**：`pool-shard-register.mjs:253`（`computeCloseZkTmplAnchor` 内部）
`const { templatePrefix, templateSuffix } = extractTemplateArtifact(compiled);`，其中 `compiled` 就是
`compileSilV100(closeZkSilPath, ctor, 'CloseZkV2', v100Path)` 的返回值——且这条路径被
`closezk-v2-mint.e2e.test.mjs`（11/11 PASS，本 session 内实跑过）覆盖，不是未跑过的死代码。

`compileSilV100` 头部注释原话："extractTemplateArtifact 等既有下游零改动直接吃, 不用为新 schema 另外教
一遍下游代码"——写这个函数的时候（D-019 落码期间）就是照 T4 v0.1 §3.1 这条要求设计的，只是当时没有明确
把它记成"T4 的前置依赖已交付"，这次复核补上这条账。

### 1.2 `computeCloseZkTmplAnchor` 参数漂移（v0.1 §3.2，原提案：加 3 个占位 `ctorBytes32`）

**已修，且比原提案更彻底**——不是加 3 个占位符，是改成 3 个**必填真实值**参数（T3 代币化本来就要求这三
个字段是市场级别的真实值，占位符会让 anchor 算错，D-019 迁移落码期间坚持了这一条）。当前签名（`pool-
shard-register.mjs`）：

```js
export function computeCloseZkTmplAnchor(closeZkSilPath, gateTmplHash, tokenTmplHash, claimTmplHash, marketSuffixHash, v100Path)
```

28 参数 ctor（v0.1 写的时候是"现在原样调用会得到 constructor expects 28 arguments, got 25"——现在函数
内部自己拼好这 28 个参数，调用方只需要给 5 个具名字段 + 可选 v100Path，不用自己数 ctor 位置）。两个真实
生产调用点（`pool.js:_resolveZkNativeCtorExtras`、`bshard-close-transport.mjs:buildZkHandoffRequestV2`）
都已经改成用这个新签名，且都在调用前对 `ZK_TOKEN_TMPL_HASH`/`ZK_CLAIM_TMPL_HASH`/`ZK_MARKET_SUFFIX_HASH`
三个 env 做了 fail-loud 检查（缺一个直接 throw，不接受硬编码 fallback）。

### 1.3 复核方法论

以上不是"记忆里觉得应该修过"，是本次直接读了 `pool-bshard-artifacts.mjs`/`pool-shard-register.mjs`/
`pool.js`/`bshard-close-transport.mjs` 的当前源码逐行核对函数签名 + grep 调用点确认接线，并且
`closezk-v2-mint.e2e.test.mjs` 11/11 PASS 是本 session 之前几个commit 里已经跑过的真实证据（不是这次
新跑的，是复用之前的测试记录）。

## 2. 真正还开着的风险：两处 genesis 调用点之间的值一致性

§1 关掉的是"能不能编译、参数对不对"这层；T4 v0.1 §0 想防的"任何一步不一致 ⇒ 拒绝"这条**语义**——**两次
分开发生的 genesis 调用必须用同一份真实值**——目前**没有任何代码检查这件事**，只有注释在提醒人："不能
另起一份"：

- `pool.js:_resolveZkNativeCtorExtras`（市场创建时，genesis①）：用当前 env 的
  `ZK_GATE_TMPL_HASH`/`ZK_TOKEN_TMPL_HASH`/`ZK_CLAIM_TMPL_HASH`/`ZK_MARKET_SUFFIX_HASH` 算出
  `closeZkTmplAnchor`，烤进这个市场的 `PayoutShardV2` ctor（连同 `token_tmpl_hash`/`claim_tmpl_hash`/
  `market_suffix_hash` 三列一起写进 `payout_shards` 表——K-18"谁编译谁 declare"纪律，v205 迁移）。
- `bshard-close-transport.mjs:buildZkHandoffRequestV2`（该市场后来 close/attest 后，genesis②——铸
  `CloseZkV2` 覆盖，该函数注释原话"这是 zk_handoff 铸 CloseZkV2 genesis 的实际调用点"）：**重新读取当前
  env** 的同名四个值，重新调 `computeCloseZkTmplAnchor` 算 `templateA..D`。

这两次调用之间可能隔了任意长时间（市场从创建到结算的整个生命周期）。若这期间 `kanet.env` 的
`ZK_GATE_TMPL_HASH`（换了新 guest image）或 T3 三个 env 被更新过（比如给下一批市场切了新 token 模板），
**genesis②读到的是新值，跟这个具体市场 genesis①时烤进链上 redeem 的旧值不一致**——`buildZkHandoffRequestV2`
算出的 `templateA..D` 会跟链上已经存在的 `PayoutShardV2` 里烤的 `closeZkTmplAnchor` 对不上，注释自己也
点明了后果："否则四段模板跟链上已烤的 anchor 对不上"——但目前只有这句注释在防，没有代码在防。

`pool.js` 侧（genesis①）没有对应风险——它是这个市场第一次烤值，此刻还没有"更早的自己"可以对照，天然
没有"跟谁不一致"的问题；风险只存在于 genesis②（离场时重新计算，必须回看这个市场自己 genesis①时的记录）。

## 3. 硬门设计：`assertZkHandoffTmplCoherent`

**范围收窄，不是 v0.1 提案的全量 `assertGenesisTemplatesCoherent`（10 文件通用创世对照）**——那个全量工具
仍然需要 v0.1 §2 那份"spec 从哪来"的设计（当前没有生产创世流水线产出那个 spec 对象，v0.1 §2 已经点过
这个尚未定案），本设计只解决 §2 揭示的这一个具体、已经有真实调用点、已经有真实数据源（`payout_shards`
表）的窄问题——不因为要等全量工具就绕过这个已经能修的具体风险。

### 3.1 接口

```js
// kasia-console/src/lib/pool-bshard-artifacts.mjs 或 bshard-close-transport.mjs 内部私有函数(倾向前者,
// 跟 compileSilV100/computeCloseZkTmplAnchor 同一处, 避免 close-transport 反向 import artifacts 层)
function assertZkHandoffTmplCoherent(db, marketId, { tokenTmplHash, claimTmplHash, marketSuffixHash }) {
  const row = db.prepare(`SELECT token_tmpl_hash, claim_tmpl_hash, market_suffix_hash FROM payout_shards WHERE logical_market_id = ?`).get(marketId);
  if (!row) throw new Error(`assertZkHandoffTmplCoherent: 找不到 market=${marketId} 的 payout_shards 行 — genesis 从没发生过或数据丢失, 拒绝 handoff`);
  for (const [label, dbVal, envVal] of [
    ['token_tmpl_hash', row.token_tmpl_hash, tokenTmplHash],
    ['claim_tmpl_hash', row.claim_tmpl_hash, claimTmplHash],
    ['market_suffix_hash', row.market_suffix_hash, marketSuffixHash],
  ]) {
    if (!dbVal) throw new Error(`assertZkHandoffTmplCoherent: market=${marketId} 的 payout_shards.${label} 是 NULL(D-019 之前的旧市场, 或 genesis 时写入方漏传) — 无法核对, 拒绝 handoff(不猜测/不放行)`);
    if (dbVal.toLowerCase() !== String(envVal || '').toLowerCase()) {
      throw new Error(`assertZkHandoffTmplCoherent: market=${marketId} 的 ${label} 当前 env 值(${envVal})跟 genesis 时烤入的值(db=${dbVal})不一致 — env 在这个市场创建之后被改过, 用当前 env 重算 closeZkTmplAnchor 会跟链上已烤的值对不上, 拒绝 handoff, 不静默用新值`);
    }
  }
}
```

- 只查 3 列（`token_tmpl_hash`/`claim_tmpl_hash`/`market_suffix_hash`），不查 `gateTmplHash`——
  `gateTmplHash` 走的是独立的 `ensureGateTmplHashFresh(ZK_GATE, kaspaZk, {force:true})` 机制（已有自己
  的"新鲜度"校验，不是本设计要补的缺口，见 `docs/2026-07-09-gate-tmplhash-live-derive-design.md`），本
  函数不重复造轮子，只补 T3 代币化三个字段目前完全没有跨时间一致性校验这个具体空白。
- 复用 T4 只读工具（`t4-zk-tmpl-env-db-compare.mjs`）已经验证过的比对逻辑思路（大小写不敏感的 hex
  比较），但这里是**抛异常的运行时闸**，不是打印报告的诊断脚本——两者定位不同，不合并成一个文件（诊断
  工具允许在没有匹配市场时正常退出打印"无可对照"；硬门在"查不到这个具体市场"时必须拒绝，语义不同，
  硬凑一起会让其中一种用法的错误处理逻辑污染另一种）。

### 3.2 调用点与失败处置

**`bshard-close-transport.mjs:buildZkHandoffRequestV2`**——在现有 5 个 env fail-loud 检查之后、
`computeCloseZkTmplAnchor` 调用之前插入：

```js
if (!process.env.ZK_TOKEN_TMPL_HASH) throw ...   // 已有
...
assertZkHandoffTmplCoherent(sqlite, marketId, {
  tokenTmplHash: process.env.ZK_TOKEN_TMPL_HASH,
  claimTmplHash: process.env.ZK_CLAIM_TMPL_HASH,
  marketSuffixHash: process.env.ZK_MARKET_SUFFIX_HASH,
});
const { templateA, templateB, templateC, templateD } = computeCloseZkTmplAnchor(...);   // 已有, 位置不变
```

失败处置：**throw，函数在任何 `sendCommandAsync`/转账/广播发生之前就退出**（`buildZkHandoffRequestV2`
当前的 env 检查已经是这个位置——本门插在同一批检查里，不改变"检查完 env 才开始碰钱"这个既有顺序，只是
把检查范围从"这几个 env 有没有设"扩到"这几个 env 现在的值是不是还是这个市场当初烤的那个值"）。跟现有
env-missing throw 走同一条错误路径（`buildZkHandoffRequestV2` 目前没有专门的 try/catch 包这几行，异常
原样往上抛给调用方——同 K-18 拒签闸"throw = 拒绝，不是崩溃"的既定处置口径，调用方链路已经在这条纪律下
运作，不需要新增处理逻辑）。

**`pool.js:_resolveZkNativeCtorExtras`**——**不需要加这道门**（§2 已说明：genesis①没有"更早的自己"可
对照，`payout_shards` 这时还没有这个市场的行）。这里唯一能做、且已经在做的是 env-missing 检查——那已经
是当前实现，本设计不新增内容。

### 3.3 验收标准

- 正向：某市场 genesis①烤入的三列值 == handoff 时 env 现值 → `assertZkHandoffTmplCoherent` 不抛，
  `buildZkHandoffRequestV2` 照常继续。
- 负向①：改一个 env 值后模拟 handoff（同一个 marketId，DB 里的三列不变）→ 抛出，reason 指名具体哪一列
  不一致 + db/env 两个值都在错误信息里（可直接定位，不用再去翻两处代码）。
- 负向②：`marketId` 在 `payout_shards` 里查无此行 → 抛出，不是"当没有约束处理"。
- 负向③：`payout_shards` 该市场三列任一是 NULL（D-019 之前的旧市场，理论上不会走到 ZK-native handoff
  这条路，但门本身独立防御，不依赖"调用方保证不会传旧市场进来"这个假设）→ 抛出。
- 单测建议放 `bshard-close-transport.test.mjs`（若该文件不存在则新建），用真实 `sqlite` 临时库 + 真实
  seed 一行 `payout_shards`，不 mock DB 层——同本 session 全程"real compiler/real DB over hand-crafted
  fixture"的纪律。

## 4. 不在本次范围内（记账，不是忘记）

- v0.1 §2 的"spec 从哪来"仍未定案——全量 `assertGenesisTemplatesCoherent`（10 文件通用创世对照 CLI）要
  等 T4 的"市场创世"生产路径本身先定型（v0.1 §2 原话："T4 的'市场创世'是全新一条路径,目前连 DB 表列都
  未定案"）,这次 v0.2 只解决已经有真实调用点、真实数据源的这一个窄问题, 不代表全量工具的前置条件已经
  齐了。
- `CloseZkV2.sil` 的 `dummyAtMs` 变长编码风险（另一张独立票，`2026-09-14-j2-ctor-int-encoding-width-
  probe-v0.1.md` 结尾已标记）——跟本文档主题（值一致性）是两个不同维度的风险，不在这里重复处理。
- `gateTmplHash` 的新鲜度机制（`ensureGateTmplHashFresh`）本身是否也需要类似的"跟这个具体市场 genesis
  时是否一致"校验——现有机制是"跟当前 guest image 是否新鲜"，跟本文档"跟这个市场自己的历史值是否一致"
  是不同的问题，值得追问但需要先读 `ensureGateTmplHashFresh`/`gate-tmpl-hash.mjs` 的完整设计再评估，本
  次没有展开，只标记。
