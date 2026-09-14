> **Status**: CURRENT

# silverc-pin.json goldenSample 冻结修法（账本 1415，NWT 复核发现·Bettor 裁定修法）

## 问题

`scripts/silverc-pin.json`'s `goldenSample.silPath` 直接指向生产文件 `kasia-console/src/lib/RootClaim.sil`，
`ctor` 字段烤死了该文件 v0.3 落码前（13 参数）的构造值。`c6c0e35c` 把 `RootClaim.sil` 的 ctor 从 13 参数
改到 12 参数（同病同治删除 `market_suffix_hash`）后，`assertSilvercV100GoldenSample(...)`（`compileSilV100(...)`
每次调用前的强制自检）会用这份仍烤着 13 值旧 ctor 的配置去编译**新的 12 参数源码**，报：

```
compile error: unsupported feature: constructor argument count mismatch: expected 12, got 13
```

这挡住了**所有** `compileSilV100(...)` 调用，不限于 `RootClaim` 本身——因为自检在编译"当前请求的那个合约"
之前无条件先跑一遍。

## 影响范围核实

`c6c0e35c` 提交里对 `RootClaim.sil`/`RefundClaim.sil`/`CloseZkV2.sil`/`PayoutShard.sil`/`PayoutShardV2.sil`
五文件的向量重跑，全部走 `docs/provenance/2026-09-14-j2-t3-v03-*-tokenization/mk_*_vectors.mjs` 里的
`compileGeneric()` 助手——**直接 `execFileSync(silverc.exe, ...)`，不经过 `compileSilV100(...)`，不触发
`assertSilvercV100GoldenSample`**。因此这批 53+14 条向量的正确性**不受本次 golden sample 失配影响**。

会受影响的是 `c6c0e35c` 里所有**经由** `compileSilV100(...)` 的调用——`kanettokenclaim-e2e-vectors.mjs`/
`build-and-vectors.mjs`（KTT v0.3）/`pool-template-artifact.test.mjs`/`scripts/proto-v0-template-anchors.mjs`
——但这些全部发生在**编辑 `RootClaim.sil` 之前**（时间线核对：先做 V100 helper + KTT/KanetTokenClaim 落码，
再发现 `RootClaim.sil` 等五文件的 `ClaimState` 镜像问题、拿到授权后才编辑这五个文件），所以那批调用当时
的 golden sample 仍与 13 参数版本一致，未受影响。

## 修法（Bettor 裁定，不改 pin 的期望值，改为冻结样本源码）

1. 新建 `scripts/silverc-golden/RootClaim.golden.sil` = `git show 6b1e5208:kasia-console/src/lib/RootClaim.sil`
   原样（v0.3 落码前、13 参数版本），加一段头注说明这是冻结样本、不受生产文件后续改动影响。
2. `silverc-pin.json`：`goldenSample.silPath` 改指向这份冻结样本；新增 `frozenFrom` 字段记录出处
   （`6b1e5208:kasia-console/src/lib/RootClaim.sil`）。`ctor`/`expectedBytecodeLength`/`expectedBytecodeSha256`
   三项数值**完全不动**——实测编译冻结样本（含新加的头注释）产物逐字节确认：
   - `length = 2991`（与旧值一致）
   - `sha256 = 755cdd0134cc30c371c3f47fd1b19ad89fe9fa054a51dc3754609781ea795a56`（与旧值一致）
   - `state_span = {offset:1, len:96}`（与旧值一致）

## 干净缓存下的全量复核（`SS_ARTIFACT_CACHE_DIR` 指向一个此前从未用过的新目录）

```
export SS_ARTIFACT_CACHE_DIR=/d/kanet-tn12/scratch/_clean_cache_20260915_192351
```

- `node scripts/proto-v0-template-anchors.mjs` — golden 自检通过（干净缓存下首次编译，非缓存命中），
  `ps_tmpl_hash = 73f79f9eebbbfc94f945d7578c398d155b2d7e4cb3a176346e6069c8a9b2a919`，与修法前一致。
- `pool-template-artifact.test.mjs` — 全部通过。
- `docs/provenance/2026-09-14-j2-ktt-v03-planC-remove-h1b/build-and-vectors.mjs` +
  `kanettokenclaim-e2e-vectors.mjs` — 重新编译，`token_tmpl_hash = 225ebcdec51f5439326e6bc48e47c288ceacbd3bea07aea6771548eeed44d80e`
  与修法前一致；`ktt-v03-vectors.test.json`（2 条）+`kanettokenclaim-v03-vectors.test.json`（4 条）+
  `nwt-ktc-v03-vectors.test.json`（2 条）用 D-019 pin 的 cli-debugger 重新真实跑通，2/2、4/4、2/2 pass。
- 五个 claim 家族 provenance 目录的 `mk_*_tokenization_vectors.mjs` 全部重新执行（不经过 compileSilV100，
  不受本次问题影响，但一并在同一干净缓存环境下重跑留证）+ `mk_shardleafdirect_tokenization_vectors.mjs`：
  RootClaim 6/6、RefundClaim 6/6、CloseZkV2 11/11(part1)+12/12(part2)、PayoutShard 12/12、
  PayoutShardV2 6/6、ShardLeaf_direct 14/14——与修法前逐条一致。
- 11 个主网合约全部重新真实编译确认可编（KTT/KanetTokenClaim 直接 `silverc.exe` 调用；RootClaim/
  RefundClaim/CloseZkV2/PayoutShard/PayoutShardV2/ShardLeaf_direct 经由各自 `mk_*` 脚本；RootClose/
  ShardLeaf 用全新构造的 12/12 参数占位 ctor 直接编译确认；PoolSideTicket 经 `proto-v0-template-anchors.mjs`
  确认）。11/11 全部编译成功。

**结论：`c6c0e35c` 提交的 53+2+4+2+14 条向量结果本身有效（不同路径不受影响），但 golden sample 失配是一个
真实存在的、会挡住后续任何 `compileSilV100(...)` 调用的问题，现已修复**，且干净缓存下的全量复跑确认所有
数值（哈希/字节数/向量结果）与之前一致，没有任何隐藏的缓存污染。

## 附带问题：cache key 是否含编译器二进制指纹或 golden 检查结果（Bettor 询问，本次不改，如实报告）

`kasia-console/src/lib/pool-bshard-artifacts.mjs:51-57` `_runSilverc(...)`：

```js
const sourceHash = createHash('sha256').update(readFileSync(silPath)).digest('hex').slice(0, 16);
const cacheKey = createHash('sha256').update(sourceHash + silvercPath + ctorJsonStr).digest('hex');
```

- `sourceHash` = 待编译 `.sil` **源文件内容**的 sha256（内容寻址）——源文件一改动，cacheKey 自动变化，
  不会命中改动前的旧缓存（本次 `RootClaim.sil` 编辑不会导致缓存污染，缓存 miss 会触发真实重编译）。
- `silvercPath` 只是**编译器二进制的路径字符串**，**不包含二进制自身内容的指纹/哈希**——若同一路径下的
  可执行文件被替换成不同内容（不清缓存目录的前提下），缓存会错误地把换掉之前编的旧产物当结果返回。这是
  一个真实存在的潜在缺口（非本次改动引入，本次不修，如实记录）。
- golden 检查（`assertSilvercV100GoldenSample`）与目标合约的编译**是两次独立的 `_runSilverc(...)` 调用**，
  各自有各自独立的 cacheKey（因为 `silPath` 不同，`sourceHash` 自然不同）——golden 检查结果本身**不进入**
  目标合约那次调用的 cacheKey，每次 `compileSilV100(...)` 都会**无条件重新跑一次** golden 检查（可能命中
  golden 检查自己的缓存，但检查动作本身不会被跳过）。

## 文件清单

- `RootClaim.golden.sil`（本目录留档副本，正式落地位置是 `scripts/silverc-golden/RootClaim.golden.sil`）
- `silverc-pin.json.before` / `silverc-pin.json.after`（修法前后对照）
- `run.log`
- `MANIFEST.sha256`
