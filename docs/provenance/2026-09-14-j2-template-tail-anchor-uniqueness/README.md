> **Status**: CURRENT

# 🔴 重大发现: `market_tmpl_suffix`/`token_tmpl_hash` 等"协议常量"假设有误——只有 `ps_tmpl_hash` 是真常量；ShardLeaf_direct 存在真实、唯一、稳定的 132 字节尾部锚，可安全替代原假设

出处：Bettor 裁定要求（在开工 `scripts/proto-v0-template-anchors.mjs` 之前先验证一个从未实测过的架构假设）+ Bettor/NWT 后续三轮追问（①反汇编 ②11 合约唯一性扫描 ③真实端到端向量）。

## 结论先行

1. **原假设错误**：`docs/2026-09-14-j2-proto-v0-backend-api-design-v0.1.md` §4 / `docs/2026-09-14-j2-proto-v0-covenant-construction-spec-v0.1.md` §2 都曾写"`market_tmpl_suffix`/`token_tmpl_hash`/`ps_tmpl_hash` 是协议常量，编译一次全市场复用"——这从未被实测验证过。实测：**11 个主网集合约里，只有 `PoolSideTicket` 的 `ps_tmpl_hash` 是真正的协议常量**（它没有任何 ctor-only 字段，全部 4 个 ctor 参数都是 State）。其余需要"协议常量"的场景（`market_tmpl_suffix`/`token_tmpl_hash`/`claim_tmpl_hash`/`refundclaim_tmpl_hash`）如果假设为"取整段 `extractTemplateArtifact(...).templateSuffix`"，会随该合约自己的逐市场字段（尤其 `shard_pool_id`）变化，不是协议常量。
2. **但不是死路**：ShardLeaf_direct 存在一段真实的、**长度 132 字节、内容完全独立于全部 8 个非-State ctor 字段取值**的稳定尾部（"stable tail"），且这段尾部在全部 11 个主网集合约 + 1 个无关最小合约里**唯一**（最接近的同族 `ShardLeaf` 也只共享 24 字节，远小于 132）。用这段真实计算出的 132 字节作为 `KanetTestToken` 的 `market_tmpl_suffix`，**真实编译通过 + cli-debugger 正向/负向向量全部符合预期**——`market_tmpl_suffix`/`token_tmpl_hash` 之间此前担心的"编译期环"看起来**不成立**，只要用这段稳定尾部而不是整个 suffix。
3. **仍需 NWT 独立复核**：① 132 字节的具体 opcode 含义没有做逐字节反汇编（机器上没有现成反汇编工具），只有间接证据；② 唯一性扫描目前只测了这批具体占位/随机值，不是数学证明；已分别立票/记录，交 NWT 用 silverscript 源码 opcode 表复核。

## 时间线（三轮追问，与 Bettor/NWT 逐条对应）

### 第一轮：协议常量假设是否成立？（`01-invariance-check.mjs`）

对 ShardLeaf_direct / RootClaim / RefundClaim / KanetTestToken / PoolSideTicket 各编译两次，用两组明显不同的占位值填非-State 字段，比对 `extractTemplateArtifact` 的 prefix/suffix/hash 输出：

| 合约 | 结果 |
|---|---|
| PoolSideTicket | ✅ INVARIANT（无 ctor-only 字段，天然常量） |
| ShardLeaf_direct | 🔴 NOT INVARIANT |
| RootClaim | 🔴 NOT INVARIANT |
| RefundClaim | 🔴 NOT INVARIANT |
| KanetTestToken | 🔴 NOT INVARIANT |

### 第二轮：逐字段隔离，找出病根（`02-isolate-shardleafdirect-8fields.mjs` / `03-isolate-rootclaim-refundclaim.mjs`）

ShardLeaf_direct 8 个非-State ctor 字段逐一隔离测试（每次只换 1 个字段）：

| 字段 | 是否影响 template hash |
|---|---|
| `market_id`(0) | **不影响**（唯一例外） |
| `ps_tmpl_hash`(1) | 影响 |
| `shard_pool_id`(2) | 影响 |
| `seal_count`(3) | 影响（⚠ 本 provenance 首次报告时漏测，NWT 独立复现"7/8"后补齐，见下方"对账"） |
| `min_bet`(4) | 影响 |
| `rootclose_tmpl_hash`(5) | 影响 |
| `rootclose_init_payoutRoot`(6) | 影响 |
| `token_tmpl_hash`(7) | 影响 |

**⇒ 8 个字段里 7 个影响 hash，只有 `market_id` 不影响**——与 NWT 独立复现完全一致。RootClaim/RefundClaim 同款测试：5 个非-State 字段（`ps_tmpl_hash`/`shard_pool_id`/`token_tmpl_hash`/`claim_tmpl_hash`自引用/`market_suffix_hash`）**全部**影响各自的 template hash。

**对账记录（诚实记录一次计数错误）**：本 provenance 第一次交付时报告"ShardLeaf_direct 6 个字段变了"，是因为漏测了 `seal_count`——NWT 独立复现出"7 个变了"，两边对账后确认 NWT 的数字对，`02-isolate-shardleafdirect-8fields.mjs` 已补齐 `seal_count` 测试并写入文件本身（不是口头修正）。

### 第三轮：编译期环是否真实存在？（`04-cycle-fixedpoint-iteration.mjs` / `05-stable-tail-search.mjs`）

Bettor 最担心的具体问题：`ShardLeaf_direct` ctor 烤 `token_tmpl_hash`（KTT 的模板 hash），`KanetTestToken` ctor 烤 `market_tmpl_suffix`（ShardLeaf_direct 的 suffix）——若两者字面意义上互相需要对方的编译产物，是真实的编译期环，谁都算不出来。

- **不动点迭代**（`04`）：从占位 `token_tmpl_hash=Z32` 编译 ShardLeaf_direct 拿 suffix 尾部 → 编译 KTT 拿真实 `token_tmpl_hash` → 用这个真实值重编 ShardLeaf_direct → 对比尾部 20 字节，一轮即收敛（v1==v2）。
- **稳定尾部搜索**（`05`）：固定其余字段，把 `token_tmpl_hash`/`shard_pool_id`/`rootclose_tmpl_hash`/`min_bet`/`market_id` 逐一换成极端值 + 5 组完全随机值，算"与 baseline 编译产物的最长公共尾部"——**全部 10 组变体，最小稳定尾部长度都精确等于 132 字节，一字不差**。

**⇒ 结论**：ShardLeaf_direct 编译产物存在一段**真实存在、可复现、与全部非-State ctor 字段取值无关**的固定 132 字节尾部。若 `market_tmpl_suffix` 取这段稳定尾部（而不是整个 state_layout 意义下的 suffix），**编译期环不成立**——KTT 的 `token_tmpl_hash` 可以在 `market_tmpl_suffix` 确定之后正常算出，不需要反过来影响 `market_tmpl_suffix` 本身。

### 第四轮：唯一性核实（`06-uniqueness-scan-11contracts.mjs`）

Bettor 的顾虑：如果 132 字节是"编译器对任何合约都一样的通用 epilogue"，任何人编个空合约都能凑出同样尾部，模板锁形同虚设。用全部 11 个主网集合约 + 1 个刻意构造的、与市场/代币逻辑毫无关联的最小合约（`_min_probe.sil`，单 entry `require(checkSig(...))`）各编译一次，算各自与这 132 字节的最长公共后缀：

| 合约 | 脚本长度(字节) | 与 132 字节稳定尾部的最长公共后缀 |
|---|---|---|
| ShardLeaf_direct（自比对） | 15687 | **132**（预期） |
| ShardLeaf（同族最像） | 15168 | **24** |
| KanetTestToken | 3522 | 2 |
| RootClose | 16802 | 2 |
| PayoutShard | 32779 | 2 |
| PayoutShardV2 | 29328 | 2 |
| CloseZkV2 | 13382 | 2 |
| PoolSideTicket | 117 | 1 |
| RootClaim | 2991 | 1 |
| RefundClaim | 2656 | 1 |
| KanetTokenClaim | 1454 | 1 |
| MinProbe（无关最小合约） | 60 | 1 |

只有 `ShardLeaf_direct` 自己匹配得上全部 132 字节；最像的同族 `ShardLeaf` 只共享 24 字节（3 组不同随机 ctor 复测，稳定在 24，不会因取值浮动逼近 132）；其余全部 ≤2 字节。**这不是"编译器通用 epilogue"**——若是通用的，`MinProbe` 这种极简合约也该共享大头，但它只共享 1 字节。

### 第五轮：真实端到端向量（`07-build-real-vector.mjs` + `ktt-real-vector.test.json`）

用真实编译出的 132 字节尾部作为 `market_tmpl_suffix`，真实编译 `KanetTestToken`（成功，脚本长度 4767 字节），构造 3 条 cli-debugger 向量：

| 向量 | 内容 | 预期 | 实测 |
|---|---|---|---|
| `REAL-V1` | sigScript 尾部精确匹配真实 132 字节尾部，covenant_id 匹配 | pass | ✅ pass |
| `REAL-V2` | 尾部改 1 字节（其余不变） | fail | ✅ fail |
| `REAL-V3` | 尾部完全正确，但 covenant_id 与 next_state.owner 不匹配 | fail | ✅ fail |

**工具链身份指纹**（D-019 §5 纪律：工具二进制身份必须可核）：
- `cli-debugger.exe` 取自 `D:\kanet-tn12\scratch\_j2_silverc_v100`（J2 早前为 NWT (1345) 核 PoolSideTicket 向量时建的隔离克隆，**不是**共享的 `/d/silverscript` 工作树——那棵树当前 checkout 在 `8065184`，是 J2 自己的 OP_PICK 修复分支，语法比 v1.0.0 的 `entry` 关键字还早，解析 v1.0.0 语法文件会直接报语法错误，与本次测试数据无关，纯粹是工具版本不对）。
- `git -C scratch/_j2_silverc_v100 rev-parse HEAD` = `3ed973335b59269293564805cc2c58a14595ec03`（= D-019 pin 的 v1.0.0 编译器同一个 commit）。
- `cli-debugger.exe` sha256 见 `MANIFEST.sha256`。

## 未完成项（诚实标注，交 NWT）

1. **T-PROTO-TAIL-OPCODE-DISASM**（新票，写入规格稿 §7）：132 字节稳定尾部没有做逐 opcode 反汇编——机器上没有现成的字节码反汇编工具，本 provenance 只用间接证据（源码自带的 `OWN_PREFIX_LEN=1`/`OWN_STATE_LEN=36` 常量注释吻合实测 state_layout；唯一性扫描本身反证"不是通用 epilogue"）支持"这是合约特定逻辑不是死代码尾巴"的判断，不是逐位确认它对应哪几条 require/opcode。NWT 有 silverscript 源码，可用其 opcode 表手工比对确认。
2. **唯一性范围**：`06` 只测了 11 个真实主网合约 + 1 个刻意构造的最小合约在这批具体 ctor 占位/随机值下的结果，不是覆盖所有可能输入的数学证明。NWT 如果要独立攻击，建议尝试专门构造一个"模仿 ShardLeaf_direct 尾部结构"的恶意合约看能不能人为凑出 ≥132 字节的重叠（本 provenance 未尝试主动构造攻击样本，只测了已有的 11+1 个合规合约）。

## 文件清单

- `01-invariance-check.mjs` ~ `07-build-real-vector.mjs`：7 个验证脚本，按运行顺序编号，从 `kasia-console/` 目录用 `node ../docs/provenance/2026-09-14-j2-template-tail-anchor-uniqueness/<N>-....mjs` 跑。
- `_min_probe.sil`：唯一性扫描用的无关对照合约。
- `real-market-tmpl-suffix.hex`：`07` 脚本产出的真实 132 字节尾部（hex）。
- `ktt-real-vector.test.json`：`07` 脚本产出的 3 条 cli-debugger 向量（正向 1 + 负向 2）。
- `run.log`：全部脚本 + cli-debugger 的完整运行日志（含工具指纹行）。
- `MANIFEST.sha256`：本目录全部文件的 sha256（`run.log` 因 `.gitignore` 的 `*.log` 规则需要 `git add -f`）。
